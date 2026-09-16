import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { APPOINTMENT_TYPES, APPOINTMENT_STATUSES } from '../db/schema-labor-hub';
import { authMiddleware } from '../middleware/auth';
import { AppointmentService } from '../services/appointment-service';
import type { Env } from '../types';

const appointmentsRouter = new Hono<{ Bindings: Env }>();

// All routes require authentication
appointmentsRouter.use('/*', authMiddleware());

// Helper to get householdId from parent route param
function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

// ============ VALIDATION SCHEMAS ============

const createAppointmentSchema = z.object({
  contractor_id: z.string().uuid(),
  type: z.enum(APPOINTMENT_TYPES),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  scheduled_date: z.string(), // ISO date format
  scheduled_time_start: z.string().optional(),
  scheduled_time_end: z.string().optional(),
  location: z.string().max(200).optional(),
  estimated_duration_minutes: z.number().int().min(0).optional(),
  notes: z.string().max(2000).optional(),
  // Optional links
  linked_quote_id: z.string().uuid().optional(),
  linked_report_id: z.string().uuid().optional(),
  linked_task_id: z.string().uuid().optional(),
  linked_project_id: z.string().uuid().optional(),
});

const updateAppointmentSchema = z.object({
  type: z.enum(APPOINTMENT_TYPES).optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  scheduled_date: z.string().optional(),
  scheduled_time_start: z.string().optional(),
  scheduled_time_end: z.string().optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  location: z.string().max(200).optional(),
  estimated_duration_minutes: z.number().int().min(0).optional(),
  actual_arrival_time: z.string().optional(),
  actual_departure_time: z.string().optional(),
  notes: z.string().max(2000).optional(),
  calendar_event_id: z.string().max(500).optional(),
  linked_quote_id: z.string().uuid().optional(),
  linked_report_id: z.string().uuid().optional(),
  linked_task_id: z.string().uuid().optional(),
  linked_project_id: z.string().uuid().optional(),
});

const appointmentFiltersSchema = z.object({
  contractor_id: z.string().uuid().optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  type: z.enum(APPOINTMENT_TYPES).optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  upcoming_only: z.coerce.boolean().optional(),
});

const rescheduleSchema = z.object({
  scheduled_date: z.string(),
  scheduled_time_start: z.string().optional(),
  scheduled_time_end: z.string().optional(),
  reason: z.string().max(500).optional(),
});

// ============ APPOINTMENT ROUTES ============

/**
 * GET /households/:householdId/appointments
 * List all appointments
 */
appointmentsRouter.get('/', zValidator('query', appointmentFiltersSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const filters = c.req.valid('query');
  const service = new AppointmentService(c.env, c.env.DB);

  const appointments = await service.getAppointments(householdId, userId, {
    contractorId: filters.contractor_id,
    status: filters.status,
    type: filters.type,
    startDate: filters.start_date,
    endDate: filters.end_date,
    upcomingOnly: filters.upcoming_only,
  });

  return c.json({ appointments });
});

/**
 * GET /households/:householdId/appointments/upcoming
 * Get upcoming appointments (convenience endpoint)
 */
appointmentsRouter.get('/upcoming', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const service = new AppointmentService(c.env, c.env.DB);

  const appointments = await service.getUpcomingAppointments(householdId, userId, 30); // Next 30 days

  return c.json({ appointments });
});

/**
 * GET /households/:householdId/appointments/calendar
 * Get appointments for calendar view (grouped by date)
 */
appointmentsRouter.get('/calendar', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const month = c.req.query('month'); // YYYY-MM format
  const service = new AppointmentService(c.env, c.env.DB);

  const appointments = await service.getAppointmentsForCalendar(householdId, userId, month);

  return c.json({ appointments });
});

/**
 * GET /households/:householdId/appointments/:id
 * Get appointment detail
 */
appointmentsRouter.get('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const appointmentId = c.req.param('id');
  const service = new AppointmentService(c.env, c.env.DB);

  const appointment = await service.getAppointment(householdId, appointmentId!, userId);

  return c.json({ appointment });
});

/**
 * POST /households/:householdId/appointments
 * Create appointment
 */
appointmentsRouter.post('/', zValidator('json', createAppointmentSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const service = new AppointmentService(c.env, c.env.DB);

  const appointment = await service.createAppointment(householdId, userId, {
    contractorId: input.contractor_id,
    type: input.type,
    title: input.title,
    description: input.description,
    scheduledDate: input.scheduled_date,
    scheduledTimeStart: input.scheduled_time_start,
    scheduledTimeEnd: input.scheduled_time_end,
    location: input.location,
    estimatedDurationMinutes: input.estimated_duration_minutes,
    notes: input.notes,
    linkedQuoteId: input.linked_quote_id,
    linkedReportId: input.linked_report_id,
    linkedTaskId: input.linked_task_id,
    linkedProjectId: input.linked_project_id,
  });

  return c.json({ appointment }, 201);
});

/**
 * PATCH /households/:householdId/appointments/:id
 * Update appointment
 */
appointmentsRouter.patch('/:id', zValidator('json', updateAppointmentSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const appointmentId = c.req.param('id');
  const input = c.req.valid('json');
  const service = new AppointmentService(c.env, c.env.DB);

  const appointment = await service.updateAppointment(householdId, appointmentId!, userId, {
    type: input.type,
    title: input.title,
    description: input.description,
    scheduledDate: input.scheduled_date,
    scheduledTimeStart: input.scheduled_time_start,
    scheduledTimeEnd: input.scheduled_time_end,
    status: input.status,
    location: input.location,
    estimatedDurationMinutes: input.estimated_duration_minutes,
    actualArrivalTime: input.actual_arrival_time,
    actualDepartureTime: input.actual_departure_time,
    notes: input.notes,
    calendarEventId: input.calendar_event_id,
    linkedQuoteId: input.linked_quote_id,
    linkedReportId: input.linked_report_id,
    linkedTaskId: input.linked_task_id,
    linkedProjectId: input.linked_project_id,
  });

  return c.json({ appointment });
});

/**
 * DELETE /households/:householdId/appointments/:id
 * Delete appointment
 */
appointmentsRouter.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const appointmentId = c.req.param('id');
  const service = new AppointmentService(c.env, c.env.DB);

  await service.deleteAppointment(householdId, appointmentId!, userId);

  return c.body(null, 204);
});

// ============ STATUS TRANSITION ROUTES ============

/**
 * POST /households/:householdId/appointments/:id/confirm
 * Confirm an appointment
 */
appointmentsRouter.post('/:id/confirm', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const appointmentId = c.req.param('id');
  const service = new AppointmentService(c.env, c.env.DB);

  const appointment = await service.confirmAppointment(householdId, appointmentId!, userId);

  return c.json({ appointment });
});

/**
 * POST /households/:householdId/appointments/:id/cancel
 * Cancel an appointment
 */
appointmentsRouter.post('/:id/cancel', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const appointmentId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const reason = body.reason as string | undefined;
  const service = new AppointmentService(c.env, c.env.DB);

  const appointment = await service.cancelAppointment(householdId, appointmentId!, userId, reason);

  return c.json({ appointment });
});

/**
 * POST /households/:householdId/appointments/:id/reschedule
 * Reschedule an appointment
 */
appointmentsRouter.post('/:id/reschedule', zValidator('json', rescheduleSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const appointmentId = c.req.param('id');
  const input = c.req.valid('json');
  const service = new AppointmentService(c.env, c.env.DB);

  const appointment = await service.rescheduleAppointment(householdId, appointmentId!, userId, {
    scheduledDate: input.scheduled_date,
    scheduledTimeStart: input.scheduled_time_start,
    scheduledTimeEnd: input.scheduled_time_end,
    reason: input.reason,
  });

  return c.json({ appointment });
});

/**
 * POST /households/:householdId/appointments/:id/start
 * Mark appointment as in progress (contractor arrived)
 */
appointmentsRouter.post('/:id/start', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const appointmentId = c.req.param('id');
  const service = new AppointmentService(c.env, c.env.DB);

  const appointment = await service.startAppointment(householdId, appointmentId!, userId);

  return c.json({ appointment });
});

/**
 * POST /households/:householdId/appointments/:id/complete
 * Mark appointment as completed
 */
appointmentsRouter.post('/:id/complete', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const appointmentId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const notes = body.notes as string | undefined;
  const service = new AppointmentService(c.env, c.env.DB);

  const appointment = await service.completeAppointment(householdId, appointmentId!, userId, notes);

  return c.json({ appointment });
});

/**
 * POST /households/:householdId/appointments/:id/no-show
 * Mark appointment as no-show
 */
appointmentsRouter.post('/:id/no-show', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const appointmentId = c.req.param('id');
  const service = new AppointmentService(c.env, c.env.DB);

  const appointment = await service.markNoShow(householdId, appointmentId!, userId);

  return c.json({ appointment });
});

export default appointmentsRouter;
