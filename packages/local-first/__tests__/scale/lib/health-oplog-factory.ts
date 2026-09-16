/**
 * `StoredOperation[]` for the Health corpus, with REAL sealed op payloads.
 *
 * Same reasoning as the Budget and House op factories: op byte size drives both
 * the persist cost and the 512,000-char relay cap, so a made-up payload size
 * would give a wrong answer to the question the harness exists for. The payload
 * here is what the app really writes: `encodeLedgerOpPayload(intent, delta)`
 * over a genuine single-field diff on the HEALTH registry, JSON-stringified,
 * utf8-encoded, then AEAD-sealed under the household key.
 *
 * The brand-neutral primitives (`pseudoBytes`, `hlcAt`, `cryptoBundleFor`) are
 * imported from the Budget op factory rather than copied — they are pure byte
 * utilities with no registry in them.
 *
 * ONE USER, TWO DEVICES — NOT TWO MEMBERS
 * ---------------------------------------
 * House attributes one device per MEMBER. Health's household is personal (plan
 * §1.2): every op carries the same `authorMemberId` and the interleaving comes
 * from the second DEVICE, whose clock is 30 days behind so its ops land below
 * the receiving device's head. That is the only shape a Health relay ever sees,
 * and it is what makes `senderVersionVector` a two-entry map instead of one.
 *
 * Signatures are 64 pseudo-random bytes, not real Ed25519: correct for size and
 * for the persist/batch paths, silent about verify cost. The baseline says so.
 */
import {
  captureLedgerSnapshot,
  diffLedger,
  encodeLedgerOpPayload,
} from '../../../../../src/features/health/local/projection';
import { aeadEncrypt } from '../../../src/crypto/aead';
import { utf8Encode } from '../../../src/crypto/bytes';
import type { StoredOperation } from '../../../src/store/types';
import { CHECKPOINT_PUBLISH_MIN_OPS } from '../../../src/sync/checkpoint';

import { hlcSuffix } from './corpus-core';
import {
  HEALTH_DEFAULT_SEED,
  cloneLedger,
  deviceIdsFor,
  type HealthScaleLedger,
  type ScaleRow,
} from './health-ledger-factory';
import { pseudoBytes } from './oplog-factory';

export { cryptoBundleFor, hlcAt, pseudoBytes } from './oplog-factory';
export { CHECKPOINT_PUBLISH_MIN_OPS };

export type ReferencePayload = {
  plaintext: Uint8Array;
  ciphertext: Uint8Array;
  /** JSON byte size of the delta alone — the semantic change the user made. */
  deltaBytes: number;
};

/**
 * The op a single meal log really produces: capture, add one nutrition row,
 * diff, wrap in the op payload envelope, seal.
 *
 * `nutritionEntries` rather than `waterEntries` on purpose. Water is the higher
 * cardinality table, but "a single meal `mutate`" is the plan's own normative
 * metric (§4) and a meal row is ~5x the width of a water row, so it is the
 * representative — and the more expensive — write.
 */
export function makeReferenceOpPayload(
  ledger: HealthScaleLedger,
  hdk: Uint8Array,
): ReferencePayload {
  const probe = cloneLedger(ledger);
  const snapshot = captureLedgerSnapshot(probe as never);
  const template = probe.nutritionEntries[Math.floor(probe.nutritionEntries.length / 3)]!;
  const row: ScaleRow = { ...template, id: 'nut_reference_new', food_name: 'Chicken and rice bowl' };
  probe.nutritionEntries.push(row);
  const delta = diffLedger(snapshot, probe as never);
  const payload = encodeLedgerOpPayload(
    { id: row.id, meal_type: row.meal_type, household_id: probe.household.id },
    delta,
  );
  const plaintext = utf8Encode(JSON.stringify(payload));
  return {
    plaintext,
    ciphertext: aeadEncrypt(hdk, plaintext, utf8Encode('op-payload-v1')),
    deltaBytes: utf8Encode(JSON.stringify(delta)).length,
  };
}

/** Health's op vocabulary — the write sites Wave A's facades emit (He3). */
const OP_TYPES = [
  'WATER_ADD',
  'MEAL_ADD',
  'WEIGHT_ADD',
  'HABIT_TOGGLE',
  'WORKOUT_ADD',
  'SLEEP_SET',
  'STEPS_SET',
  'GOAL_UPDATE',
] as const;

const ENTITY_TYPES = [
  'water_entry',
  'nutrition_entry',
  'weight_entry',
  'habit_log',
  'health_entry',
  'health_entry',
  'health_entry',
  'health_goal',
] as const;

/**
 * Pool size for distinct sealed payloads. Ops reference pooled buffers rather
 * than owning one each: `bytesToHex` / `sealOpBatch` still do the full per-op
 * work so timings are honest, `JSON.stringify` does not dedupe so sizes are
 * honest, and a 10-year log costs references instead of a hundred thousand
 * buffers.
 */
const PAYLOAD_POOL = 64;

export type OpAuthor = { memberId: string; deviceId: string; lagMs: number };

/** How far behind the second device's clock is: 30 days of history. */
const OFFLINE_LAG_MS = 30 * 24 * 60 * 60 * 1000;

export function authorsFor(ledger: HealthScaleLedger): OpAuthor[] {
  const userId = String(ledger.household.userId);
  const devices = deviceIdsFor();
  return devices.map((deviceId, index) => ({
    memberId: userId,
    deviceId,
    lagMs: index === devices.length - 1 && devices.length > 1 ? -OFFLINE_LAG_MS : 0,
  }));
}

/** `{ deviceId: highest seq }` — what a real batch header carries. */
export function versionVectorFor(ops: StoredOperation[]): Record<string, number> {
  const vv: Record<string, number> = {};
  for (const op of ops) {
    const seen = vv[op.deviceId];
    if (seen === undefined || op.seq > seen) vv[op.deviceId] = op.seq;
  }
  return vv;
}

export function generateHealthOps(input: {
  ledger: HealthScaleLedger;
  count: number;
  hdk: Uint8Array;
  householdId: string;
  seed?: number;
}): StoredOperation[] {
  const { ledger, count, hdk, householdId } = input;
  const seed = input.seed ?? HEALTH_DEFAULT_SEED;
  const authors = authorsFor(ledger);
  const seqByDevice = new Map<string, number>();

  const reference = makeReferenceOpPayload(ledger, hdk);
  const payloadPool = Array.from({ length: PAYLOAD_POOL }, (_, i) =>
    aeadEncrypt(
      hdk,
      utf8Encode(`${new TextDecoder().decode(reference.plaintext).slice(0, -1)},"_p":${i}}`),
      utf8Encode('op-payload-v1'),
    ),
  );
  const signaturePool = Array.from({ length: PAYLOAD_POOL }, (_, i) =>
    pseudoBytes(64, seed + i * 7919),
  );

  const ops: StoredOperation[] = new Array(count);
  // One op per second of history, so the wall-clock prefix spans the corpus the
  // way a real log does. The lagging device's offset is subtracted from ITS ops
  // only, so the log as stored is deliberately NOT sorted by hlc.
  const startWall = 1_700_000_000_000;
  for (let i = 0; i < count; i += 1) {
    const kind = i % OP_TYPES.length;
    const author = authors[i % authors.length]!;
    const seq = (seqByDevice.get(author.deviceId) ?? 0) + 1;
    seqByDevice.set(author.deviceId, seq);
    const wall = startWall + i * 1000 + author.lagMs;
    ops[i] = {
      opId: `op_${String(i).padStart(12, '0')}_h3a1th00`,
      householdId,
      deviceId: author.deviceId,
      authorMemberId: author.memberId,
      hlc: `${String(wall).padStart(15, '0')}-${(i % 0x10000).toString(16).padStart(4, '0')}-${hlcSuffix(author.deviceId)}`,
      seq,
      parentsJson: '[]',
      opType: OP_TYPES[kind]!,
      entityType: ENTITY_TYPES[kind]!,
      entityId: `ent_${i % 20_000}`,
      payload: payloadPool[i % PAYLOAD_POOL]!,
      keyEpoch: 1,
      signature: signaturePool[i % PAYLOAD_POOL]!,
      appliedAt: wall,
    };
  }
  return ops;
}

/**
 * The op log a device with CHECKPOINTS ON actually holds — He8, and the
 * condition the plan's Exit table is measured under ("with checkpoints on
 * (He8), since a cold open in production never replays the full log").
 *
 * `maybePublishHealthCheckpoint` publishes once the log has grown
 * `CHECKPOINT_PUBLISH_MIN_OPS` (100) ops past the last checkpoint's version
 * vector, and `compactLocalHealthLogIfSafe` then truncates below that
 * watermark. So the steady-state resident log is bounded by that watermark, not
 * by the age of the account — and the tail is the NEWEST ops, which is what
 * `listOperationsSince` replays after an install.
 *
 * Measuring cold open against the full log would measure a device that has
 * never published a checkpoint, i.e. exactly the state He8 exists to prevent.
 * The full-log counterfactual is still recorded, labelled, alongside it.
 */
export function checkpointTail(ops: StoredOperation[]): StoredOperation[] {
  return ops.slice(Math.max(0, ops.length - CHECKPOINT_PUBLISH_MIN_OPS));
}
