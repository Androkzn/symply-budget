import { describe, expect, it } from 'vitest';

import { MemoryLocalFirstStore, SqliteLocalFirstStore, createOpId } from '../src/index';
import type { StoredOperation } from '../src/store/types';

import { createFakeSqliteDriver } from './helpers/fake-sqlite-driver';

const HH = 'hh-compact';

function op(deviceId: string, seq: number): StoredOperation {
  return {
    opId: createOpId(),
    householdId: HH,
    deviceId,
    authorMemberId: 'm',
    hlc: `${String(seq).padStart(15, '0')}-0000-${deviceId.slice(0, 8)}`,
    seq,
    parentsJson: '[]',
    opType: 'X',
    entityType: 'row',
    entityId: `e-${seq}`,
    payload: new Uint8Array([1]),
    keyEpoch: 1,
    signature: new Uint8Array(64),
    appliedAt: 1,
  };
}

describe('compactOperations', () => {
  it('drops ops at or below the retain watermark and keeps nextSeq', async () => {
    const memory = new MemoryLocalFirstStore();
    await memory.open(new Uint8Array(32));
    for (let seq = 1; seq <= 10; seq += 1) {
      await memory.insertOperation(op('A', seq));
    }
    expect(await memory.nextSeq(HH, 'A')).toBe(11);
    const removed = await memory.compactOperations(HH, { A: 7 });
    expect(removed).toBe(7);
    expect(await memory.listOperationsSince(HH, {})).toHaveLength(3);
    expect(await memory.nextSeq(HH, 'A')).toBe(11);

    const sqlite = new SqliteLocalFirstStore(createFakeSqliteDriver());
    await sqlite.open(new Uint8Array(32));
    for (let seq = 1; seq <= 10; seq += 1) {
      await sqlite.insertOperation(op('A', seq));
    }
    expect(await sqlite.nextSeq(HH, 'A')).toBe(11);
    expect(await sqlite.compactOperations(HH, { A: 7 })).toBe(7);
    expect(await sqlite.listOperationsSince(HH, {})).toHaveLength(3);
    expect(await sqlite.nextSeq(HH, 'A')).toBe(11);
  });
});
