import { env } from 'cloudflare:test';
import { describe, expect, it, beforeEach } from 'vitest';

import { TIMESTAMP_BACKFILL_ENABLED_KEY } from '../../services/config-flags';
import type { Env } from '../../types';
import {
  runTimestampBackfillChunk,
  isLegacySqliteDatetime,
  legacyDatetimeToIso,
  APPROVED_BACKFILL_TABLES,
} from '../timestamp-backfill-stub';

const testEnv = env as unknown as Env;

const CHECKPOINTS_DDL = `CREATE TABLE IF NOT EXISTS timestamp_backfill_checkpoints (
  table_name TEXT PRIMARY KEY,
  last_row_id TEXT,
  rows_updated INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const HOUSEHOLD_SPACES_DDL = `CREATE TABLE IF NOT EXISTS household_spaces (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  name TEXT NOT NULL,
  space_type TEXT NOT NULL DEFAULT 'custom',
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
)`;

async function seedCheckpoints(): Promise<void> {
  for (const { tableName } of APPROVED_BACKFILL_TABLES) {
    await testEnv.DB.prepare(
      `INSERT OR IGNORE INTO timestamp_backfill_checkpoints (table_name, notes)
       VALUES (?, 'test')`
    )
      .bind(tableName)
      .run();
  }
}

async function setupBackfillSchema(): Promise<void> {
  await testEnv.DB.prepare(CHECKPOINTS_DDL).run();
  await testEnv.DB.prepare(HOUSEHOLD_SPACES_DDL).run();
  await testEnv.DB.prepare('DELETE FROM timestamp_backfill_checkpoints').run();
  await testEnv.DB.prepare('DELETE FROM household_spaces').run();
  await seedCheckpoints();
}

describe('legacy datetime helpers', () => {
  it('detects SQLite datetime shape', () => {
    expect(isLegacySqliteDatetime('2024-06-01 12:30:45')).toBe(true);
    expect(isLegacySqliteDatetime('2024-06-01T12:30:45.000Z')).toBe(false);
    expect(isLegacySqliteDatetime(null)).toBe(false);
    expect(isLegacySqliteDatetime('')).toBe(false);
  });

  it('rewrites legacy values to canonical ISO UTC', () => {
    expect(legacyDatetimeToIso('2024-06-01 12:30:45')).toBe('2024-06-01T12:30:45.000Z');
  });
});

describe('runTimestampBackfillChunk', () => {
  beforeEach(async () => {
    await testEnv.CONFIG_KV.delete(TIMESTAMP_BACKFILL_ENABLED_KEY);
    await setupBackfillSchema();
  });

  it('skips when CONFIG_KV flag is off (default)', async () => {
    const result = await runTimestampBackfillChunk(testEnv);
    expect(result.skipped).toBe(true);
    if (result.skipped) {
      expect(result.reason).toContain('flag is off');
    }
  });

  it('converts legacy household_spaces timestamps in a batch', async () => {
    await testEnv.CONFIG_KV.put(TIMESTAMP_BACKFILL_ENABLED_KEY, 'true');

    await testEnv.DB.prepare(
      `INSERT INTO household_spaces (id, household_id, name, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind('sp1', 'hh1', 'Kitchen', '2024-01-02 08:00:00', '2024-01-03 09:00:00', '2024-01-04 10:00:00')
      .run();

    await testEnv.DB.prepare(
      `INSERT INTO household_spaces (id, household_id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind('sp2', 'hh1', 'Garage', '2024-02-02 08:00:00', '2024-02-02T08:00:00.000Z')
      .run();

    const result = await runTimestampBackfillChunk(testEnv, { batchSize: 10 });
    expect(result).toEqual({ skipped: false, rowsUpdated: 2, tableName: 'household_spaces' });

    const sp1 = await testEnv.DB.prepare(
      'SELECT created_at, updated_at, deleted_at FROM household_spaces WHERE id = ?'
    )
      .bind('sp1')
      .first<{ created_at: string; updated_at: string; deleted_at: string }>();

    expect(sp1?.created_at).toBe('2024-01-02T08:00:00.000Z');
    expect(sp1?.updated_at).toBe('2024-01-03T09:00:00.000Z');
    expect(sp1?.deleted_at).toBe('2024-01-04T10:00:00.000Z');

    const sp2 = await testEnv.DB.prepare(
      'SELECT created_at, updated_at FROM household_spaces WHERE id = ?'
    )
      .bind('sp2')
      .first<{ created_at: string; updated_at: string }>();

    expect(sp2?.created_at).toBe('2024-02-02T08:00:00.000Z');
    expect(sp2?.updated_at).toBe('2024-02-02T08:00:00.000Z');

    const checkpoint = await testEnv.DB.prepare(
      `SELECT last_row_id, rows_updated, completed_at FROM timestamp_backfill_checkpoints WHERE table_name = ?`
    )
      .bind('household_spaces')
      .first<{ last_row_id: string; rows_updated: number; completed_at: string | null }>();

    expect(checkpoint?.last_row_id).toBe('sp2');
    expect(checkpoint?.rows_updated).toBe(2);
    expect(checkpoint?.completed_at).not.toBeNull();
  });

  it('respects batch size and advances checkpoint without completing early', async () => {
    await testEnv.CONFIG_KV.put(TIMESTAMP_BACKFILL_ENABLED_KEY, 'true');

    for (const id of ['a', 'b', 'c']) {
      await testEnv.DB.prepare(
        `INSERT INTO household_spaces (id, household_id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
        .bind(id, 'hh1', id, '2024-03-01 10:00:00', '2024-03-01 10:00:00')
        .run();
    }

    const first = await runTimestampBackfillChunk(testEnv, { batchSize: 2 });
    expect(first).toEqual({ skipped: false, rowsUpdated: 2, tableName: 'household_spaces' });

    const midCheckpoint = await testEnv.DB.prepare(
      `SELECT last_row_id, completed_at FROM timestamp_backfill_checkpoints WHERE table_name = ?`
    )
      .bind('household_spaces')
      .first<{ last_row_id: string; completed_at: string | null }>();

    expect(midCheckpoint?.last_row_id).toBe('b');
    expect(midCheckpoint?.completed_at).toBeNull();

    const second = await runTimestampBackfillChunk(testEnv, { batchSize: 2 });
    expect(second).toEqual({ skipped: false, rowsUpdated: 1, tableName: 'household_spaces' });

    const doneCheckpoint = await testEnv.DB.prepare(
      `SELECT last_row_id, completed_at FROM timestamp_backfill_checkpoints WHERE table_name = ?`
    )
      .bind('household_spaces')
      .first<{ last_row_id: string; completed_at: string | null }>();

    expect(doneCheckpoint?.last_row_id).toBe('c');
    expect(doneCheckpoint?.completed_at).not.toBeNull();
  });
});
