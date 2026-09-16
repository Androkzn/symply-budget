import { healthApi, type HealthGoal } from '@api/health';

import {
  DEFAULT_ACTIVITY_GOALS,
  loadActivityGoals,
  type ActivityGoals,
} from './healthActivityStorage';
import {
  CUP_ML,
  DEFAULT_WATER_TARGET,
  latestWeight,
  loadHealthPrefs,
  loadWaterToday,
  loadWeightLog,
  todayDateKey,
  type WeightUnit,
} from './healthLocalStorage';
import {
  DEFAULT_NUTRITION_GOALS,
  loadNutritionGoals,
  type NutritionGoals,
} from './healthNutritionStorage';
import { readThrough, writeThrough } from './healthRepository';
import { ACTIVITY_MULTIPLIERS, ageFromBirthYear, bmrFor, tdeeFor } from './healthWeightAnalytics';
import {
  EMPTY_WEIGHT_GOAL,
  loadWeightGoal,
  weightToKg,
  type WeightGoal,
} from './healthWeightStorage';

/**
 * Symply Health — the GOALS screen's storage layer.
 *
 * Donor: `Settings/GoalsSettingsView.swift` (2,233 lines) + `HealthGoalsManager`
 * + `GoalCalculator`. The donor keeps every target on one `HealthGoals` value
 * object and edits it through a stack of sheets; here the targets are already
 * spread across four storage modules that each own one slice of the SAME
 * `/health/goals` row:
 *
 *   calories + P/C/F  → `healthNutritionStorage`   (`health.nutritionGoals.v1`)
 *   steps + minutes   → `healthActivityStorage`    (`health.activityGoals.v1`)
 *   water target      → `healthLocalStorage`       (`health.water.v1`)
 *   weight + biometry → `healthWeightStorage`      (`health.weightGoal.v1`)
 *
 * ── WHY THIS MODULE DOES NOT OWN THOSE FIELDS ────────────────────────────────
 *
 * It would have been shorter to read and write the whole goal row from one new
 * cache key here. That would have been wrong: the Nutrition tab's calorie ring,
 * the Activity tab's step target and Home's water target all render from their
 * OWN cached snapshots, and a Goals screen that wrote somewhere else would
 * leave every one of them showing yesterday's target until its next successful
 * network read — i.e. exactly on the offline path the cache exists to protect.
 *
 * So this module READS everything (to render one screen) but WRITES only
 * through the module that already owns each field. The one thing it owns
 * outright is the per-weekday calorie plan, because nothing else does.
 *
 * ── THE READ COSTS FOUR GETs ─────────────────────────────────────────────────
 *
 * `loadHealthGoals()` fans out to the four loaders in parallel, and three of
 * them (plus this module's own) each `GET /health/goals`. That is four reads of
 * one small row when the screen opens — deliberately accepted over a shared
 * request cache, which would have to be invalidated by every writer in the
 * feature and would silently serve a pre-write row to the read-back inside
 * `writeThrough`. Four cheap reads once per screen open is the cheaper mistake.
 */

/* ------------------------------------------------------------------ */
/* Per-weekday calorie plan — the only field this module owns          */
/* ------------------------------------------------------------------ */

/**
 * Cached per-weekday calorie plan.
 *
 * Registered in `healthCacheKeys.ts` (same commit) and therefore cleared on
 * sign-out: a calorie target is a health record, and "2,900 on Saturdays" left
 * behind on a shared handset tells the next person what the previous one eats.
 */
export const HEALTH_CALORIE_WEEK_KEY = 'health.calorieWeek.v1';

/**
 * Monday-first, matching the donor's `fullDayNames` and every calendar surface
 * in the app. The WIRE is Sunday-indexed (`health-service.ts` reads
 * `getUTCDay()` into `[sunday, monday, …]`), so the mapping is explicit here
 * and nowhere else — an off-by-one on this list would move somebody's rest-day
 * target onto their training day without anything looking wrong.
 */
export const CALORIE_WEEK_DAYS = [
  { key: 'monday_calories', label: 'Monday', short: 'Mon' },
  { key: 'tuesday_calories', label: 'Tuesday', short: 'Tue' },
  { key: 'wednesday_calories', label: 'Wednesday', short: 'Wed' },
  { key: 'thursday_calories', label: 'Thursday', short: 'Thu' },
  { key: 'friday_calories', label: 'Friday', short: 'Fri' },
  { key: 'saturday_calories', label: 'Saturday', short: 'Sat' },
  { key: 'sunday_calories', label: 'Sunday', short: 'Sun' },
] as const;

export type CalorieWeekDayKey = (typeof CALORIE_WEEK_DAYS)[number]['key'];

export interface CalorieWeek {
  /** When false the single `daily_calories` target applies to every day. */
  usePerDay: boolean;
  /** Seven targets, Monday-first. `null` = "use the single daily target". */
  days: (number | null)[];
}

export const EMPTY_CALORIE_WEEK: CalorieWeek = {
  usePerDay: false,
  days: [null, null, null, null, null, null, null],
};

/** The route's own bounds (`backend/src/routes/health.ts` `/goals` zod). */
export const CALORIE_MIN = 500;
export const CALORIE_MAX = 10000;
export const MACRO_GRAMS_MAX = 2000;
export const STEPS_MAX = 200000;
export const WORKOUT_MINUTES_MAX = 1440;
/** `clampTarget` in `healthLocalStorage` caps cups at 30; 20 L caps the wire. */
export const WATER_CUPS_MAX = 30;

function calorieOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= CALORIE_MIN && rounded <= CALORIE_MAX ? rounded : null;
}

async function fetchCalorieWeek(): Promise<CalorieWeek> {
  const { goal } = await healthApi.getGoal();
  if (!goal) return EMPTY_CALORIE_WEEK;
  return {
    usePerDay: goal.use_per_day_calories === true,
    days: CALORIE_WEEK_DAYS.map((day) => calorieOrNull(goal[day.key])),
  };
}

export async function loadCalorieWeek(): Promise<CalorieWeek> {
  const stored = await readThrough(HEALTH_CALORIE_WEEK_KEY, fetchCalorieWeek, EMPTY_CALORIE_WEEK);
  const days = Array.isArray(stored.days) ? stored.days : EMPTY_CALORIE_WEEK.days;
  return {
    usePerDay: stored.usePerDay === true,
    // Pad rather than trust the length: a snapshot written by an older build
    // would otherwise index `undefined` into a numeric field on render.
    days: CALORIE_WEEK_DAYS.map((_, index) => calorieOrNull(days[index])),
  };
}

/**
 * Save the per-weekday plan.
 *
 * Every one of the seven keys is sent on every save, `null` included — the
 * server merges a partial patch, so omitting a day would silently keep an old
 * target the member has just cleared.
 */
export async function saveCalorieWeek(week: CalorieWeek): Promise<CalorieWeek> {
  const clean: CalorieWeek = {
    usePerDay: week.usePerDay === true,
    days: CALORIE_WEEK_DAYS.map((_, index) => calorieOrNull(week.days[index])),
  };

  // Spelled out rather than built in a loop: the seven keys are the wire
  // contract, and a loop over `CALORIE_WEEK_DAYS` would type each assignment as
  // the intersection of all seven optional fields (i.e. `undefined`), so the
  // compiler would stop checking exactly the thing worth checking.
  const body: Partial<HealthGoal> = {
    use_per_day_calories: clean.usePerDay,
    monday_calories: clean.days[0],
    tuesday_calories: clean.days[1],
    wednesday_calories: clean.days[2],
    thursday_calories: clean.days[3],
    friday_calories: clean.days[4],
    saturday_calories: clean.days[5],
    sunday_calories: clean.days[6],
  };

  return writeThrough(
    HEALTH_CALORIE_WEEK_KEY,
    () => healthApi.saveGoal(body),
    async () => clean,
    clean,
    `perDay=${clean.usePerDay}`,
    // `health_goals` is shared with the weight goal, water target and activity
    // goals — see `enqueueHealthChange`'s merge-at-handle behaviour, which is
    // what keeps this write from dropping one of theirs.
    { queue: { collection: 'health_goals', row: { ...body, effective_date: todayDateKey() } } }
  );
}

/**
 * Seed all seven days from the single daily target.
 *
 * The donor does this the moment the "By day of week" switch is turned on, so
 * the member edits from where they already are rather than from a blank grid.
 */
export function seedCalorieWeek(week: CalorieWeek, dailyCalories: number): CalorieWeek {
  const seed = calorieOrNull(dailyCalories);
  return {
    ...week,
    days: week.days.map((value) => value ?? seed),
  };
}

/** Set every day to one value — the donor's "Quick Set All Days". */
export function setEveryCalorieDay(week: CalorieWeek, value: number): CalorieWeek {
  const clean = calorieOrNull(value);
  return { ...week, days: week.days.map(() => clean) };
}

/**
 * Mean of the seven targets, with the single daily target standing in for any
 * day the member left unset — the donor's `weeklyAverageCalories`.
 */
export function weeklyAverageCalories(week: CalorieWeek, dailyCalories: number): number {
  const fallback = calorieOrNull(dailyCalories) ?? DEFAULT_NUTRITION_GOALS.calories;
  const total = week.days.reduce<number>((sum, value) => sum + (value ?? fallback), 0);
  return Math.round(total / CALORIE_WEEK_DAYS.length);
}

/** Which weekday index (Monday-first) a `YYYY-MM-DD` day key falls on. */
export function weekdayIndexOf(dateKey: string): number {
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  // getUTCDay: 0 = Sunday. Monday-first index: Sunday → 6, Monday → 0.
  return (day + 6) % 7;
}

/* ------------------------------------------------------------------ */
/* Macros — kcal, share, and the donor's rebalance                     */
/* ------------------------------------------------------------------ */

export const KCAL_PER_GRAM = { protein: 4, carbs: 4, fat: 9 } as const;

export type MacroKey = keyof typeof KCAL_PER_GRAM;

export const MACRO_LABELS: Record<MacroKey, string> = {
  protein: 'Protein',
  carbs: 'Carbs',
  fat: 'Fats',
};

export interface MacroSplit {
  /** kcal contributed by each macro at the current gram targets. */
  calories: Record<MacroKey, number>;
  /** Share of the CALORIE TARGET, 0…1 each — they need not sum to 1. */
  share: Record<MacroKey, number>;
  /** Total macro kcal. */
  total: number;
  /** `total − calorie target`; positive means the macros overshoot. */
  difference: number;
}

/**
 * What the three gram targets actually add up to.
 *
 * The donor prints this as a stacked bar plus a `±N kcal` chip whenever the
 * macros disagree with the calorie target by more than 50 kcal. Reproduced,
 * because macros and calories are stored independently: nothing on either side
 * of the wire forces them to agree, and a member who edits one without the
 * other is otherwise never told.
 */
export function macroSplit(goals: NutritionGoals): MacroSplit {
  const calories: Record<MacroKey, number> = {
    protein: Math.round(goals.protein * KCAL_PER_GRAM.protein),
    carbs: Math.round(goals.carbs * KCAL_PER_GRAM.carbs),
    fat: Math.round(goals.fat * KCAL_PER_GRAM.fat),
  };
  const total = calories.protein + calories.carbs + calories.fat;
  const target = goals.calories > 0 ? goals.calories : 1;
  return {
    calories,
    share: {
      protein: calories.protein / target,
      carbs: calories.carbs / target,
      fat: calories.fat / target,
    },
    total,
    difference: total - goals.calories,
  };
}

/** The donor's own threshold for calling the difference out (`abs > 50`). */
export const MACRO_DIFFERENCE_TOLERANCE = 50;

/**
 * Re-split the OTHER two macros so all three land on the calorie target —
 * the donor's `updateProteinWithRebalance` / `Carbs` / `Fats`, verbatim in
 * behaviour: the two untouched macros keep their current calorie RATIO and
 * share whatever is left, falling back to a 60/40 split when both are zero.
 *
 * Grams are rounded at the end, never per step, so the three rounded figures
 * stay within a gram of the target rather than compounding.
 */
export function rebalanceMacros(goals: NutritionGoals, anchor: MacroKey): NutritionGoals {
  const others = (Object.keys(KCAL_PER_GRAM) as MacroKey[]).filter((key) => key !== anchor);
  const [first, second] = others;

  const anchorCalories = goals[anchor] * KCAL_PER_GRAM[anchor];
  const remaining = Math.max(0, goals.calories - anchorCalories);

  const firstNow = goals[first] * KCAL_PER_GRAM[first];
  const secondNow = goals[second] * KCAL_PER_GRAM[second];
  const currentTotal = firstNow + secondNow;
  // The donor's default when the other two are both zero — otherwise the split
  // would be 0/0 and every remaining calorie would land on one macro.
  const firstRatio = currentTotal > 0 ? firstNow / currentTotal : 0.6;

  const next = { ...goals };
  next[first] = Math.round((remaining * firstRatio) / KCAL_PER_GRAM[first]);
  next[second] = Math.round((remaining * (1 - firstRatio)) / KCAL_PER_GRAM[second]);
  return next;
}

/**
 * Grams a macro needs to hit one SHARE of the calorie target — the inverse of
 * `macroSplit`'s `share`. Powers the onboarding nutrition step's percent entry
 * mode: the donor has no such mode, but MyFitnessPal and Cronometer both let a
 * macro be set as either grams or a percentage of the calorie target, so this
 * mirrors an established convention rather than inventing a third one.
 */
export function macroGramsFromPercent(percent: number, calories: number, macro: MacroKey): number {
  const kcalShare = Math.max(0, calories) * (Math.max(0, percent) / 100);
  return Math.round(kcalShare / KCAL_PER_GRAM[macro]);
}

export interface MacroPercentPreset {
  key: string;
  label: string;
  percents: Record<MacroKey, number>;
  /** Short, member-facing "who reaches for this split" line — not medical advice. */
  goodFor: string;
}

/**
 * Common splits offered as one tap in percent mode — the same handful of
 * presets MyFitnessPal, Cronometer and Lose It! all reach for. Each sums to
 * exactly 100. None is arbitrary; each maps to a real reference point, not a
 * house-invented number (see `MACRO_PRESET_INFO` in `HealthGoalsNutritionScreen`
 * for the member-facing version of this):
 *
 * - The U.S. Acceptable Macronutrient Distribution Range (AMDR) — Institute
 *   of Medicine, "Dietary Reference Intakes for Energy, Carbohydrate, Fiber,
 *   Fat, Fatty Acids, Cholesterol, Protein, and Amino Acids" (2005), carried
 *   into the Dietary Guidelines for Americans — sets protein 10–35%, carbs
 *   45–65%, fat 20–35% of calories for adults.
 * - Feinman et al., "Dietary carbohydrate restriction as the first approach
 *   in diabetes management" (Nutrition, 2015) — the expert-consensus paper
 *   most low-carb clinical studies cite — defines a low-carbohydrate diet as
 *   under 26% of calories from carbs (and under 10% as "very low-carb").
 * - Jäger et al., "ISSN position stand: protein and exercise" (J Int Soc
 *   Sports Nutrition, 2017) — supports protein intakes above the AMDR
 *   ceiling for people who strength-train.
 *
 * `balanced` (30/40/30): protein and fat both sit inside the AMDR; carbs at
 * 40% sit just under its 45% floor — the common "moderate-carb" tilt nearly
 * every macro-tracking app defaults to.
 * `lowCarb` (40/20/40): carbs at 20% clear Feinman's <26% low-carb bar;
 * protein and fat both rise above the AMDR's 35% ceiling to cover the
 * calories carbs would otherwise fill.
 * Each preset's `goodFor` is the same reasoning compressed into a "who reaches
 * for this" line for the chip/sheet UI — not a medical recommendation.
 *
 * `highProtein` (40/35/25): protein at 40% sits above the AMDR ceiling, in
 * line with the ISSN stand for people who strength-train; fat at 25% stays
 * inside the AMDR, carbs make up the remainder.
 */
export const MACRO_PERCENT_PRESETS: MacroPercentPreset[] = [
  {
    key: 'balanced',
    label: 'Balanced',
    percents: { protein: 30, carbs: 40, fat: 30 },
    goodFor: 'General health, maintaining weight',
  },
  {
    key: 'lowCarb',
    label: 'Low-carb',
    percents: { protein: 40, carbs: 20, fat: 40 },
    goodFor: 'Losing weight, lower-carb eating',
  },
  {
    key: 'highProtein',
    label: 'High-protein',
    percents: { protein: 40, carbs: 35, fat: 25 },
    goodFor: 'Building muscle, strength training',
  },
];

/* ------------------------------------------------------------------ */
/* Per-weekday macro plan (0139) — protein/carbs/fat sibling of the    */
/* per-weekday calorie plan above                                      */
/* ------------------------------------------------------------------ */

/**
 * Cached per-weekday macro plan. Same cache-on-sign-out contract as
 * `HEALTH_CALORIE_WEEK_KEY` — see `healthCacheKeys.ts`.
 */
export const HEALTH_MACRO_WEEK_KEY = 'health.macroWeek.v1';

/**
 * Monday-first day labels, reusing `CALORIE_WEEK_DAYS`'s own labels/order so
 * the two week pickers never drift apart. Wire keys are spelled out below
 * (`${day}_protein_grams` etc.) rather than derived from this list — same
 * reasoning `saveCalorieWeek` gives for its own seven-key literal: deriving
 * them would type each assignment as the intersection of all keys, and the
 * compiler would stop checking the one thing worth checking.
 */
export const MACRO_WEEK_DAYS = CALORIE_WEEK_DAYS.map((day) => ({
  label: day.label,
  short: day.short,
}));

export interface MacroDayTargets {
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

export interface MacroWeek {
  /** When false the single flat macro targets apply to every day. */
  usePerDay: boolean;
  /** Seven targets, Monday-first. A null field = "use the single daily target". */
  days: MacroDayTargets[];
}

export const EMPTY_MACRO_WEEK: MacroWeek = {
  usePerDay: false,
  days: [0, 1, 2, 3, 4, 5, 6].map(() => ({ protein: null, carbs: null, fat: null })),
};

function macroGramOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= 0 && rounded <= MACRO_GRAMS_MAX ? rounded : null;
}

function macroDayFromGoal(
  protein: number | null | undefined,
  carbs: number | null | undefined,
  fat: number | null | undefined
): MacroDayTargets {
  return {
    protein: macroGramOrNull(protein),
    carbs: macroGramOrNull(carbs),
    fat: macroGramOrNull(fat),
  };
}

async function fetchMacroWeek(): Promise<MacroWeek> {
  const { goal } = await healthApi.getGoal();
  if (!goal) return EMPTY_MACRO_WEEK;
  return {
    usePerDay: goal.use_per_day_macros === true,
    days: [
      macroDayFromGoal(goal.monday_protein_grams, goal.monday_carbs_grams, goal.monday_fats_grams),
      macroDayFromGoal(goal.tuesday_protein_grams, goal.tuesday_carbs_grams, goal.tuesday_fats_grams),
      macroDayFromGoal(
        goal.wednesday_protein_grams,
        goal.wednesday_carbs_grams,
        goal.wednesday_fats_grams
      ),
      macroDayFromGoal(goal.thursday_protein_grams, goal.thursday_carbs_grams, goal.thursday_fats_grams),
      macroDayFromGoal(goal.friday_protein_grams, goal.friday_carbs_grams, goal.friday_fats_grams),
      macroDayFromGoal(
        goal.saturday_protein_grams,
        goal.saturday_carbs_grams,
        goal.saturday_fats_grams
      ),
      macroDayFromGoal(goal.sunday_protein_grams, goal.sunday_carbs_grams, goal.sunday_fats_grams),
    ],
  };
}

export async function loadMacroWeek(): Promise<MacroWeek> {
  const stored = await readThrough(HEALTH_MACRO_WEEK_KEY, fetchMacroWeek, EMPTY_MACRO_WEEK);
  const days = Array.isArray(stored.days) ? stored.days : EMPTY_MACRO_WEEK.days;
  return {
    usePerDay: stored.usePerDay === true,
    // Pad rather than trust the length: a snapshot written by an older build
    // would otherwise index `undefined` into a numeric field on render, same
    // reasoning `loadCalorieWeek` gives for its own padding.
    days: EMPTY_MACRO_WEEK.days.map((_, index) => {
      const day = days[index];
      return {
        protein: macroGramOrNull(day?.protein),
        carbs: macroGramOrNull(day?.carbs),
        fat: macroGramOrNull(day?.fat),
      };
    }),
  };
}

/**
 * Save the per-weekday macro plan.
 *
 * Every one of the 21 gram keys is sent on every save, `null` included — the
 * server merges a partial patch, so omitting a day would silently keep an old
 * target the member has just cleared. Spelled out rather than built in a
 * loop, same reasoning as `saveCalorieWeek`.
 */
export async function saveMacroWeek(week: MacroWeek): Promise<MacroWeek> {
  const cleanDay = (day: MacroDayTargets | undefined): MacroDayTargets => ({
    protein: macroGramOrNull(day?.protein),
    carbs: macroGramOrNull(day?.carbs),
    fat: macroGramOrNull(day?.fat),
  });
  const [monday, tuesday, wednesday, thursday, friday, saturday, sunday] = [
    0, 1, 2, 3, 4, 5, 6,
  ].map((index) => cleanDay(week.days[index]));

  const clean: MacroWeek = {
    usePerDay: week.usePerDay === true,
    days: [monday, tuesday, wednesday, thursday, friday, saturday, sunday],
  };

  const body: Partial<HealthGoal> = {
    use_per_day_macros: clean.usePerDay,
    monday_protein_grams: monday.protein,
    monday_carbs_grams: monday.carbs,
    monday_fats_grams: monday.fat,
    tuesday_protein_grams: tuesday.protein,
    tuesday_carbs_grams: tuesday.carbs,
    tuesday_fats_grams: tuesday.fat,
    wednesday_protein_grams: wednesday.protein,
    wednesday_carbs_grams: wednesday.carbs,
    wednesday_fats_grams: wednesday.fat,
    thursday_protein_grams: thursday.protein,
    thursday_carbs_grams: thursday.carbs,
    thursday_fats_grams: thursday.fat,
    friday_protein_grams: friday.protein,
    friday_carbs_grams: friday.carbs,
    friday_fats_grams: friday.fat,
    saturday_protein_grams: saturday.protein,
    saturday_carbs_grams: saturday.carbs,
    saturday_fats_grams: saturday.fat,
    sunday_protein_grams: sunday.protein,
    sunday_carbs_grams: sunday.carbs,
    sunday_fats_grams: sunday.fat,
  };

  return writeThrough(
    HEALTH_MACRO_WEEK_KEY,
    () => healthApi.saveGoal(body),
    async () => clean,
    clean,
    `perDay=${clean.usePerDay}`,
    // `health_goals` is shared with the calorie week, weight goal, water
    // target and activity goals — same merge-at-handle reasoning
    // `saveCalorieWeek` documents for its own queued write.
    { queue: { collection: 'health_goals', row: { ...body, effective_date: todayDateKey() } } }
  );
}

/**
 * Seed every day left unset from the flat macro targets — mirrors
 * `seedCalorieWeek`'s "start from where you already are" behaviour, applied
 * the moment the per-weekday switch is turned on.
 */
export function seedMacroWeek(week: MacroWeek, flat: MacroDayTargets): MacroWeek {
  return {
    ...week,
    days: week.days.map((day) => ({
      protein: day.protein ?? flat.protein,
      carbs: day.carbs ?? flat.carbs,
      fat: day.fat ?? flat.fat,
    })),
  };
}

/** Fan one day's split across the rest of the week — "same as Monday every day". */
export function copyMacroDayToAll(week: MacroWeek, sourceIndex: number): MacroWeek {
  const source = week.days[sourceIndex];
  if (!source) return week;
  return { ...week, days: week.days.map(() => ({ ...source })) };
}

/* ------------------------------------------------------------------ */
/* Suggested targets — the donor's GoalCalculator                      */
/* ------------------------------------------------------------------ */

export interface SuggestionInputs {
  weightKg: number | null;
  heightCm: number | null;
  age: number | null;
  gender: WeightGoal['gender'];
  activityLevel: WeightGoal['activityLevel'];
  goalType: WeightGoal['goalType'];
}

export interface SuggestedGoals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  steps: number;
  minutes: number;
  waterCups: number;
  /** Shown alongside so the member can see where the calorie figure came from. */
  bmr: number;
  tdee: number;
}

/**
 * Which inputs are missing, in the words the screen shows.
 *
 * The donor DEFAULTS every one of these (70 kg, 170 cm, 30 years, "other") and
 * presents the result as a personalised calculation — a number that looks
 * measured but describes nobody. This refuses instead, and names what to fill
 * in, because a fabricated BMR is worse than no BMR.
 */
export function missingSuggestionInputs(inputs: SuggestionInputs): string[] {
  const missing: string[] = [];
  if (!isPositive(inputs.weightKg)) missing.push('a weight reading');
  if (!isPositive(inputs.heightCm)) missing.push('your height');
  if (inputs.age === null) missing.push('your birth year');
  if (!inputs.gender) missing.push('your sex');
  if (!inputs.activityLevel) missing.push('your activity level');
  return missing;
}

function isPositive(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Donor `WeightGoalType.calorieAdjustment`. Exported so the onboarding
 * "Daily calories" info sheet can quote the SAME percentages it applies,
 * rather than a copy that can drift — the -20%/+15% happen to also sit
 * inside the ranges NIH/NHLBI (500–1,000 kcal/day deficit) and Iraki et al.
 * 2019 (10–20% surplus) cite as evidence-based, which the info sheet links.
 */
export const GOAL_CALORIE_ADJUSTMENT = { lose: -0.2, maintain: 0, gain: 0.15 } as const;

/** Donor `calculateDailyProtein` — g per kg by activity level. */
const PROTEIN_PER_KG: Record<keyof typeof ACTIVITY_MULTIPLIERS, number> = {
  sedentary: 0.8,
  lightlyActive: 1.0,
  moderatelyActive: 1.2,
  veryActive: 1.6,
  extraActive: 1.8,
};

/** Donor `calculateDailyProtein` — the weight-goal multiplier on top. */
const PROTEIN_GOAL_MULTIPLIER = { lose: 1.25, maintain: 1.0, gain: 1.1 } as const;

/** Donor `calculateMacros` — fat as a share of the calorie target. */
const FAT_SHARE = { lose: 0.25, maintain: 0.3, gain: 0.25 } as const;

/**
 * Donor `calculateDailyWater` — ml per kg by activity level. Exported so the
 * Water onboarding step's "Suggested for you" info sheet can show the SAME
 * table it applies — the 30–35 ml/kg baseline sits inside EFSA's adult
 * Adequate Intake for water, with the two most active bands raised above it
 * for extra activity-driven fluid loss.
 */
export const WATER_ML_PER_KG: Record<keyof typeof ACTIVITY_MULTIPLIERS, number> = {
  sedentary: 30,
  lightlyActive: 33,
  moderatelyActive: 35,
  veryActive: 40,
  extraActive: 45,
};

/**
 * Donor `calculateDailySteps`. Exported so the onboarding activity-level
 * picker can show the same figures as a self-assessment hint — one source
 * of truth for "what does this level actually mean in steps".
 */
export const STEPS_BY_LEVEL: Record<keyof typeof ACTIVITY_MULTIPLIERS, number> = {
  sedentary: 6000,
  lightlyActive: 8000,
  moderatelyActive: 10000,
  veryActive: 12000,
  extraActive: 15000,
};

/** Donor `calculateDailyWorkoutMinutes` (WHO 150–300 min/week, spread daily). */
export const MINUTES_BY_LEVEL: Record<keyof typeof ACTIVITY_MULTIPLIERS, number> = {
  sedentary: 20,
  lightlyActive: 30,
  moderatelyActive: 45,
  veryActive: 60,
  extraActive: 90,
};

/**
 * The donor's `GoalCalculator.calculateGoals`, formula for formula.
 *
 * BMR and TDEE are NOT recomputed here — they come from `healthWeightAnalytics`,
 * which the Weight tab already renders. Two implementations of Mifflin–St Jeor
 * in one app is two BMRs that can disagree, and the member would have no way to
 * tell which screen was lying.
 *
 * Returns `null` when anything it needs is missing; see
 * `missingSuggestionInputs`.
 */
export function suggestGoals(inputs: SuggestionInputs): SuggestedGoals | null {
  if (missingSuggestionInputs(inputs).length > 0) return null;

  const weightKg = inputs.weightKg as number;
  const level = inputs.activityLevel as keyof typeof ACTIVITY_MULTIPLIERS;
  const goalType = inputs.goalType ?? 'maintain';

  const bmr = bmrFor({
    weightKg,
    heightCm: inputs.heightCm,
    age: inputs.age,
    gender: inputs.gender,
  });
  const tdee = tdeeFor(bmr, level);
  if (bmr === null || tdee === null) return null;

  // The donor's 1,200 kcal floor. It is a safety bound, not a preference: below
  // it a target stops being a diet and starts being a medical question.
  const calories = Math.max(1200, Math.round(tdee * (1 + GOAL_CALORIE_ADJUSTMENT[goalType])));
  const protein = Math.round(
    weightKg * PROTEIN_PER_KG[level] * PROTEIN_GOAL_MULTIPLIER[goalType]
  );
  const fatCalories = calories * FAT_SHARE[goalType];
  const fat = Math.round(fatCalories / KCAL_PER_GRAM.fat);
  const carbs = Math.round(
    Math.max(100, (calories - protein * KCAL_PER_GRAM.protein - fatCalories) / KCAL_PER_GRAM.carbs)
  );
  // Donor rounds water to the nearest 100 ml; we then express it in the cups
  // the rest of the app counts in, so the suggestion is in the member's units.
  const waterMl = Math.round((weightKg * WATER_ML_PER_KG[level]) / 100) * 100;

  return {
    calories: Math.min(CALORIE_MAX, Math.max(CALORIE_MIN, calories)),
    protein: Math.min(MACRO_GRAMS_MAX, protein),
    carbs: Math.min(MACRO_GRAMS_MAX, carbs),
    fat: Math.min(MACRO_GRAMS_MAX, fat),
    steps: STEPS_BY_LEVEL[level],
    minutes: MINUTES_BY_LEVEL[level],
    waterCups: Math.max(1, Math.min(WATER_CUPS_MAX, Math.round(waterMl / CUP_ML))),
    bmr,
    tdee,
  };
}

/* ------------------------------------------------------------------ */
/* One read for the whole screen                                       */
/* ------------------------------------------------------------------ */

export interface HealthGoalsSnapshot {
  nutrition: NutritionGoals;
  activity: ActivityGoals;
  /** Water target in CUPS — the unit Home and Nutrition count in. */
  waterCups: number;
  calorieWeek: CalorieWeek;
  macroWeek: MacroWeek;
  weight: WeightGoal;
  /** Display unit for every weight figure on the screen. */
  unit: WeightUnit;
  /** Most recent logged weight, converted to canonical kg (null when none). */
  currentWeightKg: number | null;
  /** Today's `YYYY-MM-DD`, so age is derived once rather than per render. */
  today: string;
}

export const EMPTY_GOALS_SNAPSHOT: HealthGoalsSnapshot = {
  nutrition: DEFAULT_NUTRITION_GOALS,
  activity: DEFAULT_ACTIVITY_GOALS,
  waterCups: DEFAULT_WATER_TARGET,
  calorieWeek: EMPTY_CALORIE_WEEK,
  macroWeek: EMPTY_MACRO_WEEK,
  weight: EMPTY_WEIGHT_GOAL,
  unit: 'kg',
  currentWeightKg: null,
  // Empty rather than a made-up date: `ageFromBirthYear` reads a non-year as
  // "unknown age" and refuses to derive a BMR from it, which is the correct
  // behaviour for a snapshot that has not loaded yet.
  today: '',
};

/**
 * Everything the Goals screen renders, in one call.
 *
 * Each loader is read-through on its own cache, so an offline open still fills
 * the screen from the last-known snapshot of each slice rather than blanking
 * all of them because one request failed.
 */
export async function loadHealthGoals(): Promise<HealthGoalsSnapshot> {
  const [nutrition, activity, water, calorieWeek, macroWeek, weight, prefs, log] = await Promise.all([
    loadNutritionGoals(),
    loadActivityGoals(),
    loadWaterToday(),
    loadCalorieWeek(),
    loadMacroWeek(),
    loadWeightGoal(),
    loadHealthPrefs(),
    loadWeightLog(),
  ]);

  const latest = latestWeight(log);
  return {
    nutrition,
    activity,
    waterCups: water.target,
    calorieWeek,
    macroWeek,
    weight,
    unit: prefs.preferredUnit,
    // Canonical kilograms: BMR/BMI/TDEE are metric formulas, and a member
    // logging in pounds must get the same answer as one logging in kilos.
    currentWeightKg: latest === null ? null : weightToKg(latest.value, latest.unit),
    today: todayDateKey(),
  };
}

/** Age in whole years from the stored birth YEAR, or null. */
export function ageFor(snapshot: HealthGoalsSnapshot): number | null {
  return ageFromBirthYear(snapshot.weight.birthYear, snapshot.today);
}

/** The suggestion inputs a snapshot carries — assembled once, used twice. */
export function suggestionInputsFor(snapshot: HealthGoalsSnapshot): SuggestionInputs {
  return {
    weightKg: snapshot.currentWeightKg,
    heightCm: snapshot.weight.heightCm,
    age: ageFor(snapshot),
    gender: snapshot.weight.gender,
    activityLevel: snapshot.weight.activityLevel,
    goalType: snapshot.weight.goalType,
  };
}

/* ------------------------------------------------------------------ */
/* Input parsing + validation                                          */
/* ------------------------------------------------------------------ */

/**
 * Digits only, for the whole-number fields (calories, grams, steps, minutes,
 * cups). `keyboardType` is a HINT on both platforms — a hardware keyboard,
 * paste, autofill or UI automation all deliver letters regardless — so the
 * value is stripped here rather than trusted.
 */
export function sanitizeWholeNumber(raw: string): string {
  return typeof raw === 'string' ? raw.replace(/[^0-9]/g, '').slice(0, 7) : '';
}

export function parseWholeNumber(raw: string): number | null {
  const digits = sanitizeWholeNumber(raw);
  if (digits.length === 0) return null;
  // `digits` is 1-7 characters of `[0-9]` only (see `sanitizeWholeNumber`), so
  // `Number(digits)` is always a finite non-negative integer — no `NaN` guard
  // needed on this side.
  return Number(digits);
}

/** Digits and dashes only, `YYYY-MM-DD` length — the baseline date field. */
export function sanitizeDayKey(raw: string): string {
  return typeof raw === 'string' ? raw.replace(/[^0-9-]/g, '').slice(0, 10) : '';
}

/**
 * Parse the baseline date. Blank is VALID and means "no explicit date" —
 * `saveWeightGoal` then stamps today, which is the behaviour the Weight tab
 * already has.
 *
 * The round-trip check is load-bearing: V8 ROLLS an out-of-range day over
 * rather than failing, so `2026-02-30` would parse happily as 2 March and the
 * baseline would sit on a day the member never chose.
 */
export function parseDayKey(raw: string): { valid: boolean; date: string | null } {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) return { valid: true, date: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return { valid: false, date: null };
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return { valid: false, date: null };
  if (parsed.toISOString().slice(0, 10) !== trimmed) return { valid: false, date: null };
  // A baseline in the future would make every progress figure negative.
  if (trimmed > todayDateKey()) return { valid: false, date: null };
  return { valid: true, date: trimmed };
}

export const BASELINE_DATE_MESSAGE =
  'Use a real past date in YYYY-MM-DD form, or leave it blank to use today.';

export interface GoalFieldBound {
  min: number;
  max: number;
  /** Sentence shown when the value falls outside — never a raw error string. */
  message: string;
}

/**
 * The bounds the WORKER enforces, restated on the device.
 *
 * These are not belt-and-braces. `writeThrough` swallows a failed write into
 * the offline path and keeps the optimistic value in the cache, so a 400 from
 * the route would leave the screen showing a target that will never persist.
 * Refusing on the device is what keeps "saved" honest.
 */
export type GoalBoundKey = 'calories' | 'macroGrams' | 'macroPercent' | 'steps' | 'minutes' | 'waterCups';

export const GOAL_BOUNDS: Record<GoalBoundKey, GoalFieldBound> = {
  calories: {
    min: CALORIE_MIN,
    max: CALORIE_MAX,
    message: `Daily calories must be between ${CALORIE_MIN} and ${CALORIE_MAX.toLocaleString()} kcal.`,
  },
  // The floors below are 1, not 0, even though the ROUTE accepts 0. That is not
  // a stricter opinion about what a goal should be — it is what the storage
  // layer can actually keep: `clampGoal` in `healthNutritionStorage` and
  // `healthActivityStorage` treats `<= 0` as "no value" and substitutes the
  // DEFAULT, so a member who set fats to 0 would be handed 65 g back without
  // being told. Refusing here is the honest half of that.
  macroGrams: {
    min: 1,
    max: MACRO_GRAMS_MAX,
    message: `Each macro target must be between 1 and ${MACRO_GRAMS_MAX.toLocaleString()} g.`,
  },
  // Percent mode's own bound — 0-100, since "0% of calories" is a real (if
  // unusual) answer for a macro, unlike the gram field's 1 g floor above.
  macroPercent: {
    min: 0,
    max: 100,
    message: 'Each macro share must be between 0 and 100% of your calorie target.',
  },
  steps: {
    min: 1,
    max: STEPS_MAX,
    message: `A daily step target must be between 1 and ${STEPS_MAX.toLocaleString()}.`,
  },
  minutes: {
    min: 1,
    max: WORKOUT_MINUTES_MAX,
    message: `Movement minutes must be between 1 and ${WORKOUT_MINUTES_MAX.toLocaleString()} a day.`,
  },
  waterCups: {
    min: 1,
    max: WATER_CUPS_MAX,
    message: `A water target must be between 1 and ${WATER_CUPS_MAX} cups a day.`,
  },
};

/** `null` when the value is acceptable, otherwise the sentence to show. */
export function checkBound(value: number | null, bound: GoalFieldBound): string | null {
  if (value === null) return bound.message;
  return value >= bound.min && value <= bound.max ? null : bound.message;
}

/** Friendly copy for a failed save — never the underlying error. */
export const GOAL_SAVE_FAILED_MESSAGE =
  'Saved on this device. We could not reach the server, so this target will sync next time you are online.';

export const GOAL_SAVED_MESSAGE = 'Targets updated.';
