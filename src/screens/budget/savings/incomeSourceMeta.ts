/**
 * Presentation metadata for savings income source types.
 *
 * Single FE source of truth for how a `source_type` is *labelled*. The income
 * list, the entry form's source picker and the overview breakdown all read from
 * here — previously each kept its own copy and they drifted.
 *
 * The values themselves live in `src/api/savings.ts` (mirroring
 * `backend/src/constants/income-sources.ts`); this module only names them.
 */
import { type SavingsIncomeSourceType } from '@api/savings';

/**
 * Predictable, recurring income. Only these may back a recurring income
 * template — the backend rejects an irregular source on the template routes.
 */
export const REGULAR_INCOME_SOURCE_TYPES = [
  'payroll',
  'rental',
  'rrsp_matching',
  'insurance',
  'other',
] as const satisfies readonly SavingsIncomeSourceType[];

/**
 * One-off / unpredictable income — marketplace sales, gifts, refunds, bonuses,
 * side work, tax refunds. Counted as actuals for the month they land in and
 * never projected forward. `other` stays regular on purpose (see the backend
 * constant); `tax_refund` moved here — a refund is a once-a-year event, not a
 * repeatable monthly amount, and was silently winning the Projection tab's
 * "best month" benchmark before this fix.
 */
export const IRREGULAR_INCOME_SOURCE_TYPES = [
  'marketplace_sale',
  'gift',
  'refund',
  'bonus',
  'freelance',
  'tax_refund',
] as const satisfies readonly SavingsIncomeSourceType[];

/** Mirror of `backend/src/constants/income-sources.ts` — change both together. */
export const INCOME_SOURCE_TYPES = [
  ...REGULAR_INCOME_SOURCE_TYPES,
  ...IRREGULAR_INCOME_SOURCE_TYPES,
] as const;

const IRREGULAR_INCOME_SET: ReadonlySet<string> = new Set(IRREGULAR_INCOME_SOURCE_TYPES);

/** True when a source type is one-off income. Unknown values count as regular. */
export function isIrregularIncomeSource(sourceType: string): boolean {
  return IRREGULAR_INCOME_SET.has(sourceType);
}

export const INCOME_SOURCE_LABELS: Record<SavingsIncomeSourceType, string> = {
  payroll: 'Payroll',
  rental: 'Rental',
  rrsp_matching: 'RRSP matching',
  insurance: 'Insurance',
  other: 'Other',
  // One-off sources.
  marketplace_sale: 'Marketplace sale',
  gift: 'Gift',
  refund: 'Refund',
  bonus: 'Bonus',
  freelance: 'Freelance',
  tax_refund: 'Tax refund',
};

/**
 * Label for a source type, falling back to the raw key so an unrecognised value
 * from an older/newer backend still renders something readable.
 */
export function incomeSourceLabel(key: string): string {
  return INCOME_SOURCE_LABELS[key as SavingsIncomeSourceType] ?? key;
}

/**
 * Picker options in canonical order — regular sources first, then one-off ones,
 * following the declaration order of `INCOME_SOURCE_LABELS`.
 *
 * Derived from the label map rather than the API's runtime list on purpose: the
 * map is typed `Record<SavingsIncomeSourceType, string>`, so TypeScript already
 * forces a label for every source type, and this module stays importable in
 * tests that mock `@api/savings` (a type-only import has no runtime edge).
 */
export const INCOME_SOURCE_OPTIONS: Array<{
  value: SavingsIncomeSourceType;
  label: string;
}> = (Object.keys(INCOME_SOURCE_LABELS) as SavingsIncomeSourceType[]).map((value) => ({
  value,
  label: INCOME_SOURCE_LABELS[value],
}));
