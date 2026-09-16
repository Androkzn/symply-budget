import type { Bytes, DeviceId, HouseholdId, OpId } from '../types';

import {
  ALWAYS_RESIDENT_BUCKET,
  type LocalFirstStore,
  type RowBucketCount,
  type RowLoadQuery,
  type StoredOperation,
  type StoredRowRecord,
  type SyncPeerState,
  type VersionVector,
} from './types';

/**
 * In-process store for Jest and single-process tests.
 * Production clients — Budget and House alike — use `SqliteLocalFirstStore`
 * + `expo-sqlite`.
 *
 * Every query here must mean exactly what the SQL in `sqlite-store.ts` means:
 * the mobile Jest suite — including the merge-semantics proof in
 * multiMemberSync.test.ts — runs entirely on this class, so a divergence would
 * make those tests prove nothing about the code that ships.
 */
export class MemoryLocalFirstStore implements LocalFirstStore {
  private openFlag = false;
  private readonly meta = new Map<string, string>();
  private readonly ops = new Map<string, StoredOperation>();
  /** `${householdId} ${deviceId}` -> highest seq seen (for nextSeq). */
  private readonly seqByDevice = new Map<string, number>();
  /** `${householdId} ${deviceId}` -> contiguous prefix watermark. */
  private readonly contiguous = new Map<string, number>();
  /** `${householdId} ${peerDeviceId}` -> peer sync state. */
  private readonly syncPeers = new Map<string, SyncPeerState>();
  private readonly projections = new Map<string, string>();
  private readonly rows = new Map<string, StoredRowRecord>();
  private readonly projectedAt = new Map<string, number>();

  async open(_localDatabaseKey: Bytes): Promise<void> {
    // Key accepted for API parity; memory store does not encrypt pages.
    this.openFlag = true;
  }

  async close(): Promise<void> {
    this.openFlag = false;
  }

  isOpen(): boolean {
    return this.openFlag;
  }

  private assertOpen(): void {
    if (!this.openFlag) {
      throw new Error('MemoryLocalFirstStore: not open');
    }
  }

  async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    this.assertOpen();
    return work();
  }

  async getMeta(key: string): Promise<string | null> {
    this.assertOpen();
    return this.meta.get(key) ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    this.assertOpen();
    this.meta.set(key, value);
  }

  async getOperation(opId: OpId): Promise<StoredOperation | null> {
    this.assertOpen();
    return this.ops.get(opId) ?? null;
  }

  async hasOperation(opId: OpId): Promise<boolean> {
    this.assertOpen();
    return this.ops.has(opId);
  }

  async insertOperation(op: StoredOperation): Promise<'inserted' | 'duplicate'> {
    this.assertOpen();
    if (this.ops.has(op.opId)) {
      return 'duplicate';
    }
    for (const existing of this.ops.values()) {
      if (
        existing.householdId === op.householdId &&
        existing.deviceId === op.deviceId &&
        existing.seq === op.seq
      ) {
        throw new Error(
          `MemoryLocalFirstStore: duplicate device seq ${op.deviceId}:${op.seq}`,
        );
      }
    }
    this.ops.set(op.opId, {
      ...op,
      payload: new Uint8Array(op.payload),
      signature: new Uint8Array(op.signature),
    });
    const authorKey = deviceKey(op.householdId, op.deviceId);
    const prev = this.seqByDevice.get(authorKey) ?? 0;
    if (op.seq > prev) {
      this.seqByDevice.set(authorKey, op.seq);
    }
    this.advanceFrontier(op.householdId, op.deviceId, op.seq);
    return 'inserted';
  }

  /** Contiguous prefix only — see the note on VersionVector. */
  private advanceFrontier(householdId: HouseholdId, deviceId: DeviceId, seq: number): void {
    const key = deviceKey(householdId, deviceId);
    let contiguous = this.contiguous.get(key) ?? 0;
    if (seq !== contiguous + 1) return;
    contiguous = seq;
    while (this.hasSeq(householdId, deviceId, contiguous + 1)) {
      contiguous += 1;
    }
    this.contiguous.set(key, contiguous);
  }

  async getLowestStoredSeq(householdId: HouseholdId, deviceId: DeviceId): Promise<number> {
    this.assertOpen();
    let lowest = 0;
    for (const op of this.ops.values()) {
      if (op.householdId !== householdId || op.deviceId !== deviceId) continue;
      if (lowest === 0 || op.seq < lowest) lowest = op.seq;
    }
    return lowest;
  }

  async setAuthorBaseline(
    householdId: HouseholdId,
    deviceId: DeviceId,
    baselineSeq: number,
  ): Promise<void> {
    this.assertOpen();
    if (!Number.isFinite(baselineSeq) || baselineSeq <= 0) return;
    const key = deviceKey(householdId, deviceId);
    let contiguous = this.contiguous.get(key) ?? 0;
    if (contiguous >= baselineSeq) return;
    contiguous = baselineSeq;
    while (this.hasSeq(householdId, deviceId, contiguous + 1)) {
      contiguous += 1;
    }
    this.contiguous.set(key, contiguous);
  }

  private hasSeq(householdId: HouseholdId, deviceId: DeviceId, seq: number): boolean {
    for (const op of this.ops.values()) {
      if (op.householdId === householdId && op.deviceId === deviceId && op.seq === seq) {
        return true;
      }
    }
    return false;
  }

  async listOperationsByHlc(
    householdId: HouseholdId,
    afterHlc?: string,
  ): Promise<StoredOperation[]> {
    this.assertOpen();
    const rows = [...this.ops.values()].filter((op) => op.householdId === householdId);
    rows.sort((a, b) => (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : 0));
    if (!afterHlc) {
      return rows.map(cloneOp);
    }
    return rows.filter((op) => op.hlc > afterHlc).map(cloneOp);
  }

  async nextSeq(householdId: HouseholdId, deviceId: DeviceId): Promise<number> {
    this.assertOpen();
    const current = this.seqByDevice.get(deviceKey(householdId, deviceId)) ?? 0;
    const frontier = this.contiguous.get(deviceKey(householdId, deviceId)) ?? 0;
    return Math.max(current, frontier) + 1;
  }

  async getVersionVector(householdId: HouseholdId): Promise<VersionVector> {
    this.assertOpen();
    const vv: Record<string, number> = {};
    const prefix = `${householdId} `;
    for (const [key, seq] of this.contiguous.entries()) {
      if (!key.startsWith(prefix) || seq <= 0) continue;
      vv[key.slice(prefix.length)] = seq;
    }
    return vv;
  }

  async listOperationsSince(
    householdId: HouseholdId,
    have: VersionVector,
    limit = 50_000,
  ): Promise<StoredOperation[]> {
    this.assertOpen();
    const rows = [...this.ops.values()].filter(
      (op) => op.householdId === householdId && op.seq > (have[op.deviceId] ?? 0),
    );
    rows.sort(compareForDelivery);
    return rows.slice(0, limit).map(cloneOp);
  }

  async hasOperationsSince(householdId: HouseholdId, have: VersionVector): Promise<boolean> {
    this.assertOpen();
    for (const op of this.ops.values()) {
      if (op.householdId === householdId && op.seq > (have[op.deviceId] ?? 0)) return true;
    }
    return false;
  }

  async countOperationsSince(householdId: HouseholdId, have: VersionVector): Promise<number> {
    this.assertOpen();
    let count = 0;
    for (const op of this.ops.values()) {
      if (op.householdId === householdId && op.seq > (have[op.deviceId] ?? 0)) count += 1;
    }
    return count;
  }

  async getSyncPeerState(
    householdId: HouseholdId,
    peerDeviceId: DeviceId,
  ): Promise<SyncPeerState | null> {
    this.assertOpen();
    const state = this.syncPeers.get(deviceKey(householdId, peerDeviceId));
    return state ? clonePeerState(state) : null;
  }

  async putSyncPeerState(state: SyncPeerState): Promise<void> {
    this.assertOpen();
    this.syncPeers.set(
      deviceKey(state.householdId, state.peerDeviceId),
      clonePeerState(state),
    );
  }

  async listSyncPeerStates(householdId: HouseholdId): Promise<SyncPeerState[]> {
    this.assertOpen();
    return [...this.syncPeers.values()]
      .filter((state) => state.householdId === householdId)
      .map(clonePeerState);
  }

  async clearSyncPeerStates(householdId: HouseholdId): Promise<void> {
    this.assertOpen();
    for (const [key, state] of [...this.syncPeers.entries()]) {
      if (state.householdId === householdId) this.syncPeers.delete(key);
    }
  }

  async getProjectionCursor(entityType: string, entityId: string): Promise<string | null> {
    this.assertOpen();
    return this.projections.get(`${entityType}:${entityId}`) ?? null;
  }

  async setProjectionCursor(
    entityType: string,
    entityId: string,
    opId: string,
  ): Promise<void> {
    this.assertOpen();
    this.projections.set(`${entityType}:${entityId}`, opId);
  }

  async putRows(rows: StoredRowRecord[]): Promise<void> {
    this.assertOpen();
    for (const row of rows) {
      this.rows.set(rowStorageKey(row.householdId, row.table, row.rowKey), cloneStoredRow(row));
    }
  }

  async listRows(query: RowLoadQuery): Promise<StoredRowRecord[]> {
    this.assertOpen();
    // `keys` is the whole selector when present — see the note on RowLoadQuery.
    // An empty array selects nothing, which is why this branch is taken on
    // `!== undefined` rather than on length.
    if (query.keys !== undefined) {
      const out: StoredRowRecord[] = [];
      for (const ref of query.keys) {
        const row = this.rows.get(rowStorageKey(query.householdId, ref.table, ref.rowKey));
        if (row) out.push(cloneStoredRow(row));
      }
      return out;
    }
    const buckets = query.buckets;
    const out: StoredRowRecord[] = [];
    for (const row of this.rows.values()) {
      if (row.householdId !== query.householdId) continue;
      if (buckets && buckets.length > 0) {
        const inWindow =
          row.deleted ||
          row.bucket === ALWAYS_RESIDENT_BUCKET ||
          buckets.includes(row.bucket);
        if (!inWindow) continue;
      }
      out.push(cloneStoredRow(row));
    }
    return out;
  }

  async listRowBuckets(householdId: HouseholdId): Promise<RowBucketCount[]> {
    this.assertOpen();
    // Must mean exactly what the SQL means: `GROUP BY tbl, bucket` counts every
    // row including tombstones, because a caller widening its window needs to
    // know a bucket EXISTS, not how much of it is live.
    const counts = new Map<string, RowBucketCount>();
    for (const row of this.rows.values()) {
      if (row.householdId !== householdId) continue;
      const key = `${row.table} ${row.bucket}`;
      const entry = counts.get(key);
      if (entry) entry.rows += 1;
      else counts.set(key, { table: row.table, bucket: row.bucket, rows: 1 });
    }
    return [...counts.values()];
  }

  async clearRows(householdId: HouseholdId): Promise<void> {
    this.assertOpen();
    for (const [key, row] of [...this.rows.entries()]) {
      if (row.householdId === householdId) this.rows.delete(key);
    }
  }

  async markProjected(opIds: readonly OpId[], atMs: number): Promise<void> {
    this.assertOpen();
    for (const opId of opIds) {
      if (!this.ops.has(opId)) continue;
      if (this.projectedAt.has(opId)) continue;
      this.projectedAt.set(opId, atMs);
    }
  }

  async listUnprojectedOperations(householdId: HouseholdId): Promise<StoredOperation[]> {
    this.assertOpen();
    const rows = [...this.ops.values()].filter(
      (op) => op.householdId === householdId && !this.projectedAt.has(op.opId),
    );
    rows.sort(compareForDelivery);
    return rows.map(cloneOp);
  }

  async compactOperations(householdId: HouseholdId, retain: VersionVector): Promise<number> {
    this.assertOpen();
    let removed = 0;
    for (const [opId, op] of [...this.ops.entries()]) {
      if (op.householdId !== householdId) continue;
      const keepBelow = retain[op.deviceId] ?? 0;
      if (keepBelow > 0 && op.seq <= keepBelow) {
        this.ops.delete(opId);
        this.projectedAt.delete(opId);
        removed += 1;
      }
    }
    return removed;
  }
}

function cloneOp(op: StoredOperation): StoredOperation {
  return {
    ...op,
    payload: new Uint8Array(op.payload),
    signature: new Uint8Array(op.signature),
  };
}

function clonePeerState(state: SyncPeerState): SyncPeerState {
  return {
    ...state,
    knownVv: { ...state.knownVv },
    sentVv: { ...state.sentVv },
    lastReceiptVv: { ...state.lastReceiptVv },
  };
}

function cloneStoredRow(row: StoredRowRecord): StoredRowRecord {
  return {
    ...row,
    nonce: new Uint8Array(row.nonce),
    ciphertext: new Uint8Array(row.ciphertext),
  };
}

function rowStorageKey(householdId: HouseholdId, table: string, rowKey: string): string {
  return `${householdId} ${table} ${rowKey}`;
}

/** A space cannot appear in either id, so this key is unambiguous. */
function deviceKey(householdId: HouseholdId, deviceId: DeviceId): string {
  return `${householdId} ${deviceId}`;
}

/** Matches `ORDER BY hlc ASC, device_id ASC, seq ASC` in sqlite-store. */
function compareForDelivery(a: StoredOperation, b: StoredOperation): number {
  if (a.hlc !== b.hlc) return a.hlc < b.hlc ? -1 : 1;
  if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1;
  return a.seq - b.seq;
}
