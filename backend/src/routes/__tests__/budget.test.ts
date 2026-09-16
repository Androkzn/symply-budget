/**
 * budget.ts routes — monthly goal CRUD, monthly overview, category CRUD.
 *
 * Covers:
 *   - GET /goals/:year/:month auto-creates a default (unset) goal
 *   - PUT /goals/:year/:month persists planned_budget
 *   - GET /monthly-overview with zero items
 *   - GET /monthly-overview excludes cancelled items from committed total
 *     and ranks the affordability lists
 *   - POST/PATCH/DELETE /categories
 *   - 403 for a user outside the household
 *   - 401 for an unauthenticated request
 *   - 400 for a negative planned_budget
 */

import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../db/schema';
import { budgetCategories, budgetItems } from '../../db/schema-budget';
import {
  createCoreTables,
  resetAllTables,
} from '../../services/aihousekeeper/__tests__/test-helpers';
import type { Env } from '../../types';
import budgetRouter from '../budget';

import {
  applyBudgetWorkerTestBrand,
  createBudgetTables,
  resetBudgetTables,
} from './budget-test-helpers';

const testEnv = env as unknown as Env;

const HID = 'hh_budget_routes_01';
const UID = 'u_budget_routes_owner';
const MID = 'm_budget_routes_owner';

const OTHER_HID = 'hh_budget_routes_other';
const OTHER_UID = 'u_budget_routes_outsider';
const OTHER_MID = 'm_budget_routes_outsider';

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
  app.route('/households/:householdId/budget', budgetRouter);
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
        { error: { code: apiError.code, message: apiError.message, details: apiError.details } },
        apiError.statusCode as 400 | 401 | 403 | 404 | 409 | 429 | 500
      );
    }
    return c.json({ error: { code: 'internal_error', message: error.message } }, 500);
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
    { id: UID, email: 'budget-routes@example.com', email_verified: true },
    { id: OTHER_UID, email: 'budget-outsider@example.com', email_verified: true },
  ]);
  await db.insert(schema.households).values([
    { id: HID, name: 'BudgetRoutesTest' },
    { id: OTHER_HID, name: 'BudgetRoutesOther' },
  ]);
  await db.insert(schema.householdMembers).values([
    { id: MID, household_id: HID, user_id: UID, role: 'owner', joined_at: '2025-01-01T00:00:00Z' },
    {
      id: OTHER_MID,
      household_id: OTHER_HID,
      user_id: OTHER_UID,
      role: 'owner',
      joined_at: '2025-01-01T00:00:00Z',
    },
  ]);
}

describe('budget routes', () => {
  beforeEach(seed);

  describe('GET/PUT /goals/:year/:month', () => {
    it('auto-creates a default (unset) goal when none exists', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      const res = await app.request(
        `/households/${HID}/budget/goals/2026/6`,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { goal: { planned_budget: number | null; year: number; month: number } };
      expect(body.goal.planned_budget).toBeNull();
      expect(body.goal.year).toBe(2026);
      expect(body.goal.month).toBe(6);
    });

    it('persists planned_budget', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      const res = await app.request(
        `/households/${HID}/budget/goals/2026/6`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ planned_budget: 50000 }),
        },
        testEnv
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { goal: { planned_budget: number } };
      expect(body.goal.planned_budget).toBe(50000);

      // Re-fetching should return the same value, not a freshly defaulted row.
      const res2 = await app.request(
        `/households/${HID}/budget/goals/2026/6`,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv
      );
      const body2 = (await res2.json()) as { goal: { planned_budget: number } };
      expect(body2.goal.planned_budget).toBe(50000);
    });

    it('rejects a negative planned_budget with 400', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      const res = await app.request(
        `/households/${HID}/budget/goals/2026/6`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ planned_budget: -100 }),
        },
        testEnv
      );
      expect(res.status).toBe(400);
    });

    it('returns 403 for a user outside the household', async () => {
      const token = await mintToken(OTHER_UID);
      const app = mkApp();
      const res = await app.request(
        `/households/${HID}/budget/goals/2026/6`,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv
      );
      expect(res.status).toBe(403);
    });

    it('returns 401 for an unauthenticated request', async () => {
      const app = mkApp();
      const res = await app.request(`/households/${HID}/budget/goals/2026/6`, {}, testEnv);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /monthly-overview', () => {
    it('returns remaining balance equal to the plan when there are no items', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      await app.request(
        `/households/${HID}/budget/goals/2026/6`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ planned_budget: 100000 }),
        },
        testEnv
      );

      const res = await app.request(
        `/households/${HID}/budget/monthly-overview?year=2026&month=6`,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        plannedBudget: number;
        remainingBudget: number;
        itemCount: number;
      };
      expect(body.plannedBudget).toBe(100000);
      expect(body.remainingBudget).toBe(100000);
      expect(body.itemCount).toBe(0);
    });

    it('pools the calendar quarter into quarterAffordability and ranks cross-month items', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      // Only June is set; April & May inherit the average of set months
      // (100000), so the Q2 pool is 3 × 100000 = 300000.
      await app.request(
        `/households/${HID}/budget/goals/2026/6`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ planned_budget: 100000 }),
        },
        testEnv
      );

      // A planned item dated in MAY — in the quarter but not the viewed month.
      const db = drizzle(testEnv.DB, { schema: { budgetItems } });
      const now = new Date().toISOString();
      await db.insert(budgetItems).values([
        {
          id: 'bi-q-may',
          household_id: HID,
          timeframe: 'immediate',
          title: 'May gutter cleaning',
          estimated_cost_min: 150000,
          estimated_cost_max: 150000,
          priority: 'high',
          status: 'planned',
          target_date: '2026-05-10',
          created_at: now,
          updated_at: now,
        },
      ]);

      const res = await app.request(
        `/households/${HID}/budget/monthly-overview?year=2026&month=6`,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        affordability: { affordable: Array<{ id: string }>; deferred: Array<{ id: string }> };
        quarterAffordability: {
          remaining_budget: number;
          affordable: Array<{ id: string }>;
          deferred: Array<{ id: string }>;
        };
      };

      // Quarter pools all three months and sees the May item; it fits the 300000 pool.
      expect(body.quarterAffordability.remaining_budget).toBe(300000);
      const inQuarter = [
        ...body.quarterAffordability.affordable,
        ...body.quarterAffordability.deferred,
      ].map((i) => i.id);
      expect(inQuarter).toContain('bi-q-may');

      // The month window (June) does NOT see a May-dated item.
      const inMonth = [...body.affordability.affordable, ...body.affordability.deferred].map(
        (i) => i.id
      );
      expect(inMonth).not.toContain('bi-q-may');
    });

    it('pools next month into nextMonthAffordability with the inherited cap', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      // June set to 80000; July inherits the average (80000) since it's unset.
      await app.request(
        `/households/${HID}/budget/goals/2026/6`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ planned_budget: 80000 }),
        },
        testEnv
      );

      const db = drizzle(testEnv.DB, { schema: { budgetItems } });
      const now = new Date().toISOString();
      await db.insert(budgetItems).values([
        {
          id: 'bi-jul-item',
          household_id: HID,
          timeframe: 'immediate',
          title: 'July fan install',
          estimated_cost_min: 50000,
          estimated_cost_max: 50000,
          priority: 'high',
          status: 'planned',
          target_date: '2026-07-12',
          created_at: now,
          updated_at: now,
        },
      ]);

      const res = await app.request(
        `/households/${HID}/budget/monthly-overview?year=2026&month=6`,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        nextMonthAffordability: {
          remaining_budget: number;
          affordable: Array<{ id: string }>;
          deferred: Array<{ id: string }>;
        };
      };

      // July inherits June's 80000 cap; the July item is ranked in next month.
      expect(body.nextMonthAffordability.remaining_budget).toBe(80000);
      const inNextMonth = [
        ...body.nextMonthAffordability.affordable,
        ...body.nextMonthAffordability.deferred,
      ].map((i) => i.id);
      expect(inNextMonth).toContain('bi-jul-item');
    });

    it('excludes cancelled items from the committed total and ranks affordability', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      await app.request(
        `/households/${HID}/budget/goals/2026/6`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ planned_budget: 50000 }),
        },
        testEnv
      );

      const db = drizzle(testEnv.DB, { schema: { budgetItems } });
      const now = new Date().toISOString();
      const targetDate = '2026-06-15';
      await db.insert(budgetItems).values([
        {
          id: 'bi-critical',
          household_id: HID,
          timeframe: 'immediate',
          title: 'Critical repair',
          estimated_cost_min: 20000,
          estimated_cost_max: 20000,
          priority: 'critical',
          status: 'planned',
          target_date: targetDate,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'bi-low',
          household_id: HID,
          timeframe: 'immediate',
          title: 'Nice to have',
          estimated_cost_min: 40000,
          estimated_cost_max: 40000,
          priority: 'low',
          status: 'planned',
          target_date: targetDate,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'bi-underway',
          household_id: HID,
          timeframe: 'immediate',
          title: 'Already started',
          estimated_cost_min: 5000,
          estimated_cost_max: 5000,
          priority: 'high',
          status: 'in_progress',
          target_date: targetDate,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'bi-cancelled',
          household_id: HID,
          timeframe: 'immediate',
          title: 'Cancelled item',
          estimated_cost_min: 100000,
          estimated_cost_max: 100000,
          priority: 'high',
          status: 'cancelled',
          target_date: targetDate,
          created_at: now,
          updated_at: now,
        },
      ]);

      const res = await app.request(
        `/households/${HID}/budget/monthly-overview?year=2026&month=6`,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        committedTotal: number;
        remainingBudget: number;
        itemCount: number;
        expenses: unknown[];
        affordability: {
          affordable: Array<{ id: string }>;
          deferred: Array<{ id: string }>;
        };
      };

      // Only the in_progress item (5000) is "locked in" — cancelled and the
      // still-undecided planned items are not subtracted up front.
      expect(body.committedTotal).toBe(5000);
      expect(body.remainingBudget).toBe(45000); // 50000 - 0 - 5000
      expect(body.itemCount).toBe(3);
      expect(body.expenses).toEqual([]);
      // Critical item (20000) fits the 45000 remaining; the cheaper-priority
      // item (40000) doesn't fit what's left after it, so it's deferred. The
      // in_progress and cancelled items never enter either list — they're
      // already decided / not happening, not candidates to rank.
      expect(body.affordability.affordable.map((i) => i.id)).toEqual(['bi-critical']);
      expect(body.affordability.deferred.map((i) => i.id)).toEqual(['bi-low']);
      expect(body.affordability.affordable.map((i) => i.id)).not.toContain('bi-cancelled');
      expect(body.affordability.affordable.map((i) => i.id)).not.toContain('bi-underway');
      expect(body.affordability.deferred.map((i) => i.id)).not.toContain('bi-cancelled');
    });

    it('includes expenses in actualSpent and excludes completed planned items from the list', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      await app.request(
        `/households/${HID}/budget/goals/2026/6`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ planned_budget: 50000 }),
        },
        testEnv
      );

      const db = drizzle(testEnv.DB, { schema: { budgetItems } });
      const now = new Date().toISOString();
      await db.insert(budgetItems).values([
        {
          id: 'bi-open',
          household_id: HID,
          timeframe: 'immediate',
          title: 'Still planned',
          estimated_cost_min: 10000,
          estimated_cost_max: 10000,
          priority: 'medium',
          status: 'planned',
          target_date: '2026-06-10',
          created_at: now,
          updated_at: now,
        },
        {
          id: 'bi-done',
          household_id: HID,
          timeframe: 'immediate',
          title: 'Already spent plan',
          estimated_cost_min: 8000,
          estimated_cost_max: 8000,
          priority: 'high',
          status: 'completed',
          target_date: '2026-06-12',
          created_at: now,
          updated_at: now,
        },
      ]);

      const expenseRes = await app.request(
        `/households/${HID}/budget/expenses`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Groceries',
            amount: 7500,
            expense_date: '2026-06-05',
          }),
        },
        testEnv
      );
      expect(expenseRes.status).toBe(201);

      const res = await app.request(
        `/households/${HID}/budget/monthly-overview?year=2026&month=6`,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        actualSpent: number;
        itemCount: number;
        items: Array<{ id: string; status: string }>;
        expenses: Array<{ title: string; amount: number }>;
      };

      expect(body.actualSpent).toBe(7500);
      expect(body.expenses).toHaveLength(1);
      expect(body.expenses[0]?.title).toBe('Groceries');
      expect(body.items.map((i) => i.id)).toEqual(['bi-open']);
      expect(body.itemCount).toBe(2);
    });

    it("does not touch another household's budget item when a foreign budget_item_id is supplied (household scoping)", async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      const db = drizzle(testEnv.DB, { schema: { budgetItems } });
      const now = new Date().toISOString();

      // A planned item owned by the OTHER household.
      await db.insert(budgetItems).values({
        id: '44444444-4444-4444-8444-444444444444',
        household_id: OTHER_HID,
        timeframe: 'immediate',
        title: "Someone else's plan",
        estimated_cost_min: 5000,
        estimated_cost_max: 5000,
        priority: 'medium',
        status: 'planned',
        target_date: '2026-06-10',
        created_at: now,
        updated_at: now,
      });

      // A member of HID files an expense pointing at the OTHER household's item id.
      const res = await app.request(
        `/households/${HID}/budget/expenses`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Cross-tenant attempt',
            amount: 5000,
            expense_date: '2026-06-05',
            budget_item_id: '44444444-4444-4444-8444-444444444444',
          }),
        },
        testEnv
      );
      expect(res.status).toBe(201);

      // The other household's item must be untouched — a caller from a different
      // household can never flip it to completed or overwrite its actual_cost.
      const rows = await db
        .select()
        .from(budgetItems)
        .where(eq(budgetItems.id, '44444444-4444-4444-8444-444444444444'))
        .all();
      const foreign = rows[0];
      expect(foreign?.status).toBe('planned');
      expect(foreign?.actual_cost ?? null).toBeNull();
      expect(foreign?.completed_at ?? null).toBeNull();
    });

    it('yearAffordability sums the annual budget and ranks planned items across the whole year', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      // Two months carry an explicit 30000 cap; the other ten inherit that same
      // average, so the annual pool spans all 12 months → 12 × 30000 = 360000.
      for (const month of [6, 9]) {
        await app.request(
          `/households/${HID}/budget/goals/2026/${month}`,
          {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ planned_budget: 30000 }),
          },
          testEnv
        );
      }

      const db = drizzle(testEnv.DB, { schema: { budgetItems } });
      const now = new Date().toISOString();
      await db.insert(budgetItems).values([
        {
          id: 'bi-jun',
          household_id: HID,
          timeframe: 'immediate',
          title: 'June repair',
          estimated_cost_min: 20000,
          estimated_cost_max: 20000,
          priority: 'high',
          status: 'planned',
          target_date: '2026-06-15',
          created_at: now,
          updated_at: now,
        },
        {
          id: 'bi-sep',
          household_id: HID,
          timeframe: 'immediate',
          title: 'September service',
          estimated_cost_min: 25000,
          estimated_cost_max: 25000,
          priority: 'medium',
          status: 'planned',
          target_date: '2026-09-10',
          created_at: now,
          updated_at: now,
        },
        {
          id: 'bi-anytime',
          household_id: HID,
          timeframe: 'immediate',
          title: 'Someday sofa',
          estimated_cost_min: 400000,
          estimated_cost_max: 400000,
          priority: 'low',
          status: 'planned',
          target_date: null,
          created_at: now,
          updated_at: now,
        },
      ]);

      const res = await app.request(
        `/households/${HID}/budget/monthly-overview?year=2026&month=6`,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        affordability: { affordable: Array<{ id: string }> };
        yearAffordability: {
          remaining_budget: number;
          used_budget: number;
          affordable: Array<{ id: string }>;
          deferred: Array<{ id: string }>;
        };
      };

      // Annual pool = 12 × the 30000 average monthly cap = 360000, nothing spent yet.
      expect(body.yearAffordability.remaining_budget).toBe(360000);
      // The June and September items both fit the 360000 pool (45000 total); the
      // 400000 "Anytime" item can't — a cross-month view the MONTH plan (which
      // only sees June-dated items) can never produce.
      expect(body.yearAffordability.affordable.map((i) => i.id).sort()).toEqual(['bi-jun', 'bi-sep']);
      expect(body.yearAffordability.deferred.map((i) => i.id)).toEqual(['bi-anytime']);
      expect(body.yearAffordability.used_budget).toBe(45000);
      // Month plan for June only ranks the June-dated item — proving the two
      // windows are genuinely different scopes.
      expect(body.affordability.affordable.map((i) => i.id)).toEqual(['bi-jun']);
    });

    it('yearAffordability spans all 12 months when only one has an explicit budget (regression: year showed $0)', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      // Only ONE month is budgeted (20000). The other 11 months have no goal row
      // yet — the exact state that used to collapse the "This year" window to $0.
      await app.request(
        `/households/${HID}/budget/goals/2026/7`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ planned_budget: 20000 }),
        },
        testEnv
      );

      const res = await app.request(
        `/households/${HID}/budget/monthly-overview?year=2026&month=7`,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        yearAffordability: { remaining_budget: number };
      };

      // The single 20000 monthly budget extrapolates across all 12 months
      // (12 × 20000 = 240000) instead of counting only July — and never $0.
      expect(body.yearAffordability.remaining_budget).toBe(240000);
    });

    it('floors overspent months so heavy early-year spending never zeros out the year (regression: showed $0, all Won\'t-fit)', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      // Budget only Jul–Dec at 50000 (Jan–Jun inherit the 50000 average) — the
      // exact real-world shape that broke: only the back half of the year set.
      for (const month of [7, 8, 9, 10, 11, 12]) {
        await app.request(
          `/households/${HID}/budget/goals/2026/${month}`,
          {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ planned_budget: 50000 }),
          },
          testEnv
        );
      }

      // One early month blows massively past its cap (1,000,000 ≫ 50,000). Under
      // the OLD whole-year subtraction this single expense dwarfed the 600,000
      // annual pool and collapsed "This year" to $0 with every item "Won't fit".
      const bigExpense = await app.request(
        `/households/${HID}/budget/expenses`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'January blowout', amount: 1000000, expense_date: '2026-01-15' }),
        },
        testEnv
      );
      expect(bigExpense.status).toBe(201);

      const db = drizzle(testEnv.DB, { schema: { budgetItems } });
      const now = new Date().toISOString();
      await db.insert(budgetItems).values([
        {
          id: 'bi-cheap',
          household_id: HID,
          timeframe: 'immediate',
          title: 'Paint',
          estimated_cost_min: 7500,
          estimated_cost_max: 7500,
          priority: 'low',
          status: 'planned',
          target_date: '2026-07-31',
          created_at: now,
          updated_at: now,
        },
      ]);

      const res = await app.request(
        `/households/${HID}/budget/monthly-overview?year=2026&month=7`,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        yearAffordability: {
          remaining_budget: number;
          affordable: Array<{ id: string }>;
          deferred: Array<{ id: string }>;
        };
      };

      // January's month contributes 0 (floored), NOT −950000. The other eleven
      // months keep their 50000 → 11 × 50000 = 550000. Old model gave 0.
      expect(body.yearAffordability.remaining_budget).toBe(550000);
      // With a real pool the cheap planned item fits (the old $0 pool deferred it).
      expect(body.yearAffordability.affordable.map((i) => i.id)).toContain('bi-cheap');
      expect(body.yearAffordability.deferred).toHaveLength(0);
    });

    it('record-spending converts a planned item into an expense', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      await app.request(
        `/households/${HID}/budget/goals/2026/6`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ planned_budget: 50000 }),
        },
        testEnv
      );

      const db = drizzle(testEnv.DB, { schema: { budgetItems } });
      const now = new Date().toISOString();
      await db.insert(budgetItems).values({
        id: 'bi-record',
        household_id: HID,
        timeframe: 'immediate',
        title: 'Water heater',
        estimated_cost_min: 12000,
        estimated_cost_max: 12000,
        priority: 'high',
        status: 'planned',
        target_date: '2026-06-18',
        created_at: now,
        updated_at: now,
      });

      const recordRes = await app.request(
        `/households/${HID}/budget/items/bi-record/record-spending`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: 11500, expense_date: '2026-06-18' }),
        },
        testEnv
      );
      expect(recordRes.status).toBe(200);
      const recorded = (await recordRes.json()) as {
        expense: { amount: number; budget_item_id: string | null };
        item: { status: string; actual_cost: number | null };
      };
      expect(recorded.expense.amount).toBe(11500);
      expect(recorded.expense.budget_item_id).toBe('bi-record');
      expect(recorded.item.status).toBe('completed');
      expect(recorded.item.actual_cost).toBe(11500);

      const overviewRes = await app.request(
        `/households/${HID}/budget/monthly-overview?year=2026&month=6`,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv
      );
      const overview = (await overviewRes.json()) as {
        actualSpent: number;
        items: Array<{ id: string }>;
        expenses: Array<{ amount: number }>;
      };
      expect(overview.actualSpent).toBe(11500);
      expect(overview.items).toHaveLength(0);
      expect(overview.expenses).toHaveLength(1);
    });
  });

  describe('category CRUD', () => {
    it('creates, updates, and deletes a category, detaching referencing items', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      const createRes = await app.request(
        `/households/${HID}/budget/categories`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Pool', icon: '🏊', color: '#0000FF' }),
        },
        testEnv
      );
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as { category: { id: string; name: string } };
      expect(created.category.name).toBe('Pool');

      const db = drizzle(testEnv.DB, { schema: { budgetItems } });
      const now = new Date().toISOString();
      await db.insert(budgetItems).values({
        id: 'bi-categorized',
        household_id: HID,
        category_id: created.category.id,
        timeframe: 'immediate',
        title: 'Pool pump',
        priority: 'medium',
        status: 'planned',
        created_at: now,
        updated_at: now,
      });

      const updateRes = await app.request(
        `/households/${HID}/budget/categories/${created.category.id}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Pool & Spa' }),
        },
        testEnv
      );
      expect(updateRes.status).toBe(200);
      const updated = (await updateRes.json()) as { category: { name: string } };
      expect(updated.category.name).toBe('Pool & Spa');

      const deleteRes = await app.request(
        `/households/${HID}/budget/categories/${created.category.id}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
        testEnv
      );
      expect(deleteRes.status).toBe(204);

      const item = await db.select().from(budgetItems).where(eq(budgetItems.id, 'bi-categorized')).get();
      expect(item?.category_id).toBeNull();
    });

    it('collapses duplicate same-name categories and repoints referencing items', async () => {
      // Isolated household so this can't touch the shared HID backfill markers.
      const db = drizzle(testEnv.DB, { schema });
      const now = new Date().toISOString();
      const DHID = 'hh_budget_dedupe';
      const DUID = 'u_budget_dedupe';
      await db.insert(schema.users).values({ id: DUID, email: 'dedupe@example.com', email_verified: true });
      await db.insert(schema.households).values({ id: DHID, name: 'DedupeTest' });
      await db.insert(schema.householdMembers).values({
        id: 'm_budget_dedupe',
        household_id: DHID,
        user_id: DUID,
        role: 'owner',
        joined_at: '2025-01-01T00:00:00Z',
      });

      // Simulate the legacy concurrent double-seed: two "ZZ Duplicate" rows, with
      // a budget item pinned to the higher-sort_order (loser) copy.
      await db.insert(budgetCategories).values([
        { id: 'cat-dup-keep', household_id: DHID, name: 'ZZ Duplicate', sort_order: 900, created_at: now },
        { id: 'cat-dup-drop', household_id: DHID, name: 'ZZ Duplicate', sort_order: 901, created_at: now },
      ]);
      await db.insert(budgetItems).values({
        id: 'bi-dup-ref',
        household_id: DHID,
        category_id: 'cat-dup-drop',
        timeframe: 'immediate',
        title: 'Pinned to the loser',
        priority: 'medium',
        status: 'planned',
        created_at: now,
        updated_at: now,
      });

      const token = await mintToken(DUID);
      const res = await mkApp().request(
        `/households/${DHID}/budget/categories`,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv
      );
      const { categories } = (await res.json()) as { categories: { id: string; name: string }[] };

      // Exactly one "ZZ Duplicate" survives — the lowest sort_order row.
      const survivors = categories.filter((c) => c.name === 'ZZ Duplicate');
      expect(survivors).toHaveLength(1);
      expect(survivors[0].id).toBe('cat-dup-keep');

      // The loser row is gone and its item was repointed to the survivor.
      const gone = await db.select().from(budgetCategories).where(eq(budgetCategories.id, 'cat-dup-drop')).get();
      expect(gone).toBeUndefined();
      const item = await db.select().from(budgetItems).where(eq(budgetItems.id, 'bi-dup-ref')).get();
      expect(item?.category_id).toBe('cat-dup-keep');
    });

    it('flags seeded categories as predefined and custom ones as not', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await app.request(
        `/households/${HID}/budget/categories`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'My Boat', icon: '⛵' }),
        },
        testEnv
      );

      const res = await app.request(
        `/households/${HID}/budget/categories`,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv
      );
      const { categories } = (await res.json()) as {
        categories: { name: string; is_default: boolean; hidden: boolean }[];
      };

      const groceries = categories.find((c) => c.name === 'Groceries');
      const boat = categories.find((c) => c.name === 'My Boat');
      const fees = categories.find((c) => c.name === 'Fees');
      expect(groceries?.is_default).toBe(true); // seeded default
      expect(boat?.is_default).toBe(false); // user-created
      // Seeded like any other default — this one used to arrive only via a
      // versioned backfill, and was missing from the local-first seed entirely.
      expect(fees?.is_default).toBe(true);
    });

    it('hides a predefined category via the toggle: excluded by default, listed with include_hidden', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      // Seed defaults, then grab a predefined one to hide.
      const seedRes = await app.request(
        `/households/${HID}/budget/categories`,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv
      );
      const seeded = (await seedRes.json()) as { categories: { id: string; name: string }[] };
      const hvac = seeded.categories.find((c) => c.name === 'HVAC');
      expect(hvac).toBeTruthy();

      const patchRes = await app.request(
        `/households/${HID}/budget/categories/${hvac!.id}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ hidden: true }),
        },
        testEnv
      );
      expect(patchRes.status).toBe(200);

      // Default listing (pickers) omits the hidden category.
      const defaultList = (await (
        await app.request(
          `/households/${HID}/budget/categories`,
          { headers: { Authorization: `Bearer ${token}` } },
          testEnv
        )
      ).json()) as { categories: { name: string; hidden: boolean }[] };
      expect(defaultList.categories.some((c) => c.name === 'HVAC')).toBe(false);

      // Management listing (include_hidden=1) still shows it, flagged hidden.
      const fullList = (await (
        await app.request(
          `/households/${HID}/budget/categories?include_hidden=1`,
          { headers: { Authorization: `Bearer ${token}` } },
          testEnv
        )
      ).json()) as { categories: { name: string; hidden: boolean }[] };
      const hidden = fullList.categories.find((c) => c.name === 'HVAC');
      expect(hidden?.hidden).toBe(true);
    });

    it('rejects creating a category whose name already exists (case-insensitive)', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await app.request(
        `/households/${HID}/budget/categories`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Garden Supplies' }),
        },
        testEnv
      );

      const dupeRes = await app.request(
        `/households/${HID}/budget/categories`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: '  garden supplies  ' }),
        },
        testEnv
      );
      expect(dupeRes.status).toBe(409);

      const listRes = await app.request(
        `/households/${HID}/budget/categories`,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv
      );
      const { categories } = (await listRes.json()) as { categories: { name: string }[] };
      expect(categories.filter((c) => c.name.toLowerCase() === 'garden supplies')).toHaveLength(1);
    });

    it('rejects renaming a category to collide with another one, but allows a no-op rename', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      // Seed defaults first (unconditional on an empty household — unlike the
      // KV-gated backfills, this doesn't depend on markers other tests in this
      // file may have already consumed for HID), so there's a "Groceries" to
      // collide with.
      await app.request(
        `/households/${HID}/budget/categories`,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv
      );

      const createRes = await app.request(
        `/households/${HID}/budget/categories`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Boat' }),
        },
        testEnv
      );
      const created = (await createRes.json()) as { category: { id: string } };

      const collideRes = await app.request(
        `/households/${HID}/budget/categories/${created.category.id}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Groceries' }),
        },
        testEnv
      );
      expect(collideRes.status).toBe(409);

      // Renaming to the same name (any casing) is a no-op, not a self-collision.
      const noopRes = await app.request(
        `/households/${HID}/budget/categories/${created.category.id}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'BOAT' }),
        },
        testEnv
      );
      expect(noopRes.status).toBe(200);
    });
  });

  describe('POST /expenses/bulk', () => {
    // Regression: D1 caps a query at 100 bound parameters and each expense binds
    // 13 columns, so a >7-item receipt (e.g. 12 groceries = 156 params) must be
    // chunked. This asserts every row is still persisted across the chunks.
    it('creates all items for a large (12-item) bulk insert', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      const expensesPayload = Array.from({ length: 12 }, (_, index) => ({
        title: `Item ${index + 1}`,
        amount: 500 + index,
        expense_date: '2026-07-05',
        saved_amount: 0,
      }));

      const res = await app.request(
        `/households/${HID}/budget/expenses/bulk`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ expenses: expensesPayload }),
        },
        testEnv
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as { expenses: Array<{ id: string; title: string }> };
      expect(body.expenses).toHaveLength(12);

      const listRes = await app.request(
        `/households/${HID}/budget/expenses`,
        { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
        testEnv
      );
      expect(listRes.status).toBe(200);
      const list = (await listRes.json()) as { expenses: Array<{ id: string }> };
      expect(list.expenses).toHaveLength(12);
    });
  });

  // The "See all spending" explorer scopes each time-range to a
  // start_date (inclusive) / end_date (EXCLUSIVE) window and filters by
  // category client-agnostically. These guard the exact query semantics the
  // screen relies on (spendingDateRange() builds an exclusive next-period end).
  describe('GET /expenses — date-range + category filtering (See all spending)', () => {
    async function addExpense(
      app: Hono<{ Bindings: Env }>,
      token: string,
      body: Record<string, unknown>
    ): Promise<Response> {
      return app.request(
        `/households/${HID}/budget/expenses`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        testEnv
      );
    }

    it('honors start_date (inclusive) + end_date (exclusive) and returns newest-first', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await addExpense(app, token, { title: 'JuneLast', amount: 1000, expense_date: '2026-06-30' });
      await addExpense(app, token, { title: 'JulyFirst', amount: 2000, expense_date: '2026-07-01' });
      await addExpense(app, token, { title: 'JulyLast', amount: 3000, expense_date: '2026-07-31' });
      await addExpense(app, token, { title: 'AugFirst', amount: 4000, expense_date: '2026-08-01' });

      // July window exactly as the screen builds it for the "This month" range.
      const res = await app.request(
        `/households/${HID}/budget/expenses?start_date=2026-07-01&end_date=2026-08-01`,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { expenses: Array<{ title: string }> };

      // JuneLast excluded (before start), AugFirst excluded (== end, exclusive),
      // and the two July rows come back newest-first.
      expect(body.expenses.map((e) => e.title)).toEqual(['JulyLast', 'JulyFirst']);
    });

    it('filters by category_id and returns only that category', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      const catRes = await app.request(
        `/households/${HID}/budget/categories`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Groceries', icon: '🛒', color: '#22aa77' }),
        },
        testEnv
      );
      expect(catRes.status).toBe(201);
      const catId = ((await catRes.json()) as { category: { id: string } }).category.id;

      await addExpense(app, token, {
        title: 'Rice',
        amount: 600,
        expense_date: '2026-07-10',
        category_id: catId,
      });
      await addExpense(app, token, { title: 'Bus fare', amount: 250, expense_date: '2026-07-11' });

      const res = await app.request(
        `/households/${HID}/budget/expenses?category_id=${catId}`,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { expenses: Array<{ title: string; category_id: string | null }> };
      expect(body.expenses).toHaveLength(1);
      expect(body.expenses[0]?.title).toBe('Rice');
      expect(body.expenses[0]?.category_id).toBe(catId);
    });

    it('rejects a non-UUID category_id with 400 (client filters uncategorized locally)', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      const res = await app.request(
        `/households/${HID}/budget/expenses?category_id=uncategorized`,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv
      );
      expect(res.status).toBe(400);
    });
  });
});
