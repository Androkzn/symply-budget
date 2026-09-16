/**
 * Symply Life (brand `symply-kaizen`) — backend client tests.
 *
 * Every exported call is a thin wrapper around the shared ecosystem `apiClient`
 * (mocked here). We assert the exact endpoint path, request body/headers the
 * backend contract expects, and that each returns the interceptor's `.data`.
 */
import { apiClient } from '@api/client';

import { KAIZEN_TABLES as REAL_KAIZEN_TABLES } from '../../types';
import {
  analyzeCareerResume,
  buildSkillLearningPlan,
  evaluateAssessmentAnswer,
  extractBookChapter,
  extractBookToc,
  extractKaizenQuestions,
  fetchBookChapterText,
  generateAssessmentQuestion,
  generateBookQuestions,
  generateIdealAnswer,
  gradeBookAnswer,
  gradeSpokenBookAnswer,
  KAIZEN_TABLES,
  postCoachMessage,
  postKaizenAI,
  scoreInterviewAnswer,
  syncKaizen,
  uploadBookFile,
} from '../kaizen';

jest.mock('@api/client', () => ({ apiClient: { post: jest.fn() } }));

const mockPost = apiClient.post as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('syncKaizen', () => {
  it('POSTs the sync request and returns the response data', async () => {
    const response = { server_time: '2026-07-15T00:00:00Z', changes: { kaizen_actions: [{ id: '1' }] } };
    mockPost.mockResolvedValue({ data: response });

    const request = { last_sync_at: '2026-07-14T00:00:00Z', changes: { kaizen_actions: [{ id: '1' }] } };
    const result = await syncKaizen(request);

    expect(mockPost).toHaveBeenCalledWith('/api/v1/sync', request);
    expect(result).toBe(response);
  });
});

describe('postCoachMessage', () => {
  it('POSTs the enriched coach payload with the disclosure-ack header', async () => {
    const response = { assistant_message: 'hello', session_id: 's1' };
    mockPost.mockResolvedValue({ data: response });

    const payload = {
      messages: [{ role: 'user' as const, content: 'hi' }],
      session_id: 's1',
      snapshot: 'snap',
      disclosure_ack: true,
    };
    const result = await postCoachMessage(payload);

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/kaizen/coach-chat/messages',
      {
        ...payload,
        context_snapshot: 'snap',
        context: { disclosureAck: true, snapshot: 'snap' },
        disclosureAck: true,
      },
      { headers: { 'X-Kaizen-AI-Disclosure-Ack': 'true' } },
    );
    expect(result).toBe(response);
  });

  it('stringifies a false disclosure ack in the header', async () => {
    mockPost.mockResolvedValue({ data: {} });

    await postCoachMessage({
      messages: [{ role: 'assistant', content: 'ok' }],
      disclosure_ack: false,
    });

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/kaizen/coach-chat/messages',
      expect.objectContaining({ disclosureAck: false, context_snapshot: undefined }),
      { headers: { 'X-Kaizen-AI-Disclosure-Ack': 'false' } },
    );
  });
});

describe('postKaizenAI', () => {
  it('POSTs to the interpolated /ai/<path> endpoint', async () => {
    mockPost.mockResolvedValue({ data: { ok: 1 } });

    const result = await postKaizenAI('some-op', { a: 1 });

    expect(mockPost).toHaveBeenCalledWith('/api/v1/ai/some-op', { a: 1 });
    expect(result).toEqual({ ok: 1 });
  });
});

describe('simple AI POST wrappers', () => {
  const cases: Array<{
    name: string;
    call: () => Promise<unknown>;
    path: string;
    body: unknown;
  }> = [
    {
      name: 'analyzeCareerResume',
      call: () => analyzeCareerResume('my resume'),
      path: '/api/v1/ai/analyze-career-resume',
      body: { resumeText: 'my resume' },
    },
    {
      name: 'extractKaizenQuestions',
      call: () => extractKaizenQuestions('doc text'),
      path: '/api/v1/ai/extract-kaizen-questions',
      body: { documentText: 'doc text' },
    },
    {
      name: 'scoreInterviewAnswer',
      call: () =>
        scoreInterviewAnswer({
          prompt: 'p',
          ideal_answer: 'ia',
          rubric: { a: 1 },
          answer_text: 'at',
        }),
      path: '/api/v1/ai/score-interview-answer',
      body: { prompt: 'p', ideal_answer: 'ia', rubric: { a: 1 }, answer_text: 'at' },
    },
    {
      name: 'generateIdealAnswer',
      call: () => generateIdealAnswer({ q: 'x' }),
      path: '/api/v1/ai/generate-ideal-answer',
      body: { q: 'x' },
    },
    {
      name: 'generateAssessmentQuestion',
      call: () => generateAssessmentQuestion({ topic: 't' }),
      path: '/api/v1/ai/generate-assessment-question',
      body: { topic: 't' },
    },
    {
      name: 'evaluateAssessmentAnswer',
      call: () => evaluateAssessmentAnswer({ answer: 'a' }),
      path: '/api/v1/ai/evaluate-assessment-answer',
      body: { answer: 'a' },
    },
    {
      name: 'buildSkillLearningPlan',
      call: () => buildSkillLearningPlan({ skill: 's' }),
      path: '/api/v1/ai/build-skill-learning-plan',
      body: { skill: 's' },
    },
    {
      name: 'generateBookQuestions',
      call: () =>
        generateBookQuestions({
          bookTitle: 'B',
          chapterTitle: 'C',
          types: ['mcq'],
          count: 3,
          language: 'en',
        }),
      path: '/api/v1/ai/books/generate-questions',
      body: {
        bookTitle: 'B',
        chapterTitle: 'C',
        types: ['mcq'],
        count: 3,
        language: 'en',
      },
    },
    {
      name: 'gradeBookAnswer',
      call: () =>
        gradeBookAnswer({ prompt: 'p', answerText: 'a', language: 'en' }),
      path: '/api/v1/ai/books/grade-answer',
      body: { prompt: 'p', answerText: 'a', language: 'en' },
    },
    {
      name: 'extractBookToc',
      call: () => extractBookToc('file-key'),
      path: '/api/v1/ai/books/extract-toc',
      body: { fileKey: 'file-key' },
    },
    {
      name: 'extractBookChapter',
      call: () => extractBookChapter({ fileKey: 'fk', chapterTitle: 'ch' }),
      path: '/api/v1/ai/books/extract-chapter',
      body: { fileKey: 'fk', chapterTitle: 'ch' },
    },
    {
      name: 'fetchBookChapterText',
      call: () => fetchBookChapterText('content-key'),
      path: '/api/v1/ai/books/chapter-text',
      body: { contentKey: 'content-key' },
    },
  ];

  it.each(cases)('$name POSTs to $path and returns data', async ({ call, path, body }) => {
    const data = { result: 'ok' };
    mockPost.mockResolvedValue({ data });

    const result = await call();

    expect(mockPost).toHaveBeenCalledWith(path, body);
    expect(result).toBe(data);
  });
});

describe('uploadBookFile', () => {
  it('builds a multipart FormData part and POSTs with the upload config', async () => {
    const appendSpy = jest.spyOn(FormData.prototype, 'append');
    mockPost.mockResolvedValue({
      data: { fileKey: 'k', fileName: 'f.pdf', size: 10 },
    });

    const result = await uploadBookFile('book-1', { uri: 'file://x.pdf', name: 'x.pdf' });

    expect(appendSpy).toHaveBeenCalledWith('file', {
      uri: 'file://x.pdf',
      name: 'x.pdf',
      type: 'application/pdf',
    });
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/ai/books/book-1/upload',
      expect.any(FormData),
      { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 },
    );
    expect(result).toEqual({ fileKey: 'k', fileName: 'f.pdf', size: 10 });
    appendSpy.mockRestore();
  });
});

describe('gradeSpokenBookAnswer', () => {
  it('uses provided audio name/type/idealAnswer/rubric', async () => {
    const appendSpy = jest.spyOn(FormData.prototype, 'append');
    mockPost.mockResolvedValue({ data: { transcription: 't' } });

    await gradeSpokenBookAnswer({
      audio: { uri: 'file://a.wav', name: 'a.wav', type: 'audio/wav' },
      prompt: 'p',
      idealAnswer: 'ideal',
      rubric: ['r1'],
      language: 'en',
    });

    expect(appendSpy).toHaveBeenCalledWith('audio', {
      uri: 'file://a.wav',
      name: 'a.wav',
      type: 'audio/wav',
    });
    expect(appendSpy).toHaveBeenCalledWith(
      'payload',
      JSON.stringify({ prompt: 'p', idealAnswer: 'ideal', rubric: ['r1'], language: 'en' }),
    );
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/ai/books/grade-spoken',
      expect.any(FormData),
      { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 },
    );
    appendSpy.mockRestore();
  });

  it('falls back to default audio name/type and nulls when omitted', async () => {
    const appendSpy = jest.spyOn(FormData.prototype, 'append');
    mockPost.mockResolvedValue({ data: { transcription: 't2' } });

    const result = await gradeSpokenBookAnswer({
      audio: { uri: 'file://b.m4a' },
      prompt: 'q',
      language: 'fr',
    });

    expect(appendSpy).toHaveBeenCalledWith('audio', {
      uri: 'file://b.m4a',
      name: 'answer.m4a',
      type: 'audio/m4a',
    });
    expect(appendSpy).toHaveBeenCalledWith(
      'payload',
      JSON.stringify({ prompt: 'q', idealAnswer: null, rubric: null, language: 'fr' }),
    );
    expect(result).toEqual({ transcription: 't2' });
    appendSpy.mockRestore();
  });
});

describe('KAIZEN_TABLES re-export', () => {
  it('re-exports the canonical table list unchanged', () => {
    expect(KAIZEN_TABLES).toBe(REAL_KAIZEN_TABLES);
  });
});
