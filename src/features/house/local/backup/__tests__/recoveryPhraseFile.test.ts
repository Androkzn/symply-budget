import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import {
  buildRecoveryPhraseFileText,
  exportRecoveryPhraseFile,
  getRecoveryPhraseFolder,
  recoveryPhraseFileName,
  rememberRecoveryPhraseFolder,
  RECOVERY_PHRASE_FILE_FAILED_MESSAGE,
} from '../recoveryPhraseFile';

jest.mock('expo-file-system/legacy', () => ({
  writeAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  cacheDirectory: 'file:///cache/',
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));
/**
 * Two seams, the same two Budget's copy of this test mocks.
 *
 * The BODY lives in `@services/backup/recoveryPhraseFile` and reaches the
 * provider through the app-agnostic `@services/cloud-storage/backupProviders`.
 * What is House's is the descriptor in `../recoveryPhraseFile`, and the two
 * pointers it fills in from `../backupDestinations` — the on-device folder and
 * the backups' Drive folder. Mocking both keeps this test on the Drive plumbing
 * rather than the Drive API beneath it.
 */
jest.mock('../backupDestinations', () => ({
  HOUSE_BACKUP_DRIVE_FOLDER: 'Symply House Backups',
  houseBackupDirectory: () => 'file:///docs/house-backups/',
  resolveCloudFolder: jest.fn(),
}));
jest.mock('@services/cloud-storage/backupProviders', () => ({
  cloudProviderLabel: () => 'Google Drive',
  describeCloudFolder: (folder: { path?: string[]; name: string }) =>
    folder.path?.length ? folder.path.join(' › ') : folder.name,
  cloudServiceFor: jest.fn(),
  isCloudProviderConfigured: jest.fn(() => true),
}));

const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStorage.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStorage.delete(key);
    }),
  },
}));

const backupDestinations = jest.requireMock('../backupDestinations');
const backupProviders = jest.requireMock('@services/cloud-storage/backupProviders');

const mockWrite = FileSystem.writeAsStringAsync as jest.Mock;
const mockDelete = FileSystem.deleteAsync as jest.Mock;
const mockGetInfo = FileSystem.getInfoAsync as jest.Mock;
const mockMakeDir = FileSystem.makeDirectoryAsync as jest.Mock;
const mockIsAvailable = Sharing.isAvailableAsync as jest.Mock;
const mockShare = Sharing.shareAsync as jest.Mock;
const mockCloudServiceFor = backupProviders.cloudServiceFor as jest.Mock;
const mockIsConfigured = backupProviders.isCloudProviderConfigured as jest.Mock;
const mockResolveFolder = backupDestinations.resolveCloudFolder as jest.Mock;

const FILE_NAME = '2026-08-16-symply-house-recovery-phrase.txt';

const PHRASE =
  'already sport hundred middle step civil yard nice envelope tree sell width';
const AT = new Date(2026, 7, 16, 16, 45);

describe('recoveryPhraseFileName', () => {
  it('names the file after House, not the app the writer was built for', () => {
    expect(recoveryPhraseFileName(AT)).toBe(FILE_NAME);
  });
});

describe('buildRecoveryPhraseFileText', () => {
  const text = buildRecoveryPhraseFileText(PHRASE, AT);

  it('numbers every word so the file can be read back word by word', () => {
    expect(text).toContain(' 1. already');
    expect(text).toContain('12. width');
  });

  it('says whose backups it opens and what someone holding it could read', () => {
    expect(text).toContain('Symply House — backup recovery phrase');
    expect(text).toMatch(/Anyone who has it can read everything in your home/);
  });
});

describe('exportRecoveryPhraseFile', () => {
  const uploadFile = jest.fn();
  const isAuthenticated = jest.fn();
  const authenticate = jest.fn();
  const folderExists = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.clear();
    mockWrite.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
    mockGetInfo.mockResolvedValue({ exists: true });
    mockMakeDir.mockResolvedValue(undefined);
    mockIsAvailable.mockResolvedValue(true);
    mockShare.mockResolvedValue(undefined);

    isAuthenticated.mockResolvedValue(true);
    authenticate.mockResolvedValue(undefined);
    folderExists.mockResolvedValue(true);
    uploadFile.mockResolvedValue({ id: 'drive_1', name: FILE_NAME });
    mockCloudServiceFor.mockReturnValue({
      uploadFile,
      isAuthenticated,
      authenticate,
      folderExists,
    });
    mockIsConfigured.mockReturnValue(true);
    mockResolveFolder.mockResolvedValue({ id: 'folder_1', name: 'Symply House Backups' });
  });

  describe('google drive', () => {
    /**
     * The regression this file exists for. House shipped with no
     * `destinations`, so this call answered `unsupported` and the sheet offered
     * Copy and a share sheet in place of the three real destinations — the only
     * copy of the twelve words that opens a home's backups could not be put
     * anywhere that outlives the phone.
     */
    it('uploads into the folder the archives already go to', async () => {
      const result = await exportRecoveryPhraseFile(PHRASE, 'google-drive', AT);

      expect(result.status).toBe('saved');
      expect(uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({
          name: FILE_NAME,
          mimeType: 'text/plain',
          folderId: 'folder_1',
          content: expect.stringContaining('width'),
        }),
      );
      // Named, so "where did it go" is answered without opening Drive.
      expect(result.message).toMatch(/Symply House Backups/);
    });

    it('raises consent when the account is not connected yet', async () => {
      isAuthenticated.mockResolvedValue(false);

      const result = await exportRecoveryPhraseFile(PHRASE, 'google-drive', AT);

      expect(authenticate).toHaveBeenCalled();
      expect(result.status).toBe('saved');
    });

    /** Backing out of the consent screen is a choice — nothing to apologise for. */
    it('says nothing loud when the member cancels sign-in', async () => {
      isAuthenticated.mockResolvedValue(false);
      authenticate.mockRejectedValueOnce(new Error('User cancelled'));

      const result = await exportRecoveryPhraseFile(PHRASE, 'google-drive', AT);

      expect(result.status).toBe('cancelled');
      expect(uploadFile).not.toHaveBeenCalled();
    });

    it('reports a failed upload rather than claiming the phrase is safe', async () => {
      uploadFile.mockRejectedValueOnce(new Error('500'));

      const result = await exportRecoveryPhraseFile(PHRASE, 'google-drive', AT);

      expect(result.status).toBe('failed');
    });

    it('is unsupported in a build with no Drive credentials', async () => {
      mockIsConfigured.mockReturnValue(false);

      const result = await exportRecoveryPhraseFile(PHRASE, 'google-drive', AT);

      expect(result.status).toBe('unsupported');
      expect(uploadFile).not.toHaveBeenCalled();
    });

    describe('a folder the member chose', () => {
      const CHOSEN = {
        id: 'folder_secret',
        name: 'Keys',
        path: ['Documents', 'Keys'],
        source: 'picked' as const,
      };

      it('is used instead of the backups folder, and survives a restart', async () => {
        await rememberRecoveryPhraseFolder(CHOSEN);

        // A fresh read, exactly as the next launch would do it.
        await expect(getRecoveryPhraseFolder()).resolves.toEqual(CHOSEN);

        const result = await exportRecoveryPhraseFile(PHRASE, 'google-drive', AT);

        expect(uploadFile).toHaveBeenCalledWith(
          expect.objectContaining({ folderId: 'folder_secret' }),
        );
        expect(mockResolveFolder).not.toHaveBeenCalled();
        // The trail, not the leaf: "Keys" alone sends someone hunting the root.
        expect(result.message).toMatch(/Documents › Keys/);
      });

      /**
       * A pointer goes stale silently when the folder is deleted in Drive's own
       * app, and Drive answers a write against a dead parent by dropping the
       * file at the account root — which is how a phrase ends up somewhere
       * nobody looks. Falling back beats both failing and silently misfiling.
       */
      it('is dropped for the backups folder once Drive says it is gone', async () => {
        await rememberRecoveryPhraseFolder(CHOSEN);
        folderExists.mockResolvedValue(false);

        const result = await exportRecoveryPhraseFile(PHRASE, 'google-drive', AT);

        expect(result.status).toBe('saved');
        expect(uploadFile).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'folder_1' }));
        // And forgotten, so the next save does not probe a dead id again.
        await expect(getRecoveryPhraseFolder()).resolves.toBeNull();
      });
    });

    /**
     * House's phrase pointer is its own key. Sharing the BACKUPS' pointer would
     * mean choosing where the phrase goes silently moved every future archive
     * with it, and House's archives and Budget's must never resolve through one
     * another either.
     */
    it('remembers the phrase folder under House\'s own key', async () => {
      await rememberRecoveryPhraseFolder({ id: 'f', name: 'Keys', source: 'picked' });

      expect([...mockStorage.keys()]).toEqual(['house.recoveryPhrase.driveFolder']);
    });
  });

  describe('device', () => {
    it('writes into the same folder the on-device archives use', async () => {
      const result = await exportRecoveryPhraseFile(PHRASE, 'device', AT);

      expect(result.status).toBe('saved');
      expect(mockWrite).toHaveBeenCalledWith(
        `file:///docs/house-backups/${FILE_NAME}`,
        expect.stringContaining('width'),
      );
      // Nothing to clean up: unlike the share path this copy is the point.
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it('creates the folder the first time, and says the copy is phone-bound', async () => {
      mockGetInfo.mockResolvedValueOnce({ exists: false });

      const result = await exportRecoveryPhraseFile(PHRASE, 'device', AT);

      expect(mockMakeDir).toHaveBeenCalledWith('file:///docs/house-backups/', {
        intermediates: true,
      });
      expect(result.message).toMatch(/on this device/i);
    });
  });

  describe('share', () => {
    it('writes a .txt into the cache and hands it to the share sheet', async () => {
      const result = await exportRecoveryPhraseFile(PHRASE, 'share', AT);

      expect(result.status).toBe('shared');
      expect(mockShare).toHaveBeenCalledWith(
        `file:///cache/${FILE_NAME}`,
        expect.objectContaining({ mimeType: 'text/plain' }),
      );
    });

    it('deletes the plaintext copy afterwards — including when sharing throws', async () => {
      mockShare.mockRejectedValueOnce(new Error('no'));

      const result = await exportRecoveryPhraseFile(PHRASE, 'share', AT);

      expect(result.status).toBe('failed');
      expect(result.message).toBe(RECOVERY_PHRASE_FILE_FAILED_MESSAGE);
      expect(mockDelete).toHaveBeenCalledWith(`file:///cache/${FILE_NAME}`, { idempotent: true });
    });
  });

  it('never writes a file for an empty phrase, wherever it was headed', async () => {
    for (const destination of ['share', 'device', 'google-drive'] as const) {
      const result = await exportRecoveryPhraseFile('   ', destination, AT);
      expect(result.status).toBe('failed');
    }
    expect(mockWrite).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
  });
});
