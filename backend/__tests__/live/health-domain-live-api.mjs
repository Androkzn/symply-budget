/**
 * Symply Health — LIVE contract for the MIGRATED domain surface.
 *
 * `health-live-api.mjs` (beside this file) covers auth, profile and the
 * unauthenticated contract. This file covers what the donor-parity migration
 * actually added: nutrition, measurements, activity, goals, habits, cycle,
 * men's health, vitality, fridge, food library, recipes and the exercise
 * catalogue — against the REAL deployed Worker and its own D1.
 *
 * WHY A SECOND FILE, AND WHY IT SELF-REGISTERS:
 * the sibling suite skips its authenticated half unless E2E_EMAIL/E2E_PASSWORD
 * are exported, and the shared fleet account is not seeded in Health's isolated
 * D1 — so in practice that half never ran. These cases instead REGISTER a
 * throwaway account per run (public registration is on for this Worker, which
 * the sibling suite already asserts), so they always execute on a bare checkout
 * and always start from a genuinely empty user. That also makes every
 * "read back what I just wrote" assertion honest: nothing pre-exists.
 *
 * Run:
 *   npm --prefix backend run test:live:health
 *   HEALTH_API_URL=https://symply-health-api.a-tekhtelev.workers.dev \
 *     node --test backend/__tests__/live/health-domain-live-api.mjs
 *
 * Defaults to STAGING. The catalogue assertions are the exception — they run
 * against BOTH environments, because a migration applied to one D1 and not the
 * other is exactly the failure this is here to catch.
 *
 * POINTING IT AT PRODUCTION leaves two `parity.*@example.com` accounts and
 * their rows in the production D1 — harmless while Health is pre-launch, but
 * they are real rows and someone should sweep them before it is not. Prefer
 * staging unless you are specifically verifying a production deploy.
 *
 * The filename omits `.test.` so `vitest run` (miniflare, no external fetch)
 * does not pick it up.
 */

/* Executes under Node, not workerd. */
/* global process, fetch, AbortController, setTimeout, clearTimeout */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const STAGING = 'https://symply-health-api-staging.a-tekhtelev.workers.dev';
const PRODUCTION = 'https://symply-health-api.a-tekhtelev.workers.dev';
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

/* ------------------------------------------------------------------ */
/* Two throwaway accounts, registered once for the whole file          */
/* ------------------------------------------------------------------ */

let token = null;
let otherToken = null;

/**
 * Set when `/auth/register` answers 429.
 *
 * The Worker rate-limits registration per client, which is CORRECT — running
 * this suite repeatedly is exactly the pattern it exists to stop. So a 429 is
 * not a product failure and must not be reported as one; every case skips with
 * the limiter's own retry window named. Any OTHER non-201 still fails loudly:
 * only the one named, expected condition is forgiven.
 */
let rateLimited = null;

/**
 * A case that needs a signed-in account.
 *
 * The skip decision is made INSIDE the callback, not via the `{ skip }` option:
 * options are evaluated when the case is REGISTERED, which is before `before()`
 * has run, so an option-based skip always reads `rateLimited === null` and
 * never fires.
 */
function liveTest(name, fn) {
  test(name, async (t) => {
    if (rateLimited) return t.skip(rateLimited);
    await fn(t);
  });
}

/** Authenticated request against `BASE`. */
function api(path, init = {}) {
  return req(BASE, path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
}

const post = (path, payload) => api(path, { method: 'POST', body: JSON.stringify(payload) });
const put = (path, payload) => api(path, { method: 'PUT', body: JSON.stringify(payload) });
const del = (path) => api(path, { method: 'DELETE' });

async function register(label) {
  const email = `parity.${label}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
  const { status, body } = await req(BASE, '/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Andrei123!', display_name: `Parity ${label}` }),
  });
  if (status === 429) {
    const wait = body?.error?.details?.retry_after?.[0];
    rateLimited = `registration rate-limited by the Worker${wait ? ` (retry in ~${Math.ceil(wait / 60)} min)` : ''} — the limiter is working; re-run later or from another client`;
    return null;
  }
  assert.equal(status, 201, `register failed (${status}): ${JSON.stringify(body)}`);
  assert.equal(typeof body.access_token, 'string');
  return body.access_token;
}

// BOTH accounts are minted up-front: registering the second one lazily, inside
// the isolation case, made that case fail for a reason that had nothing to do
// with isolation.
before(async () => {
  token = await register('owner');
  if (rateLimited) return;
  otherToken = await register('other');
});

/** A stable day well clear of "today", so a real user's data can never collide. */
const DAY = '2024-02-29';
const NEXT_DAY = '2024-03-01';

/* ------------------------------------------------------------------ */
/* Exercise catalogue (migration 0123)                                 */
/* ------------------------------------------------------------------ */

liveTest('HEALTH-LIVE-100: the exercise catalogue is seeded and served', async () => {
  const { status, body } = await api('/health/exercises?limit=200');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.exercises), 'expected an exercises array');
  assert.equal(body.exercises.length, 88, 'migration 0123 seeds 88 exercises');

  const sample = body.exercises[0];
  // JSON columns arrive PARSED — a client that has to JSON.parse a column is a
  // client that will one day forget to.
  assert.ok(Array.isArray(sample.muscle_groups));
  assert.ok(Array.isArray(sample.body_parts));
  assert.equal(typeof sample.name, 'string');
  assert.equal(typeof sample.category, 'string');
});

liveTest('HEALTH-LIVE-101: every seeded row carries a loggable workout_type', async () => {
  const { body } = await api('/health/exercises?limit=200');
  const untyped = body.exercises.filter((e) => !e.workout_type);
  assert.deepEqual(untyped.map((e) => e.id), [], 'an untyped row cannot be logged from detail');
});

liveTest('HEALTH-LIVE-102: search and the closed vocabularies behave as specced', async () => {
  const search = await api('/health/exercises?search=squat');
  assert.equal(search.status, 200);
  assert.ok(search.body.exercises.length > 0, 'the catalogue contains a squat');

  const byCategory = await api('/health/exercises?category=yoga');
  assert.equal(byCategory.status, 200);
  assert.ok(byCategory.body.exercises.every((e) => e.category === 'yoga'));

  // Closed vocabulary → 400 on a typo, rather than a silent empty list that
  // reads as "no such exercises".
  const typo = await api('/health/exercises?category=yogaa');
  assert.equal(typo.status, 400);

  // Open vocabulary → an empty list is the honest answer.
  const openVocab = await api('/health/exercises?muscle_group=tail');
  assert.equal(openVocab.status, 200);
  assert.deepEqual(openVocab.body.exercises, []);
});

liveTest('HEALTH-LIVE-103: favouriting round-trips and un-favouriting reverses it', async () => {
  const { body } = await api('/health/exercises?limit=1');
  const id = body.exercises[0].id;

  const on = await put(`/health/exercises/${id}/favorite`, { is_favorite: true });
  assert.equal(on.status, 200);

  const faved = await api('/health/exercises?favorites=true');
  assert.ok(faved.body.exercises.some((e) => e.id === id), 'favourite did not stick');

  const off = await put(`/health/exercises/${id}/favorite`, { is_favorite: false });
  assert.equal(off.status, 200);

  const after = await api('/health/exercises?favorites=true');
  assert.ok(!after.body.exercises.some((e) => e.id === id), 'un-favourite did not stick');
});

liveTest('HEALTH-LIVE-104: the catalogue is READ-only over HTTP', async () => {
  // It is authored in migrations. No client may add to it.
  const created = await post('/health/exercises', { name: 'Injected' });
  assert.equal(created.status, 404);
});

test('HEALTH-LIVE-105: 0123 reached BOTH environments, not just one', async () => {
  // The failure this exists for: migrating staging, deploying, shipping — and
  // production 500s on the first list because the table is not there.
  for (const base of [STAGING, PRODUCTION]) {
    const { status } = await req(base, '/health/exercises');
    assert.equal(status, 401, `${base} did not mount /health/exercises`);
  }
});

/* ------------------------------------------------------------------ */
/* Nutrition — bulk, copy-day, summary                                 */
/* ------------------------------------------------------------------ */

liveTest('HEALTH-LIVE-110: nutrition bulk-create writes every row in one request', async () => {
  const { status, body } = await post('/health/nutrition/entries/bulk', {
    entries: [
      { date: DAY, food_name: 'Oats', meal_type: 'breakfast', calories: 320, proteins: 11 },
      { date: DAY, food_name: 'Banana', meal_type: 'breakfast', calories: 105 },
      { date: DAY, food_name: 'Chicken salad', meal_type: 'lunch', calories: 480, proteins: 42 },
    ],
  });
  assert.equal(status, 201);
  assert.equal(body.entries.length, 3);
});

liveTest('HEALTH-LIVE-111: the daily summary adds up what was just written', async () => {
  const { status, body } = await api(`/health/nutrition/summary?date=${DAY}`);
  assert.equal(status, 200);
  assert.equal(body.summary.totals.calories, 320 + 105 + 480);
  assert.equal(body.summary.totals.proteins, 11 + 42);
  assert.equal(body.summary.entry_count, 3);

  // Broken down by slot, because that is how the diary renders it — two
  // breakfast rows and one lunch row, not three undifferentiated entries.
  assert.equal(body.summary.by_meal.breakfast.calories, 320 + 105);
  assert.equal(body.summary.by_meal.lunch.calories, 480);
  assert.equal(body.summary.by_meal.dinner.calories, 0);
});

liveTest('HEALTH-LIVE-112: copy-day duplicates a day onto another date', async () => {
  const { status, body } = await post('/health/nutrition/copy-day', {
    from_date: DAY,
    to_date: NEXT_DAY,
  });
  assert.equal(status, 201);
  assert.equal(body.entries.length, 3);

  const summary = await api(`/health/nutrition/summary?date=${NEXT_DAY}`);
  assert.equal(summary.body.summary.totals.calories, 905);

  // The SOURCE day is untouched — a copy is not a move.
  const source = await api(`/health/nutrition/summary?date=${DAY}`);
  assert.equal(source.body.summary.totals.calories, 905);
});

liveTest('HEALTH-LIVE-113: copy-day can retarget a single slot', async () => {
  const { status, body } = await post('/health/nutrition/copy-day', {
    from_date: DAY,
    to_date: '2024-03-02',
    from_slot: 'lunch',
    to_slot: 'dinner',
  });
  assert.equal(status, 201);
  assert.equal(body.entries.length, 1);
  assert.equal(body.entries[0].meal_type, 'dinner');
  assert.equal(body.entries[0].food_name, 'Chicken salad');
});

liveTest('HEALTH-LIVE-114: bulk-create is capped, so it cannot be used to fill the table', async () => {
  const entries = Array.from({ length: 101 }, (_, i) => ({
    date: DAY,
    food_name: `Flood ${i}`,
    meal_type: 'snack',
    calories: 1,
  }));
  const { status } = await post('/health/nutrition/entries/bulk', { entries });
  assert.equal(status, 400);
});

/* ------------------------------------------------------------------ */
/* Body measurements — the widened site vocabulary                     */
/* ------------------------------------------------------------------ */

liveTest('HEALTH-LIVE-120: every one of the 14 exposed sites persists to its own column', async () => {
  const sites = {
    waist: 82,
    chest: 101,
    hips: 95,
    shoulders: 120,
    neck: 39,
    left_arm: 34,
    right_arm: 34.5,
    left_forearm: 28,
    right_forearm: 28.5,
    left_thigh: 56,
    right_thigh: 56.5,
    left_calf: 38,
    right_calf: 38.5,
    // The column is `body_fat_percentage`, not `body_fat`. Worth stating
    // outright: the payload schema STRIPS unknown keys, so a near-miss name is
    // accepted with a 201 and simply never stored. `healthBodyStorage` maps
    // `bodyFat` → this exact column for that reason.
    body_fat_percentage: 18.4,
  };
  // `unit` is REQUIRED: a bare 82 is meaningless — 82 cm and 82 in are both
  // plausible waists on this scale, and the server refuses to guess.
  const unitless = await post('/health/measurements', { date: DAY, waist: 82 });
  assert.equal(unitless.status, 400);

  const { status, body } = await post('/health/measurements', {
    date: DAY,
    unit: 'cm',
    ...sites,
  });
  assert.equal(status, 201);

  const saved = body.measurement;
  for (const [column, value] of Object.entries(sites)) {
    assert.equal(saved[column], value, `${column} did not round-trip`);
  }
});

liveTest('HEALTH-LIVE-121: /measurements/latest returns the row just written', async () => {
  const { status, body } = await api('/health/measurements/latest');
  assert.equal(status, 200);
  const latest = body.measurement;
  assert.equal(latest.waist, 82);
  assert.equal(latest.left_calf, 38);
  assert.equal(latest.unit, 'cm');
});

/* ------------------------------------------------------------------ */
/* Weight — the `source` column added by 0122                          */
/* ------------------------------------------------------------------ */

liveTest('HEALTH-LIVE-130: a weight entry records where it came from', async () => {
  const manual = await post('/health/weight/entries', { date: DAY, weight: 78.4, unit: 'kg' });
  assert.equal(manual.status, 201);
  const manualEntry = manual.body.entry;
  // Unstated source defaults to `manual` rather than NULL — the import
  // de-duplicator keys on it, and NULL is not a value it can compare.
  assert.equal(manualEntry.source, 'manual');

  const imported = await post('/health/weight/entries', {
    date: NEXT_DAY,
    weight: 78.1,
    unit: 'kg',
    source: 'healthkit',
  });
  assert.equal(imported.status, 201);
  assert.equal(imported.body.entry.source, 'healthkit');
});

liveTest('HEALTH-LIVE-131: an unknown source is rejected, not stored', async () => {
  const { status } = await post('/health/weight/entries', {
    date: DAY,
    weight: 70,
    unit: 'kg',
    source: 'telepathy',
  });
  assert.equal(status, 400);
});

/* ------------------------------------------------------------------ */
/* Goals — per-weekday calorie targets                                 */
/* ------------------------------------------------------------------ */

liveTest('HEALTH-LIVE-140: per-weekday calorie goals round-trip', async () => {
  const { status } = await put('/health/goals', {
    daily_calories: 2200,
    monday_calories: 1800,
    saturday_calories: 2600,
    daily_steps: 9000,
  });
  assert.equal(status, 200);

  const read = await api('/health/goals');
  assert.equal(read.status, 200);
  const goals = read.body.goal;
  assert.equal(goals.daily_calories, 2200);
  assert.equal(goals.monday_calories, 1800);
  assert.equal(goals.saturday_calories, 2600);
  assert.equal(goals.daily_steps, 9000);
});

/* ------------------------------------------------------------------ */
/* Fridge                                                              */
/* ------------------------------------------------------------------ */

liveTest('HEALTH-LIVE-150: a fridge item is created, edited, listed and soft-deleted', async () => {
  const created = await post('/health/fridge', {
    name: 'Greek yoghurt',
    quantity: 2,
    unit: 'cup',
    category: 'dairy',
    expiry_date: '2024-03-05',
  });
  assert.equal(created.status, 201);
  const id = created.body.item.id;

  const edited = await put(`/health/fridge/${id}`, { quantity: 1, is_favorite: true });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.item.quantity, 1);
  // Surfaced as a real boolean, not D1's raw 0/1 — the client renders it
  // directly and `0` is truthy in neither language by accident.
  assert.equal(edited.body.item.is_favorite, true);
  // A partial update must not blank the fields it did not mention.
  assert.equal(edited.body.item.name, 'Greek yoghurt');
  assert.equal(edited.body.item.expiry_date, '2024-03-05');

  const listed = await api('/health/fridge');
  assert.ok(listed.body.items.some((i) => i.id === id));

  const removed = await del(`/health/fridge/${id}`);
  assert.equal(removed.status, 200);

  const after = await api('/health/fridge');
  assert.ok(!after.body.items.some((i) => i.id === id), 'soft-deleted row still listed');
});

liveTest('HEALTH-LIVE-151: the expiry window is the SERVER’s answer, filtered by the client’s day', async () => {
  const soon = await post('/health/fridge', { name: 'Milk', expiry_date: '2024-03-03' });
  const later = await post('/health/fridge', { name: 'Rice', expiry_date: '2029-01-01' });
  assert.equal(soon.status, 201);
  assert.equal(later.status, 201);

  const { status, body } = await api(
    '/health/fridge?expiring_within_days=7&today=2024-03-01',
  );
  assert.equal(status, 200);
  const names = body.items.map((i) => i.name);
  assert.ok(names.includes('Milk'), 'an item two days out is inside a 7-day window');
  assert.ok(!names.includes('Rice'), 'an item five years out is not');
});

liveTest('HEALTH-LIVE-152: the expiry window rejects nonsense rather than guessing', async () => {
  assert.equal((await api('/health/fridge?expiring_within_days=-1')).status, 400);
  assert.equal((await api('/health/fridge?expiring_within_days=1.5')).status, 400);
  assert.equal((await api('/health/fridge?today=01-03-2024')).status, 400);
});

/* ------------------------------------------------------------------ */
/* Habits, cycle, activity — the rest of the migrated domain           */
/* ------------------------------------------------------------------ */

liveTest('HEALTH-LIVE-160: a habit is created and toggled for a day', async () => {
  const created = await post('/health/habits', { name: 'Stretch', icon: 'yoga' });
  assert.equal(created.status, 201);
  const id = created.body.habit.id;

  const on = await post(`/health/habits/${id}/toggle`, { date: DAY });
  assert.equal(on.status, 200);

  const off = await post(`/health/habits/${id}/toggle`, { date: DAY });
  assert.equal(off.status, 200);

  // Someone else's habit id must 404, not toggle.
  const foreign = await post('/health/habits/does-not-exist/toggle', { date: DAY });
  assert.equal(foreign.status, 404);
});

liveTest('HEALTH-LIVE-161: a workout session logs against the day', async () => {
  const { status, body } = await post('/health/entries/workouts', {
    date: DAY,
    workout_type: 'strength',
    minutes: 45,
    calories: 300,
  });
  assert.equal(status, 201);
  // A health entry is a typed envelope: the per-type payload lives in `data`,
  // serialised, so one table carries workouts, steps and everything after them.
  assert.equal(body.entry.entry_type, 'workout');
  assert.equal(JSON.parse(body.entry.data).minutes, 45);

  const listed = await api(`/health/entries?date=${DAY}`);
  assert.equal(listed.status, 200);
  const logged = listed.body.entries
    .filter((e) => e.entry_type === 'workout')
    .map((e) => JSON.parse(e.data));
  assert.ok(logged.some((d) => d.minutes === 45 && d.workout_type === 'strength'));
});

liveTest('HEALTH-LIVE-162: the day summary answers with every section', async () => {
  const { status, body } = await api(`/health/summary?date=${DAY}`);
  assert.equal(status, 200);
  // Sections, not a flat blob — the Home screen renders one card per section.
  for (const section of ['nutrition', 'water', 'steps']) {
    assert.ok(body.summary[section], `summary is missing "${section}"`);
  }
  assert.equal(body.summary.date, DAY);
  assert.equal(body.summary.nutrition.totals.calories, 905);
  assert.equal(body.summary.water.total_ml, 0);
  // The weigh-in HEALTH-LIVE-130 logged against this day, carried through with
  // its unit. Absent is not zero here either: a day with no weigh-in answers
  // `null`, and a day with no water answers a real 0 because water genuinely
  // was zero.
  assert.deepEqual(body.summary.weight, { date: DAY, unit: 'kg', value: 78.4 });
});

/* ------------------------------------------------------------------ */
/* Delta sync — the cursor must carry the NEW tables                   */
/* ------------------------------------------------------------------ */

liveTest('HEALTH-LIVE-170: sync returns a cursor and every migrated bucket', async () => {
  const { status, body } = await api('/health/sync?since=1970-01-01T00:00:00.000Z');
  assert.equal(status, 200);
  // `server_time` IS the cursor: the next call passes it back as `since`.
  assert.equal(typeof body.server_time, 'string');
  assert.equal(body.since, '1970-01-01T00:00:00.000Z');

  // The bug this catches: a domain gets a table and a route but is never added
  // to sync(), so a reinstalled device silently loses it.
  // Every table the migration added has to appear here. The bug this catches:
  // a domain gains a table and a route but is never wired into sync(), so a
  // reinstalled device silently loses it and nobody notices until a support
  // ticket says "my food diary is empty on my new phone".
  for (const bucket of [
    'weight_entries',
    'water_entries',
    'nutrition_entries',
    'body_measurements',
    'health_entries',
    'habits',
    'habit_logs',
    'period_entries',
    'cycle_symptom_entries',
    'mens_health_entries',
    'cycle_settings',
    'health_goals',
    'mens_health_settings',
    'widget_preferences',
    'activity_notification_preferences',
    'custom_foods',
    'recipes',
    'injuries',
    'fridge_items',
    'user_files',
  ]) {
    assert.ok(bucket in body, `sync did not return a "${bucket}" bucket`);
  }
  assert.ok(
    body.nutrition_entries.length >= 3,
    'the nutrition rows written above are not in the delta',
  );
});

liveTest('HEALTH-LIVE-171: a cursor from NOW returns an empty delta, not everything', async () => {
  const first = await api('/health/sync?since=1970-01-01T00:00:00.000Z');
  const cursor = first.body.cursor ?? first.body.server_time;
  const { status, body } = await api(`/health/sync?since=${encodeURIComponent(cursor)}`);
  assert.equal(status, 200);
  assert.deepEqual(body.nutrition_entries, [], 'the cursor did not advance');
});

/* ------------------------------------------------------------------ */
/* Isolation — the surface belongs to the signed-in user               */
/* ------------------------------------------------------------------ */

liveTest('HEALTH-LIVE-180: a second account sees NONE of the first account’s data', async () => {
  const authedAs = (path) =>
    req(BASE, path, { headers: { authorization: `Bearer ${otherToken}` } });

  const nutrition = await authedAs(`/health/nutrition/entries?date=${DAY}`);
  assert.equal(nutrition.status, 200);
  assert.deepEqual(nutrition.body.entries, [], 'nutrition leaked across accounts');

  const fridge = await authedAs('/health/fridge');
  assert.deepEqual(fridge.body.items, [], 'fridge leaked across accounts');

  const measurements = await authedAs('/health/measurements');
  assert.deepEqual(measurements.body.measurements, [], 'measurements leaked across accounts');

  // The catalogue is the one GLOBAL table — everyone sees all 88.
  const catalogue = await authedAs('/health/exercises?limit=200');
  assert.equal(catalogue.body.exercises.length, 88);
  // …but not the first account's favourites.
  const favourites = await authedAs('/health/exercises?favorites=true');
  assert.deepEqual(favourites.body.exercises, []);
});
