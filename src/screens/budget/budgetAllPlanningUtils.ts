/**
 * Pure helpers for the "All planned" explorer screen (BudgetAllPlanningScreen).
 *
 * The planned mirror of [[budgetAllSpendingUtils]]: same range windows, filter,
 * sort and trend bucketing, but over planned budget items instead of expenses.
 * Kept side-effect free so the date-range math and bucketing can be unit-tested
 * without rendering. A planned item's "amount" is the midpoint of its estimated
 * cost range; its effective date is `targetDate` when set, else `createdAt` — so
 * every entry lands on the time axis (unlike an undated raw item).
 */

import type { TimelineItem } from '@api/budget';

/** Time windows the explorer can scope to (anchored at the store's month). */
export type PlanningRange = 'month' | '3m' | '6m' | 'year' | 'all';

/** How the planned list is ordered. */
export type PlanningSort = 'recent' | 'amount';

/** Sentinel category id used by the filter chips + rows for items with no category. */
export const UNCATEGORIZED_ID = 'uncategorized';

/** Statuses that count as "planned" (not yet realized / not abandoned). */
const PLANNED_STATUSES = new Set(['planned', 'in_progress', 'deferred']);

export const PLANNING_RANGE_OPTIONS: { id: PlanningRange; label: string }[] = [
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

/** Midpoint (cents) of an estimated cost range — the single figure the explorer charts/sums. */
export function plannedAmountCents(
  min: number | null | undefined,
  max: number | null | undefined
): number {
  const lo = min ?? 0;
  const hi = max ?? lo;
  return Math.round((lo + hi) / 2) || lo || hi || 0;
}

/** Normalized planned entry the filter/sort/bucket helpers operate on. */
export interface PlannedEntry {
  id: string;
  title: string;
  description: string | null;
  categoryId: string | null;
  minCost: number | null;
  maxCost: number | null;
  /** Midpoint of the estimated range, in cents. */
  amount: number;
  priority: string;
  status: string;
  /** Effective date ('YYYY-MM-DD…') = targetDate ?? createdAt. Always present. */
  date: string;
  /** Whether the item carries a real target date (vs. only its creation date). */
  scheduled: boolean;
}

/**
 * Flatten the timeline's grouped items into planned entries, dropping cancelled
 * and completed items (a completed plan became an actual expense; a cancelled
 * one is gone). Every returned entry has a `date` and a numeric `amount`.
 */
export function toPlannedEntries(items: TimelineItem[]): PlannedEntry[] {
  const out: PlannedEntry[] = [];
  for (const item of items) {
    if (!PLANNED_STATUSES.has(item.status)) continue;
    const scheduled = !!item.targetDate;
    out.push({
      id: item.id,
      title: item.title,
      description: item.description,
      categoryId: item.category?.id ?? null,
      minCost: item.estimatedCostMin,
      maxCost: item.estimatedCostMax,
      amount: plannedAmountCents(item.estimatedCostMin, item.estimatedCostMax),
      priority: item.priority,
      status: item.status,
      // `createdAt` is the fallback date axis; guard against an older Worker that
      // predates the field so an undated item never crashes the slice.
      date: (item.targetDate ?? item.createdAt ?? '').slice(0, 10),
      scheduled,
    });
  }
  return out;
}

/**
 * Inclusive-start / EXCLUSIVE-end date bounds ('YYYY-MM-DD') for a range,
 * anchored at (anchorYear, anchorMonth). Mirrors [[budgetAllSpendingUtils]]'s
 * `spendingDateRange`. `all` returns `{}` (no bounds).
 */
export function planningDateRange(
  anchorYear: number,
  anchorMonth: number,
  range: PlanningRange
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

/** Keep only entries whose effective date falls within a range window. */
export function filterPlannedByRange(
  entries: PlannedEntry[],
  anchorYear: number,
  anchorMonth: number,
  range: PlanningRange
): PlannedEntry[] {
  const { start, end } = planningDateRange(anchorYear, anchorMonth, range);
  if (!start && !end) return entries;
  return entries.filter((e) => {
    if (start && e.date < start) return false;
    if (end && e.date >= end) return false;
    return true;
  });
}

/** The category key an entry belongs to (its id, or the uncategorized sentinel). */
export function plannedCategoryKey(e: { categoryId: string | null }): string {
  return e.categoryId ?? UNCATEGORIZED_ID;
}

/**
 * Filter by category (`'all'`/undefined = every category) and a free-text query
 * matched against title and description (case-insensitive).
 */
export function filterPlanned(
  entries: PlannedEntry[],
  opts: { categoryId?: string; query?: string }
): PlannedEntry[] {
  const q = opts.query?.trim().toLowerCase();
  const cat = opts.categoryId && opts.categoryId !== 'all' ? opts.categoryId : undefined;
  return entries.filter((e) => {
    if (cat && plannedCategoryKey(e) !== cat) return false;
    if (q) {
      const hay = `${e.title} ${e.description ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Non-mutating sort: newest effective-date first, or highest amount first. */
export function sortPlanned(entries: PlannedEntry[], sort: PlanningSort): PlannedEntry[] {
  const copy = [...entries];
  if (sort === 'amount') {
    copy.sort((a, b) => b.amount - a.amount);
  } else {
    copy.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }
  return copy;
}

/** One bar in the trend chart. `value` is in DOLLARS (cents / 100). */
export interface PlanBucket {
  label: string;
  value: number;
}

/** Ordered month keys ('YYYY-MM', oldest first) the trend chart should show for a range. */
function monthKeysForRange(
  range: PlanningRange,
  anchorYear: number,
  anchorMonth: number,
  entries: PlannedEntry[]
): string[] {
  if (range === 'year') {
    return Array.from({ length: 12 }, (_, i) => `${anchorYear}-${pad(i + 1)}`);
  }
  if (range === 'all') {
    const set = new Set(entries.map((e) => e.date.slice(0, 7)));
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
 * Bucket planned entries for the trend bar chart:
 *  - `month` range → 5 weekly buckets ("W1".."W5") within the anchor month
 *  - every other range → one bar per calendar month across the window
 * Values are in dollars, oldest bucket first, so they drop straight into
 * `AppBarChart`.
 */
export function buildPlanBuckets(
  entries: PlannedEntry[],
  range: PlanningRange,
  anchorYear: number,
  anchorMonth: number
): PlanBucket[] {
  if (range === 'month') {
    const weeks = [0, 0, 0, 0, 0];
    for (const e of entries) {
      const day = Number.parseInt(e.date.slice(8, 10), 10);
      const w = Math.min(4, Math.max(0, Math.floor((day - 1) / 7)));
      weeks[w] += e.amount;
    }
    return weeks.map((v, i) => ({ label: `W${i + 1}`, value: v / 100 }));
  }

  const keys = monthKeysForRange(range, anchorYear, anchorMonth, entries);
  const totals = new Map<string, number>();
  for (const e of entries) {
    const k = e.date.slice(0, 7);
    totals.set(k, (totals.get(k) ?? 0) + e.amount);
  }
  return keys.map((k) => ({
    label: MONTH_ABBR[Number.parseInt(k.slice(5, 7), 10) - 1] ?? k,
    value: (totals.get(k) ?? 0) / 100,
  }));
}

/** Aggregate stats for the summary tiles, all in cents (except counts). */
export interface PlanningStats {
  total: number;
  count: number;
  average: number;
  scheduled: number;
}

/** Total / count / average / scheduled-count for a set of planned entries. */
export function summarizePlanned(entries: PlannedEntry[]): PlanningStats {
  const total = entries.reduce((sum, e) => sum + e.amount, 0);
  const count = entries.length;
  const scheduled = entries.reduce((n, e) => n + (e.scheduled ? 1 : 0), 0);
  return {
    total,
    count,
    average: count > 0 ? Math.round(total / count) : 0,
    scheduled,
  };
}
