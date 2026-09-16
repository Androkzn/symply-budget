-- Symply Health — close the three backend gaps the UI port had to work around.
--
-- Each one forced a client workaround that was visible to the USER, not just
-- ugly in code, so each is closed here rather than papered over again.
--
--   GAP 1  A health entry could not be UPDATED. `/health/entries` was create +
--          soft-delete only, so "edit a session" on the Activity tab RE-RECORDED
--          it: write the replacement, then tombstone the original. Safe (a
--          mid-flight failure left a recoverable duplicate rather than a lost
--          session) but it moved the logged time, and the screen had to say so
--          in copy. This migration adds no column for that — it is a ROUTE gap,
--          closed in routes/health.ts + services/health-service.ts. It is
--          recorded here because gaps 2 and 3 exist to be written THROUGH that
--          route, and reviewing them apart makes no sense.
--
--   GAP 2  A workout had no INTENSITY. `POST /health/entries/workouts` accepted
--          workout_type / minutes / calories / note and zod stripped the rest,
--          so the Activity screen smuggled intensity into the note as a leading
--          `[hard]` tag. A tag inside free text is not queryable, is visible to
--          anyone reading the raw note, and collides with a note that genuinely
--          starts with a bracket.
--
--   GAP 3  A nutrition entry's PORTION could not be re-derived. Logging a food
--          from the library stored only the resulting absolute macros, so
--          changing the portion afterwards had nothing to rescale FROM.
--
-- ============================ DONOR MAPPING ================================
--
-- Donor = `~/Desktop/Symply Ecosystem/Simply Health/backend/`, read-only.
--
--   * GAP 1 — the donor HAS this route: `routes/health.ts` `PUT /entries/:id`,
--     which replaces `data` + `source` and stamps `updated_at`. It was simply
--     not ported in P1. Two deliberate differences, both platform conventions:
--       - the donor runs the UPDATE unconditionally and answers
--         `{ success: true }` even when it matched nothing (so a stale id, or
--         another user's id, is indistinguishable from a real edit). Ours reads
--         the row user-scoped first and 404s — never 403, which would confirm
--         the id exists on someone else's account.
--       - the donor cannot re-date an entry. Ours can, because the RN editor
--         must be able to keep a session on the day it happened.
--
--   * GAP 2 — the donor has NO intensity anywhere on a workout. Its
--     `WorkoutEntry` (SwiftData/HealthKit) carries duration, calories, distance,
--     heart-rate zones, VO2 max … and no effort field, because every session was
--     imported from HealthKit rather than self-reported. The two things that
--     look like a match are not:
--       - `008_difficulty_levels.sql`'s 5-star `level1..level5` grades a VIDEO
--         in the workout catalogue (how hard the movement IS). That vocabulary
--         is already ported, on `exercise_library.difficulty` in 0123. It does
--         not describe how hard one session FELT.
--       - `mens_health_entries.workout_intensity` (0119, donor 038) is a 1–10
--         self-report inside the vitality diary — a different table, a different
--         scale, and not what the Activity tab collects.
--     So the vocabulary here is NEW: the four-chip scale the RN Activity screen
--     already ships (`easy | steady | hard | max`). NULL means "not recorded",
--     which is also what `steady` (the picker's default) writes — the client
--     sends the column only when the user actually moved off the default, so a
--     plain "log a walk" keeps writing exactly the payload it always has.
--
--   * GAP 3 — `base_calories_per_100`, `base_proteins_per_100`,
--     `base_carbs_per_100`, `base_fats_per_100` are the donor's OWN column names
--     and semantics, from `018_nutrition_base_values.sql` ("the base values that
--     allow recalculating nutrition when user changes portion size"), matching
--     the spelling already used on `custom_foods` / `recipes` in 0120. Kept
--     verbatim, including the donor's plural `proteins` and its abbreviated
--     `carbs`/`fats` — renaming them would fork the one vocabulary
--     `services/health-food-service.ts` already derives every portion with.
--     `food_id` is the donor's name too, taken from `food_usage_history.food_id`
--     (donor 028) rather than invented: it points at the same `custom_foods.id`.
--     The donor never put it on `nutrition_entries` — its nearest neighbour is
--     `source_recipe_id` (donor 077) — so this column is an addition, and the
--     reason it exists is that provenance is what makes a re-derive auditable:
--     without it a rescaled row cannot be traced back to the food it came from.
--
-- ============================ DEVIATIONS ===================================
--
--   * NO CHECK CONSTRAINTS on the new columns. Same reason as 0122: SQLite
--     cannot add a CHECK to an existing table without a full table rebuild, and
--     a rebuild of `health_entries` / `nutrition_entries` on a live D1 is not
--     worth it for a value zod already rejects with a 400 at the route boundary
--     (a CHECK would surface the same bad value as a 500).
--
--   * NO FOREIGN KEY on `nutrition_entries.food_id`, deliberately. `custom_foods`
--     is SOFT-deleted like everything else in this domain, so an ON DELETE rule
--     would never fire; and if it ever did, both of its options are wrong — a
--     diary row must KEEP its macros and its basis when the source food is
--     deleted, because the meal was still eaten. The pointer is provenance, not
--     a referential guarantee. What actually protects it is the user-scoped
--     lookup in `HealthService.createNutrition`, which refuses a `food_id` the
--     caller does not own instead of storing a dangling one.
--
--   * ALL FIVE COLUMNS ARE NULLABLE with no default. Every row that already
--     exists was written without them, and inventing a basis for a hand-typed
--     "Soup, 300 kcal" would be a guess presented as a measurement. NULL
--     `base_calories_per_100` is the honest "this row cannot be re-portioned",
--     and `POST /nutrition/entries/:id/portion` answers 400 `no_basis` for it
--     rather than silently doing nothing.
--
--   * Conventions carried from 0119–0123: soft deletes and `updated_at` already
--     exist on both tables and are untouched, so the delta-sync cursor keeps
--     working — every column added here rides the EXISTING `updated_at` and
--     needs no sync change beyond being in the schema.

-- ==================== GAP 2 — workout intensity ============================

-- NULL = not recorded. See the donor-mapping note above for why this is a new
-- vocabulary rather than a ported one.
ALTER TABLE health_entries ADD COLUMN intensity TEXT;

-- Backfill the legacy `[hard] …` note tags the Activity screen used to write.
--
-- This reads the tag out; it deliberately does NOT rewrite the `data` blob and
-- does NOT touch `updated_at`. Rewriting notes would restamp every workout the
-- user has ever logged and force a full re-pull on every device, to remove
-- seven characters. The client keeps a `parseWorkoutNote` reader that strips the
-- now-redundant prefix at display time, which is also what covers a device still
-- holding a pre-0124 offline cache.
--
-- `[` is a literal in SQLite's LIKE (unlike GLOB), so these patterns are exact.
-- `json_valid` guards the one blob that was ever written by hand.
UPDATE health_entries
SET intensity = CASE
    WHEN json_extract(data, '$.note') LIKE '[easy]%' THEN 'easy'
    WHEN json_extract(data, '$.note') LIKE '[steady]%' THEN 'steady'
    WHEN json_extract(data, '$.note') LIKE '[hard]%' THEN 'hard'
    WHEN json_extract(data, '$.note') LIKE '[max]%' THEN 'max'
  END
WHERE entry_type = 'workout'
  AND intensity IS NULL
  AND json_valid(data)
  AND json_extract(data, '$.note') LIKE '[%]%';

-- "How did my hard sessions go this month" is the question the column exists
-- for, and it is per-user + per-type. Partial so the index only carries the rows
-- that recorded one.
CREATE INDEX IF NOT EXISTS idx_health_entries_intensity
  ON health_entries(user_id, entry_type, intensity)
  WHERE intensity IS NOT NULL;

-- ============ GAP 3 — nutrition provenance + per-100 basis ==================

-- Which library food this diary row came from (`custom_foods.id`). NULL for a
-- hand-typed entry. No FK — see the deviations note.
ALTER TABLE nutrition_entries ADD COLUMN food_id TEXT;

-- The exact basis every portion is derived from — donor 018, column-for-column.
ALTER TABLE nutrition_entries ADD COLUMN base_calories_per_100 REAL;
ALTER TABLE nutrition_entries ADD COLUMN base_proteins_per_100 REAL;
ALTER TABLE nutrition_entries ADD COLUMN base_carbs_per_100 REAL;
ALTER TABLE nutrition_entries ADD COLUMN base_fats_per_100 REAL;

-- Donor 018 shipped this as `idx_nutrition_has_base`; renamed to the
-- table-prefixed form 0119 adopted for every ported index.
CREATE INDEX IF NOT EXISTS idx_nutrition_entries_has_base
  ON nutrition_entries(user_id, date)
  WHERE base_calories_per_100 IS NOT NULL;

-- "Everything I logged from this food" — the read behind usage history and the
-- only way to audit a re-derived row back to its source.
CREATE INDEX IF NOT EXISTS idx_nutrition_entries_food
  ON nutrition_entries(user_id, food_id)
  WHERE food_id IS NOT NULL;
