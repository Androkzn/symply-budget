// Tool Executor - Executes AI function calls with actual database operations
import { eq, and, desc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import * as schema from '../../db/schema';
import * as maintenanceSchema from '../../db/schema-maintenance';
import * as notificationSchema from '../../db/schema-notifications';
import type { Env } from '../../types';
import { nowIso } from '../../utils/id';

/**
 * Calculate next due date based on frequency
 */
function calculateNextDueDate(frequency: string, customIntervalDays?: number): string {
  const now = new Date();
  const nextDate = new Date(now);

  switch (frequency) {
    case 'daily':
      nextDate.setDate(now.getDate() + 1);
      break;
    case 'weekly':
      nextDate.setDate(now.getDate() + 7);
      break;
    case 'monthly':
      nextDate.setMonth(now.getMonth() + 1);
      break;
    case 'quarterly':
      nextDate.setMonth(now.getMonth() + 3);
      break;
    case 'yearly':
      nextDate.setFullYear(now.getFullYear() + 1);
      break;
    case 'custom':
      if (customIntervalDays) {
        nextDate.setDate(now.getDate() + customIntervalDays);
      }
      break;
  }

  return nextDate.toISOString().split('T')[0]; // YYYY-MM-DD format
}

/**
 * Execute a tool call with actual database operations
 */
export async function executeToolCall(
  toolName: string,
  args: Record<string, any>,
  userId: string,
  householdId: string | undefined,
  env: Env
): Promise<{ success: boolean; result?: any; error?: string }> {
  console.log('[ToolExecutor] Executing:', toolName, args);

  const db = drizzle(env.DB, { schema: { ...schema, ...maintenanceSchema, ...notificationSchema } });

  try {
    switch (toolName) {
      // ==================== TASK MANAGEMENT ====================

      case 'createMaintenanceTask': {
        if (!householdId) {
          return { success: false, error: 'No household selected' };
        }

        // Calculate next due date if not provided
        const nextDueDate =
          args.nextDueDate ||
          calculateNextDueDate(args.frequency, args.customIntervalDays);

        // Create task
        const taskId = crypto.randomUUID();
        await db.insert(schema.tasks).values({
          id: taskId,
          household_id: householdId,
          title: args.title,
          description: args.description || null,
          system_category: args.category || null,
          frequency: args.frequency,
          custom_interval_days: args.customIntervalDays || null,
          next_due_date: nextDueDate,
          reminder_days_before: args.reminderDaysBefore || 1,
          is_active: true,
          source: 'ai_generated',
          created_at: nowIso(),
          updated_at: nowIso(),
        });

        return {
          success: true,
          result: {
            taskId,
            message: `Task "${args.title}" created successfully!`,
            nextDueDate,
          },
        };
      }

      case 'getTasks': {
        if (!householdId) {
          return { success: false, error: 'No household selected' };
        }

        // Build filters
        const filters: any[] = [eq(schema.tasks.household_id, householdId)];

        if (args.category) {
          filters.push(eq(schema.tasks.system_category, args.category));
        }

        if (args.isActive !== undefined) {
          filters.push(eq(schema.tasks.is_active, args.isActive));
        }

        // Query tasks
        const tasks = await db
          .select()
          .from(schema.tasks)
          .where(and(...filters))
          .orderBy(schema.tasks.next_due_date)
          .limit(args.limit || 50);

        return {
          success: true,
          result: {
            count: tasks.length,
            tasks: tasks.map((task) => ({
              id: task.id,
              title: task.title,
              description: task.description,
              category: task.system_category,
              frequency: task.frequency,
              nextDueDate: task.next_due_date,
              isActive: task.is_active,
            })),
          },
        };
      }

      case 'completeTask': {
        if (!householdId) {
          return { success: false, error: 'No household selected' };
        }

        // Verify task exists and belongs to household
        const task = await db
          .select()
          .from(schema.tasks)
          .where(
            and(
              eq(schema.tasks.id, args.taskId),
              eq(schema.tasks.household_id, householdId)
            )
          )
          .get();

        if (!task) {
          return { success: false, error: 'Task not found' };
        }

        // Record completion
        const completionId = crypto.randomUUID();
        const completedAt = nowIso();

        await db.insert(schema.maintenanceCompletions).values({
          id: completionId,
          task_id: args.taskId,
          completed_by: userId,
          completed_at: completedAt,
          notes: args.notes || null,
          created_at: completedAt,
        });

        // Update task's next due date
        const nextDueDate = calculateNextDueDate(
          task.frequency,
          task.custom_interval_days || undefined
        );

        await db
          .update(schema.tasks)
          .set({
            last_completed_at: completedAt,
            next_due_date: nextDueDate,
            updated_at: completedAt,
          })
          .where(eq(schema.tasks.id, args.taskId));

        return {
          success: true,
          result: {
            message: `Task "${task.title}" completed successfully!`,
            nextDueDate,
          },
        };
      }

      case 'getTaskHistory': {
        if (!householdId) {
          return { success: false, error: 'No household selected' };
        }

        // Verify task exists and belongs to household
        const task = await db
          .select()
          .from(schema.tasks)
          .where(
            and(
              eq(schema.tasks.id, args.taskId),
              eq(schema.tasks.household_id, householdId)
            )
          )
          .get();

        if (!task) {
          return { success: false, error: 'Task not found' };
        }

        // Get completion history
        const completions = await db
          .select()
          .from(schema.maintenanceCompletions)
          .where(eq(schema.maintenanceCompletions.task_id, args.taskId))
          .orderBy(desc(schema.maintenanceCompletions.completed_at))
          .limit(50);

        return {
          success: true,
          result: {
            taskTitle: task.title,
            count: completions.length,
            history: completions.map((c) => ({
              id: c.id,
              completedAt: c.completed_at,
              completedBy: c.completed_by,
              notes: c.notes,
            })),
          },
        };
      }

      // ==================== ONBOARDING ====================

      case 'getOnboardingStatus': {
        // Check household setup status
        const householdsCount = await db
          .select()
          .from(schema.households)
          .where(
            eq(
              schema.households.id,
              db
                .select({ household_id: schema.householdMembers.household_id })
                .from(schema.householdMembers)
                .where(eq(schema.householdMembers.user_id, userId))
                .limit(1)
            )
          );

        const reportsCount = householdId
          ? await db
              .select()
              .from(schema.reports)
              .where(eq(schema.reports.household_id, householdId))
          : [];

        const spacesCount = householdId
          ? await db
              .select()
              .from(schema.householdSpaces)
              .where(eq(schema.householdSpaces.household_id, householdId))
          : [];

        const garbageScheduleExists = householdId
          ? await db
              .select()
              .from(maintenanceSchema.garbageSchedules)
              .where(eq(maintenanceSchema.garbageSchedules.household_id, householdId))
              .get()
          : null;

        const completedSteps = [];
        if (householdsCount.length > 0) completedSteps.push('HOUSEHOLDS');
        if (reportsCount.length > 0) completedSteps.push('REPORTS');
        if (spacesCount.length > 0) completedSteps.push('FLOOR_PLAN');
        if (garbageScheduleExists) completedSteps.push('GARBAGE_SCHEDULE');

        return {
          success: true,
          result: {
            completedSteps,
            totalSteps: 5,
            percentComplete: Math.round((completedSteps.length / 5) * 100),
            nextStep:
              completedSteps.length < 5
                ? ['HOUSEHOLDS', 'REPORTS', 'FLOOR_PLAN', 'GARBAGE_SCHEDULE', 'INVITE_MEMBERS'][
                    completedSteps.length
                  ]
                : null,
          },
        };
      }

      case 'addHousehold': {
        const householdId = crypto.randomUUID();
        const memberId = crypto.randomUUID();
        const now = nowIso();

        // Create household
        await db.insert(schema.households).values({
          id: householdId,
          name: args.name,
          address_line1: args.addressLine1 || null,
          city: args.city || null,
          state_province: args.stateProvince || null,
          postal_code: args.postalCode || null,
          country: args.country || 'CA',
          created_at: now,
          updated_at: now,
        });

        // Add user as owner
        await db.insert(schema.householdMembers).values({
          id: memberId,
          household_id: householdId,
          user_id: userId,
          role: 'owner',
          joined_at: now,
          created_at: now,
          updated_at: now,
        });

        return {
          success: true,
          result: {
            householdId,
            message: `Household "${args.name}" created successfully!`,
          },
        };
      }

      // ==================== GARBAGE SCHEDULE ====================

      case 'addGarbageSchedule': {
        if (!householdId) {
          return { success: false, error: 'No household selected' };
        }

        const scheduleId = crypto.randomUUID();
        const now = nowIso();

        // Check if schedule already exists
        const existingSchedule = await db
          .select()
          .from(maintenanceSchema.garbageSchedules)
          .where(eq(maintenanceSchema.garbageSchedules.household_id, householdId))
          .get();

        if (existingSchedule) {
          // Update existing schedule
          await db
            .update(maintenanceSchema.garbageSchedules)
            .set({
              municipality: args.municipality,
              schedules: JSON.stringify(args.schedules || []),
              reminders: args.reminders ? JSON.stringify(args.reminders) : null,
              source: 'ai_generated',
              updated_at: now,
            })
            .where(eq(maintenanceSchema.garbageSchedules.id, existingSchedule.id));

          return {
            success: true,
            result: {
              message: `Garbage schedule updated for ${args.municipality}!`,
              scheduleId: existingSchedule.id,
            },
          };
        } else {
          // Create new schedule
          await db.insert(maintenanceSchema.garbageSchedules).values({
            id: scheduleId,
            household_id: householdId,
            municipality: args.municipality,
            schedules: JSON.stringify(args.schedules || []),
            reminders: args.reminders ? JSON.stringify(args.reminders) : null,
            source: 'ai_generated',
            created_at: now,
            updated_at: now,
          });

          return {
            success: true,
            result: {
              message: `Garbage schedule set up for ${args.municipality}!`,
              scheduleId,
            },
          };
        }
      }

      case 'getNextGarbageCollections': {
        if (!householdId) {
          return { success: false, error: 'No household selected' };
        }

        // Get garbage schedule
        const schedule = await db
          .select()
          .from(maintenanceSchema.garbageSchedules)
          .where(eq(maintenanceSchema.garbageSchedules.household_id, householdId))
          .get();

        if (!schedule) {
          return {
            success: false,
            error: 'No garbage schedule configured. Use "Set up garbage collection" to add one.',
          };
        }

        // Parse schedules
        const schedules = JSON.parse(schedule.schedules || '[]');
        const days = args.days || 30;
        const now = new Date();
        const endDate = new Date();
        endDate.setDate(now.getDate() + days);

        // Calculate next collection dates
        const collections: any[] = [];

        schedules.forEach((s: any) => {
          const collectionDate = new Date(now);
          // Find next occurrence of dayOfWeek
          const dayDiff = (s.dayOfWeek - collectionDate.getDay() + 7) % 7;
          collectionDate.setDate(collectionDate.getDate() + (dayDiff === 0 ? 7 : dayDiff));

          if (collectionDate <= endDate) {
            collections.push({
              type: s.type,
              date: collectionDate.toISOString().split('T')[0],
              frequency: s.frequency,
            });
          }
        });

        return {
          success: true,
          result: {
            municipality: schedule.municipality,
            count: collections.length,
            collections: collections.sort((a, b) => a.date.localeCompare(b.date)),
          },
        };
      }

      // ==================== NOTIFICATIONS ====================

      case 'updateNotificationPreferences': {
        const now = nowIso();

        // Check if preferences exist
        const existingPrefs = await db
          .select()
          .from(notificationSchema.notificationPreferences)
          .where(eq(notificationSchema.notificationPreferences.user_id, userId))
          .get();

        const updates: any = {
          updated_at: now,
        };

        if (args.taskReminders !== undefined) updates.task_reminders = args.taskReminders;
        if (args.taskOverdue !== undefined) updates.task_overdue = args.taskOverdue;
        if (args.garbageCollection !== undefined)
          updates.garbage_collection = args.garbageCollection;
        if (args.reportReady !== undefined) updates.report_ready = args.reportReady;

        if (existingPrefs) {
          // Update existing preferences
          await db
            .update(notificationSchema.notificationPreferences)
            .set(updates)
            .where(eq(notificationSchema.notificationPreferences.id, existingPrefs.id));
        } else {
          // Create new preferences
          await db.insert(notificationSchema.notificationPreferences).values({
            id: crypto.randomUUID(),
            user_id: userId,
            ...updates,
            created_at: now,
          });
        }

        return {
          success: true,
          result: {
            message: 'Notification preferences updated successfully!',
            preferences: {
              taskReminders: updates.task_reminders ?? existingPrefs?.task_reminders ?? true,
              taskOverdue: updates.task_overdue ?? existingPrefs?.task_overdue ?? true,
              garbageCollection:
                updates.garbage_collection ?? existingPrefs?.garbage_collection ?? true,
              reportReady: updates.report_ready ?? existingPrefs?.report_ready ?? true,
            },
          },
        };
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error: any) {
    console.error('[ToolExecutor] Error:', error);
    return { success: false, error: error.message || 'Internal server error' };
  }
}
