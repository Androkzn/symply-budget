/**
 * SavingsRecurringPaymentDueWorker — monthly pass that schedules a "due soon"
 * reminder for every active, non-automated recurring payment with a known
 * day_of_month. Exercised against real D1 (savings_recurring_payments +
 * recurring_reminders) so the filtering/idempotency logic is verified before
 * cron picks it up (see cron/scheduled.ts).
 */
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../db/schema';
import { recurringReminders } from '../../db/schema-recurring-reminders';
import { savingsRecurringPayments } from '../../db/schema-savings';
import { createSavingsTables, resetSavingsTables } from '../../routes/__tests__/savings-test-helpers';
import { createCoreTables, resetAllTables } from '../../services/aihousekeeper/__tests__/test-helpers';
import {
  createRecurringReminderTables,
  resetRecurringReminderTables,
} from '../../services/recurring-reminders/__tests__/test-helpers';
import type { Env } from '../../types';
import { SavingsRecurringPaymentDueWorker } from '../savings-recurring-payment-due-worker';

const testEnv = env as unknown as Env;
const HID = 'hh_payment_due_worker_01';
const UID = 'u_payment_due_worker_owner';
const MID = 'm_payment_due_worker_owner';

const NOW = new Date('2026-08-02T08:00:00Z');

async function seed(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createSavingsTables(testEnv.DB);
  await createRecurringReminderTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetSavingsTables(testEnv.DB);
  await resetRecurringReminderTables(testEnv.DB);
  await testEnv.CONFIG_KV.delete('savings_enabled');

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values({ id: UID, email: 'due-worker@example.com', email_verified: true });
  await db.insert(schema.households).values({ id: HID, name: 'DueWorkerTest' });
  await db.insert(schema.householdMembers).values({
    id: MID,
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: '2025-01-01T00:00:00Z',
  });
}

async function insertPayment(
  overrides: Partial<typeof savingsRecurringPayments.$inferInsert> & { id: string }
): Promise<string> {
  const db = drizzle(testEnv.DB);
  await db.insert(savingsRecurringPayments).values({
    household_id: HID,
    label: 'IKEA 1',
    amount_cents: 37_921,
    day_of_month: 22,
    active: true,
    is_automated: false,
    source: 'manual',
    ...overrides,
  });
  return overrides.id;
}

function mkWorker(): SavingsRecurringPaymentDueWorker {
  return new SavingsRecurringPaymentDueWorker(testEnv, testEnv.DB);
}

beforeEach(async () => {
  await seed();
});

describe('SavingsRecurringPaymentDueWorker.scheduleDueRemindersForAllHouseholds', () => {
  it('schedules a pending reminder for an active, non-automated payment with a due day', async () => {
    await insertPayment({ id: 'rp_ikea' });

    const result = await mkWorker().scheduleDueRemindersForAllHouseholds(NOW);
    expect(result.scheduled).toBe(1);
    expect(result.households).toBe(1);

    const db = drizzle(testEnv.DB);
    const reminder = await db
      .select()
      .from(recurringReminders)
      .where(eq(recurringReminders.reference_id, 'rp_ikea'))
      .get();
    expect(reminder?.type).toBe('savings_recurring_payment_due_reminder');
    expect(reminder?.status).toBe('pending');
    expect(reminder?.period_key).toBe('2026-08');
  });

  it('skips a payment on autopay', async () => {
    await insertPayment({ id: 'rp_autopay', is_automated: true, day_of_month: null });

    const result = await mkWorker().scheduleDueRemindersForAllHouseholds(NOW);
    expect(result.scheduled).toBe(0);
  });

  it('skips an inactive payment', async () => {
    await insertPayment({ id: 'rp_inactive', active: false });

    const result = await mkWorker().scheduleDueRemindersForAllHouseholds(NOW);
    expect(result.scheduled).toBe(0);
  });

  it('skips a payment with no day_of_month', async () => {
    await insertPayment({ id: 'rp_no_day', day_of_month: null });

    const result = await mkWorker().scheduleDueRemindersForAllHouseholds(NOW);
    expect(result.scheduled).toBe(0);
  });

  it('is idempotent across repeated runs within the same period', async () => {
    await insertPayment({ id: 'rp_idem' });

    await mkWorker().scheduleDueRemindersForAllHouseholds(NOW);
    await mkWorker().scheduleDueRemindersForAllHouseholds(NOW);

    const db = drizzle(testEnv.DB);
    const rows = await db
      .select()
      .from(recurringReminders)
      .where(eq(recurringReminders.reference_id, 'rp_idem'))
      .all();
    expect(rows).toHaveLength(1);
  });

  it('respects the savings_enabled kill switch', async () => {
    await insertPayment({ id: 'rp_killed' });
    await testEnv.CONFIG_KV.put('savings_enabled', 'false');

    const result = await mkWorker().scheduleDueRemindersForAllHouseholds(NOW);
    expect(result.scheduled).toBe(0);

    await testEnv.CONFIG_KV.delete('savings_enabled');
  });
});
