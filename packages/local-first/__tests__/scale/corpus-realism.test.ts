/**
 * Cheap guard — runs in the package's normal `npm test`.
 *
 * WHAT THIS FILE IS FOR
 * ---------------------
 * A corpus that is not shaped like a real synced household measures a program
 * nobody runs. Three specific ways this corpus was not shaped like one, each
 * pinned below so it cannot come back:
 *
 * 1. `lww: {}`. The per-field LWW watermark map is what a household that has
 *    ever synced definitely HAS, and audit finding C18 — the open finding this
 *    harness exists to grade — is that the map outgrows the row data (6.1 MB vs
 *    3.0 MB at 5 years). With `{}` every persist, serialize, AEAD, hex and
 *    cold-open figure was understated by roughly a third, and any Stage 2/4
 *    compaction of that map would have shown ZERO improvement here.
 *
 * 2. A single-device, strictly monotonic op log. Same `deviceId`, same author,
 *    `seq = i + 1`, one wall clock. The audit's central architectural claim is
 *    that an OFFLINE author's ops carry LOW HLCs; a generator that cannot
 *    produce a low HLC cannot put that claim under load, and the batch header's
 *    version vector was a 1-entry map at every scale despite the comment
 *    claiming one entry per device.
 *
 * 3. `apply.delete200.projected = p50(delete1) * 200`. A multiplication
 *    published as a measurement, and contradicted by the tree it was measured
 *    on: `planTableStrategy` routes a 200-key delta to the INDEXED cursor (one
 *    slice, one Map, one filter at flush), not to 200 whole-table rebuilds.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  applyLedgerDelta,
  planTableStrategy,
  type LedgerDelta,
} from '../../../../src/features/budget/local/projection';

import { enableDevAssertions } from './lib/dev-global';
import {
  bulkDeleteDelta,
  cloneLedger,
  corpusFingerprint,
  generateLedger,
  lwwStampCount,
  memberIdsFor,
  type ScaleRow,
} from './lib/ledger-factory';
import { stats } from './lib/measure';
import { serializeLedgerForPersist } from './lib/mirror';
import { generateOps, hlcAt, versionVectorFor } from './lib/oplog-factory';

enableDevAssertions();

const SMALL = { years: 1, adults: 2 } as const;

// ---------------------------------------------------------------------------
// 1. the LWW watermark map (audit C18)
// ---------------------------------------------------------------------------

describe('scale corpus — a household that has synced has watermarks', () => {
  const ledger = generateLedger(SMALL);

  it('stamps every field of every row, not an empty map', () => {
    const lww = ledger.lww as Record<string, Record<string, { f: Record<string, string> }>>;
    expect(Object.keys(lww).length).toBeGreaterThan(0);

    const expenses = lww.expenses!;
    expect(Object.keys(expenses).length).toBe(ledger.expenses.length);

    const row = ledger.expenses[0] as ScaleRow;
    const meta = expenses[String(row.id)]!;
    for (const field of Object.keys(row)) {
      expect(typeof meta.f[field], `expenses.${field}`).toBe('string');
    }
    // hlc|memberId, exactly `encodeStamp()` (projection.ts:181).
    expect(meta.f.amount).toMatch(/^\d{15}-[0-9a-f]{4}-\S+\|mem_\S+$/);
  });

  it('is authored by more than one member, like a real household', () => {
    const authors = new Set<string>();
    const lww = ledger.lww as Record<string, Record<string, { f: Record<string, string> }>>;
    for (const meta of Object.values(lww.expenses!)) {
      for (const stamp of Object.values(meta.f)) authors.add(stamp.slice(stamp.lastIndexOf('|') + 1));
    }
    expect(authors.size).toBe(memberIdsFor(2).length);
  });

  it('is a material share of what persist() writes — the C18 finding', () => {
    const withLww = serializeLedgerForPersist(ledger).length;
    const withoutLww = serializeLedgerForPersist({ ...ledger, lww: {} }).length;
    const share = (withLww - withoutLww) / withLww;
    // The audit puts the map ABOVE the row data at 5 years. Anything under a
    // fifth of the snapshot means the corpus stopped carrying it.
    expect(share).toBeGreaterThan(0.2);
    expect(lwwStampCount(ledger)).toBeGreaterThan(ledger.expenses.length);
  });

  it('carries watermarks OLDER than an incoming op, so peer edits still win', () => {
    const target = ledger.expenses[42] as ScaleRow;
    const delta: LedgerDelta = { v: 1, u: { expenses: [{ k: String(target.id), f: { amount: 4242 } }] } };
    const result = applyLedgerDelta(ledger as never, delta, {
      hlc: hlcAt(1_800_000_000_000, 1),
      authorMemberId: 'mem_peer01',
      opId: 'op_probe',
    });
    expect(result).toEqual({ applied: 1, deleted: 0, conflicts: [] });
    expect((ledger.expenses[42] as ScaleRow).amount).toBe(4242);
  });

  it('survives cloneLedger instead of being zeroed by it', () => {
    const peer = cloneLedger(ledger);
    expect(lwwStampCount(peer)).toBe(lwwStampCount(ledger));
    expect(peer.lww).not.toBe(ledger.lww);
    const peerLww = peer.lww as Record<string, Record<string, { f: Record<string, string> }>>;
    const ownLww = ledger.lww as Record<string, Record<string, { f: Record<string, string> }>>;
    const key = Object.keys(ownLww.expenses!)[0]!;
    peerLww.expenses![key]!.f.amount = 'mutated';
    expect(ownLww.expenses![key]!.f.amount).not.toBe('mutated');
  });
});

describe('scale corpus — fingerprint', () => {
  it('is stable for the same generator and changes with the corpus', () => {
    expect(corpusFingerprint({ years: 5, adults: 2 })).toBe(corpusFingerprint({ years: 3, adults: 2 }));
    expect(corpusFingerprint({ years: 5, adults: 2 })).not.toBe(
      corpusFingerprint({ years: 5, adults: 2, seed: 7 }),
    );
    expect(corpusFingerprint({ years: 5, adults: 2 })).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ---------------------------------------------------------------------------
// 2. a multi-device op log
// ---------------------------------------------------------------------------

describe('scale op log — more than one device, and one of them offline', () => {
  const ledger = generateLedger(SMALL);
  const ops = generateOps({
    ledger,
    count: 600,
    hdk: new Uint8Array(32).fill(7),
    householdId: String(ledger.household.id),
    deviceId: ledger.deviceId,
    memberId: ledger.memberId,
  });

  it('spreads ops over one device per member', () => {
    const devices = new Set(ops.map((op) => op.deviceId));
    const authors = new Set(ops.map((op) => op.authorMemberId));
    expect(devices.size).toBe(2);
    expect(authors.size).toBe(2);
    expect(devices.has(ledger.deviceId)).toBe(true);
  });

  it('numbers seq per device, contiguously from 1', () => {
    const seen = new Map<string, number[]>();
    for (const op of ops) {
      if (!seen.has(op.deviceId)) seen.set(op.deviceId, []);
      seen.get(op.deviceId)!.push(op.seq);
    }
    for (const [device, seqs] of seen) {
      expect(seqs, device).toEqual(seqs.map((_, i) => i + 1));
    }
  });

  it('interleaves HLCs so an offline author lands BELOW the head', () => {
    // The audit's central case: a scalar HLC cursor silently skips the ops of
    // an author whose clock was behind. A strictly monotonic log cannot
    // construct it, so the harness could never put it under load.
    const outOfOrder = ops.filter((op, i) => i > 0 && op.hlc < ops[i - 1]!.hlc);
    expect(outOfOrder.length).toBeGreaterThan(0);

    const head = ops.reduce((max, op) => (op.hlc > max ? op.hlc : max), '');
    const late = ops.filter((op) => op.hlc < head).slice(-1)[0]!;
    expect(late.hlc < head).toBe(true);
  });

  it('yields a version vector with one entry per device, not one entry total', () => {
    const vv = versionVectorFor(ops);
    expect(Object.keys(vv)).toHaveLength(2);
    for (const [device, seq] of Object.entries(vv)) {
      expect(seq).toBe(ops.filter((op) => op.deviceId === device).length);
    }
  });

  it('stays byte-identical for the same seed', () => {
    const again = generateOps({
      ledger,
      count: 600,
      hdk: new Uint8Array(32).fill(7),
      householdId: String(ledger.household.id),
      deviceId: ledger.deviceId,
      memberId: ledger.memberId,
    });
    expect(again.map((op) => `${op.deviceId}|${op.seq}|${op.hlc}|${op.authorMemberId}`)).toEqual(
      ops.map((op) => `${op.deviceId}|${op.seq}|${op.hlc}|${op.authorMemberId}`),
    );
  });
});

// ---------------------------------------------------------------------------
// 3. the delete-200 shape, measured rather than projected
// ---------------------------------------------------------------------------

const APPLY_PHASE = readFileSync(
  fileURLToPath(new URL('./phases/apply.scale.ts', import.meta.url)),
  'utf8',
);

describe('scale phase apply — bulk delete is measured, not multiplied', () => {
  it('routes a 200-key delete to the indexed cursor, and a 1-key delete to the scan', () => {
    const ledger = generateLedger(SMALL);
    const bulk = bulkDeleteDelta(ledger, 'expenses', 200, 0);
    expect(bulk.d!.expenses).toHaveLength(200);
    expect(planTableStrategy(bulk, 'expenses')).toBe('index');

    const one = bulkDeleteDelta(ledger, 'expenses', 1, 0);
    expect(planTableStrategy(one, 'expenses')).toBe('scan');
  });

  it('costs far less than 200 single-key deletes, which is what the projection assumed', () => {
    const stamp = (k: number) => ({
      hlc: hlcAt(1_900_000_000_000 + k * 1000, k % 0x10000),
      authorMemberId: 'mem_peer01',
      opId: `opdel_${k}`,
    });

    const single = generateLedger(SMALL);
    const singleSamples: number[] = [];
    for (let k = 0; k < 40; k += 1) {
      const delta = bulkDeleteDelta(single, 'expenses', 1, k * 37);
      const t0 = performance.now();
      applyLedgerDelta(single as never, delta, stamp(k));
      if (k >= 5) singleSamples.push(performance.now() - t0);
    }

    const bulk = generateLedger(SMALL);
    const bulkSamples: number[] = [];
    for (let k = 0; k < 8; k += 1) {
      const delta = bulkDeleteDelta(bulk, 'expenses', 200, k * 200);
      const t0 = performance.now();
      applyLedgerDelta(bulk as never, delta, stamp(1000 + k));
      if (k >= 2) bulkSamples.push(performance.now() - t0);
    }

    // `min`, not `p50`. Both numbers here are sub-millisecond, and this test
    // runs inside the ordinary `npm test` sweep alongside 25 other files — so
    // the p50 of a handful of samples is mostly a measurement of how busy the
    // machine was, and the RATIO of two such p50s compounds that noise twice
    // over. On this repo it read 40x / 46x / 66x on three consecutive runs of
    // the SAME commit, with no code change in between. The minimum of repeated
    // timings is the standard robust estimator for a micro-benchmark: it is the
    // sample least contaminated by scheduler preemption, and it is the one that
    // actually characterises the algorithm.
    //
    // The claim under test is unchanged and still strong: the published figure
    // modelled a 200-key delete as 200 single-key deletes, and a 40x bound
    // fails that model by a factor of five.
    const ratio = stats(bulkSamples).min / Math.max(1e-6, stats(singleSamples).min);
    expect(ratio).toBeLessThan(40);
  });

  it('publishes a measured metric and no projected one', () => {
    expect(APPLY_PHASE).toMatch(/recorder\.time\(\s*'apply\.delete200'/);
    expect(APPLY_PHASE).not.toContain('projected');
  });

  it('cites the per-key rebuild at its real location', () => {
    // The scan cursor's `remove` is what rebuilds the table array per key.
    // projection.ts:363 is `tableDeletes.push(key)` inside diffLedger — the
    // citation the phase, its header and the README all used to carry.
    expect(APPLY_PHASE).not.toContain('projection.ts:363');
    expect(APPLY_PHASE).toContain('createScanCursor');
  });
});
