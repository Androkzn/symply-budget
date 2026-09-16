-- ============================================
-- Migration: Aihousekeeper briefings + followups (Stream A2)
-- Date: 2026-04-23
-- Plan: documents/Requirenments/AI Houskeeper /MCP_UI_Implementation_Plan_v3.1.md §A2
-- Description: assistant_followups (Aihousekeeper's self-scheduled / user-requested
--              callbacks) and assistant_briefings (daily composed briefings).
--              assistant_briefings has UNIQUE(household_id, date) so the
--              composer is idempotent.
-- ============================================

CREATE TABLE IF NOT EXISTS assistant_followups (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  scheduled_for TEXT NOT NULL,
  prompt TEXT NOT NULL,
  context_ref_json TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('self_scheduled','user_requested')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','fired','cancelled','skipped')),
  fired_at TEXT,
  outcome_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Used by the followup_due trigger (Stream D) to find pending rows at/before now.
CREATE INDEX IF NOT EXISTS idx_assistant_followups_due
  ON assistant_followups(status, scheduled_for);

CREATE TABLE IF NOT EXISTS assistant_briefings (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  composed_at TEXT NOT NULL DEFAULT (datetime('now')),
  paragraph TEXT NOT NULL,
  bullets_json TEXT NOT NULL DEFAULT '[]',
  push_sent INTEGER NOT NULL DEFAULT 0,
  push_message_id TEXT,
  read_at TEXT,
  empty_reason TEXT,
  source_signals_json TEXT NOT NULL DEFAULT '[]',
  composed_by_model TEXT,                    -- operability: which model produced it
  prompt_version TEXT,                       -- operability: which prompt version
  UNIQUE(household_id, date)
);

CREATE INDEX IF NOT EXISTS idx_assistant_briefings_household
  ON assistant_briefings(household_id, date DESC);
