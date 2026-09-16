/**
 * Kaizen AI entitlement gates — `requireAIEntitlement()` on the three Kaizen AI
 * routers (`kaizenAi`, `kaizenBooks`, `kaizenCoachChat`).
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * Kaizen shipped with a kill-switch flag, a disclosure ack and a cost ceiling,
 * but with NO check on `can_use_ai`. A free member's turn therefore fell through
 * `resolveProviderApiKey` to the platform-managed OPENAI_API_KEY and billed the
 * platform. These tests pin the fix: with `aiRequiresAccess` armed, a member who
 * is neither paid nor BYOK-connected gets a clean denial and NO upstream request
 * is made — asserted by leaving `fetch` stubbed to throw.
 *
 * `aiRequiresAccess` DEFAULTS TO FALSE (soft launch — see featureFlagService
 * DEFAULT_FLAGS), so the "dormant by default" case is pinned too: the gate must
 * not break the current free-AI posture until the flag is flipped in KV.
 *
 * The non-AI books endpoints (`/:bookId/upload`, `/chapter-text`) carry NO gate
 * on purpose — reading a book you already imported spends no model call — and
 * that separation is asserted here so a future "just gate the whole router"
 * refactor fails loudly.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../../types';
import kaizenAiRoutes from '../kaizenAi';
import kaizenBooksRoutes from '../kaizenBooks';
import kaizenCoachChatRoutes from '../kaizenCoachChat';

import { createKaizenTables, resetKaizenTables } from './kaizen-test-helpers';

const testEnv = env as unknown as Env;
const KAIZEN_ENV = {
  ...testEnv,
  APP_BRAND: 'symply-kaizen',
  OPENAI_API_KEY: 'sk-test',
  GEMINI_API_KEY: 'gm-test',
} as Env;

const UID = 'u_kaizen_entitlement';
const FLAG_KV_KEY = 'feature-flags:v1';

async function mintToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(
    testEnv.JWT_SECRET || 'test-jwt-secret-32-chars-minimum'
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

function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/api/v1/ai/books', kaizenBooksRoutes);
  app.route('/api/v1/ai', kaizenAiRoutes);
  app.route('/api/v1/kaizen/coach-chat', kaizenCoachChatRoutes);
  return app;
}

function post(
  app: ReturnType<typeof mkApp>,
  path: string,
  token: string,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return app.request(
    path,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        ...headers,
      },
      body: JSON.stringify(body),
    },
    KAIZEN_ENV
  );
}

/** Arm / disarm the entitlement requirement via the same KV key getFlags reads. */
async function setAiRequiresAccess(value: boolean) {
  await KAIZEN_ENV.CONFIG_KV.put(
    FLAG_KV_KEY,
    JSON.stringify({
      flags: { aiRequiresAccess: value },
      version: 1,
      updatedAt: new Date().toISOString(),
    })
  );
}

/** Any upstream call at all is a failure once the gate should have denied. */
function forbidAllFetch() {
  const spy = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    throw new Error(`no upstream call expected, got: ${url}`);
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

let token: string;

beforeEach(async () => {
  await createKaizenTables(KAIZEN_ENV.DB);
  await resetKaizenTables(KAIZEN_ENV.DB);
  await KAIZEN_ENV.DB.prepare(
    'INSERT OR REPLACE INTO users (id, email, email_verified) VALUES (?, ?, 1)'
  )
    .bind(UID, `${UID}@example.com`)
    .run();
  token = await mintToken(UID);
  await KAIZEN_ENV.CONFIG_KV.delete(FLAG_KV_KEY);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await KAIZEN_ENV.CONFIG_KV.delete(FLAG_KV_KEY);
});

describe('Kaizen AI routes deny an unentitled member when aiRequiresAccess is armed', () => {
  beforeEach(async () => {
    await setAiRequiresAccess(true);
  });

  const cases: Array<{ name: string; path: string; body: unknown; headers?: Record<string, string> }> = [
    {
      name: 'analyze-career-resume',
      path: '/api/v1/ai/analyze-career-resume',
      body: { resumeText: 'ten years of backend work' },
    },
    {
      name: 'extract-kaizen-questions',
      path: '/api/v1/ai/extract-kaizen-questions',
      body: { documentText: 'What is a load balancer?' },
    },
    {
      name: 'score-interview-answer',
      path: '/api/v1/ai/score-interview-answer',
      body: { prompt: 'q', ideal_answer: 'a', rubric: [], answer_text: 'x' },
    },
    {
      name: 'build-skill-learning-plan',
      path: '/api/v1/ai/build-skill-learning-plan',
      body: { skill: 'Go', placement_band: 'foundation' },
    },
    {
      name: 'books/generate-questions',
      path: '/api/v1/ai/books/generate-questions',
      body: { bookTitle: 'Deep Work', chapterTitle: 'Ch 1' },
    },
    {
      name: 'books/grade-answer',
      path: '/api/v1/ai/books/grade-answer',
      body: { prompt: 'q', answerText: 'a' },
    },
    {
      name: 'coach-chat/messages',
      path: '/api/v1/kaizen/coach-chat/messages',
      body: { messages: [{ role: 'user', content: 'hi' }], disclosureAck: true },
      headers: { 'X-Kaizen-AI-Disclosure-Ack': '1' },
    },
  ];

  for (const testCase of cases) {
    it(`denies ${testCase.name} without spending a model call`, async () => {
      const fetchSpy = forbidAllFetch();
      const res = await post(mkApp(), testCase.path, token, testCase.body, testCase.headers);

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      const json = (await res.json()) as { error?: { code?: string } };
      expect(json.error?.code).toBe('ai_access_required');
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }

  it('still requires a token before it reports an entitlement denial', async () => {
    const res = await mkApp().request(
      '/api/v1/ai/analyze-career-resume',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resumeText: 'x' }),
      },
      KAIZEN_ENV
    );
    expect(res.status).toBe(401);
  });

  it('leaves the non-AI books endpoints reachable — reading is never gated', async () => {
    // `/chapter-text` reads R2 only. It must get past the entitlement layer and
    // fail on its OWN terms (ownership / not-found), never with ai_access_required.
    const res = await post(mkApp(), '/api/v1/ai/books/chapter-text', token, {
      contentKey: `books/${UID}/b1/ch1.txt`,
    });
    expect(res.status).not.toBe(402);
    const json = (await res.json()) as { error?: unknown };
    expect(JSON.stringify(json)).not.toContain('ai_access_required');
  });
});

/**
 * The admin allowlist (`config/admin-emails.ts`) short-circuits
 * `resolveAIEntitlement` AHEAD of the `aiRequiresAccess` check, so internal
 * accounts keep managed AI once the flag is armed. That path is now
 * load-bearing for E2E: the shared test account (a.tekhtelev@gmail.com) is on
 * the allowlist, so gated Kaizen flows must NOT start failing for it — and,
 * conversely, that account can never be used to verify the no-AI paths.
 */
describe('Kaizen AI routes exempt allowlisted admin accounts', () => {
  const ADMIN_UID = 'u_kaizen_admin';
  const ADMIN_EMAIL = 'a.tekhtelev@gmail.com';

  it('lets an admin through while a non-admin on the same flag is denied', async () => {
    await setAiRequiresAccess(true);
    await KAIZEN_ENV.DB.prepare(
      'INSERT OR REPLACE INTO users (id, email, email_verified) VALUES (?, ?, 1)'
    )
      .bind(ADMIN_UID, ADMIN_EMAIL)
      .run();

    const secret = new TextEncoder().encode(
      testEnv.JWT_SECRET || 'test-jwt-secret-32-chars-minimum'
    );
    const adminToken = await new jose.SignJWT({
      sub: ADMIN_UID,
      email: ADMIN_EMAIL,
      email_verified: true,
    } as unknown as jose.JWTPayload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .setIssuer(testEnv.JWT_ISSUER || 'simple-house')
      .setAudience(testEnv.JWT_AUDIENCE || 'simple-house-app')
      .sign(secret);

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
      )
    );

    const app = mkApp();
    const adminRes = await post(app, '/api/v1/ai/analyze-career-resume', adminToken, {
      resumeText: 'ten years of backend work',
    });
    const adminJson = (await adminRes.json()) as { error?: { code?: string } };
    expect(adminJson.error?.code).not.toBe('ai_access_required');

    // Same flag, same request, ordinary account → denied.
    const memberRes = await post(app, '/api/v1/ai/analyze-career-resume', token, {
      resumeText: 'ten years of backend work',
    });
    const memberJson = (await memberRes.json()) as { error?: { code?: string } };
    expect(memberJson.error?.code).toBe('ai_access_required');
  });
});

describe('Kaizen AI routes stay open while aiRequiresAccess is off (soft-launch default)', () => {
  it('does not deny when the flag is absent from KV', async () => {
    // No KV write at all → DEFAULT_FLAGS.aiRequiresAccess === false.
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
      )
    );
    const res = await post(mkApp(), '/api/v1/ai/analyze-career-resume', token, {
      resumeText: 'ten years of backend work',
    });
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).not.toBe('ai_access_required');
  });
});
