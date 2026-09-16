/**
 * Symply Health SOCIAL routes (`src/routes/health-social.ts`) — the HTTP surface
 * of the ported donor `family` / `buddies` / `communityChats` / `challenges`
 * routes (parity P4), driven through the real Hono router against a live
 * miniflare D1 and a live miniflare KV.
 *
 * FOUR layers, in order of importance:
 *
 *   0. KILL SWITCH — this surface SHIPS DISABLED. CONFIG_KV
 *      `health_social_enabled` must hold the LITERAL string 'true'; absent,
 *      '', 'false', 'FALSE', '1', 'yes' and 'True' must all 404 every path.
 *      That is the INVERSE of `savings_enabled` (absent = enabled), because
 *      health sharing is deny-by-default, so the sweep below is exhaustive
 *      rather than a sample.
 *   1. BRAND GATE — `requireHealthApi()` 404s every path on House/Budget/Kaizen,
 *      and fires BEFORE both the flag and the token check.
 *   2. AUTH — 401 without a valid bearer, once the flag is on.
 *   3. THE FIVE PRIVACY RULES — deny-by-default, the ungrantable sensitive
 *      domains, revocation immediacy, cascade on leave/remove, and the invite
 *      that must not reveal whether an email is registered.
 *
 * The cascades, the scope validator and the metric maths are unit-tested in
 * services/__tests__/health-social-service.test.ts; this file owns status
 * codes, envelopes and the end-to-end read path.
 *
 * Harness mirrors health.test.ts / health-food.test.ts: `cloudflare:test` env, a
 * jose HS256 JWT whose `sub` becomes the user id, brand flipped by spreading a
 * new APP_BRAND onto the pool env, and local DDL from health-test-helpers.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import healthRoutes from '../health';
import healthSocialRoutes from '../health-social';

import {
  createHealthSocialTables,
  createHealthTables,
  resetHealthSocialTables,
  resetHealthTables,
  seedHealthUsers,
} from './health-test-helpers';

const testEnv = env as unknown as Env;

const HEALTH_ENV = { ...testEnv, APP_BRAND: 'symply-health' } as Env;
const HOUSE_ENV = { ...testEnv, APP_BRAND: 'symply-house' } as Env;
const BUDGET_ENV = { ...testEnv, APP_BRAND: 'symply-budget' } as Env;
const KAIZEN_ENV = { ...testEnv, APP_BRAND: 'symply-kaizen' } as Env;

const FLAG = 'health_social_enabled';

const UID_A = 'u_social_alice';
const UID_B = 'u_social_bob';
const UID_C = 'u_social_carol';
const UID_D = 'u_social_dave';
const EMAIL_A = `${UID_A}@example.com`;
const EMAIL_B = `${UID_B}@example.com`;
const EMAIL_C = `${UID_C}@example.com`;
/** Deliberately not seeded — rule 5's control case. */
const EMAIL_STRANGER = 'not-a-symply-user@example.com';

const DAY = '2026-06-01';

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

/** Mirrors the `app.route('/health', healthSocialRoutes)` mount in src/index.ts. */
function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/health', healthSocialRoutes);
  return app;
}

let tokenA = '';
let tokenB = '';
let tokenC = '';
let tokenD = '';

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

interface ErrorBody {
  error: { code: string; message: string };
}

interface Grant {
  id: string;
  owner_id: string;
  viewer_id: string;
  relationship_type: string;
  scope: string;
  revoked_at: string | null;
  active: boolean;
}

interface SharedPayload {
  owner_id: string;
  date: string;
  scopes: string[];
  metrics: Record<string, unknown>;
}

/**
 * Every path this router owns. The flag / brand / auth sweeps run over ALL of
 * them, never a sample — one unswept path is a leak on a disabled fleet.
 */
const ROUTES: ReadonlyArray<readonly [string, string, unknown?]> = [
  ['GET', '/social/family'],
  ['POST', '/social/family', { name: 'The Smiths' }],
  ['GET', '/social/family/members'],
  ['POST', '/social/family/invite', { email: EMAIL_B }],
  ['GET', '/social/family/invitations'],
  ['GET', '/social/family/invitations/code/ABCD2345'],
  ['POST', '/social/family/invitations/hfi_x/accept'],
  ['POST', '/social/family/invitations/hfi_x/decline'],
  ['POST', '/social/family/leave'],
  ['DELETE', '/social/family/members/u_x'],
  ['GET', '/social/buddies'],
  ['GET', '/social/buddies/requests'],
  ['POST', '/social/buddies/request', { email: EMAIL_B }],
  ['POST', '/social/buddies/hbud_x/accept'],
  ['POST', '/social/buddies/hbud_x/decline'],
  ['DELETE', '/social/buddies/hbud_x'],
  ['GET', '/social/community/topics'],
  ['POST', '/social/community/topics', { title: 'Hydration', category: 'tips' }],
  ['POST', '/social/community/topics/htop_x/join'],
  ['POST', '/social/community/topics/htop_x/leave'],
  ['GET', '/social/community/topics/htop_x/messages'],
  ['POST', '/social/community/topics/htop_x/messages', { content: 'hello' }],
  ['DELETE', '/social/community/messages/hmsg_x'],
  ['GET', '/social/challenges'],
  [
    'POST',
    '/social/challenges',
    { name: '10k steps', metric: 'activity', target_value: 10000, start_date: DAY },
  ],
  ['POST', '/social/challenges/hchl_x/join'],
  ['POST', '/social/challenges/hchl_x/leave'],
  ['GET', '/social/challenges/hchl_x/progress'],
  ['POST', '/social/challenges/hchl_x/progress', { date: DAY, value: 5000 }],
  ['GET', '/social/shares/scopes'],
  ['GET', '/social/shares'],
  ['GET', '/social/shares/received'],
  [
    'POST',
    '/social/shares',
    { viewer_id: UID_B, relationship_type: 'family', scopes: ['weight'] },
  ],
  ['DELETE', '/social/shares/hms_x'],
  [`GET`, `/social/shares/${UID_B}/metrics?date=${DAY}`],
];

/** The gate's own envelope — no real handler ever answers exactly this. */
const GATE_MESSAGE = 'Not found';

async function isGate404(res: Response): Promise<boolean> {
  if (res.status !== 404) return false;
  try {
    const b = (await res.json()) as { error?: { message?: string } };
    return b.error?.message === GATE_MESSAGE;
  } catch {
    return true;
  }
}

/* ======================= domain shorthands ============================ */

/** A creates a family, invites `email`, and that user accepts. */
async function buildFamily(inviteeToken: string, inviteeEmail: string): Promise<void> {
  const created = await call('POST', '/social/family', { token: tokenA, body: { name: 'Fam' } });
  if (created.status !== 201 && created.status !== 409) {
    throw new Error(`family create failed: ${created.status}`);
  }
  const invited = await call('POST', '/social/family/invite', {
    token: tokenA,
    body: { email: inviteeEmail },
  });
  expect(invited.status).toBe(201);
  const inbox = await json<{ received: Array<{ id: string }> }>(
    await call('GET', '/social/family/invitations', { token: inviteeToken })
  );
  expect(inbox.received.length).toBeGreaterThan(0);
  const accepted = await call(
    'POST',
    `/social/family/invitations/${inbox.received[0].id}/accept`,
    { token: inviteeToken }
  );
  expect(accepted.status).toBe(200);
}

/** A and `token` become accepted buddies. Returns the connection id. */
async function buildBuddy(token: string, email: string): Promise<string> {
  const requested = await call('POST', '/social/buddies/request', {
    token: tokenA,
    body: { email },
  });
  expect(requested.status).toBe(201);
  const inbox = await json<{ received: Array<{ id: string }> }>(
    await call('GET', '/social/buddies/requests', { token })
  );
  expect(inbox.received.length).toBeGreaterThan(0);
  const accepted = await call('POST', `/social/buddies/${inbox.received[0].id}/accept`, { token });
  expect(accepted.status).toBe(200);
  return inbox.received[0].id;
}

async function grant(
  ownerToken: string,
  viewerId: string,
  relationship: 'family' | 'buddy',
  scopes: string[]
): Promise<Grant[]> {
  const res = await call('POST', '/social/shares', {
    token: ownerToken,
    body: { viewer_id: viewerId, relationship_type: relationship, scopes },
  });
  expect(res.status).toBe(201);
  return (await json<{ grants: Grant[] }>(res)).grants;
}

async function readShared(token: string, ownerId: string): Promise<Response> {
  return call('GET', `/social/shares/${ownerId}/metrics?date=${DAY}`, { token });
}

/** Give A a day of real P1 data so a granted read has something to return. */
async function seedAliceDay(): Promise<void> {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/health', healthRoutes);
  const headers = { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' };
  const post = (path: string, body: unknown) =>
    app.request(`/health${path}`, { method: 'POST', headers, body: JSON.stringify(body) }, HEALTH_ENV);
  await post('/weight/entries', { date: DAY, weight: 70.5, unit: 'kg' });
  await post('/water/entries', { date: DAY, amount_ml: 500 });
  await post('/water/entries', { date: DAY, amount_ml: 250 });
  await post('/nutrition/entries', {
    date: DAY,
    food_name: 'Oats',
    meal_type: 'breakfast',
    calories: 300,
    proteins: 10,
    carbohydrates: 50,
    fats: 5,
  });
  await post('/entries/steps', { date: DAY, steps: 8000 });
}

describe('health social routes', () => {
  beforeEach(async () => {
    await createHealthTables(testEnv.DB);
    await createHealthSocialTables(testEnv.DB);
    await resetHealthSocialTables(testEnv.DB);
    await resetHealthTables(testEnv.DB);
    await seedHealthUsers(testEnv.DB, [UID_A, UID_B, UID_C, UID_D]);
    tokenA = await mintToken(UID_A);
    tokenB = await mintToken(UID_B);
    tokenC = await mintToken(UID_C);
    tokenD = await mintToken(UID_D);
    // Default ON for the behavioural suites below; the kill-switch block owns
    // the OFF cases and restores this itself.
    await testEnv.CONFIG_KV.put(FLAG, 'true');
  });

  /* ================= 0. KILL SWITCH — ships DISABLED ================= */

  describe('CONFIG_KV kill switch (health_social_enabled)', () => {
    // INVERSE of routes/savings.ts, on purpose: there an ABSENT key means
    // enabled and only the literal 'false' disables. Health social data is
    // deny-by-default, so absence — a fresh environment, a typo'd key, a
    // half-finished rollout — must mean OFF.
    it.each([
      ['absent', null],
      ['empty string', ''],
      ['false', 'false'],
      ['FALSE', 'FALSE'],
      ['True (wrong case)', 'True'],
      ['TRUE', 'TRUE'],
      ['1', '1'],
      ['yes', 'yes'],
      ['on', 'on'],
      ['enabled', 'enabled'],
      ['true with whitespace', ' true '],
    ])('404s EVERY route when the flag is %s', async (_label, value) => {
      if (value === null) await testEnv.CONFIG_KV.delete(FLAG);
      else await testEnv.CONFIG_KV.put(FLAG, value);

      const reachable: string[] = [];
      for (const [method, path, body] of ROUTES) {
        const res = await call(method, path, { token: tokenA, body });
        if (res.status !== 404) reachable.push(`${method} ${path} -> ${res.status}`);
      }
      expect(reachable).toEqual([]);
    });

    it('is reachable ONLY with exactly the literal "true"', async () => {
      await testEnv.CONFIG_KV.put(FLAG, 'true');
      const blocked: string[] = [];
      for (const [method, path, body] of ROUTES) {
        const res = await call(method, path, { token: tokenA, body });
        if (await isGate404(res)) blocked.push(`${method} ${path}`);
      }
      expect(blocked).toEqual([]);
    });

    it('fires BEFORE auth — a tokenless request on a disabled fleet 404s, never 401s', async () => {
      // A 401 would confirm the social surface exists behind the flag.
      await testEnv.CONFIG_KV.delete(FLAG);
      const res = await call('GET', '/social/family', { token: null });
      expect(res.status).toBe(404);
      expect(await json<ErrorBody>(res)).toEqual({
        error: { code: 'not_found', message: GATE_MESSAGE },
      });
    });

    it('flipping the flag off makes an established share unreadable at once', async () => {
      // The kill switch is not just a mount guard: it must also cut live reads.
      await buildFamily(tokenB, EMAIL_B);
      await seedAliceDay();
      await grant(tokenA, UID_B, 'family', ['weight']);
      expect((await readShared(tokenB, UID_A)).status).toBe(200);

      await testEnv.CONFIG_KV.put(FLAG, 'false');
      expect((await readShared(tokenB, UID_A)).status).toBe(404);
    });
  });

  /* ===================== 1. BRAND GATE ============================== */

  describe('brand gate (requireHealthApi)', () => {
    it.each([
      ['symply-house', HOUSE_ENV],
      ['symply-budget', BUDGET_ENV],
      ['symply-kaizen', KAIZEN_ENV],
    ])('404s every /health/social route on %s', async (_brand, brandEnv) => {
      const leaked: string[] = [];
      for (const [method, path, body] of ROUTES) {
        const res = await call(method, path, { token: tokenA, body, brandEnv });
        if (!(await isGate404(res))) leaked.push(`${method} ${path} -> ${res.status}`);
      }
      expect(leaked).toEqual([]);
    });

    it('fires BEFORE the flag — an enabled flag never exposes the wrong brand', async () => {
      await testEnv.CONFIG_KV.put(FLAG, 'true');
      const res = await call('GET', '/social/family', { token: tokenA, brandEnv: BUDGET_ENV });
      expect(res.status).toBe(404);
    });

    it('no route 5xxs on a cold, empty account', async () => {
      const crashed: string[] = [];
      for (const [method, path, body] of ROUTES) {
        const res = await call(method, path, { token: tokenA, body });
        if (res.status >= 500) crashed.push(`${method} ${path} -> ${res.status}`);
      }
      expect(crashed).toEqual([]);
    });

    it('coexists with the P1 router on the same /health prefix', async () => {
      const app = new Hono<{ Bindings: Env }>();
      app.route('/health', healthRoutes);
      app.route('/health', healthSocialRoutes);
      const headers = { Authorization: `Bearer ${tokenA}` };
      expect((await app.request('/health/weight/entries', { headers }, HEALTH_ENV)).status).toBe(200);
      expect((await app.request('/health/social/family', { headers }, HEALTH_ENV)).status).toBe(200);
    });
  });

  /* ========================== 2. AUTH =============================== */

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
      expect((await call('GET', '/social/family', { token: forged })).status).toBe(401);
    });

    it('401s a malformed bearer value', async () => {
      expect((await call('GET', '/social/family', { token: 'not-a-jwt' })).status).toBe(401);
    });
  });

  /* ========================== 3. FAMILY ============================= */

  describe('family', () => {
    it('creates a family with the caller as owner and sole member', async () => {
      const res = await call('POST', '/social/family', { token: tokenA, body: { name: 'Fam' } });
      expect(res.status).toBe(201);
      const body = await json<{ family: { family: { owner_id: string }; members: unknown[] } }>(res);
      expect(body.family.family.owner_id).toBe(UID_A);
      expect(body.family.members).toHaveLength(1);
    });

    it('409s a second family for the same user', async () => {
      await call('POST', '/social/family', { token: tokenA, body: { name: 'Fam' } });
      const again = await call('POST', '/social/family', { token: tokenA, body: { name: 'Two' } });
      expect(again.status).toBe(409);
      expect((await json<ErrorBody>(again)).error.code).toBe('already_in_family');
    });

    it('invite → inbox → accept puts the invitee in the family', async () => {
      await buildFamily(tokenB, EMAIL_B);
      const fam = await json<{ family: { members: Array<{ user_id: string }> } }>(
        await call('GET', '/social/family', { token: tokenB })
      );
      expect(fam.family.members.map((m) => m.user_id).sort()).toEqual([UID_A, UID_B].sort());
    });

    it('exposes members as OPAQUE user ids — never an email or a display name', async () => {
      // Otherwise the member list becomes a directory of who uses the app.
      await buildFamily(tokenB, EMAIL_B);
      const raw = await (await call('GET', '/social/family/members', { token: tokenB })).text();
      expect(raw).not.toContain('@example.com');
      expect(raw).toContain(UID_A);
    });

    it('404s an invitation addressed to somebody else', async () => {
      await buildFamily(tokenB, EMAIL_B);
      await call('POST', '/social/family/invite', { token: tokenA, body: { email: EMAIL_C } });
      const inboxC = await json<{ received: Array<{ id: string }> }>(
        await call('GET', '/social/family/invitations', { token: tokenC })
      );
      // Dave was never invited and must not be able to consume Carol's invite.
      const stolen = await call(
        'POST',
        `/social/family/invitations/${inboxC.received[0].id}/accept`,
        { token: tokenD }
      );
      expect(stolen.status).toBe(404);
      expect((await json<ErrorBody>(stolen)).error.message).toBe('Invitation not found');
    });

    it('resolves a deep-link code only for the addressee', async () => {
      await call('POST', '/social/family', { token: tokenA, body: { name: 'Fam' } });
      const invite = await json<{ invitation: { invite_code: string } }>(
        await call('POST', '/social/family/invite', { token: tokenA, body: { email: EMAIL_B } })
      );
      const code = invite.invitation.invite_code;
      expect(
        (await call('GET', `/social/family/invitations/code/${code}`, { token: tokenB })).status
      ).toBe(200);
      // A guessed/forwarded code must not reveal the family's name to anyone else.
      expect(
        (await call('GET', `/social/family/invitations/code/${code}`, { token: tokenC })).status
      ).toBe(404);
    });

    it('declining leaves the invitee outside the family', async () => {
      await call('POST', '/social/family', { token: tokenA, body: { name: 'Fam' } });
      await call('POST', '/social/family/invite', { token: tokenA, body: { email: EMAIL_B } });
      const inbox = await json<{ received: Array<{ id: string }> }>(
        await call('GET', '/social/family/invitations', { token: tokenB })
      );
      expect(
        (await call('POST', `/social/family/invitations/${inbox.received[0].id}/decline`, {
          token: tokenB,
        })).status
      ).toBe(200);
      const fam = await json<{ family: unknown }>(
        await call('GET', '/social/family', { token: tokenB })
      );
      expect(fam.family).toBeNull();
    });

    it('only the owner may remove a member — a member gets 404, never 403', async () => {
      await buildFamily(tokenB, EMAIL_B);
      const res = await call(`DELETE`, `/social/family/members/${UID_A}`, { token: tokenB });
      expect(res.status).toBe(404);
      const fam = await json<{ family: { members: unknown[] } }>(
        await call('GET', '/social/family', { token: tokenA })
      );
      expect(fam.family.members).toHaveLength(2);
    });
  });

  /* ================= 4. RULE 5 — the invite must not leak =========== */

  describe('rule 5: an invite never reveals whether an email is registered', () => {
    it('answers identically for a registered and an unregistered address', async () => {
      await call('POST', '/social/family', { token: tokenA, body: { name: 'Fam' } });

      const known = await call('POST', '/social/family/invite', {
        token: tokenA,
        body: { email: EMAIL_B },
      });
      const unknown = await call('POST', '/social/family/invite', {
        token: tokenA,
        body: { email: EMAIL_STRANGER },
      });

      expect(known.status).toBe(unknown.status);
      expect(known.status).toBe(201);

      const a = await json<{ invitation: Record<string, unknown> }>(known);
      const b = await json<{ invitation: Record<string, unknown> }>(unknown);
      // Same keys, same shape. Only the id / code / email differ.
      expect(Object.keys(a.invitation).sort()).toEqual(Object.keys(b.invitation).sort());
      expect(a.invitation.status).toBe(b.invitation.status);
      // The resolved account id is stored but NEVER serialised — echoing it
      // would answer "is this address registered?" directly.
      expect(a.invitation).not.toHaveProperty('invitee_id');
      expect(b.invitation).not.toHaveProperty('invitee_id');
      // Value-level, not substring: `EMAIL_B` legitimately contains the id as
      // text, and the address is what the INVITER typed. What must never
      // appear is the resolved ACCOUNT ID as a field of its own.
      expect(Object.values(a.invitation)).not.toContain(UID_B);
    });

    it('still 201s for an address that already belongs to another family', async () => {
      // The donor answered 400 "This user is already a member of a family",
      // which is an account-existence AND membership oracle. Not ported: the
      // conflict is detected at ACCEPT time, by the account holder themselves.
      await call('POST', '/social/family', { token: tokenC, body: { name: 'Carols' } });
      await call('POST', '/social/family', { token: tokenA, body: { name: 'Fam' } });
      const res = await call('POST', '/social/family/invite', {
        token: tokenA,
        body: { email: EMAIL_C },
      });
      expect(res.status).toBe(201);

      // …and Carol finds out only when SHE tries to accept.
      const inbox = await json<{ received: Array<{ id: string }> }>(
        await call('GET', '/social/family/invitations', { token: tokenC })
      );
      const accept = await call(
        'POST',
        `/social/family/invitations/${inbox.received[0].id}/accept`,
        { token: tokenC }
      );
      expect(accept.status).toBe(409);
      expect((await json<ErrorBody>(accept)).error.code).toBe('already_in_family');
    });

    it('a buddy request is an invite too — same invariant response', async () => {
      // The donor's `recipient_id` + 404 "Recipient not found" was an account
      // oracle; here the request is addressed to an email like a family invite.
      const known = await call('POST', '/social/buddies/request', {
        token: tokenA,
        body: { email: EMAIL_B },
      });
      const unknown = await call('POST', '/social/buddies/request', {
        token: tokenA,
        body: { email: EMAIL_STRANGER },
      });
      expect(known.status).toBe(unknown.status);
      expect(known.status).toBe(201);
      const a = await json<{ request: Record<string, unknown> }>(known);
      const b = await json<{ request: Record<string, unknown> }>(unknown);
      expect(Object.keys(a.request).sort()).toEqual(Object.keys(b.request).sort());
      expect(a.request.status).toBe(b.request.status);
      expect(a.request).not.toHaveProperty('recipient_id');
      expect(Object.values(a.request)).not.toContain(UID_B);
    });

    it('the sent list echoes only the address the caller typed themselves', async () => {
      await call('POST', '/social/family', { token: tokenA, body: { name: 'Fam' } });
      await call('POST', '/social/family/invite', { token: tokenA, body: { email: EMAIL_B } });
      const sent = await json<{ sent: Array<Record<string, unknown>> }>(
        await call('GET', '/social/family/invitations', { token: tokenA })
      );
      expect(sent.sent[0].invitee_email).toBe(EMAIL_B);
      expect(sent.sent[0]).not.toHaveProperty('invitee_id');
      expect(Object.values(sent.sent[0])).not.toContain(UID_B);
    });
  });

  /* ============ 5. RULE 1 — nothing is shared by default ============ */

  describe('rule 1: a relationship grants NOTHING', () => {
    it('a brand-new family member reads nothing', async () => {
      await buildFamily(tokenB, EMAIL_B);
      await seedAliceDay();

      const res = await readShared(tokenB, UID_A);
      expect(res.status).toBe(404);
      expect((await json<ErrorBody>(res)).error.message).toBe('Shared data not found');

      const received = await json<{ grants: Grant[] }>(
        await call('GET', '/social/shares/received', { token: tokenB })
      );
      expect(received.grants).toEqual([]);
    });

    it('a brand-new buddy reads nothing', async () => {
      await buildBuddy(tokenB, EMAIL_B);
      await seedAliceDay();
      expect((await readShared(tokenB, UID_A)).status).toBe(404);
    });

    it('an explicit grant unlocks EXACTLY the named group and nothing else', async () => {
      await buildFamily(tokenB, EMAIL_B);
      await seedAliceDay();
      await grant(tokenA, UID_B, 'family', ['weight']);

      const res = await readShared(tokenB, UID_A);
      expect(res.status).toBe(200);
      const body = await json<SharedPayload>(res);
      expect(body.scopes).toEqual(['weight']);
      expect(body.metrics.weight).toEqual({ value: 70.5, unit: 'kg', date: DAY });
      // An ungranted group is ABSENT, not null — a client bug cannot render it.
      expect(body.metrics).not.toHaveProperty('nutrition');
      expect(body.metrics).not.toHaveProperty('water');
      expect(body.metrics).not.toHaveProperty('activity');
    });

    it('adding a second scope widens the payload by exactly that group', async () => {
      await buildFamily(tokenB, EMAIL_B);
      await seedAliceDay();
      await grant(tokenA, UID_B, 'family', ['weight']);
      await grant(tokenA, UID_B, 'family', ['water', 'activity']);

      const body = await json<SharedPayload>(await readShared(tokenB, UID_A));
      expect(body.scopes.sort()).toEqual(['activity', 'water', 'weight']);
      expect(body.metrics.water).toEqual({ total_ml: 750 });
      expect(body.metrics.activity).toMatchObject({ steps: 8000 });
      expect(body.metrics).not.toHaveProperty('nutrition');
    });

    it('sharing is DIRECTIONAL — A granting B does not let A read B', async () => {
      await buildFamily(tokenB, EMAIL_B);
      await grant(tokenA, UID_B, 'family', ['weight']);
      expect((await readShared(tokenA, UID_B)).status).toBe(404);
    });
  });

  /* ====== 6. RULE 2 — the sensitive domains are UNGRANTABLE ========= */

  describe('rule 2: cycle / vitality / body data can never be granted', () => {
    beforeEach(async () => {
      await buildFamily(tokenB, EMAIL_B);
    });

    it.each(['cycle', 'vitality', 'body_photos', 'body_measurements'])(
      'refuses a %s grant with forbidden_scope',
      async (scope) => {
        const res = await call('POST', '/social/shares', {
          token: tokenA,
          body: { viewer_id: UID_B, relationship_type: 'family', scopes: [scope] },
        });
        expect(res.status).toBe(400);
        const body = await json<ErrorBody>(res);
        expect(body.error.code).toBe('forbidden_scope');
        expect(body.error.message).toContain(scope);
        // Nothing was written, so nothing became readable.
        const grants = await json<{ grants: Grant[] }>(
          await call('GET', '/social/shares', { token: tokenA })
        );
        expect(grants.grants).toEqual([]);
      }
    );

    it('refuses the whole request when a sensitive scope rides along a valid one', async () => {
      // Atomicity matters: a partial grant would silently share `weight` while
      // the caller believes the request failed.
      const res = await call('POST', '/social/shares', {
        token: tokenA,
        body: { viewer_id: UID_B, relationship_type: 'family', scopes: ['weight', 'cycle'] },
      });
      expect(res.status).toBe(400);
      expect((await json<ErrorBody>(res)).error.code).toBe('forbidden_scope');

      const grants = await json<{ grants: Grant[] }>(
        await call('GET', '/social/shares', { token: tokenA })
      );
      expect(grants.grants).toEqual([]);
      await seedAliceDay();
      expect((await readShared(tokenB, UID_A)).status).toBe(404);
    });

    it('distinguishes a sensitive scope from an unknown one', async () => {
      const unknown = await call('POST', '/social/shares', {
        token: tokenA,
        body: { viewer_id: UID_B, relationship_type: 'family', scopes: ['everything'] },
      });
      expect(unknown.status).toBe(400);
      expect((await json<ErrorBody>(unknown)).error.code).toBe('unknown_scope');
    });

    it('publishes the exclusion list so the client cannot even offer it', async () => {
      const res = await call('GET', '/social/shares/scopes', { token: tokenA });
      expect(res.status).toBe(200);
      const body = await json<{ shareable: string[]; never_shareable: string[] }>(res);
      expect(body.never_shareable.sort()).toEqual(
        ['body_measurements', 'body_photos', 'cycle', 'vitality'].sort()
      );
      for (const forbidden of body.never_shareable) {
        expect(body.shareable).not.toContain(forbidden);
      }
    });

    it('a challenge cannot be built on a sensitive metric either', async () => {
      // Otherwise a "cycle challenge" leaderboard would be a second, weaker
      // path to exactly the figures no grant may name.
      const res = await call('POST', '/social/challenges', {
        token: tokenA,
        body: { name: 'Cycle', metric: 'cycle', target_value: 5, start_date: DAY },
      });
      expect(res.status).toBe(400);
      expect((await json<ErrorBody>(res)).error.code).toBe('forbidden_scope');
    });

    it('D1 itself refuses a sensitive grant row — the storage layer agrees', async () => {
      // Belt and braces: even if the service layer were bypassed entirely, the
      // migration-0121 CHECK constraint rejects the insert.
      const now = new Date().toISOString();
      await expect(
        testEnv.DB.prepare(
          `INSERT INTO health_metric_shares
             (id, owner_id, viewer_id, relationship_type, relationship_id, scope,
              granted_at, created_at, updated_at)
           VALUES ('hms_forced', ?, ?, 'family', 'hfam_x', 'cycle', ?, ?, ?)`
        )
          .bind(UID_A, UID_B, now, now, now)
          .run()
      ).rejects.toThrow();
    });
  });

  /* ============== 7. RULE 3 — revocation is immediate =============== */

  describe('rule 3: revocation takes effect on the very next request', () => {
    it('a revoked grant is unreadable immediately', async () => {
      await buildFamily(tokenB, EMAIL_B);
      await seedAliceDay();
      const [g] = await grant(tokenA, UID_B, 'family', ['weight']);
      expect((await readShared(tokenB, UID_A)).status).toBe(200);

      const revoked = await call('DELETE', `/social/shares/${g.id}`, { token: tokenA });
      expect(revoked.status).toBe(200);

      // No cache, no copy: the NEXT request already reads nothing.
      expect((await readShared(tokenB, UID_A)).status).toBe(404);
      const received = await json<{ grants: Grant[] }>(
        await call('GET', '/social/shares/received', { token: tokenB })
      );
      expect(received.grants).toEqual([]);
    });

    it('revoking one scope leaves the others readable', async () => {
      await buildFamily(tokenB, EMAIL_B);
      await seedAliceDay();
      const grants = await grant(tokenA, UID_B, 'family', ['weight', 'water']);
      const weight = grants.find((g) => g.scope === 'weight')!;
      await call('DELETE', `/social/shares/${weight.id}`, { token: tokenA });

      const body = await json<SharedPayload>(await readShared(tokenB, UID_A));
      expect(body.scopes).toEqual(['water']);
      expect(body.metrics).not.toHaveProperty('weight');
    });

    it('re-granting revives the SAME row rather than duplicating it', async () => {
      await buildFamily(tokenB, EMAIL_B);
      await seedAliceDay();
      const [first] = await grant(tokenA, UID_B, 'family', ['weight']);
      await call('DELETE', `/social/shares/${first.id}`, { token: tokenA });
      const [again] = await grant(tokenA, UID_B, 'family', ['weight']);

      expect(again.id).toBe(first.id);
      expect(again.revoked_at).toBeNull();
      const all = await json<{ grants: Grant[] }>(
        await call('GET', '/social/shares', { token: tokenA })
      );
      expect(all.grants.filter((g) => g.scope === 'weight')).toHaveLength(1);
      expect((await readShared(tokenB, UID_A)).status).toBe(200);
    });

    it('only the OWNER may revoke — the viewer gets 404', async () => {
      await buildFamily(tokenB, EMAIL_B);
      const [g] = await grant(tokenA, UID_B, 'family', ['weight']);
      const res = await call('DELETE', `/social/shares/${g.id}`, { token: tokenB });
      expect(res.status).toBe(404);
      await seedAliceDay();
      expect((await readShared(tokenB, UID_A)).status).toBe(200);
    });
  });

  /* ====== 8. RULE 4 — leaving / removing revokes both directions ==== */

  describe('rule 4: losing the relationship revokes every grant, both ways', () => {
    it('leaving a family revokes A→B and B→A', async () => {
      await buildFamily(tokenB, EMAIL_B);
      await seedAliceDay();
      await grant(tokenA, UID_B, 'family', ['weight']);
      await grant(tokenB, UID_A, 'family', ['water']);
      expect((await readShared(tokenB, UID_A)).status).toBe(200);
      expect((await readShared(tokenA, UID_B)).status).toBe(200);

      const left = await call('POST', '/social/family/leave', { token: tokenB });
      expect(left.status).toBe(200);
      expect((await json<{ revoked_grants: number }>(left)).revoked_grants).toBe(2);

      expect((await readShared(tokenB, UID_A)).status).toBe(404);
      expect((await readShared(tokenA, UID_B)).status).toBe(404);
    });

    it('being removed by the owner revokes both directions too', async () => {
      await buildFamily(tokenB, EMAIL_B);
      await seedAliceDay();
      await grant(tokenA, UID_B, 'family', ['weight']);
      await grant(tokenB, UID_A, 'family', ['water']);

      const removed = await call('DELETE', `/social/family/members/${UID_B}`, { token: tokenA });
      expect(removed.status).toBe(200);
      expect((await json<{ revoked_grants: number }>(removed)).revoked_grants).toBe(2);
      expect((await readShared(tokenB, UID_A)).status).toBe(404);
      expect((await readShared(tokenA, UID_B)).status).toBe(404);
    });

    it('removing a buddy revokes the buddy grants', async () => {
      const link = await buildBuddy(tokenB, EMAIL_B);
      await seedAliceDay();
      await grant(tokenA, UID_B, 'buddy', ['nutrition']);
      expect((await readShared(tokenB, UID_A)).status).toBe(200);

      const removed = await call('DELETE', `/social/buddies/${link}`, { token: tokenB });
      expect(removed.status).toBe(200);
      expect((await readShared(tokenB, UID_A)).status).toBe(404);
    });

    it('the two relationships are independent — dropping one keeps the other', async () => {
      // A and B are BOTH family and buddies. Un-buddying must not silently
      // revoke what the family relationship was granted for, and vice versa.
      await buildFamily(tokenB, EMAIL_B);
      const link = await buildBuddy(tokenB, EMAIL_B);
      await seedAliceDay();
      await grant(tokenA, UID_B, 'family', ['weight']);
      await grant(tokenA, UID_B, 'buddy', ['water']);

      await call('DELETE', `/social/buddies/${link}`, { token: tokenA });

      const body = await json<SharedPayload>(await readShared(tokenB, UID_A));
      expect(body.scopes).toEqual(['weight']);
      expect(body.metrics).not.toHaveProperty('water');
    });

    it('a grant that outlives its relationship still reads nothing', async () => {
      // Defence in depth: `readSharedMetrics` re-checks the relationship live,
      // so a cascade bug alone could never re-open a closed door. The grant row
      // is forced back to un-revoked here to simulate exactly that failure.
      await buildFamily(tokenB, EMAIL_B);
      await seedAliceDay();
      const [g] = await grant(tokenA, UID_B, 'family', ['weight']);
      await call('POST', '/social/family/leave', { token: tokenB });

      await testEnv.DB.prepare(`UPDATE health_metric_shares SET revoked_at = NULL WHERE id = ?`)
        .bind(g.id)
        .run();

      expect((await readShared(tokenB, UID_A)).status).toBe(404);
    });
  });

  /* ================== 9. CROSS-USER / IMPERSONATION ================= */

  describe('cross-user', () => {
    it('A cannot grant on B behalf — the grantor is always the caller', async () => {
      await buildFamily(tokenB, EMAIL_B);
      await buildFamily(tokenC, EMAIL_C);
      await seedAliceDay();

      // Carol tries to make Bob share HIS data with her by naming him as owner.
      const res = await call('POST', '/social/shares', {
        token: tokenC,
        body: {
          owner_id: UID_B,
          viewer_id: UID_C,
          relationship_type: 'family',
          scopes: ['weight'],
        },
      });
      // `owner_id` is not a field; the grant (if any) is Carol's own.
      if (res.status === 201) {
        const grants = (await json<{ grants: Grant[] }>(res)).grants;
        for (const g of grants) expect(g.owner_id).toBe(UID_C);
      }
      const bobsGrants = await json<{ grants: Grant[] }>(
        await call('GET', '/social/shares', { token: tokenB })
      );
      expect(bobsGrants.grants).toEqual([]);
      expect((await readShared(tokenC, UID_B)).status).toBe(404);
    });

    it('cannot read through a grant given to somebody else', async () => {
      await buildFamily(tokenB, EMAIL_B);
      await buildFamily(tokenC, EMAIL_C);
      await seedAliceDay();
      await grant(tokenA, UID_B, 'family', ['weight']);

      // Carol is in the same family, but the grant names Bob.
      expect((await readShared(tokenC, UID_A)).status).toBe(404);
      expect((await readShared(tokenB, UID_A)).status).toBe(200);
    });

    it('404s a grant to somebody with no relationship — never 403', async () => {
      // Dave is a stranger. A 403 would confirm the account exists.
      const res = await call('POST', '/social/shares', {
        token: tokenA,
        body: { viewer_id: UID_D, relationship_type: 'buddy', scopes: ['weight'] },
      });
      expect(res.status).toBe(404);
      const ghost = await call('POST', '/social/shares', {
        token: tokenA,
        body: { viewer_id: 'u_does_not_exist', relationship_type: 'buddy', scopes: ['weight'] },
      });
      expect(ghost.status).toBe(404);
      expect(await json<ErrorBody>(res)).toEqual(await json<ErrorBody>(ghost));
    });

    it('refuses a self-grant', async () => {
      const res = await call('POST', '/social/shares', {
        token: tokenA,
        body: { viewer_id: UID_A, relationship_type: 'family', scopes: ['weight'] },
      });
      expect(res.status).toBe(400);
      expect((await json<ErrorBody>(res)).error.code).toBe('invalid_viewer');
    });

    it('reading your own id through the share endpoint is a 404, not a bypass', async () => {
      await seedAliceDay();
      expect((await readShared(tokenA, UID_A)).status).toBe(404);
    });
  });

  /* ======================== 10. COMMUNITY ========================== */

  describe('community rooms', () => {
    async function makeTopic(token = tokenA): Promise<string> {
      const res = await call('POST', '/social/community/topics', {
        token,
        body: { title: 'Hydration', category: 'tips' },
      });
      expect(res.status).toBe(201);
      return (await json<{ topic: { id: string } }>(res)).topic.id;
    }

    it('lists topics for everyone but requires joining to READ messages', async () => {
      const topicId = await makeTopic();
      await call('POST', `/social/community/topics/${topicId}/messages`, {
        token: tokenA,
        body: { content: 'drink water' },
      });

      const list = await json<{ topics: Array<{ id: string; joined: boolean }> }>(
        await call('GET', '/social/community/topics', { token: tokenB })
      );
      expect(list.topics.map((t) => t.id)).toContain(topicId);
      expect(list.topics.find((t) => t.id === topicId)!.joined).toBe(false);

      // Browsing the directory must not expose what people wrote.
      const denied = await call('GET', `/social/community/topics/${topicId}/messages`, {
        token: tokenB,
      });
      expect(denied.status).toBe(403);
      expect((await json<ErrorBody>(denied)).error.code).toBe('not_a_participant');

      await call('POST', `/social/community/topics/${topicId}/join`, { token: tokenB });
      const ok = await call('GET', `/social/community/topics/${topicId}/messages`, {
        token: tokenB,
      });
      expect(ok.status).toBe(200);
      expect((await json<{ messages: unknown[] }>(ok)).messages).toHaveLength(1);
    });

    it('403s a post from a non-participant', async () => {
      const topicId = await makeTopic();
      const res = await call('POST', `/social/community/topics/${topicId}/messages`, {
        token: tokenB,
        body: { content: 'sneaking in' },
      });
      expect(res.status).toBe(403);
    });

    it('carries TEXT ONLY — an attachment payload is silently not stored', async () => {
      // The donor allowed `recipe_share` / `workout_share` / `achievement`
      // message types with a `data_json` body, which would push health data
      // into a PUBLIC room with no grant at all. There is no such field here.
      const topicId = await makeTopic();
      const res = await call('POST', `/social/community/topics/${topicId}/messages`, {
        token: tokenA,
        body: {
          content: 'hi',
          message_type: 'workout_share',
          data_json: JSON.stringify({ weight_kg: 70.5 }),
        },
      });
      expect(res.status).toBe(201);
      const raw = await (
        await call('GET', `/social/community/topics/${topicId}/messages`, { token: tokenA })
      ).text();
      expect(raw).not.toContain('70.5');
      expect(raw).not.toContain('workout_share');
    });

    it('never exposes an email in a public room', async () => {
      const topicId = await makeTopic();
      await call('POST', `/social/community/topics/${topicId}/messages`, {
        token: tokenA,
        body: { content: 'hello' },
      });
      const raw = await (
        await call('GET', `/social/community/topics/${topicId}/messages`, { token: tokenA })
      ).text();
      expect(raw).not.toContain('@example.com');
    });

    it('deletes only your own message', async () => {
      const topicId = await makeTopic();
      const posted = await json<{ message: { id: string } }>(
        await call('POST', `/social/community/topics/${topicId}/messages`, {
          token: tokenA,
          body: { content: 'mine' },
        })
      );
      await call('POST', `/social/community/topics/${topicId}/join`, { token: tokenB });
      expect(
        (await call('DELETE', `/social/community/messages/${posted.message.id}`, { token: tokenB }))
          .status
      ).toBe(404);
      expect(
        (await call('DELETE', `/social/community/messages/${posted.message.id}`, { token: tokenA }))
          .status
      ).toBe(200);
    });
  });

  /* ======================== 11. CHALLENGES ========================= */

  describe('challenges', () => {
    async function makeChallenge(
      body: Record<string, unknown> = {},
      token = tokenA
    ): Promise<string> {
      const res = await call('POST', '/social/challenges', {
        token,
        body: {
          name: '10k steps',
          metric: 'activity',
          target_value: 10000,
          visibility: 'public',
          start_date: DAY,
          ...body,
        },
      });
      expect(res.status).toBe(201);
      return (await json<{ challenge: { id: string } }>(res)).challenge.id;
    }

    it('creator is auto-joined; another user can join and leave', async () => {
      const id = await makeChallenge();
      const before = await json<{ challenges: Array<{ id: string; joined: boolean }> }>(
        await call('GET', '/social/challenges', { token: tokenB })
      );
      expect(before.challenges.find((c) => c.id === id)!.joined).toBe(false);

      expect((await call('POST', `/social/challenges/${id}/join`, { token: tokenB })).status).toBe(200);
      const after = await json<{ challenges: Array<{ id: string; joined: boolean }> }>(
        await call('GET', '/social/challenges', { token: tokenB })
      );
      expect(after.challenges.find((c) => c.id === id)!.joined).toBe(true);
      expect((await call('POST', `/social/challenges/${id}/leave`, { token: tokenB })).status).toBe(200);
    });

    it('hides a family-visibility challenge from an unrelated user (404, not 403)', async () => {
      const id = await makeChallenge({ visibility: 'family' });
      const list = await json<{ challenges: Array<{ id: string }> }>(
        await call('GET', '/social/challenges', { token: tokenD })
      );
      expect(list.challenges.map((c) => c.id)).not.toContain(id);
      expect((await call('POST', `/social/challenges/${id}/join`, { token: tokenD })).status).toBe(404);
      expect((await call('GET', `/social/challenges/${id}/progress`, { token: tokenD })).status).toBe(404);
    });

    it('records progress only for a participant', async () => {
      const id = await makeChallenge();
      const outsider = await call('POST', `/social/challenges/${id}/progress`, {
        token: tokenB,
        body: { date: DAY, value: 5000 },
      });
      expect(outsider.status).toBe(404);

      const mine = await call('POST', `/social/challenges/${id}/progress`, {
        token: tokenA,
        body: { date: DAY, value: 12000 },
      });
      expect(mine.status).toBe(201);
      expect((await json<{ progress: { is_completed: boolean } }>(mine)).progress.is_completed).toBe(
        true
      );
    });

    it('a leaderboard shows ONLY peers who granted the challenge metric', async () => {
      // The sharpest form of rule 1: joining the same challenge is a
      // relationship, and a relationship grants nothing.
      await buildFamily(tokenB, EMAIL_B);
      const id = await makeChallenge();
      await call('POST', `/social/challenges/${id}/join`, { token: tokenB });
      await call('POST', `/social/challenges/${id}/progress`, {
        token: tokenA,
        body: { date: DAY, value: 12000 },
      });
      await call('POST', `/social/challenges/${id}/progress`, {
        token: tokenB,
        body: { date: DAY, value: 3000 },
      });

      const before = await json<{
        leaderboard: Array<{ user_id: string; total: number }>;
        hidden_participants: number;
      }>(await call('GET', `/social/challenges/${id}/progress`, { token: tokenB }));
      expect(before.leaderboard.map((r) => r.user_id)).toEqual([UID_B]);
      expect(before.hidden_participants).toBe(1);

      await grant(tokenA, UID_B, 'family', ['activity']);
      const after = await json<{
        leaderboard: Array<{ user_id: string; total: number }>;
        hidden_participants: number;
      }>(await call('GET', `/social/challenges/${id}/progress`, { token: tokenB }));
      expect(after.leaderboard.map((r) => r.user_id).sort()).toEqual([UID_A, UID_B].sort());
      expect(after.leaderboard.find((r) => r.user_id === UID_A)!.total).toBe(12000);
      expect(after.hidden_participants).toBe(0);
    });

    it('a grant for a DIFFERENT metric does not unlock the leaderboard', async () => {
      await buildFamily(tokenB, EMAIL_B);
      const id = await makeChallenge({ metric: 'water', target_value: 2000 });
      await call('POST', `/social/challenges/${id}/join`, { token: tokenB });
      await call('POST', `/social/challenges/${id}/progress`, {
        token: tokenA,
        body: { date: DAY, value: 2500 },
      });
      await grant(tokenA, UID_B, 'family', ['weight']);

      const body = await json<{ leaderboard: Array<{ user_id: string }>; hidden_participants: number }>(
        await call('GET', `/social/challenges/${id}/progress`, { token: tokenB })
      );
      expect(body.leaderboard.map((r) => r.user_id)).toEqual([UID_B]);
      expect(body.hidden_participants).toBe(1);
    });

    it('leaving a challenge hides your numbers from a peer who still holds a grant', async () => {
      await buildFamily(tokenB, EMAIL_B);
      const id = await makeChallenge();
      await call('POST', `/social/challenges/${id}/join`, { token: tokenB });
      await call('POST', `/social/challenges/${id}/progress`, {
        token: tokenA,
        body: { date: DAY, value: 12000 },
      });
      await grant(tokenA, UID_B, 'family', ['activity']);
      await call('POST', `/social/challenges/${id}/leave`, { token: tokenA });

      const body = await json<{ leaderboard: Array<{ user_id: string }> }>(
        await call('GET', `/social/challenges/${id}/progress`, { token: tokenB })
      );
      expect(body.leaderboard.map((r) => r.user_id)).toEqual([UID_B]);
    });
  });

  /* ==================== 12. ROUTING / VALIDATION ==================== */

  describe('routing and validation', () => {
    it('the literal share paths win over /:ownerId/metrics', async () => {
      const scopes = await call('GET', '/social/shares/scopes', { token: tokenA });
      expect(scopes.status).toBe(200);
      expect(await json<{ shareable: string[] }>(scopes)).toHaveProperty('shareable');
      const received = await call('GET', '/social/shares/received', { token: tokenA });
      expect(received.status).toBe(200);
      expect(await json<{ grants: unknown[] }>(received)).toHaveProperty('grants');
    });

    it('400s a malformed date on the shared-metrics read', async () => {
      const res = await call('GET', `/social/shares/${UID_B}/metrics?date=01-06-2026`, {
        token: tokenA,
      });
      expect(res.status).toBe(400);
    });

    it('400s a non-email invite address', async () => {
      await call('POST', '/social/family', { token: tokenA, body: { name: 'Fam' } });
      const res = await call('POST', '/social/family/invite', {
        token: tokenA,
        body: { email: 'nope' },
      });
      expect(res.status).toBe(400);
    });

    it('400s inviting yourself (safe: the caller knows their own address)', async () => {
      await call('POST', '/social/family', { token: tokenA, body: { name: 'Fam' } });
      const res = await call('POST', '/social/family/invite', {
        token: tokenA,
        body: { email: EMAIL_A },
      });
      expect(res.status).toBe(400);
      expect((await json<ErrorBody>(res)).error.code).toBe('invalid_email');
    });

    it('400s an empty scope list', async () => {
      await buildFamily(tokenB, EMAIL_B);
      const res = await call('POST', '/social/shares', {
        token: tokenA,
        body: { viewer_id: UID_B, relationship_type: 'family', scopes: [] },
      });
      expect(res.status).toBe(400);
    });

    it('matches an invite address case-insensitively', async () => {
      await call('POST', '/social/family', { token: tokenA, body: { name: 'Fam' } });
      await call('POST', '/social/family/invite', {
        token: tokenA,
        body: { email: EMAIL_B.toUpperCase() },
      });
      const inbox = await json<{ received: unknown[] }>(
        await call('GET', '/social/family/invitations', { token: tokenB })
      );
      expect(inbox.received).toHaveLength(1);
    });

    it('leaves a stranger unable to leave a family they are not in', async () => {
      const res = await call('POST', '/social/family/leave', { token: tokenD });
      expect(res.status).toBe(400);
      expect((await json<ErrorBody>(res)).error.code).toBe('not_in_family');
    });

    it('answers an EMPTY member list for an account in no family, not null', async () => {
      // The screen maps over this. A null would crash the Family tab for the
      // exact accounts most likely to open it — the ones with no family yet.
      const res = await call('GET', '/social/family/members', { token: tokenD });
      expect(res.status).toBe(200);
      expect((await json<{ members: unknown[] }>(res)).members).toEqual([]);
    });

    it('404s a buddy id that is not the callers on every buddy verb', async () => {
      // accept / decline / remove each answer through the same envelope; a
      // wrong id on any of them must read as "no such request", never as a
      // confirmation that one exists.
      for (const [method, path] of [
        ['POST', '/social/buddies/hb_nope/accept'],
        ['POST', '/social/buddies/hb_nope/decline'],
        ['DELETE', '/social/buddies/hb_nope'],
      ] as const) {
        const res = await call(method, path, { token: tokenA });
        expect(res.status, `${method} ${path}`).toBe(404);
      }
    });

    it('404s joining or leaving a topic that does not exist', async () => {
      for (const path of [
        '/social/community/topics/ht_nope/join',
        '/social/community/topics/ht_nope/leave',
      ]) {
        expect((await call('POST', path, { token: tokenA })).status).toBe(404);
      }
    });

    it('honours ?limit on every social list', async () => {
      // Community rooms and challenges both grow without bound, and the topic
      // directory is the first thing the Social tab paints.
      for (const category of ['nutrition', 'fitness', 'recipes'] as const) {
        await call('POST', '/social/community/topics', {
          token: tokenA,
          body: { title: `Room ${category}`, category },
        });
      }
      const topics = await json<{ topics: unknown[] }>(
        await call('GET', '/social/community/topics?limit=2', { token: tokenA })
      );
      expect(topics.topics).toHaveLength(2);

      // …and the closed category vocabulary still 400s a typo rather than
      // answering an empty directory that reads as "there are no rooms".
      const typo = await call('GET', '/social/community/topics?category=nutriton', {
        token: tokenA,
      });
      expect(typo.status).toBe(400);

      const listed = await json<{ topics: Array<{ id: string }> }>(
        await call('GET', '/social/community/topics', { token: tokenA })
      );
      const topicId = listed.topics[0].id;
      await call('POST', `/social/community/topics/${topicId}/join`, { token: tokenA });
      for (const text of ['one', 'two', 'three']) {
        await call('POST', `/social/community/topics/${topicId}/messages`, {
          token: tokenA,
          body: { content: text },
        });
      }
      const messages = await json<{ messages: unknown[] }>(
        await call('GET', `/social/community/topics/${topicId}/messages?limit=2`, {
          token: tokenA,
        })
      );
      expect(messages.messages).toHaveLength(2);

      for (const name of ['Steps A', 'Steps B']) {
        const created = await call('POST', '/social/challenges', {
          token: tokenA,
          body: {
            name,
            metric: 'activity',
            target_value: 10000,
            visibility: 'public',
            start_date: DAY,
          },
        });
        expect(created.status).toBe(201);
      }
      const challenges = await json<{ challenges: unknown[] }>(
        await call('GET', '/social/challenges?limit=1', { token: tokenA })
      );
      expect(challenges.challenges).toHaveLength(1);
    });

    /**
     * Every `zValidator` route, swept with the three bodies a broken or hostile
     * client actually sends: nothing at all, an empty object, and something that
     * is not JSON. All three must be 400 — a 500 here would be an unauthenticated
     * -adjacent crash on a surface whose whole point is that it stays quiet, and
     * a 2xx would mean a required field is not actually required.
     */
    const VALIDATED_POSTS: ReadonlyArray<readonly [string, string]> = [
      ['POST', '/social/family'],
      ['POST', '/social/family/invite'],
      ['POST', '/social/buddies/request'],
      ['POST', '/social/community/topics'],
      ['POST', '/social/community/topics/htop_x/messages'],
      ['POST', '/social/challenges'],
      ['POST', '/social/challenges/hchl_x/progress'],
      ['POST', '/social/shares'],
    ];

    it.each(VALIDATED_POSTS)('%s 400s an absent body and an empty object', async (method, path) => {
      expect((await call(method, path, { token: tokenA })).status, `${path} (no body)`).toBe(400);
      expect((await call(method, path, { token: tokenA, body: {} })).status, `${path} ({})`).toBe(
        400
      );
    });

    it.each(VALIDATED_POSTS)('%s 400s a body that is not JSON', async (method, path) => {
      const res = await mkApp().request(
        `/health${path}`,
        {
          method,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
          body: 'not json at all',
        },
        HEALTH_ENV
      );
      expect(res.status, path).toBe(400);
    });

    it('refuses every over-length field rather than truncating it', async () => {
      // Truncation would be worse than refusal here: a family called
      // "…" + 400 chars silently becoming something else is a data bug, and an
      // unbounded string is a storage-cost vector on a surface with no quota.
      await buildFamily(tokenB, EMAIL_B);
      const long = (n: number) => 'x'.repeat(n);
      const cases: ReadonlyArray<readonly [string, string, unknown]> = [
        ['family name', '/social/family', { name: long(81) }],
        ['invite message', '/social/family/invite', { email: EMAIL_C, message: long(501) }],
        ['buddy message', '/social/buddies/request', { email: EMAIL_C, message: long(501) }],
        ['topic title', '/social/community/topics', { title: long(121), category: 'tips' }],
        [
          'topic description',
          '/social/community/topics',
          { title: 'T', category: 'tips', description: long(501) },
        ],
        [
          'challenge name',
          '/social/challenges',
          { name: long(121), metric: 'activity', target_value: 10, start_date: DAY },
        ],
        [
          'viewer id',
          '/social/shares',
          { viewer_id: long(81), relationship_type: 'family', scopes: ['weight'] },
        ],
        [
          'scope list length',
          '/social/shares',
          {
            viewer_id: UID_B,
            relationship_type: 'family',
            // The cap is SHAREABLE_SCOPES.length + 8; anything past it is a
            // client that is looping, not a person choosing what to share.
            scopes: Array.from({ length: 15 }, (_, i) => `scope_${i}`),
          },
        ],
      ];
      for (const [label, path, body] of cases) {
        expect((await call('POST', path, { token: tokenA, body })).status, label).toBe(400);
      }
    });

    it('refuses out-of-range numbers on challenges and progress', async () => {
      const bad: ReadonlyArray<readonly [string, string, unknown]> = [
        [
          'zero target',
          '/social/challenges',
          { name: 'C', metric: 'activity', target_value: 0, start_date: DAY },
        ],
        [
          'negative target',
          '/social/challenges',
          { name: 'C', metric: 'activity', target_value: -5, start_date: DAY },
        ],
        [
          'absurd target',
          '/social/challenges',
          { name: 'C', metric: 'activity', target_value: 1_000_001, start_date: DAY },
        ],
        [
          'bad start date',
          '/social/challenges',
          { name: 'C', metric: 'activity', target_value: 10, start_date: '01/06/2026' },
        ],
        [
          'unknown frequency',
          '/social/challenges',
          {
            name: 'C',
            metric: 'activity',
            target_value: 10,
            start_date: DAY,
            frequency: 'hourly',
          },
        ],
        [
          'unknown visibility',
          '/social/challenges',
          {
            name: 'C',
            metric: 'activity',
            target_value: 10,
            start_date: DAY,
            visibility: 'everyone',
          },
        ],
        [
          'unknown topic category',
          '/social/community/topics',
          { title: 'T', category: 'gossip' },
        ],
      ];
      for (const [label, path, body] of bad) {
        expect((await call('POST', path, { token: tokenA, body })).status, label).toBe(400);
      }

      const id = await (async () => {
        const res = await call('POST', '/social/challenges', {
          token: tokenA,
          body: {
            name: 'C',
            metric: 'activity',
            target_value: 10,
            visibility: 'public',
            start_date: DAY,
          },
        });
        expect(res.status).toBe(201);
        return (await json<{ challenge: { id: string } }>(res)).challenge.id;
      })();
      for (const [label, body] of [
        ['negative value', { date: DAY, value: -1 }],
        ['absurd value', { date: DAY, value: 1_000_001 }],
        ['bad date', { date: 'yesterday', value: 5 }],
      ] as const) {
        expect(
          (await call('POST', `/social/challenges/${id}/progress`, { token: tokenA, body })).status,
          label
        ).toBe(400);
      }
    });

    it('refuses a relationship type outside the two that exist', async () => {
      // `family` and `buddy` are the only two cascades that exist. A third
      // value would create a grant nothing can ever revoke.
      await buildFamily(tokenB, EMAIL_B);
      for (const relationship_type of ['friend', 'FAMILY', '', 'household']) {
        const res = await call('POST', '/social/shares', {
          token: tokenA,
          body: { viewer_id: UID_B, relationship_type, scopes: ['weight'] },
        });
        expect(res.status, relationship_type || '(empty)').toBe(400);
      }
      expect(
        (await json<{ grants: Grant[] }>(await call('GET', '/social/shares', { token: tokenA })))
          .grants
      ).toEqual([]);
    });

    it('defaults the shared-metrics day to today when none is given', async () => {
      // The one path with a wall-clock default. A caller that omits `date` must
      // get an answer, not a 400 about a parameter it never sent.
      const res = await call('GET', `/social/shares/${UID_B}/metrics`, { token: tokenA });
      // No grant exists, so 404 — but it reached the handler rather than the
      // date guard, which is what this pins.
      expect(res.status).toBe(404);
      expect((await json<ErrorBody>(res)).error.code).toBe('not_found');
    });
  });
});
