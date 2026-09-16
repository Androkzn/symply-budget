/**
 * `sentVv` is an OPTIMISTIC claim: "I deposited this, so assume the peer has
 * it." It is only ever safe while the blob that carried it is still on the
 * relay, which is why SENT_VV_TTL_MS (12 days) sits under the relay's 14-day
 * blob TTL.
 *
 * The trap: one `sentAtMs` covers the WHOLE vector, and re-stamping it on every
 * later deposit renews the trust window of entries that were never re-verified.
 * An entry written on day 1 then survives indefinitely — while the only copy of
 * its ops on the relay is swept on day 15. The receiver cannot object either:
 * `maybeSendReceipt` fires on the receiver's own frontier moving, and applying
 * ops ABOVE a hole moves it by exactly zero, so a device with a hole is the one
 * device in the protocol that is structurally silent.
 *
 * The anchor must therefore be the OLDEST unconfirmed deposit, never the newest.
 */
import { describe, expect, it } from 'vitest';

import {
  MailboxSyncEngine,
  MemoryControlPlaneClient,
  MemoryLocalFirstStore,
  OpLog,
  SENT_VV_TTL_MS,
  createOpId,
  generateDeviceIdentity,
  generateHouseholdKeys,
  utf8Encode,
  type DeviceId,
} from '../src/index';

const DAY = 24 * 3600_000;
const keys = generateHouseholdKeys('hh-sentvv');
const HH = keys.householdId;

async function makeDevice(name: string) {
  const identity = generateDeviceIdentity(name);
  const store = new MemoryLocalFirstStore();
  await store.open(new Uint8Array(32).fill(5));
  return { identity, store, opLog: new OpLog({ store, identity, householdKeys: keys }) };
}

type Device = Awaited<ReturnType<typeof makeDevice>>;

async function author(device: Device, tag: string): Promise<void> {
  await device.opLog.append({
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
  nowMs: () => number,
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
    nowMs,
  });
}

describe('optimistic sent-vector freshness', () => {
  it('does not renew the trust window of a deposit it never re-verified', async () => {
    const a = await makeDevice('anchor-a');
    const b = await makeDevice('anchor-b');
    let clock = 10 * DAY;
    const control = new MemoryControlPlaneClient({ nowMs: () => clock });
    const pubMap = new Map([[a.identity.deviceId, a.identity.signingPublicKey] as const]);
    const engineA = engineFor(a, control, [b.identity.deviceId], pubMap, () => clock);

    await author(a, 'first');
    expect(await engineA.pushOutbound()).toBe(1);
    const anchored = (await a.store.getSyncPeerState(HH, b.identity.deviceId))!;
    expect(anchored.sentAtMs).toBe(clock);

    // Five days later, a second, unrelated deposit. It says nothing whatever
    // about whether the FIRST one is still on the relay.
    clock += 5 * DAY;
    await author(a, 'second');
    expect(await engineA.pushOutbound()).toBe(1);
    const after = (await a.store.getSyncPeerState(HH, b.identity.deviceId))!;
    expect(after.sentAtMs).toBe(anchored.sentAtMs);
  });

  it('re-ships and heals rather than trusting a vector whose blob the relay swept', async () => {
    const a = await makeDevice('sweep-a');
    const b = await makeDevice('sweep-b');
    let clock = 0;
    const control = new MemoryControlPlaneClient({ nowMs: () => clock });
    const pubMap = new Map(
      [a, b].map((d) => [d.identity.deviceId, d.identity.signingPublicKey] as const),
    );
    const engineA = engineFor(a, control, [b.identity.deviceId], pubMap, () => clock);
    const engineB = engineFor(b, control, [a.identity.deviceId], pubMap, () => clock);

    // Day 0: both converged, and A has learned B's frontier from a real receipt.
    await author(a, 'day0');
    await engineA.pushOutbound();
    await engineB.syncOnce();
    await engineA.pullInbound();

    // B now goes away for a fortnight.
    clock = 1 * DAY;
    await author(a, 'day1');
    await engineA.pushOutbound();

    clock = 9 * DAY;
    await author(a, 'day9');
    await engineA.pushOutbound();

    // A keeps working while B is away. Every one of these deposits re-stamped
    // the single sentAtMs, which is what kept the day-1 entry "fresh" long after
    // the blob carrying it had been swept.
    const days = [13, 17, 21, 25, 29];
    for (const day of days) {
      clock = day * DAY;
      await author(a, `day${day}`);
      await engineA.pushOutbound();
    }

    // The day-1 blob died on day 15 (relay TTL), inside the 12-day window that
    // the refreshed stamp kept alive.
    expect(SENT_VV_TTL_MS).toBeLessThan(14 * DAY);

    clock = 30 * DAY;
    await engineB.pullInbound();

    const held = await b.store.listOperationsSince(HH, {});
    const entities = held.map((op) => op.entityId).sort();
    // Was: e-day1, e-day9 and e-day13 permanently and silently missing — their
    // blobs were swept while A went on believing they had been delivered.
    expect(entities).toEqual(
      ['e-day0', 'e-day1', 'e-day9', ...days.map((day) => `e-day${day}`)].sort(),
    );
    expect(await b.store.getVersionVector(HH)).toEqual(
      await a.store.getVersionVector(HH),
    );
  }, 60_000);
});
