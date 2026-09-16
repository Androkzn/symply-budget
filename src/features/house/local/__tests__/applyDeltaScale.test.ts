/**
 * Apply-scale sanity for the House registry.
 *
 * The merge core's own scaling is already pinned by Budget's suites — this is
 * about House's shape: `maintenanceCompletions` is House's `expenses` (the
 * highest-cardinality table, 6,000–16,000 rows at 10 years) and `tasks` is the
 * widest row in the fleet at 58 columns. A quadratic apply or a diff that walks
 * every column of every row would show up here first.
 *
 * These are correctness-and-shape assertions with generous time bounds, not the
 * performance baseline. That is stage H10, on a quiet machine, with the numbers
 * published — nothing in H3 may claim a performance win from this file.
 */
import {
  applyLedgerDelta,
  captureLedgerSnapshot,
  diffLedger,
  LEDGER_INDEX_THRESHOLD,
  planTableStrategy,
  type LedgerDelta,
} from '../projection';

import { completionRow, emptyHouseLedger, stampAt, taskRow } from './houseLedgerTestKit';

const BULK = 20_000;

describe('applyLedgerDelta at House cardinality', () => {
  it('applies 20,000 completions in one pass and preserves delta order', () => {
    const ledger = emptyHouseLedger();
    const delta: LedgerDelta = {
      v: 1,
      u: {
        maintenanceCompletions: Array.from({ length: BULK }, (_, i) => ({
          k: `c${i}`,
          f: completionRow(`c${i}`),
          n: 1 as const,
        })),
      },
    };

    const started = Date.now();
    const result = applyLedgerDelta(ledger, delta, stampAt(1));
    const elapsed = Date.now() - started;

    expect(result.applied).toBe(BULK);
    expect(ledger.maintenanceCompletions).toHaveLength(BULK);
    expect(ledger.maintenanceCompletions[0]!.id).toBe('c0');
    expect(ledger.maintenanceCompletions[BULK - 1]!.id).toBe(`c${BULK - 1}`);
    // A quadratic apply on 20k rows takes minutes, not a couple of seconds.
    expect(elapsed).toBeLessThan(10_000);
  });

  it('applies a mixed delete+upsert delta against a 20,000-row table', () => {
    const ledger = emptyHouseLedger();
    ledger.maintenanceCompletions = Array.from(
      { length: BULK },
      (_, i) => completionRow(`c${i}`) as never,
    );

    const result = applyLedgerDelta(
      ledger,
      {
        v: 1,
        d: { maintenanceCompletions: Array.from({ length: 100 }, (_, i) => `c${i}`) },
        u: {
          maintenanceCompletions: Array.from({ length: 100 }, (_, i) => ({
            k: `c${1000 + i}`,
            f: { notes: 'touched' },
          })),
        },
      },
      stampAt(2),
    );

    expect(result.deleted).toBe(100);
    expect(result.applied).toBe(100);
    expect(ledger.maintenanceCompletions).toHaveLength(BULK - 100);
    expect(ledger.maintenanceCompletions.find((r) => r.id === 'c1000')?.notes).toBe('touched');
  });

  it('decides the cursor strategy per table, not per delta', () => {
    const delta: LedgerDelta = {
      v: 1,
      u: {
        maintenanceCompletions: Array.from({ length: LEDGER_INDEX_THRESHOLD + 5 }, (_, i) => ({
          k: `c${i}`,
          f: { notes: 'x' },
        })),
        tasks: [{ k: 't1', f: { title: 'x' } }],
      },
    };
    expect(planTableStrategy(delta, 'maintenanceCompletions')).toBe('index');
    expect(planTableStrategy(delta, 'tasks')).toBe('scan');
  });
});

describe('diffLedger on the widest House row', () => {
  it('reports exactly one changed field in a 5,000-task ledger', () => {
    const ledger = emptyHouseLedger();
    ledger.tasks = Array.from({ length: 5_000 }, (_, i) => taskRow(`t${i}`) as never);
    const before = captureLedgerSnapshot(ledger);

    ledger.tasks[2_500]!.title = 'Only this moved';
    const delta = diffLedger(before, ledger);

    expect(delta?.u?.tasks).toHaveLength(1);
    expect(delta?.u?.tasks?.[0]).toEqual({ k: 't2500', f: { title: 'Only this moved' } });
    expect(delta?.d).toBeUndefined();
  });

  it('emits nothing at all when a large ledger is untouched', () => {
    const ledger = emptyHouseLedger();
    ledger.tasks = Array.from({ length: 5_000 }, (_, i) => taskRow(`t${i}`) as never);
    ledger.maintenanceCompletions = Array.from(
      { length: 5_000 },
      (_, i) => completionRow(`c${i}`) as never,
    );
    expect(diffLedger(captureLedgerSnapshot(ledger), ledger)).toBeNull();
  });
});
