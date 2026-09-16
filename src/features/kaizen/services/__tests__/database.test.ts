import * as SQLite from 'expo-sqlite';

import {
  assertKaizenTable,
  getKaizenDatabase,
  getMeta,
  setMeta,
} from '../database';

import { getFakeDb, resetFakeDb } from './helpers/fakeSqlite';


jest.mock('expo-sqlite', () => require('./helpers/fakeSqlite').createExpoSqliteMock());

describe('kaizen database', () => {
  beforeEach(() => {
    resetFakeDb();
    (SQLite.openDatabaseAsync as jest.Mock).mockClear();
  });

  it('opens the brand-scoped db and runs the schema on first access', async () => {
    const db = await getKaizenDatabase();

    expect(SQLite.openDatabaseAsync).toHaveBeenCalledWith('symply-life.db');
    expect(db).toBe(getFakeDb());
    const log = getFakeDb().execLog.join('\n');
    expect(log).toMatch(/PRAGMA journal_mode = WAL/);
    expect(log).toMatch(/CREATE TABLE IF NOT EXISTS kaizen_actions/);
  });

  it('memoizes the database connection (opens once)', async () => {
    const a = await getKaizenDatabase();
    const b = await getKaizenDatabase();
    expect(a).toBe(b);
    // First test already opened it; the connection is cached module-wide.
    expect(SQLite.openDatabaseAsync).not.toHaveBeenCalled();
  });

  it('round-trips meta values and upserts on conflict', async () => {
    await setMeta('last_sync_at', '2026-07-10T00:00:00.000Z');
    expect(await getMeta('last_sync_at')).toBe('2026-07-10T00:00:00.000Z');

    await setMeta('last_sync_at', '2026-07-11T00:00:00.000Z');
    expect(await getMeta('last_sync_at')).toBe('2026-07-11T00:00:00.000Z');
    expect(getFakeDb().rows('kaizen_meta')).toHaveLength(1);
  });

  it('returns null for a missing meta key', async () => {
    expect(await getMeta('does-not-exist')).toBeNull();
  });

  it('asserts known Kaizen tables and rejects unknown ones', () => {
    expect(() => assertKaizenTable('kaizen_actions')).not.toThrow();
    expect(() => assertKaizenTable('kaizen_profiles')).not.toThrow();
    expect(() => assertKaizenTable('not_a_table')).toThrow(/Unknown Kaizen table/);
  });
});
