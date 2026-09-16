-- Simple House Database Schema
-- Initial Migration

-- ============ USERS ============

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT,
  apple_id TEXT UNIQUE,
  google_id TEXT UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  updated_by TEXT,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);
CREATE INDEX IF NOT EXISTS users_apple_id_idx ON users(apple_id);
CREATE INDEX IF NOT EXISTS users_google_id_idx ON users(google_id);

-- ============ REFRESH TOKENS ============

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  device_info TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx ON refresh_tokens(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS refresh_tokens_token_hash_idx ON refresh_tokens(token_hash);

-- ============ EMAIL VERIFICATIONS ============

CREATE TABLE IF NOT EXISTS email_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS email_verifications_user_id_idx ON email_verifications(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS email_verifications_token_hash_idx ON email_verifications(token_hash);

-- ============ PASSWORD RESETS ============

CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS password_resets_user_id_idx ON password_resets(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS password_resets_token_hash_idx ON password_resets(token_hash);

-- ============ HOUSEHOLDS ============

CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state_province TEXT,
  postal_code TEXT,
  country TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  updated_by TEXT REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS households_name_idx ON households(name);

-- ============ HOUSEHOLD MEMBERS ============

CREATE TABLE IF NOT EXISTS household_members (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  invited_by TEXT REFERENCES users(id),
  joined_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  UNIQUE(household_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS household_members_household_user_idx ON household_members(household_id, user_id);
CREATE INDEX IF NOT EXISTS household_members_user_id_idx ON household_members(user_id);

-- ============ HOUSEHOLD INVITATIONS ============

CREATE TABLE IF NOT EXISTS household_invitations (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  invited_by TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  declined_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS household_invitations_household_id_idx ON household_invitations(household_id);
CREATE INDEX IF NOT EXISTS household_invitations_email_idx ON household_invitations(email);
CREATE UNIQUE INDEX IF NOT EXISTS household_invitations_token_hash_idx ON household_invitations(token_hash);

-- ============ REPORTS ============

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
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
  updated_by TEXT REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS reports_household_id_idx ON reports(household_id);
CREATE INDEX IF NOT EXISTS reports_status_idx ON reports(status);

-- ============ REPORT CHUNKS ============

CREATE TABLE IF NOT EXISTS report_chunks (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  page_number INTEGER,
  section_type TEXT,
  content TEXT NOT NULL,
  embedding_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS report_chunks_report_id_idx ON report_chunks(report_id);
CREATE INDEX IF NOT EXISTS report_chunks_report_chunk_idx ON report_chunks(report_id, chunk_index);

-- ============ FINDINGS ============

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  chunk_id TEXT REFERENCES report_chunks(id),
  system_category TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  plain_language_summary TEXT,
  ai_confidence REAL,
  evidence_page_numbers TEXT,
  raw_ai_output TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS findings_report_id_idx ON findings(report_id);
CREATE INDEX IF NOT EXISTS findings_severity_idx ON findings(severity);
CREATE INDEX IF NOT EXISTS findings_system_category_idx ON findings(system_category);

-- ============ ACTION PLANS ============

CREATE TABLE IF NOT EXISTS action_plans (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  timeframe TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  ai_model_version TEXT,
  prompt_version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS action_plans_report_id_idx ON action_plans(report_id);
CREATE INDEX IF NOT EXISTS action_plans_timeframe_idx ON action_plans(timeframe);

-- ============ ACTION ITEMS ============

CREATE TABLE IF NOT EXISTS action_items (
  id TEXT PRIMARY KEY,
  action_plan_id TEXT NOT NULL REFERENCES action_plans(id) ON DELETE CASCADE,
  finding_id TEXT REFERENCES findings(id),
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  priority TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  estimated_cost_min INTEGER,
  estimated_cost_max INTEGER,
  cost_confidence TEXT,
  cost_disclaimer TEXT,
  due_date TEXT,
  status TEXT NOT NULL,
  completed_at TEXT,
  completed_by TEXT REFERENCES users(id),
  notes TEXT,
  sort_order INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  updated_by TEXT REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS action_items_action_plan_id_idx ON action_items(action_plan_id);
CREATE INDEX IF NOT EXISTS action_items_household_id_idx ON action_items(household_id);
CREATE INDEX IF NOT EXISTS action_items_status_idx ON action_items(status);
CREATE INDEX IF NOT EXISTS action_items_priority_idx ON action_items(priority);

-- ============ MAINTENANCE TASKS ============

CREATE TABLE IF NOT EXISTS maintenance_tasks (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  system_category TEXT,
  title TEXT NOT NULL,
  description TEXT,
  frequency TEXT NOT NULL,
  custom_interval_days INTEGER,
  next_due_date TEXT,
  last_completed_at TEXT,
  assigned_to TEXT REFERENCES users(id),
  reminder_days_before INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  updated_by TEXT REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS maintenance_tasks_household_id_idx ON maintenance_tasks(household_id);
CREATE INDEX IF NOT EXISTS maintenance_tasks_next_due_date_idx ON maintenance_tasks(next_due_date);
CREATE INDEX IF NOT EXISTS maintenance_tasks_is_active_idx ON maintenance_tasks(is_active);

-- ============ MAINTENANCE COMPLETIONS ============

CREATE TABLE IF NOT EXISTS maintenance_completions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES maintenance_tasks(id) ON DELETE CASCADE,
  completed_by TEXT NOT NULL REFERENCES users(id),
  completed_at TEXT NOT NULL,
  notes TEXT,
  photo_keys TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS maintenance_completions_task_id_idx ON maintenance_completions(task_id);
CREATE INDEX IF NOT EXISTS maintenance_completions_completed_at_idx ON maintenance_completions(completed_at);

-- ============ PROCESSING JOBS ============

CREATE TABLE IF NOT EXISTS processing_jobs (
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
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS processing_jobs_report_id_idx ON processing_jobs(report_id);
CREATE INDEX IF NOT EXISTS processing_jobs_status_idx ON processing_jobs(status);

-- ============ AUDIT LOG ============

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  metadata TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS audit_log_user_id_idx ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log(action);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log(created_at);
