-- ============================================
-- Migration: Aihousekeeper trust ledger (Stream A4 + folded-in §B6 idempotency key)
-- Date: 2026-04-23
-- Plan: documents/Requirenments/AI Houskeeper /MCP_UI_Implementation_Plan_v3.1.md §A4, §B6
-- Description: Append-only record of every meaningful Aihousekeeper action so the
--              user can audit / undo. `event_idempotency_key` (from §B6) is
--              folded in as a CREATE TABLE column + partial unique index in
--              a single migration rather than a follow-up ALTER.
-- ============================================

CREATE TABLE IF NOT EXISTS assistant_trust_ledger (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  category TEXT NOT NULL CHECK (category IN (
    'decision','message_sent','task_changed','memory_added','followup_scheduled','assignment'
  )),
  summary TEXT NOT NULL,
  rationale TEXT NOT NULL,
  reversible INTEGER NOT NULL DEFAULT 0,
  undo_token TEXT,
  related_refs_json TEXT,
  user_dismissed_at TEXT,
  event_idempotency_key TEXT                               -- v3.1 §B6: deduplicates queue-replay retries
);

CREATE INDEX IF NOT EXISTS idx_trust_ledger_household
  ON assistant_trust_ledger(household_id, occurred_at DESC);

-- Partial unique index: keys are optional but when present must be unique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_trust_ledger_idempotency
  ON assistant_trust_ledger(event_idempotency_key)
  WHERE event_idempotency_key IS NOT NULL;
