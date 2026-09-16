/**
 * budget.ts transfer routes — move a month's leftover to next month / savings /
 * registered accounts, and undo it.
 *
 * Covers the 'next_month' destination end-to-end (no savings tables required):
 *   - GET /transfers returns this month's leftover + a next_month destination
 *   - POST /transfers moves leftover, shrinking the source month's balance and
 *     crediting the target month as carry-in (visible in monthly-overview)
 *   - a transfer can't exceed the still-available leftover (400), and once the
 *     leftover is fully moved a further transfer is rejected (no double-spend)
 *   - DELETE /transfers/:id reverses the move (source restored, carry-in removed)
 *   - 403 for a user outside the household
 */

import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../db/schema';
import { savingsGoals, registeredAccounts, registeredTransactions } from '../../db/schema-savings';
import { createCoreTables, resetAllTables } from '../../services/aihousekeeper/__tests__/test-helpers';
import type { Env } from '../../types';
import budgetRouter from '../budget';

import {
  applyBudgetWorkerTestBrand,
  createBudgetTables,
  resetBudgetTables,
} from './budget-test-helpers';
import { createSavingsTables, resetSavingsTables } from './savings-test-helpers';

const GOAL_ID = 'goal_xfer_roof';
const ACCT_ID = 'acct_xfer_tfsa';

const testEnv = env as unknown as Env;

const HID = 'hh_budget_xfer_01';
const UID = 'u_budget_xfer_owner';
const MID = 'm_budget_xfer_owner';

const OTHER_HID = 'hh_budget_xfer_other';
const OTHER_UID = 'u_budget_xfer_outsider';
const OTHER_MID = 'm_budget_xfer_outsider';

interface TransferContext {
  leftoverCents: number;
  carriedInCents: number;
  transferredOutCents: number;
  destinations: Array<{ type: string; id: string | null; label: string }>;
  history: Array<{ id: string; amountCents: number; destinationLabel: string }>;
}

interface Overview {
  remainingBudget: number;
  carriedIn: number;
  transferredOut: number;
}

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
      const apiError = error as unknown as { code: string; message: string; statusCode: number };
      return c.json(
        { error: { code: apiError.code, message: apiError.message } },
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
  await createSavingsTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetBudgetTables(testEnv.DB);
  await resetSavingsTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values([
    { id: UID, email: 'budget-xfer@example.com', email_verified: true },
    { id: OTHER_UID, email: 'budget-xfer-outsider@example.com', email_verified: true },
  ]);
  await db.insert(schema.households).values([
    { id: HID, name: 'BudgetXferTest' },
    { id: OTHER_HID, name: 'BudgetXferOther' },
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

  // A savings goal and a registered account to transfer leftover INTO.
  const raw = drizzle(testEnv.DB);
  await raw.insert(savingsGoals).values({
    id: GOAL_ID,
    household_id: HID,
    type: 'custom',
    name: 'New Roof',
    target_amount_cents: 500000,
    current_amount_cents: 100000,
  });
  await raw.insert(registeredAccounts).values({
    id: ACCT_ID,
    household_id: HID,
    account_type: 'tfsa',
    institution: 'Questrade',
    balance_cents: 1200000,
  });
}

/** Set July 2026's planned budget so there is leftover to move. */
async function setJulyBudget(app: Hono<{ Bindings: Env }>, token: string, cents: number) {
  const res = await app.request(
    `/households/${HID}/budget/goals/2026/7`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ planned_budget: cents }),
    },
    testEnv
  );
  expect(res.status).toBe(200);
}

async function getContext(app: Hono<{ Bindings: Env }>, token: string): Promise<TransferContext> {
  const res = await app.request(
    `/households/${HID}/budget/transfers?year=2026&month=7`,
    { headers: { Authorization: `Bearer ${token}` } },
    testEnv
  );
  expect(res.status).toBe(200);
  return (await res.json()) as TransferContext;
}

async function getAugustOverview(app: Hono<{ Bindings: Env }>, token: string): Promise<Overview> {
  const res = await app.request(
    `/households/${HID}/budget/monthly-overview?year=2026&month=8`,
    { headers: { Authorization: `Bearer ${token}` } },
    testEnv
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Overview;
}

async function postTransfer(
  app: Hono<{ Bindings: Env }>,
  token: string,
  amountCents: number
): Promise<Response> {
  return app.request(
    `/households/${HID}/budget/transfers`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_year: 2026,
        source_month: 7,
        amount_cents: amountCents,
        destination_type: 'next_month',
      }),
    },
    testEnv
  );
}

describe('budget transfer routes', () => {
  beforeEach(seed);

  it('exposes this month leftover and a next_month destination', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    await setJulyBudget(app, token, 100000); // $1,000

    const ctx = await getContext(app, token);
    expect(ctx.leftoverCents).toBe(100000);
    expect(ctx.destinations.some((d) => d.type === 'next_month')).toBe(true);
    expect(ctx.history).toHaveLength(0);
  });

  it('moves leftover to next month, shrinking source and crediting the target', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    await setJulyBudget(app, token, 100000);

    const res = await postTransfer(app, token, 40000);
    expect(res.status).toBe(200);
    const ctx = (await res.json()) as TransferContext;

    // Source month: leftover drops, transferred-out recorded, one history row.
    expect(ctx.leftoverCents).toBe(60000);
    expect(ctx.transferredOutCents).toBe(40000);
    expect(ctx.history).toHaveLength(1);
    expect(ctx.history[0].amountCents).toBe(40000);

    // Target month (August): leftover carried in lifts remaining budget.
    const aug = await getAugustOverview(app, token);
    expect(aug.carriedIn).toBe(40000);
    expect(aug.remainingBudget).toBe(40000);
  });

  it('rejects an amount larger than the available leftover', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    await setJulyBudget(app, token, 100000);

    const res = await postTransfer(app, token, 150000);
    expect(res.status).toBe(400);
  });

  it('prevents moving the same leftover twice', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    await setJulyBudget(app, token, 100000);

    // Move it all, then any further transfer must fail (leftover is now 0).
    expect((await postTransfer(app, token, 100000)).status).toBe(200);
    const ctx = await getContext(app, token);
    expect(ctx.leftoverCents).toBe(0);

    const res = await postTransfer(app, token, 1);
    expect(res.status).toBe(400);
  });

  it('undoes a transfer, restoring source and removing the carry-in', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    await setJulyBudget(app, token, 100000);

    const created = (await (await postTransfer(app, token, 40000)).json()) as TransferContext;
    const transferId = created.history[0].id;

    const del = await app.request(
      `/households/${HID}/budget/transfers/${transferId}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    expect(del.status).toBe(200);
    const ctx = (await del.json()) as TransferContext;
    expect(ctx.leftoverCents).toBe(100000);
    expect(ctx.transferredOutCents).toBe(0);
    expect(ctx.history).toHaveLength(0);

    const aug = await getAugustOverview(app, token);
    expect(aug.carriedIn).toBe(0);
    expect(aug.remainingBudget).toBe(0);
  });

  it('lists savings-goal and registered-account destinations', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    await setJulyBudget(app, token, 100000);

    const ctx = await getContext(app, token);
    const goal = ctx.destinations.find((d) => d.type === 'savings_goal' && d.id === GOAL_ID);
    const account = ctx.destinations.find((d) => d.type === 'registered_account' && d.id === ACCT_ID);
    expect(goal?.label).toBe('New Roof');
    expect(account?.label).toBe('TFSA · Questrade');
  });

  it('transfers to a savings goal (bumps current amount) and reverses on undo', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    await setJulyBudget(app, token, 100000);
    const raw = drizzle(testEnv.DB);

    const res = await app.request(
      `/households/${HID}/budget/transfers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_year: 2026,
          source_month: 7,
          amount_cents: 30000,
          destination_type: 'savings_goal',
          destination_id: GOAL_ID,
        }),
      },
      testEnv
    );
    expect(res.status).toBe(200);
    const ctx = (await res.json()) as TransferContext;
    expect(ctx.leftoverCents).toBe(70000);

    const afterGoal = await raw.select().from(savingsGoals).where(eq(savingsGoals.id, GOAL_ID)).get();
    expect(afterGoal?.current_amount_cents).toBe(130000); // 100000 + 30000

    // Undo restores both the goal amount and the month's leftover.
    const del = await app.request(
      `/households/${HID}/budget/transfers/${ctx.history[0].id}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    expect(del.status).toBe(200);
    const restored = (await del.json()) as TransferContext;
    expect(restored.leftoverCents).toBe(100000);
    const undoneGoal = await raw.select().from(savingsGoals).where(eq(savingsGoals.id, GOAL_ID)).get();
    expect(undoneGoal?.current_amount_cents).toBe(100000);
  });

  it('transfers to a registered account (contribution) and reverses on undo', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    await setJulyBudget(app, token, 100000);
    const raw = drizzle(testEnv.DB);

    const res = await app.request(
      `/households/${HID}/budget/transfers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_year: 2026,
          source_month: 7,
          amount_cents: 25000,
          destination_type: 'registered_account',
          destination_id: ACCT_ID,
        }),
      },
      testEnv
    );
    expect(res.status).toBe(200);
    const ctx = (await res.json()) as TransferContext;

    const afterAcct = await raw
      .select()
      .from(registeredAccounts)
      .where(eq(registeredAccounts.id, ACCT_ID))
      .get();
    expect(afterAcct?.balance_cents).toBe(1225000); // 1200000 + 25000
    const txns = await raw
      .select()
      .from(registeredTransactions)
      .where(eq(registeredTransactions.account_id, ACCT_ID))
      .all();
    expect(txns).toHaveLength(1);
    expect(txns[0].type).toBe('contribution');

    // Undo reverses the balance and removes the contribution row.
    const del = await app.request(
      `/households/${HID}/budget/transfers/${ctx.history[0].id}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    expect(del.status).toBe(200);
    const undoneAcct = await raw
      .select()
      .from(registeredAccounts)
      .where(eq(registeredAccounts.id, ACCT_ID))
      .get();
    expect(undoneAcct?.balance_cents).toBe(1200000);
    const txnsAfter = await raw
      .select()
      .from(registeredTransactions)
      .where(eq(registeredTransactions.account_id, ACCT_ID))
      .all();
    expect(txnsAfter).toHaveLength(0);
  });

  it('returns 403 for a user outside the household', async () => {
    const token = await mintToken(OTHER_UID);
    const app = mkApp();
    const res = await app.request(
      `/households/${HID}/budget/transfers?year=2026&month=7`,
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    expect(res.status).toBe(403);
  });
});
