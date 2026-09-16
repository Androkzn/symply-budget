/**
 * `StoredOperation[]` for the House corpus, with REAL sealed op payloads.
 *
 * Same reasoning as the Budget op factory: op byte size drives both the persist
 * cost and the 512,000-char relay cap, so a made-up payload size would give a
 * wrong answer to the single most important question — at how many ops does a
 * House sync stop fitting in one deposit. The payload here is what the app
 * really writes: `encodeLedgerOpPayload(intent, delta)` over a genuine
 * single-field diff on the HOUSE registry, JSON-stringified, utf8-encoded, then
 * AEAD-sealed under the household key.
 *
 * The brand-neutral primitives (`pseudoBytes`, `hlcAt`, `cryptoBundleFor`) are
 * imported from the Budget op factory rather than copied — they are pure byte
 * utilities with no registry in them.
 *
 * Signatures are 64 pseudo-random bytes, not real Ed25519: correct for size and
 * for the persist/batch paths, silent about verify cost. The baseline says so.
 */
import {
  captureLedgerSnapshot,
  diffLedger,
  encodeLedgerOpPayload,
} from '../../../../../src/features/house/local/projection';
import { aeadEncrypt } from '../../../src/crypto/aead';
import { utf8Encode } from '../../../src/crypto/bytes';
import type { StoredOperation } from '../../../src/store/types';

import { hlcSuffix } from './corpus-core';
import {
  cloneLedger,
  deviceIdsFor,
  memberIdsFor,
  type HouseScaleLedger,
} from './house-ledger-factory';
import { pseudoBytes } from './oplog-factory';

export { cryptoBundleFor, hlcAt, pseudoBytes } from './oplog-factory';

export type ReferencePayload = {
  plaintext: Uint8Array;
  ciphertext: Uint8Array;
  /** JSON byte size of the delta alone — the semantic change the user made. */
  deltaBytes: number;
};

/**
 * The op a single-field edit really produces on this corpus: capture, mark one
 * maintenance completion's notes, diff, wrap in the op payload envelope, seal.
 *
 * `maintenanceCompletions` rather than `tasks` on purpose — it is House's
 * highest-cardinality table and the one a member touches most often, so it is
 * the representative edit. The `tasks` edit is measured separately in the edit
 * phase, because a 41-field row is the interesting one for write amplification.
 */
export function makeReferenceOpPayload(
  ledger: HouseScaleLedger,
  hdk: Uint8Array,
): ReferencePayload {
  const probe = cloneLedger(ledger);
  const snapshot = captureLedgerSnapshot(probe as never);
  const row = probe.maintenanceCompletions[
    Math.floor(probe.maintenanceCompletions.length / 3)
  ]!;
  row.notes = 'Done — replaced the filter and logged the size.';
  const delta = diffLedger(snapshot, probe as never);
  const payload = encodeLedgerOpPayload(
    { id: row.id, notes: row.notes, household_id: probe.household.id },
    delta,
  );
  const plaintext = utf8Encode(JSON.stringify(payload));
  return {
    plaintext,
    ciphertext: aeadEncrypt(hdk, plaintext, utf8Encode('op-payload-v1')),
    deltaBytes: utf8Encode(JSON.stringify(delta)).length,
  };
}

/** House op vocabulary — the write sites Wave A's facades will emit (H3). */
const OP_TYPES = [
  'TASK_CREATE',
  'TASK_UPDATE',
  'MAINTENANCE_COMPLETE',
  'SUBTASK_TOGGLE',
  'CHECKLIST_ITEM_COMPLETE',
  'SPACE_UPSERT',
] as const;

const ENTITY_TYPES = [
  'task',
  'task',
  'maintenance_completion',
  'maintenance_subtask',
  'checklist_item_completion',
  'household_space',
] as const;

/**
 * Pool size for distinct sealed payloads. Ops reference pooled buffers rather
 * than owning one each: `bytesToHex`/`sealOpBatch` still do the full per-op
 * work so timings are honest, JSON.stringify does not dedupe so sizes are
 * honest, and a 10-year log costs references instead of tens of thousands of
 * buffers.
 */
const PAYLOAD_POOL = 64;

export type OpAuthor = { memberId: string; deviceId: string; lagMs: number };

/** How far behind the offline author's clock is: 30 days of history. */
const OFFLINE_LAG_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * ONE OP LOG, SEVERAL DEVICES — one device per member, `seq` counted per device
 * (what the store does), and the LAST member designated OFFLINE so its ops
 * carry low HLCs and land BELOW the receiving device's head. Without that the
 * log is monotonic, `senderVersionVector` is a one-entry map at every scale, and
 * the interleaving the whole design turns on is never exercised.
 */
export function authorsFor(ledger: HouseScaleLedger): OpAuthor[] {
  const adults = Math.max(1, Number(ledger.household.member_count ?? 1));
  const members = memberIdsFor(adults);
  const devices = deviceIdsFor(adults);
  return members.map((memberId, index) => ({
    memberId,
    deviceId: devices[index]!,
    lagMs: adults > 1 && index === adults - 1 ? -OFFLINE_LAG_MS : 0,
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

export function generateHouseOps(input: {
  ledger: HouseScaleLedger;
  count: number;
  hdk: Uint8Array;
  householdId: string;
  seed?: number;
}): StoredOperation[] {
  const { ledger, count, hdk, householdId } = input;
  const seed = input.seed ?? 0x0405e;
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
  // way a real log does. The offline author's lag is subtracted from ITS ops
  // only, so the log as stored is deliberately NOT sorted by hlc.
  const startWall = 1_700_000_000_000;
  for (let i = 0; i < count; i += 1) {
    const kind = i % OP_TYPES.length;
    const author = authors[i % authors.length]!;
    const seq = (seqByDevice.get(author.deviceId) ?? 0) + 1;
    seqByDevice.set(author.deviceId, seq);
    const wall = startWall + i * 1000 + author.lagMs;
    ops[i] = {
      opId: `op_${String(i).padStart(12, '0')}_h1o2u3s4`,
      householdId,
      deviceId: author.deviceId,
      authorMemberId: author.memberId,
      hlc: `${String(wall).padStart(15, '0')}-${(i % 0x10000).toString(16).padStart(4, '0')}-${hlcSuffix(author.deviceId)}`,
      seq,
      parentsJson: '[]',
      opType: OP_TYPES[kind]!,
      entityType: ENTITY_TYPES[kind]!,
      entityId: `ent_${i % 12_000}`,
      payload: payloadPool[i % PAYLOAD_POOL]!,
      keyEpoch: 1,
      signature: signaturePool[i % PAYLOAD_POOL]!,
      appliedAt: wall,
    };
  }
  return ops;
}
