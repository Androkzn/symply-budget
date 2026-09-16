/**
 * The compact LWW envelope form must be EXACTLY lossless. It is a serialization
 * detail of the at-rest row body, so any asymmetry is silent data corruption of
 * the merge watermarks — which is convergence, not performance.
 *
 * The round-trip is asserted structurally (`toEqual`), not on key order: the
 * `g` group rebuilds `f` in the key order of `row`, and `Object.keys(meta.f)`
 * order was already replica-dependent before this codec existed.
 */
import { describe, expect, it } from 'vitest';

import {
  createLedgerProjection,
  decodeRowLww,
  defineLedgerSchema,
  encodeRowLww,
  isEncodedRowLww,
  type LedgerConflict,
  type LedgerRow,
  type RowLww,
} from '../src/index';

const STAMP_A = '001700000000000-0001-dev00001|usr_alice';
const STAMP_B = '001700000000001-0002-dev00002|usr_bob';
const STAMP_C = '001700000000002-0003-dev00001|usr_alice';

function roundTrip(lww: RowLww, row: LedgerRow | null): RowLww {
  const encoded = encodeRowLww(lww, row);
  // Goes through JSON exactly as the store does.
  return decodeRowLww(JSON.parse(JSON.stringify(encoded)) as unknown, row);
}

describe('lww-codec', () => {
  it('round-trips a row whose every field carries the create stamp', () => {
    const row: LedgerRow = { id: 'w1', date: '2026-01-01', weight: 81.5, note: null };
    const lww: RowLww = {
      f: { id: STAMP_A, date: STAMP_A, weight: STAMP_A, note: STAMP_A },
    };
    expect(roundTrip(lww, row)).toEqual(lww);
  });

  it('collapses that row to a single stamp reference', () => {
    const row: LedgerRow = { id: 'w1', date: '2026-01-01', weight: 81.5, note: null };
    const lww: RowLww = {
      f: { id: STAMP_A, date: STAMP_A, weight: STAMP_A, note: STAMP_A },
    };
    const encoded = encodeRowLww(lww, row);
    expect(encoded.h).toEqual(['001700000000000-0001-dev00001']);
    expect(encoded.m).toEqual(['usr_alice']);
    expect(encoded.g).toBe(0);
    expect(encoded.f).toBeUndefined();
    expect(JSON.stringify(encoded).length).toBeLessThan(JSON.stringify(lww).length);
  });

  it('round-trips a row with a per-field edit on top of the create', () => {
    const row: LedgerRow = { id: 'w1', date: '2026-01-01', weight: 81.5 };
    const lww: RowLww = { f: { id: STAMP_A, date: STAMP_A, weight: STAMP_B } };
    expect(roundTrip(lww, row)).toEqual(lww);
  });

  it('round-trips stamps that share an HLC but not an author, and vice versa', () => {
    const row: LedgerRow = { id: 'w1', a: 1, b: 2, c: 3 };
    const lww: RowLww = {
      f: {
        id: STAMP_A,
        a: `001700000000000-0001-dev00001|usr_bob`,
        b: STAMP_C,
        c: STAMP_B,
      },
    };
    expect(roundTrip(lww, row)).toEqual(lww);
  });

  it('round-trips a tombstone with no row', () => {
    const lww: RowLww = { f: {}, del: STAMP_B };
    expect(roundTrip(lww, null)).toEqual(lww);
  });

  it('round-trips a tombstone that still carries field stamps', () => {
    const lww: RowLww = { f: { id: STAMP_A, weight: STAMP_C }, del: STAMP_B };
    expect(roundTrip(lww, null)).toEqual(lww);
  });

  it('round-trips parked orphan patches verbatim', () => {
    const lww: RowLww = {
      f: { id: STAMP_A },
      p: { weight: { v: 79.2, s: STAMP_B, o: 'op_123' } },
    };
    expect(roundTrip(lww, null)).toEqual(lww);
  });

  it('never invents a watermark for a column that had none', () => {
    // `weight` is in the row but absent from `f` — the group must not claim it.
    const row: LedgerRow = { id: 'w1', date: '2026-01-01', weight: 81.5 };
    const lww: RowLww = { f: { id: STAMP_A, date: STAMP_A } };
    const back = roundTrip(lww, row);
    expect(back).toEqual(lww);
    expect('weight' in back.f).toBe(false);
  });

  it('round-trips a stamp with no author separator', () => {
    const row: LedgerRow = { id: 'w1', a: 1 };
    const lww: RowLww = { f: { id: 'bare-hlc-no-pipe', a: 'bare-hlc-no-pipe' } };
    expect(roundTrip(lww, row)).toEqual(lww);
  });

  it('round-trips a stamp whose author is the empty string', () => {
    const row: LedgerRow = { id: 'w1' };
    const lww: RowLww = { f: { id: '001700000000000-0001-dev00001|' } };
    expect(roundTrip(lww, row)).toEqual(lww);
  });

  it('round-trips an empty watermark map', () => {
    expect(roundTrip({ f: {} }, null)).toEqual({ f: {} });
  });

  it('passes a legacy uncompacted envelope through untouched', () => {
    const legacy: RowLww = { f: { id: STAMP_A }, del: STAMP_B };
    expect(isEncodedRowLww(legacy)).toBe(false);
    expect(decodeRowLww(legacy, null)).toEqual(legacy);
  });

  it('survives a fuzz of random stamp assignments', () => {
    let seed = 0x9e3779b9;
    const rand = (n: number): number => {
      // eslint-disable-next-line no-bitwise -- LCG; the fuzz must be reproducible.
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed % n;
    };
    const stamps = [STAMP_A, STAMP_B, STAMP_C, 'bare', '001700000000009-0009-devX|'];
    for (let i = 0; i < 500; i += 1) {
      const cols = 1 + rand(12);
      const row: LedgerRow = {};
      for (let c = 0; c < cols; c += 1) row[`col${c}`] = rand(1000);
      const f: Record<string, string> = {};
      for (let c = 0; c < cols; c += 1) {
        if (rand(10) > 0) f[`col${c}`] = stamps[rand(stamps.length)]!;
      }
      if (rand(4) === 0) f.gone = stamps[rand(stamps.length)]!;
      const lww: RowLww = { f };
      if (rand(3) === 0) lww.del = stamps[rand(stamps.length)]!;
      const withRow = rand(5) > 0 ? row : null;
      expect(roundTrip(lww, withRow)).toEqual(lww);
    }
  });
});

describe('lww-codec through the projection core', () => {
  type Name = 'items';
  type Ledger = {
    items: LedgerRow[];
    lww?: Partial<Record<Name, Record<string, RowLww>>>;
    conflicts?: LedgerConflict<Name>[];
  };

  const build = (compactLww: boolean) =>
    createLedgerProjection<Name, Ledger>(
      defineLedgerSchema<Name>({
        tableKeys: { items: 'id' },
        logPrefix: 'Test',
        compactLww,
      }),
    );

  it('a compacted persist installs to the same ledger a raw one does', () => {
    const raw = build(false);
    const compact = build(true);

    const seed = (p: ReturnType<typeof build>): Ledger => {
      const ledger = { items: [], lww: {}, conflicts: [] } as Ledger;
      p.applyLedgerDelta(
        ledger as never,
        { v: 1, u: { items: [{ k: 'i1', f: { id: 'i1', name: 'a', qty: 2 }, n: 1 }] } },
        { hlc: '001700000000000-0001-devA', authorMemberId: 'usr_alice', opId: 'op1' },
      );
      p.applyLedgerDelta(
        ledger as never,
        { v: 1, u: { items: [{ k: 'i1', f: { qty: 5 } }] } },
        { hlc: '001700000000001-0002-devB', authorMemberId: 'usr_bob', opId: 'op2' },
      );
      p.applyLedgerDelta(
        ledger as never,
        { v: 1, d: { items: ['gone'] } },
        { hlc: '001700000000002-0003-devA', authorMemberId: 'usr_alice', opId: 'op3' },
      );
      return ledger;
    };

    const rawLedger = seed(raw);
    const compactLedger = seed(compact);
    expect(compactLedger).toEqual(rawLedger);

    const rawWrites = raw.collectRowWrites(rawLedger as never, 'all');
    const compactWrites = compact.collectRowWrites(compactLedger as never, 'all');
    expect(compactWrites.some((w) => isEncodedRowLww(w.envelope.lww))).toBe(true);
    expect(rawWrites.some((w) => isEncodedRowLww(w.envelope.lww))).toBe(false);

    const reopen = (
      p: ReturnType<typeof build>,
      writes: ReturnType<ReturnType<typeof build>['collectRowWrites']>,
    ): Ledger => {
      const fresh = { items: [], lww: {}, conflicts: [] } as Ledger;
      // Through JSON, exactly as the store does.
      p.installRowEnvelopes(fresh as never, JSON.parse(JSON.stringify(writes)) as never);
      return fresh;
    };

    expect(reopen(compact, compactWrites)).toEqual(reopen(raw, rawWrites));
    // …and the compacted body really is smaller on disk.
    expect(JSON.stringify(compactWrites).length).toBeLessThan(JSON.stringify(rawWrites).length);
  });

  /**
   * The regression proof for Budget and House. Their committed scale baselines
   * are both provisional (Budget's predates the corpus fingerprint, House's was
   * captured with the load gate overridden), so "no perf regression" cannot be
   * settled by `compare` alone. It can be settled EXACTLY here: a brand that has
   * not opted in must persist the very same object it persisted before, and
   * install the very same object back — reference identity, not deep equality,
   * because anything that allocates is a change to their hot path.
   */
  it('leaves a brand that has not opted in byte- and reference-identical', () => {
    const raw = build(false);
    const ledger = { items: [], lww: {}, conflicts: [] } as Ledger;
    raw.applyLedgerDelta(
      ledger as never,
      { v: 1, u: { items: [{ k: 'i1', f: { id: 'i1', name: 'a', qty: 2 }, n: 1 }] } },
      { hlc: '001700000000000-0001-devA', authorMemberId: 'usr_alice', opId: 'op1' },
    );
    const liveLww = ledger.lww!.items!.i1!;
    const writes = raw.collectRowWrites(ledger as never, 'all');
    // collectRowWrites hands back the LIVE watermark object, not a copy.
    expect(writes[0]!.envelope.lww).toBe(liveLww);

    const fresh = { items: [], lww: {}, conflicts: [] } as Ledger;
    raw.installRowEnvelopes(fresh as never, writes as never);
    // installRowEnvelopes installs that same object, not a rebuilt one.
    expect(fresh.lww!.items!.i1!).toBe(liveLww);
  });

  it('a raw-writing brand can read a compacted store and back', () => {
    const raw = build(false);
    const compact = build(true);
    const ledger = { items: [], lww: {}, conflicts: [] } as Ledger;
    compact.applyLedgerDelta(
      ledger as never,
      { v: 1, u: { items: [{ k: 'i1', f: { id: 'i1', name: 'a' }, n: 1 }] } },
      { hlc: '001700000000000-0001-devA', authorMemberId: 'usr_alice', opId: 'op1' },
    );
    const compactWrites = JSON.parse(
      JSON.stringify(compact.collectRowWrites(ledger as never, 'all')),
    ) as never;
    const viaRaw = { items: [], lww: {}, conflicts: [] } as Ledger;
    raw.installRowEnvelopes(viaRaw as never, compactWrites);
    expect(viaRaw).toEqual(ledger);
  });
});
