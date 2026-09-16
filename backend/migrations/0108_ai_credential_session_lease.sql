-- Hybrid key storage: the durable key home is the device Keychain; the server
-- holds only a short-lived, encrypted SESSION LEASE so background AI (cron
-- digests, Lambda reports, server chat) keeps working. `expires_at` is when the
-- server copy stops being usable (client re-leases on foreground); `session_leased`
-- marks a row seeded from a device lease rather than the legacy permanent store.
ALTER TABLE user_ai_credentials ADD COLUMN expires_at TEXT;
ALTER TABLE user_ai_credentials ADD COLUMN session_leased INTEGER NOT NULL DEFAULT 0;
