/**
 * Book mutation helpers extracted from kaizenStore (Track A / A7).
 */
import { softDelete, upsertLocal } from '../services/repository';
import type {
  KaizenBookChapterEntry,
  KaizenBookEntry,
  KaizenBookHighlightEntry,
  KaizenBookQuestionEntry,
} from '../types';

export type AddBookInput = {
  title: string;
  author?: string;
  language?: string;
  sourceType?: string;
  coverEmoji?: string;
  chapters?: Array<{ title: string; startPage?: number; endPage?: number }>;
};

export type KaizenBookStoreSlice = {
  bookChapters: KaizenBookChapterEntry[];
  bookQuestions: KaizenBookQuestionEntry[];
  bookHighlights: KaizenBookHighlightEntry[];
  books: KaizenBookEntry[];
};

export type KaizenBookActionDeps = {
  get: () => KaizenBookStoreSlice;
  hydrate: () => Promise<void>;
  sync: () => Promise<void>;
  requireUserId: () => string;
  cryptoRandomId: () => string;
};

export async function addBookAction(
  deps: KaizenBookActionDeps,
  input: AddBookInput,
): Promise<string> {
  const uid = deps.requireUserId();
  const now = new Date().toISOString();
  const bookId = deps.cryptoRandomId();
  await upsertLocal('kaizen_books', {
    id: bookId,
    user_id: uid,
    title: input.title,
    author: input.author ?? null,
    language: input.language || 'en',
    source_type: input.sourceType ?? 'toc_only',
    file_object_key: null,
    file_name: null,
    file_hash: null,
    page_count: null,
    cover_emoji: input.coverEmoji ?? null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });
  const chapters = input.chapters ?? [];
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    await upsertLocal('kaizen_book_chapters', {
      id: deps.cryptoRandomId(),
      user_id: uid,
      book_id: bookId,
      chapter_index: i,
      title: ch.title,
      start_page: ch.startPage ?? null,
      end_page: ch.endPage ?? null,
      status: 'none',
      content_object_key: null,
      summary: null,
      read_at: null,
      questions_generated_at: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    });
  }
  await deps.hydrate();
  void deps.sync();
  return bookId;
}

export async function deleteBookAction(
  deps: KaizenBookActionDeps,
  bookId: string,
): Promise<void> {
  await softDelete('kaizen_books', bookId);
  const state = deps.get();
  for (const ch of state.bookChapters.filter(c => c.book_id === bookId)) {
    await softDelete('kaizen_book_chapters', ch.id);
  }
  for (const q of state.bookQuestions.filter(entry => entry.book_id === bookId)) {
    await softDelete('kaizen_book_questions', q.id);
  }
  for (const h of state.bookHighlights.filter(entry => entry.book_id === bookId)) {
    await softDelete('kaizen_book_highlights', h.id);
  }
  await deps.hydrate();
  void deps.sync();
}

export async function markBookChapterReadAction(
  deps: KaizenBookActionDeps,
  chapterId: string,
): Promise<void> {
  const chapter = deps.get().bookChapters.find(c => c.id === chapterId);
  if (!chapter) return;
  const now = new Date().toISOString();
  await upsertLocal('kaizen_book_chapters', { ...chapter, read_at: now, updated_at: now });
  await deps.hydrate();
  void deps.sync();
}
