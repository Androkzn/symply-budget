/**
 * Savings income source types — the single backend source of truth.
 *
 * These values were previously duplicated verbatim across the route validators,
 * the AI import service and the import prompt, with nothing keeping them in sync.
 * Import from here instead of re-declaring the list.
 *
 * The frontend mirror lives in `src/api/savings.ts` (mobile cannot import from
 * `backend/`); the two lists must be changed together.
 *
 * NOTE: `savings_income_entries.source_type` is plain `TEXT` with no CHECK
 * constraint (migration 0067), so adding a value here needs no migration —
 * validation is enforced entirely by zod at the route layer.
 */

/**
 * Predictable, recurring income. Only these may back a recurring income
 * *template*, because templates are materialised into future months by
 * `applyIncomeTemplates` — i.e. they are forward-looking.
 */
export const REGULAR_INCOME_SOURCE_TYPES = [
  'payroll',
  'rental',
  'rrsp_matching',
  'insurance',
  'other',
] as const;

/**
 * One-off / unpredictable income — marketplace sales, gifts, refunds, bonuses,
 * side work, tax refunds. Recorded as actuals for the month they land in, and
 * deliberately NOT projectable: they cannot be turned into recurring templates,
 * and the Savings Projection tab strips them out of `paceMonthly`/`bestMonth`/
 * `potentialMonthly` (see `SavingsService.getProjection`) so a windfall can't
 * pass as a repeatable benchmark.
 *
 * `tax_refund` moved here from the regular bucket: a refund is a once-a-year
 * event at best, not a monthly-recurring amount, and a large one was silently
 * winning the "best month" benchmark in production before this fix.
 *
 * `other` intentionally stays in the regular bucket. It predates this split and
 * already carries production rows; reclassifying it would silently rewrite
 * households' historical regular-vs-irregular analytics.
 */
export const IRREGULAR_INCOME_SOURCE_TYPES = [
  'marketplace_sale',
  'gift',
  'refund',
  'bonus',
  'freelance',
  'tax_refund',
] as const;

/** Every value accepted on an income *entry*. */
export const INCOME_SOURCE_TYPES = [
  ...REGULAR_INCOME_SOURCE_TYPES,
  ...IRREGULAR_INCOME_SOURCE_TYPES,
] as const;

export type RegularIncomeSourceType = (typeof REGULAR_INCOME_SOURCE_TYPES)[number];
export type IrregularIncomeSourceType = (typeof IRREGULAR_INCOME_SOURCE_TYPES)[number];
export type IncomeSourceType = (typeof INCOME_SOURCE_TYPES)[number];

const IRREGULAR_SET: ReadonlySet<string> = new Set(IRREGULAR_INCOME_SOURCE_TYPES);

/**
 * True when a source type is one-off income. Unknown values (legacy rows written
 * before a value was retired) count as regular, matching the `other` policy above.
 */
export function isIrregularIncomeSource(sourceType: string): boolean {
  return IRREGULAR_SET.has(sourceType);
}
