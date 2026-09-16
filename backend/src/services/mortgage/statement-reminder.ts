import type { Env } from '../../types';
import { upsertRecurringReminder } from '../recurring-reminders/engine';
import { MORTGAGE_STATEMENT_REMINDER_TYPE } from '../recurring-reminders/registry';

/**
 * "Upload this month's mortgage statement" nudge. When a statement is committed
 * we hand a pending {@link upsertRecurringReminder} row to the shared
 * recurring-reminders engine (`../recurring-reminders/`), keyed off the
 * statement date — so the member gets pinged roughly a month later, and then
 * keeps getting re-nudged on their chosen cadence (default: every 3 days) until
 * either they tap "Mark done" or the engine auto-detects a newer statement was
 * committed. Committing the next statement rolls the reminder forward (any
 * still-pending prior period is superseded), so anyone who keeps uploading is
 * never nagged.
 *
 * Delivery of each nudge still flows through the every-5-min
 * `processScheduledNotifications` sweep via the engine's own cron pass, which
 * is brand-independent — because this only runs on the Budget Worker (the
 * mortgage routes are `requireBudgetApi`-gated) it writes to and delivers from
 * the Budget D1 alone.
 */
export { MORTGAGE_STATEMENT_REMINDER_TYPE };
// Fire mid-morning in the Americas rather than at UTC midnight, so a date-only
// statement doesn't produce an overnight ping.
const REMINDER_UTC_HOUR = 15;

/**
 * The statement month + 1, at {@link REMINDER_UTC_HOUR} UTC, clamping the day to
 * the target month's last day so an end-of-month statement doesn't skip a month
 * (Jan 31 → Feb 28, not Mar 3). Returns `null` for a malformed date.
 */
export function computeStatementReminderDate(
  statementDate: string,
  hour = REMINDER_UTC_HOUR
): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(statementDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month1 = Number(match[2]); // 1-12
  const day = Number(match[3]);
  if (month1 < 1 || month1 > 12 || day < 1 || day > 31) return null;
  // 0-indexed month `month1` is the month AFTER the statement's month; Date.UTC
  // normalises the December → January year rollover for us.
  const lastDayOfTarget = new Date(Date.UTC(year, month1 + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDayOfTarget);
  return new Date(Date.UTC(year, month1, targetDay, hour, 0, 0));
}

/**
 * Schedule (or roll forward) the monthly "upload your statement" reminder for a
 * mortgage. Best-effort: never throws — a failed reminder must not fail the
 * statement commit that triggered it.
 */
export async function scheduleMortgageStatementReminder(
  env: Env,
  d1: D1Database,
  params: { householdId: string; mortgageId: string; statementDate: string }
): Promise<void> {
  const { householdId, mortgageId, statementDate } = params;
  try {
    const reminderDate = computeStatementReminderDate(statementDate);
    if (!reminderDate || reminderDate.getTime() <= Date.now()) return; // in the past → nothing to nudge

    const periodKey = `${reminderDate.getUTCFullYear()}-${String(reminderDate.getUTCMonth() + 1).padStart(2, '0')}`;

    await upsertRecurringReminder(env, d1, {
      householdId,
      type: MORTGAGE_STATEMENT_REMINDER_TYPE,
      referenceId: mortgageId,
      periodKey,
      title: 'Mortgage statement time',
      body: "Don't forget to upload this month's mortgage statement.",
      data: {
        // FE routes on data.type — set it EXPLICITLY (not inherited).
        type: MORTGAGE_STATEMENT_REMINDER_TYPE,
        householdId,
        mortgageId,
        screen: 'MortgageMain',
        // Read back by `registry.ts`'s `isSatisfied` check — any statement dated
        // after this one means the obligation this reminder is chasing is met.
        afterStatementDate: statementDate,
      },
      dueAt: reminderDate,
    });
  } catch (error) {
    console.error('[mortgage-statement-reminder] failed to schedule', {
      mortgageId,
      error: (error as Error).message,
    });
  }
}
