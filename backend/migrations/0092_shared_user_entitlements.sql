-- ============================================
-- Migration: Shared User / Data Bridge platform spine (Phase A1)
-- Description: Greenfield platform tables for joined-app identity, auth,
--              entitlements, Soft Transfer, bridge control, and deletion.
--              Schema installation only — no user-data backfill.
--              See documents/design/Ecosystem_Data_Bridge_Plan.md §3.
--              Drizzle: backend/src/db/schema.ts (platform bridge section).
-- ============================================

-- ============ IDENTITY AND AUTH ============

CREATE TABLE IF NOT EXISTS platform_identity_links (
  id TEXT PRIMARY KEY NOT NULL,
  link_type TEXT NOT NULL,
  link_value TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_identity_links_type_value_idx
  ON platform_identity_links(link_type, link_value);
CREATE INDEX IF NOT EXISTS platform_identity_links_user_id_idx
  ON platform_identity_links(user_id);

CREATE TABLE IF NOT EXISTS platform_profiles (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  contact_email TEXT,
  contact_email_verified INTEGER NOT NULL DEFAULT 0,
  locale TEXT,
  timezone TEXT,
  profile_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS platform_credentials (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_credentials_user_id_idx
  ON platform_credentials(user_id);

CREATE TABLE IF NOT EXISTS platform_refresh_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  sid TEXT NOT NULL,
  client_id TEXT NOT NULL,
  ent_ver INTEGER NOT NULL DEFAULT 1,
  device_info TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_refresh_tokens_token_hash_idx
  ON platform_refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS platform_refresh_tokens_user_id_idx
  ON platform_refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS platform_refresh_tokens_sid_idx
  ON platform_refresh_tokens(sid);

CREATE TABLE IF NOT EXISTS platform_idp_challenges (
  id TEXT PRIMARY KEY NOT NULL,
  nonce_hash TEXT NOT NULL,
  caller_brand TEXT NOT NULL,
  environment TEXT NOT NULL,
  provider TEXT NOT NULL,
  intent TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_idp_challenges_nonce_hash_idx
  ON platform_idp_challenges(nonce_hash);
CREATE INDEX IF NOT EXISTS platform_idp_challenges_expires_at_idx
  ON platform_idp_challenges(expires_at);

-- ============ APP ENTITLEMENTS AND AI ============

CREATE TABLE IF NOT EXISTS user_app_entitlements (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand_id TEXT NOT NULL,
  entitlement_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'revoked',
  revocation_pending INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS user_app_entitlements_user_brand_idx
  ON user_app_entitlements(user_id, brand_id);
CREATE INDEX IF NOT EXISTS user_app_entitlements_brand_id_idx
  ON user_app_entitlements(brand_id);

CREATE TABLE IF NOT EXISTS user_entitlements (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ai_master_enabled INTEGER NOT NULL DEFAULT 0,
  ai_status TEXT NOT NULL DEFAULT 'off',
  ai_mode TEXT NOT NULL DEFAULT 'platform',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ BRIDGE CONTROL ============

CREATE TABLE IF NOT EXISTS platform_bridge_control (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO platform_bridge_control (key, value) VALUES
  ('platformRegistrationEnabled', 'false'),
  ('softTransferEnabled', 'false'),
  ('lifeSnapshotEnabled', 'false'),
  ('realtimeVoiceEnabled', 'false');

-- ============ SOFT TRANSFER ============

CREATE TABLE IF NOT EXISTS transfer_consents (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_brand_id TEXT NOT NULL,
  destination_brand_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  consent_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS transfer_consents_user_id_idx
  ON transfer_consents(user_id);
CREATE INDEX IF NOT EXISTS transfer_consents_package_idx
  ON transfer_consents(user_id, package_id, status);

CREATE TABLE IF NOT EXISTS token_exchange_jtis (
  jti_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  source_brand_id TEXT NOT NULL,
  destination_brand_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS token_exchange_jtis_operation_id_idx
  ON token_exchange_jtis(operation_id);
CREATE INDEX IF NOT EXISTS token_exchange_jtis_expires_at_idx
  ON token_exchange_jtis(expires_at);

CREATE TABLE IF NOT EXISTS transfer_import_receipts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  idempotency_fingerprint TEXT NOT NULL,
  package_id TEXT NOT NULL,
  source_brand_id TEXT NOT NULL,
  destination_brand_id TEXT NOT NULL,
  consent_id TEXT REFERENCES transfer_consents(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'imported',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS transfer_import_receipts_operation_id_idx
  ON transfer_import_receipts(operation_id);
CREATE UNIQUE INDEX IF NOT EXISTS transfer_import_receipts_idempotency_idx
  ON transfer_import_receipts(idempotency_fingerprint);
CREATE INDEX IF NOT EXISTS transfer_import_receipts_user_id_idx
  ON transfer_import_receipts(user_id);

CREATE TABLE IF NOT EXISTS transfer_package_events (
  id TEXT PRIMARY KEY NOT NULL,
  package_id TEXT NOT NULL,
  package_version INTEGER NOT NULL DEFAULT 1,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_brand_id TEXT NOT NULL,
  destination_brand_id TEXT NOT NULL,
  consent_id TEXT REFERENCES transfer_consents(id) ON DELETE SET NULL,
  operation_id TEXT,
  event_type TEXT NOT NULL,
  event_status TEXT NOT NULL,
  envelope_id_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS transfer_package_events_user_id_idx
  ON transfer_package_events(user_id);
CREATE INDEX IF NOT EXISTS transfer_package_events_operation_id_idx
  ON transfer_package_events(operation_id);
CREATE INDEX IF NOT EXISTS transfer_package_events_consent_id_idx
  ON transfer_package_events(consent_id);

CREATE TABLE IF NOT EXISTS transfer_onboarding_contexts (
  id TEXT PRIMARY KEY NOT NULL,
  context_hash TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand_id TEXT NOT NULL,
  purpose TEXT,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS transfer_onboarding_contexts_hash_idx
  ON transfer_onboarding_contexts(context_hash);
CREATE INDEX IF NOT EXISTS transfer_onboarding_contexts_user_id_idx
  ON transfer_onboarding_contexts(user_id);
CREATE INDEX IF NOT EXISTS transfer_onboarding_contexts_expires_at_idx
  ON transfer_onboarding_contexts(expires_at);

CREATE TABLE IF NOT EXISTS transfer_prepare_operations (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_fingerprint TEXT NOT NULL,
  package_id TEXT NOT NULL,
  source_brand_id TEXT NOT NULL,
  destination_brand_id TEXT NOT NULL,
  consent_id TEXT REFERENCES transfer_consents(id) ON DELETE SET NULL,
  operation_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'prepared',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS transfer_prepare_operations_idempotency_idx
  ON transfer_prepare_operations(idempotency_fingerprint);
CREATE UNIQUE INDEX IF NOT EXISTS transfer_prepare_operations_operation_id_idx
  ON transfer_prepare_operations(operation_id);
CREATE INDEX IF NOT EXISTS transfer_prepare_operations_user_id_idx
  ON transfer_prepare_operations(user_id);
CREATE INDEX IF NOT EXISTS transfer_prepare_operations_expires_at_idx
  ON transfer_prepare_operations(expires_at);

-- ============ DELETION AND IDEMPOTENCY ============

CREATE TABLE IF NOT EXISTS platform_deletion_requests (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  idempotency_fingerprint TEXT NOT NULL,
  status_secret_hash TEXT NOT NULL,
  pepper_version TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  terminal_at TEXT,
  status_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_deletion_requests_idempotency_idx
  ON platform_deletion_requests(idempotency_fingerprint);
CREATE UNIQUE INDEX IF NOT EXISTS platform_deletion_requests_status_secret_idx
  ON platform_deletion_requests(status_secret_hash);
CREATE INDEX IF NOT EXISTS platform_deletion_requests_user_id_idx
  ON platform_deletion_requests(user_id);
CREATE INDEX IF NOT EXISTS platform_deletion_requests_state_idx
  ON platform_deletion_requests(state);

CREATE TABLE IF NOT EXISTS platform_request_idempotency (
  idempotency_fingerprint TEXT PRIMARY KEY NOT NULL,
  route_key TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  request_fingerprint TEXT NOT NULL,
  response_status INTEGER,
  response_body_hash TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS platform_request_idempotency_expires_at_idx
  ON platform_request_idempotency(expires_at);
CREATE INDEX IF NOT EXISTS platform_request_idempotency_route_key_idx
  ON platform_request_idempotency(route_key);
