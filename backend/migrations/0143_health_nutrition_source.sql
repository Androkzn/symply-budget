-- Symply Health — record the ORIGIN of a nutrition diary row.
--
-- Why: `health_entries` (0119) and `weight_entries` (0122) both carry `source`
-- ('healthkit' | 'manual') so an imported reading can always be told apart from
-- one the user typed. `nutrition_entries` had no such column, which blocked
-- HealthKit dietary import (calories/protein/carbs/fat) entirely: an imported
-- day-total row would be indistinguishable from a hand-logged meal, and the
-- importer's de-duplicator (`planNutritionImport` in `healthKit.ts`) needs the
-- column to recognise "the row I wrote last sync" without re-parsing every meal
-- on the day.
--
-- Unlike weight/steps, a nutrition day can hold several MANUAL meals alongside
-- one imported summary row — they coexist rather than compete for one figure —
-- so this column is a marker for the importer's own row, not a "who owns this
-- day" flag the way it is on `weight_entries`.
--
-- Default 'manual' is the honest backfill: every row that exists today WAS
-- typed in, because no import path has ever run.
--
-- No CHECK constraint, deliberately — same reasoning as 0122: SQLite cannot add
-- one to an existing table without a full rebuild, and validation lives in zod
-- at the route boundary.

ALTER TABLE nutrition_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';

-- Lets the de-duplicator find "the HealthKit row for this day" without scanning
-- the user's whole diary.
CREATE INDEX IF NOT EXISTS idx_nutrition_entries_source
  ON nutrition_entries(user_id, source, date);
