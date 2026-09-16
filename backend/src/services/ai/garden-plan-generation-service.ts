import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import * as schema from '../../db/schema';
import * as gardenSchema from '../../db/schema-garden-plans';
import { gardenPlans } from '../../db/schema-garden-plans';
import type { Database, Env } from '../../types';
import { generateId, now as nowIso } from '../../utils/id';

import {
  checkAndIncrementGardenPlanCount,
  refundGardenPlanCount,
} from './garden-plan-rate-limit';
import {
  GARDEN_PLAN_IMAGE_HEIGHT,
  GARDEN_PLAN_IMAGE_WIDTH,
} from './garden-site-plan-image-service';
import { generateEditableGardenPlanSvg } from './garden-site-plan-vector-service';

export interface EnqueueGardenPlanGenerationInput {
  householdId: string;
  userId: string;
  approvalId?: string;
  diagramPrompt: string;
  planType: string;
  areaLabel: string;
  referenceImageR2Key?: string;
  referenceImageSource?:
    | 'user_attachment'
    | 'mapbox_satellite'
    | 'confirmed_boundary'
    | 'none';
  boundaryDraftId?: string;
  boundarySource?: string | null;
  boundaryGeojson?: string | null;
  geocodePlaceName?: string | null;
}

export interface EnqueueGardenPlanGenerationResult {
  gardenPlanId: string;
  queued: true;
}

export interface CreateVectorGardenPlanFromBoundaryInput {
  householdId: string;
  userId: string;
  diagramPrompt: string;
  planType: string;
  areaLabel: string;
  referenceImageR2Key?: string | null;
  boundaryDraftId: string;
  boundarySource?: string | null;
  boundaryGeojson: string;
  geocodePlaceName?: string | null;
}

export interface CreateVectorGardenPlanFromBoundaryResult {
  gardenPlanId: string;
  queued: false;
}

export async function createVectorGardenPlanFromBoundary(
  env: Env,
  input: CreateVectorGardenPlanFromBoundaryInput
): Promise<CreateVectorGardenPlanFromBoundaryResult> {
  const prompt = input.diagramPrompt.trim();
  if (!prompt) {
    throw new Error('missing_diagram_prompt');
  }

  const svg = generateEditableGardenPlanSvg({
    boundaryGeojson: input.boundaryGeojson,
    diagramPrompt: prompt,
    areaLabel: input.areaLabel,
  });
  if (!svg) {
    throw new Error('invalid_boundary_geojson');
  }

  const db = drizzle(env.DB, {
    schema: { ...schema, ...gardenSchema },
  }) as unknown as Database;
  const gardenPlanId = generateId();
  const filename = 'garden-site-plan.svg';
  const r2Key = `garden-plans/${input.householdId}/${gardenPlanId}/${filename}`;
  const svgBytes = new TextEncoder().encode(svg.svg);
  const ts = nowIso();

  await env.REPORTS_BUCKET.put(r2Key, svg.svg, {
    httpMetadata: { contentType: 'image/svg+xml' },
  });

  try {
    await db.insert(gardenPlans).values({
      id: gardenPlanId,
      household_id: input.householdId,
      plan_type: input.planType,
      filename,
      file_size: svgBytes.byteLength,
      content_type: 'image/svg+xml',
      original_file_key: r2Key,
      display_image_key: r2Key,
      thumbnail_key: input.referenceImageR2Key ?? null,
      content_hash: null,
      label: input.areaLabel,
      width_px: svg.width,
      height_px: svg.height,
      status: 'completed',
      source_approval_id: null,
      reference_image_source: 'confirmed_boundary',
      boundary_draft_id: input.boundaryDraftId,
      boundary_source: input.boundarySource ?? null,
      boundary_geojson: input.boundaryGeojson,
      geocode_place_name: input.geocodePlaceName ?? null,
      generation_prompt: prompt,
      created_by: input.userId,
      created_at: ts,
      updated_at: ts,
    });
  } catch (err) {
    try {
      await env.REPORTS_BUCKET.delete(r2Key);
    } catch {
      // Best-effort cleanup.
    }
    throw new Error(`garden_plan_insert_failed:${(err as Error).message}`);
  }

  return { gardenPlanId, queued: false };
}

/**
 * Shared producer for async garden-plan generation. Used by both:
 * - Mira approval executor after the HIGH_WRITE row is approved.
 * - Gardening boundary wizard after the user confirms/adjusts the plot.
 *
 * This function owns quota increment, placeholder row creation, queue send,
 * and rollback/refund if the queue send fails.
 */
export async function enqueueGardenPlanGeneration(
  env: Env,
  input: EnqueueGardenPlanGenerationInput
): Promise<EnqueueGardenPlanGenerationResult> {
  const prompt = input.diagramPrompt.trim();
  if (!prompt) {
    throw new Error('missing_diagram_prompt');
  }

  const limit = await checkAndIncrementGardenPlanCount(env, input.householdId);
  if (!limit.allowed) {
    throw new Error('garden_plan_rate_limited');
  }

  const db = drizzle(env.DB, { schema }) as unknown as Database;
  const gardenPlanId = generateId();
  const filename = 'garden-site-plan.png';
  const placeholderKey = `garden-plans/${input.householdId}/${gardenPlanId}/${filename}`;
  const ts = nowIso();

  try {
    await db.insert(gardenPlans).values({
      id: gardenPlanId,
      household_id: input.householdId,
      plan_type: input.planType,
      filename,
      file_size: 0,
      content_type: 'image/png',
      original_file_key: placeholderKey,
      display_image_key: null,
      thumbnail_key: null,
      content_hash: null,
      label: input.areaLabel,
      width_px: GARDEN_PLAN_IMAGE_WIDTH,
      height_px: GARDEN_PLAN_IMAGE_HEIGHT,
      status: 'generating',
      source_approval_id: input.approvalId ?? null,
      reference_image_source: input.referenceImageSource ?? null,
      boundary_draft_id: input.boundaryDraftId ?? null,
      boundary_source: input.boundarySource ?? null,
      boundary_geojson: input.boundaryGeojson ?? null,
      geocode_place_name: input.geocodePlaceName ?? null,
      generation_prompt: prompt,
      created_by: input.userId,
      created_at: ts,
      updated_at: ts,
    });
  } catch (err) {
    await refundGardenPlanCount(env, input.householdId);
    throw new Error(`garden_plan_insert_failed:${(err as Error).message}`);
  }

  try {
    await env.GARDEN_PLAN_QUEUE.send({
      approvalId: input.approvalId,
      gardenPlanId,
      householdId: input.householdId,
      userId: input.userId,
      diagramPrompt: prompt,
      planType: input.planType,
      areaLabel: input.areaLabel,
      enqueuedAt: Date.now(),
      referenceImageR2Key: input.referenceImageR2Key,
      referenceImageSource: input.referenceImageSource,
      boundaryDraftId: input.boundaryDraftId,
    });
  } catch (err) {
    try {
      await db.delete(gardenPlans).where(eq(gardenPlans.id, gardenPlanId));
    } catch {
      // Best-effort cleanup; a stuck row sweep will reconcile if needed.
    }
    await refundGardenPlanCount(env, input.householdId);
    throw new Error(`garden_plan_enqueue_failed:${(err as Error).message}`);
  }

  return { gardenPlanId, queued: true };
}

