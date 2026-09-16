/**
 * Content addressing, content-key derivation and per-chunk sealing for the
 * Health attachment channel (plan §8, stage He6).
 *
 * ── WHY THIS IS A COPY OF HOUSE'S FRAMING, NOT A SECOND PROTOCOL ────────────
 *
 * The wire format here is byte-for-byte House's (`src/features/house/local/
 * blobs/blobCrypto.ts`): same HKDF info string, same AAD string, same
 * `nonce || ciphertext||tag` envelope, same plaintext chunk size. That is
 * deliberate. `lf_blobs` / `lf_blob_chunks` (migration `0157`) and
 * `backend/src/routes/local-first-blobs.ts` are **shared** across the fleet —
 * one Worker code path serves House, Budget, Kaizen and Health — so a Health
 * blob that framed itself differently would be a second protocol running over
 * one relay, with two ways to be wrong and one set of server tests. Keeping the
 * derivation identical is also what lets this whole channel be lifted into
 * `@symply/local-first` later as a move rather than a merge.
 *
 * The HDK is per-brand and never leaves the device, so the shared info string
 * carries no cross-brand risk: a House HDK and a Health HDK are independent
 * random keys and cannot derive each other's content keys.
 *
 * ── WHERE HEALTH DIVERGES: THE BLOB ID IS CONTENT-ADDRESSED ─────────────────
 *
 * House mints a **random** blob id, for a reason that is genuinely House's:
 * two *members* attaching the same photo must not collide on one R2 object
 * under two different content keys. Health has no second member — one user, N
 * devices, one HDK (plan §1.2). So the collision House avoids is exactly the
 * *dedup* Health wants: the same body photo re-picked on the same phone, or
 * synced to the user's other device, should be one object, and a retry after a
 * crash should resume rather than orphan a half-uploaded twin.
 *
 * ⚠️ **The id is a KEYED digest, never the bare plaintext hash.** `lf_blobs`
 * stores `blob_id` in D1 in the clear, and `0157`'s own header records that the
 * plaintext sha256 was deliberately left out of those tables so the relay never
 * gets "a confirmation-of-file oracle". A content address equal to
 * `sha256(plaintext)` would hand back exactly that oracle through the id
 * column: anyone with the D1 row could test a candidate file — a specific
 * clinical PDF, a known progress photo — against a health surface, without ever
 * touching the ciphertext. `HKDF(HDK, info="…:{sha256}")` keeps every property
 * that makes content addressing worth having (stable, deduplicating, idempotent
 * across retries) while leaving the relay a string it cannot invert or confirm
 * without the household key it never sees.
 */
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';

import { aeadDecrypt, aeadEncrypt, bytesToHex } from '@symply/local-first';

/** Format version. Bump only for a wire-incompatible change to the framing. */
export const HEALTH_BLOB_FORMAT_VERSION = 1;

/**
 * Plaintext slice size, matched to House and to the checkpoint chunker. Sealing
 * adds a 12-byte nonce and a 16-byte GCM tag, so a chunk is 350_028 bytes on the
 * wire — inside the shared Worker's `BLOB_MAX_CHUNK_CIPHERTEXT_BYTES`
 * (384_000, `backend/src/services/local-first-blob-service.ts:35`).
 */
export const HEALTH_BLOB_PLAINTEXT_CHUNK = 350_000;

/**
 * In-memory ceiling on one attachment.
 *
 * 50 MB, not House's 64 MB, and the number is not arbitrary: it is
 * `HEALTH_FILE_MAX_BYTES` (`src/api/healthAssets.ts:52`), which mirrors
 * `MAX_FILE_BYTES` in the Worker's `health-assets-service.ts`. Health's blob
 * surfaces are the ones behind that cap today — Files, body photos, meal photos
 * — so accepting more here would only produce attachments that the plaintext
 * surface they replace would have refused, and Wave D would inherit the
 * mismatch as a bug report.
 *
 * Download reassembles the plaintext in memory before writing it
 * (expo-file-system's legacy API cannot append), so this is also a real Hermes
 * constraint. Raising it means moving download to a streaming file handle first.
 */
export const HEALTH_BLOB_MAX_PLAINTEXT_BYTES = 50 * 1024 * 1024;

const CONTENT_KEY_LENGTH = 32;

/** 16 bytes → a 32-hex id. Keyed, so 128 bits is ample against collision. */
const BLOB_ID_LENGTH = 16;

export type HealthBlobKeyContext = {
  householdId: string;
  keyEpoch: number;
  blobId: string;
};

/**
 * `HKDF(HDK, info="lf-blob:v1:{hh}:{keyEpoch}:{blobId}")` — House's string,
 * unchanged.
 *
 * No salt: the HDK is already a uniformly random 32-byte key, so HKDF-Extract
 * has nothing to condense, and the info string carries all the domain
 * separation this needs. Same reasoning as `hdk-wrap-v1` in the package's
 * `keys.ts`.
 *
 * Per blob rather than the HDK directly, because one key encrypting an
 * unbounded number of large objects is a blast radius nobody chose; and never
 * the DEK, because the DEK is device-local and a blob has to be openable by the
 * user's *other* device.
 */
export function deriveHealthBlobContentKey(
  hdk: Uint8Array,
  ctx: HealthBlobKeyContext,
): Uint8Array {
  return hkdf(
    sha256,
    hdk,
    undefined,
    `lf-blob:v${HEALTH_BLOB_FORMAT_VERSION}:${ctx.householdId}:${ctx.keyEpoch}:${ctx.blobId}`,
    CONTENT_KEY_LENGTH,
  );
}

/**
 * The keyed content address — see the file header for why it is keyed.
 *
 * Deterministic in `(hdk, householdId, plaintextSha256)` and nothing else. The
 * key epoch is deliberately **not** in the info string: a rotation replaces the
 * HDK wholesale, so the id already changes with the epoch, and naming the epoch
 * too would only suggest an id could be recomputed for an epoch whose key this
 * device no longer holds.
 */
export function deriveHealthBlobId(input: {
  hdk: Uint8Array;
  householdId: string;
  plaintextSha256: string;
}): string {
  const digest = hkdf(
    sha256,
    input.hdk,
    undefined,
    `lf-blob-id:v${HEALTH_BLOB_FORMAT_VERSION}:${input.householdId}:${input.plaintextSha256}`,
    BLOB_ID_LENGTH,
  );
  return `blob_${bytesToHex(digest)}`;
}

/**
 * Additional authenticated data for one chunk.
 *
 * `chunkCount` is included deliberately: without it, a truncated upload (say
 * chunks 0..3 of 8, re-declared as a 4-chunk blob) would open cleanly and hand
 * the user a silently half-file. With it, every chunk of the truncated blob
 * fails authentication. The same field set also makes chunk substitution,
 * reordering and cross-blob splicing fail to open rather than quietly produce
 * the wrong bytes.
 */
export function healthBlobChunkAad(
  ctx: HealthBlobKeyContext,
  chunkIndex: number,
  chunkCount: number,
): Uint8Array {
  return new TextEncoder().encode(
    `lf-blob:v${HEALTH_BLOB_FORMAT_VERSION}:${ctx.householdId}:${ctx.keyEpoch}:${ctx.blobId}:${chunkIndex}:${chunkCount}:A256GCM`,
  );
}

/**
 * Seal one plaintext slice. The returned envelope is `nonce || ciphertext||tag`
 * — `aeadEncrypt` mints a fresh random 12-byte nonce per call.
 *
 * **This must be called exactly once per (contentKey, chunkIndex).** A retry
 * must re-send the envelope this produced, not call it again: a second call
 * mints a second nonce for the same key and index, and two GCM ciphertexts
 * under one (key, nonce) leak the XOR of their plaintexts and the
 * authentication subkey. `healthBlobStore` enforces that by staging the
 * envelope on disk before the first PUT and re-reading it on resume.
 */
export function sealHealthBlobChunk(input: {
  contentKey: Uint8Array;
  ctx: HealthBlobKeyContext;
  chunkIndex: number;
  chunkCount: number;
  plaintext: Uint8Array;
}): Uint8Array {
  return aeadEncrypt(
    input.contentKey,
    input.plaintext,
    healthBlobChunkAad(input.ctx, input.chunkIndex, input.chunkCount),
  );
}

export function openHealthBlobChunk(input: {
  contentKey: Uint8Array;
  ctx: HealthBlobKeyContext;
  chunkIndex: number;
  chunkCount: number;
  envelope: Uint8Array;
}): Uint8Array {
  return aeadDecrypt(
    input.contentKey,
    input.envelope,
    healthBlobChunkAad(input.ctx, input.chunkIndex, input.chunkCount),
  );
}

/** Hex sha256 of the whole plaintext — the content address input, and the
 * integrity check the reading device re-runs. */
export function healthBlobPlaintextHash(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

/** Streaming variant, so a 50 MB file is never fully resident just to be hashed. */
export function createHealthBlobHasher(): {
  update: (bytes: Uint8Array) => void;
  digestHex: () => string;
} {
  const hasher = sha256.create();
  return {
    update: (bytes) => {
      hasher.update(bytes);
    },
    digestHex: () => bytesToHex(hasher.digest()),
  };
}

export function healthBlobChunkCount(plaintextBytes: number): number {
  if (plaintextBytes <= 0) return 1;
  return Math.ceil(plaintextBytes / HEALTH_BLOB_PLAINTEXT_CHUNK);
}
