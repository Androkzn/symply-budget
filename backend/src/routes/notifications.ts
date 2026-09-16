import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { NotificationOverrideService } from '../services/notification-override-service';
import { NotificationService } from '../services/notification-service';
import type { Env } from '../types';
import { SYSTEM_CATEGORIES } from '../types';

const notifications = new Hono<{ Bindings: Env }>();

// All routes require authentication
notifications.use('/*', authMiddleware());

// Validation schemas
const registerTokenSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(['ios', 'android', 'web']),
  device_name: z.string().optional(),
});

const updatePreferencesSchema = z.object({
  push_enabled: z.boolean().optional(),
  email_enabled: z.boolean().optional(),
  quiet_hours_start: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  quiet_hours_end: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  timezone: z.string().optional(),
  task_reminders: z.boolean().optional(),
  task_overdue: z.boolean().optional(),
  task_assigned: z.boolean().optional(),
  task_completed: z.boolean().optional(),
  household_updates: z.boolean().optional(),
  report_ready: z.boolean().optional(),
  weekly_summary: z.boolean().optional(),
  garbage_collection: z.boolean().optional(),
  task_drafts_ready: z.boolean().optional(),
  critical_findings: z.boolean().optional(),
  maintenance_suggestions: z.boolean().optional(),
});

const historyQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
  unread_only: z.coerce.boolean().default(false),
});

/**
 * POST /notifications/tokens
 * Register a push notification token
 */
notifications.post('/tokens', zValidator('json', registerTokenSchema), async (c) => {
  const userId = c.get('userId');
  const { token, platform, device_name } = c.req.valid('json');
  const notificationService = new NotificationService(c.env, c.env.DB);

  const result = await notificationService.registerPushToken(userId, token, platform, device_name);

  return c.json({ token: result }, 201);
});

/**
 * DELETE /notifications/tokens
 * Unregister a push notification token
 */
notifications.delete('/tokens', zValidator('json', z.object({ token: z.string() })), async (c) => {
  const userId = c.get('userId');
  const { token } = c.req.valid('json');
  const notificationService = new NotificationService(c.env, c.env.DB);

  await notificationService.unregisterPushToken(userId, token);

  return c.body(null, 204);
});

/**
 * GET /notifications/tokens
 * Get user's registered push tokens
 */
notifications.get('/tokens', async (c) => {
  const userId = c.get('userId');
  const notificationService = new NotificationService(c.env, c.env.DB);

  const tokens = await notificationService.getUserTokens(userId);

  return c.json({ tokens });
});

/**
 * GET /notifications/preferences
 * Get user's notification preferences
 */
notifications.get('/preferences', async (c) => {
  const userId = c.get('userId');
  const notificationService = new NotificationService(c.env, c.env.DB);

  const preferences = await notificationService.getPreferences(userId);

  return c.json({ preferences });
});

/**
 * PATCH /notifications/preferences
 * Update user's notification preferences
 */
notifications.patch('/preferences', zValidator('json', updatePreferencesSchema), async (c) => {
  const userId = c.get('userId');
  const updates = c.req.valid('json');
  const notificationService = new NotificationService(c.env, c.env.DB);

  const preferences = await notificationService.updatePreferences(userId, updates);

  return c.json({ preferences });
});

/**
 * GET /notifications/history
 * Get notification history
 */
notifications.get('/history', zValidator('query', historyQuerySchema), async (c) => {
  const userId = c.get('userId');
  const { limit, cursor, unread_only } = c.req.valid('query');
  const notificationService = new NotificationService(c.env, c.env.DB);

  const result = await notificationService.getNotificationHistory(userId, {
    limit,
    cursor,
    unreadOnly: unread_only,
  });

  return c.json(result);
});

/**
 * GET /notifications/unread-count
 * Get count of unread notifications
 */
notifications.get('/unread-count', async (c) => {
  const userId = c.get('userId');
  const notificationService = new NotificationService(c.env, c.env.DB);

  const count = await notificationService.getUnreadCount(userId);

  return c.json({ count });
});

/**
 * POST /notifications/:id/read
 * Mark a notification as read
 */
notifications.post('/:id/read', async (c) => {
  const userId = c.get('userId');
  const notificationId = c.req.param('id');
  const notificationService = new NotificationService(c.env, c.env.DB);

  await notificationService.markAsRead(userId, notificationId);

  return c.json({ success: true });
});

/**
 * POST /notifications/read-all
 * Mark all notifications as read
 */
notifications.post('/read-all', async (c) => {
  const userId = c.get('userId');
  const notificationService = new NotificationService(c.env, c.env.DB);

  await notificationService.markAllAsRead(userId);

  return c.json({ success: true });
});

/**
 * POST /notifications/delete-all
 * Delete all notifications from history
 */
notifications.post('/delete-all', async (c) => {
  const userId = c.get('userId');
  const notificationService = new NotificationService(c.env, c.env.DB);

  await notificationService.deleteAllNotifications(userId);

  return c.json({ success: true });
});

/**
 * DELETE /notifications/join-request/:requestId
 * Remove owner join-request alerts for a handled request (current user only).
 */
notifications.delete('/join-request/:requestId', async (c) => {
  const userId = c.get('userId');
  const requestId = c.req.param('requestId');
  const notificationService = new NotificationService(c.env, c.env.DB);

  await notificationService.deleteJoinRequestReceivedNotificationsForUser(userId, requestId);

  return c.body(null, 204);
});

/**
 * DELETE /notifications/:id
 * Delete a notification from history
 */
notifications.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const notificationId = c.req.param('id');
  const notificationService = new NotificationService(c.env, c.env.DB);

  await notificationService.deleteNotification(userId, notificationId);

  return c.body(null, 204);
});

// ============ NOTIFICATION OVERRIDES ============

const overrideTargetTypes = ['task', 'space', 'category', 'appliance'] as const;

const createOverrideSchema = z.object({
  target_type: z.enum(overrideTargetTypes),
  target_id: z.string().uuid().optional(),
  category: z.enum(SYSTEM_CATEGORIES).optional(),
  enabled: z.boolean().optional().nullable(),
  reminder_days_before: z.number().int().min(0).max(365).optional().nullable(),
  reminder_time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional().nullable(),
  reminder_repeat: z.boolean().optional().nullable(),
  sync_to_calendar: z.boolean().optional(),
  calendar_id: z.string().optional().nullable(),
});

const updateOverrideSchema = createOverrideSchema.partial().omit({
  target_type: true,
  target_id: true,
  category: true,
});

/**
 * GET /notifications/overrides
 * Get all notification overrides for the user
 */
notifications.get('/overrides', async (c) => {
  const userId = c.get('userId');
  const targetType = c.req.query('target_type') as any;
  const category = c.req.query('category');
  
  const overrideService = new NotificationOverrideService(c.env, c.env.DB);
  const overrides = await overrideService.getOverrides(userId, {
    targetType,
    category,
  });

  return c.json({ overrides });
});

/**
 * POST /notifications/overrides
 * Create a new notification override
 */
notifications.post('/overrides', zValidator('json', createOverrideSchema), async (c) => {
  const userId = c.get('userId');
  const input = c.req.valid('json');
  
  const overrideService = new NotificationOverrideService(c.env, c.env.DB);
  const override = await overrideService.createOverride(userId, {
    targetType: input.target_type,
    targetId: input.target_id,
    category: input.category,
    enabled: input.enabled ?? undefined,
    reminderDaysBefore: input.reminder_days_before ?? undefined,
    reminderTime: input.reminder_time ?? undefined,
    reminderRepeat: input.reminder_repeat ?? undefined,
    syncToCalendar: input.sync_to_calendar,
    calendarId: input.calendar_id ?? undefined,
  });

  return c.json({ override }, 201);
});

/**
 * GET /notifications/overrides/:id
 * Get a specific notification override
 */
notifications.get('/overrides/:id', async (c) => {
  const userId = c.get('userId');
  const overrideId = c.req.param('id');
  
  const overrideService = new NotificationOverrideService(c.env, c.env.DB);
  const override = await overrideService.getOverride(userId, overrideId);

  return c.json({ override });
});

/**
 * PATCH /notifications/overrides/:id
 * Update a notification override
 */
notifications.patch('/overrides/:id', zValidator('json', updateOverrideSchema), async (c) => {
  const userId = c.get('userId');
  const overrideId = c.req.param('id');
  const input = c.req.valid('json');
  
  const overrideService = new NotificationOverrideService(c.env, c.env.DB);
  const override = await overrideService.updateOverride(userId, overrideId, {
    enabled: input.enabled,
    reminderDaysBefore: input.reminder_days_before,
    reminderTime: input.reminder_time,
    reminderRepeat: input.reminder_repeat,
    syncToCalendar: input.sync_to_calendar,
    calendarId: input.calendar_id,
  });

  return c.json({ override });
});

/**
 * DELETE /notifications/overrides/:id
 * Delete a notification override
 */
notifications.delete('/overrides/:id', async (c) => {
  const userId = c.get('userId');
  const overrideId = c.req.param('id');
  
  const overrideService = new NotificationOverrideService(c.env, c.env.DB);
  await overrideService.deleteOverride(userId, overrideId);

  return c.body(null, 204);
});

/**
 * PUT /notifications/overrides/category/:category
 * Set or update override for a category
 */
notifications.put('/overrides/category/:category', zValidator('json', updateOverrideSchema), async (c) => {
  const userId = c.get('userId');
  const category = c.req.param('category');
  const input = c.req.valid('json');
  
  const overrideService = new NotificationOverrideService(c.env, c.env.DB);
  const override = await overrideService.setCategoryOverride(userId, category, {
    enabled: input.enabled ?? undefined,
    reminderDaysBefore: input.reminder_days_before ?? undefined,
    reminderTime: input.reminder_time ?? undefined,
    reminderRepeat: input.reminder_repeat ?? undefined,
    syncToCalendar: input.sync_to_calendar,
    calendarId: input.calendar_id ?? undefined,
  });

  return c.json({ override });
});

/**
 * PUT /notifications/overrides/space/:spaceId
 * Set or update override for a space
 */
notifications.put('/overrides/space/:spaceId', zValidator('json', updateOverrideSchema), async (c) => {
  const userId = c.get('userId');
  const spaceId = c.req.param('spaceId');
  const input = c.req.valid('json');
  
  const overrideService = new NotificationOverrideService(c.env, c.env.DB);
  const override = await overrideService.setSpaceOverride(userId, spaceId, {
    enabled: input.enabled ?? undefined,
    reminderDaysBefore: input.reminder_days_before ?? undefined,
    reminderTime: input.reminder_time ?? undefined,
    reminderRepeat: input.reminder_repeat ?? undefined,
    syncToCalendar: input.sync_to_calendar,
    calendarId: input.calendar_id ?? undefined,
  });

  return c.json({ override });
});

export default notifications;
