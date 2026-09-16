-- B1: CAS claim columns for scheduled notification delivery (expand-only).
-- Reverse (manual rollback):
--   DROP TABLE IF EXISTS cron_leases;
--   ALTER TABLE tasks DROP COLUMN reminder_attempt_count;
--   ALTER TABLE tasks DROP COLUMN reminder_claimed_at;
--   ALTER TABLE scheduled_notifications DROP COLUMN attempt_count;
--   ALTER TABLE scheduled_notifications DROP COLUMN claim_owner;
--   ALTER TABLE scheduled_notifications DROP COLUMN claimed_at;

ALTER TABLE scheduled_notifications ADD COLUMN claimed_at TEXT;
ALTER TABLE scheduled_notifications ADD COLUMN claim_owner TEXT;
ALTER TABLE scheduled_notifications ADD COLUMN attempt_count INTEGER DEFAULT 0;

ALTER TABLE tasks ADD COLUMN reminder_claimed_at TEXT;
ALTER TABLE tasks ADD COLUMN reminder_attempt_count INTEGER DEFAULT 0;

-- D1 cron run lease (singleton per job_name; TTL enforced in application code).
CREATE TABLE IF NOT EXISTS cron_leases (
  job_name TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
