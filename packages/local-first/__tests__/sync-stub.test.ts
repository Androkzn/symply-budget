import { describe, expect, it } from 'vitest';

import {
  MemoryControlPlaneClient,
  MemoryLocalFirstStore,
  OpLog,
  StubSyncEngine,
  createOpId,
  generateDeviceIdentity,
  generateHouseholdKeys,
  utf8Encode,
} from '../src/index';

describe('sync stubs', () => {
  it('exchanges ops and mailbox blobs in-process', async () => {
    const store = new MemoryLocalFirstStore();
    const identity = generateDeviceIdentity('sync-a');
    const household = generateHouseholdKeys('hh-sync');
    await store.open(new Uint8Array(32).fill(9));
    const log = new OpLog({ store, identity, householdKeys: household });
    const stored = await log.append({
      opId: createOpId(),
      authorMemberId: 'm1',
      parents: [],
      opType: 'TXN_CREATE',
      entityType: 'transaction',
      entityId: 't1',
      plaintextPayload: utf8Encode('{"amount":100}'),
    });

    const engine = new StubSyncEngine(store);
    const checkpoint = await engine.getCheckpoint(household.householdId);
    expect(checkpoint.opCount).toBe(1);
    expect(checkpoint.frontierHlc).toBe(stored.hlc);

    const peer = generateDeviceIdentity('sync-b');
    const exchanged = await engine.exchangeWithPeer(
      {
        deviceId: peer.deviceId,
        signingPublicKey: peer.signingPublicKey,
        agreementPublicKey: peer.agreementPublicKey,
      },
      [stored],
    );
    expect(exchanged).toHaveLength(1);

    const control = new MemoryControlPlaneClient();
    await control.registerDevice({
      householdId: household.householdId,
      deviceId: identity.deviceId,
      signingPublicKey: identity.signingPublicKey,
      agreementPublicKey: identity.agreementPublicKey,
    });
    expect(control.deviceCount()).toBe(1);

    const blob = await control.depositMailbox({
      householdId: household.householdId,
      recipientDeviceId: peer.deviceId,
      ciphertext: stored.payload,
    });
    const fetched = await control.fetchMailbox(household.householdId, peer.deviceId);
    expect(fetched.blobs.map((b) => b.blobId)).toEqual([blob.blobId]);
    expect(fetched.hasMore).toBe(false);
    // Ack is scoped to the addressed device: a household peer that is not the
    // recipient cannot consume — and so destroy — this blob.
    await control.ackMailbox([blob.blobId], identity.deviceId);
    expect((await control.fetchMailbox(household.householdId, peer.deviceId)).blobs).toHaveLength(1);

    await control.ackMailbox([blob.blobId], peer.deviceId);
    expect((await control.fetchMailbox(household.householdId, peer.deviceId)).blobs).toEqual([]);
  });
});
