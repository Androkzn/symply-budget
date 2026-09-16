import { eq, and, sql } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';

import {
  notificationEngagement,
  userOptimalSendTimes,
  notificationAbTests,
  userAbTestAssignments,
  notificationHistory,
} from '../db/schema-notifications';
import type { Env } from '../types';
import { nowIso } from '../utils/id';

interface EngagementData {
  notificationId: string;
  userId: string;
  sentAt: Date;
  openedAt?: Date;
  actionTaken?: 'view' | 'snooze' | 'complete' | 'dismiss';
}

interface AbTestVariant {
  id: string;
  title: string;
  body: string;
  weight?: number; // For weighted random assignment
}

interface AbTest {
  id: string;
  name: string;
  notificationType: string;
  variants: AbTestVariant[];
  trafficPercentage: number;
}

/**
 * NotificationOptimizationService (2026 Best Practices)
 * 
 * Provides:
 * 1. Send-time optimization based on user engagement patterns
 * 2. A/B testing framework for notification copy/timing
 * 3. Engagement tracking for ML-based optimization
 */
export class NotificationOptimizationService {
  private db: DrizzleD1Database;

  constructor(_env: Env, d1: D1Database) {
    this.db = drizzle(d1);
  }

  // ============ ENGAGEMENT TRACKING ============

  /**
   * Record when a notification is sent for engagement tracking
   */
  async recordNotificationSent(
    notificationId: string,
    userId: string,
    sentAt: Date
  ): Promise<void> {
    const id = crypto.randomUUID();
    const sentHour = sentAt.getHours();
    const sentDayOfWeek = sentAt.getDay();

    await this.db.insert(notificationEngagement).values({
      id,
      user_id: userId,
      notification_id: notificationId,
      sent_hour: sentHour,
      sent_day_of_week: sentDayOfWeek,
      created_at: nowIso(),
    });
  }

  /**
   * Record user engagement (open, action) with a notification
   */
  async recordEngagement(data: EngagementData): Promise<void> {
    const { notificationId, userId, sentAt, openedAt, actionTaken } = data;

    // Calculate response time if opened
    let responseTimeSeconds: number | undefined;
    if (openedAt) {
      responseTimeSeconds = Math.floor((openedAt.getTime() - sentAt.getTime()) / 1000);
    }

    // Update engagement record
    await this.db
      .update(notificationEngagement)
      .set({
        opened_at: openedAt?.toISOString(),
        action_taken: actionTaken,
        response_time_seconds: responseTimeSeconds,
      })
      .where(eq(notificationEngagement.notification_id, notificationId));

    // Update A/B test metrics if applicable
    await this.updateAbTestMetrics(userId, notificationId, !!openedAt, !!actionTaken);
  }

  // ============ SEND-TIME OPTIMIZATION ============

  /**
   * Get the optimal send time for a user based on their engagement history
   * Returns the best hour (0-23) to send notifications
   */
  async getOptimalSendTime(userId: string, isWeekend: boolean = false): Promise<number> {
    // Try to get pre-computed optimal times
    const optimalTimes = await this.db
      .select()
      .from(userOptimalSendTimes)
      .where(eq(userOptimalSendTimes.user_id, userId))
      .get();

    if (optimalTimes) {
      const hours = isWeekend
        ? JSON.parse(optimalTimes.weekend_hours || '[10]')
        : JSON.parse(optimalTimes.weekday_hours || '[9]');
      
      // Return the first preferred hour (highest engagement)
      return hours[0] || 9;
    }

    // Fallback: compute on-the-fly from recent engagement
    return this.computeOptimalHour(userId, isWeekend);
  }

  /**
   * Compute optimal send hour from engagement data
   */
  private async computeOptimalHour(userId: string, isWeekend: boolean): Promise<number> {
    // Get engagement data for this user
    const engagements = await this.db
      .select({
        sent_hour: notificationEngagement.sent_hour,
        sent_day_of_week: notificationEngagement.sent_day_of_week,
        opened_at: notificationEngagement.opened_at,
        response_time_seconds: notificationEngagement.response_time_seconds,
      })
      .from(notificationEngagement)
      .where(eq(notificationEngagement.user_id, userId))
      .all();

    if (engagements.length < 5) {
      // Not enough data, return default
      return isWeekend ? 10 : 9;
    }

    // Calculate engagement score by hour
    const hourlyScores: Record<number, { opens: number; total: number; avgResponseTime: number }> = {};

    for (const engagement of engagements) {
      // Filter by weekend/weekday
      const dayIsWeekend = engagement.sent_day_of_week === 0 || engagement.sent_day_of_week === 6;
      if (dayIsWeekend !== isWeekend) continue;

      const hour = engagement.sent_hour;
      if (!hourlyScores[hour]) {
        hourlyScores[hour] = { opens: 0, total: 0, avgResponseTime: 0 };
      }

      hourlyScores[hour].total++;
      if (engagement.opened_at) {
        hourlyScores[hour].opens++;
        if (engagement.response_time_seconds) {
          // Faster response = better (lower is better)
          hourlyScores[hour].avgResponseTime =
            (hourlyScores[hour].avgResponseTime * (hourlyScores[hour].opens - 1) +
              engagement.response_time_seconds) /
            hourlyScores[hour].opens;
        }
      }
    }

    // Find hour with best engagement rate
    let bestHour = isWeekend ? 10 : 9;
    let bestScore = 0;

    for (const [hourStr, data] of Object.entries(hourlyScores)) {
      const hour = parseInt(hourStr);
      if (data.total < 2) continue; // Need at least 2 samples

      // Score = open rate * time bonus (faster response = better)
      const openRate = data.opens / data.total;
      const timeBonus = data.avgResponseTime > 0 ? Math.max(0, 1 - data.avgResponseTime / 3600) : 0.5;
      const score = openRate * (1 + timeBonus);

      if (score > bestScore) {
        bestScore = score;
        bestHour = hour;
      }
    }

    return bestHour;
  }

  /**
   * Recompute and store optimal send times for a user
   * Should be called periodically (e.g., daily via cron)
   */
  async recomputeOptimalTimes(userId: string): Promise<void> {
    const weekdayHours = await this.computeTopHours(userId, false, 3);
    const weekendHours = await this.computeTopHours(userId, true, 3);
    const hourlyScores = await this.computeHourlyEngagementScores(userId);

    const now = nowIso();
    const id = crypto.randomUUID();

    // Upsert optimal times
    const existing = await this.db
      .select()
      .from(userOptimalSendTimes)
      .where(eq(userOptimalSendTimes.user_id, userId))
      .get();

    if (existing) {
      await this.db
        .update(userOptimalSendTimes)
        .set({
          weekday_hours: JSON.stringify(weekdayHours),
          weekend_hours: JSON.stringify(weekendHours),
          hourly_engagement_scores: JSON.stringify(hourlyScores),
          last_computed_at: now,
          updated_at: now,
        })
        .where(eq(userOptimalSendTimes.user_id, userId));
    } else {
      await this.db.insert(userOptimalSendTimes).values({
        id,
        user_id: userId,
        weekday_hours: JSON.stringify(weekdayHours),
        weekend_hours: JSON.stringify(weekendHours),
        hourly_engagement_scores: JSON.stringify(hourlyScores),
        last_computed_at: now,
        created_at: now,
        updated_at: now,
      });
    }
  }

  private async computeTopHours(userId: string, isWeekend: boolean, count: number): Promise<number[]> {
    const scores = await this.computeHourlyEngagementScores(userId, isWeekend);
    
    return Object.entries(scores)
      .sort(([, a], [, b]) => b - a)
      .slice(0, count)
      .map(([hour]) => parseInt(hour));
  }

  private async computeHourlyEngagementScores(
    userId: string,
    isWeekend?: boolean
  ): Promise<Record<number, number>> {
    const engagements = await this.db
      .select()
      .from(notificationEngagement)
      .where(eq(notificationEngagement.user_id, userId))
      .all();

    const scores: Record<number, number> = {};

    for (let hour = 0; hour < 24; hour++) {
      const hourEngagements = engagements.filter((e) => {
        if (e.sent_hour !== hour) return false;
        if (isWeekend !== undefined) {
          const dayIsWeekend = e.sent_day_of_week === 0 || e.sent_day_of_week === 6;
          if (dayIsWeekend !== isWeekend) return false;
        }
        return true;
      });

      if (hourEngagements.length === 0) {
        scores[hour] = 0;
        continue;
      }

      const opens = hourEngagements.filter((e) => e.opened_at).length;
      scores[hour] = opens / hourEngagements.length;
    }

    return scores;
  }

  // ============ A/B TESTING ============

  /**
   * Get active A/B test for a notification type
   */
  async getActiveTest(notificationType: string): Promise<AbTest | null> {
    const test = await this.db
      .select()
      .from(notificationAbTests)
      .where(
        and(
          eq(notificationAbTests.notification_type, notificationType),
          eq(notificationAbTests.is_active, true)
        )
      )
      .get();

    if (!test) return null;

    return {
      id: test.id,
      name: test.name,
      notificationType: test.notification_type,
      variants: JSON.parse(test.variants),
      trafficPercentage: test.traffic_percentage,
    };
  }

  /**
   * Get or assign user to an A/B test variant
   */
  async getUserVariant(userId: string, test: AbTest): Promise<AbTestVariant> {
    // Check if user is already assigned
    const existing = await this.db
      .select()
      .from(userAbTestAssignments)
      .where(
        and(
          eq(userAbTestAssignments.user_id, userId),
          eq(userAbTestAssignments.test_id, test.id)
        )
      )
      .get();

    if (existing) {
      return test.variants.find((v) => v.id === existing.variant_id) || test.variants[0];
    }

    // Check if user should be in test (traffic allocation)
    const userHash = await this.hashUserId(userId, test.id);
    const inTest = userHash % 100 < test.trafficPercentage;

    if (!inTest) {
      // Return control variant
      return test.variants[0];
    }

    // Assign to variant (consistent hashing)
    const variantIndex = userHash % test.variants.length;
    const variant = test.variants[variantIndex];

    // Record assignment
    await this.db.insert(userAbTestAssignments).values({
      id: crypto.randomUUID(),
      user_id: userId,
      test_id: test.id,
      variant_id: variant.id,
      notifications_sent: 0,
      notifications_opened: 0,
      actions_taken: 0,
      created_at: nowIso(),
    });

    return variant;
  }

  /**
   * Apply A/B test variant to notification content
   */
  async applyAbTest(
    userId: string,
    notificationType: string,
    defaultTitle: string,
    defaultBody: string
  ): Promise<{ title: string; body: string; variantId?: string; testId?: string }> {
    const test = await this.getActiveTest(notificationType);

    if (!test) {
      return { title: defaultTitle, body: defaultBody };
    }

    const variant = await this.getUserVariant(userId, test);

    // Increment sent count
    await this.db
      .update(userAbTestAssignments)
      .set({
        notifications_sent: sql`notifications_sent + 1`,
      })
      .where(
        and(
          eq(userAbTestAssignments.user_id, userId),
          eq(userAbTestAssignments.test_id, test.id)
        )
      );

    return {
      title: variant.title || defaultTitle,
      body: variant.body || defaultBody,
      variantId: variant.id,
      testId: test.id,
    };
  }

  private async updateAbTestMetrics(
    userId: string,
    notificationId: string,
    wasOpened: boolean,
    hadAction: boolean
  ): Promise<void> {
    // Get notification to find test info
    const notification = await this.db
      .select()
      .from(notificationHistory)
      .where(eq(notificationHistory.id, notificationId))
      .get();

    if (!notification) return;

    // Parse data to get test info
    const data = notification.data ? JSON.parse(notification.data) : {};
    const testId = data.abTestId;

    if (!testId) return;

    // Update metrics
    const updates: Record<string, unknown> = {};
    if (wasOpened) {
      updates.notifications_opened = sql`notifications_opened + 1`;
    }
    if (hadAction) {
      updates.actions_taken = sql`actions_taken + 1`;
    }

    if (Object.keys(updates).length > 0) {
      await this.db
        .update(userAbTestAssignments)
        .set(updates)
        .where(
          and(
            eq(userAbTestAssignments.user_id, userId),
            eq(userAbTestAssignments.test_id, testId)
          )
        );
    }
  }

  /**
   * Create a new A/B test
   */
  async createAbTest(
    name: string,
    notificationType: string,
    variants: AbTestVariant[],
    trafficPercentage: number = 100
  ): Promise<string> {
    const id = crypto.randomUUID();

    await this.db.insert(notificationAbTests).values({
      id,
      name,
      notification_type: notificationType,
      is_active: true,
      variants: JSON.stringify(variants),
      traffic_percentage: trafficPercentage,
      start_date: nowIso(),
      created_at: nowIso(),
    });

    return id;
  }

  /**
   * End an A/B test and declare winner
   */
  async endAbTest(testId: string, winningVariantId?: string): Promise<void> {
    // If no winner specified, compute from metrics
    let winner = winningVariantId;

    if (!winner) {
      const assignments = await this.db
        .select()
        .from(userAbTestAssignments)
        .where(eq(userAbTestAssignments.test_id, testId))
        .all();

      // Calculate conversion rate per variant
      const variantMetrics: Record<string, { sent: number; opened: number; actions: number }> = {};

      for (const assignment of assignments) {
        if (!variantMetrics[assignment.variant_id]) {
          variantMetrics[assignment.variant_id] = { sent: 0, opened: 0, actions: 0 };
        }
        variantMetrics[assignment.variant_id].sent += assignment.notifications_sent;
        variantMetrics[assignment.variant_id].opened += assignment.notifications_opened;
        variantMetrics[assignment.variant_id].actions += assignment.actions_taken;
      }

      // Find variant with highest action rate
      let bestRate = 0;
      for (const [variantId, metrics] of Object.entries(variantMetrics)) {
        if (metrics.sent > 0) {
          const actionRate = metrics.actions / metrics.sent;
          if (actionRate > bestRate) {
            bestRate = actionRate;
            winner = variantId;
          }
        }
      }
    }

    await this.db
      .update(notificationAbTests)
      .set({
        is_active: false,
        end_date: nowIso(),
        winning_variant: winner,
      })
      .where(eq(notificationAbTests.id, testId));
  }

  /**
   * Get A/B test results
   */
  async getAbTestResults(testId: string): Promise<{
    variants: Record<string, { sent: number; openRate: number; actionRate: number }>;
    winner?: string;
  }> {
    const test = await this.db
      .select()
      .from(notificationAbTests)
      .where(eq(notificationAbTests.id, testId))
      .get();

    const assignments = await this.db
      .select()
      .from(userAbTestAssignments)
      .where(eq(userAbTestAssignments.test_id, testId))
      .all();

    const variantMetrics: Record<string, { sent: number; opened: number; actions: number }> = {};

    for (const assignment of assignments) {
      if (!variantMetrics[assignment.variant_id]) {
        variantMetrics[assignment.variant_id] = { sent: 0, opened: 0, actions: 0 };
      }
      variantMetrics[assignment.variant_id].sent += assignment.notifications_sent;
      variantMetrics[assignment.variant_id].opened += assignment.notifications_opened;
      variantMetrics[assignment.variant_id].actions += assignment.actions_taken;
    }

    const results: Record<string, { sent: number; openRate: number; actionRate: number }> = {};

    for (const [variantId, metrics] of Object.entries(variantMetrics)) {
      results[variantId] = {
        sent: metrics.sent,
        openRate: metrics.sent > 0 ? metrics.opened / metrics.sent : 0,
        actionRate: metrics.sent > 0 ? metrics.actions / metrics.sent : 0,
      };
    }

    return {
      variants: results,
      winner: test?.winning_variant || undefined,
    };
  }

  private async hashUserId(userId: string, testId: string): Promise<number> {
    // Simple hash for consistent user-test assignment
    const str = `${userId}:${testId}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }
}
