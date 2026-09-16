import { Context, Next } from 'hono';

import { isAiRateLimitDeny } from '../services/config-flags';
import type { Env } from '../types';
import { RateLimitError, ServiceUnavailableError } from '../utils/errors';
import { safeErrorLog } from '../utils/log-scrubber';

import { checkRateLimitDO as checkRateLimitDOClient } from './rate-limit-do-client';

/**
 * Rate limit configuration
 */
interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

/**
 * Rate limit configurations by action
 */
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  'auth:login': { windowMs: 15 * 60 * 1000, maxRequests: 50 }, // 50 per 15 min (more permissive for dev)
  'auth:register': { windowMs: 60 * 60 * 1000, maxRequests: 20 }, // bridge abuse surface — DO-backed
  'auth:forgot-password': { windowMs: 60 * 60 * 1000, maxRequests: 3 }, // 3 per hour
  'auth:verify-email': { windowMs: 60 * 60 * 1000, maxRequests: 10 }, // 10 per hour
  'auth:idp-challenge': { windowMs: 15 * 60 * 1000, maxRequests: 30 },
  'transfer:prepare': { windowMs: 60 * 60 * 1000, maxRequests: 30 },
  'transfer:import': { windowMs: 60 * 60 * 1000, maxRequests: 30 },
  'auth:deletion-status': { windowMs: 15 * 60 * 1000, maxRequests: 60 },
  'companion:get': { windowMs: 60 * 1000, maxRequests: 120 },
  'auth:resolve-exchange': { windowMs: 60 * 1000, maxRequests: 60 },
  'reports:upload': { windowMs: 60 * 60 * 1000, maxRequests: 10 }, // 10 per hour
  'chat:message': { windowMs: 60 * 1000, maxRequests: 60 }, // 60 messages per minute per user
  'budget-chat:message': { windowMs: 60 * 1000, maxRequests: 60 }, // Budget chat fork — 60/min/user
  'api:general': { windowMs: 60 * 1000, maxRequests: 100 }, // 100 per minute
  // Aihousekeeper (Proactive Layer) buckets per plan §E1.
  'aihousekeeper:default': { windowMs: 60 * 1000, maxRequests: 60 }, // mutations (PATCH/POST/DELETE)
  'aihousekeeper:read': { windowMs: 60 * 1000, maxRequests: 120 }, // GET
  // Kaizen (Kaizen-only) — ported from the donor's per-router rate limits.
  'kaizen:ai': { windowMs: 60 * 60 * 1000, maxRequests: 100 }, // donor ai.ts: 100/hr/user
  'kaizen:coach': { windowMs: 60 * 60 * 1000, maxRequests: 60 }, // donor coach chat: 60/hr/user
  // Symply Health P3 — every `/health/ai/*` path costs model tokens (the coach
  // turn, the label/meal scanners, the body-insight producer). The donor caps
  // its whole `/ai` surface at 100/hr/user and its coach at 120/hr; 100 is the
  // stricter of the two and covers all three surfaces in one bucket, which is
  // what an image-carrying scanner deserves.
  'health:ai': { windowMs: 60 * 60 * 1000, maxRequests: 100 },
  // Local-first `/v2` control plane (Health V2 plan §2 He0 item 9). `/v2` had
  // auth + membership checks but no ceiling at all, on a surface where mailbox
  // deposit volume is itself metadata about an E2EE health ledger.
  //
  // ⚠️ IDENTIFIER: both buckets are registered ABOVE the `/v2` mount, and
  // `/v2`'s own `authMiddleware()` lives INSIDE that router — so `userId` is
  // not set yet and `resolveRateLimitIdentifier` falls through. The wide bucket
  // keys on the client IP; the checkpoint bucket keys on the `:householdId`
  // path param (its registration path declares it, so `c.req.param()` resolves).
  //
  // Wide: 4 rps sustained per IP — generous enough for several devices behind
  // one NAT polling the mailbox, still a hard ceiling on an unauthenticated
  // flood.
  'local-first:v2': { windowMs: 60 * 1000, maxRequests: 240 },
  // Tighter, because a checkpoint PUT is the only `/v2` write that persists up
  // to ~500 KB of ciphertext per call. Publishing is owner-only and gated at
  // ≥100 new ops, and a checkpoint chunks at 350 KB of plaintext, so 120/hr per
  // household covers a ~42 MB checkpoint burst plus retries. The household id
  // is unauthenticated here, so this is a per-household write-cost ceiling
  // stacked UNDER the per-IP bucket above (which runs first), not a substitute.
  'local-first:v2:checkpoint': { windowMs: 60 * 60 * 1000, maxRequests: 120 },
};

/** AI/chat/coach actions that must use DO-backed rate limiting (Track B B3). */
export const AI_RATE_LIMIT_ACTIONS = new Set<string>([
  'chat:message',
  'budget-chat:message',
  'aihousekeeper:default',
  'aihousekeeper:read',
  'kaizen:ai',
  'kaizen:coach',
  'health:ai',
]);

/**
 * In-memory rate limiter for legacy non-AI routes only.
 * AI/chat/coach actions must use rateLimitDO() — not this Map.
 */
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function cleanupExpiredEntries() {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (value.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}

export function resolveRateLimitIdentifier(c: Context<{ Bindings: Env }>): string {
  const userId = c.get('userId');
  if (userId) return userId;
  const householdId = c.req.param('householdId');
  if (householdId) return householdId;
  return c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
}

function applyRateLimitHeaders(
  c: Context<{ Bindings: Env }>,
  remaining: number,
  resetAt: number,
  retryAfter?: number
): void {
  c.header('X-RateLimit-Remaining', String(remaining));
  c.header('X-RateLimit-Reset', String(resetAt));
  if (retryAfter !== undefined) {
    c.header('Retry-After', String(retryAfter));
  }
}

async function enforceInMemoryRateLimit(
  c: Context<{ Bindings: Env }>,
  action: string
): Promise<void> {
  const config = RATE_LIMITS[action] || RATE_LIMITS['api:general'];
  const identifier = resolveRateLimitIdentifier(c);
  const key = `${action}:${identifier}`;

  if (Math.random() < 0.01) {
    cleanupExpiredEntries();
  }

  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (entry && entry.resetAt > now) {
    if (entry.count >= config.maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      applyRateLimitHeaders(c, 0, entry.resetAt, retryAfter);
      throw new RateLimitError(retryAfter);
    }
    entry.count++;
  } else {
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + config.windowMs,
    });
  }

  const currentEntry = rateLimitStore.get(key)!;
  applyRateLimitHeaders(c, config.maxRequests - currentEntry.count, currentEntry.resetAt);
}

/**
 * Rate limiting middleware factory (legacy in-memory — non-AI routes only).
 */
export function rateLimit(action: string) {
  if (AI_RATE_LIMIT_ACTIONS.has(action)) {
    throw new Error(`Use rateLimitDO('${action}') for AI/chat rate limits`);
  }

  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    await enforceInMemoryRateLimit(c, action);
    await next();
  };
}

/**
 * Rate limiter using Durable Objects (production).
 * Re-exported wrapper for existing callers (auth, companion, smart-engine).
 */
export async function checkRateLimitDO(
  env: Env,
  action: string,
  identifier: string
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const config = RATE_LIMITS[action] || RATE_LIMITS['api:general'];
  return checkRateLimitDOClient(env, `${action}:${identifier}`, config);
}

/**
 * Enforce DO-backed rate limit (shared by middleware and inline callers).
 * Fail-closed on DO errors — matches auth.ts bridge pattern.
 */
export async function enforceRateLimitDO(
  c: Context<{ Bindings: Env }>,
  action: string
): Promise<void> {
  if (AI_RATE_LIMIT_ACTIONS.has(action)) {
    if (await isAiRateLimitDeny(c.env)) {
      throw new ServiceUnavailableError('AI rate limiting is temporarily disabled');
    }
  }

  // Track B B3: AI/chat/coach always use the RATE_LIMITER DO (no in-memory escape hatch).
  // Non-AI callers of enforceRateLimitDO also use DO (fail-closed on DO errors).
  const identifier = resolveRateLimitIdentifier(c);
  const config = RATE_LIMITS[action] || RATE_LIMITS['api:general'];
  try {
    const result = await checkRateLimitDOClient(c.env, `${action}:${identifier}`, config);
    applyRateLimitHeaders(c, result.remaining, result.resetAt);
    if (!result.allowed) {
      const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
      c.header('Retry-After', String(retryAfter));
      throw new RateLimitError(retryAfter);
    }
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    if ((error as Error).name === 'ServiceUnavailableError') throw error;
    safeErrorLog('[rate-limit] RATE_LIMITER DO check failed:', (error as Error).message);
    throw new RateLimitError(60);
  }
}

/**
 * DO-backed rate limiting middleware for AI/chat/coach/aihousekeeper routes.
 */
export function rateLimitDO(action: string) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    await enforceRateLimitDO(c, action);
    await next();
  };
}
