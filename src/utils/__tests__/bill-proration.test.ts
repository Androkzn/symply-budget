import { prorateBillToMonths } from '../bill-proration';

describe('prorateBillToMonths', () => {
  it('keeps a single-month bill whole in that month', () => {
    const slices = prorateBillToMonths('2026-04-01', '2026-04-30', 12000);
    expect(slices).toHaveLength(1);
    expect(slices[0].monthKey).toBe('2026-04');
    expect(slices[0].monthLabel).toBe('Apr 2026');
    expect(slices[0].amount).toBe(12000);
  });

  it('splits a cross-month bill by day count and preserves the total', () => {
    // Apr 16–May 15: 15 days in April, 15 in May → even split of $300.00.
    const slices = prorateBillToMonths('2026-04-16', '2026-05-15', 30000);
    expect(slices.map((s) => s.monthKey)).toEqual(['2026-04', '2026-05']);
    expect(slices[0].amount + slices[1].amount).toBe(30000);
    expect(slices[0].amount).toBe(15000);
    expect(slices[1].amount).toBe(15000);
  });

  it('folds rounding drift into the last slice so parts sum to the total', () => {
    const slices = prorateBillToMonths('2026-01-01', '2026-03-31', 10000);
    expect(slices).toHaveLength(3);
    expect(slices.reduce((sum, s) => sum + s.amount, 0)).toBe(10000);
  });

  it('returns [] for invalid dates, reversed ranges, or non-positive amounts', () => {
    expect(prorateBillToMonths('', '', 10000)).toEqual([]);
    expect(prorateBillToMonths('2026-05-01', '2026-04-01', 10000)).toEqual([]);
    expect(prorateBillToMonths('2026-04-01', '2026-04-30', NaN)).toEqual([]);
    expect(prorateBillToMonths('2026-04-01', '2026-04-30', 0)).toEqual([]);
  });
});
