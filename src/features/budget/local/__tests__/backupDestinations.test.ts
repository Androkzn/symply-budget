import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { ENV } from '@config/env';
import { googleDriveService } from '@services/cloud-storage/google-drive';
import { CloudReauthRequiredError } from '@services/cloud-storage/types';

import {
  BUDGET_BACKUP_DEVICE_FOLDER,
  BUDGET_BACKUP_DRIVE_FOLDER,
  BUDGET_BACKUP_RETENTION_DEFAULT,
  autoBackupSupports,
  backupFileNameFor,
  budgetBackupDirectory,
  chooseCloudBackupFolder,
  chooseDeviceBackupFolder,
  disconnectCloudProvider,
  getBudgetBackupRetention,
  getCloudAccount,
  switchCloudAccount,
  deleteLocalBudgetBackup,
  describeCloudFolder,
  forgetDriveFolder,
  getRememberedDriveFolder,
  rememberedFolderSource,
  listDriveBudgetBackups,
  listLocalBudgetBackups,
  readDriveBudgetBackup,
  readLocalBudgetBackup,
  rememberDriveFolder,
  saveBudgetBackupTo,
  timestampedBackupFileName,
} from '../backup/backupDestinations';
import {
  closeLocalBudgetSession,
  openLocalBudgetSessionForTests,
  resetLocalBudgetSession,
} from '../engine';

jest.mock('expo-file-system/legacy', () => ({
  writeAsStringAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  readDirectoryAsync: jest.fn(),
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///docs/',
  EncodingType: { UTF8: 'utf8' },
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: jest.fn(),
    createFileAsync: jest.fn(),
    readDirectoryAsync: jest.fn(),
    makeDirectoryAsync: jest.fn(),
    deleteAsync: jest.fn(),
  },
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('@services/cloud-storage/google-drive', () => ({
  googleDriveService: {
    provider: 'google-drive',
    isAuthenticated: jest.fn(),
    authenticate: jest.fn(),
    logout: jest.fn(),
    getAuthState: jest.fn(),
    uploadFile: jest.fn(),
    ensureFolder: jest.fn(),
    listFiles: jest.fn(),
    downloadFile: jest.fn(),
    listFolders: jest.fn(),
    createFolder: jest.fn(),
    folderExists: jest.fn(),
    canBrowseFolders: jest.fn(),
  },
}));

const mockWrite = FileSystem.writeAsStringAsync as jest.Mock;
const mockRead = FileSystem.readAsStringAsync as jest.Mock;
const mockDelete = FileSystem.deleteAsync as jest.Mock;
const mockGetInfo = FileSystem.getInfoAsync as jest.Mock;
const mockMakeDir = FileSystem.makeDirectoryAsync as jest.Mock;
const mockReadDir = FileSystem.readDirectoryAsync as jest.Mock;
const mockSaf = FileSystem.StorageAccessFramework as unknown as {
  requestDirectoryPermissionsAsync: jest.Mock;
  createFileAsync: jest.Mock;
  readDirectoryAsync: jest.Mock;
  makeDirectoryAsync: jest.Mock;
  deleteAsync: jest.Mock;
};
const mockIsAvailable = Sharing.isAvailableAsync as jest.Mock;
const mockShare = Sharing.shareAsync as jest.Mock;
const mockStorageGet = AsyncStorage.getItem as jest.Mock;

/**
 * Point one storage key at one value, leaving every other key null.
 *
 * A blanket `mockStorageGet.mockResolvedValue(x)` answers EVERY key with `x`,
 * which stopped being harmless once the retention mode moved into AsyncStorage
 * beside the folder pointer: a test setting up a folder was also feeding that
 * JSON to `getBudgetBackupRetention`.
 */
function whenStorageHas(values: Record<string, string | null>): void {
  mockStorageGet.mockImplementation(async (key: string) => values[key] ?? null);
}

const DRIVE_FOLDER_KEY = 'budget.backup.driveFolder';
const RETENTION_KEY = 'budget.backup.retention';
const mockStorageSet = AsyncStorage.setItem as jest.Mock;
const mockStorageRemove = AsyncStorage.removeItem as jest.Mock;
const drive = googleDriveService as jest.Mocked<typeof googleDriveService>;

function setPlatform(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
}

describe('backupDestinations', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    setPlatform('ios');
    mockWrite.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
    mockMakeDir.mockResolvedValue(undefined);
    mockIsAvailable.mockResolvedValue(true);
    mockShare.mockResolvedValue(undefined);
    whenStorageHas({});
    mockStorageSet.mockResolvedValue(undefined);
    mockStorageRemove.mockResolvedValue(undefined);
    mockGetInfo.mockResolvedValue({ exists: true, size: 2048, modificationTime: 1_770_000_000 });
    (drive.isAuthenticated as jest.Mock).mockResolvedValue(true);
    (drive.ensureFolder as jest.Mock).mockResolvedValue('folder-1');
    (drive.folderExists as jest.Mock).mockResolvedValue(true);
    (drive.canBrowseFolders as jest.Mock).mockResolvedValue(true);
    (drive.logout as jest.Mock).mockResolvedValue(undefined);
    (drive.getAuthState as jest.Mock).mockResolvedValue(null);
    (drive.listFiles as jest.Mock).mockResolvedValue([]);
    (drive.uploadFile as jest.Mock).mockResolvedValue({
      id: 'file-1',
      name: 'backup.json',
      mimeType: 'application/json',
      size: 2048,
    });
    await openLocalBudgetSessionForTests({ userId: 'user-backup-dest' });
  });

  afterEach(async () => {
    // `reset`, not `close`: the local-first store is module-level and SURVIVES
    // closeLocalBudgetSession (engine.ts:1486 vs 1495), so a plain close reopens
    // the same in-memory device next case and every household this file creates
    // accumulates on it. reset = close + clearLocalBudgetPersistence, matching
    // multiHousehold.test.ts.
    //
    // This is a correctness/isolation change, NOT a speed one — measured, it
    // moved the file only 290s -> 277s. The runtime here is Argon2id, which the
    // backup path runs unmocked and which is deliberately slow (autoBackup.ts:47).
    // Don't re-chase this file's duration as if it were state accumulation.
    await resetLocalBudgetSession();
  });

  /**
   * "Replace the last one" vs "keep every copy" — the choice a member makes
   * with one checkbox, and the thing most likely to quietly stop working,
   * because every destination has to implement "overwrite" in its own terms.
   */
  describe('retention mode', () => {
    it('defaults to replacing, so a folder holds one file and not a growing pile', async () => {
      await expect(getBudgetBackupRetention()).resolves.toBe('replace');
      expect(BUDGET_BACKUP_RETENTION_DEFAULT).toBe('replace');
    });

    it('reads back a stored choice, and ignores a value it does not recognise', async () => {
      whenStorageHas({ [RETENTION_KEY]: 'dated' });
      await expect(getBudgetBackupRetention()).resolves.toBe('dated');

      whenStorageHas({ [RETENTION_KEY]: 'whatever' });
      await expect(getBudgetBackupRetention()).resolves.toBe('replace');
    });

    it('names a replace-mode archive after the household only — no timestamp', () => {
      const household = { householdId: 'hh_local_1', householdName: 'Sweet Home' };
      const name = backupFileNameFor('replace', household, new Date('2026-08-11T09:15:00.000Z'));

      expect(name).toBe('symply-budget-backup-sweet-home--hh_local_1.json');
      // Same input, later clock — still the same file, which is what makes the
      // next run land on top of this one.
      expect(backupFileNameFor('replace', household, new Date('2026-09-01T21:40:00.000Z'))).toBe(
        name,
      );
    });

    it('keeps two households apart even in replace mode', () => {
      const a = backupFileNameFor('replace', {
        householdId: 'hh_local_1',
        householdName: 'Home',
      });
      const b = backupFileNameFor('replace', {
        householdId: 'hh_local_2',
        householdName: 'Home',
      });
      // One file per HOUSEHOLD, not one file total — same name would mean the
      // second budget silently overwrote the first.
      expect(a).not.toBe(b);
    });

    it('still timestamps in dated mode, and leads with the stamp', () => {
      // Local components, not a UTC instant: the stamp is the member's own
      // clock, so an instant would make this assertion depend on the runner's
      // time zone.
      const name = backupFileNameFor(
        'dated',
        { householdId: 'hh_local_1', householdName: 'Home' },
        new Date(2026, 7, 11, 9, 15),
      );
      expect(name.startsWith('2026-08-11-0915-')).toBe(true);
      expect(name).toContain('symply-budget-backup');
    });

    it('writes over the same on-device path every time in replace mode', async () => {
      const first = await saveBudgetBackupTo('device', { retention: 'replace' });
      const second = await saveBudgetBackupTo('device', { retention: 'replace' });

      expect(first.fileName).toBe(second.fileName);
      expect(mockWrite.mock.calls[0][0]).toBe(mockWrite.mock.calls[1][0]);
    });

    it('replaces the Drive file in place rather than adding a second of that name', async () => {
      (drive.listFiles as jest.Mock).mockResolvedValue([
        { id: 'existing-id', name: 'symply-budget-backup-sweet-home--hh_local_1.json', size: 10 },
      ]);

      const result = await saveBudgetBackupTo('google-drive', {
        retention: 'replace',
        fileName: 'symply-budget-backup-sweet-home--hh_local_1.json',
      });

      expect(result.status).toBe('saved');
      // Drive does not treat a name as unique — without the id this would leave
      // two files of the same name and "replace" would be a lie.
      expect(drive.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({ replaceFileId: 'existing-id' }),
      );
    });

    it('creates a new Drive file when there is nothing of that name yet', async () => {
      (drive.listFiles as jest.Mock).mockResolvedValue([]);

      await saveBudgetBackupTo('google-drive', {
        retention: 'replace',
        fileName: 'symply-budget-backup-sweet-home--hh_local_1.json',
      });

      expect(drive.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({ replaceFileId: undefined }),
      );
    });

    it('never looks for a file to replace in dated mode', async () => {
      await saveBudgetBackupTo('google-drive', { retention: 'dated', fileName: 'backup-d.json' });

      expect(drive.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({ replaceFileId: undefined }),
      );
    });

    it('still uploads when the look-for-existing listing fails', async () => {
      (drive.listFiles as jest.Mock).mockRejectedValue(new Error('offline'));

      const result = await saveBudgetBackupTo('google-drive', {
        retention: 'replace',
        fileName: 'backup-e.json',
      });

      // An extra copy is a tidiness problem; losing the backup is a data
      // problem. The upload must win.
      expect(result.status).toBe('saved');
      expect(drive.uploadFile).toHaveBeenCalled();
    });
  });

  describe('a folder on the phone (Android)', () => {
    const GRANT = 'content://com.android.externalstorage.documents/tree/primary%3ADownload';
    const SUBFOLDER = `${GRANT}/document/primary%3ADownload%2FSymply%20Budget%20Backups`;

    beforeEach(() => {
      setPlatform('android');
      mockSaf.requestDirectoryPermissionsAsync.mockResolvedValue({
        granted: true,
        directoryUri: GRANT,
      });
      mockSaf.readDirectoryAsync.mockResolvedValue([]);
      mockSaf.makeDirectoryAsync.mockResolvedValue(SUBFOLDER);
      mockSaf.createFileAsync.mockResolvedValue(`${SUBFOLDER}%2Fbackup.json`);
    });

    it('makes its own sub-folder inside whatever the member picked', async () => {
      const folder = await chooseDeviceBackupFolder();

      // Archives must not land loose among the member's own files — that is
      // where a prune that DELETES would be standing next to them.
      expect(mockSaf.makeDirectoryAsync).toHaveBeenCalledWith(GRANT, BUDGET_BACKUP_DEVICE_FOLDER);
      expect(folder?.backupsUri).toBe(SUBFOLDER);
      expect(folder?.label).toContain(BUDGET_BACKUP_DEVICE_FOLDER);
    });

    it('reuses the sub-folder it already made instead of making a second', async () => {
      mockSaf.readDirectoryAsync.mockResolvedValue([SUBFOLDER]);

      const folder = await chooseDeviceBackupFolder();

      expect(mockSaf.makeDirectoryAsync).not.toHaveBeenCalled();
      expect(folder?.backupsUri).toBe(SUBFOLDER);
    });

    it('returns null — not a folder — when the picker is dismissed', async () => {
      mockSaf.requestDirectoryPermissionsAsync.mockResolvedValue({ granted: false });

      await expect(chooseDeviceBackupFolder()).resolves.toBeNull();
      expect(mockStorageSet).not.toHaveBeenCalled();
    });

    it('remembers the grant so later backups need no picker', async () => {
      await chooseDeviceBackupFolder();

      expect(mockStorageSet).toHaveBeenCalledWith(
        'budget.backup.deviceFolder',
        expect.stringContaining(SUBFOLDER),
      );
    });

    it('writes into the remembered folder without asking again', async () => {
      whenStorageHas({
        'budget.backup.deviceFolder': JSON.stringify({
          rootUri: GRANT,
          backupsUri: SUBFOLDER,
          label: 'Download/Symply Budget Backups',
        }),
      });

      const result = await saveBudgetBackupTo('files', { fileName: 'backup-f.json' });

      expect(result.status).toBe('saved');
      expect(mockSaf.requestDirectoryPermissionsAsync).not.toHaveBeenCalled();
      expect(mockSaf.createFileAsync).toHaveBeenCalledWith(
        SUBFOLDER,
        // SAF appends the extension from the mime type — ours is stripped so
        // the file is not `…json.json`.
        'backup-f',
        'application/json',
      );
    });

    it('overwrites the existing archive in replace mode instead of making name (1)', async () => {
      const existing = `${SUBFOLDER}%2Fsymply-budget-backup-home--hh_local_1.json`;
      whenStorageHas({
        'budget.backup.deviceFolder': JSON.stringify({
          rootUri: GRANT,
          backupsUri: SUBFOLDER,
          label: 'Download/Symply Budget Backups',
        }),
      });
      mockSaf.readDirectoryAsync.mockResolvedValue([existing]);

      await saveBudgetBackupTo('files', {
        retention: 'replace',
        fileName: 'symply-budget-backup-home--hh_local_1.json',
      });

      // SAF's createFileAsync does not overwrite; it side-steps with a numbered
      // name, which would turn "one file" into the pile it was chosen to avoid.
      expect(mockSaf.createFileAsync).not.toHaveBeenCalled();
      expect(mockWrite).toHaveBeenCalledWith(existing, expect.any(String), expect.anything());
    });

    it('asks for a folder rather than failing, when a person is there to answer', async () => {
      const result = await saveBudgetBackupTo('files', { fileName: 'backup-g2.json' });

      expect(mockSaf.requestDirectoryPermissionsAsync).toHaveBeenCalled();
      expect(result.status).toBe('saved');
    });

    it('never throws a folder picker at an unattended run', async () => {
      const result = await saveBudgetBackupTo('files', {
        fileName: 'backup-h2.json',
        allowInteractiveAuth: false,
      });

      expect(mockSaf.requestDirectoryPermissionsAsync).not.toHaveBeenCalled();
      expect(result.status).toBe('needs_auth');
      expect(result.message).toMatch(/pick a folder/i);
    });

    it('drops a grant the member revoked, so the next attempt re-asks', async () => {
      whenStorageHas({
        'budget.backup.deviceFolder': JSON.stringify({
          rootUri: GRANT,
          backupsUri: SUBFOLDER,
          label: 'Download/Symply Budget Backups',
        }),
      });
      // A revoked SAF grant throws on read rather than reporting itself gone.
      mockSaf.readDirectoryAsync.mockRejectedValueOnce(new Error('permission denied'));

      await saveBudgetBackupTo('files', {
        fileName: 'backup-i2.json',
        allowInteractiveAuth: false,
      });

      expect(mockStorageRemove).toHaveBeenCalledWith('budget.backup.deviceFolder');
    });
  });

  describe('which destinations can run unattended', () => {
    it('allows the two that need no interaction anywhere', () => {
      expect(autoBackupSupports('device')).toBe(true);
      expect(autoBackupSupports('google-drive')).toBe(true);
      expect(autoBackupSupports('dropbox')).toBe(true);
    });

    it('never allows the share sheet — nobody is there to answer it', () => {
      expect(autoBackupSupports('share')).toBe(false);
    });

    it('allows a phone folder on Android, where the grant persists, but not on iOS', () => {
      setPlatform('android');
      expect(autoBackupSupports('files')).toBe(true);

      setPlatform('ios');
      // iOS can only reach an arbitrary folder through the share sheet.
      expect(autoBackupSupports('files')).toBe(false);
    });
  });

  describe('signing out of a cloud account', () => {
    it('forgets the folder as well as the token', async () => {
      await disconnectCloudProvider('google-drive');

      expect(drive.logout).toHaveBeenCalled();
      // A folder id means nothing inside a different account — carried over, the
      // next backup would land somewhere nobody chose.
      expect(mockStorageRemove).toHaveBeenCalledWith(DRIVE_FOLDER_KEY);
    });

    it('still clears local state when the provider refuses to revoke', async () => {
      (drive.logout as jest.Mock).mockRejectedValue(new Error('network'));

      await expect(disconnectCloudProvider('google-drive')).resolves.toBeUndefined();
      expect(mockStorageRemove).toHaveBeenCalledWith(DRIVE_FOLDER_KEY);
    });

    it('signs out before signing in when switching accounts', async () => {
      const order: string[] = [];
      (drive.logout as jest.Mock).mockImplementation(async () => void order.push('logout'));
      (drive.authenticate as jest.Mock).mockImplementation(async () => {
        order.push('authenticate');
        return { isAuthenticated: true };
      });

      await switchCloudAccount('google-drive');

      expect(order).toEqual(['logout', 'authenticate']);
    });

    it('reports the signed-in account, and nothing when signed out', async () => {
      (drive.getAuthState as jest.Mock).mockResolvedValue({
        isAuthenticated: true,
        accessToken: 't',
        refreshToken: null,
        expiresAt: null,
        userEmail: 'someone@example.com',
        userName: 'Someone',
      });
      await expect(getCloudAccount('google-drive')).resolves.toEqual({
        email: 'someone@example.com',
        name: 'Someone',
      });

      (drive.isAuthenticated as jest.Mock).mockResolvedValue(false);
      await expect(getCloudAccount('google-drive')).resolves.toBeNull();
    });
  });

  describe('file naming', () => {
    it('timestamps the name so two backups in one day do not collide', () => {
      const morning = timestampedBackupFileName(new Date(2026, 7, 11, 9, 15));
      const evening = timestampedBackupFileName(new Date(2026, 7, 11, 21, 40));

      expect(morning).toBe('2026-08-11-0915-symply-budget-backup.json');
      expect(evening).toBe('2026-08-11-2140-symply-budget-backup.json');
      expect(morning).not.toBe(evening);
    });

    /**
     * The date is the first thing in the name, ahead of the prefix every
     * archive shares — that is what makes a backup folder sort and read as a
     * dated list in Drive, Files and the app's own list alike.
     */
    it('opens with the date, so a name sort is a date sort', () => {
      const name = timestampedBackupFileName(new Date(2026, 7, 11, 9, 15), {
        householdId: 'hh_local_1',
        householdName: 'Sweet Home',
      });

      expect(name.startsWith('2026-08-11-0915-symply-budget-backup-')).toBe(true);
      // The household half still trails the stamp, so ordering by name stays a
      // recency order across households rather than grouping by name first.
      expect(name.indexOf('sweet-home')).toBeGreaterThan(name.indexOf('2026-08-11-0915'));
    });

    /**
     * This used to slice `toISOString()`, so a backup sealed at 15:22 in
     * California was named `2226` — and `formatBackupFileName` parses those
     * parts as local, so the list read it back as "22:26". Seven hours wrong on
     * the one date a member has to recognise.
     */
    it('stamps the wall clock the member was standing in, not UTC', () => {
      const at = new Date(2026, 7, 11, 15, 22);
      const name = timestampedBackupFileName(at);

      expect(name).toBe('2026-08-11-1522-symply-budget-backup.json');
    });
  });

  describe('device destination', () => {
    it('writes the sealed archive into the app Documents backups folder', async () => {
      mockGetInfo.mockResolvedValueOnce({ exists: false });

      const result = await saveBudgetBackupTo('device', { fileName: 'backup-a.json' });

      expect(result.status).toBe('saved');
      expect(result.phrase?.split(' ')).toHaveLength(12);
      expect(mockMakeDir).toHaveBeenCalledWith(budgetBackupDirectory(), { intermediates: true });
      const [uri, contents] = mockWrite.mock.calls[0];
      expect(uri).toBe('file:///docs/budget-backups/backup-a.json');
      // Sealed, not plaintext: the ledger's own field names must not be readable.
      expect(contents).toEqual(expect.any(String));
      expect(contents).not.toContain('"expenses"');
      expect(result.location).toBe(uri);
    });

    it('reuses an existing backups folder instead of recreating it', async () => {
      await saveBudgetBackupTo('device', { fileName: 'backup-b.json' });
      expect(mockMakeDir).not.toHaveBeenCalled();
    });

    it('hands back an openable uri and the Files trail, named for this brand', async () => {
      const result = await saveBudgetBackupTo('device', { fileName: 'backup-b2.json' });

      // The uri is what makes the Open button possible at all — without it the
      // card falls back to describing a path, which is what this replaced.
      expect(result.savedTo?.uri).toBe('file:///docs/budget-backups/backup-b2.json');
      // The folder Files shows is CFBundleDisplayName, which is per brand.
      // Hardcoding "Budget" here sent people to a folder that does not exist.
      expect(result.savedTo?.breadcrumb).toEqual([
        'Files',
        'On My iPhone',
        ENV.APP_NAME,
        'budget-backups',
      ]);
      expect(result.message).not.toContain('→');
    });

    it('offers no Files trail on Android, where the folder is app-private', async () => {
      setPlatform('android');

      const result = await saveBudgetBackupTo('device', { fileName: 'backup-b3.json' });

      expect(result.savedTo?.breadcrumb).toBeNull();
      // Still openable — the Open button shares it instead of revealing it.
      expect(result.savedTo?.uri).toBe('file:///docs/budget-backups/backup-b3.json');
      expect(result.message).not.toContain('iPhone');
    });

    it('lists device backups newest first and ignores non-archive files', async () => {
      mockReadDir.mockResolvedValue([
        'symply-budget-backup-2026-08-01-0900.json',
        'notes.txt',
        'symply-budget-backup-2026-08-11-0915.json',
      ]);

      const entries = await listLocalBudgetBackups();

      expect(entries.map((entry) => entry.fileName)).toEqual([
        'symply-budget-backup-2026-08-11-0915.json',
        'symply-budget-backup-2026-08-01-0900.json',
      ]);
      expect(entries[0].size).toBe(2048);
      expect(entries[0].modifiedAt).toBe(new Date(1_770_000_000 * 1000).toISOString());
    });

    /**
     * A device upgrading into the date-first names holds both shapes at once.
     * A raw name compare would file every legacy archive (opening with `s`)
     * above every new one (opening with a digit), so the backup made a minute
     * ago would sit at the BOTTOM of the list until the last old file aged out.
     * The comparator sorts on the stamp instead, which both shapes carry.
     */
    it('interleaves legacy and date-first names by date, not by shape', async () => {
      mockReadDir.mockResolvedValue([
        'symply-budget-backup-2026-08-11-0915.json',
        '2026-08-23-1522-symply-budget-backup-home--hh_local_1.json',
        'symply-budget-backup-2026-08-20-0800.json',
        '2026-08-02-0700-symply-budget-backup-home--hh_local_1.json',
      ]);

      const entries = await listLocalBudgetBackups();

      expect(entries.map((entry) => entry.fileName)).toEqual([
        '2026-08-23-1522-symply-budget-backup-home--hh_local_1.json',
        'symply-budget-backup-2026-08-20-0800.json',
        'symply-budget-backup-2026-08-11-0915.json',
        '2026-08-02-0700-symply-budget-backup-home--hh_local_1.json',
      ]);
    });

    it('returns an empty list when nothing has been backed up yet', async () => {
      mockGetInfo.mockResolvedValueOnce({ exists: false });
      await expect(listLocalBudgetBackups()).resolves.toEqual([]);
      expect(mockReadDir).not.toHaveBeenCalled();
    });

    it('reads and deletes a device backup by file name', async () => {
      mockRead.mockResolvedValue('{"meta":{}}');

      await expect(readLocalBudgetBackup('backup-a.json')).resolves.toBe('{"meta":{}}');
      expect(mockRead).toHaveBeenCalledWith('file:///docs/budget-backups/backup-a.json');

      await deleteLocalBudgetBackup('backup-a.json');
      expect(mockDelete).toHaveBeenCalledWith('file:///docs/budget-backups/backup-a.json', {
        idempotent: true,
      });
    });
  });

  describe('files destination', () => {
    it('uses the iOS share sheet (Save to Files) and cleans up the temp copy', async () => {
      const result = await saveBudgetBackupTo('files', { fileName: 'backup-c.json' });

      expect(result.status).toBe('shared');
      expect(mockShare).toHaveBeenCalledWith(
        'file:///cache/backup-c.json',
        expect.objectContaining({ UTI: 'public.json', dialogTitle: 'Save backup to Files' }),
      );
      expect(mockDelete).toHaveBeenCalledWith('file:///cache/backup-c.json', { idempotent: true });
    });

    it('reports unsupported rather than throwing when sharing is unavailable', async () => {
      mockIsAvailable.mockResolvedValue(false);

      const result = await saveBudgetBackupTo('files', { fileName: 'backup-d.json' });

      expect(result.status).toBe('unsupported');
      // The phrase still comes back — the archive is already sealed under it.
      expect(result.phrase?.split(' ')).toHaveLength(12);
      expect(mockShare).not.toHaveBeenCalled();
    });

    it('uses the Android folder picker and strips the duplicate extension', async () => {
      setPlatform('android');
      const SUB = 'content://tree/primary/Symply%20Budget%20Backups';
      mockSaf.requestDirectoryPermissionsAsync.mockResolvedValue({
        granted: true,
        directoryUri: 'content://tree/primary',
      });
      mockSaf.readDirectoryAsync.mockResolvedValue([]);
      mockSaf.makeDirectoryAsync.mockResolvedValue(SUB);
      mockSaf.createFileAsync.mockResolvedValue(`${SUB}/backup-e.json`);

      const result = await saveBudgetBackupTo('files', { fileName: 'backup-e.json' });

      expect(result.status).toBe('saved');
      // The archive lands in the app's OWN sub-folder, not loose in the folder
      // the member picked — that folder is full of their files, and this
      // listing feeds a prune that deletes.
      expect(mockSaf.createFileAsync).toHaveBeenCalledWith(
        SUB,
        // SAF appends the extension from the mime type; ours is stripped so the
        // file is not `…json.json`.
        'backup-e',
        'application/json',
      );
      expect(mockWrite).toHaveBeenCalledWith(`${SUB}/backup-e.json`, expect.any(String), {
        encoding: 'utf8',
      });
      expect(mockShare).not.toHaveBeenCalled();
    });

    it('reports cancelled when the Android folder picker is dismissed', async () => {
      setPlatform('android');
      mockSaf.requestDirectoryPermissionsAsync.mockResolvedValue({ granted: false });

      const result = await saveBudgetBackupTo('files', { fileName: 'backup-f.json' });

      expect(result.status).toBe('cancelled');
      expect(mockSaf.createFileAsync).not.toHaveBeenCalled();
    });
  });

  describe('google drive destination', () => {
    it('uploads into the remembered folder and reports where it landed', async () => {
      const result = await saveBudgetBackupTo('google-drive', { fileName: 'backup-g.json' });

      expect(result.status).toBe('saved');
      expect(drive.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'backup-g.json',
          mimeType: 'application/json',
          folderId: 'folder-1',
        }),
      );
      // The folder is named in the breadcrumb the location card renders, not
      // in the toast text — see backupFileAccess.ts.
      expect(result.savedTo?.breadcrumb).toEqual(['Google Drive', BUDGET_BACKUP_DRIVE_FOLDER]);
      expect(result.savedTo?.uri).toBeNull();
      expect(result.location).toBe('file-1');
    });

    it('remembers the folder id on first upload so later ones reuse it', async () => {
      await saveBudgetBackupTo('google-drive', { fileName: 'backup-h.json' });

      expect(drive.ensureFolder).toHaveBeenCalledWith(BUDGET_BACKUP_DRIVE_FOLDER, null);
      expect(mockStorageSet).toHaveBeenCalledWith(
        'budget.backup.driveFolder',
        // `source` marks this as the app's own folder, which is what licenses
        // recreating it by name later — a folder the member picked is not.
        JSON.stringify({ id: 'folder-1', name: BUDGET_BACKUP_DRIVE_FOLDER, source: 'default' }),
      );
    });

    it('passes the remembered id back so a renamed folder keeps being used', async () => {
      whenStorageHas({ [DRIVE_FOLDER_KEY]: JSON.stringify({ id: 'folder-remembered', name: 'My Budget Vault' }) });
      (drive.ensureFolder as jest.Mock).mockResolvedValue('folder-remembered');

      const result = await saveBudgetBackupTo('google-drive', { fileName: 'backup-i.json' });

      expect(drive.ensureFolder).toHaveBeenCalledWith('My Budget Vault', 'folder-remembered');
      expect(result.savedTo?.breadcrumb).toContain('My Budget Vault');
      // Unchanged pointer — no pointless rewrite of the stored value.
      expect(mockStorageSet).not.toHaveBeenCalled();
    });

    it('re-persists the pointer when the remembered folder is gone', async () => {
      whenStorageHas({ [DRIVE_FOLDER_KEY]: JSON.stringify({ id: 'folder-stale', name: BUDGET_BACKUP_DRIVE_FOLDER }) });
      (drive.ensureFolder as jest.Mock).mockResolvedValue('folder-fresh');

      await saveBudgetBackupTo('google-drive', { fileName: 'backup-j.json' });

      expect(mockStorageSet).toHaveBeenCalledWith(
        'budget.backup.driveFolder',
        JSON.stringify({ id: 'folder-fresh', name: BUDGET_BACKUP_DRIVE_FOLDER, source: 'default' }),
      );
    });

    it('uploads into the folder the member picked, without re-resolving it by name', async () => {
      whenStorageHas({ [DRIVE_FOLDER_KEY]: JSON.stringify({
          id: 'folder-picked',
          name: 'Finance',
          path: ['Documents', '2026', 'Finance'],
          source: 'picked',
        }) });
      (drive.folderExists as jest.Mock).mockResolvedValue(true);

      const result = await saveBudgetBackupTo('google-drive', { fileName: 'backup-p.json' });

      expect(result.status).toBe('saved');
      expect(drive.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({ folderId: 'folder-picked' }),
      );
      // A name lookup could resolve to a DIFFERENT "Finance" elsewhere in the
      // Drive, so a live pick is never put through one.
      expect(drive.ensureFolder).not.toHaveBeenCalled();
      // The full trail, so the card can say where to look for the file.
      expect(result.savedTo?.breadcrumb).toEqual([
        'Google Drive',
        'Documents',
        '2026',
        'Finance',
      ]);
      // Nothing changed — the pointer is not rewritten on every upload.
      expect(mockStorageSet).not.toHaveBeenCalled();
    });

    it('falls back to the app folder — never a lookalike — when the picked one is gone', async () => {
      whenStorageHas({ [DRIVE_FOLDER_KEY]: JSON.stringify({ id: 'folder-deleted', name: 'Finance', source: 'picked' }) });
      (drive.folderExists as jest.Mock).mockResolvedValue(false);

      const result = await saveBudgetBackupTo('google-drive', { fileName: 'backup-q.json' });

      expect(result.status).toBe('saved');
      // The dangerous outcome this guards: recreating "Finance" by name would
      // put it at the account root, nowhere near the folder they chose.
      expect(drive.ensureFolder).not.toHaveBeenCalledWith('Finance', expect.anything());
      expect(drive.ensureFolder).toHaveBeenCalledWith(BUDGET_BACKUP_DRIVE_FOLDER, null);
      expect(drive.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({ folderId: 'folder-1' }),
      );
      expect(mockStorageRemove).toHaveBeenCalledWith('budget.backup.driveFolder');
    });

    it('keeps a pick when the provider cannot probe whether it still exists', async () => {
      whenStorageHas({ [DRIVE_FOLDER_KEY]: JSON.stringify({ id: 'folder-picked', name: 'Finance', source: 'picked' }) });
      // A capability gap is not evidence the folder went away, and throwing a
      // deliberate choice away over one would be the worse guess.
      const probe = drive.folderExists;
      delete (drive as { folderExists?: unknown }).folderExists;
      try {
        await saveBudgetBackupTo('google-drive', { fileName: 'backup-r.json' });
        expect(drive.uploadFile).toHaveBeenCalledWith(
          expect.objectContaining({ folderId: 'folder-picked' }),
        );
      } finally {
        (drive as { folderExists?: unknown }).folderExists = probe;
      }
    });

    /**
     * The regression behind "my backups stopped appearing in the folder I
     * chose": the probe failed for its own reasons during a scheduled run, the
     * pick was dropped as if Drive had said the folder was gone, and every
     * later backup went to a fresh app folder at the account root while the
     * member kept checking the one they had picked.
     */
    it('keeps a pick when the probe fails for a reason that says nothing about the folder', async () => {
      whenStorageHas({ [DRIVE_FOLDER_KEY]: JSON.stringify({ id: 'folder-picked', name: 'Finance', source: 'picked' }) });
      (drive.folderExists as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));

      const result = await saveBudgetBackupTo('google-drive', { fileName: 'backup-s.json' });

      expect(result.status).toBe('saved');
      expect(drive.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({ folderId: 'folder-picked' }),
      );
      expect(drive.ensureFolder).not.toHaveBeenCalled();
      // The pointer survives: the write, not the probe, decides whether the
      // folder is really gone.
      expect(mockStorageRemove).not.toHaveBeenCalled();
    });

    it('reports needs_auth from the probe without dropping the pick', async () => {
      whenStorageHas({ [DRIVE_FOLDER_KEY]: JSON.stringify({ id: 'folder-picked', name: 'Finance', source: 'picked' }) });
      (drive.folderExists as jest.Mock).mockRejectedValue(new CloudReauthRequiredError());

      const result = await saveBudgetBackupTo('google-drive', { fileName: 'backup-t.json' });

      expect(result.status).toBe('needs_auth');
      expect(drive.uploadFile).not.toHaveBeenCalled();
      expect(drive.ensureFolder).not.toHaveBeenCalled();
      expect(mockStorageRemove).not.toHaveBeenCalled();
    });

    it('signs in first when Drive is not connected yet', async () => {
      (drive.isAuthenticated as jest.Mock).mockResolvedValue(false);
      (drive.authenticate as jest.Mock).mockResolvedValue({ isAuthenticated: true });

      const result = await saveBudgetBackupTo('google-drive', { fileName: 'backup-k.json' });

      expect(drive.authenticate).toHaveBeenCalled();
      expect(result.status).toBe('saved');
    });

    it('reports cancelled — not failed — when Google sign-in is dismissed', async () => {
      (drive.isAuthenticated as jest.Mock).mockResolvedValue(false);
      (drive.authenticate as jest.Mock).mockRejectedValue(
        new Error('Authentication was cancelled'),
      );

      const result = await saveBudgetBackupTo('google-drive', { fileName: 'backup-l.json' });

      expect(result.status).toBe('cancelled');
      expect(drive.uploadFile).not.toHaveBeenCalled();
    });

    it('asks for reconnect when the stored grant lost its scope', async () => {
      (drive.uploadFile as jest.Mock).mockRejectedValue(
        new CloudReauthRequiredError('Your Google Drive access needs to be renewed.'),
      );

      const result = await saveBudgetBackupTo('google-drive', { fileName: 'backup-m.json' });

      expect(result.status).toBe('needs_auth');
      expect(result.message).toContain('renewed');
    });

    it('never leaks a raw Drive error into the user-facing message', async () => {
      (drive.uploadFile as jest.Mock).mockRejectedValue(
        new Error('Failed to upload file: {"error":{"code":403,"message":"quotaExceeded"}}'),
      );

      const result = await saveBudgetBackupTo('google-drive', { fileName: 'backup-n.json' });

      expect(result.status).toBe('failed');
      expect(result.message).toBe('Could not upload the backup to Google Drive.');
      expect(result.message).not.toContain('quotaExceeded');
      // The phrase survives a failed upload so the UI can still show it.
      expect(result.phrase?.split(' ')).toHaveLength(12);
    });

    it('lists only archives from the remembered folder, newest metadata intact', async () => {
      (drive.listFiles as jest.Mock).mockResolvedValue([
        { id: 'a', name: 'symply-budget-backup-2026-08-11-0915.json', mimeType: 'application/json', size: 1024, modifiedTime: '2026-08-11T09:15:00Z' },
        { id: 'b', name: 'unrelated.txt', mimeType: 'text/plain', size: 10 },
      ]);

      const entries = await listDriveBudgetBackups();

      expect(drive.listFiles).toHaveBeenCalledWith('folder-1');
      expect(entries).toEqual([
        {
          id: 'a',
          fileName: 'symply-budget-backup-2026-08-11-0915.json',
          size: 1024,
          modifiedAt: '2026-08-11T09:15:00Z',
          // Untagged name — nothing to attribute it to.
          householdId: null,
          // …and an untagged name is a bundle, which is why there is nothing to
          // attribute: it holds every household rather than one.
          kind: 'bundle',
        },
      ]);
    });

    /**
     * The listing feeds `pruneOldBackups`, which DELETES everything past
     * `keepLast`. That was harmless while the folder was always one this app
     * made; the folder picker lets a member point backups at `Documents`, where
     * a bare `*.json` filter would put their own files in reach — and on a
     * single-household device an untagged name is adopted as this household's,
     * so it would be a prune candidate rather than merely listed.
     */
    it('ignores files this app did not write, so a picked folder cannot be pruned', async () => {
      (drive.listFiles as jest.Mock).mockResolvedValue([
        {
          id: 'ours',
          name: 'symply-budget-backup-2026-08-11-0915.json',
          mimeType: 'application/json',
          size: 1024,
        },
        // Somebody's own file, sitting in the folder they chose.
        { id: 'theirs', name: 'taxes.json', mimeType: 'application/json', size: 4096 },
        {
          id: 'theirs-2',
          name: 'household-budget-2026.json',
          mimeType: 'application/json',
          size: 512,
        },
      ]);

      const entries = await listDriveBudgetBackups();

      expect(entries.map((entry) => entry.id)).toEqual(['ours']);
    });

    it('still lists an archive a member renamed by hand', async () => {
      (drive.listFiles as jest.Mock).mockResolvedValue([
        {
          id: 'renamed',
          name: 'symply-budget-backup-2026-08-11-0915 (copy).json',
          mimeType: 'application/json',
          size: 1024,
        },
      ]);

      // The prefix is the test, not the exact shape — a copy is still a
      // restorable archive and must not vanish from the restore list.
      await expect(listDriveBudgetBackups()).resolves.toHaveLength(1);
    });

    it('downloads a Drive archive and hands back its JSON', async () => {
      (drive.downloadFile as jest.Mock).mockResolvedValue({
        uri: 'file:///docs/gdrive_a_backup.json',
        name: 'backup.json',
        size: 1024,
      });
      mockRead.mockResolvedValue('{"meta":{"householdId":"hh_local_1"}}');

      await expect(readDriveBudgetBackup('a')).resolves.toBe(
        '{"meta":{"householdId":"hh_local_1"}}',
      );
      expect(mockRead).toHaveBeenCalledWith('file:///docs/gdrive_a_backup.json');
    });
  });

  describe('remembered folder storage', () => {
    it('round-trips the folder pointer', async () => {
      await rememberDriveFolder({ id: 'folder-x', name: 'Vault' });
      expect(mockStorageSet).toHaveBeenCalledWith(
        'budget.backup.driveFolder',
        JSON.stringify({ id: 'folder-x', name: 'Vault' }),
      );

      whenStorageHas({ [DRIVE_FOLDER_KEY]: JSON.stringify({ id: 'folder-x', name: 'Vault' }) });
      await expect(getRememberedDriveFolder()).resolves.toEqual({ id: 'folder-x', name: 'Vault' });

      await forgetDriveFolder();
      expect(mockStorageRemove).toHaveBeenCalledWith('budget.backup.driveFolder');
    });

    it('treats corrupt or half-written pointers as absent', async () => {
      whenStorageHas({ [DRIVE_FOLDER_KEY]: 'not json' });
      await expect(getRememberedDriveFolder()).resolves.toBeNull();

      whenStorageHas({ [DRIVE_FOLDER_KEY]: JSON.stringify({ id: 'only-id' }) });
      await expect(getRememberedDriveFolder()).resolves.toBeNull();
    });

    it('stores a chosen folder with its trail, and reads it back whole', async () => {
      await chooseCloudBackupFolder('google-drive', {
        id: 'folder-picked',
        name: 'Finance',
        path: ['Documents', 'Finance'],
      });
      expect(mockStorageSet).toHaveBeenCalledWith(
        'budget.backup.driveFolder',
        JSON.stringify({
          id: 'folder-picked',
          name: 'Finance',
          path: ['Documents', 'Finance'],
          source: 'picked',
        }),
      );

      whenStorageHas({ [DRIVE_FOLDER_KEY]: JSON.stringify({
          id: 'folder-picked',
          name: 'Finance',
          path: ['Documents', 'Finance'],
          source: 'picked',
        }) });
      const remembered = await getRememberedDriveFolder();
      expect(remembered).toEqual({
        id: 'folder-picked',
        name: 'Finance',
        path: ['Documents', 'Finance'],
        source: 'picked',
      });
      expect(describeCloudFolder(remembered!)).toBe('Documents › Finance');
    });

    it('reads a pointer written before picking existed as the default it was', async () => {
      whenStorageHas({ [DRIVE_FOLDER_KEY]: JSON.stringify({ id: 'folder-old', name: 'Vault' }) });

      const remembered = await getRememberedDriveFolder();

      expect(remembered).toEqual({ id: 'folder-old', name: 'Vault' });
      expect(rememberedFolderSource(remembered!)).toBe('default');
      // No trail to show, so the name has to carry the label on its own.
      expect(describeCloudFolder(remembered!)).toBe('Vault');
    });
  });

  describe('failure handling', () => {
    it('reports failure without a phrase when no local session is open', async () => {
      await closeLocalBudgetSession();

      const result = await saveBudgetBackupTo('device', { fileName: 'backup-o.json' });

      expect(result.status).toBe('failed');
      expect(result.phrase).toBeNull();
      expect(mockWrite).not.toHaveBeenCalled();

      // afterEach closes again; reopen so it has a session to close.
      await openLocalBudgetSessionForTests({ userId: 'user-backup-dest' });
    });

    it('keeps the phrase when the write itself fails', async () => {
      mockWrite.mockRejectedValue(new Error('disk full'));

      const result = await saveBudgetBackupTo('device', { fileName: 'backup-p.json' });

      expect(result.status).toBe('failed');
      expect(result.phrase?.split(' ')).toHaveLength(12);
      expect(result.message).toBe('Could not write the backup file.');
    });
  });
});
