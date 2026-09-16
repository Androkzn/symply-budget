-- Replace the precise `estimated_minutes` time estimate with a coarse
-- "time effort" tier (quick | short | medium | half_day | all_day) — the same
-- glanceable buckets the task cards already derived for display. Homeowners
-- don't need false-precision minute counts; the planner maps a tier back to
-- representative minutes for its "what can I do in N minutes?" packing.
--
-- estimated_minutes is left in place (deprecated) for historical rows; the app
-- no longer reads or writes it.
ALTER TABLE tasks ADD COLUMN time_effort TEXT;

-- Backfill every existing row from its minute estimate, using the exact
-- thresholds the mobile cards used to derive their effort labels.
UPDATE tasks SET time_effort = CASE
  WHEN estimated_minutes IS NULL OR estimated_minutes <= 0 THEN NULL
  WHEN estimated_minutes <= 15 THEN 'quick'
  WHEN estimated_minutes <= 45 THEN 'short'
  WHEN estimated_minutes <= 120 THEN 'medium'
  WHEN estimated_minutes <= 300 THEN 'half_day'
  ELSE 'all_day'
END
WHERE time_effort IS NULL;
