-- Symply Health — core tracking tables (parity phase P1).
--
-- Ported from the donor Worker (`~/Desktop/Symply Ecosystem/Simply Health/backend/migrations/`):
--   001_init.sql              → health_entries, weight_entries, nutrition_entries, body_measurements
--   010_weekly_weight_averages.sql → health_weekly_weight_averages
--   015_water_entries.sql     → water_entries
--   019_habits.sql            → user_habits, habit_logs
--   020_womens_health.sql     → cycle_settings, period_entries, cycle_symptom_entries
--   038_mens_health.sql       → mens_health_entries, mens_health_settings
--   060_goal_history.sql      → health_goals
--
-- Deviations from the donor, and why:
--   * `users` here is the PLATFORM users table (shared auth) — the donor's own
--     auth stack is NOT ported (see PARITY_PLAN.md §2 "reuse-not-port").
--   * Soft deletes (`deleted_at`) are kept on every log table because the donor's
--     delta-sync contract depends on tombstones surviving a pull.
--   * `updated_at` is kept everywhere for the same reason — it is the sync cursor.
--   * Donor `weight_entries.unit` allowed 'kg'|'lbs'; the RN app has always used
--     'kg'|'lb'. Both are accepted so donor rows import unchanged.
--
-- Health-brand Worker only (`symply-health-api`). Applying this on House/Budget
-- is harmless — the routes 404 without the `healthApi` brand capability.

-- ============ Generic health metric log (steps / sleep / heart rate / energy / workout) ============
-- Donor kept these in one table keyed by `entry_type` with a JSON `data` blob, so
-- a new metric never needs a migration. Preserved verbatim.
CREATE TABLE IF NOT EXISTS health_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('steps', 'workout', 'sleep', 'heart_rate', 'active_energy')),
  data TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('healthkit', 'manual')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_health_entries_user_date ON health_entries(user_id, date);
CREATE INDEX IF NOT EXISTS idx_health_entries_user_type ON health_entries(user_id, entry_type, date);
CREATE INDEX IF NOT EXISTS idx_health_entries_sync ON health_entries(user_id, updated_at);

-- ============ Weight ============
CREATE TABLE IF NOT EXISTS weight_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  weight REAL NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('kg', 'lb', 'lbs')),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_weight_entries_user_date ON weight_entries(user_id, date);
CREATE INDEX IF NOT EXISTS idx_weight_entries_sync ON weight_entries(user_id, updated_at);

-- Donor's precomputed weekly rollup (010). Recomputed on write rather than by a
-- cron so a single-device user never sees a stale week.
CREATE TABLE IF NOT EXISTS health_weekly_weight_averages (
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
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, week_start)
);
CREATE INDEX IF NOT EXISTS idx_weekly_weight_user ON health_weekly_weight_averages(user_id, week_start);

-- ============ Water ============
CREATE TABLE IF NOT EXISTS water_entries (
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
);
CREATE INDEX IF NOT EXISTS idx_water_entries_user_date ON water_entries(user_id, date);
CREATE INDEX IF NOT EXISTS idx_water_entries_sync ON water_entries(user_id, updated_at);

-- ============ Nutrition ============
CREATE TABLE IF NOT EXISTS nutrition_entries (
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_nutrition_entries_user_date ON nutrition_entries(user_id, date);
CREATE INDEX IF NOT EXISTS idx_nutrition_entries_sync ON nutrition_entries(user_id, updated_at);

-- ============ Body measurements ============
-- Donor split arms/thighs left+right (001) and later added a comprehensive set
-- (017/025). The comprehensive columns are folded in here so one table covers
-- both, and the RN screen's simplified waist/chest/hips/arm/thigh maps onto the
-- left-side columns for symmetry with the donor's reader.
CREATE TABLE IF NOT EXISTS body_measurements (
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_body_measurements_user_date ON body_measurements(user_id, date);
CREATE INDEX IF NOT EXISTS idx_body_measurements_sync ON body_measurements(user_id, updated_at);

-- ============ Habits ============
CREATE TABLE IF NOT EXISTS user_habits (
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
);
CREATE INDEX IF NOT EXISTS idx_user_habits_user ON user_habits(user_id, is_archived, sort_order);
CREATE INDEX IF NOT EXISTS idx_user_habits_sync ON user_habits(user_id, updated_at);

-- One row per habit per completed day. UNIQUE keeps a double-tap idempotent
-- instead of inflating the streak.
CREATE TABLE IF NOT EXISTS habit_logs (
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
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (habit_id) REFERENCES user_habits(id) ON DELETE CASCADE,
  UNIQUE(habit_id, date)
);
CREATE INDEX IF NOT EXISTS idx_habit_logs_user_date ON habit_logs(user_id, date);
CREATE INDEX IF NOT EXISTS idx_habit_logs_sync ON habit_logs(user_id, updated_at);

-- ============ Women's health (cycle) ============
CREATE TABLE IF NOT EXISTS cycle_settings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  cycle_length INTEGER NOT NULL DEFAULT 28,
  period_length INTEGER NOT NULL DEFAULT 5,
  last_period_start TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS period_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  flow_level INTEGER NOT NULL DEFAULT 3,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_period_entries_user_date ON period_entries(user_id, date);
CREATE INDEX IF NOT EXISTS idx_period_entries_sync ON period_entries(user_id, updated_at);

-- Donor stored each symptom as its own severity column rather than a JSON blob,
-- so a symptom can be queried/aggregated in SQL. Kept as-is.
CREATE TABLE IF NOT EXISTS cycle_symptom_entries (
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
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_cycle_symptoms_user_date ON cycle_symptom_entries(user_id, date);
CREATE INDEX IF NOT EXISTS idx_cycle_symptoms_sync ON cycle_symptom_entries(user_id, updated_at);

-- ============ Men's health (vitality) ============
CREATE TABLE IF NOT EXISTS mens_health_entries (
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
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_mens_health_user_date ON mens_health_entries(user_id, date);
CREATE INDEX IF NOT EXISTS idx_mens_health_sync ON mens_health_entries(user_id, updated_at);

CREATE TABLE IF NOT EXISTS mens_health_settings (
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
);

-- ============ Goals ============
-- Donor's `goal_history` is effective-dated so a goal change does not rewrite
-- history: a past day is still scored against the goal in force that day.
CREATE TABLE IF NOT EXISTS health_goals (
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
  daily_water_ml INTEGER,
  daily_steps INTEGER,
  daily_active_calories INTEGER,
  daily_workout_minutes INTEGER,
  daily_sleep_hours REAL,
  exclude_burned_calories INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, effective_date)
);
CREATE INDEX IF NOT EXISTS idx_health_goals_user ON health_goals(user_id, effective_date);
