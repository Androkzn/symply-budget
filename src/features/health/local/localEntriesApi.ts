/**
 * `healthApi`'s **generic entries** surface, served from the on-device ledger —
 * He3b (plan §7). One local method per remote method on `src/api/health.ts`'s
 * `// ---- generic entries (steps / workouts / sleep / hr / energy) ----` block.
 *
 * The Proxy in `localApiProxy.ts` swaps these in per call, so no screen and no
 * storage module changes; a method missing here does NOT fall through to the
 * server — it rejects — which is why all seven are present.
 *
 * ONE TABLE, THREE HOME WIDGETS — WHICH IS THE WHOLE DIFFICULTY
 * -------------------------------------------------------------
 * `healthEntries` is a discriminated log: `entry_type` says what a row is and
 * `data` carries a JSON payload whose shape follows from it. Workouts
 * (`healthActivityStorage.ts:411-417`), step days (`:658-671`) and sleep nights
 * (`healthSleepStorage.ts:191-204`) are three separate Home loaders reading the
 * SAME rows through three different `entry_type` filters, and the route applies
 * that filter **before** its 400-row limit (`health-service.ts:1172-1182`).
 *
 * A local facade that takes the newest 400 rows and then filters by type hands
 * Home zero workouts for any user who logs steps daily — 400 step days is barely
 * more than a year, and a daily step row outnumbers everything else on the
 * table. `rowFilter` on the registered read carries that ordering constraint
 * into the data and `applyHealthReadWindow` honours it; this file never filters
 * by type itself, which is the point.
 *
 * FIVE RULES THIS FILE IS BUILT ON
 * -------------------------------
 * 1. **A ledger row IS the DTO.** `LocalHealthEntry` is `HealthEntry` with the
 *    three enum-ish columns widened to `string` (the ledger stores the D1 row
 *    verbatim, `types.ts`), so a read is a filter and a projection. `toWire`
 *    exists to narrow those three back and to pin `null` where the ledger may
 *    hold `undefined` — the screens destructure `intensity` and `deleted_at`,
 *    and an `undefined` where the Worker sent `null` is a shape change, not a
 *    detail.
 * 2. **Every read goes through a REGISTERED window.** Four callers read this
 *    table and each has its own entry in `HEALTH_READ_WINDOWS`: `loadWorkouts`,
 *    `loadStepDays`, `loadSleepLog` (400 rows each, each with its own
 *    `entry_type` `rowFilter`) and the He11 drain's
 *    `healthKitImportSink.listExisting` (the caller's own from/to, capped at the
 *    400 the route silently applies). No window literal appears below — they are
 *    taken from the registry, because *"a local method that returns the full
 *    table where the remote returned a window is a He3 blocker, not a perf nit"*
 *    (plan §7, quoted in `windows.ts`).
 * 3. **Random ids, always — and `setSteps` is where that costs something.**
 *    `health_entries` carries no `unique()` in D1, so it is in
 *    `HEALTH_RANDOM_ID_TABLES` (`schema.ts`) and `HEALTH_DETERMINISTIC_ID_TABLES`
 *    has exactly two members, neither of them this one. A `steps_${date}` id
 *    would make the daily upsert converge across devices for free — and is
 *    forbidden, because S3b ties deterministic ids to a D1 `unique()` and the
 *    server's own natural-key merge list omits this table. See `setSteps`.
 * 4. **A refusal is shaped like the Worker's refusal.** `writeThrough`'s
 *    `isTransportFailure` decides whether a failed write is worth an outbox
 *    retry by reading `error.response.status` (`healthRepository.ts:434-438`). A
 *    bare `Error` has none, so the delete of an already-gone row reads as a lost
 *    connection and is re-queued forever — the poison pill
 *    `healthRepository.ts:420-425` warns about. `notFound()` carries the status.
 * 5. **A HealthKit write is tagged `'ingest'`.** `origin: 'local'` (the default)
 *    is a no-op for refresh subscribers, because the screen that saved has
 *    already rendered it. The He11 drain writes through this device too, but NO
 *    SCREEN RENDERED IT — so a drain write tagged `'local'` leaves Home showing
 *    yesterday's step count until the next navigation (`localWrite.ts`,
 *    `engine.ts:914-917`). The only thing that writes `source: 'healthkit'` is
 *    that drain, so the payload itself decides the tag.
 *
 * TOMBSTONES
 * ----------
 * Every read here goes through `rowsOf` (live rows only), because
 * `listHealthEntries` server-side carries `isNull(health_entries.deleted_at)`
 * (`health-service.ts:1168-1183`) and every write gate re-states it through
 * `readOwnedEntry` (`:1330-1346`). A deleted workout reappearing on Activity is
 * not "the same signature".
 *
 * BULK — SETTLED AT He11a, AND NOT ON THE FACADE
 * ----------------------------------------------
 * The drain imports months of entries at a time, and one `createEntry` per row
 * is one full ledger capture-and-diff per row ("bulk callers must pre-chunk …
 * one op per row is quadratic", `engine.ts:908-912`). That is still not fixed by
 * adding a bulk METHOD here: the remote surface has no bulk-entry counterpart,
 * so one would fail `parityGap`'s `extraLocally` direction and become dead code
 * the Proxy never consults. It is fixed by exporting `buildLocalHealthEntryRow`
 * — a module-level export, invisible to the parity diff — and letting
 * `healthKitIngest.ts` write the rows it builds through `writeLocalBulk`. One
 * row shape, one op per chunk, one surface.
 */
// Bare side-effect, FIRST: @noble/* captures `globalThis.crypto` at module load
// and `localWrite` reaches @symply/local-first before it reaches the engine.
// This module is a Proxy entry point, so it can be the first Health local
// module a screen pulls into the graph.
import './cryptoPolyfill';

import { HEALTH_WORKOUT_INTENSITIES } from '@api/health';
import type { HealthEntry, HealthEntryType, HealthWorkoutIntensity } from '@api/health';

import { newLocalId } from './ids';
import {
  activeUserId,
  ensureResident,
  nowIso,
  rowsOf,
  writeLocal,
  type LocalWriteOptions,
} from './localWrite';
import type { LocalHealthEntry } from './types';
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
 * `entry_type` → the registered read for the loader that asks for it.
 *
 * Each of these three carries `rowFilter: { field: 'entry_type', equals: … }`
 * and `{ kind: 'rows', maxRows: 400 }`, and it is `applyHealthReadWindow` that
 * guarantees the filter runs FIRST. Taking the whole read object from the
 * registry — rather than reading `maxRows` off it and re-filtering here — is
 * what makes that guarantee this file's as well.
 *
 * `loadSleepLog` reads two tables (`healthEntries` then the active goal), so its
 * entries read is `reads[0]`; the goal half belongs to `localGoalsApi`.
 */
const READ_BY_TYPE: Partial<Record<HealthEntryType, HealthLedgerRead>> = {
  workout: HEALTH_READ_WINDOWS.loadWorkouts.reads[0],
  steps: HEALTH_READ_WINDOWS.loadStepDays.reads[0],
  sleep: HEALTH_READ_WINDOWS.loadSleepLog.reads[0],
};

/**
 * The He11 HealthKit drain's own window — the caller's from/to, capped at the
 * 400 the route silently applies because the drain sends no `limit`
 * (`healthKit.ts:1073-1076`, `healthKitImportSink.listExisting`).
 *
 * This is also the read for an UNTYPED list, which is the same call: the drain
 * is the only caller that omits `type`.
 */
const DRAIN_READ: HealthLedgerRead =
  HEALTH_READ_WINDOWS['healthKitImportSink.listExisting'].reads[0];

/**
 * The read for one `listEntries` call.
 *
 * `heart_rate` and `active_energy` are valid `HealthEntryType`s that no shipped
 * loader reads, so the registry has no entry for them — which is a fact about
 * the app, not a gap to paper over. They get the drain's window (the route's own
 * default for a caller that sends no `limit`) with the caller's own
 * `entry_type` bolted on as the `rowFilter`, so the filter-before-window rule
 * holds for them too. The WINDOW still comes from the registry; only the type
 * being filtered on comes from the caller, exactly as it does in the route's
 * WHERE clause.
 */
function readFor(type: HealthEntryType | undefined): HealthLedgerRead {
  if (type === undefined) return DRAIN_READ;
  return READ_BY_TYPE[type] ?? { ...DRAIN_READ, rowFilter: { field: 'entry_type', equals: type } };
}

/** The route's own cap when a caller sends no `limit` (`health-service.ts:1168-1183`). */
const ENTRIES_ROUTE_DEFAULT_LIMIT = 400;

/**
 * Live rows a read would keep, counted the way the read counts them.
 *
 * The residency walk needs this and `applyHealthReadWindow` cannot supply it:
 * that helper answers "what do I serve", which is already truncated to
 * `maxRows`, so asking it whether it has enough rows always says yes.
 */
function countMatching(rows: readonly LocalHealthEntry[], read: HealthLedgerRead): number {
  const filter = read.rowFilter;
  let count = 0;
  for (const row of rows) {
    if (row.deleted_at != null) continue;
    if (filter && String((row as unknown as Record<string, unknown>)[filter.field]) !== filter.equals) {
      continue;
    }
    count += 1;
  }
  return count;
}

/* ------------------------------------------------------------------ */
/* Row access + projection                                             */
/* ------------------------------------------------------------------ */

function entryRows(): LocalHealthEntry[] {
  return rowsOf<LocalHealthEntry>('healthEntries');
}

/**
 * `ORDER BY date DESC` (`health-service.ts:1180`), with the tie broken
 * explicitly.
 *
 * SQLite leaves the order of two rows sharing a `date` unspecified, and this
 * table is full of that case — two workouts in one day, a sleep night and a step
 * count on the same date. Two devices holding the same rows must paint the same
 * list, so `created_at` then `id` break the tie, the same discipline
 * `summaries.ts` documents for its own reads and the same order
 * `applyHealthReadWindow` uses when it truncates.
 */
function byDateDesc(a: LocalHealthEntry, b: LocalHealthEntry): number {
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
 *
 * `entry_type` is cast rather than validated, and that is the deliberate choice:
 * there is no honest fallback. Every consumer selects rows BY type, so an
 * unrecognised one — a row from a build that knows a sixth kind — simply matches
 * nothing and stays invisible, whereas coercing it into a known type would add
 * it to that type's totals. Silence beats a wrong number in the steps ring.
 */
function toWire(row: LocalHealthEntry): HealthEntry {
  return {
    id: row.id,
    user_id: row.user_id ?? activeUserId(),
    date: row.date,
    entry_type: row.entry_type as HealthEntryType,
    data: row.data,
    source: row.source === 'healthkit' ? 'healthkit' : 'manual',
    intensity: asIntensity(row.intensity),
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? null,
  };
}

/**
 * `null` means NOT RECORDED — on every pre-0124 row and on every session where
 * the member left the picker alone (`health.ts:334`).
 *
 * Unlike `entry_type`, an unknown value here does have an honest answer: the
 * column is a four-value enum the UI renders as a label, so anything outside it
 * is best read as "not recorded" rather than surfaced raw.
 */
function asIntensity(value: string | null | undefined): HealthWorkoutIntensity | null {
  if (value == null) return null;
  return (HEALTH_WORKOUT_INTENSITIES as readonly string[]).includes(value)
    ? (value as HealthWorkoutIntensity)
    : null;
}

/**
 * A rejection shaped like the Worker's 404 (`routes/health.ts:680-684`).
 *
 * Not cosmetic — see rule 4 in the header. The route answers the same 404 for an
 * entry that does not exist, belongs to someone else, or is already tombstoned;
 * on a personal ledger only the first and third are reachable, and they are the
 * same fact.
 */
function notFound(message: string): Error {
  const error = new Error(message) as Error & {
    response: { status: number; data: { error: { code: string; message: string } } };
  };
  error.response = { status: 404, data: { error: { code: 'not_found', message } } };
  return error;
}

/**
 * Rule 5, as a one-liner every write path can share.
 *
 * `'healthkit'` is written by exactly one thing — the He11 drain
 * (`healthKit.ts:1079`, `:1099`) — so the payload's own `source` is a reliable
 * signal that no screen rendered this row and the refresh bridge must fan out.
 */
function originFor(source: 'healthkit' | 'manual' | undefined): LocalWriteOptions {
  return { origin: source === 'healthkit' ? 'ingest' : 'local' };
}

/** The workout `data` blob, parsed defensively — a corrupt payload reads as `{}`. */
function payloadOf(row: LocalHealthEntry): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(row.data);
    // A corrupt blob is REPLACED rather than merged into: keeping half of an
    // unparseable payload is worse than starting from what the user just typed
    // (`health-service.ts:1288-1296`).
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

/**
 * A new row, built exactly as `createHealthEntry` builds it
 * (`health-service.ts:1185-1211`).
 *
 * Exported — but NOT a member of `localEntriesApi` — so the He11a ingest sink
 * can build a month of imported step / energy / sleep / workout rows and write
 * them as ONE op per chunk (`healthKitIngest.ts`, and the "NOT HERE: BULK"
 * section of this file's header, which is what this closes). A method on the
 * facade object would fail `apiParity.test.ts`'s `extraLocally` direction —
 * `healthApi` has no bulk-entry counterpart — while a module-level export is
 * invisible to that diff and keeps the row shape in one place instead of two.
 */
export function buildLocalHealthEntryRow(
  input: {
    date: string;
    entry_type: HealthEntryType;
    data: Record<string, unknown>;
    source?: 'healthkit' | 'manual';
    intensity?: HealthWorkoutIntensity | null;
  },
  timestamp: string,
): LocalHealthEntry {
  return {
    id: newLocalId('he'),
    user_id: activeUserId(),
    date: input.date,
    entry_type: input.entry_type,
    data: JSON.stringify(input.data ?? {}),
    source: input.source ?? 'manual',
    // NULL = not recorded. The client sends this only when the user moved off
    // the picker's default, so a plain "log a walk" still writes nothing here.
    intensity: input.intensity ?? null,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
  };
}

/* ------------------------------------------------------------------ */
/* The facade                                                          */
/* ------------------------------------------------------------------ */

export const localEntriesApi = {
  /**
   * `GET /health/entries` — the type and range are the query, the registry entry
   * is the ceiling.
   *
   * Three separate things happen here, in the route's own order
   * (`health-service.ts:1168-1183`), and reordering any two of them is a bug:
   *
   *  1. the caller's `from`/`to` reproduce the WHERE clause (`gte`/`lte` on
   *     `date`);
   *  2. `applyHealthReadWindow` applies the registered read — `entry_type`
   *     FIRST (as `rowFilter`), then `ORDER BY date DESC`, then the 400-row cap.
   *     This is the constraint the header opens with;
   *  3. the caller's own `limit` narrows further, never widens: the registry
   *     records what the device has actually ever received, and every shipped
   *     caller asks for exactly the 400 it records
   *     (`MAX_WORKOUT_ENTRIES` / `MAX_STEP_DAYS` / `MAX_SLEEP_NIGHTS`).
   */
  listEntries: async (params?: {
    type?: HealthEntryType;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<{ entries: HealthEntry[] }> => {
    const from = params?.from;
    const to = params?.to;
    const read = readFor(params?.type);

    // Row-bounded and type-filtered, which is the combination that needs the
    // most care: a month of `healthEntries` is ~77 rows but only ~19 workouts,
    // so residency has to be counted on the FILTERED rows or the newest 400
    // workouts stop a year and a half early. Same ordering rule as the read
    // itself — `entry_type` first, then the count.
    await ensureResident([
      from !== undefined || to !== undefined
        ? { table: 'healthEntries', ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) }
        : {
            table: 'healthEntries',
            minRows: maxRowsForWindow(read.window) ?? ENTRIES_ROUTE_DEFAULT_LIMIT,
            count: (ledger) => countMatching(ledger.healthEntries, read),
          },
    ]);

    const inRange = entryRows().filter(
      (row) => (from === undefined || row.date >= from) && (to === undefined || row.date <= to),
    );

    const windowed = applyHealthReadWindow(read, inRange, { from, to }).sort(byDateDesc);

    const limit = params?.limit;
    const capped =
      limit !== undefined && limit < windowed.length ? windowed.slice(0, limit) : windowed;

    return { entries: capped.map(toWire) };
  },

  /**
   * `POST /health/entries/steps` — an UPSERT, not an insert
   * (`health-service.ts:1349-1370`).
   *
   * Steps are one value per day: the donor allowed several HealthKit samples,
   * but the manual path must not stack duplicates, so re-entering a count
   * replaces it. The match is on all four of `date`, `entry_type = 'steps'`,
   * `source = 'manual'` and "not tombstoned" — an imported HealthKit row is
   * deliberately NOT overwritten by a typed one, because they are two different
   * claims about the day and the importer's de-duplicator owns its own rows.
   *
   * ⚠️ **The one place rule 3 costs something.** Two devices setting steps for
   * the same day offline mint two rows, and LWW cannot merge them because the
   * ids differ. A `steps_${date}` id would fix it — and is forbidden: S3b ties a
   * deterministic id to a D1 `unique()`, `health_entries` has none, and the
   * server's natural-key merge list omits the table
   * (`health-sync-service.ts:66-72`). The remote has exactly the same hazard
   * (`.get()` picks one of the duplicates), so this matches rather than
   * introduces the behaviour. When a duplicate does exist the OLDEST is chosen —
   * insertion order, which is what SQLite's unordered `.get()` returns in
   * practice — so at least both devices pick the same row to update.
   */
  setSteps: async (date: string, steps: number): Promise<{ entry: HealthEntry }> => {
    // An upsert on a NAMED day, so the same rule as `toggleHabit`: if that day
    // is outside the resident window the lookup misses and a second steps row
    // is minted for a day that already has one — the duplicate this method
    // exists to prevent, created by the mitigation meant to be invisible.
    await ensureResident([{ table: 'healthEntries', from: date, to: date }]);

    const sameDay = entryRows().filter(
      (row) => row.date === date && row.entry_type === 'steps' && row.source === 'manual',
    );

    const existing =
      sameDay.length === 0
        ? null
        : sameDay.reduce((oldest, row) => {
            if (row.created_at !== oldest.created_at) {
              return row.created_at < oldest.created_at ? row : oldest;
            }
            return row.id < oldest.id ? row : oldest;
          });

    const timestamp = nowIso();

    if (existing) {
      const next: LocalHealthEntry = {
        ...existing,
        data: JSON.stringify({ steps }),
        updated_at: timestamp,
      };
      await writeLocal(
        (draft) => {
          const row = draft.healthEntries.find((candidate) => candidate.id === existing.id);
          if (!row) return;
          Object.assign(row, next);
        },
        {
          opType: 'HEALTH_ENTRY_STEPS_SET',
          entityType: 'health_entry',
          entityId: existing.id,
          payload: { id: existing.id, date, steps },
        },
      );
      return { entry: toWire(next) };
    }

    const row = buildLocalHealthEntryRow({ date, entry_type: 'steps', data: { steps } }, timestamp);
    await writeLocal(
      (draft) => {
        draft.healthEntries.push(row);
      },
      {
        opType: 'HEALTH_ENTRY_STEPS_SET',
        entityType: 'health_entry',
        entityId: row.id,
        payload: row,
      },
    );
    return { entry: toWire(row) };
  },

  /**
   * `POST /health/entries` — INSERTS unconditionally
   * (`health-service.ts:1185-1211`).
   *
   * Only `/entries/steps` upserts, so the caller owns de-duplication;
   * `healthKit.ts` plans every import against what it has already stored so a
   * second sync cannot stack a second row on the same day. Reproducing that
   * exactly matters more here than anywhere else on this surface: an "improved"
   * local upsert would silently break the drain's plan, which is written against
   * insert semantics.
   */
  createEntry: async (body: {
    date: string;
    entry_type: HealthEntryType;
    data: Record<string, unknown>;
    source?: 'healthkit' | 'manual';
    intensity?: HealthWorkoutIntensity | null;
  }): Promise<{ entry: HealthEntry }> => {
    const row = buildLocalHealthEntryRow(body, nowIso());

    await writeLocal(
      (draft) => {
        draft.healthEntries.push(row);
      },
      {
        opType: 'HEALTH_ENTRY_CREATE',
        entityType: 'health_entry',
        entityId: row.id,
        payload: row,
      },
      originFor(body.source),
    );

    return { entry: toWire(row) };
  },

  /**
   * `POST /health/entries/workouts` — a typed create over the same table
   * (`routes/health.ts:606-654`).
   *
   * The ROUTE assembles the `data` blob, not the service, so the assembly is
   * reproduced here column-for-column — `healthActivityStorage.ts:519-535`
   * already had to reproduce it once for its offline queue, and the two must not
   * disagree.
   *
   * `calories` and `note` are coalesced to `0` / `''`, but `distance_m` and
   * `started_at` are SPREAD rather than defaulted: an unmeasured distance must
   * stay ABSENT from the payload, because writing `0` makes "I did not measure
   * it" indistinguishable from "I covered no ground", and every weekly total and
   * chart built on it would then average a measurement nobody took.
   */
  logWorkout: async (body: {
    date: string;
    workout_type: string;
    minutes: number;
    calories?: number;
    note?: string;
    intensity?: HealthWorkoutIntensity;
    distance_m?: number;
    started_at?: string;
  }): Promise<{ entry: HealthEntry }> => {
    const row = buildLocalHealthEntryRow(
      {
        date: body.date,
        entry_type: 'workout',
        data: {
          workout_type: body.workout_type,
          minutes: body.minutes,
          calories: body.calories ?? 0,
          note: body.note ?? '',
          ...(body.distance_m !== undefined && body.distance_m > 0
            ? { distance_m: body.distance_m }
            : {}),
          ...(body.started_at !== undefined ? { started_at: body.started_at } : {}),
        },
        intensity: body.intensity ?? null,
      },
      nowIso(),
    );

    await writeLocal(
      (draft) => {
        draft.healthEntries.push(row);
      },
      {
        opType: 'HEALTH_ENTRY_WORKOUT_CREATE',
        entityType: 'health_entry',
        entityId: row.id,
        payload: row,
      },
    );

    return { entry: toWire(row) };
  },

  /**
   * `PUT /health/entries/workouts/:id` — MERGES the typed payload
   * (`health-service.ts:1265-1323`).
   *
   * Merging rather than replacing is what lets a caller change only the duration
   * without resending the note. It replaced the re-record workaround (write the
   * replacement, then delete the original), which kept the data safe but minted a
   * new id and moved `created_at`, so an edited workout jumped to the top of its
   * day.
   *
   * Two things this refuses, both deliberately:
   *
   *  - **a row that is not a workout.** This path promises the
   *    `{ workout_type, minutes, calories, note }` shape, and rewriting a
   *    `sleep` blob into it would silently corrupt the night. Same 404 as an
   *    unknown id.
   *  - **a spread for `distance_m` / `started_at`.** A spread can set a key or
   *    leave it, never remove one, and `null` (or a zero distance, which means
   *    the same thing) has to DELETE it outright — otherwise "I cleared the
   *    distance" quietly keeps the old figure and every total built on it stays
   *    wrong.
   */
  updateWorkout: async (
    id: string,
    body: Partial<{
      date: string;
      workout_type: string;
      minutes: number;
      calories: number;
      note: string;
      intensity: HealthWorkoutIntensity | null;
      distance_m: number | null;
      started_at: string | null;
    }>,
  ): Promise<{ entry: HealthEntry }> => {
    const existing = entryRows().find((row) => row.id === id);
    // Validated BEFORE the mutator: `mutateLocalHealthLedger` mutates the live
    // ledger in place (`engine.ts:930-932`), so a throw from inside the mutator
    // leaves a half-applied edit with no op to describe it.
    if (!existing || existing.entry_type !== 'workout') throw notFound('Entry not found');

    const data: Record<string, unknown> = {
      ...payloadOf(existing),
      ...(body.workout_type !== undefined ? { workout_type: body.workout_type } : {}),
      ...(body.minutes !== undefined ? { minutes: body.minutes } : {}),
      ...(body.calories !== undefined ? { calories: body.calories } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
    };

    if (body.distance_m !== undefined) {
      if (body.distance_m === null || body.distance_m <= 0) delete data.distance_m;
      else data.distance_m = body.distance_m;
    }
    if (body.started_at !== undefined) {
      if (body.started_at === null) delete data.started_at;
      else data.started_at = body.started_at;
    }

    const next: LocalHealthEntry = {
      ...existing,
      ...(body.date !== undefined ? { date: body.date } : {}),
      data: JSON.stringify(data),
      ...(body.intensity !== undefined ? { intensity: body.intensity } : {}),
      updated_at: nowIso(),
    };

    await writeLocal(
      (draft) => {
        const row = draft.healthEntries.find((candidate) => candidate.id === id);
        if (!row) return;
        Object.assign(row, next);
      },
      {
        opType: 'HEALTH_ENTRY_WORKOUT_UPDATE',
        entityType: 'health_entry',
        entityId: id,
        payload: next,
      },
    );

    return { entry: toWire(next) };
  },

  /**
   * `PUT /health/entries/:id` — `data` is REPLACED, not merged
   * (`health-service.ts:1232-1252`).
   *
   * That is the donor's contract and it is the reason `updateWorkout` exists as
   * a separate method: a merge here would make it impossible to remove a key.
   * The Sleep screen relies on the replacement — it edits a night by sending the
   * whole `{ minutes }` payload (`healthSleepStorage.ts:254`).
   *
   * An omitted key keeps its stored value, matching the route's `z.object`,
   * which leaves undefined keys out of the patch entirely.
   */
  updateEntry: async (
    id: string,
    body: Partial<{
      date: string;
      data: Record<string, unknown>;
      source: 'healthkit' | 'manual';
      intensity: HealthWorkoutIntensity | null;
    }>,
  ): Promise<{ entry: HealthEntry }> => {
    const existing = entryRows().find((row) => row.id === id);
    if (!existing) throw notFound('Entry not found');

    const next: LocalHealthEntry = {
      ...existing,
      ...(body.date !== undefined ? { date: body.date } : {}),
      ...(body.data !== undefined ? { data: JSON.stringify(body.data ?? {}) } : {}),
      ...(body.source !== undefined ? { source: body.source } : {}),
      ...(body.intensity !== undefined ? { intensity: body.intensity } : {}),
      updated_at: nowIso(),
    };

    await writeLocal(
      (draft) => {
        const row = draft.healthEntries.find((candidate) => candidate.id === id);
        if (!row) return;
        Object.assign(row, next);
      },
      {
        opType: 'HEALTH_ENTRY_UPDATE',
        entityType: 'health_entry',
        entityId: id,
        payload: next,
      },
      originFor(body.source),
    );

    return { entry: toWire(next) };
  },

  /**
   * `DELETE /health/entries/:id` — a TOMBSTONE, not a splice.
   *
   * The ledger tombstone is authoritative (`types.ts` header): removing the row
   * outright would let a peer device's older copy resurrect it on the next
   * merge, because LWW has nothing to compare a missing row against. It is also
   * how the drain retires a superseded import (`healthKit.ts:1082`), where a
   * resurrected row is a duplicate workout rather than a cosmetic glitch.
   *
   * Rejects when the row is unknown or already tombstoned, which is the same 404
   * the route answers (`routes/health.ts:680-684`) — and the same fact. A
   * resolved `{ deleted: false }` is a shape the Worker never produces.
   */
  deleteEntry: async (id: string): Promise<{ deleted: boolean }> => {
    const existing = entryRows().find((row) => row.id === id);
    if (!existing) throw notFound('Entry not found');

    const timestamp = nowIso();
    await writeLocal(
      (draft) => {
        const row = draft.healthEntries.find((candidate) => candidate.id === id);
        if (!row) return;
        row.deleted_at = timestamp;
        row.updated_at = timestamp;
      },
      {
        opType: 'HEALTH_ENTRY_DELETE',
        entityType: 'health_entry',
        entityId: id,
        payload: { id, deleted_at: timestamp },
      },
    );

    return { deleted: true };
  },
};

export default localEntriesApi;
