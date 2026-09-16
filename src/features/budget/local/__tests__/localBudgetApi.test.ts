import {
  closeLocalBudgetSession,
  getLocalLedger,
  openLocalBudgetSessionForTests,
} from '../engine';
import { CategoryNameConflictError } from '../errors';
import { localBudgetApi } from '../localBudgetApi';

describe('localBudgetApi', () => {
  beforeEach(async () => {
    await openLocalBudgetSessionForTests({ userId: 'user-test-1' });
  });

  afterEach(async () => {
    await closeLocalBudgetSession();
  });

  it('seeds default categories and supports CRUD', async () => {
    const householdId = getLocalLedger().household.id;
    const { categories } = await localBudgetApi.getCategories(householdId);
    expect(categories.length).toBeGreaterThanOrEqual(8);

    // A name outside the seed — 'Pets' is a default now, so creating it would
    // (correctly) hit the duplicate guard before this reached the CRUD path.
    const created = await localBudgetApi.createCategory(householdId, { name: 'Cat Show Fees' });
    expect(created.category.name).toBe('Cat Show Fees');

    await expect(
      localBudgetApi.createCategory(householdId, { name: 'cat show fees' }),
    ).rejects.toBeInstanceOf(CategoryNameConflictError);

    // The seed is protected by the same guard.
    await expect(
      localBudgetApi.createCategory(householdId, { name: 'pets' }),
    ).rejects.toBeInstanceOf(CategoryNameConflictError);

    const expense = await localBudgetApi.addExpense(householdId, {
      title: 'Cat food',
      amount: 1299,
      expense_date: '2026-08-10',
      category_id: created.category.id,
    });
    expect(expense.expense.amount).toBe(1299);

    const overview = await localBudgetApi.getMonthlyOverview(householdId, 2026, 8);
    expect(overview.actualSpent).toBe(1299);

    await localBudgetApi.setMonthlyGoal(householdId, 2026, 8, { planned_budget: 50_000 });
    const afterGoal = await localBudgetApi.getMonthlyOverview(householdId, 2026, 8);
    expect(afterGoal.plannedBudget).toBe(50_000);
    expect(afterGoal.remainingBudget).toBe(50_000 - 1299);
  });

  it('creates planned items and records spending', async () => {
    const householdId = getLocalLedger().household.id;
    const { item } = await localBudgetApi.createItem(householdId, {
      title: 'New shoes',
      timeframe: 'month',
      year: 2026,
      priority: 'medium',
      estimated_cost_min: 8000,
      estimated_cost_max: 8000,
      target_date: '2026-08-15',
    });
    const recorded = await localBudgetApi.recordPlannedSpending(householdId, item.id);
    expect(recorded.expense.amount).toBe(8000);
    expect(recorded.item.status).toBe('completed');
  });

  it('builds quick-add chips the form can apply: spent rows carry `amount`', async () => {
    const householdId = getLocalLedger().household.id;
    const { categories } = await localBudgetApi.getCategories(householdId);
    const categoryId = categories[0].id;
    for (const [title, amount, day] of [
      ['Coffee', 450, '01'],
      ['coffee ', 500, '02'],
      ['Beer', 1200, '03'],
    ] as const) {
      await localBudgetApi.addExpense(householdId, {
        title,
        amount,
        expense_date: `2026-08-${day}`,
        category_id: categoryId,
      });
    }

    const spent = await localBudgetApi.getQuickAddSuggestions(householdId, 'spent');
    const chips = [...spent.recent, ...spent.popular];
    // Grouped by title (case/whitespace-insensitive), so "coffee " folds into "Coffee".
    expect(chips.map((s) => s.title.toLowerCase()).sort()).toEqual(['beer', 'coffee']);
    const coffee = chips.find((s) => s.title.toLowerCase() === 'coffee')!;
    expect(coffee.usage_count).toBe(2);
    expect([450, 500]).toContain(coffee.amount);
    expect(coffee.category_id).toBe(categoryId);
    // Every spent chip carries a positive `amount` — that is what the form's
    // chip handler applies. The old builder put the price on the estimate
    // fields and left `amount` undefined, so chips rendered and taps no-op'd.
    for (const chip of chips) {
      expect(chip.amount).toBeGreaterThan(0);
      expect(chip).toMatchObject({
        estimated_cost_min: null,
        estimated_cost_max: null,
        is_recurring: false,
      });
    }

    const { item } = await localBudgetApi.createItem(householdId, {
      title: 'New shoes',
      timeframe: 'month',
      year: 2026,
      priority: 'high',
      estimated_cost_min: 8000,
      estimated_cost_max: 12000,
      target_date: '2026-08-15',
    });
    const planned = await localBudgetApi.getQuickAddSuggestions(householdId, 'planned');
    const shoes = [...planned.recent, ...planned.popular].find((s) => s.title === item.title);
    expect(shoes).toMatchObject({
      amount: null,
      estimated_cost_min: 8000,
      estimated_cost_max: 12000,
      priority: 'high',
      is_recurring: false,
      usage_count: 1,
    });
  });
});
