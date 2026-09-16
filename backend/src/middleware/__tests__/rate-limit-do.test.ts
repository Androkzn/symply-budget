/**
 * rateLimitDO / enforceRateLimitDO — Track B B3
 */
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AI_RATE_LIMIT_DENY_KEY,
  AI_RATE_LIMIT_USE_DO_KEY,
} from '../../services/config-flags';
import type { Env } from '../../types';
import { RateLimitError } from '../../utils/errors';
import {
  AI_RATE_LIMIT_ACTIONS,
  enforceRateLimitDO,
  rateLimit,
  rateLimitDO,
  resolveRateLimitIdentifier,
} from '../rate-limit';
import * as doClient from '../rate-limit-do-client';

function mkKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  } as unknown as Env['CONFIG_KV'];
}

function mkEnv(kv?: Env['CONFIG_KV']): Env {
  return {
    CONFIG_KV: kv ?? mkKv(),
    RATE_LIMITER: {} as Env['RATE_LIMITER'],
  } as Env;
}

function mkApp(_env: Env, action: string, opts?: { userId?: string; householdId?: string }) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    if (opts?.userId) c.set('userId', opts.userId);
    await next();
  });
  const path = opts?.householdId
    ? `/households/${opts.householdId}/chat`
    : '/chat';
  app.post(path, rateLimitDO(action), (c) => c.json({ ok: true }));
  app.onError((error, c) => {
    const name = (error as Error).name;
    if (name === 'RateLimitError' || name === 'ServiceUnavailableError') {
      const apiError = error as RateLimitError & { statusCode: number; code: string; message: string };
      return c.json(
        { error: { code: apiError.code, message: apiError.message } },
        apiError.statusCode as 429 | 503
      );
    }
    throw error;
  });
  return app;
}

describe('rateLimitDO', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers all AI/chat/coach actions', () => {
    expect(AI_RATE_LIMIT_ACTIONS.has('chat:message')).toBe(true);
    expect(AI_RATE_LIMIT_ACTIONS.has('budget-chat:message')).toBe(true);
    expect(AI_RATE_LIMIT_ACTIONS.has('aihousekeeper:default')).toBe(true);
    expect(AI_RATE_LIMIT_ACTIONS.has('aihousekeeper:read')).toBe(true);
    expect(AI_RATE_LIMIT_ACTIONS.has('kaizen:ai')).toBe(true);
    expect(AI_RATE_LIMIT_ACTIONS.has('kaizen:coach')).toBe(true);
  });

  it('rejects AI actions on legacy rateLimit()', () => {
    expect(() => rateLimit('chat:message')).toThrow(/rateLimitDO/);
  });

  it('resolveRateLimitIdentifier prefers userId over householdId and IP', () => {
    const c = {
      get: (k: 'userId') => (k === 'userId' ? 'user-abc' : undefined),
      req: {
        param: () => 'hh-1',
        header: () => '1.2.3.4',
      },
    } as unknown as Parameters<typeof resolveRateLimitIdentifier>[0];
    expect(resolveRateLimitIdentifier(c)).toBe('user-abc');
  });

  it('resolveRateLimitIdentifier falls back to householdId', () => {
    const c = {
      get: () => undefined,
      req: {
        param: (k: string) => (k === 'householdId' ? 'hh-99' : undefined),
        header: () => '1.2.3.4',
      },
    } as unknown as Parameters<typeof resolveRateLimitIdentifier>[0];
    expect(resolveRateLimitIdentifier(c)).toBe('hh-99');
  });

  it('allows request when DO returns allowed', async () => {
    vi.spyOn(doClient, 'checkRateLimitDO').mockResolvedValue({
      allowed: true,
      remaining: 59,
      resetAt: Date.now() + 60_000,
    });

    const env = mkEnv();
    const app = mkApp(env, 'chat:message', { userId: 'user-1' });
    const res = await app.request('/chat', { method: 'POST' }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('59');
  });

  it('returns 429 when DO denies', async () => {
    const resetAt = Date.now() + 30_000;
    vi.spyOn(doClient, 'checkRateLimitDO').mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt,
    });

    const env = mkEnv();
    const app = mkApp(env, 'chat:message', { userId: 'user-1' });
    const res = await app.request('/chat', { method: 'POST' }, env);
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('rate_limited');
  });

  it('fail-closed with 429 when DO throws', async () => {
    vi.spyOn(doClient, 'checkRateLimitDO').mockRejectedValue(new Error('DO unavailable'));

    const env = mkEnv();
    const app = mkApp(env, 'kaizen:ai', { userId: 'user-1' });
    const res = await app.request('/chat', { method: 'POST' }, env);
    expect(res.status).toBe(429);
  });

  it('returns 503 when ai_rate_limit_deny is set', async () => {
    const env = mkEnv(mkKv({ [AI_RATE_LIMIT_DENY_KEY]: 'true' }));
    const doSpy = vi.spyOn(doClient, 'checkRateLimitDO');

    const app = mkApp(env, 'aihousekeeper:read', { userId: 'user-1', householdId: 'hh-1' });
    const res = await app.request('/households/hh-1/chat', { method: 'POST' }, env);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('service_unavailable');
    expect(doSpy).not.toHaveBeenCalled();
  });

  it('keys DO check by userId when authenticated', async () => {
    const env = mkEnv();
    const doSpy = vi.spyOn(doClient, 'checkRateLimitDO').mockResolvedValue({
      allowed: true,
      remaining: 10,
      resetAt: Date.now() + 60_000,
    });

    const app = mkApp(env, 'budget-chat:message', { userId: 'user-keyed' });
    await app.request('/chat', { method: 'POST' }, env);
    expect(doSpy).toHaveBeenCalledWith(
      env,
      'budget-chat:message:user-keyed',
      expect.objectContaining({ maxRequests: 60 })
    );
  });

  it('always uses DO even when ai_rate_limit_use_do is false (B3 cutover)', async () => {
    const env = mkEnv(mkKv({ [AI_RATE_LIMIT_USE_DO_KEY]: 'false' }));
    const doSpy = vi.spyOn(doClient, 'checkRateLimitDO').mockResolvedValue({
      allowed: true,
      remaining: 10,
      resetAt: Date.now() + 60_000,
    });

    const app = mkApp(env, 'chat:message', { userId: 'mem-user' });
    const res = await app.request('/chat', { method: 'POST' }, env);
    expect(res.status).toBe(200);
    expect(doSpy).toHaveBeenCalled();
  });

  it('enforceRateLimitDO uses DO by default when flag absent', async () => {
    const env = mkEnv();
    const doSpy = vi.spyOn(doClient, 'checkRateLimitDO').mockResolvedValue({
      allowed: true,
      remaining: 5,
      resetAt: Date.now() + 60_000,
    });

    const app = new Hono<{ Bindings: Env }>();
    app.post('/x', async (c) => {
      await enforceRateLimitDO(c, 'kaizen:coach');
      return c.json({ ok: true });
    });

    await app.request('/x', { method: 'POST' }, env);
    expect(doSpy).toHaveBeenCalled();
  });
});
