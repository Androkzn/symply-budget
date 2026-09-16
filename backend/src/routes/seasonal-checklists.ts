import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { ChecklistService } from '../services/checklist-service';
import type { Env } from '../types';

const seasonalChecklists = new Hono<{ Bindings: Env }>();

// All routes require authentication
seasonalChecklists.use('/*', authMiddleware());

// Helper to get householdId from parent route param
function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

// Validation schemas
const createChecklistSchema = z.object({
  season: z.enum(['spring', 'summer', 'fall', 'winter']),
  year: z.number().int().min(2020).max(2100),
  climate_zone: z.string().default('pacific_northwest'),
});

const addItemSchema = z.object({
  task_template_id: z.string().optional(),
  title: z.string().min(1),
  category: z.string().optional(),
  sort_order: z.number().optional(),
});

const updateItemSchema = z.object({
  is_completed: z.boolean().optional(),
  notes: z.string().optional(),
  photo_keys: z.array(z.string()).optional(),
});

/**
 * GET /households/:householdId/seasonal-checklists
 * List seasonal checklists for a household
 */
seasonalChecklists.get('/', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const season = c.req.query('season') as 'spring' | 'summer' | 'fall' | 'winter' | undefined;
  const yearParam = c.req.query('year');
  const parsedYear = yearParam ? parseInt(yearParam, 10) : undefined;
  const year = parsedYear !== undefined && !isNaN(parsedYear)
    ? Math.max(2000, Math.min(2100, parsedYear))
    : undefined;
  const service = new ChecklistService(c.env, c.env.DB);

  const checklists = await service.listChecklists(householdId, userId, {
    season: season || undefined,
    year: year !== undefined ? year : undefined,
  });

  return c.json({ checklists });
});

/**
 * POST /households/:householdId/seasonal-checklists
 * Create a new seasonal checklist
 */
seasonalChecklists.post('/', zValidator('json', createChecklistSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const service = new ChecklistService(c.env, c.env.DB);

  const checklist = await service.createChecklist(householdId, userId, input);

  return c.json({ checklist }, 201);
});

/**
 * GET /households/:householdId/seasonal-checklists/current
 * Get or create checklist for current season
 */
seasonalChecklists.get('/current', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const season = c.req.query('season') as 'spring' | 'summer' | 'fall' | 'winter' | undefined;
  const yearParam = c.req.query('year') || String(new Date().getFullYear());
  const year = Math.max(2000, Math.min(2100, parseInt(yearParam, 10) || new Date().getFullYear())); // Clamp between 2000-2100
  const climateZone = c.req.query('climate_zone') || 'pacific_northwest';
  const service = new ChecklistService(c.env, c.env.DB);

  // Determine current season if not provided
  let currentSeason: 'spring' | 'summer' | 'fall' | 'winter' = season || 'spring';
  if (!season) {
    const month = new Date().getMonth() + 1; // 1-12
    if (month >= 3 && month <= 5) currentSeason = 'spring';
    else if (month >= 6 && month <= 8) currentSeason = 'summer';
    else if (month >= 9 && month <= 11) currentSeason = 'fall';
    else currentSeason = 'winter';
  }

  const checklist = await service.getOrCreateChecklist(householdId, userId, currentSeason, year, climateZone);

  return c.json({ checklist });
});

/**
 * POST /households/:householdId/seasonal-checklists/:id/items
 * Add an item to a checklist
 * Note: More specific route must come before /:id
 */
seasonalChecklists.post('/:id/items', zValidator('json', addItemSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const checklistId = c.req.param('id');
  const input = c.req.valid('json');
  const service = new ChecklistService(c.env, c.env.DB);

  const item = await service.addItem(householdId, checklistId, userId, input);

  return c.json({ item }, 201);
});

/**
 * PATCH /households/:householdId/seasonal-checklists/:checklistId/items/:itemId
 * Update a checklist item
 * Note: More specific route must come before /:id
 */
seasonalChecklists.patch('/:checklistId/items/:itemId', zValidator('json', updateItemSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const checklistId = c.req.param('checklistId');
  const itemId = c.req.param('itemId');
  const input = c.req.valid('json');
  const service = new ChecklistService(c.env, c.env.DB);

  const item = await service.updateItem(householdId, checklistId, itemId, userId, input);

  return c.json({ item });
});

/**
 * GET /households/:householdId/seasonal-checklists/:id
 * Get a single seasonal checklist
 */
seasonalChecklists.get('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const checklistId = c.req.param('id');
  const service = new ChecklistService(c.env, c.env.DB);

  const checklist = await service.getChecklist(householdId, checklistId, userId);

  return c.json({ checklist });
});

export default seasonalChecklists;
