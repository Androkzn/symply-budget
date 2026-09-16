/**
 * Bulk purchases — reading a `MonthlyOverview` through the month lens.
 *
 * The overview carries the month's purchase events (`expenses`, full amounts)
 * and every portion the month counts (`bulkPortions`). Screens that add up
 * rows by category, or print a row's amount, need "what this row counts here",
 * not "what it cost". These helpers are that translation, so no screen
 * re-derives it.
 */
import type { BulkPortionView, Expense, MonthlyOverview } from '@api/budget';

type OverviewSlice = Pick<MonthlyOverview, 'expenses' | 'bulkPortions'>;

/** Purchase-month portions keyed by their parent row, for the rows the month lists. */
export function portionByExpenseId(
  overview: OverviewSlice | null | undefined,
): Map<string, BulkPortionView> {
  const listed = new Set((overview?.expenses ?? []).map((expense) => expense.id));
  const map = new Map<string, BulkPortionView>();
  for (const portion of overview?.bulkPortions ?? []) {
    if (listed.has(portion.expenseId)) map.set(portion.expenseId, portion);
  }
  return map;
}

/** Portions of purchases made in EARLIER months — the "From bulk purchases" group. */
export function reservedPortions(overview: OverviewSlice | null | undefined): BulkPortionView[] {
  const listed = new Set((overview?.expenses ?? []).map((expense) => expense.id));
  return (overview?.bulkPortions ?? []).filter((portion) => !listed.has(portion.expenseId));
}

/** What a listed row counts toward the month: its portion when it spreads, else its amount. */
export function countedAmountOf(
  expense: Pick<Expense, 'id' | 'amount'>,
  portions: Map<string, BulkPortionView>,
): number {
  return portions.get(expense.id)?.portion_cents ?? expense.amount;
}

/**
 * Every (category, cents) the month counts — listed rows at their counted
 * amount plus reserved portions — in the shape category roll-ups consume.
 */
export function countedCategoryRows(
  overview: OverviewSlice | null | undefined,
): Array<{ category_id: string | null; amount: number }> {
  const portions = portionByExpenseId(overview);
  const rows = (overview?.expenses ?? []).map((expense) => ({
    category_id: expense.category_id,
    amount: countedAmountOf(expense, portions),
  }));
  for (const portion of reservedPortions(overview)) {
    rows.push({ category_id: portion.category_id, amount: portion.portion_cents });
  }
  return rows;
}
