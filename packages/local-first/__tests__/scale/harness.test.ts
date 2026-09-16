/**
 * Cheap semantic guard — runs in the package's normal `npm test`.
 *
 * The single highest-value test in this harness. If a row ever serialized
 * differently between the capture pass and the diff pass — a getter, a mutable
 * default, a field the projection itself touches — `diffLedger` would report the
 * whole table instead of one field, and every "single-field edit" number in the
 * baseline would be garbage while looking entirely plausible. The first two
 * cases make that impossible.
 *
 * NOT covered here: a clock read at GENERATION time. Two `generateLedger` calls
 * inside one process can land in the same millisecond, so no within-run check
 * can see it. `generator.test.ts`'s committed corpus-hash snapshot is what
 * catches that, because it is compared across runs.
 *
 * The last case proves the mirror is a faithful round trip rather than merely
 * something that compiles.
 */
import { describe, expect, it } from 'vitest';

import {
  applyLedgerDelta,
  captureLedgerSnapshot,
  diffLedger,
} from '../../../../src/features/budget/local/projection';

import { enableDevAssertions } from './lib/dev-global';
import { cloneLedger, generateLedger } from './lib/ledger-factory';
import {
  normalizeLedger,
  openSnapshot,
  reviveOps,
  sealSnapshot,
  serializeLedgerForPersist,
  type SerializedOp,
} from './lib/mirror';
import { cryptoBundleFor, generateOps, hlcAt, pseudoBytes } from './lib/oplog-factory';

enableDevAssertions();

const SMALL = { years: 1, adults: 2 } as const;

const stampAt = (k: number) => ({
  hlc: hlcAt(1_800_000_000_000 + k * 1000, k),
  authorMemberId: 'mem_peer01',
  opId: `op_${k}`,
});

describe('scale harness — projection semantics on the generated corpus', () => {
  it('captures a clean snapshot: no mutation means no delta', () => {
    const ledger = generateLedger(SMALL);
    const snapshot = captureLedgerSnapshot(ledger as never);
    expect(diffLedger(snapshot, ledger as never)).toBeNull();
  });

  it('a single-field edit yields exactly one table, one row, one field', () => {
    const ledger = generateLedger(SMALL);
    const snapshot = captureLedgerSnapshot(ledger as never);
    const target = ledger.expenses[42]!;
    target.amount = 987_654;

    const delta = diffLedger(snapshot, ledger as never);
    expect(delta).not.toBeNull();
    expect(delta!.d).toBeUndefined();
    expect(Object.keys(delta!.u!)).toEqual(['expenses']);
    expect(delta!.u!.expenses).toHaveLength(1);

    const [rowDelta] = delta!.u!.expenses!;
    expect(rowDelta!.k).toBe(target.id);
    expect(rowDelta!.n).toBeUndefined();
    expect(rowDelta!.f).toEqual({ amount: 987_654 });
  });

  it('a peer applies that delta and converges, and replay is a no-op', () => {
    const author = generateLedger(SMALL);
    const peer = cloneLedger(author);

    const snapshot = captureLedgerSnapshot(author as never);
    const target = author.expenses[42]!;
    target.amount = 987_654;
    const delta = diffLedger(snapshot, author as never)!;

    const stamp = stampAt(1);
    const first = applyLedgerDelta(peer as never, delta, stamp);
    expect(first).toEqual({ applied: 1, deleted: 0, conflicts: [] });
    expect(peer.expenses[42]!.amount).toBe(987_654);

    // Idempotent replay: strict-greater-than comparison means the same stamp
    // changes nothing the second time.
    const second = applyLedgerDelta(peer as never, delta, stamp);
    expect(second).toEqual({ applied: 0, deleted: 0, conflicts: [] });
    expect(peer.expenses[42]!.amount).toBe(987_654);
  });

  it('a create delta materializes the row on the peer', () => {
    const author = generateLedger(SMALL);
    const peer = cloneLedger(author);
    const snapshot = captureLedgerSnapshot(author as never);
    author.expenses.push({ ...author.expenses[0]!, id: 'exp_brand_new', amount: 5 });
    const delta = diffLedger(snapshot, author as never)!;

    expect(delta.u!.expenses![0]!.n).toBe(1);
    const result = applyLedgerDelta(peer as never, delta, stampAt(2));
    expect(result.applied).toBe(1);
    expect(peer.expenses.find((row) => row.id === 'exp_brand_new')?.amount).toBe(5);
  });
});

describe('scale harness — write path round trip', () => {
  it('serialize -> seal -> open -> parse -> revive reproduces every op byte for byte', () => {
    const dbKey = pseudoBytes(32, 0xa11ce);
    const hdk = pseudoBytes(32, 0xb0b);

    const ledger = generateLedger(SMALL);
    ledger.ops = generateOps({
      ledger,
      count: 200,
      hdk,
      householdId: String(ledger.household.id),
      deviceId: ledger.deviceId,
      memberId: ledger.memberId,
    });
    ledger.crypto = cryptoBundleFor();

    const json = serializeLedgerForPersist(ledger);
    const { sealed, storedHex } = sealSnapshot(dbKey, json);
    // persistence.ts:50 stores hex — exactly two chars per sealed byte, which
    // is why "bytes written" is 2x "bytes stringified" everywhere in the audit.
    expect(storedHex.length).toBe(sealed.length * 2);

    const reopened = openSnapshot(dbKey, storedHex);
    expect(reopened).toBe(json);

    const parsed = JSON.parse(reopened) as { ops: SerializedOp[] };
    const revived = reviveOps(parsed.ops);
    expect(revived).toHaveLength(ledger.ops.length);
    for (let i = 0; i < revived.length; i += 1) {
      expect(Array.from(revived[i]!.payload)).toEqual(Array.from(ledger.ops[i]!.payload));
      expect(Array.from(revived[i]!.signature)).toEqual(Array.from(ledger.ops[i]!.signature));
      expect(revived[i]!.hlc).toBe(ledger.ops[i]!.hlc);
      expect(revived[i]!.seq).toBe(ledger.ops[i]!.seq);
    }
  });

  it('normalizeLedger keeps every table and backfills the optional ones', () => {
    const ledger = generateLedger(SMALL);
    const stripped = { ...ledger, lww: undefined, conflicts: undefined } as never;
    const normalized = normalizeLedger(stripped);
    expect(normalized.lww).toEqual({});
    expect(normalized.conflicts).toEqual([]);
    expect(normalized.pendingEnrolment).toBe(false);
    expect(normalized.expenses).toHaveLength(ledger.expenses.length);
  });
});
