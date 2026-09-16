/**
 * Symply Life (brand `symply-kaizen`) — backend client.
 *
 * Ported 1:1 from the donor Kaizen app (`Simply Kaizen/kaizen/src/api/kaizen.ts`).
 * Uses the shared ecosystem `apiClient` (auth + 401-refresh interceptors); `@config/env`
 * already resolves the base URL to the `symply-kaizen-api` Worker for this brand. Endpoint
 * paths and the `X-Kaizen-AI-Disclosure-Ack` header are the backend contract — keep identical.
 */
import { apiClient } from '@api/client';

import type { KaizenTableName } from '../types';
import { KAIZEN_TABLES } from '../types';

export type SyncChanges = Partial<Record<KaizenTableName, Record<string, unknown>[]>>;

export interface SyncRequest {
  last_sync_at?: string | null;
  changes?: SyncChanges;
}

export interface SyncResponse {
  server_time: string;
  changes: Record<string, Record<string, unknown>[]>;
}

export async function syncKaizen(request: SyncRequest): Promise<SyncResponse> {
  const { data } = await apiClient.post<SyncResponse>('/api/v1/sync', request);
  return data;
}

export async function postCoachMessage(payload: {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  session_id?: string;
  snapshot?: string;
  disclosure_ack: boolean;
}): Promise<{
  assistant_message?: string;
  message?: { content?: string };
  session_id?: string;
  tool_results?: Array<{ tool: string; result: string; opened_route?: string }>;
  proposed_memory_updates?: Array<{ category: string; fact: string; sensitivity?: string }>;
}> {
  const { data } = await apiClient.post(
    '/api/v1/kaizen/coach-chat/messages',
    {
      ...payload,
      context_snapshot: payload.snapshot,
      context: { disclosureAck: payload.disclosure_ack, snapshot: payload.snapshot },
      disclosureAck: payload.disclosure_ack,
    },
    { headers: { 'X-Kaizen-AI-Disclosure-Ack': String(payload.disclosure_ack) } },
  );
  return data;
}

export async function postKaizenAI(path: string, body: Record<string, unknown>): Promise<unknown> {
  const { data } = await apiClient.post(`/api/v1/ai/${path}`, body);
  return data;
}

export async function analyzeCareerResume(resumeText: string): Promise<{
  suggested_skills?: { name: string }[];
  target_roles?: string[];
  summary?: string;
}> {
  const { data } = await apiClient.post('/api/v1/ai/analyze-career-resume', {
    resumeText,
  });
  return data;
}

export async function extractKaizenQuestions(documentText: string): Promise<{
  questions?: Array<{ prompt?: string; question?: string; question_bank?: string; bank?: string }>;
}> {
  const { data } = await apiClient.post('/api/v1/ai/extract-kaizen-questions', {
    documentText,
  });
  return data;
}

export async function scoreInterviewAnswer(body: {
  prompt: string;
  ideal_answer: string;
  rubric: unknown;
  answer_text: string;
  question_bank?: string | null;
  kind?: string | null;
}): Promise<{ overall_score?: number; reasoning?: string; model?: string }> {
  const { data } = await apiClient.post('/api/v1/ai/score-interview-answer', body);
  return data;
}

export async function generateIdealAnswer(body: Record<string, unknown>): Promise<{ ideal_answer?: string; rubric?: string; model?: string }> {
  const { data } = await apiClient.post('/api/v1/ai/generate-ideal-answer', body);
  return data;
}

export async function generateAssessmentQuestion(body: Record<string, unknown>): Promise<{ question?: string; prompt?: string }> {
  const { data } = await apiClient.post('/api/v1/ai/generate-assessment-question', body);
  return data;
}

export async function evaluateAssessmentAnswer(body: Record<string, unknown>): Promise<{ overall_score?: number; reasoning?: string }> {
  const { data } = await apiClient.post('/api/v1/ai/evaluate-assessment-answer', body);
  return data;
}

export async function buildSkillLearningPlan(body: Record<string, unknown>): Promise<{ plan?: string; skills?: unknown[] }> {
  const { data } = await apiClient.post('/api/v1/ai/build-skill-learning-plan', body);
  return data;
}

// ---------------------------------------------------------------------------
// Book Comprehension & Retention (stateless AI; results persisted locally + synced)
// ---------------------------------------------------------------------------

export type BookQuestionType = 'mcq' | 'open' | 'spoken';

export interface GeneratedBookQuestion {
  type: BookQuestionType;
  prompt: string;
  options?: string[];
  answer_index?: number;
  ideal_answer?: string;
  rubric?: string[];
  difficulty_0_to_100?: number;
  low_confidence?: boolean;
}

export interface GenerateBookQuestionsRequest {
  bookTitle: string;
  author?: string | null;
  chapterTitle: string;
  chapterText?: string | null;
  tocContext?: string | null;
  types: BookQuestionType[];
  count: number;
  language: string;
  highlights?: string[];
}

export async function generateBookQuestions(
  body: GenerateBookQuestionsRequest,
): Promise<{ questions: GeneratedBookQuestion[]; model?: string }> {
  const { data } = await apiClient.post('/api/v1/ai/books/generate-questions', body);
  return data;
}

export interface BookAnswerMistake {
  type: string;
  severity?: string;
  text: string;
  correction?: string;
  explanation?: string;
  practice_prompt?: string;
}

export interface GradeBookAnswerResult {
  content_score: number;
  overall_score: number;
  feedback: string;
  mistakes: BookAnswerMistake[];
  stronger_answer?: string | null;
  model?: string;
}

export async function gradeBookAnswer(body: {
  prompt: string;
  idealAnswer?: string | null;
  rubric?: string[] | null;
  answerText: string;
  language: string;
}): Promise<GradeBookAnswerResult> {
  const { data } = await apiClient.post('/api/v1/ai/books/grade-answer', body);
  return data;
}

// --- Phase 3: PDF upload + on-demand chapter extraction ---

export interface UploadBookFileResult {
  fileKey: string;
  fileName: string;
  size: number;
}

export async function uploadBookFile(
  bookId: string,
  file: { uri: string; name: string },
): Promise<UploadBookFileResult> {
  const form = new FormData();
  // React Native FormData file part.
  form.append('file', { uri: file.uri, name: file.name, type: 'application/pdf' } as unknown as Blob);
  const { data } = await apiClient.post(`/api/v1/ai/books/${bookId}/upload`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
  return data;
}

export interface ExtractedTocChapter {
  title: string;
  start_page?: number;
  end_page?: number;
}

export async function extractBookToc(
  fileKey: string,
): Promise<{ page_count?: number; chapters: ExtractedTocChapter[] }> {
  const { data } = await apiClient.post('/api/v1/ai/books/extract-toc', { fileKey });
  return data;
}

export async function extractBookChapter(body: {
  fileKey: string;
  chapterTitle: string;
  startPage?: number | null;
  endPage?: number | null;
}): Promise<{ text: string; contentKey: string; cached: boolean }> {
  const { data } = await apiClient.post('/api/v1/ai/books/extract-chapter', body);
  return data;
}

export async function fetchBookChapterText(contentKey: string): Promise<{ text: string }> {
  const { data } = await apiClient.post('/api/v1/ai/books/chapter-text', { contentKey });
  return data;
}

// --- Phase 5: spoken answers (two-layer meaning + grammar + pronunciation) ---

export interface SpokenPronunciationWord {
  word: string;
  score: number;
  is_problem?: boolean;
  tip?: string;
}

export interface GradeSpokenResult {
  transcription: string;
  content_score: number;
  overall_score: number;
  feedback: string;
  mistakes: BookAnswerMistake[];
  pronunciation: {
    overall_score: number;
    words: SpokenPronunciationWord[];
    breakdown?: Record<string, unknown>;
  };
  delivery: { filler_count?: number; pace?: string; fluency_score?: number };
  model?: string;
}

export async function gradeSpokenBookAnswer(params: {
  audio: { uri: string; name?: string; type?: string };
  prompt: string;
  idealAnswer?: string | null;
  rubric?: string[] | null;
  language: string;
}): Promise<GradeSpokenResult> {
  const form = new FormData();
  form.append('audio', {
    uri: params.audio.uri,
    name: params.audio.name ?? 'answer.m4a',
    type: params.audio.type ?? 'audio/m4a',
  } as unknown as Blob);
  form.append(
    'payload',
    JSON.stringify({
      prompt: params.prompt,
      idealAnswer: params.idealAnswer ?? null,
      rubric: params.rubric ?? null,
      language: params.language,
    }),
  );
  const { data } = await apiClient.post('/api/v1/ai/books/grade-spoken', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
  return data;
}

export { KAIZEN_TABLES };
