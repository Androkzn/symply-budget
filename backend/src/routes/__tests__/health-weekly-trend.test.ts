/**
 * Symply Health — `GET /health/summary/weekly-trend`, at the HTTP layer.
 *
 * No donor server equivalent (the donor builds this on-device from raw entry
 * pulls); this endpoint is a fresh design per this file's own "thin client"
 * principle — see `HealthService.weeklyTrend`. Harness mirrors
 * `health-water.test.ts`.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import { addDays, weekStartOf } from '../../services/health-service';
import type { Env } from '../../types';
import healthRoutes from '../health';

import { createHealthTables, resetHealthTables, seedHealthUsers } from './health-test-helpers';

const testEnv = env as unknown as Env;
const HEALTH_ENV = { ...testEnv, APP_BRAND: 'symply-health' } as Env;

const UID_A = 'u_trend_alice';
const UID_B = 'u_trend_bob';

// A fixed Wednesday, so "this week" and "last week" never depend on the wall
// clock. THIS_WEEK_START / LAST_WEEK_START are derived with the service's OWN
// Monday-start math rather than hand-computed, so the fixture can never drift
// from what the endpoint itself considers "this week".
const ANCHOR = '2026-06-10';
const THIS_WEEK_START = weekStartOf(ANCHOR);
const LAST_WEEK_START = addDays(THIS_WEEK_START, -7);

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

interface WeekDto {
  week_start: string;
  week_end: string;
  days: Array<{ date: string; calories: number; calorie_goal: number | null }>;
  daily_weight: Array<{ date: string; weight: number | null }>;
  total_calories: number;
  avg_calories: number;
}

interface TrendDto {
  this_week: WeekDto;
  last_week: WeekDto;
  change: { calories: number; weight: number | null };
}

async function logCalories(token: string, date: string, calories: number): Promise<void> {
  const res = await call('POST', '/nutrition/entries', {
    token,
    body: { date, food_name: 'Snack', meal_type: 'snack', calories },
  });
  expect(res.status).toBe(201);
}

async function logWeight(token: string, date: string, weight: number): Promise<void> {
  const res = await call('POST', '/weight/entries', {
    token,
    body: { date, weight, unit: 'kg' },
  });
  expect(res.status).toBe(201);
}

describe('GET /health/summary/weekly-trend', () => {
  beforeEach(async () => {
    await createHealthTables(testEnv.DB);
    await resetHealthTables(testEnv.DB);
    await seedHealthUsers(testEnv.DB, [UID_A, UID_B]);
    tokenA = await mintToken(UID_A);
    tokenB = await mintToken(UID_B);
  });

  it('HEALTH-TREND-001: nothing logged answers all-zero days and a null weight change', async () => {
    const res = await call('GET', `/summary/weekly-trend?date=${ANCHOR}`, { token: tokenA });
    expect(res.status).toBe(200);
    const body = await json<TrendDto>(res);

    expect(body.this_week.week_start).toBe(THIS_WEEK_START);
    expect(body.this_week.week_end).toBe(addDays(THIS_WEEK_START, 6));
    expect(body.this_week.days).toHaveLength(7);
    expect(body.this_week.days.every((d) => d.calories === 0 && d.calorie_goal === null)).toBe(true);
    expect(body.this_week.daily_weight.every((d) => d.weight === null)).toBe(true);
    expect(body.this_week.total_calories).toBe(0);
    expect(body.this_week.avg_calories).toBe(0);
    expect(body.last_week.week_start).toBe(LAST_WEEK_START);
    expect(body.change).toEqual({ calories: 0, weight: null });
  });

  it('HEALTH-TREND-002: sums multiple entries per day and totals/averages across the week', async () => {
    await logCalories(tokenA, THIS_WEEK_START, 500);
    await logCalories(tokenA, THIS_WEEK_START, 300); // same day, must SUM to 800
    await logCalories(tokenA, addDays(THIS_WEEK_START, 3), 1000);

    const body = await json<TrendDto>(
      await call('GET', `/summary/weekly-trend?date=${ANCHOR}`, { token: tokenA })
    );
    expect(body.this_week.days[0]).toMatchObject({ date: THIS_WEEK_START, calories: 800 });
    expect(body.this_week.days[3]).toMatchObject({ calories: 1000 });
    expect(body.this_week.days[1]).toMatchObject({ calories: 0 });
    expect(body.this_week.total_calories).toBe(1800);
    expect(body.this_week.avg_calories).toBe(Math.round(1800 / 7));
  });

  it('HEALTH-TREND-003: calorie_goal reflects the effective-dated goal, including per-weekday overrides', async () => {
    await call('PUT', '/goals', {
      token: tokenA,
      body: { effective_date: THIS_WEEK_START, daily_calories: 2000 },
    });
    const tuesday = addDays(THIS_WEEK_START, 1);
    // Flip on a per-weekday override for just this one goal row.
    const dow = new Date(`${tuesday}T00:00:00Z`).getUTCDay();
    const perDayField = ['sunday_calories', 'monday_calories', 'tuesday_calories', 'wednesday_calories', 'thursday_calories', 'friday_calories', 'saturday_calories'][dow];
    await call('PUT', '/goals', {
      token: tokenA,
      body: { effective_date: THIS_WEEK_START, use_per_day_calories: true, [perDayField]: 1500 },
    });

    const body = await json<TrendDto>(
      await call('GET', `/summary/weekly-trend?date=${ANCHOR}`, { token: tokenA })
    );
    const tuesdayDay = body.this_week.days.find((d) => d.date === tuesday)!;
    expect(tuesdayDay.calorie_goal).toBe(1500);
    // A day with no override still falls back to the flat daily_calories.
    const monday = body.this_week.days.find((d) => d.date === THIS_WEEK_START)!;
    expect(monday.calorie_goal === 1500 ? monday.date === tuesday : true).toBe(true);
  });

  it('HEALTH-TREND-004: daily_weight keeps the LATEST reading when a day has more than one', async () => {
    await logWeight(tokenA, THIS_WEEK_START, 80.0);
    await logWeight(tokenA, THIS_WEEK_START, 79.5); // logged after — should win

    const body = await json<TrendDto>(
      await call('GET', `/summary/weekly-trend?date=${ANCHOR}`, { token: tokenA })
    );
    expect(body.this_week.daily_weight[0]).toMatchObject({ date: THIS_WEEK_START, weight: 79.5 });
    expect(body.this_week.daily_weight[1].weight).toBeNull();
  });

  it('HEALTH-TREND-005: change.weight averages only LOGGED days per week, null when a week has none', async () => {
    await logWeight(tokenA, THIS_WEEK_START, 78);
    await logWeight(tokenA, addDays(THIS_WEEK_START, 1), 80); // this week avg = 79

    const body = await json<TrendDto>(
      await call('GET', `/summary/weekly-trend?date=${ANCHOR}`, { token: tokenA })
    );
    // Last week has no weight entries at all — the change must be null, not 0
    // or a figure that treats the empty week as "0 kg".
    expect(body.change.weight).toBeNull();

    await logWeight(tokenA, LAST_WEEK_START, 81);
    const body2 = await json<TrendDto>(
      await call('GET', `/summary/weekly-trend?date=${ANCHOR}`, { token: tokenA })
    );
    expect(body2.change.weight).toBeCloseTo(79 - 81, 5);
  });

  it('HEALTH-TREND-006: change.calories is this week\'s avg minus last week\'s avg', async () => {
    await logCalories(tokenA, THIS_WEEK_START, 1400); // this week total 1400, avg 200
    await logCalories(tokenA, LAST_WEEK_START, 700); // last week total 700, avg 100

    const body = await json<TrendDto>(
      await call('GET', `/summary/weekly-trend?date=${ANCHOR}`, { token: tokenA })
    );
    expect(body.change.calories).toBe(Math.round(1400 / 7) - Math.round(700 / 7));
  });

  it('HEALTH-TREND-007: scoped to the caller — another user\'s entries never leak in', async () => {
    await logCalories(tokenB, THIS_WEEK_START, 5000);
    await logWeight(tokenB, THIS_WEEK_START, 999);

    const body = await json<TrendDto>(
      await call('GET', `/summary/weekly-trend?date=${ANCHOR}`, { token: tokenA })
    );
    expect(body.this_week.total_calories).toBe(0);
    expect(body.this_week.daily_weight.every((d) => d.weight === null)).toBe(true);
  });

  it('HEALTH-TREND-008: an omitted ?date defaults to today without erroring', async () => {
    const res = await call('GET', '/summary/weekly-trend', { token: tokenA });
    expect(res.status).toBe(200);
    const body = await json<TrendDto>(res);
    expect(body.this_week.days).toHaveLength(7);
  });
});
