import type { TimelineItem } from '@api/budget';

import {
  UNCATEGORIZED_ID,
  buildPlanBuckets,
  filterPlanned,
  filterPlannedByRange,
  plannedAmountCents,
  plannedCategoryKey,
  planningDateRange,
  sortPlanned,
  summarizePlanned,
  toPlannedEntries,
  type PlannedEntry,
} from '../budgetAllPlanningUtils';

function tItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: 'ti-1',
    title: 'Item',
    description: null,
    estimatedCostMin: 1000,
    estimatedCostMax: 1000,
    actualCost: null,
    priority: 'medium',
    status: 'planned',
    targetDate: '2026-07-10',
    timeframe: 'immediate',
    year: 2026,
    quarter: null,
    sourceType: null,
    sourceId: null,
    category: null,
    createdAt: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

function entry(overrides: Partial<PlannedEntry> = {}): PlannedEntry {
  return {
    id: 'e-1',
    title: 'Item',
    description: null,
    categoryId: null,
    minCost: 1000,
    maxCost: 1000,
    amount: 1000,
    priority: 'medium',
    status: 'planned',
    date: '2026-07-10',
    scheduled: true,
    ...overrides,
  };
}

describe('plannedAmountCents', () => {
  it('returns the midpoint of a range', () => {
    expect(plannedAmountCents(60000, 80000)).toBe(70000);
  });

  it('falls back to the present bound when one side is missing', () => {
    expect(plannedAmountCents(5000, null)).toBe(5000);
    expect(plannedAmountCents(null, 5000)).toBe(2500);
    expect(plannedAmountCents(null, null)).toBe(0);
  });
});

describe('toPlannedEntries', () => {
  it('keeps planned/in_progress/deferred and drops completed/cancelled', () => {
    const items = [
      tItem({ id: 'a', status: 'planned' }),
      tItem({ id: 'b', status: 'in_progress' }),
      tItem({ id: 'c', status: 'deferred' }),
      tItem({ id: 'd', status: 'completed' }),
      tItem({ id: 'e', status: 'cancelled' }),
    ];
    expect(toPlannedEntries(items).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('uses targetDate as the effective date and marks it scheduled', () => {
    const [e] = toPlannedEntries([tItem({ targetDate: '2026-09-15', createdAt: '2026-07-01T00:00:00Z' })]);
    expect(e.date).toBe('2026-09-15');
    expect(e.scheduled).toBe(true);
  });

  it('falls back to createdAt when there is no target date (unscheduled)', () => {
    const [e] = toPlannedEntries([tItem({ targetDate: null, createdAt: '2026-07-01T09:30:00Z' })]);
    expect(e.date).toBe('2026-07-01');
    expect(e.scheduled).toBe(false);
  });

  it('derives categoryId from the embedded category and midpoint amount', () => {
    const [e] = toPlannedEntries([
      tItem({
        estimatedCostMin: 60000,
        estimatedCostMax: 80000,
        category: {
          id: 'cat-home',
          household_id: 'hh',
          name: 'Home',
          icon: '🏠',
          color: '#66BB6A',
          sort_order: 0,
          created_at: '2026-07-01T00:00:00Z',
        },
      }),
    ]);
    expect(e.categoryId).toBe('cat-home');
    expect(e.amount).toBe(70000);
  });
});

describe('planningDateRange', () => {
  it('scopes a single month with an exclusive next-month end', () => {
    expect(planningDateRange(2026, 7, 'month')).toEqual({ start: '2026-07-01', end: '2026-08-01' });
  });

  it('spans trailing 3 / 6 months', () => {
    expect(planningDateRange(2026, 7, '3m')).toEqual({ start: '2026-05-01', end: '2026-08-01' });
    expect(planningDateRange(2026, 7, '6m')).toEqual({ start: '2026-02-01', end: '2026-08-01' });
  });

  it('covers the calendar year and returns no bounds for all', () => {
    expect(planningDateRange(2026, 7, 'year')).toEqual({ start: '2026-01-01', end: '2027-01-01' });
    expect(planningDateRange(2026, 7, 'all')).toEqual({});
  });
});

describe('filterPlannedByRange', () => {
  const entries = [
    entry({ id: 'may', date: '2026-05-20' }),
    entry({ id: 'jul', date: '2026-07-04' }),
    entry({ id: 'aug', date: '2026-08-02' }),
  ];

  it('keeps only entries inside the window (end exclusive)', () => {
    expect(filterPlannedByRange(entries, 2026, 7, 'month').map((e) => e.id)).toEqual(['jul']);
    expect(filterPlannedByRange(entries, 2026, 7, '3m').map((e) => e.id)).toEqual(['may', 'jul']);
  });

  it('keeps everything for the all range', () => {
    expect(filterPlannedByRange(entries, 2026, 7, 'all')).toHaveLength(3);
  });
});

describe('plannedCategoryKey / filterPlanned', () => {
  const entries = [
    entry({ id: 'a', title: 'New sofa', categoryId: 'home', description: 'living room' }),
    entry({ id: 'b', title: 'Winter tires', categoryId: 'car' }),
    entry({ id: 'c', title: 'Gift', categoryId: null }),
  ];

  it('maps a null category to the uncategorized sentinel', () => {
    expect(plannedCategoryKey({ categoryId: 'home' })).toBe('home');
    expect(plannedCategoryKey({ categoryId: null })).toBe(UNCATEGORIZED_ID);
  });

  it('filters by category id and uncategorized sentinel', () => {
    expect(filterPlanned(entries, { categoryId: 'home' }).map((e) => e.id)).toEqual(['a']);
    expect(filterPlanned(entries, { categoryId: UNCATEGORIZED_ID }).map((e) => e.id)).toEqual(['c']);
    expect(filterPlanned(entries, { categoryId: 'all' })).toHaveLength(3);
  });

  it('matches the query against title and description (case-insensitive)', () => {
    expect(filterPlanned(entries, { query: 'SOFA' }).map((e) => e.id)).toEqual(['a']);
    expect(filterPlanned(entries, { query: 'living' }).map((e) => e.id)).toEqual(['a']);
    expect(filterPlanned(entries, { query: 'none' })).toHaveLength(0);
  });
});

describe('sortPlanned', () => {
  const a = entry({ id: 'a', amount: 500, date: '2026-07-01' });
  const b = entry({ id: 'b', amount: 3000, date: '2026-07-20' });
  const c = entry({ id: 'c', amount: 1500, date: '2026-07-10' });

  it('orders newest-first for recent and highest-first for amount', () => {
    expect(sortPlanned([a, b, c], 'recent').map((e) => e.id)).toEqual(['b', 'c', 'a']);
    expect(sortPlanned([a, b, c], 'amount').map((e) => e.id)).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate the input', () => {
    const input = [a, b, c];
    sortPlanned(input, 'amount');
    expect(input.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('buildPlanBuckets', () => {
  it('buckets a single month into 5 weekly bars (dollars)', () => {
    const entries = [
      entry({ amount: 1000, date: '2026-07-03' }), // W1
      entry({ amount: 2000, date: '2026-07-09' }), // W2
      entry({ amount: 500, date: '2026-07-30' }), // W5
    ];
    const buckets = buildPlanBuckets(entries, 'month', 2026, 7);
    expect(buckets.map((b) => b.label)).toEqual(['W1', 'W2', 'W3', 'W4', 'W5']);
    expect(buckets.map((b) => b.value)).toEqual([10, 20, 0, 0, 5]);
  });

  it('buckets a multi-month range by calendar month', () => {
    const entries = [
      entry({ amount: 1000, date: '2026-05-15' }),
      entry({ amount: 3000, date: '2026-07-02' }),
      entry({ amount: 2000, date: '2026-07-20' }),
    ];
    const buckets = buildPlanBuckets(entries, '3m', 2026, 7);
    expect(buckets.map((b) => b.label)).toEqual(['May', 'Jun', 'Jul']);
    expect(buckets.map((b) => b.value)).toEqual([10, 0, 50]);
  });
});

describe('summarizePlanned', () => {
  it('totals amount, counts, averages (rounded) and counts scheduled', () => {
    const stats = summarizePlanned([
      entry({ amount: 1000, scheduled: true }),
      entry({ amount: 2001, scheduled: false }),
      entry({ amount: 500, scheduled: true }),
    ]);
    expect(stats.total).toBe(3501);
    expect(stats.count).toBe(3);
    expect(stats.average).toBe(1167); // round(3501 / 3)
    expect(stats.scheduled).toBe(2);
  });

  it('is all-zero for an empty set (no divide-by-zero)', () => {
    expect(summarizePlanned([])).toEqual({ total: 0, count: 0, average: 0, scheduled: 0 });
  });
});
