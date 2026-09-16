-- Migration: Create settings table for user customization preferences
-- Created: 2026-01-30
-- Description: Stores user and household settings including theme, navigation, widgets, and other preferences

CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    household_id TEXT,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Unique constraint: one setting per user+household+key combination
CREATE UNIQUE INDEX IF NOT EXISTS settings_user_household_key_idx
    ON settings(user_id, household_id, key);

-- Index for fetching all settings for a user
CREATE INDEX IF NOT EXISTS settings_user_id_idx
    ON settings(user_id);

-- Index for household-scoped settings
CREATE INDEX IF NOT EXISTS settings_household_id_idx
    ON settings(household_id);

-- Index for searching by key
CREATE INDEX IF NOT EXISTS settings_key_idx
    ON settings(key);
