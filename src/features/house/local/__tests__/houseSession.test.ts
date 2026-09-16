/**
 * Session round-trip (DoD H1): create → edit → delete → reopen → identical.
 *
 * This is the test that proves the whole H1 stack agrees with itself — the
 * registry, the per-row AEAD envelopes, the op journal, and the projection
 * replay on cold open. Under Jest the store is the in-memory one and the DEK
 * lives in a module variable, so closing and reopening exercises the real
 * `loadRowsIntoLedger` + `replayUnprojected` path without native modules.
 */
import { BUDGET_LOCAL_FIRST_DB_NAME } from '../../../budget/local/expo-sqlite-driver';
import { defaultHouseholdSpaces } from '../defaults';
import {
  closeLocalHouseSession,
  getLocalHouseLedger,
  isLocalHouseSessionOpen,
  mutateLocalHouseLedger,
  openLocalHouseSession,
  resetLocalHouseSession,
} from '../engine';
import { HOUSE_LOCAL_FIRST_DB_NAME } from '../expo-sqlite-driver';
import { newLocalId } from '../ids';
import { HOUSE_DEK_SECURE_KEY } from '../persistence';

import { taskRow } from './houseLedgerTestKit';

const USER = 'user-house-1';

async function freshSession() {
  await resetLocalHouseSession();
  return openLocalHouseSession({ userId: USER, displayName: 'Test home' });
}

describe('House local session', () => {
  afterEach(async () => {
    await resetLocalHouseSession();
  });

  it('mints a household seeded with preset spaces and seasonal shells', async () => {
    const ledger = await freshSession();
    expect(ledger.household.id.startsWith('hh_local_')).toBe(true);
    expect(ledger.households).toHaveLength(1);
    expect(ledger.householdSpaces.length).toBeGreaterThan(0);
    expect(ledger.seasonalChecklists).toHaveLength(4);
    expect(ledger.ops).toHaveLength(1);
    expect(isLocalHouseSessionOpen()).toBe(true);
  });

  it('seeds deterministically — a second mint on another device agrees', async () => {
    const first = await freshSession();
    const spaceIds = first.householdSpaces.map((s) => s.id).sort();
    const householdId = first.household.id;
    await resetLocalHouseSession();

    // Same household id, so the seed must land on the same row keys.
    expect(
      defaultHouseholdSpaces(householdId)
        .map((s) => s.id)
        .sort(),
    ).toEqual(spaceIds);
  });

  it('round-trips create → edit → delete across a reopen', async () => {
    await freshSession();
    const taskId = newLocalId('task');

    await mutateLocalHouseLedger(
      (ledger) => {
        ledger.tasks.push(taskRow(taskId, { title: 'Clean gutters' }) as never);
      },
      { opType: 'TASK_CREATE', entityType: 'task', entityId: taskId, payload: { title: 'Clean gutters' } },
    );

    await mutateLocalHouseLedger(
      (ledger) => {
        const task = ledger.tasks.find((t) => t.id === taskId)!;
        task.title = 'Clean gutters (front)';
        task.next_due_date = '2026-10-15';
      },
      { opType: 'TASK_UPDATE', entityType: 'task', entityId: taskId, payload: {} },
    );

    const noteId = newLocalId('note');
    await mutateLocalHouseLedger(
      (ledger) => {
        ledger.householdNotes.push({
          id: noteId,
          household_id: ledger.household.id,
          created_by: USER,
          title: 'Gate code',
          body: '4821',
          pinned: true,
          created_at: '2026-08-12T00:00:00.000Z',
          updated_at: '2026-08-12T00:00:00.000Z',
          deleted_at: null,
        });
      },
      { opType: 'NOTE_CREATE', entityType: 'note', entityId: noteId, payload: {} },
    );

    const beforeClose = getLocalHouseLedger();
    const expectedTasks = JSON.stringify(beforeClose.tasks);
    const expectedNotes = JSON.stringify(beforeClose.householdNotes);
    const expectedSpaces = JSON.stringify(
      [...beforeClose.householdSpaces].sort((a, b) => a.id.localeCompare(b.id)),
    );

    await closeLocalHouseSession();
    expect(isLocalHouseSessionOpen()).toBe(false);

    const reopened = await openLocalHouseSession({ userId: USER });
    expect(JSON.stringify(reopened.tasks)).toBe(expectedTasks);
    expect(JSON.stringify(reopened.householdNotes)).toBe(expectedNotes);
    expect(
      JSON.stringify([...reopened.householdSpaces].sort((a, b) => a.id.localeCompare(b.id))),
    ).toBe(expectedSpaces);

    await mutateLocalHouseLedger(
      (ledger) => {
        ledger.tasks = ledger.tasks.filter((t) => t.id !== taskId);
      },
      { opType: 'TASK_DELETE', entityType: 'task', entityId: taskId, payload: {} },
    );

    await closeLocalHouseSession();
    const afterDelete = await openLocalHouseSession({ userId: USER });
    expect(afterDelete.tasks).toHaveLength(0);
    // The tombstone survives the reopen — otherwise a peer's stale edit would
    // resurrect the row on the next sync.
    expect(afterDelete.lww?.tasks?.[taskId]?.del).toBeDefined();
    expect(afterDelete.householdNotes).toHaveLength(1);
  });

  it('refuses to hand one user another user’s home', async () => {
    const first = await freshSession();
    const firstHouseholdId = first.household.id;

    const second = await openLocalHouseSession({ userId: 'user-house-2' });
    expect(second.memberId).toBe('user-house-2');
    expect(second.household.id).not.toBe(firstHouseholdId);
  });
});

describe('cross-brand isolation (DoD H1)', () => {
  it('uses a different SQLite file from Budget', () => {
    expect(HOUSE_LOCAL_FIRST_DB_NAME).toBe('symply-house-local-first.db');
    expect(HOUSE_LOCAL_FIRST_DB_NAME).not.toBe(BUDGET_LOCAL_FIRST_DB_NAME);
  });

  it('uses a different SecureStore DEK entry from Budget', () => {
    expect(HOUSE_DEK_SECURE_KEY).toBe('house.localFirst.dek.v1');
    expect(HOUSE_DEK_SECURE_KEY).not.toBe('budget.localFirst.dek.v1');
  });
});
