/**
 * Supplemental coverage for the Kaizen (Kaizen) Zustand store.
 *
 * This file drives the actions and branches that `kaizenStore.test.ts`,
 * `kaizenStore.books.test.ts`, and `kaizenStore.books-phase45.test.ts` don't
 * reach yet — the simple CRUD block (gtd / knowledge / deep-work / weekly review
 * / career setup), skill activation transitions, the AI generate-then-judge path
 * of `submitInterviewAttempt`, coach + memory + system-activation orchestration,
 * habit-stack step/action cleanup, resume analysis, and the book chapter/mistake/
 * text extraction fallbacks and error paths.
 *
 * The dependency boundary mirrors the sibling suites exactly:
 *  - `../services/repository` is backed by an in-memory fake "DB" (a Map keyed by
 *    table name), so `upsertLocal` writes and `hydrate`'s `listActive`/`getProfile`
 *    reads round-trip for real — actions are asserted through resulting state.
 *  - The AI api layer is a jest.fn stub so no network is touched. FSRS, taskCatalog,
 *    questionDedup and focusMode stay REAL.
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
  buildKaizenContextSnapshot: jest.fn(() => ({ snapshot: true })),
}));
jest.mock('../../services/wakeDetection', () => ({
  wakeDetection: { isConfirmed: jest.fn(() => false), confirm: jest.fn(), clear: jest.fn() },
}));
jest.mock('../../services/aiDisclosure', () => ({
  getAIDisclosureAck: jest.fn(() => false),
  setAIDisclosureAck: jest.fn(),
}));

import * as api from '../../api/kaizen';
import { LifeSystem } from '../../constants';
import { buildKaizenContextSnapshot } from '../../services/contextSnapshot';
import { scheduleDailyCoreReminders } from '../../services/reminders';
import * as repo from '../../services/repository';
import { runKaizenSync } from '../../services/sync';
import { wakeDetection } from '../../services/wakeDetection';
import { watchSync } from '../../services/watchSync';
import { useKaizenStore } from '../kaizenStore';

// --- in-memory fake DB backing the repository mock -------------------------

type Row = Record<string, any>;
const db = new Map<string, Row[]>();

function seed(table: string, row: Row): void {
  const rows = db.get(table) ?? [];
  rows.push({ ...row });
  db.set(table, rows);
}

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

// --- entry builders --------------------------------------------------------

const iso = () => new Date().toISOString();

function makeProfile(over: Partial<Row> = {}): Row {
  return {
    id: 'p1',
    user_id: 'u1',
    timezone: 'UTC',
    onboarding_complete: 0,
    enabled_systems: null,
    system_activation_states: null,
    primary_system: 'career',
    daily_core_ids: null,
    career_setup_step: null,
    target_roles: null,
    career_goal_types: null,
    selected_career_skill_ids: null,
    resume_source_name: null,
    resume_summary: null,
    career_plan_summary: null,
    interaction_style: null,
    created_at: iso(),
    updated_at: iso(),
    deleted_at: null,
    ...over,
  };
}

function makeAction(over: Partial<Row> = {}): Row {
  return {
    id: 'a1',
    user_id: 'u1',
    title: 'Action',
    system: 'career',
    rhythm: 'daily',
    linked_feature: null,
    is_daily_core: 1,
    sort_order: 0,
    time_of_day: 'anytime',
    stack_id: null,
    rotation_day: null,
    reminder_anchor: null,
    reminder_policy: null,
    watch_quick_log_enabled: 0,
    voice_log_prompt: null,
    input_description: null,
    output_description: null,
    is_archived: 0,
    created_at: iso(),
    updated_at: iso(),
    deleted_at: null,
    ...over,
  };
}

function makeQuestion(over: Partial<Row> = {}): Row {
  return {
    id: 'q1',
    user_id: 'u1',
    prompt: 'What is a closure?',
    question_bank: 'technical',
    kind: null,
    purpose: 'practice',
    linked_skill_id: null,
    linked_concept_id: null,
    concept_band: null,
    difficulty_0_to_100: null,
    topic_tags: null,
    import_source: 'manual',
    import_batch_id: null,
    source_document_name: null,
    source_hash: null,
    import_review_status: 'approved',
    ideal_answer: null,
    rubric: null,
    judge_model: null,
    ideal_answer_version: 1,
    baseline_attempt_id: null,
    stability: null,
    difficulty: null,
    retrievability: null,
    reps: 0,
    lapses: 0,
    last_reviewed_at: null,
    due_at: null,
    desired_retention: 0.9,
    created_at: iso(),
    updated_at: iso(),
    deleted_at: null,
    ...over,
  };
}

function makeBookQuestion(over: Partial<Row> = {}): Row {
  return {
    id: 'bq1',
    user_id: 'u1',
    book_id: 'b1',
    chapter_id: 'c1',
    type: 'open',
    prompt: 'Explain X',
    options: null,
    answer_index: null,
    ideal_answer: 'ideal',
    rubric: JSON.stringify(['clarity']),
    language: 'en',
    difficulty_0_to_100: null,
    source_highlight_id: null,
    stability: null,
    difficulty: null,
    retrievability: null,
    reps: 0,
    lapses: 0,
    last_reviewed_at: null,
    due_at: iso(),
    desired_retention: 0.9,
    created_at: iso(),
    updated_at: iso(),
    deleted_at: null,
    ...over,
  };
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
const upsertsFor = (table: string) =>
  (repo.upsertLocal as jest.Mock).mock.calls.filter(c => c[0] === table);

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
  (api.generateIdealAnswer as jest.Mock).mockResolvedValue({});
  (api.scoreInterviewAnswer as jest.Mock).mockResolvedValue({});
  (api.analyzeCareerResume as jest.Mock).mockResolvedValue({ summary: 'from-ai' });
  (api.postCoachMessage as jest.Mock).mockResolvedValue({ reply: 'hi' });
  useKaizenStore.setState({ ...INITIAL_DATA } as any);
});

afterEach(async () => {
  await flush();
});

// ---------------------------------------------------------------------------

describe('confirmWake', () => {
  it('confirms the wake, flips the flag and reschedules reminders', async () => {
    await s().confirmWake();

    expect(wakeDetection.confirm).toHaveBeenCalledWith('u1');
    expect(s().wakeConfirmedToday).toBe(true);
    expect(scheduleDailyCoreReminders).toHaveBeenCalled();
    expect(watchSync.pushTodaySummary).toHaveBeenCalled();
  });
});

describe('finishOnboarding — profile-resolution branches', () => {
  it('hydrates a persisted-but-unloaded profile, then flips onboarding complete', async () => {
    // Profile exists in the DB but the store hasn't loaded it (profile === null).
    seed('kaizen_profiles', makeProfile({ onboarding_complete: 0 }));
    expect(s().profile).toBeNull();

    await s().finishOnboarding();

    expect(s().profile?.onboarding_complete).toBe(1);
  });

  it('no-ops when there is no profile anywhere', async () => {
    await s().finishOnboarding();

    expect(s().profile).toBeNull();
    expect(upsertsFor('kaizen_profiles')).toHaveLength(0);
  });
});

describe('resetOnboarding', () => {
  it('flips a completed profile back to incomplete and clears the career step', async () => {
    seed(
      'kaizen_profiles',
      makeProfile({ onboarding_complete: 1, career_setup_step: 'complete' }),
    );
    await s().hydrate();

    await s().resetOnboarding();

    expect(s().profile?.onboarding_complete).toBe(0);
    expect(s().profile?.career_setup_step).toBeNull();
  });

  it('hydrates a persisted-but-unloaded profile before resetting', async () => {
    seed('kaizen_profiles', makeProfile({ onboarding_complete: 1 }));
    expect(s().profile).toBeNull();

    await s().resetOnboarding();

    expect(s().profile?.onboarding_complete).toBe(0);
  });

  it('no-ops when there is no profile anywhere', async () => {
    await s().resetOnboarding();

    expect(s().profile).toBeNull();
    expect(upsertsFor('kaizen_profiles')).toHaveLength(0);
  });
});

describe('simple capture CRUD', () => {
  it('addGtdItem inserts an inbox item', async () => {
    await s().addGtdItem('capture this');
    expect(s().gtd).toHaveLength(1);
    expect(s().gtd[0]).toMatchObject({ title: 'capture this', status: 'inbox' });
  });

  it('updateGtdStatus moves an item and no-ops on an unknown id', async () => {
    await s().addGtdItem('capture this');
    const id = s().gtd[0].id;

    await s().updateGtdStatus(id, 'next');
    expect(s().gtd[0].status).toBe('next');

    await s().updateGtdStatus('missing', 'done');
    // no extra upsert beyond the two real writes (create + status change)
    expect(upsertsFor('kaizen_gtd_items')).toHaveLength(2);
  });

  it('addKnowledgeItem stores content + tags when provided', async () => {
    await s().addKnowledgeItem('Note', 'resource', 'body text', 'tag1,tag2');
    expect(s().knowledge).toHaveLength(1);
    expect(s().knowledge[0]).toMatchObject({
      title: 'Note',
      para_type: 'resource',
      content: 'body text',
      tags: 'tag1,tag2',
    });
  });

  it('addKnowledgeItem defaults optional content + tags to null', async () => {
    await s().addKnowledgeItem('Bare', 'area');
    expect(s().knowledge[0]).toMatchObject({ title: 'Bare', content: null, tags: null });
  });

  it('addDeepWorkBlock stores a scheduled block with focus suggestion', async () => {
    await s().addDeepWorkBlock('Refactor', '09:00', '10:30', true);
    expect(s().deepWork).toHaveLength(1);
    expect(s().deepWork[0]).toMatchObject({
      topic: 'Refactor',
      start_time: '09:00',
      end_time: '10:30',
      suggest_focus_mode: 1,
    });
  });

  it('addDeepWorkBlock defaults times to null and can disable the focus suggestion', async () => {
    await s().addDeepWorkBlock('Reading', undefined, undefined, false);
    expect(s().deepWork[0]).toMatchObject({
      topic: 'Reading',
      start_time: null,
      end_time: null,
      suggest_focus_mode: 0,
    });
  });

  it('saveWeeklyReview records the week entry', async () => {
    await s().saveWeeklyReview({ wins: 'shipped', improvements: 'sleep', onePercentChange: 'read' });
    expect(s().reviews).toHaveLength(1);
    expect(s().reviews[0]).toMatchObject({
      wins: 'shipped',
      improvements: 'sleep',
      one_percent_change: 'read',
    });
  });
});

describe('saveCareerSetup', () => {
  it('writes career fields onto the existing profile (keeping the prior resume summary)', async () => {
    seed('kaizen_profiles', makeProfile({ resume_summary: 'old summary' }));
    await s().hydrate();

    await s().saveCareerSetup({
      targetRoles: ['Staff Eng'],
      goalTypes: ['promo'],
      step: 'skills',
    });

    const profile = s().profile;
    expect(JSON.parse(profile?.target_roles ?? '[]')).toEqual(['Staff Eng']);
    expect(JSON.parse(profile?.career_goal_types ?? '[]')).toEqual(['promo']);
    expect(profile?.career_setup_step).toBe('skills');
    expect(profile?.resume_summary).toBe('old summary'); // untouched when not supplied
  });

  it('overwrites the resume summary when supplied and resolves the profile from the DB', async () => {
    // Profile lives in the DB but the store hasn't loaded it — exercises the
    // `get().profile ?? getProfile(uid)` fallback.
    seed('kaizen_profiles', makeProfile());
    await s().saveCareerSetup({
      targetRoles: [],
      goalTypes: [],
      resumeSummary: 'new summary',
      resumeSourceName: 'resume.pdf',
      step: 'resume',
    });
    expect(s().profile?.resume_summary).toBe('new summary');
    expect(s().profile?.resume_source_name).toBe('resume.pdf');
  });

  it('no-ops when no profile can be resolved', async () => {
    await s().saveCareerSetup({ targetRoles: [], goalTypes: [], step: 'roles' });
    expect(upsertsFor('kaizen_profiles')).toHaveLength(0);
  });
});

describe('skill activation transitions', () => {
  async function seedSkill(): Promise<string> {
    await s().addSkill('TypeScript');
    return s().skills[0].id;
  }

  it('activateSkillForTraining sets the state to active', async () => {
    const id = await seedSkill();
    // move it off "active" first so the transition is observable
    await s().pauseSkill(id);
    expect(s().skills[0].activation_state).toBe('paused');

    await s().activateSkillForTraining(id);
    expect(s().skills[0].activation_state).toBe('active');
  });

  it('backlogSkill sets the state to backlog', async () => {
    const id = await seedSkill();
    await s().backlogSkill(id);
    expect(s().skills[0].activation_state).toBe('backlog');
  });

  it('all three transitions no-op on an unknown skill id', async () => {
    await s().activateSkillForTraining('nope');
    await s().pauseSkill('nope');
    await s().backlogSkill('nope');
    expect(upsertsFor('kaizen_skill_nodes')).toHaveLength(0);
  });
});

describe('submitInterviewAttempt — AI generate-then-judge path', () => {
  it('generates the ideal answer + rubric, then judges the answer', async () => {
    // Inject an UNFROZEN question directly so the in-place back-fill at the top of
    // the generate branch (question.ideal_answer = ...) can run.
    useKaizenStore.setState({
      questions: [makeQuestion({ id: 'qgen', ideal_answer: null, rubric: null })],
    } as any);

    (api.generateIdealAnswer as jest.Mock).mockResolvedValue({
      ideal_answer: 'The ideal answer.',
      rubric: ['clarity', 'depth'],
      model: 'gen-model',
    });
    (api.scoreInterviewAnswer as jest.Mock).mockResolvedValue({
      overall_score: 5,
      reasoning: 'excellent',
      model: 'judge-model',
    });

    await s().submitInterviewAttempt('qgen', 'my answer', 2, { useAI: true });

    expect(api.generateIdealAnswer).toHaveBeenCalledTimes(1);
    expect(api.scoreInterviewAnswer).toHaveBeenCalledTimes(1);
    const attempt = s().attempts[0];
    expect(attempt.overall_score).toBe(5); // AI judge score wins over the self-score
    expect(attempt.scored_offline).toBe(0);
    expect(attempt.judge_model).toBe('judge-model');
  });

  it('falls back to the self-score when ideal-answer generation fails', async () => {
    seed('kaizen_interview_questions', makeQuestion({ id: 'qfail', ideal_answer: null, rubric: null }));
    await s().hydrate();
    (api.generateIdealAnswer as jest.Mock).mockRejectedValue(new Error('AI down'));

    await s().submitInterviewAttempt('qfail', 'my answer', 3, { useAI: true });

    expect(api.generateIdealAnswer).toHaveBeenCalledTimes(1);
    expect(api.scoreInterviewAnswer).not.toHaveBeenCalled(); // no ideal/rubric to judge against
    const attempt = s().attempts[0];
    expect(attempt.overall_score).toBe(3);
    expect(attempt.scored_offline).toBe(1);
  });
});

describe('hydrateAttempts', () => {
  it('delegates to hydrate', async () => {
    seed('kaizen_interview_attempts', {
      id: 'at1',
      user_id: 'u1',
      question_id: 'q1',
      attempted_at: iso(),
      answer_text: 'x',
      overall_score: 3,
      deleted_at: null,
    });

    await s().hydrateAttempts();

    expect(s().isHydrated).toBe(true);
    expect(s().attempts).toHaveLength(1);
  });
});

describe('sendCoachMessage', () => {
  it('posts the running history plus the new user turn with a snapshot', async () => {
    await s().sendCoachMessage(
      'How am I doing?',
      [{ role: 'assistant', content: 'earlier reply' }],
      true,
      'sess-1',
    );

    expect(api.postCoachMessage).toHaveBeenCalledTimes(1);
    const arg = (api.postCoachMessage as jest.Mock).mock.calls[0][0];
    expect(arg.messages).toEqual([
      { role: 'assistant', content: 'earlier reply' },
      { role: 'user', content: 'How am I doing?' },
    ]);
    expect(arg.session_id).toBe('sess-1');
    expect(arg.disclosure_ack).toBe(true);
    expect(buildKaizenContextSnapshot).toHaveBeenCalled();
  });
});

describe('setSystemActivation', () => {
  it('merges the new activation state into the parsed profile map', async () => {
    seed(
      'kaizen_profiles',
      makeProfile({ system_activation_states: JSON.stringify({ career: 'enabled' }) }),
    );
    await s().hydrate();

    await s().setSystemActivation('health', 'paused');

    const states = JSON.parse(s().profile?.system_activation_states ?? '{}');
    expect(states).toEqual({ career: 'enabled', health: 'paused' });
  });

  it('resets an unparseable legacy state map and resolves the profile from the DB', async () => {
    // Profile in DB only (store not hydrated) with corrupt JSON — hits both the
    // `?? getProfile` fallback and the JSON.parse catch.
    seed('kaizen_profiles', makeProfile({ system_activation_states: 'not-json' }));

    await s().setSystemActivation('career', 'enabled');

    const states = JSON.parse(s().profile?.system_activation_states ?? '{}');
    expect(states).toEqual({ career: 'enabled' });
  });

  it('no-ops when no profile can be resolved', async () => {
    await s().setSystemActivation('career', 'enabled');
    expect(upsertsFor('kaizen_profiles')).toHaveLength(0);
  });
});

describe('materializeSystemTasks', () => {
  it('writes an action per materialized custom task and surfaces daily-core ones', async () => {
    await s().materializeSystemTasks(LifeSystem.Career, [], [
      { title: 'Ship a PR', outputDescription: 'merged PR', suggestedDailyCore: true },
    ]);

    expect(upsertsFor('kaizen_actions')).toHaveLength(1);
    expect(s().dailyCore).toHaveLength(1);
    expect(s().dailyCore[0].title).toBe('Ship a PR');
  });
});

describe('upsertHabitStack — re-ordering and detaching prior members', () => {
  it('soft-deletes dropped steps and clears stack_id from removed actions', async () => {
    seed('kaizen_actions', makeAction({ id: 'a1', is_daily_core: 0 }));
    seed('kaizen_actions', makeAction({ id: 'a2', is_daily_core: 0 }));
    await s().hydrate();

    // Create the stack with both actions.
    await s().upsertHabitStack('Morning', ['a1', 'a2']);
    const stackId = s().habitStacks[0].id;
    expect(s().habitStackSteps).toHaveLength(2);

    // Seed a defensive orphan step with a null action_id to exercise that branch.
    seed('kaizen_habit_stack_steps', {
      id: `${stackId}-orphan`,
      user_id: 'u1',
      stack_id: stackId,
      action_id: null,
      sort_order: 9,
      created_at: iso(),
      updated_at: iso(),
      deleted_at: null,
    });
    await s().hydrate();

    // Re-upsert the same stack with only a1 — a2's step + the orphan get pruned and
    // a2's action loses its stack_id.
    await s().upsertHabitStack('Morning', ['a1'], stackId);

    expect(repo.softDelete).toHaveBeenCalledWith('kaizen_habit_stack_steps', `${stackId}-a2`);
    expect(repo.softDelete).toHaveBeenCalledWith('kaizen_habit_stack_steps', `${stackId}-orphan`);
    expect(s().habitStackSteps).toHaveLength(1);
    expect(s().habitStackSteps[0].action_id).toBe('a1');

    const a2 = rowsIn('kaizen_actions').find(a => a.id === 'a2');
    expect(a2?.stack_id).toBeNull();
    const a1 = rowsIn('kaizen_actions').find(a => a.id === 'a1');
    expect(a1?.stack_id).toBe(stackId);
  });
});

describe('generateIdealAnswerForQuestion', () => {
  it('stores the generated ideal answer + rubric and bumps the version', async () => {
    seed('kaizen_interview_questions', makeQuestion({ id: 'q1', ideal_answer_version: 1 }));
    await s().hydrate();
    (api.generateIdealAnswer as jest.Mock).mockResolvedValue({
      ideal_answer: 'A great answer.',
      rubric: JSON.stringify(['x']),
      model: 'gen-model',
    });

    await s().generateIdealAnswerForQuestion('q1');

    const q = s().questions.find(x => x.id === 'q1');
    expect(q?.ideal_answer).toBe('A great answer.');
    expect(q?.judge_model).toBe('gen-model');
    expect(q?.ideal_answer_version).toBe(2);
  });

  it('no-ops on an unknown question id', async () => {
    await s().generateIdealAnswerForQuestion('missing');
    expect(api.generateIdealAnswer).not.toHaveBeenCalled();
    expect(upsertsFor('kaizen_interview_questions')).toHaveLength(0);
  });

  it('keeps the prior fields when the generator returns blanks', async () => {
    seed(
      'kaizen_interview_questions',
      makeQuestion({ id: 'q2', ideal_answer: 'keep', rubric: 'keep-rubric', judge_model: 'keep-model' }),
    );
    await s().hydrate();
    (api.generateIdealAnswer as jest.Mock).mockResolvedValue({});

    await s().generateIdealAnswerForQuestion('q2');

    const q = s().questions.find(x => x.id === 'q2');
    expect(q?.ideal_answer).toBe('keep');
    expect(q?.rubric).toBe('keep-rubric');
    expect(q?.judge_model).toBe('keep-model');
  });
});

describe('buildCoachSnapshot', () => {
  it('returns the context snapshot object', () => {
    const snapshot = s().buildCoachSnapshot();
    expect(buildKaizenContextSnapshot).toHaveBeenCalled();
    expect(snapshot).toEqual({ snapshot: true });
  });
});

describe('analyzeResume', () => {
  it('returns the AI analysis when it succeeds', async () => {
    (api.analyzeCareerResume as jest.Mock).mockResolvedValue({
      summary: 'AI summary',
      target_roles: ['SWE'],
    });
    const result = await s().analyzeResume('long resume text');
    expect(result).toEqual({ summary: 'AI summary', target_roles: ['SWE'] });
  });

  it('falls back to a truncated summary when analysis fails', async () => {
    (api.analyzeCareerResume as jest.Mock).mockRejectedValue(new Error('AI down'));
    const long = 'x'.repeat(400);
    const result = await s().analyzeResume(long);
    expect(result.summary).toHaveLength(280);
  });
});

// ===========================================================================
// Book Comprehension — remaining chapter / mistake / extraction paths
// ===========================================================================

describe('addBookChapter', () => {
  it('appends a chapter with chapter_index equal to the existing count', async () => {
    const bookId = await s().addBook({
      title: 'Book',
      language: 'en',
      chapters: [{ title: 'Ch1' }],
    });

    const chapterId = await s().addBookChapter(bookId, {
      title: 'Ch2',
      startPage: 20,
      endPage: 40,
    });

    expect(typeof chapterId).toBe('string');
    const chapters = s().getBookChapters(bookId);
    expect(chapters).toHaveLength(2);
    expect(chapters[1]).toMatchObject({
      title: 'Ch2',
      chapter_index: 1,
      start_page: 20,
      end_page: 40,
    });
  });
});

describe('deleteBook', () => {
  it('soft-deletes the book together with its chapters, questions and highlights', async () => {
    const bookId = await s().addBook({
      title: 'Doomed',
      language: 'en',
      chapters: [{ title: 'Ch1' }],
    });
    const chapterId = s().getBookChapters(bookId)[0].id;
    await s().addBookHighlight({ bookId, chapterId, text: 'note' });
    (api.generateBookQuestions as jest.Mock).mockResolvedValue({
      questions: [{ type: 'open', prompt: 'Q', ideal_answer: 'a', rubric: ['x'] }],
    });
    await s().generateBookChapterQuestions(chapterId, { types: ['open'], count: 1 });

    expect(s().books).toHaveLength(1);
    expect(s().bookChapters).toHaveLength(1);
    expect(s().bookQuestions).toHaveLength(1);
    expect(s().bookHighlights).toHaveLength(1);

    await s().deleteBook(bookId);

    expect(repo.softDelete).toHaveBeenCalledWith('kaizen_books', bookId);
    expect(s().books).toHaveLength(0);
    expect(s().bookChapters).toHaveLength(0);
    expect(s().bookQuestions).toHaveLength(0);
    expect(s().bookHighlights).toHaveLength(0);
  });
});

describe('markBookChapterRead', () => {
  it('stamps read_at on the chapter', async () => {
    const bookId = await s().addBook({
      title: 'Read Me',
      language: 'en',
      chapters: [{ title: 'Ch1' }],
    });
    const chapterId = s().getBookChapters(bookId)[0].id;

    await s().markBookChapterRead(chapterId);

    expect(s().getBookChapters(bookId)[0].read_at).toBeTruthy();
  });

  it('no-ops on an unknown chapter id', async () => {
    await s().markBookChapterRead('missing');
    expect(upsertsFor('kaizen_book_chapters')).toHaveLength(0);
  });
});

describe('attachBookFile — book already has chapters', () => {
  it('uploads the file but skips ToC auto-detection when chapters already exist', async () => {
    const bookId = await s().addBook({
      title: 'Has Chapters',
      language: 'en',
      chapters: [{ title: 'Existing Ch' }],
    });
    (api.uploadBookFile as jest.Mock).mockResolvedValue({
      fileKey: 'fk-9',
      fileName: 'has.pdf',
      size: 1,
    });

    await s().attachBookFile(bookId, { uri: 'file:///has.pdf', name: 'has.pdf' });

    expect(api.uploadBookFile).toHaveBeenCalled();
    expect(api.extractBookToc).not.toHaveBeenCalled(); // existingChapters.length > 0
    const book = s().books.find(b => b.id === bookId)!;
    expect(book).toMatchObject({ source_type: 'pdf', file_object_key: 'fk-9', file_name: 'has.pdf' });
    expect(s().getBookChapters(bookId)).toHaveLength(1); // unchanged
  });

  it('no-ops on an unknown book id', async () => {
    await s().attachBookFile('missing', { uri: 'file:///x.pdf', name: 'x.pdf' });
    expect(api.uploadBookFile).not.toHaveBeenCalled();
  });
});

describe('generateBookChapterQuestions — PDF-grounded extraction', () => {
  async function seedPdfBook(): Promise<{ bookId: string; firstChapterId: string }> {
    const bookId = await s().addBook({
      title: 'PDF Grounded',
      language: 'en',
      sourceType: 'pdf',
      chapters: [{ title: 'Beta' }, { title: 'Alpha' }],
    });
    // Give the book a file key so the PDF-extract branch fires.
    const books = db.get('kaizen_books')!;
    books[0] = { ...books[0], file_object_key: 'fk-grounded' };
    await s().hydrate();
    const firstChapterId = s().getBookChapters(bookId)[0].id;
    return { bookId, firstChapterId };
  }

  it('extracts the chapter text and passes a sorted ToC context to the generator', async () => {
    const { firstChapterId } = await seedPdfBook();
    (api.extractBookChapter as jest.Mock).mockResolvedValue({
      text: 'chapter body',
      contentKey: 'ck-1',
    });
    (api.generateBookQuestions as jest.Mock).mockResolvedValue({
      questions: [
        { type: 'mcq', prompt: 'Q', options: ['a', 'b'], answer_index: 0, difficulty_0_to_100: 42.6 },
      ],
    });

    const created = await s().generateBookChapterQuestions(firstChapterId);

    expect(created).toBe(1);
    expect(api.extractBookChapter).toHaveBeenCalledWith(
      expect.objectContaining({ fileKey: 'fk-grounded' }),
    );
    const arg = (api.generateBookQuestions as jest.Mock).mock.calls[0][0];
    expect(arg.chapterText).toBe('chapter body');
    // ToC context sorted by chapter_index (Beta index 0, Alpha index 1).
    expect(arg.tocContext).toBe('1. Beta\n2. Alpha');
    const q = s().getBookQuestionsForChapter(firstChapterId)[0];
    expect(q.difficulty_0_to_100).toBe(43); // rounded
  });

  it('tolerates an extraction failure and generates from titles only', async () => {
    const { firstChapterId } = await seedPdfBook();
    (api.extractBookChapter as jest.Mock).mockRejectedValue(new Error('extract failed'));
    (api.generateBookQuestions as jest.Mock).mockResolvedValue({
      questions: [{ type: 'open', prompt: 'Q', ideal_answer: 'a', rubric: ['x'] }],
    });

    const created = await s().generateBookChapterQuestions(firstChapterId, {
      highlightIds: ['does-not-exist'],
    });

    expect(created).toBe(1);
    const arg = (api.generateBookQuestions as jest.Mock).mock.calls[0][0];
    expect(arg.chapterText).toBeNull();
    expect(arg.highlights).toBeUndefined(); // unresolved highlight ids drop out
  });

  it('returns 0 when the chapter is missing', async () => {
    expect(await s().generateBookChapterQuestions('missing')).toBe(0);
  });

  it('returns 0 when the chapter has no owning book', async () => {
    seed('kaizen_book_chapters', {
      id: 'orphanCh',
      user_id: 'u1',
      book_id: 'no-such-book',
      chapter_index: 0,
      title: 'Orphan',
      status: 'none',
      deleted_at: null,
    });
    await s().hydrate();
    expect(await s().generateBookChapterQuestions('orphanCh')).toBe(0);
  });
});

describe('submitBookAttempt — mistake regression + grading failure', () => {
  async function seedOpenQuestion(): Promise<string> {
    const bookId = await s().addBook({
      title: 'Open Book',
      language: 'en',
      chapters: [{ title: 'Ch1' }],
    });
    const chapterId = s().getBookChapters(bookId)[0].id;
    (api.generateBookQuestions as jest.Mock).mockResolvedValue({
      questions: [{ type: 'open', prompt: 'Describe', ideal_answer: 'ideal', rubric: ['x'] }],
    });
    await s().generateBookChapterQuestions(chapterId, { types: ['open'], count: 1 });
    return s().getBookQuestionsForChapter(chapterId)[0].id;
  }

  it('increments regression_count when the same mistake recurs', async () => {
    const questionId = await seedOpenQuestion();

    (api.gradeBookAnswer as jest.Mock).mockResolvedValue({
      content_score: 0.5,
      overall_score: 0.5,
      feedback: 'again',
      mistakes: [{ type: 'grammar', text: 'go', correction: 'went' }],
    });

    await s().submitBookAttempt(questionId, { answerText: 'I go' });
    expect(s().bookMistakes).toHaveLength(1);
    expect(s().bookMistakes[0].regression_count).toBe(0);

    await s().submitBookAttempt(questionId, { answerText: 'I go again' });
    expect(s().bookMistakes).toHaveLength(1); // deduped, not a new row
    expect(s().bookMistakes[0].regression_count).toBe(1);
  });

  it('records an unscored attempt with no mistakes when the AI grader is unavailable', async () => {
    const questionId = await seedOpenQuestion();
    (api.gradeBookAnswer as jest.Mock).mockRejectedValue(new Error('grader down'));

    await s().submitBookAttempt(questionId, { answerText: 'anything' });

    expect(s().bookAttempts).toHaveLength(1);
    expect(s().bookAttempts[0].feedback).toBe('Saved. AI grading is temporarily unavailable.');
    expect(s().bookMistakes).toHaveLength(0);
  });

  it('grades an answer with no mistakes returned', async () => {
    const questionId = await seedOpenQuestion();
    (api.gradeBookAnswer as jest.Mock).mockResolvedValue({
      content_score: 1,
      overall_score: 1,
      feedback: 'great',
      mistakes: [],
    });

    await s().submitBookAttempt(questionId, { answerText: 'perfect' });

    expect(s().bookAttempts[0].mistakes).toBeNull();
    expect(s().bookMistakes).toHaveLength(0);
  });

  it('no-ops on an unknown question id', async () => {
    await s().submitBookAttempt('missing', { answerText: 'x' });
    expect(s().bookAttempts).toHaveLength(0);
  });
});

describe('submitSpokenBookAttempt — mistake regression + grading failure', () => {
  it('increments regression_count when a spoken mistake recurs', async () => {
    seed('kaizen_book_questions', makeBookQuestion({ id: 'sq1', type: 'spoken' }));
    // A prior mistake with a matching dedup key so fileMistake hits the regression branch.
    seed('kaizen_book_mistakes', {
      id: 'm-existing',
      user_id: 'u1',
      book_id: 'b1',
      type: 'grammar',
      text: 'go',
      correction: null,
      explanation: null,
      severity: null,
      status: 'detected',
      dedup_key: 'grammar|go',
      regression_count: 2,
      srs_state: null,
      due_at: iso(),
      last_seen_at: iso(),
      created_at: iso(),
      updated_at: iso(),
      deleted_at: null,
    });
    await s().hydrate();

    (api.gradeSpokenBookAnswer as jest.Mock).mockResolvedValue({
      transcription: 'I go there',
      content_score: 0.6,
      overall_score: 0.6,
      feedback: 'ok',
      mistakes: [{ type: 'grammar', text: 'go', correction: 'went' }],
      pronunciation: { words: [] },
      delivery: null,
    });

    await s().submitSpokenBookAttempt('sq1', { uri: 'file:///a.m4a' });

    expect(s().bookMistakes).toHaveLength(1); // deduped
    expect(s().bookMistakes[0].regression_count).toBe(3);
  });

  it('records an unscored spoken attempt when the audio grader is unavailable', async () => {
    seed('kaizen_book_questions', makeBookQuestion({ id: 'sq2', type: 'spoken' }));
    await s().hydrate();
    (api.gradeSpokenBookAnswer as jest.Mock).mockRejectedValue(new Error('grader down'));

    await s().submitSpokenBookAttempt('sq2', { uri: 'file:///a.m4a' });

    expect(s().bookAttempts).toHaveLength(1);
    expect(s().bookAttempts[0].feedback).toBe('Saved. AI grading is temporarily unavailable.');
    expect(s().bookAttempts[0].transcription).toBeNull();
  });

  it('no-ops on an unknown question id', async () => {
    await s().submitSpokenBookAttempt('missing', { uri: 'file:///a.m4a' });
    expect(s().bookAttempts).toHaveLength(0);
  });
});

describe('readChapterText — fetch/extract fallbacks', () => {
  async function seedPdfChapter(over: Row = {}): Promise<{ bookId: string; chapterId: string }> {
    const bookId = await s().addBook({
      title: 'PDF',
      language: 'en',
      sourceType: 'pdf',
      chapters: [{ title: 'Ch1' }],
    });
    const books = db.get('kaizen_books')!;
    books[0] = { ...books[0], file_object_key: 'fk' };
    if (Object.keys(over).length) {
      const chapters = db.get('kaizen_book_chapters')!;
      chapters[0] = { ...chapters[0], ...over };
    }
    await s().hydrate();
    const chapterId = s().getBookChapters(bookId)[0].id;
    return { bookId, chapterId };
  }

  it('falls through to extraction when the cached text is empty', async () => {
    const { chapterId } = await seedPdfChapter({ content_object_key: 'ck-empty' });
    (api.fetchBookChapterText as jest.Mock).mockResolvedValue({ text: '' });
    (api.extractBookChapter as jest.Mock).mockResolvedValue({ text: 'extracted', contentKey: 'ck-new' });

    const text = await s().readChapterText(chapterId);

    expect(api.fetchBookChapterText).toHaveBeenCalledWith('ck-empty');
    expect(api.extractBookChapter).toHaveBeenCalled();
    expect(text).toBe('extracted');
  });

  it('falls through to extraction when the cached fetch throws', async () => {
    const { chapterId } = await seedPdfChapter({ content_object_key: 'ck-boom' });
    (api.fetchBookChapterText as jest.Mock).mockRejectedValue(new Error('cache miss'));
    (api.extractBookChapter as jest.Mock).mockResolvedValue({ text: 'extracted2', contentKey: 'ck-2' });

    const text = await s().readChapterText(chapterId);

    expect(text).toBe('extracted2');
  });

  it('returns "" when on-demand extraction fails', async () => {
    const { chapterId } = await seedPdfChapter();
    (api.extractBookChapter as jest.Mock).mockRejectedValue(new Error('extract failed'));

    const text = await s().readChapterText(chapterId);

    expect(text).toBe('');
  });

  it('returns "" for a chapter with no owning book', async () => {
    seed('kaizen_book_chapters', {
      id: 'lonelyCh',
      user_id: 'u1',
      book_id: 'no-book',
      chapter_index: 0,
      title: 'Lonely',
      content_object_key: null,
      status: 'none',
      deleted_at: null,
    });
    await s().hydrate();
    expect(await s().readChapterText('lonelyCh')).toBe('');
  });

  it('returns "" on an unknown chapter id', async () => {
    expect(await s().readChapterText('missing')).toBe('');
  });

  it('returns "" when on-demand extraction yields empty text', async () => {
    const { chapterId } = await seedPdfChapter();
    (api.extractBookChapter as jest.Mock).mockResolvedValue({ text: null, contentKey: 'ck-x' });

    expect(await s().readChapterText(chapterId)).toBe('');
  });
});

// ===========================================================================
// Remaining guard clauses + fallback branches
// ===========================================================================

describe('guard clauses no-op on unknown ids', () => {
  it('setSkillMastery / saveAssessmentResult skip missing skills', async () => {
    await s().setSkillMastery('missing', 50);
    await s().saveAssessmentResult({
      skillId: 'missing',
      score0to100: 80,
      placedBand: 'B2',
      summary: 'x',
    } as any);
    expect(upsertsFor('kaizen_skill_nodes')).toHaveLength(0);
  });

  it('approveMemory / archiveMemory skip missing memories', async () => {
    await s().approveMemory('no such fact');
    await s().archiveMemory('missing');
    expect(upsertsFor('kaizen_user_memory')).toHaveLength(0);
  });

  it('approveQuestion / rejectQuestion skip missing questions', async () => {
    await s().approveQuestion('missing');
    await s().rejectQuestion('missing');
    expect(upsertsFor('kaizen_interview_questions')).toHaveLength(0);
  });

  it('movePipelineStage no-ops when the item is missing', async () => {
    await s().movePipelineStage('missing', 'interview');
    expect(upsertsFor('kaizen_interview_pipeline')).toHaveLength(0);
  });

  it('updateBookHighlight no-ops when the highlight is missing', async () => {
    await s().updateBookHighlight('missing', { color: 'red' });
    expect(upsertsFor('kaizen_book_highlights')).toHaveLength(0);
  });
});

describe('empty enabled-systems fall back to the career primary', () => {
  it('setOnboardingComplete defaults primary_system to career', async () => {
    await s().setOnboardingComplete([]);
    expect(s().profile?.primary_system).toBe('career');
  });

  it('beginSetupSystems defaults primary_system to career', async () => {
    await s().beginSetupSystems([]);
    expect(s().profile?.primary_system).toBe('career');
  });
});

describe('addDeepWorkBlock default focus suggestion', () => {
  it('defaults suggest_focus_mode to 1 when the flag is omitted', async () => {
    await s().addDeepWorkBlock('Default focus');
    expect(s().deepWork[0].suggest_focus_mode).toBe(1);
  });
});

describe('sync — non-Error rejection', () => {
  it('falls back to the generic "Sync failed" message', async () => {
    (runKaizenSync as jest.Mock).mockRejectedValue('string failure');
    await s().sync();
    expect(s().lastError).toBe('Sync failed');
    expect(s().isSyncing).toBe(false);
  });
});

describe('getAttemptsForQuestion — sorted most-recent-first', () => {
  it('sorts multiple attempts by attempted_at descending', async () => {
    seed('kaizen_interview_attempts', {
      id: 'at-old',
      user_id: 'u1',
      question_id: 'q1',
      attempted_at: '2026-01-01T00:00:00.000Z',
      answer_text: 'old',
      overall_score: 2,
      deleted_at: null,
    });
    seed('kaizen_interview_attempts', {
      id: 'at-new',
      user_id: 'u1',
      question_id: 'q1',
      attempted_at: '2026-06-01T00:00:00.000Z',
      answer_text: 'new',
      overall_score: 4,
      deleted_at: null,
    });
    await s().hydrate();

    const sorted = s().getAttemptsForQuestion('q1');
    expect(sorted.map(a => a.id)).toEqual(['at-new', 'at-old']);
  });
});

describe('submitInterviewAttempt — judge fallback fields', () => {
  it('generates an ideal answer with no model, then applies a bare judge result', async () => {
    // Unfrozen question with a falsy desired_retention exercises the fsrs `|| 0.9`.
    useKaizenStore.setState({
      questions: [makeQuestion({ id: 'qj', ideal_answer: null, rubric: null, desired_retention: 0 })],
    } as any);
    (api.generateIdealAnswer as jest.Mock).mockResolvedValue({
      ideal_answer: 'IA',
      rubric: ['r'], // no `model` -> `?? null`
    });
    (api.scoreInterviewAnswer as jest.Mock).mockResolvedValue({}); // no score/reasoning/model

    await s().submitInterviewAttempt('qj', 'answer', 3, { useAI: true });

    const attempt = s().attempts[0];
    expect(attempt.overall_score).toBe(3); // no numeric judge score -> self-score kept
    expect(attempt.judge_model).toBe('kaizen-judge'); // model default
    expect(attempt.judge_reasoning).toBeNull();
    expect(attempt.scored_offline).toBe(0);
  });

  it('ignores a partial generator result that lacks a rubric', async () => {
    useKaizenStore.setState({
      questions: [makeQuestion({ id: 'qp', ideal_answer: null, rubric: null })],
    } as any);
    (api.generateIdealAnswer as jest.Mock).mockResolvedValue({ ideal_answer: 'only ideal' });

    await s().submitInterviewAttempt('qp', 'answer', 2, { useAI: true });

    expect(api.scoreInterviewAnswer).not.toHaveBeenCalled(); // rubric never materialized
    expect(s().attempts[0].overall_score).toBe(2);
    expect(s().attempts[0].scored_offline).toBe(1);
  });
});

describe('setSystemActivation — null legacy state map', () => {
  it('treats a null activation-state column as an empty map', async () => {
    seed('kaizen_profiles', makeProfile({ system_activation_states: null }));
    await s().hydrate();

    await s().setSystemActivation('career', 'enabled');

    expect(JSON.parse(s().profile?.system_activation_states ?? '{}')).toEqual({ career: 'enabled' });
  });
});

describe('upsertHabitStack — step whose action does not exist', () => {
  it('creates the step but attaches no action when the id is unknown', async () => {
    await s().upsertHabitStack('Ghosts', ['ghost']);
    expect(s().habitStackSteps).toHaveLength(1);
    expect(s().habitStackSteps[0].action_id).toBe('ghost');
    // No action row was written for the missing action.
    expect(upsertsFor('kaizen_actions')).toHaveLength(0);
  });
});

describe('importQuestionsFromText — extraction edge cases', () => {
  it('line-splits when extraction returns no questions', async () => {
    (api.extractKaizenQuestions as jest.Mock).mockResolvedValue({}); // no `questions` field

    const count = await s().importQuestionsFromText(
      '1. First interview question here\n2. Second interview question here',
    );

    expect(count).toBe(2);
    expect(s().questions).toHaveLength(2);
  });

  it('skips blank/empty extracted prompts and reads the `question` alias', async () => {
    (api.extractKaizenQuestions as jest.Mock).mockResolvedValue({
      questions: [
        {}, // no prompt or question -> '' -> skipped
        { question: 'A valid interview question about testing' }, // `question` alias
        { prompt: '   ' }, // whitespace -> skipped
      ],
    });

    const count = await s().importQuestionsFromText('irrelevant');

    expect(count).toBe(3); // returns the extracted length
    expect(s().questions).toHaveLength(1); // only the valid alias prompt was stored
    expect(s().questions[0].prompt).toBe('A valid interview question about testing');
  });
});

describe('addBook — empty language normalizes to en', () => {
  it('stores "en" when the language is blank', async () => {
    const bookId = await s().addBook({ title: 'No Lang', language: '' });
    expect(s().books.find(b => b.id === bookId)?.language).toBe('en');
  });
});

describe('addBookChapter — omitted page range', () => {
  it('defaults start/end pages to null', async () => {
    const bookId = await s().addBook({ title: 'Book', language: 'en' });
    const chapterId = await s().addBookChapter(bookId, { title: 'Ch' });
    const ch = s().getBookChapters(bookId).find(c => c.id === chapterId)!;
    expect(ch.start_page).toBeNull();
    expect(ch.end_page).toBeNull();
  });
});

describe('attachBookFile — ToC without pages or page_count', () => {
  it('defaults chapter pages to null and skips the page_count write', async () => {
    const bookId = await s().addBook({ title: 'Bare', language: 'en' });
    (api.uploadBookFile as jest.Mock).mockResolvedValue({ fileKey: 'fk', fileName: 'b.pdf', size: 1 });
    (api.extractBookToc as jest.Mock).mockResolvedValue({
      chapters: [{ title: 'Only Title' }], // no start_page / end_page
      // no page_count
    });

    await s().attachBookFile(bookId, { uri: 'file:///b.pdf', name: 'b.pdf' });

    const chapters = s().getBookChapters(bookId);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]).toMatchObject({ title: 'Only Title', start_page: null, end_page: null });
    expect(s().books.find(b => b.id === bookId)?.page_count).toBeNull();
  });
});

describe('generateBookChapterQuestions — empty extraction + blank language', () => {
  it('nulls chapterText on empty extraction and defaults language to en', async () => {
    seed('kaizen_books', {
      id: 'blb',
      user_id: 'u1',
      title: 'Blank Lang',
      author: null,
      language: '', // blank -> `|| 'en'`
      source_type: 'pdf',
      file_object_key: 'fk-blank',
      file_name: 'b.pdf',
      file_hash: null,
      page_count: null,
      cover_emoji: null,
      created_at: iso(),
      updated_at: iso(),
      deleted_at: null,
    });
    seed('kaizen_book_chapters', {
      id: 'blc',
      user_id: 'u1',
      book_id: 'blb',
      chapter_index: 0,
      title: 'Ch1',
      start_page: null,
      end_page: null,
      status: 'none',
      content_object_key: null,
      summary: null,
      read_at: null,
      questions_generated_at: null,
      created_at: iso(),
      updated_at: iso(),
      deleted_at: null,
    });
    await s().hydrate();

    (api.extractBookChapter as jest.Mock).mockResolvedValue({ text: '', contentKey: 'ck' });
    (api.generateBookQuestions as jest.Mock).mockResolvedValue({
      questions: [{ type: 'open', prompt: 'Q', ideal_answer: 'a', rubric: ['x'] }],
    });

    const created = await s().generateBookChapterQuestions('blc');

    expect(created).toBe(1);
    const arg = (api.generateBookQuestions as jest.Mock).mock.calls[0][0];
    expect(arg.chapterText).toBeNull(); // empty extraction -> null
    expect(arg.language).toBe('en'); // blank book language -> en
    expect(s().getBookQuestionsForChapter('blc')[0].language).toBe('en');
  });
});

describe('submitBookAttempt — open grading fallback branches', () => {
  async function seedBlankLangOpenQuestion(): Promise<string> {
    seed('kaizen_books', {
      id: 'obk',
      user_id: 'u1',
      title: 'Open',
      author: null,
      language: 'en',
      source_type: 'toc_only',
      file_object_key: null,
      file_name: null,
      file_hash: null,
      page_count: null,
      cover_emoji: null,
      created_at: iso(),
      updated_at: iso(),
      deleted_at: null,
    });
    seed(
      'kaizen_book_questions',
      makeBookQuestion({
        id: 'obq',
        book_id: 'obk',
        chapter_id: 'oc1',
        type: 'open',
        rubric: null, // -> `? : null`
        language: '', // -> `|| 'en'`
        desired_retention: 0, // -> fsrs `|| 0.9`
      }),
    );
    await s().hydrate();
    return 'obq';
  }

  it('trims a missing answer, tolerates a null rubric, and defaults the language', async () => {
    const questionId = await seedBlankLangOpenQuestion();
    (api.gradeBookAnswer as jest.Mock).mockResolvedValue({
      content_score: 0.5,
      overall_score: 0.5,
      feedback: 'ok', // no `mistakes` field -> `?? []`
    });

    await s().submitBookAttempt(questionId, {}); // no answerText -> '' branch

    const arg = (api.gradeBookAnswer as jest.Mock).mock.calls[0][0];
    expect(arg.rubric).toBeNull();
    expect(arg.language).toBe('en');
    expect(arg.answerText).toBe('');
    expect(s().bookAttempts[0].mistakes).toBeNull();
    expect(s().bookMistakes).toHaveLength(0);
  });

  it('files bare mistakes (no type / text / correction) with sensible defaults', async () => {
    const questionId = await seedBlankLangOpenQuestion();
    (api.gradeBookAnswer as jest.Mock).mockResolvedValue({
      content_score: 0.2,
      overall_score: 0.2,
      feedback: 'redo',
      mistakes: [{ type: 'spelling' }, { text: 'no type here' }],
    });

    await s().submitBookAttempt(questionId, { answerText: 'attempt' });

    expect(s().bookMistakes).toHaveLength(2);
    const typeless = s().bookMistakes.find(m => m.text === 'no type here')!;
    expect(typeless.type).toBe('grammar'); // `m.type || 'grammar'`
    expect(typeless.correction).toBeNull();
    const textless = s().bookMistakes.find(m => m.type === 'spelling')!;
    expect(textless.dedup_key).toBe('spelling|'); // `(m.text || '')`
  });

  it('increments a prior mistake with an undefined regression_count', async () => {
    const questionId = await seedBlankLangOpenQuestion();
    seed('kaizen_book_mistakes', {
      id: 'pm',
      user_id: 'u1',
      book_id: 'obk',
      type: 'grammar',
      text: 'go',
      correction: null,
      explanation: null,
      severity: null,
      status: 'detected',
      dedup_key: 'grammar|go',
      regression_count: null, // -> `?? 0`
      srs_state: null,
      due_at: iso(),
      last_seen_at: iso(),
      created_at: iso(),
      updated_at: iso(),
      deleted_at: null,
    });
    await s().hydrate();
    (api.gradeBookAnswer as jest.Mock).mockResolvedValue({
      content_score: 0.4,
      overall_score: 0.4,
      feedback: 'again',
      mistakes: [{ type: 'grammar', text: 'go' }],
    });

    await s().submitBookAttempt(questionId, { answerText: 'I go' });

    const pm = s().bookMistakes.find(m => m.id === 'pm')!;
    expect(pm.regression_count).toBe(1); // null -> 0 -> +1
  });
});

describe('submitSpokenBookAttempt — grading fallback branches', () => {
  function seedSpokenQuestion(over: Row = {}): void {
    seed('kaizen_book_questions', makeBookQuestion({ id: 'ssq', type: 'spoken', ...over }));
  }

  it('applies a bare spoken result (no transcription / mistakes / pronunciation)', async () => {
    seedSpokenQuestion({ rubric: null, language: '', desired_retention: 0 });
    await s().hydrate();
    (api.gradeSpokenBookAnswer as jest.Mock).mockResolvedValue({
      content_score: 0.6,
      overall_score: 0.6,
      feedback: 'fine',
    });

    await s().submitSpokenBookAttempt('ssq', { uri: 'file:///a.m4a' });

    const arg = (api.gradeSpokenBookAnswer as jest.Mock).mock.calls[0][0];
    expect(arg.rubric).toBeNull();
    expect(arg.language).toBe('en');
    const attempt = s().bookAttempts[0];
    expect(attempt.transcription).toBeNull();
    expect(attempt.mistakes).toBeNull();
    expect(attempt.pronunciation).toBeNull();
    expect(s().bookMistakes).toHaveLength(0);
  });

  it('files typeless/textless mistakes and skips non-problem / tip-less pronunciation words', async () => {
    seedSpokenQuestion();
    await s().hydrate();
    (api.gradeSpokenBookAnswer as jest.Mock).mockResolvedValue({
      transcription: 'spoken',
      content_score: 0.5,
      overall_score: 0.5,
      feedback: 'redo',
      mistakes: [{ text: 'oops' }, { type: 'style' }], // (1) no type (2) no text
      pronunciation: {
        words: [
          { word: 'fine', is_problem: false }, // skipped
          { word: 'hard', is_problem: true }, // no tip -> `?? null`
        ],
      },
    });

    await s().submitSpokenBookAttempt('ssq', { uri: 'file:///a.m4a' });

    const types = s().bookMistakes.map(m => m.type).sort();
    // grammar (from the no-type mistake), style (textless), pronunciation (hard)
    expect(types).toEqual(['grammar', 'pronunciation', 'style']);
    const pron = s().bookMistakes.find(m => m.type === 'pronunciation')!;
    expect(pron).toMatchObject({ text: 'hard', correction: null });
  });

  it('increments a prior spoken mistake with an undefined regression_count', async () => {
    seedSpokenQuestion();
    seed('kaizen_book_mistakes', {
      id: 'spm',
      user_id: 'u1',
      book_id: 'b1',
      type: 'grammar',
      text: 'go',
      correction: null,
      explanation: null,
      severity: null,
      status: 'detected',
      dedup_key: 'grammar|go',
      regression_count: null, // -> `?? 0`
      srs_state: null,
      due_at: iso(),
      last_seen_at: iso(),
      created_at: iso(),
      updated_at: iso(),
      deleted_at: null,
    });
    await s().hydrate();
    (api.gradeSpokenBookAnswer as jest.Mock).mockResolvedValue({
      transcription: 'x',
      content_score: 0.5,
      overall_score: 0.5,
      feedback: 'ok',
      mistakes: [{ type: 'grammar', text: 'go' }],
      pronunciation: { words: [] },
    });

    await s().submitSpokenBookAttempt('ssq', { uri: 'file:///a.m4a' });

    expect(s().bookMistakes.find(m => m.id === 'spm')?.regression_count).toBe(1);
  });
});

describe('updateBookHighlight — partial patches fall back to existing values', () => {
  it('keeps the existing color + note when the patch omits them', async () => {
    const bookId = await s().addBook({
      title: 'HL',
      language: 'en',
      chapters: [{ title: 'Ch1' }],
    });
    const chapterId = s().getBookChapters(bookId)[0].id;
    await s().addBookHighlight({ bookId, chapterId, text: 't', color: 'yellow', note: 'keep' });
    const id = s().getBookHighlightsForChapter(chapterId)[0].id;

    await s().updateBookHighlight(id, {}); // no color, no note -> both fall back

    const hl = s().getBookHighlightsForChapter(chapterId)[0];
    expect(hl).toMatchObject({ id, color: 'yellow', note: 'keep' });
  });
});
