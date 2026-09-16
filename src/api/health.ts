import { createHealthLocalProxy } from '@features/health/local/localApiProxy';

import { apiClient } from './client';

/**
 * Symply Health API client — the ported donor health domain (parity P1).
 *
 * Base path: `/health` on the `symply-health-api` Worker. Every row is scoped to
 * the authenticated USER (health data is personal, never household-shared), and
 * the whole surface 404s on any other brand's Worker via `requireHealthApi()`.
 *
 * THIN CLIENT: summaries, statistics, streaks and cycle predictions are computed
 * server-side so the phone, widget and watch can never disagree. Envelopes here
 * mirror `backend/src/routes/health.ts` EXACTLY — change both together.
 *
 * NOTE — envelope shape. These call `apiClient` DIRECTLY (as `src/api/savings.ts`
 * does) rather than the `api.get/post` helpers in `client.ts`. Those helpers type
 * the body as `ApiResponse<T>` (`{ data: T }`), but this Worker returns the bare
 * object — `c.json({ entries })` — with no wrapping middleware. Going through the
 * helper made every read resolve `undefined` against the live server while unit
 * tests passed, because their fixtures wrapped. The body IS the payload.
 */

/* ============================ Row shapes ============================ */

export type HealthWeightUnit = 'kg' | 'lb' | 'lbs';
export type HealthMealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type HealthEntryType = 'steps' | 'workout' | 'sleep' | 'heart_rate' | 'active_energy';
export type HealthMeasurementUnit = 'cm' | 'in' | 'inches';

export interface HealthWeightEntry {
  id: string;
  user_id: string;
  date: string;
  weight: number;
  unit: HealthWeightUnit;
  note: string | null;
  /**
   * Where the reading came from (0122). `'manual'` on every row written before
   * the column existed, which is honest — no import path had ever run.
   *
   * The UI must distinguish the two: an imported reading is a claim by another
   * device, and a member who sees an unexplained number needs to be able to
   * tell it apart from one they typed before deciding whether to correct it.
   * OPTIONAL on the type because a Worker older than 0122 omits the key.
   */
  source?: 'manual' | 'healthkit';
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface HealthWaterEntry {
  id: string;
  user_id: string;
  date: string;
  amount_ml: number;
  beverage_type: string;
  container: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface HealthNutritionEntry {
  id: string;
  user_id: string;
  date: string;
  food_name: string;
  portion: number;
  unit: string;
  meal_type: HealthMealType;
  calories: number;
  proteins: number;
  carbohydrates: number;
  fats: number;
  /** The library food this row was logged from (0124); null when hand-typed. */
  food_id: string | null;
  /**
   * The per-100 basis a portion change is re-derived from (0124, donor 018).
   * NULL on every row written before 0124 — `reportionNutrition` answers 400
   * `no_basis` for those, and the client offers the typed editor instead.
   */
  base_calories_per_100: number | null;
  base_proteins_per_100: number | null;
  base_carbs_per_100: number | null;
  base_fats_per_100: number | null;
  /**
   * Where the row came from. `'manual'` on every row written before this column
   * existed, which is honest — no import path had ever run. OPTIONAL on the type
   * because a Worker older than this column omits the key (same contract as
   * `HealthWeightEntry.source`).
   */
  source?: 'manual' | 'healthkit';
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * One diary row as the CLIENT declares it.
 *
 * Named rather than inlined on `createNutrition` because `/nutrition/entries`
 * and `/nutrition/entries/bulk` share one zod object server-side
 * (`nutritionEntryFields` in `backend/src/routes/health.ts`). Two hand-kept
 * copies of that shape would drift the moment a column is added, and the bulk
 * route would start silently dropping the key the single route accepts.
 */
export interface HealthNutritionEntryPayload {
  date: string;
  food_name: string;
  meal_type: HealthMealType;
  calories: number;
  proteins?: number;
  carbohydrates?: number;
  fats?: number;
  /** How much the macros describe. Sent WITH `unit` or not at all. */
  portion?: number;
  unit?: string;
  /**
   * The library food this came from (0124). The Worker resolves that food's
   * stored `base_*_per_100` and keeps it on the row, which is what makes the
   * portion re-derivable later. 404 if the food is not the caller's.
   */
  food_id?: string;
  /** The HealthKit importer's write verb — omitted ⇒ the route defaults to `'manual'`. */
  source?: 'manual' | 'healthkit';
}

/* ======================= Food challenges (Dashboard parity) ======================= */

/**
 * Donor `ChallengeCategory` (`FoodChallenge.swift`) — 10 fixed categories, the
 * last being a free-text ingredient the member names themselves. Wire values
 * are snake_case to match this file's existing convention (the donor's own raw
 * value for the last case is already `"custom_ingredient"`).
 */
export const HEALTH_CHALLENGE_CATEGORIES = [
  'vegetables',
  'fruits',
  'fish',
  'seafood',
  'meat',
  'dairy',
  'grains',
  'legumes',
  'nuts',
  'custom_ingredient',
] as const;
export type HealthChallengeCategory = (typeof HEALTH_CHALLENGE_CATEGORIES)[number];

/** Donor `ChallengeFrequency` — whether `target_grams` is a per-day or per-week amount. */
export const HEALTH_CHALLENGE_FREQUENCIES = ['daily', 'weekly'] as const;
export type HealthChallengeFrequency = (typeof HEALTH_CHALLENGE_FREQUENCIES)[number];

export interface HealthFoodChallenge {
  id: string;
  user_id: string;
  name: string;
  category: HealthChallengeCategory;
  /** Free-text ingredient name — meaningful when `category` is `custom_ingredient`. */
  target_food_name: string | null;
  /** The amount `frequency` is measured against (per day, or per week). */
  target_grams: number;
  frequency: HealthChallengeFrequency;
  is_active: boolean;
  /** Emoji or icon-kit override; `null` falls back to the category's own icon. */
  icon: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Columns a challenge create/update may set. */
export interface HealthFoodChallengeWrite {
  name: string;
  category: HealthChallengeCategory;
  target_food_name?: string | null;
  target_grams: number;
  frequency: HealthChallengeFrequency;
  is_active?: boolean;
  icon?: string | null;
}

/** One challenge's TODAY reading, as `GET /challenges/progress/today` embeds it. */
export interface HealthChallengeTodayEntry extends HealthFoodChallenge {
  consumed_grams: number;
  today_completed: boolean;
  /** Logged food names the server matched against this challenge today. */
  matched_foods: string[];
  /** Fraction (0..1, uncapped past 1 on an overshoot) — consumed / target. */
  progress_percentage: number;
  remaining_grams: number;
}

export interface HealthChallengeTodayResponse {
  date: string;
  challenges: HealthChallengeTodayEntry[];
  completed_count: number;
  total_count: number;
}

export interface HealthChallengeDailyProgress {
  date: string;
  consumed_grams: number;
  target_grams: number;
  /** Fraction, same scale as `HealthChallengeTodayEntry.progress_percentage`. */
  progress_percentage: number;
  completed: boolean;
}

export interface HealthChallengeWeeklyProgress {
  challenge: HealthFoodChallenge;
  /** 7 entries, oldest first. */
  daily_progress: HealthChallengeDailyProgress[];
  weekly_total_grams: number;
  weekly_target_grams: number;
  /** Fraction (0..1, uncapped past 1 on an overshoot). */
  weekly_progress_percentage: number;
}

/* ======================= Weekly trend summary (Dashboard parity) ======================= */

export interface HealthWeeklyTrendDay {
  date: string;
  calories: number;
  calorie_goal: number;
}

export interface HealthWeeklyTrendWeightPoint {
  date: string;
  weight: number;
}

export interface HealthWeeklyTrendWindow {
  week_start: string;
  week_end: string;
  /** 7 entries, oldest first. */
  days: HealthWeeklyTrendDay[];
  /** 7 slots, oldest first; `null` where nothing was logged that day (a gap, not a zero). */
  daily_weight: Array<HealthWeeklyTrendWeightPoint | null>;
  total_calories: number;
  avg_calories: number;
}

export interface HealthWeeklyTrendChange {
  calories: number | null;
  weight: number | null;
}

export interface HealthWeeklyTrendResponse {
  this_week: HealthWeeklyTrendWindow;
  last_week: HealthWeeklyTrendWindow;
  change: HealthWeeklyTrendChange;
}

export interface HealthMeasurement {
  id: string;
  user_id: string;
  date: string;
  chest: number | null;
  waist: number | null;
  hips: number | null;
  left_arm: number | null;
  right_arm: number | null;
  left_thigh: number | null;
  right_thigh: number | null;
  neck: number | null;
  shoulders: number | null;
  left_calf: number | null;
  right_calf: number | null;
  left_forearm: number | null;
  right_forearm: number | null;
  body_fat_percentage: number | null;
  /*
   * 0131 — the donor's comprehensive sites.
   *
   * OPTIONAL, not `| null`, and that distinction is load-bearing: a Worker that
   * predates 0131 answers WITHOUT these keys, while one that has it answers with
   * an explicit `null` for a site the member never measured. `healthBodyStorage`
   * reads a missing key and a null key the same way (no reading), so nothing
   * downstream has to care — but typing them as required would make every
   * pre-0131 row a type lie.
   */
  left_arm_mid?: number | null;
  right_arm_mid?: number | null;
  left_forearm_mid?: number | null;
  right_forearm_mid?: number | null;
  left_wrist?: number | null;
  right_wrist?: number | null;
  left_thigh_mid?: number | null;
  right_thigh_mid?: number | null;
  left_thigh_lower?: number | null;
  right_thigh_lower?: number | null;
  left_knee?: number | null;
  right_knee?: number | null;
  left_calf_mid?: number | null;
  right_calf_mid?: number | null;
  left_calf_lower?: number | null;
  right_calf_lower?: number | null;
  left_ankle?: number | null;
  right_ankle?: number | null;
  waist_navel?: number | null;
  waist_upper?: number | null;
  waist_lower?: number | null;
  iliac?: number | null;
  chest_upper?: number | null;
  chest_under?: number | null;
  back_width?: number | null;
  torso_length?: number | null;
  inseam?: number | null;
  unit: HealthMeasurementUnit;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * How hard a logged session felt (0124, `health_entries.intensity`).
 *
 * A real column, not a note tag: before it existed the Activity screen wrote
 * intensity into the note as a leading `[hard]` prefix, because the route's zod
 * schema stripped every key it did not name.
 */
export const HEALTH_WORKOUT_INTENSITIES = ['easy', 'steady', 'hard', 'max'] as const;
export type HealthWorkoutIntensity = (typeof HEALTH_WORKOUT_INTENSITIES)[number];

export interface HealthEntry {
  id: string;
  user_id: string;
  date: string;
  entry_type: HealthEntryType;
  /** JSON string — shape depends on `entry_type`. */
  data: string;
  source: 'healthkit' | 'manual';
  /** Workouts only; null = not recorded (and on every pre-0124 row). */
  intensity: HealthWorkoutIntensity | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Payload stored inside a `workout` health entry's `data` blob.
 *
 * `distance_m` and `started_at` join `minutes` / `calories` / `note` in the
 * BLOB rather than becoming columns, because that is where their peers already
 * live: `health_entries.data` is schemaless by design (the donor kept it that
 * way), and every consumer — including `widgetSnapshot`, which sums minutes and
 * calories in JS rather than SQL — reads the payload as a whole. Promoting one
 * of three peer measurements to a column would leave the schema inconsistent
 * for a query nothing makes. `intensity` is a column because it is NOT part of
 * the donor's payload and is filtered on (0124); these two are.
 */
export interface HealthWorkoutPayload {
  workout_type: string;
  minutes: number;
  calories: number;
  note: string;
  /**
   * Distance in METRES — the donor's own unit (`WorkoutEntry.distance`).
   * ABSENT when the session did not record one; never written as `0`, because
   * a zero is a measurement and "not recorded" is not.
   */
  distance_m?: number;
  /**
   * When the session happened, ISO. Distinct from the row's `created_at`, which
   * is when it was WRITTEN — for a back-dated session the two differ by days.
   */
  started_at?: string;
}

/** Donor `HabitFrequency` (`HabitModels.swift`) — stored verbatim on the row. */
export const HEALTH_HABIT_FREQUENCIES = [
  'daily',
  'twice_daily',
  'weekdays',
  'weekends',
  'custom',
] as const;
export type HealthHabitFrequency = (typeof HEALTH_HABIT_FREQUENCIES)[number];

/** Donor `HabitTimeOfDay` — a filter/label, not a schedule. */
export const HEALTH_HABIT_TIMES_OF_DAY = ['morning', 'afternoon', 'evening', 'anytime'] as const;
export type HealthHabitTimeOfDay = (typeof HEALTH_HABIT_TIMES_OF_DAY)[number];

export interface HealthHabit {
  id: string;
  user_id: string;
  name: string;
  icon: string;
  category: string;
  sort_order: number;
  /**
   * The schedule columns. All of these have existed since migration `0119`; the
   * service used to hard-code them, so a Worker that predates the habit-schedule
   * work still ANSWERS them (with the hard-coded defaults) rather than omitting
   * the keys. They are optional here only to keep an older cached snapshot from
   * failing to type-check on rehydrate.
   */
  template_id?: string | null;
  time_of_day?: HealthHabitTimeOfDay;
  frequency?: HealthHabitFrequency;
  /** JSON-decoded weekday numbers, 1 = Sunday … 7 = Saturday (Apple ordering). */
  custom_days?: string | null;
  /** Local wall-clock 'HH:MM'; the Worker resolves the member's own timezone. */
  reminder_time?: string | null;
  reminder_enabled?: boolean;
  target_duration?: number | null;
  notes?: string | null;
  is_archived?: boolean;
  /** Completed day keys, newest-first — server-derived. */
  days: string[];
  /** Server-computed streak; never recomputed on device. */
  streak: number;
  created_at: string;
  updated_at: string;
}

/** Columns a habit create/update may set. Absent = leave, null = clear. */
export interface HealthHabitWrite {
  name?: string;
  icon?: string;
  category?: string;
  template_id?: string | null;
  time_of_day?: HealthHabitTimeOfDay;
  frequency?: HealthHabitFrequency;
  custom_days?: number[] | null;
  reminder_time?: string | null;
  reminder_enabled?: boolean;
  target_duration?: number | null;
  notes?: string | null;
  is_archived?: boolean;
  sort_order?: number;
}

/** Donor `users.activity_level` vocabulary — multiplies BMR into TDEE. */
export const HEALTH_ACTIVITY_LEVELS = [
  'sedentary',
  'lightlyActive',
  'moderatelyActive',
  'veryActive',
  'extraActive',
] as const;
export type HealthActivityLevel = (typeof HEALTH_ACTIVITY_LEVELS)[number];

export type HealthGender = 'male' | 'female' | 'other';
export type HealthWeightGoalType = 'lose' | 'maintain' | 'gain';

export interface HealthGoal {
  id: string;
  user_id: string;
  effective_date: string;
  daily_calories: number;
  use_per_day_calories: boolean;

  /**
   * PER-WEEKDAY calorie targets (donor `goal_history`).
   *
   * The columns shipped in `0119` and `PUT /goals` has always accepted them,
   * but nothing on the device declared or sent them, so the whole feature was
   * dead on arrival: `health-service.ts` `caloriesGoalFor` reads
   * `use_per_day_calories` and switches on `getUTCDay()`, and with every column
   * NULL it falls straight back to `daily_calories`.
   *
   * `null` means "this weekday has no override" and is what CLEARS one; the
   * server's fallback then applies. The wire order is SUNDAY-indexed on the
   * server side — see `CALORIE_WEEK_DAYS` in `healthGoalsStorage.ts`, which is
   * the one place that mapping is written down.
   */
  monday_calories?: number | null;
  tuesday_calories?: number | null;
  wednesday_calories?: number | null;
  thursday_calories?: number | null;
  friday_calories?: number | null;
  saturday_calories?: number | null;
  sunday_calories?: number | null;

  daily_protein_grams: number | null;
  daily_carbs_grams: number | null;
  daily_fats_grams: number | null;

  /**
   * PER-WEEKDAY macro targets (0139) — the protein/carbs/fat sibling of the
   * per-weekday CALORIE targets above. Same contract: `null` clears a day's
   * override and falls back to the flat `daily_*_grams` target; the wire
   * order is Sunday-indexed server-side, mapped in `MACRO_WEEK_DAYS` /
   * `saveMacroWeek` in `healthGoalsStorage.ts`.
   */
  use_per_day_macros?: boolean;
  monday_protein_grams?: number | null;
  monday_carbs_grams?: number | null;
  monday_fats_grams?: number | null;
  tuesday_protein_grams?: number | null;
  tuesday_carbs_grams?: number | null;
  tuesday_fats_grams?: number | null;
  wednesday_protein_grams?: number | null;
  wednesday_carbs_grams?: number | null;
  wednesday_fats_grams?: number | null;
  thursday_protein_grams?: number | null;
  thursday_carbs_grams?: number | null;
  thursday_fats_grams?: number | null;
  friday_protein_grams?: number | null;
  friday_carbs_grams?: number | null;
  friday_fats_grams?: number | null;
  saturday_protein_grams?: number | null;
  saturday_carbs_grams?: number | null;
  saturday_fats_grams?: number | null;
  sunday_protein_grams?: number | null;
  sunday_carbs_grams?: number | null;
  sunday_fats_grams?: number | null;

  daily_water_ml: number | null;
  daily_steps: number | null;
  daily_workout_minutes: number | null;
  daily_sleep_hours: number | null;

  /**
   * The WEIGHT target, its baseline and the biometrics BMI/BMR need (0125).
   *
   * OPTIONAL, not `| null`, and the distinction is load-bearing: a Worker that
   * predates 0125 OMITS these keys entirely, whereas one that has the migration
   * sends an explicit `null` when the member has not set (or has cleared) the
   * value. `healthWeightStorage` reads `undefined` as "this server cannot store
   * a goal yet — keep the cached one" and `null` as "cleared — drop it".
   *
   * Kilograms are canonical here even though `weight_entries.weight` keeps the
   * unit it was typed in. See `backend/migrations/0125_health_weight_goal.sql`.
   */
  target_weight_kg?: number | null;
  weight_goal_type?: HealthWeightGoalType | null;
  starting_weight_kg?: number | null;
  starting_weight_date?: string | null;
  height_cm?: number | null;
  gender?: HealthGender | null;
  /** Whole year (1990) — NOT a date of birth. */
  birth_year?: number | null;
  activity_level?: HealthActivityLevel | null;
  /**
   * The water-goal DISPLAY unit (0140). Same optional-vs-null contract as the
   * biometrics above: OMITTED means this Worker predates 0140 (keep whatever
   * this handset last knew), an explicit `null` means the member has not
   * chosen one (fall back to 'ml'). The AMOUNT stays canonical millilitres on
   * `daily_water_ml` regardless — this field never carries a quantity.
   */
  water_unit?: HealthWaterUnit | null;
  /**
   * The ONE global display-unit switch (0141): 'metric' | 'imperial'.
   * OMITTED means this Worker predates 0141; explicit `null` means the
   * member has not chosen one (fall back to 'metric'). Independent of
   * `water_unit` above — water keeps its own 4-way switcher.
   */
  unit_system?: HealthUnitSystem | null;
}

/** Donor has no oz at all; 'L' and 'cups' are display-only groupings of the same canonical ml. */
export type HealthWaterUnit = 'ml' | 'oz' | 'L' | 'cups';

/** 'metric' → kg + cm + km; 'imperial' → lb + ft/in + mi. */
export type HealthUnitSystem = 'metric' | 'imperial';

export interface HealthCycleSettings {
  id: string;
  user_id: string;
  cycle_length: number;
  period_length: number;
  last_period_start: string | null;
}

export interface HealthPeriodEntry {
  id: string;
  user_id: string;
  date: string;
  /** 1=spotting … 5=very heavy (donor scale). */
  flow_level: number;
  notes: string | null;
  updated_at: string;
  deleted_at: string | null;
}

export interface HealthCycleSymptomEntry {
  id: string;
  user_id: string;
  date: string;
  mood: number | null;
  energy: number | null;
  cramps: number | null;
  headache: number | null;
  bloating: number | null;
  breast_tenderness: number | null;
  back_pain: number | null;
  acne: number | null;
  nausea: number | null;
  anxiety: number | null;
  irritability: number | null;
  sadness: number | null;
  cravings: string | null;
  sleep_quality: number | null;
  libido: number | null;
  notes: string | null;
  updated_at: string;
}

export interface HealthMensEntry {
  id: string;
  user_id: string;
  date: string;
  libido: number | null;
  had_partner_sex: boolean;
  had_masturbation: boolean;
  had_orgasm: boolean;
  overall_satisfaction: number | null;
  had_morning_erection: boolean;
  morning_erection_quality: number | null;
  erection_quality: number | null;
  had_erotic_dream: boolean;
  sexual_desire_level: number | null;
  had_erection_difficulty: boolean;
  had_maintenance_difficulty: boolean;
  had_premature_ejaculation: boolean;
  had_delayed_ejaculation: boolean;
  had_performance_anxiety: boolean;
  had_low_desire: boolean;
  had_pain_or_discomfort: boolean;
  energy_level: number | null;
  mental_clarity: number | null;
  mood: number | null;
  sleep_quality: number | null;
  stress_level: number | null;
  exercised: boolean;
  kegel_sets: number | null;
  notes: string | null;
  updated_at: string;
}

/**
 * Which parts of the Men's Health log the person wants to see.
 *
 * A display preference, not a health record: it decides which cards render, so
 * someone can keep the tracker without being asked, every day, about the things
 * they do not want to think about. The route has shipped since parity P1 with
 * no client at all.
 *
 * `reminder_enabled` / `reminder_time` are columns on the table but there is no
 * Health reminder producer on either end yet, so the RN client neither reads
 * nor writes them — a toggle that schedules nothing would be a lie.
 */
export interface HealthMensSettings {
  id: string;
  user_id: string;
  track_libido: boolean;
  track_sexual_activity: boolean;
  track_sexual_desire: boolean;
  track_night_erection: boolean;
  track_morning_erection: boolean;
  track_day_erection: boolean;
  track_erotic_dreams: boolean;
  track_issues: boolean;
  track_energy: boolean;
  track_kegels: boolean;
  track_exercise: boolean;
  reminder_enabled: boolean;
  reminder_time: string | null;
  updated_at: string;
}

/* ========================== Derived envelopes ========================= */

export interface HealthNutritionTotals {
  calories: number;
  proteins: number;
  carbohydrates: number;
  fats: number;
}

export interface HealthNutritionSummary {
  date: string;
  totals: HealthNutritionTotals;
  by_meal: Record<HealthMealType, HealthNutritionTotals>;
  entry_count: number;
  goal: {
    calories: number;
    proteins: number | null;
    carbohydrates: number | null;
    fats: number | null;
  } | null;
}

export interface HealthWaterSummary {
  date: string;
  total_ml: number;
  goal_ml: number | null;
  entry_count: number;
}

export interface HealthWeightStatistics {
  count: number;
  unit: HealthWeightUnit | null;
  latest: number | null;
  first: number | null;
  change: number | null;
  average: number | null;
  min: number | null;
  max: number | null;
}

export interface HealthWeeklyWeight {
  id: string;
  week_start: string;
  week_end: string;
  average_weight: number;
  min_weight: number | null;
  max_weight: number | null;
  entry_count: number;
  weight_unit: string;
}

/* ========================== Body insights (read) ========================= */

/**
 * One stored body insight — `body_comprehensive_insights`, produced by
 * `POST /health/ai/body-insights/generate` and read back here.
 *
 * READ-ONLY over HTTP by design: there is no client write path, because a device
 * that could POST an "AI analysis" would be indistinguishable from the producer,
 * and these rows read as an assessment of a person's body.
 *
 * ── WHY SO MANY COLUMNS ARE ALWAYS NULL ─────────────────────────────────────
 *
 * The donor fills the score and estimate columns from BODY PHOTOS. Body photos
 * are unported by product decision (privacy — they need their own storage,
 * retention and deletion spec first, UI_PARITY_AUDIT §8), so this app's producer
 * works from logged MEASUREMENTS and leaves every photo-derived figure null ON
 * PURPOSE: `overall_posture_score`, `overall_symmetry_score`,
 * `muscle_balance_score`, the body-fat range and `lean_mass_estimate`. They are
 * typed here because the column exists and a row written by another client would
 * carry them — NOT as an invitation to derive them. A reader must render null as
 * absent and must never compute a substitute.
 *
 * The three fields that DO carry the content are JSON arrays in TEXT columns —
 * see `parseHealthInsightList`.
 */
export interface HealthBodyInsight {
  id: string;
  user_id: string;
  date: string;
  /** JSON array of strings: the observations. */
  strengths: string | null;
  /** JSON array of strings: what logging more of would make readable. */
  areas_of_improvement: string | null;
  /** JSON array of strings: sites with a single reading, so no trend yet. */
  recommended_focus_areas: string | null;
  /** `'symply-health-coach'` when a model wordsmithed it, `'deterministic'` otherwise. */
  analysis_provider: string | null;
  /** Share of model sentences that survived grounding, or null with no model. */
  analysis_confidence: number | null;
  processing_notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** Always null in this app — see the note above. */
  overall_posture_score?: number | null;
  overall_symmetry_score?: number | null;
  muscle_balance_score?: number | null;
  body_fat_estimate_lower?: number | null;
  body_fat_estimate_upper?: number | null;
  body_fat_category?: string | null;
  lean_mass_estimate?: number | null;
  front_photo_id?: string | null;
  back_photo_id?: string | null;
  left_side_photo_id?: string | null;
  right_side_photo_id?: string | null;
}

/**
 * Per-photo analysis (`body_photo_insights`).
 *
 * ALWAYS EMPTY in this app, and that is the correct state rather than a gap:
 * nothing writes these rows because body photos are unported. The reader exists
 * so the route has a caller and so a future photo phase has one place to land,
 * and it must never be used to render a score this app did not derive.
 */
export interface HealthBodyPhotoInsight {
  id: string;
  user_id: string;
  photo_id: string;
  date: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * `strengths` / `areas_of_improvement` / `recommended_focus_areas` are JSON
 * arrays stored in TEXT columns. A corrupt or absent value reads as an empty
 * list — never as a crash on the Body tab, and never as invented prose.
 */
export function parseHealthInsightList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export interface HealthDailySummary {
  date: string;
  nutrition: HealthNutritionSummary;
  water: HealthWaterSummary;
  weight: { value: number; unit: HealthWeightUnit; date: string } | null;
  steps: { value: number; goal: number | null };
}

/**
 * A row from a delta bucket this client does not model precisely.
 *
 * The P2 collections (foods, recipes, injuries, fridge, files) and the
 * singletons (cycle settings, goals, widget + notification preferences) each
 * have their OWN typed client module; re-declaring their row shapes here would
 * give the domain two sources of truth that drift the first time a column lands.
 * The two things every one of them is guaranteed to carry are an `id` and an
 * `updated_at`, which is exactly what the export and the erase path need.
 */
export interface HealthSyncRow {
  id: string;
  updated_at: string;
  /** Present on the collections that tombstone; absent on the singletons. */
  deleted_at?: string | null;
  [column: string]: unknown;
}

export interface HealthSyncDelta {
  since: string;
  server_time: string;
  weight_entries: HealthWeightEntry[];
  water_entries: HealthWaterEntry[];
  nutrition_entries: HealthNutritionEntry[];
  body_measurements: HealthMeasurement[];
  health_entries: HealthEntry[];
  habits: HealthHabit[];
  habit_logs: Array<{ id: string; habit_id: string; date: string; deleted_at: string | null }>;
  period_entries: HealthPeriodEntry[];
  cycle_symptom_entries: HealthCycleSymptomEntry[];
  mens_health_entries: HealthMensEntry[];
  /**
   * The singleton + P2 buckets the pull gained after the original ten.
   *
   * OPTIONAL on the type, and that is not defensive decoration: a Worker built
   * before those buckets were added to `HealthService.sync()` simply omits the
   * keys, and a client that assumed them would export `undefined.length`. Read
   * them with `?? []`.
   */
  cycle_settings?: HealthSyncRow[];
  health_goals?: HealthSyncRow[];
  mens_health_settings?: HealthSyncRow[];
  widget_preferences?: HealthSyncRow[];
  activity_notification_preferences?: HealthSyncRow[];
  custom_foods?: HealthSyncRow[];
  recipes?: HealthSyncRow[];
  injuries?: HealthSyncRow[];
  fridge_items?: HealthSyncRow[];
  user_files?: HealthSyncRow[];
}

/* --------------------------- sync PUSH (write half) --------------------------- */

/** Rows one `POST /health/sync/push` may carry (`MAX_PUSH_ROWS` server-side). */
export const HEALTH_SYNC_PUSH_MAX_ROWS = 500;

/**
 * Collections `POST /health/sync/push` has a writer for, in the server's own
 * order (`PUSH_COLLECTIONS`). A key outside this list comes back in
 * `unsupported` rather than being silently dropped.
 */
export const HEALTH_PUSH_COLLECTIONS = [
  'habits',
  'habit_logs',
  'weight_entries',
  'water_entries',
  'nutrition_entries',
  'body_measurements',
  'health_entries',
  'cycle_settings',
  'period_entries',
  'cycle_symptom_entries',
  'mens_health_entries',
  'health_goals',
] as const;
export type HealthPushCollection = (typeof HEALTH_PUSH_COLLECTIONS)[number];

export type HealthPushStatus =
  | 'applied'
  | 'unchanged'
  | 'stale'
  | 'tombstoned'
  | 'forbidden'
  | 'invalid';

export interface HealthPushRowResult {
  index: number;
  id: string | null;
  server_id: string | null;
  status: HealthPushStatus;
  action?: 'inserted' | 'updated' | 'deleted';
  reason?: string;
  server_updated_at?: string;
}

export interface HealthPushResponse {
  /** Fresh cursor for the next `GET /sync?since=`. */
  server_time: string;
  summary: Record<HealthPushStatus, number> & { total: number };
  results: Partial<Record<HealthPushCollection, HealthPushRowResult[]>>;
  /** Collection keys this Worker has no writer for. */
  unsupported: string[];
}

/** One pushed row: an id, the client's own stamp, and whatever columns change. */
export type HealthPushRow = Record<string, unknown>;
export type HealthPushChanges = Partial<Record<HealthPushCollection, HealthPushRow[]>>;

/* ------------------------- activity notifications -------------------------- */

/**
 * The ten `notify_*` / `receive_*` booleans of
 * `PUT /health/activity-preferences` (donor `activity_notification_preferences`).
 *
 * Declared as a list, not just a type, because every consumer needs to iterate
 * them — the settings screen renders one row per flag and the reset verb has to
 * send all ten. A flag that exists on the Worker but not here can never be
 * toggled, so the two lists are meant to be read side by side.
 */
export const HEALTH_ACTIVITY_PREFERENCE_FLAGS = [
  'notify_recipe_created',
  'notify_recipe_updated',
  'notify_custom_food_created',
  'notify_workout_video_shared',
  'notify_photo_shared',
  'notify_milestone_achieved',
  'notify_community_recipe_created',
  'notify_community_achievement',
  'receive_push_notifications',
  'receive_inapp_notifications',
] as const;
export type HealthActivityPreferenceFlag = (typeof HEALTH_ACTIVITY_PREFERENCE_FLAGS)[number];

export type HealthActivityPreferenceFlags = Record<HealthActivityPreferenceFlag, boolean>;

export interface HealthActivityPreferences extends HealthActivityPreferenceFlags {
  user_id: string;
  /** null until the member has saved once — the row is created lazily. */
  created_at: string | null;
  updated_at: string | null;
}

/* ============================== Client =============================== */

const BASE = '/health';

/**
 * The raw HTTP surface — always the server, never the ledger.
 *
 * Split out from `healthApi` for He3 (plan §7). Two callers need the server
 * even on a local-first device, and both would be silently wrong if they went
 * through the Proxy below:
 *
 *  - `exportBeforeUpgrade.ts`, which must read D1 **directly** (plan §1.3a).
 *    Wired through the Proxy it would export the empty local ledger — the one
 *    artefact that makes data loss survivable, returning zero rows, and nobody
 *    notices because it "works".
 *  - the Tier B methods listed in `remoteMethods`, which are network services
 *    (FatSecret, AI) rather than user data and have no local implementation.
 *
 * Do not import this to dodge an unimplemented local method. A missing local
 * method must throw — see the header of `localApiProxy.ts` for why falling
 * through to a server that holds no data is the worst failure mode available.
 */
export const remoteHealthApi = {
  // ---- weight ----
  listWeight: (params?: { from?: string; to?: string; limit?: number }) =>
    apiClient
      .get<{ entries: HealthWeightEntry[] }>(`${BASE}/weight/entries`, { params })
      .then((r) => r.data),
  createWeight: (body: {
    date: string;
    weight: number;
    unit: HealthWeightUnit;
    note?: string;
    /**
     * Omit for anything the member typed — the route defaults to `'manual'`.
     * The HealthKit importer is the only caller that sends `'healthkit'` (0122),
     * and that tag is what lets the de-duplicator leave typed rows alone.
     */
    source?: 'manual' | 'healthkit';
  }) =>
    apiClient
      .post<{ entry: HealthWeightEntry }>(`${BASE}/weight/entries`, body)
      .then((r) => r.data),
  updateWeight: (
    id: string,
    body: Partial<{
      date: string;
      weight: number;
      unit: HealthWeightUnit;
      note: string | null;
      source: 'manual' | 'healthkit';
    }>
  ) => apiClient
      .put<{ entry: HealthWeightEntry }>(`${BASE}/weight/entries/${id}`, body)
      .then((r) => r.data),
  deleteWeight: (id: string) => apiClient
      .delete<{ deleted: boolean }>(`${BASE}/weight/entries/${id}`)
      .then((r) => r.data),
  weightStatistics: (params?: { from?: string }) =>
    apiClient
      .get<{ statistics: HealthWeightStatistics }>(`${BASE}/weight/statistics`, { params })
      .then((r) => r.data),
  weeklyWeight: (params?: { limit?: number }) =>
    apiClient
      .get<{ weeks: HealthWeeklyWeight[] }>(`${BASE}/weight/weekly-averages`, { params })
      .then((r) => r.data),

  // ---- water ----
  listWater: (params?: { from?: string; to?: string }) =>
    apiClient
      .get<{ entries: HealthWaterEntry[] }>(`${BASE}/water/entries`, { params })
      .then((r) => r.data),
  addWater: (body: {
    date: string;
    amount_ml: number;
    beverage_type?: string;
    /** Which preset poured it ("Glass" / "Bottle" / "Mug") — donor labels. */
    container?: string;
  }) =>
    apiClient
      .post<{ entry: HealthWaterEntry }>(`${BASE}/water/entries`, body)
      .then((r) => r.data),
  /** Delete ONE logged drink. The ±cup control uses `undoWater` instead. */
  deleteWater: (id: string) =>
    apiClient
      .delete<{ deleted: boolean }>(`${BASE}/water/entries/${id}`)
      .then((r) => r.data),
  /** Undo the most recent sip — the ±1 cup control never holds an entry id. */
  undoWater: (date: string) => apiClient
      .post<{ removed: boolean }>(`${BASE}/water/undo`, { date })
      .then((r) => r.data),
  waterSummary: (date: string) =>
    apiClient
      .get<{ summary: HealthWaterSummary }>(`${BASE}/water/summary/daily`, { params: { date } })
      .then((r) => r.data),

  // ---- nutrition ----
  listNutrition: (params: { date?: string; from?: string; to?: string }) =>
    apiClient
      .get<{ entries: HealthNutritionEntry[] }>(`${BASE}/nutrition/entries`, { params })
      .then((r) => r.data),
  createNutrition: (body: HealthNutritionEntryPayload) =>
    apiClient
      .post<{ entry: HealthNutritionEntry }>(`${BASE}/nutrition/entries`, body)
      .then((r) => r.data),
  /**
   * Patch a logged diary entry in place.
   *
   * The route and service have existed since P1; only this client method was
   * missing, so the app was editing by add-then-delete — two round trips, a new
   * row id, and a new `created_at` that jumped the item to the end of its slot.
   */
  updateNutrition: (
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
    }>
  ) =>
    apiClient
      .put<{ entry: HealthNutritionEntry }>(`${BASE}/nutrition/entries/${id}`, body)
      .then((r) => r.data),
  /**
   * Re-derive a logged entry's macros for a NEW portion (0124).
   *
   * The maths is the SERVER's: it scales the stored `base_*_per_100`, never the
   * figures already on the row, so repeated edits cannot drift. Answers 400
   * `no_basis` when the entry has none (a hand-typed row from before 0124) —
   * the caller falls back to the typed editor rather than inventing a basis.
   */
  reportionNutrition: (id: string, body: { portion: number; unit?: string }) =>
    apiClient
      .post<{ entry: HealthNutritionEntry }>(`${BASE}/nutrition/entries/${id}/portion`, body)
      .then((r) => r.data),
  /**
   * Create up to 100 diary rows in one request.
   *
   * Backs the donor's copy-a-food / copy-a-meal sheets. One row per request
   * would make copying a twelve-item dinner twelve round trips, and a drop
   * halfway would leave the target day half-written with nothing to tell the
   * user which half landed.
   *
   * The Worker SKIPS (does not fail) a row whose `food_id` names a food the
   * caller no longer owns, so the answer's length can legitimately be shorter
   * than what was sent — callers must read `entries`, not assume.
   */
  bulkCreateNutrition: (body: { entries: HealthNutritionEntryPayload[] }) =>
    apiClient
      .post<{ entries: HealthNutritionEntry[] }>(`${BASE}/nutrition/entries/bulk`, body)
      .then((r) => r.data),
  /**
   * Copy one day's diary onto another day, server-side.
   *
   * `from_slot` narrows the source to one meal and `to_slot` re-files everything
   * into one meal, so "copy yesterday's lunch into today's dinner" is a single
   * request rather than a read followed by N writes. Omitting both copies the
   * whole day and keeps each row in its own slot.
   *
   * APPEND, never replace — the donor's copy sheets never deleted anything at
   * the target, and a copy that silently wiped a slot would be unrecoverable.
   * Provenance (`food_id`) and the per-100 basis travel with each copy, so a
   * copied row is still re-portionable.
   */
  copyNutritionDay: (body: {
    from_date: string;
    to_date: string;
    from_slot?: HealthMealType;
    to_slot?: HealthMealType;
  }) =>
    apiClient
      .post<{ entries: HealthNutritionEntry[] }>(`${BASE}/nutrition/copy-day`, body)
      .then((r) => r.data),
  deleteNutrition: (id: string) =>
    apiClient
      .delete<{ deleted: boolean }>(`${BASE}/nutrition/entries/${id}`)
      .then((r) => r.data),
  nutritionSummary: (date: string) =>
    apiClient
      .get<{ summary: HealthNutritionSummary }>(`${BASE}/nutrition/summary`, { params: { date } })
      .then((r) => r.data),

  // ---- food challenges (Dashboard "Food Challenges" widget) ----
  /** Omit `active` to see everything the member created, paused or not. */
  listChallenges: (params?: { active?: boolean }) =>
    apiClient
      .get<{ challenges: HealthFoodChallenge[] }>(`${BASE}/challenges`, {
        params: params?.active === undefined ? undefined : { active: params.active ? 'true' : 'false' },
      })
      .then((r) => r.data),
  createChallenge: (body: HealthFoodChallengeWrite) =>
    apiClient
      .post<{ challenge: HealthFoodChallenge }>(`${BASE}/challenges`, body)
      .then((r) => r.data),
  updateChallenge: (id: string, body: Partial<HealthFoodChallengeWrite>) =>
    apiClient
      .put<{ challenge: HealthFoodChallenge }>(`${BASE}/challenges/${id}`, body)
      .then((r) => r.data),
  deleteChallenge: (id: string) =>
    apiClient
      .delete<{ deleted: boolean }>(`${BASE}/challenges/${id}`)
      .then((r) => r.data),
  getChallengeProgressToday: (date?: string) =>
    apiClient
      .get<HealthChallengeTodayResponse>(`${BASE}/challenges/progress/today`, {
        params: date ? { date } : undefined,
      })
      .then((r) => r.data),
  getChallengeWeeklyProgress: (id: string) =>
    apiClient
      .get<HealthChallengeWeeklyProgress>(`${BASE}/challenges/${id}/progress/weekly`)
      .then((r) => r.data),

  // ---- measurements ----
  listMeasurements: () => apiClient
      .get<{ measurements: HealthMeasurement[] }>(`${BASE}/measurements`)
      .then((r) => r.data),
  /**
   * The most recent measurement row, or null when there is none.
   *
   * One round trip and one row, where `listMeasurements()` is the whole history.
   * Worth having as its own call for the surfaces that only ever want "what am I
   * now" — a widget, a dashboard tile, the prefill on the add form — because on
   * an account with two years of weekly measurements the difference is a hundred
   * rows over the wire to render one.
   */
  latestMeasurement: () =>
    apiClient
      .get<{ measurement: HealthMeasurement | null }>(`${BASE}/measurements/latest`)
      .then((r) => r.data),
  createMeasurement: (body: Record<string, unknown> & { date: string; unit: HealthMeasurementUnit }) =>
    apiClient
      .post<{ measurement: HealthMeasurement }>(`${BASE}/measurements`, body)
      .then((r) => r.data),
  /**
   * Correct or CLEAR individual sites on one row (0131).
   *
   * A row is a whole taping session, so this is how a single bad reading is
   * removed: send that column as `null`. Omitted keys keep their stored value.
   * DELETE still exists and still tombstones the entire session.
   */
  updateMeasurement: (id: string, body: Record<string, unknown>) =>
    apiClient
      .patch<{ measurement: HealthMeasurement }>(`${BASE}/measurements/${id}`, body)
      .then((r) => r.data),
  deleteMeasurement: (id: string) =>
    apiClient
      .delete<{ deleted: boolean }>(`${BASE}/measurements/${id}`)
      .then((r) => r.data),

  // ---- generic entries (steps / workouts / sleep / hr / energy) ----
  listEntries: (params?: {
    type?: HealthEntryType;
    from?: string;
    to?: string;
    limit?: number;
  }) => apiClient
      .get<{ entries: HealthEntry[] }>(`${BASE}/entries`, { params })
      .then((r) => r.data),
  setSteps: (date: string, steps: number) =>
    apiClient
      .post<{ entry: HealthEntry }>(`${BASE}/entries/steps`, { date, steps })
      .then((r) => r.data),
  /**
   * Create a generic entry — the HealthKit importer's write verb.
   *
   * INSERTS unconditionally (only `/entries/steps` upserts), so the caller owns
   * de-duplication; `healthKit.ts` plans every import against what this route has
   * already stored so a second sync cannot stack a second row on the same day.
   */
  createEntry: (body: {
    date: string;
    entry_type: HealthEntryType;
    data: Record<string, unknown>;
    source?: 'healthkit' | 'manual';
    intensity?: HealthWorkoutIntensity | null;
  }) => apiClient
      .post<{ entry: HealthEntry }>(`${BASE}/entries`, body)
      .then((r) => r.data),
  logWorkout: (body: {
    date: string;
    workout_type: string;
    minutes: number;
    calories?: number;
    note?: string;
    /** 0124 — omitted when the user left the picker on its default. */
    intensity?: HealthWorkoutIntensity;
    /**
     * Metres. OMITTED when the session did not measure a distance — the route
     * only writes the key it is given, so an absent distance stays absent
     * instead of becoming a `0` that every total would then add up.
     */
    distance_m?: number;
    /** When the session happened (ISO). Omitted ⇒ the route does not store one. */
    started_at?: string;
  }) => apiClient
      .post<{ entry: HealthEntry }>(`${BASE}/entries/workouts`, body)
      .then((r) => r.data),
  /**
   * Edit a logged session in place (0124).
   *
   * MERGES the typed payload server-side, so a caller changing only the
   * duration need not resend the note. `intensity: null` un-records it; omitting
   * the key keeps whatever is stored. Replaces the re-record workaround (write
   * the replacement, then delete the original), which moved the logged time.
   *
   * `distance_m: null` and `started_at: null` DELETE their key from the stored
   * payload — the merge cannot express "remove this" any other way, and an edit
   * that clears the distance field has to actually clear it.
   */
  updateWorkout: (
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
    }>
  ) => apiClient
      .put<{ entry: HealthEntry }>(`${BASE}/entries/workouts/${id}`, body)
      .then((r) => r.data),
  /** Generic entry update — `data` is REPLACED, not merged (donor contract). */
  updateEntry: (
    id: string,
    body: Partial<{
      date: string;
      data: Record<string, unknown>;
      source: 'healthkit' | 'manual';
      intensity: HealthWorkoutIntensity | null;
    }>
  ) => apiClient
      .put<{ entry: HealthEntry }>(`${BASE}/entries/${id}`, body)
      .then((r) => r.data),
  deleteEntry: (id: string) => apiClient
      .delete<{ deleted: boolean }>(`${BASE}/entries/${id}`)
      .then((r) => r.data),

  // ---- goals ----
  getGoal: (date?: string) =>
    apiClient
      .get<{ goal: HealthGoal | null }>(`${BASE}/goals`, { params: date ? { date } : undefined })
      .then((r) => r.data),
  saveGoal: (body: Partial<HealthGoal> & { effective_date?: string }) =>
    apiClient
      .put<{ goal: HealthGoal | null }>(`${BASE}/goals`, body)
      .then((r) => r.data),

  // ---- habits ----
  /** `includeArchived` is what makes an archived habit unarchivable again. */
  listHabits: (params?: { includeArchived?: boolean }) =>
    apiClient
      .get<{ habits: HealthHabit[] }>(`${BASE}/habits`, {
        params: params?.includeArchived ? { include_archived: 'true' } : undefined,
      })
      .then((r) => r.data),
  createHabit: (body: HealthHabitWrite & { name: string }) =>
    apiClient
      .post<{ habit: HealthHabit }>(`${BASE}/habits`, body)
      .then((r) => r.data),
  /**
   * Patch a habit in place — name, icon, schedule, reminder, archive flag.
   *
   * The Worker re-materialises the habit's reminder rows on every call, so a
   * changed time or frequency takes effect without a second request.
   */
  updateHabit: (id: string, body: HealthHabitWrite) =>
    apiClient
      .put<{ habit: HealthHabit; habits: HealthHabit[] }>(`${BASE}/habits/${id}`, body)
      .then((r) => r.data),
  deleteHabit: (id: string) => apiClient
      .delete<{ deleted: boolean }>(`${BASE}/habits/${id}`)
      .then((r) => r.data),
  toggleHabit: (id: string, date: string) =>
    apiClient
      .post<{ done: boolean; habits: HealthHabit[] }>(`${BASE}/habits/${id}/toggle`, { date })
      .then((r) => r.data),

  // ---- women's health ----
  getCycleSettings: () =>
    apiClient
      .get<{ settings: HealthCycleSettings | null }>(`${BASE}/cycle/settings`)
      .then((r) => r.data),
  saveCycleSettings: (body: Partial<HealthCycleSettings>) =>
    apiClient
      .put<{ settings: HealthCycleSettings }>(`${BASE}/cycle/settings`, body)
      .then((r) => r.data),
  listPeriods: () => apiClient
      .get<{ periods: HealthPeriodEntry[] }>(`${BASE}/cycle/periods`)
      .then((r) => r.data),
  logPeriodDay: (body: { date: string; flow_level: number; notes?: string }) =>
    apiClient
      .post<{ periods: HealthPeriodEntry[]; settings: HealthCycleSettings | null }>(
        `${BASE}/cycle/periods`,
        body
      )
      .then((r) => r.data),
  removePeriodDay: (date: string) =>
    apiClient
      .delete<{ deleted: boolean; periods: HealthPeriodEntry[] }>(`${BASE}/cycle/periods/${date}`)
      .then((r) => r.data),
  listCycleSymptoms: () =>
    apiClient
      .get<{ symptoms: HealthCycleSymptomEntry[] }>(`${BASE}/cycle/symptoms`)
      .then((r) => r.data),
  saveCycleSymptoms: (body: Record<string, unknown> & { date: string }) =>
    apiClient
      .put<{ entry: HealthCycleSymptomEntry }>(`${BASE}/cycle/symptoms`, body)
      .then((r) => r.data),

  // ---- men's health ----
  listMensHealth: () => apiClient
      .get<{ entries: HealthMensEntry[] }>(`${BASE}/mens-health/entries`)
      .then((r) => r.data),
  saveMensHealth: (body: Record<string, unknown> & { date: string }) =>
    apiClient
      .put<{ entry: HealthMensEntry }>(`${BASE}/mens-health/entries`, body)
      .then((r) => r.data),
  getMensHealthSettings: () =>
    apiClient
      .get<{ settings: HealthMensSettings | null }>(`${BASE}/mens-health/settings`)
      .then((r) => r.data),
  /**
   * The route spreads this patch straight into the UPDATE, so every key MUST be
   * a real `mens_health_settings` column — an unknown one fails the write rather
   * than being ignored. `healthVitalityStorage` is the only caller and builds
   * the body from a fixed column map for exactly that reason.
   */
  saveMensHealthSettings: (body: Record<string, boolean | string | null>) =>
    apiClient
      .put<{ settings: HealthMensSettings }>(`${BASE}/mens-health/settings`, body)
      .then((r) => r.data),

  // ---- body insights (read-only; the producer is `healthAiApi.generateBodyInsight`) ----

  /**
   * Stored insights, newest first (the Worker orders by date then created_at, so
   * this needs no re-sort).
   *
   * This is the READER for rows the producer has been persisting since P3 with
   * nothing on the app side ever asking for them: generating wrote a row, the
   * screen rendered the response once, and re-opening the screen showed nothing.
   */
  listBodyInsights: (params: { from?: string; to?: string; limit?: number } = {}) =>
    apiClient
      .get<{ insights: HealthBodyInsight[] }>(`${BASE}/body-insights`, {
        params: Object.keys(params).length > 0 ? params : undefined,
      })
      .then((r) => r.data),

  /** The newest one, or null — what the Body/Coach card opens on. */
  latestBodyInsight: () =>
    apiClient
      .get<{ insight: HealthBodyInsight | null }>(`${BASE}/body-insights/latest`)
      .then((r) => r.data),

  /**
   * Per-photo analyses. Returns an empty list in this app by design — body
   * photos are unported, so nothing writes these rows. See
   * `HealthBodyPhotoInsight`.
   */
  listBodyPhotoInsights: (params: { photo_id?: string; date?: string; limit?: number } = {}) =>
    apiClient
      .get<{ insights: HealthBodyPhotoInsight[] }>(`${BASE}/body-insights/photo`, {
        params: Object.keys(params).length > 0 ? params : undefined,
      })
      .then((r) => r.data),

  // ---- summary + sync ----
  /**
   * Calories + weight, this week against last (Dashboard "Weekly Trends"
   * widget). `date` anchors "this week" — omit for the server's own today.
   */
  getWeeklyTrend: (date?: string) =>
    apiClient
      .get<HealthWeeklyTrendResponse>(`${BASE}/summary/weekly-trend`, {
        params: date ? { date } : undefined,
      })
      .then((r) => r.data),
  dailySummary: (date?: string) =>
    apiClient
      .get<{ summary: HealthDailySummary }>(`${BASE}/summary`, {
        params: date ? { date } : undefined,
      })
      .then((r) => r.data),
  sync: (since: string) => apiClient
      .get<HealthSyncDelta>(`${BASE}/sync`, { params: { since } })
      .then((r) => r.data),
  /**
   * The WRITE half of the sync contract.
   *
   * Every row needs an `updated_at` the server can compare (last-write-wins per
   * row) and, for the natural-key collections, its key columns — `date` for the
   * day-slot tables, `habit_id` + `date` for habit logs. Setting `deleted_at`
   * tombstones the row: that is the delete verb for tables whose own route has
   * none, and the reason "Clear all data" does not need a new endpoint.
   *
   * At most `HEALTH_SYNC_PUSH_MAX_ROWS` rows across ALL collections per request.
   * Idempotent: a replay reports `unchanged` rather than writing twice.
   */
  syncPush: (changes: HealthPushChanges) =>
    apiClient.post<HealthPushResponse>(`${BASE}/sync/push`, { changes }).then((r) => r.data),

  // ---- activity notification preferences ----
  /** Never 404s — an account with no row reads the donor defaults. */
  activityPreferences: () =>
    apiClient
      .get<{ preferences: HealthActivityPreferences }>(`${BASE}/activity-preferences`)
      .then((r) => r.data),
  /** PARTIAL upsert keyed on the user — an omitted flag keeps its stored value. */
  saveActivityPreferences: (patch: Partial<HealthActivityPreferenceFlags>) =>
    apiClient
      .put<{ preferences: HealthActivityPreferences }>(`${BASE}/activity-preferences`, patch)
      .then((r) => r.data),
};

/**
 * Methods that stay on the server even on a local-first device — He3a requires a
 * WRITTEN REASON for every one, so here they are, grouped by why.
 *
 * The bar: a method belongs here only if the server can still answer it
 * CORRECTLY once the ledger is the system of record. A method the server would
 * answer *emptily* — because its inputs are Wave A rows that now live on the
 * device — does not belong here; it belongs in `unsupportedCopy.ts` and must
 * throw. A confident wrong answer is the failure mode §1.3 exists to prevent.
 */
const HEALTH_REMOTE_BY_DESIGN = [
  // ---- Wave C — women's health. Server-authoritative for all of Wave A ----
  // `/health/cycle/*` is on the reject-list's FALL-THROUGH side (plan §2 item 3)
  // and its tables are not in `HEALTH_LEDGER_TABLE_KEYS`. He11b ledgers them.
  'getCycleSettings',
  'saveCycleSettings',
  'listPeriods',
  'logPeriodDay',
  'removePeriodDay',
  'listCycleSymptoms',
  'saveCycleSymptoms',

  // ---- Wave C — men's health. Same disposition, same wave ----
  'getMensHealthSettings',
  'saveMensHealthSettings',
  'listMensHealth',
  'saveMensHealth',

  // ---- Tier B — AI-produced, read-only ----
  // The producer is `healthAiApi.generateBodyInsight`; these only READ what the
  // model already wrote server-side. Nothing here is derived from Wave A rows,
  // so the answer stays correct after the truncate.
  'listBodyInsights',
  'latestBodyInsight',
  'listBodyPhotoInsights',

  // ---- Activity notification preferences ----
  // `health_activity_preferences` is a settings row, not a log; it is not one of
  // the eight Wave A tables and `/health/activity-preferences` falls through the
  // reject-list untouched.
  'activityPreferences',
  'saveActivityPreferences',

  // ---- The legacy D1 sync contract ----
  // Deliberately routed to the server so it 410s, rather than throwing locally.
  // This looks backwards and is not: `writeThrough`'s `isTransportFailure` reads
  // `error.response.status` to decide whether a failed write earns an outbox
  // retry (`healthRepository.ts:434-438`). A local throw carries no status, so
  // it reads as a lost connection and is re-queued FOREVER — the poison pill
  // `healthRepository.ts:420-425` warns about. A 410 carries a status the outbox
  // classifies as permanent, so the queue drains and the failure is visible.
  // This is the one place where reaching the server is the safer refusal.
  'sync',
  'syncPush',
] as const satisfies ReadonlyArray<keyof typeof remoteHealthApi>;

/**
 * What every screen and storage module imports — unchanged name, unchanged type.
 *
 * The Proxy decides per call whether the answer comes from the on-device ledger
 * or the server, which is what makes the He3 screen churn zero: ~30 Health
 * screens and every storage module keep their import untouched.
 *
 * Three dispositions, and every method in this file has exactly one:
 *  - **local** — the eight Wave A facades in `localHealthApi`;
 *  - **remote** — `HEALTH_REMOTE_BY_DESIGN` above, each with its reason;
 *  - **unsupported** — everything else THROWS `HealthLocalUnsupportedError`,
 *    surfaced through `unsupportedCopy.ts`. The food-challenge methods land
 *    here on purpose (plan §1.5 disposition (b)): challenge progress is scored
 *    server-side from `nutrition_entries`, which the He12(full) truncate
 *    empties, so "keep it remote" would render a confident zero.
 *
 * A method that is in none of the three is a bug, not a default —
 * `apiParity.test.ts` fails both directions if one appears.
 */
export const healthApi: typeof remoteHealthApi = createHealthLocalProxy(remoteHealthApi, {
  moduleName: 'healthApi',
  // Lazy: `@features/health/local/localHealthApi` pulls all eight facades, and
  // this must not happen at module load for House/Budget/Kaizen bundles that
  // never call a Health method.
  resolveLocal: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('@features/health/local/localHealthApi') as typeof import('@features/health/local/localHealthApi'))
      .localHealthApi,
  remoteMethods: HEALTH_REMOTE_BY_DESIGN,
});

export default healthApi;
