import { describe, expect, it } from 'vitest';

import {
  OpLog,
  SqliteLocalFirstStore,
  createOpId,
  generateDeviceIdentity,
  generateHouseholdKeys,
  utf8Encode,
} from '../src/index';

import { createFakeSqliteDriver } from './helpers/fake-sqlite-driver';

describe('SqliteLocalFirstStore', () => {
  it('persists operations across close and reopen', async () => {
    const driver = createFakeSqliteDriver();
    const dbKey = new Uint8Array(32).fill(9);
    const identity = generateDeviceIdentity('dev-sqlite');
    const household = generateHouseholdKeys('hh-sqlite');

    const store = new SqliteLocalFirstStore(driver);
    await store.open(dbKey);
    const log = new OpLog({ store, identity, householdKeys: household });

    const opId = createOpId();
    const stored = await log.append({
      opId,
      authorMemberId: 'member-1',
      parents: [],
      opType: 'EXPENSE_CREATE',
      entityType: 'expense',
      entityId: 'exp-1',
      plaintextPayload: utf8Encode('{"amount":4200}'),
    });

    expect(await store.hasOperation(opId)).toBe(true);
    expect(await store.nextSeq(household.householdId, identity.deviceId)).toBe(stored.seq + 1);
    await store.close();

    const reopened = new SqliteLocalFirstStore(driver);
    await reopened.open(dbKey);
    const listed = await reopened.listOperationsByHlc(household.householdId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.opId).toBe(opId);
    expect(listed[0]?.payload.byteLength).toBeGreaterThan(0);
  });

  it('rejects duplicate device seq and accepts duplicate op id', async () => {
    const driver = createFakeSqliteDriver();
    const store = new SqliteLocalFirstStore(driver);
    await store.open(new Uint8Array(32).fill(1));

    const op = {
      opId: createOpId(),
      householdId: 'hh-dup',
      deviceId: 'dev-dup',
      authorMemberId: 'm1',
      hlc: '2026-08-10T12:00:00.000Z:1',
      seq: 1,
      parentsJson: '[]',
      opType: 'TEST',
      entityType: 'entity',
      entityId: 'e1',
      payload: new Uint8Array([1, 2, 3]),
      keyEpoch: 1,
      signature: new Uint8Array(64).fill(7),
      appliedAt: Date.now(),
    };

    expect(await store.insertOperation(op)).toBe('inserted');
    expect(await store.insertOperation(op)).toBe('duplicate');

    await expect(
      store.insertOperation({ ...op, opId: createOpId(), seq: 1 }),
    ).rejects.toThrow(/duplicate device seq/);
  });

  it('tracks projection cursors in sqlite', async () => {
    const driver = createFakeSqliteDriver();
    const store = new SqliteLocalFirstStore(driver);
    const identity = generateDeviceIdentity('dev-cursor-sqlite');
    const household = generateHouseholdKeys('hh-cursor-sqlite');
    await store.open(new Uint8Array(32).fill(2));

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
});
