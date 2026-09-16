/**
 * Nightly drift check: what we ESTIMATED vs what the provider BILLED.
 *
 * Our per-request ledger multiplies exact token counts by a rate table we
 * maintain by hand (`ai/model-pricing.ts`). Token counts don't drift; rates do —
 * vendors cut prices, add tiers, and ship models we haven't catalogued. Without
 * a check, a stale rate is silently wrong forever and nobody can tell the
 * difference between "we spent less" and "we're computing it wrong".
 *
 * So each night we pull the provider's own org-level cost report and store the
 * delta per day/model. A widening `delta_micro_usd` means a rate needs updating.
 *
 * ## What this can and cannot do
 *
 * These APIs are ORG-SCOPED and need an ADMIN key, which is a different
 * credential from the inference key. They cannot attribute spend to a
 * household, so they supplement the per-call ledger rather than replacing it —
 * per-household reporting has to come from our own rows.
 *
 * They also only cover keys WE hold. BYOK spend lands on the member's own
 * account and is invisible here, so a household running on BYOK will show
 * estimate-only figures with no billed counterpart. That is expected, not a bug.
 *
 * Gemini has no equivalent API (Cloud Billing export only), so it is skipped
 * entirely rather than written as a bogus $0 of billed spend.
 */
import { PRICING_VERSION } from '../ai/model-pricing';
import type { Env } from '../types';

/** One provider-billed line, already normalised to micro-USD. */
interface BilledLine {
  day: string; // YYYY-MM-DD (UTC)
  model: string; // '' when the provider didn't break the cost down by model
  billedMicroUsd: number;
}

export interface ReconciliationResult {
  provider: string;
  day: string;
  rows: number;
  billedMicroUsd: number;
  estimatedMicroUsd: number;
  skippedReason?: string;
}

/** UTC `YYYY-MM-DD` for the day that ended most recently. */
export function previousUtcDay(now: Date): string {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function dayBounds(day: string): { startIso: string; endIso: string } {
  return { startIso: `${day}T00:00:00Z`, endIso: `${day}T23:59:59Z` };
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

interface AnthropicCostResult {
  amount?: string;
  currency?: string;
  model?: string | null;
  cost_type?: string | null;
}

interface AnthropicCostBucket {
  starting_at?: string;
  results?: AnthropicCostResult[];
}

/**
 * `GET /v1/organizations/cost_report`.
 *
 * `amount` is a decimal string in the LOWEST currency unit — cents, not
 * dollars. The docs' own example spells this out: `"123.45"` USD is $1.23.
 * Treating it as dollars would overstate every figure by 100x.
 */
async function fetchAnthropicBilled(
  adminKey: string,
  day: string
): Promise<BilledLine[]> {
  const { startIso, endIso } = dayBounds(day);
  const url = new URL('https://api.anthropic.com/v1/organizations/cost_report');
  url.searchParams.set('starting_at', startIso);
  url.searchParams.set('ending_at', endIso);
  url.searchParams.set('bucket_width', '1d');
  // Grouping by description is what populates `model` and `token_type`.
  url.searchParams.append('group_by[]', 'description');
  url.searchParams.set('limit', '31');

  const res = await fetch(url.toString(), {
    headers: {
      // Admin API keys authenticate with x-api-key like every other Anthropic
      // key; OAuth tokens use Bearer. Pick by prefix rather than sending both,
      // which the API rejects.
      ...(adminKey.startsWith('sk-ant-')
        ? { 'x-api-key': adminKey }
        : { Authorization: `Bearer ${adminKey}` }),
      'anthropic-version': '2023-06-01',
    },
  });
  if (!res.ok) {
    // Never surface the body: provider error payloads quote the submitted
    // credential back at us.
    throw new Error(`anthropic cost_report HTTP ${res.status}`);
  }

  const json = (await res.json()) as { data?: AnthropicCostBucket[] };
  const lines: BilledLine[] = [];
  for (const bucket of json.data ?? []) {
    const bucketDay = (bucket.starting_at ?? `${day}T00:00:00Z`).slice(0, 10);
    for (const r of bucket.results ?? []) {
      const cents = Number.parseFloat(r.amount ?? '0');
      if (!Number.isFinite(cents) || cents === 0) continue;
      lines.push({
        day: bucketDay,
        model: r.model ?? '',
        // cents -> micro-USD
        billedMicroUsd: Math.round(cents * 10_000),
      });
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

interface OpenAiCostResult {
  amount?: { value?: number; currency?: string };
  line_item?: string | null;
}

interface OpenAiCostBucket {
  start_time?: number;
  results?: OpenAiCostResult[];
}

/**
 * `GET /v1/organization/costs`.
 *
 * `amount.value` is in DOLLARS here (unlike Anthropic's cents), and `line_item`
 * looks like `"gpt-5.6-terra, input"` — the model is the part before the comma.
 */
async function fetchOpenAiBilled(adminKey: string, day: string): Promise<BilledLine[]> {
  const startSec = Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);
  const endSec = startSec + 24 * 60 * 60;

  const url = new URL('https://api.openai.com/v1/organization/costs');
  url.searchParams.set('start_time', String(startSec));
  url.searchParams.set('end_time', String(endSec));
  url.searchParams.set('bucket_width', '1d');
  url.searchParams.append('group_by[]', 'line_item');
  url.searchParams.set('limit', '31');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${adminKey}` },
  });
  if (!res.ok) {
    throw new Error(`openai costs HTTP ${res.status}`);
  }

  const json = (await res.json()) as OpenAiCostBucket[] | { data?: OpenAiCostBucket[] };
  const buckets = Array.isArray(json) ? json : (json.data ?? []);

  const lines: BilledLine[] = [];
  for (const bucket of buckets) {
    const bucketDay = bucket.start_time
      ? new Date(bucket.start_time * 1000).toISOString().slice(0, 10)
      : day;
    for (const r of bucket.results ?? []) {
      const dollars = r.amount?.value;
      if (typeof dollars !== 'number' || !Number.isFinite(dollars) || dollars === 0) continue;
      const model = (r.line_item ?? '').split(',')[0].trim();
      lines.push({
        day: bucketDay,
        model,
        // dollars -> micro-USD
        billedMicroUsd: Math.round(dollars * 1_000_000),
      });
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Our own estimate for one day + provider, keyed by model. Read from the raw
 * ledger, which is authoritative for recent days (the reconciler only ever
 * looks at yesterday, well inside the raw retention window).
 */
async function loadEstimates(
  env: Env,
  provider: string,
  day: string
): Promise<Map<string, number>> {
  const rows = await env.DB.prepare(
    `SELECT model, COALESCE(SUM(cost_micro_usd), 0) AS cost
     FROM ai_usage_events
     WHERE provider = ? AND date(created_at) = ?
     GROUP BY model`
  )
    .bind(provider, day)
    .all<{ model: string; cost: number }>();

  const out = new Map<string, number>();
  for (const r of rows.results ?? []) out.set(r.model, Number(r.cost ?? 0));
  return out;
}

async function upsert(
  env: Env,
  provider: string,
  day: string,
  model: string,
  billed: number,
  estimated: number
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO ai_cost_reconciliation
       (id, day, provider, model, billed_micro_usd, estimated_micro_usd, delta_micro_usd,
        pricing_version, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(day, provider, model) DO UPDATE SET
       billed_micro_usd = excluded.billed_micro_usd,
       estimated_micro_usd = excluded.estimated_micro_usd,
       delta_micro_usd = excluded.delta_micro_usd,
       pricing_version = excluded.pricing_version,
       fetched_at = excluded.fetched_at`
  )
    .bind(
      `${day}|${provider}|${model}`,
      day,
      provider,
      model,
      billed,
      estimated,
      billed - estimated,
      PRICING_VERSION
    )
    .run();
}

/**
 * Reconcile one provider for one day. Never throws — a provider outage or a
 * missing admin key must not take the cron tick down with it.
 */
async function reconcileProvider(
  env: Env,
  provider: 'anthropic' | 'openai',
  adminKey: string | undefined,
  day: string
): Promise<ReconciliationResult> {
  const base: ReconciliationResult = {
    provider,
    day,
    rows: 0,
    billedMicroUsd: 0,
    estimatedMicroUsd: 0,
  };
  if (!adminKey) {
    return { ...base, skippedReason: 'no admin key configured' };
  }

  try {
    const billed =
      provider === 'anthropic'
        ? await fetchAnthropicBilled(adminKey, day)
        : await fetchOpenAiBilled(adminKey, day);

    // The provider reports one line per token type (input / output / cache
    // read / cache write); we estimate a single blended figure per model, so
    // collapse to per-model totals before comparing.
    const billedByModel = new Map<string, number>();
    for (const line of billed) {
      if (line.day !== day) continue;
      billedByModel.set(line.model, (billedByModel.get(line.model) ?? 0) + line.billedMicroUsd);
    }

    const estimates = await loadEstimates(env, provider, day);

    // Union of both key sets: a model we billed for but never logged is just as
    // interesting as one we logged but were not billed for.
    const models = new Set<string>([...billedByModel.keys(), ...estimates.keys()]);

    let totalBilled = 0;
    let totalEstimated = 0;
    for (const model of models) {
      const b = billedByModel.get(model) ?? 0;
      const e = estimates.get(model) ?? 0;
      totalBilled += b;
      totalEstimated += e;
      await upsert(env, provider, day, model, b, e);
    }

    return {
      ...base,
      rows: models.size,
      billedMicroUsd: totalBilled,
      estimatedMicroUsd: totalEstimated,
    };
  } catch (err) {
    console.error(`[ai-cost-reconciliation] ${provider} failed`, {
      day,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ...base, skippedReason: 'fetch failed' };
  }
}

/**
 * Reconcile every provider we hold an admin key for, for the day that just
 * ended. Called from the daily cron window.
 */
export async function reconcileYesterday(
  env: Env,
  now: Date
): Promise<ReconciliationResult[]> {
  const day = previousUtcDay(now);
  const results = await Promise.all([
    reconcileProvider(env, 'anthropic', env.ANTHROPIC_ADMIN_API_KEY, day),
    reconcileProvider(env, 'openai', env.OPENAI_ADMIN_API_KEY, day),
    // Gemini deliberately absent — no cost API exists, and writing a $0 billed
    // row would read as "no drift" when the truth is "not measured".
  ]);

  for (const r of results) {
    if (r.skippedReason) {
      console.log(`[ai-cost-reconciliation] skipped ${r.provider}: ${r.skippedReason}`);
      continue;
    }
    const deltaUsd = (r.billedMicroUsd - r.estimatedMicroUsd) / 1_000_000;
    console.log(
      `[ai-cost-reconciliation] ${r.provider} ${r.day}: billed $${(r.billedMicroUsd / 1e6).toFixed(4)}, ` +
        `estimated $${(r.estimatedMicroUsd / 1e6).toFixed(4)}, delta $${deltaUsd.toFixed(4)} over ${r.rows} model(s)`
    );
  }
  return results;
}
