-- Budget V2 local-first control plane (metadata only — no financial ledger).
-- Applied on all brand D1s; used by Budget Worker /v2 routes.

CREATE TABLE IF NOT EXISTS lf_households (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  key_epoch INTEGER NOT NULL DEFAULT 1,
  security_revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lf_households_owner ON lf_households(owner_user_id);

CREATE TABLE IF NOT EXISTS lf_memberships (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES lf_households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'ADULT')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE (household_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_lf_memberships_user ON lf_memberships(user_id);

CREATE TABLE IF NOT EXISTS lf_devices (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES lf_households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  device_label TEXT,
  signing_public_key TEXT NOT NULL,
  agreement_public_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE (household_id, id)
);

CREATE INDEX IF NOT EXISTS idx_lf_devices_household ON lf_devices(household_id);
CREATE INDEX IF NOT EXISTS idx_lf_devices_user ON lf_devices(user_id);

CREATE TABLE IF NOT EXISTS lf_mailbox_blobs (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES lf_households(id) ON DELETE CASCADE,
  recipient_device_id TEXT,
  r2_key TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  acked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_lf_mailbox_household ON lf_mailbox_blobs(household_id);
CREATE INDEX IF NOT EXISTS idx_lf_mailbox_expires ON lf_mailbox_blobs(expires_at);
