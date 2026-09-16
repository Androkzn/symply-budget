import { DurableObject } from 'cloudflare:workers';

import type { Env } from '../types';

/**
 * Durable Object for distributed rate limiting
 */
export class RateLimiterDO extends DurableObject<Env> {
  private requests: Map<number, number> = new Map();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Load state from storage on initialization
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<[number, number][]>('requests');
      if (stored) {
        this.requests = new Map(stored);
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/check' && request.method === 'POST') {
      return this.handleCheck(request);
    }

    return new Response('Not found', { status: 404 });
  }

  private async handleCheck(request: Request): Promise<Response> {
    const body = await request.json<{
      windowMs: number;
      maxRequests: number;
    }>();
    const { windowMs, maxRequests } = body;

    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean old entries
    for (const [timestamp] of this.requests) {
      if (timestamp < windowStart) {
        this.requests.delete(timestamp);
      }
    }

    // Count total requests in window
    let totalRequests = 0;
    for (const count of this.requests.values()) {
      totalRequests += count;
    }

    // Check if rate limited
    if (totalRequests >= maxRequests) {
      const oldestTimestamp = Math.min(...this.requests.keys());
      const resetAt = oldestTimestamp + windowMs;

      return Response.json({
        allowed: false,
        remaining: 0,
        resetAt,
      });
    }

    // Record this request (1-second buckets)
    const bucket = Math.floor(now / 1000) * 1000;
    const currentCount = this.requests.get(bucket) || 0;
    this.requests.set(bucket, currentCount + 1);

    // Persist state
    await this.ctx.storage.put('requests', Array.from(this.requests.entries()));

    return Response.json({
      allowed: true,
      remaining: maxRequests - totalRequests - 1,
      resetAt: now + windowMs,
    });
  }
}
