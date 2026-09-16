/**
 * The House merge contract (TRD §8.4 / BR-044), asserted against the House
 * registry rather than assumed from Budget's green suites.
 *
 * The engine is shared code, so these do not re-litigate *how* LWW works — they
 * prove the House descriptor drives it correctly: the right key field, the
 * right buckets, and the right tables.
 */
import {
  ALWAYS_RESIDENT_BUCKET,
  applyLedgerDelta,
  captureLedgerSnapshot,
  collectRowWrites,
  decodeLedgerOpPayload,
  diffLedger,
  encodeLedgerOpPayload,
  rowBucket,
  type LedgerDelta,
} from '../projection';

import { completionRow, emptyHouseLedger, stampAt, taskRow } from './houseLedgerTestKit';

describe('rowBucket — House windowing policy', () => {
  it('windows tasks on next_due_date first', () => {
    expect(rowBucket('tasks', taskRow('t1', { next_due_date: '2026-09-14' }))).toBe('2026-09');
  });

  it('falls through the candidate list in order', () => {
    const row = taskRow('t1', {
      next_due_date: null,
      scheduled_work_date: '2027-03-02',
    });
    expect(rowBucket('tasks', row)).toBe('2027-03');
  });

  it('falls back to created_at so an undated task still lands in a real bucket', () => {
    // `created_at` is deliberately last in the tasks candidate list: a task with
    // no due date and no scheduled date is still a real row a member can find,
    // and bucketing it by creation month keeps the windowed read useful instead
    // of pushing every such task into the always-resident set.
    expect(rowBucket('tasks', taskRow('t1', { next_due_date: 'someday' }))).toBe('2026-08');
    expect(
      rowBucket('tasks', taskRow('t1', { next_due_date: null, scheduled_work_date: null })),
    ).toBe('2026-08');
  });

  it('degrades to always-resident when no candidate field parses, never invisible', () => {
    expect(
      rowBucket(
        'tasks',
        taskRow('t1', { next_due_date: null, scheduled_work_date: null, created_at: 'nope' }),
      ),
    ).toBe(ALWAYS_RESIDENT_BUCKET);
    expect(rowBucket('maintenanceCompletions', completionRow('c1', { completed_at: null }))).toBe(
      ALWAYS_RESIDENT_BUCKET,
    );
    expect(rowBucket('tasks', null)).toBe(ALWAYS_RESIDENT_BUCKET);
  });

  it('rejects an out-of-range month rather than minting a bogus bucket', () => {
    expect(rowBucket('maintenanceCompletions', completionRow('c1', { completed_at: '2026-13-01' })))
      .toBe(ALWAYS_RESIDENT_BUCKET);
  });

  it('leaves the 13 always-resident Wave A tables always-resident', () => {
    expect(rowBucket('householdSpaces', { id: 's1', created_at: '2026-08-01' })).toBe(
      ALWAYS_RESIDENT_BUCKET,
    );
    expect(rowBucket('settings', { id: 'set1', updated_at: '2026-08-01' })).toBe(
      ALWAYS_RESIDENT_BUCKET,
    );
  });
});

describe('diffLedger — delta state, not intent replay', () => {
  it('emits a create as n:1 with the whole row', () => {
    const ledger = emptyHouseLedger();
    const before = captureLedgerSnapshot(ledger);
    ledger.tasks.push(taskRow('t1') as never);
    const delta = diffLedger(before, ledger);
    expect(delta?.u?.tasks?.[0]).toMatchObject({ k: 't1', n: 1 });
    expect(delta?.u?.tasks?.[0]?.f.title).toBe('Task t1');
  });

  it('emits an edit as only the fields that moved', () => {
    const ledger = emptyHouseLedger();
    ledger.tasks.push(taskRow('t1') as never);
    const before = captureLedgerSnapshot(ledger);
    ledger.tasks[0]!.title = 'Replace furnace filter';
    const delta = diffLedger(before, ledger);
    expect(delta?.u?.tasks?.[0]?.f).toEqual({ title: 'Replace furnace filter' });
    expect(delta?.u?.tasks?.[0]?.n).toBeUndefined();
  });

  it('emits a delete as a tombstone key', () => {
    const ledger = emptyHouseLedger();
    ledger.tasks.push(taskRow('t1') as never);
    const before = captureLedgerSnapshot(ledger);
    ledger.tasks = [];
    expect(diffLedger(before, ledger)?.d?.tasks).toEqual(['t1']);
  });

  it('returns null when nothing moved', () => {
    const ledger = emptyHouseLedger();
    ledger.tasks.push(taskRow('t1') as never);
    expect(diffLedger(captureLedgerSnapshot(ledger), ledger)).toBeNull();
  });

  it('normalizes a removed field to null so peers converge on the absence', () => {
    const ledger = emptyHouseLedger();
    ledger.tasks.push(taskRow('t1', { description: 'old' }) as never);
    const before = captureLedgerSnapshot(ledger);
    delete (ledger.tasks[0] as unknown as Record<string, unknown>).description;
    expect(diffLedger(before, ledger)?.u?.tasks?.[0]?.f).toEqual({ description: null });
  });

  it('does not churn a non-finite number forever (NaN guard)', () => {
    // JSON.stringify writes NaN/±Infinity as `null`, so a naive `===` against
    // the parsed pre-image would report the field changed on EVERY diff.
    const ledger = emptyHouseLedger();
    ledger.tasks.push(taskRow('t1', { priority_score: Number.NaN }) as never);
    const before = captureLedgerSnapshot(ledger);
    expect(diffLedger(before, ledger)).toBeNull();

    ledger.tasks[0]!.title = 'nudge';
    const delta = diffLedger(before, ledger);
    expect(Object.keys(delta?.u?.tasks?.[0]?.f ?? {})).toEqual(['title']);
  });
});

describe('applyLedgerDelta — merge rules on House tables', () => {
  it('merges two members editing different fields of one task', () => {
    const ledger = emptyHouseLedger();
    ledger.tasks.push(taskRow('t1') as never);

    applyLedgerDelta(ledger, { v: 1, u: { tasks: [{ k: 't1', f: { title: 'Peer title' } }] } }, stampAt(10));
    applyLedgerDelta(
      ledger,
      { v: 1, u: { tasks: [{ k: 't1', f: { description: 'Peer note' } }] } },
      stampAt(11, 'member-other'),
    );

    expect(ledger.tasks[0]!.title).toBe('Peer title');
    expect(ledger.tasks[0]!.description).toBe('Peer note');
    expect(ledger.conflicts).toHaveLength(0);
  });

  it('resolves a same-field conflict by HLC and surfaces the loser (BR-044)', () => {
    const ledger = emptyHouseLedger();
    ledger.tasks.push(taskRow('t1') as never);

    applyLedgerDelta(ledger, { v: 1, u: { tasks: [{ k: 't1', f: { title: 'Newer' } }] } }, stampAt(20));
    applyLedgerDelta(ledger, { v: 1, u: { tasks: [{ k: 't1', f: { title: 'Older' } }] } }, stampAt(5));

    expect(ledger.tasks[0]!.title).toBe('Newer');
    expect(ledger.conflicts).toHaveLength(1);
    expect(ledger.conflicts![0]).toMatchObject({
      table: 'tasks',
      rowKey: 't1',
      field: 'title',
      kind: 'field_lww',
    });
  });

  it('lets the tombstone absorb a later edit and records the discarded intent', () => {
    const ledger = emptyHouseLedger();
    ledger.tasks.push(taskRow('t1') as never);

    applyLedgerDelta(ledger, { v: 1, d: { tasks: ['t1'] } }, stampAt(30));
    expect(ledger.tasks).toHaveLength(0);

    applyLedgerDelta(
      ledger,
      { v: 1, u: { tasks: [{ k: 't1', f: { title: 'Resurrect me' } }] } },
      stampAt(40),
    );
    expect(ledger.tasks).toHaveLength(0);
    expect(ledger.conflicts!.some((c) => c.kind === 'edit_vs_delete')).toBe(true);
  });

  it('is idempotent — re-applying the same op changes nothing', () => {
    const ledger = emptyHouseLedger();
    const delta: LedgerDelta = {
      v: 1,
      u: { maintenanceCompletions: [{ k: 'c1', f: completionRow('c1'), n: 1 }] },
    };
    const first = applyLedgerDelta(ledger, delta, stampAt(50));
    const second = applyLedgerDelta(ledger, delta, stampAt(50));
    expect(first.applied).toBe(1);
    expect(second.applied).toBe(0);
    expect(ledger.maintenanceCompletions).toHaveLength(1);
  });

  it('ignores a table that is not in the House registry', () => {
    const ledger = emptyHouseLedger();
    const result = applyLedgerDelta(
      ledger,
      { v: 1, u: { expenses: [{ k: 'e1', f: { id: 'e1' }, n: 1 }] } } as unknown as LedgerDelta,
      stampAt(60),
    );
    expect(result.applied).toBe(0);
  });
});

describe('collectRowWrites — what persist writes', () => {
  it('writes only the keys a delta touched, with the right buckets', () => {
    const ledger = emptyHouseLedger();
    ledger.tasks = [
      taskRow('keep') as never,
      taskRow('edit', { next_due_date: '2026-10-05' }) as never,
    ];
    const writes = collectRowWrites(ledger, {
      v: 1,
      u: { tasks: [{ k: 'edit', f: { title: 'x' } }] },
      d: { tasks: ['gone'] },
    });
    expect(writes.map((w) => w.rowKey).sort()).toEqual(['edit', 'gone']);
    expect(writes.find((w) => w.rowKey === 'edit')?.bucket).toBe('2026-10');
    // Every tombstone is always-resident so a peer can never miss a delete.
    expect(writes.find((w) => w.rowKey === 'gone')?.bucket).toBe(ALWAYS_RESIDENT_BUCKET);
    expect(writes.find((w) => w.rowKey === 'gone')?.deleted).toBe(true);
  });
});

describe('op payload envelope', () => {
  it('round-trips a delta and drops a payload that carries none', () => {
    const delta: LedgerDelta = { v: 1, u: { tasks: [{ k: 't1', f: { title: 'x' } }] } };
    expect(decodeLedgerOpPayload(encodeLedgerOpPayload({ op: 'TASK_UPDATE' }, delta))).toEqual(delta);
    expect(decodeLedgerOpPayload(encodeLedgerOpPayload({ op: 'TASK_UPDATE' }, null))).toBeNull();
  });
});
