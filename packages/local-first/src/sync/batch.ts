import { aeadDecrypt, aeadEncrypt } from '../crypto/aead';
import { base64ToBytes, bytesToBase64 } from '../crypto/base64';
import { utf8Decode, utf8Encode } from '../crypto/bytes';
import type { StoredOperation, VersionVector } from '../store/types';
import type { Bytes, DeviceId, HouseholdId } from '../types';

/**
 * v2: base64 on the wire (was hex), plus the sender's version vector.
 *
 * Hex doubles every byte; base64 costs 1.33x and measured 1.4-1.6x faster to
 * seal, which is what lifts max ops per deposit from 466 to 580 (small op) and
 * 266 to 356 (realistic op). There is no production install base
 * (`git cat-file -t main:packages/local-first` does not exist), so the format is
 * changed outright rather than dual-decoded.
 */
export const MAILBOX_BATCH_VERSION = 2;

export type SerializedStoredOperation = Omit<StoredOperation, 'payload' | 'signature'> & {
  payloadB64: string;
  signatureB64: string;
};

export type OpBatch = {
  v: typeof MAILBOX_BATCH_VERSION;
  householdId: HouseholdId;
  senderDeviceId: DeviceId;
  /** Base64 Ed25519 public key of sender (for verify before apply). */
  senderSigningPublicKeyB64: string;
  /**
   * The sender's own contiguous frontier, on EVERY batch including receipts.
   * The relay is zero-knowledge, so this header is the only channel through
   * which one peer can ever learn another peer's cursor.
   */
  senderVersionVector: VersionVector;
  /**
   * The seq below the sender's OWN earliest op in this household: everything at
   * or below it can never be delivered, because the sender is the sole source of
   * ops carrying its device id and it does not have them either.
   *
   * Self-vouched only. A receiver must never take a baseline for a THIRD author
   * out of a relayed batch — the relay cannot know whether a gap it sees is a
   * range that never existed or one that is merely still in flight, and claiming
   * across the latter is exactly the silent skip the version vector exists to
   * remove.
   */
  senderBaselineSeq?: number;
  ops: SerializedStoredOperation[];
};

/**
 * A batch we can never read. Distinguishable so the caller can ACK an addressed
 * v1 blob instead of re-fetching it on every sync until its 14-day TTL expires.
 */
export class UnsupportedBatchVersionError extends Error {
  readonly code = 'unsupported_batch_version';

  constructor(readonly version: unknown) {
    super(`unsupported_batch_version: ${String(version)}`);
    this.name = 'UnsupportedBatchVersionError';
  }
}

export function serializeOperation(op: StoredOperation): SerializedStoredOperation {
  return {
    opId: op.opId,
    householdId: op.householdId,
    deviceId: op.deviceId,
    authorMemberId: op.authorMemberId,
    hlc: op.hlc,
    seq: op.seq,
    parentsJson: op.parentsJson,
    opType: op.opType,
    entityType: op.entityType,
    entityId: op.entityId,
    keyEpoch: op.keyEpoch,
    appliedAt: op.appliedAt,
    payloadB64: bytesToBase64(op.payload),
    signatureB64: bytesToBase64(op.signature),
  };
}

export function deserializeOperation(raw: SerializedStoredOperation): StoredOperation {
  return {
    opId: raw.opId,
    householdId: raw.householdId,
    deviceId: raw.deviceId,
    authorMemberId: raw.authorMemberId,
    hlc: raw.hlc,
    seq: raw.seq,
    parentsJson: raw.parentsJson,
    opType: raw.opType,
    entityType: raw.entityType,
    entityId: raw.entityId,
    keyEpoch: raw.keyEpoch,
    appliedAt: raw.appliedAt,
    payload: base64ToBytes(raw.payloadB64),
    signature: base64ToBytes(raw.signatureB64),
  };
}

/** Seal an op batch under the household HDK (opaque to the mailbox server). */
export function sealOpBatch(
  batch: OpBatch,
  hdk: Bytes,
  keyEpoch: number,
): Bytes {
  // The AAD string is an AEAD domain separator, not a format tag. Bumping it
  // alongside the batch version would only break decryption of blobs the
  // version check already rejects, and would lose the distinguishable
  // UnsupportedBatchVersionError in the process.
  const aad = utf8Encode(`mailbox-batch-v1:${batch.householdId}:${keyEpoch}`);
  return aeadEncrypt(hdk, utf8Encode(JSON.stringify(batch)), aad);
}

export function openOpBatch(
  ciphertext: Bytes,
  hdk: Bytes,
  householdId: HouseholdId,
  keyEpoch: number,
): OpBatch {
  const aad = utf8Encode(`mailbox-batch-v1:${householdId}:${keyEpoch}`);
  const plaintext = aeadDecrypt(hdk, ciphertext, aad);
  const parsed = JSON.parse(utf8Decode(plaintext)) as OpBatch;
  if (parsed.v !== MAILBOX_BATCH_VERSION) {
    throw new UnsupportedBatchVersionError(parsed.v);
  }
  if (parsed.householdId !== householdId) {
    throw new Error('household_mismatch');
  }
  return parsed;
}
