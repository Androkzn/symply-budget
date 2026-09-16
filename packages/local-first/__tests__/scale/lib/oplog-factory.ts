/**
 * `StoredOperation[]` whose payloads are REAL sealed op payloads.
 *
 * WHY NOT SYNTHETIC FIXED-SIZE PAYLOADS
 * -------------------------------------
 * Op byte size drives both the persist cost (every op is hex-encoded into the
 * snapshot on every mutation, engine.ts:417-424) and the 512,000-char relay cap
 * (mailbox-engine.ts:29). A made-up payload size would give a wrong answer to
 * the single most important question in the brief — at how many ops does a sync
 * stop fitting. So the payload here is what the app really writes:
 * `encodeLedgerOpPayload(intent, delta)` over a genuine single-field diff,
 * JSON-stringified, utf8-encoded, then AEAD-sealed under the household key.
 *
 * Signatures are 64 pseudo-random bytes rather than real Ed25519. Correct for
 * size and for the persist/batch paths; signing 35,367 ops would add ~80 s of
 * setup and tells us nothing about either. It does mean this harness reports
 * nothing about *verify* cost, which Stage 5's bootstrap decision needs — the
 * baseline doc says so out loud.
 */
import {
  captureLedgerSnapshot,
  diffLedger,
  encodeLedgerOpPayload,
} from '../../../../../src/features/budget/local/projection';
import { aeadEncrypt } from '../../../src/crypto/aead';
import { utf8Encode } from '../../../src/crypto/bytes';
import type { StoredOperation } from '../../../src/store/types';

import { cloneLedger, deviceIdsFor, memberIdsFor, type ScaleLedger } from './ledger-factory';

/**
 * Deterministic bytes. NOT `crypto/bytes.ts#randomBytes`, which throws
 * QuotaExceededError above 65,536 bytes — `crypto.getRandomValues` caps at
 * 64 KiB per call and bytes.ts:6 does not chunk. Latent in product code (no
 * path asks for more than 64 bytes today) but it makes `randomBytes` unusable
 * for bulk buffers, as `budget-v2-hotpath.bench.test.ts:193` already found.
 */
export function pseudoBytes(len: number, seed = 0x9e3779b9): Uint8Array {
  const out = new Uint8Array(len);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < len; i += 1) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

/** HLC exactly as `hlc.ts#format` builds it: wall-padded, counter, device suffix. */
export function hlcAt(wallMs: number, counter: number, deviceSuffix = 'devA1b2c'): string {
  return `${String(wallMs).padStart(15, '0')}-${counter.toString(16).padStart(4, '0')}-${deviceSuffix}`;
}

export type ReferencePayload = {
  plaintext: Uint8Array;
  ciphertext: Uint8Array;
  /** JSON byte size of the delta alone — the semantic change the user made. */
  deltaBytes: number;
};

/**
 * The op a single-field edit really produces on this corpus: capture, change
 * one expense amount, diff, wrap in the op payload envelope, seal.
 */
export function makeReferenceOpPayload(ledger: ScaleLedger, hdk: Uint8Array): ReferencePayload {
  const probe = cloneLedger(ledger);
  const snapshot = captureLedgerSnapshot(probe as never);
  const row = probe.expenses[Math.floor(probe.expenses.length / 3)]!;
  row.amount = 91_234;
  const delta = diffLedger(snapshot, probe as never);
  const payload = encodeLedgerOpPayload(
    { id: row.id, amount: 91_234, household_id: probe.household.id },
    delta,
  );
  const plaintext = utf8Encode(JSON.stringify(payload));
  return {
    plaintext,
    ciphertext: aeadEncrypt(hdk, plaintext, utf8Encode('op-payload-v1')),
    deltaBytes: utf8Encode(JSON.stringify(delta)).length,
  };
}

const OP_TYPES = [
  'EXPENSE_CREATE',
  'EXPENSE_UPDATE',
  'GOAL_SET',
  'SAVINGS_SPENDING_CREATE',
  'REGISTERED_TX_ADD',
  'SUB_BUDGET_UPSERT',
] as const;

const ENTITY_TYPES = ['expense', 'expense', 'goal', 'savings_spending', 'registered_tx', 'sub_budget'] as const;

/**
 * Pool size for distinct sealed payloads. Ops reference pooled buffers rather
 * than owning one each: `bytesToHex` still does the full per-op work so timings
 * are honest, JSON.stringify does not dedupe so sizes are honest, and a 10-year
 * log costs ~35 MB of references instead of ~35 MB x 64 of buffers.
 */
const PAYLOAD_POOL = 64;

/**
 * ONE OP LOG, SEVERAL DEVICES
 * ---------------------------
 * The first version of this generator gave every op the same `deviceId`, the
 * same author and `seq = i + 1` off one wall clock, even at `--adults 4`. That
 * corpus cannot express the case the whole audit turns on: an author who was
 * OFFLINE, whose ops therefore carry LOW HLCs and land BELOW the receiving
 * device's head. It also made the batch header's `senderVersionVector` a
 * one-entry map at every scale — the header whose size this phase reports.
 *
 * So: one device per member, `seq` counted per device (which is what the store
 * does), and one member designated OFFLINE — its ops are authored with a wall
 * clock `OFFLINE_LAG_MS` behind everyone else's, so the log is interleaved and
 * not monotonic. Everything stays a pure function of (seed, count, adults).
 */
export type OpAuthor = { memberId: string; deviceId: string; lagMs: number };

/** How far behind the offline author's clock is: 30 days of history. */
const OFFLINE_LAG_MS = 30 * 24 * 60 * 60 * 1000;

export function authorsFor(ledger: ScaleLedger): OpAuthor[] {
  const adults = Math.max(1, Number(ledger.household.member_count ?? 1));
  const members = memberIdsFor(adults);
  const devices = deviceIdsFor(adults);
  return members.map((memberId, index) => ({
    memberId,
    deviceId: devices[index]!,
    // The LAST member is the one that went offline. With a single adult there
    // is nobody to be offline and the log is monotonic, which is correct.
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

export function generateOps(input: {
  ledger: ScaleLedger;
  count: number;
  hdk: Uint8Array;
  householdId: string;
  deviceId: string;
  memberId: string;
  seed?: number;
}): StoredOperation[] {
  const { ledger, count, hdk, householdId } = input;
  const seed = input.seed ?? 0x5c41e;
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
      opId: `op_${String(i).padStart(12, '0')}_a1b2c3d4`,
      householdId,
      deviceId: author.deviceId,
      authorMemberId: author.memberId,
      hlc: hlcAt(wall, i % 0x10000, hlcSuffixOf(author.deviceId)),
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

/** Device suffix `hlc.ts#format` embeds — last 7 chars of the device id. */
const hlcSuffixOf = (deviceId: string): string => deviceId.slice(-7);

/** Crypto bundle `persist()` writes into the snapshot (engine.ts:416). */
export function cryptoBundleFor(seed = 0x5c41e): Record<string, string | number> {
  const hex = (n: number) =>
    Array.from(pseudoBytes(32, seed + n), (b) => b.toString(16).padStart(2, '0')).join('');
  return {
    signingPrivateKeyHex: hex(1),
    signingPublicKeyHex: hex(2),
    agreementPrivateKeyHex: hex(3),
    agreementPublicKeyHex: hex(4),
    hdkHex: hex(5),
    keyEpoch: 1,
  };
}
