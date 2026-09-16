-- Pension tab (Budget) — extend the existing registered-accounts engine to model
-- workplace / employer plans, per-account annual contribution goals, and undoable
-- AI statement imports. Reuses registered_accounts / registered_transactions rather
-- than a parallel pension_* domain, so the CRA contribution-room math stays the
-- single source of truth for "room left".
--
-- account_type now also allows 'dpsp' and 'rpp' (employer DC plans). A group /
-- workplace RRSP stays account_type='rrsp' with is_employer_plan=1. DPSP/RPP
-- contributions feed a Pension Adjustment (computed in savings-limits.ts) that
-- reduces next year's personal RRSP room automatically.

-- Registered accounts: workplace-plan metadata + personal annual contribution goal.
ALTER TABLE registered_accounts ADD COLUMN is_employer_plan INTEGER NOT NULL DEFAULT 0;
ALTER TABLE registered_accounts ADD COLUMN employer_name TEXT;
ALTER TABLE registered_accounts ADD COLUMN annual_goal_cents INTEGER;

-- Registered transactions: who funded the contribution (self vs employer) drives the
-- room/goal split; source + import_batch_id give AI statement imports undo parity with
-- the expenses/income import pattern.
ALTER TABLE registered_transactions ADD COLUMN contributor TEXT NOT NULL DEFAULT 'self';
ALTER TABLE registered_transactions ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE registered_transactions ADD COLUMN import_batch_id TEXT;

CREATE INDEX IF NOT EXISTS registered_transactions_import_batch_idx
  ON registered_transactions(import_batch_id);
