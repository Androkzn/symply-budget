import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import {
  INCOME_SOURCE_TYPES,
  REGULAR_INCOME_SOURCE_TYPES,
} from '../constants/income-sources';
import { authMiddleware } from '../middleware/auth';
import { requireBudgetApi } from '../middleware/brand-gate';
import { rejectFinancialWritesForLocalFirst } from '../middleware/budget-local-first-gate';
import { BudgetLoanExtractionService } from '../services/budget-loan-extraction-service';
import { BudgetLoanService } from '../services/budget-loan-service';
import {
  BudgetRenewalService,
  MAX_RENEWAL_DOCUMENT_BYTES,
  RENEWAL_CATEGORIES,
  RENEWAL_CYCLES,
  RENEWAL_DOCUMENT_SOURCES,
} from '../services/budget-renewal-service';
import { RegisteredStatementExtractionService } from '../services/registered-statement-extraction-service';
import { SavingsImportService } from '../services/savings-import-service';
import { PROJECTION_METHODS, SavingsService } from '../services/savings-service';
import type { Env } from '../types';
import { assertCanUseAI } from '../services/entitlement-service';

/**
 * Savings & Registered-accounts routes. Mirrors `routes/budget.ts`.
 *
 * THIN CLIENT (plan IP8): every money figure (net, YTD, headroom, room, pace),
 * per-group subtotal, and name resolution is computed in the service layer —
 * these handlers only carry input up and render BE-computed view models back.
 *
 * Response envelopes MUST match `src/api/savings.ts` EXACTLY.
 *
 * Kill switches (plan IP4 / §10.1):
 *   - `BUDGET_API_ENABLED === 'false'` → whole money surface 404s (House Worker).
 *   - `savings_enabled === 'false'` → whole surface 404s (absent key = enabled;
 *     only the literal string 'false' disables — 'FALSE'/'0'/'true' stay enabled).
 *   - `savings_import_enabled === 'false'` → import subgroup 404s independently.
 *
 * NOTE (plan §10): the in-memory `rateLimit()` middleware is per-isolate and is
 * BANNED here. v1 adds no rate limit; any future limit must be RATE_LIMITER DO-
 * or KV-backed.
 */

const savings = new Hono<{ Bindings: Env }>();

savings.use(requireBudgetApi());
savings.use('/*', rejectFinancialWritesForLocalFirst());

// All routes require authentication.
savings.use('/*', authMiddleware());

// IP4 kill switch: absent key = enabled; only the literal 'false' disables.
savings.use('/*', async (c, next) => {
  const flag = await c.env.CONFIG_KV.get('savings_enabled');
  if (flag === 'false') return c.json({ error: 'Not found' }, 404);
  await next();
});

// Helper to get householdId from the parent route param (copied from budget.ts).
function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

// ============ Shared enums / schemas ============

/** Every source type valid on an income entry, incl. one-off/irregular sources. */
const incomeSourceTypeEnum = z.enum(INCOME_SOURCE_TYPES);

/**
 * Templates are forward-looking (materialised into future months by
 * apply-templates), so only predictable sources may back one. Posting an
 * irregular source to an income-template route is a 400.
 */
const regularIncomeSourceTypeEnum = z.enum(REGULAR_INCOME_SOURCE_TYPES);

const goalTypeEnum = z.enum(['emergency_fund', 'custom']);
const goalStatusEnum = z.enum(['active', 'achieved', 'archived']);
const accountTypeEnum = z.enum(['tfsa', 'rrsp', 'fhsa', 'dpsp', 'rpp']);
const transactionTypeEnum = z.enum(['contribution', 'withdrawal']);
const transactionKindEnum = z.enum(['regular', 'manual']);
const contributorEnum = z.enum(['self', 'employer']);

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const dateString = z.string().regex(dateRegex);

// Query params arrive as strings — coerce to numbers.
const monthQuerySchema = z.object({
  year: z.coerce.number().int(),
  month: z.coerce.number().int().min(1).max(12),
});

const trendQuerySchema = z.object({
  year: z.coerce.number().int(),
  month: z.coerce.number().int().min(1).max(12),
  months: z.coerce.number().int().min(1).max(60).optional().default(6),
});

const yearQuerySchema = z.object({
  year: z.coerce.number().int(),
});

const projectionMethodEnum = z.enum(PROJECTION_METHODS);

/** `method` omitted uses the household's stored default (see `getProjection`). */
const projectionQuerySchema = z.object({
  year: z.coerce.number().int(),
  method: projectionMethodEnum.optional(),
});

/** Body for setting the household-wide default Projection method. */
const projectionMethodSchema = z.object({
  year: z.number().int().min(1900).max(4000),
  method: projectionMethodEnum,
});

// Both optional — omit for a flat all-active total (legacy), pass both to scope
// the "Monthly Payments" total/byGroup to what's actually active THIS month.
const recurringListQuerySchema = z.object({
  year: z.coerce.number().int().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

/**
 * Set/clear savings targets on one or many months of a year. One month → the
 * per-month editor; every remaining month → the bulk "apply to the rest of the
 * year" action. `targetCents: null` clears (deletes) the target.
 *
 * Negative targets are ALLOWED: a planned deficit month (a car, a wedding) is a
 * legitimate projection and clamping it to 0 would overstate the year end.
 */
const projectionTargetsSchema = z.object({
  year: z.number().int().min(1900).max(4000),
  months: z.array(z.number().int().min(1).max(12)).min(1).max(12),
  targetCents: z.number().int().min(-1_000_000_000).max(1_000_000_000).nullable(),
});

const emergencyFundQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(60).optional().default(6),
});

const applyMonthSchema = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
});

/**
 * Copy/apply monthly payments to one month ({year,month}) OR many ({months:[...]}).
 * Optional `paymentIds` copies only a subset of the active recurring payments
 * (omit/empty ⇒ all active).
 */
const paymentIdsField = { paymentIds: z.array(z.string().uuid()).max(200).optional() };
const applyRecurringSchema = z.union([
  applyMonthSchema.extend(paymentIdsField),
  z.object({ months: z.array(applyMonthSchema).min(1).max(36) }).extend(paymentIdsField),
]);

/** Which bucket the AI importer should focus on (mirrors SavingsImportScope). */
const IMPORT_SCOPES = ['all', 'income', 'spending', 'recurring', 'history'] as const;
const importScopeSchema = z.enum(IMPORT_SCOPES);

/** Compare years: `?years=2024,2025,2026` → deduped, sane-bounded number list. */
const compareYearsQuerySchema = z.object({
  years: z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((p) => Number(p.trim()))
        .filter((n) => Number.isInteger(n) && n > 1900 && n < 4000)
    )
    .refine((arr) => arr.length >= 1 && arr.length <= 5, {
      message: 'Provide between 1 and 5 valid years.',
    }),
});

// ---- Income ----
/**
 * Currencies a savings row may be entered in — the same list the app's
 * Settings → Currency picker offers (`src/config/currencies.ts`). It used to be
 * `['CAD', 'USD']`, which silently rejected every other code the picker could
 * produce. Kept as an explicit literal list rather than "any 3 letters" so a
 * typo still 400s.
 */
const currencyEnum = z.enum([
  'USD',
  'CAD',
  'EUR',
  'GBP',
  'AUD',
  'JPY',
  'CNY',
  'INR',
  'CHF',
  'MXN',
  'BRL',
]);

const createIncomeSchema = z.object({
  id: z.string().uuid(),
  member_id: z.string().uuid().nullable().optional(),
  source_type: incomeSourceTypeEnum,
  label: z.string().min(1).max(200),
  amount_cents: z.number().int().min(0),
  income_date: dateString,
  currency: currencyEnum.optional(),
  notes: z.string().max(1000).nullable().optional(),
});

const updateIncomeSchema = z.object({
  member_id: z.string().uuid().nullable().optional(),
  source_type: incomeSourceTypeEnum.optional(),
  label: z.string().min(1).max(200).optional(),
  amount_cents: z.number().int().min(0).optional(),
  income_date: dateString.optional(),
  currency: currencyEnum.optional(),
  notes: z.string().max(1000).nullable().optional(),
});

/** Confirming a draft can optionally patch fields in the same call — same shape as an update. */
const confirmIncomeSchema = updateIncomeSchema;

const confirmAllDraftIncomeSchema = applyMonthSchema;

// ---- Spending ----
const createSpendingSchema = z.object({
  id: z.string().uuid(),
  category_id: z.string().uuid().nullable().optional(),
  label: z.string().min(1).max(200),
  amount_cents: z.number().int().min(0),
  spending_date: dateString,
  currency: currencyEnum.optional(),
  notes: z.string().max(1000).nullable().optional(),
});

const updateSpendingSchema = z.object({
  category_id: z.string().uuid().nullable().optional(),
  label: z.string().min(1).max(200).optional(),
  amount_cents: z.number().int().min(0).optional(),
  spending_date: dateString.optional(),
  currency: currencyEnum.optional(),
  notes: z.string().max(1000).nullable().optional(),
});

// ---- Categories ----
const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().max(10).optional(),
  color: z.string().max(20).optional(),
  is_essential: z.boolean().optional(),
});

const updateCategorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  icon: z.string().max(10).optional(),
  color: z.string().max(20).optional(),
  is_essential: z.boolean().optional(),
  sort_order: z.number().int().min(0).optional(),
});

// ---- Goals ----
const createGoalSchema = z.object({
  id: z.string().uuid(),
  type: goalTypeEnum,
  name: z.string().min(1).max(200),
  target_amount_cents: z.number().int().min(0),
  current_amount_cents: z.number().int().min(0).optional(),
  target_date: dateString.nullable().optional(),
  months_of_expenses: z.number().int().nullable().optional(),
  monthly_allocation_cents: z.number().int().min(0).nullable().optional(),
});

const updateGoalSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  target_amount_cents: z.number().int().min(0).optional(),
  current_amount_cents: z.number().int().min(0).optional(),
  target_date: dateString.nullable().optional(),
  months_of_expenses: z.number().int().nullable().optional(),
  monthly_allocation_cents: z.number().int().min(0).nullable().optional(),
  status: goalStatusEnum.optional(),
});

// ---- Registered accounts ----
const createAccountSchema = z.object({
  id: z.string().uuid(),
  member_id: z.string().uuid().nullable().optional(),
  account_type: accountTypeEnum,
  institution: z.string().max(200).nullable().optional(),
  is_employer_plan: z.boolean().optional(),
  employer_name: z.string().max(200).nullable().optional(),
  balance_cents: z.number().int().min(0).optional(),
  starting_room_cents: z.number().int().min(0).nullable().optional(),
  annual_limit_override_cents: z.number().int().min(0).nullable().optional(),
  regular_contribution_cents: z.number().int().min(0).nullable().optional(),
  annual_goal_cents: z.number().int().min(0).nullable().optional(),
  room_as_of_date: dateString.nullable().optional(),
  prior_earned_income_cents: z.number().int().min(0).nullable().optional(),
  pension_adjustment_cents: z.number().int().min(0).nullable().optional(),
});

const updateAccountSchema = z.object({
  member_id: z.string().uuid().nullable().optional(),
  account_type: accountTypeEnum.optional(),
  institution: z.string().max(200).nullable().optional(),
  is_employer_plan: z.boolean().optional(),
  employer_name: z.string().max(200).nullable().optional(),
  balance_cents: z.number().int().min(0).optional(),
  starting_room_cents: z.number().int().min(0).nullable().optional(),
  annual_limit_override_cents: z.number().int().min(0).nullable().optional(),
  regular_contribution_cents: z.number().int().min(0).nullable().optional(),
  annual_goal_cents: z.number().int().min(0).nullable().optional(),
  room_as_of_date: dateString.nullable().optional(),
  prior_earned_income_cents: z.number().int().min(0).nullable().optional(),
  pension_adjustment_cents: z.number().int().min(0).nullable().optional(),
});

/**
 * Pension simple flow: set a member's line (room + goal $/% + recurring + employer match)
 * without a full account. All value fields are optional PATCH fields (omit = unchanged,
 * 0 = clear). goal_cents and goal_pct are mutually exclusive.
 */
const memberLineSchema = z.object({
  member_id: z.string().uuid(),
  account_type: z.enum(['tfsa', 'rrsp']),
  room_cents: z.number().int().min(0).optional(),
  goal_cents: z.number().int().min(0).nullable().optional(),
  goal_pct: z.number().int().min(0).max(100).nullable().optional(),
  regular_contribution_cents: z.number().int().min(0).nullable().optional(),
  employer_match_cents: z.number().int().min(0).nullable().optional(),
});

/** Pension simple flow: add a manual contribution to a member's line. */
const memberContributionSchema = z.object({
  /** Optional client-supplied transaction id → idempotent on retry/double-tap. */
  id: z.string().uuid().optional(),
  member_id: z.string().uuid(),
  account_type: z.enum(['tfsa', 'rrsp']),
  amount_cents: z.number().int().positive(),
  contributor: z.enum(['self', 'employer']).optional(),
  /** Optional employer-match portion logged alongside the primary (self) amount. */
  employer_amount_cents: z.number().int().nonnegative().optional(),
  transaction_date: dateString.optional(),
});

/** Pension simple flow: per-month contribution grid (backfill) for a member line + year. */
const memberMonthlyQuerySchema = z.object({
  member_id: z.string().uuid(),
  account_type: z.enum(['tfsa', 'rrsp']),
  year: z.coerce.number().int(),
});

const memberBackfillSchema = z.object({
  member_id: z.string().uuid(),
  account_type: z.enum(['tfsa', 'rrsp']),
  year: z.number().int(),
  entries: z
    .array(
      z.object({
        month: z.number().int().min(1).max(12),
        self_cents: z.number().int().min(0),
        employer_cents: z.number().int().min(0),
      })
    )
    .max(12),
});

const addTransactionSchema = z.object({
  id: z.string().uuid(),
  type: transactionTypeEnum,
  kind: transactionKindEnum.default('manual'),
  contributor: contributorEnum.default('self'),
  amount_cents: z.number().int().min(0),
  transaction_date: dateString,
  tax_year: z.number().int().nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

// ---- Income templates ----
const createIncomeTemplateSchema = z.object({
  id: z.string().uuid(),
  member_id: z.string().uuid().nullable().optional(),
  source_type: regularIncomeSourceTypeEnum,
  label: z.string().min(1).max(200),
  amount_cents: z.number().int().min(0),
  day_of_month: z.number().int().min(1).max(31).nullable().optional(),
  active: z.boolean().optional(),
});

const updateIncomeTemplateSchema = z.object({
  member_id: z.string().uuid().nullable().optional(),
  source_type: regularIncomeSourceTypeEnum.optional(),
  label: z.string().min(1).max(200).optional(),
  amount_cents: z.number().int().min(0).optional(),
  day_of_month: z.number().int().min(1).max(31).nullable().optional(),
  active: z.boolean().optional(),
});

// ---- Recurring payments ----

// Month scope (migration 0151) — 'custom_months' requires BOTH a year and at
// least one month; 'all_year' (or omitted) ignores scope_year/active_months
// entirely (the service clears them, matching the is_automated→day_of_month
// clearing pattern below).
const recurringScopeFields = {
  scope_type: z.enum(['all_year', 'custom_months']).optional(),
  scope_year: z.number().int().min(2000).max(2100).nullable().optional(),
  active_months: z.array(z.number().int().min(1).max(12)).min(1).max(12).nullable().optional(),
};
const recurringScopeRefinement = (data: {
  scope_type?: 'all_year' | 'custom_months';
  scope_year?: number | null;
  active_months?: number[] | null;
}) =>
  data.scope_type !== 'custom_months' ||
  ((data.active_months?.length ?? 0) > 0 && data.scope_year != null);
const recurringScopeRefinementMessage = {
  message: 'Select at least one month and a year when scoping a payment to specific months.',
  path: ['active_months'],
};

const createRecurringPaymentSchema = z
  .object({
    id: z.string().uuid(),
    category_id: z.string().uuid().nullable().optional(),
    label: z.string().min(1).max(200),
    amount_cents: z.number().int().min(0),
    day_of_month: z.number().int().min(1).max(31).nullable().optional(),
    group_label: z.string().max(200).nullable().optional(),
    is_essential: z.boolean().optional(),
    active: z.boolean().optional(),
    is_automated: z.boolean().optional(),
    ...recurringScopeFields,
  })
  .refine(recurringScopeRefinement, recurringScopeRefinementMessage);

const updateRecurringPaymentSchema = z
  .object({
    category_id: z.string().uuid().nullable().optional(),
    label: z.string().min(1).max(200).optional(),
    amount_cents: z.number().int().min(0).optional(),
    day_of_month: z.number().int().min(1).max(31).nullable().optional(),
    group_label: z.string().max(200).nullable().optional(),
    is_essential: z.boolean().optional(),
    active: z.boolean().optional(),
    is_automated: z.boolean().optional(),
    ...recurringScopeFields,
  })
  .refine(recurringScopeRefinement, recurringScopeRefinementMessage);

/**
 * Push an edited monthly payment onto the months it already materialized. The
 * client picks the span from the user's scope choice (this month → [m,m],
 * this & future → [m,12], whole year → [1,12]).
 */
const propagateRecurringPaymentSchema = z.object({
  year: z.number().int(),
  fromMonth: z.number().int().min(1).max(12),
  toMonth: z.number().int().min(1).max(12),
});

// =====================================================================
// Overview & trend
// =====================================================================

/** GET /overview?year&month → raw SavingsOverview */
savings.get('/overview', zValidator('query', monthQuerySchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const { year, month } = c.req.valid('query');
  const service = new SavingsService(c.env, c.env.DB);

  const overview = await service.getOverview(householdId, userId, year, month);
  return c.json(overview);
});

/** GET /trend?year&month&months → raw { months } */
savings.get('/trend', zValidator('query', trendQuerySchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const { year, month, months } = c.req.valid('query');
  const service = new SavingsService(c.env, c.env.DB);

  const trend = await service.getTrend(householdId, userId, year, month, months);
  return c.json(trend);
});

// =====================================================================
// Projection (actuals + forward targets for one year)
// =====================================================================

/**
 * GET /projection?year=YYYY&method=hybrid → SavingsProjection (12 months +
 * year-end figures for `method`, plus `methodComparison` for all 4). `method`
 * omitted uses the household's stored default.
 */
savings.get('/projection', zValidator('query', projectionQuerySchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const { year, method } = c.req.valid('query');
  const service = new SavingsService(c.env, c.env.DB);

  const projection = await service.getProjection(householdId, userId, year, undefined, method);
  return c.json(projection);
});

/**
 * PUT /projection/method → SavingsProjection, recomputed under the new
 * default. Household-wide: changes what every member sees on Home / the
 * widget / the Watch, not just this caller's own view.
 */
savings.put('/projection/method', zValidator('json', projectionMethodSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const { year, method } = c.req.valid('json');
  const service = new SavingsService(c.env, c.env.DB);

  const projection = await service.setDefaultProjectionMethod(householdId, userId, method, year);
  return c.json(projection);
});

/** PUT /projection/targets → SavingsProjection (recomputed after the write). */
savings.put('/projection/targets', zValidator('json', projectionTargetsSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const { year, months, targetCents } = c.req.valid('json');
  const service = new SavingsService(c.env, c.env.DB);

  const projection = await service.setMonthlyTargets(
    householdId,
    userId,
    year,
    months,
    targetCents
  );
  return c.json(projection);
});

// =====================================================================
// Previous-years history & comparison
// =====================================================================

/** GET /history/years → { years } (descending; drives the year pickers). */
savings.get('/history/years', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const service = new SavingsService(c.env, c.env.DB);

  const years = await service.getAvailableYears(householdId, userId);
  return c.json({ years });
});

/** GET /history/year?year=YYYY → YearHistory (12-month grid + totals/avg/goals). */
savings.get('/history/year', zValidator('query', yearQuerySchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const { year } = c.req.valid('query');
  const service = new SavingsService(c.env, c.env.DB);

  const history = await service.getYearHistory(householdId, userId, year);
  return c.json(history);
});

/** GET /history/compare?years=2024,2025,2026 → YearComparison. */
savings.get('/history/compare', zValidator('query', compareYearsQuerySchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const { years } = c.req.valid('query');
  const service = new SavingsService(c.env, c.env.DB);

  const comparison = await service.compareYears(householdId, userId, years);
  return c.json(comparison);
});

// =====================================================================
// Income
// =====================================================================

/** GET /income?year&month → { entries } */
savings.get('/income', zValidator('query', monthQuerySchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const { year, month } = c.req.valid('query');
  const service = new SavingsService(c.env, c.env.DB);

  const entries = await service.listIncome(householdId, userId, year, month);
  return c.json({ entries });
});

/** POST /income → { entry } */
savings.post('/income', zValidator('json', createIncomeSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const body = c.req.valid('json');
  const service = new SavingsService(c.env, c.env.DB);

  const entry = await service.createIncome(householdId, userId, body);
  return c.json({ entry }, 201);
});

/** PATCH /income/:id → { entry } */
savings.patch('/income/:id', zValidator('json', updateIncomeSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const service = new SavingsService(c.env, c.env.DB);

  const entry = await service.updateIncome(householdId, userId, id, body);
  return c.json({ entry });
});

/** DELETE /income/:id → { success: true } */
savings.delete('/income/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const id = c.req.param('id');
  const service = new SavingsService(c.env, c.env.DB);

  await service.deleteIncome(householdId, userId, id);
  return c.json({ success: true });
});

/** POST /income/:id/confirm (optional patch body) → { entry } — confirm a draft rollover row as-is or with edits. */
savings.post('/income/:id/confirm', zValidator('json', confirmIncomeSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const service = new SavingsService(c.env, c.env.DB);

  const entry = await service.confirmIncome(householdId, userId, id, body);
  return c.json({ entry });
});

/** POST /income/confirm-all-drafts (body {year,month}) → { confirmed } — banner "Confirm all" action. */
savings.post('/income/confirm-all-drafts', zValidator('json', confirmAllDraftIncomeSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const { year, month } = c.req.valid('json');
  const service = new SavingsService(c.env, c.env.DB);

  const result = await service.confirmAllDraftIncome(householdId, userId, year, month);
  return c.json(result);
});

/** POST /income/apply-templates (body {year,month}) → { created, skipped } */
savings.post('/income/apply-templates', zValidator('json', applyMonthSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const { year, month } = c.req.valid('json');
  const service = new SavingsService(c.env, c.env.DB);

  const result = await service.applyIncomeTemplates(householdId, userId, year, month);
  return c.json(result);
});

// =====================================================================
// Spending
// =====================================================================

/** GET /spending?year&month → { entries } */
savings.get('/spending', zValidator('query', monthQuerySchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const { year, month } = c.req.valid('query');
  const service = new SavingsService(c.env, c.env.DB);

  const entries = await service.listSpending(householdId, userId, year, month);
  return c.json({ entries });
});

/** POST /spending → { entry } */
savings.post('/spending', zValidator('json', createSpendingSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const body = c.req.valid('json');
  const service = new SavingsService(c.env, c.env.DB);

  const entry = await service.createSpending(householdId, userId, body);
  return c.json({ entry }, 201);
});

/** PATCH /spending/:id → { entry } */
savings.patch('/spending/:id', zValidator('json', updateSpendingSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const service = new SavingsService(c.env, c.env.DB);

  const entry = await service.updateSpending(householdId, userId, id, body);
  return c.json({ entry });
});

/** DELETE /spending/:id → { success: true } */
savings.delete('/spending/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const id = c.req.param('id');
  const service = new SavingsService(c.env, c.env.DB);

  await service.deleteSpending(householdId, userId, id);
  return c.json({ success: true });
});

// =====================================================================
// Categories
// =====================================================================

/** GET /categories → { categories } */
savings.get('/categories', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const service = new SavingsService(c.env, c.env.DB);

  const categories = await service.listCategories(householdId, userId);
  return c.json({ categories });
});

/** POST /categories → { category } */
savings.post('/categories', zValidator('json', createCategorySchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const body = c.req.valid('json');
  const service = new SavingsService(c.env, c.env.DB);

  const category = await service.createCategory(householdId, userId, body);
  return c.json({ category }, 201);
});

/** PATCH /categories/:id → { category } */
savings.patch('/categories/:id', zValidator('json', updateCategorySchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const service = new SavingsService(c.env, c.env.DB);

  const category = await service.updateCategory(householdId, userId, id, body);
  return c.json({ category });
});

/** DELETE /categories/:id → { success: true } (referencing spending detached, not deleted) */
savings.delete('/categories/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const id = c.req.param('id');
  const service = new SavingsService(c.env, c.env.DB);

  await service.deleteCategory(householdId, userId, id);
  return c.json({ success: true });
});

// =====================================================================
// Goals
// =====================================================================

/**
 * GET /goals/emergency-fund/suggestion?months → raw EmergencyFundSuggestion.
 * Registered BEFORE `/goals/:id` so the specific path wins the router match.
 */
savings.get(
  '/goals/emergency-fund/suggestion',
  zValidator('query', emergencyFundQuerySchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const { months } = c.req.valid('query');
    const service = new SavingsService(c.env, c.env.DB);

    const suggestion = await service.getEmergencyFundSuggestion(householdId, userId, months);
    return c.json(suggestion);
  }
);

/** GET /goals → { goals } */
savings.get('/goals', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const service = new SavingsService(c.env, c.env.DB);

  const goals = await service.listGoals(householdId, userId);
  return c.json({ goals });
});

/** POST /goals → { goal } */
savings.post('/goals', zValidator('json', createGoalSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const body = c.req.valid('json');
  const service = new SavingsService(c.env, c.env.DB);

  const goal = await service.createGoal(householdId, userId, body);
  return c.json({ goal }, 201);
});

/** PATCH /goals/:id → { goal } */
savings.patch('/goals/:id', zValidator('json', updateGoalSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const service = new SavingsService(c.env, c.env.DB);

  const goal = await service.updateGoal(householdId, userId, id, body);
  return c.json({ goal });
});

/** DELETE /goals/:id → { success: true } */
savings.delete('/goals/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const id = c.req.param('id');
  const service = new SavingsService(c.env, c.env.DB);

  await service.deleteGoal(householdId, userId, id);
  return c.json({ success: true });
});

// =====================================================================
// Registered accounts
// =====================================================================

/** GET /registered → { accounts } */
savings.get('/registered', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const service = new SavingsService(c.env, c.env.DB);

  const accounts = await service.listAccounts(householdId, userId);
  return c.json({ accounts });
});

/**
 * GET /registered/overview?year → raw PensionOverview (Pension tab Accounts view).
 * Registered before the `/registered/:id/*` routes so 'overview' is not matched as an :id.
 */
savings.get('/registered/overview', zValidator('query', yearQuerySchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const { year } = c.req.valid('query');
  const service = new SavingsService(c.env, c.env.DB);

  const overview = await service.getPensionOverview(householdId, userId, year);
  return c.json(overview);
});

/**
 * PUT /registered/member-room → { account }. Set a member's pension line — room, goal
 * (amount OR %), automated recurring monthly contribution, and employer match — without
 * a full account. Value fields are PATCH (omit = unchanged, 0 = clear). `account` is null
 * when the line was cleared/no-op. Registered before `/registered/:id`.
 */
savings.put('/registered/member-room', zValidator('json', memberLineSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const body = c.req.valid('json');
  const service = new SavingsService(c.env, c.env.DB);

  const account = await service.upsertMemberLine(householdId, userId, {
    memberId: body.member_id,
    accountType: body.account_type,
    roomCents: body.room_cents,
    goalCents: body.goal_cents,
    goalPct: body.goal_pct,
    regularContributionCents: body.regular_contribution_cents,
    employerMatchCents: body.employer_match_cents,
  });
  return c.json({ account });
});

/**
 * POST /registered/member-contribution → { account, transaction }. Add a manual
 * contribution (self or employer) to a member's pension line without a full account;
 * the line is created if it doesn't exist yet. Registered before `/registered/:id`.
 */
savings.post('/registered/member-contribution', zValidator('json', memberContributionSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const body = c.req.valid('json');
  const service = new SavingsService(c.env, c.env.DB);

  const result = await service.addMemberContribution(householdId, userId, {
    id: body.id,
    memberId: body.member_id,
    accountType: body.account_type,
    amountCents: body.amount_cents,
    contributor: body.contributor,
    employerAmountCents: body.employer_amount_cents,
    transactionDate: body.transaction_date,
  });
  return c.json(result, 201);
});

/**
 * GET /registered/member-monthly?member_id&account_type&year → { months }. The year's
 * per-month recurring contribution totals (self + employer) for a member's pension line,
 * one entry per calendar month, so the client can pre-fill the backfill grid. Registered
 * before `/registered/:id`.
 */
savings.get('/registered/member-monthly', zValidator('query', memberMonthlyQuerySchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const { member_id, account_type, year } = c.req.valid('query');
  const service = new SavingsService(c.env, c.env.DB);

  const result = await service.getMemberMonthlyContributions(
    householdId,
    userId,
    member_id,
    account_type,
    year
  );
  return c.json(result);
});

/**
 * PUT /registered/member-backfill → { account }. Replace a member line's monthly
 * contributions for a whole tax year with the supplied per-month self/employer amounts
 * (real statements differ month to month). Idempotent. Registered before `/registered/:id`.
 */
savings.put('/registered/member-backfill', zValidator('json', memberBackfillSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const body = c.req.valid('json');
  const service = new SavingsService(c.env, c.env.DB);

  const result = await service.backfillMemberContributions(householdId, userId, {
    memberId: body.member_id,
    accountType: body.account_type,
    year: body.year,
    entries: body.entries.map((e) => ({
      month: e.month,
      selfCents: e.self_cents,
      employerCents: e.employer_cents,
    })),
  });
  return c.json(result);
});

/**
 * DELETE /registered/member-contributions?member_id&account_type&year → { account }.
 * Pension simple flow: remove a member line's contributions for the given tax year and
 * switch off its recurring automation (room + goal preserved). `account` is null when the
 * line was left with nothing and removed. Registered before `/registered/:id`.
 */
savings.delete(
  '/registered/member-contributions',
  zValidator('query', memberMonthlyQuerySchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const { member_id, account_type, year } = c.req.valid('query');
    const service = new SavingsService(c.env, c.env.DB);

    const result = await service.clearMemberContributions(householdId, userId, {
      memberId: member_id,
      accountType: account_type,
      year,
    });
    return c.json(result);
  }
);

/** POST /registered → { account } */
savings.post('/registered', zValidator('json', createAccountSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const body = c.req.valid('json');
  const service = new SavingsService(c.env, c.env.DB);

  const account = await service.createAccount(householdId, userId, body);
  return c.json({ account }, 201);
});

/** POST /registered/:id/transactions → { transaction, account } */
savings.post(
  '/registered/:id/transactions',
  zValidator('json', addTransactionSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const service = new SavingsService(c.env, c.env.DB);

    const result = await service.addTransaction(householdId, userId, id, body);
    return c.json(result, 201);
  }
);

/** DELETE /registered/:id/transactions/:txId → { success: true } */
savings.delete('/registered/:id/transactions/:txId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const id = c.req.param('id');
  const txId = c.req.param('txId');
  const service = new SavingsService(c.env, c.env.DB);

  await service.deleteTransaction(householdId, userId, id, txId);
  return c.json({ success: true });
});

/** GET /registered/:id/room?year → raw RegisteredRoom */
savings.get('/registered/:id/room', zValidator('query', yearQuerySchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const id = c.req.param('id');
  const { year } = c.req.valid('query');
  const service = new SavingsService(c.env, c.env.DB);

  const room = await service.getRoom(householdId, userId, id, year);
  return c.json(room);
});

/** POST /registered/:id/apply-regular (body {year,month}) → { created, transaction, account } */
savings.post(
  '/registered/:id/apply-regular',
  zValidator('json', applyMonthSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const id = c.req.param('id');
    const { year, month } = c.req.valid('json');
    const service = new SavingsService(c.env, c.env.DB);

    const result = await service.applyRegularContribution(householdId, userId, id, year, month);
    return c.json(result);
  }
);

/** PATCH /registered/:id → { account } */
savings.patch('/registered/:id', zValidator('json', updateAccountSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const service = new SavingsService(c.env, c.env.DB);

  const account = await service.updateAccount(householdId, userId, id, body);
  return c.json({ account });
});

/** DELETE /registered/:id → { success: true } */
savings.delete('/registered/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const id = c.req.param('id');
  const service = new SavingsService(c.env, c.env.DB);

  await service.deleteAccount(householdId, userId, id);
  return c.json({ success: true });
});

// =====================================================================
// Income templates
// =====================================================================

/** GET /income-templates → { templates } */
savings.get('/income-templates', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const service = new SavingsService(c.env, c.env.DB);

  const templates = await service.listIncomeTemplates(householdId, userId);
  return c.json({ templates });
});

/** POST /income-templates → { template } */
savings.post('/income-templates', zValidator('json', createIncomeTemplateSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const body = c.req.valid('json');
  const service = new SavingsService(c.env, c.env.DB);

  const template = await service.createIncomeTemplate(householdId, userId, body);
  return c.json({ template }, 201);
});

/** PATCH /income-templates/:id → { template } */
savings.patch(
  '/income-templates/:id',
  zValidator('json', updateIncomeTemplateSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const service = new SavingsService(c.env, c.env.DB);

    const template = await service.updateIncomeTemplate(householdId, userId, id, body);
    return c.json({ template });
  }
);

/** DELETE /income-templates/:id → { success: true } */
savings.delete('/income-templates/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const id = c.req.param('id');
  const service = new SavingsService(c.env, c.env.DB);

  await service.deleteIncomeTemplate(householdId, userId, id);
  return c.json({ success: true });
});

// =====================================================================
// Recurring payments (Monthly Payments)
// =====================================================================

/** GET /recurring-payments?year&month → raw RecurringPaymentsView */
savings.get(
  '/recurring-payments',
  zValidator('query', recurringListQuerySchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const { year, month } = c.req.valid('query');
    const service = new SavingsService(c.env, c.env.DB);

    const view = await service.listRecurringPayments(householdId, userId, year, month);
    return c.json(view);
  }
);

/** POST /recurring-payments/apply (body {year,month}) → { created, skipped } */
savings.post('/recurring-payments/apply', zValidator('json', applyRecurringSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const body = c.req.valid('json');
  const service = new SavingsService(c.env, c.env.DB);

  // Normalize both shapes ({year,month} | {months:[...]}) to a month list.
  const months = 'months' in body ? body.months : [{ year: body.year, month: body.month }];
  const result = await service.applyRecurringPaymentsForMonths(
    householdId,
    userId,
    months,
    body.paymentIds
  );
  return c.json(result);
});

/** GET /recurring-payments/apply-status?year → per-month applied snapshot */
savings.get(
  '/recurring-payments/apply-status',
  zValidator('query', yearQuerySchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const { year } = c.req.valid('query');
    const service = new SavingsService(c.env, c.env.DB);

    const status = await service.getRecurringApplyStatus(householdId, userId, year);
    return c.json(status);
  }
);

/** GET /recurring-payments/yearly-breakdown?year → RecurringYearlyGroupBreakdown */
savings.get(
  '/recurring-payments/yearly-breakdown',
  zValidator('query', yearQuerySchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const { year } = c.req.valid('query');
    const service = new SavingsService(c.env, c.env.DB);

    const breakdown = await service.getRecurringYearlyGroupBreakdown(householdId, userId, year);
    return c.json(breakdown);
  }
);

/** POST /recurring-payments → { item } */
savings.post(
  '/recurring-payments',
  zValidator('json', createRecurringPaymentSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const body = c.req.valid('json');
    const service = new SavingsService(c.env, c.env.DB);

    const item = await service.createRecurringPayment(householdId, userId, body);
    return c.json({ item }, 201);
  }
);

/** PATCH /recurring-payments/:id → { item } */
savings.patch(
  '/recurring-payments/:id',
  zValidator('json', updateRecurringPaymentSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const service = new SavingsService(c.env, c.env.DB);

    const item = await service.updateRecurringPayment(householdId, userId, id, body);
    return c.json({ item });
  }
);

/** POST /recurring-payments/:id/propagate → { updated } */
savings.post(
  '/recurring-payments/:id/propagate',
  zValidator('json', propagateRecurringPaymentSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const id = c.req.param('id');
    const { year, fromMonth, toMonth } = c.req.valid('json');
    const service = new SavingsService(c.env, c.env.DB);

    const result = await service.propagateRecurringPaymentToMonths(
      householdId,
      userId,
      id,
      year,
      fromMonth,
      toMonth
    );
    return c.json(result);
  }
);

/** DELETE /recurring-payments/:id → { success: true } */
savings.delete('/recurring-payments/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const id = c.req.param('id');
  const service = new SavingsService(c.env, c.env.DB);

  await service.deleteRecurringPayment(householdId, userId, id);
  return c.json({ success: true });
});

/** GET /recurring-payments/:id/monthly-history?year → RecurringPaymentMonthlyHistory */
savings.get(
  '/recurring-payments/:id/monthly-history',
  zValidator('query', yearQuerySchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const id = c.req.param('id');
    const { year } = c.req.valid('query');
    const service = new SavingsService(c.env, c.env.DB);

    const result = await service.getRecurringPaymentMonthlyHistory(householdId, userId, id, year);
    return c.json(result);
  }
);

// =====================================================================
// Renewal reminders (Monthly Payments → track a renewal + nag until done)
// =====================================================================

const upsertRenewalSchema = z.object({
  category: z.enum(RENEWAL_CATEGORIES).optional(),
  provider: z.string().max(200).nullable().optional(),
  reference_number: z.string().max(200).nullable().optional(),
  cycle: z.enum(RENEWAL_CYCLES).optional(),
  cycle_months: z.number().int().min(1).max(60).nullable().optional(),
  next_renewal_date: dateString,
  renewal_amount_cents: z.number().int().min(0).nullable().optional(),
  auto_renew: z.boolean().optional(),
  reminder_lead_days: z.number().int().min(0).max(365).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const createRenewalDocumentSchema = z.object({
  file_name: z.string().min(1).max(255),
  mime_type: z.string().min(1).max(255),
  file_size: z.number().int().positive().max(MAX_RENEWAL_DOCUMENT_BYTES),
  source: z.enum(RENEWAL_DOCUMENT_SOURCES),
});

/** GET /recurring-payments/:id/renewal → { renewal, documents } */
savings.get('/recurring-payments/:id/renewal', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const service = new BudgetRenewalService(c.env, c.env.DB);

  const result = await service.getRenewal(householdId, userId, c.req.param('id'));
  return c.json(result);
});

/** PUT /recurring-payments/:id/renewal → { renewal } (create or update) */
savings.put(
  '/recurring-payments/:id/renewal',
  zValidator('json', upsertRenewalSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const body = c.req.valid('json');
    const service = new BudgetRenewalService(c.env, c.env.DB);

    const renewal = await service.upsertRenewal(householdId, userId, c.req.param('id'), body);
    return c.json({ renewal });
  }
);

/** POST /recurring-payments/:id/renewal/mark-renewed → { renewal } */
savings.post('/recurring-payments/:id/renewal/mark-renewed', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const service = new BudgetRenewalService(c.env, c.env.DB);

  const renewal = await service.markRenewed(householdId, userId, c.req.param('id'));
  return c.json({ renewal });
});

/** DELETE /recurring-payments/:id/renewal → { success: true } — stop tracking */
savings.delete('/recurring-payments/:id/renewal', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const service = new BudgetRenewalService(c.env, c.env.DB);

  const deleted = await service.deleteRenewal(householdId, userId, c.req.param('id'));
  return c.json({ success: deleted });
});

/**
 * Reserve a renewal attachment and get somewhere to PUT the bytes.
 * `upload_url` is null: R2 bindings have no S3-style presigned PUT, so the
 * client PUTs to the returned Worker path with its own bearer token.
 */
savings.post(
  '/recurring-payments/:id/renewal/documents',
  zValidator('json', createRenewalDocumentSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const body = c.req.valid('json');
    const service = new BudgetRenewalService(c.env, c.env.DB);

    const result = await service.createDocument(householdId, userId, c.req.param('id'), body);
    return c.json(result, 201);
  }
);

savings.put('/recurring-payments/:id/renewal/documents/:docId/content', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: 'empty file' }, 400);
  if (body.byteLength > MAX_RENEWAL_DOCUMENT_BYTES) {
    return c.json({ error: `file too large (max ${MAX_RENEWAL_DOCUMENT_BYTES} bytes)` }, 400);
  }
  const service = new BudgetRenewalService(c.env, c.env.DB);

  const document = await service.putDocumentContent(householdId, userId, c.req.param('docId'), body);
  if (!document) return c.json({ error: 'Document not found' }, 404);
  return c.json({ document });
});

/** The proxied, ownership-checked read path — the only way to reach the bytes. */
savings.get('/recurring-payments/:id/renewal/documents/:docId/content', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const service = new BudgetRenewalService(c.env, c.env.DB);

  const found = await service.getDocumentContent(householdId, userId, c.req.param('docId'));
  if (!found) return c.json({ error: 'Document not found' }, 404);
  const { object, document } = found;

  const disposition = document.mime_type === 'application/pdf' ? 'attachment' : 'inline';
  const headers = new Headers();
  headers.set('Content-Type', document.mime_type);
  headers.set('Content-Disposition', `${disposition}; filename="${document.file_name}"`);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', 'private, max-age=3600');
  headers.set('ETag', object.httpEtag);
  return new Response(object.body, { status: 200, headers });
});

savings.delete('/recurring-payments/:id/renewal/documents/:docId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const service = new BudgetRenewalService(c.env, c.env.DB);

  const deleted = await service.deleteDocument(householdId, userId, c.req.param('docId'));
  if (!deleted) return c.json({ error: 'Document not found' }, 404);
  return c.json({ deleted: true });
});

// =====================================================================
// Loan tracking (Monthly Payments → car loans, BNPL plans, personal loans)
// =====================================================================

const upsertLoanSchema = z
  .object({
    rate_type: z.enum(['zero', 'fixed']).optional(),
    rate_bps: z.number().int().min(0).max(10_000).optional(),
    principal_cents: z.number().int().positive(),
    term_months: z.number().int().min(1).max(600),
    start_date: dateString,
    lender: z.string().max(200).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    portal_url: z.string().url().max(500).nullable().optional(),
    amount_paid_cents: z.number().int().min(0).nullable().optional(),
  })
  .refine((body) => body.rate_type !== 'fixed' || (body.rate_bps ?? 0) > 0, {
    message: 'Enter an interest rate, or switch to 0% APR',
    path: ['rate_bps'],
  });

/** GET /recurring-payments/:id/loan → { loan, summary } */
savings.get('/recurring-payments/:id/loan', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const service = new BudgetLoanService(c.env, c.env.DB);

  const result = await service.getLoan(householdId, userId, c.req.param('id'));
  return c.json(result);
});

/** PUT /recurring-payments/:id/loan → { loan, summary } (create or update) */
savings.put('/recurring-payments/:id/loan', zValidator('json', upsertLoanSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const body = c.req.valid('json');
  const service = new BudgetLoanService(c.env, c.env.DB);

  const result = await service.upsertLoan(householdId, userId, c.req.param('id'), body);
  return c.json(result);
});

/** DELETE /recurring-payments/:id/loan → { success: true } — stop tracking */
savings.delete('/recurring-payments/:id/loan', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const service = new BudgetLoanService(c.env, c.env.DB);

  const deleted = await service.deleteLoan(householdId, userId, c.req.param('id'));
  return c.json({ success: deleted });
});

/** GET /recurring-payments/:id/loan/schedule → LoanScheduleView */
savings.get('/recurring-payments/:id/loan/schedule', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const service = new BudgetLoanService(c.env, c.env.DB);

  const result = await service.getSchedule(householdId, userId, c.req.param('id'));
  return c.json(result);
});

/** Loan-statement "Fill with AI" upload allowlist + cap — same shape as other extract routes. */
const LOAN_EXTRACT_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
type LoanExtractMime = (typeof LOAN_EXTRACT_MIMES)[number];
const LOAN_EXTRACT_MAX_BYTES = 32 * 1024 * 1024; // 32MB, matches receipt-scan/mortgage extract caps.

function loanExtractArrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * POST /recurring-payments/:id/loan/extract → { draft: LoanExtractionDraft }.
 * "Fill with AI": upload ONE photo/PDF of a loan/BNPL statement or screenshot,
 * get back a review draft for the Track-as-a-loan form — nothing is
 * persisted (same "review before Save" convention as /import). Gated by
 * `assertCanUseAI`; the recurring payment must resolve in THIS household
 * first so an invalid/foreign id 404s before an AI call is spent on it.
 */
savings.post('/recurring-payments/:id/loan/extract', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const recurringPaymentId = c.req.param('id');

  const loanService = new BudgetLoanService(c.env, c.env.DB);
  await loanService.assertPaymentAccess(householdId, userId, recurringPaymentId);
  await assertCanUseAI(userId, c.env);

  const formData = await c.req.formData();
  const uploaded = formData.get('file');
  if (!uploaded || typeof uploaded === 'string') {
    return c.json({ error: 'FILE_REQUIRED', message: 'A file is required.' }, 400);
  }

  const file = uploaded as File;
  const mime = (file.type || 'application/pdf') as LoanExtractMime;
  if (!(LOAN_EXTRACT_MIMES as readonly string[]).includes(mime)) {
    return c.json(
      {
        error: 'UNSUPPORTED_FILE_TYPE',
        message: `Unsupported file type: ${file.type || 'unknown'}. Allowed: PDF, JPEG, PNG, WebP.`,
      },
      400
    );
  }

  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > LOAN_EXTRACT_MAX_BYTES) {
    return c.json({ error: 'FILE_TOO_LARGE', message: 'File exceeds the 32MB limit.' }, 400);
  }

  const extractionService = new BudgetLoanExtractionService(c.env, c.env.DB);
  const { draft } = await extractionService.extractFromUpload(
    loanExtractArrayBufferToBase64(buffer),
    mime,
    householdId,
    userId
  );
  return c.json({ draft });
});

/**
 * POST /recurring-payments/loan-extract-draft → { draft: LoanExtractionDraft }.
 * Same "Fill with AI" extraction as `/recurring-payments/:id/loan/extract`
 * above, but for the Add-payment "draft mode" flow: a member turns on loan
 * tracking and uploads a statement BEFORE the recurring payment itself is
 * ever saved, so there is no `recurring_payment_id` yet to scope the route
 * to. Verifies only household membership (no payment to check) before the
 * same `assertCanUseAI` gate, then delegates to the same generic
 * `extractFromUpload` (it never took a payment id). Literal path, distinct
 * segment count from every `:id`-scoped loan route, so it can't collide —
 * same precedent as the literal `/recurring-payments/apply` above.
 */
savings.post('/recurring-payments/loan-extract-draft', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);

  const loanService = new BudgetLoanService(c.env, c.env.DB);
  await loanService.assertHouseholdAccess(householdId, userId);
  await assertCanUseAI(userId, c.env);

  const formData = await c.req.formData();
  const uploaded = formData.get('file');
  if (!uploaded || typeof uploaded === 'string') {
    return c.json({ error: 'FILE_REQUIRED', message: 'A file is required.' }, 400);
  }

  const file = uploaded as File;
  const mime = (file.type || 'application/pdf') as LoanExtractMime;
  if (!(LOAN_EXTRACT_MIMES as readonly string[]).includes(mime)) {
    return c.json(
      {
        error: 'UNSUPPORTED_FILE_TYPE',
        message: `Unsupported file type: ${file.type || 'unknown'}. Allowed: PDF, JPEG, PNG, WebP.`,
      },
      400
    );
  }

  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > LOAN_EXTRACT_MAX_BYTES) {
    return c.json({ error: 'FILE_TOO_LARGE', message: 'File exceeds the 32MB limit.' }, 400);
  }

  const extractionService = new BudgetLoanExtractionService(c.env, c.env.DB);
  const { draft } = await extractionService.extractFromUpload(
    loanExtractArrayBufferToBase64(buffer),
    mime,
    householdId,
    userId
  );
  return c.json({ draft });
});

// =====================================================================
// AI data import (Phase 5)
// =====================================================================

/** Inline-base64 read path allowlist (plan §6.4 / Task 5.4). */
const SAVINGS_DOCUMENT_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'text/plain',
] as const;
type SavingsDocumentMime = (typeof SAVINGS_DOCUMENT_MIMES)[number];

/** 20 MB inline cap — base64 (~+33%) must stay under Anthropic's 32 MB request cap. */
const SAVINGS_IMPORT_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Second kill switch (IP4 / §10.1 R4): the import subgroup 404s independently
 * of the whole surface when `savings_import_enabled === 'false'`.
 */
savings.use('/import', async (c, next) => {
  const flag = await c.env.CONFIG_KV.get('savings_import_enabled');
  if (flag === 'false') return c.json({ error: 'Not found' }, 404);
  await next();
});
savings.use('/import/*', async (c, next) => {
  const flag = await c.env.CONFIG_KV.get('savings_import_enabled');
  if (flag === 'false') return c.json({ error: 'Not found' }, 404);
  await next();
});

/**
 * Commit selections — CLOSED (`.strict()`) schema enumerating every
 * SavingsImportDraft field. The AI-produced, client-edited draft is UNTRUSTED
 * (a row value can carry adversarial text from the source doc), so we never
 * trust it just because our own `analyze` produced it (plan Task 5.4 / §6.4).
 */
const AMOUNT_CENTS_CEILING = 100_000_000_00; // $100M in cents — reject absurd values.
const boundedLabel = z.string().min(1).max(200);
const boundedName = z.string().min(1).max(200).nullable();

const importDraftIncomeSchema = z
  .object({
    member_name: boundedName,
    source_type: incomeSourceTypeEnum,
    label: boundedLabel,
    amount_cents: z.number().int().min(0).max(AMOUNT_CENTS_CEILING),
    income_date: dateString,
    is_recurring: z.boolean(),
    day_of_month: z.number().int().min(1).max(31).nullable(),
  })
  .strict();

const importDraftSpendingSchema = z
  .object({
    category_name: boundedName,
    label: boundedLabel,
    amount_cents: z.number().int().min(0).max(AMOUNT_CENTS_CEILING),
    spending_date: dateString,
  })
  .strict();

const importDraftRecurringSchema = z
  .object({
    label: boundedLabel,
    amount_cents: z.number().int().min(0).max(AMOUNT_CENTS_CEILING),
    category_name: boundedName,
    day_of_month: z.number().int().min(1).max(31).nullable(),
    group_label: z.string().max(200).nullable(),
    is_essential: z.boolean(),
  })
  .strict();

const importSelectionsSchema = z
  .object({
    income: z.array(importDraftIncomeSchema),
    spending: z.array(importDraftSpendingSchema),
    recurringPayments: z.array(importDraftRecurringSchema),
  })
  .strict();

const importCommitBodySchema = z.object({ selections: importSelectionsSchema });

/**
 * Previous-years (yearly-grid) commit — CLOSED schema. Only two buckets: income
 * rows (→ savings_income_entries) and monthlyGridSpending cells (→ budget
 * expenses). The `net` column is never submitted (it is derived).
 */
const importDraftGridSchema = z
  .object({
    period: z.string().regex(/^\d{4}-\d{2}$/),
    category_name: boundedLabel,
    amount_cents: z.number().int().min(0).max(AMOUNT_CENTS_CEILING),
  })
  .strict();

const historySelectionsSchema = z
  .object({
    income: z.array(importDraftIncomeSchema),
    monthlyGridSpending: z.array(importDraftGridSchema),
  })
  .strict();

const historyCommitBodySchema = z.object({ selections: historySelectionsSchema });

/**
 * Detect the service-surfaced parse/truncation failure (plan C-1). The import
 * service catches an internal `MalformedGenerateJSONError`, marks the job
 * `status:'failed'`, and surfaces `IMPORT_PARSE_FAILED`. Return it as a clean
 * 422 rather than letting it bubble to a 500 crash.
 */
function isParseFailed(err: unknown): boolean {
  const anyErr = err as { code?: string; message?: string } | null;
  return (
    !!anyErr &&
    (anyErr.code === 'IMPORT_PARSE_FAILED' ||
      (typeof anyErr.message === 'string' && anyErr.message.includes('IMPORT_PARSE_FAILED')))
  );
}

/**
 * POST /import — EITHER multipart (`file` + optional `text`) OR JSON `{ text }`.
 * Runs createJob then analyze synchronously; returns `{ jobId, draft }`.
 */
savings.post('/import', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  await assertCanUseAI(userId, c.env);
  const importService = new SavingsImportService(c.env, c.env.DB);

  const contentType = c.req.header('content-type') || '';

  let text: string | undefined;
  let file: { data: ArrayBuffer; mimeType: SavingsDocumentMime; name: string } | undefined;
  let sourceKind: 'file' | 'image' | 'text' = 'text';
  let scope: (typeof IMPORT_SCOPES)[number] = 'all';

  if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.formData();
    const uploaded = formData.get('file') as File | null;
    const textField = formData.get('text');
    text = typeof textField === 'string' && textField.trim().length > 0 ? textField.trim() : undefined;
    const scopeField = formData.get('scope');
    const scopeParsed = importScopeSchema.safeParse(scopeField);
    if (scopeParsed.success) scope = scopeParsed.data;

    if (uploaded) {
      const mime = (uploaded.type || 'application/pdf') as SavingsDocumentMime;
      if (!SAVINGS_DOCUMENT_MIMES.includes(mime)) {
        return c.json(
          {
            error: 'UNSUPPORTED_FILE_TYPE',
            message: `Unsupported file type: ${uploaded.type || 'unknown'}. Allowed: PDF, JPEG, PNG, WebP, CSV, plain text.`,
          },
          400
        );
      }
      if (uploaded.size > SAVINGS_IMPORT_MAX_BYTES) {
        return c.json(
          {
            error: 'IMPORT_TOO_LARGE',
            message: 'File exceeds the 20 MB import limit. Split it into smaller sections.',
          },
          400
        );
      }
      file = {
        data: await uploaded.arrayBuffer(),
        mimeType: mime,
        name: uploaded.name || 'attachment',
      };
      sourceKind = mime.startsWith('image/') ? 'image' : 'file';
    }

    if (!text && !file) {
      return c.json({ error: 'Text or a file attachment is required' }, 400);
    }
  } else {
    // JSON { text, scope? }
    const body = await c.req.json().catch(() => null);
    const parsed = z
      .object({ text: z.string().min(1).max(100_000), scope: importScopeSchema.optional() })
      .safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Text is required' }, 400);
    }
    text = parsed.data.text.trim();
    if (parsed.data.scope) scope = parsed.data.scope;
    sourceKind = 'text';
    if (!text) {
      return c.json({ error: 'Text is required' }, 400);
    }
  }

  try {
    const { jobId } = await importService.createJob(householdId, userId, {
      sourceKind,
      file,
      text,
    });
    // PDF >100-page guard + image downsample happen inside analyze.
    const draft = await importService.analyze(householdId, userId, jobId, scope);
    return c.json({ jobId, draft });
  } catch (err) {
    if (isParseFailed(err)) {
      return c.json(
        {
          error: 'IMPORT_PARSE_FAILED',
          message:
            (err as { message?: string }).message ||
            'The document could not be read. Try splitting the file or importing fewer months.',
        },
        422
      );
    }
    throw err;
  }
});

/** GET /import/:jobId → { job, draft } */
savings.get('/import/:jobId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const jobId = c.req.param('jobId');
  const importService = new SavingsImportService(c.env, c.env.DB);

  const result = await importService.getJob(householdId, userId, jobId);
  return c.json(result);
});

/** POST /import/:jobId/commit (body { selections }) → { income, spending, recurringPayments } */
savings.post('/import/:jobId/commit', zValidator('json', importCommitBodySchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const jobId = c.req.param('jobId');
  const { selections } = c.req.valid('json');
  const importService = new SavingsImportService(c.env, c.env.DB);

  const result = await importService.commit(householdId, userId, jobId, selections);
  return c.json(result);
});

/**
 * POST /import/:jobId/commit-history (body { selections: { income, monthlyGridSpending } })
 * → { income, spending, years }. Materialises a previous-years grid into
 * savings_income_entries + budget expenses (source='history_import').
 */
savings.post(
  '/import/:jobId/commit-history',
  zValidator('json', historyCommitBodySchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const jobId = c.req.param('jobId');
    const { selections } = c.req.valid('json');
    const importService = new SavingsImportService(c.env, c.env.DB);

    const result = await importService.commitHistory(householdId, userId, jobId, selections);
    return c.json(result);
  }
);

/**
 * POST /import/:jobId/undo-history → { income, spending }. Deletes only the
 * history_import rows stamped with this import batch (jobId); manual rows are
 * never touched.
 */
savings.post('/import/:jobId/undo-history', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const jobId = c.req.param('jobId');
  const importService = new SavingsImportService(c.env, c.env.DB);

  const result = await importService.undoHistoryImport(householdId, userId, jobId);
  return c.json(result);
});

/** DELETE /import/:jobId → { success: true } (also deletes the R2 object) */
savings.delete('/import/:jobId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const jobId = c.req.param('jobId');
  const importService = new SavingsImportService(c.env, c.env.DB);

  await importService.deleteJob(householdId, userId, jobId);
  return c.json({ success: true });
});

// =====================================================================
// Registered-statement AI import (Pension tab). 2-segment paths under
// `/import/` so they inherit the `savings_import_enabled` kill-switch and do
// NOT collide with the `/import/:jobId/...` job routes above.
// =====================================================================

const REGISTERED_STATEMENT_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
type RegisteredStatementMime = (typeof REGISTERED_STATEMENT_MIMES)[number];

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * POST /import/registered-extract — multipart {file} or JSON {text}. Returns an
 * un-persisted draft { accounts, confidence, rawText } for the user to review.
 */
savings.post('/import/registered-extract', async (c) => {
  const userId = c.get('userId');
  const service = new RegisteredStatementExtractionService(c.env, userId);
  const contentType = c.req.header('content-type') || '';

  try {
    if (contentType.includes('multipart/form-data')) {
      const formData = await c.req.formData();
      const uploaded = formData.get('file') as File | null;
      const textField = formData.get('text');
      const text = typeof textField === 'string' ? textField.trim() : '';

      if (uploaded) {
        const mime = (uploaded.type || 'application/pdf') as RegisteredStatementMime;
        if (!REGISTERED_STATEMENT_MIMES.includes(mime)) {
          return c.json(
            { error: `Unsupported file type: ${uploaded.type || 'unknown'}. Allowed: PDF, JPEG, PNG, WebP.` },
            400
          );
        }
        if (uploaded.size > SAVINGS_IMPORT_MAX_BYTES) {
          return c.json({ error: 'File exceeds the 20 MB import limit.' }, 400);
        }
        const base64 = arrayBufferToBase64(await uploaded.arrayBuffer());
        const { data } = await service.extractFromBase64(base64, mime);
        return c.json({ draft: data });
      }

      if (text) {
        const { data } = await service.extractFromText(text);
        return c.json({ draft: data });
      }
      return c.json({ error: 'Text or a file attachment is required' }, 400);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = z.object({ text: z.string().min(1).max(100_000) }).safeParse(body);
    if (!parsed.success) return c.json({ error: 'Text is required' }, 400);
    const { data } = await service.extractFromText(parsed.data.text.trim());
    return c.json({ draft: data });
  } catch (error) {
    console.error('[REGISTERED-IMPORT-EXTRACT] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Extraction failed' }, 500);
  }
});

const registeredImportContribSchema = z
  .object({
    id: z.string().uuid(),
    amount_cents: z.number().int().min(0).max(AMOUNT_CENTS_CEILING),
    transaction_date: dateString,
    contributor: contributorEnum.default('self'),
    tax_year: z.number().int().nullable().optional(),
  })
  .strict();

const registeredImportAccountSchema = z
  .object({
    existing_account_id: z.string().uuid().nullable().optional(),
    id: z.string().uuid().optional(),
    member_id: z.string().uuid().nullable().optional(),
    account_type: accountTypeEnum.optional(),
    institution: z.string().max(200).nullable().optional(),
    is_employer_plan: z.boolean().optional(),
    employer_name: z.string().max(200).nullable().optional(),
    balance_cents: z.number().int().min(0).max(AMOUNT_CENTS_CEILING).optional(),
    annual_goal_cents: z.number().int().min(0).nullable().optional(),
    starting_room_cents: z.number().int().min(0).nullable().optional(),
    contributions: z.array(registeredImportContribSchema),
  })
  .strict();

const registeredImportCommitSchema = z.object({
  import_batch_id: z.string().uuid(),
  accounts: z.array(registeredImportAccountSchema),
});

/** POST /import/registered-commit — persist a reviewed draft; returns the batch summary. */
savings.post(
  '/import/registered-commit',
  zValidator('json', registeredImportCommitSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const body = c.req.valid('json');
    const service = new SavingsService(c.env, c.env.DB);

    const result = await service.commitRegisteredImport(householdId, userId, body);
    return c.json(result, 201);
  }
);

/** POST /import/registered-undo — reverse a committed batch by import_batch_id. */
savings.post(
  '/import/registered-undo',
  zValidator('json', z.object({ import_batch_id: z.string().uuid() })),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const { import_batch_id } = c.req.valid('json');
    const service = new SavingsService(c.env, c.env.DB);

    const result = await service.undoRegisteredImportBatch(householdId, userId, import_batch_id);
    return c.json(result);
  }
);

export default savings;
