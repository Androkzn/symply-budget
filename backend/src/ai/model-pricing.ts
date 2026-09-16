/**
 * Per-model list prices, in USD per 1,000,000 tokens.
 *
 * Because 1 USD = 1_000_000 micro-USD, a "USD per 1M tokens" rate is
 * numerically identical to "micro-USD per token" — so `tokens * rate` yields
 * micro-USD directly, with no scaling step. See `ai-usage-service.ts`.
 *
 * These are LIST prices, and what we compute from them is an ESTIMATE. A normal
 * inference key cannot read the provider's actual bill, and under BYOK the bill
 * isn't ours at all. `ai-cost-reconciliation-service.ts` pulls the real
 * org-level spend nightly (where we hold an admin key) and records the delta, so
 * drift in this table becomes visible instead of silently wrong.
 *
 * Token buckets here are MUTUALLY EXCLUSIVE — `input` means *uncached* input
 * only. Providers disagree on this at the wire level (Anthropic already excludes
 * cache reads from `input_tokens`; OpenAI and Gemini include them), so each
 * provider adapter normalises to exclusive buckets before emitting. Getting this
 * wrong double-charges every cached token.
 */
import type { AIProviderId } from '../services/ai-entitlement-types';

/**
 * Bumped whenever a rate below changes. Stamped on every `ai_usage_events` row
 * so a cost series spanning a price change is still interpretable — without it,
 * a vendor price cut looks like a usage drop.
 */
export const PRICING_VERSION = '2026-08-15';

export interface TokenRates {
  /** Uncached input tokens. */
  input: number;
  /** Output tokens. Includes reasoning / thinking tokens — every vendor bills those as output. */
  output: number;
  /** Cache-read (cache-hit) input tokens. */
  cacheRead: number;
  /** Cache-write tokens at the provider's short TTL (Anthropic 5m; OpenAI implicit). */
  cacheWrite5m: number;
  /** Cache-write tokens at the 1-hour TTL. Anthropic only — 2x input, not 1.25x. */
  cacheWrite1h: number;
}

export interface ModelPrice extends TokenRates {
  /**
   * Long-prompt tier. Gemini 3.1 Pro charges a higher rate once the prompt
   * exceeds `aboveInputTokens`; Anthropic and OpenAI are flat at these sizes.
   */
  longPrompt?: { aboveInputTokens: number } & TokenRates;
}

/** How confidently `resolveModelPrice` identified the model. */
export type PricingSource = 'exact' | 'pattern' | 'fallback';

export interface ResolvedPrice {
  rates: ModelPrice;
  source: PricingSource;
}

// ---------------------------------------------------------------------------
// Anthropic — cache multipliers are uniform across the family:
// read 0.1x input, 5m write 1.25x, 1h write 2x.
// ---------------------------------------------------------------------------

function anthropic(input: number, output: number): ModelPrice {
  return {
    input,
    output,
    cacheRead: input * 0.1,
    cacheWrite5m: input * 1.25,
    cacheWrite1h: input * 2,
  };
}

// ---------------------------------------------------------------------------
// OpenAI — cached reads are 90% off; cache writes 1.25x on GPT-5.6 and later.
// (Chat Completions does not report cache-WRITE tokens, so `cacheWrite5m` is
// carried for completeness and is almost always multiplied by zero.)
// ---------------------------------------------------------------------------

function openai(input: number, output: number): ModelPrice {
  return {
    input,
    output,
    cacheRead: input * 0.1,
    cacheWrite5m: input * 1.25,
    cacheWrite1h: input * 1.25,
  };
}

/**
 * Gemini bills context-cache STORAGE per token-hour, which is a property of the
 * cache and not of any one request — there is no per-call field to attribute it
 * to, so it is deliberately not modelled here and will show up as reconciliation
 * drift rather than as a bogus per-request charge.
 */
function gemini(input: number, output: number, cacheRead: number): ModelPrice {
  return { input, output, cacheRead, cacheWrite5m: 0, cacheWrite1h: 0 };
}

/**
 * Keyed by the provider's own model id (`vendorModelId` in the catalog), which
 * is what the API echoes back on the response — not our catalog key.
 */
const EXACT_PRICES: Record<string, ModelPrice> = {
  // --- OpenAI (rates current as of the 2026-07-30 cut) ---
  'gpt-5.6-sol': openai(5, 30),
  'gpt-5.6-terra': openai(2, 12),
  'gpt-5.6-luna': openai(0.2, 1.2),

  // --- Anthropic ---
  'claude-fable-5': anthropic(10, 50),
  'claude-mythos-5': anthropic(10, 50),
  'claude-opus-5': anthropic(5, 25),
  'claude-opus-4-8': anthropic(5, 25),
  // Sonnet 5 carries an introductory $2/$10 through 2026-08-31. We deliberately
  // bill the $3/$15 list rate: a time-dependent rate would make historical rows
  // irreproducible, and over-estimating during a promo is the safe direction.
  // The reconciliation delta will show the gap while the promo runs.
  'claude-sonnet-5': anthropic(3, 15),
  'claude-haiku-4-5': anthropic(1, 5),

  // --- Gemini ---
  'gemini-3.1-pro-preview': {
    ...gemini(2, 12, 0.2),
    longPrompt: { aboveInputTokens: 200_000, ...gemini(4, 18, 0.4) },
  },
  'gemini-3.5-flash': gemini(1.5, 9, 0.15),
  'gemini-3-flash-preview': gemini(0.5, 3, 0.05),
};

/**
 * Family patterns for ids we did not catalogue — dated snapshots
 * (`claude-opus-4-8-20260115`), aliases, and BYOK members who pin a model the
 * picker never offered. Ordered: first match wins, so put specific before broad.
 */
const PATTERN_PRICES: Array<{ test: RegExp; rates: ModelPrice }> = [
  // Anthropic
  { test: /^claude-(fable|mythos)/i, rates: anthropic(10, 50) },
  { test: /^claude-opus/i, rates: anthropic(5, 25) },
  { test: /^claude-sonnet/i, rates: anthropic(3, 15) },
  { test: /^claude-haiku/i, rates: anthropic(1, 5) },
  // OpenAI
  { test: /^gpt-[\d.]+-sol/i, rates: openai(5, 30) },
  { test: /^gpt-[\d.]+-terra/i, rates: openai(2, 12) },
  { test: /^gpt-[\d.]+-luna/i, rates: openai(0.2, 1.2) },
  // Gemini — lite tiers first, they'd otherwise match the broader flash rule.
  { test: /^gemini-[\d.]+-flash-lite/i, rates: gemini(0.5, 3, 0.05) },
  { test: /^gemini-[\d.]+-pro/i, rates: gemini(2, 12, 0.2) },
  { test: /^gemini-[\d.]+-flash/i, rates: gemini(1.5, 9, 0.15) },
];

/**
 * Last resort, per provider: the most expensive model we know that provider
 * sells. The old behaviour billed every unrecognised model at Claude Sonnet
 * rates, which silently under-charged Gemini Pro by ~20x and over-charged GPT
 * Luna by ~15x. Erring expensive keeps an unpriced model from looking free, and
 * the row is stamped `pricing_source = 'fallback'` so the API can report exactly
 * how much of a total rests on a guess.
 */
const PROVIDER_FALLBACK: Record<AIProviderId, ModelPrice> = {
  openai: openai(5, 30),
  anthropic: anthropic(10, 50),
  gemini: gemini(4, 18, 0.4),
};

export function resolveModelPrice(provider: AIProviderId, model: string): ResolvedPrice {
  const id = (model || '').trim();

  const exact = EXACT_PRICES[id];
  if (exact) return { rates: exact, source: 'exact' };

  for (const { test, rates } of PATTERN_PRICES) {
    if (test.test(id)) return { rates, source: 'pattern' };
  }

  return { rates: PROVIDER_FALLBACK[provider] ?? PROVIDER_FALLBACK.anthropic, source: 'fallback' };
}

/**
 * Pick the rate tier for a request of this prompt size. Only Gemini 3.1 Pro
 * tiers today; everything else returns the base rates unchanged.
 *
 * `promptTokens` must be the FULL prompt — uncached input + cache reads +
 * cache writes — because that is what the vendor measures the threshold
 * against, not the uncached remainder we bill at the input rate.
 */
export function ratesForPromptSize(price: ModelPrice, promptTokens: number): TokenRates {
  if (price.longPrompt && promptTokens > price.longPrompt.aboveInputTokens) {
    return price.longPrompt;
  }
  return price;
}

export class ModelPricingCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelPricingCoverageError';
  }
}

/**
 * Every catalogued model must have an EXACT price — a catalogue entry that only
 * matches a family pattern is how a new model silently gets billed at its
 * predecessor's rate. Called at module load by `model-catalog.ts` (which owns
 * the catalogue) so a mispriced release fails the test suite, not production.
 */
export function assertPricingCoversCatalog(
  entries: ReadonlyArray<{ id: string; vendorModelId: string }>
): void {
  const missing = entries.filter((e) => !EXACT_PRICES[e.vendorModelId]);
  if (missing.length > 0) {
    throw new ModelPricingCoverageError(
      `no exact price for catalogued model(s): ${missing
        .map((e) => `${e.id} (${e.vendorModelId})`)
        .join(', ')} — add them to EXACT_PRICES and bump PRICING_VERSION`
    );
  }
}
