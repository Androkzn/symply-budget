import { describe, expect, it } from 'vitest';

import {
  HybridLogicalClock,
  MemoryLocalFirstStore,
  SqliteLocalFirstStore,
  type LocalFirstStore,
  type StoredOperation,
} from '../src/index';

import { createFakeSqliteDriver } from './helpers/fake-sqlite-driver';

const HH = 'hh-vv';

function op(input: {
  deviceId: string;
  seq: number;
  hlc: string;
  householdId?: string;
  opId?: string;
}): StoredOperation {
  return {
    opId: input.opId ?? `op-${input.householdId ?? HH}-${input.deviceId}-${input.seq}`,
    householdId: input.householdId ?? HH,
    deviceId: input.deviceId,
    authorMemberId: `m-${input.deviceId}`,
    hlc: input.hlc,
    seq: input.seq,
    parentsJson: '[]',
    opType: 'TEST',
    entityType: 'entity',
    entityId: `e-${input.seq}`,
    payload: new Uint8Array([1, 2, 3]),
    keyEpoch: 1,
    signature: new Uint8Array(64).fill(7),
    appliedAt: 0,
  };
}

/** `${wallMs padded to 15}-${counter hex}-${suffix}` — the real HLC layout. */
function hlc(wallMs: number, counter: number, device: string): string {
  return new HybridLogicalClock(device, wallMs, counter).format();
}

async function openMemory(): Promise<MemoryLocalFirstStore> {
  const store = new MemoryLocalFirstStore();
  await store.open(new Uint8Array(32).fill(1));
  return store;
}

async function openSqlite(): Promise<SqliteLocalFirstStore> {
  const store = new SqliteLocalFirstStore(createFakeSqliteDriver());
  await store.open(new Uint8Array(32).fill(1));
  return store;
}

/** Both implementations must agree — the mobile suite only ever runs the memory one. */
const stores: Array<[string, () => Promise<LocalFirstStore>]> = [
  ['memory', openMemory],
  ['sqlite', openSqlite],
];

describe.each(stores)('getVersionVector (%s)', (_label, open) => {
  it('reports the CONTIGUOUS prefix, not MAX(seq)', async () => {
    const store = await open();
    await store.insertOperation(op({ deviceId: 'D', seq: 1, hlc: hlc(1000, 0, 'D') }));
    await store.insertOperation(op({ deviceId: 'D', seq: 2, hlc: hlc(2000, 0, 'D') }));
    // seq 3 is still in flight; 4 arrived early via a relaying third device.
    await store.insertOperation(op({ deviceId: 'D', seq: 4, hlc: hlc(4000, 0, 'D') }));

    // MAX(seq) would say 4 here, and every peer would then believe we already
    // hold 3 — nobody would ever send it again.
    expect(await store.getVersionVector(HH)).toEqual({ D: 2 });

    await store.insertOperation(op({ deviceId: 'D', seq: 3, hlc: hlc(3000, 0, 'D') }));
    expect(await store.getVersionVector(HH)).toEqual({ D: 4 });
  });

  it('is order-independent: 4, 2, 1, 3 still ends at 4', async () => {
    const store = await open();
    for (const seq of [4, 2, 1, 3]) {
      await store.insertOperation(op({ deviceId: 'D', seq, hlc: hlc(1000 * seq, 0, 'D') }));
    }
    expect(await store.getVersionVector(HH)).toEqual({ D: 4 });
  });

  it('is household-scoped', async () => {
    const store = await open();
    await store.insertOperation(op({ deviceId: 'D', seq: 1, hlc: hlc(1000, 0, 'D') }));
    await store.insertOperation(
      op({ deviceId: 'D', seq: 1, hlc: hlc(1000, 0, 'D'), householdId: 'hh-other' }),
    );
    expect(await store.getVersionVector(HH)).toEqual({ D: 1 });
    expect(await store.getVersionVector('hh-other')).toEqual({ D: 1 });
  });

  it('listOperationsSince: empty covers nothing, full covers everything', async () => {
    const store = await open();
    await store.insertOperation(op({ deviceId: 'A', seq: 1, hlc: hlc(1000, 0, 'A') }));
    await store.insertOperation(op({ deviceId: 'A', seq: 2, hlc: hlc(2000, 0, 'A') }));
    await store.insertOperation(op({ deviceId: 'B', seq: 1, hlc: hlc(1500, 0, 'B') }));

    expect(await store.listOperationsSince(HH, {})).toHaveLength(3);
    expect(await store.hasOperationsSince(HH, {})).toBe(true);

    const full = await store.getVersionVector(HH);
    expect(await store.listOperationsSince(HH, full)).toHaveLength(0);
    expect(await store.hasOperationsSince(HH, full)).toBe(false);

    // An author absent from the vector is entirely unseen by that peer.
    const onlyA = await store.listOperationsSince(HH, { A: 2 });
    expect(onlyA.map((o) => o.deviceId)).toEqual(['B']);
  });

  it('listOperationsSince orders by hlc, then device, then seq', async () => {
    const store = await open();
    await store.insertOperation(op({ deviceId: 'B', seq: 1, hlc: hlc(2000, 0, 'shared') }));
    await store.insertOperation(op({ deviceId: 'A', seq: 1, hlc: hlc(2000, 0, 'shared') }));
    await store.insertOperation(op({ deviceId: 'A', seq: 2, hlc: hlc(1000, 0, 'shared') }));

    const rows = await store.listOperationsSince(HH, {});
    expect(rows.map((r) => `${r.deviceId}:${r.seq}`)).toEqual(['A:2', 'A:1', 'B:1']);
  });

  it('respects the limit', async () => {
    const store = await open();
    for (let seq = 1; seq <= 5; seq += 1) {
      await store.insertOperation(op({ deviceId: 'A', seq, hlc: hlc(1000 * seq, 0, 'A') }));
    }
    expect(await store.listOperationsSince(HH, {}, 2)).toHaveLength(2);
  });
});

describe('sqlite frontier rebuild', () => {
  it('reconstructs the identical VV from an lf_op_frontier-less database', async () => {
    const driver = createFakeSqliteDriver();
    const store = new SqliteLocalFirstStore(driver);
    await store.open(new Uint8Array(32).fill(1));
    await store.insertOperation(op({ deviceId: 'A', seq: 1, hlc: hlc(1000, 0, 'A') }));
    await store.insertOperation(op({ deviceId: 'A', seq: 2, hlc: hlc(2000, 0, 'A') }));
    await store.insertOperation(op({ deviceId: 'B', seq: 1, hlc: hlc(1500, 0, 'B') }));
    await store.insertOperation(op({ deviceId: 'B', seq: 3, hlc: hlc(3500, 0, 'B') }));
    const expected = await store.getVersionVector(HH);
    expect(expected).toEqual({ A: 2, B: 1 });

    // Simulate a store written before Stage 1: ops present, frontier absent.
    driver.dropTable('lf_op_frontier');
    const reopened = new SqliteLocalFirstStore(driver);
    await reopened.open(new Uint8Array(32).fill(1));
    expect(await reopened.getVersionVector(HH)).toEqual(expected);
  });
});

describe('THE UNSOUNDNESS PROOF: an HLC watermark loses an offline device', () => {
  it('hlc > cursor skips a returning device; the version vector does not', async () => {
    const store = await openMemory();

    // Device B went offline at t=1,000,000 and its wall clock stayed there.
    // (Ops it authors while away carry that old wallMs — HLCs sort by wall
    // clock FIRST, see hlc.ts:44.)
    await store.insertOperation(op({ deviceId: 'B', seq: 1, hlc: hlc(1_000_000, 0, 'B') }));

    // Meanwhile A authors 20 ops with a current clock.
    for (let seq = 1; seq <= 20; seq += 1) {
      await store.insertOperation(
        op({ deviceId: 'A', seq, hlc: hlc(9_000_000 + seq, 0, 'A') }),
      );
    }

    const vvBeforeBReturned = await store.getVersionVector(HH);
    const maxHlcOfA = (await store.listOperationsByHlc(HH)).reduce(
      (max, o) => (o.hlc > max ? o.hlc : max),
      '',
    );

    // B comes back and authors 5 more, still stamped with its stale wall clock.
    for (let seq = 2; seq <= 6; seq += 1) {
      await store.insertOperation(
        op({ deviceId: 'B', seq, hlc: hlc(1_000_000 + seq, 0, 'B') }),
      );
    }

    // (i) The scalar HLC cursor loses every one of them. This is a live
    // demonstration of the trap, not a comment about it.
    const viaHlc = await store.listOperationsByHlc(HH, maxHlcOfA);
    expect(viaHlc).toHaveLength(0);

    // (ii) The version vector returns exactly those 5.
    const viaVv = await store.listOperationsSince(HH, vvBeforeBReturned);
    expect(viaVv.map((o) => `${o.deviceId}:${o.seq}`)).toEqual([
      'B:2',
      'B:3',
      'B:4',
      'B:5',
      'B:6',
    ]);
  });
});
