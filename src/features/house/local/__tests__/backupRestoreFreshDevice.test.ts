/**
 * Restore from a recovery phrase on a brand-new phone.
 *
 * This is the situation the recovery phrase exists for, and until now it was the
 * one situation it could not run in. A device with no ledger adopts the homes the
 * account already owns (`householdAdoption.test.ts`) in the pending-enrolment
 * shape: real household id, real name, a THROWAWAY household key, and every write
 * refused until a peer wraps the real key to it. `applyLocalHouseRestore` refused
 * that shape wholesale, so a member who had lost their old phone — precisely the
 * person holding a recovery phrase — was told to go and fetch that phone to
 * approve this one.
 *
 * The guard was right about what it protected and wrong about what it caught.
 * What must never happen to a keyless placeholder is an AUTHORED op: sealed under
 * a key no peer holds, it comes back `key_epoch_mismatch`, which `applyRemote`
 * treats as RETRYABLE, so it is never acked and never leaves the relay. Rows are
 * a different matter entirely — they are sealed with the DEVICE key — so filling
 * in the home this device already knows it should have needs no household key at
 * all. Every `it` below is one edge of that distinction.
 *
 * The second half of the file is the household-REPLACE path (`restoreHouseBackup`
 * with `allowHouseholdReplace`), which swaps `ledger.household` under a session
 * the registry still holds by the OLD id — the stale-key bug that surfaces as
 * `HouseLocalUnknownPropertyError` over a restore that has already written its
 * rows.
 */
jest.mock('../flag', () => ({
  __esModule: true,
  isHouseLocalFirst: () => true,
  isHouseP2PEnabled: () => false,
}));

jest.mock('@api/client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

const mockAuth = {
  user: { id: 'user-restore-1', display_name: 'Ada Lovelace', email: 'ada@x.test' } as {
    id: string;
    display_name: string | null;
    email: string | null;
  } | null,
  isAuthenticated: true,
  hasHydrated: true,
};
jest.mock('@stores/authStore', () => ({
  useAuthStore: { getState: () => mockAuth },
}));

// `houseBackup` reaches for the document picker and the cache directory at import
// time. Neither has anything to say about which rows a restore writes.
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  writeAsStringAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
}));

// Everything ensureSession starts AFTER the session is open — notifications, the
// App Group, a WebSocket. None of it decides what a restore writes.
jest.mock('../householdRoster', () => ({
  __esModule: true,
  refreshHouseHouseholdRoster: jest.fn().mockResolvedValue(undefined),
  republishActiveHouseRoster: jest.fn(() => []),
  resetHouseRosters: jest.fn(),
}));
jest.mock('../reminders/houseLocalReminders', () => ({
  __esModule: true,
  syncHouseLocalReminders: jest.fn().mockResolvedValue(undefined),
  cancelHouseLocalReminders: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../reminders/widgetProjection', () => ({
  __esModule: true,
  startHouseWidgetProjection: jest.fn(),
  stopHouseWidgetProjection: jest.fn(),
  clearHouseWidgetProjection: jest.fn(),
}));
jest.mock('../sync/ledgerRefresh', () => ({
  __esModule: true,
  startHouseLedgerRefreshBridge: jest.fn(),
  stopHouseLedgerRefreshBridge: jest.fn(),
}));
jest.mock('../pushWake', () => ({
  __esModule: true,
  registerHouseLocalPushToken: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../sync/orchestrator', () => ({
  __esModule: true,
  runHouseLocalSync: jest.fn().mockResolvedValue(undefined),
}));

import { apiClient } from '@api/client';

import { restoreHouseBackup, snapshotFromHouseLedger } from '../backup/houseBackup';
import {
  closeLocalHouseSession,
  getActiveHouseholdId,
  getLocalHouseLedger,
  getLocalHouseLedgerFor,
  getLocalHouseSession,
  installHouseholdKeys,
  isAwaitingHouseEnrolment,
  listLocalHouseProperties,
  mutateLocalHouseLedger,
  openLocalHouseSession,
  resetLocalHouseSession,
  type HouseLedger,
} from '../engine';
import {
  __resetHouseLocalBootstrapStateForTests,
  ensureHouseLocalSession,
} from '../ensureSession';

import { emptyHouseLedger, taskRow } from './houseLedgerTestKit';

const api = apiClient as unknown as { get: jest.Mock; post: jest.Mock };

const USER = 'user-restore-1';
const REAL_HOME = { id: 'hh_maple_real', display_name: 'Maple Street House', role: 'OWNER', key_epoch: 1 };
const CABIN = { id: 'hh_cabin_real', display_name: 'Lake Cabin', role: 'OWNER', key_epoch: 1 };
/** Never derived here — every restore below hands over an already-verified payload. */
const PHRASE = 'apple bridge cactus dolphin ember forest garden harbor island jungle kettle lantern';

/** The control plane answers `GET /v2/households` with these; everything else is empty. */
function accountOwns(households: Array<typeof REAL_HOME>): void {
  api.get.mockImplementation((url: string) =>
    url === '/v2/households'
      ? Promise.resolve({ data: { households } })
      : Promise.resolve({ data: {} }),
  );
}

/** Let ensureSession's floated `void import(…).then(…)` chain settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** The archive the lost phone wrote, as one property's ledger. */
function backupOf(householdId: string, titles: string[]): HouseLedger {
  const ledger = emptyHouseLedger(householdId, USER, 'dev_old_phone');
  ledger.tasks = titles.map((title, index) =>
    taskRow(`task-${index + 1}`, { title, household_id: householdId }),
  ) as typeof ledger.tasks;
  return ledger;
}

/**
 * Apply an archive without spending a minute in Argon2id. `verifiedPayload` is
 * the same shortcut `confirmAndRestoreHouseBackup` takes after it has verified
 * the file itself, so this exercises the production apply path exactly.
 */
function restore(
  backup: HouseLedger,
  options: { allowHouseholdReplace?: boolean } = {},
): ReturnType<typeof restoreHouseBackup> {
  return restoreHouseBackup('', PHRASE, {
    ...options,
    verifiedPayload: {
      snapshotJson: snapshotFromHouseLedger(backup),
      householdId: backup.household.id,
      deviceId: 'dev_old_phone',
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  });
}

/** The new phone: nothing on disk, an account that already owns homes. */
async function freshDeviceAdopting(homes: Array<typeof REAL_HOME>): Promise<void> {
  accountOwns(homes);
  await ensureHouseLocalSession();
  await flush();
}

function titlesIn(ledger: HouseLedger): string[] {
  return ledger.tasks.map((task) => String((task as { title?: unknown }).title)).sort();
}

beforeEach(async () => {
  jest.clearAllMocks();
  api.post.mockResolvedValue({ data: {} });
  await resetLocalHouseSession();
  __resetHouseLocalBootstrapStateForTests();
  mockAuth.user = { id: USER, display_name: 'Ada Lovelace', email: 'ada@x.test' };
  mockAuth.isAuthenticated = true;
  mockAuth.hasHydrated = true;
});

afterEach(async () => {
  await resetLocalHouseSession();
});

describe('a new phone restoring the home it just adopted', () => {
  it('writes the rows instead of asking for the phone the member no longer has', async () => {
    // The whole point of the recovery phrase. Before this, the only device that
    // could complete a restore was one that had never needed one.
    await freshDeviceAdopting([REAL_HOME]);
    expect(isAwaitingHouseEnrolment(REAL_HOME.id)).toBe(true);

    const result = await restore(backupOf(REAL_HOME.id, ['Roof inspection', 'Furnace filter']));

    expect(result.householdId).toBe(REAL_HOME.id);
    expect(titlesIn(getLocalHouseLedger())).toEqual(['Furnace filter', 'Roof inspection']);
  });

  it('needs no household replace, because the adopted id IS the backup’s id', async () => {
    // The adopt path carries the account's REAL household id in, so the archive
    // and the placeholder already agree. A restore that had to rebind the
    // household would be silently mixing two homes' rows — which is why the
    // replace is opt-in and why this path must never reach for it.
    await freshDeviceAdopting([REAL_HOME]);

    await restore(backupOf(REAL_HOME.id, ['Roof inspection']));

    expect(getLocalHouseLedger().household.id).toBe(REAL_HOME.id);
    expect(getActiveHouseholdId()).toBe(REAL_HOME.id);
  });

  it('authors no op, because no peer could open one sealed under a throwaway key', async () => {
    // The invariant the enrolment guard actually protects. An op sealed under the
    // placeholder's key is rejected `key_epoch_mismatch` — retryably — so it is
    // never acked and sits on the relay for as long as the household exists.
    // Rows carry no household key at all, which is why they may go ahead.
    await freshDeviceAdopting([REAL_HOME]);

    await restore(backupOf(REAL_HOME.id, ['Roof inspection']));

    expect(getLocalHouseLedger().ops).toHaveLength(0);
  });

  it('keeps the restored rows across a relaunch', async () => {
    // A restore that lives only in memory is not a restore. The rows have to be
    // sealed and indexed on disk even though no op was written for them.
    await freshDeviceAdopting([REAL_HOME]);
    await restore(backupOf(REAL_HOME.id, ['Roof inspection', 'Furnace filter']));

    await closeLocalHouseSession();
    __resetHouseLocalBootstrapStateForTests();
    await ensureHouseLocalSession();
    await flush();

    expect(titlesIn(getLocalHouseLedger())).toEqual(['Furnace filter', 'Roof inspection']);
    // …and still a placeholder: a restore recovers data, it does not enrol a device.
    expect(isAwaitingHouseEnrolment(REAL_HOME.id)).toBe(true);
  });

  it('leaves a session that still resolves by household id', async () => {
    // The re-keying regression. `restoreHouseBackup` re-reads the session by id
    // the moment the apply returns, and every later read does the same; a
    // registry keyed by a stale id throws `HouseLocalUnknownPropertyError` over
    // rows that were already written.
    await freshDeviceAdopting([REAL_HOME]);

    await restore(backupOf(REAL_HOME.id, ['Roof inspection']));

    await expect(getLocalHouseSession(REAL_HOME.id)).resolves.toMatchObject({
      householdId: REAL_HOME.id,
    });
    await expect(getLocalHouseLedgerFor(REAL_HOME.id)).resolves.toMatchObject({
      household: { id: REAL_HOME.id },
    });
    expect(listLocalHouseProperties().map((p) => p.householdId)).toEqual([REAL_HOME.id]);
  });

  it('hands a working, writable home over the moment the real key arrives', async () => {
    // The end of the story: the restored rows survive enrolment, and the property
    // starts authoring ops the instant it holds a key peers can read.
    await freshDeviceAdopting([REAL_HOME]);
    await restore(backupOf(REAL_HOME.id, ['Roof inspection']));

    await installHouseholdKeys(
      { householdId: REAL_HOME.id, hdk: new Uint8Array(32), keyEpoch: 1 },
      REAL_HOME.id,
    );
    await mutateLocalHouseLedger(
      (ledger) => {
        ledger.tasks.push(taskRow('task-new', { title: 'Gutters', household_id: REAL_HOME.id }) as never);
      },
      { opType: 'TASK_CREATE', entityType: 'task', entityId: 'task-new', payload: {} },
    );

    expect(isAwaitingHouseEnrolment(REAL_HOME.id)).toBe(false);
    expect(titlesIn(getLocalHouseLedger())).toEqual(['Gutters', 'Roof inspection']);
  });
});

describe('a placeholder for a different home', () => {
  it('refuses the archive rather than rebinding one home’s rows onto another', async () => {
    // The realistic mistake with multi-property: picking the cabin's archive
    // while the house is the one waiting. The member gets told which home the
    // file belongs to, not a stack trace.
    await freshDeviceAdopting([REAL_HOME]);

    await expect(restore(backupOf(CABIN.id, ['Dock repair']))).rejects.toThrow(
      /belongs to a home/i,
    );
    expect(getLocalHouseLedger().tasks).toHaveLength(0);
  });

  it('refuses it even when the member explicitly confirms the foreign restore', async () => {
    // `allowHouseholdReplace` is the member saying "yes, that other home, on
    // purpose". It is still refused here: a keyless placeholder has no household
    // key to take the foreign home's rows under, so accepting would produce a
    // ledger that looks real and can never sync.
    await freshDeviceAdopting([REAL_HOME]);

    await expect(
      restore(backupOf(CABIN.id, ['Dock repair']), { allowHouseholdReplace: true }),
    ).rejects.toThrow(/approve this device/i);
    expect(getActiveHouseholdId()).toBe(REAL_HOME.id);
    expect(getLocalHouseLedger().tasks).toHaveLength(0);
  });

  it('still refuses when the placeholder is one of several adopted homes', async () => {
    // Two placeholders, and the archive matches neither of the active one's rows.
    // The guard is per property, so the home the member is looking at is the one
    // that has to agree with the file.
    await freshDeviceAdopting([REAL_HOME, CABIN]);
    expect(getActiveHouseholdId()).toBe(REAL_HOME.id);

    await expect(restore(backupOf(CABIN.id, ['Dock repair']))).rejects.toThrow(/Lake Cabin/);
  });
});

describe('the ordinary restore, onto a home this device already holds keys for', () => {
  /** A minted, fully-keyed home — the device that never lost anything. */
  async function keyedHome(): Promise<string> {
    const ledger = await openLocalHouseSession({ userId: USER, displayName: 'Maple Grove' });
    return ledger.household.id;
  }

  it('still authors the BACKUP_RESTORE op peers converge on', async () => {
    // Unchanged behaviour, and the reason the pending path is a separate branch
    // rather than a relaxed guard: a keyed device MUST publish the restore, or
    // its peers silently fork.
    const householdId = await keyedHome();

    await restore(backupOf(householdId, ['Roof inspection']));

    expect(getLocalHouseLedger().ops.some((op) => op.opType === 'BACKUP_RESTORE')).toBe(true);
    expect(titlesIn(getLocalHouseLedger())).toContain('Roof inspection');
  });

  it('still lets a live write beat the backup (D-20)', async () => {
    // Restored values carry `RESTORE_HLC`, an ancient synthetic stamp, so a
    // restore can never overwrite work done since the archive was made. The
    // pending path merges through the same LWW, so this is what proves the two
    // branches agree.
    const householdId = await keyedHome();
    await mutateLocalHouseLedger(
      (ledger) => {
        ledger.tasks.push(
          taskRow('task-1', { title: 'Roof inspection — rescheduled', household_id: householdId }) as never,
        );
      },
      { opType: 'TASK_CREATE', entityType: 'task', entityId: 'task-1', payload: {} },
    );

    await restore(backupOf(householdId, ['Roof inspection']));

    const restored = getLocalHouseLedger().tasks.find((task) => task.id === 'task-1');
    expect((restored as { title?: string }).title).toBe('Roof inspection — rescheduled');
  });

  it('re-keys the registry when a confirmed restore replaces the household', async () => {
    // The stale-key bug in its own right. `replaceHousehold` swaps
    // `ledger.household` under a session the registry still holds by the OLD id,
    // and the very next lookup — `restoreHouseBackup` re-reads the session by the
    // archive's id before it can even build the summary — threw
    // `HouseLocalUnknownPropertyError` over rows already written to disk.
    await keyedHome();

    const result = await restore(backupOf(CABIN.id, ['Dock repair']), {
      allowHouseholdReplace: true,
    });

    expect(result.householdId).toBe(CABIN.id);
    expect(getActiveHouseholdId()).toBe(CABIN.id);
    expect(listLocalHouseProperties().map((p) => p.householdId)).toEqual([CABIN.id]);
    await expect(getLocalHouseSession(CABIN.id)).resolves.toMatchObject({ householdId: CABIN.id });
  });
});

/**
 * The home's own DETAILS — address, units, photo — not just its rows.
 *
 * Reported from a device on 2026-08-31: a member restored their backup onto a
 * new iPad, and the property-address gate opened over a home whose address was
 * already in the ledger. The name was right, which made it read as "the restore
 * worked and this home never had an address".
 *
 * It had one. `applyLocalHouseRestore` only ever assigned `ledger.household`
 * inside the `replaceHousehold` branch, and an ordinary restore never sets that
 * flag — `restoreHouseBackup` raises it only when the archive's id DIFFERS from
 * the open home, and the multi-home path never raises it at all. So the singular
 * active-property record kept the adoption placeholder's fields (the account's
 * real id and name from the control plane, and nothing else) while the archived
 * record — address included — landed in the `households` TABLE through the delta,
 * where no screen reads it.
 *
 * `syncHouseholdStoreFromLocalLedger` copies `ledger.household` verbatim into
 * `currentHousehold`, so that one field is what the whole app means by "my
 * home": the address form, the assessment gate, the property screen. Asserting
 * the table would have passed throughout the bug.
 */
describe('restoring a home fills in the details this device is missing', () => {
  /** The archive a real home wrote: rows AND the household record itself. */
  function backupWithAddress(householdId: string): HouseLedger {
    const ledger = backupOf(householdId, ['Roof inspection']);
    ledger.household = {
      ...ledger.household,
      name: 'Maple Grove',
      address_line1: '42 Maple Street',
      city: 'Vancouver',
      state_province: 'BC',
      postal_code: 'V6B 1A1',
      country: 'CA',
      unit_system: 'metric',
    };
    return ledger;
  }

  it('adopts the archived address when the ids match and nothing is replaced', async () => {
    await freshDeviceAdopting([REAL_HOME]);

    await restore(backupWithAddress(REAL_HOME.id));

    // The exact field the address form and the assessment gate read.
    const household = getLocalHouseLedger().household;
    expect(household.address_line1).toBe('42 Maple Street');
    expect(household.city).toBe('Vancouver');
    expect(household.state_province).toBe('BC');
    expect(household.postal_code).toBe('V6B 1A1');
    expect(household.unit_system).toBe('metric');
    // Identity is the device's, not the archive's — this path replaces nothing.
    expect(household.id).toBe(REAL_HOME.id);
  });

  it('never overwrites a detail this device already holds', async () => {
    await freshDeviceAdopting([REAL_HOME]);
    // The member corrected the address on this phone after the backup was taken.
    getLocalHouseLedger().household.city = 'Burnaby';

    await restore(backupWithAddress(REAL_HOME.id));

    // D-20: a restore is month-old data by construction, so live writes win. It
    // may fill a gap and may not undo a correction.
    expect(getLocalHouseLedger().household.city).toBe('Burnaby');
    // …while the fields that WERE empty still get filled.
    expect(getLocalHouseLedger().household.address_line1).toBe('42 Maple Street');
  });

  it('still carries the rows it always did', async () => {
    await freshDeviceAdopting([REAL_HOME]);
    await restore(backupWithAddress(REAL_HOME.id));
    // The half that was never broken, asserted so a fix to the record cannot
    // quietly cost the ledger its contents.
    expect(titlesIn(getLocalHouseLedger())).toEqual(['Roof inspection']);
  });
});
