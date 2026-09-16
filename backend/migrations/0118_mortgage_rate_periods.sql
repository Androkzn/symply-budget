-- Per-statement interest-rate history (Phase 6). A variable / HELOC statement
-- lists its interest in dated sub-periods ("Oct 01 - Oct 29 … 3.840", then
-- "Oct 30 - Oct 31 … 3.590"), so the rate a borrower actually pays changes
-- MID-statement, many times across a term. Until now that breakdown was only
-- stashed in mortgage_statements.raw_extraction_json — a text blob that can't be
-- queried, indexed or aggregated. This promotes it to a first-class row so the
-- change history, the rate step-line and the rate-vs-interest impact charts all
-- read one canonical, dated series. Columns match schema-mortgage.ts EXACTLY.
--
-- Rates are basis points (359 = 3.59%); variance_bps is SIGNED (-86 = prime − 0.86).

CREATE TABLE IF NOT EXISTS mortgage_rate_periods (
  id TEXT PRIMARY KEY,
  mortgage_id TEXT NOT NULL REFERENCES mortgages(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  -- The statement this sub-period was read off. CASCADE so deleting/replacing a
  -- statement can never strand its rate rows.
  statement_id TEXT REFERENCES mortgage_statements(id) ON DELETE CASCADE,
  effective_date TEXT NOT NULL,                   -- FIRST day the rate applied
  period_end TEXT,                                -- last day, when the statement gave one
  rate_bps INTEGER NOT NULL,                      -- annual variable/fixed rate
  prime_rate_bps INTEGER,
  variance_bps INTEGER,                           -- signed
  source TEXT NOT NULL DEFAULT 'statement',       -- statement|manual
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS mortgage_rate_periods_mortgage_date_idx
  ON mortgage_rate_periods(mortgage_id, effective_date);

-- One row per (statement, effective date): re-committing a statement replaces
-- its sub-periods rather than duplicating them.
CREATE UNIQUE INDEX IF NOT EXISTS mortgage_rate_periods_statement_date_idx
  ON mortgage_rate_periods(statement_id, effective_date);

-- ---- Backfill from the statements already captured ----
-- 1) Statements that stored the full sub-period breakdown in raw_extraction_json.
--    json_each explodes `{"ratePeriods":[…]}` into one row per sub-period, so the
--    exact mid-month effective dates (Oct 30) survive the migration.
INSERT OR IGNORE INTO mortgage_rate_periods
  (id, mortgage_id, household_id, statement_id, effective_date, rate_bps,
   prime_rate_bps, variance_bps, source, created_at)
SELECT
  lower(hex(randomblob(16))),
  s.mortgage_id,
  s.household_id,
  s.id,
  json_extract(p.value, '$.effectiveDate'),
  json_extract(p.value, '$.rateBps'),
  json_extract(p.value, '$.primeRateBps'),
  json_extract(p.value, '$.varianceBps'),
  'statement',
  datetime('now')
FROM mortgage_statements s,
     json_each(json_extract(s.raw_extraction_json, '$.ratePeriods')) p
WHERE s.raw_extraction_json IS NOT NULL
  AND json_valid(s.raw_extraction_json)
  AND json_type(s.raw_extraction_json, '$.ratePeriods') = 'array'
  AND json_extract(p.value, '$.effectiveDate') IS NOT NULL
  AND COALESCE(json_extract(p.value, '$.rateBps'), 0) > 0;

-- 2) Statements with only a single headline rate (manual entry, or an extraction
--    that carried no breakdown table) — dated at the statement date.
INSERT OR IGNORE INTO mortgage_rate_periods
  (id, mortgage_id, household_id, statement_id, effective_date, rate_bps,
   prime_rate_bps, variance_bps, source, created_at)
SELECT
  lower(hex(randomblob(16))),
  s.mortgage_id,
  s.household_id,
  s.id,
  s.statement_date,
  s.interest_rate_bps,
  s.prime_rate_bps,
  s.variance_bps,
  'statement',
  datetime('now')
FROM mortgage_statements s
WHERE COALESCE(s.interest_rate_bps, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM mortgage_rate_periods r WHERE r.statement_id = s.id
  );
