/**
 * House V2 — where an encrypted archive lands.
 *
 * The port of `budget/local/__tests__/backupDestinations.test.ts`, kept to the
 * same contracts because the two apps share one archive format and one set of
 * destinations. What is House's own — and what most of the additions here are
 * about — is that a member holds 1–3 homes (H5) and an archive covers exactly
 * ONE of them (Q15). Every listing here feeds `pruneOldBackups`, which DELETES,
 * so "which home does this file belong to" is not a labelling question.
 *
 * The engine is mocked rather than opened: a real session mints its own
 * household id, and half of what is pinned below is about two or three homes
 * being told apart by name.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { ENV } from '@config/env';
import { googleDriveService } from '@services/cloud-storage/google-drive';
import { CloudReauthRequiredError } from '@services/cloud-storage/types';

import {
  HOUSE_BACKUP_DEVICE_FOLDER,
  HOUSE_BACKUP_DRIVE_FOLDER,
  HOUSE_BACKUP_RETENTION_DEFAULT,
  archiveHouseholdToken,
  autoBackupSupports,
  backupFileNameFor,
  chooseCloudBackupFolder,
  chooseDeviceBackupFolder,
  deleteLocalHouseBackup,
  describeCloudFolder,
  disconnectCloudProvider,
  forgetCloudFolder,
  getCloudAccount,
  getHouseBackupRetention,
  getRememberedDriveFolder,
  houseBackupDirectory,
  householdArchiveToken,
  listCloudHouseBackups,
  listLocalHouseBackups,
  readCloudHouseBackup,
  readLocalHouseBackup,
  rememberCloudFolder,
  rememberedFolderSource,
  saveHouseBackupTo,
  switchCloudAccount,
  timestampedBackupFileName,
} from '../backup/backupDestinations';

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
    isConfigured: jest.fn(() => true),
  },
}));

const HOUSE_A = 'hh_local_maple';
const HOUSE_B = 'hh_local_cabin';

const mockProperties = jest.fn();
jest.mock('../engine', () => ({
  listLocalHouseProperties: () => mockProperties(),
}));

const mockBuildArchive = jest.fn();
jest.mock('../backup/houseBackup', () => ({
  buildHouseBackupArchive: (...a: unknown[]) => mockBuildArchive(...a),
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
const mockStorageSet = AsyncStorage.setItem as jest.Mock;
const mockStorageRemove = AsyncStorage.removeItem as jest.Mock;
const drive = googleDriveService as jest.Mocked<typeof googleDriveService>;

/**
 * Point one storage key at one value, leaving every other key null.
 *
 * A blanket `mockResolvedValue(x)` answers EVERY key with `x`, which is not
 * harmless: the retention mode lives in AsyncStorage beside the folder pointer,
 * so a test setting up a folder would also be feeding that JSON to
 * `getHouseBackupRetention`.
 */
function whenStorageHas(values: Record<string, string | null>): void {
  mockStorageGet.mockImplementation(async (key: string) => values[key] ?? null);
}

const DRIVE_FOLDER_KEY = 'house.backup.driveFolder';
const RETENTION_KEY = 'house.backup.retention';
const DEVICE_FOLDER_KEY = 'house.backup.deviceFolder';

function setPlatform(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
}

/** `listLocalHouseProperties()` for a device holding these homes. */
function deviceHolds(...ids: string[]) {
  mockProperties.mockReturnValue(
    ids.map((householdId, index) => ({
      householdId,
      deviceId: 'dev-1',
      name: index === 0 ? 'Maple Street' : 'Lake Cabin',
      role: 'owner',
      isActive: index === 0,
      hydrated: true,
      awaitingEnrolment: false,
    })),
  );
}

const ARCHIVE_JSON = '{"format":"symply-backup","meta":{}}';
const PHRASE = 'apple bridge cactus dolphin ember forest garden harbor island jungle kettle lantern';

beforeEach(() => {
  jest.clearAllMocks();
  setPlatform('ios');
  deviceHolds(HOUSE_A);
  mockWrite.mockResolvedValue(undefined);
  mockDelete.mockResolvedValue(undefined);
  mockMakeDir.mockResolvedValue(undefined);
  mockIsAvailable.mockResolvedValue(true);
  mockShare.mockResolvedValue(undefined);
  whenStorageHas({});
  mockStorageSet.mockResolvedValue(undefined);
  mockStorageRemove.mockResolvedValue(undefined);
  mockGetInfo.mockResolvedValue({ exists: true, size: 2048, modificationTime: 1_770_000_000 });
  mockBuildArchive.mockResolvedValue({
    archiveJson: ARCHIVE_JSON,
    phrase: PHRASE,
    archive: {},
    summary: { householdId: HOUSE_A, propertyName: 'Maple Street', tableCounts: {}, totalRows: 0, blobManifest: [] },
  });
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
});

/**
 * "Replace the last one" vs "keep every copy" — one switch, and the thing most
 * likely to quietly stop working, because every destination has to implement
 * "overwrite" in its own terms.
 */
describe('retention mode', () => {
  it('defaults to replacing, so a folder holds one file per home and not a growing pile', async () => {
    await expect(getHouseBackupRetention()).resolves.toBe('replace');
    expect(HOUSE_BACKUP_RETENTION_DEFAULT).toBe('replace');
  });

  it('reads back a stored choice, and ignores a value it does not recognise', async () => {
    whenStorageHas({ [RETENTION_KEY]: 'dated' });
    await expect(getHouseBackupRetention()).resolves.toBe('dated');

    whenStorageHas({ [RETENTION_KEY]: 'whatever' });
    await expect(getHouseBackupRetention()).resolves.toBe('replace');
  });

  it('names a replace-mode archive after the home only — no timestamp', () => {
    const name = backupFileNameFor('replace', {
      householdId: HOUSE_A,
      propertyName: 'Maple Street',
    });
    expect(name).toBe('symply-house-backup-maple-street--hh_local_maple.json');
    expect(name).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  /**
   * Q15 in one assertion. Three homes sharing one file name would overwrite
   * each other, and the member would find one archive where they expected
   * three — the exact failure the household token exists to prevent.
   */
  it('keeps two homes apart even in replace mode', () => {
    const a = backupFileNameFor('replace', { householdId: HOUSE_A, propertyName: 'Home' });
    const b = backupFileNameFor('replace', { householdId: HOUSE_B, propertyName: 'Home' });
    expect(a).not.toBe(b);
    expect(archiveHouseholdToken(a)).toBe(householdArchiveToken(HOUSE_A));
    expect(archiveHouseholdToken(b)).toBe(householdArchiveToken(HOUSE_B));
  });

  it('still timestamps in dated mode, so two backups in one day do not collide', () => {
    const at = new Date('2026-08-11T09:15:00.000Z');
    const name = backupFileNameFor('dated', { householdId: HOUSE_A, propertyName: 'Maple Street' }, at);
    expect(name).toContain('2026-08-11-0915');
    // The date leads so a name sort is still a recency sort ACROSS homes.
    expect(name.indexOf('2026-08-11')).toBeLessThan(name.indexOf('maple-street'));
    expect(timestampedBackupFileName(at)).toBe('symply-house-backup-2026-08-11-0915.json');
  });

  it('writes over the same on-device path every time in replace mode', async () => {
    whenStorageHas({ [RETENTION_KEY]: 'replace' });
    await saveHouseBackupTo('device');
    await saveHouseBackupTo('device');

    const [firstPath] = mockWrite.mock.calls[0];
    const [secondPath] = mockWrite.mock.calls[1];
    expect(firstPath).toBe(secondPath);
  });

  it('replaces the Drive file in place rather than adding a second of that name', async () => {
    whenStorageHas({ [RETENTION_KEY]: 'replace' });
    const fileName = backupFileNameFor('replace', {
      householdId: HOUSE_A,
      propertyName: 'Maple Street',
    });
    (drive.listFiles as jest.Mock).mockResolvedValue([{ id: 'existing-1', name: fileName, size: 1 }]);

    await saveHouseBackupTo('google-drive');

    expect(drive.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ replaceFileId: 'existing-1' }),
    );
  });

  it('never looks for a file to replace in dated mode', async () => {
    whenStorageHas({ [RETENTION_KEY]: 'dated' });
    await saveHouseBackupTo('google-drive');
    expect(drive.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ replaceFileId: undefined }),
    );
  });

  it('still uploads when the look-for-existing listing fails', async () => {
    // A tidiness problem; failing the backup over it would be a data problem.
    whenStorageHas({ [RETENTION_KEY]: 'replace' });
    (drive.listFiles as jest.Mock).mockRejectedValue(new Error('quota'));

    const result = await saveHouseBackupTo('google-drive');
    expect(result.status).toBe('saved');
    expect(drive.uploadFile).toHaveBeenCalled();
  });
});

/**
 * The whole-device archive — one file, every home, a section each.
 *
 * It travels the same paths as a per-home archive because it is addressed to a
 * household id like anything else. The two rules that are NOT shared are the
 * ones this block is about, and both exist because these listings feed a sweep
 * that DELETES: a whole-device file lists for every home (it contains every
 * home), and no per-home sweep may ever delete one.
 */
describe('an archive that holds every home', () => {
  const ALL_HOMES = 'all-homes';

  function buildsWholeDevice(): void {
    mockBuildArchive.mockResolvedValue({
      archiveJson: ARCHIVE_JSON,
      phrase: PHRASE,
      archive: {},
      scope: 'multi',
      householdIds: [HOUSE_A, HOUSE_B],
      summary: {
        householdId: ALL_HOMES,
        propertyName: 'All homes',
        tableCounts: {},
        totalRows: 9,
        blobManifest: [],
      },
    });
  }

  it('is named for the file it is, not for a home it is not', () => {
    // The readable half and the machine half are the same word here, so it
    // carries the token alone rather than repeating it.
    expect(backupFileNameFor('replace', { householdId: ALL_HOMES, propertyName: 'All homes' })).toBe(
      'symply-house-backup--all-homes.json',
    );
    const dated = backupFileNameFor(
      'dated',
      { householdId: ALL_HOMES, propertyName: 'All homes' },
      new Date('2026-08-11T09:15:00.000Z'),
    );
    expect(dated).toBe('symply-house-backup-2026-08-11-0915--all-homes.json');
    // Still parses back to a token, which is what every listing attributes by.
    expect(archiveHouseholdToken(dated)).toBe('all-homes');
  });

  it('reports every home it sealed, not the pseudo-id it is filed under', async () => {
    // The caller records protection against these. Filing a file that covers
    // three homes under one pseudo-id would leave all three reading "No backup
    // yet" on their own status cards.
    buildsWholeDevice();
    deviceHolds(HOUSE_A, HOUSE_B);

    const result = await saveHouseBackupTo('device', { householdId: ALL_HOMES });

    expect(result.status).toBe('saved');
    expect(result.scope).toBe('multi');
    expect(result.householdIds).toEqual([HOUSE_A, HOUSE_B]);
    expect(result.householdId).toBe(ALL_HOMES);
    expect(result.fileName).toBe('symply-house-backup--all-homes.json');
  });

  it('lists for every home, because it really does contain every home', async () => {
    deviceHolds(HOUSE_A, HOUSE_B);
    mockReadDir.mockResolvedValue([
      'symply-house-backup--all-homes.json',
      'symply-house-backup-maple-street--hh_local_maple.json',
    ]);

    const forMaple = await listLocalHouseBackups(HOUSE_A);
    const forCabin = await listLocalHouseBackups(HOUSE_B);

    expect(forMaple.map((entry) => entry.fileName)).toContain('symply-house-backup--all-homes.json');
    expect(forCabin.map((entry) => entry.fileName)).toEqual([
      'symply-house-backup--all-homes.json',
    ]);
    // …and it says so, so a screen can label it and a sweep can recognise it.
    expect(forCabin[0].coversAllHomes).toBe(true);
    // It names no single home, because it holds several.
    expect(forCabin[0].householdId).toBeNull();
  });

  it('narrows to only the whole-device files when asked for them by name', async () => {
    deviceHolds(HOUSE_A, HOUSE_B);
    mockReadDir.mockResolvedValue([
      'symply-house-backup--all-homes.json',
      'symply-house-backup-maple-street--hh_local_maple.json',
    ]);

    const entries = await listLocalHouseBackups(ALL_HOMES);

    expect(entries.map((entry) => entry.fileName)).toEqual([
      'symply-house-backup--all-homes.json',
    ]);
  });

  it('lists in the cloud the same way it does on device', async () => {
    deviceHolds(HOUSE_A, HOUSE_B);
    (drive.listFiles as jest.Mock).mockResolvedValue([
      { id: 'f1', name: 'symply-house-backup--all-homes.json', size: 10 },
      { id: 'f2', name: 'symply-house-backup-lake-cabin--hh_local_cabin.json', size: 10 },
    ]);

    const entries = await listCloudHouseBackups('google-drive', HOUSE_A);

    expect(entries.map((entry) => entry.fileName)).toEqual([
      'symply-house-backup--all-homes.json',
    ]);
    expect(entries[0].coversAllHomes).toBe(true);
  });
});

describe('which destinations can run unattended', () => {
  it('allows the ones that need no interaction anywhere', () => {
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
    expect(autoBackupSupports('files')).toBe(false);
  });
});

describe('the device destination', () => {
  it('writes the sealed archive into the app documents backups folder', async () => {
    mockGetInfo.mockResolvedValueOnce({ exists: false });

    const result = await saveHouseBackupTo('device');

    expect(mockMakeDir).toHaveBeenCalledWith(houseBackupDirectory(), { intermediates: true });
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining('house-backups/'),
      ARCHIVE_JSON,
    );
    expect(result.status).toBe('saved');
    // The phrase always travels back — the archive is already sealed under it.
    expect(result.phrase).toBe(PHRASE);
    expect(result.householdId).toBe(HOUSE_A);
  });

  it('hands back an openable uri and the Files trail, named for this brand', async () => {
    const result = await saveHouseBackupTo('device');

    expect(result.savedTo).toMatchObject({ kind: 'device', where: 'On this device' });
    expect(result.savedTo?.uri).toContain('file:///docs/house-backups/');
    // Hardcoding "House" here would be wrong: Files shows CFBundleDisplayName,
    // which is per brand.
    expect(result.savedTo?.breadcrumb).toEqual([
      'Files',
      'On My iPhone',
      ENV.APP_NAME,
      'house-backups',
    ]);
  });

  it('offers no Files trail on Android, where the folder is app-private', async () => {
    setPlatform('android');
    const result = await saveHouseBackupTo('device');
    expect(result.savedTo?.breadcrumb).toBeNull();
  });

  it('lists archives newest first and ignores files this app did not write', async () => {
    mockReadDir.mockResolvedValue([
      'symply-house-backup-2026-08-10-0900-maple-street--hh_local_maple.json',
      'symply-house-backup-2026-08-12-0900-maple-street--hh_local_maple.json',
      // The member's own file, sitting in the same folder. A listing that
      // returned it would let `pruneOldBackups` delete it.
      'deed.json',
      'notes.txt',
    ]);

    const entries = await listLocalHouseBackups();
    expect(entries.map((e) => e.fileName)).toEqual([
      'symply-house-backup-2026-08-12-0900-maple-street--hh_local_maple.json',
      'symply-house-backup-2026-08-10-0900-maple-street--hh_local_maple.json',
    ]);
  });

  /**
   * The listing feeds a prune that DELETES. Narrowing to one home must never
   * return another home's archive — a retention cap that deletes across the
   * boundary destroys the very data it was set to bound.
   */
  it('narrows to one home, and never returns another home’s archive', async () => {
    deviceHolds(HOUSE_A, HOUSE_B);
    mockReadDir.mockResolvedValue([
      'symply-house-backup-2026-08-12-0900-maple-street--hh_local_maple.json',
      'symply-house-backup-2026-08-12-0901-lake-cabin--hh_local_cabin.json',
    ]);

    const maple = await listLocalHouseBackups(HOUSE_A);
    expect(maple).toHaveLength(1);
    expect(maple[0].householdId).toBe(HOUSE_A);

    const cabin = await listLocalHouseBackups(HOUSE_B);
    expect(cabin).toHaveLength(1);
    expect(cabin[0].householdId).toBe(HOUSE_B);
  });

  /**
   * An untagged name is an archive from the first H9 build, whose name said
   * nothing about which home it held. On a one-home device there is exactly one
   * home it can be; on a two-home device there is not, and a prune that cannot
   * attribute a file must never delete it.
   */
  it('adopts an untagged archive only while the device holds one home', async () => {
    mockReadDir.mockResolvedValue(['symply-house-maple-street-2026-08-13.backup.json']);

    deviceHolds(HOUSE_A);
    await expect(listLocalHouseBackups(HOUSE_A)).resolves.toHaveLength(1);

    deviceHolds(HOUSE_A, HOUSE_B);
    await expect(listLocalHouseBackups(HOUSE_A)).resolves.toHaveLength(0);
    // Still visible in the unnarrowed list — unattributable is not the same as
    // unwanted, and the member can still restore or delete it by hand.
    await expect(listLocalHouseBackups()).resolves.toHaveLength(1);
  });

  it('leaves an archive whose home the member has since left unattributed', async () => {
    deviceHolds(HOUSE_A);
    mockReadDir.mockResolvedValue([
      'symply-house-backup-2026-08-12-0900-old-place--hh_local_gone.json',
    ]);
    const [entry] = await listLocalHouseBackups();
    expect(entry.householdId).toBeNull();
  });

  it('returns an empty list when nothing has been backed up yet', async () => {
    mockGetInfo.mockResolvedValue({ exists: false });
    await expect(listLocalHouseBackups()).resolves.toEqual([]);
  });

  it('reads and deletes an archive by file name', async () => {
    mockRead.mockResolvedValue(ARCHIVE_JSON);
    await expect(readLocalHouseBackup('a.json')).resolves.toBe(ARCHIVE_JSON);
    expect(mockRead).toHaveBeenCalledWith(`${houseBackupDirectory()}a.json`);

    await deleteLocalHouseBackup('a.json');
    expect(mockDelete).toHaveBeenCalledWith(`${houseBackupDirectory()}a.json`, {
      idempotent: true,
    });
  });
});

describe('the files destination', () => {
  it('uses the iOS share sheet and cleans up the temp copy', async () => {
    const result = await saveHouseBackupTo('files');

    expect(mockShare).toHaveBeenCalledWith(
      expect.stringContaining('file:///cache/'),
      expect.objectContaining({ mimeType: 'application/json' }),
    );
    // A plaintext-adjacent throwaway must not outlive the sheet.
    expect(mockDelete).toHaveBeenCalledWith(expect.stringContaining('file:///cache/'), {
      idempotent: true,
    });
    expect(result.status).toBe('shared');
    // `shared` is deliberately not `saved`: the OS tells us nothing about what
    // the member did with it, so it is not evidence of a backup.
    expect(result.savedTo?.kind).toBe('handoff');
    expect(result.savedTo?.uri).toBeNull();
  });

  it('reports unsupported rather than throwing when sharing is unavailable', async () => {
    mockIsAvailable.mockResolvedValue(false);
    const result = await saveHouseBackupTo('files');
    expect(result.status).toBe('unsupported');
    expect(result.phrase).toBe(PHRASE);
  });

  it('uses the Android folder picker and strips the duplicate extension', async () => {
    setPlatform('android');
    whenStorageHas({
      [DEVICE_FOLDER_KEY]: JSON.stringify({
        rootUri: 'content://tree/primary%3ADownload',
        backupsUri: 'content://tree/primary%3ADownload/document/Download%2FSymply%20House%20Backups',
        label: 'Download/Symply House Backups',
      }),
    });
    mockSaf.readDirectoryAsync.mockResolvedValue([]);
    mockSaf.createFileAsync.mockResolvedValue('content://.../new.json');

    const result = await saveHouseBackupTo('files');

    // SAF appends the extension from the mime type, so ours is stripped first.
    const [, name] = mockSaf.createFileAsync.mock.calls[0];
    expect(name).not.toMatch(/\.json$/);
    expect(result.status).toBe('saved');
    expect(result.savedTo?.kind).toBe('folder');
    // A SAF grant uri is not something expo-sharing can hand on.
    expect(result.savedTo?.uri).toBeNull();
  });

  it('overwrites the existing archive in replace mode instead of making "name (1)"', async () => {
    setPlatform('android');
    const fileName = backupFileNameFor('replace', {
      householdId: HOUSE_A,
      propertyName: 'Maple Street',
    });
    whenStorageHas({
      [RETENTION_KEY]: 'replace',
      [DEVICE_FOLDER_KEY]: JSON.stringify({
        rootUri: 'content://tree/root',
        backupsUri: 'content://tree/root/backups',
        label: 'Download/Symply House Backups',
      }),
    });
    mockSaf.readDirectoryAsync.mockResolvedValue([`content://tree/root/backups%2F${fileName}`]);

    await saveHouseBackupTo('files');

    expect(mockSaf.createFileAsync).not.toHaveBeenCalled();
    expect(mockWrite).toHaveBeenCalledWith(
      `content://tree/root/backups%2F${fileName}`,
      ARCHIVE_JSON,
      expect.anything(),
    );
  });

  it('reports cancelled when the Android folder picker is dismissed', async () => {
    setPlatform('android');
    mockSaf.requestDirectoryPermissionsAsync.mockResolvedValue({ granted: false });
    const result = await saveHouseBackupTo('files');
    expect(result.status).toBe('cancelled');
  });

  it('never throws a folder picker at an unattended run', async () => {
    setPlatform('android');
    const result = await saveHouseBackupTo('files', { allowInteractiveAuth: false });
    expect(mockSaf.requestDirectoryPermissionsAsync).not.toHaveBeenCalled();
    expect(result.status).toBe('needs_auth');
  });
});

describe('a folder on the phone (Android)', () => {
  beforeEach(() => {
    setPlatform('android');
    mockSaf.requestDirectoryPermissionsAsync.mockResolvedValue({
      granted: true,
      directoryUri: 'content://tree/primary%3ADownload',
    });
    mockSaf.readDirectoryAsync.mockResolvedValue([]);
    mockSaf.makeDirectoryAsync.mockResolvedValue(
      'content://tree/primary%3ADownload/document/Download%2FSymply%20House%20Backups',
    );
  });

  it('makes its own sub-folder inside whatever the member picked', async () => {
    // The picker hands back somewhere like `Download`, full of the member's own
    // files — and a listing that DELETES must not stand next to them.
    await chooseDeviceBackupFolder();
    expect(mockSaf.makeDirectoryAsync).toHaveBeenCalledWith(
      'content://tree/primary%3ADownload',
      HOUSE_BACKUP_DEVICE_FOLDER,
    );
  });

  it('reuses the sub-folder it already made instead of making a second', async () => {
    mockSaf.readDirectoryAsync.mockResolvedValue([
      `content://tree/primary%3ADownload/document/Download%2F${encodeURIComponent(HOUSE_BACKUP_DEVICE_FOLDER)}`,
    ]);
    // The existing child is matched on its decoded trailing segment.
    mockSaf.readDirectoryAsync.mockResolvedValue([
      'content://tree/primary%3ADownload/document/Download/Symply House Backups',
    ]);

    await chooseDeviceBackupFolder();
    expect(mockSaf.makeDirectoryAsync).not.toHaveBeenCalled();
  });

  it('returns null — not a folder — when the picker is dismissed', async () => {
    mockSaf.requestDirectoryPermissionsAsync.mockResolvedValue({ granted: false });
    await expect(chooseDeviceBackupFolder()).resolves.toBeNull();
  });

  it('remembers the grant so later backups need no picker', async () => {
    await chooseDeviceBackupFolder();
    expect(mockStorageSet).toHaveBeenCalledWith(DEVICE_FOLDER_KEY, expect.any(String));
  });

  it('drops a grant the member revoked, so the next attempt re-asks', async () => {
    whenStorageHas({
      [DEVICE_FOLDER_KEY]: JSON.stringify({
        rootUri: 'content://tree/root',
        backupsUri: 'content://tree/root/backups',
        label: 'Download/Symply House Backups',
      }),
    });
    // A revoked grant throws on any read.
    mockSaf.readDirectoryAsync.mockRejectedValueOnce(new Error('permission denied'));

    await saveHouseBackupTo('files');

    expect(mockStorageRemove).toHaveBeenCalledWith(DEVICE_FOLDER_KEY);
    expect(mockSaf.requestDirectoryPermissionsAsync).toHaveBeenCalled();
  });
});

describe('the cloud destinations', () => {
  it('uploads into the remembered folder and reports where it landed', async () => {
    // A DEFAULT pointer is the app's own folder, so it is re-validated by name
    // on every run and the id it resolves to is what gets written into — that
    // is what lets a stale pointer self-heal after one call.
    whenStorageHas({
      [DRIVE_FOLDER_KEY]: JSON.stringify({ id: 'folder-9', name: 'Symply House Backups' }),
    });
    (drive.ensureFolder as jest.Mock).mockResolvedValue('folder-9');

    const result = await saveHouseBackupTo('google-drive');

    expect(drive.ensureFolder).toHaveBeenCalledWith('Symply House Backups', 'folder-9');
    expect(drive.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'folder-9', content: ARCHIVE_JSON }),
    );
    expect(result.status).toBe('saved');
    expect(result.savedTo).toMatchObject({ kind: 'cloud', where: 'Google Drive' });
    expect(result.savedTo?.breadcrumb).toEqual(['Google Drive', 'Symply House Backups']);
  });

  it('remembers the folder id on first upload so later ones reuse it', async () => {
    await saveHouseBackupTo('google-drive');
    expect(mockStorageSet).toHaveBeenCalledWith(
      DRIVE_FOLDER_KEY,
      expect.stringContaining('"source":"default"'),
    );
  });

  it('uploads into a folder the member picked, without re-resolving it by name', async () => {
    whenStorageHas({
      [DRIVE_FOLDER_KEY]: JSON.stringify({
        id: 'picked-1',
        name: 'Home',
        path: ['Documents', '2026', 'Home'],
        source: 'picked',
      }),
    });

    const result = await saveHouseBackupTo('google-drive');

    expect(drive.ensureFolder).not.toHaveBeenCalled();
    expect(drive.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'picked-1' }),
    );
    // The trail is what makes it findable again — "Drive › Home" sends someone
    // hunting the root.
    expect(result.savedTo?.breadcrumb).toEqual([
      'Google Drive',
      'Documents',
      '2026',
      'Home',
    ]);
  });

  it('falls back to the app folder — never a lookalike — when the picked one is gone', async () => {
    whenStorageHas({
      [DRIVE_FOLDER_KEY]: JSON.stringify({ id: 'picked-1', name: 'Home', source: 'picked' }),
    });
    (drive.folderExists as jest.Mock).mockResolvedValue(false);

    await saveHouseBackupTo('google-drive');

    // Recreating it would make a NEW "Home" at the account root — not the
    // Documents/2026/Home they picked — and scatter archives there silently.
    expect(mockStorageRemove).toHaveBeenCalledWith(DRIVE_FOLDER_KEY);
    expect(drive.ensureFolder).toHaveBeenCalledWith(HOUSE_BACKUP_DRIVE_FOLDER, null);
  });

  it('keeps a pick when the provider cannot probe whether it still exists', async () => {
    whenStorageHas({
      [DRIVE_FOLDER_KEY]: JSON.stringify({ id: 'picked-1', name: 'Home', source: 'picked' }),
    });
    (drive as unknown as { folderExists?: unknown }).folderExists = undefined;

    await saveHouseBackupTo('google-drive');

    expect(drive.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'picked-1' }),
    );
    (drive as unknown as { folderExists: jest.Mock }).folderExists = jest.fn(async () => true);
  });

  // A probe that fails for its own reasons is not Drive saying the folder is
  // gone. Dropping the pick on it is what silently moved backups to a fresh
  // root folder after one flaky check — see the Budget twin of this test.
  it('keeps a pick when the probe fails for a reason that says nothing about the folder', async () => {
    whenStorageHas({
      [DRIVE_FOLDER_KEY]: JSON.stringify({ id: 'picked-1', name: 'Home', source: 'picked' }),
    });
    (drive.folderExists as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));

    const result = await saveHouseBackupTo('google-drive');

    expect(result.status).toBe('saved');
    expect(drive.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'picked-1' }),
    );
    expect(drive.ensureFolder).not.toHaveBeenCalled();
    expect(mockStorageRemove).not.toHaveBeenCalled();
  });

  it('reports needs_auth from the probe without dropping the pick', async () => {
    whenStorageHas({
      [DRIVE_FOLDER_KEY]: JSON.stringify({ id: 'picked-1', name: 'Home', source: 'picked' }),
    });
    (drive.folderExists as jest.Mock).mockRejectedValue(new CloudReauthRequiredError());

    const result = await saveHouseBackupTo('google-drive');

    expect(result.status).toBe('needs_auth');
    expect(drive.uploadFile).not.toHaveBeenCalled();
    expect(mockStorageRemove).not.toHaveBeenCalled();
  });

  it('signs in first when Drive is not connected yet', async () => {
    (drive.isAuthenticated as jest.Mock).mockResolvedValue(false);
    (drive.authenticate as jest.Mock).mockResolvedValue(undefined);

    await saveHouseBackupTo('google-drive');
    expect(drive.authenticate).toHaveBeenCalled();
  });

  it('reports cancelled — not failed — when the consent screen is dismissed', async () => {
    (drive.isAuthenticated as jest.Mock).mockResolvedValue(false);
    (drive.authenticate as jest.Mock).mockRejectedValue(new Error('User cancelled the flow'));

    const result = await saveHouseBackupTo('google-drive');
    expect(result.status).toBe('cancelled');
  });

  it('asks for a reconnect rather than a picker when the grant lost its scope', async () => {
    (drive.isAuthenticated as jest.Mock).mockResolvedValue(false);
    (drive.authenticate as jest.Mock).mockRejectedValue(
      new CloudReauthRequiredError('Reconnect Google Drive.'),
    );

    const result = await saveHouseBackupTo('google-drive');
    expect(result.status).toBe('needs_auth');
  });

  it('never pops a consent screen from an unattended run', async () => {
    (drive.isAuthenticated as jest.Mock).mockResolvedValue(false);
    const result = await saveHouseBackupTo('google-drive', { allowInteractiveAuth: false });

    expect(drive.authenticate).not.toHaveBeenCalled();
    expect(result.status).toBe('needs_auth');
  });

  it('never leaks a raw provider error into the member-facing message', async () => {
    (drive.uploadFile as jest.Mock).mockRejectedValue(
      new Error('403: userRateLimitExceeded, requestId=abc123'),
    );

    const result = await saveHouseBackupTo('google-drive');
    expect(result.status).toBe('failed');
    expect(result.message).toBe('Could not upload the backup to Google Drive.');
    expect(result.message).not.toContain('requestId');
  });

  it('lists only archives this app wrote, and narrows them to one home', async () => {
    deviceHolds(HOUSE_A, HOUSE_B);
    (drive.listFiles as jest.Mock).mockResolvedValue([
      { id: '1', name: 'symply-house-backup-2026-08-12-0900-maple-street--hh_local_maple.json', size: 10 },
      { id: '2', name: 'symply-house-backup-2026-08-12-0901-lake-cabin--hh_local_cabin.json', size: 10 },
      { id: '3', name: 'tax-return.json', size: 10 },
    ]);

    const all = await listCloudHouseBackups('google-drive');
    expect(all.map((e) => e.id)).toEqual(['2', '1']); // newest name first

    const maple = await listCloudHouseBackups('google-drive', HOUSE_A);
    expect(maple.map((e) => e.id)).toEqual(['1']);
  });

  it('downloads a cloud archive and hands back its JSON', async () => {
    (drive.downloadFile as jest.Mock).mockResolvedValue({ uri: 'file:///cache/dl.json' });
    mockRead.mockResolvedValue(ARCHIVE_JSON);

    await expect(readCloudHouseBackup('google-drive', 'file-1')).resolves.toBe(ARCHIVE_JSON);
  });
});

describe('the remembered folder pointer', () => {
  it('round-trips a pointer, trail and all', async () => {
    await rememberCloudFolder('google-drive', {
      id: 'f1',
      name: 'Home',
      path: ['Documents', 'Home'],
      source: 'picked',
    });
    const [, written] = mockStorageSet.mock.calls[0];
    whenStorageHas({ [DRIVE_FOLDER_KEY]: written });

    const folder = await getRememberedDriveFolder();
    expect(folder).toMatchObject({ id: 'f1', name: 'Home', source: 'picked' });
    expect(describeCloudFolder(folder!)).toBe('Documents › Home');
  });

  it('treats a corrupt or half-written pointer as absent', async () => {
    whenStorageHas({ [DRIVE_FOLDER_KEY]: '{"name":"no id"}' });
    await expect(getRememberedDriveFolder()).resolves.toBeNull();

    whenStorageHas({ [DRIVE_FOLDER_KEY]: 'not json' });
    await expect(getRememberedDriveFolder()).resolves.toBeNull();
  });

  it('reads a pointer written before picking existed as the default it was', async () => {
    whenStorageHas({ [DRIVE_FOLDER_KEY]: JSON.stringify({ id: 'f1', name: 'Symply House Backups' }) });
    const folder = await getRememberedDriveFolder();
    expect(rememberedFolderSource(folder!)).toBe('default');
  });

  it('stores a chosen folder as picked, which is what stops it being recreated', async () => {
    await chooseCloudBackupFolder('google-drive', { id: 'f2', name: 'Home', path: ['Docs'] });
    expect(mockStorageSet).toHaveBeenCalledWith(
      DRIVE_FOLDER_KEY,
      expect.stringContaining('"source":"picked"'),
    );
  });

  it('forgets the pointer on request', async () => {
    await forgetCloudFolder('google-drive');
    expect(mockStorageRemove).toHaveBeenCalledWith(DRIVE_FOLDER_KEY);
  });
});

describe('the cloud account', () => {
  it('reports who is signed in, and nothing when signed out', async () => {
    (drive.getAuthState as jest.Mock).mockResolvedValue({
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

  it('forgets the folder as well as the token when signing out', async () => {
    // A folder id means nothing outside the account that issued it; carried
    // into a second account the next backup lands somewhere nobody chose.
    await disconnectCloudProvider('google-drive');
    expect(drive.logout).toHaveBeenCalled();
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
    (drive.authenticate as jest.Mock).mockImplementation(async () => void order.push('auth'));

    await switchCloudAccount('google-drive');
    expect(order).toEqual(['logout', 'auth']);
  });
});

describe('failure handling', () => {
  it('reports failure without a phrase when the archive was never built', async () => {
    mockBuildArchive.mockRejectedValue(new Error('no session'));

    const result = await saveHouseBackupTo('device');
    expect(result).toMatchObject({
      status: 'failed',
      phrase: null,
      fileName: null,
      householdId: null,
      savedTo: null,
    });
  });

  it('keeps the phrase when the write itself fails', async () => {
    // The archive is already sealed under those words by then; losing them
    // would lose a secret the member could still have used.
    mockWrite.mockRejectedValue(new Error('disk full'));

    const result = await saveHouseBackupTo('device');
    expect(result.status).toBe('failed');
    expect(result.phrase).toBe(PHRASE);
    expect(result.householdId).toBe(HOUSE_A);
  });

  it('seals the home it was asked for, not whichever one is active', async () => {
    await saveHouseBackupTo('device', { householdId: HOUSE_B });
    expect(mockBuildArchive).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: HOUSE_B }),
    );
  });
});
