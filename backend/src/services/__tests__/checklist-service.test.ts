/**
 * checklist-service.ts — seasonal-checklist behaviour (previously zero coverage).
 *
 * ChecklistService is a mixed surface: the *seasonal* checklist methods
 * (create / getOrCreate / get / list / addItem / updateItem + progress) are
 * fully implemented, while the custom-checklist route methods (deleteChecklist,
 * getProgress, getCurrentInstance, completeItem, uncompleteItem,
 * createDefaultChecklists) are explicit `Not implemented` stubs. This suite
 * covers the working seasonal logic directly at the service layer and pins the
 * stub contract so a future implementation forces a conscious test update.
 *
 * Focus areas that only the seams reveal:
 *   - household-membership gate (ForbiddenError for a non-member).
 *   - progress % recomputation as items are completed / uncompleted.
 *   - getOrCreate idempotency (second call returns the same checklist).
 *   - soft-delete filtering (deleted_at rows excluded from get/list).
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../db/schema';
import type { Env } from '../../types';
import { createCoreTables, resetAllTables } from '../aihousekeeper/__tests__/test-helpers';
import { ChecklistService } from '../checklist-service';

const testEnv = env as unknown as Env;
const UID = 'u_chk_owner';
const OUTSIDER = 'u_chk_outsider';
const HID = 'hh_chk_1';
const MID = 'm_chk_1';
const YEAR = 2026;

async function createChecklistTables(): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS seasonal_checklists (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      season TEXT NOT NULL,
      year INTEGER NOT NULL,
      climate_zone TEXT NOT NULL,
      progress INTEGER DEFAULT 0,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT,
      updated_by TEXT,
      version INTEGER NOT NULL DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS seasonal_checklist_items (
      id TEXT PRIMARY KEY,
      checklist_id TEXT NOT NULL,
      task_template_id TEXT,
      title TEXT NOT NULL,
      category TEXT,
      is_completed INTEGER DEFAULT 0,
      completed_at TEXT,
      completed_by TEXT,
      notes TEXT,
      photo_keys TEXT,
      sort_order INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT,
      updated_by TEXT,
      version INTEGER NOT NULL DEFAULT 1
    )`,
  ];
  for (const sql of statements) {
    await testEnv.DB.exec(sql.replace(/\s+/g, ' ').trim());
  }
}

async function seed(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createChecklistTables();
  await resetAllTables(testEnv.DB);
  await testEnv.DB.exec('DELETE FROM seasonal_checklists');
  await testEnv.DB.exec('DELETE FROM seasonal_checklist_items');

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values({ id: UID, email: 'chk@example.com', email_verified: true });
  await db.insert(schema.users).values({ id: OUTSIDER, email: 'chk-out@example.com', email_verified: true });
  await db.insert(schema.households).values({ id: HID, name: 'ChkTest', city: 'Surrey', state_province: 'BC', country: 'CA' });
  await db.insert(schema.householdMembers).values({
    id: MID,
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: '2025-01-01T00:00:00Z',
  });
}

function svc(): ChecklistService {
  return new ChecklistService(testEnv, testEnv.DB);
}

describe('ChecklistService — seasonal checklists', () => {
  beforeEach(async () => {
    await seed();
  });

  describe('membership gate', () => {
    it('rejects a non-member with ForbiddenError', async () => {
      await expect(
        svc().createChecklist(HID, OUTSIDER, { season: 'spring', year: YEAR, climate_zone: 'pacific_northwest' }),
      ).rejects.toThrow(/member/i);
    });
  });

  describe('create + get', () => {
    it('createChecklist inserts a seasonal checklist with progress 0 and no items', async () => {
      const created = await svc().createChecklist(HID, UID, { season: 'fall', year: YEAR, climate_zone: 'pacific_northwest' });
      expect(created.id).toBeTruthy();
      expect(created.season).toBe('fall');
      expect(created.year).toBe(YEAR);
      expect(created.climate_zone).toBe('pacific_northwest');
      expect(created.progress).toBe(0);
      expect(created.items).toEqual([]);
    });

    it('getChecklist returns the persisted checklist; unknown id → NotFoundError', async () => {
      const created = await svc().createChecklist(HID, UID, { season: 'winter', year: YEAR, climate_zone: 'pacific_northwest' });
      const fetched = await svc().getChecklist(HID, created.id, UID);
      expect(fetched.id).toBe(created.id);

      await expect(svc().getChecklist(HID, 'chk_nope', UID)).rejects.toThrow(/not found/i);
    });

    it('getOrCreateChecklist is idempotent — second call returns the same row', async () => {
      const first = await svc().getOrCreateChecklist(HID, UID, 'summer', YEAR);
      const second = await svc().getOrCreateChecklist(HID, UID, 'summer', YEAR);
      expect(second.id).toBe(first.id);

      const all = await svc().listChecklists(HID, UID, { season: 'summer', year: YEAR });
      expect(all).toHaveLength(1);
    });
  });

  describe('list + filters', () => {
    it('listChecklists returns all checklists and honours season/year filters', async () => {
      const s = svc();
      await s.createChecklist(HID, UID, { season: 'spring', year: YEAR, climate_zone: 'pacific_northwest' });
      await s.createChecklist(HID, UID, { season: 'fall', year: YEAR, climate_zone: 'pacific_northwest' });

      expect(await s.listChecklists(HID, UID)).toHaveLength(2);

      const springOnly = await s.listChecklists(HID, UID, { season: 'spring' });
      expect(springOnly).toHaveLength(1);
      expect(springOnly[0].season).toBe('spring');

      expect(await s.listChecklists(HID, UID, { year: 1999 })).toHaveLength(0);
    });
  });

  describe('items + progress', () => {
    it('recomputes progress as items are completed and uncompleted', async () => {
      const s = svc();
      const checklist = await s.createChecklist(HID, UID, { season: 'spring', year: YEAR, climate_zone: 'pacific_northwest' });

      const a = await s.addItem(HID, checklist.id, UID, { title: 'Clean gutters' });
      await s.addItem(HID, checklist.id, UID, { title: 'Test smoke alarms' });

      // Two items, none complete → 0%.
      expect((await s.getChecklist(HID, checklist.id, UID)).progress).toBe(0);

      // Complete one → 50%.
      await s.updateItem(HID, checklist.id, a.id, UID, { is_completed: true });
      let state = await s.getChecklist(HID, checklist.id, UID);
      expect(state.progress).toBe(50);
      const completedItem = state.items.find((i) => i.id === a.id);
      expect(completedItem?.is_completed).toBe(true);
      expect(completedItem?.completed_at).toBeTruthy();
      expect(completedItem?.completed_by).toBe(UID);

      // Uncomplete it → back to 0% and completion metadata cleared.
      await s.updateItem(HID, checklist.id, a.id, UID, { is_completed: false });
      state = await s.getChecklist(HID, checklist.id, UID);
      expect(state.progress).toBe(0);
      expect(state.items.find((i) => i.id === a.id)?.is_completed).toBe(false);
    });

    it('reaches 100% and stamps completed_at when every item is done', async () => {
      const s = svc();
      const checklist = await s.createChecklist(HID, UID, { season: 'winter', year: YEAR, climate_zone: 'pacific_northwest' });
      const only = await s.addItem(HID, checklist.id, UID, { title: 'Winterize outdoor taps' });

      await s.updateItem(HID, checklist.id, only.id, UID, { is_completed: true });
      const state = await s.getChecklist(HID, checklist.id, UID);
      expect(state.progress).toBe(100);
      expect(state.completed_at).toBeTruthy();
    });

    it('persists notes and photo_keys on an item', async () => {
      const s = svc();
      const checklist = await s.createChecklist(HID, UID, { season: 'fall', year: YEAR, climate_zone: 'pacific_northwest' });
      const item = await s.addItem(HID, checklist.id, UID, { title: 'Inspect roof' });

      await s.updateItem(HID, checklist.id, item.id, UID, { notes: 'Minor moss on north side', photo_keys: ['roof/1.jpg', 'roof/2.jpg'] });
      const state = await s.getChecklist(HID, checklist.id, UID);
      const updated = state.items.find((i) => i.id === item.id);
      expect(updated?.notes).toBe('Minor moss on north side');
      expect(updated?.photo_keys).toEqual(['roof/1.jpg', 'roof/2.jpg']);
    });
  });

  describe('unimplemented custom-checklist surface (contract pin)', () => {
    // These route-facing methods are explicit stubs today; assert they still
    // reject so a real implementation lands with an intentional test update.
    it('deleteChecklist / getProgress / getCurrentInstance / completeItem / uncompleteItem / createDefaultChecklists throw Not implemented', async () => {
      const s = svc();
      await expect(s.deleteChecklist(HID, 'x', UID)).rejects.toThrow('Not implemented');
      await expect(s.getProgress(HID, UID)).rejects.toThrow('Not implemented');
      await expect(s.getCurrentInstance(HID, 'x', UID)).rejects.toThrow('Not implemented');
      await expect(s.completeItem(HID, 'i', 'it', UID)).rejects.toThrow('Not implemented');
      await expect(s.uncompleteItem(HID, 'i', 'it', UID)).rejects.toThrow('Not implemented');
      await expect(s.createDefaultChecklists(HID, UID)).rejects.toThrow('Not implemented');
    });
  });
});
