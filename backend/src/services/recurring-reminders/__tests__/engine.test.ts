/**
 * Recurring-reminders engine — the "keep nagging until it's actually done"
 * lifecycle: create/roll-forward, the due-check cron sweep (nudge + auto-
 * complete via the registry's `isSatisfied`), manual complete, and frequency
 * changes. Delivery itself (whether a `scheduled_notifications` row actually
 * sends) is covered by `notification-delivery-cas.test.ts` — these tests only
 * assert the engine hands off the right row at the right time.
 */
import { env } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { beforeEach, describe, expect, it } from 'vitest';

import { scheduledNotifications } from '../../../db/schema-notifications';
import { recurringReminders } from '../../../db/schema-recurring-reminders';
import type { Env } from '../../../types';
import { createCoreTables } from '../../aihousekeeper/__tests__/test-helpers';
import {
  completeRecurringReminder,
  listActiveRecurringReminders,
  processDueRecurringReminders,
  setRecurringReminderFrequency,
  upsertRecurringReminder,
} from '../engine';
import {
  BUDGET_RENEWAL_REMINDER_TYPE,
  INCOME_ROLLOVER_REMINDER_TYPE,
  MORTGAGE_STATEMENT_REMINDER_TYPE,
  RECURRING_PAYMENT_DUE_REMINDER_TYPE,
} from '../registry';

import { createRecurringReminderTables, resetRecurringReminderTables } from './test-helpers';

const testEnv = env as unknown as Env;
const HID = 'hh_recurring';
const MID = 'm_recurring';
const GENERIC_TYPE = 'test_generic_reminder'; // unregistered — no isSatisfied, always nudges

async function seedMember(userId: string, deleted = false): Promise<void> {
  await testEnv.DB.prepare(
    `INSERT INTO household_members (id, household_id, user_id, role, joined_at, deleted_at)
     VALUES (?, ?, ?, 'member', datetime('now'), ?)`
  )
    .bind(`hm_${userId}`, HID, userId, deleted ? new Date().toISOString() : null)
    .run();
}

async function insertReminder(overrides: Partial<typeof recurringReminders.$inferInsert>) {
  const db = drizzle(testEnv.DB);
  const base = {
    id: overrides.id ?? `rr_${Math.random().toString(36).slice(2)}`,
    household_id: HID,
    type: GENERIC_TYPE,
    reference_type: 'test',
    reference_id: MID,
    period_key: '2026-01',
    status: 'pending' as const,
    title: 'Do the thing',
    body: 'Please do the thing.',
    data: JSON.stringify({ type: GENERIC_TYPE, householdId: HID }),
    frequency: 'every_3_days',
    next_nudge_at: new Date(Date.now() - 60_000).toISOString(),
    last_nudged_at: null,
    nudge_count: 0,
    snoozed_until: null,
    completed_at: null,
    completed_by_user_id: null,
    completed_reason: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await db.insert(recurringReminders).values({ ...base, ...overrides });
  return base.id;
}

async function getReminder(id: string) {
  const db = drizzle(testEnv.DB);
  return db.select().from(recurringReminders).where(eq(recurringReminders.id, id)).get();
}

beforeEach(async () => {
  await createCoreTables(testEnv.DB);
  await createRecurringReminderTables(testEnv.DB);
  await resetRecurringReminderTables(testEnv.DB);
  await testEnv.DB.prepare('DELETE FROM household_members').run();
});

describe('upsertRecurringReminder', () => {
  it('creates a pending row for a new period', async () => {
    await upsertRecurringReminder(testEnv, testEnv.DB, {
      householdId: HID,
      type: MORTGAGE_STATEMENT_REMINDER_TYPE,
      referenceId: MID,
      periodKey: '2026-03',
      title: 'Mortgage statement time',
      body: 'Upload it.',
      data: { type: MORTGAGE_STATEMENT_REMINDER_TYPE, householdId: HID, mortgageId: MID },
      dueAt: new Date('2026-03-15T15:00:00.000Z'),
    });

    const db = drizzle(testEnv.DB);
    const rows = await db.select().from(recurringReminders).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      household_id: HID,
      type: MORTGAGE_STATEMENT_REMINDER_TYPE,
      reference_type: 'mortgage', // pulled from the registry entry
      status: 'pending',
      frequency: 'every_3_days', // registry default for this type
      next_nudge_at: '2026-03-15T15:00:00.000Z',
    });
  });

  it('is idempotent for the same period (no duplicate row)', async () => {
    const params = {
      householdId: HID,
      type: GENERIC_TYPE,
      referenceId: MID,
      periodKey: '2026-03',
      title: 'A',
      body: 'B',
      data: {},
      dueAt: new Date('2026-03-01T00:00:00.000Z'),
    };
    await upsertRecurringReminder(testEnv, testEnv.DB, params);
    await upsertRecurringReminder(testEnv, testEnv.DB, params);

    const db = drizzle(testEnv.DB);
    expect(await db.select().from(recurringReminders).all()).toHaveLength(1);
  });

  it('supersedes an earlier still-pending period for the same reference', async () => {
    await upsertRecurringReminder(testEnv, testEnv.DB, {
      householdId: HID,
      type: GENERIC_TYPE,
      referenceId: MID,
      periodKey: '2026-02',
      title: 'A',
      body: 'B',
      data: {},
      dueAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    await upsertRecurringReminder(testEnv, testEnv.DB, {
      householdId: HID,
      type: GENERIC_TYPE,
      referenceId: MID,
      periodKey: '2026-03',
      title: 'A',
      body: 'B',
      data: {},
      dueAt: new Date('2026-03-01T00:00:00.000Z'),
    });

    const db = drizzle(testEnv.DB);
    const rows = await db
      .select()
      .from(recurringReminders)
      .where(and(eq(recurringReminders.household_id, HID), eq(recurringReminders.reference_id, MID)));
    expect(rows).toHaveLength(2);
    const feb = rows.find((r) => r.period_key === '2026-02');
    const mar = rows.find((r) => r.period_key === '2026-03');
    expect(feb?.status).toBe('done');
    expect(feb?.completed_reason).toBe('superseded');
    expect(mar?.status).toBe('pending');
  });
});

describe('processDueRecurringReminders', () => {
  it('nudges a due, unsatisfied reminder: fans out to active members and advances next_nudge_at', async () => {
    await seedMember('u_active_1');
    await seedMember('u_active_2');
    await seedMember('u_removed', true);
    const id = await insertReminder({});

    const nudged = await processDueRecurringReminders(testEnv, testEnv.DB);
    expect(nudged).toBe(1);

    const db = drizzle(testEnv.DB);
    const pushes = await db.select().from(scheduledNotifications).all();
    expect(pushes.map((p) => p.user_id).sort()).toEqual(['u_active_1', 'u_active_2']);
    expect(pushes.every((p) => p.type === GENERIC_TYPE)).toBe(true);

    const row = await getReminder(id);
    expect(row?.status).toBe('pending');
    expect(row?.nudge_count).toBe(1);
    expect(row?.last_nudged_at).toBeTruthy();
    expect(new Date(row!.next_nudge_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('leaves a not-yet-due reminder untouched', async () => {
    const id = await insertReminder({ next_nudge_at: new Date(Date.now() + 86_400_000).toISOString() });

    expect(await processDueRecurringReminders(testEnv, testEnv.DB)).toBe(0);
    const db = drizzle(testEnv.DB);
    expect(await db.select().from(scheduledNotifications).all()).toHaveLength(0);
    expect((await getReminder(id))?.nudge_count).toBe(0);
  });

  it('leaves a snoozed reminder untouched even if next_nudge_at is past', async () => {
    await insertReminder({ snoozed_until: new Date(Date.now() + 3_600_000).toISOString() });

    expect(await processDueRecurringReminders(testEnv, testEnv.DB)).toBe(0);
  });

  it('auto-completes via the registry isSatisfied check instead of nudging', async () => {
    await seedMember('u_active_1');
    const id = await insertReminder({
      type: MORTGAGE_STATEMENT_REMINDER_TYPE,
      reference_type: 'mortgage',
      data: JSON.stringify({
        type: MORTGAGE_STATEMENT_REMINDER_TYPE,
        householdId: HID,
        mortgageId: MID,
        afterStatementDate: '2026-01-31',
      }),
    });
    // A newer statement was committed since — the obligation is already met.
    await testEnv.DB.prepare(
      `INSERT INTO mortgage_statements (id, mortgage_id, household_id, statement_date, closing_balance_cents)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind('stmt_1', MID, HID, '2026-02-28', 100000)
      .run();

    const nudged = await processDueRecurringReminders(testEnv, testEnv.DB);
    expect(nudged).toBe(0);

    const row = await getReminder(id);
    expect(row?.status).toBe('done');
    expect(row?.completed_reason).toBe('auto_detected');

    const db = drizzle(testEnv.DB);
    expect(await db.select().from(scheduledNotifications).all()).toHaveLength(0);
  });

  it('auto-completes a budget renewal reminder once the renewal moved past this period', async () => {
    await seedMember('u_active_1');
    const renewalId = 'renewal_1';
    const id = await insertReminder({
      type: BUDGET_RENEWAL_REMINDER_TYPE,
      reference_type: 'budget_renewal',
      reference_id: renewalId,
      data: JSON.stringify({
        type: BUDGET_RENEWAL_REMINDER_TYPE,
        householdId: HID,
        recurringPaymentId: MID,
        renewalId,
        beforeRenewalDate: '2026-09-15',
      }),
    });
    // Member marked it renewed — next_renewal_date rolled past what this nudge was chasing.
    await testEnv.DB.prepare(
      `INSERT INTO budget_renewals (id, household_id, recurring_payment_id, next_renewal_date, status)
       VALUES (?, ?, ?, ?, 'upcoming')`
    )
      .bind(renewalId, HID, MID, '2027-09-15')
      .run();

    const nudged = await processDueRecurringReminders(testEnv, testEnv.DB);
    expect(nudged).toBe(0);

    const row = await getReminder(id);
    expect(row?.status).toBe('done');
    expect(row?.completed_reason).toBe('auto_detected');
  });

  it('keeps nagging an income rollover reminder while a draft is still outstanding', async () => {
    await seedMember('u_active_1');
    await testEnv.DB.prepare(
      `INSERT INTO savings_income_entries (id, household_id, source_type, label, amount_cents, income_date, status, source)
       VALUES (?, ?, 'payroll', 'Paycheck', 150000, '2026-08-01', 'draft', 'rollover')`
    )
      .bind('inc_draft_1', HID)
      .run();

    const id = await insertReminder({
      type: INCOME_ROLLOVER_REMINDER_TYPE,
      reference_type: 'savings_income_rollover',
      reference_id: 'monthly-income-rollover',
      period_key: '2026-08',
      data: JSON.stringify({
        type: INCOME_ROLLOVER_REMINDER_TYPE,
        householdId: HID,
        periodStart: '2026-08-01',
        periodEnd: '2026-09-01',
      }),
    });

    const nudged = await processDueRecurringReminders(testEnv, testEnv.DB);
    expect(nudged).toBe(1);

    const row = await getReminder(id);
    expect(row?.status).toBe('pending');
  });

  it('auto-completes an income rollover reminder once every draft for the period is resolved', async () => {
    await seedMember('u_active_1');
    // The draft was confirmed (or edited+saved / deleted) — none left for the period.
    await testEnv.DB.prepare(
      `INSERT INTO savings_income_entries (id, household_id, source_type, label, amount_cents, income_date, status, source)
       VALUES (?, ?, 'payroll', 'Paycheck', 150000, '2026-08-01', 'confirmed', 'rollover')`
    )
      .bind('inc_confirmed_1', HID)
      .run();

    const id = await insertReminder({
      type: INCOME_ROLLOVER_REMINDER_TYPE,
      reference_type: 'savings_income_rollover',
      reference_id: 'monthly-income-rollover',
      period_key: '2026-08',
      data: JSON.stringify({
        type: INCOME_ROLLOVER_REMINDER_TYPE,
        householdId: HID,
        periodStart: '2026-08-01',
        periodEnd: '2026-09-01',
      }),
    });

    const nudged = await processDueRecurringReminders(testEnv, testEnv.DB);
    expect(nudged).toBe(0);

    const row = await getReminder(id);
    expect(row?.status).toBe('done');
    expect(row?.completed_reason).toBe('auto_detected');
  });

  it('keeps nagging a payment-due reminder while the payment is still active and manual', async () => {
    await seedMember('u_active_1');
    await testEnv.DB.prepare(
      `INSERT INTO savings_recurring_payments (id, household_id, label, amount_cents, day_of_month, active, is_automated)
       VALUES (?, ?, 'IKEA 1', 37921, 22, 1, 0)`
    )
      .bind('rp_ikea', HID)
      .run();

    const id = await insertReminder({
      type: RECURRING_PAYMENT_DUE_REMINDER_TYPE,
      reference_type: 'savings_recurring_payment',
      reference_id: 'rp_ikea',
      period_key: '2026-08',
      data: JSON.stringify({
        type: RECURRING_PAYMENT_DUE_REMINDER_TYPE,
        householdId: HID,
        recurringPaymentId: 'rp_ikea',
        dueDate: '2026-08-22',
      }),
    });

    const nudged = await processDueRecurringReminders(testEnv, testEnv.DB);
    expect(nudged).toBe(1);
    expect((await getReminder(id))?.status).toBe('pending');
  });

  it('auto-completes a payment-due reminder once the payment is switched to autopay', async () => {
    await seedMember('u_active_1');
    await testEnv.DB.prepare(
      `INSERT INTO savings_recurring_payments (id, household_id, label, amount_cents, day_of_month, active, is_automated)
       VALUES (?, ?, 'IKEA 1', 37921, NULL, 1, 1)`
    )
      .bind('rp_ikea', HID)
      .run();

    const id = await insertReminder({
      type: RECURRING_PAYMENT_DUE_REMINDER_TYPE,
      reference_type: 'savings_recurring_payment',
      reference_id: 'rp_ikea',
      period_key: '2026-08',
      data: JSON.stringify({
        type: RECURRING_PAYMENT_DUE_REMINDER_TYPE,
        householdId: HID,
        recurringPaymentId: 'rp_ikea',
        dueDate: '2026-08-22',
      }),
    });

    const nudged = await processDueRecurringReminders(testEnv, testEnv.DB);
    expect(nudged).toBe(0);

    const row = await getReminder(id);
    expect(row?.status).toBe('done');
    expect(row?.completed_reason).toBe('auto_detected');
  });

  it('auto-completes a payment-due reminder once the payment is deleted', async () => {
    await seedMember('u_active_1');
    // No savings_recurring_payments row inserted — it was deleted.
    const id = await insertReminder({
      type: RECURRING_PAYMENT_DUE_REMINDER_TYPE,
      reference_type: 'savings_recurring_payment',
      reference_id: 'rp_deleted',
      period_key: '2026-08',
      data: JSON.stringify({
        type: RECURRING_PAYMENT_DUE_REMINDER_TYPE,
        householdId: HID,
        recurringPaymentId: 'rp_deleted',
        dueDate: '2026-08-22',
      }),
    });

    const nudged = await processDueRecurringReminders(testEnv, testEnv.DB);
    expect(nudged).toBe(0);
    expect((await getReminder(id))?.status).toBe('done');
  });
});

describe('completeRecurringReminder', () => {
  it('marks a reminder done and records who completed it', async () => {
    const id = await insertReminder({});
    const result = await completeRecurringReminder(testEnv.DB, HID, id, 'u_me');
    expect(result?.status).toBe('done');
    expect(result?.completed_by_user_id).toBe('u_me');
    expect(result?.completed_reason).toBe('manual');

    expect((await getReminder(id))?.status).toBe('done');
  });

  it('returns null for a reminder outside the given household', async () => {
    const id = await insertReminder({});
    expect(await completeRecurringReminder(testEnv.DB, 'hh_other', id, 'u_me')).toBeNull();
  });
});

describe('setRecurringReminderFrequency', () => {
  it('updates the cadence and defers the next nudge, clearing any snooze', async () => {
    const id = await insertReminder({ snoozed_until: new Date(Date.now() + 3_600_000).toISOString() });
    const before = (await getReminder(id))!.next_nudge_at;

    const updated = await setRecurringReminderFrequency(testEnv, testEnv.DB, HID, id, 'weekly');
    expect(updated?.frequency).toBe('weekly');
    expect(updated?.snoozed_until).toBeNull();
    expect(new Date(updated!.next_nudge_at).getTime()).not.toBe(new Date(before).getTime());
  });

  it('does not change an already-completed reminder', async () => {
    const id = await insertReminder({ status: 'done', completed_at: new Date().toISOString() });
    const result = await setRecurringReminderFrequency(testEnv, testEnv.DB, HID, id, 'weekly');
    expect(result?.status).toBe('done');
    expect((await getReminder(id))?.frequency).toBe('every_3_days'); // unchanged
  });
});

describe('listActiveRecurringReminders', () => {
  it('returns only pending reminders for the household, soonest first', async () => {
    await insertReminder({ id: 'rr_soon', next_nudge_at: new Date(Date.now() + 1000).toISOString() });
    await insertReminder({ id: 'rr_later', next_nudge_at: new Date(Date.now() + 999_000).toISOString() });
    await insertReminder({ id: 'rr_done', status: 'done', completed_at: new Date().toISOString() });
    await insertReminder({ id: 'rr_other_hh', household_id: 'hh_other' });

    const active = await listActiveRecurringReminders(testEnv.DB, HID);
    expect(active.map((r) => r.id)).toEqual(['rr_soon', 'rr_later']);
  });
});
