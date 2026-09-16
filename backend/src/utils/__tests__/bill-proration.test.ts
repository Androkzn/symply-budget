import { describe, it, expect } from 'vitest';

import {
  countPeriodDays,
  normalizeProviderKey,
  prorateBillToMonths,
  aggregateMonthlySlices,
} from '../bill-proration';

describe('bill-proration', () => {
  it('counts inclusive period days for BC Hydro Apr 9 – Jun 8', () => {
    expect(countPeriodDays('2026-04-09', '2026-06-08')).toBe(61);
  });

  it('splits a 2-month BC Hydro bill across April, May, and June', () => {
    const slices = prorateBillToMonths({
      billType: 'electricity',
      provider: 'BC Hydro',
      billingPeriodStart: '2026-04-09',
      billingPeriodEnd: '2026-06-08',
      amount: 17972,
      usageQuantity: 1270,
      usageUnit: 'kWh',
    });

    expect(slices).toHaveLength(3);
    expect(slices.map((s) => s.monthKey)).toEqual(['2026-04', '2026-05', '2026-06']);

    const totalAmount = slices.reduce((sum, s) => sum + s.amount, 0);
    expect(totalAmount).toBe(17972);

    // April: 22 days of 61
    expect(slices[0].daysInSlice).toBe(22);
    expect(slices[0].providerKey).toBe('bc_hydro');
  });

  it('assigns full amount to a single-month FortisBC bill', () => {
    const slices = prorateBillToMonths({
      billType: 'gas',
      provider: 'FortisBC',
      billingPeriodStart: '2026-05-12',
      billingPeriodEnd: '2026-06-10',
      amount: 6845,
      usageQuantity: 1.4,
    });

    expect(slices).toHaveLength(2);
    expect(slices[0].monthKey).toBe('2026-05');
    expect(slices[1].monthKey).toBe('2026-06');
    expect(slices.reduce((s, x) => s + x.amount, 0)).toBe(6845);
    expect(slices[0].providerKey).toBe('fortisbc');
  });

  it('prorates quarterly City of Surrey water across three months', () => {
    const slices = prorateBillToMonths({
      billType: 'water',
      provider: 'City of Surrey',
      billingPeriodStart: '2026-01-01',
      billingPeriodEnd: '2026-03-31',
      amount: 24580,
      usageQuantity: 42.5,
    });

    expect(slices).toHaveLength(3);
    expect(slices.every((s) => s.providerKey === 'city_of_surrey')).toBe(true);
    expect(slices.reduce((s, x) => s + x.amount, 0)).toBe(24580);
  });

  it('normalizes provider keys from names and bill types', () => {
    expect(normalizeProviderKey('BC Hydro', 'electricity')).toBe('bc_hydro');
    expect(normalizeProviderKey('FortisBC Energy', 'gas')).toBe('fortisbc');
    expect(normalizeProviderKey('City of Surrey', 'water')).toBe('city_of_surrey');
    expect(normalizeProviderKey(null, 'electricity')).toBe('bc_hydro');
  });

  it('aggregates slices with multi-type filters', () => {
    const hydro = prorateBillToMonths({
      billType: 'electricity',
      provider: 'BC Hydro',
      billingPeriodStart: '2026-04-09',
      billingPeriodEnd: '2026-06-08',
      amount: 17972,
    });
    const gas = prorateBillToMonths({
      billType: 'gas',
      provider: 'FortisBC',
      billingPeriodStart: '2026-05-12',
      billingPeriodEnd: '2026-06-10',
      amount: 6845,
    });

    const mayOnly = aggregateMonthlySlices([...hydro, ...gas], {
      billTypes: ['gas'],
    });
    expect(mayOnly.get('2026-05')?.amount).toBeGreaterThan(0);
    expect(mayOnly.get('2026-04')).toBeUndefined();
  });
});

describe('bill-proration — edge cases', () => {
  describe('countPeriodDays', () => {
    it('a single-day period counts as 1', () => {
      expect(countPeriodDays('2026-07-10', '2026-07-10')).toBe(1);
    });

    it('reversed dates clamp to 1 (never zero or negative)', () => {
      expect(countPeriodDays('2026-06-08', '2026-04-09')).toBe(1);
    });

    it('counts an inclusive cross-year boundary (Dec 31 → Jan 1 = 2)', () => {
      expect(countPeriodDays('2025-12-31', '2026-01-01')).toBe(2);
    });

    it('counts the leap day (Feb 1 → Feb 29 2024 = 29)', () => {
      expect(countPeriodDays('2024-02-01', '2024-02-29')).toBe(29);
    });
  });

  describe('normalizeProviderKey — billType fallbacks', () => {
    it('maps sewer to city_of_surrey and empty provider + unknown type to other', () => {
      expect(normalizeProviderKey(null, 'sewer')).toBe('city_of_surrey');
      expect(normalizeProviderKey('', 'internet')).toBe('other');
      expect(normalizeProviderKey(null, 'gas')).toBe('fortisbc');
    });
  });

  it('assigns the full amount to a single-day bill', () => {
    const slices = prorateBillToMonths({
      billType: 'electricity',
      provider: 'BC Hydro',
      billingPeriodStart: '2026-07-10',
      billingPeriodEnd: '2026-07-10',
      amount: 500,
    });
    expect(slices).toHaveLength(1);
    expect(slices[0]).toMatchObject({ monthKey: '2026-07', amount: 500, daysInSlice: 1 });
  });

  it('returns no slices when the period is reversed', () => {
    const slices = prorateBillToMonths({
      billType: 'electricity',
      provider: 'BC Hydro',
      billingPeriodStart: '2026-06-08',
      billingPeriodEnd: '2026-04-09',
      amount: 500,
    });
    expect(slices).toEqual([]);
  });

  it('keeps a zero-amount bill at zero across every month', () => {
    const slices = prorateBillToMonths({
      billType: 'water',
      provider: 'City of Surrey',
      billingPeriodStart: '2026-01-01',
      billingPeriodEnd: '2026-03-31',
      amount: 0,
    });
    expect(slices).toHaveLength(3);
    expect(slices.every((s) => s.amount === 0)).toBe(true);
  });

  it('prorates a negative (credit/refund) amount and still sums to the total', () => {
    const slices = prorateBillToMonths({
      billType: 'electricity',
      provider: 'BC Hydro',
      billingPeriodStart: '2026-04-09',
      billingPeriodEnd: '2026-06-08',
      amount: -17972,
    });
    expect(slices.reduce((s, x) => s + x.amount, 0)).toBe(-17972);
  });

  it('folds rounding drift into the LAST slice (sum is exact, drift is visible)', () => {
    // 100 across Jan(31)/Feb(28)/Mar(31) = 90 days → 34 + 31 + 34 = 99, drift +1
    const slices = prorateBillToMonths({
      billType: 'water',
      provider: 'City of Surrey',
      billingPeriodStart: '2026-01-01',
      billingPeriodEnd: '2026-03-31',
      amount: 100,
    });
    expect(slices.map((s) => s.amount)).toEqual([34, 31, 35]);
    expect(slices.reduce((s, x) => s + x.amount, 0)).toBe(100);
  });

  it('splits a bill that crosses a year boundary', () => {
    const slices = prorateBillToMonths({
      billType: 'gas',
      provider: 'FortisBC',
      billingPeriodStart: '2025-12-15',
      billingPeriodEnd: '2026-01-15',
      amount: 3200,
    });
    expect(slices.map((s) => s.monthKey)).toEqual(['2025-12', '2026-01']);
    expect(slices[0].daysInSlice).toBe(17);
    expect(slices[1].daysInSlice).toBe(15);
    expect(slices.reduce((s, x) => s + x.amount, 0)).toBe(3200);
  });

  it('gives a leap-February slice its 29th day', () => {
    const slices = prorateBillToMonths({
      billType: 'electricity',
      provider: 'BC Hydro',
      billingPeriodStart: '2024-02-01',
      billingPeriodEnd: '2024-02-29',
      amount: 2900,
    });
    expect(slices).toHaveLength(1);
    expect(slices[0].daysInSlice).toBe(29);
    expect(slices[0].amount).toBe(2900);
  });

  it('prorates usage to 2 decimals and passes null usage through untouched', () => {
    const withUsage = prorateBillToMonths({
      billType: 'electricity',
      provider: 'BC Hydro',
      billingPeriodStart: '2026-04-09',
      billingPeriodEnd: '2026-06-08',
      amount: 17972,
      usageQuantity: 1270,
    });
    const totalUsage = withUsage.reduce((s, x) => s + (x.usageQuantity ?? 0), 0);
    expect(totalUsage).toBeCloseTo(1270, 0);
    withUsage.forEach((s) => {
      // rounded to hundredths
      expect(Math.round((s.usageQuantity as number) * 100) / 100).toBe(s.usageQuantity);
    });

    const noUsage = prorateBillToMonths({
      billType: 'electricity',
      provider: 'BC Hydro',
      billingPeriodStart: '2026-04-09',
      billingPeriodEnd: '2026-06-08',
      amount: 17972,
    });
    expect(noUsage.every((s) => s.usageQuantity === null)).toBe(true);
  });

  describe('aggregateMonthlySlices', () => {
    const hydro = prorateBillToMonths({
      billType: 'electricity',
      provider: 'BC Hydro',
      billingPeriodStart: '2026-04-09',
      billingPeriodEnd: '2026-06-08',
      amount: 17972,
      usageQuantity: 1270,
    });
    const gas = prorateBillToMonths({
      billType: 'gas',
      provider: 'FortisBC',
      billingPeriodStart: '2026-05-12',
      billingPeriodEnd: '2026-06-10',
      amount: 6845,
      usageQuantity: 40,
    });

    it('sums usage and counts bills per month with no filter', () => {
      const all = aggregateMonthlySlices([...hydro, ...gas]);
      const may = all.get('2026-05');
      expect(may?.billCount).toBe(2); // hydro + gas both touch May
      expect(may?.usage).toBeGreaterThan(0);
      expect(may?.amount).toBe(
        (hydro.find((s) => s.monthKey === '2026-05')?.amount ?? 0) +
          (gas.find((s) => s.monthKey === '2026-05')?.amount ?? 0)
      );
    });

    it('filters by providerKeys', () => {
      const fortisOnly = aggregateMonthlySlices([...hydro, ...gas], {
        providerKeys: ['fortisbc'],
      });
      // April is hydro-only → excluded once FortisBC is the only provider kept
      expect(fortisOnly.get('2026-04')).toBeUndefined();
      expect(fortisOnly.get('2026-05')?.billCount).toBe(1);
    });

    it('returns an empty map for no slices', () => {
      expect(aggregateMonthlySlices([]).size).toBe(0);
    });
  });
});
