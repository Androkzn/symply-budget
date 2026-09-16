/**
 * Symply Health — personal FOOD CHALLENGES (`/health/challenges/*`), at the
 * HTTP layer. Ported from the donor `backend/src/routes/challenges.ts`; see
 * `migrations/0136_food_challenges.sql` and `HealthChallengeService` for the
 * full donor mapping and every deliberate deviation (no soft delete, no
 * streaks/achievements in this pass, `is_processed` derived server-side).
 *
 * Harness mirrors `health-water.test.ts` (`cloudflare:test` env, a jose HS256
 * JWT whose `sub` is the user id, local DDL from health-test-helpers). Also
 * creates the migration-0136 tables and a small seed of
 * `food_category_mappings` — the category-detection tests need real rows to
 * match against.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import { addDays, weekStartOf } from '../../services/health-service';
import type { Env } from '../../types';
import healthRoutes from '../health';

import {
  createHealthChallengesTables,
  createHealthTables,
  insertHealthRow,
  readHealthRow,
  resetHealthChallengesTables,
  resetHealthTables,
  seedFoodCategoryMappings,
  seedHealthUsers,
} from './health-test-helpers';

const testEnv = env as unknown as Env;
const HEALTH_ENV = { ...testEnv, APP_BRAND: 'symply-health' } as Env;

const UID_A = 'u_chal_alice';
const UID_B = 'u_chal_bob';

/** Fixed personal dates — nothing here depends on the wall clock. */
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

interface ChallengeDto {
  id: string;
  name: string;
  target_category: string | null;
  target_food_name: string | null;
  target_amount_grams: number;
  frequency: 'daily' | 'weekly';
  is_active: boolean;
  end_date: string | null;
  custom_icon: string | null;
}

async function createChallenge(
  token: string,
  body: Record<string, unknown>
): Promise<ChallengeDto> {
  const res = await call('POST', '/challenges', { token, body });
  expect(res.status).toBe(201);
  return (await json<{ challenge: ChallengeDto }>(res)).challenge;
}

async function logFood(
  token: string,
  body: { date: string; food_name: string; portion: number; unit?: string; meal_type?: string; calories?: number }
): Promise<string> {
  const res = await call('POST', '/nutrition/entries', {
    token,
    body: {
      date: body.date,
      food_name: body.food_name,
      portion: body.portion,
      unit: body.unit ?? 'g',
      meal_type: body.meal_type ?? 'lunch',
      calories: body.calories ?? 50,
    },
  });
  expect(res.status, JSON.stringify(body)).toBe(201);
  return (await json<{ entry: { id: string } }>(res)).entry.id;
}

describe('health food challenges', () => {
  beforeEach(async () => {
    await createHealthTables(testEnv.DB);
    await resetHealthTables(testEnv.DB);
    await createHealthChallengesTables(testEnv.DB);
    await resetHealthChallengesTables(testEnv.DB);
    await seedHealthUsers(testEnv.DB, [UID_A, UID_B]);
    await seedFoodCategoryMappings(testEnv.DB);
    tokenA = await mintToken(UID_A);
    tokenB = await mintToken(UID_B);
  });

  /* ============================== CRUD ================================ */

  describe('CRUD', () => {
    it('HEALTH-CHAL-001: creates a challenge with server-owned defaults', async () => {
      const challenge = await createChallenge(tokenA, {
        name: 'Eat 1000g vegetables this week',
        target_category: 'vegetables',
        target_amount_grams: 1000,
        frequency: 'weekly',
      });
      expect(challenge).toMatchObject({
        name: 'Eat 1000g vegetables this week',
        target_category: 'vegetables',
        target_amount_grams: 1000,
        frequency: 'weekly',
        is_active: true,
      });
      expect(
        await readHealthRow<{ current_streak: number; total_completions: number }>(
          testEnv.DB,
          'food_challenges',
          challenge.id
        )
      ).toMatchObject({ current_streak: 0, total_completions: 0 });
    });

    it('HEALTH-CHAL-002: rejects a missing name, bad frequency, or out-of-range target', async () => {
      const bad: unknown[] = [
        { target_amount_grams: 100, frequency: 'daily' }, // no name
        { name: 'x', target_amount_grams: 100, frequency: 'monthly' }, // bad frequency
        { name: 'x', target_amount_grams: 0, frequency: 'daily' }, // below MIN
        { name: 'x', target_amount_grams: 20000, frequency: 'daily' }, // above MAX
      ];
      for (const body of bad) {
        const res = await call('POST', '/challenges', { token: tokenA, body });
        expect(res.status, JSON.stringify(body)).toBe(400);
      }
    });

    it('HEALTH-CHAL-003: lists only the caller\'s challenges, newest first', async () => {
      const c1 = await createChallenge(tokenA, {
        name: 'A1',
        target_amount_grams: 100,
        frequency: 'daily',
      });
      const c2 = await createChallenge(tokenA, {
        name: 'A2',
        target_amount_grams: 100,
        frequency: 'daily',
      });
      await createChallenge(tokenB, { name: 'B1', target_amount_grams: 100, frequency: 'daily' });

      const res = await call('GET', '/challenges', { token: tokenA });
      const { challenges } = await json<{ challenges: ChallengeDto[] }>(res);
      expect(challenges.map((c) => c.id)).toEqual([c2.id, c1.id]);
    });

    it('HEALTH-CHAL-004: ?active=true filters out deactivated challenges', async () => {
      const active = await createChallenge(tokenA, {
        name: 'Active',
        target_amount_grams: 100,
        frequency: 'daily',
      });
      const toDeactivate = await createChallenge(tokenA, {
        name: 'Inactive',
        target_amount_grams: 100,
        frequency: 'daily',
      });
      await call('PUT', `/challenges/${toDeactivate.id}`, {
        token: tokenA,
        body: { is_active: false },
      });

      const res = await call('GET', '/challenges?active=true', { token: tokenA });
      const { challenges } = await json<{ challenges: ChallengeDto[] }>(res);
      expect(challenges.map((c) => c.id)).toEqual([active.id]);
    });

    it('HEALTH-CHAL-005: PUT updates only the fields sent, leaving the rest alone', async () => {
      const challenge = await createChallenge(tokenA, {
        name: 'Original',
        target_category: 'vegetables',
        target_amount_grams: 500,
        frequency: 'weekly',
      });
      const res = await call('PUT', `/challenges/${challenge.id}`, {
        token: tokenA,
        body: { target_amount_grams: 750 },
      });
      expect(res.status).toBe(200);
      const { challenge: updated } = await json<{ challenge: ChallengeDto }>(res);
      expect(updated).toMatchObject({
        name: 'Original',
        target_category: 'vegetables',
        target_amount_grams: 750,
        frequency: 'weekly',
      });
    });

    it('HEALTH-CHAL-006: an explicit null CLEARS end_date/custom_icon; omitting leaves them alone', async () => {
      const challenge = await createChallenge(tokenA, {
        name: 'Iconed',
        target_amount_grams: 100,
        frequency: 'daily',
        end_date: '2026-12-31',
        custom_icon: '🥦',
      });

      // Omitted — both survive untouched.
      await call('PUT', `/challenges/${challenge.id}`, { token: tokenA, body: { name: 'Renamed' } });
      expect(
        await readHealthRow<{ end_date: string | null; custom_icon: string | null }>(
          testEnv.DB,
          'food_challenges',
          challenge.id
        )
      ).toMatchObject({ end_date: '2026-12-31', custom_icon: '🥦' });

      // Explicit null — both clear.
      await call('PUT', `/challenges/${challenge.id}`, {
        token: tokenA,
        body: { end_date: null, custom_icon: null },
      });
      expect(
        await readHealthRow<{ end_date: string | null; custom_icon: string | null }>(
          testEnv.DB,
          'food_challenges',
          challenge.id
        )
      ).toMatchObject({ end_date: null, custom_icon: null });
    });

    it('HEALTH-CHAL-007: user B cannot update or delete user A\'s challenge', async () => {
      const challenge = await createChallenge(tokenA, {
        name: 'Mine',
        target_amount_grams: 100,
        frequency: 'daily',
      });

      const putRes = await call('PUT', `/challenges/${challenge.id}`, {
        token: tokenB,
        body: { name: 'Hijacked' },
      });
      expect(putRes.status).toBe(404);

      const delRes = await call('DELETE', `/challenges/${challenge.id}`, { token: tokenB });
      expect(delRes.status).toBe(404);

      expect(
        await readHealthRow<{ name: string }>(testEnv.DB, 'food_challenges', challenge.id)
      ).toMatchObject({ name: 'Mine' });
    });

    it('HEALTH-CHAL-008: delete is a HARD delete — a repeat 404s, no tombstone remains', async () => {
      const challenge = await createChallenge(tokenA, {
        name: 'Gone soon',
        target_amount_grams: 100,
        frequency: 'daily',
      });
      expect((await call('DELETE', `/challenges/${challenge.id}`, { token: tokenA })).status).toBe(
        200
      );
      expect(await readHealthRow(testEnv.DB, 'food_challenges', challenge.id)).toBeNull();
      expect((await call('DELETE', `/challenges/${challenge.id}`, { token: tokenA })).status).toBe(
        404
      );
    });
  });

  /* ========================= PROGRESS: TODAY =========================== */

  describe('GET /challenges/progress/today', () => {
    it('HEALTH-CHAL-010: a recognised food credits its FULL portion toward a matching category', async () => {
      const challenge = await createChallenge(tokenA, {
        name: 'Eat 200g vegetables',
        target_category: 'vegetables',
        target_amount_grams: 200,
        frequency: 'daily',
      });
      await logFood(tokenA, { date: D1, food_name: 'Broccoli', portion: 150 });

      const res = await call('GET', `/challenges/progress/today?date=${D1}`, { token: tokenA });
      expect(res.status).toBe(200);
      const body = await json<{
        date: string;
        challenges: Array<{
          id: string;
          consumed_grams: number;
          progress_percentage: number;
          remaining_grams: number;
          today_completed: boolean;
          matched_foods: Array<{ food_name: string; grams: number }>;
        }>;
        completed_count: number;
        total_count: number;
      }>(res);

      expect(body.total_count).toBe(1);
      expect(body.completed_count).toBe(0);
      const result = body.challenges.find((c) => c.id === challenge.id)!;
      expect(result.consumed_grams).toBe(150);
      expect(result.progress_percentage).toBe(75);
      expect(result.remaining_grams).toBe(50);
      expect(result.today_completed).toBe(false);
      expect(result.matched_foods).toEqual([{ food_name: 'Broccoli', grams: 150, confidence: 1 }]);
    });

    it('HEALTH-CHAL-011: vegetables⊇fruits — a fruit also counts toward a vegetables target', async () => {
      await createChallenge(tokenA, {
        name: 'Eat 200g vegetables',
        target_category: 'vegetables',
        target_amount_grams: 200,
        frequency: 'daily',
      });
      await logFood(tokenA, { date: D1, food_name: 'Apple', portion: 120 });

      const body = await json<{ challenges: Array<{ consumed_grams: number; today_completed: boolean }> }>(
        await call('GET', `/challenges/progress/today?date=${D1}`, { token: tokenA })
      );
      expect(body.challenges[0].consumed_grams).toBe(120);
    });

    it('HEALTH-CHAL-012: crossing the target flips today_completed and upserts the progress cache', async () => {
      const challenge = await createChallenge(tokenA, {
        name: 'Eat 100g vegetables',
        target_category: 'vegetables',
        target_amount_grams: 100,
        frequency: 'daily',
      });
      await logFood(tokenA, { date: D1, food_name: 'Spinach', portion: 60 });
      await logFood(tokenA, { date: D1, food_name: 'Tomato', portion: 50 });

      const body = await json<{ challenges: Array<{ today_completed: boolean; progress_percentage: number }> }>(
        await call('GET', `/challenges/progress/today?date=${D1}`, { token: tokenA })
      );
      expect(body.challenges[0].today_completed).toBe(true);
      expect(body.challenges[0].progress_percentage).toBe(100); // clamped, not 110

      const cached = await readHealthRow<{ consumed_grams: number; is_completed: number }>(
        testEnv.DB,
        'challenge_progress',
        (
          await testEnv.DB
            .prepare('SELECT id FROM challenge_progress WHERE challenge_id = ?')
            .bind(challenge.id)
            .first<{ id: string }>()
        )!.id
      );
      expect(cached).toMatchObject({ consumed_grams: 110, is_completed: 1 });
    });

    it('HEALTH-CHAL-013: a custom_ingredient challenge matches by food-name substring, any category', async () => {
      await createChallenge(tokenA, {
        name: 'Eat 30g Avocado',
        target_category: 'custom_ingredient',
        target_food_name: 'Avocado',
        target_amount_grams: 30,
        frequency: 'daily',
      });
      await logFood(tokenA, { date: D1, food_name: 'Avocado Toast', portion: 80 });

      const body = await json<{ challenges: Array<{ consumed_grams: number; today_completed: boolean }> }>(
        await call('GET', `/challenges/progress/today?date=${D1}`, { token: tokenA })
      );
      expect(body.challenges[0].consumed_grams).toBe(80);
      expect(body.challenges[0].today_completed).toBe(true);
    });

    it('HEALTH-CHAL-014: an unrecognised (composite) food name contributes 0g to a category target', async () => {
      await createChallenge(tokenA, {
        name: 'Eat 200g vegetables',
        target_category: 'vegetables',
        target_amount_grams: 200,
        frequency: 'daily',
      });
      // "Homemade Lasagna" matches none of the seeded patterns, so
      // `detected_category` stays NULL and `is_processed` stays the
      // conservative default (1) — excluded from the category match.
      await logFood(tokenA, { date: D1, food_name: 'Homemade Lasagna', portion: 300 });

      const body = await json<{ challenges: Array<{ consumed_grams: number }> }>(
        await call('GET', `/challenges/progress/today?date=${D1}`, { token: tokenA })
      );
      expect(body.challenges[0].consumed_grams).toBe(0);

      expect(
        await readHealthRow<{ detected_category: string | null; is_processed: number }>(
          testEnv.DB,
          'nutrition_entries',
          (
            await testEnv.DB
              .prepare('SELECT id FROM nutrition_entries WHERE food_name = ?')
              .bind('Homemade Lasagna')
              .first<{ id: string }>()
          )!.id
        )
      ).toMatchObject({ detected_category: null, is_processed: 1 });
    });

    it('HEALTH-CHAL-015: a recognised ingredient is stored is_processed = 0 (raw)', async () => {
      await logFood(tokenA, { date: D1, food_name: 'Broccoli', portion: 100 });
      expect(
        await readHealthRow<{ detected_category: string | null; is_processed: number }>(
          testEnv.DB,
          'nutrition_entries',
          (
            await testEnv.DB
              .prepare('SELECT id FROM nutrition_entries WHERE food_name = ?')
              .bind('Broccoli')
              .first<{ id: string }>()
          )!.id
        )
      ).toMatchObject({ detected_category: 'vegetables', is_processed: 0 });
    });

    it('HEALTH-CHAL-016: scoped to ONE user and ONE day — nothing leaks across either boundary', async () => {
      const challengeA = await createChallenge(tokenA, {
        name: 'Eat 100g vegetables',
        target_category: 'vegetables',
        target_amount_grams: 100,
        frequency: 'daily',
      });
      await createChallenge(tokenB, {
        name: 'Eat 100g vegetables',
        target_category: 'vegetables',
        target_amount_grams: 100,
        frequency: 'daily',
      });
      await logFood(tokenA, { date: D1, food_name: 'Broccoli', portion: 100 });
      await logFood(tokenB, { date: D1, food_name: 'Broccoli', portion: 100 });
      await logFood(tokenA, { date: D2, food_name: 'Broccoli', portion: 999 });

      const bodyA = await json<{ challenges: Array<{ id: string; consumed_grams: number }> }>(
        await call('GET', `/challenges/progress/today?date=${D1}`, { token: tokenA })
      );
      expect(bodyA.challenges).toHaveLength(1);
      expect(bodyA.challenges[0]).toMatchObject({ id: challengeA.id, consumed_grams: 100 });
    });

    it('HEALTH-CHAL-017: no active challenges answers zeroes, not an error', async () => {
      const body = await json<{ challenges: unknown[]; completed_count: number; total_count: number }>(
        await call('GET', `/challenges/progress/today?date=${D1}`, { token: tokenA })
      );
      expect(body).toEqual({ date: D1, challenges: [], completed_count: 0, total_count: 0 });
    });
  });

  /* ======================== PROGRESS: WEEKLY =========================== */

  describe('GET /challenges/:id/progress/weekly', () => {
    it('HEALTH-CHAL-020: zero-fills every day of the CURRENT week and totals correctly', async () => {
      const challenge = await createChallenge(tokenA, {
        name: 'Eat 100g vegetables',
        target_category: 'vegetables',
        target_amount_grams: 100,
        frequency: 'daily',
      });

      // The route hardcodes "today" like the donor's own /:id/progress/weekly —
      // compute the real current week's Monday so the fixture lands inside it,
      // rather than depending on the wall clock's exact value.
      const weekStart = weekStartOf(new Date().toISOString().slice(0, 10));
      const day0 = weekStart;
      const day2 = addDays(weekStart, 2);
      const now = new Date().toISOString();

      await insertHealthRow(testEnv.DB, 'challenge_progress', {
        id: 'cprog-1',
        challenge_id: challenge.id,
        user_id: UID_A,
        date: day0,
        consumed_grams: 40,
        target_grams: 100,
        is_completed: 0,
        matched_foods: JSON.stringify([{ food_name: 'Spinach', grams: 40, confidence: 1 }]),
        last_updated_at: now,
      });
      await insertHealthRow(testEnv.DB, 'challenge_progress', {
        id: 'cprog-2',
        challenge_id: challenge.id,
        user_id: UID_A,
        date: day2,
        consumed_grams: 100,
        target_grams: 100,
        is_completed: 1,
        matched_foods: '[]',
        last_updated_at: now,
      });

      const res = await call('GET', `/challenges/${challenge.id}/progress/weekly`, { token: tokenA });
      expect(res.status).toBe(200);
      const body = await json<{
        daily_progress: Array<{ date: string; consumed_grams: number; is_completed: boolean }>;
        weekly_total_grams: number;
        weekly_target_grams: number;
        weekly_progress_percentage: number;
      }>(res);

      expect(body.daily_progress).toHaveLength(7);
      expect(body.daily_progress[0]).toMatchObject({ date: day0, consumed_grams: 40 });
      expect(body.daily_progress[2]).toMatchObject({ date: day2, consumed_grams: 100, is_completed: true });
      // Every other day zero-filled at the DAILY target (donor rule: daily
      // frequency's per-day target IS the challenge target).
      expect(body.daily_progress[1]).toMatchObject({ consumed_grams: 0, target_grams: 100 });

      expect(body.weekly_total_grams).toBe(140);
      // Daily challenge: weekly_target = target * 7.
      expect(body.weekly_target_grams).toBe(700);
      expect(body.weekly_progress_percentage).toBeCloseTo((140 / 700) * 100, 5);
    });

    it('HEALTH-CHAL-021: a WEEKLY-frequency challenge divides its target across 7 days', async () => {
      const challenge = await createChallenge(tokenA, {
        name: 'Eat 700g vegetables this week',
        target_category: 'vegetables',
        target_amount_grams: 700,
        frequency: 'weekly',
      });

      const res = await call('GET', `/challenges/${challenge.id}/progress/weekly`, { token: tokenA });
      const body = await json<{
        daily_progress: Array<{ target_grams: number }>;
        weekly_target_grams: number;
      }>(res);

      expect(body.weekly_target_grams).toBe(700);
      // Zero-filled days for a WEEKLY challenge show target/7 as their per-day slice.
      expect(body.daily_progress[0].target_grams).toBeCloseTo(100, 5);
    });

    it('HEALTH-CHAL-022: an unknown or someone-else\'s challenge id 404s', async () => {
      const challenge = await createChallenge(tokenA, {
        name: 'Mine',
        target_amount_grams: 100,
        frequency: 'daily',
      });
      expect(
        (await call('GET', '/challenges/does-not-exist/progress/weekly', { token: tokenA })).status
      ).toBe(404);
      expect(
        (await call('GET', `/challenges/${challenge.id}/progress/weekly`, { token: tokenB })).status
      ).toBe(404);
    });
  });
});
