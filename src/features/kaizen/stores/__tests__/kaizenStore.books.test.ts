/**
 * Unit coverage for the Kaizen (Kaizen) store's "Book Comprehension" actions
 * (Phases 1-3): addBook / chapters, generateBookChapterQuestions, and
 * submitBookAttempt for both mcq (locally scored) and open (AI graded) paths.
 *
 * The dependency boundary mirrors `kaizenStore.test.ts` exactly:
 *  - `../services/repository` is backed by an in-memory fake "DB" (a Map keyed by
 *    table name), so `upsertLocal` writes and `hydrate`'s `listActive`/`getProfile`
 *    reads round-trip for real — book actions are asserted through resulting state.
 *  - The AI api layer (`generateBookQuestions`, `gradeBookAnswer`) is a jest.fn stub
 *    so no network is touched. The FSRS scheduler stays REAL.
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

describe('addBook', () => {
  it('inserts one book and one chapter per ToC title with 0-based chapter_index', async () => {
    const bookId = await s().addBook({
      title: 'Atomic Habits',
      author: 'James Clear',
      language: 'en',
      chapters: [
        { title: 'The Fundamentals' },
        { title: 'The 1st Law' },
        { title: 'The 2nd Law' },
      ],
    });

    expect(typeof bookId).toBe('string');
    expect(s().books).toHaveLength(1);
    expect(s().books[0]).toMatchObject({
      id: bookId,
      title: 'Atomic Habits',
      author: 'James Clear',
      language: 'en',
      source_type: 'toc_only',
    });

    // getBookChapters returns them sorted by chapter_index.
    const chapters = s().getBookChapters(bookId);
    expect(chapters).toHaveLength(3);
    expect(chapters.every(c => c.book_id === bookId)).toBe(true);
    expect(chapters.map(c => c.chapter_index)).toEqual([0, 1, 2]);
    expect(chapters.map(c => c.title)).toEqual([
      'The Fundamentals',
      'The 1st Law',
      'The 2nd Law',
    ]);
    expect(s().bookChapters).toHaveLength(3);
  });
});

describe('generateBookChapterQuestions', () => {
  it('persists one book question per AI-returned item with FSRS defaults (reps 0, due_at set)', async () => {
    const bookId = await s().addBook({
      title: 'The Book',
      language: 'en',
      chapters: [{ title: 'Chapter One' }],
    });
    const chapterId = s().getBookChapters(bookId)[0].id;

    (api.generateBookQuestions as jest.Mock).mockResolvedValue({
      questions: [
        { type: 'mcq', prompt: 'Pick one', options: ['a', 'b', 'c', 'd'], answer_index: 1 },
        { type: 'open', prompt: 'Explain it', ideal_answer: 'Because...', rubric: ['x'] },
      ],
    });

    const created = await s().generateBookChapterQuestions(chapterId, {
      types: ['mcq', 'open'],
      count: 2,
    });

    expect(created).toBe(2);

    // The AI layer is called with the book + chapter context and requested types.
    expect(api.generateBookQuestions).toHaveBeenCalledTimes(1);
    expect(api.generateBookQuestions).toHaveBeenCalledWith(
      expect.objectContaining({
        bookTitle: 'The Book',
        chapterTitle: 'Chapter One',
        types: ['mcq', 'open'],
      }),
    );

    const qs = s().getBookQuestionsForChapter(chapterId);
    expect(qs).toHaveLength(2);
    expect(qs.every(q => q.reps === 0)).toBe(true);
    expect(qs.every(q => !!q.due_at)).toBe(true);
    expect(qs.map(q => q.type).sort()).toEqual(['mcq', 'open']);

    const mcq = qs.find(q => q.type === 'mcq')!;
    expect(mcq.answer_index).toBe(1);
    expect(JSON.parse(mcq.options as string)).toEqual(['a', 'b', 'c', 'd']);
    expect(mcq.desired_retention).toBe(0.9);
  });
});

describe('submitBookAttempt — mcq (locally scored, no AI call)', () => {
  async function seedMcqQuestion(answerIndex: number): Promise<string> {
    const bookId = await s().addBook({
      title: 'MCQ Book',
      language: 'en',
      chapters: [{ title: 'Ch1' }],
    });
    const chapterId = s().getBookChapters(bookId)[0].id;
    (api.generateBookQuestions as jest.Mock).mockResolvedValue({
      questions: [
        { type: 'mcq', prompt: 'Q?', options: ['a', 'b', 'c', 'd'], answer_index: answerIndex },
      ],
    });
    await s().generateBookChapterQuestions(chapterId, { types: ['mcq'], count: 1 });
    return s().getBookQuestionsForChapter(chapterId)[0].id;
  }

  it('records is_correct=1 / overall_score=1 for a correct choice and never calls gradeBookAnswer', async () => {
    const questionId = await seedMcqQuestion(1);

    await s().submitBookAttempt(questionId, { selectedIndex: 1 });

    expect(api.gradeBookAnswer).not.toHaveBeenCalled();
    expect(s().bookAttempts).toHaveLength(1);
    const attempt = s().bookAttempts[0];
    expect(attempt).toMatchObject({
      question_id: questionId,
      answer_source: 'mcq',
      selected_index: 1,
      is_correct: 1,
      overall_score: 1,
      content_score: 1,
      scored_offline: 1,
    });
  });

  it('records is_correct=0 / overall_score=0 for a wrong choice', async () => {
    const questionId = await seedMcqQuestion(1);

    await s().submitBookAttempt(questionId, { selectedIndex: 0 });

    expect(api.gradeBookAnswer).not.toHaveBeenCalled();
    expect(s().bookAttempts).toHaveLength(1);
    const attempt = s().bookAttempts[0];
    expect(attempt).toMatchObject({
      answer_source: 'mcq',
      selected_index: 0,
      is_correct: 0,
      overall_score: 0,
    });
  });
});

describe('submitBookAttempt — open (AI graded)', () => {
  it('persists the AI content score, files a deduped mistake, and reschedules via FSRS', async () => {
    const bookId = await s().addBook({
      title: 'Open Book',
      language: 'en',
      chapters: [{ title: 'Ch1' }],
    });
    const chapterId = s().getBookChapters(bookId)[0].id;
    (api.generateBookQuestions as jest.Mock).mockResolvedValue({
      questions: [
        { type: 'open', prompt: 'Describe X', ideal_answer: 'The ideal.', rubric: ['x'] },
      ],
    });
    await s().generateBookChapterQuestions(chapterId, { types: ['open'], count: 1 });
    const questionId = s().getBookQuestionsForChapter(chapterId)[0].id;

    (api.gradeBookAnswer as jest.Mock).mockResolvedValue({
      content_score: 0.8,
      overall_score: 0.75,
      feedback: 'ok',
      mistakes: [{ type: 'grammar', text: 'go', correction: 'went' }],
    });

    await s().submitBookAttempt(questionId, { answerText: 'Yesterday I go home' });

    expect(api.gradeBookAnswer).toHaveBeenCalledTimes(1);

    // Attempt persisted with the AI content/overall scores.
    expect(s().bookAttempts).toHaveLength(1);
    const attempt = s().bookAttempts[0];
    expect(attempt).toMatchObject({
      question_id: questionId,
      answer_source: 'typed',
      answer_text: 'Yesterday I go home',
      content_score: 0.8,
      overall_score: 0.75,
      feedback: 'ok',
    });

    // A recurring-mistake ticket was filed with a dedup key.
    expect(s().bookMistakes).toHaveLength(1);
    const mistake = s().bookMistakes[0];
    expect(mistake).toMatchObject({
      book_id: bookId,
      type: 'grammar',
      text: 'go',
      correction: 'went',
      status: 'detected',
    });
    expect(mistake.dedup_key).toBe('grammar|go');
    expect(rowsIn('kaizen_book_mistakes')).toHaveLength(1);

    // The question's memory state advanced (FSRS reschedule). An overall score of
    // 0.75 maps to FSRS rating 1 (a lapse), so the scheduler stamps a fresh review
    // and increments `lapses` rather than `reps` — assert the reschedule that
    // actually occurs.
    const q = s().getBookQuestionsForChapter(chapterId).find(x => x.id === questionId)!;
    expect(q.last_reviewed_at).toBeTruthy();
    expect(q.due_at).toBeTruthy();
    expect(q.lapses).toBe(1);
    expect(q.stability).not.toBeNull();
  });
});
