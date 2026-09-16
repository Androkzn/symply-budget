/**
 * Money/date helpers for the Budget analysis domain. These back every dollar
 * figure and month window the assistant reports, so their correctness is the
 * floor of "quality of response" — exercised here in isolation.
 */
import { describe, it, expect } from 'vitest';

import {
  fmtCents,
  centsToDollars,
  dollarsToCents,
  monthLabel,
  resolveYearMonth,
  monthKeys,
} from '../money';

describe('fmtCents', () => {
  it('formats positive, zero, and sub-dollar cents', () => {
    expect(fmtCents(1250)).toBe('$12.50');
    expect(fmtCents(499)).toBe('$4.99');
    expect(fmtCents(1)).toBe('$0.01');
    expect(fmtCents(0)).toBe('$0.00');
  });

  it('prefixes a minus for negatives (leftover / over-budget)', () => {
    expect(fmtCents(-1250)).toBe('-$12.50');
    expect(fmtCents(-1)).toBe('-$0.01');
  });
});

describe('centsToDollars', () => {
  it('divides integer cents into a dollar float for chart series', () => {
    expect(centsToDollars(2450)).toBe(24.5);
    expect(centsToDollars(199)).toBe(1.99);
    expect(centsToDollars(0)).toBe(0);
  });
});

describe('dollarsToCents', () => {
  it('converts model-supplied numbers and numeric strings to integer cents', () => {
    expect(dollarsToCents(24.5)).toBe(2450);
    expect(dollarsToCents('24.5')).toBe(2450);
    expect(dollarsToCents(0)).toBe(0);
    // Rounds to the nearest cent rather than truncating.
    expect(dollarsToCents(9.999)).toBe(1000);
  });

  it('rejects non-numeric and negative amounts as null', () => {
    expect(dollarsToCents('abc')).toBeNull();
    expect(dollarsToCents(-5)).toBeNull();
    expect(dollarsToCents(undefined)).toBeNull();
    expect(dollarsToCents(NaN)).toBeNull();
  });
});

describe('monthLabel', () => {
  it('renders a human month name', () => {
    expect(monthLabel(2026, 7)).toBe('July 2026');
    expect(monthLabel(2026, 1)).toBe('January 2026');
    expect(monthLabel(2026, 12)).toBe('December 2026');
  });

  it('falls back to the raw month number when out of range', () => {
    expect(monthLabel(2026, 13)).toBe('13 2026');
  });
});

describe('resolveYearMonth', () => {
  it('parses a valid YYYY-MM', () => {
    expect(resolveYearMonth('2026-07', '2025-01-01T00:00:00Z')).toEqual({
      year: 2026,
      month: 7,
      label: 'July 2026',
    });
  });

  it('falls back to the now-ISO month for missing or malformed input', () => {
    const now = '2026-03-15T12:00:00Z';
    expect(resolveYearMonth(undefined, now)).toEqual({ year: 2026, month: 3, label: 'March 2026' });
    expect(resolveYearMonth('not-a-month', now)).toEqual({ year: 2026, month: 3, label: 'March 2026' });
    expect(resolveYearMonth(2026, now)).toEqual({ year: 2026, month: 3, label: 'March 2026' });
  });
});

describe('monthKeys', () => {
  it('returns chronological YYYY-MM keys ending at the anchor, oldest first', () => {
    expect(monthKeys(2026, 7, 6)).toEqual([
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
    ]);
  });

  it('crosses the year boundary correctly', () => {
    expect(monthKeys(2026, 2, 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('handles a single-month window', () => {
    expect(monthKeys(2026, 7, 1)).toEqual(['2026-07']);
  });
});
