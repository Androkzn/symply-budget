/**
 * Delta-state projection + conflict resolution, shared by every local-first
 * brand (Budget TRD §8.4 / BR-044; House plan §3.1).
 *
 * WHY DELTA-STATE AND NOT INTENT REPLAY
 * -------------------------------------
 * Every local write goes through `mutateLocalLedger(mutator, op)`, and the op
 * descriptors that ~70 call sites pass are *request* shapes, not entity shapes:
 * `GOAL_SET` carries `{planned_budget, notes}`, `TRANSFER_CREATE` carries a
 * `CreateTransferRequest` whose field names differ from the stored record, and
 * bulk ops (`SAVINGS_RECURRING_PROPAGATE`, `REGISTERED_APPLY_REGULAR`,
 * `applyGoalToYear`) touch many rows while declaring a single `entityId`. A
 * peer cannot reconstruct the resulting rows by replaying those payloads, so
 * op-intent replay would silently project a subset of the ledger — worse than
 * projecting nothing, because the divergence is invisible.
 *
 * Instead the engine snapshots the affected tables before running the mutator
 * and diffs afterwards, so each op carries the *rows that actually changed*,
 * field by field. That works uniformly for all op types, including bulk ones,
 * without touching a single call site.
 *
 * MERGE RULES (TRD §8.4)
 * ----------------------
 * - Concurrent creates: distinct ids, both kept.
 * - Concurrent field edits: per-field last-writer-wins by HLC, device tie-break.
 *   Deltas carry only the fields the author actually changed, so two members
 *   editing different fields of the same row both keep their edit.
 * - Delete vs edit: the tombstone is absorbing — delete wins, and the discarded
 *   edit is recorded as a conflict so the UI can surface it (BR-044). "Newest
 *   wins" is deliberately NOT used here: a resurrect-on-later-edit rule cannot
 *   converge, because the deleting device only holds a field patch and can
 *   never rebuild the whole row.
 *
 * HLC strings are lexicographically sortable and already end in a device
 * suffix (see `oplog/hlc.ts`), which supplies the device tie-break. The suffix
 * is truncated to 8 chars, so `compareStamps` falls back to the full author id
 * when two HLCs are otherwise identical.
 *
 * BRAND PARAMETERIZATION
 * ----------------------
 * Everything above is brand-agnostic. The only inputs a brand supplies are its
 * table→row-key map, its windowed date fields and (rarely) a bucket override —
 * see `defineLedgerSchema`. Forking this file per brand was rejected: two
 * 1,100-line CRDT cores drift, and every future fix would have to land twice.
 */
import { ALWAYS_RESIDENT_BUCKET } from '../store/types';

import { decodeRowLww, encodeRowLww } from './lww-codec';
import type { LedgerSchema } from './schema';
import type {
  ApplyDeltaResult,
  LedgerConflict,
  LedgerDelta,
  LedgerLww,
  LedgerOpPayload,
  LedgerRow,
  LedgerSnapshot,
  OpStamp,
  ProjectableLedger,
  RowDelta,
  RowEnvelope,
  RowEnvelopeWrite,
  RowLww,
  RowWrite,
} from './types';

/** Bounded so a long-lived ledger cannot grow an unbounded conflict log. */
export const MAX_TRACKED_CONFLICTS = 50;

/**
 * Bound on rows holding a parked patch. Eviction drops the oldest-stamped ones,
 * which is exactly what every orphan patch used to suffer immediately, so the
 * bound is never worse than the behaviour it replaces. The honest guarantee is
 * "no lost peer edits up to MAX_PARKED_ROWS outstanding orphans".
 */
export const MAX_PARKED_ROWS = 2000;

/**
 * Touched rows in one table above which `applyLedgerDelta` builds a key index
 * instead of scanning. Measured on this repo (7,000-row expenses table, Node
 * 22 / jest): one `Array.find` = 0.02 ms, one `Map` build = 0.22 ms, so an
 * unconditional index is an ~11x regression on the 1-row delta that is almost
 * all real traffic. Both costs scale linearly in table size, so break-even is a
 * pure lookup count (~11) and independent of how big the table is. 16 is that
 * break-even with margin.
 */
export const LEDGER_INDEX_THRESHOLD = 16;

/**
 * Plaintext delta budget for ONE op. The relay caps a deposit at 512,000
 * base64 chars = 384,000 ciphertext bytes (`sync/mailbox-engine.ts`,
 * `backend/src/routes/local-first-v2.ts`); 64,000 plaintext bytes is ~87 KB
 * base64 after AEAD, so a bulk write can never be the thing that overflows a
 * deposit and four such ops still fit in one. It sizes ROWS, not the sealed op
 * — the caller cannot see the delta `mutateLocalLedger` computes — hence the
 * ~6x headroom.
 */
export const MAX_OP_DELTA_BYTES = 64_000;
/** Belt-and-braces row cap, so a pathologically small row shape still chunks. */
export const MAX_OP_DELTA_ROWS = 250;

/**
 * Synthetic stamp for backup restore (D-20). Wall ms = 1 so any real live HLC
 * wins. Tombstones on the live replica absorb restore creates.
 */
export const RESTORE_HLC = '000000000000001-0000-restore';
export const RESTORE_AUTHOR = 'restore';

export function restoreStamp(opId: string): OpStamp {
  return { hlc: RESTORE_HLC, authorMemberId: RESTORE_AUTHOR, opId };
}

/**
 * Total order over concurrent writes: HLC first (it embeds wall clock, counter
 * and a truncated device suffix), then the full author id so two devices whose
 * suffixes collide still resolve deterministically on every replica.
 */
export function compareStamps(a: OpStamp, b: OpStamp): number {
  if (a.hlc !== b.hlc) return a.hlc < b.hlc ? -1 : 1;
  if (a.authorMemberId !== b.authorMemberId) {
    return a.authorMemberId < b.authorMemberId ? -1 : 1;
  }
  return 0;
}

function encodeStamp(stamp: OpStamp): string {
  return `${stamp.hlc}|${stamp.authorMemberId}`;
}

function decodeStamp(encoded: string): OpStamp {
  const at = encoded.lastIndexOf('|');
  if (at < 0) return { hlc: encoded, authorMemberId: '', opId: '' };
  return {
    hlc: encoded.slice(0, at),
    authorMemberId: encoded.slice(at + 1),
    opId: '',
  };
}

/** True when `candidate` supersedes the recorded stamp (or none is recorded). */
function wins(candidate: OpStamp, recorded: string | undefined): boolean {
  if (!recorded) return true;
  return compareStamps(candidate, decodeStamp(recorded)) > 0;
}

/**
 * Greedy pack of bulk rows into per-op chunks. A single row larger than the
 * budget still gets its own chunk — chunking never drops data.
 */
export function chunkRowsForOp<T>(
  rows: T[],
  maxBytes: number = MAX_OP_DELTA_BYTES,
  maxRows: number = MAX_OP_DELTA_ROWS,
): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const row of rows) {
    const size = JSON.stringify(row)?.length ?? 0;
    if (current.length > 0 && (current.length >= maxRows || bytes + size > maxBytes)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(row);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Op payload envelope: intent for humans, delta for peers. */
export function encodeLedgerOpPayload<TName extends string>(
  intent: unknown,
  delta: LedgerDelta<TName> | null,
): LedgerOpPayload<TName> {
  return delta ? { intent, delta } : { intent };
}

/**
 * Read a delta out of an op payload. Ops written before V2 delta-state sync
 * carry a bare intent object with no `delta` key — those cannot be projected,
 * and the caller counts them so the gap is visible instead of silent.
 */
export function decodeLedgerOpPayload<TName extends string>(
  raw: unknown,
): LedgerDelta<TName> | null {
  if (!raw || typeof raw !== 'object') return null;
  const delta = (raw as LedgerOpPayload<TName>).delta;
  if (!delta || typeof delta !== 'object') return null;
  if ((delta as LedgerDelta<TName>).v !== 1) return null;
  return delta as LedgerDelta<TName>;
}

/** Per-table strategy for one delta, by how many rows that table's delta touches. */
export function planTableStrategy<TName extends string>(
  delta: LedgerDelta<TName>,
  table: TName,
): 'scan' | 'index' {
  const touched = (delta.u?.[table]?.length ?? 0) + (delta.d?.[table]?.length ?? 0);
  return touched >= LEDGER_INDEX_THRESHOLD ? 'index' : 'scan';
}

const MS_PER_DAY = 86_400_000;

/** `'YYYY-MM'` for a `Date`, in UTC — the same granularity `rowBucket` writes. */
function bucketOf(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Parse a `'YYYY-MM-DD'` (or `'YYYY-MM'`) day key into UTC ms, or null.
 *
 * UTC deliberately, and it is the same approximation the bucketing itself makes:
 * `rowBucket` slices the month straight out of the stored string without ever
 * constructing a date, so a row written just either side of local midnight can
 * already land in the neighbouring bucket. Window arithmetic that tried to be
 * timezone-exact would therefore be exact about the wrong thing. Every window
 * built from this is widened by whole months anyway, which swallows the day.
 */
function dayKeyToUtcMs(key: string): number | null {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(key);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, match[3] ? Number(match[3]) : 1);
}

/**
 * Every `'YYYY-MM'` bucket touched by the inclusive day range `from…to`,
 * oldest first. Empty when either end is unparseable.
 *
 * This is what turns a caller's date range — "the meals of April 2023" — into
 * the residency question the store can answer. Whole months, always: a range
 * that starts mid-month still needs the whole bucket, because the bucket is the
 * only granularity `lf_rows` indexes.
 */
export function bucketsForRange(from: string, to: string): string[] {
  const startMs = dayKeyToUtcMs(from);
  const endMs = dayKeyToUtcMs(to);
  if (startMs === null || endMs === null || endMs < startMs) return [];
  const out: string[] = [];
  const cursor = new Date(startMs);
  cursor.setUTCDate(1);
  const last = bucketOf(new Date(endMs));
  for (;;) {
    const bucket = bucketOf(cursor);
    out.push(bucket);
    if (bucket >= last) break;
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

function yyyyMm(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 7) return null;
  const match = /^(\d{4})-(\d{2})/.exec(value);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return `${match[1]}-${match[2]}`;
}

/**
 * Scalar equality that reproduces `JSON.stringify` comparison exactly, without
 * building two strings per field. Returns null for anything that is not a JSON
 * scalar, so the caller falls back to the stringify comparison and objects,
 * arrays, Dates and the bigint throw all behave bit-identically to before.
 */
function jsonScalarEquals(before: unknown, after: unknown): boolean | null {
  switch (typeof after) {
    case 'string':
    case 'boolean':
      return before === after;
    case 'number':
      // `beforeJson` came out of JSON.stringify, where NaN and ±Infinity all
      // serialize to 'null'. The parsed pre-image therefore ALWAYS holds null
      // where the live row holds a non-finite number, so `===` against the
      // number would report that field changed on every diff forever —
      // unbounded delta churn on a field nobody edited. `===` is also what
      // makes -0 equal 0, matching stringify's '0' for both.
      return Number.isFinite(after) ? before === after : before === null;
    case 'undefined':
      return before === undefined;
    case 'object':
      return after === null ? before === null : null;
    default:
      return null;
  }
}

/** Full JSON equality: the scalar fast path, then stringify for the rest. */
function jsonValueEquals(before: unknown, after: unknown): boolean {
  const scalar = jsonScalarEquals(before, after);
  return scalar !== null ? scalar : JSON.stringify(before) === JSON.stringify(after);
}

function changedFields(beforeJson: string, after: LedgerRow): LedgerRow | null {
  // Whole-row pre-check. `beforeJson` was produced by JSON.stringify of this
  // same row shape, so an identical string proves nothing moved and skips the
  // parse entirely; a mere key-order change just falls through to the slow
  // path. Unchanged rows are the overwhelming majority of every diff (measured
  // 94 ms → 6 ms over 12,000 rows).
  if (JSON.stringify(after) === beforeJson) return null;

  const before = JSON.parse(beforeJson) as LedgerRow;
  const changed: LedgerRow = {};
  let dirty = false;
  for (const [field, value] of Object.entries(after)) {
    const scalar = jsonScalarEquals(before[field], value);
    const same =
      scalar !== null ? scalar : JSON.stringify(before[field]) === JSON.stringify(value);
    if (!same) {
      changed[field] = value;
      dirty = true;
    }
  }
  // A field removed outright is normalized to null so peers converge on the
  // same absence rather than keeping a stale value forever.
  for (const field of Object.keys(before)) {
    if (!(field in after)) {
      changed[field] = null;
      dirty = true;
    }
  }
  return dirty ? changed : null;
}

function conflictAt(stamp: OpStamp): number {
  const wallMs = Number(stamp.hlc.split('-')[0]);
  return Number.isFinite(wallMs) && wallMs > 0 ? wallMs : Date.now();
}

/**
 * Row lookup/insert/remove for ONE table during ONE apply. Both loops share the
 * cursor so the deletes-first ordering is preserved, and every cursor is
 * flushed in a `finally` — a mid-apply throw must not leave inserts recorded in
 * `lww` but missing from the ledger.
 */
type TableCursor = {
  find(key: string): LedgerRow | undefined;
  add(row: LedgerRow): void;
  /** True iff a row was actually removed — this is what drives `result.deleted`. */
  remove(key: string): boolean;
  flush(): void;
};

export type LedgerProjection<TName extends string, TLedger extends ProjectableLedger<TName>> = {
  readonly schema: LedgerSchema<TName>;
  readonly tableKeys: Readonly<Record<TName, string>>;
  readonly tableNames: readonly TName[];
  rowBucket(table: TName, row: LedgerRow | null): string;
  /**
   * The buckets a cold open loads, or **null when this brand did not opt in** —
   * which is the signal to load everything, exactly as before.
   */
  residentBuckets(today?: string | Date): string[] | null;
  collectRowWrites(ledger: TLedger, delta: LedgerDelta<TName> | 'all'): RowWrite<TName>[];
  installRowEnvelopes(ledger: TLedger, writes: RowEnvelopeWrite<TName>[]): void;
  mergeRowEnvelopes(ledger: TLedger, writes: RowEnvelopeWrite<TName>[]): number;
  captureLedgerSnapshot(ledger: TLedger): LedgerSnapshot<TName>;
  diffLedger(before: LedgerSnapshot<TName>, ledger: TLedger): LedgerDelta<TName> | null;
  restoreDeltaFromBackup(live: TLedger, backup: TLedger): LedgerDelta<TName> | null;
  chunkLedgerDelta(delta: LedgerDelta<TName>): LedgerDelta<TName>[];
  applyLedgerDelta(
    ledger: TLedger,
    delta: LedgerDelta<TName>,
    stamp: OpStamp,
  ): ApplyDeltaResult<TName>;
  drainParkedRows(ledger: TLedger): ApplyDeltaResult<TName>;
  planTableStrategy(delta: LedgerDelta<TName>, table: TName): 'scan' | 'index';
};

/**
 * Bind the merge core to one brand's ledger schema. Everything the returned
 * object exposes is behaviourally identical to Budget V2's `projection.ts`,
 * which is the oracle this refactor was verified against.
 */
export function createLedgerProjection<
  TName extends string,
  TLedger extends ProjectableLedger<TName>,
>(schema: LedgerSchema<TName>): LedgerProjection<TName, TLedger> {
  const {
    tableKeys,
    tableNames,
    windowedDateFields,
    bucketOverride,
    logPrefix,
    isDev,
    compactLww,
    residentWindowDays,
  } = schema;

  const isLedgerTable = (table: string): table is TName => table in tableKeys;

  /**
   * TS refuses to *write* through an index whose key type is an unresolved
   * generic (TS2862), so every map keyed by `TName` is built through a plain
   * `Record<string, …>` view and re-narrowed on the way out. Purely a typing
   * accommodation — the runtime objects are the same ones Budget always used.
   */
  const asStringKeyed = <V>(value: Partial<Record<TName, V>>): Record<string, V> =>
    value as Record<string, V>;

  function rowBucket(table: TName, row: LedgerRow | null): string {
    if (!row) return ALWAYS_RESIDENT_BUCKET;
    const fields = windowedDateFields[table];
    if (fields) {
      for (const field of fields) {
        const bucket = yyyyMm(row[field]);
        if (bucket) return bucket;
      }
    }
    if (bucketOverride) {
      const override = bucketOverride(table, row);
      if (override) return override;
    }
    return ALWAYS_RESIDENT_BUCKET;
  }

  /**
   * The `'YYYY-MM'` buckets a windowed cold open loads, newest last.
   *
   * Null — not an empty array — when the brand did not opt in, because "load
   * nothing" and "load everything" are the two answers a caller must never
   * confuse. `listRows` reads an empty `buckets` array as "no window", so a
   * silent `[]` here would be the same bug in the opposite direction.
   *
   * The store adds `'*'` and every tombstone to whatever this returns, so an
   * always-resident table and the delete-vs-edit rule are outside the window by
   * construction rather than by anyone remembering to include them.
   */
  function residentBuckets(today?: string | Date): string[] | null {
    if (residentWindowDays === null) return null;
    const nowMs =
      today === undefined
        ? Date.now()
        : today instanceof Date
          ? today.getTime()
          : (dayKeyToUtcMs(today) ?? Date.now());
    // One day of FORWARD slack, and it is not decoration. Buckets are cut in
    // UTC (`rowBucket` slices the month straight out of the stored string)
    // while rows carry a LOCAL date key, so on the last evening of a month at
    // UTC+13 the device is already writing next month's bucket while UTC still
    // says this month — and the rows the member just logged would fall outside
    // their own window. A day covers the whole ±14 h span, and it also covers
    // the member who logs tomorrow's meals tonight. Anything further out is a
    // read away, like the rest of the history.
    const end = new Date(nowMs + MS_PER_DAY);
    // `days - 1` so a 1-day window is today, not today and yesterday.
    const start = new Date(nowMs - (residentWindowDays - 1) * MS_PER_DAY);
    return bucketsForRange(
      `${bucketOf(start)}-01`,
      `${bucketOf(end)}-01`,
    );
  }

  function rowsOf(ledger: TLedger, table: TName): LedgerRow[] {
    const value = (ledger as unknown as Record<string, unknown>)[table];
    return Array.isArray(value) ? (value as LedgerRow[]) : [];
  }

  function setRows(ledger: TLedger, table: TName, rows: LedgerRow[]): void {
    (ledger as unknown as Record<string, unknown>)[table] = rows;
  }

  function rowKey(table: TName, row: LedgerRow): string | null {
    const value = row[tableKeys[table]];
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    // A row with no key is invisible to the projection: it never diffs, never
    // syncs, and never reaches a peer — silently, and only for that one writer.
    // Tables re-keyed from natural keys to surrogate ids are the usual cause, so
    // a write site that still omits `id` would fail exactly this way. Fail
    // loudly in dev.
    if (isDev()) {
      throw new Error(
        `[${logPrefix}] ${table} row is missing its key field '${tableKeys[table]}' — ` +
          'it would never sync. Set the key at the write site.',
      );
    }
    return null;
  }

  const warnedKeylessTables = new Set<TName>();

  /**
   * Total variant of `rowKey` for the MERGE path only.
   *
   * The write-side throw above exists to catch a local write site that forgot to
   * set an id, and `captureLedgerSnapshot`/`diffLedger` still raise it. Merging a
   * peer's delta is different: `Array.find` short-circuits and so never visits a
   * keyless row past the match, while an index build visits every row — keeping
   * the throw here would make applying someone else's edit crash on local rows
   * that today's scan happens to walk past. A merge must never take the app down,
   * so this warns once per table and skips the row instead.
   */
  function rowKeyQuiet(table: TName, row: LedgerRow): string | null {
    const value = row[tableKeys[table]];
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (isDev() && !warnedKeylessTables.has(table)) {
      warnedKeylessTables.add(table);
      console.warn(
        `[${logPrefix}] ${table} holds a row with no '${tableKeys[table]}' — ` +
          'it is skipped by the merge and will never sync.',
      );
    }
    return null;
  }

  function makeRowWrite(
    ledger: TLedger,
    table: TName,
    key: string,
    row: LedgerRow | null,
    deleted: boolean,
  ): RowWrite<TName> {
    const lww = ledger.lww?.[table]?.[key] ?? { f: {} };
    return {
      table,
      rowKey: key,
      bucket: deleted ? ALWAYS_RESIDENT_BUCKET : rowBucket(table, row),
      deleted,
      envelope: {
        row,
        lww: compactLww ? encodeRowLww(lww, row) : lww,
      },
    };
  }

  /**
   * Rows that Stage 2 persist must write. `'all'` dumps every table plus LWW-only
   * shadows (parked patches / tombstones without a live row). A delta writes only
   * the keys the mutator touched.
   */
  function collectRowWrites(
    ledger: TLedger,
    delta: LedgerDelta<TName> | 'all',
  ): RowWrite<TName>[] {
    const writes: RowWrite<TName>[] = [];
    if (delta === 'all') {
      for (const table of tableNames) {
        const seen = new Set<string>();
        for (const row of rowsOf(ledger, table)) {
          const key = rowKeyQuiet(table, row);
          if (key == null) continue;
          seen.add(key);
          writes.push(makeRowWrite(ledger, table, key, row, false));
        }
        const tableLww = ledger.lww?.[table] ?? {};
        for (const key of Object.keys(tableLww)) {
          if (seen.has(key)) continue;
          const lww = tableLww[key]!;
          writes.push(makeRowWrite(ledger, table, key, null, Boolean(lww.del)));
        }
      }
      return writes;
    }

    for (const table of tableNames) {
      for (const rowDelta of delta.u?.[table] ?? []) {
        const row =
          rowsOf(ledger, table).find((candidate) => rowKeyQuiet(table, candidate) === rowDelta.k) ??
          null;
        writes.push(makeRowWrite(ledger, table, rowDelta.k, row, false));
      }
      for (const key of delta.d?.[table] ?? []) {
        writes.push(makeRowWrite(ledger, table, key, null, true));
      }
    }
    return writes;
  }

  function installRowEnvelopes(ledger: TLedger, writes: RowEnvelopeWrite<TName>[]): void {
    const byTable: Record<string, LedgerRow[]> = {};
    for (const table of tableNames) byTable[table] = [];
    ledger.lww = {} as LedgerLww<TName>;
    const lwwTables = asStringKeyed<Record<string, RowLww>>(ledger.lww);
    for (const write of writes) {
      if (!isLedgerTable(write.table)) continue;
      const forTable = (lwwTables[write.table] ??= {});
      // Shape-driven, NOT flag-driven: a device that wrote one form must still
      // read the other after `compactLww` moves in either direction.
      forTable[write.rowKey] = decodeRowLww(write.envelope.lww, write.envelope.row);
      if (!write.deleted && write.envelope.row) {
        byTable[write.table]!.push(write.envelope.row);
      }
    }
    for (const table of tableNames) {
      setRows(ledger, table, byTable[table]!);
    }
  }

  /**
   * Install envelopes read from disk into a ledger that is already open —
   * lazy hydration, where `installRowEnvelopes` is cold open.
   *
   * The two differ in exactly one way, and it is the whole reason this is a
   * second function rather than a flag: `installRowEnvelopes` REPLACES the
   * ledger (it clears `lww` and rebuilds every table), which is right when the
   * ledger is empty and catastrophic when it is not.
   *
   * **A row already resident is never overwritten.** Not an optimisation — a
   * safety rule. In-memory rows can be AHEAD of disk: `projectionFor` merges a
   * peer's delta into the ledger and defers the write to
   * `noteRemoteHealthOpsApplied`, so a hydration landing in that gap would
   * otherwise replace a just-merged row with its pre-merge image and drop the
   * peer's edit — silently, and only under a race. Hydration fills gaps; it
   * never reconciles, because it has nothing to reconcile WITH.
   *
   * A hydrated tombstone is honoured: the row is left out of the table (and, if
   * this is the first time the key is seen, removed if some earlier partial
   * state put it there), so widening a window can never resurrect a delete.
   *
   * Returns the number of keys it actually installed — zero means every
   * requested row was already in memory, which is the common case and the one a
   * caller may want to log rather than measure.
   */
  function mergeRowEnvelopes(ledger: TLedger, writes: RowEnvelopeWrite<TName>[]): number {
    if (writes.length === 0) return 0;
    const lwwTables = ensureLww(ledger);
    // Built per table, once, and only for tables this call actually touches: a
    // hydration of one month of meals must not walk the water log.
    const appended = new Map<TName, LedgerRow[]>();
    let installed = 0;

    for (const write of writes) {
      if (!isLedgerTable(write.table)) continue;
      const forTable = (lwwTables[write.table] ??= {});
      // Presence in `lww` IS residency: every install path writes the watermark
      // entry for a key whether the row is live, tombstoned or a parked shadow,
      // so a missing entry is the only honest "this device has not loaded it".
      if (forTable[write.rowKey] !== undefined) continue;
      forTable[write.rowKey] = decodeRowLww(write.envelope.lww, write.envelope.row);
      installed += 1;
      if (write.deleted || !write.envelope.row) continue;
      let rows = appended.get(write.table);
      if (!rows) {
        rows = [];
        appended.set(write.table, rows);
      }
      rows.push(write.envelope.row);
    }

    for (const [table, rows] of appended) {
      // One array copy per touched table, not one per row: `setRows` replaces
      // the array reference, and doing that inside the loop would be quadratic
      // on exactly the bulk hydration this function exists for.
      setRows(ledger, table, [...rowsOf(ledger, table), ...rows]);
    }
    return installed;
  }

  function captureLedgerSnapshot(ledger: TLedger): LedgerSnapshot<TName> {
    const snapshot: LedgerSnapshot<TName> = new Map();
    for (const table of tableNames) {
      const rows = new Map<string, string>();
      for (const row of rowsOf(ledger, table)) {
        const key = rowKey(table, row);
        if (key != null) rows.set(key, JSON.stringify(row));
      }
      snapshot.set(table, rows);
    }
    return snapshot;
  }

  /** Diff the post-mutation ledger against its pre-image. Null when nothing moved. */
  function diffLedger(
    before: LedgerSnapshot<TName>,
    ledger: TLedger,
  ): LedgerDelta<TName> | null {
    const upserts: Record<string, RowDelta[]> = {};
    const deletes: Record<string, string[]> = {};
    let touched = false;

    for (const table of tableNames) {
      const previous = before.get(table) ?? new Map<string, string>();
      const seen = new Set<string>();
      const tableUpserts: RowDelta[] = [];

      for (const row of rowsOf(ledger, table)) {
        const key = rowKey(table, row);
        if (key == null) continue;
        seen.add(key);
        const beforeJson = previous.get(key);
        if (beforeJson === undefined) {
          tableUpserts.push({ k: key, f: { ...row }, n: 1 });
          continue;
        }
        const changed = changedFields(beforeJson, row);
        if (changed) tableUpserts.push({ k: key, f: changed });
      }

      const tableDeletes: string[] = [];
      for (const key of previous.keys()) {
        if (!seen.has(key)) tableDeletes.push(key);
      }

      if (tableUpserts.length > 0) {
        upserts[table] = tableUpserts;
        touched = true;
      }
      if (tableDeletes.length > 0) {
        deletes[table] = tableDeletes;
        touched = true;
      }
    }

    if (!touched) return null;
    const delta: LedgerDelta<TName> = { v: 1 };
    if (Object.keys(upserts).length > 0) delta.u = upserts as LedgerDelta<TName>['u'];
    if (Object.keys(deletes).length > 0) delta.d = deletes as LedgerDelta<TName>['d'];
    return delta;
  }

  /**
   * Upserts the backup would apply onto `live`. Live-only rows are left alone
   * (deletes stripped) so a restore cannot drop data this device already has.
   */
  function restoreDeltaFromBackup(live: TLedger, backup: TLedger): LedgerDelta<TName> | null {
    const probe = { ...live } as TLedger;
    for (const table of tableNames) {
      const rows = (backup as unknown as Record<string, unknown>)[table];
      (probe as unknown as Record<string, unknown>)[table] = Array.isArray(rows) ? rows : [];
    }
    const delta = diffLedger(captureLedgerSnapshot(live), probe);
    if (!delta) return null;
    delete delta.d;
    const hasUpserts = Object.values(delta.u ?? {}).some(
      (rows) => ((rows as RowDelta[] | undefined)?.length ?? 0) > 0,
    );
    return hasUpserts ? delta : null;
  }

  /** Pack a restore delta so each op stays under the mailbox plaintext budget. */
  function chunkLedgerDelta(delta: LedgerDelta<TName>): LedgerDelta<TName>[] {
    const flat: Array<{ table: TName; row: RowDelta }> = [];
    for (const table of tableNames) {
      for (const row of delta.u?.[table] ?? []) {
        flat.push({ table, row });
      }
    }
    if (flat.length === 0) return [];
    return chunkRowsForOp(flat).map((chunk) => {
      const u: Record<string, RowDelta[]> = {};
      for (const { table, row } of chunk) {
        (u[table] ??= []).push(row);
      }
      return { v: 1 as const, u: u as LedgerDelta<TName>['u'] };
    });
  }

  function ensureLww(ledger: TLedger): Record<string, Record<string, RowLww>> {
    if (!ledger.lww) ledger.lww = {} as LedgerLww<TName>;
    return asStringKeyed<Record<string, RowLww>>(ledger.lww);
  }

  function rowLww(ledger: TLedger, table: TName, key: string): RowLww {
    const forTable = (ensureLww(ledger)[table] ??= {});
    return (forTable[key] ??= { f: {} });
  }

  function recordConflict(ledger: TLedger, conflict: LedgerConflict<TName>): void {
    if (!ledger.conflicts) ledger.conflicts = [];
    if (ledger.conflicts.some((existing) => existing.id === conflict.id)) return;
    ledger.conflicts.push(conflict);
    if (ledger.conflicts.length > MAX_TRACKED_CONFLICTS) {
      ledger.conflicts.splice(0, ledger.conflicts.length - MAX_TRACKED_CONFLICTS);
    }
  }

  /** Today's exact operations: linear scan, copy-on-write per mutation. */
  function createScanCursor(ledger: TLedger, table: TName): TableCursor {
    return {
      find(key) {
        return rowsOf(ledger, table).find((row) => rowKeyQuiet(table, row) === key);
      },
      add(row) {
        setRows(ledger, table, [...rowsOf(ledger, table), row]);
      },
      remove(key) {
        // One pass instead of find-then-filter: the length delta reports whether
        // the row existed, which is exactly what the old `find` was used for.
        const rows = rowsOf(ledger, table);
        const kept = rows.filter((row) => rowKeyQuiet(table, row) !== key);
        if (kept.length === rows.length) return false;
        setRows(ledger, table, kept);
        return true;
      },
      flush() {},
    };
  }

  /**
   * One array copy plus one Map build up front, then O(1) per row. New rows are
   * still appended at the end and removals still preserve relative order, so the
   * resulting array is identical to what the scan cursor produces.
   */
  function createIndexedCursor(ledger: TLedger, table: TName): TableCursor {
    const rows = rowsOf(ledger, table).slice();
    const index = new Map<string, LedgerRow>();
    for (const row of rows) {
      const key = rowKeyQuiet(table, row);
      if (key == null) continue;
      if (index.has(key)) {
        // Duplicate keys are impossible by construction, but the scan cursor's
        // `filter` removes ALL matches while an index removes one. Rather than
        // silently changing that, fall back to the semantics we know.
        return createScanCursor(ledger, table);
      }
      index.set(key, row);
    }

    const removed = new Set<LedgerRow>();
    let dirty = false;
    return {
      find(key) {
        return index.get(key);
      },
      add(row) {
        const key = rowKeyQuiet(table, row);
        rows.push(row);
        if (key != null) index.set(key, row);
        dirty = true;
      },
      remove(key) {
        const row = index.get(key);
        if (!row) return false;
        index.delete(key);
        removed.add(row);
        dirty = true;
        return true;
      },
      flush() {
        if (!dirty) return;
        setRows(ledger, table, removed.size > 0 ? rows.filter((row) => !removed.has(row)) : rows);
      },
    };
  }

  /**
   * Parked-row count per ledger, re-derived by one scan on first use. Cached
   * rather than persisted so a cold open, an account switch and
   * `adoptJoinedHousehold` (which replaces the ledger object and empties `lww`)
   * all recover the right number with no stored counter to get out of sync.
   */
  const parkedRowCounts = new WeakMap<object, number>();

  function parkedRowCount(ledger: TLedger): number {
    const cached = parkedRowCounts.get(ledger as object);
    if (cached !== undefined) return cached;
    let count = 0;
    for (const forTable of Object.values(ledger.lww ?? {})) {
      if (!forTable) continue;
      for (const meta of Object.values(forTable as Record<string, RowLww>)) {
        if (meta.p) count += 1;
      }
    }
    parkedRowCounts.set(ledger as object, count);
    return count;
  }

  function dropParked(ledger: TLedger, meta: RowLww): void {
    if (!meta.p) return;
    delete meta.p;
    const count = parkedRowCounts.get(ledger as object);
    if (count !== undefined) parkedRowCounts.set(ledger as object, Math.max(0, count - 1));
  }

  /** Oldest parked stamp on a row — the eviction key. */
  function oldestParkedStamp(meta: RowLww): string | null {
    let oldest: string | null = null;
    for (const parked of Object.values(meta.p ?? {})) {
      if (oldest === null || compareStamps(decodeStamp(parked.s), decodeStamp(oldest)) < 0) {
        oldest = parked.s;
      }
    }
    return oldest;
  }

  function evictOldestParked(ledger: TLedger, target: number): void {
    // Wave-1 (§4.5): drop oldest parked rows with no conflict. A conflict would
    // claim a peer still holds the patch — they do not; the create never arrived.
    // Bounded silent loss under an orphan storm is accepted until GA.
    const entries: Array<{ meta: RowLww; stamp: string }> = [];
    for (const forTable of Object.values(ledger.lww ?? {})) {
      if (!forTable) continue;
      for (const meta of Object.values(forTable as Record<string, RowLww>)) {
        if (!meta.p) continue;
        entries.push({ meta, stamp: oldestParkedStamp(meta) ?? '' });
      }
    }
    entries.sort((a, b) => compareStamps(decodeStamp(a.stamp), decodeStamp(b.stamp)));
    const drop = entries.length - target;
    for (let i = 0; i < drop; i += 1) delete entries[i]!.meta.p;
    parkedRowCounts.set(ledger as object, Math.max(0, entries.length - Math.max(0, drop)));
  }

  /**
   * Hold a patch whose create has not arrived. Previously these were dropped and
   * the op marked applied, so the peer's edit was lost permanently and silently
   * (audit B4) — nothing was ever buffered despite the comment claiming so.
   */
  function parkOrphanPatch(
    ledger: TLedger,
    meta: RowLww,
    rowDelta: RowDelta,
    stamp: OpStamp,
    encoded: string,
  ): void {
    const isNewParkedRow = !meta.p;
    // Count BEFORE `meta.p` exists, or a cold-cache scan would already see this
    // row and the increment below would double-count it.
    const previousCount = isNewParkedRow ? parkedRowCount(ledger) : 0;
    const parked = (meta.p ??= {});
    for (const [field, value] of Object.entries(rowDelta.f)) {
      const current = parked[field];
      // LWW between two parked patches: the loser would have lost in-order too,
      // so it is dropped without a conflict.
      if (current && compareStamps(stamp, decodeStamp(current.s)) <= 0) continue;
      parked[field] = { v: value, s: encoded, o: stamp.opId };
    }
    if (!isNewParkedRow) return;
    const count = previousCount + 1;
    parkedRowCounts.set(ledger as object, count);
    if (count > MAX_PARKED_ROWS) evictOldestParked(ledger, Math.floor(MAX_PARKED_ROWS * 0.9));
  }

  /**
   * Replay parked fields onto a row that has just materialized, as if the patches
   * had arrived in order: a parked field that wins overwrites silently, one that
   * loses records a `field_lww` conflict carrying the SAME id the in-order path
   * mints, so `recordConflict`'s dedupe still absorbs replays.
   *
   * Called from BOTH upsert branches. The remote-create branch is not the only
   * way a parked row appears: `mutateLocalLedger` runs its mutator before the op
   * is appended and the OpLog fires the projection after, so a locally-written
   * row is ALREADY in the ledger when its own `n:1` delta is projected and that
   * delta takes the patch branch. With deterministic ids (`goal_${year}_${month}`)
   * both members reach the same key without either create ever crossing the wire,
   * so draining only on create stranded the peer's patch permanently — the exact
   * loss (audit B4) parking exists to prevent, one branch over.
   *
   * Returns true when the row was actually modified, so the patch branch can
   * count the row as applied even if the op's own fields all lost.
   */
  function applyParkedFields(
    ledger: TLedger,
    table: TName,
    key: string,
    target: LedgerRow,
    meta: RowLww,
    result: ApplyDeltaResult<TName>,
  ): boolean {
    if (!meta.p) return false;
    let changed = false;
    for (const [field, parked] of Object.entries(meta.p)) {
      const parkedStamp: OpStamp = { ...decodeStamp(parked.s), opId: parked.o };
      if (wins(parkedStamp, meta.f[field])) {
        target[field] = parked.v;
        meta.f[field] = parked.s;
        changed = true;
      } else if (meta.f[field] !== parked.s) {
        result.conflicts.push({
          id: `${parked.o}:${table}:${key}:${field}`,
          table,
          rowKey: key,
          field,
          kind: 'field_lww',
          winner: meta.f[field]!,
          loser: parked.s,
          loserMemberId: parkedStamp.authorMemberId || null,
          at: conflictAt(parkedStamp),
        });
      }
    }
    dropParked(ledger, meta);
    return changed;
  }

  /**
   * Merge a peer (or replayed local) delta into the ledger under LWW.
   * Idempotent for a given stamp: re-applying the same op is a no-op because
   * every field comparison is strict-greater-than.
   */
  function applyLedgerDelta(
    ledger: TLedger,
    delta: LedgerDelta<TName>,
    stamp: OpStamp,
  ): ApplyDeltaResult<TName> {
    const result: ApplyDeltaResult<TName> = { applied: 0, deleted: 0, conflicts: [] };
    const encoded = encodeStamp(stamp);

    // One cursor per table, shared by BOTH loops so deletes-first ordering still
    // holds, and created lazily so a table the delta never mentions costs
    // nothing. Above LEDGER_INDEX_THRESHOLD touched rows it indexes; below it,
    // scanning is measurably cheaper than building the Map.
    const cursors = new Map<TName, TableCursor>();
    const cursorFor = (table: TName): TableCursor => {
      let cursor = cursors.get(table);
      if (!cursor) {
        cursor =
          planTableStrategy(delta, table) === 'index'
            ? createIndexedCursor(ledger, table)
            : createScanCursor(ledger, table);
        cursors.set(table, cursor);
      }
      return cursor;
    };

    try {
      // Deletes first: the tombstone is absorbing, so an upsert in the same op for
      // the same row (bulk delete-then-recreate) must not be resurrected by
      // ordering luck.
      for (const [table, keys] of Object.entries(delta.d ?? {}) as Array<[TName, string[]]>) {
        if (!isLedgerTable(table)) continue;
        const cursor = cursorFor(table);
        for (const key of keys) {
          const meta = rowLww(ledger, table, key);

          // Surface an edit the tombstone is about to discard (BR-044) — both the
          // fields already merged onto the row and any patch still parked waiting
          // for a create that this tombstone now makes moot.
          for (const [field, fieldStamp] of Object.entries(meta.f)) {
            if (compareStamps(stamp, decodeStamp(fieldStamp)) < 0) {
              result.conflicts.push({
                id: `${stamp.opId}:${table}:${key}:${field}:del`,
                table,
                rowKey: key,
                field,
                kind: 'edit_vs_delete',
                winner: encoded,
                loser: fieldStamp,
                loserMemberId: decodeStamp(fieldStamp).authorMemberId || null,
                at: conflictAt(stamp),
              });
            }
          }
          for (const [field, parked] of Object.entries(meta.p ?? {})) {
            if (field in meta.f) continue;
            if (compareStamps(stamp, decodeStamp(parked.s)) < 0) {
              result.conflicts.push({
                id: `${stamp.opId}:${table}:${key}:${field}:del`,
                table,
                rowKey: key,
                field,
                kind: 'edit_vs_delete',
                winner: encoded,
                loser: parked.s,
                loserMemberId: decodeStamp(parked.s).authorMemberId || null,
                at: conflictAt(stamp),
              });
            }
          }

          // Keep the newest tombstone stamp, compared the same way every other
          // stamp is — raw string compare would order the variable-length device
          // suffix differently from `compareStamps`.
          if (wins(stamp, meta.del)) meta.del = encoded;
          meta.f = {};
          // The tombstone is absorbing, so it absorbs parked patches too.
          dropParked(ledger, meta);
          if (cursor.remove(key)) result.deleted += 1;
        }
      }

      for (const [table, rows] of Object.entries(delta.u ?? {}) as Array<[TName, RowDelta[]]>) {
        if (!isLedgerTable(table)) continue;
        const cursor = cursorFor(table);
        for (const rowDelta of rows) {
          const meta = rowLww(ledger, table, rowDelta.k);

          if (meta.del) {
            // Tombstone wins. Record the discarded intent so the member is told
            // rather than left wondering where the edit went.
            result.conflicts.push({
              id: `${stamp.opId}:${table}:${rowDelta.k}:tombstone`,
              table,
              rowKey: rowDelta.k,
              field: null,
              kind: 'edit_vs_delete',
              winner: meta.del,
              loser: encoded,
              loserMemberId: stamp.authorMemberId || null,
              at: conflictAt(stamp),
            });
            continue;
          }

          const target = cursor.find(rowDelta.k);

          if (!target) {
            if (!rowDelta.n) {
              // A patch for a row this replica has never seen and no tombstone to
              // explain it: the create op has not arrived yet. Materializing a
              // partial row would project a half-built entity into the UI, so the
              // fields are PARKED and replayed when the create lands. Dropping
              // them (what this did before) lost the peer's edit forever, because
              // the op is marked applied and never reconsidered.
              parkOrphanPatch(ledger, meta, rowDelta, stamp, encoded);
              continue;
            }
            const created: LedgerRow = { ...rowDelta.f };
            const key = rowKey(table, created);
            if (key == null) continue;
            for (const field of Object.keys(rowDelta.f)) meta.f[field] = encoded;
            applyParkedFields(ledger, table, rowDelta.k, created, meta, result);
            cursor.add(created);
            result.applied += 1;
            continue;
          }

          let changed = false;
          for (const [field, value] of Object.entries(rowDelta.f)) {
            if (wins(stamp, meta.f[field])) {
              target[field] = value;
              meta.f[field] = encoded;
              changed = true;
            } else if (meta.f[field] !== encoded && !jsonValueEquals(target[field], value)) {
              // Someone else's newer write already owns this field — and holds
              // a DIFFERENT value. A losing write that carries what is already
              // on the row discarded no intent: two replicas that derived the
              // same result independently (a deterministic dedupe, an
              // idempotent repair) must not read as a fight.
              result.conflicts.push({
                id: `${stamp.opId}:${table}:${rowDelta.k}:${field}`,
                table,
                rowKey: rowDelta.k,
                field,
                kind: 'field_lww',
                winner: meta.f[field]!,
                loser: encoded,
                loserMemberId: stamp.authorMemberId || null,
                at: conflictAt(stamp),
              });
            }
          }
          // Same ordering as the create branch — the op's own fields are stamped
          // first, then the parked patch competes against them — so the replay
          // mints byte-identical conflict ids either way and the dedupe holds.
          if (applyParkedFields(ledger, table, rowDelta.k, target, meta, result)) changed = true;
          if (changed) result.applied += 1;
        }
      }
    } finally {
      // Never leave inserts recorded in `lww` but missing from the ledger.
      for (const cursor of cursors.values()) cursor.flush();
    }

    for (const conflict of result.conflicts) recordConflict(ledger, conflict);
    return result;
  }

  /**
   * Replay every parked patch whose row now exists, for writes that never produce
   * a delta at all.
   *
   * `applyLedgerDelta` drains a row on both of its upsert branches, which covers
   * every op — local or remote. Restore now also goes through `applyLedgerDelta`
   * (ancient stamp). This sweep remains for any wholesale table write that still
   * bypasses a delta.
   *
   * Bounded by MAX_PARKED_ROWS, and the per-table index is built only for tables
   * that actually hold a parked row, so a ledger with none costs one Object.keys.
   */
  function drainParkedRows(ledger: TLedger): ApplyDeltaResult<TName> {
    const result: ApplyDeltaResult<TName> = { applied: 0, deleted: 0, conflicts: [] };
    for (const [table, forTable] of Object.entries(ledger.lww ?? {}) as Array<
      [TName, Record<string, RowLww> | undefined]
    >) {
      if (!forTable || !isLedgerTable(table)) continue;
      let index: Map<string, LedgerRow> | null = null;
      for (const [key, meta] of Object.entries(forTable)) {
        if (!meta.p) continue;
        if (!index) {
          index = new Map();
          for (const row of rowsOf(ledger, table)) {
            const rk = rowKeyQuiet(table, row);
            if (rk != null && !index.has(rk)) index.set(rk, row);
          }
        }
        const target = index.get(key);
        if (!target) continue;
        if (applyParkedFields(ledger, table, key, target, meta, result)) result.applied += 1;
      }
    }
    for (const conflict of result.conflicts) recordConflict(ledger, conflict);
    return result;
  }

  return {
    schema,
    tableKeys,
    tableNames,
    rowBucket,
    residentBuckets,
    collectRowWrites,
    installRowEnvelopes,
    mergeRowEnvelopes,
    captureLedgerSnapshot,
    diffLedger,
    restoreDeltaFromBackup,
    chunkLedgerDelta,
    applyLedgerDelta,
    drainParkedRows,
    planTableStrategy,
  };
}

export type { RowEnvelope, RowWrite };
