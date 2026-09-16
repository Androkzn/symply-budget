-- Household BYOK key sharing: a member offers their own AI provider key to the
-- rest of their local-first household. All new tables; no existing-table changes.
--
-- Why this joins the lf_* family rather than the ai_credentials one:
--
--   * The key that protects the share is the Household Data Key, whose epoch
--     lives on lf_households.key_epoch and whose holders are lf_devices. The
--     membership that grants access is lf_memberships. Hanging this off the D1
--     `households`/`household_members` tables would scope it to a DIFFERENT
--     household graph than the one that owns the crypto.
--   * user_ai_credentials is deliberately SERVER-READABLE (the Worker probes and
--     leases the key). That is fine for your own key; it is the wrong custody
--     model for one fanned out to a household.
--
-- So, like lf_blobs (0157), the relay stores ciphertext and nothing else. The
-- owner's device seals the key under
--
--   HKDF-SHA256(hdk, info = "lf-ai-key-share:v1:<householdId>:<epoch>:<provider>")
--
-- and only enrolled member devices hold the HDK. Nothing here is decryptable
-- with AI_CREDENTIAL_KEK_V1, or by the Worker at all.
--
-- `key_epoch` travels with the row because the HDK rotates when a device is
-- revoked; the reader picks the matching retired key from its ring. Without it
-- a rotation silently orphans every share (same lesson as 0157:21-23).

CREATE TABLE IF NOT EXISTS lf_ai_key_shares (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES lf_households(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'gemini')),
  -- base64(nonce || ciphertext || tag) — sealed on the owner's device.
  ciphertext TEXT NOT NULL,
  key_epoch INTEGER NOT NULL,
  -- Derivation/AAD scheme version, so the envelope can change without a migration.
  envelope_version TEXT NOT NULL DEFAULT 'v1',
  -- Last 4 characters only. Client-supplied, because the server cannot read the key.
  key_hint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (household_id, owner_user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_lf_ai_key_shares_household
  ON lf_ai_key_shares(household_id, status);

-- Apple 5.1.2(i): the RECIPIENT's acknowledgement that their prompts will be
-- sent to a third-party provider under someone else's account and billing. The
-- owner's own acknowledgement already lives on user_ai_credentials.consent_*;
-- this is the other half, and the server refuses to hand over the sealed blob
-- without it.
CREATE TABLE IF NOT EXISTS lf_ai_key_share_consents (
  share_id TEXT NOT NULL REFERENCES lf_ai_key_shares(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  last_used_at TEXT,
  PRIMARY KEY (share_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_lf_ai_key_share_consents_user
  ON lf_ai_key_share_consents(user_id);
