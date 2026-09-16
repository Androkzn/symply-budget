import type { Bytes, DeviceId, HouseholdId, MemberId, OpId } from '../types';

export interface StoredOperation {
  opId: OpId;
  householdId: HouseholdId;
  deviceId: DeviceId;
  authorMemberId: MemberId;
  hlc: string;
  seq: number;
  parentsJson: string;
  opType: string;
  entityType: string;
  entityId: string;
  /** AEAD ciphertext under HDK */
  payload: Bytes;
  keyEpoch: number;
  signature: Bytes;
  appliedAt: number;
}

/**
 * Per-author sync cursor: author device id -> highest CONTIGUOUS seq held.
 *
 * A scalar HLC watermark cannot do this job. `HybridLogicalClock.format()` is
 * `${wallMs}-${counter}-${deviceSuffix}` (oplog/hlc.ts), so HLCs sort by WALL
 * CLOCK first. A device that has been offline keeps an old wallMs, so the ops it
 * authors while away sort BELOW the receiver's recent ops — a `WHERE hlc > ?`
 * cursor skips exactly them, silently and forever.
 *
 * An entry is the contiguous prefix, never MAX(seq): a device relays ops it did
 * not author, so it can hold author D's seqs 5..7 while 3..4 are still missing.
 * Claiming 7 would tell every peer we already have 3 and 4 and nobody would ever
 * send them again.
 */
export type VersionVector = Readonly<Record<DeviceId, number>>;

/** What we know, and what we have optimistically sent, per sync peer. */
export interface SyncPeerState {
  householdId: HouseholdId;
  peerDeviceId: DeviceId;
  /** The peer's own frontier, learned from a batch header it sent. */
  knownVv: VersionVector;
  /** Optimistic: deposited for the peer, not yet confirmed by a batch from it. */
  sentVv: VersionVector;
  sentAtMs: number;
  lastPushAtMs: number;
  /** VV last published to this peer in a receipt (a batch with no ops). */
  lastReceiptVv: VersionVector;
}

export interface LocalFirstStore {
  open(localDatabaseKey: Bytes): Promise<void>;
  close(): Promise<void>;
  isOpen(): boolean;

  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;

  getOperation(opId: OpId): Promise<StoredOperation | null>;
  hasOperation(opId: OpId): Promise<boolean>;
  insertOperation(op: StoredOperation): Promise<'inserted' | 'duplicate'>;
  listOperationsByHlc(householdId: HouseholdId, afterHlc?: string): Promise<StoredOperation[]>;
  /**
   * Next seq for this author IN THIS HOUSEHOLD.
   *
   * Household-scoped because joining replaces the ledger but not the store:
   * pre-join rows keep this device_id, so a device-global seq space leaves a
   * permanent 1..n hole in the new household that a contiguous watermark can
   * never cross — the author's whole history would resend on every sync forever.
   */
  nextSeq(householdId: HouseholdId, deviceId: DeviceId): Promise<number>;

  /** Contiguous per-author watermark for this household. */
  getVersionVector(householdId: HouseholdId): Promise<VersionVector>;
  /**
   * Lowest seq held here for one author in this household, or 0 when none.
   *
   * For our OWN device id this is authoritative: we are the sole source of ops
   * carrying it, so `lowest - 1` is a seq range that can never arrive.
   */
  getLowestStoredSeq(householdId: HouseholdId, deviceId: DeviceId): Promise<number>;
  /**
   * Declare that seqs at or below `baselineSeq` will never arrive for this
   * author, so the contiguous watermark may start above 1, then walk forward
   * over whatever is already stored.
   *
   * Without a baseline the watermark can only ever begin at seq 1, and an author
   * whose lowest local seq is higher — a device-global `nextSeq` legacy database,
   * or any future checkpoint bootstrap — is pinned at 0 for ever: absent from its
   * own version vector, uncoverable by any peer, resending its whole log on every
   * sync. Only ever declare a baseline an author can vouch for itself (our own
   * device id, or the `senderBaselineSeq` a peer publishes about ITSELF).
   * Ignored when it would lower an existing watermark.
   */
  setAuthorBaseline(
    householdId: HouseholdId,
    deviceId: DeviceId,
    baselineSeq: number,
  ): Promise<void>;
  /**
   * Ops held here that `have` does not cover.
   * Ordered `hlc ASC, device_id ASC, seq ASC` — today's delivery order.
   */
  listOperationsSince(
    householdId: HouseholdId,
    have: VersionVector,
    limit?: number,
  ): Promise<StoredOperation[]>;
  /** Cheap dirtiness test — does not materialize rows. */
  hasOperationsSince(householdId: HouseholdId, have: VersionVector): Promise<boolean>;
  /**
   * How many ops `have` is missing. Separate from listOperationsSince so the
   * status display does not materialize a whole history's payload bytes just to
   * show a number.
   */
  countOperationsSince(householdId: HouseholdId, have: VersionVector): Promise<number>;

  getSyncPeerState(
    householdId: HouseholdId,
    peerDeviceId: DeviceId,
  ): Promise<SyncPeerState | null>;
  putSyncPeerState(state: SyncPeerState): Promise<void>;
  listSyncPeerStates(householdId: HouseholdId): Promise<SyncPeerState[]>;
  clearSyncPeerStates(householdId: HouseholdId): Promise<void>;

  /** Projection stub: last applied op id per entity. */
  getProjectionCursor(entityType: string, entityId: string): Promise<string | null>;
  setProjectionCursor(entityType: string, entityId: string, opId: string): Promise<void>;

  /**
   * Run `work` in one SQLite transaction. Nested calls join the open
   * transaction (no savepoints). Memory store runs `work` directly.
   */
  runInTransaction<T>(work: () => Promise<T>): Promise<T>;

  /** Upsert encrypted projection rows. Durability unit for Stage 2. */
  putRows(rows: StoredRowRecord[]): Promise<void>;
  /** Windowed read. Tombstones (`deleted=1`) are always included. */
  listRows(query: RowLoadQuery): Promise<StoredRowRecord[]>;
  /**
   * How many rows sit in each `(table, bucket)`, WITHOUT decrypting any of them.
   *
   * The census a windowed reader needs to stay honest. A caller that hydrates a
   * subset of the buckets has to be able to answer two questions it cannot
   * answer from what it loaded — "is there older data at all?" and "which bucket
   * do I widen into next?" — and the only alternatives are guessing (a window
   * that silently ends the history) or opening every row (the cost the window
   * exists to avoid). Metadata only: no `nonce`, no `ciphertext`, no AEAD.
   */
  listRowBuckets(householdId: HouseholdId): Promise<RowBucketCount[]>;
  /** Drop every projection row for a household (join replacement). */
  clearRows(householdId: HouseholdId): Promise<void>;

  /** Stamp ops whose row writes have landed. Null `projected_at` = replay. */
  markProjected(opIds: readonly OpId[], atMs: number): Promise<void>;
  listUnprojectedOperations(householdId: HouseholdId): Promise<StoredOperation[]>;

  /**
   * Drop ops at or below `retain[deviceId]` for each author. Does not lower
   * `nextSeq` or the contiguous frontier — those stay the availability watermark.
   */
  compactOperations(householdId: HouseholdId, retain: VersionVector): Promise<number>;
}

/** `'*'` = always-resident (no date, or a date we cannot parse). */
export const ALWAYS_RESIDENT_BUCKET = '*';

/** One encrypted projection row in `lf_rows`. */
export type StoredRowRecord = {
  householdId: HouseholdId;
  table: string;
  rowKey: string;
  /** `'YYYY-MM'` or `ALWAYS_RESIDENT_BUCKET`. */
  bucket: string;
  deleted: boolean;
  /** 12-byte AES-GCM nonce, stored separately from ciphertext. */
  nonce: Bytes;
  /** Ciphertext || 16-byte tag. */
  ciphertext: Bytes;
  keyEpoch: number;
  updatedHlc: string;
};

/** One `(table, rowKey)` address — the unit `RowLoadQuery.keys` selects by. */
export type RowKeyRef = {
  table: string;
  rowKey: string;
};

/** One `(table, bucket)` census line from {@link LocalFirstStore.listRowBuckets}. */
export type RowBucketCount = {
  table: string;
  /** `'YYYY-MM'` or {@link ALWAYS_RESIDENT_BUCKET}. */
  bucket: string;
  rows: number;
};

export type RowLoadQuery = {
  householdId: HouseholdId;
  /**
   * When set, load those buckets plus `'*'` plus every tombstone.
   * When omitted, load every row (UI is not yet month-scoped).
   */
  buckets?: readonly string[];
  /**
   * Load exactly these rows, whatever bucket they are in — the point lookup a
   * lazily-hydrating reader needs.
   *
   * Two callers, and both are correctness rather than performance: a merge that
   * has to bring a row into memory before applying a peer's patch to it, and a
   * read that has to widen past its resident window on demand.
   *
   * **`keys` is the whole selector when present** — `buckets` is ignored, and an
   * empty array selects nothing rather than everything. Combining the two would
   * make "load these rows" and "load this window" the same call, and a caller
   * that meant one and got the other would look correct while reading the wrong
   * set. Ask twice instead.
   */
  keys?: readonly RowKeyRef[];
};

/** SQL migration stubs for the future SQLCipher adapter. */
export const SQLITE_MIGRATION_V1 = `
CREATE TABLE IF NOT EXISTS lf_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lf_operations (
  op_id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  author_member_id TEXT NOT NULL,
  hlc TEXT NOT NULL,
  seq INTEGER NOT NULL,
  parents TEXT,
  op_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload BLOB NOT NULL,
  key_epoch INTEGER NOT NULL,
  signature BLOB NOT NULL,
  applied_at INTEGER NOT NULL,
  projected_at INTEGER
);
CREATE INDEX IF NOT EXISTS ops_household_hlc ON lf_operations(household_id, hlc);

-- The old index was device-global. A joiner restarts at seq 1 in its new
-- household while its pre-join rows still hold (device, 1), so keeping it would
-- reject the joiner's first post-join op. CREATE TABLE IF NOT EXISTS never
-- rewrites an existing database, so the DROP has to be explicit or every
-- already-provisioned dev/E2E device keeps the old constraint.
DROP INDEX IF EXISTS ops_device_seq;
CREATE UNIQUE INDEX IF NOT EXISTS ops_household_device_seq
  ON lf_operations(household_id, device_id, seq);

-- Contiguous per-author watermark, advanced incrementally on insert. Derived
-- from lf_operations and rebuildable from it; never a second source of truth.
CREATE TABLE IF NOT EXISTS lf_op_frontier (
  household_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  contiguous_seq INTEGER NOT NULL,
  PRIMARY KEY (household_id, device_id)
);

CREATE TABLE IF NOT EXISTS lf_sync_peers (
  household_id TEXT NOT NULL,
  peer_device_id TEXT NOT NULL,
  known_vv TEXT NOT NULL DEFAULT '{}',
  sent_vv TEXT NOT NULL DEFAULT '{}',
  sent_at INTEGER NOT NULL DEFAULT 0,
  last_push_at INTEGER NOT NULL DEFAULT 0,
  last_receipt_vv TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (household_id, peer_device_id)
);

CREATE TABLE IF NOT EXISTS lf_projection_cursors (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  last_op_id TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);

-- One physical table for every ledger entity of every brand. Under per-row
-- AEAD the body is opaque, so a table per entity would buy nothing and cost DDL
-- on every registry change (Budget registers 25, House 21 in Wave A alone).
-- WITHOUT ROWID: the primary key IS the storage.
CREATE TABLE IF NOT EXISTS lf_rows (
  household_id TEXT NOT NULL,
  tbl TEXT NOT NULL,
  row_key TEXT NOT NULL,
  bucket TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  nonce BLOB NOT NULL,
  ciphertext BLOB NOT NULL,
  key_epoch INTEGER NOT NULL,
  updated_hlc TEXT NOT NULL,
  PRIMARY KEY (household_id, tbl, row_key)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS rows_household_bucket
  ON lf_rows(household_id, bucket);
CREATE INDEX IF NOT EXISTS rows_household_deleted
  ON lf_rows(household_id, deleted);
`;

/** Lab DBs created before projected_at / lf_rows existed. Idempotent. */
export const SQLITE_MIGRATION_V2 = `
ALTER TABLE lf_operations ADD COLUMN projected_at INTEGER;
`;
