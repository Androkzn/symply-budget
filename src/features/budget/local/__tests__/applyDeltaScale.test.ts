/**
 * Stage 3 — `applyLedgerDelta` must be linear in delta size, and the indexed
 * cursor must produce byte-identical merge results to the scan cursor.
 *
 * A scale fix that changes merge results is worse than the slow code, so parity
 * is the acceptance criterion here and the timing assertion is only the
 * regression guard.
 */
import '../cryptoPolyfill';

import {
  LEDGER_INDEX_THRESHOLD,
  applyLedgerDelta,
  captureLedgerSnapshot,
  chunkRowsForOp,
  diffLedger,
  planTableStrategy,
  type LedgerDelta,
  type RowDelta,
} from '../projection';

import { emptyLedger, expenseRow, stampAt } from './ledgerTestKit';

describe('applyLedgerDelta scale', () => {
  it('applies 20,000 new rows in linear time and in delta order', () => {
    const ledger = emptyLedger();
    const rows: RowDelta[] = Array.from({ length: 20_000 }, (_, i) => ({
      k: `exp-${i}`,
      f: expenseRow(`exp-${i}`, { amount: i }),
      n: 1 as const,
    }));

    const started = Date.now();
    const result = applyLedgerDelta(ledger, { v: 1, u: { expenses: rows } }, stampAt(1));
    const elapsed = Date.now() - started;

    expect(result.applied).toBe(20_000);
    expect(ledger.expenses).toHaveLength(20_000);
    expect(ledger.expenses.map((e) => e.id).slice(0, 3)).toEqual(['exp-0', 'exp-1', 'exp-2']);
    expect(ledger.expenses[19_999]!.id).toBe('exp-19999');
    // Measured 18,776 ms before this change and 38 ms after, so 3,000 ms is a
    // ceiling the old implementation cannot come close to passing.
    expect(elapsed).toBeLessThan(3_000);
  }, 120_000);

  it('applies a mixed delete+upsert delta against a 20,000-row table', () => {
    const ledger = emptyLedger();
    ledger.expenses = Array.from({ length: 20_000 }, (_, i) =>
      expenseRow(`exp-${i}`, { amount: i }),
    ) as never;
    const tableBefore = ledger.expenses;

    const deletes = Array.from({ length: 200 }, (_, i) => `exp-${i * 10}`);
    const upserts: RowDelta[] = Array.from({ length: 200 }, (_, i) => ({
      k: `exp-${i * 10 + 1}`,
      f: { amount: 999_000 + i },
    }));

    const result = applyLedgerDelta(
      ledger,
      { v: 1, u: { expenses: upserts }, d: { expenses: deletes } },
      stampAt(500),
    );

    expect(result.deleted).toBe(200);
    expect(result.applied).toBe(200);
    expect(ledger.expenses).toHaveLength(19_800);
    expect(ledger.expenses.find((e) => e.id === 'exp-0')).toBeUndefined();
    expect(ledger.expenses.find((e) => e.id === 'exp-1')).toMatchObject({ amount: 999_000 });
    // Relative order of the survivors is untouched.
    expect(ledger.expenses[0]!.id).toBe('exp-1');
    expect(ledger.expenses[1]!.id).toBe('exp-2');
    // The table array is swapped exactly once, not once per row.
    expect(ledger.expenses).not.toBe(tableBefore);
  }, 120_000);
});

describe('planTableStrategy', () => {
  const rowsFor = (n: number): RowDelta[] =>
    Array.from({ length: n }, (_, i) => ({ k: `k-${i}`, f: {} }));

  it('scans below the threshold and indexes at it', () => {
    expect(
      planTableStrategy({ v: 1, u: { expenses: rowsFor(LEDGER_INDEX_THRESHOLD - 1) } }, 'expenses'),
    ).toBe('scan');
    expect(
      planTableStrategy({ v: 1, u: { expenses: rowsFor(LEDGER_INDEX_THRESHOLD) } }, 'expenses'),
    ).toBe('index');
  });

  it('counts upserts and deletes together', () => {
    const delta: LedgerDelta = {
      v: 1,
      u: { expenses: rowsFor(LEDGER_INDEX_THRESHOLD - 1) },
      d: { expenses: ['k-x'] },
    };
    expect(planTableStrategy(delta, 'expenses')).toBe('index');
  });

  it('decides per table, so a big expenses delta does not index a 1-row table', () => {
    const delta: LedgerDelta = {
      v: 1,
      u: { expenses: rowsFor(40), categories: rowsFor(1) },
    };
    expect(planTableStrategy(delta, 'expenses')).toBe('index');
    expect(planTableStrategy(delta, 'categories')).toBe('scan');
  });
});

describe('scan and index cursors merge identically', () => {
  /**
   * Runs one delta through both paths by padding the delta with rows for
   * absent keys — which is how the strategy input is driven — and comparing
   * everything the merge can observe.
   */
  function seed() {
    const ledger = emptyLedger();
    ledger.expenses = Array.from({ length: 60 }, (_, i) =>
      expenseRow(`exp-${i}`, { amount: i }),
    ) as never;
    // A row already tombstoned locally, so the upsert for it must be absorbed.
    applyLedgerDelta(ledger, { v: 1, d: { expenses: ['exp-59'] } }, stampAt(50));
    // A parked orphan patch, so replay is covered by the parity check too.
    applyLedgerDelta(
      ledger,
      { v: 1, u: { expenses: [{ k: 'exp-900', f: { amount: 900 } }] } },
      stampAt(60),
    );
    return ledger;
  }

  function mixedDelta(padding: number): LedgerDelta {
    const upserts: RowDelta[] = [
      { k: 'exp-1', f: { amount: 111, title: 'patched' } },
      { k: 'exp-2', f: { amount: 222 } },
      { k: 'exp-59', f: { amount: 5_900 } },
      { k: 'exp-900', f: expenseRow('exp-900', { amount: 0 }), n: 1 },
      { k: 'exp-901', f: expenseRow('exp-901', { amount: 901 }), n: 1 },
      { k: 'exp-902', f: { amount: 902 } },
    ];
    for (let i = 0; i < padding; i += 1) {
      upserts.push({ k: `pad-${i}`, f: expenseRow(`pad-${i}`, { amount: i }), n: 1 });
    }
    return { v: 1, u: { expenses: upserts }, d: { expenses: ['exp-3', 'exp-4', 'exp-3'] } };
  }

  it('produces the same rows, order, lww and conflicts either way', () => {
    // 0 padding → 9 touched rows → scan. 40 padding → 49 touched rows → index.
    const scanDelta = mixedDelta(0);
    const indexDelta = mixedDelta(40);
    expect(planTableStrategy(scanDelta, 'expenses')).toBe('scan');
    expect(planTableStrategy(indexDelta, 'expenses')).toBe('index');

    const viaScan = seed();
    const scanResult = applyLedgerDelta(viaScan, scanDelta, stampAt(700, 'member-peer', 'op-x'));
    const viaIndex = seed();
    const indexResult = applyLedgerDelta(viaIndex, indexDelta, stampAt(700, 'member-peer', 'op-x'));

    // Strip the padding the index run needed, then everything must match.
    const indexRows = viaIndex.expenses.filter((e) => !String(e.id).startsWith('pad-'));
    expect(indexRows).toEqual(viaScan.expenses);

    for (const key of Object.keys(viaIndex.lww!.expenses!)) {
      if (key.startsWith('pad-')) delete viaIndex.lww!.expenses![key];
    }
    expect(viaIndex.lww).toEqual(viaScan.lww);
    expect(viaIndex.conflicts).toEqual(viaScan.conflicts);
    expect(indexResult.conflicts).toEqual(scanResult.conflicts);
    expect(indexResult.deleted).toBe(scanResult.deleted);
    expect(indexResult.applied - 40).toBe(scanResult.applied);
  });
});

describe('changedFields fast paths', () => {
  function diffOne(mutate: (row: Record<string, unknown>) => void) {
    const ledger = emptyLedger();
    ledger.expenses = [expenseRow('exp-1')] as never;
    const snapshot = captureLedgerSnapshot(ledger);
    mutate(ledger.expenses[0] as unknown as Record<string, unknown>);
    return diffLedger(snapshot, ledger);
  }

  it('does not churn on NaN, ±Infinity or -0', () => {
    // JSON.stringify turns all of these into 'null' or '0', so the pre-image
    // never holds the live value — a naive `!==`/Object.is would report the
    // field changed on every single diff, forever.
    for (const value of [NaN, Infinity, -Infinity]) {
      const ledger = emptyLedger();
      ledger.expenses = [expenseRow('exp-1', { amount: value })] as never;
      const snapshot = captureLedgerSnapshot(ledger);
      expect(diffLedger(snapshot, ledger)).toBeNull();
      // Twice: a churn bug shows up on the second pass too.
      expect(diffLedger(captureLedgerSnapshot(ledger), ledger)).toBeNull();
    }

    const zero = emptyLedger();
    zero.expenses = [expenseRow('exp-1', { amount: 0 })] as never;
    const snapshot = captureLedgerSnapshot(zero);
    (zero.expenses[0] as unknown as { amount: number }).amount = -0;
    expect(diffLedger(snapshot, zero)).toBeNull();
  });

  it('does not re-emit a non-finite amount when a sibling field changes', () => {
    // Revert-proof drill 2026-08-13: naive `before === after` on numbers re-emits
    // amount:NaN here. The whole-row stringify pre-check hides that bug when
    // nothing else moved — this sibling edit forces the field walk.
    for (const value of [NaN, Infinity, -Infinity]) {
      const ledger = emptyLedger();
      ledger.expenses = [expenseRow('exp-1', { amount: value, title: 'A' })] as never;
      const snapshot = captureLedgerSnapshot(ledger);
      (ledger.expenses[0] as unknown as { title: string }).title = 'B';
      const delta = diffLedger(snapshot, ledger);
      expect(delta?.u?.expenses).toHaveLength(1);
      expect(delta!.u!.expenses![0]!.f).toEqual({ title: 'B' });
    }
  });

  it('matches the stringify comparator across every value shape', () => {
    const cases: Array<[string, unknown, unknown, boolean]> = [
      ['string→string', 'a', 'b', true],
      ['string unchanged', 'a', 'a', false],
      ['number→number', 1, 2, true],
      ['number unchanged', 1, 1, false],
      ['number→numeric string', 5, '5', true],
      ['bool→bool', true, false, true],
      ['bool unchanged', false, false, false],
      ['null→value', null, 3, true],
      ['null unchanged', null, null, false],
      ['value→null', 3, null, true],
      ['object unchanged', { a: 1 }, { a: 1 }, false],
      ['object changed', { a: 1 }, { a: 2 }, true],
      ['array unchanged', [1, 2], [1, 2], false],
      ['array changed', [1, 2], [1, 3], true],
      ['date unchanged', new Date(0), new Date(0), false],
      ['date changed', new Date(0), new Date(1), true],
      ['undefined unchanged', undefined, undefined, false],
      ['undefined→null', undefined, null, true],
    ];

    for (const [label, before, after, expected] of cases) {
      const ledger = emptyLedger();
      ledger.expenses = [expenseRow('exp-1', { probe: before })] as never;
      const snapshot = captureLedgerSnapshot(ledger);
      (ledger.expenses[0] as unknown as Record<string, unknown>).probe = after;
      const delta = diffLedger(snapshot, ledger);
      expect([label, delta !== null]).toEqual([label, expected]);
    }
  });

  it('normalizes a removed field to null', () => {
    const delta = diffOne((row) => {
      delete row.vendor;
    });
    expect(delta!.u!.expenses![0]!.f).toEqual({ vendor: null });
  });

  it('still reports exactly one changed field in a 5,000-row table', () => {
    const ledger = emptyLedger();
    ledger.expenses = Array.from({ length: 5_000 }, (_, i) => expenseRow(`exp-${i}`)) as never;
    const snapshot = captureLedgerSnapshot(ledger);
    (ledger.expenses[2_500] as unknown as { amount: number }).amount = 42;

    const delta = diffLedger(snapshot, ledger);
    expect(delta!.u!.expenses).toHaveLength(1);
    expect(delta!.u!.expenses![0]).toEqual({ k: 'exp-2500', f: { amount: 42 } });
  }, 60_000);
});

describe('chunkRowsForOp', () => {
  it('packs by bytes and by row count, and never drops a row', () => {
    const rows = Array.from({ length: 1_000 }, (_, i) => ({ id: `r-${i}`, blob: 'x'.repeat(200) }));
    const chunks = chunkRowsForOp(rows);
    expect(chunks.flat()).toHaveLength(1_000);
    expect(chunks.flat().map((r) => r.id)).toEqual(rows.map((r) => r.id));
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(250);
      expect(JSON.stringify(chunk).length).toBeLessThanOrEqual(64_000 + 300);
    }
  });

  it('gives an over-budget row its own chunk rather than dropping it', () => {
    const chunks = chunkRowsForOp([{ a: 'x'.repeat(100_000) }, { a: 'small' }]);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(1);
    expect(chunks[1]).toHaveLength(1);
  });

  it('returns no chunks for no rows', () => {
    expect(chunkRowsForOp([])).toEqual([]);
  });
});
