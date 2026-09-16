-- ============================================
-- Migration: Platform profile outbox + session revocation + deletion work
-- Data Bridge Phase A8 tables omitted from 0092 condensed install.
-- ============================================

CREATE TABLE IF NOT EXISTS platform_profile_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS platform_profile_outbox_user_id_idx
  ON platform_profile_outbox(user_id);

CREATE TABLE IF NOT EXISTS platform_profile_mirrors (
  user_id TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  profile_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, brand_id)
);

CREATE TABLE IF NOT EXISTS platform_session_revocations (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sid TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at TEXT
);
CREATE INDEX IF NOT EXISTS platform_session_revocations_sid_idx
  ON platform_session_revocations(sid);
CREATE INDEX IF NOT EXISTS platform_session_revocations_user_id_idx
  ON platform_session_revocations(user_id);

CREATE TABLE IF NOT EXISTS platform_session_revocation_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  sid TEXT NOT NULL,
  target_brand_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at TEXT
);

CREATE TABLE IF NOT EXISTS platform_deletion_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES platform_deletion_requests(id) ON DELETE CASCADE,
  target_brand_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at TEXT,
  terminal_state TEXT
);
CREATE INDEX IF NOT EXISTS platform_deletion_outbox_request_id_idx
  ON platform_deletion_outbox(request_id);
