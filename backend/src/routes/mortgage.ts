import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { requireBudgetApi } from '../middleware/brand-gate';
import { rejectFinancialWritesForLocalFirst } from '../middleware/budget-local-first-gate';
import { assertCanUseAI } from '../services/entitlement-service';
import {
  MortgageStatementExtractionService,
  type MortgageStatementMediaType,
} from '../services/mortgage/mortgage-statement-extraction-service';
import { scheduleMortgageStatementReminder } from '../services/mortgage/statement-reminder';
import { MortgageService } from '../services/mortgage-service';
import type { Env } from '../types';

const MORTGAGE_STATEMENT_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_UPLOAD_BYTES = 32 * 1024 * 1024; // 32MB

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Mortgage tracking routes (Budget-only). Mirrors `routes/savings.ts`.
 *
 * THIN CLIENT: every money figure (balance, equity, interest split, %-paid,
 * schedule) is computed in the amortization engine / service — these handlers
 * only carry input up and render BE-computed view models back. Response
 * envelopes MUST match `src/api/mortgage.ts` EXACTLY.
 *
 * Kill switch: `mortgage_enabled === 'false'` 404s the whole surface (absent key
 * = enabled). The Budget-vs-House gate is `requireBudgetApi()`.
 */

const mortgage = new Hono<{ Bindings: Env }>();

mortgage.use(requireBudgetApi());
mortgage.use('/*', rejectFinancialWritesForLocalFirst());
mortgage.use('/*', authMiddleware());
mortgage.use('/*', async (c, next) => {
  const flag = await c.env.CONFIG_KV.get('mortgage_enabled');
  if (flag === 'false') return c.json({ error: 'Not found' }, 404);
  await next();
});

function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

// ============ schemas ============

const productTypeEnum = z.enum(['standard', 'heloc_flexline', 'step']);
const rateTypeEnum = z.enum(['fixed', 'variable_arm', 'variable_vrm']);
const compoundingEnum = z.enum(['semi_annual', 'monthly']);
const frequencyEnum = z.enum([
  'monthly',
  'semi_monthly',
  'biweekly',
  'weekly',
  'accel_biweekly',
  'accel_weekly',
]);
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}/);

const createSchema = z.object({
  nickname: z.string().min(1).max(100),
  lender: z.string().max(100).nullish(),
  productType: productTypeEnum.optional(),
  propertyAddress: z.string().max(300).nullish(),
  mortgageNumberLast4: z.string().max(4).nullish(),
  originalPriceCents: z.number().int().positive().nullish(),
  downPaymentCents: z.number().int().nonnegative().nullish(),
  originalPrincipalCents: z.number().int().positive().nullish(),
  originalAmortizationMonths: z.number().int().min(1).max(480).optional(),
  startDate: dateString,
  currentHomeValueCents: z.number().int().positive().nullish(),
  insurancePremiumCents: z.number().int().nonnegative().nullish(),
  rateType: rateTypeEnum,
  compounding: compoundingEnum,
  nominalRateBps: z.number().int().min(0).max(5000).nullish(),
  primeRateBps: z.number().int().min(0).max(5000).nullish(),
  spreadBps: z.number().int().min(-2000).max(2000).nullish(),
  termMonths: z.number().int().min(1).max(120),
  paymentFrequency: frequencyEnum,
  scheduledPaymentCents: z.number().int().positive().nullish(),
});

const updateSchema = z.object({
  nickname: z.string().min(1).max(100).optional(),
  lender: z.string().max(100).nullish(),
  propertyAddress: z.string().max(300).nullish(),
  currentHomeValueCents: z.number().int().positive().nullish(),
  isActive: z.boolean().optional(),
});

const statementSchema = z.object({
  statementDate: dateString,
  closingBalanceCents: z.number().int(),
  openingBalanceCents: z.number().int().nullish(),
  periodStart: dateString.nullish(),
  periodEnd: dateString.nullish(),
  interestPaidCents: z.number().int().nullish(),
  interestChargedCents: z.number().int().nullish(),
  principalPaidCents: z.number().int().nullish(),
  paymentAmountCents: z.number().int().nullish(),
  interestRateBps: z.number().int().nullish(),
  primeRateBps: z.number().int().nullish(),
  varianceBps: z.number().int().nullish(),
  remainingAmortizationMonths: z.number().int().nullish(),
  propertyTaxPaidCents: z.number().int().nullish(),
  source: z.enum(['manual', 'camera', 'gallery', 'file', 'google_drive']).optional(),
  extractionConfidence: z.number().int().min(0).max(100).nullish(),
  rawExtractionJson: z.string().nullish(),
  // The statement's dated rate sub-periods. Omit to let the service derive a
  // single period from interestRateBps; [] clears them.
  ratePeriods: z
    .array(
      z.object({
        effectiveDate: dateString,
        rateBps: z.number().int().min(0).max(5000),
        periodEnd: dateString.nullish(),
        primeRateBps: z.number().int().min(0).max(5000).nullish(),
        varianceBps: z.number().int().min(-5000).max(5000).nullish(),
      })
    )
    .max(24)
    .optional(),
  replace: z.boolean().optional(),
});

const eventSchema = z.object({
  eventType: z.enum(['lump_sum_prepayment', 'payment_increase', 'rate_change', 'renewal', 'amortization_change']),
  eventDate: dateString,
  amountCents: z.number().int().nullish(),
  newRateBps: z.number().int().nullish(),
  newPaymentCents: z.number().int().nullish(),
  policy: z.enum(['keep_payment_shorten', 'keep_amort_lower_payment']).nullish(),
  note: z.string().max(280).nullish(),
});

const renewSchema = z.object({
  termStartDate: dateString,
  termMonths: z.number().int().min(1).max(120),
  rateType: rateTypeEnum,
  compounding: compoundingEnum,
  nominalRateBps: z.number().int().min(0).max(5000).nullish(),
  primeRateBps: z.number().int().min(0).max(5000).nullish(),
  spreadBps: z.number().int().min(-2000).max(2000).nullish(),
  paymentFrequency: frequencyEnum,
  scheduledPaymentCents: z.number().int().positive().nullish(),
  amortizationMonthsAtStart: z.number().int().min(1).max(480).optional(),
});

const offerSchema = z.object({
  bankName: z.string().min(1).max(100),
  offeredRateBps: z.number().int().min(0).max(5000),
  rateType: rateTypeEnum,
  termMonths: z.number().int().min(1).max(120),
  monthlyPaymentCents: z.number().int().positive().nullish(),
  offerExpiresAt: dateString.nullish(),
  source: z.enum(['manual', 'ai']).optional(),
  note: z.string().max(280).nullish(),
});

const offerUpdateSchema = z.object({
  status: z.enum(['draft', 'shortlisted', 'accepted', 'declined']).optional(),
  note: z.string().max(280).nullish(),
  monthlyPaymentCents: z.number().int().positive().nullish(),
});

const whatIfQuerySchema = z.object({ lumpSumCents: z.coerce.number().int().positive().optional() });

// ============ routes ============

/** POST / → create a mortgage + its first term. */
mortgage.post('/', zValidator('json', createSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const service = new MortgageService(c.env, c.env.DB);
  const created = await service.createMortgage(householdId, userId, input);
  return c.json(created, 201);
});

/** GET / → { mortgages } list (active first). */
mortgage.get('/', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const service = new MortgageService(c.env, c.env.DB);
  const mortgages = await service.listMortgages(householdId, userId);
  return c.json({ mortgages });
});

/** GET /:mortgageId → the full mortgage record (settings / edit-form prefill). */
mortgage.get('/:mortgageId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const mortgageId = c.req.param('mortgageId');
  const service = new MortgageService(c.env, c.env.DB);
  const record = await service.getMortgage(householdId, userId, mortgageId);
  return c.json(record);
});

/** GET /:mortgageId/summary → the dashboard view model. */
mortgage.get('/:mortgageId/summary', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const mortgageId = c.req.param('mortgageId');
  const service = new MortgageService(c.env, c.env.DB);
  const summary = await service.getSummary(householdId, userId, mortgageId);
  return c.json(summary);
});

/** GET /:mortgageId/schedule → the amortization schedule rows. */
mortgage.get('/:mortgageId/schedule', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const mortgageId = c.req.param('mortgageId');
  const service = new MortgageService(c.env, c.env.DB);
  const schedule = await service.getSchedule(householdId, userId, mortgageId);
  return c.json(schedule);
});

/** GET /:mortgageId/terms → { terms } (rate history). */
mortgage.get('/:mortgageId/terms', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const mortgageId = c.req.param('mortgageId');
  const service = new MortgageService(c.env, c.env.DB);
  const terms = await service.listTerms(householdId, userId, mortgageId);
  return c.json({ terms });
});

/** PATCH /:mortgageId → update editable fields. */
mortgage.patch('/:mortgageId', zValidator('json', updateSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const mortgageId = c.req.param('mortgageId');
  const input = c.req.valid('json');
  const service = new MortgageService(c.env, c.env.DB);
  const updated = await service.updateMortgage(householdId, userId, mortgageId, input);
  return c.json(updated);
});

/** DELETE /:mortgageId → remove the mortgage (cascades terms). */
mortgage.delete('/:mortgageId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const mortgageId = c.req.param('mortgageId');
  const service = new MortgageService(c.env, c.env.DB);
  await service.deleteMortgage(householdId, userId, mortgageId);
  return c.body(null, 204);
});

// ---- Statements ----

/** POST /:mortgageId/statements → commit a statement (409 on duplicate date unless replace). */
mortgage.post('/:mortgageId/statements', zValidator('json', statementSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const mortgageId = c.req.param('mortgageId');
  const { replace, ...input } = c.req.valid('json');
  const service = new MortgageService(c.env, c.env.DB);
  const statement = await service.addStatement(householdId, userId, mortgageId, input, { replace });
  // Nudge the member to upload next month's statement (rolls forward on each
  // commit). Best-effort — never throws, so it can't fail the save.
  await scheduleMortgageStatementReminder(c.env, c.env.DB, {
    householdId,
    mortgageId,
    statementDate: input.statementDate,
  });
  return c.json(statement, 201);
});

/** GET /:mortgageId/statements → { statements } (newest first). */
mortgage.get('/:mortgageId/statements', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const mortgageId = c.req.param('mortgageId');
  const service = new MortgageService(c.env, c.env.DB);
  const statements = await service.listStatements(householdId, userId, mortgageId);
  return c.json({ statements });
});

/**
 * GET /:mortgageId/rate-periods → { ratePeriods } (oldest first).
 * The dated interest-rate axis captured from the statements — one row per rate
 * sub-period, so a mid-statement change (e.g. Oct 30) has its exact date. Feeds
 * the change history and the rate-impact charts.
 */
mortgage.get('/:mortgageId/rate-periods', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const mortgageId = c.req.param('mortgageId');
  const service = new MortgageService(c.env, c.env.DB);
  const ratePeriods = await service.listRatePeriods(householdId, userId, mortgageId);
  return c.json({ ratePeriods });
});

/** DELETE /:mortgageId/statements/:statementId → remove a statement. */
mortgage.delete('/:mortgageId/statements/:statementId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const mortgageId = c.req.param('mortgageId');
  const statementId = c.req.param('statementId');
  const service = new MortgageService(c.env, c.env.DB);
  await service.deleteStatement(householdId, userId, mortgageId, statementId);
  return c.body(null, 204);
});

/**
 * POST /:mortgageId/statements/extract → AI-extract a statement into a review
 * draft (multipart file OR text). Gated by assertCanUseAI. Nothing is persisted;
 * the returned draft is PII-scrubbed (no full number / no name). The client
 * reviews, then commits via POST .../statements.
 */
mortgage.post('/:mortgageId/statements/extract', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);

  const service = new MortgageService(c.env, c.env.DB);
  await service.assertHouseholdMember(householdId, userId);
  await assertCanUseAI(userId, c.env);

  const extractor = new MortgageStatementExtractionService(c.env, userId);
  const formData = await c.req.formData();
  const uploaded = formData.get('file');
  const textField = formData.get('text');

  if (uploaded && typeof uploaded !== 'string') {
    const file = uploaded as File;
    const mime = (file.type || 'application/pdf') as MortgageStatementMediaType;
    if (!(MORTGAGE_STATEMENT_MIMES as readonly string[]).includes(mime)) {
      return c.json({ error: { code: 'unsupported_media_type', message: 'Unsupported file type. Use PDF, JPEG, PNG or WEBP.' } }, 415);
    }
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength > MAX_UPLOAD_BYTES) {
      return c.json({ error: { code: 'payload_too_large', message: 'File too large (max 32MB).' } }, 413);
    }
    const { data } = await extractor.extractFromBase64(arrayBufferToBase64(buffer), mime);
    return c.json({ draft: data });
  }

  if (typeof textField === 'string' && textField.trim()) {
    const { data } = await extractor.extractFromText(textField);
    return c.json({ draft: data });
  }

  return c.json({ error: { code: 'bad_request', message: 'Provide a file or text to extract.' } }, 400);
});

// ---- Events + renewal ----

/** POST /:mortgageId/events → record a prepayment / rate-change / etc. */
mortgage.post('/:mortgageId/events', zValidator('json', eventSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const mortgageId = c.req.param('mortgageId');
  const input = c.req.valid('json');
  const service = new MortgageService(c.env, c.env.DB);
  const event = await service.addEvent(householdId, userId, mortgageId, input);
  return c.json(event, 201);
});

/** GET /:mortgageId/events → { events } (change ledger, newest first). */
mortgage.get('/:mortgageId/events', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const mortgageId = c.req.param('mortgageId');
  const service = new MortgageService(c.env, c.env.DB);
  const events = await service.listEvents(householdId, userId, mortgageId);
  return c.json({ events });
});

/** POST /:mortgageId/renew → start a new term (re-amortized at the new rate). */
mortgage.post('/:mortgageId/renew', zValidator('json', renewSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const mortgageId = c.req.param('mortgageId');
  const input = c.req.valid('json');
  const service = new MortgageService(c.env, c.env.DB);
  const term = await service.renewMortgage(householdId, userId, mortgageId, input);
  return c.json(term, 201);
});

// ---- Renewal offers (shopping) + what-if ----

/** POST /:mortgageId/offers → add a bank renewal offer. */
mortgage.post('/:mortgageId/offers', zValidator('json', offerSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const mortgageId = c.req.param('mortgageId');
  const input = c.req.valid('json');
  const service = new MortgageService(c.env, c.env.DB);
  const offer = await service.addOffer(householdId, userId, mortgageId, input);
  return c.json(offer, 201);
});

/** GET /:mortgageId/offers → offers + computed payment saved vs incumbent. */
mortgage.get('/:mortgageId/offers', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const mortgageId = c.req.param('mortgageId');
  const service = new MortgageService(c.env, c.env.DB);
  const view = await service.listOffers(householdId, userId, mortgageId);
  return c.json(view);
});

/** PATCH /:mortgageId/offers/:offerId → shortlist / accept / decline / edit. */
mortgage.patch('/:mortgageId/offers/:offerId', zValidator('json', offerUpdateSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const mortgageId = c.req.param('mortgageId');
  const offerId = c.req.param('offerId');
  const input = c.req.valid('json');
  const service = new MortgageService(c.env, c.env.DB);
  const offer = await service.updateOffer(householdId, userId, mortgageId, offerId, input);
  return c.json(offer);
});

/** DELETE /:mortgageId/offers/:offerId → remove an offer. */
mortgage.delete('/:mortgageId/offers/:offerId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const mortgageId = c.req.param('mortgageId');
  const offerId = c.req.param('offerId');
  const service = new MortgageService(c.env, c.env.DB);
  await service.deleteOffer(householdId, userId, mortgageId, offerId);
  return c.body(null, 204);
});

/** GET /:mortgageId/what-if?lumpSumCents= → accelerated + lump-sum savings. */
mortgage.get('/:mortgageId/what-if', zValidator('query', whatIfQuerySchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const mortgageId = c.req.param('mortgageId');
  const { lumpSumCents } = c.req.valid('query');
  const service = new MortgageService(c.env, c.env.DB);
  const view = await service.getWhatIf(householdId, userId, mortgageId, { lumpSumCents });
  return c.json(view);
});

export default mortgage;
