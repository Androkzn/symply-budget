/**
 * Renewal reminders for Monthly Payments — the nudge scheduled when a member
 * sets/updates a tracked renewal's next date. Covers the date math (lead-days
 * offset, never-in-the-past first nudge — unlike the mortgage statement nudge,
 * which silently skips a past lead date) and the hand-off to the
 * recurring-reminders engine (one pending row per household+period,
 * roll-forward via supersede, cancel-on-delete). Nudge cadence and auto-complete
 * via `isSatisfied` live in the engine/registry and are covered by
 * `services/recurring-reminders/__tests__/engine.test.ts`.
 */
import { env } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { recurringReminders } from '../../../db/schema-recurring-reminders';
import type { Env } from '../../../types';
import { createCoreTables } from '../../aihousekeeper/__tests__/test-helpers';
import {
  createRecurringReminderTables,
  resetRecurringReminderTables,
} from '../../recurring-reminders/__tests__/test-helpers';
import {
  cancelBudgetRenewalReminder,
  computeRenewalReminderDate,
  scheduleBudgetRenewalReminder,
} from '../renewal-reminder';

const testEnv = env as unknown as Env;
const HID = 'hh_renewal_reminder';
const PID = 'p_renewal_reminder';

describe('computeRenewalReminderDate', () => {
  it('starts the lead-days window before the renewal date, at 15:00 UTC', () => {
    expect(computeRenewalReminderDate('2999-09-15', 14, new Date('2999-01-01T00:00:00Z'))?.toISOString()).toBe(
      '2999-09-01T15:00:00.000Z'
    );
  });

  it('fires NOW when the lead window has already started, rather than skipping silently', () => {
    const now = new Date('2999-09-10T12:00:00Z');
    expect(computeRenewalReminderDate('2999-09-15', 14, now)).toEqual(now);
  });

  it('returns null for a malformed date', () => {
    expect(computeRenewalReminderDate('not-a-date', 14)).toBeNull();
  });
});

async function reminderRows() {
  const db = drizzle(testEnv.DB);
  return db
    .select()
    .from(recurringReminders)
    .where(and(eq(recurringReminders.household_id, HID), eq(recurringReminders.reference_id, 'r1')))
    .all();
}

describe('scheduleBudgetRenewalReminder', () => {
  beforeEach(async () => {
    await createCoreTables(testEnv.DB);
    await createRecurringReminderTables(testEnv.DB);
    await resetRecurringReminderTables(testEnv.DB);
    await testEnv.DB.prepare('DELETE FROM household_members').run();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2999-01-01T00:00:00Z'));
  });

  it('creates one pending reminder with the lead-days-computed date + type', async () => {
    await scheduleBudgetRenewalReminder(testEnv, testEnv.DB, {
      householdId: HID,
      renewalId: 'r1',
      recurringPaymentId: PID,
      recurringPaymentLabel: 'Condo insurance',
      nextRenewalDate: '2999-09-15',
      leadDays: 14,
    });

    const rows = await reminderRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'budget_renewal_reminder',
      status: 'pending',
      period_key: '2999-09-15',
      next_nudge_at: '2999-09-01T15:00:00.000Z',
    });
    expect(JSON.parse(rows[0].data!)).toMatchObject({
      renewalId: 'r1',
      recurringPaymentId: PID,
      beforeRenewalDate: '2999-09-15',
      screen: 'SavingsRecurringPayments',
    });
  });

  it('rolls forward: marking renewed to a later date supersedes the prior pending period', async () => {
    await scheduleBudgetRenewalReminder(testEnv, testEnv.DB, {
      householdId: HID,
      renewalId: 'r1',
      recurringPaymentId: PID,
      recurringPaymentLabel: 'Condo insurance',
      nextRenewalDate: '2999-09-15',
      leadDays: 14,
    });
    await scheduleBudgetRenewalReminder(testEnv, testEnv.DB, {
      householdId: HID,
      renewalId: 'r1',
      recurringPaymentId: PID,
      recurringPaymentLabel: 'Condo insurance',
      nextRenewalDate: '3000-09-15',
      leadDays: 14,
    });

    const rows = await reminderRows();
    const pending = rows.filter((r) => r.status === 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0].period_key).toBe('3000-09-15');

    const superseded = rows.find((r) => r.period_key === '2999-09-15');
    expect(superseded?.status).toBe('done');
    expect(superseded?.completed_reason).toBe('superseded');
  });

  it('a short lead window on a near-term renewal still nudges now instead of going silent', async () => {
    await scheduleBudgetRenewalReminder(testEnv, testEnv.DB, {
      householdId: HID,
      renewalId: 'r1',
      recurringPaymentId: PID,
      recurringPaymentLabel: 'Condo insurance',
      nextRenewalDate: '2999-01-03', // 2 days out
      leadDays: 14, // lead window already started
    });

    const rows = await reminderRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].next_nudge_at).toBe('2999-01-01T00:00:00.000Z'); // now, not skipped
  });
});

describe('cancelBudgetRenewalReminder', () => {
  beforeEach(async () => {
    await createCoreTables(testEnv.DB);
    await createRecurringReminderTables(testEnv.DB);
    await resetRecurringReminderTables(testEnv.DB);
    await testEnv.DB.prepare('DELETE FROM household_members').run();
    vi.useRealTimers();
  });

  it('marks the pending reminder done/cancelled so the nag stops', async () => {
    await scheduleBudgetRenewalReminder(testEnv, testEnv.DB, {
      householdId: HID,
      renewalId: 'r1',
      recurringPaymentId: PID,
      recurringPaymentLabel: 'Condo insurance',
      nextRenewalDate: '2999-09-15',
      leadDays: 14,
    });

    await cancelBudgetRenewalReminder(testEnv.DB, 'r1');

    const rows = await reminderRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('done');
    expect(rows[0].completed_reason).toBe('cancelled');
  });
});
