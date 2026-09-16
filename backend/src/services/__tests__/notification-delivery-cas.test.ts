/**
 * B1 delivery CAS — scheduled_notifications claim-before-send + D1 cron lease.
 */
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { scheduledNotifications } from '../../db/schema-notifications';
import type { Env } from '../../types';
import { createCoreTables, resetAllTables } from '../aihousekeeper/__tests__/test-helpers';
import { d1Changes, tryAcquireCronLease } from '../cron-lease';
import {
  MAX_NOTIFICATION_DELIVERY_ATTEMPTS,
  NotificationService,
} from '../notification-service';

const testEnv = env as unknown as Env;

const UID = 'u_notif_cas';
const HID = 'hh_notif_cas';

const SCHEDULED_NOTIFICATIONS_DDL = `CREATE TABLE IF NOT EXISTS scheduled_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  household_id TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data TEXT,
  scheduled_for TEXT NOT NULL,
  sent_at TEXT,
  failed_at TEXT,
  error_message TEXT,
  reference_type TEXT,
  reference_id TEXT,
  image_url TEXT,
  category_id TEXT,
  thread_id TEXT,
  claimed_at TEXT,
  claim_owner TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const CRON_LEASES_DDL = `CREATE TABLE IF NOT EXISTS cron_leases (
  job_name TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
)`;

async function setupSchema(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await testEnv.DB.prepare(SCHEDULED_NOTIFICATIONS_DDL.replace(/\s+/g, ' ').trim()).run();
  await testEnv.DB.prepare(CRON_LEASES_DDL.replace(/\s+/g, ' ').trim()).run();
  await resetAllTables(testEnv.DB);
  await testEnv.DB.prepare('DELETE FROM scheduled_notifications').run();
  await testEnv.DB.prepare('DELETE FROM cron_leases').run();

  await testEnv.DB.prepare(
    'INSERT INTO users (id, email, email_verified) VALUES (?, ?, 1)'
  )
    .bind(UID, 'notif-cas@example.com')
    .run();
  await testEnv.DB.prepare('INSERT INTO households (id, name) VALUES (?, ?)')
    .bind(HID, 'Notif CAS')
    .run();
}

async function insertDueNotification(id: string, overrides: Record<string, unknown> = {}) {
  const db = drizzle(testEnv.DB);
  const past = new Date(Date.now() - 60_000).toISOString();
  await db.insert(scheduledNotifications).values({
    id,
    user_id: UID,
    household_id: HID,
    type: 'task_reminder',
    title: 'Due',
    body: 'Body',
    scheduled_for: past,
    sent_at: null,
    failed_at: null,
    error_message: null,
    claimed_at: null,
    claim_owner: null,
    attempt_count: 0,
    created_at: past,
    ...overrides,
  });
}

describe('NotificationService B1 CAS', () => {
  let sendSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await setupSchema();
    vi.clearAllMocks();
    sendSpy = vi
      .spyOn(NotificationService.prototype, 'sendNotification')
      .mockResolvedValue(undefined);
  });

  it('sends a due notification once and sets sent_at (not claimed_at as sent marker)', async () => {
    await insertDueNotification('n1');
    const svc = new NotificationService(testEnv, testEnv.DB);

    const sent = await svc.processScheduledNotifications();
    expect(sent).toBe(1);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const row = await drizzle(testEnv.DB)
      .select()
      .from(scheduledNotifications)
      .where(eq(scheduledNotifications.id, 'n1'))
      .get();
    expect(row?.sent_at).toBeTruthy();
    expect(row?.claimed_at).toBeNull();
  });

  it('CAS claim prevents a second worker from sending the same row', async () => {
    await insertDueNotification('n2');
    const db = drizzle(testEnv.DB);
    const now = new Date().toISOString();

    const firstClaim = await db
      .update(scheduledNotifications)
      .set({ claimed_at: now, claim_owner: 'worker-a' })
      .where(eq(scheduledNotifications.id, 'n2'))
      .run();
    expect(d1Changes(firstClaim)).toBe(1);

    const svc = new NotificationService(testEnv, testEnv.DB);
    const sent = await svc.processScheduledNotifications();
    expect(sent).toBe(0);
    expect(sendSpy).not.toHaveBeenCalled();

    const row = await drizzle(testEnv.DB)
      .select()
      .from(scheduledNotifications)
      .where(eq(scheduledNotifications.id, 'n2'))
      .get();
    expect(row?.sent_at).toBeNull();
    expect(row?.claimed_at).toBe(now);
  });

  it('reclaims stale claims and delivers', async () => {
    const staleClaim = new Date(Date.now() - 6 * 60_000).toISOString();
    await insertDueNotification('n3', {
      claimed_at: staleClaim,
      claim_owner: 'crashed-worker',
    });

    const svc = new NotificationService(testEnv, testEnv.DB);
    const sent = await svc.processScheduledNotifications();
    expect(sent).toBe(1);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('increments attempt_count and clears claim on send failure', async () => {
    sendSpy.mockRejectedValueOnce(new Error('push down'));
    await insertDueNotification('n4');

    const svc = new NotificationService(testEnv, testEnv.DB);
    const sent = await svc.processScheduledNotifications();
    expect(sent).toBe(0);

    const row = await drizzle(testEnv.DB)
      .select()
      .from(scheduledNotifications)
      .where(eq(scheduledNotifications.id, 'n4'))
      .get();
    expect(row?.attempt_count).toBe(1);
    expect(row?.claimed_at).toBeNull();
    expect(row?.sent_at).toBeNull();
    expect(row?.failed_at).toBeTruthy();
  });

  it('stops selecting rows after attempt cap', async () => {
    await insertDueNotification('n5', {
      attempt_count: MAX_NOTIFICATION_DELIVERY_ATTEMPTS,
    });

    const svc = new NotificationService(testEnv, testEnv.DB);
    const sent = await svc.processScheduledNotifications();
    expect(sent).toBe(0);
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe('D1 cron lease', () => {
  beforeEach(async () => {
    await testEnv.DB.prepare(CRON_LEASES_DDL.replace(/\s+/g, ' ').trim()).run();
    await testEnv.DB.prepare('DELETE FROM cron_leases').run();
  });

  it('allows only one active holder until TTL expires', async () => {
    const db = drizzle(testEnv.DB);
    expect(await tryAcquireCronLease(db, 'test_job', 'holder-a', 60_000)).toBe(true);
    expect(await tryAcquireCronLease(db, 'test_job', 'holder-b', 60_000)).toBe(false);

    await testEnv.DB.prepare(
      "UPDATE cron_leases SET expires_at = '2000-01-01T00:00:00.000Z' WHERE job_name = 'test_job'"
    ).run();

    expect(await tryAcquireCronLease(db, 'test_job', 'holder-c', 60_000)).toBe(true);
  });
});
