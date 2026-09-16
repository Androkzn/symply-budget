import {
  UNCATEGORIZED_ID,
  buildSpendBuckets,
  expenseCategoryKey,
  filterExpenses,
  sortExpenses,
  spendingDateRange,
  summarizeSpending,
  type FilterableExpense,
} from '../budgetAllSpendingUtils';

function exp(overrides: Partial<FilterableExpense> = {}): FilterableExpense {
  return {
    category_id: null,
    title: 'Item',
    description: null,
    vendor: null,
    amount: 1000,
    expense_date: '2026-07-10',
    ...overrides,
  };
}

describe('spendingDateRange', () => {
  it('scopes a single month with an exclusive next-month end', () => {
    expect(spendingDateRange(2026, 7, 'month')).toEqual({
      start: '2026-07-01',
      end: '2026-08-01',
    });
  });

  it('rolls the exclusive end across the year boundary from December', () => {
    expect(spendingDateRange(2026, 12, 'month')).toEqual({
      start: '2026-12-01',
      end: '2027-01-01',
    });
  });

  it('spans the trailing 3 / 6 months up to (but excluding) the month after the anchor', () => {
    expect(spendingDateRange(2026, 7, '3m')).toEqual({ start: '2026-05-01', end: '2026-08-01' });
    expect(spendingDateRange(2026, 7, '6m')).toEqual({ start: '2026-02-01', end: '2026-08-01' });
  });

  it('crosses the year boundary going back', () => {
    expect(spendingDateRange(2026, 2, '3m')).toEqual({ start: '2025-12-01', end: '2026-03-01' });
  });

  it('covers the whole calendar year for "year"', () => {
    expect(spendingDateRange(2026, 7, 'year')).toEqual({ start: '2026-01-01', end: '2027-01-01' });
  });

  it('returns no bounds for "all"', () => {
    expect(spendingDateRange(2026, 7, 'all')).toEqual({});
  });
});

describe('expenseCategoryKey', () => {
  it('returns the category id, or the uncategorized sentinel', () => {
    expect(expenseCategoryKey({ category_id: 'cat-1' })).toBe('cat-1');
    expect(expenseCategoryKey({ category_id: null })).toBe(UNCATEGORIZED_ID);
  });
});

describe('filterExpenses', () => {
  const items = [
    exp({ title: 'Milk', category_id: 'groceries', vendor: 'Costco' }),
    exp({ title: 'Bus pass', category_id: 'transport', vendor: null }),
    exp({ title: 'Snacks', category_id: null, description: 'movie night' }),
  ];

  it('keeps everything when no category / query is set', () => {
    expect(filterExpenses(items, {})).toHaveLength(3);
    expect(filterExpenses(items, { categoryId: 'all' })).toHaveLength(3);
  });

  it('filters by category id', () => {
    expect(filterExpenses(items, { categoryId: 'groceries' })).toEqual([items[0]]);
  });

  it('filters uncategorized via the sentinel', () => {
    expect(filterExpenses(items, { categoryId: UNCATEGORIZED_ID })).toEqual([items[2]]);
  });

  it('matches the query against title, vendor and description (case-insensitive)', () => {
    expect(filterExpenses(items, { query: 'milk' })).toEqual([items[0]]);
    expect(filterExpenses(items, { query: 'costco' })).toEqual([items[0]]);
    expect(filterExpenses(items, { query: 'MOVIE' })).toEqual([items[2]]);
    expect(filterExpenses(items, { query: 'nothing' })).toHaveLength(0);
  });
});

describe('sortExpenses', () => {
  const a = exp({ title: 'a', amount: 500, expense_date: '2026-07-01' });
  const b = exp({ title: 'b', amount: 3000, expense_date: '2026-07-20' });
  const c = exp({ title: 'c', amount: 1500, expense_date: '2026-07-10' });

  it('orders newest-first for "recent"', () => {
    expect(sortExpenses([a, b, c], 'recent').map((e) => e.title)).toEqual(['b', 'c', 'a']);
  });

  it('orders highest-first for "amount"', () => {
    expect(sortExpenses([a, b, c], 'amount').map((e) => e.title)).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate the input array', () => {
    const input = [a, b, c];
    sortExpenses(input, 'amount');
    expect(input.map((e) => e.title)).toEqual(['a', 'b', 'c']);
  });
});

describe('buildSpendBuckets', () => {
  it('buckets a single month into 5 weekly bars (dollars)', () => {
    const items = [
      exp({ amount: 1000, expense_date: '2026-07-03' }), // W1
      exp({ amount: 2000, expense_date: '2026-07-09' }), // W2 (day 9 → floor(8/7)=1)
      exp({ amount: 500, expense_date: '2026-07-30' }), // W5 (day 30 → floor(29/7)=4)
    ];
    const buckets = buildSpendBuckets(items, 'month', 2026, 7);
    expect(buckets.map((b) => b.label)).toEqual(['W1', 'W2', 'W3', 'W4', 'W5']);
    expect(buckets.map((b) => b.value)).toEqual([10, 20, 0, 0, 5]);
  });

  it('buckets a multi-month range by calendar month across the window', () => {
    const items = [
      exp({ amount: 1000, expense_date: '2026-05-15' }),
      exp({ amount: 3000, expense_date: '2026-07-02' }),
      exp({ amount: 2000, expense_date: '2026-07-20' }),
    ];
    const buckets = buildSpendBuckets(items, '3m', 2026, 7);
    expect(buckets.map((b) => b.label)).toEqual(['May', 'Jun', 'Jul']);
    expect(buckets.map((b) => b.value)).toEqual([10, 0, 50]);
  });

  it('produces 12 month bars for a year range', () => {
    const buckets = buildSpendBuckets([exp({ amount: 1000, expense_date: '2026-03-01' })], 'year', 2026, 7);
    expect(buckets).toHaveLength(12);
    expect(buckets[2]).toEqual({ label: 'Mar', value: 10 });
  });

  it('derives month bars from the data for "all"', () => {
    const items = [
      exp({ amount: 1000, expense_date: '2025-11-05' }),
      exp({ amount: 2000, expense_date: '2026-02-05' }),
    ];
    const buckets = buildSpendBuckets(items, 'all', 2026, 7);
    expect(buckets.map((b) => b.value)).toEqual([10, 20]);
  });
});

describe('summarizeSpending', () => {
  it('totals amount, counts rows, averages (rounded) and sums discount savings', () => {
    const stats = summarizeSpending([
      { amount: 1000, saved_amount: 200 },
      { amount: 2001, saved_amount: 0 },
      { amount: 500 },
    ]);
    expect(stats.total).toBe(3501);
    expect(stats.count).toBe(3);
    expect(stats.average).toBe(1167); // round(3501 / 3)
    expect(stats.saved).toBe(200);
    expect(stats.deposits).toBe(0);
  });

  it('sums container deposits separately from discount savings', () => {
    const stats = summarizeSpending([
      { amount: 1000, saved_amount: 200, deposit_amount: 10 },
      { amount: 500, deposit_amount: 25 },
    ]);
    expect(stats.deposits).toBe(35);
    expect(stats.saved).toBe(200);
  });

  it('is all-zero for an empty set (no divide-by-zero)', () => {
    expect(summarizeSpending([])).toEqual({
      total: 0,
      count: 0,
      average: 0,
      saved: 0,
      deposits: 0,
    });
  });
});
