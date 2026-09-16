import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { ApplianceService } from '../services/appliance-service';
import type { Env } from '../types';

const appliances = new Hono<{ Bindings: Env }>();

// All routes require authentication
appliances.use('/*', authMiddleware());

// Helper to get householdId from parent route param
function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

// Validation schemas
const warrantySchema = z.object({
  manufacturer: z.object({
    expiration: z.string(),
    coverage: z.string(),
  }).optional(),
  extended: z.object({
    provider: z.string(),
    expiration: z.string(),
    coverage: z.string(),
    claimPhone: z.string().optional(),
  }).optional(),
});

const createApplianceSchema = z.object({
  space_id: z.string().optional(),
  name: z.string().min(1),
  category: z.string().min(1),
  type: z.string().min(1),
  location: z.string().optional(),
  brand: z.string().optional(),
  model: z.string().optional(),
  serial_number: z.string().optional(),
  purchase_date: z.string().optional(),
  install_date: z.string().optional(),
  expected_lifespan: z.number().optional(),
  warranty: warrantySchema.optional(),
  purchase_cost: z.number().optional(),
});

const updateApplianceSchema = createApplianceSchema.partial();

const addDocumentSchema = z.object({
  type: z.enum(['receipt', 'warranty', 'manual', 'service_record', 'photo']),
  r2_key: z.string().min(1),
});

const addServiceHistorySchema = z.object({
  service_date: z.string(),
  description: z.string().min(1),
  cost: z.number().optional(),
  provider_id: z.string().optional(),
});

/**
 * GET /households/:householdId/appliances
 * List appliances for a household
 */
appliances.get('/', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const category = c.req.query('category');
  const space_id = c.req.query('space_id');
  const service = new ApplianceService(c.env, c.env.DB);

  const applianceList = await service.listAppliances(householdId, userId, {
    category: category || undefined,
    space_id: space_id || undefined,
  });

  return c.json({ appliances: applianceList });
});

/**
 * POST /households/:householdId/appliances
 * Create a new appliance
 */
appliances.post('/', zValidator('json', createApplianceSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const service = new ApplianceService(c.env, c.env.DB);

  const appliance = await service.createAppliance(householdId, userId, input);

  return c.json({ appliance }, 201);
});

/**
 * GET /households/:householdId/appliances/:id/documents
 * List documents for an appliance
 * Note: More specific route must come before /:id
 */
appliances.get('/:id/documents', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const applianceId = c.req.param('id');
  const service = new ApplianceService(c.env, c.env.DB);

  const documents = await service.listDocuments(householdId, applianceId, userId);

  return c.json({ documents });
});

/**
 * POST /households/:householdId/appliances/:id/documents
 * Add a document to an appliance
 * Note: More specific route must come before /:id
 */
appliances.post('/:id/documents', zValidator('json', addDocumentSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const applianceId = c.req.param('id');
  const input = c.req.valid('json');
  const service = new ApplianceService(c.env, c.env.DB);

  const document = await service.addDocument(householdId, applianceId, userId, input);

  return c.json({ document }, 201);
});

/**
 * GET /households/:householdId/appliances/:id/service-history
 * Get service history for an appliance
 * Note: More specific route must come before /:id
 */
appliances.get('/:id/service-history', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const applianceId = c.req.param('id');
  const service = new ApplianceService(c.env, c.env.DB);

  const history = await service.getServiceHistory(householdId, applianceId, userId);

  return c.json({ history });
});

/**
 * POST /households/:householdId/appliances/:id/service-history
 * Add a service history entry
 * Note: More specific route must come before /:id
 */
appliances.post('/:id/service-history', zValidator('json', addServiceHistorySchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const applianceId = c.req.param('id');
  const input = c.req.valid('json');
  const service = new ApplianceService(c.env, c.env.DB);

  const entry = await service.addServiceHistory(householdId, applianceId, userId, input);

  return c.json({ entry }, 201);
});

/**
 * GET /households/:householdId/appliances/:id
 * Get a single appliance
 */
appliances.get('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const applianceId = c.req.param('id');
  const service = new ApplianceService(c.env, c.env.DB);

  const appliance = await service.getAppliance(householdId, applianceId, userId);

  return c.json({ appliance });
});

/**
 * PATCH /households/:householdId/appliances/:id
 * Update an appliance
 */
appliances.patch('/:id', zValidator('json', updateApplianceSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const applianceId = c.req.param('id');
  const input = c.req.valid('json');
  const service = new ApplianceService(c.env, c.env.DB);

  const appliance = await service.updateAppliance(householdId, applianceId, userId, input);

  return c.json({ appliance });
});

/**
 * DELETE /households/:householdId/appliances/:id
 * Delete an appliance
 */
appliances.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const applianceId = c.req.param('id');
  const service = new ApplianceService(c.env, c.env.DB);

  await service.deleteAppliance(householdId, applianceId, userId);

  return c.body(null, 204);
});

export default appliances;
