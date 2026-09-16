import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { RepresentativeService } from '../services/representative-service';
import type { Env } from '../types';

const representativesRouter = new Hono<{ Bindings: Env }>();

// All routes require authentication
representativesRouter.use('/*', authMiddleware());

// Helper to get params from parent route
function getParams(c: { req: { param: (key: string) => string | undefined } }): {
  householdId: string;
  contractorId: string;
} {
  const householdId = c.req.param('householdId');
  const contractorId = c.req.param('contractorId');
  if (!householdId) throw new Error('Household ID is required');
  if (!contractorId) throw new Error('Contractor ID is required');
  return { householdId, contractorId };
}

// ============ VALIDATION SCHEMAS ============

const createRepresentativeSchema = z.object({
  name: z.string().min(1).max(200),
  role: z.string().max(100).optional(),
  phone: z.string().max(50).optional(),
  email: z.string().email().max(200).optional(),
  is_primary: z.boolean().optional(),
  notes: z.string().max(1000).optional(),
  photo_url: z.string().url().max(500).optional(),
});

const updateRepresentativeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  role: z.string().max(100).optional(),
  phone: z.string().max(50).optional(),
  email: z.string().email().max(200).optional(),
  is_primary: z.boolean().optional(),
  notes: z.string().max(1000).optional(),
  photo_url: z.string().url().max(500).optional(),
});

// ============ REPRESENTATIVE ROUTES ============

/**
 * GET /households/:householdId/contractors/:contractorId/representatives
 * List all representatives for a contractor
 */
representativesRouter.get('/', async (c) => {
  const userId = c.get('userId');
  const { householdId, contractorId } = getParams(c);
  const service = new RepresentativeService(c.env, c.env.DB);

  const representatives = await service.getRepresentatives(householdId, contractorId, userId);

  return c.json({ representatives });
});

/**
 * GET /households/:householdId/contractors/:contractorId/representatives/:id
 * Get single representative
 */
representativesRouter.get('/:id', async (c) => {
  const userId = c.get('userId');
  const { householdId, contractorId } = getParams(c);
  const representativeId = c.req.param('id');
  const service = new RepresentativeService(c.env, c.env.DB);

  const representative = await service.getRepresentative(householdId, contractorId, representativeId!, userId);

  return c.json({ representative });
});

/**
 * POST /households/:householdId/contractors/:contractorId/representatives
 * Create representative
 */
representativesRouter.post('/', zValidator('json', createRepresentativeSchema), async (c) => {
  const userId = c.get('userId');
  const { householdId, contractorId } = getParams(c);
  const input = c.req.valid('json');
  const service = new RepresentativeService(c.env, c.env.DB);

  const representative = await service.createRepresentative(householdId, contractorId, userId, {
    name: input.name,
    role: input.role,
    phone: input.phone,
    email: input.email,
    isPrimary: input.is_primary,
    notes: input.notes,
    photoUrl: input.photo_url,
  });

  return c.json({ representative }, 201);
});

/**
 * PATCH /households/:householdId/contractors/:contractorId/representatives/:id
 * Update representative
 */
representativesRouter.patch('/:id', zValidator('json', updateRepresentativeSchema), async (c) => {
  const userId = c.get('userId');
  const { householdId, contractorId } = getParams(c);
  const representativeId = c.req.param('id');
  const input = c.req.valid('json');
  const service = new RepresentativeService(c.env, c.env.DB);

  const representative = await service.updateRepresentative(householdId, contractorId, representativeId!, userId, {
    name: input.name,
    role: input.role,
    phone: input.phone,
    email: input.email,
    isPrimary: input.is_primary,
    notes: input.notes,
    photoUrl: input.photo_url,
  });

  return c.json({ representative });
});

/**
 * DELETE /households/:householdId/contractors/:contractorId/representatives/:id
 * Delete representative
 */
representativesRouter.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const { householdId, contractorId } = getParams(c);
  const representativeId = c.req.param('id');
  const service = new RepresentativeService(c.env, c.env.DB);

  await service.deleteRepresentative(householdId, contractorId, representativeId!, userId);

  return c.body(null, 204);
});

/**
 * POST /households/:householdId/contractors/:contractorId/representatives/:id/set-primary
 * Set representative as primary contact
 */
representativesRouter.post('/:id/set-primary', async (c) => {
  const userId = c.get('userId');
  const { householdId, contractorId } = getParams(c);
  const representativeId = c.req.param('id');
  const service = new RepresentativeService(c.env, c.env.DB);

  const representative = await service.setPrimaryRepresentative(householdId, contractorId, representativeId!, userId);

  return c.json({ representative });
});

export default representativesRouter;
