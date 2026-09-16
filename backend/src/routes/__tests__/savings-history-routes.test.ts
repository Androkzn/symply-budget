/**
 * savings.ts previous-years routes — /history/years, /history/year,
 * /history/compare and the /import/:jobId/commit-history + /undo-history
 * endpoints. Covers auth/scoping, the savings + import kill switches, query
 * validation, and a happy path through the router (true integration tests).
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import * as schema from '../../db/schema';
import { expenses, budgetCategories } from '../../db/schema-budget';
import { savingsIncomeEntries, savingsImportJobs } from '../../db/schema-savings';
import { createCoreTables, resetAllTables } from '../../services/aihousekeeper/__tests__/test-helpers';
import type { Env } from '../../types';
import savingsRouter from '../savings';

import { applyBudgetWorkerTestBrand } from './budget-test-helpers';
import { createSavingsTables, resetSavingsTables } from './savings-test-helpers';

const testEnv = env as unknown as Env;

const HID = 'hh_hist_routes_01';
const UID = 'u_hist_routes_owner';
const MID = 'm_hist_routes_owner';
const OUT_UID = 'u_hist_routes_outsider';

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
  app.onError((error, c) => {
    const named = ['ValidationError', 'ForbiddenError', 'NotFoundError', 'UnauthorizedError'];
    const e = error as unknown as { name: string; code?: string; message: string; statusCode?: number };
    if (named.includes(e.name)) {
      return c.json({ error: { code: e.code, message: e.message } }, (e.statusCode ?? 400) as 400 | 403 | 404);
    }
    return c.json({ error: { code: 'internal_error', message: e.message } }, 500);
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
    { id: UID, email: 'hist-owner@example.com', email_verified: true },
    { id: OUT_UID, email: 'hist-out@example.com', email_verified: true },
  ]);
  await db.insert(schema.households).values({ id: HID, name: 'HistRoutes' });
  await db.insert(schema.householdMembers).values({
    id: MID,
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: '2024-01-01T00:00:00Z',
  });

  // Seed a year of data: income + Groceries expense in 2025.
  const db2 = drizzle(testEnv.DB, { schema });
  await db2.insert(budgetCategories).values({ id: 'cat_g', household_id: HID, name: 'Groceries' });
  await db2.insert(savingsIncomeEntries).values({
    id: 'inc_1',
    household_id: HID,
    source_type: 'payroll',
    label: 'Income',
    amount_cents: 500000,
    income_date: '2025-01-01',
  });
  await db2.insert(expenses).values({
    id: 'exp_1',
    household_id: HID,
    category_id: 'cat_g',
    title: 'Food',
    amount: 40000,
    expense_date: '2025-01-01',
  });
}

async function req(path: string, userId: string | null, init: RequestInit = {}) {
  const headers = userId ? authHeaders(await mintToken(userId)) : { 'Content-Type': 'application/json' };
  return mkApp().request(`/households/${HID}/savings${path}`, { ...init, headers }, testEnv);
}

describe('savings previous-years routes', () => {
  beforeEach(async () => {
    await seed();
    await testEnv.CONFIG_KV.delete('savings_enabled');
    await testEnv.CONFIG_KV.delete('savings_import_enabled');
  });
  afterEach(async () => {
    await testEnv.CONFIG_KV.delete('savings_enabled');
    await testEnv.CONFIG_KV.delete('savings_import_enabled');
  });

  describe('GET /history/years', () => {
    it('401 unauthenticated', async () => {
      expect((await req('/history/years', null)).status).toBe(401);
    });
    it('403 for a non-member', async () => {
      expect((await req('/history/years', OUT_UID)).status).toBe(403);
    });
    it('404 when savings_enabled === "false"', async () => {
      await testEnv.CONFIG_KV.put('savings_enabled', 'false');
      expect((await req('/history/years', UID)).status).toBe(404);
    });
    it('returns the years with data', async () => {
      const res = await req('/history/years', UID);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ years: [2025] });
    });
  });

  describe('GET /history/year', () => {
    it('400 without a year param', async () => {
      expect((await req('/history/year', UID)).status).toBe(400);
    });
    it('returns the 12-month grid', async () => {
      const res = await req('/history/year?year=2025', UID);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { year: number; months: unknown[]; totals: { food: number } };
      expect(body.year).toBe(2025);
      expect(body.months).toHaveLength(12);
      expect(body.totals.food).toBe(40000);
    });
  });

  describe('GET /history/compare', () => {
    it('400 when years param is empty/invalid', async () => {
      expect((await req('/history/compare?years=abc', UID)).status).toBe(400);
      expect((await req('/history/compare', UID)).status).toBe(400);
    });
    it('compares the requested years', async () => {
      const res = await req('/history/compare?years=2024,2025', UID);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { years: { year: number }[]; deltas: unknown[] };
      expect(body.years.map((y) => y.year)).toEqual([2024, 2025]);
      expect(body.deltas).toHaveLength(1);
    });
  });

  describe('POST /import/:jobId/commit-history', () => {
    async function seedJob(id: string) {
      await drizzle(testEnv.DB, { schema })
        .insert(savingsImportJobs)
        .values({ id, household_id: HID, status: 'ready', source_kind: 'text', draft_json: '{}', created_by: UID });
    }
    const body = JSON.stringify({
      selections: {
        income: [
          {
            member_name: null,
            source_type: 'payroll',
            label: 'Income',
            amount_cents: 300000,
            income_date: '2024-01-01',
            is_recurring: false,
            day_of_month: null,
          },
        ],
        monthlyGridSpending: [{ period: '2024-01', category_name: 'Food', amount_cents: 20000 }],
      },
    });

    it('404 when savings_import_enabled === "false"', async () => {
      await seedJob('job_r_killed');
      await testEnv.CONFIG_KV.put('savings_import_enabled', 'false');
      const res = await req('/import/job_r_killed/commit-history', UID, { method: 'POST', body });
      expect(res.status).toBe(404);
    });
    it('400 on a malformed selections body (net column smuggled in)', async () => {
      await seedJob('job_r_bad');
      const bad = JSON.stringify({ selections: { income: [], monthlyGridSpending: [{ period: 'nope', category_name: 'X', amount_cents: 1 }] } });
      const res = await req('/import/job_r_bad/commit-history', UID, { method: 'POST', body: bad });
      expect(res.status).toBe(400);
    });
    it('commits and then undoes a previous-years import', async () => {
      await seedJob('job_r_ok');
      const res = await req('/import/job_r_ok/commit-history', UID, { method: 'POST', body });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ income: 1, spending: 1, years: [2024] });

      const undo = await req('/import/job_r_ok/undo-history', UID, { method: 'POST', body: '{}' });
      expect(undo.status).toBe(200);
      expect(await undo.json()).toEqual({ income: 1, spending: 1 });
    });

    // History import shares importDraftIncomeSchema with the AI importer, so it
    // inherits the one-off sources. Asserted explicitly because a future
    // tightening of the history schema could silently drop them again.
    it('accepts a one-off income source in a previous-years import', async () => {
      await seedJob('job_r_irregular');
      const irregularBody = JSON.stringify({
        selections: {
          income: [
            {
              member_name: null,
              source_type: 'marketplace_sale',
              label: 'Sold furniture',
              amount_cents: 45000,
              income_date: '2024-03-01',
              is_recurring: false,
              day_of_month: null,
            },
          ],
          monthlyGridSpending: [],
        },
      });

      const res = await req('/import/job_r_irregular/commit-history', UID, {
        method: 'POST',
        body: irregularBody,
      });
      expect(res.status).toBe(200);

      const rows = await drizzle(testEnv.DB, { schema })
        .select()
        .from(savingsIncomeEntries)
        .all();
      const sale = rows.find((r) => r.label === 'Sold furniture');
      expect(sale?.source_type).toBe('marketplace_sale');
    });

    it('rejects an unknown income source in a previous-years import', async () => {
      await seedJob('job_r_bad_source');
      const badBody = JSON.stringify({
        selections: {
          income: [
            {
              member_name: null,
              source_type: 'lottery_win',
              label: 'Scratch ticket',
              amount_cents: 45000,
              income_date: '2024-03-01',
              is_recurring: false,
              day_of_month: null,
            },
          ],
          monthlyGridSpending: [],
        },
      });

      const res = await req('/import/job_r_bad_source/commit-history', UID, {
        method: 'POST',
        body: badBody,
      });
      expect(res.status).toBe(400);
    });
  });
});
