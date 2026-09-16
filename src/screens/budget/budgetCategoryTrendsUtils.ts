/**
 * Merge helper for the aggregate "Other" drill-down.
 *
 * The dashboard's top-5 breakdown folds every category below the cut into one
 * "Other" row. That row is not a category, so there is nothing to ask the
 * trends endpoint for — the screen fetches each folded category's trends and
 * stitches them back together here, so "Other" opens the same item list every
 * real category opens.
 */
import type {
  CategoryProductMonth,
  CategoryProductTrend,
  CategoryProductTrends,
} from '@api/budget';

/**
 * Same ±10% dead band the backend uses, so a merged product reads the same way
 * a single-category one does instead of flipping to up/down on a rounding cent.
 */
function classifyTrend(
  currentAmount: number,
  previousAmount: number
): CategoryProductTrend['trend'] {
  if (previousAmount === 0 && currentAmount > 0) return 'new';
  if (currentAmount > previousAmount * 1.1) return 'up';
  if (currentAmount < previousAmount * 0.9) return 'down';
  return 'flat';
}

/** Products are grouped by name, case-insensitively — same key the sources use. */
function productKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Combine several categories' product trends into one bucket.
 *
 * Every part must cover the same month window (the caller fetches them with one
 * anchor and window size); the first part's `months` is taken as canonical and
 * parts are summed index-wise onto it. A product bought in two of the folded
 * categories collapses into a single row whose trend is re-derived from the
 * merged totals.
 */
export function mergeCategoryProductTrends(
  parts: CategoryProductTrends[],
  bucket: { categoryId: string; categoryName: string }
): CategoryProductTrends {
  const months = parts.find((part) => part.months.length > 0)?.months ?? [];
  const monthlyTotals = new Array<number>(months.length).fill(0);
  const monthIndex = new Map(months.map((month, index) => [month, index]));

  const groups = new Map<
    string,
    {
      name: string;
      total: number;
      count: number;
      currentAmount: number;
      currentCount: number;
      previousAmount: number;
      byMonth: CategoryProductMonth[];
    }
  >();

  for (const part of parts) {
    part.monthlyTotals.forEach((total, index) => {
      // Only fold months the canonical window actually covers.
      if (index < monthlyTotals.length) monthlyTotals[index] += total;
    });

    for (const product of part.products) {
      const key = productKey(product.name);
      let group = groups.get(key);
      if (!group) {
        group = {
          name: product.name,
          total: 0,
          count: 0,
          currentAmount: 0,
          currentCount: 0,
          previousAmount: 0,
          byMonth: months.map((month) => ({ month, amount: 0, count: 0 })),
        };
        groups.set(key, group);
      }
      group.total += product.total;
      group.count += product.count;
      group.currentAmount += product.currentAmount;
      group.currentCount += product.currentCount;
      group.previousAmount += product.previousAmount;
      for (const entry of product.byMonth) {
        const index = monthIndex.get(entry.month);
        if (index === undefined) continue;
        group.byMonth[index].amount += entry.amount;
        group.byMonth[index].count += entry.count;
      }
    }
  }

  const products: CategoryProductTrend[] = [...groups.values()]
    .map((group) => ({
      name: group.name,
      total: group.total,
      count: group.count,
      currentAmount: group.currentAmount,
      currentCount: group.currentCount,
      previousAmount: group.previousAmount,
      averageAmount: Math.round(group.total / Math.max(1, months.length)),
      trend: classifyTrend(group.currentAmount, group.previousAmount),
      byMonth: group.byMonth,
    }))
    .sort((a, b) => b.currentAmount - a.currentAmount || b.total - a.total);

  return {
    categoryId: bucket.categoryId,
    categoryName: bucket.categoryName,
    months,
    monthlyTotals,
    currentMonthTotal: parts.reduce((sum, part) => sum + part.currentMonthTotal, 0),
    previousMonthTotal: parts.reduce((sum, part) => sum + part.previousMonthTotal, 0),
    products,
  };
}
