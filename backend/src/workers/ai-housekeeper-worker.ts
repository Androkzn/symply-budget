import { eq, and, isNull } from 'drizzle-orm';
import { DrizzleD1Database, drizzle } from 'drizzle-orm/d1';

import { createProviderAdapter } from '../ai/provider-factory';
import {
  households,
  householdMembers,
} from '../db/schema';
import {
  aiHousekeeperPreferences,
} from '../db/schema-ai-housekeeper';
import { AIHousekeeperService } from '../services/ai-housekeeper-service';
import { AINotificationOrchestrator } from '../services/ai-notification-orchestrator';
import { usageRecorderFor } from '../services/ai-usage-service';
import { localFirstHouseholdIds } from '../services/local-first-household-gate';
import { NotificationService } from '../services/notification-service';
import type { Env } from '../types';

/**
 * AI Housekeeper Background Worker
 *
 * Runs on Cloudflare Workers cron schedule to:
 * 1. Analyze all active households
 * 2. Generate suggestions, predictions, and insights
 * 3. Schedule notifications at optimal times
 * 4. Track metrics and performance
 */
export class AIHousekeeperWorker {
  private db: DrizzleD1Database;
  private env: Env;
  private notificationOrchestrator: AINotificationOrchestrator;
  private notificationService: NotificationService;

  constructor(env: Env, d1: D1Database) {
    this.db = drizzle(d1);
    // Kept for `localFirstHouseholdIds`, which reads the control-plane table
    // through the binding rather than through this worker's drizzle handle.
    this.env = env;

    this.notificationService = new NotificationService(env, d1);
    this.notificationOrchestrator = new AINotificationOrchestrator(
      this.db,
      this.notificationService
    );
  }

  /**
   * One analysis service per household, so its token spend is attributed to the
   * household it was spent on.
   *
   * This used to be a single instance built in the constructor, which meant
   * every household's cron analysis was written with a null `household_id` —
   * logged, but invisible in the per-household usage report, and impossible to
   * attribute afterwards. The worker already loops households one at a time, so
   * binding the recorder per iteration costs nothing.
   */
  private aiServiceFor(householdId: string): AIHousekeeperService {
    const ai = createProviderAdapter({
      provider: 'anthropic',
      apiKey: this.env.ANTHROPIC_API_KEY ?? '',
      options: {
        onUsage: usageRecorderFor(this.env, {
          feature: 'aihousekeeper_worker',
          householdId,
        }),
      },
    });
    return new AIHousekeeperService(this.db, ai);
  }

  /**
   * Main worker execution - called by cron
   */
  async execute(): Promise<{
    households_processed: number;
    suggestions_generated: number;
    predictions_generated: number;
    notifications_scheduled: number;
    skipped_local_first: number;
    errors: string[];
  }> {
    console.log('[AI Housekeeper Worker] Starting execution...');

    const results = {
      households_processed: 0,
      suggestions_generated: 0,
      predictions_generated: 0,
      notifications_scheduled: 0,
      skipped_local_first: 0,
      errors: [] as string[],
    };

    try {
      // Get all active households with AI housekeeper enabled
      const activeHouseholds = await this.getActiveHouseholds();

      /**
       * H7 P4 (plan §9, Q8). `getActiveHouseholds` enumerates
       * `household_members` joined to `households` — both written for a
       * local-first household by `mirrorLegacyMembership`, which exists so chat
       * and the other `/households/:id/...` endpoints can authorise. So this
       * worker *sees* local-first homes even though their tasks, appliances and
       * service history live only on a phone.
       *
       * `analyzeHousehold` then runs an AI pass over that empty D1 and
       * `scheduleNotifications` turns the result into push notifications. That
       * is the digest hazard exactly: work composed from rows that are not
       * there, and then SENT. `maintenance_suggestions` is a Tier-D table under
       * E2EE — it is not degraded, it is gone, and the on-device replacement is
       * `features/house/local/ai/houseHomeInsights.ts`.
       *
       * Fetched once per tick, per `DigestComposer.runDueThisHour`.
       */
      const localFirst = await localFirstHouseholdIds(this.env);

      console.log(`[AI Housekeeper Worker] Found ${activeHouseholds.length} active households`);

      // Process each household
      for (const household of activeHouseholds) {
        if (localFirst.has(household.id)) {
          results.skipped_local_first += 1;
          continue;
        }
        try {
          await this.processHousehold(household, results);
        } catch (error) {
          const errorMsg = `Error processing household ${household.id}: ${error}`;
          console.error(errorMsg);
          results.errors.push(errorMsg);
        }
      }

      if (results.skipped_local_first > 0) {
        console.log(
          `[AI Housekeeper Worker] skipped ${results.skipped_local_first} local-first household(s) — suggestions are on-device (H7 P4)`
        );
      }

      console.log('[AI Housekeeper Worker] Execution complete:', results);
      return results;
    } catch (error) {
      const errorMsg = `Fatal error in AI Housekeeper Worker: ${error}`;
      console.error(errorMsg);
      results.errors.push(errorMsg);
      return results;
    }
  }

  /**
   * Get all active households with AI housekeeper enabled
   */
  private async getActiveHouseholds(): Promise<Array<{
    id: string;
    name: string;
    user_id: string | null;
  }>> {
    // Get households that have members with AI housekeeper enabled
    const householdsWithAI = await this.db
      .select({
        household_id: householdMembers.household_id,
        user_id: householdMembers.user_id,
      })
      .from(householdMembers)
      .innerJoin(
        aiHousekeeperPreferences,
        and(
          eq(householdMembers.user_id, aiHousekeeperPreferences.user_id),
          eq(aiHousekeeperPreferences.enabled, true)
        )
      )
      .where(isNull(householdMembers.deleted_at))
      .all();

    if (householdsWithAI.length === 0) {
      return [];
    }

    // Get unique household IDs
    const uniqueHouseholdIds = [...new Set(householdsWithAI.map(h => h.household_id))];

    // Fetch household details
    const householdDetails = await Promise.all(
      uniqueHouseholdIds.map(async (id) => {
        const household = await this.db
          .select()
          .from(households)
          .where(eq(households.id, id))
          .get();

        if (!household) return null;

        // Get primary user for this household
        const member = householdsWithAI.find(h => h.household_id === id);

        return {
          id: household.id,
          name: household.name,
          user_id: member?.user_id || null,
        };
      })
    );

    return householdDetails.filter((h): h is NonNullable<typeof h> => h !== null);
  }

  /**
   * Process a single household
   */
  private async processHousehold(
    household: { id: string; name: string; user_id: string | null },
    results: any
  ): Promise<void> {
    console.log(`[AI Housekeeper Worker] Processing household: ${household.name} (${household.id})`);

    // Analyze household and generate suggestions/predictions. The service is
    // built per household so its AI spend lands on that household's ledger.
    const analysis = await this.aiServiceFor(household.id).analyzeHousehold(household.id);

    results.households_processed++;
    results.suggestions_generated += analysis.suggestions.length;
    results.predictions_generated += analysis.predictions.length;

    console.log(`[AI Housekeeper Worker] Generated ${analysis.suggestions.length} suggestions, ${analysis.predictions.length} predictions for ${household.name}`);

    // Schedule notifications for high-priority items
    if (household.user_id) {
      await this.scheduleNotifications(
        household.user_id,
        household.id,
        analysis,
        results
      );
    }
  }

  /**
   * Schedule notifications for suggestions and predictions
   */
  private async scheduleNotifications(
    userId: string,
    householdId: string,
    analysis: any,
    results: any
  ): Promise<void> {
    // Schedule notifications for high-priority suggestions (priority >= 7)
    const highPrioritySuggestions = analysis.suggestions.filter(
      (s: any) => s.priority_score && s.priority_score >= 7
    );

    if (highPrioritySuggestions.length > 0) {
      // Batch high-priority suggestions into a single notification
      await this.notificationOrchestrator.batchNotifications(
        userId,
        householdId,
        highPrioritySuggestions
      );
      results.notifications_scheduled += 1;
    }

    // Schedule notifications for high-confidence predictions
    const highConfidencePredictions = analysis.predictions.filter(
      (p: any) => p.confidence_level === 'high'
    );

    for (const prediction of highConfidencePredictions) {
      await this.notificationOrchestrator.schedulePredictionNotification(
        userId,
        householdId,
        prediction
      );
      results.notifications_scheduled += 1;
    }

    console.log(`[AI Housekeeper Worker] Scheduled ${results.notifications_scheduled} notifications for user ${userId}`);
  }

  /**
   * Send daily digest to users who have daily frequency enabled
   */
  async sendDailyDigests(): Promise<number> {
    console.log('[AI Housekeeper Worker] Sending daily digests...');

    const usersWithDaily = await this.db
      .select()
      .from(aiHousekeeperPreferences)
      .where(
        and(
          eq(aiHousekeeperPreferences.enabled, true),
          eq(aiHousekeeperPreferences.notification_frequency, 'daily')
        )
      )
      .all();

    // H7 P4: same reasoning as `execute()` — the digest body is composed from
    // the household's tasks and suggestions in D1, which a local-first
    // household does not write. Once per call, not once per household.
    const localFirst = await localFirstHouseholdIds(this.env);
    let digestsSent = 0;
    let skippedLocalFirst = 0;

    for (const userPrefs of usersWithDaily) {
      try {
        // Get user's households
        const userHouseholds = await this.db
          .select({ household_id: householdMembers.household_id })
          .from(householdMembers)
          .where(
            and(
              eq(householdMembers.user_id, userPrefs.user_id),
              isNull(householdMembers.deleted_at)
            )
          )
          .all();

        // Send digest for each household
        for (const { household_id } of userHouseholds) {
          if (localFirst.has(household_id)) {
            skippedLocalFirst++;
            continue;
          }
          await this.notificationOrchestrator.sendDailyDigest(
            userPrefs.user_id,
            household_id
          );
          digestsSent++;
        }
      } catch (error) {
        console.error(`Error sending daily digest to user ${userPrefs.user_id}:`, error);
      }
    }

    if (skippedLocalFirst > 0) {
      console.log(
        `[AI Housekeeper Worker] skipped ${skippedLocalFirst} local-first household(s) — daily digests are in-app only (H7 P4)`
      );
    }
    console.log(`[AI Housekeeper Worker] Sent ${digestsSent} daily digests`);
    return digestsSent;
  }

  /**
   * Send weekly summary to users who have weekly frequency enabled
   */
  async sendWeeklySummaries(): Promise<number> {
    console.log('[AI Housekeeper Worker] Sending weekly summaries...');

    const usersWithWeekly = await this.db
      .select()
      .from(aiHousekeeperPreferences)
      .where(
        and(
          eq(aiHousekeeperPreferences.enabled, true),
          eq(aiHousekeeperPreferences.notification_frequency, 'weekly')
        )
      )
      .all();

    // H7 P4: same reasoning as `sendDailyDigests` — a week's summary of an
    // empty D1 is still an email or a push about a home the server cannot see.
    const localFirst = await localFirstHouseholdIds(this.env);
    let summariesSent = 0;
    let skippedLocalFirst = 0;

    for (const userPrefs of usersWithWeekly) {
      try {
        // Get user's households
        const userHouseholds = await this.db
          .select({ household_id: householdMembers.household_id })
          .from(householdMembers)
          .where(
            and(
              eq(householdMembers.user_id, userPrefs.user_id),
              isNull(householdMembers.deleted_at)
            )
          )
          .all();

        // Send summary for each household
        for (const { household_id } of userHouseholds) {
          if (localFirst.has(household_id)) {
            skippedLocalFirst++;
            continue;
          }
          await this.notificationOrchestrator.sendWeeklySummary(
            userPrefs.user_id,
            household_id
          );
          summariesSent++;
        }
      } catch (error) {
        console.error(`Error sending weekly summary to user ${userPrefs.user_id}:`, error);
      }
    }

    if (skippedLocalFirst > 0) {
      console.log(
        `[AI Housekeeper Worker] skipped ${skippedLocalFirst} local-first household(s) — weekly summaries are in-app only (H7 P4)`
      );
    }
    console.log(`[AI Housekeeper Worker] Sent ${summariesSent} weekly summaries`);
    return summariesSent;
  }
}
