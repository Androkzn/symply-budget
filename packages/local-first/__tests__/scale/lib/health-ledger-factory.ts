/**
 * Deterministic, seeded generator for a realistic Symply Health Wave-A ledger
 * (plan stage He10).
 *
 * WHY THIS IS DAY-DRIVEN AND NOT A COMPOSITION TABLE
 * --------------------------------------------------
 * House and Budget size their corpora with `rows = fixed + adults*perAdult +
 * years*perYear + …`, because a household's cardinality really is a set of
 * independent per-year rates. Health is not shaped like that. Health is a
 * DIARY: the thing that decides every number in this harness is what one adult
 * does on one day, and the interesting structure is INSIDE the day —
 *
 *   - some days carry two or three weigh-ins (morning and evening), which is
 *     exactly why `weight_entries` may never get a deterministic id (schema.ts,
 *     `HEALTH_RANDOM_ID_TABLES`): a `weight_${date}` builder would LWW the
 *     evening reading away;
 *   - water is 4-6 sips a day, every day, and is the highest-cardinality table
 *     in the app;
 *   - meals are 3 fixed slots plus 0-2 snacks;
 *   - `health_entries` is three different things — steps, sleep, workouts —
 *     discriminated by `entry_type` with the payload in a JSON `data` string,
 *     so the read path pays a `JSON.parse` per row that no other table pays;
 *   - `habit_logs` is ~8 habits × near-daily, and is the table `loadHabits()`
 *     has to GROUP BY habit before Home can paint.
 *
 * A linear per-year table cannot express any of that, and the plan's own
 * corpus line ("daily weight + 3-6 meals + water + workouts + sleep, 5y and
 * 10y, one adult") is a per-day statement. So the generator plans DAYS first
 * (`planDays`), and both `rowCounts()` and `generateHealthLedger()` read the
 * same plan — the counts can never disagree with the rows.
 *
 * DETERMINISM IS THE WHOLE CONTRACT
 * ---------------------------------
 * No `Date.now()`, no `Math.random()`. Every value comes from `mulberry32`
 * seeded per (table, index) via `corpus-core`'s `rngFor`, so the corpus is
 * byte-identical on every host and `corpusFingerprint()` is a stable identity
 * that `compare` can refuse to diff across.
 *
 * ONE USER, N DEVICES — NOT N MEMBERS
 * -----------------------------------
 * Health's household is personal (plan §1.2): one implicit household per user,
 * several devices, and He5's control plane refuses a second `user_id`
 * outright. So `adults` is 1 and stays 1; the multi-device property that makes
 * the op log interleaved lives in `HEALTH_DEVICE_COUNT`, not in a member list.
 * Passing `--adults 2` to the driver would generate a corpus the product cannot
 * produce, which is why the reference spec pins it.
 */
import { createHash } from 'node:crypto';

import {
  HEALTH_LEDGER_TABLE_KEYS,
  HEALTH_LEDGER_TABLE_NAMES,
  type HealthLedgerTableName,
} from '../../../../../src/features/health/local/schema';
import type { StoredOperation } from '../../../src/store/types';

import {
  buildLwwMap,
  bulkDeleteDeltaOf,
  cloneLedgerOf,
  lwwStampCountOf,
  pad2,
  pick,
  rngFor,
  rowIdAtOf,
  totalRowsOf,
  type CorpusRegistry,
  type CorpusRow,
} from './corpus-core';

export type ScaleRow = CorpusRow;

export const HEALTH_REGISTRY: CorpusRegistry<HealthLedgerTableName> = {
  tableNames: HEALTH_LEDGER_TABLE_NAMES,
  tableKeys: HEALTH_LEDGER_TABLE_KEYS,
};

/**
 * Structural stand-in for `HealthLedger` (engine.ts:94). The real type cannot
 * be imported here — `engine.ts` pulls `@api/*` and `expo-*`, neither of which
 * resolves outside the mobile tsconfig. `projection.ts` IS reachable, because
 * its only import of the engine is `import type`, erased at runtime. Phases
 * cast `as never` into the projection functions, exactly as the Budget and
 * House harnesses already do.
 */
export type HealthScaleLedger = {
  version: 1;
  household: ScaleRow;
  deviceId: string;
  ops: StoredOperation[];
  lww?: Record<string, unknown>;
  conflicts?: unknown[];
  pendingEnrolment?: boolean;
  crypto?: Record<string, string | number>;
} & { [T in HealthLedgerTableName]: ScaleRow[] };

export type HealthScaleSpec = { years: number; adults?: number; seed?: number };
export type HealthScaleId = { years: number; adults: number; rows: number; ops: number };

/** Distinct from Budget's `0x5c41e` and House's `0x0405e`: a mixed-up seed is obvious. */
export const HEALTH_DEFAULT_SEED = 0x4ea17;
export const HEALTH_REFERENCE_SPEC: Required<HealthScaleSpec> = {
  years: 5,
  adults: 1,
  seed: HEALTH_DEFAULT_SEED,
};

/** Phone + tablet. One USER, two devices — see the header. */
export const HEALTH_DEVICE_COUNT = 2;

const USER_ID = 'usr_h3a1th7c0d2e5f8';
const HOUSEHOLD_ID = 'hhh_local_9b2f4a7c1e6d8035';
const LOCAL_DEVICE_ID = 'dev_h0e1a2l3t4h5';
const ISO = '2026-03-14T08:21:44.512Z';

/**
 * The last day the corpus covers, for every scale.
 *
 * Anchoring the END rather than the start is what makes the windowed loaders
 * honest: `loadMeals()` reads the last 120 days, `loadWaterHistory()` the last
 * 400, and every Home ring reads "today". If the corpus ended at a different
 * date per scale those windows would land on different densities and the
 * `health-homehydrate` numbers would not be comparable across 1y/5y/10y.
 */
export const CORPUS_END_DATE = '2026-03-14';

/** 365.25 so a 4-year span carries its leap day. */
export function daysFor(years: number): number {
  return Math.round(years * 365.25);
}

export function memberIdsFor(_adults: number): string[] {
  return [USER_ID];
}

export function deviceIdsFor(devices: number = HEALTH_DEVICE_COUNT): string[] {
  return Array.from({ length: devices }, (_, d) =>
    d === 0 ? LOCAL_DEVICE_ID : `dev_${String(d).padStart(2, '0')}c7b3e91f2a`,
  );
}

function resolved(spec: HealthScaleSpec): Required<HealthScaleSpec> {
  return {
    years: spec.years,
    // Pinned: a Health household has exactly one user (plan §1.2).
    adults: 1,
    seed: spec.seed ?? HEALTH_DEFAULT_SEED,
  };
}

// ---------------------------------------------------------------------------
// the day model — the numbers the realism guard asserts against
// ---------------------------------------------------------------------------

/**
 * Every per-day rate in one exported object so `health-corpus-realism.test.ts`
 * can assert the GENERATED corpus against the DECLARED model rather than
 * against a hand-copied constant that drifts.
 */
export const HEALTH_DAY_MODEL = {
  /** P(no weigh-in), then 1 / 2 / 3 weigh-ins. Mean 1.08/day. */
  weight: { skip: 0.12, one: 0.82, two: 0.98 },
  /** P(no water logged); otherwise 4-6 entries. Mean ~4.85/day. */
  water: { skip: 0.03, min: 4, span: 3 },
  /** P(nothing eaten/logged); otherwise 3 slots + up to 2 snacks. Mean ~3.72/day. */
  nutrition: { skip: 0.02, snack1: 0.55, snack2: 0.25 },
  /** `health_entries`: one steps row daily, sleep most nights, 0-2 workouts. */
  health: { sleep: 0.94, workoutNone: 0.45, workoutOne: 0.92 },
  /** A taping session roughly twice a month. */
  body: { perDay: 0.065 },
  /** 8 concurrent habits; one retires each time a new one is adopted. */
  habits: { concurrent: 8, adoptEveryYears: 3, logged: 0.72 },
  /** Goals change a few times a year (a cut, a bulk, a new step target). */
  goals: { perYear: 3 },
} as const;

/** Per-day row counts, the single source both `rowCounts` and generation read. */
type DayPlan = {
  days: number;
  weight: Uint8Array;
  water: Uint8Array;
  nutrition: Uint8Array;
  /** steps + sleep? + workouts — the count of `health_entries` rows that day. */
  health: Uint8Array;
  /** 1 when the day carries a `health_entries` sleep row. */
  sleep: Uint8Array;
  body: Uint8Array;
  /** Bitmask of habit indices completed that day (≤32 habits by construction). */
  habitLogs: Uint32Array;
  habitCount: number;
  goalCount: number;
};

/** How many habit definitions exist over `years` — 8 plus one every 3 years. */
export function habitCountFor(years: number): number {
  return HEALTH_DAY_MODEL.habits.concurrent + Math.floor(years / HEALTH_DAY_MODEL.habits.adoptEveryYears);
}

/** Day index a habit is adopted on. The first 8 are there from day one. */
function habitAdoptedDay(index: number): number {
  const { concurrent, adoptEveryYears } = HEALTH_DAY_MODEL.habits;
  if (index < concurrent) return 0;
  return Math.floor((index - concurrent + 1) * adoptEveryYears * 365.25);
}

/**
 * Day index a habit is archived on — the day its replacement is adopted, so
 * exactly `concurrent` habits are live at any moment. `is_archived` is a real
 * column (`user_habits.is_archived`) and `loadHabits()` filters on it, so a
 * corpus where nothing is ever archived measures a filter that always passes.
 */
function habitArchivedDay(index: number, total: number): number {
  const next = index + HEALTH_DAY_MODEL.habits.concurrent;
  return next < total ? habitAdoptedDay(next) : Number.POSITIVE_INFINITY;
}

function planDays(spec: HealthScaleSpec): DayPlan {
  const { years, seed } = resolved(spec);
  const days = daysFor(years);
  const M = HEALTH_DAY_MODEL;

  const plan: DayPlan = {
    days,
    weight: new Uint8Array(days),
    water: new Uint8Array(days),
    nutrition: new Uint8Array(days),
    health: new Uint8Array(days),
    sleep: new Uint8Array(days),
    body: new Uint8Array(days),
    habitLogs: new Uint32Array(days),
    habitCount: habitCountFor(years),
    goalCount: 1 + M.goals.perYear * years,
  };

  for (let d = 0; d < days; d += 1) {
    {
      const r = rngFor(seed, 'plan:weight', d);
      const roll = r();
      plan.weight[d] = roll < M.weight.skip ? 0 : roll < M.weight.one ? 1 : roll < M.weight.two ? 2 : 3;
    }
    {
      const r = rngFor(seed, 'plan:water', d);
      plan.water[d] = r() < M.water.skip ? 0 : M.water.min + Math.floor(r() * M.water.span);
    }
    {
      const r = rngFor(seed, 'plan:nutrition', d);
      if (r() < M.nutrition.skip) {
        plan.nutrition[d] = 0;
      } else {
        plan.nutrition[d] = 3 + (r() < M.nutrition.snack1 ? 1 : 0) + (r() < M.nutrition.snack2 ? 1 : 0);
      }
    }
    {
      const r = rngFor(seed, 'plan:health', d);
      const sleep = r() < M.health.sleep ? 1 : 0;
      const roll = r();
      const workouts = roll < M.health.workoutNone ? 0 : roll < M.health.workoutOne ? 1 : 2;
      plan.sleep[d] = sleep;
      // 1 steps row every day — the widget reads a per-day steps row whether or
      // not anything was walked, which is what `setStepsForDate` writes.
      plan.health[d] = 1 + sleep + workouts;
    }
    {
      const r = rngFor(seed, 'plan:body', d);
      plan.body[d] = r() < M.body.perDay ? 1 : 0;
    }
    {
      const r = rngFor(seed, 'plan:habitLogs', d);
      let mask = 0;
      for (let h = 0; h < plan.habitCount; h += 1) {
        const live = d >= habitAdoptedDay(h) && d < habitArchivedDay(h, plan.habitCount);
        if (live && r() < M.habits.logged) mask |= 1 << h;
      }
      plan.habitLogs[d] = mask >>> 0;
    }
  }

  return plan;
}

function sum(counts: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < counts.length; i += 1) n += counts[i]!;
  return n;
}

function popcount(value: number): number {
  let v = value - ((value >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function rowCounts(spec: HealthScaleSpec): Record<HealthLedgerTableName, number> {
  const plan = planDays(spec);
  let habitLogs = 0;
  for (let d = 0; d < plan.days; d += 1) habitLogs += popcount(plan.habitLogs[d]!);
  return {
    weightEntries: sum(plan.weight),
    waterEntries: sum(plan.water),
    nutritionEntries: sum(plan.nutrition),
    healthEntries: sum(plan.health),
    bodyMeasurements: sum(plan.body),
    userHabits: plan.habitCount,
    habitLogs,
    healthGoals: plan.goalCount,
  };
}

/**
 * Ops per row: one create plus a later edit on half of them — Budget's measured
 * 1.5 ops-per-row ratio, inherited by House and now by Health as a DECLARED
 * assumption. Health has no independently observed ratio yet; the baseline says
 * so rather than presenting it as a measurement.
 */
const OPS_PER_ROW_EXTRA = 0.5;

export function scaleId(spec: HealthScaleSpec): HealthScaleId {
  const { years, adults } = resolved(spec);
  const counts = rowCounts(spec);
  let rows = 0;
  for (const table of HEALTH_LEDGER_TABLE_NAMES) rows += counts[table];
  return { years, adults, rows, ops: rows + Math.round(rows * OPS_PER_ROW_EXTRA) };
}

// ---------------------------------------------------------------------------
// dates
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;
const END_MS = Date.UTC(2026, 2, 14);

/** `YYYY-MM-DD` for day index `d` of a `days`-long corpus ending at CORPUS_END_DATE. */
function dayKey(d: number, days: number): string {
  const t = new Date(END_MS - (days - 1 - d) * MS_PER_DAY);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** An ISO timestamp inside day `d`, at `hour:minute`. */
function isoAt(d: number, days: number, hour: number, minute: number): string {
  const t = new Date(END_MS - (days - 1 - d) * MS_PER_DAY + hour * 3_600_000 + minute * 60_000);
  return t.toISOString();
}

// ---------------------------------------------------------------------------
// vocabulary — sized so JSON / AEAD costs vary the way real text does
// ---------------------------------------------------------------------------

const FOODS = [
  'Greek yogurt with blueberries',
  'Oatmeal, banana and peanut butter',
  'Two scrambled eggs on rye',
  'Chicken and rice bowl',
  'Turkey sandwich',
  'Lentil soup',
  'Salmon, potatoes and green beans',
  'Beef stir fry with broccoli',
  'Spaghetti bolognese',
  'Caesar salad with grilled chicken',
  'Protein shake',
  'Apple',
  'Handful of almonds',
  'Cottage cheese',
  'Whole wheat toast with avocado',
  'Veggie burrito bowl',
  'Tuna salad',
  'Cheese and crackers',
  'Dark chocolate square',
  'Banana bread slice',
] as const;

const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack', 'snack'] as const;

const BEVERAGES = ['water', 'water', 'water', 'sparkling', 'tea', 'coffee'] as const;
const CONTAINERS = ['glass', 'bottle', 'mug', 'large bottle'] as const;

const WORKOUTS = [
  'Easy run',
  'Interval run',
  'Upper body strength',
  'Lower body strength',
  'Full body circuit',
  'Cycling',
  'Swimming',
  'Yoga',
  'Long walk',
  'Rowing',
] as const;

const INTENSITIES = ['low', 'moderate', 'moderate', 'high'] as const;

const HABIT_NAMES = [
  'Drink 8 glasses of water',
  'Walk 10,000 steps',
  'Take vitamins',
  'Stretch for 10 minutes',
  'No screens after 10pm',
  'Read 20 pages',
  'Meditate',
  'Log every meal',
  'Cold shower',
  'Journal before bed',
  'Floss',
  'Morning sunlight',
] as const;

const HABIT_ICONS = ['droplet', 'footprints', 'pill', 'stretch', 'moon', 'book', 'lotus', 'fork', 'snowflake', 'pen', 'tooth', 'sun'] as const;
const HABIT_CATEGORIES = ['hydration', 'activity', 'nutrition', 'mind', 'sleep', 'care'] as const;
const TIMES_OF_DAY = ['morning', 'afternoon', 'evening', 'anytime'] as const;

const WEIGHT_NOTES = [
  '',
  '',
  '',
  'after run',
  'post-holiday',
  'before breakfast',
  'felt bloated',
] as const;

const BODY_SITES = [
  'chest',
  'waist',
  'hips',
  'neck',
  'shoulders',
  'left_arm',
  'right_arm',
  'left_forearm',
  'right_forearm',
  'left_thigh',
  'right_thigh',
  'left_calf',
  'right_calf',
  'waist_navel',
] as const;

// ---------------------------------------------------------------------------
// row factories — field-for-field against src/features/health/local/types.ts
// ---------------------------------------------------------------------------

type Ctx = { days: number; seed: number };

/** `LocalWeightEntry`. */
function makeWeightEntry(i: number, d: number, slot: number, ctx: Ctx): ScaleRow {
  const r = rngFor(ctx.seed, 'row:weightEntries', i);
  // A slow drift plus daily noise — real logs are neither flat nor a ramp.
  const base = 82 - (d / ctx.days) * 6 + Math.sin(d / 45) * 0.9;
  const hour = slot === 0 ? 7 : slot === 1 ? 21 : 13;
  return {
    id: `wgt_${String(i).padStart(9, '0')}`,
    user_id: USER_ID,
    date: dayKey(d, ctx.days),
    weight: Math.round((base + (r() - 0.5) * 0.8) * 10) / 10,
    unit: 'kg',
    note: pick(r, WEIGHT_NOTES),
    source: 'manual',
    created_at: isoAt(d, ctx.days, hour, Math.floor(r() * 59)),
    updated_at: isoAt(d, ctx.days, hour, Math.floor(r() * 59)),
    deleted_at: null,
  };
}

/** `LocalWaterEntry` — note there is deliberately NO `source` column (§1.5 row 2). */
function makeWaterEntry(i: number, d: number, slot: number, ctx: Ctx): ScaleRow {
  const r = rngFor(ctx.seed, 'row:waterEntries', i);
  const hour = 8 + slot * 3;
  return {
    id: `wtr_${String(i).padStart(9, '0')}`,
    user_id: USER_ID,
    date: dayKey(d, ctx.days),
    amount_ml: 200 + Math.floor(r() * 4) * 50,
    beverage_type: pick(r, BEVERAGES),
    container: pick(r, CONTAINERS),
    created_at: isoAt(d, ctx.days, Math.min(23, hour), Math.floor(r() * 59)),
    updated_at: isoAt(d, ctx.days, Math.min(23, hour), Math.floor(r() * 59)),
    deleted_at: null,
  };
}

/** `LocalNutritionEntry` — the widest of the high-cardinality tables. */
function makeNutritionEntry(i: number, d: number, slot: number, ctx: Ctx): ScaleRow {
  const r = rngFor(ctx.seed, 'row:nutritionEntries', i);
  const portion = 50 + Math.floor(r() * 6) * 25;
  const per100 = 60 + Math.floor(r() * 220);
  const calories = Math.round((per100 * portion) / 100);
  const fromLibrary = r() < 0.55;
  const hour = slot === 0 ? 8 : slot === 1 ? 12 : slot === 2 ? 19 : 15;
  return {
    id: `nut_${String(i).padStart(9, '0')}`,
    user_id: USER_ID,
    date: dayKey(d, ctx.days),
    food_name: pick(r, FOODS),
    portion,
    unit: 'g',
    meal_type: MEAL_SLOTS[Math.min(slot, MEAL_SLOTS.length - 1)]!,
    calories,
    proteins: Math.round(calories * 0.06 * 10) / 10,
    carbohydrates: Math.round(calories * 0.11 * 10) / 10,
    fats: Math.round(calories * 0.04 * 10) / 10,
    // A library row carries its per-100 basis so the portion stays editable
    // (0124); a hand-typed row does not. Both shapes are in a real diary.
    food_id: fromLibrary ? `fd_${Math.floor(r() * 4000)}` : null,
    base_calories_per_100: fromLibrary ? per100 : null,
    base_proteins_per_100: fromLibrary ? Math.round(per100 * 0.06 * 10) / 10 : null,
    base_carbs_per_100: fromLibrary ? Math.round(per100 * 0.11 * 10) / 10 : null,
    base_fats_per_100: fromLibrary ? Math.round(per100 * 0.04 * 10) / 10 : null,
    detected_category: fromLibrary ? pick(r, ['protein', 'grain', 'produce', 'dairy', 'treat']) : null,
    is_processed: r() < 0.3 ? 1 : 0,
    source_recipe_id: null,
    source: 'manual',
    created_at: isoAt(d, ctx.days, hour, Math.floor(r() * 59)),
    updated_at: isoAt(d, ctx.days, hour, Math.floor(r() * 59)),
    deleted_at: null,
  };
}

/**
 * `LocalHealthEntry` — steps / sleep / workout in ONE table, discriminated by
 * `entry_type` with the payload in a JSON string. Three of the seventeen Home
 * loaders read this table and each one pays a `JSON.parse` per row it keeps,
 * which is a cost no other Health table has.
 */
function makeHealthEntry(i: number, d: number, kind: 'steps' | 'sleep' | 'workout', ctx: Ctx): ScaleRow {
  const r = rngFor(ctx.seed, 'row:healthEntries', i);
  let data: string;
  let hour = 23;
  let intensity: string | null = null;
  if (kind === 'steps') {
    data = JSON.stringify({ steps: 3200 + Math.floor(r() * 11000), distance_m: 2400 + Math.floor(r() * 8000) });
  } else if (kind === 'sleep') {
    data = JSON.stringify({
      minutes: 330 + Math.floor(r() * 150),
      quality: Math.ceil(r() * 5),
      bedtime: `${22 + Math.floor(r() * 2)}:${pad2(Math.floor(r() * 59))}`,
    });
    hour = 7;
  } else {
    hour = 6 + Math.floor(r() * 14);
    intensity = pick(r, INTENSITIES);
    data = JSON.stringify({
      name: pick(r, WORKOUTS),
      minutes: 20 + Math.floor(r() * 70),
      calories: 120 + Math.floor(r() * 500),
      distance_m: r() < 0.5 ? 3000 + Math.floor(r() * 12000) : null,
      started_at: isoAt(d, ctx.days, hour, Math.floor(r() * 59)),
    });
  }
  return {
    id: `hen_${String(i).padStart(9, '0')}`,
    user_id: USER_ID,
    date: dayKey(d, ctx.days),
    entry_type: kind,
    data,
    source: 'manual',
    intensity,
    created_at: isoAt(d, ctx.days, hour, Math.floor(r() * 59)),
    updated_at: isoAt(d, ctx.days, hour, Math.floor(r() * 59)),
    deleted_at: null,
  };
}

/**
 * `LocalBodyMeasurement` — 40+ optional numeric columns, and SPARSE in both
 * senses: roughly two sessions a month, and each session tapes a subset of the
 * sites rather than all of them. Populating all 41 every time would invent a
 * user nobody is, and would overstate the per-field LWW cost this table carries.
 */
function makeBodyMeasurement(i: number, d: number, ctx: Ctx): ScaleRow {
  const r = rngFor(ctx.seed, 'row:bodyMeasurements', i);
  const row: ScaleRow = {
    id: `bdy_${String(i).padStart(9, '0')}`,
    user_id: USER_ID,
    date: dayKey(d, ctx.days),
    unit: 'cm',
    body_fat_percentage: Math.round((14 + r() * 8) * 10) / 10,
    created_at: isoAt(d, ctx.days, 7, Math.floor(r() * 59)),
    updated_at: isoAt(d, ctx.days, 7, Math.floor(r() * 59)),
    deleted_at: null,
  };
  // A session tapes a rotating 8-14 of the 41 sites.
  const taken = 8 + Math.floor(r() * 7);
  for (let s = 0; s < taken; s += 1) {
    const site = BODY_SITES[(i * 5 + s) % BODY_SITES.length]!;
    row[site] = Math.round((28 + r() * 70) * 10) / 10;
  }
  return row;
}

/** `LocalUserHabit`. */
function makeUserHabit(i: number, ctx: Ctx): ScaleRow {
  const r = rngFor(ctx.seed, 'row:userHabits', i);
  const total = habitCountFor(ctx.days / 365.25);
  const archived = habitArchivedDay(i, total);
  return {
    id: `hab_${String(i).padStart(6, '0')}`,
    user_id: USER_ID,
    template_id: i < 8 ? `tpl_${i}` : null,
    name: HABIT_NAMES[i % HABIT_NAMES.length]!,
    icon: HABIT_ICONS[i % HABIT_ICONS.length]!,
    category: pick(r, HABIT_CATEGORIES),
    time_of_day: pick(r, TIMES_OF_DAY),
    frequency: r() < 0.8 ? 'daily' : 'weekly',
    custom_days: r() < 0.2 ? JSON.stringify([1, 2, 3, 4, 5]) : null,
    reminder_time: r() < 0.5 ? `${pad2(6 + Math.floor(r() * 14))}:00` : null,
    reminder_enabled: r() < 0.5 ? 1 : 0,
    target_duration: r() < 0.4 ? 5 + Math.floor(r() * 25) : null,
    notes: r() < 0.25 ? 'Kept from the January reset.' : null,
    is_archived: Number.isFinite(archived) && archived < ctx.days ? 1 : 0,
    sort_order: i,
    created_at: ISO,
    updated_at: ISO,
    deleted_at: null,
  };
}

/**
 * `LocalHabitLog` — the id is DETERMINISTIC (`unique(habit_id, date)`,
 * schema.ts `HEALTH_DETERMINISTIC_ID_TABLES`), so the corpus must key it the
 * same way or the offline-double-create convergence this harness sits on top
 * of is not the one the product runs.
 */
function makeHabitLog(i: number, d: number, habitIndex: number, ctx: Ctx): ScaleRow {
  const r = rngFor(ctx.seed, 'row:habitLogs', i);
  const habitId = `hab_${String(habitIndex).padStart(6, '0')}`;
  const date = dayKey(d, ctx.days);
  const hour = 6 + Math.floor(r() * 16);
  return {
    id: `hlg_${habitId}_${date}`,
    user_id: USER_ID,
    habit_id: habitId,
    date,
    time_of_day: pick(r, TIMES_OF_DAY),
    completed_at: isoAt(d, ctx.days, hour, Math.floor(r() * 59)),
    duration: r() < 0.35 ? 5 + Math.floor(r() * 25) : null,
    notes: r() < 0.08 ? 'Short one today.' : null,
    created_at: isoAt(d, ctx.days, hour, Math.floor(r() * 59)),
    updated_at: isoAt(d, ctx.days, hour, Math.floor(r() * 59)),
    deleted_at: null,
  };
}

/**
 * `LocalHealthGoal` — the widest row in the registry (~60 columns) and the one
 * an effective-dated read has to scan. Deterministic id on
 * `(user_id, effective_date)`.
 */
function makeHealthGoal(i: number, d: number, ctx: Ctx): ScaleRow {
  const r = rngFor(ctx.seed, 'row:healthGoals', i);
  const effective = dayKey(d, ctx.days);
  const calories = 1900 + Math.floor(r() * 900);
  const perDayMacros = r() < 0.35;
  const perDayCalories = r() < 0.3;
  const dayScaled = (base: number, k: number) => Math.round(base * (0.9 + ((k * 7) % 5) / 20));
  const row: ScaleRow = {
    id: `hgl_${USER_ID}_${effective}`,
    user_id: USER_ID,
    effective_date: effective,
    daily_calories: calories,
    use_per_day_calories: perDayCalories ? 1 : 0,
    daily_protein_grams: Math.round(calories * 0.075),
    daily_carbs_grams: Math.round(calories * 0.11),
    daily_fats_grams: Math.round(calories * 0.035),
    use_per_day_macros: perDayMacros ? 1 : 0,
    daily_water_ml: 2000 + Math.floor(r() * 4) * 250,
    daily_steps: 8000 + Math.floor(r() * 5) * 1000,
    daily_active_calories: 400 + Math.floor(r() * 4) * 50,
    daily_workout_minutes: 30 + Math.floor(r() * 4) * 10,
    daily_sleep_hours: 7 + Math.round(r()),
    exclude_burned_calories: r() < 0.5 ? 1 : 0,
    target_weight_kg: Math.round((72 + r() * 8) * 10) / 10,
    weight_goal_type: pick(r, ['lose', 'maintain', 'gain']),
    starting_weight_kg: Math.round((82 + r() * 4) * 10) / 10,
    starting_weight_date: effective,
    height_cm: 178,
    gender: 'male',
    birth_year: 1988,
    activity_level: pick(r, ['sedentary', 'light', 'moderate', 'active']),
    water_unit: 'ml',
    unit_system: 'metric',
    created_at: isoAt(d, ctx.days, 9, 0),
    updated_at: isoAt(d, ctx.days, 9, 0),
    deleted_at: null,
  };
  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
  DAYS.forEach((name, k) => {
    row[`${name}_calories`] = perDayCalories ? dayScaled(calories, k) : null;
    row[`${name}_protein_grams`] = perDayMacros ? dayScaled(calories * 0.075, k) : null;
    row[`${name}_carbs_grams`] = perDayMacros ? dayScaled(calories * 0.11, k) : null;
    row[`${name}_fats_grams`] = perDayMacros ? dayScaled(calories * 0.035, k) : null;
  });
  return row;
}

// ---------------------------------------------------------------------------

export function generateHealthLedger(spec: HealthScaleSpec): HealthScaleLedger {
  const { seed } = resolved(spec);
  const plan = planDays(spec);
  const ctx: Ctx = { days: plan.days, seed };

  const weightEntries: ScaleRow[] = [];
  const waterEntries: ScaleRow[] = [];
  const nutritionEntries: ScaleRow[] = [];
  const healthEntries: ScaleRow[] = [];
  const bodyMeasurements: ScaleRow[] = [];
  const habitLogs: ScaleRow[] = [];

  for (let d = 0; d < plan.days; d += 1) {
    for (let s = 0; s < plan.weight[d]!; s += 1) {
      weightEntries.push(makeWeightEntry(weightEntries.length, d, s, ctx));
    }
    for (let s = 0; s < plan.water[d]!; s += 1) {
      waterEntries.push(makeWaterEntry(waterEntries.length, d, s, ctx));
    }
    for (let s = 0; s < plan.nutrition[d]!; s += 1) {
      nutritionEntries.push(makeNutritionEntry(nutritionEntries.length, d, s, ctx));
    }
    {
      const total = plan.health[d]!;
      const hasSleep = plan.sleep[d]! === 1;
      for (let s = 0; s < total; s += 1) {
        const kind = s === 0 ? 'steps' : s === 1 && hasSleep ? 'sleep' : 'workout';
        healthEntries.push(makeHealthEntry(healthEntries.length, d, kind, ctx));
      }
    }
    for (let s = 0; s < plan.body[d]!; s += 1) {
      bodyMeasurements.push(makeBodyMeasurement(bodyMeasurements.length, d, ctx));
    }
    {
      const mask = plan.habitLogs[d]!;
      for (let h = 0; h < plan.habitCount; h += 1) {
        if ((mask & (1 << h)) !== 0) habitLogs.push(makeHabitLog(habitLogs.length, d, h, ctx));
      }
    }
  }

  const userHabits: ScaleRow[] = Array.from({ length: plan.habitCount }, (_, i) =>
    makeUserHabit(i, ctx),
  );
  const healthGoals: ScaleRow[] = Array.from({ length: plan.goalCount }, (_, i) =>
    // Spread across the span, oldest first, with the newest still in the past.
    makeHealthGoal(i, Math.min(plan.days - 1, Math.floor((i * plan.days) / plan.goalCount)), ctx),
  );

  const ledger = {
    version: 1,
    household: { id: HOUSEHOLD_ID, userId: USER_ID, createdAt: ISO },
    deviceId: LOCAL_DEVICE_ID,
    ops: [] as StoredOperation[],
    lww: {},
    conflicts: [],
    pendingEnrolment: false,
    weightEntries,
    waterEntries,
    nutritionEntries,
    healthEntries,
    bodyMeasurements,
    userHabits,
    habitLogs,
    healthGoals,
  } as unknown as HealthScaleLedger;

  ledger.lww = buildLwwMap(ledger as unknown as Record<string, unknown>, HEALTH_REGISTRY, {
    // One member — the watermark map still varies its device suffix, because
    // the SECOND DEVICE is what makes the stamps non-uniform, not a second user.
    members: [USER_ID],
    devices: deviceIdsFor(),
  });

  return ledger;
}

export function lwwStampCount(ledger: HealthScaleLedger): number {
  return lwwStampCountOf(ledger.lww);
}

/**
 * Identity of the corpus, so `compare` can refuse to diff numbers produced from
 * two different ones. Derived from a real 1-year corpus rather than a
 * hand-bumped constant: a factory tweak, a new field or a change to the
 * watermark map moves it automatically and nobody has to remember.
 */
export function corpusFingerprint(spec?: HealthScaleSpec): string {
  const { seed } = resolved(spec ?? HEALTH_REFERENCE_SPEC);
  const probe = generateHealthLedger({ years: 1, seed });
  return createHash('sha256').update(JSON.stringify(probe), 'utf8').digest('hex').slice(0, 16);
}

export function bulkDeleteDelta(
  ledger: HealthScaleLedger,
  table: HealthLedgerTableName,
  count: number,
  offset = 0,
): { v: 1; d: Record<string, string[]> } {
  return bulkDeleteDeltaOf(
    ledger as unknown as Record<string, unknown>,
    HEALTH_REGISTRY,
    table,
    count,
    offset,
  );
}

export function totalRows(ledger: HealthScaleLedger): number {
  return totalRowsOf(ledger as unknown as Record<string, unknown>, HEALTH_REGISTRY);
}

export function rowIdAt(
  ledger: HealthScaleLedger,
  table: HealthLedgerTableName,
  index: number,
): string {
  return rowIdAtOf(ledger as unknown as Record<string, unknown>, HEALTH_REGISTRY, table, index);
}

export function cloneLedger(ledger: HealthScaleLedger): HealthScaleLedger {
  return cloneLedgerOf(
    ledger as unknown as Record<string, unknown>,
    HEALTH_REGISTRY,
  ) as unknown as HealthScaleLedger;
}
