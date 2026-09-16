/**
 * HEALTH-AI — the body-insight PRODUCER and the three READERS, driven together.
 *
 * ── THE SEAM THIS FILE OWNS ──────────────────────────────────────────────────
 *
 * `POST /health/ai/body-insights/generate` (routes/health-ai.ts) WRITES
 * `body_comprehensive_insights`. `GET /health/body-insights`, `/latest` and
 * `/photo` (routes/health-body-extras.ts) READ it. They live in two routers,
 * were built two parity phases apart, and until this file NOTHING drove them in
 * the same request sequence:
 *
 *   - `health-ai.test.ts` mounts the AI router alone and asserts what the
 *     producer wrote by querying D1 DIRECTLY with SQL;
 *   - `health-body-extras.test.ts` mounts the extras router alone and asserts
 *     the readers against rows it INSERTS with SQL.
 *
 * Both halves passing proves nothing about the pair. A producer that wrote a
 * column the reader filters on — `deleted_at`, the wrong `date` shape, a user id
 * that does not match — would leave every existing test green and the member
 * with a summary that vanishes the moment the screen reloads. That is not
 * hypothetical: the reason these readers had no client caller for two phases is
 * exactly that nobody had ever seen a produced row come back out.
 *
 * So this file mounts BOTH routers on one app, produces through the real route,
 * and reads back through the real route.
 *
 * ── WHAT IS DELIBERATELY NOT DUPLICATED ──────────────────────────────────────
 *
 * The readers' own contract — auth, brand gate, cross-user isolation, `?from`,
 * `?to`, `?limit`, `?photo_id` — belongs to `health-body-extras.test.ts` and is
 * not repeated here. What is here is only what needs BOTH sides.
 *
 * THE MODEL IS ALWAYS MOCKED. `ai/provider-factory` is replaced wholesale.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../../types';
import healthAiRoutes from '../health-ai';
import healthBodyExtrasRoutes from '../health-body-extras';

import {
  createBodyExtrasTables,
  createHealthAiTables,
  createHealthTables,
  resetBodyExtrasTables,
  resetHealthAiTables,
  resetHealthTables,
  seedHealthUsers,
} from './health-test-helpers';

/* ------------------------- provider + entitlement mocks ------------------ */

/** Scripted `generateStructured()` answers — the producer's only model path. */
let structuredQueue: Array<unknown | Error> = [];
let providerAvailable = true;

vi.mock('../../ai/provider-factory', () => ({
  createAnthropicAdapterForUser: async () => ({
    name: 'mock',
    isAvailable: () => providerAvailable,
    generate: async () => ({
      content: [{ type: 'text', text: 'ok' }],
      stopReason: 'end_turn',
      model: 'mock',
    }),
    generateStructured: async <T,>(): Promise<T> => {
      const next = structuredQueue.shift();
      if (next instanceof Error) throw next;
      return (next ?? { observations: [], what_to_log_next: [] }) as T;
    },
  }),
}));

vi.mock('../../services/entitlement-service', () => ({
  assertCanUseAI: async () => ({ allowed: true, source: 'simplehouse', provider: 'anthropic' }),
}));

/* ------------------------------- harness -------------------------------- */

const testEnv = env as unknown as Env;
const HEALTH_ENV = { ...testEnv, APP_BRAND: 'symply-health' } as Env;

const UID_A = 'u_bi_alice';
const UID_B = 'u_bi_bob';
const TODAY = '2026-07-25';
const YESTERDAY = '2026-07-24';

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

/**
 * BOTH routers on ONE app, at the shared `/health` prefix — the mount the
 * deployed Worker actually has. Driving the producer and the readers through the
 * same app is the entire point of this file.
 */
function appFor(bindings: Env) {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/health', healthAiRoutes);
  app.route('/health', healthBodyExtrasRoutes);
  return (path: string, init?: RequestInit) =>
    app.request(`http://local/health${path}`, init, bindings);
}

let tokenA = '';
let tokenB = '';

function call(path: string, init: RequestInit = {}, opts: { token?: string | null } = {}) {
  const token = opts.token === undefined ? tokenA : opts.token;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return appFor(HEALTH_ENV)(path, { ...init, headers });
}

function post(path: string, body: unknown, opts?: { token?: string | null }) {
  return call(path, { method: 'POST', body: JSON.stringify(body) }, opts);
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function grantConsent(token: string) {
  const res = await call(
    '/ai/coach/consent',
    { method: 'PUT', body: JSON.stringify({ granted: true }) },
    { token }
  );
  expect(res.status).toBe(200);
}

async function seedMeasurement(
  userId: string,
  date: string,
  waist: number,
  chest: number
): Promise<void> {
  await testEnv.DB.prepare(
    `INSERT INTO body_measurements (id, user_id, date, waist, chest, unit, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'cm', ?, ?)`
  )
    .bind(`bm_${userId}_${date}`, userId, date, waist, chest, `${date}T08:00:00.000Z`, `${date}T08:00:00.000Z`)
    .run();
}

interface InsightRow {
  id: string;
  date: string;
  strengths: string | null;
  areas_of_improvement: string | null;
  recommended_focus_areas: string | null;
  analysis_provider: string | null;
  analysis_confidence: number | null;
  processing_notes: string | null;
}

beforeEach(async () => {
  await createHealthTables(testEnv.DB);
  await createBodyExtrasTables(testEnv.DB);
  await createHealthAiTables(testEnv.DB);
  await resetHealthAiTables(testEnv.DB);
  await resetBodyExtrasTables(testEnv.DB);
  await resetHealthTables(testEnv.DB);
  await seedHealthUsers(testEnv.DB, [UID_A, UID_B]);
  tokenA = await mintToken(UID_A);
  tokenB = await mintToken(UID_B);
  structuredQueue = [];
  providerAvailable = true;
});

/* ==================================================================== */
/* Producer → reader                                                    */
/* ==================================================================== */

describe('Symply Health — body insight, producer to reader', () => {
  it('HEALTH-AI-584: a produced summary comes back out of GET /body-insights', async () => {
    await grantConsent(tokenA);
    await seedMeasurement(UID_A, '2026-06-01', 88, 100);
    await seedMeasurement(UID_A, '2026-07-01', 86.6, 101);

    const made = await post('/ai/body-insights/generate', { date: TODAY });
    expect(made.status).toBe(200);
    const produced = await json<{ insight: { id: string } }>(made);
    expect(produced.insight.id).toBeTruthy();

    // …and the reader in the OTHER router finds exactly that row.
    const read = await call('/body-insights');
    expect(read.status).toBe(200);
    const list = await json<{ insights: InsightRow[] }>(read);
    expect(list.insights).toHaveLength(1);
    expect(list.insights[0].id).toBe(produced.insight.id);
    expect(list.insights[0].date).toBe(TODAY);
  });

  it('HEALTH-AI-585: /latest answers with the row the producer just wrote', async () => {
    // The route the Body tab opens on. It exists precisely so a card does not
    // have to pull a whole history to render one thing, which makes "does the
    // newest produced row actually surface here" the question worth asking.
    await grantConsent(tokenA);
    await seedMeasurement(UID_A, '2026-06-01', 88, 100);
    await seedMeasurement(UID_A, '2026-07-01', 86.6, 101);

    await post('/ai/body-insights/generate', { date: YESTERDAY });
    const newest = await json<{ insight: { id: string } }>(
      await post('/ai/body-insights/generate', { date: TODAY })
    );

    const latest = await json<{ insight: InsightRow | null }>(await call('/body-insights/latest'));
    expect(latest.insight?.id).toBe(newest.insight.id);
    expect(latest.insight?.date).toBe(TODAY);
  });

  it('HEALTH-AI-586: the JSON-array columns survive the round trip as PARSEABLE arrays', async () => {
    // `strengths`, `areas_of_improvement` and `recommended_focus_areas` are TEXT
    // columns holding JSON (migration 0120). The producer stringifies; the
    // reader hands the column back untouched, and the client parses. A producer
    // that stored a bare array — or a reader that double-encoded — would render
    // the summary as one long "[\"…\"]" string on the card.
    await grantConsent(tokenA);
    await seedMeasurement(UID_A, '2026-06-01', 88, 100);
    await seedMeasurement(UID_A, '2026-07-01', 86.6, 101);
    // One site has two readings and one has a single one, so all three columns
    // are non-empty.
    await seedMeasurement(UID_A, '2026-07-02', 86.6, 101);

    await post('/ai/body-insights/generate', { date: TODAY });
    const list = await json<{ insights: InsightRow[] }>(await call('/body-insights'));
    const row = list.insights[0];

    for (const col of ['strengths', 'areas_of_improvement', 'recommended_focus_areas'] as const) {
      const raw = row[col];
      expect(typeof raw, col).toBe('string');
      const parsed: unknown = JSON.parse(String(raw));
      expect(Array.isArray(parsed), col).toBe(true);
      for (const item of parsed as unknown[]) expect(typeof item, col).toBe('string');
    }
    expect(JSON.parse(String(row.strengths)).join(' ')).toMatch(/waist/i);
  });

  it('HEALTH-AI-587: regenerating REPLACES the day as the reader sees it, never accumulates', async () => {
    // `body_comprehensive_insights` carries only a NON-unique (user_id, date)
    // index — the donor's unique-per-day index was not ported — so the
    // "reuse today's id" step in the producer is the only thing standing between
    // an impatient double tap and a history showing four subtly different
    // summaries for one day. That is a reader-visible fact, so it is asserted
    // through the reader.
    await grantConsent(tokenA);
    await seedMeasurement(UID_A, '2026-06-01', 88, 100);
    await seedMeasurement(UID_A, '2026-07-01', 86.6, 101);

    const first = await json<{ insight: { id: string } }>(
      await post('/ai/body-insights/generate', { date: TODAY })
    );
    const second = await json<{ insight: { id: string } }>(
      await post('/ai/body-insights/generate', { date: TODAY })
    );
    expect(second.insight.id).toBe(first.insight.id);

    const list = await json<{ insights: InsightRow[] }>(await call('/body-insights'));
    expect(list.insights).toHaveLength(1);
  });

  it('HEALTH-AI-588: the reader reports WHICH writer produced the prose', async () => {
    // A reader is entitled to know whether they are reading the deterministic
    // arithmetic or a model's rewrite of it. `analysis_provider` is that signal,
    // and it must survive the round trip in both states or the client cannot
    // tell them apart.
    await grantConsent(tokenA);
    await seedMeasurement(UID_A, '2026-06-01', 88, 100);
    await seedMeasurement(UID_A, '2026-07-01', 86.6, 101);

    // 1 — no credential at all: deterministic, and it says so.
    providerAvailable = false;
    await post('/ai/body-insights/generate', { date: YESTERDAY });
    let list = await json<{ insights: InsightRow[] }>(await call('/body-insights'));
    expect(list.insights[0].analysis_provider).toBe('deterministic');

    // 2 — a model whose every sentence is grounded: tagged as AI-written.
    providerAvailable = true;
    structuredQueue = [
      {
        observations: ['Your waist reads 86.6 cm now, down from 88.'],
        what_to_log_next: [],
      },
    ];
    await post('/ai/body-insights/generate', { date: TODAY });
    list = await json<{ insights: InsightRow[] }>(await call('/body-insights'));
    // Newest first, so today's row is at the head.
    expect(list.insights[0].date).toBe(TODAY);
    expect(list.insights[0].analysis_provider).toBe('symply-health-coach');
  });

  it('HEALTH-AI-589: a produced row is NEVER visible to another member', async () => {
    // The producer takes its user id from the token, and the reader filters on
    // its own. Proving the pair rules out the one shape neither suite alone can:
    // a producer that stamped the wrong id would look correct in isolation.
    await grantConsent(tokenA);
    await seedMeasurement(UID_A, '2026-06-01', 88, 100);
    await seedMeasurement(UID_A, '2026-07-01', 86.6, 101);
    await post('/ai/body-insights/generate', { date: TODAY });

    const theirs = await json<{ insights: InsightRow[] }>(
      await call('/body-insights', {}, { token: tokenB })
    );
    expect(theirs.insights).toEqual([]);
    const theirLatest = await json<{ insight: InsightRow | null }>(
      await call('/body-insights/latest', {}, { token: tokenB })
    );
    expect(theirLatest.insight).toBeNull();
  });

  it('HEALTH-AI-590: a REFUSED generation leaves the readers empty rather than writing a blank row', async () => {
    // With nothing measured the producer 422s. A blank row written anyway would
    // give the Body tab a summary that says nothing, which reads as "the app
    // looked and found nothing about you" rather than "you have not measured
    // yourself yet".
    await grantConsent(tokenA);

    const res = await post('/ai/body-insights/generate', { date: TODAY });
    expect(res.status).toBe(422);
    expect((await json<{ error: { code: string } }>(res)).error.code).toBeTruthy();

    expect((await json<{ insights: InsightRow[] }>(await call('/body-insights'))).insights).toEqual(
      []
    );
    expect(
      (await json<{ insight: InsightRow | null }>(await call('/body-insights/latest'))).insight
    ).toBeNull();
  });

  it('HEALTH-AI-591: the PHOTO reader stays empty — the producer writes no photo analysis', async () => {
    // `/body-insights/photo` reads `body_photo_insights`, and body photos are
    // deliberately unported. This guard is what fails if a future producer
    // starts writing that table without a matching decision: an empty list is
    // the POSTURE, not an accident, and it is the one assertion that would go
    // red the day it changes.
    await grantConsent(tokenA);
    await seedMeasurement(UID_A, '2026-06-01', 88, 100);
    await seedMeasurement(UID_A, '2026-07-01', 86.6, 101);
    await post('/ai/body-insights/generate', { date: TODAY });

    const res = await call('/body-insights/photo');
    expect(res.status).toBe(200);
    expect((await json<{ insights: unknown[] }>(res)).insights).toEqual([]);
  });

  it('HEALTH-AI-592: every score and estimate is still null AS THE READER SEES IT', async () => {
    // `HEALTH-AI-172` asserts this on the stored row with raw SQL. The same fact
    // has to hold on the wire, because the reader is what a client renders — a
    // column that is null in D1 but defaulted to 0 by a serialiser would put a
    // body-fat figure of 0% on a health screen.
    await grantConsent(tokenA);
    await seedMeasurement(UID_A, '2026-06-01', 88, 100);
    await seedMeasurement(UID_A, '2026-07-01', 86.6, 101);
    await post('/ai/body-insights/generate', { date: TODAY });

    const row = (await json<{ insights: Array<Record<string, unknown>> }>(
      await call('/body-insights')
    )).insights[0];

    for (const col of [
      'overall_posture_score',
      'overall_symmetry_score',
      'muscle_balance_score',
      'body_fat_estimate_lower',
      'body_fat_estimate_upper',
      'body_fat_category',
      'lean_mass_estimate',
      'front_photo_id',
      'back_photo_id',
      'left_side_photo_id',
      'right_side_photo_id',
    ]) {
      expect(row[col], col).toBeNull();
    }
    expect(String(row.processing_notes)).toMatch(/No photograph was used/);
  });

  it('HEALTH-AI-593: the readers are READ-ONLY — there is no client write path to the table', async () => {
    // The producer is the only writer, and it decides what the row says from the
    // member's own rows. A device that could POST an "AI analysis" would be
    // indistinguishable from it, which is why these three paths answer only GET.
    for (const path of ['/body-insights', '/body-insights/latest', '/body-insights/photo']) {
      const posted = await post(path, { strengths: '["I am in perfect health"]' });
      expect([404, 405], `POST ${path}`).toContain(posted.status);

      const deleted = await call(path, { method: 'DELETE' });
      expect([404, 405], `DELETE ${path}`).toContain(deleted.status);
    }
  });
});
