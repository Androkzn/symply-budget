/**
 * Health attachment channel — device side (plan §8, stage He6).
 *
 * The ledger row stores a *content descriptor* — `{blobId, mime, bytes, sha256,
 * chunkCount, keyEpoch}` — and **never a device path**. Budget's
 * `localWishMedia.ts` is the documented counter-example: it copies the picked
 * image into `documentDirectory` and puts `{id, key, localUri, mime}` in the
 * ledger, so **the row syncs and the bytes do not**, and the peer renders a
 * `file://` path that exists on no filesystem it can reach. On Health that
 * failure would be a body photo that silently vanished between the user's two
 * phones.
 *
 * Three directories, with different lifetimes, and mixing them up is the whole
 * class of bug this layout prevents:
 *
 *   documentDirectory/lf-health-blob-staging/{blobId}/{index}
 *     Sealed envelopes, written BEFORE the first PUT and re-read on resume.
 *     Durable because losing one mid-upload would force a re-seal, and a re-seal
 *     mints a second nonce for the same (contentKey, chunkIndex) — the GCM
 *     nonce-reuse bug. Deleted only once the upload is finalized.
 *
 *   cacheDirectory/lf-health-blobs/{blobId}
 *     Decrypted plaintext, LRU-evictable. iOS may reclaim `cacheDirectory` at
 *     will, which is correct: the bytes are re-fetchable from R2, so losing them
 *     costs a download, not data. It is also the most sensitive artefact this
 *     feature writes to disk, which is why `clearHealthBlobLocalState` exists
 *     and why sign-out must call it (plan §1.3 teardown).
 *
 *   documentDirectory/lf-health-blob-origin/{blobId}
 *     The authoring device's copy of a file it has not finished uploading, so an
 *     attachment picked offline survives an app restart.
 *
 * ── WHERE THIS DIVERGES FROM `houseBlobStore` ───────────────────────────────
 *
 *  1. **Content-addressed ids** (see `blobCrypto`), so re-picking the same file
 *     resumes one object instead of orphaning a twin. The cost is a second pass
 *     over the file: the id cannot be known until the plaintext is hashed, and
 *     the content key cannot be derived until the id is known. House hashes
 *     inline during the upload pass because its id is random.
 *  2. **A BOUNDED retired-key ring.** Like House, the engine now retains the
 *     outgoing HDK on rotation (`installHealthHouseholdKeys`), so a blob sealed
 *     at epoch N still opens after this device moves to N+1 — the descriptor's
 *     epoch selects the key. Unlike House, the ring is capped at
 *     `HEALTH_RETAINED_KEY_EPOCHS`, because every retained key is another copy
 *     of something that decrypts body photos and clinical documents. So
 *     `HealthBlobKeyUnavailableError` still exists and still means what it
 *     says: an epoch this device genuinely does not hold — it enrolled after
 *     that rotation, or the epoch aged out of the ring — never a bare AEAD
 *     failure. Rotation HAS since landed (`sync/hdkRotation.ts`): revoking a
 *     device mints a new epoch and retires the outgoing key into the ring, so
 *     the ring is now load-bearing rather than provisional, and a blob sealed
 *     before a revoke keeps opening.
 *  3. **Nothing throws into a screen.** `tryResolveHealthBlobUri` is the reader
 *     the UI is meant to call. Home fires a 17-way `Promise.all` of loaders on
 *     every focus (`HealthHomeScreen.tsx:198-219`, plan §4); one rejected
 *     attachment read inside that would blank the whole dashboard, so a missing
 *     or still-uploading blob resolves to a state, not an exception.
 *  4. **Enrolment is checked before authoring.** A device between claiming an
 *     enrolment invite and receiving the HDK holds its own pre-join key; ops are
 *     already refused in that window, and a blob sealed then would be openable
 *     by neither device afterwards.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { base64ToBytes, bytesToBase64 } from '@symply/local-first';

import {
  getLocalHealthHouseholdKeys,
  getLocalHealthLedger,
  getLocalHealthRetiredHouseholdKey,
  isAwaitingHealthEnrolment,
} from '../engine';
import { HealthLocalEnrolmentPendingError } from '../errors';
import { HEALTH_LEDGER_TABLE_NAMES } from '../schema';

import {
  HEALTH_BLOB_MAX_PLAINTEXT_BYTES,
  HEALTH_BLOB_PLAINTEXT_CHUNK,
  createHealthBlobHasher,
  deriveHealthBlobContentKey,
  deriveHealthBlobId,
  healthBlobChunkCount,
  openHealthBlobChunk,
  sealHealthBlobChunk,
  type HealthBlobKeyContext,
} from './blobCrypto';
import {
  HealthBlobIncompleteError,
  HealthBlobMissingError,
  deleteRemoteHealthBlob,
  fetchHealthBlobChunk,
  fetchHealthBlobManifest,
  fetchHealthBlobUsage,
  finalizeHealthBlob,
  putHealthBlobChunk,
  type RemoteHealthBlobUsage,
} from './blobTransport';

/**
 * What the ledger row stores. Everything here is either content-derived or a
 * relay-side identifier — nothing is device-specific, which is exactly the
 * property Budget's wish-media descriptor lacked.
 */
export type HealthBlobDescriptor = {
  blobId: string;
  mime: string;
  bytes: number;
  sha256: string;
  chunkCount: number;
  keyEpoch: number;
};

export type HealthBlobProgress = {
  chunkIndex: number;
  chunkCount: number;
  percent: number;
};

/**
 * Why a read produced no bytes. Every value here is a state a screen can render
 * — that is the point of returning it instead of throwing.
 */
export type HealthBlobUnavailableReason =
  /** The relay has no bytes: never uploaded, tombstoned, or purged. */
  | 'missing'
  /** The other device is still uploading; retry later. */
  | 'uploading'
  /** Sealed under a key epoch this device does not hold (see the header). */
  | 'key_unavailable'
  /** Authentic chunks, wrong file — the sha256 did not match the descriptor. */
  | 'corrupt'
  /** Offline, or any other transport failure. Retryable. */
  | 'unavailable';

export type HealthBlobResolution =
  | { state: 'ready'; uri: string; reason: null }
  | { state: 'unavailable'; uri: null; reason: HealthBlobUnavailableReason };

/**
 * Plaintext cache budget.
 *
 * Half of House's 256 MB. Health's cached plaintext is body photos and clinical
 * documents, so the trade is not "how much can we hold" but "how much of the
 * most sensitive material in the app do we leave decrypted on disk between
 * views". 128 MB still holds dozens of photos; the rest costs one download.
 */
export const HEALTH_BLOB_CACHE_BUDGET_BYTES = 128 * 1024 * 1024;

const STAGING_DIR = 'lf-health-blob-staging';
const ORIGIN_DIR = 'lf-health-blob-origin';
const CACHE_DIR = 'lf-health-blobs';

export class HealthBlobTooLargeError extends Error {
  readonly code = 'blob_too_large';
  constructor(readonly bytes: number) {
    super(`Attachment is larger than the ${HEALTH_BLOB_MAX_PLAINTEXT_BYTES} byte limit`);
    this.name = 'HealthBlobTooLargeError';
  }
}

/**
 * The blob was sealed under a household key epoch this device does not hold.
 *
 * The last resort, not the first answer: the retired-key ring is consulted
 * first (file header, divergence 2), so this now means the epoch is genuinely
 * absent here — this device enrolled after that rotation, or the epoch aged out
 * of the bounded ring. The user's other, longer-lived device may still open the
 * same bytes. Named so the failure is explainable rather than a bare AEAD error.
 */
export class HealthBlobKeyUnavailableError extends Error {
  readonly code = 'blob_key_unavailable';
  constructor(
    readonly blobId: string,
    readonly sealedEpoch: number,
    readonly currentEpoch: number,
  ) {
    super('Attachment was encrypted with a key this device does not have');
    this.name = 'HealthBlobKeyUnavailableError';
  }
}

export class HealthBlobCorruptError extends Error {
  readonly code = 'blob_corrupt';
  constructor(
    readonly blobId: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super('Attachment failed its integrity check');
    this.name = 'HealthBlobCorruptError';
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

export function cachedHealthBlobUri(blobId: string): string {
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

/** Directory listing that answers `[]` for "no such directory". */
async function listNames(dir: string): Promise<string[]> {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) return [];
  return FileSystem.readDirectoryAsync(dir);
}

// --- session -----------------------------------------------------------------

type HealthBlobSession = {
  householdId: string;
  keyEpoch: number;
  hdk: Uint8Array;
};

/**
 * The household key material, refused while enrolment is pending.
 *
 * `getLocalHealthHouseholdKeys` already throws `HealthLocalNotReadyError` when
 * no session is open, so that case needs no restatement here.
 */
function blobSession(): HealthBlobSession {
  if (isAwaitingHealthEnrolment()) {
    throw new HealthLocalEnrolmentPendingError();
  }
  const keys = getLocalHealthHouseholdKeys();
  return { householdId: keys.householdId, keyEpoch: keys.keyEpoch, hdk: keys.hdk };
}

/**
 * The derivation context for one blob. `keyEpoch` defaults to the session's —
 * an upload always seals under the live key — but a READ passes the
 * descriptor's, because the epoch is part of both the HKDF info string and the
 * per-chunk AAD.
 */
function keyContextFor(
  session: HealthBlobSession,
  blobId: string,
  keyEpoch = session.keyEpoch,
): HealthBlobKeyContext {
  return { householdId: session.householdId, keyEpoch, blobId };
}

/**
 * The HDK that sealed a blob, chosen by the DESCRIPTOR's epoch.
 *
 * A rotation mints a whole new random HDK, so bytes sealed before it can only
 * be opened with the retired key for their epoch. Deriving with the current HDK
 * under the old epoch's info string would silently produce a wrong key and
 * surface as a bare AEAD failure three chunks into a download, which is why the
 * epoch selects the key here — before a single byte is fetched.
 */
function sealingKeyFor(session: HealthBlobSession, descriptor: HealthBlobDescriptor): Uint8Array {
  if (descriptor.keyEpoch === session.keyEpoch) return session.hdk;
  const retired = getLocalHealthRetiredHouseholdKey(descriptor.keyEpoch);
  if (!retired) {
    throw new HealthBlobKeyUnavailableError(
      descriptor.blobId,
      descriptor.keyEpoch,
      session.keyEpoch,
    );
  }
  return retired;
}

// --- upload -------------------------------------------------------------------

/** Hash the file in slices, so a 50 MB attachment is never fully resident. */
async function hashSource(sourceUri: string, size: number): Promise<string> {
  const hasher = createHealthBlobHasher();
  const chunkCount = healthBlobChunkCount(size);
  for (let index = 0; index < chunkCount; index += 1) {
    const position = index * HEALTH_BLOB_PLAINTEXT_CHUNK;
    const length = Math.min(HEALTH_BLOB_PLAINTEXT_CHUNK, size - position);
    hasher.update(
      base64ToBytes(
        await FileSystem.readAsStringAsync(sourceUri, {
          encoding: FileSystem.EncodingType.Base64,
          position,
          length,
        }),
      ),
    );
  }
  return hasher.digestHex();
}

/**
 * Seal a local file into the account's blob channel and return the descriptor
 * the ledger row stores.
 *
 * Idempotent by construction, which is what content addressing buys: the same
 * file always resolves to the same `blobId`, so a re-run after a crash resumes
 * the same object, and a file the relay already holds complete is not uploaded
 * a second time. Within a run, every chunk is staged to disk before it is PUT
 * and a resume re-reads the staged envelope rather than re-sealing.
 */
export async function uploadHealthBlob(input: {
  sourceUri: string;
  mime: string;
  onProgress?: (progress: HealthBlobProgress) => void;
}): Promise<HealthBlobDescriptor> {
  const session = blobSession();

  const size = await fileSize(input.sourceUri);
  if (size <= 0) {
    throw new Error('health blobs: source file is empty or unreadable');
  }
  if (size > HEALTH_BLOB_MAX_PLAINTEXT_BYTES) {
    throw new HealthBlobTooLargeError(size);
  }

  // Pass 1 — the content address. Nothing can be derived before this: the id
  // depends on the plaintext, the content key depends on the id.
  const sha256 = await hashSource(input.sourceUri, size);
  const blobId = deriveHealthBlobId({
    hdk: session.hdk,
    householdId: session.householdId,
    plaintextSha256: sha256,
  });
  const ctx = keyContextFor(session, blobId);
  const chunkCount = healthBlobChunkCount(size);
  const descriptor: HealthBlobDescriptor = {
    blobId,
    mime: input.mime,
    bytes: size,
    sha256,
    chunkCount,
    keyEpoch: session.keyEpoch,
  };

  // Dedup / resume-after-finalize. A different `keyEpoch` cannot appear here —
  // the id is derived from the HDK, so a rotation yields a different id — but it
  // is checked rather than assumed, because falling through re-uploads under
  // the current key instead of handing back a descriptor this device could not
  // open.
  const existing = await fetchHealthBlobManifest(session.householdId, blobId).catch(() => null);
  if (
    existing?.status === 'complete' &&
    existing.chunkCount === chunkCount &&
    existing.keyEpoch === session.keyEpoch
  ) {
    await seedCacheFromSource(input.sourceUri, blobId);
    input.onProgress?.({ chunkIndex: chunkCount - 1, chunkCount, percent: 100 });
    return descriptor;
  }

  const contentKey = deriveHealthBlobContentKey(session.hdk, ctx);
  await ensureDir(stagingDirFor(blobId));

  // Pass 2 — seal, stage, upload.
  for (let index = 0; index < chunkCount; index += 1) {
    const position = index * HEALTH_BLOB_PLAINTEXT_CHUNK;
    const length = Math.min(HEALTH_BLOB_PLAINTEXT_CHUNK, size - position);

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
      const plaintext = base64ToBytes(
        await FileSystem.readAsStringAsync(input.sourceUri, {
          encoding: FileSystem.EncodingType.Base64,
          position,
          length,
        }),
      );
      envelope = sealHealthBlobChunk({
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

    await putHealthBlobChunk({
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

  await finalizeHealthBlob({ householdId: ctx.householdId, blobId, chunkCount });
  // Only now are the staged envelopes disposable — before finalize, a crash
  // still needs them to resume without re-sealing.
  await removeIfPresent(stagingDirFor(blobId));

  await seedCacheFromSource(input.sourceUri, blobId);
  return descriptor;
}

/**
 * Seed the cache from the authoring device's own copy, so the user who just
 * attached a photo does not download it back from R2 to look at it.
 */
async function seedCacheFromSource(sourceUri: string, blobId: string): Promise<void> {
  await ensureDir(`${cacheDir()}${CACHE_DIR}/`);
  await FileSystem.copyAsync({ from: sourceUri, to: cachedHealthBlobUri(blobId) });
  await removeIfPresent(originUri(blobId));
  await evictHealthBlobCache();
}

/** Keep a picked file alive across restarts before its upload finishes. */
export async function stageHealthBlobOrigin(sourceUri: string, blobId: string): Promise<string> {
  await ensureDir(`${docDir()}${ORIGIN_DIR}/`);
  const dest = originUri(blobId);
  await FileSystem.copyAsync({ from: sourceUri, to: dest });
  return dest;
}

// --- download -----------------------------------------------------------------

/**
 * Resolve a descriptor to a local plaintext file, fetching and decrypting on
 * first view. Throws; most callers want {@link tryResolveHealthBlobUri}.
 *
 * The `sha256` check is not ceremony: it is what turns "the app silently
 * rendered a truncated or substituted file" into a surfaced error. The
 * per-chunk AAD already rejects reordering and cross-blob splicing; this
 * catches the case where every chunk is authentic but the set is not the file
 * the row describes.
 */
export async function resolveHealthBlobUri(
  descriptor: HealthBlobDescriptor,
  options: { forceRefresh?: boolean } = {},
): Promise<string> {
  const cached = cachedHealthBlobUri(descriptor.blobId);
  if (!options.forceRefresh && (await fileSize(cached)) > 0) {
    // Touch so LRU eviction sees the read, not just the write.
    await FileSystem.getInfoAsync(cached);
    return cached;
  }

  const session = blobSession();
  // The DESCRIPTOR's epoch is authoritative, not the session's — see
  // `sealingKeyFor`, which refuses (rather than deriving a wrong key) when the
  // ring does not hold it.
  const sealingKey = sealingKeyFor(session, descriptor);
  const ctx = keyContextFor(session, descriptor.blobId, descriptor.keyEpoch);
  const contentKey = deriveHealthBlobContentKey(sealingKey, ctx);

  const parts: Uint8Array[] = [];
  let total = 0;
  for (let index = 0; index < descriptor.chunkCount; index += 1) {
    const envelope = await fetchHealthBlobChunk(ctx.householdId, descriptor.blobId, index);
    const plaintext = openHealthBlobChunk({
      contentKey,
      ctx,
      chunkIndex: index,
      chunkCount: descriptor.chunkCount,
      envelope,
    });
    total += plaintext.length;
    if (total > HEALTH_BLOB_MAX_PLAINTEXT_BYTES) {
      throw new HealthBlobTooLargeError(total);
    }
    parts.push(plaintext);
  }

  const plaintext = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    plaintext.set(part, offset);
    offset += part.length;
  }

  const hasher = createHealthBlobHasher();
  hasher.update(plaintext);
  const actual = hasher.digestHex();
  if (actual !== descriptor.sha256) {
    throw new HealthBlobCorruptError(descriptor.blobId, descriptor.sha256, actual);
  }

  await ensureDir(`${cacheDir()}${CACHE_DIR}/`);
  await FileSystem.writeAsStringAsync(cached, bytesToBase64(plaintext), {
    encoding: FileSystem.EncodingType.Base64,
  });
  await evictHealthBlobCache();
  return cached;
}

/**
 * The reader a screen should call: a state, never an exception.
 *
 * Home's 17-way `Promise.all` (plan §4) makes a rejected attachment read into a
 * blank dashboard, and "this photo is gone" is a perfectly ordinary outcome —
 * the other device may still be uploading, or the row may outlive its bytes
 * after a purge. Genuinely unexpected failures still reach the caller, as
 * `'unavailable'` with the retry semantics that implies, rather than as a
 * rejected promise nobody caught.
 */
export async function tryResolveHealthBlobUri(
  descriptor: HealthBlobDescriptor,
  options: { forceRefresh?: boolean } = {},
): Promise<HealthBlobResolution> {
  try {
    return { state: 'ready', uri: await resolveHealthBlobUri(descriptor, options), reason: null };
  } catch (error) {
    return { state: 'unavailable', uri: null, reason: unavailableReasonOf(error) };
  }
}

function unavailableReasonOf(error: unknown): HealthBlobUnavailableReason {
  if (error instanceof HealthBlobMissingError) return 'missing';
  if (error instanceof HealthBlobIncompleteError) return 'uploading';
  if (error instanceof HealthBlobKeyUnavailableError) return 'key_unavailable';
  if (error instanceof HealthBlobCorruptError) return 'corrupt';
  return 'unavailable';
}

/**
 * Local-only check, for a renderer that must decide between "show the image"
 * and "show a download affordance" without touching the network.
 */
export async function isHealthBlobCached(blobId: string): Promise<boolean> {
  return (await fileSize(cachedHealthBlobUri(blobId))) > 0;
}

// --- delete + cache -----------------------------------------------------------

/**
 * Tombstone the blob and drop every local copy.
 *
 * Called when the owning ledger row is deleted. The relay keeps the bytes until
 * the checkpoint watermark passes, so the user's other device is not stranded
 * mid-bootstrap.
 */
export async function deleteHealthBlob(blobId: string): Promise<void> {
  const householdId = getLocalHealthLedger().household.id;
  if (householdId) {
    await deleteRemoteHealthBlob(householdId, blobId);
  }
  await dropLocalCopies(blobId);
}

async function dropLocalCopies(blobId: string): Promise<void> {
  await removeIfPresent(cachedHealthBlobUri(blobId));
  await removeIfPresent(stagingDirFor(blobId));
  await removeIfPresent(originUri(blobId));
}

/**
 * LRU eviction over the plaintext cache.
 *
 * Ordered by `modificationTime` rather than a separately tracked access log:
 * the log would be one more thing to keep consistent across a crash, and
 * re-reading a cached blob already touches the file. Worst case a
 * hot-but-never-rewritten blob is evicted and re-downloaded once.
 */
export async function evictHealthBlobCache(
  budgetBytes = HEALTH_BLOB_CACHE_BUDGET_BYTES,
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

/**
 * Every local byte.
 *
 * Sign-out must call this. Plan §1.3's teardown wipes `HEALTH_CACHE_KEYS`, the
 * SQLite file with its `-wal`/`-shm` sidecars, and the DEK — a decrypted body
 * photo left in `cacheDirectory` would outlive all three, on the one surface
 * where that matters most.
 */
export async function clearHealthBlobLocalState(): Promise<void> {
  await removeIfPresent(`${cacheDir()}${CACHE_DIR}/`);
  await removeIfPresent(`${docDir()}${STAGING_DIR}/`);
  await removeIfPresent(`${docDir()}${ORIGIN_DIR}/`);
}

/** Account-level quota rollup, for a Settings storage card. */
export async function getHealthBlobUsage(): Promise<RemoteHealthBlobUsage> {
  const householdId = getLocalHealthLedger().household.id;
  if (!householdId) throw new Error('health blobs: no local ledger');
  return fetchHealthBlobUsage(householdId);
}

/** Whether the other device can read this blob yet — the "still uploading" state. */
export async function healthBlobIsAvailable(blobId: string): Promise<boolean> {
  const householdId = getLocalHealthLedger().household.id;
  if (!householdId) return false;
  const manifest = await fetchHealthBlobManifest(householdId, blobId);
  return manifest?.status === 'complete';
}

// --- reconciliation with the ledger -------------------------------------------

/**
 * Descriptor shape check, used to find blob references inside ledger rows
 * without this module owning the row types.
 */
export function isHealthBlobDescriptor(value: unknown): value is HealthBlobDescriptor {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.blobId === 'string' &&
    candidate.blobId.startsWith('blob_') &&
    typeof candidate.mime === 'string' &&
    typeof candidate.bytes === 'number' &&
    typeof candidate.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate.sha256) &&
    typeof candidate.chunkCount === 'number' &&
    typeof candidate.keyEpoch === 'number'
  );
}

/**
 * Rows per table the encoded-descriptor tripwire samples, and the longest
 * string it will look inside. Both are constants so the guard costs constant
 * work per reconcile no matter how large the corpus gets.
 */
const ENCODED_DESCRIPTOR_SAMPLE_ROWS = 25;
const ENCODED_DESCRIPTOR_MAX_STRING = 4096;

/**
 * The marker a JSON-encoded descriptor cannot avoid carrying. Matching the key
 * name — not parsing — is what keeps this O(1) per row.
 */
const ENCODED_DESCRIPTOR_MARKER = '"blobId"';

/**
 * ⚠️ **WAVE D CONTRACT: A DESCRIPTOR MUST BE A REAL FIELD.**
 *
 * `collectHealthBlobRefs` scans object- and array-valued fields and does NOT
 * parse strings. A descriptor JSON-encoded inside `health_entries.data`
 * (`types.ts:71`) would therefore be invisible to the reconciler, and the very
 * pass that exists to tidy up after deletions would sweep a live body photo as
 * an orphan.
 *
 * The fix is deliberately NOT "parse every `data` string": at the ten-year
 * corpus that is exactly the unbounded read §4's thresholds forbid, and it
 * would run on every reconcile rather than once. So the contract is enforced
 * instead of worked around. This tripwire samples a bounded number of rows per
 * table, in `__DEV__` only, and warns; it is never a code path the reconciler's
 * correctness depends on. A Wave D author who encodes a descriptor into a
 * string column sees it on the first reconcile after their first write.
 */
function warnOnEncodedDescriptors(table: string, rows: readonly unknown[]): void {
  if (!__DEV__) return;
  const sample = Math.min(rows.length, ENCODED_DESCRIPTOR_SAMPLE_ROWS);
  for (let index = 0; index < sample; index += 1) {
    const row = rows[index];
    if (!row || typeof row !== 'object') continue;
    for (const [field, value] of Object.entries(row as Record<string, unknown>)) {
      if (typeof value !== 'string' || value.length > ENCODED_DESCRIPTOR_MAX_STRING) continue;
      if (!value.includes(ENCODED_DESCRIPTOR_MARKER)) continue;
      // Field name only. The value is member health data and this line reaches
      // logs (plan Appendix C.1).
      console.warn(
        `[HealthLocal] blob descriptor encoded inside a string field — ${table}.${field}. ` +
          'The reconciler cannot see it and will treat its bytes as an orphan. ' +
          'Store the descriptor as a real field.',
      );
      return;
    }
  }
}

/**
 * Every blob a live ledger row still points at.
 *
 * Structural rather than schema-driven, and deliberately so: **no Wave A table
 * carries an attachment today** (plan §1.5 — eight tables, none with a blob
 * column), so a hand-maintained field list would be eight empty entries that
 * nothing keeps honest, and the Wave D task that adds `body_measurements.photo`
 * would have to remember to update a file it has no reason to open. Scanning
 * for the descriptor shape means the reconciler starts working the moment a
 * descriptor is written, with no edit here.
 *
 * ⚠️ **Bounded on purpose.** Object- and array-valued fields are scanned;
 * strings are not. Wave D must store a descriptor as a real field, not inside
 * an encoded payload — see `warnOnEncodedDescriptors`, which is the guard that
 * says so out loud rather than leaving it as a comment nobody reads.
 *
 * Tombstoned rows are skipped — a deleted row's blob is exactly the orphan the
 * reconciler exists to reclaim.
 */
export function collectHealthBlobRefs(source?: unknown): Map<string, HealthBlobDescriptor> {
  const ledger = (source ?? getLocalHealthLedger()) as Record<string, unknown>;
  const found = new Map<string, HealthBlobDescriptor>();

  const consider = (value: unknown): void => {
    if (isHealthBlobDescriptor(value)) found.set(value.blobId, value);
  };

  for (const table of HEALTH_LEDGER_TABLE_NAMES) {
    const rows = ledger[table];
    if (!Array.isArray(rows)) continue;
    warnOnEncodedDescriptors(table, rows);
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const record = row as Record<string, unknown>;
      if (record.deleted_at) continue;
      for (const value of Object.values(record)) {
        if (Array.isArray(value)) {
          for (const item of value) consider(item);
          continue;
        }
        consider(value);
      }
    }
  }
  return found;
}

export type HealthBlobReconciliation = {
  /** Blob ids a live ledger row still references. */
  referenced: string[];
  /** Cached plaintext dropped because nothing references it any more. */
  cacheEvicted: string[];
  /** Staging / origin copies dropped for the same reason. */
  stagingCleared: string[];
  /** Orphans tombstoned on the relay (only when `releaseRemote` is set). */
  tombstoned: string[];
  /** Referenced blobs with no local plaintext — the lazy-download candidates. */
  notCached: string[];
};

/**
 * Reconcile local blob state against the ledger.
 *
 * Two drifts are possible and both are silent. A row deleted on **this** device
 * takes `deleteHealthBlob` with it; a row deleted on the **other** device
 * arrives as an op, and nothing on this side ever hears about the bytes it
 * pointed at — they sit decrypted in `cacheDirectory` indefinitely. In the other
 * direction, an incoming row can reference a blob whose bytes this device has
 * never fetched, which is not an error but is what a prefetch pass needs to
 * know.
 *
 * `releaseRemote` is **off by default**, and that default is load-bearing: this
 * device's view of the ledger is only as complete as its last sync, so a device
 * that has not caught up would tombstone attachments belonging to rows it simply
 * has not received yet. Local copies are always safe to drop — they are a cache
 * — so the destructive half is opt-in for a caller that knows the ledger is
 * current.
 */
export async function reconcileHealthBlobs(
  options: { referenced?: Iterable<string>; releaseRemote?: boolean } = {},
): Promise<HealthBlobReconciliation> {
  const referenced = new Set(options.referenced ?? collectHealthBlobRefs().keys());
  const result: HealthBlobReconciliation = {
    referenced: Array.from(referenced),
    cacheEvicted: [],
    stagingCleared: [],
    tombstoned: [],
    notCached: [],
  };

  const cached = new Set(await listNames(`${cacheDir()}${CACHE_DIR}/`));
  for (const blobId of cached) {
    if (referenced.has(blobId)) continue;
    await removeIfPresent(cachedHealthBlobUri(blobId));
    result.cacheEvicted.push(blobId);
  }

  const local = new Set<string>([
    ...(await listNames(`${docDir()}${STAGING_DIR}/`)),
    ...(await listNames(`${docDir()}${ORIGIN_DIR}/`)),
  ]);
  for (const blobId of local) {
    if (referenced.has(blobId)) continue;
    await removeIfPresent(stagingDirFor(blobId));
    await removeIfPresent(originUri(blobId));
    result.stagingCleared.push(blobId);
  }

  if (options.releaseRemote) {
    const householdId = getLocalHealthLedger().household.id;
    for (const blobId of new Set([...result.cacheEvicted, ...result.stagingCleared])) {
      // Best effort: an orphan that survives one pass is reclaimed by the next
      // one, or by the Worker's own abandoned-upload sweep. Failing the whole
      // reconcile over one unreachable tombstone would leave the local half
      // undone too.
      try {
        await deleteRemoteHealthBlob(householdId, blobId);
        result.tombstoned.push(blobId);
      } catch {
        // Reclaimed on a later pass.
      }
    }
  }

  for (const blobId of referenced) {
    if (!cached.has(blobId)) result.notCached.push(blobId);
  }
  return result;
}
