-- Migration: Add onboarding tracking fields to users table
-- Description: Tracks user progress through onboarding flow
-- Date: 2026-01-30

-- Add onboarding tracking columns
-- Already-migrated remotes have these columns (added when this file
-- originally ran, before someone commented it out "defensively"); a fresh
-- database never gets them without these statements, breaking the index
-- and UPDATE below.
ALTER TABLE users ADD COLUMN has_completed_onboarding INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN onboarding_household_created INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN onboarding_report_added INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN onboarding_garbage_setup INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN onboarding_floor_plan_added INTEGER NOT NULL DEFAULT 0;

-- Create index for querying onboarding status
CREATE INDEX IF NOT EXISTS users_onboarding_idx ON users(has_completed_onboarding);

-- Note: All existing users are considered to have completed onboarding
-- This prevents forcing existing users through the new onboarding flow
UPDATE users SET
  has_completed_onboarding = 1,
  onboarding_household_created = 1
WHERE created_at < datetime('now');
