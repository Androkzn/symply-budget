/**
 * settings.ts — regression guard.
 *
 * The route layer passes the raw D1 binding; the service/controller wrap Drizzle
 * internally. Passing an unwrapped binding to query builders throws
 * "db.select is not a function" → 500.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import settingsRouter from '../settings';

const testEnv = env as unknown as Env;
const UID = 'u_settings_owner';

async function mintToken(userId: string): Promise<string> {
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

// Mirrors migrations/0018_settings_table.sql (the shared core-table helper
// doesn't know about `schema-settings.ts`).
async function createSettingsTable(): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      household_id TEXT,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS settings_user_household_key_idx ON settings(user_id, household_id, key)`,
  ];
  for (const sql of statements) {
    await testEnv.DB.exec(sql.replace(/\s+/g, ' ').trim());
  }
}

function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/api/settings', settingsRouter);
  return app;
}

describe('settings routes', () => {
  beforeEach(async () => {
    await createSettingsTable();
    await testEnv.DB.exec('DELETE FROM settings');
  });

  it('PUT /api/settings/bulk upserts settings and returns success', async () => {
    const token = await mintToken(UID);
    const res = await mkApp().request(
      '/api/settings/bulk',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ settings: [{ key: 'garden.measurementUnit', value: 'meters' }] }),
      },
      testEnv
    );

    // Raw-D1 regression would 500 here with "db.select is not a function".
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it('GET /api/settings returns the persisted setting', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    await app.request(
      '/api/settings/bulk',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ settings: [{ key: 'garden.measurementUnit', value: 'meters' }] }),
      },
      testEnv
    );

    const res = await app.request('/api/settings', { headers: { Authorization: `Bearer ${token}` } }, testEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { settings: Array<{ key: string; value: string }> };
    expect(body.settings.find((s) => s.key === 'garden.measurementUnit')?.value).toBe('meters');
  });
});
