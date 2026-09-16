/**
 * savings.ts routes — overview math (incl. Home-from-Budget rollup + ytdNet),
 * income/spending/category CRUD, goals, registered accounts (transactions +
 * idempotent apply-regular + IDOR), income templates + recurring payments
 * idempotency, and the AI-import kill switch / error codes.
 *
 * Vitest + `@cloudflare/vitest-pool-workers` (Miniflare D1 + KV). Mirrors
 * `budget.test.ts` setup: applies DDL, seeds a household + member + a second
 * household for scoping/IDOR, and mints a real HS256 JWT.
 *
 * The peer-owned services (`savings-service.ts`, `savings-import-service.ts`)
 * are exercised through the router; these are true route-level integration
 * tests. The AI-import happy path is NOT tested here (no live Anthropic call) —
 * we cover the kill switch, auth/scoping, and the file-validation error codes
 * (`UNSUPPORTED_FILE_TYPE`, `IMPORT_TOO_LARGE`) which never reach the model.
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import * as schema from '../../db/schema';
import { createCoreTables, resetAllTables } from '../../services/aihousekeeper/__tests__/test-helpers';
import type { Env } from '../../types';
import savingsRouter from '../savings';

import { applyBudgetWorkerTestBrand } from './budget-test-helpers';
import { createSavingsTables, resetSavingsTables } from './savings-test-helpers';

const testEnv = env as unknown as Env;

const HID = 'hh_savings_routes_01';
const UID = 'u_savings_routes_owner';
const MID = 'm_savings_routes_owner';

const OTHER_HID = 'hh_savings_routes_other';
const OTHER_UID = 'u_savings_routes_outsider';
const OTHER_MID = 'm_savings_routes_outsider';

// Client-generated UUIDs for money-mutating creates (plan W2: idempotent id PK).
const IDS = {
  income1: '64aab900-2bcf-4b38-aa47-045e318288be',
  income2: '44ccdc97-813c-456c-8f46-2000cbfc95b6',
  spending1: '6258c134-59e1-4512-b327-f064ff86e0c0',
  category1: 'ec897516-ceab-4069-b0b6-e1d2b006bb46',
  goal1: '9b2f954c-d752-464b-8cc0-9c6c3e46ec0a',
  accountA: 'c0c5a9b5-766e-4f12-8b15-5b3f74ab14d6',
  accountB: '5eeb1432-e8ca-4985-973c-656c8939eca4',
  tx1: '29d0cae2-e6f4-4539-8094-2184c1349cfb',
  tx2: '9d1d16fa-6474-46e6-a1bc-fc6d69d920e3',
  template1: 'be037ea8-0662-4f67-b7cb-8f205130bc58',
  recurring1: 'fac02512-bf43-4db1-b637-8cb32ad5d64b',
  recurring2: 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d',
};

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
  app.route('/households/:householdId/savings', savingsRouter);
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
  await db.insert(schema.users).values([
    { id: UID, email: 'savings-routes@example.com', email_verified: true },
    { id: OTHER_UID, email: 'savings-outsider@example.com', email_verified: true },
  ]);
  await db.insert(schema.households).values([
    { id: HID, name: 'SavingsRoutesTest' },
    { id: OTHER_HID, name: 'SavingsRoutesOther' },
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

describe('savings routes', () => {
  beforeEach(async () => {
    await seed();
    // Default to the feature enabled — kill-switch tests set the flag explicitly.
    await testEnv.CONFIG_KV.delete('savings_enabled');
    await testEnv.CONFIG_KV.delete('savings_import_enabled');
  });

  afterEach(async () => {
    await testEnv.CONFIG_KV.delete('savings_enabled');
    await testEnv.CONFIG_KV.delete('savings_import_enabled');
  });

  // ==================================================================
  // Auth & kill switch
  // ==================================================================

  describe('auth & kill switch', () => {
    it('returns 401 for an unauthenticated request', async () => {
      const app = mkApp();
      const res = await app.request(
        `/households/${HID}/savings/overview?year=2026&month=6`,
        {},
        testEnv
      );
      expect(res.status).toBe(401);
    });

    it('returns 403 for a member of another household', async () => {
      const token = await mintToken(OTHER_UID);
      const app = mkApp();
      const res = await app.request(
        `/households/${HID}/savings/overview?year=2026&month=6`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(res.status).toBe(403);
    });

    it('serves the feature when savings_enabled is absent (default enabled)', async () => {
      await testEnv.CONFIG_KV.delete('savings_enabled');
      const token = await mintToken(UID);
      const app = mkApp();
      const res = await app.request(
        `/households/${HID}/savings/overview?year=2026&month=6`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(res.status).toBe(200);
    });

    it('404s the whole surface when savings_enabled === "false"', async () => {
      await testEnv.CONFIG_KV.put('savings_enabled', 'false');
      const token = await mintToken(UID);
      const app = mkApp();
      const res = await app.request(
        `/households/${HID}/savings/overview?year=2026&month=6`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(res.status).toBe(404);
    });

    it('serves when savings_enabled === "true"', async () => {
      await testEnv.CONFIG_KV.put('savings_enabled', 'true');
      const token = await mintToken(UID);
      const app = mkApp();
      const res = await app.request(
        `/households/${HID}/savings/overview?year=2026&month=6`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(res.status).toBe(200);
    });

    it('only the literal "false" disables — "FALSE" and "0" stay enabled', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await testEnv.CONFIG_KV.put('savings_enabled', 'FALSE');
      const upper = await app.request(
        `/households/${HID}/savings/overview?year=2026&month=6`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(upper.status).toBe(200);

      await testEnv.CONFIG_KV.put('savings_enabled', '0');
      const zero = await app.request(
        `/households/${HID}/savings/overview?year=2026&month=6`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(zero.status).toBe(200);
    });
  });

  // ==================================================================
  // Overview math: income − monthly payments − Budget spendings + ytdNet
  // ==================================================================

  describe('GET /overview', () => {
    it('nets income − monthly payments − Budget spendings (single source of truth)', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      // Income: $2,000 in June.
      const incomeRes = await app.request(
        `/households/${HID}/savings/income`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.income1,
            source_type: 'payroll',
            label: 'June paycheck',
            amount_cents: 200000,
            income_date: '2026-06-15',
          }),
        },
        testEnv
      );
      expect(incomeRes.status).toBe(201);

      // A legacy savings-spending entry: $300 in June. Under the single-source
      // model this is NO LONGER part of net (Budget `expenses` is the one spend
      // store), so it must be ignored below.
      const spendRes = await app.request(
        `/households/${HID}/savings/spending`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.spending1,
            label: 'Groceries',
            amount_cents: 30000,
            spending_date: '2026-06-10',
          }),
        },
        testEnv
      );
      expect(spendRes.status).toBe(201);

      // The Budget "Spendings" for June ($500) — THE single source of truth for
      // spend; deducted from net savings.
      await testEnv.DB.prepare(
        `INSERT INTO expenses (id, household_id, title, amount, expense_date, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`
      )
        .bind('exp-june-1', HID, 'Home repair', 50000, '2026-06-20')
        .run();

      const res = await app.request(
        `/households/${HID}/savings/overview?year=2026&month=6`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        income: { total: number };
        spending: { monthlyPayments: number; spendings: number; total: number };
        netSavings: number;
        ytdNet: number;
      };

      expect(body.income.total).toBe(200000);
      expect(body.spending.monthlyPayments).toBe(0);
      // Spendings = Budget expenses ($500) — the legacy $300 savings entry is ignored.
      expect(body.spending.spendings).toBe(50000);
      expect(body.spending.total).toBe(50000);
      // net = income − monthlyPayments − spendings = 200000 − 0 − 50000 = 150000
      expect(body.netSavings).toBe(150000);
      // Only June activity so far → ytdNet equals this month's net.
      expect(body.ytdNet).toBe(150000);
    });

    it('deducts the flat active recurring total even when not copied into the month', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      // Income: $2,000 in June.
      await app.request(
        `/households/${HID}/savings/income`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.income1,
            source_type: 'payroll',
            label: 'June paycheck',
            amount_cents: 200000,
            income_date: '2026-06-15',
          }),
        },
        testEnv
      );

      // Active recurring payment: $1,000/mo — NOT copied into June.
      await app.request(
        `/households/${HID}/savings/recurring-payments`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.recurring1,
            label: 'Mortgage',
            amount_cents: 100000,
            day_of_month: 1,
            active: true,
          }),
        },
        testEnv
      );

      const res = await app.request(
        `/households/${HID}/savings/overview?year=2026&month=6`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        spending: { monthlyPayments: number; spendings: number; total: number };
        netSavings: number;
        ytdNet: number;
      };

      // Flat baseline is deducted even though nothing was copied in.
      expect(body.spending.monthlyPayments).toBe(100000);
      expect(body.spending.spendings).toBe(0);
      expect(body.spending.total).toBe(100000);
      // June net = 200000 − 100000 − 0 = 100000
      expect(body.netSavings).toBe(100000);
      // ytd (Jan..Jun) applies the SAME formula every month: only June has income,
      // but the flat $1,000 baseline is deducted all 6 months →
      // 200000 − 6×100000 = −400000.
      expect(body.ytdNet).toBe(-400000);
    });

    it('deducts monthly payments consistently even with no income (net goes negative)', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      // An active recurring payment exists; the target month has no income and
      // no Budget spend. The flat baseline is STILL deducted (consistency).
      await app.request(
        `/households/${HID}/savings/recurring-payments`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.recurring1,
            label: 'Mortgage',
            amount_cents: 100000,
            day_of_month: 1,
            active: true,
          }),
        },
        testEnv
      );

      const res = await app.request(
        `/households/${HID}/savings/overview?year=2026&month=1`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        spending: { monthlyPayments: number; spendings: number; total: number };
        netSavings: number;
        ytdNet: number;
      };
      expect(body.spending.monthlyPayments).toBe(100000);
      expect(body.spending.spendings).toBe(0);
      expect(body.spending.total).toBe(100000);
      // net = 0 − 100000 − 0 = −100000
      expect(body.netSavings).toBe(-100000);
      // January only → ytd equals this month's net.
      expect(body.ytdNet).toBe(-100000);
    });

    it('excludes a backfilled-income/no-expense month from ytdNet, but still banks a real one', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      // Jan: income backfilled via import, no expenses ever logged that month
      // — a one-sided backfill, the exact production bug (Budget dashboard
      // "Saved so far" / Savings "Year to date" reading as pure profit).
      await app.request(
        `/households/${HID}/savings/income`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.income1,
            source_type: 'payroll',
            label: 'Jan pay',
            amount_cents: 500000,
            income_date: '2026-01-15',
          }),
        },
        testEnv
      );
      // Feb: income AND expenses both logged — a genuine, trustworthy month.
      await app.request(
        `/households/${HID}/savings/income`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.income2,
            source_type: 'payroll',
            label: 'Feb pay',
            amount_cents: 500000,
            income_date: '2026-02-15',
          }),
        },
        testEnv
      );
      await testEnv.DB.prepare(
        `INSERT INTO expenses (id, household_id, title, amount, expense_date, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`
      )
        .bind('exp-feb', HID, 'Groceries', 200000, '2026-02-10')
        .run();

      const res = await app.request(
        `/households/${HID}/savings/overview?year=2026&month=2`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ytdNet: number };
      // Jan is excluded entirely (income with no logged spend); Feb banks
      // 500000 − 200000 = 300000. NOT 500000 + 300000 = 800000.
      expect(body.ytdNet).toBe(300000);
    });
  });

  // ==================================================================
  // Projection method selection — route wiring only; the math itself is
  // covered exhaustively in services/__tests__/savings-projection.test.ts.
  // ==================================================================

  describe('GET /projection method param + PUT /projection/method', () => {
    it('GET honors an explicit ?method=, and PUT /projection/method sets the household default', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      const explicit = await app.request(
        `/households/${HID}/savings/projection?year=2026&method=historical_average`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(explicit.status).toBe(200);
      const explicitBody = (await explicit.json()) as { method: string; methodComparison: unknown[] };
      expect(explicitBody.method).toBe('historical_average');
      expect(explicitBody.methodComparison).toHaveLength(4);

      // No default set yet — omitting `method` falls back to 'hybrid'.
      const defaulted = await app.request(
        `/households/${HID}/savings/projection?year=2026`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(((await defaulted.json()) as { method: string }).method).toBe('hybrid');

      const put = await app.request(
        `/households/${HID}/savings/projection/method`,
        {
          method: 'PUT',
          headers: authHeaders(token),
          body: JSON.stringify({ year: 2026, method: 'trend' }),
        },
        testEnv
      );
      expect(put.status).toBe(200);
      expect(((await put.json()) as { method: string }).method).toBe('trend');

      // The new default now applies even without an explicit ?method=.
      const afterDefault = await app.request(
        `/households/${HID}/savings/projection?year=2026`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(((await afterDefault.json()) as { method: string }).method).toBe('trend');
    });

    it('rejects an unknown method', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      const res = await app.request(
        `/households/${HID}/savings/projection?year=2026&method=not_a_method`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(res.status).toBe(400);
    });
  });

  // ==================================================================
  // Trend — flat-baseline math across months
  // ==================================================================

  describe('GET /trend', () => {
    it('per month: income − flat monthly payments − Budget spendings (deducted every month)', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      // $1,000/mo active recurring baseline — deducted EVERY month.
      await app.request(
        `/households/${HID}/savings/recurring-payments`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.recurring1,
            label: 'Mortgage',
            amount_cents: 100000,
            day_of_month: 1,
            active: true,
          }),
        },
        testEnv
      );

      // May: income $3,000. Budget spendings: April $200, May $500.
      await app.request(
        `/households/${HID}/savings/income`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.income1,
            source_type: 'payroll',
            label: 'May pay',
            amount_cents: 300000,
            income_date: '2026-05-15',
          }),
        },
        testEnv
      );
      await testEnv.DB.prepare(
        `INSERT INTO expenses (id, household_id, title, amount, expense_date, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`
      )
        .bind('exp-apr', HID, 'April fix', 20000, '2026-04-10')
        .run();
      await testEnv.DB.prepare(
        `INSERT INTO expenses (id, household_id, title, amount, expense_date, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`
      )
        .bind('exp-may', HID, 'May groceries', 50000, '2026-05-10')
        .run();

      const res = await app.request(
        `/households/${HID}/savings/trend?year=2026&month=6&months=3`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        months: Array<{
          period: string;
          income: number;
          spending: number;
          monthlyPayments: number;
          spendings: number;
          net: number;
        }>;
      };
      const byPeriod = Object.fromEntries(body.months.map((m) => [m.period, m]));

      // April: 0 income − 100000 baseline − 20000 spend → net −120000.
      expect(byPeriod['2026-04']).toMatchObject({ income: 0, spending: 120000, net: -120000 });
      expect(byPeriod['2026-04']).toMatchObject({ monthlyPayments: 100000, spendings: 20000 });
      // May: 300000 − 100000 baseline − 50000 spend → net 150000.
      expect(byPeriod['2026-05']).toMatchObject({
        income: 300000,
        spending: 150000,
        net: 150000,
      });
      expect(byPeriod['2026-05']).toMatchObject({ monthlyPayments: 100000, spendings: 50000 });
      // June: 0 income − 100000 baseline − 0 spend → net −100000.
      expect(byPeriod['2026-06']).toMatchObject({ income: 0, spending: 100000, net: -100000 });
      expect(byPeriod['2026-06']).toMatchObject({ monthlyPayments: 100000, spendings: 0 });
    });

    it('flags a month with income but zero logged expenses as untracked, not $0-spend', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      // January: income backfilled, but no expenses were ever logged that
      // month (e.g. an income-only import) — the household's real spend that
      // month is unknown, not zero.
      await app.request(
        `/households/${HID}/savings/income`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.income1,
            source_type: 'payroll',
            label: 'Jan pay',
            amount_cents: 500000,
            income_date: '2026-01-15',
          }),
        },
        testEnv
      );

      const res = await app.request(
        `/households/${HID}/savings/trend?year=2026&month=1&months=1`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        months: Array<{ period: string; hasExpenseData: boolean }>;
      };
      expect(body.months[0].hasExpenseData).toBe(false);
    });
  });

  // ==================================================================
  // Income CRUD round-trip
  // ==================================================================

  describe('income CRUD', () => {
    it('creates, lists, updates, and deletes an income entry', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      const createRes = await app.request(
        `/households/${HID}/savings/income`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.income1,
            source_type: 'payroll',
            label: 'Paycheck',
            amount_cents: 150000,
            income_date: '2026-06-01',
          }),
        },
        testEnv
      );
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as { entry: { id: string; amount_cents: number } };
      expect(created.entry.id).toBe(IDS.income1);
      expect(created.entry.amount_cents).toBe(150000);

      const listRes = await app.request(
        `/households/${HID}/savings/income?year=2026&month=6`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(listRes.status).toBe(200);
      const listed = (await listRes.json()) as { entries: Array<{ id: string }> };
      expect(listed.entries.map((e) => e.id)).toContain(IDS.income1);

      const patchRes = await app.request(
        `/households/${HID}/savings/income/${IDS.income1}`,
        {
          method: 'PATCH',
          headers: authHeaders(token),
          body: JSON.stringify({ amount_cents: 175000 }),
        },
        testEnv
      );
      expect(patchRes.status).toBe(200);
      const patched = (await patchRes.json()) as { entry: { amount_cents: number } };
      expect(patched.entry.amount_cents).toBe(175000);

      const delRes = await app.request(
        `/households/${HID}/savings/income/${IDS.income1}`,
        { method: 'DELETE', headers: authHeaders(token) },
        testEnv
      );
      expect(delRes.status).toBe(200);
      const del = (await delRes.json()) as { success: boolean };
      expect(del.success).toBe(true);

      const afterRes = await app.request(
        `/households/${HID}/savings/income?year=2026&month=6`,
        { headers: authHeaders(token) },
        testEnv
      );
      const after = (await afterRes.json()) as { entries: Array<{ id: string }> };
      expect(after.entries.map((e) => e.id)).not.toContain(IDS.income1);
    });

    it('rejects a bad source_type enum with 400', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      const res = await app.request(
        `/households/${HID}/savings/income`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.income2,
            source_type: 'bogus',
            label: 'Bad',
            amount_cents: 1000,
            income_date: '2026-06-01',
          }),
        },
        testEnv
      );
      expect(res.status).toBe(400);
    });

    it('rejects a negative amount_cents with 400', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      const res = await app.request(
        `/households/${HID}/savings/income`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.income2,
            source_type: 'payroll',
            label: 'Bad',
            amount_cents: -1,
            income_date: '2026-06-01',
          }),
        },
        testEnv
      );
      expect(res.status).toBe(400);
    });
  });

  // ==================================================================
  // Income rollover: confirm / confirm-all / implicit confirm-on-edit
  // ==================================================================

  describe('income rollover confirm actions', () => {
    async function insertDraftIncome(id: string, incomeDate = '2026-08-15'): Promise<void> {
      await testEnv.DB.prepare(
        `INSERT INTO savings_income_entries
           (id, household_id, source_type, label, amount_cents, income_date, status, source, rolled_over_from_entry_id)
         VALUES (?, ?, 'payroll', 'Paycheck', 150000, ?, 'draft', 'rollover', ?)`
      )
        .bind(id, HID, incomeDate, `${id}_source`)
        .run();
    }

    it('confirms a draft as-is via POST /income/:id/confirm', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      await insertDraftIncome(IDS.income1);

      const res = await app.request(
        `/households/${HID}/savings/income/${IDS.income1}/confirm`,
        { method: 'POST', headers: authHeaders(token), body: JSON.stringify({}) },
        testEnv
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { entry: { status: string } };
      expect(body.entry.status).toBe('confirmed');
    });

    it('confirms a draft with an amount patch in the same call', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      await insertDraftIncome(IDS.income1);

      const res = await app.request(
        `/households/${HID}/savings/income/${IDS.income1}/confirm`,
        { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ amount_cents: 160000 }) },
        testEnv
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { entry: { status: string; amount_cents: number } };
      expect(body.entry.status).toBe('confirmed');
      expect(body.entry.amount_cents).toBe(160000);
    });

    it('bulk-confirms every draft for a month via POST /income/confirm-all-drafts', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      await insertDraftIncome(IDS.income1, '2026-08-10');
      await insertDraftIncome(IDS.income2, '2026-08-20');

      const res = await app.request(
        `/households/${HID}/savings/income/confirm-all-drafts`,
        { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ year: 2026, month: 8 }) },
        testEnv
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { confirmed: number };
      expect(body.confirmed).toBe(2);

      const listRes = await app.request(
        `/households/${HID}/savings/income?year=2026&month=8`,
        { headers: authHeaders(token) },
        testEnv
      );
      const listed = (await listRes.json()) as { entries: Array<{ id: string; status: string }> };
      expect(listed.entries.every((e) => e.status === 'confirmed')).toBe(true);
    });

    it('implicitly confirms a draft when it is edited via PATCH', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      await insertDraftIncome(IDS.income1);

      const res = await app.request(
        `/households/${HID}/savings/income/${IDS.income1}`,
        { method: 'PATCH', headers: authHeaders(token), body: JSON.stringify({ amount_cents: 170000 }) },
        testEnv
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { entry: { status: string; amount_cents: number } };
      expect(body.entry.status).toBe('confirmed');
      expect(body.entry.amount_cents).toBe(170000);
    });

    it('a freshly-created income entry defaults straight to confirmed', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      const res = await app.request(
        `/households/${HID}/savings/income`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.income1,
            source_type: 'payroll',
            label: 'Paycheck',
            amount_cents: 150000,
            income_date: '2026-08-01',
          }),
        },
        testEnv
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as { entry: { status: string } };
      expect(body.entry.status).toBe('confirmed');
    });
  });

  // ==================================================================
  // Irregular (one-off) income
  // ==================================================================

  describe('irregular income sources', () => {
    it('accepts a marketplace sale as an income entry', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      const res = await app.request(
        `/households/${HID}/savings/income`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.income1,
            source_type: 'marketplace_sale',
            label: 'Sold couch on Marketplace',
            amount_cents: 12000,
            income_date: '2026-06-14',
          }),
        },
        testEnv
      );

      expect(res.status).toBe(201);
      const created = (await res.json()) as { entry: { source_type: string; amount_cents: number } };
      expect(created.entry.source_type).toBe('marketplace_sale');
      expect(created.entry.amount_cents).toBe(12000);
    });

    it.each(['gift', 'refund', 'bonus', 'freelance'])(
      'accepts %s as an income source type',
      async (sourceType) => {
        const token = await mintToken(UID);
        const app = mkApp();

        const res = await app.request(
          `/households/${HID}/savings/income`,
          {
            method: 'POST',
            headers: authHeaders(token),
            body: JSON.stringify({
              id: crypto.randomUUID(),
              source_type: sourceType,
              label: `One-off ${sourceType}`,
              amount_cents: 5000,
              income_date: '2026-06-10',
            }),
          },
          testEnv
        );

        expect(res.status).toBe(201);
      }
    );

    it('rejects an unknown income source type', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      const res = await app.request(
        `/households/${HID}/savings/income`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: crypto.randomUUID(),
            source_type: 'lottery',
            label: 'Not a real source',
            amount_cents: 5000,
            income_date: '2026-06-10',
          }),
        },
        testEnv
      );

      expect(res.status).toBe(400);
    });

    // Templates are materialised into future months by apply-templates, i.e.
    // they are the app's only forward-looking income construct. One-off income
    // must never be projected forward, so it is barred at the template routes.
    it.each(['marketplace_sale', 'gift', 'refund', 'bonus', 'freelance'])(
      'refuses to create a recurring income template for %s',
      async (sourceType) => {
        const token = await mintToken(UID);
        const app = mkApp();

        const res = await app.request(
          `/households/${HID}/savings/income-templates`,
          {
            method: 'POST',
            headers: authHeaders(token),
            body: JSON.stringify({
              id: crypto.randomUUID(),
              source_type: sourceType,
              label: 'Should not be projectable',
              amount_cents: 20000,
              day_of_month: 15,
            }),
          },
          testEnv
        );

        expect(res.status).toBe(400);
      }
    );

    it('still allows a regular source to back an income template', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      const res = await app.request(
        `/households/${HID}/savings/income-templates`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.template1,
            source_type: 'payroll',
            label: 'Salary',
            amount_cents: 300000,
            day_of_month: 15,
          }),
        },
        testEnv
      );

      expect(res.status).toBe(201);
    });

    it('refuses to convert an existing template to an irregular source', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      const createRes = await app.request(
        `/households/${HID}/savings/income-templates`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.template1,
            source_type: 'payroll',
            label: 'Salary',
            amount_cents: 300000,
            day_of_month: 15,
          }),
        },
        testEnv
      );
      expect(createRes.status).toBe(201);

      const patchRes = await app.request(
        `/households/${HID}/savings/income-templates/${IDS.template1}`,
        {
          method: 'PATCH',
          headers: authHeaders(token),
          body: JSON.stringify({ source_type: 'marketplace_sale' }),
        },
        testEnv
      );

      expect(patchRes.status).toBe(400);
    });

    it('splits the overview income total into regular and irregular buckets', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await app.request(
        `/households/${HID}/savings/income`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.income1,
            source_type: 'payroll',
            label: 'Paycheck',
            amount_cents: 400000,
            income_date: '2026-06-01',
          }),
        },
        testEnv
      );
      await app.request(
        `/households/${HID}/savings/income`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.income2,
            source_type: 'marketplace_sale',
            label: 'Sold bike',
            amount_cents: 25000,
            income_date: '2026-06-12',
          }),
        },
        testEnv
      );

      const res = await app.request(
        `/households/${HID}/savings/overview?year=2026&month=6`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        income: { total: number; regularTotal: number; irregularTotal: number };
      };
      expect(body.income.total).toBe(425000);
      expect(body.income.regularTotal).toBe(400000);
      expect(body.income.irregularTotal).toBe(25000);
      // The split must always reconcile to the headline total.
      expect(body.income.regularTotal + body.income.irregularTotal).toBe(body.income.total);
    });

    it("counts legacy 'other' income as regular, not irregular", async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await app.request(
        `/households/${HID}/savings/income`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.income1,
            source_type: 'other',
            label: 'Misc',
            amount_cents: 9000,
            income_date: '2026-06-03',
          }),
        },
        testEnv
      );

      const res = await app.request(
        `/households/${HID}/savings/overview?year=2026&month=6`,
        { headers: authHeaders(token) },
        testEnv
      );
      const body = (await res.json()) as {
        income: { regularTotal: number; irregularTotal: number };
      };

      expect(body.income.regularTotal).toBe(9000);
      expect(body.income.irregularTotal).toBe(0);
    });
  });

  // ==================================================================
  // Category deletion detaches spending
  // ==================================================================

  describe('category CRUD', () => {
    it('deleting a category detaches referencing spending (category_id → null)', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      const catRes = await app.request(
        `/households/${HID}/savings/categories`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({ name: 'Dining', is_essential: false }),
        },
        testEnv
      );
      expect(catRes.status).toBe(201);
      const cat = (await catRes.json()) as { category: { id: string } };

      const spendRes = await app.request(
        `/households/${HID}/savings/spending`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.spending1,
            category_id: cat.category.id,
            label: 'Dinner out',
            amount_cents: 8000,
            spending_date: '2026-06-12',
          }),
        },
        testEnv
      );
      expect(spendRes.status).toBe(201);

      const delRes = await app.request(
        `/households/${HID}/savings/categories/${cat.category.id}`,
        { method: 'DELETE', headers: authHeaders(token) },
        testEnv
      );
      expect(delRes.status).toBe(200);

      // The spending row survives with a null category_id (detached, not deleted).
      const row = await testEnv.DB.prepare(
        `SELECT category_id FROM savings_spending_entries WHERE id = ?`
      )
        .bind(IDS.spending1)
        .first<{ category_id: string | null }>();
      expect(row?.category_id).toBeNull();
    });
  });

  // ==================================================================
  // Goals + emergency-fund suggestion route ordering
  // ==================================================================

  describe('goals', () => {
    it('creates a goal and lists it', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      const res = await app.request(
        `/households/${HID}/savings/goals`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.goal1,
            type: 'custom',
            name: 'New roof',
            target_amount_cents: 1500000,
          }),
        },
        testEnv
      );
      expect(res.status).toBe(201);
      const created = (await res.json()) as { goal: { id: string; name: string } };
      expect(created.goal.id).toBe(IDS.goal1);

      const listRes = await app.request(
        `/households/${HID}/savings/goals`,
        { headers: authHeaders(token) },
        testEnv
      );
      const listed = (await listRes.json()) as { goals: Array<{ id: string }> };
      expect(listed.goals.map((g) => g.id)).toContain(IDS.goal1);
    });

    it('marks a goal achieved or archived via PATCH (BUDGET-SAVE-037)', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      const createRes = await app.request(
        `/households/${HID}/savings/goals`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.goal1,
            type: 'custom',
            name: 'Vacation',
            target_amount_cents: 500000,
            current_amount_cents: 500000,
          }),
        },
        testEnv
      );
      expect(createRes.status).toBe(201);

      const achievedRes = await app.request(
        `/households/${HID}/savings/goals/${IDS.goal1}`,
        {
          method: 'PATCH',
          headers: authHeaders(token),
          body: JSON.stringify({ status: 'achieved' }),
        },
        testEnv
      );
      expect(achievedRes.status).toBe(200);
      const achieved = (await achievedRes.json()) as { goal: { status: string } };
      expect(achieved.goal.status).toBe('achieved');

      const archivedRes = await app.request(
        `/households/${HID}/savings/goals/${IDS.goal1}`,
        {
          method: 'PATCH',
          headers: authHeaders(token),
          body: JSON.stringify({ status: 'archived' }),
        },
        testEnv
      );
      expect(archivedRes.status).toBe(200);
      const archived = (await archivedRes.json()) as { goal: { status: string } };
      expect(archived.goal.status).toBe('archived');
    });

    it('routes /goals/emergency-fund/suggestion to the suggestion handler (not /goals/:id)', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      const res = await app.request(
        `/households/${HID}/savings/goals/emergency-fund/suggestion?months=6`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        suggestedTarget: number;
        essentialMonthlySpending: number;
        months: number;
      };
      // No history seeded → the service returns a NO_HISTORY / zero-target shape,
      // but the response must have the suggestion fields, proving specific-route
      // registration beats the `/goals/:id` param route.
      expect(body).toHaveProperty('suggestedTarget');
      expect(body.months).toBe(6);
    });

    // ------------------------------------------------------------------
    // Goal progress auto-accrual — current_amount_cents is overlaid with net
    // savings (income − monthlyPayments − budgetSpendings) banked every month
    // since the goal was created, so logging income/spending moves the
    // progress bar without a separate manual "contribution" step.
    // ------------------------------------------------------------------
    describe('goal progress — accrued from net savings', () => {
      function ymd(d: Date): string {
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
          d.getUTCDate()
        ).padStart(2, '0')}`;
      }
      // Fixed day-of-month (15th) so month arithmetic never rolls over.
      function monthsAgo(n: number): Date {
        const now = new Date();
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 15));
      }

      it('overlays this-month net savings onto a freshly created goal with no manual funding or deadline', async () => {
        const token = await mintToken(UID);
        const app = mkApp();

        const createRes = await app.request(
          `/households/${HID}/savings/goals`,
          {
            method: 'POST',
            headers: authHeaders(token),
            body: JSON.stringify({
              id: IDS.goal1,
              type: 'emergency_fund',
              name: 'Safety pillow',
              target_amount_cents: 1000000,
            }),
          },
          testEnv
        );
        expect(createRes.status).toBe(201);

        await app.request(
          `/households/${HID}/savings/income`,
          {
            method: 'POST',
            headers: authHeaders(token),
            body: JSON.stringify({
              id: IDS.income1,
              source_type: 'payroll',
              label: 'This month pay',
              amount_cents: 500000,
              income_date: ymd(monthsAgo(0)),
            }),
          },
          testEnv
        );
        await testEnv.DB.prepare(
          `INSERT INTO expenses (id, household_id, title, amount, expense_date, created_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`
        )
          .bind('exp-goal-this-month', HID, 'Groceries', 100000, ymd(monthsAgo(0)))
          .run();

        const listRes = await app.request(
          `/households/${HID}/savings/goals`,
          { headers: authHeaders(token) },
          testEnv
        );
        const { goals } = (await listRes.json()) as {
          goals: Array<{ id: string; current_amount_cents: number; paceCents: number }>;
        };
        const goal = goals.find((g) => g.id === IDS.goal1);
        expect(goal?.current_amount_cents).toBe(400000); // 500000 income − 100000 spent

        // No target_date on an emergency_fund goal (the mobile form never
        // exposes one for this type) → no computable deadline, so pace stays
        // hidden instead of defaulting to "the whole $1,000,000 target, due
        // this month" (the pre-fix behavior).
        expect(goal?.paceCents).toBe(0);
      });

      it('adds accrued net savings on top of a manual starting balance, skipping a backfilled past month with no logged spend', async () => {
        const token = await mintToken(UID);
        const app = mkApp();

        const createRes = await app.request(
          `/households/${HID}/savings/goals`,
          {
            method: 'POST',
            headers: authHeaders(token),
            body: JSON.stringify({
              id: IDS.goal1,
              type: 'custom',
              name: 'New roof',
              target_amount_cents: 5000000,
              current_amount_cents: 200000,
            }),
          },
          testEnv
        );
        expect(createRes.status).toBe(201);

        // Backdate creation two months so the accrual window spans 3 months.
        await testEnv.DB.prepare(`UPDATE savings_goals SET created_at = ? WHERE id = ?`)
          .bind(`${ymd(monthsAgo(2))} 00:00:00`, IDS.goal1)
          .run();

        // T-2: income logged, no expenses ever recorded — a one-sided
        // backfill, excluded from the accrual just like ytdNet excludes it.
        await app.request(
          `/households/${HID}/savings/income`,
          {
            method: 'POST',
            headers: authHeaders(token),
            body: JSON.stringify({
              id: IDS.income1,
              source_type: 'payroll',
              label: 'T-2 pay',
              amount_cents: 500000,
              income_date: ymd(monthsAgo(2)),
            }),
          },
          testEnv
        );
        // T-1: income AND expenses both logged — a genuine month, net 200000.
        await app.request(
          `/households/${HID}/savings/income`,
          {
            method: 'POST',
            headers: authHeaders(token),
            body: JSON.stringify({
              id: IDS.income2,
              source_type: 'payroll',
              label: 'T-1 pay',
              amount_cents: 300000,
              income_date: ymd(monthsAgo(1)),
            }),
          },
          testEnv
        );
        await testEnv.DB.prepare(
          `INSERT INTO expenses (id, household_id, title, amount, expense_date, created_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`
        )
          .bind('exp-goal-t1', HID, 'T-1 spend', 100000, ymd(monthsAgo(1)))
          .run();
        // This month (T): income + expenses, net 350000. Always counted — a
        // "so far" figure, same rule as ytdNet's current-month handling.
        await app.request(
          `/households/${HID}/savings/income`,
          {
            method: 'POST',
            headers: authHeaders(token),
            body: JSON.stringify({
              id: 'aab7e8a1-3d2b-4a5e-9c1f-9a0b2c3d4e5f',
              source_type: 'payroll',
              label: 'T pay',
              amount_cents: 400000,
              income_date: ymd(monthsAgo(0)),
            }),
          },
          testEnv
        );
        await testEnv.DB.prepare(
          `INSERT INTO expenses (id, household_id, title, amount, expense_date, created_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`
        )
          .bind('exp-goal-t0', HID, 'T spend', 50000, ymd(monthsAgo(0)))
          .run();

        const listRes = await app.request(
          `/households/${HID}/savings/goals`,
          { headers: authHeaders(token) },
          testEnv
        );
        const { goals } = (await listRes.json()) as {
          goals: Array<{ id: string; current_amount_cents: number }>;
        };
        const goal = goals.find((g) => g.id === IDS.goal1);
        // base 200000 + (T-2 skipped) + (T-1: 300000−100000=200000) + (T: 400000−50000=350000)
        expect(goal?.current_amount_cents).toBe(750000);
      });

      it('a target_date still yields a real pace once the deadline is set', async () => {
        const token = await mintToken(UID);
        const app = mkApp();

        // Deadline 2 months out (relative to now, so the test never rots).
        const now = new Date();
        const targetDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));

        const createRes = await app.request(
          `/households/${HID}/savings/goals`,
          {
            method: 'POST',
            headers: authHeaders(token),
            body: JSON.stringify({
              id: IDS.goal1,
              type: 'custom',
              name: 'New laptop',
              target_amount_cents: 300000,
              target_date: ymd(targetDate),
            }),
          },
          testEnv
        );
        expect(createRes.status).toBe(201);

        const listRes = await app.request(
          `/households/${HID}/savings/goals`,
          { headers: authHeaders(token) },
          testEnv
        );
        const { goals } = (await listRes.json()) as {
          goals: Array<{ id: string; paceCents: number }>;
        };
        const goal = goals.find((g) => g.id === IDS.goal1);
        // remaining 300000 over ~2 months → a real, non-zero, non-full-target pace.
        expect(goal?.paceCents).toBeGreaterThan(0);
        expect(goal?.paceCents).toBeLessThan(300000);
      });

      it('overview (Overview tab) reports the same current_amount as the Goals tab for the same month', async () => {
        const token = await mintToken(UID);
        const app = mkApp();

        await app.request(
          `/households/${HID}/savings/goals`,
          {
            method: 'POST',
            headers: authHeaders(token),
            body: JSON.stringify({
              id: IDS.goal1,
              type: 'emergency_fund',
              name: 'Safety pillow',
              target_amount_cents: 1000000,
            }),
          },
          testEnv
        );
        await app.request(
          `/households/${HID}/savings/income`,
          {
            method: 'POST',
            headers: authHeaders(token),
            body: JSON.stringify({
              id: IDS.income1,
              source_type: 'payroll',
              label: 'This month pay',
              amount_cents: 500000,
              income_date: ymd(monthsAgo(0)),
            }),
          },
          testEnv
        );

        const now = new Date();
        const overviewRes = await app.request(
          `/households/${HID}/savings/overview?year=${now.getUTCFullYear()}&month=${
            now.getUTCMonth() + 1
          }`,
          { headers: authHeaders(token) },
          testEnv
        );
        const overviewBody = (await overviewRes.json()) as {
          goals: Array<{ id: string; current: number }>;
        };

        const listRes = await app.request(
          `/households/${HID}/savings/goals`,
          { headers: authHeaders(token) },
          testEnv
        );
        const listBody = (await listRes.json()) as {
          goals: Array<{ id: string; current_amount_cents: number }>;
        };

        const fromOverview = overviewBody.goals.find((g) => g.id === IDS.goal1)?.current;
        const fromList = listBody.goals.find((g) => g.id === IDS.goal1)?.current_amount_cents;
        expect(fromOverview).toBe(500000);
        expect(fromOverview).toBe(fromList);
      });
    });
  });

  // ==================================================================
  // Registered accounts: transactions, room, IDOR, idempotent apply-regular
  // ==================================================================

  describe('registered accounts', () => {
    async function createAccountA(token: string, app: ReturnType<typeof mkApp>) {
      const res = await app.request(
        `/households/${HID}/savings/registered`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.accountA,
            account_type: 'tfsa',
            institution: 'Test Bank',
            balance_cents: 0,
            starting_room_cents: 700000,
            regular_contribution_cents: 50000,
          }),
        },
        testEnv
      );
      expect(res.status).toBe(201);
      return (await res.json()) as { account: { id: string; balance_cents: number } };
    }

    it('a transaction adjusts the account balance (regular + manual both count)', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      await createAccountA(token, app);

      const txRes = await app.request(
        `/households/${HID}/savings/registered/${IDS.accountA}/transactions`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.tx1,
            type: 'contribution',
            kind: 'manual',
            amount_cents: 120000,
            transaction_date: '2026-06-05',
          }),
        },
        testEnv
      );
      expect(txRes.status).toBe(201);
      const tx = (await txRes.json()) as {
        transaction: { id: string; kind: string };
        account: { balance_cents: number };
      };
      expect(tx.transaction.kind).toBe('manual');
      expect(tx.account.balance_cents).toBe(120000);

      // Room reflects both the manual contribution and (below) a regular one.
      const roomRes = await app.request(
        `/households/${HID}/savings/registered/${IDS.accountA}/room?year=2026`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(roomRes.status).toBe(200);
      const room = (await roomRes.json()) as {
        used: number;
        usedByKind: { regular: number; manual: number };
        warnings: string[];
      };
      expect(room.usedByKind.manual).toBe(120000);
      expect(room.used).toBe(120000);
      expect(Array.isArray(room.warnings)).toBe(true);
    });

    it('rejects a bad transaction kind enum with 400', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      await createAccountA(token, app);
      const res = await app.request(
        `/households/${HID}/savings/registered/${IDS.accountA}/transactions`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.tx2,
            type: 'contribution',
            kind: 'weird',
            amount_cents: 1000,
            transaction_date: '2026-06-05',
          }),
        },
        testEnv
      );
      expect(res.status).toBe(400);
    });

    it('applyRegularContribution is idempotent (apply same month twice → one row, balance moves once)', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      await createAccountA(token, app);

      const first = await app.request(
        `/households/${HID}/savings/registered/${IDS.accountA}/apply-regular`,
        { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ year: 2026, month: 6 }) },
        testEnv
      );
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as {
        created: boolean;
        account: { balance_cents: number };
      };
      expect(firstBody.created).toBe(true);
      expect(firstBody.account.balance_cents).toBe(50000);

      const second = await app.request(
        `/households/${HID}/savings/registered/${IDS.accountA}/apply-regular`,
        { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ year: 2026, month: 6 }) },
        testEnv
      );
      expect(second.status).toBe(200);
      const secondBody = (await second.json()) as {
        created: boolean;
        account: { balance_cents: number };
      };
      expect(secondBody.created).toBe(false);
      // Balance did NOT move again.
      expect(secondBody.account.balance_cents).toBe(50000);

      // Exactly one auto (period-tagged) row exists for the month.
      const count = await testEnv.DB.prepare(
        `SELECT COUNT(*) AS n FROM registered_transactions WHERE account_id = ? AND period = ?`
      )
        .bind(IDS.accountA, '2026-06')
        .first<{ n: number }>();
      expect(count?.n).toBe(1);
    });

    it('cross-household IDOR: a member of A using an account id from B gets 404', async () => {
      const ownerToken = await mintToken(UID);
      const outsiderToken = await mintToken(OTHER_UID);
      const app = mkApp();

      // Create account B under the OTHER household (as its own member).
      const bRes = await app.request(
        `/households/${OTHER_HID}/savings/registered`,
        {
          method: 'POST',
          headers: authHeaders(outsiderToken),
          body: JSON.stringify({ id: IDS.accountB, account_type: 'rrsp', balance_cents: 0 }),
        },
        testEnv
      );
      expect(bRes.status).toBe(201);

      // Member of A resolves hid from param (HID) but passes account id from B.
      const room = await app.request(
        `/households/${HID}/savings/registered/${IDS.accountB}/room?year=2026`,
        { headers: authHeaders(ownerToken) },
        testEnv
      );
      expect(room.status).toBe(404);

      const tx = await app.request(
        `/households/${HID}/savings/registered/${IDS.accountB}/transactions`,
        {
          method: 'POST',
          headers: authHeaders(ownerToken),
          body: JSON.stringify({
            id: IDS.tx1,
            type: 'contribution',
            amount_cents: 1000,
            transaction_date: '2026-06-05',
          }),
        },
        testEnv
      );
      expect(tx.status).toBe(404);
    });

    it('overview reports the self/employer split and annual-goal progress', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      const acctId = 'a1b2c3d4-0000-4000-8000-000000000001';

      // Group RRSP with a $10,000 annual goal and $20,000 NOA room.
      const createRes = await app.request(
        `/households/${HID}/savings/registered`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: acctId,
            account_type: 'rrsp',
            is_employer_plan: true,
            employer_name: 'Acme',
            annual_goal_cents: 1000000,
            starting_room_cents: 2000000,
          }),
        },
        testEnv
      );
      expect(createRes.status).toBe(201);

      // $3,000 self + $1,500 employer, both this year.
      for (const [id, contributor, amount] of [
        ['a1b2c3d4-0000-4000-8000-000000000002', 'self', 300000],
        ['a1b2c3d4-0000-4000-8000-000000000003', 'employer', 150000],
      ] as const) {
        const r = await app.request(
          `/households/${HID}/savings/registered/${acctId}/transactions`,
          {
            method: 'POST',
            headers: authHeaders(token),
            body: JSON.stringify({
              id,
              type: 'contribution',
              kind: 'manual',
              contributor,
              amount_cents: amount,
              transaction_date: '2026-03-01',
            }),
          },
          testEnv
        );
        expect(r.status).toBe(201);
      }

      const res = await app.request(
        `/households/${HID}/savings/registered/overview?year=2026`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(res.status).toBe(200);
      const ov = (await res.json()) as {
        totals: {
          totalContributedSelfCents: number;
          totalContributedEmployerCents: number;
          goalCents: number;
          goalContributedCents: number;
          goalPct: number;
        };
        groups: Array<{
          accounts: Array<{
            account: { id: string };
            room: { usedByContributor: { self: number; employer: number }; goalPct: number };
          }>;
        }>;
      };
      expect(ov.totals.totalContributedSelfCents).toBe(300000);
      expect(ov.totals.totalContributedEmployerCents).toBe(150000);
      expect(ov.totals.goalCents).toBe(1000000);
      expect(ov.totals.goalContributedCents).toBe(450000);
      expect(ov.totals.goalPct).toBe(45);

      const acct = ov.groups.flatMap((g) => g.accounts).find((a) => a.account.id === acctId);
      expect(acct?.room.usedByContributor).toEqual({ self: 300000, employer: 150000 });
      expect(acct?.room.goalPct).toBe(45);
    });
  });

  // ==================================================================
  // Pension "Room" tab — set a member's contribution room without an account
  // ==================================================================

  describe('member room (PUT /registered/member-room)', () => {
    // Real member ids are UUIDs in production; the harness owner id (MID) is not, so add a
    // fresh UUID user+member under HID for these tests. A never-inserted UUID drives the 404.
    const ROOM_UID = '11111111-1111-4111-8111-111111111111';
    const ROOM_MID = '22222222-2222-4222-8222-222222222222';
    const ABSENT_MID = '99999999-9999-4999-8999-999999999999';

    beforeEach(async () => {
      const db = drizzle(testEnv.DB, { schema });
      await db
        .insert(schema.users)
        .values({ id: ROOM_UID, email: 'room-member@example.com', email_verified: true });
      await db.insert(schema.householdMembers).values({
        id: ROOM_MID,
        household_id: HID,
        user_id: ROOM_UID,
        role: 'member',
        joined_at: '2025-01-01T00:00:00Z',
      });
    });

    type OverviewResp = {
      groups: {
        memberId: string | null;
        memberName: string | null;
        memberAvatarUrl: string | null;
        accounts: {
          account: { id: string; account_type: string; is_room_only: boolean; member_id: string | null };
          room: { roomRemaining: number };
        }[];
      }[];
    };

    async function setRoom(
      token: string,
      app: ReturnType<typeof mkApp>,
      body: { member_id: string; account_type: string; room_cents: number },
      hid = HID
    ) {
      return app.request(
        `/households/${hid}/savings/registered/member-room`,
        { method: 'PUT', headers: authHeaders(token), body: JSON.stringify(body) },
        testEnv
      );
    }

    async function loadOverview(token: string, app: ReturnType<typeof mkApp>) {
      const res = await app.request(
        `/households/${HID}/savings/registered/overview?year=2026`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(res.status).toBe(200);
      return (await res.json()) as OverviewResp;
    }

    async function accountRowCount(): Promise<number> {
      const row = await testEnv.DB.prepare(
        `SELECT COUNT(*) AS n FROM registered_accounts WHERE household_id = ?`
      )
        .bind(HID)
        .first<{ n: number }>();
      return row?.n ?? 0;
    }

    it('creates a room-only account and reports roomRemaining === room_cents', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      const res = await setRoom(token, app, {
        member_id: ROOM_MID,
        account_type: 'rrsp',
        room_cents: 1500000,
      });
      expect(res.status).toBe(200);
      const { account } = (await res.json()) as { account: { is_room_only: boolean } | null };
      expect(account?.is_room_only).toBe(true);

      const ov = await loadOverview(token, app);
      const summary = ov.groups
        .flatMap((g) => g.accounts)
        .find((a) => a.account.account_type === 'rrsp');
      expect(summary?.account.is_room_only).toBe(true);
      expect(summary?.account.member_id).toBe(ROOM_MID);
      expect(summary?.room.roomRemaining).toBe(1500000);
    });

    it("surfaces the member's display name and avatar URL on the overview group", async () => {
      // The Pension → Room rows render a member avatar; the overview resolves it
      // from users.avatar_url so the thin client renders directly (no member store).
      await testEnv.DB.prepare('UPDATE users SET display_name = ?, avatar_url = ? WHERE id = ?')
        .bind('Room Member', 'https://cdn.example.com/room-member.png', ROOM_UID)
        .run();

      const token = await mintToken(UID);
      const app = mkApp();
      await setRoom(token, app, { member_id: ROOM_MID, account_type: 'rrsp', room_cents: 1500000 });

      const ov = await loadOverview(token, app);
      const group = ov.groups.find((g) => g.memberId === ROOM_MID);
      expect(group).toBeTruthy();
      expect(group?.memberName).toBe('Room Member');
      expect(group?.memberAvatarUrl).toBe('https://cdn.example.com/room-member.png');
    });

    it('returns memberAvatarUrl = null when the member has no avatar', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      await setRoom(token, app, { member_id: ROOM_MID, account_type: 'tfsa', room_cents: 500000 });

      const ov = await loadOverview(token, app);
      const group = ov.groups.find((g) => g.memberId === ROOM_MID);
      expect(group?.memberAvatarUrl).toBeNull();
    });

    it('updates in place — one row per (member, type), never a duplicate', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await setRoom(token, app, { member_id: ROOM_MID, account_type: 'tfsa', room_cents: 700000 });
      await setRoom(token, app, { member_id: ROOM_MID, account_type: 'tfsa', room_cents: 950000 });

      expect(await accountRowCount()).toBe(1);
      const ov = await loadOverview(token, app);
      const tfsa = ov.groups.flatMap((g) => g.accounts).find((a) => a.account.account_type === 'tfsa');
      expect(tfsa?.room.roomRemaining).toBe(950000);
    });

    it('room_cents = 0 clears a bare room-only placeholder (row removed)', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await setRoom(token, app, { member_id: ROOM_MID, account_type: 'rrsp', room_cents: 1200000 });
      expect(await accountRowCount()).toBe(1);

      const cleared = await setRoom(token, app, {
        member_id: ROOM_MID,
        account_type: 'rrsp',
        room_cents: 0,
      });
      expect(cleared.status).toBe(200);
      const { account } = (await cleared.json()) as { account: unknown | null };
      expect(account).toBeNull();
      expect(await accountRowCount()).toBe(0);
    });

    it('sets starting_room_cents on an existing REAL account instead of adding a row', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      // A real tracked TFSA account for the member.
      const created = await app.request(
        `/households/${HID}/savings/registered`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.accountA,
            member_id: ROOM_MID,
            account_type: 'tfsa',
            institution: 'Test Bank',
            balance_cents: 0,
          }),
        },
        testEnv
      );
      expect(created.status).toBe(201);

      await setRoom(token, app, { member_id: ROOM_MID, account_type: 'tfsa', room_cents: 800000 });

      expect(await accountRowCount()).toBe(1); // no duplicate room-only row
      const ov = await loadOverview(token, app);
      const tfsa = ov.groups.flatMap((g) => g.accounts).find((a) => a.account.id === IDS.accountA);
      expect(tfsa?.account.is_room_only).toBe(false);
      expect(tfsa?.room.roomRemaining).toBe(800000);
    });

    it('rejects an unsupported account_type (fhsa) with 400', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      const res = await setRoom(token, app, {
        member_id: ROOM_MID,
        account_type: 'fhsa',
        room_cents: 100000,
      });
      expect(res.status).toBe(400);
    });

    it('404s a member_id that is not in this household', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      const res = await setRoom(token, app, {
        member_id: ABSENT_MID,
        account_type: 'rrsp',
        room_cents: 500000,
      });
      expect(res.status).toBe(404);
    });
  });

  // ==================================================================
  // Pension simple flow — goals ($/%), recurring + employer match, manual contributions
  // ==================================================================

  describe('member line (goals / recurring / match)', () => {
    const ROOM_UID = 'aaaa1111-1111-4111-8111-111111111111';
    const ROOM_MID = 'bbbb2222-2222-4222-8222-222222222222';
    const EDITOR_UID = 'cccc3333-3333-4333-8333-333333333333';
    const EDITOR_MID = 'dddd4444-4444-4444-8444-444444444444';

    beforeEach(async () => {
      const db = drizzle(testEnv.DB, { schema });
      await db.insert(schema.users).values([
        { id: ROOM_UID, email: 'line-member@example.com', email_verified: true },
        { id: EDITOR_UID, email: 'line-editor@example.com', email_verified: true },
      ]);
      await db.insert(schema.householdMembers).values([
        { id: ROOM_MID, household_id: HID, user_id: ROOM_UID, role: 'member', joined_at: '2025-01-01T00:00:00Z' },
        { id: EDITOR_MID, household_id: HID, user_id: EDITOR_UID, role: 'owner', joined_at: '2025-01-01T00:00:00Z' },
      ]);
    });

    const MR = `/households/${HID}/savings/registered/member-room`;
    const MC = `/households/${HID}/savings/registered/member-contribution`;
    const OVQ = `/households/${HID}/savings/registered/overview?year=2026`;

    async function put(token: string, app: ReturnType<typeof mkApp>, body: Record<string, unknown>) {
      return app.request(MR, { method: 'PUT', headers: authHeaders(token), body: JSON.stringify(body) }, testEnv);
    }
    async function overview(token: string, app: ReturnType<typeof mkApp>) {
      const res = await app.request(OVQ, { headers: authHeaders(token) }, testEnv);
      expect(res.status).toBe(200);
      return (await res.json()) as {
        groups: {
          accounts: {
            account: { account_type: string; annual_goal_cents: number | null; annual_goal_pct: number | null };
            room: { goalCents: number | null; usedByContributor: { self: number; employer: number } };
          }[];
        }[];
      };
    }
    const rrspOf = (ov: Awaited<ReturnType<typeof overview>>) =>
      ov.groups.flatMap((g) => g.accounts).find((a) => a.account.account_type === 'rrsp');

    async function regularRows(): Promise<{ contributor: string; period: string; amount_cents: number }[]> {
      const rows = await testEnv.DB.prepare(
        `SELECT contributor, period, amount_cents FROM registered_transactions WHERE kind = 'regular' ORDER BY period, contributor`
      ).all<{ contributor: string; period: string; amount_cents: number }>();
      return rows.results ?? [];
    }

    it('% goal derives goalCents from the room, and is mutually exclusive with an amount goal', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      // Room $10,000 + goal 80% → goalCents = 80% of room = $8,000.
      await put(token, app, { member_id: ROOM_MID, account_type: 'rrsp', room_cents: 1000000, goal_pct: 80 });
      let acct = rrspOf(await overview(token, app));
      expect(acct?.account.annual_goal_pct).toBe(80);
      expect(acct?.account.annual_goal_cents).toBeNull();
      expect(acct?.room.goalCents).toBe(800000);

      // Switching to an amount goal clears the %.
      await put(token, app, { member_id: ROOM_MID, account_type: 'rrsp', goal_cents: 500000 });
      acct = rrspOf(await overview(token, app));
      expect(acct?.account.annual_goal_pct).toBeNull();
      expect(acct?.account.annual_goal_cents).toBe(500000);
      expect(acct?.room.goalCents).toBe(500000);
    });

    it('recurring self + employer match materialize as two rows in the SAME month, idempotently', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await put(token, app, {
        member_id: ROOM_MID,
        account_type: 'rrsp',
        room_cents: 3000000,
        regular_contribution_cents: 100000,
        employer_match_cents: 50000,
      });

      // First overview load materializes the current month (self + employer, same period).
      await overview(token, app);
      let rows = await regularRows();
      expect(rows.length).toBe(2);
      expect(rows[0].period).toBe(rows[1].period); // proves the widened (…, contributor) index
      expect(rows.map((r) => r.contributor).sort()).toEqual(['employer', 'self']);
      expect(rows.find((r) => r.contributor === 'self')?.amount_cents).toBe(100000);
      expect(rows.find((r) => r.contributor === 'employer')?.amount_cents).toBe(50000);

      // Re-opening does not duplicate.
      await overview(token, app);
      rows = await regularRows();
      expect(rows.length).toBe(2);
    });

    it('member-contribution is idempotent on a repeated client id (no double-count on retry)', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      // A room-only line for the contribution to attach to.
      await put(token, app, { member_id: ROOM_MID, account_type: 'rrsp', room_cents: 3000000 });

      const contribId = '33333333-3333-4333-8333-333333333333';
      const postContribution = () =>
        app.request(
          MC,
          {
            method: 'POST',
            headers: authHeaders(token),
            body: JSON.stringify({
              id: contribId,
              member_id: ROOM_MID,
              account_type: 'rrsp',
              amount_cents: 25000,
            }),
          },
          testEnv
        );

      const first = await postContribution();
      expect(first.status).toBe(201);
      const firstBody = (await first.json()) as { account: { balance_cents: number } };

      // Retry with the SAME client id (a network retry / double-submit) →
      // no second row, balance unchanged.
      const second = await postContribution();
      expect(second.status).toBe(201);
      const secondBody = (await second.json()) as { account: { balance_cents: number } };
      expect(secondBody.account.balance_cents).toBe(firstBody.account.balance_cents);

      const manual = await testEnv.DB.prepare(
        `SELECT COUNT(*) AS n FROM registered_transactions WHERE kind = 'manual' AND type = 'contribution'`
      ).first<{ n: number }>();
      expect(manual?.n).toBe(1);
    });

    it('backfills every month from the recurring start anchor through the current month', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      await put(token, app, {
        member_id: ROOM_MID,
        account_type: 'rrsp',
        regular_contribution_cents: 20000,
        employer_match_cents: 10000,
      });

      // Rewind the anchor two months so backfill spans 3 months (relative to now — no fixed date).
      const now = new Date();
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
      const startMonth = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
      await testEnv.DB.prepare(`UPDATE registered_accounts SET recurring_start_month = ? WHERE is_room_only = 1`)
        .bind(startMonth)
        .run();

      await overview(token, app);
      const rows = await regularRows();
      // 3 months × (self + employer) = 6 rows across 3 distinct periods.
      expect(rows.length).toBe(6);
      expect(new Set(rows.map((r) => r.period)).size).toBe(3);

      // Idempotent on re-open.
      await overview(token, app);
      expect((await regularRows()).length).toBe(6);
    });

    it('adds a manual contribution (self) to a member line, creating the line if needed', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      const res = await app.request(
        MC,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({ member_id: ROOM_MID, account_type: 'rrsp', amount_cents: 25000 }),
        },
        testEnv
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as { transaction: { kind: string; contributor: string; amount_cents: number } };
      expect(body.transaction.kind).toBe('manual');
      expect(body.transaction.contributor).toBe('self');

      const acct = rrspOf(await overview(token, app));
      expect(acct?.room.usedByContributor.self).toBeGreaterThanOrEqual(25000);
    });

    it('adds a manual contribution with an employer-match portion as two rows in one call', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      const res = await app.request(
        MC,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            member_id: ROOM_MID,
            account_type: 'rrsp',
            amount_cents: 25000,
            contributor: 'self',
            employer_amount_cents: 25000,
          }),
        },
        testEnv
      );
      expect(res.status).toBe(201);

      // Primary (self) transaction is returned; the employer leg is logged alongside it.
      const manualRows = await testEnv.DB.prepare(
        `SELECT contributor, amount_cents FROM registered_transactions WHERE kind = 'manual' ORDER BY contributor`
      ).all<{ contributor: string; amount_cents: number }>();
      expect(manualRows.results?.length).toBe(2);
      expect(manualRows.results?.map((r) => r.contributor).sort()).toEqual(['employer', 'self']);

      // Overview reflects BOTH portions in the self/employer split.
      const acct = rrspOf(await overview(token, app));
      expect(acct?.room.usedByContributor.self).toBe(25000);
      expect(acct?.room.usedByContributor.employer).toBe(25000);
    });

    // ---- Per-month backfill grid (different amounts each month) ----
    const MB = `/households/${HID}/savings/registered/member-backfill`;
    const MMQ = (year: number) =>
      `/households/${HID}/savings/registered/member-monthly?member_id=${ROOM_MID}&account_type=rrsp&year=${year}`;

    async function backfill(
      token: string,
      app: ReturnType<typeof mkApp>,
      entries: { month: number; self_cents: number; employer_cents: number }[]
    ) {
      return app.request(
        MB,
        {
          method: 'PUT',
          headers: authHeaders(token),
          body: JSON.stringify({ member_id: ROOM_MID, account_type: 'rrsp', year: 2026, entries }),
        },
        testEnv
      );
    }
    async function monthly(token: string, app: ReturnType<typeof mkApp>) {
      const res = await app.request(MMQ(2026), { headers: authHeaders(token) }, testEnv);
      expect(res.status).toBe(200);
      return (await res.json()) as { months: { month: number; selfCents: number; employerCents: number }[] };
    }

    it('backfills DIFFERENT per-month amounts; overview + member-monthly reflect them', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      const res = await backfill(token, app, [
        { month: 1, self_cents: 10000, employer_cents: 5000 },
        { month: 2, self_cents: 20000, employer_cents: 0 },
        { month: 3, self_cents: 0, employer_cents: 0 },
      ]);
      expect(res.status).toBe(200);

      // Only the >0 legs become regular rows (Jan self+emp, Feb self) → 3 rows across 2 months.
      const rows = await regularRows();
      expect(rows.length).toBe(3);
      expect(new Set(rows.map((r) => r.period)).size).toBe(2);

      // Grid round-trips.
      const grid = await monthly(token, app);
      expect(grid.months[0]).toMatchObject({ selfCents: 10000, employerCents: 5000 });
      expect(grid.months[1]).toMatchObject({ selfCents: 20000, employerCents: 0 });
      expect(grid.months[2]).toMatchObject({ selfCents: 0, employerCents: 0 });

      // Year totals: self 10000+20000, employer 5000.
      const acct = rrspOf(await overview(token, app));
      expect(acct?.room.usedByContributor.self).toBe(30000);
      expect(acct?.room.usedByContributor.employer).toBe(5000);
    });

    it('re-saving the same grid is idempotent (no double-count)', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      const entries = [
        { month: 1, self_cents: 10000, employer_cents: 5000 },
        { month: 2, self_cents: 20000, employer_cents: 0 },
      ];
      await backfill(token, app, entries);
      await backfill(token, app, entries);

      expect((await regularRows()).length).toBe(3);
      const acct = rrspOf(await overview(token, app));
      expect(acct?.room.usedByContributor.self).toBe(30000);
      expect(acct?.room.usedByContributor.employer).toBe(5000);
    });

    it('re-saving with a month cleared removes that month (replace semantics)', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      await backfill(token, app, [
        { month: 1, self_cents: 10000, employer_cents: 0 },
        { month: 2, self_cents: 20000, employer_cents: 0 },
      ]);
      // Now save a grid that keeps only January.
      await backfill(token, app, [
        { month: 1, self_cents: 10000, employer_cents: 0 },
        { month: 2, self_cents: 0, employer_cents: 0 },
      ]);

      const rows = await regularRows();
      expect(rows.length).toBe(1);
      expect(rows[0].period.endsWith('-01')).toBe(true);
      const acct = rrspOf(await overview(token, app));
      expect(acct?.room.usedByContributor.self).toBe(10000);
    });

    it('is household-shared: a second owner can edit the same member line', async () => {
      const ownerToken = await mintToken(UID);
      const editorToken = await mintToken(EDITOR_UID);
      const app = mkApp();

      await put(ownerToken, app, { member_id: ROOM_MID, account_type: 'tfsa', room_cents: 700000 });
      // A different household owner updates the same line.
      const res = await put(editorToken, app, { member_id: ROOM_MID, account_type: 'tfsa', room_cents: 900000 });
      expect(res.status).toBe(200);

      const tfsa = (await overview(editorToken, app)).groups
        .flatMap((g) => g.accounts)
        .find((a) => a.account.account_type === 'tfsa');
      expect(tfsa?.room.goalCents ?? 0).toBe(0);
    });

    // ---- DELETE member-contributions (delete the year's contributions + recurring) ----
    const delContribs = (
      token: string,
      app: ReturnType<typeof mkApp>,
      type = 'rrsp',
      year = 2026,
      mid = ROOM_MID
    ) =>
      app.request(
        `/households/${HID}/savings/registered/member-contributions?member_id=${mid}&account_type=${type}&year=${year}`,
        { method: 'DELETE', headers: authHeaders(token) },
        testEnv
      );

    it("DELETE member-contributions clears the year's contributions + recurring, keeping room + goal", async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await put(token, app, {
        member_id: ROOM_MID,
        account_type: 'rrsp',
        room_cents: 3000000,
        goal_cents: 500000,
        regular_contribution_cents: 100000,
        employer_match_cents: 50000,
      });
      await overview(token, app); // materializes the current month's recurring rows
      await app.request(
        MC,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({ member_id: ROOM_MID, account_type: 'rrsp', amount_cents: 25000 }),
        },
        testEnv
      );
      expect((await regularRows()).length).toBeGreaterThan(0);

      const res = await delContribs(token, app);
      expect(res.status).toBe(200);

      // Reloading does NOT re-materialize (recurring is off) and the year shows nothing used;
      // the room + goal survive.
      const acct = rrspOf(await overview(token, app));
      expect(acct).toBeDefined();
      expect(acct?.account.annual_goal_cents).toBe(500000);
      expect(acct?.room.usedByContributor.self).toBe(0);
      expect(acct?.room.usedByContributor.employer).toBe(0);
      expect((await regularRows()).length).toBe(0);
    });

    it('DELETE member-contributions removes a bare contribution-only line entirely', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      // A contribution-only line (no room, no goal).
      await app.request(
        MC,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({ member_id: ROOM_MID, account_type: 'tfsa', amount_cents: 40000 }),
        },
        testEnv
      );
      expect(
        (await overview(token, app)).groups
          .flatMap((g) => g.accounts)
          .find((a) => a.account.account_type === 'tfsa')
      ).toBeDefined();

      const res = await delContribs(token, app, 'tfsa');
      expect(res.status).toBe(200);
      expect(((await res.json()) as { account: unknown }).account).toBeNull();

      expect(
        (await overview(token, app)).groups
          .flatMap((g) => g.accounts)
          .find((a) => a.account.account_type === 'tfsa')
      ).toBeUndefined();
    });
  });

  // ==================================================================
  // Recurring payments — autopay clears day_of_month
  // ==================================================================

  describe('recurring payment autopay', () => {
    it('clears day_of_month on create when is_automated is true, regardless of what was sent', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      const res = await app.request(
        `/households/${HID}/savings/recurring-payments`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.recurring1,
            label: 'IKEA 1',
            amount_cents: 37921,
            day_of_month: 22,
            is_automated: true,
          }),
        },
        testEnv
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as { item: { day_of_month: number | null; is_automated: boolean } };
      expect(body.item.is_automated).toBe(true);
      expect(body.item.day_of_month).toBeNull();
    });

    it('keeps day_of_month on create when is_automated is false/omitted', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      const res = await app.request(
        `/households/${HID}/savings/recurring-payments`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.recurring1,
            label: 'IKEA 1',
            amount_cents: 37921,
            day_of_month: 22,
          }),
        },
        testEnv
      );
      const body = (await res.json()) as { item: { day_of_month: number | null; is_automated: boolean } };
      expect(body.item.is_automated).toBe(false);
      expect(body.item.day_of_month).toBe(22);
    });

    it('clears day_of_month when an update flips is_automated to true, even if a day_of_month is also sent', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await app.request(
        `/households/${HID}/savings/recurring-payments`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.recurring1,
            label: 'IKEA 1',
            amount_cents: 37921,
            day_of_month: 22,
          }),
        },
        testEnv
      );

      const res = await app.request(
        `/households/${HID}/savings/recurring-payments/${IDS.recurring1}`,
        {
          method: 'PATCH',
          headers: authHeaders(token),
          body: JSON.stringify({ is_automated: true, day_of_month: 15 }),
        },
        testEnv
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { item: { day_of_month: number | null; is_automated: boolean } };
      expect(body.item.is_automated).toBe(true);
      expect(body.item.day_of_month).toBeNull();
    });

    it('leaves day_of_month untouched on an update that does not mention is_automated', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await app.request(
        `/households/${HID}/savings/recurring-payments`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.recurring1,
            label: 'IKEA 1',
            amount_cents: 37921,
            day_of_month: 22,
          }),
        },
        testEnv
      );

      const res = await app.request(
        `/households/${HID}/savings/recurring-payments/${IDS.recurring1}`,
        { method: 'PATCH', headers: authHeaders(token), body: JSON.stringify({ label: 'IKEA 1 (renamed)' }) },
        testEnv
      );
      const body = (await res.json()) as { item: { day_of_month: number | null } };
      expect(body.item.day_of_month).toBe(22);
    });
  });

  // ==================================================================
  // Income templates + recurring payments — idempotent apply-*
  // ==================================================================

  describe('apply-* idempotency', () => {
    it('applyIncomeTemplates twice → one row per template, net/YTD do not double', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      const tplRes = await app.request(
        `/households/${HID}/savings/income-templates`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.template1,
            source_type: 'payroll',
            label: 'Monthly salary',
            amount_cents: 300000,
            day_of_month: 1,
            active: true,
          }),
        },
        testEnv
      );
      expect(tplRes.status).toBe(201);

      const firstApply = await app.request(
        `/households/${HID}/savings/income/apply-templates`,
        { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ year: 2026, month: 7 }) },
        testEnv
      );
      expect(firstApply.status).toBe(200);
      const first = (await firstApply.json()) as { created: number; skipped: number };
      expect(first.created).toBe(1);

      const secondApply = await app.request(
        `/households/${HID}/savings/income/apply-templates`,
        { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ year: 2026, month: 7 }) },
        testEnv
      );
      expect(secondApply.status).toBe(200);
      const second = (await secondApply.json()) as { created: number; skipped: number };
      expect(second.created).toBe(0);
      expect(second.skipped).toBeGreaterThan(0);

      // Exactly one generated income row for (template, period).
      const count = await testEnv.DB.prepare(
        `SELECT COUNT(*) AS n FROM savings_income_entries WHERE template_id = ? AND period = ?`
      )
        .bind(IDS.template1, '2026-07')
        .first<{ n: number }>();
      expect(count?.n).toBe(1);

      // Overview income does not double.
      const ov = await app.request(
        `/households/${HID}/savings/overview?year=2026&month=7`,
        { headers: authHeaders(token) },
        testEnv
      );
      const overview = (await ov.json()) as { income: { total: number } };
      expect(overview.income.total).toBe(300000);
    });

    it('applyIncomeTemplates clamps day_of_month=31 to the real month length (no invalid Feb dates)', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      const tplRes = await app.request(
        `/households/${HID}/savings/income-templates`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.template1,
            source_type: 'payroll',
            label: 'End-of-month salary',
            amount_cents: 300000,
            day_of_month: 31,
            active: true,
          }),
        },
        testEnv
      );
      expect(tplRes.status).toBe(201);

      // Apply for February — day 31 has no valid Feb date, so it must clamp to the
      // 28th (2026 is not a leap year), never the invalid string "2026-02-31".
      const applyRes = await app.request(
        `/households/${HID}/savings/income/apply-templates`,
        { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ year: 2026, month: 2 }) },
        testEnv
      );
      expect(applyRes.status).toBe(200);

      const row = await testEnv.DB.prepare(
        `SELECT income_date FROM savings_income_entries WHERE template_id = ? AND period = ?`
      )
        .bind(IDS.template1, '2026-02')
        .first<{ income_date: string }>();
      expect(row?.income_date).toBe('2026-02-28');
    });

    it('applyRecurringPayments twice → one spend row per payment, computed view + net stable', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      const rpRes = await app.request(
        `/households/${HID}/savings/recurring-payments`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            id: IDS.recurring1,
            label: 'Internet',
            amount_cents: 9000,
            day_of_month: 5,
            group_label: 'Utilities',
            is_essential: true,
            active: true,
          }),
        },
        testEnv
      );
      expect(rpRes.status).toBe(201);

      // GET returns the BE-computed view model (total + per-group subtotals).
      const listRes = await app.request(
        `/households/${HID}/savings/recurring-payments`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(listRes.status).toBe(200);
      const view = (await listRes.json()) as {
        items: Array<{ id: string }>;
        totalMonthlyCents: number;
        savedMonthlyIncomeCents: number;
        byGroup: Array<{ group_label: string | null; subtotalCents: number }>;
      };
      expect(view.items.map((i) => i.id)).toContain(IDS.recurring1);
      expect(view.totalMonthlyCents).toBe(9000);
      // No active income templates in this fixture → saved monthly income is 0.
      expect(view.savedMonthlyIncomeCents).toBe(0);

      const firstApply = await app.request(
        `/households/${HID}/savings/recurring-payments/apply`,
        { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ year: 2026, month: 8 }) },
        testEnv
      );
      expect(firstApply.status).toBe(200);
      const first = (await firstApply.json()) as { created: number; skipped: number };
      expect(first.created).toBe(1);

      const secondApply = await app.request(
        `/households/${HID}/savings/recurring-payments/apply`,
        { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ year: 2026, month: 8 }) },
        testEnv
      );
      expect(secondApply.status).toBe(200);
      const second = (await secondApply.json()) as { created: number; skipped: number };
      expect(second.created).toBe(0);
      expect(second.skipped).toBeGreaterThan(0);

      const count = await testEnv.DB.prepare(
        `SELECT COUNT(*) AS n FROM savings_spending_entries WHERE recurring_payment_id = ? AND period = ?`
      )
        .bind(IDS.recurring1, '2026-08')
        .first<{ n: number }>();
      expect(count?.n).toBe(1);

      // Flat-baseline model: copied recurring spend rows never affect net (Budget
      // `expenses` is the single spend source). Net deducts only the flat active
      // recurring total via `monthlyPayments`; `spendings` (Budget) is 0 here.
      const ov = await app.request(
        `/households/${HID}/savings/overview?year=2026&month=8`,
        { headers: authHeaders(token) },
        testEnv
      );
      const overview = (await ov.json()) as {
        spending: { monthlyPayments: number; spendings: number; total: number };
      };
      expect(overview.spending.monthlyPayments).toBe(9000);
      expect(overview.spending.spendings).toBe(0);
      expect(overview.spending.total).toBe(9000);
    });

    it('reclassifies ungrouped mortgage/strata bills into a "Housing" group, "Other" last', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      // Two ungrouped housing bills + one ungrouped discretionary bill.
      const bills = [
        { id: IDS.recurring1, label: 'Mortgage Home', amount_cents: 430000 },
        { id: IDS.recurring2, label: 'Strata', amount_cents: 51700 },
        { id: IDS.spending1, label: 'Netflix', amount_cents: 1600 },
      ];
      for (const b of bills) {
        const res = await app.request(
          `/households/${HID}/savings/recurring-payments`,
          {
            method: 'POST',
            headers: authHeaders(token),
            body: JSON.stringify({ ...b, group_label: null, is_essential: false, active: true }),
          },
          testEnv
        );
        expect(res.status).toBe(201);
      }

      const listRes = await app.request(
        `/households/${HID}/savings/recurring-payments`,
        { headers: authHeaders(token) },
        testEnv
      );
      const view = (await listRes.json()) as {
        items: Array<{ id: string; label: string; group_label: string | null }>;
        byGroup: Array<{ group_label: string | null; subtotalCents: number }>;
      };

      // Mortgage + Strata are lifted out of "Other" into "Housing"; Netflix stays ungrouped.
      const housing = view.byGroup.find((g) => g.group_label === 'Housing');
      expect(housing?.subtotalCents).toBe(430000 + 51700);
      const other = view.byGroup.find((g) => g.group_label === null);
      expect(other?.subtotalCents).toBe(1600);

      // Items carry the resolved group so the client sections them correctly.
      const mortgage = view.items.find((i) => i.id === IDS.recurring1);
      expect(mortgage?.group_label).toBe('Housing');

      // The "Other" catch-all (null) is always ordered last.
      expect(view.byGroup[view.byGroup.length - 1]?.group_label).toBeNull();
    });

    it('reclassifies an ungrouped loan-tracked payment into "Loans & Debt"', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      // An IKEA-style BNPL plan with no explicit group, plus one unrelated
      // ungrouped bill that should stay in "Other".
      const bills = [
        { id: IDS.recurring1, label: 'IKEA 1', amount_cents: 37921 },
        { id: IDS.spending1, label: 'Netflix', amount_cents: 1600 },
      ];
      for (const b of bills) {
        const res = await app.request(
          `/households/${HID}/savings/recurring-payments`,
          {
            method: 'POST',
            headers: authHeaders(token),
            body: JSON.stringify({ ...b, group_label: null, is_essential: false, active: true }),
          },
          testEnv
        );
        expect(res.status).toBe(201);
      }

      const loanRes = await app.request(
        `/households/${HID}/savings/recurring-payments/${IDS.recurring1}/loan`,
        {
          method: 'PUT',
          headers: authHeaders(token),
          body: JSON.stringify({
            rate_type: 'zero',
            principal_cents: 910089,
            term_months: 24,
            start_date: '2026-02-03',
          }),
        },
        testEnv
      );
      expect(loanRes.status).toBe(200);

      const listRes = await app.request(
        `/households/${HID}/savings/recurring-payments`,
        { headers: authHeaders(token) },
        testEnv
      );
      const view = (await listRes.json()) as {
        items: Array<{ id: string; label: string; group_label: string | null }>;
        byGroup: Array<{ group_label: string | null; subtotalCents: number }>;
      };

      // IKEA is lifted out of "Other" into "Loans & Debt"; Netflix stays ungrouped.
      const loans = view.byGroup.find((g) => g.group_label === 'Loans & Debt');
      expect(loans?.subtotalCents).toBe(37921);
      const other = view.byGroup.find((g) => g.group_label === null);
      expect(other?.subtotalCents).toBe(1600);

      const ikea = view.items.find((i) => i.id === IDS.recurring1);
      expect(ikea?.group_label).toBe('Loans & Debt');
    });
  });

  // ==================================================================
  // Recurring payments — apply-status (per-month applied snapshot)
  // ==================================================================

  describe('GET /recurring-payments/apply-status', () => {
    type MonthStatus = {
      month: number;
      applied: boolean;
      appliedCents: number;
      appliedCount: number;
      matchesCurrent: boolean;
    };
    type StatusResponse = {
      year: number;
      currentCount: number;
      currentTotalCents: number;
      months: MonthStatus[];
    };

    const createRecurring = (token: string, app: ReturnType<typeof mkApp>, body: object) =>
      app.request(
        `/households/${HID}/savings/recurring-payments`,
        { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body) },
        testEnv
      );

    const applyMonth = (token: string, app: ReturnType<typeof mkApp>, year: number, month: number) =>
      app.request(
        `/households/${HID}/savings/recurring-payments/apply`,
        { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ year, month }) },
        testEnv
      );

    const getStatus = async (token: string, app: ReturnType<typeof mkApp>, year: number) => {
      const res = await app.request(
        `/households/${HID}/savings/recurring-payments/apply-status?year=${year}`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(res.status).toBe(200);
      return (await res.json()) as StatusResponse;
    };

    it('flags applied months and detects drift after payments change', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      expect((await createRecurring(token, app, {
        id: IDS.recurring1,
        label: 'Internet',
        amount_cents: 9000,
        day_of_month: 5,
        active: true,
      })).status).toBe(201);

      // Nothing applied yet → every month is empty, current baseline is the one payment.
      const before = await getStatus(token, app, 2026);
      expect(before.currentCount).toBe(1);
      expect(before.currentTotalCents).toBe(9000);
      expect(before.months).toHaveLength(12);
      expect(before.months.every((m) => !m.applied)).toBe(true);

      // Apply to August → that month is applied and matches the current baseline.
      expect((await applyMonth(token, app, 2026, 8)).status).toBe(200);
      const afterApply = await getStatus(token, app, 2026);
      const aug = afterApply.months.find((m) => m.month === 8)!;
      expect(aug).toMatchObject({
        applied: true,
        appliedCents: 9000,
        appliedCount: 1,
        matchesCurrent: true,
      });
      // Other months stay untouched.
      expect(afterApply.months.filter((m) => m.applied)).toHaveLength(1);

      // Add a second payment → August's snapshot now drifts from the baseline.
      expect((await createRecurring(token, app, {
        id: IDS.recurring2,
        label: 'Phone',
        amount_cents: 5000,
        day_of_month: 10,
        active: true,
      })).status).toBe(201);

      const drifted = await getStatus(token, app, 2026);
      expect(drifted.currentCount).toBe(2);
      expect(drifted.currentTotalCents).toBe(14000);
      const augDrift = drifted.months.find((m) => m.month === 8)!;
      expect(augDrift).toMatchObject({
        applied: true,
        appliedCents: 9000,
        appliedCount: 1,
        matchesCurrent: false, // one payment applied vs two active now
      });

      // Re-apply fills the gap → back in sync with both payments.
      expect((await applyMonth(token, app, 2026, 8)).status).toBe(200);
      const resynced = await getStatus(token, app, 2026);
      const augSynced = resynced.months.find((m) => m.month === 8)!;
      expect(augSynced).toMatchObject({
        applied: true,
        appliedCents: 14000,
        appliedCount: 2,
        matchesCurrent: true,
      });
    });

    it('scopes applied months to the requested year', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await createRecurring(token, app, {
        id: IDS.recurring1,
        label: 'Internet',
        amount_cents: 9000,
        active: true,
      });
      await applyMonth(token, app, 2026, 3);

      // A different year sees no applied months.
      const other = await getStatus(token, app, 2027);
      expect(other.year).toBe(2027);
      expect(other.months.every((m) => !m.applied)).toBe(true);
    });
  });

  // ==================================================================
  // Recurring payments — propagate an edit into already-applied months
  // ==================================================================

  describe('POST /recurring-payments/:id/propagate', () => {
    const createRecurring = (token: string, app: ReturnType<typeof mkApp>, body: object) =>
      app.request(
        `/households/${HID}/savings/recurring-payments`,
        { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body) },
        testEnv
      );

    const applyMonth = (token: string, app: ReturnType<typeof mkApp>, year: number, month: number) =>
      app.request(
        `/households/${HID}/savings/recurring-payments/apply`,
        { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ year, month }) },
        testEnv
      );

    const editAmount = (
      token: string,
      app: ReturnType<typeof mkApp>,
      id: string,
      amount_cents: number
    ) =>
      app.request(
        `/households/${HID}/savings/recurring-payments/${id}`,
        { method: 'PATCH', headers: authHeaders(token), body: JSON.stringify({ amount_cents }) },
        testEnv
      );

    const propagate = (
      token: string,
      app: ReturnType<typeof mkApp>,
      id: string,
      body: { year: number; fromMonth: number; toMonth: number }
    ) =>
      app.request(
        `/households/${HID}/savings/recurring-payments/${id}/propagate`,
        { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body) },
        testEnv
      );

    const appliedCents = async (id: string, period: string) => {
      const row = await testEnv.DB.prepare(
        `SELECT amount_cents AS c FROM savings_spending_entries WHERE recurring_payment_id = ? AND period = ?`
      )
        .bind(id, period)
        .first<{ c: number }>();
      return row?.c ?? null;
    };

    it('pushes the new amount into only the chosen month span, leaving others', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      expect(
        (await createRecurring(token, app, {
          id: IDS.recurring1,
          label: 'Internet',
          amount_cents: 9000,
          active: true,
        })).status
      ).toBe(201);

      // Materialize the payment into Mar, Jun and Sep of 2026 at $90.
      for (const m of [3, 6, 9]) expect((await applyMonth(token, app, 2026, m)).status).toBe(200);

      // Edit the template to $120, then propagate "this & future" from June.
      expect((await editAmount(token, app, IDS.recurring1, 12000)).status).toBe(200);
      const res = await propagate(token, app, IDS.recurring1, {
        year: 2026,
        fromMonth: 6,
        toMonth: 12,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ updated: 2 }); // Jun + Sep, not Mar

      expect(await appliedCents(IDS.recurring1, '2026-03')).toBe(9000); // untouched (past)
      expect(await appliedCents(IDS.recurring1, '2026-06')).toBe(12000);
      expect(await appliedCents(IDS.recurring1, '2026-09')).toBe(12000);
    });

    it('whole-year span rewrites every applied month of the year', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await createRecurring(token, app, {
        id: IDS.recurring1,
        label: 'Internet',
        amount_cents: 9000,
        active: true,
      });
      for (const m of [1, 5, 12]) await applyMonth(token, app, 2026, m);

      await editAmount(token, app, IDS.recurring1, 10000);
      const res = await propagate(token, app, IDS.recurring1, { year: 2026, fromMonth: 1, toMonth: 12 });
      expect(await res.json()).toEqual({ updated: 3 });

      expect(await appliedCents(IDS.recurring1, '2026-01')).toBe(10000);
      expect(await appliedCents(IDS.recurring1, '2026-05')).toBe(10000);
      expect(await appliedCents(IDS.recurring1, '2026-12')).toBe(10000);
    });

    it('only touches the target payment, never a sibling in the same month', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await createRecurring(token, app, {
        id: IDS.recurring1,
        label: 'Internet',
        amount_cents: 9000,
        active: true,
      });
      await createRecurring(token, app, {
        id: IDS.recurring2,
        label: 'Phone',
        amount_cents: 5000,
        active: true,
      });
      await applyMonth(token, app, 2026, 4);

      await editAmount(token, app, IDS.recurring1, 9900);
      const res = await propagate(token, app, IDS.recurring1, { year: 2026, fromMonth: 4, toMonth: 4 });
      expect(await res.json()).toEqual({ updated: 1 });

      expect(await appliedCents(IDS.recurring1, '2026-04')).toBe(9900);
      expect(await appliedCents(IDS.recurring2, '2026-04')).toBe(5000); // sibling untouched
    });

    it('is a no-op (updated: 0) when the month has nothing applied', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await createRecurring(token, app, {
        id: IDS.recurring1,
        label: 'Internet',
        amount_cents: 9000,
        active: true,
      });
      // Never applied to any month.
      const res = await propagate(token, app, IDS.recurring1, { year: 2026, fromMonth: 1, toMonth: 12 });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ updated: 0 });
    });

    it('rejects a cross-household propagate (IDOR)', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await createRecurring(token, app, {
        id: IDS.recurring1,
        label: 'Internet',
        amount_cents: 9000,
        active: true,
      });
      await applyMonth(token, app, 2026, 2);

      const outsiderToken = await mintToken(OTHER_UID);
      const res = await propagate(outsiderToken, app, IDS.recurring1, {
        year: 2026,
        fromMonth: 2,
        toMonth: 2,
      });
      expect([403, 404]).toContain(res.status);
      // The applied row is untouched.
      expect(await appliedCents(IDS.recurring1, '2026-02')).toBe(9000);
    });
  });

  // ==================================================================
  // Recurring payments — month scope (started/ended mid-year)
  // ==================================================================

  describe('recurring payment month scope', () => {
    const createRecurring = (token: string, app: ReturnType<typeof mkApp>, body: object) =>
      app.request(
        `/households/${HID}/savings/recurring-payments`,
        { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body) },
        testEnv
      );

    const applyMonth = (token: string, app: ReturnType<typeof mkApp>, year: number, month: number) =>
      app.request(
        `/households/${HID}/savings/recurring-payments/apply`,
        { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ year, month }) },
        testEnv
      );

    it('rejects custom_months with no months selected', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      const res = await createRecurring(token, app, {
        id: IDS.recurring1,
        label: 'Summer camp',
        amount_cents: 5000,
        active: true,
        scope_type: 'custom_months',
        scope_year: 2026,
        active_months: [],
      });
      expect(res.status).toBe(400);
    });

    it('round-trips scope_type/scope_year/active_months as a parsed array', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      const res = await createRecurring(token, app, {
        id: IDS.recurring1,
        label: 'New gym membership',
        amount_cents: 6000,
        active: true,
        scope_type: 'custom_months',
        scope_year: 2026,
        active_months: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        item: { scope_type: string; scope_year: number | null; active_months: number[] | null };
      };
      expect(body.item.scope_type).toBe('custom_months');
      expect(body.item.scope_year).toBe(2026);
      expect(body.item.active_months).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    });

    it('updating scope_type back to all_year clears scope_year/active_months', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await createRecurring(token, app, {
        id: IDS.recurring1,
        label: 'New gym membership',
        amount_cents: 6000,
        active: true,
        scope_type: 'custom_months',
        scope_year: 2026,
        active_months: [3, 4, 5],
      });

      const res = await app.request(
        `/households/${HID}/savings/recurring-payments/${IDS.recurring1}`,
        { method: 'PATCH', headers: authHeaders(token), body: JSON.stringify({ scope_type: 'all_year' }) },
        testEnv
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        item: { scope_type: string; scope_year: number | null; active_months: number[] | null };
      };
      expect(body.item.scope_type).toBe('all_year');
      expect(body.item.scope_year).toBeNull();
      expect(body.item.active_months).toBeNull();
    });

    it('apply skips a month-scoped payment outside its active months', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      // Started in March 2026 — Jan/Feb of 2026 are out of scope.
      await createRecurring(token, app, {
        id: IDS.recurring1,
        label: 'New gym membership',
        amount_cents: 6000,
        active: true,
        scope_type: 'custom_months',
        scope_year: 2026,
        active_months: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      });

      // Out of scope entirely — not "skipped" (that means idempotent-duplicate
      // elsewhere in this API), just never attempted for this month.
      const jan = await applyMonth(token, app, 2026, 1);
      expect(await jan.json()).toEqual({ created: 0, skipped: 0, months: 1 });

      const mar = await applyMonth(token, app, 2026, 3);
      expect(await mar.json()).toEqual({ created: 1, skipped: 0, months: 1 });

      const janRow = await testEnv.DB.prepare(
        `SELECT COUNT(*) AS n FROM savings_spending_entries WHERE recurring_payment_id = ? AND period = ?`
      )
        .bind(IDS.recurring1, '2026-01')
        .first<{ n: number }>();
      expect(janRow?.n).toBe(0);
    });

    it('a custom scope only binds its own scope_year — other years apply every month', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      // Scoped to Mar-Dec of 2026 only.
      await createRecurring(token, app, {
        id: IDS.recurring1,
        label: 'New gym membership',
        amount_cents: 6000,
        active: true,
        scope_type: 'custom_months',
        scope_year: 2026,
        active_months: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      });

      // January of a DIFFERENT year (2027) is unaffected by the 2026 scope.
      const jan2027 = await applyMonth(token, app, 2027, 1);
      expect(await jan2027.json()).toEqual({ created: 1, skipped: 0, months: 1 });
    });

    it('GET /recurring-payments?year&month excludes an out-of-scope payment from totals', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await createRecurring(token, app, {
        id: IDS.recurring1,
        label: 'Internet',
        amount_cents: 9000,
        active: true,
      });
      await createRecurring(token, app, {
        id: IDS.recurring2,
        label: 'New gym membership',
        amount_cents: 6000,
        active: true,
        scope_type: 'custom_months',
        scope_year: 2026,
        active_months: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      });

      const jan = await app.request(
        `/households/${HID}/savings/recurring-payments?year=2026&month=1`,
        { headers: authHeaders(token) },
        testEnv
      );
      const janView = (await jan.json()) as { totalMonthlyCents: number };
      expect(janView.totalMonthlyCents).toBe(9000); // gym not active yet

      const mar = await app.request(
        `/households/${HID}/savings/recurring-payments?year=2026&month=3`,
        { headers: authHeaders(token) },
        testEnv
      );
      const marView = (await mar.json()) as { totalMonthlyCents: number };
      expect(marView.totalMonthlyCents).toBe(15000); // both active
    });

    it('GET /overview excludes an out-of-scope payment from spending + YTD net', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await createRecurring(token, app, {
        id: IDS.recurring1,
        label: 'New gym membership',
        amount_cents: 6000,
        active: true,
        scope_type: 'custom_months',
        scope_year: 2026,
        active_months: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      });

      const jan = await app.request(
        `/households/${HID}/savings/overview?year=2026&month=1`,
        { headers: authHeaders(token) },
        testEnv
      );
      const janOverview = (await jan.json()) as { spending: { monthlyPayments: number }; ytdNet: number };
      expect(janOverview.spending.monthlyPayments).toBe(0);
      expect(janOverview.ytdNet).toBe(0); // no income, no spend — not -6000

      const mar = await app.request(
        `/households/${HID}/savings/overview?year=2026&month=3`,
        { headers: authHeaders(token) },
        testEnv
      );
      const marOverview = (await mar.json()) as { spending: { monthlyPayments: number }; ytdNet: number };
      expect(marOverview.spending.monthlyPayments).toBe(6000);
      // YTD across Jan-Mar: only March carries the payment.
      expect(marOverview.ytdNet).toBe(-6000);
    });

    it('propagate whole-year skips months outside the payment scope', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await createRecurring(token, app, {
        id: IDS.recurring1,
        label: 'New gym membership',
        amount_cents: 6000,
        active: true,
        scope_type: 'custom_months',
        scope_year: 2026,
        active_months: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      });
      // Materialize March (in scope). January can never carry this payment
      // (apply already skips it), so it has nothing to rewrite either way.
      await applyMonth(token, app, 2026, 3);

      await app.request(
        `/households/${HID}/savings/recurring-payments/${IDS.recurring1}`,
        { method: 'PATCH', headers: authHeaders(token), body: JSON.stringify({ amount_cents: 6500 }) },
        testEnv
      );

      const res = await app.request(
        `/households/${HID}/savings/recurring-payments/${IDS.recurring1}/propagate`,
        {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({ year: 2026, fromMonth: 1, toMonth: 12 }),
        },
        testEnv
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ updated: 1 }); // March only
    });
  });

  // ==================================================================
  // Recurring payments — monthly history (which-months-apply chart)
  // ==================================================================

  describe('GET /recurring-payments/:id/monthly-history', () => {
    type MonthlyHistoryMonth = {
      month: number;
      inScope: boolean;
      applied: boolean;
      appliedAmountCents: number | null;
    };
    type MonthlyHistoryResponse = {
      year: number;
      amountCents: number;
      scopeType: 'all_year' | 'custom_months';
      months: MonthlyHistoryMonth[];
    };

    const createRecurring = (token: string, app: ReturnType<typeof mkApp>, body: object) =>
      app.request(
        `/households/${HID}/savings/recurring-payments`,
        { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body) },
        testEnv
      );

    const applyMonth = (token: string, app: ReturnType<typeof mkApp>, year: number, month: number) =>
      app.request(
        `/households/${HID}/savings/recurring-payments/apply`,
        { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ year, month }) },
        testEnv
      );

    const getHistory = async (
      token: string,
      app: ReturnType<typeof mkApp>,
      id: string,
      year: number,
      householdId: string = HID
    ) =>
      app.request(
        `/households/${householdId}/savings/recurring-payments/${id}/monthly-history?year=${year}`,
        { headers: authHeaders(token) },
        testEnv
      );

    it('an all_year payment is in scope every month of the year', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await createRecurring(token, app, {
        id: IDS.recurring1,
        label: 'Internet',
        amount_cents: 9000,
        active: true,
      });

      const res = await getHistory(token, app, IDS.recurring1, 2026);
      expect(res.status).toBe(200);
      const body = (await res.json()) as MonthlyHistoryResponse;
      expect(body.year).toBe(2026);
      expect(body.amountCents).toBe(9000);
      expect(body.scopeType).toBe('all_year');
      expect(body.months).toHaveLength(12);
      expect(body.months.every((m) => m.inScope)).toBe(true);
      expect(body.months.every((m) => !m.applied)).toBe(true);
      expect(body.months.every((m) => m.appliedAmountCents === null)).toBe(true);
    });

    it('a custom_months payment is only in scope for its configured months, and only for its own scope_year', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await createRecurring(token, app, {
        id: IDS.recurring1,
        label: 'New gym membership',
        amount_cents: 6000,
        active: true,
        scope_type: 'custom_months',
        scope_year: 2026,
        active_months: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      });

      const res2026 = await getHistory(token, app, IDS.recurring1, 2026);
      expect(res2026.status).toBe(200);
      const body2026 = (await res2026.json()) as MonthlyHistoryResponse;
      expect(body2026.scopeType).toBe('custom_months');
      expect(body2026.months.filter((m) => m.inScope).map((m) => m.month)).toEqual([
        3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
      ]);
      expect(body2026.months.filter((m) => !m.inScope).map((m) => m.month)).toEqual([1, 2]);

      // A DIFFERENT year is untouched by the 2026 scope — every month is in scope.
      const res2027 = await getHistory(token, app, IDS.recurring1, 2027);
      expect(res2027.status).toBe(200);
      const body2027 = (await res2027.json()) as MonthlyHistoryResponse;
      expect(body2027.months.every((m) => m.inScope)).toBe(true);
    });

    it('a month with an applied spending row comes back applied:true with the summed amount', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await createRecurring(token, app, {
        id: IDS.recurring1,
        label: 'Internet',
        amount_cents: 9000,
        active: true,
      });
      expect((await applyMonth(token, app, 2026, 8)).status).toBe(200);

      const res = await getHistory(token, app, IDS.recurring1, 2026);
      expect(res.status).toBe(200);
      const body = (await res.json()) as MonthlyHistoryResponse;
      const aug = body.months.find((m) => m.month === 8)!;
      expect(aug.applied).toBe(true);
      expect(aug.appliedAmountCents).toBe(9000);
      // Every other month stays untouched.
      expect(body.months.filter((m) => m.applied)).toHaveLength(1);
    });

    it('404s an unknown recurring payment id', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      const res = await getHistory(token, app, 'does-not-exist', 2026);
      expect(res.status).toBe(404);
    });

    it('404s a recurring payment id that belongs to a different household (IDOR)', async () => {
      const token = await mintToken(UID);
      const otherToken = await mintToken(OTHER_UID);
      const app = mkApp();

      // Created under OTHER_HID by the outsider.
      await app.request(
        `/households/${OTHER_HID}/savings/recurring-payments`,
        {
          method: 'POST',
          headers: authHeaders(otherToken),
          body: JSON.stringify({ id: IDS.recurring2, label: 'Other household bill', amount_cents: 4000, active: true }),
        },
        testEnv
      );

      // The HID member reaches into OTHER_HID's payment via HID's own URL.
      const res = await getHistory(token, app, IDS.recurring2, 2026, HID);
      expect(res.status).toBe(404);
    });

    it('403s a user who is not a member of the household at all', async () => {
      const token = await mintToken(UID);
      const otherToken = await mintToken(OTHER_UID);
      const app = mkApp();

      await createRecurring(token, app, {
        id: IDS.recurring1,
        label: 'Internet',
        amount_cents: 9000,
        active: true,
      });

      const res = await getHistory(otherToken, app, IDS.recurring1, 2026, HID);
      expect(res.status).toBe(403);
    });
  });

  // ==================================================================
  // Recurring payments — yearly per-group breakdown (Monthly tab's
  // "distribution by month" chart)
  // ==================================================================

  describe('GET /recurring-payments/yearly-breakdown', () => {
    type YearlyBreakdownResponse = {
      year: number;
      groups: Array<{ group_label: string | null }>;
      months: Array<{
        month: number;
        totalCents: number;
        byGroup: Array<{ group_label: string | null; subtotalCents: number }>;
      }>;
    };

    const createRecurring = (token: string, app: ReturnType<typeof mkApp>, body: object) =>
      app.request(
        `/households/${HID}/savings/recurring-payments`,
        { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body) },
        testEnv
      );

    const getBreakdown = async (
      token: string,
      app: ReturnType<typeof mkApp>,
      year: number,
      householdId: string = HID
    ) =>
      app.request(
        `/households/${householdId}/savings/recurring-payments/yearly-breakdown?year=${year}`,
        { headers: authHeaders(token) },
        testEnv
      );

    it('sums an all_year payment into every month, under its own group', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await createRecurring(token, app, {
        id: IDS.recurring1,
        label: 'Internet',
        amount_cents: 9000,
        group_label: 'Utilities',
        active: true,
      });

      const res = await getBreakdown(token, app, 2026);
      expect(res.status).toBe(200);
      const body = (await res.json()) as YearlyBreakdownResponse;
      expect(body.year).toBe(2026);
      expect(body.months).toHaveLength(12);
      expect(body.months.every((m) => m.totalCents === 9000)).toBe(true);
      for (const m of body.months) {
        const utilities = m.byGroup.find((g) => g.group_label === 'Utilities');
        expect(utilities?.subtotalCents).toBe(9000);
      }
    });

    it('a custom_months payment only counts toward its own scoped months', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await createRecurring(token, app, {
        id: IDS.recurring1,
        label: 'Summer camp',
        amount_cents: 6000,
        group_label: 'Childcare & Education',
        active: true,
        scope_type: 'custom_months',
        scope_year: 2026,
        active_months: [6, 7, 8],
      });

      const res = await getBreakdown(token, app, 2026);
      const body = (await res.json()) as YearlyBreakdownResponse;
      const inScope = body.months.filter((m) => [6, 7, 8].includes(m.month));
      const outOfScope = body.months.filter((m) => ![6, 7, 8].includes(m.month));
      expect(inScope.every((m) => m.totalCents === 6000)).toBe(true);
      expect(outOfScope.every((m) => m.totalCents === 0)).toBe(true);
    });

    it('keeps every group\'s stack position stable even in a month it contributes nothing', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await createRecurring(token, app, {
        id: IDS.recurring1,
        label: 'Rent',
        amount_cents: 180000,
        group_label: 'Housing',
        active: true,
      });
      await createRecurring(token, app, {
        id: IDS.recurring2,
        label: 'Summer camp',
        amount_cents: 6000,
        group_label: 'Childcare & Education',
        active: true,
        scope_type: 'custom_months',
        scope_year: 2026,
        active_months: [7],
      });

      const res = await getBreakdown(token, app, 2026);
      const body = (await res.json()) as YearlyBreakdownResponse;

      // "Childcare & Education" is a real group all year, just $0 outside July —
      // never dropped from a month's byGroup array (a chart stacking by
      // ARRAY POSITION would mis-color a group that disappears some months).
      const groupLabels = body.groups.map((g) => g.group_label);
      expect(groupLabels).toContain('Childcare & Education');
      const january = body.months.find((m) => m.month === 1)!;
      expect(january.byGroup.map((g) => g.group_label)).toEqual(groupLabels);
      const januaryCamp = january.byGroup.find((g) => g.group_label === 'Childcare & Education');
      expect(januaryCamp?.subtotalCents).toBe(0);
    });

    it('excludes an inactive payment from every month', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      const created = await createRecurring(token, app, {
        id: IDS.recurring1,
        label: 'Old gym',
        amount_cents: 5000,
        group_label: 'Health',
        active: false,
      });
      expect(created.status).toBe(201);

      const res = await getBreakdown(token, app, 2026);
      const body = (await res.json()) as YearlyBreakdownResponse;
      expect(body.months.every((m) => m.totalCents === 0)).toBe(true);
      expect(body.groups).toHaveLength(0);
    });

    it('reclassifies ungrouped housing/loan payments the same way the list view does', async () => {
      const token = await mintToken(UID);
      const app = mkApp();

      await createRecurring(token, app, {
        id: IDS.recurring1,
        label: 'Mortgage Home',
        amount_cents: 430000,
        group_label: null,
        active: true,
      });

      const res = await getBreakdown(token, app, 2026);
      const body = (await res.json()) as YearlyBreakdownResponse;
      const housing = body.months[0]?.byGroup.find((g) => g.group_label === 'Housing');
      expect(housing?.subtotalCents).toBe(430000);
    });

    it('403s a user who is not a member of the household', async () => {
      const token = await mintToken(OTHER_UID);
      const app = mkApp();

      const res = await getBreakdown(token, app, 2026, HID);
      expect(res.status).toBe(403);
    });
  });

  // ==================================================================
  // AI import — kill switch, auth/scoping, file-validation error codes
  // ==================================================================

  describe('AI import', () => {
    function importMultipart(file: { bytes: Uint8Array; type: string; name: string }, text?: string) {
      const form = new FormData();
      if (text) form.append('text', text);
      form.append('file', new File([file.bytes], file.name, { type: file.type }));
      return form;
    }

    it('returns 401 for an unauthenticated import request', async () => {
      const app = mkApp();
      const res = await app.request(
        `/households/${HID}/savings/import`,
        { method: 'POST', body: JSON.stringify({ text: 'hi' }), headers: { 'Content-Type': 'application/json' } },
        testEnv
      );
      expect(res.status).toBe(401);
    });

    it('returns 403 for a non-member import request', async () => {
      const token = await mintToken(OTHER_UID);
      const app = mkApp();
      const res = await app.request(
        `/households/${HID}/savings/import`,
        { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ text: 'hi' }) },
        testEnv
      );
      expect(res.status).toBe(403);
    });

    it('404s import routes when savings_import_enabled === "false" (main surface still up)', async () => {
      await testEnv.CONFIG_KV.put('savings_import_enabled', 'false');
      const token = await mintToken(UID);
      const app = mkApp();

      const importRes = await app.request(
        `/households/${HID}/savings/import`,
        { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ text: 'hi' }) },
        testEnv
      );
      expect(importRes.status).toBe(404);

      const getRes = await app.request(
        `/households/${HID}/savings/import/some-job-id`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(getRes.status).toBe(404);

      // The rest of the surface is unaffected.
      const overview = await app.request(
        `/households/${HID}/savings/overview?year=2026&month=6`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(overview.status).toBe(200);
    });

    it('rejects an unsupported file type with 400 UNSUPPORTED_FILE_TYPE', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      const form = importMultipart({
        bytes: new Uint8Array([1, 2, 3, 4]),
        type: 'application/zip',
        name: 'sheet.zip',
      });
      const res = await app.request(
        `/households/${HID}/savings/import`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
        testEnv
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('UNSUPPORTED_FILE_TYPE');
    });

    it('rejects an oversize (>20 MB) file with 400 IMPORT_TOO_LARGE', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      // 20 MB + 1 byte of an allowed mime type — fails the size cap BEFORE any AI call.
      const tooBig = new Uint8Array(20 * 1024 * 1024 + 1);
      const form = importMultipart({ bytes: tooBig, type: 'application/pdf', name: 'huge.pdf' });
      const res = await app.request(
        `/households/${HID}/savings/import`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
        testEnv
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('IMPORT_TOO_LARGE');
    });

    it('rejects an empty import (no text, no file) with 400', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      const form = new FormData();
      const res = await app.request(
        `/households/${HID}/savings/import`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
        testEnv
      );
      expect(res.status).toBe(400);
    });
  });
});
