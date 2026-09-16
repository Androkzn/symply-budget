-- Symply Health — parity phase P2 tables.
--
-- Ported from the donor Worker (`~/Desktop/Symply Ecosystem/Simply Health/backend/migrations/`):
--   002_user_files.sql                          → user_files
--   021_injuries.sql                            → injuries
--   022_body_photo_measurements_and_insights.sql→ body_photo_insights, body_comprehensive_insights
--   028_custom_foods_recipes_sharing.sql        → custom_foods, recipes, food_usage_history
--   030_smart_fridge.sql                        → fridge_items
--   032_widget_preferences.sql                  → widget_preferences
--   074_activity_notification_preferences.sql   → activity_notification_preferences
--
-- Conventions carried from 0119: user-scoped (health data is personal, never
-- household), soft deletes + `updated_at` everywhere so the delta-sync cursor
-- can carry tombstones, and `users` is the PLATFORM users table.
--
-- Deviations from the donor, and why:
--   * `fridge_items` used unix-epoch INTEGER timestamps while every other donor
--     table used ISO TEXT. Normalised to ISO TEXT here so one sync cursor works
--     across the whole domain — a mixed-type cursor cannot be compared in SQL.
--   * Donor `custom_foods.share_code` / `recipes.share_code` are globally UNIQUE
--     because they back a public share link. Kept, but sharing itself is a P4
--     surface behind privacy review; until then the column is simply unused.

-- ============ Files (R2 objects) ============
-- Referenced by the body-photo insight tables, so it is created first.
CREATE TABLE IF NOT EXISTS user_files (
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
);
CREATE INDEX IF NOT EXISTS idx_user_files_user ON user_files(user_id, file_type);
CREATE INDEX IF NOT EXISTS idx_user_files_sync ON user_files(user_id, updated_at);

-- ============ Custom foods ============
-- `base_*_per_100` is what makes portion maths exact: the donor stores the
-- per-100g basis and derives the logged portion from it, rather than scaling an
-- already-rounded serving and compounding the error.
CREATE TABLE IF NOT EXISTS custom_foods (
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
  is_shared INTEGER NOT NULL DEFAULT 0,
  share_code TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_custom_foods_user ON custom_foods(user_id, is_favorite, use_count);
CREATE INDEX IF NOT EXISTS idx_custom_foods_barcode ON custom_foods(user_id, barcode);
CREATE INDEX IF NOT EXISTS idx_custom_foods_sync ON custom_foods(user_id, updated_at);

-- ============ Recipes ============
CREATE TABLE IF NOT EXISTS recipes (
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
);
CREATE INDEX IF NOT EXISTS idx_recipes_user ON recipes(user_id, is_favorite, use_count);
CREATE INDEX IF NOT EXISTS idx_recipes_sync ON recipes(user_id, updated_at);

-- Powers the donor's "what you usually eat at this time of day" suggestions.
CREATE TABLE IF NOT EXISTS food_usage_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  food_id TEXT NOT NULL,
  food_name TEXT NOT NULL,
  used_at TEXT NOT NULL,
  meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  time_of_day TEXT NOT NULL
    CHECK (time_of_day IN ('morning', 'midday', 'afternoon', 'evening', 'night')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_food_usage_user ON food_usage_history(user_id, used_at);

-- ============ Injuries ============
-- Gates workout suggestions: an active injury on a body part must suppress the
-- exercises that load it.
CREATE TABLE IF NOT EXISTS injuries (
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
);
CREATE INDEX IF NOT EXISTS idx_injuries_user ON injuries(user_id, is_active, date);
CREATE INDEX IF NOT EXISTS idx_injuries_sync ON injuries(user_id, updated_at);

-- ============ Activity notification preferences ============
CREATE TABLE IF NOT EXISTS activity_notification_preferences (
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ============ Widget preferences ============
CREATE TABLE IF NOT EXISTS widget_preferences (
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============ Fridge ============
-- Donor used unix-epoch INTEGERs here; normalised to ISO TEXT (see header).
CREATE TABLE IF NOT EXISTS fridge_items (
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
);
CREATE INDEX IF NOT EXISTS idx_fridge_user ON fridge_items(user_id, expiry_date);
CREATE INDEX IF NOT EXISTS idx_fridge_sync ON fridge_items(user_id, updated_at);

-- ============ Body insights (AI-derived, P2 storage / P3 producer) ============
CREATE TABLE IF NOT EXISTS body_photo_insights (
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
);
CREATE INDEX IF NOT EXISTS idx_body_photo_insights_user ON body_photo_insights(user_id, date);

CREATE TABLE IF NOT EXISTS body_comprehensive_insights (
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
);
CREATE INDEX IF NOT EXISTS idx_body_insights_user ON body_comprehensive_insights(user_id, date);
