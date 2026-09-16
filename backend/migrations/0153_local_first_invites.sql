-- Budget V2 local-first invites (metadata only — no HDK / financial content).

CREATE TABLE IF NOT EXISTS lf_invites (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES lf_households(id) ON DELETE CASCADE,
  short_code TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'ADULT')),
  created_by_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'claimed', 'approved', 'revoked', 'expired')),
  expires_at TEXT NOT NULL,
  claimed_by_user_id TEXT,
  claimed_device_id TEXT,
  claimed_signing_public_key TEXT,
  claimed_agreement_public_key TEXT,
  oob_phrases_json TEXT NOT NULL,
  oob_correct_index INTEGER NOT NULL,
  oob_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (short_code)
);

CREATE INDEX IF NOT EXISTS idx_lf_invites_household ON lf_invites(household_id);
CREATE INDEX IF NOT EXISTS idx_lf_invites_status ON lf_invites(status);
