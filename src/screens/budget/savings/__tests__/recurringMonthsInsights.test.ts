/**
 * Unit tests for the pure helpers behind `RecurringPaymentMonthsChart` — the
 * "which months does this payment apply to" bar chart. Kept pure so they can
 * be tested without rendering the React Native component.
 */
import type { RecurringPaymentMonthlyHistory } from '@api/savings';
import { getAppColors, hexToRgba } from '@theme';

import {
  buildMonthBars,
  describeScope,
  monthBarColor,
  presentMonthStates,
} from '../recurringMonthsInsights';

const colors = getAppColors('light');

/** A month entry that's in scope and applied at its "current" amount (drift-free). */
function appliedMonth(month: number, amountCents: number) {
  return { month, inScope: true, applied: true, appliedAmountCents: amountCents };
}

function skippedMonth(month: number) {
  return { month, inScope: true, applied: false, appliedAmountCents: null };
}

function outOfScopeMonth(month: number) {
  return { month, inScope: false, applied: false, appliedAmountCents: null };
}

describe('monthBarColor', () => {
  it('applied → the brand primary', () => {
    expect(monthBarColor('applied', colors)).toBe(colors.primary);
  });

  it('skipped → a muted/translucent primary', () => {
    expect(monthBarColor('skipped', colors)).toBe(hexToRgba(colors.primary, 0.25));
  });

  it('outOfScope → the neutral divider color', () => {
    expect(monthBarColor('outOfScope', colors)).toBe(colors.divider);
  });
});

describe('buildMonthBars', () => {
  it('all-year payment, every month applied → 12 bars, all "applied" color', () => {
    const history: RecurringPaymentMonthlyHistory = {
      year: 2026,
      amountCents: 5_000,
      scopeType: 'all_year',
      months: Array.from({ length: 12 }, (_, i) => appliedMonth(i + 1, 5_000)),
    };

    const bars = buildMonthBars(history, colors);
    expect(bars).toHaveLength(12);
    expect(bars.every((b) => b.frontColor === colors.primary)).toBe(true);
    expect(bars.every((b) => b.value === 50)).toBe(true);
    // Stable Jan→Dec axis.
    expect(bars.map((b) => b.label)).toEqual(['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']);
  });

  it('custom_months with a gap (in-scope 3–9 only) → 1-2 and 10-12 are outOfScope slivers', () => {
    const months = [
      outOfScopeMonth(1),
      outOfScopeMonth(2),
      appliedMonth(3, 5_000),
      appliedMonth(4, 5_000),
      appliedMonth(5, 5_000),
      appliedMonth(6, 5_000),
      skippedMonth(7),
      appliedMonth(8, 5_000),
      appliedMonth(9, 5_000),
      outOfScopeMonth(10),
      outOfScopeMonth(11),
      outOfScopeMonth(12),
    ];
    const history: RecurringPaymentMonthlyHistory = {
      year: 2026,
      amountCents: 5_000,
      scopeType: 'custom_months',
      months,
    };

    const bars = buildMonthBars(history, colors);
    expect(bars).toHaveLength(12);

    // Out-of-scope months: near-zero sliver + neutral divider color.
    for (const idx of [0, 1, 9, 10, 11]) {
      expect(bars[idx].frontColor).toBe(colors.divider);
      expect(bars[idx].value).toBeGreaterThan(0);
      expect(bars[idx].value).toBeLessThan(1);
    }

    // Applied in-scope months.
    for (const idx of [2, 3, 4, 5, 7, 8]) {
      expect(bars[idx].frontColor).toBe(colors.primary);
      expect(bars[idx].value).toBe(50);
    }

    // The one skipped in-scope month (index 6 → month 7).
    expect(bars[6].frontColor).toBe(hexToRgba(colors.primary, 0.25));
    expect(bars[6].value).toBe(50); // ghost value = current amount / 100
  });

  it('a skipped month (inScope but not applied) gets the muted color and the ghost (current-amount) value', () => {
    const history: RecurringPaymentMonthlyHistory = {
      year: 2026,
      amountCents: 12_345,
      scopeType: 'all_year',
      months: [
        skippedMonth(1),
        ...Array.from({ length: 11 }, (_, i) => appliedMonth(i + 2, 12_345)),
      ],
    };

    const bars = buildMonthBars(history, colors);
    expect(bars[0].frontColor).toBe(hexToRgba(colors.primary, 0.25));
    expect(bars[0].value).toBeCloseTo(123.45);
  });

  it('drift protection: an applied month whose appliedAmountCents differs from the CURRENT amountCents uses the historical amount', () => {
    const history: RecurringPaymentMonthlyHistory = {
      year: 2026,
      // The payment's amount changed since March — current amount is 8000.
      amountCents: 8_000,
      scopeType: 'all_year',
      months: Array.from({ length: 12 }, (_, i) =>
        i === 2 ? appliedMonth(3, 5_000) : appliedMonth(i + 1, 8_000)
      ),
    };

    const bars = buildMonthBars(history, colors);
    // March (index 2) must show its historical $50, NOT the current $80.
    expect(bars[2].value).toBe(50);
    expect(bars[2].value).not.toBe(80);
    // Every other month reflects the (unchanged) current amount.
    expect(bars[0].value).toBe(80);
  });
});

describe('presentMonthStates', () => {
  it('returns only the states actually present, in applied/skipped/outOfScope order', () => {
    const history: RecurringPaymentMonthlyHistory = {
      year: 2026,
      amountCents: 5_000,
      scopeType: 'custom_months',
      months: [
        appliedMonth(1, 5_000),
        outOfScopeMonth(2),
        ...Array.from({ length: 10 }, (_, i) => outOfScopeMonth(i + 3)),
      ],
    };
    expect(presentMonthStates(history)).toEqual(['applied', 'outOfScope']);
  });

  it('omits "skipped" entirely when no month was skipped', () => {
    const history: RecurringPaymentMonthlyHistory = {
      year: 2026,
      amountCents: 5_000,
      scopeType: 'all_year',
      months: Array.from({ length: 12 }, (_, i) => appliedMonth(i + 1, 5_000)),
    };
    expect(presentMonthStates(history)).toEqual(['applied']);
  });
});

describe('describeScope', () => {
  it('"Active all year" for an all_year payment', () => {
    const history: RecurringPaymentMonthlyHistory = {
      year: 2026,
      amountCents: 5_000,
      scopeType: 'all_year',
      months: Array.from({ length: 12 }, (_, i) => appliedMonth(i + 1, 5_000)),
    };
    expect(describeScope(history)).toBe('Active all year');
  });

  it('"Active Mar–Sep {year}" for a custom_months payment in scope Mar–Sep', () => {
    const months = [
      outOfScopeMonth(1),
      outOfScopeMonth(2),
      appliedMonth(3, 5_000),
      appliedMonth(4, 5_000),
      appliedMonth(5, 5_000),
      appliedMonth(6, 5_000),
      appliedMonth(7, 5_000),
      appliedMonth(8, 5_000),
      appliedMonth(9, 5_000),
      outOfScopeMonth(10),
      outOfScopeMonth(11),
      outOfScopeMonth(12),
    ];
    const history: RecurringPaymentMonthlyHistory = {
      year: 2026,
      amountCents: 5_000,
      scopeType: 'custom_months',
      months,
    };
    expect(describeScope(history)).toBe('Active Mar–Sep 2026');
  });
});
