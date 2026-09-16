/**
 * Kaizen Coach Chat (Kaizen Master) — coverage for the ported
 * `src/routes/kaizenCoachChat.ts`.
 *
 * Pins the three server-side gates and one happy path:
 *   - brand 404 (non-Kaizen) / auth 401 (Kaizen, no token);
 *   - GATE 1 — kaizenAIScoring kill switch OFF => 403 ai_scoring_disabled;
 *   - GATE 2 — missing X-Kaizen-AI-Disclosure-Ack => 403 disclosure_required;
 *   - happy path — flag ON + ack header + provider stubbed => 200 assistant turn.
 *
 * The LLM boundary is the coach's OpenAI provider; we spy on
 * `OpenAIChatProvider.prototype.generate` (the same seam the aihousekeeper-chat
 * suite uses for ClaudeProvider) so no OpenAI request is ever made.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isKaizenApiEnabled } from '../../config/brand-capabilities';
import { OpenAIChatProvider } from '../../services/kaizen/coach-chat/providerAdapter';
import type { Env } from '../../types';
import kaizenCoachChatRoutes from '../kaizenCoachChat';

import { createKaizenTables, resetKaizenTables, setAiScoringFlag } from './kaizen-test-helpers';

const testEnv = env as unknown as Env;
const KAIZEN_ENV = { ...testEnv, APP_BRAND: 'symply-kaizen', OPENAI_API_KEY: 'sk-test' } as Env;
const HOUSE_ENV = { ...testEnv, APP_BRAND: 'symply-house', OPENAI_API_KEY: 'sk-test' } as Env;

const UID = 'u_kaizen_coach';
const PATH = '/api/v1/kaizen/coach-chat/messages';

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

function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/v1/kaizen/coach-chat/*', async (c, next) => {
    if (!isKaizenApiEnabled(c.env)) return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
    return next();
  });
  app.route('/api/v1/kaizen/coach-chat', kaizenCoachChatRoutes);
  return app;
}

const BODY = { messages: [{ role: 'user', content: 'How am I doing this week?' }] };

function post(
  app: ReturnType<typeof mkApp>,
  token: string | null,
  appEnv: Env,
  extraHeaders: Record<string, string> = {},
  body: unknown = BODY,
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  return app.request(PATH, { method: 'POST', headers, body: JSON.stringify(body) }, appEnv);
}

describe('life os coach chat', () => {
  beforeEach(async () => {
    await createKaizenTables(testEnv.DB);
    await resetKaizenTables(testEnv.DB);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('brand gate + auth', () => {
    it('404s on a non-Kaizen brand', async () => {
      const token = await mintToken(UID);
      const res = await post(mkApp(), token, HOUSE_ENV, { 'X-Kaizen-AI-Disclosure-Ack': '1' });
      expect(res.status).toBe(404);
    });

    it('401s (not 404) on Kaizen without a token', async () => {
      const res = await post(mkApp(), null, KAIZEN_ENV, { 'X-Kaizen-AI-Disclosure-Ack': '1' });
      expect(res.status).toBe(401);
    });
  });

  describe('GATE 1 — kaizenAIScoring kill switch', () => {
    it('403 ai_scoring_disabled when the flag is off', async () => {
      await setAiScoringFlag(testEnv.DB, false);
      const token = await mintToken(UID);
      const res = await post(mkApp(), token, KAIZEN_ENV, { 'X-Kaizen-AI-Disclosure-Ack': '1' });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('ai_scoring_disabled');
    });
  });

  describe('GATE 2 — disclosure acknowledgment', () => {
    it('403 disclosure_required when the ack header/flag is absent (flag on)', async () => {
      await setAiScoringFlag(testEnv.DB, true);
      const token = await mintToken(UID);
      const res = await post(mkApp(), token, KAIZEN_ENV); // no ack header, no disclosureAck in body
      expect(res.status).toBe(403);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('disclosure_required');
    });
  });

  describe('happy path (flag on + ack + provider stubbed)', () => {
    it('200s and returns the assistant turn', async () => {
      await setAiScoringFlag(testEnv.DB, true);
      const spy = vi.spyOn(OpenAIChatProvider.prototype, 'generate').mockResolvedValue({
        text: 'You logged 5 of 7 daily cores — strong week. Keep the momentum.',
        toolUses: [],
        stopReason: 'stop',
        usage: { prompt_tokens: 10, completion_tokens: 12, total_tokens: 22 },
        model: 'gpt-4o-mini',
      });

      const token = await mintToken(UID);
      const res = await post(mkApp(), token, KAIZEN_ENV, { 'X-Kaizen-AI-Disclosure-Ack': '1' });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        session_id: string;
        assistant_message: string;
        tool_results: unknown[];
        decision_trace: string[];
      };
      expect(body.assistant_message).toContain('strong week');
      expect(body.tool_results).toEqual([]);
      expect(body.session_id).toBeTruthy();
      expect(body.decision_trace[0]).toBe('finish:final');
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
