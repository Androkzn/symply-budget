-- Symply Budget — monthly income rollover (0149).
-- Draft/confirm lifecycle on savings_income_entries: rollover-generated rows
-- start 'draft' until the member confirms (or edits+saves, which implicitly
-- confirms — see SavingsService.updateIncome). Every other creation path
-- (manual, ai_import, history_import) defaults straight to 'confirmed'.
ALTER TABLE savings_income_entries ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed';
ALTER TABLE savings_income_entries ADD COLUMN rolled_over_from_entry_id TEXT;

CREATE INDEX IF NOT EXISTS savings_income_status_idx ON savings_income_entries(household_id, status);

-- A given prior-month entry can only ever be rolled forward once — the
-- generator's insert relies on this via onConflictDoNothing() for idempotency
-- (mirrors the (template_id, period) partial unique index above).
CREATE UNIQUE INDEX IF NOT EXISTS savings_income_rollover_source_unique_idx
  ON savings_income_entries(rolled_over_from_entry_id) WHERE rolled_over_from_entry_id IS NOT NULL;
