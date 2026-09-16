import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

// ============ AI USAGE / COST TELEMETRY ============

// One row per AI request (OpenAI, Anthropic or Gemini). Populated centrally by
// the AI providers via the `onUsage` hook (createProviderAdapter /
// provider-factory) so every AI-backed feature is captured without each call
// site remembering to log. Token counts come straight from the model APIs
// (`response.usage` for Claude, `usage` for OpenAI, `usageMetadata` for Gemini)
// — never estimated. `cost_micro_usd` is the derived cost in millionths of a
// USD (1_000_000 = $1) so we can sum without float drift. See
// ai/model-pricing.ts for the rate table and services/ai-usage-service.ts for
// the cost formula.
//
// The token columns are MUTUALLY EXCLUSIVE: each counts tokens no other column
// counts. The vendors' own payloads are not (OpenAI's `prompt_tokens` includes
// its cached prefix; Gemini's `promptTokenCount` includes cached content), so
// the provider adapters normalise before emitting. Summing overlapping columns
// is how the same token gets billed twice.
//
// This is a telemetry table: no FKs (rows outlive the household/user they
// reference, and worker-level calls have neither), writes must never break the
// AI call, and `household_id` / `user_id` are nullable for background work
// (scheduled digests, cron workers) that isn't scoped to one household.
export const aiUsageEvents = sqliteTable(
  'ai_usage_events',
  {
    id: text('id').primaryKey(),
    // Null for background/worker calls not scoped to a single household. These
    // are reachable via `?scope=background` on the report — before that existed
    // they were written and never displayed anywhere.
    household_id: text('household_id'),
    user_id: text('user_id'),
    // Logical feature that triggered the call, e.g. 'aihousekeeper_chat',
    // 'maintenance_suggest', 'utility_bill_extract'. Drives the per-feature
    // cost breakdown.
    feature: text('feature').notNull(),
    // 'openai' | 'anthropic' | 'gemini' — the AIProviderId union, NOT the
    // provider class name. Claude used to write 'claude' here while every
    // reader filtered on 'anthropic', so the whole Anthropic slice read as zero.
    provider: text('provider').notNull(),
    // The model the vendor reports having SERVED, which can differ from the
    // alias we requested (`gemini-3-flash-preview` resolving to a dated build).
    model: text('model').notNull(),
    // Uncached input only.
    input_tokens: integer('input_tokens').notNull().default(0),
    // Visible output, excluding reasoning_tokens.
    output_tokens: integer('output_tokens').notNull().default(0),
    // Thinking / reasoning tokens. Billed at the OUTPUT rate by all three
    // vendors. Gemini reports these outside `candidatesTokenCount` and every
    // Gemini model in our catalog thinks by default, so this is often the
    // single largest line that used to be missing entirely.
    reasoning_tokens: integer('reasoning_tokens').notNull().default(0),
    // Prompt-cache reads, billed at ~0.1x the input rate.
    cache_read_tokens: integer('cache_read_tokens').notNull().default(0),
    // Cache writes, split by TTL because they bill differently: the 5-minute
    // default is 1.25x input, the 1-hour TTL is 2x.
    cache_write_5m_tokens: integer('cache_write_5m_tokens').notNull().default(0),
    cache_write_1h_tokens: integer('cache_write_1h_tokens').notNull().default(0),
    // Combined cache writes. Predates the TTL split and is kept populated so a
    // series spanning the migration stays comparable.
    cache_write_tokens: integer('cache_write_tokens').notNull().default(0),
    total_tokens: integer('total_tokens').notNull().default(0),
    // Derived cost in millionths of a USD (1_000_000 = $1).
    cost_micro_usd: integer('cost_micro_usd').notNull().default(0),
    // `PRICING_VERSION` at write time. Without it a vendor price cut is
    // indistinguishable from a drop in usage.
    pricing_version: text('pricing_version'),
    // 'exact' | 'pattern' | 'fallback' — how the model was matched to a rate.
    // 'fallback' means we billed the provider's most expensive known model
    // because we did not recognise this one; the report surfaces the count so a
    // total resting on guesses is visibly qualified.
    pricing_source: text('pricing_source'),
    latency_ms: integer('latency_ms'),
    status: text('status').notNull().default('ok'), // 'ok' | 'error'
    // Coarse failure class ('http_429', 'http_500', …) — never the provider's
    // message body, which can quote the submitted credential back at us.
    error_kind: text('error_kind'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_idx: index('ai_usage_events_household_idx').on(
      table.household_id,
      table.created_at
    ),
    feature_idx: index('ai_usage_events_feature_idx').on(table.feature, table.created_at),
    created_at_idx: index('ai_usage_events_created_at_idx').on(table.created_at),
    provider_idx: index('ai_usage_events_provider_idx').on(table.provider, table.created_at),
  })
);

export type AiUsageEventRow = typeof aiUsageEvents.$inferSelect;
export type NewAiUsageEventRow = typeof aiUsageEvents.$inferInsert;

// ---------------------------------------------------------------------------
// DAILY ROLLUP
// ---------------------------------------------------------------------------

// Per-day / household / provider / model / feature aggregate of the raw events.
// `ai_usage_events` grows one row per AI call forever; the nightly rollup lets
// the sweeper delete raw rows past the retention window without losing the
// history the charts read. Reports serve recent windows from raw rows (so
// today's spend is live) and older windows from here.
export const aiUsageDaily = sqliteTable(
  'ai_usage_daily',
  {
    id: text('id').primaryKey(),
    // 'YYYY-MM-DD', UTC — matches `date(created_at)` on the raw table.
    day: text('day').notNull(),
    household_id: text('household_id'),
    feature: text('feature').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    requests: integer('requests').notNull().default(0),
    error_requests: integer('error_requests').notNull().default(0),
    input_tokens: integer('input_tokens').notNull().default(0),
    output_tokens: integer('output_tokens').notNull().default(0),
    reasoning_tokens: integer('reasoning_tokens').notNull().default(0),
    cache_read_tokens: integer('cache_read_tokens').notNull().default(0),
    cache_write_tokens: integer('cache_write_tokens').notNull().default(0),
    total_tokens: integer('total_tokens').notNull().default(0),
    cost_micro_usd: integer('cost_micro_usd').notNull().default(0),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    // Idempotent rollup: re-running a day upserts instead of duplicating.
    // `household_id` is nullable and SQLite treats NULLs as distinct in a
    // UNIQUE index, so the rollup writes the sentinel '' for background rows.
    bucket_idx: uniqueIndex('ai_usage_daily_bucket_idx').on(
      table.day,
      table.household_id,
      table.feature,
      table.provider,
      table.model
    ),
    day_idx: index('ai_usage_daily_day_idx').on(table.day),
    household_idx: index('ai_usage_daily_household_idx').on(table.household_id, table.day),
  })
);

export type AiUsageDailyRow = typeof aiUsageDaily.$inferSelect;

// ---------------------------------------------------------------------------
// COST RECONCILIATION
// ---------------------------------------------------------------------------

// What the provider actually billed, per day and model, pulled from their
// org-level cost APIs (Anthropic `/v1/organizations/cost_report`, OpenAI
// `/v1/organization/costs`). Those endpoints need an ADMIN key and are
// org-scoped — they cannot attribute spend to a household, which is why they
// supplement our per-call ledger rather than replacing it.
//
// The point is drift detection: `estimated_micro_usd` is what our price table
// said, `billed_micro_usd` is what the invoice said. A widening delta means a
// rate in ai/model-pricing.ts is stale, which is otherwise invisible.
//
// Gemini has no equivalent API (Cloud Billing export only), so Gemini days are
// never populated here and the report says so rather than implying $0 drift.
export const aiCostReconciliation = sqliteTable(
  'ai_cost_reconciliation',
  {
    id: text('id').primaryKey(),
    /** 'YYYY-MM-DD', UTC — the provider's own bucket day. */
    day: text('day').notNull(),
    provider: text('provider').notNull(),
    /** Provider's model id, or '' for a provider-level total they did not break down. */
    model: text('model').notNull().default(''),
    /** What the provider billed, in micro-USD. */
    billed_micro_usd: integer('billed_micro_usd').notNull().default(0),
    /** What our own ledger estimated for the same day+provider+model. */
    estimated_micro_usd: integer('estimated_micro_usd').notNull().default(0),
    /** billed - estimated. Positive = we are under-estimating spend. */
    delta_micro_usd: integer('delta_micro_usd').notNull().default(0),
    /** `PRICING_VERSION` the estimate was computed under. */
    pricing_version: text('pricing_version'),
    fetched_at: text('fetched_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    bucket_idx: uniqueIndex('ai_cost_reconciliation_bucket_idx').on(
      table.day,
      table.provider,
      table.model
    ),
    day_idx: index('ai_cost_reconciliation_day_idx').on(table.day),
  })
);

export type AiCostReconciliationRow = typeof aiCostReconciliation.$inferSelect;
