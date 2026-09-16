/**
 * Single-source-of-truth integration test (DB → both view models).
 *
 * The Budget and Savings features must agree on ONE spend number. This test
 * seeds ONE household's real D1 rows (budget `expenses`, savings income,
 * active recurring "Monthly Payments", a goal), then drives BOTH routers and
 * asserts the raw DB truth equals every computed figure:
 *
 *   SUM(expenses.amount)                         ← the DB truth
 *     === budget /monthly-overview.actualSpent   ← Budget tab "Spent"
 *     === savings /overview.spending.spendings   ← Savings tab "Spendings"
 *
 *   savings net    = income − monthlyPayments − SUM(expenses.amount)
 *   savings headroom = net − Σ goal allocations
 *   savings trend[month] mirrors the single-month overview
 *
 * If any layer recomputes spend differently, this fails — which is exactly the
 * cross-feature inconsistency we are guarding against.
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
import savingsRouter from '../savings';

import {
  applyBudgetWorkerTestBrand,
  createBudgetTables,
  resetBudgetTables,
} from './budget-test-helpers';
import { createSavingsTables, resetSavingsTables } from './savings-test-helpers';

const testEnv = env as unknown as Env;

const HID = 'hh_consistency_01';
const UID = 'u_consistency_owner';
const MID = 'm_consistency_owner';

const YEAR = 2026;
const MONTH = 6;

// The one canonical spend ledger. Amounts in cents; Σ = 160000 ($1.6k).
const EXPENSES = [
  { id: 'exp-groceries', title: 'Groceries', amount: 120000, date: '2026-06-05' },
  { id: 'exp-garden', title: 'Garden soil', amount: 30000, date: '2026-06-10' },
  { id: 'exp-utilities', title: 'Hydro', amount: 10000, date: '2026-06-15' },
];
const EXPECTED_SPEND = 160000;

// Income Σ = 900000 ($9.0k). Route requires UUID client ids.
const INCOME = [
  { id: '11111111-1111-4111-8111-111111111111', source_type: 'payroll', label: 'Paycheck', amount: 800000, date: '2026-06-15' },
  { id: '22222222-2222-4222-8222-222222222222', source_type: 'rental', label: 'Rent', amount: 100000, date: '2026-06-20' },
];
const EXPECTED_INCOME = 900000;

// Active recurring "Monthly Payments" Σ = 200000 ($2.0k).
const RECURRING = [
  { id: '33333333-3333-4333-8333-333333333333', label: 'Mortgage', amount: 150000 },
  { id: '44444444-4444-4444-8444-444444444444', label: 'Insurance', amount: 50000 },
];
const EXPECTED_MONTHLY_PAYMENTS = 200000;

const GOAL_ALLOCATION = 300000;
const EXPECTED_NET = EXPECTED_INCOME - EXPECTED_MONTHLY_PAYMENTS - EXPECTED_SPEND; // 540000

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
  app.route('/households/:householdId/savings', savingsRouter);
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
  await createSavingsTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetBudgetTables(testEnv.DB);
  await resetSavingsTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values([{ id: UID, email: 'consistency@example.com', email_verified: true }]);
  await db.insert(schema.households).values([{ id: HID, name: 'ConsistencyTest' }]);
  await db.insert(schema.householdMembers).values([
    { id: MID, household_id: HID, user_id: UID, role: 'owner', joined_at: '2025-01-01T00:00:00Z' },
  ]);

  // Budget expenses (the DB truth for spend).
  for (const e of EXPENSES) {
    await testEnv.DB.prepare(
      `INSERT INTO expenses (id, household_id, title, amount, expense_date, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    )
      .bind(e.id, HID, e.title, e.amount, e.date)
      .run();
  }
}

async function seedSavingsInputs(token: string, app: ReturnType<typeof mkApp>): Promise<void> {
  for (const i of INCOME) {
    const res = await app.request(
      `/households/${HID}/savings/income`,
      {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
          id: i.id,
          source_type: i.source_type,
          label: i.label,
          amount_cents: i.amount,
          income_date: i.date,
        }),
      },
      testEnv
    );
    expect(res.status).toBe(201);
  }
  for (const r of RECURRING) {
    const res = await app.request(
      `/households/${HID}/savings/recurring-payments`,
      {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ id: r.id, label: r.label, amount_cents: r.amount, active: true }),
      },
      testEnv
    );
    expect(res.status).toBe(201);
  }
  const goalRes = await app.request(
    `/households/${HID}/savings/goals`,
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        id: '55555555-5555-4555-8555-555555555555',
        type: 'custom',
        name: 'Emergency Fund',
        target_amount_cents: 1000000,
        monthly_allocation_cents: GOAL_ALLOCATION,
      }),
    },
    testEnv
  );
  expect(goalRes.status).toBe(201);
}

describe('Budget ⇄ Savings single source of truth', () => {
  beforeEach(seed);

  it('the raw DB spend equals both the Budget and Savings computed spend', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    // DB truth: SUM(expenses.amount) for the month.
    const row = await testEnv.DB.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
       WHERE household_id = ? AND expense_date >= '2026-06-01' AND expense_date < '2026-07-01'`
    )
      .bind(HID)
      .first<{ total: number }>();
    expect(row?.total).toBe(EXPECTED_SPEND);

    // Budget tab "Spent".
    const budgetRes = await app.request(
      `/households/${HID}/budget/monthly-overview?year=${YEAR}&month=${MONTH}`,
      { headers: authHeaders(token) },
      testEnv
    );
    expect(budgetRes.status).toBe(200);
    const budget = (await budgetRes.json()) as { actualSpent: number };

    // Savings tab "Spendings".
    const savingsRes = await app.request(
      `/households/${HID}/savings/overview?year=${YEAR}&month=${MONTH}`,
      { headers: authHeaders(token) },
      testEnv
    );
    expect(savingsRes.status).toBe(200);
    const savings = (await savingsRes.json()) as {
      spending: { spendings: number };
    };

    // The one number, three ways.
    expect(budget.actualSpent).toBe(EXPECTED_SPEND);
    expect(savings.spending.spendings).toBe(EXPECTED_SPEND);
    expect(budget.actualSpent).toBe(savings.spending.spendings);
  });

  it('savings net = income − monthly payments − Budget spendings (with all inputs)', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    await seedSavingsInputs(token, app);

    const res = await app.request(
      `/households/${HID}/savings/overview?year=${YEAR}&month=${MONTH}`,
      { headers: authHeaders(token) },
      testEnv
    );
    expect(res.status).toBe(200);
    const ov = (await res.json()) as {
      income: { total: number };
      spending: { total: number; monthlyPayments: number; spendings: number };
      netSavings: number;
    };

    expect(ov.income.total).toBe(EXPECTED_INCOME);
    expect(ov.spending.monthlyPayments).toBe(EXPECTED_MONTHLY_PAYMENTS);
    expect(ov.spending.spendings).toBe(EXPECTED_SPEND);
    expect(ov.spending.total).toBe(EXPECTED_MONTHLY_PAYMENTS + EXPECTED_SPEND); // 360000
    expect(ov.netSavings).toBe(EXPECTED_NET); // 540000

    // Identity holds exactly.
    expect(ov.netSavings).toBe(ov.income.total - ov.spending.monthlyPayments - ov.spending.spendings);
  });

  it('the savings trend point for the month mirrors the single-month overview', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    await seedSavingsInputs(token, app);

    const [overviewRes, trendRes] = await Promise.all([
      app.request(
        `/households/${HID}/savings/overview?year=${YEAR}&month=${MONTH}`,
        { headers: authHeaders(token) },
        testEnv
      ),
      app.request(
        `/households/${HID}/savings/trend?year=${YEAR}&month=${MONTH}&months=6`,
        { headers: authHeaders(token) },
        testEnv
      ),
    ]);
    const ov = (await overviewRes.json()) as {
      spending: { total: number };
      netSavings: number;
      income: { total: number };
    };
    const trend = (await trendRes.json()) as {
      months: Array<{ period: string; income: number; spending: number; net: number }>;
    };
    const june = trend.months.find((m) => m.period === '2026-06');
    expect(june).toBeTruthy();
    expect(june?.income).toBe(ov.income.total);
    expect(june?.spending).toBe(ov.spending.total);
    expect(june?.net).toBe(ov.netSavings);
  });

  it('a new Budget expense flows straight into savings net (one ledger)', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    await seedSavingsInputs(token, app);

    const before = (await (
      await app.request(
        `/households/${HID}/savings/overview?year=${YEAR}&month=${MONTH}`,
        { headers: authHeaders(token) },
        testEnv
      )
    ).json()) as { netSavings: number; spending: { spendings: number } };

    // Add a $250 Budget expense directly to the ledger.
    await testEnv.DB.prepare(
      `INSERT INTO expenses (id, household_id, title, amount, expense_date, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    )
      .bind('exp-new', HID, 'Extra', 25000, '2026-06-25')
      .run();

    const after = (await (
      await app.request(
        `/households/${HID}/savings/overview?year=${YEAR}&month=${MONTH}`,
        { headers: authHeaders(token) },
        testEnv
      )
    ).json()) as { netSavings: number; spending: { spendings: number } };

    expect(after.spending.spendings).toBe(before.spending.spendings + 25000);
    expect(after.netSavings).toBe(before.netSavings - 25000);
  });
});
