/**
 * Content-key derivation and per-chunk sealing for the House attachment
 * channel (plan §8, stage H6).
 *
 * Why a per-blob key rather than the HDK directly, and why not the DEK:
 *
 *  - The **DEK is device-local**. Rows are sealed under it because rows never
 *    leave the device in the clear — they travel as op-log ciphertext. A blob
 *    DOES leave: a peer has to open it. The DEK cannot express that.
 *  - The **HDK is household-shared**, so it can. But sealing every attachment
 *    directly under it means one key encrypting an unbounded number of large
 *    objects. Deriving per blob bounds the blast radius of any single content
 *    key and gives the AAD a natural place to bind the blob's identity.
 *  - The **key epoch is part of the derivation**, so a rotation produces
 *    different content keys and an old blob is still openable with the old HDK
 *    (which is why the server stores the epoch alongside the object).
 *
 * The AAD binds every framing field the plan lists — `{v, hh, keyEpoch, blobId,
 * chunkIndex, chunkCount, alg}`. That is what makes chunk substitution,
 * reordering, truncation and cross-blob splicing all fail to open rather than
 * silently produce a wrong file.
 */
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';

import { aeadDecrypt, aeadEncrypt, bytesToHex } from '@symply/local-first';

/** Format version. Bump only for a wire-incompatible change to the framing. */
export const BLOB_FORMAT_VERSION = 1;

/**
 * Plaintext slice size, matched to the checkpoint chunker. Sealing adds a
 * 12-byte nonce and a 16-byte GCM tag, so a chunk is 350_028 bytes on the wire
 * — inside the Worker's `BLOB_MAX_CHUNK_CIPHERTEXT_BYTES` (384_000) and inside
 * the 512_000 base64 bound the rest of the protocol is sized against, with room
 * to spare for either to be re-tuned without a format change.
 */
export const BLOB_PLAINTEXT_CHUNK = 350_000;

/**
 * In-memory ceiling on one attachment. Download reassembles the plaintext in
 * memory before writing it (expo-file-system's legacy API cannot append), so
 * this is a real Hermes constraint, not a policy choice. House's blob-bearing
 * surfaces are photos, receipts, manuals and quote PDFs; 64 MB covers a scanned
 * appliance manual with margin. Raising it means moving download to a streaming
 * file handle first.
 */
export const BLOB_MAX_PLAINTEXT_BYTES = 64 * 1024 * 1024;

const CONTENT_KEY_LENGTH = 32;

export type BlobKeyContext = {
  householdId: string;
  keyEpoch: number;
  blobId: string;
};

/**
 * `HKDF(HDK, info="lf-blob:v1:{hh}:{keyEpoch}:{blobId}")`.
 *
 * No salt: the HDK is already a uniformly random 32-byte key, so HKDF-Extract
 * has nothing to condense, and the info string carries all the domain
 * separation this needs. Same reasoning as `hdk-wrap-v1` in the package's
 * `keys.ts`.
 */
export function deriveBlobContentKey(hdk: Uint8Array, ctx: BlobKeyContext): Uint8Array {
  return hkdf(
    sha256,
    hdk,
    undefined,
    `lf-blob:v${BLOB_FORMAT_VERSION}:${ctx.householdId}:${ctx.keyEpoch}:${ctx.blobId}`,
    CONTENT_KEY_LENGTH,
  );
}

/**
 * Additional authenticated data for one chunk.
 *
 * `chunkCount` is included deliberately: without it, a truncated upload (say
 * chunks 0..3 of 8, re-declared as a 4-chunk blob) would open cleanly and hand
 * the member a silently half-file. With it, every chunk of the truncated blob
 * fails authentication.
 */
export function blobChunkAad(
  ctx: BlobKeyContext,
  chunkIndex: number,
  chunkCount: number,
): Uint8Array {
  return new TextEncoder().encode(
    `lf-blob:v${BLOB_FORMAT_VERSION}:${ctx.householdId}:${ctx.keyEpoch}:${ctx.blobId}:${chunkIndex}:${chunkCount}:A256GCM`,
  );
}

/**
 * Seal one plaintext slice. The returned envelope is `nonce || ciphertext||tag`
 * — `aeadEncrypt` mints a fresh random 12-byte nonce per call.
 *
 * **This must be called exactly once per (contentKey, chunkIndex).** A retry
 * must re-send the envelope this produced, not call it again: a second call
 * mints a second nonce for the same key and index, and two GCM ciphertexts
 * under one (key, nonce) leak the XOR of their plaintexts and the authentication
 * subkey. `houseBlobStore` enforces that by staging the envelope on disk before
 * the first PUT and re-reading it on resume; `blobResume` in the tests is what
 * proves it.
 */
export function sealBlobChunk(input: {
  contentKey: Uint8Array;
  ctx: BlobKeyContext;
  chunkIndex: number;
  chunkCount: number;
  plaintext: Uint8Array;
}): Uint8Array {
  return aeadEncrypt(
    input.contentKey,
    input.plaintext,
    blobChunkAad(input.ctx, input.chunkIndex, input.chunkCount),
  );
}

export function openBlobChunk(input: {
  contentKey: Uint8Array;
  ctx: BlobKeyContext;
  chunkIndex: number;
  chunkCount: number;
  envelope: Uint8Array;
}): Uint8Array {
  return aeadDecrypt(
    input.contentKey,
    input.envelope,
    blobChunkAad(input.ctx, input.chunkIndex, input.chunkCount),
  );
}

/** Hex sha256 of the whole plaintext — the integrity check the peer re-runs. */
export function blobPlaintextHash(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

/** Streaming variant, so a large file is never fully resident just to be hashed. */
export function createBlobHasher(): {
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

export function blobChunkCount(plaintextBytes: number): number {
  if (plaintextBytes <= 0) return 1;
  return Math.ceil(plaintextBytes / BLOB_PLAINTEXT_CHUNK);
}
