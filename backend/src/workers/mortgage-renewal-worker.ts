import { and, eq, isNull } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';

import { householdMembers } from '../db/schema';
import { mortgages, mortgageTerms } from '../db/schema-mortgage';
import { NotificationService } from '../services/notification-service';
import type { Env } from '../types';

/**
 * Mortgage renewal reminder worker (implementation plan §8). Fires a
 * `mortgage_renewal` push `reminder_months_before` the current term's maturity
 * date so the household can shop offers before auto-renewing. Wired into the
 * existing `scheduled()` handler (NO new cron trigger — the account is at its
 * 5-cron limit) and gated by `isBudgetApiEnabled` + the `mortgage_enabled` KV
 * switch. Safe to ship dormant.
 *
 * Idempotency: `last_renewal_reminder_sent_at` — one send per window. A renewal
 * (new term, new maturity) opens a fresh window, so the reminder fires again.
 */
export class MortgageRenewalWorker {
  private env: Env;
  private db: DrizzleD1Database;
  private notificationService: NotificationService;

  constructor(env: Env, d1: D1Database) {
    this.env = env;
    this.db = drizzle(d1);
    this.notificationService = new NotificationService(env, d1);
  }

  /** Window start = maturity minus `monthsBefore` months. */
  static windowStart(maturityDate: string, monthsBefore: number): Date {
    const maturity = new Date(maturityDate);
    const start = new Date(maturity);
    start.setUTCMonth(start.getUTCMonth() - monthsBefore);
    return start;
  }

  /** True when `now` is within [maturity − monthsBefore, maturity]. */
  static isInRenewalWindow(maturityDate: string, monthsBefore: number, now: Date): boolean {
    const maturity = new Date(maturityDate);
    if (Number.isNaN(maturity.getTime())) return false;
    const start = MortgageRenewalWorker.windowStart(maturityDate, monthsBefore);
    return now.getTime() >= start.getTime() && now.getTime() <= maturity.getTime();
  }

  /** Send iff in-window AND not already sent for THIS window (idempotency). */
  static shouldSend(
    lastSentAt: string | null,
    maturityDate: string,
    monthsBefore: number,
    now: Date
  ): boolean {
    if (!MortgageRenewalWorker.isInRenewalWindow(maturityDate, monthsBefore, now)) return false;
    if (!lastSentAt) return true;
    const last = new Date(lastSentAt);
    if (Number.isNaN(last.getTime())) return true;
    // Resend only if the last send predates this window (e.g. after a renewal).
    return last.getTime() < MortgageRenewalWorker.windowStart(maturityDate, monthsBefore).getTime();
  }

  private async getActiveMemberUserIds(householdId: string): Promise<string[]> {
    const rows = await this.db
      .select({ user_id: householdMembers.user_id })
      .from(householdMembers)
      .where(and(eq(householdMembers.household_id, householdId), isNull(householdMembers.deleted_at)))
      .all();
    return rows.map((r) => r.user_id);
  }

  async checkMaturingMortgages(now: Date = new Date()): Promise<{ notified: number }> {
    // Mortgage kill-switch: absent key = enabled; only literal 'false' disables.
    const flag = await this.env.CONFIG_KV.get('mortgage_enabled');
    if (flag === 'false') return { notified: 0 };

    const rows = await this.db
      .select()
      .from(mortgages)
      .where(and(eq(mortgages.is_active, true), eq(mortgages.reminder_enabled, true)))
      .all();

    let notified = 0;
    for (const m of rows) {
      try {
        const term = await this.db
          .select()
          .from(mortgageTerms)
          .where(and(eq(mortgageTerms.mortgage_id, m.id), eq(mortgageTerms.is_current, true)))
          .get();
        if (!term) continue;

        if (
          !MortgageRenewalWorker.shouldSend(
            m.last_renewal_reminder_sent_at,
            term.maturity_date,
            m.reminder_months_before,
            now
          )
        ) {
          continue;
        }

        const memberIds = await this.getActiveMemberUserIds(m.household_id);
        if (memberIds.length === 0) continue;

        const lender = m.lender ? `${m.lender} ` : '';
        for (const userId of memberIds) {
          await this.notificationService.sendNotification({
            userId,
            type: 'mortgage_renewal',
            title: 'Mortgage renewal coming up',
            body: `Your ${lender}mortgage matures on ${term.maturity_date}. Time to compare renewal offers.`,
            // FE routes on data.type — set it EXPLICITLY (not inherited).
            data: { type: 'mortgage_renewal', householdId: m.household_id, mortgageId: m.id, screen: 'MortgageMain' },
            referenceType: 'mortgage',
            referenceId: m.id,
          });
        }

        await this.db
          .update(mortgages)
          .set({ last_renewal_reminder_sent_at: now.toISOString() })
          .where(eq(mortgages.id, m.id));
        notified++;
      } catch (error) {
        console.error('[mortgage-renewal-worker] failed for mortgage', {
          mortgageId: m.id,
          error: (error as Error).message,
        });
      }
    }

    return { notified };
  }
}
