/**
 * Book Comprehension routes (Kaizen-only) — Phase 5 spoken grader + Phase 3
 * extract path HTTP coverage for `src/routes/kaizenBooks.ts`, mounted at
 * /api/v1/ai/books.
 *
 * The AI/file boundaries are mocked (`../../services/kaizen/books/bookSpeech`,
 * `gemini`, `geminiFiles`) so no request ever reaches Gemini. Auth is the real
 * authMiddleware fed a jose HS256 JWT whose `sub` becomes the user id — that
 * matters for the ownership guard (keys must start with `books/{userId}/`).
 * Credential resolution + the D1 cost guard run for real against the miniflare
 * bindings; the GEMINI_API_KEY managed key satisfies resolveProviderApiKey.
 *
 * Asserts:
 *   - grade-spoken: 400 when the audio part is missing; 400 when payload.prompt
 *     is missing; 200 happy path returns transcription + normalized scores +
 *     pronunciation + model (gradeSpokenAnswer mocked to a full result).
 *   - extract-toc: 200 happy path for an OWNED books/u_test/... key, with the
 *     Files API + BooksGemini + R2 object all mocked/seeded → { chapters }.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isKaizenApiEnabled } from '../../config/brand-capabilities';
// Real test-document fixtures (resourses/testing/*), inlined for the worker runtime.
import fixtures from '../../test-utils/fixtures';
import type { Env } from '../../types';

// Hoisted mock fns so each `new BooksGemini()` shares controllable spies and the
// spoken grader can be stubbed per-test.
const { gradeSpokenMock, generateStructuredWithFileMock, uploadMock, waitMock, deleteMock } =
  vi.hoisted(() => ({
    gradeSpokenMock: vi.fn(),
    generateStructuredWithFileMock: vi.fn(),
    uploadMock: vi.fn(),
    waitMock: vi.fn(),
    deleteMock: vi.fn(),
  }));

const MODEL = 'gemini-flash-latest';

vi.mock('../../services/kaizen/books/bookSpeech', () => ({
  gradeSpokenAnswer: gradeSpokenMock,
}));

vi.mock('../../services/kaizen/books/gemini', () => ({
  BooksAiError: class BooksAiError extends Error {},
  // Literal (not MODEL) — this factory is hoisted above the const declaration.
  BOOKS_GEMINI_MODEL: 'gemini-flash-latest',
  BooksGemini: class {
    generateStructured = vi.fn();
    generateStructuredWithFile = generateStructuredWithFileMock;
  },
}));

vi.mock('../../services/kaizen/books/geminiFiles', () => ({
  BooksFilesApiError: class BooksFilesApiError extends Error {},
  uploadToFilesApi: uploadMock,
  waitForFileActive: waitMock,
  deleteFile: deleteMock,
}));

// Imported after the mocks are registered.
import kaizenBooksRoutes from '../kaizenBooks';

const testEnv = env as unknown as Env;
const KAIZEN_ENV = {
  ...testEnv,
  APP_BRAND: 'symply-kaizen',
  GEMINI_API_KEY: 'test-gemini-key',
} as Env;

const UID = 'u_test';

const SPOKEN_RESULT = {
  transcription: 'The habit loop has four stages: cue, craving, response, and reward.',
  content_score: 0.9,
  overall_score: 0.85,
  feedback: 'Clear and correct.',
  mistakes: [{ type: 'grammar', severity: 'low', text: 'has', correction: 'have' }],
  pronunciation: {
    overall_score: 0.8,
    words: [{ word: 'cue', score: 0.95, is_problem: false, tip: '' }],
    breakdown: { phoneme: 0.8 },
  },
  delivery: { filler_count: 1, pace: 'steady', fluency_score: 0.78 },
};

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

function postJson(path: string, token: string | null, body: unknown, appEnv: Env) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return mkApp().request(path, { method: 'POST', headers, body: JSON.stringify(body) }, appEnv);
}

/** POST multipart/form-data. Omit `audio`/`payload` by passing undefined. */
function postForm(
  path: string,
  token: string | null,
  parts: { audio?: Blob; payload?: string },
  appEnv: Env,
) {
  const fd = new FormData();
  if (parts.audio !== undefined) fd.append('audio', parts.audio, 'answer.m4a');
  if (parts.payload !== undefined) fd.append('payload', parts.payload);
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  // NB: no Content-Type header — the FormData body sets the multipart boundary.
  return mkApp().request(path, { method: 'POST', headers, body: fd }, appEnv);
}

function audioBlob(): Blob {
  return new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/m4a' });
}

describe('kaizen books — spoken grading + extract', () => {
  let token: string;

  beforeEach(async () => {
    token = await mintToken(UID);
    gradeSpokenMock.mockReset();
    generateStructuredWithFileMock.mockReset();
    uploadMock.mockReset();
    waitMock.mockReset();
    deleteMock.mockReset();

    // Files API happy-path defaults for the extract test.
    uploadMock.mockResolvedValue({
      name: 'files/abc123',
      uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc123',
      mimeType: 'application/pdf',
      state: 'ACTIVE',
    });
    waitMock.mockResolvedValue(undefined);
    deleteMock.mockResolvedValue(undefined);
  });

  describe('POST /grade-spoken', () => {
    it('400s when the audio part is missing', async () => {
      const res = await postForm(
        '/api/v1/ai/books/grade-spoken',
        token,
        { payload: JSON.stringify({ prompt: 'Explain the habit loop.', language: 'en' }) },
        KAIZEN_ENV,
      );
      expect(res.status).toBe(400);
      expect(gradeSpokenMock).not.toHaveBeenCalled();
    });

    it('400s when payload.prompt is missing', async () => {
      const res = await postForm(
        '/api/v1/ai/books/grade-spoken',
        token,
        { audio: audioBlob(), payload: JSON.stringify({ language: 'en' }) },
        KAIZEN_ENV,
      );
      expect(res.status).toBe(400);
      expect(gradeSpokenMock).not.toHaveBeenCalled();
    });

    it('200s and returns transcription + normalized scores + pronunciation + model', async () => {
      gradeSpokenMock.mockResolvedValue(SPOKEN_RESULT);

      const res = await postForm(
        '/api/v1/ai/books/grade-spoken',
        token,
        {
          audio: audioBlob(),
          payload: JSON.stringify({
            prompt: 'Explain the habit loop.',
            idealAnswer: 'Cue, craving, response, reward.',
            rubric: ['names all four stages'],
            language: 'en',
          }),
        },
        KAIZEN_ENV,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.transcription).toBe(SPOKEN_RESULT.transcription);
      expect(body.content_score).toBe(0.9);
      expect(body.overall_score).toBe(0.85);
      expect(body.pronunciation.overall_score).toBe(0.8);
      expect(body.pronunciation.words[0].word).toBe('cue');
      expect(body.delivery.pace).toBe('steady');
      expect(body.model).toBe(MODEL);

      expect(gradeSpokenMock).toHaveBeenCalledTimes(1);
      // The route forwards the parsed prompt/idealAnswer/rubric to the grader.
      const [, , mime, gradeArgs] = gradeSpokenMock.mock.calls[0];
      expect(mime).toBe('audio/m4a');
      expect(gradeArgs.prompt).toBe('Explain the habit loop.');
      expect(gradeArgs.rubric).toEqual(['names all four stages']);
    });
  });

  describe('POST /extract-toc', () => {
    it('200s with chapters for an owned fileKey (Files API + R2 mocked)', async () => {
      const fileKey = `books/${UID}/b1/source.pdf`;
      // Seed a REAL 80KB PDF (kaizen-resume) as the R2 object the route fetches
      // and streams to the (mocked) Files API before extraction.
      await KAIZEN_ENV.REPORTS_BUCKET.put(fileKey, fixtures.fixtureBytes('kaizen-resume'));
      generateStructuredWithFileMock.mockResolvedValue({ chapters: [{ title: 'Ch 1' }] });

      const res = await postJson('/api/v1/ai/books/extract-toc', token, { fileKey }, KAIZEN_ENV);

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.chapters).toEqual([{ title: 'Ch 1' }]);

      // The full extraction pipeline ran: upload → wait → generate → delete.
      expect(uploadMock).toHaveBeenCalledTimes(1);
      expect(waitMock).toHaveBeenCalledTimes(1);
      expect(generateStructuredWithFileMock).toHaveBeenCalledTimes(1);
      expect(deleteMock).toHaveBeenCalledTimes(1);
    });
  });
});
