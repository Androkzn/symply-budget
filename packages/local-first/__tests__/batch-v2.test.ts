/**
 * Batch v2 (base64 wire + sender version vector) is a hard cut — there is no
 * production install base, so no dual-decode path exists. In-flight v1 blobs
 * must therefore degrade quietly AND be acked when addressed, or they are
 * re-downloaded on every sync for the full 14-day relay TTL.
 */
import { describe, expect, it } from 'vitest';

import {
  MAILBOX_BATCH_VERSION,
  MailboxSyncEngine,
  MemoryControlPlaneClient,
  MemoryLocalFirstStore,
  OpLog,
  UnsupportedBatchVersionError,
  aeadEncrypt,
  bytesToBase64,
  bytesToHex,
  createOpId,
  generateDeviceIdentity,
  generateHouseholdKeys,
  openOpBatch,
  sealOpBatch,
  utf8Encode,
  type DeviceId,
} from '../src/index';

const keys = generateHouseholdKeys('hh-v2');
const HH = keys.householdId;

async function makeDevice(name: string) {
  const identity = generateDeviceIdentity(name);
  const store = new MemoryLocalFirstStore();
  await store.open(new Uint8Array(32).fill(2));
  const opLog = new OpLog({ store, identity, householdKeys: keys });
  return { identity, store, opLog };
}

function engineFor(
  device: Awaited<ReturnType<typeof makeDevice>>,
  control: MemoryControlPlaneClient,
  peers: DeviceId[],
): MailboxSyncEngine {
  return new MailboxSyncEngine({
    store: device.store,
    opLog: device.opLog,
    householdKeys: keys,
    deviceId: device.identity.deviceId,
    signingPublicKey: device.identity.signingPublicKey,
    control,
    peerDeviceIds: peers,
    resolveSenderPublicKey: () => null,
  });
}

/** A batch in the pre-Stage-1 shape, sealed exactly as v1 clients sealed it. */
function sealV1(senderDeviceId: string, signingPublicKey: Uint8Array): Uint8Array {
  const batch = {
    v: 1,
    householdId: HH,
    senderDeviceId,
    senderSigningPublicKeyHex: bytesToHex(signingPublicKey),
    ops: [],
  };
  return aeadEncrypt(
    keys.hdk,
    utf8Encode(JSON.stringify(batch)),
    utf8Encode(`mailbox-batch-v1:${HH}:${keys.keyEpoch}`),
  );
}

describe('batch v2', () => {
  it('is version 2 and carries base64 fields plus the sender frontier', async () => {
    const a = await makeDevice('v2-a');
    await a.opLog.append({
      opId: createOpId(),
      authorMemberId: 'm-a',
      parents: [],
      opType: 'TEST',
      entityType: 'entity',
      entityId: 'e1',
      plaintextPayload: utf8Encode('{"n":1}'),
    });
    const ops = await a.store.listOperationsSince(HH, {});
    const sealed = sealOpBatch(
      {
        v: MAILBOX_BATCH_VERSION,
        householdId: HH,
        senderDeviceId: a.identity.deviceId,
        senderSigningPublicKeyB64: bytesToBase64(a.identity.signingPublicKey),
        senderVersionVector: await a.store.getVersionVector(HH),
        ops: ops.map((op) => ({
          ...op,
          payload: undefined,
          signature: undefined,
          payloadB64: bytesToBase64(op.payload),
          signatureB64: bytesToBase64(op.signature),
        })) as never,
      },
      keys.hdk,
      keys.keyEpoch,
    );
    const opened = openOpBatch(sealed, keys.hdk, HH, keys.keyEpoch);
    expect(opened.v).toBe(2);
    expect(opened.senderVersionVector).toEqual({ [a.identity.deviceId]: 1 });
    expect(opened.ops[0]!.payloadB64).toBeTypeOf('string');
  });

  it('raises UnsupportedBatchVersionError for a v1 batch', async () => {
    const a = await makeDevice('v1-sender');
    const ciphertext = sealV1(a.identity.deviceId, a.identity.signingPublicKey);
    expect(() => openOpBatch(ciphertext, keys.hdk, HH, keys.keyEpoch)).toThrow(
      UnsupportedBatchVersionError,
    );
  });

  it('counts an addressed v1 blob as rejected AND acks it, so it is not refetched', async () => {
    const sender = await makeDevice('v1-s');
    const me = await makeDevice('v1-me');
    const control = new MemoryControlPlaneClient();
    const blob = await control.depositMailbox({
      householdId: HH,
      recipientDeviceId: me.identity.deviceId,
      ciphertext: sealV1(sender.identity.deviceId, sender.identity.signingPublicKey),
    });

    const engine = engineFor(me, control, [sender.identity.deviceId]);
    const result = await engine.pullInbound();
    expect(result.rejected).toBe(1);
    expect(result.acked).toBe(1);
    expect(control.depositsFor(me.identity.deviceId).map((b) => b.blobId)).not.toContain(
      blob.blobId,
    );
  });

  it('does NOT ack a broadcast v1 blob — acking one recipient would destroy it for the rest', async () => {
    const sender = await makeDevice('v1-bs');
    const me = await makeDevice('v1-bme');
    const control = new MemoryControlPlaneClient();
    await control.depositMailbox({
      householdId: HH,
      ciphertext: sealV1(sender.identity.deviceId, sender.identity.signingPublicKey),
    });

    const engine = engineFor(me, control, [sender.identity.deviceId]);
    const result = await engine.pullInbound();
    expect(result.rejected).toBe(1);
    expect(result.acked).toBe(0);
  });

  it('a receipt batch (no ops) carries a version vector and disturbs no counters', async () => {
    const sender = await makeDevice('rcpt-s');
    const me = await makeDevice('rcpt-me');
    await sender.opLog.append({
      opId: createOpId(),
      authorMemberId: 'm-s',
      parents: [],
      opType: 'TEST',
      entityType: 'entity',
      entityId: 'e1',
      plaintextPayload: utf8Encode('{"n":1}'),
    });

    const control = new MemoryControlPlaneClient();
    const senderEngine = engineFor(sender, control, [me.identity.deviceId]);
    // Sender has ops the peer lacks, so this first push is a real batch.
    await senderEngine.pushOutbound();
    const meEngine = engineFor(me, control, [sender.identity.deviceId]);
    await meEngine.pullInbound();

    // Now `me` owes the sender nothing but its frontier moved: a receipt.
    control.resetCounters();
    const push = await meEngine.pushOutboundDetailed();
    expect(push.receipts).toBe(1);
    expect(control.wakeCount()).toBe(0);

    const receipt = control.depositsFor(sender.identity.deviceId).at(-1)!;
    const opened = openOpBatch(receipt.ciphertext, keys.hdk, HH, keys.keyEpoch);
    expect(opened.ops).toHaveLength(0);
    expect(opened.senderVersionVector).toEqual({ [sender.identity.deviceId]: 1 });

    const pulled = await senderEngine.pullInbound();
    expect(pulled.applied).toBe(0);
    expect(pulled.duplicates).toBe(0);
    expect(pulled.rejected).toBe(0);
  });
});
