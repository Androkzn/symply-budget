/**
 * Kaizen AI routes (Kaizen-only) — coverage for the ported `src/routes/kaizenAi.ts`.
 *
 * The OpenAI boundary is the global `fetch` (both this router and the coach-chat
 * provider POST to https://api.openai.com/v1/chat/completions), so we stub
 * `fetch` with `vi.stubGlobal` — exactly the pattern in the expo-push suite — and
 * hand back a canned chat-completions envelope. No network, no OpenAI.
 *
 * Two representative endpoints are exercised (extract-kaizen-questions and
 * score-interview-answer), covering: the brand 404 + auth 401 gates, input
 * validation (400), the mapped success shape, and a strict-JSON / evaluator
 * failure surfacing as a 502 (never a crash).
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isKaizenApiEnabled } from '../../config/brand-capabilities';
import type { Env } from '../../types';
import kaizenAiRoutes from '../kaizenAi';

import { createKaizenTables, resetKaizenTables } from './kaizen-test-helpers';

const testEnv = env as unknown as Env;
const KAIZEN_ENV = { ...testEnv, APP_BRAND: 'symply-kaizen', OPENAI_API_KEY: 'sk-test' } as Env;
const HOUSE_ENV = { ...testEnv, APP_BRAND: 'symply-house', OPENAI_API_KEY: 'sk-test' } as Env;

const UID = 'u_kaizen_ai';

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
  app.use('/api/v1/ai/*', async (c, next) => {
    if (!isKaizenApiEnabled(c.env)) return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
    return next();
  });
  app.route('/api/v1/ai', kaizenAiRoutes);
  return app;
}

/** Stub the OpenAI chat-completions endpoint with a canned envelope. */
function stubOpenAI(content: string, extra: Record<string, unknown> = {}) {
  const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (!url.includes('api.openai.com')) throw new Error(`unexpected fetch: ${url}`);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
        system_fingerprint: 'fp_test',
        ...extra,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function post(app: ReturnType<typeof mkApp>, path: string, token: string | null, body: unknown, appEnv: Env) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return app.request(path, { method: 'POST', headers, body: JSON.stringify(body) }, appEnv);
}

describe('life os ai routes', () => {
  beforeEach(async () => {
    await createKaizenTables(testEnv.DB);
    await resetKaizenTables(testEnv.DB);
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('brand gate + auth', () => {
    it('404s on a non-Kaizen brand', async () => {
      const token = await mintToken(UID);
      const res = await post(mkApp(), '/api/v1/ai/extract-kaizen-questions', token, { documentText: 'x' }, HOUSE_ENV);
      expect(res.status).toBe(404);
    });

    it('401s (not 404) on Kaizen without a token', async () => {
      const res = await post(mkApp(), '/api/v1/ai/extract-kaizen-questions', null, { documentText: 'x' }, KAIZEN_ENV);
      expect(res.status).toBe(401);
    });
  });

  describe('POST /extract-kaizen-questions', () => {
    it('400s when documentText is missing', async () => {
      const token = await mintToken(UID);
      const res = await post(mkApp(), '/api/v1/ai/extract-kaizen-questions', token, {}, KAIZEN_ENV);
      expect(res.status).toBe(400);
    });

    it('returns the mapped { questions, model, system_fingerprint } shape on success', async () => {
      stubOpenAI(JSON.stringify({ questions: [{ prompt: 'What is a closure?', question_bank: 'technical' }] }));
      const token = await mintToken(UID);
      const res = await post(
        mkApp(),
        '/api/v1/ai/extract-kaizen-questions',
        token,
        { documentText: 'A doc about JS closures.' },
        KAIZEN_ENV,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { questions: Array<{ prompt: string }>; model: string; system_fingerprint: string };
      expect(body.questions).toHaveLength(1);
      expect(body.questions[0].prompt).toBe('What is a closure?');
      expect(body.model).toBe('gpt-4o-mini'); // LIFEOS_EXTRACTION_MODEL
      expect(body.system_fingerprint).toBe('fp_test');
    });

    it('502s when the provider returns non-JSON (strict-JSON parse failure, no crash)', async () => {
      stubOpenAI('sorry, I cannot do that'); // not JSON
      const token = await mintToken(UID);
      const res = await post(
        mkApp(),
        '/api/v1/ai/extract-kaizen-questions',
        token,
        { documentText: 'anything' },
        KAIZEN_ENV,
      );
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/invalid response/i);
    });
  });

  describe('POST /score-interview-answer', () => {
    const validInput = {
      prompt: 'Explain event loop',
      ideal_answer: 'The event loop schedules callbacks...',
      answer_text: 'It runs tasks and microtasks',
      rubric: [{ name: 'correctness', weight: 1 }],
    };

    it('400s when a required field is missing (ideal_answer)', async () => {
      const token = await mintToken(UID);
      const { ideal_answer, ...missing } = validInput;
      void ideal_answer;
      const res = await post(mkApp(), '/api/v1/ai/score-interview-answer', token, missing, KAIZEN_ENV);
      expect(res.status).toBe(400);
    });

    it('returns the validated judge payload on success', async () => {
      stubOpenAI(
        JSON.stringify({
          criterion_scores: { correctness: 4, clarity: 5 },
          overall_score: 4,
          reasoning: 'Covers the essentials with minor gaps.',
        }),
      );
      const token = await mintToken(UID);
      const res = await post(mkApp(), '/api/v1/ai/score-interview-answer', token, validInput, KAIZEN_ENV);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        criterion_scores: Record<string, number>;
        overall_score: number;
        reasoning: string;
        model: string;
      };
      expect(body.overall_score).toBe(4);
      expect(body.criterion_scores.correctness).toBe(4);
      expect(body.reasoning).toContain('essentials');
      expect(body.model).toBe('gpt-4o'); // LIFEOS_JUDGE_MODEL
    });

    it('502s when the judge payload fails the evaluator guard (scores out of range)', async () => {
      stubOpenAI(
        JSON.stringify({ criterion_scores: { correctness: 9 }, overall_score: 9, reasoning: 'nope' }),
      );
      const token = await mintToken(UID);
      const res = await post(mkApp(), '/api/v1/ai/score-interview-answer', token, validInput, KAIZEN_ENV);
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/invalid response/i);
    });
  });
});
