/**
 * Pure helpers for the "All spending" explorer screen (BudgetAllSpendingScreen).
 *
 * Kept side-effect free so the date-range math, filtering, sorting and the
 * trend-chart bucketing can be unit-tested without rendering. The screen owns
 * the fetch + render; everything shape-preserving lives here.
 */

/** Time windows the explorer can scope to (anchored at the store's month). */
export type SpendingRange = 'month' | '3m' | '6m' | 'year' | 'all';

/** How the transaction list is ordered. */
export type SpendingSort = 'recent' | 'amount';

/** Sentinel category id used by the filter chips + rows for expenses with no category. */
export const UNCATEGORIZED_ID = 'uncategorized';

export const SPENDING_RANGE_OPTIONS: { id: SpendingRange; label: string }[] = [
  { id: 'month', label: 'This month' },
  { id: '3m', label: '3 months' },
  { id: '6m', label: '6 months' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
];

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Steps `{year, month}` forward/back: positive `n` = back, matching Dashboard/Savings. */
function shiftMonth(year: number, month: number, n: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) - n;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

/**
 * Inclusive-start / EXCLUSIVE-end date bounds ('YYYY-MM-DD') for a range,
 * anchored at (anchorYear, anchorMonth). `end` is exclusive to match the
 * backend expenses filter (`expense_date < end`), so it is the first day of
 * the month *after* the window. `all` returns `{}` (no bounds).
 */
export function spendingDateRange(
  anchorYear: number,
  anchorMonth: number,
  range: SpendingRange
): { start?: string; end?: string } {
  if (range === 'all') return {};
  if (range === 'year') {
    return { start: `${anchorYear}-01-01`, end: `${anchorYear + 1}-01-01` };
  }
  const monthsBack = range === 'month' ? 0 : range === '3m' ? 2 : 5;
  const startM = shiftMonth(anchorYear, anchorMonth, monthsBack);
  const endM = shiftMonth(anchorYear, anchorMonth, -1); // first day of the month after the anchor
  return {
    start: `${startM.year}-${pad(startM.month)}-01`,
    end: `${endM.year}-${pad(endM.month)}-01`,
  };
}

/** Minimal shape the filter/sort/bucket helpers need. */
export interface FilterableExpense {
  category_id: string | null;
  title: string;
  description: string | null;
  vendor: string | null;
  amount: number;
  expense_date: string;
}

/** The category key an expense belongs to (its id, or the uncategorized sentinel). */
export function expenseCategoryKey(e: { category_id: string | null }): string {
  return e.category_id ?? UNCATEGORIZED_ID;
}

/**
 * Filter by category (`'all'`/undefined = every category) and a free-text query
 * matched against title, vendor and description (case-insensitive).
 */
export function filterExpenses<T extends FilterableExpense>(
  expenses: T[],
  opts: { categoryId?: string; query?: string }
): T[] {
  const q = opts.query?.trim().toLowerCase();
  const cat = opts.categoryId && opts.categoryId !== 'all' ? opts.categoryId : undefined;
  return expenses.filter((e) => {
    if (cat && expenseCategoryKey(e) !== cat) return false;
    if (q) {
      const hay = `${e.title} ${e.vendor ?? ''} ${e.description ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Non-mutating sort: newest first, or highest amount first. */
export function sortExpenses<T extends FilterableExpense>(expenses: T[], sort: SpendingSort): T[] {
  const copy = [...expenses];
  if (sort === 'amount') {
    copy.sort((a, b) => b.amount - a.amount);
  } else {
    copy.sort((a, b) =>
      a.expense_date < b.expense_date ? 1 : a.expense_date > b.expense_date ? -1 : 0
    );
  }
  return copy;
}

/** One bar in the trend chart. `value` is in DOLLARS (cents / 100). */
export interface SpendBucket {
  label: string;
  value: number;
}

/** Ordered month keys ('YYYY-MM', oldest first) the trend chart should show for a range. */
function monthKeysForRange(
  range: SpendingRange,
  anchorYear: number,
  anchorMonth: number,
  expenses: FilterableExpense[]
): string[] {
  if (range === 'year') {
    return Array.from({ length: 12 }, (_, i) => `${anchorYear}-${pad(i + 1)}`);
  }
  if (range === 'all') {
    const set = new Set(expenses.map((e) => e.expense_date.slice(0, 7)));
    return [...set].sort();
  }
  const count = range === '3m' ? 3 : 6;
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const m = shiftMonth(anchorYear, anchorMonth, i);
    keys.push(`${m.year}-${pad(m.month)}`);
  }
  return keys;
}

/**
 * Bucket expenses for the trend bar chart:
 *  - `month` range → 5 weekly buckets ("W1".."W5") within the anchor month
 *  - every other range → one bar per calendar month across the window
 * Values are in dollars, oldest bucket first, so they drop straight into
 * `AppBarChart`.
 */
export function buildSpendBuckets(
  expenses: FilterableExpense[],
  range: SpendingRange,
  anchorYear: number,
  anchorMonth: number
): SpendBucket[] {
  if (range === 'month') {
    const weeks = [0, 0, 0, 0, 0];
    for (const e of expenses) {
      const day = Number.parseInt(e.expense_date.slice(8, 10), 10);
      const w = Math.min(4, Math.max(0, Math.floor((day - 1) / 7)));
      weeks[w] += e.amount;
    }
    return weeks.map((v, i) => ({ label: `W${i + 1}`, value: v / 100 }));
  }

  const keys = monthKeysForRange(range, anchorYear, anchorMonth, expenses);
  const totals = new Map<string, number>();
  for (const e of expenses) {
    const k = e.expense_date.slice(0, 7);
    totals.set(k, (totals.get(k) ?? 0) + e.amount);
  }
  return keys.map((k) => ({
    label: MONTH_ABBR[Number.parseInt(k.slice(5, 7), 10) - 1] ?? k,
    value: (totals.get(k) ?? 0) / 100,
  }));
}

/** Aggregate stats for the summary tiles, all in cents. */
export interface SpendingStats {
  total: number;
  count: number;
  average: number;
  saved: number;
  deposits: number;
}

/** Total / count / average / discount-savings / deposits for a set of expenses (cents). */
export function summarizeSpending(
  expenses: Array<{ amount: number; saved_amount?: number; deposit_amount?: number }>
): SpendingStats {
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const saved = expenses.reduce((sum, e) => sum + (e.saved_amount ?? 0), 0);
  const deposits = expenses.reduce((sum, e) => sum + (e.deposit_amount ?? 0), 0);
  const count = expenses.length;
  return {
    total,
    count,
    average: count > 0 ? Math.round(total / count) : 0,
    saved,
    deposits,
  };
}
