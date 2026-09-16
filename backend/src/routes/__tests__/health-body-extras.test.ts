/**
 * Symply Health P2 `body-extras` routes (`src/routes/health-body-extras.ts`) —
 * injuries, activity notification preferences and body insights, driven through
 * the real Hono router against a live miniflare D1.
 *
 * Same three load-bearing layers as routes/__tests__/health.test.ts:
 *   1. BRAND GATE — `requireHealthApi()` must 404 every path on
 *      House/Budget/Kaizen, BEFORE the token check.
 *   2. AUTH — every path is 401 without a valid bearer.
 *   3. USER SCOPING — health data is PERSONAL: user B must never read or mutate
 *      an injury, a preference row or an insight belonging to user A.
 *
 * On top of that, this suite owns the domain rules that make the group
 * dangerous to get wrong:
 *   - `pain_level` is the DONOR 0–4 scale; 5 must not be storable.
 *   - RESOLVE ≠ DELETE: a healed injury stays readable as history.
 *   - `/injuries/active-body-parts` is a SAFETY surface — it gates workout
 *     suggestions, so both a resolved and a soft-deleted injury must drop out
 *     of it, and a stale ACTIVE one must keep suppressing.
 *   - `activity_notification_preferences.user_id` is the PRIMARY KEY: the write
 *     is an upsert with partial semantics, and an unsaved user reads defaults.
 *
 * Body insights are AI-produced and have NO client write path (P3 owns the
 * producer), so their fixtures are written through the service — the same
 * in-process entry point the producer will use.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  ACTIVITY_PREFERENCE_DEFAULTS,
  ACTIVITY_PREFERENCE_FIELDS,
  HealthBodyExtrasService,
} from '../../services/health-body-extras-service';
import type { Env } from '../../types';
import healthBodyExtrasRoutes from '../health-body-extras';

import {
  createBodyExtrasTables,
  createHealthTables,
  resetBodyExtrasTables,
  resetHealthTables,
  seedHealthUsers,
  seedUserFile,
} from './health-test-helpers';

const testEnv = env as unknown as Env;

// The pool env is House (wrangler.toml); each brand gets its own copy so a
// single request can be replayed across the fleet.
const HEALTH_ENV = { ...testEnv, APP_BRAND: 'symply-health' } as Env;
const HOUSE_ENV = { ...testEnv, APP_BRAND: 'symply-house' } as Env;
const BUDGET_ENV = { ...testEnv, APP_BRAND: 'symply-budget' } as Env;
const KAIZEN_ENV = { ...testEnv, APP_BRAND: 'symply-kaizen' } as Env;

const UID_A = 'u_extras_alice';
const UID_B = 'u_extras_bob';

/** Fixed dates — nothing here depends on the wall clock. */
const D1 = '2026-06-01';
const D2 = '2026-06-02';
const D3 = '2026-06-03';

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

/** Mirrors the `app.route('/health', healthBodyExtrasRoutes)` mount in src/index.ts. */
function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/health', healthBodyExtrasRoutes);
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

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

interface InjuryRow {
  id: string;
  date: string;
  body_part: string;
  pain_level: number;
  injury_type: string;
  cause: string | null;
  muscle_group: string | null;
  notes: string | null;
  is_active: boolean;
  deleted_at: string | null;
  updated_at: string;
}

interface ActiveBodyPartRow {
  body_part: string;
  max_pain_level: number;
  injury_count: number;
  muscle_groups: string[];
}

/** Every path this router owns — the gate/auth sweeps must cover all of them. */
const ROUTES: ReadonlyArray<readonly [string, string, unknown?]> = [
  ['GET', '/injuries'],
  ['GET', '/injuries?active=true'],
  ['POST', '/injuries', { date: D1, body_part: 'lowerBack', pain_level: 2 }],
  ['PUT', '/injuries/inj_x', { pain_level: 1 }],
  ['POST', '/injuries/inj_x/resolve'],
  ['DELETE', '/injuries/inj_x'],
  ['GET', '/injuries/active-body-parts'],
  ['GET', '/activity-preferences'],
  ['PUT', '/activity-preferences', { notify_photo_shared: false }],
  ['GET', '/body-insights'],
  ['GET', '/body-insights/latest'],
  ['GET', '/body-insights/photo'],
];

/** The brand gate's own envelope — distinguishes it from a real not-found. */
const GATE_MESSAGE = 'Not found';

async function isGate404(res: Response): Promise<boolean> {
  if (res.status !== 404) return false;
  try {
    const b = (await res.json()) as { error?: { message?: string } };
    return b.error?.message === GATE_MESSAGE;
  } catch {
    // Hono's built-in "no route" 404 is plain text — treat as a gate/miss too.
    return true;
  }
}

async function createInjury(
  token: string,
  body: Record<string, unknown>
): Promise<InjuryRow> {
  const res = await call('POST', '/injuries', { token, body });
  expect(res.status).toBe(201);
  return (await json<{ injury: InjuryRow }>(res)).injury;
}

async function listInjuries(token: string, query = ''): Promise<InjuryRow[]> {
  const res = await call('GET', `/injuries${query}`, { token });
  expect(res.status).toBe(200);
  return (await json<{ injuries: InjuryRow[] }>(res)).injuries;
}

async function activeBodyParts(token: string): Promise<ActiveBodyPartRow[]> {
  const res = await call('GET', '/injuries/active-body-parts', { token });
  expect(res.status).toBe(200);
  return (await json<{ body_parts: ActiveBodyPartRow[] }>(res)).body_parts;
}

function svc(): HealthBodyExtrasService {
  return new HealthBodyExtrasService(testEnv.DB);
}

describe('health body-extras routes', () => {
  beforeEach(async () => {
    await createHealthTables(testEnv.DB);
    await createBodyExtrasTables(testEnv.DB);
    await resetBodyExtrasTables(testEnv.DB);
    await resetHealthTables(testEnv.DB);
    await seedHealthUsers(testEnv.DB, [UID_A, UID_B]);
    tokenA = await mintToken(UID_A);
    tokenB = await mintToken(UID_B);
  });

  /* ====================== 1. BRAND GATE ============================== */

  describe('brand gate (requireHealthApi)', () => {
    it.each([
      ['symply-house', HOUSE_ENV],
      ['symply-budget', BUDGET_ENV],
      ['symply-kaizen', KAIZEN_ENV],
    ])('404s every body-extras route on %s', async (_brand, brandEnv) => {
      const leaked: string[] = [];
      for (const [method, path, body] of ROUTES) {
        const res = await call(method, path, { token: tokenA, body, brandEnv });
        if (!(await isGate404(res))) leaked.push(`${method} ${path} -> ${res.status}`);
      }
      expect(leaked).toEqual([]);
    });

    it('fires BEFORE auth — a tokenless wrong-brand request 404s, never 401s', async () => {
      // Ordering matters: a 401 would confirm the surface exists on that brand.
      const res = await call('GET', '/injuries', { token: null, brandEnv: BUDGET_ENV });
      expect(res.status).toBe(404);
      expect(await json<{ error: { message: string } }>(res)).toEqual({
        error: { code: 'not_found', message: GATE_MESSAGE },
      });
    });

    it('never fires on symply-health — every route is reachable there', async () => {
      // A 404 on the Health Worker may only be a real "Injury not found"; the
      // generic gate message would mean the capability table regressed.
      const gated: string[] = [];
      for (const [method, path, body] of ROUTES) {
        const res = await call(method, path, { token: tokenA, body });
        if (await isGate404(res)) gated.push(`${method} ${path}`);
      }
      expect(gated).toEqual([]);
    });

    it('no route 5xxs on a cold, empty account', async () => {
      const crashed: string[] = [];
      for (const [method, path, body] of ROUTES) {
        const res = await call(method, path, { token: tokenA, body });
        if (res.status >= 500) crashed.push(`${method} ${path} -> ${res.status}`);
      }
      expect(crashed).toEqual([]);
    });
  });

  /* ========================== 2. AUTH ================================= */

  describe('auth', () => {
    it('401s every route without a bearer token', async () => {
      const open: string[] = [];
      for (const [method, path, body] of ROUTES) {
        const res = await call(method, path, { token: null, body });
        if (res.status !== 401) open.push(`${method} ${path} -> ${res.status}`);
      }
      expect(open).toEqual([]);
    });

    it('401s a token signed with the wrong secret', async () => {
      const forged = await mintToken(UID_A, 'an-attacker-secret-32-chars-minimum');
      const res = await call('GET', '/injuries', { token: forged });
      expect(res.status).toBe(401);
    });

    it('401s a malformed bearer value', async () => {
      const res = await call('GET', '/injuries', { token: 'not-a-jwt' });
      expect(res.status).toBe(401);
    });
  });

  /* ====================== 3. USER SCOPING ============================= */

  describe('user scoping (personal data, no household)', () => {
    it('never leaks another user rows in any list endpoint', async () => {
      await createInjury(tokenA, { date: D1, body_part: 'lowerBack', pain_level: 3 });
      await call('PUT', '/activity-preferences', {
        token: tokenA,
        body: { notify_photo_shared: false },
      });
      const photoId = await seedUserFile(testEnv.DB, UID_A, 'file_a_front');
      await svc().savePhotoInsight(UID_A, { photo_id: photoId, date: D1, angle: 'front' });
      await svc().saveComprehensiveInsight(UID_A, { date: D1, overall_posture_score: 82 });

      expect(await listInjuries(tokenB)).toEqual([]);
      expect(await activeBodyParts(tokenB)).toEqual([]);
      expect(
        (await json<{ insights: unknown[] }>(await call('GET', '/body-insights', { token: tokenB })))
          .insights
      ).toEqual([]);
      expect(
        (
          await json<{ insights: unknown[] }>(
            await call('GET', '/body-insights/photo', { token: tokenB })
          )
        ).insights
      ).toEqual([]);
      expect(
        (
          await json<{ insight: unknown }>(
            await call('GET', '/body-insights/latest', { token: tokenB })
          )
        ).insight
      ).toBeNull();

      // B's preference row is untouched by A's write — still the defaults.
      const prefsB = await json<{ preferences: Record<string, unknown> }>(
        await call('GET', '/activity-preferences', { token: tokenB })
      );
      expect(prefsB.preferences.notify_photo_shared).toBe(true);
      expect(prefsB.preferences.user_id).toBe(UID_B);
      expect(prefsB.preferences.updated_at).toBeNull();
    });

    it('404s every cross-user injury mutation and leaves the row intact', async () => {
      const injury = await createInjury(tokenA, {
        date: D1,
        body_part: 'lowerBack',
        pain_level: 3,
        notes: 'lifting',
      });

      const attacks: Array<[string, string, unknown?]> = [
        ['PUT', `/injuries/${injury.id}`, { pain_level: 0, body_part: 'neck' }],
        ['POST', `/injuries/${injury.id}/resolve`],
        ['DELETE', `/injuries/${injury.id}`],
      ];
      const allowed: string[] = [];
      for (const [method, path, body] of attacks) {
        const res = await call(method, path, { token: tokenB, body });
        // 404, not 403 — a 403 would confirm the id exists on another account.
        if (res.status !== 404) allowed.push(`${method} ${path} -> ${res.status}`);
      }
      expect(allowed).toEqual([]);

      // A's injury survives, still ACTIVE and still suppressing its body part.
      const rows = await listInjuries(tokenA);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: injury.id,
        body_part: 'lowerBack',
        pain_level: 3,
        is_active: true,
        notes: 'lifting',
      });
      expect((await activeBodyParts(tokenA)).map((p) => p.body_part)).toEqual(['lowerBack']);
    });

    it('keeps the user_id-keyed preference upsert in separate lanes', async () => {
      // `user_id` IS the primary key here — the classic place for a missing user
      // filter to overwrite somebody else's row instead of inserting a new one.
      await call('PUT', '/activity-preferences', {
        token: tokenA,
        body: { receive_push_notifications: false, notify_community_achievement: true },
      });
      await call('PUT', '/activity-preferences', {
        token: tokenB,
        body: { receive_push_notifications: true, notify_milestone_achieved: false },
      });

      const a = await json<{ preferences: Record<string, unknown> }>(
        await call('GET', '/activity-preferences', { token: tokenA })
      );
      const b = await json<{ preferences: Record<string, unknown> }>(
        await call('GET', '/activity-preferences', { token: tokenB })
      );
      expect(a.preferences.receive_push_notifications).toBe(false);
      expect(a.preferences.notify_community_achievement).toBe(true);
      expect(a.preferences.notify_milestone_achieved).toBe(true);
      expect(b.preferences.receive_push_notifications).toBe(true);
      expect(b.preferences.notify_milestone_achieved).toBe(false);
      expect(b.preferences.notify_community_achievement).toBe(false);
    });

    it('scopes body-insight reads by photo id as well as by user', async () => {
      const photoA = await seedUserFile(testEnv.DB, UID_A, 'file_a_1');
      const photoB = await seedUserFile(testEnv.DB, UID_B, 'file_b_1');
      await svc().savePhotoInsight(UID_A, { photo_id: photoA, date: D1, angle: 'front' });
      await svc().savePhotoInsight(UID_B, { photo_id: photoB, date: D1, angle: 'back' });

      // Holding B's photo id is not enough — the row is filtered by user first.
      const res = await call('GET', `/body-insights/photo?photo_id=${photoB}`, { token: tokenA });
      expect((await json<{ insights: unknown[] }>(res)).insights).toEqual([]);

      const own = await call('GET', `/body-insights/photo?photo_id=${photoA}`, { token: tokenA });
      expect((await json<{ insights: unknown[] }>(own)).insights).toHaveLength(1);
    });
  });

  /* ========================= 4. VALIDATION ============================ */

  describe('validation', () => {
    it('rejects a pain_level outside the donor 0–4 scale', async () => {
      // The bound is load-bearing: pain_level drives how hard the workout gate
      // suppresses a body part.
      for (const pain of [5, 10, -1, 2.5]) {
        const res = await call('POST', '/injuries', {
          body: { date: D1, body_part: 'knee', pain_level: pain },
        });
        expect(res.status, `pain_level ${pain}`).toBe(400);
      }
      expect(await listInjuries(tokenA)).toEqual([]);
    });

    it('accepts both ends of the scale', async () => {
      for (const pain of [0, 4]) {
        const injury = await createInjury(tokenA, { date: D1, body_part: 'knee', pain_level: pain });
        expect(injury.pain_level).toBe(pain);
      }
    });

    it('rejects an empty or whitespace-only body_part', async () => {
      for (const part of ['', '   ']) {
        const res = await call('POST', '/injuries', {
          body: { date: D1, body_part: part, pain_level: 1 },
        });
        expect(res.status, JSON.stringify(part)).toBe(400);
      }
      const missing = await call('POST', '/injuries', { body: { date: D1, pain_level: 1 } });
      expect(missing.status).toBe(400);
    });

    it('rejects a non-YYYY-MM-DD date', async () => {
      const res = await call('POST', '/injuries', {
        body: { date: '06/01/2026', body_part: 'knee' },
      });
      expect(res.status).toBe(400);
    });

    it('rejects an out-of-range pain_level on update and leaves the row untouched', async () => {
      const injury = await createInjury(tokenA, { date: D1, body_part: 'knee', pain_level: 2 });
      const res = await call('PUT', `/injuries/${injury.id}`, { body: { pain_level: 9 } });
      expect(res.status).toBe(400);
      expect((await listInjuries(tokenA))[0].pain_level).toBe(2);
    });

    it('rejects a non-boolean active filter', async () => {
      const res = await call('GET', '/injuries?active=maybe');
      expect(res.status).toBe(400);
    });

    it('rejects a non-boolean preference value', async () => {
      const res = await call('PUT', '/activity-preferences', {
        body: { notify_photo_shared: 'yes' },
      });
      expect(res.status).toBe(400);
    });

    it('defaults date and pain_level the way the donor does', async () => {
      const injury = await createInjury(tokenA, { body_part: 'shoulder' });
      expect(injury.pain_level).toBe(1);
      expect(injury.injury_type).toBe('pain');
      expect(injury.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(injury.is_active).toBe(true);
    });
  });

  /* ===================== 5. INJURY LIFECYCLE ========================== */

  describe('injury lifecycle (resolve is not delete)', () => {
    it('resolves an injury without removing it from history', async () => {
      const injury = await createInjury(tokenA, { date: D1, body_part: 'knee', pain_level: 3 });

      const res = await call('POST', `/injuries/${injury.id}/resolve`);
      expect(res.status).toBe(200);
      expect((await json<{ injury: InjuryRow }>(res)).injury.is_active).toBe(false);

      // Still fully readable — an injury that healed is history, not a deletion.
      const all = await listInjuries(tokenA);
      expect(all).toHaveLength(1);
      expect(all[0].is_active).toBe(false);
      expect(all[0].pain_level).toBe(3);

      expect(await listInjuries(tokenA, '?active=true')).toEqual([]);
      expect((await listInjuries(tokenA, '?active=false'))[0].id).toBe(injury.id);
    });

    it('is idempotent — resolving twice still 200s', async () => {
      const injury = await createInjury(tokenA, { date: D1, body_part: 'knee', pain_level: 3 });
      expect((await call('POST', `/injuries/${injury.id}/resolve`)).status).toBe(200);
      expect((await call('POST', `/injuries/${injury.id}/resolve`)).status).toBe(200);
      expect((await listInjuries(tokenA))[0].is_active).toBe(false);
    });

    it('re-activates a healed injury on flare-up via PUT', async () => {
      const injury = await createInjury(tokenA, { date: D1, body_part: 'knee', pain_level: 2 });
      await call('POST', `/injuries/${injury.id}/resolve`);
      const res = await call('PUT', `/injuries/${injury.id}`, {
        body: { is_active: true, pain_level: 4 },
      });
      expect(res.status).toBe(200);
      expect((await activeBodyParts(tokenA)).map((p) => p.body_part)).toEqual(['knee']);
    });

    it('soft-deletes: the row leaves every read path and cannot be re-deleted', async () => {
      const injury = await createInjury(tokenA, { date: D1, body_part: 'knee', pain_level: 3 });
      expect((await call('DELETE', `/injuries/${injury.id}`)).status).toBe(200);

      expect(await listInjuries(tokenA)).toEqual([]);
      expect(await listInjuries(tokenA, '?active=false')).toEqual([]);
      expect((await call('DELETE', `/injuries/${injury.id}`)).status).toBe(404);
      expect((await call('POST', `/injuries/${injury.id}/resolve`)).status).toBe(404);
      expect((await call('PUT', `/injuries/${injury.id}`, { body: { pain_level: 1 } })).status).toBe(
        404
      );
    });

    it('updates only the fields the client sent', async () => {
      const injury = await createInjury(tokenA, {
        date: D1,
        body_part: 'knee',
        pain_level: 3,
        cause: 'running',
        notes: 'left side',
      });
      const res = await call('PUT', `/injuries/${injury.id}`, { body: { pain_level: 1 } });
      expect(res.status).toBe(200);
      const updated = (await json<{ injury: InjuryRow }>(res)).injury;
      expect(updated.pain_level).toBe(1);
      expect(updated.cause).toBe('running');
      expect(updated.notes).toBe('left side');
      expect(updated.body_part).toBe('knee');
    });

    it('filters the log by body part and date window', async () => {
      await createInjury(tokenA, { date: D1, body_part: 'knee', pain_level: 1 });
      await createInjury(tokenA, { date: D2, body_part: 'neck', pain_level: 2 });
      await createInjury(tokenA, { date: D3, body_part: 'knee', pain_level: 3 });

      expect((await listInjuries(tokenA, '?body_part=knee')).map((r) => r.date)).toEqual([D3, D1]);
      expect((await listInjuries(tokenA, `?from=${D2}&to=${D3}`)).map((r) => r.date)).toEqual([
        D3,
        D2,
      ]);
      expect((await listInjuries(tokenA, `?date=${D2}`)).map((r) => r.body_part)).toEqual(['neck']);
    });
  });

  /* ============= 6. ACTIVE BODY PARTS (SAFETY SURFACE) =============== */

  describe('/injuries/active-body-parts (workout gate)', () => {
    it('derives the distinct set, with the worst pain and the injury count', async () => {
      await createInjury(tokenA, {
        date: D1,
        body_part: 'knee',
        pain_level: 1,
        muscle_group: 'quads',
      });
      await createInjury(tokenA, {
        date: D2,
        body_part: 'knee',
        pain_level: 3,
        muscle_group: 'hamstrings',
      });
      await createInjury(tokenA, { date: D2, body_part: 'lowerBack', pain_level: 4 });

      const parts = await activeBodyParts(tokenA);
      // Worst pain first — a caller may suppress harder above a bound.
      expect(parts.map((p) => p.body_part)).toEqual(['lowerBack', 'knee']);
      expect(parts[1]).toEqual({
        body_part: 'knee',
        max_pain_level: 3,
        injury_count: 2,
        muscle_groups: ['hamstrings', 'quads'],
      });
      expect(parts[0].muscle_groups).toEqual([]);
    });

    it('keeps suppressing while an injury is merely STALE', async () => {
      // An old, never-resolved injury still gates exercises. Dropping it on an
      // age heuristic would silently un-suppress a part the user never healed.
      await createInjury(tokenA, { date: '2024-01-01', body_part: 'shoulder', pain_level: 2 });
      expect((await activeBodyParts(tokenA)).map((p) => p.body_part)).toEqual(['shoulder']);
    });

    it('drops a RESOLVED injury out of the set', async () => {
      const injury = await createInjury(tokenA, { date: D1, body_part: 'knee', pain_level: 3 });
      await call('POST', `/injuries/${injury.id}/resolve`);
      expect(await activeBodyParts(tokenA)).toEqual([]);
      // …but the history read still shows it.
      expect(await listInjuries(tokenA)).toHaveLength(1);
    });

    it('drops a SOFT-DELETED injury out of the set', async () => {
      const injury = await createInjury(tokenA, { date: D1, body_part: 'knee', pain_level: 3 });
      await call('DELETE', `/injuries/${injury.id}`);
      expect(await activeBodyParts(tokenA)).toEqual([]);
    });

    it('keeps a part suppressed while ANY of its injuries is still active', async () => {
      const healed = await createInjury(tokenA, { date: D1, body_part: 'knee', pain_level: 1 });
      await createInjury(tokenA, { date: D2, body_part: 'knee', pain_level: 4 });
      await call('POST', `/injuries/${healed.id}/resolve`);

      const parts = await activeBodyParts(tokenA);
      expect(parts).toHaveLength(1);
      expect(parts[0]).toMatchObject({ body_part: 'knee', max_pain_level: 4, injury_count: 1 });
    });

    it('still lists a pain_level 0 injury while it is active', async () => {
      // Pain 0 is not "healed" — only `resolve` (or delete) clears the gate.
      await createInjury(tokenA, { date: D1, body_part: 'ankle', pain_level: 0 });
      expect((await activeBodyParts(tokenA)).map((p) => p.body_part)).toEqual(['ankle']);
    });
  });

  /* ==================== 7. ACTIVITY PREFERENCES ======================= */

  describe('/activity-preferences', () => {
    it('reads the donor defaults before anything was ever saved', async () => {
      const res = await call('GET', '/activity-preferences');
      expect(res.status).toBe(200);
      const { preferences } = await json<{ preferences: Record<string, unknown> }>(res);
      expect(preferences).toEqual({
        user_id: UID_A,
        ...ACTIVITY_PREFERENCE_DEFAULTS,
        favourite_workout_types: [],
        created_at: null,
        updated_at: null,
      });
      // Explicit: most notify_* are ON, the two community_* are OFF.
      expect(preferences.notify_recipe_created).toBe(true);
      expect(preferences.notify_recipe_updated).toBe(false);
      expect(preferences.notify_community_recipe_created).toBe(false);
      expect(preferences.notify_community_achievement).toBe(false);
    });

    it('upserts on user_id and applies partial updates cumulatively', async () => {
      const first = await json<{ preferences: Record<string, unknown> }>(
        await call('PUT', '/activity-preferences', { body: { notify_photo_shared: false } })
      );
      expect(first.preferences.notify_photo_shared).toBe(false);
      expect(first.preferences.notify_recipe_created).toBe(true);
      expect(first.preferences.created_at).toEqual(expect.any(String));

      // A second, disjoint toggle must not reset the first one.
      const second = await json<{ preferences: Record<string, unknown> }>(
        await call('PUT', '/activity-preferences', {
          body: { notify_community_achievement: true },
        })
      );
      expect(second.preferences.notify_photo_shared).toBe(false);
      expect(second.preferences.notify_community_achievement).toBe(true);
      expect(second.preferences.created_at).toBe(first.preferences.created_at);

      // …and the read path agrees with what the write returned.
      const read = await json<{ preferences: Record<string, unknown> }>(
        await call('GET', '/activity-preferences')
      );
      expect(read.preferences).toEqual(second.preferences);
    });

    it('materialises the defaults on an empty body instead of 400ing', async () => {
      const res = await call('PUT', '/activity-preferences', { body: {} });
      expect(res.status).toBe(200);
      const { preferences } = await json<{ preferences: Record<string, unknown> }>(res);
      for (const field of ACTIVITY_PREFERENCE_FIELDS) {
        expect(preferences[field], field).toBe(ACTIVITY_PREFERENCE_DEFAULTS[field]);
      }
      expect(preferences.updated_at).toEqual(expect.any(String));
    });

    it('ignores unknown keys rather than storing them', async () => {
      const res = await call('PUT', '/activity-preferences', {
        body: { notify_photo_shared: false, notify_nonsense: true },
      });
      expect(res.status).toBe(200);
      const { preferences } = await json<{ preferences: Record<string, unknown> }>(res);
      expect(preferences.notify_nonsense).toBeUndefined();
      expect(preferences.notify_photo_shared).toBe(false);
    });

    it('returns booleans, never SQLite 0/1', async () => {
      await call('PUT', '/activity-preferences', { body: { notify_recipe_created: false } });
      const { preferences } = await json<{ preferences: Record<string, unknown> }>(
        await call('GET', '/activity-preferences')
      );
      const nonBoolean = ACTIVITY_PREFERENCE_FIELDS.filter(
        (f) => typeof preferences[f] !== 'boolean'
      );
      expect(nonBoolean).toEqual([]);
    });
  });

  /* ======================== 8. BODY INSIGHTS ========================== */

  describe('/body-insights (read-only surface)', () => {
    it('has no client write path — insights are AI-produced in P3', async () => {
      // A device that could POST an "AI analysis" would be indistinguishable
      // from the real analyser, so these must not exist.
      for (const path of ['/body-insights', '/body-insights/photo']) {
        const res = await call('POST', path, { body: { date: D1 } });
        expect([404, 405], `POST ${path}`).toContain(res.status);
      }
    });

    it('lists comprehensive insights newest-first and exposes the latest', async () => {
      await svc().saveComprehensiveInsight(UID_A, { date: D1, overall_posture_score: 60 });
      await svc().saveComprehensiveInsight(UID_A, { date: D3, overall_posture_score: 80 });
      await svc().saveComprehensiveInsight(UID_A, { date: D2, overall_posture_score: 70 });

      const list = await json<{ insights: Array<{ date: string }> }>(
        await call('GET', '/body-insights')
      );
      expect(list.insights.map((i) => i.date)).toEqual([D3, D2, D1]);

      const latest = await json<{ insight: { date: string; overall_posture_score: number } }>(
        await call('GET', '/body-insights/latest')
      );
      expect(latest.insight.date).toBe(D3);
      expect(latest.insight.overall_posture_score).toBe(80);
    });

    it('narrows the comprehensive list by date window', async () => {
      await svc().saveComprehensiveInsight(UID_A, { date: D1 });
      await svc().saveComprehensiveInsight(UID_A, { date: D2 });
      await svc().saveComprehensiveInsight(UID_A, { date: D3 });
      const res = await call('GET', `/body-insights?from=${D2}&to=${D2}`);
      const { insights } = await json<{ insights: Array<{ date: string }> }>(res);
      expect(insights.map((i) => i.date)).toEqual([D2]);
    });

    it('returns null (not 404) when the user has no analysis yet', async () => {
      const res = await call('GET', '/body-insights/latest');
      expect(res.status).toBe(200);
      expect((await json<{ insight: unknown }>(res)).insight).toBeNull();
    });

    it('lists per-photo insights and filters by photo and date', async () => {
      const front = await seedUserFile(testEnv.DB, UID_A, 'file_front');
      const back = await seedUserFile(testEnv.DB, UID_A, 'file_back');
      await svc().savePhotoInsight(UID_A, {
        photo_id: front,
        date: D1,
        angle: 'front',
        posture_score: 71,
      });
      await svc().savePhotoInsight(UID_A, { photo_id: back, date: D2, angle: 'back' });

      const all = await json<{ insights: Array<{ photo_id: string; date: string }> }>(
        await call('GET', '/body-insights/photo')
      );
      expect(all.insights.map((i) => i.date)).toEqual([D2, D1]);

      const one = await json<{ insights: Array<{ angle: string; posture_score: number }> }>(
        await call('GET', `/body-insights/photo?photo_id=${front}`)
      );
      expect(one.insights).toHaveLength(1);
      expect(one.insights[0].angle).toBe('front');
      expect(one.insights[0].posture_score).toBe(71);

      const byDate = await json<{ insights: Array<{ date: string }> }>(
        await call('GET', `/body-insights/photo?date=${D2}`)
      );
      expect(byDate.insights.map((i) => i.date)).toEqual([D2]);
    });

    it('honours ?limit on both insight lists', async () => {
      // These grow one row per generation, so an unbounded read is the Body
      // tab's slowest query on an account that has used the feature for a year.
      for (const date of [D1, D2, D3]) {
        await svc().saveComprehensiveInsight(UID_A, { date });
        const file = await seedUserFile(testEnv.DB, UID_A, `file_${date}`);
        await svc().savePhotoInsight(UID_A, { photo_id: file, date, angle: 'front' });
      }

      const comprehensive = await json<{ insights: Array<{ date: string }> }>(
        await call('GET', '/body-insights?limit=2')
      );
      expect(comprehensive.insights.map((i) => i.date)).toEqual([D3, D2]);

      const photo = await json<{ insights: Array<{ date: string }> }>(
        await call('GET', '/body-insights/photo?limit=1')
      );
      expect(photo.insights.map((i) => i.date)).toEqual([D3]);
    });
  });

  describe('list bounds', () => {
    it('honours ?limit on the injury list', async () => {
      for (const [date, bodyPart] of [
        [D1, 'knee'],
        [D2, 'wrist'],
        [D3, 'ankle'],
      ] as const) {
        await call('POST', '/injuries', { body: { date, body_part: bodyPart, pain_level: 2 } });
      }
      const limited = await json<{ injuries: Array<{ body_part: string }> }>(
        await call('GET', '/injuries?limit=2')
      );
      expect(limited.injuries).toHaveLength(2);
    });
  });
});
