/**
 * Bulk-write discipline (plan §3.3, "non-negotiable rule for every call site").
 *
 * House's bulk paths — space seeding, plan/report generation, default
 * checklists, seasonal generation, report→task-draft conversion — all run at
 * onboarding while the user is watching, and they are larger than Budget's.
 * Looping single writes is quadratic: `mutateLocalHouseLedger` captures and
 * diffs the WHOLE ledger per call. The rule is one op per chunk.
 */
import {
  applyLedgerDelta,
  captureLedgerSnapshot,
  chunkLedgerDelta,
  chunkRowsForOp,
  diffLedger,
  LEDGER_INDEX_THRESHOLD,
  MAX_OP_DELTA_BYTES,
  MAX_OP_DELTA_ROWS,
  planTableStrategy,
  type LedgerDelta,
} from '../projection';

import { emptyHouseLedger, stampAt, taskRow } from './houseLedgerTestKit';

describe('chunkRowsForOp', () => {
  it('caps a chunk by row count', () => {
    const rows = Array.from({ length: MAX_OP_DELTA_ROWS * 2 + 1 }, (_, i) => ({ i }));
    const chunks = chunkRowsForOp(rows);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(MAX_OP_DELTA_ROWS);
    expect(chunks.flat()).toHaveLength(rows.length);
  });

  it('caps a chunk by byte budget', () => {
    const fat = { blob: 'x'.repeat(MAX_OP_DELTA_BYTES / 4) };
    const chunks = chunkRowsForOp(Array.from({ length: 10 }, () => fat));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(JSON.stringify(chunk).length).toBeLessThanOrEqual(MAX_OP_DELTA_BYTES * 1.5);
    }
  });

  it('never drops a row larger than the whole budget', () => {
    const huge = { blob: 'x'.repeat(MAX_OP_DELTA_BYTES * 2) };
    const chunks = chunkRowsForOp([huge]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(1);
  });
});

describe('chunkLedgerDelta', () => {
  it('splits a wide seed into ops that each fit the mailbox budget', () => {
    const ledger = emptyHouseLedger();
    const before = captureLedgerSnapshot(ledger);
    for (let i = 0; i < 600; i += 1) {
      ledger.tasks.push(taskRow(`t${i}`) as never);
    }
    const delta = diffLedger(before, ledger)!;
    const chunks = chunkLedgerDelta(delta);

    expect(chunks.length).toBeGreaterThan(1);
    const keys = chunks.flatMap((chunk) => chunk.u?.tasks?.map((row) => row.k) ?? []);
    expect(new Set(keys).size).toBe(600);
    for (const chunk of chunks) {
      expect(chunk.u?.tasks?.length ?? 0).toBeLessThanOrEqual(MAX_OP_DELTA_ROWS);
    }
  });

  it('replays chunk-by-chunk to the same ledger the single delta would produce', () => {
    const source = emptyHouseLedger();
    const before = captureLedgerSnapshot(source);
    for (let i = 0; i < 300; i += 1) source.tasks.push(taskRow(`t${i}`) as never);
    const delta = diffLedger(before, source)!;

    const whole = emptyHouseLedger();
    applyLedgerDelta(whole, delta, stampAt(10));

    const chunked = emptyHouseLedger();
    chunkLedgerDelta(delta).forEach((chunk, index) => {
      applyLedgerDelta(chunked, chunk, stampAt(10, 'member-peer', `op-chunk-${index}`));
    });

    expect(chunked.tasks.map((t) => t.id).sort()).toEqual(whole.tasks.map((t) => t.id).sort());
  });
});

describe('cursor strategy', () => {
  it('scans a small delta and indexes a bulk one', () => {
    const small: LedgerDelta = { v: 1, u: { tasks: [{ k: 't1', f: { title: 'a' } }] } };
    expect(planTableStrategy(small, 'tasks')).toBe('scan');

    const bulk: LedgerDelta = {
      v: 1,
      u: {
        tasks: Array.from({ length: LEDGER_INDEX_THRESHOLD }, (_, i) => ({
          k: `t${i}`,
          f: { title: 'a' },
        })),
      },
    };
    expect(planTableStrategy(bulk, 'tasks')).toBe('index');
    expect(planTableStrategy(bulk, 'appliances')).toBe('scan');
  });

  it('produces identical results either side of the threshold', () => {
    const seed = () => {
      const ledger = emptyHouseLedger();
      for (let i = 0; i < 40; i += 1) ledger.tasks.push(taskRow(`t${i}`) as never);
      return ledger;
    };

    const scanned = seed();
    const indexed = seed();
    const keys = Array.from({ length: LEDGER_INDEX_THRESHOLD + 4 }, (_, i) => `t${i}`);

    for (const key of keys) {
      applyLedgerDelta(
        scanned,
        { v: 1, u: { tasks: [{ k: key, f: { title: `merged ${key}` } }] } },
        stampAt(100, 'member-peer', `op-${key}`),
      );
    }
    applyLedgerDelta(
      indexed,
      { v: 1, u: { tasks: keys.map((key) => ({ k: key, f: { title: `merged ${key}` } })) } },
      stampAt(100, 'member-peer', 'op-bulk'),
    );

    expect(indexed.tasks.map((t) => [t.id, t.title])).toEqual(
      scanned.tasks.map((t) => [t.id, t.title]),
    );
  });

  it('applies deletes before upserts so a bulk replace cannot resurrect a row', () => {
    const ledger = emptyHouseLedger();
    for (let i = 0; i < LEDGER_INDEX_THRESHOLD + 2; i += 1) {
      ledger.tasks.push(taskRow(`t${i}`) as never);
    }
    applyLedgerDelta(
      ledger,
      {
        v: 1,
        d: { tasks: ['t0'] },
        u: { tasks: [{ k: 't0', f: taskRow('t0', { title: 'recreated' }), n: 1 }] },
      },
      stampAt(200),
    );
    expect(ledger.tasks.some((t) => t.id === 't0')).toBe(false);
  });
});
