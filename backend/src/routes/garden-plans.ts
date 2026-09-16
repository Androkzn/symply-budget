import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AIProvider } from '../ai/provider';
import { createAnthropicAdapterForUser } from '../ai/provider-factory';
import {
  GARDEN_PLAN_OBJECT_TYPES,
} from '../db/schema-garden-plans';
import { authMiddleware } from '../middleware/auth';
import { GardenPlanVisionService } from '../services/ai/garden-plan-vision-service';
import { assertCanUseAI } from '../services/entitlement-service';
import { GardenPlanBoundaryService } from '../services/garden-plan-boundary-service';
import {
  cancelGardenPlanGeneration,
  retryGardenPlanGeneration,
} from '../services/garden-plan-generation-control';
import { GardenPlanService } from '../services/garden-plan-service';
import { HouseholdService } from '../services/household-service';
import type { Env } from '../types';
import { AIAccessError, ValidationError } from '../utils/errors';

const gardenPlans = new Hono<{ Bindings: Env }>();

gardenPlans.use('/*', authMiddleware());

function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

// ============ VALIDATION ============

const planTypeZod = z.enum(['front_yard', 'back_yard', 'garden', 'bed', 'other_outdoor']);
const gardenObjectTypeZod = z.enum(
  GARDEN_PLAN_OBJECT_TYPES as unknown as [
    (typeof GARDEN_PLAN_OBJECT_TYPES)[number],
    ...(typeof GARDEN_PLAN_OBJECT_TYPES)[number][],
  ]
);

const uploadUrlSchema = z.object({
  filename: z.string().min(1),
  file_size: z.number().positive(),
  content_type: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/svg+xml']),
  plan_type: planTypeZod.optional(),
  label: z.string().optional(),
});

const confirmUploadSchema = z.object({
  plan_type: planTypeZod.optional(),
  label: z.string().optional(),
});

const updateSchema = z.object({
  plan_type: planTypeZod.optional(),
  label: z.string().optional(),
});

const createMarkerSchema = z.object({
  x_percent: z.number().min(0).max(100),
  y_percent: z.number().min(0).max(100),
  linked_entity_type: z.enum(['maintenance_task', 'action_item']),
  linked_entity_id: z.string(),
  marker_color: z.string().optional(),
  marker_icon: z.string().optional(),
  label: z.string().optional(),
  show_label: z.boolean().optional(),
  space_id: z.string().optional(),
});

const updateMarkerSchema = z.object({
  x_percent: z.number().min(0).max(100).optional(),
  y_percent: z.number().min(0).max(100).optional(),
  marker_color: z.string().optional(),
  marker_icon: z.string().optional(),
  label: z.string().optional(),
  show_label: z.boolean().optional(),
  space_id: z.string().optional(),
});

const gardenVectorObjectSchema = z.object({
  id: z.string().optional(),
  type: gardenObjectTypeZod,
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  // Bounds are widened to the ZONE range here and narrowed per type in the
  // refinement below. Validating `0.03..0.8` inline would 400 every zone that
  // spans most of the lot — which is most back yards — before
  // `normalizeVectorObjects` ever got the chance to apply the right clamp.
  width: z.number().min(0.01).max(1),
  height: z.number().min(0.01).max(1),
  rotation: z.number().min(-3600).max(3600).default(0),
  label: z.string().max(80).optional().nullable(),
  color: z.string().max(24).optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
}).superRefine((object, ctx) => {
  // Elements keep the original `0.03..0.8`; only `zone` is exempt. Enforced
  // here rather than left to the service's clamp so an oversized ELEMENT is
  // still rejected loudly instead of being silently shrunk, which is the
  // behaviour this endpoint has always had.
  if (object.type === 'zone') return;
  for (const axis of ['width', 'height'] as const) {
    const value = object[axis];
    if (value < 0.03 || value > 0.8) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [axis],
        message: `${axis} must be between 0.03 and 0.8 for a ${object.type}`,
      });
    }
  }
});

const vectorObjectsPayloadSchema = z.object({
  vector_objects: z.array(gardenVectorObjectSchema).max(80),
});

const analyzePlanImageSchema = z.object({
  // Inline base64 rather than an R2 key: the bytes are read once and forgotten,
  // so there is no transient object to clean up and nothing accumulates in a
  // bucket no screen lists. ~6 MB of base64 ≈ a 4.5 MB image, comfortably above
  // a photographed survey page and below the Worker's request ceiling.
  image_base64: z.string().min(64).max(6_000_000),
  /** Advisory only — the bytes decide. See `GardenPlanVisionService.analyze`. */
  media_type: z.string().max(80).optional().nullable(),
  /**
   * Preset ids this client can resolve. Sent by the caller so the 56-entry
   * catalogue has exactly one home (the mobile bundle) rather than a copy here
   * that drifts every time a preset is renamed.
   */
  element_vocabulary: z.array(z.string().min(1).max(60)).min(1).max(200),
  hint: z.string().max(300).optional().nullable(),
});

const createMapPlanSchema = z.object({
  plan_type: planTypeZod,
  label: z.string().max(120).optional().nullable(),
  boundary_geojson: z.object({
    type: z.enum(['Polygon', 'MultiPolygon']),
    coordinates: z.array(z.any()),
  }),
  boundary_source: z.enum(['user_adjusted', 'user_drawn']).optional(),
  geocode_place_name: z.string().max(240).optional().nullable(),
  objects: z.array(gardenVectorObjectSchema).max(80).optional(),
});

const addressSchema = z.object({
  address_line1: z.string().min(1).optional(),
  address_line2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state_province: z.string().optional().nullable(),
  postal_code: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
});

const geoJsonPolygonSchema = z.object({
  type: z.enum(['Polygon', 'MultiPolygon']),
  coordinates: z.array(z.any()),
});

const createBoundaryDraftSchema = z.object({
  address: addressSchema.optional(),
});

const confirmBoundarySchema = z.object({
  boundary_geojson: geoJsonPolygonSchema,
  boundary_source: z.enum(['user_adjusted', 'user_drawn']),
});

const boundaryMeasurementsSchema = z.object({
  unit: z.enum(['feet', 'meters']),
  width: z.number().positive(),
  depth: z.number().positive(),
  area: z.number().positive(),
});

const generateFromBoundarySchema = z.object({
  plan_type: planTypeZod,
  area_label: z.string().min(1).max(120),
  vibe: z.string().min(1).max(80),
  must_haves: z.array(z.string().min(1).max(60)).max(12).optional(),
  notes: z.string().max(600).optional().nullable(),
  boundary_measurements: boundaryMeasurementsSchema.optional(),
});

// ============ UPLOAD ============

gardenPlans.post('/upload-url', zValidator('json', uploadUrlSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const service = new GardenPlanService(c.env, c.env.DB);

  const result = await service.generateUploadUrl(householdId, userId, input);
  return c.json(result, 200);
});

/**
 * Create a plan traced on a map. No bytes, so no presign and no upload step —
 * the boundary and every zone/element land in this one request. See
 * `GardenPlanService.createMapPlan`.
 *
 * Registered ahead of the `/:id/...` routes for readability rather than
 * necessity: `/map-plan` is one segment and every `:id` route is two or more,
 * so there is no collision to avoid.
 */
gardenPlans.post('/map-plan', zValidator('json', createMapPlanSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const service = new GardenPlanService(c.env, c.env.DB);

  const result = await service.createMapPlan(householdId, userId, input);
  return c.json(result, 201);
});

/** Member-facing copy for each typed refusal. No provider strings ever reach the UI. */
const VISION_COPY = {
  unsupported_media:
    'That file could not be read as an image. PDFs and HEIC photos are not supported here — export the page as a JPEG or PNG, or trace the yard on the map instead.',
  unreadable:
    'We could not find a property outline in that image. Try a clearer photo or plan, or trace the yard on the map.',
  provider_unavailable: 'The plan reader is unavailable right now. Please try again shortly.',
} as const;

/**
 * Read a site plan, survey page or aerial photo into a DRAFT yard plan.
 *
 * Persists nothing. The geometry comes back normalized `0..1` over the supplied
 * image; the client fits it onto the lot the member traced on their own map and
 * lets them correct it before anything is saved. See
 * `GardenPlanVisionService` for why that division of labour is the whole design,
 * and why it is safe for a local-first household to call.
 */
gardenPlans.post(
  '/analyze-plan-image',
  zValidator('json', analyzePlanImageSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const input = c.req.valid('json');

    // Membership first: an image is being sent on this household's behalf, so
    // the caller has to belong to it before a model ever sees the bytes.
    await new HouseholdService(c.env, c.env.DB).getHousehold(householdId, userId);

    try {
      await assertCanUseAI(userId, c.env);
    } catch (err) {
      if (err instanceof AIAccessError || (err as Error)?.name === 'AIAccessError') {
        const e = err as AIAccessError & { statusCode?: number; code?: string; message: string };
        return c.json(
          { error: { code: e.code ?? 'ai_access_denied', message: e.message } },
          (e.statusCode ?? 403) as 403 | 409 | 422 | 503
        );
      }
      throw err;
    }

    let provider: AIProvider | null = null;
    try {
      const adapter = await createAnthropicAdapterForUser(
        c.env,
        userId,
        { feature: 'garden_plan_vision', userId },
        GardenPlanVisionService.MODEL
      );
      provider = adapter.isAvailable() ? adapter : null;
    } catch (err) {
      console.error('[garden-plans] provider construction failed:', String(err).slice(0, 200));
      provider = null;
    }
    if (!provider) {
      return c.json(
        { error: { code: 'provider_unavailable', message: VISION_COPY.provider_unavailable } },
        503
      );
    }

    const result = await new GardenPlanVisionService().analyze({
      provider,
      image: { base64: input.image_base64, declaredMediaType: input.media_type },
      elementVocabulary: input.element_vocabulary,
      hint: input.hint,
    });

    if (!result.ok) {
      const status = result.reason === 'provider_unavailable' ? 503 : 422;
      return c.json(
        { error: { code: result.reason, message: VISION_COPY[result.reason] } },
        status
      );
    }

    return c.json({ draft: result.draft }, 200);
  }
);

gardenPlans.put('/:id/upload', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const gardenPlanId = c.req.param('id');
  const service = new GardenPlanService(c.env, c.env.DB);

  try {
    const contentType = c.req.header('content-type') || 'application/octet-stream';
    const body = await c.req.arrayBuffer();

    if (body.byteLength === 0) {
      return c.json({ error: 'File is empty' }, 400);
    }

    await service.uploadFile(householdId, gardenPlanId, userId, body, contentType);
    return c.json({ message: 'File uploaded successfully' }, 200);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : 'Upload failed';
    console.error(`[garden-plans upload] Failed for ${gardenPlanId}:`, error);

    if (errorName === 'ForbiddenError') return c.json({ error: errorMessage, code: 'already_uploaded' }, 403);
    if (errorName === 'NotFoundError') return c.json({ error: 'Garden plan not found' }, 404);
    return c.json({ error: errorMessage }, 500);
  }
});

gardenPlans.post('/:id/confirm-upload', zValidator('json', confirmUploadSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const gardenPlanId = c.req.param('id');
  const data = c.req.valid('json');
  const service = new GardenPlanService(c.env, c.env.DB);

  try {
    const result = await service.confirmUpload(householdId, gardenPlanId, userId, data);
    return c.json(result, 200);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorName === 'NotFoundError') return c.json({ error: errorMessage, code: 'not_found' }, 404);
    if (errorName === 'ForbiddenError') return c.json({ error: errorMessage, code: 'already_confirmed' }, 403);
    return c.json({ error: errorMessage }, 500);
  }
});

// ============ BOUNDARY-CONFIRMED AI GENERATION ============

gardenPlans.post('/boundary-drafts', zValidator('json', createBoundaryDraftSchema), async (c) => {
  return c.json(
    {
      error: 'Map preview removed',
      code: 'map_preview_removed',
      message:
        'Satellite map boundary drafts are no longer available. Upload a yard photo or ask Mira for a stylized concept plan.',
    },
    410
  );
});

gardenPlans.get('/boundary-drafts', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const service = new GardenPlanBoundaryService(c.env, c.env.DB);

  try {
    const result = await service.listPendingDrafts(householdId, userId);
    return c.json(result, 200);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

gardenPlans.patch(
  '/boundary-drafts/:draftId/boundary',
  zValidator('json', confirmBoundarySchema),
  async (c) => {
    return c.json(
      {
        error: 'Map preview removed',
        code: 'map_preview_removed',
        message:
          'Satellite map boundary confirmation is no longer available. Upload a yard photo or ask Mira for a stylized concept plan.',
      },
      410
    );
  }
);

gardenPlans.get('/boundary-drafts/:draftId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const draftId = c.req.param('draftId');
  const service = new GardenPlanBoundaryService(c.env, c.env.DB);

  try {
    const result = await service.getDraft(householdId, userId, draftId);
    return c.json(result, 200);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorName === 'NotFoundError') return c.json({ error: errorMessage }, 404);
    return c.json({ error: errorMessage }, 500);
  }
});

gardenPlans.delete('/boundary-drafts/:draftId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const draftId = c.req.param('draftId');
  const service = new GardenPlanBoundaryService(c.env, c.env.DB);

  try {
    await service.deleteDraft(householdId, userId, draftId);
    return c.json({ message: 'Boundary draft deleted' }, 200);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorName === 'NotFoundError') return c.json({ error: errorMessage }, 404);
    return c.json({ error: errorMessage }, 500);
  }
});

gardenPlans.post(
  '/boundary-drafts/:draftId/generate',
  zValidator('json', generateFromBoundarySchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const draftId = c.req.param('draftId');
    const input = c.req.valid('json');
    const service = new GardenPlanBoundaryService(c.env, c.env.DB);

    try {
      const result = await service.generateFromBoundary(householdId, userId, draftId, input);
      return c.json(result, 201);
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorName === 'NotFoundError') return c.json({ error: errorMessage }, 404);
      if (errorName === 'ValidationError') return c.json({ error: errorMessage }, 400);
      if (errorMessage === 'garden_plan_rate_limited') {
        return c.json({ error: 'Daily garden plan generation limit reached' }, 429);
      }
      return c.json({ error: errorMessage }, 500);
    }
  }
);

// ============ CRUD ============

gardenPlans.get('/', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const service = new GardenPlanService(c.env, c.env.DB);

  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined;
  const cursor = c.req.query('cursor');

  const result = await service.list(householdId, userId, { limit, cursor });
  return c.json(result, 200);
});

gardenPlans.get('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const gardenPlanId = c.req.param('id');
  const service = new GardenPlanService(c.env, c.env.DB);

  try {
    const result = await service.get(householdId, gardenPlanId, userId);
    return c.json(result, 200);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorName === 'NotFoundError') return c.json({ error: errorMessage }, 404);
    return c.json({ error: errorMessage }, 500);
  }
});

/** Update lot boundary GeoJSON on an existing plan (in-app boundary editor). */
gardenPlans.patch(
  '/:id/boundary',
  zValidator('json', confirmBoundarySchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const gardenPlanId = c.req.param('id');
    const input = c.req.valid('json');
    const service = new GardenPlanService(c.env, c.env.DB);

    try {
      const result = await service.updateBoundary(householdId, gardenPlanId, userId, {
        boundary_geojson: input.boundary_geojson,
        boundary_source: input.boundary_source,
      });
      return c.json(result, 200);
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorName === 'NotFoundError') return c.json({ error: errorMessage }, 404);
      return c.json({ error: errorMessage }, 500);
    }
  }
);

gardenPlans.patch('/:id', zValidator('json', updateSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const gardenPlanId = c.req.param('id');
  const data = c.req.valid('json');
  const service = new GardenPlanService(c.env, c.env.DB);

  const result = await service.update(householdId, gardenPlanId, userId, data);
  return c.json(result, 200);
});

gardenPlans.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const gardenPlanId = c.req.param('id');
  const service = new GardenPlanService(c.env, c.env.DB);

  await service.delete(householdId, gardenPlanId, userId);
  return c.json({ message: 'Garden plan deleted' }, 200);
});

// ============ AI ASYNC GENERATION CONTROLS ============
//
// `POST /:id/cancel` — abort an in-flight generation. Allowed only for rows
// in `status='generating'`. Marks the row 'failed', flips the linked
// ai_tool_pending row to 'failed', refunds the daily counter. Idempotent on
// non-generating rows: returns the current row without side effects.
//
// `POST /:id/retry` — re-enqueue an AI generation job for a row that's
// either failed or stuck in 'generating'. Looks up the original prompt via
// the linked `ai_tool_pending` row (`source_approval_id`); fails cleanly
// if the link is missing (manually-uploaded plans cannot be "retried").

gardenPlans.post('/:id/cancel', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const gardenPlanId = c.req.param('id');
  if (!gardenPlanId) throw new ValidationError({ id: ['missing garden plan id'] });

  const householdService = new HouseholdService(c.env, c.env.DB);
  await householdService.getHousehold(householdId, userId);

  const result = await cancelGardenPlanGeneration(c.env, householdId, gardenPlanId);
  return c.json(result.body, result.status);
});

gardenPlans.post('/:id/retry', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const gardenPlanId = c.req.param('id');
  if (!gardenPlanId) throw new ValidationError({ id: ['missing garden plan id'] });

  const householdService = new HouseholdService(c.env, c.env.DB);
  await householdService.getHousehold(householdId, userId);

  const result = await retryGardenPlanGeneration(c.env, householdId, gardenPlanId);
  return c.json(result.body, result.status);
});

// ============ MARKERS ============

gardenPlans.get('/:id/objects', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const gardenPlanId = c.req.param('id');
  const service = new GardenPlanService(c.env, c.env.DB);

  const result = await service.listObjects(householdId, gardenPlanId, userId);
  return c.json(result, 200);
});

gardenPlans.put(
  '/:id/objects',
  zValidator('json', vectorObjectsPayloadSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const gardenPlanId = c.req.param('id');
    const input = c.req.valid('json');
    const service = new GardenPlanService(c.env, c.env.DB);

    const result = await service.replaceObjects(
      householdId,
      gardenPlanId,
      userId,
      input.vector_objects
    );
    return c.json(result, 200);
  }
);

gardenPlans.get('/:id/markers', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const gardenPlanId = c.req.param('id');
  const service = new GardenPlanService(c.env, c.env.DB);

  const result = await service.listMarkers(householdId, gardenPlanId, userId);
  return c.json(result, 200);
});

gardenPlans.post('/:id/markers', zValidator('json', createMarkerSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const gardenPlanId = c.req.param('id');
  const data = c.req.valid('json');
  const service = new GardenPlanService(c.env, c.env.DB);

  const result = await service.createMarker(householdId, gardenPlanId, userId, data);
  return c.json(result, 201);
});

gardenPlans.patch('/markers/:markerId', zValidator('json', updateMarkerSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const markerId = c.req.param('markerId');
  const data = c.req.valid('json');
  const service = new GardenPlanService(c.env, c.env.DB);

  const result = await service.updateMarker(householdId, markerId, userId, data);
  return c.json(result, 200);
});

gardenPlans.delete('/markers/:markerId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const markerId = c.req.param('markerId');
  const service = new GardenPlanService(c.env, c.env.DB);

  await service.deleteMarker(householdId, markerId, userId);
  return c.json({ message: 'Marker deleted' }, 200);
});

gardenPlans.get('/markers/for-entity/:entityType/:entityId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const entityType = c.req.param('entityType') as 'maintenance_task' | 'action_item';
  const entityId = c.req.param('entityId');
  const service = new GardenPlanService(c.env, c.env.DB);

  const result = await service.getMarkersForEntity(householdId, userId, entityType, entityId);
  return c.json(result, 200);
});

export default gardenPlans;
