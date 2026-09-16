/**
 * Book Comprehension — SPOKEN-answer grader (Phase 5) coverage for
 * `services/kaizen/books/bookSpeech.ts` + its prompt/schema in `prompts.ts`.
 *
 * The only network boundary is `ai/gemini-sdk-client`, replaced with a
 * `vi.mock` factory (hoisted mock fns) exactly like gemini.test.ts.
 *
 * Covers:
 *   - buildSpokenGradingPrompt: mentions transcription, both grading layers
 *     (content_score / mistakes), per-word pronunciation, and the language.
 *   - spokenGradingSchema: a full payload parses; a minimal ({}) payload parses
 *     with pronunciation/delivery filled from their defaults (schema tolerance).
 *   - gradeSpokenAnswer: a fenced ```json stream parses+validates (no repair);
 *     a malformed first response is fixed via the one repair call; both-fail
 *     throws BooksAiError; a transport failure is wrapped in BooksAiError.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { streamMock, generateMock } = vi.hoisted(() => ({
  streamMock: vi.fn(),
  generateMock: vi.fn(),
}));

vi.mock('../../../../ai/gemini-sdk-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../ai/gemini-sdk-client')>();
  return {
    ...actual,
    createGeminiClient: vi.fn(() => ({})),
    getGeminiModel: vi.fn(() => ({})),
    accumulateStreamText: streamMock,
    generateText: generateMock,
  };
});

import { gradeSpokenAnswer } from '../bookSpeech';
import { BooksAiError } from '../gemini';
import { buildSpokenGradingPrompt, spokenGradingSchema } from '../prompts';

/** A complete, schema-valid spoken-grading object. */
const FULL_RESULT = {
  transcription: 'The habit loop has four stages: cue, craving, response, and reward.',
  content_score: 0.9,
  overall_score: 0.85,
  feedback: 'Clear and correct explanation.',
  mistakes: [
    {
      type: 'grammar',
      severity: 'low',
      text: 'has',
      correction: 'have',
      explanation: 'subject-verb agreement',
      practice_prompt: 'Practise plural subjects.',
    },
  ],
  pronunciation: {
    overall_score: 0.8,
    words: [
      { word: 'cue', score: 0.95, is_problem: false, tip: '' },
      { word: 'craving', score: 0.55, is_problem: true, tip: 'Stress the first syllable.' },
    ],
    breakdown: { phoneme: 0.8, word_stress: 0.75, intonation: 0.85 },
  },
  delivery: { filler_count: 1, pace: 'steady', fluency_score: 0.78 },
};

/** Tiny ArrayBuffer standing in for the recorded audio bytes. */
function audio(): ArrayBuffer {
  return new Uint8Array([1, 2, 3, 4]).buffer;
}

const ARGS = {
  prompt: 'Explain the habit loop.',
  idealAnswer: 'Cue, craving, response, reward.',
  rubric: ['names all four stages'],
  language: 'fr',
};

beforeEach(() => {
  streamMock.mockReset();
  generateMock.mockReset();
});

describe('buildSpokenGradingPrompt', () => {
  it('mentions transcription, both layers, per-word pronunciation, and the language', () => {
    const prompt = buildSpokenGradingPrompt(ARGS);
    expect(prompt).toContain('transcription');
    expect(prompt).toContain('content_score');
    expect(prompt).toContain('mistakes');
    expect(prompt).toContain('pronunciation');
    expect(prompt).toContain('words');
    expect(prompt).toContain('fr');
    expect(prompt).toContain('Explain the habit loop.');
    expect(prompt).toContain('Cue, craving, response, reward.');
  });
});

describe('spokenGradingSchema', () => {
  it('parses a complete valid payload', () => {
    const parsed = spokenGradingSchema.safeParse(FULL_RESULT);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.transcription).toBe(FULL_RESULT.transcription);
      expect(parsed.data.pronunciation.words[0].word).toBe('cue');
      expect(parsed.data.pronunciation.words[1].is_problem).toBe(true);
      expect(parsed.data.delivery.pace).toBe('steady');
    }
  });

  it('parses a minimal ({}) payload, filling every field from its default', () => {
    const parsed = spokenGradingSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.transcription).toBe('');
      expect(parsed.data.content_score).toBe(0);
      expect(parsed.data.overall_score).toBe(0);
      expect(parsed.data.feedback).toBe('');
      expect(parsed.data.mistakes).toEqual([]);
      expect(parsed.data.pronunciation).toEqual({ overall_score: 0, words: [] });
      expect(parsed.data.delivery).toEqual({});
    }
  });
});

describe('gradeSpokenAnswer', () => {
  it('parses + validates a fenced ```json streamed response (no repair)', async () => {
    streamMock.mockResolvedValue(`\`\`\`json\n${JSON.stringify(FULL_RESULT)}\n\`\`\``);

    const out = await gradeSpokenAnswer('k', audio(), 'audio/m4a', ARGS);

    expect(out.transcription).toBe(FULL_RESULT.transcription);
    expect(out.content_score).toBe(0.9);
    expect(out.overall_score).toBe(0.85);
    expect(out.pronunciation.words[0].word).toBe('cue');
    expect(out.delivery.filler_count).toBe(1);
    expect(streamMock).toHaveBeenCalledTimes(1);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('repairs a malformed first response via the single repair path', async () => {
    streamMock.mockResolvedValue('this is not json at all');
    generateMock.mockResolvedValue(`\`\`\`json\n${JSON.stringify(FULL_RESULT)}\n\`\`\``);

    const out = await gradeSpokenAnswer('k', audio(), 'audio/m4a', ARGS);

    expect(out.transcription).toBe(FULL_RESULT.transcription);
    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  it('throws BooksAiError when both the response and the repair are unusable', async () => {
    streamMock.mockResolvedValue('garbage, not json');
    generateMock.mockResolvedValue('still not json');

    await expect(gradeSpokenAnswer('k', audio(), 'audio/m4a', ARGS)).rejects.toBeInstanceOf(
      BooksAiError,
    );
  });

  it('wraps a streaming transport failure in BooksAiError', async () => {
    streamMock.mockRejectedValue(new Error('network boom'));

    await expect(gradeSpokenAnswer('k', audio(), 'audio/m4a', ARGS)).rejects.toBeInstanceOf(
      BooksAiError,
    );
  });
});
