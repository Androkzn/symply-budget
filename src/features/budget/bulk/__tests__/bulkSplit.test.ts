import type { Expense } from '@api/budget';

import {
  addMonths,
  bulkPortionsOf,
  countedCentsForMonth,
  hasBulkPlan,
  lastPlanMonth,
  monthExpenseView,
  normalizeBulkPlan,
  planMonths,
  spentByMonth,
  splitEvenly,
} from '../bulkSplit';

function expense(overrides: Partial<Expense> & { id: string }): Expense {
  return {
    household_id: 'hh',
    budget_item_id: null,
    category_id: 'cat-fish',
    title: 'Salmon',
    description: null,
    amount: 40000,
    saved_amount: 0,
    tax_amount: 0,
    deposit_amount: 0,
    expense_date: '2026-09-11',
    vendor: 'Costco',
    receipt_key: null,
    created_by: null,
    created_at: '2026-09-11T00:00:00.000Z',
    ...overrides,
  };
}

const plan = (months: number, start_month = '2026-09') => ({
  months,
  start_month,
  suggested_months: null,
  basis: null,
});

describe('splitEvenly', () => {
  it('splits an exact amount into equal portions', () => {
    expect(splitEvenly(40000, 4)).toEqual([10000, 10000, 10000, 10000]);
  });

  it('gives the remainder cents to the earliest months and still sums to the amount', () => {
    const parts = splitEvenly(1000, 3);
    expect(parts).toEqual([334, 333, 333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('handles an amount smaller than the month count', () => {
    expect(splitEvenly(1, 3)).toEqual([1, 0, 0]);
  });
});

describe('month arithmetic', () => {
  it('crosses December', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(planMonths(plan(4, '2026-11'))).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });
});

describe('hasBulkPlan', () => {
  it('rejects malformed plans so the row counts in full instead of vanishing', () => {
    expect(hasBulkPlan(expense({ id: 'a' }))).toBe(false);
    expect(hasBulkPlan(expense({ id: 'b', bulk: null }))).toBe(false);
    expect(hasBulkPlan(expense({ id: 'c', bulk: plan(1) }))).toBe(false);
    expect(hasBulkPlan(expense({ id: 'd', bulk: plan(3, '2026-9') }))).toBe(false);
    expect(hasBulkPlan(expense({ id: 'e', bulk: plan(3) }))).toBe(true);
  });
});

describe('portions', () => {
  it('has no portions for an ordinary row', () => {
    expect(bulkPortionsOf(expense({ id: 'plain' }))).toEqual([]);
  });

  it('derives one portion per plan month with 1-based indices', () => {
    const portions = bulkPortionsOf(expense({ id: 'x', bulk: plan(4) }));
    expect(portions.map((p) => [p.month, p.index, p.portion_cents])).toEqual([
      ['2026-09', 1, 10000],
      ['2026-10', 2, 10000],
      ['2026-11', 3, 10000],
      ['2026-12', 4, 10000],
    ]);
    expect(portions[0]!.total_cents).toBe(40000);
    expect(portions[0]!.purchase_date).toBe('2026-09-11');
  });

  it('counts nothing outside the plan and the full amount for ordinary rows', () => {
    const bulk = expense({ id: 'x', bulk: plan(4) });
    expect(countedCentsForMonth(bulk, '2026-08')).toBe(0);
    expect(countedCentsForMonth(bulk, '2026-12')).toBe(10000);
    expect(countedCentsForMonth(bulk, '2027-01')).toBe(0);
    const plain = expense({ id: 'y', amount: 1234 });
    expect(countedCentsForMonth(plain, '2026-09')).toBe(1234);
    expect(countedCentsForMonth(plain, '2026-10')).toBe(0);
  });
});

describe('monthExpenseView', () => {
  const ledger = [
    expense({ id: 'salmon', bulk: plan(4), saved_amount: 5000, deposit_amount: 200, tax_amount: 1900 }),
    expense({ id: 'bread', title: 'Bread', category_id: 'cat-bakery', amount: 500, expense_date: '2026-10-03', tax_amount: 25 }),
    expense({ id: 'coffee', title: 'Coffee', category_id: null, amount: 6000, expense_date: '2026-08-20', bulk: plan(3, '2026-08') }),
  ];

  it('counts the purchase-month portion and defers the rest', () => {
    const view = monthExpenseView(ledger, 2026, 9);
    expect(view.counted.map((c) => [c.expense.id, c.countedCents])).toEqual([['salmon', 10000]]);
    expect(view.counted[0]!.portion?.index).toBe(1);
    expect(view.reserved.map((p) => [p.expenseId, p.index, p.portion_cents])).toEqual([['coffee', 2, 2000]]);
    expect(view.totalCents).toBe(12000);
    expect(view.deferredCents).toBe(30000);
    // Discounts, deposits and tax belong to the purchase event, purchase month only.
    expect(view.savedCents).toBe(5000);
    expect(view.depositsCents).toBe(200);
    expect(view.taxCents).toBe(1900);
    expect(view.byCategoryCents.get('cat-fish')).toBe(10000);
    expect(view.byCategoryCents.has('')).toBe(false);
  });

  it('lists later-month portions as reserved, sorted by purchase date', () => {
    const view = monthExpenseView(ledger, 2026, 10);
    expect(view.counted.map((c) => c.expense.id)).toEqual(['bread']);
    expect(view.reserved.map((p) => p.expenseId)).toEqual(['coffee', 'salmon']);
    expect(view.totalCents).toBe(500 + 2000 + 10000);
    expect(view.deferredCents).toBe(0);
    expect(view.savedCents).toBe(0);
    // Only bread was BOUGHT in October; the salmon's tax stayed in September.
    expect(view.taxCents).toBe(25);
    expect(view.byCategoryCents.get('cat-fish')).toBe(10000);
    expect(view.byCategoryCents.get('cat-bakery')).toBe(500);
  });

  it('is empty once every plan has run out', () => {
    const view = monthExpenseView(ledger, 2027, 1);
    expect(view.counted).toEqual([]);
    expect(view.reserved).toEqual([]);
    expect(view.totalCents).toBe(0);
  });

  it('counts a cleared plan in full again', () => {
    const view = monthExpenseView([expense({ id: 'salmon', bulk: null })], 2026, 9);
    expect(view.totalCents).toBe(40000);
    expect(view.deferredCents).toBe(0);
  });

  it('counts nothing in the purchase month for a plan that starts later, and defers it all', () => {
    const view = monthExpenseView([expense({ id: 'later', bulk: plan(2, '2026-10') })], 2026, 9);
    expect(view.counted).toEqual([expect.objectContaining({ countedCents: 0, portion: null })]);
    expect(view.totalCents).toBe(0);
    expect(view.deferredCents).toBe(40000);
    expect(monthExpenseView([expense({ id: 'later', bulk: plan(2, '2026-10') })], 2026, 10).totalCents).toBe(20000);
  });

  it('orders reserved portions by purchase date whatever order the rows arrive in', () => {
    const rows = [
      expense({ id: 'later', expense_date: '2026-08-20', bulk: plan(3, '2026-08') }),
      expense({ id: 'earlier', expense_date: '2026-07-05', bulk: plan(4, '2026-07') }),
      expense({ id: 'same-day', expense_date: '2026-07-05', title: 'Rice', bulk: plan(4, '2026-07') }),
    ];
    const view = monthExpenseView(rows, 2026, 9);
    expect(view.reserved.map((p) => p.purchase_date)).toEqual(['2026-07-05', '2026-07-05', '2026-08-20']);

    // Two shares bought the same day keep their arrival order.
    const sameDay = monthExpenseView(
      [
        expense({ id: 'rice', title: 'Rice', expense_date: '2026-07-05', bulk: plan(4, '2026-07') }),
        expense({ id: 'salmon', expense_date: '2026-07-05', bulk: plan(4, '2026-07') }),
      ],
      2026,
      9,
    );
    expect(sameDay.reserved.map((p) => p.expenseId)).toEqual(['rice', 'salmon']);

    // Already oldest-first stays oldest-first.
    const ordered = monthExpenseView(
      [
        expense({ id: 'jul', expense_date: '2026-07-05', bulk: plan(4, '2026-07') }),
        expense({ id: 'aug', expense_date: '2026-08-05', bulk: plan(3, '2026-08') }),
      ],
      2026,
      9,
    );
    expect(ordered.reserved.map((p) => p.expenseId)).toEqual(['jul', 'aug']);
  });
});

describe('spentByMonth and lastPlanMonth', () => {
  it('expands every plan in one pass', () => {
    const totals = spentByMonth([
      expense({ id: 'salmon', bulk: plan(4) }),
      expense({ id: 'bread', amount: 500, expense_date: '2026-10-03' }),
    ]);
    expect([...totals.entries()]).toEqual([
      ['2026-09', 10000],
      ['2026-10', 10500],
      ['2026-11', 10000],
      ['2026-12', 10000],
    ]);
  });

  it('reports the furthest month any plan reaches', () => {
    expect(lastPlanMonth([expense({ id: 'plain' })])).toBeNull();
    expect(
      lastPlanMonth([
        expense({ id: 'a', bulk: plan(4) }),
        expense({ id: 'b', bulk: plan(6, '2026-08') }),
      ]),
    ).toBe('2027-01');
    // A shorter plan after a longer one does not pull the answer back.
    expect(
      lastPlanMonth([
        expense({ id: 'b', bulk: plan(6, '2026-08') }),
        expense({ id: 'a', bulk: plan(2) }),
      ]),
    ).toBe('2027-01');
  });
});

describe('normalizeBulkPlan', () => {
  it('defaults the start month to the purchase month and trims optional fields', () => {
    expect(
      normalizeBulkPlan({ months: 4, suggested_months: 3, basis: 'product_rate', unit: ' kg ', quantity: 30 }, '2026-09-11'),
    ).toEqual({
      months: 4,
      start_month: '2026-09',
      suggested_months: 3,
      basis: 'product_rate',
      quantity: 30,
      unit: 'kg',
    });
  });

  it('rejects plans the month lens could not honour', () => {
    expect(() => normalizeBulkPlan({ months: 1 }, '2026-09-11')).toThrow(/2 to 12 months/);
    expect(() => normalizeBulkPlan({ months: 13 }, '2026-09-11')).toThrow(/2 to 12 months/);
    expect(() => normalizeBulkPlan({ months: 2.5 }, '2026-09-11')).toThrow(/2 to 12 months/);
    expect(() => normalizeBulkPlan({ months: 3, start_month: '2026-08' }, '2026-09-11')).toThrow(/before it was bought/);
    expect(() => normalizeBulkPlan({ months: 3, start_month: 'next' }, '2026-09-11')).toThrow(/YYYY-MM/);
  });

  it('allows a later start month', () => {
    expect(normalizeBulkPlan({ months: 3, start_month: '2026-10' }, '2026-09-11').start_month).toBe('2026-10');
  });
});
