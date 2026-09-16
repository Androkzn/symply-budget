import { D1Database } from '@cloudflare/workers-types';
import { and, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';

import { tasks } from '../db/schema';
import { Env } from '../types';
import { nowIso } from '../utils/id';

import { d1Changes, releaseCronLease, tryAcquireCronLease } from './cron-lease';
import { SmartNotificationGateway } from './smart-notification-gateway';

/** Stale reminder claims are reclaimed after this TTL (crash-after-claim safety). */
export const REMINDER_CLAIM_TTL_MS = 5 * 60 * 1000;
export const MAX_REMINDER_DELIVERY_ATTEMPTS = 5;
const PROCESS_REMINDERS_CRON_JOB = 'process_reminders';

/** Inputs the smart-reminder timing derivation needs from an enriched task. */
export interface ReminderPlanInput {
  priority_severity: string | null;
  risk_level: string | null;
  /** AI's preferred deadline in days-from-now, if any. */
  suggested_due_in_days: number | null;
}

export interface ReminderPlan {
  /** Days from now the task should be completed by. */
  due_in_days: number;
  /** How many days before the due date to send the first nudge. */
  reminder_days_before: number;
}

/**
 * Derive smart reminder timing from an enriched task's priority, risk, and
 * effort — so a critical fire-hazard fix nags within a day while an optional
 * comfort task waits weeks. Pure + deterministic so it's trivially unit-tested.
 *
 * The AI's `suggested_due_in_days` wins when present; otherwise we fall back to
 * a priority-driven default. High RISK (independent of priority) tightens both
 * the deadline and the nudge lead time as a safety backstop.
 */
export function deriveReminderPlan(input: ReminderPlanInput): ReminderPlan {
  const priority = input.priority_severity ?? 'nice_to_have';

  // Priority-driven default deadline when the AI didn't pin one.
  const priorityDueDefault: Record<string, number> = {
    critical: 1,
    urgent: 1,
    high: 3,
    medium: 7,
    low: 14,
    nice_to_have: 30,
  };

  let dueInDays =
    input.suggested_due_in_days !== null && input.suggested_due_in_days >= 0
      ? input.suggested_due_in_days
      : priorityDueDefault[priority] ?? 7;

  // High/critical risk is a safety backstop: never let a dangerous task drift
  // out past a tight window even if priority/AI suggested longer.
  if (input.risk_level === 'critical') dueInDays = Math.min(dueInDays, 1);
  else if (input.risk_level === 'high') dueInDays = Math.min(dueInDays, 3);

  // How early to nudge, by priority. Capped so it never precedes "now".
  const priorityLeadDefault: Record<string, number> = {
    critical: 0,
    urgent: 0,
    high: 1,
    medium: 2,
    low: 3,
    nice_to_have: 3,
  };
  let reminderDaysBefore = priorityLeadDefault[priority] ?? 1;
  // For same-/next-day tasks, nudge on the day itself.
  reminderDaysBefore = Math.min(reminderDaysBefore, Math.max(0, dueInDays));

  return { due_in_days: dueInDays, reminder_days_before: reminderDaysBefore };
}

type TaskRow = typeof tasks.$inferSelect;

interface UserWithPushToken {
  user_id: string;
  household_id: string;
  email: string;
}

export class ReminderService {
  private db: DrizzleD1Database;
  private rawDb: D1Database;
  private env: Env;

  constructor(env: Env, db: D1Database) {
    this.env = env;
    this.rawDb = db;
    this.db = drizzle(db);
  }

  /**
   * Process all reminders for tasks due soon
   * This should be called by a cron job
   */
  async processReminders(): Promise<{
    processed: number;
    sent: number;
    errors: string[];
  }> {
    const leaseHolder = crypto.randomUUID();
    if (!(await tryAcquireCronLease(this.db, PROCESS_REMINDERS_CRON_JOB, leaseHolder))) {
      return { processed: 0, sent: 0, errors: [] };
    }

    try {
      return await this.processRemindersWithClaims();
    } finally {
      await releaseCronLease(this.db, PROCESS_REMINDERS_CRON_JOB, leaseHolder);
    }
  }

  private async processRemindersWithClaims(): Promise<{
    processed: number;
    sent: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let processed = 0;
    let sent = 0;
    const timestamp = nowIso();
    const staleThreshold = new Date(Date.now() - REMINDER_CLAIM_TTL_MS).toISOString();
    const claimOwner = crypto.randomUUID();

    try {
      const tasksToRemind = await this.getTasksNeedingReminders(timestamp, staleThreshold);
      processed = tasksToRemind.length;

      for (const task of tasksToRemind) {
        const claimed = await this.claimTaskReminder(task.id, claimOwner, timestamp, staleThreshold);
        if (!claimed) continue;

        try {
          const users = await this.getHouseholdUsersWithPushTokens(task.household_id);

          for (const user of users) {
            if (this.shouldSendNotification(user)) {
              await this.sendTaskReminder(task, user);
              sent++;
            }
          }

          await this.completeTaskReminderClaim(task.id, timestamp);
        } catch (error) {
          await this.releaseTaskReminderClaim(task.id);
          errors.push(`Failed to process task ${task.id}: ${error}`);
        }
      }
    } catch (error) {
      errors.push(`Failed to get tasks: ${error}`);
    }

    return { processed, sent, errors };
  }

  /**
   * Get tasks that need reminders sent
   */
  private async getTasksNeedingReminders(
    nowIso: string,
    staleThreshold: string
  ): Promise<TaskRow[]> {
    const today = nowIso.split('T')[0];

    return this.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.reminder_enabled, true),
          eq(tasks.is_active, true),
          or(isNull(tasks.blocked), eq(tasks.blocked, false)),
          isNotNull(tasks.next_due_date),
          or(isNull(tasks.snooze_until), lt(tasks.snooze_until, today)),
          sql`date(${tasks.next_due_date}, '-' || ${tasks.reminder_days_before} || ' days') <= ${today}`,
          sql`${tasks.next_due_date} >= ${today}`,
          or(
            isNull(tasks.last_reminder_sent_at),
            and(
              eq(tasks.reminder_repeat, true),
              sql`date(${tasks.last_reminder_sent_at}) < ${today}`
            )
          ),
          lt(tasks.reminder_attempt_count, MAX_REMINDER_DELIVERY_ATTEMPTS),
          or(
            isNull(tasks.reminder_claimed_at),
            lt(tasks.reminder_claimed_at, staleThreshold)
          )
        )
      )
      .orderBy(tasks.next_due_date)
      .limit(100)
      .all();
  }

  private async claimTaskReminder(
    taskId: string,
    _claimOwner: string,
    nowIso: string,
    staleThreshold: string
  ): Promise<boolean> {
    const result = await this.db
      .update(tasks)
      .set({ reminder_claimed_at: nowIso })
      .where(
        and(
          eq(tasks.id, taskId),
          lt(tasks.reminder_attempt_count, MAX_REMINDER_DELIVERY_ATTEMPTS),
          or(isNull(tasks.reminder_claimed_at), lt(tasks.reminder_claimed_at, staleThreshold))
        )
      )
      .run();
    return d1Changes(result) === 1;
  }

  private async completeTaskReminderClaim(taskId: string, nowIso: string): Promise<void> {
    await this.db
      .update(tasks)
      .set({
        last_reminder_sent_at: nowIso,
        reminder_claimed_at: null,
      })
      .where(eq(tasks.id, taskId));
  }

  private async releaseTaskReminderClaim(taskId: string): Promise<void> {
    const row = await this.db
      .select({ reminder_attempt_count: tasks.reminder_attempt_count })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .get();

    await this.db
      .update(tasks)
      .set({
        reminder_claimed_at: null,
        reminder_attempt_count: (row?.reminder_attempt_count ?? 0) + 1,
      })
      .where(eq(tasks.id, taskId));
  }

  /**
   * Get users in a household with push tokens enabled
   */
  private async getHouseholdUsersWithPushTokens(householdId: string): Promise<UserWithPushToken[]> {
    const query = `
      SELECT
        u.id as user_id,
        hm.household_id,
        u.email
      FROM users u
      JOIN household_members hm ON u.id = hm.user_id
      WHERE hm.household_id = ?
        AND EXISTS (
          SELECT 1 FROM push_tokens pt
          WHERE pt.user_id = u.id AND pt.is_active = 1
        )
      LIMIT 50
    `;

    const result = await this.rawDb.prepare(query).bind(householdId).all<UserWithPushToken>();

    return result.results || [];
  }

  /**
   * Check if user wants to receive this type of notification
   */
  private shouldSendNotification(_user: UserWithPushToken): boolean {
    return true;
  }

  /**
   * Send a reminder notification for a task
   */
  private async sendTaskReminder(task: TaskRow, user: UserWithPushToken): Promise<void> {
    const daysUntilDue = this.calculateDaysUntilDue(task.next_due_date!);
    let title: string;
    let body: string;

    if (daysUntilDue <= 0) {
      title = 'Task Due Today';
      body = `"${task.title}" is due today!`;
    } else if (daysUntilDue === 1) {
      title = 'Task Due Tomorrow';
      body = `"${task.title}" is due tomorrow.`;
    } else {
      title = 'Upcoming Task';
      body = `"${task.title}" is due in ${daysUntilDue} days.`;
    }

    const gateway = new SmartNotificationGateway(this.env, this.rawDb);
    await gateway.enqueue({
      producerType: 'task_reminder',
      householdId: task.household_id,
      recipients: [user.user_id],
      title,
      body,
      data: { taskId: task.id, type: 'maintenance_task' },
      referenceType: 'maintenance_task',
      referenceId: task.id,
    });
  }

  private calculateDaysUntilDue(dueDate: string): number {
    const now = new Date();
    const due = new Date(dueDate);
    const diffTime = due.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  /**
   * Snooze a task reminder
   */
  async snoozeReminder(taskId: string, householdId: string, days: number): Promise<void> {
    const snoozeUntil = new Date();
    snoozeUntil.setDate(snoozeUntil.getDate() + days);
    const snoozeDate = snoozeUntil.toISOString().split('T')[0];

    await this.rawDb
      .prepare('UPDATE tasks SET snooze_until = ? WHERE id = ? AND household_id = ?')
      .bind(snoozeDate, taskId, householdId)
      .run();
  }

  /**
   * Mark a task as completed and schedule next occurrence
   */
  async completeTask(taskId: string, householdId: string): Promise<void> {
    const now = new Date();

    const task = await this.rawDb
      .prepare('SELECT * FROM tasks WHERE id = ? AND household_id = ?')
      .bind(taskId, householdId)
      .first<TaskRow>();

    if (!task) return;

    let nextDueDate: string | null = null;
    if (task.next_due_date) {
      const currentDue = new Date(task.next_due_date);
      nextDueDate = this.calculateNextDueDate(currentDue, task.system_category || 'monthly');
    }

    await this.db
      .update(tasks)
      .set({
        next_due_date: nextDueDate,
        last_reminder_sent_at: null,
        reminder_claimed_at: null,
        snooze_until: null,
        updated_at: now.toISOString(),
      })
      .where(eq(tasks.id, taskId));
  }

  private calculateNextDueDate(fromDate: Date, frequency: string): string {
    const nextDate = new Date(fromDate);

    switch (frequency) {
      case 'daily':
        nextDate.setDate(nextDate.getDate() + 1);
        break;
      case 'weekly':
        nextDate.setDate(nextDate.getDate() + 7);
        break;
      case 'monthly':
        nextDate.setMonth(nextDate.getMonth() + 1);
        break;
      case 'quarterly':
        nextDate.setMonth(nextDate.getMonth() + 3);
        break;
      case 'yearly':
        nextDate.setFullYear(nextDate.getFullYear() + 1);
        break;
      case '3_years':
        nextDate.setFullYear(nextDate.getFullYear() + 3);
        break;
      case '5_years':
        nextDate.setFullYear(nextDate.getFullYear() + 5);
        break;
      default:
        nextDate.setMonth(nextDate.getMonth() + 1);
    }

    return nextDate.toISOString().split('T')[0];
  }

  /**
   * Process overdue tasks and send notifications
   */
  async processOverdueTasks(): Promise<{ processed: number; sent: number }> {
    const today = nowIso().split('T')[0];
    let processed = 0;
    let sent = 0;

    const query = `
      SELECT * FROM tasks
      WHERE is_active = 1
        AND (blocked IS NULL OR blocked = 0)
        AND next_due_date IS NOT NULL
        AND next_due_date < ?
        AND (snooze_until IS NULL OR snooze_until < ?)
      ORDER BY next_due_date ASC
      LIMIT 50
    `;

    const result = await this.rawDb.prepare(query).bind(today, today).all<TaskRow>();

    for (const task of result.results || []) {
      processed++;
      const users = await this.getHouseholdUsersWithPushTokens(task.household_id);

      for (const user of users) {
        if (this.shouldSendNotification(user)) {
          const daysOverdue = Math.abs(this.calculateDaysUntilDue(task.next_due_date!));
          const gateway = new SmartNotificationGateway(this.env, this.rawDb);
          await gateway.enqueue({
            producerType: 'task_overdue',
            householdId: task.household_id,
            recipients: [user.user_id],
            title: 'Overdue Task',
            body: `"${task.title}" is ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue.`,
            data: { taskId: task.id, type: 'task_overdue' },
            referenceType: 'maintenance_task',
            referenceId: task.id,
          });
          sent++;
        }
      }
    }

    return { processed, sent };
  }
}
