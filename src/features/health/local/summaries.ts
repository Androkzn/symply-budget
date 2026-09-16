import type {
  HealthDailySummary,
  HealthHabit,
  HealthHabitFrequency,
  HealthHabitTimeOfDay,
  HealthMealType,
  HealthNutritionSummary,
  HealthNutritionTotals,
  HealthWaterSummary,
  HealthWeeklyTrendChange,
  HealthWeeklyTrendWindow,
  HealthWeeklyWeight,
  HealthWeightStatistics,
  HealthWeightUnit,
} from '@api/health';

import type {
  LocalHabitLog,
  LocalHealthEntry,
  LocalHealthGoal,
  LocalNutritionEntry,
  LocalUserHabit,
  LocalWaterEntry,
  LocalWeightEntry,
} from './types';

/**
 * He7-lite — the six server-computed Health summaries, ported to pure on-device
 * functions. **This file is the hard Exit of He3** (plan §0, §9): under E2EE the
 * Worker cannot see the ledger, so every figure it computes today has to move
 * here or Home and Trends go dark on a flag-1 build.
 *
 * `src/api/health.ts:10-12` states the design being replaced — *"summaries,
 * statistics, streaks and cycle predictions are computed server-side so the
 * phone, widget and watch can never disagree"*. The computation itself lives in
 * `backend/src/services/health-service.ts`; each function below names the server
 * function it mirrors and the line it was ported from.
 *
 * **Contract.**
 *  - Pure. No engine import, no network, no MMKV, no clock, no `Date.now()`.
 *    Every "today" and "now" is an argument, which is what makes the parity
 *    suite able to pin the timezone/day-boundary cases at all.
 *  - Rows in, envelope out. The caller (the He3 Proxy) reads the ledger and
 *    hands over arrays; these functions never decide *where* a row came from.
 *  - Return shapes are byte-compatible with what the Worker sends today, key
 *    order included, so the screens do not change. Where `src/api/health.ts`
 *    *mis-declares* what the Worker actually sends, the runtime shape wins and
 *    the drift is named in the doc comment (see `computeWeeklyTrend` and
 *    `computeHabitList`).
 *
 * **Tombstones.** The server filters `isNull(deleted_at)` on every log table;
 * so does every function here. `health_goals` is the one exception — it carries
 * no `deleted_at` column in D1 at all (`schema-health.ts:502-611`), so
 * `goalFor` cannot filter one. The *ledger* tombstone is authoritative
 * (`types.ts` header), so `resolveGoalFor` does filter it. That is a deliberate
 * local-only extension, not a parity break: no server fixture can produce a
 * tombstoned goal.
 *
 * **Determinism.** Several server queries order by a non-unique column
 * (`ORDER BY date DESC` over two weigh-ins on one day) and take the first row.
 * SQLite leaves that tie unspecified. Every such site here breaks the tie
 * explicitly — and in the direction `weeklyTrend` already documents for itself
 * (*"Ascending so the LATEST logged one wins"*, `health-service.ts:991-993`) —
 * so two devices with the same rows always paint the same number.
 */

/* ------------------------------------------------------------------ */
/* Date helpers — ported verbatim from health-service.ts:86-109        */
/* ------------------------------------------------------------------ */

/** Monday-based week start for a `YYYY-MM-DD` key (donor convention). */
export function weekStartOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Sunday
  const delta = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The route validators check the `YYYY-MM-DD` *shape* only, so a
 * calendar-impossible `2026-13-45` is a live possibility rather than a
 * theoretical one (`health-service.ts:935-942`). Anything that would make
 * `addDays`/`weekStartOf` throw on `.toISOString()` is filtered here first.
 */
export function isValidDateKey(date: string): boolean {
  return !Number.isNaN(new Date(`${date}T00:00:00Z`).getTime());
}

/** UTC weekday, 0 = Sunday — the index the per-weekday goal arrays are in. */
function utcDayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/* ------------------------------------------------------------------ */
/* Row helpers                                                         */
/* ------------------------------------------------------------------ */

/**
 * `isNull(deleted_at)` — matched exactly, not approximated with `!row.deleted_at`.
 * An empty-string `deleted_at` is NOT NULL in SQL and the server would exclude
 * the row; truthiness would have kept it.
 */
function isLive(row: { deleted_at?: string | null }): boolean {
  return row.deleted_at === null || row.deleted_at === undefined;
}

/** SQLite BINARY collation for the `TEXT` date columns. Newest first. */
function descending(a: string, b: string): number {
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

/** The same collation, oldest first. */
function ascending(a: string, b: string): number {
  if (a === b) return 0;
  return a > b ? 1 : -1;
}

/** `Math.round(x * 10) / 10` — the server's one-decimal rounding, verbatim. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * `Math.min(...values)` on a 10-year corpus is an argument-count risk on Hermes;
 * the reduce is identical for every non-empty input the server can reach.
 */
function minOf(values: readonly number[]): number {
  return values.reduce((low, value) => (value < low ? value : low), values[0]);
}

function maxOf(values: readonly number[]): number {
  return values.reduce((high, value) => (value > high ? value : high), values[0]);
}

/**
 * `weight_entries.unit` is free `TEXT` in D1 (`'kg' | 'lb' | 'lbs'` by
 * convention, `'lbs'` only on donor-imported rows) and the Worker hands it back
 * verbatim — so the value is preserved rather than defaulted or rewritten.
 */
function asWeightUnit(unit: string): HealthWeightUnit {
  return unit as HealthWeightUnit;
}

/**
 * The four real meal slots. `nutritionSummary` folds anything else into `snack`
 * (`health-service.ts:897`); the guard reproduces that without the server's
 * `byMeal[r.meal_type]` prototype hole (a row whose `meal_type` were
 * `'constructor'` resolves to a truthy `Function` there, so its macros land on
 * `Function.prototype` instead of `snack` — unreachable through the validated
 * routes, and free to close here).
 */
const MEAL_TYPES: readonly HealthMealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

function isMealType(value: string): value is HealthMealType {
  return (MEAL_TYPES as readonly string[]).includes(value);
}

function zeroTotals(): HealthNutritionTotals {
  return { calories: 0, proteins: 0, carbohydrates: 0, fats: 0 };
}

/**
 * D1 stores `user_habits.reminder_enabled` / `.is_archived` as INTEGER in
 * drizzle `boolean` mode, so the Worker answers real booleans and the screens
 * (`healthHabitsStorage.fromWire`) read them as such. A ledger row carries the
 * raw 0/1, so it is converted back on the way out rather than leaking an
 * integer into a `boolean` field.
 */
function toBoolean(value: number | null | undefined): boolean {
  return value === null || value === undefined ? false : Boolean(value);
}

/** `health-service.ts:160-170`, verbatim — a corrupt blob reads as null. */
function parseStoredCustomDays(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const days = (parsed as unknown[])
      .map((value) => Number(value))
      .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7);
    return days.length > 0 ? days : null;
  } catch {
    return null;
  }
}

/**
 * Newest weigh-in first.
 *
 * The server orders by `date` alone (`listWeight`, `health-service.ts:210`) and
 * then reads `rows[0]`, which is unspecified for two readings on one day.
 * `created_at` then `id` break the tie towards the LATEST logged reading — the
 * rule `weeklyTrend` already picks explicitly for itself.
 *
 * Exported for `localSummariesApi`, which has to apply the same ordering BEFORE
 * a row ceiling (the server orders then limits, so a facade that limits then
 * orders keeps the wrong 1000 rows). One comparator, so the facade and the
 * arithmetic can never disagree about which reading is "the latest".
 */
export function compareWeightNewestFirst(a: LocalWeightEntry, b: LocalWeightEntry): number {
  return (
    descending(a.date, b.date) ||
    descending(a.created_at, b.created_at) ||
    descending(a.id, b.id)
  );
}

/* ------------------------------------------------------------------ */
/* Goals — health-service.ts:1393-1465                                 */
/* ------------------------------------------------------------------ */

/**
 * The goal in force ON a date — the newest row with `effective_date <= date`
 * (`goalFor`, `:1393`). `null` when the member has never set one, or has only
 * set one for a future date.
 *
 * `unique(user_id, effective_date)` makes the `effective_date` tie impossible in
 * D1 and the `healthGoal_${effectiveDate}` deterministic id makes it impossible
 * in the ledger; `id` breaks it anyway so a corrupted store still resolves the
 * same goal on every device.
 */
export function resolveGoalFor(
  goals: readonly LocalHealthGoal[],
  date: string
): LocalHealthGoal | null {
  let best: LocalHealthGoal | null = null;
  for (const goal of goals) {
    // `health_goals` has no `deleted_at` in D1, so the server cannot filter one.
    // The ledger tombstone is authoritative — see the file header.
    if (!isLive(goal)) continue;
    if (goal.effective_date > date) continue;
    if (
      best === null ||
      goal.effective_date > best.effective_date ||
      (goal.effective_date === best.effective_date && goal.id > best.id)
    ) {
      best = goal;
    }
  }
  return best;
}

/** Per-weekday calorie override (`caloriesGoalFor`, `:1406`). */
export function caloriesGoalFor(goal: LocalHealthGoal, date: string): number {
  if (!goal.use_per_day_calories) return goal.daily_calories;
  const perDay: Array<number | null | undefined> = [
    goal.sunday_calories,
    goal.monday_calories,
    goal.tuesday_calories,
    goal.wednesday_calories,
    goal.thursday_calories,
    goal.friday_calories,
    goal.saturday_calories,
  ];
  // An unparseable date yields NaN here; `perDay[NaN]` is `undefined` and the
  // daily figure stands, exactly as it does on the Worker.
  return perDay[utcDayOfWeek(date)] ?? goal.daily_calories;
}

/** Per-weekday macro override (`macrosGoalFor`, `:1422`). */
export function macrosGoalFor(
  goal: LocalHealthGoal,
  date: string
): { proteins: number | null; carbohydrates: number | null; fats: number | null } {
  const fallback = {
    proteins: goal.daily_protein_grams ?? null,
    carbohydrates: goal.daily_carbs_grams ?? null,
    fats: goal.daily_fats_grams ?? null,
  };
  if (!goal.use_per_day_macros) return fallback;
  const dow = utcDayOfWeek(date);
  const perDayProtein: Array<number | null | undefined> = [
    goal.sunday_protein_grams,
    goal.monday_protein_grams,
    goal.tuesday_protein_grams,
    goal.wednesday_protein_grams,
    goal.thursday_protein_grams,
    goal.friday_protein_grams,
    goal.saturday_protein_grams,
  ];
  const perDayCarbs: Array<number | null | undefined> = [
    goal.sunday_carbs_grams,
    goal.monday_carbs_grams,
    goal.tuesday_carbs_grams,
    goal.wednesday_carbs_grams,
    goal.thursday_carbs_grams,
    goal.friday_carbs_grams,
    goal.saturday_carbs_grams,
  ];
  const perDayFats: Array<number | null | undefined> = [
    goal.sunday_fats_grams,
    goal.monday_fats_grams,
    goal.tuesday_fats_grams,
    goal.wednesday_fats_grams,
    goal.thursday_fats_grams,
    goal.friday_fats_grams,
    goal.saturday_fats_grams,
  ];
  return {
    proteins: perDayProtein[dow] ?? fallback.proteins,
    carbohydrates: perDayCarbs[dow] ?? fallback.carbohydrates,
    fats: perDayFats[dow] ?? fallback.fats,
  };
}

/* ------------------------------------------------------------------ */
/* 1. nutritionSummary — health-service.ts:885                         */
/* ------------------------------------------------------------------ */

export interface NutritionSummaryInput {
  date: string;
  nutrition: readonly LocalNutritionEntry[];
  /** Already resolved for `date` — see `resolveGoalFor`. */
  goal: LocalHealthGoal | null;
}

/**
 * Per-slot + day totals against the goal in force on that date.
 *
 * `entry_count` counts every live row for the day, including any whose
 * `meal_type` is unrecognised (those macros land in `snack`, as on the Worker).
 * Nothing here is rounded — the server sums raw column values and so does this.
 */
export function computeNutritionSummary(input: NutritionSummaryInput): HealthNutritionSummary {
  const byMeal: Record<HealthMealType, HealthNutritionTotals> = {
    breakfast: zeroTotals(),
    lunch: zeroTotals(),
    dinner: zeroTotals(),
    snack: zeroTotals(),
  };
  const totals = zeroTotals();
  let entryCount = 0;

  for (const row of input.nutrition) {
    if (!isLive(row)) continue;
    if (row.date !== input.date) continue;
    entryCount += 1;
    const slot = isMealType(row.meal_type) ? byMeal[row.meal_type] : byMeal.snack;
    slot.calories += row.calories;
    slot.proteins += row.proteins;
    slot.carbohydrates += row.carbohydrates;
    slot.fats += row.fats;
    totals.calories += row.calories;
    totals.proteins += row.proteins;
    totals.carbohydrates += row.carbohydrates;
    totals.fats += row.fats;
  }

  return {
    date: input.date,
    totals,
    by_meal: byMeal,
    entry_count: entryCount,
    goal: input.goal
      ? {
          calories: caloriesGoalFor(input.goal, input.date),
          ...macrosGoalFor(input.goal, input.date),
        }
      : null,
  };
}

/* ------------------------------------------------------------------ */
/* 2. waterSummary — health-service.ts:492 (waterDailySummary)         */
/* ------------------------------------------------------------------ */

export interface WaterSummaryInput {
  date: string;
  water: readonly LocalWaterEntry[];
  goal: LocalHealthGoal | null;
}

/**
 * Millilitres logged on one day against `health_goals.daily_water_ml`.
 *
 * **No unit conversion happens here, and that is correct.** `daily_water_ml` is
 * canonical millilitres and `water_entries.amount_ml` likewise;
 * `health_goals.water_unit` (`'ml' | 'oz' | 'L' | 'cups'`) is a DISPLAY switch
 * that "never holds a quantity, only how to display one"
 * (`schema-health.ts:585-592`). Converting here would double-convert at render.
 */
export function computeWaterSummary(input: WaterSummaryInput): HealthWaterSummary {
  let total = 0;
  let entryCount = 0;
  for (const row of input.water) {
    if (!isLive(row)) continue;
    if (row.date !== input.date) continue;
    total += row.amount_ml;
    entryCount += 1;
  }
  return {
    date: input.date,
    total_ml: total,
    goal_ml: input.goal?.daily_water_ml ?? null,
    entry_count: entryCount,
  };
}

/* ------------------------------------------------------------------ */
/* 3. weightStatistics — health-service.ts:396                         */
/* ------------------------------------------------------------------ */

/**
 * `listWeight(userId, { from, limit: 1000 })` — the ceiling is applied AFTER
 * the newest-first ordering, so on a corpus larger than this the `first` figure
 * is the 1000th-newest reading, not the member's first ever. Ported as-is: it
 * is the shipped contract, and silently widening it would change every
 * "change since" number on the Weight tab.
 */
export const WEIGHT_STATISTICS_ROW_LIMIT = 1000;

export interface WeightStatisticsInput {
  weight: readonly LocalWeightEntry[];
  /** Inclusive lower bound on `date`, as the route's `?from=` query. */
  from?: string;
  limit?: number;
}

/**
 * Only entries sharing the LATEST unit are compared — mixing kg and lb would
 * report a change that never happened (`health-service.ts:392-395`).
 *
 * `change` and `average` round to one decimal; `min` and `max` do not. That
 * asymmetry is the server's, kept.
 */
export function computeWeightStatistics(input: WeightStatisticsInput): HealthWeightStatistics {
  const rows = input.weight
    .filter((row) => isLive(row) && (input.from === undefined || row.date >= input.from))
    .sort(compareWeightNewestFirst)
    .slice(0, input.limit ?? WEIGHT_STATISTICS_ROW_LIMIT);

  if (rows.length === 0) {
    return {
      count: 0,
      unit: null,
      latest: null,
      first: null,
      change: null,
      average: null,
      min: null,
      max: null,
    };
  }

  const unit = rows[0].unit;
  const same = rows.filter((row) => row.unit === unit);
  const values = same.map((row) => row.weight);
  const latest = same[0];
  const first = same[same.length - 1];

  return {
    count: same.length,
    unit: asWeightUnit(unit),
    latest: latest.weight,
    first: first.weight,
    change: round1(latest.weight - first.weight),
    average: round1(sum(values) / values.length),
    min: minOf(values),
    max: maxOf(values),
  };
}

/* ------------------------------------------------------------------ */
/* 4. weeklyWeight — health-service.ts:382 (weeklyAverages)            */
/* ------------------------------------------------------------------ */

/** `weeklyAverages(userId, limit = 26)` — half a year of weeks. */
export const HEALTH_WEEKLY_WEIGHT_DEFAULT_LIMIT = 26;

export interface WeeklyWeightInput {
  weight: readonly LocalWeightEntry[];
  limit?: number;
}

/**
 * Monday-start weekly weight rollups, newest week first.
 *
 * The server READS a materialised table (`health_weekly_weight_averages`),
 * upserted by `recomputeWeeklyAverage` (`:322`) on every weight write. That
 * table is explicitly **not ledgered** — plan §1.5 lists it as "Tier D
 * recompute" — so the port recomputes it from `weightEntries` instead. Two
 * consequences, both improvements, both asserted in the parity suite:
 *
 *  1. **`id` is deterministic** (`wk_<week_start>`). The server mints a random
 *     `wk_<uuid>` once and keeps it; a recompute has nothing to keep, and a
 *     random id per render would re-key every list row on every paint.
 *  2. **Every week with a reading appears.** The server's table only holds weeks
 *     that a write has touched since the feature landed, so a week older than
 *     the rollup was never backfilled and is simply absent.
 *
 * ⚠️ `average_weight` is a plain mean of the week's `weight` values with **no
 * unit filter** — a week holding both a kg and a lb reading averages the two
 * raw numbers. That is the server's behaviour (`:351, :360`) and is preserved
 * for parity, but it is the exact mistake `weightStatistics` guards against 20
 * lines above it in the same file. See the port report.
 */
export function computeWeeklyWeight(input: WeeklyWeightInput): HealthWeeklyWeight[] {
  const byWeek = new Map<string, LocalWeightEntry[]>();
  for (const row of input.weight) {
    if (!isLive(row)) continue;
    // A calendar-impossible `date` would throw inside `weekStartOf`. The write
    // routes validate the shape only, so the row is dropped rather than taking
    // the whole Weight tab down with it.
    if (!isValidDateKey(row.date)) continue;
    const start = weekStartOf(row.date);
    const bucket = byWeek.get(start);
    if (bucket) bucket.push(row);
    else byWeek.set(start, [row]);
  }

  return [...byWeek.keys()]
    .sort(descending)
    .slice(0, input.limit ?? HEALTH_WEEKLY_WEIGHT_DEFAULT_LIMIT)
    .map((weekStart) => {
      const rows = byWeek.get(weekStart) ?? [];
      const values = rows.map((row) => row.weight);
      // The server stores whichever unit the row that last triggered a
      // recompute carried; the closest reproducible rule over surviving rows is
      // the most recently written one.
      const unitSource = [...rows].sort(
        (a, b) =>
          descending(a.updated_at, b.updated_at) ||
          descending(a.created_at, b.created_at) ||
          descending(a.id, b.id)
      )[0];
      return {
        id: `wk_${weekStart}`,
        week_start: weekStart,
        week_end: addDays(weekStart, 6),
        average_weight: sum(values) / values.length,
        min_weight: minOf(values),
        max_weight: maxOf(values),
        entry_count: values.length,
        weight_unit: unitSource.unit,
      };
    });
}

/* ------------------------------------------------------------------ */
/* 5. getWeeklyTrend — health-service.ts:934 (weeklyTrend)             */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ **`src/api/health.ts` under-declares this envelope in three places.** The
 * types there are what a reader believes; these are what the Worker sends, and
 * what this port therefore returns:
 *
 * | Field | Declared (`api/health.ts`) | Actually sent (`health-service.ts`) |
 * |---|---|---|
 * | `days[].calorie_goal` | `number` (`:225`) | `number \| null` — `null` on any day with no goal (`:1010`) |
 * | `daily_weight[]` | `Array<Point \| null>` (`:239`) | always an object; the GAP is `{ date, weight: null }` (`:1013`) |
 * | `<window>.avg_weight` | absent | present on both windows (`:1046-1047`) |
 *
 * The four derivations in `healthWeeklyTrendStorage.ts` survive all three by
 * accident (`Number.isFinite(null)` is false; `null > 0` is false), which is
 * why the drift has never shown up as a bug. The runtime shape is kept, so the
 * local types below are a strict widening of `HealthWeeklyTrendWindow` rather
 * than a redeclaration — `LocalHealthWeeklyTrendResponse` is deliberately NOT
 * assignable to `HealthWeeklyTrendResponse` until `api/health.ts` is corrected
 * by the module's owner.
 */
export interface LocalHealthWeeklyTrendDay {
  date: string;
  calories: number;
  calorie_goal: number | null;
}

export interface LocalHealthWeeklyTrendWeightPoint {
  date: string;
  /** `null` = nothing logged that day. A gap, never a zero. */
  weight: number | null;
}

export interface LocalHealthWeeklyTrendWindow
  extends Omit<HealthWeeklyTrendWindow, 'days' | 'daily_weight'> {
  days: LocalHealthWeeklyTrendDay[];
  daily_weight: LocalHealthWeeklyTrendWeightPoint[];
  avg_weight: number | null;
}

export interface LocalHealthWeeklyTrendResponse {
  this_week: LocalHealthWeeklyTrendWindow;
  last_week: LocalHealthWeeklyTrendWindow;
  change: HealthWeeklyTrendChange;
}

export interface WeeklyTrendInput {
  /** Any day in "this week". Monday-start math, as `recomputeWeeklyAverage`. */
  date: string;
  nutrition: readonly LocalNutritionEntry[];
  weight: readonly LocalWeightEntry[];
  /** ALL goal rows — the trend resolves the goal in force per day, not per week. */
  goals: readonly LocalHealthGoal[];
}

function emptyTrendWindow(date: string): LocalHealthWeeklyTrendWindow {
  return {
    week_start: date,
    week_end: date,
    days: [],
    daily_weight: [],
    total_calories: 0,
    avg_calories: 0,
    avg_weight: null,
  };
}

/** Mean of the days that actually have a reading — never zero-filled to 7. */
function averageOfLogged(values: ReadonlyArray<number | null>): number | null {
  const numbers = values.filter((value): value is number => value !== null);
  if (numbers.length === 0) return null;
  return sum(numbers) / numbers.length;
}

function buildTrendWindow(
  weekStart: string,
  input: WeeklyTrendInput
): LocalHealthWeeklyTrendWindow {
  const weekEnd = addDays(weekStart, 6);
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const caloriesByDate = new Map<string, number>();
  for (const row of input.nutrition) {
    if (!isLive(row)) continue;
    if (row.date < weekStart || row.date > weekEnd) continue;
    caloriesByDate.set(row.date, (caloriesByDate.get(row.date) ?? 0) + row.calories);
  }

  const weightByDate = new Map<string, number>();
  const weekWeights = input.weight
    .filter((row) => isLive(row) && row.date >= weekStart && row.date <= weekEnd)
    // Ascending so, when a day has more than one reading, the LATEST logged one
    // wins the per-day slot below (last write in the loop) — `:991-993`.
    .sort((a, b) => ascending(a.created_at, b.created_at) || ascending(a.id, b.id));
  for (const row of weekWeights) weightByDate.set(row.date, row.weight);

  const days = weekDates.map((day) => {
    const goal = resolveGoalFor(input.goals, day);
    return {
      date: day,
      calories: Math.round(caloriesByDate.get(day) ?? 0),
      calorie_goal: goal ? caloriesGoalFor(goal, day) : null,
    };
  });
  const dailyWeight = weekDates.map((day) => ({
    date: day,
    weight: weightByDate.get(day) ?? null,
  }));

  const totalCalories = days.reduce((total, day) => total + day.calories, 0);
  return {
    week_start: weekStart,
    week_end: weekEnd,
    days,
    daily_weight: dailyWeight,
    total_calories: totalCalories,
    // Always /7, even for a partial week — a Monday-only week averages its one
    // day across seven. The server's contract, kept.
    avg_calories: Math.round(totalCalories / 7),
    avg_weight: averageOfLogged(dailyWeight.map((point) => point.weight)),
  };
}

/**
 * Weekly Calories-vs-Weight, this week against last (Dashboard "Weekly Trends").
 *
 * `last_week` is the 7 days immediately before `this_week` — a plain `-7` offset
 * of the same Monday, no gap and no overlap.
 */
export function computeWeeklyTrend(input: WeeklyTrendInput): LocalHealthWeeklyTrendResponse {
  if (!isValidDateKey(input.date)) {
    // Bail out to an honestly-empty week rather than crashing the whole
    // dashboard over one bad date (`:943-958`). Two distinct objects where the
    // server reuses one reference — JSON-identical, and not shared mutable state.
    return {
      this_week: emptyTrendWindow(input.date),
      last_week: emptyTrendWindow(input.date),
      change: { calories: 0, weight: null },
    };
  }

  const thisWeekStart = weekStartOf(input.date);
  const thisWeek = buildTrendWindow(thisWeekStart, input);
  const lastWeek = buildTrendWindow(addDays(thisWeekStart, -7), input);

  return {
    this_week: thisWeek,
    last_week: lastWeek,
    change: {
      // Difference of the two ALREADY-ROUNDED averages, so this is an integer.
      calories: thisWeek.avg_calories - lastWeek.avg_calories,
      weight:
        thisWeek.avg_weight !== null && lastWeek.avg_weight !== null
          ? round1(thisWeek.avg_weight - lastWeek.avg_weight)
          : null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* 6. dailySummary — health-service.ts:1975                            */
/* ------------------------------------------------------------------ */

export interface DailySummaryInput {
  date: string;
  nutrition: readonly LocalNutritionEntry[];
  water: readonly LocalWaterEntry[];
  weight: readonly LocalWeightEntry[];
  /** `health_entries` — steps/workout/sleep/HR/energy, discriminated by `entry_type`. */
  entries: readonly LocalHealthEntry[];
  goal: LocalHealthGoal | null;
}

/**
 * `health_entries.data` is a schemaless JSON TEXT blob.
 *
 * The server does a bare `JSON.parse(steps[0].data)` (`:1983`), so a single
 * malformed blob 500s the WHOLE `/health/summary` — nutrition, water and weight
 * included. Every writer stringifies (`createHealthEntry`, `:1201`), so it is
 * not reachable through the app today; on device it is not worth taking Home
 * down for, and the fallback is the same `0` the server produces for an absent
 * `steps` key.
 */
function readStepsValue(data: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return 0;
  }
  if (typeof parsed !== 'object' || parsed === null) return 0;
  const steps = (parsed as { steps?: unknown }).steps;
  return typeof steps === 'number' && Number.isFinite(steps) ? steps : 0;
}

/**
 * The donor's `/health/summary` — one call that fills the Home dashboard.
 *
 * `weight` is the most recent reading **on or before** `date`, not just that
 * day's: the server queries `{ to: date, limit: 2 }` and reads `[0]`, so a
 * member who has not weighed in today still sees their last number. Future-dated
 * readings are excluded.
 *
 * `steps` reads the ONE `steps` entry for the day. Two same-day `steps` rows are
 * a tie the server leaves to SQLite; here the most recently created row wins,
 * matching `weeklyTrend`'s stated rule for the same situation on weight.
 */
export function computeDailySummary(input: DailySummaryInput): HealthDailySummary {
  const nutrition = computeNutritionSummary({
    date: input.date,
    nutrition: input.nutrition,
    goal: input.goal,
  });
  const water = computeWaterSummary({ date: input.date, water: input.water, goal: input.goal });

  const weightRows = input.weight
    .filter((row) => isLive(row) && row.date <= input.date)
    .sort(compareWeightNewestFirst);
  const latestWeight = weightRows.length > 0 ? weightRows[0] : null;

  const stepRows = input.entries
    .filter((row) => isLive(row) && row.entry_type === 'steps' && row.date === input.date)
    .sort(
      (a, b) => descending(a.created_at, b.created_at) || descending(a.id, b.id)
    );

  return {
    date: input.date,
    nutrition,
    water,
    weight: latestWeight
      ? {
          value: latestWeight.weight,
          unit: asWeightUnit(latestWeight.unit),
          date: latestWeight.date,
        }
      : null,
    steps: {
      value: stepRows.length > 0 ? readStepsValue(stepRows[0].data) : 0,
      goal: input.goal?.daily_steps ?? null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* 7. Habit streaks — health-service.ts:1508 / :1679 / :2192           */
/* ------------------------------------------------------------------ */

/**
 * `listHabits` returns server-DERIVED `streak` and `days[]` on every habit, and
 * `toggleHabit`'s route re-runs the whole list so the ring updates. Those are
 * Wave A reads carrying derived fields, so they need the same treatment as the
 * six summaries.
 *
 * ⚠️ `HealthHabit.custom_days` is declared `string | null` (`api/health.ts:403`)
 * but the Worker sends `number[] | null` — `listHabits` parses the stored blob
 * before answering (`:1543`). The array is what this port returns, because that
 * is what the wire carries. See the port report for the consequence in
 * `healthHabitsStorage.fromWire`.
 */
export type HealthHabitWithStreak = Omit<HealthHabit, 'custom_days'> & {
  custom_days: number[] | null;
};

/**
 * Consecutive completed days ending today, or yesterday — a habit not yet ticked
 * TODAY still has a live streak until the day is over (`streakOf`, `:2192`).
 *
 * ⚠️ `today` is REQUIRED here. The server's default is
 * `new Date().toISOString().slice(0, 10)` — a **UTC** day key — while every
 * client day key is LOCAL (`healthLocalStorage.todayDateKey`). Pass the device's
 * local day; the maths below is otherwise identical to the server's.
 */
export function computeHabitStreak(days: readonly string[], today: string): number {
  const set = new Set(days);
  let cursor = set.has(today) ? today : addDays(today, -1);
  if (!set.has(cursor)) return 0;
  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export interface HabitListInput {
  habits: readonly LocalUserHabit[];
  logs: readonly LocalHabitLog[];
  /** The device's LOCAL day key — see `computeHabitStreak`. */
  today: string;
  /** Archiving is the only "deactivate" verb; archived habits stay reachable. */
  includeArchived?: boolean;
}

/**
 * Every habit the member owns, each with its completion days and streak.
 *
 * Streaks are derived from the completion DAYS, never a stored counter, so an
 * untick or a backfilled day recomputes correctly. `days` is newest-first.
 *
 * Ordering is `sort_order` ascending as on the Worker, with `id` breaking the
 * tie SQLite leaves open for two habits sharing a `sort_order` (which
 * `createHabit` can mint whenever a habit is deleted and another added).
 */
export function computeHabitList(input: HabitListInput): HealthHabitWithStreak[] {
  const liveLogs = input.logs.filter(isLive);
  const logsByHabit = new Map<string, string[]>();
  for (const log of liveLogs) {
    const habitId = log.habit_id;
    if (habitId === null || habitId === undefined) continue;
    const bucket = logsByHabit.get(habitId);
    if (bucket) bucket.push(log.date);
    else logsByHabit.set(habitId, [log.date]);
  }

  return input.habits
    .filter((habit) => isLive(habit) && (input.includeArchived === true || !habit.is_archived))
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || (a.id > b.id ? 1 : a.id < b.id ? -1 : 0))
    .map((habit) => {
      const days = (logsByHabit.get(habit.id) ?? []).slice().sort((a, b) => b.localeCompare(a));
      return {
        // D1 column order (`schema-health.ts:271-295`), then the two derived
        // fields — the same key order `{ ...h, custom_days, days, streak }`
        // produces on the Worker.
        id: habit.id,
        // A personal ledger has exactly one user (plan §1.2) and a locally
        // authored row may not carry the column at all.
        user_id: habit.user_id ?? '',
        template_id: habit.template_id ?? null,
        name: habit.name,
        icon: habit.icon,
        category: habit.category,
        // The Worker returns the stored strings verbatim; narrowing them would
        // rewrite a value the ledger legitimately holds.
        time_of_day: habit.time_of_day as HealthHabitTimeOfDay,
        frequency: habit.frequency as HealthHabitFrequency,
        custom_days: parseStoredCustomDays(habit.custom_days),
        reminder_time: habit.reminder_time ?? null,
        reminder_enabled: toBoolean(habit.reminder_enabled),
        target_duration: habit.target_duration ?? null,
        notes: habit.notes ?? null,
        is_archived: toBoolean(habit.is_archived),
        sort_order: habit.sort_order,
        created_at: habit.created_at,
        updated_at: habit.updated_at,
        days,
        streak: computeHabitStreak(days, input.today),
      };
    });
}

/**
 * What a habit tap should do — the pure half of `toggleHabit` (`:1679`).
 *
 * The id of a NEW log is deliberately not minted here: `habit_logs` is one of
 * the two deterministic-id tables and `ids.ts` owns
 * `healthDeterministicIds.habitLog(habitId, date)`. Keeping the decision pure
 * keeps this module free of the engine.
 */
export type HabitToggleOutcome =
  | { kind: 'not_found' }
  | { kind: 'untick'; done: false; logId: string; patch: { deleted_at: string; updated_at: string } }
  | {
      kind: 'restore';
      done: true;
      logId: string;
      patch: { deleted_at: null; completed_at: string; updated_at: string };
    }
  | { kind: 'create'; done: true; row: Omit<LocalHabitLog, 'id'> };

export interface HabitToggleInput {
  habits: readonly LocalUserHabit[];
  logs: readonly LocalHabitLog[];
  habitId: string;
  date: string;
  /** ISO stamp for `completed_at` / `updated_at` — injected, never `new Date()`. */
  now: string;
  userId?: string | null;
}

/**
 * Idempotent per (habit, day) — tapping twice unticks rather than stacking.
 *
 * The three branches mirror the Worker exactly: tombstone a live log, revive a
 * tombstoned one (re-stamping `completed_at`), or create the first one.
 *
 * ⚠️ The ownership lookup deliberately does NOT filter `deleted_at`, because the
 * Worker's does not (`:1680-1685`) — unlike its own `updateHabit` (`:1615`) and
 * `deleteHabit` (`:1660`), both of which do. A tombstoned habit therefore stays
 * tickable. Ported as-is so a flag-1 device and a flag-0 device answer the same;
 * flagged in the port report as a server inconsistency to fix on both sides at
 * once.
 */
export function resolveHabitToggle(input: HabitToggleInput): HabitToggleOutcome {
  const owned = input.habits.some((habit) => habit.id === input.habitId);
  if (!owned) return { kind: 'not_found' };

  const existing = input.logs.find(
    (log) => log.habit_id === input.habitId && log.date === input.date
  );

  if (existing && isLive(existing)) {
    return {
      kind: 'untick',
      done: false,
      logId: existing.id,
      patch: { deleted_at: input.now, updated_at: input.now },
    };
  }
  if (existing) {
    return {
      kind: 'restore',
      done: true,
      logId: existing.id,
      patch: { deleted_at: null, completed_at: input.now, updated_at: input.now },
    };
  }
  return {
    kind: 'create',
    done: true,
    row: {
      user_id: input.userId ?? null,
      habit_id: input.habitId,
      date: input.date,
      time_of_day: 'anytime',
      completed_at: input.now,
      duration: null,
      notes: null,
      created_at: input.now,
      updated_at: input.now,
      deleted_at: null,
    },
  };
}
