-- AI Access Migration: BYOK credential vault, preferences, audit, leases
-- All new tables; no existing-table constraint changes.

CREATE TABLE IF NOT EXISTS user_ai_credentials (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  key_version TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_validation',
  last_validated_at TEXT,
  last_used_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS user_ai_credentials_user_provider_idx
  ON user_ai_credentials(user_id, provider);
CREATE INDEX IF NOT EXISTS user_ai_credentials_user_id_idx
  ON user_ai_credentials(user_id);

CREATE TABLE IF NOT EXISTS user_ai_preferences (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_source TEXT,
  active_provider TEXT,
  selected_model_id TEXT,
  allow_paid_fallback INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_credential_audit (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  action TEXT NOT NULL,
  result TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ai_credential_audit_user_id_idx
  ON ai_credential_audit(user_id);
CREATE INDEX IF NOT EXISTS ai_credential_audit_created_at_idx
  ON ai_credential_audit(created_at);

CREATE TABLE IF NOT EXISTS ai_credential_leases (
  token_hash TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  required_capability TEXT,
  selected_model_id TEXT,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ai_credential_leases_job_id_idx
  ON ai_credential_leases(job_id);
CREATE INDEX IF NOT EXISTS ai_credential_leases_expires_at_idx
  ON ai_credential_leases(expires_at);
