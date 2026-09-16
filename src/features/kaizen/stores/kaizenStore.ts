import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import { recordE2EPersistEntry } from '@api/e2eTestObservability';
import { useAuthStore } from '@stores/authStore';

import { scoreInterviewAnswer, analyzeCareerResume, extractKaizenQuestions, generateIdealAnswer, postCoachMessage, generateBookQuestions, gradeBookAnswer, uploadBookFile, extractBookToc, extractBookChapter, fetchBookChapterText, gradeSpokenBookAnswer, type BookQuestionType } from '../api/kaizen';
import { LifeSystem } from '../constants';
import { getAIDisclosureAck, setAIDisclosureAck as persistAIDisclosureAck } from '../services/aiDisclosure';
import { buildKaizenContextSnapshot } from '../services/contextSnapshot';
import { isDeepWorkFocusFilterActive } from '../services/focusMode';
import { review as fsrsReview } from '../services/fsrs';
import { hashPrompt, isDuplicatePrompt } from '../services/questionDedup';
import {
  completedActionIdsFromLogs,
  scheduleDailyCoreReminders,
} from '../services/reminders';
import {
  completeActionToday,
  getDailyCoreActions,
  getProfile,
  listActive,
  skipActionToday,
  softDelete,
  upsertLocal,
} from '../services/repository';
import type { SkillAssessmentResult } from '../services/skillAssessment';
import { runKaizenSync } from '../services/sync';
import { materializeActions } from '../services/taskCatalog';
import { wakeDetection } from '../services/wakeDetection';
import { watchSync } from '../services/watchSync';
import type {
  KaizenActionLogEntry,
  KaizenDeepWorkBlockEntry,
  KaizenActionEntry,
  KaizenGtdItemEntry,
  KaizenInterviewPipelineEntry,
  KaizenKnowledgeItemEntry,
  KaizenProfileEntry,
  KaizenSkillNodeEntry,
  KaizenInterviewQuestionEntry,
  KaizenInterviewAttemptEntry,
  KaizenHabitStackEntry,
  KaizenHabitStackStepEntry,
  KaizenUserMemoryEntry,
  KaizenWeeklyRotationEntry,
  KaizenWeeklyReviewEntry,
  KaizenBookEntry,
  KaizenBookChapterEntry,
  KaizenBookQuestionEntry,
  KaizenBookAttemptEntry,
  KaizenBookMistakeEntry,
  KaizenBookHighlightEntry,
} from '../types';

import {
  addBookAction,
  deleteBookAction,
  markBookChapterReadAction,
} from './kaizenBookActions';
import {
  getAttemptsForQuestionFromState,
  getBookChaptersFromState,
  getBookHighlightsForChapterFromState,
  getBookQuestionsForChapterFromState,
} from './kaizenStoreGetters';

interface KaizenState {
  isHydrated: boolean;
  isSyncing: boolean;
  lastError: string | null;
  profile: KaizenProfileEntry | null;
  dailyCore: KaizenActionEntry[];
  skills: KaizenSkillNodeEntry[];
  questions: KaizenInterviewQuestionEntry[];
  knowledge: KaizenKnowledgeItemEntry[];
  gtd: KaizenGtdItemEntry[];
  reviews: KaizenWeeklyReviewEntry[];
  todayLogs: KaizenActionLogEntry[];
  deepWork: KaizenDeepWorkBlockEntry[];
  pipeline: KaizenInterviewPipelineEntry[];
  attempts: KaizenInterviewAttemptEntry[];
  habitStacks: KaizenHabitStackEntry[];
  habitStackSteps: KaizenHabitStackStepEntry[];
  memories: KaizenUserMemoryEntry[];
  rotations: KaizenWeeklyRotationEntry[];
  books: KaizenBookEntry[];
  bookChapters: KaizenBookChapterEntry[];
  bookQuestions: KaizenBookQuestionEntry[];
  bookAttempts: KaizenBookAttemptEntry[];
  bookMistakes: KaizenBookMistakeEntry[];
  bookHighlights: KaizenBookHighlightEntry[];
  wakeConfirmedToday: boolean;
  hydrate: () => Promise<void>;
  sync: () => Promise<void>;
  completeDailyAction: (actionId: string, source?: 'manual' | 'health' | 'watch' | 'notification') => Promise<void>;
  confirmWake: () => Promise<void>;
  skipDailyAction: (actionId: string) => Promise<void>;
  setOnboardingComplete: (enabledSystems: string[]) => Promise<void>;
  beginSetupSystems: (enabledSystems: string[]) => Promise<void>;
  finishOnboarding: () => Promise<void>;
  resetOnboarding: () => Promise<void>;
  addGtdItem: (title: string) => Promise<void>;
  updateGtdStatus: (id: string, status: string) => Promise<void>;
  addKnowledgeItem: (title: string, paraType: string, content?: string, tags?: string) => Promise<void>;
  addDeepWorkBlock: (
    topic: string,
    startTime?: string,
    endTime?: string,
    suggestFocusMode?: boolean,
  ) => Promise<void>;
  saveWeeklyReview: (input: { wins: string; improvements: string; onePercentChange: string }) => Promise<void>;
  saveCareerSetup: (input: {
    targetRoles: string[];
    goalTypes: string[];
    resumeSummary?: string;
    resumeSourceName?: string;
    step: string;
  }) => Promise<void>;
  addSkill: (name: string) => Promise<void>;
  setSkillMastery: (skillId: string, mastery: number) => Promise<void>;
  activateSkillForTraining: (skillId: string) => Promise<void>;
  pauseSkill: (skillId: string) => Promise<void>;
  backlogSkill: (skillId: string) => Promise<void>;
  saveAssessmentResult: (result: SkillAssessmentResult) => Promise<void>;
  addInterviewQuestion: (
    prompt: string,
    bank: 'technical' | 'behavioral',
    options?: { importReviewStatus?: 'pending' | 'approved' | 'rejected'; importSource?: string },
  ) => Promise<void>;
  submitInterviewAttempt: (
    questionId: string,
    answerText: string,
    overallScore: number,
    options?: { useAI?: boolean },
  ) => Promise<void>;
  getAttemptsForQuestion: (questionId: string) => KaizenInterviewAttemptEntry[];
  hydrateAttempts: () => Promise<void>;
  upsertMemory: (input: { category: string; fact: string; sensitivity?: string }) => Promise<void>;
  approveMemory: (fact: string) => Promise<void>;
  saveWeeklyRotation: (weekday: number, focusTitle: string) => Promise<void>;
  sendCoachMessage: (text: string, history: Array<{ role: 'user' | 'assistant'; content: string }>, disclosureAck: boolean, sessionId?: string) => ReturnType<typeof postCoachMessage>;
  setSystemActivation: (system: string, state: 'enabled' | 'paused') => Promise<void>;
  materializeSystemTasks: (system: LifeSystem, templateIds: string[], customTasks: Array<{ title: string; outputDescription: string; suggestedDailyCore: boolean; timeOfDay?: string; reminderAnchor?: string }>) => Promise<void>;
  upsertPipelineItem: (input: Pick<KaizenInterviewPipelineEntry, 'title' | 'stage'> & Partial<Pick<KaizenInterviewPipelineEntry, 'id' | 'linked_skill_id' | 'notes'>>) => Promise<void>;
  movePipelineStage: (id: string, stage: string) => Promise<void>;
  deletePipelineItem: (id: string) => Promise<void>;
  upsertHabitStack: (name: string, actionIds: string[], id?: string) => Promise<void>;
  deleteHabitStack: (id: string) => Promise<void>;
  upsertWeeklyRotation: (weekday: number, focusTitle: string, system?: string) => Promise<void>;
  approveQuestion: (id: string) => Promise<void>;
  rejectQuestion: (id: string) => Promise<void>;
  generateIdealAnswerForQuestion: (id: string) => Promise<void>;
  setAIDisclosureAck: (acknowledged: boolean) => void;
  hasAIDisclosureAck: () => boolean;
  archiveMemory: (id: string) => Promise<void>;
  buildCoachSnapshot: () => Record<string, unknown>;
  importQuestionsFromText: (documentText: string) => Promise<number>;
  analyzeResume: (resumeText: string) => Promise<{
    suggested_skills?: { name: string }[];
    target_roles?: string[];
    summary?: string;
  }>;
  scheduleDailyReminders: () => Promise<void>;
  // Book Comprehension & Retention
  addBook: (input: {
    title: string;
    author?: string;
    language: string;
    sourceType?: string;
    coverEmoji?: string;
    chapters?: Array<{ title: string; startPage?: number; endPage?: number }>;
  }) => Promise<string>;
  deleteBook: (bookId: string) => Promise<void>;
  addBookChapter: (
    bookId: string,
    input: { title: string; startPage?: number; endPage?: number },
  ) => Promise<string>;
  markBookChapterRead: (chapterId: string) => Promise<void>;
  attachBookFile: (bookId: string, file: { uri: string; name: string }) => Promise<void>;
  generateBookChapterQuestions: (
    chapterId: string,
    opts?: { types?: BookQuestionType[]; count?: number; highlightIds?: string[] },
  ) => Promise<number>;
  submitBookAttempt: (
    questionId: string,
    input: { answerText?: string; selectedIndex?: number },
  ) => Promise<void>;
  submitSpokenBookAttempt: (
    questionId: string,
    audio: { uri: string; durationMs?: number },
  ) => Promise<void>;
  readChapterText: (chapterId: string) => Promise<string>;
  addBookHighlight: (input: {
    bookId: string;
    chapterId: string;
    text: string;
    anchor?: string;
    color?: string;
    note?: string;
  }) => Promise<void>;
  updateBookHighlight: (id: string, patch: { color?: string; note?: string }) => Promise<void>;
  deleteBookHighlight: (id: string) => Promise<void>;
  getBookChapters: (bookId: string) => KaizenBookChapterEntry[];
  getBookQuestionsForChapter: (chapterId: string) => KaizenBookQuestionEntry[];
  getBookHighlightsForChapter: (chapterId: string) => KaizenBookHighlightEntry[];
}

function userId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}

function requireUserId(): string {
  const id = userId();
  if (!id) throw new Error('Not authenticated');
  return id;
}

function cryptoRandomId(): string {
  /* eslint-disable no-bitwise -- uuid v4 bit packing */
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
  /* eslint-enable no-bitwise */
}

export const useKaizenStore = create<KaizenState>()(
  immer((set, get) => ({
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

    hydrate: async () => {
      const uid = userId();
      if (!uid) return;
      const today = new Date().toISOString().slice(0, 10);
      const [
        profile,
        dailyCore,
        skills,
        questions,
        knowledge,
        gtd,
        reviews,
        actionLogs,
        deepWork,
        pipeline, attempts, memories, rotations, habitStacks, habitStackSteps,
        books, bookChapters, bookQuestions, bookAttempts, bookMistakes, bookHighlights,
      ] = await Promise.all([
        getProfile(uid),
        getDailyCoreActions(uid),
        listActive<KaizenSkillNodeEntry>('kaizen_skill_nodes', uid),
        listActive<KaizenInterviewQuestionEntry>('kaizen_interview_questions', uid),
        listActive<KaizenKnowledgeItemEntry>('kaizen_knowledge_items', uid),
        listActive<KaizenGtdItemEntry>('kaizen_gtd_items', uid),
        listActive<KaizenWeeklyReviewEntry>('kaizen_weekly_reviews', uid),
        listActive<KaizenActionLogEntry>('kaizen_action_logs', uid),
        listActive<KaizenDeepWorkBlockEntry>('kaizen_deep_work_blocks', uid),
        listActive<KaizenInterviewPipelineEntry>('kaizen_interview_pipeline', uid),
        listActive<KaizenInterviewAttemptEntry>('kaizen_interview_attempts', uid),
        listActive<KaizenUserMemoryEntry>('kaizen_user_memory', uid),
        listActive<KaizenWeeklyRotationEntry>('kaizen_weekly_rotations', uid),
        listActive<KaizenHabitStackEntry>('kaizen_habit_stacks', uid),
        listActive<KaizenHabitStackStepEntry>('kaizen_habit_stack_steps', uid),
        listActive<KaizenBookEntry>('kaizen_books', uid),
        listActive<KaizenBookChapterEntry>('kaizen_book_chapters', uid),
        listActive<KaizenBookQuestionEntry>('kaizen_book_questions', uid),
        listActive<KaizenBookAttemptEntry>('kaizen_book_attempts', uid),
        listActive<KaizenBookMistakeEntry>('kaizen_book_mistakes', uid),
        listActive<KaizenBookHighlightEntry>('kaizen_book_highlights', uid),
      ]);
      const todayLogs = actionLogs.filter(log => log.date === today);
      set(state => {
        state.profile = profile;
        state.dailyCore = dailyCore;
        state.skills = skills;
        state.questions = questions;
        state.knowledge = knowledge;
        state.gtd = gtd;
        state.reviews = reviews;
        state.todayLogs = todayLogs;
        state.deepWork = deepWork;
        state.pipeline = pipeline;
        state.habitStacks = habitStacks;
        state.habitStackSteps = habitStackSteps;
        state.attempts = attempts;
        state.memories = memories;
        state.rotations = rotations;
        state.books = books;
        state.bookChapters = bookChapters;
        state.bookQuestions = bookQuestions;
        state.bookAttempts = bookAttempts;
        state.bookMistakes = bookMistakes;
        state.bookHighlights = bookHighlights;
        state.wakeConfirmedToday = wakeDetection.isConfirmed(uid);
        state.isHydrated = true;
      });

      void watchSync.pushTodaySummary();
    },

    sync: async () => {
      set(state => {
        state.isSyncing = true;
        state.lastError = null;
      });
      try {
        await runKaizenSync(requireUserId());
        await get().hydrate();
      } catch (error) {
        set(state => {
          state.lastError = error instanceof Error ? error.message : 'Sync failed';
        });
      } finally {
        set(state => {
          state.isSyncing = false;
        });
      }
    },

    completeDailyAction: async (actionId, source = 'manual') => {
      await completeActionToday(requireUserId(), actionId, source);
      await get().hydrate();
      void get().scheduleDailyReminders();
      void watchSync.pushTodaySummary();
      void get().sync();
    },

    confirmWake: async () => {
      wakeDetection.confirm(requireUserId());
      set(state => {
        state.wakeConfirmedToday = true;
      });
      void get().scheduleDailyReminders();
      void watchSync.pushTodaySummary();
    },

    skipDailyAction: async actionId => {
      await skipActionToday(requireUserId(), actionId, 'manual');
      await get().hydrate();
      void get().scheduleDailyReminders();
      void watchSync.pushTodaySummary();
      void get().sync();
    },

    setOnboardingComplete: async enabledSystems => {
      const uid = requireUserId();
      const existing = await getProfile(uid);
      const now = new Date().toISOString();
      const profile: KaizenProfileEntry = {
        id: existing?.id ?? cryptoRandomId(),
        user_id: uid,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        onboarding_complete: 1,
        enabled_systems: JSON.stringify(enabledSystems),
        system_activation_states: JSON.stringify(
          Object.fromEntries(enabledSystems.map(s => [s, 'enabled'])),
        ),
        primary_system: enabledSystems[0] ?? 'career',
        daily_core_ids: existing?.daily_core_ids ?? null,
        career_setup_step: existing?.career_setup_step ?? null,
        target_roles: existing?.target_roles ?? null,
        career_goal_types: existing?.career_goal_types ?? null,
        selected_career_skill_ids: existing?.selected_career_skill_ids ?? null,
        resume_source_name: existing?.resume_source_name ?? null,
        resume_summary: existing?.resume_summary ?? null,
        career_plan_summary: existing?.career_plan_summary ?? null,
        interaction_style: existing?.interaction_style ?? null,
        created_at: existing?.created_at ?? now,
        updated_at: now,
        deleted_at: null,
      };
      await upsertLocal('kaizen_profiles', profile);
      await get().hydrate();
      void get().sync();
    },

    beginSetupSystems: async enabledSystems => {
      const uid = requireUserId();
      const existing = await getProfile(uid);
      const now = new Date().toISOString();
      const profile: KaizenProfileEntry = {
        id: existing?.id ?? cryptoRandomId(),
        user_id: uid,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        onboarding_complete: 0,
        enabled_systems: JSON.stringify(enabledSystems),
        system_activation_states: JSON.stringify(
          Object.fromEntries(enabledSystems.map(s => [s, 'enabled'])),
        ),
        primary_system: enabledSystems[0] ?? 'career',
        daily_core_ids: existing?.daily_core_ids ?? null,
        career_setup_step: existing?.career_setup_step ?? null,
        target_roles: existing?.target_roles ?? null,
        career_goal_types: existing?.career_goal_types ?? null,
        selected_career_skill_ids: existing?.selected_career_skill_ids ?? null,
        resume_source_name: existing?.resume_source_name ?? null,
        resume_summary: existing?.resume_summary ?? null,
        career_plan_summary: existing?.career_plan_summary ?? null,
        interaction_style: existing?.interaction_style ?? null,
        created_at: existing?.created_at ?? now,
        updated_at: now,
        deleted_at: null,
      };
      await upsertLocal('kaizen_profiles', profile);
      await get().hydrate();
      void get().sync();
    },

    finishOnboarding: async () => {
      const uid = requireUserId();
      let existing = get().profile;
      if (!existing) {
        await get().hydrate();
        existing = get().profile ?? (await getProfile(uid));
      }
      if (!existing) return;
      const now = new Date().toISOString();
      await upsertLocal('kaizen_profiles', {
        ...existing,
        onboarding_complete: 1,
        updated_at: now,
      });
      await get().hydrate();
      void get().sync();
    },

    resetOnboarding: async () => {
      const uid = requireUserId();
      let existing = get().profile;
      if (!existing) {
        await get().hydrate();
        existing = get().profile ?? (await getProfile(uid));
      }
      if (!existing) return;
      const now = new Date().toISOString();
      await upsertLocal('kaizen_profiles', {
        ...existing,
        onboarding_complete: 0,
        career_setup_step: null,
        updated_at: now,
      });
      await get().hydrate();
      void get().sync();
    },

    addGtdItem: async title => {
      const uid = requireUserId();
      const now = new Date().toISOString();
      await upsertLocal('kaizen_gtd_items', {
        id: cryptoRandomId(),
        user_id: uid,
        title,
        notes: null,
        system: null,
        status: 'inbox',
        captured_at: now,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      });
      await get().hydrate();
      void get().sync();
    },

    updateGtdStatus: async (id, status) => {
      const item = get().gtd.find(entry => entry.id === id);
      if (!item) return;
      await upsertLocal('kaizen_gtd_items', {
        ...item,
        status,
        updated_at: new Date().toISOString(),
      });
      await get().hydrate();
      void get().sync();
    },

    addKnowledgeItem: async (title, paraType, content, tags) => {
      const now = new Date().toISOString();
      await upsertLocal('kaizen_knowledge_items', {
        id: cryptoRandomId(),
        user_id: requireUserId(),
        title,
        para_type: paraType,
        content: content ?? null,
        tags: tags ?? null,
        linked_skill_id: null,
        book_metadata: null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      });
      await get().hydrate();
      void get().sync();
    },

    addDeepWorkBlock: async (topic, startTime, endTime, suggestFocusMode = true) => {
      const now = new Date().toISOString();
      await upsertLocal('kaizen_deep_work_blocks', {
        id: cryptoRandomId(),
        user_id: requireUserId(),
        date: now.slice(0, 10),
        topic,
        start_time: startTime ?? null,
        end_time: endTime ?? null,
        suggest_focus_mode: suggestFocusMode ? 1 : 0,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      });
      await get().hydrate();
      void get().sync();
    },

    saveWeeklyReview: async input => {
      const now = new Date().toISOString();
      const day = new Date();
      day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
      await upsertLocal('kaizen_weekly_reviews', {
        id: cryptoRandomId(),
        user_id: requireUserId(),
        week_start: day.toISOString().slice(0, 10),
        wins: input.wins,
        improvements: input.improvements,
        one_percent_change: input.onePercentChange,
        system_adjustments: null,
        career_snapshot: null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      });
      await get().hydrate();
      void get().sync();
    },

    saveCareerSetup: async input => {
      const uid = requireUserId();
      const existing = get().profile ?? (await getProfile(uid));
      const now = new Date().toISOString();
      if (!existing) return;
      await upsertLocal('kaizen_profiles', {
        ...existing,
        target_roles: JSON.stringify(input.targetRoles),
        career_goal_types: JSON.stringify(input.goalTypes),
        resume_summary: input.resumeSummary ?? existing.resume_summary,
        resume_source_name: input.resumeSourceName ?? existing.resume_source_name,
        career_setup_step: input.step,
        updated_at: now,
      });
      await get().hydrate();
      void get().sync();
    },

    addSkill: async name => {
      const now = new Date().toISOString();
      await upsertLocal('kaizen_skill_nodes', {
        id: cryptoRandomId(),
        user_id: requireUserId(),
        name,
        parent_id: null,
        level_raw: 0,
        mastery_0_to_100: 0,
        activation_state: 'active',
        concept_band: null,
        level_descriptions: null,
        is_priority: 0,
        is_assessable: 1,
        assessment_weight: 1,
        prerequisite_ids: null,
        sort_order: get().skills.length,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      });
      await get().hydrate();
      void get().sync();
    },

    setSkillMastery: async (skillId, mastery) => {
      const skill = get().skills.find(entry => entry.id === skillId);
      if (!skill) return;
      const now = new Date().toISOString();
      const nextMastery = Math.max(0, Math.min(100, mastery));
      await upsertLocal('kaizen_skill_nodes', {
        ...skill,
        mastery_0_to_100: nextMastery,
        updated_at: now,
      });
      await upsertLocal('kaizen_skill_progress_logs', {
        id: cryptoRandomId(),
        user_id: requireUserId(),
        skill_id: skillId,
        previous_level: skill.level_raw,
        new_level: skill.level_raw,
        previous_mastery: skill.mastery_0_to_100,
        new_mastery: nextMastery,
        evidence: 'manual_assessment',
        date: now.slice(0, 10),
        created_at: now,
        updated_at: now,
        deleted_at: null,
      });
      await get().hydrate();
      void get().sync();
    },

    activateSkillForTraining: async skillId => {
      const skill = get().skills.find(item => item.id === skillId);
      if (!skill) return;
      await upsertLocal('kaizen_skill_nodes', { ...skill, activation_state: 'active', updated_at: new Date().toISOString() });
      await get().hydrate(); void get().sync();
    },

    pauseSkill: async skillId => {
      const skill = get().skills.find(item => item.id === skillId);
      if (!skill) return;
      await upsertLocal('kaizen_skill_nodes', { ...skill, activation_state: 'paused', updated_at: new Date().toISOString() });
      await get().hydrate(); void get().sync();
    },

    backlogSkill: async skillId => {
      const skill = get().skills.find(item => item.id === skillId);
      if (!skill) return;
      await upsertLocal('kaizen_skill_nodes', { ...skill, activation_state: 'backlog', updated_at: new Date().toISOString() });
      await get().hydrate(); void get().sync();
    },

    saveAssessmentResult: async result => {
      const skill = get().skills.find(item => item.id === result.skillId);
      if (!skill) return;
      const now = new Date().toISOString();
      await upsertLocal('kaizen_skill_nodes', { ...skill, mastery_0_to_100: result.score0to100, concept_band: result.placedBand, activation_state: 'active', updated_at: now });
      await upsertLocal('kaizen_skill_progress_logs', { id: cryptoRandomId(), user_id: requireUserId(), skill_id: skill.id, previous_level: skill.level_raw, new_level: skill.level_raw, previous_mastery: skill.mastery_0_to_100, new_mastery: result.score0to100, evidence: `assessment:${result.summary}`, date: now.slice(0, 10), created_at: now, updated_at: now, deleted_at: null });
      await get().hydrate(); void get().sync();
    },

    addInterviewQuestion: async (prompt, bank, options) => {
      const trimmed = prompt.trim();
      if (!trimmed) return;
      if (isDuplicatePrompt(trimmed, get().questions)) return;
      const now = new Date().toISOString();
      const reviewStatus = options?.importReviewStatus ?? 'approved';
      await upsertLocal('kaizen_interview_questions', {
        id: cryptoRandomId(),
        user_id: requireUserId(),
        prompt: trimmed,
        question_bank: bank,
        kind: null,
        purpose: 'practice',
        linked_skill_id: null,
        linked_concept_id: null,
        concept_band: null,
        difficulty_0_to_100: null,
        topic_tags: null,
        import_source: options?.importSource ?? 'manual',
        import_batch_id: null,
        source_document_name: null,
        source_hash: hashPrompt(trimmed),
        import_review_status: reviewStatus,
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
        due_at: reviewStatus === 'approved' ? now : null,
        desired_retention: 0.9,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      });
      await get().hydrate();
      void get().sync();
    },

    submitInterviewAttempt: async (questionId, answerText, overallScore, options) => {
      const uid = requireUserId();
      const now = new Date().toISOString();
      const question = get().questions.find(entry => entry.id === questionId);
      if (!question) return;

      let score = overallScore;
      let judgeReasoning: string | null = null;
      let judgeModel: string | null = null;
      let scoredOffline = 1;

      if (options?.useAI && (!question.ideal_answer || !question.rubric)) {
        try {
          const generated = await generateIdealAnswer({ prompt: question.prompt, question_bank: question.question_bank, kind: question.kind });
          if (generated.ideal_answer && generated.rubric) {
            await upsertLocal('kaizen_interview_questions', { ...question, ideal_answer: generated.ideal_answer, rubric: JSON.stringify(generated.rubric), judge_model: generated.model ?? null, updated_at: now });
            question.ideal_answer = generated.ideal_answer;
            question.rubric = JSON.stringify(generated.rubric);
          }
        } catch { /* Preserve offline self-score when generation is unavailable. */ }
      }
      if (options?.useAI && question.ideal_answer && question.rubric) {
        try {
          const judged = await scoreInterviewAnswer({
            prompt: question.prompt,
            ideal_answer: question.ideal_answer,
            rubric: question.rubric,
            answer_text: answerText,
            question_bank: question.question_bank,
            kind: question.kind,
          });
          if (typeof judged.overall_score === 'number') score = judged.overall_score;
          judgeReasoning = judged.reasoning ?? null;
          judgeModel = judged.model ?? 'kaizen-judge';
          scoredOffline = 0;
        } catch {
          // Fall back to self-score when AI judge is unavailable.
        }
      }

      const fsrs = fsrsReview(
        {
          stability: question.stability,
          difficulty: question.difficulty,
          retrievability: question.retrievability,
          reps: question.reps,
          lapses: question.lapses,
          last_reviewed_at: question.last_reviewed_at,
          due_at: question.due_at,
          desired_retention: question.desired_retention || 0.9,
        },
        score,
        now,
      );

      await upsertLocal('kaizen_interview_attempts', {
        id: cryptoRandomId(),
        user_id: uid,
        question_id: questionId,
        attempted_at: now,
        answer_text: answerText,
        answer_source: 'manual',
        duration_seconds: null,
        is_baseline: 0,
        is_diagnostic: 0,
        self_confidence: overallScore,
        criterion_scores: null,
        overall_score: score,
        correction_suggestions: null,
        lesson_learned: null,
        gap_vs_ideal: null,
        fsrs_rating: fsrs.rating,
        judge_reasoning: judgeReasoning,
        judge_model: judgeModel,
        provider_fingerprint: null,
        scored_offline: scoredOffline,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      });

      await upsertLocal('kaizen_interview_questions', {
        ...question,
        stability: fsrs.state.stability,
        difficulty: fsrs.state.difficulty,
        retrievability: fsrs.state.retrievability,
        reps: fsrs.state.reps,
        lapses: fsrs.state.lapses,
        last_reviewed_at: fsrs.state.last_reviewed_at,
        due_at: fsrs.state.due_at,
        updated_at: now,
      });

      await get().hydrate();
      void get().sync();
    },

    getAttemptsForQuestion: questionId =>
      getAttemptsForQuestionFromState(get().attempts, questionId),
    hydrateAttempts: async () => { await get().hydrate(); },

    upsertMemory: async input => {
      const now = new Date().toISOString();
      await upsertLocal('kaizen_user_memory', { id: cryptoRandomId(), user_id: requireUserId(), category: input.category, fact: input.fact, confidence: null, sensitivity: input.sensitivity ?? 'standard', source_kind: 'coach', source_ref: null, source_session_id: null, is_approved: 0, is_archived: 0, last_seen_at: now, expires_at: null, use_in_ai_context: 1, created_at: now, updated_at: now, deleted_at: null });
      await get().hydrate(); void get().sync();
    },
    approveMemory: async fact => {
      const memory = get().memories.find(item => item.fact === fact);
      if (!memory) return;
      await upsertLocal('kaizen_user_memory', { ...memory, is_approved: 1, updated_at: new Date().toISOString() });
      await get().hydrate(); void get().sync();
    },
    saveWeeklyRotation: async (weekday, focusTitle) => {
      const existing = get().rotations.find(item => item.weekday === weekday);
      const now = new Date().toISOString();
      await upsertLocal('kaizen_weekly_rotations', { id: existing?.id ?? cryptoRandomId(), user_id: requireUserId(), weekday, focus_title: focusTitle, system: existing?.system ?? null, linked_skill_id: existing?.linked_skill_id ?? null, created_at: existing?.created_at ?? now, updated_at: now, deleted_at: null });
      recordE2EPersistEntry({
        store: 'kaizen_weekly_rotations',
        operation: 'upsert',
        detail: `weekday=${weekday}`,
      });
      await get().hydrate(); void get().sync();
    },
    sendCoachMessage: async (text, history, disclosureAck, sessionId) => {
      return postCoachMessage({ messages: [...history, { role: 'user', content: text }], session_id: sessionId, snapshot: JSON.stringify(buildKaizenContextSnapshot(get())), disclosure_ack: disclosureAck });
    },

    setSystemActivation: async (system, activationState) => {
      const uid = requireUserId();
      const profile = (await getProfile(uid)) ?? get().profile;
      if (!profile) return;
      let states: Record<string, string> = {};
      try { states = JSON.parse(profile.system_activation_states ?? '{}') as Record<string, string>; } catch { /* reset invalid legacy state */ }
      const nextStates = { ...states, [system]: activationState };
      const nextProfile = {
        ...profile,
        system_activation_states: JSON.stringify(nextStates),
        updated_at: new Date().toISOString(),
      };
      set(state => {
        state.profile = nextProfile;
      });
      await upsertLocal('kaizen_profiles', nextProfile);
      if (!__DEV__) {
        void get().sync();
      }
    },

    materializeSystemTasks: async (system, templateIds, customTasks) => {
      for (const action of materializeActions(requireUserId(), system, templateIds, customTasks)) {
        await upsertLocal('kaizen_actions', action);
      }
      await get().hydrate(); void get().sync();
    },

    upsertPipelineItem: async input => {
      const existing = input.id ? get().pipeline.find(item => item.id === input.id) : undefined;
      const now = new Date().toISOString();
      await upsertLocal('kaizen_interview_pipeline', {
        ...existing, ...input, id: input.id ?? cryptoRandomId(), user_id: requireUserId(),
        linked_skill_id: input.linked_skill_id ?? existing?.linked_skill_id ?? null,
        notes: input.notes ?? existing?.notes ?? null, sort_order: existing?.sort_order ?? get().pipeline.length,
        created_at: existing?.created_at ?? now, updated_at: now, deleted_at: null,
      });
      await get().hydrate(); void get().sync();
    },
    movePipelineStage: async (id, stage) => {
      const item = get().pipeline.find(entry => entry.id === id);
      if (item) await get().upsertPipelineItem({ ...item, stage });
    },
    deletePipelineItem: async id => {
      await softDelete('kaizen_interview_pipeline', id);
      await get().hydrate(); void get().sync();
    },

    upsertHabitStack: async (name, actionIds, id) => {
      const existing = id ? get().habitStacks.find(stack => stack.id === id) : undefined;
      const now = new Date().toISOString();
      const stackId = id ?? cryptoRandomId();
      const uid = requireUserId();
      await upsertLocal('kaizen_habit_stacks', { id: stackId, user_id: uid, name, sort_order: existing?.sort_order ?? get().habitStacks.length, created_at: existing?.created_at ?? now, updated_at: now, deleted_at: null });
      const previousSteps = get().habitStackSteps.filter(step => step.stack_id === stackId);
      for (const step of previousSteps) {
        if (!step.action_id || !actionIds.includes(step.action_id)) {
          await softDelete('kaizen_habit_stack_steps', step.id);
        }
      }
      for (const [sortOrder, actionId] of actionIds.entries()) {
        await upsertLocal('kaizen_habit_stack_steps', { id: `${stackId}-${actionId}`, user_id: uid, stack_id: stackId, action_id: actionId, sort_order: sortOrder, created_at: now, updated_at: now, deleted_at: null });
      }
      const allActions = await listActive<KaizenActionEntry>('kaizen_actions', uid);
      for (const action of allActions) {
        if (action.stack_id === stackId && !actionIds.includes(action.id)) {
          await upsertLocal('kaizen_actions', { ...action, stack_id: null, updated_at: now });
        }
      }
      for (const [sortOrder, actionId] of actionIds.entries()) {
        const action = allActions.find(item => item.id === actionId);
        if (action) {
          await upsertLocal('kaizen_actions', { ...action, stack_id: stackId, sort_order: sortOrder, updated_at: now });
        }
      }
      await get().hydrate(); void get().sync();
    },
    deleteHabitStack: async id => {
      const now = new Date().toISOString();
      const uid = requireUserId();
      await softDelete('kaizen_habit_stacks', id);
      for (const step of get().habitStackSteps.filter(item => item.stack_id === id)) {
        await softDelete('kaizen_habit_stack_steps', step.id);
      }
      const allActions = await listActive<KaizenActionEntry>('kaizen_actions', uid);
      for (const action of allActions.filter(item => item.stack_id === id)) {
        await upsertLocal('kaizen_actions', { ...action, stack_id: null, updated_at: now });
      }
      await get().hydrate(); void get().sync();
    },
    upsertWeeklyRotation: async (weekday, focusTitle, system) => {
      const existing = get().rotations.find(rotation => rotation.weekday === weekday);
      const now = new Date().toISOString();
      await upsertLocal('kaizen_weekly_rotations', { id: existing?.id ?? cryptoRandomId(), user_id: requireUserId(), weekday, focus_title: focusTitle, system: system ?? null, linked_skill_id: null, created_at: existing?.created_at ?? now, updated_at: now, deleted_at: null });
      await get().hydrate(); void get().sync();
    },

    approveQuestion: async id => {
      const question = get().questions.find(item => item.id === id);
      if (!question) return;
      const now = new Date().toISOString();
      await upsertLocal('kaizen_interview_questions', {
        ...question,
        import_review_status: 'approved',
        due_at: question.due_at ?? now,
        updated_at: now,
      });
      await get().hydrate(); void get().sync();
    },
    rejectQuestion: async id => {
      const question = get().questions.find(item => item.id === id);
      if (!question) return;
      await upsertLocal('kaizen_interview_questions', { ...question, import_review_status: 'rejected', updated_at: new Date().toISOString() });
      await get().hydrate(); void get().sync();
    },
    generateIdealAnswerForQuestion: async id => {
      const question = get().questions.find(item => item.id === id);
      if (!question) return;
      const generated = await generateIdealAnswer({ prompt: question.prompt, question_bank: question.question_bank, kind: question.kind });
      await upsertLocal('kaizen_interview_questions', { ...question, ideal_answer: generated.ideal_answer ?? question.ideal_answer, rubric: generated.rubric ?? question.rubric, judge_model: generated.model ?? question.judge_model, ideal_answer_version: question.ideal_answer_version + 1, updated_at: new Date().toISOString() });
      await get().hydrate(); void get().sync();
    },
    setAIDisclosureAck: persistAIDisclosureAck,
    hasAIDisclosureAck: getAIDisclosureAck,
    archiveMemory: async id => {
      const memory = get().memories.find(item => item.id === id);
      if (!memory) return;
      await upsertLocal('kaizen_user_memory', { ...memory, is_archived: 1, updated_at: new Date().toISOString() });
      await get().hydrate(); void get().sync();
    },
    buildCoachSnapshot: () => buildKaizenContextSnapshot(get()) as Record<string, unknown>,

    importQuestionsFromText: async documentText => {
      const pendingOptions = {
        importReviewStatus: 'pending' as const,
        importSource: 'import',
      };
      const lineSplitCandidates = documentText
        .split(/\n+/)
        .map(line => line.replace(/^[\s•\-\d.)]+/, '').trim())
        .filter(line => line.length > 8);
      const devSingleQuestionImport =
        __DEV__ && lineSplitCandidates.length === 1 && lineSplitCandidates[0]?.includes('?');

      if (!devSingleQuestionImport) {
        try {
          const extracted = await extractKaizenQuestions(documentText);
          const questions = extracted.questions ?? [];
          for (const item of questions) {
            const bank =
              item.question_bank === 'behavioral' || item.bank === 'behavioral'
                ? 'behavioral'
                : 'technical';
            const prompt = item.prompt ?? item.question ?? '';
            if (!prompt.trim()) continue;
            await get().addInterviewQuestion(prompt, bank, pendingOptions);
          }
          if (questions.length) return questions.length;
        } catch {
          // Fall through to line-split import.
        }
      }

      for (const prompt of lineSplitCandidates) {
        await get().addInterviewQuestion(prompt, 'technical', pendingOptions);
      }
      return lineSplitCandidates.length;
    },

    analyzeResume: async resumeText => {
      try {
        return await analyzeCareerResume(resumeText);
      } catch {
        return { summary: resumeText.slice(0, 280) };
      }
    },

    scheduleDailyReminders: async (wakeAnchor?: Date) => {
      const state = get();
      const doneOrSkipped = completedActionIdsFromLogs(state.todayLogs);
      await scheduleDailyCoreReminders(state.dailyCore, {
        wakeAnchor: wakeAnchor ?? (state.wakeConfirmedToday ? new Date() : undefined),
        completedOrSkippedActionIds: doneOrSkipped,
        focusFilterActive: isDeepWorkFocusFilterActive(),
      });
    },

    // ========================================================================
    // Book Comprehension & Retention
    // ========================================================================

    addBook: async input =>
      addBookAction(
        {
          get,
          hydrate: () => get().hydrate(),
          sync: () => get().sync(),
          requireUserId,
          cryptoRandomId,
        },
        input,
      ),

    addBookChapter: async (bookId, input) => {
      const uid = requireUserId();
      const now = new Date().toISOString();
      const chapterId = cryptoRandomId();
      const existing = get().bookChapters.filter(c => c.book_id === bookId);
      await upsertLocal('kaizen_book_chapters', {
        id: chapterId,
        user_id: uid,
        book_id: bookId,
        chapter_index: existing.length,
        title: input.title,
        start_page: input.startPage ?? null,
        end_page: input.endPage ?? null,
        status: 'none',
        content_object_key: null,
        summary: null,
        read_at: null,
        questions_generated_at: null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      });
      await get().hydrate();
      void get().sync();
      return chapterId;
    },

    deleteBook: async bookId =>
      deleteBookAction(
        {
          get,
          hydrate: () => get().hydrate(),
          sync: () => get().sync(),
          requireUserId,
          cryptoRandomId,
        },
        bookId,
      ),

    markBookChapterRead: async chapterId =>
      markBookChapterReadAction(
        {
          get,
          hydrate: () => get().hydrate(),
          sync: () => get().sync(),
          requireUserId,
          cryptoRandomId,
        },
        chapterId,
      ),

    attachBookFile: async (bookId, file) => {
      const now = new Date().toISOString();
      const book = get().books.find(b => b.id === bookId);
      if (!book) return;
      const uploaded = await uploadBookFile(bookId, file);
      await upsertLocal('kaizen_books', {
        ...book,
        source_type: 'pdf',
        file_object_key: uploaded.fileKey,
        file_name: uploaded.fileName,
        updated_at: now,
      });
      // If the book has no chapters yet, auto-detect them from the PDF's ToC.
      const existingChapters = get().bookChapters.filter(
        c => c.book_id === bookId && !c.deleted_at,
      );
      if (existingChapters.length === 0) {
        try {
          const uid = requireUserId();
          const toc = await extractBookToc(uploaded.fileKey);
          for (let i = 0; i < toc.chapters.length; i++) {
            const ch = toc.chapters[i];
            await upsertLocal('kaizen_book_chapters', {
              id: cryptoRandomId(),
              user_id: uid,
              book_id: bookId,
              chapter_index: i,
              title: ch.title,
              start_page: ch.start_page ?? null,
              end_page: ch.end_page ?? null,
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
          if (typeof toc.page_count === 'number') {
            await upsertLocal('kaizen_books', {
              ...book,
              source_type: 'pdf',
              file_object_key: uploaded.fileKey,
              file_name: uploaded.fileName,
              page_count: toc.page_count,
              updated_at: now,
            });
          }
        } catch {
          // ToC auto-detection is best-effort; the user can still add chapters manually.
        }
      }
      await get().hydrate();
      void get().sync();
    },

    generateBookChapterQuestions: async (chapterId, opts) => {
      const uid = requireUserId();
      const now = new Date().toISOString();
      const chapter = get().bookChapters.find(c => c.id === chapterId);
      if (!chapter) return 0;
      const book = get().books.find(b => b.id === chapter.book_id);
      if (!book) return 0;

      const types = opts?.types ?? ['mcq', 'open', 'spoken'];
      const count = opts?.count ?? 6;
      const highlights = (opts?.highlightIds ?? [])
        .map(id => get().bookHighlights.find(h => h.id === id)?.text)
        .filter((t): t is string => typeof t === 'string');

      // For PDF-backed books, extract ONLY this chapter's text on demand (cached
      // server-side) to ground generation in the real content. ToC-only books
      // pass null and generate from the book/chapter title.
      let chapterText: string | null = null;
      let contentKey: string | null = chapter.content_object_key;
      if (book.source_type === 'pdf' && book.file_object_key) {
        try {
          const extracted = await extractBookChapter({
            fileKey: book.file_object_key,
            chapterTitle: chapter.title,
            startPage: chapter.start_page,
            endPage: chapter.end_page,
          });
          chapterText = extracted.text || null;
          contentKey = extracted.contentKey;
        } catch {
          chapterText = null;
        }
      }

      const tocContext = get()
        .bookChapters.filter(c => c.book_id === book.id)
        .sort((a, b) => a.chapter_index - b.chapter_index)
        .map(c => `${c.chapter_index + 1}. ${c.title}`)
        .join('\n');

      const { questions } = await generateBookQuestions({
        bookTitle: book.title,
        author: book.author,
        chapterTitle: chapter.title,
        chapterText,
        tocContext,
        types,
        count,
        language: book.language || 'en',
        highlights: highlights.length ? highlights : undefined,
      });

      for (const q of questions) {
        await upsertLocal('kaizen_book_questions', {
          id: cryptoRandomId(),
          user_id: uid,
          book_id: book.id,
          chapter_id: chapter.id,
          type: q.type,
          prompt: q.prompt,
          options: q.options ? JSON.stringify(q.options) : null,
          answer_index: typeof q.answer_index === 'number' ? q.answer_index : null,
          ideal_answer: q.ideal_answer ?? null,
          rubric: q.rubric ? JSON.stringify(q.rubric) : null,
          language: book.language || 'en',
          difficulty_0_to_100:
            typeof q.difficulty_0_to_100 === 'number' ? Math.round(q.difficulty_0_to_100) : null,
          source_highlight_id: opts?.highlightIds?.[0] ?? null,
          stability: null,
          difficulty: null,
          retrievability: null,
          reps: 0,
          lapses: 0,
          last_reviewed_at: null,
          due_at: now,
          desired_retention: 0.9,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        });
      }

      await upsertLocal('kaizen_book_chapters', {
        ...chapter,
        status: 'ready',
        content_object_key: contentKey ?? chapter.content_object_key,
        questions_generated_at: now,
        updated_at: now,
      });
      await get().hydrate();
      void get().sync();
      return questions.length;
    },

    submitBookAttempt: async (questionId, input) => {
      const uid = requireUserId();
      const now = new Date().toISOString();
      const question = get().bookQuestions.find(q => q.id === questionId);
      if (!question) return;

      let answerSource: 'typed' | 'mcq' = 'typed';
      let overallScore = 0;
      let contentScore: number | null = null;
      let isCorrect: number | null = null;
      let feedback: string | null = null;
      let mistakesJson: string | null = null;

      if (question.type === 'mcq') {
        answerSource = 'mcq';
        const correct = input.selectedIndex === question.answer_index;
        isCorrect = correct ? 1 : 0;
        overallScore = correct ? 1 : 0;
        contentScore = overallScore;
        feedback = correct ? 'Correct.' : 'Not quite — review the chapter and try again.';
      } else {
        // open / spoken (text) — two-layer AI grading.
        const answerText = (input.answerText ?? '').trim();
        try {
          const graded = await gradeBookAnswer({
            prompt: question.prompt,
            idealAnswer: question.ideal_answer,
            rubric: question.rubric ? (JSON.parse(question.rubric) as string[]) : null,
            answerText,
            language: question.language || 'en',
          });
          overallScore = graded.overall_score;
          contentScore = graded.content_score;
          feedback = graded.feedback;
          mistakesJson = graded.mistakes?.length ? JSON.stringify(graded.mistakes) : null;

          // File recurring grammar/form mistakes (basic dedup by type|text).
          for (const m of graded.mistakes ?? []) {
            const dedupKey = `${m.type}|${(m.text || '').toLowerCase().trim()}`.slice(0, 200);
            const existing = get().bookMistakes.find(
              x => x.dedup_key === dedupKey && !x.deleted_at,
            );
            if (existing) {
              await upsertLocal('kaizen_book_mistakes', {
                ...existing,
                regression_count: (existing.regression_count ?? 0) + 1,
                last_seen_at: now,
                updated_at: now,
              });
            } else {
              await upsertLocal('kaizen_book_mistakes', {
                id: cryptoRandomId(),
                user_id: uid,
                book_id: question.book_id,
                type: m.type || 'grammar',
                text: m.text,
                correction: m.correction ?? null,
                explanation: m.explanation ?? null,
                severity: m.severity ?? null,
                status: 'detected',
                dedup_key: dedupKey,
                regression_count: 0,
                srs_state: null,
                due_at: now,
                last_seen_at: now,
                created_at: now,
                updated_at: now,
                deleted_at: null,
              });
            }
          }
        } catch {
          // AI grading unavailable — record the attempt unscored.
          feedback = 'Saved. AI grading is temporarily unavailable.';
        }
      }

      const fsrs = fsrsReview(
        {
          stability: question.stability,
          difficulty: question.difficulty,
          retrievability: question.retrievability,
          reps: question.reps,
          lapses: question.lapses,
          last_reviewed_at: question.last_reviewed_at,
          due_at: question.due_at,
          desired_retention: question.desired_retention || 0.9,
        },
        overallScore,
        now,
      );

      await upsertLocal('kaizen_book_attempts', {
        id: cryptoRandomId(),
        user_id: uid,
        question_id: questionId,
        book_id: question.book_id,
        chapter_id: question.chapter_id,
        attempted_at: now,
        answer_source: answerSource,
        answer_text: input.answerText ?? null,
        selected_index: typeof input.selectedIndex === 'number' ? input.selectedIndex : null,
        is_correct: isCorrect,
        audio_object_key: null,
        transcription: null,
        content_score: contentScore,
        overall_score: overallScore,
        mistakes: mistakesJson,
        pronunciation: null,
        delivery: null,
        feedback,
        fsrs_rating: fsrs.rating,
        scored_offline: question.type === 'mcq' ? 1 : 0,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      });

      await upsertLocal('kaizen_book_questions', {
        ...question,
        stability: fsrs.state.stability,
        difficulty: fsrs.state.difficulty,
        retrievability: fsrs.state.retrievability,
        reps: fsrs.state.reps,
        lapses: fsrs.state.lapses,
        last_reviewed_at: fsrs.state.last_reviewed_at,
        due_at: fsrs.state.due_at,
        desired_retention: fsrs.state.desired_retention,
        updated_at: now,
      });

      await get().hydrate();
      void get().sync();
    },

    submitSpokenBookAttempt: async (questionId, audio) => {
      const uid = requireUserId();
      const now = new Date().toISOString();
      const question = get().bookQuestions.find(q => q.id === questionId);
      if (!question) return;

      let overallScore = 0;
      let contentScore: number | null = null;
      let feedback: string | null = null;
      let mistakesJson: string | null = null;
      let transcription: string | null = null;
      let pronunciationJson: string | null = null;
      let deliveryJson: string | null = null;

      // File one recurring-mistake ticket (dedup by type|text), mirroring submitBookAttempt.
      const fileMistake = async (
        type: string,
        text: string,
        correction: string | null,
        explanation: string | null,
        severity: string | null,
      ) => {
        const dedupKey = `${type}|${(text || '').toLowerCase().trim()}`.slice(0, 200);
        const existing = get().bookMistakes.find(x => x.dedup_key === dedupKey && !x.deleted_at);
        if (existing) {
          await upsertLocal('kaizen_book_mistakes', {
            ...existing,
            regression_count: (existing.regression_count ?? 0) + 1,
            last_seen_at: now,
            updated_at: now,
          });
        } else {
          await upsertLocal('kaizen_book_mistakes', {
            id: cryptoRandomId(),
            user_id: uid,
            book_id: question.book_id,
            type,
            text,
            correction,
            explanation,
            severity,
            status: 'detected',
            dedup_key: dedupKey,
            regression_count: 0,
            srs_state: null,
            due_at: now,
            last_seen_at: now,
            created_at: now,
            updated_at: now,
            deleted_at: null,
          });
        }
      };

      try {
        const graded = await gradeSpokenBookAnswer({
          audio: { uri: audio.uri },
          prompt: question.prompt,
          idealAnswer: question.ideal_answer,
          rubric: question.rubric ? (JSON.parse(question.rubric) as string[]) : null,
          language: question.language || 'en',
        });
        overallScore = graded.overall_score;
        contentScore = graded.content_score;
        feedback = graded.feedback;
        transcription = graded.transcription ?? null;
        mistakesJson = graded.mistakes?.length ? JSON.stringify(graded.mistakes) : null;
        pronunciationJson = graded.pronunciation ? JSON.stringify(graded.pronunciation) : null;
        deliveryJson = graded.delivery ? JSON.stringify(graded.delivery) : null;

        for (const m of graded.mistakes ?? []) {
          await fileMistake(
            m.type || 'grammar',
            m.text,
            m.correction ?? null,
            m.explanation ?? null,
            m.severity ?? null,
          );
        }
        // Pronunciation problem words become their own recurring drills.
        for (const w of graded.pronunciation?.words ?? []) {
          if (w.is_problem) {
            await fileMistake('pronunciation', w.word, w.tip ?? null, w.tip ?? null, 'medium');
          }
        }
      } catch {
        feedback = 'Saved. AI grading is temporarily unavailable.';
      }

      const fsrs = fsrsReview(
        {
          stability: question.stability,
          difficulty: question.difficulty,
          retrievability: question.retrievability,
          reps: question.reps,
          lapses: question.lapses,
          last_reviewed_at: question.last_reviewed_at,
          due_at: question.due_at,
          desired_retention: question.desired_retention || 0.9,
        },
        overallScore,
        now,
      );

      await upsertLocal('kaizen_book_attempts', {
        id: cryptoRandomId(),
        user_id: uid,
        question_id: questionId,
        book_id: question.book_id,
        chapter_id: question.chapter_id,
        attempted_at: now,
        answer_source: 'spoken',
        answer_text: transcription,
        selected_index: null,
        is_correct: null,
        audio_object_key: null,
        transcription,
        content_score: contentScore,
        overall_score: overallScore,
        mistakes: mistakesJson,
        pronunciation: pronunciationJson,
        delivery: deliveryJson,
        feedback,
        fsrs_rating: fsrs.rating,
        scored_offline: 0,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      });

      await upsertLocal('kaizen_book_questions', {
        ...question,
        stability: fsrs.state.stability,
        difficulty: fsrs.state.difficulty,
        retrievability: fsrs.state.retrievability,
        reps: fsrs.state.reps,
        lapses: fsrs.state.lapses,
        last_reviewed_at: fsrs.state.last_reviewed_at,
        due_at: fsrs.state.due_at,
        desired_retention: fsrs.state.desired_retention,
        updated_at: now,
      });

      await get().hydrate();
      void get().sync();
    },

    readChapterText: async chapterId => {
      const chapter = get().bookChapters.find(c => c.id === chapterId);
      if (!chapter) return '';
      const book = get().books.find(b => b.id === chapter.book_id);
      if (!book) return '';

      // Prefer the server-cached extracted text.
      if (chapter.content_object_key) {
        try {
          const r = await fetchBookChapterText(chapter.content_object_key);
          if (r.text) return r.text;
        } catch {
          // fall through to (re)extract
        }
      }
      // Extract on demand for PDF-backed books.
      if (book.source_type === 'pdf' && book.file_object_key) {
        try {
          const ex = await extractBookChapter({
            fileKey: book.file_object_key,
            chapterTitle: chapter.title,
            startPage: chapter.start_page,
            endPage: chapter.end_page,
          });
          const now = new Date().toISOString();
          await upsertLocal('kaizen_book_chapters', {
            ...chapter,
            content_object_key: ex.contentKey,
            status: 'ready',
            updated_at: now,
          });
          await get().hydrate();
          void get().sync();
          return ex.text ?? '';
        } catch {
          return '';
        }
      }
      return '';
    },

    addBookHighlight: async input => {
      const uid = requireUserId();
      const now = new Date().toISOString();
      await upsertLocal('kaizen_book_highlights', {
        id: cryptoRandomId(),
        user_id: uid,
        book_id: input.bookId,
        chapter_id: input.chapterId,
        text: input.text,
        anchor: input.anchor ?? null,
        color: input.color ?? null,
        note: input.note ?? null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      });
      await get().hydrate();
      void get().sync();
    },

    updateBookHighlight: async (id, patch) => {
      const existing = get().bookHighlights.find(h => h.id === id);
      if (!existing) return;
      const now = new Date().toISOString();
      await upsertLocal('kaizen_book_highlights', {
        ...existing,
        color: patch.color ?? existing.color,
        note: patch.note ?? existing.note,
        updated_at: now,
      });
      await get().hydrate();
      void get().sync();
    },

    deleteBookHighlight: async id => {
      await softDelete('kaizen_book_highlights', id);
      await get().hydrate();
      void get().sync();
    },

    getBookChapters: bookId => getBookChaptersFromState(get().bookChapters, bookId),

    getBookQuestionsForChapter: chapterId =>
      getBookQuestionsForChapterFromState(get().bookQuestions, chapterId),

    getBookHighlightsForChapter: chapterId =>
      getBookHighlightsForChapterFromState(get().bookHighlights, chapterId),
  })),
);
