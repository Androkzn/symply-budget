/**
 * `healthApi.getGoal` / `healthApi.saveGoal`, served from the on-device ledger
 * (plan §7, Stage He3b).
 *
 * Two methods, one table — and the single most widely READ table in Health.
 * `health_goals` is a day-slotted settings row: calorie and macro targets, the
 * water goal, the step/workout/sleep targets, the weight goal and its baseline,
 * the biometrics BMI/BMR need, and both display-unit switches all live on it.
 * Six of the seventeen Home loaders resolve to one row of this table
 * (`windows.ts`), which is why the resolver is exported rather than inlined —
 * see `activeHealthGoal` below.
 *
 * FOUR THINGS THIS FILE GETS RIGHT ON PURPOSE
 * -------------------------------------------
 * 1. **The row id is deterministic, and the upsert reads TOMBSTONES.**
 *    `health_goals` carries `unique(user_id, effective_date)`
 *    (`schema-health.ts:609`), so `ids.ts` mints `healthGoal(effectiveDate)` and
 *    two devices editing the same day-slot offline converge on ONE row. The
 *    lookup that decides insert-vs-update therefore goes through `allRowsOf`,
 *    not `rowsOf`: a deterministic id that re-inserts over a tombstone mints a
 *    second row with the SAME id, which LWW can then never separate again. This
 *    is the highest-risk line in the file.
 * 2. **"The goal in force on a date" is not "the newest goal".**
 *    `goalFor` (`health-service.ts:1393`) takes the newest row with
 *    `effective_date <= date`. Returning the newest row outright is wrong on
 *    every day the member views in the past, which the calorie-week editor does
 *    routinely. The window registry says the same thing in its own comment.
 * 3. **A save CARRIES FORWARD.** A new day-slot inherits the goal that was in
 *    force (`saveGoal`, `:1467-1494`), so setting only `daily_water_ml` today
 *    does not reset the calorie target to 2000. An existing slot is PATCHED —
 *    the `ON CONFLICT DO UPDATE` writes the patch columns and nothing else.
 * 4. **The route's key allowlist is reproduced.** `PUT /goals` is a
 *    `z.object`, so it silently strips anything it does not name — `id`,
 *    `user_id`, `created_at`, and the two D1 columns it has never accepted
 *    (`daily_active_calories`, `exclude_burned_calories`). A local facade that
 *    spreads `Partial<HealthGoal>` straight onto the row would let a screen
 *    write columns the server would have dropped, and the two devices then
 *    disagree the moment one of them is online.
 *
 * `health_goals` is the one Wave-A table with NO `deleted_at` column in D1
 * (`schema-health.ts:502-611`). The ledger tombstone is still authoritative
 * (`types.ts` header) — it is what "Clear all data" leaves behind — so reads
 * filter it and the DTO never carries it.
 */
// Bare side-effect, FIRST: @noble/* captures `globalThis.crypto` at module load
// and `ids`/`localWrite` reach @symply/local-first before the engine does.
import './cryptoPolyfill';

import type { HealthGoal } from '@api/health';

import { healthDeterministicIds, localDateKey } from './ids';
import { activeUserId, allRowsOf, nowIso, rowsOf, writeLocal } from './localWrite';
import { resolveGoalFor } from './summaries';
import type { LocalHealthGoal } from './types';
import { HEALTH_READ_WINDOWS, applyHealthReadWindow, type HealthLedgerRead } from './windows';

/**
 * The registry's own `ACTIVE_GOAL_READ` — one row, taken from the map rather
 * than restated, so the window and this facade cannot drift apart. Six loaders
 * share this exact object; `loadHealthPrefs` is simply the first of them.
 */
const ACTIVE_GOAL_READ: HealthLedgerRead = HEALTH_READ_WINDOWS.loadHealthPrefs.reads[0];

/**
 * `PUT /goals`' zod keys, verbatim (`routes/health.ts:697-774`).
 *
 * The list is the CONTRACT, not a convenience: the route strips every key it
 * does not name and answers 200, so a column absent here is a column the server
 * has never let a client write. Two real D1 columns are deliberately missing —
 * `daily_active_calories` and `exclude_burned_calories` — because the route has
 * never accepted them either. Adding one here without adding it there is how a
 * flag-1 device starts writing a value a flag-0 device cannot.
 */
const GOAL_PATCH_COLUMNS: readonly string[] = [
  'daily_calories',
  'use_per_day_calories',
  'monday_calories',
  'tuesday_calories',
  'wednesday_calories',
  'thursday_calories',
  'friday_calories',
  'saturday_calories',
  'sunday_calories',
  'daily_protein_grams',
  'daily_carbs_grams',
  'daily_fats_grams',
  'use_per_day_macros',
  'monday_protein_grams',
  'monday_carbs_grams',
  'monday_fats_grams',
  'tuesday_protein_grams',
  'tuesday_carbs_grams',
  'tuesday_fats_grams',
  'wednesday_protein_grams',
  'wednesday_carbs_grams',
  'wednesday_fats_grams',
  'thursday_protein_grams',
  'thursday_carbs_grams',
  'thursday_fats_grams',
  'friday_protein_grams',
  'friday_carbs_grams',
  'friday_fats_grams',
  'saturday_protein_grams',
  'saturday_carbs_grams',
  'saturday_fats_grams',
  'sunday_protein_grams',
  'sunday_carbs_grams',
  'sunday_fats_grams',
  'daily_water_ml',
  'daily_steps',
  'daily_workout_minutes',
  'daily_sleep_hours',
  'target_weight_kg',
  'weight_goal_type',
  'starting_weight_kg',
  'starting_weight_date',
  'height_cm',
  'gender',
  'birth_year',
  'activity_level',
  'water_unit',
  'unit_system',
];

/**
 * The three `{ mode: 'boolean' }` columns on `health_goals`.
 *
 * D1 stores them as INTEGER and drizzle hands the Worker real booleans, so the
 * wire carries `true`/`false` while the ledger row carries 0/1. Converted in
 * both directions here rather than at each call site — leaking a `1` into a
 * `boolean` field is the kind of drift that only shows up as a falsy `0`
 * somewhere three screens away.
 */
const GOAL_BOOLEAN_COLUMNS: readonly string[] = [
  'use_per_day_calories',
  'use_per_day_macros',
  'exclude_burned_calories',
];

/** The server's fallback when the member has never set a goal (`:1470-1475`). */
const GOAL_DEFAULTS = {
  daily_calories: 2000,
  use_per_day_calories: 0,
  use_per_day_macros: 0,
  exclude_burned_calories: 0,
} as const;

function toLedgerBoolean(value: unknown): number {
  return value ? 1 : 0;
}

function toWireBoolean(value: number | null | undefined): boolean {
  return value === null || value === undefined ? false : Boolean(value);
}

/**
 * The wire row: every D1 column, the three integer-booleans converted, and the
 * ledger-only tombstone dropped.
 *
 * Cast at the boundary because `HealthGoal` declares a SUBSET of the columns the
 * Worker actually sends — `daily_active_calories` and `exclude_burned_calories`
 * are real columns on a real response that the client type has never listed, and
 * `created_at` / `updated_at` likewise. Narrowing to the declared subset would
 * make the local answer smaller than the remote one, which is precisely the
 * "same signature" break He3 forbids.
 */
function toGoalDto(row: LocalHealthGoal | null): HealthGoal | null {
  if (!row) return null;
  const dto: Record<string, unknown> = { ...row };
  delete dto.deleted_at;
  // A locally authored row may not carry the column at all; the ledger is
  // already per user (plan §1.2), so the id is the household's user.
  dto.user_id = row.user_id ?? activeUserId();
  for (const column of GOAL_BOOLEAN_COLUMNS) {
    dto[column] = toWireBoolean(row[column as keyof LocalHealthGoal] as number | null | undefined);
  }
  return dto as unknown as HealthGoal;
}

/**
 * **The shared goal resolver.** Import this rather than re-deriving it.
 *
 * `localWaterApi`, `localNutritionApi`, `localEntriesApi`, `localWeightApi` and
 * `summaries.ts`'s callers all need "which goal was in force on this day" to
 * resolve calorie, macro, water and activity targets. Six Home loaders reduce to
 * this one call (`windows.ts`, `loadHealthGoals`'s note: *"a local
 * implementation should read it once"*). Duplicating the `effective_date <=
 * date` rule per facade is how two surfaces end up showing different targets for
 * the same day.
 *
 * Returns the LEDGER row (not the DTO) because every consumer is doing
 * arithmetic on it — `caloriesGoalFor` / `macrosGoalFor` in `summaries.ts` take
 * `LocalHealthGoal`. Use `localGoalsApi.getGoal` when you want the wire shape.
 *
 * `date` defaults to the device's LOCAL day. The route defaults to
 * `new Date().toISOString().slice(0, 10)` — a **UTC** key — which is the same
 * UTC/local mismatch `summaries.computeHabitStreak` documents. Local is what
 * every client caller means by "today" and what the member typed against, so it
 * is what this uses; the divergence is at most one day and only in the direction
 * of honouring the member's own calendar.
 *
 * The window is applied through `applyHealthReadWindow` — AFTER the
 * `effective_date <= date` filter, never before. Windowing first would take the
 * newest goal row outright and then discard it for being in the future, which
 * reads as "no goal set" on any day viewed in the past.
 */
export function activeHealthGoal(date: string = localDateKey()): LocalHealthGoal | null {
  const eligible = rowsOf<LocalHealthGoal>('healthGoals').filter(
    (row) => row.effective_date <= date,
  );
  return resolveGoalFor(applyHealthReadWindow(ACTIVE_GOAL_READ, eligible, { today: date }), date);
}

/** The same answer in wire shape — what `getGoal` returns, exposed for reuse. */
export function activeHealthGoalDto(date?: string): HealthGoal | null {
  return toGoalDto(activeHealthGoal(date));
}

/** Keep only the columns `PUT /goals` accepts, converting the two booleans. */
function toGoalPatch(body: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const column of GOAL_PATCH_COLUMNS) {
    if (!(column in body)) continue;
    const value = body[column];
    // zod's `.optional()` means an explicitly-undefined key is the same as an
    // absent one; `null` is a real value and CLEARS the column.
    if (value === undefined) continue;
    patch[column] = GOAL_BOOLEAN_COLUMNS.includes(column) ? toLedgerBoolean(value) : value;
  }
  return patch;
}

export const localGoalsApi = {
  /**
   * `GET /health/goals` — `HealthService.goalFor` (`health-service.ts:1393`).
   *
   * One row, always. The window registry records this as `{kind: 'rows',
   * maxRows: 1}` for all six loaders that reach it.
   */
  getGoal: async (date?: string): Promise<{ goal: HealthGoal | null }> => ({
    goal: activeHealthGoalDto(date),
  }),

  /**
   * `PUT /health/goals` — `HealthService.saveGoal` (`health-service.ts:1467`).
   *
   * Insert-or-patch on the `(user_id, effective_date)` day-slot:
   *
   *  - **Slot exists** (live OR tombstoned): only the patch columns move, plus
   *    `updated_at`. That is the `ON CONFLICT DO UPDATE SET {...patch}` half,
   *    and the tombstone is cleared because an upsert on a row D1 cannot even
   *    tombstone must not leave the local copy invisible.
   *  - **Slot is new**: the row is seeded from the goal in force on that date and
   *    then patched, so a save that sets one field keeps every other target the
   *    member had. With no prior goal at all, the server's own four defaults
   *    apply.
   *
   * The id is `healthDeterministicIds.healthGoal(effectiveDate)` — never
   * hand-formatted, never random. The slot lookup runs over `allRowsOf` for the
   * reason in the file header.
   */
  saveGoal: async (
    body: Partial<HealthGoal> & { effective_date?: string },
  ): Promise<{ goal: HealthGoal | null }> => {
    const effectiveDate = body.effective_date ?? localDateKey();
    const patch = toGoalPatch(body as Record<string, unknown>);
    const timestamp = nowIso();

    // TOMBSTONES INCLUDED — the conflict target is `(user_id, effective_date)`,
    // and matching on the natural key rather than on the id also catches a row
    // that arrived from D1 at cutover carrying a server-minted `goal_*` id.
    const slot =
      allRowsOf<LocalHealthGoal>('healthGoals').find(
        (row) => row.effective_date === effectiveDate,
      ) ?? null;

    if (slot) {
      await writeLocal(
        (draft) => {
          const row = draft.healthGoals.find((candidate) => candidate.id === slot.id);
          if (!row) return;
          Object.assign(row, patch);
          row.updated_at = timestamp;
          row.deleted_at = null;
        },
        {
          opType: 'GOAL_SAVE',
          entityType: 'healthGoal',
          entityId: slot.id,
          payload: { effectiveDate },
        },
      );
      return { goal: activeHealthGoalDto(effectiveDate) };
    }

    // `current` in the service: the goal in force on this date, which is an
    // EARLIER slot (this one does not exist yet) or nothing at all.
    const carried = activeHealthGoal(effectiveDate);
    const id = healthDeterministicIds.healthGoal(effectiveDate);
    const row = {
      ...(carried ?? GOAL_DEFAULTS),
      ...patch,
      id,
      user_id: activeUserId(),
      effective_date: effectiveDate,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
    } as LocalHealthGoal;

    await writeLocal(
      (draft) => {
        draft.healthGoals.push(row);
      },
      { opType: 'GOAL_SAVE', entityType: 'healthGoal', entityId: id, payload: { effectiveDate } },
    );
    return { goal: activeHealthGoalDto(effectiveDate) };
  },
};
