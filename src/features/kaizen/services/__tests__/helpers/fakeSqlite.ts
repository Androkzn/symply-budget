/**
 * In-memory fake of the tiny slice of expo-sqlite the Kaizen services use.
 *
 * NOT a test file (no `it()`), so Jest's testMatch (`*.test`/`*.spec`) skips it.
 * It understands only the exact SQL statements emitted by database.ts /
 * repository.ts / streak.ts, backing rows with plain JS arrays keyed per table so
 * suites can assert what was written and read.
 */

export type FakeRow = Record<string, unknown>;

class FakeDb {
  tables = new Map<string, FakeRow[]>();
  execLog: string[] = [];

  reset(): void {
    this.tables.clear();
    this.execLog = [];
  }

  rows(table: string): FakeRow[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table) as FakeRow[];
  }

  seed(table: string, rows: FakeRow[]): void {
    this.tables.set(table, rows.map(r => ({ ...r })));
  }

  async execAsync(sql: string): Promise<void> {
    this.execLog.push(sql);
  }

  async runAsync(sql: string, params: unknown[] = []): Promise<{ changes: number; lastInsertRowId: number }> {
    const s = sql.trim().replace(/\s+/g, ' ');
    let m: RegExpExecArray | null;

    if ((m = /^INSERT INTO (\w+)\s*\(([^)]+)\)\s*VALUES/i.exec(s))) {
      const table = m[1];
      const cols = m[2].split(',').map(c => c.trim());
      const row: FakeRow = {};
      cols.forEach((c, i) => {
        row[c] = params[i];
      });
      const conflictKey = /ON CONFLICT\(key\)/i.test(s) ? 'key' : 'id';
      const rows = this.rows(table);
      const idx = rows.findIndex(r => r[conflictKey] === row[conflictKey]);
      if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
      else rows.push(row);
      return { changes: 1, lastInsertRowId: 0 };
    }

    if ((m = /^UPDATE (\w+) SET dirty = 0 WHERE user_id = \? AND dirty = 1/i.exec(s))) {
      const table = m[1];
      const [userId] = params;
      let changes = 0;
      for (const r of this.rows(table)) {
        if (r.user_id === userId && Number(r.dirty) === 1) {
          r.dirty = 0;
          changes += 1;
        }
      }
      return { changes, lastInsertRowId: 0 };
    }

    if ((m = /^UPDATE (\w+) SET deleted_at = \?, updated_at = \?, dirty = 1 WHERE user_id = \? AND deleted_at IS NULL AND id IN \(([^)]*)\)/i.exec(s))) {
      const table = m[1];
      const [deletedAt, updatedAt, userId, ...ids] = params;
      let changes = 0;
      for (const r of this.rows(table)) {
        if (r.user_id === userId && r.deleted_at == null && ids.includes(r.id)) {
          r.deleted_at = deletedAt;
          r.updated_at = updatedAt;
          r.dirty = 1;
          changes += 1;
        }
      }
      return { changes, lastInsertRowId: 0 };
    }

    if ((m = /^UPDATE (\w+) SET deleted_at = \?, updated_at = \?, dirty = 1 WHERE id = \?/i.exec(s))) {
      const table = m[1];
      const [deletedAt, updatedAt, id] = params;
      let changes = 0;
      for (const r of this.rows(table)) {
        if (r.id === id) {
          r.deleted_at = deletedAt;
          r.updated_at = updatedAt;
          r.dirty = 1;
          changes += 1;
        }
      }
      return { changes, lastInsertRowId: 0 };
    }

    throw new Error(`FakeDb.runAsync: unhandled SQL: ${s}`);
  }

  async getFirstAsync<T = FakeRow>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.getAllAsync<T>(sql, params);
    return rows[0] ?? null;
  }

  async getAllAsync<T = FakeRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    const s = sql.trim().replace(/\s+/g, ' ');
    let m: RegExpExecArray | null;

    // meta select
    if (/^SELECT value FROM kaizen_meta WHERE key = \?/i.test(s)) {
      const [key] = params;
      const row = this.rows('kaizen_meta').find(r => r.key === key);
      return (row ? [{ value: row.value }] : []) as unknown as T[];
    }

    // streak aggregation over action logs
    if (/FROM kaizen_action_logs/i.test(s) && /GROUP BY date/i.test(s)) {
      const [userId] = params;
      const logs = this.rows('kaizen_action_logs').filter(
        r => r.user_id === userId && r.deleted_at == null,
      );
      const byDate = new Map<string, number>();
      for (const r of logs) {
        const done = Number(r.skipped) === 0 && r.completed_at != null ? 1 : 0;
        byDate.set(String(r.date), (byDate.get(String(r.date)) ?? 0) + done);
      }
      return [...byDate.entries()]
        .filter(([, done]) => done > 0)
        .map(([date, done]) => ({ date, done }))
        .sort((a, b) => (a.date < b.date ? 1 : -1)) as unknown as T[];
    }

    // daily-core actions
    if ((m = /^SELECT \* FROM (\w+) WHERE user_id = \? AND deleted_at IS NULL AND is_archived = 0 AND is_daily_core = 1/i.exec(s))) {
      const table = m[1];
      const [userId] = params;
      return this.rows(table)
        .filter(
          r =>
            r.user_id === userId &&
            r.deleted_at == null &&
            Number(r.is_archived) === 0 &&
            Number(r.is_daily_core) === 1,
        )
        .sort(
          (a, b) =>
            Number(a.sort_order) - Number(b.sort_order) ||
            String(a.title).localeCompare(String(b.title)),
        ) as unknown as T[];
    }

    // dirty rows
    if ((m = /^SELECT \* FROM (\w+) WHERE user_id = \? AND dirty = 1/i.exec(s))) {
      const table = m[1];
      const [userId] = params;
      return this.rows(table).filter(
        r => r.user_id === userId && Number(r.dirty) === 1,
      ) as unknown as T[];
    }

    // active rows
    if ((m = /^SELECT \* FROM (\w+) WHERE user_id = \? AND deleted_at IS NULL ORDER BY updated_at DESC/i.exec(s))) {
      const table = m[1];
      const [userId] = params;
      return this.rows(table)
        .filter(r => r.user_id === userId && r.deleted_at == null)
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))) as unknown as T[];
    }

    throw new Error(`FakeDb.getAllAsync: unhandled SQL: ${s}`);
  }
}

const singleton = new FakeDb();

export function getFakeDb(): FakeDb {
  return singleton;
}

/** Clears rows/log in place so the memoized db object identity stays stable. */
export function resetFakeDb(): void {
  singleton.reset();
}

/** Factory for `jest.mock('expo-sqlite', () => require('.../fakeSqlite').createExpoSqliteMock())`. */
export function createExpoSqliteMock(): { openDatabaseAsync: jest.Mock } {
  return {
    openDatabaseAsync: jest.fn(async () => getFakeDb()),
  };
}
