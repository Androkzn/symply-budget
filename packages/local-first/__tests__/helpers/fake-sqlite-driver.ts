/**
 * In-memory SqliteDriver for `@symply/local-first` unit tests.
 * Handles only the SQL emitted by `SqliteLocalFirstStore`.
 */

import type { SqliteDriver } from '../../src/store/sqlite-driver';

type Row = Record<string, unknown>;

export class FakeSqliteDriver implements SqliteDriver {
  private readonly tables = new Map<string, Row[]>();

  reset(): void {
    this.tables.clear();
  }

  /** Simulate a database written before a table existed. */
  dropTable(name: string): void {
    this.tables.delete(name);
  }

  private rows(table: string): Row[] {
    if (!this.tables.has(table)) {
      this.tables.set(table, []);
    }
    return this.tables.get(table) as Row[];
  }

  async execAsync(sql: string): Promise<void> {
    for (const statement of sql.split(';')) {
      // Strip SQL comments so a commented-out CREATE cannot register a table.
      const trimmed = statement
        .split('\n')
        .map((line) => line.replace(/--.*$/, ''))
        .join('\n')
        .trim();
      if (!trimmed) continue;
      if (/^ALTER TABLE /i.test(trimmed)) continue;
      const match = /^CREATE TABLE IF NOT EXISTS (\w+)/i.exec(trimmed);
      if (match) {
        this.rows(match[1]);
      }
      // CREATE INDEX / DROP INDEX are no-ops here; the UNIQUE constraint they
      // declare is enforced explicitly in the lf_operations insert path below,
      // so a test can actually observe what the real database enforces.
    }
  }

  async runAsync(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ changes: number; lastInsertRowId: number }> {
    const s = sql.trim().replace(/\s+/g, ' ');

    let m = /^INSERT INTO lf_meta \(key, value\) VALUES \(\?, \?\) ON CONFLICT\(key\) DO UPDATE SET value = excluded\.value/i.exec(
      s,
    );
    if (m) {
      const [key, value] = params;
      const table = this.rows('lf_meta');
      const idx = table.findIndex((row) => row.key === key);
      if (idx >= 0) table[idx] = { key, value };
      else table.push({ key, value });
      return { changes: 1, lastInsertRowId: 0 };
    }

    m =
      /^INSERT INTO lf_operations \( op_id, household_id, device_id, author_member_id, hlc, seq, parents, op_type, entity_type, entity_id, payload, key_epoch, signature, applied_at \) VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?\)/i.exec(
        s,
      );
    if (m) {
      const [
        op_id,
        household_id,
        device_id,
        author_member_id,
        hlc,
        seq,
        parents,
        op_type,
        entity_type,
        entity_id,
        payload,
        key_epoch,
        signature,
        applied_at,
      ] = params;
      // UNIQUE(household_id, device_id, seq) — the real index, enforced here so
      // the joiner case is observable in a test.
      const clash = this.rows('lf_operations').some(
        (r) =>
          r.household_id === household_id && r.device_id === device_id && r.seq === seq,
      );
      if (clash) {
        throw new Error(
          `FakeSqliteDriver: UNIQUE constraint failed: lf_operations.household_id, lf_operations.device_id, lf_operations.seq`,
        );
      }
      this.rows('lf_operations').push({
        op_id,
        household_id,
        device_id,
        author_member_id,
        hlc,
        seq,
        parents,
        op_type,
        entity_type,
        entity_id,
        payload,
        key_epoch,
        signature,
        applied_at,
      });
      return { changes: 1, lastInsertRowId: 0 };
    }

    m =
      /^INSERT INTO lf_projection_cursors \(entity_type, entity_id, last_op_id\) VALUES \(\?, \?, \?\) ON CONFLICT\(entity_type, entity_id\) DO UPDATE SET last_op_id = excluded\.last_op_id/i.exec(
        s,
      );
    if (m) {
      const [entity_type, entity_id, last_op_id] = params;
      const table = this.rows('lf_projection_cursors');
      const idx = table.findIndex(
        (row) => row.entity_type === entity_type && row.entity_id === entity_id,
      );
      if (idx >= 0) table[idx] = { entity_type, entity_id, last_op_id };
      else table.push({ entity_type, entity_id, last_op_id });
      return { changes: 1, lastInsertRowId: 0 };
    }

    m =
      /^INSERT INTO lf_op_frontier \(household_id, device_id, contiguous_seq\) VALUES \(\?, \?, \?\) ON CONFLICT\(household_id, device_id\) DO UPDATE SET contiguous_seq = excluded\.contiguous_seq/i.exec(
        s,
      );
    if (m) {
      const [household_id, device_id, contiguous_seq] = params;
      const table = this.rows('lf_op_frontier');
      const idx = table.findIndex(
        (row) => row.household_id === household_id && row.device_id === device_id,
      );
      if (idx >= 0) table[idx] = { household_id, device_id, contiguous_seq };
      else table.push({ household_id, device_id, contiguous_seq });
      return { changes: 1, lastInsertRowId: 0 };
    }

    m =
      /^INSERT INTO lf_sync_peers \( household_id, peer_device_id, known_vv, sent_vv, sent_at, last_push_at, last_receipt_vv \) VALUES \(\?, \?, \?, \?, \?, \?, \?\) ON CONFLICT\(household_id, peer_device_id\) DO UPDATE SET/i.exec(
        s,
      );
    if (m) {
      const [
        household_id,
        peer_device_id,
        known_vv,
        sent_vv,
        sent_at,
        last_push_at,
        last_receipt_vv,
      ] = params;
      const row = {
        household_id,
        peer_device_id,
        known_vv,
        sent_vv,
        sent_at,
        last_push_at,
        last_receipt_vv,
      };
      const table = this.rows('lf_sync_peers');
      const idx = table.findIndex(
        (r) => r.household_id === household_id && r.peer_device_id === peer_device_id,
      );
      if (idx >= 0) table[idx] = row;
      else table.push(row);
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (/^DELETE FROM lf_sync_peers WHERE household_id = \?/i.test(s)) {
      const [household_id] = params;
      const table = this.rows('lf_sync_peers');
      const kept = table.filter((r) => r.household_id !== household_id);
      const removed = table.length - kept.length;
      this.tables.set('lf_sync_peers', kept);
      return { changes: removed, lastInsertRowId: 0 };
    }

    m =
      /^INSERT INTO lf_rows \( household_id, tbl, row_key, bucket, deleted, nonce, ciphertext, key_epoch, updated_hlc \) VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?\) ON CONFLICT\(household_id, tbl, row_key\) DO UPDATE SET/i.exec(
        s,
      );
    if (m) {
      const [
        household_id,
        tbl,
        row_key,
        bucket,
        deleted,
        nonce,
        ciphertext,
        key_epoch,
        updated_hlc,
      ] = params;
      const row = {
        household_id,
        tbl,
        row_key,
        bucket,
        deleted,
        nonce,
        ciphertext,
        key_epoch,
        updated_hlc,
      };
      const table = this.rows('lf_rows');
      const idx = table.findIndex(
        (r) =>
          r.household_id === household_id && r.tbl === tbl && r.row_key === row_key,
      );
      if (idx >= 0) table[idx] = row;
      else table.push(row);
      return { changes: 1, lastInsertRowId: 0 };
    }

    if (/^DELETE FROM lf_rows WHERE household_id = \?/i.test(s)) {
      const [household_id] = params;
      const table = this.rows('lf_rows');
      const kept = table.filter((r) => r.household_id !== household_id);
      const removed = table.length - kept.length;
      this.tables.set('lf_rows', kept);
      return { changes: removed, lastInsertRowId: 0 };
    }

    if (
      /^DELETE FROM lf_operations WHERE household_id = \? AND device_id = \? AND seq <= \?/i.test(s)
    ) {
      const [household_id, device_id, seq] = params;
      const table = this.rows('lf_operations');
      const kept = table.filter(
        (r) =>
          !(
            r.household_id === household_id &&
            r.device_id === device_id &&
            Number(r.seq) <= Number(seq)
          ),
      );
      const removed = table.length - kept.length;
      this.tables.set('lf_operations', kept);
      return { changes: removed, lastInsertRowId: 0 };
    }

    if (
      /^UPDATE lf_operations SET projected_at = \? WHERE op_id = \? AND projected_at IS NULL/i.test(
        s,
      )
    ) {
      const [projected_at, op_id] = params;
      const table = this.rows('lf_operations');
      const row = table.find((r) => r.op_id === op_id);
      if (!row || row.projected_at != null) return { changes: 0, lastInsertRowId: 0 };
      row.projected_at = projected_at;
      return { changes: 1, lastInsertRowId: 0 };
    }

    throw new Error(`FakeSqliteDriver.runAsync: unhandled SQL: ${s}`);
  }

  async getFirstAsync<T = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.getAllAsync<T>(sql, params);
    return rows[0] ?? null;
  }

  async getAllAsync<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const s = sql.trim().replace(/\s+/g, ' ');

    if (/^SELECT value FROM lf_meta WHERE key = \?/i.test(s)) {
      const [key] = params;
      const row = this.rows('lf_meta').find((r) => r.key === key);
      return (row ? [{ value: row.value }] : []) as unknown as T[];
    }

    if (/^SELECT 1 AS one FROM lf_operations WHERE op_id = \? LIMIT 1/i.test(s)) {
      const [opId] = params;
      const found = this.rows('lf_operations').some((r) => r.op_id === opId);
      return (found ? [{ one: 1 }] : []) as unknown as T[];
    }

    if (
      /^SELECT seq FROM lf_operations WHERE household_id = \? AND device_id = \? AND seq = \? LIMIT 1/i.test(
        s,
      )
    ) {
      const [householdId, deviceId, seq] = params;
      const row = this.rows('lf_operations').find(
        (r) => r.household_id === householdId && r.device_id === deviceId && r.seq === seq,
      );
      return (row ? [{ seq: row.seq }] : []) as unknown as T[];
    }

    if (
      /^SELECT 1 AS one FROM lf_operations WHERE household_id = \? AND device_id = \? AND seq = \? LIMIT 1/i.test(
        s,
      )
    ) {
      const [householdId, deviceId, seq] = params;
      const found = this.rows('lf_operations').some(
        (r) => r.household_id === householdId && r.device_id === deviceId && r.seq === seq,
      );
      return (found ? [{ one: 1 }] : []) as unknown as T[];
    }

    if (
      /^SELECT MAX\(seq\) AS max_seq FROM lf_operations WHERE household_id = \? AND device_id = \?/i.test(
        s,
      )
    ) {
      const [householdId, deviceId] = params;
      const seqs = this.rows('lf_operations')
        .filter((r) => r.household_id === householdId && r.device_id === deviceId)
        .map((r) => Number(r.seq));
      const max = seqs.length ? Math.max(...seqs) : null;
      return [{ max_seq: max }] as unknown as T[];
    }

    if (
      /^SELECT MIN\(seq\) AS min_seq FROM lf_operations WHERE household_id = \? AND device_id = \?/i.test(
        s,
      )
    ) {
      const [householdId, deviceId] = params;
      const seqs = this.rows('lf_operations')
        .filter((r) => r.household_id === householdId && r.device_id === deviceId)
        .map((r) => Number(r.seq));
      const min = seqs.length ? Math.min(...seqs) : null;
      return [{ min_seq: min }] as unknown as T[];
    }

    if (/^SELECT 1 AS one FROM lf_op_frontier LIMIT 1/i.test(s)) {
      const found = this.rows('lf_op_frontier').length > 0;
      return (found ? [{ one: 1 }] : []) as unknown as T[];
    }

    if (
      /^SELECT household_id, device_id, seq FROM lf_operations ORDER BY household_id ASC, device_id ASC, seq ASC/i.test(
        s,
      )
    ) {
      return this.rows('lf_operations')
        .map((r) => ({ household_id: r.household_id, device_id: r.device_id, seq: r.seq }))
        .sort(
          (a, b) =>
            String(a.household_id).localeCompare(String(b.household_id)) ||
            String(a.device_id).localeCompare(String(b.device_id)) ||
            Number(a.seq) - Number(b.seq),
        ) as unknown as T[];
    }

    if (
      /^SELECT contiguous_seq FROM lf_op_frontier WHERE household_id = \? AND device_id = \?/i.test(
        s,
      )
    ) {
      const [householdId, deviceId] = params;
      const row = this.rows('lf_op_frontier').find(
        (r) => r.household_id === householdId && r.device_id === deviceId,
      );
      return (row ? [{ contiguous_seq: row.contiguous_seq }] : []) as unknown as T[];
    }

    if (
      /^SELECT device_id, contiguous_seq FROM lf_op_frontier WHERE household_id = \?/i.test(s)
    ) {
      const [householdId] = params;
      return this.rows('lf_op_frontier')
        .filter((r) => r.household_id === householdId)
        .map((r) => ({ device_id: r.device_id, contiguous_seq: r.contiguous_seq })) as unknown as T[];
    }

    if (/^SELECT \* FROM lf_sync_peers WHERE household_id = \? AND peer_device_id = \?/i.test(s)) {
      const [householdId, peerDeviceId] = params;
      const row = this.rows('lf_sync_peers').find(
        (r) => r.household_id === householdId && r.peer_device_id === peerDeviceId,
      );
      return (row ? [row] : []) as unknown as T[];
    }

    if (/^SELECT \* FROM lf_sync_peers WHERE household_id = \?/i.test(s)) {
      const [householdId] = params;
      return this.rows('lf_sync_peers').filter(
        (r) => r.household_id === householdId,
      ) as unknown as T[];
    }

    if (
      /^SELECT last_op_id FROM lf_projection_cursors WHERE entity_type = \? AND entity_id = \?/i.test(
        s,
      )
    ) {
      const [entityType, entityId] = params;
      const row = this.rows('lf_projection_cursors').find(
        (r) => r.entity_type === entityType && r.entity_id === entityId,
      );
      return (row ? [{ last_op_id: row.last_op_id }] : []) as unknown as T[];
    }

    if (
      /^SELECT op_id, household_id, device_id, author_member_id, hlc, seq, parents, op_type, entity_type, entity_id, payload, key_epoch, signature, applied_at FROM lf_operations WHERE op_id = \?/i.test(
        s,
      )
    ) {
      const [opId] = params;
      const row = this.rows('lf_operations').find((r) => r.op_id === opId);
      return (row ? [row] : []) as unknown as T[];
    }

    if (
      /^SELECT op_id, household_id, device_id, author_member_id, hlc, seq, parents, op_type, entity_type, entity_id, payload, key_epoch, signature, applied_at FROM lf_operations WHERE household_id = \? ORDER BY hlc ASC$/i.test(
        s,
      )
    ) {
      const [householdId] = params;
      return this.rows('lf_operations')
        .filter((r) => r.household_id === householdId)
        .sort((a, b) => String(a.hlc).localeCompare(String(b.hlc))) as unknown as T[];
    }

    if (
      /^SELECT op_id, household_id, device_id, author_member_id, hlc, seq, parents, op_type, entity_type, entity_id, payload, key_epoch, signature, applied_at FROM lf_operations WHERE household_id = \? AND hlc > \? ORDER BY hlc ASC$/i.test(
        s,
      )
    ) {
      const [householdId, afterHlc] = params;
      return this.rows('lf_operations')
        .filter((r) => r.household_id === householdId && String(r.hlc) > String(afterHlc))
        .sort((a, b) => String(a.hlc).localeCompare(String(b.hlc))) as unknown as T[];
    }

    if (
      /^SELECT household_id, tbl, row_key, bucket, deleted, nonce, ciphertext, key_epoch, updated_hlc FROM lf_rows WHERE household_id = \?/i.test(
        s,
      )
    ) {
      const [householdId] = params;
      let rows = this.rows('lf_rows').filter((r) => r.household_id === householdId);
      if (/deleted = 1 OR bucket = \? OR bucket IN/i.test(s)) {
        const always = params[1];
        const windowBuckets = new Set(params.slice(2).map(String));
        rows = rows.filter(
          (r) =>
            Number(r.deleted) === 1 ||
            r.bucket === always ||
            windowBuckets.has(String(r.bucket)),
        );
      }
      return rows as unknown as T[];
    }

    if (
      /^SELECT op_id, household_id, device_id, author_member_id, hlc, seq, parents, op_type, entity_type, entity_id, payload, key_epoch, signature, applied_at FROM lf_operations WHERE household_id = \? AND projected_at IS NULL ORDER BY hlc ASC, device_id ASC, seq ASC$/i.test(
        s,
      )
    ) {
      const [householdId] = params;
      return this.rows('lf_operations')
        .filter((r) => r.household_id === householdId && r.projected_at == null)
        .sort(
          (a, b) =>
            String(a.hlc).localeCompare(String(b.hlc)) ||
            String(a.device_id).localeCompare(String(b.device_id)) ||
            Number(a.seq) - Number(b.seq),
        ) as unknown as T[];
    }

    const since = matchSinceClause(s, params);
    if (since) {
      const rows = this.rows('lf_operations')
        .filter(since.predicate)
        .sort(
          (a, b) =>
            String(a.hlc).localeCompare(String(b.hlc)) ||
            String(a.device_id).localeCompare(String(b.device_id)) ||
            Number(a.seq) - Number(b.seq),
        );
      const limited = since.limit === null ? rows : rows.slice(0, since.limit);
      if (since.projection === 'one') {
        return limited.slice(0, 1).map(() => ({ one: 1 })) as unknown as T[];
      }
      if (since.projection === 'count') {
        return [{ n: limited.length }] as unknown as T[];
      }
      return limited as unknown as T[];
    }

    throw new Error(`FakeSqliteDriver.getAllAsync: unhandled SQL: ${s}`);
  }
}

/**
 * `listOperationsSince` / `hasOperationsSince` build their WHERE clause from the
 * caller's version vector, so the shape is dynamic and cannot be matched by a
 * literal regex — the predicate is reconstructed from the parameter list
 * instead, in exactly the order sqlite-store.ts binds it.
 */
function matchSinceClause(
  s: string,
  params: unknown[],
): {
  predicate: (row: Row) => boolean;
  limit: number | null;
  projection: 'row' | 'one' | 'count';
} | null {
  const head =
    /^SELECT (1 AS one|COUNT\(\*\) AS n|op_id, household_id, device_id, author_member_id, hlc, seq, parents, op_type, entity_type, entity_id, payload, key_epoch, signature, applied_at) FROM lf_operations WHERE household_id = \?(.*)$/i.exec(
      s,
    );
  if (!head) return null;
  const projection =
    head[1] === '1 AS one' ? 'one' : head[1] === 'COUNT(*) AS n' ? 'count' : 'row';
  const tail = head[2] ?? '';

  const pairCount = (tail.match(/\(device_id = \? AND seq > \?\)/g) ?? []).length;
  const notIn = /device_id NOT IN \(([^)]*)\)/i.exec(tail);
  const notInCount = notIn ? (notIn[1]!.match(/\?/g) ?? []).length : 0;
  const hasLimit = /LIMIT \?/i.test(tail);
  const hasOrder = /ORDER BY hlc ASC, device_id ASC, seq ASC/i.test(tail);
  if (projection === 'row' && !hasOrder) return null;

  let i = 0;
  const householdId = params[i++];
  const bounds = new Map<string, number>();
  for (let p = 0; p < pairCount; p += 1) {
    const device = String(params[i++]);
    bounds.set(device, Number(params[i++]));
  }
  const known = new Set<string>();
  for (let p = 0; p < notInCount; p += 1) known.add(String(params[i++]));
  const limit = hasLimit ? Number(params[i++]) : null;

  return {
    projection,
    limit,
    predicate: (row: Row) => {
      if (row.household_id !== householdId) return false;
      if (pairCount === 0 && notInCount === 0) return true;
      const device = String(row.device_id);
      if (bounds.has(device)) return Number(row.seq) > (bounds.get(device) as number);
      return !known.has(device);
    },
  };
}

export function createFakeSqliteDriver(): FakeSqliteDriver {
  return new FakeSqliteDriver();
}
