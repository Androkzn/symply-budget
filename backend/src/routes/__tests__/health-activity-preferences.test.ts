/**
 * `GET|PUT /health/activity-preferences` — the ROUTE contract, from the More
 * tab's point of view.
 *
 * This is the only preference surface the Health Worker has, and it sits behind
 * the app's only settings screen (`HealthMoreScreen`). `health-body-extras.test.ts`
 * owns the ten notification FLAGS themselves — their donor defaults, the partial
 * upsert, cross-user scoping, the brand gate and the auth sweep. Nothing is
 * repeated here.
 *
 * What this file owns is everything ABOUT the surface rather than about the
 * flags, and it exists because of one question the More tab raises:
 *
 *   The unit picker on More writes `health.prefs.v1` on the handset and sends
 *   NOTHING to the Worker (see
 *   `src/features/health/__tests__/areas/more.units-propagation.test.ts`). Is
 *   that a gap, or the design?
 *
 * It is the design, and this file is what makes that checkable: the route's
 * field set is EXACTLY ten notification booleans. There is no server-side unit,
 * locale, theme or layout column for the device-local preference to disagree
 * with, so two handsets on one account can legitimately display different units
 * — and a future field added here would show up as a failure in
 * `HEALTH-MORE-084` rather than as a silent second source of truth.
 *
 * The rest is the surface's own invariants: the verbs that exist, that a READ
 * never writes, that a REJECTED write leaves nothing behind, that a repeat write
 * is idempotent, and that the row is keyed off the TOKEN and never off the body.
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
const HEALTH_ENV = { ...testEnv, APP_BRAND: 'symply-health' } as Env;

const UID = 'u_prefs_owner';
const OTHER_UID = 'u_prefs_other';

const PREFS_TABLE = 'activity_notification_preferences';

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

/** Mirrors the `app.route('/health', healthBodyExtrasRoutes)` mount in src/index.ts. */
function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/health', healthBodyExtrasRoutes);
  return app;
}

let token = '';

async function call(
  method: string,
  path: string,
  opts: { token?: string | null; body?: unknown } = {}
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const bearer = opts.token === undefined ? token : opts.token;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  return mkApp().request(
    `/health${path}`,
    { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) },
    HEALTH_ENV
  );
}

interface PreferencesEnvelope {
  preferences: Record<string, unknown>;
}

async function prefs(res: Response): Promise<Record<string, unknown>> {
  return ((await res.json()) as PreferencesEnvelope).preferences;
}

/**
 * Every stored preference row.
 *
 * Deliberately NOT `listHealthRows` from the shared helper: that orders by
 * `id`, and this is the one health table with no `id` column — `user_id` IS the
 * primary key, which is exactly the property several cases below assert.
 */
async function storedRows(): Promise<Record<string, unknown>[]> {
  const res = await testEnv.DB.prepare(
    `SELECT * FROM ${PREFS_TABLE} ORDER BY user_id`
  ).all<Record<string, unknown>>();
  return res.results ?? [];
}

beforeEach(async () => {
  await createHealthTables(testEnv.DB);
  await createBodyExtrasTables(testEnv.DB);
  await resetBodyExtrasTables(testEnv.DB);
  await resetHealthTables(testEnv.DB);
  await seedHealthUsers(testEnv.DB, [UID, OTHER_UID]);
  token = await mintToken(UID);
});

/* ==================================================================== *
 * 1. The field set — why the More tab's unit is device-local.
 * ==================================================================== */

describe('HEALTH-MORE-084 — the preference surface holds notification flags ONLY', () => {
  it('exposes exactly ten boolean flags and nothing that could shadow a device preference', async () => {
    const body = await prefs(await call('GET', '/activity-preferences'));

    // The whole field set, named. A new column added to this table (a unit, a
    // locale, a "start week on Monday") would land in this response and be an
    // instant second source of truth for something a screen already decides
    // locally — which is the failure this assertion exists to catch.
    // `favourite_workout_types` is the one deliberate exception: it is a real
    // curated LIST synced across the member's devices (donor
    // `FavouriteWorkoutTypesManager`), not a device-local display preference,
    // so it belongs on this surface alongside the ten flags.
    expect(ACTIVITY_PREFERENCE_FIELDS).toHaveLength(10);
    expect(Object.keys(body).sort()).toEqual(
      [
        'user_id',
        'created_at',
        'updated_at',
        'favourite_workout_types',
        ...ACTIVITY_PREFERENCE_FIELDS,
      ].sort()
    );

    // Every one of them is about being NOTIFIED. None is a display preference.
    for (const field of ACTIVITY_PREFERENCE_FIELDS) {
      expect(field, field).toMatch(/^(notify|receive)_/);
      expect(typeof body[field], field).toBe('boolean');
    }
  });

  it('has no unit / locale / display column for the device preference to fight with', async () => {
    // The More tab's weight unit is written to `health.prefs.v1` on the handset
    // and never sent anywhere. That is only safe while the server has no
    // opinion about it — the moment a `weight_unit` column appears here, two
    // handsets on one account start disagreeing and neither is wrong.
    // Whole segments only — `notify_comm(unit)y_recipe_created` is not a unit
    // preference, and a substring match would call it one.
    const forbidden = /(^|_)(unit|units|weight|locale|language|theme|layout|timezone|tz)(_|$)/i;
    expect(ACTIVITY_PREFERENCE_FIELDS.filter((f) => forbidden.test(f))).toEqual([]);
  });

  it('drops an unknown preference key instead of storing it as a new column', async () => {
    // A device that guessed and sent `preferred_unit` must not get a half-honoured
    // write back. zod strips it: 200, and the response carries no such field.
    const res = await call('PUT', '/activity-preferences', {
      body: { preferred_unit: 'lb', notify_photo_shared: false },
    });
    expect(res.status).toBe(200);

    const body = await prefs(res);
    expect(body.preferred_unit).toBeUndefined();
    expect(body.notify_photo_shared).toBe(false);

    // …and nothing landed in the row either.
    const [row] = await storedRows();
    expect(row.preferred_unit).toBeUndefined();
  });
});

/* ==================================================================== *
 * 2. The verbs that exist.
 * ==================================================================== */

describe('HEALTH-MORE-085 — the surface is GET + PUT and nothing else', () => {
  it('answers GET and PUT', async () => {
    expect((await call('GET', '/activity-preferences')).status).toBe(200);
    expect(
      (await call('PUT', '/activity-preferences', { body: { notify_photo_shared: false } })).status
    ).toBe(200);
  });

  it('refuses POST, PATCH and DELETE', async () => {
    // The row is a single upsert keyed on `user_id` — there is nothing to
    // create and nothing to destroy. A DELETE that quietly 200'd would be
    // indistinguishable from "reset my preferences", which is not a feature.
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const res = await call(method, '/activity-preferences', { body: {} });
      expect([404, 405], `${method} /activity-preferences`).toContain(res.status);
    }
    // Nothing was written by any of them.
    expect(await storedRows()).toEqual([]);
  });
});

/* ==================================================================== *
 * 3. A read is a read.
 * ==================================================================== */

describe('HEALTH-MORE-086 — GET never writes', () => {
  it('returns the defaults for an unsaved user without materialising a row', async () => {
    // `getActivityPreferences` synthesises the defaults in memory. If it ever
    // upserted-on-read instead, `created_at` would start lying about when the
    // user actually chose something — and every account that merely OPENED the
    // screen would look like an account that configured it.
    const first = await prefs(await call('GET', '/activity-preferences'));
    expect(first.created_at).toBeNull();
    expect(first.updated_at).toBeNull();
    expect(await storedRows()).toEqual([]);

    // Reading it three more times must still leave the table empty.
    await call('GET', '/activity-preferences');
    await call('GET', '/activity-preferences');
    expect(await storedRows()).toEqual([]);

    // And the defaults it reports are the service's, not a fresh row's.
    for (const field of ACTIVITY_PREFERENCE_FIELDS) {
      expect(first[field], field).toBe(ACTIVITY_PREFERENCE_DEFAULTS[field]);
    }
  });
});

/* ==================================================================== *
 * 4. A rejected write leaves nothing behind.
 * ==================================================================== */

describe('HEALTH-MORE-087 — validation runs BEFORE the upsert', () => {
  it('leaves no row at all when a first-ever write is rejected', async () => {
    // The dangerous ordering is upsert-then-validate: a 400 that still created
    // a defaults row would flip a never-configured account into a configured
    // one, and `created_at` would date from a request that failed.
    const res = await call('PUT', '/activity-preferences', {
      body: { notify_photo_shared: 'yes' },
    });
    expect(res.status).toBe(400);
    expect(await storedRows()).toEqual([]);

    // The account still reads as unsaved.
    const body = await prefs(await call('GET', '/activity-preferences'));
    expect(body.created_at).toBeNull();
  });

  it('rejects null as a value — an absent flag is `undefined`, not `null`', async () => {
    // The partial-update contract is "omit what you are not changing". `null`
    // is a third thing, and coercing it to `false` would silently turn a
    // notification OFF for a client that meant "leave it alone".
    const res = await call('PUT', '/activity-preferences', {
      body: { notify_recipe_created: null },
    });
    expect(res.status).toBe(400);
    expect(await storedRows()).toEqual([]);
  });

  it('does not corrupt an EXISTING row when a later write is rejected', async () => {
    await call('PUT', '/activity-preferences', { body: { notify_photo_shared: false } });
    const before = await prefs(await call('GET', '/activity-preferences'));

    const res = await call('PUT', '/activity-preferences', {
      body: { notify_photo_shared: true, receive_push_notifications: 1 },
    });
    expect(res.status).toBe(400);

    // The valid half of a rejected body must not land either — the whole body
    // is one write or none of it.
    const after = await prefs(await call('GET', '/activity-preferences'));
    expect(after).toEqual(before);
    expect(after.notify_photo_shared).toBe(false);
  });
});

/* ==================================================================== *
 * 5. Repeating a write changes nothing.
 * ==================================================================== */

describe('HEALTH-MORE-088 — the write is idempotent', () => {
  it('keeps one row and the same values when the same body is sent twice', async () => {
    const body = { notify_recipe_created: false, receive_inapp_notifications: false };

    const first = await prefs(await call('PUT', '/activity-preferences', { body }));
    const second = await prefs(await call('PUT', '/activity-preferences', { body }));

    // `user_id` is the PRIMARY KEY, so a second write must UPDATE, never insert.
    expect(await storedRows()).toHaveLength(1);

    for (const field of ACTIVITY_PREFERENCE_FIELDS) {
      expect(second[field], field).toBe(first[field]);
    }
    // `created_at` is the moment the account first configured anything and must
    // survive every later write; `updated_at` may move.
    expect(second.created_at).toBe(first.created_at);
    expect(String(second.updated_at) >= String(first.updated_at)).toBe(true);
  });
});

/* ==================================================================== *
 * 6. The row belongs to the TOKEN.
 * ==================================================================== */

describe('HEALTH-MORE-089 — the body cannot choose whose preferences these are', () => {
  it('ignores a user_id in the payload and writes the caller"s own row', async () => {
    const res = await call('PUT', '/activity-preferences', {
      body: { user_id: OTHER_UID, notify_photo_shared: false },
    });
    expect(res.status).toBe(200);
    expect((await prefs(res)).user_id).toBe(UID);

    const rows = await storedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(UID);
  });

  it('reports the caller"s own id on a read, even before anything is saved', async () => {
    const body = await prefs(await call('GET', '/activity-preferences'));
    expect(body.user_id).toBe(UID);

    const otherToken = await mintToken(OTHER_UID);
    const otherBody = await prefs(
      await call('GET', '/activity-preferences', { token: otherToken })
    );
    expect(otherBody.user_id).toBe(OTHER_UID);
  });
});

/* ==================================================================== *
 * 7. Favourite workout types — the one curated LIST on this surface.
 * ==================================================================== */

describe('HEALTH-MORE-090 — favourite workout types', () => {
  it('defaults to an empty array, never null, before anything is saved', async () => {
    const body = await prefs(await call('GET', '/activity-preferences'));
    expect(body.favourite_workout_types).toEqual([]);
  });

  it('round-trips a saved list through GET after PUT', async () => {
    const res = await call('PUT', '/activity-preferences', {
      body: { favourite_workout_types: ['running', 'tableTennis'] },
    });
    expect(res.status).toBe(200);
    expect((await prefs(res)).favourite_workout_types).toEqual(['running', 'tableTennis']);

    const read = await prefs(await call('GET', '/activity-preferences'));
    expect(read.favourite_workout_types).toEqual(['running', 'tableTennis']);
  });

  it('a PATCH of one notification flag does not touch a previously-saved favourites list', async () => {
    await call('PUT', '/activity-preferences', {
      body: { favourite_workout_types: ['yoga', 'cycle'] },
    });
    const res = await call('PUT', '/activity-preferences', {
      body: { notify_photo_shared: false },
    });
    expect(res.status).toBe(200);
    const body = await prefs(res);
    expect(body.favourite_workout_types).toEqual(['yoga', 'cycle']);
    expect(body.notify_photo_shared).toBe(false);
  });

  it('an explicit empty array clears a previously-saved list', async () => {
    await call('PUT', '/activity-preferences', { body: { favourite_workout_types: ['running'] } });
    const res = await call('PUT', '/activity-preferences', { body: { favourite_workout_types: [] } });
    expect((await prefs(res)).favourite_workout_types).toEqual([]);
  });

  it('rejects a non-array value with a 400 and leaves the stored list untouched', async () => {
    await call('PUT', '/activity-preferences', { body: { favourite_workout_types: ['running'] } });
    const res = await call('PUT', '/activity-preferences', {
      body: { favourite_workout_types: 'running' },
    });
    expect(res.status).toBe(400);

    const after = await prefs(await call('GET', '/activity-preferences'));
    expect(after.favourite_workout_types).toEqual(['running']);
  });

  it('rejects a non-string array entry with a 400', async () => {
    const res = await call('PUT', '/activity-preferences', {
      body: { favourite_workout_types: ['running', 42] },
    });
    expect(res.status).toBe(400);
  });

  it('rejects an empty-string entry with a 400 — whitespace is not a slug', async () => {
    const res = await call('PUT', '/activity-preferences', {
      body: { favourite_workout_types: ['   '] },
    });
    expect(res.status).toBe(400);
  });

  it('accepts exactly 61 entries — the whole WorkoutType vocabulary — and rejects 62', async () => {
    const sixtyOne = Array.from({ length: 61 }, (_, i) => `type_${i}`);
    const okRes = await call('PUT', '/activity-preferences', {
      body: { favourite_workout_types: sixtyOne },
    });
    expect(okRes.status).toBe(200);
    expect((await prefs(okRes)).favourite_workout_types).toHaveLength(61);

    const sixtyTwo = [...sixtyOne, 'type_61'];
    const tooMany = await call('PUT', '/activity-preferences', {
      body: { favourite_workout_types: sixtyTwo },
    });
    expect(tooMany.status).toBe(400);
  });

  it('does not hard-validate against the WorkoutType enum — the Worker does not share that RN type', async () => {
    // A slug this Worker has never heard of is still stored: the client is
    // responsible for only ever sending real WorkoutType slugs, per the
    // migration's deviation note.
    const res = await call('PUT', '/activity-preferences', {
      body: { favourite_workout_types: ['someFutureWorkoutTypeNotYetInvented'] },
    });
    expect(res.status).toBe(200);
    expect((await prefs(res)).favourite_workout_types).toEqual([
      'someFutureWorkoutTypeNotYetInvented',
    ]);
  });

  it('keeps users in separate lanes', async () => {
    await call('PUT', '/activity-preferences', { body: { favourite_workout_types: ['running'] } });
    const otherToken = await mintToken(OTHER_UID);
    const otherBody = await prefs(
      await call('GET', '/activity-preferences', { token: otherToken })
    );
    expect(otherBody.favourite_workout_types).toEqual([]);
  });
});
