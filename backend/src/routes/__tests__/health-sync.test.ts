/**
 * `POST /health/sync/push` — the WRITE half of the Symply Health sync contract,
 * driven through the real Hono router against a live miniflare D1.
 *
 * The pull (`GET /sync`) is covered in health.test.ts; this suite owns the
 * reconciliation, in the order the properties matter:
 *   1. BRAND GATE + AUTH — the push surface must 404 on House/Budget/Kaizen and
 *      401 without a bearer, exactly like every other health path.
 *   2. USER SCOPING — the highest-value spec here. A pushed row carrying another
 *      user's `user_id`, aimed at another user's row id, or (worst) pointing at
 *      another user's `habit_id` (whose UNIQUE key has NO user column) must be
 *      rejected outright and leave that row byte-identical.
 *   3. LAST-WRITE-WINS PER ROW — a stale row is refused while its neighbours in
 *      the same batch apply, and the client is told which is which.
 *   4. TOMBSTONE PRECEDENCE — a delete racing an edit at the same instant must
 *      not resurrect the row.
 *   5. IDEMPOTENCY — a replayed push writes nothing and duplicates nothing.
 *   6. NATURAL-KEY MERGE — the per-(user, date) tables reconcile on the day
 *      slot, so a second device that invented its own id merges into the
 *      existing row instead of tripping the UNIQUE index.
 *
 * Harness mirrors health.test.ts: `cloudflare:test` env, a jose HS256 JWT whose
 * `sub` becomes the user id, brand flipped by spreading a new APP_BRAND onto the
 * pool env, and DDL from the shared health-test-helpers.
 *
 * Fixtures are inserted as RAW ROWS (insertHealthRow) rather than through the
 * domain API on purpose: every service writer stamps `new Date()`, so "the
 * server row is an hour newer than the one this device is pushing" — the exact
 * situation the whole contract exists for — is not expressible through it.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import healthRoutes from '../health';

import {
  createHealthTables,
  insertHealthRow,
  listHealthRows,
  readHealthRow,
  resetHealthTables,
  seedHealthUsers,
} from './health-test-helpers';

const testEnv = env as unknown as Env;

const HEALTH_ENV = { ...testEnv, APP_BRAND: 'symply-health' } as Env;
const HOUSE_ENV = { ...testEnv, APP_BRAND: 'symply-house' } as Env;
const BUDGET_ENV = { ...testEnv, APP_BRAND: 'symply-budget' } as Env;
const KAIZEN_ENV = { ...testEnv, APP_BRAND: 'symply-kaizen' } as Env;

const UID_A = 'u_sync_alice';
const UID_B = 'u_sync_bob';

const DAY1 = '2026-06-01';
const DAY2 = '2026-06-02';

/** Three fixed instants an hour apart — the whole conflict matrix needs no clock. */
const T0 = '2026-06-01T10:00:00.000Z';
const T1 = '2026-06-01T11:00:00.000Z';
const T2 = '2026-06-01T12:00:00.000Z';

async function mintToken(userId: string, secretOverride?: string): Promise<string> {
  const secret = new TextEncoder().encode(
    secretOverride ?? testEnv.JWT_SECRET ?? 'test-jwt-secret-32-chars-minimum'
  );
  return new jose.SignJWT({
    sub: userId,
    email: `${userId}@example.com`,
    email_verified: true,
  } as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .setIssuer(testEnv.JWT_ISSUER || 'simple-house')
    .setAudience(testEnv.JWT_AUDIENCE || 'simple-house-app')
    .sign(secret);
}

/** Mirrors the `app.route('/health', healthRoutes)` mount in src/index.ts. */
function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/health', healthRoutes);
  return app;
}

let tokenA = '';
let tokenB = '';

async function call(
  method: string,
  path: string,
  opts: { token?: string | null; body?: unknown; brandEnv?: Env } = {}
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = opts.token === undefined ? tokenA : opts.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  return mkApp().request(
    `/health${path}`,
    {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    },
    opts.brandEnv ?? HEALTH_ENV
  );
}

interface RowResult {
  index: number;
  id: string | null;
  server_id: string | null;
  status: string;
  action?: string;
  reason?: string;
  server_updated_at?: string;
}

interface PushBody {
  server_time: string;
  summary: Record<string, number>;
  results: Record<string, RowResult[]>;
  unsupported: string[];
}

type Changes = Record<string, Array<Record<string, unknown>>>;

async function push(
  changes: Changes,
  opts: { token?: string | null; brandEnv?: Env } = {}
): Promise<Response> {
  return call('POST', '/sync/push', { ...opts, body: { changes } });
}

async function pushOk(
  changes: Changes,
  opts: { token?: string | null } = {}
): Promise<PushBody> {
  const res = await push(changes, opts);
  expect(res.status).toBe(200);
  return (await res.json()) as PushBody;
}

/** Only the fields a conflict spec cares about. */
function only(result: RowResult): Record<string, unknown> {
  return { status: result.status, action: result.action, reason: result.reason };
}

const db = () => testEnv.DB;

/* -------------------------- raw row fixtures -------------------------- */

function seedWeight(userId: string, id: string, updatedAt: string, weight = 70) {
  return insertHealthRow(db(), 'weight_entries', {
    id,
    user_id: userId,
    date: DAY1,
    weight,
    unit: 'kg',
    note: null,
    created_at: T0,
    updated_at: updatedAt,
    deleted_at: null,
  });
}

function seedHabit(userId: string, id: string) {
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

function seedHabitLog(userId: string, id: string, habitId: string, updatedAt: string) {
  return insertHealthRow(db(), 'habit_logs', {
    id,
    user_id: userId,
    habit_id: habitId,
    date: DAY1,
    time_of_day: 'anytime',
    completed_at: T0,
    duration: null,
    notes: null,
    created_at: T0,
    updated_at: updatedAt,
    deleted_at: null,
  });
}

describe('health sync push routes', () => {
  beforeEach(async () => {
    await createHealthTables(db());
    await resetHealthTables(db());
    await seedHealthUsers(db(), [UID_A, UID_B]);
    tokenA = await mintToken(UID_A);
    tokenB = await mintToken(UID_B);
  });

  /* ===================== 1. BRAND GATE + AUTH ======================== */

  describe('brand gate + auth', () => {
    it.each([
      ['symply-house', HOUSE_ENV],
      ['symply-budget', BUDGET_ENV],
      ['symply-kaizen', KAIZEN_ENV],
    ])('404s the push surface on %s and writes nothing', async (_brand, brandEnv) => {
      const res = await push(
        { weight_entries: [{ id: 'w_x', date: DAY1, weight: 70, unit: 'kg', updated_at: T1 }] },
        { token: tokenA, brandEnv }
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } });
      expect(await listHealthRows(db(), 'weight_entries')).toEqual([]);
    });

    it('gates BEFORE auth — a tokenless wrong-brand push 404s, never 401s', async () => {
      // A 401 would confirm the surface exists on that Worker.
      const res = await push({}, { token: null, brandEnv: BUDGET_ENV });
      expect(res.status).toBe(404);
    });

    it('401s without a bearer, and with a token signed by the wrong secret', async () => {
      expect((await push({}, { token: null })).status).toBe(401);
      const forged = await mintToken(UID_A, 'an-attacker-secret-32-chars-minimum');
      expect((await push({}, { token: forged })).status).toBe(401);
    });

    it('is reachable on symply-health', async () => {
      expect((await push({})).status).toBe(200);
    });
  });

  /* ===================== 2. EMPTY BATCH / ENVELOPE =================== */

  describe('envelope', () => {
    it('accepts an empty batch as a no-op and still returns a cursor', async () => {
      // The client polls push even with nothing dirty; it must still get the
      // cursor for its next pull rather than a 400.
      const res = await call('POST', '/sync/push', { body: {} });
      expect(res.status).toBe(200);
      const body = (await res.json()) as PushBody;
      expect(body.results).toEqual({});
      expect(body.unsupported).toEqual([]);
      expect(body.summary).toEqual({
        total: 0,
        applied: 0,
        unchanged: 0,
        stale: 0,
        tombstoned: 0,
        forbidden: 0,
        invalid: 0,
      });
      expect(Number.isFinite(Date.parse(body.server_time))).toBe(true);
    });

    it('treats an empty changes map and empty arrays as the same no-op', async () => {
      const explicit = await pushOk({});
      expect(explicit.summary.total).toBe(0);
      const emptyArrays = await pushOk({ weight_entries: [], period_entries: [] });
      expect(emptyArrays.results).toEqual({});
      expect(emptyArrays.summary.total).toBe(0);
    });

    it('reports an unknown collection instead of silently dropping it', async () => {
      // A newer client pushing a table this build has no writer for must keep
      // those rows DIRTY — silently accepting them would lose the data.
      const body = await pushOk({
        injuries: [{ id: 'inj_1', updated_at: T1 }],
        weight_entries: [{ id: 'w_1', date: DAY1, weight: 70, unit: 'kg', updated_at: T1 }],
      });
      expect(body.unsupported).toEqual(['injuries']);
      expect(body.results.injuries).toBeUndefined();
      expect(body.results.weight_entries[0].status).toBe('applied');
    });

    it('400s a batch over the row cap', async () => {
      const rows = Array.from({ length: 501 }, (_, i) => ({
        id: `w_${i}`,
        date: DAY1,
        weight: 70,
        unit: 'kg',
        updated_at: T1,
      }));
      const res = await push({ weight_entries: rows });
      expect(res.status).toBe(400);
      expect(await listHealthRows(db(), 'weight_entries')).toEqual([]);
    });

    it('400s a malformed envelope', async () => {
      const res = await call('POST', '/sync/push', { body: { changes: { weight_entries: 'nope' } } });
      expect(res.status).toBe(400);
    });
  });

  /* ===================== 3. USER SCOPING ============================= */

  describe('user scoping (the security property)', () => {
    it('rejects a row carrying another user id and writes NOTHING', async () => {
      const body = await pushOk({
        weight_entries: [
          { id: 'w_attack', user_id: UID_B, date: DAY1, weight: 99, unit: 'kg', updated_at: T2 },
        ],
      });
      expect(body.results.weight_entries).toEqual([
        { index: 0, id: 'w_attack', server_id: null, status: 'forbidden', reason: 'foreign_user_id' },
      ]);
      expect(body.summary).toMatchObject({ total: 1, forbidden: 1, applied: 0 });
      // Not written under B, and not quietly re-homed under A either.
      expect(await listHealthRows(db(), 'weight_entries')).toEqual([]);
    });

    it('cannot clobber another user row by pushing its id — the row survives untouched', async () => {
      await seedWeight(UID_B, 'w_bob', T0, 70);
      const before = await readHealthRow(db(), 'weight_entries', 'w_bob');

      const body = await pushOk({
        weight_entries: [{ id: 'w_bob', date: DAY1, weight: 999, unit: 'kg', updated_at: T2 }],
      });
      expect(only(body.results.weight_entries[0])).toEqual({
        status: 'forbidden',
        action: undefined,
        reason: 'foreign_row',
      });
      // Byte-identical: a NEWER timestamp must not buy write access.
      expect(await readHealthRow(db(), 'weight_entries', 'w_bob')).toEqual(before);
      expect(await listHealthRows(db(), 'weight_entries')).toHaveLength(1);
    });

    it('cannot reach another user day-slot through a natural-key push', async () => {
      await insertHealthRow(db(), 'period_entries', {
        id: 'per_bob',
        user_id: UID_B,
        date: DAY1,
        flow_level: 3,
        notes: 'bob',
        created_at: T0,
        updated_at: T0,
        deleted_at: null,
      });

      // A pushes the SAME (date) slot: the key is (user_id, date) and user_id is
      // bound to the token, so this creates A's own row, never B's.
      const body = await pushOk({
        period_entries: [{ id: 'per_dev', date: DAY1, flow_level: 5, updated_at: T2 }],
      });
      expect(body.results.period_entries[0].status).toBe('applied');

      const bob = await readHealthRow<{ flow_level: number; notes: string }>(
        db(),
        'period_entries',
        'per_bob'
      );
      expect(bob).toMatchObject({ flow_level: 3, notes: 'bob' });
      const rows = await listHealthRows<{ user_id: string }>(db(), 'period_entries');
      expect(rows.map((r) => r.user_id).sort()).toEqual([UID_A, UID_B]);
    });

    it('cannot overwrite another user habit log through the (habit_id, date) key', async () => {
      // habit_logs is UNIQUE on (habit_id, date) with NO user column in the key,
      // so an unchecked natural-key upsert would write straight into B's lane.
      await seedHabit(UID_B, 'habit_bob');
      await seedHabitLog(UID_B, 'hlog_bob', 'habit_bob', T0);
      const before = await readHealthRow(db(), 'habit_logs', 'hlog_bob');

      const body = await pushOk({
        habit_logs: [
          { id: 'hlog_x', habit_id: 'habit_bob', date: DAY1, completed_at: T2, updated_at: T2 },
        ],
      });
      expect(only(body.results.habit_logs[0])).toEqual({
        status: 'forbidden',
        action: undefined,
        reason: 'foreign_habit',
      });
      expect(await readHealthRow(db(), 'habit_logs', 'hlog_bob')).toEqual(before);
      expect(await listHealthRows(db(), 'habit_logs')).toHaveLength(1);
    });

    it('rejects a habit log whose habit does not exist at all', async () => {
      const body = await pushOk({
        habit_logs: [
          { id: 'hlog_x', habit_id: 'habit_ghost', date: DAY1, completed_at: T2, updated_at: T2 },
        ],
      });
      // An unknown FK target would otherwise 500 on the constraint.
      expect(only(body.results.habit_logs[0])).toEqual({
        status: 'invalid',
        action: undefined,
        reason: 'unknown_habit',
      });
      expect(await listHealthRows(db(), 'habit_logs')).toEqual([]);
    });

    it('binds every accepted row to the token user, whatever the payload said', async () => {
      const body = await pushOk({
        weight_entries: [
          { id: 'w_ok', user_id: UID_A, date: DAY1, weight: 71, unit: 'kg', updated_at: T1 },
        ],
      });
      expect(body.results.weight_entries[0].status).toBe('applied');
      expect(await readHealthRow(db(), 'weight_entries', 'w_ok')).toMatchObject({
        user_id: UID_A,
      });
    });
  });

  /* ===================== 4. LAST-WRITE-WINS ========================== */

  describe('last-write-wins by updated_at, per row', () => {
    it('rejects a STALE row and leaves the newer server row intact', async () => {
      await seedWeight(UID_A, 'w_seed', T1, 70);

      const body = await pushOk({
        weight_entries: [{ id: 'w_seed', date: DAY1, weight: 55, unit: 'kg', updated_at: T0 }],
      });
      expect(body.results.weight_entries).toEqual([
        {
          index: 0,
          id: 'w_seed',
          server_id: 'w_seed',
          status: 'stale',
          // The client is told exactly what it is behind, so it can re-pull.
          server_updated_at: T1,
        },
      ]);
      expect(await readHealthRow(db(), 'weight_entries', 'w_seed')).toMatchObject({
        weight: 70,
        updated_at: T1,
      });
    });

    it('applies a strictly NEWER row', async () => {
      await seedWeight(UID_A, 'w_seed', T1, 70);

      const body = await pushOk({
        weight_entries: [
          { id: 'w_seed', date: DAY1, weight: 68.5, unit: 'kg', note: 'post-run', updated_at: T2 },
        ],
      });
      expect(only(body.results.weight_entries[0])).toEqual({
        status: 'applied',
        action: 'updated',
        reason: undefined,
      });
      expect(await readHealthRow(db(), 'weight_entries', 'w_seed')).toMatchObject({
        weight: 68.5,
        note: 'post-run',
        updated_at: T2,
        created_at: T0, // never rewritten by an update
      });
    });

    it('inserts a row the server has never seen', async () => {
      const body = await pushOk({
        weight_entries: [{ id: 'w_dev', date: DAY2, weight: 72, unit: 'kg', updated_at: T1 }],
      });
      expect(body.results.weight_entries[0]).toMatchObject({
        status: 'applied',
        action: 'inserted',
        server_id: 'w_dev',
      });
      expect(await readHealthRow(db(), 'weight_entries', 'w_dev')).toMatchObject({
        date: DAY2,
        weight: 72,
        // The CLIENT stamp is persisted, not server `now` — that is what makes
        // "whoever edited last wins" true instead of "whoever pushed last wins".
        updated_at: T1,
        created_at: T1,
      });
    });

    it('decides per ROW, not per batch — one stale row does not sink its neighbours', async () => {
      await seedWeight(UID_A, 'w_old', T1, 70);
      await seedWeight(UID_A, 'w_new', T0, 80);

      const body = await pushOk({
        weight_entries: [
          { id: 'w_old', date: DAY1, weight: 60, unit: 'kg', updated_at: T0 }, // stale
          { id: 'w_new', date: DAY1, weight: 81, unit: 'kg', updated_at: T2 }, // wins
        ],
      });
      expect(body.results.weight_entries.map((r) => r.status)).toEqual(['stale', 'applied']);
      expect(await readHealthRow(db(), 'weight_entries', 'w_old')).toMatchObject({ weight: 70 });
      expect(await readHealthRow(db(), 'weight_entries', 'w_new')).toMatchObject({ weight: 81 });
    });
  });

  /* ===================== 5. TOMBSTONES =============================== */

  describe('tombstone precedence', () => {
    it('applies a delete that races an edit at the SAME instant', async () => {
      await seedWeight(UID_A, 'w_seed', T1, 70);

      // Device 1 deletes at T1…
      const del = await pushOk({
        weight_entries: [
          { id: 'w_seed', date: DAY1, weight: 70, unit: 'kg', updated_at: T1, deleted_at: T1 },
        ],
      });
      expect(only(del.results.weight_entries[0])).toEqual({
        status: 'applied',
        action: 'deleted',
        reason: undefined,
      });
      expect(await readHealthRow(db(), 'weight_entries', 'w_seed')).toMatchObject({
        deleted_at: T1,
      });

      // …device 2 edits at the very same T1 and must NOT bring the row back.
      const edit = await pushOk({
        weight_entries: [{ id: 'w_seed', date: DAY1, weight: 65, unit: 'kg', updated_at: T1 }],
      });
      expect(only(edit.results.weight_entries[0])).toEqual({
        status: 'tombstoned',
        action: undefined,
        reason: undefined,
      });
      const row = await readHealthRow<{ deleted_at: string; weight: number }>(
        db(),
        'weight_entries',
        'w_seed'
      );
      expect(row?.deleted_at).toBe(T1);
      expect(row?.weight).toBe(70); // the losing edit wrote nothing at all
    });

    it('lets a STRICTLY newer edit resurrect a tombstoned row (a re-create, not a race)', async () => {
      await insertHealthRow(db(), 'weight_entries', {
        id: 'w_dead',
        user_id: UID_A,
        date: DAY1,
        weight: 70,
        unit: 'kg',
        note: null,
        created_at: T0,
        updated_at: T1,
        deleted_at: T1,
      });

      const body = await pushOk({
        weight_entries: [{ id: 'w_dead', date: DAY1, weight: 66, unit: 'kg', updated_at: T2 }],
      });
      expect(only(body.results.weight_entries[0])).toEqual({
        status: 'applied',
        action: 'updated',
        reason: undefined,
      });
      expect(await readHealthRow(db(), 'weight_entries', 'w_dead')).toMatchObject({
        weight: 66,
        deleted_at: null,
      });
    });

    it('refuses an OLDER edit against a tombstone as stale, not as a resurrection', async () => {
      await insertHealthRow(db(), 'weight_entries', {
        id: 'w_dead',
        user_id: UID_A,
        date: DAY1,
        weight: 70,
        unit: 'kg',
        note: null,
        created_at: T0,
        updated_at: T2,
        deleted_at: T2,
      });

      const body = await pushOk({
        weight_entries: [{ id: 'w_dead', date: DAY1, weight: 66, unit: 'kg', updated_at: T1 }],
      });
      expect(body.results.weight_entries[0].status).toBe('stale');
      expect(await readHealthRow(db(), 'weight_entries', 'w_dead')).toMatchObject({
        deleted_at: T2,
      });
    });

    it('carries a tombstone for a row the server never had, so a later create loses to it', async () => {
      const body = await pushOk({
        weight_entries: [
          // Delete at T2 arriving before the create at T1 (offline device, out of
          // order): the tombstone lands and the older create is then stale.
          { id: 'w_race', date: DAY1, weight: 70, unit: 'kg', updated_at: T2, deleted_at: T2 },
          { id: 'w_race', date: DAY1, weight: 70, unit: 'kg', updated_at: T1 },
        ],
      });
      expect(body.results.weight_entries.map((r) => r.status)).toEqual(['applied', 'stale']);
      expect(await readHealthRow(db(), 'weight_entries', 'w_race')).toMatchObject({
        deleted_at: T2,
      });
    });

    it('no-ops a delete of a row the server never had and cannot reconstruct', async () => {
      const body = await pushOk({
        weight_entries: [{ id: 'w_ghost', updated_at: T2, deleted_at: T2 }],
      });
      expect(only(body.results.weight_entries[0])).toEqual({
        status: 'unchanged',
        action: undefined,
        reason: 'nothing_to_delete',
      });
      expect(await listHealthRows(db(), 'weight_entries')).toEqual([]);
    });
  });

  /* ===================== 6. IDEMPOTENCY ============================== */

  describe('idempotent replay', () => {
    it('replaying the same push writes nothing the second time', async () => {
      const batch: Changes = {
        weight_entries: [{ id: 'w_1', date: DAY1, weight: 70, unit: 'kg', updated_at: T1 }],
        period_entries: [{ id: 'per_1', date: DAY1, flow_level: 4, updated_at: T1 }],
      };

      const first = await pushOk(batch);
      expect(first.summary).toMatchObject({ total: 2, applied: 2, unchanged: 0 });
      const afterFirst = await listHealthRows(db(), 'weight_entries');

      // The client never saw the response and retried the identical batch.
      const second = await pushOk(batch);
      expect(second.summary).toMatchObject({ total: 2, applied: 0, unchanged: 2 });
      expect(second.results.weight_entries[0]).toMatchObject({
        status: 'unchanged',
        server_id: 'w_1',
        server_updated_at: T1,
      });

      expect(await listHealthRows(db(), 'weight_entries')).toEqual(afterFirst);
      expect(await listHealthRows(db(), 'period_entries')).toHaveLength(1);
    });

    it('replays a DELETE without double-applying it', async () => {
      await seedWeight(UID_A, 'w_seed', T1, 70);
      const tombstone: Changes = {
        weight_entries: [
          { id: 'w_seed', date: DAY1, weight: 70, unit: 'kg', updated_at: T2, deleted_at: T2 },
        ],
      };
      expect((await pushOk(tombstone)).summary.applied).toBe(1);
      const after = await readHealthRow(db(), 'weight_entries', 'w_seed');

      const replay = await pushOk(tombstone);
      expect(replay.summary).toMatchObject({ applied: 0, unchanged: 1 });
      expect(await readHealthRow(db(), 'weight_entries', 'w_seed')).toEqual(after);
    });

    it('collapses a duplicate row inside ONE batch instead of inserting twice', async () => {
      const body = await pushOk({
        weight_entries: [
          { id: 'w_dup', date: DAY1, weight: 70, unit: 'kg', updated_at: T1 },
          { id: 'w_dup', date: DAY1, weight: 70, unit: 'kg', updated_at: T1 },
        ],
      });
      expect(body.results.weight_entries.map((r) => r.status)).toEqual(['applied', 'unchanged']);
      expect(await listHealthRows(db(), 'weight_entries')).toHaveLength(1);
    });
  });

  /* ===================== 7. NATURAL-KEY MERGE ======================== */

  describe('natural-key merge (per-(user, date) upsert tables)', () => {
    beforeEach(async () => {
      await seedHabit(UID_A, 'habit_a');
    });

    /**
     * Each case seeds a server row with id `srv_*` at T0, then pushes the SAME
     * natural key from a second device that invented its own id at T2. The merge
     * must update the existing row, keep the SERVER id, and leave exactly one row.
     */
    const CASES: Array<{
      collection: string;
      table: string;
      serverId: string;
      seed: () => Promise<void>;
      row: Record<string, unknown>;
      expected: Record<string, unknown>;
    }> = [
      {
        collection: 'cycle_settings',
        table: 'cycle_settings',
        serverId: 'srv_cyset',
        seed: () =>
          insertHealthRow(db(), 'cycle_settings', {
            id: 'srv_cyset',
            user_id: UID_A,
            cycle_length: 28,
            period_length: 5,
            last_period_start: null,
            created_at: T0,
            updated_at: T0,
          }),
        row: { id: 'dev2_cyset', cycle_length: 31, period_length: 6, updated_at: T2 },
        expected: { cycle_length: 31, period_length: 6 },
      },
      {
        collection: 'period_entries',
        table: 'period_entries',
        serverId: 'srv_per',
        seed: () =>
          insertHealthRow(db(), 'period_entries', {
            id: 'srv_per',
            user_id: UID_A,
            date: DAY1,
            flow_level: 3,
            notes: null,
            created_at: T0,
            updated_at: T0,
            deleted_at: null,
          }),
        row: { id: 'dev2_per', date: DAY1, flow_level: 5, updated_at: T2 },
        expected: { flow_level: 5 },
      },
      {
        collection: 'cycle_symptom_entries',
        table: 'cycle_symptom_entries',
        serverId: 'srv_sym',
        seed: () =>
          insertHealthRow(db(), 'cycle_symptom_entries', {
            id: 'srv_sym',
            user_id: UID_A,
            date: DAY1,
            mood: 2,
            created_at: T0,
            updated_at: T0,
            deleted_at: null,
          }),
        row: { id: 'dev2_sym', date: DAY1, mood: 5, cramps: 2, updated_at: T2 },
        expected: { mood: 5, cramps: 2 },
      },
      {
        collection: 'mens_health_entries',
        table: 'mens_health_entries',
        serverId: 'srv_mh',
        seed: () =>
          insertHealthRow(db(), 'mens_health_entries', {
            id: 'srv_mh',
            user_id: UID_A,
            date: DAY1,
            libido: 3,
            created_at: T0,
            updated_at: T0,
            deleted_at: null,
          }),
        row: { id: 'dev2_mh', date: DAY1, libido: 8, had_orgasm: true, updated_at: T2 },
        expected: { libido: 8, had_orgasm: 1 },
      },
      {
        collection: 'habit_logs',
        table: 'habit_logs',
        serverId: 'srv_log',
        seed: () => seedHabitLog(UID_A, 'srv_log', 'habit_a', T0),
        row: {
          id: 'dev2_log',
          habit_id: 'habit_a',
          date: DAY1,
          completed_at: T2,
          notes: 'second device',
          updated_at: T2,
        },
        expected: { notes: 'second device' },
      },
      {
        collection: 'health_goals',
        table: 'health_goals',
        serverId: 'srv_goal',
        seed: () =>
          insertHealthRow(db(), 'health_goals', {
            id: 'srv_goal',
            user_id: UID_A,
            effective_date: DAY1,
            daily_calories: 2000,
            created_at: T0,
            updated_at: T0,
          }),
        row: { id: 'dev2_goal', effective_date: DAY1, daily_calories: 2600, updated_at: T2 },
        expected: { daily_calories: 2600 },
      },
    ];

    it.each(CASES)(
      '$collection merges on its natural key and keeps the server id',
      async ({ collection, table, serverId, seed, row, expected }) => {
        await seed();

        const body = await pushOk({ [collection]: [row] });
        const result = body.results[collection][0];
        expect(result.status).toBe('applied');
        expect(result.action).toBe('updated');
        // The client id is NOT the identity: the server id comes back so the
        // second device can re-key its local row instead of duplicating it.
        expect(result.id).toBe(row.id);
        expect(result.server_id).toBe(serverId);

        const rows = await listHealthRows(db(), table);
        expect(rows).toHaveLength(1);
        expect(await readHealthRow(db(), table, serverId)).toMatchObject({
          ...expected,
          updated_at: T2,
        });
      }
    );

    it('rejects a stale natural-key push the same way as an id-keyed one', async () => {
      await insertHealthRow(db(), 'period_entries', {
        id: 'srv_per',
        user_id: UID_A,
        date: DAY1,
        flow_level: 3,
        notes: null,
        created_at: T0,
        updated_at: T2,
        deleted_at: null,
      });

      const body = await pushOk({
        period_entries: [{ id: 'dev2_per', date: DAY1, flow_level: 1, updated_at: T1 }],
      });
      expect(body.results.period_entries[0]).toMatchObject({
        status: 'stale',
        server_id: 'srv_per',
        server_updated_at: T2,
      });
      expect(await listHealthRows(db(), 'period_entries')).toHaveLength(1);
    });

    it('inserts a natural-key row under the client id when the slot is empty', async () => {
      const body = await pushOk({
        period_entries: [{ id: 'dev_per', date: DAY2, flow_level: 2, updated_at: T1 }],
      });
      expect(body.results.period_entries[0]).toMatchObject({
        status: 'applied',
        action: 'inserted',
        server_id: 'dev_per',
      });
      expect(await readHealthRow(db(), 'period_entries', 'dev_per')).toMatchObject({
        user_id: UID_A,
        date: DAY2,
      });
    });

    it('rejects a natural-key row missing its key column', async () => {
      const body = await pushOk({ period_entries: [{ id: 'dev_per', flow_level: 2, updated_at: T1 }] });
      expect(only(body.results.period_entries[0])).toEqual({
        status: 'invalid',
        action: undefined,
        reason: 'missing_natural_key:date',
      });
      expect(await listHealthRows(db(), 'period_entries')).toEqual([]);
    });

    it('lands a habit and its log in ONE batch (parents are processed first)', async () => {
      const body = await pushOk({
        habit_logs: [
          { id: 'log_new', habit_id: 'habit_fresh', date: DAY1, completed_at: T1, updated_at: T1 },
        ],
        habits: [{ id: 'habit_fresh', name: 'Walk', updated_at: T1 }],
      });
      expect(body.results.habits[0].status).toBe('applied');
      // The FK would fail if the log were written before its habit.
      expect(body.results.habit_logs[0].status).toBe('applied');
      expect(await readHealthRow(db(), 'habit_logs', 'log_new')).toMatchObject({
        habit_id: 'habit_fresh',
      });
    });
  });

  /* ===================== 8. MIXED BATCH ============================== */

  describe('mixed batch', () => {
    it('returns an exact per-row verdict for a batch that partly applies', async () => {
      await seedWeight(UID_A, 'w_seed', T1, 70);

      const body = await pushOk({
        weight_entries: [
          { id: 'w_fresh', date: DAY2, weight: 71, unit: 'kg', updated_at: T2 }, // insert
          { id: 'w_seed', date: DAY1, weight: 60, unit: 'kg', updated_at: T0 }, // stale
          { id: 'w_evil', user_id: UID_B, date: DAY1, weight: 1, unit: 'kg', updated_at: T2 },
          { id: 'w_seed', date: DAY1, weight: 70, unit: 'kg', updated_at: T1 }, // replay
        ],
        nutrition_entries: [
          { id: 'n_bad', date: DAY1, food_name: 'Egg', meal_type: 'breakfast', updated_at: T2 },
        ],
        period_entries: [{ id: 'per_dev', date: DAY1, flow_level: 4, updated_at: T2 }],
      });

      expect(body.results.weight_entries).toEqual([
        {
          index: 0,
          id: 'w_fresh',
          server_id: 'w_fresh',
          status: 'applied',
          action: 'inserted',
          server_updated_at: T2,
        },
        { index: 1, id: 'w_seed', server_id: 'w_seed', status: 'stale', server_updated_at: T1 },
        { index: 2, id: 'w_evil', server_id: null, status: 'forbidden', reason: 'foreign_user_id' },
        { index: 3, id: 'w_seed', server_id: 'w_seed', status: 'unchanged', server_updated_at: T1 },
      ]);
      expect(body.results.nutrition_entries).toEqual([
        {
          index: 0,
          id: 'n_bad',
          server_id: null,
          status: 'invalid',
          reason: 'missing_field:calories',
        },
      ]);
      expect(body.results.period_entries[0]).toMatchObject({ status: 'applied', action: 'inserted' });

      expect(body.summary).toEqual({
        total: 6,
        applied: 2,
        unchanged: 1,
        stale: 1,
        tombstoned: 0,
        forbidden: 1,
        invalid: 1,
      });

      // Only the two accepted rows exist; the seeded row is untouched.
      expect(await readHealthRow(db(), 'weight_entries', 'w_fresh')).toBeTruthy();
      expect(await readHealthRow(db(), 'weight_entries', 'w_seed')).toMatchObject({ weight: 70 });
      expect(await listHealthRows(db(), 'weight_entries')).toHaveLength(2);
      expect(await listHealthRows(db(), 'nutrition_entries')).toEqual([]);
      expect(await listHealthRows(db(), 'period_entries')).toHaveLength(1);
    });
  });

  /* ===================== 9. PUSH → PULL ROUND TRIP =================== */

  describe('push then pull', () => {
    it('hands the pushed rows straight back to the other device', async () => {
      await pushOk({
        weight_entries: [{ id: 'w_1', date: DAY1, weight: 70, unit: 'kg', updated_at: T1 }],
        period_entries: [{ id: 'per_1', date: DAY1, flow_level: 3, updated_at: T1 }],
      });

      const res = await call('GET', `/sync?since=${T0}`, { token: tokenA });
      const pulled = (await res.json()) as {
        weight_entries: Array<{ id: string; updated_at: string }>;
        period_entries: Array<{ id: string }>;
      };
      expect(pulled.weight_entries.map((r) => r.id)).toEqual(['w_1']);
      expect(pulled.period_entries.map((r) => r.id)).toEqual(['per_1']);
    });

    it('re-delivers a row stamped EXACTLY at the cursor (gte is inclusive)', async () => {
      // The pull filters `updated_at >= since`, so the boundary row comes back
      // rather than being missed — at-least-once. Push is the other half of that
      // bargain: the redundant row returns as `unchanged`, never a duplicate.
      await pushOk({
        weight_entries: [{ id: 'w_edge', date: DAY1, weight: 70, unit: 'kg', updated_at: T1 }],
      });

      const pulled = (await (
        await call('GET', `/sync?since=${T1}`, { token: tokenA })
      ).json()) as { weight_entries: Array<{ id: string }> };
      expect(pulled.weight_entries.map((r) => r.id)).toEqual(['w_edge']);

      const replay = await pushOk({
        weight_entries: [{ id: 'w_edge', date: DAY1, weight: 70, unit: 'kg', updated_at: T1 }],
      });
      expect(replay.results.weight_entries[0].status).toBe('unchanged');
    });

    it('propagates a pushed tombstone to the pull', async () => {
      await pushOk({
        weight_entries: [{ id: 'w_1', date: DAY1, weight: 70, unit: 'kg', updated_at: T1 }],
      });
      await pushOk({
        weight_entries: [
          { id: 'w_1', date: DAY1, weight: 70, unit: 'kg', updated_at: T2, deleted_at: T2 },
        ],
      });

      const pulled = (await (
        await call('GET', `/sync?since=${T0}`, { token: tokenA })
      ).json()) as { weight_entries: Array<{ id: string; deleted_at: string | null }> };
      expect(pulled.weight_entries).toHaveLength(1);
      expect(pulled.weight_entries[0].deleted_at).toBe(T2);

      // …and the live list no longer shows it.
      const live = (await (await call('GET', '/weight/entries', { token: tokenA })).json()) as {
        entries: unknown[];
      };
      expect(live.entries).toEqual([]);
    });

    it('never hands a pushed row to another user pull', async () => {
      await pushOk({
        weight_entries: [{ id: 'w_1', date: DAY1, weight: 70, unit: 'kg', updated_at: T1 }],
      });
      const pulled = (await (
        await call('GET', '/sync', { token: tokenB })
      ).json()) as { weight_entries: unknown[] };
      expect(pulled.weight_entries).toEqual([]);
    });
  });
});
