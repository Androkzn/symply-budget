/**
 * Renewal reminders for Monthly Payments — `/households/:householdId/savings/
 * recurring-payments/:id/renewal*` in `routes/savings.ts`, backed by
 * `BudgetRenewalService`. Covers the CRUD + mark-renewed lifecycle, the
 * document reserve→PUT→GET→DELETE contract (mirrors
 * `routes/__tests__/health-files.test.ts`), household scoping/IDOR, and the
 * hand-off into the shared recurring-reminders engine. The engine's own nudge
 * cadence and `isSatisfied` auto-complete are covered by
 * `services/recurring-reminders/__tests__/engine.test.ts` and
 * `services/budget/__tests__/renewal-reminder.test.ts` — these are route-level
 * integration tests.
 */
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../db/schema';
import { recurringReminders } from '../../db/schema-recurring-reminders';
import { savingsRecurringPayments } from '../../db/schema-savings';
import { createCoreTables, resetAllTables } from '../../services/aihousekeeper/__tests__/test-helpers';
import { createRecurringReminderTables, resetRecurringReminderTables } from '../../services/recurring-reminders/__tests__/test-helpers';
import type { Env } from '../../types';
import savingsRouter from '../savings';

import { applyBudgetWorkerTestBrand } from './budget-test-helpers';
import { createSavingsTables, resetSavingsTables } from './savings-test-helpers';

const testEnv = env as unknown as Env;

const HID = 'hh_renewal_routes';
const UID = 'u_renewal_routes_owner';
const MID = 'm_renewal_routes_owner';
const PAYMENT_ID = 'pay_renewal_routes_condo_ins';

const OTHER_HID = 'hh_renewal_routes_other';
const OTHER_UID = 'u_renewal_routes_outsider';
const OTHER_MID = 'm_renewal_routes_outsider';

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
    const apiErrorNames = ['ApiError', 'ValidationError', 'ForbiddenError', 'NotFoundError'];
    const errorName = (error as Error).name;
    if (apiErrorNames.includes(errorName)) {
      const apiError = error as unknown as { code: string; message: string; statusCode: number };
      return c.json({ error: { code: apiError.code, message: apiError.message } }, apiError.statusCode as 400 | 403 | 404);
    }
    return c.json({ error: { code: 'internal_error', message: error.message } }, 500);
  });
  return app;
}

function authHeaders(token: string, contentType?: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, ...(contentType ? { 'Content-Type': contentType } : {}) };
}

const RENEWAL_BASE = `/households/${HID}/savings/recurring-payments/${PAYMENT_ID}/renewal`;

async function seed(): Promise<void> {
  applyBudgetWorkerTestBrand(testEnv);
  await createCoreTables(testEnv.DB);
  await createSavingsTables(testEnv.DB);
  await createRecurringReminderTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetSavingsTables(testEnv.DB);
  await resetRecurringReminderTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values([
    { id: UID, email: 'renewal-routes@example.com', email_verified: true },
    { id: OTHER_UID, email: 'renewal-routes-outsider@example.com', email_verified: true },
  ]);
  await db.insert(schema.households).values([
    { id: HID, name: 'RenewalRoutesTest' },
    { id: OTHER_HID, name: 'RenewalRoutesOther' },
  ]);
  await db.insert(schema.householdMembers).values([
    { id: MID, household_id: HID, user_id: UID, role: 'owner', joined_at: '2025-01-01T00:00:00Z' },
    { id: OTHER_MID, household_id: OTHER_HID, user_id: OTHER_UID, role: 'owner', joined_at: '2025-01-01T00:00:00Z' },
  ]);

  const savingsDb = drizzle(testEnv.DB);
  await savingsDb.insert(savingsRecurringPayments).values({
    id: PAYMENT_ID,
    household_id: HID,
    label: 'Condo insurance',
    amount_cents: 5000,
  });

  await testEnv.CONFIG_KV.delete('savings_enabled');
}

describe('renewal reminder routes', () => {
  let token: string;
  let otherToken: string;

  beforeEach(async () => {
    await seed();
    token = await mintToken(UID);
    otherToken = await mintToken(OTHER_UID);
  });

  describe('GET /renewal', () => {
    it('401s without a bearer token', async () => {
      const res = await mkApp().request(RENEWAL_BASE, {}, testEnv);
      expect(res.status).toBe(401);
    });

    it('returns { renewal: null, documents: [] } when nothing is tracked yet', async () => {
      const res = await mkApp().request(RENEWAL_BASE, { headers: authHeaders(token) }, testEnv);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ renewal: null, documents: [] });
    });

    it('403s a member outside the household', async () => {
      const res = await mkApp().request(RENEWAL_BASE, { headers: authHeaders(otherToken) }, testEnv);
      expect(res.status).toBe(403);
    });
  });

  describe('PUT /renewal', () => {
    it('creates a renewal and schedules the recurring-reminders engine row', async () => {
      const res = await mkApp().request(
        RENEWAL_BASE,
        {
          method: 'PUT',
          headers: authHeaders(token, 'application/json'),
          body: JSON.stringify({
            category: 'insurance',
            provider: 'Aviva',
            cycle: 'annual',
            next_renewal_date: '2999-09-15',
            reminder_lead_days: 14,
          }),
        },
        testEnv
      );
      expect(res.status).toBe(200);
      const { renewal } = await res.json<{ renewal: Record<string, unknown> }>();
      expect(renewal).toMatchObject({
        recurring_payment_id: PAYMENT_ID,
        category: 'insurance',
        provider: 'Aviva',
        cycle: 'annual',
        next_renewal_date: '2999-09-15',
        reminder_lead_days: 14,
        status: 'upcoming',
      });

      const db = drizzle(testEnv.DB);
      const reminders = await db.select().from(recurringReminders).all();
      expect(reminders).toHaveLength(1);
      expect(reminders[0]).toMatchObject({ type: 'budget_renewal_reminder', status: 'pending' });
    });

    it('400s an invalid date', async () => {
      const res = await mkApp().request(
        RENEWAL_BASE,
        {
          method: 'PUT',
          headers: authHeaders(token, 'application/json'),
          body: JSON.stringify({ next_renewal_date: 'not-a-date' }),
        },
        testEnv
      );
      expect(res.status).toBe(400);
    });

    it('404s a recurring_payment_id that does not belong to this household', async () => {
      const res = await mkApp().request(
        `/households/${HID}/savings/recurring-payments/does-not-exist/renewal`,
        {
          method: 'PUT',
          headers: authHeaders(token, 'application/json'),
          body: JSON.stringify({ next_renewal_date: '2999-09-15' }),
        },
        testEnv
      );
      expect(res.status).toBe(404);
    });

    it('updates in place — a second PUT does not create a second renewal row', async () => {
      const put = (date: string) =>
        mkApp().request(
          RENEWAL_BASE,
          {
            method: 'PUT',
            headers: authHeaders(token, 'application/json'),
            body: JSON.stringify({ next_renewal_date: date }),
          },
          testEnv
        );
      await put('2999-09-15');
      const second = await put('2999-10-01');
      expect(second.status).toBe(200);

      const getRes = await mkApp().request(RENEWAL_BASE, { headers: authHeaders(token) }, testEnv);
      const { renewal } = await getRes.json<{ renewal: { next_renewal_date: string } }>();
      expect(renewal.next_renewal_date).toBe('2999-10-01');
    });
  });

  describe('POST /renewal/mark-renewed', () => {
    it('rolls the annual cycle forward by 12 months and re-arms the reminder', async () => {
      await mkApp().request(
        RENEWAL_BASE,
        {
          method: 'PUT',
          headers: authHeaders(token, 'application/json'),
          body: JSON.stringify({ cycle: 'annual', next_renewal_date: '2999-09-15' }),
        },
        testEnv
      );

      const res = await mkApp().request(
        `${RENEWAL_BASE}/mark-renewed`,
        { method: 'POST', headers: authHeaders(token) },
        testEnv
      );
      expect(res.status).toBe(200);
      const { renewal } = await res.json<{ renewal: { next_renewal_date: string; renewal_count: number } }>();
      expect(renewal.next_renewal_date).toBe('3000-09-15');
      expect(renewal.renewal_count).toBe(1);

      const db = drizzle(testEnv.DB);
      const pending = (await db.select().from(recurringReminders).all()).filter((r) => r.status === 'pending');
      expect(pending).toHaveLength(1);
      expect(pending[0].period_key).toBe('3000-09-15');
    });
  });

  describe('DELETE /renewal', () => {
    it('removes the renewal and cancels the pending nag', async () => {
      await mkApp().request(
        RENEWAL_BASE,
        {
          method: 'PUT',
          headers: authHeaders(token, 'application/json'),
          body: JSON.stringify({ next_renewal_date: '2999-09-15' }),
        },
        testEnv
      );

      const del = await mkApp().request(RENEWAL_BASE, { method: 'DELETE', headers: authHeaders(token) }, testEnv);
      expect(del.status).toBe(200);
      expect(await del.json()).toEqual({ success: true });

      const getRes = await mkApp().request(RENEWAL_BASE, { headers: authHeaders(token) }, testEnv);
      expect(await getRes.json()).toEqual({ renewal: null, documents: [] });

      const db = drizzle(testEnv.DB);
      const rows = await db.select().from(recurringReminders).all();
      expect(rows.every((r) => r.status === 'done' && r.completed_reason === 'cancelled')).toBe(true);
    });
  });

  describe('documents', () => {
    async function createRenewal() {
      await mkApp().request(
        RENEWAL_BASE,
        {
          method: 'PUT',
          headers: authHeaders(token, 'application/json'),
          body: JSON.stringify({ next_renewal_date: '2999-09-15' }),
        },
        testEnv
      );
    }

    it('round-trips a reserved document through PUT content / GET content / DELETE', async () => {
      await createRenewal();

      const reserve = await mkApp().request(
        `${RENEWAL_BASE}/documents`,
        {
          method: 'POST',
          headers: authHeaders(token, 'application/json'),
          body: JSON.stringify({
            file_name: 'policy.pdf',
            mime_type: 'application/pdf',
            file_size: 4,
            source: 'file',
          }),
        },
        testEnv
      );
      expect(reserve.status).toBe(201);
      const { document, upload } = await reserve.json<{
        document: { id: string };
        upload: { path: string };
      }>();
      expect(upload.path).toBe(`${RENEWAL_BASE}/documents/${document.id}/content`);

      const bytes = new TextEncoder().encode('%PDF');
      const putRes = await mkApp().request(
        upload.path,
        { method: 'PUT', headers: authHeaders(token), body: bytes },
        testEnv
      );
      expect(putRes.status).toBe(200);

      const getRes = await mkApp().request(`${upload.path}`, { headers: authHeaders(token) }, testEnv);
      expect(getRes.status).toBe(200);
      expect(new Uint8Array(await getRes.arrayBuffer())).toEqual(bytes);
      expect(getRes.headers.get('Content-Type')).toBe('application/pdf');

      const delRes = await mkApp().request(
        `${RENEWAL_BASE}/documents/${document.id}`,
        { method: 'DELETE', headers: authHeaders(token) },
        testEnv
      );
      expect(delRes.status).toBe(200);

      const getAfterDelete = await mkApp().request(upload.path, { headers: authHeaders(token) }, testEnv);
      expect(getAfterDelete.status).toBe(404);
    });

    it('rejects a disallowed mime type', async () => {
      await createRenewal();
      const res = await mkApp().request(
        `${RENEWAL_BASE}/documents`,
        {
          method: 'POST',
          headers: authHeaders(token, 'application/json'),
          body: JSON.stringify({
            file_name: 'script.exe',
            mime_type: 'application/x-msdownload',
            file_size: 10,
            source: 'file',
          }),
        },
        testEnv
      );
      expect(res.status).toBe(403);
    });

    it('404s reserving a document when no renewal is tracked yet', async () => {
      const res = await mkApp().request(
        `${RENEWAL_BASE}/documents`,
        {
          method: 'POST',
          headers: authHeaders(token, 'application/json'),
          body: JSON.stringify({
            file_name: 'policy.pdf',
            mime_type: 'application/pdf',
            file_size: 4,
            source: 'file',
          }),
        },
        testEnv
      );
      expect(res.status).toBe(404);
    });
  });
});
