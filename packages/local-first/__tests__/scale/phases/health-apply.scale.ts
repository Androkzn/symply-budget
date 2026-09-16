/**
 * Health He10 — `applyLedgerDelta`, ONE DEPOSIT.
 *
 * WHAT "ONE DEPOSIT" MEANS, AND WHY IT IS NOT ONE PATCH
 * ----------------------------------------------------
 * The plan's row is "`applyLedgerDelta`, one deposit — 500 ms p95". A deposit
 * is a mailbox chunk: the largest op batch that still fits under
 * `MAX_MAILBOX_CIPHERTEXT_B64` once sealed. On this corpus that is in the
 * hundreds of ops, and applying it is hundreds of `applyLedgerDelta` calls, not
 * one. A single-row patch costs tens of microseconds — a 500 ms threshold on
 * that would be unfalsifiable, which is a good sign it is the wrong reading.
 * So the deposit size is MEASURED with the real `sealOpBatch` against the real
 * cap (`lib/batch-cap.ts`, shared verbatim with Budget and House), and the
 * gated number is the cost of applying a full one.
 *
 * The deposit's composition is what the user's OTHER DEVICE really sends after
 * a few days offline: mostly creates (cups of water, meals, weigh-ins, habit
 * ticks), a minority of patches (a corrected portion, an edited note) and a few
 * deletes. A deposit of pure patches would flatter the number — `create` copies
 * the table array, `patch` does not.
 *
 * The per-shape breakdown below mirrors House's phase so the merge core stays
 * comparable shape-for-shape across brands, at p50 for the reasons that phase
 * gives: every sample walks a different prefix of a linear scan, so min reports
 * the luckiest one.
 *
 * ONE HONEST CAVEAT: the ledger GROWS across deposit samples. Re-generating a
 * 10-year corpus per sample costs more than the measurement, so the samples run
 * against a ledger that gains one deposit's worth of rows each time — under 1%
 * per sample. The growth is recorded (`apply.deposit.rowGrowth`) rather than
 * hidden.
 */
import { performance } from 'node:perf_hooks';

import { describe, it } from 'vitest';

import {
  applyLedgerDelta,
  planTableStrategy,
  type LedgerDelta,
} from '../../../../../src/features/health/local/projection';
import { CHUNK_BUDGET_B64, MAX_MAILBOX_CIPHERTEXT_B64, findMaxOpsUnderCap } from '../lib/batch-cap';
import {
  bulkDeleteDelta,
  generateHealthLedger,
  totalRows,
  type HealthScaleLedger,
  type ScaleRow,
} from '../lib/health-ledger-factory';
import {
  cryptoBundleFor,
  generateHealthOps,
  hlcAt,
  pseudoBytes,
  versionVectorFor,
} from '../lib/health-oplog-factory';
import { startHealthPhase } from '../lib/health-phase';
import {
  HEALTH_EXIT_THRESHOLDS,
  assertExitChecks,
  recordExitChecks,
  timeCheck,
} from '../lib/health-thresholds';
import { forceGc, stats } from '../lib/measure';

const GRADE_P50 = { stat: 'p50' } as const;

const stamp = (k: number, prefix: string) => ({
  hlc: hlcAt(1_800_000_000_000 + k * 1000, k % 0x10000),
  authorMemberId: 'usr_h3a1th7c0d2e5f8',
  opId: `${prefix}_${k}`,
});

/** A stamp BELOW the corpus watermarks — the concurrent write that must lose. */
const losingStamp = (k: number) => ({
  hlc: hlcAt(1_500_000_000_000 + k * 1000, k % 0x10000),
  authorMemberId: 'usr_h3a1th7c0d2e5f8',
  opId: `lose_${k}`,
});

/**
 * The deltas one deposit carries: `count` ops from the peer device, in the mix
 * a Health diary really produces.
 */
function depositDeltas(
  ledger: HealthScaleLedger,
  count: number,
  round: number,
): LedgerDelta[] {
  const tables = ['waterEntries', 'nutritionEntries', 'weightEntries', 'habitLogs', 'healthEntries'] as const;
  const out: LedgerDelta[] = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const table = tables[i % tables.length]!;
    const rows = ledger[table] as ScaleRow[];
    const roll = (i * 7 + round) % 20;
    if (roll < 14) {
      // create — 70%
      const template = rows[(i * 7919) % rows.length]!;
      const fresh = { ...template, id: `${String(template.id).slice(0, 3)}_dep_${round}_${i}` };
      out[i] = { v: 1, u: { [table]: [{ k: String(fresh.id), f: fresh, n: 1 }] } } as LedgerDelta;
    } else if (roll < 19) {
      // patch — 25%
      const key = String(rows[(i * 7919) % rows.length]!.id);
      out[i] = { v: 1, u: { [table]: [{ k: key, f: { updated_at: `2026-03-14T0${i % 10}:00:00.000Z` } }] } } as LedgerDelta;
    } else {
      // delete — 5%
      const key = String(rows[(i * 4409) % rows.length]!.id);
      out[i] = { v: 1, d: { [table]: [key] } } as LedgerDelta;
    }
  }
  return out;
}

describe('health scale: applyLedgerDelta throughput', () => {
  it('measures', () => {
    const ctx = startHealthPhase('apply');
    const { recorder, iters } = ctx;

    const hdk = pseudoBytes(32, 0xb0b);

    // ---- how big IS one deposit? -----------------------------------------
    //
    // Measured against the real `sealOpBatch` and the real relay cap, not
    // assumed. `--adults` is pinned at 1, so the version vector here is the
    // two-DEVICE map a personal household really sends.
    const sizing = generateHealthLedger({ years: 1, seed: ctx.spec.seed });
    const sizingOps = generateHealthOps({
      ledger: sizing,
      count: 2000,
      hdk,
      householdId: String(sizing.household.id),
      seed: ctx.spec.seed,
    });
    const crypto = cryptoBundleFor(ctx.spec.seed);
    const cap = findMaxOpsUnderCap({
      householdId: String(sizing.household.id),
      senderDeviceId: String(sizing.deviceId),
      senderSigningPublicKeyB64: String(crypto.signingPublicKeyHex).slice(0, 44),
      senderVersionVector: versionVectorFor(sizingOps),
      ops: sizingOps,
      hdk,
      keyEpoch: 1,
      cap: MAX_MAILBOX_CIPHERTEXT_B64,
    });
    const depositOps = Math.max(1, cap.maxOps);
    recorder.count('apply.deposit.maxOps', depositOps, 'ops', 'higher', 'real sealOpBatch vs the real relay cap');
    recorder.size('apply.deposit.b64AtMax', cap.atMax.b64, 'chars', `cap ${MAX_MAILBOX_CIPHERTEXT_B64}`);
    recorder.count(
      'apply.deposit.chunkBudgetB64',
      CHUNK_BUDGET_B64,
      'count',
      'flat',
      'what sealChunks targets: cap x CHUNK_FILL_RATIO',
    );

    // ---- THE GATED NUMBER: apply one whole deposit -----------------------
    const ledger = generateHealthLedger(ctx.spec);
    const rowsBefore = totalRows(ledger);
    const samples: number[] = [];
    // p95 over 8 samples is the max of 8. The deposit is the gated number, so
    // it gets enough rounds to be a percentile — at the cost of ~1% row growth
    // per round, which is recorded rather than hidden.
    const rounds = Math.max(16, iters.medium * 2);
    for (let round = 0; round < rounds; round += 1) {
      const deltas = depositDeltas(ledger, depositOps, round);
      forceGc();
      const t0 = performance.now();
      for (let i = 0; i < deltas.length; i += 1) {
        applyLedgerDelta(ledger as never, deltas[i]!, stamp(round * depositOps + i, 'deposit'));
      }
      samples.push(performance.now() - t0);
    }
    const st = stats(samples);
    const rowsAfter = totalRows(ledger);
    recorder.time('apply.deposit', st, `${depositOps} ops applied back to back — THE GATED NUMBER`, GRADE_P50);
    recorder.ratio(
      'apply.deposit.msPerOp',
      st.p50 / Math.max(depositOps, 1),
      'lower',
      'per-op cost inside a full deposit',
    );
    recorder.ratio(
      'apply.deposit.rowGrowth',
      rowsAfter / Math.max(rowsBefore, 1),
      'flat',
      `${rowsBefore} → ${rowsAfter} rows across ${rounds} deposit samples`,
    );

    const checks = [
      timeCheck({
        id: 'applyDeposit',
        label: '`applyLedgerDelta`, one deposit (p95)',
        measuredMs: st.p95,
        thresholdMs: HEALTH_EXIT_THRESHOLDS.applyDepositP95Ms,
        notes: `${depositOps} ops = one mailbox deposit`,
      }),
    ];
    recordExitChecks(recorder, checks);

    // The per-shape breakdown is diagnostic, not gated — but it must be on the
    // record BEFORE anything can throw, so it runs here and the assert is the
    // last statement in the test.
    runShapeBreakdown(ctx, depositOps);
    recorder.end();
    assertExitChecks(ctx.spec.years, checks);
  });
});

/** The shape-by-shape merge breakdown, mirroring House's phase. */
function runShapeBreakdown(
  ctx: ReturnType<typeof startHealthPhase>,
  depositOps: number,
): void {
  const { recorder, scale, iters } = ctx;

  // ---- patch 1 row (waterEntries — the highest-cardinality table) --------
  {
    const ledger = generateHealthLedger(ctx.spec);
    const rows = ledger.waterEntries as ScaleRow[];
    const samples: number[] = [];
    for (let k = 0; k < iters.light; k += 1) {
      const key = String(rows[(k * 7919) % rows.length]!.id);
      const delta: LedgerDelta = { v: 1, u: { waterEntries: [{ k: key, f: { amount_ml: 250 + k } }] } };
      const t0 = performance.now();
      applyLedgerDelta(ledger as never, delta, stamp(k, 'patch'));
      samples.push(performance.now() - t0);
    }
    const st = stats(samples);
    recorder.time('apply.patch1', st, `${scale.rows} rows, watermarked`, GRADE_P50);
    recorder.ratio('apply.patch1.opsPerSec', 1000 / Math.max(st.p50, 1e-9), 'higher', 'at p50');
  }

  // ---- patch 1 WIDE row (healthGoals, ~60 populated fields) --------------
  {
    const ledger = generateHealthLedger(ctx.spec);
    const rows = ledger.healthGoals as ScaleRow[];
    const samples: number[] = [];
    for (let k = 0; k < iters.light; k += 1) {
      const key = String(rows[k % rows.length]!.id);
      const delta: LedgerDelta = { v: 1, u: { healthGoals: [{ k: key, f: { daily_calories: 2000 + k } }] } };
      const t0 = performance.now();
      applyLedgerDelta(ledger as never, delta, stamp(k, 'wide'));
      samples.push(performance.now() - t0);
    }
    const st = stats(samples);
    recorder.time('apply.patch1.wideRow', st, `${rows.length} goals, ~60 fields each`, GRADE_P50);
  }

  // ---- create 1 row ------------------------------------------------------
  {
    const ledger = generateHealthLedger(ctx.spec);
    const template = { ...(ledger.nutritionEntries as ScaleRow[])[0]! };
    const samples: number[] = [];
    for (let k = 0; k < iters.light; k += 1) {
      const fresh = { ...template, id: `nut_new_${k}` };
      const delta: LedgerDelta = { v: 1, u: { nutritionEntries: [{ k: String(fresh.id), f: fresh, n: 1 }] } };
      const t0 = performance.now();
      applyLedgerDelta(ledger as never, delta, stamp(k, 'create'));
      samples.push(performance.now() - t0);
    }
    const st = stats(samples);
    recorder.time('apply.create1', st, `${scale.rows} rows, growing`, GRADE_P50);
    recorder.ratio('apply.create1.opsPerSec', 1000 / Math.max(st.p50, 1e-9), 'higher', 'at p50');
  }

  // ---- bulk 200 ----------------------------------------------------------
  {
    const ledger = generateHealthLedger(ctx.spec);
    const rows = ledger.habitLogs as ScaleRow[];
    const bulk = Math.min(200, rows.length);
    const samples: number[] = [];
    for (let k = 0; k < iters.medium; k += 1) {
      const delta: LedgerDelta = {
        v: 1,
        u: {
          habitLogs: Array.from({ length: bulk }, (_, j) => ({
            k: String(rows[(k * bulk + j) % rows.length]!.id),
            f: { notes: `bulk ${k}-${j}` },
          })),
        },
      };
      const t0 = performance.now();
      applyLedgerDelta(ledger as never, delta, stamp(k, 'bulk'));
      samples.push(performance.now() - t0);
    }
    const st = stats(samples);
    recorder.time('apply.bulk200', st, `${bulk} rows per op`, GRADE_P50);
    recorder.ratio('apply.bulk200.rowsPerSec', (bulk * 1000) / Math.max(st.p50, 1e-9), 'higher', 'at p50');
  }

  // ---- delete 1 ----------------------------------------------------------
  {
    const ledger = generateHealthLedger(ctx.spec);
    const rows = ledger.waterEntries as ScaleRow[];
    const budget = Math.min(iters.medium + 5, Math.floor(rows.length / 4));
    const unique = [
      ...new Set(Array.from({ length: budget }, (_, k) => String(rows[(k * 7919) % rows.length]!.id))),
    ];
    const samples: number[] = [];
    for (let k = 0; k < unique.length; k += 1) {
      const delta: LedgerDelta = { v: 1, d: { waterEntries: [unique[k]!] } };
      const t0 = performance.now();
      applyLedgerDelta(ledger as never, delta, stamp(k, 'del1'));
      samples.push(performance.now() - t0);
    }
    recorder.time('apply.delete1', stats(samples), `${unique.length} distinct rows deleted`, GRADE_P50);
  }

  // ---- delete 200, measured ---------------------------------------------
  {
    const ledger = generateHealthLedger(ctx.spec);
    const samples: number[] = [];
    for (let k = 0; k < Math.max(3, iters.heavy + 3); k += 1) {
      const delta = bulkDeleteDelta(ledger, 'waterEntries', 200, k * 200);
      const t0 = performance.now();
      applyLedgerDelta(ledger as never, delta as never, stamp(1000 + k, 'del200'));
      samples.push(performance.now() - t0);
    }
    recorder.time('apply.delete200', stats(samples), 'indexed cursor: one slice, one Map, one filter', GRADE_P50);
    recorder.count(
      'apply.delete200.strategyIsIndex',
      planTableStrategy(
        bulkDeleteDelta(generateHealthLedger(ctx.spec), 'waterEntries', 200) as never,
        'waterEntries',
      ) === 'index'
        ? 1
        : 0,
      'count',
      'flat',
      '1 = routed to createIndexedCursor as intended',
    );
  }

  // ---- concurrent losing write (BR-044) ---------------------------------
  {
    const ledger = generateHealthLedger(ctx.spec);
    const rows = ledger.weightEntries as ScaleRow[];
    const samples: number[] = [];
    for (let k = 0; k < iters.light; k += 1) {
      const key = String(rows[(k * 7919) % rows.length]!.id);
      const delta: LedgerDelta = { v: 1, u: { weightEntries: [{ k: key, f: { weight: 80 + (k % 5) } }] } };
      const t0 = performance.now();
      applyLedgerDelta(ledger as never, delta, losingStamp(k));
      samples.push(performance.now() - t0);
    }
    recorder.time('apply.concurrentLoser', stats(samples), 'wins() loses; conflict recorded', GRADE_P50);
    recorder.count(
      'apply.concurrentLoser.conflicts',
      (ledger.conflicts ?? []).length,
      'count',
      'flat',
      'bounded by MAX_TRACKED_CONFLICTS',
    );
  }

  // ---- orphan park -------------------------------------------------------
  {
    const ledger = generateHealthLedger(ctx.spec);
    const samples: number[] = [];
    for (let k = 0; k < iters.medium; k += 1) {
      const delta: LedgerDelta = {
        v: 1,
        u: { waterEntries: [{ k: `wtr_absent_${k}`, f: { amount_ml: 250 } }] },
      };
      const t0 = performance.now();
      applyLedgerDelta(ledger as never, delta, stamp(k, 'orphan'));
      samples.push(performance.now() - t0);
    }
    recorder.time(
      'apply.orphanPark',
      stats(samples),
      'parkOrphanPatch + parkedRowCount scan over the whole watermark map',
      GRADE_P50,
    );
  }

  recorder.count(
    'apply.deposit.opsPerDeposit',
    depositOps,
    'ops',
    'higher',
    'restated here so the breakdown and the gate read the same deposit',
  );
}
