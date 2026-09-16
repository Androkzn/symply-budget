-- Symply Budget — optional "amount already paid" on `budget_loans` (0148).
-- Purely informational, entered alongside the (always-required) `start_date` —
-- NOT used to derive it or feed the amortization summary in
-- `services/budget/loan-amortization.ts`. NULL = "not set", same convention
-- as lender/notes/portal_url.
ALTER TABLE budget_loans ADD COLUMN amount_paid_cents INTEGER;
