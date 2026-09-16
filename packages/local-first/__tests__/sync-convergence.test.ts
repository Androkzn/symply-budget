import { describe, expect, it } from 'vitest';

import {
  LoopbackPeerTransport,
  MailboxSyncEngine,
  MemoryControlPlaneClient,
  MemoryLocalFirstStore,
  OpLog,
  PeerSyncSession,
  createOpId,
  generateDeviceIdentity,
  generateHouseholdKeys,
  utf8Encode,
} from '../src/index';

describe('Phase 3 sync convergence', () => {
  it('converges two devices via ZK mailbox', async () => {
    const household = generateHouseholdKeys('hh-mbx');
    const dbKey = new Uint8Array(32).fill(3);

    const aId = generateDeviceIdentity('dev-a');
    const bId = generateDeviceIdentity('dev-b');
    const storeA = new MemoryLocalFirstStore();
    const storeB = new MemoryLocalFirstStore();
    await storeA.open(dbKey);
    await storeB.open(new Uint8Array(dbKey));

    const logA = new OpLog({ store: storeA, identity: aId, householdKeys: household });
    const logB = new OpLog({ store: storeB, identity: bId, householdKeys: household });

    await logA.append({
      opId: createOpId(),
      authorMemberId: 'm-a',
      parents: [],
      opType: 'TXN_CREATE',
      entityType: 'transaction',
      entityId: 't-a1',
      plaintextPayload: utf8Encode('{"amount":42}'),
    });

    const control = new MemoryControlPlaneClient();
    await control.registerDevice({
      householdId: household.householdId,
      deviceId: aId.deviceId,
      signingPublicKey: aId.signingPublicKey,
      agreementPublicKey: aId.agreementPublicKey,
    });
    await control.registerDevice({
      householdId: household.householdId,
      deviceId: bId.deviceId,
      signingPublicKey: bId.signingPublicKey,
      agreementPublicKey: bId.agreementPublicKey,
    });

    const pubMap = new Map([
      [aId.deviceId, aId.signingPublicKey],
      [bId.deviceId, bId.signingPublicKey],
    ]);
    const resolve = (deviceId: string) => pubMap.get(deviceId) ?? null;

    const engineA = new MailboxSyncEngine({
      store: storeA,
      opLog: logA,
      householdKeys: household,
      deviceId: aId.deviceId,
      signingPublicKey: aId.signingPublicKey,
      control,
      peerDeviceIds: [bId.deviceId],
      resolveSenderPublicKey: resolve,
    });
    const engineB = new MailboxSyncEngine({
      store: storeB,
      opLog: logB,
      householdKeys: household,
      deviceId: bId.deviceId,
      signingPublicKey: bId.signingPublicKey,
      control,
      peerDeviceIds: [aId.deviceId],
      resolveSenderPublicKey: resolve,
    });

    expect(await engineA.pushOutbound()).toBe(1);
    const pull = await engineB.pullInbound();
    expect(pull.applied).toBe(1);
    expect(await storeB.listOperationsByHlc(household.householdId)).toHaveLength(1);
  });

  it('acks unknown historical authors only after their sequence is covered by a trusted checkpoint', async () => {
    const household = generateHouseholdKeys('hh-history');
    const author = generateDeviceIdentity('old-author');
    const relay = generateDeviceIdentity('relay');
    const receiver = generateDeviceIdentity('receiver');
    const source = new MemoryLocalFirstStore();
    const target = new MemoryLocalFirstStore();
    await source.open(new Uint8Array(32).fill(1));
    await target.open(new Uint8Array(32).fill(2));
    const authorLog = new OpLog({store:source,identity:author,householdKeys:household});
    const op = await authorLog.append({opId:createOpId(),authorMemberId:'old-member',parents:[],opType:'TXN_CREATE',entityType:'transaction',entityId:'old-row',plaintextPayload:utf8Encode('{}')});
    const control = new MemoryControlPlaneClient();
    const sender = new MailboxSyncEngine({store:source,opLog:authorLog,householdKeys:household,deviceId:relay.deviceId,signingPublicKey:relay.signingPublicKey,control,peerDeviceIds:[receiver.deviceId],resolveSenderPublicKey:()=>null});
    const recipient = new MailboxSyncEngine({store:target,opLog:new OpLog({store:target,identity:receiver,householdKeys:household}),householdKeys:household,deviceId:receiver.deviceId,signingPublicKey:receiver.signingPublicKey,control,peerDeviceIds:[relay.deviceId],resolveSenderPublicKey:()=>null});
    await sender.pushOutbound();
    const before = await recipient.pullInbound();
    expect(before.rejectedReasons.author_key_unknown).toBe(1);
    expect(before.acked).toBe(0);
    await target.setAuthorBaseline(household.householdId, author.deviceId, op.seq);
    const after = await recipient.pullInbound();
    expect(after.duplicates).toBe(1);
    expect(after.rejected).toBe(0);
    expect(after.acked).toBe(1);
    expect(await target.listOperationsByHlc(household.householdId)).toHaveLength(0);
  });

  it('converges two devices via loopback peer session (WebRTC stand-in)', async () => {
    const household = generateHouseholdKeys('hh-p2p');
    const aId = generateDeviceIdentity('p2p-a');
    const bId = generateDeviceIdentity('p2p-b');
    const storeA = new MemoryLocalFirstStore();
    const storeB = new MemoryLocalFirstStore();
    await storeA.open(new Uint8Array(32).fill(1));
    await storeB.open(new Uint8Array(32).fill(2));

    const logA = new OpLog({ store: storeA, identity: aId, householdKeys: household });
    const logB = new OpLog({ store: storeB, identity: bId, householdKeys: household });

    await logA.append({
      opId: createOpId(),
      authorMemberId: 'm-a',
      parents: [],
      opType: 'TXN_CREATE',
      entityType: 'transaction',
      entityId: 't1',
      plaintextPayload: utf8Encode('{"n":1}'),
    });
    await logB.append({
      opId: createOpId(),
      authorMemberId: 'm-b',
      parents: [],
      opType: 'TXN_CREATE',
      entityType: 'transaction',
      entityId: 't2',
      plaintextPayload: utf8Encode('{"n":2}'),
    });

    const pubMap = new Map([
      [aId.deviceId, aId.signingPublicKey],
      [bId.deviceId, bId.signingPublicKey],
    ]);
    const resolve = (id: string) => pubMap.get(id) ?? null;

    const sessionA = new PeerSyncSession({
      householdId: household.householdId,
      deviceId: aId.deviceId,
      signingPublicKey: aId.signingPublicKey,
      agreementPublicKey: aId.agreementPublicKey,
      opLog: logA,
      listLocalOps: () => storeA.listOperationsByHlc(household.householdId),
      resolveSenderPublicKey: resolve,
    });
    const sessionB = new PeerSyncSession({
      householdId: household.householdId,
      deviceId: bId.deviceId,
      signingPublicKey: bId.signingPublicKey,
      agreementPublicKey: bId.agreementPublicKey,
      opLog: logB,
      listLocalOps: () => storeB.listOperationsByHlc(household.householdId),
      resolveSenderPublicKey: resolve,
    });

    const [ta, tb] = LoopbackPeerTransport.pair();
    const [ra, rb] = await Promise.all([
      sessionA.runAsInitiator(ta),
      sessionB.runAsResponder(tb),
    ]);

    expect(ra.applied + rb.applied).toBeGreaterThanOrEqual(2);
    expect(await storeA.listOperationsByHlc(household.householdId)).toHaveLength(2);
    expect(await storeB.listOperationsByHlc(household.householdId)).toHaveLength(2);
  });
});
