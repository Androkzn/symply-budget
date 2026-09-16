/**
 * Single-source-of-truth integration test (DB → Budget tab → House glance).
 *
 * House's "home-budget" surface is a thin re-projection of the same
 * `BudgetService.getMonthlyOverview` the Budget app's own monthly-overview
 * uses (see `home-budget.ts`). Two routers, one household's real D1 rows:
 *
 *   SUM(expenses.amount)                    ← the DB truth
 *     === budget /monthly-overview.actualSpent      ← Budget tab "Spent"
 *     === home-budget /monthly-overview.actualSpent ← House-alias "Spent"
 *     === home-budget /glance.spent                 ← Home status-strip "Spent"
 *
 * If the House alias or the glance field-mapping ever drifts from the Budget
 * tab's own numbers, this fails — exactly the cross-tab inconsistency this
 * suite exists to catch.
 */
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../db/schema';
import { createCoreTables, resetAllTables } from '../../services/aihousekeeper/__tests__/test-helpers';
import type { Env } from '../../types';
import budgetRouter from '../budget';
import homeBudgetRouter from '../home-budget';

import { applyBudgetWorkerTestBrand, createBudgetTables, resetBudgetTables } from './budget-test-helpers';

const testEnv = env as unknown as Env;

const HID = 'hh_home_budget_consistency';
const UID = 'u_home_budget_owner';
const MID = 'm_home_budget_owner';

const YEAR = 2026;
const MONTH = 6;

// The one canonical spend ledger. Amounts in cents; Σ = 87500 ($875.00).
const EXPENSES = [
  { id: 'exp-rent', title: 'Rent top-up', amount: 50000, date: '2026-06-02' },
  { id: 'exp-hydro', title: 'Hydro', amount: 12500, date: '2026-06-11' },
  { id: 'exp-internet', title: 'Internet', amount: 25000, date: '2026-06-20' },
];
const EXPECTED_SPEND = 87500;
const PLANNED_BUDGET = 200000;

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
  app.route('/households/:householdId/home-budget', homeBudgetRouter);
  app.onError((error, c) => c.json({ error: { message: (error as Error).message } }, 500));
  return app;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function seed(): Promise<void> {
  applyBudgetWorkerTestBrand(testEnv);
  await createCoreTables(testEnv.DB);
  await createBudgetTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetBudgetTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values([{ id: UID, email: 'home-budget@example.com', email_verified: true }]);
  await db.insert(schema.households).values([{ id: HID, name: 'HomeBudgetConsistency' }]);
  await db.insert(schema.householdMembers).values([
    { id: MID, household_id: HID, user_id: UID, role: 'owner', joined_at: '2025-01-01T00:00:00Z' },
  ]);

  for (const e of EXPENSES) {
    await testEnv.DB.prepare(
      `INSERT INTO expenses (id, household_id, title, amount, expense_date, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    )
      .bind(e.id, HID, e.title, e.amount, e.date)
      .run();
  }
  await testEnv.DB.prepare(
    `INSERT INTO budget_goals (id, household_id, year, month, planned_budget, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  )
    .bind('goal-home-budget', HID, YEAR, MONTH, PLANNED_BUDGET)
    .run();
}

describe('Budget ⇄ House home-budget single source of truth', () => {
  beforeEach(seed);

  it('DB truth, Budget monthly-overview, and House home-budget monthly-overview all agree', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    const row = await testEnv.DB.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
       WHERE household_id = ? AND expense_date >= '2026-06-01' AND expense_date < '2026-07-01'`
    )
      .bind(HID)
      .first<{ total: number }>();
    expect(row?.total).toBe(EXPECTED_SPEND);

    const budgetRes = await app.request(
      `/households/${HID}/budget/monthly-overview?year=${YEAR}&month=${MONTH}`,
      { headers: authHeaders(token) },
      testEnv
    );
    expect(budgetRes.status).toBe(200);
    const budget = (await budgetRes.json()) as {
      actualSpent: number;
      plannedBudget: number;
      remainingBudget: number;
    };

    const homeRes = await app.request(
      `/households/${HID}/home-budget/monthly-overview?year=${YEAR}&month=${MONTH}`,
      { headers: authHeaders(token) },
      testEnv
    );
    expect(homeRes.status).toBe(200);
    const home = (await homeRes.json()) as {
      actualSpent: number;
      plannedBudget: number;
      remainingBudget: number;
    };

    // The one number, three ways.
    expect(budget.actualSpent).toBe(EXPECTED_SPEND);
    expect(home.actualSpent).toBe(EXPECTED_SPEND);
    expect(home.actualSpent).toBe(budget.actualSpent);
    expect(home.plannedBudget).toBe(budget.plannedBudget);
    expect(home.remainingBudget).toBe(budget.remainingBudget);
  });

  it('the House glance strip correctly re-maps the Budget overview fields', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    const budgetRes = await app.request(
      `/households/${HID}/budget/monthly-overview?year=${YEAR}&month=${MONTH}`,
      { headers: authHeaders(token) },
      testEnv
    );
    const budget = (await budgetRes.json()) as {
      actualSpent: number;
      plannedBudget: number;
      remainingBudget: number;
    };

    const glanceRes = await app.request(
      `/households/${HID}/home-budget/glance?year=${YEAR}&month=${MONTH}`,
      { headers: authHeaders(token) },
      testEnv
    );
    expect(glanceRes.status).toBe(200);
    const glance = (await glanceRes.json()) as {
      spent: number;
      remaining: number;
      planned: number | null;
    };

    expect(glance.spent).toBe(EXPECTED_SPEND);
    expect(glance.spent).toBe(budget.actualSpent);
    expect(glance.remaining).toBe(budget.remainingBudget);
    expect(glance.planned).toBe(budget.plannedBudget > 0 ? budget.plannedBudget : null);
    expect(glance.planned).toBe(PLANNED_BUDGET);
  });

  it('a new expense posted through the Budget tab moves the House glance by the same amount', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    const before = (await (
      await app.request(
        `/households/${HID}/home-budget/glance?year=${YEAR}&month=${MONTH}`,
        { headers: authHeaders(token) },
        testEnv
      )
    ).json()) as { spent: number; remaining: number };

    const createRes = await app.request(
      `/households/${HID}/budget/expenses`,
      {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ title: 'Extra grocery run', amount: 4200, expense_date: '2026-06-25' }),
      },
      testEnv
    );
    expect(createRes.status).toBe(201);

    const after = (await (
      await app.request(
        `/households/${HID}/home-budget/glance?year=${YEAR}&month=${MONTH}`,
        { headers: authHeaders(token) },
        testEnv
      )
    ).json()) as { spent: number; remaining: number };

    expect(after.spent).toBe(before.spent + 4200);
    expect(after.remaining).toBe(before.remaining - 4200);
  });
});
