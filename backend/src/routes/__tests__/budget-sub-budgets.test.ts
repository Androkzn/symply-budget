/**
 * budget.ts sub-budget routes — GET/PUT/DELETE /budget/sub-budgets.
 *
 * Covers upsert (amount + percent), the resolved GET payload (progress + totals
 * + raw rows), delete-by-scope, validation (400), and household scoping (403/401).
 */
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../db/schema';
import { budgetCategories } from '../../db/schema-budget';
import type { SubBudget } from '../../db/schema-budget';
import { createCoreTables, resetAllTables } from '../../services/aihousekeeper/__tests__/test-helpers';
import type { SubBudgetProgress } from '../../services/budget-service';
import type { Env } from '../../types';
import budgetRouter from '../budget';

import { applyBudgetWorkerTestBrand, createBudgetTables, resetBudgetTables } from './budget-test-helpers';


const testEnv = env as unknown as Env;

const HID = 'hh_sub_routes';
const UID = 'u_sub_routes_owner';
const MID = 'm_sub_routes_owner';
const OTHER_UID = 'u_sub_routes_outsider';
const OTHER_HID = 'hh_sub_routes_other';
const OTHER_MID = 'm_sub_routes_outsider';
// Category ids must be UUIDs (route validates z.string().uuid()).
const CAT_ALCOHOL = '11111111-1111-4111-8111-111111111111';

async function mintToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(testEnv.JWT_SECRET || 'test-jwt-secret-32-chars-minimum');
  return new jose.SignJWT({ sub: userId, email: `${userId}@example.com`, email_verified: true } as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .setIssuer(testEnv.JWT_ISSUER || 'simple-house')
    .setAudience(testEnv.JWT_AUDIENCE || 'simple-house-app')
    .sign(secret);
}

function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/households/:householdId/budget', budgetRouter);
  app.onError((error, c) => {
    const named = ['ApiError', 'ValidationError', 'UnauthorizedError', 'ForbiddenError', 'NotFoundError', 'ConflictError', 'RateLimitError'];
    if (named.includes((error as Error).name)) {
      const e = error as unknown as { code: string; message: string; statusCode: number };
      return c.json({ error: { code: e.code, message: e.message } }, e.statusCode as 400 | 401 | 403 | 404);
    }
    return c.json({ error: { code: 'internal_error', message: (error as Error).message } }, 500);
  });
  return app;
}

async function seed(): Promise<void> {
  applyBudgetWorkerTestBrand(testEnv);
  await createCoreTables(testEnv.DB);
  await createBudgetTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetBudgetTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values([
    { id: UID, email: 'sub-routes@example.com', email_verified: true },
    { id: OTHER_UID, email: 'sub-outsider@example.com', email_verified: true },
  ]);
  await db.insert(schema.households).values([
    { id: HID, name: 'SubRoutes' },
    { id: OTHER_HID, name: 'SubRoutesOther' },
  ]);
  await db.insert(schema.householdMembers).values([
    { id: MID, household_id: HID, user_id: UID, role: 'owner', joined_at: '2025-01-01T00:00:00Z' },
    { id: OTHER_MID, household_id: OTHER_HID, user_id: OTHER_UID, role: 'owner', joined_at: '2025-01-01T00:00:00Z' },
  ]);
  await db.insert(budgetCategories).values([{ id: CAT_ALCOHOL, household_id: HID, name: 'Alcohol & Bars' }]);
}

function put(app: ReturnType<typeof mkApp>, token: string, body: unknown) {
  return app.request(
    `/households/${HID}/budget/sub-budgets`,
    { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    testEnv
  );
}

describe('sub-budget routes', () => {
  beforeEach(seed);

  it('upserts a fixed-amount cap and returns it via GET with resolved spend', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    // Set the month total so percent maths + over-allocation have a base.
    await app.request(
      `/households/${HID}/budget/goals/2026/7`,
      { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ planned_budget: 100000 }) },
      testEnv
    );

    const putRes = await put(app, token, {
      category_id: CAT_ALCOHOL, year: 2026, month: null, limit_type: 'amount', amount_cents: 10000,
    });
    expect(putRes.status).toBe(200);

    const getRes = await app.request(
      `/households/${HID}/budget/sub-budgets?year=2026&month=7`,
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as {
      subBudgets: SubBudgetProgress[];
      totals: { totalCapCents: number; plannedBudget: number; overAllocatedBy: number };
      rows: SubBudget[];
    };
    expect(body.subBudgets).toHaveLength(1);
    expect(body.subBudgets[0]).toMatchObject({ category_id: CAT_ALCOHOL, cap_cents: 10000, scope: 'default' });
    expect(body.totals).toMatchObject({ totalCapCents: 10000, plannedBudget: 100000, overAllocatedBy: 0 });
    expect(body.rows).toHaveLength(1);
  });

  it('accepts a percent cap and resolves it against the month total', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    await app.request(
      `/households/${HID}/budget/goals/2026/7`,
      { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ planned_budget: 120000 }) },
      testEnv
    );
    await put(app, token, { category_id: CAT_ALCOHOL, year: 2026, month: null, limit_type: 'percent', percent_bps: 1000 });

    const getRes = await app.request(
      `/households/${HID}/budget/sub-budgets?year=2026&month=7`,
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    const body = (await getRes.json()) as { subBudgets: SubBudgetProgress[] };
    // 10% of $1,200 = $120.
    expect(body.subBudgets[0]).toMatchObject({ limit_type: 'percent', cap_cents: 12000 });
  });

  it('deletes a cap by scope', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    await put(app, token, { category_id: CAT_ALCOHOL, year: 2026, month: null, limit_type: 'amount', amount_cents: 10000 });

    const delRes = await app.request(
      `/households/${HID}/budget/sub-budgets`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ category_id: CAT_ALCOHOL, year: 2026, month: null }) },
      testEnv
    );
    expect(delRes.status).toBe(200);

    const getRes = await app.request(
      `/households/${HID}/budget/sub-budgets?year=2026&month=7`,
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    const body = (await getRes.json()) as { subBudgets: SubBudgetProgress[] };
    expect(body.subBudgets).toHaveLength(0);
  });

  it('rejects a percent over 100% with 400', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const res = await put(app, token, { category_id: CAT_ALCOHOL, year: 2026, month: null, limit_type: 'percent', percent_bps: 20000 });
    expect(res.status).toBe(400);
  });

  it('returns 403 for a user outside the household', async () => {
    const token = await mintToken(OTHER_UID);
    const app = mkApp();
    const res = await put(app, token, { category_id: CAT_ALCOHOL, year: 2026, month: null, limit_type: 'amount', amount_cents: 10000 });
    expect(res.status).toBe(403);
  });

  it('returns 401 for an unauthenticated request', async () => {
    const app = mkApp();
    const res = await app.request(`/households/${HID}/budget/sub-budgets?year=2026&month=7`, {}, testEnv);
    expect(res.status).toBe(401);
  });

  it('returns an empty, well-formed payload when no caps are set (no 500)', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(
      `/households/${HID}/budget/sub-budgets?year=2026&month=7`,
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      subBudgets: SubBudgetProgress[];
      totals: { totalCapCents: number; overAllocatedBy: number };
      rows: SubBudget[];
    };
    expect(body.subBudgets).toEqual([]);
    expect(body.rows).toEqual([]);
    expect(body.totals).toMatchObject({ totalCapCents: 0, overAllocatedBy: 0 });
  });

  it('REGRESSION: the monthly-overview endpoint embeds subBudgets and never 500s (the "same data every month" bug)', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    await app.request(
      `/households/${HID}/budget/goals/2026/7`,
      { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ planned_budget: 100000 }) },
      testEnv
    );
    await put(app, token, { category_id: CAT_ALCOHOL, year: 2026, month: null, limit_type: 'percent', percent_bps: 1000 });

    const res = await app.request(
      `/households/${HID}/budget/monthly-overview?year=2026&month=7`,
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subBudgets: { entries: SubBudgetProgress[]; totalCapCents: number } };
    expect(body.subBudgets.entries).toHaveLength(1);
    expect(body.subBudgets.entries[0]).toMatchObject({ category_id: CAT_ALCOHOL, cap_cents: 10000 });
  });

  it('rejects a missing year/month query with 400', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(
      `/households/${HID}/budget/sub-budgets`,
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    expect(res.status).toBe(400);
  });

  it('rejects a non-uuid category_id with 400', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const res = await put(app, token, { category_id: 'not-a-uuid', year: 2026, month: null, limit_type: 'amount', amount_cents: 10000 });
    expect(res.status).toBe(400);
  });

  it('rejects an out-of-range month override with 400', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const res = await put(app, token, { category_id: CAT_ALCOHOL, year: 2026, month: 13, limit_type: 'amount', amount_cents: 10000 });
    expect(res.status).toBe(400);
  });
});
