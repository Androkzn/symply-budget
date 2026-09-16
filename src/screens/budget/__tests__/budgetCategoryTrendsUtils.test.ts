/**
 * mergeCategoryProductTrends — the aggregation behind the dashboard's "Other"
 * drill-down: several categories' trend payloads stitched into one bucket.
 */
import type { CategoryProductTrend, CategoryProductTrends } from '@api/budget';

import { mergeCategoryProductTrends } from '../budgetCategoryTrendsUtils';

const MONTHS = ['2026-05', '2026-06', '2026-07'];

function product(
  overrides: Partial<CategoryProductTrend> & Pick<CategoryProductTrend, 'name'>
): CategoryProductTrend {
  return {
    total: 0,
    count: 0,
    currentAmount: 0,
    currentCount: 0,
    previousAmount: 0,
    averageAmount: 0,
    trend: 'flat',
    byMonth: MONTHS.map((month) => ({ month, amount: 0, count: 0 })),
    ...overrides,
  };
}

function part(overrides: Partial<CategoryProductTrends>): CategoryProductTrends {
  return {
    categoryId: 'cat-x',
    categoryName: 'X',
    months: MONTHS,
    monthlyTotals: [0, 0, 0],
    currentMonthTotal: 0,
    previousMonthTotal: 0,
    products: [],
    ...overrides,
  };
}

const BUCKET = { categoryId: 'other', categoryName: 'Other' };

describe('mergeCategoryProductTrends', () => {
  it('sums the month window and the anchor/previous totals', () => {
    const merged = mergeCategoryProductTrends(
      [
        part({ monthlyTotals: [100, 200, 300], currentMonthTotal: 300, previousMonthTotal: 200 }),
        part({ monthlyTotals: [1, 2, 3], currentMonthTotal: 3, previousMonthTotal: 2 }),
      ],
      BUCKET
    );

    expect(merged.categoryId).toBe('other');
    expect(merged.categoryName).toBe('Other');
    expect(merged.months).toEqual(MONTHS);
    expect(merged.monthlyTotals).toEqual([101, 202, 303]);
    expect(merged.currentMonthTotal).toBe(303);
    expect(merged.previousMonthTotal).toBe(202);
  });

  it('collapses the same product name across categories, case-insensitively', () => {
    const merged = mergeCategoryProductTrends(
      [
        part({
          products: [
            product({
              name: 'Paint',
              total: 6000,
              count: 2,
              currentAmount: 4000,
              currentCount: 1,
              previousAmount: 2000,
              byMonth: [
                { month: MONTHS[0], amount: 0, count: 0 },
                { month: MONTHS[1], amount: 2000, count: 1 },
                { month: MONTHS[2], amount: 4000, count: 1 },
              ],
            }),
          ],
        }),
        part({
          products: [
            product({
              name: 'paint',
              total: 1500,
              count: 1,
              currentAmount: 1500,
              currentCount: 1,
              previousAmount: 0,
              byMonth: [
                { month: MONTHS[0], amount: 0, count: 0 },
                { month: MONTHS[1], amount: 0, count: 0 },
                { month: MONTHS[2], amount: 1500, count: 1 },
              ],
            }),
          ],
        }),
      ],
      BUCKET
    );

    expect(merged.products).toHaveLength(1);
    const paint = merged.products[0]!;
    expect(paint.name).toBe('Paint'); // first spelling seen wins
    expect(paint.total).toBe(7500);
    expect(paint.count).toBe(3);
    expect(paint.currentAmount).toBe(5500);
    expect(paint.currentCount).toBe(2);
    expect(paint.previousAmount).toBe(2000);
    expect(paint.byMonth).toEqual([
      { month: MONTHS[0], amount: 0, count: 0 },
      { month: MONTHS[1], amount: 2000, count: 1 },
      { month: MONTHS[2], amount: 5500, count: 2 },
    ]);
    // Mean monthly spend across the window, not the sum of the parts' means.
    expect(paint.averageAmount).toBe(2500);
  });

  it('re-derives the trend from the merged totals, with the same 10% dead band', () => {
    const merged = mergeCategoryProductTrends(
      [
        part({
          products: [
            // Down in its own category…
            product({ name: 'tools', currentAmount: 1000, previousAmount: 3000, trend: 'down' }),
            product({ name: 'stamps', currentAmount: 900, previousAmount: 1000, trend: 'down' }),
            product({ name: 'seeds', currentAmount: 500, previousAmount: 0, trend: 'new' }),
          ],
        }),
        part({
          products: [
            // …but up once the second category's spend is added in.
            product({ name: 'tools', currentAmount: 4000, previousAmount: 0, trend: 'new' }),
            product({ name: 'stamps', currentAmount: 60, previousAmount: 0, trend: 'new' }),
          ],
        }),
      ],
      BUCKET
    );

    const byName = new Map(merged.products.map((p) => [p.name, p]));
    expect(byName.get('tools')?.trend).toBe('up'); // 5000 vs 3000
    expect(byName.get('stamps')?.trend).toBe('flat'); // 960 vs 1000 → inside ±10%
    expect(byName.get('seeds')?.trend).toBe('new'); // nothing last month
  });

  it('sorts products by current-month spend, falling back to window total', () => {
    const merged = mergeCategoryProductTrends(
      [
        part({
          products: [
            product({ name: 'small', currentAmount: 100, total: 100 }),
            product({ name: 'big', currentAmount: 900, total: 900 }),
            product({ name: 'stale-heavy', currentAmount: 100, total: 5000 }),
          ],
        }),
      ],
      BUCKET
    );

    expect(merged.products.map((p) => p.name)).toEqual(['big', 'stale-heavy', 'small']);
  });

  it('ignores months outside the canonical window instead of misaligning them', () => {
    const merged = mergeCategoryProductTrends(
      [
        part({ monthlyTotals: [10, 20, 30] }),
        part({
          // A stray month the first part's window never covered.
          products: [
            product({
              name: 'ghost',
              currentAmount: 700,
              byMonth: [{ month: '2025-01', amount: 700, count: 1 }],
            }),
          ],
        }),
      ],
      BUCKET
    );

    expect(merged.monthlyTotals).toEqual([10, 20, 30]);
    expect(merged.products[0]?.byMonth).toEqual([
      { month: MONTHS[0], amount: 0, count: 0 },
      { month: MONTHS[1], amount: 0, count: 0 },
      { month: MONTHS[2], amount: 0, count: 0 },
    ]);
  });
});
