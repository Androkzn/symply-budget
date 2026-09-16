/**
 * Symply Health — LIVE deployed-API contract tests.
 *
 * These hit the REAL `symply-health-api` Cloudflare Worker over the network
 * (not miniflare), so they verify the actually-deployed backend, its isolated
 * D1/KV/R2, and its auth/validation contracts. The health backend runs the
 * shared House `backend/src` with Health's own data + freshly-generated
 * JWT_SECRET (see the `symply-health-backend` project note).
 *
 * Run with Node's built-in test runner (NOT vitest — the backend vitest pool is
 * miniflare/workerd and cannot fetch external URLs):
 *
 *   npm --prefix backend run test:live:health
 *   HEALTH_API_URL=<url> node --test backend/__tests__/live/health-live-api.mjs
 *
 * The filename intentionally omits `.test.` so `vitest run` does not pick it up.
 */

/* This runner executes under Node (not workerd), so it uses Node/Web globals. */
/* global process, fetch, AbortController, setTimeout, clearTimeout */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const STAGING = 'https://symply-health-api-staging.a-tekhtelev.workers.dev';
const PRODUCTION = 'https://symply-health-api.a-tekhtelev.workers.dev';

// Auth/validation contracts run against staging by default; override for prod.
const BASE = process.env.HEALTH_API_URL || STAGING;

const TIMEOUT_MS = 25_000;

async function req(base, path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(base + path, { ...init, signal: controller.signal });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function jsonPost(payload) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

test('GET /health returns ok on staging', async () => {
  const { status, body } = await req(STAGING, '/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
});

test('GET /health returns ok on production', async () => {
  const { status, body } = await req(PRODUCTION, '/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
});

test('POST /auth/register accepts a valid payload (public registration on)', async () => {
  const probeEmail = `probe.health.${Date.now()}@example.com`;
  const { status, body } = await req(
    BASE,
    '/auth/register',
    jsonPost({
      email: probeEmail,
      password: 'Andrei123!',
      display_name: 'Probe',
    }),
  );
  assert.equal(status, 201);
  assert.equal(typeof body.user?.id, 'string');
  assert.equal(body.user?.email, probeEmail);
  assert.equal(typeof body.access_token, 'string');
  assert.equal(typeof body.refresh_token, 'string');
});

test('POST /auth/login rejects bad credentials with a clean 401 envelope', async () => {
  const { status, body } = await req(
    BASE,
    '/auth/login',
    jsonPost({ email: 'a.tekhtelev@gmail.com', password: 'definitely-wrong-password' }),
  );
  assert.equal(status, 401);
  assert.equal(body.error?.code, 'unauthorized');
  // Never leak which half of the credential was wrong.
  assert.match(body.error?.message ?? '', /invalid email or password/i);
});

test('POST /auth/login validates the payload (Zod 400)', async () => {
  const { status, body } = await req(BASE, '/auth/login', jsonPost({ email: 'not-an-email' }));
  assert.equal(status, 400);
  assert.equal(body.error?.name ?? body.name, 'ZodError');
});

test('GET /users/me requires authentication (401)', async () => {
  const { status, body } = await req(BASE, '/users/me');
  assert.equal(status, 401);
  assert.equal(body.error?.code, 'unauthorized');
});

test('GET /households requires authentication (401)', async () => {
  const { status } = await req(BASE, '/households');
  assert.equal(status, 401);
});

test('unknown routes 404 without leaking a stack trace', async () => {
  const { status, body } = await req(BASE, '/this-route-does-not-exist');
  assert.equal(status, 404);
  const serialized = typeof body === 'string' ? body : JSON.stringify(body);
  assert.doesNotMatch(serialized, /\bat \/|node_modules|\.ts:\d+/);
});

/* ------------------------------------------------------------------ */
/* Authenticated contract — the ONLY network surface Symply Health has */
/* ------------------------------------------------------------------ */

/**
 * Every health log (weight / water / note / prefs) is MMKV-local and issues no
 * request (matrix PRIV-018), so Health's entire backend surface is auth +
 * profile + notifications. These cases drive it end-to-end with the seeded fleet
 * account and assert the RESPONSE, not just the status — a Worker wired to the
 * wrong D1 answers 200 with someone else's identity.
 *
 * Credentials come from the environment, nothing is baked in:
 *   set -a && source e2e/credentials.local && set +a
 * With E2E_EMAIL / E2E_PASSWORD unset these skip rather than fail, so the
 * unauthenticated contract above still runs on a bare checkout.
 */
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const NO_CREDS = !EMAIL || !PASSWORD;
const SKIP = { skip: NO_CREDS ? 'E2E_EMAIL / E2E_PASSWORD not set' : false };

/** Cached session so each case does not re-login. */
let session = null;

async function login() {
  if (session) return session;
  const { status, body } = await req(BASE, '/auth/login', jsonPost({ email: EMAIL, password: PASSWORD }));
  assert.equal(status, 200, `login failed (${status}): ${JSON.stringify(body)}`);
  session = body;
  return session;
}

function authed(token, init = {}) {
  return {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
  };
}

test('HEALTH-API-020: the seeded fleet account logs in and receives a token pair', SKIP, async () => {
  const body = await login();
  assert.equal(typeof body.access_token, 'string');
  assert.equal(typeof body.refresh_token, 'string');
  assert.equal(body.user?.email, EMAIL);
  assert.equal(typeof body.user?.id, 'string');
});

test('HEALTH-API-021: GET /users/me returns THIS account from Health’s own D1', SKIP, async () => {
  const { access_token, user } = await login();
  const { status, body } = await req(BASE, '/users/me', authed(access_token));
  assert.equal(status, 200);
  // Same identity the login returned — proves the token resolves in the Health
  // data plane, not just that some user row was found.
  assert.equal(body.user?.id ?? body.id, user.id);
  assert.equal(body.user?.email ?? body.email, EMAIL);
});

test('HEALTH-API-022: PATCH /users/me saves a display name and reads it back', SKIP, async () => {
  const { access_token } = await login();
  const before = await req(BASE, '/users/me', authed(access_token));
  const original = before.body.user?.display_name ?? before.body.display_name ?? 'Andrei';
  const probe = `Health E2E ${Date.now()}`;

  const saved = await req(
    BASE,
    '/users/me',
    authed(access_token, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ display_name: probe }),
    }),
  );
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  const after = await req(BASE, '/users/me', authed(access_token));
  assert.equal(after.body.user?.display_name ?? after.body.display_name, probe);

  // Restore so the shared fleet account is left as found.
  await req(
    BASE,
    '/users/me',
    authed(access_token, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ display_name: original }),
    }),
  );
});

test('HEALTH-API-023: PATCH /users/me rejects an invalid payload (Zod 400)', SKIP, async () => {
  const { access_token } = await login();
  const { status } = await req(
    BASE,
    '/users/me',
    authed(access_token, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ display_name: 42 }),
    }),
  );
  assert.equal(status, 400);
});

test('HEALTH-API-024: GET /notifications/history backs the header bell', SKIP, async () => {
  const { access_token } = await login();
  const { status, body } = await req(BASE, '/notifications/history?limit=20', authed(access_token));
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.notifications), `expected notifications[]: ${JSON.stringify(body)}`);
});

test('HEALTH-API-025: GET /notifications/preferences returns the per-user prefs object', SKIP, async () => {
  const { access_token } = await login();
  const { status, body } = await req(BASE, '/notifications/preferences', authed(access_token));
  assert.equal(status, 200);
  assert.equal(typeof (body.preferences ?? body), 'object');
});

test('HEALTH-API-026: GET /households resolves for the Health account', SKIP, async () => {
  const { access_token } = await login();
  const { status, body } = await req(BASE, '/households', authed(access_token));
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.households ?? body), `expected a list: ${JSON.stringify(body)}`);
});

test('HEALTH-API-027: POST /auth/refresh mints a fresh access token', SKIP, async () => {
  const { refresh_token } = await login();
  const { status, body } = await req(BASE, '/auth/refresh', jsonPost({ refresh_token }));
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(typeof body.access_token, 'string');
});

test('HEALTH-API-028: a tampered token is rejected, never silently downgraded', SKIP, async () => {
  const { access_token } = await login();
  const tampered = `${access_token.slice(0, -2)}xx`;
  const { status } = await req(BASE, '/users/me', authed(tampered));
  assert.equal(status, 401);
});

test('HEALTH-API-029: only the SPECCED health data-plane routes exist', SKIP, async () => {
  // Superseded 2026-07-25. This case used to assert that NO health data-plane
  // route existed, because the P1 shell was on-device only. Parity phase P1
  // ported the donor's backend (documents/apps/symply-health/PARITY_PLAN.md),
  // so the contract flipped: the specced surface must exist, and anything
  // UNSPECCED must still 404 — an unspecced health route is the thing that
  // must never ship silently.
  const { access_token } = await login();

  for (const path of ['/health-log', '/weights', '/water', '/health/unspecced']) {
    const { status } = await req(BASE, path, authed(access_token));
    assert.equal(status, 404, `${path} unexpectedly exists (${status})`);
  }
});

/* ==================== Health tracking domain (parity P1) ==================== */

test('HEALTH-API-030: the /health healthcheck is NOT shadowed by the domain mount', async () => {
  // The tracking domain mounts at `/health`, and every Worker also answers the
  // platform monitoring healthcheck at exactly `/health`. Both must coexist.
  for (const base of [STAGING, PRODUCTION]) {
    const { status, body } = await req(base, '/health');
    assert.equal(status, 200, `${base} healthcheck broke (${status})`);
    assert.equal(body.status, 'ok');
  }
});

test('HEALTH-API-031: every health data route requires auth on BOTH environments', async () => {
  // Health data is personal. An unauthenticated 200 anywhere here is a breach,
  // so this runs without credentials and covers staging AND production.
  const paths = [
    '/health/summary',
    '/health/weight/entries',
    '/health/water/entries',
    '/health/nutrition/entries',
    '/health/measurements',
    '/health/entries',
    '/health/habits',
    '/health/goals',
    '/health/cycle/settings',
    '/health/cycle/periods',
    '/health/cycle/symptoms',
    '/health/mens-health/entries',
    '/health/sync',
  ];
  for (const base of [STAGING, PRODUCTION]) {
    for (const path of paths) {
      const { status } = await req(base, path);
      assert.equal(status, 401, `${base}${path} was not auth-gated (${status})`);
    }
  }
});

test('HEALTH-API-032: weight round-trips through the deployed Worker', SKIP, async () => {
  const { access_token } = await login();
  const date = new Date().toISOString().slice(0, 10);

  const created = await req(
    BASE,
    '/health/weight/entries',
    authed(access_token, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date, weight: 71.5, unit: 'kg', note: 'live-api probe' }),
    })
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body?.entry?.id;
  assert.equal(typeof id, 'string');

  const listed = await req(BASE, '/health/weight/entries', authed(access_token));
  assert.equal(listed.status, 200);
  assert.ok(
    listed.body.entries.some((e) => e.id === id),
    'the entry just created is missing from the list'
  );

  // Statistics are server-computed — the app never recomputes them.
  const stats = await req(BASE, '/health/weight/statistics', authed(access_token));
  assert.equal(stats.status, 200);
  assert.equal(typeof stats.body.statistics.count, 'number');

  // Teardown: soft-delete, then prove it left the list (tombstone, not a hole).
  const deleted = await req(
    BASE,
    `/health/weight/entries/${id}`,
    authed(access_token, { method: 'DELETE' })
  );
  assert.equal(deleted.status, 200);
  const after = await req(BASE, '/health/weight/entries', authed(access_token));
  assert.ok(!after.body.entries.some((e) => e.id === id), 'soft-deleted entry still listed');
});

test('HEALTH-API-033: the daily summary answers with every section', SKIP, async () => {
  const { access_token } = await login();
  const { status, body } = await req(BASE, '/health/summary', authed(access_token));
  assert.equal(status, 200, JSON.stringify(body));
  const summary = body.summary;
  assert.equal(typeof summary.date, 'string');
  assert.ok(summary.nutrition, 'nutrition section missing');
  assert.ok(summary.water, 'water section missing');
  assert.ok(summary.steps, 'steps section missing');
});

test('HEALTH-API-034: validation rejects an out-of-range weight rather than storing it', SKIP, async () => {
  const { access_token } = await login();
  const { status } = await req(
    BASE,
    '/health/weight/entries',
    authed(access_token, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-07-25', weight: 99999, unit: 'kg' }),
    })
  );
  assert.equal(status, 400, `an absurd weight was accepted (${status})`);
});

test('HEALTH-API-035: sync returns a cursor and the delta buckets', SKIP, async () => {
  const { access_token } = await login();
  const { status, body } = await req(
    BASE,
    '/health/sync?since=1970-01-01T00:00:00.000Z',
    authed(access_token)
  );
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(typeof body.server_time, 'string');
  for (const bucket of ['weight_entries', 'water_entries', 'nutrition_entries', 'habits']) {
    assert.ok(Array.isArray(body[bucket]), `${bucket} is not an array`);
  }
});
