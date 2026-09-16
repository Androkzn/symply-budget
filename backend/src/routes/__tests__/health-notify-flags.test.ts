/**
 * Symply Health — the ten `notify_*` / `receive_*` activity-notification flags
 * on `PUT|GET /health/activity-preferences`
 * (`src/routes/health-body-extras.ts` :154-183).
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `health-body-extras.test.ts`
 * ----------------------------------------------------------------
 * Notifications are a **backend-only** area of Symply Health today. The Worker
 * ships a complete, deployed preference surface; the RN app has **no caller for
 * it at all** — no settings screen, no permission prompt, no scheduler — and
 * nothing on the Worker READS these flags back (no cron, no producer; grep
 * `getActivityPreferences` and the only two hits are the route itself). So the
 * flags are, today, a persisted contract with no consumer on either side.
 *
 * That makes them a classic silent-drift surface: nobody notices a regression
 * because nobody calls it, right up until the settings screen lands and ships an
 * opt-out that does not stick. This suite therefore covers the flag contract far
 * harder than a "some field round-trips" smoke test would:
 *
 *   - the RESPONSE SHAPE a future client will decode — the exact key set, all
 *     ten flags always present, always booleans, never SQLite 0/1;
 *   - EVERY flag individually, because a partial-merge bug that drops one field
 *     is invisible when only one field is ever exercised;
 *   - the ALL-ON / ALL-OFF sweeps, which is what a "turn everything off" button
 *     sends and the one write a privacy-sensitive user actually cares about;
 *   - the WRONG-TYPE matrix per flag, since `0`/`1` is exactly what a client
 *     that mirrors the SQLite column would send, and a coerced `0` would read
 *     back as an opt-IN;
 *   - unauthenticated + cross-user, because `user_id` IS the primary key here,
 *     so a missing filter overwrites a stranger's row rather than inserting.
 *
 * `health-body-extras.test.ts` owns the same router's injuries + body-insights
 * and a handful of preference cases; this file is deliberately runnable on its
 * own (`npx vitest run src/routes/__tests__/health-notify-flags.test.ts`) so the
 * notifications area can be verified in isolation.
 *
 * The FE side of the posture — "no RN caller exists, and Health imports no local
 * notification scheduler" — is guarded in
 * `src/features/health/__tests__/areas/notifications.posture.test.ts`.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  ACTIVITY_PREFERENCE_DEFAULTS,
  ACTIVITY_PREFERENCE_FIELDS,
} from '../../services/health-body-extras-service';
import type { Env } from '../../types';
import healthBodyExtrasRoutes from '../health-body-extras';

import {
  createBodyExtrasTables,
  createHealthTables,
  resetBodyExtrasTables,
  resetHealthTables,
  seedHealthUsers,
} from './health-test-helpers';

const testEnv = env as unknown as Env;

// The pool env is House (wrangler.toml); each brand gets its own copy so one
// request can be replayed across the fleet against the same router.
const HEALTH_ENV = { ...testEnv, APP_BRAND: 'symply-health' } as Env;
const HOUSE_ENV = { ...testEnv, APP_BRAND: 'symply-house' } as Env;
const BUDGET_ENV = { ...testEnv, APP_BRAND: 'symply-budget' } as Env;
const KAIZEN_ENV = { ...testEnv, APP_BRAND: 'symply-kaizen' } as Env;

const UID_A = 'u_notify_alice';
const UID_B = 'u_notify_bob';

const PATH = '/activity-preferences';
const TABLE = 'activity_notification_preferences';

/**
 * The full envelope a client decodes: the ten flags plus these four.
 * `favourite_workout_types` is out of THIS suite's scope (it is not a
 * notification flag — see `health-activity-preferences.test.ts` for its own
 * coverage) but it lives on the same envelope, so it has to be named here too
 * or the exact-key-set assertion below would drift.
 */
const ENVELOPE_KEYS = ['user_id', 'created_at', 'updated_at', 'favourite_workout_types'] as const;

type Flag = (typeof ACTIVITY_PREFERENCE_FIELDS)[number];
type Prefs = Record<string, unknown>;

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
  opts: {
    token?: string | null;
    body?: unknown;
    /** Pre-serialised body — for the malformed / non-object payload cases. */
    rawBody?: string;
    brandEnv?: Env;
  } = {}
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

async function getPrefs(token = tokenA): Promise<Prefs> {
  const res = await call('GET', { token });
  expect(res.status).toBe(200);
  return ((await res.json()) as { preferences: Prefs }).preferences;
}

async function putPrefs(body: unknown, token = tokenA): Promise<Prefs> {
  const res = await call('PUT', { token, body });
  expect(res.status, JSON.stringify(body)).toBe(200);
  return ((await res.json()) as { preferences: Prefs }).preferences;
}

/** The row AS STORED — booleans are a service-layer contract, not a DB one. */
async function storedRow(userId: string): Promise<Record<string, unknown> | null> {
  return testEnv.DB.prepare(`SELECT * FROM ${TABLE} WHERE user_id = ?`)
    .bind(userId)
    .first<Record<string, unknown>>();
}

async function rowCount(): Promise<number> {
  const row = await testEnv.DB.prepare(`SELECT COUNT(*) AS n FROM ${TABLE}`).first<{
    n: number;
  }>();
  return row?.n ?? 0;
}

function allFlags(value: boolean): Record<Flag, boolean> {
  return Object.fromEntries(ACTIVITY_PREFERENCE_FIELDS.map((f) => [f, value])) as Record<
    Flag,
    boolean
  >;
}

/** The value a flag must NOT be if it is to count as changed. */
function flip(field: Flag): boolean {
  return !ACTIVITY_PREFERENCE_DEFAULTS[field];
}

describe('health activity notification flags (/health/activity-preferences)', () => {
  beforeEach(async () => {
    await createHealthTables(testEnv.DB);
    await createBodyExtrasTables(testEnv.DB);
    await resetBodyExtrasTables(testEnv.DB);
    await resetHealthTables(testEnv.DB);
    await seedHealthUsers(testEnv.DB, [UID_A, UID_B]);
    tokenA = await mintToken(UID_A);
    tokenB = await mintToken(UID_B);
  });

  /* ============ 1. THE SHAPE A (FUTURE) CLIENT WILL DECODE ============ */

  describe('response shape', () => {
    it('GET answers with exactly the ten flags plus user_id and the two stamps', async () => {
      // Pinned as an EXACT key set, not a superset: the settings screen that
      // eventually lands will render one row per flag, so an extra column
      // leaking out here (an `id`, an internal counter) becomes a stray toggle.
      const preferences = await getPrefs();
      expect(Object.keys(preferences).sort()).toEqual(
        [...ACTIVITY_PREFERENCE_FIELDS, ...ENVELOPE_KEYS].sort()
      );
    });

    it('PUT echoes the same envelope as GET — one decoder for both', async () => {
      const written = await putPrefs({ notify_photo_shared: false });
      const read = await getPrefs();
      expect(Object.keys(written).sort()).toEqual(Object.keys(read).sort());
      expect(written).toEqual(read);
    });

    it('every flag is a JS boolean on an unsaved account AND on a saved one', async () => {
      // A `0` read as truthy on the client is exactly how an opt-OUT silently
      // becomes an opt-IN, and the unsaved path builds its object by hand.
      const unsaved = await getPrefs();
      const saved = await putPrefs(allFlags(false));
      for (const field of ACTIVITY_PREFERENCE_FIELDS) {
        expect(typeof unsaved[field], `unsaved ${field}`).toBe('boolean');
        expect(typeof saved[field], `saved ${field}`).toBe('boolean');
      }
    });

    it('carries the caller user_id and null stamps until something is saved', async () => {
      const preferences = await getPrefs();
      expect(preferences.user_id).toBe(UID_A);
      expect(preferences.created_at).toBeNull();
      expect(preferences.updated_at).toBeNull();
    });
  });

  /* ==================== 2. DEFAULTS ON A FRESH ROW ==================== */

  describe('defaults', () => {
    it('reads the donor defaults with no row in the table', async () => {
      expect(await rowCount()).toBe(0);
      const preferences = await getPrefs();
      for (const field of ACTIVITY_PREFERENCE_FIELDS) {
        expect(preferences[field], field).toBe(ACTIVITY_PREFERENCE_DEFAULTS[field]);
      }
    });

    it('a READ never materialises a row — only a write does', async () => {
      // The defaults are synthesised, not upserted. If a read wrote, `created_at`
      // would start ticking for a user who never opened a settings screen, and
      // "has this member ever chosen?" would stop being answerable.
      await getPrefs();
      await getPrefs(tokenB);
      expect(await rowCount()).toBe(0);
    });

    it('exactly three flags are opt-IN by default, and they are the named three', async () => {
      // Community traffic is generated by STRANGERS rather than by the member's
      // own activity, so it defaults OFF; `notify_recipe_updated` is off because
      // an edit to your own recipe is not news. Anything else defaulting to OFF
      // is a product decision that must be made deliberately, not by a typo.
      const preferences = await getPrefs();
      const off = ACTIVITY_PREFERENCE_FIELDS.filter((f) => preferences[f] === false);
      expect(off.sort()).toEqual(
        ['notify_community_achievement', 'notify_community_recipe_created', 'notify_recipe_updated'].sort()
      );
    });

    it('both delivery-channel switches default ON', async () => {
      // These are the master switches: push and in-app. A member who has never
      // touched the (unbuilt) settings screen is opted in to delivery, and the
      // per-event flags decide WHAT gets delivered.
      const preferences = await getPrefs();
      expect(preferences.receive_push_notifications).toBe(true);
      expect(preferences.receive_inapp_notifications).toBe(true);
    });
  });

  /* =================== 3. MUTATION — EVERY FLAG ====================== */

  describe('mutation', () => {
    it.each(ACTIVITY_PREFERENCE_FIELDS)(
      'round-trips %s away from its default without touching the other nine',
      async (field) => {
        // Driven per FIELD rather than on a sample: a partial-merge bug that
        // drops one column is invisible when only one column is ever written.
        const written = await putPrefs({ [field]: flip(field) });
        expect(written[field], field).toBe(flip(field));

        const others = ACTIVITY_PREFERENCE_FIELDS.filter((f) => f !== field);
        const moved = others.filter((f) => written[f] !== ACTIVITY_PREFERENCE_DEFAULTS[f]);
        expect(moved).toEqual([]);

        // …and the read path agrees with what the write claimed.
        expect(await getPrefs()).toEqual(written);
      }
    );

    it('turns everything OFF in one write', async () => {
      // The "mute everything" button. Ten booleans in one body is also the
      // largest payload this route ever receives.
      const written = await putPrefs(allFlags(false));
      const stillOn = ACTIVITY_PREFERENCE_FIELDS.filter((f) => written[f] !== false);
      expect(stillOn).toEqual([]);
      expect(await getPrefs()).toEqual(written);
    });

    it('turns everything ON in one write', async () => {
      const written = await putPrefs(allFlags(true));
      const stillOff = ACTIVITY_PREFERENCE_FIELDS.filter((f) => written[f] !== true);
      expect(stillOff).toEqual([]);
    });

    it('all-off then all-on leaves nothing sticky', async () => {
      // Guards the upsert's SET list: a field present on INSERT but missing
      // from `onConflictDoUpdate` would be writable exactly once.
      await putPrefs(allFlags(false));
      const back = await putPrefs(allFlags(true));
      const stuck = ACTIVITY_PREFERENCE_FIELDS.filter((f) => back[f] !== true);
      expect(stuck).toEqual([]);
    });

    it.each(ACTIVITY_PREFERENCE_FIELDS)(
      'a single-flag write on top of an all-off row moves only %s',
      async (field) => {
        // The partial-update contract measured from a NON-default baseline —
        // starting from defaults hides a bug where the upsert re-applies
        // `ACTIVITY_PREFERENCE_DEFAULTS` to the columns the caller omitted.
        await putPrefs(allFlags(false));
        const written = await putPrefs({ [field]: true });
        expect(written[field], field).toBe(true);
        const others = ACTIVITY_PREFERENCE_FIELDS.filter((f) => f !== field);
        expect(others.filter((f) => written[f] !== false)).toEqual([]);
      }
    );

    it('an EMPTY body on an existing row is a no-op, not a reset to defaults', async () => {
      // Asymmetry worth pinning: on a fresh account `PUT {}` INSERTS the
      // defaults, but on a saved account it must only touch `updated_at`.
      // Drizzle cannot build an UPDATE with no SET columns, so the route always
      // has at least `updated_at` — the risk is it "helpfully" re-sends the
      // default set and silently un-mutes a member who muted everything.
      await putPrefs(allFlags(false));
      const after = await putPrefs({});
      const unmuted = ACTIVITY_PREFERENCE_FIELDS.filter((f) => after[f] !== false);
      expect(unmuted).toEqual([]);
    });

    it('an empty body on a FRESH account materialises the defaults', async () => {
      const written = await putPrefs({});
      for (const field of ACTIVITY_PREFERENCE_FIELDS) {
        expect(written[field], field).toBe(ACTIVITY_PREFERENCE_DEFAULTS[field]);
      }
      expect(written.updated_at).toEqual(expect.any(String));
      expect(await rowCount()).toBe(1);
    });

    it('keeps created_at fixed and never moves updated_at backwards', async () => {
      const first = await putPrefs({ notify_photo_shared: false });
      const second = await putPrefs({ notify_milestone_achieved: false });
      expect(second.created_at).toBe(first.created_at);
      expect(String(second.updated_at) >= String(first.updated_at)).toBe(true);
      expect(String(second.updated_at) >= String(second.created_at)).toBe(true);
    });

    it('repeating the identical write is idempotent on the values', async () => {
      const body = { notify_recipe_created: false, receive_push_notifications: false };
      const first = await putPrefs(body);
      const second = await putPrefs(body);
      for (const field of ACTIVITY_PREFERENCE_FIELDS) {
        expect(second[field], field).toBe(first[field]);
      }
      expect(await rowCount()).toBe(1);
    });

    it('stores one row per user as INTEGER 0/1 — the boolean is a service contract', async () => {
      // Asserts what ACTUALLY landed in D1 rather than what the route echoed:
      // the `!!` in `getActivityPreferences` is the only thing between the
      // column and the client, so both halves are pinned.
      await putPrefs({ notify_photo_shared: false, notify_community_achievement: true });
      const row = await storedRow(UID_A);
      expect(row).not.toBeNull();
      expect(row?.notify_photo_shared).toBe(0);
      expect(row?.notify_community_achievement).toBe(1);
      // Untouched columns keep the DDL/default value, also as 0/1.
      expect(row?.notify_recipe_created).toBe(1);
      expect(row?.notify_recipe_updated).toBe(0);
      expect(await rowCount()).toBe(1);
    });

    it('the master push switch does not cascade onto the eight event flags', async () => {
      // Muting DELIVERY and un-checking every EVENT are different intents. If
      // the master switch rewrote the event flags, re-enabling push would come
      // back with everything silently off.
      const written = await putPrefs({ receive_push_notifications: false });
      expect(written.receive_push_notifications).toBe(false);
      expect(written.receive_inapp_notifications).toBe(true);
      const events = ACTIVITY_PREFERENCE_FIELDS.filter((f) => f.startsWith('notify_'));
      const moved = events.filter((f) => written[f] !== ACTIVITY_PREFERENCE_DEFAULTS[f]);
      expect(moved).toEqual([]);
    });
  });

  /* ======================== 4. VALIDATION ============================ */

  describe('validation', () => {
    /**
     * `0` / `1` is what a client mirroring the SQLite column sends, and
     * `'true'` is what a naive form/query serialisation sends. Both must be
     * REFUSED rather than coerced: a coerced `0` on an opt-out flag is an
     * opt-IN, and the member would have no way to tell.
     */
    const BAD_VALUES: ReadonlyArray<readonly [string, unknown]> = [
      ['string "true"', 'true'],
      ['string "false"', 'false'],
      ['number 1', 1],
      ['number 0', 0],
      ['null', null],
      ['array', []],
      ['object', {}],
    ];

    it.each(ACTIVITY_PREFERENCE_FIELDS)('400s a non-boolean %s', async (field) => {
      for (const [label, value] of BAD_VALUES) {
        const res = await call('PUT', { body: { [field]: value } });
        expect(res.status, `${field} = ${label}`).toBe(400);
      }
    });

    it('a rejected write leaves the stored row byte-identical', async () => {
      await putPrefs(allFlags(false));
      const before = await storedRow(UID_A);

      const res = await call('PUT', {
        body: { notify_photo_shared: 1, notify_recipe_created: true },
      });
      expect(res.status).toBe(400);

      // The VALID half of a mixed body must not be applied either — zod rejects
      // the whole object, so this is all-or-nothing.
      const after = await storedRow(UID_A);
      expect(after).toEqual(before);
    });

    it('a rejected write on a FRESH account writes no row at all', async () => {
      const res = await call('PUT', { body: { receive_push_notifications: 'off' } });
      expect(res.status).toBe(400);
      expect(await rowCount()).toBe(0);
    });

    it('rejects a body that is not an object', async () => {
      for (const raw of ['[]', '"nope"', '42', 'null', 'true']) {
        const res = await call('PUT', { rawBody: raw });
        expect(res.status, raw).toBe(400);
      }
    });

    it('rejects malformed JSON with a 400, never a 500', async () => {
      // A truncated body is what a dropped connection mid-upload looks like.
      const res = await call('PUT', { rawBody: '{"notify_photo_shared":' });
      expect(res.status).toBe(400);
    });

    it('ignores a near-miss typo key and leaves the real flag alone', async () => {
      // `notify_recipe_create` (no trailing `d`) is the realistic client bug.
      // It must not be stored, must not 400 the whole write, and must not be
      // mistaken for the real column.
      const written = await putPrefs({
        notify_recipe_create: false,
        notify_photo_shared: false,
      });
      expect(written.notify_recipe_create).toBeUndefined();
      expect(written.notify_recipe_created).toBe(true);
      expect(written.notify_photo_shared).toBe(false);

      const row = await storedRow(UID_A);
      expect(Object.keys(row ?? {})).not.toContain('notify_recipe_create');
    });

    it('accepts every field the service declares — the two layers cannot drift', async () => {
      // Cross-layer: the zod schema in the route and
      // ACTIVITY_PREFERENCE_FIELDS in the service are written out separately.
      // An eleventh flag added to one and not the other would be silently
      // undeliverable; this drives all of them through the route in one body.
      const written = await putPrefs(allFlags(false));
      const missing = ACTIVITY_PREFERENCE_FIELDS.filter((f) => written[f] !== false);
      expect(missing).toEqual([]);
    });
  });

  /* ================= 5. AUTH, BRAND GATE, CROSS-USER ================= */

  describe('access control', () => {
    it('401s both verbs without a bearer token', async () => {
      expect((await call('GET', { token: null })).status).toBe(401);
      expect((await call('PUT', { token: null, body: allFlags(false) })).status).toBe(401);
      expect(await rowCount()).toBe(0);
    });

    it('401s a token signed with the wrong secret', async () => {
      const forged = await mintToken(UID_A, 'an-attacker-secret-32-chars-minimum');
      expect((await call('GET', { token: forged })).status).toBe(401);
      expect((await call('PUT', { token: forged, body: allFlags(false) })).status).toBe(401);
    });

    it.each([
      ['symply-house', HOUSE_ENV],
      ['symply-budget', BUDGET_ENV],
      ['symply-kaizen', KAIZEN_ENV],
    ])('404s the preference surface on %s', async (_brand, brandEnv) => {
      for (const method of ['GET', 'PUT']) {
        const res = await call(method, {
          token: tokenA,
          body: method === 'PUT' ? { notify_photo_shared: false } : undefined,
          brandEnv,
        });
        expect(res.status, `${method} on ${_brand}`).toBe(404);
      }
      expect(await rowCount()).toBe(0);
    });

    it('the brand gate fires BEFORE auth — a tokenless wrong-brand call 404s', async () => {
      // A 401 would confirm the surface exists on that brand.
      const res = await call('GET', { token: null, brandEnv: BUDGET_ENV });
      expect(res.status).toBe(404);
    });

    it('a cross-user write never touches the other account row', async () => {
      // `user_id` IS the primary key: the one place a missing filter overwrites
      // a stranger's row instead of inserting a new one.
      await putPrefs(allFlags(false), tokenA);
      await putPrefs(allFlags(true), tokenB);

      const a = await getPrefs(tokenA);
      const b = await getPrefs(tokenB);
      expect(ACTIVITY_PREFERENCE_FIELDS.filter((f) => a[f] !== false)).toEqual([]);
      expect(ACTIVITY_PREFERENCE_FIELDS.filter((f) => b[f] !== true)).toEqual([]);
      expect(a.user_id).toBe(UID_A);
      expect(b.user_id).toBe(UID_B);
      expect(await rowCount()).toBe(2);
    });

    it('B reads the DEFAULTS, not A saved row, when B has never saved', async () => {
      await putPrefs(allFlags(false), tokenA);
      const b = await getPrefs(tokenB);
      for (const field of ACTIVITY_PREFERENCE_FIELDS) {
        expect(b[field], field).toBe(ACTIVITY_PREFERENCE_DEFAULTS[field]);
      }
      expect(b.updated_at).toBeNull();
      expect(await rowCount()).toBe(1);
    });
  });
});
