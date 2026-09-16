-- Per-request AI token + cost telemetry. One row per Claude/Gemini call,
-- written centrally by the AI providers and by createTrackedAnthropic() so
-- every AI-backed feature is captured. Token counts come from the model APIs
-- (response.usage / usageMetadata); cost_micro_usd is derived (1_000_000 = $1).
-- Telemetry table: no FKs, household_id/user_id nullable (worker/cron calls).
CREATE TABLE IF NOT EXISTS ai_usage_events (
  id TEXT PRIMARY KEY,
  household_id TEXT,
  user_id TEXT,
  feature TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micro_usd INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'ok',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ai_usage_events_household_idx ON ai_usage_events(household_id, created_at);
CREATE INDEX IF NOT EXISTS ai_usage_events_feature_idx ON ai_usage_events(feature, created_at);
CREATE INDEX IF NOT EXISTS ai_usage_events_created_at_idx ON ai_usage_events(created_at);
