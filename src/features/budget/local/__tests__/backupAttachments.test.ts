/**
 * Attachment bytes in a backup.
 *
 * The gap these close: `wishAttachments` rows carry a `localUri` and the image
 * bytes live at that path in device storage, NOT in the ledger. So a restore
 * onto a new phone — the case backups exist for — brought every wish back with
 * a broken thumbnail, and said nothing about it, because the rows really were
 * complete. What was missing was never in the archive to begin with.
 */
import * as FileSystem from 'expo-file-system/legacy';

import {
  BUDGET_BACKUP_ATTACHMENT_BUDGET_BYTES,
  collectAttachmentBlobs,
  restoreAttachmentBlobs,
} from '../backup/backupAttachments';
import type { LocalBudgetLedger } from '../engine';

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  cacheDirectory: 'file:///cache/',
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(async () => undefined),
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  copyAsync: jest.fn(async () => undefined),
}));

jest.mock('../engine', () => ({
  getActiveBudgetHouseholdId: () => 'hh1',
  getLocalLedger: () => ({ wishAttachments: [] }),
  isLocalBudgetSessionOpen: () => true,
}));

const mockInfo = FileSystem.getInfoAsync as jest.Mock;
const mockRead = FileSystem.readAsStringAsync as jest.Mock;
const mockWrite = FileSystem.writeAsStringAsync as jest.Mock;

/** A ledger carrying nothing but the attachment rows under test. */
function ledgerWith(
  rows: Array<{ id: string; key: string; localUri: string; mime: string }>,
): LocalBudgetLedger {
  return { wishAttachments: rows } as unknown as LocalBudgetLedger;
}

function attachment(n: number, uri = `file:///docs/wish-images/${n}.jpg`) {
  return { id: `wat${n}`, key: `wishes/local/${n}.jpg`, localUri: uri, mime: 'image/jpeg' };
}

/** `bytes` of on-disk size becomes ceil(bytes/3)*4 base64 characters. */
function base64Of(bytes: number): string {
  return 'A'.repeat(Math.ceil(bytes / 3) * 4);
}

describe('backup attachments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInfo.mockImplementation(async () => ({ exists: true, isDirectory: false, size: 300 }));
    mockRead.mockImplementation(async () => base64Of(300));
  });

  describe('collecting', () => {
    it('carries the bytes of every attachment that fits', async () => {
      const collected = await collectAttachmentBlobs(
        ledgerWith([attachment(1), attachment(2)]),
        BUDGET_BACKUP_ATTACHMENT_BUDGET_BYTES,
      );

      expect(collected.includedCount).toBe(2);
      expect(collected.skippedCount).toBe(0);
      expect(collected.totalCount).toBe(2);
      expect(collected.blobs.map((blob) => blob.key)).toEqual([
        'wishes/local/1.jpg',
        'wishes/local/2.jpg',
      ]);
      expect(collected.bytes).toBe(base64Of(300).length * 2);
    });

    it('spends the budget on the smallest first, and counts what it left out', async () => {
      // Newest-first would let one big screenshot evict several thumbnails;
      // smallest-first fits the most pictures into the space there is.
      const sizes: Record<string, number> = {
        'file:///docs/wish-images/1.jpg': 9_000,
        'file:///docs/wish-images/2.jpg': 300,
        'file:///docs/wish-images/3.jpg': 600,
      };
      mockInfo.mockImplementation(async (uri: string) => ({
        exists: true,
        isDirectory: false,
        size: sizes[uri] ?? 0,
      }));
      mockRead.mockImplementation(async (uri: string) => base64Of(sizes[uri] ?? 0));

      const collected = await collectAttachmentBlobs(
        ledgerWith([attachment(1), attachment(2), attachment(3)]),
        base64Of(300).length + base64Of(600).length,
      );

      expect(collected.blobs.map((blob) => blob.key)).toEqual([
        'wishes/local/2.jpg',
        'wishes/local/3.jpg',
      ]);
      // The 9 KB one did not fit and is REPORTED, not silently dropped — the
      // backup summary is what tells the member their photos are not all here.
      expect(collected.skippedCount).toBe(1);
      expect(collected.totalCount).toBe(3);
    });

    it('skips a file that is gone rather than failing the backup', async () => {
      mockInfo.mockImplementation(async (uri: string) =>
        uri.endsWith('1.jpg')
          ? { exists: false }
          : { exists: true, isDirectory: false, size: 300 },
      );

      const collected = await collectAttachmentBlobs(
        ledgerWith([attachment(1), attachment(2)]),
        BUDGET_BACKUP_ATTACHMENT_BUDGET_BYTES,
      );

      expect(collected.includedCount).toBe(1);
      expect(collected.skippedCount).toBe(1);
    });

    it('survives a read that throws mid-collection', async () => {
      mockRead.mockImplementation(async (uri: string) => {
        if (uri.endsWith('1.jpg')) throw new Error('unreadable');
        return base64Of(300);
      });

      const collected = await collectAttachmentBlobs(
        ledgerWith([attachment(1), attachment(2)]),
        BUDGET_BACKUP_ATTACHMENT_BUDGET_BYTES,
      );

      expect(collected.includedCount).toBe(1);
      expect(collected.skippedCount).toBe(1);
    });

    it('takes nothing when the budget is already spent', async () => {
      const collected = await collectAttachmentBlobs(ledgerWith([attachment(1)]), 0);

      expect(collected.blobs).toEqual([]);
      expect(collected.skippedCount).toBe(1);
      expect(mockRead).not.toHaveBeenCalled();
    });

    it('is a no-op for a household with no attachments', async () => {
      const collected = await collectAttachmentBlobs(
        ledgerWith([]),
        BUDGET_BACKUP_ATTACHMENT_BUDGET_BYTES,
      );
      expect(collected).toEqual({
        blobs: [],
        totalCount: 0,
        includedCount: 0,
        skippedCount: 0,
        bytes: 0,
      });
    });
  });

  describe('restoring', () => {
    it('writes bytes to the convention path, not the archived one', async () => {
      mockInfo.mockImplementation(async () => ({ exists: true, isDirectory: true }));

      const restored = await restoreAttachmentBlobs(
        JSON.stringify([
          // A path from the phone that MADE the backup. iOS hands each install a
          // fresh container UUID, so this is dead here even on the same device.
          { key: 'wishes/local/9.jpg', mime: 'image/jpeg', dataB64: 'QUJD' },
        ]),
      );

      expect(restored.restoredCount).toBe(1);
      expect(mockWrite).toHaveBeenCalledWith(
        'file:///docs/wish-images/9.jpg',
        'QUJD',
        expect.objectContaining({ encoding: 'base64' }),
      );
      expect(restored.uriByKey.get('wishes/local/9.jpg')).toBe('file:///docs/wish-images/9.jpg');
    });

    it('creates the media folder when the device has none yet', async () => {
      mockInfo.mockImplementation(async () => ({ exists: false }));

      await restoreAttachmentBlobs(
        JSON.stringify([{ key: 'wishes/local/9.jpg', mime: 'image/jpeg', dataB64: 'QUJD' }]),
      );

      expect(FileSystem.makeDirectoryAsync).toHaveBeenCalledWith(
        'file:///docs/wish-images/',
        expect.objectContaining({ intermediates: true }),
      );
    });

    it('keeps going when one photo cannot be written', async () => {
      mockInfo.mockImplementation(async () => ({ exists: true, isDirectory: true }));
      (mockWrite as jest.Mock).mockImplementation(async (uri: string) => {
        if (uri.endsWith('1.jpg')) throw new Error('disk full');
      });

      const restored = await restoreAttachmentBlobs(
        JSON.stringify([
          { key: 'wishes/local/1.jpg', mime: 'image/jpeg', dataB64: 'QUJD' },
          { key: 'wishes/local/2.jpg', mime: 'image/jpeg', dataB64: 'QUJD' },
        ]),
      );

      // A wish with a missing photo is a wish; a restore abandoned halfway
      // because of one photo is a loss.
      expect(restored.restoredCount).toBe(1);
      expect(restored.failedCount).toBe(1);
    });

    it('treats an absent or unparseable sidecar as no attachments', async () => {
      await expect(restoreAttachmentBlobs(undefined)).resolves.toEqual({
        restoredCount: 0,
        failedCount: 0,
        uriByKey: new Map(),
      });
      await expect(restoreAttachmentBlobs('not json')).resolves.toEqual({
        restoredCount: 0,
        failedCount: 0,
        uriByKey: new Map(),
      });
      await expect(restoreAttachmentBlobs('{"not":"an array"}')).resolves.toEqual({
        restoredCount: 0,
        failedCount: 0,
        uriByKey: new Map(),
      });
    });
  });
});
