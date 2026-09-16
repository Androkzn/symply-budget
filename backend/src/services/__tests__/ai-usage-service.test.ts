import { describe, it, expect } from 'vitest';

import { PRICING_VERSION } from '../../ai/model-pricing';
import type { AiUsageEvent } from '../../ai/provider';
import { computeCostMicroUsd, totalTokensFor } from '../ai-usage-service';

function evt(partial: Partial<AiUsageEvent>): AiUsageEvent {
  return {
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    latencyMs: 0,
    status: 'ok',
    ...partial,
  };
}

const cost = (e: AiUsageEvent) => computeCostMicroUsd(e).costMicroUsd;

describe('computeCostMicroUsd', () => {
  // A "USD per 1M tokens" rate equals "micro-USD per token", so 1M tokens at
  // $3/Mtok must cost exactly 3,000,000 micro-USD ($3).
  it('prices 1M Sonnet input tokens at $3 (3,000,000 micro-USD)', () => {
    expect(cost(evt({ inputTokens: 1_000_000 }))).toBe(3_000_000);
  });

  it('prices Sonnet input + output with the right per-model rates', () => {
    // 1000 * 3 (input) + 500 * 15 (output) = 3000 + 7500
    expect(cost(evt({ inputTokens: 1000, outputTokens: 500 }))).toBe(10_500);
  });

  it('bills reasoning tokens at the output rate', () => {
    // Thinking tokens are output tokens as far as every vendor's invoice is
    // concerned; the split exists for visibility, not for a different rate.
    expect(cost(evt({ outputTokens: 500, reasoningTokens: 500 }))).toBe(1000 * 15);
  });

  it('applies the cache multipliers, including the 2x 1-hour write', () => {
    // Sonnet input rate 3: read 0.1x -> 0.3, 5m write 1.25x -> 3.75, 1h write 2x -> 6.
    expect(cost(evt({ cacheReadTokens: 1000 }))).toBe(300);
    expect(cost(evt({ cacheWrite5mTokens: 1000 }))).toBe(3750);
    expect(cost(evt({ cacheWrite1hTokens: 1000 }))).toBe(6000);
  });

  it('prices every catalogued model from its own rate, not a keyword guess', () => {
    // The old keyword matcher billed all three of these at Sonnet's $3/$15.
    expect(cost(evt({ model: 'claude-fable-5', inputTokens: 1000, outputTokens: 100 }))).toBe(
      1000 * 10 + 100 * 50
    );
    expect(cost(evt({ model: 'claude-opus-4-8', inputTokens: 1000, outputTokens: 100 }))).toBe(
      1000 * 5 + 100 * 25
    );
    expect(cost(evt({ model: 'claude-haiku-4-5', inputTokens: 1000, outputTokens: 100 }))).toBe(
      1000 * 1 + 100 * 5
    );
    expect(
      cost(evt({ provider: 'openai', model: 'gpt-5.6-luna', inputTokens: 1000, outputTokens: 100 }))
    ).toBe(Math.round(1000 * 0.2 + 100 * 1.2));
    expect(
      cost(evt({ provider: 'openai', model: 'gpt-5.6-sol', inputTokens: 1000, outputTokens: 100 }))
    ).toBe(1000 * 5 + 100 * 30);
    expect(
      cost(
        evt({ provider: 'gemini', model: 'gemini-3.5-flash', inputTokens: 1000, outputTokens: 500 })
      )
    ).toBe(Math.round(1000 * 1.5 + 500 * 9));
  });

  it('charges Gemini 3.1 Pro the long-prompt tier past 200k prompt tokens', () => {
    const short = evt({ provider: 'gemini', model: 'gemini-3.1-pro-preview', inputTokens: 1000 });
    expect(cost(short)).toBe(1000 * 2);

    const long = evt({
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
      inputTokens: 250_000,
    });
    expect(cost(long)).toBe(250_000 * 4);
  });

  it('measures the tier threshold against the whole prompt, not just uncached input', () => {
    // 150k uncached + 100k cache reads is a 250k prompt: over the threshold,
    // even though the uncached remainder alone is under it.
    const e = evt({
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
      inputTokens: 150_000,
      cacheReadTokens: 100_000,
    });
    expect(cost(e)).toBe(150_000 * 4 + 100_000 * 0.4);
  });

  it('bills an unknown model at the provider fallback and flags it', () => {
    // Never silently cheap, and never silently confident: the row is marked so
    // the report can say how much of a total rests on a guess.
    const result = computeCostMicroUsd(
      evt({ provider: 'gemini', model: 'some-future-model', inputTokens: 1000 })
    );
    expect(result.costMicroUsd).toBe(1000 * 4);
    expect(result.pricingSource).toBe('fallback');
  });

  it('matches dated snapshots and unlisted family members by pattern', () => {
    const result = computeCostMicroUsd(
      evt({ model: 'claude-opus-4-8-20260115', inputTokens: 1000 })
    );
    expect(result.costMicroUsd).toBe(1000 * 5);
    expect(result.pricingSource).toBe('pattern');
  });

  it('stamps the pricing version so a rate change is distinguishable from a usage change', () => {
    expect(computeCostMicroUsd(evt({ inputTokens: 1 })).pricingVersion).toBe(PRICING_VERSION);
  });

  it('costs an error row at zero but still records it', () => {
    const e = evt({ status: 'error', errorKind: 'http_429' });
    expect(cost(e)).toBe(0);
    expect(totalTokensFor(e)).toBe(0);
  });
});

describe('totalTokensFor', () => {
  it('sums every exclusive bucket exactly once', () => {
    expect(
      totalTokensFor(
        evt({
          inputTokens: 1,
          outputTokens: 2,
          reasoningTokens: 4,
          cacheReadTokens: 8,
          cacheWrite5mTokens: 16,
          cacheWrite1hTokens: 32,
        })
      )
    ).toBe(63);
  });
});
