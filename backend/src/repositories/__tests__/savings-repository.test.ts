/**
 * A4 pilot — in-memory repository unit tests (no Miniflare).
 * D1 behavior is covered by existing savings Miniflare integration tests.
 */

import { describe, it, expect } from 'vitest';

import type { SavingsGoal } from '../../db/schema-savings';
import { InMemorySavingsRepository } from '../savings-repository';

const HID = 'hh_repo_test';

function goal(over: Partial<SavingsGoal> = {}): SavingsGoal {
  return {
    id: 'goal_1',
    household_id: HID,
    type: 'custom',
    name: 'Vacation',
    target_amount_cents: 100_000,
    current_amount_cents: 0,
    target_date: null,
    months_of_expenses: null,
    monthly_allocation_cents: null,
    currency: 'CAD',
    status: 'active',
    created_at: '2025-06-01T00:00:00.000Z',
    updated_at: '2025-06-01T00:00:00.000Z',
    ...over,
  };
}

describe('InMemorySavingsRepository', () => {
  it('inserts income idempotently and lists entries inside the month window', async () => {
    const repo = new InMemorySavingsRepository();

    const row = {
      id: 'inc_1',
      household_id: HID,
      source_type: 'salary',
      label: 'Paycheque',
      amount_cents: 500_000,
      income_date: '2025-06-15',
      created_by: 'u1',
    };

    await repo.insertIncomeEntry(row);
    await repo.insertIncomeEntry(row);

    const inMonth = await repo.listIncomeEntries(HID, '2025-06-01', '2025-07-01');
    expect(inMonth).toHaveLength(1);
    expect(inMonth[0].amount_cents).toBe(500_000);

    const outside = await repo.listIncomeEntries(HID, '2025-07-01', '2025-08-01');
    expect(outside).toHaveLength(0);

    expect(await repo.getIncomeEntry(HID, 'inc_1')).toMatchObject({ label: 'Paycheque' });
    expect(await repo.getIncomeEntry('other_hh', 'inc_1')).toBeNull();
  });

  it('lists goals for a household newest-first', async () => {
    const repo = new InMemorySavingsRepository();
    repo.seedGoal(goal({ id: 'g_old', created_at: '2025-01-01T00:00:00.000Z' }));
    repo.seedGoal(goal({ id: 'g_new', created_at: '2025-06-01T00:00:00.000Z' }));

    const listed = await repo.listGoals(HID);
    expect(listed.map((g) => g.id)).toEqual(['g_new', 'g_old']);
    expect(await repo.listGoals('other_hh')).toHaveLength(0);
  });

  it('inserts spending idempotently and lists entries inside the month window', async () => {
    const repo = new InMemorySavingsRepository();

    const row = {
      id: 'spend_1',
      household_id: HID,
      label: 'Groceries',
      amount_cents: 12_500,
      spending_date: '2025-06-10',
      created_by: 'u1',
    };

    await repo.insertSpendingEntry(row);
    await repo.insertSpendingEntry(row);

    const inMonth = await repo.listSpendingEntries(HID, '2025-06-01', '2025-07-01');
    expect(inMonth).toHaveLength(1);
    expect(inMonth[0].amount_cents).toBe(12_500);

    const outside = await repo.listSpendingEntries(HID, '2025-07-01', '2025-08-01');
    expect(outside).toHaveLength(0);

    expect(await repo.getSpendingEntry(HID, 'spend_1')).toMatchObject({ label: 'Groceries' });
    expect(await repo.getSpendingEntry('other_hh', 'spend_1')).toBeNull();
  });

  it('updates and deletes spending entries scoped to household', async () => {
    const repo = new InMemorySavingsRepository();

    await repo.insertSpendingEntry({
      id: 'spend_2',
      household_id: HID,
      label: 'Coffee',
      amount_cents: 500,
      spending_date: '2025-06-12',
      created_by: 'u1',
    });

    await repo.updateSpendingEntry(HID, 'spend_2', {
      label: 'Latte',
      amount_cents: 650,
      updated_at: '2025-06-13T00:00:00.000Z',
    });

    expect(await repo.getSpendingEntry(HID, 'spend_2')).toMatchObject({
      label: 'Latte',
      amount_cents: 650,
    });

    await repo.deleteSpendingEntry(HID, 'spend_2');
    expect(await repo.getSpendingEntry(HID, 'spend_2')).toBeNull();
  });
});
