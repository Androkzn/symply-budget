-- Recurring reminders — "keep nagging until it's actually done" action items.
--
-- Distinct from `scheduled_notifications` (a one-shot delivery queue) and
-- `notification_history` (a read/unread inbox of things already sent): this
-- table tracks the LIFECYCLE of a recurring obligation per household+period
-- (e.g. "upload the August mortgage statement") — pending vs done, when the
-- next nudge is due, at what cadence, and how it was resolved. Each nudge is
-- still delivered through the existing `scheduled_notifications` queue; this
-- table only decides whether and when the next one is needed.
--
-- Shared schema across every brand D1 (mirrors `scheduled_notifications` /
-- `notification_history`), even though only the Budget Worker currently writes
-- rows to it (mortgage statement reminders). A registry
-- (`backend/src/services/recurring-reminders/registry.ts`) maps `type` to
-- per-type behaviour, so a future app registers a new type without touching
-- this table or the engine.
CREATE TABLE recurring_reminders (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  period_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data TEXT,
  frequency TEXT NOT NULL,
  next_nudge_at TEXT NOT NULL,
  last_nudged_at TEXT,
  nudge_count INTEGER NOT NULL DEFAULT 0,
  snoozed_until TEXT,
  completed_at TEXT,
  completed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  completed_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX recurring_reminders_household_status_idx ON recurring_reminders(household_id, status);
CREATE INDEX recurring_reminders_due_idx ON recurring_reminders(status, next_nudge_at);
CREATE INDEX recurring_reminders_reference_idx ON recurring_reminders(reference_type, reference_id);
CREATE UNIQUE INDEX recurring_reminders_period_unique_idx ON recurring_reminders(household_id, type, reference_id, period_key);
