-- ============================================
-- Migration: Aihousekeeper outbound log (Stream A3)
-- Date: 2026-04-23
-- Plan: documents/Requirenments/AI Houskeeper /MCP_UI_Implementation_Plan_v3.1.md §A3
-- Description: Single source of truth for every outbound Aihousekeeper message
--              (push, sms, email, watch). Status enum captures every
--              CanSendDenyReason from §B4 plus additional outcomes
--              (empty composer, mid-loop kill-switch recheck).
-- ============================================

CREATE TABLE IF NOT EXISTS assistant_outbound_log (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('push','sms','email','watch')),
  to_member_id TEXT,
  template TEXT NOT NULL,
  body TEXT NOT NULL,
  external_message_id TEXT,
  idempotency_key TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'sent','failed',
    -- Every CanSendDenyReason from §B4 maps to one of these:
    'skipped_aihousekeeper_disabled',      -- canSend check 1
    'skipped_channel_killed',      -- canSend check 2
    'skipped_conservative_mode',   -- canSend check 3
    'skipped_channel_disabled',    -- canSend check 4
    'skipped_tcpa_quiet_hours',    -- canSend check 5 (SMS only)
    'skipped_quiet_hours',         -- canSend check 6 (household)
    'skipped_budget',              -- canSend check 7
    'skipped_duplicate',           -- canSend check 8
    -- Additional outcomes not produced by canSend:
    'skipped_empty',               -- BriefingDispatcher: composer returned kind:'empty'
    'skipped_kill_switch'          -- mid-loop recheck in F2 consumer
  )),
  trigger_ref_json TEXT,
  user_action TEXT,
  composed_by_model TEXT,                    -- when body is LLM-generated
  prompt_version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_outbound_household_day
  ON assistant_outbound_log(household_id, created_at);

-- Partial unique index — idempotency keys are optional, but when present
-- must be unique per household to deduplicate retried dispatches.
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_idempotency
  ON assistant_outbound_log(household_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
