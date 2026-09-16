-- ============================================
-- Migration: Actor FK ON DELETE SET NULL (DATA-6)
-- Date: 2026-07-17
-- Description: SQLite/D1 cannot ALTER an existing FK action; rebuild a practical
--              subset of small tables with nullable actor columns. POC / zero
--              users — INSERT…SELECT preserves any rows.
--
-- Deferred (Drizzle onDelete: 'set null' only — wide tables need full rebuild):
--   tasks.assigned_to, households.updated_by, reports.uploaded_by (NOT NULL),
--   budget_items.created_by, checklist actor columns, household_members.invited_by.
-- ============================================

PRAGMA foreign_keys = OFF;

-- ai_tool_pending: approved_by / cancelled_by
ALTER TABLE ai_tool_pending RENAME TO ai_tool_pending_old;

CREATE TABLE ai_tool_pending (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  input_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'cancelled', 'executed', 'expired', 'failed'
  )),
  approved_at TEXT,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at TEXT,
  cancelled_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  executed_at TEXT,
  execution_result_json TEXT,
  execution_error TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO ai_tool_pending SELECT * FROM ai_tool_pending_old;
DROP TABLE ai_tool_pending_old;

CREATE INDEX idx_ai_tool_pending_household
  ON ai_tool_pending(household_id, status, created_at DESC);
CREATE UNIQUE INDEX idx_ai_tool_pending_idempotency
  ON ai_tool_pending(household_id, idempotency_key);
CREATE INDEX idx_ai_tool_pending_expiry
  ON ai_tool_pending(expires_at)
  WHERE status = 'pending';

-- budget_transfers: created_by
ALTER TABLE budget_transfers RENAME TO budget_transfers_old;

CREATE TABLE budget_transfers (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  source_year INTEGER NOT NULL,
  source_month INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  destination_type TEXT NOT NULL,
  dest_year INTEGER,
  dest_month INTEGER,
  goal_id TEXT,
  account_id TEXT,
  destination_ref_id TEXT,
  destination_label TEXT NOT NULL,
  note TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO budget_transfers SELECT * FROM budget_transfers_old;
DROP TABLE budget_transfers_old;

CREATE INDEX budget_transfers_source_idx
  ON budget_transfers(household_id, source_year, source_month);
CREATE INDEX budget_transfers_dest_idx
  ON budget_transfers(household_id, dest_year, dest_month);

-- processing_jobs: initiated_by_user_id (0087 column had no FK)
ALTER TABLE processing_jobs RENAME TO processing_jobs_old;

CREATE TABLE processing_jobs (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  initiated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  access_source TEXT,
  provider TEXT,
  required_capability TEXT,
  selected_model_id TEXT
);

INSERT INTO processing_jobs (
  id, report_id, job_type, status, attempts, max_attempts, last_error,
  started_at, completed_at, created_at, updated_at,
  initiated_by_user_id, access_source, provider, required_capability, selected_model_id
)
SELECT
  id, report_id, job_type, status, attempts, max_attempts, last_error,
  started_at, completed_at, created_at, updated_at,
  initiated_by_user_id, access_source, provider, required_capability, selected_model_id
FROM processing_jobs_old;

DROP TABLE processing_jobs_old;

CREATE INDEX processing_jobs_report_id_idx ON processing_jobs(report_id);
CREATE INDEX processing_jobs_status_idx ON processing_jobs(status);
CREATE INDEX processing_jobs_initiated_by_user_id_idx
  ON processing_jobs(initiated_by_user_id);

-- savings_income_entries: created_by
ALTER TABLE savings_income_entries RENAME TO savings_income_entries_old;

CREATE TABLE savings_income_entries (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id TEXT REFERENCES household_members(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL,
  label TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  income_date TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CAD',
  notes TEXT,
  template_id TEXT,
  period TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  import_batch_id TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO savings_income_entries SELECT * FROM savings_income_entries_old;
DROP TABLE savings_income_entries_old;

CREATE INDEX savings_income_household_idx ON savings_income_entries(household_id);
CREATE INDEX savings_income_date_idx ON savings_income_entries(household_id, income_date);
CREATE INDEX savings_income_import_batch_idx ON savings_income_entries(import_batch_id);
CREATE UNIQUE INDEX savings_income_template_period_idx
  ON savings_income_entries(template_id, period) WHERE template_id IS NOT NULL;

-- savings_spending_entries: created_by
ALTER TABLE savings_spending_entries RENAME TO savings_spending_entries_old;

CREATE TABLE savings_spending_entries (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES savings_categories(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CAD',
  spending_date TEXT NOT NULL,
  notes TEXT,
  recurring_payment_id TEXT,
  period TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO savings_spending_entries SELECT * FROM savings_spending_entries_old;
DROP TABLE savings_spending_entries_old;

CREATE INDEX savings_spending_household_idx ON savings_spending_entries(household_id);
CREATE INDEX savings_spending_date_idx ON savings_spending_entries(household_id, spending_date);
CREATE UNIQUE INDEX savings_spending_recurring_period_idx
  ON savings_spending_entries(recurring_payment_id, period) WHERE recurring_payment_id IS NOT NULL;

PRAGMA foreign_keys = ON;
