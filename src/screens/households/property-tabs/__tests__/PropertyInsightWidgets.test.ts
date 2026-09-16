/**
 * Unit tests for the pure money/date formatters used across the property tabs
 * (stat tiles, chart axes, review sheets). These are the bits with real logic —
 * the components themselves just render them.
 */
import { formatMoney, formatMoneyShort, formatDate } from '../PropertyInsightWidgets';

describe('formatMoney', () => {
  it('formats cents as two-decimal dollars with thousands separators', () => {
    expect(formatMoney(505334)).toBe('$5,053.34');
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(118100000)).toBe('$1,181,000.00');
  });

  it('renders an em dash for null/undefined', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
  });
});

describe('formatMoneyShort', () => {
  it('compacts millions and thousands', () => {
    expect(formatMoneyShort(118100000)).toBe('$1.18M'); // $1,181,000
    expect(formatMoneyShort(100000000)).toBe('$1M'); // exact million → no decimals
    expect(formatMoneyShort(9250000)).toBe('$93K'); // $92,500 → rounded thousands
    expect(formatMoneyShort(505334)).toBe('$5,053'); // below 10k → full dollars
  });

  it('keeps the sign on negative values', () => {
    expect(formatMoneyShort(-118100000)).toBe('-$1.18M');
  });

  it('renders an em dash for null/undefined', () => {
    expect(formatMoneyShort(null)).toBe('—');
    expect(formatMoneyShort(undefined)).toBe('—');
  });
});

describe('formatDate', () => {
  it('formats an ISO date as "Mon D, YYYY" in UTC', () => {
    expect(formatDate('2026-07-02')).toBe('Jul 2, 2026');
    expect(formatDate('2026-01-31')).toBe('Jan 31, 2026');
  });

  it('renders an em dash for null/undefined and echoes unparseable input', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});
