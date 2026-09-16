/**
 * Aihousekeeper task tools.
 *
 * Full CRUD surface over maintenance tasks so the LLM can create, read,
 * update, reschedule, complete, snooze, and delete tasks on behalf of the
 * user. All writes go through `TaskService` so existing invariants
 * (household ACL, notification scheduling, subtask reset on recurrence) are
 * preserved.
 *
 * Scoped (in the registry) to: task_assistant, family_chat, morning_briefing.
 */
import { z } from 'zod';

import {
  SYSTEM_CATEGORIES,
  type TaskResponse,
  type SystemCategory,
  type TaskPrioritySeverity,
  type MaintenanceFrequency,
} from '../../../../types';
import { TaskPlannerService } from '../../../task-planner-service';
import { TaskService } from '../../../task-service';
import type { AihousekeeperTool, AihousekeeperToolContext, ToolResult } from '../index';
import type { TaskSummary, UIActionButton } from '../ui-blocks';


const FREQUENCIES = [
  'one_time',
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
  'custom',
] as const;

/**
 * Centralized error helper for Aihousekeeper task-tool catches.
 *
 * Why: every CRUD tool used to do `catch (err) { return { ok: false, error:
 * (err as Error).message } }`, which hid the type, code, and stack — so
 * Mira's reply ("the system isn't accepting the completion right now") was
 * the only signal we had. Routing every catch through here means
 * `wrangler tail` shows a single structured line per failure with name,
 * message, code, status, and stack — debuggable in a few seconds.
 *
 * The returned `error` string is intentionally the raw message so Claude
 * can decide how to phrase it to the user; we don't expose internal
 * codes/stack to the model.
 */
export function toolError(toolName: string, err: unknown): ToolResult {
  const e = err as Error & {
    code?: string | number;
    status?: number;
    cause?: unknown;
  };
  console.error(`[aihousekeeper-tool] ${toolName} failed`, {
    name: e?.name,
    message: e?.message,
    code: e?.code,
    status: e?.status,
    cause: e?.cause,
    stack: e?.stack,
  });
  return {
    ok: false,
    error: e?.message ?? `${toolName}_failed`,
  };
}

const PRIORITIES = [
  'nice_to_have',
  'low',
  'medium',
  'high',
  'urgent',
  'critical',
] as const;

const TIME_HHMM = /^\d{2}:\d{2}$/;

function summarizeTask(task: {
  id: string;
  title: string;
  frequency: string;
  next_due_date: string | null;
  priority_severity: string;
  system_category: string | null;
  is_active?: boolean;
}) {
  return {
    task_id: task.id,
    title: task.title,
    frequency: task.frequency,
    next_due_date: task.next_due_date ?? null,
    priority_severity: task.priority_severity,
    system_category: task.system_category ?? null,
    is_active: task.is_active ?? true,
  };
}

/**
 * Map a full `TaskResponse` to the compact `TaskSummary` the
 * client renders in chat. Keep in sync with `TaskSummary` in ui-blocks.ts.
 */
function toTaskSummary(task: TaskResponse): TaskSummary {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    system_category: task.system_category,
    frequency: task.frequency,
    custom_interval_days: task.custom_interval_days,
    next_due_date: task.next_due_date,
    is_active: task.is_active,
    priority_severity: task.priority_severity,
    assigned_to: task.assigned_to,
  };
}

/** Shared follow-up actions offered under task UI blocks. */
const CREATE_TASK_ACTION: UIActionButton = {
  label: 'Create a task',
  action: { type: 'send_message', text: 'Create a new task' },
  variant: 'secondary',
};

// ============ create_maintenance_task ============

export const createMaintenanceTask: AihousekeeperTool = {
  name: 'create_maintenance_task',
  kind: 'LOW_WRITE',
  description:
    'Create a task on the household task list. Use this whenever the user wants to remember a to-do, chore, errand, shopping item, repair, or recurring maintenance (e.g. "buy a water hose", "fix leak under sink", "change HVAC filter monthly", "schedule gutter cleaning in October"). Prefer this over storing tasks as memory notes. Pick frequency "one_time" for single errands or repairs; pick a recurring frequency only when the user clearly wants a repeating task.',
  input: z.object({
    title: z
      .string()
      .min(1)
      .max(200)
      .describe(
        'Short, action-oriented title. Examples: "Buy water hose", "Change HVAC filter", "Fix leak under kitchen sink".'
      ),
    description: z
      .string()
      .max(2000)
      .optional()
      .describe('Optional longer notes or context.'),
    frequency: z
      .enum(FREQUENCIES)
      .describe(
        'Use "one_time" for single errands, shopping items, or one-off repairs. Use "daily" | "weekly" | "monthly" | "quarterly" | "yearly" for recurring maintenance. Use "custom" only when the interval is unusual; set custom_interval_days.'
      ),
    custom_interval_days: z
      .number()
      .int()
      .min(1)
      .max(3650)
      .optional()
      .describe('Required when frequency is "custom".'),
    next_due_date: z
      .string()
      .optional()
      .describe(
        'When the task is due. Accepts YYYY-MM-DD or full ISO-8601. Omit if the user has not specified a date.'
      ),
    system_category: z
      .enum(SYSTEM_CATEGORIES as unknown as [string, ...string[]])
      .optional()
      .describe(
        'Closest system category. Use "other" if nothing fits. Omit if not obvious from the request.'
      ),
    priority_severity: z
      .enum(PRIORITIES)
      .optional()
      .describe(
        'Priority. Default is "nice_to_have". Use "high" / "urgent" / "critical" only when the user expresses urgency or safety concerns.'
      ),
    assigned_to: z
      .string()
      .optional()
      .describe('User ID of the household member to assign the task to.'),
    space_id: z
      .string()
      .optional()
      .describe(
        'Room/space id from household_spaces. Set when the title clearly maps to a room (e.g. "Kitchen", "Garage"). Omit if the household has no spaces defined or the match is unclear.'
      ),
    needs_contractor: z
      .boolean()
      .optional()
      .describe(
        'True when the work is unlikely to be DIY (plumbing, electrical, HVAC, roofing).'
      ),
    contractor_category: z
      .enum(['plumber', 'electrician', 'hvac', 'roofer', 'handyman', 'other'])
      .optional()
      .describe('Only set when needs_contractor is true.'),
    scheduled_work_date: z
      .string()
      .optional()
      .describe(
        'When work is scheduled to happen. YYYY-MM-DD or ISO-8601. Distinct from next_due_date — this is the actual appointment.'
      ),
    why_important: z
      .string()
      .max(500)
      .optional()
      .describe(
        'One-sentence rationale. Fill this from your own household-maintenance knowledge — do NOT ask the user.'
      ),
    neglect_consequences: z
      .string()
      .max(500)
      .optional()
      .describe(
        'One-sentence risk if the task is ignored. Fill this yourself — do NOT ask the user.'
      ),
    reminder_enabled: z.boolean().optional(),
    reminder_days_before: z
      .number()
      .int()
      .min(0)
      .max(30)
      .optional()
      .describe('How many days before the due date to send a reminder.'),
    reminder_time: z
      .string()
      .optional()
      .describe('Local time for the reminder in HH:MM format, e.g. "09:00".'),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    if (input.frequency === 'custom' && !input.custom_interval_days) {
      return {
        ok: false,
        error: 'custom_interval_days is required when frequency is "custom"',
      };
    }
    if (input.reminder_time && !TIME_HHMM.test(input.reminder_time)) {
      return { ok: false, error: 'reminder_time must be HH:MM (e.g. "09:00")' };
    }
    if (input.contractor_category && !input.needs_contractor) {
      return {
        ok: false,
        error:
          'contractor_category requires needs_contractor=true; set both or neither.',
      };
    }

    try {
      const service = new TaskService(ctx.env, ctx.env.DB);
      const task = await service.createTask(ctx.householdId, ctx.userId, {
        title: input.title,
        description: input.description,
        frequency: input.frequency as MaintenanceFrequency,
        custom_interval_days: input.custom_interval_days,
        next_due_date: input.next_due_date,
        system_category: input.system_category as SystemCategory | undefined,
        priority_severity: input.priority_severity as
          | TaskPrioritySeverity
          | undefined,
        assigned_to: input.assigned_to,
        space_id: input.space_id,
        needs_contractor: input.needs_contractor,
        contractor_category: input.contractor_category,
        scheduled_work_date: input.scheduled_work_date,
        why_important: input.why_important,
        neglect_consequences: input.neglect_consequences,
        reminder_enabled: input.reminder_enabled,
        reminder_days_before: input.reminder_days_before,
        reminder_time: input.reminder_time,
      });

      return {
        ok: true,
        ...summarizeTask(task),
        ui: {
          type: 'task_card' as const,
          task: toTaskSummary(task),
          caption: 'Added to your tasks',
        },
        invalidate: ['tasks'] as const,
      };
    } catch (err) {
      return toolError('create_maintenance_task', err);
    }
  },
};

// ============ update_maintenance_task ============

export const updateMaintenanceTask: AihousekeeperTool = {
  name: 'update_maintenance_task',
  kind: 'LOW_WRITE',
  description:
    'Modify an existing maintenance task. Use for retitling, editing description, changing frequency, priority, category, assignee, or toggling is_active. For rescheduling only the due date, prefer `reschedule_maintenance_task`. Only provide the fields you want to change; omitted fields are left as-is.',
  input: z.object({
    task_id: z.string().min(1),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    frequency: z.enum(FREQUENCIES).optional(),
    custom_interval_days: z.number().int().min(1).max(3650).optional(),
    next_due_date: z.string().optional(),
    system_category: z
      .enum(SYSTEM_CATEGORIES as unknown as [string, ...string[]])
      .optional(),
    priority_severity: z.enum(PRIORITIES).optional(),
    assigned_to: z
      .string()
      .optional()
      .describe('User ID of the household member to assign this task to.'),
    is_active: z
      .boolean()
      .optional()
      .describe(
        'Set to false to pause a task (stops notifications) without deleting it.'
      ),
    reminder_enabled: z.boolean().optional(),
    reminder_days_before: z.number().int().min(0).max(30).optional(),
    reminder_time: z.string().optional(),
    reminder_repeat: z.boolean().optional(),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    if (input.frequency === 'custom' && !input.custom_interval_days) {
      return {
        ok: false,
        error: 'custom_interval_days is required when frequency is "custom"',
      };
    }
    if (input.reminder_time && !TIME_HHMM.test(input.reminder_time)) {
      return { ok: false, error: 'reminder_time must be HH:MM (e.g. "09:00")' };
    }

    try {
      const service = new TaskService(ctx.env, ctx.env.DB);
      const { task_id: taskId, ...patch } = input;
      const task = await service.updateTask(ctx.householdId, taskId, ctx.userId, {
        title: patch.title,
        description: patch.description,
        frequency: patch.frequency as MaintenanceFrequency | undefined,
        custom_interval_days: patch.custom_interval_days,
        next_due_date: patch.next_due_date,
        system_category: patch.system_category as SystemCategory | undefined,
        priority_severity: patch.priority_severity as
          | TaskPrioritySeverity
          | undefined,
        assigned_to: patch.assigned_to,
        is_active: patch.is_active,
        reminder_enabled: patch.reminder_enabled,
        reminder_days_before: patch.reminder_days_before,
        reminder_time: patch.reminder_time,
        reminder_repeat: patch.reminder_repeat,
      });
      return {
        ok: true,
        ...summarizeTask(task),
        ui: {
          type: 'task_card' as const,
          task: toTaskSummary(task),
          caption: 'Updated',
        },
        invalidate: ['tasks'] as const,
      };
    } catch (err) {
      return toolError('update_maintenance_task', err);
    }
  },
};

// ============ reschedule_maintenance_task ============

export const rescheduleMaintenanceTask: AihousekeeperTool = {
  name: 'reschedule_maintenance_task',
  kind: 'LOW_WRITE',
  description:
    'Move a task to a new due date. Shorthand for update_maintenance_task when the only change is the scheduled date. Accepts YYYY-MM-DD or full ISO-8601.',
  input: z.object({
    task_id: z.string().min(1),
    next_due_date: z.string().min(1),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    try {
      const service = new TaskService(ctx.env, ctx.env.DB);
      const task = await service.updateTask(
        ctx.householdId,
        input.task_id,
        ctx.userId,
        { next_due_date: input.next_due_date }
      );
      return {
        ok: true,
        ...summarizeTask(task),
        ui: {
          type: 'task_card' as const,
          task: toTaskSummary(task),
          caption: 'Rescheduled',
        },
        invalidate: ['tasks'] as const,
      };
    } catch (err) {
      return toolError('reschedule_maintenance_task', err);
    }
  },
};

// ============ complete_maintenance_task ============

export const completeMaintenanceTask: AihousekeeperTool = {
  name: 'complete_maintenance_task',
  kind: 'LOW_WRITE',
  description:
    'Mark a task as completed. Records a completion row with optional notes, advances next_due_date for recurring tasks, and resets subtasks on recurrence. Does NOT delete the task.',
  input: z.object({
    task_id: z.string().min(1),
    notes: z.string().max(2000).optional(),
    photo_keys: z
      .array(z.string())
      .optional()
      .describe('R2 object keys of photos to attach to this completion.'),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    try {
      const service = new TaskService(ctx.env, ctx.env.DB);
      const result = await service.completeTask(
        ctx.householdId,
        input.task_id,
        ctx.userId,
        { notes: input.notes, photo_keys: input.photo_keys }
      );
      return {
        ok: true,
        task: summarizeTask(result.task),
        completion_id: result.completion.id,
        completed_at: result.completion.completed_at,
        ui: {
          type: 'task_card' as const,
          task: toTaskSummary(result.task),
          caption: 'Completed ✓',
        },
        invalidate: ['tasks'] as const,
      };
    } catch (err) {
      return toolError('complete_maintenance_task', err);
    }
  },
};

// ============ snooze_maintenance_task ============

export const snoozeMaintenanceTask: AihousekeeperTool = {
  name: 'snooze_maintenance_task',
  kind: 'LOW_WRITE',
  description:
    'Temporarily mute reminders for a task until the given date/time. Pass `clear: true` to remove an existing snooze without supplying a date.',
  input: z
    .object({
      task_id: z.string().min(1),
      snooze_until: z
        .string()
        .optional()
        .describe(
          'ISO-8601 or YYYY-MM-DD. Required unless clear is true.'
        ),
      clear: z.boolean().optional(),
    })
    .refine((v) => v.clear === true || !!v.snooze_until, {
      message: 'Provide snooze_until or set clear to true',
    }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    try {
      const service = new TaskService(ctx.env, ctx.env.DB);
      const task = input.clear
        ? await service.clearSnooze(ctx.householdId, input.task_id, ctx.userId)
        : await service.snoozeTaskReminder(
            ctx.householdId,
            input.task_id,
            ctx.userId,
            input.snooze_until as string
          );
      return {
        ok: true,
        ...summarizeTask(task),
        snooze_until: task.snooze_until ?? null,
        ui: {
          type: 'task_card' as const,
          task: toTaskSummary(task),
          caption: input.clear ? 'Snooze cleared' : 'Snoozed',
        },
        invalidate: ['tasks'] as const,
      };
    } catch (err) {
      return toolError('snooze_maintenance_task', err);
    }
  },
};

// ============ delete_maintenance_task ============

export const deleteMaintenanceTask: AihousekeeperTool = {
  name: 'delete_maintenance_task',
  kind: 'LOW_WRITE',
  description:
    'Permanently remove a task from the household task list (soft-delete). Use when the user asks to delete, remove, or cancel a task outright. Prefer `update_maintenance_task` with is_active=false for a temporary pause.',
  input: z.object({
    task_id: z.string().min(1),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    try {
      const service = new TaskService(ctx.env, ctx.env.DB);
      await service.deleteTask(ctx.householdId, input.task_id, ctx.userId);
      return {
        ok: true,
        task_id: input.task_id,
        deleted: true,
        invalidate: ['tasks'] as const,
      };
    } catch (err) {
      return toolError('delete_maintenance_task', err);
    }
  },
};

// ============ list_maintenance_tasks ============

export const listMaintenanceTasks: AihousekeeperTool = {
  name: 'list_maintenance_tasks',
  kind: 'READ',
  description:
    'List maintenance tasks in the current household. Filterable by system category and active flag. Use `upcoming_days` to restrict to tasks due within a window (including overdue).',
  input: z.object({
    system_category: z
      .enum(SYSTEM_CATEGORIES as unknown as [string, ...string[]])
      .optional(),
    is_active: z.boolean().optional(),
    upcoming_days: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .describe(
        'If set, returns only tasks due within this many days (including overdue). Overrides the other filters when set.'
      ),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    try {
      const service = new TaskService(ctx.env, ctx.env.DB);

      let tasks: TaskResponse[];
      let nextCursor: string | null = null;
      let title: string;
      if (input.upcoming_days) {
        tasks = await service.getUpcomingTasks(
          ctx.householdId,
          ctx.userId,
          input.upcoming_days
        );
        title =
          input.upcoming_days === 1
            ? 'Due today / tomorrow'
            : `Due in the next ${input.upcoming_days} days`;
      } else {
        const result = await service.listTasks(
          ctx.householdId,
          ctx.userId,
          {
            system_category: input.system_category as SystemCategory | undefined,
            is_active: input.is_active,
            limit: input.limit,
          }
        );
        tasks = result.tasks;
        nextCursor = result.next_cursor ?? null;
        title =
          input.is_active === false
            ? 'Paused tasks'
            : input.is_active === true
            ? 'Active tasks'
            : 'Your tasks';
      }

      // Hide one-time tasks the user has already completed. The mobile
      // TasksScreen has its own UI for completion history; in chat the
      // user expects "your tasks" to be the open ones only. Recurring
      // tasks always stay (`last_completed_at` is set on every cycle but
      // they're still due again in the future).
      tasks = tasks.filter(
        (t) => !(t.frequency === 'one_time' && t.last_completed_at)
      );

      const summaries = tasks.map(toTaskSummary);
      const compact = tasks.map(summarizeTask);

      return {
        ok: true,
        tasks: compact,
        count: tasks.length,
        next_cursor: nextCursor,
        // Structured payload — rendered by the mobile client as real task
        // cards. The `summary` above is what Claude narrates; the `ui`
        // payload is what the user actually sees.
        ui: {
          type: 'task_list' as const,
          title,
          tasks: summaries,
          total: tasks.length,
          actions: [CREATE_TASK_ACTION],
        },
      };
    } catch (err) {
      return toolError('list_maintenance_tasks', err);
    }
  },
};

// ============ get_maintenance_task ============

export const getMaintenanceTask: AihousekeeperTool = {
  name: 'get_maintenance_task',
  kind: 'READ',
  description:
    'Fetch a single maintenance task by id, including its subtasks and progress.',
  input: z.object({
    task_id: z.string().min(1),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    try {
      const service = new TaskService(ctx.env, ctx.env.DB);
      const task = await service.getTask(
        ctx.householdId,
        input.task_id,
        ctx.userId
      );
      return {
        ok: true,
        ...summarizeTask(task),
        description: task.description,
        assigned_to: task.assigned_to,
        last_completed_at: task.last_completed_at,
        reminder_enabled: task.reminder_enabled,
        reminder_days_before: task.reminder_days_before,
        reminder_time: task.reminder_time,
        subtask_progress: task.subtask_progress,
        ui: {
          type: 'task_card' as const,
          task: toTaskSummary(task),
        },
      };
    } catch (err) {
      return toolError('get_maintenance_task', err);
    }
  },
};

// ============ plan_time_budget ============

export const planTimeBudget: AihousekeeperTool = {
  name: 'plan_time_budget',
  kind: 'READ',
  description:
    'Answer "what can I do right now, I have N minutes?". Returns a deterministic, ranked plan of tasks (and partial subtasks) that fit the time budget, prioritized by risk, priority, and urgency. Use whenever the user gives an available time window and wants suggestions on what to tackle.',
  input: z.object({
    minutes: z
      .number()
      .int()
      .min(5)
      .max(1440)
      .describe('Available time in minutes (e.g. 60 for "I have an hour").'),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    try {
      const planner = new TaskPlannerService(ctx.env, ctx.env.DB);
      const plan = await planner.getPlan(ctx.householdId, ctx.userId, input.minutes);
      return {
        ok: true,
        budget_minutes: plan.budget_minutes,
        used_minutes: plan.used_minutes,
        selected: plan.selected.map((s) => ({
          task_id: s.task_id,
          title: s.title,
          time_effort: s.time_effort,
          partial: s.partial,
          reason: s.reason,
        })),
        skipped_count: plan.skipped.length,
      };
    } catch (err) {
      return toolError('plan_time_budget', err);
    }
  },
};

// ============ generate_task_report ============

export const generateTaskReport: AihousekeeperTool = {
  name: 'generate_task_report',
  kind: 'READ',
  description:
    'Produce an actionable summary of the household\'s active tasks: counts by due window (overdue / today / this week), number of high-risk items, and the highest-priority items. Use when the user asks for a status update, a rundown, or "what needs attention".',
  input: z.object({}),
  async execute(ctx: AihousekeeperToolContext): Promise<ToolResult> {
    try {
      const planner = new TaskPlannerService(ctx.env, ctx.env.DB);
      const report = await planner.getReport(ctx.householdId, ctx.userId);
      return { ok: true, ...report };
    } catch (err) {
      return toolError('generate_task_report', err);
    }
  },
};

// ============ report_blocker ============

export const reportBlocker: AihousekeeperTool = {
  name: 'report_blocker',
  kind: 'LOW_WRITE',
  description:
    'Mark a task as blocked with a reason (e.g. waiting on a part, a quote, or another person). Blocked tasks stop nagging reminders and are surfaced to the household.',
  input: z.object({
    task_id: z.string().min(1),
    reason: z.string().min(1).max(1000).describe('Why the task is blocked.'),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    try {
      const service = new TaskService(ctx.env, ctx.env.DB);
      const task = await service.reportBlocker(
        ctx.householdId,
        input.task_id,
        ctx.userId,
        input.reason
      );
      return { ok: true, ...summarizeTask(task), blocked: true };
    } catch (err) {
      return toolError('report_blocker', err);
    }
  },
};

// ============ resolve_blocker ============

export const resolveBlocker: AihousekeeperTool = {
  name: 'resolve_blocker',
  kind: 'LOW_WRITE',
  description: 'Clear a task\'s blocked state once the blocker is resolved.',
  input: z.object({
    task_id: z.string().min(1),
    note: z.string().max(1000).optional().describe('Optional resolution note.'),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    try {
      const service = new TaskService(ctx.env, ctx.env.DB);
      const task = await service.resolveBlocker(
        ctx.householdId,
        input.task_id,
        ctx.userId,
        input.note
      );
      return { ok: true, ...summarizeTask(task), blocked: false };
    } catch (err) {
      return toolError('resolve_blocker', err);
    }
  },
};

// ============ add_progress_note ============

export const addProgressNote: AihousekeeperTool = {
  name: 'add_progress_note',
  kind: 'LOW_WRITE',
  description:
    'Append a progress update to a task\'s household-visible activity feed (so other members can see what was done).',
  input: z.object({
    task_id: z.string().min(1),
    body: z.string().min(1).max(2000).describe('The progress update text.'),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    try {
      const service = new TaskService(ctx.env, ctx.env.DB);
      const note = await service.addNote(
        ctx.householdId,
        input.task_id,
        ctx.userId,
        'progress',
        input.body
      );
      return { ok: true, note_id: note.id, created_at: note.created_at };
    } catch (err) {
      return toolError('add_progress_note', err);
    }
  },
};

export const taskTools: readonly AihousekeeperTool[] = [
  createMaintenanceTask,
  updateMaintenanceTask,
  rescheduleMaintenanceTask,
  completeMaintenanceTask,
  snoozeMaintenanceTask,
  deleteMaintenanceTask,
  listMaintenanceTasks,
  getMaintenanceTask,
  planTimeBudget,
  generateTaskReport,
  reportBlocker,
  resolveBlocker,
  addProgressNote,
] as const;
