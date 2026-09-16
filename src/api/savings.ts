import type { CurrencyCode } from '@config/currencies';

import { api, apiClient } from './client';

/**
 * Savings & Registered accounts API client. Mirrors `src/api/budget.ts`.
 *
 * THIN CLIENT (plan IP8): every money figure (net, YTD, headroom, room, pace),
 * per-group subtotal, and name resolution is computed server-side. These
 * methods only carry input up and render the BE-computed view models back —
 * the client never recomputes financial numbers locally.
 *
 * Base path: /households/:householdId/savings
 */

// ============ Row shapes (mirror schema-savings.ts columns) ============

/**
 * Wire type for an income entry's source. The first five are predictable
 * (regular) income; the last six are one-off (irregular) income.
 *
 * The runtime lists and the regular/irregular classification live in
 * `src/screens/budget/savings/incomeSourceMeta.ts`, NOT here — screens must be
 * able to classify a source without taking a runtime dependency on this API
 * module, which tests routinely `jest.mock`.
 *
 * Mirror of `backend/src/constants/income-sources.ts`; change both together.
 */
export type SavingsIncomeSourceType =
  | 'payroll'
  | 'rental'
  | 'rrsp_matching'
  | 'insurance'
  | 'other'
  | 'marketplace_sale'
  | 'gift'
  | 'refund'
  | 'bonus'
  | 'freelance'
  | 'tax_refund';

export type SavingsGoalType = 'emergency_fund' | 'custom';
export type SavingsGoalStatus = 'active' | 'achieved' | 'archived';
/** Registered / retirement account vehicles. 'dpsp'/'rpp' are employer DC plans (Pension tab). */
export type RegisteredAccountType = 'tfsa' | 'rrsp' | 'fhsa' | 'dpsp' | 'rpp';
export type RegisteredTransactionType = 'contribution' | 'withdrawal';
export type RegisteredTransactionKind = 'regular' | 'manual';
/** Who funded a contribution — drives the self-vs-employer split in room/goal math. */
export type RegisteredContributor = 'self' | 'employer';

export interface SavingsCategory {
  id: string;
  household_id: string;
  name: string;
  icon: string | null;
  color: string | null;
  is_essential: boolean;
  sort_order: number | null;
  created_at: string;
}

export interface SavingsIncomeEntry {
  id: string;
  household_id: string;
  member_id: string | null;
  source_type: SavingsIncomeSourceType;
  label: string;
  amount_cents: number;
  income_date: string;
  currency: string;
  notes: string | null;
  template_id: string | null;
  period: string | null;
  /** 'draft' rows are rollover-generated and awaiting member confirmation; everything else is 'confirmed'. */
  status: 'draft' | 'confirmed';
  /** Set only on rollover-generated drafts — the prior-month entry it was copied from. */
  rolled_over_from_entry_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SavingsSpendingEntry {
  id: string;
  household_id: string;
  category_id: string | null;
  label: string;
  amount_cents: number;
  currency: string;
  spending_date: string;
  notes: string | null;
  recurring_payment_id: string | null;
  period: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SavingsIncomeTemplate {
  id: string;
  household_id: string;
  member_id: string | null;
  source_type: SavingsIncomeSourceType;
  label: string;
  amount_cents: number;
  currency: string;
  day_of_month: number | null;
  active: boolean;
  created_at: string;
}

export interface SavingsGoal {
  id: string;
  household_id: string;
  type: SavingsGoalType;
  name: string;
  target_amount_cents: number;
  current_amount_cents: number;
  target_date: string | null;
  months_of_expenses: number | null;
  monthly_allocation_cents: number | null;
  currency: string;
  status: SavingsGoalStatus;
  created_at: string;
  updated_at: string;
  /** Server-computed monthly pace (cents) needed to hit target by target_date. */
  paceCents?: number;
}

/** Enough of a tracked renewal to render the Monthly-Payments row pill — never the full record. */
export interface RecurringPaymentRenewalSummary {
  next_renewal_date: string;
  status: 'upcoming' | 'renewed' | 'lapsed' | 'cancelled';
  reminder_lead_days: number;
}

/** Enough of a tracked loan to render the Monthly-Payments row pill — see `budgetLoansApi` for the full record. */
export interface RecurringPaymentLoanSummary {
  termMonths: number;
  elapsedMonths: number;
  paymentsRemaining: number;
  currentBalanceCents: number;
  interestPaidToDateCents: number;
  totalInterestCents: number;
  totalCostCents: number;
  payoffDate: string;
}

export interface SavingsRecurringPayment {
  id: string;
  household_id: string;
  category_id: string | null;
  label: string;
  amount_cents: number;
  currency: string;
  day_of_month: number | null;
  group_label: string | null;
  is_essential: boolean;
  active: boolean;
  /** Autopay — when true, `day_of_month` is always null (no due-day nudge needed). */
  is_automated: boolean;
  /**
   * Month scope — 'all_year' (default) runs the payment every month of every
   * year. 'custom_months' restricts it to `active_months` for `scope_year`
   * ONLY (e.g. a payment that started in March or ended in September this
   * year); every other year still runs all 12 months.
   */
  scope_type: 'all_year' | 'custom_months';
  scope_year: number | null;
  /** 1–12, only meaningful when `scope_type` is 'custom_months'. */
  active_months: number[] | null;
  source: 'manual' | 'ai_import';
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Present only when this payment has an active renewal tracked (see `budgetRenewalsApi`). */
  renewal_summary?: RecurringPaymentRenewalSummary | null;
  /** Present only when this payment has a loan tracked (see `budgetLoansApi`). */
  loan_summary?: RecurringPaymentLoanSummary | null;
}

/**
 * One calendar year's month-by-month history for a single recurring payment —
 * "which months did this actually apply to". Backs the Monthly-payment detail
 * sheet's 12-month activity chart (`RecurringPaymentMonthsChart`).
 */
export interface RecurringPaymentMonthlyHistory {
  year: number;
  /** The payment's CURRENT amount — used for a "skipped" ghost bar, never for an applied month. */
  amountCents: number;
  scopeType: 'all_year' | 'custom_months';
  months: Array<{
    month: number; // 1–12
    /** Was the payment scheduled to apply this month (per its scope). */
    inScope: boolean;
    /** Did it actually get applied (a real spending-ledger row exists). */
    applied: boolean;
    /** The historical applied amount for that month, if applied — may differ from `amountCents`. */
    appliedAmountCents: number | null;
  }>;
}

/**
 * Every ACTIVE recurring payment's per-group totals for every month of a
 * year — backs the Savings → Monthly tab's "distribution by month" chart
 * (`RecurringYearlyDistributionChart`).
 */
export interface RecurringYearlyGroupBreakdown {
  year: number;
  /** Every group that appears in ANY month this year, in a STABLE order
   * (named groups alphabetical, "Other" (null) always last) — so a group
   * keeps the same stack position/color across every month's bar. */
  groups: Array<{ group_label: string | null }>;
  months: Array<{
    month: number; // 1–12
    totalCents: number;
    /** One entry per `groups`, in the SAME order — 0 for a month the group has nothing in. */
    byGroup: Array<{ group_label: string | null; subtotalCents: number }>;
  }>;
}

export interface RegisteredAccount {
  id: string;
  household_id: string;
  member_id: string | null;
  account_type: RegisteredAccountType;
  institution: string | null;
  is_employer_plan: boolean;
  employer_name: string | null;
  balance_cents: number;
  starting_room_cents: number | null;
  annual_limit_override_cents: number | null;
  regular_contribution_cents: number | null;
  annual_goal_cents: number | null;
  /** Goal as a % of the room base (simple flow); mutually exclusive with annual_goal_cents. */
  annual_goal_pct: number | null;
  /** Room-only placeholder: room set via the Pension "Room" tab, hidden from Accounts. */
  is_room_only: boolean;
  /** Automatic recurring employer match (simple flow), materialized monthly. */
  employer_match_cents: number | null;
  /** 'YYYY-MM' anchor for recurring backfill (simple flow). */
  recurring_start_month: string | null;
  room_as_of_date: string | null;
  prior_earned_income_cents: number | null;
  pension_adjustment_cents: number | null;
  currency: string;
  created_at: string;
  updated_at: string;
}

export interface RegisteredTransaction {
  id: string;
  account_id: string;
  type: RegisteredTransactionType;
  kind: RegisteredTransactionKind;
  contributor: RegisteredContributor;
  amount_cents: number;
  transaction_date: string;
  tax_year: number | null;
  period: string | null;
  notes: string | null;
  source: 'manual' | 'ai_import';
  import_batch_id: string | null;
  created_by: string | null;
  created_at: string;
}

// ============ Computed view models (BE-authoritative) ============

export interface SavingsOverview {
  year: number;
  month: number;
  income: {
    total: number;
    /**
     * Predictable income — the portion safe to extrapolate forward.
     * Optional: a Worker deployed before the irregular-income split omits it,
     * so clients must fall back to deriving the split from `bySource`.
     */
    regularTotal?: number;
    /** One-off income (marketplace sales, gifts, bonuses …). Actuals only. */
    irregularTotal?: number;
    bySource: Record<string, number>;
    entries: SavingsIncomeEntry[];
  };
  spending: {
    /** Deducted from income = monthlyPayments (flat) + spendings (Budget). */
    total: number;
    /** Fixed monthly obligations = active recurring "Monthly Payments" total. */
    monthlyPayments: number;
    /**
     * Budget "Spendings" this month = SUM(expenses.amount). THE single source of
     * truth for spend — identical to the Budget Spendings tab & Dashboard "Spent".
     */
    spendings: number;
  };
  /** income.total − monthlyPayments − spendings */
  netSavings: number;
  /** Jan→month running sum. */
  ytdNet: number;
  goals: Array<{
    id: string;
    name: string;
    type: SavingsGoalType;
    target: number;
    current: number;
    monthlyAllocation: number | null;
  }>;
}

export interface SavingsTrendPoint {
  period: string; // 'YYYY-MM'
  income: number;
  spending: number;
  net: number;
  /** Flat active recurring total for the month (cents). Split out of `spending`. */
  monthlyPayments: number;
  /** Budget expenses for the month (cents). Split out of `spending`. */
  spendings: number;
  /** False means no real expense was logged this month — `net` rests on
   *  monthly-payment definitions alone, so a running total should treat it
   *  as untracked rather than a genuine $0-spend month. */
  hasExpenseData: boolean;
}

export interface SavingsTrend {
  months: SavingsTrendPoint[];
}

export interface EmergencyFundSuggestion {
  suggestedTarget: number;
  essentialMonthlySpending: number;
  months: number;
  /** 'NO_HISTORY' when there is no essential-spend history to base a target on. */
  note?: string;
}

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
  goalCents: number | null;
  goalContributedCents: number;
  goalRemainingCents: number;
  goalPct: number;
}

// ---- Pension overview (Pension tab, BE-computed) ----

export interface PensionAccountSummary {
  account: RegisteredAccount;
  memberName: string | null;
  room: RegisteredRoom;
}

export interface PensionMemberGroup {
  memberId: string | null;
  memberName: string | null;
  /** Member's avatar URL (null if none) — for row avatars. */
  memberAvatarUrl: string | null;
  totalBalanceCents: number;
  accounts: PensionAccountSummary[];
}

/** One calendar month's recurring contribution split for a member line (backfill grid). */
export interface MemberMonthlyContribution {
  month: number; // 1..12
  selfCents: number;
  employerCents: number;
}

export interface PensionOverview {
  year: number;
  totals: {
    totalBalanceCents: number;
    totalRoomRemainingCents: number;
    totalContributedSelfCents: number;
    totalContributedEmployerCents: number;
    goalCents: number;
    goalContributedCents: number;
    goalPct: number;
  };
  groups: PensionMemberGroup[];
  warnings: string[];
}

// ---- Registered-statement AI import draft (Pension tab) ----

export interface ExtractedRegisteredContribution {
  date: string | null;
  amount: number | null; // dollars
  contributor: RegisteredContributor;
}

export interface ExtractedRegisteredAccount {
  account_type: RegisteredAccountType | null;
  institution: string | null;
  is_employer_plan: boolean;
  employer_name: string | null;
  balance: number | null; // dollars
  reported_room: number | null; // dollars
  contributions: ExtractedRegisteredContribution[];
}

export interface ExtractedRegisteredStatement {
  accounts: ExtractedRegisteredAccount[];
  confidence: number;
  rawText: string;
}

/** One reviewed account the client commits (cents). Targets an existing account or creates a new one. */
export interface RegisteredImportAccountInput {
  existing_account_id?: string | null;
  id?: string;
  member_id?: string | null;
  account_type?: RegisteredAccountType;
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
    contributor?: RegisteredContributor;
    tax_year?: number | null;
  }>;
}

export interface RegisteredImportCommitRequest {
  import_batch_id: string;
  accounts: RegisteredImportAccountInput[];
}

export interface RecurringPaymentGroup {
  group_label: string | null;
  subtotalCents: number;
}

export interface RecurringPaymentsView {
  items: SavingsRecurringPayment[];
  totalMonthlyCents: number;
  /** Sum of active income templates' amount — the saved recurring income per month. */
  savedMonthlyIncomeCents: number;
  byGroup: RecurringPaymentGroup[];
}

/** AI-extracted structured draft for user review before commit (never silent-saved). */
export interface SavingsImportDraft {
  income: Array<{
    member_name: string | null;
    source_type: SavingsIncomeSourceType;
    label: string;
    amount_cents: number;
    income_date: string;
    is_recurring: boolean;
    day_of_month: number | null;
  }>;
  spending: Array<{
    category_name: string | null;
    label: string;
    amount_cents: number;
    spending_date: string;
  }>;
  recurringPayments: Array<{
    label: string;
    amount_cents: number;
    category_name: string | null;
    day_of_month: number | null;
    group_label: string | null;
    is_essential: boolean;
  }>;
  /**
   * Whole-year "previous years" grid cells (one per month × spending column).
   * Present only on a yearly-grid (history-scope) import; committed to budget
   * expenses via importCommitHistory. Optional so pre-existing drafts still type.
   */
  monthlyGridSpending?: SavingsGridSpendingRow[];
}

export interface SavingsGridSpendingRow {
  period: string; // 'YYYY-MM'
  category_name: string; // column header, e.g. 'Food', 'Monthly payments'
  amount_cents: number;
}

export type SavingsImportStatus =
  | 'pending_upload'
  | 'uploaded'
  | 'analyzing'
  | 'ready'
  | 'committed'
  | 'failed';

export interface SavingsImportJob {
  id: string;
  household_id: string;
  status: SavingsImportStatus;
  source_kind: 'file' | 'image' | 'text' | 'drive';
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SavingsImportCommitResult {
  income: number;
  spending: number;
  recurringPayments: number;
}

/** Result of committing a previous-years (yearly-grid) import. */
export interface SavingsHistoryCommitResult {
  income: number;
  spending: number;
  years: number[];
}

/** Selections submitted to importCommitHistory (only the two grid buckets). */
export interface SavingsHistorySelections {
  income: SavingsImportDraft['income'];
  monthlyGridSpending: SavingsGridSpendingRow[];
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

/** One month of a year, mirroring the tracker grid (all cents). */
export interface YearMonthlyRow {
  month: number; // 1..12
  income: number;
  monthlyPayments: number;
  food: number;
  other: number;
  net: number;
}

export interface YearHistoryGoals {
  foodMonthly: number | null;
  otherMonthly: number | null;
  savingsMonthly: number | null;
  savingsYearly: number | null;
  /**
   * The household's Planning-tab budget for each month of the year (index 0 =
   * January), null where none was set. Feeds the Planned Budget / Smart Blend
   * projection methods' "spending goal" term.
   */
  plannedBudgetByMonth: (number | null)[]; // length 12
}

export interface YearHistory {
  year: number;
  months: YearMonthlyRow[]; // length 12
  totals: YearColumnTotals;
  average: YearColumnTotals;
  monthsWithData: number;
  goals: YearHistoryGoals;
}

// ============ Projection view models ============

/**
 * The four ways the Projection tab can forecast a year-end figure. Every
 * method shares the same actual/current/entered/target handling — they only
 * differ in what an untargeted future month falls back to. See
 * `backend/src/services/savings-service.ts`'s `getProjection` doc comment for
 * the exact formulas.
 */
export const PROJECTION_METHODS = [
  'historical_average',
  'trend',
  'planned_budget',
  'hybrid',
] as const;
// Pessimistic is local-scenario-only; legacy remote method choices stay unchanged.
export type ProjectionMethod = (typeof PROJECTION_METHODS)[number] | 'pessimistic';

/**
 * One month of the Projection grid.
 *  - `actual`  — completed: `actualNet` is real. A target on it never changes
 *                the math, but grades the result (`goalHit`/`goalAttainmentPct`).
 *  - `current` — the live month: `actualNet` is real but partial, and a target
 *                may be set on it (a goal to reach, not a replacement).
 *  - `future`  — no data yet; the target, else the household's monthly goal,
 *                else the recent pace, is the projection (`projectionSource`).
 */
export interface SavingsProjectionMonth {
  /** Local scenario forecast: assumptions for this month, in cents. */
  forecastBreakdown?: {
    income: number;
    recurring: number;
    spending: number;
    incomeSource: 'entries' | 'templates' | 'history' | 'missing';
    spendingSource: 'budget' | 'history' | 'missing';
    plannedSpending?: number;
    scenarioSpendingAdjustment?: number;
    loggedSpendingFloorAdjustment?: number;
    recordedNet: number;
  };
  month: number; // 1..12
  status: 'actual' | 'current' | 'future';
  /** Real net savings (income − all spending). Null only for future months. */
  actualNet: number | null;
  /**
   * User-set target for this month (cents), or null. May be negative. Settable
   * on ANY month — including elapsed ones, where it never changes the math
   * (see `projectedNet`) but becomes the benchmark `goalHit` grades against.
   */
  targetCents: number | null;
  /** What this month contributes to `projectedYearEnd`. */
  projectedNet: number;
  /**
   * What drove `projectedNet` for a 'future' month. Null for actual/current.
   *
   * `'entered'` wins over all three plan sources: once the member has put real
   * rows into a month ahead, those rows ARE the forecast for it. Reported
   * 2026-09-09 — a household had filled in October, November and December and
   * the tab still showed each of them at the monthly goal, so the year-end read
   * far above anything their own entries supported.
   */
  projectionSource: 'entered' | 'target' | 'goal' | 'pace' | null;
  hasData: boolean;
  /**
   * Whether this month has any LOGGED SPENDING of its own.
   *
   * Only meaningful for a month ahead whose `projectionSource` is `'entered'`:
   * income is in but spending is not, so the net reads better than the month
   * will really land and the row has to say so. Optional so a client keeps
   * working against a backend that predates the field.
   */
  spendingLogged?: boolean;
  /**
   * One-off income banked this month (gifts, bonuses, sales…). INCLUDED in
   * `actualNet` but excluded from every forward figure, so a windfall can't
   * become the benchmark the household is asked to match.
   */
  oneOffIncome: number;
  /** `actualNet − targetCents` for an elapsed/current month with a target. Null otherwise. */
  goalDeltaCents: number | null;
  /**
   * `100 × actualNet / targetCents`, only for a POSITIVE target (a % of a
   * zero/negative — deficit — target is not meaningful; use `goalHit`). Null
   * otherwise, including every future month.
   */
  goalAttainmentPct: number | null;
  /** `actualNet >= targetCents` for an elapsed/current month with a target. Null otherwise. */
  goalHit: boolean | null;
  /**
   * The Planned Budget method's breakdown for this month — expected income,
   * active recurring payments, and the Planning-tab spending goal, all in
   * cents — independent of which method is currently selected. Null when
   * unresolvable. Feeds the Projection tab's "how is this calculated"
   * explanations with the household's own real numbers.
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
  /** Of those, how many met or beat their target. */
  monthsHit: number;
  /** `monthsHit / monthsTracked × 100`. Null when nothing is tracked yet. */
  hitRatePct: number | null;
  /** Average attainment % across tracked months with a positive target. */
  avgAttainmentPct: number | null;
  /**
   * MEDIAN attainment % across the same months — what the card actually says.
   *
   * The mean is not safe to show here: attainment is a ratio that can go deeply
   * negative (a household reported a June at -122% of its goal), and one month
   * like that drags the mean somewhere no month in the year actually sat. The
   * median describes a typical month and survives the outlier. `avgAttainmentPct`
   * is kept for anything that wants the raw mean. Optional so a client keeps
   * working against a backend that predates the field.
   */
  medianAttainmentPct?: number | null;
}

export interface SavingsProjection {
  /** V2 scenario model. Older remote clients retain methodComparison. */
  forecast?: {
    model: 'cashflow-scenarios-v1';
    sampleMonths: number;
    includesCurrentMonth: boolean;
    scenarios: {
      method: ProjectionMethod;
      label: string;
      projectedYearEnd: number;
      /** Future net plus only the unrecorded remainder of the current month. */
      remainingMonths?: { month: number; netChange: number; recordedNet?: number; fullMonthNet?: number; income?: number; recordedSpending?: number; breakdown?: SavingsProjectionMonth['forecastBreakdown'] }[];
      /** Computed for THIS scenario, even when another scenario is selected. */
      exampleMonth?: { month: number; net: number } & NonNullable<SavingsProjectionMonth['forecastBreakdown']>;
    }[];
    warnings: string[];
    goalGap: number | null;
    requiredMonthly: number | null;
  };
  year: number;
  /** 1..12 when `year` is the live year; null when the year is wholly past/future. */
  currentMonth: number | null;
  months: SavingsProjectionMonth[]; // length 12
  /** Already banked: Σ actual net over completed + current months. */
  actualToDate: number;
  /** Σ targets over the current + future months. */
  targetedRemaining: number;
  /** Months still ahead (excludes the partially-elapsed current month). */
  monthsRemaining: number;
  monthsWithTarget: number;
  /** Banked + each forward month's target (or the pace where none is set). */
  projectedYearEnd: number;
  /**
   * Average REPEATABLE net over the most recent (trailing) completed months
   * with data — "your recent pace". One-off income is excluded so the pace is
   * a figure the household can hit again, and only the last few months count
   * so an early-year slump/spike doesn't drag on a household that has since
   * changed its trend.
   */
  paceMonthly: number;
  paceYearEnd: number;
  /**
   * The household's best completed month — the achievable anchor. `net` is that
   * month's REPEATABLE net, so it may be below the month's `actualNet`.
   */
  bestMonth: { month: number; net: number } | null;
  /** Stretch pace: the best month, never below the pace. Floored at 0. */
  potentialMonthly: number;
  potentialYearEnd: number;
  /** True when a completed month carried one-off income kept out of the pace. */
  excludesOneOffIncome: boolean;
  yearGoal: number | null;
  monthlyGoal: number | null;
  /** How the household's own per-month targets played out this year. */
  goalPerformance: SavingsGoalPerformance;
  /** Which method produced `months`/`projectedYearEnd` above. */
  method: ProjectionMethod;
  /** Every method's year-end figure, for the Projection tab's picker cards. */
  methodComparison: { method: ProjectionMethod; projectedYearEnd: number }[];
}

export interface SetProjectionTargetsRequest {
  year: number;
  /** Months (1–12) to write. One entry = a single month; many = bulk apply. */
  months: number[];
  /** Target in cents, or null to CLEAR (delete) the target on those months. */
  targetCents: number | null;
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
  netPct: number | null;
}

export interface YearComparison {
  years: YearComparisonColumn[];
  deltas: YearComparisonDelta[];
  netByYearMonth: Array<{ year: number; months: number[] }>;
}

// ============ Request payloads ============

/** Money-mutating creates carry a client-generated UUID as the row id (plan W2: idempotent INSERT OR IGNORE). */

/**
 * A savings row stores the currency it was entered in. This used to be a
 * CAD/USD pair, which meant a household that had picked (say) Euro in
 * Settings → Currency still got a "CAD | USD" toggle defaulted to CAD. It now
 * accepts any code the picker offers; the backend validates against the same
 * list.
 */
export type SavingsCurrency = CurrencyCode;

export interface CreateIncomeRequest {
  id: string;
  member_id?: string | null;
  source_type: SavingsIncomeSourceType;
  label: string;
  amount_cents: number;
  income_date: string;
  currency?: SavingsCurrency;
  notes?: string | null;
}

export interface UpdateIncomeRequest {
  member_id?: string | null;
  source_type?: SavingsIncomeSourceType;
  label?: string;
  amount_cents?: number;
  income_date?: string;
  currency?: SavingsCurrency;
  notes?: string | null;
}

export interface CreateSpendingRequest {
  id: string;
  category_id?: string | null;
  label: string;
  amount_cents: number;
  spending_date: string;
  currency?: SavingsCurrency;
  notes?: string | null;
}

export interface UpdateSpendingRequest {
  category_id?: string | null;
  label?: string;
  amount_cents?: number;
  spending_date?: string;
  currency?: SavingsCurrency;
  notes?: string | null;
}

export interface CreateSavingsCategoryRequest {
  name: string;
  icon?: string;
  color?: string;
  is_essential?: boolean;
}

export interface UpdateSavingsCategoryRequest {
  name?: string;
  icon?: string;
  color?: string;
  is_essential?: boolean;
  sort_order?: number;
}

export interface CreateGoalRequest {
  id: string;
  type: SavingsGoalType;
  name: string;
  target_amount_cents: number;
  current_amount_cents?: number;
  target_date?: string | null;
  months_of_expenses?: number | null;
  monthly_allocation_cents?: number | null;
}

export interface UpdateGoalRequest {
  name?: string;
  target_amount_cents?: number;
  current_amount_cents?: number;
  target_date?: string | null;
  months_of_expenses?: number | null;
  monthly_allocation_cents?: number | null;
  status?: SavingsGoalStatus;
}

export interface CreateRegisteredAccountRequest {
  id: string;
  member_id?: string | null;
  account_type: RegisteredAccountType;
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

export type UpdateRegisteredAccountRequest = Partial<Omit<CreateRegisteredAccountRequest, 'id'>>;

export interface AddTransactionRequest {
  id: string;
  type: RegisteredTransactionType;
  kind?: RegisteredTransactionKind;
  contributor?: RegisteredContributor;
  amount_cents: number;
  transaction_date: string;
  tax_year?: number | null;
  notes?: string | null;
}

export interface CreateIncomeTemplateRequest {
  id: string;
  member_id?: string | null;
  source_type: SavingsIncomeSourceType;
  label: string;
  amount_cents: number;
  day_of_month?: number | null;
  active?: boolean;
}

export type UpdateIncomeTemplateRequest = Partial<Omit<CreateIncomeTemplateRequest, 'id'>>;

export interface CreateRecurringPaymentRequest {
  id: string;
  category_id?: string | null;
  label: string;
  amount_cents: number;
  day_of_month?: number | null;
  group_label?: string | null;
  is_essential?: boolean;
  active?: boolean;
  is_automated?: boolean;
  scope_type?: 'all_year' | 'custom_months';
  scope_year?: number | null;
  active_months?: number[] | null;
}

export type UpdateRecurringPaymentRequest = Partial<Omit<CreateRecurringPaymentRequest, 'id'>>;

export interface ApplyMonthRequest {
  year: number;
  month: number;
}

export interface ApplyResult {
  created: number;
  skipped: number;
}

/** Result of applying monthly payments to multiple months at once. */
export interface ApplyMonthsResult extends ApplyResult {
  months: number;
}

/** One month's "already applied" snapshot for the apply-to-months grid. */
export interface RecurringApplyMonthStatus {
  /** 1–12. */
  month: number;
  /** True when the month already carries ≥1 applied recurring payment. */
  applied: boolean;
  /** Sum of applied recurring-payment spend for the month (cents). */
  appliedCents: number;
  /** How many recurring payments are materialized into the month. */
  appliedCount: number;
  /**
   * True when the applied snapshot still equals the CURRENT active payments.
   * False ⇒ re-applying would add new/changed payments (client badges it).
   */
  matchesCurrent: boolean;
}

/** Per-month applied status for one calendar year (BE-computed). */
export interface RecurringApplyStatus {
  year: number;
  currentCount: number;
  currentTotalCents: number;
  months: RecurringApplyMonthStatus[];
}

/**
 * Which bucket the AI importer should focus on. The importer is one screen; each
 * entry point opens it pre-scoped so the AI recognizes that one type. Mirrors the
 * backend `SavingsImportScope`.
 */
export type SavingsImportScope = 'all' | 'income' | 'spending' | 'recurring' | 'history';

// ============ Response envelopes ============

interface CategoriesResponse {
  categories: SavingsCategory[];
}
interface IncomeListResponse {
  entries: SavingsIncomeEntry[];
}
interface SpendingListResponse {
  entries: SavingsSpendingEntry[];
}
interface GoalsResponse {
  goals: SavingsGoal[];
}
interface AccountsResponse {
  accounts: RegisteredAccount[];
}
interface IncomeTemplatesResponse {
  templates: SavingsIncomeTemplate[];
}

const base = (householdId: string) => `/households/${householdId}/savings`;

const remoteSavingsApi = {
  // ---- Overview & trend ----
  getOverview: (householdId: string, year: number, month: number) =>
    apiClient
      .get<SavingsOverview>(`${base(householdId)}/overview`, { params: { year, month } })
      .then((res) => res.data),

  getTrend: (householdId: string, year: number, month: number, months = 6) =>
    apiClient
      .get<SavingsTrend>(`${base(householdId)}/trend`, { params: { year, month, months } })
      .then((res) => res.data),

  // ---- Income ----
  listIncome: (householdId: string, year: number, month: number) =>
    apiClient
      .get<IncomeListResponse>(`${base(householdId)}/income`, { params: { year, month } })
      .then((res) => res.data),

  createIncome: (householdId: string, data: CreateIncomeRequest) =>
    apiClient
      .post<{ entry: SavingsIncomeEntry }>(`${base(householdId)}/income`, data)
      .then((res) => res.data),

  updateIncome: (householdId: string, id: string, data: UpdateIncomeRequest) =>
    apiClient
      .patch<{ entry: SavingsIncomeEntry }>(`${base(householdId)}/income/${id}`, data)
      .then((res) => res.data),

  deleteIncome: (householdId: string, id: string) =>
    apiClient.delete(`${base(householdId)}/income/${id}`),

  /** Confirm a draft (rollover) income row as-is, optionally patching fields in the same call. */
  confirmIncome: (householdId: string, id: string, data?: UpdateIncomeRequest) =>
    apiClient
      .post<{ entry: SavingsIncomeEntry }>(`${base(householdId)}/income/${id}/confirm`, data ?? {})
      .then((res) => res.data),

  /** Confirm every still-draft income row for one month at once. */
  confirmAllDraftIncome: (householdId: string, year: number, month: number) =>
    apiClient
      .post<{ confirmed: number }>(`${base(householdId)}/income/confirm-all-drafts`, { year, month })
      .then((res) => res.data),

  // ---- Spending ----
  listSpending: (householdId: string, year: number, month: number) =>
    apiClient
      .get<SpendingListResponse>(`${base(householdId)}/spending`, { params: { year, month } })
      .then((res) => res.data),

  createSpending: (householdId: string, data: CreateSpendingRequest) =>
    apiClient
      .post<{ entry: SavingsSpendingEntry }>(`${base(householdId)}/spending`, data)
      .then((res) => res.data),

  updateSpending: (householdId: string, id: string, data: UpdateSpendingRequest) =>
    apiClient
      .patch<{ entry: SavingsSpendingEntry }>(`${base(householdId)}/spending/${id}`, data)
      .then((res) => res.data),

  deleteSpending: (householdId: string, id: string) =>
    apiClient.delete(`${base(householdId)}/spending/${id}`),

  // ---- Categories ----
  listCategories: (householdId: string) =>
    apiClient
      .get<CategoriesResponse>(`${base(householdId)}/categories`)
      .then((res) => res.data),

  createCategory: (householdId: string, data: CreateSavingsCategoryRequest) =>
    apiClient
      .post<{ category: SavingsCategory }>(`${base(householdId)}/categories`, data)
      .then((res) => res.data),

  updateCategory: (householdId: string, id: string, data: UpdateSavingsCategoryRequest) =>
    apiClient
      .patch<{ category: SavingsCategory }>(`${base(householdId)}/categories/${id}`, data)
      .then((res) => res.data),

  deleteCategory: (householdId: string, id: string) =>
    apiClient.delete(`${base(householdId)}/categories/${id}`),

  // ---- Goals (Phase 2) ----
  listGoals: (householdId: string) =>
    apiClient.get<GoalsResponse>(`${base(householdId)}/goals`).then((res) => res.data),

  createGoal: (householdId: string, data: CreateGoalRequest) =>
    apiClient
      .post<{ goal: SavingsGoal }>(`${base(householdId)}/goals`, data)
      .then((res) => res.data),

  updateGoal: (householdId: string, id: string, data: UpdateGoalRequest) =>
    apiClient
      .patch<{ goal: SavingsGoal }>(`${base(householdId)}/goals/${id}`, data)
      .then((res) => res.data),

  deleteGoal: (householdId: string, id: string) =>
    apiClient.delete(`${base(householdId)}/goals/${id}`),

  getEmergencyFundSuggestion: (householdId: string, months = 6) =>
    apiClient
      .get<EmergencyFundSuggestion>(`${base(householdId)}/goals/emergency-fund/suggestion`, {
        params: { months },
      })
      .then((res) => res.data),

  // ---- Registered accounts (Phase 3) ----
  listAccounts: (householdId: string) =>
    apiClient.get<AccountsResponse>(`${base(householdId)}/registered`).then((res) => res.data),

  /** Pension tab Accounts view: all accounts grouped by member with room + goal, BE-computed. */
  getRegisteredOverview: (householdId: string, year: number) =>
    apiClient
      .get<PensionOverview>(`${base(householdId)}/registered/overview`, { params: { year } })
      .then((res) => res.data),

  createAccount: (householdId: string, data: CreateRegisteredAccountRequest) =>
    apiClient
      .post<{ account: RegisteredAccount }>(`${base(householdId)}/registered`, data)
      .then((res) => res.data),

  /**
   * Pension simple flow: set a member's line (RRSP/TFSA) — room, goal (amount OR %),
   * automated recurring monthly contribution, and employer match — without a full
   * account. All value fields are PATCH (omit = unchanged, 0 = clear). `account` is null
   * when the line was cleared/no-op.
   */
  setMemberLine: (
    householdId: string,
    data: {
      member_id: string;
      account_type: 'tfsa' | 'rrsp';
      room_cents?: number;
      goal_cents?: number | null;
      goal_pct?: number | null;
      regular_contribution_cents?: number | null;
      employer_match_cents?: number | null;
    }
  ) =>
    apiClient
      .put<{ account: RegisteredAccount | null }>(
        `${base(householdId)}/registered/member-room`,
        data
      )
      .then((res) => res.data),

  /**
   * Pension simple flow: add a manual contribution (self or employer) to a member's
   * line without a full account; the line is created if it doesn't exist yet.
   */
  addMemberContribution: (
    householdId: string,
    data: {
      /** Client-supplied transaction id → idempotent on retry/double-tap. */
      id?: string;
      member_id: string;
      account_type: 'tfsa' | 'rrsp';
      amount_cents: number;
      contributor?: 'self' | 'employer';
      /** Optional employer-match portion logged alongside the primary (self) amount. */
      employer_amount_cents?: number;
      transaction_date?: string;
    }
  ) =>
    apiClient
      .post<{ account: RegisteredAccount; transaction: RegisteredTransaction }>(
        `${base(householdId)}/registered/member-contribution`,
        data
      )
      .then((res) => res.data),

  /**
   * Pension simple flow: the year's per-month recurring contribution totals (self +
   * employer) for a member's line — one entry per calendar month — to pre-fill the
   * backfill grid. Ad-hoc manual contributions are a separate lane and not included.
   */
  getMemberMonthly: (
    householdId: string,
    memberId: string,
    accountType: 'tfsa' | 'rrsp',
    year: number
  ) =>
    apiClient
      .get<{ months: MemberMonthlyContribution[] }>(
        `${base(householdId)}/registered/member-monthly`,
        { params: { member_id: memberId, account_type: accountType, year } }
      )
      .then((res) => res.data),

  /**
   * Pension simple flow: replace a member line's monthly contributions for a whole tax
   * year with per-month self/employer amounts (real statements differ month to month).
   * Idempotent — re-saving overwrites the year's monthly rows, never double-counts.
   */
  backfillMemberContributions: (
    householdId: string,
    data: {
      member_id: string;
      account_type: 'tfsa' | 'rrsp';
      year: number;
      entries: Array<{ month: number; self_cents: number; employer_cents: number }>;
    }
  ) =>
    apiClient
      .put<{ account: RegisteredAccount }>(
        `${base(householdId)}/registered/member-backfill`,
        data
      )
      .then((res) => res.data),

  /**
   * Pension simple flow: delete a member line's contributions for a tax year and switch off
   * its recurring automation (room + goal preserved). `account` is null when the line was
   * left with nothing and removed entirely.
   */
  deleteMemberContributions: (
    householdId: string,
    data: { member_id: string; account_type: 'tfsa' | 'rrsp'; year: number }
  ) =>
    apiClient
      .delete<{ account: RegisteredAccount | null }>(
        `${base(householdId)}/registered/member-contributions`,
        {
          params: {
            member_id: data.member_id,
            account_type: data.account_type,
            year: data.year,
          },
        }
      )
      .then((res) => res.data),

  updateAccount: (householdId: string, id: string, data: UpdateRegisteredAccountRequest) =>
    apiClient
      .patch<{ account: RegisteredAccount }>(`${base(householdId)}/registered/${id}`, data)
      .then((res) => res.data),

  deleteAccount: (householdId: string, id: string) =>
    apiClient.delete(`${base(householdId)}/registered/${id}`),

  addTransaction: (householdId: string, accountId: string, data: AddTransactionRequest) =>
    apiClient
      .post<{ transaction: RegisteredTransaction; account: RegisteredAccount }>(
        `${base(householdId)}/registered/${accountId}/transactions`,
        data
      )
      .then((res) => res.data),

  deleteTransaction: (householdId: string, accountId: string, txId: string) =>
    apiClient.delete(`${base(householdId)}/registered/${accountId}/transactions/${txId}`),

  getRoom: (householdId: string, accountId: string, year: number) =>
    apiClient
      .get<RegisteredRoom>(`${base(householdId)}/registered/${accountId}/room`, {
        params: { year },
      })
      .then((res) => res.data),

  applyRegularContribution: (householdId: string, accountId: string, data: ApplyMonthRequest) =>
    apiClient
      .post<{ created: boolean; transaction: RegisteredTransaction | null; account: RegisteredAccount }>(
        `${base(householdId)}/registered/${accountId}/apply-regular`,
        data
      )
      .then((res) => res.data),

  // ---- Registered-statement AI import (Pension tab) ----
  /** Extract a draft from pasted text (no persistence). */
  extractRegisteredStatementText: (householdId: string, text: string) =>
    apiClient
      .post<{ draft: ExtractedRegisteredStatement }>(
        `${base(householdId)}/import/registered-extract`,
        { text }
      )
      .then((res) => res.data),

  /** Extract a draft from an uploaded PDF/image statement (no persistence). */
  extractRegisteredStatementFile: (
    householdId: string,
    file: { uri: string; name: string; type: string },
    text?: string
  ) => {
    const form = new FormData();
    // React Native FormData file shape.
    form.append('file', { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
    if (text) form.append('text', text);
    return apiClient
      .post<{ draft: ExtractedRegisteredStatement }>(
        `${base(householdId)}/import/registered-extract`,
        form,
        // A vision extraction (upload + model read) routinely runs past the
        // default 30s API timeout — override it so axios doesn't abort mid-read.
        { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 }
      )
      .then((res) => res.data);
  },

  /** Commit a reviewed statement draft → creates/updates accounts + contributions. */
  commitRegisteredImport: (householdId: string, data: RegisteredImportCommitRequest) =>
    apiClient
      .post<{ import_batch_id: string; createdAccountIds: string[]; transactionCount: number }>(
        `${base(householdId)}/import/registered-commit`,
        data
      )
      .then((res) => res.data),

  /** Undo a committed import batch (reverses balances + deletes its transactions). */
  undoRegisteredImport: (householdId: string, importBatchId: string) =>
    apiClient
      .post<{ deleted: number }>(`${base(householdId)}/import/registered-undo`, {
        import_batch_id: importBatchId,
      })
      .then((res) => res.data),

  // ---- Income templates (Phase 4) ----
  listIncomeTemplates: (householdId: string) =>
    apiClient
      .get<IncomeTemplatesResponse>(`${base(householdId)}/income-templates`)
      .then((res) => res.data),

  createIncomeTemplate: (householdId: string, data: CreateIncomeTemplateRequest) =>
    apiClient
      .post<{ template: SavingsIncomeTemplate }>(`${base(householdId)}/income-templates`, data)
      .then((res) => res.data),

  updateIncomeTemplate: (householdId: string, id: string, data: UpdateIncomeTemplateRequest) =>
    apiClient
      .patch<{ template: SavingsIncomeTemplate }>(`${base(householdId)}/income-templates/${id}`, data)
      .then((res) => res.data),

  deleteIncomeTemplate: (householdId: string, id: string) =>
    apiClient.delete(`${base(householdId)}/income-templates/${id}`),

  applyIncomeTemplates: (householdId: string, data: ApplyMonthRequest) =>
    apiClient
      .post<ApplyResult>(`${base(householdId)}/income/apply-templates`, data)
      .then((res) => res.data),

  // ---- Recurring "Monthly Payments" (Phase 5) ----
  /** Pass year/month to scope totalMonthlyCents/byGroup to what's active THAT month. */
  listRecurringPayments: (householdId: string, year?: number, month?: number) =>
    apiClient
      .get<RecurringPaymentsView>(`${base(householdId)}/recurring-payments`, {
        params: year != null && month != null ? { year, month } : undefined,
      })
      .then((res) => res.data),

  createRecurringPayment: (householdId: string, data: CreateRecurringPaymentRequest) =>
    apiClient
      .post<{ item: SavingsRecurringPayment }>(`${base(householdId)}/recurring-payments`, data)
      .then((res) => res.data),

  updateRecurringPayment: (householdId: string, id: string, data: UpdateRecurringPaymentRequest) =>
    apiClient
      .patch<{ item: SavingsRecurringPayment }>(`${base(householdId)}/recurring-payments/${id}`, data)
      .then((res) => res.data),

  deleteRecurringPayment: (householdId: string, id: string) =>
    apiClient.delete(`${base(householdId)}/recurring-payments/${id}`),

  /** One year's month-by-month "did this apply" history for one recurring payment. */
  getRecurringPaymentMonthlyHistory: (householdId: string, id: string, year: number) =>
    apiClient
      .get<RecurringPaymentMonthlyHistory>(
        `${base(householdId)}/recurring-payments/${id}/monthly-history`,
        { params: { year } }
      )
      .then((res) => res.data),

  /**
   * After editing a monthly payment, push its new amount/category/label onto the
   * months it already materialized. The span comes from the user's scope choice:
   * this month → { fromMonth: m, toMonth: m }, this & future → { m, 12 },
   * whole year → { 1, 12 }. Only that payment's rows are rewritten.
   */
  propagateRecurringPayment: (
    householdId: string,
    id: string,
    data: { year: number; fromMonth: number; toMonth: number }
  ) =>
    apiClient
      .post<{ updated: number }>(
        `${base(householdId)}/recurring-payments/${id}/propagate`,
        data
      )
      .then((res) => res.data),

  applyRecurringPayments: (householdId: string, data: ApplyMonthRequest) =>
    apiClient
      .post<ApplyResult>(`${base(householdId)}/recurring-payments/apply`, data)
      .then((res) => res.data),

  /** Apply active monthly payments to several months at once (checkbox grid). */
  applyRecurringPaymentsToMonths: (
    householdId: string,
    months: Array<{ year: number; month: number }>
  ) =>
    apiClient
      .post<ApplyMonthsResult>(`${base(householdId)}/recurring-payments/apply`, { months })
      .then((res) => res.data),

  /** Per-month "already applied" snapshot for the apply-to-months grid. */
  getRecurringApplyStatus: (householdId: string, year: number) =>
    apiClient
      .get<RecurringApplyStatus>(`${base(householdId)}/recurring-payments/apply-status`, {
        params: { year },
      })
      .then((res) => res.data),

  /** One year's per-group totals for every month — the Monthly tab's "distribution by month" chart. */
  getRecurringYearlyGroupBreakdown: (householdId: string, year: number) =>
    apiClient
      .get<RecurringYearlyGroupBreakdown>(`${base(householdId)}/recurring-payments/yearly-breakdown`, {
        params: { year },
      })
      .then((res) => res.data),

  // ---- AI data import (Phase 5) ----
  importAnalyze: (householdId: string, text: string, scope: SavingsImportScope = 'all') =>
    apiClient
      .post<{ jobId: string; draft: SavingsImportDraft }>(`${base(householdId)}/import`, {
        text,
        scope,
      })
      .then((res) => res.data),

  importAnalyzeWithFile: (
    householdId: string,
    file: { uri: string; type: string; name: string },
    text?: string,
    scope: SavingsImportScope = 'all'
  ) => {
    const formData = new FormData();
    if (text?.trim()) formData.append('text', text.trim());
    formData.append('scope', scope);
    formData.append('file', {
      uri: file.uri,
      type: file.type,
      name: file.name,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RN FormData file part shape
    } as any);
    return api.upload<{ jobId: string; draft: SavingsImportDraft }>(
      `${base(householdId)}/import`,
      formData
    );
  },

  importGet: (householdId: string, jobId: string) =>
    apiClient
      .get<{ job: SavingsImportJob; draft: SavingsImportDraft | null }>(
        `${base(householdId)}/import/${jobId}`
      )
      .then((res) => res.data),

  importCommit: (householdId: string, jobId: string, selections: SavingsImportDraft) =>
    apiClient
      .post<SavingsImportCommitResult>(`${base(householdId)}/import/${jobId}/commit`, { selections })
      .then((res) => res.data),

  /** Commit a previous-years (yearly-grid) import → savings income + budget expenses. */
  importCommitHistory: (
    householdId: string,
    jobId: string,
    selections: SavingsHistorySelections
  ) =>
    apiClient
      .post<SavingsHistoryCommitResult>(`${base(householdId)}/import/${jobId}/commit-history`, {
        selections,
      })
      .then((res) => res.data),

  /** Undo a previous-years import batch (deletes only its history_import rows). */
  importUndoHistory: (householdId: string, jobId: string) =>
    apiClient
      .post<{ income: number; spending: number }>(
        `${base(householdId)}/import/${jobId}/undo-history`,
        {}
      )
      .then((res) => res.data),

  importDelete: (householdId: string, jobId: string) =>
    apiClient.delete(`${base(householdId)}/import/${jobId}`),

  // ---- Previous-years history & comparison ----
  /** Years that have any income/spending data (descending). */
  getHistoryYears: (householdId: string) =>
    apiClient
      .get<{ years: number[] }>(`${base(householdId)}/history/years`)
      .then((res) => res.data.years),

  /** A single year as the tracker grid (12 months + totals/avg/goals). */
  getYearHistory: (householdId: string, year: number) =>
    apiClient
      .get<YearHistory>(`${base(householdId)}/history/year`, { params: { year } })
      .then((res) => res.data),

  // ---- Projection ----
  /**
   * One year as actuals + forward targets + the three year-end figures, for
   * `method` (omit to use the household's stored default — see
   * `setDefaultProjectionMethod`).
   */
  getProjection: (householdId: string, year: number, method?: ProjectionMethod) =>
    apiClient
      .get<SavingsProjection>(`${base(householdId)}/projection`, { params: { year, method } })
      .then((res) => res.data),

  /** Set/clear the target on one month or every remaining month. Returns the recomputed projection. */
  setProjectionTargets: (householdId: string, data: SetProjectionTargetsRequest) =>
    apiClient
      .put<SavingsProjection>(`${base(householdId)}/projection/targets`, data)
      .then((res) => res.data),

  /**
   * Set the household-wide default Projection method — what Home, the widget
   * and the Watch all read. Returns the recomputed projection under the new
   * default.
   */
  setDefaultProjectionMethod: (householdId: string, year: number, method: ProjectionMethod) =>
    apiClient
      .put<SavingsProjection>(`${base(householdId)}/projection/method`, { year, method })
      .then((res) => res.data),

  /** Compare up to 5 years (totals/avg per year + deltas + net-by-month). */
  compareYears: (householdId: string, years: number[]) =>
    apiClient
      .get<YearComparison>(`${base(householdId)}/history/compare`, {
        params: { years: years.join(',') },
      })
      .then((res) => res.data),
};

/**
 * Savings API facade — routes to the local ledger when Budget local-first is on.
 * Registered accounts and AI import remain unsupported offline
 * (`BudgetLocalUnsupportedError`); other core Savings tab methods are local.
 */
export const savingsApi: typeof remoteSavingsApi = new Proxy(remoteSavingsApi, {
  get(target, prop, receiver) {
    try {
      const { isBudgetLocalFirst } =
        require('@features/budget/local/flag') as typeof import('@features/budget/local/flag');
      if (isBudgetLocalFirst()) {
        const { localSavingsApi } =
          require('@features/budget/local/savings/localSavingsApi') as typeof import('@features/budget/local/savings/localSavingsApi');
        const { BudgetLocalUnsupportedError } =
          require('@features/budget/local/errors') as typeof import('@features/budget/local/errors');
        const localFn = (localSavingsApi as Record<string | symbol, unknown>)[prop];
        if (typeof localFn === 'function') {
          return localFn.bind(localSavingsApi);
        }
        throw new BudgetLocalUnsupportedError(String(prop));
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'BudgetLocalUnsupportedError') {
        throw err;
      }
      // Feature not ready — fall through to remote.
    }
    const value = Reflect.get(target, prop, receiver);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
