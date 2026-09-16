import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { CalendarExportService } from '../services/calendar-export-service';
import type { Env } from '../types';

const calendar = new Hono<{ Bindings: Env }>();

// ============ VALIDATION SCHEMAS ============

const createSubscribeTokenSchema = z.object({
  name: z.string().max(100).optional(),
  include_tasks: z.boolean().optional().default(true),
  include_appointments: z.boolean().optional().default(true),
  include_garbage: z.boolean().optional().default(true),
  household_id: z.string().uuid().optional(),
});

const updateCalendarSettingsSchema = z.object({
  default_calendar_type: z.enum(['apple', 'google', 'device']).optional().nullable(),
  default_calendar_id: z.string().optional().nullable(),
  default_calendar_name: z.string().max(100).optional().nullable(),
  auto_sync_tasks: z.boolean().optional(),
  auto_sync_appointments: z.boolean().optional(),
  auto_sync_garbage: z.boolean().optional(),
  sync_task_due_date: z.boolean().optional(),
  sync_task_reminder: z.boolean().optional(),
  task_event_duration_minutes: z.number().int().min(15).max(480).optional(),
  task_event_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
  appointment_event_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
  garbage_event_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
});

// ============ PUBLIC ROUTES (No auth required) ============

/**
 * GET /calendar/ical/:token.ics
 * Public iCal feed endpoint - authenticated via token in URL
 * This is called by calendar apps when subscribing
 */
calendar.get('/ical/:token', async (c) => {
  try {
    let token = c.req.param('token');
    
    // Remove .ics extension if present
    if (token.endsWith('.ics')) {
      token = token.slice(0, -4);
    }

    const calendarService = new CalendarExportService(c.env, c.env.DB);
    const icalContent = await calendarService.generateICalFeed(token);

    return new Response(icalContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="simplehouse.ics"',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (error) {
    console.error('[calendar] iCal generation error:', error);
    
    if ((error as Error).message?.includes('Invalid calendar token')) {
      return c.text('Invalid or expired calendar token', 404);
    }
    
    return c.text('Calendar feed unavailable', 500);
  }
});

// ============ AUTHENTICATED ROUTES ============

// All routes below require authentication
calendar.use('/subscribe/*', authMiddleware());
calendar.use('/settings', authMiddleware());
calendar.use('/settings/*', authMiddleware());

/**
 * POST /calendar/subscribe
 * Create a new calendar subscribe URL
 */
calendar.post('/subscribe', zValidator('json', createSubscribeTokenSchema), async (c) => {
  const userId = c.get('userId');
  const input = c.req.valid('json');
  const calendarService = new CalendarExportService(c.env, c.env.DB);

  const result = await calendarService.createSubscribeToken(userId, {
    name: input.name,
    includeTasks: input.include_tasks,
    includeAppointments: input.include_appointments,
    includeGarbage: input.include_garbage,
    householdId: input.household_id,
  });

  return c.json({
    token: result.token,
    subscribe_url: result.subscribeUrl,
    webcal_url: result.subscribeUrl.replace('https://', 'webcal://'),
    google_calendar_url: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(result.subscribeUrl)}`,
  }, 201);
});

/**
 * GET /calendar/subscribe/tokens
 * Get all subscribe tokens for the current user
 */
calendar.get('/subscribe/tokens', async (c) => {
  const userId = c.get('userId');
  const calendarService = new CalendarExportService(c.env, c.env.DB);

  const tokens = await calendarService.getSubscribeTokens(userId);

  return c.json({
    tokens: tokens.map((t) => ({
      id: t.id,
      name: t.name,
      subscribe_url: `${c.env.API_URL}/calendar/ical/${t.token}.ics`,
      webcal_url: `${c.env.API_URL}/calendar/ical/${t.token}.ics`.replace('https://', 'webcal://'),
      includes_tasks: t.includes_tasks,
      includes_appointments: t.includes_appointments,
      includes_garbage: t.includes_garbage,
      household_id: t.household_id,
      last_accessed_at: t.last_accessed_at,
      access_count: t.access_count,
      created_at: t.created_at,
    })),
  });
});

/**
 * DELETE /calendar/subscribe/tokens/:tokenId
 * Delete a subscribe token
 */
calendar.delete('/subscribe/tokens/:tokenId', async (c) => {
  const userId = c.get('userId');
  const tokenId = c.req.param('tokenId');
  const calendarService = new CalendarExportService(c.env, c.env.DB);

  await calendarService.deleteSubscribeToken(userId, tokenId);

  return c.body(null, 204);
});

/**
 * GET /calendar/settings
 * Get user's calendar sync settings
 */
calendar.get('/settings', async (c) => {
  const userId = c.get('userId');
  const calendarService = new CalendarExportService(c.env, c.env.DB);

  const settings = await calendarService.getCalendarSettings(userId);

  return c.json({
    settings: settings || {
      default_calendar_type: null,
      default_calendar_id: null,
      default_calendar_name: null,
      auto_sync_tasks: false,
      auto_sync_appointments: false,
      auto_sync_garbage: false,
      sync_task_due_date: true,
      sync_task_reminder: true,
      task_event_duration_minutes: 60,
      task_event_color: null,
      appointment_event_color: null,
      garbage_event_color: null,
    },
  });
});

/**
 * PUT /calendar/settings
 * Update user's calendar sync settings
 */
calendar.put('/settings', zValidator('json', updateCalendarSettingsSchema), async (c) => {
  const userId = c.get('userId');
  const input = c.req.valid('json');
  const calendarService = new CalendarExportService(c.env, c.env.DB);

  const settings = await calendarService.updateCalendarSettings(userId, input);

  return c.json({ settings });
});

/**
 * GET /calendar/export/ical
 * Generate and download iCal file (one-time export, requires auth)
 */
calendar.get('/export/ical', authMiddleware(), async (c) => {
  const userId = c.get('userId');
  const includeTasks = c.req.query('tasks') !== 'false';
  const includeAppointments = c.req.query('appointments') !== 'false';
  const includeGarbage = c.req.query('garbage') !== 'false';
  const householdId = c.req.query('household_id');

  const calendarService = new CalendarExportService(c.env, c.env.DB);

  // Create a temporary token for this export
  const result = await calendarService.createSubscribeToken(userId, {
    name: 'Export',
    includeTasks,
    includeAppointments,
    includeGarbage,
    householdId,
  });

  // Generate the iCal content
  const icalContent = await calendarService.generateICalFeed(result.token);

  // Delete the temporary token
  const tokens = await calendarService.getSubscribeTokens(userId);
  const tempToken = tokens.find((t) => t.token === result.token);
  if (tempToken) {
    await calendarService.deleteSubscribeToken(userId, tempToken.id);
  }

  return new Response(icalContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="simplehouse-export.ics"',
    },
  });
});

export default calendar;
