/**
 * House V2 — scheduled automatic backups.
 *
 * The port of `budget/local/__tests__/autoBackup.test.ts`. Two things make this
 * suite worth its length:
 *
 *  1. **It is foreground-driven.** Argon2id cannot finish inside an iOS
 *     background window, so the whole feature rests on a catch-up check that
 *     fires when the app becomes usable. If the AppState wiring, the throttle
 *     or the due arithmetic is wrong, backups silently stop and nothing says so.
 *  2. **One run covers EVERY home (Q15 / H5).** A member holds up to three, and
 *     a home is most at risk exactly when it is the one they have not opened in
 *     weeks. A fan-out that quietly covered only the active home would show
 *     three green ticks over archives for one — a data-loss surface wearing a
 *     reassuring label.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';

import { notificationService } from '@services/notifications';

import {
  HOUSE_AUTO_BACKUP_DEFAULTS,
  disableHouseAutoBackup,
  enableHouseAutoBackup,
  getHouseAutoBackupSettings,
  isHouseAutoBackupDue,
  nextHouseAutoBackupDueAt,
  pruneOldBackups,
  runHouseAutoBackupIfDue,
  startHouseAutoBackupScheduler,
  stopHouseAutoBackupScheduler,
  updateHouseAutoBackupSettings,
} from '../backup/autoBackup';
import {
  deleteCloudHouseBackup,
  deleteLocalHouseBackup,
  getHouseBackupRetention,
  isCloudProviderConfigured,
  listCloudHouseBackups,
  listLocalHouseBackups,
  saveHouseBackupTo,
} from '../backup/backupDestinations';

const HOUSE_A = 'hh_local_maple';
const HOUSE_B = 'hh_local_cabin';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('@services/notifications', () => ({
  notificationService: {
    hasPermission: jest.fn(),
    scheduleLocalNotification: jest.fn(),
    cancelNotification: jest.fn(),
  },
}));
jest.mock('@services/toastManager', () => ({ showToast: jest.fn() }));

const mockSessionOpen = jest.fn(() => true);
const mockProperties = jest.fn();
/** Mutable rather than spied — see the note in houseRestorePhraseMemory.test.ts. */
let mockActiveHouseholdId: string | null = 'hh_local_maple';
jest.mock('../engine', () => ({
  getActiveHouseholdId: () => mockActiveHouseholdId,
  isLocalHouseSessionOpen: () => mockSessionOpen(),
  listLocalHouseProperties: () => mockProperties(),
}));

jest.mock('../backup/backupDestinations', () => ({
  saveHouseBackupTo: jest.fn(),
  listLocalHouseBackups: jest.fn(),
  listCloudHouseBackups: jest.fn(),
  listDeviceFolderBackups: jest.fn(),
  deleteLocalHouseBackup: jest.fn(),
  deleteCloudHouseBackup: jest.fn(),
  deleteDeviceFolderBackup: jest.fn(),
  isCloudProviderConfigured: jest.fn(),
  getHouseBackupRetention: jest.fn(),
  cloudProviderLabel: (p: string) => (p === 'dropbox' ? 'Dropbox' : 'Google Drive'),
  isCloudBackupProvider: (d: string) => d === 'google-drive' || d === 'dropbox',
  autoBackupSupports: (d: string) => d === 'device' || d === 'google-drive' || d === 'dropbox',
  autoBackupDestinationLabel: (d: string) =>
    d === 'device'
      ? 'This device'
      : d === 'files'
        ? 'A folder on this phone'
        : d === 'dropbox'
          ? 'Dropbox'
          : 'Google Drive',
  backupFileNameFor: (
    retention: string,
    property: { householdId: string; propertyName: string },
    at: Date,
  ) =>
    retention === 'replace'
      ? `symply-house-backup-home--${property.householdId}.json`
      : `symply-house-backup-${at.toISOString().slice(0, 10)}-0000-home--${property.householdId}.json`,
}));

const mockRecordSuccess = jest.fn();
jest.mock('../backup/backupHistory', () => ({
  recordHouseBackupSuccess: (...a: unknown[]) => mockRecordSuccess(...a),
}));

const mockStorageGet = AsyncStorage.getItem as jest.Mock;
const mockStorageSet = AsyncStorage.setItem as jest.Mock;
const mockSecureGet = SecureStore.getItemAsync as jest.Mock;
const mockSecureSet = SecureStore.setItemAsync as jest.Mock;
const mockSave = saveHouseBackupTo as jest.Mock;
const mockListLocal = listLocalHouseBackups as jest.Mock;
const mockListCloud = listCloudHouseBackups as jest.Mock;
const mockDeleteLocal = deleteLocalHouseBackup as jest.Mock;
const mockDeleteCloud = deleteCloudHouseBackup as jest.Mock;
const mockConfigured = isCloudProviderConfigured as jest.Mock;
const mockRetention = getHouseBackupRetention as jest.Mock;
const mockHasPermission = notificationService.hasPermission as jest.Mock;
const mockSchedule = notificationService.scheduleLocalNotification as jest.Mock;
const mockCancel = notificationService.cancelNotification as jest.Mock;

/**
 * The keys are per home, and that is the whole point of BR-016/Q15 here.
 * AsyncStorage takes the `:` separator used elsewhere in this folder;
 * SecureStore rejects `:` outright, so the phrase key uses `.`.
 */
const settingsKey = (id: string) => `house.backup.autoSettings:${id}`;
const phraseKey = (id: string) => `house.backup.autoPhrase.${id}`;

/** A per-home settings store that behaves like the real AsyncStorage. */
function useSettingsStore(perHome: Record<string, Record<string, unknown>> = {}) {
  const values: Record<string, string> = {};
  for (const [id, patch] of Object.entries(perHome)) {
    values[settingsKey(id)] = JSON.stringify({ ...HOUSE_AUTO_BACKUP_DEFAULTS, ...patch });
  }
  mockStorageGet.mockImplementation(async (key: string) => values[key] ?? null);
  mockStorageSet.mockImplementation(async (key: string, next: string) => {
    values[key] = next;
  });
  return {
    read: (id: string) =>
      values[settingsKey(id)] ? JSON.parse(values[settingsKey(id)]) : null,
  };
}

function deviceHolds(...ids: string[]) {
  mockProperties.mockReturnValue(
    ids.map((householdId, index) => ({
      householdId,
      deviceId: 'dev-1',
      name: householdId === HOUSE_A ? 'Maple Street' : 'Lake Cabin',
      role: 'owner',
      isActive: index === 0,
      hydrated: true,
      awaitingEnrolment: false,
    })),
  );
}

const PHRASE = 'apple bridge cactus dolphin ember forest garden harbor island jungle kettle lantern';

beforeEach(() => {
  jest.clearAllMocks();
  mockActiveHouseholdId = HOUSE_A;
  mockSessionOpen.mockReturnValue(true);
  deviceHolds(HOUSE_A);
  useSettingsStore();
  mockSecureGet.mockResolvedValue(null);
  mockSecureSet.mockResolvedValue(undefined);
  mockSave.mockResolvedValue({ status: 'saved', message: 'Saved on this device.' });
  mockListLocal.mockResolvedValue([{ fileName: 'a.json' }]);
  mockListCloud.mockResolvedValue([]);
  // Both are awaited with `.catch(...)`; a bare jest.fn() returns undefined,
  // and `.catch` on undefined throws inside the sweep's try block.
  mockDeleteLocal.mockResolvedValue(undefined);
  mockDeleteCloud.mockResolvedValue(undefined);
  mockConfigured.mockReturnValue(true);
  mockRetention.mockResolvedValue('dated');
  mockHasPermission.mockResolvedValue(true);
  mockSchedule.mockResolvedValue('notif-1');
  mockCancel.mockResolvedValue(undefined);
});

afterEach(() => {
  stopHouseAutoBackupScheduler();
});

describe('settings', () => {
  it('defaults to off with a weekly cadence and a retention cap', async () => {
    const settings = await getHouseAutoBackupSettings();
    expect(settings.enabled).toBe(false);
    expect(settings.frequency).toBe('weekly');
    expect(settings.destination).toBe('device');
    expect(settings.keepLast).toBe(5);
  });

  it('fills in keys missing from a blob written by an older build', async () => {
    mockStorageGet.mockResolvedValue(JSON.stringify({ enabled: true }));
    const settings = await getHouseAutoBackupSettings();
    expect(settings.enabled).toBe(true);
    // Never `undefined` where the caller expects a value.
    expect(settings.keepLast).toBe(5);
    expect(settings.overdueNotificationId).toBeNull();
  });

  it('treats a corrupt blob as defaults rather than throwing', async () => {
    mockStorageGet.mockResolvedValue('{{{');
    await expect(getHouseAutoBackupSettings()).resolves.toMatchObject({ enabled: false });
  });

  it('merges a patch over what is stored', async () => {
    const store = useSettingsStore({ [HOUSE_A]: { enabled: true, frequency: 'daily' } });
    await updateHouseAutoBackupSettings({ frequency: 'monthly' }, HOUSE_A);
    expect(store.read(HOUSE_A)).toMatchObject({ enabled: true, frequency: 'monthly' });
  });

  /**
   * One schedule for three homes is the failure Q15 exists to prevent: the
   * member arms the house, and the cabin reads as armed too.
   */
  it('keys the schedule per home, so arming one never arms another', async () => {
    const store = useSettingsStore();
    deviceHolds(HOUSE_A, HOUSE_B);

    await updateHouseAutoBackupSettings({ enabled: true }, HOUSE_A);

    expect(store.read(HOUSE_A)).toMatchObject({ enabled: true });
    expect(store.read(HOUSE_B)).toBeNull();
    await expect(getHouseAutoBackupSettings(HOUSE_B)).resolves.toMatchObject({ enabled: false });
  });
});

describe('enable / disable', () => {
  it('mints one phrase, stores it in the keychain, and returns it once', async () => {
    useSettingsStore();
    const { phrase } = await enableHouseAutoBackup({
      frequency: 'weekly',
      destination: 'device',
      householdId: HOUSE_A,
    });

    expect(phrase.split(/\s+/)).toHaveLength(12);
    expect(mockSecureSet).toHaveBeenCalledWith(phraseKey(HOUSE_A), phrase);
  });

  it('reuses the existing phrase when re-enabled, so old archives stay openable', async () => {
    useSettingsStore();
    mockSecureGet.mockResolvedValue(PHRASE);

    const { phrase } = await enableHouseAutoBackup({
      frequency: 'weekly',
      destination: 'device',
      householdId: HOUSE_A,
    });

    expect(phrase).toBe(PHRASE);
    expect(mockSecureSet).not.toHaveBeenCalled();
  });

  it('gives each home its own phrase — the cabin cannot be opened with the house’s words', async () => {
    useSettingsStore();
    deviceHolds(HOUSE_A, HOUSE_B);

    await enableHouseAutoBackup({ frequency: 'weekly', destination: 'device', householdId: HOUSE_A });
    await enableHouseAutoBackup({ frequency: 'weekly', destination: 'device', householdId: HOUSE_B });

    const keys = mockSecureSet.mock.calls.map(([key]) => key);
    expect(keys).toEqual([phraseKey(HOUSE_A), phraseKey(HOUSE_B)]);
  });

  it('refuses rather than showing words it cannot store', async () => {
    // No open home means no per-home slot; handing over twelve words and
    // filing them nowhere gives the member a phrase that opens nothing.
    mockProperties.mockReturnValue([]);
    mockActiveHouseholdId = null;

    await expect(
      enableHouseAutoBackup({ frequency: 'weekly', destination: 'device' }),
    ).rejects.toThrow(/no home is open/i);
  });

  it('keeps the phrase on disable — archives already written still need it', async () => {
    const store = useSettingsStore({ [HOUSE_A]: { enabled: true } });
    await disableHouseAutoBackup(HOUSE_A);

    expect(store.read(HOUSE_A)).toMatchObject({ enabled: false });
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });
});

describe('due calculation', () => {
  const base = { ...HOUSE_AUTO_BACKUP_DEFAULTS };

  it('is never due while disabled', () => {
    expect(nextHouseAutoBackupDueAt({ ...base, enabled: false })).toBeNull();
    expect(isHouseAutoBackupDue({ ...base, enabled: false })).toBe(false);
  });

  it('is due immediately when enabled but never run', () => {
    expect(isHouseAutoBackupDue({ ...base, enabled: true, lastRunAt: null })).toBe(true);
  });

  it('honours each cadence', () => {
    const at = '2026-08-01T00:00:00.000Z';
    const day = 24 * 60 * 60 * 1000;
    const daily = { ...base, enabled: true, frequency: 'daily' as const, lastRunAt: at };
    expect(isHouseAutoBackupDue(daily, new Date(Date.parse(at) + day - 1))).toBe(false);
    expect(isHouseAutoBackupDue(daily, new Date(Date.parse(at) + day))).toBe(true);

    const weekly = { ...base, enabled: true, frequency: 'weekly' as const, lastRunAt: at };
    expect(isHouseAutoBackupDue(weekly, new Date(Date.parse(at) + 6 * day))).toBe(false);
    expect(isHouseAutoBackupDue(weekly, new Date(Date.parse(at) + 7 * day))).toBe(true);

    const monthly = { ...base, enabled: true, frequency: 'monthly' as const, lastRunAt: at };
    expect(isHouseAutoBackupDue(monthly, new Date(Date.parse(at) + 29 * day))).toBe(false);
    expect(isHouseAutoBackupDue(monthly, new Date(Date.parse(at) + 30 * day))).toBe(true);
  });

  it('treats an unparseable lastRunAt as due rather than never running again', () => {
    expect(isHouseAutoBackupDue({ ...base, enabled: true, lastRunAt: 'nonsense' })).toBe(true);
  });
});

describe('a run', () => {
  it('says nothing and writes nothing when automatic backup is off', async () => {
    useSettingsStore({ [HOUSE_A]: { enabled: false } });
    const result = await runHouseAutoBackupIfDue();
    expect(result.status).toBe('skipped');
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('skips when enabled but not yet due', async () => {
    useSettingsStore({
      [HOUSE_A]: { enabled: true, frequency: 'weekly', lastRunAt: new Date().toISOString() },
    });
    const result = await runHouseAutoBackupIfDue();
    expect(result.status).toBe('skipped');
    expect(mockSave).not.toHaveBeenCalled();
  });

  /**
   * `lastRunAt` says a backup happened, not that it survived. Deleting the
   * archive leaves the timestamp behind, so a weekly schedule would sit out the
   * rest of the week believing the member was covered.
   */
  it('runs again when the on-device archive it wrote has been deleted', async () => {
    useSettingsStore({
      [HOUSE_A]: {
        enabled: true,
        destination: 'device',
        frequency: 'weekly',
        lastRunAt: new Date().toISOString(),
      },
    });
    mockSecureGet.mockResolvedValue(PHRASE);
    mockListLocal.mockResolvedValue([]);

    const result = await runHouseAutoBackupIfDue();
    expect(result.status).toBe('ok');
    expect(mockSave).toHaveBeenCalled();
  });

  it('does not treat an unreadable folder as a deleted archive', async () => {
    // Otherwise a failing read would seal a fresh archive on every foreground.
    useSettingsStore({
      [HOUSE_A]: {
        enabled: true,
        destination: 'device',
        frequency: 'weekly',
        lastRunAt: new Date().toISOString(),
      },
    });
    mockListLocal.mockRejectedValue(new Error('unreadable'));

    const result = await runHouseAutoBackupIfDue();
    expect(result.status).toBe('skipped');
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('leaves a cloud schedule to its own cadence', async () => {
    // There is nothing on this device to check, so "the folder is empty" is not
    // a question that can be asked of Drive from here.
    useSettingsStore({
      [HOUSE_A]: {
        enabled: true,
        destination: 'google-drive',
        frequency: 'weekly',
        lastRunAt: new Date().toISOString(),
      },
    });
    mockListLocal.mockResolvedValue([]);

    const result = await runHouseAutoBackupIfDue();
    expect(result.status).toBe('skipped');
  });

  it('skips when no home is open — there is nothing to seal', async () => {
    mockSessionOpen.mockReturnValue(false);
    useSettingsStore({ [HOUSE_A]: { enabled: true } });

    const result = await runHouseAutoBackupIfDue();
    expect(result.status).toBe('skipped');
    expect(result.message).toMatch(/not open/i);
  });

  it('seals with the stored phrase and never opens an OAuth screen', async () => {
    useSettingsStore({ [HOUSE_A]: { enabled: true, destination: 'google-drive' } });
    mockSecureGet.mockResolvedValue(PHRASE);

    await runHouseAutoBackupIfDue();

    expect(mockSave).toHaveBeenCalledWith(
      'google-drive',
      expect.objectContaining({
        phrase: PHRASE,
        householdId: HOUSE_A,
        allowInteractiveAuth: false,
      }),
    );
  });

  it('records the run so the next check is not due again', async () => {
    const store = useSettingsStore({ [HOUSE_A]: { enabled: true } });
    mockSecureGet.mockResolvedValue(PHRASE);

    await runHouseAutoBackupIfDue();

    expect(store.read(HOUSE_A)).toMatchObject({ lastStatus: 'ok', lastError: null });
    expect(store.read(HOUSE_A).lastRunAt).toEqual(expect.any(String));
    // And where it went, which is what the status card reasons from.
    expect(mockRecordSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ destination: 'device', kind: 'scheduled', householdId: HOUSE_A }),
      HOUSE_A,
    );
  });

  it('refuses rather than minting a new phrase when the keychain entry is gone', async () => {
    const store = useSettingsStore({ [HOUSE_A]: { enabled: true } });
    mockSecureGet.mockResolvedValue(null);

    const result = await runHouseAutoBackupIfDue();

    expect(result.status).toBe('failed');
    expect(mockSave).not.toHaveBeenCalled();
    expect(store.read(HOUSE_A)).toMatchObject({ lastStatus: 'failed' });
    expect(result.message).toMatch(/off and on again/i);
  });

  it('fails clearly when the destination provider is not set up in this build', async () => {
    useSettingsStore({ [HOUSE_A]: { enabled: true, destination: 'dropbox' } });
    mockSecureGet.mockResolvedValue(PHRASE);
    mockConfigured.mockReturnValue(false);

    const result = await runHouseAutoBackupIfDue();
    expect(result.status).toBe('failed');
    expect(result.message).toContain('Dropbox');
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('surfaces needs_auth without wiping the last good run timestamp', async () => {
    const lastRunAt = '2026-08-01T00:00:00.000Z';
    const store = useSettingsStore({
      [HOUSE_A]: { enabled: true, destination: 'google-drive', lastRunAt },
    });
    mockSecureGet.mockResolvedValue(PHRASE);
    mockSave.mockResolvedValue({ status: 'needs_auth', message: 'Reconnect Google Drive.' });

    const result = await runHouseAutoBackupIfDue({ force: true });

    expect(result.status).toBe('needs_auth');
    // The last SUCCESSFUL run is still the last successful run.
    expect(store.read(HOUSE_A)).toMatchObject({ lastRunAt, lastStatus: 'needs_auth' });
  });

  it('never throws when the destination layer blows up', async () => {
    useSettingsStore({ [HOUSE_A]: { enabled: true } });
    mockSecureGet.mockResolvedValue(PHRASE);
    mockSave.mockRejectedValue(new Error('hermes died'));

    const result = await runHouseAutoBackupIfDue();
    expect(result.status).toBe('failed');
  });

  it('collapses concurrent triggers into one run', async () => {
    useSettingsStore({ [HOUSE_A]: { enabled: true } });
    mockSecureGet.mockResolvedValue(PHRASE);
    let release: (v: unknown) => void = () => {};
    mockSave.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    const a = runHouseAutoBackupIfDue();
    const b = runHouseAutoBackupIfDue();
    release({ status: 'saved', message: 'Saved.' });
    await Promise.all([a, b]);

    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it('runs on force even when not due', async () => {
    useSettingsStore({
      [HOUSE_A]: { enabled: true, frequency: 'weekly', lastRunAt: new Date().toISOString() },
    });
    mockSecureGet.mockResolvedValue(PHRASE);

    const result = await runHouseAutoBackupIfDue({ force: true });
    expect(result.status).toBe('ok');
  });
});

/**
 * The House-specific half. A member holds up to three homes and a run must
 * reach all of them — including the ones they have not opened this launch,
 * which are exactly the ones most likely to be lost.
 */
describe('covering every home', () => {
  it('seals each home in turn, under its own phrase', async () => {
    deviceHolds(HOUSE_A, HOUSE_B);
    useSettingsStore({
      [HOUSE_A]: { enabled: true },
      [HOUSE_B]: { enabled: true },
    });
    mockSecureGet.mockImplementation(async (key: string) =>
      key === phraseKey(HOUSE_A) ? 'phrase-a' : 'phrase-b',
    );

    const result = await runHouseAutoBackupIfDue();

    expect(mockSave).toHaveBeenCalledTimes(2);
    expect(mockSave).toHaveBeenNthCalledWith(
      1,
      'device',
      expect.objectContaining({ householdId: HOUSE_A, phrase: 'phrase-a' }),
    );
    expect(mockSave).toHaveBeenNthCalledWith(
      2,
      'device',
      expect.objectContaining({ householdId: HOUSE_B, phrase: 'phrase-b' }),
    );
    expect(result.properties).toHaveLength(2);
  });

  it('names the home that failed rather than reporting a bare count', async () => {
    // "2 of 3 homes backed up" with no idea which one is exposed is the same
    // silence the fan-out exists to break.
    deviceHolds(HOUSE_A, HOUSE_B);
    useSettingsStore({ [HOUSE_A]: { enabled: true }, [HOUSE_B]: { enabled: true } });
    mockSecureGet.mockResolvedValue(PHRASE);
    mockSave
      .mockResolvedValueOnce({ status: 'saved', message: 'Saved.' })
      .mockResolvedValueOnce({ status: 'failed', message: 'Disk full.' });

    const result = await runHouseAutoBackupIfDue();

    expect(result.status).toBe('failed');
    expect(result.message).toContain('Lake Cabin');
    expect(result.message).toContain('Disk full.');
  });

  it('lets one home fail without depriving the others of their backup', async () => {
    deviceHolds(HOUSE_A, HOUSE_B);
    useSettingsStore({ [HOUSE_A]: { enabled: true }, [HOUSE_B]: { enabled: true } });
    mockSecureGet.mockResolvedValue(PHRASE);
    mockSave
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ status: 'saved', message: 'Saved.' });

    const result = await runHouseAutoBackupIfDue();

    expect(result.properties.map((p) => p.status)).toEqual(['failed', 'ok']);
  });

  it('narrows to one home when asked — the screen’s "Back up now"', async () => {
    deviceHolds(HOUSE_A, HOUSE_B);
    useSettingsStore({ [HOUSE_A]: { enabled: true }, [HOUSE_B]: { enabled: true } });
    mockSecureGet.mockResolvedValue(PHRASE);

    await runHouseAutoBackupIfDue({ force: true, householdId: HOUSE_B });

    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledWith(
      'device',
      expect.objectContaining({ householdId: HOUSE_B }),
    );
  });

  it('skips a home still waiting to be let in — there is nothing decrypted to seal', async () => {
    mockProperties.mockReturnValue([
      {
        householdId: HOUSE_A,
        deviceId: 'd',
        name: 'Maple Street',
        role: 'owner',
        isActive: true,
        hydrated: true,
        awaitingEnrolment: false,
      },
      {
        householdId: HOUSE_B,
        deviceId: 'd',
        name: 'Lake Cabin',
        role: 'member',
        isActive: false,
        hydrated: false,
        awaitingEnrolment: true,
      },
    ]);
    useSettingsStore({ [HOUSE_A]: { enabled: true }, [HOUSE_B]: { enabled: true } });
    mockSecureGet.mockResolvedValue(PHRASE);

    const result = await runHouseAutoBackupIfDue();

    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(result.properties.map((p) => p.householdId)).toEqual([HOUSE_A]);
  });

  it('distinguishes "no home yet" from "that home is gone"', async () => {
    deviceHolds(HOUSE_A);
    const named = await runHouseAutoBackupIfDue({ householdId: 'hh_local_missing' });
    expect(named.message).toMatch(/no longer on this device/i);

    mockProperties.mockReturnValue([]);
    const anonymous = await runHouseAutoBackupIfDue();
    expect(anonymous.message).toMatch(/not open yet/i);
  });
});

/**
 * The other way to schedule: one file for every home, instead of a file per home.
 *
 * It needs no machinery of its own — the settings blob, the keychain phrase, the
 * file name and the retention sweep are all keyed by household id, and this is
 * an id. What IS specific is that the leg only appears when the member turned it
 * on: a leg reporting `skipped` on every run for everyone else would show up in
 * `properties` — which callers read to say which homes are unprotected — as a
 * home called "All homes" that is never backed up.
 */
describe('scheduling one file for every home', () => {
  const ALL_HOMES = 'all-homes';

  it('does not appear in a run at all unless the member switched it on', async () => {
    useSettingsStore({ [HOUSE_A]: { enabled: true } });
    deviceHolds(HOUSE_A, HOUSE_B);
    mockSecureGet.mockResolvedValue(PHRASE);
    mockSave.mockResolvedValue({ status: 'saved', message: 'Saved on this device.' });

    const result = await runHouseAutoBackupIfDue();

    expect(result.properties.map((leg) => leg.householdId)).toEqual([HOUSE_A, HOUSE_B]);
  });

  it('seals one file covering every home when it is on', async () => {
    useSettingsStore({ [ALL_HOMES]: { enabled: true } });
    deviceHolds(HOUSE_A, HOUSE_B);
    mockSecureGet.mockResolvedValue(PHRASE);
    mockSave.mockResolvedValue({ status: 'saved', message: 'Saved on this device.' });

    const result = await runHouseAutoBackupIfDue();

    // One save, addressed to every home — not one save per home.
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledWith(
      'device',
      expect.objectContaining({ householdId: ALL_HOMES, phrase: PHRASE }),
    );
    // The per-home legs still ran and still said nothing, because their own
    // schedules are off. The whole-device leg is the one that reports.
    expect(result.status).toBe('ok');
    expect(result.properties[0]).toMatchObject({ householdId: ALL_HOMES, status: 'ok' });
  });

  it('records the write and the schedule against the whole-device id', async () => {
    useSettingsStore({ [ALL_HOMES]: { enabled: true } });
    deviceHolds(HOUSE_A, HOUSE_B);
    mockSecureGet.mockResolvedValue(PHRASE);
    mockSave.mockResolvedValue({ status: 'saved', message: 'Saved on this device.' });

    await runHouseAutoBackupIfDue();

    expect(mockRecordSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: ALL_HOMES, kind: 'scheduled' }),
      ALL_HOMES,
    );
  });

  it('mints and keeps one phrase for it, like any other schedule', async () => {
    useSettingsStore();
    mockSecureGet.mockResolvedValue(null);

    const { phrase } = await enableHouseAutoBackup({
      frequency: 'weekly',
      destination: 'device',
      householdId: ALL_HOMES,
    });

    expect(phrase).toBeTruthy();
    // SecureStore rejects `:`; `all-homes` is already inside its allowed set.
    expect(mockSecureSet).toHaveBeenCalledWith('house.backup.autoPhrase.all-homes', phrase);
  });
});

describe('retention', () => {
  it('deletes only the archives past the keep-last window on device', async () => {
    mockRetention.mockResolvedValue('dated');
    mockListLocal.mockResolvedValue(
      Array.from({ length: 7 }, (_, i) => ({ fileName: `a${i}.json`, uri: `u${i}` })),
    );

    const pruned = await pruneOldBackups('device', 5, HOUSE_A);

    expect(pruned).toBe(2);
    expect(mockDeleteLocal).toHaveBeenCalledTimes(2);
    expect(mockDeleteLocal).toHaveBeenCalledWith('a5.json');
    expect(mockListLocal).toHaveBeenCalledWith(HOUSE_A);
  });

  it('prunes cloud archives by id', async () => {
    mockRetention.mockResolvedValue('dated');
    mockListCloud.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => ({ id: `f${i}`, fileName: `a${i}.json` })),
    );

    const pruned = await pruneOldBackups('google-drive', 5, HOUSE_A);
    expect(pruned).toBe(1);
    expect(mockDeleteCloud).toHaveBeenCalledWith('google-drive', 'f5');
  });

  /**
   * The dated files still in the folder were written BEFORE the member switched
   * to replace mode. They asked to stop making new copies, not to have the ones
   * they had deleted out from under them.
   */
  it('never prunes in replace mode', async () => {
    mockRetention.mockResolvedValue('replace');
    mockListLocal.mockResolvedValue(
      Array.from({ length: 9 }, (_, i) => ({ fileName: `a${i}.json` })),
    );

    await expect(pruneOldBackups('device', 5, HOUSE_A)).resolves.toBe(0);
    expect(mockDeleteLocal).not.toHaveBeenCalled();
  });

  it('keeps everything when keepLast is zero or negative', async () => {
    await expect(pruneOldBackups('device', 0, HOUSE_A)).resolves.toBe(0);
    await expect(pruneOldBackups('device', -1, HOUSE_A)).resolves.toBe(0);
  });

  it('does not fail a good backup because the cleanup afterwards failed', async () => {
    mockRetention.mockResolvedValue('dated');
    mockListLocal.mockRejectedValue(new Error('unreadable'));
    await expect(pruneOldBackups('device', 5, HOUSE_A)).resolves.toBe(0);
  });

  /**
   * The one rule that makes whole-device archives safe to keep beside per-home
   * ones. Such a file lists for EVERY home, because it contains every home — so
   * three homes each keeping their last five would take turns sweeping the same
   * shared files, and the sixth-newest would go because one home counted to
   * five, taking the other two homes' copies with it.
   */
  it('never lets a per-home sweep delete a file that holds every home', async () => {
    mockRetention.mockResolvedValue('dated');
    mockListLocal.mockResolvedValue([
      ...Array.from({ length: 6 }, (_, i) => ({
        fileName: `all-${i}.json`,
        uri: `u${i}`,
        coversAllHomes: true,
      })),
      ...Array.from({ length: 7 }, (_, i) => ({
        fileName: `maple-${i}.json`,
        uri: `m${i}`,
        coversAllHomes: false,
      })),
    ]);

    const pruned = await pruneOldBackups('device', 5, HOUSE_A);

    expect(pruned).toBe(2);
    expect(mockDeleteLocal).toHaveBeenCalledWith('maple-5.json');
    expect(mockDeleteLocal).toHaveBeenCalledWith('maple-6.json');
    for (const call of mockDeleteLocal.mock.calls) {
      expect(String(call[0])).not.toMatch(/^all-/);
    }
  });

  it('sweeps the whole-device bucket only when asked for that bucket by name', async () => {
    mockRetention.mockResolvedValue('dated');
    mockListLocal.mockResolvedValue(
      Array.from({ length: 7 }, (_, i) => ({
        fileName: `all-${i}.json`,
        uri: `u${i}`,
        coversAllHomes: true,
      })),
    );

    const pruned = await pruneOldBackups('device', 5, 'all-homes');

    expect(pruned).toBe(2);
    expect(mockDeleteLocal).toHaveBeenCalledWith('all-5.json');
  });
});

describe('the overdue reminder', () => {
  const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  it('nags once when a failing schedule has been due for days, naming the home', async () => {
    useSettingsStore({
      [HOUSE_A]: { enabled: true, destination: 'google-drive', lastRunAt: longAgo },
    });
    mockSecureGet.mockResolvedValue(PHRASE);
    mockSave.mockResolvedValue({ status: 'needs_auth', message: 'Reconnect.' });

    await runHouseAutoBackupIfDue();

    expect(mockSchedule).toHaveBeenCalledWith(
      'Home backup is overdue',
      // A member with three homes would otherwise get identical notifications
      // and no way to tell which one is exposed.
      expect.stringContaining('Maple Street'),
      null,
      { type: 'house_auto_backup_overdue', householdId: HOUSE_A },
    );
  });

  it('does not stack a second nag while one is pending', async () => {
    useSettingsStore({
      [HOUSE_A]: {
        enabled: true,
        destination: 'google-drive',
        lastRunAt: longAgo,
        overdueNotificationId: 'already-there',
      },
    });
    mockSecureGet.mockResolvedValue(PHRASE);
    mockSave.mockResolvedValue({ status: 'failed', message: 'nope' });

    await runHouseAutoBackupIfDue();
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('stays quiet when a run fails but the schedule is only just overdue', async () => {
    useSettingsStore({
      [HOUSE_A]: {
        enabled: true,
        destination: 'google-drive',
        frequency: 'daily',
        lastRunAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      },
    });
    mockSecureGet.mockResolvedValue(PHRASE);
    mockSave.mockResolvedValue({ status: 'failed', message: 'nope' });

    await runHouseAutoBackupIfDue();
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('cancels the pending nag once a run succeeds', async () => {
    useSettingsStore({
      [HOUSE_A]: { enabled: true, overdueNotificationId: 'notif-9', lastRunAt: longAgo },
    });
    mockSecureGet.mockResolvedValue(PHRASE);

    await runHouseAutoBackupIfDue();
    expect(mockCancel).toHaveBeenCalledWith('notif-9');
  });

  it('says nothing at all when notifications are not permitted', async () => {
    useSettingsStore({
      [HOUSE_A]: { enabled: true, destination: 'google-drive', lastRunAt: longAgo },
    });
    mockSecureGet.mockResolvedValue(PHRASE);
    mockSave.mockResolvedValue({ status: 'failed', message: 'nope' });
    mockHasPermission.mockResolvedValue(false);

    await runHouseAutoBackupIfDue();
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('cancels the pending nag when the member turns the schedule off', async () => {
    useSettingsStore({ [HOUSE_A]: { enabled: true, overdueNotificationId: 'notif-3' } });
    await disableHouseAutoBackup(HOUSE_A);
    expect(mockCancel).toHaveBeenCalledWith('notif-3');
  });
});

describe('the foreground scheduler', () => {
  let listener: ((state: string) => void) | undefined;
  let removeSpy: jest.Mock;

  beforeEach(() => {
    removeSpy = jest.fn();
    listener = undefined;
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation(((_event: string, handler: (state: string) => void) => {
        listener = handler;
        return { remove: removeSpy };
      }) as unknown as typeof AppState.addEventListener);
    useSettingsStore({ [HOUSE_A]: { enabled: true } });
    mockSecureGet.mockResolvedValue(PHRASE);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * Drain the run completely.
   *
   * A single run awaits storage, the keychain, the save, the prune and three
   * writes back — microtask ticks alone do not get through it, and a run still
   * in flight makes the NEXT trigger a no-op by design (`runInFlight`). A test
   * that under-drains therefore reads as "the scheduler did not fire".
   */
  const settle = async () => {
    for (let i = 0; i < 6; i += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      for (let j = 0; j < 20; j += 1) await Promise.resolve();
    }
  };

  it('runs the due check once on start', async () => {
    startHouseAutoBackupScheduler();
    await settle();
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it('subscribes to foreground transitions exactly once across repeat calls', async () => {
    // `DataContext` calls this on every session open — launch, sign-in, home
    // switch — and a second subscription would double every later run.
    startHouseAutoBackupScheduler();
    startHouseAutoBackupScheduler();
    startHouseAutoBackupScheduler();
    await settle();
    expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
  });

  it('runs a due backup when the app returns to the foreground', async () => {
    startHouseAutoBackupScheduler();
    await settle();
    mockSave.mockClear();
    useSettingsStore({ [HOUSE_A]: { enabled: true } });

    listener?.('active');
    await settle();
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it('ignores background and inactive transitions', async () => {
    startHouseAutoBackupScheduler();
    await settle();
    mockSave.mockClear();

    listener?.('background');
    listener?.('inactive');
    await settle();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('throttles repeated foreground events so a slow seal is not queued twice', async () => {
    // Tapping through a share sheet or an OAuth screen bounces AppState several
    // times in a row.
    startHouseAutoBackupScheduler();
    await settle();
    mockSave.mockClear();
    useSettingsStore({ [HOUSE_A]: { enabled: true } });

    listener?.('active');
    await settle();
    listener?.('active');
    listener?.('active');
    await settle();

    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it('removes the listener on stop, so a signed-out session stops backing up', async () => {
    startHouseAutoBackupScheduler();
    await settle();
    stopHouseAutoBackupScheduler();
    expect(removeSpy).toHaveBeenCalled();

    // …and re-subscribes cleanly afterwards.
    startHouseAutoBackupScheduler();
    await settle();
    expect(AppState.addEventListener).toHaveBeenCalledTimes(2);
  });
});
