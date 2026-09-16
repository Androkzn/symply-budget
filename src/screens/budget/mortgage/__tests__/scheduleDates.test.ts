import { paymentDateIso } from '../scheduleDates';

describe('paymentDateIso', () => {
  it('places monthly payment k one month after the term start (start + k months)', () => {
    // Term begins Jun 30 2025 → payment 1 lands Jul 2025, payment 12 lands Jun 2026.
    expect(paymentDateIso('2025-06-30', 1, 'monthly')).toBe('2025-07-28');
    expect(paymentDateIso('2025-06-30', 12, 'monthly')).toBe('2026-06-28');
    expect(paymentDateIso('2025-06-30', 13, 'monthly')).toBe('2026-07-28');
  });

  it('rolls the year over correctly for monthly across December', () => {
    expect(paymentDateIso('2025-11-15', 1, 'monthly')?.slice(0, 7)).toBe('2025-12');
    expect(paymentDateIso('2025-11-15', 2, 'monthly')?.slice(0, 7)).toBe('2026-01');
    expect(paymentDateIso('2025-11-15', 14, 'monthly')?.slice(0, 7)).toBe('2027-01');
  });

  it('clamps the day so a 31st start never yields an invalid short-month date', () => {
    // Jan 31 + 1 month must not spill into March; only the month is displayed.
    expect(paymentDateIso('2026-01-31', 1, 'monthly')).toBe('2026-02-28');
  });

  it('steps bi-weekly payments by ~14 days (365/26)', () => {
    // 26 payments/yr → ~14.04 days each. Payment 2 ≈ 28 days after start.
    expect(paymentDateIso('2025-01-01', 2, 'biweekly')).toBe('2025-01-29');
    expect(paymentDateIso('2025-01-01', 2, 'accel_biweekly')).toBe('2025-01-29');
  });

  it('steps weekly payments by ~7 days (365/52)', () => {
    expect(paymentDateIso('2025-01-01', 4, 'weekly')).toBe('2025-01-29');
  });

  it('returns null for a missing or unparseable term start', () => {
    expect(paymentDateIso(null, 1, 'monthly')).toBeNull();
    expect(paymentDateIso(undefined, 1, 'monthly')).toBeNull();
    expect(paymentDateIso('', 1, 'monthly')).toBeNull();
    expect(paymentDateIso('not-a-date', 1, 'monthly')).toBeNull();
  });

  it('is timezone-safe — a month-end start never rolls back to the prior month', () => {
    // Parsing the ISO parts (not new Date(str)) keeps Jul 31 in July for monthly.
    expect(paymentDateIso('2025-06-30', 1, 'monthly')?.slice(0, 7)).toBe('2025-07');
  });
});
