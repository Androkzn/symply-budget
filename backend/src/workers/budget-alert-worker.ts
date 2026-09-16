import { eq, and, isNull, gte, like } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';

import { households, householdMembers } from '../db/schema';
import { budgetGoals } from '../db/schema-budget';
import { notificationHistory } from '../db/schema-notifications';
import { BudgetEncouragementService } from '../services/budget-encouragement';
import { BudgetInsightsService } from '../services/budget-insights-service';
import { BudgetService } from '../services/budget-service';
import { NotificationService } from '../services/notification-service';
import type { Env } from '../types';

/** Alert once the remaining balance is negative or below this fraction of plan. */
const NEAR_BUDGET_THRESHOLD = 0.1;

/**
 * Smart Budget background worker — over-budget alerts + weekly AI digest.
 *
 * Mirrors AIHousekeeperWorker's shape. Wired into the existing `scheduled()`
 * handler in index.ts (NOT a new cron trigger — the Cloudflare account is
 * already at its 5-cron limit, and the trigger is currently disabled in both
 * environments; see wrangler.toml). This worker is correct and safe to ship
 * as dormant code — it starts firing automatically once cron is re-enabled.
 */
export class BudgetAlertWorker {
  private db: DrizzleD1Database;
  private budgetService: BudgetService;
  private insightsService: BudgetInsightsService;
  private encouragementService: BudgetEncouragementService;
  private notificationService: NotificationService;

  constructor(env: Env, d1: D1Database) {
    this.db = drizzle(d1);
    this.budgetService = new BudgetService(env, d1);
    this.insightsService = new BudgetInsightsService(env, d1);
    this.encouragementService = new BudgetEncouragementService(env, d1);
    this.notificationService = new NotificationService(env, d1);
  }

  private async getActiveHouseholdIds(): Promise<string[]> {
    const rows = await this.db
      .select({ id: households.id })
      .from(households)
      .where(isNull(households.deleted_at))
      .all();
    return rows.map((r) => r.id);
  }

  private async getActiveMemberUserIds(householdId: string): Promise<string[]> {
    const rows = await this.db
      .select({ user_id: householdMembers.user_id })
      .from(householdMembers)
      .where(and(eq(householdMembers.household_id, householdId), isNull(householdMembers.deleted_at)))
      .all();
    return rows.map((r) => r.user_id);
  }

  private async alreadyAlertedThisMonth(householdId: string, monthStart: string): Promise<boolean> {
    const row = await this.db
      .select({ id: notificationHistory.id })
      .from(notificationHistory)
      .where(
        and(
          eq(notificationHistory.type, 'budget_alert'),
          like(notificationHistory.data, `%"householdId":"${householdId}"%`),
          gte(notificationHistory.sent_at, monthStart)
        )
      )
      .get();
    return !!row;
  }

  private async alreadyEncouragedSince(householdId: string, sinceIso: string): Promise<boolean> {
    const row = await this.db
      .select({ id: notificationHistory.id })
      .from(notificationHistory)
      .where(
        and(
          eq(notificationHistory.type, 'budget_encouragement'),
          like(notificationHistory.data, `%"householdId":"${householdId}"%`),
          gte(notificationHistory.sent_at, sinceIso)
        )
      )
      .get();
    return !!row;
  }

  /**
   * Daily check: any household whose current-month remaining balance is
   * negative or under 10% of its planned budget gets alerted once per month.
   */
  async checkOverBudgetAlerts(
    now: Date = new Date()
  ): Promise<{ checked: number; alertsSent: number }> {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;

    const householdIds = await this.getActiveHouseholdIds();
    let checked = 0;
    let alertsSent = 0;

    for (const householdId of householdIds) {
      try {
        const goal = await this.db
          .select()
          .from(budgetGoals)
          .where(
            and(
              eq(budgetGoals.household_id, householdId),
              eq(budgetGoals.year, year),
              eq(budgetGoals.month, month)
            )
          )
          .get();

        if (!goal || !goal.planned_budget) continue; // no cap set — nothing to alert on
        checked++;

        const memberIds = await this.getActiveMemberUserIds(householdId);
        if (memberIds.length === 0) continue;

        const overview = await this.budgetService.getMonthlyOverview(
          householdId,
          memberIds[0],
          year,
          month
        );

        const nearLimit = overview.remainingBudget < overview.plannedBudget * NEAR_BUDGET_THRESHOLD;
        if (!nearLimit) continue;

        if (await this.alreadyAlertedThisMonth(householdId, monthStart)) continue;

        const overBudget = overview.remainingBudget < 0;
        const title = overBudget ? 'Over this month’s budget' : 'Approaching this month’s budget';
        const body = overBudget
          ? `Your household is over its $${(overview.plannedBudget / 100).toFixed(0)} budget for this month.`
          : `Only $${Math.max(0, overview.remainingBudget / 100).toFixed(0)} left of this month’s budget.`;

        for (const userId of memberIds) {
          await this.notificationService.sendNotification({
            userId,
            type: 'budget_alert',
            title,
            body,
            data: { householdId, period: `${year}-${String(month).padStart(2, '0')}`, screen: 'BudgetMain' },
            referenceType: 'household',
            referenceId: householdId,
          });
        }
        alertsSent++;
      } catch (error) {
        console.error('[budget-alert-worker] checkOverBudgetAlerts failed for household', {
          householdId,
          error: (error as Error).message,
        });
      }
    }

    return { checked, alertsSent };
  }

  /** Weekly AI-narrative digest per household, mirrors AIHousekeeperWorker.sendWeeklySummaries(). */
  async sendWeeklyDigests(now: Date = new Date()): Promise<number> {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;

    const householdIds = await this.getActiveHouseholdIds();
    let sent = 0;

    for (const householdId of householdIds) {
      try {
        const memberIds = await this.getActiveMemberUserIds(householdId);
        if (memberIds.length === 0) continue;

        const goal = await this.db
          .select()
          .from(budgetGoals)
          .where(
            and(
              eq(budgetGoals.household_id, householdId),
              eq(budgetGoals.year, year),
              eq(budgetGoals.month, month)
            )
          )
          .get();
        if (!goal || !goal.planned_budget) continue; // nothing meaningful to digest yet

        const insights = await this.insightsService.getInsights(householdId, memberIds[0], year, month);

        for (const userId of memberIds) {
          await this.notificationService.sendNotification({
            userId,
            type: 'budget_digest',
            title: 'Your weekly budget digest',
            body: insights.summary,
            data: {
              householdId,
              period: `${year}-${String(month).padStart(2, '0')}`,
              screen: 'BudgetMain',
            },
            referenceType: 'household',
            referenceId: householdId,
          });
        }
        sent++;
      } catch (error) {
        console.error('[budget-alert-worker] sendWeeklyDigests failed for household', {
          householdId,
          error: (error as Error).message,
        });
      }
    }

    return sent;
  }

  /**
   * Weekly positive reinforcement. For each household we compute the same
   * deterministic "Budget Wins" card the dashboard shows and ONLY push it when
   * it's a genuine win (`isPositive`) — a no-spend week, ahead of pace, spending
   * trending down, or growing savings. Households that are over budget or merely
   * on-track get nothing here (the over-budget alert path handles the hard news),
   * so this channel stays celebratory and never nags. Deduped to once per 6 days
   * per household via notification_history.
   */
  async sendWeeklyEncouragements(now: Date = new Date()): Promise<number> {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const sixDaysAgo = new Date(now.getTime() - 6 * 86_400_000).toISOString();

    const householdIds = await this.getActiveHouseholdIds();
    let sent = 0;

    for (const householdId of householdIds) {
      try {
        const memberIds = await this.getActiveMemberUserIds(householdId);
        if (memberIds.length === 0) continue;

        const encouragement = await this.encouragementService.getEncouragement(
          householdId,
          memberIds[0],
          year,
          month,
          now
        );

        // Only celebrate real wins; skip neutral/watch/tip and anything with no cap set.
        if (!encouragement.isPositive) continue;

        if (await this.alreadyEncouragedSince(householdId, sixDaysAgo)) continue;

        const body = encouragement.highlight
          ? `${encouragement.message} (${encouragement.highlight})`
          : encouragement.message;

        for (const userId of memberIds) {
          await this.notificationService.sendNotification({
            userId,
            type: 'budget_encouragement',
            title: `${encouragement.emoji} ${encouragement.headline}`,
            body,
            data: {
              householdId,
              period: `${year}-${String(month).padStart(2, '0')}`,
              screen: 'BudgetMain',
            },
            referenceType: 'household',
            referenceId: householdId,
          });
        }
        sent++;
      } catch (error) {
        console.error('[budget-alert-worker] sendWeeklyEncouragements failed for household', {
          householdId,
          error: (error as Error).message,
        });
      }
    }

    return sent;
  }
}
