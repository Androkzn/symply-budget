import type { Env } from '../../types';
import { cancelRecurringRemindersForReference, upsertRecurringReminder } from '../recurring-reminders/engine';
import { BUDGET_RENEWAL_REMINDER_TYPE } from '../recurring-reminders/registry';

export { BUDGET_RENEWAL_REMINDER_TYPE };

/**
 * Renewal reminders for Monthly Payments (Savings → Monthly). When a member
 * sets or updates a renewal's `next_renewal_date` / `reminder_lead_days`, this
 * hands a pending row to the shared recurring-reminders engine
 * (`../recurring-reminders/`) so the household gets nudged starting
 * `reminder_lead_days` before the renewal date, then keeps getting re-nudged
 * (default cadence: every 3 days) until either they mark it renewed or the
 * engine auto-detects the renewal moved past this period
 * (`registry.ts`'s `budgetRenewalSatisfied`).
 *
 * Unlike `mortgage/statement-reminder.ts`'s statement nudge — which silently
 * skips a lead date that's already in the past, because missing one month's
 * statement upload is low-stakes — a renewal is asked to "keep pushing the
 * user to finish it before the due date", so a short/overdue lead window
 * still fires the first nudge right away rather than going silent.
 */
const REMINDER_UTC_HOUR = 15;

function parseDateUtc(dateStr: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return null;
  const year = Number(match[1]);
  const month1 = Number(match[2]);
  const day = Number(match[3]);
  if (month1 < 1 || month1 > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month1 - 1, day, REMINDER_UTC_HOUR, 0, 0));
}

/** When the first nudge for this renewal cycle should fire — never in the past. */
export function computeRenewalReminderDate(
  nextRenewalDate: string,
  leadDays: number,
  now: Date = new Date()
): Date | null {
  const renewal = parseDateUtc(nextRenewalDate);
  if (!renewal) return null;
  const leadStart = new Date(renewal.getTime() - leadDays * 24 * 60 * 60 * 1000);
  return leadStart.getTime() > now.getTime() ? leadStart : now;
}

/**
 * Schedule (or roll forward) the renewal nag for one `budget_renewals` row.
 * Best-effort: never throws — a failed reminder must not fail the write that
 * triggered it.
 */
export async function scheduleBudgetRenewalReminder(
  env: Env,
  d1: D1Database,
  params: {
    householdId: string;
    renewalId: string;
    recurringPaymentId: string;
    recurringPaymentLabel: string;
    nextRenewalDate: string;
    leadDays: number;
  }
): Promise<void> {
  const { householdId, renewalId, recurringPaymentId, recurringPaymentLabel, nextRenewalDate, leadDays } = params;
  try {
    const dueAt = computeRenewalReminderDate(nextRenewalDate, leadDays);
    if (!dueAt) return; // malformed date — nothing to schedule

    await upsertRecurringReminder(env, d1, {
      householdId,
      type: BUDGET_RENEWAL_REMINDER_TYPE,
      referenceId: renewalId,
      periodKey: nextRenewalDate,
      title: 'Renewal coming up',
      body: `"${recurringPaymentLabel}" renews on ${nextRenewalDate} — tap to update or mark it renewed.`,
      data: {
        // FE routes on data.type — set it EXPLICITLY (not inherited).
        type: BUDGET_RENEWAL_REMINDER_TYPE,
        householdId,
        recurringPaymentId,
        renewalId,
        screen: 'SavingsRecurringPayments',
        // Read back by `registry.ts`'s `isSatisfied` check.
        beforeRenewalDate: nextRenewalDate,
      },
      dueAt,
    });
  } catch (error) {
    console.error('[budget-renewal-reminder] failed to schedule', {
      renewalId,
      error: (error as Error).message,
    });
  }
}

/** Stop nagging for a renewal entirely (it was deleted/untracked). */
export async function cancelBudgetRenewalReminder(d1: D1Database, renewalId: string): Promise<void> {
  await cancelRecurringRemindersForReference(d1, BUDGET_RENEWAL_REMINDER_TYPE, renewalId);
}
