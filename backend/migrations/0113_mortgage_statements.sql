-- Mortgage statements + events (Phase 2). Statements are the reconciliation
-- axis: closing_balance_cents is the HARD anchor that overrides the theoretical
-- schedule from statement_date forward. A UNIQUE (mortgage_id, statement_date)
-- dedups re-uploads / double-commits. Events feed the reconciliation engine
-- (lump sums, rate changes, renewals). Columns match schema-mortgage.ts EXACTLY.
-- See documents/requirements/as-built/mortgage/Mortgage_Implementation_Plan.md §5.

CREATE TABLE IF NOT EXISTS mortgage_statements (
  id TEXT PRIMARY KEY,
  mortgage_id TEXT NOT NULL REFERENCES mortgages(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  term_id TEXT,                                   -- logical FK → mortgage_terms.id
  statement_date TEXT NOT NULL,                   -- reconciliation anchor
  period_start TEXT,
  period_end TEXT,
  opening_balance_cents INTEGER,
  closing_balance_cents INTEGER NOT NULL,         -- HARD anchor
  interest_paid_cents INTEGER,
  interest_charged_cents INTEGER,                 -- may differ (frequency timing)
  principal_paid_cents INTEGER,
  payment_amount_cents INTEGER,
  interest_rate_bps INTEGER,
  prime_rate_bps INTEGER,
  variance_bps INTEGER,                           -- signed
  remaining_amortization_months INTEGER,
  property_tax_paid_cents INTEGER,
  source TEXT NOT NULL DEFAULT 'manual',          -- manual|camera|gallery|file|google_drive
  extraction_confidence INTEGER,                  -- 0-100; NULL for manual
  raw_extraction_json TEXT,                       -- PII-scrubbed only; never logged
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS mortgage_statements_mortgage_date_idx
  ON mortgage_statements(mortgage_id, statement_date);

-- Dedup anchor: one statement per (mortgage, date). A re-upload replaces via the
-- service's replace-vs-cancel path rather than creating a conflicting anchor.
CREATE UNIQUE INDEX IF NOT EXISTS mortgage_statements_dedup_idx
  ON mortgage_statements(mortgage_id, statement_date);

CREATE TABLE IF NOT EXISTS mortgage_events (
  id TEXT PRIMARY KEY,
  mortgage_id TEXT NOT NULL REFERENCES mortgages(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN
    ('lump_sum_prepayment','payment_increase','rate_change','renewal','amortization_change')),
  event_date TEXT NOT NULL,
  amount_cents INTEGER,
  new_rate_bps INTEGER,
  new_payment_cents INTEGER,
  policy TEXT,                                    -- keep_payment_shorten | keep_amort_lower_payment
  note TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS mortgage_events_mortgage_date_idx
  ON mortgage_events(mortgage_id, event_date);

-- Balance at the start of a term (renewal re-amortization basis, §4.6). NULL on
-- term 1 ⇒ the mortgage's original_principal_cents is used.
ALTER TABLE mortgage_terms ADD COLUMN starting_balance_cents INTEGER;
