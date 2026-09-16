import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '../../../db/schema';
import { gardenPlans } from '../../../db/schema-garden-plans';
import type { Env, GardenPlanGenerationMessage } from '../../../types';
import {
  createAihousekeeperTables,
  createCoreTables,
  resetAllTables,
} from '../../aihousekeeper/__tests__/test-helpers';
import { enqueueGardenPlanGeneration } from '../garden-plan-generation-service';

const testEnv = env as unknown as Env;
const HID = 'hh_boundary_generation';
const UID = 'u_boundary_generation';
const MID = 'm_boundary_generation';

async function seedHousehold(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createAihousekeeperTables(testEnv.DB);
  await resetAllTables(testEnv.DB);

  const today = new Date().toISOString().slice(0, 10);
  await testEnv.CONFIG_KV.delete(`garden_plan_count:${HID}:${today}`);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values({
    id: UID,
    email: 'boundary-generation@example.com',
    email_verified: true,
  });
  await db.insert(schema.households).values({ id: HID, name: 'Boundary House' });
  await db.insert(schema.householdMembers).values({
    id: MID,
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: new Date().toISOString(),
  });
}

describe('enqueueGardenPlanGeneration', () => {
  beforeEach(async () => {
    await seedHousehold();
  });

  it('persists confirmed boundary metadata and queues the same reference image', async () => {
    const send = vi.fn<(body: GardenPlanGenerationMessage) => Promise<void>>().mockResolvedValue();
    const envWithQueue = {
      ...testEnv,
      GARDEN_PLAN_QUEUE: { send },
    } as unknown as Env;

    const boundaryGeojson = JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [-122.1, 37.1],
          [-122.0, 37.1],
          [-122.0, 37.2],
          [-122.1, 37.2],
          [-122.1, 37.1],
        ],
      ],
    });

    const result = await enqueueGardenPlanGeneration(envWithQueue, {
      householdId: HID,
      userId: UID,
      diagramPrompt: 'Use the confirmed property boundary and show a patio plus planting beds.',
      planType: 'back_yard',
      areaLabel: 'Back yard',
      referenceImageR2Key: 'garden-plans/_boundary-previews/ref.jpg',
      referenceImageSource: 'confirmed_boundary',
      boundaryDraftId: 'draft_123',
      boundarySource: 'user_drawn',
      boundaryGeojson,
      geocodePlaceName: '8135 Test St',
    });

    const db = drizzle(testEnv.DB, { schema });
    const row = await db
      .select()
      .from(gardenPlans)
      .where(eq(gardenPlans.id, result.gardenPlanId))
      .get();

    expect(row?.status).toBe('generating');
    expect(row?.boundary_draft_id).toBe('draft_123');
    expect(row?.boundary_source).toBe('user_drawn');
    expect(row?.boundary_geojson).toBe(boundaryGeojson);
    expect(row?.reference_image_source).toBe('confirmed_boundary');
    expect(row?.generation_prompt).toContain('confirmed property boundary');

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({
      gardenPlanId: result.gardenPlanId,
      boundaryDraftId: 'draft_123',
      referenceImageR2Key: 'garden-plans/_boundary-previews/ref.jpg',
      referenceImageSource: 'confirmed_boundary',
    });
  });
});

