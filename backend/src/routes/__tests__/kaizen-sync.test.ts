/**
 * Kaizen sync (Kaizen-only) — route + data-plane coverage for the ported
 * `src/routes/sync.ts`.
 *
 * Two layers:
 *   1. HTTP layer through the real Hono router (auth + the src/index.ts brand
 *      gate replicated in mkApp): a non-Kaizen brand 404s every path; Kaizen
 *      without a token 401s; Kaizen + a valid JWT round-trips a POST.
 *   2. Data plane by calling the exported `processClientChanges` /
 *      `getServerChanges` directly against a live miniflare D1 — the two-phase
 *      parent/child upsert, the `updated_at > since` delta, and the ONE-WAY
 *      `scored_offline` upgrade on kaizen_interview_attempts.
 *
 * Harness mirrors appliances.test.ts / aihousekeeper-chat.test.ts: cloudflare:test
 * env, a jose HS256 JWT whose `sub` becomes the user id, and a local DDL helper
 * (kaizen-test-helpers) for the 22 kaizen_* tables.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import { isKaizenApiEnabled } from '../../config/brand-capabilities';
import type { Env } from '../../types';
import kaizenSyncRoutes, {
  getServerChanges,
  processClientChanges,
  type SyncRequest,
  type SyncResponse,
} from '../sync';

import { createKaizenTables, resetKaizenTables } from './kaizen-test-helpers';

const testEnv = env as unknown as Env;
const KAIZEN_ENV = { ...testEnv, APP_BRAND: 'symply-kaizen' } as Env;
const HOUSE_ENV = { ...testEnv, APP_BRAND: 'symply-house' } as Env;

const UID = 'u_kaizen_sync';

async function mintToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(testEnv.JWT_SECRET || 'test-jwt-secret-32-chars-minimum');
  return new jose.SignJWT({ sub: userId, email: `${userId}@example.com`, email_verified: true } as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .setIssuer(testEnv.JWT_ISSUER || 'simple-house')
    .setAudience(testEnv.JWT_AUDIENCE || 'simple-house-app')
    .sign(secret);
}

// Replicates the src/index.ts brand gate + mount for the sync surface.
function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/v1/sync', async (c, next) => {
    if (!isKaizenApiEnabled(c.env)) return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
    return next();
  });
  app.use('/api/v1/sync/*', async (c, next) => {
    if (!isKaizenApiEnabled(c.env)) return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
    return next();
  });
  app.route('/api/v1/sync', kaizenSyncRoutes);
  return app;
}

// A complete kaizen_actions entry (all NOT NULL columns present).
function action(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    user_id: UID,
    title: `Action ${id}`,
    system: 'career',
    rhythm: 'daily',
    is_daily_core: 0,
    sort_order: 0,
    time_of_day: 'anytime',
    watch_quick_log_enabled: 0,
    is_archived: 0,
    ...over,
  } as unknown as NonNullable<NonNullable<SyncRequest['changes']>['kaizen_actions']>[number];
}

function actionLog(id: string, actionId: string, over: Record<string, unknown> = {}) {
  return {
    id,
    user_id: UID,
    action_id: actionId,
    date: '2026-07-15',
    skipped: 0,
    source: 'manual',
    ...over,
  } as unknown as NonNullable<NonNullable<SyncRequest['changes']>['kaizen_action_logs']>[number];
}

// A complete kaizen_interview_attempts entry.
function attempt(id: string, scoredOffline: number, over: Record<string, unknown> = {}) {
  return {
    id,
    user_id: UID,
    question_id: 'q_1',
    attempted_at: '2026-07-15T10:00:00.000Z',
    answer_source: 'text',
    answer_text: 'my answer',
    is_baseline: 0,
    is_diagnostic: 0,
    scored_offline: scoredOffline,
    ...over,
  } as unknown as NonNullable<
    NonNullable<SyncRequest['changes']>['kaizen_interview_attempts']
  >[number];
}

async function readAttempt(id: string) {
  return testEnv.DB.prepare('SELECT id, overall_score, scored_offline FROM kaizen_interview_attempts WHERE id = ?')
    .bind(id)
    .first<{ id: string; overall_score: number | null; scored_offline: number }>();
}

describe('life os sync', () => {
  beforeEach(async () => {
    await createKaizenTables(testEnv.DB);
    await resetKaizenTables(testEnv.DB);
  });

  describe('brand gate + auth (HTTP)', () => {
    it('404s every sync request on a non-Kaizen brand', async () => {
      const token = await mintToken(UID);
      const res = await mkApp().request(
        '/api/v1/sync',
        { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}' },
        HOUSE_ENV,
      );
      expect(res.status).toBe(404);
    });

    it('401s (not 404) on Kaizen without a token', async () => {
      const res = await mkApp().request(
        '/api/v1/sync',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
        KAIZEN_ENV,
      );
      expect(res.status).toBe(401);
    });

    it('400s malformed JSON on Kaizen with a token', async () => {
      const token = await mintToken(UID);
      const res = await mkApp().request(
        '/api/v1/sync',
        { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: 'not json' },
        KAIZEN_ENV,
      );
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/sync round-trip (HTTP, authed, Kaizen)', () => {
    it('upserts a posted kaizen table and returns it via getServerChanges; nutrition tables are not processed', async () => {
      const token = await mintToken(UID);
      const body = {
        last_sync_at: null,
        changes: {
          kaizen_actions: [action('a_http_1', { title: 'Morning review' })],
          // Donor nutrition/health tables are NOT part of the ported subset.
          // An unknown key must be silently ignored, never processed/echoed back.
          nutrition_logs: [{ id: 'n1', user_id: UID, calories: 500 }],
        },
      };
      const res = await mkApp().request(
        '/api/v1/sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        },
        KAIZEN_ENV,
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as SyncResponse & Record<string, unknown>;
      expect(json.server_time).toBeTruthy();
      expect(json.changes.kaizen_actions.map((a) => a.id)).toContain('a_http_1');
      expect(json.changes.kaizen_actions[0].title).toBe('Morning review');
      // The nutrition key never appears in the (kaizen-only) server response.
      expect('nutrition_logs' in json.changes).toBe(false);
    });
  });

  describe('two-phase parent/child upsert', () => {
    it('persists parents and children in one call and preserves the child->parent link', async () => {
      await processClientChanges(testEnv.DB, UID, {
        kaizen_actions: [action('a1'), action('a2')],
        kaizen_action_logs: [actionLog('log1', 'a1'), actionLog('log2', 'a2')],
      });

      const changes = await getServerChanges(testEnv.DB, UID, null);
      expect(changes.kaizen_actions.map((a) => a.id).sort()).toEqual(['a1', 'a2']);
      expect(changes.kaizen_action_logs.map((l) => l.id).sort()).toEqual(['log1', 'log2']);

      const log1 = changes.kaizen_action_logs.find((l) => l.id === 'log1');
      expect(log1?.action_id).toBe('a1'); // child correctly references its parent
    });

    it('upsert is idempotent — re-posting the same id updates in place (no duplicate row)', async () => {
      await processClientChanges(testEnv.DB, UID, { kaizen_actions: [action('a1', { title: 'First' })] });
      await processClientChanges(testEnv.DB, UID, { kaizen_actions: [action('a1', { title: 'Second' })] });

      const changes = await getServerChanges(testEnv.DB, UID, null);
      const rows = changes.kaizen_actions.filter((a) => a.id === 'a1');
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe('Second');
    });
  });

  describe('getServerChanges delta (updated_at > since)', () => {
    it('returns rows for a since in the past and excludes them for a since in the future', async () => {
      await processClientChanges(testEnv.DB, UID, { kaizen_actions: [action('a_delta')] });

      const fromEpoch = await getServerChanges(testEnv.DB, UID, new Date('1970-01-01T00:00:00.000Z'));
      expect(fromEpoch.kaizen_actions.map((a) => a.id)).toContain('a_delta');

      const fromFuture = await getServerChanges(testEnv.DB, UID, new Date('2999-01-01T00:00:00.000Z'));
      expect(fromFuture.kaizen_actions).toHaveLength(0);
    });

    it('scopes changes to the authenticated user', async () => {
      await processClientChanges(testEnv.DB, UID, { kaizen_actions: [action('mine')] });
      await processClientChanges(testEnv.DB, 'someone_else', {
        kaizen_actions: [action('theirs', { user_id: 'someone_else' })],
      });

      const changes = await getServerChanges(testEnv.DB, UID, null);
      const ids = changes.kaizen_actions.map((a) => a.id);
      expect(ids).toContain('mine');
      expect(ids).not.toContain('theirs');
    });
  });

  describe('kaizen_interview_attempts — ONE-WAY scored_offline upgrade', () => {
    it('an AI score (scored_offline=0) overwrites an existing offline self-score (scored_offline=1)', async () => {
      // Offline self-score lands first (no AI grade yet).
      await processClientChanges(testEnv.DB, UID, {
        kaizen_interview_attempts: [attempt('att1', 1, { overall_score: null })],
      });
      expect(await readAttempt('att1')).toMatchObject({ scored_offline: 1, overall_score: null });

      // Authoritative AI score for the same attempt id upgrades the row.
      await processClientChanges(testEnv.DB, UID, {
        kaizen_interview_attempts: [attempt('att1', 0, { overall_score: 4.5, judge_model: 'gpt-4o' })],
      });
      expect(await readAttempt('att1')).toMatchObject({ scored_offline: 0, overall_score: 4.5 });
    });

    it('an offline self-score (scored_offline=1) does NOT overwrite an existing AI score (scored_offline=0)', async () => {
      // AI-scored attempt already stored.
      await processClientChanges(testEnv.DB, UID, {
        kaizen_interview_attempts: [attempt('att2', 0, { overall_score: 4.0 })],
      });
      expect(await readAttempt('att2')).toMatchObject({ scored_offline: 0, overall_score: 4.0 });

      // A later offline self-score for the same id must be ignored (WHERE guard).
      await processClientChanges(testEnv.DB, UID, {
        kaizen_interview_attempts: [attempt('att2', 1, { overall_score: 1.0 })],
      });
      expect(await readAttempt('att2')).toMatchObject({ scored_offline: 0, overall_score: 4.0 });
    });
  });
});
