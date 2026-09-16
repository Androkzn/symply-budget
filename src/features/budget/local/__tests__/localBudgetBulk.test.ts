/**
 * Bulk purchases through the local facade: one row, one plan, and every
 * month-scoped read agreeing on what each month counts.
 */
import {
  closeLocalBudgetSession,
  getLocalLedger,
  openLocalBudgetSessionForTests,
} from '../engine';
import { localBudgetApi } from '../localBudgetApi';

describe('localBudgetApi — bulk purchases', () => {
  let householdId: string;
  let categoryId: string;

  beforeEach(async () => {
    await openLocalBudgetSessionForTests({ userId: 'user-bulk-1' });
    householdId = getLocalLedger().household.id;
    const { categories } = await localBudgetApi.getCategories(householdId);
    categoryId = categories[0]!.id;
  });

  afterEach(async () => {
    await closeLocalBudgetSession();
  });

  async function recordSalmon(months = 4) {
    const { expense } = await localBudgetApi.addExpense(householdId, {
      title: 'Salmon',
      amount: 40000,
      expense_date: '2026-09-11',
      category_id: categoryId,
      vendor: 'Costco',
      bulk: { months, suggested_months: 3, basis: 'default' },
    });
    return expense;
  }

  it('counts the purchase-month portion and reserves the rest in later months', async () => {
    const expense = await recordSalmon();
    expect(expense.bulk).toEqual({
      months: 4,
      start_month: '2026-09',
      suggested_months: 3,
      basis: 'default',
      quantity: null,
      unit: null,
    });

    const sep = await localBudgetApi.getMonthlyOverview(householdId, 2026, 9);
    expect(sep.actualSpent).toBe(10000);
    expect(sep.expenses.map((e) => e.id)).toEqual([expense.id]);
    expect(sep.bulkPortions?.map((p) => [p.index, p.portion_cents, p.month])).toEqual([[1, 10000, '2026-09']]);
    expect(sep.bulkReservedTotal).toBe(0);
    expect(sep.bulkDeferredTotal).toBe(30000);
    expect(sep.bulkLastMonth).toBe('2026-12');

    const oct = await localBudgetApi.getMonthlyOverview(householdId, 2026, 10);
    expect(oct.actualSpent).toBe(10000);
    expect(oct.expenses).toEqual([]);
    expect(oct.bulkPortions?.map((p) => [p.index, p.portion_cents, p.expenseId])).toEqual([[2, 10000, expense.id]]);
    expect(oct.bulkReservedTotal).toBe(10000);
    expect(oct.bulkDeferredTotal).toBe(0);

    const jan = await localBudgetApi.getMonthlyOverview(householdId, 2027, 1);
    expect(jan.actualSpent).toBe(0);
    expect(jan.bulkPortions).toEqual([]);

    // The goal row reports the same number the overview does.
    const { goal } = await localBudgetApi.getMonthlyGoal(householdId, 2026, 11);
    expect(goal.actual_spent).toBe(10000);
  });

  it('lets a category cap survive the stock-up', async () => {
    await recordSalmon();
    await localBudgetApi.upsertSubBudget(householdId, {
      category_id: categoryId,
      year: 2026,
      month: null,
      limit_type: 'amount',
      amount_cents: 15000,
    });
    const sep = await localBudgetApi.getSubBudgets(householdId, 2026, 9);
    expect(sep.subBudgets[0]).toMatchObject({ category_id: categoryId, spent_cents: 10000, over: false });
    const nov = await localBudgetApi.getSubBudgets(householdId, 2026, 11);
    expect(nov.subBudgets[0]).toMatchObject({ spent_cents: 10000, remaining_cents: 5000 });
  });

  it('re-spreads on every edit and restores the full amount when the plan is cleared', async () => {
    const expense = await recordSalmon();

    await localBudgetApi.updateExpense(householdId, expense.id, { bulk: { months: 2 } });
    expect((await localBudgetApi.getMonthlyOverview(householdId, 2026, 9)).actualSpent).toBe(20000);
    expect((await localBudgetApi.getMonthlyOverview(householdId, 2026, 10)).actualSpent).toBe(20000);
    expect((await localBudgetApi.getMonthlyOverview(householdId, 2026, 11)).actualSpent).toBe(0);

    await localBudgetApi.updateExpense(householdId, expense.id, { amount: 30001 });
    expect((await localBudgetApi.getMonthlyOverview(householdId, 2026, 9)).actualSpent).toBe(15001);
    expect((await localBudgetApi.getMonthlyOverview(householdId, 2026, 10)).actualSpent).toBe(15000);

    // Moving the purchase moves a plan anchored on the purchase month with it.
    await localBudgetApi.updateExpense(householdId, expense.id, { expense_date: '2026-10-02' });
    const moved = (await localBudgetApi.getExpense(householdId, expense.id)).expense;
    expect(moved.bulk?.start_month).toBe('2026-10');
    expect((await localBudgetApi.getMonthlyOverview(householdId, 2026, 9)).actualSpent).toBe(0);
    expect((await localBudgetApi.getMonthlyOverview(householdId, 2026, 11)).actualSpent).toBe(15000);

    const { expense: cleared } = await localBudgetApi.updateExpense(householdId, expense.id, { bulk: null });
    expect(cleared.bulk).toBeNull();
    expect((await localBudgetApi.getMonthlyOverview(householdId, 2026, 10)).actualSpent).toBe(30001);
    expect((await localBudgetApi.getMonthlyOverview(householdId, 2026, 11)).actualSpent).toBe(0);
  });

  it('refuses a plan the month lens could not honour without writing anything', async () => {
    await expect(
      localBudgetApi.addExpense(householdId, {
        title: 'Salmon',
        amount: 40000,
        expense_date: '2026-09-11',
        bulk: { months: 1 },
      }),
    ).rejects.toThrow(/2 to 12 months/);
    expect((await localBudgetApi.getExpenses(householdId)).expenses).toEqual([]);

    const expense = await recordSalmon();
    await expect(
      localBudgetApi.updateExpense(householdId, expense.id, { bulk: { months: 13 } }),
    ).rejects.toThrow(/2 to 12 months/);
    expect((await localBudgetApi.getExpense(householdId, expense.id)).expense.bulk?.months).toBe(4);
  });

  it('removes every portion with the row', async () => {
    const expense = await recordSalmon();
    await localBudgetApi.deleteExpense(householdId, expense.id);
    for (const month of [9, 10, 11, 12]) {
      const overview = await localBudgetApi.getMonthlyOverview(householdId, 2026, month);
      expect(overview.actualSpent).toBe(0);
      expect(overview.bulkPortions).toEqual([]);
    }
    expect((await localBudgetApi.getMonthlyOverview(householdId, 2026, 9)).bulkLastMonth).toBeNull();
  });

  it('accepts a plan per line in a batched save', async () => {
    const { expenses } = await localBudgetApi.addExpensesBulk(householdId, [
      { title: 'Salmon', amount: 40000, expense_date: '2026-09-11', bulk: { months: 4 } },
      { title: 'Bread', amount: 500, expense_date: '2026-09-11' },
    ]);
    expect(expenses[0]!.bulk?.months).toBe(4);
    expect(expenses[1]!.bulk).toBeNull();
    expect((await localBudgetApi.getMonthlyOverview(householdId, 2026, 9)).actualSpent).toBe(10500);
  });

  it('reports product trends as steady consumption with one purchase event', async () => {
    await recordSalmon();
    const trends = await localBudgetApi.getCategoryProductTrends(householdId, categoryId, 2026, 11, 4);
    expect(trends.months).toEqual(['2026-08', '2026-09', '2026-10', '2026-11']);
    expect(trends.monthlyTotals).toEqual([0, 10000, 10000, 10000]);
    const salmon = trends.products.find((p) => p.name === 'salmon')!;
    expect(salmon.count).toBe(1);
    expect(salmon.total).toBe(40000);
    expect(salmon.byMonth.map((m) => m.amount)).toEqual([0, 10000, 10000, 10000]);
  });

  it('tells the transfer screen how much cash is reserved for later months', async () => {
    await localBudgetApi.setMonthlyGoal(householdId, 2026, 9, { planned_budget: 200000 });
    await recordSalmon();
    const context = await localBudgetApi.getTransferContext(householdId, 2026, 9);
    expect(context.actualSpentCents).toBe(10000);
    expect(context.leftoverCents).toBe(190000);
    expect(context.bulkDeferredCents).toBe(30000);
  });

  it('suggests months from the ledger and previews the next twelve months', async () => {
    await localBudgetApi.setMonthlyGoal(householdId, 2026, 10, { planned_budget: 150000 });
    await localBudgetApi.addExpense(householdId, {
      title: 'Bread',
      amount: 700,
      expense_date: '2026-10-03',
    });
    const editing = await recordSalmon();

    const { suggestion, monthContext } = await localBudgetApi.getBulkSuggestion(householdId, {
      title: 'Salmon',
      category_id: categoryId,
      amount: 40000,
      expense_date: '2026-09-11',
      exclude_expense_id: editing.id,
    });
    expect(suggestion.basis).toBe('default');
    expect(suggestion.months).toBe(3);
    expect(monthContext).toHaveLength(12);
    expect(monthContext[0]).toEqual({ month: '2026-09', plannedBudget: null, countedCents: 0 });
    // The row being edited is not counted against its own preview; the bread is.
    expect(monthContext[1]).toEqual({ month: '2026-10', plannedBudget: 150000, countedCents: 700 });
    expect(monthContext[11]!.month).toBe('2027-08');

    // A second stock-up of the same product learns from the first.
    const again = await localBudgetApi.getBulkSuggestion(householdId, {
      title: 'salmon',
      amount: 20000,
      expense_date: '2027-01-15',
    });
    expect(again.suggestion.basis).toBe('own_precedent');
    expect(again.suggestion.months).toBe(2);
  });
});
