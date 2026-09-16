-- Drop the legacy estimated_minutes column now that time_effort (migration 0079)
-- fully replaces it and every row has been backfilled. The app no longer reads
-- or writes estimated_minutes, and the new Worker build no longer SELECTs it, so
-- this DROP must run AFTER that build is deployed to each environment.
ALTER TABLE tasks DROP COLUMN estimated_minutes;
