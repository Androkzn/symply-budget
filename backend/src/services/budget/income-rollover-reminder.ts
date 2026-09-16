import type { Env } from '../../types';
import { upsertRecurringReminder } from '../recurring-reminders/engine';
import { INCOME_ROLLOVER_REMINDER_TYPE } from '../recurring-reminders/registry';
import { monthWindow, pad2 } from '../savings-service';

/**
 * "Confirm this month's rolled-over income" nudge. When
 * `SavingsIncomeRolloverWorker` drafts next month's regular income from last
 * month's confirmed entries, it hands a pending {@link upsertRecurringReminder}
 * row to the shared recurring-reminders engine (`../recurring-reminders/`) —
 * one row per household per period covering *every* draft from that rollover
 * collectively (not one per entry, to avoid notification spam), which then
 * keeps re-nudging on the default cadence until either the member confirms/
 * edits/deletes every draft (auto-detected by `incomeRolloverSatisfied` in
 * `../recurring-reminders/registry.ts`) or taps "Mark done" on the reminder
 * itself.
 *
 * Delivery of each nudge still flows through the every-5-min
 * `processScheduledNotifications` sweep via the engine's own cron pass —
 * because this only runs on the Budget Worker (the savings routes are
 * `requireBudgetApi`-gated) it writes to and delivers from the Budget D1 alone.
 */
export { INCOME_ROLLOVER_REMINDER_TYPE };

// Fire mid-morning in the Americas rather than at UTC midnight — same
// convention as the mortgage statement reminder.
const REMINDER_UTC_HOUR = 15;

/**
 * Schedule (or no-op if already scheduled) the "confirm this month's income"
 * reminder for one household + period. Best-effort: never throws — a failed
 * reminder must not fail the rollover generation that triggered it.
 */
export async function scheduleIncomeRolloverReminder(
  env: Env,
  d1: D1Database,
  params: { householdId: string; year: number; month: number; draftCount: number }
): Promise<void> {
  const { householdId, year, month, draftCount } = params;
  if (draftCount <= 0) return;

  try {
    const { monthStart, monthEnd } = monthWindow(year, month);
    const periodKey = `${year}-${pad2(month)}`;

    const nowUtc = new Date();
    let dueAt = new Date(Date.UTC(year, month - 1, nowUtc.getUTCDate(), REMINDER_UTC_HOUR, 0, 0));
    if (dueAt.getTime() <= Date.now()) dueAt = new Date(Date.now() + 60_000); // fire almost immediately if we're past today's hour

    await upsertRecurringReminder(env, d1, {
      householdId,
      type: INCOME_ROLLOVER_REMINDER_TYPE,
      // Constant — one nag per household+period covering all that period's
      // drafts collectively, not one per entry.
      referenceId: 'monthly-income-rollover',
      periodKey,
      title: 'Confirm this month’s income',
      body:
        draftCount === 1
          ? "We've carried over 1 income entry from last month — please confirm it's still correct."
          : `We've carried over ${draftCount} income entries from last month — please confirm they're still correct.`,
      data: {
        // FE routes on data.type — set it EXPLICITLY (not inherited).
        type: INCOME_ROLLOVER_REMINDER_TYPE,
        householdId,
        screen: 'BudgetMain',
        // Read back by registry.ts's isSatisfied check.
        periodStart: monthStart,
        periodEnd: monthEnd,
      },
      dueAt,
    });
  } catch (error) {
    console.error('[income-rollover-reminder] failed to schedule', {
      householdId,
      error: (error as Error).message,
    });
  }
}
