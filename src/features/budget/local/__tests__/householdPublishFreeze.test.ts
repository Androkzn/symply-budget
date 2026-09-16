/**
 * The engine's household record must survive being published to the store.
 *
 * `useHouseholdStore` runs through `zustand/middleware/immer`. Immer
 * DEEP-FREEZES the state it produces, and it freezes whatever is reachable from
 * that state — including objects that were put there by an earlier plain
 * `setState`. So publishing the engine's live `ledger.household` by reference
 * froze the engine's own record the moment any later immer update ran.
 *
 * The next local write then died: `mutateLocalLedger` stamps
 * `ledger.household.updated_at` on EVERY create / update / delete, which throws
 * `TypeError: Cannot assign to read-only property 'updated_at'` on a frozen
 * object. `useUnsavedChanges` caught it, so the form never closed and nothing
 * was persisted — the user-visible bug being "I tap Save and nothing happens"
 * and "deleted items don't disappear" (reproduced 2026-08-22 on Budget-C and on
 * the Budget-A/B pair; ~4 saves lost per run, zero rows written).
 *
 * These tests pin the boundary: the store gets a COPY, and money CRUD keeps
 * working after a publish.
 */
import '../cryptoPolyfill';

let mockLocalFirst = true;
jest.mock('../flag', () => ({
  __esModule: true,
  isBudgetLocalFirst: () => mockLocalFirst,
}));

import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';

import {
  closeLocalBudgetSession,
  getLocalLedger,
  openLocalBudgetSessionForTests,
} from '../engine';
import { syncHouseholdStoreFromLocalLedger } from '../ensureSession';
import { localBudgetApi } from '../localBudgetApi';

/**
 * The immer update that actually does the freezing.
 *
 * `syncHouseholdStoreFromLocalLedger` publishes with a plain-object
 * `setState`, which the immer middleware passes straight through — so the
 * freeze does NOT happen on publish. It happens on the next FUNCTION updater,
 * when immer finalizes the whole state tree. `householdStore.fetchHouseholds`
 * runs exactly such an update (`state.isLoading = false`) immediately after
 * publishing, which is why this bug reproduced on every session open.
 */
function runImmerUpdate(): void {
  useHouseholdStore.setState((state) => {
    state.isLoading = false;
  });
}

describe('publishing the engine household into the immer store', () => {
  beforeEach(async () => {
    mockLocalFirst = true;
    useAuthStore.setState({
      user: { id: 'user-freeze-1', email: 'freeze@example.com' } as never,
      isAuthenticated: true,
      hasHydrated: true,
    } as never);
    await openLocalBudgetSessionForTests({ userId: 'user-freeze-1' });
  });

  afterEach(async () => {
    await closeLocalBudgetSession();
  });

  it('publishes a copy, not the engine’s live household object', () => {
    syncHouseholdStoreFromLocalLedger();

    const published = useHouseholdStore.getState().currentHousehold;
    expect(published).not.toBeNull();
    expect(published!.id).toBe(getLocalLedger().household.id);
    // Same VALUE, different IDENTITY — that is the whole fix.
    expect(published).not.toBe(getLocalLedger().household);
  });

  it('leaves the engine’s household writable after immer finalizes the store', () => {
    syncHouseholdStoreFromLocalLedger();
    runImmerUpdate();

    expect(Object.isFrozen(getLocalLedger().household)).toBe(false);
  });

  /**
   * The production failure verbatim.
   *
   * `mutateLocalLedger` runs under Metro, which emits strict-mode modules, so
   * assigning to a frozen property THROWS there. Jest's CommonJS output is not
   * strict, where the same assignment fails SILENTLY — which is why the
   * `addExpense`/`deleteItem` cases below still pass even with the bug present
   * and cannot be relied on to catch it. The explicit `'use strict'` here
   * restores the app's semantics so this test fails when the fix is reverted.
   */
  it('lets mutateLocalLedger stamp updated_at under strict mode', () => {
    syncHouseholdStoreFromLocalLedger();
    runImmerUpdate();

    const stampAsTheEngineDoes = () => {
      'use strict';
      getLocalLedger().household.updated_at = new Date().toISOString();
    };

    expect(stampAsTheEngineDoes).not.toThrow();
  });

  it('still records a spending after the household has been published', async () => {
    syncHouseholdStoreFromLocalLedger();
    runImmerUpdate();

    const householdId = getLocalLedger().household.id;
    await expect(
      localBudgetApi.addExpense(householdId, {
        title: 'Groceries after publish',
        amount: 1234,
        expense_date: '2026-08-22',
      }),
    ).resolves.toBeDefined();

    expect(getLocalLedger().expenses.map((e) => e.title)).toContain('Groceries after publish');
  });

  it('still deletes a planned item after the household has been published', async () => {
    const householdId = getLocalLedger().household.id;
    const { item } = await localBudgetApi.createItem(householdId, {
      title: 'Doomed plan',
      timeframe: 'immediate',
      priority: 'medium',
      estimated_cost_min: 2500,
      estimated_cost_max: 2500,
    });

    syncHouseholdStoreFromLocalLedger();
    runImmerUpdate();

    await expect(localBudgetApi.deleteItem(householdId, item.id)).resolves.toBeUndefined();
    expect(getLocalLedger().items.map((i) => i.id)).not.toContain(item.id);
  });
});
