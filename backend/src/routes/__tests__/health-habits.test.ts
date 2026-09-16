/**
 * `/health/habits` — the corners `health.test.ts` does not reach.
 *
 * That suite owns the brand gate, the auth sweep, cross-user scoping and the
 * primary habits path (create → toggle → untick → soft delete → 404 on an
 * unknown id). This one owns the parts of the contract the RN Habits tab
 * depends on that nothing was asserting:
 *
 *  1. **The empty answer.** `GET /habits` returning `{ habits: [] }` is the
 *     signal the client seeds the donor starter set on — five POSTs, once per
 *     account. If this route ever answered `{}` or 404 on a fresh account the
 *     seed would either never run or run on every open.
 *  2. **The validation bounds.** `name` is `min(1).max(60)`, `icon` and
 *     `category` are `max(40)`, and the toggle `date` is a strict YYYY-MM-DD.
 *     The client truncates names at 40, so 41…60 is a window only ANOTHER
 *     client (or a replayed request) can reach, and 61 must be refused rather
 *     than silently stored.
 *  3. **`is_archived`.** `listHabits` filters it and no route sets it yet, so
 *     it is invisible from the HTTP surface — exactly the kind of filter that
 *     gets "cleaned up" during a later refactor. The guard below pins it from
 *     the storage side so a future archive endpoint inherits a working list.
 *  4. **`sort_order` after a delete.** The counter behind it counts EVERY row
 *     including soft-deleted ones, which is what stops a re-add from colliding
 *     with a live habit's position and reshuffling the member's list.
 *
 * Harness mirrors health.test.ts exactly: `cloudflare:test` env, a jose HS256
 * JWT whose `sub` is the user id, the brand flipped onto a copy of the pool env,
 * and the DDL from the shared `health-test-helpers`.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import healthRoutes from '../health';

import { createHealthTables, resetHealthTables, seedHealthUsers } from './health-test-helpers';

const testEnv = env as unknown as Env;
const HEALTH_ENV = { ...testEnv, APP_BRAND: 'symply-health' } as Env;

const UID_A = 'u_habit_alice';
const UID_B = 'u_habit_bob';

const D1 = '2026-06-01';
const D2 = '2026-06-02';

async function mintToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(
    testEnv.JWT_SECRET ?? 'test-jwt-secret-32-chars-minimum'
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
  opts: { token?: string | null; body?: unknown } = {}
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = opts.token === undefined ? tokenA : opts.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  return mkApp().request(
    `/health${path}`,
    { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) },
    HEALTH_ENV
  );
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

interface HabitRow {
  id: string;
  name: string;
  icon: string;
  category: string;
  sort_order: number;
  is_archived: boolean | number;
  days: string[];
  streak: number;
}

async function createHabit(
  body: Record<string, unknown>,
  token = tokenA
): Promise<{ status: number; habit: HabitRow }> {
  const res = await call('POST', '/habits', { token, body });
  const parsed = res.status === 201 ? (await json<{ habit: HabitRow }>(res)).habit : ({} as HabitRow);
  return { status: res.status, habit: parsed };
}

async function listHabits(token = tokenA): Promise<HabitRow[]> {
  return (await json<{ habits: HabitRow[] }>(await call('GET', '/habits', { token }))).habits;
}

beforeEach(async () => {
  await createHealthTables(testEnv.DB);
  await resetHealthTables(testEnv.DB);
  await seedHealthUsers(testEnv.DB, [UID_A, UID_B]);
  tokenA = await mintToken(UID_A);
  tokenB = await mintToken(UID_B);
});

describe('/health/habits — the client contract', () => {
  it('HEALTH-HABIT-074: a fresh account answers 200 with an EMPTY list', async () => {
    const res = await call('GET', '/habits');

    // This exact shape is the client's seed trigger: `rows.length === 0` sends
    // five POSTs, once. A 404 would make the tab open offline-empty forever;
    // an absent `habits` key would make the client read `undefined.length`.
    expect(res.status).toBe(200);
    const body = await json<{ habits: HabitRow[] }>(res);
    expect(body).toHaveProperty('habits');
    expect(body.habits).toEqual([]);
  });

  it('HEALTH-HABIT-075: create answers 201 with the whole row, days and streak included', async () => {
    const { status, habit } = await createHabit({ name: 'Stretch' });

    // The client maps the RESPONSE row straight into its list on first-run
    // seeding, so every column it reads has to be present on the create answer
    // and not only on the subsequent GET.
    expect(status).toBe(201);
    expect(habit).toMatchObject({
      name: 'Stretch',
      icon: 'goals',
      category: 'custom',
      sort_order: 0,
      streak: 0,
    });
    expect(habit.days).toEqual([]);
    expect(typeof habit.id).toBe('string');
  });

  it('HEALTH-HABIT-076: a caller-supplied icon and category are stored, not overwritten', async () => {
    const { habit } = await createHabit({ name: 'Sleep 7+ hours', icon: 'sleep-habit', category: 'wellness' });

    // `goals` / `custom` are DEFAULTS, not constants: the donor's starter set
    // ships five distinct kit icons and the client sends them on seeding, so a
    // handler that ignored the field would give every member five identical rows.
    expect(habit.icon).toBe('sleep-habit');
    expect(habit.category).toBe('wellness');
    expect((await listHabits())[0]).toMatchObject({ icon: 'sleep-habit', category: 'wellness' });
  });
});

describe('/health/habits — validation bounds', () => {
  it('HEALTH-HABIT-077: a 60-character name is accepted and a 61-character one is refused', async () => {
    // The RN client truncates at 40 (MAX_HABIT_NAME), so 41…60 is a window only
    // another client — or a replayed request — can reach. It must be a clean
    // 400 at the boundary rather than a silent D1 write of an oversized string.
    const at = await createHabit({ name: 'x'.repeat(60) });
    expect(at.status).toBe(201);
    expect(at.habit.name).toHaveLength(60);

    const over = await call('POST', '/habits', { body: { name: 'x'.repeat(61) } });
    expect(over.status).toBe(400);
    expect(await listHabits()).toHaveLength(1); // the refused one never landed
  });

  it('HEALTH-HABIT-078: a whitespace-only name is accepted by the route — the client is the trimmer', async () => {
    // Honest record of the shipped contract: `z.string().min(1)` counts spaces,
    // so "   " passes the route. It cannot arrive from the Habits tab —
    // `addHabit` trims first and refuses an empty result, and the add button is
    // gated on the same trim — but a second client would create a nameless row.
    // Documented rather than asserted-as-desirable: see the matrix delta.
    const res = await call('POST', '/habits', { body: { name: '   ' } });
    expect(res.status).toBe(201);

    const empty = await call('POST', '/habits', { body: { name: '' } });
    expect(empty.status).toBe(400);
  });

  it('HEALTH-HABIT-079: icon and category are capped at 40 characters', async () => {
    expect((await createHabit({ name: 'A', icon: 'i'.repeat(40) })).status).toBe(201);
    expect((await call('POST', '/habits', { body: { name: 'B', icon: 'i'.repeat(41) } })).status).toBe(400);
    expect((await call('POST', '/habits', { body: { name: 'C', category: 'c'.repeat(41) } })).status).toBe(400);
  });

  it('HEALTH-HABIT-080: the toggle date must be a strict YYYY-MM-DD', async () => {
    const { habit } = await createHabit({ name: 'Stretch' });

    // The day key is the unique key of a completion (`UNIQUE(habit_id, date)`),
    // so a loose format would let `2026-6-1` and `2026-06-01` become two ticks
    // for the same day and inflate the member's streak.
    for (const bad of ['2026-6-1', '01-06-2026', 'today', '', '2026-06-01T00:00:00Z']) {
      const res = await call('POST', `/habits/${habit.id}/toggle`, { body: { date: bad } });
      expect(res.status, `date=${bad}`).toBe(400);
    }

    const good = await call('POST', `/habits/${habit.id}/toggle`, { body: { date: D1 } });
    expect(good.status).toBe(200);
    expect((await listHabits())[0].days).toEqual([D1]);
  });

  it('HEALTH-HABIT-081: a toggle with no date at all is refused, not defaulted to today', async () => {
    const { habit } = await createHabit({ name: 'Stretch' });

    // Defaulting server-side would file the tick on the SERVER's day. A member
    // ticking at 23:50 in UTC+13 would see it land on tomorrow, which is why
    // the client always sends its own local day key and the route insists.
    expect((await call('POST', `/habits/${habit.id}/toggle`, { body: {} })).status).toBe(400);
    expect((await listHabits())[0].days).toEqual([]);
  });
});

describe('/health/habits — ordering and archived rows', () => {
  it('HEALTH-HABIT-082: sort_order keeps climbing past deleted rows so a re-add lands last', async () => {
    const first = await createHabit({ name: 'First' });
    const second = await createHabit({ name: 'Second' });
    expect([first.habit.sort_order, second.habit.sort_order]).toEqual([0, 1]);

    await call('DELETE', `/habits/${first.habit.id}`);
    const third = await createHabit({ name: 'Third' });

    // The counter behind `sort_order` counts every row the user has ever had,
    // soft-deleted ones included. If it counted only live rows, "Third" would
    // be given order 1 — a tie with "Second" — and the list order would depend
    // on how SQLite broke the tie.
    expect(third.habit.sort_order).toBe(2);
    expect((await listHabits()).map((h) => h.name)).toEqual(['Second', 'Third']);
  });

  it('HEALTH-HABIT-083: an archived habit leaves the list and takes its dots with it', async () => {
    // POSTURE GUARD. `listHabits` filters `is_archived = false`, and there is no
    // route that sets the column yet — so the filter is unreachable from HTTP
    // and looks dead to anyone reading the service. It is not: the donor
    // archives rather than deletes, and that port is still to come. This guard
    // fails if the filter is dropped, so the future archive endpoint inherits a
    // list that already hides what it archives. DELETE IT if the column goes.
    const { habit } = await createHabit({ name: 'Stretch' });
    await call('POST', `/habits/${habit.id}/toggle`, { body: { date: D1 } });
    expect((await listHabits())[0].days).toEqual([D1]);

    await testEnv.DB.prepare('UPDATE user_habits SET is_archived = 1 WHERE id = ?')
      .bind(habit.id)
      .run();

    // The habit is gone from the list, and because days are attached per habit
    // its completion log cannot surface against anything else either.
    expect(await listHabits()).toEqual([]);
    const logs = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS n FROM habit_logs WHERE habit_id = ?'
    )
      .bind(habit.id)
      .first<{ n: number }>();
    expect(logs?.n).toBe(1); // the record survives — archiving is not deleting
  });

  it('HEALTH-HABIT-084: one member archiving a habit does not touch another member', async () => {
    const mine = await createHabit({ name: 'Stretch' });
    const theirs = await createHabit({ name: 'Stretch' }, tokenB);
    await testEnv.DB.prepare('UPDATE user_habits SET is_archived = 1 WHERE id = ?')
      .bind(mine.habit.id)
      .run();

    expect(await listHabits()).toEqual([]);
    expect((await listHabits(tokenB)).map((h) => h.id)).toEqual([theirs.habit.id]);
  });

  it('HEALTH-HABIT-085: the day list comes back newest-first, whatever order it was filed in', async () => {
    const { habit } = await createHabit({ name: 'Stretch' });
    // Filed oldest-last on purpose — a member back-filling yesterday after
    // ticking today is the normal case, not an edge one.
    await call('POST', `/habits/${habit.id}/toggle`, { body: { date: D2 } });
    await call('POST', `/habits/${habit.id}/toggle`, { body: { date: D1 } });

    // The client's `streakOf` walks a Set so it does not care, but the widget
    // and the watch read `days[0]` as "most recent", so the order is contract.
    expect((await listHabits())[0].days).toEqual([D2, D1]);
  });
});
