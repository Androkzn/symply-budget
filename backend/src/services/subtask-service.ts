import { eq, and, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import * as schema from '../db/schema';
import type {
  Database,
  Env,
  MaintenanceSubtask,
  SubtaskProgress,
  CreateSubtaskRequest,
  UpdateSubtaskRequest,
} from '../types';
import { NotFoundError, BadRequestError } from '../utils/errors';
import { generateId, now } from '../utils/id';

import { HouseholdService } from './household-service';
import { NotificationService } from './notification-service';

export class SubtaskService {
  private db: Database;
  private householdService: HouseholdService;
  private notificationService: NotificationService;

  constructor(_env: Env, d1: D1Database) {
    this.db = drizzle(d1, { schema });
    this.householdService = new HouseholdService(_env, d1);
    this.notificationService = new NotificationService(_env, d1);
  }

  /**
   * Validate subtask title
   * @throws {BadRequestError} if title is invalid
   */
  private validateTitle(title: string): void {
    if (!title || title.trim().length === 0) {
      throw new BadRequestError('Subtask title is required');
    }
    if (title.length > 500) {
      throw new BadRequestError('Subtask title cannot exceed 500 characters');
    }
  }

  /**
   * Validate description
   * @throws {BadRequestError} if description is too long
   */
  private validateDescription(description: string | undefined): void {
    if (description && description.length > 2000) {
      throw new BadRequestError('Subtask description cannot exceed 2000 characters');
    }
  }

  /**
   * Validate reminder settings
   * @throws {BadRequestError} if reminder settings are invalid
   */
  private validateReminderSettings(
    reminderDaysBefore?: number,
    reminderTime?: string
  ): void {
    if (reminderDaysBefore !== undefined) {
      if (reminderDaysBefore < 0 || reminderDaysBefore > 365) {
        throw new BadRequestError('Reminder days before must be between 0 and 365');
      }
    }

    if (reminderTime !== undefined) {
      const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
      if (!timeRegex.test(reminderTime)) {
        throw new BadRequestError('Reminder time must be in HH:MM format (24-hour)');
      }
    }
  }

  /**
   * Verify user has access to household and parent task exists
   * @throws {ForbiddenError} if user doesn't have access
   * @throws {NotFoundError} if task not found
   */
  private async verifyTaskAccess(
    householdId: string,
    taskId: string,
    userId: string
  ): Promise<void> {
    // Verify household access
    await this.householdService.verifyAccess(householdId, userId);

    // Verify task exists and belongs to household
    const task = await this.db.query.tasks.findFirst({
      where: and(
        eq(schema.tasks.id, taskId),
        eq(schema.tasks.household_id, householdId),
        isNull(schema.tasks.deleted_at)
      ),
    });

    if (!task) {
      throw new NotFoundError('Task not found');
    }
  }

  /**
   * Schedule subtask reminders if enabled
   */
  private async scheduleSubtaskNotifications(
    subtask: typeof schema.maintenanceSubtasks.$inferSelect,
    householdId: string,
    parentTask: typeof schema.tasks.$inferSelect
  ): Promise<void> {
    try {
      // Skip if reminders are disabled
      if (!subtask.reminder_enabled || !subtask.reminder_date) {
        await this.notificationService.cancelTaskReminders(subtask.id);
        return;
      }

      // Get target user (use parent task's assigned user or all household members)
      const targetUserId = parentTask.assigned_to;

      const subtaskTitle = `${subtask.title} (part of ${parentTask.title})`;
      const reminderDate = new Date(subtask.reminder_date);

      if (targetUserId) {
        await this.notificationService.scheduleTaskReminder(
          subtask.id,
          targetUserId,
          householdId,
          subtaskTitle,
          reminderDate,
          subtask.reminder_days_before || 1
        );
      } else {
        // Schedule for all household members
        const members = await this.getHouseholdMemberIds(householdId);
        for (const userId of members) {
          await this.notificationService.scheduleTaskReminder(
            subtask.id,
            userId,
            householdId,
            subtaskTitle,
            reminderDate,
            subtask.reminder_days_before || 1
          );
        }
      }
    } catch (error) {
      console.error('Failed to schedule subtask notifications:', error);
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
      );

    return members.map((m) => m.user_id);
  }

  /**
   * Format subtask for API response
   */
  private formatSubtask(subtask: typeof schema.maintenanceSubtasks.$inferSelect): MaintenanceSubtask {
    return {
      id: subtask.id,
      task_id: subtask.task_id,
      title: subtask.title,
      description: subtask.description,
      sort_order: subtask.sort_order,
      is_completed: subtask.is_completed,
      completed_at: subtask.completed_at,
      completed_by: subtask.completed_by
        ? { id: subtask.completed_by, display_name: null } // Will be populated by join if needed
        : null,
      reminder_enabled: subtask.reminder_enabled || false,
      reminder_days_before: subtask.reminder_days_before || 1,
      reminder_time: subtask.reminder_time || '09:00',
      reminder_date: subtask.reminder_date,
      created_at: subtask.created_at,
      updated_at: subtask.updated_at,
    };
  }

  /**
   * Create a new subtask
   */
  async createSubtask(
    householdId: string,
    taskId: string,
    userId: string,
    input: CreateSubtaskRequest
  ): Promise<MaintenanceSubtask> {
    // Validate access
    await this.verifyTaskAccess(householdId, taskId, userId);

    // Validate input
    this.validateTitle(input.title);
    this.validateDescription(input.description);
    this.validateReminderSettings(input.reminder_days_before, input.reminder_time);

    // Auto-calculate sort_order if not provided
    let sortOrder = input.sort_order ?? 0;
    if (sortOrder === 0 || input.sort_order === undefined) {
      const maxOrder = await this.db
        .select({ max: sql<number>`MAX(${schema.maintenanceSubtasks.sort_order})` })
        .from(schema.maintenanceSubtasks)
        .where(
          and(
            eq(schema.maintenanceSubtasks.task_id, taskId),
            isNull(schema.maintenanceSubtasks.deleted_at)
          )
        );

      sortOrder = (maxOrder[0]?.max ?? -1) + 1;
    }

    // Get parent task for reminder scheduling
    const parentTask = await this.db.query.tasks.findFirst({
      where: eq(schema.tasks.id, taskId),
    });

    if (!parentTask) {
      throw new NotFoundError('Parent task not found');
    }

    // Calculate reminder date if enabled
    let reminderDate: string | null = null;
    if (input.reminder_enabled && parentTask.next_due_date) {
      const dueDate = new Date(parentTask.next_due_date);
      const daysBefore = input.reminder_days_before || 1;
      const reminderDateObj = new Date(dueDate);
      reminderDateObj.setDate(reminderDateObj.getDate() - daysBefore);
      reminderDate = reminderDateObj.toISOString();
    }

    // Create subtask
    const id = generateId();
    const nowTimestamp = now();

    await this.db.insert(schema.maintenanceSubtasks).values({
      id,
      task_id: taskId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      sort_order: sortOrder,
      is_completed: false,
      completed_at: null,
      completed_by: null,
      reminder_enabled: input.reminder_enabled || false,
      reminder_days_before: input.reminder_days_before || 1,
      reminder_time: input.reminder_time || '09:00',
      reminder_date: reminderDate,
      created_at: nowTimestamp,
      updated_at: nowTimestamp,
      updated_by: userId,
      deleted_at: null,
    });

    // Fetch created subtask
    const subtask = await this.db.query.maintenanceSubtasks.findFirst({
      where: eq(schema.maintenanceSubtasks.id, id),
    });

    if (!subtask) {
      throw new Error('Failed to create subtask');
    }

    // Schedule notifications if enabled
    if (input.reminder_enabled) {
      await this.scheduleSubtaskNotifications(subtask, householdId, parentTask);
    }

    return this.formatSubtask(subtask);
  }

  /**
   * Get a single subtask
   */
  async getSubtask(
    householdId: string,
    taskId: string,
    subtaskId: string,
    userId: string
  ): Promise<MaintenanceSubtask> {
    await this.verifyTaskAccess(householdId, taskId, userId);

    const subtask = await this.db.query.maintenanceSubtasks.findFirst({
      where: and(
        eq(schema.maintenanceSubtasks.id, subtaskId),
        eq(schema.maintenanceSubtasks.task_id, taskId),
        isNull(schema.maintenanceSubtasks.deleted_at)
      ),
    });

    if (!subtask) {
      throw new NotFoundError('Subtask not found');
    }

    return this.formatSubtask(subtask);
  }

  /**
   * List all subtasks for a task (ordered by sort_order)
   */
  async listSubtasks(
    householdId: string,
    taskId: string,
    userId: string
  ): Promise<MaintenanceSubtask[]> {
    await this.verifyTaskAccess(householdId, taskId, userId);

    const subtasks = await this.db.query.maintenanceSubtasks.findMany({
      where: and(
        eq(schema.maintenanceSubtasks.task_id, taskId),
        isNull(schema.maintenanceSubtasks.deleted_at)
      ),
      orderBy: [schema.maintenanceSubtasks.sort_order],
    });

    return subtasks.map((s) => this.formatSubtask(s));
  }

  /**
   * Update a subtask
   */
  async updateSubtask(
    householdId: string,
    taskId: string,
    subtaskId: string,
    userId: string,
    input: UpdateSubtaskRequest
  ): Promise<MaintenanceSubtask> {
    await this.verifyTaskAccess(householdId, taskId, userId);

    // Validate input
    if (input.title !== undefined) {
      this.validateTitle(input.title);
    }
    if (input.description !== undefined) {
      this.validateDescription(input.description);
    }
    this.validateReminderSettings(input.reminder_days_before, input.reminder_time);

    // Check subtask exists
    const existingSubtask = await this.db.query.maintenanceSubtasks.findFirst({
      where: and(
        eq(schema.maintenanceSubtasks.id, subtaskId),
        eq(schema.maintenanceSubtasks.task_id, taskId),
        isNull(schema.maintenanceSubtasks.deleted_at)
      ),
    });

    if (!existingSubtask) {
      throw new NotFoundError('Subtask not found');
    }

    // Get parent task for reminder scheduling
    const parentTask = await this.db.query.tasks.findFirst({
      where: eq(schema.tasks.id, taskId),
    });

    if (!parentTask) {
      throw new NotFoundError('Parent task not found');
    }

    // Recalculate reminder date if reminder settings changed
    let reminderDate = existingSubtask.reminder_date;
    if (
      input.reminder_enabled !== undefined ||
      input.reminder_days_before !== undefined
    ) {
      const reminderEnabled = input.reminder_enabled ?? existingSubtask.reminder_enabled;
      if (reminderEnabled && parentTask.next_due_date) {
        const dueDate = new Date(parentTask.next_due_date);
        const daysBefore =
          input.reminder_days_before ??
          existingSubtask.reminder_days_before ??
          1;
        const reminderDateObj = new Date(dueDate);
        reminderDateObj.setDate(reminderDateObj.getDate() - daysBefore);
        reminderDate = reminderDateObj.toISOString();
      } else {
        reminderDate = null;
      }
    }

    // Update subtask
    await this.db
      .update(schema.maintenanceSubtasks)
      .set({
        title: input.title !== undefined ? input.title.trim() : existingSubtask.title,
        description:
          input.description !== undefined
            ? input.description?.trim() || null
            : existingSubtask.description,
        reminder_enabled:
          input.reminder_enabled ?? existingSubtask.reminder_enabled,
        reminder_days_before:
          input.reminder_days_before ?? existingSubtask.reminder_days_before,
        reminder_time:
          input.reminder_time ?? existingSubtask.reminder_time,
        reminder_date: reminderDate,
        updated_at: now(),
        updated_by: userId,
      })
      .where(eq(schema.maintenanceSubtasks.id, subtaskId));

    // Fetch updated subtask
    const updated = await this.db.query.maintenanceSubtasks.findFirst({
      where: eq(schema.maintenanceSubtasks.id, subtaskId),
    });

    if (!updated) {
      throw new Error('Failed to update subtask');
    }

    // Reschedule notifications if needed
    await this.scheduleSubtaskNotifications(updated, householdId, parentTask);

    return this.formatSubtask(updated);
  }

  /**
   * Delete a subtask (soft delete)
   */
  async deleteSubtask(
    householdId: string,
    taskId: string,
    subtaskId: string,
    userId: string
  ): Promise<void> {
    await this.verifyTaskAccess(householdId, taskId, userId);

    // Check subtask exists
    const subtask = await this.db.query.maintenanceSubtasks.findFirst({
      where: and(
        eq(schema.maintenanceSubtasks.id, subtaskId),
        eq(schema.maintenanceSubtasks.task_id, taskId),
        isNull(schema.maintenanceSubtasks.deleted_at)
      ),
    });

    if (!subtask) {
      throw new NotFoundError('Subtask not found');
    }

    // Soft delete
    await this.db
      .update(schema.maintenanceSubtasks)
      .set({
        deleted_at: now(),
        updated_by: userId,
      })
      .where(eq(schema.maintenanceSubtasks.id, subtaskId));

    // Cancel notifications
    await this.notificationService.cancelTaskReminders(subtaskId);
  }

  /**
   * Complete a subtask
   */
  async completeSubtask(
    householdId: string,
    taskId: string,
    subtaskId: string,
    userId: string
  ): Promise<{ subtask: MaintenanceSubtask }> {
    await this.verifyTaskAccess(householdId, taskId, userId);

    // Check subtask exists and is not already completed
    const subtask = await this.db.query.maintenanceSubtasks.findFirst({
      where: and(
        eq(schema.maintenanceSubtasks.id, subtaskId),
        eq(schema.maintenanceSubtasks.task_id, taskId),
        isNull(schema.maintenanceSubtasks.deleted_at)
      ),
    });

    if (!subtask) {
      throw new NotFoundError('Subtask not found');
    }

    if (subtask.is_completed) {
      throw new BadRequestError('Subtask is already completed');
    }

    // Mark as completed
    await this.db
      .update(schema.maintenanceSubtasks)
      .set({
        is_completed: true,
        completed_at: now(),
        completed_by: userId,
        updated_at: now(),
        updated_by: userId,
      })
      .where(eq(schema.maintenanceSubtasks.id, subtaskId));

    // Fetch updated subtask
    const updated = await this.db.query.maintenanceSubtasks.findFirst({
      where: eq(schema.maintenanceSubtasks.id, subtaskId),
    });

    if (!updated) {
      throw new Error('Failed to complete subtask');
    }

    return {
      subtask: this.formatSubtask(updated),
    };
  }

  /**
   * Uncomplete a subtask (mark as incomplete)
   */
  async uncompleteSubtask(
    householdId: string,
    taskId: string,
    subtaskId: string,
    userId: string
  ): Promise<{ subtask: MaintenanceSubtask }> {
    await this.verifyTaskAccess(householdId, taskId, userId);

    // Check subtask exists
    const subtask = await this.db.query.maintenanceSubtasks.findFirst({
      where: and(
        eq(schema.maintenanceSubtasks.id, subtaskId),
        eq(schema.maintenanceSubtasks.task_id, taskId),
        isNull(schema.maintenanceSubtasks.deleted_at)
      ),
    });

    if (!subtask) {
      throw new NotFoundError('Subtask not found');
    }

    if (!subtask.is_completed) {
      throw new BadRequestError('Subtask is not completed');
    }

    // Mark as incomplete
    await this.db
      .update(schema.maintenanceSubtasks)
      .set({
        is_completed: false,
        completed_at: null,
        completed_by: null,
        updated_at: now(),
        updated_by: userId,
      })
      .where(eq(schema.maintenanceSubtasks.id, subtaskId));

    // Fetch updated subtask
    const updated = await this.db.query.maintenanceSubtasks.findFirst({
      where: eq(schema.maintenanceSubtasks.id, subtaskId),
    });

    if (!updated) {
      throw new Error('Failed to uncomplete subtask');
    }

    return {
      subtask: this.formatSubtask(updated),
    };
  }

  /**
   * Reorder subtasks (batch operation)
   */
  async reorderSubtasks(
    householdId: string,
    taskId: string,
    userId: string,
    subtaskIds: string[]
  ): Promise<MaintenanceSubtask[]> {
    await this.verifyTaskAccess(householdId, taskId, userId);

    // Validate array is not empty
    if (!subtaskIds || subtaskIds.length === 0) {
      throw new BadRequestError('Subtask IDs array cannot be empty');
    }

    // Validate all subtask IDs belong to this task
    const existingSubtasks = await this.db.query.maintenanceSubtasks.findMany({
      where: and(
        eq(schema.maintenanceSubtasks.task_id, taskId),
        isNull(schema.maintenanceSubtasks.deleted_at)
      ),
    });

    // Ensure all subtasks are included (no partial reorder)
    if (subtaskIds.length !== existingSubtasks.length) {
      throw new BadRequestError(
        `Expected ${existingSubtasks.length} subtask IDs, but received ${subtaskIds.length}`
      );
    }

    const existingIds = new Set(existingSubtasks.map((s) => s.id));
    for (const id of subtaskIds) {
      if (!existingIds.has(id)) {
        throw new BadRequestError(`Subtask ${id} not found or doesn't belong to this task`);
      }
    }

    // Update sort_order for each subtask
    const nowTimestamp = now();
    for (let i = 0; i < subtaskIds.length; i++) {
      await this.db
        .update(schema.maintenanceSubtasks)
        .set({
          sort_order: i,
          updated_at: nowTimestamp,
          updated_by: userId,
        })
        .where(eq(schema.maintenanceSubtasks.id, subtaskIds[i]));
    }

    // Return reordered subtasks
    return this.listSubtasks(householdId, taskId, userId);
  }

  /**
   * Calculate subtask progress for a task
   */
  async getSubtaskProgress(taskId: string): Promise<SubtaskProgress> {
    const result = await this.db
      .select({
        total: sql<number>`COUNT(*)`,
        completed: sql<number>`SUM(CASE WHEN ${schema.maintenanceSubtasks.is_completed} = 1 THEN 1 ELSE 0 END)`,
      })
      .from(schema.maintenanceSubtasks)
      .where(
        and(
          eq(schema.maintenanceSubtasks.task_id, taskId),
          isNull(schema.maintenanceSubtasks.deleted_at)
        )
      );

    const total = result[0]?.total || 0;
    const completed = result[0]?.completed || 0;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    return {
      completed,
      total,
      percentage,
    };
  }

  /**
   * Reset all subtasks for a recurring task (mark all as incomplete)
   * Called when a recurring task is completed and creates a new instance
   */
  async resetSubtasksForRecurrence(taskId: string, userId: string): Promise<void> {
    await this.db
      .update(schema.maintenanceSubtasks)
      .set({
        is_completed: false,
        completed_at: null,
        completed_by: null,
        updated_at: now(),
        updated_by: userId,
      })
      .where(
        and(
          eq(schema.maintenanceSubtasks.task_id, taskId),
          isNull(schema.maintenanceSubtasks.deleted_at)
        )
      );
  }
}
