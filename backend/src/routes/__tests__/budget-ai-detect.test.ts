/**
 * budget.ts — AI detect routes (text + multipart upload).
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import * as schema from '../../db/schema';
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

const mockSuggestFromText = vi.fn();
const mockSuggestFromTextAndFile = vi.fn();

vi.mock('../../services/budget-suggestion-service', () => ({
  BudgetSuggestionService: class MockBudgetSuggestionService {
    suggestFromText = mockSuggestFromText;
    suggestFromTextAndFile = mockSuggestFromTextAndFile;
  },
}));

const testEnv = env as unknown as Env;
const HID = 'hh_budget_ai_detect_01';
const UID = 'u_budget_ai_detect_owner';
const MID = 'm_budget_ai_detect_owner';

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
  return app;
}

async function seed(): Promise<void> {
  applyBudgetWorkerTestBrand(testEnv);
  await createCoreTables(testEnv.DB);
  await createBudgetTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetBudgetTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values({ id: UID, email: 'ai-detect@example.com', email_verified: true });
  await db.insert(schema.households).values({ id: HID, name: 'BudgetAIDetectTest' });
  await db.insert(schema.householdMembers).values({
    id: MID,
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: '2025-01-01T00:00:00Z',
  });
}

describe('budget AI detect routes', () => {
  beforeEach(async () => {
    await seed();
    mockSuggestFromText.mockReset();
    mockSuggestFromTextAndFile.mockReset();
    mockSuggestFromText.mockResolvedValue([
      {
        title: 'Netflix',
        description: null,
        estimated_cost_min: 1600,
        estimated_cost_max: 1600,
        priority: 'medium',
        category_id: null,
        category_name: null,
        scheduled: false,
        target_date: null,
        is_recurring: true,
        recurrence_frequency: 'monthly',
      },
    ]);
    mockSuggestFromTextAndFile.mockResolvedValue([
      {
        title: 'Water heater',
        description: null,
        estimated_cost_min: 200000,
        estimated_cost_max: 200000,
        priority: 'high',
        category_id: null,
        category_name: null,
        scheduled: true,
        target_date: '2026-08-01',
        is_recurring: false,
        recurrence_frequency: null,
      },
    ]);
  });

  it('POST /items/ai-detect returns suggestions from text', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(
      `/households/${HID}/budget/items/ai-detect`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Netflix $16 monthly', year: 2026, month: 7 }),
      },
      testEnv
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { suggestions: Array<{ title: string }> };
    expect(body.suggestions[0]?.title).toBe('Netflix');
    expect(mockSuggestFromText).toHaveBeenCalledWith(HID, UID, {
      text: 'Netflix $16 monthly',
      year: 2026,
      month: 7,
    });
  });

  it('POST /items/ai-detect-upload accepts multipart file + text', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const form = new FormData();
    form.append('text', 'From the contractor quote');
    form.append('year', '2026');
    form.append('month', '7');
    form.append('file', new File(['fake pdf'], 'quote.pdf', { type: 'application/pdf' }));

    const res = await app.request(
      `/households/${HID}/budget/items/ai-detect-upload`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      },
      testEnv
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { suggestions: Array<{ title: string }> };
    expect(body.suggestions[0]?.title).toBe('Water heater');
    expect(mockSuggestFromTextAndFile).toHaveBeenCalledTimes(1);
    const call = mockSuggestFromTextAndFile.mock.calls[0];
    expect(call?.[0]).toBe(HID);
    expect(call?.[1]).toBe(UID);
    expect(call?.[2]?.text).toBe('From the contractor quote');
    expect(call?.[2]?.year).toBe(2026);
    expect(call?.[2]?.month).toBe(7);
    expect(call?.[2]?.file?.name).toBe('quote.pdf');
    expect(call?.[2]?.file?.mimeType).toBe('application/pdf');
  });

  it('POST /items/ai-detect-upload rejects unsupported file types', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const form = new FormData();
    form.append('file', new File(['data'], 'notes.txt', { type: 'text/plain' }));

    const res = await app.request(
      `/households/${HID}/budget/items/ai-detect-upload`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      },
      testEnv
    );

    expect(res.status).toBe(400);
    expect(mockSuggestFromTextAndFile).not.toHaveBeenCalled();
  });

  it('POST /items/ai-detect-upload requires text or file', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const form = new FormData();

    const res = await app.request(
      `/households/${HID}/budget/items/ai-detect-upload`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      },
      testEnv
    );

    expect(res.status).toBe(400);
    expect(mockSuggestFromTextAndFile).not.toHaveBeenCalled();
  });

  it('GET /quick-add returns recent and popular templates', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const now = new Date().toISOString();

    await testEnv.DB.prepare(
      `INSERT INTO expenses (id, household_id, title, amount, expense_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind('exp-1', HID, 'Netflix', 1600, '2026-07-01', now)
      .run();
    await testEnv.DB.prepare(
      `INSERT INTO expenses (id, household_id, title, amount, expense_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind('exp-2', HID, 'Netflix', 1600, '2026-06-01', '2026-06-01T00:00:00Z')
      .run();

    const res = await app.request(
      `/households/${HID}/budget/quick-add?kind=spent`,
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      recent: Array<{ title: string; usage_count: number }>;
      popular: Array<{ title: string }>;
    };
    expect(body.recent[0]?.title).toBe('Netflix');
    expect(body.recent[0]?.usage_count).toBe(2);
  });
});
