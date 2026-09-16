import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  backupEvidenceIsLocal,
  forgetLastHouseBackupEvent,
  getLastHouseBackupEvent,
  listHouseBackupEvents,
  recordHouseBackupSuccess,
} from '../backup/backupHistory';

/**
 * "Is this home recoverable right now?" — the record the status card reasons
 * from, and the thing that stops it over-claiming.
 *
 * The schedule's own `lastRunAt` cannot answer that question: it records an
 * EVENT, not a copy that still exists, and the two drift apart in both
 * directions. An archive written to this device and later deleted leaves the
 * timestamp behind; a manual upload to Drive leaves no timestamp at all. So the
 * destination rides along with the moment, and it is what tells the card
 * whether the evidence can be re-checked or has to be taken on trust.
 *
 * The per-home keying is the House-specific half (Q15 / H5): one record for
 * three homes answers the question for the wrong one.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const HOUSE_A = 'hh_local_maple';
const HOUSE_B = 'hh_local_cabin';

const mockProperties = jest.fn();
/** Mutable rather than spied — see the note in houseRestorePhraseMemory.test.ts. */
let mockActiveHouseholdId: string | null = 'hh_local_maple';
jest.mock('../engine', () => ({
  getActiveHouseholdId: () => mockActiveHouseholdId,
  listLocalHouseProperties: () => mockProperties(),
}));

const mockGet = AsyncStorage.getItem as jest.Mock;
const mockSet = AsyncStorage.setItem as jest.Mock;
const mockRemove = AsyncStorage.removeItem as jest.Mock;

const key = (id: string) => `house.backup.lastSuccess:${id}`;

/** An AsyncStorage that actually stores, so a write can be read back. */
function useStore(initial: Record<string, string> = {}) {
  const values = { ...initial };
  mockGet.mockImplementation(async (k: string) => values[k] ?? null);
  mockSet.mockImplementation(async (k: string, v: string) => {
    values[k] = v;
  });
  mockRemove.mockImplementation(async (k: string) => {
    delete values[k];
  });
  return values;
}

function deviceHolds(...ids: string[]) {
  mockProperties.mockReturnValue(
    ids.map((householdId) => ({
      householdId,
      deviceId: 'd',
      name: householdId === HOUSE_A ? 'Maple Street' : 'Lake Cabin',
      role: 'owner',
      isActive: householdId === HOUSE_A,
      hydrated: true,
      awaitingEnrolment: false,
    })),
  );
}

const EVENT = {
  at: '2026-08-19T12:00:00.000Z',
  destination: 'device' as const,
  kind: 'scheduled' as const,
  fileName: 'a.json',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockActiveHouseholdId = HOUSE_A;
  deviceHolds(HOUSE_A);
  useStore();
});

describe('what counts as evidence', () => {
  it('treats an on-device archive as re-checkable, and anything else as trust', () => {
    // The folder can be listed; Drive, Dropbox and a share sheet cannot be, not
    // from a status card.
    expect(backupEvidenceIsLocal('device')).toBe(true);
    expect(backupEvidenceIsLocal('google-drive')).toBe(false);
    expect(backupEvidenceIsLocal('dropbox')).toBe(false);
    expect(backupEvidenceIsLocal('files')).toBe(false);
    expect(backupEvidenceIsLocal('share')).toBe(false);
  });
});

describe('recording a write', () => {
  it('round-trips the moment, the destination and the home', async () => {
    await recordHouseBackupSuccess(EVENT, HOUSE_A);
    await expect(getLastHouseBackupEvent(HOUSE_A)).resolves.toMatchObject({
      at: EVENT.at,
      destination: 'device',
      kind: 'scheduled',
      householdId: HOUSE_A,
    });
  });

  it('takes the home from the event when the caller does not name one', async () => {
    await recordHouseBackupSuccess({ ...EVENT, householdId: HOUSE_B });
    expect(mockSet).toHaveBeenCalledWith(key(HOUSE_B), expect.any(String));
  });

  it('falls back to the open home for a run started from a screen', async () => {
    // A manual backup started from the screen can only be backing up what is in
    // front of the member.
    await recordHouseBackupSuccess(EVENT);
    expect(mockSet).toHaveBeenCalledWith(key(HOUSE_A), expect.any(String));
  });

  /**
   * The failure this keying exists to prevent: a member who backs up the house
   * every week and has never once backed up the cabin being told "Protected"
   * on both.
   */
  it('never lets one home’s record answer for another', async () => {
    deviceHolds(HOUSE_A, HOUSE_B);
    await recordHouseBackupSuccess(EVENT, HOUSE_A);

    await expect(getLastHouseBackupEvent(HOUSE_A)).resolves.not.toBeNull();
    await expect(getLastHouseBackupEvent(HOUSE_B)).resolves.toBeNull();
  });

  it('never throws when the write fails — bookkeeping must not fail a backup', async () => {
    mockSet.mockRejectedValue(new Error('quota'));
    await expect(recordHouseBackupSuccess(EVENT, HOUSE_A)).resolves.toBeUndefined();
  });

  it('drops a record it cannot attribute rather than filing it device-wide', async () => {
    // A device-wide record would surface as some other home's protection.
    mockActiveHouseholdId = null;
    await recordHouseBackupSuccess({ ...EVENT, householdId: undefined });
    expect(mockSet).not.toHaveBeenCalled();
  });
});

describe('reading a record back', () => {
  it('returns nothing before anything has been written', async () => {
    await expect(getLastHouseBackupEvent(HOUSE_A)).resolves.toBeNull();
  });

  it('treats a corrupt or incomplete blob as no record at all', async () => {
    useStore({ [key(HOUSE_A)]: '{{{' });
    await expect(getLastHouseBackupEvent(HOUSE_A)).resolves.toBeNull();

    useStore({ [key(HOUSE_A)]: JSON.stringify({ destination: 'device' }) });
    await expect(getLastHouseBackupEvent(HOUSE_A)).resolves.toBeNull();
  });

  it('defaults an unrecognised kind to scheduled rather than trusting it', async () => {
    useStore({ [key(HOUSE_A)]: JSON.stringify({ ...EVENT, kind: 'nonsense' }) });
    await expect(getLastHouseBackupEvent(HOUSE_A)).resolves.toMatchObject({ kind: 'scheduled' });
  });

  it('reports every home with its own last backup', async () => {
    deviceHolds(HOUSE_A, HOUSE_B);
    await recordHouseBackupSuccess(EVENT, HOUSE_A);

    const events = await listHouseBackupEvents();
    expect(events).toEqual([
      expect.objectContaining({ householdId: HOUSE_A, propertyName: 'Maple Street' }),
      // Named, and honestly empty — which is what "am I covered" has to say
      // about a home nothing has ever backed up.
      expect.objectContaining({ householdId: HOUSE_B, propertyName: 'Lake Cabin', event: null }),
    ]);
  });

  it('forgets a record on request', async () => {
    await recordHouseBackupSuccess(EVENT, HOUSE_A);
    await forgetLastHouseBackupEvent(HOUSE_A);
    await expect(getLastHouseBackupEvent(HOUSE_A)).resolves.toBeNull();
  });
});

/**
 * A file that holds every home is every home's evidence.
 *
 * It is filed under the whole-device pseudo-id, because that is what was
 * written. Reading it back per home is what stops the status card telling a
 * member with one whole-device backup that all three of their homes are
 * unprotected — which is not merely unhelpful, it would push them into making
 * backups they already have.
 */
describe('a backup that covered every home', () => {
  const ALL_HOMES = 'all-homes';

  it('counts as this home’s evidence, because this home is inside it', async () => {
    useStore();
    await recordHouseBackupSuccess({ ...EVENT, householdId: ALL_HOMES }, ALL_HOMES);

    await expect(getLastHouseBackupEvent(HOUSE_A)).resolves.toMatchObject({
      at: EVENT.at,
      householdId: ALL_HOMES,
    });
    await expect(getLastHouseBackupEvent(HOUSE_B)).resolves.toMatchObject({ at: EVENT.at });
  });

  it('loses to a newer backup of this home alone', async () => {
    // The card reports the most recent fact, whichever kind of file produced it.
    useStore();
    await recordHouseBackupSuccess({ ...EVENT, householdId: ALL_HOMES }, ALL_HOMES);
    await recordHouseBackupSuccess({ ...EVENT, at: '2026-08-25T12:00:00.000Z' }, HOUSE_A);

    await expect(getLastHouseBackupEvent(HOUSE_A)).resolves.toMatchObject({
      at: '2026-08-25T12:00:00.000Z',
      householdId: HOUSE_A,
    });
    // …and the other home still has only the whole-device file to point at.
    await expect(getLastHouseBackupEvent(HOUSE_B)).resolves.toMatchObject({ at: EVENT.at });
  });

  it('beats an older per-home backup', async () => {
    useStore();
    await recordHouseBackupSuccess({ ...EVENT, at: '2026-08-01T12:00:00.000Z' }, HOUSE_A);
    await recordHouseBackupSuccess({ ...EVENT, householdId: ALL_HOMES }, ALL_HOMES);

    await expect(getLastHouseBackupEvent(HOUSE_A)).resolves.toMatchObject({
      at: EVENT.at,
      householdId: ALL_HOMES,
    });
  });

  it('does not invent evidence for a home that has none', async () => {
    useStore();
    await expect(getLastHouseBackupEvent(HOUSE_A)).resolves.toBeNull();
  });

  it('reads its own record straight, without folding itself in twice', async () => {
    useStore();
    await recordHouseBackupSuccess({ ...EVENT, householdId: ALL_HOMES }, ALL_HOMES);
    await expect(getLastHouseBackupEvent(ALL_HOMES)).resolves.toMatchObject({ at: EVENT.at });
  });
});
