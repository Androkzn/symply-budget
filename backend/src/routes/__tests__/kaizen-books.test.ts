/**
 * Book Comprehension routes (Kaizen-only) — HTTP coverage for
 * `src/routes/kaizenBooks.ts`, mounted at /api/v1/ai/books.
 *
 * The AI/file boundary is mocked (`../../services/kaizen/books/gemini` +
 * `geminiFiles`) so no request ever reaches Gemini. Auth is the real
 * authMiddleware fed a jose HS256 JWT whose `sub` becomes the user id — that
 * matters because the ownership guard requires object keys to start with
 * `books/{userId}/`. Brand gate + mount replicate src/index.ts.
 *
 * Asserts:
 *   - brand 404 (non-Kaizen) + auth 401 (no token) gates
 *   - generate-questions 400 when bookTitle/chapterTitle missing
 *   - grade-answer 400 when prompt/answerText missing
 *   - extract-toc / extract-chapter / chapter-text 403 when the key is NOT
 *     owned (does not start with books/u_test/), and NOT 403 for an owned key
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isKaizenApiEnabled } from '../../config/brand-capabilities';
import type { Env } from '../../types';

// Mock the AI + Gemini Files boundaries so the router never hits the network.
// (The 400/403 paths return before these are used; the mock is a safety net.)
vi.mock('../../services/kaizen/books/gemini', () => ({
  BooksAiError: class BooksAiError extends Error {},
  BOOKS_GEMINI_MODEL: 'gemini-2.5-flash',
  BooksGemini: class {
    generateStructured = vi.fn();
    generateStructuredWithFile = vi.fn();
  },
}));

vi.mock('../../services/kaizen/books/geminiFiles', () => ({
  BooksFilesApiError: class BooksFilesApiError extends Error {},
  uploadToFilesApi: vi.fn(),
  waitForFileActive: vi.fn(),
  deleteFile: vi.fn(),
}));

// Imported after the mocks are registered.
import kaizenBooksRoutes from '../kaizenBooks';

const testEnv = env as unknown as Env;
const KAIZEN_ENV = {
  ...testEnv,
  APP_BRAND: 'symply-kaizen',
  GEMINI_API_KEY: 'test-gemini-key',
} as Env;
const HOUSE_ENV = { ...testEnv, APP_BRAND: 'symply-house', GEMINI_API_KEY: 'test-gemini-key' } as Env;

const UID = 'u_test';

async function mintToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(testEnv.JWT_SECRET || 'test-jwt-secret-32-chars-minimum');
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

// Replicates the src/index.ts brand gate (/api/v1/ai/*) + mount.
function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/v1/ai/*', async (c, next) => {
    if (!isKaizenApiEnabled(c.env)) {
      return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
    }
    return next();
  });
  app.route('/api/v1/ai/books', kaizenBooksRoutes);
  return app;
}

function post(path: string, token: string | null, body: unknown, appEnv: Env) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return mkApp().request(path, { method: 'POST', headers, body: JSON.stringify(body) }, appEnv);
}

describe('kaizen books routes', () => {
  let token: string;

  beforeEach(async () => {
    token = await mintToken(UID);
  });

  describe('brand gate + auth', () => {
    it('404s on a non-Kaizen brand', async () => {
      const res = await post('/api/v1/ai/books/generate-questions', token, {}, HOUSE_ENV);
      expect(res.status).toBe(404);
    });

    it('401s (not 404) on Kaizen without a token', async () => {
      const res = await post('/api/v1/ai/books/generate-questions', null, {}, KAIZEN_ENV);
      expect(res.status).toBe(401);
    });
  });

  describe('POST /generate-questions', () => {
    it('400s when bookTitle is missing', async () => {
      const res = await post(
        '/api/v1/ai/books/generate-questions',
        token,
        { chapterTitle: 'Chapter 1' },
        KAIZEN_ENV,
      );
      expect(res.status).toBe(400);
    });

    it('400s when chapterTitle is missing', async () => {
      const res = await post(
        '/api/v1/ai/books/generate-questions',
        token,
        { bookTitle: 'Atomic Habits' },
        KAIZEN_ENV,
      );
      expect(res.status).toBe(400);
    });
  });

  describe('POST /grade-answer', () => {
    it('400s when both prompt and answerText are missing', async () => {
      const res = await post('/api/v1/ai/books/grade-answer', token, {}, KAIZEN_ENV);
      expect(res.status).toBe(400);
    });

    it('400s when answerText is missing', async () => {
      const res = await post(
        '/api/v1/ai/books/grade-answer',
        token,
        { prompt: 'Explain the habit loop.' },
        KAIZEN_ENV,
      );
      expect(res.status).toBe(400);
    });
  });

  describe('ownership guard (books/{userId}/ prefix)', () => {
    it('extract-toc 403s when fileKey is not owned', async () => {
      const res = await post(
        '/api/v1/ai/books/extract-toc',
        token,
        { fileKey: 'books/someone_else/b1/source.pdf' },
        KAIZEN_ENV,
      );
      expect(res.status).toBe(403);
    });

    it('extract-toc 403s when fileKey is absent', async () => {
      const res = await post('/api/v1/ai/books/extract-toc', token, {}, KAIZEN_ENV);
      expect(res.status).toBe(403);
    });

    it('extract-chapter 403s when fileKey is not owned', async () => {
      const res = await post(
        '/api/v1/ai/books/extract-chapter',
        token,
        { fileKey: 'books/attacker/b1/source.pdf', chapterTitle: 'Chapter 1' },
        KAIZEN_ENV,
      );
      expect(res.status).toBe(403);
    });

    it('chapter-text 403s when contentKey is not owned', async () => {
      const res = await post(
        '/api/v1/ai/books/chapter-text',
        token,
        { contentKey: 'books/someone_else/b1/chapters/intro-1.txt' },
        KAIZEN_ENV,
      );
      expect(res.status).toBe(403);
    });

    it('does NOT 403 an owned key (ownership passes → 404 file-not-found from empty R2)', async () => {
      const res = await post(
        '/api/v1/ai/books/chapter-text',
        token,
        { contentKey: `books/${UID}/b1/chapters/intro-1.txt` },
        KAIZEN_ENV,
      );
      expect(res.status).not.toBe(403);
      expect(res.status).toBe(404);
    });
  });
});
