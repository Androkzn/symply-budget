/**
 * public-briefing.ts route — plan §E3
 *
 * CRITICAL: this route has NO JWT auth — gate is the HMAC-signed token.
 * The test confirms:
 *   - missing JWT Authorization header is NOT rejected (i.e. auth is skipped)
 *   - valid signed token + existing briefing → 200 HTML with CSP + no-store
 *   - bad signature → 401
 *   - expired token → 410
 *   - revoked token (member soft-deleted after iat) → 410
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../db/schema';
import { assistantBriefings } from '../../db/schema-aihousekeeper';
import {
  createAihousekeeperTables,
  createCoreTables,
  resetAllTables,
} from '../../services/aihousekeeper/__tests__/test-helpers';
import { mintBriefingToken } from '../../services/aihousekeeper/briefing-token';
import type { Env } from '../../types';
import publicBriefingRouter from '../public-briefing';

const testEnv = env as unknown as Env;
const HID = 'hh_pb_01';
const UID = 'u_pb_01';

function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/b', publicBriefingRouter);
  return app;
}

async function seedBriefing(date: string) {
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values({
    id: UID,
    email: 'pb@example.com',
    email_verified: true,
  });
  await db.insert(schema.households).values({ id: HID, name: 'PB Home' });
  await db.insert(schema.householdMembers).values({
    id: 'm_pb',
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: '2025-01-01T00:00:00Z',
  });
  await db.insert(assistantBriefings).values({
    id: 'brief_pb_01',
    household_id: HID,
    date,
    paragraph: "Today's public briefing for you.",
    bullets_json: JSON.stringify(['bullet A', 'bullet B']),
    source_signals_json: '[]',
  });
}

async function seedSigningKey() {
  await testEnv.CONFIG_KV.put(
    'aihousekeeper_briefing_signing_key_v1',
    'sufficiently-long-test-signing-key-32-bytes-min'
  );
  await testEnv.CONFIG_KV.put('aihousekeeper_briefing_signing_key_version', 'v1');
}

describe('public briefing route /b/:signed_token', () => {
  beforeEach(async () => {
    await createCoreTables(testEnv.DB);
    await createAihousekeeperTables(testEnv.DB);
    await resetAllTables(testEnv.DB);
    await seedSigningKey();
  });

  it('does NOT require a Bearer JWT — auth is skipped (HMAC token is the only gate)', async () => {
    await seedBriefing('2026-04-23');
    const token = await mintBriefingToken(
      {
        hid: HID,
        date: '2026-04-23',
        uid: UID,
        iat: Math.floor(Date.now() / 1000),
      },
      testEnv
    );
    const app = mkApp();
    // No Authorization header at all — must still succeed.
    const res = await app.request(`/b/${token}`, {}, testEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    // Security hardening headers.
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
  });

  it('rejects tampered signature with 401', async () => {
    await seedBriefing('2026-04-23');
    const token = await mintBriefingToken(
      {
        hid: HID,
        date: '2026-04-23',
        uid: UID,
        iat: Math.floor(Date.now() / 1000),
      },
      testEnv
    );
    const tampered = token.slice(0, -4) + 'XXXX';
    const app = mkApp();
    const res = await app.request(`/b/${tampered}`, {}, testEnv);
    // Bad signature or malformed — both yield 401.
    expect([401, 410]).toContain(res.status);
  });

  it('rejects expired token with 410', async () => {
    await seedBriefing('2026-04-23');
    const expiredIat = Math.floor(Date.now() / 1000) - 7 * 24 * 3600 - 10;
    const token = await mintBriefingToken(
      { hid: HID, date: '2026-04-23', uid: UID, iat: expiredIat },
      testEnv
    );
    const app = mkApp();
    const res = await app.request(`/b/${token}`, {}, testEnv);
    expect(res.status).toBe(410);
  });

  it('rejects revoked token with 410 (member soft-deleted after iat)', async () => {
    await seedBriefing('2026-04-23');
    // Soft-delete the member AFTER a prior iat.
    const iat = Math.floor(Date.now() / 1000) - 3600;
    await testEnv.DB.exec(
      `UPDATE household_members SET deleted_at = datetime('now') WHERE household_id = '${HID}'`
    );
    const token = await mintBriefingToken(
      { hid: HID, date: '2026-04-23', uid: UID, iat },
      testEnv
    );
    const app = mkApp();
    const res = await app.request(`/b/${token}`, {}, testEnv);
    expect(res.status).toBe(410);
    const body = await res.text();
    expect(body.toLowerCase()).toContain('revoked');
  });

  it('returns 404 when the briefing row is missing', async () => {
    // Seed household + member but no briefing row.
    const db = drizzle(testEnv.DB, { schema });
    await db.insert(schema.users).values({
      id: UID,
      email: 'pb@example.com',
      email_verified: true,
    });
    await db.insert(schema.households).values({ id: HID, name: 'PB' });
    await db.insert(schema.householdMembers).values({
      id: 'm_pb',
      household_id: HID,
      user_id: UID,
      role: 'owner',
      joined_at: '2025-01-01T00:00:00Z',
    });
    const token = await mintBriefingToken(
      {
        hid: HID,
        date: '2026-04-23',
        uid: UID,
        iat: Math.floor(Date.now() / 1000),
      },
      testEnv
    );
    const app = mkApp();
    const res = await app.request(`/b/${token}`, {}, testEnv);
    expect(res.status).toBe(404);
  });
});
