/**
 * Unit tests for the canonical Budget-tab formatters. These are the PRODUCTION
 * helpers consumed by every budget screen (Dashboard, Planned, Spendings,
 * Savings, item form, AI). A near-identical copy lives in the cross-tab
 * consistency harness (`test-utils/budgetConsistency`); testing the real module
 * directly guards against the two silently drifting apart.
 */
import { useAppStore } from '@stores/appStore';
import type { AppColors } from '@theme';


import type { BudgetPriority } from '../budgetAffordabilityChartUtils';
import { budgetPriorityColor, formatBudgetCurrency, formatBudgetCurrencyRange } from '../budgetFormat';

// The formatter reads the user's selected display currency from the app store.
// Every assertion below the currency block assumes the USD default, so reset it
// after each test to keep the suite order-independent.
afterEach(() => {
  useAppStore.setState({ currency: 'USD' });
});

describe('formatBudgetCurrency', () => {
  it('renders null/undefined as "$0"', () => {
    expect(formatBudgetCurrency(null)).toBe('$0');
    expect(formatBudgetCurrency(undefined)).toBe('$0');
    expect(formatBudgetCurrency(0)).toBe('$0');
  });

  it('renders sub-$1,000 amounts as whole dollars (rounded)', () => {
    expect(formatBudgetCurrency(30000)).toBe('$300');
    expect(formatBudgetCurrency(4990)).toBe('$50'); // $49.90 rounds to $50
  });

  it('never abbreviates $1,000+ to "k" — full figure, comma-grouped', () => {
    expect(formatBudgetCurrency(100000)).toBe('$1,000');
    expect(formatBudgetCurrency(160000)).toBe('$1,600');
    // The digits a "k" would have hidden are exactly the point.
    expect(formatBudgetCurrency(945_600)).toBe('$9,456');
  });

  it('leads negatives with the sign before the "$" (never "$-1,500")', () => {
    expect(formatBudgetCurrency(-30000)).toBe('-$300');
    expect(formatBudgetCurrency(-150000)).toBe('-$1,500');
  });

  it('groups millions the same way (e.g. $1M → "$1,000,000")', () => {
    expect(formatBudgetCurrency(100_000_000)).toBe('$1,000,000');
    expect(formatBudgetCurrency(-100_000_000)).toBe('-$1,000,000');
  });

  it('rounds to whole dollars — never renders cents', () => {
    // $999.50 rounds up to $1,000
    expect(formatBudgetCurrency(99_950)).toBe('$1,000');
    expect(formatBudgetCurrency(123_456)).toBe('$1,235'); // $1,234.56
  });

  describe('selected display currency', () => {
    it('leads amounts with the symbol of the currency chosen in Settings', () => {
      useAppStore.setState({ currency: 'EUR' });
      expect(formatBudgetCurrency(30000)).toBe('€300');
      expect(formatBudgetCurrency(160000)).toBe('€1,600');
      // Sign still leads the symbol, never "€-1,500".
      expect(formatBudgetCurrency(-150000)).toBe('-€1,500');
      expect(formatBudgetCurrency(null)).toBe('€0');
    });

    it('uses "£" for GBP and "₹" for INR', () => {
      useAppStore.setState({ currency: 'GBP' });
      expect(formatBudgetCurrency(30000)).toBe('£300');

      useAppStore.setState({ currency: 'INR' });
      expect(formatBudgetCurrency(30000)).toBe('₹300');
    });

    it('falls back to "$" when the persisted code is unknown', () => {
      useAppStore.setState({ currency: 'ZZZ' as 'USD' });
      expect(formatBudgetCurrency(30000)).toBe('$300');
    });
  });
});

describe('formatBudgetCurrencyRange', () => {
  it('returns "TBD" when both bounds are absent (null or 0)', () => {
    expect(formatBudgetCurrencyRange(null, null)).toBe('TBD');
    expect(formatBudgetCurrencyRange(0, 0)).toBe('TBD');
  });

  it('collapses to a single figure when bounds match or max is missing', () => {
    expect(formatBudgetCurrencyRange(50000, 50000)).toBe('$500');
    expect(formatBudgetCurrencyRange(50000, null)).toBe('$500');
  });

  it('renders "min - max" when the bounds differ', () => {
    expect(formatBudgetCurrencyRange(50000, 150000)).toBe('$500 - $1,500');
    // min absent but max present is still a two-sided range starting at $0
    expect(formatBudgetCurrencyRange(null, 150000)).toBe('$0 - $1,500');
  });
});

describe('budgetPriorityColor', () => {
  const colors = {
    success: 'GREEN',
    yellow: 'YELLOW',
    warning: 'ORANGE',
    error: 'RED',
  } as unknown as AppColors;

  it('maps each priority to its token, with the intentionally inverted scale', () => {
    // Low = red (error), Critical = green (success) — deliberately inverted.
    const cases: Array<[BudgetPriority, string]> = [
      ['critical', 'GREEN'],
      ['high', 'YELLOW'],
      ['medium', 'ORANGE'],
      ['low', 'RED'],
    ];
    for (const [priority, expected] of cases) {
      expect(budgetPriorityColor(colors, priority)).toBe(expected);
    }
  });

  it('falls back to the "medium" tone for an unrecognized backend priority string', () => {
    // Backend priority arrives as a loose string; an unknown value must never
    // render color-less — it falls back to warning (the `?? colors.warning` branch).
    expect(budgetPriorityColor(colors, 'urgent')).toBe('ORANGE');
    expect(budgetPriorityColor(colors, '')).toBe('ORANGE');
  });
});
