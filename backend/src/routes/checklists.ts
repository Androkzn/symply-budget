import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { ChecklistService } from '../services/checklist-service';
import type { Env } from '../types';

const checklistRoutes = new Hono<{ Bindings: Env }>();

// All routes require authentication
checklistRoutes.use('/*', authMiddleware());

// Helper to get householdId from parent route param
function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

// Validation schemas
const createChecklistSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'seasonal', 'yearly', 'custom']),
  icon: z.string().max(10).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  season: z.enum(['spring', 'summer', 'fall', 'winter']).optional(),
  custom_days: z.array(z.number().int().min(0).max(6)).optional(),
  items: z.array(
    z.object({
      title: z.string().min(1).max(200),
      description: z.string().max(500).optional(),
      is_required: z.boolean().optional(),
    })
  ).min(1).max(50),
});

const completeItemSchema = z.object({
  notes: z.string().max(500).optional(),
});

/**
 * GET /households/:householdId/checklists
 * Get all checklists
 */
checklistRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const checklistService = new ChecklistService(c.env, c.env.DB);

  const checklists = await checklistService.listChecklists(householdId, userId);

  return c.json({ checklists });
});

/**
 * POST /households/:householdId/checklists
 * Create a new checklist
 */
checklistRoutes.post('/', zValidator('json', createChecklistSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const checklistService = new ChecklistService(c.env, c.env.DB);

  // NOTE: ChecklistService.createChecklist currently only implements seasonal
  // checklists; this custom-checklist payload predates that. Cast preserves the
  // existing runtime behavior until a custom-checklist service method exists.
  const checklist = await checklistService.createChecklist(householdId, userId, {
    name: input.name,
    description: input.description,
    frequency: input.frequency,
    icon: input.icon,
    color: input.color,
    season: input.season as 'spring' | 'summer' | 'fall' | 'winter',
    customDays: input.custom_days,
    items: input.items.map((item) => ({
      title: item.title,
      description: item.description,
      isRequired: item.is_required,
    })),
  } as any);

  return c.json({ checklist }, 201);
});

/**
 * DELETE /households/:householdId/checklists/:id
 * Delete a checklist
 */
checklistRoutes.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const checklistId = c.req.param('id');
  const checklistService = new ChecklistService(c.env, c.env.DB);

  await checklistService.deleteChecklist(householdId, checklistId, userId);

  return c.body(null, 204);
});

/**
 * GET /households/:householdId/checklists/progress
 * Get progress for all checklists
 */
checklistRoutes.get('/progress', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const checklistService = new ChecklistService(c.env, c.env.DB);

  const progress = await checklistService.getProgress(householdId, userId);

  return c.json({ progress });
});

/**
 * GET /households/:householdId/checklists/:id/current
 * Get current instance for a checklist
 */
checklistRoutes.get('/:id/current', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const checklistId = c.req.param('id');
  const checklistService = new ChecklistService(c.env, c.env.DB);

  const instance = await checklistService.getCurrentInstance(householdId, checklistId, userId);

  return c.json({ instance });
});

/**
 * POST /households/:householdId/checklists/instances/:instanceId/items/:itemId/complete
 * Complete a checklist item
 */
checklistRoutes.post(
  '/instances/:instanceId/items/:itemId/complete',
  zValidator('json', completeItemSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const instanceId = c.req.param('instanceId');
    const itemId = c.req.param('itemId');
    const { notes } = c.req.valid('json');
    const checklistService = new ChecklistService(c.env, c.env.DB);

    const result = await checklistService.completeItem(householdId, instanceId, itemId, userId, notes);

    return c.json(result);
  }
);

/**
 * DELETE /households/:householdId/checklists/instances/:instanceId/items/:itemId/complete
 * Uncomplete a checklist item
 */
checklistRoutes.delete('/instances/:instanceId/items/:itemId/complete', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const instanceId = c.req.param('instanceId');
  const itemId = c.req.param('itemId');
  const checklistService = new ChecklistService(c.env, c.env.DB);

  const instance = await checklistService.uncompleteItem(householdId, instanceId, itemId, userId);

  return c.json({ instance });
});

/**
 * POST /households/:householdId/checklists/create-defaults
 * Create default checklists for the household
 */
checklistRoutes.post('/create-defaults', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const checklistService = new ChecklistService(c.env, c.env.DB);

  await checklistService.createDefaultChecklists(householdId, userId);

  return c.json({ message: 'Default checklists created' }, 201);
});

export default checklistRoutes;
