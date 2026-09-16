/**
 * Two ways a pull can destroy or strand mail.
 *
 * 1. ACK. A blob was acked after processing whatever `applied.status` was, while
 *    the sender's cursor had already advanced past those ops. Before Stage 1 the
 *    sender re-shipped its whole log every sync, so a rejection got a fresh
 *    attempt for ever; the cursor removed that safety net without replacing it,
 *    which left every op with exactly ONE delivery attempt — and a rejection
 *    destroyed the relay copy. The rejections that matter are environmental, not
 *    malicious: a key epoch that is briefly out of step, a session closed
 *    mid-pull, an author whose public key this device cannot resolve yet.
 *
 * 2. PAGING. The loop re-requested the same oldest rows every page and relied on
 *    ack to move the window. Broadcast blobs are deliberately never acked, so
 *    one page's worth of them makes page 2 identical to page 1 and everything
 *    behind them is undeliverable for the full 14-day TTL. Those blobs exist:
 *    the pre-Stage-1 push broadcast the whole log whenever it had no peer ids.
 */
import { describe, expect, it } from 'vitest';

import {
  MailboxSyncEngine,
  MemoryControlPlaneClient,
  MemoryLocalFirstStore,
  OpLog,
  createOpId,
  generateDeviceIdentity,
  generateHouseholdKeys,
  utf8Encode,
  type DeviceId,
  type StoredOperation,
} from '../src/index';

const keys = generateHouseholdKeys('hh-inbound');
const HH = keys.householdId;

async function makeDevice(name: string) {
  const identity = generateDeviceIdentity(name);
  const store = new MemoryLocalFirstStore();
  await store.open(new Uint8Array(32).fill(3));
  return { identity, store, opLog: new OpLog({ store, identity, householdKeys: keys }) };
}

type Device = Awaited<ReturnType<typeof makeDevice>>;

async function author(device: Device, tag: string): Promise<StoredOperation> {
  return device.opLog.append({
    opId: createOpId(),
    authorMemberId: `m-${device.identity.deviceId}`,
    parents: [],
    opType: 'EXPENSE_CREATE',
    entityType: 'expense',
    entityId: `e-${tag}`,
    plaintextPayload: utf8Encode(`{"tag":"${tag}"}`),
  });
}

function engineFor(
  device: Device,
  control: MemoryControlPlaneClient,
  peers: DeviceId[],
  pubMap: Map<string, Uint8Array>,
): MailboxSyncEngine {
  return new MailboxSyncEngine({
    store: device.store,
    opLog: device.opLog,
    householdKeys: keys,
    deviceId: device.identity.deviceId,
    signingPublicKey: device.identity.signingPublicKey,
    control,
    peerDeviceIds: peers,
    resolveSenderPublicKey: (id) => pubMap.get(id) ?? null,
  });
}

describe('ack is not an unconditional receipt', () => {
  it('keeps a blob whose ops were rejected for a retryable reason', async () => {
    const a = await makeDevice('ack-a');
    const b = await makeDevice('ack-b');
    const control = new MemoryControlPlaneClient();
    const pubMap = new Map(
      [a, b].map((d) => [d.identity.deviceId, d.identity.signingPublicKey] as const),
    );

    // An op sealed under the NEXT key epoch: exactly what a device mid-rotation
    // ships, and `applyRemote` answers key_epoch_mismatch.
    const op = await author(a, 'rotating');
    const rotated: StoredOperation = { ...op, opId: 'rotated-op', seq: 2, keyEpoch: op.keyEpoch + 1 };
    await a.store.insertOperation(rotated);

    const engineA = engineFor(a, control, [b.identity.deviceId], pubMap);
    const engineB = engineFor(b, control, [a.identity.deviceId], pubMap);
    await engineA.pushOutbound();

    const pull = await engineB.pullInbound();
    expect(pull.rejected).toBe(1);
    expect(pull.acked).toBe(0);
    // Still on the relay, so the next sync — after the epochs agree again — can
    // deliver it. Was: acked and swept, with the sender's cursor already past it.
    expect(control.depositsFor(b.identity.deviceId)).toHaveLength(1);
  }, 60_000);

  it('keeps a blob relaying an author whose key this device cannot resolve', async () => {
    const a = await makeDevice('relay-a');
    const b = await makeDevice('relay-b');
    const c = await makeDevice('relay-c');
    const control = new MemoryControlPlaneClient();

    const fromC = await author(c, 'third-party');
    await a.store.insertOperation(fromC);

    // B knows A but has never seen C's registration.
    const pubMapA = new Map(
      [a, b, c].map((d) => [d.identity.deviceId, d.identity.signingPublicKey] as const),
    );
    const pubMapB = new Map([[a.identity.deviceId, a.identity.signingPublicKey] as const]);

    const engineA = engineFor(a, control, [b.identity.deviceId], pubMapA);
    const engineB = engineFor(b, control, [a.identity.deviceId], pubMapB);
    await engineA.pushOutbound();

    const pull = await engineB.pullInbound();
    expect(pull.applied).toBe(0);
    expect(pull.rejected).toBe(1);
    // Was: verified against the RELAYING device's key, which cannot possibly
    // match, then acked — so C's op died on a mailbox B could not read yet.
    expect(pull.acked).toBe(0);
    expect(control.depositsFor(b.identity.deviceId)).toHaveLength(1);
  }, 60_000);

  it('still acks a blob that applied cleanly', async () => {
    const a = await makeDevice('clean-a');
    const b = await makeDevice('clean-b');
    const control = new MemoryControlPlaneClient();
    const pubMap = new Map(
      [a, b].map((d) => [d.identity.deviceId, d.identity.signingPublicKey] as const),
    );
    await author(a, 'clean');
    await engineFor(a, control, [b.identity.deviceId], pubMap).pushOutbound();

    const pull = await engineFor(b, control, [a.identity.deviceId], pubMap).pullInbound();
    expect(pull.applied).toBe(1);
    expect(pull.acked).toBe(1);
    expect(control.depositsFor(b.identity.deviceId)).toHaveLength(0);
  }, 60_000);
});

describe('paged pull advances on a server cursor', () => {
  it('delivers mail sitting behind a full page of unackable broadcast blobs', async () => {
    const a = await makeDevice('page-a');
    const b = await makeDevice('page-b');
    const control = new MemoryControlPlaneClient();
    const pubMap = new Map(
      [a, b].map((d) => [d.identity.deviceId, d.identity.signingPublicKey] as const),
    );

    // Exactly what the pre-Stage-1 broadcast push left in real mailboxes: v1
    // blobs addressed to nobody, undecryptable and — by design — unackable.
    for (let i = 0; i < 25; i += 1) {
      await control.depositMailbox({
        householdId: HH,
        ciphertext: new Uint8Array(48).fill(i + 1),
        wake: false,
      });
    }

    await author(a, 'behind-the-wall');
    await engineFor(a, control, [b.identity.deviceId], pubMap).pushOutbound();

    const pull = await engineFor(b, control, [a.identity.deviceId], pubMap).pullInbound();
    // Was: {applied: 0, rejected: 25, pages: 2} — page 2 was byte-for-byte page 1.
    expect(pull.applied).toBe(1);
    expect(pull.rejected).toBe(25);
    expect(await b.store.listOperationsSince(HH, {})).toHaveLength(1);
  }, 60_000);
});
