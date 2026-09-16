-- Savings Projection: a per-month savings target for a future month.
--
-- Backs the Savings → Projection tab, where past months show ACTUAL net savings
-- (derived, never stored) and each remaining month of the year carries an
-- editable target. A target may be set on one month or bulk-applied to every
-- remaining month, so the row is keyed by (household, period) and upserted.
--
-- `target_cents` may be negative: a planned deficit month (a car purchase, a
-- vacation) is a legitimate projection, and forcing it to 0 would overstate the
-- year-end figure. Clearing a target DELETES the row rather than writing 0 —
-- "no target" and "a target of exactly zero" are different states in the UI.

CREATE TABLE IF NOT EXISTS savings_monthly_targets (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  period TEXT NOT NULL, -- 'YYYY-MM'
  target_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CAD',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS savings_monthly_targets_household_idx
  ON savings_monthly_targets(household_id, period);

-- One target per household-month. The write path relies on this for its upsert.
CREATE UNIQUE INDEX IF NOT EXISTS savings_monthly_targets_period_idx
  ON savings_monthly_targets(household_id, period);
