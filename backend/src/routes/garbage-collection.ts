import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { requireAIEntitlement } from '../middleware/require-ai-entitlement';
import { GarbageCollectionService } from '../services/garbage-collection-service';
import { GarbageScheduleAIService } from '../services/garbage-schedule-ai-service';
import { HouseholdService } from '../services/household-service';
import { MunicipalityService } from '../services/municipality-service';
import type { Env } from '../types';

const garbageCollection = new Hono<{ Bindings: Env }>();

// Public routes (municipalities)
const municipalities = new Hono<{ Bindings: Env }>();

/**
 * GET /municipalities
 * List all municipalities (public endpoint for selection)
 */
municipalities.get('/', async (c) => {
  const service = new MunicipalityService(c.env, c.env.DB);

  const municipalities = await service.listMunicipalities();

  return c.json({ municipalities });
});

/**
 * GET /municipalities/:name
 * Get municipality configuration by name
 */
municipalities.get('/:name', async (c) => {
  const name = c.req.param('name');

  // Capitalize each word for case-insensitive lookup (e.g., "north vancouver" -> "North Vancouver")
  const capitalizedName = name
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

  const service = new MunicipalityService(c.env, c.env.DB);

  const municipality = await service.getMunicipalityByName(capitalizedName);

  if (!municipality) {
    return c.json({ error: { code: 'not_found', message: 'Municipality not found' } }, 404);
  }

  return c.json({ municipality });
});

/**
 * GET /municipalities/:name/waste-regulations
 * Get waste regulations for a municipality
 */
municipalities.get('/:name/waste-regulations', async (c) => {
  const name = c.req.param('name');

  // Capitalize each word for case-insensitive lookup
  const capitalizedName = name
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

  const service = new MunicipalityService(c.env, c.env.DB);

  const municipality = await service.getMunicipalityByName(capitalizedName);

  if (!municipality) {
    return c.json({ error: { code: 'not_found', message: 'Municipality not found' } }, 404);
  }

  return c.json({
    regulations: municipality.waste_regulations || {
      garbage: [],
      recycling: [],
      organics: [],
    },
  });
});

// Household-specific routes require authentication
garbageCollection.use('/*', authMiddleware());

// Helper to get householdId from parent route param
function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

// Validation schemas
const scheduleSchema = z.object({
  type: z.enum(['garbage', 'recycling', 'organics', 'yardWaste', 'bulkItem']),
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'seasonal', 'on-request']),
  dayOfWeek: z.number().min(0).max(6).optional(),
  week: z.enum(['A', 'B']).optional(),
  weekOfMonth: z.array(z.number().min(1).max(5)).optional(),
  seasonStart: z.object({ month: z.number(), day: z.number() }).optional(),
  seasonEnd: z.object({ month: z.number(), day: z.number() }).optional(),
});

const createGarbageScheduleSchema = z.object({
  municipality: z.string(),
  schedules: z.array(scheduleSchema),
  set_out_time: z.string().optional(),
  collection_start_time: z.string().optional(),
  remove_by_time: z.string().optional(),
  holiday_shifts: z.array(z.object({
    holiday: z.string(),
    date: z.string(),
    shiftDays: z.number(),
    affectedDays: z.array(z.number()),
  })).optional(),
  reminders: z.object({
    nightBefore: z.object({ enabled: z.boolean(), time: z.string() }),
    morningOf: z.object({ enabled: z.boolean(), time: z.string() }),
  }).optional(),
  source: z.enum(['municipal_api', 'manual', 'scraped']).optional(),
});

const updateGarbageScheduleSchema = createGarbageScheduleSchema.partial();

const customReminderSchema = z.object({
  id: z.string(),
  type: z.enum(['evening_before', 'morning_of', 'custom']),
  time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/), // HH:MM format
  daysOffset: z.number().min(-7).max(0),
  label: z.string().min(1).max(50),
  enabled: z.boolean(),
});

const updateRemindersSchema = z.object({
  reminders: z.array(customReminderSchema),
});

/**
 * GET /households/:householdId/garbage-collection
 * Get or create garbage collection schedule for a household
 */
garbageCollection.get('/', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const service = new GarbageCollectionService(c.env, c.env.DB);

  const schedule = await service.getOrCreateSchedule(householdId, userId);

  return c.json({ schedule });
});

/**
 * POST /households/:householdId/garbage-collection
 * Create a new garbage collection schedule
 */
garbageCollection.post('/', zValidator('json', createGarbageScheduleSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const service = new GarbageCollectionService(c.env, c.env.DB);

  const schedule = await service.createSchedule(householdId, userId, input);

  return c.json({ schedule }, 201);
});

/**
 * POST /households/:householdId/garbage-collection/ai-detect
 * Use AI + web search to detect a collection schedule from the household's
 * address. Returns a DRAFT only — the client reviews it and then POSTs to
 * create the schedule. Falls back to manual entry when nothing is found.
 */
garbageCollection.post('/ai-detect', requireAIEntitlement(), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);

  const householdService = new HouseholdService(c.env, c.env.DB);
  const household = await householdService.getHousehold(householdId, userId);

  if (!household.city) {
    return c.json(
      {
        error: {
          code: 'address_required',
          message: 'Add your home address (at least a city) before detecting a schedule.',
        },
      },
      400
    );
  }

  const aiService = new GarbageScheduleAIService(c.env, userId);

  try {
    const { data } = await aiService.detectFromAddress({
      address_line1: household.address_line1,
      address_line2: household.address_line2,
      city: household.city,
      state_province: household.state_province,
      postal_code: household.postal_code,
      country: household.country,
    });

    return c.json({ draft: data });
  } catch (error) {
    console.error('[GARBAGE-AI] Detection failed:', error);
    return c.json(
      {
        error: {
          code: 'detection_failed',
          message: 'Could not detect a schedule automatically. You can set it up manually.',
        },
      },
      502
    );
  }
});

/**
 * GET /households/:householdId/garbage-collection/:id/next-collections
 * Get next collection dates
 * Note: More specific route must come before /:id
 */
garbageCollection.get('/:id/next-collections', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const scheduleId = c.req.param('id');
  const daysParam = c.req.query('days') || '30';
  const daysAhead = Math.max(1, Math.min(365, parseInt(daysParam, 10) || 30)); // Clamp between 1-365
  const service = new GarbageCollectionService(c.env, c.env.DB);

  const dates = await service.getNextCollectionDates(householdId, scheduleId, userId, daysAhead);

  return c.json({ dates });
});

/**
 * GET /households/:householdId/garbage-collection/:id
 * Get a specific garbage collection schedule
 */
garbageCollection.get('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const scheduleId = c.req.param('id');
  const service = new GarbageCollectionService(c.env, c.env.DB);

  const schedule = await service.getSchedule(householdId, scheduleId, userId);

  return c.json({ schedule });
});

/**
 * PATCH /households/:householdId/garbage-collection/:id
 * Update a garbage collection schedule
 */
garbageCollection.patch('/:id', zValidator('json', updateGarbageScheduleSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const scheduleId = c.req.param('id');
  const input = c.req.valid('json');
  const service = new GarbageCollectionService(c.env, c.env.DB);

  const schedule = await service.updateSchedule(householdId, scheduleId, userId, input);

  return c.json({ schedule });
});

/**
 * PATCH /households/:householdId/garbage-collection/:id/reminders
 * Update custom reminders for a garbage collection schedule
 */
garbageCollection.patch('/:id/reminders', zValidator('json', updateRemindersSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const scheduleId = c.req.param('id');
  const { reminders } = c.req.valid('json');
  const service = new GarbageCollectionService(c.env, c.env.DB);

  const schedule = await service.updateReminders(householdId, scheduleId, userId, reminders);

  return c.json({ schedule });
});

export default garbageCollection;
export { municipalities as municipalityRoutes };
