import type { Bytes, DeviceId, HouseholdId, OpId } from '../types';

import type { SqliteDriver } from './sqlite-driver';
import {
  ALWAYS_RESIDENT_BUCKET,
  SQLITE_MIGRATION_V1,
  SQLITE_MIGRATION_V2,
  type LocalFirstStore,
  type RowBucketCount,
  type RowKeyRef,
  type RowLoadQuery,
  type StoredOperation,
  type StoredRowRecord,
  type SyncPeerState,
  type VersionVector,
} from './types';

const OP_COLUMNS = `op_id, household_id, device_id, author_member_id, hlc, seq, parents,
              op_type, entity_type, entity_id, payload, key_epoch, signature, applied_at`;

/**
 * Row keys bound per `IN (…)` statement. SQLITE_MAX_VARIABLE_NUMBER is 999 on
 * the oldest builds still shipping; 200 leaves headroom for the two leading
 * parameters and for a future column without re-deriving this.
 */
const ROW_KEY_CHUNK = 200;

type OperationRow = {
  op_id: string;
  household_id: string;
  device_id: string;
  author_member_id: string;
  hlc: string;
  seq: number;
  parents: string | null;
  op_type: string;
  entity_type: string;
  entity_id: string;
  payload: Uint8Array | ArrayBuffer;
  key_epoch: number;
  signature: Uint8Array | ArrayBuffer;
  applied_at: number;
};

type RowTableRow = {
  household_id: string;
  tbl: string;
  row_key: string;
  bucket: string;
  deleted: number;
  nonce: Uint8Array | ArrayBuffer;
  ciphertext: Uint8Array | ArrayBuffer;
  key_epoch: number;
  updated_hlc: string;
};

/**
 * Durable SQLite-backed LocalFirstStore.
 *
 * Ops journal + meta + projection rows live in SQLite (`SQLITE_MIGRATION_V1`).
 * Payload/signature bytes are already AEAD ciphertext under HDK at the op layer.
 * Projection bodies are per-row AEAD under the device DEK (passed to `open`).
 * True SQLCipher page encryption remains a follow-up.
 */
export class SqliteLocalFirstStore implements LocalFirstStore {
  private openFlag = false;
  private txnDepth = 0;

  constructor(private readonly driver: SqliteDriver) {}

  async open(_localDatabaseKey: Bytes): Promise<void> {
    await this.driver.execAsync(SQLITE_MIGRATION_V1);
    try {
      await this.driver.execAsync(SQLITE_MIGRATION_V2);
    } catch {
      // Column already exists on databases created with V1 that included it.
    }
    this.openFlag = true;
    await this.rebuildFrontierIfEmpty();
  }

  /**
   * One-shot frontier reconstruction for a database written before the frontier
   * table existed (every dev phone and E2E simulator). Idempotent and cheap;
   * without it the first sync after upgrading would resend the whole log once.
   */
  private async rebuildFrontierIfEmpty(): Promise<void> {
    const seeded = await this.driver.getFirstAsync<{ one: number }>(
      'SELECT 1 AS one FROM lf_op_frontier LIMIT 1',
      [],
    );
    if (seeded) return;
    const rows = await this.driver.getAllAsync<{
      household_id: string;
      device_id: string;
      seq: number;
    }>(
      `SELECT household_id, device_id, seq FROM lf_operations
       ORDER BY household_id ASC, device_id ASC, seq ASC`,
      [],
    );
    if (rows.length === 0) return;

    let key = '';
    let contiguous = 0;
    let householdId = '';
    let deviceId = '';
    const flush = async () => {
      if (key && contiguous > 0) {
        await this.writeFrontier(householdId, deviceId, contiguous);
      }
    };
    for (const row of rows) {
      const rowKey = `${row.household_id} ${row.device_id}`;
      if (rowKey !== key) {
        await flush();
        key = rowKey;
        householdId = row.household_id;
        deviceId = row.device_id;
        contiguous = 0;
      }
      if (Number(row.seq) === contiguous + 1) contiguous += 1;
    }
    await flush();
  }

  async close(): Promise<void> {
    this.openFlag = false;
    await this.driver.closeAsync?.();
  }

  isOpen(): boolean {
    return this.openFlag;
  }

  private assertOpen(): void {
    if (!this.openFlag) {
      throw new Error('SqliteLocalFirstStore: not open');
    }
  }

  async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    this.assertOpen();
    if (this.txnDepth > 0 || !this.driver.withTransactionAsync) {
      return work();
    }
    this.txnDepth += 1;
    try {
      let result: T | undefined;
      await this.driver.withTransactionAsync(async () => {
        result = await work();
      });
      return result as T;
    } finally {
      this.txnDepth -= 1;
    }
  }

  async getMeta(key: string): Promise<string | null> {
    this.assertOpen();
    const row = await this.driver.getFirstAsync<{ value: string }>(
      'SELECT value FROM lf_meta WHERE key = ?',
      [key],
    );
    return row?.value ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    this.assertOpen();
    await this.driver.runAsync(
      `INSERT INTO lf_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  }

  async getOperation(opId: OpId): Promise<StoredOperation | null> {
    this.assertOpen();
    const row = await this.driver.getFirstAsync<OperationRow>(
      `SELECT op_id, household_id, device_id, author_member_id, hlc, seq, parents,
              op_type, entity_type, entity_id, payload, key_epoch, signature, applied_at
       FROM lf_operations WHERE op_id = ?`,
      [opId],
    );
    return row ? rowToOp(row) : null;
  }

  async hasOperation(opId: OpId): Promise<boolean> {
    this.assertOpen();
    const row = await this.driver.getFirstAsync<{ one: number }>(
      'SELECT 1 AS one FROM lf_operations WHERE op_id = ? LIMIT 1',
      [opId],
    );
    return row !== null;
  }

  async insertOperation(op: StoredOperation): Promise<'inserted' | 'duplicate'> {
    this.assertOpen();
    if (await this.hasOperation(op.opId)) {
      return 'duplicate';
    }

    const seqRow = await this.driver.getFirstAsync<{ seq: number }>(
      'SELECT seq FROM lf_operations WHERE household_id = ? AND device_id = ? AND seq = ? LIMIT 1',
      [op.householdId, op.deviceId, op.seq],
    );
    if (seqRow) {
      throw new Error(
        `SqliteLocalFirstStore: duplicate device seq ${op.deviceId}:${op.seq}`,
      );
    }

    await this.driver.runAsync(
      `INSERT INTO lf_operations (
         op_id, household_id, device_id, author_member_id, hlc, seq, parents,
         op_type, entity_type, entity_id, payload, key_epoch, signature, applied_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        op.opId,
        op.householdId,
        op.deviceId,
        op.authorMemberId,
        op.hlc,
        op.seq,
        op.parentsJson,
        op.opType,
        op.entityType,
        op.entityId,
        toBlob(op.payload),
        op.keyEpoch,
        toBlob(op.signature),
        op.appliedAt,
      ],
    );
    await this.advanceFrontier(op.householdId, op.deviceId, op.seq);
    return 'inserted';
  }

  /**
   * Advance the contiguous watermark for one author.
   *
   * Only on `seq === contiguous + 1`, then walk forward over anything that
   * arrived earlier out of order. Ops above a gap stay stored and projected but
   * uncounted, so they are harmlessly resent until the gap closes — the
   * alternative, MAX(seq), would claim ops we never received.
   */
  private async advanceFrontier(
    householdId: HouseholdId,
    deviceId: DeviceId,
    seq: number,
  ): Promise<void> {
    const row = await this.driver.getFirstAsync<{ contiguous_seq: number }>(
      'SELECT contiguous_seq FROM lf_op_frontier WHERE household_id = ? AND device_id = ?',
      [householdId, deviceId],
    );
    const contiguous = Number(row?.contiguous_seq ?? 0);
    if (seq !== contiguous + 1) return;
    let next = seq;
    while (await this.hasSeq(householdId, deviceId, next + 1)) {
      next += 1;
    }
    await this.writeFrontier(householdId, deviceId, next);
  }

  async getLowestStoredSeq(householdId: HouseholdId, deviceId: DeviceId): Promise<number> {
    this.assertOpen();
    const row = await this.driver.getFirstAsync<{ min_seq: number | null }>(
      'SELECT MIN(seq) AS min_seq FROM lf_operations WHERE household_id = ? AND device_id = ?',
      [householdId, deviceId],
    );
    return Number(row?.min_seq ?? 0);
  }

  /** See LocalFirstStore.setAuthorBaseline — only ever for a self-vouched author. */
  async setAuthorBaseline(
    householdId: HouseholdId,
    deviceId: DeviceId,
    baselineSeq: number,
  ): Promise<void> {
    this.assertOpen();
    if (!Number.isFinite(baselineSeq) || baselineSeq <= 0) return;
    const row = await this.driver.getFirstAsync<{ contiguous_seq: number }>(
      'SELECT contiguous_seq FROM lf_op_frontier WHERE household_id = ? AND device_id = ?',
      [householdId, deviceId],
    );
    if (Number(row?.contiguous_seq ?? 0) >= baselineSeq) return;
    let next = baselineSeq;
    while (await this.hasSeq(householdId, deviceId, next + 1)) {
      next += 1;
    }
    await this.writeFrontier(householdId, deviceId, next);
  }

  private async writeFrontier(
    householdId: HouseholdId,
    deviceId: DeviceId,
    contiguousSeq: number,
  ): Promise<void> {
    await this.driver.runAsync(
      `INSERT INTO lf_op_frontier (household_id, device_id, contiguous_seq)
       VALUES (?, ?, ?)
       ON CONFLICT(household_id, device_id) DO UPDATE SET contiguous_seq = excluded.contiguous_seq`,
      [householdId, deviceId, contiguousSeq],
    );
  }

  private async hasSeq(
    householdId: HouseholdId,
    deviceId: DeviceId,
    seq: number,
  ): Promise<boolean> {
    const row = await this.driver.getFirstAsync<{ one: number }>(
      'SELECT 1 AS one FROM lf_operations WHERE household_id = ? AND device_id = ? AND seq = ? LIMIT 1',
      [householdId, deviceId, seq],
    );
    return row !== null;
  }

  async listOperationsByHlc(
    householdId: HouseholdId,
    afterHlc?: string,
  ): Promise<StoredOperation[]> {
    this.assertOpen();
    const rows = afterHlc
      ? await this.driver.getAllAsync<OperationRow>(
          `SELECT op_id, household_id, device_id, author_member_id, hlc, seq, parents,
                  op_type, entity_type, entity_id, payload, key_epoch, signature, applied_at
           FROM lf_operations
           WHERE household_id = ? AND hlc > ?
           ORDER BY hlc ASC`,
          [householdId, afterHlc],
        )
      : await this.driver.getAllAsync<OperationRow>(
          `SELECT op_id, household_id, device_id, author_member_id, hlc, seq, parents,
                  op_type, entity_type, entity_id, payload, key_epoch, signature, applied_at
           FROM lf_operations
           WHERE household_id = ?
           ORDER BY hlc ASC`,
          [householdId],
        );
    return rows.map(rowToOp);
  }

  async nextSeq(householdId: HouseholdId, deviceId: DeviceId): Promise<number> {
    this.assertOpen();
    const maxRow = await this.driver.getFirstAsync<{ max_seq: number | null }>(
      'SELECT MAX(seq) AS max_seq FROM lf_operations WHERE household_id = ? AND device_id = ?',
      [householdId, deviceId],
    );
    const frontier = await this.driver.getFirstAsync<{ contiguous_seq: number }>(
      'SELECT contiguous_seq FROM lf_op_frontier WHERE household_id = ? AND device_id = ?',
      [householdId, deviceId],
    );
    return Math.max(Number(maxRow?.max_seq ?? 0), Number(frontier?.contiguous_seq ?? 0)) + 1;
  }

  async getVersionVector(householdId: HouseholdId): Promise<VersionVector> {
    this.assertOpen();
    const rows = await this.driver.getAllAsync<{ device_id: string; contiguous_seq: number }>(
      'SELECT device_id, contiguous_seq FROM lf_op_frontier WHERE household_id = ?',
      [householdId],
    );
    const vv: Record<string, number> = {};
    for (const row of rows) {
      const seq = Number(row.contiguous_seq);
      if (seq > 0) vv[row.device_id] = seq;
    }
    return vv;
  }

  private sinceClause(
    householdId: HouseholdId,
    have: VersionVector,
  ): { sql: string; params: unknown[] } {
    const known = Object.keys(have);
    if (known.length === 0) {
      return { sql: 'household_id = ?', params: [householdId] };
    }
    const params: unknown[] = [householdId];
    const terms: string[] = [];
    for (const device of known) {
      terms.push('(device_id = ? AND seq > ?)');
      params.push(device, have[device] ?? 0);
    }
    terms.push(`device_id NOT IN (${known.map(() => '?').join(', ')})`);
    params.push(...known);
    return { sql: `household_id = ? AND (${terms.join(' OR ')})`, params };
  }

  async listOperationsSince(
    householdId: HouseholdId,
    have: VersionVector,
    limit = 50_000,
  ): Promise<StoredOperation[]> {
    this.assertOpen();
    const { sql, params } = this.sinceClause(householdId, have);
    const rows = await this.driver.getAllAsync<OperationRow>(
      `SELECT ${OP_COLUMNS}
       FROM lf_operations
       WHERE ${sql}
       ORDER BY hlc ASC, device_id ASC, seq ASC
       LIMIT ?`,
      [...params, limit],
    );
    return rows.map(rowToOp);
  }

  async hasOperationsSince(householdId: HouseholdId, have: VersionVector): Promise<boolean> {
    this.assertOpen();
    const { sql, params } = this.sinceClause(householdId, have);
    const row = await this.driver.getFirstAsync<{ one: number }>(
      `SELECT 1 AS one FROM lf_operations WHERE ${sql} LIMIT 1`,
      params,
    );
    return row !== null;
  }

  async countOperationsSince(householdId: HouseholdId, have: VersionVector): Promise<number> {
    this.assertOpen();
    const { sql, params } = this.sinceClause(householdId, have);
    const row = await this.driver.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM lf_operations WHERE ${sql}`,
      params,
    );
    return Number(row?.n ?? 0);
  }

  async getSyncPeerState(
    householdId: HouseholdId,
    peerDeviceId: DeviceId,
  ): Promise<SyncPeerState | null> {
    this.assertOpen();
    const row = await this.driver.getFirstAsync<SyncPeerRow>(
      'SELECT * FROM lf_sync_peers WHERE household_id = ? AND peer_device_id = ?',
      [householdId, peerDeviceId],
    );
    return row ? rowToPeerState(row) : null;
  }

  async putSyncPeerState(state: SyncPeerState): Promise<void> {
    this.assertOpen();
    await this.driver.runAsync(
      `INSERT INTO lf_sync_peers (
         household_id, peer_device_id, known_vv, sent_vv, sent_at, last_push_at, last_receipt_vv
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(household_id, peer_device_id) DO UPDATE SET
         known_vv = excluded.known_vv,
         sent_vv = excluded.sent_vv,
         sent_at = excluded.sent_at,
         last_push_at = excluded.last_push_at,
         last_receipt_vv = excluded.last_receipt_vv`,
      [
        state.householdId,
        state.peerDeviceId,
        JSON.stringify(state.knownVv),
        JSON.stringify(state.sentVv),
        state.sentAtMs,
        state.lastPushAtMs,
        JSON.stringify(state.lastReceiptVv),
      ],
    );
  }

  async listSyncPeerStates(householdId: HouseholdId): Promise<SyncPeerState[]> {
    this.assertOpen();
    const rows = await this.driver.getAllAsync<SyncPeerRow>(
      'SELECT * FROM lf_sync_peers WHERE household_id = ?',
      [householdId],
    );
    return rows.map(rowToPeerState);
  }

  async clearSyncPeerStates(householdId: HouseholdId): Promise<void> {
    this.assertOpen();
    await this.driver.runAsync('DELETE FROM lf_sync_peers WHERE household_id = ?', [householdId]);
  }

  async getProjectionCursor(entityType: string, entityId: string): Promise<string | null> {
    this.assertOpen();
    const row = await this.driver.getFirstAsync<{ last_op_id: string }>(
      `SELECT last_op_id FROM lf_projection_cursors
       WHERE entity_type = ? AND entity_id = ?`,
      [entityType, entityId],
    );
    return row?.last_op_id ?? null;
  }

  async setProjectionCursor(
    entityType: string,
    entityId: string,
    opId: string,
  ): Promise<void> {
    this.assertOpen();
    await this.driver.runAsync(
      `INSERT INTO lf_projection_cursors (entity_type, entity_id, last_op_id)
       VALUES (?, ?, ?)
       ON CONFLICT(entity_type, entity_id) DO UPDATE SET last_op_id = excluded.last_op_id`,
      [entityType, entityId, opId],
    );
  }

  async putRows(rows: StoredRowRecord[]): Promise<void> {
    this.assertOpen();
    for (const row of rows) {
      await this.driver.runAsync(
        `INSERT INTO lf_rows (
           household_id, tbl, row_key, bucket, deleted, nonce, ciphertext, key_epoch, updated_hlc
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(household_id, tbl, row_key) DO UPDATE SET
           bucket = excluded.bucket,
           deleted = excluded.deleted,
           nonce = excluded.nonce,
           ciphertext = excluded.ciphertext,
           key_epoch = excluded.key_epoch,
           updated_hlc = excluded.updated_hlc`,
        [
          row.householdId,
          row.table,
          row.rowKey,
          row.bucket,
          row.deleted ? 1 : 0,
          toBlob(row.nonce),
          toBlob(row.ciphertext),
          row.keyEpoch,
          row.updatedHlc,
        ],
      );
    }
  }

  async listRows(query: RowLoadQuery): Promise<StoredRowRecord[]> {
    this.assertOpen();
    // `keys` is the whole selector when present — see the note on RowLoadQuery.
    // Taken on `!== undefined` so an empty array selects nothing; falling
    // through to the window would turn "hydrate these zero rows" into "load the
    // whole household", which is the opposite of what the caller asked for.
    if (query.keys !== undefined) return this.listRowsByKey(query.householdId, query.keys);
    const buckets = query.buckets;
    let sql =
      `SELECT household_id, tbl, row_key, bucket, deleted, nonce, ciphertext, key_epoch, updated_hlc
       FROM lf_rows WHERE household_id = ?`;
    const params: unknown[] = [query.householdId];
    if (buckets && buckets.length > 0) {
      const placeholders = buckets.map(() => '?').join(', ');
      sql += ` AND (deleted = 1 OR bucket = ? OR bucket IN (${placeholders}))`;
      params.push(ALWAYS_RESIDENT_BUCKET, ...buckets);
    }
    const rows = await this.driver.getAllAsync<RowTableRow>(sql, params);
    return rows.map(sqlRowToStored);
  }

  /**
   * Point lookups, grouped by table and chunked.
   *
   * Grouped so each statement is `tbl = ? AND row_key IN (…)`, which is a prefix
   * of the `(household_id, tbl, row_key)` primary key and therefore a seek per
   * key rather than a scan. Chunked because SQLite binds a bounded number of
   * host parameters and a bulk delta legitimately touches hundreds of rows —
   * the cap is well under every documented limit, and the alternative failure is
   * a runtime "too many SQL variables" on exactly the large merge that most
   * needs to succeed.
   */
  private async listRowsByKey(
    householdId: HouseholdId,
    keys: readonly RowKeyRef[],
  ): Promise<StoredRowRecord[]> {
    if (keys.length === 0) return [];
    const byTable = new Map<string, string[]>();
    for (const ref of keys) {
      const list = byTable.get(ref.table);
      if (list) list.push(ref.rowKey);
      else byTable.set(ref.table, [ref.rowKey]);
    }
    const out: StoredRowRecord[] = [];
    for (const [table, rowKeys] of byTable) {
      for (let i = 0; i < rowKeys.length; i += ROW_KEY_CHUNK) {
        const chunk = rowKeys.slice(i, i + ROW_KEY_CHUNK);
        const placeholders = chunk.map(() => '?').join(', ');
        const rows = await this.driver.getAllAsync<RowTableRow>(
          `SELECT household_id, tbl, row_key, bucket, deleted, nonce, ciphertext, key_epoch, updated_hlc
           FROM lf_rows
           WHERE household_id = ? AND tbl = ? AND row_key IN (${placeholders})`,
          [householdId, table, ...chunk],
        );
        for (const row of rows) out.push(sqlRowToStored(row));
      }
    }
    return out;
  }

  async listRowBuckets(householdId: HouseholdId): Promise<RowBucketCount[]> {
    this.assertOpen();
    const rows = await this.driver.getAllAsync<{ tbl: string; bucket: string; n: number }>(
      `SELECT tbl, bucket, COUNT(*) AS n
       FROM lf_rows WHERE household_id = ?
       GROUP BY tbl, bucket`,
      [householdId],
    );
    return rows.map((row) => ({ table: row.tbl, bucket: row.bucket, rows: Number(row.n) }));
  }

  async clearRows(householdId: HouseholdId): Promise<void> {
    this.assertOpen();
    await this.driver.runAsync('DELETE FROM lf_rows WHERE household_id = ?', [householdId]);
  }

  async markProjected(opIds: readonly OpId[], atMs: number): Promise<void> {
    this.assertOpen();
    if (opIds.length === 0) return;
    for (const opId of opIds) {
      await this.driver.runAsync(
        'UPDATE lf_operations SET projected_at = ? WHERE op_id = ? AND projected_at IS NULL',
        [atMs, opId],
      );
    }
  }

  async listUnprojectedOperations(householdId: HouseholdId): Promise<StoredOperation[]> {
    this.assertOpen();
    const rows = await this.driver.getAllAsync<OperationRow>(
      `SELECT op_id, household_id, device_id, author_member_id, hlc, seq, parents,
              op_type, entity_type, entity_id, payload, key_epoch, signature, applied_at
       FROM lf_operations
       WHERE household_id = ? AND projected_at IS NULL
       ORDER BY hlc ASC, device_id ASC, seq ASC`,
      [householdId],
    );
    return rows.map(rowToOp);
  }

  async compactOperations(householdId: HouseholdId, retain: VersionVector): Promise<number> {
    this.assertOpen();
    let removed = 0;
    for (const [deviceId, seq] of Object.entries(retain)) {
      if (!Number.isFinite(seq) || seq <= 0) continue;
      const result = await this.driver.runAsync(
        'DELETE FROM lf_operations WHERE household_id = ? AND device_id = ? AND seq <= ?',
        [householdId, deviceId, seq],
      );
      removed += Number(result.changes ?? 0);
    }
    return removed;
  }
}

type SyncPeerRow = {
  household_id: string;
  peer_device_id: string;
  known_vv: string;
  sent_vv: string;
  sent_at: number;
  last_push_at: number;
  last_receipt_vv: string;
};

function rowToPeerState(row: SyncPeerRow): SyncPeerState {
  return {
    householdId: row.household_id,
    peerDeviceId: row.peer_device_id,
    knownVv: parseVv(row.known_vv),
    sentVv: parseVv(row.sent_vv),
    sentAtMs: Number(row.sent_at ?? 0),
    lastPushAtMs: Number(row.last_push_at ?? 0),
    lastReceiptVv: parseVv(row.last_receipt_vv),
  };
}

function parseVv(raw: string | null | undefined): VersionVector {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function rowToOp(row: OperationRow): StoredOperation {
  return {
    opId: row.op_id,
    householdId: row.household_id,
    deviceId: row.device_id,
    authorMemberId: row.author_member_id,
    hlc: row.hlc,
    seq: row.seq,
    parentsJson: row.parents ?? '[]',
    opType: row.op_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    payload: fromBlob(row.payload),
    keyEpoch: row.key_epoch,
    signature: fromBlob(row.signature),
    appliedAt: row.applied_at,
  };
}

function sqlRowToStored(row: RowTableRow): StoredRowRecord {
  return {
    householdId: row.household_id,
    table: row.tbl,
    rowKey: row.row_key,
    bucket: row.bucket,
    deleted: Number(row.deleted) === 1,
    nonce: fromBlob(row.nonce),
    ciphertext: fromBlob(row.ciphertext),
    keyEpoch: row.key_epoch,
    updatedHlc: row.updated_hlc,
  };
}

function toBlob(bytes: Bytes): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

function fromBlob(value: Uint8Array | ArrayBuffer): Uint8Array {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  return new Uint8Array(value);
}
