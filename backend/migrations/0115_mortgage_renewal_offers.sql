-- Mortgage renewal offers (Phase 5). Bank-shopping data compared during the
-- renewal window; accepting one feeds the renewal (new term). Columns match
-- schema-mortgage.ts EXACTLY.
-- See documents/requirements/as-built/mortgage/Mortgage_Implementation_Plan.md §8.

CREATE TABLE IF NOT EXISTS mortgage_renewal_offers (
  id TEXT PRIMARY KEY,
  mortgage_id TEXT NOT NULL REFERENCES mortgages(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  bank_name TEXT NOT NULL,
  offered_rate_bps INTEGER NOT NULL,
  rate_type TEXT NOT NULL,
  term_months INTEGER NOT NULL,
  monthly_payment_cents INTEGER,
  offer_expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft',   -- draft|shortlisted|accepted|declined
  source TEXT NOT NULL DEFAULT 'manual',  -- manual|ai
  note TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS mortgage_renewal_offers_mortgage_status_idx
  ON mortgage_renewal_offers(mortgage_id, status);
