import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../../types';
import {
  isHealthWaveAPath,
  rejectHealthWritesForLocalFirstEarly,
} from '../health-local-first-gate';

/**
 * The gate reads nothing off `Env`, but the middleware is typed
 * `Context<{ Bindings: Env }>`, so a cast-shaped stub keeps the composed app
 * honest without dragging D1/R2/KV bindings into a pure-routing test. Same
 * shape as `house-local-first-gate.test.ts`.
 */
function mkEnv(): Env {
  return { APP_BRAND: 'symply-health' } as unknown as Env;
}

const LOCAL_FIRST_HEADER = { 'X-Health-Local-First': '1' } as const;

const REJECT_BODY = {
  error: {
    code: 'local_first_enabled',
    message:
      'Health domain API is disabled for local-first clients. Use the on-device ledger and /v2 control-plane routes.',
  },
};

/**
 * Stand-in for the composed app: the healthcheck at `index.ts:207`, the gate
 * registered exactly as `index.ts` registers it (`/health/*`, above the router
 * mounts), then a catch-all `/health/*` router standing in for the eight real
 * `/health` mounts. A request that reaches the router is proof the gate let it
 * through; a 410 is proof it did not.
 */
function mkApp() {
  const app = new Hono<{ Bindings: Env }>();

  // index.ts:207 — the platform healthcheck. Registered ABOVE the gate, exactly
  // as in production.
  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.use('/health/*', rejectHealthWritesForLocalFirstEarly());

  // Stands in for healthRoutes + the seven sibling mounts.
  app.all('/health/*', (c) => c.json({ ok: true, path: new URL(c.req.url).pathname }));

  return app;
}

async function request(path: string, method: string, headers?: Record<string, string>) {
  return mkApp().request(`http://x${path}`, { method, headers }, mkEnv());
}

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------------- */
/* Reject-list shape                                                          */
/* ------------------------------------------------------------------------- */

describe('isHealthWaveAPath', () => {
  it('HEALTH-LF-100: matches every Wave A prefix, bare and nested', () => {
    // One row per Wave A table (plan §1.5), verified against routes/health.ts.
    expect(isHealthWaveAPath('/health/weight/entries')).toBe(true); // weight_entries
    expect(isHealthWaveAPath('/health/weight/statistics')).toBe(true);
    expect(isHealthWaveAPath('/health/water/entries')).toBe(true); // water_entries
    expect(isHealthWaveAPath('/health/water/undo')).toBe(true);
    expect(isHealthWaveAPath('/health/nutrition/entries')).toBe(true); // nutrition_entries
    expect(isHealthWaveAPath('/health/nutrition/copy-day')).toBe(true);
    expect(isHealthWaveAPath('/health/entries')).toBe(true); // health_entries
    expect(isHealthWaveAPath('/health/entries/workouts/abc')).toBe(true);
    expect(isHealthWaveAPath('/health/measurements')).toBe(true); // body_measurements
    expect(isHealthWaveAPath('/health/measurements/latest')).toBe(true);
    expect(isHealthWaveAPath('/health/habits')).toBe(true); // user_habits + habit_logs
    expect(isHealthWaveAPath('/health/habits/h_1/toggle')).toBe(true);
    expect(isHealthWaveAPath('/health/goals')).toBe(true); // health_goals
    expect(isHealthWaveAPath('/health/sync/push')).toBe(true); // sync contract
  });

  it('HEALTH-LF-101: matches BARE /health/sync, which the plan’s `/health/sync/*` misses', () => {
    // `GET /health/sync` (routes/health.ts:1139) is the delta PULL and lives at
    // the bare path — a `/*`-shaped match would let the single largest D1 read
    // in the app through to a flag-1 client.
    expect(isHealthWaveAPath('/health/sync')).toBe(true);
  });

  it('HEALTH-LF-102: never matches the bare /health healthcheck', () => {
    expect(isHealthWaveAPath('/health')).toBe(false);
    expect(isHealthWaveAPath('/')).toBe(false);
  });

  it('HEALTH-LF-103: does not match non-Wave-A surfaces', () => {
    expect(isHealthWaveAPath('/health/cycle/periods')).toBe(false);
    expect(isHealthWaveAPath('/health/ai/coach/turn')).toBe(false);
    expect(isHealthWaveAPath('/health/summary')).toBe(false);
    expect(isHealthWaveAPath('/health/challenges')).toBe(false);
  });

  it('HEALTH-LF-105: matches POST /health/ai/coach/commit — a Wave A write outside every Wave A prefix', () => {
    // The coach commit step materializes the confirmed proposal and writes FIVE
    // Wave A tables (`coach-service.ts` createWater :718, createWeight :726,
    // createHealthEntry :738, toggleHabit :780, createNutrition :788).
    // Plan §2 item 3 assigns all of `/health/ai/*` to the fall-through set, so
    // without this exact-path entry a flag-1 client confirming a proposal writes
    // straight to D1 while its ledger is the system of record — the dual-world
    // state §1.3 rejects, through the one door the reject-list left open.
    expect(isHealthWaveAPath('/health/ai/coach/commit')).toBe(true);
  });

  it('HEALTH-LF-106: the REST of /health/ai stays fall-through (genuinely Tier B)', () => {
    // Scoping matters: consent, turn, scans and body-insight generation must keep
    // working for a flag-1 client. Only the commit writes Wave A.
    expect(isHealthWaveAPath('/health/ai/coach/consent')).toBe(false);
    expect(isHealthWaveAPath('/health/ai/coach/turn')).toBe(false);
    expect(isHealthWaveAPath('/health/ai/coach/operations')).toBe(false);
    expect(isHealthWaveAPath('/health/ai/nutrition-label')).toBe(false);
    expect(isHealthWaveAPath('/health/ai/meal-photo')).toBe(false);
    expect(isHealthWaveAPath('/health/ai/body-insights/generate')).toBe(false);
    // Exact match only — a deeper path under commit is not a known route.
    expect(isHealthWaveAPath('/health/ai/coach/commit/extra')).toBe(false);
  });

  it('HEALTH-LF-104: prefixes are `/`-delimited, not substring matches', () => {
    // Guards against a future `/health/goals-archive` or `/health/entries-export`
    // being swept in (or, worse, `/health/waterfall` style false positives).
    expect(isHealthWaveAPath('/health/goalsomething')).toBe(false);
    expect(isHealthWaveAPath('/health/entries-export')).toBe(false);
    expect(isHealthWaveAPath('/health/syncopate')).toBe(false);
  });
});

/* ------------------------------------------------------------------------- */
/* Fall-through set — one row per real non-Wave-A prefix                      */
/* ------------------------------------------------------------------------- */

describe('rejectHealthWritesForLocalFirstEarly — fall-through set', () => {
  /**
   * Every row is a REAL route verified against the routers, not a guess. With
   * the local-first header PRESENT these must reach the handler (2xx here; in
   * production 2xx/4xx from auth/flags) and must never be 410 — they are Tier B,
   * Wave C or Tier D and stay server-authoritative for all of Wave A.
   */
  const FALL_THROUGH: Array<[label: string, method: string, path: string]> = [
    ['cycle (Wave C)', 'POST', '/health/cycle/periods'],
    ['mens-health (Wave C)', 'PUT', '/health/mens-health/settings'],
    ['ai (Tier B)', 'POST', '/health/ai/coach/turn'],
    ['reminders', 'PUT', '/health/reminders/preferences'],
    ['exercises', 'PUT', '/health/exercises/ex_1/favorite'],
    ['foods', 'GET', '/health/foods/search'],
    ['custom-foods (Wave C)', 'POST', '/health/custom-foods'],
    ['recipes (Wave C)', 'POST', '/health/recipes'],
    ['widget', 'PUT', '/health/widget/preferences'],
    ['fridge (Wave C)', 'POST', '/health/fridge'],
    ['files (Wave D)', 'POST', '/health/files'],
    ['injuries (Wave C)', 'POST', '/health/injuries'],
    ['body-insights', 'GET', '/health/body-insights/latest'],
    ['challenges (Tier D)', 'POST', '/health/challenges'],
    ['social (Off)', 'POST', '/health/social/family'],
    ['summary (derived)', 'GET', '/health/summary'],
  ];

  it.each(FALL_THROUGH)(
    'HEALTH-LF-110: %s — %s %s is NOT 410 even with the header',
    async (_label, method, path) => {
      const res = await request(path, method, { ...LOCAL_FIRST_HEADER });
      expect(res.status).not.toBe(410);
      expect(res.status).toBe(200);
    },
  );
});

/* ------------------------------------------------------------------------- */
/* Wave A — armed                                                             */
/* ------------------------------------------------------------------------- */

describe('rejectHealthWritesForLocalFirstEarly — Wave A with the header', () => {
  const WAVE_A_MUTATIONS: Array<[method: string, path: string]> = [
    ['POST', '/health/weight/entries'],
    ['PUT', '/health/weight/entries/w_1'],
    ['DELETE', '/health/weight/entries/w_1'],
    ['POST', '/health/water/entries'],
    ['POST', '/health/nutrition/entries/bulk'],
    ['POST', '/health/entries/workouts'],
    ['PATCH', '/health/measurements/m_1'],
    ['POST', '/health/habits/h_1/toggle'],
    ['PUT', '/health/goals'],
    ['POST', '/health/sync/push'],
  ];

  it.each(WAVE_A_MUTATIONS)('HEALTH-LF-120: %s %s → 410', async (method, path) => {
    const res = await request(path, method, { ...LOCAL_FIRST_HEADER });
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual(REJECT_BODY);
  });

  const WAVE_A_READS = [
    '/health/weight/entries',
    '/health/weight/weekly-averages',
    '/health/water/summary/daily',
    '/health/nutrition/summary',
    '/health/entries',
    '/health/measurements/latest',
    '/health/habits',
    '/health/goals',
    '/health/sync',
  ];

  /**
   * The divergence from the method-blind House sibling. A Wave A GET reaching D1
   * means the client Proxy fell back silently and `readThrough` will overwrite
   * the MMKV mirror with the D1 answer (empty, post-truncate). 410 is what makes
   * that visible.
   */
  it.each(WAVE_A_READS)('HEALTH-LF-121: GET %s → 410 (readThrough guard)', async (path) => {
    const res = await request(path, 'GET', { ...LOCAL_FIRST_HEADER });
    expect(res.status).toBe(410);
  });

  it('HEALTH-LF-122: the `?local_first=1` query fallback arms the gate too', async () => {
    const res = await request('/health/weight/entries?local_first=1', 'POST');
    expect(res.status).toBe(410);
  });

  it('HEALTH-LF-123: OPTIONS is never converted into a 410 (CORS preflight)', async () => {
    const res = await request('/health/weight/entries', 'OPTIONS', { ...LOCAL_FIRST_HEADER });
    expect(res.status).not.toBe(410);
  });
});

/* ------------------------------------------------------------------------- */
/* Wave A — unarmed                                                           */
/* ------------------------------------------------------------------------- */

describe('rejectHealthWritesForLocalFirstEarly — Wave A without the header', () => {
  const CASES: Array<[method: string, path: string]> = [
    ['POST', '/health/weight/entries'],
    ['GET', '/health/weight/entries'],
    ['POST', '/health/water/entries'],
    ['POST', '/health/nutrition/entries'],
    ['POST', '/health/entries'],
    ['POST', '/health/measurements'],
    ['POST', '/health/habits'],
    ['PUT', '/health/goals'],
    ['GET', '/health/sync'],
    ['POST', '/health/sync/push'],
  ];

  it.each(CASES)('HEALTH-LF-130: %s %s falls through untouched', async (method, path) => {
    const res = await request(path, method);
    expect(res.status).toBe(200);
  });

  it('HEALTH-LF-131: a bogus header value does not arm the gate', async () => {
    const res = await request('/health/weight/entries', 'POST', {
      'X-Health-Local-First': '0',
    });
    expect(res.status).toBe(200);
  });
});

/* ------------------------------------------------------------------------- */
/* Healthcheck precedence                                                     */
/* ------------------------------------------------------------------------- */

describe('the platform healthcheck is unaffected', () => {
  it('HEALTH-LF-140: GET /health → 200 {status:"ok"} without the header', async () => {
    const res = await request('/health', 'GET');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('HEALTH-LF-141: GET /health → 200 {status:"ok"} WITH the header', async () => {
    // A monitoring probe must never be able to 410 the fleet healthcheck, even
    // if a client library attaches the local-first header to every request.
    const res = await request('/health', 'GET', { ...LOCAL_FIRST_HEADER });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

/* ------------------------------------------------------------------------- */
/* Instrumentation — plan §2 item 10                                          */
/* ------------------------------------------------------------------------- */

describe('structured counters', () => {
  function spyLog() {
    return vi.spyOn(console, 'log').mockImplementation(() => {});
  }

  function emitted(spy: ReturnType<typeof spyLog>): Array<Record<string, unknown>> {
    return spy.mock.calls
      .map(([arg]) => (typeof arg === 'string' ? arg : ''))
      .filter((s) => s.startsWith('{'))
      .map((s) => JSON.parse(s) as Record<string, unknown>);
  }

  it('HEALTH-LF-150: health_flag0_mutation fires on a header-less Wave A mutation', async () => {
    const spy = spyLog();
    const res = await request('/health/weight/entries', 'POST');
    expect(res.status).toBe(200);
    expect(emitted(spy)).toContainEqual({
      evt: 'health_flag0_mutation',
      path: '/health/weight/entries',
      method: 'POST',
    });
  });

  it('HEALTH-LF-151: health_flag0_mutation does NOT fire on a non-Wave-A mutation', async () => {
    const spy = spyLog();
    const res = await request('/health/cycle/periods', 'POST');
    expect(res.status).toBe(200);
    expect(emitted(spy).map((e) => e.evt)).not.toContain('health_flag0_mutation');
  });

  it('HEALTH-LF-152: health_flag0_mutation does NOT fire on a Wave A GET', async () => {
    // The truncate gate asks "is anything still WRITING to D1?". Counting reads
    // would keep the counter permanently non-zero and block truncate forever.
    const spy = spyLog();
    await request('/health/weight/entries', 'GET');
    expect(emitted(spy).map((e) => e.evt)).not.toContain('health_flag0_mutation');
  });

  it('HEALTH-LF-153: health_410 fires on the reject branch', async () => {
    const spy = spyLog();
    const res = await request('/health/sync/push', 'POST', { ...LOCAL_FIRST_HEADER });
    expect(res.status).toBe(410);
    expect(emitted(spy)).toContainEqual({
      evt: 'health_410',
      path: '/health/sync/push',
      method: 'POST',
    });
  });

  it('HEALTH-LF-154: counters carry path + method ONLY (Appendix C.1 denylist)', async () => {
    const spy = spyLog();
    await request('/health/nutrition/entries?date=2026-08-13&userId=u_secret', 'POST', {
      ...LOCAL_FIRST_HEADER,
      Authorization: 'Bearer super-secret',
      'X-Device-Id': 'dev_secret',
    });

    const events = emitted(spy).filter((e) => e.evt === 'health_410');
    expect(events).toHaveLength(1);
    // Exactly three keys, and the query string is stripped from `path`.
    expect(Object.keys(events[0]).sort()).toEqual(['evt', 'method', 'path']);
    expect(events[0].path).toBe('/health/nutrition/entries');
    expect(JSON.stringify(events[0])).not.toContain('secret');
    expect(JSON.stringify(events[0])).not.toContain('2026-08-13');
  });

  it('HEALTH-LF-155: no counter is emitted for a non-Wave-A path at all', async () => {
    const spy = spyLog();
    await request('/health/ai/coach/turn', 'POST', { ...LOCAL_FIRST_HEADER });
    expect(emitted(spy)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------- */
/* Composed-app registration order (see health-ai-precedence.test.ts)         */
/* ------------------------------------------------------------------------- */

describe('registration order in the composed app', () => {
  it('HEALTH-LF-160: the gate is registered BEFORE the first /health router mount', async () => {
    // Hono runs handlers in registration order. The House gate's slot sits AFTER
    // all eight `/health` mounts, so a gate registered there would never fire —
    // this is the property a standalone-router test cannot see.
    const source = await import('../../index.ts?raw').then((m) => m.default as string);

    const gate = source.indexOf("app.use('/health/*', rejectHealthWritesForLocalFirstEarly())");
    const firstHealthMount = source.indexOf("app.route('/health', healthRoutes)");
    const houseGate = source.indexOf("app.use('*', rejectHomeWritesForLocalFirstEarly())");

    expect(gate).toBeGreaterThan(-1);
    expect(firstHealthMount).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(firstHealthMount);
    expect(houseGate).toBeGreaterThan(firstHealthMount); // the slot that would NOT work
  });

  it('HEALTH-LF-161: the gate is registered AFTER the platform healthcheck', async () => {
    const source = await import('../../index.ts?raw').then((m) => m.default as string);

    const healthcheck = source.indexOf("app.get('/health', (c) => {");
    const gate = source.indexOf("app.use('/health/*', rejectHealthWritesForLocalFirstEarly())");

    expect(healthcheck).toBeGreaterThan(-1);
    expect(healthcheck).toBeLessThan(gate);
  });
});
