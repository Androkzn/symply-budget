-- Smart Notifications P1 — gateway decision log.
--
-- One row per resolved recipient per Smart Notification gateway request. In P1
-- (pass-through mode) this is parity telemetry: it records the gateway's
-- decision (lane, recipient rule, copy source) without changing delivery.
-- Purely additive — it does not touch `scheduled_notifications`,
-- `notification_history`, or `notification_engagement`, which remain canonical.
--
-- Hand-written (not drizzle-generated): the notification tables live in
-- schema-notifications.ts, which is not the source for `db:generate`
-- (drizzle.config.ts points at schema.ts), so notification migrations are
-- authored by hand here.

CREATE TABLE IF NOT EXISTS smart_notification_decision (
  id TEXT PRIMARY KEY,
  household_id TEXT,
  recipient_user_id TEXT NOT NULL,
  producer_type TEXT NOT NULL,
  lane TEXT NOT NULL,
  recipient_rule TEXT NOT NULL,
  copy_source TEXT NOT NULL DEFAULT 'template',
  batch_role TEXT NOT NULL DEFAULT 'single',
  reference_type TEXT,
  reference_id TEXT,
  outcome_ref TEXT,
  suppress_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS smart_notification_decision_recipient_idx
  ON smart_notification_decision (recipient_user_id);
CREATE INDEX IF NOT EXISTS smart_notification_decision_household_idx
  ON smart_notification_decision (household_id);
CREATE INDEX IF NOT EXISTS smart_notification_decision_created_at_idx
  ON smart_notification_decision (created_at);
CREATE INDEX IF NOT EXISTS smart_notification_decision_reference_idx
  ON smart_notification_decision (reference_type, reference_id);
