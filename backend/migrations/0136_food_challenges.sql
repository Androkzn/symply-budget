-- Symply Health — personal FOOD CHALLENGES. Backend support for the Dashboard
-- home tab's "Food Challenges" widget: weekly/daily gram targets like "Eat
-- 1000g vegetables this week", plus the columns on `nutrition_entries` the
-- progress calculation reads to decide what counts.
--
-- ============================ WHY THIS EXISTS ==============================
--
-- The Health app's Dashboard tab ships a Food Challenges card in the donor
-- (SwiftUI) app with nothing behind it on this ecosystem's Worker — no table,
-- no route. Without this migration there is nowhere to store a challenge, no
-- cache for its daily progress, and `nutrition_entries` has no signal a
-- progress calculation could match against (no category, no "is this a
-- composite dish" flag, no link back to a recipe).
--
-- ============================ DONOR MAPPING =================================
--
-- Donor = `~/Desktop/Symply Ecosystem/Simply Health/`, read-only.
-- Sources: `backend/migrations/036_food_challenges.sql` (initial schema + seed),
--          `backend/migrations/041_remove_soft_delete.sql` (drops deleted_at),
--          `backend/migrations/049_remove_partial_unique_indexes.sql` (full
--            unique indexes, required for ON CONFLICT upserts),
--          `backend/migrations/050_challenge_custom_icon.sql` (custom_icon),
--          `backend/migrations/052_nutrition_detected_category.sql`,
--          `backend/migrations/061_add_is_processed_to_nutrition_entries.sql`,
--          `backend/migrations/077_nutrition_entries_source_recipe_id.sql`,
--          `backend/src/routes/challenges.ts` (route semantics, ported into
--            `src/services/health-challenge-service.ts` + `src/routes/health.ts`).
--
--   donor `food_challenges` (036, cols 1-1 minus `deleted_at`)      → `food_challenges`
--   donor `food_challenges.custom_icon` (050 ALTER)                 → `custom_icon`
--   donor `challenge_progress` (036, cols 1-1 minus `deleted_at`)   → `challenge_progress`
--   donor `challenge_achievements` (036, cols 1-1 minus `deleted_at`) → `challenge_achievements`
--   donor `food_category_mappings` (036) + its ~115 seed rows        → `food_category_mappings`
--   donor `idx_challenge_progress_unique` (FULL, per 049)            → same, FULL here too
--   donor `idx_challenge_achievements_unique` (FULL, per 049)        → same, FULL here too
--   donor `nutrition_entries.detected_category` (052 ALTER + backfill + index) → same
--   donor `nutrition_entries.is_processed` (061 ALTER, default 1)   → same column, see DEVIATIONS
--   donor `nutrition_entries.source_recipe_id` (077 ALTER)          → same column
--
-- Drizzle exports live in `src/db/schema-health-challenges.ts`, named
-- `foodChallenges` / `foodChallengeProgress` / `foodChallengeAchievements` /
-- `foodCategoryMappings` — deliberately NOT `healthChallenges*`, which is an
-- UNRELATED pre-existing feature (`schema-health-social.ts`, multi-user
-- joinable "family accountability" challenges, table `health_challenges`).
-- The DB table names do not collide (donor never named its table
-- `health_challenges`); the Drizzle names are disambiguated so nobody wires
-- the wrong table into a route.
--
-- ============================ DEVIATIONS ====================================
--
--   * NO SOFT DELETE on any of the three challenge tables. The donor itself
--     removed `deleted_at` from these tables in 041 and converted their unique
--     indexes from partial to full in 049 specifically so `ON CONFLICT`
--     upserts work — we start from that END state rather than porting the
--     soft-delete phase and then un-porting it. A deleted challenge, deleted
--     progress row or deleted achievement is genuinely gone; nothing here is
--     delta-synced to a second device (there is no multi-device story for this
--     domain in this port — the RN app talks to one Worker per account).
--
--   * `is_processed` KEEPS the donor's column and its conservative default
--     (`1` = processed), but this port does not carry the donor's CLIENT-side
--     signal for it (Swift `CustomFood.isRawFood` → `NutritionEntry.isProcessed`
--     round-trips through Cloud Sync; this RN client has no equivalent toggle
--     and no route in `health.ts` accepts an `is_processed` field). Populating
--     it from a client the app does not have would make every category-based
--     challenge (vegetables, fruits, fish, …) permanently show 0g — the
--     donor's `skipCategoryWhenProcessed` gate never lets a `is_processed = 1`
--     row count toward a category, and every entry from this backend would be
--     `1` forever.
--
--     Instead `HealthService.createNutrition` / `createNutritionBulk` derive it
--     SERVER-SIDE: `is_processed = 0` when `detectFoodCategory` recognised the
--     logged name against `food_category_mappings` (treated as a single,
--     identifiable ingredient), `1` otherwise (an unrecognised or composite
--     name stays conservatively excluded, matching the donor's own default for
--     anything the client did not explicitly mark raw). See
--     `src/services/health-challenge-service.ts` header for the full rationale
--     and its accepted false-positive (a composite dish whose name happens to
--     substring-match one ingredient, e.g. "Chicken Caesar Salad" → `meat`,
--     gets full-portion credit) — the same class of approximation the donor
--     accepts for any entry without a `source_recipe_id`.
--
--   * `source_recipe_id` is added for schema parity and the progress
--     calculation honours it (proportional recipe-ingredient credit, ported
--     from `challenges.ts` `getRecipeChallengeContribution`), but NO write path
--     in this port currently sets it — this codebase's nutrition-entry create
--     routes have no "log this whole recipe as one entry" flow the way the
--     donor's Cloud Sync does. The column and the matching code are still
--     written so a future recipe-logging feature lights this up for free
--     instead of needing another migration.
--
--   * Recipe total weight for the proportional-contribution fallback ALWAYS
--     takes the donor's fallback branch (sum of ingredient grams) — this
--     backend's `recipes` table (`schema-health-p2.ts`) has no `raw_weight` /
--     `cooked_weight` columns to prefer, unlike the donor's. Not a gap: the
--     donor code itself falls back to the identical sum when those are empty.
--
--   * Streaks / achievements (`current_streak`, `longest_streak`,
--     `total_completions`, `challenge_achievements`) are STORED and the
--     columns are real, but the write path (`updateChallengeStreak` /
--     `checkAchievements` in donor `challenges.ts`) is only ported for the
--     DAILY case in this pass — see the route header in `src/routes/health.ts`
--     for what is live vs. deferred. The Dashboard widget itself only needs
--     `progress_percentage` per challenge and the 7-day daily array; it does
--     not read streaks or achievements.
--
-- ============================ CONVENTIONS ===================================
--
-- `IF NOT EXISTS` throughout. Inline `REFERENCES ... ON DELETE CASCADE` FK
-- style, matching `0134_health_reminders.sql` / `0131_health_body_comprehensive.sql`.
-- `challenge_achievements.challenge_id` is `ON DELETE SET NULL` (donor's own
-- choice) — an achievement survives the challenge that triggered it.

CREATE TABLE IF NOT EXISTS food_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  -- 'vegetables' | 'fruits' | 'fish' | 'seafood' | 'meat' | 'dairy' | 'grains'
  -- | 'legumes' | 'nuts' | 'custom_ingredient' | NULL
  target_category TEXT,
  -- Specific ingredient name for a `custom_ingredient` challenge (e.g. 'Avocado').
  target_food_name TEXT,
  target_amount_grams REAL NOT NULL,
  -- 'daily' | 'weekly'
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly')),
  start_date TEXT NOT NULL,
  end_date TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  -- Emoji the member picked (donor 050). NULL = default icon for the category.
  custom_icon TEXT,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  total_completions INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_food_challenges_user_active ON food_challenges(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_food_challenges_user_start ON food_challenges(user_id, start_date);
CREATE INDEX IF NOT EXISTS idx_food_challenges_sync ON food_challenges(user_id, updated_at);

CREATE TABLE IF NOT EXISTS challenge_progress (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  consumed_grams REAL NOT NULL DEFAULT 0,
  target_grams REAL NOT NULL,
  is_completed INTEGER NOT NULL DEFAULT 0,
  -- JSON array of {food_name, grams, confidence} — what matched, for the UI.
  matched_foods TEXT NOT NULL DEFAULT '[]',
  last_updated_at TEXT NOT NULL,
  FOREIGN KEY (challenge_id) REFERENCES food_challenges(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- FULL unique (donor 049) — required for the `ON CONFLICT(challenge_id, date)`
-- upsert every progress write uses. A partial index (`WHERE deleted_at IS
-- NULL`) cannot back that clause, which is exactly why the donor converted it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_challenge_progress_unique ON challenge_progress(challenge_id, date);
CREATE INDEX IF NOT EXISTS idx_challenge_progress_user_date ON challenge_progress(user_id, date);
CREATE INDEX IF NOT EXISTS idx_challenge_progress_challenge ON challenge_progress(challenge_id);

CREATE TABLE IF NOT EXISTS challenge_achievements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  -- 'first_completion' | 'streak_3' | 'streak_7' | 'streak_30' | 'weekly_complete'
  -- | '<category>_master' | 'daily_perfect'
  achievement_type TEXT NOT NULL,
  -- Which challenge triggered it, or NULL for an account-wide achievement.
  challenge_id TEXT,
  unlocked_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (challenge_id) REFERENCES food_challenges(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_challenge_achievements_unique ON challenge_achievements(user_id, achievement_type);
CREATE INDEX IF NOT EXISTS idx_challenge_achievements_user ON challenge_achievements(user_id);

-- Global deterministic food→category pattern table (donor 036), seeded once
-- below. `food-category-detector.ts` substring-matches (then Levenshtein
-- fuzzy-matches) a logged food name against these rows.
CREATE TABLE IF NOT EXISTS food_category_mappings (
  id TEXT PRIMARY KEY,
  food_name_pattern TEXT NOT NULL,
  category TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_food_category_mappings_pattern ON food_category_mappings(food_name_pattern);

-- Seed rows verbatim from donor `036_food_challenges.sql` (~115 rows).
INSERT OR IGNORE INTO food_category_mappings (id, food_name_pattern, category, confidence, created_at) VALUES
    -- Vegetables
    ('v001', 'broccoli', 'vegetables', 1.0, datetime('now')),
    ('v002', 'spinach', 'vegetables', 1.0, datetime('now')),
    ('v003', 'carrot', 'vegetables', 1.0, datetime('now')),
    ('v004', 'kale', 'vegetables', 1.0, datetime('now')),
    ('v005', 'lettuce', 'vegetables', 1.0, datetime('now')),
    ('v006', 'tomato', 'vegetables', 1.0, datetime('now')),
    ('v007', 'cucumber', 'vegetables', 1.0, datetime('now')),
    ('v008', 'pepper', 'vegetables', 0.9, datetime('now')),
    ('v009', 'onion', 'vegetables', 1.0, datetime('now')),
    ('v010', 'garlic', 'vegetables', 1.0, datetime('now')),
    ('v011', 'zucchini', 'vegetables', 1.0, datetime('now')),
    ('v012', 'eggplant', 'vegetables', 1.0, datetime('now')),
    ('v013', 'cauliflower', 'vegetables', 1.0, datetime('now')),
    ('v014', 'cabbage', 'vegetables', 1.0, datetime('now')),
    ('v015', 'asparagus', 'vegetables', 1.0, datetime('now')),
    ('v016', 'celery', 'vegetables', 1.0, datetime('now')),
    ('v017', 'mushroom', 'vegetables', 0.9, datetime('now')),
    ('v018', 'avocado', 'vegetables', 0.9, datetime('now')),
    ('v019', 'peas', 'vegetables', 1.0, datetime('now')),
    ('v020', 'green beans', 'vegetables', 1.0, datetime('now')),
    ('v021', 'brussels sprouts', 'vegetables', 1.0, datetime('now')),
    ('v022', 'artichoke', 'vegetables', 1.0, datetime('now')),
    ('v023', 'beet', 'vegetables', 1.0, datetime('now')),
    ('v024', 'radish', 'vegetables', 1.0, datetime('now')),
    ('v025', 'salad', 'vegetables', 0.8, datetime('now')),
    -- Fruits
    ('f001', 'apple', 'fruits', 1.0, datetime('now')),
    ('f002', 'banana', 'fruits', 1.0, datetime('now')),
    ('f003', 'orange', 'fruits', 1.0, datetime('now')),
    ('f004', 'strawberry', 'fruits', 1.0, datetime('now')),
    ('f005', 'blueberry', 'fruits', 1.0, datetime('now')),
    ('f006', 'raspberry', 'fruits', 1.0, datetime('now')),
    ('f007', 'grape', 'fruits', 1.0, datetime('now')),
    ('f008', 'mango', 'fruits', 1.0, datetime('now')),
    ('f009', 'pineapple', 'fruits', 1.0, datetime('now')),
    ('f010', 'watermelon', 'fruits', 1.0, datetime('now')),
    ('f011', 'peach', 'fruits', 1.0, datetime('now')),
    ('f012', 'pear', 'fruits', 1.0, datetime('now')),
    ('f013', 'kiwi', 'fruits', 1.0, datetime('now')),
    ('f014', 'cherry', 'fruits', 1.0, datetime('now')),
    ('f015', 'lemon', 'fruits', 1.0, datetime('now')),
    ('f016', 'lime', 'fruits', 1.0, datetime('now')),
    ('f017', 'grapefruit', 'fruits', 1.0, datetime('now')),
    ('f018', 'pomegranate', 'fruits', 1.0, datetime('now')),
    ('f019', 'papaya', 'fruits', 1.0, datetime('now')),
    ('f020', 'melon', 'fruits', 1.0, datetime('now')),
    -- Fish
    ('fi001', 'salmon', 'fish', 1.0, datetime('now')),
    ('fi002', 'tuna', 'fish', 1.0, datetime('now')),
    ('fi003', 'cod', 'fish', 1.0, datetime('now')),
    ('fi004', 'tilapia', 'fish', 1.0, datetime('now')),
    ('fi005', 'sardine', 'fish', 1.0, datetime('now')),
    ('fi006', 'mackerel', 'fish', 1.0, datetime('now')),
    ('fi007', 'trout', 'fish', 1.0, datetime('now')),
    ('fi008', 'halibut', 'fish', 1.0, datetime('now')),
    ('fi009', 'bass', 'fish', 1.0, datetime('now')),
    ('fi010', 'herring', 'fish', 1.0, datetime('now')),
    ('fi011', 'anchovy', 'fish', 1.0, datetime('now')),
    ('fi012', 'swordfish', 'fish', 1.0, datetime('now')),
    -- Seafood (non-fish)
    ('s001', 'shrimp', 'seafood', 1.0, datetime('now')),
    ('s002', 'crab', 'seafood', 1.0, datetime('now')),
    ('s003', 'lobster', 'seafood', 1.0, datetime('now')),
    ('s004', 'scallop', 'seafood', 1.0, datetime('now')),
    ('s005', 'mussel', 'seafood', 1.0, datetime('now')),
    ('s006', 'oyster', 'seafood', 1.0, datetime('now')),
    ('s007', 'clam', 'seafood', 1.0, datetime('now')),
    ('s008', 'squid', 'seafood', 1.0, datetime('now')),
    ('s009', 'octopus', 'seafood', 1.0, datetime('now')),
    ('s010', 'calamari', 'seafood', 1.0, datetime('now')),
    -- Meat
    ('m001', 'chicken', 'meat', 1.0, datetime('now')),
    ('m002', 'beef', 'meat', 1.0, datetime('now')),
    ('m003', 'pork', 'meat', 1.0, datetime('now')),
    ('m004', 'turkey', 'meat', 1.0, datetime('now')),
    ('m005', 'lamb', 'meat', 1.0, datetime('now')),
    ('m006', 'duck', 'meat', 1.0, datetime('now')),
    ('m007', 'steak', 'meat', 1.0, datetime('now')),
    ('m008', 'bacon', 'meat', 1.0, datetime('now')),
    ('m009', 'ham', 'meat', 1.0, datetime('now')),
    ('m010', 'sausage', 'meat', 1.0, datetime('now')),
    -- Dairy
    ('d001', 'milk', 'dairy', 1.0, datetime('now')),
    ('d002', 'cheese', 'dairy', 1.0, datetime('now')),
    ('d003', 'yogurt', 'dairy', 1.0, datetime('now')),
    ('d004', 'butter', 'dairy', 1.0, datetime('now')),
    ('d005', 'cream', 'dairy', 1.0, datetime('now')),
    ('d006', 'cottage cheese', 'dairy', 1.0, datetime('now')),
    ('d007', 'mozzarella', 'dairy', 1.0, datetime('now')),
    ('d008', 'parmesan', 'dairy', 1.0, datetime('now')),
    ('d009', 'cheddar', 'dairy', 1.0, datetime('now')),
    ('d010', 'feta', 'dairy', 1.0, datetime('now')),
    -- Grains
    ('g001', 'rice', 'grains', 1.0, datetime('now')),
    ('g002', 'bread', 'grains', 1.0, datetime('now')),
    ('g003', 'pasta', 'grains', 1.0, datetime('now')),
    ('g004', 'oats', 'grains', 1.0, datetime('now')),
    ('g005', 'quinoa', 'grains', 1.0, datetime('now')),
    ('g006', 'barley', 'grains', 1.0, datetime('now')),
    ('g007', 'wheat', 'grains', 1.0, datetime('now')),
    ('g008', 'cereal', 'grains', 0.9, datetime('now')),
    ('g009', 'couscous', 'grains', 1.0, datetime('now')),
    ('g010', 'bulgur', 'grains', 1.0, datetime('now')),
    -- Legumes
    ('l001', 'lentils', 'legumes', 1.0, datetime('now')),
    ('l002', 'chickpeas', 'legumes', 1.0, datetime('now')),
    ('l003', 'black beans', 'legumes', 1.0, datetime('now')),
    ('l004', 'kidney beans', 'legumes', 1.0, datetime('now')),
    ('l005', 'soybeans', 'legumes', 1.0, datetime('now')),
    ('l006', 'edamame', 'legumes', 1.0, datetime('now')),
    ('l007', 'hummus', 'legumes', 0.9, datetime('now')),
    ('l008', 'tofu', 'legumes', 1.0, datetime('now')),
    -- Nuts
    ('n001', 'almonds', 'nuts', 1.0, datetime('now')),
    ('n002', 'walnuts', 'nuts', 1.0, datetime('now')),
    ('n003', 'cashews', 'nuts', 1.0, datetime('now')),
    ('n004', 'peanuts', 'nuts', 1.0, datetime('now')),
    ('n005', 'pistachios', 'nuts', 1.0, datetime('now')),
    ('n006', 'hazelnuts', 'nuts', 1.0, datetime('now')),
    ('n007', 'macadamia', 'nuts', 1.0, datetime('now')),
    ('n008', 'pecans', 'nuts', 1.0, datetime('now')),
    ('n009', 'brazil nuts', 'nuts', 1.0, datetime('now')),
    ('n010', 'pine nuts', 'nuts', 1.0, datetime('now'));

-- ============================================================================
-- nutrition_entries — the three columns challenge progress reads (donor
-- 052 / 061 / 077). See DEVIATIONS above for how `is_processed` is populated
-- differently here than in the donor.
-- ============================================================================

ALTER TABLE nutrition_entries ADD COLUMN detected_category TEXT;
ALTER TABLE nutrition_entries ADD COLUMN is_processed INTEGER NOT NULL DEFAULT 1;
ALTER TABLE nutrition_entries ADD COLUMN source_recipe_id TEXT;

-- Donor 052's index, adapted: this backend's `nutrition_entries` KEEPS
-- `deleted_at` (soft delete), unlike the donor's post-041 hard-delete state, so
-- the partial predicate is retained here for the same reason every other
-- partial index in this domain keeps it (see 0134's header).
CREATE INDEX IF NOT EXISTS idx_nutrition_entries_category_date
  ON nutrition_entries(user_id, date, detected_category)
  WHERE deleted_at IS NULL AND detected_category IS NOT NULL;

-- Backfill existing rows so a challenge created today immediately sees credit
-- for food already logged today, rather than only counting entries written
-- after this migration. Verbatim donor 052 backfill query.
UPDATE nutrition_entries
SET detected_category = (
    SELECT fcm.category
    FROM food_category_mappings fcm
    WHERE LOWER(nutrition_entries.food_name) LIKE '%' || fcm.food_name_pattern || '%'
    ORDER BY fcm.confidence DESC
    LIMIT 1
)
WHERE detected_category IS NULL;

-- Backfill `is_processed` to match this port's server-derived rule (see
-- DEVIATIONS): 0 when a category was recognised, 1 (the column default)
-- otherwise. Without this, every row written before this migration reads back
-- `1` regardless of `detected_category` and looks "processed" to the matcher
-- even though the rule above would have called it raw.
UPDATE nutrition_entries
SET is_processed = CASE WHEN detected_category IS NOT NULL THEN 0 ELSE 1 END;
