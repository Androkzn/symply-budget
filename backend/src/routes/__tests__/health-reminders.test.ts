/**
 * Symply Health — the REMINDER SCHEDULE (`/health/reminders/*`,
 * `src/routes/health-reminders.ts`) and the pure planner behind it
 * (`services/health-reminders-service.ts`).
 *
 * WHAT THIS SURFACE IS
 * --------------------
 * `health_reminder_preferences` (migration 0134) is one row per member saying
 * WHEN their meal / water / weigh-in nudges fire. It is NOT
 * `activity_notification_preferences` (0120, covered by
 * `health-notify-flags.test.ts`): that table answers "may we push it", this one
 * answers "should a nudge exist at all".
 *
 * WHY IT NEEDS COVERAGE THIS SHAPE
 * --------------------------------
 * Every field here becomes a PUSH AT A WALL-CLOCK TIME on somebody's phone, so
 * the failure modes are unusually unforgiving and unusually silent:
 *
 *   - times are LOCAL 'HH:MM', never UTC. A '25:00' or a '7:5' that got stored
 *     is a nudge that either never fires or fires at the wrong hour, and the
 *     member has no way to tell which;
 *   - `weigh_in_days: null` means EVERY day and `[]` would mean NEVER — an
 *     empty array from a settings screen with a bug must be refused, not stored;
 *   - quiet hours WRAP past midnight (23:00→07:00 is the default), which the
 *     naive `start <= x < end` comparison reads as an empty window — i.e. a
 *     03:00 push;
 *   - water is a window + interval, so a bad interval is not one bad nudge but
 *     forty-eight of them. The floor, the ceiling and the per-day cap are each
 *     asserted at their boundary;
 *   - changing a time must DROP the already-materialised queue, or the member
 *     keeps being pushed on yesterday's schedule for up to a day and reasonably
 *     concludes the setting does nothing.
 *
 * The planner (`planRemindersForDay`) is pure, so the whole "which nudges, at
 * what minute" decision is driven directly rather than through the cron.
 *
 * Runnable on its own:
 *   npx vitest run src/routes/__tests__/health-reminders.test.ts
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  HEALTH_REMINDER_DEFAULTS,
  HEALTH_REMINDER_REFERENCE_TYPE,
  HEALTH_MEAL_REMINDER_TYPE,
  HEALTH_WATER_REMINDER_TYPE,
  HEALTH_WEIGH_IN_REMINDER_TYPE,
  MAX_WATER_REMINDERS_PER_DAY,
  MAX_WATER_INTERVAL_MINUTES,
  MIN_WATER_INTERVAL_MINUTES,
  isWithinQuietHours,
  localDateParts,
  parseHhmmToMinutes,
  planRemindersForDay,
  type HealthReminderPreferences,
} from '../../services/health-reminders-service';
import type { Env } from '../../types';
import healthRemindersRoutes from '../health-reminders';

import { createHealthTables, resetHealthTables, seedHealthUsers } from './health-test-helpers';

const testEnv = env as unknown as Env;

const HEALTH_ENV = { ...testEnv, APP_BRAND: 'symply-health' } as Env;
const HOUSE_ENV = { ...testEnv, APP_BRAND: 'symply-house' } as Env;
const BUDGET_ENV = { ...testEnv, APP_BRAND: 'symply-budget' } as Env;
const KAIZEN_ENV = { ...testEnv, APP_BRAND: 'symply-kaizen' } as Env;

const UID_A = 'u_rem_alice';
const UID_B = 'u_rem_bob';

const PATH = '/reminders/preferences';
const TABLE = 'health_reminder_preferences';
const QUEUE = 'scheduled_notifications';

/**
 * The 0134 table + the platform queue the engine writes into, mirrored from
 * `backend/migrations/0134_health_reminders.sql` and
 * `db/schema-notifications.ts`. Declared locally rather than added to the shared
 * `health-test-helpers.ts`, which several suites create tables from — a new
 * table there is a change every other health suite has to absorb.
 *
 * The DEFAULTS are kept verbatim because one of the assertions below is that a
 * saved row and an unsaved read agree, and DDL defaults are the other half of
 * that claim.
 */
const REMINDER_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS ${TABLE} (
    user_id TEXT PRIMARY KEY,
    timezone TEXT,
    meals_enabled INTEGER NOT NULL DEFAULT 0,
    breakfast_enabled INTEGER NOT NULL DEFAULT 0,
    breakfast_time TEXT NOT NULL DEFAULT '08:30',
    lunch_enabled INTEGER NOT NULL DEFAULT 0,
    lunch_time TEXT NOT NULL DEFAULT '13:00',
    snack_enabled INTEGER NOT NULL DEFAULT 0,
    snack_time TEXT NOT NULL DEFAULT '16:00',
    dinner_enabled INTEGER NOT NULL DEFAULT 0,
    dinner_time TEXT NOT NULL DEFAULT '19:00',
    water_enabled INTEGER NOT NULL DEFAULT 0,
    water_start_time TEXT NOT NULL DEFAULT '09:00',
    water_end_time TEXT NOT NULL DEFAULT '21:00',
    water_interval_minutes INTEGER NOT NULL DEFAULT 120,
    weigh_in_enabled INTEGER NOT NULL DEFAULT 0,
    weigh_in_time TEXT NOT NULL DEFAULT '08:00',
    weigh_in_days TEXT,
    skip_if_already_logged INTEGER NOT NULL DEFAULT 1,
    quiet_hours_enabled INTEGER NOT NULL DEFAULT 1,
    quiet_hours_start TEXT NOT NULL DEFAULT '23:00',
    quiet_hours_end TEXT NOT NULL DEFAULT '07:00',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS ${QUEUE} (
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
    claimed_at TEXT,
    claim_owner TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    reference_type TEXT,
    reference_id TEXT,
    image_url TEXT,
    category_id TEXT,
    thread_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];

async function createReminderTables(): Promise<void> {
  for (const stmt of REMINDER_DDL) {
    await testEnv.DB.exec(stmt.replace(/\s+/g, ' ').trim());
  }
}

async function resetReminderTables(): Promise<void> {
  await testEnv.DB.exec(`DELETE FROM ${TABLE}`);
  await testEnv.DB.exec(`DELETE FROM ${QUEUE}`);
}

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

/** Mirrors `app.route('/health', healthRemindersRoutes)` in src/index.ts. */
function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/health', healthRemindersRoutes);
  return app;
}

let tokenA = '';
let tokenB = '';

async function call(
  method: string,
  opts: { token?: string | null; body?: unknown; rawBody?: string; brandEnv?: Env } = {}
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = opts.token === undefined ? tokenA : opts.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  const body =
    opts.rawBody !== undefined
      ? opts.rawBody
      : opts.body === undefined
        ? undefined
        : JSON.stringify(opts.body);
  return mkApp().request(
    `/health${PATH}`,
    { method, headers, body },
    opts.brandEnv ?? HEALTH_ENV
  );
}

type Prefs = HealthReminderPreferences & Record<string, unknown>;

async function getPrefs(token = tokenA): Promise<Prefs> {
  const res = await call('GET', { token });
  expect(res.status).toBe(200);
  return ((await res.json()) as { preferences: Prefs }).preferences;
}

async function putPrefs(
  body: unknown,
  token = tokenA
): Promise<{ preferences: Prefs; cancelled: number }> {
  const res = await call('PUT', { token, body });
  expect(res.status, JSON.stringify(body)).toBe(200);
  return (await res.json()) as { preferences: Prefs; cancelled: number };
}

async function storedRow(userId: string): Promise<Record<string, unknown> | null> {
  return testEnv.DB.prepare(`SELECT * FROM ${TABLE} WHERE user_id = ?`)
    .bind(userId)
    .first<Record<string, unknown>>();
}

/**
 * Put a health nudge on the platform queue by hand.
 *
 * The materialiser is a cron pass with four consent gates in front of it; the
 * ROUTE's contract is only "a schedule change drops what is queued", so the
 * queue is seeded directly. That keeps these cases about the route.
 */
async function queueReminder(
  userId: string,
  opts: { id: string; sent?: boolean; referenceType?: string; localDate?: string }
): Promise<void> {
  await testEnv.DB.prepare(
    `INSERT INTO ${QUEUE}
       (id, user_id, type, title, body, data, scheduled_for, sent_at, reference_type,
        reference_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      opts.id,
      userId,
      HEALTH_WATER_REMINDER_TYPE,
      'Time for water',
      'Have a glass.',
      JSON.stringify({ local_date: opts.localDate ?? '2026-08-01', slot: 'water_540' }),
      '2026-08-01T16:00:00.000Z',
      opts.sent ? '2026-08-01T16:00:05.000Z' : null,
      opts.referenceType ?? HEALTH_REMINDER_REFERENCE_TYPE,
      'health',
      '2026-08-01T02:00:00.000Z'
    )
    .run();
}

async function queueIds(): Promise<string[]> {
  const res = await testEnv.DB.prepare(`SELECT id FROM ${QUEUE} ORDER BY id`).all<{ id: string }>();
  return (res.results ?? []).map((r) => r.id);
}

/** A full preferences object for the PURE planner tests (no DB involved). */
function prefs(overrides: Partial<HealthReminderPreferences> = {}): HealthReminderPreferences {
  return {
    user_id: UID_A,
    ...HEALTH_REMINDER_DEFAULTS,
    created_at: null,
    updated_at: null,
    ...overrides,
  } as HealthReminderPreferences;
}

/** 2026-08-03 is a Monday → weekday 2 in the 1=Sunday scheme. */
const MONDAY = { iso: '2026-08-03', weekday: 2 };

describe('health reminder schedule (/health/reminders/preferences)', () => {
  beforeEach(async () => {
    await createHealthTables(testEnv.DB);
    await createReminderTables();
    await resetHealthTables(testEnv.DB);
    await resetReminderTables();
    await seedHealthUsers(testEnv.DB, [UID_A, UID_B]);
    tokenA = await mintToken(UID_A);
    tokenB = await mintToken(UID_B);
  });

  /* ========================= 1. LOAD / DEFAULTS ======================= */

  describe('defaults and shape', () => {
    it('reads the all-OFF defaults with no row in the table, and writes none', () => {
      // The whole point of the defaults constant: a member who never opened the
      // settings screen must read real toggles, not a 404 or a null — and a READ
      // must not start `created_at` ticking for somebody who never chose.
      return (async () => {
        const preferences = await getPrefs();
        expect(preferences.user_id).toBe(UID_A);
        expect(preferences.created_at).toBeNull();
        expect(preferences.updated_at).toBeNull();
        for (const [key, value] of Object.entries(HEALTH_REMINDER_DEFAULTS)) {
          expect(preferences[key], key).toEqual(value);
        }
        expect(await storedRow(UID_A)).toBeNull();
      })();
    });

    it('every category ships OFF — reminders are opt-IN', async () => {
      // A health app that starts pushing on install is uninstalled. Asserted
      // explicitly rather than through the defaults sweep because it is a
      // product promise, not a data detail.
      const preferences = await getPrefs();
      expect(preferences.meals_enabled).toBe(false);
      expect(preferences.water_enabled).toBe(false);
      expect(preferences.weigh_in_enabled).toBe(false);
      for (const slot of ['breakfast', 'lunch', 'snack', 'dinner'] as const) {
        expect(preferences[`${slot}_enabled`], slot).toBe(false);
      }
    });

    it('the two behaviour switches ship ON — quiet hours and skip-if-logged', async () => {
      // These are the two rules that make reminders tolerable. Defaulting either
      // to OFF turns the first-run experience into a 03:00 push, or into being
      // told to log a lunch that is already logged.
      const preferences = await getPrefs();
      expect(preferences.quiet_hours_enabled).toBe(true);
      expect(preferences.skip_if_already_logged).toBe(true);
      expect(preferences.quiet_hours_start).toBe('23:00');
      expect(preferences.quiet_hours_end).toBe('07:00');
    });

    it('times pre-fill so a freshly flipped toggle has a schedule behind it', async () => {
      const preferences = await getPrefs();
      expect(preferences.breakfast_time).toBe('08:30');
      expect(preferences.lunch_time).toBe('13:00');
      expect(preferences.dinner_time).toBe('19:00');
      expect(preferences.water_start_time).toBe('09:00');
      expect(preferences.water_end_time).toBe('21:00');
      expect(preferences.water_interval_minutes).toBe(120);
    });

    it('weigh_in_days is null (every day), never an empty array', async () => {
      // `null` and `[]` are opposites here — every day vs never. The read path
      // must not normalise one into the other.
      expect((await getPrefs()).weigh_in_days).toBeNull();
    });

    it('PUT echoes the same preference envelope as GET', async () => {
      const { preferences } = await putPrefs({ meals_enabled: true });
      const read = await getPrefs();
      expect(Object.keys(preferences).sort()).toEqual(Object.keys(read).sort());
      expect(preferences).toEqual(read);
    });
  });

  /* ============================ 2. MUTATION ========================== */

  describe('mutation', () => {
    it('applies a partial patch and leaves every other field alone', async () => {
      const { preferences } = await putPrefs({ meals_enabled: true, lunch_enabled: true });
      expect(preferences.meals_enabled).toBe(true);
      expect(preferences.lunch_enabled).toBe(true);
      // Untouched:
      expect(preferences.breakfast_enabled).toBe(false);
      expect(preferences.water_enabled).toBe(false);
      expect(preferences.lunch_time).toBe('13:00');
      expect(preferences.created_at).toEqual(expect.any(String));
    });

    it('a second disjoint patch does not reset the first', async () => {
      await putPrefs({ meals_enabled: true, dinner_enabled: true, dinner_time: '18:45' });
      const { preferences } = await putPrefs({ water_enabled: true });
      expect(preferences.meals_enabled).toBe(true);
      expect(preferences.dinner_enabled).toBe(true);
      expect(preferences.dinner_time).toBe('18:45');
      expect(preferences.water_enabled).toBe(true);
    });

    it('round-trips a weekday list and preserves its order-independent content', async () => {
      // Stored as JSON text, so the parse/serialise pair is the risk.
      const { preferences } = await putPrefs({
        weigh_in_enabled: true,
        weigh_in_days: [2, 4, 6],
      });
      expect(preferences.weigh_in_days).toEqual([2, 4, 6]);
      expect(await getPrefs()).toMatchObject({ weigh_in_days: [2, 4, 6] });
    });

    it('accepts null weigh_in_days as an explicit "every day"', async () => {
      await putPrefs({ weigh_in_enabled: true, weigh_in_days: [3] });
      const { preferences } = await putPrefs({ weigh_in_days: null });
      expect(preferences.weigh_in_days).toBeNull();
    });

    it('stores booleans as INTEGER 0/1 and answers JS booleans', async () => {
      await putPrefs({ meals_enabled: true, quiet_hours_enabled: false });
      const row = await storedRow(UID_A);
      expect(row?.meals_enabled).toBe(1);
      expect(row?.quiet_hours_enabled).toBe(0);
      const preferences = await getPrefs();
      expect(preferences.meals_enabled).toBe(true);
      expect(preferences.quiet_hours_enabled).toBe(false);
    });

    it('keeps created_at fixed across later writes', async () => {
      const first = await putPrefs({ meals_enabled: true });
      const second = await putPrefs({ water_enabled: true });
      expect(second.preferences.created_at).toBe(first.preferences.created_at);
      expect(String(second.preferences.updated_at) >= String(first.preferences.created_at)).toBe(
        true
      );
    });

    it('an empty PUT on an existing row is a no-op, not a reset to the defaults', async () => {
      // Same asymmetry as the activity flags: on a fresh account `PUT {}`
      // materialises the defaults; on a saved one it must only touch stamps. A
      // reset here would silently switch off every reminder the member set.
      await putPrefs({ meals_enabled: true, lunch_enabled: true, lunch_time: '12:15' });
      const { preferences } = await putPrefs({});
      expect(preferences.meals_enabled).toBe(true);
      expect(preferences.lunch_enabled).toBe(true);
      expect(preferences.lunch_time).toBe('12:15');
    });

    it('ignores unknown keys instead of storing them', async () => {
      const { preferences } = await putPrefs({
        meals_enabled: true,
        brunch_enabled: true,
      });
      expect((preferences as Record<string, unknown>).brunch_enabled).toBeUndefined();
      expect(preferences.meals_enabled).toBe(true);
    });
  });

  /* =========================== 3. VALIDATION ========================= */

  describe('validation', () => {
    /**
     * Every one of these is a time that either never fires or fires at the wrong
     * hour once stored. `'7:05'` is included deliberately: it is a legal-looking
     * value the SERVICE's own parser accepts (`parseHhmmToMinutes` allows 1-2
     * digit hours) but the ROUTE refuses, so the stored format stays exactly one
     * shape.
     */
    const BAD_TIMES = ['25:00', '24:00', '12:60', '7:05', '0830', '08:30:00', '', 'noon', '08-30'];

    it.each(['breakfast_time', 'lunch_time', 'snack_time', 'dinner_time'])(
      'rejects a malformed %s',
      async (field) => {
        for (const value of BAD_TIMES) {
          const res = await call('PUT', { body: { [field]: value } });
          expect(res.status, `${field} = ${JSON.stringify(value)}`).toBe(400);
        }
        expect(await storedRow(UID_A)).toBeNull();
      }
    );

    it.each(['water_start_time', 'water_end_time', 'quiet_hours_start', 'quiet_hours_end'])(
      'rejects a malformed %s',
      async (field) => {
        for (const value of BAD_TIMES) {
          const res = await call('PUT', { body: { [field]: value } });
          expect(res.status, `${field} = ${JSON.stringify(value)}`).toBe(400);
        }
      }
    );

    it('accepts both ends of the 24h clock', async () => {
      const { preferences } = await putPrefs({ breakfast_time: '00:00', dinner_time: '23:59' });
      expect(preferences.breakfast_time).toBe('00:00');
      expect(preferences.dinner_time).toBe('23:59');
    });

    it('rejects an EMPTY weekday list — [] would mean "never"', async () => {
      // A settings screen that clears every checkbox while the toggle is on has
      // a bug. Storing `[]` hides it: the member sees "on" and gets nothing.
      const res = await call('PUT', { body: { weigh_in_days: [] } });
      expect(res.status).toBe(400);
    });

    it.each([[0], [8], [-1], [3.5], ['2']])(
      'rejects an out-of-range weekday %j',
      async (day) => {
        const res = await call('PUT', { body: { weigh_in_days: [day] } });
        expect(res.status).toBe(400);
      }
    );

    it('rejects more than seven weekdays', async () => {
      const res = await call('PUT', { body: { weigh_in_days: [1, 2, 3, 4, 5, 6, 7, 1] } });
      expect(res.status).toBe(400);
    });

    it('accepts the full week and a single day', async () => {
      expect((await putPrefs({ weigh_in_days: [1, 2, 3, 4, 5, 6, 7] })).preferences.weigh_in_days)
        .toHaveLength(7);
      expect((await putPrefs({ weigh_in_days: [7] })).preferences.weigh_in_days).toEqual([7]);
    });

    it('clamps nothing silently — a water interval below the floor is a 400', async () => {
      // The floor exists because a 5-minute "reminder" is a metronome. Silently
      // clamping would leave the settings screen showing a number the server
      // does not honour.
      for (const minutes of [0, 1, 14, MIN_WATER_INTERVAL_MINUTES - 1]) {
        const res = await call('PUT', { body: { water_interval_minutes: minutes } });
        expect(res.status, `interval ${minutes}`).toBe(400);
      }
    });

    it('rejects a water interval above the twelve-hour ceiling', async () => {
      for (const minutes of [MAX_WATER_INTERVAL_MINUTES + 1, 24 * 60]) {
        const res = await call('PUT', { body: { water_interval_minutes: minutes } });
        expect(res.status, `interval ${minutes}`).toBe(400);
      }
    });

    it('accepts both interval bounds exactly', async () => {
      expect(
        (await putPrefs({ water_interval_minutes: MIN_WATER_INTERVAL_MINUTES })).preferences
          .water_interval_minutes
      ).toBe(MIN_WATER_INTERVAL_MINUTES);
      expect(
        (await putPrefs({ water_interval_minutes: MAX_WATER_INTERVAL_MINUTES })).preferences
          .water_interval_minutes
      ).toBe(MAX_WATER_INTERVAL_MINUTES);
    });

    it('rejects a non-integer water interval', async () => {
      expect((await call('PUT', { body: { water_interval_minutes: 30.5 } })).status).toBe(400);
      expect((await call('PUT', { body: { water_interval_minutes: '30' } })).status).toBe(400);
    });

    it.each([
      'meals_enabled',
      'breakfast_enabled',
      'water_enabled',
      'weigh_in_enabled',
      'skip_if_already_logged',
      'quiet_hours_enabled',
    ])('400s a non-boolean %s', async (field) => {
      // `0`/`1` is what a client mirroring the SQLite column sends; coercing it
      // would turn an opt-out into an opt-in.
      for (const value of ['true', 1, 0, null, []]) {
        const res = await call('PUT', { body: { [field]: value } });
        expect(res.status, `${field} = ${JSON.stringify(value)}`).toBe(400);
      }
    });

    it('rejects an empty-string timezone but accepts null', async () => {
      // null is the documented "fall back to the platform row"; '' is a client
      // that sent a blank field, and would be handed to Intl as a zone id.
      expect((await call('PUT', { body: { timezone: '' } })).status).toBe(400);
      expect((await putPrefs({ timezone: null })).preferences.timezone).toBeNull();
      expect((await putPrefs({ timezone: 'Europe/Berlin' })).preferences.timezone).toBe(
        'Europe/Berlin'
      );
    });

    it('a rejected write leaves the stored row untouched', async () => {
      await putPrefs({ meals_enabled: true, lunch_time: '12:30' });
      const before = await storedRow(UID_A);
      const res = await call('PUT', { body: { lunch_time: '99:99', dinner_enabled: true } });
      expect(res.status).toBe(400);
      // All-or-nothing: the VALID half of the body must not land either.
      expect(await storedRow(UID_A)).toEqual(before);
    });

    it('rejects malformed JSON and non-object bodies with a 400, never a 500', async () => {
      for (const raw of ['{"meals_enabled":', '[]', '"nope"', '42', 'null']) {
        const res = await call('PUT', { rawBody: raw });
        expect(res.status, raw).toBe(400);
      }
    });
  });

  /* ================= 4. THE QUEUE SIDE-EFFECT OF A SAVE =============== */

  describe('changing the schedule drops the queue', () => {
    it('turning a category OFF cancels the queued nudges and reports how many', async () => {
      // Without this the member keeps being pushed on the old schedule for up to
      // a day after switching it off, which reads as a broken switch.
      await putPrefs({ meals_enabled: true, water_enabled: true });
      await queueReminder(UID_A, { id: 'q1' });
      await queueReminder(UID_A, { id: 'q2' });

      const { cancelled } = await putPrefs({ water_enabled: false });
      expect(cancelled).toBe(2);
      expect(await queueIds()).toEqual([]);
    });

    it('changing a TIME cancels too — yesterday queue is wrong the moment it moves', async () => {
      await putPrefs({ meals_enabled: true, lunch_enabled: true });
      await queueReminder(UID_A, { id: 'q1' });
      const { cancelled } = await putPrefs({ lunch_time: '14:00' });
      expect(cancelled).toBe(1);
      expect(await queueIds()).toEqual([]);
    });

    it('changing the TIMEZONE cancels — every queued UTC instant was resolved from it', async () => {
      await queueReminder(UID_A, { id: 'q1' });
      const { cancelled } = await putPrefs({ timezone: 'Asia/Tokyo' });
      expect(cancelled).toBe(1);
    });

    it('turning something ON does not cancel — nothing queued has become wrong', async () => {
      await queueReminder(UID_A, { id: 'q1' });
      const { cancelled } = await putPrefs({ meals_enabled: true });
      expect(cancelled).toBe(0);
      expect(await queueIds()).toEqual(['q1']);
    });

    it('a no-op PUT reports zero cancelled', async () => {
      await queueReminder(UID_A, { id: 'q1' });
      expect((await putPrefs({})).cancelled).toBe(0);
      expect(await queueIds()).toEqual(['q1']);
    });

    it('never cancels a nudge that was already SENT', async () => {
      // A delivered nudge is history and belongs in the in-app notification
      // centre whatever the member changes afterwards.
      await queueReminder(UID_A, { id: 'sent', sent: true });
      await queueReminder(UID_A, { id: 'pending' });
      const { cancelled } = await putPrefs({ meals_enabled: false, lunch_time: '11:00' });
      expect(cancelled).toBe(1);
      expect(await queueIds()).toEqual(['sent']);
    });

    it('never cancels another feature queued rows', async () => {
      // The queue is shared with the mortgage statement reminder, task
      // reminders and everything else. Only `reference_type = 'health_reminder'`
      // is ours to drop.
      await queueReminder(UID_A, { id: 'mortgage', referenceType: 'mortgage_statement' });
      await queueReminder(UID_A, { id: 'health' });
      const { cancelled } = await putPrefs({ lunch_time: '11:00' });
      expect(cancelled).toBe(1);
      expect(await queueIds()).toEqual(['mortgage']);
    });

    it('never cancels another member queued rows', async () => {
      await queueReminder(UID_B, { id: 'bob' });
      await queueReminder(UID_A, { id: 'alice' });
      const { cancelled } = await putPrefs({ lunch_time: '11:00' }, tokenA);
      expect(cancelled).toBe(1);
      expect(await queueIds()).toEqual(['bob']);
    });
  });

  /* ========================= 5. DELETE / TOMBSTONE ==================== */

  describe('DELETE — wiping the setup', () => {
    it('tombstones the row, drops the queue and reports both', async () => {
      await putPrefs({ meals_enabled: true, water_enabled: true });
      await queueReminder(UID_A, { id: 'q1' });
      await queueReminder(UID_A, { id: 'q2' });

      const res = await call('DELETE');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ deleted: true, cancelled: 2 });
      expect(await queueIds()).toEqual([]);
    });

    it('a wiped member reads the defaults again, not the old row', async () => {
      await putPrefs({ meals_enabled: true, lunch_enabled: true, lunch_time: '12:15' });
      await call('DELETE');
      const preferences = await getPrefs();
      expect(preferences.meals_enabled).toBe(false);
      expect(preferences.lunch_time).toBe('13:00');
      expect(preferences.created_at).toBeNull();
    });

    it('the row is TOMBSTONED, not physically removed', async () => {
      // A hard delete would be indistinguishable from "never configured" for a
      // device holding a stale cache; the tombstone is what makes the delete
      // propagate.
      await putPrefs({ meals_enabled: true });
      await call('DELETE');
      const row = await storedRow(UID_A);
      expect(row).not.toBeNull();
      expect(row?.deleted_at).toEqual(expect.any(String));
    });

    /**
     * FIXED — a wipe used to be undone by the next save.
     *
     * `savePreferences` now detects that the conflict target is a TOMBSTONE
     * (its own prior `SELECT`, not the patch) and, only in that case, SETs the
     * full `HEALTH_REMINDER_DEFAULTS` shape merged with the incoming patch —
     * matching the same "defaults + patch" the INSERT branch already used, so
     * reviving a wiped row behaves like a fresh row rather than an edit of dead
     * data. An ordinary edit of a LIVE row is untouched: it still partial-merges,
     * because resetting the rest of the row to defaults on every edit would be
     * its own, worse bug.
     */
    it('re-saving after a wipe restores defaults, not the pre-wipe values', async () => {
      await putPrefs({ meals_enabled: true, dinner_enabled: true, dinner_time: '18:00' });
      await call('DELETE');

      const { preferences } = await putPrefs({ water_enabled: true });
      expect(preferences.water_enabled).toBe(true);
      // The wiped setup does NOT come back — only the fields in THIS patch
      // deviate from HEALTH_REMINDER_DEFAULTS.
      expect(preferences.meals_enabled).toBe(false);
      expect(preferences.dinner_enabled).toBe(false);
      expect(preferences.dinner_time).toBe('19:00');
      // The tombstone is cleared, so the reset row is live and schedulable.
      expect((await storedRow(UID_A))?.deleted_at).toBeNull();
    });

    it('an ordinary edit of a LIVE row still partial-merges (no reset)', async () => {
      await putPrefs({ meals_enabled: true, dinner_enabled: true, dinner_time: '18:00' });
      const { preferences } = await putPrefs({ water_enabled: true });
      expect(preferences.water_enabled).toBe(true);
      // Untouched fields on a row that was never tombstoned must survive.
      expect(preferences.meals_enabled).toBe(true);
      expect(preferences.dinner_enabled).toBe(true);
      expect(preferences.dinner_time).toBe('18:00');
    });

    it('a wiped setup stays invisible until something is saved', async () => {
      // The half of the tombstone contract that DOES hold: while the row is
      // tombstoned the member reads the defaults, so the wipe is honoured right
      // up until the next write (see the defect above).
      await putPrefs({ meals_enabled: true, dinner_time: '18:00' });
      await call('DELETE');
      const preferences = await getPrefs();
      expect(preferences.meals_enabled).toBe(false);
      expect(preferences.dinner_time).toBe('19:00');
      expect((await storedRow(UID_A))?.deleted_at).toEqual(expect.any(String));
    });

    it('is idempotent — deleting twice still 200s', async () => {
      await putPrefs({ meals_enabled: true });
      expect((await call('DELETE')).status).toBe(200);
      const second = await call('DELETE');
      expect(second.status).toBe(200);
      expect(await second.json()).toEqual({ deleted: true, cancelled: 0 });
    });

    it('deleting an account that never configured anything still 200s', async () => {
      const res = await call('DELETE');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ deleted: true, cancelled: 0 });
    });
  });

  /* =============== 6. AUTH, BRAND GATE, CROSS-USER =================== */

  describe('access control', () => {
    const VERBS: ReadonlyArray<readonly [string, unknown?]> = [
      ['GET'],
      ['PUT', { meals_enabled: true }],
      ['DELETE'],
    ];

    it('401s every verb without a bearer token', async () => {
      const open: string[] = [];
      for (const [method, body] of VERBS) {
        const res = await call(method, { token: null, body });
        if (res.status !== 401) open.push(`${method} -> ${res.status}`);
      }
      expect(open).toEqual([]);
      expect(await storedRow(UID_A)).toBeNull();
    });

    it('401s a forged and a malformed token', async () => {
      const forged = await mintToken(UID_A, 'an-attacker-secret-32-chars-minimum');
      expect((await call('GET', { token: forged })).status).toBe(401);
      expect((await call('GET', { token: 'not-a-jwt' })).status).toBe(401);
    });

    it.each([
      ['symply-house', HOUSE_ENV],
      ['symply-budget', BUDGET_ENV],
      ['symply-kaizen', KAIZEN_ENV],
    ])('404s every verb on %s', async (_brand, brandEnv) => {
      const leaked: string[] = [];
      for (const [method, body] of VERBS) {
        const res = await call(method, { token: tokenA, body, brandEnv });
        if (res.status !== 404) leaked.push(`${method} -> ${res.status}`);
      }
      expect(leaked).toEqual([]);
      expect(await storedRow(UID_A)).toBeNull();
    });

    it('the gate fires BEFORE auth — a tokenless wrong-brand call 404s, never 401s', async () => {
      // A 401 would confirm the endpoint exists on that brand.
      const res = await call('GET', { token: null, brandEnv: BUDGET_ENV });
      expect(res.status).toBe(404);
    });

    it('no verb 5xxs on a cold, empty account', async () => {
      const crashed: string[] = [];
      for (const [method, body] of VERBS) {
        const res = await call(method, { token: tokenA, body });
        if (res.status >= 500) crashed.push(`${method} -> ${res.status}`);
      }
      expect(crashed).toEqual([]);
    });

    it('keeps the user_id-keyed upsert in separate lanes', async () => {
      // `user_id` IS the primary key here — the classic place for a missing user
      // filter to overwrite a stranger's row instead of inserting a new one.
      await putPrefs({ meals_enabled: true, lunch_time: '12:00' }, tokenA);
      await putPrefs({ water_enabled: true, water_start_time: '07:00' }, tokenB);

      const a = await getPrefs(tokenA);
      const b = await getPrefs(tokenB);
      expect(a.meals_enabled).toBe(true);
      expect(a.water_enabled).toBe(false);
      expect(a.lunch_time).toBe('12:00');
      expect(b.water_enabled).toBe(true);
      expect(b.meals_enabled).toBe(false);
      expect(b.water_start_time).toBe('07:00');
    });

    it('B reads the defaults, not A saved schedule', async () => {
      await putPrefs({ meals_enabled: true, dinner_time: '20:30' }, tokenA);
      const b = await getPrefs(tokenB);
      expect(b.meals_enabled).toBe(false);
      expect(b.dinner_time).toBe('19:00');
      expect(b.updated_at).toBeNull();
    });

    it('B DELETE cannot wipe A setup', async () => {
      await putPrefs({ meals_enabled: true }, tokenA);
      const res = await call('DELETE', { token: tokenB });
      expect(res.status).toBe(200);
      // A's row survives, live.
      expect((await getPrefs(tokenA)).meals_enabled).toBe(true);
      expect((await storedRow(UID_A))?.deleted_at).toBeNull();
    });
  });

  /* ================= 7. THE PLANNER (pure, no I/O) =================== */

  describe('planRemindersForDay', () => {
    it('emits nothing when every category is off', () => {
      expect(planRemindersForDay(prefs(), MONDAY)).toEqual([]);
    });

    it('needs BOTH the master and the per-slot switch for a meal', () => {
      // The master is what a "meal reminders" toggle flips; the per-slot flags
      // are what someone who only wants a dinner nudge sets.
      expect(planRemindersForDay(prefs({ lunch_enabled: true }), MONDAY)).toEqual([]);
      expect(planRemindersForDay(prefs({ meals_enabled: true }), MONDAY)).toEqual([]);
      const both = planRemindersForDay(
        prefs({ meals_enabled: true, lunch_enabled: true }),
        MONDAY
      );
      expect(both).toHaveLength(1);
      expect(both[0].type).toBe(HEALTH_MEAL_REMINDER_TYPE);
      expect(both[0].slot).toBe('lunch');
    });

    it('places each meal at its own local minute and sorts the day', () => {
      const plan = planRemindersForDay(
        prefs({
          meals_enabled: true,
          breakfast_enabled: true,
          lunch_enabled: true,
          dinner_enabled: true,
        }),
        MONDAY
      );
      expect(plan.map((p) => p.slot)).toEqual(['breakfast', 'lunch', 'dinner']);
      expect(plan.map((p) => p.minutes)).toEqual([8 * 60 + 30, 13 * 60, 19 * 60]);
    });

    it('sends every meal nudge to the nutrition screen, and the weigh-in to weight', () => {
      // The tap target is part of the contract: a reminder that opens the wrong
      // tab makes the member hunt for the thing they were just asked to do.
      const plan = planRemindersForDay(
        prefs({
          meals_enabled: true,
          dinner_enabled: true,
          weigh_in_enabled: true,
          quiet_hours_enabled: false,
        }),
        MONDAY
      );
      const byType = Object.fromEntries(plan.map((p) => [p.type, p.screen]));
      expect(byType[HEALTH_MEAL_REMINDER_TYPE]).toBe('/health-nutrition');
      expect(byType[HEALTH_WEIGH_IN_REMINDER_TYPE]).toBe('/health-weight');
    });

    it('honours a weekday list for the weigh-in', () => {
      // MONDAY is weekday 2 in the 1 = Sunday scheme.
      const on = prefs({ weigh_in_enabled: true, weigh_in_days: [2], quiet_hours_enabled: false });
      const off = prefs({ weigh_in_enabled: true, weigh_in_days: [3], quiet_hours_enabled: false });
      expect(planRemindersForDay(on, MONDAY)).toHaveLength(1);
      expect(planRemindersForDay(off, MONDAY)).toEqual([]);
    });

    it('treats a null weekday list as every day', () => {
      const every = prefs({
        weigh_in_enabled: true,
        weigh_in_days: null,
        quiet_hours_enabled: false,
      });
      for (let weekday = 1; weekday <= 7; weekday += 1) {
        expect(planRemindersForDay(every, { iso: '2026-08-03', weekday })).toHaveLength(1);
      }
    });

    it('walks the water window at the configured interval', () => {
      const plan = planRemindersForDay(
        prefs({
          water_enabled: true,
          water_start_time: '09:00',
          water_end_time: '15:00',
          water_interval_minutes: 120,
          quiet_hours_enabled: false,
        }),
        MONDAY
      );
      expect(plan.map((p) => p.minutes)).toEqual([540, 660, 780, 900]);
      expect(plan.every((p) => p.type === HEALTH_WATER_REMINDER_TYPE)).toBe(true);
    });

    it('caps water at the daily ceiling rather than pinging all day', () => {
      // A 09:00-21:00 window at the 15-minute floor is 48 pings. Nobody wants 48
      // pings, and the excess is dropped from the END of the day so the member
      // keeps their morning cadence.
      const plan = planRemindersForDay(
        prefs({
          water_enabled: true,
          water_start_time: '09:00',
          water_end_time: '21:00',
          water_interval_minutes: MIN_WATER_INTERVAL_MINUTES,
          quiet_hours_enabled: false,
        }),
        MONDAY
      );
      expect(plan).toHaveLength(MAX_WATER_REMINDERS_PER_DAY);
      expect(plan[0].minutes).toBe(540);
      expect(plan[plan.length - 1].minutes).toBe(540 + 7 * MIN_WATER_INTERVAL_MINUTES);
    });

    it('emits nothing for a water window that ends before it starts', () => {
      // Not an overnight hydration window — a mis-set field. Wrapping past
      // midnight would nudge somebody at 03:00 for a typo.
      const plan = planRemindersForDay(
        prefs({
          water_enabled: true,
          water_start_time: '21:00',
          water_end_time: '09:00',
          quiet_hours_enabled: false,
        }),
        MONDAY
      );
      expect(plan).toEqual([]);
    });

    it('emits nothing for a zero-length water window', () => {
      const plan = planRemindersForDay(
        prefs({
          water_enabled: true,
          water_start_time: '09:00',
          water_end_time: '09:00',
          quiet_hours_enabled: false,
        }),
        MONDAY
      );
      expect(plan).toEqual([]);
    });

    it('clamps a stored out-of-range interval instead of exploding', () => {
      // The route refuses these, but a row written before the bound existed (or
      // by a migration) must degrade rather than emit hundreds of rows.
      const plan = planRemindersForDay(
        prefs({
          water_enabled: true,
          water_start_time: '09:00',
          water_end_time: '21:00',
          water_interval_minutes: 1,
          quiet_hours_enabled: false,
        }),
        MONDAY
      );
      expect(plan.length).toBeLessThanOrEqual(MAX_WATER_REMINDERS_PER_DAY);
      expect(plan[1].minutes - plan[0].minutes).toBe(MIN_WATER_INTERVAL_MINUTES);
    });

    it('suppresses a nudge inside quiet hours instead of queueing it', () => {
      // Enforced at PLAN time, not delivery: a suppressed nudge that still
      // existed in the queue would surface in the in-app notification centre at
      // exactly the moment it was suppressed from the lock screen.
      const plan = planRemindersForDay(
        prefs({
          meals_enabled: true,
          breakfast_enabled: true,
          breakfast_time: '06:00',
          quiet_hours_enabled: true,
        }),
        MONDAY
      );
      expect(plan).toEqual([]);
    });

    it('stops suppressing when quiet hours are switched off', () => {
      const plan = planRemindersForDay(
        prefs({
          meals_enabled: true,
          breakfast_enabled: true,
          breakfast_time: '06:00',
          quiet_hours_enabled: false,
        }),
        MONDAY
      );
      expect(plan).toHaveLength(1);
    });

    it('spends the water allowance on AUDIBLE nudges only', () => {
      // A window overlapping the quiet block must still get its full allowance
      // of nudges the member can actually hear — the suppressed ones are not
      // charged against the cap.
      const plan = planRemindersForDay(
        prefs({
          water_enabled: true,
          water_start_time: '05:00',
          water_end_time: '21:00',
          water_interval_minutes: 60,
          quiet_hours_enabled: true,
          quiet_hours_start: '23:00',
          quiet_hours_end: '07:00',
        }),
        MONDAY
      );
      expect(plan).toHaveLength(MAX_WATER_REMINDERS_PER_DAY);
      // Nothing before 07:00 survived.
      expect(Math.min(...plan.map((p) => p.minutes))).toBeGreaterThanOrEqual(7 * 60);
    });

    it('emits no habit nudges — those are materialised by their own module', () => {
      // `services/health/habit-reminder.ts` owns habit reminders off
      // `user_habits.reminder_*`. Emitting them here as well would double every
      // habit push.
      const plan = planRemindersForDay(
        prefs({
          meals_enabled: true,
          lunch_enabled: true,
          water_enabled: true,
          weigh_in_enabled: true,
          quiet_hours_enabled: false,
        }),
        MONDAY
      );
      const types = new Set(plan.map((p) => p.type));
      expect([...types].sort()).toEqual(
        [HEALTH_MEAL_REMINDER_TYPE, HEALTH_WATER_REMINDER_TYPE, HEALTH_WEIGH_IN_REMINDER_TYPE].sort()
      );
    });

    it('is deterministic for the same member and day, and varies the copy across days', () => {
      // Copy is rotated per day so an identical string every morning stops being
      // read after a week — but it must be stable within a day, or a re-run of
      // the materialiser would rewrite a queued nudge is text.
      const p = prefs({ meals_enabled: true, lunch_enabled: true, quiet_hours_enabled: false });
      const monA = planRemindersForDay(p, MONDAY);
      const monB = planRemindersForDay(p, MONDAY);
      expect(monA[0].title).toBe(monB[0].title);
      expect(monA[0].body).toBe(monB[0].body);

      const week = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'].map(
        (iso) => planRemindersForDay(p, { iso, weekday: 2 })[0].title
      );
      expect(new Set(week).size).toBeGreaterThan(1);
    });

    it('never emits a nudge with empty copy', () => {
      const plan = planRemindersForDay(
        prefs({
          meals_enabled: true,
          breakfast_enabled: true,
          lunch_enabled: true,
          snack_enabled: true,
          dinner_enabled: true,
          water_enabled: true,
          weigh_in_enabled: true,
          quiet_hours_enabled: false,
        }),
        MONDAY
      );
      expect(plan.length).toBeGreaterThan(0);
      for (const item of plan) {
        expect(item.title.length, JSON.stringify(item)).toBeGreaterThan(0);
        expect(item.body.length, JSON.stringify(item)).toBeGreaterThan(0);
        expect(item.screen.startsWith('/')).toBe(true);
      }
    });
  });

  /* ==================== 8. TIME PRIMITIVES (pure) ==================== */

  describe('time primitives', () => {
    it('parses HH:MM to minutes from local midnight', () => {
      expect(parseHhmmToMinutes('00:00')).toBe(0);
      expect(parseHhmmToMinutes('08:30')).toBe(510);
      expect(parseHhmmToMinutes('23:59')).toBe(1439);
      // The service parser is deliberately looser than the route validator.
      expect(parseHhmmToMinutes('7:05')).toBe(425);
      expect(parseHhmmToMinutes(' 08:30 ')).toBe(510);
    });

    it('returns null rather than a wrong number for junk', () => {
      for (const bad of ['24:00', '12:60', '', '0830', 'noon', null, undefined, '08:30:00']) {
        expect(parseHhmmToMinutes(bad as string), String(bad)).toBeNull();
      }
    });

    it('treats a quiet window that WRAPS past midnight correctly', () => {
      // The default 23:00 → 07:00 crosses midnight. The naive
      // `start <= x < end` comparison reads it as empty — i.e. a 03:00 push.
      expect(isWithinQuietHours(3 * 60, '23:00', '07:00')).toBe(true);
      expect(isWithinQuietHours(23 * 60 + 30, '23:00', '07:00')).toBe(true);
      expect(isWithinQuietHours(12 * 60, '23:00', '07:00')).toBe(false);
      // Boundaries: start is inside, end is outside.
      expect(isWithinQuietHours(23 * 60, '23:00', '07:00')).toBe(true);
      expect(isWithinQuietHours(7 * 60, '23:00', '07:00')).toBe(false);
    });

    it('handles a same-day quiet window', () => {
      expect(isWithinQuietHours(13 * 60, '12:00', '14:00')).toBe(true);
      expect(isWithinQuietHours(11 * 60, '12:00', '14:00')).toBe(false);
      expect(isWithinQuietHours(14 * 60, '12:00', '14:00')).toBe(false);
    });

    it('treats a degenerate window as no quiet hours at all', () => {
      // start === end could mean "always quiet" or "never quiet". Never is the
      // only safe reading: always would silently mute the whole feature.
      expect(isWithinQuietHours(3 * 60, '23:00', '23:00')).toBe(false);
      expect(isWithinQuietHours(3 * 60, 'junk', '07:00')).toBe(false);
    });

    it('resolves the local calendar day and weekday in a zone', () => {
      // 2026-08-03T23:30Z is already 2026-08-04 in Tokyo — the exact off-by-one
      // day that puts a Monday weigh-in on a Tuesday.
      const utcLate = new Date('2026-08-03T23:30:00.000Z');
      expect(localDateParts(utcLate, 'UTC', 0).iso).toBe('2026-08-03');
      expect(localDateParts(utcLate, 'Asia/Tokyo', 0).iso).toBe('2026-08-04');
    });

    it('offsets by calendar day, not by adding 24 hours', () => {
      const now = new Date('2026-08-03T12:00:00.000Z');
      expect(localDateParts(now, 'UTC', 1).iso).toBe('2026-08-04');
      // 2026-08-03 is a Monday → 2 in the 1 = Sunday scheme.
      expect(localDateParts(now, 'UTC', 0).weekday).toBe(2);
      expect(localDateParts(now, 'UTC', 1).weekday).toBe(3);
      // Crossing a month boundary must roll the month, not the day number.
      expect(localDateParts(new Date('2026-08-31T12:00:00.000Z'), 'UTC', 1).iso).toBe('2026-09-01');
    });

    it('falls back to the UTC day for an unusable timezone instead of throwing', () => {
      // A bad zone id degrades; hard-coding an allowlist would break the day
      // tzdata adds a zone.
      const now = new Date('2026-08-03T12:00:00.000Z');
      expect(localDateParts(now, 'Not/AZone', 0).iso).toBe('2026-08-03');
    });
  });
});
