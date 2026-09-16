/**
 * Deterministic, seeded generator for a realistic Budget V2 ledger.
 *
 * WHY A PINNED COMPOSITION TABLE
 * ------------------------------
 * Every stage from 1 to 5 is judged by re-running this harness and diffing the
 * numbers. That comparison is only meaningful if the corpus is byte-identical
 * between runs, so the composition is a fixed table rather than a heuristic,
 * there is no `Date.now()` and no `Math.random()` anywhere, and
 * `generator.test.ts` pins the resulting totals, per-table counts, field sets
 * and per-row byte sizes.
 *
 * The table is tuned so that 5 years / 2 adults reproduces the scale audit's
 * reference household EXACTLY: 11,833 rows and 17,750 ops
 * (documents/engineering/budget-local-first-scale-audit.md §3).
 *
 *   rows(table) = fixed + adults*perAdult + years*perYear + adults*years*perAdultYear
 *
 * KNOWN DISCREPANCY WITH THE AUDIT
 * --------------------------------
 * The audit also quotes a four-member household at 24,703 rows. No linear
 * composition can satisfy both F + 2P = 11,833 and F + 4P = 24,703 with a
 * non-negative fixed term (it implies F = -1,037). This generator reproduces
 * the 2-adult reference exactly and yields 22,655 rows at 5y/4a. The 4-member
 * column is therefore labelled generator-derived in the baseline document and
 * needs a product call before it is cited as the audit's figure.
 *
 * Row shapes mirror the real API types field-for-field; each factory cites the
 * interface it mirrors at file:line.
 */
import { createHash } from 'node:crypto';

import {
  LEDGER_TABLE_KEYS,
  LEDGER_TABLE_NAMES,
  type LedgerTableName,
} from '../../../../../src/features/budget/local/projection';
import type { StoredOperation } from '../../../src/store/types';

export type ScaleRow = Record<string, unknown>;

/**
 * Structural stand-in for `LocalBudgetLedger`. The real type cannot be imported
 * here: `engine.ts` pulls `@api/*` and `@services/storage`, which do not
 * resolve outside the mobile tsconfig (18 of the package's 20 pre-existing tsc
 * errors are exactly that). Call sites cast `as never` into the projection
 * functions, precisely as `budget-v2-hotpath.bench.test.ts:228` already does.
 */
export type ScaleLedger = {
  version: 1;
  household: ScaleRow;
  memberId: string;
  deviceId: string;
  ops: StoredOperation[];
  lww?: Record<string, unknown>;
  conflicts?: unknown[];
  pendingEnrolment?: boolean;
  crypto?: Record<string, string | number>;
} & { [T in LedgerTableName]: ScaleRow[] };

export type ScaleSpec = { years: number; adults?: number; seed?: number };
export type ScaleId = { years: number; adults: number; rows: number; ops: number };

export const DEFAULT_SEED = 0x5c41e;
export const REFERENCE_SPEC: Required<ScaleSpec> = { years: 5, adults: 2, seed: DEFAULT_SEED };

/** First budget year. Fixed so dates — and therefore JSON sizes — never drift. */
const BASE_YEAR = 2021;
const HOUSEHOLD_ID = 'hh_local_9f3c1a7b2d4e6081';
const ISO = '2026-03-14T08:21:44.512Z';

/**
 * Wall-clock window the corpus's LWW watermarks are stamped in. Every corpus
 * stamp is BELOW the wall clock the phases and guards use for incoming ops
 * (1.8e12 and up), so a peer edit still wins the merge — the corpus is history,
 * not the future.
 */
const LWW_EPOCH = 1_600_000_000_000;

/** One device per member, matching how `oplog-factory` attributes authorship. */
export function memberIdsFor(adults: number): string[] {
  return Array.from({ length: adults }, (_, m) => `mem_${String(m).padStart(2, '0')}c2f9a41`);
}

export function deviceIdsFor(adults: number): string[] {
  return Array.from({ length: adults }, (_, m) => (m === 0 ? LOCAL_DEVICE_ID : `dev_${String(m).padStart(2, '0')}9c4e7f2a1b`));
}

const LOCAL_DEVICE_ID = 'dev_a1b2c3d4e5f6';

/** Device suffix `hlc.ts#format` embeds — last 7 chars of the device id. */
const hlcSuffix = (deviceId: string): string => deviceId.slice(-7);

type Composition = { fixed: number; perAdult: number; perYear: number; perAdultYear: number };

const NONE: Composition = { fixed: 0, perAdult: 0, perYear: 0, perAdultYear: 0 };
const c = (
  fixed: number,
  perAdult = 0,
  perYear = 0,
  perAdultYear = 0,
): Composition => ({ fixed, perAdult, perYear, perAdultYear });

/**
 * Rows per table. Totals by construction:
 *   fixed 66 · perAdult 11 · perYear 189 · perAdultYear 1,080
 *   5y/2a = 66 + 22 + 945 + 10,800 = 11,833  (the audit's reference)
 */
export const TABLE_COMPOSITION: Record<LedgerTableName, Composition> = {
  // fixed — set up once and rarely touched again
  categories: c(24),
  savingsCategories: c(12),
  savingsGoals: c(5),
  mortgages: c(1),
  mortgageTerms: c(3),
  mortgageOffers: c(1),
  wishes: c(20),

  // per adult — one set of pay sources / accounts / bills each
  savingsIncomeTemplates: c(0, 2),
  registeredAccounts: c(0, 2),
  savingsRecurringPayments: c(0, 7),

  // per year — the household's own calendar
  goals: c(0, 0, 12),
  subBudgets: c(0, 0, 12),
  savingsMonthlyTargets: c(0, 0, 12),
  mortgageStatements: c(0, 0, 12),
  mortgageEvents: c(0, 0, 2),
  budgetRenewals: c(0, 0, 6),
  items: c(0, 0, 48),
  transfers: c(0, 0, 24),
  budgetLoans: c(0, 0, 1),
  wishEntries: c(0, 0, 40),
  wishAttachments: c(0, 0, 20),

  // per adult-year — the rows that actually accumulate
  expenses: c(0, 0, 0, 730),
  savingsSpending: c(0, 0, 0, 300),
  savingsIncome: c(0, 0, 0, 26),
  registeredTransactions: c(0, 0, 0, 24),
};

/**
 * Ops per row. One create op per row plus a later edit on half of them; at the
 * reference scale that is 11,833 + 5,917 = 17,750, matching the audit's 1.5
 * ops-per-row ratio.
 */
const OPS_PER_ROW_EXTRA = 0.5;

function resolved(spec: ScaleSpec): Required<ScaleSpec> {
  return { years: spec.years, adults: spec.adults ?? 2, seed: spec.seed ?? DEFAULT_SEED };
}

export function rowCounts(spec: ScaleSpec): Record<LedgerTableName, number> {
  const { years, adults } = resolved(spec);
  const out = {} as Record<LedgerTableName, number>;
  for (const table of LEDGER_TABLE_NAMES) {
    const comp = TABLE_COMPOSITION[table] ?? NONE;
    out[table] =
      comp.fixed + adults * comp.perAdult + years * comp.perYear + adults * years * comp.perAdultYear;
  }
  return out;
}

export function scaleId(spec: ScaleSpec): ScaleId {
  const { years, adults } = resolved(spec);
  const counts = rowCounts(spec);
  let rows = 0;
  for (const table of LEDGER_TABLE_NAMES) rows += counts[table];
  return { years, adults, rows, ops: rows + Math.round(rows * OPS_PER_ROW_EXTRA) };
}

// ---------------------------------------------------------------------------
// seeded PRNG
// ---------------------------------------------------------------------------

/** mulberry32 — 32-bit, no state outside the closure, identical on every host. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Seeded per (table, index) rather than per run, so a row's content depends
 * only on where it sits — generation stays reproducible even if the table
 * order or the loop shape ever changes.
 */
function rngFor(seed: number, table: string, index: number): () => number {
  return mulberry32((hashString(table) ^ Math.imul(index + 1, 2654435761) ^ seed) >>> 0);
}

/** 32 entries so JSON/AEAD sizes vary the way real text does, not uniformly. */
const VOCAB = [
  'groceries',
  'utilities and heating',
  'car insurance renewal',
  'daycare',
  'weekly shop',
  'pharmacy',
  'internet',
  'mobile plan',
  'transit pass',
  'dentist',
  'home maintenance',
  'streaming bundle',
  'gym membership',
  'restaurant with friends',
  'school supplies',
  'pet food and vet',
  'gas station fill up',
  'hardware store',
  'clothing',
  'gifts',
  'travel savings',
  'emergency fund top up',
  'furniture',
  'books and courses',
  'garden centre',
  'bulk warehouse run',
  'takeout',
  'parking',
  'haircut',
  'charity donation',
  'software subscription',
  'bicycle repair',
] as const;

const VENDORS = [
  'Costco Wholesale Warehouse',
  'Loblaws',
  'Shoppers Drug Mart',
  'Canadian Tire',
  'Home Depot',
  'Amazon.ca',
  'Petro-Canada',
  'Save-On-Foods',
] as const;

function pick<T>(r: () => number, list: readonly T[]): T {
  return list[Math.floor(r() * list.length)]!;
}

function chance(r: () => number, p: number): boolean {
  return r() < p;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** YYYY-MM-DD spread across the corpus's calendar window. */
function dateAt(years: number, i: number, r: () => number): string {
  const year = BASE_YEAR + (i % years);
  const month = 1 + Math.floor(r() * 12);
  const day = 1 + Math.floor(r() * 28);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function periodAt(years: number, i: number): string {
  return `${BASE_YEAR + (Math.floor(i / 12) % years)}-${pad2((i % 12) + 1)}`;
}

// ---------------------------------------------------------------------------
// row factories — each mirrors the real API type field-for-field
// ---------------------------------------------------------------------------

type Ctx = { years: number; adults: number; members: string[] };

type Factory = (i: number, r: () => number, ctx: Ctx) => ScaleRow;

const memberOf = (ctx: Ctx, i: number): string => ctx.members[i % ctx.members.length]!;

/** src/api/budget.ts:6 BudgetCategory */
const makeCategory: Factory = (i, r) => ({
  id: `cat_${i}`,
  household_id: HOUSEHOLD_ID,
  name: `${pick(r, VOCAB)} ${i}`,
  icon: pick(r, ['shopping-cart', 'home', 'car', 'heart', 'book'] as const),
  color: `#${Math.floor(r() * 0xffffff).toString(16).padStart(6, '0')}`,
  sort_order: i,
  created_at: ISO,
  usage_count: Math.floor(r() * 400),
  is_default: i < 12,
  hidden: chance(r, 0.08),
});

/** src/api/budget.ts:316 Expense */
const makeExpense: Factory = (i, r, ctx) => ({
  id: `exp_${i}`,
  household_id: HOUSEHOLD_ID,
  budget_item_id: chance(r, 0.2) ? `itm_${i % Math.max(1, ctx.years * 48)}` : null,
  category_id: `cat_${i % 24}`,
  title: `${pick(r, VOCAB)} #${i}`,
  description: chance(r, 0.25) ? `${pick(r, VOCAB)} — ${pick(r, VOCAB)}` : null,
  amount: 500 + Math.floor(r() * 60_000),
  saved_amount: chance(r, 0.3) ? Math.floor(r() * 900) : 0,
  tax_amount: Math.floor(r() * 3000),
  expense_date: dateAt(ctx.years, i, r),
  vendor: pick(r, VENDORS),
  receipt_key: chance(r, 0.2) ? `receipts/${HOUSEHOLD_ID}/${i}-0af31b.jpg` : null,
  created_by: memberOf(ctx, i),
  created_at: ISO,
});

/** src/api/budget.ts:22 BudgetItem */
const makeItem: Factory = (i, r, ctx) => ({
  id: `itm_${i}`,
  household_id: HOUSEHOLD_ID,
  category_id: `cat_${i % 24}`,
  timeframe: pick(r, ['quarter', 'year', 'month'] as const),
  year: BASE_YEAR + Math.floor(i / 48),
  quarter: (i % 4) + 1,
  title: `Planned ${pick(r, VOCAB)} ${i}`,
  description: `${pick(r, VOCAB)}; schedule the follow-up visit and confirm the quote`,
  estimated_cost_min: 5_000 + Math.floor(r() * 200_000),
  estimated_cost_max: 25_000 + Math.floor(r() * 200_000),
  actual_cost: chance(r, 0.35) ? 20_000 + Math.floor(r() * 200_000) : null,
  priority: pick(r, ['critical', 'high', 'medium', 'low'] as const),
  status: pick(r, ['planned', 'in_progress', 'completed', 'deferred', 'cancelled'] as const),
  is_recurring: chance(r, 0.17),
  recurrence_frequency: chance(r, 0.17) ? 'monthly' : null,
  source_type: null,
  source_id: null,
  target_date: dateAt(ctx.years, i, r),
  completed_at: chance(r, 0.2) ? ISO : null,
  created_by: memberOf(ctx, i),
  created_at: ISO,
  updated_at: ISO,
});

/** src/api/budget.ts:90 BudgetGoal */
const makeGoal: Factory = (i, r) => ({
  id: `goal_${i}`,
  household_id: HOUSEHOLD_ID,
  year: BASE_YEAR + Math.floor(i / 12),
  month: (i % 12) + 1,
  planned_budget: 250_000 + Math.floor(r() * 200_000),
  actual_spent: 200_000 + Math.floor(r() * 200_000),
  category_budgets: JSON.stringify({
    cat_1: Math.floor(r() * 80_000),
    cat_2: Math.floor(r() * 80_000),
    cat_3: Math.floor(r() * 80_000),
  }),
  notes: chance(r, 0.33) ? `Trimmed ${pick(r, VOCAB)}, moved the surplus to savings` : null,
  created_at: ISO,
  updated_at: ISO,
});

/** src/api/budget.ts:167 SubBudget */
const makeSubBudget: Factory = (i, r) => ({
  id: `sub_${i}`,
  household_id: HOUSEHOLD_ID,
  category_id: `cat_${i % 24}`,
  year: BASE_YEAR + Math.floor(i / 12),
  month: chance(r, 0.5) ? (i % 12) + 1 : null,
  limit_type: chance(r, 0.7) ? 'amount' : 'percent',
  amount_cents: 20_000 + Math.floor(r() * 150_000),
  percent_bps: chance(r, 0.3) ? Math.floor(r() * 10_000) : null,
  created_at: ISO,
  updated_at: ISO,
});

/** src/api/budget.ts:230 BudgetTransferRecord (camelCase on the wire) */
const makeTransfer: Factory = (i, r) => ({
  id: `xfer_${i}`,
  amountCents: 1_000 + Math.floor(r() * 300_000),
  destinationType: pick(r, ['next_month', 'savings_goal', 'registered_account'] as const),
  destinationLabel: `${pick(r, VOCAB)} fund`,
  note: chance(r, 0.4) ? `Rolled over from ${pick(r, VOCAB)}` : null,
  createdAt: ISO,
});

/** src/api/mortgage.ts:28 Mortgage */
const makeMortgage: Factory = (i, r) => ({
  id: `mtg_${i}`,
  household_id: HOUSEHOLD_ID,
  nickname: 'Primary residence',
  lender: pick(r, ['RBC Royal Bank', 'TD Canada Trust', 'Scotiabank', 'BMO'] as const),
  product_type: 'standard',
  property_address: '128 Maple Grove Crescent, Vancouver BC',
  mortgage_number_last4: String(1000 + Math.floor(r() * 8999)),
  original_price_cents: 89_500_000,
  down_payment_cents: 17_900_000,
  original_principal_cents: 71_600_000,
  original_amortization_months: 300,
  start_date: `${BASE_YEAR}-06-01`,
  current_home_value_cents: 102_000_000,
  insurance_premium_cents: null,
  is_active: true,
  created_at: ISO,
  updated_at: ISO,
});

/** src/api/mortgage.ts:48 MortgageTerm (+ starting_balance_cents, localMortgageProjector.ts:48) */
const makeMortgageTerm: Factory = (i, r) => ({
  id: `mtgterm_${i}`,
  mortgage_id: 'mtg_0',
  household_id: HOUSEHOLD_ID,
  sequence: i + 1,
  rate_type: pick(r, ['fixed', 'variable_arm', 'variable_vrm'] as const),
  compounding: 'semi_annual',
  nominal_rate_bps: 180 + Math.floor(r() * 500),
  prime_rate_bps: 495,
  spread_bps: -90,
  term_months: 60,
  term_start_date: `${BASE_YEAR + i}-06-01`,
  maturity_date: `${BASE_YEAR + i + 5}-06-01`,
  payment_frequency: 'monthly',
  amortization_months_at_start: 300 - i * 60,
  scheduled_payment_cents: 320_000 + Math.floor(r() * 60_000),
  is_current: i === 0,
  starting_balance_cents: 71_600_000 - i * 4_000_000,
});

/** src/api/mortgage.ts:190 MortgageStatement */
const makeMortgageStatement: Factory = (i, r, ctx) => ({
  id: `mtgst_${i}`,
  mortgage_id: 'mtg_0',
  statement_date: `${BASE_YEAR + (Math.floor(i / 12) % ctx.years)}-${pad2((i % 12) + 1)}-01`,
  closing_balance_cents: 71_600_000 - i * 180_000,
  opening_balance_cents: 71_600_000 - (i - 1) * 180_000,
  interest_paid_cents: 140_000 + Math.floor(r() * 20_000),
  principal_paid_cents: 170_000 + Math.floor(r() * 20_000),
  payment_amount_cents: 320_000,
  interest_rate_bps: 180 + Math.floor(r() * 400),
  prime_rate_bps: 495,
  variance_bps: null,
  raw_extraction_json: null,
  source: 'ai_import',
  created_at: ISO,
});

/** src/api/mortgage.ts:373 MortgageEvent */
const makeMortgageEvent: Factory = (i, r, ctx) => ({
  id: `mtgev_${i}`,
  mortgage_id: 'mtg_0',
  household_id: HOUSEHOLD_ID,
  event_type: pick(r, ['lump_sum', 'rate_change', 'payment_change'] as const),
  event_date: dateAt(ctx.years, i, r),
  amount_cents: chance(r, 0.5) ? 500_000 + Math.floor(r() * 2_000_000) : null,
  new_rate_bps: chance(r, 0.5) ? 180 + Math.floor(r() * 400) : null,
  new_payment_cents: null,
  policy: pick(r, ['keep_payment_shorten', 'keep_amort_lower_payment'] as const),
  note: chance(r, 0.4) ? 'Annual prepayment privilege' : null,
  created_at: ISO,
});

/** src/api/mortgage.ts:309 MortgageOfferView (camelCase) */
const makeMortgageOffer: Factory = (i, r) => ({
  id: `mtgoff_${i}`,
  bankName: pick(r, ['RBC Royal Bank', 'TD Canada Trust', 'Scotiabank', 'BMO'] as const),
  offeredRatePct: 3.99,
  rateType: 'fixed',
  termMonths: 60,
  monthlyPaymentCents: 318_400,
  paymentSavedVsCurrentCents: 1_600,
  status: 'shortlisted',
  offerExpiresAt: `${BASE_YEAR + 5}-07-15`,
  note: 'Rate hold to end of month',
});

/** src/api/savings.ts:62 SavingsIncomeEntry */
const makeSavingsIncome: Factory = (i, r, ctx) => ({
  id: `sinc_${i}`,
  household_id: HOUSEHOLD_ID,
  member_id: memberOf(ctx, i),
  source_type: pick(r, ['salary', 'bonus', 'freelance', 'other'] as const),
  label: `${pick(r, VOCAB)} pay`,
  amount_cents: 200_000 + Math.floor(r() * 500_000),
  income_date: dateAt(ctx.years, i, r),
  currency: 'CAD',
  notes: chance(r, 0.15) ? 'Includes retro adjustment' : null,
  template_id: chance(r, 0.8) ? `sitpl_${i % 4}` : null,
  period: periodAt(ctx.years, i),
  status: 'confirmed',
  rolled_over_from_entry_id: null,
  created_by: memberOf(ctx, i),
  created_at: ISO,
  updated_at: ISO,
});

/** src/api/savings.ts:83 SavingsSpendingEntry */
const makeSavingsSpending: Factory = (i, r, ctx) => ({
  id: `sspd_${i}`,
  household_id: HOUSEHOLD_ID,
  category_id: `scat_${i % 12}`,
  label: `${pick(r, VOCAB)} ${i}`,
  amount_cents: 500 + Math.floor(r() * 90_000),
  currency: 'CAD',
  spending_date: dateAt(ctx.years, i, r),
  notes: chance(r, 0.15) ? pick(r, VOCAB) : null,
  recurring_payment_id: chance(r, 0.3) ? `srec_${i % 14}` : null,
  period: periodAt(ctx.years, i),
  created_by: memberOf(ctx, i),
  created_at: ISO,
  updated_at: ISO,
});

/** src/api/savings.ts:149 SavingsRecurringPayment */
const makeSavingsRecurring: Factory = (i, r, ctx) => ({
  id: `srec_${i}`,
  household_id: HOUSEHOLD_ID,
  category_id: `scat_${i % 12}`,
  label: `${pick(r, VOCAB)} subscription`,
  amount_cents: 900 + Math.floor(r() * 30_000),
  currency: 'CAD',
  day_of_month: 1 + Math.floor(r() * 28),
  group_label: pick(r, ['Housing', 'Transport', 'Utilities', 'Lifestyle'] as const),
  is_essential: chance(r, 0.5),
  active: true,
  is_automated: chance(r, 0.4),
  scope_type: 'all_year',
  scope_year: null,
  active_months: null,
  source: 'manual',
  created_by: memberOf(ctx, i),
  created_at: ISO,
  updated_at: ISO,
});

/** src/api/savings.ts:112 SavingsGoal */
const makeSavingsGoal: Factory = (i, r) => ({
  id: `sgoal_${i}`,
  household_id: HOUSEHOLD_ID,
  type: i === 0 ? 'emergency_fund' : 'custom',
  name: `${pick(r, VOCAB)} fund`,
  target_amount_cents: 500_000 + Math.floor(r() * 5_000_000),
  current_amount_cents: Math.floor(r() * 3_000_000),
  target_date: `${BASE_YEAR + 6}-12-31`,
  months_of_expenses: i === 0 ? 6 : null,
  monthly_allocation_cents: 20_000 + Math.floor(r() * 80_000),
  currency: 'CAD',
  status: 'active',
  created_at: ISO,
  updated_at: ISO,
});

/** src/api/savings.ts:51 SavingsCategory */
const makeSavingsCategory: Factory = (i, r) => ({
  id: `scat_${i}`,
  household_id: HOUSEHOLD_ID,
  name: `${pick(r, VOCAB)}`,
  icon: pick(r, ['home', 'car', 'heart', 'book'] as const),
  color: `#${Math.floor(r() * 0xffffff).toString(16).padStart(6, '0')}`,
  is_essential: chance(r, 0.5),
  sort_order: i,
  created_at: ISO,
});

/** src/api/savings.ts:99 SavingsIncomeTemplate */
const makeSavingsIncomeTemplate: Factory = (i, r, ctx) => ({
  id: `sitpl_${i}`,
  household_id: HOUSEHOLD_ID,
  member_id: memberOf(ctx, i),
  source_type: 'salary',
  label: `${pick(r, VOCAB)} salary`,
  amount_cents: 300_000 + Math.floor(r() * 300_000),
  currency: 'CAD',
  day_of_month: 15,
  active: true,
  created_at: ISO,
});

/** engine.ts:44 LocalSavingsMonthlyTarget — surrogate `id`, NOT `period` (B6). */
const makeSavingsMonthlyTarget: Factory = (i, r, ctx) => ({
  id: `stgt_${i}`,
  period: periodAt(ctx.years, i),
  target_cents: 50_000 + Math.floor(r() * 200_000),
  updated_at: ISO,
});

/** src/api/budgetLoans.ts:17 BudgetLoan */
const makeBudgetLoan: Factory = (i, r) => ({
  id: `loan_${i}`,
  household_id: HOUSEHOLD_ID,
  recurring_payment_id: `srec_${i % 7}`,
  loan_kind: 'installment',
  rate_type: chance(r, 0.5) ? 'fixed' : 'zero',
  rate_bps: Math.floor(r() * 1200),
  principal_cents: 200_000 + Math.floor(r() * 3_000_000),
  term_months: 12 + Math.floor(r() * 48),
  start_date: `${BASE_YEAR + i}-02-01`,
  lender: pick(r, ['Affirm', 'Fairstone', 'Desjardins', 'Dealer finance'] as const),
  notes: chance(r, 0.3) ? 'Zero-interest promo for the first 12 months' : null,
  portal_url: chance(r, 0.3) ? 'https://portal.example.com/account' : null,
  amount_paid_cents: Math.floor(r() * 1_000_000),
  created_by: null,
  created_at: ISO,
  updated_at: ISO,
});

/** engine.ts:67 LocalBudgetRenewal */
const makeBudgetRenewal: Factory = (i, r, ctx) => ({
  id: `renew_${i}`,
  household_id: HOUSEHOLD_ID,
  recurring_payment_id: `srec_${i % 7}`,
  next_renewal_date: dateAt(ctx.years, i, r),
  status: pick(r, ['upcoming', 'renewed', 'lapsed', 'cancelled'] as const),
  reminder_lead_days: 30,
  created_at: ISO,
  updated_at: ISO,
});

/** src/api/savings.ts:222 RegisteredAccount */
const makeRegisteredAccount: Factory = (i, r, ctx) => ({
  id: `racc_${i}`,
  household_id: HOUSEHOLD_ID,
  member_id: memberOf(ctx, i),
  account_type: pick(r, ['tfsa', 'rrsp', 'fhsa', 'dpsp', 'rpp'] as const),
  institution: pick(r, ['Questrade', 'Wealthsimple', 'RBC Direct Investing'] as const),
  is_employer_plan: chance(r, 0.3),
  employer_name: chance(r, 0.3) ? 'Northline Systems Inc.' : null,
  balance_cents: Math.floor(r() * 12_000_000),
  starting_room_cents: 8_800_000,
  annual_limit_override_cents: null,
  regular_contribution_cents: 50_000,
  annual_goal_cents: 600_000,
  annual_goal_pct: null,
  is_room_only: false,
  employer_match_cents: chance(r, 0.3) ? 25_000 : null,
  recurring_start_month: `${BASE_YEAR}-01`,
  room_as_of_date: `${BASE_YEAR}-01-01`,
  prior_earned_income_cents: 9_500_000,
  pension_adjustment_cents: chance(r, 0.3) ? 450_000 : null,
  currency: 'CAD',
  created_at: ISO,
  updated_at: ISO,
});

/** src/api/savings.ts:251 RegisteredTransaction */
const makeRegisteredTransaction: Factory = (i, r, ctx) => ({
  id: `rtx_${i}`,
  account_id: `racc_${i % Math.max(1, ctx.adults * 2)}`,
  type: chance(r, 0.9) ? 'contribution' : 'withdrawal',
  kind: chance(r, 0.7) ? 'regular' : 'manual',
  contributor: chance(r, 0.8) ? 'self' : 'employer',
  amount_cents: 10_000 + Math.floor(r() * 200_000),
  transaction_date: dateAt(ctx.years, i, r),
  tax_year: BASE_YEAR + (i % ctx.years),
  period: periodAt(ctx.years, i),
  notes: chance(r, 0.1) ? 'Employer match' : null,
  source: 'manual',
  import_batch_id: null,
  created_by: memberOf(ctx, i),
  created_at: ISO,
});

/** src/api/wishes.ts:16 Wish */
const makeWish: Factory = (i, r, ctx) => ({
  id: `wish_${i}`,
  household_id: HOUSEHOLD_ID,
  title: `${pick(r, VOCAB)} wish`,
  notes: chance(r, 0.5) ? `Compare options and revisit in ${pick(r, VOCAB)} season` : null,
  cover_image_key: chance(r, 0.5) ? `wishes/${HOUSEHOLD_ID}/${i}-cover.jpg` : null,
  estimated_cost_cents: 5_000 + Math.floor(r() * 900_000),
  target_date: chance(r, 0.5) ? `${BASE_YEAR + 4}-11-01` : null,
  status: pick(r, ['active', 'achieved', 'archived'] as const),
  sort_order: i,
  created_by: memberOf(ctx, i),
  created_at: ISO,
  updated_at: ISO,
});

/** src/api/wishes.ts:37 WishEntry */
const makeWishEntry: Factory = (i, r, ctx) => {
  const kind = pick(r, ['note', 'image', 'link'] as const);
  return {
    id: `wentry_${i}`,
    wish_id: `wish_${i % 20}`,
    household_id: HOUSEHOLD_ID,
    kind,
    body: kind === 'note' ? `${pick(r, VOCAB)} — ${pick(r, VOCAB)}` : null,
    image_key: kind === 'image' ? `wishes/${HOUSEHOLD_ID}/${i}.jpg` : null,
    url: kind === 'link' ? 'https://www.example.com/product/9f3c1a7b' : null,
    link_title: kind === 'link' ? `${pick(r, VOCAB)} listing` : null,
    price_cents: chance(r, 0.5) ? 5_000 + Math.floor(r() * 500_000) : null,
    created_by: memberOf(ctx, i),
    created_at: ISO,
    author_id: memberOf(ctx, i),
    author_name: chance(r, 0.5) ? 'Alex' : 'Sam',
    author_avatar_url: null,
    parent_entry_id: chance(r, 0.2) ? `wentry_${Math.max(0, i - 1)}` : null,
    reply_to: null,
  };
};

/** engine.ts:59 LocalWishAttachment — surrogate `id`, NOT `key` (B6). */
const makeWishAttachment: Factory = (i) => ({
  id: `watt_${i}`,
  key: `wishes/${HOUSEHOLD_ID}/${i}.jpg`,
  localUri: `file:///var/mobile/Containers/Data/Application/BUDGET/Documents/wish-${i}.jpg`,
  mime: 'image/jpeg',
});

const FACTORIES: Record<LedgerTableName, Factory> = {
  categories: makeCategory,
  expenses: makeExpense,
  items: makeItem,
  goals: makeGoal,
  subBudgets: makeSubBudget,
  transfers: makeTransfer,
  mortgages: makeMortgage,
  mortgageTerms: makeMortgageTerm,
  mortgageStatements: makeMortgageStatement,
  mortgageEvents: makeMortgageEvent,
  mortgageOffers: makeMortgageOffer,
  savingsIncome: makeSavingsIncome,
  savingsSpending: makeSavingsSpending,
  savingsRecurringPayments: makeSavingsRecurring,
  savingsGoals: makeSavingsGoal,
  savingsCategories: makeSavingsCategory,
  savingsIncomeTemplates: makeSavingsIncomeTemplate,
  savingsMonthlyTargets: makeSavingsMonthlyTarget,
  budgetLoans: makeBudgetLoan,
  budgetRenewals: makeBudgetRenewal,
  registeredAccounts: makeRegisteredAccount,
  registeredTransactions: makeRegisteredTransaction,
  wishes: makeWish,
  wishEntries: makeWishEntry,
  wishAttachments: makeWishAttachment,
};

// ---------------------------------------------------------------------------

export function generateLedger(spec: ScaleSpec): ScaleLedger {
  const { years, adults, seed } = resolved(spec);
  const ctx: Ctx = { years, adults, members: memberIdsFor(adults) };
  const counts = rowCounts(spec);

  const ledger = {
    version: 1,
    household: {
      id: HOUSEHOLD_ID,
      name: 'Maple Grove',
      created_at: ISO,
      updated_at: ISO,
      member_count: adults,
      my_role: 'owner',
    },
    memberId: ctx.members[0]!,
    deviceId: LOCAL_DEVICE_ID,
    ops: [] as StoredOperation[],
    lww: {},
    conflicts: [],
    pendingEnrolment: false,
  } as unknown as ScaleLedger;

  for (const table of LEDGER_TABLE_NAMES) {
    const factory = FACTORIES[table];
    const n = counts[table];
    const rows: ScaleRow[] = new Array(n);
    for (let i = 0; i < n; i += 1) {
      rows[i] = factory(i, rngFor(seed, table, i), ctx);
    }
    ledger[table] = rows;
  }

  ledger.lww = buildLww(ledger, ctx);

  return ledger;
}

/**
 * The per-field LWW watermark map a household that has ever synced carries.
 *
 * `{}` was the one value such a household definitely does NOT have, and it made
 * every persist and cold-open figure in the baseline understate reality: audit
 * finding C18 measures this map at 6.1 MB against 3.0 MB of row data at five
 * years, i.e. it outgrows the data it describes. Building it here is what makes
 * that finding — and any Stage 2/4 compaction of it — visible to the harness.
 *
 * Shape is exactly `RowLww` (projection.ts:127): `f` maps field -> `encodeStamp`
 * (`hlc|authorMemberId`), one stamp per field, which is what `applyLedgerDelta`
 * leaves behind after the create op that materialized the row.
 *
 * NOT modelled: `del` tombstone stamps for rows that were deleted, and `p`
 * parked orphan patches. Both are real and both only ADD to the map, so this is
 * a floor. The README says so.
 */
function buildLww(ledger: ScaleLedger, ctx: Ctx): Record<string, unknown> {
  const devices = deviceIdsFor(ctx.adults);
  const lww: Record<string, Record<string, { f: Record<string, string> }>> = {};
  let tick = 0;

  for (const table of LEDGER_TABLE_NAMES) {
    const keyField = LEDGER_TABLE_KEYS[table];
    const forTable: Record<string, { f: Record<string, string> }> = {};
    const rows = ledger[table];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]!;
      const who = i % ctx.adults;
      const suffix = hlcSuffix(devices[who]!);
      const member = ctx.members[who]!;
      const f: Record<string, string> = {};
      for (const field of Object.keys(row)) {
        const wall = LWW_EPOCH + (tick % 5_000_000) * 1000;
        f[field] =
          `${String(wall).padStart(15, '0')}-${(tick & 0xffff).toString(16).padStart(4, '0')}-${suffix}` +
          `|${member}`;
        tick += 1;
      }
      forTable[String(row[keyField])] = { f };
    }
    lww[table] = forTable;
  }
  return lww;
}

/** Field stamps in the watermark map — the number audit C18 is about. */
export function lwwStampCount(ledger: ScaleLedger): number {
  let n = 0;
  for (const forTable of Object.values((ledger.lww ?? {}) as Record<string, Record<string, { f?: Record<string, string> }>>)) {
    for (const meta of Object.values(forTable ?? {})) n += Object.keys(meta.f ?? {}).length;
  }
  return n;
}

/**
 * Identity of the corpus this harness generates, so `compare` can refuse to
 * diff numbers produced from two different ones. Derived from a real 1-year
 * corpus rather than from a hand-bumped version constant: a factory tweak,
 * a new field, or a change to the watermark map moves it automatically and
 * nobody has to remember. 1 year because it must be cheap enough to compute
 * once per phase (~2,400 rows).
 */
export function corpusFingerprint(spec?: ScaleSpec): string {
  const { adults, seed } = resolved(spec ?? REFERENCE_SPEC);
  const probe = generateLedger({ years: 1, adults, seed });
  return createHash('sha256').update(JSON.stringify(probe), 'utf8').digest('hex').slice(0, 16);
}

/**
 * A delete delta over `count` DISTINCT keys spread across the table, which is
 * what `applyGoalToYear` / mortgage propagate / a bulk category purge really
 * emit. `planTableStrategy` routes anything touching >= LEDGER_INDEX_THRESHOLD
 * rows to the indexed cursor, so a 200-key delete is ONE `rows.filter` at
 * flush — not 200 whole-table rebuilds. Measuring it is the only honest way to
 * report it.
 */
export function bulkDeleteDelta(
  ledger: ScaleLedger,
  table: LedgerTableName,
  count: number,
  offset = 0,
): { v: 1; d: Record<string, string[]> } {
  const rows = ledger[table];
  const keyField = LEDGER_TABLE_KEYS[table];
  const keys: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; keys.length < count && i < rows.length; i += 1) {
    const key = String(rows[(offset + i) % rows.length]![keyField]);
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return { v: 1, d: { [table]: keys } };
}

export function totalRows(ledger: ScaleLedger): number {
  let n = 0;
  for (const table of LEDGER_TABLE_NAMES) n += ledger[table].length;
  return n;
}

export function rowIdAt(ledger: ScaleLedger, table: LedgerTableName, index: number): string {
  const rows = ledger[table];
  const row = rows[((index % rows.length) + rows.length) % rows.length]!;
  return String(row[LEDGER_TABLE_KEYS[table]]);
}

/**
 * Deep-ish clone for peer-side tests: every table array, every row AND the
 * whole watermark map copied so an in-place mutator on one ledger cannot be
 * seen by the other. `ops` is shared by reference on purpose — the byte buffers
 * are immutable here and copying 35,000 of them would dominate the setup.
 *
 * `lww` used to be reset to `{}` here, which meant every peer in every
 * measurement merged with no watermarks at all: `wins()` short-circuits on a
 * missing stamp, so the merge comparison being measured was not the merge
 * comparison the product runs.
 */
export function cloneLedger(ledger: ScaleLedger): ScaleLedger {
  const copy = { ...ledger, conflicts: [] } as ScaleLedger;
  for (const table of LEDGER_TABLE_NAMES) {
    copy[table] = ledger[table].map((row) => ({ ...row }));
  }
  const lww = (ledger.lww ?? {}) as Record<string, Record<string, { f: Record<string, string> }>>;
  const copiedLww: Record<string, Record<string, { f: Record<string, string> }>> = {};
  for (const [table, forTable] of Object.entries(lww)) {
    const rows: Record<string, { f: Record<string, string> }> = {};
    for (const [key, meta] of Object.entries(forTable ?? {})) rows[key] = { ...meta, f: { ...meta.f } };
    copiedLww[table] = rows;
  }
  copy.lww = copiedLww;
  return copy;
}
