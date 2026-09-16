-- Loan tracking for Monthly Payments (Savings → Monthly). Budget-only feature
-- (routes gated by `requireBudgetApi`) that lets a household attach loan
-- facts to one of its `savings_recurring_payments` rows — car loans, buy-
-- now-pay-later plans (IKEA-style), personal loans: a principal, an optional
-- interest rate (0% or fixed), and a term in months. Unlike a plain bill or
-- subscription, a loan payment has a finite end and an interest cost the
-- household wants visibility into (payments remaining, interest paid so far,
-- total interest over the life of the loan).
--
-- `loan_kind` reserves the enum value 'revolving' for a follow-up (credit
-- lines / credit cards — no fixed term, minimum payment is a function of the
-- outstanding balance, needs its own payoff-projection math) so that feature
-- doesn't need a second CHECK-constraint migration; only 'installment' is
-- populated today. All loan math is computed on read from these facts plus
-- the recurring payment's own `amount_cents` (the actual payment) — nothing
-- here is a derived/cached number — reusing the mortgage amortization engine
-- (`services/mortgage/amortization.ts`) at monthly compounding via
-- `services/budget/loan-amortization.ts`.
--
-- One row per recurring payment (`recurring_payment_id` UNIQUE), same
-- 1:1-sibling-table shape as `budget_renewals` (migration 0145).
CREATE TABLE budget_loans (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  recurring_payment_id TEXT NOT NULL UNIQUE REFERENCES savings_recurring_payments(id) ON DELETE CASCADE,
  loan_kind TEXT NOT NULL DEFAULT 'installment'
    CHECK (loan_kind IN ('installment','revolving')),
  rate_type TEXT NOT NULL DEFAULT 'fixed'
    CHECK (rate_type IN ('zero','fixed')),
  -- Nominal annual rate in basis points (599 = 5.99%). Always 0 when rate_type = 'zero'.
  rate_bps INTEGER NOT NULL DEFAULT 0,
  principal_cents INTEGER NOT NULL,
  term_months INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  lender TEXT,
  notes TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX budget_loans_household_idx ON budget_loans(household_id);
