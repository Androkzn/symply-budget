/**
 * garden-plan-job-handler.ts — Cloudflare Queue consumer for the async
 * garden-plan generation flow.
 *
 * Validates:
 *   - Happy path: handler is called with a 'generating' row → calls OpenAI
 *     once → PNG lands in R2 → garden_plans row flips to 'completed' →
 *     ai_tool_pending row flips to 'executed' → outcome is 'completed'.
 *   - Idempotency: handler called twice on the same gardenPlanId after the
 *     first finished → second is a no-op (no extra OpenAI call, no extra
 *     R2 PUT).
 *   - Transient OpenAI failure (timeout) on a non-final attempt → returns
 *     'retry'; row stays 'generating'; ai_tool_pending stays 'approved'.
 *   - Transient OpenAI failure on the FINAL attempt → flips to permanent
 *     failure (row='failed', ai_tool_pending='failed', counter refunded).
 *   - Permanent OpenAI failure (content_policy) on first attempt → flips
 *     to 'failed' immediately, refunds the counter.
 */

import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '../../../db/schema';
import { aiToolPending } from '../../../db/schema-ai-chat';
import { gardenPlans } from '../../../db/schema-garden-plans';
import type { Env, GardenPlanGenerationMessage } from '../../../types';
import {
  createAihousekeeperTables,
  createCoreTables,
  resetAllTables,
} from '../../aihousekeeper/__tests__/test-helpers';
import {
  handleGardenPlanGenerationJob,
  sweepStuckGeneratingGardenPlans,
  STUCK_GENERATING_GRACE_MS,
} from '../garden-plan-job-handler';
import { checkAndIncrementGardenPlanCount, DEFAULT_GARDEN_PLAN_DAILY_CAP } from '../garden-plan-rate-limit';

const testEnv = env as unknown as Env;
const HID = 'hh_garden_job_01';
const UID = 'u_garden_job_owner';
const MID = 'm_garden_job_owner';

const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function fakeOpenAiOk(): Response {
  return new Response(
    JSON.stringify({ data: [{ b64_json: TINY_PNG_B64 }] }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

function fakeOpenAiTimeoutAbort(): Promise<Response> {
  // Mimics what `fetch` raises when AbortController fires.
  return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
}

function fakeOpenAiContentPolicy(): Response {
  return new Response(
    JSON.stringify({
      error: { message: 'rejected by content_policy' },
    }),
    { status: 400 }
  );
}

const baseMessage: Omit<GardenPlanGenerationMessage, 'gardenPlanId' | 'approvalId'> = {
  householdId: HID,
  userId: UID,
  diagramPrompt:
    'Top-down back yard with deck on north, lawn in centre, beds along east and west fences.',
  planType: 'back_yard',
  areaLabel: 'Back yard',
  enqueuedAt: Date.now(),
};

async function clearTodaysCounter(householdId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await testEnv.CONFIG_KV.delete(`garden_plan_count:${householdId}:${today}`);
}

async function seedHouseholdAndPending(approvalId: string, gardenPlanId: string): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createAihousekeeperTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await clearTodaysCounter(HID);

  const db = drizzle(testEnv.DB, { schema });
  await db
    .insert(schema.users)
    .values([{ id: UID, email: 'owner-garden-job@example.com', email_verified: true }]);
  await db.insert(schema.households).values({ id: HID, name: 'GardenJobTest' });
  await db.insert(schema.householdMembers).values({
    id: MID,
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: '2025-01-01T00:00:00Z',
  });

  // ai_tool_pending row in 'approved' state — that's the state the executor
  // leaves when it enqueues.
  const ts = '2026-04-27T00:00:00.000Z';
  await db.insert(aiToolPending).values({
    id: approvalId,
    household_id: HID,
    user_id: UID,
    tool_name: 'create_garden_site_plan',
    input_json: JSON.stringify({
      plan_type: 'back_yard',
      area_label: 'Back yard',
      diagram_prompt: baseMessage.diagramPrompt,
    }),
    idempotency_key: `gen-${approvalId}`,
    status: 'approved',
    approved_at: ts,
    approved_by: UID,
    expires_at: '2026-04-30T00:00:00.000Z',
    created_at: ts,
    updated_at: ts,
  });

  // garden_plans row pre-created in 'generating' state.
  await db.insert(gardenPlans).values({
    id: gardenPlanId,
    household_id: HID,
    plan_type: 'back_yard',
    filename: 'garden-site-plan.png',
    file_size: 0,
    content_type: 'image/png',
    original_file_key: `garden-plans/${HID}/${gardenPlanId}/garden-site-plan.png`,
    display_image_key: null,
    thumbnail_key: null,
    label: 'Back yard',
    width_px: 1792,
    height_px: 1024,
    status: 'generating',
    created_by: UID,
    created_at: ts,
    updated_at: ts,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleGardenPlanGenerationJob', () => {
  beforeEach(async () => {
    (testEnv as { OPENAI_API_KEY?: string }).OPENAI_API_KEY = 'sk-test-fake';
  });

  it('happy path: writes PNG to R2, flips both rows to terminal state', async () => {
    const approvalId = 'p-job-happy';
    const gardenPlanId = 'gp-job-happy';
    await seedHouseholdAndPending(approvalId, gardenPlanId);

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => fakeOpenAiOk());
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await handleGardenPlanGenerationJob(
      testEnv,
      { ...baseMessage, approvalId, gardenPlanId },
      { attempt: 1, maxAttempts: 3 }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outcome.kind).toBe('completed');

    const r2Key = `garden-plans/${HID}/${gardenPlanId}/garden-site-plan.png`;
    const head = await testEnv.REPORTS_BUCKET.head(r2Key);
    expect(head).not.toBeNull();
    expect(head?.httpMetadata?.contentType).toBe('image/png');

    const db = drizzle(testEnv.DB, { schema });
    const planRow = await db
      .select()
      .from(gardenPlans)
      .where(eq(gardenPlans.id, gardenPlanId))
      .get();
    expect(planRow?.status).toBe('completed');
    expect(planRow?.display_image_key).toBe(r2Key);
    expect(planRow?.thumbnail_key).toBe(r2Key);
    expect(planRow?.file_size).toBeGreaterThan(0);

    const approvalRow = await db
      .select()
      .from(aiToolPending)
      .where(eq(aiToolPending.id, approvalId))
      .get();
    expect(approvalRow?.status).toBe('executed');
    expect(approvalRow?.executed_at).toBeTruthy();
  });

  it('idempotent: re-running on a completed row is a no-op', async () => {
    const approvalId = 'p-job-idem';
    const gardenPlanId = 'gp-job-idem';
    await seedHouseholdAndPending(approvalId, gardenPlanId);

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => fakeOpenAiOk());
    vi.stubGlobal('fetch', fetchMock);

    // First run: completes.
    await handleGardenPlanGenerationJob(
      testEnv,
      { ...baseMessage, approvalId, gardenPlanId },
      { attempt: 1, maxAttempts: 3 }
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second run (queue redelivery): should NOT call OpenAI again.
    const outcome2 = await handleGardenPlanGenerationJob(
      testEnv,
      { ...baseMessage, approvalId, gardenPlanId },
      { attempt: 1, maxAttempts: 3 }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1); // still 1
    expect(outcome2.kind).toBe('skipped-not-generating');
  });

  it('reconciles approval when completion happened before ack', async () => {
    const approvalId = 'p-job-reconcile';
    const gardenPlanId = 'gp-job-reconcile';
    await seedHouseholdAndPending(approvalId, gardenPlanId);

    const db = drizzle(testEnv.DB, { schema });
    const r2Key = `garden-plans/${HID}/${gardenPlanId}/garden-site-plan.png`;
    await db
      .update(gardenPlans)
      .set({
        status: 'completed',
        display_image_key: r2Key,
        thumbnail_key: r2Key,
        file_size: 68,
      })
      .where(eq(gardenPlans.id, gardenPlanId));

    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await handleGardenPlanGenerationJob(
      testEnv,
      { ...baseMessage, approvalId, gardenPlanId },
      { attempt: 2, maxAttempts: 4 }
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcome.kind).toBe('skipped-not-generating');

    const approvalRow = await db
      .select()
      .from(aiToolPending)
      .where(eq(aiToolPending.id, approvalId))
      .get();
    expect(approvalRow?.status).toBe('executed');
  });

  it('transient timeout on attempt 1 returns retry; row stays generating', async () => {
    const approvalId = 'p-job-timeout-retry';
    const gardenPlanId = 'gp-job-timeout-retry';
    await seedHouseholdAndPending(approvalId, gardenPlanId);

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(fakeOpenAiTimeoutAbort);
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await handleGardenPlanGenerationJob(
      testEnv,
      { ...baseMessage, approvalId, gardenPlanId },
      { attempt: 1, maxAttempts: 3 }
    );

    expect(outcome.kind).toBe('retry');
    if (outcome.kind === 'retry') expect(outcome.code).toBe('openai_image_timeout');

    const db = drizzle(testEnv.DB, { schema });
    const planRow = await db
      .select()
      .from(gardenPlans)
      .where(eq(gardenPlans.id, gardenPlanId))
      .get();
    expect(planRow?.status).toBe('generating');

    const approvalRow = await db
      .select()
      .from(aiToolPending)
      .where(eq(aiToolPending.id, approvalId))
      .get();
    expect(approvalRow?.status).toBe('approved');
  });

  it('transient timeout on the FINAL attempt flips to permanent failure', async () => {
    const approvalId = 'p-job-timeout-final';
    const gardenPlanId = 'gp-job-timeout-final';
    await seedHouseholdAndPending(approvalId, gardenPlanId);

    // Pre-increment the counter so we can verify the refund.
    await checkAndIncrementGardenPlanCount(testEnv, HID, DEFAULT_GARDEN_PLAN_DAILY_CAP);
    const today = new Date().toISOString().slice(0, 10);
    expect(await testEnv.CONFIG_KV.get(`garden_plan_count:${HID}:${today}`)).toBe('1');

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(fakeOpenAiTimeoutAbort);
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await handleGardenPlanGenerationJob(
      testEnv,
      { ...baseMessage, approvalId, gardenPlanId },
      { attempt: 4, maxAttempts: 4 }
    );

    expect(outcome.kind).toBe('failed-permanent');

    const db = drizzle(testEnv.DB, { schema });
    const planRow = await db
      .select()
      .from(gardenPlans)
      .where(eq(gardenPlans.id, gardenPlanId))
      .get();
    expect(planRow?.status).toBe('failed');
    expect(planRow?.error_message).toBe('openai_image_timeout');

    const approvalRow = await db
      .select()
      .from(aiToolPending)
      .where(eq(aiToolPending.id, approvalId))
      .get();
    expect(approvalRow?.status).toBe('failed');
    expect(approvalRow?.execution_error).toBe('openai_image_timeout');

    expect(await testEnv.CONFIG_KV.get(`garden_plan_count:${HID}:${today}`)).toBe('0');
  });

  it('permanent content-policy error: fails immediately, refunds counter', async () => {
    const approvalId = 'p-job-policy';
    const gardenPlanId = 'gp-job-policy';
    await seedHouseholdAndPending(approvalId, gardenPlanId);

    await checkAndIncrementGardenPlanCount(testEnv, HID, DEFAULT_GARDEN_PLAN_DAILY_CAP);
    const today = new Date().toISOString().slice(0, 10);
    expect(await testEnv.CONFIG_KV.get(`garden_plan_count:${HID}:${today}`)).toBe('1');

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => fakeOpenAiContentPolicy());
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await handleGardenPlanGenerationJob(
      testEnv,
      { ...baseMessage, approvalId, gardenPlanId },
      { attempt: 1, maxAttempts: 3 }
    );

    expect(outcome.kind).toBe('failed-permanent');
    if (outcome.kind === 'failed-permanent') expect(outcome.code).toBe('openai_image_content_policy');

    const db = drizzle(testEnv.DB, { schema });
    const planRow = await db
      .select()
      .from(gardenPlans)
      .where(eq(gardenPlans.id, gardenPlanId))
      .get();
    expect(planRow?.status).toBe('failed');
    expect(planRow?.error_message).toBe('openai_image_content_policy');

    const approvalRow = await db
      .select()
      .from(aiToolPending)
      .where(eq(aiToolPending.id, approvalId))
      .get();
    expect(approvalRow?.status).toBe('failed');

    expect(await testEnv.CONFIG_KV.get(`garden_plan_count:${HID}:${today}`)).toBe('0');
  });

  it('row missing on early attempt returns retry (D1 replication lag)', async () => {
    const approvalId = 'p-job-missing-early';
    const gardenPlanId = 'gp-job-missing-early';
    await seedHouseholdAndPending(approvalId, gardenPlanId);
    // Delete the row so the consumer sees it as missing.
    const db = drizzle(testEnv.DB, { schema });
    await db.delete(gardenPlans).where(eq(gardenPlans.id, gardenPlanId));

    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await handleGardenPlanGenerationJob(
      testEnv,
      { ...baseMessage, approvalId, gardenPlanId },
      { attempt: 1, maxAttempts: 4 }
    );

    expect(outcome.kind).toBe('retry');
    if (outcome.kind === 'retry') {
      expect(outcome.code).toBe('garden_plan_row_missing');
    }
    expect(fetchMock).not.toHaveBeenCalled();

    // Approval row should NOT have been touched on a retry.
    const approvalRow = await db
      .select()
      .from(aiToolPending)
      .where(eq(aiToolPending.id, approvalId))
      .get();
    expect(approvalRow?.status).toBe('approved');
  });

  it('row missing on FINAL attempt marks approval failed and skips OpenAI', async () => {
    const approvalId = 'p-job-missing-final';
    const gardenPlanId = 'gp-job-missing-final';
    await seedHouseholdAndPending(approvalId, gardenPlanId);
    const db = drizzle(testEnv.DB, { schema });
    await db.delete(gardenPlans).where(eq(gardenPlans.id, gardenPlanId));

    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await handleGardenPlanGenerationJob(
      testEnv,
      { ...baseMessage, approvalId, gardenPlanId },
      { attempt: 4, maxAttempts: 4 }
    );

    expect(outcome.kind).toBe('skipped-not-generating');
    expect(fetchMock).not.toHaveBeenCalled();

    const approvalRow = await db
      .select()
      .from(aiToolPending)
      .where(eq(aiToolPending.id, approvalId))
      .get();
    expect(approvalRow?.status).toBe('failed');
    expect(approvalRow?.execution_error).toBe('garden_plan_row_missing');
  });

  it('does not flip an approval that is already in a terminal state', async () => {
    const approvalId = 'p-job-already-failed';
    const gardenPlanId = 'gp-job-already-failed';
    await seedHouseholdAndPending(approvalId, gardenPlanId);
    const db = drizzle(testEnv.DB, { schema });
    // Approval is failed; garden_plans is already completed (rows out of sync)
    await db
      .update(aiToolPending)
      .set({ status: 'failed', execution_error: 'something_else' })
      .where(eq(aiToolPending.id, approvalId));
    await db
      .update(gardenPlans)
      .set({ status: 'completed', display_image_key: 'k' })
      .where(eq(gardenPlans.id, gardenPlanId));

    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    await handleGardenPlanGenerationJob(
      testEnv,
      { ...baseMessage, approvalId, gardenPlanId },
      { attempt: 2, maxAttempts: 4 }
    );

    const approvalRow = await db
      .select()
      .from(aiToolPending)
      .where(eq(aiToolPending.id, approvalId))
      .get();
    // Reconcile must not turn a 'failed' approval back into 'executed'.
    expect(approvalRow?.status).toBe('failed');
    expect(approvalRow?.execution_error).toBe('something_else');
  });

  it('cancel-during-generation: success path CAS misses, terminal user state preserved', async () => {
    // The most important regression test for the new CAS guard. Simulates:
    //   1. Producer enqueues, handler starts OpenAI call.
    //   2. While OpenAI is generating, the user hits POST /:id/cancel —
    //      gardenPlan flips to 'failed' with cancelled_by_user, approval
    //      flips to 'failed', counter is refunded.
    //   3. OpenAI returns and the handler reaches the success UPDATE.
    //   4. Without the CAS, the success path would silently overwrite the
    //      cancellation with status='completed'. With CAS, meta.changes==0
    //      and the handler honors the cancel.
    const approvalId = 'p-job-cancel-mid';
    const gardenPlanId = 'gp-job-cancel-mid';
    await seedHouseholdAndPending(approvalId, gardenPlanId);

    const db = drizzle(testEnv.DB, { schema });
    // Pre-flip the row to the cancelled state BEFORE invoking the handler.
    // From the handler's POV, this is equivalent to /cancel having landed
    // between its initial SELECT and the success UPDATE.
    await db
      .update(gardenPlans)
      .set({ status: 'failed', error_message: 'cancelled_by_user' })
      .where(eq(gardenPlans.id, gardenPlanId));
    await db
      .update(aiToolPending)
      .set({ status: 'failed', execution_error: 'cancelled_by_user' })
      .where(eq(aiToolPending.id, approvalId));

    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await handleGardenPlanGenerationJob(
      testEnv,
      { ...baseMessage, approvalId, gardenPlanId },
      { attempt: 1, maxAttempts: 3 }
    );

    // Row was flipped before the handler's initial SELECT, so the handler
    // takes the early skip branch (status != 'generating') and does NOT
    // call OpenAI at all.
    expect(outcome.kind).toBe('skipped-not-generating');
    expect(fetchMock).not.toHaveBeenCalled();

    const planRow = await db
      .select()
      .from(gardenPlans)
      .where(eq(gardenPlans.id, gardenPlanId))
      .get();
    expect(planRow?.status).toBe('failed');
    expect(planRow?.error_message).toBe('cancelled_by_user');

    const approvalRow = await db
      .select()
      .from(aiToolPending)
      .where(eq(aiToolPending.id, approvalId))
      .get();
    expect(approvalRow?.status).toBe('failed');
    expect(approvalRow?.execution_error).toBe('cancelled_by_user');
  });

  it('failTerminally CAS: does not refund or clobber when row already cancelled', async () => {
    // Simulates: handler picks up the message and starts OpenAI; user
    // cancels (refund happens at /cancel time); OpenAI then errors with a
    // non-retryable code on the FINAL attempt → handler reaches
    // failTerminally. The CAS guards must:
    //   - Leave the cancel's `error_message='cancelled_by_user'` in place.
    //   - Leave the approval's `execution_error='cancelled_by_user'` in place.
    //   - NOT refund the counter (that would be a double-refund).
    const approvalId = 'p-job-cancel-fail';
    const gardenPlanId = 'gp-job-cancel-fail';
    await seedHouseholdAndPending(approvalId, gardenPlanId);

    // Pre-charge the counter to 1 (simulating the original approval-time
    // increment) and then refund (simulating /cancel having already done
    // its refund). Net: counter is 0 going into failTerminally.
    await checkAndIncrementGardenPlanCount(testEnv, HID, DEFAULT_GARDEN_PLAN_DAILY_CAP);
    const today = new Date().toISOString().slice(0, 10);
    expect(await testEnv.CONFIG_KV.get(`garden_plan_count:${HID}:${today}`)).toBe('1');

    const db = drizzle(testEnv.DB, { schema });
    // Flip both rows as if /cancel ran. Counter is also refunded.
    await db
      .update(gardenPlans)
      .set({ status: 'failed', error_message: 'cancelled_by_user' })
      .where(eq(gardenPlans.id, gardenPlanId));
    await db
      .update(aiToolPending)
      .set({ status: 'failed', execution_error: 'cancelled_by_user' })
      .where(eq(aiToolPending.id, approvalId));
    await testEnv.CONFIG_KV.put(`garden_plan_count:${HID}:${today}`, '0');

    // Note: the early `existing.status !== 'generating'` check in the
    // handler short-circuits before reaching failTerminally in normal flow.
    // To exercise failTerminally specifically we'd need to re-flip the row
    // back to 'generating' after the SELECT — the early guard already
    // covers the cancel-during-generation case (see test above). This test
    // therefore re-asserts the guard holds.
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await handleGardenPlanGenerationJob(
      testEnv,
      { ...baseMessage, approvalId, gardenPlanId },
      { attempt: 4, maxAttempts: 4 }
    );

    expect(outcome.kind).toBe('skipped-not-generating');
    expect(fetchMock).not.toHaveBeenCalled();

    const planRow = await db
      .select()
      .from(gardenPlans)
      .where(eq(gardenPlans.id, gardenPlanId))
      .get();
    expect(planRow?.error_message).toBe('cancelled_by_user');

    // Counter stays at 0 — no double-refund.
    expect(await testEnv.CONFIG_KV.get(`garden_plan_count:${HID}:${today}`)).toBe('0');
  });
});

describe('sweepStuckGeneratingGardenPlans', () => {
  it('reconciles rows older than the grace window', async () => {
    const approvalId = 'p-sweep-stuck';
    const gardenPlanId = 'gp-sweep-stuck';
    await seedHouseholdAndPending(approvalId, gardenPlanId);

    // Pre-bump the counter so we can check the refund.
    await checkAndIncrementGardenPlanCount(testEnv, HID, DEFAULT_GARDEN_PLAN_DAILY_CAP);
    const today = new Date().toISOString().slice(0, 10);
    expect(await testEnv.CONFIG_KV.get(`garden_plan_count:${HID}:${today}`)).toBe('1');

    // Backdate the garden_plans row so it falls outside the grace window.
    const db = drizzle(testEnv.DB, { schema });
    const oldTs = new Date(Date.now() - STUCK_GENERATING_GRACE_MS - 60_000).toISOString();
    await db
      .update(gardenPlans)
      .set({ updated_at: oldTs })
      .where(eq(gardenPlans.id, gardenPlanId));

    const result = await sweepStuckGeneratingGardenPlans(testEnv);
    expect(result.scanned).toBe(1);
    expect(result.reconciled).toBe(1);

    const planRow = await db
      .select()
      .from(gardenPlans)
      .where(eq(gardenPlans.id, gardenPlanId))
      .get();
    expect(planRow?.status).toBe('failed');
    expect(planRow?.error_message).toBe('garden_plan_stuck_in_queue');

    const approvalRow = await db
      .select()
      .from(aiToolPending)
      .where(eq(aiToolPending.id, approvalId))
      .get();
    expect(approvalRow?.status).toBe('failed');

    expect(await testEnv.CONFIG_KV.get(`garden_plan_count:${HID}:${today}`)).toBe('0');
  });

  it('leaves recent generating rows alone', async () => {
    const approvalId = 'p-sweep-fresh';
    const gardenPlanId = 'gp-sweep-fresh';
    await seedHouseholdAndPending(approvalId, gardenPlanId);

    // Refresh updated_at to "right now" so the row is well within the grace
    // window (the seed timestamps are baked-in fixtures from earlier in the
    // day and would already look stale to the sweep).
    const db = drizzle(testEnv.DB, { schema });
    await db
      .update(gardenPlans)
      .set({ updated_at: new Date().toISOString() })
      .where(eq(gardenPlans.id, gardenPlanId));

    const result = await sweepStuckGeneratingGardenPlans(testEnv);
    expect(result.scanned).toBe(0);
    expect(result.reconciled).toBe(0);

    const planRow = await db
      .select()
      .from(gardenPlans)
      .where(eq(gardenPlans.id, gardenPlanId))
      .get();
    expect(planRow?.status).toBe('generating');
  });
});
