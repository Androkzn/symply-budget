/**
 * HealthSyncService — the reconciliation engine behind `POST /health/sync/push`.
 *
 * routes/__tests__/health-sync.test.ts drives the HTTP contract (gate, auth,
 * envelope, the headline conflict cases). This suite owns the parts a route test
 * cannot reach cleanly:
 *   - the CLOCK: client stamps are persisted verbatim but NORMALISED to ISO-8601
 *     UTC, because `GET /sync` compares `updated_at` as TEXT — an offset stamp
 *     would sort wrong and fall out of every later pull;
 *   - the SKEW GUARD that stops a device with a broken clock pinning a row;
 *   - per-column validation (unknown columns dropped, wrong types refused, DB
 *     CHECK/FK violations degraded to one rejected row instead of a 500);
 *   - and three sweeps ACROSS ALL TWELVE collections — every one accepts a valid
 *     row, every one replays as `unchanged`, and every one refuses a foreign
 *     `user_id`. A sweep is the only way to prove no collection has a hole.
 *
 * D1-backed against live miniflare D1 with the migration-0119 DDL from
 * routes/__tests__/health-test-helpers.ts (same cross-directory helper pattern
 * as health-service.test.ts).
 */

import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createHealthTables,
  insertHealthRow,
  listHealthRows,
  readHealthRow,
  resetHealthTables,
  seedHealthUsers,
} from '../../routes/__tests__/health-test-helpers';
import type { Env } from '../../types';
import { HealthService } from '../health-service';
import {
  CLOCK_SKEW_TOLERANCE_MS,
  HealthSyncService,
  MAX_PUSH_ROWS,
  PUSH_COLLECTIONS,
  type PushCollection,
} from '../health-sync-service';

const testEnv = env as unknown as Env;
const db = () => testEnv.DB;

const UID = 'u_push_alice';
const OTHER = 'u_push_bob';

const DAY1 = '2026-06-01';
const DAY2 = '2026-06-02';

const T0 = '2026-06-01T10:00:00.000Z';
const T1 = '2026-06-01T11:00:00.000Z';
const T2 = '2026-06-01T12:00:00.000Z';

const HABIT = 'habit_owned';

function sync(): HealthSyncService {
  return new HealthSyncService(db());
}

function domain(): HealthService {
  return new HealthService(db());
}

/**
 * A minimal VALID row per collection — every NOT NULL column without a default,
 * and nothing else. Reused by the three cross-collection sweeps.
 */
const MINIMAL_ROWS: Record<PushCollection, Record<string, unknown>> = {
  habits: { id: 'p_habit', name: 'Walk', updated_at: T1 },
  habit_logs: { id: 'p_log', habit_id: HABIT, date: DAY1, completed_at: T1, updated_at: T1 },
  weight_entries: { id: 'p_w', date: DAY1, weight: 70, unit: 'kg', updated_at: T1 },
  water_entries: { id: 'p_h2o', date: DAY1, amount_ml: 250, updated_at: T1 },
  nutrition_entries: {
    id: 'p_n',
    date: DAY1,
    food_name: 'Egg',
    meal_type: 'breakfast',
    calories: 70,
    updated_at: T1,
  },
  body_measurements: { id: 'p_bm', date: DAY1, unit: 'cm', waist: 80, updated_at: T1 },
  health_entries: {
    id: 'p_he',
    date: DAY1,
    entry_type: 'steps',
    data: '{"steps":8000}',
    source: 'manual',
    updated_at: T1,
  },
  cycle_settings: { id: 'p_cyset', updated_at: T1 },
  period_entries: { id: 'p_per', date: DAY1, updated_at: T1 },
  cycle_symptom_entries: { id: 'p_sym', date: DAY1, updated_at: T1 },
  mens_health_entries: { id: 'p_mh', date: DAY1, updated_at: T1 },
  health_goals: { id: 'p_goal', effective_date: DAY1, updated_at: T1 },
};

/** Physical table behind each collection — for "what actually landed" reads. */
const TABLE_OF: Record<PushCollection, string> = {
  habits: 'user_habits',
  habit_logs: 'habit_logs',
  weight_entries: 'weight_entries',
  water_entries: 'water_entries',
  nutrition_entries: 'nutrition_entries',
  body_measurements: 'body_measurements',
  health_entries: 'health_entries',
  cycle_settings: 'cycle_settings',
  period_entries: 'period_entries',
  cycle_symptom_entries: 'cycle_symptom_entries',
  mens_health_entries: 'mens_health_entries',
  health_goals: 'health_goals',
};

function seedOwnedHabit(userId = UID, id = HABIT) {
  return insertHealthRow(db(), 'user_habits', {
    id,
    user_id: userId,
    name: 'Stretch',
    icon: 'goals',
    category: 'custom',
    time_of_day: 'anytime',
    frequency: 'daily',
    is_archived: 0,
    sort_order: 0,
    created_at: T0,
    updated_at: T0,
    deleted_at: null,
  });
}

describe('HealthSyncService.push', () => {
  beforeEach(async () => {
    await createHealthTables(db());
    await resetHealthTables(db());
    await seedHealthUsers(db(), [UID, OTHER]);
  });

  /* ================== cross-collection sweeps ======================== */

  describe('every collection', () => {
    beforeEach(() => seedOwnedHabit());

    it('accepts a minimal valid row and binds it to the caller', async () => {
      const failures: string[] = [];
      for (const collection of PUSH_COLLECTIONS) {
        const row = MINIMAL_ROWS[collection];
        const res = await sync().push(UID, { [collection]: [row] });
        const verdict = res.results[collection]?.[0];
        if (verdict?.status !== 'applied' || verdict.action !== 'inserted') {
          failures.push(`${collection} -> ${verdict?.status}:${verdict?.reason ?? ''}`);
          continue;
        }
        const stored = await readHealthRow<{ user_id: string; updated_at: string }>(
          db(),
          TABLE_OF[collection],
          String(row.id)
        );
        if (stored?.user_id !== UID) failures.push(`${collection} -> user_id ${stored?.user_id}`);
        if (stored?.updated_at !== T1) failures.push(`${collection} -> stamp ${stored?.updated_at}`);
      }
      expect(failures).toEqual([]);
    });

    it('replays every collection as `unchanged` without a second write', async () => {
      const batch = Object.fromEntries(
        PUSH_COLLECTIONS.map((c) => [c, [MINIMAL_ROWS[c]]])
      ) as Record<string, Array<Record<string, unknown>>>;

      const first = await sync().push(UID, batch);
      expect(first.summary).toMatchObject({ total: PUSH_COLLECTIONS.length, applied: PUSH_COLLECTIONS.length });

      const before = await Promise.all(
        PUSH_COLLECTIONS.map((c) => listHealthRows(db(), TABLE_OF[c]))
      );
      const second = await sync().push(UID, batch);
      expect(second.summary).toMatchObject({
        total: PUSH_COLLECTIONS.length,
        applied: 0,
        unchanged: PUSH_COLLECTIONS.length,
      });
      const after = await Promise.all(
        PUSH_COLLECTIONS.map((c) => listHealthRows(db(), TABLE_OF[c]))
      );
      expect(after).toEqual(before);
    });

    it('refuses a foreign user_id in EVERY collection and writes nothing', async () => {
      const failures: string[] = [];
      for (const collection of PUSH_COLLECTIONS) {
        const res = await sync().push(UID, {
          [collection]: [{ ...MINIMAL_ROWS[collection], user_id: OTHER }],
        });
        const verdict = res.results[collection]?.[0];
        if (verdict?.status !== 'forbidden' || verdict.reason !== 'foreign_user_id') {
          failures.push(`${collection} -> ${verdict?.status}:${verdict?.reason ?? ''}`);
        }
        const rows = await listHealthRows(db(), TABLE_OF[collection]);
        // user_habits already holds the seeded habit; nothing else may appear.
        const expected = TABLE_OF[collection] === 'user_habits' ? 1 : 0;
        if (rows.length !== expected) failures.push(`${collection} -> ${rows.length} rows`);
      }
      expect(failures).toEqual([]);
    });
  });

  /* ================== the conflict clock ============================= */

  describe('the conflict clock', () => {
    it('persists the CLIENT stamp rather than server now', async () => {
      // Stamping server `now` would turn last-write-wins into "last PUSH wins":
      // a device syncing after a week offline would clobber yesterday's edits.
      await sync().push(UID, { weight_entries: [MINIMAL_ROWS.weight_entries] });
      const stored = await readHealthRow<{ updated_at: string; created_at: string }>(
        db(),
        'weight_entries',
        'p_w'
      );
      expect(stored?.updated_at).toBe(T1);
      expect(stored?.created_at).toBe(T1);
    });

    it('normalises an offset stamp to UTC so the pull TEXT comparison still works', async () => {
      // `GET /sync` filters `updated_at >= since` as TEXT. '…T12:00:00+02:00'
      // stored verbatim sorts AFTER '…T99…' style stamps and would silently drop
      // out of every later pull.
      await sync().push(UID, {
        weight_entries: [
          { ...MINIMAL_ROWS.weight_entries, updated_at: '2026-06-01T12:00:00+02:00' },
        ],
      });
      const stored = await readHealthRow<{ updated_at: string }>(db(), 'weight_entries', 'p_w');
      expect(stored?.updated_at).toBe('2026-06-01T10:00:00.000Z');

      const pulled = await domain().sync(UID, '2026-06-01T10:00:00.000Z');
      expect(pulled.weight_entries.map((r) => r.id)).toEqual(['p_w']);
    });

    it('normalises a second-precision stamp to millisecond ISO', async () => {
      await sync().push(UID, {
        weight_entries: [{ ...MINIMAL_ROWS.weight_entries, updated_at: '2026-06-01T11:00:00Z' }],
      });
      expect(
        (await readHealthRow<{ updated_at: string }>(db(), 'weight_entries', 'p_w'))?.updated_at
      ).toBe(T1);
    });

    it('treats two spellings of the same instant as EQUAL, not as a newer write', async () => {
      await sync().push(UID, { weight_entries: [MINIMAL_ROWS.weight_entries] });
      const res = await sync().push(UID, {
        weight_entries: [
          { ...MINIMAL_ROWS.weight_entries, weight: 99, updated_at: '2026-06-01T13:00:00+02:00' },
        ],
      });
      expect(res.results.weight_entries?.[0].status).toBe('unchanged');
      expect(await readHealthRow(db(), 'weight_entries', 'p_w')).toMatchObject({ weight: 70 });
    });

    it('normalises a tombstone stamp too', async () => {
      await sync().push(UID, { weight_entries: [MINIMAL_ROWS.weight_entries] });
      await sync().push(UID, {
        weight_entries: [
          {
            ...MINIMAL_ROWS.weight_entries,
            updated_at: T2,
            deleted_at: '2026-06-01T14:00:00+02:00',
          },
        ],
      });
      expect(await readHealthRow(db(), 'weight_entries', 'p_w')).toMatchObject({
        deleted_at: '2026-06-01T12:00:00.000Z',
      });
    });

    it('refuses a stamp beyond the skew tolerance so a broken clock cannot pin a row', async () => {
      const far = new Date(Date.now() + CLOCK_SKEW_TOLERANCE_MS + 60_000).toISOString();
      const res = await sync().push(UID, {
        weight_entries: [{ ...MINIMAL_ROWS.weight_entries, updated_at: far }],
      });
      expect(res.results.weight_entries?.[0]).toMatchObject({
        status: 'invalid',
        reason: 'future_updated_at',
      });
      expect(await listHealthRows(db(), 'weight_entries')).toEqual([]);
    });

    it('tolerates a small forward skew', async () => {
      const near = new Date(Date.now() + 30_000).toISOString();
      const res = await sync().push(UID, {
        weight_entries: [{ ...MINIMAL_ROWS.weight_entries, updated_at: near }],
      });
      expect(res.results.weight_entries?.[0].status).toBe('applied');
    });

    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['unparseable', 'yesterday'],
      ['not a string', 1_780_000_000_000],
    ])('rejects a %s updated_at', async (_label, value) => {
      const row = { ...MINIMAL_ROWS.weight_entries, updated_at: value };
      if (value === undefined) delete row.updated_at;
      const res = await sync().push(UID, { weight_entries: [row] });
      expect(res.results.weight_entries?.[0]).toMatchObject({
        status: 'invalid',
        reason: 'invalid_updated_at',
      });
      expect(await listHealthRows(db(), 'weight_entries')).toEqual([]);
    });

    it('rejects an unparseable deleted_at rather than treating it as a live row', async () => {
      const res = await sync().push(UID, {
        weight_entries: [{ ...MINIMAL_ROWS.weight_entries, deleted_at: 'soon' }],
      });
      expect(res.results.weight_entries?.[0]).toMatchObject({
        status: 'invalid',
        reason: 'invalid_deleted_at',
      });
    });
  });

  /* ================== per-column validation ========================== */

  describe('row validation', () => {
    it('drops columns this build does not have instead of failing the row', async () => {
      // Forward compatibility: a newer client may carry fields an older Worker
      // has no column for. Refusing the row would strand the whole device.
      const res = await sync().push(UID, {
        weight_entries: [
          { ...MINIMAL_ROWS.weight_entries, body_fat_percentage: 18.2, made_up: 'x' },
        ],
      });
      expect(res.results.weight_entries?.[0].status).toBe('applied');
      expect(await readHealthRow(db(), 'weight_entries', 'p_w')).toMatchObject({ weight: 70 });
    });

    it('refuses a known column with the wrong type', async () => {
      const res = await sync().push(UID, {
        weight_entries: [{ ...MINIMAL_ROWS.weight_entries, weight: '70' }],
      });
      expect(res.results.weight_entries?.[0]).toMatchObject({
        status: 'invalid',
        reason: 'invalid_field:weight',
      });
      expect(await listHealthRows(db(), 'weight_entries')).toEqual([]);
    });

    it('refuses null in a NOT NULL column', async () => {
      const res = await sync().push(UID, {
        weight_entries: [{ ...MINIMAL_ROWS.weight_entries, unit: null }],
      });
      expect(res.results.weight_entries?.[0]).toMatchObject({
        status: 'invalid',
        reason: 'invalid_field:unit',
      });
    });

    it('names the missing required column on an insert', async () => {
      const row = { ...MINIMAL_ROWS.weight_entries };
      delete row.unit;
      const res = await sync().push(UID, { weight_entries: [row] });
      expect(res.results.weight_entries?.[0]).toMatchObject({
        status: 'invalid',
        reason: 'missing_field:unit',
      });
    });

    it('accepts a partial UPDATE — an omitted column keeps its stored value', async () => {
      await sync().push(UID, {
        weight_entries: [{ ...MINIMAL_ROWS.weight_entries, note: 'morning' }],
      });
      const res = await sync().push(UID, {
        weight_entries: [{ id: 'p_w', weight: 69, updated_at: T2 }],
      });
      expect(res.results.weight_entries?.[0].status).toBe('applied');
      expect(await readHealthRow(db(), 'weight_entries', 'p_w')).toMatchObject({
        weight: 69,
        note: 'morning',
        unit: 'kg',
        date: DAY1,
      });
    });

    it('takes booleans as true/false OR as the 0/1 a SQLite round trip produces', async () => {
      const res = await sync().push(UID, {
        habits: [
          { id: 'h_bool_a', name: 'A', reminder_enabled: true, is_archived: 0, updated_at: T1 },
          { id: 'h_bool_b', name: 'B', reminder_enabled: 1, is_archived: false, updated_at: T1 },
        ],
      });
      expect(res.results.habits?.map((r) => r.status)).toEqual(['applied', 'applied']);
      expect(await readHealthRow(db(), 'user_habits', 'h_bool_a')).toMatchObject({
        reminder_enabled: 1,
        is_archived: 0,
      });
      expect(await readHealthRow(db(), 'user_habits', 'h_bool_b')).toMatchObject({
        reminder_enabled: 1,
        is_archived: 0,
      });
    });

    it('rejects a non-object row instead of throwing', async () => {
      const res = await sync().push(UID, { weight_entries: ['nope', null, []] });
      expect(res.results.weight_entries?.map((r) => r.reason)).toEqual([
        'not_an_object',
        'not_an_object',
        'not_an_object',
      ]);
      expect(res.summary).toMatchObject({ total: 3, invalid: 3 });
    });

    it('degrades a database CHECK violation to ONE rejected row, not a failed batch', async () => {
      const res = await sync().push(UID, {
        health_entries: [
          { ...MINIMAL_ROWS.health_entries, id: 'he_bad', entry_type: 'telepathy' },
          { ...MINIMAL_ROWS.health_entries, id: 'he_ok' },
        ],
      });
      expect(res.results.health_entries?.map((r) => `${r.status}:${r.reason ?? ''}`)).toEqual([
        'invalid:write_rejected',
        'applied:',
      ]);
      expect(await listHealthRows(db(), 'health_entries')).toHaveLength(1);
    });

    it('mints a server id when the client sends a row without one', async () => {
      const row = { ...MINIMAL_ROWS.weight_entries };
      delete row.id;
      const res = await sync().push(UID, { weight_entries: [row] });
      const verdict = res.results.weight_entries?.[0];
      expect(verdict).toMatchObject({ index: 0, id: null, status: 'applied', action: 'inserted' });
      expect(verdict?.server_id).toMatch(/^w_/);
      expect(await listHealthRows(db(), 'weight_entries')).toHaveLength(1);
    });
  });

  /* ================== conflict semantics ============================= */

  describe('conflict semantics', () => {
    it('keeps created_at from the payload on insert and never rewrites it on update', async () => {
      await sync().push(UID, {
        weight_entries: [{ ...MINIMAL_ROWS.weight_entries, created_at: T0 }],
      });
      expect(await readHealthRow(db(), 'weight_entries', 'p_w')).toMatchObject({ created_at: T0 });

      await sync().push(UID, {
        weight_entries: [{ ...MINIMAL_ROWS.weight_entries, created_at: T2, updated_at: T2 }],
      });
      expect(await readHealthRow(db(), 'weight_entries', 'p_w')).toMatchObject({
        created_at: T0,
        updated_at: T2,
      });
    });

    it('never renumbers a merged row — the SERVER id survives a natural-key push', async () => {
      // Rewriting the id (what the donor's `id = excluded.id` upsert does) would
      // orphan every other device's local copy of that row.
      await insertHealthRow(db(), 'period_entries', {
        id: 'srv_per',
        user_id: UID,
        date: DAY1,
        flow_level: 3,
        notes: null,
        created_at: T0,
        updated_at: T0,
        deleted_at: null,
      });
      const res = await sync().push(UID, {
        period_entries: [{ id: 'dev_per', date: DAY1, flow_level: 5, updated_at: T2 }],
      });
      expect(res.results.period_entries?.[0]).toMatchObject({
        id: 'dev_per',
        server_id: 'srv_per',
        status: 'applied',
      });
      expect(await readHealthRow(db(), 'period_entries', 'dev_per')).toBeNull();
      expect(await readHealthRow(db(), 'period_entries', 'srv_per')).toMatchObject({
        flow_level: 5,
      });
    });

    it('merges two devices writing the SAME day slot inside one batch', async () => {
      const res = await sync().push(UID, {
        cycle_symptom_entries: [
          { id: 'dev1', date: DAY1, mood: 3, updated_at: T1 },
          { id: 'dev2', date: DAY1, mood: 5, updated_at: T2 },
        ],
      });
      expect(res.results.cycle_symptom_entries?.map((r) => r.status)).toEqual([
        'applied',
        'applied',
      ]);
      // The second row must MERGE into the first, not trip UNIQUE(user_id, date).
      expect(await listHealthRows(db(), 'cycle_symptom_entries')).toHaveLength(1);
      expect(await readHealthRow(db(), 'cycle_symptom_entries', 'dev1')).toMatchObject({ mood: 5 });
    });

    it('applies the LATER of two writes to the same row in one batch, whatever the order', async () => {
      const res = await sync().push(UID, {
        weight_entries: [
          { ...MINIMAL_ROWS.weight_entries, weight: 80, updated_at: T2 },
          { ...MINIMAL_ROWS.weight_entries, weight: 60, updated_at: T1 },
        ],
      });
      expect(res.results.weight_entries?.map((r) => r.status)).toEqual(['applied', 'stale']);
      expect(await readHealthRow(db(), 'weight_entries', 'p_w')).toMatchObject({ weight: 80 });
    });

    it('lets a NEWER edit beat an older delete — tombstones win TIES, not everything', async () => {
      // The mirror of the tie rule: if the delete is genuinely older, the row is
      // alive again, exactly as last-write-wins says.
      await sync().push(UID, { weight_entries: [{ ...MINIMAL_ROWS.weight_entries, updated_at: T2 }] });
      const res = await sync().push(UID, {
        weight_entries: [{ ...MINIMAL_ROWS.weight_entries, updated_at: T1, deleted_at: T1 }],
      });
      expect(res.results.weight_entries?.[0].status).toBe('stale');
      expect(await readHealthRow(db(), 'weight_entries', 'p_w')).toMatchObject({
        deleted_at: null,
        updated_at: T2,
      });
    });

    it('ignores deleted_at on a table that has no tombstone column', async () => {
      // cycle_settings / health_goals are singletons the donor never soft-deletes;
      // a stray deleted_at must not become a column write.
      const res = await sync().push(UID, {
        health_goals: [
          { id: 'g_1', effective_date: DAY1, daily_calories: 2400, deleted_at: T2, updated_at: T1 },
        ],
      });
      expect(res.results.health_goals?.[0].status).toBe('applied');
      expect(await readHealthRow(db(), 'health_goals', 'g_1')).toMatchObject({
        daily_calories: 2400,
      });
    });

    it('hides a pushed tombstone from the domain read path', async () => {
      await seedOwnedHabit();
      await sync().push(UID, {
        habits: [{ id: HABIT, name: 'Stretch', updated_at: T2, deleted_at: T2 }],
      });
      // Soft delete: gone from the list, still on the wire for other devices.
      expect(await domain().listHabits(UID)).toEqual([]);
      expect((await domain().sync(UID, T0)).habits).toHaveLength(1);
    });

    it('reports a rejected row status without touching the stored row at all', async () => {
      await insertHealthRow(db(), 'weight_entries', {
        id: 'p_w',
        user_id: UID,
        date: DAY2,
        weight: 88,
        unit: 'lb',
        note: 'server truth',
        created_at: T0,
        updated_at: T2,
        deleted_at: null,
      });
      const before = await readHealthRow(db(), 'weight_entries', 'p_w');
      const res = await sync().push(UID, { weight_entries: [MINIMAL_ROWS.weight_entries] });
      expect(res.results.weight_entries?.[0]).toMatchObject({
        status: 'stale',
        server_updated_at: T2,
      });
      expect(await readHealthRow(db(), 'weight_entries', 'p_w')).toEqual(before);
    });
  });

  /* ================== response envelope ============================== */

  describe('response envelope', () => {
    it('returns a fresh server_time cursor for the next pull', async () => {
      const before = Date.now();
      const res = await sync().push(UID, {});
      const cursor = Date.parse(res.server_time);
      expect(cursor).toBeGreaterThanOrEqual(before - 1000);
      expect(res.server_time).toBe(new Date(cursor).toISOString());
    });

    it('defaults to an empty batch and returns no result keys', async () => {
      const res = await sync().push(UID);
      expect(res.results).toEqual({});
      expect(res.unsupported).toEqual([]);
      expect(res.summary.total).toBe(0);
    });

    it('reports unknown collections but still processes the known ones', async () => {
      const res = await sync().push(UID, {
        recipes: [{ id: 'r1', updated_at: T1 }],
        custom_foods: [{ id: 'c1', updated_at: T1 }],
        weight_entries: [MINIMAL_ROWS.weight_entries],
      });
      expect(res.unsupported.sort()).toEqual(['custom_foods', 'recipes']);
      expect(res.results.weight_entries?.[0].status).toBe('applied');
    });

    it('does not report an EMPTY unknown collection as unsupported', async () => {
      const res = await sync().push(UID, { recipes: [] });
      expect(res.unsupported).toEqual([]);
    });

    it('indexes every result by its position in the pushed array', async () => {
      const res = await sync().push(UID, {
        weight_entries: [
          { ...MINIMAL_ROWS.weight_entries, id: 'a' },
          { ...MINIMAL_ROWS.weight_entries, id: 'b', weight: 'nope' },
          { ...MINIMAL_ROWS.weight_entries, id: 'c' },
        ],
      });
      expect(res.results.weight_entries?.map((r) => [r.index, r.id, r.status])).toEqual([
        [0, 'a', 'applied'],
        [1, 'b', 'invalid'],
        [2, 'c', 'applied'],
      ]);
    });

    it('keeps a batch cap the route can enforce', () => {
      expect(MAX_PUSH_ROWS).toBeGreaterThan(0);
      expect(PUSH_COLLECTIONS).toHaveLength(12);
      // Parents must be reconciled before their children or the FK fails.
      expect(PUSH_COLLECTIONS.indexOf('habits')).toBeLessThan(
        PUSH_COLLECTIONS.indexOf('habit_logs')
      );
    });
  });
});
