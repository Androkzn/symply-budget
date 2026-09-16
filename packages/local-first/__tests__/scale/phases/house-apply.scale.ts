/**
 * House H10 — `applyLedgerDelta` throughput on the House registry.
 *
 * The merge core is shared with Budget, so this phase is NOT re-proving the
 * CRDT. It answers a different question: what does the merge cost at HOUSE
 * cardinality and HOUSE row width? `maintenanceCompletions` at 5,500 rows
 * (5y/2a) is the table peers actually push, and `tasks` is where a 41-field row
 * makes each merged patch walk a longer field loop.
 *
 * Shapes measured, and why each is structurally different:
 *   PATCH  1 row  — the scan cursor's linear `find`
 *   CREATE 1 row  — full array copy on insert
 *   BULK   200    — what a seasonal generation / report→draft conversion emits
 *   DELETE 1 row  — the scan cursor rebuilds the whole table array for one key
 *   DELETE 200    — MEASURED, not multiplied: `planTableStrategy` routes any
 *                   delta touching >= LEDGER_INDEX_THRESHOLD (16) rows to the
 *                   indexed cursor, which is one slice, one Map and one filter
 *   WIDE PATCH    — the same patch against `tasks`, the 41-field row
 *   CONCURRENT    — a LOSING stamp on a row that already carries a watermark:
 *                   the `wins()` / `recordConflict` branch that BR-044 depends on
 *   ORPHAN        — a patch whose create has not arrived: `parkOrphanPatch` plus
 *                   the parked-row scan over the ENTIRE watermark map
 *
 * Times are graded at p50, not min: every sample walks a different prefix of a
 * linear scan, so min reports the luckiest one and is scale-invariant noise.
 */
import { performance } from 'node:perf_hooks';

import { describe, it } from 'vitest';

import {
  applyLedgerDelta,
  planTableStrategy,
  type LedgerDelta,
} from '../../../../../src/features/house/local/projection';
import {
  bulkDeleteDelta,
  generateHouseLedger,
  type ScaleRow,
} from '../lib/house-ledger-factory';
import { startHousePhase } from '../lib/house-phase';
import { stats } from '../lib/measure';
import { hlcAt } from '../lib/oplog-factory';

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
  opId: `lose_${k}`,
});

describe('house scale: applyLedgerDelta throughput', () => {
  it('measures', () => {
    const ctx = startHousePhase('apply');
    const { recorder, scale, iters } = ctx;

    // ---- patch 1 row ----------------------------------------------------
    {
      const ledger = generateHouseLedger(ctx.spec);
      const rows = ledger.maintenanceCompletions as ScaleRow[];
      const samples: number[] = [];
      for (let k = 0; k < iters.light; k += 1) {
        const key = String(rows[(k * 7919) % rows.length]!.id);
        const delta: LedgerDelta = {
          v: 1,
          u: { maintenanceCompletions: [{ k: key, f: { notes: `merged ${k}` } }] },
        };
        const t0 = performance.now();
        applyLedgerDelta(ledger as never, delta, stamp(k, 'patch'));
        samples.push(performance.now() - t0);
      }
      const st = stats(samples);
      recorder.time('apply.patch1', st, `${scale.rows} rows, watermarked`, P50);
      recorder.ratio('apply.patch1.opsPerSec', 1000 / Math.max(st.p50, 1e-9), 'higher', 'at p50');
    }

    // ---- patch 1 WIDE row (tasks) ---------------------------------------
    {
      const ledger = generateHouseLedger(ctx.spec);
      const rows = ledger.tasks as ScaleRow[];
      const samples: number[] = [];
      for (let k = 0; k < iters.light; k += 1) {
        const key = String(rows[(k * 7919) % rows.length]!.id);
        const delta: LedgerDelta = {
          v: 1,
          u: { tasks: [{ k: key, f: { title: `merged ${k}` } }] },
        };
        const t0 = performance.now();
        applyLedgerDelta(ledger as never, delta, stamp(k, 'wide'));
        samples.push(performance.now() - t0);
      }
      const st = stats(samples);
      recorder.time('apply.patch1.wideRow', st, `${rows.length} tasks, ~41 fields each`, P50);
      recorder.ratio('apply.patch1.wideRow.opsPerSec', 1000 / Math.max(st.p50, 1e-9), 'higher', 'at p50');
    }

    // ---- create 1 row ---------------------------------------------------
    {
      const ledger = generateHouseLedger(ctx.spec);
      const template = { ...(ledger.maintenanceCompletions as ScaleRow[])[0]! };
      const samples: number[] = [];
      for (let k = 0; k < iters.light; k += 1) {
        const fresh = { ...template, id: `mcp_new_${k}`, notes: `created ${k}` };
        const delta: LedgerDelta = {
          v: 1,
          u: { maintenanceCompletions: [{ k: String(fresh.id), f: fresh, n: 1 }] },
        };
        const t0 = performance.now();
        applyLedgerDelta(ledger as never, delta, stamp(k, 'create'));
        samples.push(performance.now() - t0);
      }
      const st = stats(samples);
      recorder.time('apply.create1', st, `${scale.rows} rows, growing`, P50);
      recorder.ratio('apply.create1.opsPerSec', 1000 / Math.max(st.p50, 1e-9), 'higher', 'at p50');
    }

    // ---- bulk 200 -------------------------------------------------------
    {
      const ledger = generateHouseLedger(ctx.spec);
      const rows = ledger.maintenanceCompletions as ScaleRow[];
      const bulk = Math.min(200, rows.length);
      const samples: number[] = [];
      for (let k = 0; k < iters.medium; k += 1) {
        const delta: LedgerDelta = {
          v: 1,
          u: {
            maintenanceCompletions: Array.from({ length: bulk }, (_, j) => ({
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
      recorder.time('apply.bulk200', st, `${bulk} rows per op`, P50);
      recorder.ratio('apply.bulk200.rowsPerSec', (bulk * 1000) / Math.max(st.p50, 1e-9), 'higher', 'at p50');
    }

    // ---- delete 1 -------------------------------------------------------
    {
      const ledger = generateHouseLedger(ctx.spec);
      const rows = ledger.maintenanceCompletions as ScaleRow[];
      const budget = Math.min(iters.medium + 5, Math.floor(rows.length / 4));
      const keys = Array.from({ length: budget }, (_, k) =>
        String(rows[(k * 7919) % rows.length]!.id),
      );
      const unique = [...new Set(keys)];
      const samples: number[] = [];
      for (let k = 0; k < unique.length; k += 1) {
        const delta: LedgerDelta = { v: 1, d: { maintenanceCompletions: [unique[k]!] } };
        const t0 = performance.now();
        applyLedgerDelta(ledger as never, delta, stamp(k, 'del1'));
        samples.push(performance.now() - t0);
      }
      const st = stats(samples);
      recorder.time('apply.delete1', st, `${unique.length} distinct rows deleted`, P50);
    }

    // ---- delete 200, measured ------------------------------------------
    {
      const ledger = generateHouseLedger(ctx.spec);
      const samples: number[] = [];
      for (let k = 0; k < Math.max(3, iters.heavy + 3); k += 1) {
        const delta = bulkDeleteDelta(ledger, 'maintenanceCompletions', 200, k * 200);
        const t0 = performance.now();
        applyLedgerDelta(ledger as never, delta as never, stamp(1000 + k, 'del200'));
        samples.push(performance.now() - t0);
      }
      const st = stats(samples);
      recorder.time('apply.delete200', st, 'indexed cursor: one slice, one Map, one filter', P50);
      recorder.count(
        'apply.delete200.strategyIsIndex',
        planTableStrategy(
          bulkDeleteDelta(generateHouseLedger(ctx.spec), 'maintenanceCompletions', 200) as never,
          'maintenanceCompletions',
        ) === 'index'
          ? 1
          : 0,
        'count',
        'flat',
        '1 = routed to createIndexedCursor as intended',
      );
    }

    // ---- concurrent losing write (BR-044) -------------------------------
    {
      const ledger = generateHouseLedger(ctx.spec);
      const rows = ledger.maintenanceCompletions as ScaleRow[];
      const samples: number[] = [];
      for (let k = 0; k < iters.light; k += 1) {
        const key = String(rows[(k * 7919) % rows.length]!.id);
        const delta: LedgerDelta = {
          v: 1,
          u: { maintenanceCompletions: [{ k: key, f: { notes: `stale ${k}` } }] },
        };
        const t0 = performance.now();
        applyLedgerDelta(ledger as never, delta, losingStamp(k));
        samples.push(performance.now() - t0);
      }
      const st = stats(samples);
      recorder.time('apply.concurrentLoser', st, 'wins() loses; conflict recorded', P50);
      recorder.count(
        'apply.concurrentLoser.conflicts',
        (ledger.conflicts ?? []).length,
        'count',
        'flat',
        'bounded by MAX_TRACKED_CONFLICTS',
      );
    }

    // ---- orphan park ----------------------------------------------------
    {
      const ledger = generateHouseLedger(ctx.spec);
      const samples: number[] = [];
      for (let k = 0; k < iters.medium; k += 1) {
        const delta: LedgerDelta = {
          v: 1,
          u: { maintenanceCompletions: [{ k: `mcp_absent_${k}`, f: { notes: `orphan ${k}` } }] },
        };
        const t0 = performance.now();
        applyLedgerDelta(ledger as never, delta, stamp(k, 'orphan'));
        samples.push(performance.now() - t0);
      }
      recorder.time(
        'apply.orphanPark',
        stats(samples),
        'parkOrphanPatch + parkedRowCount scan over the whole watermark map',
        P50,
      );
    }

    recorder.end();
  });
});
