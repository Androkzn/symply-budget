import { eq, and, gte, lt, sql, desc, asc, like, isNotNull, inArray } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';

import { isIrregularIncomeSource } from '../constants/income-sources';
import { resolveRecurringGroupLabel } from '../constants/recurring-groups';
import { householdMembers, users } from '../db/schema';
import { expenses, budgetCategories, budgetGoals, budgetSubBudgets } from '../db/schema-budget';
import { budgetLoans } from '../db/schema-budget-loans';
import { budgetRenewals } from '../db/schema-budget-renewals';
import {
  savingsCategories,
  savingsIncomeEntries,
  savingsSpendingEntries,
  savingsIncomeTemplates,
  savingsGoals,
  savingsMonthlyTargets,
  savingsRecurringPayments,
  savingsProjectionSettings,
  registeredAccounts,
  registeredTransactions,
  type SavingsCategory,
  type SavingsIncomeEntry,
  type SavingsSpendingEntry,
  type SavingsIncomeTemplate,
  type SavingsGoal,
  type SavingsRecurringPayment,
  type RegisteredAccount,
  type RegisteredTransaction,
} from '../db/schema-savings';
import {
  D1SavingsRepository,
  type SavingsRepository,
  type SpendingEntryPatch,
} from '../repositories/savings-repository';
import type { Env } from '../types';
import { resolveAvatarUrl } from '../utils/avatar-url';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import { now } from '../utils/id';

import { computeInstallmentLoanSummary, type LoanSummary } from './budget/loan-amortization';
import {
  getTfsaRoom,
  getRrspRoom,
  getFhsaRoom,
  getDcPensionRoom,
  pensionAdjustmentFromDc,
  requireLimitsForYear,
  SAVINGS_LIMITS,
  type RoomInputs,
  type RoomResult,
} from './savings-limits';


/** Upper bound on pension registered accounts loaded per overview request. */
const PENSION_OVERVIEW_ACCOUNTS_LIMIT = 100;
/** Upper bound on household members resolved for pension overview. */
const PENSION_OVERVIEW_MEMBERS_LIMIT = 50;
/** Upper bound on room-only accounts materialized per pension cron path. */
const MATERIALIZE_RECURRING_ACCOUNTS_LIMIT = 100;
/** Upper bound on existing regular txns loaded per account during materialization. */
const MATERIALIZE_RECURRING_TXNS_LIMIT = 600;
/** Upper bound on transactions scanned when clearing a member year's contributions. */
const CLEAR_MEMBER_TXNS_LIMIT = 2000;
/** Upper bound on income rows returned in savings overview for one month. */
const OVERVIEW_INCOME_ENTRIES_LIMIT = 500;
/** Upper bound on active savings goals loaded for overview headroom. */
const OVERVIEW_ACTIVE_GOALS_LIMIT = 50;
/** Upper bound on savings categories returned per household list. */
const LIST_CATEGORIES_LIMIT = 100;
/** Upper bound on recurring payment rows returned per list. */
const LIST_RECURRING_PAYMENTS_LIMIT = 200;
/** Upper bound on income template rows returned per list. */
const LIST_INCOME_TEMPLATES_LIMIT = 50;
/** Trailing window (months) the Projection tab's "recent pace" averages over. */
const RECENT_PACE_MONTHS = 3;
/** Trailing window (months) the "Trend" projection method weights over. */
const TREND_WINDOW_MONTHS = 6;

/**
 * The four ways the Projection tab can forecast a year-end figure. Every
 * method shares the same actual/current/entered/target handling — they only
 * differ in what an untargeted future month falls back to. See
 * `SavingsService.getProjection` for the formulas.
 */
export const PROJECTION_METHODS = [
  'historical_average',
  'trend',
  'planned_budget',
  'hybrid',
] as const;
export type ProjectionMethod = (typeof PROJECTION_METHODS)[number];
const DEFAULT_PROJECTION_METHOD: ProjectionMethod = 'hybrid';

// ============ EXPORTED VIEW MODELS ============

export interface SavingsOverview {
  year: number;
  month: number;
  income: {
    total: number;
    /**
     * Predictable income (payroll, rental, …). This is the portion that is safe
     * to extrapolate forward — irregular income is deliberately excluded.
     */
    regularTotal: number;
    /** One-off income (marketplace sales, gifts, bonuses …). Actuals only. */
    irregularTotal: number;
    bySource: Record<string, number>;
    entries: SavingsIncomeEntry[];
  };
  spending: {
    /** Deducted from income = monthlyPayments + spendings. */
    total: number;
    /** Fixed monthly obligations = SUM of ACTIVE recurring "Monthly Payments". */
    monthlyPayments: number;
    /**
     * Budget "Spendings" this month = SUM(expenses.amount). THE single source of
     * truth for spend — the same figure the Budget Spendings tab & Dashboard
     * "Spent" render. Deducted from net savings.
     */
    spendings: number;
  };
  netSavings: number;
  ytdNet: number;
  goals: Array<{
    id: string;
    name: string;
    type: 'emergency_fund' | 'custom';
    target: number;
    current: number;
    monthlyAllocation: number | null;
  }>;
}

export interface SavingsTrendPoint {
  period: string;
  income: number;
  spending: number;
  /** Fixed monthly obligations = SUM of ACTIVE recurring "Monthly Payments". */
  monthlyPayments: number;
  /**
   * Budget "Spendings" this month = SUM(expenses.amount). THE single source of
   * truth for spend — the same figure the Budget Spendings tab & Dashboard
   * "Spent" render.
   */
  spendings: number;
  net: number;
  /** True when the household logged at least one real expense this month —
   *  false means `spending`/`net` rest on monthly-payment definitions alone
   *  (e.g. backfilled income with no matching expense entry), so callers
   *  accumulating a running total should treat it as untracked, not $0 spent. */
  hasExpenseData: boolean;
}

// ============ Previous-years history & comparison view models ============

/** Column totals (cents) shared by a year's totals + average rows. */
export interface YearColumnTotals {
  income: number;
  monthlyPayments: number;
  food: number;
  other: number;
  net: number;
}

/** One month of a year, mirroring the user's tracker grid (all cents). */
export interface YearMonthlyRow {
  month: number; // 1..12
  income: number;
  monthlyPayments: number;
  food: number;
  other: number;
  net: number; // income − (monthlyPayments + food + other)
}

/** Footer goals (null when the household hasn't set that goal). */
export interface YearHistoryGoals {
  foodMonthly: number | null;
  otherMonthly: number | null;
  savingsMonthly: number | null;
  savingsYearly: number | null;
  /**
   * `budget_goals.planned_budget` for each month of the year (index 0 =
   * January), null where the household never set one. This is the "spending
   * goal" the Planned Budget / Smart Blend projection methods subtract —
   * already fetched by `computeYearGoals` for the food/other averages above,
   * exposed here rather than re-queried.
   */
  plannedBudgetByMonth: (number | null)[]; // length 12
}

export interface YearHistory {
  year: number;
  months: YearMonthlyRow[]; // always length 12 (Jan..Dec)
  totals: YearColumnTotals;
  average: YearColumnTotals; // totals / monthsWithData
  monthsWithData: number;
  goals: YearHistoryGoals;
}

// ============ Projection view models ============

/**
 * One month of the projection grid.
 *  - `actual`  — a COMPLETED month: `actualNet` is real, targets are ignored.
 *  - `current` — the live month: `actualNet` is real but partial, and a target
 *                may be set on it (progress-toward-goal, not a replacement).
 *  - `future`  — no data yet; the target (or the current pace) is all there is.
 */
export interface SavingsProjectionMonth {
  month: number; // 1..12
  status: 'actual' | 'current' | 'future';
  /** Real net savings (income − all spending). Null only for future months. */
  actualNet: number | null;
  /** User-set target for this month, or null when none is set. May be negative.
   *  Settable on ANY month, including elapsed ones — a past target is never
   *  used in the math (see `projectedNet`), only as the benchmark `goalHit` /
   *  `goalAttainmentPct` grade it against what actually happened. */
  targetCents: number | null;
  /** What this month contributes to `projectedYearEnd` (see getProjection). */
  projectedNet: number;
  /**
   * What drove `projectedNet` for a 'future' month: the member's OWN entries
   * for that month, an explicit target, the household's standing monthly goal
   * (from active `savings_goals`), or the recent pace. Null for 'actual' /
   * 'current' months (their figure is real).
   *
   * `'entered'` outranks all three plan sources — data beats plan. Reported
   * 2026-09-09: a household knew their income was falling and filled in
   * October, November and December; every one of those months still rendered at
   * its goal and the year-end read far above what their entries supported.
   */
  projectionSource: 'entered' | 'target' | 'goal' | 'pace' | null;
  /** True when the month's own data exists (drives "months with data" copy). */
  hasData: boolean;
  /**
   * Whether this month has any LOGGED SPENDING of its own. Only meaningful for
   * a month ahead whose `projectionSource` is `'entered'`: income is in but
   * spending is not, so the net reads better than the month will really land
   * and the client says so on the row.
   */
  spendingLogged: boolean;
  /**
   * One-off income banked this month (gifts, bonuses, marketplace sales…). It is
   * INCLUDED in `actualNet` — it really happened — but excluded from every
   * forward figure, so the UI can explain why a spike month is not the pace.
   */
  oneOffIncome: number;
  /**
   * `actualNet − targetCents` for an elapsed/current month with a target set.
   * Null when there is no target, or the month hasn't happened yet.
   */
  goalDeltaCents: number | null;
  /**
   * `100 × actualNet / targetCents`, only when the target is POSITIVE (a % of
   * a zero/negative target — a planned deficit month — is not meaningful; use
   * `goalHit` instead there). Null otherwise.
   */
  goalAttainmentPct: number | null;
  /**
   * `actualNet >= targetCents` for an elapsed/current month with a target.
   * Works for deficit targets too (losing LESS than planned still hits).
   * Null when there is no target, or the month hasn't happened yet.
   */
  goalHit: boolean | null;
  /**
   * The Planned Budget method's breakdown for this month — expected income,
   * active recurring payments, and the Planning-tab spending goal, all in
   * cents — independent of `projectionSource`/which method is selected.
   * Null when unresolvable (see `getProjection`'s `plannedBudgetFor`). Feeds
   * the Projection tab's "how is this calculated" explanations with the
   * household's own real numbers rather than just the formula.
   */
  plannedBudget: {
    expectedIncomeCents: number;
    recurringPaymentsCents: number;
    spendingGoalCents: number;
    netCents: number;
  } | null;
}

/** Year-wide read on how the household's own per-month goals played out. */
export interface SavingsGoalPerformance {
  /** Elapsed/current months that carried an explicit target. */
  monthsTracked: number;
  /** Of those, how many met or beat their target (`goalHit`). */
  monthsHit: number;
  /** `monthsHit / monthsTracked × 100`. Null when nothing is tracked yet. */
  hitRatePct: number | null;
  /** Average `goalAttainmentPct` across tracked months with a positive target. */
  avgAttainmentPct: number | null;
  /**
   * MEDIAN attainment across the same months — what the client's card reports.
   *
   * Attainment is a ratio and can go deeply negative (a household reported a
   * June at -122% of its goal), so the mean lands somewhere no month actually
   * sat. The median describes a typical month; the mean is kept alongside it.
   */
  medianAttainmentPct: number | null;
}

/**
 * Median of a list of attainment percentages, rounded, or null when empty.
 *
 * Attainment is a RATIO and can go deeply negative — a household reported a
 * June at -122% of its goal — so the mean lands somewhere no month actually
 * sat. The median is what the Goal-performance card reports instead.
 */
function medianAttainment(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]!
    : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export interface SavingsProjection {
  year: number;
  /** 1..12 when `year` is the live year; null when the year is wholly past/future. */
  currentMonth: number | null;
  months: SavingsProjectionMonth[]; // always length 12 (Jan..Dec)
  /** Σ actual net over completed + current months. The part that is already banked. */
  actualToDate: number;
  /** Σ targets over current + future months (the part the household committed to). */
  targetedRemaining: number;
  /** Count of months still ahead (excludes the current, partially-elapsed month). */
  monthsRemaining: number;
  /** How many of those remaining months carry an explicit target. */
  monthsWithTarget: number;
  /** actualToDate + Σ per-month projections (target where set, pace where not). */
  projectedYearEnd: number;
  /**
   * Average REPEATABLE net over completed months with data — "your current
   * pace". One-off income is excluded (see getProjection) so the pace is a
   * figure the household can actually hit again.
   */
  paceMonthly: number;
  /** Where the year lands if every remaining month matches `paceMonthly`. */
  paceYearEnd: number;
  /**
   * The household's best completed month — the "you've done it before" anchor.
   * `net` is that month's REPEATABLE net, so a windfall month can never become
   * the benchmark (it may therefore be below the month's `actualNet`).
   */
  bestMonth: { month: number; net: number } | null;
  /** Stretch pace: the best month, never below the current pace. Floored at 0. */
  potentialMonthly: number;
  /** Where the year lands if every remaining month matches `potentialMonthly`. */
  potentialYearEnd: number;
  /** True when some completed month carried one-off income kept out of the pace. */
  excludesOneOffIncome: boolean;
  /** Yearly savings goal from active goals (cents), when the household set one. */
  yearGoal: number | null;
  /** Monthly savings goal from active goals (cents) — seeds the target editor. */
  monthlyGoal: number | null;
  /** How the household's own per-month targets played out this year. */
  goalPerformance: SavingsGoalPerformance;
  /** Which method produced `months`/`projectedYearEnd` above. */
  method: ProjectionMethod;
  /**
   * Every method's year-end figure, for the Projection tab's picker cards —
   * computed in the same pass as `method` above, not a separate query.
   */
  methodComparison: { method: ProjectionMethod; projectedYearEnd: number }[];
}

export interface YearComparisonColumn {
  year: number;
  totals: YearColumnTotals;
  average: YearColumnTotals;
  monthsWithData: number;
}

export interface YearComparisonDelta {
  fromYear: number;
  toYear: number;
  income: number;
  monthlyPayments: number;
  food: number;
  other: number;
  net: number;
  netPct: number | null; // % change in net; null when the prior year's net ≈ 0
}

export interface YearComparison {
  years: YearComparisonColumn[];
  deltas: YearComparisonDelta[]; // consecutive-year deltas
  netByYearMonth: Array<{ year: number; months: number[] }>; // 12 net values per year
}

/**
 * Category-name buckets for the year grid. Imported "Food"/"Monthly payments"
 * columns are aliased onto the household's default categories at commit time
 * (Food→Groceries, Monthly payments→Rent & Mortgage), so both spellings map to
 * the same display bucket here. Everything else falls into "other".
 */
const FOOD_CATEGORY_NAMES = new Set(['food', 'groceries']);
const MONTHLY_PAYMENT_CATEGORY_NAMES = new Set([
  'monthly payments',
  'rent & mortgage',
  'rent',
  'mortgage',
]);

export interface EmergencyFundSuggestion {
  suggestedTarget: number;
  essentialMonthlySpending: number;
  months: number;
  note?: string;
}

/** Enough of a tracked renewal to render the Monthly-Payments row pill — never the full record. */
export interface RecurringPaymentRenewalSummary {
  next_renewal_date: string;
  status: string;
  reminder_lead_days: number;
}

export interface RecurringPaymentsView {
  items: Array<
    RecurringPaymentWire & {
      renewal_summary?: RecurringPaymentRenewalSummary | null;
      loan_summary?: LoanSummary | null;
    }
  >;
  totalMonthlyCents: number;
  /** Sum of active income templates' amount — the saved recurring income per month. */
  savedMonthlyIncomeCents: number;
  byGroup: Array<{ group_label: string | null; subtotalCents: number }>;
}

/** One month's "already applied" snapshot for the apply-to-months grid. */
export interface RecurringApplyMonthStatus {
  /** 1–12. */
  month: number;
  /** True when this month already has ≥1 applied recurring-payment spend row. */
  applied: boolean;
  /** Sum of applied recurring-payment spend for the month (cents). */
  appliedCents: number;
  /** How many recurring payments are materialized into the month. */
  appliedCount: number;
  /**
   * True when the applied snapshot still equals the CURRENT active payments
   * (same count + same total). False ⇒ re-applying would add new/changed
   * payments, so the client flags the month as out-of-date.
   */
  matchesCurrent: boolean;
}

export interface RecurringApplyStatus {
  year: number;
  /** Active monthly-payment count a fresh apply would write. */
  currentCount: number;
  /** Active monthly-payment total a fresh apply would write (cents). */
  currentTotalCents: number;
  months: RecurringApplyMonthStatus[];
}

/** One recurring payment's per-month history for `year` — backs the Savings →
 * Monthly payment detail sheet's "which months apply" chart. */
export interface RecurringPaymentMonthlyHistory {
  year: number;
  /** Current amount — sizes a "skipped" ghost bar client-side. */
  amountCents: number;
  scopeType: 'all_year' | 'custom_months';
  months: Array<{
    /** 1–12. */
    month: number;
    /** isRecurringPaymentActiveInMonth(payment, year, month). */
    inScope: boolean;
    /** True when a savings_spending_entries row exists for period 'YYYY-MM'. */
    applied: boolean;
    /** Sum of that period's amount_cents; null when not applied. */
    appliedAmountCents: number | null;
  }>;
}

/** Every ACTIVE recurring payment's per-group totals for every month of
 * `year` — backs the Savings → Monthly tab's "distribution by month" chart. */
export interface RecurringYearlyGroupBreakdown {
  year: number;
  /** Every group that appears in ANY month this year, in a STABLE order
   * (named groups alphabetical, "Other" (null) always last) — so a group
   * keeps the same stack position/color across every month's bar. */
  groups: Array<{ group_label: string | null }>;
  months: Array<{
    /** 1–12. */
    month: number;
    totalCents: number;
    /** One entry per `groups`, in the SAME order — 0 for a month the group has nothing in. */
    byGroup: Array<{ group_label: string | null; subtotalCents: number }>;
  }>;
}

export type RegisteredAccountType = 'tfsa' | 'rrsp' | 'fhsa' | 'dpsp' | 'rpp';

export interface RegisteredRoom {
  accountId: string;
  accountType: RegisteredAccountType;
  year: number;
  roomRemaining: number;
  annualLimit: number;
  used: number;
  usedByKind: { regular: number; manual: number };
  usedByContributor: { self: number; employer: number };
  warnings: string[];
  /** Personal annual contribution goal (cents), or null when unset. */
  goalCents: number | null;
  goalContributedCents: number;
  goalRemainingCents: number;
  goalPct: number;
}

// ---- Pension overview (Pension tab, server-computed) ----

export interface PensionAccountSummary {
  account: RegisteredAccount;
  memberName: string | null;
  room: RegisteredRoom;
}

export interface PensionMemberGroup {
  memberId: string | null;
  memberName: string | null;
  /** Member's avatar URL (from users.avatar_url), null if none — for row avatars. */
  memberAvatarUrl: string | null;
  totalBalanceCents: number;
  accounts: PensionAccountSummary[];
}

export interface PensionOverview {
  year: number;
  totals: {
    totalBalanceCents: number;
    /** Σ room remaining across accounts that track room (excludes DC plans, whose "room" is a plan cap). */
    totalRoomRemainingCents: number;
    totalContributedSelfCents: number;
    totalContributedEmployerCents: number;
    goalCents: number;
    goalContributedCents: number;
    goalPct: number;
  };
  groups: PensionMemberGroup[];
  /** Distinct account-level warning codes surfaced for a banner (e.g. ROOM_OVER_CONTRIBUTION). */
  warnings: string[];
}

// Category defaults seeded on first `listCategories` call (plan Task 1.1).
interface SavingsDefaultCategory {
  name: string;
  icon: string;
  color: string;
  is_essential: boolean;
}

const DEFAULT_SAVINGS_CATEGORIES: SavingsDefaultCategory[] = [
  { name: 'Mortgage', icon: '🏠', color: '#3949AB', is_essential: true },
  { name: 'Condo Fee', icon: '🏢', color: '#5C6BC0', is_essential: true },
  { name: 'Utilities', icon: '💡', color: '#FFB300', is_essential: true },
  { name: 'Insurance', icon: '🛡️', color: '#546E7A', is_essential: true },
  { name: 'Property Tax', icon: '🧾', color: '#6D4C41', is_essential: true },
  { name: 'Home Improvement', icon: '🔨', color: '#EF6C00', is_essential: false },
  { name: 'Other', icon: '📦', color: '#90A4AE', is_essential: false },
];

/** Zero-pad a 1-2 digit number to two chars (month/day components). */
export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Compute [monthStart, monthEnd) window as 'YYYY-MM-DD' strings (monthEnd exclusive). */
export function monthWindow(year: number, month: number): { monthStart: string; monthEnd: string } {
  const monthStart = `${year}-${pad2(month)}-01`;
  const nextMonthYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const monthEnd = `${nextMonthYear}-${pad2(nextMonth)}-01`;
  return { monthStart, monthEnd };
}

export interface RecurringPaymentScope {
  scope_type: string;
  scope_year: number | null;
  active_months: string | null;
}

/**
 * Whether an ACTIVE recurring payment counts toward `year`/`month`. Scope only
 * ever narrows the ONE year it was configured for ('all_year', or a
 * 'custom_months' scope belonging to a different year, both run every month)
 * — a payment that started or ended mid-year doesn't repeat that gap next year.
 */
export function isRecurringPaymentActiveInMonth(
  payment: RecurringPaymentScope,
  year: number,
  month: number
): boolean {
  if (payment.scope_type !== 'custom_months' || payment.scope_year !== year) return true;
  if (!payment.active_months) return true;
  try {
    const months: unknown = JSON.parse(payment.active_months);
    return Array.isArray(months) && months.includes(month);
  } catch {
    return true;
  }
}

/** A recurring payment as it crosses the API boundary — `active_months` parsed
 * from its stored JSON string into a real array (same convention checklist-service
 * uses for its `photo_keys` JSON column). */
export type RecurringPaymentWire = Omit<SavingsRecurringPayment, 'active_months'> & {
  active_months: number[] | null;
};

function parseActiveMonths(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((m): m is number => typeof m === 'number') : null;
  } catch {
    return null;
  }
}

function toRecurringPaymentWire(row: SavingsRecurringPayment): RecurringPaymentWire {
  return { ...row, active_months: parseActiveMonths(row.active_months) };
}

/** Factory for route handlers — wires the default D1 repository implementation. */
export function createSavingsService(env: Env, d1: D1Database): SavingsService {
  return new SavingsService(env, d1);
}

export class SavingsService {
  private db: DrizzleD1Database;
  private repo: SavingsRepository;
  // Held for `API_URL` alone: member avatars are stored as bucket keys and the
  // URL is built per request by the Worker that owns the object
  // (`utils/avatar-url.ts`). Everything else here is D1.
  private env: Env;

  constructor(env: Env, d1: D1Database, repository?: SavingsRepository) {
    this.env = env;
    this.db = drizzle(d1);
    this.repo = repository ?? new D1SavingsRepository(d1);
  }

  // ============ ACCESS CHECK ============

  private async checkHouseholdAccess(householdId: string, userId: string): Promise<void> {
    const member = await this.db
      .select()
      .from(householdMembers)
      .where(
        and(eq(householdMembers.household_id, householdId), eq(householdMembers.user_id, userId))
      )
      .get();

    if (!member) {
      throw new ForbiddenError('You do not have access to this household');
    }
  }

  /**
   * IDOR guard for registered accounts: the `registered_transactions` FK is only
   * `account_id → registered_accounts`, so the `:householdId` URL param alone does
   * NOT scope it. Load the account and assert it belongs to the household. A member
   * of household A passing an account id from household B gets NOT_FOUND.
   */
  private async loadOwnedAccount(
    householdId: string,
    accountId: string
  ): Promise<RegisteredAccount> {
    const account = await this.db
      .select()
      .from(registeredAccounts)
      .where(eq(registeredAccounts.id, accountId))
      .get();

    if (!account || account.household_id !== householdId) {
      throw new NotFoundError('Registered account');
    }
    return account;
  }

  // ============ OVERVIEW ============

  async getOverview(
    householdId: string,
    userId: string,
    year: number,
    month: number
  ): Promise<SavingsOverview> {
    await this.checkHouseholdAccess(householdId, userId);

    const { monthStart, monthEnd } = monthWindow(year, month);

    // --- Current-month income (rows + grouped by source_type) ---
    const incomeEntries = await this.db
      .select()
      .from(savingsIncomeEntries)
      .where(
        and(
          eq(savingsIncomeEntries.household_id, householdId),
          gte(savingsIncomeEntries.income_date, monthStart),
          lt(savingsIncomeEntries.income_date, monthEnd)
        )
      )
      .orderBy(desc(savingsIncomeEntries.income_date))
      .limit(OVERVIEW_INCOME_ENTRIES_LIMIT)
      .all();

    let incomeTotal = 0;
    let incomeRegularTotal = 0;
    let incomeIrregularTotal = 0;
    const bySource: Record<string, number> = {};
    for (const row of incomeEntries) {
      incomeTotal += row.amount_cents;
      if (isIrregularIncomeSource(row.source_type)) {
        incomeIrregularTotal += row.amount_cents;
      } else {
        incomeRegularTotal += row.amount_cents;
      }
      bySource[row.source_type] = (bySource[row.source_type] ?? 0) + row.amount_cents;
    }

    // --- Monthly Payments: SUM of ACTIVE recurring payments scoped to THIS
    // month — a payment restricted to specific months of `year` only counts
    // toward months it's actually active in (see isRecurringPaymentActiveInMonth). ---
    const activeRecurring = await this.fetchActiveRecurringPayments(householdId);
    const monthlyPaymentsTotalFor = (m: number) =>
      activeRecurring
        .filter((p) => isRecurringPaymentActiveInMonth(p, year, m))
        .reduce((sum, p) => sum + p.amount_cents, 0);
    const monthlyPaymentsTotal = monthlyPaymentsTotalFor(month);

    // --- Spendings: THE single source of truth = Budget expenses this month
    // (SUM(expenses.amount); the column is `amount`, not amount_cents). This is
    // the exact figure the Budget "Spendings" tab and Dashboard "Spent" render,
    // so there is one spend number across every tab — no parallel spend store. ---
    const spendingsRow = await this.db
      .select({ total: sql<number>`COALESCE(SUM(${expenses.amount}), 0)` })
      .from(expenses)
      .where(
        and(
          eq(expenses.household_id, householdId),
          gte(expenses.expense_date, monthStart),
          lt(expenses.expense_date, monthEnd)
        )
      )
      .get();
    const budgetSpendings = spendingsRow?.total ?? 0;

    // Net savings = income − monthly payments − spendings. Deducted CONSISTENTLY
    // every month (no activity guard) so the same identity holds on every tab.
    const spendingTotal = monthlyPaymentsTotal + budgetSpendings;
    const netSavings = incomeTotal - spendingTotal;

    // --- YTD net (Jan..selected), same identity every month:
    //   net_m = income_m − monthlyPayments(scoped to m) − budgetSpendings_m
    // deducted CONSISTENTLY (no activity guard), matching the single-month view. ---
    const ytdStart = `${year}-01-01`;
    const [incomeByMonth, spendingsByMonth] = await Promise.all([
      this.db
        .select({
          ym: sql<string>`substr(${savingsIncomeEntries.income_date}, 1, 7)`,
          total: sql<number>`COALESCE(SUM(${savingsIncomeEntries.amount_cents}), 0)`,
        })
        .from(savingsIncomeEntries)
        .where(
          and(
            eq(savingsIncomeEntries.household_id, householdId),
            gte(savingsIncomeEntries.income_date, ytdStart),
            lt(savingsIncomeEntries.income_date, monthEnd)
          )
        )
        .groupBy(sql`substr(${savingsIncomeEntries.income_date}, 1, 7)`)
        .all(),
      this.db
        .select({
          ym: sql<string>`substr(${expenses.expense_date}, 1, 7)`,
          total: sql<number>`COALESCE(SUM(${expenses.amount}), 0)`,
        })
        .from(expenses)
        .where(
          and(
            eq(expenses.household_id, householdId),
            gte(expenses.expense_date, ytdStart),
            lt(expenses.expense_date, monthEnd)
          )
        )
        .groupBy(sql`substr(${expenses.expense_date}, 1, 7)`)
        .all(),
    ]);

    const incomeMap = new Map(incomeByMonth.map((r) => [r.ym, r.total]));
    const spendingsMap = new Map(spendingsByMonth.map((r) => [r.ym, r.total]));
    let ytdNet = 0;
    for (let m = 1; m <= month; m++) {
      const ym = `${year}-${pad2(m)}`;
      const inc = incomeMap.get(ym) ?? 0;
      // A past month with income logged but ZERO expenses is the signature of
      // a one-sided backfill (income imported without matching spend entries)
      // — not a household that genuinely spent nothing, so it's skipped
      // rather than counted as pure banked profit. A month with no income
      // either still gets its flat monthly-payment obligations deducted
      // (that bill is due whether or not anything else was logged), and the
      // month being viewed (m === month) always counts — it's a "so far"
      // figure, so no spending logged yet is expected.
      if (m < month && inc !== 0 && !spendingsMap.has(ym)) continue;
      ytdNet += inc - monthlyPaymentsTotalFor(m) - (spendingsMap.get(ym) ?? 0);
    }

    // --- Active goals — current_amount_cents overlaid with net savings accrued
    // since each goal's creation (see attachAccruedProgress), so this mirrors
    // exactly what the dedicated Goals tab (listGoals) and the Overview tab's
    // goals summary show for the same period. ---
    const activeGoalsRaw = await this.db
      .select()
      .from(savingsGoals)
      .where(
        and(eq(savingsGoals.household_id, householdId), eq(savingsGoals.status, 'active'))
      )
      .limit(OVERVIEW_ACTIVE_GOALS_LIMIT)
      .all();
    const activeGoals = await this.attachAccruedProgress(householdId, activeGoalsRaw, year, month);

    return {
      year,
      month,
      income: {
        total: incomeTotal,
        regularTotal: incomeRegularTotal,
        irregularTotal: incomeIrregularTotal,
        bySource,
        entries: incomeEntries,
      },
      spending: {
        total: spendingTotal,
        monthlyPayments: monthlyPaymentsTotal,
        spendings: budgetSpendings,
      },
      netSavings,
      ytdNet,
      goals: activeGoals.map((g) => ({
        id: g.id,
        name: g.name,
        type: g.type as 'emergency_fund' | 'custom',
        target: g.target_amount_cents,
        current: g.current_amount_cents,
        monthlyAllocation: g.monthly_allocation_cents ?? null,
      })),
    };
  }

  async getTrend(
    householdId: string,
    userId: string,
    year: number,
    month: number,
    months: number
  ): Promise<{ months: SavingsTrendPoint[] }> {
    await this.checkHouseholdAccess(householdId, userId);

    const span = Math.max(1, Math.min(60, Math.floor(months) || 1));

    // Anchor at the requested month, walk back `span` months (inclusive).
    // startWindow is the first day of the earliest month in the range.
    const anchorIndex = year * 12 + (month - 1);
    const startIndex = anchorIndex - (span - 1);
    const startYear = Math.floor(startIndex / 12);
    const startMonth = (startIndex % 12) + 1;
    const startWindow = `${startYear}-${pad2(startMonth)}-01`;
    const { monthEnd: endWindow } = monthWindow(year, month);

    // Single source of truth, per month: net_m = income_m − monthlyPayments(scoped to m)
    // − budgetSpendings_m. Spendings = SUM(expenses.amount) (the Budget Spendings
    // tab figure). Monthly payments deducted CONSISTENTLY every month (no
    // activity guard), matching getOverview.
    const [activeRecurring, incomeByMonth, spendingsByMonth] = await Promise.all([
      this.fetchActiveRecurringPayments(householdId),
      this.db
        .select({
          ym: sql<string>`substr(${savingsIncomeEntries.income_date}, 1, 7)`,
          total: sql<number>`COALESCE(SUM(${savingsIncomeEntries.amount_cents}), 0)`,
        })
        .from(savingsIncomeEntries)
        .where(
          and(
            eq(savingsIncomeEntries.household_id, householdId),
            gte(savingsIncomeEntries.income_date, startWindow),
            lt(savingsIncomeEntries.income_date, endWindow)
          )
        )
        .groupBy(sql`substr(${savingsIncomeEntries.income_date}, 1, 7)`)
        .all(),
      this.db
        .select({
          ym: sql<string>`substr(${expenses.expense_date}, 1, 7)`,
          total: sql<number>`COALESCE(SUM(${expenses.amount}), 0)`,
        })
        .from(expenses)
        .where(
          and(
            eq(expenses.household_id, householdId),
            gte(expenses.expense_date, startWindow),
            lt(expenses.expense_date, endWindow)
          )
        )
        .groupBy(sql`substr(${expenses.expense_date}, 1, 7)`)
        .all(),
    ]);

    const incomeMap = new Map(incomeByMonth.map((r) => [r.ym, r.total]));
    const spendingsMap = new Map(spendingsByMonth.map((r) => [r.ym, r.total]));

    const points: SavingsTrendPoint[] = [];
    for (let i = 0; i < span; i++) {
      const idx = startIndex + i;
      const y = Math.floor(idx / 12);
      const m = (idx % 12) + 1;
      const period = `${y}-${pad2(m)}`;
      const monthlyPaymentsTotal = activeRecurring
        .filter((p) => isRecurringPaymentActiveInMonth(p, y, m))
        .reduce((sum, p) => sum + p.amount_cents, 0);
      const income = incomeMap.get(period) ?? 0;
      const spendings = spendingsMap.get(period) ?? 0;
      const spending = monthlyPaymentsTotal + spendings;
      points.push({
        period,
        income,
        spending,
        monthlyPayments: monthlyPaymentsTotal,
        spendings,
        net: income - spending,
        hasExpenseData: spendingsMap.has(period),
      });
    }

    return { months: points };
  }

  // ============ PREVIOUS-YEARS HISTORY & COMPARISON ============

  /**
   * Years that have any income or spending data — drives the history/compare
   * year pickers and the empty state. Descending (newest first).
   */
  async getAvailableYears(householdId: string, userId: string): Promise<number[]> {
    await this.checkHouseholdAccess(householdId, userId);

    const [incomeYears, expenseYears] = await Promise.all([
      this.db
        .select({ y: sql<string>`substr(${savingsIncomeEntries.income_date}, 1, 4)` })
        .from(savingsIncomeEntries)
        .where(eq(savingsIncomeEntries.household_id, householdId))
        .groupBy(sql`substr(${savingsIncomeEntries.income_date}, 1, 4)`)
        .all(),
      this.db
        .select({ y: sql<string>`substr(${expenses.expense_date}, 1, 4)` })
        .from(expenses)
        .where(eq(expenses.household_id, householdId))
        .groupBy(sql`substr(${expenses.expense_date}, 1, 4)`)
        .all(),
    ]);

    const set = new Set<number>();
    for (const r of [...incomeYears, ...expenseYears]) {
      const y = Number(r.y);
      if (Number.isInteger(y) && y > 1900 && y < 4000) set.add(y);
    }
    return Array.from(set).sort((a, b) => b - a);
  }

  /**
   * A single year as the user's tracker grid: 12 months of income / monthly
   * payments / food / other / net, plus column totals, averages and goals.
   *
   * net_m = income_m − (monthlyPayments_m + food_m + other_m) — i.e.
   * income minus ALL spending that month, and `monthlyPayments_m` is the SAME
   * figure `getOverview`/`getTrend` use: the household's active recurring
   * payments (Loans & Debt, Subscriptions, …) scoped to `m` via
   * `isRecurringPaymentActiveInMonth` — PLUS any expense rows an import
   * aliased into a "Monthly payments"/"Rent & Mortgage" category (the
   * historical path, for years predating the recurring-payments feature).
   * Before this counted category-tagged expenses only, so a household that
   * tracks its loans/subscriptions purely through the dedicated feature (never
   * duplicating them as Budget expenses) saw NO monthly-payments deduction at
   * all here — net read as inflated and disagreed with `getTrend`/`getOverview`
   * for the exact months a real overspend should show as negative. Food/other
   * stay purely category-based; every bucket still sums to total spend.
   */
  async getYearHistory(householdId: string, userId: string, year: number): Promise<YearHistory> {
    await this.checkHouseholdAccess(householdId, userId);

    const start = `${year}-01-01`;
    const end = `${year + 1}-01-01`;

    const [incomeByMonth, expenseRows, activeRecurring] = await Promise.all([
      this.db
        .select({
          m: sql<string>`substr(${savingsIncomeEntries.income_date}, 6, 2)`,
          total: sql<number>`COALESCE(SUM(${savingsIncomeEntries.amount_cents}), 0)`,
        })
        .from(savingsIncomeEntries)
        .where(
          and(
            eq(savingsIncomeEntries.household_id, householdId),
            gte(savingsIncomeEntries.income_date, start),
            lt(savingsIncomeEntries.income_date, end)
          )
        )
        .groupBy(sql`substr(${savingsIncomeEntries.income_date}, 6, 2)`)
        .all(),
      this.db
        .select({
          m: sql<string>`substr(${expenses.expense_date}, 6, 2)`,
          catName: budgetCategories.name,
          total: sql<number>`COALESCE(SUM(${expenses.amount}), 0)`,
        })
        .from(expenses)
        .leftJoin(budgetCategories, eq(budgetCategories.id, expenses.category_id))
        .where(
          and(
            eq(expenses.household_id, householdId),
            gte(expenses.expense_date, start),
            lt(expenses.expense_date, end)
          )
        )
        .groupBy(sql`substr(${expenses.expense_date}, 6, 2)`, budgetCategories.name)
        .all(),
      this.fetchActiveRecurringPayments(householdId),
    ]);

    const incomeMap = new Map<number, number>();
    for (const r of incomeByMonth) incomeMap.set(Number(r.m), r.total);

    const foodMap = new Map<number, number>();
    const payMap = new Map<number, number>();
    const otherMap = new Map<number, number>();
    for (const r of expenseRows) {
      const mo = Number(r.m);
      if (!Number.isInteger(mo)) continue;
      const name = (r.catName ?? '').trim().toLowerCase();
      const bucket = FOOD_CATEGORY_NAMES.has(name)
        ? foodMap
        : MONTHLY_PAYMENT_CATEGORY_NAMES.has(name)
        ? payMap
        : otherMap;
      bucket.set(mo, (bucket.get(mo) ?? 0) + r.total);
    }

    const months: YearMonthlyRow[] = [];
    const totals: YearColumnTotals = {
      income: 0,
      monthlyPayments: 0,
      food: 0,
      other: 0,
      net: 0,
    };
    let monthsWithData = 0;
    for (let m = 1; m <= 12; m++) {
      const income = incomeMap.get(m) ?? 0;
      const recurringTotal = activeRecurring
        .filter((p) => isRecurringPaymentActiveInMonth(p, year, m))
        .reduce((sum, p) => sum + p.amount_cents, 0);
      const monthlyPayments = (payMap.get(m) ?? 0) + recurringTotal;
      const food = foodMap.get(m) ?? 0;
      const other = otherMap.get(m) ?? 0;
      const net = income - (monthlyPayments + food + other);
      months.push({ month: m, income, monthlyPayments, food, other, net });
      totals.income += income;
      totals.monthlyPayments += monthlyPayments;
      totals.food += food;
      totals.other += other;
      totals.net += net;
      if (income || monthlyPayments || food || other) monthsWithData++;
    }

    const divisor = Math.max(1, monthsWithData);
    const average: YearColumnTotals = {
      income: Math.round(totals.income / divisor),
      monthlyPayments: Math.round(totals.monthlyPayments / divisor),
      food: Math.round(totals.food / divisor),
      other: Math.round(totals.other / divisor),
      net: Math.round(totals.net / divisor),
    };

    const goals = await this.computeYearGoals(householdId, year);

    return { year, months, totals, average, monthsWithData, goals };
  }

  /**
   * Compare up to 5 years: per-year totals + averages, consecutive-year deltas
   * (with a null-guarded net %), and 12 net values per year for a grouped chart.
   */
  async compareYears(
    householdId: string,
    userId: string,
    years: number[]
  ): Promise<YearComparison> {
    await this.checkHouseholdAccess(householdId, userId);

    // Keep the 5 most recent requested years (ascending for chart/table order).
    const uniqueYears = Array.from(new Set(years.filter((y) => Number.isInteger(y))))
      .sort((a, b) => a - b)
      .slice(-5);

    const histories = await Promise.all(
      uniqueYears.map((y) => this.getYearHistory(householdId, userId, y))
    );

    const cols: YearComparisonColumn[] = histories.map((h) => ({
      year: h.year,
      totals: h.totals,
      average: h.average,
      monthsWithData: h.monthsWithData,
    }));

    const deltas: YearComparisonDelta[] = [];
    for (let i = 1; i < histories.length; i++) {
      const prev = histories[i - 1].totals;
      const cur = histories[i].totals;
      const netPct =
        prev.net !== 0 ? Math.round(((cur.net - prev.net) / Math.abs(prev.net)) * 100) : null;
      deltas.push({
        fromYear: histories[i - 1].year,
        toYear: histories[i].year,
        income: cur.income - prev.income,
        monthlyPayments: cur.monthlyPayments - prev.monthlyPayments,
        food: cur.food - prev.food,
        other: cur.other - prev.other,
        net: cur.net - prev.net,
        netPct,
      });
    }

    const netByYearMonth = histories.map((h) => ({
      year: h.year,
      months: h.months.map((m) => m.net),
    }));

    return { years: cols, deltas, netByYearMonth };
  }

  /**
   * Footer goals for a year grid. Savings goal comes from active savings_goals;
   * food/other monthly budgets come from budget_goals.category_budgets averaged
   * over the months that set them. Any goal not set returns null.
   */
  private async computeYearGoals(
    householdId: string,
    year: number
  ): Promise<YearHistoryGoals> {
    const activeGoals = await this.db
      .select()
      .from(savingsGoals)
      .where(and(eq(savingsGoals.household_id, householdId), eq(savingsGoals.status, 'active')))
      .limit(OVERVIEW_ACTIVE_GOALS_LIMIT)
      .all();

    let savingsMonthly: number | null = null;
    let savingsYearly: number | null = null;
    if (activeGoals.length) {
      const alloc = activeGoals.reduce((s, g) => s + (g.monthly_allocation_cents ?? 0), 0);
      savingsMonthly = alloc > 0 ? alloc : null;
      const targets = activeGoals.reduce((s, g) => s + (g.target_amount_cents ?? 0), 0);
      savingsYearly = targets > 0 ? targets : null;
    }

    // Per-category monthly budgets now come from budget_sub_budgets (source of
    // truth) with a fallback to the legacy budget_goals.category_budgets JSON for
    // categories without a row. Classify each category into food/pay/other, then
    // average food + other across the months that resolve a value. The tables are
    // read directly (not via BudgetService) to avoid a circular import.
    const cats = await this.db
      .select({ id: budgetCategories.id, name: budgetCategories.name })
      .from(budgetCategories)
      .where(eq(budgetCategories.household_id, householdId))
      .all();
    const bucketOf = (name: string): 'food' | 'pay' | 'other' => {
      const n = name.trim().toLowerCase();
      if (FOOD_CATEGORY_NAMES.has(n)) return 'food';
      if (MONTHLY_PAYMENT_CATEGORY_NAMES.has(n)) return 'pay';
      return 'other';
    };
    const catBucket = new Map<string, 'food' | 'pay' | 'other'>();
    for (const c of cats) catBucket.set(c.id, bucketOf(c.name));

    // Sub-budget rows for the year: recurring defaults (month NULL) + overrides.
    const subRows = await this.db
      .select()
      .from(budgetSubBudgets)
      .where(and(eq(budgetSubBudgets.household_id, householdId), eq(budgetSubBudgets.year, year)))
      .all();
    const defaultByCat = new Map<string, (typeof subRows)[number]>();
    const overrideByCatMonth = new Map<string, (typeof subRows)[number]>();
    for (const r of subRows) {
      if (r.month == null) defaultByCat.set(r.category_id, r);
      else overrideByCatMonth.set(`${r.category_id}:${r.month}`, r);
    }

    // Goal rows give each month's planned_budget (to resolve percent caps) and
    // the legacy JSON fallback.
    const goalRows = await this.db
      .select({
        month: budgetGoals.month,
        planned: budgetGoals.planned_budget,
        cb: budgetGoals.category_budgets,
      })
      .from(budgetGoals)
      .where(and(eq(budgetGoals.household_id, householdId), eq(budgetGoals.year, year)))
      .all();
    const plannedByMonth = new Map<number, number>();
    const legacyByMonth = new Map<number, Record<string, number>>();
    for (const row of goalRows) {
      if (row.month == null) continue;
      if (row.planned != null) plannedByMonth.set(row.month, row.planned);
      if (row.cb) {
        try {
          const parsed = JSON.parse(row.cb) as Record<string, unknown>;
          const map: Record<string, number> = {};
          for (const [id, raw] of Object.entries(parsed)) {
            const amt = typeof raw === 'number' ? raw : Number(raw);
            if (Number.isFinite(amt)) map[id] = amt;
          }
          legacyByMonth.set(row.month, map);
        } catch {
          // Malformed JSON — no legacy caps for this month.
        }
      }
    }

    // Resolve one row's cap for a month; percent caps need the month's total, so
    // they don't resolve (null) when no total is set.
    const resolveForMonth = (row: (typeof subRows)[number], planned: number): number | null => {
      if (row.limit_type === 'percent') {
        if (planned <= 0) return null;
        return Math.round((planned * (row.percent_bps ?? 0)) / 10000);
      }
      return row.amount_cents ?? 0;
    };

    let foodSum = 0;
    let foodCount = 0;
    let otherSum = 0;
    let otherCount = 0;
    for (let m = 1; m <= 12; m++) {
      const planned = plannedByMonth.get(m) ?? 0;
      const legacy = legacyByMonth.get(m) ?? {};
      let food = 0;
      let other = 0;
      let hasFood = false;
      let hasOther = false;
      for (const [catId, bucket] of catBucket) {
        if (bucket === 'pay') continue;
        const override = overrideByCatMonth.get(`${catId}:${m}`);
        const def = defaultByCat.get(catId);
        let cap: number | null = null;
        if (override) cap = resolveForMonth(override, planned);
        else if (def) cap = resolveForMonth(def, planned);
        else if (legacy[catId] != null) cap = legacy[catId];
        if (cap == null) continue;
        if (bucket === 'food') {
          food += cap;
          hasFood = true;
        } else {
          other += cap;
          hasOther = true;
        }
      }
      if (hasFood) {
        foodSum += food;
        foodCount++;
      }
      if (hasOther) {
        otherSum += other;
        otherCount++;
      }
    }

    const plannedBudgetByMonth: (number | null)[] = [];
    for (let m = 1; m <= 12; m++) {
      plannedBudgetByMonth.push(plannedByMonth.get(m) ?? null);
    }

    return {
      foodMonthly: foodCount ? Math.round(foodSum / foodCount) : null,
      otherMonthly: otherCount ? Math.round(otherSum / otherCount) : null,
      savingsMonthly,
      savingsYearly,
      plannedBudgetByMonth,
    };
  }

  // ============ PROJECTION ============

  /**
   * A whole year as "what happened" + "what you're aiming for": actual net for
   * every elapsed month, an editable target for the current + remaining ones,
   * and three year-end figures the UI contrasts to show the savings room.
   *
   * The month's actual net reuses `getYearHistory`, so the Projection tab can
   * never disagree with the Year history grid or the Overview trend — one
   * definition of net (income − ALL spending) for the whole feature.
   *
   * Year-end figures:
   *  - `projectedYearEnd` — banked + intent. Each remaining month contributes its
   *    target when set, and the current pace when not — a negative pace included,
   *    so a household on a persistent overspend sees the true (negative)
   *    trajectory instead of one silently floored at $0.
   *  - `paceYearEnd` — banked + `paceMonthly` × remaining. "Keep doing what
   *    you're doing," negative pace included.
   *  - `potentialYearEnd` — banked + `potentialMonthly` × remaining, where the
   *    stretch pace is the better of the recent pace and the household's OWN
   *    best completed month (never worse than `paceYearEnd`) — grounded in
   *    what they've actually achieved, never an invented number, and never
   *    artificially floored at $0 either.
   *
   * `paceMonthly` averages the RECENT_PACE_MONTHS most recent COMPLETED months
   * with data (a trailing window, not the whole year) — a household whose
   * savings jumped in the last quarter should see that trend, not have it
   * diluted by January. The current month is partially elapsed, so folding it
   * in would drag the pace down every 1st of the month; the window is only
   * used as a fallback when no completed month has data yet (i.e. in January,
   * or a household's first month).
   *
   * A future month with no explicit target projects, in order: the household's
   * standing monthly goal (active `savings_goals.monthly_allocation_cents`,
   * `SavingsProjection.monthlyGoal`) when one is set, else the recent pace.
   * Goals are the household's own stated intent, so they outrank a backward-
   * looking average when both are available.
   *
   * CRITICAL — every FORWARD-LOOKING figure (`paceMonthly`, `bestMonth`,
   * `potentialMonthly` and the pace an untargeted month projects at) is computed
   * from REPEATABLE net: the month's net MINUS its one-off income (marketplace
   * sales, gifts, bonuses…). A $20k inheritance in March is real money and stays
   * in `actualNet`, `actualToDate` and the chart — but extrapolating it into
   * "match your best month for the rest of the year" would set an impossible
   * target off a windfall. This is the constraint recorded in the Budget matrix
   * flag #13 ("if a real forecast is built later it must consume regular income,
   * not total"), and `oneOffIncome` is returned per month so the UI can say WHY a
   * spike month isn't the benchmark.
   *
   * Targets can be set on ANY month, including elapsed ones — a past target
   * never feeds the math (an elapsed month's `projectedNet` is always its real
   * `actualNet`), it only becomes the benchmark `goalHit` / `goalDeltaCents` /
   * `goalAttainmentPct` grade the real result against, and rolls up into
   * `goalPerformance` for the year.
   *
   * FOUR METHODS (`ProjectionMethod`) share every rule above — actual, current,
   * entered-ahead and explicit-target months are identical across all of them.
   * They only disagree on what an untargeted future month with no entered data
   * falls back to:
   *  - `historical_average` — flat `paceMonthly`. No goal override.
   *  - `trend` — the most recent completed month plus its average
   *    month-over-month change over the last `TREND_WINDOW_MONTHS` —
   *    continues the trajectory forward instead of averaging it away. Falls
   *    back to `paceMonthly` with fewer than 2 data points.
   *  - `planned_budget` — the household's own forward plan for that specific
   *    month: expected income (active `savings_income_templates`, or the
   *    recent income average when none are set) minus that month's active
   *    recurring payments minus that month's Planning-tab budget
   *    (`budget_goals.planned_budget`). Falls back to `paceMonthly` whole-month
   *    when any piece is unresolvable — never invents a number.
   *  - `hybrid` (the recommended default) — unchanged precedence: the
   *    household's standing savings goal still wins when one is set. Only when
   *    there's no goal either does it diverge from the old behavior: instead of
   *    bare pace, it blends `planned_budget`'s figure for that month with
   *    `paceMonthly`, weighted by how often the household has actually hit its
   *    OWN past targets (`goalPerformance.hitRatePct`, 50/50 with no track
   *    record) — a pure plan is optimistic, a pure average ignores a bill about
   *    to start or end, and this corrects for both. Degrades to exactly the old
   *    bare-pace behavior when `planned_budget` can't be resolved.
   *
   * `method` selects which one produces `months`/`projectedYearEnd` etc.;
   * omit it to use the household's stored default (`savings_projection_settings`,
   * absent row ⇒ `hybrid`). `methodComparison` reports all four year-end
   * figures in the same pass, for the Projection tab's picker cards.
   *
   * `now` is injectable so the elapsed/remaining split is testable without
   * faking the clock.
   */
  async getProjection(
    householdId: string,
    userId: string,
    year: number,
    now: Date = new Date(),
    method?: ProjectionMethod
  ): Promise<SavingsProjection> {
    // getYearHistory re-checks access; it is the only read that needs it.
    const history = await this.getYearHistory(householdId, userId, year);
    const resolvedMethod = method ?? (await this.getDefaultProjectionMethod(householdId));

    const nowYear = now.getUTCFullYear();
    const nowMonth = now.getUTCMonth() + 1;
    // null when the requested year is wholly in the past or wholly ahead.
    const currentMonth = year === nowYear ? nowMonth : null;

    const targetRows = await this.db
      .select()
      .from(savingsMonthlyTargets)
      .where(
        and(
          eq(savingsMonthlyTargets.household_id, householdId),
          like(savingsMonthlyTargets.period, `${year}-%`)
        )
      )
      .limit(12)
      .all();
    const targetByMonth = new Map<number, number>();
    for (const r of targetRows) {
      const m = Number(r.period.slice(5, 7));
      if (Number.isInteger(m) && m >= 1 && m <= 12) targetByMonth.set(m, r.target_cents);
    }

    // One-off income per month (gifts, bonuses, marketplace sales…). Subtracted
    // from net to get the REPEATABLE figure every forward projection rides on.
    const incomeBySourceMonth = await this.db
      .select({
        m: sql<string>`substr(${savingsIncomeEntries.income_date}, 6, 2)`,
        source: savingsIncomeEntries.source_type,
        total: sql<number>`COALESCE(SUM(${savingsIncomeEntries.amount_cents}), 0)`,
      })
      .from(savingsIncomeEntries)
      .where(
        and(
          eq(savingsIncomeEntries.household_id, householdId),
          gte(savingsIncomeEntries.income_date, `${year}-01-01`),
          lt(savingsIncomeEntries.income_date, `${year + 1}-01-01`)
        )
      )
      .groupBy(sql`substr(${savingsIncomeEntries.income_date}, 6, 2)`, savingsIncomeEntries.source_type)
      .all();
    const oneOffByMonth = new Map<number, number>();
    for (const r of incomeBySourceMonth) {
      if (!isIrregularIncomeSource(r.source)) continue;
      const m = Number(r.m);
      if (!Number.isInteger(m)) continue;
      oneOffByMonth.set(m, (oneOffByMonth.get(m) ?? 0) + r.total);
    }

    // Months the household has actually PUT SOMETHING IN — an income row or a
    // logged expense — as opposed to months that merely inherit a projection.
    //
    // Deliberately NOT `hasData` below: that folds in the recurring-payment
    // schedule, which lands on every future month by itself. A household with
    // recurring payments and no entries yet would look "filled in" for the whole
    // year ahead and each of those months would then project as its commitments
    // with none of its income — a year of large negatives.
    const enteredMonths = new Set<number>();
    for (const r of incomeBySourceMonth) {
      const m = Number(r.m);
      if (Number.isInteger(m)) enteredMonths.add(m);
    }
    const expenseMonthRows = await this.db
      .select({ m: sql<string>`substr(${expenses.expense_date}, 6, 2)` })
      .from(expenses)
      .where(
        and(
          eq(expenses.household_id, householdId),
          gte(expenses.expense_date, `${year}-01-01`),
          lt(expenses.expense_date, `${year + 1}-01-01`)
        )
      )
      .groupBy(sql`substr(${expenses.expense_date}, 6, 2)`)
      .all();
    const spendLoggedMonths = new Set<number>();
    for (const r of expenseMonthRows) {
      const m = Number(r.m);
      if (!Number.isInteger(m)) continue;
      enteredMonths.add(m);
      spendLoggedMonths.add(m);
    }

    const statusOf = (m: number): 'actual' | 'current' | 'future' => {
      if (year < nowYear) return 'actual';
      if (year > nowYear) return 'future';
      if (m < nowMonth) return 'actual';
      return m === nowMonth ? 'current' : 'future';
    };

    // Pass 1: classify + collect the completed-month sample the pace is built from.
    const rows = history.months.map((row) => {
      const status = statusOf(row.month);
      // A COMPLETED month needs spending actually LOGGED to count as real data
      // — income alone (e.g. a household that bulk-imported past income but
      // never logged that period's expenses) would otherwise look like pure
      // profit and skew the pace/best-month sample and the "banked" total. The
      // live current month is exempt: income arriving before the month's
      // spending is logged is normal, not a sign of missing data.
      const hasData =
        status === 'actual'
          ? row.monthlyPayments !== 0 || row.food !== 0 || row.other !== 0
          : row.income !== 0 || row.monthlyPayments !== 0 || row.food !== 0 || row.other !== 0;
      const oneOffIncome = oneOffByMonth.get(row.month) ?? 0;
      // What this month would have netted on repeatable income alone.
      return { row, status, hasData, oneOffIncome, repeatableNet: row.net - oneOffIncome };
    });

    const completedWithData = rows.filter((r) => r.status === 'actual' && r.hasData);
    // Trailing window: the pace should read the trend of the last few months,
    // not get dragged toward January by month 11. `rows` is already in
    // calendar order, so `.slice(-N)` keeps the most recent N with data.
    const paceSample = (
      completedWithData.length
        ? completedWithData
        : rows.filter((r) => r.status === 'current' && r.hasData)
    ).slice(-RECENT_PACE_MONTHS);
    const paceMonthly = paceSample.length
      ? Math.round(paceSample.reduce((s, r) => s + r.repeatableNet, 0) / paceSample.length)
      : 0;

    // The stretch anchor is the household's best COMPLETED month — never the
    // partial current one, which would understate it early in the month, and
    // measured on repeatable net so a windfall can't become the benchmark.
    let bestMonth: { month: number; net: number } | null = null;
    for (const r of completedWithData) {
      if (!bestMonth || r.repeatableNet > bestMonth.net) {
        bestMonth = { month: r.row.month, net: r.repeatableNet };
      }
    }
    const excludesOneOffIncome = completedWithData.some((r) => r.oneOffIncome !== 0);

    // A future month with no target still contributes the current pace, so the
    // projection is live before the household sets anything — including a
    // negative pace, so income − monthly payments − spendings (this month's
    // real net) reads as truthfully negative rather than being hidden at $0.
    const paceContribution = paceMonthly;
    const goals = history.goals;
    // The household's own standing goal outranks the backward-looking pace for
    // an untargeted future month — it's stated intent, not an average. Only
    // consulted by the `hybrid` method; the other three are "pure" and never
    // let a standing goal override their own formula.
    const monthlyGoalContribution =
      goals.savingsMonthly != null && goals.savingsMonthly > 0 ? goals.savingsMonthly : null;

    // Pre-pass: grade every elapsed/current month against its own target, if it
    // set one. Independent of which METHOD is selected (only actual/current
    // data + the stored target feed it), so it can run before the method
    // dispatch below and feed the `hybrid` method's reliability weight.
    // Negative/zero targets (a planned deficit month) skip the % — "-50% of a
    // -$1,000 goal" reads backwards — and rely on the hit/miss boolean, which
    // stays correct for a deficit (losing LESS than planned still hits).
    const gradeByMonth = new Map<
      number,
      { goalDeltaCents: number | null; goalAttainmentPct: number | null; goalHit: boolean | null }
    >();
    for (const { row, status } of rows) {
      const targetCents = targetByMonth.get(row.month) ?? null;
      if (status !== 'future' && targetCents != null) {
        gradeByMonth.set(row.month, {
          goalDeltaCents: row.net - targetCents,
          goalHit: row.net >= targetCents,
          goalAttainmentPct: targetCents > 0 ? Math.round((row.net / targetCents) * 100) : null,
        });
      } else {
        gradeByMonth.set(row.month, {
          goalDeltaCents: null,
          goalAttainmentPct: null,
          goalHit: null,
        });
      }
    }
    const trackedGrades = [...gradeByMonth.values()].filter((g) => g.goalHit != null);
    const monthsHit = trackedGrades.filter((g) => g.goalHit).length;
    const attainmentValues = trackedGrades
      .map((g) => g.goalAttainmentPct)
      .filter((v): v is number => v != null);
    const goalPerformance: SavingsGoalPerformance = {
      monthsTracked: trackedGrades.length,
      monthsHit,
      hitRatePct: trackedGrades.length
        ? Math.round((monthsHit / trackedGrades.length) * 100)
        : null,
      avgAttainmentPct: attainmentValues.length
        ? Math.round(attainmentValues.reduce((s, v) => s + v, 0) / attainmentValues.length)
        : null,
      medianAttainmentPct: medianAttainment(attainmentValues),
    };

    // ---- Method-specific building blocks (computed once, shared by all 4) ----

    // Trend: the most recent completed month PLUS the average month-over-month
    // change across the last TREND_WINDOW_MONTHS — continues the trajectory
    // forward rather than averaging it away (an average over a longer window,
    // even weighted, would pull a strong uptrend DOWN toward its older, lower
    // months — the opposite of what "trend" should mean). Needs ≥2 points to
    // have a delta to extrapolate; falls back to the flat pace with fewer.
    const trendSample = completedWithData.slice(-TREND_WINDOW_MONTHS);
    let trendMonthly = paceMonthly;
    if (trendSample.length >= 2) {
      let deltaSum = 0;
      for (let i = 1; i < trendSample.length; i++) {
        deltaSum += trendSample[i].repeatableNet - trendSample[i - 1].repeatableNet;
      }
      const avgDelta = deltaSum / (trendSample.length - 1);
      const mostRecent = trendSample[trendSample.length - 1].repeatableNet;
      trendMonthly = Math.round(mostRecent + avgDelta);
    }

    // Planned Budget: expected income (active recurring income templates, or
    // the recent repeatable-income average when none are set) minus that
    // month's active recurring payments minus that month's Planning-tab budget.
    const incomeTemplateRows = await this.db
      .select({ amount: savingsIncomeTemplates.amount_cents })
      .from(savingsIncomeTemplates)
      .where(
        and(
          eq(savingsIncomeTemplates.household_id, householdId),
          eq(savingsIncomeTemplates.active, true)
        )
      )
      .limit(LIST_INCOME_TEMPLATES_LIMIT)
      .all();
    const templatedIncomeMonthly = incomeTemplateRows.reduce((s, r) => s + r.amount, 0);
    const avgRecentIncome = completedWithData.length
      ? Math.round(
          completedWithData.reduce((s, r) => s + r.row.income, 0) / completedWithData.length
        )
      : 0;
    const expectedIncomeMonthly =
      templatedIncomeMonthly > 0 ? templatedIncomeMonthly : avgRecentIncome;

    const activeRecurring = await this.fetchActiveRecurringPayments(householdId);
    const activePaymentsFor = (m: number): number =>
      activeRecurring
        .filter((p) => isRecurringPaymentActiveInMonth(p, year, m))
        .reduce((s, p) => s + p.amount_cents, 0);

    // Null when unresolvable (no Planning-tab budget for that month, or no
    // income signal at all) — callers fall back to the pace rather than
    // inventing a number from a $0 expected income. The full breakdown (not
    // just the net) is kept so the Projection tab's Planned Budget / Smart
    // Blend explanations can show the household's OWN numbers — "$20,000
    // income − $10,000 payments − $2,000 goal" — not just the formula.
    const plannedBudgetFor = (m: number): SavingsProjectionMonth['plannedBudget'] => {
      const spendGoal = goals.plannedBudgetByMonth[m - 1] ?? null;
      if (spendGoal == null || expectedIncomeMonthly === 0) return null;
      const recurringPaymentsCents = activePaymentsFor(m);
      return {
        expectedIncomeCents: expectedIncomeMonthly,
        recurringPaymentsCents,
        spendingGoalCents: spendGoal,
        netCents: expectedIncomeMonthly - recurringPaymentsCents - spendGoal,
      };
    };

    // `hybrid`'s reliability weight: how often the household has actually hit
    // its OWN past targets. No track record yet → an even 50/50 blend.
    const blendWeight = Math.min(1, Math.max(0, (goalPerformance.hitRatePct ?? 50) / 100));

    /** The untargeted-future-month fallback for one method, value + why. */
    const fallbackFor = (
      projMethod: ProjectionMethod,
      m: number
    ): { value: number; source: 'goal' | 'pace' } => {
      if (projMethod === 'hybrid' && monthlyGoalContribution != null) {
        return { value: monthlyGoalContribution, source: 'goal' };
      }
      switch (projMethod) {
        case 'historical_average':
          return { value: paceMonthly, source: 'pace' };
        case 'trend':
          return { value: trendMonthly, source: 'pace' };
        case 'planned_budget': {
          const planned = plannedBudgetFor(m);
          return { value: planned?.netCents ?? paceMonthly, source: 'pace' };
        }
        case 'hybrid':
        default: {
          const planned = plannedBudgetFor(m);
          if (planned == null) return { value: paceMonthly, source: 'pace' };
          return {
            value: Math.round(planned.netCents * blendWeight + paceMonthly * (1 - blendWeight)),
            source: 'pace',
          };
        }
      }
    };

    /** One month's projected net + why, for whichever method is asked for. */
    const projectFor = (
      projMethod: ProjectionMethod,
      r: (typeof rows)[number]
    ): { value: number; source: SavingsProjectionMonth['projectionSource'] } => {
      const { row, status } = r;
      if (status === 'actual') return { value: row.net, source: null };
      const targetCents = targetByMonth.get(row.month) ?? null;
      if (status === 'current') {
        // Mid-month: you'll finish at least where you already are, and at the
        // target if you set one (targets below the actual are already beaten).
        return { value: targetCents != null ? Math.max(row.net, targetCents) : row.net, source: null };
      }
      if (enteredMonths.has(row.month)) {
        // DATA BEATS PLAN. A month ahead the household has already filled in is
        // forecast from those rows, not from a goal or plan set months earlier.
        return { value: row.net, source: 'entered' };
      }
      if (targetCents != null) return { value: targetCents, source: 'target' };
      return fallbackFor(projMethod, row.month);
    };

    /**
     * Same decision tree as `projectFor`, but for the method-comparison cards:
     * skips the explicit monthly-target override on future months, so the
     * four cards show what each method's own formula actually forecasts
     * rather than all four converging on whatever target the household
     * already typed in. Actual/current/entered months are real data, not a
     * method's guess, so those still win regardless of method.
     */
    const compareValueFor = (projMethod: ProjectionMethod, r: (typeof rows)[number]): number => {
      const { row, status } = r;
      if (status === 'actual' || status === 'current') return row.net;
      if (enteredMonths.has(row.month)) return row.net;
      return fallbackFor(projMethod, row.month).value;
    };

    const months: SavingsProjectionMonth[] = rows.map((r) => {
      const { row, status, hasData, oneOffIncome } = r;
      const targetCents = targetByMonth.get(row.month) ?? null;
      const { value: projectedNet, source: projectionSource } = projectFor(resolvedMethod, r);
      const grade = gradeByMonth.get(row.month)!;

      return {
        month: row.month,
        status,
        // A future month the household filled in HAS a real figure, so surface
        // it rather than the null that means "nothing recorded".
        actualNet:
          status === 'future' ? (projectionSource === 'entered' ? row.net : null) : row.net,
        targetCents,
        projectedNet,
        projectionSource,
        hasData,
        // Only meaningful on an 'entered' month ahead: its income is in but its
        // spending is not, so the figure reads better than the month will land.
        spendingLogged: spendLoggedMonths.has(row.month),
        oneOffIncome:
          status === 'future' && projectionSource !== 'entered' ? 0 : oneOffIncome,
        // Independent of `resolvedMethod` — the Planned Budget breakdown for
        // whichever month the UI wants to explain, even while viewing a
        // different method's numbers.
        plannedBudget: plannedBudgetFor(row.month),
        ...grade,
      };
    });

    // Completed months only count toward "banked" once they have real logged
    // spending (hasData) — an income-only month can't be trusted as pure
    // profit. The current month is always included: it's already framed as
    // "so far", so partial/no spending yet is expected, not missing data.
    const actualToDate = months
      .filter((m) => m.status === 'current' || (m.status === 'actual' && m.hasData))
      .reduce((s, m) => s + (m.actualNet ?? 0), 0);
    const futureMonths = months.filter((m) => m.status === 'future');
    const monthsRemaining = futureMonths.length;
    const monthsWithTarget = months.filter(
      (m) => m.status !== 'actual' && m.targetCents != null
    ).length;
    const targetedRemaining = months
      .filter((m) => m.status !== 'actual')
      .reduce((s, m) => s + (m.targetCents ?? 0), 0);

    // Year end = banked months + every forward month's projection. The current
    // month is counted ONCE, through its own projection (which already folds in
    // its actual), so it is excluded from the actual half of the sum here.
    const projectedYearEnd = months.reduce(
      (s, m) => s + (m.status === 'actual' ? (m.actualNet ?? 0) : m.projectedNet),
      0
    );

    // Every method's year-end figure, for the Projection tab's picker cards —
    // via `compareValueFor` so an explicit monthly target (which overrides
    // `months`/`projectedYearEnd` above for whichever method is selected)
    // doesn't flatten all four cards to the same number.
    const methodComparison = PROJECTION_METHODS.map((m) => ({
      method: m,
      projectedYearEnd: rows.reduce((s, r) => s + compareValueFor(m, r), 0),
    }));

    // The stretch case is the better of the recent pace and the best completed
    // month — never invented, and never worse than `paceMonthly` (so
    // `potentialYearEnd` can't fall below `paceYearEnd`). Not floored at $0:
    // a household whose best month was still a loss has no positive "potential"
    // to show, and pretending otherwise would misstate the real trajectory.
    const potentialMonthly = bestMonth ? Math.max(paceMonthly, bestMonth.net) : paceMonthly;

    return {
      year,
      currentMonth,
      months,
      actualToDate,
      targetedRemaining,
      monthsRemaining,
      monthsWithTarget,
      projectedYearEnd,
      paceMonthly,
      paceYearEnd: actualToDate + paceContribution * monthsRemaining,
      bestMonth,
      potentialMonthly,
      potentialYearEnd: actualToDate + potentialMonthly * monthsRemaining,
      excludesOneOffIncome,
      yearGoal: goals.savingsYearly,
      monthlyGoal: goals.savingsMonthly,
      goalPerformance,
      method: resolvedMethod,
      methodComparison,
    };
  }

  /** Resolve the household's stored default method, or `hybrid` absent a row. */
  private async getDefaultProjectionMethod(householdId: string): Promise<ProjectionMethod> {
    const row = await this.db
      .select({ default_method: savingsProjectionSettings.default_method })
      .from(savingsProjectionSettings)
      .where(eq(savingsProjectionSettings.household_id, householdId))
      .get();
    const stored = row?.default_method;
    return (PROJECTION_METHODS as readonly string[]).includes(stored ?? '')
      ? (stored as ProjectionMethod)
      : DEFAULT_PROJECTION_METHOD;
  }

  /**
   * Set the household-wide default Projection method (Home / widget / Watch
   * all read this). Upserted — most households never have a row until they
   * change it away from `hybrid` once.
   */
  async setDefaultProjectionMethod(
    householdId: string,
    userId: string,
    method: ProjectionMethod,
    year: number,
    nowDate: Date = new Date()
  ): Promise<SavingsProjection> {
    await this.checkHouseholdAccess(householdId, userId);

    await this.db
      .insert(savingsProjectionSettings)
      .values({
        household_id: householdId,
        default_method: method,
        updated_by: userId,
        updated_at: now(),
      })
      .onConflictDoUpdate({
        target: savingsProjectionSettings.household_id,
        set: { default_method: method, updated_by: userId, updated_at: now() },
      })
      .run();

    return this.getProjection(householdId, userId, year, nowDate, method);
  }

  /**
   * Set (or clear) the savings target on one or more months of a year. One call
   * backs both UI paths: tapping a single month, and "apply to every remaining
   * month" — the client just sends a longer `months` list.
   *
   * `targetCents === null` DELETES the rows: "no target" is the absence of a
   * row, distinct from a deliberate target of $0.
   */
  async setMonthlyTargets(
    householdId: string,
    userId: string,
    year: number,
    months: number[],
    targetCents: number | null,
    nowDate: Date = new Date()
  ): Promise<SavingsProjection> {
    await this.checkHouseholdAccess(householdId, userId);

    const unique = Array.from(new Set(months)).filter(
      (m) => Number.isInteger(m) && m >= 1 && m <= 12
    );
    if (!unique.length) {
      throw new ValidationError('Select at least one month to set a target on.');
    }

    const periods = unique.map((m) => `${year}-${pad2(m)}`);

    if (targetCents === null) {
      await this.db
        .delete(savingsMonthlyTargets)
        .where(
          and(
            eq(savingsMonthlyTargets.household_id, householdId),
            inArray(savingsMonthlyTargets.period, periods)
          )
        )
        .run();
      return this.getProjection(householdId, userId, year, nowDate);
    }

    const timestamp = now();
    for (const period of periods) {
      // Upsert on the (household, period) unique index from migration 0117 so a
      // re-apply overwrites rather than duplicating.
      await this.db
        .insert(savingsMonthlyTargets)
        .values({
          id: crypto.randomUUID(),
          household_id: householdId,
          period,
          target_cents: targetCents,
          created_by: userId,
          created_at: timestamp,
          updated_at: timestamp,
        })
        .onConflictDoUpdate({
          target: [savingsMonthlyTargets.household_id, savingsMonthlyTargets.period],
          set: { target_cents: targetCents, updated_at: timestamp },
        })
        .run();
    }

    return this.getProjection(householdId, userId, year, nowDate);
  }

  // ============ INCOME ============

  async listIncome(
    householdId: string,
    userId: string,
    year: number,
    month: number
  ): Promise<SavingsIncomeEntry[]> {
    await this.checkHouseholdAccess(householdId, userId);
    const { monthStart, monthEnd } = monthWindow(year, month);
    return this.repo.listIncomeEntries(householdId, monthStart, monthEnd);
  }

  async createIncome(
    householdId: string,
    userId: string,
    data: {
      id: string;
      member_id?: string | null;
      source_type: string;
      label: string;
      amount_cents: number;
      income_date: string;
      currency?: string | null;
      notes?: string | null;
    }
  ): Promise<SavingsIncomeEntry> {
    await this.checkHouseholdAccess(householdId, userId);

    // Idempotent (W2): client-provided id as PK + onConflictDoNothing. A duplicate
    // submit is a no-op; we then SELECT and return the existing row.
    await this.repo.insertIncomeEntry({
      id: data.id,
      household_id: householdId,
      member_id: data.member_id ?? null,
      source_type: data.source_type,
      label: data.label,
      amount_cents: data.amount_cents,
      income_date: data.income_date,
      currency: data.currency ?? 'CAD',
      notes: data.notes ?? null,
      created_by: userId,
    });

    return this.requireIncome(householdId, data.id);
  }

  async updateIncome(
    householdId: string,
    userId: string,
    id: string,
    data: Partial<{
      member_id: string | null;
      source_type: string;
      label: string;
      amount_cents: number;
      income_date: string;
      currency: string;
      notes: string | null;
    }>
  ): Promise<SavingsIncomeEntry> {
    await this.checkHouseholdAccess(householdId, userId);
    const existing = await this.requireIncome(householdId, id);

    const patch: Record<string, unknown> = { updated_at: now() };
    if (data.member_id !== undefined) patch.member_id = data.member_id;
    if (data.source_type !== undefined) patch.source_type = data.source_type;
    if (data.label !== undefined) patch.label = data.label;
    if (data.amount_cents !== undefined) patch.amount_cents = data.amount_cents;
    if (data.income_date !== undefined) patch.income_date = data.income_date;
    if (data.currency !== undefined) patch.currency = data.currency;
    if (data.notes !== undefined) patch.notes = data.notes;
    // Editing a still-draft rollover row and hitting Save IS confirming it —
    // no separate "Confirm" tap needed once the member has reviewed/adjusted it.
    if (existing.status === 'draft') patch.status = 'confirmed';

    await this.db
      .update(savingsIncomeEntries)
      .set(patch)
      .where(
        and(
          eq(savingsIncomeEntries.id, id),
          eq(savingsIncomeEntries.household_id, householdId)
        )
      );

    return this.requireIncome(householdId, id);
  }

  /** Confirm a draft (or already-confirmed) income row as-is, optionally patching fields in the same call. */
  async confirmIncome(
    householdId: string,
    userId: string,
    id: string,
    data: Partial<{
      member_id: string | null;
      source_type: string;
      label: string;
      amount_cents: number;
      income_date: string;
      currency: string;
      notes: string | null;
    }> = {}
  ): Promise<SavingsIncomeEntry> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.requireIncome(householdId, id);

    const patch: Record<string, unknown> = { status: 'confirmed', updated_at: now() };
    if (data.member_id !== undefined) patch.member_id = data.member_id;
    if (data.source_type !== undefined) patch.source_type = data.source_type;
    if (data.label !== undefined) patch.label = data.label;
    if (data.amount_cents !== undefined) patch.amount_cents = data.amount_cents;
    if (data.income_date !== undefined) patch.income_date = data.income_date;
    if (data.currency !== undefined) patch.currency = data.currency;
    if (data.notes !== undefined) patch.notes = data.notes;

    await this.db
      .update(savingsIncomeEntries)
      .set(patch)
      .where(
        and(
          eq(savingsIncomeEntries.id, id),
          eq(savingsIncomeEntries.household_id, householdId)
        )
      );

    return this.requireIncome(householdId, id);
  }

  /** Bulk-confirm every still-draft income row in one month — the banner's "Confirm all" action. */
  async confirmAllDraftIncome(
    householdId: string,
    userId: string,
    year: number,
    month: number
  ): Promise<{ confirmed: number }> {
    await this.checkHouseholdAccess(householdId, userId);
    const { monthStart, monthEnd } = monthWindow(year, month);

    const updated = await this.db
      .update(savingsIncomeEntries)
      .set({ status: 'confirmed', updated_at: now() })
      .where(
        and(
          eq(savingsIncomeEntries.household_id, householdId),
          eq(savingsIncomeEntries.status, 'draft'),
          gte(savingsIncomeEntries.income_date, monthStart),
          lt(savingsIncomeEntries.income_date, monthEnd)
        )
      )
      .returning({ id: savingsIncomeEntries.id });

    return { confirmed: updated.length };
  }

  async deleteIncome(householdId: string, userId: string, id: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.requireIncome(householdId, id);
    await this.db
      .delete(savingsIncomeEntries)
      .where(
        and(
          eq(savingsIncomeEntries.id, id),
          eq(savingsIncomeEntries.household_id, householdId)
        )
      );
  }

  private async requireIncome(householdId: string, id: string): Promise<SavingsIncomeEntry> {
    const row = await this.repo.getIncomeEntry(householdId, id);
    if (!row) throw new NotFoundError('Income entry');
    return row;
  }

  // ============ SPENDING ============

  async listSpending(
    householdId: string,
    userId: string,
    year: number,
    month: number
  ): Promise<SavingsSpendingEntry[]> {
    await this.checkHouseholdAccess(householdId, userId);
    const { monthStart, monthEnd } = monthWindow(year, month);
    return this.repo.listSpendingEntries(householdId, monthStart, monthEnd);
  }

  async createSpending(
    householdId: string,
    userId: string,
    data: {
      id: string;
      category_id?: string | null;
      label: string;
      amount_cents: number;
      spending_date: string;
      currency?: string | null;
      notes?: string | null;
    }
  ): Promise<SavingsSpendingEntry> {
    await this.checkHouseholdAccess(householdId, userId);

    await this.repo.insertSpendingEntry({
      id: data.id,
      household_id: householdId,
      category_id: data.category_id ?? null,
      label: data.label,
      amount_cents: data.amount_cents,
      spending_date: data.spending_date,
      currency: data.currency ?? 'CAD',
      notes: data.notes ?? null,
      created_by: userId,
    });

    return this.requireSpending(householdId, data.id);
  }

  async updateSpending(
    householdId: string,
    userId: string,
    id: string,
    data: Partial<{
      category_id: string | null;
      label: string;
      amount_cents: number;
      spending_date: string;
      currency: string;
      notes: string | null;
    }>
  ): Promise<SavingsSpendingEntry> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.requireSpending(householdId, id);

    const patch: SpendingEntryPatch = { updated_at: now() };
    if (data.category_id !== undefined) patch.category_id = data.category_id;
    if (data.label !== undefined) patch.label = data.label;
    if (data.amount_cents !== undefined) patch.amount_cents = data.amount_cents;
    if (data.spending_date !== undefined) patch.spending_date = data.spending_date;
    if (data.currency !== undefined) patch.currency = data.currency;
    if (data.notes !== undefined) patch.notes = data.notes;

    await this.repo.updateSpendingEntry(householdId, id, patch);

    return this.requireSpending(householdId, id);
  }

  async deleteSpending(householdId: string, userId: string, id: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.requireSpending(householdId, id);
    await this.repo.deleteSpendingEntry(householdId, id);
  }

  private async requireSpending(householdId: string, id: string): Promise<SavingsSpendingEntry> {
    const row = await this.repo.getSpendingEntry(householdId, id);
    if (!row) throw new NotFoundError('Spending entry');
    return row;
  }

  // ============ CATEGORIES ============

  async listCategories(householdId: string, userId: string): Promise<SavingsCategory[]> {
    await this.checkHouseholdAccess(householdId, userId);

    let categories = await this.db
      .select()
      .from(savingsCategories)
      .where(eq(savingsCategories.household_id, householdId))
      .orderBy(asc(savingsCategories.sort_order))
      .limit(LIST_CATEGORIES_LIMIT)
      .all();

    if (categories.length === 0) {
      // Seed 7 defaults (W3 race guard: UNIQUE(household_id, name) makes the
      // INSERT OR IGNORE idempotent under concurrent first-opens).
      const rows = DEFAULT_SAVINGS_CATEGORIES.map((def, i) => ({
        id: crypto.randomUUID(),
        household_id: householdId,
        name: def.name,
        icon: def.icon,
        color: def.color,
        is_essential: def.is_essential,
        sort_order: i,
      }));
      await this.db.insert(savingsCategories).values(rows).onConflictDoNothing();

      categories = await this.db
        .select()
        .from(savingsCategories)
        .where(eq(savingsCategories.household_id, householdId))
        .orderBy(asc(savingsCategories.sort_order))
        .limit(LIST_CATEGORIES_LIMIT)
        .all();
    }

    return categories;
  }

  async createCategory(
    householdId: string,
    userId: string,
    data: { name: string; icon?: string | null; color?: string | null; is_essential?: boolean }
  ): Promise<SavingsCategory> {
    await this.checkHouseholdAccess(householdId, userId);

    const existingCount = await this.db
      .select({ maxSort: sql<number>`COALESCE(MAX(${savingsCategories.sort_order}), -1)` })
      .from(savingsCategories)
      .where(eq(savingsCategories.household_id, householdId))
      .get();

    const id = crypto.randomUUID();
    await this.db
      .insert(savingsCategories)
      .values({
        id,
        household_id: householdId,
        name: data.name,
        icon: data.icon ?? null,
        color: data.color ?? null,
        is_essential: data.is_essential ?? false,
        sort_order: (existingCount?.maxSort ?? -1) + 1,
      })
      .onConflictDoNothing();

    // UNIQUE(household_id, name): if the name already existed, return that row.
    const row = await this.db
      .select()
      .from(savingsCategories)
      .where(
        and(
          eq(savingsCategories.household_id, householdId),
          eq(savingsCategories.name, data.name)
        )
      )
      .get();
    if (!row) throw new NotFoundError('Savings category');
    return row;
  }

  async updateCategory(
    householdId: string,
    userId: string,
    id: string,
    data: Partial<{ name: string; icon: string | null; color: string | null; is_essential: boolean }>
  ): Promise<SavingsCategory> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.requireCategory(householdId, id);

    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.icon !== undefined) patch.icon = data.icon;
    if (data.color !== undefined) patch.color = data.color;
    if (data.is_essential !== undefined) patch.is_essential = data.is_essential;

    if (Object.keys(patch).length > 0) {
      await this.db
        .update(savingsCategories)
        .set(patch)
        .where(
          and(eq(savingsCategories.id, id), eq(savingsCategories.household_id, householdId))
        );
    }

    return this.requireCategory(householdId, id);
  }

  async deleteCategory(householdId: string, userId: string, id: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.requireCategory(householdId, id);

    // Detach referencing spending rows first (mirror budget-service:431-436).
    await this.db
      .update(savingsSpendingEntries)
      .set({ category_id: null })
      .where(eq(savingsSpendingEntries.category_id, id));

    await this.db
      .delete(savingsCategories)
      .where(
        and(eq(savingsCategories.id, id), eq(savingsCategories.household_id, householdId))
      );
  }

  private async requireCategory(householdId: string, id: string): Promise<SavingsCategory> {
    const row = await this.db
      .select()
      .from(savingsCategories)
      .where(
        and(eq(savingsCategories.id, id), eq(savingsCategories.household_id, householdId))
      )
      .get();
    if (!row) throw new NotFoundError('Savings category');
    return row;
  }

  // ============ GOALS (Phase 2) ============

  async listGoals(
    householdId: string,
    userId: string
  ): Promise<Array<SavingsGoal & { paceCents: number }>> {
    await this.checkHouseholdAccess(householdId, userId);

    const goals = await this.repo.listGoals(householdId);
    const asOf = new Date();
    const withProgress = await this.attachAccruedProgress(
      householdId,
      goals,
      asOf.getUTCFullYear(),
      asOf.getUTCMonth() + 1
    );
    return withProgress.map((g) => ({ ...g, paceCents: this.computePaceCents(g) }));
  }

  /**
   * Overlays each goal's `current_amount_cents` (the manual base — starting
   * balance + explicit Budget→Transfer contributions) with net savings
   * (income − monthlyPayments − budgetSpendings) accrued every month since
   * the goal was created, through `asOfYear`/`asOfMonth`. Uses the same
   * "skip a past month with income logged but no expenses on record" backfill
   * guard as `getOverview`'s ytdNet so the two stay consistent. Intentionally
   * NOT split across multiple goals — each goal tracks the household's full
   * savings pace ("how much have I saved"), not an envelope allocation.
   */
  private async attachAccruedProgress(
    householdId: string,
    goals: SavingsGoal[],
    asOfYear: number,
    asOfMonth: number
  ): Promise<SavingsGoal[]> {
    if (goals.length === 0) return goals;

    const asOfYm = `${asOfYear}-${pad2(asOfMonth)}`;
    const earliestYm = goals.reduce((min, g) => {
      const ym = g.created_at.slice(0, 7);
      return ym < min ? ym : min;
    }, asOfYm);
    // Every goal was created after the period being viewed — nothing to accrue yet.
    if (earliestYm > asOfYm) return goals;

    const seriesStart = `${earliestYm}-01`;
    const { monthEnd } = monthWindow(asOfYear, asOfMonth);

    const activeRecurring = await this.fetchActiveRecurringPayments(householdId);
    const monthlyPaymentsTotalFor = (y: number, m: number) =>
      activeRecurring
        .filter((p) => isRecurringPaymentActiveInMonth(p, y, m))
        .reduce((sum, p) => sum + p.amount_cents, 0);

    const [incomeByMonth, spendingsByMonth] = await Promise.all([
      this.db
        .select({
          ym: sql<string>`substr(${savingsIncomeEntries.income_date}, 1, 7)`,
          total: sql<number>`COALESCE(SUM(${savingsIncomeEntries.amount_cents}), 0)`,
        })
        .from(savingsIncomeEntries)
        .where(
          and(
            eq(savingsIncomeEntries.household_id, householdId),
            gte(savingsIncomeEntries.income_date, seriesStart),
            lt(savingsIncomeEntries.income_date, monthEnd)
          )
        )
        .groupBy(sql`substr(${savingsIncomeEntries.income_date}, 1, 7)`)
        .all(),
      this.db
        .select({
          ym: sql<string>`substr(${expenses.expense_date}, 1, 7)`,
          total: sql<number>`COALESCE(SUM(${expenses.amount}), 0)`,
        })
        .from(expenses)
        .where(
          and(
            eq(expenses.household_id, householdId),
            gte(expenses.expense_date, seriesStart),
            lt(expenses.expense_date, monthEnd)
          )
        )
        .groupBy(sql`substr(${expenses.expense_date}, 1, 7)`)
        .all(),
    ]);
    const incomeMap = new Map(incomeByMonth.map((r) => [r.ym, r.total]));
    const spendingsMap = new Map(spendingsByMonth.map((r) => [r.ym, r.total]));

    return goals.map((g) => {
      const startYm = g.created_at.slice(0, 7);
      if (startYm > asOfYm) return g;

      let accrued = 0;
      let y = Number(startYm.slice(0, 4));
      let m = Number(startYm.slice(5, 7));
      let ym = `${y}-${pad2(m)}`;
      while (ym <= asOfYm) {
        const inc = incomeMap.get(ym) ?? 0;
        const isCurrent = ym === asOfYm;
        if (isCurrent || inc === 0 || spendingsMap.has(ym)) {
          accrued += inc - monthlyPaymentsTotalFor(y, m) - (spendingsMap.get(ym) ?? 0);
        }
        m += 1;
        if (m > 12) {
          m = 1;
          y += 1;
        }
        ym = `${y}-${pad2(m)}`;
      }

      return { ...g, current_amount_cents: Math.max(0, g.current_amount_cents + accrued) };
    });
  }

  /**
   * Pace = (target − current) / max(1, monthsRemaining), where `current` already
   * includes auto-accrued net savings (see `attachAccruedProgress`). No
   * `target_date` means there's no deadline to compute a required pace against
   * — returns 0 (hidden in the UI) rather than defaulting to "the whole
   * remaining target, due this month". A target_date in the past still clamps
   * to 1 month (catch up now). A fully-funded goal (current ≥ target) returns 0.
   */
  private computePaceCents(goal: SavingsGoal): number {
    if (goal.current_amount_cents >= goal.target_amount_cents) return 0;
    if (!goal.target_date) return 0;

    const target = Date.parse(`${goal.target_date}T00:00:00Z`);
    if (!Number.isFinite(target)) return 0;

    const now = Date.now();
    const msPerMonth = 30.44 * 86_400_000;
    let monthsRemaining = Math.ceil((target - now) / msPerMonth);
    if (!Number.isFinite(monthsRemaining) || monthsRemaining < 1) monthsRemaining = 1;

    const remaining = goal.target_amount_cents - goal.current_amount_cents;
    return Math.ceil(remaining / monthsRemaining);
  }

  async createGoal(
    householdId: string,
    userId: string,
    data: {
      id: string;
      type: string;
      name: string;
      target_amount_cents: number;
      current_amount_cents?: number;
      target_date?: string | null;
      months_of_expenses?: number | null;
      monthly_allocation_cents?: number | null;
    }
  ): Promise<SavingsGoal> {
    await this.checkHouseholdAccess(householdId, userId);

    await this.db
      .insert(savingsGoals)
      .values({
        id: data.id,
        household_id: householdId,
        type: data.type,
        name: data.name,
        target_amount_cents: data.target_amount_cents,
        current_amount_cents: data.current_amount_cents ?? 0,
        target_date: data.target_date ?? null,
        months_of_expenses: data.months_of_expenses ?? null,
        monthly_allocation_cents: data.monthly_allocation_cents ?? null,
      })
      .onConflictDoNothing();

    return this.requireGoal(householdId, data.id);
  }

  async updateGoal(
    householdId: string,
    userId: string,
    id: string,
    data: Partial<{
      type: string;
      name: string;
      target_amount_cents: number;
      current_amount_cents: number;
      target_date: string | null;
      months_of_expenses: number | null;
      monthly_allocation_cents: number | null;
      status: string;
    }>
  ): Promise<SavingsGoal> {
    await this.checkHouseholdAccess(householdId, userId);
    const existing = await this.requireGoal(householdId, id);

    const patch: Record<string, unknown> = { updated_at: now() };
    if (data.type !== undefined) patch.type = data.type;
    if (data.name !== undefined) patch.name = data.name;
    if (data.target_amount_cents !== undefined) patch.target_amount_cents = data.target_amount_cents;
    if (data.current_amount_cents !== undefined) patch.current_amount_cents = data.current_amount_cents;
    if (data.target_date !== undefined) patch.target_date = data.target_date;
    if (data.months_of_expenses !== undefined) patch.months_of_expenses = data.months_of_expenses;
    if (data.monthly_allocation_cents !== undefined) {
      patch.monthly_allocation_cents = data.monthly_allocation_cents;
    }
    if (data.status !== undefined) patch.status = data.status;

    // Auto-flip to 'achieved' once fully funded (unless the caller set status explicitly).
    if (data.status === undefined) {
      const nextTarget = data.target_amount_cents ?? existing.target_amount_cents;
      const nextCurrent = data.current_amount_cents ?? existing.current_amount_cents;
      if (existing.status === 'active' && nextCurrent >= nextTarget) {
        patch.status = 'achieved';
      }
    }

    await this.db
      .update(savingsGoals)
      .set(patch)
      .where(and(eq(savingsGoals.id, id), eq(savingsGoals.household_id, householdId)));

    return this.requireGoal(householdId, id);
  }

  async deleteGoal(householdId: string, userId: string, id: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.requireGoal(householdId, id);
    await this.db
      .delete(savingsGoals)
      .where(and(eq(savingsGoals.id, id), eq(savingsGoals.household_id, householdId)));
  }

  private async requireGoal(householdId: string, id: string): Promise<SavingsGoal> {
    const row = await this.db
      .select()
      .from(savingsGoals)
      .where(and(eq(savingsGoals.id, id), eq(savingsGoals.household_id, householdId)))
      .get();
    if (!row) throw new NotFoundError('Savings goal');
    return row;
  }

  /**
   * Emergency-fund suggestion = essentialMonthlySpending × months.
   * essentialMonthlySpending averages, over min(3, monthsWithAnyData) trailing months,
   * BOTH (a) savings_spending joined to essential categories AND (b) the
   * Home-from-Budget rollup (SUM expenses.amount). Divide-by-zero guard (W7).
   */
  async getEmergencyFundSuggestion(
    householdId: string,
    userId: string,
    months: number
  ): Promise<EmergencyFundSuggestion> {
    await this.checkHouseholdAccess(householdId, userId);

    const monthsCount = Math.max(1, Math.floor(months) || 1);

    // Trailing 3-month window ending at the end of the current UTC month.
    const now = new Date();
    const curYear = now.getUTCFullYear();
    const curMonth = now.getUTCMonth() + 1; // 1-based
    const anchorIndex = curYear * 12 + (curMonth - 1);
    const startIndex = anchorIndex - 2; // 3 months inclusive
    const startYear = Math.floor(startIndex / 12);
    const startMonth = (startIndex % 12) + 1;
    const startWindow = `${startYear}-${pad2(startMonth)}-01`;
    const { monthEnd: endWindow } = monthWindow(curYear, curMonth);

    // (a) essential savings-spending grouped by month.
    const essentialByMonth = await this.db
      .select({
        ym: sql<string>`substr(${savingsSpendingEntries.spending_date}, 1, 7)`,
        total: sql<number>`COALESCE(SUM(${savingsSpendingEntries.amount_cents}), 0)`,
      })
      .from(savingsSpendingEntries)
      .innerJoin(
        savingsCategories,
        eq(savingsSpendingEntries.category_id, savingsCategories.id)
      )
      .where(
        and(
          eq(savingsSpendingEntries.household_id, householdId),
          eq(savingsCategories.is_essential, true),
          gte(savingsSpendingEntries.spending_date, startWindow),
          lt(savingsSpendingEntries.spending_date, endWindow)
        )
      )
      .groupBy(sql`substr(${savingsSpendingEntries.spending_date}, 1, 7)`)
      .all();

    // (b) Home-from-Budget rollup grouped by month (Model A households).
    const homeByMonth = await this.db
      .select({
        ym: sql<string>`substr(${expenses.expense_date}, 1, 7)`,
        total: sql<number>`COALESCE(SUM(${expenses.amount}), 0)`,
      })
      .from(expenses)
      .where(
        and(
          eq(expenses.household_id, householdId),
          gte(expenses.expense_date, startWindow),
          lt(expenses.expense_date, endWindow)
        )
      )
      .groupBy(sql`substr(${expenses.expense_date}, 1, 7)`)
      .all();

    // Combine per-month totals; count months that have ANY data.
    const perMonth = new Map<string, number>();
    for (const r of essentialByMonth) perMonth.set(r.ym, (perMonth.get(r.ym) ?? 0) + r.total);
    for (const r of homeByMonth) perMonth.set(r.ym, (perMonth.get(r.ym) ?? 0) + r.total);

    const monthsWithAnyData = perMonth.size;
    const denominator = Math.min(3, monthsWithAnyData);

    if (denominator === 0) {
      return {
        suggestedTarget: 0,
        essentialMonthlySpending: 0,
        months: monthsCount,
        note: 'NO_HISTORY',
      };
    }

    const totalEssential = Array.from(perMonth.values()).reduce((sum, v) => sum + v, 0);
    const essentialMonthlySpending = Math.round(totalEssential / denominator);
    const suggestedTarget = essentialMonthlySpending * monthsCount;

    return { suggestedTarget, essentialMonthlySpending, months: monthsCount };
  }

  // ============ REGISTERED ACCOUNTS (Phase 3) ============

  async listAccounts(householdId: string, userId: string): Promise<RegisteredAccount[]> {
    await this.checkHouseholdAccess(householdId, userId);
    return this.db
      .select()
      .from(registeredAccounts)
      .where(eq(registeredAccounts.household_id, householdId))
      .orderBy(desc(registeredAccounts.created_at))
      .all();
  }

  async createAccount(
    householdId: string,
    userId: string,
    data: {
      id: string;
      member_id?: string | null;
      account_type: string;
      institution?: string | null;
      is_employer_plan?: boolean;
      employer_name?: string | null;
      balance_cents?: number;
      starting_room_cents?: number | null;
      annual_limit_override_cents?: number | null;
      regular_contribution_cents?: number | null;
      annual_goal_cents?: number | null;
      room_as_of_date?: string | null;
      prior_earned_income_cents?: number | null;
      pension_adjustment_cents?: number | null;
    }
  ): Promise<RegisteredAccount> {
    await this.checkHouseholdAccess(householdId, userId);

    await this.db
      .insert(registeredAccounts)
      .values({
        id: data.id,
        household_id: householdId,
        member_id: data.member_id ?? null,
        account_type: data.account_type,
        institution: data.institution ?? null,
        is_employer_plan: data.is_employer_plan ?? false,
        employer_name: data.employer_name ?? null,
        balance_cents: data.balance_cents ?? 0,
        starting_room_cents: data.starting_room_cents ?? null,
        annual_limit_override_cents: data.annual_limit_override_cents ?? null,
        regular_contribution_cents: data.regular_contribution_cents ?? null,
        annual_goal_cents: data.annual_goal_cents ?? null,
        room_as_of_date: data.room_as_of_date ?? null,
        prior_earned_income_cents: data.prior_earned_income_cents ?? null,
        pension_adjustment_cents: data.pension_adjustment_cents ?? null,
      })
      .onConflictDoNothing();

    return this.loadOwnedAccount(householdId, data.id);
  }

  async updateAccount(
    householdId: string,
    userId: string,
    accountId: string,
    data: Partial<{
      member_id: string | null;
      account_type: string;
      institution: string | null;
      is_employer_plan: boolean;
      employer_name: string | null;
      balance_cents: number;
      starting_room_cents: number | null;
      annual_limit_override_cents: number | null;
      regular_contribution_cents: number | null;
      annual_goal_cents: number | null;
      room_as_of_date: string | null;
      prior_earned_income_cents: number | null;
      pension_adjustment_cents: number | null;
    }>
  ): Promise<RegisteredAccount> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.loadOwnedAccount(householdId, accountId); // IDOR guard

    const patch: Record<string, unknown> = { updated_at: now() };
    if (data.member_id !== undefined) patch.member_id = data.member_id;
    if (data.account_type !== undefined) patch.account_type = data.account_type;
    if (data.institution !== undefined) patch.institution = data.institution;
    if (data.is_employer_plan !== undefined) patch.is_employer_plan = data.is_employer_plan;
    if (data.employer_name !== undefined) patch.employer_name = data.employer_name;
    if (data.annual_goal_cents !== undefined) patch.annual_goal_cents = data.annual_goal_cents;
    if (data.balance_cents !== undefined) patch.balance_cents = data.balance_cents;
    if (data.starting_room_cents !== undefined) patch.starting_room_cents = data.starting_room_cents;
    if (data.annual_limit_override_cents !== undefined) {
      patch.annual_limit_override_cents = data.annual_limit_override_cents;
    }
    if (data.regular_contribution_cents !== undefined) {
      patch.regular_contribution_cents = data.regular_contribution_cents;
    }
    if (data.room_as_of_date !== undefined) patch.room_as_of_date = data.room_as_of_date;
    if (data.prior_earned_income_cents !== undefined) {
      patch.prior_earned_income_cents = data.prior_earned_income_cents;
    }
    if (data.pension_adjustment_cents !== undefined) {
      patch.pension_adjustment_cents = data.pension_adjustment_cents;
    }

    await this.db
      .update(registeredAccounts)
      .set(patch)
      .where(
        and(
          eq(registeredAccounts.id, accountId),
          eq(registeredAccounts.household_id, householdId)
        )
      );

    return this.loadOwnedAccount(householdId, accountId);
  }

  async deleteAccount(householdId: string, userId: string, accountId: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.loadOwnedAccount(householdId, accountId); // IDOR guard
    // registered_transactions FK is ON DELETE CASCADE, so child rows go with it.
    await this.db
      .delete(registeredAccounts)
      .where(
        and(
          eq(registeredAccounts.id, accountId),
          eq(registeredAccounts.household_id, householdId)
        )
      );
  }

  /**
   * Pension simple flow — set a household member's pension "line" (RRSP/TFSA) WITHOUT
   * creating a full account: the contribution room, an annual goal (amount OR % of room),
   * an automated recurring monthly contribution, and an automatic employer match. One row
   * per (member, account_type): an existing REAL account is preferred and edited in place;
   * otherwise a lightweight room-only placeholder row is created/updated. Fields are PATCH
   * semantics — `undefined` leaves a field unchanged, `0`/`null` clears it. A bare row with
   * nothing set AND no transactions is deleted. Reuses the CRA room/goal engine. Returns
   * the affected account, or null when cleared/no-op.
   */
  async upsertMemberLine(
    householdId: string,
    userId: string,
    data: {
      memberId: string;
      accountType: 'tfsa' | 'rrsp';
      roomCents?: number | null;
      goalCents?: number | null;
      goalPct?: number | null;
      regularContributionCents?: number | null;
      employerMatchCents?: number | null;
    }
  ): Promise<RegisteredAccount | null> {
    await this.checkHouseholdAccess(householdId, userId);

    if (data.accountType !== 'tfsa' && data.accountType !== 'rrsp') {
      throw new ValidationError({ account_type: ['Member line supports only tfsa and rrsp'] });
    }

    // Verify the member belongs to this household (IDOR guard).
    const member = await this.db
      .select({ id: householdMembers.id })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.id, data.memberId),
          eq(householdMembers.household_id, householdId)
        )
      )
      .get();
    if (!member) throw new NotFoundError('Household member');

    // One row per (member, type): prefer an existing REAL account (is_room_only=false
    // sorts first) so its line is edited in place rather than duplicated.
    const existing = await this.db
      .select()
      .from(registeredAccounts)
      .where(
        and(
          eq(registeredAccounts.household_id, householdId),
          eq(registeredAccounts.member_id, data.memberId),
          eq(registeredAccounts.account_type, data.accountType)
        )
      )
      .orderBy(asc(registeredAccounts.is_room_only), asc(registeredAccounts.created_at))
      .get();

    // Positive → set; undefined → unchanged; 0/null → clear.
    const norm = (v: number | null | undefined): number | null => (v == null || v <= 0 ? null : v);

    // Effective post-patch values (merge patch over existing).
    const effRoom =
      data.roomCents !== undefined ? norm(data.roomCents) : existing?.starting_room_cents ?? null;

    // Goal is amount OR % — mutually exclusive. Editing either field re-resolves both.
    let effGoalCents = existing?.annual_goal_cents ?? null;
    let effGoalPct = existing?.annual_goal_pct ?? null;
    if (data.goalPct !== undefined || data.goalCents !== undefined) {
      const pct = norm(data.goalPct);
      const cents = norm(data.goalCents);
      if (pct != null) {
        effGoalPct = Math.min(100, pct);
        effGoalCents = null;
      } else if (cents != null) {
        effGoalCents = cents;
        effGoalPct = null;
      } else {
        effGoalCents = null;
        effGoalPct = null;
      }
    }

    // Automated recurring + employer match + backfill anchor are exclusive to simple
    // (room-only) lines. A REAL account keeps its own regular_contribution_cents on the
    // full-form + manual apply-regular flow — this path never stamps an anchor on it (so
    // materializeRecurring never auto-generates for real accounts).
    const isRoomOnly = existing ? existing.is_room_only : true;
    const effRegular = isRoomOnly
      ? data.regularContributionCents !== undefined
        ? norm(data.regularContributionCents)
        : existing?.regular_contribution_cents ?? null
      : existing?.regular_contribution_cents ?? null;
    const effMatch = isRoomOnly
      ? data.employerMatchCents !== undefined
        ? norm(data.employerMatchCents)
        : existing?.employer_match_cents ?? null
      : existing?.employer_match_cents ?? null;

    // Recurring anchor: stamp the current month when recurring first turns on; clear when off.
    const recurringActive = isRoomOnly && (effRegular != null || effMatch != null);
    const asOf = new Date();
    const currentMonth = `${asOf.getUTCFullYear()}-${pad2(asOf.getUTCMonth() + 1)}`;
    const effStartMonth = isRoomOnly
      ? recurringActive
        ? existing?.recurring_start_month ?? currentMonth
        : null
      : existing?.recurring_start_month ?? null;

    const hasAnything =
      effRoom != null ||
      effGoalCents != null ||
      effGoalPct != null ||
      effRegular != null ||
      effMatch != null;

    if (existing) {
      // A bare room-only line with nothing configured AND no transactions is removed.
      if (!hasAnything && existing.is_room_only) {
        const txCount = await this.db
          .select({ id: registeredTransactions.id })
          .from(registeredTransactions)
          .where(eq(registeredTransactions.account_id, existing.id))
          .all();
        if (txCount.length === 0) {
          await this.db
            .delete(registeredAccounts)
            .where(
              and(
                eq(registeredAccounts.id, existing.id),
                eq(registeredAccounts.household_id, householdId)
              )
            );
          return null;
        }
      }
      await this.db
        .update(registeredAccounts)
        .set({
          starting_room_cents: effRoom,
          annual_goal_cents: effGoalCents,
          annual_goal_pct: effGoalPct,
          regular_contribution_cents: effRegular,
          employer_match_cents: effMatch,
          recurring_start_month: effStartMonth,
          updated_at: now(),
        })
        .where(
          and(
            eq(registeredAccounts.id, existing.id),
            eq(registeredAccounts.household_id, householdId)
          )
        );
      return this.loadOwnedAccount(householdId, existing.id);
    }

    // No row yet, and nothing to set — no-op.
    if (!hasAnything) return null;

    // Create a room-only line carrying the configured fields.
    const id = crypto.randomUUID();
    await this.db.insert(registeredAccounts).values({
      id,
      household_id: householdId,
      member_id: data.memberId,
      account_type: data.accountType,
      is_room_only: true,
      balance_cents: 0,
      starting_room_cents: effRoom,
      annual_goal_cents: effGoalCents,
      annual_goal_pct: effGoalPct,
      regular_contribution_cents: effRegular,
      employer_match_cents: effMatch,
      recurring_start_month: effStartMonth,
    });
    return this.loadOwnedAccount(householdId, id);
  }

  /**
   * Pension simple flow — add a MANUAL contribution to a member's line (RRSP/TFSA)
   * without a full account. Upserts the line if it doesn't exist yet, then records a
   * `kind:'manual'` contribution (self or employer) and moves the balance. Reuses the
   * same room/goal engine as everything else. Returns the line + the new transaction.
   */
  async addMemberContribution(
    householdId: string,
    userId: string,
    data: {
      /** Client-supplied transaction id → idempotent on retry/double-tap. */
      id?: string;
      memberId: string;
      accountType: 'tfsa' | 'rrsp';
      amountCents: number;
      contributor?: 'self' | 'employer';
      /**
       * Optional employer-match portion recorded alongside the primary (self) amount, so a
       * single "add contribution" action can log both the member's and the employer's share
       * atomically. Ignored (or 0) means a plain single-funder contribution.
       */
      employerAmountCents?: number;
      transactionDate?: string;
    }
  ): Promise<{ account: RegisteredAccount; transaction: RegisteredTransaction }> {
    if (data.amountCents <= 0) {
      throw new ValidationError({ amount_cents: ['Contribution must be greater than zero'] });
    }
    const employerAmountCents = data.employerAmountCents ?? 0;
    if (employerAmountCents < 0) {
      throw new ValidationError({ employer_amount_cents: ['Employer amount cannot be negative'] });
    }
    // Ensure the line exists (also runs access + member + type guards).
    let account = await this.upsertMemberLine(householdId, userId, {
      memberId: data.memberId,
      accountType: data.accountType,
    });
    if (!account) {
      // No line yet and upsert was a no-op — create a bare room-only line to attach to.
      const id = crypto.randomUUID();
      await this.db.insert(registeredAccounts).values({
        id,
        household_id: householdId,
        member_id: data.memberId,
        account_type: data.accountType,
        is_room_only: true,
        balance_cents: 0,
      });
      account = await this.loadOwnedAccount(householdId, id);
    }

    const asOf = new Date();
    const transaction_date =
      data.transactionDate ?? `${asOf.getUTCFullYear()}-${pad2(asOf.getUTCMonth() + 1)}-${pad2(asOf.getUTCDate())}`;

    const tax_year = Number(transaction_date.substring(0, 4));

    // Idempotent on a client-supplied id: a retried or double-tapped submit inserts
    // nothing the second time and leaves the balance untouched (mirrors every other
    // create path in this service). No id → a fresh uuid (legacy, non-idempotent).
    const transactionId = data.id ?? crypto.randomUUID();
    const inserted = await this.db
      .insert(registeredTransactions)
      .values({
        id: transactionId,
        account_id: account.id,
        type: 'contribution',
        kind: 'manual',
        contributor: data.contributor ?? 'self',
        amount_cents: data.amountCents,
        transaction_date,
        tax_year,
        created_by: userId,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted.length === 0) {
      // Duplicate submit — the contribution and its balance effect are already
      // recorded. Return the current account + the existing transaction untouched.
      const existingTx = await this.db
        .select()
        .from(registeredTransactions)
        .where(eq(registeredTransactions.id, transactionId))
        .get();
      const current = await this.loadOwnedAccount(householdId, account.id);
      return { account: current, transaction: existingTx! };
    }

    // Optional employer-match portion — a second `employer`-funded row logged in the same
    // action so the self/employer room split stays correct without a follow-up request.
    if (employerAmountCents > 0) {
      await this.db.insert(registeredTransactions).values({
        id: crypto.randomUUID(),
        account_id: account.id,
        type: 'contribution',
        kind: 'manual',
        contributor: 'employer',
        amount_cents: employerAmountCents,
        transaction_date,
        tax_year,
        created_by: userId,
      });
    }

    await this.db
      .update(registeredAccounts)
      .set({
        balance_cents: account.balance_cents + data.amountCents + employerAmountCents,
        updated_at: now(),
      })
      .where(eq(registeredAccounts.id, account.id));

    const refreshed = await this.loadOwnedAccount(householdId, account.id);
    return { account: refreshed, transaction: inserted[0] };
  }

  /**
   * Pension simple flow — per-month contribution grid (backfill). Returns the year's
   * `kind:'regular'` monthly totals (self + employer) for a member's line, one entry per
   * calendar month (1–12), so the client can render an editable grid pre-filled with what
   * is already recorded. Ad-hoc `manual` contributions and AI imports are a separate
   * additive lane and are intentionally NOT folded in here.
   */
  async getMemberMonthlyContributions(
    householdId: string,
    userId: string,
    memberId: string,
    accountType: 'tfsa' | 'rrsp',
    year: number
  ): Promise<{ months: Array<{ month: number; selfCents: number; employerCents: number }> }> {
    await this.checkHouseholdAccess(householdId, userId);

    const months = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      selfCents: 0,
      employerCents: 0,
    }));

    const account = await this.db
      .select()
      .from(registeredAccounts)
      .where(
        and(
          eq(registeredAccounts.household_id, householdId),
          eq(registeredAccounts.member_id, memberId),
          eq(registeredAccounts.account_type, accountType)
        )
      )
      .orderBy(asc(registeredAccounts.is_room_only), asc(registeredAccounts.created_at))
      .get();
    if (!account) return { months };

    const rows = await this.db
      .select()
      .from(registeredTransactions)
      .where(
        and(
          eq(registeredTransactions.account_id, account.id),
          eq(registeredTransactions.type, 'contribution'),
          eq(registeredTransactions.kind, 'regular'),
          like(registeredTransactions.period, `${year}-%`)
        )
      )
      .all();

    for (const r of rows) {
      if (!r.period) continue;
      const m = Number(r.period.substring(5, 7));
      if (m < 1 || m > 12) continue;
      if (r.contributor === 'employer') months[m - 1].employerCents += r.amount_cents;
      else months[m - 1].selfCents += r.amount_cents;
    }
    return { months };
  }

  /**
   * Pension simple flow — replace a member line's monthly (`kind:'regular'`) contributions
   * for a whole tax year with the client-supplied grid (one self + one employer amount per
   * month). Because real statements carry DIFFERENT amounts each month for both the member
   * contribution and the employer match, this is the way to enter per-month values — as
   * opposed to the flat "Set up recurring" amount. Idempotent: the year's existing regular
   * rows are deleted and re-inserted from the grid, so re-saving never double-counts.
   * Manual/ad-hoc contributions and AI imports are untouched. Balance is recomputed from
   * ALL contribution/withdrawal rows so it can never drift.
   */
  async backfillMemberContributions(
    householdId: string,
    userId: string,
    data: {
      memberId: string;
      accountType: 'tfsa' | 'rrsp';
      year: number;
      entries: Array<{ month: number; selfCents: number; employerCents: number }>;
    }
  ): Promise<{ account: RegisteredAccount }> {
    // Ensure the line exists (also runs access + member + type guards).
    let account = await this.upsertMemberLine(householdId, userId, {
      memberId: data.memberId,
      accountType: data.accountType,
    });
    if (!account) {
      const id = crypto.randomUUID();
      await this.db.insert(registeredAccounts).values({
        id,
        household_id: householdId,
        member_id: data.memberId,
        account_type: data.accountType,
        is_room_only: true,
        balance_cents: 0,
      });
      account = await this.loadOwnedAccount(householdId, id);
    }

    // Replace the year's regular lane: delete every regular row for the year, then
    // re-insert from the grid (which the client pre-filled from these same rows).
    await this.db
      .delete(registeredTransactions)
      .where(
        and(
          eq(registeredTransactions.account_id, account.id),
          eq(registeredTransactions.type, 'contribution'),
          eq(registeredTransactions.kind, 'regular'),
          like(registeredTransactions.period, `${data.year}-%`)
        )
      );

    for (const entry of data.entries) {
      if (entry.month < 1 || entry.month > 12) continue;
      const period = `${data.year}-${pad2(entry.month)}`;
      const transaction_date = `${period}-01`;
      const legs: Array<{ contributor: 'self' | 'employer'; amount: number }> = [
        { contributor: 'self', amount: Math.max(0, Math.round(entry.selfCents)) },
        { contributor: 'employer', amount: Math.max(0, Math.round(entry.employerCents)) },
      ];
      for (const leg of legs) {
        if (leg.amount <= 0) continue;
        await this.db
          .insert(registeredTransactions)
          .values({
            id: crypto.randomUUID(),
            account_id: account.id,
            type: 'contribution',
            kind: 'regular',
            contributor: leg.contributor,
            amount_cents: leg.amount,
            transaction_date,
            tax_year: data.year,
            period,
          })
          .onConflictDoNothing();
      }
    }

    // Recompute balance from ALL rows (idempotent; survives repeated saves).
    const balanceRow = await this.db
      .select({
        balance: sql<number>`COALESCE(SUM(CASE WHEN ${registeredTransactions.type} = 'contribution' THEN ${registeredTransactions.amount_cents} ELSE -${registeredTransactions.amount_cents} END), 0)`,
      })
      .from(registeredTransactions)
      .where(eq(registeredTransactions.account_id, account.id))
      .get();
    const balance = balanceRow?.balance ?? 0;
    await this.db
      .update(registeredAccounts)
      .set({ balance_cents: balance, updated_at: now() })
      .where(eq(registeredAccounts.id, account.id));

    return { account: await this.loadOwnedAccount(householdId, account.id) };
  }

  /**
   * Pension simple flow — delete a member line's contributions for a tax YEAR. Removes the
   * year's recorded contributions (both `regular` and `manual`, self + employer) and, for a
   * room-only line, switches OFF the recurring automation + employer match so it can't
   * re-materialize on the next overview load. Room and goal are preserved. The year is
   * attributed exactly as the room engine does (`tax_year`, else the transaction date's
   * year) so we remove precisely what the year's "used" reflects. Balance is recomputed
   * from the remaining rows so it can't drift. If a room-only placeholder is left with
   * nothing (no room, no goal, no transactions), the row is removed. Returns the refreshed
   * line, or null when the row was deleted / never existed.
   */
  async clearMemberContributions(
    householdId: string,
    userId: string,
    data: { memberId: string; accountType: 'tfsa' | 'rrsp'; year: number }
  ): Promise<{ account: RegisteredAccount | null }> {
    await this.checkHouseholdAccess(householdId, userId);
    if (data.accountType !== 'tfsa' && data.accountType !== 'rrsp') {
      throw new ValidationError({ account_type: ['Member line supports only tfsa and rrsp'] });
    }

    // Verify the member belongs to this household (IDOR guard).
    const member = await this.db
      .select({ id: householdMembers.id })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.id, data.memberId),
          eq(householdMembers.household_id, householdId)
        )
      )
      .get();
    if (!member) throw new NotFoundError('Household member');

    const existing = await this.db
      .select()
      .from(registeredAccounts)
      .where(
        and(
          eq(registeredAccounts.household_id, householdId),
          eq(registeredAccounts.member_id, data.memberId),
          eq(registeredAccounts.account_type, data.accountType)
        )
      )
      .orderBy(asc(registeredAccounts.is_room_only), asc(registeredAccounts.created_at))
      .get();
    if (!existing) return { account: null };

    const txns = await this.db
      .select()
      .from(registeredTransactions)
      .where(eq(registeredTransactions.account_id, existing.id))
      .limit(CLEAR_MEMBER_TXNS_LIMIT)
      .all();
    const yearContribIds = txns
      .filter(
        (tx) =>
          tx.type === 'contribution' &&
          (tx.tax_year != null ? tx.tax_year : Number(tx.transaction_date.substring(0, 4))) ===
            data.year
      )
      .map((tx) => tx.id);
    if (yearContribIds.length > 0) {
      await this.db
        .delete(registeredTransactions)
        .where(inArray(registeredTransactions.id, yearContribIds));
    }

    const remaining = txns.filter((tx) => !yearContribIds.includes(tx.id));
    const balance = remaining.reduce(
      (sum, tx) => sum + (tx.type === 'contribution' ? tx.amount_cents : -tx.amount_cents),
      0
    );

    const hasRoom = (existing.starting_room_cents ?? 0) > 0;
    const hasGoal = existing.annual_goal_cents != null || existing.annual_goal_pct != null;

    // A bare room-only placeholder with nothing left is removed entirely.
    if (existing.is_room_only && !hasRoom && !hasGoal && remaining.length === 0) {
      await this.db
        .delete(registeredAccounts)
        .where(
          and(
            eq(registeredAccounts.id, existing.id),
            eq(registeredAccounts.household_id, householdId)
          )
        );
      return { account: null };
    }

    await this.db
      .update(registeredAccounts)
      .set({
        // Recurring automation is exclusive to room-only simple lines; a real account keeps
        // its own recurring config (managed via the full form + manual apply-regular).
        ...(existing.is_room_only
          ? {
              regular_contribution_cents: null,
              employer_match_cents: null,
              recurring_start_month: null,
            }
          : {}),
        balance_cents: balance,
        updated_at: now(),
      })
      .where(
        and(
          eq(registeredAccounts.id, existing.id),
          eq(registeredAccounts.household_id, householdId)
        )
      );

    return { account: await this.loadOwnedAccount(householdId, existing.id) };
  }

  async addTransaction(
    householdId: string,
    userId: string,
    accountId: string,
    data: {
      id: string;
      type: 'contribution' | 'withdrawal';
      kind?: 'regular' | 'manual';
      contributor?: 'self' | 'employer';
      amount_cents: number;
      transaction_date: string;
      tax_year?: number | null;
      notes?: string | null;
      source?: 'manual' | 'ai_import';
      import_batch_id?: string | null;
    }
  ): Promise<{ transaction: RegisteredTransaction; account: RegisteredAccount }> {
    await this.checkHouseholdAccess(householdId, userId);
    const account = await this.loadOwnedAccount(householdId, accountId); // IDOR guard

    // Idempotent (W2): client id as PK. Detect whether a row was actually created.
    const inserted = await this.db
      .insert(registeredTransactions)
      .values({
        id: data.id,
        account_id: accountId,
        type: data.type,
        kind: data.kind ?? 'manual',
        contributor: data.contributor ?? 'self',
        amount_cents: data.amount_cents,
        transaction_date: data.transaction_date,
        tax_year: data.tax_year ?? null,
        notes: data.notes ?? null,
        source: data.source ?? 'manual',
        import_batch_id: data.import_batch_id ?? null,
        created_by: userId,
      })
      .onConflictDoNothing()
      .returning();

    // Adjust balance only when a new row was created (duplicate submit = no double move).
    if (inserted.length > 0) {
      const delta = data.type === 'contribution' ? data.amount_cents : -data.amount_cents;
      await this.db
        .update(registeredAccounts)
        .set({
          balance_cents: account.balance_cents + delta,
          updated_at: now(),
        })
        .where(eq(registeredAccounts.id, accountId));
    }

    const transaction = await this.db
      .select()
      .from(registeredTransactions)
      .where(eq(registeredTransactions.id, data.id))
      .get();
    if (!transaction) throw new NotFoundError('Registered transaction');

    const refreshed = await this.loadOwnedAccount(householdId, accountId);
    return { transaction, account: refreshed };
  }

  async deleteTransaction(
    householdId: string,
    userId: string,
    accountId: string,
    txId: string
  ): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);
    const account = await this.loadOwnedAccount(householdId, accountId); // IDOR guard

    const tx = await this.db
      .select()
      .from(registeredTransactions)
      .where(
        and(
          eq(registeredTransactions.id, txId),
          eq(registeredTransactions.account_id, accountId)
        )
      )
      .get();
    if (!tx) throw new NotFoundError('Registered transaction');

    // Reverse the balance effect of the transaction being removed.
    const delta = tx.type === 'contribution' ? -tx.amount_cents : tx.amount_cents;
    await this.db
      .update(registeredAccounts)
      .set({
        balance_cents: account.balance_cents + delta,
        updated_at: now(),
      })
      .where(eq(registeredAccounts.id, accountId));

    await this.db
      .delete(registeredTransactions)
      .where(eq(registeredTransactions.id, txId));
  }

  async getRoom(
    householdId: string,
    userId: string,
    accountId: string,
    year: number
  ): Promise<RegisteredRoom> {
    await this.checkHouseholdAccess(householdId, userId);
    const account = await this.loadOwnedAccount(householdId, accountId); // IDOR guard
    requireLimitsForYear(year);
    return this.roomForAccount(householdId, account, year);
  }

  /**
   * Effective Pension Adjustment (cents) that reduces a personal RRSP's from-scratch
   * room for `year`: a manual `pension_adjustment_cents` on the account always wins;
   * otherwise it's auto-derived from the member's DC workplace-plan (DPSP/RPP)
   * contributions in the PRIOR year (year − 1), capped at that year's MP limit. Returns
   * 0 when there is no member link and no manual value.
   */
  private async resolveRrspPensionAdjustment(
    householdId: string,
    account: RegisteredAccount,
    year: number
  ): Promise<number | null> {
    if (account.pension_adjustment_cents != null) return account.pension_adjustment_cents;
    if (!account.member_id) return null;

    const priorYear = year - 1;
    const dcAccounts = await this.db
      .select({ id: registeredAccounts.id })
      .from(registeredAccounts)
      .where(
        and(
          eq(registeredAccounts.household_id, householdId),
          eq(registeredAccounts.member_id, account.member_id),
          inArray(registeredAccounts.account_type, ['dpsp', 'rpp'])
        )
      )
      .all();
    if (dcAccounts.length === 0) return null;

    const dcTxns = await this.db
      .select()
      .from(registeredTransactions)
      .where(
        inArray(
          registeredTransactions.account_id,
          dcAccounts.map((a) => a.id)
        )
      )
      .all();

    let dcPriorYearContribs = 0;
    for (const tx of dcTxns) {
      if (tx.type !== 'contribution') continue;
      const txYear = tx.tax_year != null ? tx.tax_year : Number(tx.transaction_date.substring(0, 4));
      if (txYear === priorYear) dcPriorYearContribs += tx.amount_cents;
    }
    if (dcPriorYearContribs === 0) return null;
    return pensionAdjustmentFromDc(priorYear, dcPriorYearContribs);
  }

  /**
   * Resolve the effective annual goal in cents. A percentage goal (`annual_goal_pct`,
   * migration 0082) is a share of the room base — the member's set room
   * (`starting_room_cents`), else the year's contribution limit for the account type.
   * An amount goal (`annual_goal_cents`) is returned verbatim. Null when no goal is set.
   */
  private effectiveGoalCents(account: RegisteredAccount, year: number): number | null {
    if (account.annual_goal_pct != null && account.annual_goal_pct > 0) {
      const limits = SAVINGS_LIMITS[year];
      const typeLimit =
        account.account_type === 'rrsp'
          ? limits?.rrspMax
          : account.account_type === 'tfsa'
          ? limits?.tfsa
          : account.account_type === 'fhsa'
          ? limits?.fhsaAnnual
          : limits?.mpLimit;
      const base = account.starting_room_cents ?? account.annual_limit_override_cents ?? typeLimit ?? 0;
      return Math.round((base * account.annual_goal_pct) / 100);
    }
    return account.annual_goal_cents;
  }

  /**
   * Compute the room/goal view model for a single account. Caller has already run the
   * access + IDOR + `requireLimitsForYear` guards. Shared by `getRoom` (single account)
   * and `getPensionOverview` (all accounts).
   */
  private async roomForAccount(
    householdId: string,
    account: RegisteredAccount,
    year: number
  ): Promise<RegisteredRoom> {
    const txns = await this.db
      .select()
      .from(registeredTransactions)
      .where(eq(registeredTransactions.account_id, account.id))
      .all();

    let usedThisYear = 0;
    let usedRegular = 0;
    let usedManual = 0;
    let usedSelf = 0;
    let usedEmployer = 0;
    let priorYearWithdrawals = 0;
    let contributionsSinceAsOf = 0;
    let totalLifetimeContributions = 0;

    const asOf = account.room_as_of_date;

    for (const tx of txns) {
      const txYear =
        tx.tax_year != null ? tx.tax_year : Number(tx.transaction_date.substring(0, 4));

      if (tx.type === 'contribution') {
        totalLifetimeContributions += tx.amount_cents;
        if (txYear === year) {
          usedThisYear += tx.amount_cents;
          if (tx.kind === 'regular') usedRegular += tx.amount_cents;
          else usedManual += tx.amount_cents;
          if (tx.contributor === 'employer') usedEmployer += tx.amount_cents;
          else usedSelf += tx.amount_cents;
        }
        if (asOf && tx.transaction_date >= asOf) {
          contributionsSinceAsOf += tx.amount_cents;
        }
      } else if (tx.type === 'withdrawal') {
        const dateYear = Number(tx.transaction_date.substring(0, 4));
        if (dateYear < year) priorYearWithdrawals += tx.amount_cents;
      }
    }

    // RRSP from-scratch room nets a Pension Adjustment; auto-derive it from the member's
    // DC-plan contributions when not manually set (manual value still wins).
    const pensionAdjustmentCents =
      account.account_type === 'rrsp'
        ? await this.resolveRrspPensionAdjustment(householdId, account, year)
        : account.pension_adjustment_cents;

    const inputs: RoomInputs = {
      year,
      startingRoomCents: account.starting_room_cents,
      annualLimitOverrideCents: account.annual_limit_override_cents,
      priorEarnedIncomeCents: account.prior_earned_income_cents,
      pensionAdjustmentCents,
      usedThisYear,
      usedByKind: { regular: usedRegular, manual: usedManual },
      usedByContributor: { self: usedSelf, employer: usedEmployer },
      priorYearWithdrawals,
      contributionsSinceAsOf,
      roomAsOfDate: asOf ?? null,
      totalLifetimeContributions,
      // A % goal (migration 0082) is a share of the room base (the member's set room, else
      // the year's contribution limit for the type); an amount goal is used verbatim.
      annualGoalCents: this.effectiveGoalCents(account, year),
    };

    let result: RoomResult;
    switch (account.account_type) {
      case 'tfsa':
        result = getTfsaRoom(inputs);
        break;
      case 'rrsp':
        result = getRrspRoom(inputs);
        break;
      case 'fhsa':
        result = getFhsaRoom(inputs);
        break;
      case 'dpsp':
      case 'rpp':
        result = getDcPensionRoom(inputs);
        break;
      default:
        throw new ValidationError({ account_type: [`Unsupported account type: ${account.account_type}`] });
    }

    return {
      accountId: account.id,
      accountType: account.account_type as RegisteredAccountType,
      year,
      ...result,
    };
  }

  /**
   * Server-computed view model for the Pension tab's Accounts sub-view: every registered
   * account grouped by member with its balance + room + goal progress, plus household
   * totals. Thin client — the app renders these figures without any money math.
   */
  /**
   * Materialize automated recurring pension contributions for a household. For every
   * line with a recurring amount (self `regular_contribution_cents` and/or an employer
   * `employer_match_cents`) and a `recurring_start_month` anchor, create the missing
   * monthly `kind:'regular'` contribution records from the anchor through the current
   * month — one per contributor per month. Idempotent: existing (account, period,
   * contributor) rows are skipped (in-memory set + the unique index as a race backstop),
   * so re-opening the Pension tab never double-counts. Balances move by the amount added.
   */
  private async materializeRecurringForHousehold(householdId: string): Promise<void> {
    const accounts = await this.db
      .select()
      .from(registeredAccounts)
      .where(
        and(
          eq(registeredAccounts.household_id, householdId),
          // Auto-generation is exclusive to simple (room-only) lines — real accounts use
          // the manual apply-regular flow and must never be auto-materialized here.
          eq(registeredAccounts.is_room_only, true),
          isNotNull(registeredAccounts.recurring_start_month)
        )
      )
      .limit(MATERIALIZE_RECURRING_ACCOUNTS_LIMIT)
      .all();

    const asOf = new Date();
    const currentIndex = asOf.getUTCFullYear() * 12 + asOf.getUTCMonth(); // months since year 0

    for (const account of accounts) {
      const regular = account.regular_contribution_cents ?? 0;
      const match = account.employer_match_cents ?? 0;
      if (regular <= 0 && match <= 0) continue;

      const [sy, sm] = (account.recurring_start_month ?? '').split('-').map(Number);
      if (!sy || !sm) continue;
      const startIndex = sy * 12 + (sm - 1);
      if (startIndex > currentIndex) continue;

      // Which (contributor, period) regular rows already exist — skip those.
      const existing = await this.db
        .select({ period: registeredTransactions.period, contributor: registeredTransactions.contributor })
        .from(registeredTransactions)
        .where(
          and(eq(registeredTransactions.account_id, account.id), eq(registeredTransactions.kind, 'regular'))
        )
        .limit(MATERIALIZE_RECURRING_TXNS_LIMIT)
        .all();
      const seen = new Set(existing.map((r) => `${r.contributor}:${r.period}`));

      let added = 0;
      for (let idx = startIndex; idx <= currentIndex; idx += 1) {
        const y = Math.floor(idx / 12);
        const m = (idx % 12) + 1;
        const period = `${y}-${pad2(m)}`;
        const transaction_date = `${period}-01`;

        const legs: Array<{ contributor: 'self' | 'employer'; amount: number }> = [];
        if (regular > 0) legs.push({ contributor: 'self', amount: regular });
        if (match > 0) legs.push({ contributor: 'employer', amount: match });

        for (const leg of legs) {
          if (seen.has(`${leg.contributor}:${period}`)) continue;
          const inserted = await this.db
            .insert(registeredTransactions)
            .values({
              id: crypto.randomUUID(),
              account_id: account.id,
              type: 'contribution',
              kind: 'regular',
              contributor: leg.contributor,
              amount_cents: leg.amount,
              transaction_date,
              tax_year: y,
              period,
            })
            .onConflictDoNothing()
            .returning();
          if (inserted.length > 0) added += leg.amount;
        }
      }

      if (added > 0) {
        await this.db
          .update(registeredAccounts)
          .set({ balance_cents: account.balance_cents + added, updated_at: now() })
          .where(eq(registeredAccounts.id, account.id));
      }
    }
  }

  async getPensionOverview(
    householdId: string,
    userId: string,
    year: number
  ): Promise<PensionOverview> {
    await this.checkHouseholdAccess(householdId, userId);
    requireLimitsForYear(year);

    // Auto on app open: create any missing monthly recurring contribution records
    // (self + employer match) up to the current month before computing the view model.
    await this.materializeRecurringForHousehold(householdId);

    const accounts = await this.db
      .select()
      .from(registeredAccounts)
      .where(eq(registeredAccounts.household_id, householdId))
      .orderBy(asc(registeredAccounts.created_at))
      .limit(PENSION_OVERVIEW_ACCOUNTS_LIMIT)
      .all();

    // member_id → display name (display_name ?? email), resolved via householdMembers→users.
    const memberRows = await this.db
      .select({
        memberId: householdMembers.id,
        displayName: users.display_name,
        email: users.email,
        avatarUrl: users.avatar_url,
      })
      .from(householdMembers)
      .leftJoin(users, eq(householdMembers.user_id, users.id))
      .where(eq(householdMembers.household_id, householdId))
      .limit(PENSION_OVERVIEW_MEMBERS_LIMIT)
      .all();
    const memberName = new Map<string, string | null>();
    const memberAvatar = new Map<string, string | null>();
    for (const m of memberRows) {
      memberName.set(m.memberId, m.displayName ?? m.email ?? null);
      memberAvatar.set(m.memberId, resolveAvatarUrl(m.avatarUrl, this.env.API_URL));
    }

    const totals = {
      totalBalanceCents: 0,
      totalRoomRemainingCents: 0,
      totalContributedSelfCents: 0,
      totalContributedEmployerCents: 0,
      goalCents: 0,
      goalContributedCents: 0,
      goalPct: 0,
    };
    const warningSet = new Set<string>();
    const groupMap = new Map<string, PensionMemberGroup>();

    for (const account of accounts) {
      const room = await this.roomForAccount(householdId, account, year);
      const name = account.member_id ? memberName.get(account.member_id) ?? null : null;

      totals.totalBalanceCents += account.balance_cents;
      totals.totalContributedSelfCents += room.usedByContributor.self;
      totals.totalContributedEmployerCents += room.usedByContributor.employer;
      // DC plans have a plan-cap "room", not personal contribution room — exclude from the headline.
      if (account.account_type !== 'dpsp' && account.account_type !== 'rpp') {
        totals.totalRoomRemainingCents += room.roomRemaining;
      }
      if (room.goalCents != null) {
        totals.goalCents += room.goalCents;
        totals.goalContributedCents += room.goalContributedCents;
      }
      for (const w of room.warnings) warningSet.add(w);

      const avatarUrl = account.member_id ? memberAvatar.get(account.member_id) ?? null : null;

      const key = account.member_id ?? '__household__';
      let group = groupMap.get(key);
      if (!group) {
        group = {
          memberId: account.member_id,
          memberName: name,
          memberAvatarUrl: avatarUrl,
          totalBalanceCents: 0,
          accounts: [],
        };
        groupMap.set(key, group);
      }
      group.totalBalanceCents += account.balance_cents;
      group.accounts.push({ account, memberName: name, room });
    }

    totals.goalPct =
      totals.goalCents > 0
        ? Math.min(100, Math.round((totals.goalContributedCents / totals.goalCents) * 100))
        : 0;

    return {
      year,
      totals,
      groups: Array.from(groupMap.values()),
      warnings: Array.from(warningSet),
    };
  }

  /**
   * Commit a reviewed registered-statement import. For each draft account either targets
   * an existing account (adds its contributions) or creates a new one. A new account's
   * opening balance is set to (statement balance − Σ its contributions) so that adding the
   * contribution rows lands the balance exactly on the statement figure (no double count).
   * Every inserted transaction shares `import_batch_id` + source='ai_import', so
   * `undoRegisteredImportBatch` can reverse the whole commit.
   */
  async commitRegisteredImport(
    householdId: string,
    userId: string,
    data: {
      import_batch_id: string;
      accounts: Array<{
        existing_account_id?: string | null;
        id?: string;
        member_id?: string | null;
        account_type?: string;
        institution?: string | null;
        is_employer_plan?: boolean;
        employer_name?: string | null;
        balance_cents?: number;
        annual_goal_cents?: number | null;
        starting_room_cents?: number | null;
        contributions: Array<{
          id: string;
          amount_cents: number;
          transaction_date: string;
          contributor?: 'self' | 'employer';
          tax_year?: number | null;
        }>;
      }>;
    }
  ): Promise<{ import_batch_id: string; createdAccountIds: string[]; transactionCount: number }> {
    await this.checkHouseholdAccess(householdId, userId);

    const createdAccountIds: string[] = [];
    let transactionCount = 0;

    for (const draft of data.accounts) {
      let accountId: string;

      if (draft.existing_account_id) {
        // IDOR guard — must belong to this household.
        const owned = await this.loadOwnedAccount(householdId, draft.existing_account_id);
        accountId = owned.id;
      } else {
        if (!draft.id || !draft.account_type) {
          throw new ValidationError({ accounts: ['New account requires id and account_type'] });
        }
        const sumContribCents = draft.contributions.reduce((s, c) => s + c.amount_cents, 0);
        const openingBalance = Math.max(0, (draft.balance_cents ?? sumContribCents) - sumContribCents);
        const created = await this.createAccount(householdId, userId, {
          id: draft.id,
          member_id: draft.member_id ?? null,
          account_type: draft.account_type,
          institution: draft.institution ?? null,
          is_employer_plan: draft.is_employer_plan ?? false,
          employer_name: draft.employer_name ?? null,
          balance_cents: openingBalance,
          annual_goal_cents: draft.annual_goal_cents ?? null,
          starting_room_cents: draft.starting_room_cents ?? null,
        });
        accountId = created.id;
        createdAccountIds.push(accountId);
      }

      for (const c of draft.contributions) {
        const taxYear = c.tax_year ?? Number(c.transaction_date.substring(0, 4));
        await this.addTransaction(householdId, userId, accountId, {
          id: c.id,
          type: 'contribution',
          kind: 'manual',
          contributor: c.contributor ?? 'self',
          amount_cents: c.amount_cents,
          transaction_date: c.transaction_date,
          tax_year: taxYear,
          source: 'ai_import',
          import_batch_id: data.import_batch_id,
        });
        transactionCount += 1;
      }
    }

    return { import_batch_id: data.import_batch_id, createdAccountIds, transactionCount };
  }

  /**
   * Undo a registered-statement import: reverse the balance effect of, and delete, every
   * transaction stamped with `importBatchId` across the household's accounts. Accounts that
   * were created by the import are left in place (delete them manually if unwanted).
   */
  async undoRegisteredImportBatch(
    householdId: string,
    userId: string,
    importBatchId: string
  ): Promise<{ deleted: number }> {
    await this.checkHouseholdAccess(householdId, userId);

    const accounts = await this.db
      .select({ id: registeredAccounts.id, balance: registeredAccounts.balance_cents })
      .from(registeredAccounts)
      .where(eq(registeredAccounts.household_id, householdId))
      .all();
    if (accounts.length === 0) return { deleted: 0 };

    const balanceById = new Map(accounts.map((a) => [a.id, a.balance]));
    const txns = await this.db
      .select()
      .from(registeredTransactions)
      .where(
        and(
          eq(registeredTransactions.import_batch_id, importBatchId),
          inArray(
            registeredTransactions.account_id,
            accounts.map((a) => a.id)
          )
        )
      )
      .all();

    let deleted = 0;
    for (const tx of txns) {
      const current = balanceById.get(tx.account_id);
      if (current == null) continue;
      const delta = tx.type === 'contribution' ? -tx.amount_cents : tx.amount_cents;
      const next = current + delta;
      balanceById.set(tx.account_id, next);
      await this.db
        .update(registeredAccounts)
        .set({ balance_cents: next, updated_at: now() })
        .where(eq(registeredAccounts.id, tx.account_id));
      await this.db.delete(registeredTransactions).where(eq(registeredTransactions.id, tx.id));
      deleted += 1;
    }

    return { deleted };
  }

  async applyRegularContribution(
    householdId: string,
    userId: string,
    accountId: string,
    year: number,
    month: number
  ): Promise<{ created: boolean; transaction: RegisteredTransaction | null; account: RegisteredAccount }> {
    await this.checkHouseholdAccess(householdId, userId);
    const account = await this.loadOwnedAccount(householdId, accountId); // IDOR guard

    // No regular contribution configured → no-op.
    if (account.regular_contribution_cents == null) {
      return { created: false, transaction: null, account };
    }

    const period = `${year}-${pad2(month)}`;
    const transaction_date = `${year}-${pad2(month)}-01`;

    // Idempotent via the partial unique index (account_id, period). onConflictDoNothing
    // + returning() tells us whether a row was actually created this call.
    const inserted = await this.db
      .insert(registeredTransactions)
      .values({
        id: crypto.randomUUID(),
        account_id: accountId,
        type: 'contribution',
        kind: 'regular',
        amount_cents: account.regular_contribution_cents,
        transaction_date,
        tax_year: year,
        period,
        created_by: userId,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted.length === 0) {
      // Already applied this month — no-op, return current state.
      return { created: false, transaction: null, account };
    }

    await this.db
      .update(registeredAccounts)
      .set({
        balance_cents: account.balance_cents + account.regular_contribution_cents,
        updated_at: now(),
      })
      .where(eq(registeredAccounts.id, accountId));

    const refreshed = await this.loadOwnedAccount(householdId, accountId);
    return { created: true, transaction: inserted[0], account: refreshed };
  }

  // ============ INCOME TEMPLATES (Phase 4) ============

  async listIncomeTemplates(
    householdId: string,
    userId: string
  ): Promise<SavingsIncomeTemplate[]> {
    await this.checkHouseholdAccess(householdId, userId);
    return this.db
      .select()
      .from(savingsIncomeTemplates)
      .where(eq(savingsIncomeTemplates.household_id, householdId))
      .orderBy(desc(savingsIncomeTemplates.created_at))
      .limit(LIST_INCOME_TEMPLATES_LIMIT)
      .all();
  }

  async createIncomeTemplate(
    householdId: string,
    userId: string,
    data: {
      id: string;
      member_id?: string | null;
      source_type: string;
      label: string;
      amount_cents: number;
      day_of_month?: number | null;
      active?: boolean;
    }
  ): Promise<SavingsIncomeTemplate> {
    await this.checkHouseholdAccess(householdId, userId);

    await this.db
      .insert(savingsIncomeTemplates)
      .values({
        id: data.id,
        household_id: householdId,
        member_id: data.member_id ?? null,
        source_type: data.source_type,
        label: data.label,
        amount_cents: data.amount_cents,
        day_of_month: data.day_of_month ?? null,
        active: data.active ?? true,
      })
      .onConflictDoNothing();

    return this.requireIncomeTemplate(householdId, data.id);
  }

  async updateIncomeTemplate(
    householdId: string,
    userId: string,
    id: string,
    data: Partial<{
      member_id: string | null;
      source_type: string;
      label: string;
      amount_cents: number;
      day_of_month: number | null;
      active: boolean;
    }>
  ): Promise<SavingsIncomeTemplate> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.requireIncomeTemplate(householdId, id);

    const patch: Record<string, unknown> = {};
    if (data.member_id !== undefined) patch.member_id = data.member_id;
    if (data.source_type !== undefined) patch.source_type = data.source_type;
    if (data.label !== undefined) patch.label = data.label;
    if (data.amount_cents !== undefined) patch.amount_cents = data.amount_cents;
    if (data.day_of_month !== undefined) patch.day_of_month = data.day_of_month;
    if (data.active !== undefined) patch.active = data.active;

    if (Object.keys(patch).length > 0) {
      await this.db
        .update(savingsIncomeTemplates)
        .set(patch)
        .where(
          and(
            eq(savingsIncomeTemplates.id, id),
            eq(savingsIncomeTemplates.household_id, householdId)
          )
        );
    }

    return this.requireIncomeTemplate(householdId, id);
  }

  async deleteIncomeTemplate(householdId: string, userId: string, id: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.requireIncomeTemplate(householdId, id);
    await this.db
      .delete(savingsIncomeTemplates)
      .where(
        and(
          eq(savingsIncomeTemplates.id, id),
          eq(savingsIncomeTemplates.household_id, householdId)
        )
      );
  }

  private async requireIncomeTemplate(
    householdId: string,
    id: string
  ): Promise<SavingsIncomeTemplate> {
    const row = await this.db
      .select()
      .from(savingsIncomeTemplates)
      .where(
        and(
          eq(savingsIncomeTemplates.id, id),
          eq(savingsIncomeTemplates.household_id, householdId)
        )
      )
      .get();
    if (!row) throw new NotFoundError('Income template');
    return row;
  }

  /**
   * Apply each active income template to the given month. Idempotent via the
   * partial unique index (template_id, period) — re-applying the same month
   * is a no-op. Returns { created, skipped }.
   */
  async applyIncomeTemplates(
    householdId: string,
    userId: string,
    year: number,
    month: number
  ): Promise<{ created: number; skipped: number }> {
    await this.checkHouseholdAccess(householdId, userId);

    const templates = await this.db
      .select()
      .from(savingsIncomeTemplates)
      .where(
        and(
          eq(savingsIncomeTemplates.household_id, householdId),
          eq(savingsIncomeTemplates.active, true)
        )
      )
      .limit(LIST_INCOME_TEMPLATES_LIMIT)
      .all();

    const period = `${year}-${pad2(month)}`;
    let created = 0;
    let skipped = 0;

    for (const tpl of templates) {
      const rawDay = tpl.day_of_month && tpl.day_of_month >= 1 ? tpl.day_of_month : 1;
      // Clamp to the month's real length so a day_of_month of 31 doesn't produce an
      // invalid date like "2026-02-31" (mirrors applyRecurringToMonth).
      const day = Math.min(rawDay, new Date(year, month, 0).getDate());
      const income_date = `${year}-${pad2(month)}-${pad2(day)}`;

      const inserted = await this.db
        .insert(savingsIncomeEntries)
        .values({
          id: crypto.randomUUID(),
          household_id: householdId,
          member_id: tpl.member_id ?? null,
          source_type: tpl.source_type,
          label: tpl.label,
          amount_cents: tpl.amount_cents,
          income_date,
          template_id: tpl.id,
          period,
          created_by: userId,
        })
        .onConflictDoNothing()
        .returning();

      if (inserted.length > 0) created++;
      else skipped++;
    }

    return { created, skipped };
  }

  // ============ RECURRING PAYMENTS (Phase 5) ============

  async listRecurringPayments(
    householdId: string,
    userId: string,
    // Both optional — omit for a flat all-active total (legacy callers); pass
    // both to scope the total/byGroup to what's actually active THIS month
    // (a month-scoped payment outside `month` is excluded from the totals).
    year?: number,
    month?: number
  ): Promise<RecurringPaymentsView> {
    await this.checkHouseholdAccess(householdId, userId);

    // Active first, then inactive; stable secondary sort by group_label then label.
    const items = await this.db
      .select()
      .from(savingsRecurringPayments)
      .where(eq(savingsRecurringPayments.household_id, householdId))
      .orderBy(
        desc(savingsRecurringPayments.active),
        asc(savingsRecurringPayments.group_label),
        asc(savingsRecurringPayments.label)
      )
      .limit(LIST_RECURRING_PAYMENTS_LIMIT)
      .all();

    // Renewal summaries, keyed by recurring_payment_id — a single query so the
    // Monthly list can render a "Renews in N days" pill with no extra round-trip.
    const renewalRows = await this.db
      .select({
        recurring_payment_id: budgetRenewals.recurring_payment_id,
        next_renewal_date: budgetRenewals.next_renewal_date,
        status: budgetRenewals.status,
        reminder_lead_days: budgetRenewals.reminder_lead_days,
      })
      .from(budgetRenewals)
      .where(eq(budgetRenewals.household_id, householdId))
      .all();
    const renewalByPaymentId = new Map(renewalRows.map((r) => [r.recurring_payment_id, r]));

    // Loan summaries, same one-extra-join shape as renewals above — lets the
    // Monthly list render a "N payments left" pill with no extra round-trip.
    const loanRows = await this.db
      .select()
      .from(budgetLoans)
      .where(eq(budgetLoans.household_id, householdId))
      .all();
    const loanByPaymentId = new Map(loanRows.map((r) => [r.recurring_payment_id, r]));

    // Reclassify ungrouped housing bills (mortgage/strata/property tax/rent) and
    // loan-tracked payments out of the generic "Other" catch-all into their own
    // dedicated groups. An explicit user/import group is always respected as-is.
    const resolvedItems = items.map((item) => {
      const loan = loanByPaymentId.get(item.id);
      return {
        ...item,
        group_label: resolveRecurringGroupLabel(item.label, item.group_label, Boolean(loan)),
        renewal_summary: renewalByPaymentId.get(item.id) ?? null,
        loan_summary: loan
          ? computeInstallmentLoanSummary({
              principalCents: loan.principal_cents,
              rateType: loan.rate_type as 'zero' | 'fixed',
              rateBps: loan.rate_bps,
              termMonths: loan.term_months,
              startDate: loan.start_date,
              paymentCents: item.amount_cents,
            })
          : null,
      };
    });

    // Server-computed totals (thin client IP8): total + per-group subtotals over
    // ACTIVE rows, scoped to `year`/`month` when given (excludes a payment for a
    // month outside its own custom scope, e.g. one that hasn't started yet).
    let totalMonthlyCents = 0;
    const groupTotals = new Map<string | null, number>();
    for (const item of resolvedItems) {
      if (!item.active) continue;
      if (year != null && month != null && !isRecurringPaymentActiveInMonth(item, year, month)) {
        continue;
      }
      totalMonthlyCents += item.amount_cents;
      const key = item.group_label ?? null;
      groupTotals.set(key, (groupTotals.get(key) ?? 0) + item.amount_cents);
    }

    const byGroup = Array.from(groupTotals.entries())
      .map(([group_label, subtotalCents]) => ({ group_label, subtotalCents }))
      // Named groups first (alphabetical); the "Other" catch-all (null) always last.
      .sort((a, b) => {
        if (a.group_label === b.group_label) return 0;
        if (a.group_label === null) return 1;
        if (b.group_label === null) return -1;
        return a.group_label.localeCompare(b.group_label);
      });

    // Saved recurring income per month = sum of active income templates.
    const incomeTemplates = await this.db
      .select({ amount_cents: savingsIncomeTemplates.amount_cents })
      .from(savingsIncomeTemplates)
      .where(
        and(
          eq(savingsIncomeTemplates.household_id, householdId),
          eq(savingsIncomeTemplates.active, true)
        )
      )
      .limit(LIST_INCOME_TEMPLATES_LIMIT)
      .all();
    const savedMonthlyIncomeCents = incomeTemplates.reduce((sum, t) => sum + t.amount_cents, 0);

    // Parse active_months (stored as a JSON string) into a real array for the
    // wire response — done last so the totals loop above still reads the raw
    // string form via isRecurringPaymentActiveInMonth.
    const wireItems = resolvedItems.map((item) => ({
      ...item,
      active_months: parseActiveMonths(item.active_months),
    }));

    return { items: wireItems, totalMonthlyCents, savedMonthlyIncomeCents, byGroup };
  }

  async createRecurringPayment(
    householdId: string,
    userId: string,
    data: {
      id: string;
      category_id?: string | null;
      label: string;
      amount_cents: number;
      day_of_month?: number | null;
      group_label?: string | null;
      is_essential?: boolean;
      active?: boolean;
      is_automated?: boolean;
      source?: string;
      scope_type?: 'all_year' | 'custom_months';
      scope_year?: number | null;
      active_months?: number[] | null;
    }
  ): Promise<RecurringPaymentWire> {
    await this.checkHouseholdAccess(householdId, userId);

    const isAutomated = data.is_automated ?? false;
    // 'custom_months' is the only scope that carries scope_year/active_months —
    // anything else (including omitted) is stored as the 'all_year' default.
    const isCustomScope = data.scope_type === 'custom_months';
    await this.db
      .insert(savingsRecurringPayments)
      .values({
        id: data.id,
        household_id: householdId,
        category_id: data.category_id ?? null,
        label: data.label,
        amount_cents: data.amount_cents,
        // Autopay never needs a due-day nudge — clear it regardless of what
        // the client sent, rather than trust the client kept the two in sync.
        day_of_month: isAutomated ? null : (data.day_of_month ?? null),
        group_label: data.group_label ?? null,
        is_essential: data.is_essential ?? false,
        active: data.active ?? true,
        is_automated: isAutomated,
        scope_type: isCustomScope ? 'custom_months' : 'all_year',
        scope_year: isCustomScope ? (data.scope_year ?? null) : null,
        active_months: isCustomScope ? JSON.stringify(data.active_months ?? []) : null,
        source: data.source ?? 'manual',
        created_by: userId,
      })
      .onConflictDoNothing();

    return toRecurringPaymentWire(await this.requireRecurringPayment(householdId, data.id));
  }

  async updateRecurringPayment(
    householdId: string,
    userId: string,
    id: string,
    data: Partial<{
      category_id: string | null;
      label: string;
      amount_cents: number;
      day_of_month: number | null;
      group_label: string | null;
      is_essential: boolean;
      active: boolean;
      is_automated: boolean;
      scope_type: 'all_year' | 'custom_months';
      scope_year: number | null;
      active_months: number[] | null;
    }>
  ): Promise<RecurringPaymentWire> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.requireRecurringPayment(householdId, id);

    const patch: Record<string, unknown> = { updated_at: now() };
    if (data.category_id !== undefined) patch.category_id = data.category_id;
    if (data.label !== undefined) patch.label = data.label;
    if (data.amount_cents !== undefined) patch.amount_cents = data.amount_cents;
    if (data.day_of_month !== undefined) patch.day_of_month = data.day_of_month;
    if (data.group_label !== undefined) patch.group_label = data.group_label;
    if (data.is_essential !== undefined) patch.is_essential = data.is_essential;
    if (data.active !== undefined) patch.active = data.active;
    if (data.is_automated !== undefined) {
      patch.is_automated = data.is_automated;
      // Turning autopay on clears any due day in the SAME write — enforced
      // here (not just the form) so it also holds for a direct API call.
      if (data.is_automated) patch.day_of_month = null;
    }
    if (data.scope_type !== undefined) {
      // 'all_year' always clears scope_year/active_months in the SAME write —
      // never leave a stale custom scope hanging off a payment that's back to
      // running all year, same enforcement style as autopay above.
      const isCustomScope = data.scope_type === 'custom_months';
      patch.scope_type = isCustomScope ? 'custom_months' : 'all_year';
      patch.scope_year = isCustomScope ? (data.scope_year ?? null) : null;
      patch.active_months = isCustomScope ? JSON.stringify(data.active_months ?? []) : null;
    }

    await this.db
      .update(savingsRecurringPayments)
      .set(patch)
      .where(
        and(
          eq(savingsRecurringPayments.id, id),
          eq(savingsRecurringPayments.household_id, householdId)
        )
      );

    return toRecurringPaymentWire(await this.requireRecurringPayment(householdId, id));
  }

  /**
   * Push a recurring payment's CURRENT template values (amount, label) onto the
   * spending rows it has already materialized, for the periods `${year}-${lo..hi}`.
   * Backs the "edit a monthly payment → apply to this month / this & future months /
   * whole year" scope prompt. Only rows carrying this `recurring_payment_id` are
   * touched, so unrelated ad-hoc spend is never rewritten. Idempotent; returns how
   * many month rows changed.
   */
  async propagateRecurringPaymentToMonths(
    householdId: string,
    userId: string,
    id: string,
    year: number,
    fromMonth: number,
    toMonth: number
  ): Promise<{ updated: number }> {
    await this.checkHouseholdAccess(householdId, userId);
    const payment = await this.requireRecurringPayment(householdId, id);

    const lo = Math.min(fromMonth, toMonth);
    const hi = Math.max(fromMonth, toMonth);
    // Skip months outside the payment's own scope — e.g. picking "whole year"
    // for a payment that only started in March must not push its amount onto
    // an already-materialized January/February row.
    const periods: string[] = [];
    for (let m = lo; m <= hi; m++) {
      if (isRecurringPaymentActiveInMonth(payment, year, m)) periods.push(`${year}-${pad2(m)}`);
    }
    if (periods.length === 0) return { updated: 0 };

    const updated = await this.db
      .update(savingsSpendingEntries)
      .set({
        amount_cents: payment.amount_cents,
        label: payment.label,
        updated_at: now(),
      })
      .where(
        and(
          eq(savingsSpendingEntries.household_id, householdId),
          eq(savingsSpendingEntries.recurring_payment_id, id),
          inArray(savingsSpendingEntries.period, periods)
        )
      )
      .returning({ id: savingsSpendingEntries.id });

    return { updated: updated.length };
  }

  async deleteRecurringPayment(householdId: string, userId: string, id: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.requireRecurringPayment(householdId, id);
    await this.db
      .delete(savingsRecurringPayments)
      .where(
        and(
          eq(savingsRecurringPayments.id, id),
          eq(savingsRecurringPayments.household_id, householdId)
        )
      );
  }

  private async requireRecurringPayment(
    householdId: string,
    id: string
  ): Promise<SavingsRecurringPayment> {
    const row = await this.db
      .select()
      .from(savingsRecurringPayments)
      .where(
        and(
          eq(savingsRecurringPayments.id, id),
          eq(savingsRecurringPayments.household_id, householdId)
        )
      )
      .get();
    if (!row) throw new NotFoundError('Recurring payment');
    return row;
  }

  /**
   * Apply each active recurring payment as a spending entry for the given month.
   * Idempotent via the partial unique index (recurring_payment_id, period).
   * Applied rows are normal spending → flow into getOverview + the essential
   * baseline automatically. Returns { created, skipped }.
   */
  async applyRecurringPayments(
    householdId: string,
    userId: string,
    year: number,
    month: number
  ): Promise<{ created: number; skipped: number }> {
    await this.checkHouseholdAccess(householdId, userId);
    const payments = await this.fetchActiveRecurringPayments(householdId);
    return this.applyRecurringToMonth(householdId, userId, payments, year, month);
  }

  /**
   * Apply active monthly payments to MANY months in one call (per the
   * "apply to these months" checkbox grid). Fetches active payments once, then
   * materializes them into each selected month. Idempotent per month via the
   * (recurring_payment_id, period) unique index — re-running only fills gaps.
   */
  async applyRecurringPaymentsForMonths(
    householdId: string,
    userId: string,
    months: Array<{ year: number; month: number }>,
    // Optional subset: when provided, only these recurring payments are copied
    // (still limited to active payments of the household). Omit/empty ⇒ ALL active.
    paymentIds?: string[]
  ): Promise<{ created: number; skipped: number; months: number }> {
    await this.checkHouseholdAccess(householdId, userId);
    let payments = await this.fetchActiveRecurringPayments(householdId);

    if (paymentIds && paymentIds.length > 0) {
      const wanted = new Set(paymentIds);
      payments = payments.filter((p) => wanted.has(p.id));
    }

    let created = 0;
    let skipped = 0;
    const seen = new Set<string>();
    for (const { year, month } of months) {
      const key = `${year}-${pad2(month)}`;
      if (seen.has(key)) continue; // de-dupe repeated months in the request
      seen.add(key);
      const r = await this.applyRecurringToMonth(householdId, userId, payments, year, month);
      created += r.created;
      skipped += r.skipped;
    }
    return { created, skipped, months: seen.size };
  }

  /**
   * Per-month "already applied" status for the apply-to-months grid of `year`.
   * Lets the client highlight months that already carry this household's
   * monthly payments and badge the ones whose applied snapshot no longer
   * matches the current active payments (amount/count drifted since applying).
   */
  async getRecurringApplyStatus(
    householdId: string,
    userId: string,
    year: number
  ): Promise<RecurringApplyStatus> {
    await this.checkHouseholdAccess(householdId, userId);

    // The baseline a fresh apply would write = current active payments. Kept as
    // a flat year-level summary (matches every payment regardless of month
    // scope) — the per-month `matchesCurrent` below uses the scoped baseline.
    const active = await this.fetchActiveRecurringPayments(householdId);
    const currentCount = active.length;
    const currentTotalCents = active.reduce((sum, p) => sum + p.amount_cents, 0);

    // Applied recurring spend for the year, grouped by period (YYYY-MM).
    const rows = await this.db
      .select({
        period: savingsSpendingEntries.period,
        appliedCents: sql<number>`COALESCE(SUM(${savingsSpendingEntries.amount_cents}), 0)`,
        appliedCount: sql<number>`COUNT(*)`,
      })
      .from(savingsSpendingEntries)
      .where(
        and(
          eq(savingsSpendingEntries.household_id, householdId),
          isNotNull(savingsSpendingEntries.recurring_payment_id),
          like(savingsSpendingEntries.period, `${year}-%`)
        )
      )
      .groupBy(savingsSpendingEntries.period)
      .all();

    const byPeriod = new Map<string, { appliedCents: number; appliedCount: number }>();
    for (const r of rows) {
      if (!r.period) continue;
      byPeriod.set(r.period, { appliedCents: r.appliedCents, appliedCount: r.appliedCount });
    }

    const months: RecurringApplyMonthStatus[] = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      // Scoped baseline for THIS month — a payment configured for specific
      // months of `year` only counts toward months it's actually active in.
      const scopedActive = active.filter((p) => isRecurringPaymentActiveInMonth(p, year, month));
      const scopedCount = scopedActive.length;
      const scopedTotalCents = scopedActive.reduce((sum, p) => sum + p.amount_cents, 0);

      const hit = byPeriod.get(`${year}-${pad2(month)}`);
      const appliedCount = hit?.appliedCount ?? 0;
      const appliedCents = hit?.appliedCents ?? 0;
      const applied = appliedCount > 0;
      // Only "matches" when there ARE active payments and the snapshot equals
      // them — zero active payments can never match an applied month.
      const matchesCurrent =
        applied &&
        scopedCount > 0 &&
        appliedCount === scopedCount &&
        appliedCents === scopedTotalCents;
      return { month, applied, appliedCents, appliedCount, matchesCurrent };
    });

    return { year, currentCount, currentTotalCents, months };
  }

  /**
   * One recurring payment's per-month history for `year` — which months it's
   * in scope for (isRecurringPaymentActiveInMonth) vs. which months already
   * have an applied savings_spending_entries row, and for how much. Backs the
   * Savings → Monthly payment detail sheet's "which months apply" chart.
   */
  async getRecurringPaymentMonthlyHistory(
    householdId: string,
    userId: string,
    recurringPaymentId: string,
    year: number
  ): Promise<RecurringPaymentMonthlyHistory> {
    await this.checkHouseholdAccess(householdId, userId);
    const payment = await this.requireRecurringPayment(householdId, recurringPaymentId);

    const rows = await this.db
      .select({
        period: savingsSpendingEntries.period,
        appliedCents: sql<number>`COALESCE(SUM(${savingsSpendingEntries.amount_cents}), 0)`,
      })
      .from(savingsSpendingEntries)
      .where(
        and(
          eq(savingsSpendingEntries.household_id, householdId),
          eq(savingsSpendingEntries.recurring_payment_id, recurringPaymentId),
          like(savingsSpendingEntries.period, `${year}-%`)
        )
      )
      .groupBy(savingsSpendingEntries.period)
      .all();

    const byPeriod = new Map<string, number>();
    for (const r of rows) {
      if (!r.period) continue;
      byPeriod.set(r.period, r.appliedCents);
    }

    const months = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const period = `${year}-${pad2(month)}`;
      const inScope = isRecurringPaymentActiveInMonth(payment, year, month);
      const applied = byPeriod.has(period);
      const appliedAmountCents = byPeriod.get(period) ?? null;
      return { month, inScope, applied, appliedAmountCents };
    });

    return {
      year,
      amountCents: payment.amount_cents,
      scopeType: payment.scope_type === 'custom_months' ? 'custom_months' : 'all_year',
      months,
    };
  }

  /**
   * All ACTIVE recurring payments' per-group totals for every month of
   * `year` — the Savings → Monthly tab's "distribution by month" chart.
   * Reuses the exact same group-resolution + `isRecurringPaymentActiveInMonth`
   * scoping `listRecurringPayments`'s single-month `byGroup` uses, just
   * looped over all 12 months in one round-trip instead of 12.
   *
   * Every month reads the payment's CURRENT `amount_cents` — never a
   * historical one (that only exists per-payment, for APPLIED months, via
   * `getRecurringPaymentMonthlyHistory` above). A payment whose price
   * changed mid-year shows at today's price for every month here, same as
   * every other total this app shows (Overview, `/trend`, the list itself).
   */
  async getRecurringYearlyGroupBreakdown(
    householdId: string,
    userId: string,
    year: number
  ): Promise<RecurringYearlyGroupBreakdown> {
    await this.checkHouseholdAccess(householdId, userId);

    const items = await this.fetchActiveRecurringPayments(householdId);

    const loanRows = await this.db
      .select({ recurring_payment_id: budgetLoans.recurring_payment_id })
      .from(budgetLoans)
      .where(eq(budgetLoans.household_id, householdId))
      .all();
    const loanIds = new Set(loanRows.map((r) => r.recurring_payment_id));

    const resolvedItems = items.map((item) => ({
      ...item,
      group_label: resolveRecurringGroupLabel(item.label, item.group_label, loanIds.has(item.id)),
    }));

    // Stable ordering across all 12 months — named groups alphabetical, the
    // "Other" catch-all (null) always last — same sort `listRecurringPayments`
    // applies to its own (single-month) `byGroup`.
    const groupKeys = new Set<string | null>();
    for (const item of resolvedItems) groupKeys.add(item.group_label ?? null);
    const groups = Array.from(groupKeys)
      .sort((a, b) => {
        if (a === b) return 0;
        if (a === null) return 1;
        if (b === null) return -1;
        return a.localeCompare(b);
      })
      .map((group_label) => ({ group_label }));

    const months = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const groupTotals = new Map<string | null, number>();
      let totalCents = 0;
      for (const item of resolvedItems) {
        if (!isRecurringPaymentActiveInMonth(item, year, month)) continue;
        totalCents += item.amount_cents;
        const key = item.group_label ?? null;
        groupTotals.set(key, (groupTotals.get(key) ?? 0) + item.amount_cents);
      }
      const byGroup = groups.map((g) => ({
        group_label: g.group_label,
        subtotalCents: groupTotals.get(g.group_label) ?? 0,
      }));
      return { month, totalCents, byGroup };
    });

    return { year, groups, months };
  }

  private async fetchActiveRecurringPayments(householdId: string) {
    return this.db
      .select()
      .from(savingsRecurringPayments)
      .where(
        and(
          eq(savingsRecurringPayments.household_id, householdId),
          eq(savingsRecurringPayments.active, true)
        )
      )
      .limit(LIST_RECURRING_PAYMENTS_LIMIT)
      .all();
  }

  /** Materialize the given active payments into one month's spending entries. */
  private async applyRecurringToMonth(
    householdId: string,
    userId: string,
    payments: Array<typeof savingsRecurringPayments.$inferSelect>,
    year: number,
    month: number
  ): Promise<{ created: number; skipped: number }> {
    const period = `${year}-${pad2(month)}`;
    // Clamp the due day to the month length so day 31 never yields an invalid
    // date (e.g. "2026-02-31") when applying across months.
    const maxDay = new Date(year, month, 0).getDate();
    let created = 0;
    let skipped = 0;

    for (const p of payments) {
      // Month-scoped payments (e.g. a subscription that only started in March)
      // are skipped for months outside their configured scope.
      if (!isRecurringPaymentActiveInMonth(p, year, month)) continue;
      const rawDay = p.day_of_month && p.day_of_month >= 1 ? p.day_of_month : 1;
      const day = Math.min(rawDay, maxDay);
      const spending_date = `${year}-${pad2(month)}-${pad2(day)}`;

      const inserted = await this.db
        .insert(savingsSpendingEntries)
        .values({
          id: crypto.randomUUID(),
          household_id: householdId,
          category_id: p.category_id ?? null,
          label: p.label,
          amount_cents: p.amount_cents,
          spending_date,
          recurring_payment_id: p.id,
          period,
          created_by: userId,
        })
        .onConflictDoNothing()
        .returning();

      if (inserted.length > 0) created++;
      else skipped++;
    }

    return { created, skipped };
  }
}
