/**
 * AI usage / cost reporting — mounted at
 * `/households/:householdId/ai-usage` in backend/src/index.ts.
 *
 * Reads the `ai_usage_events` telemetry table (one row per AI call, written
 * centrally by the provider adapters via `onUsage`) and returns per-feature /
 * per-model / per-provider / per-day breakdowns for the household. All dollar
 * amounts are computed server-side (thin-frontend rule) from the stored
 * `cost_micro_usd` (1_000_000 = $1); the client just renders them.
 *
 * ## Every dollar here is an ESTIMATE
 *
 * Token counts are exact — they come from the provider's own response. The
 * RATES are a table we maintain by hand (`ai/model-pricing.ts`), because a
 * normal inference key cannot read the provider's bill and under BYOK the bill
 * is not ours at all. The response carries `estimate` metadata so the client
 * can say so honestly: which pricing version produced the numbers, and how many
 * requests used a model we did not recognise.
 *
 * ## Where the rows come from
 *
 * Recent days are served from raw per-request rows so today's spend is live.
 * Days older than `RAW_WINDOW_DAYS` are served from the nightly `ai_usage_daily`
 * rollup, which is what lets the retention sweeper delete raw rows without
 * losing history. The two ranges are disjoint by construction, so nothing is
 * counted twice.
 *
 * ## The period is N whole UTC days, and `byDay` covers every one of them
 *
 * `days=N` means the last N calendar days INCLUDING today, so both halves of
 * the union start at a day boundary and `byDay` sums to `totals`. `byDay` is a
 * dense series — a day nobody used AI is returned as a zero bucket, not
 * omitted. Skipping empty days makes a bar chart lie: four scattered bars
 * render as four adjacent columns and a fortnight of silence disappears.
 *
 * GET /?days=30            → summary over the last N days (1–365, default 30)
 * GET /?days=30&provider=  → same, scoped to one provider
 */
import { Hono } from 'hono';

import { PRICING_VERSION } from '../ai/model-pricing';
import { authMiddleware } from '../middleware/auth';
import type { Env } from '../types';

const aiUsage = new Hono<{ Bindings: Env }>();

aiUsage.use('/*', authMiddleware());

/**
 * How far back the raw per-request table is queried. Beyond this the rollup
 * answers. Must stay <= the retention window the sweeper enforces, or the gap
 * between them silently reads as zero spend.
 */
const RAW_WINDOW_DAYS = 90;
const MAX_DAYS = 365;

interface AggRow {
  requests: number;
  error_requests: number;
  unpriced_requests: number;
  tokens: number;
  cost: number;
  feature?: string;
  model?: string;
  provider?: string;
  date?: string;
}

// micro-USD → USD, rounded to 4 dp (hundredths of a cent).
export function toUsd(microUsd: number): number {
  return Math.round((Number(microUsd || 0) / 1_000_000) * 10000) / 10000;
}

export interface DayBucket {
  date: string;
  requests: number;
  tokens: number;
  costUsd: number;
}

/** `YYYY-MM-DD` + 1 day, in UTC — the calendar SQLite's `date('now')` uses. */
function nextDay(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/**
 * Expand the sparse `GROUP BY day` result into one bucket per calendar day in
 * `[start, end]`. Days with no rows come back as zeros so the client can plot a
 * real time axis instead of squashing 22 July next to 16 August.
 *
 * Any row outside the bounds is still emitted (sorted into place) rather than
 * dropped — a bucket that exists in `totals` but not in `byDay` would read as a
 * reporting bug, and clamping is not this function's job.
 */
export function fillDailySeries(
  rows: DayBucket[],
  start: string,
  end: string,
  maxDays = MAX_DAYS + 1
): DayBucket[] {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const dates = new Set(byDate.keys());
  // Bad/missing bounds → return what the query found rather than iterating an
  // unparseable date forever. `nextDay` on a non-date throws.
  const dated = /^\d{4}-\d{2}-\d{2}$/;
  if (dated.test(start) && dated.test(end)) {
    for (let day = start, i = 0; day <= end && i < maxDays; day = nextDay(day), i++) {
      dates.add(day);
    }
  }
  return [...dates]
    .sort((a, b) => a.localeCompare(b))
    .map((date) => byDate.get(date) ?? { date, requests: 0, tokens: 0, costUsd: 0 });
}

/**
 * Union of raw events (recent) and the daily rollup (older), normalised to one
 * column set. The rollup stores '' for background rows because SQLite treats
 * NULLs as distinct in a UNIQUE index; `NULLIF` maps it back so the household
 * predicate behaves identically across both halves.
 */
const SRC_CTE = `
  WITH src AS (
    SELECT
      date(created_at) AS day,
      household_id,
      feature,
      provider,
      model,
      1 AS requests,
      CASE WHEN status = 'error' THEN 1 ELSE 0 END AS error_requests,
      CASE WHEN pricing_source = 'fallback' THEN 1 ELSE 0 END AS unpriced_requests,
      total_tokens,
      cost_micro_usd
    FROM ai_usage_events
    WHERE created_at >= datetime('now', 'start of day', ?)
    UNION ALL
    SELECT
      day,
      NULLIF(household_id, '') AS household_id,
      feature,
      provider,
      model,
      requests,
      error_requests,
      0 AS unpriced_requests,
      total_tokens,
      cost_micro_usd
    FROM ai_usage_daily
    WHERE day >= date('now', ?) AND day < date('now', ?)
  )
`;

const AGG_COLS = `
  SUM(requests) AS requests,
  SUM(error_requests) AS error_requests,
  SUM(unpriced_requests) AS unpriced_requests,
  COALESCE(SUM(total_tokens), 0) AS tokens,
  COALESCE(SUM(cost_micro_usd), 0) AS cost
`;

function bucket(r: AggRow | null | undefined) {
  return {
    requests: Number(r?.requests ?? 0),
    tokens: Number(r?.tokens ?? 0),
    costUsd: toUsd(r?.cost ?? 0),
  };
}

aiUsage.get('/', async (c) => {
  const householdId = c.req.param('householdId');
  const userId = c.get('userId') as string | undefined;
  if (!householdId) return c.json({ error: 'Household ID is required' }, 400);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  // Membership guard — only members can see a household's AI spend.
  const member = await c.env.DB.prepare(
    `SELECT 1 FROM household_members
     WHERE household_id = ? AND user_id = ? AND deleted_at IS NULL
     LIMIT 1`
  )
    .bind(householdId, userId)
    .first();
  if (!member) return c.json({ error: 'Forbidden' }, 403);

  const daysRaw = parseInt(c.req.query('days') ?? '30', 10);
  const days =
    Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= MAX_DAYS ? daysRaw : 30;
  const rawDays = Math.min(days, RAW_WINDOW_DAYS);

  // Whole-day offsets: `days=7` is the last 7 calendar days INCLUDING today,
  // so the raw half starts at a midnight and the rollup half picks up exactly
  // where it stops — contiguous, disjoint, and summing to the same window the
  // per-day series plots. When `days <= RAW_WINDOW_DAYS` the rollup range
  // collapses to nothing (`day >= X AND day < X`), so one SQL shape serves both.
  const srcBinds: unknown[] = [
    `-${rawDays - 1} days`,
    `-${days - 1} days`,
    `-${rawDays - 1} days`,
  ];

  // Period bounds straight from SQLite rather than JS `Date`, so "today" is the
  // same day the WHERE clauses used no matter what the runtime thinks the time
  // is.
  const bounds = await c.env.DB.prepare(`SELECT date('now', ?) AS start, date('now') AS end`)
    .bind(`-${days - 1} days`)
    .first<{ start: string; end: string }>();

  // Optional per-provider scope — the provider-detail screen passes `?provider=`
  // to get just that provider's slice (incl. its per-day series).
  const providerParam = c.req.query('provider');
  const provider =
    providerParam === 'openai' || providerParam === 'anthropic' || providerParam === 'gemini'
      ? providerParam
      : null;
  const providerClause = provider ? ' AND provider = ?' : '';

  /** Binds for a scoped query: CTE window, household, then the provider filter. */
  const scoped = (): unknown[] =>
    provider ? [...srcBinds, householdId, provider] : [...srcBinds, householdId];
  /** Binds for a query that deliberately ignores `?provider=`. */
  const unscoped = (): unknown[] => [...srcBinds, householdId];

  const run = <T>(sql: string, binds: unknown[]) =>
    c.env.DB.prepare(sql).bind(...binds).all<T>();

  const totals = await c.env.DB.prepare(
    `${SRC_CTE}
     SELECT ${AGG_COLS} FROM src WHERE household_id = ?${providerClause}`
  )
    .bind(...scoped())
    .first<AggRow>();

  const byFeature = await run<AggRow>(
    `${SRC_CTE}
     SELECT feature, ${AGG_COLS} FROM src
     WHERE household_id = ?${providerClause}
     GROUP BY feature ORDER BY cost DESC`,
    scoped()
  );

  const byModel = await run<AggRow>(
    `${SRC_CTE}
     SELECT model, provider, ${AGG_COLS} FROM src
     WHERE household_id = ?${providerClause}
     GROUP BY model, provider ORDER BY cost DESC`,
    scoped()
  );

  // Deliberately UNSCOPED by provider. The Usage tab renders this as the
  // per-provider split, which is meaningless if `?provider=` has already
  // filtered it down to the single row you asked for. (The old code applied the
  // provider filter here while its comment claimed it did not.)
  const byProvider = await run<AggRow>(
    `${SRC_CTE}
     SELECT provider, ${AGG_COLS} FROM src
     WHERE household_id = ?
     GROUP BY provider ORDER BY cost DESC`,
    unscoped()
  );

  const byDay = await run<AggRow>(
    `${SRC_CTE}
     SELECT day AS date, ${AGG_COLS} FROM src
     WHERE household_id = ?${providerClause}
     GROUP BY day ORDER BY date ASC`,
    scoped()
  );

  const unpriced = Number(totals?.unpriced_requests ?? 0);

  return c.json({
    currency: 'USD',
    range: {
      days,
      rawWindowDays: RAW_WINDOW_DAYS,
      start: bounds?.start ?? '',
      end: bounds?.end ?? '',
    },
    provider,
    totals: {
      ...bucket(totals),
      errorRequests: Number(totals?.error_requests ?? 0),
    },
    /**
     * How much to trust the dollar figures. `unpricedRequests > 0` means some
     * calls used a model absent from our rate table and were billed at the
     * provider's most expensive known rate — an upper bound, not a measurement.
     */
    estimate: {
      isEstimate: true,
      pricingVersion: PRICING_VERSION,
      unpricedRequests: unpriced,
    },
    byFeature: (byFeature.results ?? []).map((r) => ({
      feature: r.feature,
      ...bucket(r),
    })),
    byModel: (byModel.results ?? []).map((r) => ({
      model: r.model,
      provider: r.provider,
      ...bucket(r),
    })),
    byProvider: (byProvider.results ?? []).map((r) => ({
      provider: r.provider,
      ...bucket(r),
    })),
    // Dense: one bucket per calendar day in the period, zeros included.
    byDay: fillDailySeries(
      (byDay.results ?? []).map((r) => ({ date: String(r.date), ...bucket(r) })),
      bounds?.start ?? '',
      bounds?.end ?? ''
    ),
  });
});

export default aiUsage;
