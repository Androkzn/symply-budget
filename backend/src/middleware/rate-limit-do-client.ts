import type { Env } from '../types';

export interface RateLimitCheckConfig {
  windowMs: number;
  maxRequests: number;
}

/**
 * Durable Object rate-limit check (extracted for testability).
 */
export async function checkRateLimitDO(
  env: Env,
  bucketKey: string,
  config: RateLimitCheckConfig
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const id = env.RATE_LIMITER.idFromName(bucketKey);
  const stub = env.RATE_LIMITER.get(id);

  const response = await stub.fetch('https://rate-limiter/check', {
    method: 'POST',
    body: JSON.stringify({
      windowMs: config.windowMs,
      maxRequests: config.maxRequests,
    }),
  });

  return response.json();
}
