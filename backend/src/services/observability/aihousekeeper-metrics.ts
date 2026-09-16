/**
 * Aihousekeeper metrics — plan §I1.
 *
 * Emits Aihousekeeper observability signals to the Cloudflare Analytics Engine
 * (`env.ANALYTICS_ENGINE` → dataset `aihousekeeper_metrics`, see wrangler.toml).
 * Falls back to a grep-prefixed console.log when the binding is absent
 * (local dev without the dataset provisioned).
 *
 * Grep prefix: `[AIHOUSEKEEPER_METRIC <name>]` — Stream I tests assert on this.
 */

import type { Env } from '../../types';

/** Authoritative list of Aihousekeeper metric names (plan §I1). */
export const AIHOUSEKEEPER_METRIC_NAMES = [
  'aihousekeeper_outbound_per_user_per_day',
  'aihousekeeper_empty_briefing_ratio',
  'aihousekeeper_llm_cost_per_user_per_day',
  'aihousekeeper_twilio_delivery_failure_rate',
  'aihousekeeper_twilio_opt_out_rate',
  'aihousekeeper_sendgrid_bounce_rate',
  'aihousekeeper_sendgrid_complaint_rate',
  'aihousekeeper_memory_recall_p95_latency_ms',
  'aihousekeeper_trust_ledger_write_failure_rate',
  'aihousekeeper_outbound_loop_cron_success_rate',
  'aihousekeeper_followup_execution_lag_p95_min',
  'aihousekeeper_briefing_composition_p95_latency_s',
  'aihousekeeper_family_router_bias_coefficient',
  'aihousekeeper_dlq_length',
  'aihousekeeper_queue_msg_duration_ms',
  'aihousekeeper_model_fallback_triggered',
] as const;

export type AihousekeeperMetricName = (typeof AIHOUSEKEEPER_METRIC_NAMES)[number];

/**
 * Emit a single Aihousekeeper metric data point.
 *
 * `value` semantics depend on the metric — counters pass `1`, gauges pass
 * the current reading, histograms pass the measured sample. `dims` is a
 * flat string-keyed label bag (e.g. `{ channel: 'sms', outcome: 'failed' }`).
 *
 * When `env.ANALYTICS_ENGINE` is bound, writes via `writeDataPoint`:
 *   - `blobs[0]`  = metric name (indexable)
 *   - `blobs[1…]` = dimension values (sorted by key for stable ordering)
 *   - `doubles[0]` = numeric value
 *   - `indexes[0]` = metric name (1 of 1 allowed index)
 *
 * On any fall-through (missing binding, write failure) we emit the JSON
 * console line so the signal is never silently lost.
 */
export function aihousekeeperMetric(
  env: Env | undefined,
  name: AihousekeeperMetricName,
  value: number,
  dims: Record<string, string> = {}
): void {
  const dimKeys = Object.keys(dims).sort();
  const dimValues = dimKeys.map((k) => dims[k] ?? '');

  if (env?.ANALYTICS_ENGINE) {
    try {
      env.ANALYTICS_ENGINE.writeDataPoint({
        blobs: [name, ...dimValues],
        doubles: [value],
        indexes: [name],
      });
      return;
    } catch (err) {
      // Fall through to console.log so the signal still lands somewhere.
      console.warn(`[AIHOUSEKEEPER_METRIC ${name}] AE write failed`, err);
    }
  }

  console.log(`[AIHOUSEKEEPER_METRIC ${name}]`, JSON.stringify({ value, ...dims }));
}

/**
 * Convenience singleton — callers can do `aihousekeeperMetrics.record(env, name, v, dims)`.
 * The legacy `(name, value, dims)` signature (no env) remains supported; it always
 * goes to console.log. Prefer passing `env` where available so AE receives the point.
 */
export const aihousekeeperMetrics = {
  record(
    envOrName: Env | AihousekeeperMetricName,
    nameOrValue: AihousekeeperMetricName | number,
    valueOrDims?: number | Record<string, string>,
    dims?: Record<string, string>
  ): void {
    // Overload resolution:
    //   record(env, name, value, dims?)
    //   record(name, value, dims?)          // legacy — no AE
    if (typeof envOrName === 'string') {
      // Legacy signature
      aihousekeeperMetric(
        undefined,
        envOrName as AihousekeeperMetricName,
        nameOrValue as number,
        (valueOrDims as Record<string, string>) ?? {}
      );
      return;
    }
    aihousekeeperMetric(
      envOrName as Env,
      nameOrValue as AihousekeeperMetricName,
      valueOrDims as number,
      dims ?? {}
    );
  },
  names: AIHOUSEKEEPER_METRIC_NAMES,
};
