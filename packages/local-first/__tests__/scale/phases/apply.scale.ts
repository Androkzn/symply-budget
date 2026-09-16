/**
 * Requirement 2 — `applyLedgerDelta` throughput.
 *
 * Six shapes, because they hit structurally different code:
 *   PATCH  1 row  — linear `rowsOf().find()` (projection.ts:395)
 *   CREATE 1 row  — full array copy `setRows([...tableRows, target])` (:408)
 *   BULK   200    — what mortgage propagate / applyGoalToYear / registered
 *                   apply-regular really emit
 *   DELETE 1 row  — `createScanCursor.remove` rebuilds the whole table array
 *                   for the one key
 *   DELETE 200    — MEASURED, not multiplied. `planTableStrategy` routes any
 *                   delta touching >= LEDGER_INDEX_THRESHOLD (16) rows to
 *                   `createIndexedCursor`: one `rows.slice()`, one Map build,
 *                   O(1) per key and ONE `rows.filter` at `flush()`. The
 *                   previous version of this phase multiplied p50(delete1) by
 *                   200 and published the product as a measurement; on this
 *                   tree that overstates the real cost by more than an order of
 *                   magnitude. It also cited the per-key rebuild at a line that
 *                   is `tableDeletes.push(key)` inside `diffLedger`; the rebuild
 *                   is `createScanCursor.remove`.
 *   CONCURRENT    — a losing stamp on a row that already has a watermark: the
 *                   `wins()` / `recordConflict` branch. The single-device corpus
 *                   and the empty `lww` map meant nothing in this harness ever
 *                   entered it, even though BR-044 conflict surfacing is the
 *                   product behaviour Stages 1-5 must not break.
 *   ORPHAN        — a patch for a row whose create has not arrived, i.e.
 *                   `parkOrphanPatch` plus the `parkedRowCount` scan over the
 *                   ENTIRE watermark map (projection.ts:542-553). Free on an
 *                   empty map, O(rows) on a real one.
 *
 * Times here are graded at p50, not min: every sample walks a different prefix
 * of a linear scan, so min reports the luckiest one and is scale-invariant
 * noise (baseline: apply.patch1 min ~0.002 ms at every scale while p50 went
 * 0.011 -> 0.080 ms).
 */
import { performance } from 'node:perf_hooks';

import { describe, it } from 'vitest';

import {
  applyLedgerDelta,
  planTableStrategy,
  type LedgerDelta,
} from '../../../../../src/features/budget/local/projection';
import { bulkDeleteDelta, generateLedger, type ScaleRow } from '../lib/ledger-factory';
import { stats } from '../lib/measure';
import { hlcAt } from '../lib/oplog-factory';
import { startPhase } from '../lib/phase';

const P50 = { stat: 'p50' } as const;

const stamp = (k: number, prefix: string) => ({
  hlc: hlcAt(1_800_000_000_000 + k * 1000, k % 0x10000),
  authorMemberId: 'mem_peer01',
  opId: `${prefix}_${k}`,
});

/** A stamp BELOW the corpus watermarks — the concurrent write that must lose. */
const losingStamp = (k: number) => ({
  hlc: hlcAt(1_500_000_000_000 + k * 1000, k % 0x10000),
  authorMemberId: 'mem_peer01',
  opId: `oplose_${k}`,
});

describe('scale: applyLedgerDelta throughput', () => {
  it('measures', () => {
    const ctx = startPhase('apply');
    const { recorder, scale, iters } = ctx;

    // (a) one row, one field — the ordinary incoming peer edit
    {
      const ledger = generateLedger(ctx.spec);
      const expenses = ledger.expenses as ScaleRow[];
      const samples: number[] = [];
      for (let k = 0; k < iters.light + 20; k += 1) {
        const key = String(expenses[(k * 7919) % expenses.length]!.id);
        const delta: LedgerDelta = { v: 1, u: { expenses: [{ k: key, f: { amount: 900 + k } }] } };
        const t0 = performance.now();
        applyLedgerDelta(ledger as never, delta, stamp(k, 'opp'));
        if (k >= 20) samples.push(performance.now() - t0);
      }
      const st = stats(samples);
      recorder.time('apply.patch1', st, `${scale.rows} rows, watermarked`, P50);
      recorder.ratio('apply.patch1.opsPerSec', 1000 / st.p50, 'higher', 'at p50');
    }

    // (b) create — hits the full-array copy on every insert
    {
      const ledger = generateLedger(ctx.spec);
      const template = { ...(ledger.expenses as ScaleRow[])[0]! };
      const samples: number[] = [];
      for (let k = 0; k < iters.light + 20; k += 1) {
        const fresh = { ...template, id: `exp_new_${k}`, amount: 1234 + k };
        const delta: LedgerDelta = {
          v: 1,
          u: { expenses: [{ k: fresh.id, f: fresh, n: 1 }] },
        };
        const t0 = performance.now();
        applyLedgerDelta(ledger as never, delta, stamp(k, 'opc'));
        if (k >= 20) samples.push(performance.now() - t0);
      }
      const st = stats(samples);
      recorder.time('apply.create1', st, `${scale.rows} rows, growing`, P50);
      recorder.ratio('apply.create1.opsPerSec', 1000 / st.p50, 'higher', 'at p50');
    }

    // (c) bulk — one op touching 200 existing rows, spread across the table
    {
      const ledger = generateLedger(ctx.spec);
      const expenses = ledger.expenses as ScaleRow[];
      const bulk = Math.min(200, expenses.length);
      const samples: number[] = [];
      for (let k = 0; k < iters.medium + 5; k += 1) {
        const delta: LedgerDelta = {
          v: 1,
          u: {
            expenses: Array.from({ length: bulk }, (_, j) => ({
              k: String(expenses[Math.floor((j * expenses.length) / bulk)]!.id),
              f: { amount: 700 + k * 10 + j },
            })),
          },
        };
        const t0 = performance.now();
        applyLedgerDelta(ledger as never, delta, stamp(k, 'opb'));
        if (k >= 5) samples.push(performance.now() - t0);
      }
      const st = stats(samples);
      recorder.time('apply.bulk200', st, `${bulk} rows per op`, P50);
      recorder.ratio('apply.bulk200.rowsPerSec', (bulk * 1000) / st.p50, 'higher', 'at p50');
    }

    // (d) delete, one key at a time — the scan cursor's per-key table rebuild.
    // Each iteration removes a DIFFERENT row, so the ledger shrinks slightly
    // over the loop; noted rather than reset, because a reset would dominate.
    {
      const ledger = generateLedger(ctx.spec);
      const expenses = ledger.expenses as ScaleRow[];
      const budget = Math.min(iters.medium + 5, Math.floor(expenses.length / 4));
      const keys = Array.from({ length: budget }, (_, k) =>
        String(expenses[(k * 7919) % expenses.length]!.id),
      );
      const unique = [...new Set(keys)];
      const samples: number[] = [];
      for (let k = 0; k < unique.length; k += 1) {
        const delta: LedgerDelta = { v: 1, d: { expenses: [unique[k]!] } };
        const t0 = performance.now();
        applyLedgerDelta(ledger as never, delta, stamp(k, 'opd'));
        if (k >= 5) samples.push(performance.now() - t0);
      }
      const st = stats(samples);
      recorder.time('apply.delete1', st, `${unique.length} distinct rows deleted`, P50);
    }

    // (e) delete, 200 keys in ONE op — measured on the path the code takes
    {
      const ledger = generateLedger(ctx.spec);
      const expenses = ledger.expenses as ScaleRow[];
      const bulk = Math.min(200, Math.floor(expenses.length / 8));
      const rounds = Math.max(3, Math.min(iters.medium, Math.floor(expenses.length / (2 * bulk))));
      const probe = bulkDeleteDelta(ledger, 'expenses', bulk) as LedgerDelta;
      const strategy = planTableStrategy(probe, 'expenses');
      const samples: number[] = [];
      for (let k = 0; k < rounds + 2; k += 1) {
        const delta = bulkDeleteDelta(ledger, 'expenses', bulk, k * bulk) as LedgerDelta;
        const t0 = performance.now();
        applyLedgerDelta(ledger as never, delta, stamp(k, 'opD'));
        if (k >= 2) samples.push(performance.now() - t0);
      }
      const st = stats(samples);
      recorder.time(
        'apply.delete200',
        st,
        `${bulk} keys in one delta — planTableStrategy: ${strategy}`,
        P50,
      );
      recorder.ratio('apply.delete200.rowsPerSec', (bulk * 1000) / st.p50, 'higher', 'at p50');
    }

    // (f) the losing concurrent write — `wins()` false, conflict recorded
    {
      const ledger = generateLedger(ctx.spec);
      const expenses = ledger.expenses as ScaleRow[];
      const samples: number[] = [];
      for (let k = 0; k < iters.light + 20; k += 1) {
        const key = String(expenses[(k * 7919) % expenses.length]!.id);
        const delta: LedgerDelta = { v: 1, u: { expenses: [{ k: key, f: { amount: 1 + k } }] } };
        const t0 = performance.now();
        applyLedgerDelta(ledger as never, delta, losingStamp(k));
        if (k >= 20) samples.push(performance.now() - t0);
      }
      const st = stats(samples);
      recorder.time(
        'apply.concurrentLoss',
        st,
        'incoming stamp below the corpus watermark: BR-044 conflict path',
        P50,
      );
      recorder.count(
        'apply.concurrentLoss.conflictsTracked',
        (ledger.conflicts ?? []).length,
        'count',
        'flat',
        'bounded by MAX_TRACKED_CONFLICTS',
      );
    }

    // (g) the orphan patch — parked, and the park scans the whole lww map
    {
      const ledger = generateLedger(ctx.spec);
      const samples: number[] = [];
      for (let k = 0; k < iters.medium + 5; k += 1) {
        const delta: LedgerDelta = {
          v: 1,
          u: { expenses: [{ k: `exp_absent_${k}`, f: { amount: 5 + k } }] },
        };
        const t0 = performance.now();
        applyLedgerDelta(ledger as never, delta, stamp(k, 'opo'));
        if (k >= 5) samples.push(performance.now() - t0);
      }
      const st = stats(samples);
      recorder.time(
        'apply.orphanPark',
        st,
        'patch before create — parkOrphanPatch over a populated lww map',
        P50,
      );
    }

    recorder.end();
  });
});
