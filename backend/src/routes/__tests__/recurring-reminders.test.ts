/**
 * recurring-reminders.ts routes — the in-app "Active" list surface: list what's
 * still pending, mark one done, change its cadence. Auth (401), household
 * scoping (403), and validation (400) covered alongside the happy paths. Engine
 * mechanics (nudge timing, auto-complete) are covered in
 * `services/recurring-reminders/__tests__/engine.test.ts`.
 */
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../db/schema';
import { recurringReminders } from '../../db/schema-recurring-reminders';
import { createCoreTables, resetAllTables } from '../../services/aihousekeeper/__tests__/test-helpers';
import { createRecurringReminderTables, resetRecurringReminderTables } from '../../services/recurring-reminders/__tests__/test-helpers';
import type { Env } from '../../types';
import recurringReminderRouter from '../recurring-reminders';

const testEnv = env as unknown as Env;

const HID = 'hh_rr_routes';
const UID = 'u_rr_member';
const OTHER_UID = 'u_rr_outsider';
const RID = 'rr_pending_1';

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
  app.route('/households/:householdId/recurring-reminders', recurringReminderRouter);
  app.onError((error, c) => {
    const named = ['ApiError', 'ValidationError', 'UnauthorizedError', 'ForbiddenError', 'NotFoundError'];
    if (named.includes((error as Error).name)) {
      const e = error as unknown as { code: string; message: string; statusCode: number };
      return c.json({ error: { code: e.code, message: e.message } }, e.statusCode as 400 | 401 | 403 | 404);
    }
    return c.json({ error: { code: 'internal_error', message: (error as Error).message } }, 500);
  });
  return app;
}

async function seed(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createRecurringReminderTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetRecurringReminderTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values([
    { id: UID, email: 'rr-member@example.com', email_verified: true },
    { id: OTHER_UID, email: 'rr-outsider@example.com', email_verified: true },
  ]);
  await db.insert(schema.households).values({ id: HID, name: 'RR household' });
  await db.insert(schema.householdMembers).values({
    id: 'hm_rr_member',
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: '2025-01-01T00:00:00Z',
  });

  const rrDb = drizzle(testEnv.DB);
  await rrDb.insert(recurringReminders).values({
    id: RID,
    household_id: HID,
    type: 'mortgage_statement_reminder',
    reference_type: 'mortgage',
    reference_id: 'm_1',
    period_key: '2026-03',
    status: 'pending',
    title: 'Mortgage statement time',
    body: "Don't forget to upload this month's mortgage statement.",
    data: JSON.stringify({ type: 'mortgage_statement_reminder', householdId: HID, mortgageId: 'm_1' }),
    frequency: 'every_3_days',
    next_nudge_at: new Date(Date.now() + 86_400_000).toISOString(),
    nudge_count: 0,
  });
}

function authed(app: ReturnType<typeof mkApp>, token: string, method: string, path: string, body?: unknown) {
  return app.request(
    `/households/${HID}/recurring-reminders${path}`,
    {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    testEnv
  );
}

describe('recurring-reminders routes', () => {
  beforeEach(seed);

  it('GET / returns the household\'s pending reminders + frequency options', async () => {
    const token = await mintToken(UID);
    const res = await authed(mkApp(), token, 'GET', '');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reminders: Array<{ id: string }>; frequencyOptions: Array<{ id: string }> };
    expect(body.reminders.map((r) => r.id)).toEqual([RID]);
    expect(body.frequencyOptions.map((f) => f.id)).toContain('weekly');
  });

  it('rejects an unauthenticated request', async () => {
    const app = mkApp();
    const res = await app.request(`/households/${HID}/recurring-reminders`, {}, testEnv);
    expect(res.status).toBe(401);
  });

  it('rejects a caller who is not a member of the household', async () => {
    const token = await mintToken(OTHER_UID);
    const res = await authed(mkApp(), token, 'GET', '');
    expect(res.status).toBe(403);
  });

  it('POST /:id/complete marks the reminder done and removes it from the active list', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    const completeRes = await authed(app, token, 'POST', `/${RID}/complete`);
    expect(completeRes.status).toBe(200);
    const { reminder } = (await completeRes.json()) as { reminder: { status: string; completed_by_user_id: string } };
    expect(reminder.status).toBe('done');
    expect(reminder.completed_by_user_id).toBe(UID);

    const listRes = await authed(app, token, 'GET', '');
    const { reminders } = (await listRes.json()) as { reminders: unknown[] };
    expect(reminders).toHaveLength(0);
  });

  it('POST /:id/complete 404s for an unknown id', async () => {
    const token = await mintToken(UID);
    const res = await authed(mkApp(), token, 'POST', '/does-not-exist/complete');
    expect(res.status).toBe(404);
  });

  it('POST /:id/frequency updates the cadence', async () => {
    const token = await mintToken(UID);
    const res = await authed(mkApp(), token, 'POST', `/${RID}/frequency`, { frequency: 'weekly' });
    expect(res.status).toBe(200);
    const { reminder } = (await res.json()) as { reminder: { frequency: string } };
    expect(reminder.frequency).toBe('weekly');
  });

  it('POST /:id/frequency rejects an invalid frequency value', async () => {
    const token = await mintToken(UID);
    const res = await authed(mkApp(), token, 'POST', `/${RID}/frequency`, { frequency: 'hourly' });
    expect(res.status).toBe(400);
  });
});
