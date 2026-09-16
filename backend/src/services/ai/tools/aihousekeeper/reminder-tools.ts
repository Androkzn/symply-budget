/**
 * Reminder-configuration tools.
 *
 * In SimpleHouse, reminders are not a separate domain — they're fields on
 * maintenance_tasks (reminder_enabled, reminder_days_before, reminder_time,
 * reminder_repeat). These tools let Aihousekeeper read and adjust those fields for
 * tasks the user references by title.
 *
 * Arbitrary "set a reminder for me in 2 hours" goes through
 * `schedule_self_followup` (followup-tools) — that's a different concept.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { tasks } from '../../../../db/schema';
import { nowIso } from '../../../../utils/id';
import type { AihousekeeperTool, AihousekeeperToolContext, ToolResult } from '../index';

export const listTaskReminders: AihousekeeperTool = {
  name: 'list_task_reminders',
  kind: 'READ',
  description:
    'List all household maintenance tasks with their reminder settings (enabled, days_before, time, repeat). Use before adjusting a reminder so you can find the target by title.',
  input: z.object({
    only_enabled: z.boolean().optional(),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    const rows = await ctx.db
      .select({
        id: tasks.id,
        title: tasks.title,
        next_due_date: tasks.next_due_date,
        reminder_enabled: tasks.reminder_enabled,
        reminder_days_before: tasks.reminder_days_before,
        reminder_time: tasks.reminder_time,
        reminder_repeat: tasks.reminder_repeat,
      })
      .from(tasks)
      .where(eq(tasks.household_id, ctx.householdId))
      .all();

    const filtered = input.only_enabled
      ? rows.filter((r) => r.reminder_enabled)
      : rows;

    return { ok: true, count: filtered.length, tasks: filtered };
  },
};

export const updateTaskReminder: AihousekeeperTool = {
  name: 'update_task_reminder',
  kind: 'LOW_WRITE',
  description:
    'Update reminder settings for a single maintenance task (turn reminder on/off, change days-before, time, or repeat). Resolve task_id from a title reference via list_maintenance_tasks or list_task_reminders first — never ask the user for an id.',
  input: z.object({
    task_id: z.string().min(1),
    enabled: z.boolean().optional(),
    days_before: z.number().int().min(0).max(30).optional(),
    time: z
      .string()
      .regex(/^\d{2}:\d{2}$/, 'time must be HH:MM')
      .optional(),
    repeat: z.boolean().optional(),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    const existing = await ctx.db
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .where(
        and(
          eq(tasks.id, input.task_id),
          eq(tasks.household_id, ctx.householdId)
        )
      )
      .get();

    if (!existing) {
      return { ok: false, error: 'task_not_found' };
    }

    const updates: Record<string, unknown> = {
      updated_at: nowIso(),
    };
    if (input.enabled !== undefined) updates.reminder_enabled = input.enabled;
    if (input.days_before !== undefined) updates.reminder_days_before = input.days_before;
    if (input.time !== undefined) updates.reminder_time = input.time;
    if (input.repeat !== undefined) updates.reminder_repeat = input.repeat;

    if (Object.keys(updates).length === 1) {
      return { ok: false, error: 'no_fields_provided' };
    }

    await ctx.db
      .update(tasks)
      .set(updates)
      .where(eq(tasks.id, input.task_id));

    return {
      ok: true,
      task_id: input.task_id,
      task_title: existing.title,
      updated: updates,
    };
  },
};

export const reminderTools: readonly AihousekeeperTool[] = [
  listTaskReminders,
  updateTaskReminder,
] as const;
