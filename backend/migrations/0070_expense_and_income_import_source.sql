-- Import provenance for historical (previous-years) AI imports.
--
-- The "Previous years" feature AI-imports a whole-year budget grid (Income /
-- Monthly payments / Food / Other per month) and materialises it as regular
-- rows in the tables the net/trend math already reads:
--   • income  → savings_income_entries
--   • spending (Food / Other / Monthly payments, per month) → expenses
-- `net` is derived (income − payments − spendings) and never stored.
--
-- These columns let us (a) distinguish imported rows from manual ones,
-- (b) replace a prior import of the same year instead of stacking, and
-- (c) undo an import by batch id. `source` mirrors the existing
-- savings_recurring_payments.source convention ('manual' | 'ai_import');
-- historical imports use 'history_import'.

ALTER TABLE expenses ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE expenses ADD COLUMN import_batch_id TEXT;
CREATE INDEX IF NOT EXISTS expenses_import_batch_idx ON expenses (import_batch_id);

ALTER TABLE savings_income_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE savings_income_entries ADD COLUMN import_batch_id TEXT;
CREATE INDEX IF NOT EXISTS savings_income_import_batch_idx ON savings_income_entries (import_batch_id);
