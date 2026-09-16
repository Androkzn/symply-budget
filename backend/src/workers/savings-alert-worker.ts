import { eq, and, isNull } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';

import { households, householdMembers } from '../db/schema';
import { savingsGoals } from '../db/schema-savings';
import { NotificationService } from '../services/notification-service';
import type { Env } from '../types';

/**
 * Savings background worker — behind-pace goal alerts.
 *
 * Mirrors BudgetAlertWorker's shape. Wired into the existing `scheduled()`
 * handler in index.ts (NOT a new cron trigger — the Cloudflare account is
 * already at its 5-cron limit, and the trigger is currently disabled in both
 * environments; see wrangler.toml). This worker is correct and safe to ship
 * as dormant code — it starts firing automatically once cron is re-enabled.
 *
 * A goal is "behind pace" when it has a *future* `target_date`, status
 * 'active', and its current balance is below where it *should* be if
 * contributions were spread linearly from creation to the target date:
 *   expectedByNow = target_amount_cents * (elapsedMonths / totalMonths)
 * Goals without a `target_date` are skipped (no pace to be behind on).
 */
export class SavingsAlertWorker {
  private env: Env;
  private db: DrizzleD1Database;
  private notificationService: NotificationService;

  constructor(env: Env, d1: D1Database) {
    this.env = env;
    this.db = drizzle(d1);
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

  /**
   * Number of whole (fractional) months between two dates. Uses a fixed
   * 30.44-day month so partial months are represented smoothly — this keeps
   * the pace ratio stable regardless of calendar-day variance.
   */
  private monthsBetween(from: Date, to: Date): number {
    return (to.getTime() - from.getTime()) / (30.44 * 86_400_000);
  }

  /**
   * Daily check: any household with ≥1 active savings goal that is behind its
   * linear pace toward a future target date gets ONE push per member. Uses
   * `sendNotification` (the same path cron-fired budget alerts use), NOT
   * `scheduleNotification`.
   */
  async checkBehindPaceGoals(now: Date = new Date()): Promise<{ notified: number }> {
    // IP4c kill-switch: absent key = enabled; only the literal 'false' disables.
    const flag = await this.env.CONFIG_KV.get('savings_enabled');
    if (flag === 'false') {
      return { notified: 0 };
    }

    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const period = `${year}-${String(month).padStart(2, '0')}`;

    const householdIds = await this.getActiveHouseholdIds();
    let notified = 0;

    for (const householdId of householdIds) {
      try {
        const goals = await this.db
          .select()
          .from(savingsGoals)
          .where(
            and(eq(savingsGoals.household_id, householdId), eq(savingsGoals.status, 'active'))
          )
          .all();

        const behindPaceGoals = goals.filter((goal) => {
          if (!goal.target_date) return false; // no pace to be behind on

          const target = new Date(goal.target_date);
          if (Number.isNaN(target.getTime())) return false; // unparseable date
          if (target.getTime() <= now.getTime()) return false; // must be a future target

          const created = new Date(goal.created_at);
          const start = Number.isNaN(created.getTime()) ? now : created;

          const totalMonths = this.monthsBetween(start, target);
          if (totalMonths <= 0) return false;

          // Elapsed is clamped to [0, totalMonths] so a not-yet-started goal
          // (created in the future / clock skew) is never flagged behind.
          const elapsedMonths = Math.min(
            Math.max(this.monthsBetween(start, now), 0),
            totalMonths
          );

          const expectedByNow = goal.target_amount_cents * (elapsedMonths / totalMonths);
          return goal.current_amount_cents < expectedByNow;
        });

        if (behindPaceGoals.length === 0) continue;

        const memberIds = await this.getActiveMemberUserIds(householdId);
        if (memberIds.length === 0) continue;

        const count = behindPaceGoals.length;
        const title = 'Falling behind on savings';
        const body =
          count === 1
            ? `Your "${behindPaceGoals[0].name}" goal is behind pace for its target date.`
            : `${count} of your savings goals are behind pace for their target dates.`;

        for (const userId of memberIds) {
          await this.notificationService.sendNotification({
            userId,
            type: 'savings_pace',
            title,
            body,
            // W-4: the FE `routeNotificationTap` keys off data.type, so set it
            // EXPLICITLY here — the mirrored budget worker sets data.screen but
            // NOT data.type for its own alert, so we cannot rely on inheritance.
            data: { type: 'savings_pace', householdId, period, screen: 'Savings' },
            referenceType: 'household',
            referenceId: householdId,
          });
        }
        notified++;
      } catch (error) {
        console.error('[savings-alert-worker] checkBehindPaceGoals failed for household', {
          householdId,
          error: (error as Error).message,
        });
      }
    }

    return { notified };
  }
}
