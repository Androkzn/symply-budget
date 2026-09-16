import { drizzle } from 'drizzle-orm/d1';

import {
  PRICING_VERSION,
  ratesForPromptSize,
  resolveModelPrice,
  type PricingSource,
} from '../ai/model-pricing';
import type { AiUsageEvent, AiUsageRecorder } from '../ai/provider';
import { aiUsageEvents } from '../db/schema-ai-usage';
import type { Env } from '../types';

/**
 * Where an AI call came from.
 *
 * `feature` is required (drives the per-feature cost breakdown). `householdId`
 * is optional but should be passed whenever one is in scope: the per-household
 * report filters on it, so a row without one is written and then never shown to
 * anybody. Leave it null only for genuinely org-level work — cron sweeps and
 * background workers that serve no single household — which the report surfaces
 * under `scope=background`.
 */
export interface AiUsageContext {
  feature: string;
  householdId?: string | null;
  userId?: string | null;
}

/** Cost of one call, plus how confident we are in the rate we used. */
export interface CostBreakdown {
  costMicroUsd: number;
  pricingSource: PricingSource;
  pricingVersion: string;
}

/**
 * Cost of a single call in micro-USD (1_000_000 = $1).
 *
 * Rates come from `ai/model-pricing.ts`, which is per-model rather than the
 * old four-keyword guess (`opus`/`haiku`/`sonnet`/`gemini`, everything else
 * billed as Sonnet). That guess mispriced 5 of 8 catalogued models — every
 * OpenAI model and every Gemini model among them.
 *
 * All six token buckets on `AiUsageEvent` are mutually exclusive, so each is
 * multiplied exactly once. Reasoning tokens bill at the OUTPUT rate on all
 * three vendors.
 */
export function computeCostMicroUsd(event: AiUsageEvent): CostBreakdown {
  const { rates: price, source } = resolveModelPrice(event.provider, event.model);

  // Tier thresholds are measured against the whole prompt the vendor processed,
  // not just the part we pay full input rate for.
  const promptTokens =
    event.inputTokens +
    event.cacheReadTokens +
    event.cacheWrite5mTokens +
    event.cacheWrite1hTokens;
  const rates = ratesForPromptSize(price, promptTokens);

  const micro =
    event.inputTokens * rates.input +
    event.cacheReadTokens * rates.cacheRead +
    event.cacheWrite5mTokens * rates.cacheWrite5m +
    event.cacheWrite1hTokens * rates.cacheWrite1h +
    (event.outputTokens + event.reasoningTokens) * rates.output;

  return {
    costMicroUsd: Math.round(micro),
    pricingSource: source,
    pricingVersion: PRICING_VERSION,
  };
}

/** Sum of the exclusive buckets — every token the vendor billed for. */
export function totalTokensFor(event: AiUsageEvent): number {
  return (
    event.inputTokens +
    event.outputTokens +
    event.reasoningTokens +
    event.cacheReadTokens +
    event.cacheWrite5mTokens +
    event.cacheWrite1hTokens
  );
}

/**
 * Persist one AI usage row. Never throws — logging a usage row must not break
 * the AI request that produced it. Awaited by the providers, so the D1 insert
 * (a few ms) completes before the response returns; no `waitUntil` needed.
 */
export async function recordAiUsage(
  env: Env,
  context: AiUsageContext,
  event: AiUsageEvent
): Promise<void> {
  try {
    const cost = computeCostMicroUsd(event);
    const db = drizzle(env.DB);
    await db.insert(aiUsageEvents).values({
      id: crypto.randomUUID(),
      household_id: context.householdId ?? null,
      user_id: context.userId ?? null,
      feature: context.feature,
      provider: event.provider,
      model: event.model,
      input_tokens: event.inputTokens,
      output_tokens: event.outputTokens,
      reasoning_tokens: event.reasoningTokens,
      cache_read_tokens: event.cacheReadTokens,
      cache_write_5m_tokens: event.cacheWrite5mTokens,
      cache_write_1h_tokens: event.cacheWrite1hTokens,
      // Retained as the combined figure so rows written before the TTL split
      // stay comparable with rows written after it.
      cache_write_tokens: event.cacheWrite5mTokens + event.cacheWrite1hTokens,
      total_tokens: totalTokensFor(event),
      cost_micro_usd: cost.costMicroUsd,
      pricing_version: cost.pricingVersion,
      pricing_source: cost.pricingSource,
      latency_ms: event.latencyMs,
      status: event.status,
      error_kind: event.errorKind ?? null,
    });
  } catch (err) {
    // Telemetry must never break the caller — log and move on.
    console.error('[ai-usage] failed to record usage event:', err);
  }
}

/**
 * Build an `AiUsageRecorder` bound to `env` + `context`. Pass the result as the
 * `onUsage` option when constructing a provider (or let
 * `createAnthropicAdapterForUser` do it for you).
 */
export function usageRecorderFor(env: Env, context: AiUsageContext): AiUsageRecorder {
  return (event: AiUsageEvent) => recordAiUsage(env, context, event);
}
