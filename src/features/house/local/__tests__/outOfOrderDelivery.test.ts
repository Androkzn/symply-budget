/**
 * Out-of-order delivery — a patch that arrives before its create.
 *
 * The relay is per-recipient and unordered enough that this is routine, not
 * exotic: a member edits a task on a flaky connection, the edit lands, the
 * create is still in a retry queue. Dropping the patch (what the pre-parking
 * behaviour did) loses the peer's edit permanently and silently, because the op
 * is marked applied and never reconsidered.
 *
 * House inherits parking from the shared core; these assert it under the House
 * registry, including the House-specific "parked patch on a wide `tasks` row".
 */
import { applyLedgerDelta, MAX_PARKED_ROWS, drainParkedRows } from '../projection';

import { emptyHouseLedger, stampAt, taskRow } from './houseLedgerTestKit';

describe('parked orphan patches', () => {
  it('holds a patch whose create has not arrived, then replays it in order', () => {
    const ledger = emptyHouseLedger();

    // Patch first — no row, no tombstone.
    applyLedgerDelta(
      ledger,
      { v: 1, u: { tasks: [{ k: 't1', f: { title: 'Edited before create' } }] } },
      stampAt(20),
    );
    expect(ledger.tasks).toHaveLength(0);
    expect(ledger.lww?.tasks?.t1?.p).toBeDefined();

    // The create lands with an older stamp; the parked field still wins.
    applyLedgerDelta(
      ledger,
      { v: 1, u: { tasks: [{ k: 't1', f: taskRow('t1'), n: 1 }] } },
      stampAt(10, 'member-other'),
    );

    expect(ledger.tasks).toHaveLength(1);
    expect(ledger.tasks[0]!.title).toBe('Edited before create');
    expect(ledger.lww?.tasks?.t1?.p).toBeUndefined();
  });

  it('lets a newer create beat an older parked patch and surfaces the loss', () => {
    const ledger = emptyHouseLedger();
    applyLedgerDelta(
      ledger,
      { v: 1, u: { tasks: [{ k: 't1', f: { title: 'Stale parked' } }] } },
      stampAt(5),
    );
    applyLedgerDelta(
      ledger,
      { v: 1, u: { tasks: [{ k: 't1', f: taskRow('t1', { title: 'Fresh create' }), n: 1 }] } },
      stampAt(50, 'member-other'),
    );

    expect(ledger.tasks[0]!.title).toBe('Fresh create');
    expect(ledger.conflicts!.some((c) => c.field === 'title' && c.kind === 'field_lww')).toBe(true);
  });

  it('lets a tombstone absorb a parked patch and reports the discarded edit', () => {
    const ledger = emptyHouseLedger();
    // The parked patch is NEWER than the tombstone, so it is a real loss the
    // member has to be told about. (An older parked patch would have lost the
    // LWW race anyway, and the core deliberately reports no conflict for it.)
    applyLedgerDelta(
      ledger,
      { v: 1, u: { tasks: [{ k: 't1', f: { title: 'Never lands' } }] } },
      stampAt(80),
    );
    applyLedgerDelta(ledger, { v: 1, d: { tasks: ['t1'] } }, stampAt(70, 'member-other'));

    expect(ledger.lww?.tasks?.t1?.p).toBeUndefined();
    expect(ledger.lww?.tasks?.t1?.del).toBeDefined();
    expect(ledger.conflicts!.some((c) => c.kind === 'edit_vs_delete')).toBe(true);

    // And the create, if it ever shows up, stays dead.
    applyLedgerDelta(
      ledger,
      { v: 1, u: { tasks: [{ k: 't1', f: taskRow('t1'), n: 1 }] } },
      stampAt(80, 'member-other'),
    );
    expect(ledger.tasks).toHaveLength(0);
  });

  it('drains a parked patch for a row that materialized outside a delta', () => {
    const ledger = emptyHouseLedger();
    applyLedgerDelta(
      ledger,
      { v: 1, u: { tasks: [{ k: 't1', f: { title: 'Parked' } }] } },
      stampAt(90),
    );
    ledger.tasks.push(taskRow('t1') as never);

    const result = drainParkedRows(ledger);
    expect(result.applied).toBe(1);
    expect(ledger.tasks[0]!.title).toBe('Parked');
  });

  it('bounds parked rows so an orphan storm cannot grow without limit', () => {
    const ledger = emptyHouseLedger();
    for (let i = 0; i < MAX_PARKED_ROWS + 50; i += 1) {
      applyLedgerDelta(
        ledger,
        { v: 1, u: { tasks: [{ k: `t${i}`, f: { title: `edit ${i}` } }] } },
        stampAt(i + 1, 'member-peer', `op-${i}`),
      );
    }
    const parked = Object.values(ledger.lww?.tasks ?? {}).filter((meta) => meta.p).length;
    expect(parked).toBeLessThanOrEqual(MAX_PARKED_ROWS);
    expect(parked).toBeGreaterThan(0);
  });
});
