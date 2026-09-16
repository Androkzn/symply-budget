/**
 * Bulk purchases — the split math and the ONE month reader.
 *
 * A stock-up purchase is one expense row with a `bulk` plan. Its portions are
 * derived here, never stored: `splitEvenly` gives every device the same cents
 * for the same row, and editing the amount can never leave a stale schedule
 * behind. `monthExpenseView` is what "spent this month" means everywhere in
 * Budget — dashboard, spendings list, sub-budget caps, trends, savings, home
 * teaser, exports. Nothing else may filter expenses by date to build a total.
 *
 * Pure: no I/O, no React, no ledger access.
 */
import type { BulkPlanInput, BulkPortionView, Expense, ExpenseBulkPlan } from '@api/budget';

import { BULK_MAX_MONTHS, BULK_MIN_MONTHS } from './bulkTypes';

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Even split in integer cents. `base = floor(amount / months)` to every month,
 * and the leftover cents go to the EARLIEST months, one each — so the purchase
 * month carries the rounding, the portions sum exactly to the amount, and two
 * devices holding the same row always render the same numbers.
 */
export function splitEvenly(amountCents: number, months: number): number[] {
  const n = Math.max(1, Math.trunc(months));
  const total = Math.trunc(amountCents);
  const base = Math.floor(total / n);
  const rest = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

/** 'YYYY-MM' of a 'YYYY-MM-DD' (or longer ISO) date string. */
export function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}

/** Months since year 0 — the arithmetic form of a month key. */
export function monthIndexOf(monthKey: string): number {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  return year * 12 + (month - 1);
}

export function monthKeyFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export function addMonths(monthKey: string, n: number): string {
  return monthKeyFromIndex(monthIndexOf(monthKey) + n);
}

/** The months a plan covers, oldest first. */
export function planMonths(plan: Pick<ExpenseBulkPlan, 'months' | 'start_month'>): string[] {
  return Array.from({ length: plan.months }, (_, i) => addMonths(plan.start_month, i));
}

/**
 * A row spreads only when its plan is well-formed. A malformed plan (a peer's
 * bug, a hand-edited backup) counts the row in full in its own month rather
 * than making it vanish — the safer failure.
 */
export function hasBulkPlan(expense: Expense): expense is Expense & { bulk: ExpenseBulkPlan } {
  const plan = expense.bulk;
  return (
    !!plan &&
    Number.isInteger(plan.months) &&
    plan.months >= BULK_MIN_MONTHS &&
    typeof plan.start_month === 'string' &&
    MONTH_KEY_RE.test(plan.start_month)
  );
}

/** Every portion of a bulk purchase, oldest first; empty for ordinary rows. */
export function bulkPortionsOf(expense: Expense): BulkPortionView[] {
  if (!hasBulkPlan(expense)) return [];
  const plan = expense.bulk;
  const parts = splitEvenly(expense.amount, plan.months);
  return planMonths(plan).map((month, i) => ({
    expenseId: expense.id,
    title: expense.title,
    category_id: expense.category_id,
    vendor: expense.vendor,
    purchase_date: expense.expense_date,
    start_month: plan.start_month,
    months: plan.months,
    index: i + 1,
    month,
    portion_cents: parts[i]!,
    total_cents: expense.amount,
  }));
}

/** What one row contributes to one month: its amount, its portion, or nothing. */
export function countedCentsForMonth(expense: Expense, monthKey: string): number {
  if (!hasBulkPlan(expense)) {
    return monthKeyOf(expense.expense_date) === monthKey ? expense.amount : 0;
  }
  const offset = monthIndexOf(monthKey) - monthIndexOf(expense.bulk.start_month);
  if (offset < 0 || offset >= expense.bulk.months) return 0;
  return splitEvenly(expense.amount, expense.bulk.months)[offset]!;
}

/**
 * One pass over every (row, month, cents) the month lens counts. Ordinary rows
 * visit once; bulk rows visit once per portion. Multi-month scans (a year of
 * totals, a trend window) build on this instead of re-deriving the rule.
 */
export function forEachCounted(
  expenses: readonly Expense[],
  visit: (expense: Expense, monthKey: string, cents: number) => void,
): void {
  for (const expense of expenses) {
    if (hasBulkPlan(expense)) {
      const parts = splitEvenly(expense.amount, expense.bulk.months);
      planMonths(expense.bulk).forEach((month, i) => visit(expense, month, parts[i]!));
    } else {
      visit(expense, monthKeyOf(expense.expense_date), expense.amount);
    }
  }
}

/** 'YYYY-MM' → counted cents, for every month any row touches. */
export function spentByMonth(expenses: readonly Expense[]): Map<string, number> {
  const totals = new Map<string, number>();
  forEachCounted(expenses, (_expense, month, cents) => {
    totals.set(month, (totals.get(month) ?? 0) + cents);
  });
  return totals;
}

/** A row dated in the month, with what it counts here. */
export interface CountedExpense {
  expense: Expense;
  /** Full amount for ordinary rows; this month's portion for bulk rows. */
  countedCents: number;
  /** The purchase-month portion when the row is a bulk purchase; null otherwise. */
  portion: BulkPortionView | null;
}

export interface MonthExpenseView {
  monthKey: string;
  /** Rows dated in this month (the purchase events). */
  counted: CountedExpense[];
  /** Portions of purchases made in EARLIER months that land in this month. */
  reserved: BulkPortionView[];
  /** Σ counted + Σ reserved — "spent this month". */
  totalCents: number;
  /** Cash paid this month that is counted in later months. */
  deferredCents: number;
  /** Discounts, deposits and tax stay with the purchase event: purchase month only. */
  savedCents: number;
  depositsCents: number;
  /** Σ `tax_amount` of rows dated in this month — sales tax included in what was paid. */
  taxCents: number;
  /** Category id → counted cents, counted rows and reserved portions alike. Uncategorized rows are not keyed. */
  byCategoryCents: Map<string, number>;
}

/** The month reader. Every "this month" number in Budget comes from here. */
export function monthExpenseView(
  expenses: readonly Expense[],
  year: number,
  month: number,
): MonthExpenseView {
  const monthKey = monthKeyFromIndex(year * 12 + (month - 1));
  const counted: CountedExpense[] = [];
  const reserved: BulkPortionView[] = [];
  const byCategoryCents = new Map<string, number>();
  let totalCents = 0;
  let deferredCents = 0;
  let savedCents = 0;
  let depositsCents = 0;
  let taxCents = 0;

  const addCategory = (categoryId: string | null, cents: number) => {
    if (!categoryId) return;
    byCategoryCents.set(categoryId, (byCategoryCents.get(categoryId) ?? 0) + cents);
  };

  for (const expense of expenses) {
    const datedHere = monthKeyOf(expense.expense_date) === monthKey;
    if (hasBulkPlan(expense)) {
      const here = bulkPortionsOf(expense).find((portion) => portion.month === monthKey) ?? null;
      if (datedHere) {
        const cents = here?.portion_cents ?? 0;
        counted.push({ expense, countedCents: cents, portion: here });
        totalCents += cents;
        deferredCents += expense.amount - cents;
        savedCents += expense.saved_amount || 0;
        depositsCents += expense.deposit_amount || 0;
        taxCents += expense.tax_amount || 0;
        addCategory(expense.category_id, cents);
      } else if (here) {
        reserved.push(here);
        totalCents += here.portion_cents;
        addCategory(here.category_id, here.portion_cents);
      }
      continue;
    }
    if (!datedHere) continue;
    counted.push({ expense, countedCents: expense.amount, portion: null });
    totalCents += expense.amount;
    savedCents += expense.saved_amount || 0;
    depositsCents += expense.deposit_amount || 0;
    taxCents += expense.tax_amount || 0;
    addCategory(expense.category_id, expense.amount);
  }

  reserved.sort((a, b) =>
    a.purchase_date < b.purchase_date ? -1 : a.purchase_date > b.purchase_date ? 1 : 0,
  );

  return {
    monthKey,
    counted,
    reserved,
    totalCents,
    deferredCents,
    savedCents,
    depositsCents,
    taxCents,
    byCategoryCents,
  };
}

/** The last 'YYYY-MM' any plan reaches, or null when no row spreads. */
export function lastPlanMonth(expenses: readonly Expense[]): string | null {
  let last: string | null = null;
  for (const expense of expenses) {
    if (!hasBulkPlan(expense)) continue;
    const end = addMonths(expense.bulk.start_month, expense.bulk.months - 1);
    if (last === null || end > last) last = end;
  }
  return last;
}

/**
 * Validate and complete a plan before it is written. Throws on a plan the month
 * lens could not honour, so a bad request fails at the form instead of writing
 * a row every device would then ignore.
 */
export function normalizeBulkPlan(input: BulkPlanInput, expenseDate: string): ExpenseBulkPlan {
  if (!Number.isInteger(input.months) || input.months < BULK_MIN_MONTHS || input.months > BULK_MAX_MONTHS) {
    throw new Error(`A bulk purchase spreads over ${BULK_MIN_MONTHS} to ${BULK_MAX_MONTHS} months.`);
  }
  const purchaseMonth = monthKeyOf(expenseDate);
  const startMonth = input.start_month ?? purchaseMonth;
  if (!MONTH_KEY_RE.test(startMonth)) {
    throw new Error('A bulk purchase needs a start month in YYYY-MM form.');
  }
  if (monthIndexOf(startMonth) < monthIndexOf(purchaseMonth)) {
    throw new Error('A bulk purchase cannot start before it was bought.');
  }
  const quantity =
    typeof input.quantity === 'number' && Number.isFinite(input.quantity) && input.quantity > 0
      ? input.quantity
      : null;
  const unit = typeof input.unit === 'string' && input.unit.trim() ? input.unit.trim() : null;
  return {
    months: input.months,
    start_month: startMonth,
    suggested_months:
      typeof input.suggested_months === 'number' && Number.isInteger(input.suggested_months)
        ? input.suggested_months
        : null,
    basis: input.basis ?? null,
    quantity,
    unit,
  };
}
