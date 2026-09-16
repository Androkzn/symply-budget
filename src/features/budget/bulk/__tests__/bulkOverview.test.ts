import type { BulkPortionView, Expense, MonthlyOverview } from '@api/budget';

import {
  countedAmountOf,
  countedCategoryRows,
  portionByExpenseId,
  reservedPortions,
} from '../bulkOverview';

function expense(overrides: Partial<Expense> & { id: string }): Expense {
  return {
    household_id: 'hh',
    budget_item_id: null,
    category_id: 'cat-fish',
    title: 'Salmon',
    description: null,
    amount: 40000,
    saved_amount: 0,
    expense_date: '2026-09-11',
    vendor: null,
    receipt_key: null,
    created_by: null,
    created_at: '2026-09-11T00:00:00.000Z',
    ...overrides,
  };
}

function portion(expenseId: string, index: number, overrides: Partial<BulkPortionView> = {}): BulkPortionView {
  return {
    expenseId,
    title: 'Salmon',
    category_id: 'cat-fish',
    vendor: null,
    purchase_date: '2026-09-11',
    start_month: '2026-09',
    months: 4,
    index,
    month: '2026-10',
    portion_cents: 10000,
    total_cents: 40000,
    ...overrides,
  };
}

const salmon = expense({ id: 'salmon', bulk: { months: 4, start_month: '2026-09', suggested_months: null, basis: null } });
const bread = expense({ id: 'bread', title: 'Bread', category_id: 'cat-bakery', amount: 500 });

const overview = {
  expenses: [salmon, bread],
  bulkPortions: [
    portion('salmon', 1, { month: '2026-09' }),
    portion('coffee', 2, { title: 'Coffee', category_id: null, purchase_date: '2026-08-20', month: '2026-09' }),
  ],
} satisfies Pick<MonthlyOverview, 'expenses' | 'bulkPortions'>;

describe('bulkOverview', () => {
  it('maps purchase-month portions to the rows the month lists', () => {
    const map = portionByExpenseId(overview);
    expect([...map.keys()]).toEqual(['salmon']);
    expect(map.get('salmon')?.index).toBe(1);
  });

  it('separates portions reserved from earlier purchases', () => {
    expect(reservedPortions(overview).map((p) => p.expenseId)).toEqual(['coffee']);
  });

  it('tolerates a missing overview and older responses without bulk fields', () => {
    expect(portionByExpenseId(null).size).toBe(0);
    expect(reservedPortions(undefined)).toEqual([]);
    expect(countedCategoryRows(null)).toEqual([]);
    expect(countedCategoryRows({ expenses: [bread] })).toEqual([{ category_id: 'cat-bakery', amount: 500 }]);
  });

  it('prints what a row counts here: its portion when it spreads, its amount otherwise', () => {
    const portions = portionByExpenseId(overview);
    expect(countedAmountOf(salmon, portions)).toBe(10000);
    expect(countedAmountOf(bread, portions)).toBe(500);
  });

  it('rolls categories up on the month lens, reserved portions included', () => {
    expect(countedCategoryRows(overview)).toEqual([
      { category_id: 'cat-fish', amount: 10000 },
      { category_id: 'cat-bakery', amount: 500 },
      { category_id: null, amount: 10000 },
    ]);
  });
});
