/**
 * Notification preference tools — view + update the user's per-category
 * notification toggles (push, email, and each notification type).
 */
import { z } from 'zod';

import { NotificationService } from '../../../notification-service';
import type { AihousekeeperTool, AihousekeeperToolContext, ToolResult } from '../index';

function notifService(ctx: AihousekeeperToolContext): NotificationService {
  return new NotificationService(ctx.env, ctx.env.DB);
}

export const getNotificationPreferences: AihousekeeperTool = {
  name: 'get_notification_preferences',
  kind: 'READ',
  description:
    'Get the user\'s notification preferences: global push/email toggles, quiet hours, timezone, and per-category flags (task reminders, task overdue, assignments, reports, weekly summary, etc.).',
  input: z.object({}),
  async execute(ctx: AihousekeeperToolContext, _input): Promise<ToolResult> {
    const prefs = await notifService(ctx).getPreferences(ctx.userId);
    return {
      ok: true,
      preferences: {
        push_enabled: prefs.push_enabled,
        email_enabled: prefs.email_enabled,
        quiet_hours_start: prefs.quiet_hours_start,
        quiet_hours_end: prefs.quiet_hours_end,
        timezone: prefs.timezone,
        task_reminders: prefs.task_reminders,
        task_overdue: prefs.task_overdue,
        task_assigned: prefs.task_assigned,
        task_completed: prefs.task_completed,
        household_updates: prefs.household_updates,
        report_ready: prefs.report_ready,
        weekly_summary: prefs.weekly_summary,
        garbage_collection: prefs.garbage_collection,
        task_drafts_ready: prefs.task_drafts_ready,
        critical_findings: prefs.critical_findings,
        maintenance_suggestions: prefs.maintenance_suggestions,
      },
    };
  },
};

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'must be HH:MM');

export const updateNotificationPreferences: AihousekeeperTool = {
  name: 'update_notification_preferences',
  kind: 'LOW_WRITE',
  description:
    'Update one or more notification preference fields. Only pass fields the user wants to change. Use this when the user says things like "turn off task reminders", "stop emailing me the weekly summary", or "set quiet hours from 22:00 to 07:00".',
  input: z.object({
    push_enabled: z.boolean().optional(),
    email_enabled: z.boolean().optional(),
    quiet_hours_start: hhmm.nullable().optional(),
    quiet_hours_end: hhmm.nullable().optional(),
    timezone: z.string().max(80).optional(),
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
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    const updates = Object.fromEntries(
      Object.entries(input).filter(([, v]) => v !== undefined)
    );
    if (Object.keys(updates).length === 0) {
      return { ok: false, error: 'no_fields_provided' };
    }
    const updated = await notifService(ctx).updatePreferences(ctx.userId, updates);
    return {
      ok: true,
      updated_fields: Object.keys(updates),
      preferences: {
        push_enabled: updated.push_enabled,
        email_enabled: updated.email_enabled,
        task_reminders: updated.task_reminders,
        task_overdue: updated.task_overdue,
        weekly_summary: updated.weekly_summary,
      },
    };
  },
};

export const notificationPreferenceTools: readonly AihousekeeperTool[] = [
  getNotificationPreferences,
  updateNotificationPreferences,
] as const;
