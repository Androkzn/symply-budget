/**
 * households.ts — the "real purchase price" fields (migration 0083).
 *
 * PATCH /households/:id accepts `purchase_price` (cents) + `purchase_date`
 * (YYYY-MM-DD), persists them on the household, echoes them back on the
 * response, and can clear them with null. Invalid dates are rejected by the
 * zod schema. Vitest + `@cloudflare/vitest-pool-workers` (Miniflare D1).
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../db/schema';
import { createCoreTables, resetAllTables } from '../../services/aihousekeeper/__tests__/test-helpers';
import type { Env } from '../../types';
import householdRouter from '../households';

const testEnv = env as unknown as Env;

const HID = 'hh_purchase_01';
const UID = 'u_purchase_owner';
const MID = 'm_purchase_owner';

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

function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/households', householdRouter);
  app.onError((error, c) => {
    const apiError = error as unknown as { code?: string; message: string; statusCode?: number };
    return c.json(
      { error: { code: apiError.code ?? 'internal_error', message: apiError.message } },
      (apiError.statusCode as 400 | 401 | 403 | 404 | 500) ?? 500
    );
  });
  return app;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

type HouseholdResp = {
  household: { purchase_price: number | null; purchase_date: string | null };
};

async function seed(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await resetAllTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values({ id: UID, email: 'purchase@example.com', email_verified: true });
  await db.insert(schema.households).values({ id: HID, name: 'PurchaseTest' });
  await db.insert(schema.householdMembers).values({
    id: MID,
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: '2025-01-01T00:00:00Z',
  });
}

function patch(token: string, app: ReturnType<typeof mkApp>, body: unknown) {
  return app.request(
    `/households/${HID}`,
    { method: 'PATCH', headers: authHeaders(token), body: JSON.stringify(body) },
    testEnv
  );
}

describe('households purchase price', () => {
  beforeEach(async () => {
    await seed();
  });

  it('persists purchase_price + purchase_date and echoes them back', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    const res = await patch(token, app, { purchase_price: 122000000, purchase_date: '2025-06-12' });
    expect(res.status).toBe(200);
    const { household } = (await res.json()) as HouseholdResp;
    expect(household.purchase_price).toBe(122000000);
    expect(household.purchase_date).toBe('2025-06-12');

    // Persisted: a fresh GET returns the same values.
    const getRes = await app.request(`/households/${HID}`, { headers: authHeaders(token) }, testEnv);
    const fetched = (await getRes.json()) as HouseholdResp;
    expect(fetched.household.purchase_price).toBe(122000000);
    expect(fetched.household.purchase_date).toBe('2025-06-12');
  });

  it('clears the fields when passed null', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    await patch(token, app, { purchase_price: 122000000, purchase_date: '2025-06-12' });
    const res = await patch(token, app, { purchase_price: null, purchase_date: null });
    expect(res.status).toBe(200);
    const { household } = (await res.json()) as HouseholdResp;
    expect(household.purchase_price).toBeNull();
    expect(household.purchase_date).toBeNull();
  });

  it('rejects a malformed purchase_date', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    const res = await patch(token, app, { purchase_date: '06/12/2025' });
    expect(res.status).toBe(400);
  });

  it('rejects a negative purchase_price', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    const res = await patch(token, app, { purchase_price: -5 });
    expect(res.status).toBe(400);
  });

  it('leaves other fields untouched when only purchase fields change', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    const res = await patch(token, app, { purchase_price: 500000 });
    expect(res.status).toBe(200);
    const { household } = (await res.json()) as HouseholdResp & { household: { purchase_date: string | null } };
    expect(household.purchase_price).toBe(500000);
    expect(household.purchase_date).toBeNull();
  });
});
