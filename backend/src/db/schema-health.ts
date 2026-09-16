import { sqliteTable, text, integer, real, index, unique } from 'drizzle-orm/sqlite-core';

import { users } from './schema';

// ============ SYMPLY HEALTH — core tracking ============
// Columns match backend/migrations/0119_health_core.sql EXACTLY. Ported from the
// donor Worker (`~/Desktop/Symply Ecosystem/Simply Health/backend/migrations/`);
// see documents/apps/symply-health/PARITY_PLAN.md §2 for the route→table map.
//
// NOT re-exported from schema.ts — this domain uses hand-written SQL migrations
// (db:generate is intentionally bypassed), mirroring the budget/savings/mortgage
// domains.
//
// Every log table carries `updated_at` + `deleted_at`: the donor's delta-sync
// contract pulls by `updated_at` and needs tombstones to survive, so a hard
// delete would silently resurrect a row on the next device pull.

/** Generic metric log — one row per (day, metric), payload in JSON `data`. */
export const healthEntries = sqliteTable(
  'health_entries',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    // 'steps' | 'workout' | 'sleep' | 'heart_rate' | 'active_energy'
    entry_type: text('entry_type').notNull(),
    /** JSON blob — shape depends on entry_type (donor kept it schemaless). */
    data: text('data').notNull(),
    // 'healthkit' | 'manual' — manual is the only writer until the HealthKit phase.
    source: text('source').notNull(),
    /**
     * 'easy' | 'steady' | 'hard' | 'max' (0124), workouts only. NULL = not
     * recorded, which is also what the picker's default writes.
     *
     * NEW, not ported: the donor's `WorkoutEntry` has no effort field at all
     * (every session was a HealthKit import), and neither of its lookalikes fit
     * — `exercise_library.difficulty` grades a MOVEMENT and
     * `mens_health_entries.workout_intensity` is a 1–10 vitality self-report.
     * Before this column intensity rode the note as a `[hard]` tag; it does not
     * any more.
     */
    intensity: text('intensity'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    userDate: index('idx_health_entries_user_date').on(t.user_id, t.date),
    userType: index('idx_health_entries_user_type').on(t.user_id, t.entry_type, t.date),
    sync: index('idx_health_entries_sync').on(t.user_id, t.updated_at),
    intensity: index('idx_health_entries_intensity').on(t.user_id, t.entry_type, t.intensity),
  })
);

export const weightEntries = sqliteTable(
  'weight_entries',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    weight: real('weight').notNull(),
    // 'kg' | 'lb' | 'lbs' — 'lbs' only appears on rows imported from the donor.
    unit: text('unit').notNull(),
    note: text('note'),
    /**
     * 'manual' | 'healthkit' (0122). Mirrors `health_entries.source`, and is what
     * lets the HealthKit importer apply "manual always wins" — without it an
     * imported reading is indistinguishable from a typed one and a re-import
     * could silently overwrite the user's own correction.
     */
    source: text('source').notNull().default('manual'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    userDate: index('idx_weight_entries_user_date').on(t.user_id, t.date),
    sync: index('idx_weight_entries_sync').on(t.user_id, t.updated_at),
  })
);

/** Precomputed weekly rollup — recomputed on write, not by a cron. */
export const healthWeeklyWeightAverages = sqliteTable(
  'health_weekly_weight_averages',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    week_start: text('week_start').notNull(),
    week_end: text('week_end').notNull(),
    average_weight: real('average_weight').notNull(),
    min_weight: real('min_weight'),
    max_weight: real('max_weight'),
    entry_count: integer('entry_count').notNull().default(0),
    weight_unit: text('weight_unit').notNull().default('kg'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (t) => ({
    userWeek: index('idx_weekly_weight_user').on(t.user_id, t.week_start),
    uniqueWeek: unique().on(t.user_id, t.week_start),
  })
);

export const waterEntries = sqliteTable(
  'water_entries',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    amount_ml: real('amount_ml').notNull(),
    beverage_type: text('beverage_type').notNull().default('water'),
    container: text('container'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    userDate: index('idx_water_entries_user_date').on(t.user_id, t.date),
    sync: index('idx_water_entries_sync').on(t.user_id, t.updated_at),
  })
);

export const nutritionEntries = sqliteTable(
  'nutrition_entries',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    food_name: text('food_name').notNull(),
    portion: real('portion').notNull().default(1),
    unit: text('unit').notNull().default('serving'),
    // 'breakfast' | 'lunch' | 'dinner' | 'snack'
    meal_type: text('meal_type').notNull(),
    calories: real('calories').notNull(),
    proteins: real('proteins').notNull().default(0),
    carbohydrates: real('carbohydrates').notNull().default(0),
    fats: real('fats').notNull().default(0),
    /**
     * The `custom_foods` row this diary entry was logged from (0124), or NULL
     * for a hand-typed one. Deliberately NOT a foreign key: `custom_foods` is
     * soft-deleted, and a diary row must keep its macros when the source food
     * goes — the meal was still eaten. Ownership is enforced in the service.
     */
    food_id: text('food_id'),
    /**
     * Donor `018_nutrition_base_values.sql`, column-for-column: the per-100
     * basis a portion change is re-derived FROM. NULL on every row written
     * before 0124 and on any entry whose macros were typed without a portion —
     * `POST /nutrition/entries/:id/portion` answers 400 `no_basis` for those
     * rather than guessing.
     */
    base_calories_per_100: real('base_calories_per_100'),
    base_proteins_per_100: real('base_proteins_per_100'),
    base_carbs_per_100: real('base_carbs_per_100'),
    base_fats_per_100: real('base_fats_per_100'),
    /**
     * The three columns migration `0136_food_challenges.sql` adds — what the
     * personal food-challenges feature (`schema-health-challenges.ts`) reads to
     * compute consumed grams. Donor `052`/`061`/`077`; see that migration's
     * header for the full mapping and, for `is_processed`, why this port
     * derives it server-side instead of from a client-supplied flag.
     */
    detected_category: text('detected_category'),
    is_processed: integer('is_processed', { mode: 'boolean' }).notNull().default(true),
    source_recipe_id: text('source_recipe_id'),
    /**
     * 'manual' | 'healthkit' (0143). Mirrors `health_entries.source` /
     * `weight_entries.source`, and is what lets the HealthKit dietary importer
     * recognise its own day-total row without re-parsing every meal on the day.
     * Unlike weight, this is NOT a "who owns this day" flag — a day can hold
     * several manual meals alongside one imported row; they coexist.
     */
    source: text('source').notNull().default('manual'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    userDate: index('idx_nutrition_entries_user_date').on(t.user_id, t.date),
    sync: index('idx_nutrition_entries_sync').on(t.user_id, t.updated_at),
    hasBase: index('idx_nutrition_entries_has_base').on(t.user_id, t.date),
    food: index('idx_nutrition_entries_food').on(t.user_id, t.food_id),
    category: index('idx_nutrition_entries_category_date').on(t.user_id, t.date, t.detected_category),
    source: index('idx_nutrition_entries_source').on(t.user_id, t.source, t.date),
  })
);

export const bodyMeasurements = sqliteTable(
  'body_measurements',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    chest: real('chest'),
    waist: real('waist'),
    hips: real('hips'),
    left_arm: real('left_arm'),
    right_arm: real('right_arm'),
    left_thigh: real('left_thigh'),
    right_thigh: real('right_thigh'),
    neck: real('neck'),
    shoulders: real('shoulders'),
    left_calf: real('left_calf'),
    right_calf: real('right_calf'),
    left_forearm: real('left_forearm'),
    right_forearm: real('right_forearm'),
    body_fat_percentage: real('body_fat_percentage'),
    /*
     * 0131 — the donor's COMPREHENSIVE sites, on top of the legacy block above.
     *
     * The columns above are the donor's "Legacy Fields" and each one already IS
     * the comprehensive point of the same name: `waist` is its `waistNarrowest`,
     * `chest` its `chestFull`, `left_arm` its `leftArmUpper`, `left_forearm` its
     * `leftForearmUpper`, `left_calf` its `leftCalfUpper`, `shoulders` its
     * `shoulderWidth`. They are NOT duplicated here — see the migration header
     * for that and for the donor fields deliberately left out (planar
     * depths/breadths, ratios, symmetry scores, body-fat estimates, posture and
     * photo-analysis metadata).
     */
    left_arm_mid: real('left_arm_mid'),
    right_arm_mid: real('right_arm_mid'),
    left_forearm_mid: real('left_forearm_mid'),
    right_forearm_mid: real('right_forearm_mid'),
    left_wrist: real('left_wrist'),
    right_wrist: real('right_wrist'),
    left_thigh_mid: real('left_thigh_mid'),
    right_thigh_mid: real('right_thigh_mid'),
    left_thigh_lower: real('left_thigh_lower'),
    right_thigh_lower: real('right_thigh_lower'),
    left_knee: real('left_knee'),
    right_knee: real('right_knee'),
    left_calf_mid: real('left_calf_mid'),
    right_calf_mid: real('right_calf_mid'),
    left_calf_lower: real('left_calf_lower'),
    right_calf_lower: real('right_calf_lower'),
    left_ankle: real('left_ankle'),
    right_ankle: real('right_ankle'),
    waist_navel: real('waist_navel'),
    waist_upper: real('waist_upper'),
    waist_lower: real('waist_lower'),
    iliac: real('iliac'),
    chest_upper: real('chest_upper'),
    chest_under: real('chest_under'),
    back_width: real('back_width'),
    torso_length: real('torso_length'),
    inseam: real('inseam'),
    // 'cm' | 'in' | 'inches' — 'inches' only on donor-imported rows.
    unit: text('unit').notNull(),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    userDate: index('idx_body_measurements_user_date').on(t.user_id, t.date),
    sync: index('idx_body_measurements_sync').on(t.user_id, t.updated_at),
  })
);

export const userHabits = sqliteTable(
  'user_habits',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    template_id: text('template_id'),
    name: text('name').notNull(),
    icon: text('icon').notNull().default('goals'),
    category: text('category').notNull().default('custom'),
    time_of_day: text('time_of_day').notNull().default('anytime'),
    frequency: text('frequency').notNull().default('daily'),
    /** JSON array of weekday numbers [1-7] when frequency is 'custom'. */
    custom_days: text('custom_days'),
    reminder_time: text('reminder_time'),
    reminder_enabled: integer('reminder_enabled', { mode: 'boolean' }).notNull().default(false),
    target_duration: integer('target_duration'),
    notes: text('notes'),
    is_archived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
    sort_order: integer('sort_order').notNull().default(0),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    userOrder: index('idx_user_habits_user').on(t.user_id, t.is_archived, t.sort_order),
    sync: index('idx_user_habits_sync').on(t.user_id, t.updated_at),
  })
);

/** One row per habit per completed day — UNIQUE keeps a double-tap idempotent. */
export const habitLogs = sqliteTable(
  'habit_logs',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    habit_id: text('habit_id')
      .notNull()
      .references(() => userHabits.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    time_of_day: text('time_of_day').notNull().default('anytime'),
    completed_at: text('completed_at').notNull(),
    duration: integer('duration'),
    notes: text('notes'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    userDate: index('idx_habit_logs_user_date').on(t.user_id, t.date),
    sync: index('idx_habit_logs_sync').on(t.user_id, t.updated_at),
    uniqueDay: unique().on(t.habit_id, t.date),
  })
);

export const cycleSettings = sqliteTable('cycle_settings', {
  id: text('id').primaryKey(),
  user_id: text('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  cycle_length: integer('cycle_length').notNull().default(28),
  period_length: integer('period_length').notNull().default(5),
  last_period_start: text('last_period_start'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

export const periodEntries = sqliteTable(
  'period_entries',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    /** 1=spotting 2=light 3=medium 4=heavy 5=very heavy (donor scale). */
    flow_level: integer('flow_level').notNull().default(3),
    notes: text('notes'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    userDate: index('idx_period_entries_user_date').on(t.user_id, t.date),
    sync: index('idx_period_entries_sync').on(t.user_id, t.updated_at),
    uniqueDay: unique().on(t.user_id, t.date),
  })
);

/** Donor kept a column per symptom so severities stay queryable in SQL. */
export const cycleSymptomEntries = sqliteTable(
  'cycle_symptom_entries',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    mood: integer('mood'),
    energy: integer('energy'),
    cramps: integer('cramps'),
    headache: integer('headache'),
    bloating: integer('bloating'),
    breast_tenderness: integer('breast_tenderness'),
    back_pain: integer('back_pain'),
    acne: integer('acne'),
    nausea: integer('nausea'),
    anxiety: integer('anxiety'),
    irritability: integer('irritability'),
    sadness: integer('sadness'),
    cravings: text('cravings'),
    sleep_quality: integer('sleep_quality'),
    libido: integer('libido'),
    discharge: text('discharge'),
    notes: text('notes'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    userDate: index('idx_cycle_symptoms_user_date').on(t.user_id, t.date),
    sync: index('idx_cycle_symptoms_sync').on(t.user_id, t.updated_at),
    uniqueDay: unique().on(t.user_id, t.date),
  })
);

export const mensHealthEntries = sqliteTable(
  'mens_health_entries',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    libido: integer('libido'),
    had_partner_sex: integer('had_partner_sex', { mode: 'boolean' }).notNull().default(false),
    partner_sex_count: integer('partner_sex_count'),
    had_masturbation: integer('had_masturbation', { mode: 'boolean' }).notNull().default(false),
    masturbation_count: integer('masturbation_count'),
    had_orgasm: integer('had_orgasm', { mode: 'boolean' }).notNull().default(false),
    orgasm_intensity: integer('orgasm_intensity'),
    overall_satisfaction: integer('overall_satisfaction'),
    had_morning_erection: integer('had_morning_erection', { mode: 'boolean' })
      .notNull()
      .default(false),
    morning_erection_quality: integer('morning_erection_quality'),
    erection_quality: integer('erection_quality'),
    erection_duration: integer('erection_duration'),
    had_night_erection: integer('had_night_erection', { mode: 'boolean' }).notNull().default(false),
    night_erection_quality: integer('night_erection_quality'),
    had_day_erection: integer('had_day_erection', { mode: 'boolean' }).notNull().default(false),
    day_erection_quality: integer('day_erection_quality'),
    day_erection_count: integer('day_erection_count'),
    had_erotic_dream: integer('had_erotic_dream', { mode: 'boolean' }).notNull().default(false),
    erotic_dream_intensity: integer('erotic_dream_intensity'),
    sexual_desire_level: integer('sexual_desire_level'),
    sexual_desire_peak_time: text('sexual_desire_peak_time'),
    had_erection_difficulty: integer('had_erection_difficulty', { mode: 'boolean' })
      .notNull()
      .default(false),
    had_maintenance_difficulty: integer('had_maintenance_difficulty', { mode: 'boolean' })
      .notNull()
      .default(false),
    had_premature_ejaculation: integer('had_premature_ejaculation', { mode: 'boolean' })
      .notNull()
      .default(false),
    had_delayed_ejaculation: integer('had_delayed_ejaculation', { mode: 'boolean' })
      .notNull()
      .default(false),
    had_performance_anxiety: integer('had_performance_anxiety', { mode: 'boolean' })
      .notNull()
      .default(false),
    had_low_desire: integer('had_low_desire', { mode: 'boolean' }).notNull().default(false),
    had_pain_or_discomfort: integer('had_pain_or_discomfort', { mode: 'boolean' })
      .notNull()
      .default(false),
    energy_level: integer('energy_level'),
    mental_clarity: integer('mental_clarity'),
    mood: integer('mood'),
    sleep_quality: integer('sleep_quality'),
    stress_level: integer('stress_level'),
    exercised: integer('exercised', { mode: 'boolean' }).notNull().default(false),
    workout_intensity: integer('workout_intensity'),
    kegel_sets: integer('kegel_sets'),
    notes: text('notes'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    userDate: index('idx_mens_health_user_date').on(t.user_id, t.date),
    sync: index('idx_mens_health_sync').on(t.user_id, t.updated_at),
    uniqueDay: unique().on(t.user_id, t.date),
  })
);

export const mensHealthSettings = sqliteTable('mens_health_settings', {
  id: text('id').primaryKey(),
  user_id: text('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  track_libido: integer('track_libido', { mode: 'boolean' }).notNull().default(true),
  track_sexual_activity: integer('track_sexual_activity', { mode: 'boolean' })
    .notNull()
    .default(true),
  track_sexual_desire: integer('track_sexual_desire', { mode: 'boolean' }).notNull().default(true),
  track_night_erection: integer('track_night_erection', { mode: 'boolean' }).notNull().default(true),
  track_morning_erection: integer('track_morning_erection', { mode: 'boolean' })
    .notNull()
    .default(true),
  track_day_erection: integer('track_day_erection', { mode: 'boolean' }).notNull().default(true),
  track_erotic_dreams: integer('track_erotic_dreams', { mode: 'boolean' }).notNull().default(true),
  track_issues: integer('track_issues', { mode: 'boolean' }).notNull().default(true),
  track_energy: integer('track_energy', { mode: 'boolean' }).notNull().default(true),
  track_kegels: integer('track_kegels', { mode: 'boolean' }).notNull().default(true),
  track_exercise: integer('track_exercise', { mode: 'boolean' }).notNull().default(true),
  reminder_enabled: integer('reminder_enabled', { mode: 'boolean' }).notNull().default(false),
  reminder_time: text('reminder_time'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

/**
 * Effective-dated goals — a goal change never rewrites history, so a past day is
 * still scored against the goal that was in force that day (donor `goal_history`).
 */
export const healthGoals = sqliteTable(
  'health_goals',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    effective_date: text('effective_date').notNull(),
    daily_calories: integer('daily_calories').notNull().default(2000),
    use_per_day_calories: integer('use_per_day_calories', { mode: 'boolean' })
      .notNull()
      .default(false),
    monday_calories: integer('monday_calories'),
    tuesday_calories: integer('tuesday_calories'),
    wednesday_calories: integer('wednesday_calories'),
    thursday_calories: integer('thursday_calories'),
    friday_calories: integer('friday_calories'),
    saturday_calories: integer('saturday_calories'),
    sunday_calories: integer('sunday_calories'),
    daily_protein_grams: real('daily_protein_grams'),
    daily_carbs_grams: real('daily_carbs_grams'),
    daily_fats_grams: real('daily_fats_grams'),
    /**
     * Per-weekday macro overrides (0139) — the protein/carbs/fat analogue of
     * `use_per_day_calories` + `monday_calories`…`sunday_calories` above. A
     * day left NULL falls back to `daily_*_grams`, same contract as calories.
     */
    use_per_day_macros: integer('use_per_day_macros', { mode: 'boolean' })
      .notNull()
      .default(false),
    monday_protein_grams: real('monday_protein_grams'),
    monday_carbs_grams: real('monday_carbs_grams'),
    monday_fats_grams: real('monday_fats_grams'),
    tuesday_protein_grams: real('tuesday_protein_grams'),
    tuesday_carbs_grams: real('tuesday_carbs_grams'),
    tuesday_fats_grams: real('tuesday_fats_grams'),
    wednesday_protein_grams: real('wednesday_protein_grams'),
    wednesday_carbs_grams: real('wednesday_carbs_grams'),
    wednesday_fats_grams: real('wednesday_fats_grams'),
    thursday_protein_grams: real('thursday_protein_grams'),
    thursday_carbs_grams: real('thursday_carbs_grams'),
    thursday_fats_grams: real('thursday_fats_grams'),
    friday_protein_grams: real('friday_protein_grams'),
    friday_carbs_grams: real('friday_carbs_grams'),
    friday_fats_grams: real('friday_fats_grams'),
    saturday_protein_grams: real('saturday_protein_grams'),
    saturday_carbs_grams: real('saturday_carbs_grams'),
    saturday_fats_grams: real('saturday_fats_grams'),
    sunday_protein_grams: real('sunday_protein_grams'),
    sunday_carbs_grams: real('sunday_carbs_grams'),
    sunday_fats_grams: real('sunday_fats_grams'),
    daily_water_ml: integer('daily_water_ml'),
    daily_steps: integer('daily_steps'),
    daily_active_calories: integer('daily_active_calories'),
    daily_workout_minutes: integer('daily_workout_minutes'),
    daily_sleep_hours: real('daily_sleep_hours'),
    exclude_burned_calories: integer('exclude_burned_calories', { mode: 'boolean' })
      .notNull()
      .default(false),
    /**
     * WEIGHT target + baseline + biometrics (0125, donor `011`/`080`).
     *
     * Canonical kilograms — unlike `weight_entries.weight`, which keeps whatever
     * unit the member typed. A measurement must not be converted (that invents
     * precision); a chosen target must be, or switching the display unit loses
     * it. See the migration header for the full rationale.
     *
     * All nullable: NULL is the honest "not set", and the client renders a
     * prompt rather than a fabricated BMI/BMR from defaulted biometrics.
     */
    target_weight_kg: real('target_weight_kg'),
    /** 'lose' | 'maintain' | 'gain' — stored, not derived, so "maintain" survives. */
    weight_goal_type: text('weight_goal_type'),
    starting_weight_kg: real('starting_weight_kg'),
    /** YYYY-MM-DD; only meaningful with `starting_weight_kg`. */
    starting_weight_date: text('starting_weight_date'),
    height_cm: real('height_cm'),
    /** 'male' | 'female' | 'other'. */
    gender: text('gender'),
    /** Whole year (1990). NOT a date of birth — see the 0125 deviation note. */
    birth_year: integer('birth_year'),
    /** sedentary | lightlyActive | moderatelyActive | veryActive | extraActive. */
    activity_level: text('activity_level'),
    /**
     * The water-goal DISPLAY unit (0140): 'ml' | 'oz' | 'L' | 'cups'. NULL =
     * not set, same "absent means unknown, never a guessed default" contract
     * as `gender`/`activity_level` above. The AMOUNT stays canonical
     * millilitres on `daily_water_ml` regardless — this column never holds a
     * quantity, only how to display one.
     */
    water_unit: text('water_unit'),
    /**
     * The ONE global display-unit switch (0141): 'metric' | 'imperial'.
     * 'metric' → kg + cm + km; 'imperial' → lb + ft/in + mi. Deliberately
     * separate from `water_unit` above — water keeps its own independent
     * 4-way switcher, it is never derived from this column. NULL = not set,
     * same "absent means unknown, never a guessed default" contract as
     * `gender`/`activity_level`/`water_unit`. Every canonical amount on this
     * row (`target_weight_kg`, `height_cm`, …) is unaffected — this column
     * only controls how a value is displayed and typed, never what is stored.
     */
    unit_system: text('unit_system'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (t) => ({
    userDate: index('idx_health_goals_user').on(t.user_id, t.effective_date),
    uniqueDate: unique().on(t.user_id, t.effective_date),
  })
);
