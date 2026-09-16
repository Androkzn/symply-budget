/**
 * House platform authority routes + assertHouseOnly.
 */
import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import authPlatformRoutes from '../../src/routes/auth-platform';
import { assertHouseOnly } from '../../src/services/deletion-saga-service';
import type { Env } from '../../src/types';
import { ForbiddenError } from '../../src/utils/errors';

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
  };
});

function mkApp(brand = 'symply-house') {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    (c.env as { APP_BRAND: string }).APP_BRAND = brand;
    return next();
  });
  app.route('/auth/platform', authPlatformRoutes);
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

describe('assertHouseOnly', () => {
  it('allows House', () => {
    expect(() => assertHouseOnly({ APP_BRAND: 'symply-house' } as Env)).not.toThrow();
  });

  it('forbids Budget/Kaizen/Health', () => {
    for (const brand of ['symply-budget', 'symply-kaizen', 'symply-health'] as const) {
      expect(() => assertHouseOnly({ APP_BRAND: brand } as Env)).toThrow(ForbiddenError);
    }
  });
});

describe('auth/platform routes', () => {
  beforeEach(async () => {
    await createPlatformMirrorTables(testEnv.DB);
  });

  it('rejects Budget brand at House-only gate', async () => {
    const app = mkApp('symply-budget');
    const res = await app.request(
      '/auth/platform/me',
      { method: 'GET', headers: { Authorization: `Bearer ${await mintHs256('u1')}` } },
      { ...testEnv, APP_BRAND: 'symply-budget' }
    );
    expect(res.status).toBe(403);
  });

  it('returns 401 for /me without auth on House', async () => {
    const app = mkApp('symply-house');
    const res = await app.request('/auth/platform/me', { method: 'GET' }, {
      ...testEnv,
      APP_BRAND: 'symply-house',
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 for companion mint without auth', async () => {
    const app = mkApp('symply-house');
    const res = await app.request(
      '/auth/platform/companion',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ household_id: 'hh_1' }),
      },
      { ...testEnv, APP_BRAND: 'symply-house' }
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown deletion status secret', async () => {
    // Table may be missing in minimal schema — create if needed.
    await testEnv.DB.prepare(
      `CREATE TABLE IF NOT EXISTS platform_deletion_requests (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        idempotency_fingerprint TEXT NOT NULL,
        status_secret_hash TEXT NOT NULL,
        pepper_version TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        terminal_at TEXT
      )`
    ).run();
    const app = mkApp('symply-house');
    const secret = 's'.repeat(32);
    const res = await app.request(
      '/auth/platform/deletion-status',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status_secret: secret }),
      },
      { ...testEnv, APP_BRAND: 'symply-house' }
    );
    expect(res.status).toBe(404);
  });
});
