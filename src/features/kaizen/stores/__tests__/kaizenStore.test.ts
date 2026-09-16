/**
 * Unit coverage for the Kaizen (Kaizen) Zustand store.
 *
 * The dependency boundary is mocked so no sqlite / network is touched:
 *  - `../services/repository` is backed by an in-memory fake "DB" (a Map keyed by
 *    table name), so `upsertLocal` writes and `hydrate`'s `listActive`/`getProfile`
 *    reads round-trip for real — actions can be asserted through resulting state.
 *  - The AI api layer, sync, reminders, watch, health and device-local services are
 *    plain jest.fn stubs.
 *  - Pure services (`fsrs`, `questionDedup`, `taskCatalog`, `focusMode`) stay REAL.
 * `@stores/authStore` is mocked with a mutable user id so the `requireUserId` guard
 * can be exercised.
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
  // Dirty / sync helpers (used only by the mocked sync module, kept for safety).
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

import { clearAllE2ETestLogs, findE2EPersistEntryBySpec } from '@api/e2eTestObservability';

import * as api from '../../api/kaizen';
import { scheduleDailyCoreReminders } from '../../services/reminders';
import * as repo from '../../services/repository';
import { runKaizenSync } from '../../services/sync';
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
  // Reads return COPIES: hydrate places these into the immer store, which
  // auto-freezes them. Returning copies keeps the canonical DB rows mutable so
  // in-place writes (softDelete) still take effect.
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
  const writeLog = (uid: string, actionId: string, source: string, skipped: boolean) => {
    const today = new Date().toISOString().slice(0, 10);
    const ts = new Date().toISOString();
    const id = `log-${actionId}-${today}`;
    const rows = db.get('kaizen_action_logs') ?? [];
    const log: Row = {
      id,
      user_id: uid,
      action_id: actionId,
      date: today,
      completed_at: skipped ? null : ts,
      skipped: skipped ? 1 : 0,
      skip_reason: null,
      source,
      notes: null,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    const existing = rows.find(r => r.id === id);
    if (existing) Object.assign(existing, log);
    else rows.push(log);
    db.set('kaizen_action_logs', rows);
  };
  (repo.completeActionToday as jest.Mock).mockImplementation(
    async (uid: string, actionId: string, source = 'manual') => writeLog(uid, actionId, source, false),
  );
  (repo.skipActionToday as jest.Mock).mockImplementation(
    async (uid: string, actionId: string, source = 'manual') => writeLog(uid, actionId, source, true),
  );
}

// --- entry builders (only the fields hydrate / actions read matter) --------

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
const questionUpserts = () =>
  (repo.upsertLocal as jest.Mock).mock.calls.filter(c => c[0] === 'kaizen_interview_questions');

// Drain the fire-and-forget `void get().sync()` chains actions kick off.
const flush = () => new Promise<void>(res => setImmediate(res));

beforeEach(() => {
  jest.clearAllMocks();
  db.clear();
  mockUserId = 'u1';
  wireRepository();
  // Actions fire `void get().sync()` and never await it; sync then re-hydrates.
  // In tests every mock resolves instantly, so a stale pre-mutation snapshot can
  // be applied late and clobber the correct post-mutation state (e.g. a delete).
  // Actions already await their OWN hydrate for the assertable state, so keep the
  // background sync pending (never resolves) — its re-hydrate never fires. The
  // dedicated `sync` tests override this to resolve/reject.
  (runKaizenSync as jest.Mock).mockReturnValue(new Promise<void>(() => {}));
  (api.extractKaizenQuestions as jest.Mock).mockResolvedValue({ questions: [] });
  (api.generateIdealAnswer as jest.Mock).mockResolvedValue({});
  (api.scoreInterviewAnswer as jest.Mock).mockResolvedValue({});
  (api.analyzeCareerResume as jest.Mock).mockResolvedValue({ summary: 'ok' });
  useKaizenStore.setState({ ...INITIAL_DATA } as any);
});

afterEach(async () => {
  await flush();
});

// ---------------------------------------------------------------------------

describe('requireUserId guard', () => {
  it('rejects an action when no user is authenticated', async () => {
    mockUserId = null;
    await expect(s().addGtdItem('capture this')).rejects.toThrow('Not authenticated');
    expect(repo.upsertLocal).not.toHaveBeenCalled();
  });

  it('propagates the guard through completeDailyAction', async () => {
    mockUserId = null;
    await expect(s().completeDailyAction('a1')).rejects.toThrow('Not authenticated');
    expect(repo.completeActionToday).not.toHaveBeenCalled();
  });

  it('hydrate no-ops (does not throw or flip isHydrated) with no user', async () => {
    mockUserId = null;
    await s().hydrate();
    expect(s().isHydrated).toBe(false);
    expect(repo.getProfile).not.toHaveBeenCalled();
  });
});

describe('hydrate', () => {
  it('populates state arrays from the repository', async () => {
    seed('kaizen_profiles', makeProfile());
    seed('kaizen_actions', makeAction({ id: 'core', is_daily_core: 1 }));
    seed('kaizen_actions', makeAction({ id: 'notcore', is_daily_core: 0 }));
    seed('kaizen_skill_nodes', { id: 'sk1', user_id: 'u1', name: 'TS', deleted_at: null });
    seed('kaizen_interview_questions', makeQuestion({ id: 'q1' }));
    seed('kaizen_gtd_items', { id: 'g1', user_id: 'u1', title: 'todo', status: 'inbox', deleted_at: null });
    seed('kaizen_user_memory', { id: 'm1', user_id: 'u1', fact: 'x', is_approved: 0, deleted_at: null });
    const today = new Date().toISOString().slice(0, 10);
    seed('kaizen_action_logs', { id: 'l-today', user_id: 'u1', action_id: 'core', date: today, completed_at: iso(), skipped: 0, deleted_at: null });
    seed('kaizen_action_logs', { id: 'l-old', user_id: 'u1', action_id: 'core', date: '2000-01-01', completed_at: iso(), skipped: 0, deleted_at: null });

    await s().hydrate();

    expect(s().isHydrated).toBe(true);
    expect(s().profile?.id).toBe('p1');
    expect(s().dailyCore).toHaveLength(1); // only the is_daily_core action
    expect(s().dailyCore[0].id).toBe('core');
    expect(s().skills).toHaveLength(1);
    expect(s().questions).toHaveLength(1);
    expect(s().gtd).toHaveLength(1);
    expect(s().memories).toHaveLength(1);
    expect(s().todayLogs).toHaveLength(1); // date filter drops the 2000-01-01 log
    expect(s().wakeConfirmedToday).toBe(false);
  });
});

describe('daily action completion', () => {
  it('completeDailyAction logs completion, re-hydrates and reschedules', async () => {
    seed('kaizen_actions', makeAction({ id: 'a1' }));
    await s().completeDailyAction('a1');

    expect(repo.completeActionToday).toHaveBeenCalledWith('u1', 'a1', 'manual');
    expect(scheduleDailyCoreReminders).toHaveBeenCalled();
    expect(watchSync.pushTodaySummary).toHaveBeenCalled();
    expect(runKaizenSync).toHaveBeenCalledWith('u1');
    const log = s().todayLogs.find(l => l.action_id === 'a1');
    expect(log?.completed_at).toBeTruthy();
  });

  it('skipDailyAction records a skip and reschedules', async () => {
    seed('kaizen_actions', makeAction({ id: 'a1' }));
    await s().skipDailyAction('a1');

    expect(repo.skipActionToday).toHaveBeenCalledWith('u1', 'a1', 'manual');
    expect(scheduleDailyCoreReminders).toHaveBeenCalled();
    const log = s().todayLogs.find(l => l.action_id === 'a1');
    expect(log?.skipped).toBe(1);
  });
});

describe('interview questions', () => {
  it('addInterviewQuestion trims, defaults to approved, and dedups repeats', async () => {
    await s().addInterviewQuestion('  What is a closure?  ', 'technical');
    expect(questionUpserts()).toHaveLength(1);
    expect(s().questions).toHaveLength(1);
    expect(s().questions[0].prompt).toBe('What is a closure?');
    expect(s().questions[0].question_bank).toBe('technical');
    expect(s().questions[0].import_review_status).toBe('approved');

    // Duplicate prompt (real questionDedup) is ignored.
    await s().addInterviewQuestion('What is a closure?', 'technical');
    expect(questionUpserts()).toHaveLength(1);

    // Blank prompt is a no-op.
    await s().addInterviewQuestion('   ', 'technical');
    expect(questionUpserts()).toHaveLength(1);
  });

  it('importQuestionsFromText adds extracted questions as pending imports', async () => {
    (api.extractKaizenQuestions as jest.Mock).mockResolvedValue({
      questions: [
        { prompt: 'Explain the event loop', question_bank: 'technical' },
        { prompt: 'Tell me about a conflict', bank: 'behavioral' },
      ],
    });

    const count = await s().importQuestionsFromText('irrelevant');
    expect(count).toBe(2);
    expect(s().questions).toHaveLength(2);
    const banks = s().questions.map(q => q.question_bank).sort();
    expect(banks).toEqual(['behavioral', 'technical']);
    expect(s().questions.every(q => q.import_review_status === 'pending')).toBe(true);
    expect(s().questions.every(q => q.import_source === 'import')).toBe(true);
  });

  it('importQuestionsFromText falls back to line-splitting when extraction fails', async () => {
    (api.extractKaizenQuestions as jest.Mock).mockRejectedValue(new Error('AI down'));
    const text = '1. First interview question here\n2. Second interview question here';
    const count = await s().importQuestionsFromText(text);
    expect(count).toBe(2);
    expect(s().questions).toHaveLength(2);
    expect(s().questions.every(q => q.import_review_status === 'pending')).toBe(true);
  });

  it('approveQuestion / rejectQuestion update the review status', async () => {
    seed('kaizen_interview_questions', makeQuestion({ id: 'q1', import_review_status: 'pending', due_at: null }));
    seed('kaizen_interview_questions', makeQuestion({ id: 'q2', prompt: 'Second one', import_review_status: 'pending' }));
    await s().hydrate();

    await s().approveQuestion('q1');
    const q1 = s().questions.find(q => q.id === 'q1');
    expect(q1?.import_review_status).toBe('approved');
    expect(q1?.due_at).toBeTruthy(); // approval seeds a due date

    await s().rejectQuestion('q2');
    expect(s().questions.find(q => q.id === 'q2')?.import_review_status).toBe('rejected');
  });
});

describe('submitInterviewAttempt (real fsrs)', () => {
  it('offline path records a self-scored attempt and advances the question', async () => {
    seed('kaizen_interview_questions', makeQuestion({ id: 'q1' }));
    await s().hydrate();

    await s().submitInterviewAttempt('q1', 'my answer', 4);

    expect(api.scoreInterviewAnswer).not.toHaveBeenCalled();
    expect(s().attempts).toHaveLength(1);
    const attempt = s().attempts[0];
    expect(attempt.answer_text).toBe('my answer');
    expect(attempt.overall_score).toBe(4);
    expect(attempt.scored_offline).toBe(1);
    expect(attempt.fsrs_rating).toBe(3); // gradeForScore(4) === 3
    // fsrs advanced the question's memory state.
    const q = s().questions.find(x => x.id === 'q1');
    expect(q?.reps).toBe(1);
    expect(q?.stability).not.toBeNull();
    expect(q?.due_at).toBeTruthy();
    // getAttemptsForQuestion selector surfaces it.
    expect(s().getAttemptsForQuestion('q1')).toHaveLength(1);
  });

  it('AI path judges the answer against the stored ideal answer and records the AI score', async () => {
    // The judge branch fires when the question already carries an ideal answer +
    // rubric (an immer-frozen question can't be back-filled in place mid-attempt).
    seed(
      'kaizen_interview_questions',
      makeQuestion({ id: 'q1', ideal_answer: 'IA', rubric: JSON.stringify(['clarity']) }),
    );
    await s().hydrate();
    (api.scoreInterviewAnswer as jest.Mock).mockResolvedValue({
      overall_score: 5,
      reasoning: 'excellent',
      model: 'judge-model',
    });

    await s().submitInterviewAttempt('q1', 'the answer', 2, { useAI: true });

    expect(api.scoreInterviewAnswer).toHaveBeenCalled();
    expect(api.generateIdealAnswer).not.toHaveBeenCalled(); // already has ideal + rubric
    const attempt = s().attempts[0];
    expect(attempt.overall_score).toBe(5); // AI score overrides the passed self-score
    expect(attempt.scored_offline).toBe(0);
    expect(attempt.judge_model).toBe('judge-model');
    expect(attempt.fsrs_rating).toBe(4); // gradeForScore(5) === 4
  });

  it('is a no-op when the question does not exist', async () => {
    await s().submitInterviewAttempt('missing', 'x', 3);
    expect(s().attempts).toHaveLength(0);
    expect(repo.upsertLocal).not.toHaveBeenCalledWith('kaizen_interview_attempts', expect.anything());
  });
});

describe('onboarding & profile flags', () => {
  it('beginSetupSystems creates a profile with onboarding incomplete', async () => {
    await s().beginSetupSystems(['career', 'health']);
    expect(repo.upsertLocal).toHaveBeenCalledWith('kaizen_profiles', expect.any(Object));
    const profile = s().profile;
    expect(profile?.onboarding_complete).toBe(0);
    expect(profile?.primary_system).toBe('career');
    expect(JSON.parse(profile?.enabled_systems ?? '[]')).toEqual(['career', 'health']);
  });

  it('setOnboardingComplete marks onboarding done', async () => {
    await s().setOnboardingComplete(['career']);
    expect(s().profile?.onboarding_complete).toBe(1);
  });

  it('finishOnboarding flips an existing profile to complete', async () => {
    await s().beginSetupSystems(['career']);
    expect(s().profile?.onboarding_complete).toBe(0);
    await s().finishOnboarding();
    expect(s().profile?.onboarding_complete).toBe(1);
  });
});

describe('skills', () => {
  it('addSkill creates a skill at zero mastery', async () => {
    await s().addSkill('TypeScript');
    expect(repo.upsertLocal).toHaveBeenCalledWith('kaizen_skill_nodes', expect.any(Object));
    expect(s().skills).toHaveLength(1);
    expect(s().skills[0].name).toBe('TypeScript');
    expect(s().skills[0].mastery_0_to_100).toBe(0);
  });

  it('setSkillMastery clamps to 0-100 and writes a progress log', async () => {
    await s().addSkill('TypeScript');
    const id = s().skills[0].id;
    await s().setSkillMastery(id, 150);
    expect(s().skills[0].mastery_0_to_100).toBe(100);
    expect(repo.upsertLocal).toHaveBeenCalledWith(
      'kaizen_skill_progress_logs',
      expect.objectContaining({ new_mastery: 100 }),
    );
  });

  it('saveAssessmentResult places the skill band, score and activates it', async () => {
    await s().addSkill('TypeScript');
    const id = s().skills[0].id;
    await s().saveAssessmentResult({
      skillId: id,
      score0to100: 80,
      placedBand: 'B2',
      summary: 'solid',
    } as any);
    const skill = s().skills[0];
    expect(skill.mastery_0_to_100).toBe(80);
    expect(skill.concept_band).toBe('B2');
    expect(skill.activation_state).toBe('active');
  });
});

describe('interview pipeline', () => {
  it('upsert / move / delete pipeline items', async () => {
    await s().upsertPipelineItem({ title: 'Acme', stage: 'applied' });
    expect(s().pipeline).toHaveLength(1);
    const id = s().pipeline[0].id;
    expect(s().pipeline[0].title).toBe('Acme');
    expect(s().pipeline[0].stage).toBe('applied');

    await s().movePipelineStage(id, 'interview');
    expect(s().pipeline[0].stage).toBe('interview');

    await s().deletePipelineItem(id);
    expect(repo.softDelete).toHaveBeenCalledWith('kaizen_interview_pipeline', id);
    expect(s().pipeline).toHaveLength(0);
  });
});

describe('habit stacks', () => {
  it('upsertHabitStack creates the stack with ordered steps', async () => {
    seed('kaizen_actions', makeAction({ id: 'a1', is_daily_core: 0 }));
    seed('kaizen_actions', makeAction({ id: 'a2', is_daily_core: 0 }));
    await s().hydrate();

    await s().upsertHabitStack('Morning', ['a1', 'a2']);
    expect(repo.upsertLocal).toHaveBeenCalledWith('kaizen_habit_stacks', expect.any(Object));
    expect(repo.upsertLocal).toHaveBeenCalledWith('kaizen_habit_stack_steps', expect.any(Object));
    expect(s().habitStacks).toHaveLength(1);
    expect(s().habitStacks[0].name).toBe('Morning');
    expect(s().habitStackSteps).toHaveLength(2);
  });

  it('deleteHabitStack removes the stack and its steps', async () => {
    seed('kaizen_actions', makeAction({ id: 'a1', is_daily_core: 0 }));
    await s().hydrate();
    await s().upsertHabitStack('Morning', ['a1']);
    const id = s().habitStacks[0].id;

    await s().deleteHabitStack(id);
    expect(repo.softDelete).toHaveBeenCalledWith('kaizen_habit_stacks', id);
    expect(s().habitStacks).toHaveLength(0);
    expect(s().habitStackSteps).toHaveLength(0);
  });
});

describe('user memory', () => {
  it('upsert / approve / archive memory facts', async () => {
    await s().upsertMemory({ category: 'preference', fact: 'likes tea' });
    expect(s().memories).toHaveLength(1);
    expect(s().memories[0].fact).toBe('likes tea');
    expect(s().memories[0].is_approved).toBe(0);
    const id = s().memories[0].id;

    await s().approveMemory('likes tea');
    expect(s().memories[0].is_approved).toBe(1);

    await s().archiveMemory(id);
    expect(s().memories[0].is_archived).toBe(1);
  });
});

describe('weekly rotation', () => {
  it('creates, updates in place, and adds distinct weekdays', async () => {
    await s().upsertWeeklyRotation(1, 'Deep Work', 'career');
    expect(s().rotations).toHaveLength(1);
    expect(s().rotations[0].weekday).toBe(1);
    expect(s().rotations[0].focus_title).toBe('Deep Work');
    expect(s().rotations[0].system).toBe('career');
    const id = s().rotations[0].id;

    // Same weekday reuses the existing row.
    await s().upsertWeeklyRotation(1, 'Updated Focus');
    expect(s().rotations).toHaveLength(1);
    expect(s().rotations[0].id).toBe(id);
    expect(s().rotations[0].focus_title).toBe('Updated Focus');

    // saveWeeklyRotation adds a different weekday.
    await s().saveWeeklyRotation(2, 'Tuesday Focus');
    expect(s().rotations).toHaveLength(2);
  });

  it('records an E2E persist entry naming this table, not just the generic sync one', async () => {
    clearAllE2ETestLogs();
    await s().saveWeeklyRotation(3, 'Ship the release');
    const hit = findE2EPersistEntryBySpec({
      store: 'kaizen_weekly_rotations',
      operation: 'upsert',
    });
    expect(hit?.detail).toBe('weekday=3');
  });
});

describe('sync', () => {
  it('toggles isSyncing, runs the sync engine and re-hydrates', async () => {
    let syncingDuring: boolean | undefined;
    (runKaizenSync as jest.Mock).mockImplementation(async () => {
      syncingDuring = s().isSyncing;
    });

    await s().sync();

    expect(runKaizenSync).toHaveBeenCalledWith('u1');
    expect(syncingDuring).toBe(true);
    expect(s().isSyncing).toBe(false);
    expect(s().lastError).toBeNull();
    expect(s().isHydrated).toBe(true); // sync re-hydrates on success
  });

  it('captures a sync failure in lastError and clears isSyncing', async () => {
    (runKaizenSync as jest.Mock).mockRejectedValue(new Error('boom'));
    await s().sync();
    expect(s().lastError).toBe('boom');
    expect(s().isSyncing).toBe(false);
  });
});
