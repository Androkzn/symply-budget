/**
 * Single-source-of-truth integration test (DB → Overview / History / Projection tabs).
 *
 * `getYearHistory` and `getOverview` are two INDEPENDENT code paths in
 * `savings-service.ts` — history buckets expenses by category name into
 * food/monthlyPayments/other and sums `income - (monthlyPayments+food+other)`;
 * overview separately sums the raw expenses ledger against income and active
 * recurring payments. They must still land on the same number for a month
 * with no food/monthly-payment-category expenses. `getProjection` then wraps
 * `getYearHistory` and must mirror it exactly for any completed ("actual")
 * month — it should never re-derive its own figure for the past.
 *
 *   income − (monthlyPayments + Σexpenses)   ← hand-computed DB truth
 *     === /savings/history/year  .months[m].net        ← History tab
 *     === /savings/overview      .netSavings            ← Overview tab
 *     === /savings/projection    .months[m].actualNet   ← Projection tab
 *     === /savings/projection    .months[m].projectedNet (completed month, no re-derivation)
 *
 * If any of the three tabs recomputes this differently, this fails.
 */
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../db/schema';
import { createCoreTables, resetAllTables } from '../../services/aihousekeeper/__tests__/test-helpers';
import type { Env } from '../../types';
import savingsRouter from '../savings';

import { applyBudgetWorkerTestBrand } from './budget-test-helpers';
import { createSavingsTables, resetSavingsTables } from './savings-test-helpers';

const testEnv = env as unknown as Env;

const HID = 'hh_savings_history_projection';
const UID = 'u_savings_history_owner';
const MID = 'm_savings_history_owner';

// A month safely in the past relative to "now" (2026-08+), so every consumer
// classifies it as a completed ("actual") month — no pace/target branching.
const YEAR = 2025;
const MONTH = 6;

const INCOME = [
  { id: '11111111-1111-4111-8111-111111111111', source_type: 'payroll', label: 'Paycheck', amount: 500000, date: '2025-06-05' },
  { id: '22222222-2222-4222-8222-222222222222', source_type: 'rental', label: 'Rent income', amount: 100000, date: '2025-06-20' },
];
const EXPECTED_INCOME = 600000;

const RECURRING_AMOUNT = 150000;

// Uncategorized so it buckets as "other" in getYearHistory, matching the raw
// ledger sum getOverview also reads — the two independent formulas agree.
const EXPENSES = [
  { id: 'exp-h1', amount: 80000, date: '2025-06-08' },
  { id: 'exp-h2', amount: 20000, date: '2025-06-19' },
];
const EXPECTED_SPEND = 100000;

const EXPECTED_NET = EXPECTED_INCOME - (RECURRING_AMOUNT + EXPECTED_SPEND); // 350000

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
  await createSavingsTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetSavingsTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values([{ id: UID, email: 'savings-history@example.com', email_verified: true }]);
  await db.insert(schema.households).values([{ id: HID, name: 'SavingsHistoryProjection' }]);
  await db.insert(schema.householdMembers).values([
    { id: MID, household_id: HID, user_id: UID, role: 'owner', joined_at: '2025-01-01T00:00:00Z' },
  ]);

  for (const e of EXPENSES) {
    await testEnv.DB.prepare(
      `INSERT INTO expenses (id, household_id, title, amount, expense_date, created_at)
       VALUES (?, ?, 'Misc', ?, ?, datetime('now'))`
    )
      .bind(e.id, HID, e.amount, e.date)
      .run();
  }
}

async function seedIncomeAndRecurring(token: string, app: ReturnType<typeof mkApp>): Promise<void> {
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
  const recurringRes = await app.request(
    `/households/${HID}/savings/recurring-payments`,
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        id: '33333333-3333-4333-8333-333333333333',
        label: 'Insurance',
        amount_cents: RECURRING_AMOUNT,
        active: true,
      }),
    },
    testEnv
  );
  expect(recurringRes.status).toBe(201);
}

describe('Savings Overview ⇄ History ⇄ Projection single source of truth', () => {
  beforeEach(seed);

  it('history net matches hand-computed DB truth for the seeded month', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    await seedIncomeAndRecurring(token, app);

    const res = await app.request(
      `/households/${HID}/savings/history/year?year=${YEAR}`,
      { headers: authHeaders(token) },
      testEnv
    );
    expect(res.status).toBe(200);
    const history = (await res.json()) as {
      months: Array<{ month: number; income: number; monthlyPayments: number; food: number; other: number; net: number }>;
    };
    const row = history.months.find((m) => m.month === MONTH);
    expect(row).toBeTruthy();
    expect(row?.income).toBe(EXPECTED_INCOME);
    expect(row?.monthlyPayments).toBe(RECURRING_AMOUNT);
    expect((row?.food ?? 0) + (row?.other ?? 0)).toBe(EXPECTED_SPEND);
    expect(row?.net).toBe(EXPECTED_NET);
  });

  it('overview netSavings (independent formula) agrees with the History tab for the same month', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    await seedIncomeAndRecurring(token, app);

    const [historyRes, overviewRes] = await Promise.all([
      app.request(`/households/${HID}/savings/history/year?year=${YEAR}`, { headers: authHeaders(token) }, testEnv),
      app.request(
        `/households/${HID}/savings/overview?year=${YEAR}&month=${MONTH}`,
        { headers: authHeaders(token) },
        testEnv
      ),
    ]);
    const history = (await historyRes.json()) as { months: Array<{ month: number; net: number }> };
    const overview = (await overviewRes.json()) as {
      netSavings: number;
      income: { total: number };
      spending: { monthlyPayments: number; spendings: number };
    };
    const historyNet = history.months.find((m) => m.month === MONTH)?.net;

    expect(overview.income.total).toBe(EXPECTED_INCOME);
    expect(overview.spending.monthlyPayments).toBe(RECURRING_AMOUNT);
    expect(overview.spending.spendings).toBe(EXPECTED_SPEND);
    expect(overview.netSavings).toBe(EXPECTED_NET);

    // Two independent formulas, same household+month, same number.
    expect(overview.netSavings).toBe(historyNet);
  });

  it('projection carries the completed month through unchanged — no re-derivation', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    await seedIncomeAndRecurring(token, app);

    const [historyRes, projectionRes] = await Promise.all([
      app.request(`/households/${HID}/savings/history/year?year=${YEAR}`, { headers: authHeaders(token) }, testEnv),
      app.request(`/households/${HID}/savings/projection?year=${YEAR}`, { headers: authHeaders(token) }, testEnv),
    ]);
    expect(projectionRes.status).toBe(200);
    const history = (await historyRes.json()) as { months: Array<{ month: number; net: number }> };
    const projection = (await projectionRes.json()) as {
      months: Array<{
        month: number;
        status: 'actual' | 'current' | 'future';
        actualNet: number | null;
        projectedNet: number;
      }>;
    };
    const historyNet = history.months.find((m) => m.month === MONTH)?.net;
    const projRow = projection.months.find((m) => m.month === MONTH);

    expect(projRow).toBeTruthy();
    expect(projRow?.status).toBe('actual');
    expect(projRow?.actualNet).toBe(EXPECTED_NET);
    expect(projRow?.actualNet).toBe(historyNet);
    expect(projRow?.projectedNet).toBe(projRow?.actualNet);
  });
});
