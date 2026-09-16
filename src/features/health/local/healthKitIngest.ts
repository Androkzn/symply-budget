/**
 * The HealthKit drain, pointed at the ledger — **Stage He11a, Wave B**
 * (plan §11, §1.6 row B).
 *
 * ## What this file is
 *
 * `healthKit.ts` reads Apple Health and turns what it finds into an idempotent
 * PLAN (`planImport`, `planWeightImport`, `planWorkoutImport`,
 * `planNutritionImport`). A `HealthKitImportSink` is where that plan is
 * executed. `createApiImportSink()` executes it against `healthApi`; this
 * executes it against the on-device ledger, and `resolveHealthKitImportSink()`
 * in `healthKit.ts` picks between them on `isHealthLocalFirst()`.
 *
 * ## Why a second sink exists at all, when the Proxy already routes
 *
 * `healthApi` is wrapped by `createHealthLocalProxy`, so on a flag-1 device the
 * API sink's `healthApi.createEntry(…)` already lands in the ledger. That is
 * true, and it is not enough, for three reasons — each of which is a bug this
 * file exists to close rather than a preference:
 *
 * 1. **One op per row.** *"Bulk callers must pre-chunk with `chunkRowsForOp` and
 *    call this once per chunk. One op per row is quadratic: every call
 *    re-captures and re-diffs the whole ledger"* (`engine.ts:908-912`). The
 *    drain is the fleet's largest bulk caller: a first connect reads two
 *    calendar months across nine scoped types, which is four `/health/entries`
 *    rows per day plus a weight row plus a nutrition row — several hundred full
 *    ledger diffs on a cold device, through `@noble` AEAD, on the JS thread. The
 *    Proxy cannot fix that: `healthApi` has no bulk verb to route to. This file
 *    writes each track through `writeLocalBulk`, so a 400-row backfill is a
 *    handful of ops.
 * 2. **Routing by accident is not routing by decision.** Nothing asserted that
 *    the drain reached the ledger; it did so as a side effect of importing
 *    `healthApi` rather than `remoteHealthApi`. `healthKitIngest.*.test.ts` now
 *    pins it, in airplane mode, with `POST /health` proven unreachable.
 * 3. **Weight was writing `origin: 'local'`.** `localEntriesApi` and
 *    `localNutritionApi` tag a `source: 'healthkit'` create as `'ingest'`;
 *    `localWeightApi` did not, so a background sync updated the ledger and left
 *    Home, Trends and the Weight screen painting yesterday's number until the
 *    member navigated away and back (`ledgerRefresh.ts` rule 2). He11a adds the
 *    third `originFor`.
 *
 * ## THE DE-DUPLICATOR IS NOT HERE, AND MUST NOT MOVE HERE
 *
 * Every skip / supersede / create decision stays in `healthKit.ts`'s four
 * `plan*Import` functions, unchanged. This file is the executor. That split is
 * load-bearing: an under-read of the existing set produces a DUPLICATE row —
 * permanently, on every device that syncs — where an over-read merely costs
 * time. So the three baseline reads below go through the SAME facade methods
 * every screen uses, which carry the registered windows out of `windows.ts`
 * verbatim, including two inherited quirks that look like bugs and are not:
 *
 *  - **weight = 200 rows, not 500.** The drain sends no `limit`, so
 *    `listWeight` falls back to the route's own default
 *    (`health-service.ts:202-212`) rather than `loadWeightLog`'s 500. Serving
 *    500 here would change how much history the de-duplicator sees — a
 *    behaviour change wearing the costume of a bug fix.
 *  - **nutrition = no row cap at all.** `listNutrition` carries no limit, so the
 *    caller's from/to IS the window (`windows.ts`, `MEALS_RANGE_READ`). Clamping
 *    it to `loadMeals`' 120 days would silently re-import everything older than
 *    the boundary on every single pass.
 *
 * Reads therefore call `localEntriesApi.listEntries` / `localWeightApi.listWeight`
 * / `localNutritionApi.listNutrition` and never `rowsOf()` directly. Writes are
 * the only thing that bypasses the facade methods, and only to batch — the ROW
 * SHAPE still comes from the facades' own builders, so an imported row is
 * byte-identical to a typed one apart from its `source`.
 *
 * ## `weight_entries` keeps RANDOM ids
 *
 * `buildLocalWeightRow` mints `newLocalId('wgt')`, exactly as `createWeight`
 * does. A `weight_${date}` builder would let LWW drop one of two weigh-ins on
 * the same day — the flagship silent-loss case the registry guard exists for
 * (plan §1.5a). Nothing here mints a deterministic id for any table.
 *
 * ## NOT IN WAVE B: water
 *
 * `water_entries` has **no `source` column** (plan §1.5 row 2), so an imported
 * glass would be indistinguishable from a typed one and "manual always wins"
 * would be unimplementable for it. HealthKit water is out of Wave B until a
 * migration adds the column — and migration numbers are claimed on `main`, so
 * that is not this stage's to write. There is deliberately no water track below,
 * no `dietaryWater` in `healthKitTypes.ts`, and no `localWaterApi` import.
 *
 * ## NOT IN WAVE C
 *
 * The registry stays at eight tables. Nothing here touches `period_entries`,
 * `cycle_symptom_entries`, `mens_health_entries`, `cycle_settings` or
 * `mens_health_settings` — He10's baseline is red and plan §4 descopes Wave C
 * until the mitigations close it.
 */
// Bare side-effect, FIRST: @noble/* captures `globalThis.crypto` at module load
// and `localWrite` reaches @symply/local-first before it reaches the engine.
// `healthKit.ts` requires this module lazily, so it can be the first Health
// local module in the graph on a device that connects Apple Health before
// opening a Health screen.
import './cryptoPolyfill';

// Type-only, and deliberately so: `healthKit.ts` requires THIS module at
// runtime, so a value import back the other way would be a cycle. Babel erases
// `import type` outright, which is what keeps the edge one-directional.
import type {
  HealthKitExistingEntry,
  HealthKitExistingNutrition,
  HealthKitExistingWeight,
  HealthKitImportSink,
} from '../healthKit';
import type {
  HealthKitEntryPayload,
  HealthKitNutritionPayload,
  HealthKitWeightPayload,
  HealthKitWorkoutPayload,
} from '../healthKitTypes';

import { buildLocalHealthEntryRow, localEntriesApi } from './localEntriesApi';
import { buildLocalNutritionRow, localNutritionApi } from './localNutritionApi';
import { buildLocalWeightRow, localWeightApi } from './localWeightApi';
import { nowIso, writeLocalBulk } from './localWrite';
import type { LocalHealthEntry, LocalNutritionEntry, LocalWeightEntry } from './types';

/* ------------------------------------------------------------------ */
/* Bulk writes — one op per chunk, never one op per row                */
/* ------------------------------------------------------------------ */

/**
 * `origin: 'ingest'`, on every write below without exception.
 *
 * Not a default and not an optimisation. `'local'` — the ordinary value — is a
 * NO-OP for refresh subscribers, on the premise that the screen which saved has
 * already rendered the row. A drain write breaks that premise: it goes through
 * this device, so it *is* a local echo by the engine's definition, and NO SCREEN
 * RENDERED IT. Tagging it `'local'` is precisely how "Apple Health synced" lands
 * as a toast over a Home screen still showing yesterday's figures
 * (`localWrite.ts`, `engine.ts:914-917`, `ledgerRefresh.ts` rule 2).
 */
const INGEST = { origin: 'ingest' } as const;

/**
 * The `healthEntries` bulk append, shared by the scalar and workout tracks.
 *
 * Both write the same table through the same builder; only the `opType` differs,
 * which is how the op journal keeps "imported four days of steps" legible from
 * "imported three workouts" on the member's other device.
 */
async function appendEntryRows(rows: LocalHealthEntry[], opType: string): Promise<void> {
  await writeLocalBulk(
    rows,
    (draft, chunk) => {
      draft.healthEntries.push(...chunk);
    },
    (chunk) => ({
      opType,
      entityType: 'health_entry',
      entityId: chunk[0]!.id,
      // Ids and a count, never the rows: the op payload rides the relay, and
      // §15 keeps row data off it. The delta the engine seals alongside carries
      // the values.
      payload: { count: chunk.length, ids: chunk.map((row) => row.id) },
    }),
    INGEST,
  );
}

/* ------------------------------------------------------------------ */
/* The sink                                                            */
/* ------------------------------------------------------------------ */

/**
 * The ledger-backed `HealthKitImportSink` — the Wave B destination.
 *
 * Every method is the local counterpart of the one `createApiImportSink()`
 * implements, in the same order, so the two can be read side by side. Reads
 * delegate to the facades (windows); writes delegate to the facades' row
 * builders (shape) and to `writeLocalBulk` (batching).
 */
export function createLedgerHealthKitImportSink(): HealthKitImportSink {
  return {
    /* ---- the `/health/entries` track: steps, energy, sleep, heart rate ---- */

    /**
     * The baseline `planImport` de-duplicates against.
     *
     * No `type` is passed, exactly as the remote sink omits it, so
     * `localEntriesApi` selects `healthKitImportSink.listExisting`'s registered
     * window: the caller's own from/to, capped at the 400 the route silently
     * applies. Under-reading here is what stacks duplicate step rows forever.
     */
    listExisting: async ({ from, to }) => {
      const { entries } = await localEntriesApi.listEntries({ from, to });
      return entries as readonly HealthKitExistingEntry[];
    },

    create: async (payload) => {
      await localEntriesApi.createEntry(payload);
    },

    /**
     * A supersede — the plan always pairs one with a create for the same day, so
     * the repaint comes from that create and this stays an ordinary tombstone.
     */
    remove: async (id) => {
      await localEntriesApi.deleteEntry(id);
    },

    /**
     * Every scalar create the plan produced, as a handful of ops.
     *
     * `plan.create` is already de-duplicated (at most one payload per day per
     * `entry_type`), so nothing here re-checks it: doing so would put a second,
     * divergent copy of the de-duplicator in the executor.
     */
    createAll: async (payloads: readonly HealthKitEntryPayload[]) => {
      const timestamp = nowIso();
      const rows = payloads.map((payload) =>
        buildLocalHealthEntryRow(
          {
            date: payload.date,
            entry_type: payload.entry_type,
            data: payload.data,
            source: payload.source,
          },
          timestamp,
        ),
      );
      await appendEntryRows(rows, 'HEALTH_ENTRY_BULK_INGEST');
    },

    /* ---- the weight track: `weight_entries`, a different table ---- */

    /**
     * ⚠️ 200 rows, not 500 — and that is the registry's decision, not a typo.
     *
     * No `limit` is passed, so `localWeightApi.listWeight` applies the route's
     * own default (`WEIGHT_ROUTE_DEFAULT_LIMIT`) rather than `loadWeightLog`'s
     * 500. `windows.ts` records the asymmetry deliberately: a drain over a range
     * holding more than 200 weight rows has ALWAYS re-imported the overflow, and
     * matching the remote means matching that. Improving on it is a real fix, to
     * be made on purpose and with the registry updated first.
     */
    listExistingWeight: async ({ from, to }) => {
      const { entries } = await localWeightApi.listWeight({ from, to });
      return entries as readonly HealthKitExistingWeight[];
    },

    createWeight: async (payload) => {
      await localWeightApi.createWeight(payload);
    },

    removeWeight: async (id) => {
      await localWeightApi.deleteWeight(id);
    },

    /** RANDOM ids, via the facade's own builder — see the file header. */
    createWeightAll: async (payloads: readonly HealthKitWeightPayload[]) => {
      const timestamp = nowIso();
      const rows: LocalWeightEntry[] = payloads.map((payload) =>
        buildLocalWeightRow(payload, timestamp),
      );

      await writeLocalBulk(
        rows,
        (draft, chunk) => {
          draft.weightEntries.push(...chunk);
        },
        (chunk) => ({
          opType: 'WEIGHT_ENTRY_BULK_INGEST',
          entityType: 'weight_entry',
          entityId: chunk[0]!.id,
          payload: { count: chunk.length, ids: chunk.map((row) => row.id) },
        }),
        INGEST,
      );
    },

    /* ---- the workout track: `healthEntries` again, keyed on Apple's uuid ---- */

    createWorkout: async (payload) => {
      await localEntriesApi.createEntry(payload);
    },

    /**
     * `healthkit_uuid` travels inside `data`, untouched.
     *
     * It is the de-duplication key `planWorkoutImport` reads back on the next
     * pass (`healthKit.ts`), so dropping or renaming it while building the row
     * would re-import every session on every sync. `health_entries.data` is
     * schemaless by design and this is exactly the source-specific fact it
     * exists for.
     */
    createWorkoutAll: async (payloads: readonly HealthKitWorkoutPayload[]) => {
      const timestamp = nowIso();
      const rows = payloads.map((payload) =>
        buildLocalHealthEntryRow(
          {
            date: payload.date,
            entry_type: payload.entry_type,
            data: payload.data,
            source: payload.source,
          },
          timestamp,
        ),
      );
      await appendEntryRows(rows, 'HEALTH_ENTRY_WORKOUT_BULK_INGEST');
    },

    /* ---- the nutrition track: one `'Apple Health'` row per local day ---- */

    /**
     * The only genuinely range-only read in the registry — no row cap to fall
     * back on, so the caller's from/to is honoured exactly. `localNutritionApi`
     * picks `MEALS_RANGE_READ` for a from/to pair precisely for this caller.
     */
    listExistingNutrition: async ({ from, to }) => {
      const { entries } = await localNutritionApi.listNutrition({ from, to });
      return entries as readonly HealthKitExistingNutrition[];
    },

    createNutrition: async (payload) => {
      await localNutritionApi.createNutrition(payload);
    },

    removeNutrition: async (id) => {
      await localNutritionApi.deleteNutrition(id);
    },

    /**
     * `food_name: 'Apple Health'` is the sentinel `planNutritionImport` matches
     * on, alongside `source: 'healthkit'`. Both travel through the builder
     * untouched; a "tidier" name would orphan every row the last sync wrote and
     * duplicate the day.
     */
    createNutritionAll: async (payloads: readonly HealthKitNutritionPayload[]) => {
      const timestamp = nowIso();
      const rows: LocalNutritionEntry[] = payloads.map((payload) =>
        buildLocalNutritionRow(payload, timestamp),
      );

      await writeLocalBulk(
        rows,
        (draft, chunk) => {
          draft.nutritionEntries.push(...chunk);
        },
        (chunk) => ({
          opType: 'NUTRITION_ENTRY_BULK_INGEST',
          entityType: 'nutrition_entry',
          entityId: chunk[0]!.id,
          payload: { count: chunk.length, ids: chunk.map((row) => row.id) },
        }),
        INGEST,
      );
    },
  };
}

export default createLedgerHealthKitImportSink;
