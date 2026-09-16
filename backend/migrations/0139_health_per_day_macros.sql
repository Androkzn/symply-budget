-- Symply Health — per-weekday MACRO targets, the protein/carbs/fat analogue of
-- the per-weekday CALORIE plan already on `health_goals` (0119).
--
-- WHY THIS EXISTS AT ALL. `use_per_day_calories` + `monday_calories` …
-- `sunday_calories` let a member set a different calorie target per weekday
-- (training day vs rest day), but `daily_protein_grams` / `daily_carbs_grams` /
-- `daily_fats_grams` are still ONE flat number that applies every day — a
-- member on a training-day/rest-day split who varies their calories already
-- also wants their macro SPLIT to vary (e.g. more carbs on a lifting day),
-- and today there is nowhere on the wire to put that.
--
-- ============================ DESIGN =======================================
--
-- Mirrors 0119's calorie columns exactly, one boolean switch plus 7×3 nullable
-- gram targets, Monday-first in the schema (matching `CALORIE_WEEK_DAYS` /
-- `monday_calories`…`sunday_calories`), Sunday-indexed on the resolver side via
-- `getUTCDay()` (see `health-service.ts`'s `caloriesGoalFor`, whose new
-- `macrosGoalFor` sibling reads these the same way).
--
-- Grams, not percent-of-calories: the per-day CALORIE override already exists
-- independently, and a per-day macro *percentage* would need to know which
-- day's calorie target to apply against, which reopens a resolution question
-- 0119 never had to answer. Grams sidestep it — the member types the grams
-- directly for that day, the same unit `daily_protein_grams` already uses.
--
-- Bounds are the existing flat-macro range (0-2000 g), enforced in zod at the
-- route boundary — SQLite CHECK constraints are unavailable on an ALTER of a
-- live table, same reasoning as 0125.
--
-- A day left NULL falls back to the flat `daily_*_grams` target, same
-- "unset day inherits the single target" contract `caloriesGoalFor` already
-- has for calories.

ALTER TABLE health_goals ADD COLUMN use_per_day_macros INTEGER NOT NULL DEFAULT 0;

ALTER TABLE health_goals ADD COLUMN monday_protein_grams REAL;
ALTER TABLE health_goals ADD COLUMN monday_carbs_grams REAL;
ALTER TABLE health_goals ADD COLUMN monday_fats_grams REAL;

ALTER TABLE health_goals ADD COLUMN tuesday_protein_grams REAL;
ALTER TABLE health_goals ADD COLUMN tuesday_carbs_grams REAL;
ALTER TABLE health_goals ADD COLUMN tuesday_fats_grams REAL;

ALTER TABLE health_goals ADD COLUMN wednesday_protein_grams REAL;
ALTER TABLE health_goals ADD COLUMN wednesday_carbs_grams REAL;
ALTER TABLE health_goals ADD COLUMN wednesday_fats_grams REAL;

ALTER TABLE health_goals ADD COLUMN thursday_protein_grams REAL;
ALTER TABLE health_goals ADD COLUMN thursday_carbs_grams REAL;
ALTER TABLE health_goals ADD COLUMN thursday_fats_grams REAL;

ALTER TABLE health_goals ADD COLUMN friday_protein_grams REAL;
ALTER TABLE health_goals ADD COLUMN friday_carbs_grams REAL;
ALTER TABLE health_goals ADD COLUMN friday_fats_grams REAL;

ALTER TABLE health_goals ADD COLUMN saturday_protein_grams REAL;
ALTER TABLE health_goals ADD COLUMN saturday_carbs_grams REAL;
ALTER TABLE health_goals ADD COLUMN saturday_fats_grams REAL;

ALTER TABLE health_goals ADD COLUMN sunday_protein_grams REAL;
ALTER TABLE health_goals ADD COLUMN sunday_carbs_grams REAL;
ALTER TABLE health_goals ADD COLUMN sunday_fats_grams REAL;
