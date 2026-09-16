import * as FileSystem from 'expo-file-system/legacy';

import type { LocalBudgetLedger, LocalWishAttachment } from '../engine';
import { localWishImageUriForKey } from '../wishes/localWishMedia';

/**
 * Attachment bytes inside a backup bundle.
 *
 * ## The gap this closes
 *
 * `wishAttachments` rows carry a `localUri` — a `file:///…/wish-images/x.jpg`
 * path — and the image bytes live at that path in device storage, not in the
 * ledger. So the archive restored the ROW and never the picture: a member who
 * restored onto a new phone (the case backups exist for) got every wish back
 * with a broken thumbnail, and nothing in the restore summary said so. The rows
 * looked complete because they were; the data they pointed at was gone.
 *
 * ## Why there is a budget rather than "back up everything"
 *
 * Photos are unbounded. A member who attached forty receipt shots has ~80 MB of
 * JPEG, which base64 inflates by a third before AES-GCM sees it, and the result
 * has to be held in memory as a JS string, encrypted, JSON-stringified and then
 * uploaded to Drive from a phone. That is where a backup stops completing at all
 * — and a backup that fails is worth less than one that saves the ledger and
 * says which photos it could not carry.
 *
 * So the bytes ride along up to `BUDGET_BACKUP_ATTACHMENT_BUDGET_BYTES` across
 * the whole bundle, and past that they are counted and reported rather than
 * silently dropped. The ledger rows always travel in full: a wish never
 * disappears because its photo was too big.
 *
 * ## Smallest first
 *
 * Within the budget, small attachments are taken first, which fits the most
 * pictures into the space. The alternative — newest first — sounds fairer but
 * lets one 12 MB screenshot evict thirty thumbnails, and there is no reading of
 * "back up my data" under which that is the better trade.
 */

/** Total base64 payload allowed across every household in one bundle. */
export const BUDGET_BACKUP_ATTACHMENT_BUDGET_BYTES = 25 * 1024 * 1024;

export type BackupAttachmentBlob = {
  /** The ledger `image_key` — `localUri` is re-derived from it on restore. */
  key: string;
  mime: string;
  /** File bytes, base64. */
  dataB64: string;
};

export type CollectedAttachments = {
  blobs: BackupAttachmentBlob[];
  /** How many attachment rows this household has at all. */
  totalCount: number;
  includedCount: number;
  /** Rows whose bytes were left out — over budget, missing file, or unreadable. */
  skippedCount: number;
  /** Base64 characters taken, which is what the bundle actually grows by. */
  bytes: number;
};

export const EMPTY_COLLECTED_ATTACHMENTS: CollectedAttachments = {
  blobs: [],
  totalCount: 0,
  includedCount: 0,
  skippedCount: 0,
  bytes: 0,
};

/** Where an attachment's bytes are on THIS device, or null when unreadable. */
function attachmentUri(attachment: LocalWishAttachment): string | null {
  const uri = attachment.localUri?.trim();
  if (uri) return uri;
  // A row authored by a peer has no usable `localUri` for us, but the convention
  // path is derived from the key alone and is where this device would have put
  // the file — worth a look before giving up.
  return attachment.key ? localWishImageUriForKey(attachment.key) : null;
}

async function sizeOf(uri: string): Promise<number | null> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists || info.isDirectory) return null;
    return typeof info.size === 'number' ? info.size : null;
  } catch {
    return null;
  }
}

/**
 * Read one household's attachment bytes, up to `budgetBytes`.
 *
 * Never throws: a backup must not fail because one photo was deleted out from
 * under it. Everything it could not take is counted in `skippedCount`, which the
 * backup summary reports.
 */
export async function collectAttachmentBlobs(
  ledger: LocalBudgetLedger,
  budgetBytes: number,
): Promise<CollectedAttachments> {
  const rows = ledger.wishAttachments ?? [];
  if (rows.length === 0 || budgetBytes <= 0) {
    return { ...EMPTY_COLLECTED_ATTACHMENTS, totalCount: rows.length, skippedCount: rows.length };
  }

  // Size every candidate first so the budget can be spent on the smallest ones.
  // One `getInfoAsync` per row is cheap next to reading the file.
  const sized = await Promise.all(
    rows.map(async (row) => {
      const uri = attachmentUri(row);
      if (!uri) return null;
      const size = await sizeOf(uri);
      return size === null ? null : { row, uri, size };
    }),
  );

  const candidates = sized
    .filter((entry): entry is { row: LocalWishAttachment; uri: string; size: number } => !!entry)
    .sort((a, b) => a.size - b.size);

  const blobs: BackupAttachmentBlob[] = [];
  let spent = 0;

  for (const candidate of candidates) {
    // Base64 is 4 characters per 3 bytes; charge the budget what the bundle
    // actually grows by rather than the on-disk size.
    const encodedSize = Math.ceil(candidate.size / 3) * 4;
    if (spent + encodedSize > budgetBytes) {
      // Sorted ascending, so every remaining candidate is at least this big —
      // stop rather than keep probing files that cannot fit either.
      break;
    }
    try {
      const dataB64 = await FileSystem.readAsStringAsync(candidate.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      blobs.push({ key: candidate.row.key, mime: candidate.row.mime || 'image/jpeg', dataB64 });
      spent += dataB64.length;
    } catch (error) {
      console.warn('[budget-backup] could not read attachment', candidate.row.key, error);
    }
  }

  // Everything not carried is skipped, whatever the reason — over budget, file
  // gone, unreadable. The caller reports a count, not a taxonomy.
  return {
    blobs,
    totalCount: rows.length,
    includedCount: blobs.length,
    skippedCount: rows.length - blobs.length,
    bytes: spent,
  };
}

export type RestoredAttachments = {
  restoredCount: number;
  failedCount: number;
  /** `key → localUri` for everything written, to re-point the restored rows. */
  uriByKey: Map<string, string>;
};

/**
 * Write attachment bytes back to device storage.
 *
 * The destination is `localWishImageUriForKey(key)` — the convention path, NOT
 * whatever `localUri` the row carried. The archived path belongs to the phone
 * that made the backup and means nothing here; the convention path is what this
 * device's own uploads use and what `resolveWishImageUri` falls back to, so
 * writing there makes the picture visible whether or not the row is re-pointed.
 */
export async function restoreAttachmentBlobs(
  attachmentsJson: string | undefined,
): Promise<RestoredAttachments> {
  const empty: RestoredAttachments = { restoredCount: 0, failedCount: 0, uriByKey: new Map() };
  if (!attachmentsJson) return empty;

  let blobs: BackupAttachmentBlob[];
  try {
    const parsed = JSON.parse(attachmentsJson) as unknown;
    if (!Array.isArray(parsed)) return empty;
    blobs = parsed as BackupAttachmentBlob[];
  } catch {
    return empty;
  }
  if (blobs.length === 0) return empty;

  const uriByKey = new Map<string, string>();
  let restored = 0;
  let failed = 0;

  for (const blob of blobs) {
    if (!blob?.key || typeof blob.dataB64 !== 'string') {
      failed += 1;
      continue;
    }
    const uri = localWishImageUriForKey(blob.key);
    try {
      await ensureDirFor(uri);
      await FileSystem.writeAsStringAsync(uri, blob.dataB64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      uriByKey.set(blob.key, uri);
      restored += 1;
    } catch (error) {
      // One unwritable photo must not abort a restore that is otherwise landing
      // a whole household's ledger.
      console.warn('[budget-restore] could not write attachment', blob.key, error);
      failed += 1;
    }
  }

  return { restoredCount: restored, failedCount: failed, uriByKey };
}

async function ensureDirFor(uri: string): Promise<void> {
  const dir = uri.slice(0, uri.lastIndexOf('/') + 1);
  if (!dir) return;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}
