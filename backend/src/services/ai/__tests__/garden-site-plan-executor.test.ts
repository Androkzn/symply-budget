/**
 * approval-executor.ts → executeCreateGardenSitePlan branch.
 *
 * After the move to async generation (Cloudflare Queue), the executor's job
 * is now to: pre-flight validate → insert a `garden_plans` row in
 * status='generating' → enqueue a message → return immediately. The actual
 * OpenAI call + R2 + completion happens in `garden-plan-job-handler.ts`
 * (covered by `garden-plan-job-handler.test.ts`).
 *
 * Validates:
 *   - Happy path: pre-flight passes → row inserted as 'generating' → queue
 *     send called once → outcome is `{ ok:true, queued:true }`. Crucially,
 *     OpenAI fetch is NEVER called from the executor.
 *   - Invalid plan_type is refused before any DB / queue work.
 *   - Missing diagram_prompt is refused.
 */

import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import * as schema from '../../../db/schema';
import { gardenPlans } from '../../../db/schema-garden-plans';
import type { Env, GardenPlanGenerationMessage } from '../../../types';
import {
  createAihousekeeperTables,
  createCoreTables,
  resetAllTables,
} from '../../aihousekeeper/__tests__/test-helpers';
import { executeApproved } from '../approval-executor';

const testEnv = env as unknown as Env;
const HID = 'hh_garden_01';
const OWNER_UID = 'u_garden_owner';
const OWNER_MEMBER = 'm_garden_owner';

async function seed(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createAihousekeeperTables(testEnv.DB);
  await resetAllTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db
    .insert(schema.users)
    .values([{ id: OWNER_UID, email: 'owner-garden@example.com', email_verified: true }]);
  await db.insert(schema.households).values({ id: HID, name: 'GardenTest' });
  await db.insert(schema.householdMembers).values({
    id: OWNER_MEMBER,
    household_id: HID,
    user_id: OWNER_UID,
    role: 'owner',
    joined_at: '2025-01-01T00:00:00Z',
  });

  await testEnv.CONFIG_KV.put('aihousekeeper_enabled', 'true');
  const today = new Date().toISOString().slice(0, 10);
  await testEnv.CONFIG_KV.delete(`garden_plan_count:${HID}:${today}`);
}

afterEach(() => {
  vi.restoreAllMocks();
});

function envWithQueueSpy() {
  const send = vi.fn(async (_msg: GardenPlanGenerationMessage) => undefined);
  const overridden = {
    ...testEnv,
    GARDEN_PLAN_QUEUE: { send } as unknown as Env['GARDEN_PLAN_QUEUE'],
  } as Env;
  return { env: overridden, send };
}

describe('executeApproved → create_garden_site_plan (async)', () => {
  beforeEach(async () => {
    await seed();
    (testEnv as { OPENAI_API_KEY?: string }).OPENAI_API_KEY = 'sk-test-fake';
  });

  it('happy path: enqueues a job and inserts a generating row without calling OpenAI', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const { env: overrideEnv, send } = envWithQueueSpy();

    const outcome = await executeApproved(
      {
        id: 'p-garden-01',
        household_id: HID,
        user_id: OWNER_UID,
        tool_name: 'create_garden_site_plan',
        input_json: JSON.stringify({
          plan_type: 'back_yard',
          area_label: 'Back yard',
          diagram_prompt:
            'Top-down back yard with deck on north side, lawn in center, flower beds along the fence on east and west, two apple trees at the south, gravel path leading from house to shed.',
        }),
      },
      overrideEnv
    );

    // The executor must NOT touch OpenAI — that's the queue handler's job.
    expect(fetchMock).not.toHaveBeenCalled();

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.queued).toBe(true);

    const result = outcome.result as { garden_plan_id: string; queued: boolean };
    expect(result.queued).toBe(true);

    expect(send).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls[0][0];
    expect(sent.gardenPlanId).toBe(result.garden_plan_id);
    expect(sent.householdId).toBe(HID);
    expect(sent.userId).toBe(OWNER_UID);
    expect(sent.planType).toBe('back_yard');
    expect(sent.diagramPrompt.length).toBeGreaterThan(20);
    expect(sent.approvalId).toBe('p-garden-01');

    const db = drizzle(testEnv.DB, { schema });
    const row = await db
      .select()
      .from(gardenPlans)
      .where(eq(gardenPlans.id, result.garden_plan_id))
      .get();
    expect(row).toBeTruthy();
    expect(row?.status).toBe('generating');
    expect(row?.plan_type).toBe('back_yard');
    expect(row?.label).toBe('Back yard');

    const today = new Date().toISOString().slice(0, 10);
    expect(await testEnv.CONFIG_KV.get(`garden_plan_count:${HID}:${today}`)).toBe('1');
  });

  it('refuses an invalid plan_type without inserting a row or enqueuing', async () => {
    const { env: overrideEnv, send } = envWithQueueSpy();

    const outcome = await executeApproved(
      {
        id: 'p-garden-bad-type',
        household_id: HID,
        user_id: OWNER_UID,
        tool_name: 'create_garden_site_plan',
        input_json: JSON.stringify({
          plan_type: 'interior',
          area_label: 'Sneaky',
          diagram_prompt:
            'A really long enough indoor floor plan that should be refused by the executor.',
        }),
      },
      overrideEnv
    );

    expect(send).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toBe('invalid_plan_type');

    const today = new Date().toISOString().slice(0, 10);
    expect(await testEnv.CONFIG_KV.get(`garden_plan_count:${HID}:${today}`)).toBeNull();
  });

  it('refuses missing diagram_prompt without inserting a row or enqueuing', async () => {
    const { env: overrideEnv, send } = envWithQueueSpy();

    const outcome = await executeApproved(
      {
        id: 'p-garden-no-prompt',
        household_id: HID,
        user_id: OWNER_UID,
        tool_name: 'create_garden_site_plan',
        input_json: JSON.stringify({
          plan_type: 'garden',
          area_label: 'Garden',
          diagram_prompt: '   ',
        }),
      },
      overrideEnv
    );

    expect(send).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toBe('missing_diagram_prompt');

    const today = new Date().toISOString().slice(0, 10);
    expect(await testEnv.CONFIG_KV.get(`garden_plan_count:${HID}:${today}`)).toBeNull();
  });
});
