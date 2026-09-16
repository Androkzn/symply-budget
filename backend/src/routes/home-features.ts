import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { MaintenanceSuggestionService } from '../services/maintenance-suggestion-service';
import type { Env } from '../types';

const homeFeatures = new Hono<{ Bindings: Env }>();

// All routes require authentication
homeFeatures.use('/*', authMiddleware());

// Helper to get householdId from parent route param
function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

// Validation schemas
const createFeatureSchema = z.object({
  feature_type: z.string(),
  feature_subtype: z.string().optional(),
  quantity: z.number().optional(),
  location: z.string().optional(),
  brand: z.string().optional(),
  model: z.string().optional(),
  install_date: z.string().optional(),
  warranty_expires: z.string().optional(),
  notes: z.string().optional(),
});

const bulkCreateFeaturesSchema = z.object({
  features: z.array(createFeatureSchema),
});

const applySuggestionsSchema = z.object({
  suggestion_ids: z.array(z.string()).min(1).max(100),
});

const dismissSuggestionSchema = z.object({
  reason: z.string().optional(),
});

/**
 * GET /households/:householdId/home-features
 * List all home features for a household
 */
homeFeatures.get('/', async (c) => {
  const householdId = getHouseholdId(c);
  const service = new MaintenanceSuggestionService(c.env, c.env.DB, c.get('userId'));

  const features = await service.getHomeFeatures(householdId);

  return c.json({ features });
});

/**
 * POST /households/:householdId/home-features
 * Create a new home feature
 */
homeFeatures.post('/', zValidator('json', createFeatureSchema), async (c) => {
  const householdId = getHouseholdId(c);
  const data = c.req.valid('json');
  const service = new MaintenanceSuggestionService(c.env, c.env.DB, c.get('userId'));

  const feature = await service.createHomeFeature(householdId, data);

  // Generate suggestions for this new feature
  await service.generateSuggestionsForHousehold(householdId);

  return c.json({ feature }, 201);
});

/**
 * POST /households/:householdId/home-features/bulk
 * Bulk create home features (used after report extraction)
 */
homeFeatures.post('/bulk', zValidator('json', bulkCreateFeaturesSchema), async (c) => {
  const householdId = getHouseholdId(c);
  const { features } = c.req.valid('json');
  const service = new MaintenanceSuggestionService(c.env, c.env.DB, c.get('userId'));

  const result = await service.bulkCreateHomeFeatures(householdId, features);

  return c.json(result, 201);
});

/**
 * GET /households/:householdId/home-features/:id
 * Get a single home feature
 */
homeFeatures.get('/:id', async (c) => {
  const householdId = getHouseholdId(c);
  const featureId = c.req.param('id');
  const service = new MaintenanceSuggestionService(c.env, c.env.DB, c.get('userId'));

  const feature = await service.getHomeFeature(featureId!, householdId);

  if (!feature) {
    return c.json({ error: 'Feature not found' }, 404);
  }

  return c.json({ feature });
});

export default homeFeatures;

// Separate router for maintenance suggestions
export const maintenanceSuggestions = new Hono<{ Bindings: Env }>();

maintenanceSuggestions.use('/*', authMiddleware());

/**
 * GET /households/:householdId/maintenance-suggestions
 * List all pending maintenance suggestions
 */
maintenanceSuggestions.get('/', async (c) => {
  const householdId = getHouseholdId(c);
  const service = new MaintenanceSuggestionService(c.env, c.env.DB, c.get('userId'));

  const suggestions = await service.getSuggestions(householdId);

  return c.json({ suggestions });
});

/**
 * POST /households/:householdId/maintenance-suggestions/generate
 * Generate suggestions for all home features
 */
maintenanceSuggestions.post('/generate', async (c) => {
  const householdId = getHouseholdId(c);
  const service = new MaintenanceSuggestionService(c.env, c.env.DB, c.get('userId'));

  const result = await service.generateSuggestionsForHousehold(householdId);

  return c.json(result);
});

/**
 * POST /households/:householdId/maintenance-suggestions/apply
 * Apply selected suggestions as maintenance tasks
 */
maintenanceSuggestions.post('/apply', zValidator('json', applySuggestionsSchema), async (c) => {
  const householdId = getHouseholdId(c);
  const { suggestion_ids } = c.req.valid('json');
  const service = new MaintenanceSuggestionService(c.env, c.env.DB, c.get('userId'));

  const result = await service.applySuggestions(householdId, suggestion_ids);

  return c.json(result);
});

/**
 * POST /households/:householdId/maintenance-suggestions/:id/dismiss
 * Dismiss a suggestion
 */
maintenanceSuggestions.post('/:id/dismiss', zValidator('json', dismissSuggestionSchema), async (c) => {
  const householdId = getHouseholdId(c);
  const suggestionId = c.req.param('id');
  const { reason } = c.req.valid('json');
  const service = new MaintenanceSuggestionService(c.env, c.env.DB, c.get('userId'));

  await service.dismissSuggestion(suggestionId!, householdId, reason);

  return c.json({ success: true });
});
