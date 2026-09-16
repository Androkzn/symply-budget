-- ============================================
-- Migration: 0104 DATA-6 deferred actor FK ON DELETE SET NULL
-- Date: 2026-07-17
-- Description: Rebuild deferred actor tables via *_new + explicit column
--              lists (column order differs across brands). Skips households
--              (photo_key drift). reports.uploaded_by becomes nullable.
-- ============================================

PRAGMA foreign_keys = OFF;

-- ---------- tasks ----------
CREATE TABLE tasks_new (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  space_id TEXT REFERENCES household_spaces(id) ON DELETE SET NULL,
  system_category TEXT,
  title TEXT NOT NULL,
  description TEXT,
  frequency TEXT NOT NULL,
  custom_interval_days INTEGER,
  next_due_date TEXT,
  last_completed_at TEXT,
  assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
  reminder_days_before INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  reminder_enabled INTEGER DEFAULT 1,
  reminder_time TEXT DEFAULT '09:00',
  reminder_repeat INTEGER DEFAULT 1,
  last_reminder_sent_at TEXT,
  snooze_until TEXT,
  suggested_by TEXT,
  home_feature_id TEXT,
  template_id TEXT,
  suggestion_reason TEXT,
  why_important TEXT,
  neglect_consequences TEXT,
  needs_contractor INTEGER DEFAULT 0,
  contractor_category TEXT,
  workflow_stage TEXT DEFAULT 'planning',
  scheduled_work_date TEXT,
  scheduled_work_time_start TEXT,
  scheduled_work_time_end TEXT,
  selected_quote_id TEXT,
  linked_project_id TEXT,
  priority_severity TEXT DEFAULT 'nice_to_have' NOT NULL,
  risk_level TEXT,
  complexity TEXT,
  ai_rationale TEXT,
  enrichment_status TEXT,
  enrichment_error TEXT,
  enrichment_attempts INTEGER DEFAULT 0,
  enriched_at TEXT,
  raw_capture_text TEXT,
  blocked INTEGER DEFAULT 0,
  blocker_reason TEXT,
  blocked_at TEXT,
  blocked_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  clarification_question TEXT,
  is_personal INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  cover_photo_id TEXT,
  is_purchase INTEGER DEFAULT 0,
  purchase_estimated_cost_min INTEGER,
  purchase_estimated_cost_max INTEGER,
  purchase_suggestion_dismissed INTEGER DEFAULT 0,
  budget_item_id TEXT,
  time_effort TEXT,
  reminder_claimed_at TEXT,
  reminder_attempt_count INTEGER DEFAULT 0
);

INSERT INTO tasks_new (
  id, household_id, space_id, system_category, title, description, frequency,
  custom_interval_days, next_due_date, last_completed_at, assigned_to,
  reminder_days_before, is_active, source, created_at, updated_at, deleted_at,
  updated_by, version, reminder_enabled, reminder_time, reminder_repeat,
  last_reminder_sent_at, snooze_until, suggested_by, home_feature_id,
  template_id, suggestion_reason, why_important, neglect_consequences,
  needs_contractor, contractor_category, workflow_stage, scheduled_work_date,
  scheduled_work_time_start, scheduled_work_time_end, selected_quote_id,
  linked_project_id, priority_severity, risk_level, complexity, ai_rationale,
  enrichment_status, enrichment_error, enrichment_attempts, enriched_at,
  raw_capture_text, blocked, blocker_reason, blocked_at, blocked_by,
  clarification_question, is_personal, created_by, cover_photo_id, is_purchase,
  purchase_estimated_cost_min, purchase_estimated_cost_max,
  purchase_suggestion_dismissed, budget_item_id, time_effort,
  reminder_claimed_at, reminder_attempt_count
)
SELECT
  id, household_id, space_id, system_category, title, description, frequency,
  custom_interval_days, next_due_date, last_completed_at, assigned_to,
  reminder_days_before, is_active, source, created_at, updated_at, deleted_at,
  updated_by, version, reminder_enabled, reminder_time, reminder_repeat,
  last_reminder_sent_at, snooze_until, suggested_by, home_feature_id,
  template_id, suggestion_reason, why_important, neglect_consequences,
  needs_contractor, contractor_category, workflow_stage, scheduled_work_date,
  scheduled_work_time_start, scheduled_work_time_end, selected_quote_id,
  linked_project_id, priority_severity, risk_level, complexity, ai_rationale,
  enrichment_status, enrichment_error, enrichment_attempts, enriched_at,
  raw_capture_text, blocked, blocker_reason, blocked_at, blocked_by,
  clarification_question, is_personal, created_by, cover_photo_id, is_purchase,
  purchase_estimated_cost_min, purchase_estimated_cost_max,
  purchase_suggestion_dismissed, budget_item_id, time_effort,
  reminder_claimed_at, reminder_attempt_count
FROM tasks;

DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

CREATE INDEX IF NOT EXISTS maintenance_tasks_household_id_idx ON tasks(household_id);
CREATE INDEX IF NOT EXISTS maintenance_tasks_next_due_date_idx ON tasks(next_due_date);
CREATE INDEX IF NOT EXISTS maintenance_tasks_is_active_idx ON tasks(is_active);
CREATE INDEX IF NOT EXISTS maintenance_tasks_space_id_idx ON tasks(space_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_tasks_reminder ON tasks(reminder_enabled, next_due_date);
CREATE INDEX IF NOT EXISTS maintenance_tasks_workflow_stage_idx ON tasks(workflow_stage);
CREATE INDEX IF NOT EXISTS maintenance_tasks_needs_contractor_idx ON tasks(needs_contractor);
CREATE INDEX IF NOT EXISTS maintenance_tasks_priority_severity_idx ON tasks(priority_severity);
CREATE INDEX IF NOT EXISTS maintenance_tasks_enrichment_status_idx ON tasks(enrichment_status);
CREATE INDEX IF NOT EXISTS maintenance_tasks_risk_level_idx ON tasks(risk_level);
CREATE INDEX IF NOT EXISTS maintenance_tasks_blocked_idx ON tasks(blocked);
CREATE INDEX IF NOT EXISTS maintenance_tasks_is_personal_idx ON tasks(is_personal);
CREATE INDEX IF NOT EXISTS maintenance_tasks_created_by_idx ON tasks(created_by);
CREATE INDEX IF NOT EXISTS tasks_cover_photo_id_idx ON tasks(cover_photo_id);
CREATE INDEX IF NOT EXISTS tasks_is_purchase_idx ON tasks(is_purchase);
CREATE INDEX IF NOT EXISTS maintenance_tasks_household_id_active_idx ON tasks(household_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS maintenance_tasks_next_due_date_active_idx ON tasks(household_id, next_due_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS maintenance_tasks_is_active_active_idx ON tasks(household_id, is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS maintenance_tasks_reminder_active_idx ON tasks(reminder_enabled, next_due_date) WHERE deleted_at IS NULL AND reminder_enabled = 1;

-- ---------- reports (image_count optional across brands) ----------
CREATE TABLE reports_new (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_key TEXT NOT NULL,
  status TEXT NOT NULL,
  processing_started_at TEXT,
  processing_completed_at TEXT,
  error_message TEXT,
  page_count INTEGER,
  inspection_date TEXT,
  inspector_name TEXT,
  property_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  updated_by TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  total_findings_count INTEGER DEFAULT 0,
  critical_findings_count INTEGER DEFAULT 0,
  processing_progress INTEGER DEFAULT 0,
  processing_stage TEXT,
  image_count INTEGER DEFAULT 0
);

INSERT INTO reports_new (
  id, household_id, uploaded_by, filename, file_size, file_key, status,
  processing_started_at, processing_completed_at, error_message, page_count,
  inspection_date, inspector_name, property_address, created_at, updated_at,
  deleted_at, updated_by, version, total_findings_count, critical_findings_count,
  processing_progress, processing_stage
)
SELECT
  id, household_id, uploaded_by, filename, file_size, file_key, status,
  processing_started_at, processing_completed_at, error_message, page_count,
  inspection_date, inspector_name, property_address, created_at, updated_at,
  deleted_at, updated_by, version, total_findings_count, critical_findings_count,
  processing_progress, processing_stage
FROM reports;

DROP TABLE reports;
ALTER TABLE reports_new RENAME TO reports;

CREATE INDEX IF NOT EXISTS reports_household_id_idx ON reports(household_id);
CREATE INDEX IF NOT EXISTS reports_status_idx ON reports(status);
CREATE INDEX IF NOT EXISTS reports_processing_stage_idx ON reports(processing_stage);
CREATE INDEX IF NOT EXISTS reports_household_id_active_idx ON reports(household_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS reports_status_active_idx ON reports(household_id, status) WHERE deleted_at IS NULL;

-- ---------- budget_items ----------
CREATE TABLE budget_items_new (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES budget_categories(id),
  timeframe TEXT NOT NULL,
  year INTEGER,
  quarter INTEGER,
  title TEXT NOT NULL,
  description TEXT,
  estimated_cost_min INTEGER,
  estimated_cost_max INTEGER,
  actual_cost INTEGER,
  priority TEXT NOT NULL,
  status TEXT NOT NULL,
  is_recurring INTEGER DEFAULT 0,
  recurrence_frequency TEXT,
  source_type TEXT,
  source_id TEXT,
  target_date TEXT,
  completed_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  horizon TEXT NOT NULL DEFAULT 'short_term'
);

INSERT INTO budget_items_new (
  id, household_id, category_id, timeframe, year, quarter, title, description,
  estimated_cost_min, estimated_cost_max, actual_cost, priority, status,
  is_recurring, recurrence_frequency, source_type, source_id, target_date,
  completed_at, created_by, created_at, updated_at, horizon
)
SELECT
  id, household_id, category_id, timeframe, year, quarter, title, description,
  estimated_cost_min, estimated_cost_max, actual_cost, priority, status,
  is_recurring, recurrence_frequency, source_type, source_id, target_date,
  completed_at, created_by, created_at, updated_at, horizon
FROM budget_items;

DROP TABLE budget_items;
ALTER TABLE budget_items_new RENAME TO budget_items;

CREATE INDEX IF NOT EXISTS budget_items_household_id_idx ON budget_items(household_id);
CREATE INDEX IF NOT EXISTS budget_items_timeframe_idx ON budget_items(timeframe);
CREATE INDEX IF NOT EXISTS budget_items_year_idx ON budget_items(year);
CREATE INDEX IF NOT EXISTS budget_items_status_idx ON budget_items(status);
CREATE INDEX IF NOT EXISTS budget_items_priority_idx ON budget_items(priority);
CREATE INDEX IF NOT EXISTS budget_items_target_date_idx ON budget_items(target_date);
CREATE INDEX IF NOT EXISTS budget_items_horizon_idx ON budget_items(horizon);

-- ---------- household_members ----------
CREATE TABLE household_members_new (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  joined_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  responsibilities_json TEXT NOT NULL DEFAULT '[]',
  notification_channel_preference TEXT NOT NULL DEFAULT 'auto'
);

INSERT INTO household_members_new (
  id, household_id, user_id, role, invited_by, joined_at, created_at, updated_at,
  deleted_at, responsibilities_json, notification_channel_preference
)
SELECT
  id, household_id, user_id, role, invited_by, joined_at, created_at, updated_at,
  deleted_at, responsibilities_json, notification_channel_preference
FROM household_members;

DROP TABLE household_members;
ALTER TABLE household_members_new RENAME TO household_members;

CREATE UNIQUE INDEX IF NOT EXISTS household_members_household_user_idx
  ON household_members(household_id, user_id);
CREATE INDEX IF NOT EXISTS household_members_user_id_idx ON household_members(user_id);

PRAGMA foreign_keys = ON;
