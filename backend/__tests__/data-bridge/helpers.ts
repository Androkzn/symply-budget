/**
 * Shared helpers for Data Bridge vitest suites (workerd pool).
 */
import * as jose from 'jose';

import type { Env } from '../../src/types';

export async function generatePlatformKeyPair(): Promise<{
  privateJwk: jose.JWK;
  publicKeysJson: string;
}> {
  const { privateKey, publicKey } = await jose.generateKeyPair('ES256', { extractable: true });
  const privateJwk = await jose.exportJWK(privateKey);
  const publicJwk = await jose.exportJWK(publicKey);
  privateJwk.kid = 'test-bridge-kid';
  privateJwk.alg = 'ES256';
  privateJwk.use = 'sig';
  publicJwk.kid = 'test-bridge-kid';
  publicJwk.alg = 'ES256';
  publicJwk.use = 'sig';
  return {
    privateJwk,
    publicKeysJson: JSON.stringify({ keys: [publicJwk] }),
  };
}

export function baseEnv(partial: Partial<Env> & { APP_BRAND: string }): Env {
  return {
    ENVIRONMENT: 'staging',
    JWT_SECRET: 'test-jwt-secret-32-chars-minimum!!',
    JWT_ISSUER: 'simple-house',
    JWT_AUDIENCE: 'simple-house-app',
    ACCESS_TOKEN_EXPIRY: '900',
    REFRESH_TOKEN_EXPIRY: '2592000',
    ...partial,
  } as Env;
}

export function apiErrorHandler() {
  return (error: Error, c: { json: (body: unknown, status: number) => Response }) => {
    const apiErrorNames = [
      'ApiError',
      'ValidationError',
      'UnauthorizedError',
      'ForbiddenError',
      'NotFoundError',
      'ConflictError',
      'RateLimitError',
    ];
    if (apiErrorNames.includes(error.name)) {
      const apiError = error as Error & {
        code: string;
        message: string;
        details?: unknown;
        statusCode: number;
      };
      return c.json(
        { error: { code: apiError.code, message: apiError.message, details: apiError.details } },
        apiError.statusCode
      );
    }
    return c.json({ error: { code: 'internal_error', message: error.message } }, 500);
  };
}

export async function createPlatformMirrorTables(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        email_verified INTEGER NOT NULL DEFAULT 0,
        role TEXT NOT NULL DEFAULT 'user',
        password_hash TEXT,
        apple_id TEXT,
        google_id TEXT,
        display_name TEXT,
        avatar_url TEXT,
        terms_accepted_at TEXT,
        has_completed_onboarding INTEGER NOT NULL DEFAULT 0,
        onboarding_household_created INTEGER NOT NULL DEFAULT 0,
        onboarding_report_added INTEGER NOT NULL DEFAULT 0,
        onboarding_garbage_setup INTEGER NOT NULL DEFAULT 0,
        onboarding_floor_plan_added INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT,
        updated_by TEXT,
        version INTEGER NOT NULL DEFAULT 1
      )`
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS platform_profile_mirrors (
        user_id TEXT NOT NULL,
        brand_id TEXT NOT NULL,
        profile_version INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, brand_id)
      )`
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS platform_bridge_control (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_by TEXT
      )`
    )
    .run();
}
