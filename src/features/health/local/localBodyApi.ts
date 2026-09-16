/**
 * `healthApi`'s **measurements** surface, served from the on-device ledger —
 * He3b (plan §7). One local method per remote method on `src/api/health.ts`'s
 * `// ---- measurements ----` block; all five are present, because the Proxy
 * does not fall through to the server for a missing one — it rejects
 * (`localApiProxy.ts`, lesson 2).
 *
 * FOUR RULES THIS FILE IS BUILT ON
 * -------------------------------
 * 1. **The window is 1000 ROWS, and the call site is why it is easy to miss.**
 *    `healthBodyStorage.fetchBodyEntries` sends NO parameters
 *    (`healthBodyStorage.ts:431-437`), so `listMeasurements()` reads as
 *    unbounded. It never was: the service signature is
 *    `listMeasurements(userId, limit = 1000)` (`health-service.ts:1071`), so no
 *    device has ever received more than a thousand rows. The client's own
 *    `.slice(0, MAX_BODY_ENTRIES)` — 4000 — is a cap on derived **site
 *    readings**, not on rows: one taped session is ONE row and up to 41 readings
 *    (`healthBodyStorage.ts:263-269`). Capping at 4000 rows here would be a 4×
 *    over-read of the widest table in the app (40+ columns per row). The number
 *    is taken from `HEALTH_READ_WINDOWS.loadBodyEntries`, never restated.
 * 2. **Random ids.** `body_measurements` carries no `unique()` in D1, so it sits
 *    in `HEALTH_RANDOM_ID_TABLES` (`schema.ts`) and `newLocalId('bm')` mirrors
 *    the server's `newId('bm')`. Two tapings on one day are two sessions — a
 *    `bm_${date}` id would LWW one of them away, which for this table means
 *    silently discarding up to forty-one real readings.
 * 3. **`MEASUREMENT_SITE_COLUMNS` is the route's allowlist, verbatim.** The
 *    POST and PATCH schemas are `z.object`s built from `measurementFields`
 *    (`routes/health.ts:377-427`), which STRIP every key they do not name and
 *    answer 200. A local facade that spread the caller's body onto the row would
 *    let a screen persist a column the server has always discarded, and the two
 *    devices then disagree the moment one of them is online. The route's own
 *    header says the same thing from the other side: *"a site the client sends
 *    that is missing from here is silently discarded"*.
 * 4. **A refusal is shaped like the Worker's 404.** `writeThrough` reads
 *    `error.response.status` to decide whether a failed write earns an outbox
 *    retry (`healthRepository.ts:434-438`); a bare `Error` has no status, reads
 *    as a lost connection, and re-queues the delete of an already-gone row
 *    forever. `notFound()` carries the status the app already parses.
 *
 * WHAT IS **NOT** REPRODUCED, AND WHY
 * -----------------------------------
 * The route's numeric bounds (`z.number().positive().max(400)` per site,
 * `min(0).max(100)` for body fat) are validation, not shape. `localGoalsApi`
 * makes the same call for `PUT /goals`: the KEY allowlist is contract — it
 * decides what is stored — while a value the route would have rejected is
 * already unreachable from the app, which clamps at the same bounds before it
 * ever calls (`MAX_LENGTH_VALUE` / `MAX_PERCENT_VALUE`,
 * `healthBodyStorage.ts:271-273`). Reproducing zod here would add a second
 * source of truth for limits that live in two places already.
 *
 * TOMBSTONES
 * ----------
 * Every read goes through `rowsOf` (live rows only), because `listMeasurements`
 * and `latestMeasurement` both carry `isNull(body_measurements.deleted_at)`
 * server-side (`health-service.ts:1071-1091`), and `updateMeasurement`'s WHERE
 * carries it too — patching a tombstoned session is a 404, not a revival.
 * `body_measurements` is a random-id table, so nothing here needs `allRowsOf`;
 * the deterministic-id upsert hazard belongs to `habitLogs` and `healthGoals`.
 */
// Bare side-effect, FIRST: @noble/* captures `globalThis.crypto` at module load
// and `ids`/`localWrite` reach @symply/local-first before the engine does. This
// module is a Proxy entry point, so it can be the first Health local module a
// screen pulls into the graph.
import './cryptoPolyfill';

import type { HealthMeasurement, HealthMeasurementUnit } from '@api/health';

import { newLocalId } from './ids';
import { activeUserId, ensureResident, nowIso, rowsOf, writeLocal } from './localWrite';
import type { LocalBodyMeasurement } from './types';
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
 * The registry's own `loadBodyEntries` read — `bodyMeasurements`, 1000 rows.
 *
 * `latestMeasurement` shares it rather than declaring a second window: the
 * remote is the same table with `LIMIT 1` on the same `ORDER BY date DESC`, so
 * the newest row of the windowed set IS the newest row of the table. Deriving it
 * keeps one registry entry authoritative for both calls.
 */
const BODY_ENTRIES_READ: HealthLedgerRead = HEALTH_READ_WINDOWS.loadBodyEntries.reads[0];

/* ------------------------------------------------------------------ */
/* The route's key allowlist, verbatim                                 */
/* ------------------------------------------------------------------ */

/**
 * `measurementFields` (`routes/health.ts:385-427`), in the route's own order —
 * the donor's legacy thirteen plus body fat, then the 0131 comprehensive block.
 *
 * Forty-one sites. This list is BOTH halves of the contract: the write
 * allowlist (a key absent here is a key the server would have stripped) and the
 * read projection (a current Worker answers every column of the row, so a
 * locally authored row must too). Widening it without widening the route — or
 * `METRIC_COLUMN` in `healthBodyStorage.ts` — is how a site becomes visible on
 * one device and invisible on the other.
 */
const MEASUREMENT_SITE_COLUMNS: readonly string[] = [
  'chest',
  'waist',
  'hips',
  'left_arm',
  'right_arm',
  'left_thigh',
  'right_thigh',
  'neck',
  'shoulders',
  'left_calf',
  'right_calf',
  'left_forearm',
  'right_forearm',
  'body_fat_percentage',
  // ---- 0131: the donor's comprehensive sites ----
  'left_arm_mid',
  'right_arm_mid',
  'left_forearm_mid',
  'right_forearm_mid',
  'left_wrist',
  'right_wrist',
  'left_thigh_mid',
  'right_thigh_mid',
  'left_thigh_lower',
  'right_thigh_lower',
  'left_knee',
  'right_knee',
  'left_calf_mid',
  'right_calf_mid',
  'left_calf_lower',
  'right_calf_lower',
  'left_ankle',
  'right_ankle',
  'waist_navel',
  'waist_upper',
  'waist_lower',
  'iliac',
  'chest_upper',
  'chest_under',
  'back_width',
  'torso_length',
  'inseam',
];

/**
 * What `PATCH /measurements/:id` accepts on top of the sites.
 *
 * `date` and `unit` are patchable because *"a session re-typed in the other unit
 * is a real correction"* (`routes/health.ts:452-464`) — but neither is
 * DEFAULTED, so omitting `unit` keeps the row's own scale rather than silently
 * restating 82 in the other one.
 */
const MEASUREMENT_PATCH_COLUMNS: readonly string[] = [
  'date',
  'unit',
  ...MEASUREMENT_SITE_COLUMNS,
];

/**
 * Keep only the columns the route accepts.
 *
 * `undefined` is dropped and `null` is KEPT, which is the whole point of the
 * 0131 patch verb: `null` clears one site out of a taped session, an omitted key
 * leaves it alone (`health-service.ts:1119-1123`). Assigning the caller's object
 * wholesale would write `undefined` over stored values as SQL NULL — the exact
 * bug the service's own `undefined` filter exists to prevent.
 */
function pickColumns(
  body: Record<string, unknown>,
  columns: readonly string[],
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const column of columns) {
    if (!(column in body)) continue;
    const value = body[column];
    if (value === undefined) continue;
    patch[column] = value;
  }
  return patch;
}

/* ------------------------------------------------------------------ */
/* Row access + projection                                             */
/* ------------------------------------------------------------------ */

function measurementRows(): LocalBodyMeasurement[] {
  return rowsOf<LocalBodyMeasurement>('bodyMeasurements');
}

/**
 * `ORDER BY date DESC` (`health-service.ts:1077`), with the tie broken
 * explicitly.
 *
 * SQLite leaves the order of two rows sharing a `date` unspecified, and two
 * tapings on one day are exactly that case. `latestMeasurement` then reads row
 * zero of this order, so an unspecified tie is a different "current chest" on
 * two devices holding identical rows.
 */
function byDateDesc(a: LocalBodyMeasurement, b: LocalBodyMeasurement): number {
  if (a.date !== b.date) return b.date.localeCompare(a.date);
  if (a.created_at !== b.created_at) return b.created_at.localeCompare(a.created_at);
  return b.id.localeCompare(a.id);
}

/**
 * The ledger row as the wire DTO — every column, `null` where unset.
 *
 * Cast at the boundary because `HealthMeasurement` types the 0131 sites as
 * OPTIONAL (`api/health.ts:283-309`), a concession to Workers that predate the
 * migration. This ledger never does: a row written here has every column, and a
 * current Worker answers every column, so emitting explicit `null` is the shape
 * the screens actually receive today. `healthBodyStorage.fromWireMeasurement`
 * reads a missing key and a null key identically, so nothing downstream can tell
 * — but a *narrower* local answer would be the "same signature" break He3
 * forbids, in the direction that hides data.
 */
function toWire(row: LocalBodyMeasurement): HealthMeasurement {
  const record = row as unknown as Record<string, unknown>;
  const dto: Record<string, unknown> = {
    id: row.id,
    // One ledger, one user (plan §1.2) — the column is defensive, not
    // authoritative, and a locally authored row may not carry it at all.
    user_id: row.user_id ?? activeUserId(),
    date: row.date,
  };
  for (const column of MEASUREMENT_SITE_COLUMNS) dto[column] = record[column] ?? null;
  dto.unit = row.unit;
  dto.created_at = row.created_at;
  dto.updated_at = row.updated_at;
  dto.deleted_at = row.deleted_at ?? null;
  return dto as unknown as HealthMeasurement;
}

/**
 * A rejection shaped like the Worker's 404 (`routes/health.ts:485-497`).
 *
 * Not cosmetic — see rule 4 in the header.
 */
function notFound(message: string): Error {
  const error = new Error(message) as Error & {
    response: { status: number; data: { error: { code: string; message: string } } };
  };
  error.response = { status: 404, data: { error: { code: 'not_found', message } } };
  return error;
}

/**
 * Rows this facade will ever serve — the registered 1000, read off the registry.
 * Also what an undated read must have RESIDENT before it answers.
 */
const BODY_MAX_SERVED_ROWS = maxRowsForWindow(BODY_ENTRIES_READ.window) ?? 1000;

/**
 * The windowed, ordered live set — the one read every method below shares.
 *
 * Callers `await residentMeasurements()` instead of calling this directly when
 * they are serving a read: the 1000-row ceiling carries no date bound, so on a
 * long-lived diary it reaches years past the resident window.
 */
function windowedMeasurements(): LocalBodyMeasurement[] {
  return applyHealthReadWindow(BODY_ENTRIES_READ, measurementRows()).sort(byDateDesc);
}

/** `windowedMeasurements`, having first made those 1000 rows resident. */
async function residentMeasurements(): Promise<LocalBodyMeasurement[]> {
  await ensureResident([{ table: 'bodyMeasurements', minRows: BODY_MAX_SERVED_ROWS }]);
  return windowedMeasurements();
}

/* ------------------------------------------------------------------ */
/* The facade                                                          */
/* ------------------------------------------------------------------ */

export const localBodyApi = {
  /**
   * `GET /health/measurements` — `listMeasurements` (`health-service.ts:1071`).
   *
   * Newest 1000 rows by `date` desc. See rule 1: the call site sends nothing and
   * the ceiling lives in the service signature.
   */
  listMeasurements: async (): Promise<{ measurements: HealthMeasurement[] }> => ({
    measurements: (await residentMeasurements()).map(toWire),
  }),

  /**
   * `GET /health/measurements/latest` — `latestMeasurement` (`:1081`).
   *
   * `ORDER BY date DESC LIMIT 1`, or `null`. Resolved out of the same windowed
   * set rather than off a second read, because the newest row of the newest
   * thousand is the newest row.
   */
  latestMeasurement: async (): Promise<{ measurement: HealthMeasurement | null }> => {
    // The newest row is inside the resident window by definition, so this one
    // could skip the widening — it shares `residentMeasurements` anyway, because
    // a `latest` that could disagree with `list` about which row is newest is a
    // bug waiting for a quiet month.
    const newest = (await residentMeasurements())[0];
    return { measurement: newest ? toWire(newest) : null };
  },

  /**
   * `POST /health/measurements` — `createMeasurement` (`:1093`).
   *
   * One row is one taping SESSION, up to forty-one sites at once. `date` and
   * `unit` are required by the route's schema and are written straight; every
   * other key passes the allowlist first.
   */
  createMeasurement: async (
    body: Record<string, unknown> & { date: string; unit: HealthMeasurementUnit },
  ): Promise<{ measurement: HealthMeasurement }> => {
    const timestamp = nowIso();
    const row = {
      id: newLocalId('bm'),
      user_id: activeUserId(),
      date: body.date,
      unit: body.unit,
      ...pickColumns(body, MEASUREMENT_SITE_COLUMNS),
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
    } as unknown as LocalBodyMeasurement;

    await writeLocal(
      (draft) => {
        draft.bodyMeasurements.push(row);
      },
      {
        opType: 'BODY_MEASUREMENT_CREATE',
        entityType: 'body_measurement',
        entityId: row.id,
        payload: row,
      },
    );

    return { measurement: toWire(row) };
  },

  /**
   * `PATCH /health/measurements/:id` — `updateMeasurement` (`:1119`).
   *
   * How a single bad reading is removed without losing the session: send that
   * column as `null`. DELETE is still the verb for the whole taping.
   *
   * 404s on an unknown or already-tombstoned row, which is what the service's
   * `changes === 0` means and what the route turns it into. A resolved response
   * carrying an unchanged row is a shape the Worker never produces.
   */
  updateMeasurement: async (
    id: string,
    body: Record<string, unknown>,
  ): Promise<{ measurement: HealthMeasurement }> => {
    const existing = measurementRows().find((row) => row.id === id);
    // Validated BEFORE the mutator: `mutateLocalHealthLedger` mutates the live
    // ledger in place (`engine.ts:930-932`), so a throw from inside the mutator
    // leaves a half-applied edit with no op to describe it.
    if (!existing) throw notFound('Measurement not found');

    const patch = pickColumns(body, MEASUREMENT_PATCH_COLUMNS);
    const timestamp = nowIso();

    await writeLocal(
      (draft) => {
        const row = draft.bodyMeasurements.find((candidate) => candidate.id === id);
        if (!row) return;
        Object.assign(row, patch);
        // "Nothing to change is not an error" (`health-service.ts:1124`) — the
        // stamp moves even when the patch is empty, so a no-op PATCH still wins
        // LWW the way the remote's own `set.updated_at` does.
        row.updated_at = timestamp;
      },
      {
        opType: 'BODY_MEASUREMENT_UPDATE',
        entityType: 'body_measurement',
        entityId: id,
        payload: { id, ...patch },
      },
    );

    const updated = measurementRows().find((row) => row.id === id);
    if (!updated) throw notFound('Measurement not found');
    return { measurement: toWire(updated) };
  },

  /**
   * `DELETE /health/measurements/:id` — a TOMBSTONE, not a splice.
   *
   * Removing the row outright would let a peer device's older copy resurrect it
   * on the next merge: LWW has nothing to compare a missing row against. 404s on
   * an unknown or already-tombstoned id, matching `changes === 0`.
   */
  deleteMeasurement: async (id: string): Promise<{ deleted: boolean }> => {
    const existing = measurementRows().find((row) => row.id === id);
    if (!existing) throw notFound('Measurement not found');

    const timestamp = nowIso();
    await writeLocal(
      (draft) => {
        const row = draft.bodyMeasurements.find((candidate) => candidate.id === id);
        if (!row) return;
        row.deleted_at = timestamp;
        row.updated_at = timestamp;
      },
      {
        opType: 'BODY_MEASUREMENT_DELETE',
        entityType: 'body_measurement',
        entityId: id,
        payload: { id, deleted_at: timestamp },
      },
    );

    return { deleted: true };
  },
};

export default localBodyApi;
