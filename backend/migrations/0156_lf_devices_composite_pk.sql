-- lf_devices: PRIMARY KEY (id) -> PRIMARY KEY (household_id, id).
-- Applied on all brand D1s; used by the local-first /v2 control plane.
--
-- WHY
-- `id` alone as the PK means a device row is globally unique, so a device can be
-- an active member of exactly ONE household at a time. Approving a device into a
-- second household conflicted on `id`, and until a0902efb the upsert left the
-- stale household_id — every (id, household_id, user_id) authz lookup then
-- missed, GET /mailbox 403'd, and a joining member could never fetch its
-- wrapped-HDK envelope (two-device run 20260812-215155, FAIL mm-05).
--
-- a0902efb fixed that by RE-HOMING the row. That is correct for Budget, where a
-- device belongs to one household. It is wrong for Symply House V2, where one
-- device must be an active member of 1-3 properties simultaneously: activating
-- property B would silently re-home the device away from property A, and A's
-- mailbox / ack / checkpoint authz would start 403ing.
--
-- A composite key lets one device id appear once per household, which is the
-- shape both products actually need. Budget behaviour is unchanged (it only ever
-- has one household per device).
--
-- DATA
-- The table is REBUILT, not altered — SQLite cannot change a PK in place. Rows
-- are carried over, so enrolled devices keep their registration and push tokens.
-- Duplicate (household_id, id) pairs cannot exist today: the old schema already
-- carried UNIQUE (household_id, id), so the copy is total.
--
-- Every consumer is already household-scoped and needs no change:
--   local-first-mailbox-service.ts:235   deviceBelongsToUser
--   local-first-sync-wake-service.ts:115/126/148
--   local-first-control-service.ts:271   revokeDevice
-- Only ON CONFLICT(id) had to move to ON CONFLICT(household_id, id).

PRAGMA foreign_keys=OFF;

CREATE TABLE lf_devices_new (
  id TEXT NOT NULL,
  household_id TEXT NOT NULL REFERENCES lf_households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  device_label TEXT,
  signing_public_key TEXT NOT NULL,
  agreement_public_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  expo_push_token TEXT,
  push_platform TEXT,
  push_updated_at TEXT,
  PRIMARY KEY (household_id, id)
);

INSERT INTO lf_devices_new
  (id, household_id, user_id, device_label, signing_public_key, agreement_public_key,
   status, last_seen_at, created_at, revoked_at, expo_push_token, push_platform, push_updated_at)
SELECT
   id, household_id, user_id, device_label, signing_public_key, agreement_public_key,
   status, last_seen_at, created_at, revoked_at, expo_push_token, push_platform, push_updated_at
FROM lf_devices;

DROP TABLE lf_devices;
ALTER TABLE lf_devices_new RENAME TO lf_devices;

-- Recreate the indexes the old table carried (the DROP took them with it).
CREATE INDEX IF NOT EXISTS idx_lf_devices_household ON lf_devices(household_id);
CREATE INDEX IF NOT EXISTS idx_lf_devices_user ON lf_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_lf_devices_push_token ON lf_devices(household_id, expo_push_token);

-- A device id still needs to be addressable across households for diagnostics.
CREATE INDEX IF NOT EXISTS idx_lf_devices_id ON lf_devices(id);

PRAGMA foreign_keys=ON;
