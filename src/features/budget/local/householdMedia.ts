import * as FileSystem from 'expo-file-system/legacy';

import { bytesToHex, randomBytes } from '@symply/local-first';

/**
 * The household photo's bytes, on this device.
 *
 * Same shape as `wishes/localWishMedia.ts` and for the same reasons: the file
 * lands in `documentDirectory`, which is DEVICE storage shared by every
 * household this device holds, and the key carries 8 random bytes so two
 * households cannot collide on one. The household boundary lives in the record
 * that references the key — here the sealed identity blob — not in the file.
 *
 * Known and shared with wish images: a peer that receives this household's
 * record gets the KEY, not the bytes, so a photo added on one phone does not
 * appear on another. Budget has no encrypted blob channel (House's
 * `features/house/local/blobs` is the fleet's only one), and inventing one for
 * a household avatar is not the trade this screen is making. A peer therefore
 * renders the placeholder, which is what it did before the photo existed.
 */

const DIR_NAME = 'household-images/';

function mediaDir(): string {
  return `${FileSystem.documentDirectory ?? ''}${DIR_NAME}`;
}

function fileNameForKey(key: string): string {
  return key.split('/').pop() ?? key;
}

function localUriForKey(key: string): string {
  return `${mediaDir()}${fileNameForKey(key)}`;
}

function extFromUri(uri: string): string {
  const match = uri.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  if (match) {
    const ext = match[1].toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'].includes(ext)) {
      return ext === 'jpeg' ? 'jpg' : ext;
    }
  }
  return 'jpg';
}

async function ensureMediaDir(): Promise<void> {
  const dir = mediaDir();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

/** Copy a picked/captured image into durable local storage; returns its key. */
export async function saveHouseholdImageLocal(sourceUri: string): Promise<string> {
  await ensureMediaDir();
  const ext = extFromUri(sourceUri);
  const key = `households/local/${bytesToHex(randomBytes(8))}.${ext}`;
  await FileSystem.copyAsync({ from: sourceUri, to: localUriForKey(key) });
  return key;
}

/**
 * Resolve a household photo key to a local file URI, or null when the key names
 * something this device did not write.
 *
 * Derived from the key alone — no ledger read — so it is safe on a render path
 * and answers for a BACKGROUND household as readily as the active one, which is
 * what the household list needs.
 */
export function resolveHouseholdImageUri(key: string | null | undefined): string | null {
  if (!key || !key.startsWith('households/local/')) return null;
  return localUriForKey(key);
}

/**
 * Best-effort delete of a photo this device no longer references.
 *
 * Never throws: the record has already stopped pointing at the file by the time
 * this runs, so a failure here leaves an orphaned image, not a broken household
 * — and failing the save over it would be the worse trade.
 */
export async function deleteHouseholdImageLocal(key: string | null | undefined): Promise<void> {
  const uri = resolveHouseholdImageUri(key);
  if (!uri) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Orphaned bytes are harmless; a failed save over them would not be.
  }
}
