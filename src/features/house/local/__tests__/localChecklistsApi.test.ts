/**
 * `localChecklistsApi` + the ported instance logic (plan §6, DoD "ported server
 * logic each has a unit test asserting parity with the server implementation").
 *
 * The server side of this pair is
 * `git show ed43b610:backend/src/services/checklist-service.ts` — the last
 * working implementation, since `main` now stubs every recurring method. The
 * period fixtures below are its `calculateCurrentPeriod` output, not invented
 * expectations.
 *
 * The suite runs against a REAL in-memory session (`openLocalHouseSession`), so
 * every write goes through the op journal, the per-row AEAD envelopes and the
 * projection — the same path a device takes. Imports are static: `await
 * import()` throws under this Jest config (plan §6.2).
 */
import { checklistsApi } from '@api/checklists';

import {
  getLocalHouseLedger,
  mutateLocalHouseLedger,
  openLocalHouseSession,
  resetLocalHouseSession,
} from '../engine';
import { HouseLocalUnknownPropertyError } from '../errors';
import { houseDeterministicIds } from '../ids';
import { parityGap } from '../localApiProxy';
import { localChecklistsApi } from '../localChecklistsApi';
import {
  calculateCurrentPeriod,
  checklistInstanceId,
  deriveInstanceStatus,
  summarizeInstances,
} from '../logic/checklistInstances';
import type { LocalChecklistInstance, LocalRecurringChecklistItem } from '../types';

const USER = 'user-house-checklists';

/** A Thursday, so the weekly period has to walk back four days. */
const THURSDAY = new Date(2026, 7, 13, 15, 30);

async function freshSession() {
  await resetLocalHouseSession();
  return openLocalHouseSession({ userId: USER, displayName: 'Checklist home' });
}

function householdId(): string {
  return getLocalHouseLedger().household.id;
}

/** Ops are what the relay ships — the bulk rule is measured in these. */
function opCount(): number {
  return getLocalHouseLedger().ops.length;
}

function instanceRow(id: string): LocalChecklistInstance {
  return getLocalHouseLedger().checklistInstances.find((row) => row.id === id)!;
}

describe('calculateCurrentPeriod — parity with checklist-service.ts:247', () => {
  it('bills a daily checklist by the calendar day', () => {
    expect(calculateCurrentPeriod('daily', THURSDAY)).toEqual({
      start: '2026-08-13',
      end: '2026-08-14',
      label: 'Thursday, Aug 13',
    });
  });

  it('bills a weekly checklist from the preceding Sunday', () => {
    expect(calculateCurrentPeriod('weekly', THURSDAY)).toEqual({
      start: '2026-08-09',
      end: '2026-08-16',
      label: 'Week 3, Aug 2026',
    });
  });

  it('walks a weekly period back across a month boundary', () => {
    // Tue 2026-09-01 — the week began Sun 2026-08-30.
    expect(calculateCurrentPeriod('weekly', new Date(2026, 8, 1)).start).toBe('2026-08-30');
  });

  it('bills monthly, quarterly and yearly on their calendar boundaries', () => {
    expect(calculateCurrentPeriod('monthly', THURSDAY)).toEqual({
      start: '2026-08-01',
      end: '2026-09-01',
      label: 'August 2026',
    });
    expect(calculateCurrentPeriod('quarterly', THURSDAY)).toEqual({
      start: '2026-07-01',
      end: '2026-10-01',
      label: 'Q3 2026',
    });
    expect(calculateCurrentPeriod('yearly', THURSDAY)).toEqual({
      start: '2026-01-01',
      end: '2027-01-01',
      label: '2026',
    });
  });

  it('rolls a December monthly period into the next year', () => {
    expect(calculateCurrentPeriod('monthly', new Date(2026, 11, 20)).end).toBe('2027-01-01');
  });

  it('falls back to daily for seasonal and custom, as the server does', () => {
    const daily = calculateCurrentPeriod('daily', THURSDAY);
    expect(calculateCurrentPeriod('seasonal', THURSDAY)).toEqual(daily);
    expect(calculateCurrentPeriod('custom', THURSDAY)).toEqual(daily);
  });

  it('keys the period off local midnight, not UTC', () => {
    // 23:30 local on the 13th is the 14th in UTC. The server's
    // `toISOString().split('T')[0]` would key this period to the wrong day for
    // any member west of UTC, and `period_start` is half the instance key.
    expect(calculateCurrentPeriod('daily', new Date(2026, 7, 13, 23, 30)).start).toBe('2026-08-13');
  });
});

describe('instance progress arithmetic', () => {
  it('derives the same status the server derived in two places', () => {
    expect(deriveInstanceStatus(0, 4)).toBe('not_started');
    expect(deriveInstanceStatus(1, 4)).toBe('in_progress');
    expect(deriveInstanceStatus(4, 4)).toBe('completed');
    // An item deleted after it was ticked leaves completions > total.
    expect(deriveInstanceStatus(5, 4)).toBe('completed');
  });

  it('counts a streak from the newest period and stops at the first miss', () => {
    const recent = [
      { status: 'completed' },
      { status: 'completed' },
      { status: 'in_progress' },
      { status: 'completed' },
    ] as LocalChecklistInstance[];
    expect(summarizeInstances(recent)).toEqual({ completionRate: 75, streak: 2 });
    expect(summarizeInstances([])).toEqual({ completionRate: 0, streak: 0 });
  });
});

describe('localChecklistsApi', () => {
  beforeEach(async () => {
    await freshSession();
  });

  afterEach(async () => {
    await resetLocalHouseSession();
  });

  it('seeds the four default checklists in ONE op, not twenty-five', async () => {
    const before = opCount();
    await localChecklistsApi.createDefaults(householdId());

    const ledger = getLocalHouseLedger();
    expect(ledger.recurringChecklists).toHaveLength(4);
    expect(ledger.recurringChecklistItems).toHaveLength(21);
    // 25 rows fit one chunk (MAX_OP_DELTA_ROWS is 250), so the whole seed is a
    // single op. A per-row loop would be 25 — and 25 full ledger diffs.
    expect(opCount() - before).toBe(1);
  });

  it('converges when two members both press "create defaults"', async () => {
    const hh = householdId();
    await localChecklistsApi.createDefaults(hh);
    const firstIds = getLocalHouseLedger()
      .recurringChecklists.map((row) => row.id)
      .sort();

    await localChecklistsApi.createDefaults(hh);

    const ledger = getLocalHouseLedger();
    expect(ledger.recurringChecklists).toHaveLength(4);
    expect(ledger.recurringChecklistItems).toHaveLength(21);
    expect(ledger.recurringChecklists.map((row) => row.id).sort()).toEqual(firstIds);
  });

  it('reactivates a deleted default instead of duplicating it, and keeps renames', async () => {
    const hh = householdId();
    await localChecklistsApi.createDefaults(hh);
    const daily = getLocalHouseLedger().recurringChecklists.find((row) => row.frequency === 'daily')!;

    await localChecklistsApi.delete(hh, daily.id);
    await mutateLocalHouseLedger(
      (ledger) => {
        ledger.recurringChecklists.find((row) => row.id === daily.id)!.name = 'Morning walk-through';
      },
      { opType: 'TEST_RENAME', entityType: 'checklist', entityId: daily.id, payload: {} },
    );

    await localChecklistsApi.createDefaults(hh);

    const restored = getLocalHouseLedger().recurringChecklists.find((row) => row.id === daily.id)!;
    expect(restored.is_active).toBe(true);
    expect(restored.name).toBe('Morning walk-through');
    expect(getLocalHouseLedger().recurringChecklists).toHaveLength(4);
  });

  it('lists active checklists in sort order with their items joined on', async () => {
    const hh = householdId();
    await localChecklistsApi.createDefaults(hh);

    const { checklists } = await localChecklistsApi.getAll(hh);
    expect(checklists.map((row) => row.frequency)).toEqual([
      'daily',
      'weekly',
      'monthly',
      'quarterly',
    ]);
    expect(checklists[0]!.items.map((item) => item.title)).toEqual([
      'Check locks on all doors',
      'Run water in unused sinks/tubs',
      'Check for water leaks',
      'Empty trash if needed',
    ]);
  });

  it('soft-deletes: the row survives so its history and peers do too', async () => {
    const hh = householdId();
    await localChecklistsApi.createDefaults(hh);
    const target = getLocalHouseLedger().recurringChecklists[0]!;

    await localChecklistsApi.delete(hh, target.id);

    const { checklists } = await localChecklistsApi.getAll(hh);
    expect(checklists.some((row) => row.id === target.id)).toBe(false);
    const stored = getLocalHouseLedger().recurringChecklists.find((row) => row.id === target.id);
    expect(stored?.is_active).toBe(false);
  });

  it('creates a custom checklist with random ids — same name twice is two lists', async () => {
    const hh = householdId();
    const payload = {
      name: 'Spring prep',
      frequency: 'seasonal' as const,
      items: [{ title: 'Open the outdoor taps' }, { title: 'Service the mower', is_required: false }],
    };

    const first = await localChecklistsApi.create(hh, payload);
    const second = await localChecklistsApi.create(hh, payload);

    expect(first.checklist.id).not.toBe(second.checklist.id);
    expect(first.checklist.icon).toBe('✅');
    expect(first.checklist.color).toBe('#4ECDC4');
    expect(first.checklist.items.map((item) => item.is_required)).toEqual([true, false]);
    expect(getLocalHouseLedger().recurringChecklists).toHaveLength(2);
  });

  it('materializes the current period on read, keyed by (checklist, period_start)', async () => {
    const hh = householdId();
    await localChecklistsApi.createDefaults(hh);
    const monthly = getLocalHouseLedger().recurringChecklists.find(
      (row) => row.frequency === 'monthly',
    )!;

    const before = opCount();
    const { instance } = await localChecklistsApi.getCurrentInstance(hh, monthly.id);
    const period = calculateCurrentPeriod('monthly', new Date());

    expect(instance!.id).toBe(checklistInstanceId(monthly.id, period.start));
    expect(instance!.period_start).toBe(period.start);
    expect(instance!.period_label).toBe(period.label);
    expect(instance!.total_items).toBe(6);
    expect(instance!.status).toBe('not_started');
    expect(instance!.checklist.items).toHaveLength(6);
    expect(opCount() - before).toBe(1);

    // The second read finds it and writes nothing.
    const settled = opCount();
    await localChecklistsApi.getCurrentInstance(hh, monthly.id);
    expect(opCount()).toBe(settled);
  });

  it('raises rather than inventing an instance for a checklist that is gone', async () => {
    await expect(
      localChecklistsApi.getCurrentInstance(householdId(), 'chk_missing'),
    ).rejects.toThrow('Checklist not found');
  });

  it('materializes every missing instance in one op from getProgress', async () => {
    const hh = householdId();
    await localChecklistsApi.createDefaults(hh);

    const before = opCount();
    const { progress } = await localChecklistsApi.getProgress(hh);

    expect(progress).toHaveLength(4);
    expect(getLocalHouseLedger().checklistInstances).toHaveLength(4);
    expect(opCount() - before).toBe(1);
    expect(progress[0]!.currentInstance!.completedItemIds).toEqual([]);
    expect(progress[0]!.completionRate).toBe(0);
    expect(progress[0]!.recentInstances).toHaveLength(1);
  });

  it('gives the same completion id to two members ticking the same item', async () => {
    const hh = householdId();
    await localChecklistsApi.createDefaults(hh);
    const { checklists } = await localChecklistsApi.getAll(hh);
    const daily = checklists.find((row) => row.frequency === 'daily')!;
    const { instance } = await localChecklistsApi.getCurrentInstance(hh, daily.id);
    const itemId = daily.items[0]!.id;

    const first = await localChecklistsApi.completeItem(hh, instance!.id, itemId);
    // The second call stands in for the peer's op arriving after a merge: same
    // instance, same item, so S3b says it must be the same row.
    const second = await localChecklistsApi.completeItem(hh, instance!.id, itemId, {
      notes: 'did it too',
    });

    expect(first.completion.id).toBe(
      houseDeterministicIds.checklistItemCompletion(instance!.id, itemId),
    );
    expect(second.completion.id).toBe(first.completion.id);
    expect(getLocalHouseLedger().checklistItemCompletions).toHaveLength(1);
    // Recomputed, not incremented — the whole point of the deviation.
    expect(second.instance.completed_items).toBe(1);
    expect(second.instance.status).toBe('in_progress');
  });

  it('finishes and un-finishes an instance as items are ticked', async () => {
    const hh = householdId();
    await localChecklistsApi.createDefaults(hh);
    const { checklists } = await localChecklistsApi.getAll(hh);
    const daily = checklists.find((row) => row.frequency === 'daily')!;
    const { instance } = await localChecklistsApi.getCurrentInstance(hh, daily.id);

    for (const item of daily.items) {
       
      await localChecklistsApi.completeItem(hh, instance!.id, item.id);
    }

    const finished = instanceRow(instance!.id);
    expect(finished.status).toBe('completed');
    expect(finished.completed_items).toBe(4);
    expect(finished.completed_at).not.toBeNull();
    expect(finished.completed_by).toBe(USER);

    const { progress } = await localChecklistsApi.getProgress(hh);
    const dailyProgress = progress.find((entry) => entry.checklist.id === daily.id)!;
    expect(dailyProgress.completionRate).toBe(100);
    expect(dailyProgress.streak).toBe(1);

    await localChecklistsApi.uncompleteItem(hh, instance!.id, daily.items[0]!.id);

    const reopened = instanceRow(instance!.id);
    expect(reopened.status).toBe('in_progress');
    expect(reopened.completed_items).toBe(3);
    expect(reopened.completed_at).toBeNull();
    expect(reopened.completed_by).toBeNull();
  });

  it('drops back to not_started when the last tick is undone', async () => {
    const hh = householdId();
    await localChecklistsApi.createDefaults(hh);
    const { checklists } = await localChecklistsApi.getAll(hh);
    const weekly = checklists.find((row) => row.frequency === 'weekly')!;
    const { instance } = await localChecklistsApi.getCurrentInstance(hh, weekly.id);

    await localChecklistsApi.completeItem(hh, instance!.id, weekly.items[0]!.id);
    await localChecklistsApi.uncompleteItem(hh, instance!.id, weekly.items[0]!.id);

    expect(getLocalHouseLedger().checklistItemCompletions).toHaveLength(0);
    expect(instanceRow(instance!.id).status).toBe('not_started');
  });

  it('refreshes a stale total_items when the checklist gains an item', async () => {
    const hh = householdId();
    await localChecklistsApi.createDefaults(hh);
    const { checklists } = await localChecklistsApi.getAll(hh);
    const daily = checklists.find((row) => row.frequency === 'daily')!;
    const { instance } = await localChecklistsApi.getCurrentInstance(hh, daily.id);
    expect(instance!.total_items).toBe(4);

    const extra: LocalRecurringChecklistItem = {
      id: 'cki_extra',
      household_id: hh,
      checklist_id: daily.id,
      title: 'Check the mail',
      description: null,
      sort_order: 9,
      is_required: false,
      linked_task_id: null,
      created_at: new Date().toISOString(),
    };
    await mutateLocalHouseLedger(
      (ledger) => {
        ledger.recurringChecklistItems.push(extra);
      },
      { opType: 'TEST_ADD_ITEM', entityType: 'checklist_item', entityId: extra.id, payload: {} },
    );

    await localChecklistsApi.completeItem(hh, instance!.id, daily.items[0]!.id);
    expect(instanceRow(instance!.id).total_items).toBe(5);
  });

  it('refuses to answer for a property this device has not activated', async () => {
    await expect(localChecklistsApi.getAll('hh_someone_else')).rejects.toBeInstanceOf(
      HouseLocalUnknownPropertyError,
    );
    await expect(localChecklistsApi.createDefaults('hh_someone_else')).rejects.toBeInstanceOf(
      HouseLocalUnknownPropertyError,
    );
  });

  it('implements every method the remote module exports (DoD H3 method diff)', () => {
    expect(parityGap(checklistsApi, localChecklistsApi)).toEqual({
      missingLocally: [],
      extraLocally: [],
    });
  });
});
