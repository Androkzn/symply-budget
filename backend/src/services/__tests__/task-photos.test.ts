/**
 * TaskService — attachment photo sync (max 5, cover image for task cards).
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../db/schema';
import type { Env } from '../../types';
import {
  createCoreTables,
  resetAllTables,
} from '../aihousekeeper/__tests__/test-helpers';
import { TaskService } from '../task-service';

const testEnv = env as unknown as Env;
const HID = 'hh_photos_01';
const UID = 'u_photos_01';
const TID = 't_photos_01';

async function createTaskAncillaryTables(): Promise<void> {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS maintenance_subtasks (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      completed_by TEXT,
      reminder_enabled INTEGER NOT NULL DEFAULT 0,
      reminder_days_before INTEGER NOT NULL DEFAULT 1,
      reminder_time TEXT NOT NULL DEFAULT '09:00',
      reminder_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by TEXT,
      deleted_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS scheduled_notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      household_id TEXT,
      type TEXT,
      reference_type TEXT NOT NULL,
      reference_id TEXT NOT NULL,
      title TEXT,
      body TEXT,
      data TEXT,
      scheduled_for TEXT,
      sent_at TEXT,
      failed_at TEXT,
      cancelled_at TEXT,
      failure_reason TEXT,
      error_message TEXT,
      notification_type TEXT,
      task_id TEXT,
      action_item_id TEXT,
      retry_count INTEGER DEFAULT 0,
      last_error TEXT,
      priority TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  ];
  for (const sql of stmts) await testEnv.DB.prepare(sql).run();
}

async function seed() {
  await createCoreTables(testEnv.DB);
  await createTaskAncillaryTables();
  await resetAllTables(testEnv.DB);
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values({
    id: UID,
    email: 'photos@example.com',
    email_verified: true,
  });
  await db.insert(schema.households).values({ id: HID, name: 'Photo Test Home' });
  await db.insert(schema.householdMembers).values({
    id: 'm_photos',
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: '2025-01-01T00:00:00Z',
  });
  await db.insert(schema.tasks).values({
    id: TID,
    household_id: HID,
    title: 'Fix leak',
    frequency: 'one_time',
    system_category: 'plumbing',
    created_by: UID,
  });
}

describe('TaskService — task photos', () => {
  beforeEach(async () => {
    await seed();
  });

  it('stores up to 5 photos and sets cover_photo_url on getTask', async () => {
    const service = new TaskService(testEnv, testEnv.DB);
    const keys = [
      'maintenance-photos/h1/a/one.jpg',
      'maintenance-photos/h1/b/two.jpg',
    ];

    await service.updateTask(HID, TID, UID, {
      photos: keys.map((photo_key) => ({ photo_key })),
      cover_photo_index: 1,
    });

    const task = await service.getTask(HID, TID, UID);
    expect(task.photos).toHaveLength(2);
    expect(task.photos![0].photo_key).toBe(keys[0]);
    expect(task.photos![1].photo_key).toBe(keys[1]);
    expect(task.cover_photo_id).toBe(task.photos![1].id);
    expect(task.cover_photo_url).toContain(keys[1]);
  });

  it('replaces photos on update and clears cover when photos are removed', async () => {
    const service = new TaskService(testEnv, testEnv.DB);

    await service.updateTask(HID, TID, UID, {
      photos: [{ photo_key: 'maintenance-photos/h1/old.jpg' }],
      cover_photo_index: 0,
    });

    await service.updateTask(HID, TID, UID, {
      photos: [],
    });

    const task = await service.getTask(HID, TID, UID);
    expect(task.photos).toEqual([]);
    expect(task.cover_photo_id).toBeNull();
    expect(task.cover_photo_url).toBeNull();
  });

  it('includes cover_photo_url on listTasks without loading full photo arrays', async () => {
    const service = new TaskService(testEnv, testEnv.DB);
    await service.updateTask(HID, TID, UID, {
      photos: [{ photo_key: 'maintenance-photos/h1/cover.jpg' }],
      cover_photo_index: 0,
    });

    const { tasks } = await service.listTasks(HID, UID, {});
    expect(tasks).toHaveLength(1);
    expect(tasks[0].cover_photo_url).toContain('cover.jpg');
    expect(tasks[0].photos).toBeUndefined();
  });

  it('rejects more than 5 photos', async () => {
    const service = new TaskService(testEnv, testEnv.DB);
    const photos = Array.from({ length: 6 }, (_, i) => ({
      photo_key: `maintenance-photos/h1/${i}.jpg`,
    }));

    await expect(
      service.updateTask(HID, TID, UID, { photos, cover_photo_index: 0 })
    ).rejects.toThrow(/at most 5 photos/i);
  });
});
