-- AI consumption telemetry: accuracy, retention, and reconciliation.
--
-- The `ai_usage_events` table was structurally fine but its numbers were not.
-- Three classes of defect, all addressed here plus in the provider adapters:
--
--   1. Claude wrote `provider = 'claude'` while every reader filtered on
--      'anthropic', so the entire Anthropic slice of the report read as zero.
--      Backfilled below.
--   2. Token buckets overlapped. OpenAI's `prompt_tokens` includes its cached
--      prefix and Gemini's `promptTokenCount` includes cached content, so
--      cached tokens were billed twice; Gemini's `thoughtsTokenCount` (billed
--      as output, reported outside `candidatesTokenCount`) was dropped
--      entirely. New columns give thinking and TTL-split cache writes a home.
--   3. Cache writes were flat-rated at 1.25x input, but the 1-hour TTL bills
--      at 2x — and we do use it.
--
-- `migrations_dir` is SHARED across the fleet, so this lands on House, Budget,
-- Kaizen and Health D1s. Apply to staging AND production for every brand.

-- ---------------------------------------------------------------------------
-- 1. New columns on the per-request ledger.
-- ---------------------------------------------------------------------------
-- D1/SQLite has no "ADD COLUMN IF NOT EXISTS"; these run once, in order.

-- Thinking / reasoning tokens. Billed at the OUTPUT rate by all three vendors.
ALTER TABLE ai_usage_events ADD COLUMN reasoning_tokens INTEGER NOT NULL DEFAULT 0;

-- Cache writes split by TTL: 5m bills at 1.25x input, 1h at 2x.
-- `cache_write_tokens` is retained as the combined figure so that rows written
-- before this migration remain comparable with rows written after it.
ALTER TABLE ai_usage_events ADD COLUMN cache_write_5m_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_usage_events ADD COLUMN cache_write_1h_tokens INTEGER NOT NULL DEFAULT 0;

-- Which rate table produced `cost_micro_usd`. Without this a vendor price cut
-- is indistinguishable from a drop in usage.
ALTER TABLE ai_usage_events ADD COLUMN pricing_version TEXT;

-- 'exact' | 'pattern' | 'fallback'. 'fallback' means we did not recognise the
-- model and billed the provider's most expensive known rate, so the report can
-- qualify a total that rests on guesses instead of presenting it as fact.
ALTER TABLE ai_usage_events ADD COLUMN pricing_source TEXT;

-- Coarse failure class ('http_429', 'http_500', …). Never the provider's
-- message body — those quote submitted credentials back at us.
ALTER TABLE ai_usage_events ADD COLUMN error_kind TEXT;

-- Historical rows predate the TTL split: attribute their cache writes to the
-- 5-minute default, which is what the API uses when no TTL is requested.
UPDATE ai_usage_events
SET cache_write_5m_tokens = cache_write_tokens
WHERE cache_write_tokens > 0 AND cache_write_5m_tokens = 0;

-- ---------------------------------------------------------------------------
-- 2. Provider label backfill: 'claude' -> 'anthropic'.
-- ---------------------------------------------------------------------------
-- Every historical Anthropic row is invisible to `?provider=anthropic` until
-- this runs. The adapter now emits the AIProviderId union directly, and the
-- type system prevents the divergence recurring.
UPDATE ai_usage_events SET provider = 'anthropic' WHERE provider = 'claude';

-- Provider-scoped reads (the per-provider detail screen) had no supporting
-- index and fell back to the created_at scan.
CREATE INDEX IF NOT EXISTS ai_usage_events_provider_idx
  ON ai_usage_events(provider, created_at);

-- ---------------------------------------------------------------------------
-- 3. Daily rollup, so raw rows can age out.
-- ---------------------------------------------------------------------------
-- `ai_usage_events` grows one row per AI call and nothing ever deleted them.
-- The nightly rollup collapses a finished day into these buckets; the sweeper
-- then drops raw rows past the retention window without losing the history the
-- charts read.
--
-- `household_id` uses '' (not NULL) for background/cron rows: SQLite treats
-- NULLs as distinct in a UNIQUE index, which would let the same bucket be
-- inserted repeatedly and break the upsert.
CREATE TABLE IF NOT EXISTS ai_usage_daily (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  household_id TEXT,
  feature TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  error_requests INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micro_usd INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_daily_bucket_idx
  ON ai_usage_daily(day, household_id, feature, provider, model);
CREATE INDEX IF NOT EXISTS ai_usage_daily_day_idx ON ai_usage_daily(day);
CREATE INDEX IF NOT EXISTS ai_usage_daily_household_idx ON ai_usage_daily(household_id, day);

-- ---------------------------------------------------------------------------
-- 4. Cost reconciliation — estimate vs invoice.
-- ---------------------------------------------------------------------------
-- Everything we compute is an ESTIMATE: token counts are real, but the rates
-- are a table we maintain by hand, and a normal inference key cannot read the
-- provider's bill. The nightly reconciler pulls org-level spend from
-- Anthropic `/v1/organizations/cost_report` and OpenAI `/v1/organization/costs`
-- (both require an ADMIN key) and records the delta, so a stale rate shows up
-- as a widening gap instead of a number nobody can check.
--
-- Gemini has no equivalent API — Cloud Billing export only — so Gemini days are
-- never written here and the report reports that rather than implying $0 drift.
CREATE TABLE IF NOT EXISTS ai_cost_reconciliation (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  billed_micro_usd INTEGER NOT NULL DEFAULT 0,
  estimated_micro_usd INTEGER NOT NULL DEFAULT 0,
  delta_micro_usd INTEGER NOT NULL DEFAULT 0,
  pricing_version TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_cost_reconciliation_bucket_idx
  ON ai_cost_reconciliation(day, provider, model);
CREATE INDEX IF NOT EXISTS ai_cost_reconciliation_day_idx ON ai_cost_reconciliation(day);
