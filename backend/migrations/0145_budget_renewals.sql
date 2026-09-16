-- Renewal reminders for Monthly Payments (Savings → Monthly). Budget-only
-- feature (routes gated by `requireBudgetApi`) that lets a household track a
-- renewal — condo/car insurance, warranties, memberships, licenses — against
-- one of its `savings_recurring_payments` rows: provider/reference, a renewal
-- date + cycle, and optional attached documents. Actual nagging is delivered
-- by the existing `recurring_reminders` engine (migration 0137) via the
-- `budget_renewal_reminder` type registered in
-- `backend/src/services/recurring-reminders/registry.ts` — this table only
-- holds the renewal's own facts (date, cycle, status) and its attachments.
--
-- One row per recurring payment (`recurring_payment_id` UNIQUE) — renewing
-- rolls `next_renewal_date` forward in place rather than inserting a new row
-- per cycle, matching the "roll forward, never stack" behaviour the
-- recurring-reminders engine already uses for mortgage statements.
CREATE TABLE budget_renewals (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  recurring_payment_id TEXT NOT NULL UNIQUE REFERENCES savings_recurring_payments(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('insurance','warranty','subscription','membership','license','other')),
  provider TEXT,
  reference_number TEXT,
  cycle TEXT NOT NULL DEFAULT 'annual'
    CHECK (cycle IN ('monthly','quarterly','semi_annual','annual','custom')),
  cycle_months INTEGER,
  next_renewal_date TEXT NOT NULL,
  renewal_amount_cents INTEGER,
  auto_renew INTEGER NOT NULL DEFAULT 0,
  -- Start nagging this many days before `next_renewal_date`.
  reminder_lead_days INTEGER NOT NULL DEFAULT 14,
  status TEXT NOT NULL DEFAULT 'upcoming'
    CHECK (status IN ('upcoming','renewed','lapsed','cancelled')),
  notes TEXT,
  last_renewed_at TEXT,
  renewal_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX budget_renewals_household_idx ON budget_renewals(household_id);
CREATE INDEX budget_renewals_due_idx ON budget_renewals(household_id, next_renewal_date);

-- Attachments (policy documents, renewal notices, photos) — N per renewal.
-- `household_id` is denormalized from the parent renewal so an ownership check
-- never needs a join, same reasoning as other attachment tables.
CREATE TABLE budget_renewal_documents (
  id TEXT PRIMARY KEY,
  renewal_id TEXT NOT NULL REFERENCES budget_renewals(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('camera','gallery','file','drive','manual')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX budget_renewal_documents_renewal_idx ON budget_renewal_documents(renewal_id);
