import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';

import { notificationService } from '@services/notifications';

import {
  BUDGET_AUTO_BACKUP_DEFAULTS,
  disableBudgetAutoBackup,
  enableBudgetAutoBackup,
  getBudgetAutoBackupSettings,
  isBudgetAutoBackupDue,
  nextBudgetAutoBackupDueAt,
  pruneOldBackups,
  runBudgetAutoBackupIfDue,
  startBudgetAutoBackupScheduler,
  stopBudgetAutoBackupScheduler,
  updateBudgetAutoBackupSettings,
} from '../backup/autoBackup';
import {
  deleteCloudBudgetBackup,
  deleteLocalBudgetBackup,
  getBudgetBackupRetention,
  isCloudProviderConfigured,
  listCloudBudgetBackups,
  listLocalBudgetBackups,
  saveBudgetBackupTo,
} from '../backup/backupDestinations';
import {
  closeLocalBudgetSession,
  getActiveBudgetHouseholdId,
  openLocalBudgetSessionForTests,
} from '../engine';

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
jest.mock('../backup/backupDestinations', () => ({
  saveBudgetBackupTo: jest.fn(),
  listLocalBudgetBackups: jest.fn(),
  listCloudBudgetBackups: jest.fn(),
  listDeviceFolderBackups: jest.fn(),
  deleteLocalBudgetBackup: jest.fn(),
  deleteCloudBudgetBackup: jest.fn(),
  deleteDeviceFolderBackup: jest.fn(),
  isCloudProviderConfigured: jest.fn(),
  getBudgetBackupRetention: jest.fn(),
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
  timestampedBackupFileName: (d: Date) =>
    `symply-budget-backup-${d.toISOString().slice(0, 10)}-0000.json`,
  backupFileNameFor: (retention: string, _household: unknown, d: Date) =>
    retention === 'replace'
      ? 'symply-budget-backup-home--hh1.json'
      : `symply-budget-backup-${d.toISOString().slice(0, 10)}-0000.json`,
  // The bundle name: no household half, because the file holds every household.
  bundleBackupFileName: (retention: string, d: Date) =>
    retention === 'replace'
      ? 'symply-budget-backup.json'
      : `symply-budget-backup-${d.toISOString().slice(0, 10)}-0000.json`,
  // A name with no `--<token>` half is a bundle; the pruner uses this to leave
  // legacy per-household archives alone.
  isBundleArchiveName: (fileName: string) =>
    !fileName.replace(/\.json$/i, '').includes('--'),
}));

const mockStorageGet = AsyncStorage.getItem as jest.Mock;
const mockStorageSet = AsyncStorage.setItem as jest.Mock;
const mockSecureGet = SecureStore.getItemAsync as jest.Mock;
const mockSecureSet = SecureStore.setItemAsync as jest.Mock;
const mockSave = saveBudgetBackupTo as jest.Mock;
const mockListLocal = listLocalBudgetBackups as jest.Mock;
const mockListCloud = listCloudBudgetBackups as jest.Mock;
const mockDeleteLocal = deleteLocalBudgetBackup as jest.Mock;
const mockDeleteCloud = deleteCloudBudgetBackup as jest.Mock;
const mockConfigured = isCloudProviderConfigured as jest.Mock;
const mockRetention = getBudgetBackupRetention as jest.Mock;
const mockHasPermission = notificationService.hasPermission as jest.Mock;
const mockSchedule = notificationService.scheduleLocalNotification as jest.Mock;
const mockCancel = notificationService.cancelNotification as jest.Mock;

/**
 * The schedule and phrase are DEVICE-level, because the file they describe is: a
 * bundle holds every household, so there is one thing to schedule and one set of
 * twelve words to keep.
 *
 * BR-016 briefly keyed both per household — `…autoSettings:<hh>` and
 * `…autoPhrase.<hh>` — to stop one household's backup vouching for another's.
 * The bundle removes the problem rather than partitioning it, and those keys are
 * now read once and folded back (see `adoptPerHouseholdSettings`); the fold is
 * covered by its own case below.
 *
 * Still functions rather than constants so the per-household variants can be
 * built from the session minted in `beforeEach`.
 */
const settingsKey = () => 'budget.backup.autoSettings';
const phraseKey = () => 'budget.backup.autoPhrase';
const perHouseholdSettingsKey = () =>
  `budget.backup.autoSettings:${getActiveBudgetHouseholdId()}`;
const perHouseholdPhraseKey = () =>
  `budget.backup.autoPhrase.${String(getActiveBudgetHouseholdId()).replace(/[^A-Za-z0-9._-]+/g, '_')}`;

/** Make AsyncStorage behave like a real store for the settings blob. */
function useSettingsStore(initial: Record<string, unknown> = {}) {
  let value: string | null = Object.keys(initial).length
    ? JSON.stringify({ ...BUDGET_AUTO_BACKUP_DEFAULTS, ...initial })
    : null;
  mockStorageGet.mockImplementation(async (key: string) =>
    key === settingsKey() ? value : null,
  );
  mockStorageSet.mockImplementation(async (key: string, next: string) => {
    if (key === settingsKey()) value = next;
  });
  return {
    read: () => (value ? JSON.parse(value) : null),
  };
}

const DAY = 24 * 60 * 60 * 1000;

describe('budget auto-backup', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    stopBudgetAutoBackupScheduler();
    useSettingsStore();
    mockSecureGet.mockResolvedValue(null);
    mockSecureSet.mockResolvedValue(undefined);
    mockConfigured.mockReturnValue(true);
    mockHasPermission.mockResolvedValue(true);
    mockSchedule.mockResolvedValue('notif-1');
    mockCancel.mockResolvedValue(undefined);
    mockListLocal.mockResolvedValue([]);
    mockListCloud.mockResolvedValue([]);
    // Must resolve, not return undefined — the pruner chains `.catch()` on these.
    mockDeleteLocal.mockResolvedValue(undefined);
    mockDeleteCloud.mockResolvedValue(undefined);
    // `dated` is what the retention tests below are ABOUT: pruning only means
    // something when a run adds a file each time. The shipped default is
    // `replace`, which is covered by its own test rather than by making every
    // other test here reason about it.
    mockRetention.mockResolvedValue('dated');
    mockSave.mockResolvedValue({
      status: 'saved',
      destination: 'device',
      message: 'Saved on this device.',
      phrase: 'w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12',
      fileName: 'backup.json',
      location: 'file:///docs/backup.json',
      // A bundle names every household it sealed; the run records the write
      // against all of them.
      householdIds: ['hh1'],
      coverage: [],
      skippedAttachments: 0,
    });
    await openLocalBudgetSessionForTests({ userId: 'user-auto-backup' });
  });

  afterEach(async () => {
    stopBudgetAutoBackupScheduler();
    await closeLocalBudgetSession();
  });

  describe('settings', () => {
    it('defaults to off with a weekly cadence and a retention cap', async () => {
      const settings = await getBudgetAutoBackupSettings();
      expect(settings.enabled).toBe(false);
      expect(settings.frequency).toBe('weekly');
      expect(settings.keepLast).toBeGreaterThan(0);
    });

    it('fills in keys missing from a blob written by an older build', async () => {
      mockStorageGet.mockResolvedValue(JSON.stringify({ enabled: true }));

      const settings = await getBudgetAutoBackupSettings();

      expect(settings.enabled).toBe(true);
      expect(settings.frequency).toBe('weekly');
      expect(settings.keepLast).toBe(BUDGET_AUTO_BACKUP_DEFAULTS.keepLast);
    });

    it('treats a corrupt blob as defaults rather than throwing', async () => {
      mockStorageGet.mockResolvedValue('not json');
      await expect(getBudgetAutoBackupSettings()).resolves.toEqual(BUDGET_AUTO_BACKUP_DEFAULTS);
    });
  });

  /**
   * The BR-016 build wrote a schedule and a phrase PER HOUSEHOLD. Both are read
   * once and folded back into the device-level slot, or a member who had
   * automatic backup switched on would silently find it off after the upgrade —
   * the exact "looks protected, is not" failure the whole collapse exists to
   * end, arriving through the migration instead of the design.
   */
  describe('folding the per-household keys back', () => {
    it('adopts the per-household schedule and clears the key behind it', async () => {
      const perHousehold = JSON.stringify({
        ...BUDGET_AUTO_BACKUP_DEFAULTS,
        enabled: true,
        frequency: 'daily',
        destination: 'google-drive',
      });
      mockStorageGet.mockImplementation(async (key: string) =>
        key === perHouseholdSettingsKey() ? perHousehold : null,
      );

      const settings = await getBudgetAutoBackupSettings();

      expect(settings.enabled).toBe(true);
      expect(settings.frequency).toBe('daily');
      expect(settings.destination).toBe('google-drive');
      // Written to the device slot…
      expect(mockStorageSet).toHaveBeenCalledWith(settingsKey(), perHousehold);
      // …and the old key cleared, so nothing can resurrect a schedule the
      // member has no screen to turn off.
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith(perHouseholdSettingsKey());
    });

    it('prefers the device-level schedule and never folds over it', async () => {
      const device = JSON.stringify({ ...BUDGET_AUTO_BACKUP_DEFAULTS, frequency: 'monthly' });
      mockStorageGet.mockImplementation(async (key: string) =>
        key === settingsKey() ? device : JSON.stringify({ frequency: 'daily' }),
      );

      const settings = await getBudgetAutoBackupSettings();

      expect(settings.frequency).toBe('monthly');
      expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    });

    it('adopts the per-household phrase but leaves it in the keychain', async () => {
      const existing = 'one two three four five six seven eight nine ten eleven twelve';
      mockSecureGet.mockImplementation(async (key: string) =>
        key === perHouseholdPhraseKey() ? existing : null,
      );
      useSettingsStore();

      const { phrase } = await enableBudgetAutoBackup({
        frequency: 'weekly',
        destination: 'device',
      });

      expect(phrase).toBe(existing);
      expect(mockSecureSet).toHaveBeenCalledWith(phraseKey(), existing);
      // Deliberately NOT deleted: those words still open every archive that
      // household already wrote, and the member may have no other copy of them.
      expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    });
  });

  describe('enable / disable', () => {
    it('mints one phrase, stores it in the keychain, and returns it once', async () => {
      useSettingsStore();

      const { settings, phrase, phraseIsNew } = await enableBudgetAutoBackup({
        frequency: 'daily',
        destination: 'google-drive',
      });

      expect(settings.enabled).toBe(true);
      expect(settings.frequency).toBe('daily');
      expect(settings.destination).toBe('google-drive');
      expect(phrase.split(' ')).toHaveLength(12);
      expect(mockSecureSet).toHaveBeenCalledWith(phraseKey(), phrase);
      // The screen words its sheet from this: "here is your one phrase" only
      // reads right for words the member has not seen before.
      expect(phraseIsNew).toBe(true);
    });

    it('reuses the existing phrase when re-enabled, so old archives stay openable', async () => {
      const existing = 'one two three four five six seven eight nine ten eleven twelve';
      mockSecureGet.mockResolvedValue(existing);
      useSettingsStore();

      const { phrase, phraseIsNew } = await enableBudgetAutoBackup({
        frequency: 'weekly',
        destination: 'device',
      });

      expect(phrase).toBe(existing);
      expect(mockSecureSet).not.toHaveBeenCalled();
      // Including a phrase a MANUAL backup minted: the schedule adopts the
      // device's words rather than issuing a second secret beside them.
      expect(phraseIsNew).toBe(false);
    });

    it('keeps the phrase on disable — archives already written need it', async () => {
      const store = useSettingsStore({ enabled: true });

      await disableBudgetAutoBackup();

      expect(store.read().enabled).toBe(false);
      expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    });
  });

  describe('due calculation', () => {
    it('is never due while disabled', () => {
      const settings = { ...BUDGET_AUTO_BACKUP_DEFAULTS, enabled: false };
      expect(nextBudgetAutoBackupDueAt(settings)).toBeNull();
      expect(isBudgetAutoBackupDue(settings)).toBe(false);
    });

    it('is due immediately when enabled but never run', () => {
      const settings = { ...BUDGET_AUTO_BACKUP_DEFAULTS, enabled: true, lastRunAt: null };
      expect(isBudgetAutoBackupDue(settings)).toBe(true);
    });

    it('honours each cadence', () => {
      const base = new Date('2026-08-01T00:00:00.000Z');
      const at = (ms: number) => new Date(base.getTime() + ms);
      const settings = (frequency: 'daily' | 'weekly' | 'monthly') => ({
        ...BUDGET_AUTO_BACKUP_DEFAULTS,
        enabled: true,
        frequency,
        lastRunAt: base.toISOString(),
      });

      expect(isBudgetAutoBackupDue(settings('daily'), at(DAY - 1000))).toBe(false);
      expect(isBudgetAutoBackupDue(settings('daily'), at(DAY))).toBe(true);

      expect(isBudgetAutoBackupDue(settings('weekly'), at(6 * DAY))).toBe(false);
      expect(isBudgetAutoBackupDue(settings('weekly'), at(7 * DAY))).toBe(true);

      expect(isBudgetAutoBackupDue(settings('monthly'), at(29 * DAY))).toBe(false);
      expect(isBudgetAutoBackupDue(settings('monthly'), at(30 * DAY))).toBe(true);
    });

    it('treats an unparseable lastRunAt as due rather than never running again', () => {
      const settings = {
        ...BUDGET_AUTO_BACKUP_DEFAULTS,
        enabled: true,
        lastRunAt: 'garbage',
      };
      expect(isBudgetAutoBackupDue(settings)).toBe(true);
    });
  });

  describe('run', () => {
    it('skips silently when auto-backup is off', async () => {
      useSettingsStore();

      const result = await runBudgetAutoBackupIfDue();

      expect(result.status).toBe('skipped');
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('skips when enabled but not yet due', async () => {
      useSettingsStore({ enabled: true, lastRunAt: new Date().toISOString() });
      // The archive that run wrote is still there, so there is nothing to redo.
      mockListLocal.mockResolvedValue([{ fileName: 'backup.json', uri: 'file:///b', size: 10 }]);

      const result = await runBudgetAutoBackupIfDue();

      expect(result.status).toBe('skipped');
      expect(mockSave).not.toHaveBeenCalled();
    });

    // `lastRunAt` records that a run happened, not that its archive survived.
    // Deleting the file — from the Backup screen, or from Files — leaves the
    // member unprotected, and a weekly schedule would sit out the rest of the
    // week before noticing.
    it('runs again when the on-device archive it wrote has been deleted', async () => {
      useSettingsStore({
        enabled: true,
        destination: 'device',
        lastRunAt: new Date().toISOString(),
      });
      mockSecureGet.mockResolvedValue('a b c d e f g h i j k l');
      mockListLocal.mockResolvedValue([]);

      const result = await runBudgetAutoBackupIfDue();

      expect(result.status).toBe('ok');
      expect(mockSave).toHaveBeenCalled();
    });

    it('does not treat an unreadable folder as a deleted archive', async () => {
      // Otherwise a folder we cannot read seals a fresh archive on every
      // foreground, for as long as the read keeps failing.
      useSettingsStore({
        enabled: true,
        destination: 'device',
        lastRunAt: new Date().toISOString(),
      });
      mockListLocal.mockRejectedValue(new Error('unreadable'));

      const result = await runBudgetAutoBackupIfDue();

      expect(result.status).toBe('skipped');
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('leaves a cloud schedule to its own cadence', async () => {
      // Nothing on this device is expected when backups go to Drive, so an
      // empty folder must not re-trigger an upload on every app open.
      useSettingsStore({
        enabled: true,
        destination: 'google-drive',
        lastRunAt: new Date().toISOString(),
      });
      mockListLocal.mockResolvedValue([]);

      const result = await runBudgetAutoBackupIfDue();

      expect(result.status).toBe('skipped');
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('skips when the ledger is not open — there is nothing to seal', async () => {
      useSettingsStore({ enabled: true });
      mockSecureGet.mockResolvedValue('a b c d e f g h i j k l');
      await closeLocalBudgetSession();

      const result = await runBudgetAutoBackupIfDue();

      expect(result.status).toBe('skipped');
      expect(mockSave).not.toHaveBeenCalled();

      await openLocalBudgetSessionForTests({ userId: 'user-auto-backup' });
    });

    it('seals with the stored phrase and never opens an OAuth screen', async () => {
      const phrase = 'a b c d e f g h i j k l';
      useSettingsStore({ enabled: true, destination: 'google-drive' });
      mockSecureGet.mockResolvedValue(phrase);
      mockSave.mockResolvedValue({
        status: 'saved',
        destination: 'google-drive',
        message: 'Uploaded to Google Drive.',
        phrase,
        fileName: 'f.json',
        location: 'file-1',
        householdIds: ['hh1'],
        coverage: [],
        skippedAttachments: 0,
      });

      const result = await runBudgetAutoBackupIfDue();

      expect(result.status).toBe('ok');
      expect(mockSave).toHaveBeenCalledWith(
        'google-drive',
        expect.objectContaining({ phrase, allowInteractiveAuth: false }),
      );
    });

    it('records the run so the next check is not due again', async () => {
      const store = useSettingsStore({ enabled: true, frequency: 'daily' });
      mockSecureGet.mockResolvedValue('a b c d e f g h i j k l');
      const now = new Date('2026-08-11T10:00:00.000Z');

      await runBudgetAutoBackupIfDue({ now });

      const saved = store.read();
      expect(saved.lastRunAt).toBe(now.toISOString());
      expect(saved.lastStatus).toBe('ok');
      expect(saved.lastError).toBeNull();
      expect(isBudgetAutoBackupDue(saved, now)).toBe(false);
    });

    it('refuses rather than minting a new phrase when the keychain entry is gone', async () => {
      const store = useSettingsStore({ enabled: true });
      mockSecureGet.mockResolvedValue(null);

      const result = await runBudgetAutoBackupIfDue();

      expect(result.status).toBe('failed');
      expect(result.message).toMatch(/phrase missing/i);
      expect(mockSave).not.toHaveBeenCalled();
      expect(mockSecureSet).not.toHaveBeenCalled();
      expect(store.read().lastStatus).toBe('failed');
    });

    it('fails clearly when the destination provider is not set up in this build', async () => {
      useSettingsStore({ enabled: true, destination: 'dropbox' });
      mockSecureGet.mockResolvedValue('a b c d e f g h i j k l');
      mockConfigured.mockReturnValue(false);

      const result = await runBudgetAutoBackupIfDue();

      expect(result.status).toBe('failed');
      expect(result.message).toContain('Dropbox');
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('surfaces needs_auth without wiping the last good run timestamp', async () => {
      const lastRunAt = new Date('2026-08-01T00:00:00.000Z').toISOString();
      const store = useSettingsStore({ enabled: true, destination: 'google-drive', lastRunAt });
      mockSecureGet.mockResolvedValue('a b c d e f g h i j k l');
      mockSave.mockResolvedValue({
        status: 'needs_auth',
        destination: 'google-drive',
        message: 'Google Drive needs to be reconnected.',
        phrase: 'a b c d e f g h i j k l',
        fileName: 'f.json',
        location: null,
        householdIds: [],
        coverage: [],
        skippedAttachments: 0,
      });

      const result = await runBudgetAutoBackupIfDue({ now: new Date('2026-08-11T00:00:00.000Z') });

      expect(result.status).toBe('needs_auth');
      expect(store.read().lastStatus).toBe('needs_auth');
      expect(store.read().lastRunAt).toBe(lastRunAt);
    });

    it('never throws when the destination layer blows up', async () => {
      useSettingsStore({ enabled: true });
      mockSecureGet.mockResolvedValue('a b c d e f g h i j k l');
      mockSave.mockRejectedValue(new Error('boom'));

      const result = await runBudgetAutoBackupIfDue();

      expect(result.status).toBe('failed');
      expect(result.message).not.toContain('boom');
    });

    it('collapses concurrent triggers into one run', async () => {
      useSettingsStore({ enabled: true });
      mockSecureGet.mockResolvedValue('a b c d e f g h i j k l');
      // Build the gate up front so `release` is assigned before the run starts —
      // capturing it inside mockImplementation runs too late.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      mockSave.mockImplementation(() =>
        gate.then(() => ({
          status: 'saved',
          destination: 'device',
          message: 'ok',
          phrase: 'p',
          fileName: 'f',
          householdIds: ['hh1'],
          coverage: [],
          skippedAttachments: 0,
          location: 'l',
        })),
      );

      const first = runBudgetAutoBackupIfDue();
      const second = runBudgetAutoBackupIfDue();
      release();
      await Promise.all([first, second]);

      // A second foreground event mid-seal must not start a second Argon2 pass.
      expect(mockSave).toHaveBeenCalledTimes(1);
    });

    it('runs on force even when not due', async () => {
      useSettingsStore({ enabled: true, lastRunAt: new Date().toISOString() });
      mockSecureGet.mockResolvedValue('a b c d e f g h i j k l');

      const result = await runBudgetAutoBackupIfDue({ force: true });

      expect(result.status).toBe('ok');
      expect(mockSave).toHaveBeenCalled();
    });
  });

  describe('retention mode', () => {
    it('names the scheduled archive by the clock in dated mode', async () => {
      useSettingsStore({ enabled: true });
      mockSecureGet.mockResolvedValue('a b c d e f g h i j k l');

      await runBudgetAutoBackupIfDue({ force: true });

      expect(mockSave).toHaveBeenCalledWith(
        'device',
        expect.objectContaining({ fileName: expect.stringMatching(/\d{4}-\d{2}-\d{2}-0000/) }),
      );
    });

    it('reuses one un-dated name in replace mode, so every run lands on one file', async () => {
      mockRetention.mockResolvedValue('replace');
      useSettingsStore({ enabled: true });
      mockSecureGet.mockResolvedValue('a b c d e f g h i j k l');

      await runBudgetAutoBackupIfDue({ force: true });

      expect(mockSave).toHaveBeenCalledWith(
        'device',
        // No household half: the bundle holds them all, so there is nothing to
        // disambiguate — and `replace` means one fixed name per device.
        expect.objectContaining({ fileName: 'symply-budget-backup.json' }),
      );
    });

    it('never prunes in replace mode — the dated files there predate the switch', async () => {
      mockRetention.mockResolvedValue('replace');
      mockListLocal.mockResolvedValue([
        { fileName: 'e.json', uri: 'u', size: 1, modifiedAt: null },
        { fileName: 'd.json', uri: 'u', size: 1, modifiedAt: null },
        { fileName: 'c.json', uri: 'u', size: 1, modifiedAt: null },
      ]);

      const pruned = await pruneOldBackups('device', 1);

      // Turning "keep every copy" OFF asks to stop MAKING copies. Reading it as
      // "and delete the ones I already have" would destroy the history somebody
      // had been deliberately keeping.
      expect(pruned).toBe(0);
      expect(mockDeleteLocal).not.toHaveBeenCalled();
    });
  });

  describe('destinations a schedule may use', () => {
    it('refuses to run against one that needs somebody present', async () => {
      useSettingsStore({ enabled: true, destination: 'files' });
      mockSecureGet.mockResolvedValue('a b c d e f g h i j k l');

      const result = await runBudgetAutoBackupIfDue({ force: true });

      // `files` is scheduled-capable on Android only (the folder grant persists
      // there). A setting carried over from an Android phone must fail loudly
      // rather than silently never run.
      expect(result.status).toBe('failed');
      expect(result.message).toMatch(/on its own on this phone/i);
      expect(mockSave).not.toHaveBeenCalled();
    });
  });

  describe('retention', () => {
    it('deletes only the archives past the keep-last window on device', async () => {
      mockListLocal.mockResolvedValue([
        { fileName: 'e.json', uri: 'u', size: 1, modifiedAt: null },
        { fileName: 'd.json', uri: 'u', size: 1, modifiedAt: null },
        { fileName: 'c.json', uri: 'u', size: 1, modifiedAt: null },
        { fileName: 'b.json', uri: 'u', size: 1, modifiedAt: null },
        { fileName: 'a.json', uri: 'u', size: 1, modifiedAt: null },
      ]);

      const pruned = await pruneOldBackups('device', 3);

      expect(pruned).toBe(2);
      expect(mockDeleteLocal).toHaveBeenCalledWith('b.json');
      expect(mockDeleteLocal).toHaveBeenCalledWith('a.json');
      expect(mockDeleteLocal).not.toHaveBeenCalledWith('e.json');
    });

    it('prunes cloud archives by id', async () => {
      mockListCloud.mockResolvedValue([
        { id: '3', fileName: 'c.json', size: 1, modifiedAt: null },
        { id: '2', fileName: 'b.json', size: 1, modifiedAt: null },
        { id: '1', fileName: 'a.json', size: 1, modifiedAt: null },
      ]);

      const pruned = await pruneOldBackups('dropbox', 1);

      expect(pruned).toBe(2);
      expect(mockDeleteCloud).toHaveBeenCalledWith('dropbox', '2');
      expect(mockDeleteCloud).toHaveBeenCalledWith('dropbox', '1');
    });

    it('keeps everything when keepLast is zero or negative', async () => {
      await expect(pruneOldBackups('device', 0)).resolves.toBe(0);
      expect(mockListLocal).not.toHaveBeenCalled();
    });

    it('does not fail a good backup because cleanup afterwards failed', async () => {
      useSettingsStore({ enabled: true });
      mockSecureGet.mockResolvedValue('a b c d e f g h i j k l');
      mockListLocal.mockRejectedValue(new Error('listing died'));

      const result = await runBudgetAutoBackupIfDue();

      expect(result.status).toBe('ok');
    });
  });

  describe('overdue reminder', () => {
    it('nags once when a failing schedule has been due for days', async () => {
      const store = useSettingsStore({
        enabled: true,
        frequency: 'daily',
        lastRunAt: new Date('2026-08-01T00:00:00.000Z').toISOString(),
      });
      mockSecureGet.mockResolvedValue('a b c d e f g h i j k l');
      mockSave.mockResolvedValue({
        status: 'failed',
        destination: 'device',
        message: 'Could not write the backup file.',
        phrase: 'a b c d e f g h i j k l',
        fileName: 'f.json',
        location: null,
      });

      await runBudgetAutoBackupIfDue({ now: new Date('2026-08-11T00:00:00.000Z') });

      expect(mockSchedule).toHaveBeenCalledTimes(1);
      // The Expo-issued id is kept so a later success can cancel this exact one.
      expect(store.read().overdueNotificationId).toBe('notif-1');
    });

    it('does not stack a second nag while one is pending', async () => {
      useSettingsStore({
        enabled: true,
        frequency: 'daily',
        lastRunAt: new Date('2026-08-01T00:00:00.000Z').toISOString(),
        overdueNotificationId: 'already-pending',
      });
      mockSecureGet.mockResolvedValue('a b c d e f g h i j k l');
      mockSave.mockResolvedValue({
        status: 'failed',
        destination: 'device',
        message: 'nope',
        phrase: 'p',
        fileName: 'f',
        location: null,
      });

      await runBudgetAutoBackupIfDue({ now: new Date('2026-08-11T00:00:00.000Z') });

      expect(mockSchedule).not.toHaveBeenCalled();
    });

    it('stays quiet when a run fails but the schedule is only just overdue', async () => {
      useSettingsStore({
        enabled: true,
        frequency: 'daily',
        lastRunAt: new Date('2026-08-10T00:00:00.000Z').toISOString(),
      });
      mockSecureGet.mockResolvedValue('a b c d e f g h i j k l');
      mockSave.mockResolvedValue({
        status: 'failed',
        destination: 'device',
        message: 'nope',
        phrase: 'p',
        fileName: 'f',
        location: null,
      });

      await runBudgetAutoBackupIfDue({ now: new Date('2026-08-11T06:00:00.000Z') });

      expect(mockSchedule).not.toHaveBeenCalled();
    });

    it('cancels the pending nag once a run succeeds', async () => {
      const store = useSettingsStore({
        enabled: true,
        frequency: 'daily',
        lastRunAt: new Date('2026-08-01T00:00:00.000Z').toISOString(),
        overdueNotificationId: 'notif-old',
      });
      mockSecureGet.mockResolvedValue('a b c d e f g h i j k l');

      await runBudgetAutoBackupIfDue({ now: new Date('2026-08-11T00:00:00.000Z') });

      expect(mockCancel).toHaveBeenCalledWith('notif-old');
      expect(store.read().overdueNotificationId).toBeNull();
    });
  });

  describe('scheduler', () => {
    let addListenerSpy: jest.SpyInstance;
    let removeMock: jest.Mock;
    let fireAppState: ((status: string) => void) | undefined;

    beforeEach(() => {
      removeMock = jest.fn();
      fireAppState = undefined;
      addListenerSpy = jest
        .spyOn(AppState, 'addEventListener')
        .mockImplementation(((_event: string, handler: (s: string) => void) => {
          fireAppState = handler;
          return { remove: removeMock };
        }) as never);
    });

    afterEach(() => {
      addListenerSpy.mockRestore();
    });

    /** Let the fire-and-forget `void runBudgetAutoBackupIfDue()` settle. */
    const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

    it('runs the due check once on start', async () => {
      useSettingsStore({ enabled: true });
      mockSecureGet.mockResolvedValue('a b c d e f g h i j k l');

      startBudgetAutoBackupScheduler();
      await flush();

      expect(mockSave).toHaveBeenCalledTimes(1);
    });

    it('subscribes to foreground transitions exactly once across repeat calls', async () => {
      useSettingsStore();

      startBudgetAutoBackupScheduler();
      startBudgetAutoBackupScheduler();
      startBudgetAutoBackupScheduler();
      await flush();

      // A listener per call would queue one Argon2 seal per call on every
      // foreground event.
      expect(addListenerSpy).toHaveBeenCalledTimes(1);
      expect(addListenerSpy.mock.calls[0][0]).toBe('change');
    });

    it('runs a due backup when the app returns to the foreground', async () => {
      // Start with it off so the start-up check is a no-op and this asserts the
      // listener alone.
      useSettingsStore();
      startBudgetAutoBackupScheduler();
      await flush();
      expect(mockSave).not.toHaveBeenCalled();

      useSettingsStore({ enabled: true });
      mockSecureGet.mockResolvedValue('a b c d e f g h i j k l');

      fireAppState?.('active');
      await flush();

      expect(mockSave).toHaveBeenCalledTimes(1);
    });

    it('ignores background and inactive transitions', async () => {
      useSettingsStore({ enabled: true });
      mockSecureGet.mockResolvedValue('a b c d e f g h i j k l');
      startBudgetAutoBackupScheduler();
      await flush();
      mockSave.mockClear();

      fireAppState?.('background');
      fireAppState?.('inactive');
      await flush();

      expect(mockSave).not.toHaveBeenCalled();
    });

    it('throttles repeated foreground events so a slow seal is not queued twice', async () => {
      useSettingsStore();
      startBudgetAutoBackupScheduler();
      await flush();

      // Due on every check — only the throttle can stop the second run.
      useSettingsStore({ enabled: true });
      mockSecureGet.mockResolvedValue('a b c d e f g h i j k l');
      mockSave.mockResolvedValue({
        status: 'failed',
        destination: 'device',
        message: 'nope',
        phrase: 'p',
        fileName: 'f',
        location: null,
      });

      fireAppState?.('active');
      await flush();
      fireAppState?.('active');
      await flush();

      // OAuth and share sheets bounce AppState several times in a row.
      expect(mockSave).toHaveBeenCalledTimes(1);
    });

    it('checks again once the throttle window has passed', async () => {
      useSettingsStore();
      startBudgetAutoBackupScheduler();
      await flush();

      useSettingsStore({ enabled: true });
      mockSecureGet.mockResolvedValue('a b c d e f g h i j k l');
      mockSave.mockResolvedValue({
        status: 'failed',
        destination: 'device',
        message: 'nope',
        phrase: 'p',
        fileName: 'f',
        location: null,
      });

      const realNow = Date.now();
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(realNow);

      fireAppState?.('active');
      await flush();

      nowSpy.mockReturnValue(realNow + 61_000);
      fireAppState?.('active');
      await flush();
      nowSpy.mockRestore();

      expect(mockSave).toHaveBeenCalledTimes(2);
    });

    it('removes the listener on stop so a signed-out session stops backing up', async () => {
      useSettingsStore();
      startBudgetAutoBackupScheduler();
      await flush();

      stopBudgetAutoBackupScheduler();

      expect(removeMock).toHaveBeenCalledTimes(1);
    });

    it('re-subscribes after a stop', async () => {
      useSettingsStore();
      startBudgetAutoBackupScheduler();
      await flush();
      stopBudgetAutoBackupScheduler();

      startBudgetAutoBackupScheduler();
      await flush();

      expect(addListenerSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('updateBudgetAutoBackupSettings', () => {
    it('merges a patch over what is stored', async () => {
      const store = useSettingsStore({ enabled: true, frequency: 'daily' });

      await updateBudgetAutoBackupSettings({ keepLast: 9 });

      expect(store.read()).toMatchObject({ enabled: true, frequency: 'daily', keepLast: 9 });
    });
  });
});
