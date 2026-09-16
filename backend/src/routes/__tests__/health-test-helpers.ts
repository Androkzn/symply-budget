/**
 * Shared test helpers for the ported Symply Health domain.
 *
 * Synthesises the 14 tables of `migrations/0119_health_core.sql` (the exact
 * columns `src/db/schema-health.ts` reads/writes) plus the platform `users`
 * row the health tables hang off.
 *
 * Later migrations that only ADD columns are folded into the CREATE above
 * rather than replayed as ALTERs — `weight_entries.source` (0122); from
 * 0124, `health_entries.intensity` plus `nutrition_entries.food_id` and its four
 * `base_*_per_100` columns; from 0125 the eight weight-goal / biometric
 * columns on `health_goals`; from 0140 that same table's `water_unit`; and
 * from 0141 its `unit_system`. The end state is identical and there is one
 * place to read the current shape.
 *
 * Mirrors the DDL style of kaizen-test-helpers.ts / budget-test-helpers.ts:
 * plain CREATE TABLE IF NOT EXISTS collapsed to one line before `exec`.
 *
 * DEVIATION from those helpers: the FOREIGN KEY clauses are KEPT. They assume
 * "miniflare D1 does not enforce FKs", but this pool reports
 * `PRAGMA foreign_keys = 1` and rejects an orphan child row exactly like the
 * deployed D1 — so dropping them would let an insert pass here that 500s in
 * production (see the unknown-habit toggle spec in health.test.ts).
 *
 * The UNIQUE constraints are deliberately KEPT — the service upserts through
 * `onConflictDoUpdate` on (user_id, date) / (user_id, week_start) /
 * (habit_id, date) / (user_id, effective_date), so dropping them would make
 * every upsert silently insert a duplicate and the tests would pass on a
 * schema the migration does not describe. The CHECK constraints are kept for
 * the same reason: they are what makes an out-of-contract `entry_type`,
 * `meal_type` or `unit` fail loudly.
 */

import type { D1Database } from '@cloudflare/workers-types';

const HEALTH_TABLE_DDL: string[] = [
  // Platform users table — every health row FKs to it (shared auth, not a donor table).
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS health_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    entry_type TEXT NOT NULL CHECK (entry_type IN ('steps', 'workout', 'sleep', 'heart_rate', 'active_energy')),
    data TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('healthkit', 'manual')),
    intensity TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS weight_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    weight REAL NOT NULL,
    unit TEXT NOT NULL CHECK (unit IN ('kg', 'lb', 'lbs')),
    note TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS health_weekly_weight_averages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    week_start TEXT NOT NULL,
    week_end TEXT NOT NULL,
    average_weight REAL NOT NULL,
    min_weight REAL,
    max_weight REAL,
    entry_count INTEGER NOT NULL DEFAULT 0,
    weight_unit TEXT NOT NULL DEFAULT 'kg',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, week_start),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS water_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    amount_ml REAL NOT NULL,
    beverage_type TEXT NOT NULL DEFAULT 'water',
    container TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS nutrition_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    food_name TEXT NOT NULL,
    portion REAL NOT NULL DEFAULT 1,
    unit TEXT NOT NULL DEFAULT 'serving',
    meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
    calories REAL NOT NULL,
    proteins REAL NOT NULL DEFAULT 0,
    carbohydrates REAL NOT NULL DEFAULT 0,
    fats REAL NOT NULL DEFAULT 0,
    food_id TEXT,
    base_calories_per_100 REAL,
    base_proteins_per_100 REAL,
    base_carbs_per_100 REAL,
    base_fats_per_100 REAL,
    detected_category TEXT,
    is_processed INTEGER NOT NULL DEFAULT 1,
    source_recipe_id TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  // 0131 comprehensive widening (27 extra cols below `unit`) — see that
  // migration for the full donor mapping. Kept in sync here because this
  // fixture is hand-authored, not derived from the migration files. SQL `--`
  // comments are unsafe INSIDE the string below: D1 flattens the multi-line
  // literal to one line, so a `--` swallows every column after it as a
  // trailing line comment.
  `CREATE TABLE IF NOT EXISTS body_measurements (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    chest REAL,
    waist REAL,
    hips REAL,
    left_arm REAL,
    right_arm REAL,
    left_thigh REAL,
    right_thigh REAL,
    neck REAL,
    shoulders REAL,
    left_calf REAL,
    right_calf REAL,
    left_forearm REAL,
    right_forearm REAL,
    body_fat_percentage REAL,
    unit TEXT NOT NULL CHECK (unit IN ('cm', 'in', 'inches')),
    left_arm_mid REAL,
    right_arm_mid REAL,
    left_forearm_mid REAL,
    right_forearm_mid REAL,
    left_wrist REAL,
    right_wrist REAL,
    left_thigh_mid REAL,
    right_thigh_mid REAL,
    left_thigh_lower REAL,
    right_thigh_lower REAL,
    left_knee REAL,
    right_knee REAL,
    left_calf_mid REAL,
    right_calf_mid REAL,
    left_calf_lower REAL,
    right_calf_lower REAL,
    left_ankle REAL,
    right_ankle REAL,
    waist_navel REAL,
    waist_upper REAL,
    waist_lower REAL,
    iliac REAL,
    chest_upper REAL,
    chest_under REAL,
    back_width REAL,
    torso_length REAL,
    inseam REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS user_habits (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    template_id TEXT,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'goals',
    category TEXT NOT NULL DEFAULT 'custom',
    time_of_day TEXT NOT NULL DEFAULT 'anytime',
    frequency TEXT NOT NULL DEFAULT 'daily',
    custom_days TEXT,
    reminder_time TEXT,
    reminder_enabled INTEGER NOT NULL DEFAULT 0,
    target_duration INTEGER,
    notes TEXT,
    is_archived INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS habit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    habit_id TEXT NOT NULL,
    date TEXT NOT NULL,
    time_of_day TEXT NOT NULL DEFAULT 'anytime',
    completed_at TEXT NOT NULL,
    duration INTEGER,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE(habit_id, date),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (habit_id) REFERENCES user_habits(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS cycle_settings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    cycle_length INTEGER NOT NULL DEFAULT 28,
    period_length INTEGER NOT NULL DEFAULT 5,
    last_period_start TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS period_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    flow_level INTEGER NOT NULL DEFAULT 3,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE(user_id, date),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS cycle_symptom_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    mood INTEGER,
    energy INTEGER,
    cramps INTEGER,
    headache INTEGER,
    bloating INTEGER,
    breast_tenderness INTEGER,
    back_pain INTEGER,
    acne INTEGER,
    nausea INTEGER,
    anxiety INTEGER,
    irritability INTEGER,
    sadness INTEGER,
    cravings TEXT,
    sleep_quality INTEGER,
    libido INTEGER,
    discharge TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE(user_id, date),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS mens_health_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    libido INTEGER,
    had_partner_sex INTEGER NOT NULL DEFAULT 0,
    partner_sex_count INTEGER,
    had_masturbation INTEGER NOT NULL DEFAULT 0,
    masturbation_count INTEGER,
    had_orgasm INTEGER NOT NULL DEFAULT 0,
    orgasm_intensity INTEGER,
    overall_satisfaction INTEGER,
    had_morning_erection INTEGER NOT NULL DEFAULT 0,
    morning_erection_quality INTEGER,
    erection_quality INTEGER,
    erection_duration INTEGER,
    had_night_erection INTEGER NOT NULL DEFAULT 0,
    night_erection_quality INTEGER,
    had_day_erection INTEGER NOT NULL DEFAULT 0,
    day_erection_quality INTEGER,
    day_erection_count INTEGER,
    had_erotic_dream INTEGER NOT NULL DEFAULT 0,
    erotic_dream_intensity INTEGER,
    sexual_desire_level INTEGER,
    sexual_desire_peak_time TEXT,
    had_erection_difficulty INTEGER NOT NULL DEFAULT 0,
    had_maintenance_difficulty INTEGER NOT NULL DEFAULT 0,
    had_premature_ejaculation INTEGER NOT NULL DEFAULT 0,
    had_delayed_ejaculation INTEGER NOT NULL DEFAULT 0,
    had_performance_anxiety INTEGER NOT NULL DEFAULT 0,
    had_low_desire INTEGER NOT NULL DEFAULT 0,
    had_pain_or_discomfort INTEGER NOT NULL DEFAULT 0,
    energy_level INTEGER,
    mental_clarity INTEGER,
    mood INTEGER,
    sleep_quality INTEGER,
    stress_level INTEGER,
    exercised INTEGER NOT NULL DEFAULT 0,
    workout_intensity INTEGER,
    kegel_sets INTEGER,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE(user_id, date),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS mens_health_settings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    track_libido INTEGER NOT NULL DEFAULT 1,
    track_sexual_activity INTEGER NOT NULL DEFAULT 1,
    track_sexual_desire INTEGER NOT NULL DEFAULT 1,
    track_night_erection INTEGER NOT NULL DEFAULT 1,
    track_morning_erection INTEGER NOT NULL DEFAULT 1,
    track_day_erection INTEGER NOT NULL DEFAULT 1,
    track_erotic_dreams INTEGER NOT NULL DEFAULT 1,
    track_issues INTEGER NOT NULL DEFAULT 1,
    track_energy INTEGER NOT NULL DEFAULT 1,
    track_kegels INTEGER NOT NULL DEFAULT 1,
    track_exercise INTEGER NOT NULL DEFAULT 1,
    reminder_enabled INTEGER NOT NULL DEFAULT 0,
    reminder_time TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS health_goals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    effective_date TEXT NOT NULL,
    daily_calories INTEGER NOT NULL DEFAULT 2000,
    use_per_day_calories INTEGER NOT NULL DEFAULT 0,
    monday_calories INTEGER,
    tuesday_calories INTEGER,
    wednesday_calories INTEGER,
    thursday_calories INTEGER,
    friday_calories INTEGER,
    saturday_calories INTEGER,
    sunday_calories INTEGER,
    daily_protein_grams REAL,
    daily_carbs_grams REAL,
    daily_fats_grams REAL,
    use_per_day_macros INTEGER NOT NULL DEFAULT 0,
    monday_protein_grams REAL,
    monday_carbs_grams REAL,
    monday_fats_grams REAL,
    tuesday_protein_grams REAL,
    tuesday_carbs_grams REAL,
    tuesday_fats_grams REAL,
    wednesday_protein_grams REAL,
    wednesday_carbs_grams REAL,
    wednesday_fats_grams REAL,
    thursday_protein_grams REAL,
    thursday_carbs_grams REAL,
    thursday_fats_grams REAL,
    friday_protein_grams REAL,
    friday_carbs_grams REAL,
    friday_fats_grams REAL,
    saturday_protein_grams REAL,
    saturday_carbs_grams REAL,
    saturday_fats_grams REAL,
    sunday_protein_grams REAL,
    sunday_carbs_grams REAL,
    sunday_fats_grams REAL,
    daily_water_ml INTEGER,
    daily_steps INTEGER,
    daily_active_calories INTEGER,
    daily_workout_minutes INTEGER,
    daily_sleep_hours REAL,
    exclude_burned_calories INTEGER NOT NULL DEFAULT 0,
    target_weight_kg REAL,
    weight_goal_type TEXT,
    starting_weight_kg REAL,
    starting_weight_date TEXT,
    height_cm REAL,
    gender TEXT,
    birth_year INTEGER,
    activity_level TEXT,
    water_unit TEXT,
    unit_system TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, effective_date),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  // `health_reminder_preferences` (migration 0134). `HealthService.sync()` pulls
  // it as a singleton-with-tombstone alongside `health_goals` above, so — same
  // reasoning as the P2 block below — a harness holding only the pre-0134
  // subset makes every `sync()` call fail on a missing table, not just a
  // reminders-specific spec. Column-for-column with `schema-health-reminders.ts`.
  `CREATE TABLE IF NOT EXISTS health_reminder_preferences (
    user_id TEXT PRIMARY KEY,
    timezone TEXT,
    meals_enabled INTEGER NOT NULL DEFAULT 0,
    breakfast_enabled INTEGER NOT NULL DEFAULT 0,
    breakfast_time TEXT NOT NULL DEFAULT '08:30',
    lunch_enabled INTEGER NOT NULL DEFAULT 0,
    lunch_time TEXT NOT NULL DEFAULT '13:00',
    snack_enabled INTEGER NOT NULL DEFAULT 0,
    snack_time TEXT NOT NULL DEFAULT '16:00',
    dinner_enabled INTEGER NOT NULL DEFAULT 0,
    dinner_time TEXT NOT NULL DEFAULT '19:00',
    water_enabled INTEGER NOT NULL DEFAULT 0,
    water_start_time TEXT NOT NULL DEFAULT '09:00',
    water_end_time TEXT NOT NULL DEFAULT '21:00',
    water_interval_minutes INTEGER NOT NULL DEFAULT 120,
    weigh_in_enabled INTEGER NOT NULL DEFAULT 0,
    weigh_in_time TEXT NOT NULL DEFAULT '08:00',
    weigh_in_days TEXT,
    skip_if_already_logged INTEGER NOT NULL DEFAULT 1,
    quiet_hours_enabled INTEGER NOT NULL DEFAULT 1,
    quiet_hours_start TEXT NOT NULL DEFAULT '23:00',
    quiet_hours_end TEXT NOT NULL DEFAULT '07:00',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  // The platform notification queue (`migrations/0002_notifications.sql`).
  // `services/health/habit-reminder.ts` and `health-reminders-service.ts` both
  // write to it directly (habit create/update/delete, the meal/water/weigh-in
  // materialiser, and the settings screen's cancel-on-change path), so any spec
  // that exercises a habit or reminder write needs the table to exist — same
  // "additive by design" reasoning as the two tables above. Column-for-column
  // with `schema-notifications.ts`; kept minimal (no CHECK/FK) since this
  // helper only ever needs plain insert/select/delete on it.
  `CREATE TABLE IF NOT EXISTS scheduled_notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    household_id TEXT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data TEXT,
    scheduled_for TEXT NOT NULL,
    sent_at TEXT,
    failed_at TEXT,
    error_message TEXT,
    claimed_at TEXT,
    claim_owner TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    reference_type TEXT,
    reference_id TEXT,
    image_url TEXT,
    category_id TEXT,
    thread_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];

/** Every table this helper owns — used by resetHealthTables. */
export const HEALTH_TABLE_NAMES: readonly string[] = [
  'health_entries',
  'weight_entries',
  'health_weekly_weight_averages',
  'water_entries',
  'nutrition_entries',
  'body_measurements',
  'user_habits',
  'habit_logs',
  'cycle_settings',
  'period_entries',
  'cycle_symptom_entries',
  'mens_health_entries',
  'mens_health_settings',
  'health_goals',
  'health_reminder_preferences',
  'users',
];

/**
 * Supporting PLATFORM tables the health domain writes to as a side effect
 * (habit + reminder scheduling) but does not own and must NOT list in
 * `HEALTH_TABLE_NAMES` — that constant also drives `HEALTH-SYNC-201`
 * (health.test.ts), which asserts every HEALTH table is pulled by `/health/sync`
 * or explicitly excluded, and `scheduled_notifications` is neither: it is the
 * platform notification queue (`migrations/0002_notifications.sql`), synced by
 * no domain's `/sync` and irrelevant to the question that guard is checking.
 * Reset separately, alongside `HEALTH_TABLE_NAMES`, so rows do not leak between
 * specs in a suite that exercises habit or reminder writes.
 */
export const HEALTH_SUPPORTING_TABLE_NAMES: readonly string[] = ['scheduled_notifications'];

/** Create `users` + the 14 Symply Health tables of migration 0119. */
/**
 * Create the P1 health tables.
 *
 * ALSO creates every P2 table. In production both migrations (0119 + 0120) are
 * applied to the same D1, and `HealthService.sync()` pulls a delta across the
 * WHOLE domain — so a harness holding only the P1 subset makes the delta query
 * fail on a missing table, which is a harness artefact, not a real defect. Every
 * P2 DDL is `IF NOT EXISTS`, so callers that also create their own subset are
 * unaffected.
 */
export async function createHealthTables(db: D1Database): Promise<void> {
  for (const stmt of HEALTH_TABLE_DDL) {
    await db.exec(stmt.replace(/\s+/g, ' ').trim());
  }
  await createHealthFoodTables(db);
  await createBodyExtrasTables(db);
  await createHealthAssetTables(db);
}

/**
 * Truncate every health table so each spec starts from a clean slate.
 *
 * Covers the P2 tables too — `createHealthTables` now creates them, so leaving
 * them populated would leak rows between specs through the domain-wide sync
 * delta.
 */
export async function resetHealthTables(db: D1Database): Promise<void> {
  const allTables = [
    ...HEALTH_TABLE_NAMES,
    ...HEALTH_FOOD_TABLE_NAMES,
    ...HEALTH_P2_BODY_EXTRAS_TABLE_NAMES,
    ...HEALTH_P2_ASSETS_TABLE_NAMES,
    ...HEALTH_SUPPORTING_TABLE_NAMES,
  ];
  for (const t of allTables) {
    try {
      await db.exec(`DELETE FROM ${t}`);
    } catch {
      // table may not exist in this file's subset; ignore
    }
  }
}

/* ==================================================================== */
/* Parity phase P2 — FOOD group (migration 0120_health_p2.sql)           */
/* ==================================================================== */

/**
 * The three food tables of migration 0120, copied column-for-column.
 *
 * ADDITIVE by design: `createHealthTables` / `HEALTH_TABLE_NAMES` above are
 * untouched so the P1 suites keep the exact schema they were written against.
 * A food suite calls `createHealthTables` FIRST (it owns the `users` table every
 * row here FKs to), then `createHealthFoodTables`.
 *
 * The CHECK constraints are kept for the same reason as 0119's: they are what
 * makes an out-of-contract `meal_type`, `time_of_day` or `source_type` fail
 * loudly here instead of only in production. `share_code` keeps its UNIQUE —
 * sharing is P4, but a test must not pass on a laxer schema than the migration.
 *
 * As above, a later ADD-COLUMN migration is folded in rather than replayed:
 * `custom_foods.external_source` / `.external_id` and their partial UNIQUE index
 * come from 0127 (external food-database provenance).
 */
const HEALTH_FOOD_TABLE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS custom_foods (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    brand_name TEXT,
    portion REAL NOT NULL DEFAULT 100,
    unit TEXT NOT NULL DEFAULT 'g',
    calories REAL NOT NULL,
    proteins REAL NOT NULL DEFAULT 0,
    carbohydrates REAL NOT NULL DEFAULT 0,
    fats REAL NOT NULL DEFAULT 0,
    base_calories_per_100 REAL NOT NULL,
    base_proteins_per_100 REAL NOT NULL DEFAULT 0,
    base_carbs_per_100 REAL NOT NULL DEFAULT 0,
    base_fats_per_100 REAL NOT NULL DEFAULT 0,
    category TEXT,
    barcode TEXT,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    use_count INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT,
    preferred_meal_types TEXT NOT NULL DEFAULT '[]',
    source_type TEXT NOT NULL DEFAULT 'manual'
      CHECK (source_type IN ('manual', 'scanned', 'imported', 'shared', 'recipe')),
    source_recipe_id TEXT,
    external_source TEXT,
    external_id TEXT,
    is_shared INTEGER NOT NULL DEFAULT 0,
    share_code TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  // Migration 0127's partial UNIQUE index. Kept for the same reason the other
  // UNIQUE constraints are: it is what makes a racing double-import collapse to
  // one row, so dropping it here would let `importExternalFood` pass on a schema
  // the migration does not describe.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_foods_external
    ON custom_foods(user_id, external_source, external_id)
    WHERE external_source IS NOT NULL AND external_id IS NOT NULL AND deleted_at IS NULL`,

  `CREATE TABLE IF NOT EXISTS recipes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    ingredients TEXT NOT NULL DEFAULT '[]',
    servings INTEGER NOT NULL DEFAULT 1,
    total_calories REAL NOT NULL DEFAULT 0,
    total_proteins REAL NOT NULL DEFAULT 0,
    total_carbohydrates REAL NOT NULL DEFAULT 0,
    total_fats REAL NOT NULL DEFAULT 0,
    preparation_time INTEGER,
    cooking_time INTEGER,
    instructions TEXT,
    image_url TEXT,
    category TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    is_favorite INTEGER NOT NULL DEFAULT 0,
    use_count INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT,
    is_shared INTEGER NOT NULL DEFAULT 0,
    share_code TEXT UNIQUE,
    ai_calculated INTEGER NOT NULL DEFAULT 0,
    ai_confidence REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS food_usage_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    food_id TEXT NOT NULL,
    food_name TEXT NOT NULL,
    used_at TEXT NOT NULL,
    meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
    time_of_day TEXT NOT NULL
      CHECK (time_of_day IN ('morning', 'midday', 'afternoon', 'evening', 'night')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
];

/** Every P2 food table — used by resetHealthFoodTables. */
export const HEALTH_FOOD_TABLE_NAMES: readonly string[] = [
  'food_usage_history',
  'custom_foods',
  'recipes',
];

/** Create the 3 food tables of migration 0120 (run createHealthTables first). */
export async function createHealthFoodTables(db: D1Database): Promise<void> {
  for (const stmt of HEALTH_FOOD_TABLE_DDL) {
    await db.exec(stmt.replace(/\s+/g, ' ').trim());
  }
}

/** Truncate the food tables so each spec starts from a clean slate. */
export async function resetHealthFoodTables(db: D1Database): Promise<void> {
  for (const t of HEALTH_FOOD_TABLE_NAMES) {
    try {
      await db.exec(`DELETE FROM ${t}`);
    } catch {
      // table may not exist in this file's subset; ignore
    }
  }
}

/** Seed the platform users the health rows belong to. */
export async function seedHealthUsers(db: D1Database, userIds: string[]): Promise<void> {
  for (const id of userIds) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO users (id, email, email_verified) VALUES (?, ?, 1)`
      )
      .bind(id, `${id}@example.com`)
      .run();
  }
}

/* ==================================================================== */
/* Parity phase P2 — `body-extras` group                                 */
/* ==================================================================== */

/**
 * The subset of `migrations/0120_health_p2.sql` the body-extras domain reads and
 * writes: injuries, activity_notification_preferences, the two body-insight
 * tables — plus `user_files`, which the photo-insight FK points at.
 *
 * Additive on purpose: `createHealthTables` above stays the 0119 core, and this
 * runs alongside it. Every statement is `IF NOT EXISTS`, so another P2 helper
 * declaring the same `user_files` table is harmless.
 *
 * Same rules as the 0119 block: FOREIGN KEYs are KEPT (this pool enforces them,
 * exactly like deployed D1), and so are the CHECK constraints — the
 * `pain_level BETWEEN 0 AND 4` check is precisely what must fail loudly if the
 * route-level bound ever regresses.
 */
const HEALTH_P2_BODY_EXTRAS_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS user_files (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL CHECK (file_type IN ('photo', 'document', 'body_photo')),
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    storage_key TEXT NOT NULL,
    thumbnail_key TEXT,
    category TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS injuries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    body_part TEXT NOT NULL,
    pain_level INTEGER NOT NULL CHECK (pain_level >= 0 AND pain_level <= 4),
    injury_type TEXT NOT NULL DEFAULT 'pain',
    cause TEXT,
    muscle_group TEXT,
    notes TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS activity_notification_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    notify_recipe_created INTEGER NOT NULL DEFAULT 1,
    notify_recipe_updated INTEGER NOT NULL DEFAULT 0,
    notify_custom_food_created INTEGER NOT NULL DEFAULT 1,
    notify_workout_video_shared INTEGER NOT NULL DEFAULT 1,
    notify_photo_shared INTEGER NOT NULL DEFAULT 1,
    notify_milestone_achieved INTEGER NOT NULL DEFAULT 1,
    notify_community_recipe_created INTEGER NOT NULL DEFAULT 0,
    notify_community_achievement INTEGER NOT NULL DEFAULT 0,
    receive_push_notifications INTEGER NOT NULL DEFAULT 1,
    receive_inapp_notifications INTEGER NOT NULL DEFAULT 1,
    favourite_workout_types TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS body_photo_insights (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    photo_id TEXT NOT NULL,
    date TEXT NOT NULL,
    angle TEXT NOT NULL CHECK (angle IN ('front', 'back', 'leftSide', 'rightSide')),
    posture_score REAL,
    posture_head_alignment TEXT,
    posture_shoulder_alignment TEXT,
    posture_spine_alignment TEXT,
    posture_hip_alignment TEXT,
    posture_notes TEXT,
    symmetry_overall REAL,
    symmetry_shoulder REAL,
    symmetry_arm REAL,
    symmetry_leg REAL,
    symmetry_observations TEXT,
    body_fat_lower REAL,
    body_fat_upper REAL,
    body_fat_category TEXT,
    muscle_definition_score REAL,
    visible_muscles TEXT,
    analysis_provider TEXT,
    analysis_confidence REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (photo_id) REFERENCES user_files(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS body_comprehensive_insights (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    front_photo_id TEXT,
    back_photo_id TEXT,
    left_side_photo_id TEXT,
    right_side_photo_id TEXT,
    overall_posture_score REAL,
    posture_strengths TEXT,
    posture_concerns TEXT,
    posture_recommendations TEXT,
    overall_symmetry_score REAL,
    symmetry_findings TEXT,
    body_fat_estimate_lower REAL,
    body_fat_estimate_upper REAL,
    body_fat_category TEXT,
    lean_mass_estimate REAL,
    muscle_balance_score REAL,
    muscle_development_front TEXT,
    muscle_development_back TEXT,
    muscle_development_sides TEXT,
    areas_of_improvement TEXT,
    strengths TEXT,
    recommended_focus_areas TEXT,
    analysis_provider TEXT,
    analysis_confidence REAL,
    processing_notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (front_photo_id) REFERENCES user_files(id) ON DELETE SET NULL,
    FOREIGN KEY (back_photo_id) REFERENCES user_files(id) ON DELETE SET NULL,
    FOREIGN KEY (left_side_photo_id) REFERENCES user_files(id) ON DELETE SET NULL,
    FOREIGN KEY (right_side_photo_id) REFERENCES user_files(id) ON DELETE SET NULL
  )`,
];

/** Child-first order — the insight tables FK into `user_files`. */
export const HEALTH_P2_BODY_EXTRAS_TABLE_NAMES: readonly string[] = [
  'body_photo_insights',
  'body_comprehensive_insights',
  'activity_notification_preferences',
  'injuries',
  'user_files',
];

/** Create the body-extras subset of migration 0120 (run after createHealthTables). */
export async function createBodyExtrasTables(db: D1Database): Promise<void> {
  for (const stmt of HEALTH_P2_BODY_EXTRAS_DDL) {
    await db.exec(stmt.replace(/\s+/g, ' ').trim());
  }
}

/* ------------------------------------------------------------------ */
/* P3 — AI surfaces (migration 0128_health_ai.sql)                     */
/* ------------------------------------------------------------------ */

/**
 * The two AI-only tables. Columns match `0128_health_ai.sql` exactly, INCLUDING
 * the CHECK on `scope` and the partial UNIQUE index on (user_id, scope) — the
 * consent read is a "one live receipt per scope" query, so a helper without the
 * index would let a duplicate accumulate here that the real D1 refuses.
 */
const HEALTH_P3_AI_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS health_coach_consent_receipts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('insights', 'food_logging', 'weight_logging', 'water_logging', 'workout_logging')),
    granted INTEGER NOT NULL DEFAULT 0,
    version TEXT NOT NULL,
    granted_at TEXT,
    revoked_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_health_coach_consent_user_scope
    ON health_coach_consent_receipts(user_id, scope) WHERE deleted_at IS NULL`,

  `CREATE TABLE IF NOT EXISTS health_coach_operations (
    operation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    commit_status TEXT NOT NULL,
    expected_target_version INTEGER,
    result_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    PRIMARY KEY (user_id, operation_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
];

export const HEALTH_P3_AI_TABLE_NAMES: readonly string[] = [
  'health_coach_consent_receipts',
  'health_coach_operations',
];

export async function createHealthAiTables(db: D1Database): Promise<void> {
  for (const stmt of HEALTH_P3_AI_DDL) {
    await db.exec(stmt.replace(/\s+/g, ' ').trim());
  }
}

/** Truncate the AI tables so each spec starts from a clean slate. */
export async function resetHealthAiTables(db: D1Database): Promise<void> {
  for (const t of HEALTH_P3_AI_TABLE_NAMES) {
    try {
      await db.exec(`DELETE FROM ${t}`);
    } catch {
      // table may not exist in this file's subset; ignore
    }
  }
}

/** Truncate the body-extras tables so each spec starts from a clean slate. */
export async function resetBodyExtrasTables(db: D1Database): Promise<void> {
  for (const t of HEALTH_P2_BODY_EXTRAS_TABLE_NAMES) {
    try {
      await db.exec(`DELETE FROM ${t}`);
    } catch {
      // table may not exist in this file's subset; ignore
    }
  }
}

/** Seed a `user_files` photo row — what a body-photo insight must point at. */
export async function seedUserFile(
  db: D1Database,
  userId: string,
  fileId: string
): Promise<string> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT OR IGNORE INTO user_files
        (id, user_id, file_name, file_type, mime_type, file_size, storage_key, created_at, updated_at)
       VALUES (?, ?, ?, 'body_photo', 'image/jpeg', 1024, ?, ?, ?)`
    )
    .bind(fileId, userId, `${fileId}.jpg`, `health/${userId}/${fileId}.jpg`, now, now)
    .run();
  return fileId;
}

/* ==================================================================== */
/* Parity phase P2 — `assets` group (files / widget / fridge)            */
/* ==================================================================== */

/**
 * The subset of `migrations/0120_health_p2.sql` the assets domain reads and
 * writes: `user_files`, `widget_preferences`, `fridge_items`.
 *
 * Additive, same as the food and body-extras blocks: `createHealthTables` stays
 * the 0119 core and this runs alongside it. Every statement is `IF NOT EXISTS`,
 * so the `user_files` declaration shared with the body-extras block is harmless
 * — both copies are column-for-column the migration.
 *
 * CHECKs are KEPT, and here they are the point of the suite: this pool enforces
 * them exactly like deployed D1, so `fridge_items`' `length(name) <= 200`,
 * `quantity >= 0`, `length(notes) <= 1000` and the `source` enum are what turn
 * a missing zod rule into a visible failure instead of a silent 500 in prod.
 * `widget_preferences.user_id` keeps its UNIQUE — the service upserts through
 * `onConflictDoUpdate` on it, so dropping it would let every PUT insert a
 * duplicate row and the tests would pass on a schema the migration disowns.
 */
const HEALTH_P2_ASSETS_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS user_files (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL CHECK (file_type IN ('photo', 'document', 'body_photo')),
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    storage_key TEXT NOT NULL,
    thumbnail_key TEXT,
    category TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS widget_preferences (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    small_widget_metric TEXT NOT NULL DEFAULT 'steps'
      CHECK (small_widget_metric IN ('steps', 'calories', 'water')),
    chart_type TEXT NOT NULL DEFAULT 'bar' CHECK (chart_type IN ('bar', 'line')),
    chart_metric TEXT NOT NULL DEFAULT 'weight'
      CHECK (chart_metric IN ('weight', 'nutrition', 'both')),
    show_weight INTEGER NOT NULL DEFAULT 1,
    show_nutrition INTEGER NOT NULL DEFAULT 1,
    show_workouts INTEGER NOT NULL DEFAULT 1,
    small_widget_style TEXT NOT NULL DEFAULT 'standard'
      CHECK (small_widget_style IN ('standard', 'compact', 'minimal')),
    medium_widget_layout TEXT NOT NULL DEFAULT 'standard'
      CHECK (medium_widget_layout IN ('standard', 'dual', 'grid')),
    medium_primary_metric TEXT NOT NULL DEFAULT 'steps'
      CHECK (medium_primary_metric IN ('steps', 'calories', 'water', 'workout')),
    medium_secondary_metric TEXT NOT NULL DEFAULT 'calories'
      CHECK (medium_secondary_metric IN ('steps', 'calories', 'water', 'workout')),
    medium_show_all_metrics INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS fridge_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 200),
    quantity REAL CHECK (quantity IS NULL OR quantity >= 0),
    unit TEXT CHECK (unit IS NULL OR length(unit) <= 20),
    category TEXT CHECK (category IS NULL OR length(category) <= 50),
    expiry_date TEXT,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    nutrition_json TEXT,
    source TEXT NOT NULL DEFAULT 'manual'
      CHECK (source IN ('manual', 'scan', 'receipt', 'photo')),
    image_url TEXT,
    notes TEXT CHECK (notes IS NULL OR length(notes) <= 1000),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
];

/** Every P2 assets table — used by resetHealthAssetTables. */
export const HEALTH_P2_ASSETS_TABLE_NAMES: readonly string[] = [
  'fridge_items',
  'widget_preferences',
  'user_files',
];

/** Create the assets subset of migration 0120 (run after createHealthTables). */
export async function createHealthAssetTables(db: D1Database): Promise<void> {
  for (const stmt of HEALTH_P2_ASSETS_DDL) {
    await db.exec(stmt.replace(/\s+/g, ' ').trim());
  }
}

/** Truncate the assets tables so each spec starts from a clean slate. */
export async function resetHealthAssetTables(db: D1Database): Promise<void> {
  for (const t of HEALTH_P2_ASSETS_TABLE_NAMES) {
    try {
      await db.exec(`DELETE FROM ${t}`);
    } catch {
      // table may not exist in this file's subset; ignore
    }
  }
}

/* ==================================================================== */
/* Parity phase P4 — SOCIAL group (migration 0121_health_social.sql)      */
/* ==================================================================== */

/**
 * The 11 social tables of migration 0121, copied column-for-column.
 *
 * ADDITIVE, same rule as the P2 blocks above: `createHealthTables` /
 * `HEALTH_TABLE_NAMES` stay the 0119 core, and a social suite calls
 * `createHealthTables` FIRST (it owns the `users` table every row here FKs to),
 * then `createHealthSocialTables`.
 *
 * The CHECK constraints are the point of this block and are all KEPT — this
 * pool enforces them exactly like deployed D1:
 *   * `health_metric_shares.scope` is a hard allowlist. If a service bug ever
 *     tried to persist a `cycle` / `vitality` / `body_photos` /
 *     `body_measurements` grant, D1 would REJECT the insert. The suite asserts
 *     that directly, so the exclusion is proven at the storage layer and not
 *     only at the zod/service layer.
 *   * `health_metric_shares` also keeps `CHECK (owner_id <> viewer_id)` — a
 *     self-grant is meaningless and would make "who can read me?" ambiguous.
 *   * `health_challenges.metric` carries the same allowlist, so a challenge can
 *     never be built on a sensitive domain.
 *
 * The PARTIAL UNIQUE indexes are kept too (`WHERE deleted_at IS NULL`): one
 * active family membership per user, one active seat per challenge/topic, one
 * progress row per (challenge, user, day). Dropping them would let a leave +
 * rejoin cycle silently duplicate rows and the tests would pass on a schema the
 * migration does not describe. `idx_health_metric_shares_grant` is FULL, not
 * partial, because grants are revoked in place and never deleted — that is what
 * makes `onConflictDoUpdate` revive a revoked grant instead of duplicating it.
 */
const HEALTH_SOCIAL_TABLE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS health_families (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 80),
    owner_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS health_family_members (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
    joined_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (family_id) REFERENCES health_families(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS health_family_invitations (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    inviter_id TEXT NOT NULL,
    invitee_id TEXT,
    invitee_email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
    message TEXT CHECK (message IS NULL OR length(message) <= 500),
    invite_code TEXT NOT NULL,
    responded_at TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (family_id) REFERENCES health_families(id) ON DELETE CASCADE,
    FOREIGN KEY (inviter_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (invitee_id) REFERENCES users(id) ON DELETE SET NULL
  )`,

  `CREATE TABLE IF NOT EXISTS health_buddies (
    id TEXT PRIMARY KEY,
    requester_id TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    recipient_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'accepted', 'declined')),
    message TEXT CHECK (message IS NULL OR length(message) <= 500),
    responded_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS health_community_topics (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK (length(title) > 0 AND length(title) <= 120),
    description TEXT CHECK (description IS NULL OR length(description) <= 500),
    category TEXT NOT NULL CHECK (category IN
      ('nutrition', 'fitness', 'recipes', 'motivation', 'tips', 'general', 'challenges')),
    icon TEXT,
    color TEXT,
    creator_id TEXT NOT NULL,
    is_locked INTEGER NOT NULL DEFAULT 0,
    message_count INTEGER NOT NULL DEFAULT 0,
    participant_count INTEGER NOT NULL DEFAULT 1,
    last_message_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS health_community_participants (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('creator', 'moderator', 'member')),
    last_read_at TEXT,
    joined_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (topic_id) REFERENCES health_community_topics(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS health_community_messages (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL CHECK (length(content) > 0 AND length(content) <= 2000),
    reply_to_id TEXT,
    is_edited INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (topic_id) REFERENCES health_community_topics(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reply_to_id) REFERENCES health_community_messages(id) ON DELETE SET NULL
  )`,

  `CREATE TABLE IF NOT EXISTS health_challenges (
    id TEXT PRIMARY KEY,
    creator_id TEXT NOT NULL,
    name TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 120),
    description TEXT CHECK (description IS NULL OR length(description) <= 1000),
    metric TEXT NOT NULL CHECK (metric IN
      ('activity', 'nutrition', 'weight', 'water', 'habits', 'sleep')),
    target_value REAL NOT NULL CHECK (target_value > 0),
    unit TEXT NOT NULL DEFAULT 'unit' CHECK (length(unit) <= 20),
    frequency TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily', 'weekly')),
    visibility TEXT NOT NULL DEFAULT 'family'
      CHECK (visibility IN ('public', 'family', 'buddies')),
    start_date TEXT NOT NULL,
    end_date TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    participant_count INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS health_challenge_participants (
    id TEXT PRIMARY KEY,
    challenge_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (challenge_id) REFERENCES health_challenges(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS health_challenge_progress (
    id TEXT PRIMARY KEY,
    challenge_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    value REAL NOT NULL DEFAULT 0 CHECK (value >= 0),
    target_value REAL NOT NULL,
    is_completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (challenge_id) REFERENCES health_challenges(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  // The scoped grant. `scope` CHECK = the storage-layer half of "cycle,
  // vitality, body photos and body measurements can never be shared".
  `CREATE TABLE IF NOT EXISTS health_metric_shares (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    viewer_id TEXT NOT NULL,
    relationship_type TEXT NOT NULL CHECK (relationship_type IN ('family', 'buddy')),
    relationship_id TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN
      ('activity', 'nutrition', 'weight', 'water', 'habits', 'sleep')),
    granted_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    CHECK (owner_id <> viewer_id),
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
];

/** The uniqueness rules of 0121 — kept because the service upserts against them. */
const HEALTH_SOCIAL_INDEX_DDL: string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_health_families_owner_active
     ON health_families(owner_id) WHERE deleted_at IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_health_family_members_user_active
     ON health_family_members(user_id) WHERE deleted_at IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_health_family_invites_code
     ON health_family_invitations(invite_code)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_health_buddies_pair_active
     ON health_buddies(requester_id, recipient_email) WHERE deleted_at IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_health_community_participants_active
     ON health_community_participants(topic_id, user_id) WHERE deleted_at IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_health_challenge_participants_active
     ON health_challenge_participants(challenge_id, user_id) WHERE deleted_at IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_health_challenge_progress_active
     ON health_challenge_progress(challenge_id, user_id, date) WHERE deleted_at IS NULL`,
  // FULL, not partial — `onConflictDoUpdate` revives a revoked grant in place.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_health_metric_shares_grant
     ON health_metric_shares(owner_id, viewer_id, relationship_type, scope)`,
];

/** Child-first order — every reset must respect the FK graph. */
export const HEALTH_SOCIAL_TABLE_NAMES: readonly string[] = [
  'health_metric_shares',
  'health_challenge_progress',
  'health_challenge_participants',
  'health_challenges',
  'health_community_messages',
  'health_community_participants',
  'health_community_topics',
  'health_buddies',
  'health_family_invitations',
  'health_family_members',
  'health_families',
];

/** Create the 11 social tables of migration 0121 (run createHealthTables first). */
export async function createHealthSocialTables(db: D1Database): Promise<void> {
  for (const stmt of [...HEALTH_SOCIAL_TABLE_DDL, ...HEALTH_SOCIAL_INDEX_DDL]) {
    await db.exec(stmt.replace(/\s+/g, ' ').trim());
  }
}

/** Truncate the social tables so each spec starts from a clean slate. */
export async function resetHealthSocialTables(db: D1Database): Promise<void> {
  for (const t of HEALTH_SOCIAL_TABLE_NAMES) {
    try {
      await db.exec(`DELETE FROM ${t}`);
    } catch {
      // table may not exist in this file's subset; ignore
    }
  }
}

/* ==================================================================== */
/* Raw row fixtures — sync conflict specs                                */
/* ==================================================================== */

/**
 * ADDITIVE, and deliberately raw SQL rather than a service call.
 *
 * The sync suites reconcile on `updated_at`, so a fixture has to be able to
 * state a row's timestamp EXACTLY (older than / equal to / newer than the row a
 * device is about to push). Every service writer stamps `new Date()`, which
 * makes "the server row is 1 hour newer" unexpressible through the domain API.
 */
export type HealthCell = string | number | null;

/** Insert one row verbatim — the caller owns every column, including stamps. */
export async function insertHealthRow(
  db: D1Database,
  table: string,
  row: Record<string, HealthCell>
): Promise<void> {
  const columns = Object.keys(row);
  const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns
    .map(() => '?')
    .join(', ')})`;
  await db
    .prepare(sql)
    .bind(...columns.map((c) => row[c]))
    .run();
}

/** Read one row back by id — asserts what ACTUALLY landed, not what was returned. */
export async function readHealthRow<T = Record<string, unknown>>(
  db: D1Database,
  table: string,
  id: string
): Promise<T | null> {
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first<T>();
}

/** Every row of a table, oldest id first — for "nothing was written" assertions. */
export async function listHealthRows<T = Record<string, unknown>>(
  db: D1Database,
  table: string
): Promise<T[]> {
  const res = await db.prepare(`SELECT * FROM ${table} ORDER BY id`).all<T>();
  return res.results ?? [];
}

/* ==================================================================== */
/* WORKOUT LIBRARY (migration 0123_health_exercise_library.sql)          */
/* ==================================================================== */

/**
 * The two catalogue tables of migration 0123, copied column-for-column.
 *
 * ADDITIVE, same rule as the P2/P4 blocks above: `createHealthTables` /
 * `HEALTH_TABLE_NAMES` stay untouched, and an exercise suite calls
 * `createHealthTables` FIRST — it owns both the `users` table `exercise_favorites`
 * FKs to AND the `injuries` table the INJURY GATE reads — then
 * `createHealthExerciseTables`.
 *
 * The CHECK constraints are the point of this block and are KEPT: `category`,
 * `difficulty` and `workout_type` are closed vocabularies, and `workout_type` in
 * particular has to stay a value the EXISTING `/health/entries/workouts` route
 * accepts — a catalogue row that cannot be logged is a dead row. The UNIQUE on
 * (user_id, exercise_id) is kept because un-favouriting SOFT deletes and
 * re-favouriting revives the same row; without it the tests would pass on a
 * schema that silently accumulates one tombstone per toggle.
 *
 * NOTE FOR FUTURE EDITORS: no `--` comment may appear inside these DDL strings.
 * `createHealthExerciseTables` collapses each statement to one line before
 * `exec`, so a comment would swallow the rest of the table.
 */
const HEALTH_EXERCISE_TABLE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS exercise_library (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    aliases TEXT NOT NULL DEFAULT '[]',
    category TEXT NOT NULL CHECK (category IN (
      'strength', 'cardio', 'yoga', 'stretching', 'mobility', 'rehabilitation', 'recovery'
    )),
    muscle_groups TEXT NOT NULL DEFAULT '[]',
    secondary_muscles TEXT NOT NULL DEFAULT '[]',
    equipment TEXT NOT NULL DEFAULT '[]',
    body_parts TEXT NOT NULL DEFAULT '[]',
    difficulty TEXT NOT NULL DEFAULT 'level1' CHECK (difficulty IN (
      'level1', 'level2', 'level3', 'level4', 'level5'
    )),
    instructions TEXT,
    illustration TEXT,
    media_url TEXT,
    default_minutes INTEGER NOT NULL DEFAULT 10,
    workout_type TEXT NOT NULL DEFAULT 'strength' CHECK (workout_type IN (
      'walk', 'run', 'strength', 'cycle', 'swim', 'yoga', 'other'
    )),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS exercise_favorites (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    exercise_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE(user_id, exercise_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (exercise_id) REFERENCES exercise_library(id) ON DELETE CASCADE
  )`,
];

/** Child first — `exercise_favorites` FKs to `exercise_library`. */
export const HEALTH_EXERCISE_TABLE_NAMES: readonly string[] = [
  'exercise_favorites',
  'exercise_library',
];

/** Create the 2 catalogue tables of migration 0123 (run createHealthTables first). */
export async function createHealthExerciseTables(db: D1Database): Promise<void> {
  for (const stmt of HEALTH_EXERCISE_TABLE_DDL) {
    await db.exec(stmt.replace(/\s+/g, ' ').trim());
  }
}

/** Truncate the catalogue tables so each spec starts from a clean slate. */
export async function resetHealthExerciseTables(db: D1Database): Promise<void> {
  for (const t of HEALTH_EXERCISE_TABLE_NAMES) {
    try {
      await db.exec(`DELETE FROM ${t}`);
    } catch {
      // table may not exist in this file's subset; ignore
    }
  }
}

/**
 * Load the REAL shipped catalogue out of `migrations/0123_health_exercise_library.sql`.
 *
 * Deliberately the migration file rather than a hand-written fixture: the seed
 * IS the feature ("a library with no exercises is not a feature"), so the suites
 * must run against the rows users will actually get. A fixture would let the
 * shipped catalogue rot — wrong muscle token, a `workout_type` the entries route
 * rejects, an unbalanced JSON column — with every test still green.
 *
 * Returns how many catalogue rows landed.
 */
export async function seedExerciseCatalogueFromMigration(db: D1Database): Promise<number> {
  const sql = await import('../../../migrations/0123_health_exercise_library.sql?raw').then(
    (m: { default: string }) => m.default,
  );

  // ORDER MATTERS: comments are stripped BEFORE the statement split. A `--`
  // comment may contain a semicolon, and splitting first would leave the tail of
  // that sentence as the start of the "next statement".
  const stripped = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  // Statement split on `;`. Safe for THIS file: every remaining semicolon
  // terminates a statement (no seeded instruction text contains one), and the
  // only quoting inside a literal is the doubled `''` apostrophe.
  for (const chunk of stripped.split(';')) {
    const statement = chunk.replace(/\s+/g, ' ').trim();
    if (statement.length === 0) continue;
    // The CREATE TABLE statements are already applied by
    // `createHealthExerciseTables`; running them again is a no-op (IF NOT EXISTS).
    await db.exec(statement);
  }

  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM exercise_library')
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/* ==================================================================== */
/* Personal FOOD CHALLENGES (migration 0136_food_challenges.sql)         */
/* ==================================================================== */

/**
 * The four tables of migration 0136, copied column-for-column (minus the ~115
 * seed rows of `food_category_mappings` — see `seedFoodCategoryMappings` for a
 * small, test-sized subset instead of replaying the whole migration).
 *
 * ADDITIVE, same rule as every other P-group above: `createHealthTables`
 * already owns `users` and (as of this migration) the three new
 * `nutrition_entries` columns these tables key off of; a challenges suite
 * calls `createHealthTables` first, then `createHealthChallengesTables`.
 *
 * UNIQUE indexes are FULL, not partial — these tables have no `deleted_at`
 * (donor 041/049; see the migration header) — and are KEPT because the
 * service upserts through `onConflictDoUpdate` on (challenge_id, date) /
 * (user_id, achievement_type).
 */
const HEALTH_CHALLENGES_TABLE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS food_challenges (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    target_category TEXT,
    target_food_name TEXT,
    target_amount_grams REAL NOT NULL,
    frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly')),
    start_date TEXT NOT NULL,
    end_date TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    custom_icon TEXT,
    current_streak INTEGER NOT NULL DEFAULT 0,
    longest_streak INTEGER NOT NULL DEFAULT 0,
    total_completions INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS challenge_progress (
    id TEXT PRIMARY KEY,
    challenge_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    consumed_grams REAL NOT NULL DEFAULT 0,
    target_grams REAL NOT NULL,
    is_completed INTEGER NOT NULL DEFAULT 0,
    matched_foods TEXT NOT NULL DEFAULT '[]',
    last_updated_at TEXT NOT NULL,
    FOREIGN KEY (challenge_id) REFERENCES food_challenges(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_challenge_progress_unique ON challenge_progress(challenge_id, date)`,

  `CREATE TABLE IF NOT EXISTS challenge_achievements (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    achievement_type TEXT NOT NULL,
    challenge_id TEXT,
    unlocked_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (challenge_id) REFERENCES food_challenges(id) ON DELETE SET NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_challenge_achievements_unique ON challenge_achievements(user_id, achievement_type)`,

  `CREATE TABLE IF NOT EXISTS food_category_mappings (
    id TEXT PRIMARY KEY,
    food_name_pattern TEXT NOT NULL,
    category TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 1.0,
    created_at TEXT NOT NULL
  )`,
];

/** Child-first order — the two child tables FK into `food_challenges`. */
export const HEALTH_CHALLENGES_TABLE_NAMES: readonly string[] = [
  'challenge_progress',
  'challenge_achievements',
  'food_challenges',
  'food_category_mappings',
];

/** Create the 4 tables of migration 0136 (run createHealthTables first). */
export async function createHealthChallengesTables(db: D1Database): Promise<void> {
  for (const stmt of HEALTH_CHALLENGES_TABLE_DDL) {
    await db.exec(stmt.replace(/\s+/g, ' ').trim());
  }
}

/** Truncate the challenges tables so each spec starts from a clean slate. */
export async function resetHealthChallengesTables(db: D1Database): Promise<void> {
  for (const t of HEALTH_CHALLENGES_TABLE_NAMES) {
    try {
      await db.exec(`DELETE FROM ${t}`);
    } catch {
      // table may not exist in this file's subset; ignore
    }
  }
}

/**
 * A small, hand-picked subset of the donor's ~115 `food_category_mappings`
 * seed rows — enough to exercise every category branch a challenge spec needs
 * without replaying the whole migration's INSERT block.
 */
export async function seedFoodCategoryMappings(db: D1Database): Promise<void> {
  const rows: Array<[string, string, string, number]> = [
    ['t-fcm-broccoli', 'broccoli', 'vegetables', 1.0],
    ['t-fcm-spinach', 'spinach', 'vegetables', 1.0],
    ['t-fcm-lettuce', 'lettuce', 'vegetables', 1.0],
    ['t-fcm-tomato', 'tomato', 'vegetables', 1.0],
    ['t-fcm-carrot', 'carrot', 'vegetables', 1.0],
    ['t-fcm-avocado', 'avocado', 'vegetables', 0.9],
    ['t-fcm-apple', 'apple', 'fruits', 1.0],
    ['t-fcm-banana', 'banana', 'fruits', 1.0],
    ['t-fcm-strawberry', 'strawberry', 'fruits', 1.0],
    ['t-fcm-salmon', 'salmon', 'fish', 1.0],
    ['t-fcm-shrimp', 'shrimp', 'seafood', 1.0],
    ['t-fcm-chicken', 'chicken', 'meat', 1.0],
    ['t-fcm-beef', 'beef', 'meat', 1.0],
    ['t-fcm-yogurt', 'yogurt', 'dairy', 1.0],
    ['t-fcm-cheese', 'cheese', 'dairy', 1.0],
    ['t-fcm-rice', 'rice', 'grains', 1.0],
    ['t-fcm-lentils', 'lentils', 'legumes', 1.0],
    ['t-fcm-almonds', 'almonds', 'nuts', 1.0],
  ];
  const now = new Date().toISOString();
  for (const [id, pattern, category, confidence] of rows) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO food_category_mappings (id, food_name_pattern, category, confidence, created_at) VALUES (?, ?, ?, ?, ?)`
      )
      .bind(id, pattern, category, confidence, now)
      .run();
  }
}
