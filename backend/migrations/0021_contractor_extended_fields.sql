-- Migration: Add extended contractor fields for Labor Hub
-- Created: 2026-02-04

-- Add missing columns to contractors table
-- Already-migrated remotes have these columns; a fresh database never gets
-- them without these statements, breaking the index below.
ALTER TABLE contractors ADD COLUMN secondary_specialties TEXT;
ALTER TABLE contractors ADD COLUMN business_type TEXT;
ALTER TABLE contractors ADD COLUMN license_number TEXT;
ALTER TABLE contractors ADD COLUMN insurance_verified INTEGER DEFAULT 0;
ALTER TABLE contractors ADD COLUMN insurance_expiry TEXT;
ALTER TABLE contractors ADD COLUMN years_in_business INTEGER;
ALTER TABLE contractors ADD COLUMN emergency_available INTEGER DEFAULT 0;
ALTER TABLE contractors ADD COLUMN response_time TEXT;
ALTER TABLE contractors ADD COLUMN service_area TEXT;
ALTER TABLE contractors ADD COLUMN business_hours TEXT;
ALTER TABLE contractors ADD COLUMN certifications TEXT;
ALTER TABLE contractors ADD COLUMN portfolio_images TEXT;
ALTER TABLE contractors ADD COLUMN is_blocked INTEGER DEFAULT 0;
ALTER TABLE contractors ADD COLUMN custom_tags TEXT;
ALTER TABLE contractors ADD COLUMN recommended_by TEXT;
ALTER TABLE contractors ADD COLUMN source TEXT;

-- Add index for blocked contractors
CREATE INDEX IF NOT EXISTS contractors_is_blocked_idx ON contractors(is_blocked);
