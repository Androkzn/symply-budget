/**
 * B1 reminder delivery CAS on tasks.reminder_claimed_at.
 */
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { tasks } from '../../db/schema';
import type { Env } from '../../types';
import { createCoreTables, resetAllTables } from '../aihousekeeper/__tests__/test-helpers';
import { ReminderService, MAX_REMINDER_DELIVERY_ATTEMPTS } from '../reminder-service';
import { SmartNotificationGateway } from '../smart-notification-gateway';

const testEnv = env as unknown as Env;

const UID = 'u_rem_cas';
const HID = 'hh_rem_cas';
const TID = 't_rem_cas';

const CRON_LEASES_DDL = `CREATE TABLE IF NOT EXISTS cron_leases (
  job_name TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
)`;

const SMART_DECISION_DDL = `CREATE TABLE IF NOT EXISTS smart_notification_decision (
  id TEXT PRIMARY KEY,
  household_id TEXT,
  recipient_user_id TEXT NOT NULL,
  producer_type TEXT NOT NULL,
  lane TEXT NOT NULL,
  recipient_rule TEXT NOT NULL,
  copy_source TEXT NOT NULL DEFAULT 'template',
  batch_role TEXT NOT NULL DEFAULT 'single',
  reference_type TEXT,
  reference_id TEXT,
  outcome_ref TEXT,
  suppress_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

async function setupSchema(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await testEnv.DB.prepare(
    'ALTER TABLE tasks ADD COLUMN reminder_claimed_at TEXT'
  ).run().catch(() => undefined);
  await testEnv.DB.prepare(
    'ALTER TABLE tasks ADD COLUMN reminder_attempt_count INTEGER DEFAULT 0'
  ).run().catch(() => undefined);
  await testEnv.DB.prepare(CRON_LEASES_DDL.replace(/\s+/g, ' ').trim()).run();
  await testEnv.DB.prepare(SMART_DECISION_DDL.replace(/\s+/g, ' ').trim()).run();
  await testEnv.DB.prepare(
    `CREATE TABLE IF NOT EXISTS push_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      platform TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`.replace(/\s+/g, ' ').trim()
  ).run();
  await resetAllTables(testEnv.DB);
  await testEnv.DB.prepare('DELETE FROM cron_leases').run();

  await testEnv.DB.prepare(
    'INSERT INTO users (id, email, email_verified) VALUES (?, ?, 1)'
  )
    .bind(UID, 'rem-cas@example.com')
    .run();
  await testEnv.DB.prepare('INSERT INTO households (id, name) VALUES (?, ?)')
    .bind(HID, 'Reminder CAS')
    .run();
  await testEnv.DB.prepare(
    `INSERT INTO household_members (id, household_id, user_id, role, joined_at)
     VALUES ('m1', ?, ?, 'owner', '2025-01-01T00:00:00Z')`
  )
    .bind(HID, UID)
    .run();
  await testEnv.DB.prepare(
    `INSERT INTO push_tokens (id, user_id, token, platform, is_active)
     VALUES ('pt1', ?, 'ExponentPushToken[test]', 'ios', 1)`
  )
    .bind(UID)
    .run();

  const today = new Date().toISOString().split('T')[0];
  const db = drizzle(testEnv.DB);
  await db.insert(tasks).values({
    id: TID,
    household_id: HID,
    title: 'Filter HVAC',
    frequency: 'monthly',
    next_due_date: today,
    reminder_enabled: true,
    reminder_days_before: 0,
    reminder_repeat: false,
    is_active: true,
    blocked: false,
    reminder_claimed_at: null,
    reminder_attempt_count: 0,
  });
}

describe('ReminderService B1 CAS', () => {
  let enqueueSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await setupSchema();
    vi.clearAllMocks();
    enqueueSpy = vi.spyOn(SmartNotificationGateway.prototype, 'enqueue').mockResolvedValue({
      decisionIds: [],
      dispatched: 1,
      lane: 'A',
      copySource: 'template',
    });
  });

  it('claims task, sends reminder, sets last_reminder_sent_at', async () => {
    const svc = new ReminderService(testEnv, testEnv.DB);
    const result = await svc.processReminders();
    expect(result.sent).toBe(1);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);

    const row = await drizzle(testEnv.DB)
      .select()
      .from(tasks)
      .where(eq(tasks.id, TID))
      .get();
    expect(row?.last_reminder_sent_at).toBeTruthy();
    expect(row?.reminder_claimed_at).toBeNull();
  });

  it('skips task with active non-stale claim', async () => {
    const now = new Date().toISOString();
    await drizzle(testEnv.DB)
      .update(tasks)
      .set({ reminder_claimed_at: now })
      .where(eq(tasks.id, TID));

    const svc = new ReminderService(testEnv, testEnv.DB);
    const result = await svc.processReminders();
    expect(result.sent).toBe(0);
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('increments reminder_attempt_count on enqueue failure', async () => {
    enqueueSpy.mockRejectedValueOnce(new Error('gateway down'));
    const svc = new ReminderService(testEnv, testEnv.DB);
    await svc.processReminders();

    const row = await drizzle(testEnv.DB)
      .select()
      .from(tasks)
      .where(eq(tasks.id, TID))
      .get();
    expect(row?.reminder_attempt_count).toBe(1);
    expect(row?.reminder_claimed_at).toBeNull();
    expect(row?.last_reminder_sent_at).toBeNull();
  });

  it('excludes tasks at attempt cap', async () => {
    await drizzle(testEnv.DB)
      .update(tasks)
      .set({ reminder_attempt_count: MAX_REMINDER_DELIVERY_ATTEMPTS })
      .where(eq(tasks.id, TID));

    const svc = new ReminderService(testEnv, testEnv.DB);
    const result = await svc.processReminders();
    expect(result.processed).toBe(0);
    expect(enqueueSpy).not.toHaveBeenCalled();
  });
});
