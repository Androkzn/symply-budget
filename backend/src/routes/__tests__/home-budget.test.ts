/**
 * home-budget.ts routes — Symply House's lightweight money glance (the full
 * product lives on the Budget Worker). Two GETs, both delegating to
 * BudgetService.getMonthlyOverview:
 *   - /monthly-overview returns the same shape as the Budget Worker
 *   - /glance projects it to {remaining, planned, spent}, with planned = null
 *     when no cap is set (plannedBudget 0)
 * Plus auth (401), household membership (403) and query validation (400).
 */
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../db/schema';
import { budgetGoals, expenses } from '../../db/schema-budget';
import { createCoreTables, resetAllTables } from '../../services/aihousekeeper/__tests__/test-helpers';
import type { Env } from '../../types';
import homeBudgetRouter from '../home-budget';

import { createBudgetTables, resetBudgetTables } from './budget-test-helpers';

const testEnv = env as unknown as Env;

const HID = 'hh_home_budget_01';
const UID = 'u_home_budget_owner';
const MID = 'm_home_budget_owner';
const OTHER_UID = 'u_home_budget_outsider';

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
  app.route('/households/:householdId/home-budget', homeBudgetRouter);
  app.onError((error, c) => {
    const apiErrorNames = ['ApiError', 'ValidationError', 'UnauthorizedError', 'ForbiddenError', 'NotFoundError'];
    const e = error as unknown as { name: string; code?: string; message: string; statusCode?: number };
    if (apiErrorNames.includes(e.name)) {
      return c.json({ error: { code: e.code, message: e.message } }, (e.statusCode ?? 500) as 400 | 401 | 403 | 404 | 500);
    }
    return c.json({ error: { code: 'internal_error', message: error.message } }, 500);
  });
  return app;
}

async function seed(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createBudgetTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetBudgetTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values([
    { id: UID, email: 'home-budget@example.com', email_verified: true },
    { id: OTHER_UID, email: 'home-budget-out@example.com', email_verified: true },
  ]);
  await db.insert(schema.households).values({ id: HID, name: 'HomeBudgetTest' });
  await db.insert(schema.householdMembers).values({
    id: MID,
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: '2025-01-01T00:00:00Z',
  });
}

async function setGoal(planned: number): Promise<void> {
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(budgetGoals).values({
    id: `g_${HID}_2026_6`,
    household_id: HID,
    year: 2026,
    month: 6,
    planned_budget: planned,
  });
}

async function addExpense(amount: number): Promise<void> {
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(expenses).values({
    id: `e_${amount}_${Math.trunc(amount)}`,
    household_id: HID,
    title: 'Groceries',
    amount,
    expense_date: '2026-06-12',
    created_by: UID,
  });
}

describe('home-budget routes', () => {
  beforeEach(seed);

  describe('GET /monthly-overview', () => {
    it('returns the full monthly overview with the set plan', async () => {
      await setGoal(100000);
      const token = await mintToken(UID);
      const res = await mkApp().request(
        `/households/${HID}/home-budget/monthly-overview?year=2026&month=6`,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { plannedBudget: number; remainingBudget: number };
      expect(body.plannedBudget).toBe(100000);
      expect(body.remainingBudget).toBe(100000);
    });

    it('rejects an out-of-range month with 400', async () => {
      const token = await mintToken(UID);
      const res = await mkApp().request(
        `/households/${HID}/home-budget/monthly-overview?year=2026&month=13`,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv,
      );
      expect(res.status).toBe(400);
    });
  });

  describe('GET /glance', () => {
    it('projects remaining/planned/spent from the overview', async () => {
      await setGoal(100000);
      await addExpense(30000);
      const token = await mintToken(UID);
      const res = await mkApp().request(
        `/households/${HID}/home-budget/glance?year=2026&month=6`,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        year: number;
        month: number;
        remaining: number;
        planned: number | null;
        spent: number;
      };
      expect(body).toEqual({ year: 2026, month: 6, remaining: 70000, planned: 100000, spent: 30000 });
    });

    it('returns planned = null when no budget cap is set', async () => {
      const token = await mintToken(UID);
      const res = await mkApp().request(
        `/households/${HID}/home-budget/glance?year=2026&month=6`,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { planned: number | null; spent: number };
      expect(body.planned).toBeNull();
      expect(body.spent).toBe(0);
    });
  });

  describe('auth', () => {
    it('returns 401 without a token', async () => {
      const res = await mkApp().request(
        `/households/${HID}/home-budget/glance?year=2026&month=6`,
        {},
        testEnv,
      );
      expect(res.status).toBe(401);
    });

    it('returns 403 for a user outside the household', async () => {
      const token = await mintToken(OTHER_UID);
      const res = await mkApp().request(
        `/households/${HID}/home-budget/glance?year=2026&month=6`,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv,
      );
      expect(res.status).toBe(403);
    });
  });
});
