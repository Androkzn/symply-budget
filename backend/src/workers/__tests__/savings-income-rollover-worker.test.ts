/**
 * SavingsIncomeRolloverWorker — drafts next month's regular income from last
 * month's confirmed entries, then schedules the "confirm this month's income"
 * recurring reminder. Exercised against real D1 (savings_income_entries +
 * recurring_reminders) so the filtering/clamp/idempotency/reminder-scheduling
 * logic is verified before cron picks it up (see cron/scheduled.ts).
 */
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../db/schema';
import { recurringReminders } from '../../db/schema-recurring-reminders';
import { savingsIncomeEntries } from '../../db/schema-savings';
import { createSavingsTables, resetSavingsTables } from '../../routes/__tests__/savings-test-helpers';
import { createCoreTables, resetAllTables } from '../../services/aihousekeeper/__tests__/test-helpers';
import {
  createRecurringReminderTables,
  resetRecurringReminderTables,
} from '../../services/recurring-reminders/__tests__/test-helpers';
import type { Env } from '../../types';
import { SavingsIncomeRolloverWorker } from '../savings-income-rollover-worker';

const testEnv = env as unknown as Env;
const HID = 'hh_income_rollover_01';
const UID = 'u_income_rollover_owner';
const MID = 'm_income_rollover_owner';

// Source month July 2026 (31 days) → target month August 2026 (31 days), so
// day-of-month is preserved with no clamp — the clamp test below uses a
// separate Feb target where it matters.
const AUG_NOW = new Date('2026-08-02T08:00:00Z');

async function seed(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createSavingsTables(testEnv.DB);
  await createRecurringReminderTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetSavingsTables(testEnv.DB);
  await resetRecurringReminderTables(testEnv.DB);
  await testEnv.CONFIG_KV.delete('savings_enabled');

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values({ id: UID, email: 'rollover@example.com', email_verified: true });
  await db.insert(schema.households).values({ id: HID, name: 'RolloverTest' });
  await db.insert(schema.householdMembers).values({
    id: MID,
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: '2025-01-01T00:00:00Z',
  });
}

async function insertIncome(
  overrides: Partial<typeof savingsIncomeEntries.$inferInsert> & { id: string }
): Promise<string> {
  const db = drizzle(testEnv.DB);
  await db.insert(savingsIncomeEntries).values({
    household_id: HID,
    member_id: null,
    source_type: 'payroll',
    label: 'Paycheck',
    amount_cents: 150000,
    income_date: '2026-07-15',
    currency: 'CAD',
    notes: null,
    status: 'confirmed',
    source: 'manual',
    created_by: UID,
    ...overrides,
  });
  return overrides.id;
}

function mkWorker(): SavingsIncomeRolloverWorker {
  return new SavingsIncomeRolloverWorker(testEnv, testEnv.DB);
}

beforeEach(async () => {
  await seed();
});

describe('SavingsIncomeRolloverWorker.rolloverRegularIncomeForAllHouseholds', () => {
  it('copies confirmed regular income from last month as this month\'s draft', async () => {
    await insertIncome({ id: 'src_payroll', source_type: 'payroll', amount_cents: 150000, income_date: '2026-07-15' });

    const result = await mkWorker().rolloverRegularIncomeForAllHouseholds(AUG_NOW);
    expect(result.created).toBe(1);
    expect(result.households).toBe(1);

    const db = drizzle(testEnv.DB);
    const drafts = await db
      .select()
      .from(savingsIncomeEntries)
      .where(eq(savingsIncomeEntries.rolled_over_from_entry_id, 'src_payroll'))
      .all();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      household_id: HID,
      status: 'draft',
      source: 'rollover',
      source_type: 'payroll',
      amount_cents: 150000,
      income_date: '2026-08-15',
    });
  });

  it('does not roll over irregular (one-off) income', async () => {
    await insertIncome({ id: 'src_gift', source_type: 'gift', income_date: '2026-07-10' });

    const result = await mkWorker().rolloverRegularIncomeForAllHouseholds(AUG_NOW);
    expect(result.created).toBe(0);
  });

  it('does not roll over a still-draft (unconfirmed) source entry', async () => {
    await insertIncome({ id: 'src_unconfirmed', status: 'draft', income_date: '2026-07-15' });

    const result = await mkWorker().rolloverRegularIncomeForAllHouseholds(AUG_NOW);
    expect(result.created).toBe(0);
  });

  it('clamps the rolled-over day-of-month to the target month length', async () => {
    // Jan 31 income rolling into Feb (28 days in 2026) → clamps to Feb 28,
    // not an invalid "Feb 31".
    const febNow = new Date('2026-02-02T08:00:00Z');
    await insertIncome({ id: 'src_31', income_date: '2026-01-31' });

    const result = await mkWorker().rolloverRegularIncomeForAllHouseholds(febNow);
    expect(result.created).toBe(1);

    const db = drizzle(testEnv.DB);
    const draft = await db
      .select()
      .from(savingsIncomeEntries)
      .where(eq(savingsIncomeEntries.rolled_over_from_entry_id, 'src_31'))
      .get();
    expect(draft?.income_date).toBe('2026-02-28');
  });

  it('is idempotent across repeated runs (unique index on rolled_over_from_entry_id)', async () => {
    await insertIncome({ id: 'src_idem', income_date: '2026-07-15' });

    const first = await mkWorker().rolloverRegularIncomeForAllHouseholds(AUG_NOW);
    expect(first.created).toBe(1);

    const second = await mkWorker().rolloverRegularIncomeForAllHouseholds(AUG_NOW);
    expect(second.created).toBe(0);

    const db = drizzle(testEnv.DB);
    const drafts = await db
      .select()
      .from(savingsIncomeEntries)
      .where(eq(savingsIncomeEntries.rolled_over_from_entry_id, 'src_idem'))
      .all();
    expect(drafts).toHaveLength(1);
  });

  it('schedules a pending "confirm income" recurring reminder for the household', async () => {
    await insertIncome({ id: 'src_reminder', income_date: '2026-07-15' });

    await mkWorker().rolloverRegularIncomeForAllHouseholds(AUG_NOW);

    const db = drizzle(testEnv.DB);
    const reminder = await db
      .select()
      .from(recurringReminders)
      .where(eq(recurringReminders.household_id, HID))
      .get();
    expect(reminder?.type).toBe('savings_income_rollover_reminder');
    expect(reminder?.status).toBe('pending');
    expect(reminder?.period_key).toBe('2026-08');
  });

  it('does not schedule a reminder when a household has no rollover candidates', async () => {
    await mkWorker().rolloverRegularIncomeForAllHouseholds(AUG_NOW);

    const db = drizzle(testEnv.DB);
    const reminders = await db.select().from(recurringReminders).all();
    expect(reminders).toHaveLength(0);
  });

  it('respects the savings_enabled kill switch', async () => {
    await insertIncome({ id: 'src_killed', income_date: '2026-07-15' });
    await testEnv.CONFIG_KV.put('savings_enabled', 'false');

    const result = await mkWorker().rolloverRegularIncomeForAllHouseholds(AUG_NOW);
    expect(result.created).toBe(0);

    await testEnv.CONFIG_KV.delete('savings_enabled');
  });
});
