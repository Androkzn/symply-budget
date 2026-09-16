import * as FileSystem from 'expo-file-system/legacy';

import { bytesToHex, randomBytes } from '@symply/local-first';

import { getActiveBudgetHouseholdId, getLocalLedger, isLocalBudgetSessionOpen } from '../engine';

function wishMediaDir(): string {
  return `${FileSystem.documentDirectory ?? ''}wish-images/`;
}

function fileNameForKey(key: string): string {
  return key.split('/').pop() ?? key;
}

function localUriForKey(key: string): string {
  return `${wishMediaDir()}${fileNameForKey(key)}`;
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

async function ensureWishMediaDir(): Promise<void> {
  const dir = wishMediaDir();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

/**
 * Copy a picked/captured image into durable local storage; returns its image_key.
 *
 * Household-free on purpose: the bytes land in `documentDirectory`, which is
 * DEVICE storage shared by every household this device holds, and the key is 8
 * random bytes so two households cannot collide on one. The household boundary
 * for wish images lives in the ledger row that references the key, not in the
 * file — see `localWishesApi.uploadImage`, which writes that row through
 * `runOnHousehold`.
 */
export async function saveWishImageLocal(sourceUri: string): Promise<string> {
  await ensureWishMediaDir();
  const ext = extFromUri(sourceUri);
  const id = bytesToHex(randomBytes(8));
  const key = `wishes/local/${id}.${ext}`;
  const dest = localUriForKey(key);
  await FileSystem.copyAsync({ from: sourceUri, to: dest });
  return key;
}

/**
 * Resolve an image_key to a local file URI (ledger attachment or convention path).
 *
 * `householdId` is optional and additive so every existing call site keeps
 * compiling, but naming it is what makes this BR-016-correct: the attachment
 * lookup can only read the ACTIVE household's rows — this is a synchronous
 * render-path helper and there is no synchronous per-household ledger accessor
 * to hydrate a background household from. So when the caller names a household
 * that is not the active one, we skip the ledger entirely rather than answer B's
 * key out of A's table. The convention path below is the honest fallback: it is
 * derived from the key alone and is byte-identical to the `localUri` that
 * `uploadImage` stores, so for every key this device authored the two agree.
 *
 * The `isLocalBudgetSessionOpen()` guard is not defensive noise. `getLocalLedger`
 * throws `BudgetLocalNotReadyError` when no session is open, and this is called
 * while rendering a wish tile — a sign-out that lands between the render and the
 * image resolve would otherwise take the screen down instead of showing no photo.
 *
 * Known, unchanged and out of scope here: a peer-authored attachment row carries
 * the AUTHOR's device path, which does not exist on this device. That is the bug
 * every blob store in the fleet cites this file for; fixing it means content
 * addressing in the ledger row, not a change to this lookup.
 */
export function resolveWishImageUri(key: string, householdId?: string): string | null {
  const active = getActiveBudgetHouseholdId();
  if (isLocalBudgetSessionOpen() && (householdId === undefined || householdId === active)) {
    const attachment = getLocalLedger().wishAttachments?.find((a) => a.key === key);
    if (attachment?.localUri) return attachment.localUri;
  }
  if (!key.startsWith('wishes/local/')) return null;
  return localUriForKey(key);
}

export function localWishImageUriForKey(key: string): string {
  return localUriForKey(key);
}
