import { KAIZEN_TABLES } from '../../types';
import {
  applyServerChanges,
  clearDirtyFlags,
  completeActionToday,
  getDailyCoreActions,
  getDirtyChanges,
  getLastSyncAt,
  getProfile,
  listActive,
  setLastSyncAt,
  skipActionToday,
  softDelete,
  upsertLocal,
} from '../repository';
import { actionLogId } from '../seedId';

import { getFakeDb, resetFakeDb } from './helpers/fakeSqlite';


const mockMeta = new Map<string, string>();

jest.mock('../database', () => ({
  getKaizenDatabase: async () => require('./helpers/fakeSqlite').getFakeDb(),
  getMeta: async (key: string) => (mockMeta.has(key) ? mockMeta.get(key) : null),
  setMeta: async (key: string, value: string) => {
    mockMeta.set(key, value);
  },
  assertKaizenTable: (table: string) => {
    if (!require('../../types').KAIZEN_TABLES.includes(table)) {
      throw new Error(`Unknown Kaizen table: ${table}`);
    }
  },
}));

const baseTimestamps = { created_at: '2026-07-10T00:00:00.000Z', updated_at: '2026-07-10T00:00:00.000Z', deleted_at: null };

describe('kaizen repository', () => {
  beforeEach(() => {
    resetFakeDb();
    mockMeta.clear();
  });

  describe('upsertLocal', () => {
    it('inserts a row flagged dirty by default', async () => {
      await upsertLocal('kaizen_actions', { id: 'a1', user_id: 'u1', title: 'Weigh in', ...baseTimestamps });
      const rows = getFakeDb().rows('kaizen_actions');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: 'a1', title: 'Weigh in', dirty: 1 });
    });

    it('updates in place on id conflict and can persist non-dirty rows', async () => {
      await upsertLocal('kaizen_actions', { id: 'a1', user_id: 'u1', title: 'v1', ...baseTimestamps });
      await upsertLocal('kaizen_actions', { id: 'a1', user_id: 'u1', title: 'v2', ...baseTimestamps }, { dirty: false });
      const rows = getFakeDb().rows('kaizen_actions');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ title: 'v2', dirty: 0 });
    });

    it('rejects unknown tables', async () => {
      await expect(upsertLocal('bogus_table' as never, { id: 'x' })).rejects.toThrow(/Unknown Kaizen table/);
    });
  });

  describe('listActive', () => {
    it('returns only the user\'s non-deleted rows, newest updated first', async () => {
      await upsertLocal('kaizen_actions', { id: 'a1', user_id: 'u1', title: 'old', ...baseTimestamps, updated_at: '2026-07-01T00:00:00.000Z' });
      await upsertLocal('kaizen_actions', { id: 'a2', user_id: 'u1', title: 'new', ...baseTimestamps, updated_at: '2026-07-09T00:00:00.000Z' });
      await upsertLocal('kaizen_actions', { id: 'a3', user_id: 'u1', title: 'gone', ...baseTimestamps, deleted_at: '2026-07-05T00:00:00.000Z' });
      await upsertLocal('kaizen_actions', { id: 'a4', user_id: 'other', title: 'theirs', ...baseTimestamps });

      const rows = await listActive<{ id: string }>('kaizen_actions', 'u1');
      expect(rows.map(r => r.id)).toEqual(['a2', 'a1']);
    });
  });

  describe('dirty change tracking', () => {
    it('collects dirty rows per table with the dirty flag stripped', async () => {
      await upsertLocal('kaizen_actions', { id: 'a1', user_id: 'u1', title: 'dirty', ...baseTimestamps });
      await upsertLocal('kaizen_profiles', { id: 'p1', user_id: 'u1', ...baseTimestamps }, { dirty: false });

      const changes = await getDirtyChanges('u1');
      expect(Object.keys(changes)).toEqual(['kaizen_actions']);
      expect(changes.kaizen_actions).toHaveLength(1);
      expect(changes.kaizen_actions?.[0]).not.toHaveProperty('dirty');
      expect(changes.kaizen_actions?.[0]).toMatchObject({ id: 'a1' });
    });

    it('clearDirtyFlags resets the flag for the user only', async () => {
      await upsertLocal('kaizen_actions', { id: 'a1', user_id: 'u1', title: 'a', ...baseTimestamps });
      await upsertLocal('kaizen_actions', { id: 'a2', user_id: 'other', title: 'b', ...baseTimestamps });

      await clearDirtyFlags('u1');

      expect(await getDirtyChanges('u1')).toEqual({});
      expect(Object.keys(await getDirtyChanges('other'))).toEqual(['kaizen_actions']);
    });
  });

  describe('applyServerChanges', () => {
    it('upserts server rows as non-dirty across known tables', async () => {
      await applyServerChanges({
        kaizen_actions: [{ id: 'a1', user_id: 'u1', title: 'srv', ...baseTimestamps }],
        unknown_table: [{ id: 'z' }],
      } as never);

      const rows = getFakeDb().rows('kaizen_actions');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: 'a1', dirty: 0 });
      // Unknown tables are simply skipped, not created.
      expect(getFakeDb().tables.has('unknown_table')).toBe(false);
    });
  });

  describe('getProfile / getDailyCoreActions', () => {
    it('returns the first active profile or null', async () => {
      expect(await getProfile('u1')).toBeNull();
      await upsertLocal('kaizen_profiles', { id: 'p1', user_id: 'u1', ...baseTimestamps });
      expect(await getProfile('u1')).toMatchObject({ id: 'p1' });
    });

    it('returns non-archived daily-core actions for enabled systems, ordered by sort_order then title', async () => {
      await upsertLocal('kaizen_profiles', {
        id: 'p1',
        user_id: 'u1',
        enabled_systems: JSON.stringify(['career']),
        system_activation_states: JSON.stringify({ career: 'enabled' }),
        ...baseTimestamps,
      });
      const common = { user_id: 'u1', system: 'career', is_daily_core: 1, is_archived: 0, ...baseTimestamps };
      await upsertLocal('kaizen_actions', { id: 'a1', title: 'Bravo', sort_order: 1, ...common });
      await upsertLocal('kaizen_actions', { id: 'a2', title: 'Alpha', sort_order: 0, ...common });
      await upsertLocal('kaizen_actions', { id: 'a3', title: 'Archived', sort_order: 0, ...common, is_archived: 1 });
      await upsertLocal('kaizen_actions', { id: 'a4', title: 'NotCore', sort_order: 0, ...common, is_daily_core: 0 });

      const rows = await getDailyCoreActions('u1');
      expect(rows.map(r => r.id)).toEqual(['a2', 'a1']);
    });

    it('hides daily-core actions whose system is not enabled or is paused', async () => {
      await upsertLocal('kaizen_profiles', {
        id: 'p1',
        user_id: 'u1',
        enabled_systems: JSON.stringify(['career', 'health']),
        system_activation_states: JSON.stringify({ career: 'enabled', health: 'paused' }),
        ...baseTimestamps,
      });
      const common = { user_id: 'u1', is_daily_core: 1, is_archived: 0, ...baseTimestamps };
      await upsertLocal('kaizen_actions', { id: 'a-career', title: 'Deep work', sort_order: 0, system: 'career', ...common });
      await upsertLocal('kaizen_actions', { id: 'a-paused', title: 'Weigh in', sort_order: 1, system: 'health', ...common });
      await upsertLocal('kaizen_actions', { id: 'a-offsystem', title: 'Journal', sort_order: 2, system: 'mental', ...common });

      const rows = await getDailyCoreActions('u1');
      expect(rows.map(r => r.id)).toEqual(['a-career']);
    });

    it('returns nothing when the user has no profile / no enabled systems', async () => {
      await upsertLocal('kaizen_actions', {
        id: 'a1',
        user_id: 'u1',
        title: 'Weigh in',
        system: 'health',
        sort_order: 0,
        is_daily_core: 1,
        is_archived: 0,
        ...baseTimestamps,
      });
      expect(await getDailyCoreActions('u1')).toEqual([]);
    });
  });

  describe('completeActionToday / skipActionToday', () => {
    it('uses a deterministic per-day log id so double completion is idempotent', async () => {
      const now = new Date();
      await completeActionToday('u1', 'action-9', 'watch');
      await completeActionToday('u1', 'action-9', 'manual');

      const rows = getFakeDb().rows('kaizen_action_logs');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(actionLogId('action-9', now));
      expect(rows[0]).toMatchObject({ action_id: 'action-9', completed_at: expect.any(String), skipped: 0 });
    });

    it('records a skip with skipped = 1 and no completion', async () => {
      await skipActionToday('u1', 'action-9', 'notification');
      const rows = getFakeDb().rows('kaizen_action_logs');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action_id: 'action-9', skipped: 1, completed_at: null, source: 'notification' });
    });

    it('defaults the source to "manual" when omitted', async () => {
      await completeActionToday('u1', 'done-default');
      await skipActionToday('u1', 'skip-default');

      const rows = getFakeDb().rows('kaizen_action_logs');
      expect(rows.find(r => r.action_id === 'done-default')).toMatchObject({ source: 'manual', skipped: 0 });
      expect(rows.find(r => r.action_id === 'skip-default')).toMatchObject({ source: 'manual', skipped: 1 });
    });
  });

  describe('last-sync meta + softDelete', () => {
    it('delegates last sync to the meta store', async () => {
      expect(await getLastSyncAt()).toBeNull();
      await setLastSyncAt('2026-07-12T00:00:00.000Z');
      expect(await getLastSyncAt()).toBe('2026-07-12T00:00:00.000Z');
    });

    it('softDelete stamps deleted_at and marks the row dirty', async () => {
      await upsertLocal('kaizen_actions', { id: 'a1', user_id: 'u1', title: 'x', ...baseTimestamps }, { dirty: false });
      await softDelete('kaizen_actions', 'a1');
      const row = getFakeDb().rows('kaizen_actions')[0];
      expect(row.deleted_at).toEqual(expect.any(String));
      expect(row.dirty).toBe(1);
      expect(await listActive('kaizen_actions', 'u1')).toHaveLength(0);
    });
  });

  it('KAIZEN_TABLES sanity — covers all sync tables', () => {
    expect(KAIZEN_TABLES).toContain('kaizen_actions');
    expect(KAIZEN_TABLES.length).toBeGreaterThan(10);
  });
});
