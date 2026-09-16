-- Pension "simple flow" (no accounts): let a household member's room-only pension line
-- (migration 0081) also carry a goal (amount OR %), an automated recurring monthly
-- contribution, and an automatic employer match — all without creating a full account.
--
-- Recurring contributions are materialized as kind='regular' registered_transactions,
-- one per month. To let a member's OWN recurring contribution and the EMPLOYER match
-- coexist in the same month, the per-period idempotency key must include the contributor
-- (the old (account_id, period) unique index would collide self vs employer).
ALTER TABLE registered_accounts ADD COLUMN annual_goal_pct INTEGER;
ALTER TABLE registered_accounts ADD COLUMN employer_match_cents INTEGER;
ALTER TABLE registered_accounts ADD COLUMN recurring_start_month TEXT;

DROP INDEX IF EXISTS registered_tx_regular_period_idx;
CREATE UNIQUE INDEX IF NOT EXISTS registered_tx_regular_period_idx
  ON registered_transactions(account_id, period, contributor) WHERE period IS NOT NULL;
