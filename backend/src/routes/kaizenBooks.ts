/**
 * Book Comprehension & Retention routes (Kaizen-only).
 *
 * Mounted at `/api/v1/ai/books` and brand-gated to `symply-kaizen` by the
 * existing `/api/v1/ai/*` guard in src/index.ts. These endpoints are STATELESS
 * (like the sibling /api/v1/ai/* Kaizen endpoints): the mobile app owns the
 * book/chapter/question/attempt data in its local-first `kaizen_book_*` tables
 * and syncs them via /api/v1/sync — here we only run the LLM and return JSON.
 *
 * Provider: Gemini 2.5 Flash (structured JSON) — see services/kaizen/books/.
 *
 * Phase 2 endpoints:
 *   POST /generate-questions  — MCQ + open + spoken comprehension questions
 *   POST /grade-answer        — two-layer (meaning + form) grading of an answer
 * (Phase 3 adds upload + on-demand chapter extraction; Phase 5 adds /grade-spoken.)
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { rateLimitDO } from '../middleware/rate-limit';
import { requireAIEntitlement } from '../middleware/require-ai-entitlement';
import {
  resolveProviderApiKey,
  resolveSelectedModelForProvider,
} from '../services/ai-credential-resolver';
import { kaizenCostGuard } from '../services/kaizen/ai/costGuards';
import { gradeSpokenAnswer } from '../services/kaizen/books/bookSpeech';
import { BooksGemini, BooksAiError, BOOKS_GEMINI_MODEL } from '../services/kaizen/books/gemini';
import {
  uploadToFilesApi,
  waitForFileActive,
  deleteFile,
  BooksFilesApiError,
} from '../services/kaizen/books/geminiFiles';
import {
  buildBookQuestionsPrompt,
  bookQuestionsSchema,
  buildBookGradingPrompt,
  bookGradingSchema,
  buildTocPrompt,
  bookTocSchema,
  buildChapterExtractPrompt,
  bookChapterTextSchema,
  normalizeScore,
  type BookQuestionType,
} from '../services/kaizen/books/prompts';
import type { Env } from '../types';


const books = new Hono<{ Bindings: Env }>();

books.use('*', authMiddleware());

const booksRateLimit = rateLimitDO('kaizen:ai');

/**
 * AI entitlement is applied PER ROUTE, not router-wide, on purpose: uploading a
 * book to R2 (`/:bookId/upload`) and reading an already-extracted chapter
 * (`/chapter-text`, reader mode) spend no model call and must keep working for
 * a free user with no key. Only the five model-spending endpoints below carry
 * the gate.
 */
const requiresAI = requireAIEntitlement();

const VALID_TYPES: BookQuestionType[] = ['mcq', 'open', 'spoken'];
const MAX_CHAPTER_TEXT = 200_000;
const MAX_ANSWER_CHARS = 20_000;
const MAX_SPOKEN_AUDIO_BYTES = 12 * 1024 * 1024; // 12 MB spoken-answer recording cap

// ---------------------------------------------------------------------------
// POST /generate-questions
// ---------------------------------------------------------------------------
books.post('/generate-questions', booksRateLimit, requiresAI, async (c) => {
  const body = (await c.req.json().catch(() => null)) as any;

  const bookTitle = typeof body?.bookTitle === 'string' ? body.bookTitle.trim() : '';
  const chapterTitle = typeof body?.chapterTitle === 'string' ? body.chapterTitle.trim() : '';
  if (!bookTitle || !chapterTitle) {
    return c.json({ error: 'bookTitle and chapterTitle are required' }, 400);
  }

  const userId = c.get('user').sub;
  const { apiKey } = await resolveProviderApiKey(c.env, userId, 'gemini');
  if (!apiKey) {
    return c.json({ error: 'AI service not configured' }, 503);
  }
  const model = (await resolveSelectedModelForProvider(c.env, userId, 'gemini')) ?? BOOKS_GEMINI_MODEL;

  const guard = await kaizenCostGuard(c, userId, 'assessmentTurn');
  if (!guard.allowed) {
    return c.json({ error: 'Daily question-generation quota exceeded', degraded: true }, 429);
  }

  const requestedTypes: BookQuestionType[] = Array.isArray(body?.types)
    ? body.types.filter((t: unknown): t is BookQuestionType =>
        VALID_TYPES.includes(t as BookQuestionType),
      )
    : [];
  const types = requestedTypes.length ? requestedTypes : (['mcq', 'open', 'spoken'] as BookQuestionType[]);

  const count = Math.min(Math.max(Number(body?.count) || 5, 1), 20);
  const language = typeof body?.language === 'string' && body.language ? body.language : 'en';
  const chapterText =
    typeof body?.chapterText === 'string' ? body.chapterText.slice(0, MAX_CHAPTER_TEXT) : null;
  const tocContext = typeof body?.tocContext === 'string' ? body.tocContext : null;
  const author = typeof body?.author === 'string' ? body.author : null;
  const highlights = Array.isArray(body?.highlights)
    ? body.highlights.filter((h: unknown): h is string => typeof h === 'string').slice(0, 20)
    : undefined;

  const prompt = buildBookQuestionsPrompt({
    bookTitle,
    author,
    chapterTitle,
    chapterText,
    tocContext,
    types,
    count,
    language,
    highlights,
  });

  try {
    const gemini = new BooksGemini(apiKey, { model });
    const result = await gemini.generateStructured(prompt, bookQuestionsSchema);

    // Sanitise MCQ answer_index against its options.
    const questions = result.questions
      .filter((q) => q.prompt && q.prompt.trim().length > 0)
      .map((q) => {
        if (q.type === 'mcq') {
          const options = Array.isArray(q.options) ? q.options : [];
          let idx = typeof q.answer_index === 'number' ? q.answer_index : 0;
          if (idx < 0 || idx >= options.length) idx = 0;
          return { ...q, options, answer_index: idx };
        }
        return q;
      });

    return c.json({ questions, model });
  } catch (e) {
    if (e instanceof BooksAiError) {
      console.error('[books/generate-questions] AI error:', e.message);
      return c.json({ error: 'Question generation failed', details: e.message }, 502);
    }
    console.error('[books/generate-questions] error:', e);
    return c.json({ error: 'Question generation failed', details: String(e) }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /grade-answer  (two-layer: meaning + form)
// ---------------------------------------------------------------------------
books.post('/grade-answer', booksRateLimit, requiresAI, async (c) => {
  const body = (await c.req.json().catch(() => null)) as any;

  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  const answerText =
    typeof body?.answerText === 'string' ? body.answerText.trim().slice(0, MAX_ANSWER_CHARS) : '';
  if (!prompt || !answerText) {
    return c.json({ error: 'prompt and answerText are required' }, 400);
  }

  const userId = c.get('user').sub;
  const { apiKey } = await resolveProviderApiKey(c.env, userId, 'gemini');
  if (!apiKey) {
    return c.json({ error: 'AI service not configured' }, 503);
  }
  const model = (await resolveSelectedModelForProvider(c.env, userId, 'gemini')) ?? BOOKS_GEMINI_MODEL;

  const guard = await kaizenCostGuard(c, userId, 'scoring');
  if (!guard.allowed) {
    return c.json({ error: 'Daily grading quota exceeded', degraded: true }, 429);
  }

  const idealAnswer = typeof body?.idealAnswer === 'string' ? body.idealAnswer : null;
  const rubric = Array.isArray(body?.rubric)
    ? body.rubric.filter((r: unknown): r is string => typeof r === 'string')
    : null;
  const language = typeof body?.language === 'string' && body.language ? body.language : 'en';

  const gradingPrompt = buildBookGradingPrompt({
    prompt,
    idealAnswer,
    rubric,
    answerText,
    language,
  });

  try {
    const gemini = new BooksGemini(apiKey, { model });
    const result = await gemini.generateStructured(gradingPrompt, bookGradingSchema);
    return c.json({
      content_score: normalizeScore(result.content_score),
      overall_score: normalizeScore(result.overall_score),
      feedback: result.feedback,
      mistakes: result.mistakes ?? [],
      stronger_answer: result.stronger_answer ?? null,
      model,
    });
  } catch (e) {
    if (e instanceof BooksAiError) {
      console.error('[books/grade-answer] AI error:', e.message);
      return c.json({ error: 'Grading failed', details: e.message }, 502);
    }
    console.error('[books/grade-answer] error:', e);
    return c.json({ error: 'Grading failed', details: String(e) }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /grade-spoken  (two-layer grading of a SPOKEN answer, from audio)
// ---------------------------------------------------------------------------
books.post('/grade-spoken', booksRateLimit, requiresAI, async (c) => {
  const userId = c.get('user').sub;

  const { apiKey } = await resolveProviderApiKey(c.env, userId, 'gemini');
  if (!apiKey) {
    return c.json({ error: 'AI service not configured' }, 503);
  }
  const model = (await resolveSelectedModelForProvider(c.env, userId, 'gemini')) ?? BOOKS_GEMINI_MODEL;

  let form: Record<string, string | File>;
  try {
    form = await c.req.parseBody();
  } catch {
    return c.json({ error: 'Invalid multipart form' }, 400);
  }

  const audio = form.audio;
  if (!audio || typeof audio === 'string') {
    return c.json({ error: 'audio is required' }, 400);
  }
  if (audio.size > MAX_SPOKEN_AUDIO_BYTES) {
    return c.json({ error: 'Audio too large (max 12MB)' }, 413);
  }

  let payload: any;
  try {
    payload = typeof form.payload === 'string' ? JSON.parse(form.payload) : null;
  } catch {
    return c.json({ error: 'Invalid payload JSON' }, 400);
  }
  const prompt = typeof payload?.prompt === 'string' ? payload.prompt.trim() : '';
  if (!prompt) {
    return c.json({ error: 'prompt is required' }, 400);
  }
  const idealAnswer = typeof payload?.idealAnswer === 'string' ? payload.idealAnswer : null;
  const rubric = Array.isArray(payload?.rubric)
    ? payload.rubric.filter((r: unknown): r is string => typeof r === 'string')
    : null;
  const language = typeof payload?.language === 'string' ? payload.language : '';

  const guard = await kaizenCostGuard(c, userId, 'scoring');
  if (!guard.allowed) {
    return c.json({ error: 'Daily grading quota exceeded', degraded: true }, 429);
  }

  try {
    const bytes = await (audio as File).arrayBuffer();
    const mime = (audio as File).type || 'audio/m4a';
    const r = await gradeSpokenAnswer(apiKey, bytes, mime, {
      prompt,
      idealAnswer,
      rubric,
      language: language || 'en',
      model,
    });
    return c.json({
      transcription: r.transcription,
      content_score: normalizeScore(r.content_score),
      overall_score: normalizeScore(r.overall_score),
      feedback: r.feedback,
      mistakes: r.mistakes ?? [],
      pronunciation: {
        overall_score: normalizeScore(r.pronunciation?.overall_score),
        words: r.pronunciation?.words ?? [],
        breakdown: r.pronunciation?.breakdown,
      },
      delivery: r.delivery ?? {},
      model,
    });
  } catch (e) {
    if (e instanceof BooksAiError) {
      console.error('[books/grade-spoken] AI error:', e.message);
      return c.json({ error: 'Spoken grading failed', details: e.message }, 502);
    }
    console.error('[books/grade-spoken] error:', e);
    return c.json({ error: 'Spoken grading failed', details: String(e) }, 500);
  }
});

// ---------------------------------------------------------------------------
// Phase 3 — upload + on-demand per-chapter extraction (PDF, Gemini Files API)
// ---------------------------------------------------------------------------

const MAX_UPLOAD_BYTES = 40 * 1024 * 1024; // 40 MB book PDF cap
const MAX_EXTRACT_TEXT = 200_000;

/** Object keys are user-scoped (`books/{userId}/...`) — enforce ownership. */
function ownsKey(key: unknown, userId: string): key is string {
  return typeof key === 'string' && key.startsWith(`books/${userId}/`);
}

/** Fetch a PDF from R2, run one grounded extraction, then delete the Gemini file. */
async function runPdfExtraction<S extends z.ZodTypeAny>(
  apiKey: string,
  pdf: ArrayBuffer,
  prompt: string,
  schema: S,
  model: string,
): Promise<z.infer<S>> {
  const uploaded = await uploadToFilesApi(apiKey, pdf, 'application/pdf', 'book');
  try {
    await waitForFileActive(apiKey, uploaded.name);
    const gemini = new BooksGemini(apiKey, { model });
    return await gemini.generateStructuredWithFile(
      prompt,
      { uri: uploaded.uri, mimeType: uploaded.mimeType },
      schema,
    );
  } finally {
    await deleteFile(apiKey, uploaded.name);
  }
}

function extractionError(c: Context<{ Bindings: Env }>, e: unknown) {
  if (e instanceof BooksAiError || e instanceof BooksFilesApiError) {
    console.error('[books/extract] AI error:', e.message);
    return c.json({ error: 'Extraction failed', details: e.message }, 502);
  }
  console.error('[books/extract] error:', e);
  return c.json({ error: 'Extraction failed', details: String(e) }, 500);
}

// POST /:bookId/upload — multipart form field "file" → stored in R2.
books.post('/:bookId/upload', booksRateLimit, async (c) => {
  const userId = c.get('user').sub;
  const bookId = c.req.param('bookId');
  if (!bookId) return c.json({ error: 'bookId is required' }, 400);

  let form: Record<string, string | File>;
  try {
    form = await c.req.parseBody();
  } catch {
    return c.json({ error: 'Invalid multipart form' }, 400);
  }
  const file = form.file;
  if (!file || typeof file === 'string') {
    return c.json({ error: 'file is required' }, 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json({ error: 'File too large (max 40MB)' }, 413);
  }

  const fileKey = `books/${userId}/${bookId}/source.pdf`;
  const bytes = await file.arrayBuffer();
  await c.env.REPORTS_BUCKET.put(fileKey, bytes, {
    httpMetadata: { contentType: file.type || 'application/pdf' },
  });
  return c.json({ fileKey, fileName: file.name, size: file.size });
});

// POST /extract-toc — { fileKey } → { page_count?, chapters[] }
books.post('/extract-toc', booksRateLimit, requiresAI, async (c) => {
  const userId = c.get('user').sub;
  const body = (await c.req.json().catch(() => null)) as any;
  const fileKey = body?.fileKey;
  if (!ownsKey(fileKey, userId)) return c.json({ error: 'Forbidden' }, 403);

  const { apiKey } = await resolveProviderApiKey(c.env, userId, 'gemini');
  if (!apiKey) return c.json({ error: 'AI service not configured' }, 503);
  const model = (await resolveSelectedModelForProvider(c.env, userId, 'gemini')) ?? BOOKS_GEMINI_MODEL;
  const guard = await kaizenCostGuard(c, userId, 'importExtraction');
  if (!guard.allowed) return c.json({ error: 'Daily extraction quota exceeded', degraded: true }, 429);

  const obj = await c.env.REPORTS_BUCKET.get(fileKey);
  if (!obj) return c.json({ error: 'File not found' }, 404);
  try {
    const pdf = await obj.arrayBuffer();
    const toc = await runPdfExtraction(apiKey, pdf, buildTocPrompt(), bookTocSchema, model);
    return c.json(toc);
  } catch (e) {
    return extractionError(c, e);
  }
});

// POST /extract-chapter — { fileKey, chapterTitle, startPage?, endPage? } → { text, contentKey }
books.post('/extract-chapter', booksRateLimit, requiresAI, async (c) => {
  const userId = c.get('user').sub;
  const body = (await c.req.json().catch(() => null)) as any;
  const fileKey = body?.fileKey;
  const chapterTitle = typeof body?.chapterTitle === 'string' ? body.chapterTitle.trim() : '';
  if (!ownsKey(fileKey, userId)) return c.json({ error: 'Forbidden' }, 403);
  if (!chapterTitle) return c.json({ error: 'chapterTitle is required' }, 400);

  const { apiKey } = await resolveProviderApiKey(c.env, userId, 'gemini');
  if (!apiKey) return c.json({ error: 'AI service not configured' }, 503);
  const model = (await resolveSelectedModelForProvider(c.env, userId, 'gemini')) ?? BOOKS_GEMINI_MODEL;

  const bookId = fileKey.split('/')[2] ?? 'book';
  const slug = chapterTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const startPage = typeof body?.startPage === 'number' ? body.startPage : null;
  const endPage = typeof body?.endPage === 'number' ? body.endPage : null;
  const contentKey = `books/${userId}/${bookId}/chapters/${slug || 'chapter'}-${startPage ?? 'x'}.txt`;

  // Return the cached extraction if this chapter was already processed.
  const cached = await c.env.REPORTS_BUCKET.get(contentKey);
  if (cached) {
    const text = await cached.text();
    return c.json({ text, contentKey, cached: true });
  }

  const guard = await kaizenCostGuard(c, userId, 'importExtraction');
  if (!guard.allowed) return c.json({ error: 'Daily extraction quota exceeded', degraded: true }, 429);

  const obj = await c.env.REPORTS_BUCKET.get(fileKey);
  if (!obj) return c.json({ error: 'File not found' }, 404);
  try {
    const pdf = await obj.arrayBuffer();
    const res = await runPdfExtraction(
      apiKey,
      pdf,
      buildChapterExtractPrompt({ chapterTitle, startPage, endPage }),
      bookChapterTextSchema,
      model,
    );
    const text = (res.text ?? '').slice(0, MAX_EXTRACT_TEXT);
    await c.env.REPORTS_BUCKET.put(contentKey, text, {
      httpMetadata: { contentType: 'text/plain; charset=utf-8' },
    });
    return c.json({ text, contentKey, cached: false });
  } catch (e) {
    return extractionError(c, e);
  }
});

// POST /chapter-text — { contentKey } → { text }  (reader mode)
books.post('/chapter-text', booksRateLimit, async (c) => {
  const userId = c.get('user').sub;
  const body = (await c.req.json().catch(() => null)) as any;
  const contentKey = body?.contentKey;
  if (!ownsKey(contentKey, userId)) return c.json({ error: 'Forbidden' }, 403);
  const obj = await c.env.REPORTS_BUCKET.get(contentKey);
  if (!obj) return c.json({ error: 'Not found' }, 404);
  const text = await obj.text();
  return c.json({ text, contentKey });
});

export default books;
