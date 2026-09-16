/**
 * Planning-horizon derivation + the "someday is never counted" rule.
 * Pure functions — no D1.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { planAffordability, type AffordabilityItem } from '../budget-affordability';
import { budgetHorizonFrom, budgetTimeframeFromDate } from '../budget-service';

// Fixed "now" pinned to UTC midnight so `target - now` is an exact day count.
const FIXED_NOW = '2026-07-15T00:00:00.000Z';
const NOW_MS = Date.parse(FIXED_NOW);
/** ISO date (YYYY-MM-DD) exactly `n` days after FIXED_NOW. */
function daysOut(n: number): string {
  return new Date(NOW_MS + n * 86_400_000).toISOString().slice(0, 10);
}

// Fixed "now" so the 12-month boundary is deterministic.
const NOW = new Date('2026-07-06T00:00:00Z');

describe('budgetHorizonFrom', () => {
  it('undated → someday (a wish)', () => {
    expect(budgetHorizonFrom(undefined)).toBe('someday');
    expect(budgetHorizonFrom(null)).toBe('someday');
    expect(budgetHorizonFrom('')).toBe('someday');
  });

  it('invalid date → someday', () => {
    expect(budgetHorizonFrom('not-a-date')).toBe('someday');
  });

  it('within 12 months → short_term', () => {
    // Uses the real clock; a date ~1 month out is always short-term.
    const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    expect(budgetHorizonFrom(soon)).toBe('short_term');
  });

  it('beyond 12 months → long_term', () => {
    const farOut = new Date(Date.now() + 800 * 86_400_000).toISOString().slice(0, 10);
    expect(budgetHorizonFrom(farOut)).toBe('long_term');
  });
});

describe('budgetHorizonFrom — exact 365-day boundary', () => {
  afterEach(() => vi.useRealTimers());

  it('day 365 is still short_term; day 366 flips to long_term', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    expect(budgetHorizonFrom(daysOut(365))).toBe('short_term');
    expect(budgetHorizonFrom(daysOut(366))).toBe('long_term');
  });

  it('today (0 days) and past dates are short_term', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    expect(budgetHorizonFrom(daysOut(0))).toBe('short_term');
    expect(budgetHorizonFrom(daysOut(-30))).toBe('short_term');
  });
});

describe('budgetTimeframeFromDate — every bucket boundary', () => {
  afterEach(() => vi.useRealTimers());

  it('no date / invalid date → immediate', () => {
    expect(budgetTimeframeFromDate(undefined)).toBe('immediate');
    expect(budgetTimeframeFromDate('')).toBe('immediate');
    expect(budgetTimeframeFromDate('not-a-date')).toBe('immediate');
  });

  it('maps each threshold and the day just past it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const cases: Array<[number, string]> = [
      [-5, 'immediate'], // a past date is still "immediate"
      [30, 'immediate'],
      [31, '1_month'],
      [45, '1_month'],
      [46, '3_months'],
      [135, '3_months'],
      [136, '6_months'],
      [270, '6_months'],
      [271, '1_year'],
      [545, '1_year'],
      [546, '2_years'],
      [1095, '2_years'],
      [1096, '5_years'],
      [2555, '5_years'],
      [2556, '10_years'],
    ];
    for (const [n, expected] of cases) {
      expect(budgetTimeframeFromDate(daysOut(n))).toBe(expected);
    }
  });
});

describe('planAffordability — someday items are never counted', () => {
  const base: Omit<AffordabilityItem, 'id' | 'horizon' | 'target_date'> = {
    title: 'x',
    priority: 'high',
    estimated_cost_min: 10_000,
    estimated_cost_max: 10_000,
    actual_cost: null,
    status: 'planned',
  };

  it('excludes someday from the fit even with budget to spare', () => {
    const items: AffordabilityItem[] = [
      { ...base, id: 'a', horizon: 'short_term', target_date: '2026-07-20' },
      { ...base, id: 'b', horizon: 'someday', target_date: null },
    ];
    const plan = planAffordability(items, 1_000_000, NOW);
    const ids = [...plan.affordable, ...plan.deferred].map((i) => i.id);
    expect(ids).toContain('a');
    expect(ids).not.toContain('b');
    expect(plan.used_budget).toBe(10_000); // only 'a'
  });
});
