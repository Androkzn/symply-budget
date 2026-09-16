import { describe, expect, it } from 'vitest';

import {
  MemoryLocalFirstStore,
  OpLog,
  createOpId,
  generateDeviceIdentity,
  generateHouseholdKeys,
  utf8Decode,
  utf8Encode,
  type ProjectionHandler,
} from '../src/index';

describe('OpLog', () => {
  it('appends, verifies, and applies idempotently', async () => {
    const store = new MemoryLocalFirstStore();
    const identity = generateDeviceIdentity('dev-1');
    const household = generateHouseholdKeys('hh-ops');
    const applied: string[] = [];

    const projection: ProjectionHandler = {
      async apply(args) {
        applied.push(`${args.opType}:${utf8Decode(args.plaintextPayload)}`);
      },
    };

    await store.open(new Uint8Array(32).fill(1));
    const log = new OpLog({ store, identity, householdKeys: household, projection });

    const opId = createOpId();
    const stored = await log.append({
      opId,
      authorMemberId: 'member-1',
      parents: [],
      opType: 'TXN_CREATE',
      entityType: 'transaction',
      entityId: 'txn-1',
      plaintextPayload: utf8Encode('{"amount":1250}'),
    });

    expect(stored.opId).toBe(opId);
    expect(applied).toEqual(['TXN_CREATE:{"amount":1250}']);

    const again = await log.append({
      opId,
      authorMemberId: 'member-1',
      parents: [],
      opType: 'TXN_CREATE',
      entityType: 'transaction',
      entityId: 'txn-1',
      plaintextPayload: utf8Encode('{"amount":1250}'),
    });
    expect(again.opId).toBe(opId);
    expect(applied).toHaveLength(1);

    const peerStore = new MemoryLocalFirstStore();
    await peerStore.open(new Uint8Array(32).fill(2));
    const peerApplied: string[] = [];
    const peerLog = new OpLog({
      store: peerStore,
      identity: generateDeviceIdentity('dev-2'),
      householdKeys: household,
      projection: {
        async apply(args) {
          peerApplied.push(args.opId);
        },
      },
    });

    const remote = await peerLog.applyRemote(stored, identity.signingPublicKey);
    expect(remote.status).toBe('applied');
    expect(peerApplied).toEqual([opId]);

    const dup = await peerLog.applyRemote(stored, identity.signingPublicKey);
    expect(dup.status).toBe('duplicate');

    const badSig = await peerLog.applyRemote(
      {
        ...stored,
        opId: createOpId(),
        seq: stored.seq + 1,
        signature: new Uint8Array(64),
      },
      identity.signingPublicKey,
    );
    expect(badSig.status).toBe('rejected');
    expect(badSig.reason).toBe('bad_signature');
  });

  it('tracks projection cursor', async () => {
    const store = new MemoryLocalFirstStore();
    const identity = generateDeviceIdentity('dev-cursor');
    const household = generateHouseholdKeys('hh-cursor');
    await store.open(new Uint8Array(32).fill(3));
    const log = new OpLog({ store, identity, householdKeys: household });
    const opId = createOpId();
    await log.append({
      opId,
      authorMemberId: 'm1',
      parents: [],
      opType: 'BUDGET_SET',
      entityType: 'budget',
      entityId: 'cat-food',
      plaintextPayload: utf8Encode('{"amount":50000}'),
    });
    expect(await store.getProjectionCursor('budget', 'cat-food')).toBe(opId);
  });

  it('rejects a remote op whose HLC is more than 60s in the future', async () => {
    const store = new MemoryLocalFirstStore();
    const identity = generateDeviceIdentity('dev-drift');
    const household = generateHouseholdKeys('hh-drift');
    await store.open(new Uint8Array(32).fill(4));
    const log = new OpLog({
      store,
      identity,
      householdKeys: household,
      clock: { nowMs: () => 1_800_000_000_000 },
    });
    const futureHlc = `${String(1_800_000_000_000 + 120_000).padStart(15, '0')}-0000-devdrift`;
    const stored = await log.append({
      opId: createOpId(),
      authorMemberId: 'm1',
      parents: [],
      opType: 'TXN_CREATE',
      entityType: 'transaction',
      entityId: 'txn-future',
      plaintextPayload: utf8Encode('{}'),
      hlc: futureHlc,
    });

    const peerStore = new MemoryLocalFirstStore();
    await peerStore.open(new Uint8Array(32).fill(5));
    const peerLog = new OpLog({
      store: peerStore,
      identity: generateDeviceIdentity('dev-peer'),
      householdKeys: household,
      clock: { nowMs: () => 1_800_000_000_000 },
    });
    const result = await peerLog.applyRemote(stored, identity.signingPublicKey);
    expect(result).toEqual({ status: 'rejected', reason: 'hlc_drift' });
  });

  it('refuses to author when a peer VV is ahead of local seq', async () => {
    const store = new MemoryLocalFirstStore();
    const identity = generateDeviceIdentity('dev-seq');
    const household = generateHouseholdKeys('hh-seq');
    await store.open(new Uint8Array(32).fill(6));
    await store.putSyncPeerState({
      householdId: household.householdId,
      peerDeviceId: 'peer-1',
      knownVv: { [identity.deviceId]: 40 },
      sentVv: {},
      sentAtMs: 0,
      lastPushAtMs: 0,
      lastReceiptVv: {},
    });
    const log = new OpLog({ store, identity, householdKeys: household });
    await expect(
      log.append({
        opId: createOpId(),
        authorMemberId: 'm1',
        parents: [],
        opType: 'TXN_CREATE',
        entityType: 'transaction',
        entityId: 'txn-1',
        plaintextPayload: utf8Encode('{}'),
      }),
    ).rejects.toMatchObject({ name: 'SeqRegressionError' });
  });
});
