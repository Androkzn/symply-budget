import { eq, and, isNull, lte, desc, or, like, notInArray, lt } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';

import { isHomeApiEnabled } from '../config/brand-capabilities';
import { assistantIdentity } from '../db/schema-aihousekeeper';
import {
  pushTokens,
  notificationPreferences,
  scheduledNotifications,
  notificationHistory,
  pushReceiptChecks,
  type PushToken,
  type NotificationPreference,
  type ScheduledNotification,
} from '../db/schema-notifications';
import type { Env } from '../types';
import { NotFoundError } from '../utils/errors';
import { nowIso } from '../utils/id';
import { zonedWallTimeToUtcIso } from '../utils/timezone';

import { ExpoPushClient } from './aihousekeeper/expo-push';
import { isInQuietHours as isInQuietHoursInTimezone } from './aihousekeeper/timezone';
import { d1Changes, releaseCronLease, tryAcquireCronLease } from './cron-lease';
import { NotificationOptimizationService } from './notification-optimization-service';

/** Stale delivery claims are reclaimed after this TTL (crash-after-claim safety). */
export const NOTIFICATION_CLAIM_TTL_MS = 5 * 60 * 1000;
export const MAX_NOTIFICATION_DELIVERY_ATTEMPTS = 5;
/** Upper bound on active push tokens returned per user list. */
const PUSH_TOKENS_LIST_LIMIT = 20;
/** Upper bound on household members resolved for broadcast helpers. */
const HOUSEHOLD_MEMBERS_NOTIFY_LIMIT = 50;
const SCHEDULED_NOTIFICATIONS_CRON_JOB = 'process_scheduled_notifications';

interface SendNotificationOptions {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  referenceType?: string;
  referenceId?: string;
  // Rich notification support (2026 best practices)
  imageUrl?: string;
  categoryId?: string; // For notification actions
  threadId?: string; // For grouping notifications
}

interface ScheduleNotificationOptions extends SendNotificationOptions {
  scheduledFor: Date;
  householdId?: string;
}

// Notification categories with action buttons (2026 best practices)
const NOTIFICATION_CATEGORIES = {
  TASK_REMINDER: 'task_reminder',
  TASK_OVERDUE: 'task_overdue',
  GARBAGE_REMINDER: 'garbage_reminder',
} as const;

// Thread ID prefixes for grouping notifications
const THREAD_PREFIXES = {
  TASK: 'task-',
  GARBAGE: 'garbage-',
  HOUSEHOLD: 'household-',
  REPORT: 'report-',
} as const;

/** Parse an 'HH:MM' string into [hour, minute], defaulting to 09:00. */
function parseHhmm(hhmm: string | null | undefined): [number, number] {
  const [h, m] = (hhmm || '09:00').split(':');
  const hour = parseInt(h ?? '9', 10);
  const minute = parseInt(m ?? '0', 10);
  return [Number.isNaN(hour) ? 9 : hour, Number.isNaN(minute) ? 0 : minute];
}

/**
 * Shift a date by whole days while preserving its UTC calendar parts. We only
 * use the result to read back Y/M/D (the local wall-clock hour is re-anchored
 * via `zonedWallTimeToUtcIso`), so UTC-day math avoids any DST drift.
 */
function shiftUtcCalendarDate(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/**
 * Resolve a local wall-clock time (HH:MM) on a given date to the exact UTC
 * instant in the provided IANA timezone. `date` supplies the calendar day (read
 * in UTC); `hhmm` supplies the intended local time.
 */
function localTimeOnDateToUtc(date: Date, hhmm: string, timezone: string): Date {
  const [hour, minute] = parseHhmm(hhmm);
  return new Date(
    zonedWallTimeToUtcIso(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      hour,
      minute,
      timezone
    )
  );
}

/**
 * House-domain notification types. On a child app's Worker (Budget/Kaizen/
 * Health) these are filtered out of history + unread counts so each app stays
 * fully independent and never surfaces House notifications that linger in a D1
 * cloned from House during the split. Mirrors the client list in
 * src/utils/notificationVisibility.ts — keep the two in sync.
 */
const HOUSE_DOMAIN_NOTIFICATION_TYPES = [
  'task_reminder',
  'task_overdue',
  'task_assigned',
  'task_completed',
  'task_drafts_ready',
  'maintenance_task',
  'maintenance_suggestions',
  'critical_findings',
  'garbage',
  'garbage_collection',
  'garbage_missed',
  'garbage_reminder',
  'report_ready',
  'weekly_summary',
  'ai_daily_digest',
  'ai_weekly_summary',
  'ai_prediction',
  'ai_suggestion',
  'aihousekeeper_briefing',
  'aihousekeeper_nudge',
  'garden_plan_ready',
  'garden_plan_failed',
];

export class NotificationService {
  private db: DrizzleD1Database;
  private optimizationService: NotificationOptimizationService;
  private expoPush: ExpoPushClient;
  /** House Worker shows all types; child apps hide House-domain notifications. */
  private homeApiEnabled: boolean;

  constructor(env: Env, d1: D1Database) {
    this.db = drizzle(d1);
    this.optimizationService = new NotificationOptimizationService(env, d1);
    this.expoPush = new ExpoPushClient(env.EXPO_ACCESS_TOKEN);
    this.homeApiEnabled = isHomeApiEnabled(env);
  }

  /**
   * Get the optimization service for direct access to advanced features
   */
  getOptimizationService(): NotificationOptimizationService {
    return this.optimizationService;
  }

  // ============ PUSH TOKENS ============

  async registerPushToken(
    userId: string,
    token: string,
    platform: 'ios' | 'android' | 'web',
    deviceName?: string
  ): Promise<PushToken> {
    const id = crypto.randomUUID();
    const now = nowIso();

    // Check if token already exists
    const existing = await this.db
      .select()
      .from(pushTokens)
      .where(eq(pushTokens.token, token))
      .get();

    if (existing) {
      // Update existing token
      await this.db
        .update(pushTokens)
        .set({
          user_id: userId,
          platform,
          device_name: deviceName,
          is_active: true,
          last_used_at: now,
          updated_at: now,
        })
        .where(eq(pushTokens.token, token));

      return { ...existing, user_id: userId, is_active: true };
    }

    // Create new token
    await this.db.insert(pushTokens).values({
      id,
      user_id: userId,
      token,
      platform,
      device_name: deviceName,
      is_active: true,
      last_used_at: now,
      created_at: now,
      updated_at: now,
    });

    return {
      id,
      user_id: userId,
      token,
      platform,
      device_name: deviceName || null,
      is_active: true,
      last_used_at: now,
      created_at: now,
      updated_at: now,
      app_version: null,
    };
  }

  async unregisterPushToken(userId: string, token: string): Promise<void> {
    await this.db
      .update(pushTokens)
      .set({ is_active: false, updated_at: nowIso() })
      .where(and(eq(pushTokens.user_id, userId), eq(pushTokens.token, token)));
  }

  async getUserTokens(userId: string): Promise<PushToken[]> {
    return this.db
      .select()
      .from(pushTokens)
      .where(and(eq(pushTokens.user_id, userId), eq(pushTokens.is_active, true)))
      .limit(PUSH_TOKENS_LIST_LIMIT)
      .all();
  }

  // ============ PREFERENCES ============

  async getPreferences(userId: string): Promise<NotificationPreference> {
    const prefs = await this.db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.user_id, userId))
      .get();

    if (!prefs) {
      // Create default preferences
      return this.createDefaultPreferences(userId);
    }

    return prefs;
  }

  async updatePreferences(
    userId: string,
    updates: Partial<Omit<NotificationPreference, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
  ): Promise<NotificationPreference> {
    const existing = await this.getPreferences(userId);

    await this.db
      .update(notificationPreferences)
      .set({
        ...updates,
        updated_at: nowIso(),
      })
      .where(eq(notificationPreferences.user_id, userId));

    return { ...existing, ...updates };
  }

  private async createDefaultPreferences(userId: string): Promise<NotificationPreference> {
    const id = crypto.randomUUID();
    const now = nowIso();

    const defaults: NotificationPreference = {
      id,
      user_id: userId,
      push_enabled: true,
      email_enabled: true,
      quiet_hours_start: null,
      quiet_hours_end: null,
      timezone: 'America/New_York',
      task_reminders: true,
      task_overdue: true,
      task_assigned: true,
      task_completed: true,
      household_updates: true,
      report_ready: true,
      weekly_summary: true,
      garbage_collection: true,
      task_drafts_ready: true,
      critical_findings: true,
      maintenance_suggestions: true,
      created_at: now,
      updated_at: now,
    };

    await this.db.insert(notificationPreferences).values(defaults);

    return defaults;
  }

  // ============ TIMEZONE RESOLUTION ============

  /**
   * Resolve the IANA timezone to use for a user's notifications. Prefers the
   * user's own `notification_preferences.timezone` (kept in sync with the
   * device), falling back to the household's `assistant_identity.timezone`, then
   * UTC. Used to anchor local wall-clock times (reminder time, quiet hours) to
   * the right instant.
   */
  private async resolveUserTimezone(userId: string, householdId?: string | null): Promise<string> {
    try {
      const prefs = await this.db
        .select({ timezone: notificationPreferences.timezone })
        .from(notificationPreferences)
        .where(eq(notificationPreferences.user_id, userId))
        .get();
      if (prefs?.timezone) return prefs.timezone;
    } catch (error) {
      console.error('resolveUserTimezone: failed to read preferences', error);
    }

    if (householdId) {
      return this.resolveHouseholdTimezone(householdId);
    }
    return 'UTC';
  }

  /**
   * Resolve a household's IANA timezone from `assistant_identity`, defaulting to
   * UTC. Used for household-level reminders (e.g. garbage collection) where a
   * single physical local time applies to every member.
   */
  async resolveHouseholdTimezone(householdId: string): Promise<string> {
    try {
      const identity = await this.db
        .select({ timezone: assistantIdentity.timezone })
        .from(assistantIdentity)
        .where(eq(assistantIdentity.household_id, householdId))
        .get();
      if (identity?.timezone) return identity.timezone;
    } catch (error) {
      console.error('resolveHouseholdTimezone: failed to read identity', error);
    }
    return 'UTC';
  }

  // ============ SEND NOTIFICATIONS ============

  async sendNotification(options: SendNotificationOptions): Promise<void> {
    const { userId, type, title, body, data, referenceType, referenceId, imageUrl, categoryId, threadId } = options;

    // The in-app notification center (notificationHistory) is the durable source of
    // truth and must ALWAYS be written. Push delivery is a best-effort channel layered
    // on top — gated by user preferences, tokens and quiet hours. Never couple the two,
    // otherwise a user with push disabled / no token also loses the in-app notification.
    const prefs = await this.getPreferences(userId);
    const tokens = await this.getUserTokens(userId);

    const pushAllowed =
      prefs.push_enabled &&
      this.shouldSendNotificationType(prefs, type) &&
      tokens.length > 0 &&
      !this.isInQuietHours(prefs);

    // Apply A/B testing if available (2026 best practice) — only relevant when pushing
    let finalTitle = title;
    let finalBody = body;
    let abTestData: Record<string, string> = {};

    if (pushAllowed) {
      try {
        const abResult = await this.optimizationService.applyAbTest(userId, type, title, body);
        finalTitle = abResult.title;
        finalBody = abResult.body;
        if (abResult.testId && abResult.variantId) {
          abTestData = { abTestId: abResult.testId, abVariantId: abResult.variantId };
        }
      } catch (error) {
        console.error('A/B testing error (using defaults):', error);
      }
    }

    // Include notification type in push/in-app data so client handlers can route taps
    const finalData: Record<string, string> = { ...(data ?? {}), type, ...abTestData };

    // Record first so unread count and in-app history are accurate before push delivery
    await this.recordNotification(userId, type, finalTitle, finalBody, finalData, referenceType, referenceId);

    // Send the push to each device (best-effort)
    if (pushAllowed) {
      const badge = await this.getUnreadCount(userId);
      const effectiveCategoryId = categoryId || this.getCategoryForType(type);
      const effectiveThreadId = threadId || this.getThreadIdForType(type, referenceId);

      for (const tokenRecord of tokens) {
        await this.sendPushNotification(tokenRecord, finalTitle, finalBody, finalData, {
          imageUrl,
          categoryId: effectiveCategoryId,
          threadId: effectiveThreadId,
          badge,
        });
      }
    } else {
      console.log('[push] skipped', {
        userId,
        type,
        push_enabled: prefs.push_enabled,
        tokenCount: tokens.length,
        typeAllowed: this.shouldSendNotificationType(prefs, type),
        quietHours: this.isInQuietHours(prefs),
      });
    }

    // Record engagement for send-time optimization (only meaningful when a push was sent)
    if (pushAllowed) {
      try {
        const historyId = await this.getLatestNotificationId(userId);
        if (historyId) {
          await this.optimizationService.recordNotificationSent(historyId, userId, new Date());
        }
      } catch (error) {
        console.error('Engagement tracking error:', error);
      }
    }
  }

  /**
   * Get the latest notification ID for a user (for engagement tracking)
   */
  private async getLatestNotificationId(userId: string): Promise<string | null> {
    const result = await this.db
      .select({ id: notificationHistory.id })
      .from(notificationHistory)
      .where(eq(notificationHistory.user_id, userId))
      .orderBy(desc(notificationHistory.sent_at))
      .limit(1)
      .get();
    
    return result?.id || null;
  }

  /**
   * Schedule notification with send-time optimization (2026 best practice)
   * Automatically adjusts the scheduled time based on user's engagement patterns
   */
  async scheduleNotificationOptimized(
    options: Omit<ScheduleNotificationOptions, 'scheduledFor'> & {
      preferredDate: Date; // The date to send (time will be optimized)
      allowTimeShift?: boolean; // Whether to shift to optimal hour (default: true)
    }
  ): Promise<ScheduledNotification> {
    const { preferredDate, allowTimeShift = true, ...rest } = options;

    let scheduledFor = preferredDate;

    if (allowTimeShift) {
      try {
        // Check if preferred date is weekend
        const dayOfWeek = preferredDate.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

        // Get optimal hour for this user
        const optimalHour = await this.optimizationService.getOptimalSendTime(
          rest.userId,
          isWeekend
        );

        // Adjust the scheduled time to optimal hour
        scheduledFor = new Date(preferredDate);
        scheduledFor.setHours(optimalHour, 0, 0, 0);

        // If the optimal time is in the past for today, use it as-is
        // (the cron job will pick it up on next run)
      } catch (error) {
        console.error('Send-time optimization error (using original time):', error);
      }
    }

    return this.scheduleNotification({
      ...rest,
      scheduledFor,
    });
  }

  /**
   * Get notification category for action buttons based on type
   */
  private getCategoryForType(type: string): string | undefined {
    switch (type) {
      case 'task_reminder':
        return NOTIFICATION_CATEGORIES.TASK_REMINDER;
      case 'task_overdue':
        return NOTIFICATION_CATEGORIES.TASK_OVERDUE;
      case 'garbage_collection':
      case 'garbage_reminder':
        return NOTIFICATION_CATEGORIES.GARBAGE_REMINDER;
      default:
        return undefined;
    }
  }

  /**
   * Get thread ID for grouping similar notifications (2026 best practice)
   */
  private getThreadIdForType(type: string, referenceId?: string): string | undefined {
    if (type.startsWith('task_')) {
      return referenceId ? `${THREAD_PREFIXES.TASK}${referenceId}` : THREAD_PREFIXES.TASK + 'general';
    }
    if (type.startsWith('garbage_')) {
      return THREAD_PREFIXES.GARBAGE + 'collection';
    }
    if (type.startsWith('household_')) {
      return THREAD_PREFIXES.HOUSEHOLD + 'updates';
    }
    if (type === 'report_ready') {
      return referenceId ? `${THREAD_PREFIXES.REPORT}${referenceId}` : THREAD_PREFIXES.REPORT + 'general';
    }
    return undefined;
  }

  async scheduleNotification(options: ScheduleNotificationOptions): Promise<ScheduledNotification> {
    const { 
      userId, householdId, type, title, body, data, scheduledFor, 
      referenceType, referenceId, imageUrl, categoryId, threadId 
    } = options;
    const id = crypto.randomUUID();

    const notification: ScheduledNotification = {
      id,
      user_id: userId,
      household_id: householdId || null,
      type,
      title,
      body,
      data: data ? JSON.stringify(data) : null,
      scheduled_for: scheduledFor.toISOString(),
      sent_at: null,
      failed_at: null,
      error_message: null,
      reference_type: referenceType || null,
      reference_id: referenceId || null,
      // Rich notification fields (2026 best practices)
      image_url: imageUrl || null,
      category_id: categoryId || null,
      thread_id: threadId || null,
      claimed_at: null,
      claim_owner: null,
      attempt_count: 0,
      created_at: nowIso(),
    };

    await this.db.insert(scheduledNotifications).values(notification);

    return notification;
  }

  async processScheduledNotifications(): Promise<number> {
    const leaseHolder = crypto.randomUUID();
    if (!(await tryAcquireCronLease(this.db, SCHEDULED_NOTIFICATIONS_CRON_JOB, leaseHolder))) {
      return 0;
    }

    try {
      return await this.processScheduledNotificationsWithClaims();
    } finally {
      await releaseCronLease(this.db, SCHEDULED_NOTIFICATIONS_CRON_JOB, leaseHolder);
    }
  }

  /**
   * B1: per-row CAS claim before send. Claim uses claimed_at (never sent_at).
   * Stale claims older than NOTIFICATION_CLAIM_TTL_MS are releasable.
   */
  private async processScheduledNotificationsWithClaims(): Promise<number> {
    const now = nowIso();
    const staleThreshold = new Date(Date.now() - NOTIFICATION_CLAIM_TTL_MS).toISOString();
    const claimOwner = crypto.randomUUID();

    const dueNotifications = await this.db
      .select()
      .from(scheduledNotifications)
      .where(
        and(
          lte(scheduledNotifications.scheduled_for, now),
          isNull(scheduledNotifications.sent_at),
          lt(scheduledNotifications.attempt_count, MAX_NOTIFICATION_DELIVERY_ATTEMPTS),
          or(
            isNull(scheduledNotifications.claimed_at),
            lt(scheduledNotifications.claimed_at, staleThreshold)
          )
        )
      )
      .limit(100)
      .all();

    let sent = 0;

    for (const notification of dueNotifications) {
      const claimed = await this.claimScheduledNotification(
        notification.id,
        claimOwner,
        now,
        staleThreshold
      );
      if (!claimed) continue;

      try {
        await this.sendNotification({
          userId: notification.user_id,
          type: notification.type,
          title: notification.title,
          body: notification.body,
          data: notification.data ? JSON.parse(notification.data) : undefined,
          referenceType: notification.reference_type || undefined,
          referenceId: notification.reference_id || undefined,
          imageUrl: notification.image_url || undefined,
          categoryId: notification.category_id || undefined,
          threadId: notification.thread_id || undefined,
        });

        await this.db
          .update(scheduledNotifications)
          .set({ sent_at: now, claimed_at: null, claim_owner: null })
          .where(eq(scheduledNotifications.id, notification.id));

        sent++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Failed to send scheduled notification ${notification.id}:`, errorMessage);
        await this.releaseScheduledNotificationClaim(notification.id, errorMessage, now);
      }
    }

    return sent;
  }

  private async claimScheduledNotification(
    id: string,
    claimOwner: string,
    now: string,
    staleThreshold: string
  ): Promise<boolean> {
    const result = await this.db
      .update(scheduledNotifications)
      .set({ claimed_at: now, claim_owner: claimOwner })
      .where(
        and(
          eq(scheduledNotifications.id, id),
          isNull(scheduledNotifications.sent_at),
          lt(scheduledNotifications.attempt_count, MAX_NOTIFICATION_DELIVERY_ATTEMPTS),
          or(
            isNull(scheduledNotifications.claimed_at),
            lt(scheduledNotifications.claimed_at, staleThreshold)
          )
        )
      )
      .run();
    return d1Changes(result) === 1;
  }

  private async releaseScheduledNotificationClaim(
    id: string,
    errorMessage: string,
    now: string
  ): Promise<void> {
    const row = await this.db
      .select({ attempt_count: scheduledNotifications.attempt_count })
      .from(scheduledNotifications)
      .where(eq(scheduledNotifications.id, id))
      .get();
    const nextAttempt = (row?.attempt_count ?? 0) + 1;

    await this.db
      .update(scheduledNotifications)
      .set({
        claimed_at: null,
        claim_owner: null,
        attempt_count: nextAttempt,
        failed_at: now,
        error_message: errorMessage,
      })
      .where(eq(scheduledNotifications.id, id));
  }

  // ============ TASK REMINDER SCHEDULING ============

  async scheduleTaskReminder(
    taskId: string,
    userId: string,
    householdId: string,
    taskTitle: string,
    dueDate: Date,
    reminderDaysBefore: number = 1,
    options?: {
      imageUrl?: string; // Rich notification image (e.g., appliance photo)
      // Task's preferred local reminder time (HH:MM). When provided, reminders
      // are anchored to this wall-clock time in the user's timezone rather than
      // to the raw due-date instant (which would fire at UTC midnight).
      reminderTime?: string | null;
    }
  ): Promise<void> {
    // Cancel any existing reminders for this task
    await this.cancelTaskReminders(taskId);

    // Anchor reminders to the user's local wall clock. `next_due_date` is a
    // date-only value (UTC midnight), so without this a "1 day before" reminder
    // fires at midnight UTC — the wrong hour for everyone off UTC.
    const useLocalTime = !!options?.reminderTime;
    const timezone = useLocalTime ? await this.resolveUserTimezone(userId, householdId) : 'UTC';

    // Schedule reminder before due date
    let reminderDate: Date;
    if (useLocalTime) {
      const reminderDay = shiftUtcCalendarDate(dueDate, -reminderDaysBefore);
      reminderDate = localTimeOnDateToUtc(reminderDay, options!.reminderTime!, timezone);
    } else {
      reminderDate = new Date(dueDate);
      reminderDate.setDate(reminderDate.getDate() - reminderDaysBefore);
    }

    if (reminderDate > new Date()) {
      await this.scheduleNotification({
        userId,
        householdId,
        type: 'task_reminder',
        title: 'Task Due Soon',
        body: `"${taskTitle}" is due in ${reminderDaysBefore} day${reminderDaysBefore > 1 ? 's' : ''}`,
        // Include householdId for notification action handlers (2026 best practice)
        data: { taskId, householdId, screen: 'TaskDetail' },
        scheduledFor: reminderDate,
        referenceType: 'maintenance_task',
        referenceId: taskId,
        // 2026 best practices: Rich notification with image
        imageUrl: options?.imageUrl,
        categoryId: NOTIFICATION_CATEGORIES.TASK_REMINDER,
        threadId: `${THREAD_PREFIXES.TASK}${taskId}`,
      });
    }

    // Schedule overdue notification. With a local reminder time, nudge at that
    // same wall-clock hour on the day after the due date; otherwise fall back to
    // the legacy "due instant + 12h" behaviour.
    let overdueDate: Date;
    if (useLocalTime) {
      const overdueDay = shiftUtcCalendarDate(dueDate, 1);
      overdueDate = localTimeOnDateToUtc(overdueDay, options!.reminderTime!, timezone);
    } else {
      overdueDate = new Date(dueDate);
      overdueDate.setHours(overdueDate.getHours() + 12);
    }

    await this.scheduleNotification({
      userId,
      householdId,
      type: 'task_overdue',
      title: 'Task Overdue',
      body: `"${taskTitle}" is now overdue`,
      // Include householdId for notification action handlers (2026 best practice)
      data: { taskId, householdId, screen: 'TaskDetail' },
      scheduledFor: overdueDate,
      referenceType: 'maintenance_task',
      referenceId: taskId,
      // 2026 best practices: Rich notification with image
      imageUrl: options?.imageUrl,
      categoryId: NOTIFICATION_CATEGORIES.TASK_OVERDUE,
      threadId: `${THREAD_PREFIXES.TASK}${taskId}`,
    });
  }

  async cancelTaskReminders(taskId: string): Promise<void> {
    await this.db
      .delete(scheduledNotifications)
      .where(
        and(
          eq(scheduledNotifications.reference_type, 'maintenance_task'),
          eq(scheduledNotifications.reference_id, taskId),
          isNull(scheduledNotifications.sent_at)
        )
      );
  }

  // ============ GARBAGE COLLECTION REMINDERS ============

  /**
   * Schedule garbage collection reminders for a household's schedule
   * This schedules:
   * 1. Night before reminder (if enabled)
   * 2. Morning of reminder (if enabled)
   * 3. Missed collection alert (sent after collection time if not marked as done)
   */
  async scheduleGarbageReminders(
    householdId: string,
    scheduleId: string,
    schedules: Array<{
      type: 'garbage' | 'recycling' | 'organics' | 'yardWaste' | 'bulkItem';
      frequency: 'weekly' | 'biweekly' | 'monthly' | 'seasonal' | 'on-request';
      dayOfWeek?: number;
      week?: 'A' | 'B';
      weekOfMonth?: number[];
    }>,
    reminders: {
      nightBefore: { enabled: boolean; time: string };
      morningOf: { enabled: boolean; time: string };
      custom?: Array<{
        id: string;
        type: 'evening_before' | 'morning_of' | 'custom';
        time: string;
        daysOffset: number;
        label: string;
        enabled: boolean;
      }>;
    },
    _setOutTime: string = '19:00',
    collectionStartTime: string = '07:00'
  ): Promise<number> {
    // Cancel existing garbage reminders for this schedule
    await this.cancelGarbageReminders(scheduleId);

    // Get all household members to send notifications to
    const householdMembers = await this.getHouseholdMembers(householdId);
    if (householdMembers.length === 0) return 0;

    // Garbage collection happens at a single physical local time for the whole
    // household — anchor every reminder time to the household timezone.
    const timezone = await this.resolveHouseholdTimezone(householdId);

    let scheduledCount = 0;
    const now = new Date();
    const daysToSchedule = 14; // Schedule 2 weeks ahead

    // Calculate upcoming collection dates
    const collectionDates: Array<{ date: Date; types: string[] }> = [];

    for (const schedule of schedules) {
      if (!schedule.dayOfWeek && schedule.dayOfWeek !== 0) continue;

      const dates = this.calculateUpcomingDates(
        schedule.frequency,
        schedule.dayOfWeek,
        daysToSchedule,
        schedule.week,
        schedule.weekOfMonth
      );

      for (const date of dates) {
        const dateStr = date.toISOString().split('T')[0];
        const existing = collectionDates.find(
          (d) => d.date.toISOString().split('T')[0] === dateStr
        );
        if (existing) {
          if (!existing.types.includes(schedule.type)) {
            existing.types.push(schedule.type);
          }
        } else {
          collectionDates.push({ date, types: [schedule.type] });
        }
      }
    }

    // Schedule notifications for each collection date and each household member
    for (const collection of collectionDates) {
      const typeNames = collection.types.map((t) => this.formatGarbageType(t)).join(', ');

      for (const userId of householdMembers) {
        // Night before reminder
        if (reminders.nightBefore.enabled) {
          const nightBeforeDate = localTimeOnDateToUtc(
            shiftUtcCalendarDate(collection.date, -1),
            reminders.nightBefore.time,
            timezone
          );

          if (nightBeforeDate > now) {
            await this.scheduleNotification({
              userId,
              householdId,
              type: 'garbage_collection',
              title: 'Put Out Bins Tonight',
              body: `${typeNames} collection is tomorrow. Don't forget to put out your bins!`,
              data: {
                screen: 'GarbageCollection',
                scheduleId,
                collectionDate: collection.date.toISOString().split('T')[0],
                types: collection.types.join(','),
              },
              scheduledFor: nightBeforeDate,
              referenceType: 'garbage_schedule',
              referenceId: scheduleId,
            });
            scheduledCount++;
          }
        }

        // Morning of reminder
        if (reminders.morningOf.enabled) {
          const morningOfDate = localTimeOnDateToUtc(
            collection.date,
            reminders.morningOf.time,
            timezone
          );

          if (morningOfDate > now) {
            await this.scheduleNotification({
              userId,
              householdId,
              type: 'garbage_collection',
              title: 'Collection Day',
              body: `${typeNames} collection is today. Make sure your bins are out!`,
              data: {
                screen: 'GarbageCollection',
                scheduleId,
                collectionDate: collection.date.toISOString().split('T')[0],
                types: collection.types.join(','),
              },
              scheduledFor: morningOfDate,
              referenceType: 'garbage_schedule',
              referenceId: scheduleId,
            });
            scheduledCount++;
          }
        }

        // Custom reminders
        if (reminders.custom && reminders.custom.length > 0) {
          for (const customReminder of reminders.custom) {
            if (!customReminder.enabled) continue;

            const customReminderDate = localTimeOnDateToUtc(
              shiftUtcCalendarDate(collection.date, customReminder.daysOffset),
              customReminder.time,
              timezone
            );

            if (customReminderDate > now) {
              const daysUntil = Math.abs(customReminder.daysOffset);
              const dayText = daysUntil === 0 ? 'today' : daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;

              await this.scheduleNotification({
                userId,
                householdId,
                type: 'garbage_collection',
                title: customReminder.label,
                body: `${typeNames} collection is ${dayText}. ${customReminder.label} reminder.`,
                data: {
                  screen: 'GarbageCollection',
                  scheduleId,
                  collectionDate: collection.date.toISOString().split('T')[0],
                  types: collection.types.join(','),
                  customReminderId: customReminder.id,
                },
                scheduledFor: customReminderDate,
                referenceType: 'garbage_schedule',
                referenceId: scheduleId,
              });
              scheduledCount++;
            }
          }
        }

        // Missed collection alert — 1 hour after collection starts, in the
        // household's local time (Date.UTC normalises an hour that rolls past 23).
        const [collHour, collMinute] = parseHhmm(collectionStartTime);
        const missedAlertDate = new Date(
          zonedWallTimeToUtcIso(
            collection.date.getUTCFullYear(),
            collection.date.getUTCMonth() + 1,
            collection.date.getUTCDate(),
            collHour + 1,
            collMinute,
            timezone
          )
        );

        if (missedAlertDate > now) {
          await this.scheduleNotification({
            userId,
            householdId,
            type: 'garbage_missed',
            title: 'Did You Miss Collection?',
            body: `${typeNames} collection may have passed. Did you put out your bins?`,
            data: {
              screen: 'GarbageCollection',
              scheduleId,
              collectionDate: collection.date.toISOString().split('T')[0],
              types: collection.types.join(','),
              isMissedAlert: 'true',
            },
            scheduledFor: missedAlertDate,
            referenceType: 'garbage_schedule',
            referenceId: scheduleId,
          });
          scheduledCount++;
        }
      }
    }

    return scheduledCount;
  }

  async cancelGarbageReminders(scheduleId: string): Promise<void> {
    await this.db
      .delete(scheduledNotifications)
      .where(
        and(
          eq(scheduledNotifications.reference_type, 'garbage_schedule'),
          eq(scheduledNotifications.reference_id, scheduleId),
          isNull(scheduledNotifications.sent_at)
        )
      );
  }

  private calculateUpcomingDates(
    frequency: 'weekly' | 'biweekly' | 'monthly' | 'seasonal' | 'on-request',
    dayOfWeek: number,
    daysAhead: number,
    _week?: 'A' | 'B',
    weekOfMonth?: number[]
  ): Date[] {
    const dates: Date[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + daysAhead);

    if (frequency === 'weekly') {
      const currentDate = new Date(today);
      const daysUntilNext = (dayOfWeek - currentDate.getDay() + 7) % 7;
      currentDate.setDate(currentDate.getDate() + daysUntilNext);

      while (currentDate <= endDate) {
        dates.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 7);
      }
    } else if (frequency === 'biweekly') {
      const currentDate = new Date(today);
      const daysUntilNext = (dayOfWeek - currentDate.getDay() + 7) % 7;
      currentDate.setDate(currentDate.getDate() + daysUntilNext);

      while (currentDate <= endDate) {
        dates.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 14);
      }
    } else if (frequency === 'monthly') {
      // Monthly collections on specific weeks of the month
      const weeksOfMonth = weekOfMonth && weekOfMonth.length > 0 ? weekOfMonth : [1];
      const currentDate = new Date(today);
      currentDate.setDate(1); // Start at beginning of current month

      const monthsToCheck = Math.ceil(daysAhead / 30) + 1;

      for (let i = 0; i < monthsToCheck; i++) {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();

        for (const weekNum of weeksOfMonth) {
          const date = this.getNthDayOfWeek(year, month, dayOfWeek, weekNum);
          if (date >= today && date <= endDate) {
            dates.push(date);
          }
        }

        currentDate.setMonth(currentDate.getMonth() + 1);
      }

      // Sort dates chronologically
      dates.sort((a, b) => a.getTime() - b.getTime());
    }
    // TODO: Add seasonal support

    return dates;
  }

  /**
   * Get the Nth occurrence of a specific day of the week in a given month
   * @param year - Year
   * @param month - Month (0-11)
   * @param dayOfWeek - Day of week (0=Sunday, 6=Saturday)
   * @param weekNumber - Which occurrence (1=first, 2=second, etc.)
   * @returns Date object for that day, or last day of month if overflow
   */
  private getNthDayOfWeek(year: number, month: number, dayOfWeek: number, weekNumber: number): Date {
    // Find the first day of the month
    const firstDay = new Date(year, month, 1);
    const firstDayOfWeek = firstDay.getDay();

    // Calculate days to add to get to first occurrence of target day
    const daysToAdd = (dayOfWeek - firstDayOfWeek + 7) % 7;
    const firstOccurrence = 1 + daysToAdd;

    // Calculate the Nth occurrence
    const nthOccurrence = firstOccurrence + (weekNumber - 1) * 7;

    // Create the date
    const date = new Date(year, month, nthOccurrence);

    // If we've overflowed into next month, return last day of target month
    if (date.getMonth() !== month) {
      return new Date(year, month + 1, 0); // Last day of target month
    }

    return date;
  }

  private formatGarbageType(type: string): string {
    const typeNames: Record<string, string> = {
      garbage: 'Garbage',
      recycling: 'Recycling',
      organics: 'Organics',
      yardWaste: 'Yard Waste',
      bulkItem: 'Bulk Item',
    };
    return typeNames[type] || type;
  }

  private async getHouseholdMembers(householdId: string): Promise<string[]> {
    // Import household_members table
    const { householdMembers } = await import('../db/schema');
    
    const members = await this.db
      .select({ user_id: householdMembers.user_id })
      .from(householdMembers)
      .where(eq(householdMembers.household_id, householdId))
      .limit(HOUSEHOLD_MEMBERS_NOTIFY_LIMIT)
      .all();

    return members.map((m) => m.user_id);
  }

  // ============ NOTIFICATION HISTORY ============

  async getNotificationHistory(
    userId: string,
    options: { limit?: number; cursor?: string; unreadOnly?: boolean } = {}
  ) {
    const { limit = 50 } = options;

    const conditions = [eq(notificationHistory.user_id, userId)];
    if (!this.homeApiEnabled) {
      // Child app: never return House-domain notifications (independence).
      conditions.push(
        notInArray(notificationHistory.type, HOUSE_DOMAIN_NOTIFICATION_TYPES),
      );
    }

    const query = this.db
      .select()
      .from(notificationHistory)
      .where(and(...conditions))
      .orderBy(desc(notificationHistory.sent_at))
      .limit(limit + 1);

    const results = await query.all();

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, -1) : results;

    return {
      notifications: items,
      nextCursor: hasMore ? items[items.length - 1].id : undefined,
    };
  }

  async markAsRead(userId: string, notificationId: string): Promise<void> {
    await this.db
      .update(notificationHistory)
      .set({ read_at: nowIso() })
      .where(and(eq(notificationHistory.user_id, userId), eq(notificationHistory.id, notificationId)));
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.db
      .update(notificationHistory)
      .set({ read_at: nowIso() })
      .where(and(eq(notificationHistory.user_id, userId), isNull(notificationHistory.read_at)));
  }

  /**
   * Mark a user's UNREAD notifications tied to a specific reference (e.g. a chat
   * room) as read. Called when the user actually opens/reads the referenced
   * thing, so the in-app unread counter + OS badge stop counting messages they
   * have now seen. Idempotent; a no-op when there are no matching unread rows.
   */
  async markReferenceRead(
    userId: string,
    referenceType: string,
    referenceId: string
  ): Promise<void> {
    await this.db
      .update(notificationHistory)
      .set({ read_at: nowIso() })
      .where(
        and(
          eq(notificationHistory.user_id, userId),
          eq(notificationHistory.reference_type, referenceType),
          eq(notificationHistory.reference_id, referenceId),
          isNull(notificationHistory.read_at)
        )
      );
  }

  async deleteNotification(userId: string, notificationId: string): Promise<void> {
    const existing = await this.db
      .select({ id: notificationHistory.id })
      .from(notificationHistory)
      .where(and(eq(notificationHistory.user_id, userId), eq(notificationHistory.id, notificationId)))
      .get();

    if (!existing) {
      throw new NotFoundError('Notification not found');
    }

    await this.db
      .delete(notificationHistory)
      .where(and(eq(notificationHistory.user_id, userId), eq(notificationHistory.id, notificationId)));
  }

  /**
   * Remove owner "New Join Request" alerts once the request is approved/denied.
   * Scoped by reference + payload so we don't delete the requester's outcome notice.
   */
  async deleteJoinRequestReceivedNotifications(requestId: string): Promise<void> {
    await this.db
      .delete(notificationHistory)
      .where(
        and(
          eq(notificationHistory.reference_type, 'household_join_request'),
          eq(notificationHistory.reference_id, requestId),
          or(
            eq(notificationHistory.title, 'New Join Request'),
            like(notificationHistory.data, '%join_request_received%')
          )
        )
      );
  }

  /** Clear stale join-request alerts for the current user (client cleanup). */
  async deleteJoinRequestReceivedNotificationsForUser(
    userId: string,
    requestId: string
  ): Promise<void> {
    await this.db
      .delete(notificationHistory)
      .where(
        and(
          eq(notificationHistory.user_id, userId),
          eq(notificationHistory.reference_type, 'household_join_request'),
          eq(notificationHistory.reference_id, requestId),
          or(
            eq(notificationHistory.title, 'New Join Request'),
            like(notificationHistory.data, '%join_request_received%')
          )
        )
      );
  }

  async deleteAllNotifications(userId: string): Promise<void> {
    await this.db
      .delete(notificationHistory)
      .where(eq(notificationHistory.user_id, userId));
  }

  async getUnreadCount(userId: string): Promise<number> {
    const conditions = [
      eq(notificationHistory.user_id, userId),
      isNull(notificationHistory.read_at),
    ];
    if (!this.homeApiEnabled) {
      // Child app: don't count House-domain notifications toward the badge.
      conditions.push(
        notInArray(notificationHistory.type, HOUSE_DOMAIN_NOTIFICATION_TYPES),
      );
    }

    const result = await this.db
      .select()
      .from(notificationHistory)
      .where(and(...conditions))
      .all();

    return result.length;
  }

  // ============ HELPER METHODS ============

  private shouldSendNotificationType(prefs: NotificationPreference, type: string): boolean {
    const typeMap: Record<string, keyof NotificationPreference> = {
      task_reminder: 'task_reminders',
      task_overdue: 'task_overdue',
      task_assigned: 'task_assigned',
      task_completed: 'task_completed',
      household_update: 'household_updates',
      report_ready: 'report_ready',
      weekly_summary: 'weekly_summary',
      garbage_collection: 'garbage_collection',
      garbage_missed: 'garbage_collection',
      // Task drafts and maintenance suggestions
      task_drafts_ready: 'task_drafts_ready',
      drafts_ready: 'task_drafts_ready',
      critical_drafts: 'critical_findings',
      critical_findings: 'critical_findings',
      maintenance_suggestions: 'maintenance_suggestions',
    };

    const prefKey = typeMap[type];
    if (!prefKey) return true;

    return prefs[prefKey] as boolean;
  }

  private isInQuietHours(prefs: NotificationPreference): boolean {
    if (!prefs.quiet_hours_start || !prefs.quiet_hours_end) return false;

    // Quiet hours are expressed as the user's local wall-clock time. The Worker
    // runtime's clock is UTC, so compare against the user's IANA timezone
    // instead of the raw server hour (otherwise a "22:00–07:00" window silences
    // pushes at the wrong time for anyone not on UTC).
    const timezone = prefs.timezone || 'UTC';
    return isInQuietHoursInTimezone(
      new Date(),
      timezone,
      prefs.quiet_hours_start,
      prefs.quiet_hours_end
    );
  }

  private async sendPushNotification(
    token: PushToken,
    title: string,
    body: string,
    data?: Record<string, string>,
    richOptions?: {
      imageUrl?: string;
      categoryId?: string;
      threadId?: string;
      badge?: number;
    }
  ): Promise<void> {
    try {
      // For Expo push notifications
      if (token.token.startsWith('ExponentPushToken')) {
        await this.sendExpoPushNotification(token, title, body, data, richOptions);
      }
      // Add APNs/FCM direct support here if needed
    } catch (error) {
      // Log error but don't throw - we want to continue sending to other tokens
      console.error(`Failed to send push notification to token ${token.id}:`, error);
    }
  }

  private async sendExpoPushNotification(
    tokenRecord: PushToken,
    title: string,
    body: string,
    data?: Record<string, string>,
    richOptions?: {
      imageUrl?: string;
      categoryId?: string;
      threadId?: string;
      badge?: number;
    }
  ): Promise<void> {
    try {
      const tickets = await this.expoPush.sendBatch([
        {
          to: tokenRecord.token,
          title,
          body,
          data: {
            ...(data ?? {}),
            categoryId: richOptions?.categoryId,
            threadId: richOptions?.threadId,
          },
          sound: 'default',
          badge: richOptions?.badge ?? 0,
          _contentAvailable: true,
        },
      ]);

      for (const ticket of tickets) {
        if (ticket.status === 'error') {
          console.error('Expo push error:', ticket);
          const errorCode =
            typeof ticket.details?.error === 'string' ? ticket.details.error : undefined;
          if (errorCode === 'DeviceNotRegistered' || errorCode === 'InvalidCredentials') {
            console.log(`Marking token ${tokenRecord.token} as inactive due to error: ${errorCode}`);
            await this.db
              .update(pushTokens)
              .set({ is_active: false, updated_at: nowIso() })
              .where(eq(pushTokens.token, tokenRecord.token));
          }
          continue;
        }

        // 'ok' here only means Expo accepted the send request — it says nothing
        // about actual APNs/FCM delivery. Track the ticket so a later cron tick
        // can poll Expo's receipts endpoint for the real delivery outcome.
        if (ticket.id) {
          await this.db
            .insert(pushReceiptChecks)
            .values({
              id: crypto.randomUUID(),
              ticket_id: ticket.id,
              push_token_id: tokenRecord.id,
            })
            .onConflictDoNothing();
        }
      }

      await this.db
        .update(pushTokens)
        .set({ last_used_at: nowIso() })
        .where(eq(pushTokens.token, tokenRecord.token));
    } catch (error) {
      console.error('Error sending Expo push notification:', error);
      throw error;
    }
  }

  /**
   * Poll Expo's receipts endpoint for previously sent tickets to catch real
   * APNs/FCM delivery failures (sandbox/production credential mismatch,
   * DeviceNotRegistered, etc.) that a 'ok' send ticket cannot reveal. Intended
   * to run on a cron a few minutes after sends; rows are removed once
   * resolved or once Expo's ~1-day receipt retention window has passed.
   */
  async checkPendingPushReceipts(): Promise<{ checked: number; errors: number }> {
    const readyCutoff = new Date(Date.now() - 60_000).toISOString();
    const pending = await this.db
      .select()
      .from(pushReceiptChecks)
      .where(lte(pushReceiptChecks.created_at, readyCutoff))
      .limit(500)
      .all();

    if (pending.length === 0) return { checked: 0, errors: 0 };

    const receipts = await this.expoPush.getReceipts(pending.map((row) => row.ticket_id));
    let errorCount = 0;

    for (const row of pending) {
      const receipt = receipts[row.ticket_id];

      if (!receipt) {
        // Expo hasn't published a receipt for this ticket yet — retry on the
        // next tick unless we're past Expo's retention window.
        const ageMs = Date.now() - new Date(row.created_at).getTime();
        if (ageMs > 24 * 60 * 60 * 1000) {
          await this.db.delete(pushReceiptChecks).where(eq(pushReceiptChecks.id, row.id));
        }
        continue;
      }

      if (receipt.status === 'error') {
        errorCount += 1;
        const errorCode =
          typeof receipt.details?.error === 'string' ? receipt.details.error : undefined;
        console.error('Expo push delivery failed (receipt):', {
          ticketId: row.ticket_id,
          pushTokenId: row.push_token_id,
          errorCode,
          message: receipt.message,
        });
        if (errorCode === 'DeviceNotRegistered' || errorCode === 'InvalidCredentials') {
          await this.db
            .update(pushTokens)
            .set({ is_active: false, updated_at: nowIso() })
            .where(eq(pushTokens.id, row.push_token_id));
        }
      }

      await this.db.delete(pushReceiptChecks).where(eq(pushReceiptChecks.id, row.id));
    }

    return { checked: pending.length, errors: errorCount };
  }

  private async recordNotification(
    userId: string,
    type: string,
    title: string,
    body: string,
    data?: Record<string, string>,
    referenceType?: string,
    referenceId?: string
  ): Promise<void> {
    const id = crypto.randomUUID();

    await this.db.insert(notificationHistory).values({
      id,
      user_id: userId,
      type,
      title,
      body,
      data: data ? JSON.stringify(data) : null,
      sent_at: nowIso(),
      read_at: null,
      clicked_at: null,
      reference_type: referenceType || null,
      reference_id: referenceId || null,
    });
  }
}
