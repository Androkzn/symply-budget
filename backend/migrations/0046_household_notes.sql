-- ============================================
-- Migration: Household notes
-- Date: 2026-04-24
-- Description: Free-form shared household notes — distinct from assistant
--              memory (which redacts PII before returning to the LLM). Notes
--              are intended to be recallable verbatim (e.g. "key is under
--              the mat", "wifi password is X"), so they live in their own
--              table without PII redaction.
-- ============================================

CREATE TABLE IF NOT EXISTS household_notes (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  body TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_household_notes_household
  ON household_notes(household_id, pinned DESC, updated_at DESC)
  WHERE deleted_at IS NULL;
