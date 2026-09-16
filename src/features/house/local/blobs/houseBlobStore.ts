/**
 * House attachment channel — device side (plan §8, stage H6).
 *
 * Budget's attachment story is the documented counter-example this replaces:
 * `localWishMedia.ts` copies the picked image into `documentDirectory` and puts
 * only `{id, key, localUri, mime}` in the ledger. **The row syncs; the bytes do
 * not**, so a peer gets a `localUri` pointing at a file that does not exist on
 * its device and `resolveWishImageUri` hands that dead path straight to the
 * renderer. House has 25 blob-bearing tables and for several of them the bytes
 * ARE the feature, so the ledger row here stores a *content descriptor* —
 * `{blobId, mime, bytes, sha256, chunkCount, keyEpoch}` — and **never a device
 * path**.
 *
 * Three directories, with different lifetimes, and mixing them up is the whole
 * class of bug this layout prevents:
 *
 *   documentDirectory/lf-blob-staging/{blobId}/{index}
 *     Sealed envelopes, written BEFORE the first PUT and re-read on resume.
 *     Durable because losing one mid-upload would force a re-seal, and a re-seal
 *     mints a second nonce for the same (contentKey, chunkIndex) — the GCM
 *     nonce-reuse bug the plan calls out by name. Deleted only once the upload
 *     is finalized.
 *
 *   cacheDirectory/lf-blobs/{blobId}
 *     Decrypted plaintext, LRU-evictable. iOS may reclaim `cacheDirectory` at
 *     will, which is correct: the bytes are re-fetchable from R2, so losing them
 *     costs a download, not data.
 *
 *   documentDirectory/lf-blob-origin/{blobId}
 *     The authoring device's copy of a file it has not finished uploading, so an
 *     attachment picked offline survives an app restart.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { base64ToBytes, bytesToBase64, bytesToHex, randomBytes } from '@symply/local-first';

import { getActiveHouseholdId, getLocalHouseSession } from '../engine';

import {
  BLOB_MAX_PLAINTEXT_BYTES,
  BLOB_PLAINTEXT_CHUNK,
  blobChunkCount,
  createBlobHasher,
  deriveBlobContentKey,
  openBlobChunk,
  sealBlobChunk,
  type BlobKeyContext,
} from './blobCrypto';
import {
  deleteRemoteBlob,
  fetchBlobChunk,
  fetchBlobManifest,
  fetchBlobUsage,
  finalizeBlob,
  putBlobChunk,
  type RemoteBlobUsage,
} from './blobTransport';

/**
 * What the ledger row stores. Everything here is either content-derived or a
 * server-side identifier — nothing is device-specific, which is exactly the
 * property Budget's wish-media descriptor lacked.
 */
export type HouseBlobDescriptor = {
  blobId: string;
  mime: string;
  bytes: number;
  sha256: string;
  chunkCount: number;
  keyEpoch: number;
};

export type HouseBlobProgress = {
  chunkIndex: number;
  chunkCount: number;
  percent: number;
};

/** Plaintext cache budget. Photos dominate; a few hundred MB is one album. */
export const BLOB_CACHE_BUDGET_BYTES = 256 * 1024 * 1024;

const STAGING_DIR = 'lf-blob-staging';
const ORIGIN_DIR = 'lf-blob-origin';
const CACHE_DIR = 'lf-blobs';

export class HouseBlobTooLargeError extends Error {
  readonly code = 'blob_too_large';
  constructor(readonly bytes: number) {
    super(`Attachment is larger than the ${BLOB_MAX_PLAINTEXT_BYTES} byte limit`);
    this.name = 'HouseBlobTooLargeError';
  }
}

/**
 * The blob was sealed under a household key epoch **this device** never held.
 *
 * Since the §8.2 keyring landed, a rotation no longer orphans attachments: the
 * outgoing HDK is retained per property and persisted with the session, so a
 * device that was present for epoch N can still open epoch-N blobs after
 * rotating to N+1.
 *
 * What remains genuinely unreadable is a blob sealed before this device
 * enrolled — it was never given that epoch's key, and no amount of retention on
 * this device can conjure it. A longer-lived peer can still open it. This error
 * makes that a named, explainable state instead of a bare AEAD failure.
 */
export class HouseBlobKeyUnavailableError extends Error {
  readonly code = 'blob_key_unavailable';
  constructor(
    readonly blobId: string,
    readonly sealedEpoch: number,
    readonly currentEpoch: number,
  ) {
    super('Attachment was encrypted with a household key this device no longer has');
    this.name = 'HouseBlobKeyUnavailableError';
  }
}

export class HouseBlobCorruptError extends Error {
  readonly code = 'blob_corrupt';
  constructor(
    readonly blobId: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super('Attachment failed its integrity check');
    this.name = 'HouseBlobCorruptError';
  }
}

// --- paths ------------------------------------------------------------------

function docDir(): string {
  return FileSystem.documentDirectory ?? '';
}

function cacheDir(): string {
  return FileSystem.cacheDirectory ?? '';
}

function stagingDirFor(blobId: string): string {
  return `${docDir()}${STAGING_DIR}/${blobId}/`;
}

function stagedChunkUri(blobId: string, index: number): string {
  return `${stagingDirFor(blobId)}${index}`;
}

function originUri(blobId: string): string {
  return `${docDir()}${ORIGIN_DIR}/${blobId}`;
}

export function cachedBlobUri(blobId: string): string {
  return `${cacheDir()}${CACHE_DIR}/${blobId}`;
}

async function ensureDir(uri: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
  }
}

/** Size in bytes, or 0 for "absent or a directory" — the only distinction the
 * callers here need. `FileInfo` always carries `size` when `exists` is true. */
async function fileSize(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists && !info.isDirectory ? Number(info.size ?? 0) : 0;
}

async function removeIfPresent(uri: string): Promise<void> {
  await FileSystem.deleteAsync(uri, { idempotent: true });
}

// --- session -----------------------------------------------------------------

async function keyContextFor(
  blobId: string,
  householdIdInput?: string,
): Promise<{
  ctx: BlobKeyContext;
  contentKey: Uint8Array;
  session: Awaited<ReturnType<typeof getLocalHouseSession>>;
}> {
  const householdId = householdIdInput ?? getActiveHouseholdId();
  if (!householdId) throw new Error('house blobs: no property is active');
  const session = await getLocalHouseSession(householdId);
  const ctx: BlobKeyContext = {
    householdId,
    keyEpoch: session.householdKeys.keyEpoch,
    blobId,
  };
  return { ctx, contentKey: deriveBlobContentKey(session.householdKeys.hdk, ctx), session };
}

/** New blob id. Random, not content-derived: two members attaching the same
 * photo must not collide on one R2 object with two different content keys. */
export function newBlobId(): string {
  return `blob_${bytesToHex(randomBytes(12))}`;
}

/**
 * Synthetic key namespace for a row whose BYTES went through H6.
 *
 * Every table that carries attachments has a `notNull` key column inherited from
 * D1 — `TaskPhoto.photo_key`, `ApplianceDocument.r2_key`, `Household.photo_key` —
 * and a blob-backed row has no R2 object to name. Rather than loosen those types
 * (and let a genuinely keyless row through by accident) the key takes this
 * namespace: unique, stable across a re-save, and instantly recognisable as "the
 * bytes are NOT at `/files/<key>`".
 *
 * It lives HERE, beside the descriptor it is derived from, because it is a fact
 * about the blob channel rather than about any one table. It used to live in
 * `@utils/taskPhotoSave` — which pulls the image picker and the legacy uploader
 * into the graph of anything that imports it — so `localAppliancesApi` restated
 * the literal rather than import that, and a test regex-scraped both files to
 * check the two still agreed. One definition removes the need for the check.
 */
export const BLOB_KEY_PREFIX = 'lf-blob/';

/** The synthetic key for a row whose bytes are in the blob channel. */
export function blobKeyFor(descriptor: HouseBlobDescriptor): string {
  return `${BLOB_KEY_PREFIX}${descriptor.blobId}`;
}

/** True when this key names a blob descriptor rather than an R2 object. */
export function isBlobKey(key: string | null | undefined): boolean {
  return typeof key === 'string' && key.startsWith(BLOB_KEY_PREFIX);
}

// --- upload -------------------------------------------------------------------

/**
 * Seal a local file into the household's blob channel and return the descriptor
 * the ledger row stores.
 *
 * Resumable by construction: every chunk is staged to disk before it is PUT, and
 * a re-run re-reads the staged envelope rather than re-sealing. Calling this
 * again with the same `blobId` after a crash resumes; calling it without one
 * starts fresh.
 */
export async function uploadHouseBlob(input: {
  sourceUri: string;
  mime: string;
  blobId?: string;
  householdId?: string;
  onProgress?: (progress: HouseBlobProgress) => void;
}): Promise<HouseBlobDescriptor> {
  const blobId = input.blobId ?? newBlobId();
  const { ctx, contentKey } = await keyContextFor(blobId, input.householdId);

  const size = await fileSize(input.sourceUri);
  if (size <= 0) {
    throw new Error('house blobs: source file is empty or unreadable');
  }
  if (size > BLOB_MAX_PLAINTEXT_BYTES) {
    throw new HouseBlobTooLargeError(size);
  }

  const chunkCount = blobChunkCount(size);
  await ensureDir(stagingDirFor(blobId));
  const hasher = createBlobHasher();

  for (let index = 0; index < chunkCount; index += 1) {
    const position = index * BLOB_PLAINTEXT_CHUNK;
    const length = Math.min(BLOB_PLAINTEXT_CHUNK, size - position);
    const plaintext = base64ToBytes(
      await FileSystem.readAsStringAsync(input.sourceUri, {
        encoding: FileSystem.EncodingType.Base64,
        position,
        length,
      }),
    );
    // The hash covers the plaintext in order, so it has to be updated on every
    // pass — including the passes whose ciphertext is already staged.
    hasher.update(plaintext);

    const stagedUri = stagedChunkUri(blobId, index);
    let envelope: Uint8Array;
    const staged = await fileSize(stagedUri);
    if (staged > 0) {
      // Resume: re-send the EXACT envelope, nonce included. Re-sealing here
      // would be a GCM nonce reuse under the same (contentKey, chunkIndex).
      envelope = base64ToBytes(
        await FileSystem.readAsStringAsync(stagedUri, {
          encoding: FileSystem.EncodingType.Base64,
        }),
      );
    } else {
      envelope = sealBlobChunk({
        contentKey,
        ctx,
        chunkIndex: index,
        chunkCount,
        plaintext,
      });
      await FileSystem.writeAsStringAsync(stagedUri, bytesToBase64(envelope), {
        encoding: FileSystem.EncodingType.Base64,
      });
    }

    await putBlobChunk({
      householdId: ctx.householdId,
      blobId,
      keyEpoch: ctx.keyEpoch,
      chunkIndex: index,
      chunkCount,
      envelope,
    });

    input.onProgress?.({
      chunkIndex: index,
      chunkCount,
      percent: Math.round(((index + 1) / chunkCount) * 100),
    });
  }

  await finalizeBlob({ householdId: ctx.householdId, blobId, chunkCount });
  // Only now are the staged envelopes disposable — before finalize, a crash
  // still needs them to resume without re-sealing.
  await removeIfPresent(stagingDirFor(blobId));

  const descriptor: HouseBlobDescriptor = {
    blobId,
    mime: input.mime,
    bytes: size,
    sha256: hasher.digestHex(),
    chunkCount,
    keyEpoch: ctx.keyEpoch,
  };

  // Seed the cache from the authoring device's own copy so the member who just
  // attached the file does not download it back from R2 to look at it.
  await ensureDir(`${cacheDir()}${CACHE_DIR}/`);
  await FileSystem.copyAsync({ from: input.sourceUri, to: cachedBlobUri(blobId) });
  await removeIfPresent(originUri(blobId));

  return descriptor;
}

/** Keep a picked file alive across restarts before its upload finishes. */
export async function stageHouseBlobOrigin(sourceUri: string, blobId: string): Promise<string> {
  await ensureDir(`${docDir()}${ORIGIN_DIR}/`);
  const dest = originUri(blobId);
  await FileSystem.copyAsync({ from: sourceUri, to: dest });
  return dest;
}

// --- download -----------------------------------------------------------------

/**
 * Resolve a descriptor to a local plaintext file, fetching and decrypting on
 * first view.
 *
 * The `sha256` check is not ceremony: it is what turns "a peer silently rendered
 * a truncated or substituted file" into a surfaced error. The per-chunk AAD
 * already rejects reordering and cross-blob splicing; this catches the case
 * where every chunk is authentic but the set is not the file the row describes.
 */
export async function resolveHouseBlobUri(
  descriptor: HouseBlobDescriptor,
  options: { householdId?: string; forceRefresh?: boolean } = {},
): Promise<string> {
  const cached = cachedBlobUri(descriptor.blobId);
  if (!options.forceRefresh && (await fileSize(cached)) > 0) {
    // Touch so LRU eviction sees the read, not just the write.
    await FileSystem.getInfoAsync(cached);
    return cached;
  }

  const { ctx, contentKey, session } = await keyContextFor(descriptor.blobId, options.householdId);
  // The descriptor's epoch is authoritative. `revokeLocalFirstDevice` rotates by
  // minting a WHOLE NEW random HDK, so a blob sealed before that rotation cannot
  // be opened with the current key — it needs the retired one for its epoch
  // (H6 §8.2). Deriving with the current HDK under the old epoch's info string
  // would silently produce a wrong key, so the epoch selects the HDK first.
  const sealedCtx: BlobKeyContext = { ...ctx, keyEpoch: descriptor.keyEpoch };
  let sealedKey: Uint8Array;
  if (descriptor.keyEpoch === ctx.keyEpoch) {
    sealedKey = contentKey;
  } else {
    const retiredHdk = session.retiredHouseholdKeys.get(descriptor.keyEpoch);
    if (!retiredHdk) {
      // This device never held that epoch — it enrolled after the rotation, so
      // the key is genuinely unavailable here even though a longer-lived peer
      // can still read the blob. A named error, never a bare AEAD failure.
      throw new HouseBlobKeyUnavailableError(
        descriptor.blobId,
        descriptor.keyEpoch,
        ctx.keyEpoch,
      );
    }
    sealedKey = deriveBlobContentKey(retiredHdk, sealedCtx);
  }

  const parts: Uint8Array[] = [];
  let total = 0;
  for (let index = 0; index < descriptor.chunkCount; index += 1) {
    const envelope = await fetchBlobChunk(ctx.householdId, descriptor.blobId, index);
    const plaintext = openBlobChunk({
      contentKey: sealedKey,
      ctx: sealedCtx,
      chunkIndex: index,
      chunkCount: descriptor.chunkCount,
      envelope,
    });
    total += plaintext.length;
    if (total > BLOB_MAX_PLAINTEXT_BYTES) {
      throw new HouseBlobTooLargeError(total);
    }
    parts.push(plaintext);
  }

  const plaintext = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    plaintext.set(part, offset);
    offset += part.length;
  }

  const hasher = createBlobHasher();
  hasher.update(plaintext);
  const actual = hasher.digestHex();
  if (actual !== descriptor.sha256) {
    throw new HouseBlobCorruptError(descriptor.blobId, descriptor.sha256, actual);
  }

  await ensureDir(`${cacheDir()}${CACHE_DIR}/`);
  await FileSystem.writeAsStringAsync(cached, bytesToBase64(plaintext), {
    encoding: FileSystem.EncodingType.Base64,
  });
  await evictHouseBlobCache();
  return cached;
}

/**
 * Local-only check, for a renderer that must decide between "show the image" and
 * "show a download affordance" without touching the network. The plan's fetch
 * policy is lazy-on-first-view with an explicit download on cellular, and that
 * choice needs a synchronous-ish answer.
 */
export async function isHouseBlobCached(blobId: string): Promise<boolean> {
  return (await fileSize(cachedBlobUri(blobId))) > 0;
}

// --- delete + cache -----------------------------------------------------------

/**
 * Tombstone the blob and drop every local copy.
 *
 * Called when the owning ledger row is deleted. The server keeps the bytes until
 * the checkpoint watermark passes (Q4), so a peer mid-bootstrap is not stranded.
 */
export async function deleteHouseBlob(blobId: string, householdIdInput?: string): Promise<void> {
  const householdId = householdIdInput ?? getActiveHouseholdId();
  if (householdId) {
    await deleteRemoteBlob(householdId, blobId);
  }
  await removeIfPresent(cachedBlobUri(blobId));
  await removeIfPresent(stagingDirFor(blobId));
  await removeIfPresent(originUri(blobId));
}

/**
 * LRU eviction over the plaintext cache.
 *
 * Ordered by `modificationTime` rather than a separately tracked access log: the
 * log would be one more thing to keep consistent across a crash, and re-reading
 * a cached blob already touches the file. Worst case a hot-but-never-rewritten
 * blob is evicted and re-downloaded once.
 */
export async function evictHouseBlobCache(
  budgetBytes = BLOB_CACHE_BUDGET_BYTES,
): Promise<number> {
  const dir = `${cacheDir()}${CACHE_DIR}/`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) return 0;

  const names = await FileSystem.readDirectoryAsync(dir);
  const entries: Array<{ uri: string; size: number; mtime: number }> = [];
  let total = 0;
  for (const name of names) {
    const uri = `${dir}${name}`;
    const stat = await FileSystem.getInfoAsync(uri);
    if (!stat.exists || stat.isDirectory) continue;
    const size = Number(stat.size ?? 0);
    total += size;
    entries.push({ uri, size, mtime: Number(stat.modificationTime ?? 0) });
  }
  if (total <= budgetBytes) return 0;

  entries.sort((a, b) => a.mtime - b.mtime);
  let evicted = 0;
  for (const entry of entries) {
    if (total <= budgetBytes) break;
    await removeIfPresent(entry.uri);
    total -= entry.size;
    evicted += 1;
  }
  return evicted;
}

/** Every local byte, for the Settings storage card and for logout. */
export async function clearHouseBlobLocalState(): Promise<void> {
  await removeIfPresent(`${cacheDir()}${CACHE_DIR}/`);
  await removeIfPresent(`${docDir()}${STAGING_DIR}/`);
  await removeIfPresent(`${docDir()}${ORIGIN_DIR}/`);
}

/** Household quota rollup — Q5's soft warn / hard stop, for Settings. */
export async function getHouseBlobUsage(householdIdInput?: string): Promise<RemoteBlobUsage> {
  const householdId = householdIdInput ?? getActiveHouseholdId();
  if (!householdId) throw new Error('house blobs: no property is active');
  return fetchBlobUsage(householdId);
}

/** Whether a peer can read this blob yet — used by the "still uploading" state. */
export async function houseBlobIsAvailable(
  blobId: string,
  householdIdInput?: string,
): Promise<boolean> {
  const householdId = householdIdInput ?? getActiveHouseholdId();
  if (!householdId) return false;
  const manifest = await fetchBlobManifest(householdId, blobId);
  return manifest?.status === 'complete';
}
