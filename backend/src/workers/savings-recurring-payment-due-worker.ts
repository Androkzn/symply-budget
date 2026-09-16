import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';

import { households } from '../db/schema';
import { savingsRecurringPayments } from '../db/schema-savings';
import { scheduleRecurringPaymentDueReminder } from '../services/budget/recurring-payment-due-reminder';
import type { Env } from '../types';

/**
 * Monthly "this payment is due soon" reminder generator — mirrors
 * `SavingsIncomeRolloverWorker`'s shape (direct drizzle queries against this
 * household's D1, own kill-switch check).
 *
 * For every ACTIVE, non-automated recurring payment with a known
 * `day_of_month`, schedules (idempotently, via `upsertRecurringReminder`) a
 * reminder whose first nudge fires 5 BUSINESS days before that payment's due
 * date THIS month, then re-nudges daily until the member marks it done — see
 * `services/budget/recurring-payment-due-reminder.ts`. A payment that's
 * inactive, has no `day_of_month`, or is on autopay is skipped outright — the
 * "Autopay" toggle clearing `day_of_month` server-side (`SavingsService`)
 * is what actually keeps this worker from ever scheduling one for it.
 */
export class SavingsRecurringPaymentDueWorker {
  private env: Env;
  private d1: D1Database;
  private db: DrizzleD1Database;

  constructor(env: Env, d1: D1Database) {
    this.env = env;
    this.d1 = d1;
    this.db = drizzle(d1);
  }

  private async getActiveHouseholdIds(): Promise<string[]> {
    const rows = await this.db
      .select({ id: households.id })
      .from(households)
      .where(isNull(households.deleted_at))
      .all();
    return rows.map((r) => r.id);
  }

  async scheduleDueRemindersForAllHouseholds(
    now: Date = new Date()
  ): Promise<{ households: number; scheduled: number }> {
    // IP4c kill-switch: absent key = enabled; only the literal 'false' disables.
    const flag = await this.env.CONFIG_KV.get('savings_enabled');
    if (flag === 'false') return { households: 0, scheduled: 0 };

    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;

    const householdIds = await this.getActiveHouseholdIds();
    let householdsWithReminders = 0;
    let totalScheduled = 0;

    for (const householdId of householdIds) {
      try {
        const payments = await this.db
          .select()
          .from(savingsRecurringPayments)
          .where(
            and(
              eq(savingsRecurringPayments.household_id, householdId),
              eq(savingsRecurringPayments.active, true),
              eq(savingsRecurringPayments.is_automated, false),
              isNotNull(savingsRecurringPayments.day_of_month)
            )
          )
          .all();

        if (payments.length === 0) continue;

        for (const payment of payments) {
          await scheduleRecurringPaymentDueReminder(this.env, this.d1, {
            householdId,
            recurringPaymentId: payment.id,
            label: payment.label,
            amountCents: payment.amount_cents,
            year,
            month,
            dayOfMonth: payment.day_of_month as number,
          });
          totalScheduled++;
        }
        householdsWithReminders++;
      } catch (error) {
        console.error('[savings-recurring-payment-due-worker] failed for household', {
          householdId,
          error: (error as Error).message,
        });
      }
    }

    return { households: householdsWithReminders, scheduled: totalScheduled };
  }
}
