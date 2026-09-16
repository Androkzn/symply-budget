-- Budget V2 local-first opaque push wake tokens (per enrolled device).
-- Stores Expo push tokens only — wake payloads contain type + householdId.

ALTER TABLE lf_devices ADD COLUMN expo_push_token TEXT;
ALTER TABLE lf_devices ADD COLUMN push_platform TEXT;
ALTER TABLE lf_devices ADD COLUMN push_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_lf_devices_push_token ON lf_devices(household_id, expo_push_token);
