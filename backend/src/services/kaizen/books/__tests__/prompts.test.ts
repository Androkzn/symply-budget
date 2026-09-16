/**
 * Book Comprehension prompt builders + zod schemas — pure-function coverage for
 * `services/kaizen/books/prompts.ts`. No network / no bindings: these are all
 * synchronous helpers, so they run untouched in the workers pool.
 *
 * Covers:
 *   - normalizeScore: 0-1 / 0-10 / 0-100 scale detection + clamping + null/NaN.
 *   - the zod output schemas (valid/invalid, the mistakes[] default).
 *   - the three prompt builders: chapter-grounded vs ToC-only grounding, the
 *     two-layer grading language, and the extract page hint.
 */

import { describe, expect, it } from 'vitest';

import {
  normalizeScore,
  bookQuestionsSchema,
  bookGradingSchema,
  bookTocSchema,
  bookChapterTextSchema,
  buildBookQuestionsPrompt,
  buildBookGradingPrompt,
  buildChapterExtractPrompt,
} from '../prompts';

describe('normalizeScore', () => {
  it('leaves an already-0..1 score untouched', () => {
    expect(normalizeScore(0.5)).toBe(0.5);
  });

  it('scales a 0..10 score down to 0..1', () => {
    expect(normalizeScore(7)).toBeCloseTo(0.7, 10);
  });

  it('scales a 0..100 score down to 0..1', () => {
    expect(normalizeScore(85)).toBeCloseTo(0.85, 10);
  });

  it('keeps the boundary values 1 and 0', () => {
    expect(normalizeScore(1)).toBe(1);
    expect(normalizeScore(0)).toBe(0);
  });

  it('clamps a negative score up to 0', () => {
    expect(normalizeScore(-5)).toBe(0);
  });

  it('clamps an over-100 score down to 1', () => {
    expect(normalizeScore(150)).toBe(1);
  });

  it('treats null / undefined / NaN as 0', () => {
    expect(normalizeScore(null)).toBe(0);
    expect(normalizeScore(undefined)).toBe(0);
    expect(normalizeScore(Number.NaN)).toBe(0);
  });
});

describe('output schemas', () => {
  it('bookQuestionsSchema accepts a valid mcq + open payload', () => {
    const parsed = bookQuestionsSchema.safeParse({
      questions: [
        { type: 'mcq', prompt: 'Who?', options: ['a', 'b', 'c', 'd'], answer_index: 0 },
        { type: 'open', prompt: 'Explain.', ideal_answer: 'Because...', rubric: ['clear', 'correct'] },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('bookQuestionsSchema rejects an unknown question type', () => {
    const parsed = bookQuestionsSchema.safeParse({
      questions: [{ type: 'essay', prompt: 'Write an essay.' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('bookGradingSchema accepts the two-layer payload', () => {
    const parsed = bookGradingSchema.safeParse({
      content_score: 0.8,
      overall_score: 0.75,
      feedback: 'Solid understanding.',
      mistakes: [],
    });
    expect(parsed.success).toBe(true);
  });

  it('bookGradingSchema defaults mistakes to [] when omitted', () => {
    const parsed = bookGradingSchema.safeParse({
      content_score: 0.9,
      overall_score: 0.85,
      feedback: 'Great.',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.mistakes).toEqual([]);
  });

  it('bookTocSchema accepts a chapter list', () => {
    const parsed = bookTocSchema.safeParse({ chapters: [{ title: '1. Intro' }] });
    expect(parsed.success).toBe(true);
  });

  it('bookChapterTextSchema accepts a text payload', () => {
    const parsed = bookChapterTextSchema.safeParse({ text: 'Once upon a time.' });
    expect(parsed.success).toBe(true);
  });
});

describe('buildBookQuestionsPrompt', () => {
  const base = {
    bookTitle: 'Atomic Habits',
    author: 'James Clear',
    chapterTitle: 'The Power of Small Habits',
    types: ['mcq', 'open'] as const,
    count: 5,
    language: 'es',
  };

  it('embeds the chapter text verbatim when provided (grounded path)', () => {
    const marker = 'The compound effect of tiny gains is enormous over time.';
    const prompt = buildBookQuestionsPrompt({ ...base, types: [...base.types], chapterText: marker });
    expect(prompt).toContain(marker);
    expect(prompt).toContain('CHAPTER TEXT START');
    // still mentions the language + the requested types
    expect(prompt).toContain('es');
    expect(prompt).toContain('mcq, open');
  });

  it('adds a no-fabrication rule + the chapter title on the ToC-only path (no chapter text)', () => {
    const prompt = buildBookQuestionsPrompt({ ...base, types: [...base.types], chapterText: null });
    expect(prompt).not.toContain('CHAPTER TEXT START');
    expect(prompt).toContain('NEVER invent');
    expect(prompt).toContain('low_confidence');
    expect(prompt).toContain(base.chapterTitle);
    expect(prompt).toContain('es');
    expect(prompt).toContain('mcq, open');
  });
});

describe('buildBookGradingPrompt', () => {
  it('references both grading layers (content_score + mistakes)', () => {
    const prompt = buildBookGradingPrompt({
      prompt: 'What is a habit loop?',
      idealAnswer: 'Cue, craving, response, reward.',
      rubric: ['names all four stages'],
      answerText: 'It is cue and reward.',
      language: 'en',
    });
    expect(prompt).toContain('content_score');
    expect(prompt).toContain('mistakes');
    expect(prompt).toContain('en');
  });
});

describe('buildChapterExtractPrompt', () => {
  it('includes the page hint when startPage is given', () => {
    const prompt = buildChapterExtractPrompt({ chapterTitle: 'Chapter 2', startPage: 10, endPage: 20 });
    expect(prompt).toContain('Chapter 2');
    expect(prompt).toContain('pages 10');
  });

  it('omits the page hint when startPage is absent', () => {
    const prompt = buildChapterExtractPrompt({ chapterTitle: 'Chapter 2' });
    expect(prompt).toContain('Chapter 2');
    expect(prompt).not.toContain('approximately pages');
  });
});
