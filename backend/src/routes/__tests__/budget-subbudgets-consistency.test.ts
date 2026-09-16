/**
 * Single-source-of-truth integration test (DB → per-category caps → Sub-budgets tab).
 *
 * The Sub-budgets screen re-derives per-category spend from the same `expenses`
 * ledger the Budget tab's monthly-overview sums — just grouped by category
 * instead of totalled. This seeds one household's real D1 rows across two
 * categories (plus one uncategorized expense) and asserts every figure the
 * `/budget/sub-budgets` response returns against hand-computed DB truth:
 *
 *   SUM(expenses.amount WHERE category = Groceries) === entries[Groceries].spent_cents
 *   SUM(expenses.amount WHERE category = Utilities) === entries[Utilities].spent_cents
 *   Σ(cap_cents)                                     === totals.totalCapCents
 *   max(0, totalCapCents − plannedBudget)             === totals.overAllocatedBy
 *   Σ(categorized spend) + uncategorized spend         === Budget tab actualSpent
 *
 * If the sub-budget grouping ever double-counts, drops a category, or drifts
 * from the Budget tab's own total, this fails.
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

import { applyBudgetWorkerTestBrand, createBudgetTables, resetBudgetTables } from './budget-test-helpers';

const testEnv = env as unknown as Env;

const HID = 'hh_subbudgets_consistency';
const UID = 'u_subbudgets_owner';
const MID = 'm_subbudgets_owner';

const YEAR = 2026;
const MONTH = 7;

const CAT_GROCERIES = '11111111-1111-4111-8111-111111111111';
const CAT_UTILITIES = '22222222-2222-4222-8222-222222222222';

// Groceries Σ = 45000. Utilities Σ = 8000. Uncategorized = 2000. Grand total = 55000.
const GROCERY_EXPENSES = [
  { id: 'exp-g1', amount: 30000, date: '2026-07-04' },
  { id: 'exp-g2', amount: 15000, date: '2026-07-18' },
];
const UTILITY_EXPENSES = [{ id: 'exp-u1', amount: 8000, date: '2026-07-09' }];
const UNCATEGORIZED_AMOUNT = 2000;

const GROCERY_CAP = 50000;
const UTILITY_CAP = 5000; // deliberately under actual spend → "over" branch
const PLANNED_BUDGET = 40000; // deliberately under the combined caps → over-allocated branch

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
  await db.insert(schema.users).values([{ id: UID, email: 'subbudgets@example.com', email_verified: true }]);
  await db.insert(schema.households).values([{ id: HID, name: 'SubBudgetsConsistency' }]);
  await db.insert(schema.householdMembers).values([
    { id: MID, household_id: HID, user_id: UID, role: 'owner', joined_at: '2025-01-01T00:00:00Z' },
  ]);

  await testEnv.DB.prepare(
    `INSERT INTO budget_categories (id, household_id, name, created_at) VALUES (?, ?, ?, datetime('now'))`
  )
    .bind(CAT_GROCERIES, HID, 'Groceries')
    .run();
  await testEnv.DB.prepare(
    `INSERT INTO budget_categories (id, household_id, name, created_at) VALUES (?, ?, ?, datetime('now'))`
  )
    .bind(CAT_UTILITIES, HID, 'Utilities')
    .run();

  for (const e of GROCERY_EXPENSES) {
    await testEnv.DB.prepare(
      `INSERT INTO expenses (id, household_id, category_id, title, amount, expense_date, created_at)
       VALUES (?, ?, ?, 'Grocery run', ?, ?, datetime('now'))`
    )
      .bind(e.id, HID, CAT_GROCERIES, e.amount, e.date)
      .run();
  }
  for (const e of UTILITY_EXPENSES) {
    await testEnv.DB.prepare(
      `INSERT INTO expenses (id, household_id, category_id, title, amount, expense_date, created_at)
       VALUES (?, ?, ?, 'Hydro', ?, ?, datetime('now'))`
    )
      .bind(e.id, HID, CAT_UTILITIES, e.amount, e.date)
      .run();
  }
  await testEnv.DB.prepare(
    `INSERT INTO expenses (id, household_id, category_id, title, amount, expense_date, created_at)
     VALUES ('exp-uncat', ?, NULL, 'Misc', ?, '2026-07-22', datetime('now'))`
  )
    .bind(HID, UNCATEGORIZED_AMOUNT)
    .run();

  await testEnv.DB.prepare(
    `INSERT INTO budget_goals (id, household_id, year, month, planned_budget, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  )
    .bind('goal-subbudgets', HID, YEAR, MONTH, PLANNED_BUDGET)
    .run();
}

async function setCap(
  app: ReturnType<typeof mkApp>,
  token: string,
  categoryId: string,
  amountCents: number
): Promise<void> {
  const res = await app.request(
    `/households/${HID}/budget/sub-budgets`,
    {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({
        category_id: categoryId,
        year: YEAR,
        month: MONTH,
        limit_type: 'amount',
        amount_cents: amountCents,
      }),
    },
    testEnv
  );
  expect(res.status).toBe(200);
}

describe('Budget sub-budgets ⇄ expenses ledger single source of truth', () => {
  beforeEach(seed);

  it('per-category spend matches SUM(expenses.amount) exactly, per category', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    await setCap(app, token, CAT_GROCERIES, GROCERY_CAP);
    await setCap(app, token, CAT_UTILITIES, UTILITY_CAP);

    const groceryRow = await testEnv.DB.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE household_id = ? AND category_id = ?`
    )
      .bind(HID, CAT_GROCERIES)
      .first<{ total: number }>();
    const utilityRow = await testEnv.DB.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE household_id = ? AND category_id = ?`
    )
      .bind(HID, CAT_UTILITIES)
      .first<{ total: number }>();
    expect(groceryRow?.total).toBe(45000);
    expect(utilityRow?.total).toBe(8000);

    const res = await app.request(
      `/households/${HID}/budget/sub-budgets?year=${YEAR}&month=${MONTH}`,
      { headers: authHeaders(token) },
      testEnv
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      subBudgets: Array<{
        category_id: string;
        cap_cents: number;
        spent_cents: number;
        remaining_cents: number;
        over: boolean;
      }>;
      totals: { totalCapCents: number; plannedBudget: number; overAllocatedBy: number };
    };

    const groceries = body.subBudgets.find((e) => e.category_id === CAT_GROCERIES);
    const utilities = body.subBudgets.find((e) => e.category_id === CAT_UTILITIES);
    expect(groceries).toBeTruthy();
    expect(utilities).toBeTruthy();

    // DB truth, one category at a time.
    expect(groceries?.spent_cents).toBe(groceryRow?.total);
    expect(utilities?.spent_cents).toBe(utilityRow?.total);

    // Under-cap category: remaining is positive, not flagged over.
    expect(groceries?.cap_cents).toBe(GROCERY_CAP);
    expect(groceries?.remaining_cents).toBe(GROCERY_CAP - 45000);
    expect(groceries?.over).toBe(false);

    // Over-cap category: remaining goes negative, flagged over.
    expect(utilities?.cap_cents).toBe(UTILITY_CAP);
    expect(utilities?.remaining_cents).toBe(UTILITY_CAP - 8000);
    expect(utilities?.over).toBe(true);
  });

  it('totals reconcile: Σcaps, over-allocation, and plannedBudget tie to the Budget tab', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    await setCap(app, token, CAT_GROCERIES, GROCERY_CAP);
    await setCap(app, token, CAT_UTILITIES, UTILITY_CAP);

    const res = await app.request(
      `/households/${HID}/budget/sub-budgets?year=${YEAR}&month=${MONTH}`,
      { headers: authHeaders(token) },
      testEnv
    );
    const body = (await res.json()) as {
      totals: { totalCapCents: number; plannedBudget: number; overAllocatedBy: number };
    };

    expect(body.totals.totalCapCents).toBe(GROCERY_CAP + UTILITY_CAP);
    expect(body.totals.plannedBudget).toBe(PLANNED_BUDGET);
    expect(body.totals.overAllocatedBy).toBe(
      Math.max(0, GROCERY_CAP + UTILITY_CAP - PLANNED_BUDGET)
    );

    // The Budget tab's own plannedBudget for the same month must be the same
    // number — the sub-budgets screen must not read a stale/different goal.
    const overviewRes = await app.request(
      `/households/${HID}/budget/monthly-overview?year=${YEAR}&month=${MONTH}`,
      { headers: authHeaders(token) },
      testEnv
    );
    const overview = (await overviewRes.json()) as { plannedBudget: number; actualSpent: number };
    expect(body.totals.plannedBudget).toBe(overview.plannedBudget);

    // Categorized spend is a strict subset of total spend — the uncategorized
    // expense must show up in the Budget tab's total but not in any category.
    expect(overview.actualSpent).toBe(45000 + 8000 + UNCATEGORIZED_AMOUNT);
  });
});
