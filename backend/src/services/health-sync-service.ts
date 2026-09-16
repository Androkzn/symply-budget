import { and, eq, getTableColumns, inArray, type SQL } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';

import {
  bodyMeasurements,
  cycleSettings,
  cycleSymptomEntries,
  habitLogs,
  healthEntries,
  healthGoals,
  mensHealthEntries,
  nutritionEntries,
  periodEntries,
  userHabits,
  waterEntries,
  weightEntries,
} from '../db/schema-health';

/**
 * Symply Health multi-device SYNC — the PUSH half of the contract.
 *
 * `HealthService.sync()` is the delta PULL (`GET /health/sync?since=`); this is
 * the write path a second device needs (`POST /health/sync/push`). Together they
 * are the whole contract, and the two halves must agree on one clock.
 *
 * ── The conflict strategy ───────────────────────────────────────────────────
 *
 * 1. LAST-WRITE-WINS BY `updated_at`, PER ROW — never per batch. Every row in a
 *    push is reconciled against the server row it targets and decided on its
 *    own: one stale row in a batch is rejected while its neighbours apply. The
 *    per-row verdict is returned (`results`) so the client can re-pull exactly
 *    the rows it lost and keep the rest.
 *
 * 2. THE CLIENT'S `updated_at` IS PERSISTED VERBATIM (normalised to ISO-8601
 *    UTC, never replaced with server `now`). This is the single decision that
 *    makes the rest work:
 *      - stamping server `now` would make "whoever pushed LAST wins" instead of
 *        "whoever EDITED last wins" — a device syncing after a week offline
 *        would clobber edits made yesterday on another device;
 *      - and a replay of an already-applied push would then look strictly older
 *        than the row it created, i.e. every retry would report itself stale.
 *    Persisting the client stamp makes a replay compare EQUAL, which is what
 *    makes §4 (idempotency) fall out for free.
 *    The cost is that the conflict clock is the DEVICE clock. Guard: a stamp
 *    more than `CLOCK_SKEW_TOLERANCE_MS` in the future is rejected `invalid`, so
 *    a phone with a broken clock cannot pin a row that no other device can ever
 *    beat. Normalising to `…Z` also keeps the pull correct — `GET /sync`
 *    compares `updated_at >= since` as TEXT in SQL, so an offset stamp like
 *    `+02:00` would sort wrong and silently vanish from every future pull.
 *
 * 3. TOMBSTONES WIN TIES. At an EQUAL `updated_at`, a delete beats an edit: the
 *    incoming tombstone is applied, and an incoming edit against an already
 *    tombstoned row is refused (`tombstoned`) rather than resurrecting it. This
 *    is the classic sync bug and the reason `deleted_at` exists on every table.
 *    A STRICTLY newer edit does win over a tombstone — that is a deliberate
 *    re-create ("undo delete"), not a race.
 *
 * 4. IDEMPOTENT. Re-pushing an already-applied row compares equal on both the
 *    key and the timestamp, so it is reported `unchanged` and NOT written. A
 *    retry after a dropped response is therefore free, and duplicate rows inside
 *    ONE batch collapse the same way (the in-memory row map is updated as each
 *    write lands, so the second copy sees the first).
 *
 * 5. NATURAL-KEY MERGE. `cycle_settings`, `period_entries`,
 *    `cycle_symptom_entries`, `mens_health_entries`, `habit_logs` and
 *    `health_goals` are day-slots, not movable records: they reconcile on their
 *    UNIQUE natural key, never on the client id. A second device that invented
 *    its own id for "my period on 2026-06-01" MERGES into the existing row and
 *    the SERVER id is kept and returned as `server_id`, so the client can re-key
 *    its local copy instead of creating a duplicate the UNIQUE index would
 *    reject anyway.
 *
 * 6. USER-SCOPED, ALWAYS. `user_id` is taken from the token and never from the
 *    payload. A row carrying another user's `user_id`, or targeting an id (or,
 *    for `habit_logs`, a `habit_id`) owned by someone else, is rejected outright
 *    and never written. Note `habit_logs` is UNIQUE on (habit_id, date) with no
 *    user column in the key — so without the habit-ownership check a crafted
 *    push could overwrite ANOTHER user's log through the natural key. That check
 *    is load-bearing, not defensive decoration.
 *
 * 7. CURSOR SEMANTICS MATCH THE PULL. `GET /sync` filters with `gte` (inclusive)
 *    so a row stamped exactly at the cursor is re-DELIVERED rather than missed —
 *    at-least-once, never at-most-once. Push keeps that bargain from the other
 *    side: re-delivered rows come back as `unchanged`, so the redundancy the
 *    inclusive cursor creates costs a comparison, not a duplicate. The response
 *    carries `server_time` for the client to store as its next pull cursor.
 *
 * ── Not ported from the donor (`Simply Health/backend/src/routes/sync.ts`) ───
 *
 * The donor's `processClientChanges()` is a blind `ON CONFLICT(id) DO UPDATE`
 * with `updated_at` bound to server `now`: no staleness check, no tombstone
 * precedence, no per-row feedback — the client always wins, so a stale device
 * silently overwrites newer data. That is what this replaces, deliberately.
 *
 * Also left behind: the donor's `POST /sync/priority` current-week fast path;
 * folding the pull INTO the push response (kept separate so `GET /sync` stays
 * the one cursor contract); its D1 `batch()` retry loop (per-row writes are
 * idempotent, so a client retry is the recovery path); its food-category
 * detection on nutrition writes (a P2 challenges concern, not sync); and its
 * `updated_at = CASE WHEN data != excluded.data …` loop guard on health_entries
 * (unnecessary once the client stamp is what gets stored — an unchanged row
 * compares equal and is never rewritten).
 *
 * ── Deliberate boundaries ───────────────────────────────────────────────────
 *
 * - `health_weekly_weight_averages` is a DERIVED rollup owned by
 *   `HealthService.recomputeWeeklyAverage()`, not a synced table, so a push does
 *   not recompute it (the donor's sync does not either). Re-deriving it here
 *   would fork the domain's rollup maths into a second source of truth; it
 *   self-heals on the next weight write through the domain API.
 * - `health_entries` is id-keyed on purpose: several workouts a day are
 *   legitimate rows, so there is no natural key to merge on. The one-steps-row-
 *   per-day shape is a client convention (`HealthService.setSteps`), not a
 *   UNIQUE constraint, and sync does not invent one.
 * - `mens_health_settings` and the P2 tables (custom_foods, recipes, injuries,
 *   user_files, …) have no writer here yet; a client pushing them is told so via
 *   `unsupported` rather than having those rows silently dropped.
 *
 * ── Execution shape ─────────────────────────────────────────────────────────
 *
 * Reads are batched (one SELECT per collection, plus one habit-ownership SELECT)
 * and writes are issued per row: the accept/reject map REQUIRES a decision per
 * row, which a blanket batch upsert cannot express. D1 has no interactive
 * transaction, so a mid-batch failure leaves the earlier rows applied — which is
 * safe precisely because the operation is idempotent: the client replays and the
 * already-applied rows report `unchanged`.
 */

/** Rows a single push may carry — keeps one request inside D1's query budget. */
export const MAX_PUSH_ROWS = 500;

/** A device clock may run this far ahead before its rows are refused. */
export const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Collections a push may carry, PARENTS FIRST: a habit created on the device in
 * the same batch as its completion log must exist before the log's FK is checked.
 */
export const PUSH_COLLECTIONS = [
  'habits',
  'habit_logs',
  'weight_entries',
  'water_entries',
  'nutrition_entries',
  'body_measurements',
  'health_entries',
  'cycle_settings',
  'period_entries',
  'cycle_symptom_entries',
  'mens_health_entries',
  'health_goals',
] as const;

export type PushCollection = (typeof PUSH_COLLECTIONS)[number];

/**
 * - `applied`    — written (see `action`).
 * - `unchanged`  — recognised, nothing to write (replay, or an equal-stamp tie
 *                  between two edits, which the server row wins deterministically).
 * - `stale`      — the server row is strictly newer; the client must re-pull.
 * - `tombstoned` — refused so a delete is not undone (see strategy §3).
 * - `forbidden`  — belongs to, or points at, another user. Never written.
 * - `invalid`    — failed a shape/timestamp/constraint guard.
 */
export type PushStatus = 'applied' | 'unchanged' | 'stale' | 'tombstoned' | 'forbidden' | 'invalid';

export type PushAction = 'inserted' | 'updated' | 'deleted';

export interface PushRowResult {
  /** Position in the pushed array — the only handle a row without an id has. */
  index: number;
  /** The id the client sent, echoed back so it can match without counting. */
  id: string | null;
  /** Canonical server id — differs from `id` after a natural-key merge. */
  server_id: string | null;
  status: PushStatus;
  action?: PushAction;
  reason?: string;
  /** The winning row's stamp, so a rejected client knows what it is behind. */
  server_updated_at?: string;
}

export type PushSummary = Record<PushStatus, number> & { total: number };

export interface HealthPushResponse {
  /** Fresh cursor the client stores for its next `GET /sync?since=`. */
  server_time: string;
  summary: PushSummary;
  results: Partial<Record<PushCollection, PushRowResult[]>>;
  /**
   * Collection keys this Worker does not accept (a newer client pushing a table
   * this build has no writer for). Reported rather than silently dropped — the
   * client must keep those rows dirty instead of clearing its flag.
   */
  unsupported: string[];
}

export type PushChanges = Record<string, unknown[]>;

/** Columns this service owns; a payload can never set them directly. */
const MANAGED_COLUMNS = new Set(['id', 'user_id', 'created_at', 'updated_at', 'deleted_at']);

interface TableSpec {
  table: SQLiteTable;
  /** Prefix for a server-minted id when the client sends a row without one. */
  idPrefix: string;
  /**
   * `null` = the client id IS the identity. Otherwise the UNIQUE natural key the
   * row reconciles on; `user_id` is bound to the token, never to the payload.
   */
  naturalKey: readonly string[] | null;
  /** Table carries `deleted_at`, so a delete is a tombstone rather than a purge. */
  softDelete: boolean;
  /** A column whose target row must belong to the caller (habit_logs.habit_id). */
  ownerRef?: { column: string; table: SQLiteTable };
}

const TABLE_SPECS: Record<PushCollection, TableSpec> = {
  habits: { table: userHabits, idPrefix: 'habit', naturalKey: null, softDelete: true },
  habit_logs: {
    table: habitLogs,
    idPrefix: 'hlog',
    naturalKey: ['habit_id', 'date'],
    softDelete: true,
    ownerRef: { column: 'habit_id', table: userHabits },
  },
  weight_entries: { table: weightEntries, idPrefix: 'w', naturalKey: null, softDelete: true },
  water_entries: { table: waterEntries, idPrefix: 'h2o', naturalKey: null, softDelete: true },
  nutrition_entries: { table: nutritionEntries, idPrefix: 'n', naturalKey: null, softDelete: true },
  body_measurements: { table: bodyMeasurements, idPrefix: 'bm', naturalKey: null, softDelete: true },
  health_entries: { table: healthEntries, idPrefix: 'he', naturalKey: null, softDelete: true },
  cycle_settings: {
    table: cycleSettings,
    idPrefix: 'cyset',
    naturalKey: ['user_id'],
    softDelete: false,
  },
  period_entries: {
    table: periodEntries,
    idPrefix: 'per',
    naturalKey: ['user_id', 'date'],
    softDelete: true,
  },
  cycle_symptom_entries: {
    table: cycleSymptomEntries,
    idPrefix: 'sym',
    naturalKey: ['user_id', 'date'],
    softDelete: true,
  },
  mens_health_entries: {
    table: mensHealthEntries,
    idPrefix: 'mh',
    naturalKey: ['user_id', 'date'],
    softDelete: true,
  },
  health_goals: {
    table: healthGoals,
    idPrefix: 'goal',
    naturalKey: ['user_id', 'effective_date'],
    softDelete: false,
  },
};

type Row = Record<string, unknown>;
type Columns = Record<string, SQLiteColumn>;

function columnsOf(table: SQLiteTable): Columns {
  return getTableColumns(table) as unknown as Columns;
}

/**
 * ISO-8601 UTC with milliseconds — the ONE stamp format in the health tables.
 * `GET /sync` compares `updated_at` as TEXT, so a `+02:00` offset or a
 * second-precision stamp would sort against `…T00:00:00.000Z` incorrectly and
 * fall out of every later pull.
 */
function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function isPlainObject(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** JSON primitive → the column's declared driver type, or a hard reject. */
function coerceValue(column: SQLiteColumn, value: unknown): { ok: true; value: unknown } | { ok: false } {
  if (value === null || value === undefined) {
    return column.notNull ? { ok: false } : { ok: true, value: null };
  }
  switch (column.dataType) {
    case 'string':
      return typeof value === 'string' ? { ok: true, value } : { ok: false };
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? { ok: true, value } : { ok: false };
    case 'boolean':
      if (typeof value === 'boolean') return { ok: true, value };
      // A client that round-trips through SQLite sees 0/1, not true/false.
      if (value === 0 || value === 1) return { ok: true, value: value === 1 };
      return { ok: false };
    default:
      return { ok: false };
  }
}

/** A row that failed a guard before any lookup — never reaches the database. */
interface RejectedRow {
  kind: 'rejected';
  result: PushRowResult;
}

interface CandidateRow {
  kind: 'candidate';
  index: number;
  raw: Row;
  clientId: string | null;
  updatedAt: string;
  deletedAt: string | null;
  /** Identity used to find the server row: the client id, or the natural key. */
  lookupKey: string | null;
  /** Natural key values in spec order (empty for id-keyed tables). */
  naturalValues: string[];
}

type PreparedRow = RejectedRow | CandidateRow;

const KEY_SEPARATOR = ' ';

export class HealthSyncService {
  private db: DrizzleD1Database;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  /**
   * Reconcile a batch of client-side changes.
   *
   * Never throws for row-level problems — a bad row becomes a rejection in the
   * result map so the rest of the batch still lands.
   */
  async push(userId: string, changes: PushChanges = {}): Promise<HealthPushResponse> {
    const results: Partial<Record<PushCollection, PushRowResult[]>> = {};
    const summary: PushSummary = {
      total: 0,
      applied: 0,
      unchanged: 0,
      stale: 0,
      tombstoned: 0,
      forbidden: 0,
      invalid: 0,
    };

    const known = new Set<string>(PUSH_COLLECTIONS);
    const unsupported = Object.keys(changes).filter(
      (key) => !known.has(key) && Array.isArray(changes[key]) && changes[key].length > 0
    );

    for (const collection of PUSH_COLLECTIONS) {
      const rows = changes[collection];
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const collectionResults = await this.reconcileCollection(userId, collection, rows);
      results[collection] = collectionResults;
      for (const result of collectionResults) {
        summary.total += 1;
        summary[result.status] += 1;
      }
    }

    return { server_time: new Date().toISOString(), summary, results, unsupported };
  }

  /* ---------------------------------------------------------------- */
  /* Per-collection reconciliation                                     */
  /* ---------------------------------------------------------------- */

  private async reconcileCollection(
    userId: string,
    collection: PushCollection,
    rows: unknown[]
  ): Promise<PushRowResult[]> {
    const spec = TABLE_SPECS[collection];
    const columns = columnsOf(spec.table);
    const nowMs = Date.now();

    const prepared = rows.map((raw, index) => prepareRow(raw, index, spec, userId, nowMs));
    const candidates = prepared.filter((p): p is CandidateRow => p.kind === 'candidate');

    const existing = await this.loadExisting(userId, spec, columns, candidates);
    const habitOwners = spec.ownerRef ? await this.loadOwners(spec, candidates) : null;

    const results: PushRowResult[] = [];
    for (const item of prepared) {
      if (item.kind === 'rejected') {
        results.push(item.result);
        continue;
      }
      results.push(await this.reconcileRow(userId, spec, columns, item, existing, habitOwners));
    }
    return results;
  }

  /** One SELECT per collection — the whole batch's server rows in a single read. */
  private async loadExisting(
    userId: string,
    spec: TableSpec,
    columns: Columns,
    candidates: CandidateRow[]
  ): Promise<Map<string, Row>> {
    const map = new Map<string, Row>();
    if (candidates.length === 0) return map;

    const conditions: SQL[] = [];
    if (spec.naturalKey === null) {
      const ids = [...new Set(candidates.map((c) => c.clientId).filter((id): id is string => !!id))];
      if (ids.length === 0) return map;
      // Deliberately NOT scoped by user_id: an id owned by someone else must be
      // FOUND so it can be rejected, not missed and then inserted.
      conditions.push(inArray(columns.id, ids));
    } else {
      spec.naturalKey.forEach((keyColumn, position) => {
        if (keyColumn === 'user_id') {
          conditions.push(eq(columns.user_id, userId));
          return;
        }
        const values = [...new Set(candidates.map((c) => c.naturalValues[position]))];
        conditions.push(inArray(columns[keyColumn], values));
      });
    }

    const found = (await this.db
      .select()
      .from(spec.table)
      .where(conditions.length === 1 ? conditions[0] : and(...conditions))
      .all()) as unknown as Row[];

    for (const row of found) map.set(rowKey(spec, row), row);
    return map;
  }

  /** Ownership of every `habit_id` the batch references, in one read. */
  private async loadOwners(
    spec: TableSpec,
    candidates: CandidateRow[]
  ): Promise<Map<string, string>> {
    const owners = new Map<string, string>();
    const ref = spec.ownerRef;
    if (!ref) return owners;
    const ids = [
      ...new Set(
        candidates
          .map((c) => c.raw[ref.column])
          .filter((value): value is string => typeof value === 'string' && value !== '')
      ),
    ];
    if (ids.length === 0) return owners;

    const refColumns = columnsOf(ref.table);
    const found = (await this.db
      .select()
      .from(ref.table)
      .where(inArray(refColumns.id, ids))
      .all()) as unknown as Row[];
    for (const row of found) owners.set(String(row.id), String(row.user_id));
    return owners;
  }

  /* ---------------------------------------------------------------- */
  /* The conflict decision                                             */
  /* ---------------------------------------------------------------- */

  private async reconcileRow(
    userId: string,
    spec: TableSpec,
    columns: Columns,
    item: CandidateRow,
    existing: Map<string, Row>,
    habitOwners: Map<string, string> | null
  ): Promise<PushRowResult> {
    const base = { index: item.index, id: item.clientId };

    // A habit_log's UNIQUE key carries no user column — an unowned habit_id here
    // would let the natural-key merge reach into another account.
    if (spec.ownerRef && habitOwners) {
      const target = item.raw[spec.ownerRef.column];
      const owner = typeof target === 'string' ? habitOwners.get(target) : undefined;
      if (owner === undefined) {
        return { ...base, server_id: null, status: 'invalid', reason: 'unknown_habit' };
      }
      if (owner !== userId) {
        return { ...base, server_id: null, status: 'forbidden', reason: 'foreign_habit' };
      }
    }

    const current = item.lookupKey === null ? undefined : existing.get(item.lookupKey);

    if (current && current.user_id !== userId) {
      // Guessing another user's row id must not be a write primitive.
      return { ...base, server_id: null, status: 'forbidden', reason: 'foreign_row' };
    }

    if (!current) {
      if (item.deletedAt !== null && !hasRequiredColumns(columns, item.raw)) {
        // Deleting a row the server never had: nobody could have pulled it, so
        // there is nothing to propagate. A tombstone carrying the full row still
        // inserts (below) so a later create in the same batch loses to it.
        return { ...base, server_id: null, status: 'unchanged', reason: 'nothing_to_delete' };
      }
      return this.insertRow(userId, spec, columns, item, existing, base);
    }

    const serverUpdatedAt = String(current.updated_at);
    const serverMs = Date.parse(serverUpdatedAt);
    const incomingMs = Date.parse(item.updatedAt);
    const serverDeleted = spec.softDelete && current.deleted_at != null;
    const incomingDeleted = item.deletedAt !== null;
    const serverId = String(current.id);
    const decided = { ...base, server_id: serverId, server_updated_at: serverUpdatedAt };

    if (incomingMs < serverMs) {
      // LAST-WRITE-WINS: the stale device must re-pull, not clobber.
      return { ...decided, status: 'stale' };
    }

    if (incomingMs === serverMs) {
      if (incomingDeleted && !serverDeleted) {
        return this.updateRow(userId, spec, columns, item, existing, current, decided, 'deleted');
      }
      if (!incomingDeleted && serverDeleted) {
        // The delete raced the edit and wins the tie — do not resurrect.
        return { ...decided, status: 'tombstoned' };
      }
      // Replay, or two edits stamped the same instant: keep the server row so
      // the outcome is deterministic and the retry writes nothing.
      return { ...decided, status: 'unchanged' };
    }

    return this.updateRow(
      userId,
      spec,
      columns,
      item,
      existing,
      current,
      decided,
      incomingDeleted ? 'deleted' : 'updated'
    );
  }

  /* ---------------------------------------------------------------- */
  /* Writers                                                           */
  /* ---------------------------------------------------------------- */

  private async insertRow(
    userId: string,
    spec: TableSpec,
    columns: Columns,
    item: CandidateRow,
    existing: Map<string, Row>,
    base: { index: number; id: string | null }
  ): Promise<PushRowResult> {
    const payload = buildValues(columns, item.raw, true);
    if ('error' in payload) {
      return { ...base, server_id: null, status: 'invalid', reason: payload.error };
    }

    const serverId = item.clientId ?? newId(spec.idPrefix);
    const values: Row = {
      ...payload.values,
      id: serverId,
      user_id: userId,
      created_at: normalizeTimestamp(item.raw.created_at) ?? item.updatedAt,
      updated_at: item.updatedAt,
    };
    // A natural-key row must land under the caller's key even if the payload
    // omitted it (e.g. `user_id` is bound to the token, never to the body).
    for (const [position, keyColumn] of (spec.naturalKey ?? []).entries()) {
      values[keyColumn] = keyColumn === 'user_id' ? userId : item.naturalValues[position];
    }
    if (spec.softDelete) values.deleted_at = item.deletedAt;

    try {
      await this.db.insert(spec.table).values(values as never).run();
    } catch {
      // CHECK / FK / UNIQUE violation — one bad row, not a failed batch.
      return { ...base, server_id: null, status: 'invalid', reason: 'write_rejected' };
    }

    // Later rows in THIS batch must see what just landed.
    existing.set(item.lookupKey ?? serverId, values);
    return {
      ...base,
      server_id: serverId,
      status: 'applied',
      action: item.deletedAt === null ? 'inserted' : 'deleted',
      server_updated_at: item.updatedAt,
    };
  }

  private async updateRow(
    userId: string,
    spec: TableSpec,
    columns: Columns,
    item: CandidateRow,
    existing: Map<string, Row>,
    current: Row,
    base: { index: number; id: string | null; server_id: string; server_updated_at: string },
    action: PushAction
  ): Promise<PushRowResult> {
    const payload = buildValues(columns, item.raw, false);
    if ('error' in payload) {
      return { ...base, status: 'invalid', reason: payload.error };
    }

    const values: Row = { ...payload.values, updated_at: item.updatedAt };
    // Always written, so a strictly newer edit clears an older tombstone.
    if (spec.softDelete) values.deleted_at = item.deletedAt;

    const serverId = String(current.id);
    try {
      await this.db
        .update(spec.table)
        .set(values as never)
        .where(and(eq(columns.id, serverId), eq(columns.user_id, userId)))
        .run();
    } catch {
      return { ...base, status: 'invalid', reason: 'write_rejected' };
    }

    // Keep the batch's view of the row current — the id is NEVER rewritten, so a
    // natural-key merge cannot renumber a row another device already pulled.
    if (item.lookupKey !== null) existing.set(item.lookupKey, { ...current, ...values });
    return { ...base, status: 'applied', action, server_updated_at: item.updatedAt };
  }
}

/* ------------------------------------------------------------------ */
/* Pure helpers — exported for unit tests                              */
/* ------------------------------------------------------------------ */

/** Identity of a row under this table's strategy: client id, or natural key. */
function rowKey(spec: TableSpec, row: Row): string {
  if (spec.naturalKey === null) return String(row.id);
  return spec.naturalKey.map((column) => String(row[column])).join(KEY_SEPARATOR);
}

/** Columns a row MUST carry to be insertable (NOT NULL with no default). */
function hasRequiredColumns(columns: Columns, raw: Row): boolean {
  for (const [name, column] of Object.entries(columns)) {
    if (MANAGED_COLUMNS.has(name)) continue;
    if (column.notNull && !column.hasDefault && raw[name] === undefined) return false;
  }
  return true;
}

/**
 * Project a payload onto the table's real columns.
 *
 * Unknown keys are DROPPED rather than rejected (a newer client may send fields
 * this build has no column for); a known key with the wrong type is rejected
 * loudly, because silently coercing it would corrupt the row.
 */
function buildValues(
  columns: Columns,
  raw: Row,
  isInsert: boolean
): { values: Row } | { error: string } {
  const values: Row = {};
  for (const [name, column] of Object.entries(columns)) {
    if (MANAGED_COLUMNS.has(name)) continue;
    const incoming = raw[name];
    if (incoming === undefined) {
      if (isInsert && column.notNull && !column.hasDefault) return { error: `missing_field:${name}` };
      continue;
    }
    const coerced = coerceValue(column, incoming);
    if (!coerced.ok) return { error: `invalid_field:${name}` };
    values[name] = coerced.value;
  }
  return { values };
}

/**
 * Shape + timestamp + ownership guards that need no database read. Anything that
 * fails here is rejected before a single query runs.
 */
function prepareRow(
  raw: unknown,
  index: number,
  spec: TableSpec,
  userId: string,
  nowMs: number
): PreparedRow {
  const reject = (status: PushStatus, reason: string, id: string | null = null): RejectedRow => ({
    kind: 'rejected',
    result: { index, id, server_id: null, status, reason },
  });

  if (!isPlainObject(raw)) return reject('invalid', 'not_an_object');

  const clientId = typeof raw.id === 'string' && raw.id !== '' ? raw.id : null;

  // THE user-scoping gate: a payload never chooses its owner.
  if (raw.user_id !== undefined && raw.user_id !== null && raw.user_id !== userId) {
    return reject('forbidden', 'foreign_user_id', clientId);
  }

  const updatedAt = normalizeTimestamp(raw.updated_at);
  if (updatedAt === null) return reject('invalid', 'invalid_updated_at', clientId);
  if (Date.parse(updatedAt) > nowMs + CLOCK_SKEW_TOLERANCE_MS) {
    // A device far in the future would otherwise pin the row permanently.
    return reject('invalid', 'future_updated_at', clientId);
  }

  const deletedAt = spec.softDelete ? normalizeTimestamp(raw.deleted_at) : null;
  if (spec.softDelete && raw.deleted_at != null && deletedAt === null) {
    return reject('invalid', 'invalid_deleted_at', clientId);
  }

  const naturalValues: string[] = [];
  if (spec.naturalKey !== null) {
    for (const keyColumn of spec.naturalKey) {
      if (keyColumn === 'user_id') {
        naturalValues.push(userId);
        continue;
      }
      const value = raw[keyColumn];
      if (typeof value !== 'string' || value === '') {
        return reject('invalid', `missing_natural_key:${keyColumn}`, clientId);
      }
      naturalValues.push(value);
    }
  }

  return {
    kind: 'candidate',
    index,
    raw,
    clientId,
    updatedAt,
    deletedAt,
    lookupKey: spec.naturalKey === null ? clientId : naturalValues.join(KEY_SEPARATOR),
    naturalValues,
  };
}
