/**
 * Platform / Soft Transfer bridge metrics.
 *
 * Same Analytics Engine pattern as aihousekeeper-metrics: writeDataPoint when
 * bound, otherwise a grep-friendly console line so denials are never silent.
 */

import type { Env } from '../../types';

export const PLATFORM_METRIC_NAMES = [
  'platform_bridge_auth_denial',
  'platform_jwt_verify_failure',
  'platform_bridge_control_denial',
] as const;

export type PlatformMetricName = (typeof PLATFORM_METRIC_NAMES)[number];

export function platformMetric(
  env: Env | undefined,
  name: PlatformMetricName,
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
      console.warn(`[PLATFORM_METRIC ${name}] AE write failed`, err);
    }
  }

  console.log(`[PLATFORM_METRIC ${name}]`, JSON.stringify({ value, ...dims }));
}
