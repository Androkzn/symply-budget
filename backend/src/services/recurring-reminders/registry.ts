import { and, eq, gt, gte, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { budgetRenewals } from '../../db/schema-budget-renewals';
import { mortgageStatements } from '../../db/schema-mortgage';
import type { RecurringReminder } from '../../db/schema-recurring-reminders';
import { savingsIncomeEntries, savingsRecurringPayments } from '../../db/schema-savings';
import type { Env } from '../../types';

import { DEFAULT_FREQUENCY, type FrequencyId } from './frequency';

/**
 * Per-`type` behaviour for the recurring-reminder engine (`./engine.ts`) — the
 * `ChatConfig`/`CHAT_CONFIGS` pattern (`src/features/chat/`) applied to
 * reminders: one shared engine, a small registry of what differs per type.
 * Adding a new app's recurring reminder = add one entry here; nothing in the
 * engine, routes, or mobile screen changes.
 */
export interface RecurringReminderTypeDef {
  type: string;
  /** e.g. 'mortgage' — stored on the row for display/debugging. */
  referenceType: string;
  defaultFrequency: FrequencyId;
  /**
   * Has the underlying obligation already been satisfied outside the app (the
   * member did the thing without ever tapping the nudge)? Checked right before
   * sending each nudge — a true result auto-completes the row instead of
   * sending a now-redundant push. Optional: a type with no reliable signal
   * relies solely on the user tapping "Mark done".
   */
  isSatisfied?: (env: Env, d1: D1Database, row: RecurringReminder) => Promise<boolean>;
}

/** `data.type` the app already routes on for this reminder — see `src/services/notificationRouting.ts`. */
export const MORTGAGE_STATEMENT_REMINDER_TYPE = 'mortgage_statement_reminder';

async function mortgageStatementSatisfied(
  _env: Env,
  d1: D1Database,
  row: RecurringReminder
): Promise<boolean> {
  let afterStatementDate: string | undefined;
  try {
    const parsed = row.data ? (JSON.parse(row.data) as Record<string, unknown>) : {};
    afterStatementDate = typeof parsed.afterStatementDate === 'string' ? parsed.afterStatementDate : undefined;
  } catch {
    afterStatementDate = undefined;
  }
  if (!afterStatementDate) return false;

  const db = drizzle(d1);
  const newerStatement = await db
    .select({ id: mortgageStatements.id })
    .from(mortgageStatements)
    .where(
      and(
        eq(mortgageStatements.mortgage_id, row.reference_id),
        gt(mortgageStatements.statement_date, afterStatementDate)
      )
    )
    .limit(1)
    .get();
  return Boolean(newerStatement);
}

/** `data.type` the app already routes on for this reminder — see `src/services/notificationRouting.ts`. */
export const BUDGET_RENEWAL_REMINDER_TYPE = 'budget_renewal_reminder';

/**
 * Satisfied once the renewal this row is chasing is no longer "upcoming" for
 * the period it was scheduled against — either the member marked it renewed
 * (which also rolls `next_renewal_date` forward past `beforeRenewalDate`), or
 * they cancelled/let it lapse. Mirrors `mortgageStatementSatisfied`'s
 * "read the current state back and compare" shape.
 */
async function budgetRenewalSatisfied(
  _env: Env,
  d1: D1Database,
  row: RecurringReminder
): Promise<boolean> {
  let renewalId: string | undefined;
  let beforeRenewalDate: string | undefined;
  try {
    const parsed = row.data ? (JSON.parse(row.data) as Record<string, unknown>) : {};
    renewalId = typeof parsed.renewalId === 'string' ? parsed.renewalId : undefined;
    beforeRenewalDate =
      typeof parsed.beforeRenewalDate === 'string' ? parsed.beforeRenewalDate : undefined;
  } catch {
    renewalId = undefined;
  }
  if (!renewalId) return false;

  const db = drizzle(d1);
  const renewal = await db
    .select({ status: budgetRenewals.status, next_renewal_date: budgetRenewals.next_renewal_date })
    .from(budgetRenewals)
    .where(eq(budgetRenewals.id, renewalId))
    .get();
  if (!renewal) return true; // deleted — nothing left to chase

  if (renewal.status !== 'upcoming') return true;
  if (beforeRenewalDate && renewal.next_renewal_date > beforeRenewalDate) return true;
  return false;
}

/** `data.type` the app already routes on for this reminder — see `src/services/notificationRouting.ts`. */
export const INCOME_ROLLOVER_REMINDER_TYPE = 'savings_income_rollover_reminder';

/**
 * Satisfied once no rollover-generated draft income rows remain for the
 * period this row is chasing — confirming, editing+saving (which implicitly
 * confirms, see `SavingsService.updateIncome`), or deleting a draft all count
 * as resolved. Mirrors the "read current state back" shape of the other two
 * `isSatisfied` checks above.
 */
async function incomeRolloverSatisfied(
  _env: Env,
  d1: D1Database,
  row: RecurringReminder
): Promise<boolean> {
  let periodStart: string | undefined;
  let periodEnd: string | undefined;
  try {
    const parsed = row.data ? (JSON.parse(row.data) as Record<string, unknown>) : {};
    periodStart = typeof parsed.periodStart === 'string' ? parsed.periodStart : undefined;
    periodEnd = typeof parsed.periodEnd === 'string' ? parsed.periodEnd : undefined;
  } catch {
    periodStart = undefined;
  }
  if (!periodStart || !periodEnd) return false;

  const db = drizzle(d1);
  const stillDraft = await db
    .select({ id: savingsIncomeEntries.id })
    .from(savingsIncomeEntries)
    .where(
      and(
        eq(savingsIncomeEntries.household_id, row.household_id),
        eq(savingsIncomeEntries.status, 'draft'),
        eq(savingsIncomeEntries.source, 'rollover'),
        gte(savingsIncomeEntries.income_date, periodStart),
        lt(savingsIncomeEntries.income_date, periodEnd)
      )
    )
    .limit(1)
    .get();
  return !stillDraft;
}

/** `data.type` the app already routes on for this reminder — see `src/services/notificationRouting.ts`. */
export const RECURRING_PAYMENT_DUE_REMINDER_TYPE = 'savings_recurring_payment_due_reminder';

/**
 * Satisfied once the payment this row is chasing no longer NEEDS a manual
 * due-day nudge at all — deleted, deactivated, or switched to autopay since
 * the reminder was scheduled. Deliberately does NOT try to detect "already
 * paid": there's no reliable signal for that (applying a recurring payment to
 * a month means "budgeted", not "paid"), so a genuine payment stays pending
 * until the member taps "Mark done" themselves — see `../engine.ts`'s manual
 * `completeRecurringReminder`.
 */
async function recurringPaymentDueSatisfied(
  _env: Env,
  d1: D1Database,
  row: RecurringReminder
): Promise<boolean> {
  const db = drizzle(d1);
  const payment = await db
    .select({ active: savingsRecurringPayments.active, is_automated: savingsRecurringPayments.is_automated })
    .from(savingsRecurringPayments)
    .where(eq(savingsRecurringPayments.id, row.reference_id))
    .get();
  if (!payment) return true; // deleted — nothing left to chase
  return !payment.active || payment.is_automated;
}

export const RECURRING_REMINDER_TYPES: Record<string, RecurringReminderTypeDef> = {
  [MORTGAGE_STATEMENT_REMINDER_TYPE]: {
    type: MORTGAGE_STATEMENT_REMINDER_TYPE,
    referenceType: 'mortgage',
    defaultFrequency: DEFAULT_FREQUENCY,
    isSatisfied: mortgageStatementSatisfied,
  },
  [BUDGET_RENEWAL_REMINDER_TYPE]: {
    type: BUDGET_RENEWAL_REMINDER_TYPE,
    referenceType: 'budget_renewal',
    defaultFrequency: DEFAULT_FREQUENCY,
    isSatisfied: budgetRenewalSatisfied,
  },
  [INCOME_ROLLOVER_REMINDER_TYPE]: {
    type: INCOME_ROLLOVER_REMINDER_TYPE,
    referenceType: 'savings_income_rollover',
    defaultFrequency: DEFAULT_FREQUENCY,
    isSatisfied: incomeRolloverSatisfied,
  },
  [RECURRING_PAYMENT_DUE_REMINDER_TYPE]: {
    type: RECURRING_PAYMENT_DUE_REMINDER_TYPE,
    referenceType: 'savings_recurring_payment',
    // "Every day until you mark it paid" — `tomorrow_morning` always defers
    // to +1 day at a fixed morning hour, giving a genuine daily cadence.
    defaultFrequency: 'tomorrow_morning',
    isSatisfied: recurringPaymentDueSatisfied,
  },
};

export function getRecurringReminderTypeDef(type: string): RecurringReminderTypeDef | undefined {
  return RECURRING_REMINDER_TYPES[type];
}
