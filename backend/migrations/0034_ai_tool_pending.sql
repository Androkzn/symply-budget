-- Migration: 0034_ai_tool_pending.sql
-- Date: 2026-04-23
-- Purpose: Minimum v1.2 ADR-32 schema required for Aihousekeeper's HIGH_WRITE tool
--          approval flow. Plan §0 (Aihousekeeper v3.1) explicitly authorizes folding
--          Aihousekeeper's needs into 0034 when v1.2's full ai_chat migration has not
--          shipped ("fold Aihousekeeper's needs into 0034 directly — no backport shim
--          layer needed").
--
-- Scope: only `ai_tool_pending`. The broader v1.2 chat surface
--        (ai_chat_sessions, ai_chat_messages, ai_tool_calls, ai_tool_audit,
--        ai_idempotency_keys) remains v1.2's responsibility and will land in
--        a separate, later migration when that plan ships.

-- Parked HIGH_WRITE tool invocations awaiting user approval (v1.2 ADR-32).
CREATE TABLE IF NOT EXISTS ai_tool_pending (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  input_json TEXT NOT NULL,                               -- JSON-encoded tool input
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',      -- awaiting user action
    'approved',     -- user approved; executor hasn't run yet
    'cancelled',    -- user dismissed
    'executed',     -- executor ran successfully
    'expired',      -- past expires_at without action
    'failed'        -- executor ran and raised
  )),
  approved_at TEXT,
  approved_by TEXT REFERENCES users(id),
  cancelled_at TEXT,
  cancelled_by TEXT REFERENCES users(id),
  executed_at TEXT,
  execution_result_json TEXT,
  execution_error TEXT,
  -- TTL. Default 72h; the expiry sweeper in a later cron tick sets status='expired'.
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- List pending approvals per household, newest first.
CREATE INDEX idx_ai_tool_pending_household
  ON ai_tool_pending(household_id, status, created_at DESC);

-- Dedup: a given (household, idempotency_key) can only park once.
CREATE UNIQUE INDEX idx_ai_tool_pending_idempotency
  ON ai_tool_pending(household_id, idempotency_key);

-- Sweeper scan: WHERE status='pending' AND expires_at <= now.
CREATE INDEX idx_ai_tool_pending_expiry
  ON ai_tool_pending(expires_at)
  WHERE status = 'pending';
