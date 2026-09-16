/**
 * "This payment is due soon" reminder for non-automated recurring payments.
 * Covers the date math (business-day subtraction, month-length clamp) and the
 * hand-off to the recurring-reminders engine. Nudge cadence and auto-complete
 * via `isSatisfied` live in the registry/engine and are covered by
 * `services/recurring-reminders/__tests__/engine.test.ts`.
 */
import { env } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach } from 'vitest';

import { recurringReminders } from '../../../db/schema-recurring-reminders';
import type { Env } from '../../../types';
import { createCoreTables } from '../../aihousekeeper/__tests__/test-helpers';
import {
  createRecurringReminderTables,
  resetRecurringReminderTables,
} from '../../recurring-reminders/__tests__/test-helpers';
import {
  dueDateForMonth,
  scheduleRecurringPaymentDueReminder,
  subtractBusinessDays,
} from '../recurring-payment-due-reminder';

const testEnv = env as unknown as Env;
const HID = 'hh_payment_due_reminder';

describe('dueDateForMonth', () => {
  it('builds a YYYY-MM-DD from year/month/day', () => {
    expect(dueDateForMonth(2026, 8, 22)).toBe('2026-08-22');
  });

  it('clamps a day past the month length (Feb 31 -> Feb 28 in a non-leap year)', () => {
    expect(dueDateForMonth(2026, 2, 31)).toBe('2026-02-28');
  });

  it('clamps a day below 1 up to the 1st', () => {
    expect(dueDateForMonth(2026, 8, 0)).toBe('2026-08-01');
  });
});

describe('subtractBusinessDays', () => {
  it('subtracts 5 weekdays, skipping the weekend it crosses (Sat Aug 22 -> Mon Aug 17)', () => {
    expect(subtractBusinessDays('2026-08-22', 5).toISOString()).toBe('2026-08-17T13:00:00.000Z');
  });

  it('crosses a full weekend when the count requires it (Mon Aug 3 -> Mon Jul 27)', () => {
    expect(subtractBusinessDays('2026-08-03', 5).toISOString()).toBe('2026-07-27T13:00:00.000Z');
  });
});

async function reminderRows() {
  const db = drizzle(testEnv.DB);
  return db
    .select()
    .from(recurringReminders)
    .where(and(eq(recurringReminders.household_id, HID), eq(recurringReminders.reference_id, 'rp1')))
    .all();
}

describe('scheduleRecurringPaymentDueReminder', () => {
  beforeEach(async () => {
    await createCoreTables(testEnv.DB);
    await createRecurringReminderTables(testEnv.DB);
    await resetRecurringReminderTables(testEnv.DB);
    await testEnv.DB.prepare('DELETE FROM household_members').run();
  });

  it('creates one pending reminder due 5 business days before this month\'s due date', async () => {
    await scheduleRecurringPaymentDueReminder(testEnv, testEnv.DB, {
      householdId: HID,
      recurringPaymentId: 'rp1',
      label: 'IKEA 1',
      amountCents: 37_921,
      year: 2026,
      month: 8,
      dayOfMonth: 22,
    });

    const rows = await reminderRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'savings_recurring_payment_due_reminder',
      status: 'pending',
      period_key: '2026-08',
      next_nudge_at: '2026-08-17T13:00:00.000Z',
      frequency: 'tomorrow_morning',
    });
    expect(rows[0].title).toBe('IKEA 1 is due soon');
    expect(JSON.parse(rows[0].data!)).toMatchObject({
      type: 'savings_recurring_payment_due_reminder',
      recurringPaymentId: 'rp1',
      dueDate: '2026-08-22',
      screen: 'SavingsRecurringPayments',
    });
  });

  it('is idempotent for the same household+payment+period', async () => {
    const params = {
      householdId: HID,
      recurringPaymentId: 'rp1',
      label: 'IKEA 1',
      amountCents: 37_921,
      year: 2026,
      month: 8,
      dayOfMonth: 22,
    };
    await scheduleRecurringPaymentDueReminder(testEnv, testEnv.DB, params);
    await scheduleRecurringPaymentDueReminder(testEnv, testEnv.DB, params);

    expect(await reminderRows()).toHaveLength(1);
  });

  it('rolls forward: next month supersedes the prior pending period', async () => {
    await scheduleRecurringPaymentDueReminder(testEnv, testEnv.DB, {
      householdId: HID,
      recurringPaymentId: 'rp1',
      label: 'IKEA 1',
      amountCents: 37_921,
      year: 2026,
      month: 8,
      dayOfMonth: 22,
    });
    await scheduleRecurringPaymentDueReminder(testEnv, testEnv.DB, {
      householdId: HID,
      recurringPaymentId: 'rp1',
      label: 'IKEA 1',
      amountCents: 37_921,
      year: 2026,
      month: 9,
      dayOfMonth: 22,
    });

    const rows = await reminderRows();
    const pending = rows.filter((r) => r.status === 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0].period_key).toBe('2026-09');

    const superseded = rows.find((r) => r.period_key === '2026-08');
    expect(superseded?.status).toBe('done');
    expect(superseded?.completed_reason).toBe('superseded');
  });
});
