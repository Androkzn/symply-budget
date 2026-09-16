import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { requireAIEntitlement } from '../middleware/require-ai-entitlement';
import { FloorPlanService } from '../services/floor-plan-service';
import type { Env } from '../types';

const floorPlans = new Hono<{ Bindings: Env }>();

// All floor plan routes require authentication
floorPlans.use('/*', authMiddleware());

// Helper to get householdId from parent route param
function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

// ============ VALIDATION SCHEMAS ============

const uploadUrlSchema = z.object({
  filename: z.string().min(1),
  file_size: z.number().positive(),
  content_type: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  building_name: z.string().optional(),
  floor_number: z.number().optional(),
  floor_label: z.string().optional(),
});

const confirmUploadSchema = z.object({
  building_name: z.string().min(1),
  floor_number: z.number().optional(),
  floor_label: z.string().optional(),
});

const updateFloorPlanSchema = z.object({
  building_name: z.string().optional(),
  floor_number: z.number().optional(),
  floor_label: z.string().optional(),
  scale_pixels_per_foot: z.number().optional(),
  scale_pixels_per_meter: z.number().optional(),
  scale_unit: z.enum(['feet', 'meters', 'inches']).optional(),
});

const calibrateScaleSchema = z.object({
  pixel_distance: z.number().positive(),
  actual_distance: z.number().positive(),
  unit: z.enum(['feet', 'meters', 'inches']),
});

const boundingBoxSchema = z.object({
  x1: z.number().min(0).max(1),
  y1: z.number().min(0).max(1),
  x2: z.number().min(0).max(1),
  y2: z.number().min(0).max(1),
});

const updateAnalysisAreaSchema = z.object({
  name: z.string().min(1).max(120),
  bounding_box: boundingBoxSchema,
});

const updateAnalysisSchema = z.object({
  floors: z.array(updateAnalysisAreaSchema).optional(),
  detached_areas: z
    .array(updateAnalysisAreaSchema.extend({ type: z.string().optional() }))
    .optional(),
});

const createMarkerSchema = z.object({
  x_percent: z.number().min(0).max(100),
  y_percent: z.number().min(0).max(100),
  linked_entity_type: z.preprocess(
    (val) => (val === 'task' ? 'maintenance_task' : val),
    z.enum(['maintenance_task', 'action_item'])
  ),
  linked_entity_id: z.string(),
  marker_type: z.enum(['pin', 'circle', 'square']).optional(),
  marker_color: z.string().optional(),
  marker_icon: z.string().optional(),
  label: z.string().optional(),
  show_label: z.boolean().optional(),
  space_id: z.string().optional(),
});

const updateMarkerSchema = z.object({
  x_percent: z.number().min(0).max(100).optional(),
  y_percent: z.number().min(0).max(100).optional(),
  marker_type: z.enum(['pin', 'circle', 'square']).optional(),
  marker_color: z.string().optional(),
  marker_icon: z.string().optional(),
  label: z.string().optional(),
  show_label: z.boolean().optional(),
  space_id: z.string().optional(),
});

const createAnnotationSchema = z.object({
  annotation_type: z.enum(['line', 'circle', 'polygon', 'text', 'measurement']),
  svg_data: z.any().optional(),
  stroke_color: z.string().optional(),
  stroke_width: z.number().optional(),
  fill_color: z.string().optional(),
  opacity: z.number().optional(),
  text_content: z.string().optional(),
  font_size: z.number().optional(),
  measurement_value: z.number().optional(),
  measurement_unit: z.string().optional(),
});

// ============ FLOOR PLAN UPLOAD ROUTES ============

/**
 * POST /households/:householdId/floor-plans/upload-url
 * Generate pre-signed URL for floor plan upload
 */
floorPlans.post('/upload-url', zValidator('json', uploadUrlSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const service = new FloorPlanService(c.env, c.env.DB, c.get('userId'));

  const result = await service.generateUploadUrl(householdId, userId, input);

  return c.json(result, 200);
});

/**
 * PUT /households/:householdId/floor-plans/:id/upload
 * Direct file upload endpoint
 */
floorPlans.put('/:id/upload', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const floorPlanId = c.req.param('id');
  const service = new FloorPlanService(c.env, c.env.DB, c.get('userId'));

  try {
    const contentType = c.req.header('content-type') || 'application/octet-stream';
    const body = await c.req.arrayBuffer();

    if (body.byteLength === 0) {
      return c.json({ error: 'File is empty' }, 400);
    }

    await service.uploadFile(householdId, floorPlanId, userId, body, contentType);

    return c.json({ message: 'File uploaded successfully' }, 200);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Upload failed';
    const errorName = error instanceof Error ? error.name : 'UnknownError';

    console.error(`[floor-plans upload] Failed for ${floorPlanId}:`, error);

    if (errorName === 'ForbiddenError') {
      return c.json({ error: errorMessage, code: 'already_uploaded' }, 403);
    }
    if (errorName === 'NotFoundError') {
      return c.json({ error: 'Floor plan not found' }, 404);
    }

    return c.json({ error: errorMessage }, 500);
  }
});

/**
 * POST /households/:householdId/floor-plans/:id/confirm-upload
 * Confirm file upload completion
 */
floorPlans.post('/:id/confirm-upload', zValidator('json', confirmUploadSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const floorPlanId = c.req.param('id');
  const data = c.req.valid('json');
  const service = new FloorPlanService(c.env, c.env.DB, c.get('userId'));

  try {
    const result = await service.confirmUpload(householdId, floorPlanId, userId, data);
    return c.json(result, 200);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (errorName === 'NotFoundError') {
      return c.json({ error: errorMessage, code: 'not_found' }, 404);
    }
    if (errorName === 'ForbiddenError') {
      return c.json({ error: errorMessage, code: 'already_confirmed' }, 403);
    }

    return c.json({ error: errorMessage }, 500);
  }
});

// ============ FLOOR PLAN CRUD ROUTES ============

/**
 * GET /households/:householdId/floor-plans
 * List all floor plans
 */
floorPlans.get('/', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const service = new FloorPlanService(c.env, c.env.DB, c.get('userId'));

  const buildingName = c.req.query('building_name');
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined;
  const cursor = c.req.query('cursor');

  const result = await service.listFloorPlans(householdId, userId, {
    building_name: buildingName,
    limit,
    cursor,
  });

  return c.json(result, 200);
});

/**
 * GET /households/:householdId/floor-plans/:id
 * Get a single floor plan
 */
floorPlans.get('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const floorPlanId = c.req.param('id');
  const service = new FloorPlanService(c.env, c.env.DB, c.get('userId'));

  try {
    const result = await service.getFloorPlan(householdId, floorPlanId, userId);
    return c.json(result, 200);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to get floor plan:', errorName, errorMessage);

    if (errorName === 'NotFoundError') {
      return c.json({ error: errorMessage }, 404);
    }

    return c.json({ error: errorMessage }, 500);
  }
});

/**
 * GET /households/:householdId/floor-plans/:id/status
 * Get processing status
 */
floorPlans.get('/:id/status', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const floorPlanId = c.req.param('id');
  const service = new FloorPlanService(c.env, c.env.DB, c.get('userId'));

  const result = await service.getProcessingStatus(householdId, floorPlanId, userId);

  return c.json(result, 200);
});

/**
 * POST /households/:householdId/floor-plans/:id/analyze
 * Trigger AI analysis of the floor plan (runs in background via waitUntil).
 *
 * The only floor-plan route that spends inference, and so the only one that asks
 * for an entitlement. Uploading, listing, viewing and deleting a plan stay open:
 * a member with neither a subscription nor a key of their own keeps every plan
 * they uploaded, just without the AI read on top.
 */
floorPlans.post('/:id/analyze', requireAIEntitlement(), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const floorPlanId = c.req.param('id');
  const service = new FloorPlanService(c.env, c.env.DB, c.get('userId'));

  try {
    const result = await service.analyzeFloorPlan(
      householdId,
      floorPlanId,
      userId,
      (p) => c.executionCtx.waitUntil(p)
    );
    return c.json(result, 200);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to analyze floor plan:', errorName, errorMessage);

    if (errorName === 'NotFoundError') {
      return c.json({ error: errorMessage }, 404);
    }

    return c.json({ error: errorMessage }, 500);
  }
});

/**
 * GET /households/:householdId/floor-plans/:id/analysis
 * Get AI analysis results
 */
floorPlans.get('/:id/analysis', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const floorPlanId = c.req.param('id');
  const service = new FloorPlanService(c.env, c.env.DB, c.get('userId'));

  try {
    const result = await service.getAnalysis(householdId, floorPlanId, userId);
    return c.json(result, 200);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to get floor plan analysis:', errorName, errorMessage);

    if (errorName === 'NotFoundError') {
      return c.json({ error: errorMessage }, 404);
    }

    return c.json({ error: errorMessage }, 500);
  }
});

/**
 * GET /households/:householdId/floor-plans/:id/regions
 * List per-floor / detached-area regions with crop + vector asset URLs.
 */
floorPlans.get('/:id/regions', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const floorPlanId = c.req.param('id');
  const service = new FloorPlanService(c.env, c.env.DB, c.get('userId'));

  try {
    const result = await service.listRegions(householdId, floorPlanId, userId);
    return c.json(result, 200);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorName === 'NotFoundError') {
      return c.json({ error: errorMessage }, 404);
    }
    return c.json({ error: errorMessage }, 500);
  }
});

/**
 * POST /households/:householdId/floor-plans/:id/regions/process-pending
 * Process the next pending region (one Claude/crop cycle per request).
 * Call repeatedly until remaining === 0 / status === completed.
 */
floorPlans.post('/:id/regions/process-pending', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const floorPlanId = c.req.param('id');
  const service = new FloorPlanService(c.env, c.env.DB, c.get('userId'));

  try {
    const result = await service.processPendingRegions(householdId, floorPlanId, userId);
    return c.json(result, 200);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to process pending region:', errorName, errorMessage);
    if (errorName === 'NotFoundError') {
      return c.json({ error: errorMessage }, 404);
    }
    return c.json({ error: errorMessage }, 500);
  }
});

/**
 * POST /households/:householdId/floor-plans/:id/regions/:regionId/retry
 * Re-run Pass 2 (crop → spaces → semantic → trace) for one region.
 */
floorPlans.post('/:id/regions/:regionId/retry', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const floorPlanId = c.req.param('id');
  const regionId = c.req.param('regionId');
  const service = new FloorPlanService(c.env, c.env.DB, c.get('userId'));

  try {
    const result = await service.retryRegion(householdId, floorPlanId, regionId, userId);
    return c.json(result, 200);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorName === 'NotFoundError') {
      return c.json({ error: errorMessage }, 404);
    }
    return c.json({ error: errorMessage }, 500);
  }
});

/**
 * POST /households/:householdId/floor-plans/:id/vectorize
 * Generate the semantic SVG layer for the floor plan via Claude Vision.
 *
 * Pixel-perfect Potrace trace (vector_trace_key) lands in a separate flow
 * once the Cloudflare Container worker is deployed (PR 4).
 */
floorPlans.post('/:id/vectorize', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const floorPlanId = c.req.param('id');
  const service = new FloorPlanService(c.env, c.env.DB, c.get('userId'));

  try {
    const result = await service.vectorizeFloorPlan(householdId, floorPlanId, userId);
    return c.json(result, 200);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to vectorize floor plan:', errorName, errorMessage);

    if (errorName === 'NotFoundError') {
      return c.json({ error: errorMessage }, 404);
    }
    return c.json({ error: errorMessage }, 500);
  }
});

/**
 * GET /households/:householdId/floor-plans/:id/vector
 * Return the keys + URLs for the vectorized layers (semantic + trace).
 */
floorPlans.get('/:id/vector', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const floorPlanId = c.req.param('id');
  const service = new FloorPlanService(c.env, c.env.DB, c.get('userId'));

  try {
    const result = await service.getVectorAssets(householdId, floorPlanId, userId);
    return c.json(result, 200);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorName === 'NotFoundError') {
      return c.json({ error: errorMessage }, 404);
    }
    return c.json({ error: errorMessage }, 500);
  }
});

/**
 * PATCH /households/:householdId/floor-plans/:id/analysis
 * Replace user-editable area lists in the AI analysis (floors + detached areas).
 * Used by the area editor where users rename and resize bounding boxes.
 */
floorPlans.patch('/:id/analysis', zValidator('json', updateAnalysisSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const floorPlanId = c.req.param('id');
  const data = c.req.valid('json');
  const service = new FloorPlanService(c.env, c.env.DB, c.get('userId'));

  try {
    const result = await service.updateAnalysisAreas(householdId, floorPlanId, userId, data);
    return c.json(result, 200);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to update floor plan analysis areas:', errorName, errorMessage);

    if (errorName === 'NotFoundError') {
      return c.json({ error: errorMessage }, 404);
    }
    if (errorName === 'ValidationError') {
      return c.json({ error: errorMessage }, 400);
    }

    return c.json({ error: errorMessage }, 500);
  }
});

/**
 * PATCH /households/:householdId/floor-plans/:id
 * Update floor plan metadata
 */
floorPlans.patch('/:id', zValidator('json', updateFloorPlanSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const floorPlanId = c.req.param('id');
  const data = c.req.valid('json');
  const service = new FloorPlanService(c.env, c.env.DB, c.get('userId'));

  const result = await service.updateFloorPlan(householdId, floorPlanId, userId, data);

  return c.json(result, 200);
});

/**
 * DELETE /households/:householdId/floor-plans/:id
 * Delete floor plan (soft delete)
 */
floorPlans.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const floorPlanId = c.req.param('id');
  const service = new FloorPlanService(c.env, c.env.DB, c.get('userId'));

  await service.deleteFloorPlan(householdId, floorPlanId, userId);

  return c.json({ message: 'Floor plan deleted successfully' }, 200);
});

/**
 * POST /households/:householdId/floor-plans/:id/calibrate-scale
 * Calibrate floor plan scale
 */
floorPlans.post('/:id/calibrate-scale', zValidator('json', calibrateScaleSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const floorPlanId = c.req.param('id');
  const data = c.req.valid('json');
  const service = new FloorPlanService(c.env, c.env.DB, c.get('userId'));

  const result = await service.calibrateScale(householdId, floorPlanId, userId, data);

  return c.json(result, 200);
});

// ============ MARKER ROUTES ============

/**
 * GET /households/:householdId/floor-plans/:id/markers
 * List markers for a floor plan
 */
floorPlans.get('/:id/markers', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const floorPlanId = c.req.param('id');
  const service = new FloorPlanService(c.env, c.env.DB, c.get('userId'));

  const result = await service.listMarkers(householdId, floorPlanId, userId);

  return c.json(result, 200);
});

/**
 * GET /households/:householdId/floor-plan-markers
 * Get markers for a specific entity (across all floor plans)
 */
floorPlans.get('/markers-for-entity', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const service = new FloorPlanService(c.env, c.env.DB, c.get('userId'));

  const entityType = c.req.query('linked_entity_type') as 'maintenance_task' | 'action_item';
  const entityId = c.req.query('linked_entity_id');

  if (!entityType || !entityId) {
    return c.json({ error: 'linked_entity_type and linked_entity_id are required' }, 400);
  }

  const result = await service.getMarkersForEntity(householdId, userId, entityType, entityId);

  return c.json(result, 200);
});

/**
 * POST /households/:householdId/floor-plans/:id/markers
 * Create a marker
 */
floorPlans.post('/:id/markers', zValidator('json', createMarkerSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const floorPlanId = c.req.param('id');
  const data = c.req.valid('json');
  const service = new FloorPlanService(c.env, c.env.DB, c.get('userId'));

  const result = await service.createMarker(householdId, floorPlanId, userId, data);

  return c.json(result, 201);
});

/**
 * PATCH /households/:householdId/floor-plan-markers/:markerId
 * Update a marker
 */
floorPlans.patch('/markers/:markerId', zValidator('json', updateMarkerSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const markerId = c.req.param('markerId');
  const data = c.req.valid('json');
  const service = new FloorPlanService(c.env, c.env.DB, c.get('userId'));

  const result = await service.updateMarker(householdId, markerId, userId, data);

  return c.json(result, 200);
});

/**
 * DELETE /households/:householdId/floor-plan-markers/:markerId
 * Delete a marker
 */
floorPlans.delete('/markers/:markerId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const markerId = c.req.param('markerId');
  const service = new FloorPlanService(c.env, c.env.DB, c.get('userId'));

  await service.deleteMarker(householdId, markerId, userId);

  return c.json({ message: 'Marker deleted successfully' }, 200);
});

// ============ ANNOTATION ROUTES ============

/**
 * GET /households/:householdId/floor-plans/:id/annotations
 * List annotations for a floor plan
 */
floorPlans.get('/:id/annotations', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const floorPlanId = c.req.param('id');
  const service = new FloorPlanService(c.env, c.env.DB, c.get('userId'));

  const result = await service.listAnnotations(householdId, floorPlanId, userId);

  return c.json(result, 200);
});

/**
 * POST /households/:householdId/floor-plans/:id/annotations
 * Create an annotation
 */
floorPlans.post('/:id/annotations', zValidator('json', createAnnotationSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const floorPlanId = c.req.param('id');
  const data = c.req.valid('json');
  const service = new FloorPlanService(c.env, c.env.DB, c.get('userId'));

  const result = await service.createAnnotation(householdId, floorPlanId, userId, data);

  return c.json(result, 201);
});

/**
 * DELETE /households/:householdId/floor-plan-annotations/:annotationId
 * Delete an annotation
 */
floorPlans.delete('/annotations/:annotationId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const annotationId = c.req.param('annotationId');
  const service = new FloorPlanService(c.env, c.env.DB, c.get('userId'));

  await service.deleteAnnotation(householdId, annotationId, userId);

  return c.json({ message: 'Annotation deleted successfully' }, 200);
});

export default floorPlans;
