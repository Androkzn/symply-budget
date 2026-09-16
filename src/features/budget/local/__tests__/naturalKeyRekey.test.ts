/**
 * Delete-then-recreate must reach the peer (BUDGET-MM / audit defect B6).
 *
 * `savingsMonthlyTargets` was keyed by `period` and `wishAttachments` by `key`.
 * Both have live delete-then-recreate paths: clearing a month's savings target
 * DELETES its row (localSavingsProjector.applyProjectionTargets), and setting the
 * target again re-creates the SAME natural key. A delete records an ABSORBING
 * tombstone under that key, so every peer rejected the re-create forever while
 * the authoring device kept the row — permanent, silent divergence, visible to
 * nobody except as a number that differs between two phones.
 *
 * Both tables now use surrogate ids, so a re-create is a genuinely new row.
 * These tests drive the real projection merge, not a mock of it.
 */
import '../cryptoPolyfill';

import type { LocalBudgetLedger } from '../engine';
import {
  applyLedgerDelta,
  captureLedgerSnapshot,
  diffLedger,
  LEDGER_TABLE_KEYS,
} from '../projection';

function ledgerWith(overrides: Partial<LocalBudgetLedger> = {}): LocalBudgetLedger {
  return {
    savingsMonthlyTargets: [],
    wishAttachments: [],
    lww: {},
    conflicts: [],
    ...overrides,
  } as unknown as LocalBudgetLedger;
}

let seq = 0;
function stamp(memberId: string, wallMs: number) {
  seq += 1;
  return {
    hlc: `${String(wallMs).padStart(15, '0')}-0000-${memberId}`,
    authorMemberId: memberId,
    opId: `op_${seq}`,
  };
}

/** Author a change on `author` and merge the resulting delta into `peer`. */
function replicate(
  author: LocalBudgetLedger,
  peer: LocalBudgetLedger,
  memberId: string,
  wallMs: number,
  mutate: (l: LocalBudgetLedger) => void,
) {
  const before = captureLedgerSnapshot(author);
  mutate(author);
  const delta = diffLedger(before, author);
  const st = stamp(memberId, wallMs);
  // The author stamps its own change too, exactly as the engine does.
  applyLedgerDelta(author, delta!, st);
  applyLedgerDelta(peer, delta!, st);
  return delta;
}

describe('natural-key re-key', () => {
  it('keys both formerly-natural-key tables by a surrogate id', () => {
    expect(LEDGER_TABLE_KEYS.savingsMonthlyTargets).toBe('id');
    expect(LEDGER_TABLE_KEYS.wishAttachments).toBe('id');
  });

  it('propagates a savings target that is set, cleared, then set again', () => {
    const a = ledgerWith();
    const b = ledgerWith();

    replicate(a, b, 'member-a', 1_000, (l) => {
      l.savingsMonthlyTargets.push({
        id: 'smt_1',
        period: '2026-08',
        target_cents: 50_000,
        updated_at: '2026-08-01T00:00:00.000Z',
      });
    });
    expect(b.savingsMonthlyTargets).toHaveLength(1);

    // Clear the month — this is the delete that used to poison the period key.
    replicate(a, b, 'member-a', 2_000, (l) => {
      l.savingsMonthlyTargets = l.savingsMonthlyTargets.filter((t) => t.period !== '2026-08');
    });
    expect(b.savingsMonthlyTargets).toHaveLength(0);

    // Set it again. Same period, NEW surrogate id.
    replicate(a, b, 'member-a', 3_000, (l) => {
      l.savingsMonthlyTargets.push({
        id: 'smt_2',
        period: '2026-08',
        target_cents: 75_000,
        updated_at: '2026-08-02T00:00:00.000Z',
      });
    });

    // Before the re-key this was [] on the peer while the author showed 75000.
    expect(b.savingsMonthlyTargets).toHaveLength(1);
    expect(b.savingsMonthlyTargets[0]!.period).toBe('2026-08');
    expect(b.savingsMonthlyTargets[0]!.target_cents).toBe(75_000);
    expect(b.savingsMonthlyTargets).toEqual(a.savingsMonthlyTargets);
  });

  it('propagates a wish attachment that is deleted, then re-added with the same image key', () => {
    const a = ledgerWith();
    const b = ledgerWith();

    replicate(a, b, 'member-a', 1_000, (l) => {
      l.wishAttachments.push({
        id: 'wat_1',
        key: 'img_abc',
        localUri: 'file:///img_abc.jpg',
        mime: 'image/jpeg',
      });
    });
    expect(b.wishAttachments).toHaveLength(1);

    replicate(a, b, 'member-a', 2_000, (l) => {
      l.wishAttachments = l.wishAttachments.filter((x) => x.key !== 'img_abc');
    });
    expect(b.wishAttachments).toHaveLength(0);

    replicate(a, b, 'member-a', 3_000, (l) => {
      l.wishAttachments.push({
        id: 'wat_2',
        key: 'img_abc',
        localUri: 'file:///img_abc.jpg',
        mime: 'image/jpeg',
      });
    });

    expect(b.wishAttachments).toHaveLength(1);
    expect(b.wishAttachments[0]!.key).toBe('img_abc');
    expect(b.wishAttachments).toEqual(a.wishAttachments);
  });

  it('still lets a delete win over a concurrent edit of the SAME row', () => {
    // The re-key must not weaken absorbing tombstones — it only stops a NEW row
    // from inheriting a dead row's key.
    const a = ledgerWith({
      savingsMonthlyTargets: [
        { id: 'smt_1', period: '2026-09', target_cents: 10_000, updated_at: 'x' },
      ],
    } as Partial<LocalBudgetLedger>);
    const b = ledgerWith({
      savingsMonthlyTargets: [
        { id: 'smt_1', period: '2026-09', target_cents: 10_000, updated_at: 'x' },
      ],
    } as Partial<LocalBudgetLedger>);

    const beforeDelete = captureLedgerSnapshot(a);
    a.savingsMonthlyTargets = [];
    const deleteDelta = diffLedger(beforeDelete, a)!;

    const beforeEdit = captureLedgerSnapshot(b);
    b.savingsMonthlyTargets[0]!.target_cents = 99_000;
    const editDelta = diffLedger(beforeEdit, b)!;

    // Delete arrives after the edit on the peer: the tombstone absorbs it.
    applyLedgerDelta(b, editDelta, stamp('member-b', 5_000));
    applyLedgerDelta(b, deleteDelta, stamp('member-a', 6_000));
    expect(b.savingsMonthlyTargets).toHaveLength(0);

    // And the reverse order converges to the same state.
    applyLedgerDelta(a, deleteDelta, stamp('member-a', 6_000));
    applyLedgerDelta(a, editDelta, stamp('member-b', 5_000));
    expect(a.savingsMonthlyTargets).toHaveLength(0);
  });
});
