/**
 * Auth registration gate + companion + smart-engine fail-closed routes.
 */
import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { requireBrandCapability } from '../../src/middleware/brand-gate';
import authRoutes from '../../src/routes/auth';
import companionRoutes from '../../src/routes/companion';
import smartEngineRoutes from '../../src/routes/smart-engine';
import type { Env } from '../../src/types';

import { apiErrorHandler, createPlatformMirrorTables } from './helpers';

const testEnv = env as unknown as Env;

vi.mock('../../src/middleware/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/middleware/rate-limit')>();
  return {
    ...actual,
    checkRateLimitDO: vi.fn(async () => ({
      allowed: true,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    })),
    rateLimit: () => async (_c: unknown, next: () => Promise<void>) => next(),
    rateLimitDO: () => async (_c: unknown, next: () => Promise<void>) => next(),
  };
});

function mkAuthApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/auth', authRoutes);
  app.onError(apiErrorHandler() as never);
  return app;
}

function mkCompanionApp(brand: string) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    (c.env as { APP_BRAND: string }).APP_BRAND = brand;
    return next();
  });
  app.use('/companion/*', requireBrandCapability('platformAuthority'));
  app.route('/companion', companionRoutes);
  app.onError(apiErrorHandler() as never);
  return app;
}

function mkSmartApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/smart-engine', smartEngineRoutes);
  app.onError(apiErrorHandler() as never);
  return app;
}

async function mintHs256(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(testEnv.JWT_SECRET || 'test-jwt-secret-32-chars-minimum');
  return new jose.SignJWT({
    sub: userId,
    email: `${userId}@example.com`,
    email_verified: true,
  } as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .setIssuer(testEnv.JWT_ISSUER || 'simple-house')
    .setAudience(testEnv.JWT_AUDIENCE || 'simple-house-app')
    .sign(secret);
}

describe('POST /auth/register — registration open', () => {
  beforeEach(async () => {
    await createPlatformMirrorTables(testEnv.DB);
  });

  it('is no longer gated by platformRegistrationEnabled (no 403)', async () => {
    const app = mkAuthApp();
    const res = await app.request(
      '/auth/register',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'new-user@example.com',
          password: 'ValidPass123!',
          display_name: 'New',
        }),
      },
      testEnv
    );
    // Registration is open for all Symply apps — the bridge gate no longer blocks it.
    expect(res.status).not.toBe(403);
  });
});

describe('companion routes', () => {
  it('returns 404 on non-House brand', async () => {
    const app = mkCompanionApp('symply-budget');
    const res = await app.request('/companion/v1/tasks', { method: 'GET' }, {
      ...testEnv,
      APP_BRAND: 'symply-budget',
    });
    expect(res.status).toBe(404);
  });

  it('returns 401 on House without companion token', async () => {
    const app = mkCompanionApp('symply-house');
    const res = await app.request('/companion/v1/tasks', { method: 'GET' }, {
      ...testEnv,
      APP_BRAND: 'symply-house',
    });
    expect(res.status).toBe(401);
  });
});

describe('smart-engine fail-closed', () => {
  beforeEach(async () => {
    await createPlatformMirrorTables(testEnv.DB);
  });

  it('returns 401 without auth', async () => {
    const app = mkSmartApp();
    const res = await app.request('/smart-engine/packages', { method: 'GET' }, testEnv);
    expect(res.status).toBe(401);
  });

  it('returns 403 Soft Transfer disabled when authenticated', async () => {
    const token = await mintHs256('u_bridge_smart');
    const app = mkSmartApp();
    const res = await app.request(
      '/smart-engine/packages',
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      },
      { ...testEnv, APP_BRAND: 'symply-house' }
    );
    expect(res.status).toBe(403);
  });
});
