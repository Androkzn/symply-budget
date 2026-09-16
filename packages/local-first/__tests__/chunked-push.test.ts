/**
 * The headline fix: a push is bounded by a cursor and split into chunks that
 * each fit the relay's per-deposit cap. Before Stage 1 the whole log went in one
 * blob and sync failed PERMANENTLY at ~466 ops, with every retry larger.
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_MAILBOX_CIPHERTEXT_B64,
  MailboxOpTooLargeError,
  MailboxSyncEngine,
  MemoryControlPlaneClient,
  MemoryLocalFirstStore,
  OpLog,
  base64Length,
  createOpId,
  generateDeviceIdentity,
  generateHouseholdKeys,
  utf8Encode,
  type DeviceId,
} from '../src/index';

const household = () => generateHouseholdKeys('hh-chunk');

/** ~155 B — a single-field edit, the corpus profile the audit measured. */
function payload(i: number): Uint8Array {
  return utf8Encode(
    JSON.stringify({
      table: 'expenses',
      id: `exp_${String(i).padStart(8, '0')}`,
      fields: { amount_minor: 1234 + i, note: 'coffee', updated_at: '2026-08-12T10:00:00.000Z' },
    }).padEnd(155, ' '),
  );
}

async function makeDevice(name: string, keys = household()) {
  const identity = generateDeviceIdentity(name);
  const store = new MemoryLocalFirstStore();
  await store.open(new Uint8Array(32).fill(8));
  const opLog = new OpLog({ store, identity, householdKeys: keys });
  return { identity, store, opLog, keys };
}

async function seed(opLog: OpLog, count: number, size = payload): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await opLog.append({
      opId: createOpId(),
      authorMemberId: 'm-a',
      parents: [],
      opType: 'EXPENSE_CREATE',
      entityType: 'expense',
      entityId: `exp-${i}`,
      plaintextPayload: size(i),
    });
  }
}

function engineFor(
  device: Awaited<ReturnType<typeof makeDevice>>,
  control: MemoryControlPlaneClient,
  peers: DeviceId[],
  pubMap: Map<string, Uint8Array>,
  nowMs?: () => number,
): MailboxSyncEngine {
  return new MailboxSyncEngine({
    store: device.store,
    opLog: device.opLog,
    householdKeys: device.keys,
    deviceId: device.identity.deviceId,
    signingPublicKey: device.identity.signingPublicKey,
    control,
    peerDeviceIds: peers,
    resolveSenderPublicKey: (id) => pubMap.get(id) ?? null,
    nowMs,
  });
}

describe('cursor-bounded chunked push', () => {
  it('ships 2,000 ops across chunks that each fit the cap, and the peer converges', async () => {
    const keys = household();
    const a = await makeDevice('dev-a', keys);
    const b = await makeDevice('dev-b', keys);
    await seed(a.opLog, 2_000);

    const control = new MemoryControlPlaneClient();
    const pubMap = new Map([
      [a.identity.deviceId, a.identity.signingPublicKey],
      [b.identity.deviceId, b.identity.signingPublicKey],
    ]);
    const engineA = engineFor(a, control, [b.identity.deviceId], pubMap);
    const engineB = engineFor(b, control, [a.identity.deviceId], pubMap);

    const deposited = await engineA.pushOutbound();
    expect(deposited).toBeGreaterThan(1);
    for (const blob of control.depositsFor(b.identity.deviceId)) {
      expect(base64Length(blob.ciphertext.length)).toBeLessThanOrEqual(
        MAX_MAILBOX_CIPHERTEXT_B64,
      );
    }

    const pull = await engineB.pullInbound();
    expect(pull.applied).toBe(2_000);
    expect(await b.store.getVersionVector(keys.householdId)).toEqual(
      await a.store.getVersionVector(keys.householdId),
    );
  }, 120_000);

  it('completes at 5,000 ops — the size that used to be a terminal failure', async () => {
    const keys = household();
    const a = await makeDevice('dev-a5', keys);
    const b = await makeDevice('dev-b5', keys);
    await seed(a.opLog, 5_000);

    const control = new MemoryControlPlaneClient();
    const pubMap = new Map([
      [a.identity.deviceId, a.identity.signingPublicKey],
      [b.identity.deviceId, b.identity.signingPublicKey],
    ]);
    const engineA = engineFor(a, control, [b.identity.deviceId], pubMap);
    const engineB = engineFor(b, control, [a.identity.deviceId], pubMap);

    // No throw: pre-Stage-1 this raised MailboxPayloadTooLargeError.
    const deposited = await engineA.pushOutbound();
    expect(deposited).toBeGreaterThan(1);
    for (const blob of control.depositsFor(b.identity.deviceId)) {
      expect(base64Length(blob.ciphertext.length)).toBeLessThanOrEqual(
        MAX_MAILBOX_CIPHERTEXT_B64,
      );
    }

    const pull = await engineB.pullInbound();
    expect(pull.applied).toBe(5_000);
  }, 300_000);

  it('only the LAST chunk carries a wake', async () => {
    const keys = household();
    const a = await makeDevice('dev-a-wake', keys);
    const b = await makeDevice('dev-b-wake', keys);
    await seed(a.opLog, 2_000);

    const control = new MemoryControlPlaneClient();
    const pubMap = new Map([[a.identity.deviceId, a.identity.signingPublicKey]]);
    const engineA = engineFor(a, control, [b.identity.deviceId], pubMap);

    const deposited = await engineA.pushOutbound();
    expect(deposited).toBeGreaterThan(1);
    expect(control.wakeCount()).toBe(1);
  }, 120_000);

  it('sends nothing on a second push, and exactly one op after one new edit', async () => {
    const keys = household();
    const a = await makeDevice('dev-a2', keys);
    const b = await makeDevice('dev-b2', keys);
    await seed(a.opLog, 40);

    const control = new MemoryControlPlaneClient();
    const pubMap = new Map([
      [a.identity.deviceId, a.identity.signingPublicKey],
      [b.identity.deviceId, b.identity.signingPublicKey],
    ]);
    let clock = 1_000_000;
    const engineA = engineFor(a, control, [b.identity.deviceId], pubMap, () => clock);

    expect(await engineA.pushOutbound()).toBe(1);
    control.resetCounters();

    // Nothing new, and nothing the peer is missing: no deposit at all.
    expect(await engineA.pushOutbound()).toBe(0);
    expect(control.depositCount()).toBe(0);

    // One new local op, past the debounce window.
    clock += 60_000;
    await seed(a.opLog, 1);
    control.resetCounters();
    expect(await engineA.pushOutbound()).toBe(1);

    const engineB = engineFor(b, control, [a.identity.deviceId], pubMap, () => clock);
    const pull = await engineB.pullInbound();
    // 40 from the first push, 1 from the second.
    expect(pull.applied).toBe(41);
  }, 60_000);

  it('raises MailboxOpTooLargeError rather than silently dropping a giant op', async () => {
    const keys = household();
    const a = await makeDevice('dev-a-big', keys);
    const b = await makeDevice('dev-b-big', keys);
    // One op whose sealed batch cannot fit a deposit even alone.
    await seed(a.opLog, 1, () => utf8Encode('x'.repeat(600_000)));

    const control = new MemoryControlPlaneClient();
    const pubMap = new Map([[a.identity.deviceId, a.identity.signingPublicKey]]);
    const engineA = engineFor(a, control, [b.identity.deviceId], pubMap);

    await expect(engineA.pushOutbound()).rejects.toBeInstanceOf(MailboxOpTooLargeError);
    // Nothing was deposited: the op is not silently lost, it is loudly refused.
    expect(control.depositCount()).toBe(0);
  }, 60_000);

  it('deposits nothing when there are no known peers', async () => {
    const keys = household();
    const a = await makeDevice('dev-lonely', keys);
    await seed(a.opLog, 10);
    const control = new MemoryControlPlaneClient();
    const engine = engineFor(a, control, [], new Map());
    expect(await engine.pushOutbound()).toBe(0);
    expect(control.depositCount()).toBe(0);
  });
});
