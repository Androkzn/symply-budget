import type { Env } from '../../types';
import { upsertRecurringReminder } from '../recurring-reminders/engine';
import { RECURRING_PAYMENT_DUE_REMINDER_TYPE } from '../recurring-reminders/registry';

/**
 * "This payment is due soon" nudge for a NON-automated recurring payment (a
 * bill with a known `day_of_month` the household still pays manually — see
 * `SavingsRecurringPaymentsScreen`'s "Autopay" toggle, which clears
 * `day_of_month` and makes this whole reminder moot for a payment once it's
 * on). `SavingsRecurringPaymentDueWorker` calls this once a month per payment;
 * it hands a pending {@link upsertRecurringReminder} row to the shared
 * recurring-reminders engine with `dueAt` set 5 BUSINESS days before the due
 * date — so the first nudge doesn't fire until that window opens, then it
 * re-nudges every morning (see the registry's `tomorrow_morning` default)
 * until the member taps "Mark done" (there's no reliable auto-detect for
 * "already paid" — see `recurringPaymentDueSatisfied`) or the payment stops
 * needing one at all (deleted/deactivated/switched to autopay).
 */
export { RECURRING_PAYMENT_DUE_REMINDER_TYPE };

// Morning, Americas-friendly — same convention as the other reminder schedulers.
const REMINDER_UTC_HOUR = 13;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** `(year, month)` 1-based + a day-of-month, clamped to that month's real length, as 'YYYY-MM-DD'. */
export function dueDateForMonth(year: number, month: number, dayOfMonth: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(Math.max(1, dayOfMonth), lastDay);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * `dateStr` minus `days` BUSINESS days (Mon-Fri only, weekends never count).
 * Returns a UTC midnight `Date` at {@link REMINDER_UTC_HOUR}.
 */
export function subtractBusinessDays(dateStr: string, days: number, hour = REMINDER_UTC_HOUR): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const year = match ? Number(match[1]) : NaN;
  const month0 = match ? Number(match[2]) - 1 : NaN;
  const day = match ? Number(match[3]) : NaN;
  const cursor = new Date(Date.UTC(year, month0, day));

  let remaining = days;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const dow = cursor.getUTCDay(); // 0 = Sun, 6 = Sat
    if (dow !== 0 && dow !== 6) remaining--;
  }
  cursor.setUTCHours(hour, 0, 0, 0);
  return cursor;
}

/**
 * Schedule (or no-op if already scheduled) this month's "due soon" reminder
 * for one recurring payment. Best-effort: never throws — a failed reminder
 * must not fail whatever write (the monthly worker's sweep) triggered it.
 */
export async function scheduleRecurringPaymentDueReminder(
  env: Env,
  d1: D1Database,
  params: {
    householdId: string;
    recurringPaymentId: string;
    label: string;
    amountCents: number;
    year: number;
    month: number;
    dayOfMonth: number;
  }
): Promise<void> {
  const { householdId, recurringPaymentId, label, amountCents, year, month, dayOfMonth } = params;
  try {
    const dueDate = dueDateForMonth(year, month, dayOfMonth);
    const nudgeStartsAt = subtractBusinessDays(dueDate, 5);
    const periodKey = `${year}-${pad2(month)}`;

    await upsertRecurringReminder(env, d1, {
      householdId,
      type: RECURRING_PAYMENT_DUE_REMINDER_TYPE,
      referenceId: recurringPaymentId,
      periodKey,
      title: `${label} is due soon`,
      body: `$${(amountCents / 100).toFixed(2)} is due ${dueDate} — mark it done once it's paid.`,
      data: {
        // FE routes on data.type — set it EXPLICITLY (not inherited).
        type: RECURRING_PAYMENT_DUE_REMINDER_TYPE,
        householdId,
        recurringPaymentId,
        screen: 'SavingsRecurringPayments',
        dueDate,
      },
      dueAt: nudgeStartsAt,
    });
  } catch (error) {
    console.error('[recurring-payment-due-reminder] failed to schedule', {
      recurringPaymentId,
      error: (error as Error).message,
    });
  }
}
