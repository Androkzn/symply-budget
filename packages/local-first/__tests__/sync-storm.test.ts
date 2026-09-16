/**
 * Storm control.
 *
 * Before Stage 1 every deposit woke all peers, each of which unconditionally
 * re-deposited its FULL log, which woke the sender again: no dirty flag, no
 * debounce, no per-peer sent watermark. The gate added here is deliberately
 * comparative and per-peer rather than a "did I author something" flag, because
 * that flag is false for an idle owner and would starve a peer that just joined.
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

const keys = generateHouseholdKeys('hh-storm');
const HH = keys.householdId;

async function makeDevice(name: string) {
  const identity = generateDeviceIdentity(name);
  const store = new MemoryLocalFirstStore();
  await store.open(new Uint8Array(32).fill(6));
  const opLog = new OpLog({ store, identity, householdKeys: keys });
  return { identity, store, opLog };
}

type Device = Awaited<ReturnType<typeof makeDevice>>;

async function author(device: Device, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await device.opLog.append({
      opId: createOpId(),
      authorMemberId: `m-${device.identity.deviceId}`,
      parents: [],
      opType: 'EXPENSE_CREATE',
      entityType: 'expense',
      entityId: `e-${device.identity.deviceId}-${i}`,
      plaintextPayload: utf8Encode(`{"i":${i}}`),
    });
  }
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

describe('storm control', () => {
  it('goes completely quiet once three devices have converged', async () => {
    const a = await makeDevice('storm-a');
    const b = await makeDevice('storm-b');
    const c = await makeDevice('storm-c');
    await author(a, 3);
    await author(b, 2);

    const control = new MemoryControlPlaneClient();
    const pubMap = new Map(
      [a, b, c].map((d) => [d.identity.deviceId, d.identity.signingPublicKey] as const),
    );
    let clock = 1_000_000;
    const ids = [a, b, c].map((d) => d.identity.deviceId);
    const engines = [a, b, c].map((device, i) =>
      engineFor(
        device,
        control,
        ids.filter((_, j) => j !== i),
        pubMap,
        () => clock,
      ),
    );

    // Converge. Each round is well past the debounce, so quiet has to come from
    // the cursor, not from the timer.
    for (let round = 0; round < 8; round += 1) {
      clock += 60_000;
      for (const engine of engines) await engine.syncOnce();
    }
    for (const device of [a, b, c]) {
      expect(await device.store.listOperationsSince(HH, {})).toHaveLength(5);
    }

    control.resetCounters();
    for (let round = 0; round < 3; round += 1) {
      clock += 60_000;
      for (const engine of engines) await engine.syncOnce();
    }
    // Was: three full op logs deposited per round, each waking every peer.
    expect(control.depositCount()).toBe(0);
    expect(control.wakeCount()).toBe(0);
  }, 60_000);

  it('does NOT starve a newly joined peer, even when the owner has been idle for a week', async () => {
    // The exact case a naive "am I dirty" flag gets wrong: A authored nothing
    // recently, so a local-authorship flag is false — yet C has nothing at all.
    const a = await makeDevice('idle-a');
    const b = await makeDevice('idle-b');
    await author(a, 5);

    const control = new MemoryControlPlaneClient();
    const pubMap = new Map(
      [a, b].map((d) => [d.identity.deviceId, d.identity.signingPublicKey] as const),
    );
    let clock = 1_000_000;
    const engineA = engineFor(a, control, [b.identity.deviceId], pubMap, () => clock);
    const engineB = engineFor(b, control, [a.identity.deviceId], pubMap, () => clock);
    await engineA.pushOutbound();
    await engineB.pullInbound();
    await engineB.pushOutbound();
    await engineA.pullInbound();

    // A week passes with no local authorship at all.
    clock += 7 * 24 * 3600_000;

    const c = await makeDevice('idle-c');
    pubMap.set(c.identity.deviceId, c.identity.signingPublicKey);
    const engineAWithC = engineFor(
      a,
      control,
      [b.identity.deviceId, c.identity.deviceId],
      pubMap,
      () => clock,
    );
    control.resetCounters();
    expect(await engineAWithC.pushOutbound()).toBeGreaterThan(0);

    const engineC = engineFor(c, control, [a.identity.deviceId], pubMap, () => clock);
    const pull = await engineC.pullInbound();
    expect(pull.applied).toBe(5);
    // B, which already has everything, was not deposited to.
    expect(control.depositsFor(b.identity.deviceId)).toHaveLength(0);
  }, 60_000);

  it('a read-only peer teaches its version vector by receipt, and is not resent to', async () => {
    const a = await makeDevice('ro-a');
    const b = await makeDevice('ro-b'); // never authors anything
    await author(a, 4);

    const control = new MemoryControlPlaneClient();
    const pubMap = new Map(
      [a, b].map((d) => [d.identity.deviceId, d.identity.signingPublicKey] as const),
    );
    let clock = 1_000_000;
    const engineA = engineFor(a, control, [b.identity.deviceId], pubMap, () => clock);
    const engineB = engineFor(b, control, [a.identity.deviceId], pubMap, () => clock);

    expect(await engineA.pushOutbound()).toBe(1);
    await engineB.pullInbound();

    // B owes A nothing, but its frontier moved — so it publishes a receipt.
    clock += 60_000;
    const bPush = await engineB.pushOutboundDetailed();
    expect(bPush.receipts).toBe(1);
    expect(bPush.pushedOps).toBe(0);

    // A learns B's frontier from that receipt and stops resending.
    await engineA.pullInbound();
    control.resetCounters();
    clock += 60_000;
    expect(await engineA.pushOutbound()).toBe(0);
    // ...and B does not keep republishing the same receipt.
    expect(await engineB.pushOutbound()).toBe(0);
    expect(control.depositCount()).toBe(0);
  }, 60_000);

  it('receipts do not ping-pong: at most one each, then silence', async () => {
    const a = await makeDevice('pp-a');
    const b = await makeDevice('pp-b');
    await author(a, 1);
    await author(b, 1);

    const control = new MemoryControlPlaneClient();
    const pubMap = new Map(
      [a, b].map((d) => [d.identity.deviceId, d.identity.signingPublicKey] as const),
    );
    let clock = 1_000_000;
    const engineA = engineFor(a, control, [b.identity.deviceId], pubMap, () => clock);
    const engineB = engineFor(b, control, [a.identity.deviceId], pubMap, () => clock);

    for (let round = 0; round < 6; round += 1) {
      clock += 60_000;
      await engineA.syncOnce();
      await engineB.syncOnce();
    }
    control.resetCounters();
    for (let round = 0; round < 4; round += 1) {
      clock += 60_000;
      await engineA.syncOnce();
      await engineB.syncOnce();
    }
    expect(control.depositCount()).toBe(0);
  }, 60_000);

  it('debounces a repeat push, but never one to a peer with an unknown frontier', async () => {
    const a = await makeDevice('db-a');
    const b = await makeDevice('db-b');
    await author(a, 3);

    const control = new MemoryControlPlaneClient();
    const pubMap = new Map(
      [a, b].map((d) => [d.identity.deviceId, d.identity.signingPublicKey] as const),
    );
    let clock = 1_000_000;
    const engineA = engineFor(a, control, [b.identity.deviceId], pubMap, () => clock);
    expect(await engineA.pushOutbound()).toBe(1);

    // An op relayed from a third author, sitting ABOVE a gap: permanently
    // uncovered by any contiguous watermark, so the store stays "dirty" for B
    // forever. Without a debounce this would redeposit on every single sync.
    const orphan: StoredOperation = {
      opId: 'orphan-1',
      householdId: HH,
      deviceId: 'dev-x',
      authorMemberId: 'm-x',
      hlc: '000000000009999-0000-devx',
      seq: 2,
      parentsJson: '[]',
      opType: 'TEST',
      entityType: 'entity',
      entityId: 'e-x',
      payload: new Uint8Array([9]),
      keyEpoch: keys.keyEpoch,
      signature: new Uint8Array(64).fill(1),
      appliedAt: 0,
    };
    await a.store.insertOperation(orphan);

    control.resetCounters();
    clock += 1_000; // inside MIN_PUSH_INTERVAL_MS
    const gated = await engineA.pushOutboundDetailed();
    expect(gated.skippedPeers).toBe(1);
    expect(gated.deposited).toBe(0);

    // A brand-new peer is never gated: its frontier is unknown, and an unknown
    // frontier can never be covered.
    const c = await makeDevice('db-c');
    pubMap.set(c.identity.deviceId, c.identity.signingPublicKey);
    const engineAWithC = engineFor(
      a,
      control,
      [b.identity.deviceId, c.identity.deviceId],
      pubMap,
      () => clock,
    );
    const withNewPeer = await engineAWithC.pushOutboundDetailed();
    expect(withNewPeer.skippedPeers).toBe(1); // still B
    expect(control.depositsFor(c.identity.deviceId).length).toBeGreaterThan(0);

    // Past the window, B is served again.
    clock += 60_000;
    control.resetCounters();
    const later = await engineA.pushOutboundDetailed();
    expect(later.skippedPeers).toBe(0);
    expect(later.deposited).toBe(1);
  }, 60_000);
});
