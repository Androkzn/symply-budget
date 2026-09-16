import { describe, expect, it } from 'vitest';

import {
  ALWAYS_RESIDENT_BUCKET,
  SqliteLocalFirstStore,
  openRowBody,
  rowAad,
  sealRowBody,
  utf8Decode,
  utf8Encode,
} from '../src/index';

import { createFakeSqliteDriver } from './helpers/fake-sqlite-driver';

describe('Stage 2 row store', () => {
  it('round-trips a sealed row across close/reopen', async () => {
    const driver = createFakeSqliteDriver();
    const dek = new Uint8Array(32).fill(9);
    const store = new SqliteLocalFirstStore(driver);
    await store.open(dek);

    const envelope = { row: { id: 'exp-1', amount: 4200 }, lww: { f: { amount: 'hlc-1' } } };
    const sealed = sealRowBody(
      dek,
      utf8Encode(JSON.stringify(envelope)),
      rowAad('hh-1', 'expenses', 'exp-1', 1),
    );
    await store.putRows([
      {
        householdId: 'hh-1',
        table: 'expenses',
        rowKey: 'exp-1',
        bucket: '2026-08',
        deleted: false,
        nonce: sealed.nonce,
        ciphertext: sealed.ciphertext,
        keyEpoch: 1,
        updatedHlc: 'hlc-1',
      },
    ]);
    await store.close();

    const reopened = new SqliteLocalFirstStore(driver);
    await reopened.open(dek);
    const rows = await reopened.listRows({ householdId: 'hh-1' });
    expect(rows).toHaveLength(1);
    const opened = openRowBody(
      dek,
      rows[0]!.nonce,
      rows[0]!.ciphertext,
      rowAad('hh-1', 'expenses', 'exp-1', 1),
    );
    expect(JSON.parse(utf8Decode(opened))).toEqual(envelope);
  });

  it('keeps tombstones when windowing by bucket', async () => {
    const driver = createFakeSqliteDriver();
    const store = new SqliteLocalFirstStore(driver);
    await store.open(new Uint8Array(32).fill(1));
    const nonce = new Uint8Array(12);
    const ciphertext = new Uint8Array(20);
    await store.putRows([
      {
        householdId: 'hh',
        table: 'expenses',
        rowKey: 'old',
        bucket: '2020-01',
        deleted: false,
        nonce,
        ciphertext,
        keyEpoch: 1,
        updatedHlc: 'a',
      },
      {
        householdId: 'hh',
        table: 'expenses',
        rowKey: 'tomb',
        bucket: '2020-01',
        deleted: true,
        nonce,
        ciphertext,
        keyEpoch: 1,
        updatedHlc: 'b',
      },
      {
        householdId: 'hh',
        table: 'categories',
        rowKey: 'cat',
        bucket: ALWAYS_RESIDENT_BUCKET,
        deleted: false,
        nonce,
        ciphertext,
        keyEpoch: 1,
        updatedHlc: 'c',
      },
      {
        householdId: 'hh',
        table: 'expenses',
        rowKey: 'now',
        bucket: '2026-08',
        deleted: false,
        nonce,
        ciphertext,
        keyEpoch: 1,
        updatedHlc: 'd',
      },
    ]);

    const windowed = await store.listRows({ householdId: 'hh', buckets: ['2026-08'] });
    const keys = windowed.map((row) => row.rowKey).sort();
    expect(keys).toEqual(['cat', 'now', 'tomb']);
  });

  it('replays ops with null projected_at and skips stamped ones', async () => {
    const driver = createFakeSqliteDriver();
    const store = new SqliteLocalFirstStore(driver);
    await store.open(new Uint8Array(32).fill(2));
    const op = {
      opId: 'op-1',
      householdId: 'hh',
      deviceId: 'dev',
      authorMemberId: 'm1',
      hlc: '000000000000001-0001-dev',
      seq: 1,
      parentsJson: '[]',
      opType: 'TEST',
      entityType: 'expense',
      entityId: 'e1',
      payload: new Uint8Array([1]),
      keyEpoch: 1,
      signature: new Uint8Array(64),
      appliedAt: 1,
    };
    expect(await store.insertOperation(op)).toBe('inserted');
    expect(await store.listUnprojectedOperations('hh')).toHaveLength(1);
    await store.markProjected(['op-1'], 99);
    expect(await store.listUnprojectedOperations('hh')).toHaveLength(0);
  });
});
