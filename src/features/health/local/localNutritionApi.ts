/**
 * `healthApi`'s **nutrition** surface, served from the on-device ledger — He3b
 * (plan §7). One local method per remote method on `src/api/health.ts`'s
 * `// ---- nutrition ----` block, minus `nutritionSummary`, which is one of the
 * six He7-lite summaries and belongs to `localSummariesApi` / `summaries.ts`
 * (`computeNutritionSummary` is already written there).
 *
 * The Proxy in `localApiProxy.ts` swaps these in per call, so no screen and no
 * storage module changes; a method missing here does NOT fall through to the
 * server — it rejects — which is why all seven are present.
 *
 * `nutritionEntries` is the biggest table in the app and the plan's own named
 * example of a window that must survive the port: Home loads the whole 120-day
 * meal window on every focus (`healthNutritionStorage.ts:226-232`, one of a
 * 17-way `Promise.all`), and every drill-down filters that same array.
 *
 * FIVE RULES THIS FILE IS BUILT ON
 * -------------------------------
 * 1. **A ledger row IS the DTO.** `LocalNutritionEntry` is `HealthNutritionEntry`
 *    plus the three columns the wire type has never carried
 *    (`detected_category`, `is_processed`, `source_recipe_id`), so a read is a
 *    filter and a projection. `toWire` exists to pin `null` where the ledger may
 *    hold `undefined` and to drop those three — the screens destructure
 *    `base_calories_per_100` (as `canReportion`, `healthNutritionStorage.ts:222`)
 *    and `food_id`, and an `undefined` where the Worker sent `null` is a shape
 *    change, not a detail.
 * 2. **Every read goes through a REGISTERED window.** Three loaders read this
 *    table and each has its own entry in `HEALTH_READ_WINDOWS`: `loadMeals`
 *    (120 days), `loadMealsForDate` (one day) and the He11 drain's
 *    `healthKitImportSink.listExistingNutrition` (the caller's own from/to). No
 *    window literal appears below — they are taken from the registry, because
 *    *"a local method that returns the full table where the remote returned a
 *    window is a He3 blocker, not a perf nit"* (plan §7, quoted in `windows.ts`).
 * 3. **Random ids, always.** `nutrition_entries` carries no `unique()` in D1, so
 *    it is in `HEALTH_RANDOM_ID_TABLES` (`schema.ts`). Two coffees logged in the
 *    same minute are two coffees; a `nutrition_${date}_${slot}` id would LWW one
 *    of them away. `HEALTH_DETERMINISTIC_ID_TABLES` has exactly two members and
 *    this is not one of them.
 * 4. **A refusal is shaped like the Worker's refusal.** Two shapes are load-
 *    bearing here, not one. `writeThrough`'s `isTransportFailure` decides whether
 *    to queue an outbox retry by reading `error.response.status`
 *    (`healthRepository.ts:434-438`) — a bare `Error` has none, so a delete of an
 *    already-gone row reads as a lost connection and is re-queued forever. And
 *    `isNoBasisError` (`healthNutritionStorage.ts:460-466`) reads
 *    `error.response.status === 400` **and**
 *    `error.response.data.error.code === 'no_basis'` to decide whether to roll
 *    the optimistic portion back; get that shape wrong and a re-portioning the
 *    ledger refused stays on screen as a number the user never ate.
 * 5. **Bulk paths emit ONE op per chunk.** `bulkCreateNutrition` and
 *    `copyNutritionDay` exist precisely to write a day of meals at once (the
 *    donor's four copy sheets), and `mutateLocalHealthLedger` re-captures and
 *    re-diffs the WHOLE ledger per call — so a loop of single writes is
 *    quadratic. `writeLocalBulk` is not optional on these two.
 *
 * TOMBSTONES
 * ----------
 * Every read here goes through `rowsOf` (live rows only), because `listNutrition`
 * server-side carries `isNull(nutrition_entries.deleted_at)`
 * (`health-service.ts:518-528`) and every write gate re-states it: `update`,
 * `reportion` and `delete` all treat a tombstoned row as absent
 * (`:772-782`, `:824-840`, `:868-882`). The service says why in its own comment —
 * an edit that lands on a tombstone bumps `updated_at` and re-delivers a deleted
 * row through the delta pull with different macros, which on a second device
 * looks like a value changing on an entry that is gone.
 *
 * THE ONE THING THIS DEVICE CANNOT REPRODUCE
 * ------------------------------------------
 * `createNutrition` server-side resolves a per-100 basis from `custom_foods`
 * when the caller sends a `food_id`, and detects a challenge category against
 * `food_category_mappings`. Both tables are **Tier B / Tier D** — deliberately
 * not ledgered (`schema.ts`) — so neither lookup exists on device. What happens
 * instead is documented at each site: the basis degrades to the service's own
 * third rule (derive it from the macros the caller sent, which is exact), and
 * the category degrades to the service's own fail-open path (`null`, hence
 * `is_processed`). Neither is a guess — both are branches the Worker already
 * takes.
 */
// Bare side-effect, FIRST: @noble/* captures `globalThis.crypto` at module load
// and `localWrite` reaches @symply/local-first before it reaches the engine.
// This module is a Proxy entry point, so it can be the first Health local
// module a screen pulls into the graph.
import './cryptoPolyfill';

import type {
  HealthMealType,
  HealthNutritionEntry,
  HealthNutritionEntryPayload,
} from '@api/health';

import { localDateKey, newLocalId } from './ids';
import {
  activeUserId,
  ensureResident,
  nowIso,
  rowsOf,
  writeLocal,
  writeLocalBulk,
  type HealthResidencyNeed,
  type LocalWriteOptions,
} from './localWrite';
import type { LocalNutritionEntry } from './types';
import {
  HEALTH_READ_WINDOWS,
  applyHealthReadWindow,
  maxDaysForWindow,
  type HealthLedgerRead,
} from './windows';

/* ------------------------------------------------------------------ */
/* Windows — taken from the registry, never restated                   */
/* ------------------------------------------------------------------ */

/**
 * 120 days (`healthNutritionStorage.ts:226-232`). THE window the plan names.
 *
 * `listNutrition` has NO server limit, so the caller's from/to range IS the
 * whole remote window — this is the ceiling that applies when a caller asks for
 * nothing at all, which no shipped caller does but which would otherwise be an
 * unbounded scan of the largest table in the app on every Home focus.
 */
const MEALS_READ: HealthLedgerRead = HEALTH_READ_WINDOWS.loadMeals.reads[0];

/**
 * One calendar day (`healthNutritionStorage.ts:241-244`). Chosen when the caller
 * pins a `date`, which is how the route's own `eq(date, opts.date)` branch works
 * and how `copyNutritionDay` reads its source day server-side (`:722`).
 *
 * It must NOT be the 120-day window: the Meals screen pages backwards, and a day
 * six months ago is a day the remote would have answered.
 */
const MEALS_DAY_READ: HealthLedgerRead = HEALTH_READ_WINDOWS.loadMealsForDate.reads[0];

/**
 * The He11 HealthKit drain's own window — the caller's from/to, honoured
 * exactly, with no row cap to fall back on
 * (`healthKitImportSink.listExistingNutrition`, `healthKit.ts:1101-1104`).
 *
 * Why this is a THIRD case rather than "clamp everything to 120 days": the drain
 * reads to plan its import against, so an under-read is a DUPLICATE row, not a
 * missing one (`windows.ts`, on the sibling entries drain). Its range is the span
 * of the samples HealthKit handed over (`healthKit.ts:1663-1665`), which on a
 * first import is older than 120 days — clamping there would silently re-import
 * everything past the boundary on every pass.
 *
 * `loadMeals` is unaffected by the choice: it supplies its own 120-day from/to,
 * so the two windows produce the identical set for it.
 */
const MEALS_RANGE_READ: HealthLedgerRead =
  HEALTH_READ_WINDOWS['healthKitImportSink.listExistingNutrition'].reads[0];

/* ------------------------------------------------------------------ */
/* Row access + projection                                             */
/* ------------------------------------------------------------------ */

function nutritionRows(): LocalNutritionEntry[] {
  return rowsOf<LocalNutritionEntry>('nutritionEntries');
}

/** `maxDaysForWindow(MEALS_READ.window)` — the 120 days an unparameterised read gets. */
const MEALS_DEFAULT_WINDOW_DAYS = maxDaysForWindow(MEALS_READ.window) ?? 120;

/**
 * Which months `listNutrition` needs resident, from the same three cases the
 * read itself branches on. Kept beside the reads rather than inlined so the two
 * cannot drift: a residency range narrower than the read's range is a day that
 * renders empty, and a wider one is work nobody asked for.
 */
function nutritionResidency(
  date: string | undefined,
  from: string | undefined,
  to: string | undefined,
): HealthResidencyNeed {
  if (date !== undefined) return { table: 'nutritionEntries', from: date, to: date };
  if (from !== undefined || to !== undefined) {
    return {
      table: 'nutritionEntries',
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
    };
  }
  // No parameters: `loadMeals`' own 120 days, which is inside the ~420-day
  // resident window and therefore already loaded. Stated anyway, because the
  // window is a constant someone may narrow.
  return {
    table: 'nutritionEntries',
    from: localDateKey(new Date(Date.now() - MEALS_DEFAULT_WINDOW_DAYS * 86_400_000)),
    to: localDateKey(),
  };
}

/**
 * `ORDER BY created_at` — ASCENDING (`health-service.ts:526`), unlike every
 * other list on this service.
 *
 * It is not an oversight there and must not be "fixed" here: a meal slot reads
 * in the order it was eaten (`loadMealsForDate` re-sorts oldest-first for
 * exactly that, `healthNutritionStorage.ts:243`), and `copyNutritionDay` copies
 * a day forward in the order it was logged.
 *
 * The tie is broken explicitly by id. SQLite leaves the order of two rows
 * sharing a `created_at` unspecified, and a day of snacks logged in one burst is
 * precisely that case; two devices holding the same rows must paint the same
 * list, which is the same discipline `summaries.ts` documents for its own reads.
 */
function byCreatedAtAsc(a: LocalNutritionEntry, b: LocalNutritionEntry): number {
  if (a.created_at !== b.created_at) return a.created_at.localeCompare(b.created_at);
  return a.id.localeCompare(b.id);
}

/**
 * The four slots, with `snack` as the fallback for anything else.
 *
 * Not defensive noise: `nutritionSummary` files an unrecognised `meal_type` into
 * `snack` server-side (`health-service.ts:894`), so a row synced from a build
 * that knew a fifth slot lands in the same place on both sides of the wire
 * rather than vanishing from the day's totals.
 */
const MEAL_TYPES: readonly HealthMealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

function asMealType(value: string): HealthMealType {
  return (MEAL_TYPES as readonly string[]).includes(value) ? (value as HealthMealType) : 'snack';
}

/**
 * The ledger row as the wire DTO.
 *
 * `user_id` falls back to the ledger's own user: the column is defensive rather
 * than authoritative here (one ledger, one user — plan §1.2), and a row synced
 * from a device that omitted it still belongs to this person.
 *
 * `detected_category`, `is_processed` and `source_recipe_id` are deliberately
 * NOT projected. They are real D1 columns the ledger stores verbatim (`types.ts`)
 * and that the route happens to spread into its response, but they have never
 * been part of `HealthNutritionEntry` and nothing in `src/` reads them. Adding
 * keys the type does not declare is how a local facade starts diverging from the
 * shape its callers were written against.
 */
function toWire(row: LocalNutritionEntry): HealthNutritionEntry {
  return {
    id: row.id,
    user_id: row.user_id ?? activeUserId(),
    date: row.date,
    food_name: row.food_name,
    portion: row.portion,
    unit: row.unit,
    meal_type: asMealType(row.meal_type),
    calories: row.calories,
    proteins: row.proteins,
    carbohydrates: row.carbohydrates,
    fats: row.fats,
    food_id: row.food_id ?? null,
    base_calories_per_100: row.base_calories_per_100 ?? null,
    base_proteins_per_100: row.base_proteins_per_100 ?? null,
    base_carbs_per_100: row.base_carbs_per_100 ?? null,
    base_fats_per_100: row.base_fats_per_100 ?? null,
    source: row.source === 'healthkit' ? 'healthkit' : 'manual',
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? null,
  };
}

/**
 * A rejection shaped like the Worker's 404 (`routes/health.ts:353-357`).
 *
 * Not cosmetic: `writeThrough` reads `error.response.status` to decide whether a
 * failed write is worth an outbox retry (`healthRepository.ts:434-438`). Local
 * errors that do not carry the shape the app already parses are how "screens
 * need zero edits" quietly stops being true.
 */
function notFound(message: string): Error {
  const error = new Error(message) as Error & {
    response: { status: number; data: { error: { code: string; message: string } } };
  };
  error.response = { status: 404, data: { error: { code: 'not_found', message } } };
  return error;
}

/**
 * The 400 `no_basis` refusal, verbatim (`routes/health.ts:293-306`).
 *
 * `reportionNutrition`'s caller reads BOTH halves — status 400 and code
 * `no_basis` (`healthNutritionStorage.ts:460-466`) — and rolls the optimistic
 * portion back only on that exact pair. A 404, or a 400 with any other code,
 * makes the device keep a portion the ledger declined to write.
 */
function noBasis(): Error {
  const message = 'This entry has no per-100 basis, so its portion cannot be rescaled.';
  const error = new Error(message) as Error & {
    response: { status: number; data: { error: { code: string; message: string } } };
  };
  error.response = { status: 400, data: { error: { code: 'no_basis', message } } };
  return error;
}

/**
 * Where a write came from, as the refresh bridge needs to hear it.
 *
 * `origin: 'local'` (the default) is a no-op for refresh subscribers, because
 * the screen that saved has already rendered it. The He11 drain writes through
 * this device too, but NO SCREEN RENDERED IT — so a drain write tagged `'local'`
 * leaves Home showing yesterday's calories until the next navigation
 * (`localWrite.ts`, `engine.ts:914-917`). `source: 'healthkit'` is written by
 * exactly one thing, the dietary importer (`healthKit.ts:1107`), so the payload
 * itself is a reliable signal.
 *
 * The bulk and copy paths take no such tag deliberately: both are user-initiated
 * by construction (the donor's copy sheets), so their writes ARE local echoes.
 */
function originFor(source: 'healthkit' | 'manual' | undefined): LocalWriteOptions {
  return { origin: source === 'healthkit' ? 'ingest' : 'local' };
}

/* ------------------------------------------------------------------ */
/* The per-100 basis — the donor's portion maths, ported verbatim      */
/* ------------------------------------------------------------------ */

type MacroBasis = {
  base_calories_per_100: number;
  base_proteins_per_100: number;
  base_carbs_per_100: number;
  base_fats_per_100: number;
};

type Macros = { calories: number; proteins: number; carbohydrates: number; fats: number };

/**
 * `round2` (`health-food-service.ts:91-93`) — terminal rounding for a derived
 * figure, reproduced rather than imported because `backend/**` is outside the
 * mobile tsconfig. Two decimals keeps a gram-level portion honest without ever
 * becoming an input again.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Rule 1 — derive a serving from the stored per-100 basis
 * (`health-food-service.ts:105-118`).
 *
 * ALWAYS against the stored basis, never by scaling the figures already on the
 * row: `calories / oldPortion * newPortion` compounds its rounding error on
 * every re-portioning, and after three edits the number on screen is one the
 * user never ate. That is the whole reason the four `base_*` columns exist.
 */
function portionFrom(basis: MacroBasis, portion: number): Macros {
  const factor = portion / 100;
  return {
    calories: round2(basis.base_calories_per_100 * factor),
    proteins: round2(basis.base_proteins_per_100 * factor),
    carbohydrates: round2(basis.base_carbs_per_100 * factor),
    fats: round2(basis.base_fats_per_100 * factor),
  };
}

/**
 * The inverse (`health-food-service.ts:125-134`) — recover the per-100 basis
 * from a declared serving.
 *
 * For a non-mass unit (`serving`, `piece`) the result is per-100-OF-THAT-UNIT,
 * which is what keeps `portionFrom(basisFrom(x, p), p) === x` true for every
 * unit — i.e. re-applying the original portion is exactly a no-op.
 */
function basisFrom(macros: Macros, portion: number): MacroBasis {
  const factor = portion > 0 ? 100 / portion : 0;
  return {
    base_calories_per_100: round2(macros.calories * factor),
    base_proteins_per_100: round2(macros.proteins * factor),
    base_carbs_per_100: round2(macros.carbohydrates * factor),
    base_fats_per_100: round2(macros.fats * factor),
  };
}

/** The stored basis of a row, or null when it has none (a pre-0124 or typed row). */
function storedBasisOf(row: LocalNutritionEntry): MacroBasis | null {
  // Only `base_calories_per_100` is consulted, matching the service
  // (`:840`) and the client's own `canReportion` flag
  // (`healthNutritionStorage.ts:219-222`): the four columns are written together
  // or not at all.
  if (row.base_calories_per_100 == null) return null;
  return {
    base_calories_per_100: row.base_calories_per_100,
    base_proteins_per_100: row.base_proteins_per_100 ?? 0,
    base_carbs_per_100: row.base_carbs_per_100 ?? 0,
    base_fats_per_100: row.base_fats_per_100 ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/* Building a row                                                      */
/* ------------------------------------------------------------------ */

/**
 * One diary row, built exactly as `createNutrition` builds it
 * (`health-service.ts:632-660`) — coalesced defaults included, because a meal
 * logged offline must be indistinguishable from one logged online.
 *
 * `basis` is passed in rather than resolved here for one caller only:
 * `copyNutritionDay` carries the SOURCE row's stored basis onto the copy, which
 * is what keeps yesterday's 150 g of rice re-portionable after being copied onto
 * today (`health-service.ts:737-745`). Every other caller leaves it undefined
 * and gets the derived basis described below.
 *
 * Exported under a qualified name — but NOT as a member of `localNutritionApi`
 * — so the He11a ingest sink can build a month of `'Apple Health'` day rows and
 * write them as one op per chunk (`healthKitIngest.ts`). It cannot reuse
 * `bulkCreateNutrition` for that: `bulkCreateNutrition` mirrors the donor's copy
 * sheets, which are user-initiated by construction and therefore write
 * `origin: 'local'` deliberately (see `originFor`). A drain needs `'ingest'`.
 */
export function buildLocalNutritionRow(
  input: HealthNutritionEntryPayload,
  timestamp: string,
  basis?: MacroBasis | null,
): LocalNutritionEntry {
  const portion = input.portion ?? 1;
  const macros: Macros = {
    calories: input.calories,
    proteins: input.proteins ?? 0,
    carbohydrates: input.carbohydrates ?? 0,
    fats: input.fats ?? 0,
  };

  // `resolveNutritionBasis`'s three sources collapse to two on device
  // (`health-service.ts:544-596`):
  //
  //  1. an explicit basis — reachable only from `copyNutritionDay` here, because
  //     `HealthNutritionEntryPayload` (the CLIENT type this method takes) has
  //     never carried the four `base_*` keys the route accepts;
  //  2. the `custom_foods` row named by `food_id` — IMPOSSIBLE on device: the
  //     food library is Tier B/Tier D and is not ledgered (`schema.ts`), so
  //     there is no row to read;
  //  3. derived from the macros the caller sent FOR the portion they sent.
  //
  // Source 2 therefore degrades to source 3, and that is a degradation with no
  // loss: the macros the client sends for a library food ARE that food's macros
  // at that portion, and `basisFrom` is exact (see its comment), so the derived
  // basis equals the food's stored one. What the device cannot reproduce is the
  // route's 404 when `food_id` names a food the caller does not own — and it
  // must not try: refusing would drop a meal the user actually logged, over a
  // pointer that is provenance on this row and nothing more.
  const resolved = basis === undefined ? (portion > 0 ? basisFrom(macros, portion) : null) : basis;

  return {
    id: newLocalId('n'),
    user_id: activeUserId(),
    date: input.date,
    food_name: input.food_name,
    portion,
    unit: input.unit ?? 'serving',
    meal_type: input.meal_type,
    calories: macros.calories,
    proteins: macros.proteins,
    carbohydrates: macros.carbohydrates,
    fats: macros.fats,
    food_id: input.food_id ?? null,
    base_calories_per_100: resolved?.base_calories_per_100 ?? null,
    base_proteins_per_100: resolved?.base_proteins_per_100 ?? null,
    base_carbs_per_100: resolved?.base_carbs_per_100 ?? null,
    base_fats_per_100: resolved?.base_fats_per_100 ?? null,
    // Category detection runs against `food_category_mappings`, a Tier B
    // reference table that is not ledgered. The route's own handler FAILS OPEN
    // to `null` when that table is unreachable (`health-service.ts:189-196`), so
    // this is the branch the Worker already takes rather than a new one — and
    // `is_processed` follows from it exactly as the service derives it
    // (`:660`, `is_processed: detectedCategory === null`), stored as the integer
    // the D1 column holds.
    detected_category: null,
    is_processed: 1,
    // Always null on a create, server-side included: recipe provenance is
    // written by the recipe-to-diary path, which is Tier B.
    source_recipe_id: null,
    source: input.source ?? 'manual',
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
  };
}

/* ------------------------------------------------------------------ */
/* The facade                                                          */
/* ------------------------------------------------------------------ */

export const localNutritionApi = {
  /**
   * `GET /health/nutrition/entries` — the range is the query, the registry entry
   * is the ceiling.
   *
   * Two separate things happen here and conflating them is the bug this comment
   * exists to prevent:
   *
   *  - the caller's `date`/`from`/`to` reproduce the route's own WHERE clause
   *    (`eq(date, date)` / `gte(date, from)` / `lte(date, to)`,
   *    `health-service.ts:520-522`);
   *  - the registered window then caps what the device may serve at all.
   *
   * Which window depends on how the caller asked, because the three registered
   * nutrition readers genuinely have different ones. A pinned `date` (or
   * `from === to`) is `loadMealsForDate` asking for a single day and gets that
   * day — never clamped to the last 120, or paging back through Meals would fall
   * off a cliff. An explicit range is the drain's `callerRange`, honoured
   * exactly; `loadMeals` supplies its own 120-day range and so lands on the same
   * rows either way. No parameters at all — which no shipped caller does — gets
   * `loadMeals`' 120 days rather than the whole table.
   */
  listNutrition: async (params: {
    date?: string;
    from?: string;
    to?: string;
  }): Promise<{ entries: HealthNutritionEntry[] }> => {
    const date = params.date;
    const from = params.from;
    const to = params.to;

    // Every nutrition read is DATE-bounded — a pinned day, a caller range, or
    // `loadMeals`' 120 days — so residency is a range question with no row-count
    // fallback. Paging Meals back to a day from three years ago hydrates that
    // month and renders it; without this it renders an empty day for a day the
    // member definitely ate on.
    await ensureResident([nutritionResidency(date, from, to)]);

    const inRange = nutritionRows().filter(
      (row) =>
        (date === undefined || row.date === date) &&
        (from === undefined || row.date >= from) &&
        (to === undefined || row.date <= to),
    );

    const singleDay = date !== undefined || (from !== undefined && from === to);
    const ranged = from !== undefined || to !== undefined;
    const read = singleDay ? MEALS_DAY_READ : ranged ? MEALS_RANGE_READ : MEALS_READ;

    const windowed = applyHealthReadWindow(read, inRange, { today: date ?? from, from, to });

    return { entries: windowed.sort(byCreatedAtAsc).map(toWire) };
  },

  /**
   * `POST /health/nutrition/entries` — `createNutrition`
   * (`health-service.ts:607-661`).
   *
   * The Worker's coalesced defaults are reproduced exactly: `portion` is `1`,
   * `unit` is `'serving'`, the three optional macros are `0` and `source` is
   * `'manual'` when the caller omits them. Every one of those is load-bearing —
   * the Meals screen divides by `portion`, labels by `unit`, and the day's
   * totals add the macros up.
   */
  createNutrition: async (
    body: HealthNutritionEntryPayload,
  ): Promise<{ entry: HealthNutritionEntry }> => {
    const row = buildLocalNutritionRow(body, nowIso());

    await writeLocal(
      (draft) => {
        draft.nutritionEntries.push(row);
      },
      {
        opType: 'NUTRITION_ENTRY_CREATE',
        entityType: 'nutrition_entry',
        entityId: row.id,
        payload: row,
      },
      originFor(body.source),
    );

    return { entry: toWire(row) };
  },

  /**
   * `PUT /health/nutrition/entries/:id` — a patch that RE-DERIVES the basis
   * (`health-service.ts:772-812`).
   *
   * The re-derivation is the subtle half and is not optional. Without it the row
   * keeps the basis it was created with while showing the corrected figures, so
   * `canReportion` stays true against a basis the member has just corrected away
   * — and the next portion change silently re-derives from the OLD numbers,
   * undoing the correction. The basis is not metadata; it is the statement "this
   * food is X per 100", and editing the macros changes it.
   *
   * Only rows that HAVE a basis are re-derived: inventing one for a free-hand
   * row would make it look re-portionable when the app has no idea what a
   * portion of it weighs.
   *
   * Keys whose value is `undefined` are dropped before anything is decided,
   * which is what the route's `z.object` does server-side — otherwise
   * `{ calories: undefined }` would count as "touches macros" and re-derive a
   * basis from a value nobody sent.
   */
  updateNutrition: async (
    id: string,
    body: Partial<{
      food_name: string;
      meal_type: HealthMealType;
      calories: number;
      proteins: number;
      carbohydrates: number;
      fats: number;
      portion: number;
      unit: string;
    }>,
  ): Promise<{ entry: HealthNutritionEntry }> => {
    const existing = nutritionRows().find((row) => row.id === id);
    // Validated BEFORE the mutator: `mutateLocalHealthLedger` mutates the live
    // ledger in place (`engine.ts:930-932`), so a throw from inside the mutator
    // leaves a half-applied edit with no op to describe it.
    if (!existing) throw notFound('Entry not found');

    const patch = Object.fromEntries(
      Object.entries(body).filter(([, value]) => value !== undefined),
    ) as Partial<LocalNutritionEntry>;

    const merged: LocalNutritionEntry = { ...existing, ...patch };
    const touchesMacros =
      'calories' in patch ||
      'proteins' in patch ||
      'carbohydrates' in patch ||
      'fats' in patch ||
      'portion' in patch;
    const rederived =
      touchesMacros && existing.base_calories_per_100 != null && merged.portion > 0
        ? basisFrom(
            {
              calories: merged.calories,
              proteins: merged.proteins,
              carbohydrates: merged.carbohydrates,
              fats: merged.fats,
            },
            merged.portion,
          )
        : null;

    const next: LocalNutritionEntry = {
      ...merged,
      ...(rederived ?? {}),
      updated_at: nowIso(),
    };

    await writeLocal(
      (draft) => {
        const row = draft.nutritionEntries.find((candidate) => candidate.id === id);
        if (!row) return;
        Object.assign(row, next);
      },
      {
        opType: 'NUTRITION_ENTRY_UPDATE',
        entityType: 'nutrition_entry',
        entityId: id,
        payload: next,
      },
    );

    return { entry: toWire(next) };
  },

  /**
   * `POST /health/nutrition/entries/:id/portion` — `reportionNutrition`
   * (`health-service.ts:824-866`).
   *
   * The write the four `base_*` columns exist for: the row keeps its identity,
   * its day and its slot, and only the four macro columns move — derived from
   * the stored basis (see `portionFrom`), never by scaling what is on the row.
   *
   * Rejects with 400 `no_basis` rather than silently no-op'ing when the entry has
   * none, so the caller can offer the typed editor instead. That refusal is a
   * fact about the row, not a transport failure, and rule 4 in the header is why
   * it has to be carried in the error's `response` shape.
   */
  reportionNutrition: async (
    id: string,
    body: { portion: number; unit?: string },
  ): Promise<{ entry: HealthNutritionEntry }> => {
    const existing = nutritionRows().find((row) => row.id === id);
    if (!existing) throw notFound('Entry not found');

    const basis = storedBasisOf(existing);
    if (!basis) throw noBasis();

    const derived = portionFrom(basis, body.portion);
    const next: LocalNutritionEntry = {
      ...existing,
      portion: body.portion,
      unit: body.unit ?? existing.unit,
      calories: derived.calories,
      proteins: derived.proteins,
      carbohydrates: derived.carbohydrates,
      fats: derived.fats,
      updated_at: nowIso(),
    };

    await writeLocal(
      (draft) => {
        const row = draft.nutritionEntries.find((candidate) => candidate.id === id);
        if (!row) return;
        Object.assign(row, next);
      },
      {
        opType: 'NUTRITION_ENTRY_REPORTION',
        entityType: 'nutrition_entry',
        entityId: id,
        payload: { id, portion: body.portion, unit: next.unit },
      },
    );

    return { entry: toWire(next) };
  },

  /**
   * `POST /health/nutrition/entries/bulk` — `createNutritionBulk`
   * (`health-service.ts:679-707`), and the reason `writeLocalBulk` exists.
   *
   * ONE op per chunk, never one per row: `mutateLocalHealthLedger` captures and
   * diffs the whole ledger per call, so copying a twelve-item dinner as twelve
   * writes is twelve full-ledger diffs. `chunkRowsForOp` packs by bytes AND row
   * count, so the ops stay under the relay's plaintext budget without the caller
   * knowing what that budget is.
   *
   * TWO DELIBERATE DIVERGENCES FROM THE ROUTE, both in the caller's favour:
   *
   *  - **No 100-row cap.** The route's `.max(100)` is a request-size guard on a
   *    Worker ("capped so one request cannot be used to bulk-write the table",
   *    `routes/health.ts:319-321`), not a product rule. On device the same job is
   *    done properly by `chunkRowsForOp`, and refusing would lose a copy the user
   *    asked for.
   *  - **Nothing is skipped.** Server-side a row whose `food_id` names a food the
   *    caller no longer owns is dropped from the result, which is why callers
   *    must read `entries` rather than assume. There is no `custom_foods` table
   *    on device to disown anything, so the answer always has the length it was
   *    given — a superset of what the route guarantees, and one existing callers
   *    already handle because they read the returned array.
   */
  bulkCreateNutrition: async (body: {
    entries: HealthNutritionEntryPayload[];
  }): Promise<{ entries: HealthNutritionEntry[] }> => {
    const timestamp = nowIso();
    const rows = body.entries.map((entry) => buildLocalNutritionRow(entry, timestamp));

    await writeLocalBulk(
      rows,
      (draft, chunk) => {
        draft.nutritionEntries.push(...chunk);
      },
      (chunk) => ({
        opType: 'NUTRITION_ENTRY_BULK_CREATE',
        entityType: 'nutrition_entry',
        entityId: chunk[0]!.id,
        payload: { count: chunk.length, ids: chunk.map((row) => row.id) },
      }),
    );

    return { entries: rows.map(toWire) };
  },

  /**
   * `POST /health/nutrition/copy-day` — `copyNutritionDay`
   * (`health-service.ts:716-751`).
   *
   * APPEND, never replace: the donor's copy sheets never deleted anything at the
   * target, and a copy that silently wiped a slot would be unrecoverable.
   *
   * Three details carried over exactly, each of which is a visible bug if
   * dropped:
   *
   *  - the source is read through the ordinary live-row reader, so tombstoned
   *    entries are never copied forward;
   *  - `food_id` and the stored basis travel WITH each copy, so a copied row
   *    still names the food it came from and is still re-portionable;
   *  - `source` does NOT travel. The service builds its copies out of a fixed
   *    field list that omits it, so every copy is `'manual'` — which is the
   *    honest reading, since the member chose to log it rather than a device
   *    importing it.
   */
  copyNutritionDay: async (body: {
    from_date: string;
    to_date: string;
    from_slot?: HealthMealType;
    to_slot?: HealthMealType;
  }): Promise<{ entries: HealthNutritionEntry[] }> => {
    // The source day is arbitrary — "copy last Tuesday" is a shipped gesture and
    // so is copying a day from last year. Reading it out of a window that does
    // not hold it copies NOTHING and reports success.
    await ensureResident([nutritionResidency(body.from_date, undefined, undefined)]);

    const sourceDay = applyHealthReadWindow(
      MEALS_DAY_READ,
      nutritionRows().filter((row) => row.date === body.from_date),
      { today: body.from_date },
    ).sort(byCreatedAtAsc);

    const source = body.from_slot
      ? sourceDay.filter((row) => asMealType(row.meal_type) === body.from_slot)
      : sourceDay;

    const timestamp = nowIso();
    const rows = source.map((row) =>
      buildLocalNutritionRow(
        {
          date: body.to_date,
          food_name: row.food_name,
          meal_type: body.to_slot ?? asMealType(row.meal_type),
          calories: row.calories,
          proteins: row.proteins,
          carbohydrates: row.carbohydrates,
          fats: row.fats,
          portion: row.portion,
          unit: row.unit,
          ...(row.food_id ? { food_id: row.food_id } : {}),
        },
        timestamp,
        // `null` (not `undefined`) when the source has no basis: an explicit
        // "there is nothing to carry" rather than "derive one", so a row that
        // was not re-portionable yesterday is not re-portionable today either.
        storedBasisOf(row),
      ),
    );

    await writeLocalBulk(
      rows,
      (draft, chunk) => {
        draft.nutritionEntries.push(...chunk);
      },
      (chunk) => ({
        opType: 'NUTRITION_ENTRY_COPY_DAY',
        entityType: 'nutrition_entry',
        entityId: chunk[0]!.id,
        payload: {
          from_date: body.from_date,
          to_date: body.to_date,
          count: chunk.length,
          ids: chunk.map((row) => row.id),
        },
      }),
    );

    return { entries: rows.map(toWire) };
  },

  /**
   * `DELETE /health/nutrition/entries/:id` — a TOMBSTONE, not a splice.
   *
   * The ledger tombstone is authoritative (`types.ts` header): removing the row
   * outright would let a peer device's older copy resurrect it on the next
   * merge, because LWW has nothing to compare a missing row against.
   *
   * Rejects when the row is unknown or already tombstoned, which is the same 404
   * the route answers (`routes/health.ts:353-357`) — and the same fact. A
   * resolved `{ deleted: false }` is a shape the Worker never produces.
   */
  deleteNutrition: async (id: string): Promise<{ deleted: boolean }> => {
    const existing = nutritionRows().find((row) => row.id === id);
    if (!existing) throw notFound('Entry not found');

    const timestamp = nowIso();
    await writeLocal(
      (draft) => {
        const row = draft.nutritionEntries.find((candidate) => candidate.id === id);
        if (!row) return;
        row.deleted_at = timestamp;
        row.updated_at = timestamp;
      },
      {
        opType: 'NUTRITION_ENTRY_DELETE',
        entityType: 'nutrition_entry',
        entityId: id,
        payload: { id, deleted_at: timestamp },
      },
    );

    return { deleted: true };
  },
};

export default localNutritionApi;
