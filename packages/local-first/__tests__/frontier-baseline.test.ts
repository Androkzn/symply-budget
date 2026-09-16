/**
 * The contiguous frontier needs a settable BASELINE.
 *
 * `advanceFrontier` only moves on `seq === contiguous + 1` counting from 0, so
 * an author whose LOWEST seq in this household is not 1 is pinned at 0 for ever.
 * That includes the device itself — the one author that can say authoritatively
 * that nothing below its own minimum will ever arrive, because it is the sole
 * source of its own ops.
 *
 * The shape is not hypothetical: `nextSeq` used to be device-global, so a device
 * that created its own household and then joined another has ops starting at
 * 4, 5, 6… in the joined one. Pinned at 0 that device never appears in its own
 * version vector, its own `sentVv` never advances either (`advanceVvWithOps`
 * walks from 0 too), and every sync re-ships the whole log for ever — the
 * opposite of the one-time resend the frontier rebuild promises.
 */
import { describe, expect, it } from 'vitest';

import {
  MailboxSyncEngine,
  MemoryControlPlaneClient,
  MemoryLocalFirstStore,
  OpLog,
  SqliteLocalFirstStore,
  createOpId,
  generateDeviceIdentity,
  generateHouseholdKeys,
  utf8Encode,
  type DeviceId,
  type LocalFirstStore,
} from '../src/index';

import { createFakeSqliteDriver } from './helpers/fake-sqlite-driver';

const stores: Array<[string, () => Promise<LocalFirstStore>]> = [
  [
    'memory',
    async () => {
      const store = new MemoryLocalFirstStore();
      await store.open(new Uint8Array(32).fill(7));
      return store;
    },
  ],
  [
    'sqlite',
    async () => {
      const store = new SqliteLocalFirstStore(createFakeSqliteDriver());
      await store.open(new Uint8Array(32).fill(7));
      return store;
    },
  ],
];

async function append(log: OpLog, i: number, seq?: number): Promise<void> {
  await log.append({
    opId: createOpId(),
    authorMemberId: 'm-legacy',
    parents: [],
    opType: 'EXPENSE_CREATE',
    entityType: 'expense',
    entityId: `e-${i}`,
    plaintextPayload: utf8Encode(`{"i":${i}}`),
    ...(seq === undefined ? {} : { seq }),
  });
}

describe.each(stores)('author baseline (%s)', (_label, open) => {
  it('lets a device whose own seqs start at 4 appear in its own version vector', async () => {
    const keys = generateHouseholdKeys('hh-baseline');
    const identity = generateDeviceIdentity('dev-legacy');
    const store = await open();
    const log = new OpLog({ store, identity, householdKeys: keys });

    // Exactly what a device-global `nextSeq` left behind in the joined household.
    await append(log, 0, 4);
    await append(log, 1, 5);
    await append(log, 2, 6);

    // The next local write uses the household-scoped nextSeq: 7.
    await append(log, 3);

    expect(await store.getVersionVector(keys.householdId)).toEqual({
      [identity.deviceId]: 7,
    });
  });

  it('does NOT invent a baseline for a relayed third-party author', async () => {
    // The other half of the rule: a hole in an author we merely relay is a hole
    // in delivery, and claiming across it would tell every peer we already hold
    // ops nobody ever sent us.
    const store = await open();
    await store.insertOperation({
      opId: 'relayed-5',
      householdId: 'hh-relay',
      deviceId: 'dev-third',
      authorMemberId: 'm-third',
      hlc: '000000000005000-0000-devthird',
      seq: 5,
      parentsJson: '[]',
      opType: 'TEST',
      entityType: 'entity',
      entityId: 'e-5',
      payload: new Uint8Array([1]),
      keyEpoch: 1,
      signature: new Uint8Array(64).fill(3),
      appliedAt: 0,
    });
    expect(await store.getVersionVector('hh-relay')).toEqual({});
  });
});

describe('author baseline over real sync', () => {
  it('stops the permanent full-history storm between two devices', async () => {
    const keys = generateHouseholdKeys('hh-baseline-sync');
    const hh = keys.householdId;

    const make = async (name: string) => {
      const identity = generateDeviceIdentity(name);
      const store = new MemoryLocalFirstStore();
      await store.open(new Uint8Array(32).fill(9));
      return { identity, store, opLog: new OpLog({ store, identity, householdKeys: keys }) };
    };
    const a = await make('storm-legacy-a');
    const b = await make('storm-legacy-b');

    // A carries a pre-Stage-1 database: its own ops in this household start at 4.
    await append(a.opLog, 0, 4);
    await append(a.opLog, 1, 5);
    await append(a.opLog, 2, 6);

    const control = new MemoryControlPlaneClient();
    const pubMap = new Map(
      [a, b].map((d) => [d.identity.deviceId, d.identity.signingPublicKey] as const),
    );
    let clock = 1_000_000;
    const engineFor = (
      device: typeof a,
      peers: DeviceId[],
    ) =>
      new MailboxSyncEngine({
        store: device.store,
        opLog: device.opLog,
        householdKeys: keys,
        deviceId: device.identity.deviceId,
        signingPublicKey: device.identity.signingPublicKey,
        control,
        peerDeviceIds: peers,
        resolveSenderPublicKey: (id) => pubMap.get(id) ?? null,
        nowMs: () => clock,
      });
    const engineA = engineFor(a, [b.identity.deviceId]);
    const engineB = engineFor(b, [a.identity.deviceId]);

    for (let round = 0; round < 4; round += 1) {
      clock += 60_000;
      await engineA.syncOnce();
      await engineB.syncOnce();
    }

    expect(await b.store.listOperationsSince(hh, {})).toHaveLength(3);
    // B can now name what it holds from A, which is the whole point of the vector.
    expect(await b.store.getVersionVector(hh)).toEqual({ [a.identity.deviceId]: 6 });

    control.resetCounters();
    for (let round = 0; round < 3; round += 1) {
      clock += 60_000;
      await engineA.syncOnce();
      await engineB.syncOnce();
    }
    // Was: 2 deposits per round, for ever, on a fully converged pair.
    expect(control.depositCount()).toBe(0);
  }, 60_000);
});
