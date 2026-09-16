/**
 * One backup file, several households, kept apart inside it.
 *
 * A member holds up to three properties on one device (H5), each with its own
 * HDK, key epoch and membership. Backing them up one file at a time is correct
 * but fragile in the way that matters most: the home most likely to be lost is
 * the one nobody has opened in weeks, and it is exactly the one whose separate
 * file nobody remembers to make or to keep.
 *
 * So a backup can now cover every home at once. Q15's hazard — rows from two
 * households poured into one undifferentiated pile, so a restore has to GUESS
 * which property each row belonged to — is what the sectioned format exists to
 * prevent, and it is what most of this file is about. Every `it` below is one
 * edge of "co-located, never mixed":
 *
 *  - every home is in the file, with its own ledger, identity and manifest;
 *  - a restore walks it home by home into the property that home names, never
 *    into whichever one happens to be ACTIVE;
 *  - a home this device does not hold is reported, not forced somewhere;
 *  - "live wins" (D-20) still holds, per home, exactly as for a single-home file.
 *
 * The mock preamble is `backupRestoreFreshDevice.test.ts`'s, for the same reason:
 * these are real sessions over the real engine, and everything ensureSession
 * starts AFTER a session is open has nothing to say about which rows a backup
 * holds or a restore writes.
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
  user: { id: 'user-multi-1', display_name: 'Ada Lovelace', email: 'ada@x.test' } as {
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

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  writeAsStringAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
}));

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

import { HOUSE_ALL_HOMES_ID } from '../backup/allHomes';
import {
  buildHouseBackupSnapshot,
  houseBackupTargets,
  parseHouseBackupSnapshot,
  restoreHouseBackup,
  summarizeHouseDevice,
} from '../backup/houseBackup';
import {
  activateLocalHouseProperty,
  closeLocalHouseSession,
  createLocalHouseProperty,
  getActiveHouseholdId,
  getLocalHouseLedgerFor,
  mutateLocalHouseLedger,
  openLocalHouseSession,
  resetLocalHouseSession,
} from '../engine';
import {
  __resetHouseLocalBootstrapStateForTests,
  ensureHouseLocalSession,
} from '../ensureSession';
import { HOUSE_LEDGER_TABLE_NAMES } from '../schema';

import { taskRow } from './houseLedgerTestKit';

const api = apiClient as unknown as { get: jest.Mock; post: jest.Mock };
const USER = 'user-multi-1';

/** Never derived here — every restore below hands over an already-verified payload. */
const PHRASE = 'apple bridge cactus dolphin ember forest garden harbor island jungle kettle lantern';

type Home = { householdId: string; name: string };

/** Let ensureSession's floated `void import(…).then(…)` chain settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Two homes on one device, each with one task, with the FIRST left active.
 *
 * `createLocalHouseProperty` does not activate what it creates, so the active
 * property is whichever the session opened with — which is the shape that makes
 * "restore went into the active home instead of its own" observable.
 */
async function twoHomes(): Promise<{ maple: Home; cabin: Home }> {
  const first = await openLocalHouseSession({ userId: USER, displayName: 'Maple Street' });
  const maple: Home = { householdId: first.household.id, name: 'Maple Street' };
  await addTask(maple.householdId, 'task-maple', 'Roof inspection');

  const second = await createLocalHouseProperty({ displayName: 'Lake Cabin' });
  const cabin: Home = { householdId: second.household.id, name: 'Lake Cabin' };
  await activateLocalHouseProperty(cabin.householdId);
  await addTask(cabin.householdId, 'task-cabin', 'Dock repair');

  await activateLocalHouseProperty(maple.householdId);
  return { maple, cabin };
}

/** Write one task into the ACTIVE property — the only ledger a mutation reaches. */
async function addTask(householdId: string, id: string, title: string): Promise<void> {
  await mutateLocalHouseLedger(
    (ledger) => {
      ledger.tasks.push(taskRow(id, { title, household_id: householdId }) as never);
    },
    { opType: 'TASK_CREATE', entityType: 'task', entityId: id, payload: {} },
  );
}

async function titlesIn(householdId: string): Promise<string[]> {
  const ledger = await getLocalHouseLedgerFor(householdId);
  return ledger.tasks.map((task) => String((task as { title?: unknown }).title)).sort();
}

/** Apply an archive without spending a minute in Argon2id, as the screen does after verify. */
function restoreVerified(
  snapshotJson: string,
  options: { householdId?: string } = {},
): ReturnType<typeof restoreHouseBackup> {
  return restoreHouseBackup('', PHRASE, {
    ...options,
    verifiedPayload: {
      snapshotJson,
      householdId: HOUSE_ALL_HOMES_ID,
      deviceId: 'dev_old_phone',
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  api.get.mockResolvedValue({ data: {} });
  api.post.mockResolvedValue({ data: {} });
  await resetLocalHouseSession();
  __resetHouseLocalBootstrapStateForTests();
  mockAuth.user = { id: USER, display_name: 'Ada Lovelace', email: 'ada@x.test' };
});

afterEach(async () => {
  await resetLocalHouseSession();
});

describe('building a file that covers every home', () => {
  it('seals one section per home, each with its own ledger and identity', async () => {
    const { maple, cabin } = await twoHomes();

    const built = await buildHouseBackupSnapshot({ householdId: HOUSE_ALL_HOMES_ID });

    expect(built.scope).toBe('multi');
    expect(built.householdIds.sort()).toEqual([maple.householdId, cabin.householdId].sort());
    // The envelope is addressed to "all homes" rather than to one of them —
    // naming a real household there would be arbitrary, and would let an older
    // build try to pour every section into that one home.
    expect(built.householdId).toBe(HOUSE_ALL_HOMES_ID);
  });

  it('keeps each home’s rows under that home, which is the whole point', async () => {
    const { maple, cabin } = await twoHomes();

    const built = await buildHouseBackupSnapshot({ householdId: HOUSE_ALL_HOMES_ID });
    const parsed = parseHouseBackupSnapshot(built.snapshotJson);
    const byHome = new Map(parsed.sections.map((section) => [section.householdId, section]));

    expect(taskTitles(byHome.get(maple.householdId))).toEqual(['Roof inspection']);
    expect(taskTitles(byHome.get(cabin.householdId))).toEqual(['Dock repair']);
    // Not merged into one pile — a section carries the identity that lets a
    // restore place it without guessing.
    expect(byHome.get(cabin.householdId)?.propertyName).toBe('Lake Cabin');
    expect(byHome.get(cabin.householdId)?.keyEpoch).toBeGreaterThan(0);
  });

  it('carries every registered table for every home', async () => {
    // The coverage guarantee, per section rather than per file: a section that
    // is missing a table restores everything except one kind of row, silently.
    await twoHomes();

    const built = await buildHouseBackupSnapshot({ householdId: HOUSE_ALL_HOMES_ID });
    const { sections } = parseHouseBackupSnapshot(built.snapshotJson);

    expect(sections).toHaveLength(2);
    for (const section of sections) {
      for (const table of HOUSE_LEDGER_TABLE_NAMES) {
        expect(Array.isArray(section.ledger[table])).toBe(true);
      }
      // …and the summary inside the file agrees with the rows next to it, so an
      // opened archive describes itself truthfully.
      expect(Object.keys(section.summary.tableCounts).sort()).toEqual(
        [...HOUSE_LEDGER_TABLE_NAMES].sort(),
      );
    }
  });

  it('never puts crypto material in a section', async () => {
    // The HDK and the signing key are in `ledger.crypto` on a live session, and
    // a section is built from that same object. Leaking either into the snapshot
    // would make the recovery phrase pointless.
    await twoHomes();
    const built = await buildHouseBackupSnapshot({ householdId: HOUSE_ALL_HOMES_ID });

    expect(built.snapshotJson).not.toContain('signingPrivateKeyHex');
    expect(built.snapshotJson).not.toContain('hdkHex');
    expect(built.snapshotJson).not.toContain('"crypto"');
  });

  it('still writes the per-home shape when one home is named', async () => {
    // The narrow file is not deprecated: it is what a member hands to one
    // household's members and nobody else's, and it is what older builds open.
    const { maple } = await twoHomes();

    const built = await buildHouseBackupSnapshot({ householdId: maple.householdId });

    expect(built.scope).toBe('single');
    expect(built.householdId).toBe(maple.householdId);
    expect(parseHouseBackupSnapshot(built.snapshotJson).scope).toBe('single');
  });

  it('describes what the file would hold, split back out per home', async () => {
    const { maple, cabin } = await twoHomes();

    const summary = await summarizeHouseDevice();

    expect(summary.householdId).toBe(HOUSE_ALL_HOMES_ID);
    expect(summary.households?.map((home) => home.householdId).sort()).toEqual(
      [maple.householdId, cabin.householdId].sort(),
    );
    expect(summary.tableCounts.tasks).toBe(2);
  });

  it('puts the active home first, so the file leads with the one they think of as theirs', async () => {
    const { maple, cabin } = await twoHomes();
    expect(getActiveHouseholdId()).toBe(maple.householdId);
    expect(houseBackupTargets()).toEqual([maple.householdId, cabin.householdId]);
  });
});

/**
 * Restore is a MERGE, not a rewind: "a restore fills gaps — it does not roll time
 * back" (D-20). So a home's data is not "lost" here by deleting it — a tombstone
 * is a decision the member made, and a restore may never undo one. What is
 * simulated instead is the case a backup actually answers: the archive holds a
 * row the live ledger no longer has, because the phone lost it rather than
 * because anybody deleted it. Where that row lands is the whole question.
 */
describe('restoring a file that covers every home', () => {
  it('puts each home’s rows back into that home, not into the active one', async () => {
    // The regression this design exists to prevent. `applyLocalHouseRestore`
    // wrote to whichever property was ACTIVE, so a two-home file would have put
    // the cabin's rows into Maple Street and left the cabin as it was.
    const { maple, cabin } = await twoHomes();
    let snapshot = (await buildHouseBackupSnapshot({ householdId: HOUSE_ALL_HOMES_ID }))
      .snapshotJson;
    snapshot = withRowOnlyInTheArchive(snapshot, maple.householdId, 'maple-lost', 'Shed painting');
    snapshot = withRowOnlyInTheArchive(snapshot, cabin.householdId, 'cabin-lost', 'Wood store');

    const result = await restoreVerified(snapshot);

    expect(await titlesIn(maple.householdId)).toEqual(['Roof inspection', 'Shed painting']);
    expect(await titlesIn(cabin.householdId)).toEqual(['Dock repair', 'Wood store']);
    expect(result.households.map((entry) => entry.status)).toEqual(['restored', 'restored']);
  });

  it('leaves the active property where it was', async () => {
    // A restore recovers data; it does not decide which home the member is
    // looking at, even when it writes into one they are not.
    const { maple, cabin } = await twoHomes();
    const snapshot = withRowOnlyInTheArchive(
      (await buildHouseBackupSnapshot({ householdId: HOUSE_ALL_HOMES_ID })).snapshotJson,
      cabin.householdId,
      'cabin-lost',
      'Wood store',
    );

    await restoreVerified(snapshot);

    expect(getActiveHouseholdId()).toBe(maple.householdId);
    expect(await titlesIn(cabin.householdId)).toContain('Wood store');
  });

  it('reports a home this device does not hold instead of forcing it somewhere', async () => {
    const { maple, cabin } = await twoHomes();
    let snapshot = (await buildHouseBackupSnapshot({ householdId: HOUSE_ALL_HOMES_ID }))
      .snapshotJson;
    snapshot = withRowOnlyInTheArchive(snapshot, maple.householdId, 'maple-lost', 'Shed painting');
    snapshot = withRowOnlyInTheArchive(snapshot, cabin.householdId, 'cabin-lost', 'Wood store');

    // The member left the cabin household between the backup and the restore.
    const document = JSON.parse(snapshot);
    document.households = document.households.map((section: { householdId: string }) =>
      section.householdId === cabin.householdId
        ? { ...section, householdId: 'hh_gone_forever' }
        : section,
    );

    const result = await restoreVerified(JSON.stringify(document));

    const missing = result.households.find((entry) => entry.householdId === 'hh_gone_forever');
    expect(missing?.status).toBe('not_on_device');
    expect(missing?.message).toMatch(/not on this device/i);
    // The home that IS here still got its rows back — one section failing never
    // costs the others theirs — and the orphaned section went nowhere.
    expect(await titlesIn(maple.householdId)).toEqual(['Roof inspection', 'Shed painting']);
    expect(await titlesIn(cabin.householdId)).toEqual(['Dock repair']);
  });

  it('restores only the section asked for when the member narrows to one home', async () => {
    const { maple, cabin } = await twoHomes();
    let snapshot = (await buildHouseBackupSnapshot({ householdId: HOUSE_ALL_HOMES_ID }))
      .snapshotJson;
    snapshot = withRowOnlyInTheArchive(snapshot, maple.householdId, 'maple-lost', 'Shed painting');
    snapshot = withRowOnlyInTheArchive(snapshot, cabin.householdId, 'cabin-lost', 'Wood store');

    const result = await restoreVerified(snapshot, { householdId: cabin.householdId });

    expect(await titlesIn(cabin.householdId)).toEqual(['Dock repair', 'Wood store']);
    expect(await titlesIn(maple.householdId)).toEqual(['Roof inspection']);
    expect(result.households.find((entry) => entry.householdId === maple.householdId)?.status).toBe(
      'not_selected',
    );
  });

  it('refuses when the file has nothing for the home that was asked for', async () => {
    const { maple, cabin } = await twoHomes();
    const built = await buildHouseBackupSnapshot({ householdId: maple.householdId });
    // A per-home file for Maple, asked to fill the cabin: the pre-existing
    // single-home guard, unchanged by any of this.
    await expect(
      restoreVerified(built.snapshotJson, { householdId: cabin.householdId }),
    ).rejects.toThrow(/belongs to/i);
  });

  it('still lets a live write beat the backup, per home (D-20)', async () => {
    const { maple, cabin } = await twoHomes();
    const built = await buildHouseBackupSnapshot({ householdId: HOUSE_ALL_HOMES_ID });

    // Work done in BOTH homes since the backup was taken. Restored values carry
    // an ancient synthetic stamp, so neither may be rolled back — and the point
    // here is that this holds for the home that is NOT active just as strictly.
    await retitleTask(maple.householdId, 'task-maple', 'Roof inspection — rescheduled');
    await retitleTask(cabin.householdId, 'task-cabin', 'Dock repair — done');

    await restoreVerified(built.snapshotJson);

    expect(await titlesIn(maple.householdId)).toEqual(['Roof inspection — rescheduled']);
    expect(await titlesIn(cabin.householdId)).toEqual(['Dock repair — done']);
  });

  it('never resurrects a row one home deleted, while filling the other home’s gap', async () => {
    // The two halves of D-20 in one restore, on two different homes at once.
    const { maple, cabin } = await twoHomes();
    let snapshot = (await buildHouseBackupSnapshot({ householdId: HOUSE_ALL_HOMES_ID }))
      .snapshotJson;
    snapshot = withRowOnlyInTheArchive(snapshot, cabin.householdId, 'cabin-lost', 'Wood store');

    await deleteTask(maple.householdId, 'task-maple');

    await restoreVerified(snapshot);

    expect(await titlesIn(maple.householdId)).toEqual([]);
    expect(await titlesIn(cabin.householdId)).toEqual(['Dock repair', 'Wood store']);
  });

  /**
   * "Live wins" for the home nobody has opened this launch — which is precisely
   * the home a whole-device restore exists to reach.
   *
   * A cold session holds the empty shell `emptyHouseTables()` produced: its rows
   * are on disk, unread, and so are its LWW watermarks. Merging into that shell
   * diffs the archive against nothing, so every archived row looks new and there
   * is no watermark for it to lose to — and month-old values land on top of work
   * done last week. D-20 would then hold for whichever home the member happened
   * to have open and fail silently for the others, which is worse than not
   * holding at all.
   */
  it('does not roll back newer work in a home it had to open to restore into', async () => {
    const { maple, cabin } = await twoHomes();
    const snapshot = (await buildHouseBackupSnapshot({ householdId: HOUSE_ALL_HOMES_ID }))
      .snapshotJson;

    // Work done in the cabin AFTER the backup — the value that must survive.
    await retitleTask(cabin.householdId, 'task-cabin', 'Dock repair — done');

    // Close and reopen so the cabin is on disk but cold: the shape after a
    // relaunch in which the member never switched to it.
    await closeLocalHouseSession();
    __resetHouseLocalBootstrapStateForTests();
    await ensureHouseLocalSession();
    await flush();

    await restoreVerified(snapshot);

    expect(await titlesIn(cabin.householdId)).toEqual(['Dock repair — done']);
    expect(await titlesIn(maple.householdId)).toEqual(['Roof inspection']);
  });

  it('authors a BACKUP_RESTORE op in each home, so peers converge rather than fork', async () => {
    const { maple, cabin } = await twoHomes();
    let snapshot = (await buildHouseBackupSnapshot({ householdId: HOUSE_ALL_HOMES_ID }))
      .snapshotJson;
    snapshot = withRowOnlyInTheArchive(snapshot, maple.householdId, 'maple-lost', 'Shed painting');
    snapshot = withRowOnlyInTheArchive(snapshot, cabin.householdId, 'cabin-lost', 'Wood store');

    await restoreVerified(snapshot);

    for (const home of [maple, cabin]) {
      const ledger = await getLocalHouseLedgerFor(home.householdId);
      expect(ledger.ops.some((op) => op.opType === 'BACKUP_RESTORE')).toBe(true);
    }
  });
});

// --- helpers ------------------------------------------------------------------

/**
 * Put a row in ONE home's section that the live ledger does not have — the row
 * the phone lost, which is the only thing a restore can actually put back.
 */
function withRowOnlyInTheArchive(
  snapshotJson: string,
  householdId: string,
  id: string,
  title: string,
): string {
  const document = JSON.parse(snapshotJson);
  const section = document.households.find(
    (entry: { householdId: string }) => entry.householdId === householdId,
  );
  section.ledger.tasks.push(taskRow(id, { title, household_id: householdId }));
  return JSON.stringify(document);
}

/** Edit a task in a home that may not be the active one. */
async function retitleTask(householdId: string, id: string, title: string): Promise<void> {
  await inHome(householdId, () =>
    mutateLocalHouseLedger(
      (ledger) => {
        for (const task of ledger.tasks) {
          if (String((task as { id?: unknown }).id) === id) {
            (task as unknown as { title: string }).title = title;
          }
        }
      },
      { opType: 'TASK_UPDATE', entityType: 'task', entityId: id, payload: {} },
    ),
  );
}

async function deleteTask(householdId: string, id: string): Promise<void> {
  await inHome(householdId, () =>
    mutateLocalHouseLedger(
      (ledger) => {
        ledger.tasks = ledger.tasks.filter((task) => String((task as { id?: unknown }).id) !== id);
      },
      { opType: 'TASK_DELETE', entityType: 'task', entityId: id, payload: {} },
    ),
  );
}

/** Mutations reach the ACTIVE ledger only, so borrow the activation and give it back. */
async function inHome(householdId: string, work: () => Promise<unknown>): Promise<void> {
  const previous = getActiveHouseholdId();
  await activateLocalHouseProperty(householdId);
  await work();
  if (previous && previous !== householdId) await activateLocalHouseProperty(previous);
}

function taskTitles(section: { ledger: Record<string, unknown> } | undefined): string[] {
  const tasks = (section?.ledger.tasks ?? []) as Array<{ title?: unknown }>;
  return tasks.map((task) => String(task.title)).sort();
}
