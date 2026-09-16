/**
 * Mortgage "upload your statement" reminder — the monthly nudge scheduled when a
 * statement is committed. Covers the date math (month+1, end-of-month clamp, year
 * rollover) and the hand-off to the recurring-reminders engine (one pending row
 * per household+period, roll-forward via supersede). Nudge cadence, auto-complete
 * via `isSatisfied`, and per-member push fan-out live in the engine and are
 * covered by `services/recurring-reminders/__tests__/engine.test.ts`.
 */
import { env } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach } from 'vitest';

import { recurringReminders } from '../../../db/schema-recurring-reminders';
import type { Env } from '../../../types';
import { createCoreTables } from '../../aihousekeeper/__tests__/test-helpers';
import { createRecurringReminderTables, resetRecurringReminderTables } from '../../recurring-reminders/__tests__/test-helpers';
import {
  computeStatementReminderDate,
  scheduleMortgageStatementReminder,
} from '../statement-reminder';

const testEnv = env as unknown as Env;
const HID = 'hh_stmt_reminder';
const MID = 'm_stmt_reminder';

describe('computeStatementReminderDate', () => {
  it('is the statement month + 1, at 15:00 UTC', () => {
    expect(computeStatementReminderDate('2025-11-30')?.toISOString()).toBe('2025-12-30T15:00:00.000Z');
  });

  it('clamps to the target month last day (no month skip on end-of-month)', () => {
    // Jan 31 → Feb 28 (not Mar 3 from a naive setMonth overflow).
    expect(computeStatementReminderDate('2026-01-31')?.toISOString()).toBe('2026-02-28T15:00:00.000Z');
  });

  it('respects leap years when clamping', () => {
    expect(computeStatementReminderDate('2024-01-31')?.toISOString()).toBe('2024-02-29T15:00:00.000Z');
  });

  it('rolls the year over from December', () => {
    expect(computeStatementReminderDate('2025-12-31')?.toISOString()).toBe('2026-01-31T15:00:00.000Z');
  });

  it('honours an explicit hour', () => {
    expect(computeStatementReminderDate('2025-11-30', 8)?.toISOString()).toBe('2025-12-30T08:00:00.000Z');
  });

  it('returns null for a malformed or out-of-range date', () => {
    expect(computeStatementReminderDate('not-a-date')).toBeNull();
    expect(computeStatementReminderDate('2025-13-01')).toBeNull();
    expect(computeStatementReminderDate('2025-11-40')).toBeNull();
  });
});

async function reminderRows() {
  const db = drizzle(testEnv.DB);
  return db
    .select()
    .from(recurringReminders)
    .where(and(eq(recurringReminders.household_id, HID), eq(recurringReminders.reference_id, MID)))
    .all();
}

describe('scheduleMortgageStatementReminder', () => {
  beforeEach(async () => {
    await createCoreTables(testEnv.DB);
    await createRecurringReminderTables(testEnv.DB);
    await resetRecurringReminderTables(testEnv.DB);
    await testEnv.DB.prepare('DELETE FROM household_members').run();
  });

  it('creates one pending reminder (household-scoped) with the computed date + type', async () => {
    await scheduleMortgageStatementReminder(testEnv, testEnv.DB, {
      householdId: HID,
      mortgageId: MID,
      statementDate: '2999-01-31',
    });

    const rows = await reminderRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'mortgage_statement_reminder',
      status: 'pending',
      period_key: '2999-02',
      next_nudge_at: '2999-02-28T15:00:00.000Z',
    });
    expect(JSON.parse(rows[0].data!)).toMatchObject({ afterStatementDate: '2999-01-31', mortgageId: MID });
  });

  it('rolls forward: a second commit supersedes the prior pending period (no stacking)', async () => {
    await scheduleMortgageStatementReminder(testEnv, testEnv.DB, {
      householdId: HID,
      mortgageId: MID,
      statementDate: '2999-01-31',
    });
    await scheduleMortgageStatementReminder(testEnv, testEnv.DB, {
      householdId: HID,
      mortgageId: MID,
      statementDate: '2999-03-15',
    });

    const rows = await reminderRows();
    const pending = rows.filter((r) => r.status === 'pending');
    expect(pending).toHaveLength(1); // not two — the first was superseded
    expect(pending[0].next_nudge_at).toBe('2999-04-15T15:00:00.000Z');

    const superseded = rows.find((r) => r.period_key === '2999-02');
    expect(superseded?.status).toBe('done');
    expect(superseded?.completed_reason).toBe('superseded');
  });

  it('does not create or disturb anything when the reminder date is already in the past', async () => {
    // Prime a future pending reminder — a past-dated backfill must not touch it
    // (a historical statement doesn't satisfy the CURRENT period's obligation;
    // the engine's own `isSatisfied` check already handles that distinction).
    await scheduleMortgageStatementReminder(testEnv, testEnv.DB, {
      householdId: HID,
      mortgageId: MID,
      statementDate: '2999-01-31',
    });
    await scheduleMortgageStatementReminder(testEnv, testEnv.DB, {
      householdId: HID,
      mortgageId: MID,
      statementDate: '2000-01-15',
    });

    const rows = await reminderRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].period_key).toBe('2999-02');
  });
});
