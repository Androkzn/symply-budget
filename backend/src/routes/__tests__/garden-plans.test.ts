/**
 * garden-plans.ts routes — async-generation control endpoints.
 *
 * Covers:
 *   - POST /:id/cancel on a 'generating' row → flips to 'failed' with
 *     `cancelled_by_user`, marks the source ai_tool_pending row 'failed',
 *     refunds the daily counter.
 *   - POST /:id/cancel on a non-generating row → 409.
 *   - POST /:id/cancel on a row in another household → 404.
 *   - POST /:id/retry on a 'failed' row → resets to 'generating', enqueues
 *     a new queue message with the original prompt, flips ai_tool_pending
 *     back to 'approved', and consumes a daily counter slot.
 *   - POST /:id/retry on a manually-uploaded row (no source_approval_id) → 403.
 *   - POST /:id/retry when the daily cap is exhausted → 429.
 *   - POST /:id/retry rapid second tap (debounce lock active) → 429.
 *   - POST /:id/retry queue.send failure → rolls back plan status, approval
 *     status, and refunds the counter.
 *   - POST /:id/retry cross-household 404.
 */

import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import * as schema from '../../db/schema';
import { aiToolPending } from '../../db/schema-ai-chat';
import { gardenPlans } from '../../db/schema-garden-plans';
import { checkAndIncrementGardenPlanCount, DEFAULT_GARDEN_PLAN_DAILY_CAP } from '../../services/ai/garden-plan-rate-limit';
import {
  createAihousekeeperTables,
  createCoreTables,
  resetAllTables,
} from '../../services/aihousekeeper/__tests__/test-helpers';
import type { Env, GardenPlanGenerationMessage } from '../../types';
import gardenPlansRouter from '../garden-plans';

const testEnv = env as unknown as Env;

const HID = 'hh_gp_routes_01';
const UID = 'u_gp_routes_owner';
const MID = 'm_gp_routes_owner';

const OTHER_HID = 'hh_gp_routes_other';
const OTHER_UID = 'u_gp_routes_outsider';
const OTHER_MID = 'm_gp_routes_outsider';

function counterKey(householdId: string): string {
  return `garden_plan_count:${householdId}:${new Date().toISOString().slice(0, 10)}`;
}

function retryLockKey(gardenPlanId: string): string {
  return `garden_plan_retry_lock:${gardenPlanId}`;
}

/**
 * KV is process-wide in the test environment and survives `resetAllTables`,
 * so explicitly clear the per-household counter and any per-row retry locks
 * the suite touches. Otherwise tests bleed state into each other (e.g. a
 * counter consumed by the previous test still being there when the next
 * test asserts a fresh starting point).
 */
async function clearKvForSuite(): Promise<void> {
  await testEnv.CONFIG_KV.delete(counterKey(HID));
  await testEnv.CONFIG_KV.delete(counterKey(OTHER_HID));
  for (const id of [
    'gp-cancel-1',
    'gp-cancel-2',
    'gp-cancel-other',
    'gp-retry-1',
    'gp-retry-3',
    'gp-retry-4',
    'gp-retry-cap',
    'gp-retry-debounce',
    'gp-retry-rollback',
    'gp-retry-other',
  ]) {
    await testEnv.CONFIG_KV.delete(retryLockKey(id));
  }
}

async function mintToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(
    testEnv.JWT_SECRET || 'test-jwt-secret-32-chars-minimum'
  );
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

function mkApp(envOverride: Env = testEnv) {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/households/:householdId/garden-plans', gardenPlansRouter);
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
        {
          error: {
            code: apiError.code,
            message: apiError.message,
            details: apiError.details,
          },
        },
        apiError.statusCode as 400 | 401 | 403 | 404 | 409 | 429 | 500
      );
    }
    return c.json({ error: { code: 'internal_error', message: error.message } }, 500);
  });
  // Bind into the request env override
  void envOverride;
  return app;
}

interface SeedOpts {
  approvalId: string;
  gardenPlanId: string;
  /** override starting status; default 'generating'. */
  planStatus?: 'generating' | 'failed' | 'completed' | 'pending_upload' | 'uploaded';
  /** override approval status; default 'approved'. */
  approvalStatus?: 'approved' | 'failed' | 'pending';
  /** include source_approval_id on the plan row? Default true. */
  withApprovalLink?: boolean;
  /** plant the row in a different household than the auth'd user. Used for cross-household isolation tests. */
  ownerHouseholdId?: string;
  ownerUserId?: string;
  /** also seed a second household (with this user as the only member) for cross-household tests. */
  alsoSeedOtherHousehold?: boolean;
}

async function seed(opts: SeedOpts): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createAihousekeeperTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await clearKvForSuite();

  const db = drizzle(testEnv.DB, { schema });
  const userRows: { id: string; email: string; email_verified: boolean }[] = [
    { id: UID, email: 'gp-routes@example.com', email_verified: true },
  ];
  if (opts.alsoSeedOtherHousehold) {
    userRows.push({ id: OTHER_UID, email: 'gp-outsider@example.com', email_verified: true });
  }
  await db.insert(schema.users).values(userRows);
  await db.insert(schema.households).values({ id: HID, name: 'GPRoutesTest' });
  await db.insert(schema.householdMembers).values({
    id: MID,
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: '2025-01-01T00:00:00Z',
  });
  if (opts.alsoSeedOtherHousehold) {
    await db.insert(schema.households).values({ id: OTHER_HID, name: 'GPRoutesOther' });
    await db.insert(schema.householdMembers).values({
      id: OTHER_MID,
      household_id: OTHER_HID,
      user_id: OTHER_UID,
      role: 'owner',
      joined_at: '2025-01-01T00:00:00Z',
    });
  }

  const ownerHid = opts.ownerHouseholdId ?? HID;
  const ownerUid = opts.ownerUserId ?? UID;

  const ts = '2026-04-27T00:00:00.000Z';
  await db.insert(aiToolPending).values({
    id: opts.approvalId,
    household_id: ownerHid,
    user_id: ownerUid,
    tool_name: 'create_garden_site_plan',
    input_json: JSON.stringify({
      plan_type: 'back_yard',
      area_label: 'Back yard',
      diagram_prompt: 'Top-down back yard with deck on north, lawn in centre, beds along east and west.',
    }),
    idempotency_key: `gen-${opts.approvalId}`,
    status: opts.approvalStatus ?? 'approved',
    approved_at: ts,
    approved_by: ownerUid,
    expires_at: '2026-04-30T00:00:00.000Z',
    created_at: ts,
    updated_at: ts,
  });

  await db.insert(gardenPlans).values({
    id: opts.gardenPlanId,
    household_id: ownerHid,
    plan_type: 'back_yard',
    filename: 'garden-site-plan.png',
    file_size: 0,
    content_type: 'image/png',
    original_file_key: `garden-plans/${ownerHid}/${opts.gardenPlanId}/garden-site-plan.png`,
    display_image_key: null,
    thumbnail_key: null,
    label: 'Back yard',
    width_px: 1792,
    height_px: 1024,
    status: opts.planStatus ?? 'generating',
    error_message: opts.planStatus === 'failed' ? 'openai_image_failed' : null,
    source_approval_id: opts.withApprovalLink === false ? null : opts.approvalId,
    created_by: ownerUid,
    created_at: ts,
    updated_at: ts,
  });
}

function envWithQueueSpy() {
  const send = vi.fn(async (_msg: GardenPlanGenerationMessage) => undefined);
  const overridden = {
    ...testEnv,
    GARDEN_PLAN_QUEUE: { send } as unknown as Env['GARDEN_PLAN_QUEUE'],
  } as Env;
  return { env: overridden, send };
}

describe('POST /garden-plans/:id/cancel', () => {
  beforeEach(async () => {
    await createCoreTables(testEnv.DB);
    await createAihousekeeperTables(testEnv.DB);
    await resetAllTables(testEnv.DB);
    await clearKvForSuite();
  });

  it('flips a generating plan to failed, marks approval failed, refunds counter', async () => {
    await seed({ approvalId: 'p-cancel-1', gardenPlanId: 'gp-cancel-1' });
    await checkAndIncrementGardenPlanCount(testEnv, HID, DEFAULT_GARDEN_PLAN_DAILY_CAP);
    const today = new Date().toISOString().slice(0, 10);
    expect(await testEnv.CONFIG_KV.get(`garden_plan_count:${HID}:${today}`)).toBe('1');

    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(
      `/households/${HID}/garden-plans/gp-cancel-1/cancel`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { garden_plan: { status: string; error_message: string | null } };
    expect(body.garden_plan.status).toBe('failed');
    expect(body.garden_plan.error_message).toBe('cancelled_by_user');

    const db = drizzle(testEnv.DB, { schema });
    const approval = await db
      .select()
      .from(aiToolPending)
      .where(eq(aiToolPending.id, 'p-cancel-1'))
      .get();
    expect(approval?.status).toBe('failed');
    expect(approval?.execution_error).toBe('cancelled_by_user');

    expect(await testEnv.CONFIG_KV.get(`garden_plan_count:${HID}:${today}`)).toBe('0');
  });

  it('returns 409 when the row is not in generating state', async () => {
    await seed({
      approvalId: 'p-cancel-2',
      gardenPlanId: 'gp-cancel-2',
      planStatus: 'completed',
    });

    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(
      `/households/${HID}/garden-plans/gp-cancel-2/cancel`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    expect(res.status).toBe(409);
  });
});

describe('POST /garden-plans/:id/retry', () => {
  beforeEach(async () => {
    await createCoreTables(testEnv.DB);
    await createAihousekeeperTables(testEnv.DB);
    await resetAllTables(testEnv.DB);
    await clearKvForSuite();
  });

  it('on a failed row: resets to generating, enqueues with original prompt, resets approval', async () => {
    await seed({
      approvalId: 'p-retry-1',
      gardenPlanId: 'gp-retry-1',
      planStatus: 'failed',
      approvalStatus: 'failed',
    });

    const { env: overrideEnv, send } = envWithQueueSpy();
    const token = await mintToken(UID);
    const app = mkApp(overrideEnv);
    const res = await app.request(
      `/households/${HID}/garden-plans/gp-retry-1/retry`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      overrideEnv
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { garden_plan: { status: string; error_message: string | null } };
    expect(body.garden_plan.status).toBe('generating');
    expect(body.garden_plan.error_message).toBeNull();

    expect(send).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls[0][0];
    expect(sent.gardenPlanId).toBe('gp-retry-1');
    expect(sent.approvalId).toBe('p-retry-1');
    expect(sent.diagramPrompt).toContain('Top-down back yard');
    expect(sent.planType).toBe('back_yard');

    const db = drizzle(testEnv.DB, { schema });
    const approval = await db
      .select()
      .from(aiToolPending)
      .where(eq(aiToolPending.id, 'p-retry-1'))
      .get();
    expect(approval?.status).toBe('approved');
    expect(approval?.execution_error).toBeNull();
  });

  it('returns 403 on a manually-uploaded plan (no source_approval_id)', async () => {
    await seed({
      approvalId: 'p-retry-3',
      gardenPlanId: 'gp-retry-3',
      planStatus: 'failed',
      approvalStatus: 'failed',
      withApprovalLink: false,
    });

    const { env: overrideEnv, send } = envWithQueueSpy();
    const token = await mintToken(UID);
    const app = mkApp(overrideEnv);
    const res = await app.request(
      `/households/${HID}/garden-plans/gp-retry-3/retry`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      overrideEnv
    );
    expect(res.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it('returns 409 on a completed plan', async () => {
    await seed({
      approvalId: 'p-retry-4',
      gardenPlanId: 'gp-retry-4',
      planStatus: 'completed',
      approvalStatus: 'approved',
    });

    const { env: overrideEnv, send } = envWithQueueSpy();
    const token = await mintToken(UID);
    const app = mkApp(overrideEnv);
    const res = await app.request(
      `/households/${HID}/garden-plans/gp-retry-4/retry`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      overrideEnv
    );
    expect(res.status).toBe(409);
    expect(send).not.toHaveBeenCalled();
  });

  it('consumes a daily counter slot when retrying a failed row', async () => {
    await seed({
      approvalId: 'p-retry-1',
      gardenPlanId: 'gp-retry-1',
      planStatus: 'failed',
      approvalStatus: 'failed',
    });
    expect(await testEnv.CONFIG_KV.get(counterKey(HID))).toBeNull();

    const { env: overrideEnv } = envWithQueueSpy();
    const token = await mintToken(UID);
    const app = mkApp(overrideEnv);
    const res = await app.request(
      `/households/${HID}/garden-plans/gp-retry-1/retry`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      overrideEnv
    );
    expect(res.status).toBe(200);
    expect(await testEnv.CONFIG_KV.get(counterKey(HID))).toBe('1');
  });

  it('returns 429 when the daily cap is exhausted', async () => {
    await seed({
      approvalId: 'p-retry-cap',
      gardenPlanId: 'gp-retry-cap',
      planStatus: 'failed',
      approvalStatus: 'failed',
    });
    // Pre-fill the counter to the cap.
    for (let i = 0; i < DEFAULT_GARDEN_PLAN_DAILY_CAP; i += 1) {
      await checkAndIncrementGardenPlanCount(testEnv, HID, DEFAULT_GARDEN_PLAN_DAILY_CAP);
    }
    expect(await testEnv.CONFIG_KV.get(counterKey(HID))).toBe(
      String(DEFAULT_GARDEN_PLAN_DAILY_CAP)
    );

    const { env: overrideEnv, send } = envWithQueueSpy();
    const token = await mintToken(UID);
    const app = mkApp(overrideEnv);
    const res = await app.request(
      `/households/${HID}/garden-plans/gp-retry-cap/retry`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      overrideEnv
    );
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('garden_plan_rate_limited');
    expect(send).not.toHaveBeenCalled();
    // Counter should not have been bumped past the cap by the rejected call.
    expect(await testEnv.CONFIG_KV.get(counterKey(HID))).toBe(
      String(DEFAULT_GARDEN_PLAN_DAILY_CAP)
    );
  });

  it('debounces a rapid second tap with 429 (lock held)', async () => {
    await seed({
      approvalId: 'p-retry-debounce',
      gardenPlanId: 'gp-retry-debounce',
      planStatus: 'failed',
      approvalStatus: 'failed',
    });

    const { env: overrideEnv, send } = envWithQueueSpy();
    const token = await mintToken(UID);
    const app = mkApp(overrideEnv);

    const first = await app.request(
      `/households/${HID}/garden-plans/gp-retry-debounce/retry`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      overrideEnv
    );
    expect(first.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);

    // Second tap within the debounce window — the gardenPlan is now
    // 'generating' so the regular status check would let it through, but
    // the per-row lock must reject it.
    const second = await app.request(
      `/households/${HID}/garden-plans/gp-retry-debounce/retry`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      overrideEnv
    );
    expect(second.status).toBe(429);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe('retry_in_progress');
    expect(send).toHaveBeenCalledTimes(1);
    // Counter only consumed once.
    expect(await testEnv.CONFIG_KV.get(counterKey(HID))).toBe('1');
  });

  it('rolls back plan, approval, and counter when queue.send throws', async () => {
    await seed({
      approvalId: 'p-retry-rollback',
      gardenPlanId: 'gp-retry-rollback',
      planStatus: 'failed',
      approvalStatus: 'failed',
    });

    const send = vi.fn(async () => {
      throw new Error('queue_unavailable');
    });
    const overrideEnv = {
      ...testEnv,
      GARDEN_PLAN_QUEUE: { send } as unknown as Env['GARDEN_PLAN_QUEUE'],
    } as Env;
    const token = await mintToken(UID);
    const app = mkApp(overrideEnv);

    const res = await app.request(
      `/households/${HID}/garden-plans/gp-retry-rollback/retry`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      overrideEnv
    );
    // The router rethrows queue errors and the global error handler turns
    // unknown errors into a 500.
    expect(res.status).toBe(500);

    const db = drizzle(testEnv.DB, { schema });
    const plan = await db
      .select()
      .from(gardenPlans)
      .where(eq(gardenPlans.id, 'gp-retry-rollback'))
      .get();
    expect(plan?.status).toBe('failed');
    expect(plan?.error_message).toContain('garden_plan_enqueue_failed');

    const approval = await db
      .select()
      .from(aiToolPending)
      .where(eq(aiToolPending.id, 'p-retry-rollback'))
      .get();
    expect(approval?.status).toBe('failed');
    expect(approval?.execution_error).toContain('garden_plan_enqueue_failed');

    // Counter must be refunded back to zero — the user shouldn't lose a
    // slot for an enqueue that never reached the queue.
    expect(await testEnv.CONFIG_KV.get(counterKey(HID))).toBe('0');
    // Lock must be released so the user can immediately retry.
    expect(await testEnv.CONFIG_KV.get(retryLockKey('gp-retry-rollback'))).toBeNull();
  });

  it('returns 404 when the plan belongs to a different household', async () => {
    // Seed a plan owned by OTHER_HID, then call /retry while authenticated
    // as UID (a member of HID, not OTHER_HID). The router should never
    // resolve the plan from a household-scoped lookup.
    await seed({
      approvalId: 'p-retry-other',
      gardenPlanId: 'gp-retry-other',
      planStatus: 'failed',
      approvalStatus: 'failed',
      ownerHouseholdId: OTHER_HID,
      ownerUserId: OTHER_UID,
      alsoSeedOtherHousehold: true,
    });

    const { env: overrideEnv, send } = envWithQueueSpy();
    const token = await mintToken(UID);
    const app = mkApp(overrideEnv);
    // UID hits the route under their own household — the cross-household
    // plan id must 404 (not leak via a global id lookup).
    const res = await app.request(
      `/households/${HID}/garden-plans/gp-retry-other/retry`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      overrideEnv
    );
    expect(res.status).toBe(404);
    expect(send).not.toHaveBeenCalled();
    // No counter consumption on a 404.
    expect(await testEnv.CONFIG_KV.get(counterKey(HID))).toBeNull();
  });
});

describe('POST /garden-plans/:id/cancel — cross-household isolation', () => {
  beforeEach(async () => {
    await createCoreTables(testEnv.DB);
    await createAihousekeeperTables(testEnv.DB);
    await resetAllTables(testEnv.DB);
    await clearKvForSuite();
  });

  it('returns 404 when the plan belongs to a different household', async () => {
    await seed({
      approvalId: 'p-cancel-other',
      gardenPlanId: 'gp-cancel-other',
      planStatus: 'generating',
      approvalStatus: 'approved',
      ownerHouseholdId: OTHER_HID,
      ownerUserId: OTHER_UID,
      alsoSeedOtherHousehold: true,
    });

    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(
      `/households/${HID}/garden-plans/gp-cancel-other/cancel`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    expect(res.status).toBe(404);

    // The OTHER_HID plan must remain untouched (still 'generating').
    const db = drizzle(testEnv.DB, { schema });
    const plan = await db
      .select()
      .from(gardenPlans)
      .where(eq(gardenPlans.id, 'gp-cancel-other'))
      .get();
    expect(plan?.status).toBe('generating');
  });
});
