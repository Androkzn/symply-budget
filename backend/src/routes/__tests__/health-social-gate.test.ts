/**
 * Symply Health SOCIAL — THE KILL SWITCH, to exhaustion.
 *
 * `routes/__tests__/health-social.test.ts` owns the domain behaviour of this
 * surface. This file owns ONE thing: the deny-by-default gate in front of it,
 * because that gate is the entire reason a 35-endpoint cross-user health-sharing
 * API can sit mounted in production without a privacy review having signed off.
 *
 * It is separated out for two reasons:
 *
 *  1. The sibling suite asserts the flag sweep with `status !== 404`, which is
 *     weaker than it looks: several paths (`…/invitations/hfi_x/accept`,
 *     `…/shares/hms_x`, `…/{ownerId}/metrics`) answer 404 from their HANDLER on
 *     a cold account too. If the gate stopped covering exactly those paths the
 *     sweep would still be green. Everything here asserts the GATE'S OWN
 *     envelope — `{"error":{"code":"not_found","message":"Not found"}}`, which
 *     no handler in the router can produce (they all answer `"<Thing> not
 *     found"`) — so a handler-shaped 404 can never stand in for a blocked one.
 *
 *  2. The gate is applied TWICE, and the second application is invisible to a
 *     standalone mount. `src/index.ts:237-238` registers `requireHealthSocialFlag()`
 *     on the app BEFORE any `/health` mount; `routes/health-social.ts:106`
 *     registers it again on the router. The sibling suite mounts the social
 *     router ALONE, so it cannot see the composed-app property that made the
 *     index-level registration necessary: `routes/health.ts` mounts first at the
 *     same `/health` prefix with `use('/*', authMiddleware())`, so without the
 *     index-level gate an unauthenticated probe of a DISABLED fleet gets 401 —
 *     which confirms the surface exists. That regression is reproduced here on
 *     purpose (`the 401 leak this gate exists to prevent`) so nobody deletes
 *     line 237 thinking the router-level copy is enough.
 *
 * Harness mirrors health-social.test.ts: `cloudflare:test` env, a jose HS256 JWT
 * whose `sub` becomes the user id, and local DDL from health-test-helpers.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import healthRoutes from '../health';
import healthSocialRoutes, {
  HEALTH_SOCIAL_FLAG_KEY,
  isHealthSocialEnabled,
  requireHealthSocialFlag,
} from '../health-social';

import {
  createHealthSocialTables,
  createHealthTables,
  resetHealthSocialTables,
  resetHealthTables,
  seedHealthUsers,
} from './health-test-helpers';

const testEnv = env as unknown as Env;
const HEALTH_ENV = { ...testEnv, APP_BRAND: 'symply-health' } as Env;

const FLAG = HEALTH_SOCIAL_FLAG_KEY;
const UID_A = 'u_gate_alice';
const UID_B = 'u_gate_bob';
const DAY = '2026-06-01';

/** The gate's own body, byte for byte. Nothing else in the router answers this. */
const GATE_BODY = { error: { code: 'not_found', message: 'Not found' } };

let tokenA = '';

async function mintToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(testEnv.JWT_SECRET ?? 'test-jwt-secret-32-chars-minimum');
  return new jose.SignJWT({ sub: userId, email: `${userId}@example.com`, email_verified: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .setIssuer(testEnv.JWT_ISSUER || 'simple-house')
    .setAudience(testEnv.JWT_AUDIENCE || 'simple-house-app')
    .sign(secret);
}

/**
 * Every path the router owns — 35 handlers over 29 distinct paths. The sweeps
 * run over ALL of them, never a sample: one unswept path is a live cross-user
 * health-sharing endpoint on a fleet nobody reviewed.
 */
const ROUTES: ReadonlyArray<readonly [string, string, unknown?]> = [
  ['GET', '/social/family'],
  ['POST', '/social/family', { name: 'Fam' }],
  ['GET', '/social/family/members'],
  ['POST', '/social/family/invite', { email: 'someone@example.com' }],
  ['GET', '/social/family/invitations'],
  ['GET', '/social/family/invitations/code/ABCD2345'],
  ['POST', '/social/family/invitations/hfi_x/accept'],
  ['POST', '/social/family/invitations/hfi_x/decline'],
  ['POST', '/social/family/leave'],
  ['DELETE', '/social/family/members/u_x'],
  ['GET', '/social/buddies'],
  ['GET', '/social/buddies/requests'],
  ['POST', '/social/buddies/request', { email: 'someone@example.com' }],
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
  ['POST', '/social/shares', { viewer_id: UID_B, relationship_type: 'family', scopes: ['weight'] }],
  ['DELETE', '/social/shares/hms_x'],
  ['GET', `/social/shares/${UID_B}/metrics?date=${DAY}`],
];

/**
 * The complete set of values that must NOT enable the surface.
 *
 * This is the INVERSE of the repo's usual kill-switch convention
 * (`routes/savings.ts`: absent = enabled, only `'false'` disables;
 * `services/config-flags.ts`: `'1'` and `'yes'` are truthy). Health sharing is
 * deny-by-default, so every one of these — a fresh environment with no key, a
 * `wrangler kv put` that captured a shell newline, a JSON-encoded value, a
 * case-typo — has to mean OFF.
 */
const NON_ENABLING: ReadonlyArray<readonly [string, string | null]> = [
  ['absent', null],
  ['empty string', ''],
  ['whitespace only', '   '],
  ['false', 'false'],
  ['FALSE', 'FALSE'],
  ['True', 'True'],
  ['TRUE', 'TRUE'],
  ['trUE', 'trUE'],
  ['1', '1'],
  ['0', '0'],
  ['yes', 'yes'],
  ['on', 'on'],
  ['enabled', 'enabled'],
  // `echo true | wrangler kv key put --path -` and friends: a trailing newline
  // is the single most likely way an operator "sets" this key and gets nothing.
  ['true with a trailing newline', 'true\n'],
  ['true with a leading space', ' true'],
  ['true with a trailing space', 'true '],
  ['true padded both sides', ' true '],
  // A JSON-encoded boolean/object, i.e. someone stored `JSON.stringify(...)` of
  // something that is not the bare string.
  ['JSON string "true"', '"true"'],
  ['JSON object', '{"health_social_enabled":true}'],
  ['JSON array', '["true"]'],
  ['true with a suffix', 'true;'],
  ['a prefix before true', 'x-true'],
  ['null literal', 'null'],
  ['undefined literal', 'undefined'],
];

function mkStandaloneApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/health', healthSocialRoutes);
  return app;
}

/**
 * The REAL wiring of `src/index.ts`, in registration order:
 *   1. the flag gate on `/health/social/*` and `/health/social`  (lines 237-238)
 *   2. `routes/health.ts`, whose `use('/*', authMiddleware())` becomes
 *      `use('/health/*', …)` and therefore also covers `/health/social/*`
 *   3. the social router itself, which re-applies brand → flag → auth
 *
 * `indexGate: false` builds the same app WITHOUT step 1 — i.e. the shape this
 * surface shipped with before the leak was found. Used to prove the regression
 * is real rather than theoretical.
 */
function mkComposedApp(opts: { indexGate?: boolean } = {}) {
  const app = new Hono<{ Bindings: Env }>();
  if (opts.indexGate !== false) {
    app.use('/health/social/*', requireHealthSocialFlag());
    app.use('/health/social', requireHealthSocialFlag());
  }
  app.route('/health', healthRoutes);
  app.route('/health', healthSocialRoutes);
  return app;
}

async function call(
  app: Hono<{ Bindings: Env }>,
  method: string,
  path: string,
  opts: { token?: string | null; body?: unknown; env?: Env } = {}
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = opts.token === undefined ? tokenA : opts.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  return app.request(
    `/health${path}`,
    { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) },
    opts.env ?? HEALTH_ENV
  );
}

/** status + parsed body + content-type — everything a prober could compare. */
async function fingerprint(res: Response): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status: res.status, contentType: res.headers.get('content-type'), body };
}

async function setFlag(value: string | null): Promise<void> {
  if (value === null) await testEnv.CONFIG_KV.delete(FLAG);
  else await testEnv.CONFIG_KV.put(FLAG, value);
}

/**
 * An env whose CONFIG_KV counts `get` calls, so "the gate consults KV on EVERY
 * request" and "both copies of the gate really run" become observable rather
 * than assumed. Delegates by hand: KV methods live on a prototype, so spreading
 * the binding would drop them.
 */
function countingEnv(base: Env): { env: Env; reads: () => number; reset: () => void } {
  let reads = 0;
  const real = base.CONFIG_KV;
  const kv = {
    get: (...args: unknown[]) => {
      reads += 1;
      return (real.get as (...a: unknown[]) => unknown)(...args);
    },
    getWithMetadata: (...args: unknown[]) =>
      (real.getWithMetadata as (...a: unknown[]) => unknown)(...args),
    put: (...args: unknown[]) => (real.put as (...a: unknown[]) => unknown)(...args),
    delete: (...args: unknown[]) => (real.delete as (...a: unknown[]) => unknown)(...args),
    list: (...args: unknown[]) => (real.list as (...a: unknown[]) => unknown)(...args),
  };
  return {
    env: { ...base, CONFIG_KV: kv as unknown as KVNamespace } as Env,
    reads: () => reads,
    reset: () => {
      reads = 0;
    },
  };
}

describe('health social kill switch', () => {
  beforeEach(async () => {
    await createHealthTables(testEnv.DB);
    await createHealthSocialTables(testEnv.DB);
    await resetHealthSocialTables(testEnv.DB);
    await resetHealthTables(testEnv.DB);
    await seedHealthUsers(testEnv.DB, [UID_A, UID_B]);
    tokenA = await mintToken(UID_A);
    await setFlag('true');
  });

  /* ============ 1. The predicate, with no HTTP at all ================ */

  describe('isHealthSocialEnabled', () => {
    it('answers true for exactly one value in the universe', () => {
      expect(isHealthSocialEnabled('true')).toBe(true);
      for (const [label, value] of NON_ENABLING) {
        expect(isHealthSocialEnabled(value), label).toBe(false);
      }
      // `undefined` is what a typed binding hands back when the key is missing.
      expect(isHealthSocialEnabled(undefined)).toBe(false);
      expect(isHealthSocialEnabled(null)).toBe(false);
    });

    it('is identity, not a truthiness helper — no trimming, no case folding', () => {
      // Pinned deliberately: the moment someone "helpfully" routes this through
      // `isTruthyKvFlag()` (which accepts '1' and 'yes') or adds a `.trim()`,
      // a half-finished rollout starts serving cross-user health data.
      const accepted = [
        'true',
        ...NON_ENABLING.map(([, v]) => v),
        'TrUe',
        '\ttrue',
        'true\r\n',
      ].filter((v): v is string => typeof v === 'string' && isHealthSocialEnabled(v));
      expect(accepted).toEqual(['true']);
    });

    it('names the KV key the operator runbook names', () => {
      // The enable/disable commands in the route header hard-code this string;
      // a rename that only lands in code silently un-gates every environment.
      expect(HEALTH_SOCIAL_FLAG_KEY).toBe('health_social_enabled');
    });
  });

  /* ============ 2. Every path, every non-enabling value ============== */

  describe('the standalone router', () => {
    it.each(NON_ENABLING)(
      'answers the GATE envelope on all 35 handlers when the flag is %s',
      async (_label, value) => {
        await setFlag(value);
        const app = mkStandaloneApp();
        const leaked: string[] = [];
        for (const [method, path, body] of ROUTES) {
          const res = await call(app, method, path, { body });
          const seen = await fingerprint(res);
          // Not `status !== 404`: three of these paths 404 from their handler on
          // a cold account, so only the gate's own envelope proves it was the
          // gate that answered.
          if (JSON.stringify(seen.body) !== JSON.stringify(GATE_BODY) || seen.status !== 404) {
            leaked.push(`${method} ${path} -> ${seen.status} ${JSON.stringify(seen.body)}`);
          }
        }
        expect(leaked).toEqual([]);
      }
    );

    it('lets all 35 handlers through for exactly the literal "true"', async () => {
      await setFlag('true');
      const app = mkStandaloneApp();
      const blocked: string[] = [];
      for (const [method, path, body] of ROUTES) {
        const res = await call(app, method, path, { body });
        const seen = await fingerprint(res);
        if (seen.status === 404 && JSON.stringify(seen.body) === JSON.stringify(GATE_BODY)) {
          blocked.push(`${method} ${path}`);
        }
      }
      expect(blocked).toEqual([]);
    });

    it('re-reads CONFIG_KV on every single request — deleting the key is instant', async () => {
      // There is no cache and there must never be one: "disable instantly by
      // deleting the key" is the documented incident response.
      const counting = countingEnv(HEALTH_ENV);
      const app = mkStandaloneApp();
      await setFlag('true');
      counting.reset();
      for (let i = 0; i < 3; i += 1) {
        expect((await call(app, 'GET', '/social/family', { env: counting.env })).status).toBe(200);
      }
      expect(counting.reads()).toBe(3);

      await setFlag(null);
      // The very next request, in the same isolate, is already blocked.
      const res = await call(app, 'GET', '/social/family', { env: counting.env });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(GATE_BODY);
      expect(counting.reads()).toBe(4);
    });
  });

  /* ============ 3. The gate fires BEFORE auth, on every path ========= */

  describe('no auth oracle', () => {
    it.each(ROUTES.map(([m, p, b]) => [`${m} ${p}`, m, p, b] as const))(
      'answers %s identically with and without a token while disabled',
      async (_label, method, path, body) => {
        // A 401 for an authenticated-but-wrong caller and a 404 for an
        // anonymous one would tell a prober the surface exists behind a flag.
        // Status, content-type AND body must match exactly.
        await setFlag(null);
        const app = mkStandaloneApp();
        const anonymous = await fingerprint(await call(app, method, path, { token: null, body }));
        const authenticated = await fingerprint(await call(app, method, path, { body }));
        const forged = await fingerprint(
          await call(app, method, path, { token: 'not-a-jwt', body })
        );
        expect(anonymous).toEqual({ status: 404, contentType: expect.any(String), body: GATE_BODY });
        expect(authenticated).toEqual(anonymous);
        expect(forged).toEqual(anonymous);
      }
    );

    it('a disabled social path is indistinguishable from a path that never existed', async () => {
      // The strongest form of the same property: `/health/social/family` on a
      // disabled fleet must look exactly like `/health/social/not-a-route`.
      await setFlag(null);
      const app = mkStandaloneApp();
      const real = await fingerprint(await call(app, 'GET', '/social/family', { token: null }));
      const imaginary = await fingerprint(
        await call(app, 'GET', '/social/there-is-no-such-thing', { token: null })
      );
      expect(real).toEqual(imaginary);
    });
  });

  /* ============ 4. The DOUBLE application, in the composed app ======= */

  describe('the composed app (mirrors src/index.ts registration order)', () => {
    it('404s a tokenless probe of a disabled surface — never 401', async () => {
      await setFlag(null);
      const app = mkComposedApp();
      for (const path of ['/social/family', '/social/shares/scopes', '/social/challenges']) {
        const res = await call(app, 'GET', path, { token: null });
        expect(res.status, path).toBe(404);
        expect(await res.json()).toEqual(GATE_BODY);
      }
    });

    it('reproduces the 401 leak this gate exists to prevent', async () => {
      /**
       * WITHOUT the index-level registration, `routes/health.ts` — mounted
       * first at the same `/health` prefix — runs `authMiddleware()` over
       * `/health/*` before the social router's own middleware chain is reached.
       * A tokenless probe of a DISABLED fleet then gets 401, which is a yes/no
       * answer to "does /health/social exist?".
       *
       * This spec asserts the BROKEN shape on purpose. If it ever starts
       * failing, Hono's mount semantics changed and the index-level gate may no
       * longer be load-bearing — re-derive before deleting anything.
       */
      await setFlag(null);
      const leaky = mkComposedApp({ indexGate: false });
      const res = await call(leaky, 'GET', '/social/family', { token: null });
      expect(res.status).toBe(401);

      // …and the fix, same request, same disabled flag.
      const guarded = mkComposedApp();
      expect((await call(guarded, 'GET', '/social/family', { token: null })).status).toBe(404);
    });

    it('gates the bare /health/social path too (index.ts line 238)', async () => {
      // `/health/social/*` does not match `/health/social`, so it is registered
      // separately. Without that second line the bare path falls through to
      // health.ts's auth and 401s for an anonymous caller.
      await setFlag(null);
      const leaky = mkComposedApp({ indexGate: false });
      expect((await call(leaky, 'GET', '/social', { token: null })).status).toBe(401);

      const guarded = mkComposedApp();
      const res = await call(guarded, 'GET', '/social', { token: null });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(GATE_BODY);
    });

    it('gates a trailing-slash path, which Hono treats as a different route', async () => {
      await setFlag(null);
      const res = await call(mkComposedApp(), 'GET', '/social/family/', { token: null });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(GATE_BODY);
    });

    it('the ROUTER copy catches what the index copy cannot — a cased path', async () => {
      // `app.use('/health/social/*')` is case-SENSITIVE, so `/health/Social/...`
      // slips past the index-level gate. The router-level copy at
      // health-social.ts:106 is registered as `use('/*')` on the whole `/health`
      // prefix and therefore still fires. This is what "defence in depth" buys
      // and why deleting either copy is wrong.
      await setFlag(null);
      // `.json()` succeeding is itself the assertion: Hono's own not-found
      // answers `text/plain`, so a parseable gate envelope proves a middleware
      // — not the router's fallthrough — produced this 404.
      const cased = await mkComposedApp().request(
        '/health/Social/family',
        { headers: { Authorization: `Bearer ${tokenA}` } },
        HEALTH_ENV
      );
      expect(cased.status).toBe(404);
      expect(await cased.json()).toEqual(GATE_BODY);
    });

    it('runs BOTH copies when enabled, and short-circuits at the first when not', async () => {
      /**
       * The behavioural proof that the gate really is applied twice: with the
       * flag ON the request passes the index copy and then the router copy, so
       * CONFIG_KV is read exactly twice. With it OFF the index copy answers and
       * the router copy never runs — one read. A single read in the enabled
       * case would mean one of the two registrations had quietly disappeared.
       */
      const counting = countingEnv(HEALTH_ENV);
      const app = mkComposedApp();

      await setFlag('true');
      counting.reset();
      expect((await call(app, 'GET', '/social/family', { env: counting.env })).status).toBe(200);
      expect(counting.reads()).toBe(2);

      await setFlag(null);
      counting.reset();
      expect((await call(app, 'GET', '/social/family', { env: counting.env })).status).toBe(404);
      expect(counting.reads()).toBe(1);
    });

    it('still 401s an anonymous caller once the flag is genuinely on', async () => {
      // The gate must not become a substitute for auth: enabled + no token is
      // 401, enabled + token is 200.
      await setFlag('true');
      const app = mkComposedApp();
      expect((await call(app, 'GET', '/social/family', { token: null })).status).toBe(401);
      expect((await call(app, 'GET', '/social/family')).status).toBe(200);
    });

    it('does not gate the sibling /health surfaces', async () => {
      // The gate is scoped to `/social`; flipping it must never take the P1
      // tracking routes down with it.
      await setFlag(null);
      const app = mkComposedApp();
      expect((await call(app, 'GET', '/weight/entries')).status).toBe(200);
      expect((await call(app, 'GET', '/social/family')).status).toBe(404);
    });
  });

  /* ============ 5. Live reads die the moment the flag flips ========== */

  describe('flipping the flag mid-flight', () => {
    it('cuts an established, granted read on the very next request', async () => {
      const app = mkStandaloneApp();
      const tokenB = await mintToken(UID_B);
      const post = (method: string, path: string, token: string, body?: unknown) =>
        call(app, method, path, { token, body });

      // A family, a real grant, and a successful read.
      expect((await post('POST', '/social/family', tokenA, { name: 'Fam' })).status).toBe(201);
      expect(
        (await post('POST', '/social/family/invite', tokenA, { email: `${UID_B}@example.com` }))
          .status
      ).toBe(201);
      const inbox = (await (
        await post('GET', '/social/family/invitations', tokenB)
      ).json()) as { received: Array<{ id: string }> };
      await post('POST', `/social/family/invitations/${inbox.received[0].id}/accept`, tokenB);
      expect(
        (
          await post('POST', '/social/shares', tokenA, {
            viewer_id: UID_B,
            relationship_type: 'family',
            scopes: ['weight'],
          })
        ).status
      ).toBe(201);
      const read = () =>
        post('GET', `/social/shares/${UID_A}/metrics?date=${DAY}`, tokenB);
      expect((await read()).status).toBe(200);

      // Every non-enabling value must sever it, not just 'false'.
      for (const [label, value] of NON_ENABLING) {
        await setFlag(value);
        const res = await read();
        expect(res.status, label).toBe(404);
        expect(await res.json(), label).toEqual(GATE_BODY);
        await setFlag('true');
        expect((await read()).status, `${label} (restored)`).toBe(200);
      }
    });
  });
});
