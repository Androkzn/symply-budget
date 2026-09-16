import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';

import {
  bodyMeasurements,
  cycleSettings,
  cycleSymptomEntries,
  habitLogs,
  healthEntries,
  healthGoals,
  healthWeeklyWeightAverages,
  mensHealthEntries,
  mensHealthSettings,
  nutritionEntries,
  periodEntries,
  userHabits,
  waterEntries,
  weightEntries,
} from '../db/schema-health';
import {
  activityNotificationPreferences,
  customFoods,
  fridgeItems,
  injuries,
  recipes,
  userFiles,
  widgetPreferences,
} from '../db/schema-health-p2';
import { healthReminderPreferences } from '../db/schema-health-reminders';
import { detectFoodCategory, loadCategoryMappings } from '../utils/food-category-detector';

// The per-100 maths lives in ONE place. Importing it keeps a diary row and the
// food library it came from deriving portions identically — a second copy here
// is exactly the drift `base_*_per_100` exists to prevent.
import { basisFrom, portionFrom, type MacroBasis } from './health-food-service';

/**
 * Symply Health domain service — the ported donor logic.
 *
 * THIN CLIENT: every derived figure (daily/weekly summaries, weight statistics,
 * cycle predictions, vitality scores, habit streaks) is computed HERE, not on
 * the device, so the phone, the widget and the watch can never disagree. The
 * routes only validate input and render what this returns.
 *
 * Delete is always SOFT (`deleted_at`): the delta-sync cursor pulls by
 * `updated_at`, so a hard delete would resurrect the row on the next pull from
 * another device.
 */

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type HealthEntryType = 'steps' | 'workout' | 'sleep' | 'heart_rate' | 'active_energy';

/**
 * How hard a logged session felt (0124). NOT a donor vocabulary — see the
 * migration header for why neither `exercise_library.difficulty` (grades a
 * movement) nor `mens_health_entries.workout_intensity` (a 1–10 vitality
 * self-report) is the same thing.
 */
export const WORKOUT_INTENSITIES = ['easy', 'steady', 'hard', 'max'] as const;
export type WorkoutIntensity = (typeof WORKOUT_INTENSITIES)[number];

/** The four macro columns a nutrition row carries. */
export interface NutritionMacros {
  calories: number;
  proteins: number;
  carbohydrates: number;
  fats: number;
}

/** Why a re-portion could not be applied — the route maps these to a status. */
export type ReportionFailure = 'not_found' | 'no_basis';

export type ReportionResult =
  | { ok: true; entry: typeof nutritionEntries.$inferSelect }
  | { ok: false; reason: ReportionFailure };

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

/** UTC day key for an ISO stamp — the client always sends its own local date. */
export function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/** Monday-based week start for a YYYY-MM-DD key (donor convention). */
export function weekStartOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun
  const delta = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  const start = new Date(`${a}T00:00:00Z`).getTime();
  const end = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}

/** The donor's `HabitFrequency` cases (`HabitModels.swift`), stored verbatim. */
export const HABIT_FREQUENCIES = [
  'daily',
  'twice_daily',
  'weekdays',
  'weekends',
  'custom',
] as const;
export type HabitFrequency = (typeof HABIT_FREQUENCIES)[number];

/** The donor's `HabitTimeOfDay` cases — a filter, not a schedule. */
export const HABIT_TIMES_OF_DAY = ['morning', 'afternoon', 'evening', 'anytime'] as const;
export type HabitTimeOfDay = (typeof HABIT_TIMES_OF_DAY)[number];

/** Columns a habit create/update may set. Absent = leave alone, null = clear. */
export interface HabitWriteInput {
  name?: string;
  icon?: string;
  category?: string;
  template_id?: string | null;
  time_of_day?: HabitTimeOfDay;
  frequency?: HabitFrequency;
  /** Apple `Calendar` weekday numbers, 1 = Sunday … 7 = Saturday. */
  custom_days?: number[] | null;
  /** Local wall-clock 'HH:MM'; the reminder scheduler resolves the member's zone. */
  reminder_time?: string | null;
  reminder_enabled?: boolean;
  target_duration?: number | null;
  notes?: string | null;
  is_archived?: boolean;
  sort_order?: number;
}

/**
 * Normalise a custom-day set for storage: deduped, sorted, 1–7 only.
 *
 * An empty result is stored as NULL rather than `[]` so "custom with no days"
 * reads back as "unset" and the scheduler's every-day fallback applies, instead
 * of silently muting a habit the member thought they had scheduled.
 */
function serializeCustomDays(days: number[] | null | undefined): string | null {
  if (!days) return null;
  const clean = [...new Set(days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort(
    (a, b) => a - b
  );
  return clean.length > 0 ? JSON.stringify(clean) : null;
}

/** Read a stored `custom_days` blob back; a corrupt value reads as null. */
function parseStoredCustomDays(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const days = parsed.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
    return days.length > 0 ? days : null;
  } catch {
    return null;
  }
}

export class HealthService {
  private db: DrizzleD1Database;
  /** Kept alongside the drizzle handle — `food-category-detector` takes a raw D1Database. */
  private rawDb: D1Database;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
    this.rawDb = d1;
  }

  /**
   * Detect a logged food's category against `food_category_mappings`
   * (migration `0136_food_challenges.sql`). Fails OPEN (returns null) rather
   * than throwing when the table does not exist yet — an unmigrated
   * environment, or an older test fixture built from `createHealthTables`
   * alone — so a nutrition write is never blocked on a challenges-only table.
   */
  private async detectNutritionCategory(foodName: string): Promise<string | null> {
    try {
      const mappings = await loadCategoryMappings(this.rawDb);
      return detectFoodCategory(foodName, mappings);
    } catch {
      return null;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Weight                                                            */
  /* ---------------------------------------------------------------- */

  async listWeight(userId: string, opts: { from?: string; to?: string; limit?: number } = {}) {
    const conds = [eq(weightEntries.user_id, userId), isNull(weightEntries.deleted_at)];
    if (opts.from) conds.push(gte(weightEntries.date, opts.from));
    if (opts.to) conds.push(lte(weightEntries.date, opts.to));
    return this.db
      .select()
      .from(weightEntries)
      .where(and(...conds))
      .orderBy(desc(weightEntries.date))
      .limit(opts.limit ?? 200)
      .all();
  }

  async createWeight(
    userId: string,
    input: {
      date: string;
      weight: number;
      unit: string;
      note?: string;
      source?: 'manual' | 'healthkit';
    }
  ) {
    const ts = nowIso();
    const row = {
      id: newId('w'),
      user_id: userId,
      date: input.date,
      weight: input.weight,
      unit: input.unit,
      note: input.note ?? null,
      // Defaults to 'manual': anything without an explicit origin was typed in.
      source: input.source ?? 'manual',
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.db.insert(weightEntries).values(row).run();
    await this.recomputeWeeklyAverage(userId, input.date, input.unit);
    return row;
  }

  /**
   * Edit a reading.
   *
   * A TOMBSTONED row is treated as absent — the rule `reportionNutrition` and
   * `readOwnedEntry` already state, applied here too. Without it the three cases
   * a probe must not be able to tell apart (unknown id / someone else's id /
   * deleted id) answered differently: a deleted entry of the caller's own
   * answered 200 with a body, and every other miss answered 404. Worse for the
   * member, the edit REPORTED SUCCESS on a row that had already left every list,
   * and re-stamped `updated_at` on a dead row so the delta pull shipped a
   * tombstone whose figures had changed — which reads on a second device as a
   * value moving on an entry that is gone.
   */
  async updateWeight(
    userId: string,
    id: string,
    patch: {
      weight?: number;
      unit?: string;
      note?: string | null;
      date?: string;
      source?: string;
    }
  ) {
    const existing = await this.db
      .select()
      .from(weightEntries)
      .where(
        and(
          eq(weightEntries.id, id),
          eq(weightEntries.user_id, userId),
          isNull(weightEntries.deleted_at)
        )
      )
      .get();
    if (!existing) return null;
    const next = { ...existing, ...patch, updated_at: nowIso() };
    await this.db.update(weightEntries).set(next).where(eq(weightEntries.id, id)).run();

    // Re-dating an entry can move it BETWEEN weeks, so both the week it left and
    // the week it joined have to be recomputed. Recomputing only the new week
    // would leave the old one still counting a weight that is no longer in it
    // (an emptied week could keep reporting entry_count: 1).
    const weeks = new Set([weekStartOf(existing.date), weekStartOf(next.date)]);
    for (const week of weeks) {
      await this.recomputeWeeklyAverage(userId, week, next.unit);
    }
    return next;
  }

  async deleteWeight(userId: string, id: string) {
    const existing = await this.db
      .select()
      .from(weightEntries)
      .where(
        and(
          eq(weightEntries.id, id),
          eq(weightEntries.user_id, userId),
          isNull(weightEntries.deleted_at)
        )
      )
      .get();
    if (!existing) return false;
    const ts = nowIso();
    await this.db
      .update(weightEntries)
      .set({ deleted_at: ts, updated_at: ts })
      .where(eq(weightEntries.id, id))
      .run();
    await this.recomputeWeeklyAverage(userId, existing.date, existing.unit);
    return true;
  }

  /**
   * Donor's weekly rollup (migration 010). Recomputed on every write so a
   * single-device user never reads a stale week; the UNIQUE(user, week_start)
   * makes it an upsert.
   */
  private async recomputeWeeklyAverage(userId: string, date: string, unit: string) {
    const start = weekStartOf(date);
    const end = addDays(start, 6);
    const rows = await this.db
      .select()
      .from(weightEntries)
      .where(
        and(
          eq(weightEntries.user_id, userId),
          isNull(weightEntries.deleted_at),
          gte(weightEntries.date, start),
          lte(weightEntries.date, end)
        )
      )
      .all();

    if (rows.length === 0) {
      await this.db
        .delete(healthWeeklyWeightAverages)
        .where(
          and(
            eq(healthWeeklyWeightAverages.user_id, userId),
            eq(healthWeeklyWeightAverages.week_start, start)
          )
        )
        .run();
      return;
    }

    const values = rows.map((r) => r.weight);
    const ts = nowIso();
    await this.db
      .insert(healthWeeklyWeightAverages)
      .values({
        id: newId('wk'),
        user_id: userId,
        week_start: start,
        week_end: end,
        average_weight: values.reduce((s, v) => s + v, 0) / values.length,
        min_weight: Math.min(...values),
        max_weight: Math.max(...values),
        entry_count: values.length,
        weight_unit: unit,
        created_at: ts,
        updated_at: ts,
      })
      .onConflictDoUpdate({
        target: [healthWeeklyWeightAverages.user_id, healthWeeklyWeightAverages.week_start],
        set: {
          average_weight: values.reduce((s, v) => s + v, 0) / values.length,
          min_weight: Math.min(...values),
          max_weight: Math.max(...values),
          entry_count: values.length,
          weight_unit: unit,
          updated_at: ts,
        },
      })
      .run();
  }

  async weeklyAverages(userId: string, limit = 26) {
    return this.db
      .select()
      .from(healthWeeklyWeightAverages)
      .where(eq(healthWeeklyWeightAverages.user_id, userId))
      .orderBy(desc(healthWeeklyWeightAverages.week_start))
      .limit(limit)
      .all();
  }

  /**
   * Donor's `/weight/statistics`. Only entries sharing the LATEST unit are
   * compared — mixing kg and lb would report a change that never happened.
   */
  async weightStatistics(userId: string, from?: string) {
    const rows = await this.listWeight(userId, { from, limit: 1000 });
    if (rows.length === 0) {
      return { count: 0, unit: null, latest: null, first: null, change: null, average: null, min: null, max: null };
    }
    const unit = rows[0].unit;
    const same = rows.filter((r) => r.unit === unit);
    const values = same.map((r) => r.weight);
    const latest = same[0];
    const first = same[same.length - 1];
    return {
      count: same.length,
      unit,
      latest: latest.weight,
      first: first.weight,
      change: Math.round((latest.weight - first.weight) * 10) / 10,
      average: Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10,
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Water                                                             */
  /* ---------------------------------------------------------------- */

  async listWater(userId: string, opts: { from?: string; to?: string } = {}) {
    const conds = [eq(waterEntries.user_id, userId), isNull(waterEntries.deleted_at)];
    if (opts.from) conds.push(gte(waterEntries.date, opts.from));
    if (opts.to) conds.push(lte(waterEntries.date, opts.to));
    return this.db
      .select()
      .from(waterEntries)
      .where(and(...conds))
      .orderBy(desc(waterEntries.date))
      .all();
  }

  async createWater(
    userId: string,
    input: { date: string; amount_ml: number; beverage_type?: string; container?: string }
  ) {
    const ts = nowIso();
    const row = {
      id: newId('h2o'),
      user_id: userId,
      date: input.date,
      amount_ml: input.amount_ml,
      beverage_type: input.beverage_type ?? 'water',
      container: input.container ?? null,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.db.insert(waterEntries).values(row).run();
    return row;
  }

  async deleteWater(userId: string, id: string) {
    const ts = nowIso();
    const res = await this.db
      .update(waterEntries)
      .set({ deleted_at: ts, updated_at: ts })
      .where(
        and(
          eq(waterEntries.id, id),
          eq(waterEntries.user_id, userId),
          isNull(waterEntries.deleted_at)
        )
      )
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  /**
   * Undo the most recent sip of a day. The RN water counter is ±1 cup, so the
   * minus button needs a "remove last" rather than an id it never held.
   */
  async removeLastWater(userId: string, date: string) {
    const last = await this.db
      .select()
      .from(waterEntries)
      .where(
        and(
          eq(waterEntries.user_id, userId),
          eq(waterEntries.date, date),
          isNull(waterEntries.deleted_at)
        )
      )
      .orderBy(desc(waterEntries.created_at))
      .limit(1)
      .get();
    if (!last) return false;
    return this.deleteWater(userId, last.id);
  }

  async waterDailySummary(userId: string, date: string) {
    const rows = await this.db
      .select()
      .from(waterEntries)
      .where(
        and(
          eq(waterEntries.user_id, userId),
          eq(waterEntries.date, date),
          isNull(waterEntries.deleted_at)
        )
      )
      .all();
    const goal = await this.goalFor(userId, date);
    const total = rows.reduce((s, r) => s + r.amount_ml, 0);
    return {
      date,
      total_ml: total,
      goal_ml: goal?.daily_water_ml ?? null,
      entry_count: rows.length,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Nutrition                                                         */
  /* ---------------------------------------------------------------- */

  async listNutrition(userId: string, opts: { from?: string; to?: string; date?: string } = {}) {
    const conds = [eq(nutritionEntries.user_id, userId), isNull(nutritionEntries.deleted_at)];
    if (opts.date) conds.push(eq(nutritionEntries.date, opts.date));
    if (opts.from) conds.push(gte(nutritionEntries.date, opts.from));
    if (opts.to) conds.push(lte(nutritionEntries.date, opts.to));
    return this.db
      .select()
      .from(nutritionEntries)
      .where(and(...conds))
      .orderBy(nutritionEntries.created_at)
      .all();
  }

  /**
   * The per-100 basis to store on a new diary row, or null when there is none.
   *
   * Three sources, in priority order:
   *  1. an explicit basis on the request (the food library already knows it);
   *  2. the `custom_foods` row named by `food_id` — user-scoped, so a caller
   *     cannot borrow someone else's food to seed a basis. `undefined` means the
   *     food was not found and the caller must refuse the whole write, which is
   *     different from `null` ("no basis to store, carry on");
   *  3. derived from the macros the caller sent FOR the portion they sent, via
   *     the same `basisFrom` the food library uses. This is what makes a
   *     hand-typed entry re-portionable at all, and it is exact rather than a
   *     guess: `portionFrom(basisFrom(x, p), p) === x`, so re-applying the
   *     original portion is a no-op.
   */
  private async resolveNutritionBasis(
    userId: string,
    input: {
      calories: number;
      proteins?: number;
      carbohydrates?: number;
      fats?: number;
      portion?: number;
      food_id?: string;
      base_calories_per_100?: number;
      base_proteins_per_100?: number;
      base_carbs_per_100?: number;
      base_fats_per_100?: number;
    }
  ): Promise<MacroBasis | null | undefined> {
    if (input.base_calories_per_100 !== undefined) {
      return {
        base_calories_per_100: input.base_calories_per_100,
        base_proteins_per_100: input.base_proteins_per_100 ?? 0,
        base_carbs_per_100: input.base_carbs_per_100 ?? 0,
        base_fats_per_100: input.base_fats_per_100 ?? 0,
      };
    }

    if (input.food_id) {
      const food = await this.db
        .select()
        .from(customFoods)
        .where(and(eq(customFoods.id, input.food_id), eq(customFoods.user_id, userId)))
        .get();
      // Unknown id, or one owned by somebody else — both answer the same way, so
      // a probe cannot tell "does not exist" from "is not yours".
      if (!food) return undefined;
      return {
        base_calories_per_100: food.base_calories_per_100,
        base_proteins_per_100: food.base_proteins_per_100,
        base_carbs_per_100: food.base_carbs_per_100,
        base_fats_per_100: food.base_fats_per_100,
      };
    }

    const portion = input.portion ?? 1;
    if (portion <= 0) return null;
    return basisFrom(
      {
        calories: input.calories,
        proteins: input.proteins ?? 0,
        carbohydrates: input.carbohydrates ?? 0,
        fats: input.fats ?? 0,
      },
      portion
    );
  }

  /**
   * Create a diary row.
   *
   * Returns null when `food_id` names a food the caller does not own — the row
   * is NOT written, because storing a dangling pointer would make the resulting
   * entry claim a provenance it does not have.
   */
  async createNutrition(
    userId: string,
    input: {
      date: string;
      food_name: string;
      meal_type: MealType;
      calories: number;
      proteins?: number;
      carbohydrates?: number;
      fats?: number;
      portion?: number;
      unit?: string;
      food_id?: string;
      base_calories_per_100?: number;
      base_proteins_per_100?: number;
      base_carbs_per_100?: number;
      base_fats_per_100?: number;
      /** 0143. Absent ⇒ 'manual' — the HealthKit dietary importer sets 'healthkit'. */
      source?: 'manual' | 'healthkit';
    }
  ) {
    const basis = await this.resolveNutritionBasis(userId, input);
    if (basis === undefined) return null;

    // Donor `nutrition.ts:150-181`: category is detected AT WRITE TIME and
    // stored, so challenge progress never re-runs detection on read. See
    // migration 0136 DEVIATIONS for why `is_processed` is derived from the
    // detection result here rather than from a client-supplied flag: a
    // recognised single ingredient counts as "raw" (full portion may credit a
    // category challenge); an unrecognised or composite name stays
    // conservatively `processed` (excluded), matching the donor's own default.
    const detectedCategory = await this.detectNutritionCategory(input.food_name);

    const ts = nowIso();
    const row = {
      id: newId('n'),
      user_id: userId,
      date: input.date,
      food_name: input.food_name,
      portion: input.portion ?? 1,
      unit: input.unit ?? 'serving',
      meal_type: input.meal_type,
      calories: input.calories,
      proteins: input.proteins ?? 0,
      carbohydrates: input.carbohydrates ?? 0,
      fats: input.fats ?? 0,
      food_id: input.food_id ?? null,
      base_calories_per_100: basis?.base_calories_per_100 ?? null,
      base_proteins_per_100: basis?.base_proteins_per_100 ?? null,
      base_carbs_per_100: basis?.base_carbs_per_100 ?? null,
      base_fats_per_100: basis?.base_fats_per_100 ?? null,
      detected_category: detectedCategory,
      is_processed: detectedCategory === null,
      source_recipe_id: null,
      source: input.source ?? 'manual',
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.db.insert(nutritionEntries).values(row).run();
    return row;
  }

  /**
   * Create several diary entries in one call.
   *
   * The donor shipped four copy sheets (copy a food, a meal, a meal into
   * another meal, a whole day from another date). With one row per request,
   * copying a 12-item day is 12 round trips — slow, and partially applied if
   * the network drops halfway. Returns every created row so the client can
   * render the result without a refetch.
   */
  async createNutritionBulk(
    userId: string,
    inputs: Array<{
      date: string;
      food_name: string;
      meal_type: MealType;
      calories: number;
      proteins?: number;
      carbohydrates?: number;
      fats?: number;
      portion?: number;
      unit?: string;
      food_id?: string;
      base_calories_per_100?: number;
      base_proteins_per_100?: number;
      base_carbs_per_100?: number;
      base_fats_per_100?: number;
    }>
  ) {
    const created = [];
    for (const input of inputs) {
      const row = await this.createNutrition(userId, input);
      // A row naming a food the caller does not own is SKIPPED, not fatal: the
      // copy sheets this backs would otherwise lose eleven good rows because the
      // twelfth pointed at a food that had been hard-deleted.
      if (row) created.push(row);
    }
    return created;
  }

  /**
   * Copy every entry from one day into another.
   *
   * `toSlot` optionally re-files them all into a single slot (the donor's
   * "copy lunch into dinner"). Source rows are read through the normal reader,
   * so tombstoned entries are never copied forward.
   */
  async copyNutritionDay(
    userId: string,
    fromDate: string,
    toDate: string,
    opts: { fromSlot?: MealType; toSlot?: MealType } = {}
  ) {
    const source = await this.listNutrition(userId, { date: fromDate });
    const filtered = opts.fromSlot
      ? source.filter((e) => e.meal_type === opts.fromSlot)
      : source;
    return this.createNutritionBulk(
      userId,
      filtered.map((e) => ({
        date: toDate,
        food_name: e.food_name,
        meal_type: (opts.toSlot ?? e.meal_type) as MealType,
        calories: e.calories,
        proteins: e.proteins,
        carbohydrates: e.carbohydrates,
        fats: e.fats,
        portion: e.portion,
        unit: e.unit,
        // Provenance and basis travel WITH the copy: yesterday's 150 g of rice
        // must still be re-portionable after being copied onto today, and the
        // copy must still name the food it came from.
        ...(e.food_id ? { food_id: e.food_id } : {}),
        ...(e.base_calories_per_100 !== null
          ? {
              base_calories_per_100: e.base_calories_per_100,
              base_proteins_per_100: e.base_proteins_per_100 ?? 0,
              base_carbs_per_100: e.base_carbs_per_100 ?? 0,
              base_fats_per_100: e.base_fats_per_100 ?? 0,
            }
          : {}),
      }))
    );
  }

  /**
   * Edit a diary row.
   *
   * RE-DERIVES `base_*_per_100` whenever the macros or the portion change.
   * Without that the row kept the basis it was created with while showing the
   * corrected figures, so `canReportion` stayed true against a basis the member
   * had just corrected away — and the next portion change silently re-derived
   * from the OLD numbers, undoing the correction. The basis is not metadata; it
   * is the statement "this food is X per 100", and editing the macros changes it.
   *
   * Only rows that HAVE a basis are re-derived. A row logged before 0124, or one
   * typed free-hand, has none, and inventing one would make it look
   * re-portionable when the app has no idea what a portion of it weighs.
   *
   * A TOMBSTONED row is absent here for the same reason it is in
   * `reportionNutrition`: an edit that lands on one bumps `updated_at` and
   * re-delivers a deleted row through the delta pull with different macros.
   */
  async updateNutrition(userId: string, id: string, patch: Record<string, unknown>) {
    const existing = await this.db
      .select()
      .from(nutritionEntries)
      .where(
        and(
          eq(nutritionEntries.id, id),
          eq(nutritionEntries.user_id, userId),
          isNull(nutritionEntries.deleted_at)
        )
      )
      .get();
    if (!existing) return null;

    const merged = { ...existing, ...patch };
    const touchesMacros =
      'calories' in patch ||
      'proteins' in patch ||
      'carbohydrates' in patch ||
      'fats' in patch ||
      'portion' in patch;
    const rederived =
      touchesMacros && existing.base_calories_per_100 !== null && (merged.portion ?? 0) > 0
        ? basisFrom(
            {
              calories: merged.calories ?? 0,
              proteins: merged.proteins ?? 0,
              carbohydrates: merged.carbohydrates ?? 0,
              fats: merged.fats ?? 0,
            },
            merged.portion as number
          )
        : null;

    const next = { ...merged, ...(rederived ?? {}), updated_at: nowIso() };
    await this.db.update(nutritionEntries).set(next).where(eq(nutritionEntries.id, id)).run();
    return next;
  }

  /**
   * Re-derive a diary row's macros for a NEW portion — the write that
   * `base_*_per_100` exists for.
   *
   * Always derives from the stored basis, never from the row's current macros:
   * scaling `calories / oldPortion * newPortion` compounds its rounding error on
   * every re-portioning, and after three edits the number on screen is one the
   * user never ate.
   *
   * A tombstoned row is treated as absent. Letting an edit land on it would bump
   * `updated_at` and re-deliver a deleted row through the delta pull, which
   * looks to a second device like a value changing on an entry that is gone.
   */
  async reportionNutrition(
    userId: string,
    id: string,
    portion: number,
    unit?: string
  ): Promise<ReportionResult> {
    const existing = await this.db
      .select()
      .from(nutritionEntries)
      .where(
        and(
          eq(nutritionEntries.id, id),
          eq(nutritionEntries.user_id, userId),
          isNull(nutritionEntries.deleted_at)
        )
      )
      .get();
    // Unknown id and someone else's id answer identically — see toggleHabit.
    if (!existing) return { ok: false, reason: 'not_found' };
    if (existing.base_calories_per_100 === null) return { ok: false, reason: 'no_basis' };

    const derived = portionFrom(
      {
        base_calories_per_100: existing.base_calories_per_100,
        base_proteins_per_100: existing.base_proteins_per_100 ?? 0,
        base_carbs_per_100: existing.base_carbs_per_100 ?? 0,
        base_fats_per_100: existing.base_fats_per_100 ?? 0,
      },
      portion
    );
    const next = {
      ...existing,
      portion,
      unit: unit ?? existing.unit,
      calories: derived.calories,
      proteins: derived.proteins,
      carbohydrates: derived.carbohydrates,
      fats: derived.fats,
      updated_at: nowIso(),
    };
    await this.db.update(nutritionEntries).set(next).where(eq(nutritionEntries.id, id)).run();
    return { ok: true, entry: next };
  }

  async deleteNutrition(userId: string, id: string) {
    const ts = nowIso();
    const res = await this.db
      .update(nutritionEntries)
      .set({ deleted_at: ts, updated_at: ts })
      .where(
        and(
          eq(nutritionEntries.id, id),
          eq(nutritionEntries.user_id, userId),
          isNull(nutritionEntries.deleted_at)
        )
      )
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  /** Per-slot + day totals against the goal in force on that date. */
  async nutritionSummary(userId: string, date: string) {
    const rows = await this.listNutrition(userId, { date });
    const goal = await this.goalFor(userId, date);
    const zero = { calories: 0, proteins: 0, carbohydrates: 0, fats: 0 };
    const byMeal: Record<MealType, typeof zero> = {
      breakfast: { ...zero },
      lunch: { ...zero },
      dinner: { ...zero },
      snack: { ...zero },
    };
    const totals = { ...zero };
    for (const r of rows) {
      const slot = byMeal[r.meal_type as MealType] ?? byMeal.snack;
      slot.calories += r.calories;
      slot.proteins += r.proteins;
      slot.carbohydrates += r.carbohydrates;
      slot.fats += r.fats;
      totals.calories += r.calories;
      totals.proteins += r.proteins;
      totals.carbohydrates += r.carbohydrates;
      totals.fats += r.fats;
    }
    return {
      date,
      totals,
      by_meal: byMeal,
      entry_count: rows.length,
      goal: goal
        ? {
            calories: this.caloriesGoalFor(goal, date),
            ...this.macrosGoalFor(goal, date),
          }
        : null,
    };
  }

  /**
   * Server-computed weekly Calories-vs-Weight trend for the Dashboard tab.
   *
   * No donor server equivalent — the donor builds this on-device from raw
   * entry pulls. Kept here instead, per this file's own "thin client"
   * principle: per-day arrays are computed once, server-side, so the phone
   * and the widget can never disagree.
   *
   * `date` names any day in "this week"; the Monday-start-of-week math is the
   * same convention `weekStartOf` already uses for `recomputeWeeklyAverage`.
   * `last_week` is the 7 days immediately before `this_week` (no gap, no
   * overlap) — a plain `-7` offset of the same Monday.
   */
  async weeklyTrend(userId: string, date: string) {
    // The route's own validator only checks the YYYY-MM-DD SHAPE (see
    // `dateSchema` in health.ts / health-assets.ts), so a calendar-impossible
    // value like "2026-13-45" reaches here as a live possibility, not just a
    // theoretical one — `widgetSnapshot()` calls this with the SAME
    // shape-only-validated date. `new Date(...)` turns that into an Invalid
    // Date, and `weekStartOf`/`addDays` would throw on its `.toISOString()`
    // rather than degrade — so bail out to an honestly-empty week instead of
    // crashing the whole snapshot over one bad query param.
    if (Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
      const emptyWeek = {
        week_start: date,
        week_end: date,
        days: [] as Array<{ date: string; calories: number; calorie_goal: number | null }>,
        daily_weight: [] as Array<{ date: string; weight: number | null }>,
        total_calories: 0,
        avg_calories: 0,
        avg_weight: null as number | null,
      };
      return {
        this_week: emptyWeek,
        last_week: emptyWeek,
        change: { calories: 0, weight: null },
      };
    }

    const thisWeekStart = weekStartOf(date);
    const lastWeekStart = addDays(thisWeekStart, -7);

    const buildWeek = async (weekStart: string) => {
      const weekEnd = addDays(weekStart, 6);
      const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

      const [nutritionRows, weightRows, goals] = await Promise.all([
        this.db
          .select()
          .from(nutritionEntries)
          .where(
            and(
              eq(nutritionEntries.user_id, userId),
              isNull(nutritionEntries.deleted_at),
              gte(nutritionEntries.date, weekStart),
              lte(nutritionEntries.date, weekEnd)
            )
          )
          .all(),
        this.db
          .select()
          .from(weightEntries)
          .where(
            and(
              eq(weightEntries.user_id, userId),
              isNull(weightEntries.deleted_at),
              gte(weightEntries.date, weekStart),
              lte(weightEntries.date, weekEnd)
            )
          )
          // Ascending so, when a day has more than one reading, the LATEST
          // logged one wins the per-day slot below (last write in the loop).
          .orderBy(weightEntries.created_at)
          .all(),
        Promise.all(weekDates.map((d) => this.goalFor(userId, d))),
      ]);

      const caloriesByDate = new Map<string, number>();
      for (const r of nutritionRows) {
        caloriesByDate.set(r.date, (caloriesByDate.get(r.date) ?? 0) + r.calories);
      }
      const weightByDate = new Map<string, number>();
      for (const r of weightRows) weightByDate.set(r.date, r.weight);

      const days = weekDates.map((d, i) => {
        const goal = goals[i];
        return {
          date: d,
          calories: Math.round(caloriesByDate.get(d) ?? 0),
          calorie_goal: goal ? this.caloriesGoalFor(goal, d) : null,
        };
      });
      const dailyWeight = weekDates.map((d) => ({ date: d, weight: weightByDate.get(d) ?? null }));

      const totalCalories = days.reduce((s, d) => s + d.calories, 0);
      return {
        week_start: weekStart,
        week_end: weekEnd,
        days,
        daily_weight: dailyWeight,
        total_calories: totalCalories,
        avg_calories: Math.round(totalCalories / 7),
      };
    };

    const [thisWeek, lastWeek] = await Promise.all([
      buildWeek(thisWeekStart),
      buildWeek(lastWeekStart),
    ]);

    // Weight is not logged daily, so the CHANGE figure averages only the days
    // that actually have a reading in each week — zero-filling a missing day
    // to 0 kg would swing the average toward whichever week has fewer entries.
    const avgOfLogged = (values: Array<number | null>): number | null => {
      const nums = values.filter((v): v is number => v !== null);
      if (nums.length === 0) return null;
      return nums.reduce((s, v) => s + v, 0) / nums.length;
    };
    const thisWeekAvgWeight = avgOfLogged(thisWeek.daily_weight.map((d) => d.weight));
    const lastWeekAvgWeight = avgOfLogged(lastWeek.daily_weight.map((d) => d.weight));

    return {
      // `avg_weight` rides along on each week so a caller (the widget snapshot)
      // can read "this week's average" / "last week's average" without
      // redoing the same logged-days-only average this method already computed.
      this_week: { ...thisWeek, avg_weight: thisWeekAvgWeight },
      last_week: { ...lastWeek, avg_weight: lastWeekAvgWeight },
      change: {
        calories: thisWeek.avg_calories - lastWeek.avg_calories,
        weight:
          thisWeekAvgWeight !== null && lastWeekAvgWeight !== null
            ? Math.round((thisWeekAvgWeight - lastWeekAvgWeight) * 10) / 10
            : null,
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /* Body measurements                                                 */
  /* ---------------------------------------------------------------- */

  /**
   * `limit` is generous because the client fans ONE row out into one reading per
   * populated site: with 0131's forty-one sites a single fully-taped session is
   * one row but forty-one points on the Body tab's charts, and the tab's "All"
   * range is meant to reach the member's first ever measurement. 200 rows was
   * roughly ten months of weekly sessions before 0131 and is unchanged in
   * meaning after it — rows, not sites — but the ceiling is raised so a member
   * who logs several times a week still sees their own history.
   */
  async listMeasurements(userId: string, limit = 1000) {
    return this.db
      .select()
      .from(bodyMeasurements)
      .where(and(eq(bodyMeasurements.user_id, userId), isNull(bodyMeasurements.deleted_at)))
      .orderBy(desc(bodyMeasurements.date))
      .limit(limit)
      .all();
  }

  async latestMeasurement(userId: string) {
    return (
      (await this.db
        .select()
        .from(bodyMeasurements)
        .where(and(eq(bodyMeasurements.user_id, userId), isNull(bodyMeasurements.deleted_at)))
        .orderBy(desc(bodyMeasurements.date))
        .limit(1)
        .get()) ?? null
    );
  }

  async createMeasurement(userId: string, input: Record<string, unknown> & { date: string; unit: string }) {
    const ts = nowIso();
    const row = {
      id: newId('bm'),
      user_id: userId,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
      ...input,
    };
    await this.db.insert(bodyMeasurements).values(row as never).run();
    return row;
  }

  /**
   * Patch sites on one row (0131). `null` clears a site, an omitted key keeps it.
   *
   * The route has already stripped every key that is not a known site, so the
   * `undefined` filter below is what separates "clear this" (`null`, kept) from
   * "did not mention it" (`undefined`, dropped) — assigning the whole validated
   * object would write `undefined` over stored values as SQL NULL.
   *
   * Returns `null` when the row is not the caller's or is already tombstoned,
   * which the route turns into a 404 rather than a silent no-op.
   */
  async updateMeasurement(userId: string, id: string, patch: Record<string, unknown>) {
    const set: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) set[key] = value;
    }
    // Nothing to change is not an error — the caller still gets the row back.
    set.updated_at = nowIso();

    const res = await this.db
      .update(bodyMeasurements)
      .set(set as never)
      .where(
        and(
          eq(bodyMeasurements.id, id),
          eq(bodyMeasurements.user_id, userId),
          isNull(bodyMeasurements.deleted_at)
        )
      )
      .run();
    if ((res.meta?.changes ?? 0) === 0) return null;

    return (
      (await this.db
        .select()
        .from(bodyMeasurements)
        .where(and(eq(bodyMeasurements.id, id), eq(bodyMeasurements.user_id, userId)))
        .get()) ?? null
    );
  }

  async deleteMeasurement(userId: string, id: string) {
    const ts = nowIso();
    const res = await this.db
      .update(bodyMeasurements)
      .set({ deleted_at: ts, updated_at: ts })
      .where(
        and(
          eq(bodyMeasurements.id, id),
          eq(bodyMeasurements.user_id, userId),
          isNull(bodyMeasurements.deleted_at)
        )
      )
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  /* ---------------------------------------------------------------- */
  /* Generic health entries (steps / workouts / sleep / HR / energy)    */
  /* ---------------------------------------------------------------- */

  async listHealthEntries(
    userId: string,
    opts: { type?: HealthEntryType; from?: string; to?: string; limit?: number } = {}
  ) {
    const conds = [eq(healthEntries.user_id, userId), isNull(healthEntries.deleted_at)];
    if (opts.type) conds.push(eq(healthEntries.entry_type, opts.type));
    if (opts.from) conds.push(gte(healthEntries.date, opts.from));
    if (opts.to) conds.push(lte(healthEntries.date, opts.to));
    return this.db
      .select()
      .from(healthEntries)
      .where(and(...conds))
      .orderBy(desc(healthEntries.date))
      .limit(opts.limit ?? 400)
      .all();
  }

  async createHealthEntry(
    userId: string,
    input: {
      date: string;
      entry_type: HealthEntryType;
      data: unknown;
      source?: 'healthkit' | 'manual';
      intensity?: WorkoutIntensity | null;
    }
  ) {
    const ts = nowIso();
    const row = {
      id: newId('he'),
      user_id: userId,
      date: input.date,
      entry_type: input.entry_type,
      data: JSON.stringify(input.data ?? {}),
      source: input.source ?? 'manual',
      // NULL = not recorded. The client sends this only when the user moved off
      // the picker's default, so a plain "log a walk" still writes nothing here.
      intensity: input.intensity ?? null,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.db.insert(healthEntries).values(row).run();
    return row;
  }

  /**
   * Update an entry in place (0124) — the donor's `PUT /entries/:id`, which P1
   * did not port.
   *
   * Before this existed, "edit a session" had to RE-RECORD: write the
   * replacement, then tombstone the original. That ordering was deliberate (a
   * mid-flight failure left a recoverable duplicate rather than a lost session),
   * but it minted a new id and moved `created_at`, so an edited workout jumped
   * to the top of its day and the screen had to apologise for it in copy.
   *
   * `data` is REPLACED wholesale, not merged — that is the donor's contract, and
   * a merge would make it impossible to remove a key. `updateWorkoutEntry` is
   * the merging variant for the one payload shape the app actually edits.
   *
   * Returns null when the entry does not exist, belongs to someone else, or is
   * already tombstoned. All three answer 404: an "unauthorised" would confirm
   * the id exists on another account.
   */
  async updateHealthEntry(
    userId: string,
    id: string,
    patch: {
      date?: string;
      data?: unknown;
      source?: 'healthkit' | 'manual';
      intensity?: WorkoutIntensity | null;
    }
  ) {
    const existing = await this.readOwnedEntry(userId, id);
    if (!existing) return null;
    const next = {
      ...existing,
      ...(patch.date !== undefined ? { date: patch.date } : {}),
      ...(patch.data !== undefined ? { data: JSON.stringify(patch.data ?? {}) } : {}),
      ...(patch.source !== undefined ? { source: patch.source } : {}),
      ...(patch.intensity !== undefined ? { intensity: patch.intensity } : {}),
      updated_at: nowIso(),
    };
    await this.db.update(healthEntries).set(next).where(eq(healthEntries.id, id)).run();
    return next;
  }

  /**
   * Edit a logged workout session, MERGING the typed payload rather than
   * replacing it, so a caller that only changes the duration does not have to
   * resend the note it never touched.
   *
   * Refuses an entry that is not a workout: `/entries/workouts/:id` promises the
   * `{ workout_type, minutes, calories, note }` shape, and letting it rewrite a
   * `sleep` row's blob into that shape would silently corrupt it.
   */
  async updateWorkoutEntry(
    userId: string,
    id: string,
    patch: {
      date?: string;
      workout_type?: string;
      minutes?: number;
      calories?: number;
      note?: string;
      intensity?: WorkoutIntensity | null;
      /**
       * Metres. `null` DELETES the key — the only way a merge can express
       * "the member cleared this field". Omitting it keeps what is stored.
       */
      distance_m?: number | null;
      /** ISO. `null` deletes the key, same contract as `distance_m`. */
      started_at?: string | null;
    }
  ) {
    const existing = await this.readOwnedEntry(userId, id);
    if (!existing || existing.entry_type !== 'workout') return null;

    let current: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(existing.data);
      // A corrupt blob is REPLACED rather than merged into: keeping half of an
      // unparseable payload is worse than starting from what the user just typed.
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        current = parsed as Record<string, unknown>;
      }
    } catch {
      current = {};
    }

    const data: Record<string, unknown> = {
      ...current,
      ...(patch.workout_type !== undefined ? { workout_type: patch.workout_type } : {}),
      ...(patch.minutes !== undefined ? { minutes: patch.minutes } : {}),
      ...(patch.calories !== undefined ? { calories: patch.calories } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
    };

    // Distance and start time are the two OPTIONAL payload keys, so they cannot
    // ride the spread above: a spread can set a key or leave it, never remove
    // one. `null` (and a zero distance, which means the same thing) has to
    // delete it outright, or "I cleared the distance" would silently keep the
    // old figure and every total built on it would stay wrong.
    if (patch.distance_m !== undefined) {
      if (patch.distance_m === null || patch.distance_m <= 0) delete data.distance_m;
      else data.distance_m = patch.distance_m;
    }
    if (patch.started_at !== undefined) {
      if (patch.started_at === null) delete data.started_at;
      else data.started_at = patch.started_at;
    }

    return this.updateHealthEntry(userId, id, {
      date: patch.date,
      data,
      intensity: patch.intensity,
    });
  }

  /** One row, user-scoped and not tombstoned — the shared 404 gate above. */
  private async readOwnedEntry(userId: string, id: string) {
    return (
      (await this.db
        .select()
        .from(healthEntries)
        .where(
          and(
            eq(healthEntries.id, id),
            eq(healthEntries.user_id, userId),
            isNull(healthEntries.deleted_at)
          )
        )
        .get()) ?? null
    );
  }

  /**
   * Steps are one value per day, so an upsert — the donor allowed several
   * HealthKit samples, but the manual path must not stack duplicates.
   */
  async setSteps(userId: string, date: string, steps: number) {
    const existing = await this.db
      .select()
      .from(healthEntries)
      .where(
        and(
          eq(healthEntries.user_id, userId),
          eq(healthEntries.date, date),
          eq(healthEntries.entry_type, 'steps'),
          eq(healthEntries.source, 'manual'),
          isNull(healthEntries.deleted_at)
        )
      )
      .get();
    const ts = nowIso();
    if (existing) {
      const next = { ...existing, data: JSON.stringify({ steps }), updated_at: ts };
      await this.db.update(healthEntries).set(next).where(eq(healthEntries.id, existing.id)).run();
      return next;
    }
    return this.createHealthEntry(userId, { date, entry_type: 'steps', data: { steps } });
  }

  async deleteHealthEntry(userId: string, id: string) {
    const ts = nowIso();
    const res = await this.db
      .update(healthEntries)
      .set({ deleted_at: ts, updated_at: ts })
      .where(
        and(
          eq(healthEntries.id, id),
          eq(healthEntries.user_id, userId),
          isNull(healthEntries.deleted_at)
        )
      )
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  /* ---------------------------------------------------------------- */
  /* Goals                                                             */
  /* ---------------------------------------------------------------- */

  /** The goal in force ON a date — the newest row with effective_date <= date. */
  async goalFor(userId: string, date: string) {
    return (
      (await this.db
        .select()
        .from(healthGoals)
        .where(and(eq(healthGoals.user_id, userId), lte(healthGoals.effective_date, date)))
        .orderBy(desc(healthGoals.effective_date))
        .limit(1)
        .get()) ?? null
    );
  }

  /** Per-weekday override when the user set different targets per day. */
  private caloriesGoalFor(goal: typeof healthGoals.$inferSelect, date: string): number {
    if (!goal.use_per_day_calories) return goal.daily_calories;
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const perDay = [
      goal.sunday_calories,
      goal.monday_calories,
      goal.tuesday_calories,
      goal.wednesday_calories,
      goal.thursday_calories,
      goal.friday_calories,
      goal.saturday_calories,
    ];
    return perDay[dow] ?? goal.daily_calories;
  }

  /** Per-weekday macro override (0139) — protein/carbs/fat sibling of `caloriesGoalFor`. */
  private macrosGoalFor(
    goal: typeof healthGoals.$inferSelect,
    date: string
  ): { proteins: number | null; carbohydrates: number | null; fats: number | null } {
    const fallback = {
      proteins: goal.daily_protein_grams,
      carbohydrates: goal.daily_carbs_grams,
      fats: goal.daily_fats_grams,
    };
    if (!goal.use_per_day_macros) return fallback;
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const perDayProtein = [
      goal.sunday_protein_grams,
      goal.monday_protein_grams,
      goal.tuesday_protein_grams,
      goal.wednesday_protein_grams,
      goal.thursday_protein_grams,
      goal.friday_protein_grams,
      goal.saturday_protein_grams,
    ];
    const perDayCarbs = [
      goal.sunday_carbs_grams,
      goal.monday_carbs_grams,
      goal.tuesday_carbs_grams,
      goal.wednesday_carbs_grams,
      goal.thursday_carbs_grams,
      goal.friday_carbs_grams,
      goal.saturday_carbs_grams,
    ];
    const perDayFats = [
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

  async saveGoal(userId: string, effectiveDate: string, patch: Record<string, unknown>) {
    const current = await this.goalFor(userId, effectiveDate);
    const ts = nowIso();
    const base = current ?? {
      daily_calories: 2000,
      use_per_day_calories: false,
      use_per_day_macros: false,
      exclude_burned_calories: false,
    };
    const row = {
      ...base,
      ...patch,
      id: newId('goal'),
      user_id: userId,
      effective_date: effectiveDate,
      created_at: ts,
      updated_at: ts,
    };
    await this.db
      .insert(healthGoals)
      .values(row as never)
      .onConflictDoUpdate({
        target: [healthGoals.user_id, healthGoals.effective_date],
        set: { ...patch, updated_at: ts } as never,
      })
      .run();
    return this.goalFor(userId, effectiveDate);
  }

  /* ---------------------------------------------------------------- */
  /* Habits                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Every habit the member owns, each with its completion days and streak.
   *
   * `includeArchived` exists because archiving is the donor's only "deactivate"
   * verb: an archived habit has to stay reachable (to be unarchived) without
   * counting towards today's completion ring. The DEFAULT stays false so no
   * existing caller changes behaviour.
   */
  async listHabits(userId: string, options: { includeArchived?: boolean } = {}) {
    const habits = await this.db
      .select()
      .from(userHabits)
      .where(
        and(
          eq(userHabits.user_id, userId),
          isNull(userHabits.deleted_at),
          ...(options.includeArchived ? [] : [eq(userHabits.is_archived, false)])
        )
      )
      .orderBy(userHabits.sort_order)
      .all();
    const logs = await this.db
      .select()
      .from(habitLogs)
      .where(and(eq(habitLogs.user_id, userId), isNull(habitLogs.deleted_at)))
      .all();

    // Streaks are derived from the completion DAYS, never a stored counter, so
    // an untick or a backfilled day recomputes correctly.
    return habits.map((h) => {
      const days = logs
        .filter((l) => l.habit_id === h.id)
        .map((l) => l.date)
        .sort((a, b) => b.localeCompare(a));
      return {
        ...h,
        // Stored as a JSON TEXT blob (see `serializeCustomDays`); parsed back to
        // an array here so the API is SYMMETRIC with what it accepts — the same
        // contract `health-reminders-service.ts` already keeps for the identical
        // `weigh_in_days` shape (`parseWeekdays` on read). Without this a caller
        // that PUTs `custom_days: [2, 4, 6]` reads back the literal string
        // `"[2,4,6]"` on the very same response, which is not JSON the client
        // asked for and not an array it can index.
        custom_days: parseStoredCustomDays(h.custom_days),
        days,
        streak: streakOf(days),
      };
    });
  }

  /**
   * Create a habit from a preset template or a custom definition.
   *
   * Every schedule column (`time_of_day`, `frequency`, `custom_days`,
   * `target_duration`, `reminder_*`) already exists — migration `0119_health_core.sql`
   * created them and this method used to hard-code them, which is why "a habit
   * is a name and a tick" was true on the device but not in the schema. No
   * migration was needed to close that; only these writes.
   *
   * `custom_days` is persisted ONLY when the frequency is `custom`, so a habit
   * switched back to daily cannot leave a stale day set behind to be re-read if
   * it is switched to custom again.
   */
  async createHabit(userId: string, input: HabitWriteInput & { name: string }) {
    const ts = nowIso();
    const count = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(userHabits)
      .where(eq(userHabits.user_id, userId))
      .get();
    const frequency = input.frequency ?? 'daily';
    const row = {
      id: newId('habit'),
      user_id: userId,
      template_id: input.template_id ?? null,
      name: input.name,
      icon: input.icon ?? 'goals',
      category: input.category ?? 'custom',
      time_of_day: input.time_of_day ?? 'anytime',
      frequency,
      custom_days: frequency === 'custom' ? serializeCustomDays(input.custom_days) : null,
      reminder_time: input.reminder_time ?? null,
      reminder_enabled: input.reminder_enabled ?? false,
      target_duration: input.target_duration ?? null,
      notes: input.notes ?? null,
      is_archived: false,
      sort_order: input.sort_order ?? count?.n ?? 0,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.db.insert(userHabits).values(row).run();
    // `row.custom_days` is the SERIALIZED form written to the column; the
    // response gets the parsed array back, same reasoning as `listHabits` above.
    return {
      ...row,
      custom_days: parseStoredCustomDays(row.custom_days),
      days: [] as string[],
      streak: 0,
    };
  }

  /**
   * Patch a habit in place. Returns null when the id is unknown OR belongs to
   * someone else — the same 404-for-both rule `toggleHabit` documents, for the
   * same reason: a distinct 403 would confirm the id exists on another account.
   *
   * Absent keys are left alone; an explicit `null` clears the column. That
   * distinction is what lets the app clear a reminder time without also having
   * to re-send every other field.
   */
  async updateHabit(userId: string, id: string, input: HabitWriteInput & { name?: string }) {
    const owned = await this.db
      .select()
      .from(userHabits)
      .where(and(eq(userHabits.id, id), eq(userHabits.user_id, userId), isNull(userHabits.deleted_at)))
      .get();
    if (!owned) return null;

    const ts = nowIso();
    const patch: Record<string, unknown> = { updated_at: ts };
    if (input.name !== undefined) patch.name = input.name;
    if (input.icon !== undefined) patch.icon = input.icon;
    if (input.category !== undefined) patch.category = input.category;
    if (input.template_id !== undefined) patch.template_id = input.template_id;
    if (input.time_of_day !== undefined) patch.time_of_day = input.time_of_day;
    if (input.target_duration !== undefined) patch.target_duration = input.target_duration;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.is_archived !== undefined) patch.is_archived = input.is_archived;
    if (input.sort_order !== undefined) patch.sort_order = input.sort_order;
    if (input.reminder_time !== undefined) patch.reminder_time = input.reminder_time;
    if (input.reminder_enabled !== undefined) patch.reminder_enabled = input.reminder_enabled;

    // The frequency and its day set move together: leaving `custom_days` behind
    // after a switch to `daily` would resurrect a schedule the member replaced.
    const frequency = input.frequency ?? owned.frequency;
    if (input.frequency !== undefined) patch.frequency = input.frequency;
    if (input.frequency !== undefined || input.custom_days !== undefined) {
      patch.custom_days =
        frequency === 'custom'
          ? serializeCustomDays(input.custom_days ?? parseStoredCustomDays(owned.custom_days))
          : null;
    }

    await this.db
      .update(userHabits)
      .set(patch as never)
      .where(and(eq(userHabits.id, id), eq(userHabits.user_id, userId)))
      .run();

    const habits = await this.listHabits(userId, { includeArchived: true });
    return habits.find((h) => h.id === id) ?? null;
  }

  async deleteHabit(userId: string, id: string) {
    const ts = nowIso();
    const res = await this.db
      .update(userHabits)
      .set({ deleted_at: ts, updated_at: ts })
      .where(
        and(eq(userHabits.id, id), eq(userHabits.user_id, userId), isNull(userHabits.deleted_at))
      )
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  /**
   * Idempotent per (habit, day) — tapping twice unticks rather than stacking.
   *
   * Returns null when the habit does not exist OR does not belong to the caller.
   *
   * The ownership check is load-bearing, not defensive politeness:
   *  - Without it, the `habit_logs` lookup below matches on `(habit_id, date)`
   *    alone, so any authenticated user holding someone else's habit id could
   *    soft-delete THEIR completion day and silently break their streak.
   *  - `habit_logs.habit_id` is a FK to `user_habits` and D1 DOES enforce FKs,
   *    so an unknown id would otherwise throw a constraint error and 500 rather
   *    than 404 — a stale id from another device is enough to trigger it.
   */
  async toggleHabit(userId: string, habitId: string, date: string) {
    const owned = await this.db
      .select({ id: userHabits.id })
      .from(userHabits)
      .where(and(eq(userHabits.id, habitId), eq(userHabits.user_id, userId)))
      .get();
    if (!owned) return null;

    const existing = await this.db
      .select()
      .from(habitLogs)
      .where(
        and(
          eq(habitLogs.habit_id, habitId),
          eq(habitLogs.date, date),
          eq(habitLogs.user_id, userId)
        )
      )
      .get();
    const ts = nowIso();
    if (existing && !existing.deleted_at) {
      await this.db
        .update(habitLogs)
        .set({ deleted_at: ts, updated_at: ts })
        .where(eq(habitLogs.id, existing.id))
        .run();
      return { done: false };
    }
    if (existing) {
      await this.db
        .update(habitLogs)
        .set({ deleted_at: null, updated_at: ts, completed_at: ts })
        .where(eq(habitLogs.id, existing.id))
        .run();
      return { done: true };
    }
    await this.db
      .insert(habitLogs)
      .values({
        id: newId('hl'),
        user_id: userId,
        habit_id: habitId,
        date,
        time_of_day: 'anytime',
        completed_at: ts,
        duration: null,
        notes: null,
        created_at: ts,
        updated_at: ts,
        deleted_at: null,
      })
      .run();
    return { done: true };
  }

  /* ---------------------------------------------------------------- */
  /* Women's health (cycle)                                            */
  /* ---------------------------------------------------------------- */

  async getCycleSettings(userId: string) {
    const row = await this.db
      .select()
      .from(cycleSettings)
      .where(eq(cycleSettings.user_id, userId))
      .get();
    return row ?? null;
  }

  async saveCycleSettings(
    userId: string,
    patch: { cycle_length?: number; period_length?: number; last_period_start?: string | null }
  ) {
    const ts = nowIso();
    const existing = await this.getCycleSettings(userId);
    if (!existing) {
      const row = {
        id: newId('cyc'),
        user_id: userId,
        cycle_length: patch.cycle_length ?? 28,
        period_length: patch.period_length ?? 5,
        last_period_start: patch.last_period_start ?? null,
        created_at: ts,
        updated_at: ts,
      };
      await this.db.insert(cycleSettings).values(row).run();
      return row;
    }
    const next = { ...existing, ...patch, updated_at: ts };
    await this.db.update(cycleSettings).set(next).where(eq(cycleSettings.user_id, userId)).run();
    return next;
  }

  async listPeriods(userId: string, limit = 200) {
    return this.db
      .select()
      .from(periodEntries)
      .where(and(eq(periodEntries.user_id, userId), isNull(periodEntries.deleted_at)))
      .orderBy(desc(periodEntries.date))
      .limit(limit)
      .all();
  }

  /**
   * Upsert a bleeding day. Logging the first day of a NEW run re-anchors the
   * cycle so predictions follow the body rather than a stale setting.
   */
  async logPeriodDay(userId: string, date: string, flowLevel: number, notes?: string) {
    const ts = nowIso();
    await this.db
      .insert(periodEntries)
      .values({
        id: newId('p'),
        user_id: userId,
        date,
        flow_level: flowLevel,
        notes: notes ?? null,
        created_at: ts,
        updated_at: ts,
        deleted_at: null,
      })
      .onConflictDoUpdate({
        target: [periodEntries.user_id, periodEntries.date],
        set: { flow_level: flowLevel, notes: notes ?? null, deleted_at: null, updated_at: ts },
      })
      .run();

    const all = await this.listPeriods(userId, 400);
    const days = all.map((p) => p.date);
    const isRunStart = !days.includes(addDays(date, -1));
    if (isRunStart) {
      const settings = await this.getCycleSettings(userId);
      if (!settings?.last_period_start || daysBetween(settings.last_period_start, date) > 0) {
        const observed = observedCycleLength(days);
        await this.saveCycleSettings(userId, {
          last_period_start: date,
          ...(observed ? { cycle_length: observed } : {}),
        });
      }
    }
    return all;
  }

  /**
   * Soft-delete a bleeding day and RE-ANCHOR the cycle if that day was the
   * anchor.
   *
   * Without the re-anchor, `cycle_settings.last_period_start` keeps pointing at
   * a date that no longer has an entry: the screen would go on showing a cycle
   * day, a phase and predictions derived from a period the user just deleted,
   * and the "log a period day to start tracking" empty state could never come
   * back. The anchor moves to the most recent remaining RUN START, or to null
   * when nothing is left.
   */
  async removePeriodDay(userId: string, date: string) {
    const ts = nowIso();
    const res = await this.db
      .update(periodEntries)
      .set({ deleted_at: ts, updated_at: ts })
      .where(
        and(
          eq(periodEntries.user_id, userId),
          eq(periodEntries.date, date),
          isNull(periodEntries.deleted_at)
        )
      )
      .run();
    if ((res.meta?.changes ?? 0) === 0) return false;

    const settings = await this.getCycleSettings(userId);
    if (settings?.last_period_start === date) {
      const remaining = await this.listPeriods(userId, 400);
      const days = remaining.map((p) => p.date).sort();
      // A run start is a day with no logged day immediately before it.
      const starts = days.filter((d) => !days.includes(addDays(d, -1)));
      const anchor = starts.length > 0 ? starts[starts.length - 1] : null;
      const observed = observedCycleLength(days);
      await this.saveCycleSettings(userId, {
        last_period_start: anchor,
        ...(observed ? { cycle_length: observed } : {}),
      });
    }
    return true;
  }

  async listCycleSymptoms(userId: string, limit = 200) {
    return this.db
      .select()
      .from(cycleSymptomEntries)
      .where(and(eq(cycleSymptomEntries.user_id, userId), isNull(cycleSymptomEntries.deleted_at)))
      .orderBy(desc(cycleSymptomEntries.date))
      .limit(limit)
      .all();
  }

  async saveCycleSymptoms(userId: string, date: string, patch: Record<string, unknown>) {
    const ts = nowIso();
    await this.db
      .insert(cycleSymptomEntries)
      .values({
        id: newId('cs'),
        user_id: userId,
        date,
        created_at: ts,
        updated_at: ts,
        deleted_at: null,
        ...patch,
      } as never)
      .onConflictDoUpdate({
        target: [cycleSymptomEntries.user_id, cycleSymptomEntries.date],
        set: { ...patch, deleted_at: null, updated_at: ts } as never,
      })
      .run();
    return this.db
      .select()
      .from(cycleSymptomEntries)
      .where(and(eq(cycleSymptomEntries.user_id, userId), eq(cycleSymptomEntries.date, date)))
      .get();
  }

  /* ---------------------------------------------------------------- */
  /* Men's health (vitality)                                           */
  /* ---------------------------------------------------------------- */

  async listMensHealth(userId: string, limit = 200) {
    return this.db
      .select()
      .from(mensHealthEntries)
      .where(and(eq(mensHealthEntries.user_id, userId), isNull(mensHealthEntries.deleted_at)))
      .orderBy(desc(mensHealthEntries.date))
      .limit(limit)
      .all();
  }

  async saveMensHealth(userId: string, date: string, patch: Record<string, unknown>) {
    const ts = nowIso();
    await this.db
      .insert(mensHealthEntries)
      .values({
        id: newId('mh'),
        user_id: userId,
        date,
        created_at: ts,
        updated_at: ts,
        deleted_at: null,
        ...patch,
      } as never)
      .onConflictDoUpdate({
        target: [mensHealthEntries.user_id, mensHealthEntries.date],
        set: { ...patch, deleted_at: null, updated_at: ts } as never,
      })
      .run();
    return this.db
      .select()
      .from(mensHealthEntries)
      .where(and(eq(mensHealthEntries.user_id, userId), eq(mensHealthEntries.date, date)))
      .get();
  }

  async getMensHealthSettings(userId: string) {
    return (
      (await this.db
        .select()
        .from(mensHealthSettings)
        .where(eq(mensHealthSettings.user_id, userId))
        .get()) ?? null
    );
  }

  async saveMensHealthSettings(userId: string, patch: Record<string, unknown>) {
    const ts = nowIso();
    const existing = await this.getMensHealthSettings(userId);
    if (!existing) {
      const row = {
        id: newId('mhs'),
        user_id: userId,
        created_at: ts,
        updated_at: ts,
        ...patch,
      };
      await this.db.insert(mensHealthSettings).values(row as never).run();
      return row;
    }
    const next = { ...existing, ...patch, updated_at: ts };
    await this.db
      .update(mensHealthSettings)
      .set(next as never)
      .where(eq(mensHealthSettings.user_id, userId))
      .run();
    return next;
  }

  /* ---------------------------------------------------------------- */
  /* Daily summary + delta sync                                        */
  /* ---------------------------------------------------------------- */

  /** The donor's `/health/summary` — one call that fills the Home dashboard. */
  async dailySummary(userId: string, date: string) {
    const [nutrition, water, weightRows, steps, goal] = await Promise.all([
      this.nutritionSummary(userId, date),
      this.waterDailySummary(userId, date),
      this.listWeight(userId, { to: date, limit: 2 }),
      this.listHealthEntries(userId, { type: 'steps', from: date, to: date, limit: 1 }),
      this.goalFor(userId, date),
    ]);
    const stepValue = steps[0] ? (JSON.parse(steps[0].data)?.steps ?? 0) : 0;
    return {
      date,
      nutrition,
      water,
      weight: weightRows[0]
        ? { value: weightRows[0].weight, unit: weightRows[0].unit, date: weightRows[0].date }
        : null,
      steps: { value: stepValue, goal: goal?.daily_steps ?? null },
    };
  }

  /**
   * Delta pull for multi-device sync: every row touched since `since`, including
   * tombstones, so a delete propagates instead of reappearing.
   */
  async sync(userId: string, since: string) {
    const [weight, water, nutrition, measurements, entries, habits, logs, periods, symptoms, mens] =
      await Promise.all([
        this.db
          .select()
          .from(weightEntries)
          .where(and(eq(weightEntries.user_id, userId), gte(weightEntries.updated_at, since)))
          .all(),
        this.db
          .select()
          .from(waterEntries)
          .where(and(eq(waterEntries.user_id, userId), gte(waterEntries.updated_at, since)))
          .all(),
        this.db
          .select()
          .from(nutritionEntries)
          .where(and(eq(nutritionEntries.user_id, userId), gte(nutritionEntries.updated_at, since)))
          .all(),
        this.db
          .select()
          .from(bodyMeasurements)
          .where(and(eq(bodyMeasurements.user_id, userId), gte(bodyMeasurements.updated_at, since)))
          .all(),
        this.db
          .select()
          .from(healthEntries)
          .where(and(eq(healthEntries.user_id, userId), gte(healthEntries.updated_at, since)))
          .all(),
        this.db
          .select()
          .from(userHabits)
          .where(and(eq(userHabits.user_id, userId), gte(userHabits.updated_at, since)))
          .all(),
        this.db
          .select()
          .from(habitLogs)
          .where(and(eq(habitLogs.user_id, userId), gte(habitLogs.updated_at, since)))
          .all(),
        this.db
          .select()
          .from(periodEntries)
          .where(and(eq(periodEntries.user_id, userId), gte(periodEntries.updated_at, since)))
          .all(),
        this.db
          .select()
          .from(cycleSymptomEntries)
          .where(
            and(
              eq(cycleSymptomEntries.user_id, userId),
              gte(cycleSymptomEntries.updated_at, since)
            )
          )
          .all(),
        this.db
          .select()
          .from(mensHealthEntries)
          .where(and(eq(mensHealthEntries.user_id, userId), gte(mensHealthEntries.updated_at, since)))
          .all(),
      ]);

    // Singleton + P2 collections. These were missing from the original pull,
    // which made sync ASYMMETRIC: `/sync/push` accepts cycle settings, goals and
    // the P2 rows, so a device could push a change that no other device could
    // ever pull back. Anything with an `updated_at` cursor belongs here.
    const [
      settings,
      goals,
      mensSettings,
      foods,
      recipeRows,
      injuryRows,
      fridge,
      files,
      widgetPrefs,
      activityPrefs,
      reminderPrefs,
    ] = await Promise.all([
        this.db
          .select()
          .from(cycleSettings)
          .where(and(eq(cycleSettings.user_id, userId), gte(cycleSettings.updated_at, since)))
          .all(),
        this.db
          .select()
          .from(healthGoals)
          .where(and(eq(healthGoals.user_id, userId), gte(healthGoals.updated_at, since)))
          .all(),
        this.db
          .select()
          .from(mensHealthSettings)
          .where(and(eq(mensHealthSettings.user_id, userId), gte(mensHealthSettings.updated_at, since)))
          .all(),
        this.db
          .select()
          .from(customFoods)
          .where(and(eq(customFoods.user_id, userId), gte(customFoods.updated_at, since)))
          .all(),
        this.db
          .select()
          .from(recipes)
          .where(and(eq(recipes.user_id, userId), gte(recipes.updated_at, since)))
          .all(),
        this.db
          .select()
          .from(injuries)
          .where(and(eq(injuries.user_id, userId), gte(injuries.updated_at, since)))
          .all(),
        this.db
          .select()
          .from(fridgeItems)
          .where(and(eq(fridgeItems.user_id, userId), gte(fridgeItems.updated_at, since)))
          .all(),
        this.db
          .select()
          .from(userFiles)
          .where(and(eq(userFiles.user_id, userId), gte(userFiles.updated_at, since)))
          .all(),
        this.db
          .select()
          .from(widgetPreferences)
          .where(and(eq(widgetPreferences.user_id, userId), gte(widgetPreferences.updated_at, since)))
          .all(),
        this.db
          .select()
          .from(activityNotificationPreferences)
          .where(
            and(
              eq(activityNotificationPreferences.user_id, userId),
              gte(activityNotificationPreferences.updated_at, since)
            )
          )
          .all(),
        // 0134. Missing from here was the exact hole this comment block already
        // warns about — a table with its own `updated_at` cursor that only
        // `routes/health-reminders.ts` (a dedicated GET, not this pull) ever
        // served, so a reinstalled or second device fell back to the all-OFF
        // defaults while the member's real schedule sat unreachable on the
        // server. Unlike its two neighbours above, this table DOES carry a
        // tombstone (`DELETE /health/reminders/preferences`), so it is returned
        // with `reminderPrefs` intact rather than folded into the "no
        // tombstones" comment below.
        this.db
          .select()
          .from(healthReminderPreferences)
          .where(
            and(
              eq(healthReminderPreferences.user_id, userId),
              gte(healthReminderPreferences.updated_at, since)
            )
          )
          .all(),
      ]);

    return {
      since,
      server_time: nowIso(),
      weight_entries: weight,
      water_entries: water,
      nutrition_entries: nutrition,
      body_measurements: measurements,
      health_entries: entries,
      habits,
      habit_logs: logs,
      period_entries: periods,
      cycle_symptom_entries: symptoms,
      mens_health_entries: mens,
      // Singletons — no tombstones (a settings row is updated, never deleted).
      cycle_settings: settings,
      health_goals: goals,
      mens_health_settings: mensSettings,
      widget_preferences: widgetPrefs,
      activity_notification_preferences: activityPrefs,
      // Singleton, but DOES carry a tombstone — see the query comment above.
      reminder_preferences: reminderPrefs,
      // P2 collections — these DO carry tombstones, so a soft-deleted food or
      // injury now propagates instead of lingering on a second device.
      custom_foods: foods,
      recipes: recipeRows,
      injuries: injuryRows,
      fridge_items: fridge,
      user_files: files,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Pure helpers — exported for unit tests                              */
/* ------------------------------------------------------------------ */

/**
 * Consecutive completed days ending today, or yesterday — a habit not yet
 * ticked TODAY still has a live streak until the day is over.
 */
export function streakOf(days: string[], today = new Date().toISOString().slice(0, 10)): number {
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

/** Average gap between consecutive period STARTS; null until two exist. */
export function observedCycleLength(periodDays: string[]): number | null {
  const days = [...new Set(periodDays)].sort();
  const starts = days.filter((d) => !days.includes(addDays(d, -1)));
  if (starts.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < starts.length; i += 1) gaps.push(daysBetween(starts[i - 1], starts[i]));
  const usable = gaps.filter((g) => g >= 20 && g <= 45);
  if (usable.length === 0) return null;
  return Math.round(usable.reduce((s, g) => s + g, 0) / usable.length);
}
