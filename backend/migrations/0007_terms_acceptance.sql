-- Migration: Add terms_accepted_at to users table
-- This tracks when users accept terms of service and privacy policy

ALTER TABLE users ADD COLUMN terms_accepted_at TEXT;
