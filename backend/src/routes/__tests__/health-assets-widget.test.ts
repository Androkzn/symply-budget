/**
 * Symply Health — the WIDGET half of `src/routes/health-assets.ts`, in depth.
 *
 * `GET/PUT /health/widget/preferences` and `GET /health/widget/snapshot` are the
 * Worker side of the Home Screen widget and the Apple Watch glance. They are no
 * longer clientless: `src/api/healthAssets.ts` → `healthWidgetStorage.ts` reads
 * the snapshot on launch and republishes it into the shared App Group, so what
 * this router returns is what a member sees on a LOCKED screen.
 *
 * `health-assets.test.ts` already covers the brand gate, the auth sweep, the
 * happy-path derivation, the fixed key set, the `show_*` toggles, the small-slot
 * metric and the sensitive-domain exclusion sweep. NOTHING here repeats those.
 * This file covers what that suite does not reach:
 *
 *   1. the DEFAULTED date (the client may omit `?date=`) and how far the
 *      shape-only date validator actually goes,
 *   2. the preference PATCH semantics at their edges — an empty patch, an
 *      unknown key, a null value, and every in-contract enum value,
 *   3. the JSON TYPES the client decodes (`show_*` must be booleans, not D1's
 *      0/1 integers — `isWidgetPreferences()` on the RN side rejects the row
 *      otherwise and silently falls back to defaults),
 *   4. CROSS-USER isolation of the snapshot itself, not just of the preference
 *      row: A's tracking data and A's privacy toggles must not shape B's glance,
 *   5. the surface SHAPE — the verbs that do not exist must 404.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import { HealthService } from '../../services/health-service';
import type { Env } from '../../types';
import healthAssetsRoutes from '../health-assets';

import {
  createHealthAssetTables,
  createHealthTables,
  resetHealthAssetTables,
  resetHealthTables,
  seedHealthUsers,
} from './health-test-helpers';

const testEnv = env as unknown as Env;
const HEALTH_ENV = { ...testEnv, APP_BRAND: 'symply-health' } as Env;

const UID_A = 'u_widget_alice';
const UID_B = 'u_widget_bob';

/** A fixed "personal" day — nothing below depends on the wall clock… */
const D1 = '2026-06-01';
/** …except the default-date spec, which must use the day the Worker picks. */
const UTC_TODAY = new Date().toISOString().slice(0, 10);

interface WidgetPreferences {
  small_widget_metric: string;
  chart_type: string;
  chart_metric: string;
  show_weight: boolean;
  show_nutrition: boolean;
  show_workouts: boolean;
  small_widget_style: string;
  medium_widget_layout: string;
  medium_primary_metric: string;
  medium_secondary_metric: string;
  medium_show_all_metrics: boolean;
}

interface WeightTrend {
  unit: string;
  entries: Array<{ date: string; weight: number }>;
  avg_this_week: number | null;
  avg_last_week: number | null;
  starting_weight_kg: number | null;
  starting_weight_date: string | null;
  progress_from_start: number | null;
  progress_percentage: number | null;
}

interface NutritionTrend {
  entries: Array<{ date: string; calories: number }>;
  avg_this_week: number;
  avg_last_week: number;
}

interface Snapshot {
  date: string;
  generated_at: string;
  preferences: WidgetPreferences;
  small: { metric: string; value: number; goal: number | null };
  steps: { value: number; goal: number | null };
  water: { total_ml: number; goal_ml: number | null };
  weight: { value: number; unit: string; date: string } | null;
  weight_trend: WeightTrend | null;
  nutrition: Record<string, number | null> | null;
  nutrition_trend: NutritionTrend | null;
  workouts: { count: number; minutes: number; calories: number; goal_minutes: number | null } | null;
}

async function mintToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(testEnv.JWT_SECRET ?? 'test-jwt-secret-32-chars-minimum');
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

/** Mirrors the `app.route('/health', healthAssetsRoutes)` mount in src/index.ts. */
function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/health', healthAssetsRoutes);
  return app;
}

let tokenA = '';
let tokenB = '';

async function call(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {}
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = opts.token ?? tokenA;
  if (token) headers.Authorization = `Bearer ${token}`;
  // GET/HEAD may not carry one, and `undici` throws rather than ignoring it.
  const bodyless = method === 'GET' || method === 'HEAD';
  const body = bodyless || opts.body === undefined ? undefined : JSON.stringify(opts.body);
  return mkApp().request(`/health${path}`, { method, headers, body }, HEALTH_ENV);
}

async function readPrefs(token: string): Promise<WidgetPreferences> {
  const res = await call('GET', '/widget/preferences', { token });
  expect(res.status).toBe(200);
  return ((await res.json()) as { preferences: WidgetPreferences }).preferences;
}

async function putPrefs(token: string, body: unknown): Promise<Response> {
  return call('PUT', '/widget/preferences', { token, body });
}

async function readSnapshot(token: string, query = ''): Promise<Snapshot> {
  const res = await call('GET', `/widget/snapshot${query}`, { token });
  expect(res.status).toBe(200);
  return ((await res.json()) as { snapshot: Snapshot }).snapshot;
}

/** The P1 tracking rows a snapshot is DERIVED from, for one user and one day. */
async function seedTracking(userId: string, date: string) {
  const health = new HealthService(testEnv.DB);
  await health.saveGoal(userId, date, {
    daily_calories: 2000,
    daily_water_ml: 2000,
    daily_steps: 10000,
  });
  await health.createWeight(userId, { date, weight: 70.5, unit: 'kg' });
  await health.createWater(userId, { date, amount_ml: 500 });
  await health.createNutrition(userId, {
    date,
    food_name: 'Eggs',
    meal_type: 'breakfast',
    calories: 300,
    proteins: 20,
    carbohydrates: 5,
    fats: 10,
  });
  await health.setSteps(userId, date, 8000);
  await health.createHealthEntry(userId, {
    date,
    entry_type: 'workout',
    data: { workout_type: 'run', minutes: 30, calories: 250 },
  });
}

describe('health widget routes — preferences + snapshot', () => {
  beforeEach(async () => {
    await createHealthTables(testEnv.DB);
    await createHealthAssetTables(testEnv.DB);
    await resetHealthAssetTables(testEnv.DB);
    await resetHealthTables(testEnv.DB);
    await seedHealthUsers(testEnv.DB, [UID_A, UID_B]);
    tokenA = await mintToken(UID_A);
    tokenB = await mintToken(UID_B);
  });

  /* ===================== 1. THE DEFAULTED DATE ======================= */

  describe('snapshot date handling', () => {
    it('defaults to the current UTC day when the client omits ?date=', async () => {
      // The client normally sends its OWN local day (it has the timezone, the
      // Worker does not). The fallback still has to produce a real day's data,
      // not an empty payload — `syncHealthGlanceFromServer()` calls with a date,
      // but a bare curl / a future caller may not.
      await seedTracking(UID_A, UTC_TODAY);
      const snap = await readSnapshot(tokenA);
      expect(snap.date).toBe(UTC_TODAY);
      expect(snap.steps).toEqual({ value: 8000, goal: 10000 });
    });

    it('echoes the requested day and reads only THAT day', async () => {
      // Two days of data, one request: a snapshot that leaked yesterday's steps
      // would make the lock screen claim work the member did not do today.
      await seedTracking(UID_A, D1);
      const other = '2026-06-02';
      await new HealthService(testEnv.DB).setSteps(UID_A, other, 111);

      expect((await readSnapshot(tokenA, `?date=${D1}`)).steps.value).toBe(8000);
      expect((await readSnapshot(tokenA, `?date=${other}`)).steps.value).toBe(111);
    });

    it('validates the date SHAPE only — an impossible day is empty, not a 400', async () => {
      // `dateSchema` is `^\d{4}-\d{2}-\d{2}$`, so `2026-13-45` satisfies it and
      // the route answers 200 with the day echoed back. Pinned deliberately:
      // rejecting would be a behaviour change and the client never sends one,
      // but a future caller must not be surprised by a cheerful 200 over
      // nonsense.
      //
      // What DOES resolve is instructive, and is the real contract of every
      // "as of" figure in this payload: goals and the last known weight are read
      // as "the latest row on or before this day", with dates compared as TEXT,
      // so a lexicographically-later impossible date inherits both. The per-day
      // SUMS (steps, water, nutrition, workouts) are keyed on an exact date
      // match and are therefore zero.
      //
      // Asserting the real behaviour rather than the tidy one: that asymmetry —
      // a goal and a weight with no data behind them — is exactly what a caller
      // passing an unvalidated date would trip over.
      await seedTracking(UID_A, D1);
      const snap = await readSnapshot(tokenA, '?date=2026-13-45');
      expect(snap.date).toBe('2026-13-45');
      expect(snap.steps).toEqual({ value: 0, goal: 10000 });
      expect(snap.water.total_ml).toBe(0);
      expect(snap.weight).toEqual({ value: 70.5, unit: 'kg', date: D1 });
      expect(snap.workouts).toEqual({ count: 0, minutes: 0, calories: 0, goal_minutes: null });
    });

    it.each([
      ['an empty value', '?date='],
      ['a non-padded month', '?date=2026-6-01'],
      ['an ISO timestamp', '?date=2026-06-01T00:00:00Z'],
      ['a slashed date', '?date=2026/06/01'],
      ['trailing whitespace', '?date=2026-06-01%20'],
    ])('400s %s', async (_label, query) => {
      const res = await call('GET', `/widget/snapshot${query}`, { token: tokenA });
      expect(res.status).toBe(400);
    });

    it('stamps generated_at with a parseable ISO timestamp', async () => {
      // The only freshness signal in the payload. (Nothing consumes it yet —
      // WIDGET-019 — but a malformed stamp would foreclose that.)
      const before = Date.now();
      const snap = await readSnapshot(tokenA, `?date=${D1}`);
      const stamped = Date.parse(snap.generated_at);
      expect(Number.isNaN(stamped)).toBe(false);
      expect(stamped).toBeGreaterThanOrEqual(before - 5_000);
      expect(stamped).toBeLessThanOrEqual(Date.now() + 5_000);
    });
  });

  /* =================== 2. PREFERENCE PATCH EDGES ===================== */

  describe('preference patch semantics', () => {
    it('accepts an EMPTY patch and materialises the defaults as a real row', async () => {
      // `{}` is valid — every key is optional. It is also the only way a row is
      // created without changing anything, so the upsert must not blow up on it.
      const res = await putPrefs(tokenA, {});
      expect(res.status).toBe(200);
      expect((await res.json()) as unknown).toEqual({
        preferences: {
          small_widget_metric: 'steps',
          chart_type: 'bar',
          chart_metric: 'weight',
          show_weight: true,
          show_nutrition: true,
          show_workouts: true,
          small_widget_style: 'standard',
          medium_widget_layout: 'standard',
          medium_primary_metric: 'steps',
          medium_secondary_metric: 'calories',
          medium_show_all_metrics: true,
        },
      });
      const count = await testEnv.DB.prepare(
        'SELECT COUNT(*) AS n FROM widget_preferences WHERE user_id = ?'
      )
        .bind(UID_A)
        .first<{ n: number }>();
      expect(count?.n).toBe(1);
    });

    it('ignores an unknown key instead of 400ing or persisting it', async () => {
      // The zod object is non-strict, so a newer client sending a key this
      // Worker does not know keeps working (forward compatibility) — but the
      // key must not reach the row.
      const res = await putPrefs(tokenA, { show_weight: false, show_sleep: true });
      expect(res.status).toBe(200);
      const prefs = (await res.json()) as { preferences: Record<string, unknown> };
      expect(prefs.preferences).not.toHaveProperty('show_sleep');
      expect(Object.keys(prefs.preferences).sort()).toEqual([
        'chart_metric',
        'chart_type',
        'medium_primary_metric',
        'medium_secondary_metric',
        'medium_show_all_metrics',
        'medium_widget_layout',
        'show_nutrition',
        'show_weight',
        'show_workouts',
        'small_widget_metric',
        'small_widget_style',
      ]);
    });

    it.each([
      ['a null boolean', { show_weight: null }],
      ['a null enum', { small_widget_metric: null }],
      ['a numeric boolean', { show_nutrition: 1 }],
      ['an empty enum string', { chart_type: '' }],
      ['an array', { chart_metric: ['weight'] }],
    ])('400s %s rather than writing it', async (_label, body) => {
      // D1 enforces the 0120 CHECKs, so a missing zod rule is a 500 constraint
      // error rather than an honest 400 — and `null` in particular would violate
      // NOT NULL, which is the least helpful 500 of them all.
      const res = await putPrefs(tokenA, body);
      expect(res.status).toBe(400);
      const count = await testEnv.DB.prepare(
        'SELECT COUNT(*) AS n FROM widget_preferences WHERE user_id = ?'
      )
        .bind(UID_A)
        .first<{ n: number }>();
      expect(count?.n).toBe(0);
    });

    it.each([
      ['small_widget_metric', ['steps', 'calories', 'water']],
      ['chart_type', ['bar', 'line']],
      ['chart_metric', ['weight', 'nutrition', 'both']],
      ['small_widget_style', ['standard', 'compact', 'minimal']],
      ['medium_widget_layout', ['standard', 'dual', 'grid']],
      ['medium_primary_metric', ['steps', 'calories', 'water', 'workout']],
      ['medium_secondary_metric', ['steps', 'calories', 'water', 'workout']],
    ])('accepts every in-contract %s value', async (field, values) => {
      // The complement of the existing rejection table: a validator one value
      // too strict silently strands a real setting the UI offers.
      for (const value of values) {
        const res = await putPrefs(tokenA, { [field]: value });
        expect(res.status).toBe(200);
        expect(((await res.json()) as { preferences: Record<string, string> }).preferences[field]).toBe(
          value
        );
      }
    });

    it('returns the show_* toggles as JSON booleans, never as D1 0/1', async () => {
      // The RN client's `isWidgetPreferences()` guard requires
      // `typeof show_weight === 'boolean'`. An integer would fail the guard and
      // the app would silently fall back to the DEFAULTS — i.e. re-enable a
      // domain the member had switched off. That is a privacy regression, not a
      // cosmetic one.
      await putPrefs(tokenA, { show_weight: false, show_nutrition: false, show_workouts: true });
      const prefs = await readPrefs(tokenA);
      expect(typeof prefs.show_weight).toBe('boolean');
      expect(typeof prefs.show_nutrition).toBe('boolean');
      expect(typeof prefs.show_workouts).toBe('boolean');
      expect(prefs).toMatchObject({
        show_weight: false,
        show_nutrition: false,
        show_workouts: true,
      });

      // …and the same types survive the snapshot's embedded `preferences` block,
      // which is the copy the widget actually renders from.
      const snap = await readSnapshot(tokenA, `?date=${D1}`);
      expect(typeof snap.preferences.show_weight).toBe('boolean');
      expect(snap.preferences).toEqual(prefs);
    });

    it('a saved preference is what the snapshot reports back', async () => {
      // The snapshot embeds the preferences so the widget can lay itself out
      // without a second request. A stale copy would render a hidden domain's
      // slot as "loading" forever.
      await putPrefs(tokenA, { small_widget_metric: 'water', chart_type: 'line' });
      const snap = await readSnapshot(tokenA, `?date=${D1}`);
      expect(snap.preferences.small_widget_metric).toBe('water');
      expect(snap.preferences.chart_type).toBe('line');
      expect(snap.small.metric).toBe('water');
    });
  });

  /* ============ 3. WEEKLY TREND + STARTING-WEIGHT PROGRESS =========== */

  describe('weight_trend / nutrition_trend / workout goal_minutes', () => {
    it('weight_trend carries only LOGGED days, and averages both weeks', async () => {
      // Weight is rarely logged daily — zero-filling a missing day the way
      // nutrition does would drag the average toward 0, so the entry list is
      // logged days only (mirrors `HealthService.weeklyTrend`'s own contract).
      // D1 (2026-06-01) is a MONDAY — the start of its own Mon-Sun week — so
      // the Monday exactly 7 days later, 2026-06-08, starts the NEXT week.
      const health = new HealthService(testEnv.DB);
      await health.saveGoal(UID_A, D1, { daily_calories: 2000 });
      await health.createWeight(UID_A, { date: D1, weight: 70, unit: 'kg' });
      const nextMonday = '2026-06-08';
      await health.createWeight(UID_A, { date: nextMonday, weight: 71, unit: 'kg' });

      const snap = await readSnapshot(tokenA, `?date=${nextMonday}`);
      expect(snap.weight_trend).not.toBeNull();
      expect(snap.weight_trend!.entries).toEqual([{ date: nextMonday, weight: 71 }]);
      expect(snap.weight_trend!.avg_this_week).toBe(71);
    });

    it('computes progress_from_start against the stored starting weight', async () => {
      const health = new HealthService(testEnv.DB);
      await health.saveGoal(UID_A, D1, {
        daily_calories: 2000,
        starting_weight_kg: 80,
        starting_weight_date: '2026-01-01',
      });
      await health.createWeight(UID_A, { date: D1, weight: 76, unit: 'kg' });

      const snap = await readSnapshot(tokenA, `?date=${D1}`);
      expect(snap.weight_trend!.starting_weight_kg).toBe(80);
      expect(snap.weight_trend!.progress_from_start).toBe(-4);
      expect(snap.weight_trend!.progress_percentage).toBe(-5);
    });

    it('nutrition_trend zero-fills every day of the week, unlike weight_trend', async () => {
      await seedTracking(UID_A, D1); // logs 300 kcal on D1 only
      const snap = await readSnapshot(tokenA, `?date=${D1}`);
      expect(snap.nutrition_trend).not.toBeNull();
      expect(snap.nutrition_trend!.entries).toHaveLength(7);
      const loggedDay = snap.nutrition_trend!.entries.find((e) => e.date === D1);
      expect(loggedDay?.calories).toBe(300);
    });

    it('show_weight / show_nutrition gate the trend blocks exactly like their totals', async () => {
      await seedTracking(UID_A, D1);
      await putPrefs(tokenA, { show_weight: false, show_nutrition: false });
      const snap = await readSnapshot(tokenA, `?date=${D1}`);
      expect(snap.weight_trend).toBeNull();
      expect(snap.nutrition_trend).toBeNull();
    });

    it('workouts.goal_minutes reads the daily workout-minutes goal', async () => {
      const health = new HealthService(testEnv.DB);
      await health.saveGoal(UID_A, D1, {
        daily_calories: 2000,
        daily_workout_minutes: 45,
      });
      await health.createHealthEntry(UID_A, {
        date: D1,
        entry_type: 'workout',
        data: { workout_type: 'run', minutes: 20, calories: 150 },
      });
      const snap = await readSnapshot(tokenA, `?date=${D1}`);
      expect(snap.workouts).toEqual({ count: 1, minutes: 20, calories: 150, goal_minutes: 45 });
    });
  });

  /* ================== 4. CROSS-USER ISOLATION ======================== */

  describe('cross-user isolation of the glance itself', () => {
    it('B never sees A tracking data for the same day', async () => {
      // Health data is PERSONAL — there is no household read path by design.
      // The preference row's isolation is covered elsewhere; this is the payload
      // itself, which is the thing that reaches a lock screen.
      await seedTracking(UID_A, D1);
      const snap = await readSnapshot(tokenB, `?date=${D1}`);
      expect(snap.steps).toEqual({ value: 0, goal: null });
      expect(snap.water).toEqual({ total_ml: 0, goal_ml: null });
      expect(snap.weight).toBeNull();
      expect(snap.workouts).toEqual({ count: 0, minutes: 0, calories: 0, goal_minutes: null });
      expect(snap.small).toEqual({ metric: 'steps', value: 0, goal: null });
    });

    it("A privacy toggles do not shape B glance", async () => {
      // The `show_*` flags are per-user rows. A shared read would let one member
      // blank another's widget — or, worse, un-blank it.
      await seedTracking(UID_A, D1);
      await seedTracking(UID_B, D1);
      await putPrefs(tokenA, { show_weight: false, show_nutrition: false });

      const a = await readSnapshot(tokenA, `?date=${D1}`);
      const b = await readSnapshot(tokenB, `?date=${D1}`);
      expect(a.weight).toBeNull();
      expect(a.nutrition).toBeNull();
      expect(b.weight).toEqual({ value: 70.5, unit: 'kg', date: D1 });
      expect(b.nutrition).not.toBeNull();
    });

    it('carries no user identifier at all', async () => {
      // Nothing in the payload names the account it belongs to. The App Group
      // container is shared with this brand's widget and watch targets, and the
      // snapshot is written there verbatim.
      await seedTracking(UID_A, D1);
      const res = await call('GET', `/widget/snapshot?date=${D1}`, { token: tokenA });
      const text = await res.text();
      for (const forbidden of [UID_A, `${UID_A}@example.com`, 'user_id', 'email', 'household']) {
        expect(text).not.toContain(forbidden);
      }
    });
  });

  /* ===================== 4. THE SURFACE SHAPE ======================== */

  describe('surface shape', () => {
    it.each([
      ['POST', '/widget/preferences'],
      ['DELETE', '/widget/preferences'],
      ['PATCH', '/widget/preferences'],
      ['PUT', '/widget/snapshot'],
      ['POST', '/widget/snapshot'],
      ['GET', '/widget'],
      ['GET', '/widget/settings'],
    ])('404s %s %s — the widget surface is exactly three routes', async (method, path) => {
      // A verb that silently succeeded would be an unversioned second way to
      // write the same row. Everything the router does not declare must miss.
      const res = await call(method, path, { token: tokenA, body: {} });
      expect(res.status).toBe(404);
    });

    it('GET /widget/preferences never 404s, even for an account with no row', async () => {
      // The read is defaults-backed on purpose: a settings screen must render
      // before anything has ever been saved.
      const res = await call('GET', '/widget/preferences', { token: tokenB });
      expect(res.status).toBe(200);
    });
  });
});
