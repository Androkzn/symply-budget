/**
 * `seq` must be scoped to (household, device), not to the device alone.
 *
 * Joining a household replaces the LEDGER but not the STORE
 * (engine.ts adoptJoinedHousehold), so a joiner's pre-join ops keep sitting in
 * lf_operations under the same device_id. With a device-global seq space the
 * joiner's first op in the new household starts at n+1, leaving a permanent
 * 1..n hole that a contiguous watermark can never cross — that author's entire
 * history would be resent on every sync, forever. And with the old
 * UNIQUE(device_id, seq) index, restarting at 1 is rejected outright.
 */
import { describe, expect, it } from 'vitest';

import {
  MemoryLocalFirstStore,
  OpLog,
  SqliteLocalFirstStore,
  createOpId,
  generateDeviceIdentity,
  generateHouseholdKeys,
  utf8Encode,
  type LocalFirstStore,
} from '../src/index';

import { createFakeSqliteDriver } from './helpers/fake-sqlite-driver';

const stores: Array<[string, () => Promise<LocalFirstStore>]> = [
  [
    'memory',
    async () => {
      const store = new MemoryLocalFirstStore();
      await store.open(new Uint8Array(32).fill(4));
      return store;
    },
  ],
  [
    'sqlite',
    async () => {
      const store = new SqliteLocalFirstStore(createFakeSqliteDriver());
      await store.open(new Uint8Array(32).fill(4));
      return store;
    },
  ],
];

async function appendN(log: OpLog, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await log.append({
      opId: createOpId(),
      authorMemberId: 'm-1',
      parents: [],
      opType: 'EXPENSE_CREATE',
      entityType: 'expense',
      entityId: `e-${i}`,
      plaintextPayload: utf8Encode(`{"i":${i}}`),
    });
  }
}

describe.each(stores)('household-scoped seq (%s)', (_label, open) => {
  it('restarts at 1 in a joined household and leaves no hole', async () => {
    const store = await open();
    const identity = generateDeviceIdentity('dev-joiner');
    const privateHousehold = generateHouseholdKeys('hh-private');
    const sharedHousehold = generateHouseholdKeys('hh-shared');

    // Life before enrolment: a private "household of one".
    const before = new OpLog({ store, identity, householdKeys: privateHousehold });
    await appendN(before, 3);
    expect(await store.getVersionVector('hh-private')).toEqual({ 'dev-joiner': 3 });

    // adoptJoinedHousehold rebinds the OpLog; the store keeps the old rows.
    expect(await store.nextSeq('hh-shared', identity.deviceId)).toBe(1);

    const after = new OpLog({ store, identity, householdKeys: sharedHousehold });
    // Under UNIQUE(device_id, seq) this very first append would be rejected.
    await appendN(after, 2);

    const shared = await store.listOperationsSince('hh-shared', {});
    expect(shared.map((o) => o.seq)).toEqual([1, 2]);
    // A dense prefix from 1 — nothing for a peer to wait on forever.
    expect(await store.getVersionVector('hh-shared')).toEqual({ 'dev-joiner': 2 });
    // The private household is untouched and still independently addressed.
    expect(await store.getVersionVector('hh-private')).toEqual({ 'dev-joiner': 3 });
  });

  it('still rejects a duplicate seq WITHIN one household', async () => {
    const store = await open();
    const base = {
      householdId: 'hh-dup',
      deviceId: 'dev-dup',
      authorMemberId: 'm1',
      parentsJson: '[]',
      opType: 'TEST',
      entityType: 'entity',
      entityId: 'e1',
      payload: new Uint8Array([1]),
      keyEpoch: 1,
      signature: new Uint8Array(64).fill(2),
      appliedAt: 0,
    };
    await store.insertOperation({ ...base, opId: 'o1', hlc: 'h1', seq: 1 });
    await expect(
      store.insertOperation({ ...base, opId: 'o2', hlc: 'h2', seq: 1 }),
    ).rejects.toThrow(/duplicate device seq/);
  });
});
