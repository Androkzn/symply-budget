-- Budget transfers: a one-way move of a month's leftover budget to a
-- destination (next month's budget, a savings goal, or a registered
-- TFSA/RRSP/FHSA account). The source month's remaining balance subtracts the
-- sum of transfers out of that month, so the same leftover can't be moved
-- twice; a 'next_month' transfer credits the target month as carry-in.
-- Savings-goal / registered-account transfers additionally bump those
-- subsystems; destination_ref_id links the registered_transactions row created
-- for an account transfer so an undo can reverse the balance move.
-- destination_label snapshots the target's name so history stays readable even
-- after the goal/account is deleted.
CREATE TABLE IF NOT EXISTS budget_transfers (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  source_year INTEGER NOT NULL,
  source_month INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  destination_type TEXT NOT NULL,
  dest_year INTEGER,
  dest_month INTEGER,
  goal_id TEXT,
  account_id TEXT,
  destination_ref_id TEXT,
  destination_label TEXT NOT NULL,
  note TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS budget_transfers_source_idx
  ON budget_transfers(household_id, source_year, source_month);
CREATE INDEX IF NOT EXISTS budget_transfers_dest_idx
  ON budget_transfers(household_id, dest_year, dest_month);
