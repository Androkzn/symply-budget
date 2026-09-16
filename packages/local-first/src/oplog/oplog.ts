import type { Clock } from '../adapters/types';
import { systemClock } from '../adapters/types';
import { aeadDecrypt, aeadEncrypt } from '../crypto/aead';
import { utf8Encode } from '../crypto/bytes';
import { signDetached, verifyDetached } from '../crypto/sign';
import type { LocalFirstStore, StoredOperation } from '../store/types';
import {
  LOCAL_FIRST_PROTOCOL_VERSION,
  LOCAL_FIRST_SCHEMA_VERSION,
  type Bytes,
  type DeviceIdentity,
  type HouseholdKeys,
} from '../types';

import { assertOperationInput, canonicalSignBytes, sortParents } from './encode';
import { HybridLogicalClock, isHlcTooFarInFuture } from './hlc';
import type { AppliedOperationResult, OperationInput, ProjectionHandler } from './types';

export class SeqRegressionError extends Error {
  constructor() {
    super(
      'OpLog.append: a peer version vector is ahead of this device seq; mint a new device_id',
    );
    this.name = 'SeqRegressionError';
  }
}

export interface OpLogOptions {
  store: LocalFirstStore;
  identity: DeviceIdentity;
  householdKeys: HouseholdKeys;
  /**
   * Epochs this device held for this household BEFORE the current one.
   *
   * An op is sealed under the epoch it was authored at and stays sealed under
   * it for ever, so a household that has rotated its key holds history no
   * single key can open. Without the ring `applyRemote` rejected every op
   * older than the last rotation as `key_epoch_mismatch` — which is how a
   * member joining a rotated household received the whole log and applied
   * none of it (observed in production on `Sweet Home`, epoch 5).
   *
   * Read-only here: only `installHouseholdKeys` may retire a key.
   */
  retiredHdks?: ReadonlyMap<number, Bytes>;
  clock?: Clock;
  projection?: ProjectionHandler;
}

export class OpLog {
  private readonly store: LocalFirstStore;
  private readonly identity: DeviceIdentity;
  private readonly householdKeys: HouseholdKeys;
  private readonly retiredHdks: ReadonlyMap<number, Bytes>;
  private readonly clock: Clock;
  private readonly projection: ProjectionHandler | undefined;
  private readonly hlc: HybridLogicalClock;
  /** Our own baseline can only be established once — see ensureOwnBaseline. */
  private ownBaselineEnsured = false;

  constructor(options: OpLogOptions) {
    this.store = options.store;
    this.identity = options.identity;
    this.householdKeys = options.householdKeys;
    this.retiredHdks = options.retiredHdks ?? new Map();
    this.clock = options.clock ?? systemClock;
    this.projection = options.projection;
    this.hlc = new HybridLogicalClock(options.identity.deviceId);
  }

  /**
   * The key an op sealed at `keyEpoch` must be opened with, or null.
   *
   * Only ever consulted for READS. `append` seals under the current epoch and
   * nothing else, so a retired key can never come back into circulation.
   */
  private hdkForEpoch(keyEpoch: number): Bytes | null {
    if (keyEpoch === this.householdKeys.keyEpoch) return this.householdKeys.hdk;
    return this.retiredHdks.get(keyEpoch) ?? null;
  }

  async nextHlc(): Promise<string> {
    return this.hlc.tick(this.clock.nowMs());
  }

  /**
   * Seal, sign, persist, and project a local operation.
   * Idempotent on opId.
   */
  async append(input: Omit<OperationInput, 'hlc' | 'seq' | 'deviceId' | 'householdId' | 'keyEpoch'> & {
    hlc?: string;
    seq?: number;
    plaintextPayload: Bytes;
  }): Promise<StoredOperation> {
    if (!this.store.isOpen()) {
      throw new Error('OpLog.append: store not open');
    }

    const householdId = this.householdKeys.householdId;
    const deviceId = this.identity.deviceId;
    const seq = input.seq ?? (await this.store.nextSeq(householdId, deviceId));
    const localMax = seq - 1;
    const peers = await this.store.listSyncPeerStates(householdId);
    for (const peer of peers) {
      const seen = peer.knownVv[deviceId] ?? 0;
      if (seen > localMax) {
        throw new SeqRegressionError();
      }
    }
    const hlc = input.hlc ?? (await this.nextHlc());
    const full: OperationInput = {
      opId: input.opId,
      householdId: this.householdKeys.householdId,
      deviceId: this.identity.deviceId,
      authorMemberId: input.authorMemberId,
      hlc,
      seq,
      parents: sortParents(input.parents ?? []),
      opType: input.opType,
      entityType: input.entityType,
      entityId: input.entityId,
      plaintextPayload: input.plaintextPayload,
      keyEpoch: this.householdKeys.keyEpoch,
    };
    assertOperationInput(full);

    if (await this.store.hasOperation(full.opId)) {
      const existing = await this.store.getOperation(full.opId);
      if (!existing) {
        throw new Error('OpLog.append: op missing after hasOperation');
      }
      return existing;
    }

    const aad = utf8Encode(
      `${full.householdId}:${full.keyEpoch}:${full.opId}`,
    );
    const payload = aeadEncrypt(this.householdKeys.hdk, full.plaintextPayload, aad);
    const signBytes = canonicalSignBytes({
      protocolVersion: LOCAL_FIRST_PROTOCOL_VERSION,
      schemaVersion: LOCAL_FIRST_SCHEMA_VERSION,
      opId: full.opId,
      householdId: full.householdId,
      deviceId: full.deviceId,
      authorMemberId: full.authorMemberId,
      hlc: full.hlc,
      seq: full.seq,
      parents: full.parents,
      opType: full.opType,
      entityType: full.entityType,
      entityId: full.entityId,
      keyEpoch: full.keyEpoch,
      payloadCiphertext: payload,
    });
    const signature = signDetached(this.identity.signingPrivateKey, signBytes);

    const stored: StoredOperation = {
      opId: full.opId,
      householdId: full.householdId,
      deviceId: full.deviceId,
      authorMemberId: full.authorMemberId,
      hlc: full.hlc,
      seq: full.seq,
      parentsJson: JSON.stringify(full.parents),
      opType: full.opType,
      entityType: full.entityType,
      entityId: full.entityId,
      payload,
      keyEpoch: full.keyEpoch,
      signature,
      appliedAt: this.clock.nowMs(),
    };

    const insert = await this.store.insertOperation(stored);
    if (insert === 'duplicate') {
      const existing = await this.store.getOperation(full.opId);
      if (!existing) {
        throw new Error('OpLog.append: duplicate without row');
      }
      return existing;
    }

    await this.ensureOwnBaseline();
    await this.projectDecrypted(stored, full.plaintextPayload);
    return stored;
  }

  /**
   * Tell the store that nothing below our own lowest seq will ever arrive.
   *
   * We are the only source of ops carrying this device id, so a gap below our
   * minimum is not undelivered mail — it is a seq range that does not exist in
   * this household (a device-global `nextSeq` legacy database starts at 4, 5,
   * 6…). Without this the contiguous watermark stays at 0 for our own author
   * for ever: we never appear in our own version vector, no peer can ever cover
   * us, and every sync re-ships the whole log.
   *
   * Once per instance: our minimum is fixed after the first insert, since seqs
   * only ever grow from there.
   */
  private async ensureOwnBaseline(): Promise<void> {
    if (this.ownBaselineEnsured) return;
    this.ownBaselineEnsured = true;
    const householdId = this.householdKeys.householdId;
    const deviceId = this.identity.deviceId;
    const lowest = await this.store.getLowestStoredSeq(householdId, deviceId);
    if (lowest > 1) {
      await this.store.setAuthorBaseline(householdId, deviceId, lowest - 1);
    }
  }

  /**
   * Verify signature + decrypt + idempotent apply for a remote (or local) op.
   */
  async applyRemote(
    stored: StoredOperation,
    senderPublicKey: Bytes,
  ): Promise<AppliedOperationResult> {
    if (!this.store.isOpen()) {
      return { status: 'rejected', reason: 'store_not_open' };
    }
    if (stored.householdId !== this.householdKeys.householdId) {
      return { status: 'rejected', reason: 'household_mismatch' };
    }
    // The key ring, not the current key. An op older than the last rotation is
    // perfectly valid and perfectly readable — provided this device was given
    // the epoch it was sealed under. `key_epoch_mismatch` stays RETRYABLE, so a
    // device still waiting on a retired key leaves the blob on the relay rather
    // than acking history it cannot yet open.
    const hdk = this.hdkForEpoch(stored.keyEpoch);
    if (!hdk) {
      return { status: 'rejected', reason: 'key_epoch_mismatch' };
    }
    if (await this.store.hasOperation(stored.opId)) {
      return { status: 'duplicate' };
    }
    if (isHlcTooFarInFuture(stored.hlc, this.clock.nowMs())) {
      return { status: 'rejected', reason: 'hlc_drift' };
    }

    let parents: string[] = [];
    try {
      parents = JSON.parse(stored.parentsJson) as string[];
      if (!Array.isArray(parents)) {
        return { status: 'rejected', reason: 'parents_invalid' };
      }
    } catch {
      return { status: 'rejected', reason: 'parents_invalid' };
    }

    const signBytes = canonicalSignBytes({
      protocolVersion: LOCAL_FIRST_PROTOCOL_VERSION,
      schemaVersion: LOCAL_FIRST_SCHEMA_VERSION,
      opId: stored.opId,
      householdId: stored.householdId,
      deviceId: stored.deviceId,
      authorMemberId: stored.authorMemberId,
      hlc: stored.hlc,
      seq: stored.seq,
      parents: sortParents(parents),
      opType: stored.opType,
      entityType: stored.entityType,
      entityId: stored.entityId,
      keyEpoch: stored.keyEpoch,
      payloadCiphertext: stored.payload,
    });

    if (!verifyDetached(senderPublicKey, signBytes, stored.signature)) {
      return { status: 'rejected', reason: 'bad_signature' };
    }

    const aad = utf8Encode(
      `${stored.householdId}:${stored.keyEpoch}:${stored.opId}`,
    );
    let plaintext: Bytes;
    try {
      plaintext = aeadDecrypt(hdk, stored.payload, aad);
    } catch {
      return { status: 'rejected', reason: 'decrypt_failed' };
    }

    this.hlc.observe(stored.hlc, this.clock.nowMs());

    try {
      await this.store.insertOperation(stored);
    } catch (error) {
      return {
        status: 'rejected',
        reason: error instanceof Error ? error.message : 'insert_failed',
      };
    }

    await this.projectDecrypted(stored, plaintext);
    return { status: 'applied' };
  }

  private async projectDecrypted(stored: StoredOperation, plaintext: Bytes): Promise<void> {
    if (this.projection) {
      await this.projection.apply({
        opId: stored.opId,
        opType: stored.opType,
        entityType: stored.entityType,
        entityId: stored.entityId,
        plaintextPayload: plaintext,
        authorMemberId: stored.authorMemberId,
        hlc: stored.hlc,
      });
    }
    await this.store.setProjectionCursor(stored.entityType, stored.entityId, stored.opId);
  }
}

export function createOpId(): string {
  // UUIDv7-ish sortable id: time hex + random
  const now = Date.now();
  const rand = cryptoRandomHex(10);
  return `${now.toString(16).padStart(12, '0')}${rand}`;
}

function cryptoRandomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
