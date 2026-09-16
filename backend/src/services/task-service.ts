import { eq, and, isNull, desc, lt, lte, or, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import * as schema from '../db/schema';
import type {
  Database,
  Env,
  TaskResponse,
  TaskPhotoResponse,
  MaintenanceFrequency,
  MaintenanceSource,
  SystemCategory,
  TaskPrioritySeverity,
} from '../types';
import { ForbiddenError, NotFoundError, BadRequestError } from '../utils/errors';
import { generateId, now, addDays } from '../utils/id';

import { HouseholdService } from './household-service';
import { NotificationService } from './notification-service';
import { buildPurchaseSuggestion } from './task-purchase-suggestion';

/** Subtask shape decoded by the Apple Watch (SharedSubtask.swift). */
export interface WatchSubtaskPayload {
  id: string;
  task_id: string;
  title: string;
  description: string | null;
  sort_order: number;
  is_completed: boolean;
  completed_at: string | null;
  completed_by: string | null;
}

/** Task shape decoded by the Apple Watch (SharedTask.swift). */
export interface WatchTaskPayload {
  id: string;
  household_id: string;
  space_id: string | null;
  title: string;
  description: string | null;
  system_category: string | null;
  frequency: string | null;
  next_due_date: string | null;
  last_completed_at: string | null;
  priority_severity: string | null;
  assigned_to: string | null;
  is_active: boolean;
  subtasks: WatchSubtaskPayload[];
}

/**
 * Normalize a stored date/datetime into an ISO-8601 string the Watch's
 * `ISO8601DateFormatter` (default options) can parse: no fractional seconds, and
 * date-only values (`YYYY-MM-DD`, e.g. `next_due_date`) promoted to noon UTC so
 * they land on the correct calendar day across North American time zones.
 */
export function toWatchDate(value: string | null | undefined): string | null {
  if (!value) return null;
  // Date-only (no time component) → anchor at noon UTC.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T12:00:00Z`;
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  // toISOString() emits fractional seconds ("...000Z"); strip them.
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export class TaskService {
  private static readonly MAX_TASK_PHOTOS = 5;
  private db: Database;
  private env: Env;
  private d1: D1Database;
  private householdService: HouseholdService;
  private notificationService: NotificationService;

  constructor(_env: Env, d1: D1Database) {
    this.db = drizzle(d1, { schema });
    this.env = _env;
    this.d1 = d1;
    this.householdService = new HouseholdService(_env, d1);
    this.notificationService = new NotificationService(_env, d1);
  }

  /**
   * Schedule task reminders based on task settings
   * Called when task is created or updated with reminder settings
   */
  private async scheduleTaskNotifications(
    task: schema.Task,
    householdId: string
  ): Promise<void> {
    try {
      // Skip if reminders are disabled or no due date
      if (!task.reminder_enabled || !task.next_due_date) {
        // Cancel any existing reminders for this task
        await this.notificationService.cancelTaskReminders(task.id);
        return;
      }

      // Skip if task is snoozed
      if (task.snooze_until) {
        const snoozeUntil = new Date(task.snooze_until);
        if (snoozeUntil > new Date()) {
          return;
        }
      }

      // Get the user to notify (assigned user or all household members)
      const targetUserId = task.assigned_to;
      
      if (targetUserId) {
        // Schedule for assigned user
        await this.notificationService.scheduleTaskReminder(
          task.id,
          targetUserId,
          householdId,
          task.title,
          new Date(task.next_due_date),
          task.reminder_days_before || 1,
          { reminderTime: task.reminder_time }
        );
      } else {
        // Schedule for all household members
        const members = await this.getHouseholdMemberIds(householdId);
        for (const userId of members) {
          await this.notificationService.scheduleTaskReminder(
            task.id,
            userId,
            householdId,
            task.title,
            new Date(task.next_due_date),
            task.reminder_days_before || 1,
            { reminderTime: task.reminder_time }
          );
        }
      }
    } catch (error) {
      // Log error but don't fail the task operation
      console.error('Failed to schedule task notifications:', error);
    }
  }

  /**
   * Notify a member that a task was assigned to them. Fire-and-forget: a failed
   * push must never fail the create/update that triggered it. Skips self-assignment
   * (no point pinging yourself) and unassignment (assigneeId null).
   */
  private async notifyAssignment(
    householdId: string,
    taskId: string,
    taskTitle: string,
    assigneeId: string | null | undefined,
    actorId: string
  ): Promise<void> {
    if (!assigneeId || assigneeId === actorId) return;
    try {
      await this.notificationService.sendNotification({
        userId: assigneeId,
        type: 'task_assigned',
        title: 'New task assigned to you',
        body: `You were assigned "${taskTitle.slice(0, 120)}"`,
        data: { type: 'task_assigned', taskId, householdId, screen: 'TaskDetail' },
        referenceType: 'maintenance_task',
        referenceId: taskId,
      });
    } catch (error) {
      console.error('Failed to send task assignment notification:', error);
    }
  }

  /**
   * Get all member IDs for a household
   */
  private async getHouseholdMemberIds(householdId: string): Promise<string[]> {
    const members = await this.db
      .select({ user_id: schema.householdMembers.user_id })
      .from(schema.householdMembers)
      .where(
        and(
          eq(schema.householdMembers.household_id, householdId),
          isNull(schema.householdMembers.deleted_at)
        )
      )
      .all();
    
    return members.map(m => m.user_id);
  }

  /**
   * Create a new maintenance task
   */
  async createTask(
    householdId: string,
    userId: string,
    input: {
      title: string;
      description?: string;
      system_category?: SystemCategory;
      frequency: MaintenanceFrequency;
      custom_interval_days?: number;
      next_due_date?: string;
      assigned_to?: string;
      reminder_days_before?: number;
      space_id?: string | null;
      priority_severity?: TaskPrioritySeverity;
      time_effort?: 'quick' | 'short' | 'medium' | 'half_day' | 'all_day' | null;
      // Contractor workflow
      needs_contractor?: boolean;
      contractor_category?: string;
      scheduled_work_date?: string;
      // Context (Aihousekeeper fills these from its own knowledge)
      why_important?: string;
      neglect_consequences?: string;
      // Reminder settings
      reminder_enabled?: boolean;
      reminder_time?: string;
      reminder_repeat?: boolean;
      // Personal task: visible only to the creator within the household
      is_personal?: boolean;
      photos?: Array<{ photo_key: string }>;
      cover_photo_index?: number;
    }
  ): Promise<TaskResponse> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    // If assigned_to is provided, verify they are a household member
    if (input.assigned_to) {
      const members = await this.householdService.getMembers(householdId, userId);
      if (!members.find((m) => m.user_id === input.assigned_to)) {
        throw new ForbiddenError('Assigned user is not a member of this household');
      }
    }

    const taskId = generateId();
    const timestamp = now();

    await this.db.insert(schema.tasks).values({
      id: taskId,
      household_id: householdId,
      title: input.title,
      description: input.description || null,
      system_category: input.system_category || null,
      frequency: input.frequency,
      custom_interval_days: input.custom_interval_days || null,
      next_due_date: input.next_due_date || null,
      assigned_to: input.assigned_to || null,
      reminder_days_before: input.reminder_days_before ?? 1,
      space_id: input.space_id || null,
      source: 'manual',
      priority_severity: input.priority_severity || 'nice_to_have',
      time_effort: input.time_effort ?? null,
      // Contractor workflow
      needs_contractor: input.needs_contractor ?? false,
      contractor_category: input.contractor_category || null,
      scheduled_work_date: input.scheduled_work_date || null,
      // Context
      why_important: input.why_important || null,
      neglect_consequences: input.neglect_consequences || null,
      // Reminder settings
      reminder_enabled: input.reminder_enabled ?? true,
      reminder_time: input.reminder_time || '09:00',
      reminder_repeat: input.reminder_repeat ?? true,
      // Personal task
      is_personal: input.is_personal ?? false,
      created_by: userId,
      created_at: timestamp,
      updated_at: timestamp,
      updated_by: userId,
    });

    if (input.photos !== undefined) {
      await this.syncTaskPhotos(
        taskId,
        householdId,
        userId,
        input.photos,
        input.cover_photo_index
      );
    }

    // Get the created task for notification scheduling
    const createdTask = await this.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId))
      .get();

    // Schedule notifications if task has a due date
    if (createdTask && createdTask.next_due_date) {
      await this.scheduleTaskNotifications(createdTask, householdId);
    }

    // Ping the assignee if the task was created already assigned to someone else.
    await this.notifyAssignment(householdId, taskId, input.title, input.assigned_to, userId);

    return this.getTask(householdId, taskId, userId);
  }

  /**
   * Smart Task Assistant fast path: persist a minimal task INSTANTLY from a
   * raw voice/typed description and enqueue async AI enrichment. Returns in
   * <100ms; the enrichment consumer later fills risk/priority/complexity/time
   * + subtasks and flips enrichment_status to 'enriched' (live-updated on the
   * client via push + refetch).
   */
  async createQuickTask(
    householdId: string,
    userId: string,
    rawText: string,
    options?: { assigned_to?: string; space_id?: string; is_personal?: boolean }
  ): Promise<TaskResponse> {
    await this.householdService.getHousehold(householdId, userId);

    if (options?.assigned_to) {
      const members = await this.householdService.getMembers(householdId, userId);
      if (!members.find((m) => m.user_id === options.assigned_to)) {
        throw new ForbiddenError('Assigned user is not a member of this household');
      }
    }

    const taskId = generateId();
    const timestamp = now();
    const cleaned = rawText.trim();
    // Provisional title shown while "Analyzing…"; enrichment refines it.
    const provisionalTitle = (cleaned.slice(0, 120) || 'New task').replace(/\s+/g, ' ');

    await this.db.insert(schema.tasks).values({
      id: taskId,
      household_id: householdId,
      title: provisionalTitle,
      description: null,
      frequency: 'one_time',
      assigned_to: options?.assigned_to || null,
      space_id: options?.space_id || null,
      source: 'ai_generated',
      priority_severity: 'medium',
      is_active: true,
      reminder_enabled: true,
      reminder_time: '09:00',
      reminder_repeat: true,
      reminder_days_before: 1,
      // Smart-assistant async enrichment lifecycle.
      enrichment_status: 'pending',
      enrichment_attempts: 0,
      raw_capture_text: cleaned,
      // Personal task
      is_personal: options?.is_personal ?? false,
      created_by: userId,
      created_at: timestamp,
      updated_at: timestamp,
      updated_by: userId,
    });

    console.info('[maintenance] quick task created (pending enrichment)', {
      taskId: taskId.slice(0, 8),
      householdId: householdId.slice(0, 8),
      userId: userId.slice(0, 8),
      rawTextLen: cleaned.length,
      rawTextPreview: cleaned.slice(0, 120),
      preassignedTo: options?.assigned_to ? options.assigned_to.slice(0, 8) : null,
    });

    // Enqueue enrichment. If the queue send fails we don't want the card to
    // spin forever, so flip the row to 'failed' (the user can still edit it).
    try {
      await this.env.TASK_ENRICHMENT_QUEUE.send({
        taskId,
        householdId,
        userId,
        rawText: cleaned,
        enqueuedAt: Date.now(),
      });
      console.info('[maintenance] enrichment job enqueued', {
        taskId: taskId.slice(0, 8),
      });
    } catch (err) {
      console.error('[maintenance] task enrichment enqueue failed', {
        taskId: taskId.slice(0, 8),
        error: (err as Error).message,
      });
      await this.db
        .update(schema.tasks)
        .set({
          enrichment_status: 'failed',
          enrichment_error: `enqueue_failed:${(err as Error).message}`.slice(0, 300),
          updated_at: now(),
        })
        .where(eq(schema.tasks.id, taskId))
        .run()
        .catch(() => {});
    }

    // Ping the assignee if a quick-captured task was assigned to someone else.
    await this.notifyAssignment(householdId, taskId, provisionalTitle, options?.assigned_to, userId);

    return this.getTask(householdId, taskId, userId);
  }

  /**
   * Public entry for the async enrichment handler: (re)schedule reminders for a
   * task after enrichment has set its due date / priority. Loads the current
   * row and reuses the same private scheduling logic as create/update. Safe to
   * call repeatedly — scheduleTaskReminder cancels existing reminders first.
   */
  async scheduleRemindersForTask(householdId: string, taskId: string): Promise<void> {
    const task = await this.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId))
      .get();
    if (task && task.household_id === householdId) {
      await this.scheduleTaskNotifications(task, householdId);
    }
  }

  /**
   * Get a single maintenance task
   */
  async getTask(
    householdId: string,
    taskId: string,
    userId: string
  ): Promise<TaskResponse> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    const task = await this.db
      .select({
        task: schema.tasks,
        assigned_user: schema.users,
      })
      .from(schema.tasks)
      .leftJoin(
        schema.users,
        eq(schema.tasks.assigned_to, schema.users.id)
      )
      .where(
        and(
          eq(schema.tasks.id, taskId),
          eq(schema.tasks.household_id, householdId),
          isNull(schema.tasks.deleted_at)
        )
      )
      .get();

    if (!task) {
      throw new NotFoundError('Maintenance task');
    }

    // Personal tasks are only visible to their creator
    if (task.task.is_personal && task.task.created_by !== userId) {
      throw new NotFoundError('Maintenance task');
    }

    // Load subtasks and progress
    const { SubtaskService } = await import('./subtask-service');
    const subtaskService = new SubtaskService(this.env, this.d1);
    const subtasks = await subtaskService.listSubtasks(householdId, taskId, userId);
    const progress = await subtaskService.getSubtaskProgress(taskId);

    const taskResponse = this.mapTaskResponse(task.task, task.assigned_user, {
      photos: await this.getPhotosForTask(taskId),
      coverPhoto: await this.getCoverPhotoForTask(task.task),
    });
    return {
      ...taskResponse,
      subtasks,
      subtask_progress: progress,
    };
  }

  /**
   * List maintenance tasks for a household
   */
  async listTasks(
    householdId: string,
    userId: string,
    filters: {
      system_category?: SystemCategory;
      is_active?: boolean;
      limit?: number;
      cursor?: string;
    }
  ): Promise<{ tasks: TaskResponse[]; next_cursor?: string }> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    const limit = filters.limit || 20;
    const conditions = [
      eq(schema.tasks.household_id, householdId),
      isNull(schema.tasks.deleted_at),
      // Exclude personal tasks created by other users
      or(
        eq(schema.tasks.is_personal, false),
        eq(schema.tasks.created_by, userId)
      ),
    ];

    if (filters.system_category) {
      conditions.push(
        eq(schema.tasks.system_category, filters.system_category)
      );
    }

    if (filters.is_active !== undefined) {
      conditions.push(eq(schema.tasks.is_active, filters.is_active));
    }

    if (filters.cursor) {
      conditions.push(lt(schema.tasks.created_at, filters.cursor));
    }

    const tasks = await this.db
      .select({
        task: schema.tasks,
        assigned_user: schema.users,
      })
      .from(schema.tasks)
      .leftJoin(
        schema.users,
        eq(schema.tasks.assigned_to, schema.users.id)
      )
      .where(and(...conditions))
      .orderBy(desc(schema.tasks.next_due_date))
      .limit(limit + 1)
      .all();

    const hasMore = tasks.length > limit;
    const results = hasMore ? tasks.slice(0, -1) : tasks;

    const coverPhotoMap = await this.getCoverPhotosForTasks(
      results.map((t) => ({ taskId: t.task.id, coverPhotoId: t.task.cover_photo_id }))
    );

    return {
      tasks: results.map((t) =>
        this.mapTaskResponse(t.task, t.assigned_user, {
          coverPhoto: coverPhotoMap.get(t.task.id) ?? null,
        })
      ),
      next_cursor: hasMore ? results[results.length - 1].task.created_at : undefined,
    };
  }

  /**
   * Get upcoming tasks (due within next N days, including overdue)
   */
  async getUpcomingTasks(
    householdId: string,
    userId: string,
    daysAhead: number = 7
  ): Promise<TaskResponse[]> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    const futureDate = addDays(daysAhead).split('T')[0];

    // Include all active tasks with due dates up to futureDate (including overdue)
    const tasks = await this.db
      .select({
        task: schema.tasks,
        assigned_user: schema.users,
      })
      .from(schema.tasks)
      .leftJoin(
        schema.users,
        eq(schema.tasks.assigned_to, schema.users.id)
      )
      .where(
        and(
          eq(schema.tasks.household_id, householdId),
          eq(schema.tasks.is_active, true),
          isNull(schema.tasks.deleted_at),
          lte(schema.tasks.next_due_date, futureDate),
          or(
            eq(schema.tasks.is_personal, false),
            eq(schema.tasks.created_by, userId)
          )
        )
      )
      .orderBy(schema.tasks.next_due_date)
      .all();

    const coverPhotoMap = await this.getCoverPhotosForTasks(
      tasks.map((t) => ({ taskId: t.task.id, coverPhotoId: t.task.cover_photo_id }))
    );

    return tasks.map((t) =>
      this.mapTaskResponse(t.task, t.assigned_user, {
        coverPhoto: coverPhotoMap.get(t.task.id) ?? null,
      })
    );
  }

  /**
   * Get upcoming tasks shaped precisely for the Apple Watch companion app.
   *
   * The Watch decodes a *bare* JSON array of `WatchTask` values (see
   * ios/Shared/Models/SharedTask.swift). Its Codable model expects snake_case
   * keys, a scalar `assigned_to` (user id, not the `{id,display_name}` object the
   * main `/upcoming` endpoint returns), a `household_id`, ISO-8601 date-times
   * WITHOUT fractional seconds, and nested `subtasks`. Keeping this shaping on the
   * server (rather than in Swift) keeps the Watch client thin and means backend
   * drift can't silently break decoding again.
   */
  async getWatchTasks(
    householdId: string,
    userId: string,
    daysAhead: number = 7
  ): Promise<WatchTaskPayload[]> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    const futureDate = addDays(daysAhead).split('T')[0];

    const rows = await this.db
      .select({ task: schema.tasks })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.household_id, householdId),
          eq(schema.tasks.is_active, true),
          isNull(schema.tasks.deleted_at),
          lte(schema.tasks.next_due_date, futureDate),
          or(
            eq(schema.tasks.is_personal, false),
            eq(schema.tasks.created_by, userId)
          )
        )
      )
      .orderBy(schema.tasks.next_due_date)
      .all();

    const taskIds = rows.map((r) => r.task.id);

    // Batch-load subtasks for all tasks in one query, grouped by task id.
    const subtasksByTask = new Map<string, WatchSubtaskPayload[]>();
    if (taskIds.length > 0) {
      const subtaskRows = await this.db
        .select()
        .from(schema.maintenanceSubtasks)
        .where(
          and(
            inArray(schema.maintenanceSubtasks.task_id, taskIds),
            isNull(schema.maintenanceSubtasks.deleted_at)
          )
        )
        .orderBy(schema.maintenanceSubtasks.sort_order)
        .all();

      for (const s of subtaskRows) {
        const list = subtasksByTask.get(s.task_id) ?? [];
        list.push({
          id: s.id,
          task_id: s.task_id,
          title: s.title,
          description: s.description ?? null,
          sort_order: s.sort_order,
          is_completed: s.is_completed,
          completed_at: toWatchDate(s.completed_at),
          completed_by: s.completed_by ?? null,
        });
        subtasksByTask.set(s.task_id, list);
      }
    }

    return rows.map(({ task }) => ({
      id: task.id,
      household_id: task.household_id,
      space_id: task.space_id ?? null,
      title: task.title,
      description: task.description ?? null,
      system_category: task.system_category ?? null,
      frequency: task.frequency ?? null,
      next_due_date: toWatchDate(task.next_due_date),
      last_completed_at: toWatchDate(task.last_completed_at),
      priority_severity: task.priority_severity ?? null,
      assigned_to: task.assigned_to ?? null,
      is_active: task.is_active,
      subtasks: subtasksByTask.get(task.id) ?? [],
    }));
  }

  /**
   * Update a maintenance task
   */
  async updateTask(
    householdId: string,
    taskId: string,
    userId: string,
    input: {
      title?: string;
      description?: string;
      system_category?: SystemCategory;
      frequency?: MaintenanceFrequency;
      custom_interval_days?: number;
      next_due_date?: string;
      assigned_to?: string | null;
      reminder_days_before?: number;
      is_active?: boolean;
      space_id?: string | null;
      priority_severity?: TaskPrioritySeverity;
      time_effort?: 'quick' | 'short' | 'medium' | 'half_day' | 'all_day' | null;
      // Reminder settings
      reminder_enabled?: boolean;
      reminder_time?: string;
      reminder_repeat?: boolean;
      snooze_until?: string | null;
      // Contractor and quote management fields
      needs_contractor?: boolean;
      contractor_category?: string;
      workflow_stage?: string;
      scheduled_work_date?: string;
      scheduled_work_time_start?: string;
      scheduled_work_time_end?: string;
      selected_quote_id?: string;
      linked_project_id?: string;
      photos?: Array<{ photo_key: string }>;
      cover_photo_index?: number;
    }
  ): Promise<TaskResponse> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    // Verify task exists
    const existing = await this.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.id, taskId),
          eq(schema.tasks.household_id, householdId),
          isNull(schema.tasks.deleted_at)
        )
      )
      .get();

    if (!existing) {
      throw new NotFoundError('Maintenance task');
    }

    // Personal tasks can only be edited by their creator
    if (existing.is_personal && existing.created_by !== userId) {
      throw new ForbiddenError('You do not have permission to edit this task');
    }

    // If assigned_to is provided, verify they are a household member
    if (input.assigned_to) {
      const members = await this.householdService.getMembers(householdId, userId);
      if (!members.find((m) => m.user_id === input.assigned_to)) {
        throw new ForbiddenError('Assigned user is not a member of this household');
      }
    }

    await this.db
      .update(schema.tasks)
      .set({
        ...this.taskUpdateFields(input),
        updated_at: now(),
        updated_by: userId,
      })
      .where(eq(schema.tasks.id, taskId));

    if (input.photos !== undefined) {
      await this.syncTaskPhotos(
        taskId,
        householdId,
        userId,
        input.photos,
        input.cover_photo_index
      );
    }

    // Check if we need to reschedule notifications
    const shouldReschedule = 
      input.next_due_date !== undefined ||
      input.reminder_days_before !== undefined ||
      input.reminder_enabled !== undefined ||
      input.reminder_time !== undefined ||
      input.snooze_until !== undefined ||
      input.assigned_to !== undefined ||
      input.is_active !== undefined;

    if (shouldReschedule) {
      const updatedTask = await this.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, taskId))
        .get();

      if (updatedTask) {
        if (updatedTask.is_active && updatedTask.next_due_date) {
          await this.scheduleTaskNotifications(updatedTask, householdId);
        } else {
          // Cancel notifications if task is inactive
          await this.notificationService.cancelTaskReminders(taskId);
        }
      }
    }

    // Notify the new assignee when assignment actually changed (skip self/unassign).
    if (input.assigned_to !== undefined && input.assigned_to !== existing.assigned_to) {
      await this.notifyAssignment(
        householdId,
        taskId,
        input.title ?? existing.title,
        input.assigned_to,
        userId
      );
    }

    return this.getTask(householdId, taskId, userId);
  }

  /**
   * Delete a maintenance task (soft delete)
   */
  async deleteTask(
    householdId: string,
    taskId: string,
    userId: string
  ): Promise<void> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    // Verify task exists
    const existing = await this.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.id, taskId),
          eq(schema.tasks.household_id, householdId),
          isNull(schema.tasks.deleted_at)
        )
      )
      .get();

    if (!existing) {
      throw new NotFoundError('Maintenance task');
    }

    // Personal tasks can only be deleted by their creator
    if (existing.is_personal && existing.created_by !== userId) {
      throw new ForbiddenError('You do not have permission to delete this task');
    }

    await this.db
      .update(schema.tasks)
      .set({
        deleted_at: now(),
        updated_at: now(),
        updated_by: userId,
      })
      .where(eq(schema.tasks.id, taskId));

    // Cancel any scheduled notifications for this task
    await this.notificationService.cancelTaskReminders(taskId);
  }

  /**
   * Complete a maintenance task
   */
  async completeTask(
    householdId: string,
    taskId: string,
    userId: string,
    input: {
      notes?: string;
      photo_keys?: string[];
    }
  ): Promise<{
    task: TaskResponse;
    completion: {
      id: string;
      completed_at: string;
      notes: string | null;
    };
  }> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    // Verify task exists
    const existing = await this.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.id, taskId),
          eq(schema.tasks.household_id, householdId),
          isNull(schema.tasks.deleted_at)
        )
      )
      .get();

    if (!existing) {
      throw new NotFoundError('Maintenance task');
    }

    const completionId = generateId();
    const timestamp = now();

    // Create completion record
    await this.db.insert(schema.maintenanceCompletions).values({
      id: completionId,
      task_id: taskId,
      completed_by: userId,
      completed_at: timestamp,
      notes: input.notes || null,
      photo_keys: input.photo_keys ? JSON.stringify(input.photo_keys) : null,
      created_at: timestamp,
    });

    // Calculate next due date based on frequency
    const nextDueDate = this.calculateNextDueDate(
      existing.frequency as MaintenanceFrequency,
      existing.custom_interval_days
    );

    // Update task
    await this.db
      .update(schema.tasks)
      .set({
        last_completed_at: timestamp,
        next_due_date: nextDueDate,
        updated_at: timestamp,
        updated_by: userId,
      })
      .where(eq(schema.tasks.id, taskId));

    // Reset subtasks for recurring tasks (mark all as incomplete)
    if (existing.frequency !== 'one_time' && nextDueDate) {
      const { SubtaskService } = await import('./subtask-service');
      const subtaskService = new SubtaskService(this.env, this.d1);
      await subtaskService.resetSubtasksForRecurrence(taskId, userId);
    }

    // Reschedule notifications for next occurrence if reminder_repeat is enabled
    const updatedTask = await this.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId))
      .get();

    if (updatedTask && updatedTask.reminder_repeat && updatedTask.next_due_date) {
      await this.scheduleTaskNotifications(updatedTask, householdId);
    } else if (updatedTask) {
      // Cancel notifications if repeat is disabled
      await this.notificationService.cancelTaskReminders(taskId);
    }

    // Send task completion notification to household members
    try {
      const members = await this.getHouseholdMemberIds(householdId);
      for (const memberId of members) {
        if (memberId !== userId) {
          await this.notificationService.sendNotification({
            userId: memberId,
            type: 'task_completed',
            title: 'Task Completed',
            body: `"${existing.title}" has been completed`,
            data: { taskId, screen: 'TaskDetail' },
            referenceType: 'maintenance_task',
            referenceId: taskId,
          });
        }
      }
    } catch (error) {
      console.error('Failed to send task completion notifications:', error);
    }

    const task = await this.getTask(householdId, taskId, userId);

    return {
      task,
      completion: {
        id: completionId,
        completed_at: timestamp,
        notes: input.notes || null,
      },
    };
  }

  /**
   * Get completion history for a task
   */
  async getCompletionHistory(
    householdId: string,
    taskId: string,
    userId: string,
    filters: {
      limit?: number;
      cursor?: string;
    }
  ): Promise<{
    completions: Array<{
      id: string;
      completed_by: { id: string; display_name: string | null };
      completed_at: string;
      notes: string | null;
      photo_keys: string[];
    }>;
    next_cursor?: string;
  }> {
    // Verify user has access and task exists
    await this.getTask(householdId, taskId, userId);

    const limit = filters.limit || 20;
    const conditions = [eq(schema.maintenanceCompletions.task_id, taskId)];

    if (filters.cursor) {
      conditions.push(lt(schema.maintenanceCompletions.completed_at, filters.cursor));
    }

    const completions = await this.db
      .select({
        completion: schema.maintenanceCompletions,
        user: schema.users,
      })
      .from(schema.maintenanceCompletions)
      .innerJoin(
        schema.users,
        eq(schema.maintenanceCompletions.completed_by, schema.users.id)
      )
      .where(and(...conditions))
      .orderBy(desc(schema.maintenanceCompletions.completed_at))
      .limit(limit + 1)
      .all();

    const hasMore = completions.length > limit;
    const results = hasMore ? completions.slice(0, -1) : completions;

    return {
      completions: results.map((c) => ({
        id: c.completion.id,
        completed_by: {
          id: c.user.id,
          display_name: c.user.display_name,
        },
        completed_at: c.completion.completed_at,
        notes: c.completion.notes,
        photo_keys: c.completion.photo_keys
          ? JSON.parse(c.completion.photo_keys)
          : [],
      })),
      next_cursor: hasMore
        ? results[results.length - 1].completion.completed_at
        : undefined,
    };
  }

  /**
   * Calculate next due date based on frequency
   */
  /**
   * Compute the next due date for a recurring task.
   *
   * Returns `null` for one-time tasks — they do not recur, so completing one
   * leaves `next_due_date` empty. The previous implementation looked up
   * `intervals['one_time']`, got `undefined`, passed it to `addDays()`, and
   * threw `RangeError: Invalid time value` from `Date.toISOString()` when
   * Mira tried to mark a one-time task complete.
   */
  private calculateNextDueDate(
    frequency: MaintenanceFrequency,
    customIntervalDays?: number | null
  ): string | null {
    if (frequency === 'one_time') return null;
    const intervals: Record<Exclude<MaintenanceFrequency, 'one_time'>, number> = {
      daily: 1,
      weekly: 7,
      monthly: 30,
      quarterly: 90,
      yearly: 365,
      custom: customIntervalDays || 30,
    };
    return addDays(intervals[frequency]);
  }

  /**
   * Map database row to response format
   */
  private buildTaskPhotoUrl(photoKey: string): string {
    return `${this.env.API_URL}/files/${photoKey}`;
  }

  private mapPhotoRow(row: schema.TaskPhoto): TaskPhotoResponse {
    return {
      id: row.id,
      photo_key: row.photo_key,
      photo_url: this.buildTaskPhotoUrl(row.photo_key),
      sort_order: row.sort_order,
    };
  }

  private async getPhotosForTask(taskId: string): Promise<TaskPhotoResponse[]> {
    const rows = await this.db
      .select()
      .from(schema.taskPhotos)
      .where(and(eq(schema.taskPhotos.task_id, taskId), isNull(schema.taskPhotos.deleted_at)))
      .orderBy(schema.taskPhotos.sort_order)
      .all();
    return rows.map((row) => this.mapPhotoRow(row));
  }

  private async getCoverPhotoForTask(
    task: schema.Task
  ): Promise<TaskPhotoResponse | null> {
    if (!task.cover_photo_id) return null;
    const row = await this.db
      .select()
      .from(schema.taskPhotos)
      .where(
        and(
          eq(schema.taskPhotos.id, task.cover_photo_id),
          isNull(schema.taskPhotos.deleted_at)
        )
      )
      .get();
    return row ? this.mapPhotoRow(row) : null;
  }

  private async getCoverPhotosForTasks(
    items: Array<{ taskId: string; coverPhotoId: string | null }>
  ): Promise<Map<string, TaskPhotoResponse>> {
    const coverIds = items
      .map((item) => item.coverPhotoId)
      .filter((id): id is string => !!id);
    if (coverIds.length === 0) return new Map();

    const rows = await this.db
      .select()
      .from(schema.taskPhotos)
      .where(
        and(inArray(schema.taskPhotos.id, coverIds), isNull(schema.taskPhotos.deleted_at))
      )
      .all();

    const rowById = new Map(rows.map((row) => [row.id, row]));
    const result = new Map<string, TaskPhotoResponse>();
    for (const item of items) {
      if (!item.coverPhotoId) continue;
      const row = rowById.get(item.coverPhotoId);
      if (row) {
        result.set(item.taskId, this.mapPhotoRow(row));
      }
    }
    return result;
  }

  private async syncTaskPhotos(
    taskId: string,
    householdId: string,
    userId: string,
    photos: Array<{ photo_key: string }>,
    coverPhotoIndex?: number
  ): Promise<void> {
    if (photos.length > TaskService.MAX_TASK_PHOTOS) {
      throw new BadRequestError(`A task can have at most ${TaskService.MAX_TASK_PHOTOS} photos`);
    }

    const timestamp = now();

    await this.db
      .delete(schema.taskPhotos)
      .where(eq(schema.taskPhotos.task_id, taskId));

    const insertedIds: string[] = [];
    for (let i = 0; i < photos.length; i++) {
      const photoId = generateId();
      insertedIds.push(photoId);
      await this.db.insert(schema.taskPhotos).values({
        id: photoId,
        task_id: taskId,
        household_id: householdId,
        photo_key: photos[i].photo_key,
        sort_order: i,
        created_at: timestamp,
        updated_at: timestamp,
        updated_by: userId,
      });
    }

    const coverIndex =
      insertedIds.length === 0
        ? -1
        : Math.min(Math.max(coverPhotoIndex ?? 0, 0), insertedIds.length - 1);
    const coverPhotoId = coverIndex >= 0 ? insertedIds[coverIndex] : null;

    await this.db
      .update(schema.tasks)
      .set({
        cover_photo_id: coverPhotoId,
        updated_at: timestamp,
        updated_by: userId,
      })
      .where(eq(schema.tasks.id, taskId));
  }

  /** Strip photo fields before writing task columns. */
  private taskUpdateFields(
    input: Record<string, unknown>
  ): Record<string, unknown> {
    const { photos: _photos, cover_photo_index: _cover, ...fields } = input;
    return fields;
  }

  private mapTaskResponse(
    task: schema.Task,
    assignedUser: schema.User | null,
    extras?: {
      photos?: TaskPhotoResponse[];
      coverPhoto?: TaskPhotoResponse | null;
    }
  ): TaskResponse {
    return {
      id: task.id,
      system_category: task.system_category as SystemCategory | null,
      title: task.title,
      description: task.description,
      frequency: task.frequency as MaintenanceFrequency,
      custom_interval_days: task.custom_interval_days,
      next_due_date: task.next_due_date,
      last_completed_at: task.last_completed_at,
      assigned_to: assignedUser
        ? {
            id: assignedUser.id,
            display_name: assignedUser.display_name,
          }
        : null,
      space_id: task.space_id ?? null,
      is_active: task.is_active,
      source: task.source as MaintenanceSource,
      priority_severity: (task.priority_severity || 'nice_to_have') as TaskPrioritySeverity,
      // Smart Task Assistant: AI-assessed fields + async enrichment lifecycle.
      risk_level: (task.risk_level ?? null) as TaskResponse['risk_level'],
      complexity: (task.complexity ?? null) as TaskResponse['complexity'],
      time_effort: (task.time_effort ?? null) as TaskResponse['time_effort'],
      ai_rationale: task.ai_rationale ?? null,
      enrichment_status: (task.enrichment_status ??
        null) as TaskResponse['enrichment_status'],
      // Purchase → optional planned-spending suggestion (fully server-computed).
      purchase_suggestion: buildPurchaseSuggestion(task),
      // Blockers (household sharing)
      blocked: task.blocked ?? false,
      blocker_reason: task.blocker_reason ?? null,
      blocked_at: task.blocked_at ?? null,
      // blocked_by is resolved to a {id, display_name} object by callers that
      // join the user; the raw column is the user id.
      blocked_by: task.blocked_by ? { id: task.blocked_by, display_name: null } : null,
      // Reminder settings
      reminder_enabled: task.reminder_enabled ?? true,
      reminder_days_before: task.reminder_days_before ?? 1,
      reminder_time: task.reminder_time ?? '09:00',
      reminder_repeat: task.reminder_repeat ?? true,
      snooze_until: task.snooze_until ?? undefined,
      // Contractor and quote management fields
      needs_contractor: task.needs_contractor ?? undefined,
      contractor_category: task.contractor_category ?? undefined,
      workflow_stage: task.workflow_stage ?? undefined,
      scheduled_work_date: task.scheduled_work_date ?? undefined,
      scheduled_work_time_start: task.scheduled_work_time_start ?? undefined,
      scheduled_work_time_end: task.scheduled_work_time_end ?? undefined,
      selected_quote_id: task.selected_quote_id ?? undefined,
      linked_project_id: task.linked_project_id ?? undefined,
      is_personal: task.is_personal ?? false,
      created_by: task.created_by ?? null,
      created_at: task.created_at,
      updated_at: task.updated_at,
      photos: extras?.photos,
      cover_photo_id: task.cover_photo_id ?? null,
      cover_photo_url: extras?.coverPhoto?.photo_url ?? null,
    };
  }

  /**
   * Flag a task as blocked (waiting on a part/quote/person). Records a blocker
   * note for the activity feed and notifies the assignee (if someone else did
   * it). Blocked tasks are skipped by the overdue nagging sweep.
   */
  async reportBlocker(
    householdId: string,
    taskId: string,
    userId: string,
    reason: string
  ): Promise<TaskResponse> {
    await this.householdService.getHousehold(householdId, userId);
    const existing = await this.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.id, taskId),
          eq(schema.tasks.household_id, householdId),
          isNull(schema.tasks.deleted_at)
        )
      )
      .get();
    if (!existing) throw new NotFoundError('Maintenance task');

    const ts = now();
    await this.db
      .update(schema.tasks)
      .set({
        blocked: true,
        blocker_reason: reason.slice(0, 1000),
        blocked_at: ts,
        blocked_by: userId,
        updated_at: ts,
        updated_by: userId,
      })
      .where(eq(schema.tasks.id, taskId));

    await this.addNote(householdId, taskId, userId, 'blocker', reason);

    // Notify the assignee if someone else blocked their task.
    if (existing.assigned_to && existing.assigned_to !== userId) {
      await this.notificationService
        .sendNotification({
          userId: existing.assigned_to,
          type: 'task_blocked',
          title: 'Task blocked',
          body: `"${existing.title}" was marked blocked: ${reason.slice(0, 120)}`,
          data: { type: 'task_blocked', taskId, householdId, screen: 'TaskDetail' },
          referenceType: 'maintenance_task',
          referenceId: taskId,
        })
        .catch(() => {});
    }

    return this.getTask(householdId, taskId, userId);
  }

  /** Clear a task's blocked state and log a resolution note. */
  async resolveBlocker(
    householdId: string,
    taskId: string,
    userId: string,
    note?: string
  ): Promise<TaskResponse> {
    await this.householdService.getHousehold(householdId, userId);
    const existing = await this.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.id, taskId),
          eq(schema.tasks.household_id, householdId),
          isNull(schema.tasks.deleted_at)
        )
      )
      .get();
    if (!existing) throw new NotFoundError('Maintenance task');

    const ts = now();
    await this.db
      .update(schema.tasks)
      .set({
        blocked: false,
        blocker_reason: null,
        blocked_at: null,
        blocked_by: null,
        updated_at: ts,
        updated_by: userId,
      })
      .where(eq(schema.tasks.id, taskId));

    await this.addNote(
      householdId,
      taskId,
      userId,
      'resolution',
      note?.trim() || 'Blocker resolved'
    );

    return this.getTask(householdId, taskId, userId);
  }

  /**
   * Dismiss the AI "add to planned spending" suggestion for a task so its chip
   * stops showing. Does not touch any budget item.
   */
  async dismissPurchaseSuggestion(
    householdId: string,
    taskId: string,
    userId: string
  ): Promise<TaskResponse> {
    await this.householdService.getHousehold(householdId, userId);
    const existing = await this.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.id, taskId),
          eq(schema.tasks.household_id, householdId),
          isNull(schema.tasks.deleted_at)
        )
      )
      .get();
    if (!existing) throw new NotFoundError('Maintenance task');

    await this.db
      .update(schema.tasks)
      .set({
        purchase_suggestion_dismissed: true,
        updated_at: now(),
        updated_by: userId,
      })
      .where(eq(schema.tasks.id, taskId));

    return this.getTask(householdId, taskId, userId);
  }

  /**
   * Append a note to a task's household-visible activity feed.
   * kind: 'progress' | 'blocker' | 'resolution'.
   */
  async addNote(
    householdId: string,
    taskId: string,
    userId: string,
    kind: 'progress' | 'blocker' | 'resolution',
    body: string
  ): Promise<{ id: string; created_at: string }> {
    const trimmed = body.trim();
    if (!trimmed) throw new ForbiddenError('Note body is required');
    const id = generateId();
    const created_at = now();
    await this.db.insert(schema.maintenanceTaskNotes).values({
      id,
      task_id: taskId,
      household_id: householdId,
      author_id: userId,
      kind,
      body: trimmed.slice(0, 2000),
      created_at,
    });
    return { id, created_at };
  }

  /** List a task's activity feed (newest first) with author display names. */
  async listNotes(
    householdId: string,
    taskId: string,
    userId: string,
    limit = 50
  ): Promise<
    Array<{
      id: string;
      kind: string;
      body: string;
      created_at: string;
      author: { id: string; display_name: string | null } | null;
    }>
  > {
    await this.householdService.getHousehold(householdId, userId);
    const rows = await this.db
      .select({ note: schema.maintenanceTaskNotes, author: schema.users })
      .from(schema.maintenanceTaskNotes)
      .leftJoin(schema.users, eq(schema.maintenanceTaskNotes.author_id, schema.users.id))
      .where(
        and(
          eq(schema.maintenanceTaskNotes.task_id, taskId),
          eq(schema.maintenanceTaskNotes.household_id, householdId)
        )
      )
      .orderBy(desc(schema.maintenanceTaskNotes.created_at))
      .limit(limit)
      .all();

    return rows.map((r) => ({
      id: r.note.id,
      kind: r.note.kind,
      body: r.note.body,
      created_at: r.note.created_at,
      author: r.author ? { id: r.author.id, display_name: r.author.display_name } : null,
    }));
  }

  /**
   * Snooze task reminders until a specific date/time
   */
  async snoozeTaskReminder(
    householdId: string,
    taskId: string,
    userId: string,
    snoozeUntil: string
  ): Promise<TaskResponse> {
    return this.updateTask(householdId, taskId, userId, { snooze_until: snoozeUntil });
  }

  /**
   * Clear snooze for a task
   */
  async clearSnooze(
    householdId: string,
    taskId: string,
    userId: string
  ): Promise<TaskResponse> {
    return this.updateTask(householdId, taskId, userId, { snooze_until: null });
  }
}

