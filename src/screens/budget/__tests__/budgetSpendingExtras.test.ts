import type { MonthlyOverview } from '@api/budget';

import {
  extrasHistoryBars,
  extrasHistoryMonths,
  extrasHistoryPoint,
  extrasHistoryRangeLabel,
  extrasHistorySummary,
  extraTotalCents,
  EXTRAS_HISTORY_MONTHS,
  SPENDING_EXTRA_BANNER_TEST_IDS,
  SPENDING_EXTRA_COPY,
  SPENDING_EXTRA_KINDS,
  type ExtrasHistoryPoint,
} from '../budgetSpendingExtras';

const overview = (extras: Partial<MonthlyOverview>): MonthlyOverview =>
  ({ savedTotal: 0, ...extras }) as MonthlyOverview;

describe('extraTotalCents', () => {
  it('reads the overview field each kind owns', () => {
    const o = overview({ savedTotal: 279, depositsTotal: 125, taxesTotal: 1900 });
    expect(extraTotalCents(o, 'discounts')).toBe(279);
    expect(extraTotalCents(o, 'deposits')).toBe(125);
    expect(extraTotalCents(o, 'taxes')).toBe(1900);
  });

  it('falls back to zero for an older API response and for no overview', () => {
    const o = overview({ savedTotal: 50 });
    expect(extraTotalCents(o, 'deposits')).toBe(0);
    expect(extraTotalCents(o, 'taxes')).toBe(0);
    expect(extraTotalCents(null, 'discounts')).toBe(0);
    expect(extraTotalCents(undefined, 'taxes')).toBe(0);
  });
});

describe('extrasHistoryMonths', () => {
  it('ends at the viewed month and runs oldest-first', () => {
    expect(extrasHistoryMonths(2026, 9)).toEqual([
      { year: 2026, month: 4 },
      { year: 2026, month: 5 },
      { year: 2026, month: 6 },
      { year: 2026, month: 7 },
      { year: 2026, month: 8 },
      { year: 2026, month: 9 },
    ]);
    expect(extrasHistoryMonths(2026, 9)).toHaveLength(EXTRAS_HISTORY_MONTHS);
  });

  it('crosses a year boundary', () => {
    expect(extrasHistoryMonths(2026, 2, 4)).toEqual([
      { year: 2025, month: 11 },
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
    ]);
  });
});

describe('extrasHistoryPoint', () => {
  it('folds every kind out of one overview, zero when absent', () => {
    const point = extrasHistoryPoint(
      { year: 2026, month: 7 },
      overview({ savedTotal: 300, taxesTotal: 45 }),
    );
    expect(point).toEqual({
      year: 2026,
      month: 7,
      cents: { discounts: 300, deposits: 0, taxes: 45 },
    });
  });

  it('is all zeros for a month whose load returned nothing', () => {
    expect(extrasHistoryPoint({ year: 2026, month: 7 }, null).cents).toEqual({
      discounts: 0,
      deposits: 0,
      taxes: 0,
    });
  });
});

const POINTS: ExtrasHistoryPoint[] = [
  { year: 2026, month: 7, cents: { discounts: 0, deposits: 100, taxes: 1000 } },
  { year: 2026, month: 8, cents: { discounts: 250, deposits: 0, taxes: 2500 } },
  { year: 2026, month: 9, cents: { discounts: 0, deposits: 40, taxes: 1900 } },
];

describe('extrasHistoryBars', () => {
  it('charts the chosen kind in dollars, month-labelled, viewed month accented', () => {
    const bars = extrasHistoryBars(POINTS, 'taxes', { year: 2026, month: 9 }, {
      current: '#current',
      past: '#past',
    });
    expect(bars).toEqual([
      { value: 10, label: 'Jul', frontColor: '#past' },
      { value: 25, label: 'Aug', frontColor: '#past' },
      { value: 19, label: 'Sep', frontColor: '#current' },
    ]);
  });

  it('keeps zero months as zero-height bars so the axis stays continuous', () => {
    const bars = extrasHistoryBars(POINTS, 'discounts', { year: 2026, month: 9 }, {
      current: 'c',
      past: 'p',
    });
    expect(bars.map((b) => b.value)).toEqual([0, 2.5, 0]);
  });
});

describe('extrasHistorySummary', () => {
  it('totals and averages across the WHOLE window, zero months included', () => {
    expect(extrasHistorySummary(POINTS, 'taxes')).toEqual({
      totalCents: 5400,
      averageCents: 1800,
      isEmpty: false,
    });
    expect(extrasHistorySummary(POINTS, 'deposits')).toEqual({
      totalCents: 140,
      averageCents: 47,
      isEmpty: false,
    });
  });

  it('reports an empty window', () => {
    const none = POINTS.map((p) => ({ ...p, cents: { ...p.cents, discounts: 0 } }));
    expect(extrasHistorySummary(none, 'discounts')).toEqual({
      totalCents: 0,
      averageCents: 0,
      isEmpty: true,
    });
    expect(extrasHistorySummary([], 'taxes')).toEqual({
      totalCents: 0,
      averageCents: 0,
      isEmpty: true,
    });
  });
});

describe('extrasHistoryRangeLabel', () => {
  it('collapses a same-year window to one year', () => {
    expect(extrasHistoryRangeLabel(extrasHistoryMonths(2026, 9))).toBe('Apr–Sep 2026');
  });

  it('spells both years across a boundary', () => {
    expect(extrasHistoryRangeLabel(extrasHistoryMonths(2026, 2))).toBe('Sep 2025–Feb 2026');
  });

  it('handles one month and none', () => {
    expect(extrasHistoryRangeLabel([{ year: 2026, month: 9 }])).toBe('Sep 2026');
    expect(extrasHistoryRangeLabel([])).toBe('');
  });
});

describe('copy and ids', () => {
  it('keeps the Maestro-driven banner ids and gives taxes its own', () => {
    expect(SPENDING_EXTRA_BANNER_TEST_IDS).toEqual({
      discounts: 'budget-savings-banner',
      deposits: 'budget-deposits-banner',
      taxes: 'budget-taxes-banner',
    });
  });

  it('renders in the pre-taxes order with taxes last', () => {
    expect(SPENDING_EXTRA_KINDS).toEqual(['discounts', 'deposits', 'taxes']);
  });

  it('answers both questions for every kind', () => {
    for (const kind of SPENDING_EXTRA_KINDS) {
      const copy = SPENDING_EXTRA_COPY[kind];
      expect(copy.title).not.toBe('');
      expect(copy.what.length).toBeGreaterThan(40);
      expect(copy.how.length).toBeGreaterThan(40);
      expect(copy.how).toMatch(/dated in the month/);
    }
    expect(SPENDING_EXTRA_COPY.taxes.bannerTail).toBe('in taxes this month');
  });
});
