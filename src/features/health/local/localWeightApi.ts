/**
 * `healthApi`'s **weight** surface, served from the on-device ledger — He3a
 * (plan §7). One local method per remote method on `src/api/health.ts`'s
 * `// ---- weight ----` block, minus `weightStatistics` and `weeklyWeight`,
 * which are two of the six He7-lite summaries and belong to
 * `localSummariesApi` / `summaries.ts` (`computeWeightStatistics` and
 * `computeWeeklyWeight` are already written there).
 *
 * Weight is the He3a pilot table: it is the one slice the plan requires to work
 * end to end, in airplane mode, before the other seven are attempted, because
 * it exercises every part of the machine — create, patch, tombstone, a windowed
 * read, and a unit column the screens convert on.
 *
 * FOUR RULES THIS FILE IS BUILT ON
 * -------------------------------
 * 1. **A ledger row IS the DTO.** `LocalWeightEntry` is `HealthWeightEntry`
 *    with the nullable columns typed optional, so a read is a filter and a
 *    projection. `toWire` exists only to pin `null` where the ledger may hold
 *    `undefined`: the Weight screen destructures `note` and `deleted_at`, and
 *    an `undefined` where the Worker sent `null` is a shape change, not a
 *    detail.
 * 2. **RANDOM IDS — and here it matters more than anywhere else.**
 *    `weight_entries` carries no `unique()` in D1, so it is in
 *    `HEALTH_RANDOM_ID_TABLES` (`schema.ts`). This is the flagship case the
 *    registry guard exists for: someone weighing in morning AND evening
 *    produces two rows for one date, and a `weight_${date}` id would LWW one of
 *    them away silently — the reading is simply gone, and the trend line moves.
 *    `HEALTH_DETERMINISTIC_ID_TABLES` has exactly two members and this is not
 *    one of them.
 * 3. **Every read goes through a REGISTERED window.** `loadWeightLog` asks for
 *    500 rows (`MAX_WEIGHT_ENTRIES`); the route's own default is 200 and an
 *    explicit limit overrides it. No window literal appears below — both come
 *    from the registry, because *"a local method that returns the full table
 *    where the remote returned a window is a He3 blocker, not a perf nit"*
 *    (plan §7, quoted in `windows.ts`).
 * 4. **A refusal is shaped like the Worker's refusal.** `writeThrough` reads
 *    `error.response.status` to decide whether a failed write earns an outbox
 *    retry (`healthRepository.ts:434-438`). A bare `Error` has no status, so a
 *    delete of an already-gone row reads as a lost connection and is re-queued
 *    forever — the poison pill `healthRepository.ts:420-425` warns about.
 *
 * TOMBSTONES
 * ----------
 * `listWeight` reads through `rowsOf` (live rows only), matching the route's
 * `isNull(weight_entries.deleted_at)` (`health-service.ts:202-212`). A deleted
 * weigh-in reappearing in the trend is not "the same signature".
 */
// Bare side-effect, FIRST: @noble/* captures `globalThis.crypto` at module load
// and `localWrite` reaches @symply/local-first before it reaches the engine.
// This module is a Proxy entry point, so it can be the first Health local
// module a screen pulls into the graph.
import './cryptoPolyfill';

import type { HealthWeightEntry, HealthWeightUnit } from '@api/health';

import { newLocalId } from './ids';
import {
  activeUserId,
  ensureResident,
  nowIso,
  rowsOf,
  writeLocal,
  type LocalWriteOptions,
} from './localWrite';
import type { LocalWeightEntry } from './types';
import {
  HEALTH_READ_WINDOWS,
  applyHealthReadWindow,
  maxRowsForWindow,
  type HealthLedgerRead,
} from './windows';

/* ------------------------------------------------------------------ */
/* Windows — taken from the registry, never restated                   */
/* ------------------------------------------------------------------ */

/**
 * 500 rows (`healthLocalStorage.ts:282-286`, `MAX_WEIGHT_ENTRIES` :129). This
 * is the CEILING the device will serve, not the answer to every call — see
 * `listWeight` for why the caller's own `limit` still applies underneath it.
 */
const WEIGHT_LOG_READ: HealthLedgerRead = HEALTH_READ_WINDOWS.loadWeightLog.reads[0];

/**
 * The route's default when a caller sends no `limit`
 * (`health-service.ts:202-212`).
 *
 * Reproduced rather than ignored because a caller that omits `limit` today gets
 * 200 rows, and the He11 HealthKit drain is exactly such a caller
 * (`healthKit.ts:1084-1087`). Serving it 500 locally would change how much
 * history the de-duplicator sees, which is a behaviour change wearing the
 * costume of a bug fix. `windows.ts` records that asymmetry deliberately.
 */
const WEIGHT_ROUTE_DEFAULT_LIMIT = 200;

/**
 * The most weight rows this facade will ever serve one caller — the registered
 * 500-row ceiling, read off the registry rather than restated.
 *
 * It is what an undated `listWeight` must have RESIDENT before it answers, and
 * it is deliberately the ceiling rather than the caller's `limit`: `limit` is
 * narrowed after the window, so hydrating to the ceiling once per session is
 * both correct for every caller and cheaper than widening per call.
 */
const WEIGHT_MAX_SERVED_ROWS = maxRowsForWindow(WEIGHT_LOG_READ.window) ?? WEIGHT_ROUTE_DEFAULT_LIMIT;

/* ------------------------------------------------------------------ */
/* Row access + projection                                             */
/* ------------------------------------------------------------------ */

function weightRows(): LocalWeightEntry[] {
  return rowsOf<LocalWeightEntry>('weightEntries');
}

/**
 * `ORDER BY date DESC` (`health-service.ts:210`), with the tie broken
 * explicitly.
 *
 * SQLite leaves the order of two rows sharing a `date` unspecified, and weight
 * is precisely that case — the morning and evening weigh-in this file exists to
 * protect share one date. Two devices holding the same rows must paint the same
 * list, so `created_at` then `id` break the tie, the same discipline
 * `summaries.ts` documents for its own reads.
 */
function byDateDesc(a: LocalWeightEntry, b: LocalWeightEntry): number {
  if (a.date !== b.date) return b.date.localeCompare(a.date);
  if (a.created_at !== b.created_at) return b.created_at.localeCompare(a.created_at);
  return b.id.localeCompare(a.id);
}

/**
 * The ledger row as the wire DTO.
 *
 * `user_id` falls back to the ledger's own user: the column is defensive rather
 * than authoritative here (one ledger, one user — plan §1.2), and a row synced
 * from a device that omitted it still belongs to this person.
 */
function toWire(row: LocalWeightEntry): HealthWeightEntry {
  return {
    id: row.id,
    user_id: row.user_id ?? activeUserId(),
    date: row.date,
    weight: row.weight,
    unit: row.unit as HealthWeightUnit,
    note: row.note ?? null,
    source: row.source,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? null,
  } as HealthWeightEntry;
}

/**
 * A rejection shaped like the Worker's 404.
 *
 * Not cosmetic: `writeThrough` reads `error.response.status` to decide whether
 * a failed write is worth an outbox retry (`healthRepository.ts:434-438`).
 * Local errors that do not carry the shape the app already parses are how
 * "screens need zero edits" quietly stops being true.
 */
function notFound(message: string): Error {
  const error = new Error(message) as Error & {
    response: { status: number; data: { error: { code: string; message: string } } };
  };
  error.response = { status: 404, data: { error: { code: 'not_found', message } } };
  return error;
}

/**
 * Where a write came from, as the refresh bridge needs to hear it.
 *
 * `origin: 'local'` (the default) is a NO-OP for refresh subscribers, because
 * the screen that saved has already rendered it. The He11a HealthKit drain
 * writes through this device too, but NO SCREEN RENDERED IT — so a drain write
 * tagged `'local'` leaves Home, Trends and the Weight screen showing yesterday's
 * number until the member navigates away and back (`localWrite.ts`,
 * `engine.ts:914-917`, `ledgerRefresh.ts` rule 2).
 *
 * `source: 'healthkit'` is written by exactly one thing — the body-mass track of
 * the drain (`healthKit.ts`, `mapSamplesToWeightPayloads` pins the tag) — so the
 * payload's own `source` is a reliable signal. Identical to `originFor` in
 * `localEntriesApi.ts` and `localNutritionApi.ts`; weight is the third of the
 * three tables Wave B writes and had been the one left untagged.
 *
 * `deleteWeight` deliberately does NOT take the tag. Every supersede the drain
 * issues is paired with a create for the same day (`planWeightImport` pushes to
 * `supersede` and `create` together), so the create's fan-out already repaints
 * the day — and tagging the delete would additionally fan out when a member
 * deletes an imported reading by hand, which IS a local echo.
 */
function originFor(source: 'healthkit' | 'manual' | undefined): LocalWriteOptions {
  return { origin: source === 'healthkit' ? 'ingest' : 'local' };
}

/**
 * A new weight row, built exactly as `createWeight` builds it
 * (`health-service.ts:214+`).
 *
 * Exported — but NOT a member of `localWeightApi` — so the He11a ingest sink can
 * build a month of imported readings and write them as ONE op per chunk
 * (`healthKitIngest.ts`). A method on the facade object would fail
 * `apiParity.test.ts`'s `extraLocally` direction, because `healthApi` has no
 * bulk-weight counterpart; a module-level export is invisible to that diff and
 * keeps the row shape in one place instead of two.
 */
export function buildLocalWeightRow(
  body: {
    date: string;
    weight: number;
    unit: HealthWeightUnit;
    note?: string;
    source?: 'manual' | 'healthkit';
  },
  timestamp: string,
): LocalWeightEntry {
  return {
    // Random, never `weight_${date}` — see rule 2 in the file header.
    id: newLocalId('wgt'),
    user_id: activeUserId(),
    date: body.date,
    weight: body.weight,
    unit: body.unit,
    note: body.note ?? null,
    source: body.source ?? 'manual',
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
  };
}

/* ------------------------------------------------------------------ */
/* The facade                                                          */
/* ------------------------------------------------------------------ */

export const localWeightApi = {
  /**
   * `GET /health/weight/entries` — the range and limit are the query, the
   * registry entry is the ceiling.
   *
   * Three separate things happen here and conflating them is the bug this
   * comment exists to prevent:
   *
   *  - the caller's `from`/`to` reproduce the route's WHERE clause
   *    (`gte(date, from)` / `lte(date, to)`);
   *  - the caller's `limit` — or the route's own 200 default when it is absent
   *    — reproduces the route's LIMIT;
   *  - the registered 500-row window then caps what the device will serve at
   *    all, so a caller that asks for more than any shipped screen ever did
   *    cannot turn a bounded read into a full-table scan.
   */
  listWeight: async (params?: {
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<{ entries: HealthWeightEntry[] }> => {
    const from = params?.from;
    const to = params?.to;

    // The resident window is ~420 days (`HEALTH_RESIDENT_WINDOW_DAYS`) and this
    // read is bounded by ROWS, not by days — 500 weigh-ins is over three years
    // for a member who logs twice a week. Widen before reading or the log
    // silently ends at the window edge, which is the one thing `windows.ts`
    // calls a He3 blocker.
    await ensureResident([
      from !== undefined || to !== undefined
        ? { table: 'weightEntries', ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) }
        : { table: 'weightEntries', minRows: WEIGHT_MAX_SERVED_ROWS },
    ]);

    const inRange = weightRows()
      .filter(
        (row) => (from === undefined || row.date >= from) && (to === undefined || row.date <= to),
      )
      .sort(byDateDesc);

    const limited = inRange.slice(0, params?.limit ?? WEIGHT_ROUTE_DEFAULT_LIMIT);
    const windowed = applyHealthReadWindow(WEIGHT_LOG_READ, limited);

    return { entries: windowed.map(toWire) };
  },

  /**
   * `POST /health/weight/entries` — `createWeight` (`health-service.ts:214+`).
   *
   * The Worker's coalesced defaults are reproduced exactly: `note` is `null` and
   * `source` is `'manual'` when the caller omits them. The `source` default is
   * load-bearing rather than cosmetic — the HealthKit de-duplicator leaves
   * `'manual'` rows alone (0122), so a locally-created row that arrived without
   * the tag would be a candidate for overwrite by the next import.
   *
   * The same `source` also decides the REFRESH ORIGIN — see `originFor`. A
   * HealthKit reading is an `'ingest'`, not a local echo, and until He11a it was
   * the one Wave B write of the three that said otherwise.
   */
  createWeight: async (body: {
    date: string;
    weight: number;
    unit: HealthWeightUnit;
    note?: string;
    source?: 'manual' | 'healthkit';
  }): Promise<{ entry: HealthWeightEntry }> => {
    const row = buildLocalWeightRow(body, nowIso());

    await writeLocal(
      (draft) => {
        draft.weightEntries.push(row);
      },
      {
        opType: 'WEIGHT_ENTRY_CREATE',
        entityType: 'weight_entry',
        entityId: row.id,
        payload: row,
      },
      originFor(body.source),
    );

    return { entry: toWire(row) };
  },

  /**
   * `PUT /health/weight/entries/:id` — a PARTIAL patch.
   *
   * Only the keys the caller actually sent are touched. This matters for
   * `note`, whose `null` is a real value (clear the note) and must be
   * distinguishable from "absent" (keep it) — `body.note !== undefined` is the
   * test, not `body.note ?? existing.note`, which would make clearing a note
   * impossible.
   */
  updateWeight: async (
    id: string,
    body: Partial<{
      date: string;
      weight: number;
      unit: HealthWeightUnit;
      note: string | null;
      source: 'manual' | 'healthkit';
    }>,
  ): Promise<{ entry: HealthWeightEntry }> => {
    const existing = weightRows().find((row) => row.id === id);
    // Validated BEFORE the mutator: `mutateLocalHealthLedger` mutates the live
    // ledger in place (`engine.ts:930-932`), so a throw from inside the mutator
    // leaves a half-applied edit with no op to describe it.
    if (!existing) throw notFound('Entry not found');

    const timestamp = nowIso();
    const patched: LocalWeightEntry = {
      ...existing,
      ...(body.date !== undefined ? { date: body.date } : {}),
      ...(body.weight !== undefined ? { weight: body.weight } : {}),
      ...(body.unit !== undefined ? { unit: body.unit } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
      ...(body.source !== undefined ? { source: body.source } : {}),
      updated_at: timestamp,
    };

    await writeLocal(
      (draft) => {
        const index = draft.weightEntries.findIndex((candidate) => candidate.id === id);
        if (index < 0) return;
        draft.weightEntries[index] = patched;
      },
      {
        opType: 'WEIGHT_ENTRY_UPDATE',
        entityType: 'weight_entry',
        entityId: id,
        payload: patched,
      },
    );

    return { entry: toWire(patched) };
  },

  /**
   * `DELETE /health/weight/entries/:id` — a TOMBSTONE, not a splice.
   *
   * The ledger tombstone is authoritative (`types.ts` header): removing the row
   * outright would let a peer device's older copy resurrect it on the next
   * merge, because LWW has nothing to compare a missing row against.
   *
   * Rejects when the row is unknown or already tombstoned, which is the same
   * 404 the route answers — and the same fact. A resolved `{ deleted: false }`
   * is a shape the Worker never produces.
   */
  deleteWeight: async (id: string): Promise<{ deleted: boolean }> => {
    const existing = weightRows().find((row) => row.id === id);
    if (!existing) throw notFound('Entry not found');

    const timestamp = nowIso();
    await writeLocal(
      (draft) => {
        const row = draft.weightEntries.find((candidate) => candidate.id === id);
        if (!row) return;
        row.deleted_at = timestamp;
        row.updated_at = timestamp;
      },
      {
        opType: 'WEIGHT_ENTRY_DELETE',
        entityType: 'weight_entry',
        entityId: id,
        payload: { id, deleted_at: timestamp },
      },
    );

    return { deleted: true };
  },
};

export default localWeightApi;
