import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Linking, Platform } from 'react-native';

import {
  openBudgetBackupLocation,
  opensInFilesApp,
} from '../backup/backupFileAccess';

/**
 * Budget V2 — the Open button behind the backup location card.
 *
 * Pinned here: the button never dead-ends. Every path either lands the user
 * somewhere real or says, in words, why it could not — because the thing it
 * replaced ("Find it in Files → On My iPhone → Budget → budget-backups") was a
 * four-level path the user had to walk by hand, into a folder that was named
 * wrong, on a platform that sometimes could not show it at all.
 */

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));

const mockGetInfo = FileSystem.getInfoAsync as jest.Mock;
const mockIsAvailable = Sharing.isAvailableAsync as jest.Mock;
const mockShare = Sharing.shareAsync as jest.Mock;

function setPlatform(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
}

const DEVICE_FILE = {
  uri: 'file:///docs/budget-backups/symply-budget-backup-2026-08-16-0915.json',
  fileName: 'symply-budget-backup-2026-08-16-0915.json',
};

describe('backupFileAccess', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPlatform('ios');
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    mockGetInfo.mockResolvedValue({ exists: true });
    mockIsAvailable.mockResolvedValue(true);
    mockShare.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('opensInFilesApp', () => {
    it('is true only for an on-device file on iOS', () => {
      expect(opensInFilesApp(DEVICE_FILE.uri)).toBe(true);

      setPlatform('android');
      expect(opensInFilesApp(DEVICE_FILE.uri)).toBe(false);

      setPlatform('ios');
      expect(opensInFilesApp('content://tree/primary/backup.json')).toBe(false);
      expect(opensInFilesApp(null)).toBe(false);
    });
  });

  describe('openBudgetBackupLocation', () => {
    it('reveals the file in Files on iOS instead of describing the path', async () => {
      const result = await openBudgetBackupLocation(DEVICE_FILE);

      expect(result).toEqual({ status: 'opened' });
      expect(Linking.openURL).toHaveBeenCalledWith(
        'shareddocuments:///docs/budget-backups/symply-budget-backup-2026-08-16-0915.json',
      );
      expect(mockShare).not.toHaveBeenCalled();
    });

    it('falls back to the share sheet when Files refuses the reveal', async () => {
      (Linking.openURL as jest.Mock).mockRejectedValue(new Error('no handler'));

      const result = await openBudgetBackupLocation(DEVICE_FILE);

      expect(result).toEqual({ status: 'shared' });
      expect(mockShare).toHaveBeenCalledWith(
        DEVICE_FILE.uri,
        expect.objectContaining({ mimeType: 'application/json' }),
      );
    });

    it('shares rather than reveals on Android, where Files has no such scheme', async () => {
      setPlatform('android');

      const result = await openBudgetBackupLocation(DEVICE_FILE);

      expect(result).toEqual({ status: 'shared' });
      expect(Linking.openURL).not.toHaveBeenCalled();
      expect(mockShare).toHaveBeenCalled();
    });

    it('says the file is gone rather than opening a share sheet that will fail', async () => {
      mockGetInfo.mockResolvedValue({ exists: false });

      const result = await openBudgetBackupLocation(DEVICE_FILE);

      expect(result.status).toBe('unavailable');
      expect(result).toHaveProperty('message', expect.stringContaining(DEVICE_FILE.fileName));
      expect(Linking.openURL).not.toHaveBeenCalled();
      expect(mockShare).not.toHaveBeenCalled();
    });

    it('explains itself when the copy lives somewhere this phone cannot reach', async () => {
      // Cloud uploads and share-sheet hand-offs leave no local uri — the card
      // hides the button, and a caller that asks anyway gets a reason.
      const result = await openBudgetBackupLocation({ uri: null, fileName: 'backup.json' });

      expect(result.status).toBe('unavailable');
      expect(mockShare).not.toHaveBeenCalled();
    });

    it('reports a device with no share support instead of throwing', async () => {
      setPlatform('android');
      mockIsAvailable.mockResolvedValue(false);

      const result = await openBudgetBackupLocation(DEVICE_FILE);

      expect(result.status).toBe('unavailable');
      expect(mockShare).not.toHaveBeenCalled();
    });
  });
});
