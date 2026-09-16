/**
 * Encrypted, chunked, signed household checkpoint (Stage 4).
 *
 * Rows are re-sealed under the household HDK (not the device DEK). The relay
 * stores opaque blobs only. Install is atomic: every chunk + a valid manifest
 * must be present before the projection is replaced. Multi-chunk mailbox push
 * is deliberately non-atomic and must not be reused here.
 */

import { sha256 } from '@noble/hashes/sha256';

import { aeadDecrypt, aeadEncrypt } from '../crypto/aead';
import { base64ToBytes, bytesToBase64 } from '../crypto/base64';
import { bytesToHex, concatBytes, utf8Decode, utf8Encode } from '../crypto/bytes';
import { signDetached, verifyDetached } from '../crypto/sign';
import type { VersionVector } from '../store/types';
import type { Bytes, DeviceId, HouseholdId } from '../types';

import { MAX_MAILBOX_CIPHERTEXT_B64 } from './mailbox-engine';

export const CHECKPOINT_FORMAT = 1;
export const CHECKPOINT_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const CHECKPOINT_RETAIN_GENERATIONS = 3;
export const CATCH_UP_OPS_THRESHOLD = 500;
export const CATCH_UP_STALE_MS = 14 * 24 * 60 * 60 * 1000;
export const CHECKPOINT_PUBLISH_MIN_OPS = 100;

/** Plaintext slice size so AEAD+base64 stays under the 512k blob cap. */
export const CHECKPOINT_PLAINTEXT_CHUNK = 350_000;

export type CheckpointRow = {
  table: string;
  rowKey: string;
  bucket: string;
  deleted: boolean;
  bodyJson: string;
  updatedHlc: string;
};

export type CheckpointPlaintext = {
  v: 1;
  householdId: HouseholdId;
  keyEpoch: number;
  versionVector: VersionVector;
  household: unknown;
  rows: CheckpointRow[];
};

export type CheckpointManifest = {
  v: 1;
  householdId: HouseholdId;
  generation: number;
  versionVector: VersionVector;
  chunkCount: number;
  rootHash: string;
  signerDeviceId: DeviceId;
  signatureB64: string;
};

function canonicalVv(vv: VersionVector): Record<string, number> {
  return Object.fromEntries(
    Object.entries(vv).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
}

function canonicalManifestBytes(
  manifest: Omit<CheckpointManifest, 'signatureB64'>,
): Bytes {
  return utf8Encode(
    JSON.stringify({
      v: manifest.v,
      householdId: manifest.householdId,
      generation: manifest.generation,
      versionVector: canonicalVv(manifest.versionVector),
      chunkCount: manifest.chunkCount,
      rootHash: manifest.rootHash,
      signerDeviceId: manifest.signerDeviceId,
    }),
  );
}

function chunkAad(
  householdId: string,
  generation: number,
  index: number,
  count: number,
): Bytes {
  return utf8Encode(`lf-checkpoint:${householdId}:${generation}:${index}:${count}`);
}

export function sealCheckpoint(input: {
  plaintext: CheckpointPlaintext;
  hdk: Bytes;
  generation: number;
  signerDeviceId: DeviceId;
  signingPrivateKey: Bytes;
}): { chunks: Bytes[]; manifest: CheckpointManifest } {
  const plain = utf8Encode(JSON.stringify(input.plaintext));
  const slices: Bytes[] = [];
  for (let offset = 0; offset < plain.length || slices.length === 0; offset += CHECKPOINT_PLAINTEXT_CHUNK) {
    slices.push(plain.subarray(offset, offset + CHECKPOINT_PLAINTEXT_CHUNK));
    if (plain.length === 0) break;
  }
  const chunkCount = slices.length;
  const chunks: Bytes[] = [];
  const digests: Bytes[] = [];
  for (let i = 0; i < slices.length; i += 1) {
    const sealed = aeadEncrypt(
      input.hdk,
      slices[i]!,
      chunkAad(input.plaintext.householdId, input.generation, i, chunkCount),
    );
    chunks.push(sealed);
    digests.push(sha256(sealed));
  }
  const rootHash = bytesToHex(sha256(concatBytes(...digests)));
  const unsigned: Omit<CheckpointManifest, 'signatureB64'> = {
    v: 1,
    householdId: input.plaintext.householdId,
    generation: input.generation,
    versionVector: input.plaintext.versionVector,
    chunkCount,
    rootHash,
    signerDeviceId: input.signerDeviceId,
  };
  return {
    chunks,
    manifest: {
      ...unsigned,
      signatureB64: bytesToBase64(
        signDetached(input.signingPrivateKey, canonicalManifestBytes(unsigned)),
      ),
    },
  };
}

/**
 * Decrypt every chunk under one key, or throw.
 *
 * Split out so `openCheckpoint` can walk a key ring: the chunk AAD binds the
 * household, generation and index but NOT the epoch, so the only way to find
 * out which key sealed a checkpoint is to try.
 */
function decryptChunks(
  chunks: Bytes[],
  manifest: CheckpointManifest,
  hdk: Bytes,
): Bytes[] {
  return chunks.map((chunk, i) =>
    aeadDecrypt(
      hdk,
      chunk,
      chunkAad(manifest.householdId, manifest.generation, i, manifest.chunkCount),
    ),
  );
}

export function openCheckpoint(input: {
  chunks: Bytes[];
  manifest: CheckpointManifest;
  hdk: Bytes;
  /**
   * Epochs this device held before the current one.
   *
   * A checkpoint is sealed once, under whatever epoch was current when its
   * owner published it, and NOTHING re-seals it when the household rotates. So
   * the one path that is supposed to carry history across a rotation is itself
   * stuck behind a retired key — which is how a joiner handed only the current
   * key downloaded a 659 KB snapshot and installed none of it (`Sweet Home`
   * generation 1, sealed under epoch 1, opened at epoch 5).
   */
  retiredHdks?: Iterable<Bytes>;
  signerPublicKey: Bytes;
}): CheckpointPlaintext {
  if (input.chunks.length !== input.manifest.chunkCount) {
    throw new Error('openCheckpoint: incomplete chunks');
  }
  const { signatureB64, ...unsigned } = input.manifest;
  if (
    !verifyDetached(
      input.signerPublicKey,
      canonicalManifestBytes(unsigned),
      base64ToBytes(signatureB64),
    )
  ) {
    throw new Error('openCheckpoint: bad signature');
  }
  const rootHash = bytesToHex(sha256(concatBytes(...input.chunks.map((chunk) => sha256(chunk)))));
  if (rootHash !== input.manifest.rootHash) {
    throw new Error('openCheckpoint: root hash mismatch');
  }
  // Current epoch first, then every retired one. The signature and root hash
  // above are already verified, so a failure here is a wrong KEY and nothing
  // else — there is no integrity question left to answer by trying again.
  let parts: Bytes[] | null = null;
  let lastError: unknown;
  for (const hdk of [input.hdk, ...(input.retiredHdks ?? [])]) {
    try {
      parts = decryptChunks(input.chunks, input.manifest, hdk);
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!parts) {
    throw lastError ?? new Error('openCheckpoint: no key opened this checkpoint');
  }
  const parsed = JSON.parse(utf8Decode(concatBytes(...parts))) as CheckpointPlaintext;
  if (parsed?.v !== 1 || parsed.householdId !== input.manifest.householdId) {
    throw new Error('openCheckpoint: corrupt plaintext');
  }
  return parsed;
}

export function checkpointChunkB64Length(chunk: Bytes): number {
  return bytesToBase64(chunk).length;
}

export function checkpointChunkFitsCap(chunk: Bytes): boolean {
  return checkpointChunkB64Length(chunk) <= MAX_MAILBOX_CIPHERTEXT_B64;
}
