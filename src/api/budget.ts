import axios from 'axios';

import {
  ReceiptScanStreamUnsupportedError,
  scanReceiptStreaming,
} from './budgetReceiptScanStream';
import { api, apiClient } from './client';

/**
 * Live progress from a receipt scan. `uploading` knows its end (bytes);
 * `reading` does not — `items` is how many lines the model has written so far,
 * a monotonic counter with no knowable total. Never derive a percentage from it.
 */
export type ReceiptScanProgress =
  | { stage: 'uploading'; fraction: number }
  | { stage: 'reading'; items: number };

// Types
export interface BudgetCategory {
  id: string;
  household_id: string;
  name: string;
  icon: string | null;
  color: string | null;
  sort_order: number | null;
  created_at: string;
  /** Times used across budget items + expenses. Categories are returned with the most-used first. */
  usage_count?: number;
  /** True for app-seeded default categories — these can be hidden (toggled) but not deleted. */
  is_default?: boolean;
  /** Hidden categories are toggled off: excluded from pickers, still available to switch back on. */
  hidden?: boolean;
  /**
   * Ids of same-name rows this category absorbed (local-first only — see
   * `features/budget/local/categoryDedupe`). A spending still filed under one
   * of them, delivered by a peer after the merge, is re-pointed here.
   */
  merged_from?: string[];
}

export interface BudgetItem {
  id: string;
  household_id: string;
  category_id: string | null;
  timeframe: string;
  year: number | null;
  quarter: number | null;
  title: string;
  description: string | null;
  estimated_cost_min: number | null;
  estimated_cost_max: number | null;
  actual_cost: number | null;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'planned' | 'in_progress' | 'completed' | 'deferred' | 'cancelled';
  is_recurring: boolean;
  recurrence_frequency: string | null;
  source_type: string | null;
  source_id: string | null;
  target_date: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimelineItem {
  id: string;
  title: string;
  description: string | null;
  estimatedCostMin: number | null;
  estimatedCostMax: number | null;
  actualCost: number | null;
  priority: string;
  status: string;
  targetDate: string | null;
  timeframe: string;
  year: number | null;
  quarter: number | null;
  sourceType: string | null;
  sourceId: string | null;
  category: BudgetCategory | null;
  createdAt: string;
}

export interface TimelineSummary {
  timeframe: string;
  label: string;
  itemCount: number;
  totalEstimatedMin: number;
  totalEstimatedMax: number;
  totalActual: number;
  items: TimelineItem[];
}

export interface CategoryStats {
  category: BudgetCategory;
  itemCount: number;
  totalEstimated: number;
  totalSpent: number;
}

export interface BudgetOverview {
  timeline: TimelineSummary[];
  totalPlanned: { min: number; max: number };
  totalSpent: number;
  categories: CategoryStats[];
}

export interface BudgetGoal {
  id: string;
  household_id: string;
  year: number;
  month: number;
  planned_budget: number | null;
  actual_spent: number;
  category_budgets: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScoredBudgetItem {
  id: string;
  title: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  target_date: string | null;
  status: BudgetItem['status'];
  estimatedCost: number;
  score: number;
  reason: string;
}

export interface AffordabilityPlan {
  remaining_budget: number;
  used_budget: number;
  affordable: ScoredBudgetItem[];
  deferred: ScoredBudgetItem[];
}

export interface MonthlyOverview {
  goal: BudgetGoal;
  plannedBudget: number;
  actualSpent: number;
  committedTotal: number;
  /** Leftover carried IN from the prior month via a "next month" transfer, in cents. */
  carriedIn?: number;
  /** Leftover moved OUT of this month to any transfer destination, in cents. */
  transferredOut?: number;
  remainingBudget: number;
  affordability: AffordabilityPlan;
  /**
   * Whole-year affordability fit (planned items vs. the remaining annual
   * budget). Powers the "This year" window on the Planned-spending-fit card.
   * Optional so the client degrades gracefully against an older API response.
   */
  yearAffordability?: AffordabilityPlan;
  /**
   * Quarter-scoped fit (planned items vs. the pooled leftover of the calendar
   * quarter containing this month). Powers the "This quarter" window. Optional
   * so the client degrades gracefully against an older API response.
   */
  quarterAffordability?: AffordabilityPlan;
  /** Next-month fit — powers the "Next month" window. Optional (older API). */
  nextMonthAffordability?: AffordabilityPlan;
  /** Next-calendar-year fit — powers the "Next year" window. Optional (older API). */
  nextYearAffordability?: AffordabilityPlan;
  /** Open planned spendings for this month. */
  items: BudgetItem[];
  /** Recorded expenses this month. */
  expenses: Expense[];
  itemCount: number;
  /** Total saved on discounts/sales this month, in cents. */
  savedTotal: number;
  /** Container deposits + US CRV paid this month, in cents. */
  depositsTotal?: number;
  /**
   * Sales tax included in this month's spending, in cents (Σ `Expense.tax_amount`
   * of rows dated in the month). Optional (older API).
   */
  taxesTotal?: number;
  /** Per-category sub-budget caps + spend for this month. Optional (older API). */
  subBudgets?: SubBudgetSummary;
  /**
   * Every bulk-purchase portion landing in this month, including the
   * purchase-month portion of a purchase made this month. `actualSpent` already
   * counts them; the list is for rendering.
   */
  bulkPortions?: BulkPortionView[];
  /** Σ portions from purchases made in EARLIER months (the "From bulk purchases" group). */
  bulkReservedTotal?: number;
  /** Cash paid this month but counted in later months. */
  bulkDeferredTotal?: number;
  /** Last 'YYYY-MM' any plan in the household reaches, or null. Caps forward navigation. */
  bulkLastMonth?: string | null;
}

// ============ SUB-BUDGETS (per-category caps) ============

export type SubBudgetLimitType = 'amount' | 'percent';

/** Where a resolved sub-budget cap came from, in precedence order. */
export type SubBudgetScope = 'month' | 'default' | 'legacy';

/** A raw stored sub-budget row (recurring default when month is null). */
export interface SubBudget {
  id: string;
  household_id: string;
  category_id: string;
  year: number;
  /** null = recurring default for the year; 1-12 = single-month override. */
  month: number | null;
  limit_type: SubBudgetLimitType;
  amount_cents: number | null;
  /** Basis points 0-10000 (0-100%) when limit_type = 'percent'. */
  percent_bps: number | null;
  created_at: string;
  updated_at: string;
}

/** A resolved sub-budget cap joined with its category and this month's spend. */
export interface SubBudgetProgress {
  category_id: string;
  name: string;
  icon: string | null;
  color: string | null;
  limit_type: SubBudgetLimitType;
  percent_bps: number | null;
  /** Cap resolved to cents for this month (percent caps resolved against the total). */
  cap_cents: number;
  spent_cents: number;
  /** cap_cents - spent_cents (negative when over). */
  remaining_cents: number;
  over: boolean;
  scope: SubBudgetScope;
}

export interface SubBudgetTotals {
  totalCapCents: number;
  plannedBudget: number;
  /** How far the sub-budgets exceed the month's total, in cents (0 when within). */
  overAllocatedBy: number;
}

/** getMonthlyOverview embeds this; the sub-budgets screen fetches the full form. */
export interface SubBudgetSummary {
  entries: SubBudgetProgress[];
  totalCapCents: number;
  plannedBudget: number;
  overAllocatedBy: number;
}

// ============ BUDGET TRANSFERS ============

export type TransferDestinationType = 'next_month' | 'savings_goal' | 'registered_account';

/** A place this month's leftover can be moved to (backend-built, client renders). */
export interface TransferDestinationOption {
  type: TransferDestinationType;
  /** Goal/account id; null for next_month. */
  id: string | null;
  label: string;
  sublabel: string | null;
  /** Ionicon name. */
  icon: string;
}

/** A recorded transfer, with a stable label for history rows. */
export interface BudgetTransferRecord {
  id: string;
  amountCents: number;
  destinationType: TransferDestinationType;
  destinationLabel: string;
  note: string | null;
  createdAt: string;
}

/** Everything the Budget Transfer screen renders, in one payload. */
export interface BudgetTransferContext {
  year: number;
  month: number;
  monthLabel: string;
  /** Available to move now = max(0, remaining) for this month, in cents. */
  leftoverCents: number;
  plannedBudgetCents: number;
  actualSpentCents: number;
  carriedInCents: number;
  transferredOutCents: number;
  /** Cash paid this month that the month lens counts in later months (bulk purchases). */
  bulkDeferredCents?: number;
  destinations: TransferDestinationOption[];
  history: BudgetTransferRecord[];
}

export interface CreateTransferRequest {
  source_year: number;
  source_month: number;
  amount_cents: number;
  destination_type: TransferDestinationType;
  destination_id?: string | null;
  note?: string | null;
}

export interface BudgetInsightAlert {
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface BudgetInsights {
  summary: string;
  alerts: BudgetInsightAlert[];
  recommendations: string[];
  projected_month_end_balance: number;
  generatedAt: string;
  cached: boolean;
}

export type BudgetEncouragementTone = 'celebrate' | 'positive' | 'neutral' | 'watch' | 'tip';

/**
 * Upbeat "Budget Wins" card. Fully computed server-side (copy + all dollar
 * figures) — the client only renders these strings and maps `tone` to a color.
 */
export interface BudgetEncouragement {
  tone: BudgetEncouragementTone;
  emoji: string;
  headline: string;
  message: string;
  highlight: string | null;
  plannedBudgetCents: number;
  actualSpentCents: number;
  remainingBudgetCents: number;
  paceSavingsCents: number | null;
  spentThisWeekCents: number;
  spentLastWeekCents: number;
  weekOverWeekDeltaCents: number | null;
  ytdSavingsCents: number;
  monthsUnderBudgetStreak: number;
  isPositive: boolean;
}

/** A draft spending produced by the AI "add in words" flow — not yet saved. */
export interface SuggestedSpending {
  title: string;
  description: string | null;
  estimated_cost_min: number | null;
  estimated_cost_max: number | null;
  priority: 'critical' | 'high' | 'medium' | 'low';
  category_id: string | null;
  category_name: string | null;
  scheduled: boolean;
  target_date: string | null;
  is_recurring: boolean;
  recurrence_frequency: 'monthly' | 'quarterly' | 'yearly' | null;
}

// ============ BULK PURCHASES (stock-up spreading) ============
// See documents/requirements/Bulk Purchases/. One purchase, paid once, is
// counted by the month lens in portions over consecutive months. The plan is a
// field of the expense row; portions are DERIVED (`splitEvenly`), never stored.

/** How the estimator arrived at its suggestion. Kept for display and evaluation. */
export type BulkEstimateBasis =
  | 'own_precedent'
  | 'product_rate'
  | 'product_cadence'
  | 'related_products'
  | 'category_rate'
  | 'default';

/** Spreads a stock-up purchase over consecutive months. Absent or null = ordinary spending. */
export interface ExpenseBulkPlan {
  /** Consecutive months the purchase covers, 2..12. */
  months: number;
  /** 'YYYY-MM' of the first portion. v1 always writes the purchase month. */
  start_month: string;
  /** What the estimator proposed when the plan was saved; null when it had nothing to say. */
  suggested_months: number | null;
  basis: BulkEstimateBasis | null;
  /** Measured quantity when the member or a receipt stated one. */
  quantity?: number | null;
  /** Unit exactly as entered or printed ("kg", "lb", "pack"). */
  unit?: string | null;
}

/** What a caller sends to create or replace a plan; `start_month` defaults to the purchase month. */
export interface BulkPlanInput {
  months: number;
  start_month?: string;
  suggested_months?: number | null;
  basis?: BulkEstimateBasis | null;
  quantity?: number | null;
  unit?: string | null;
}

/** One month's share of a bulk purchase, as the month lens sees it. */
export interface BulkPortionView {
  expenseId: string;
  title: string;
  category_id: string | null;
  vendor: string | null;
  /** `expense_date` of the parent purchase. */
  purchase_date: string;
  start_month: string;
  months: number;
  /** 1-based position of this portion in the plan. */
  index: number;
  /** 'YYYY-MM' the portion lands in. */
  month: string;
  portion_cents: number;
  /** Parent amount, tax-inclusive. */
  total_cents: number;
}

export type BulkConfidence = 'high' | 'medium' | 'low' | 'none';

export interface BulkSuggestionEvidence {
  /** Display spelling of the product, from the household vocabulary when it has one. */
  productLabel: string;
  eventCount: number;
  firstEventDate: string | null;
  monthlyRateCents: number | null;
  medianGapDays: number | null;
  relatedLabels: string[];
  categoryName: string | null;
  precedentMonths: number | null;
  unit: string | null;
}

export interface BulkSuggestion {
  /** 2..12 — what the form pre-selects. */
  months: number;
  /** The unclamped estimate, two decimals, for the explanation and tests. */
  rawMonths: number;
  basis: BulkEstimateBasis;
  confidence: BulkConfidence;
  /** True when the estimate says this is a normal-size purchase (< 1.5 months). */
  looksRegularSize: boolean;
  evidence: BulkSuggestionEvidence;
}

/** Per-month context for the plan preview: the month's cap and what it already counts. */
export interface BulkMonthContext {
  month: string;
  plannedBudget: number | null;
  countedCents: number;
}

export interface BulkSuggestionRequest {
  title: string;
  category_id?: string | null;
  /** TAX-INCLUSIVE amount, as it will be saved. */
  amount: number;
  saved_amount?: number;
  expense_date: string;
  quantity?: number | null;
  unit?: string | null;
  /** The row being edited, excluded from its own history. */
  exclude_expense_id?: string | null;
}

export interface BulkSuggestionResponse {
  suggestion: BulkSuggestion;
  /** Twelve months from the purchase month, oldest first. */
  monthContext: BulkMonthContext[];
}

export interface Expense {
  id: string;
  household_id: string;
  budget_item_id: string | null;
  category_id: string | null;
  title: string;
  description: string | null;
  /** TAX-INCLUSIVE amount paid, in cents (item price + its share of sales tax). */
  amount: number;
  /** Discount/sale savings for this expense, in cents (0 = full price). */
  saved_amount: number;
  /** Sales tax included in `amount`, in cents (0 = exempt / none). Informational. */
  tax_amount?: number;
  /** Container deposit + US CRV included in `amount`, in cents. */
  deposit_amount?: number;
  expense_date: string;
  vendor: string | null;
  receipt_key: string | null;
  created_by: string | null;
  created_at: string;
  /** Present on stock-up purchases spread over several months; absent/null otherwise. */
  bulk?: ExpenseBulkPlan | null;
}

/** One month's roll-up for a single product within a category. */
export interface CategoryProductMonth {
  /** Calendar month, 'YYYY-MM'. */
  month: string;
  /** Total spent on this product that month, in cents. */
  amount: number;
  /** Number of times the product was purchased that month. */
  count: number;
}

/** A product (grouped by name) bought within a category, with its month history. */
export interface CategoryProductTrend {
  name: string;
  /** Total spent across the whole window, in cents. */
  total: number;
  /** Total purchases across the whole window. */
  count: number;
  /** Spend in the current (anchor) month, in cents. */
  currentAmount: number;
  currentCount: number;
  /** Spend in the month immediately before the anchor, in cents. */
  previousAmount: number;
  /** Mean monthly spend across the window, in cents. */
  averageAmount: number;
  trend: 'up' | 'down' | 'flat' | 'new';
  /** One entry per month in the window, oldest first (parallel to `months`). */
  byMonth: CategoryProductMonth[];
}

/** Product-level spending breakdown + trends for a single category over N months. */
export interface CategoryProductTrends {
  /** Category id, or 'uncategorized' for expenses with no category. */
  categoryId: string;
  categoryName: string | null;
  /** Chronological list of the months covered, 'YYYY-MM' (oldest first). */
  months: string[];
  /** Total category spend per month, in cents (parallel to `months`). */
  monthlyTotals: number[];
  currentMonthTotal: number;
  previousMonthTotal: number;
  /** Products sorted by current-month spend (desc), then all-time total. */
  products: CategoryProductTrend[];
}

export type ReceiptFeeKind = 'deposit' | 'environmental' | 'bag' | 'crv' | 'other';

export interface GroceryReceiptFee {
  kind: ReceiptFeeKind;
  label: string;
  amount: number;
}

export interface GroceryCategorySuggestion {
  id: string;
  name: string;
}

/** A single grocery line item extracted from a scanned receipt — not yet saved. */
export interface GroceryReceiptItem {
  raw_name?: string;
  raw_code?: string | null;
  /** Short product name, e.g. "Milk". */
  name: string;
  /** ≤7 guesses; includes Title Case of the printed line. */
  name_suggestions?: string[];
  /** TAX-INCLUSIVE price for this item, in cents (price + its share of tax). */
  amount: number;
  /** Sales tax included in `amount`, in cents (0 = exempt / none). */
  tax_amount?: number;
  /** Discount/sale savings for this item, in cents (0 = full price). */
  saved_amount: number;
  /**
   * Measured amount the line states, when it states one — fuel volume, weight.
   * Null for a plain count, which is most lines.
   */
  quantity?: number | null;
  /** Unit for `quantity`, EXACTLY as printed ("G", "gal", "L", "lb"). */
  unit?: string | null;
  deposit_amount?: number;
  fees?: GroceryReceiptFee[];
  /** Best-fit category id for this item (server-resolved), or null. */
  category_id?: string | null;
  /** Category name for this item, or null. */
  category_name?: string | null;
  category_suggestions?: GroceryCategorySuggestion[];
}

/** One tax line for display, e.g. { label: "GST", amount: 475 }. */
export interface ReceiptTaxLine {
  label: string;
  amount: number;
}

/** Result of scanning a grocery receipt — reviewed/edited before anything is saved. */
export interface GroceryReceiptScanResult {
  vendor: string | null;
  /** Purchase date as YYYY-MM-DD, or null if the receipt had none. */
  purchase_date: string | null;
  /** Household's "Groceries" category id, resolved server-side. */
  category_id: string | null;
  category_name: string | null;
  items: GroceryReceiptItem[];
  /** Sum of pre-tax item prices, in cents (= Σ amount − Σ tax_amount). */
  subtotal_amount?: number;
  /** Total sales tax attributed across items, in cents. */
  tax_amount?: number;
  /** Grand total with tax, in cents (= Σ amount). Reconciles to the receipt total. */
  total_amount?: number;
  /** Tax grouped by label for display, e.g. [{label:"GST",amount:475}]. */
  tax_breakdown?: ReceiptTaxLine[];
  /** How the tax was derived (printed-coded | printed-spread | profile-rates | none). */
  tax_source?: 'printed-coded' | 'printed-spread' | 'profile-rates' | 'none';
  /** True when the household's region resolved to a known tax table (fallback). */
  region_known?: boolean;
  receipt_country?: string | null;
  receipt_region?: string | null;
  /**
   * ISO 4217 code the receipt itself was printed in, when it could be told
   * apart from the member's own currency — null when the receipt gave no
   * decisive signal (a bare "$" does not).
   *
   * Every amount above is in THIS currency, not the member's. The scan screen
   * converts on save; nothing downstream of that ever sees a foreign amount.
   */
  receipt_currency?: string | null;
}

// Request types
interface CreateBudgetItemRequest {
  title: string;
  description?: string;
  category_id?: string;
  timeframe: string;
  year?: number;
  quarter?: number;
  estimated_cost_min?: number;
  estimated_cost_max?: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
  target_date?: string;
  is_recurring?: boolean;
  recurrence_frequency?: 'monthly' | 'quarterly' | 'yearly';
}

interface RecordPlannedSpendingRequest {
  amount?: number;
  expense_date?: string;
}

interface UpdateBudgetItemRequest {
  title?: string;
  description?: string;
  category_id?: string;
  timeframe?: string;
  year?: number;
  quarter?: number;
  estimated_cost_min?: number;
  estimated_cost_max?: number;
  actual_cost?: number;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  status?: 'planned' | 'in_progress' | 'completed' | 'deferred' | 'cancelled';
  /** null clears the date, turning a scheduled spending into an undated one. */
  target_date?: string | null;
}

interface AIDetectItemsRequest {
  text: string;
  year?: number;
  month?: number;
}

interface AIDetectItemsWithFileRequest {
  text?: string;
  file: { uri: string; type: string; name: string };
  year?: number;
  month?: number;
}

interface AddExpenseRequest {
  title: string;
  description?: string;
  amount: number;
  expense_date: string;
  category_id?: string;
  budget_item_id?: string;
  vendor?: string;
  /** Discount/sale savings for this expense, in cents. */
  saved_amount?: number;
  /** Sales tax included in `amount`, in cents (receipt scanning). */
  tax_amount?: number;
  deposit_amount?: number;
  /** Spread this purchase over months (stock-up). Omit or null for ordinary spending. */
  bulk?: BulkPlanInput | null;
}

interface BulkAddExpenseItem {
  title: string;
  description?: string;
  amount: number;
  expense_date: string;
  category_id?: string;
  vendor?: string;
  saved_amount?: number;
  tax_amount?: number;
  deposit_amount?: number;
  bulk?: BulkPlanInput | null;
}

interface UpdateExpenseRequest {
  title?: string;
  description?: string | null;
  amount?: number;
  expense_date?: string;
  category_id?: string | null;
  /** Discount/sale savings for this expense, in cents. */
  saved_amount?: number;
  tax_amount?: number;
  deposit_amount?: number;
  vendor?: string | null;
  /** Replace the stock-up plan; `null` clears it (the full amount returns to the purchase month). */
  bulk?: BulkPlanInput | null;
}

export interface BudgetQuickAddSuggestion {
  title: string;
  description: string | null;
  category_id: string | null;
  amount: number | null;
  estimated_cost_min: number | null;
  estimated_cost_max: number | null;
  priority: BudgetItem['priority'] | null;
  is_recurring: boolean;
  recurrence_frequency: string | null;
  usage_count: number;
  last_used_at: string;
}

interface QuickAddSuggestionsResponse {
  recent: BudgetQuickAddSuggestion[];
  popular: BudgetQuickAddSuggestion[];
}

interface ExpenseFilters {
  start_date?: string;
  end_date?: string;
  category_id?: string;
  limit?: number;
}

// Response types
interface CategoriesResponse {
  categories: BudgetCategory[];
}

interface BudgetItemResponse {
  item: BudgetItem;
}

interface SyncResponse {
  created: number;
  message: string;
}

interface ExpenseResponse {
  expense: Expense;
}

interface ExpensesResponse {
  expenses: Expense[];
}

interface GoalResponse {
  goal: BudgetGoal;
  /** True when, before this save, no month this year had a planned_budget set. */
  isFirstForYear?: boolean;
}

interface ApplyToYearResponse {
  /** Months (1-12) that were filled in. Months that already had a budget are left untouched. */
  updatedMonths: number[];
}

interface ScheduleReminderResponse {
  scheduledFor: string;
}

interface SetMonthlyGoalRequest {
  planned_budget: number;
  category_budgets?: Record<string, number>;
  notes?: string;
}

export interface SubBudgetsResponse {
  /** Resolved caps + spend for the requested month, most pressing first. */
  subBudgets: SubBudgetProgress[];
  totals: SubBudgetTotals;
  /** Raw rows for the whole year (defaults + overrides) so the editor can prefill. */
  rows: SubBudget[];
}

export interface UpsertSubBudgetRequest {
  category_id: string;
  year: number;
  /** null = recurring default for the year; 1-12 = single-month override. */
  month: number | null;
  limit_type: SubBudgetLimitType;
  amount_cents?: number | null;
  percent_bps?: number | null;
}

export interface DeleteSubBudgetRequest {
  category_id: string;
  year: number;
  month: number | null;
}

interface CreateCategoryRequest {
  name: string;
  icon?: string;
  color?: string;
}

/** True when creating/renaming a category failed because the name is already taken. */
export function isCategoryNameConflict(error: unknown): boolean {
  if (
    error != null &&
    typeof error === 'object' &&
    'name' in error &&
    (error as { name?: string }).name === 'CategoryNameConflictError'
  ) {
    return true;
  }
  return axios.isAxiosError(error) && error.response?.status === 409;
}

interface UpdateCategoryRequest {
  name?: string;
  icon?: string;
  color?: string;
  sort_order?: number;
  /** Show/hide a predefined category without deleting it. */
  hidden?: boolean;
}

const remoteBudgetApi = {
  // Categories. Pass includeHidden (management screen only) to also list
  // toggled-off default categories; everywhere else omits hidden ones.
  getCategories: (householdId: string, options?: { includeHidden?: boolean }) =>
    apiClient
      .get<CategoriesResponse>(`/households/${householdId}/budget/categories`, {
        params: options?.includeHidden ? { include_hidden: 1 } : undefined,
      })
      .then((res) => res.data),

  // Product-level breakdown + month-over-month trends for one category. Pass
  // 'uncategorized' to inspect expenses with no category. `months` is the size
  // of the rolling window ending at (year, month).
  getCategoryProductTrends: (
    householdId: string,
    categoryId: string,
    year: number,
    month: number,
    months = 6
  ) =>
    apiClient
      .get<CategoryProductTrends>(
        `/households/${householdId}/budget/categories/${categoryId}/products`,
        { params: { year, month, months } }
      )
      .then((res) => res.data),

  // Timeline
  getTimeline: (householdId: string) =>
    apiClient
      .get<BudgetOverview>(`/households/${householdId}/budget/timeline`)
      .then((res) => res.data),

  // Budget items
  createItem: (householdId: string, data: CreateBudgetItemRequest) =>
    apiClient
      .post<BudgetItemResponse>(`/households/${householdId}/budget/items`, data)
      .then((res) => res.data),

  getItem: (householdId: string, itemId: string) =>
    apiClient
      .get<BudgetItemResponse>(`/households/${householdId}/budget/items/${itemId}`)
      .then((res) => res.data),

  // AI "add a spending in words" — returns draft suggestions, never auto-saves.
  aiDetectItems: (householdId: string, data: AIDetectItemsRequest) =>
    apiClient
      .post<{ suggestions: SuggestedSpending[] }>(
        `/households/${householdId}/budget/items/ai-detect`,
        data
      )
      .then((res) => res.data),

  aiDetectItemsWithFile: (householdId: string, data: AIDetectItemsWithFileRequest) => {
    const formData = new FormData();
    if (data.text?.trim()) {
      formData.append('text', data.text.trim());
    }
    formData.append('file', {
      uri: data.file.uri,
      type: data.file.type,
      name: data.file.name,
    } as any);
    if (data.year != null) formData.append('year', String(data.year));
    if (data.month != null) formData.append('month', String(data.month));

    return api.upload<{ suggestions: SuggestedSpending[] }>(
      `/households/${householdId}/budget/items/ai-detect-upload`,
      formData
    );
  },

  // Scan a receipt into individual line items for review. Accepts one file or
  // SEVERAL (a long receipt photographed in sections is read as ONE receipt).
  // `region` (user's Settings choice) drives the sales-tax fallback when the
  // receipt itself prints no usable tax. Returns drafts only — the client saves
  // accepted items via addExpensesBulk.
  scanReceipt: async (
    householdId: string,
    files:
      | { uri: string; type: string; name: string }
      | Array<{ uri: string; type: string; name: string }>,
    region?: { country?: string | null; stateProvince?: string | null },
    aliases?: Array<{ key: string; name: string; categoryId?: string | null }>,
    onProgress?: (progress: ReceiptScanProgress) => void
  ) => {
    const list = Array.isArray(files) ? files : [files];

    // A caller that wants progress gets the streaming route; everyone else keeps
    // the plain buffered upload. Falling back on `Unsupported` matters because
    // the app can be newer than the Worker it is pointed at.
    if (onProgress) {
      try {
        // Announce the upload synchronously, before the first await: the caller
        // set its own pre-call stage in this same tick, so React coalesces the
        // two and no intermediate caption is ever painted.
        onProgress({ stage: 'uploading', fraction: 0 });
        return await scanReceiptStreaming(householdId, list, region, aliases, {
          onUploadProgress: (fraction) => onProgress({ stage: 'uploading', fraction }),
          onItems: (items) => onProgress({ stage: 'reading', items }),
        });
      } catch (error) {
        if (!(error instanceof ReceiptScanStreamUnsupportedError)) throw error;
        onProgress({ stage: 'reading', items: 0 });
      }
    }

    const formData = new FormData();
    for (const file of list) {
      formData.append('file', {
        uri: file.uri,
        type: file.type,
        name: file.name,
      } as any);
    }
    if (region?.country) formData.append('country', region.country);
    if (region?.stateProvince) formData.append('state_province', region.stateProvince);
    if (aliases && aliases.length > 0) formData.append('aliases', JSON.stringify(aliases));

    return api.upload<GroceryReceiptScanResult>(
      `/households/${householdId}/budget/receipts/scan`,
      formData
    );
  },

  updateItem: (householdId: string, itemId: string, data: UpdateBudgetItemRequest) =>
    apiClient
      .patch<BudgetItemResponse>(`/households/${householdId}/budget/items/${itemId}`, data)
      .then((res) => res.data),

  deleteItem: (householdId: string, itemId: string) =>
    apiClient.delete(`/households/${householdId}/budget/items/${itemId}`),

  recordPlannedSpending: (householdId: string, itemId: string, data?: RecordPlannedSpendingRequest) =>
    apiClient
      .post<{ expense: Expense; item: BudgetItem }>(
        `/households/${householdId}/budget/items/${itemId}/record-spending`,
        data ?? {}
      )
      .then((res) => res.data),

  // Sync
  syncFromTasks: (householdId: string) =>
    apiClient
      .post<SyncResponse>(`/households/${householdId}/budget/sync-action-items`)
      .then((res) => res.data),

  // Expenses
  addExpense: (householdId: string, data: AddExpenseRequest) =>
    apiClient
      .post<ExpenseResponse>(`/households/${householdId}/budget/expenses`, data)
      .then((res) => res.data),

  // Add multiple expenses atomically (grocery receipt scanning). Either all
  // accepted items are persisted or none are, so a failed save never leaves a
  // partially-imported receipt that would duplicate on retry.
  addExpensesBulk: (householdId: string, expenses: BulkAddExpenseItem[]) =>
    apiClient
      .post<ExpensesResponse>(`/households/${householdId}/budget/expenses/bulk`, { expenses })
      .then((res) => res.data),

  getExpenses: (householdId: string, filters?: ExpenseFilters) =>
    apiClient
      .get<ExpensesResponse>(`/households/${householdId}/budget/expenses`, { params: filters })
      .then((res) => res.data),

  getExpense: (householdId: string, expenseId: string) =>
    apiClient
      .get<ExpenseResponse>(`/households/${householdId}/budget/expenses/${expenseId}`)
      .then((res) => res.data),

  updateExpense: (householdId: string, expenseId: string, data: UpdateExpenseRequest) =>
    apiClient
      .patch<ExpenseResponse>(`/households/${householdId}/budget/expenses/${expenseId}`, data)
      .then((res) => res.data),

  deleteExpense: (householdId: string, expenseId: string) =>
    apiClient.delete(`/households/${householdId}/budget/expenses/${expenseId}`),

  // Bulk purchases are a Budget V2 (local-first) feature: the estimate reads the
  // household's own ledger on the device. There is no server counterpart.
  getBulkSuggestion: (_householdId: string, _data: BulkSuggestionRequest): Promise<BulkSuggestionResponse> =>
    Promise.reject(new Error('Bulk purchases need the local-first Budget ledger.')),

  // Monthly goal
  getMonthlyGoal: (householdId: string, year: number, month: number) =>
    apiClient
      .get<GoalResponse>(`/households/${householdId}/budget/goals/${year}/${month}`)
      .then((res) => res.data),

  setMonthlyGoal: (householdId: string, year: number, month: number, data: SetMonthlyGoalRequest) =>
    apiClient
      .put<GoalResponse>(`/households/${householdId}/budget/goals/${year}/${month}`, data)
      .then((res) => res.data),

  // Fills every remaining month this year with no budget set yet with the same cap.
  applyGoalToYear: (householdId: string, year: number, month: number, plannedBudget: number) =>
    apiClient
      .post<ApplyToYearResponse>(`/households/${householdId}/budget/goals/${year}/${month}/apply-to-year`, {
        planned_budget: plannedBudget,
      })
      .then((res) => res.data),

  // Schedules a "set next month's budget" reminder for every household member.
  scheduleNextMonthBudgetReminder: (householdId: string, year: number, month: number) =>
    apiClient
      .post<ScheduleReminderResponse>(
        `/households/${householdId}/budget/goals/${year}/${month}/schedule-reminder`
      )
      .then((res) => res.data),

  // Monthly overview (remaining balance + priority/urgency affordability ranking)
  getMonthlyOverview: (householdId: string, year: number, month: number) =>
    apiClient
      .get<MonthlyOverview>(`/households/${householdId}/budget/monthly-overview`, {
        params: { year, month },
      })
      .then((res) => res.data),

  getQuickAddSuggestions: (householdId: string, kind: 'planned' | 'spent') =>
    apiClient
      .get<QuickAddSuggestionsResponse>(`/households/${householdId}/budget/quick-add`, {
        params: { kind },
      })
      .then((res) => res.data),

  // ===== Budget transfers (move a month's leftover to next month / savings / TFSA-RRSP) =====
  getTransferContext: (householdId: string, year: number, month: number) =>
    apiClient
      .get<BudgetTransferContext>(`/households/${householdId}/budget/transfers`, {
        params: { year, month },
      })
      .then((res) => res.data),

  createTransfer: (householdId: string, data: CreateTransferRequest) =>
    apiClient
      .post<BudgetTransferContext>(`/households/${householdId}/budget/transfers`, data)
      .then((res) => res.data),

  deleteTransfer: (householdId: string, transferId: string) =>
    apiClient
      .delete<BudgetTransferContext>(`/households/${householdId}/budget/transfers/${transferId}`)
      .then((res) => res.data),

  // AI insights
  getInsights: (householdId: string, year: number, month: number, forceRefresh = false) =>
    apiClient
      .get<BudgetInsights>(`/households/${householdId}/budget/insights`, {
        params: { year, month, force_refresh: forceRefresh },
      })
      .then((res) => res.data),

  // Encouragement ("Budget Wins") — deterministic, computed server-side.
  getEncouragement: (householdId: string, year: number, month: number) =>
    apiClient
      .get<BudgetEncouragement>(`/households/${householdId}/budget/encouragement`, {
        params: { year, month },
      })
      .then((res) => res.data),

  // Category CRUD
  createCategory: (householdId: string, data: CreateCategoryRequest) =>
    apiClient
      .post<{ category: BudgetCategory }>(`/households/${householdId}/budget/categories`, data)
      .then((res) => res.data),

  updateCategory: (householdId: string, categoryId: string, data: UpdateCategoryRequest) =>
    apiClient
      .patch<{ category: BudgetCategory }>(
        `/households/${householdId}/budget/categories/${categoryId}`,
        data
      )
      .then((res) => res.data),

  deleteCategory: (householdId: string, categoryId: string) =>
    apiClient.delete(`/households/${householdId}/budget/categories/${categoryId}`),

  // Sub-budgets (per-category caps within the month's total).
  getSubBudgets: (householdId: string, year: number, month: number) =>
    apiClient
      .get<SubBudgetsResponse>(`/households/${householdId}/budget/sub-budgets`, {
        params: { year, month },
      })
      .then((res) => res.data),

  upsertSubBudget: (householdId: string, data: UpsertSubBudgetRequest) =>
    apiClient
      .put<{ subBudget: SubBudget }>(`/households/${householdId}/budget/sub-budgets`, data)
      .then((res) => res.data),

  // DELETE carries a body (the scope key), so pass it via the axios config.
  deleteSubBudget: (householdId: string, data: DeleteSubBudgetRequest) =>
    apiClient.delete(`/households/${householdId}/budget/sub-budgets`, { data }),
};

/**
 * Budget API facade — routes to the local-first ledger when enabled
 * (`EXPO_PUBLIC_BUDGET_LOCAL_FIRST` / Budget __DEV__ default). Otherwise uses
 * the Cloudflare D1 remote API. See documents/requirements/Buget v2/.
 */
export const budgetApi: typeof remoteBudgetApi = new Proxy(remoteBudgetApi, {
  get(target, prop, receiver) {
    try {
      // Narrow requires — avoid the local barrel (UI/sync/WebRTC) on every API call.
      const { isBudgetLocalFirst } =
        require('@features/budget/local/flag') as typeof import('@features/budget/local/flag');
      if (isBudgetLocalFirst()) {
        const { localBudgetApi } =
          require('@features/budget/local/localBudgetApi') as typeof import('@features/budget/local/localBudgetApi');
        const localFn = (localBudgetApi as Record<string | symbol, unknown>)[prop];
        if (typeof localFn === 'function') {
          return localFn.bind(localBudgetApi);
        }
      }
    } catch {
      // Package/feature not ready — fall through to remote.
    }
    const value = Reflect.get(target, prop, receiver);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
