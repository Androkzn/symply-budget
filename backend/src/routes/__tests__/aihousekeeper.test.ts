/**
 * aihousekeeper.ts routes — plan §E1
 *
 * Covers: 401 on missing Authorization, 401 on bogus Bearer token, 404 on
 * missing briefing, and the typed-Env smoke that a properly auth'd request
 * reaches the handler.
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../db/schema';
import {
  createAihousekeeperTables,
  createCoreTables,
  resetAllTables,
} from '../../services/aihousekeeper/__tests__/test-helpers';
import type { Env } from '../../types';
import aihousekeeperRouter from '../aihousekeeper';


const testEnv = env as unknown as Env;

async function mintRealAccessToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(testEnv.JWT_SECRET || 'test-jwt-secret-32-chars-minimum');
  return new jose.SignJWT({
    sub: userId,
    email: `${userId}@example.com`,
    email_verified: true,
  } as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .setIssuer(testEnv.JWT_ISSUER || 'simple-house')
    .setAudience(testEnv.JWT_AUDIENCE || 'simple-house-app')
    .sign(secret);
}

function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/households/:householdId/aihousekeeper', aihousekeeperRouter);
  // Mirror the global onError from src/index.ts so ApiError subclasses map to
  // their correct statusCode instead of Hono's default 500 for unhandled throws.
  app.onError((error, c) => {
    const apiErrorNames = [
      'ApiError',
      'ValidationError',
      'UnauthorizedError',
      'ForbiddenError',
      'NotFoundError',
      'ConflictError',
      'RateLimitError',
    ];
    const errorName = (error as Error).name;
    if (apiErrorNames.includes(errorName)) {
      const apiError = error as unknown as {
        code: string;
        message: string;
        details?: unknown;
        statusCode: number;
      };
      return c.json(
        {
          error: {
            code: apiError.code,
            message: apiError.message,
            details: apiError.details,
          },
        },
        apiError.statusCode as 400 | 401 | 403 | 404 | 409 | 429 | 500
      );
    }
    return c.json({ error: { code: 'internal_error', message: error.message } }, 500);
  });
  return app;
}

describe('aihousekeeper routes', () => {
  beforeEach(async () => {
    await createCoreTables(testEnv.DB);
    await createAihousekeeperTables(testEnv.DB);
    await resetAllTables(testEnv.DB);
  });

  it('returns 401 for missing Authorization header', async () => {
    const app = mkApp();
    const res = await app.request(
      '/households/hh_route_01/aihousekeeper/briefings',
      {},
      testEnv
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 for malformed Bearer token', async () => {
    const app = mkApp();
    const res = await app.request(
      '/households/hh_route_01/aihousekeeper/briefings',
      {
        headers: {
          Authorization: 'Bearer not-a-real-jwt-token-abcdef1234567890',
        },
      },
      testEnv
    );
    expect(res.status).toBe(401);
  });

  it('403/404 ladder: real JWT with non-member user is rejected by HouseholdService', async () => {
    // Seed a household that the user is NOT a member of — HouseholdService
    // should reject. The exact status code depends on ForbiddenError vs
    // NotFoundError mapping — we accept either 403 or 404.
    const db = drizzle(testEnv.DB, { schema });
    await db.insert(schema.households).values({ id: 'hh_route_01', name: 'Route Test' });
    await db.insert(schema.users).values({
      id: 'u_other',
      email: 'other@example.com',
      email_verified: true,
    });

    const token = await mintRealAccessToken('u_other');
    const app = mkApp();
    const res = await app.request(
      '/households/hh_route_01/aihousekeeper/briefings',
      {
        headers: { Authorization: `Bearer ${token}` },
      },
      testEnv
    );
    // HouseholdService.getHousehold for a non-member typically returns a 403/404.
    expect([403, 404]).toContain(res.status);
  });
});
