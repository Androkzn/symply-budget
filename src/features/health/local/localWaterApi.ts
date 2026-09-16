/**
 * `healthApi`'s **water** surface, served from the on-device ledger — He3b
 * (plan §7). One local method per remote method on `src/api/health.ts`'s
 * `// ---- water ----` block, minus `waterSummary`, which is one of the six
 * He7-lite summaries and belongs to `localSummariesApi` / `summaries.ts`
 * (`computeWaterSummary` is already written there).
 *
 * The Proxy in `localApiProxy.ts` swaps these in per call, so no screen and no
 * storage module changes; a method missing here does NOT fall through to the
 * server — it rejects — which is why all four are present.
 *
 * FOUR RULES THIS FILE IS BUILT ON
 * -------------------------------
 * 1. **A ledger row IS the DTO.** `LocalWaterEntry` is `HealthWaterEntry` with
 *    the nullable columns typed as optional, so a read is a filter and a
 *    projection. `toWire` exists only to pin `null` where the ledger may hold
 *    `undefined` — the screens destructure `container` and `deleted_at` and a
 *    `undefined` where the Worker sent `null` is a shape change, not a detail.
 * 2. **Every read goes through a REGISTERED window.** `waterEntries` is read by
 *    two loaders and each has its own entry in `HEALTH_READ_WINDOWS`:
 *    `loadWaterDay` (one day, ≤60 rows) and `loadWaterHistory` (400 days). No
 *    window literal appears below — they are taken from the registry, because
 *    *"a local method that returns the full table where the remote returned a
 *    window is a He3 blocker, not a perf nit"* (plan §7, quoted in `windows.ts`).
 * 3. **Random ids, always.** `water_entries` carries no `unique()` in D1, so it
 *    is in `HEALTH_RANDOM_ID_TABLES` (`schema.ts`). Two glasses logged in the
 *    same minute are two drinks; a `water_${date}` id would LWW one of them
 *    away. `HEALTH_DETERMINISTIC_ID_TABLES` has exactly two members and this is
 *    not one of them.
 * 4. **A refusal is shaped like the Worker's refusal.** `deleteWater` 404s
 *    remotely, and `writeThrough`'s `isTransportFailure` decides whether to
 *    queue an outbox retry by reading `error.response.status`. A bare `Error`
 *    has none, so it reads as a lost connection and the delete of an
 *    already-gone row is re-queued forever — the poison pill
 *    `healthRepository.ts:420-425` warns about. `notFound()` carries the status.
 *
 * TOMBSTONES
 * ----------
 * `listWater` reads through `rowsOf` (live rows only), because `listWater`
 * server-side carries `isNull(water_entries.deleted_at)`
 * (`health-service.ts:422-431`). A deleted glass reappearing on Home is not
 * "the same signature".
 */
// Bare side-effect, FIRST: @noble/* captures `globalThis.crypto` at module load
// and `localWrite` reaches @symply/local-first before it reaches the engine.
// This module is a Proxy entry point, so it can be the first Health local
// module a screen pulls into the graph.
import './cryptoPolyfill';

import type { HealthWaterEntry } from '@api/health';

import { newLocalId } from './ids';
import { activeUserId, ensureResident, nowIso, rowsOf, writeLocal } from './localWrite';
import type { LocalWaterEntry } from './types';
import { HEALTH_READ_WINDOWS, applyHealthReadWindow, type HealthLedgerRead } from './windows';

/* ------------------------------------------------------------------ */
/* Windows — taken from the registry, never restated                   */
/* ------------------------------------------------------------------ */

/**
 * 400 days (`healthLocalStorage.ts:629-649`). `listWater` has NO server limit,
 * so the caller's from/to range IS the whole remote window — this is the ceiling
 * that applies when a caller asks for more than Trends ever did, or for nothing
 * at all.
 */
const WATER_HISTORY_READ: HealthLedgerRead = HEALTH_READ_WINDOWS.loadWaterHistory.reads[0];

/**
 * One calendar day, ≤60 rows (`healthWaterStorage.ts:331-350`). Chosen when the
 * caller pins `from === to`, which is exactly how `loadWaterDay` asks — and it
 * must NOT be the 400-day window, because the Water screen pages backwards and a
 * day 500 days ago is a day the remote would have answered.
 */
const WATER_DAY_READ: HealthLedgerRead = HEALTH_READ_WINDOWS.loadWaterDay.reads[0];

/* ------------------------------------------------------------------ */
/* Row access + projection                                             */
/* ------------------------------------------------------------------ */

function waterRows(): LocalWaterEntry[] {
  return rowsOf<LocalWaterEntry>('waterEntries');
}

/**
 * `ORDER BY date DESC` (`health-service.ts:430`), with the tie broken
 * explicitly.
 *
 * SQLite leaves the order of two rows sharing a `date` unspecified, and a day of
 * water is precisely that case — six glasses, one date. Two devices holding the
 * same rows must paint the same list, so `created_at` then `id` break the tie,
 * the same discipline `summaries.ts` documents for its own reads.
 */
function byDateDesc(a: LocalWaterEntry, b: LocalWaterEntry): number {
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
function toWire(row: LocalWaterEntry): HealthWaterEntry {
  return {
    id: row.id,
    user_id: row.user_id ?? activeUserId(),
    date: row.date,
    amount_ml: row.amount_ml,
    beverage_type: row.beverage_type,
    container: row.container ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? null,
  };
}

/**
 * A rejection shaped like the Worker's 404.
 *
 * Not cosmetic: `writeThrough` reads `error.response.status` to decide whether a
 * failed write is worth an outbox retry (`healthRepository.ts:434-438`), and the
 * `no_basis` handler in `healthNutritionStorage.ts:460-466` reads
 * `error.response.data.error.code`. Local errors that do not carry the shape the
 * app already parses are how "screens need zero edits" quietly stops being true.
 */
function notFound(message: string): Error {
  const error = new Error(message) as Error & {
    response: { status: number; data: { error: { code: string; message: string } } };
  };
  error.response = { status: 404, data: { error: { code: 'not_found', message } } };
  return error;
}

/* ------------------------------------------------------------------ */
/* The facade                                                          */
/* ------------------------------------------------------------------ */

export const localWaterApi = {
  /**
   * `GET /health/water/entries` — the range is the query, the registry entry is
   * the ceiling.
   *
   * Two separate things happen here and conflating them is the bug this comment
   * exists to prevent:
   *
   *  - the caller's `from`/`to` reproduce the route's own WHERE clause
   *    (`gte(date, from)` / `lte(date, to)`, `health-service.ts:424-425`);
   *  - the registered window then caps what the device may serve at all.
   *
   * Which window depends on how the caller asked, because the two water loaders
   * genuinely have different ones. `from === to` is `loadWaterDay` asking for a
   * single day and gets that day (never clamped to the last 400, or paging back
   * through the Water screen would fall off a cliff). Anything else — including
   * no parameters at all, which no shipped caller does — gets
   * `loadWaterHistory`'s 400 days.
   */
  listWater: async (params?: {
    from?: string;
    to?: string;
  }): Promise<{ entries: HealthWaterEntry[] }> => {
    const from = params?.from;
    const to = params?.to;

    // Date-bounded on both branches — one day, or 400 days — so residency is a
    // pure range question. The Water screen pages backwards a day at a time and
    // will walk straight out of the resident window on a long-lived diary.
    await ensureResident([
      {
        table: 'waterEntries',
        ...(from !== undefined ? { from } : {}),
        ...(to !== undefined ? { to } : {}),
      },
    ]);

    const inRange = waterRows().filter(
      (row) => (from === undefined || row.date >= from) && (to === undefined || row.date <= to),
    );

    const singleDay = from !== undefined && from === to;
    const windowed = applyHealthReadWindow(
      singleDay ? WATER_DAY_READ : WATER_HISTORY_READ,
      inRange,
      { today: from },
    );

    return { entries: windowed.sort(byDateDesc).map(toWire) };
  },

  /**
   * `POST /health/water/entries` — `createWater` (`health-service.ts:434-452`).
   *
   * The Worker's coalesced defaults are reproduced exactly: `beverage_type` is
   * `'water'` and `container` is `null` when the caller omits them. A glass
   * logged offline must be indistinguishable from one logged online, because the
   * Water screen groups by `beverage_type` and labels by `container`.
   */
  addWater: async (body: {
    date: string;
    amount_ml: number;
    beverage_type?: string;
    container?: string;
  }): Promise<{ entry: HealthWaterEntry }> => {
    const timestamp = nowIso();
    const row: LocalWaterEntry = {
      id: newLocalId('h2o'),
      user_id: activeUserId(),
      date: body.date,
      amount_ml: body.amount_ml,
      beverage_type: body.beverage_type ?? 'water',
      container: body.container ?? null,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
    };

    await writeLocal(
      (draft) => {
        draft.waterEntries.push(row);
      },
      {
        opType: 'WATER_ENTRY_CREATE',
        entityType: 'water_entry',
        entityId: row.id,
        payload: row,
      },
    );

    return { entry: toWire(row) };
  },

  /**
   * `DELETE /health/water/entries/:id` — a TOMBSTONE, not a splice.
   *
   * The ledger tombstone is authoritative (`types.ts` header): removing the row
   * outright would let a peer device's older copy resurrect it on the next
   * merge, because LWW has nothing to compare a missing row against.
   *
   * Rejects when the row is unknown or already tombstoned, which is the same
   * 404 the route answers (`routes/health.ts:169-173`) — and the same fact. A
   * resolved `{ deleted: false }` is a shape the Worker never produces.
   */
  deleteWater: async (id: string): Promise<{ deleted: boolean }> => {
    const existing = waterRows().find((row) => row.id === id);
    // Validated BEFORE the mutator: `mutateLocalHealthLedger` mutates the live
    // ledger in place (`engine.ts:930-932`), so a throw from inside the mutator
    // leaves a half-applied edit with no op to describe it.
    if (!existing) throw notFound('Entry not found');

    const timestamp = nowIso();
    await writeLocal(
      (draft) => {
        const row = draft.waterEntries.find((candidate) => candidate.id === id);
        if (!row) return;
        row.deleted_at = timestamp;
        row.updated_at = timestamp;
      },
      {
        opType: 'WATER_ENTRY_DELETE',
        entityType: 'water_entry',
        entityId: id,
        payload: { id, deleted_at: timestamp },
      },
    );

    return { deleted: true };
  },

  /**
   * `POST /health/water/undo` — `removeLastWater` (`health-service.ts:474-490`).
   *
   * The ±1 cup control on Home never holds an entry id, so "remove the last sip"
   * has to be resolved from the data: the newest LIVE row of that day by
   * `created_at`, tombstoned.
   *
   * Answers `{ removed: false }` rather than rejecting when the day is empty —
   * the route 200s in that case (`routes/health.ts:179-186`), and Home's minus
   * button at zero is an ordinary outcome, not an error.
   */
  undoWater: async (date: string): Promise<{ removed: boolean }> => {
    // Undo targets a NAMED day, not today: the Water screen keeps the control on
    // whichever day it is showing. Widen or the undo finds no row and reports
    // "nothing to remove" for a day that has six.
    await ensureResident([{ table: 'waterEntries', from: date, to: date }]);
    const sameDay = waterRows().filter((row) => row.date === date);
    if (sameDay.length === 0) return { removed: false };

    // `ORDER BY created_at DESC LIMIT 1` (`health-service.ts:485-487`), with the
    // id breaking a same-millisecond tie so a rapid double-tap removes a
    // deterministic row rather than an arbitrary one.
    const last = sameDay.reduce((newest, row) => {
      if (row.created_at !== newest.created_at) {
        return row.created_at > newest.created_at ? row : newest;
      }
      return row.id > newest.id ? row : newest;
    });

    const timestamp = nowIso();
    await writeLocal(
      (draft) => {
        const row = draft.waterEntries.find((candidate) => candidate.id === last.id);
        if (!row) return;
        row.deleted_at = timestamp;
        row.updated_at = timestamp;
      },
      {
        opType: 'WATER_ENTRY_DELETE',
        entityType: 'water_entry',
        entityId: last.id,
        payload: { id: last.id, date, deleted_at: timestamp },
      },
    );

    return { removed: true };
  },
};

export default localWaterApi;
