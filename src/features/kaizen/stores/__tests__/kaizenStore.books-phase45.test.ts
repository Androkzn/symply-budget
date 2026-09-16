/**
 * Unit coverage for the Kaizen (Kaizen) store's "Book Comprehension" actions
 * for Phases 4-5: spoken (audio) grading, on-demand chapter text extraction,
 * PDF attach + ToC auto-detection, highlight CRUD, and highlight-grounded
 * question generation.
 *
 * The dependency boundary mirrors `kaizenStore.books.test.ts` exactly:
 *  - `../services/repository` is backed by an in-memory fake "DB" (a Map keyed by
 *    table name), so `upsertLocal` writes and `hydrate`'s `listActive`/`getProfile`
 *    reads round-trip for real — book actions are asserted through resulting state.
 *  - The AI api layer (`gradeSpokenBookAnswer`, `uploadBookFile`, `extractBookToc`,
 *    `extractBookChapter`, `fetchBookChapterText`, `generateBookQuestions`) is a
 *    jest.fn stub so no network is touched. The FSRS scheduler stays REAL.
 *  - `@stores/authStore` is mocked with a mutable user id.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// Mutable auth identity (mock-prefixed so the jest.mock factory may close over it).
let mockUserId: string | null = 'u1';

jest.mock('@stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({ user: mockUserId ? { id: mockUserId } : null }),
  },
}));

jest.mock('../../services/repository', () => ({
  ...jest.requireActual('../../services/repository'),
  upsertLocal: jest.fn(),
  listActive: jest.fn(),
  getProfile: jest.fn(),
  getDailyCoreActions: jest.fn(),
  completeActionToday: jest.fn(),
  skipActionToday: jest.fn(),
  softDelete: jest.fn(),
  getDirtyChanges: jest.fn().mockResolvedValue({}),
  applyServerChanges: jest.fn().mockResolvedValue(undefined),
  clearDirtyFlags: jest.fn().mockResolvedValue(undefined),
  getLastSyncAt: jest.fn().mockResolvedValue(null),
  setLastSyncAt: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../api/kaizen', () => ({
  scoreInterviewAnswer: jest.fn(),
  analyzeCareerResume: jest.fn(),
  extractKaizenQuestions: jest.fn(),
  generateIdealAnswer: jest.fn(),
  postCoachMessage: jest.fn(),
  generateBookQuestions: jest.fn(),
  gradeBookAnswer: jest.fn(),
  gradeSpokenBookAnswer: jest.fn(),
  uploadBookFile: jest.fn(),
  extractBookToc: jest.fn(),
  extractBookChapter: jest.fn(),
  fetchBookChapterText: jest.fn(),
}));

jest.mock('../../services/sync', () => ({ runKaizenSync: jest.fn() }));
jest.mock('../../services/reminders', () => ({
  scheduleDailyCoreReminders: jest.fn().mockResolvedValue(undefined),
  completedActionIdsFromLogs: jest.fn(() => new Set<string>()),
}));
jest.mock('../../services/watchSync', () => ({
  watchSync: { pushTodaySummary: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../services/contextSnapshot', () => ({
  buildKaizenContextSnapshot: jest.fn(() => ({})),
}));
jest.mock('../../services/wakeDetection', () => ({
  wakeDetection: { isConfirmed: jest.fn(() => false), confirm: jest.fn(), clear: jest.fn() },
}));
jest.mock('../../services/aiDisclosure', () => ({
  getAIDisclosureAck: jest.fn(() => false),
  setAIDisclosureAck: jest.fn(),
}));

import * as api from '../../api/kaizen';
import * as repo from '../../services/repository';
import { runKaizenSync } from '../../services/sync';
import { useKaizenStore } from '../kaizenStore';

// --- in-memory fake DB backing the repository mock -------------------------

type Row = Record<string, any>;
const db = new Map<string, Row[]>();

function rowsIn(table: string): Row[] {
  return db.get(table) ?? [];
}

// Directly mutate a canonical DB row (mutable — reads hand out copies) to set up
// states the public actions can't reach (e.g. a chapter's content_object_key).
function patchRow(table: string, id: string, patch: Row): void {
  const rows = db.get(table) ?? [];
  const idx = rows.findIndex(r => r.id === id);
  if (idx >= 0) rows[idx] = { ...rows[idx], ...patch };
  db.set(table, rows);
}

function wireRepository(): void {
  (repo.upsertLocal as jest.Mock).mockImplementation(async (table: string, row: Row) => {
    const rows = db.get(table) ?? [];
    const idx = rows.findIndex(r => r.id === row.id);
    if (idx >= 0) rows[idx] = { ...row };
    else rows.push({ ...row });
    db.set(table, rows);
  });
  // Reads return COPIES: hydrate places these into the immer store, which
  // auto-freezes them. Returning copies keeps the canonical DB rows mutable.
  (repo.listActive as jest.Mock).mockImplementation(async (table: string, uid: string) =>
    rowsIn(table)
      .filter(r => r.user_id === uid && !r.deleted_at)
      .map(r => ({ ...r })),
  );
  (repo.getProfile as jest.Mock).mockImplementation((uid: string) => {
    const found = rowsIn('kaizen_profiles').find(r => r.user_id === uid && !r.deleted_at);
    return Promise.resolve(found ? { ...found } : null);
  });
  (repo.getDailyCoreActions as jest.Mock).mockImplementation(async (uid: string) =>
    rowsIn('kaizen_actions')
      .filter(r => r.user_id === uid && !r.deleted_at && !r.is_archived && r.is_daily_core)
      .map(r => ({ ...r })),
  );
  (repo.softDelete as jest.Mock).mockImplementation(async (table: string, id: string) => {
    const rows = db.get(table) ?? [];
    const idx = rows.findIndex(r => r.id === id);
    if (idx >= 0) rows[idx] = { ...rows[idx], deleted_at: new Date().toISOString() };
  });
}

const INITIAL_DATA = {
  isHydrated: false,
  isSyncing: false,
  lastError: null,
  profile: null,
  dailyCore: [],
  skills: [],
  questions: [],
  knowledge: [],
  gtd: [],
  reviews: [],
  todayLogs: [],
  deepWork: [],
  pipeline: [],
  attempts: [],
  memories: [],
  rotations: [],
  habitStacks: [],
  habitStackSteps: [],
  books: [],
  bookChapters: [],
  bookQuestions: [],
  bookAttempts: [],
  bookMistakes: [],
  bookHighlights: [],
  wakeConfirmedToday: false,
} as const;

const s = () => useKaizenStore.getState();

// Drain the fire-and-forget `void get().sync()` chains actions kick off.
const flush = () => new Promise<void>(res => setImmediate(res));

beforeEach(() => {
  jest.clearAllMocks();
  db.clear();
  mockUserId = 'u1';
  wireRepository();
  // Keep the background sync pending forever so its late re-hydrate never fires
  // and clobbers the assertable post-mutation state (actions await their OWN hydrate).
  (runKaizenSync as jest.Mock).mockReturnValue(new Promise<void>(() => {}));
  useKaizenStore.setState({ ...INITIAL_DATA } as any);
});

afterEach(async () => {
  await flush();
});

// ---------------------------------------------------------------------------

// Seed a chapter with an AI-returned book question and return its id.
async function seedQuestion(
  question: Row,
  bookInput: Parameters<ReturnType<typeof s>['addBook']>[0] = {
    title: 'A Book',
    language: 'en',
    chapters: [{ title: 'Ch1' }],
  },
): Promise<{ bookId: string; chapterId: string; questionId: string }> {
  const bookId = await s().addBook(bookInput);
  const chapterId = s().getBookChapters(bookId)[0].id;
  (api.generateBookQuestions as jest.Mock).mockResolvedValue({ questions: [question] });
  await s().generateBookChapterQuestions(chapterId, { types: [question.type], count: 1 });
  const questionId = s().getBookQuestionsForChapter(chapterId)[0].id;
  return { bookId, chapterId, questionId };
}

describe('submitSpokenBookAttempt — audio graded', () => {
  it('persists a spoken attempt (transcription + pronunciation JSON) and files grammar + pronunciation mistakes', async () => {
    const { bookId, chapterId, questionId } = await seedQuestion({
      type: 'spoken',
      prompt: 'Describe your habit',
      ideal_answer: 'A habit is...',
      rubric: ['clarity'],
    });

    (api.gradeSpokenBookAnswer as jest.Mock).mockResolvedValue({
      transcription: 'I have good habit',
      content_score: 0.9,
      overall_score: 0.85,
      feedback: 'Nice delivery.',
      mistakes: [{ type: 'grammar', text: 'go', correction: 'went' }],
      pronunciation: {
        overall_score: 0.7,
        words: [{ word: 'habit', score: 0.4, is_problem: true, tip: 'stress the first syllable' }],
      },
      delivery: {},
    });

    await s().submitSpokenBookAttempt(questionId, { uri: 'file:///a.m4a', durationMs: 3000 });

    // The audio grader was invoked with the recording uri.
    expect(api.gradeSpokenBookAnswer).toHaveBeenCalledTimes(1);
    expect(api.gradeSpokenBookAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ audio: { uri: 'file:///a.m4a' } }),
    );

    // One spoken attempt row with the AI scores + transcription + pronunciation JSON.
    expect(s().bookAttempts).toHaveLength(1);
    const attempt = s().bookAttempts[0];
    expect(attempt).toMatchObject({
      question_id: questionId,
      book_id: bookId,
      chapter_id: chapterId,
      answer_source: 'spoken',
      transcription: 'I have good habit',
      answer_text: 'I have good habit',
      content_score: 0.9,
      overall_score: 0.85,
      feedback: 'Nice delivery.',
      scored_offline: 0,
    });
    expect(attempt.pronunciation).toBeTruthy();
    expect(JSON.parse(attempt.pronunciation as string)).toMatchObject({ overall_score: 0.7 });
    expect(attempt.mistakes).toBeTruthy();
    expect(JSON.parse(attempt.mistakes as string)).toEqual([
      { type: 'grammar', text: 'go', correction: 'went' },
    ]);

    // TWO recurring-mistake tickets: the grammar mistake AND the problem pronunciation word.
    expect(s().bookMistakes).toHaveLength(2);
    expect(s().bookMistakes.map(m => m.type).sort()).toEqual(['grammar', 'pronunciation']);

    const grammar = s().bookMistakes.find(m => m.type === 'grammar')!;
    expect(grammar).toMatchObject({ text: 'go', correction: 'went', status: 'detected' });

    const pron = s().bookMistakes.find(m => m.type === 'pronunciation')!;
    expect(pron).toMatchObject({ text: 'habit', status: 'detected' });
    expect(pron.dedup_key).toBe('pronunciation|habit');

    // The question was rescheduled via FSRS.
    const q = s().getBookQuestionsForChapter(chapterId).find(x => x.id === questionId)!;
    expect(q.last_reviewed_at).toBeTruthy();
    expect(q.due_at).toBeTruthy();
  });
});

describe('readChapterText', () => {
  it('(a) returns "" for a toc_only book and calls neither extractor', async () => {
    const bookId = await s().addBook({
      title: 'TOC Only',
      language: 'en',
      chapters: [{ title: 'Ch1' }],
    });
    const chapterId = s().getBookChapters(bookId)[0].id;

    const text = await s().readChapterText(chapterId);

    expect(text).toBe('');
    expect(api.fetchBookChapterText).not.toHaveBeenCalled();
    expect(api.extractBookChapter).not.toHaveBeenCalled();
  });

  it('(b) returns cached text via fetchBookChapterText when the chapter has content_object_key', async () => {
    const bookId = await s().addBook({
      title: 'PDF Book',
      language: 'en',
      sourceType: 'pdf',
      chapters: [{ title: 'Ch1' }],
    });
    const chapterId = s().getBookChapters(bookId)[0].id;
    // Give the book a file key and the chapter a cached content key, then re-hydrate.
    patchRow('kaizen_books', bookId, { file_object_key: 'file-key-1' });
    patchRow('kaizen_book_chapters', chapterId, { content_object_key: 'content-key-1' });
    await s().hydrate();

    (api.fetchBookChapterText as jest.Mock).mockResolvedValue({ text: 'Cached chapter body.' });

    const text = await s().readChapterText(chapterId);

    expect(text).toBe('Cached chapter body.');
    expect(api.fetchBookChapterText).toHaveBeenCalledWith('content-key-1');
    expect(api.extractBookChapter).not.toHaveBeenCalled();
  });

  it('(c) extracts on demand via extractBookChapter (pdf + file key, no content key) and caches the content key', async () => {
    const bookId = await s().addBook({
      title: 'PDF Book 2',
      language: 'en',
      sourceType: 'pdf',
      chapters: [{ title: 'Ch1' }],
    });
    const chapterId = s().getBookChapters(bookId)[0].id;
    patchRow('kaizen_books', bookId, { file_object_key: 'file-key-2' });
    await s().hydrate();

    (api.extractBookChapter as jest.Mock).mockResolvedValue({
      text: 'Freshly extracted text.',
      contentKey: 'content-key-2',
    });

    const text = await s().readChapterText(chapterId);

    expect(text).toBe('Freshly extracted text.');
    expect(api.extractBookChapter).toHaveBeenCalledTimes(1);
    expect(api.extractBookChapter).toHaveBeenCalledWith(
      expect.objectContaining({ fileKey: 'file-key-2', chapterTitle: 'Ch1' }),
    );
    // The chapter now carries the returned content key.
    const chapter = s().getBookChapters(bookId)[0];
    expect(chapter.content_object_key).toBe('content-key-2');
  });
});

describe('attachBookFile', () => {
  it('uploads the file, flips the book to pdf, and auto-creates chapters from the extracted ToC', async () => {
    const bookId = await s().addBook({ title: 'Bare Book', language: 'en' }); // no chapters
    expect(s().getBookChapters(bookId)).toHaveLength(0);

    (api.uploadBookFile as jest.Mock).mockResolvedValue({
      fileKey: 'fk-1',
      fileName: 'book.pdf',
      size: 12345,
    });
    (api.extractBookToc as jest.Mock).mockResolvedValue({
      chapters: [
        { title: 'Introduction', start_page: 1, end_page: 10 },
        { title: 'The Body', start_page: 11, end_page: 40 },
      ],
      page_count: 40,
    });

    await s().attachBookFile(bookId, { uri: 'file:///book.pdf', name: 'book.pdf' });

    expect(api.uploadBookFile).toHaveBeenCalledWith(bookId, {
      uri: 'file:///book.pdf',
      name: 'book.pdf',
    });
    expect(api.extractBookToc).toHaveBeenCalledWith('fk-1');

    const book = s().books.find(b => b.id === bookId)!;
    expect(book).toMatchObject({
      source_type: 'pdf',
      file_object_key: 'fk-1',
      file_name: 'book.pdf',
      page_count: 40,
    });

    const chapters = s().getBookChapters(bookId);
    expect(chapters).toHaveLength(2);
    expect(chapters.map(c => c.title)).toEqual(['Introduction', 'The Body']);
    expect(chapters.map(c => c.chapter_index)).toEqual([0, 1]);
    expect(chapters.every(c => c.book_id === bookId)).toBe(true);
  });
});

describe('book highlight CRUD', () => {
  it('adds, updates, and deletes a highlight surfaced via getBookHighlightsForChapter', async () => {
    const bookId = await s().addBook({
      title: 'HL Book',
      language: 'en',
      chapters: [{ title: 'Ch1' }],
    });
    const chapterId = s().getBookChapters(bookId)[0].id;

    // add
    await s().addBookHighlight({
      bookId,
      chapterId,
      text: 'a key idea',
      color: 'yellow',
      note: 'remember this',
    });
    let hls = s().getBookHighlightsForChapter(chapterId);
    expect(hls).toHaveLength(1);
    expect(hls[0]).toMatchObject({
      book_id: bookId,
      chapter_id: chapterId,
      text: 'a key idea',
      color: 'yellow',
      note: 'remember this',
    });
    const hlId = hls[0].id;

    // update color + note
    await s().updateBookHighlight(hlId, { color: 'green', note: 'updated note' });
    hls = s().getBookHighlightsForChapter(chapterId);
    expect(hls).toHaveLength(1);
    expect(hls[0]).toMatchObject({ id: hlId, color: 'green', note: 'updated note' });

    // delete
    await s().deleteBookHighlight(hlId);
    expect(s().getBookHighlightsForChapter(chapterId)).toHaveLength(0);
  });
});

describe('generateBookChapterQuestions — highlight-grounded', () => {
  it('passes the highlighted texts to generateBookQuestions via the highlights param', async () => {
    const bookId = await s().addBook({
      title: 'Grounded Book',
      language: 'en',
      chapters: [{ title: 'Ch1' }],
    });
    const chapterId = s().getBookChapters(bookId)[0].id;

    await s().addBookHighlight({ bookId, chapterId, text: 'the highlighted sentence' });
    const hlId = s().getBookHighlightsForChapter(chapterId)[0].id;

    (api.generateBookQuestions as jest.Mock).mockResolvedValue({
      questions: [{ type: 'open', prompt: 'Q', ideal_answer: 'a', rubric: ['x'] }],
    });

    const created = await s().generateBookChapterQuestions(chapterId, {
      types: ['open'],
      count: 1,
      highlightIds: [hlId],
    });

    expect(created).toBe(1);
    expect(api.generateBookQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ highlights: ['the highlighted sentence'] }),
    );
    // The generated question records its source highlight.
    const q = s().getBookQuestionsForChapter(chapterId)[0];
    expect(q.source_highlight_id).toBe(hlId);
  });
});
