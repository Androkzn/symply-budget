-- AI Access Migration: report job actor / audit columns (nullable for legacy rows)

ALTER TABLE processing_jobs ADD COLUMN initiated_by_user_id TEXT;
ALTER TABLE processing_jobs ADD COLUMN access_source TEXT;
ALTER TABLE processing_jobs ADD COLUMN provider TEXT;
ALTER TABLE processing_jobs ADD COLUMN required_capability TEXT;
ALTER TABLE processing_jobs ADD COLUMN selected_model_id TEXT;

CREATE INDEX IF NOT EXISTS processing_jobs_initiated_by_user_id_idx
  ON processing_jobs(initiated_by_user_id);
