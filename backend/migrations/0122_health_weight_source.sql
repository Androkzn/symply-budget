-- Symply Health — record the ORIGIN of a weight entry.
--
-- Why: `health_entries` has carried `source` ('healthkit' | 'manual') since 0119,
-- so an imported step count can always be told apart from a typed one. Weight
-- had no such column, which blocked the HealthKit body-mass import entirely: an
-- imported reading would be indistinguishable from one the user typed, so a
-- re-import could silently overwrite a manual correction, and "manual always
-- wins" — the de-duplication rule the whole HealthKit path is built on — would
-- have nothing to test against.
--
-- Default 'manual' is the honest backfill: every row that exists today WAS typed
-- in, because no import path has ever run.
--
-- No CHECK constraint here, deliberately. 0119 put one on `health_entries.source`
-- and SQLite cannot add a CHECK to an existing table without a full rebuild;
-- validation lives in zod at the route boundary, which is where a bad value is
-- actually rejected with a 400 rather than a 500.

ALTER TABLE weight_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';

-- Lets the de-duplicator find "the HealthKit row for this day" without scanning
-- the user's whole history.
CREATE INDEX IF NOT EXISTS idx_weight_entries_source
  ON weight_entries(user_id, source, date);
