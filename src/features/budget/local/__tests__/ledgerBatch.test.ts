/**
 * One repaint per sync, not one per merged op.
 *
 * `ledgerRefresh` reacts to every ledger notification by bumping four Zustand
 * stores and invalidating the entire React Query cache. That is the right amount
 * of work for ONE change and completely the wrong amount for a sync run, which
 * merges ops one at a time and used to emit a notification for each: a member
 * being backfilled with a household's history watched every budget surface
 * repaint hundreds of times in a row, off a ledger that was mid-merge each time.
 * Totals climbed, months filled in halfway, charts redrew against partial data.
 *
 * The fix is coalescing at the source, and these tests pin the three properties
 * the sync run depends on:
 *
 *  - nothing is delivered while a batch is open;
 *  - one event per household comes out at the end, carrying the UNION of the
 *    tables that moved — a subscriber must not have to guess;
 *  - the batch is released even when the work throws, or one failed sync would
 *    silence this device's UI permanently.
 *
 * `ledgerRevision` is asserted alongside, because it is the
 * `useSyncExternalStore` snapshot: a revision that moved without a delivered
 * event would let React re-read a half-merged ledger.
 */
import {
  activateLocalBudgetHousehold,
  beginLedgerBatch,
  createLocalBudgetHousehold,
  endLedgerBatch,
  getLedgerRevision,
  mutateLocalLedger,
  getLocalBudgetSession,
  openLocalBudgetSession,
  renameLocalHousehold,
  resetLocalBudgetSession,
  subscribeToLedgerChanges,
  withLedgerBatch,
  type BudgetLedgerChange,
} from '../engine';

const USER = 'user-ledger-batch';

afterEach(async () => {
  await resetLocalBudgetSession();
});

/** Collects what a subscriber actually saw, in order. */
function record(): { changes: BudgetLedgerChange[]; stop: () => void } {
  const changes: BudgetLedgerChange[] = [];
  const stop = subscribeToLedgerChanges((_revision, change) => {
    changes.push(change);
  });
  return { changes, stop };
}

describe('ledger notifications coalesce inside a batch', () => {
  it('delivers nothing until the batch closes, then exactly one event', async () => {
    const first = await openLocalBudgetSession({ userId: USER, displayName: 'Everyday budget' });
    const householdId = first.household.id;
    const { changes, stop } = record();
    const revisionBefore = getLedgerRevision();

    await withLedgerBatch(householdId, async () => {
      // Three separate notifications: a rename and two activations, each of
      // which reaches `notifyLedgerChanged` on its own.
      await renameLocalHousehold('Renamed once', householdId);
      await activateLocalBudgetHousehold(householdId);
      await renameLocalHousehold('Renamed twice', householdId);
      // The whole point: mid-batch the UI has been told nothing, and the
      // snapshot it reads has not moved either.
      expect(changes).toHaveLength(0);
      expect(getLedgerRevision()).toBe(revisionBefore);
    });

    expect(changes).toHaveLength(1);
    expect(changes[0]!.householdId).toBe(householdId);
    expect(getLedgerRevision()).toBeGreaterThan(revisionBefore);
    stop();
  });

  it('carries the union of every table that moved', async () => {
    const first = await openLocalBudgetSession({ userId: USER, displayName: 'Everyday budget' });
    const householdId = first.household.id;
    const { changes, stop } = record();

    await withLedgerBatch(householdId, async () => {
      // A rename is a session-level bump with no tables; an activation moves
      // every table. Merging them must not lose the tables — a subscriber that
      // narrows on `change.tables` would skip the repaint that matters.
      await renameLocalHousehold('Renamed', householdId);
      await activateLocalBudgetHousehold(householdId);
    });

    expect(changes).toHaveLength(1);
    expect(changes[0]!.tables).toContain('expenses');
    expect(changes[0]!.tables).toContain('goals');
    stop();
  });

  it("does not hold a household's events inside another household's batch", async () => {
    // The fan-out syncs every household CONCURRENTLY, so their batches overlap.
    // A global gate would make the foreground household wait for the slowest
    // background one — a household the member cannot see, possibly on a
    // multi-megabyte download — before its own screens updated.
    await resetLocalBudgetSession();
    const first = await openLocalBudgetSession({ userId: USER, displayName: 'Everyday budget' });
    const second = await createLocalBudgetHousehold({ displayName: 'Cottage budget' });
    const { changes, stop } = record();

    await withLedgerBatch(second.household.id, async () => {
      // B is batched; A is not, and must be delivered immediately.
      await renameLocalHousehold('B renamed', second.household.id);
      await renameLocalHousehold('A renamed', first.household.id);
      expect(changes.map((change) => change.householdId)).toEqual([first.household.id]);
    });

    expect(changes).toHaveLength(2);
    expect(changes[1]!.householdId).toBe(second.household.id);
    stop();
  });

  it('releases the batch when the work throws', async () => {
    const first = await openLocalBudgetSession({ userId: USER, displayName: 'Everyday budget' });
    const householdId = first.household.id;
    const { changes, stop } = record();

    await expect(
      withLedgerBatch(householdId, async () => {
        await renameLocalHousehold('Renamed', householdId);
        throw new Error('sync blew up');
      }),
    ).rejects.toThrow('sync blew up');

    // The held event is still delivered: whatever DID land before the failure is
    // on screen, and the next change is not swallowed by a batch nobody closed.
    expect(changes).toHaveLength(1);

    changes.length = 0;
    await renameLocalHousehold('Renamed again', householdId);
    expect(changes).toHaveLength(1);
    stop();
  });

  it('nests, so an inner batch does not flush the outer one', async () => {
    // The apply region nests in production — a checkpoint install inside a sync
    // run inside a fan-out — and a boolean gate would let the innermost one end
    // the whole batch.
    const first = await openLocalBudgetSession({ userId: USER, displayName: 'Everyday budget' });
    const householdId = first.household.id;
    const { changes, stop } = record();

    beginLedgerBatch(householdId);
    beginLedgerBatch(householdId);
    await renameLocalHousehold('Inner', householdId);
    endLedgerBatch(householdId);
    expect(changes).toHaveLength(0);
    await renameLocalHousehold('Outer', householdId);
    endLedgerBatch(householdId);

    expect(changes).toHaveLength(1);
    stop();
  });
});

describe('committed local writes notify forecast consumers', () => {
  it('publishes the changed tables after a local mutation without screen callbacks', async () => {
    const ledger = await openLocalBudgetSession({ userId: USER });
    const { changes, stop } = record();
    await mutateLocalLedger((draft) => {
      draft.savingsIncome.push({
        id: 'refresh-income', amount_cents: 100_000, income_date: '2026-08-01',
        source_type: 'payroll', status: 'confirmed',
      } as typeof draft.savingsIncome[number]);
    }, { opType: 'INCOME_CREATE', entityType: 'income', entityId: 'refresh-income', payload: {} });
    expect(changes).toHaveLength(1);
    expect(changes[0].householdId).toBe(ledger.household.id);
    expect(changes[0].tables).toContain('savingsIncome');
    stop();
  });

  it('does not announce a write whose persistence failed', async () => {
    const ledger = await openLocalBudgetSession({ userId: USER });
    const session = await getLocalBudgetSession(ledger.household.id);
    const { changes, stop } = record();
    const transaction = jest.spyOn(session.store, 'runInTransaction').mockRejectedValueOnce(new Error('storage failed'));
    await expect(mutateLocalLedger((draft) => {
      draft.savingsIncome.push({ id: 'failed-income', amount_cents: 100 } as typeof draft.savingsIncome[number]);
    }, { opType: 'INCOME_CREATE', entityType: 'income', entityId: 'failed-income', payload: {} })).rejects.toThrow('storage failed');
    expect(changes).toHaveLength(0);
    transaction.mockRestore();
    stop();
  });
});
