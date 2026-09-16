/**
 * Read-path getters extracted from kaizenStore (Track A / A7).
 *
 * Store actions delegate here so screens can reuse the same projections via
 * selectors without importing the full Zustand store.
 */
import type {
  KaizenBookChapterEntry,
  KaizenBookHighlightEntry,
  KaizenBookQuestionEntry,
  KaizenInterviewAttemptEntry,
} from '../types';

import {
  selectAttemptsForQuestion,
  selectBookChapters,
  selectBookHighlightsForChapter,
  selectBookQuestionsForChapter,
} from './kaizenSelectors';

export function getBookChaptersFromState(
  chapters: KaizenBookChapterEntry[],
  bookId: string,
): KaizenBookChapterEntry[] {
  return selectBookChapters(chapters, bookId);
}

export function getBookQuestionsForChapterFromState(
  questions: KaizenBookQuestionEntry[],
  chapterId: string,
): KaizenBookQuestionEntry[] {
  return selectBookQuestionsForChapter(questions, chapterId);
}

export function getBookHighlightsForChapterFromState(
  highlights: KaizenBookHighlightEntry[],
  chapterId: string,
): KaizenBookHighlightEntry[] {
  return selectBookHighlightsForChapter(highlights, chapterId);
}

export function getAttemptsForQuestionFromState(
  attempts: KaizenInterviewAttemptEntry[],
  questionId: string,
): KaizenInterviewAttemptEntry[] {
  return selectAttemptsForQuestion(attempts, questionId);
}
