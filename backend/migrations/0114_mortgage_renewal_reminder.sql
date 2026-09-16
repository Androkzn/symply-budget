-- Mortgage renewal reminder (Phase 4). Columns on `mortgages` drive a reminder
-- that fires reminder_months_before the current term's maturity date, with
-- last_renewal_reminder_sent_at giving one-send-per-window idempotency. Fired
-- from the existing scheduled() handler (no new cron trigger). Columns match
-- schema-mortgage.ts EXACTLY.
-- See documents/requirements/as-built/mortgage/Mortgage_Implementation_Plan.md §8.

ALTER TABLE mortgages ADD COLUMN reminder_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE mortgages ADD COLUMN reminder_months_before INTEGER NOT NULL DEFAULT 3;
ALTER TABLE mortgages ADD COLUMN last_renewal_reminder_sent_at TEXT;
