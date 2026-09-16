-- Planning horizons for budget items (intent-based, replaces the granular
-- 8-value `timeframe`). `horizon` is the new source of truth:
--   short_term — buying soon (target_date within ~12 months) → monthly fit
--   long_term  — 1+ year out (rough year)                    → long projection
--   someday    — wish/dream: no date, cost is an optional ballpark, EXCLUDED
--                from committed/affordability/fit math
--
-- Backfill from existing data: dated items split at the 12-month boundary;
-- undated items become `someday` (they were "when possible"/anytime — i.e. not
-- actually committed — and their optional cost carries over as the ballpark).

ALTER TABLE budget_items ADD COLUMN horizon TEXT NOT NULL DEFAULT 'short_term';

CREATE INDEX IF NOT EXISTS budget_items_horizon_idx ON budget_items (horizon);

-- Undated → someday (dream / wishlist)
UPDATE budget_items
SET horizon = 'someday'
WHERE target_date IS NULL;

-- Dated beyond 12 months → long_term
UPDATE budget_items
SET horizon = 'long_term'
WHERE target_date IS NOT NULL
  AND date(target_date) > date('now', '+12 months');

-- Dated within 12 months → short_term (explicit; also the column default)
UPDATE budget_items
SET horizon = 'short_term'
WHERE target_date IS NOT NULL
  AND date(target_date) <= date('now', '+12 months');
