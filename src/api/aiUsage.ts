/**
 * AI usage / estimated-cost reporting (GET /households/:householdId/ai-usage).
 *
 * All dollar amounts are our OWN estimate — token counts × a server-side price
 * table — not the provider's actual bill (a normal inference key can't read
 * that). Every figure is computed server-side (thin-frontend rule); the client
 * only renders. Pass `?provider=` to scope to one provider (its own per-day
 * series); omit for the whole household + a per-provider split.
 */
import type { AIProviderId } from './aiAccess';
import { api } from './client';

export interface AIUsageBucket {
  requests: number;
  tokens: number;
  costUsd: number;
}

export interface AIUsageResponse {
  currency: 'USD';
  range: {
    days: number;
    /** Days served from per-request rows; older days come from the daily rollup. */
    rawWindowDays: number;
    /** First UTC day of the period, `YYYY-MM-DD`. */
    start: string;
    /** Last UTC day of the period (today, server-side), `YYYY-MM-DD`. */
    end: string;
  };
  provider: AIProviderId | null;
  totals: AIUsageBucket & {
    /** Calls that failed at the provider. They cost ~nothing but signal retry storms. */
    errorRequests: number;
  };
  /**
   * How far to trust the dollar figures. Token counts are exact (the provider
   * reports them); the RATES are a server-side table, so `unpricedRequests > 0`
   * means some calls used a model absent from it and were billed at the
   * provider's priciest known rate — an upper bound, not a measurement.
   */
  estimate: {
    isEstimate: true;
    pricingVersion: string;
    unpricedRequests: number;
  };
  byFeature: Array<AIUsageBucket & { feature: string }>;
  byModel: Array<AIUsageBucket & { model: string; provider: string }>;
  byProvider: Array<AIUsageBucket & { provider: string }>;
  /**
   * One bucket per calendar day in `range`, zeros included — a real time axis,
   * not just the days that happened to have traffic.
   */
  byDay: Array<AIUsageBucket & { date: string }>;
}

export const aiUsageApi = {
  getUsage: (
    householdId: string,
    opts?: { days?: number; provider?: AIProviderId }
  ): Promise<AIUsageResponse> => {
    const params = new URLSearchParams();
    if (opts?.days) params.set('days', String(opts.days));
    if (opts?.provider) params.set('provider', opts.provider);
    const qs = params.toString();
    return api.get<AIUsageResponse>(
      `/households/${householdId}/ai-usage${qs ? `?${qs}` : ''}`
    ) as Promise<AIUsageResponse>;
  },
};
