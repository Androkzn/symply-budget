-- Mortgage tracking (Canadian) — Budget-only feature. Phase 1: loan identity +
-- terms. Statements/events/offers land in later migrations (0113+). All amounts
-- are integer cents; rates are basis points (500 = 5.00%). Columns match
-- backend/src/db/schema-mortgage.ts EXACTLY. Hand-written (db:generate bypassed),
-- mirroring the budget & savings domains.
-- See documents/requirements/as-built/mortgage/Mortgage_Implementation_Plan.md §5.

CREATE TABLE IF NOT EXISTS mortgages (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  lender TEXT,
  -- 'standard' | 'heloc_flexline' | 'step' (combined/readvanceable products)
  product_type TEXT NOT NULL DEFAULT 'standard',
  property_address TEXT,           -- PII, masked on display
  mortgage_number_last4 TEXT,      -- only ever the last 4 (never full)
  original_price_cents INTEGER,
  down_payment_cents INTEGER,
  original_principal_cents INTEGER NOT NULL,  -- price − down + financed premium, or direct
  original_amortization_months INTEGER NOT NULL DEFAULT 300,
  start_date TEXT NOT NULL,
  current_home_value_cents INTEGER,           -- for the appreciation slice
  insurance_premium_cents INTEGER,            -- financed CMHC/Sagen/CG premium
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS mortgages_household_idx ON mortgages(household_id);

CREATE TABLE IF NOT EXISTS mortgage_terms (
  id TEXT PRIMARY KEY,
  mortgage_id TEXT NOT NULL REFERENCES mortgages(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,                  -- 1-based; renewal = sequence + 1
  rate_type TEXT NOT NULL CHECK (rate_type IN ('fixed','variable_arm','variable_vrm')),
  compounding TEXT NOT NULL CHECK (compounding IN ('semi_annual','monthly')),
  nominal_rate_bps INTEGER NOT NULL,          -- 500 = 5.00%
  prime_rate_bps INTEGER,                     -- variable: prime snapshot
  spread_bps INTEGER,                         -- variable: signed variance (−90 = prime − 0.90)
  term_months INTEGER NOT NULL,
  term_start_date TEXT NOT NULL,
  maturity_date TEXT NOT NULL,                -- drives the renewal reminder
  payment_frequency TEXT NOT NULL CHECK (payment_frequency IN
    ('monthly','semi_monthly','biweekly','weekly','accel_biweekly','accel_weekly')),
  amortization_months_at_start INTEGER NOT NULL,  -- remaining amort when this term began
  scheduled_payment_cents INTEGER,            -- engine-computed if null
  property_tax_portion_cents INTEGER,
  insurance_portion_cents INTEGER,
  is_current INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS mortgage_terms_mortgage_seq_idx
  ON mortgage_terms(mortgage_id, sequence);
