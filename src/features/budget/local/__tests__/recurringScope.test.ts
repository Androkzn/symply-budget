import { isRecurringPaymentActiveInMonth, type RecurringPaymentScope } from '../savings/recurringScope';

const scope = (over: Partial<RecurringPaymentScope> = {}): RecurringPaymentScope => ({
  scope_type: 'all_year',
  scope_year: null,
  active_months: null,
  ...over,
});

/**
 * The rule this guards: a custom-month scope narrows the ONE year it was
 * configured for and nothing else. A payment that ran Sep–Dec 2026 must not
 * carve the same hole out of 2027.
 */
describe('isRecurringPaymentActiveInMonth', () => {
  it('an all_year payment runs in every month', () => {
    expect(isRecurringPaymentActiveInMonth(scope(), 2026, 1)).toBe(true);
    expect(isRecurringPaymentActiveInMonth(scope(), 2026, 12)).toBe(true);
  });

  it('a custom_months scope narrows only its own year', () => {
    const p = scope({ scope_type: 'custom_months', scope_year: 2026, active_months: [9, 10, 11, 12] });
    expect(isRecurringPaymentActiveInMonth(p, 2026, 9)).toBe(true);
    expect(isRecurringPaymentActiveInMonth(p, 2026, 8)).toBe(false);
  });

  it('runs every month in years other than its scope year', () => {
    const p = scope({ scope_type: 'custom_months', scope_year: 2026, active_months: [9, 10, 11, 12] });
    // August is excluded in 2026 but must NOT be excluded in 2027 or 2025.
    expect(isRecurringPaymentActiveInMonth(p, 2027, 8)).toBe(true);
    expect(isRecurringPaymentActiveInMonth(p, 2025, 8)).toBe(true);
  });

  it('treats an empty or missing month list as no restriction', () => {
    const empty = scope({ scope_type: 'custom_months', scope_year: 2026, active_months: [] });
    const missing = scope({ scope_type: 'custom_months', scope_year: 2026, active_months: null });
    expect(isRecurringPaymentActiveInMonth(empty, 2026, 3)).toBe(true);
    expect(isRecurringPaymentActiveInMonth(missing, 2026, 3)).toBe(true);
  });

  it('treats a null scope_year as unscoped even for custom_months', () => {
    const p = scope({ scope_type: 'custom_months', scope_year: null, active_months: [1] });
    // scope_year never equals the queried year, so the month list never applies.
    expect(isRecurringPaymentActiveInMonth(p, 2026, 7)).toBe(true);
  });

  it('covers every month boundary of a single-month scope', () => {
    const p = scope({ scope_type: 'custom_months', scope_year: 2026, active_months: [1] });
    expect(isRecurringPaymentActiveInMonth(p, 2026, 1)).toBe(true);
    for (const m of [2, 6, 12]) {
      expect(isRecurringPaymentActiveInMonth(p, 2026, m)).toBe(false);
    }
  });
});
