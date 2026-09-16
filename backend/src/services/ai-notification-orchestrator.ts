import { eq, and, gte, desc } from 'drizzle-orm';
import { DrizzleD1Database } from 'drizzle-orm/d1';

import {
  aiHousekeeperSuggestions,
  aiHousekeeperPreferences,
  type AIHousekeeperSuggestion,
  type AIMaintenancePrediction,
} from '../db/schema-ai-housekeeper';
import {
  notificationHistory,
  userOptimalSendTimes,
} from '../db/schema-notifications';

import { NotificationService } from './notification-service';

/**
 * AI Notification Orchestrator
 *
 * Handles intelligent notification scheduling for AI Housekeeper:
 * - Schedules notifications at optimal times based on user engagement
 * - Batches related notifications to avoid spam
 * - Personalizes notification content based on AI personality
 * - Respects notification frequency preferences
 * - Creates rich notifications with action buttons
 */
export class AINotificationOrchestrator {
  constructor(
    private db: DrizzleD1Database,
    private notificationService: NotificationService
  ) {}

  /**
   * Schedule smart notification for an AI suggestion
   */
  async scheduleSmartNotification(
    userId: string,
    householdId: string,
    suggestion: AIHousekeeperSuggestion
  ): Promise<void> {
    // Get user preferences
    const prefs = await this.db
      .select()
      .from(aiHousekeeperPreferences)
      .where(eq(aiHousekeeperPreferences.user_id, userId))
      .get();

    if (!prefs?.enabled) {
      return; // AI housekeeper disabled
    }

    // Check if we should send notification based on frequency
    const shouldSend = await this.checkNotificationFrequency(userId, prefs.notification_frequency);
    if (!shouldSend) {
      return;
    }

    // Get optimal send time for this user
    const optimalTime = await this.getOptimalSendTime(userId, new Date());

    // Build notification content based on AI personality
    const notification = this.buildNotificationContent(suggestion, prefs.ai_personality);

    // Schedule notification
    await this.notificationService.scheduleNotification({
      userId,
      householdId,
      type: `ai_suggestion_${suggestion.suggestion_type}`,
      title: notification.title,
      body: notification.body,
      data: {
        suggestion_id: suggestion.id,
        suggestion_type: suggestion.suggestion_type,
        priority_score: suggestion.priority_score?.toString() || '5',
      },
      referenceType: 'ai_suggestion',
      referenceId: suggestion.id,
      scheduledFor: optimalTime,
      imageUrl: notification.imageUrl,
      categoryId: this.getCategoryId(suggestion.suggestion_type),
      threadId: `ai-housekeeper-${householdId}`,
    });
  }

  /**
   * Schedule notification for a maintenance prediction
   */
  async schedulePredictionNotification(
    userId: string,
    householdId: string,
    prediction: AIMaintenancePrediction
  ): Promise<void> {
    const prefs = await this.db
      .select()
      .from(aiHousekeeperPreferences)
      .where(eq(aiHousekeeperPreferences.user_id, userId))
      .get();

    if (!prefs?.enabled || !prefs.enable_predictions) {
      return;
    }

    const optimalTime = await this.getOptimalSendTime(userId, new Date());

    const notification = this.buildPredictionNotificationContent(prediction, prefs.ai_personality);

    await this.notificationService.scheduleNotification({
      userId,
      householdId,
      type: 'ai_prediction',
      title: notification.title,
      body: notification.body,
      data: {
        prediction_id: prediction.id,
        prediction_type: prediction.prediction_type,
        confidence_level: prediction.confidence_level,
      },
      referenceType: 'ai_prediction',
      referenceId: prediction.id,
      scheduledFor: optimalTime,
      imageUrl: notification.imageUrl,
      categoryId: 'ai_prediction',
      threadId: `ai-predictions-${householdId}`,
    });
  }

  /**
   * Batch multiple suggestions into a single notification
   */
  async batchNotifications(
    userId: string,
    householdId: string,
    suggestions: AIHousekeeperSuggestion[]
  ): Promise<void> {
    if (suggestions.length === 0) return;

    const prefs = await this.db
      .select()
      .from(aiHousekeeperPreferences)
      .where(eq(aiHousekeeperPreferences.user_id, userId))
      .get();

    if (!prefs?.enabled) return;

    const optimalTime = await this.getOptimalSendTime(userId, new Date());

    // Group by type
    const groupedSuggestions = this.groupSuggestionsByType(suggestions);

    for (const [type, items] of Object.entries(groupedSuggestions)) {
      if (items.length === 0) continue;

      const notification = this.buildBatchedNotificationContent(items, type, prefs.ai_personality);

      await this.notificationService.scheduleNotification({
        userId,
        householdId,
        type: `ai_batch_${type}`,
        title: notification.title,
        body: notification.body,
        data: {
          suggestion_ids: items.map(s => s.id).join(','),
          count: items.length.toString(),
        },
        referenceType: 'ai_batch',
        referenceId: items[0].id,
        scheduledFor: optimalTime,
        categoryId: 'ai_batch',
        threadId: `ai-batch-${householdId}`,
      });
    }
  }

  /**
   * Get optimal send time for user based on engagement patterns
   */
  private async getOptimalSendTime(userId: string, baseDate: Date): Promise<Date> {
    // Get user's optimal send times
    const optimalTimes = await this.db
      .select()
      .from(userOptimalSendTimes)
      .where(eq(userOptimalSendTimes.user_id, userId))
      .get();

    const now = new Date();
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;
    const optimalHours = isWeekend
      ? optimalTimes?.weekend_hours
      : optimalTimes?.weekday_hours;

    // Parse optimal hours (stored as JSON array)
    let hours: number[] = [9, 12, 18]; // Default times
    if (optimalHours) {
      try {
        hours = JSON.parse(optimalHours);
      } catch {
        // Use defaults
      }
    }

    // Find next optimal hour
    const currentHour = now.getHours();
    const targetHour = hours.find(h => h > currentHour) || hours[0];

    // If target hour is earlier than current, schedule for next day
    const scheduledTime = new Date(baseDate);
    if (targetHour <= currentHour) {
      scheduledTime.setDate(scheduledTime.getDate() + 1);
    }
    scheduledTime.setHours(targetHour, 0, 0, 0);

    return scheduledTime;
  }

  /**
   * Check if we should send notification based on frequency preference
   */
  private async checkNotificationFrequency(
    userId: string,
    frequency: string
  ): Promise<boolean> {
    // Get last AI notification sent
    const lastNotification = await this.db
      .select()
      .from(notificationHistory)
      .where(eq(notificationHistory.user_id, userId))
      .orderBy(desc(notificationHistory.sent_at))
      .limit(1)
      .get();

    if (!lastNotification) {
      return true; // No previous notification, OK to send
    }

    const lastSent = new Date(lastNotification.sent_at);
    const now = new Date();
    const hoursSince = (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60);

    switch (frequency) {
      case 'daily':
        return hoursSince >= 20; // At least 20 hours between notifications
      case 'three_per_week':
        return hoursSince >= 48; // At least 2 days between notifications
      case 'weekly':
        return hoursSince >= 168; // At least 7 days between notifications
      case 'disabled':
        return false;
      default:
        return hoursSince >= 24;
    }
  }

  /**
   * Build notification content based on suggestion and personality
   */
  private buildNotificationContent(
    suggestion: AIHousekeeperSuggestion,
    personality: string
  ): { title: string; body: string; imageUrl?: string } {
    const personalities: { [key: string]: (s: AIHousekeeperSuggestion) => { title: string; body: string } } = {
      friendly: (s) => ({
        title: `🏠 ${s.title}`,
        body: s.description,
      }),
      professional: (s) => ({
        title: s.title,
        body: s.description,
      }),
      data_driven: (s) => ({
        title: `${s.title} (Priority: ${s.priority_score}/10)`,
        body: `${s.description}\n\nConfidence: ${Math.round((s.confidence_score || 0) * 100)}%`,
      }),
    };

    const builder = personalities[personality] || personalities.friendly;
    return builder(suggestion);
  }

  /**
   * Build notification content for predictions
   */
  private buildPredictionNotificationContent(
    prediction: AIMaintenancePrediction,
    _personality: string
  ): { title: string; body: string; imageUrl?: string } {
    const icons: { [key: string]: string } = {
      failure: '⚠️',
      service_needed: '🔧',
      replacement_recommended: '🔄',
      inspection_due: '🔍',
    };

    const icon = icons[prediction.prediction_type] || '🏠';

    return {
      title: `${icon} Maintenance Prediction`,
      body: prediction.reasoning,
    };
  }

  /**
   * Build batched notification content
   */
  private buildBatchedNotificationContent(
    suggestions: AIHousekeeperSuggestion[],
    type: string,
    _personality: string
  ): { title: string; body: string } {
    const count = suggestions.length;
    const typeLabels: { [key: string]: string } = {
      prediction: 'upcoming maintenance needs',
      procrastination_nudge: 'overdue tasks',
      batching_opportunity: 'cost-saving opportunities',
      celebration: 'achievements',
    };

    const label = typeLabels[type] || 'suggestions';

    return {
      title: `🏠 ${count} ${label} for your property`,
      body: `Tap to view your AI-generated recommendations and take action.`,
    };
  }

  /**
   * Group suggestions by type
   */
  private groupSuggestionsByType(
    suggestions: AIHousekeeperSuggestion[]
  ): { [key: string]: AIHousekeeperSuggestion[] } {
    return suggestions.reduce((acc, suggestion) => {
      const type = suggestion.suggestion_type;
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(suggestion);
      return acc;
    }, {} as { [key: string]: AIHousekeeperSuggestion[] });
  }

  /**
   * Get notification category ID for action buttons
   */
  private getCategoryId(suggestionType: string): string {
    const categories: { [key: string]: string } = {
      prediction: 'ai_prediction',
      procrastination_nudge: 'ai_nudge',
      batching_opportunity: 'ai_batching',
      celebration: 'ai_celebration',
      seasonal_reminder: 'ai_seasonal',
    };

    return categories[suggestionType] || 'ai_suggestion';
  }

  /**
   * Send daily digest notification
   */
  async sendDailyDigest(
    userId: string,
    householdId: string
  ): Promise<void> {
    const prefs = await this.db
      .select()
      .from(aiHousekeeperPreferences)
      .where(eq(aiHousekeeperPreferences.user_id, userId))
      .get();

    if (!prefs?.enabled || prefs.notification_frequency !== 'daily') {
      return;
    }

    // Get all pending suggestions for this household
    const pendingSuggestions = await this.db
      .select()
      .from(aiHousekeeperSuggestions)
      .where(
        and(
          eq(aiHousekeeperSuggestions.household_id, householdId),
          eq(aiHousekeeperSuggestions.status, 'pending')
        )
      )
      .orderBy(desc(aiHousekeeperSuggestions.priority_score))
      .limit(10)
      .all();

    if (pendingSuggestions.length === 0) {
      return; // No suggestions to notify about
    }

    // Get top 3 highest priority suggestions
    const topSuggestions = pendingSuggestions.slice(0, 3);

    const optimalTime = await this.getOptimalSendTime(userId, new Date());

    const title = prefs.ai_personality === 'friendly'
      ? `Good morning! ${topSuggestions.length} tasks need your attention 🏠`
      : `${topSuggestions.length} maintenance recommendations ready`;

    const body = topSuggestions
      .map((s, i) => `${i + 1}. ${s.title}`)
      .join('\n');

    await this.notificationService.scheduleNotification({
      userId,
      householdId,
      type: 'ai_daily_digest',
      title,
      body,
      data: {
        suggestion_count: topSuggestions.length.toString(),
        top_suggestion_id: topSuggestions[0].id,
      },
      referenceType: 'ai_daily_digest',
      referenceId: householdId,
      scheduledFor: optimalTime,
      categoryId: 'ai_daily_digest',
      threadId: `ai-daily-${householdId}`,
    });
  }

  /**
   * Send weekly summary notification
   */
  async sendWeeklySummary(
    userId: string,
    householdId: string
  ): Promise<void> {
    const prefs = await this.db
      .select()
      .from(aiHousekeeperPreferences)
      .where(eq(aiHousekeeperPreferences.user_id, userId))
      .get();

    if (!prefs?.enabled || prefs.notification_frequency !== 'weekly') {
      return;
    }

    // Get week's suggestions and completed tasks
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [recentSuggestions, completedSuggestions] = await Promise.all([
      this.db
        .select()
        .from(aiHousekeeperSuggestions)
        .where(
          and(
            eq(aiHousekeeperSuggestions.household_id, householdId),
            eq(aiHousekeeperSuggestions.status, 'pending'),
            gte(aiHousekeeperSuggestions.generated_at, oneWeekAgo)
          )
        )
        .all(),
      this.db
        .select()
        .from(aiHousekeeperSuggestions)
        .where(
          and(
            eq(aiHousekeeperSuggestions.household_id, householdId),
            eq(aiHousekeeperSuggestions.status, 'completed'),
            gte(aiHousekeeperSuggestions.user_action_at || '', oneWeekAgo)
          )
        )
        .all(),
    ]);

    const optimalTime = await this.getOptimalSendTime(userId, new Date());

    const title = `📊 Weekly Home Maintenance Summary`;
    const body = `This week: ${completedSuggestions.length} tasks completed, ${recentSuggestions.length} new recommendations. Tap to review.`;

    await this.notificationService.scheduleNotification({
      userId,
      householdId,
      type: 'ai_weekly_summary',
      title,
      body,
      data: {
        completed_count: completedSuggestions.length.toString(),
        pending_count: recentSuggestions.length.toString(),
      },
      referenceType: 'ai_weekly_summary',
      referenceId: householdId,
      scheduledFor: optimalTime,
      categoryId: 'ai_weekly_summary',
      threadId: `ai-weekly-${householdId}`,
    });
  }
}
