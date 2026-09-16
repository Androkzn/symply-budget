-- Enrolment verification moves from an owner-only word to a key-bound SAS.
--
-- The old `oob_phrases_json` / `oob_correct_index` pair could not authenticate
-- anything: both were drawn at invite-create time, before the claiming device's
-- keys existed, and only the owner ever learned the correct index — so the
-- invitee contributed nothing to the check and a substituted enrolment key went
-- undetected. The replacement is derived on both devices from the keys actually
-- being enrolled plus the invite secret (which this database holds only as a
-- hash), so there is nothing for the server to store and nothing to migrate
-- across: the columns simply go.
--
-- `invitee_email` binds an invite to one account, making a leaked link inert.
-- `sas_verified_at` records that the owner confirmed the digits.
--
-- SQLite cannot drop NOT NULL columns in place, so this is the standard table
-- rebuild. Rows are carried over: a live invite keeps its code, secret hash and
-- any claim already on it, and simply loses the words nothing was checking.

CREATE TABLE lf_invites_new (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES lf_households(id) ON DELETE CASCADE,
  short_code TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'ADULT')),
  created_by_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'claimed', 'approved', 'revoked', 'expired')),
  expires_at TEXT NOT NULL,
  invitee_email TEXT,
  claimed_by_user_id TEXT,
  claimed_device_id TEXT,
  claimed_signing_public_key TEXT,
  claimed_agreement_public_key TEXT,
  sas_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (short_code)
);

INSERT INTO lf_invites_new (
  id, household_id, short_code, secret_hash, role, created_by_user_id, status,
  expires_at, invitee_email, claimed_by_user_id, claimed_device_id,
  claimed_signing_public_key, claimed_agreement_public_key, sas_verified_at,
  created_at, updated_at
)
SELECT
  id, household_id, short_code, secret_hash, role, created_by_user_id, status,
  expires_at, NULL, claimed_by_user_id, claimed_device_id,
  claimed_signing_public_key, claimed_agreement_public_key, oob_verified_at,
  created_at, updated_at
FROM lf_invites;

DROP TABLE lf_invites;
ALTER TABLE lf_invites_new RENAME TO lf_invites;

CREATE INDEX IF NOT EXISTS idx_lf_invites_household ON lf_invites(household_id);
CREATE INDEX IF NOT EXISTS idx_lf_invites_status ON lf_invites(status);
-- The pending-approvals screen reads by household + status together.
CREATE INDEX IF NOT EXISTS idx_lf_invites_household_status ON lf_invites(household_id, status);
