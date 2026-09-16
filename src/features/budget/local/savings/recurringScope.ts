/** Month scope for a recurring payment — mirrors backend `RecurringPaymentScope`. */
export type RecurringPaymentScope = {
  scope_type: 'all_year' | 'custom_months';
  scope_year: number | null;
  /** Parsed month list (1–12). Local ledger stores arrays; backend stores JSON strings. */
  active_months: number[] | null;
};

/**
 * Whether an ACTIVE recurring payment counts toward `year`/`month`. Scope only
 * ever narrows the ONE year it was configured for ('all_year', or a
 * 'custom_months' scope belonging to a different year, both run every month)
 * — a payment that started or ended mid-year doesn't repeat that gap next year.
 *
 * Port of `backend/src/services/savings-service.ts` — accepts `active_months`
 * as a number array (local ledger wire shape).
 */
export function isRecurringPaymentActiveInMonth(
  payment: RecurringPaymentScope,
  year: number,
  month: number,
): boolean {
  if (payment.scope_type !== 'custom_months' || payment.scope_year !== year) return true;
  if (!payment.active_months?.length) return true;
  return payment.active_months.includes(month);
}
