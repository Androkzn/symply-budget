/**
 * Verifies every donor-contract wrapper in the Language api layer: each method's
 * path, HTTP method, request body/query-string shaping, and response unwrapping
 * (`.then((r) => r.field)`). `languageRequest` is mocked so we assert exactly
 * what each wrapper asks the client for, and what it hands back to callers.
 */
const mockRequest = jest.fn();
jest.mock('../languageClient', () => {
  class LanguageApiError extends Error {
    readonly status: number;
    readonly body: unknown;
    constructor(status: number, message: string, body: unknown) {
      super(message);
      this.name = 'LanguageApiError';
      this.status = status;
      this.body = body;
    }
  }
  return {
    LanguageApiError,
    LANGUAGE_API_PREFIX: '/api/v1',
    languageRequest: (...args: unknown[]) => mockRequest(...args),
  };
});

import * as languageApiBarrel from '../index';
import { languageAssessmentApi } from '../languageAssessment';
import { languageCardsApi } from '../languageCards';
import { LanguageApiError } from '../languageClient';
import {
  languageDialoguesApi,
  languageGamesApi,
  languageVoiceApi,
  languagePracticeApi,
  languageDriveApi,
} from '../languageExtras';
import { languagePlanApi } from '../languagePlan';
import { languageProfileApi, isLearnerOnboarded } from '../languageProfile';
import { languageProgressApi } from '../languageProgress';
import { languageReviewsApi } from '../languageReviews';
import { languageTutorApi, tutorTodayDate } from '../languageTutor';

beforeEach(() => mockRequest.mockReset());

describe('api barrel (index.ts)', () => {
  it('re-exports every api surface + helpers', () => {
    expect(typeof languageApiBarrel.languageRequest).toBe('function');
    expect(languageApiBarrel.LanguageApiError).toBeDefined();
    expect(languageApiBarrel.languageAuthApi).toBeDefined();
    expect(languageApiBarrel.languageProfileApi).toBeDefined();
    expect(typeof languageApiBarrel.isLearnerOnboarded).toBe('function');
    expect(languageApiBarrel.languageTutorApi).toBeDefined();
    expect(typeof languageApiBarrel.tutorTodayDate).toBe('function');
    expect(languageApiBarrel.languageAssessmentApi).toBeDefined();
    expect(languageApiBarrel.languagePlanApi).toBeDefined();
    expect(languageApiBarrel.languageProgressApi).toBeDefined();
    expect(languageApiBarrel.languageCardsApi).toBeDefined();
    expect(languageApiBarrel.languageReviewsApi).toBeDefined();
    expect(languageApiBarrel.languageDialoguesApi).toBeDefined();
    expect(languageApiBarrel.languageGamesApi).toBeDefined();
    expect(languageApiBarrel.languageVoiceApi).toBeDefined();
    expect(languageApiBarrel.languagePracticeApi).toBeDefined();
    expect(languageApiBarrel.languageDriveApi).toBeDefined();
  });
});

// ── Assessment ────────────────────────────────────────────────────────────────
describe('languageAssessmentApi', () => {
  it('getTopics unwraps { topics }', async () => {
    mockRequest.mockResolvedValue({ topics: [{ id: 't1', name: 'Travel' }] });
    const topics = await languageAssessmentApi.getTopics();
    expect(mockRequest).toHaveBeenCalledWith('/assessment/topics');
    expect(topics).toEqual([{ id: 't1', name: 'Travel' }]);
  });

  it('start POSTs the domains', async () => {
    mockRequest.mockResolvedValue({ sessionId: 's1' });
    await languageAssessmentApi.start(['grammar', 'vocab']);
    expect(mockRequest).toHaveBeenCalledWith('/assessment/start', {
      method: 'POST',
      body: { domains: ['grammar', 'vocab'] },
    });
  });

  it('start with no domains sends body { domains: undefined }', async () => {
    mockRequest.mockResolvedValue({ sessionId: 's1' });
    await languageAssessmentApi.start();
    expect(mockRequest).toHaveBeenCalledWith('/assessment/start', {
      method: 'POST',
      body: { domains: undefined },
    });
  });

  it('nextQuestion POSTs sessionId + kind', async () => {
    mockRequest.mockResolvedValue({ isComplete: false });
    await languageAssessmentApi.nextQuestion('s1', 'initial');
    expect(mockRequest).toHaveBeenCalledWith('/assessment/smart-adaptive/next', {
      method: 'POST',
      body: { sessionId: 's1', kind: 'initial' },
    });
  });

  it('submitAnswer forwards the full input payload', async () => {
    mockRequest.mockResolvedValue({ isCorrect: true });
    const input = {
      sessionId: 's1',
      questionId: 'q1',
      responseText: 'hola',
      inputMode: 'type' as const,
      kind: 'initial',
    };
    await languageAssessmentApi.submitAnswer(input);
    expect(mockRequest).toHaveBeenCalledWith('/assessment/smart-adaptive/submit', {
      method: 'POST',
      body: input,
    });
  });

  it('complete POSTs the sessionId', async () => {
    mockRequest.mockResolvedValue({ planProcessing: true });
    await languageAssessmentApi.complete('s1');
    expect(mockRequest).toHaveBeenCalledWith('/assessment/complete', {
      method: 'POST',
      body: { sessionId: 's1' },
    });
  });

  it('getResults / getStatus GET their endpoints', async () => {
    mockRequest.mockResolvedValue({});
    await languageAssessmentApi.getResults();
    expect(mockRequest).toHaveBeenCalledWith('/assessment/results');
    await languageAssessmentApi.getStatus();
    expect(mockRequest).toHaveBeenCalledWith('/assessment/status');
  });

  it('getHistory unwraps { assessments }', async () => {
    mockRequest.mockResolvedValue({ assessments: [{ id: 'a1' }] });
    const hist = await languageAssessmentApi.getHistory();
    expect(mockRequest).toHaveBeenCalledWith('/assessment/history');
    expect(hist).toEqual([{ id: 'a1' }]);
  });
});

// ── Cards ─────────────────────────────────────────────────────────────────────
describe('languageCardsApi', () => {
  it('list with no params hits /cards with no query string', async () => {
    mockRequest.mockResolvedValue({ cards: [], pagination: {} });
    await languageCardsApi.list();
    expect(mockRequest).toHaveBeenCalledWith('/cards');
  });

  it('list builds a query string from all params', async () => {
    mockRequest.mockResolvedValue({ cards: [], pagination: {} });
    await languageCardsApi.list({
      page: 2,
      limit: 50,
      type: 'vocabulary',
      state: 'active',
      search: 'hola',
      practiceKind: 'flashcard',
      active: false,
    });
    const path = mockRequest.mock.calls[0][0] as string;
    expect(path.startsWith('/cards?')).toBe(true);
    const qs = new URLSearchParams(path.split('?')[1]);
    expect(qs.get('page')).toBe('2');
    expect(qs.get('limit')).toBe('50');
    expect(qs.get('type')).toBe('vocabulary');
    expect(qs.get('state')).toBe('active');
    expect(qs.get('search')).toBe('hola');
    expect(qs.get('practiceKind')).toBe('flashcard');
    expect(qs.get('active')).toBe('false');
  });

  it('due with no params hits /cards/due', async () => {
    mockRequest.mockResolvedValue({ dueCards: [], totalDue: 0 });
    await languageCardsApi.due();
    expect(mockRequest).toHaveBeenCalledWith('/cards/due');
  });

  it('due forwards practiceKind + state as query', async () => {
    mockRequest.mockResolvedValue({ dueCards: [], totalDue: 0 });
    await languageCardsApi.due({ practiceKind: 'flashcard', state: 'regression_due' });
    const path = mockRequest.mock.calls[0][0] as string;
    const qs = new URLSearchParams(path.split('?')[1]);
    expect(qs.get('practiceKind')).toBe('flashcard');
    expect(qs.get('state')).toBe('regression_due');
  });

  it('create POSTs the card and unwraps { card }', async () => {
    mockRequest.mockResolvedValue({ card: { id: 'c1' } });
    const input = {
      cardType: 'vocabulary' as const,
      skillDomain: 'reading' as const,
      cefrLevel: 'A1' as const,
      frontContent: 'hola',
      backContent: 'hello',
    };
    const card = await languageCardsApi.create(input);
    expect(mockRequest).toHaveBeenCalledWith('/cards', { method: 'POST', body: input });
    expect(card).toEqual({ id: 'c1' });
  });

  it('update PUTs to /cards/:id and unwraps { card }', async () => {
    mockRequest.mockResolvedValue({ card: { id: 'c1', is_active: 0 } });
    const card = await languageCardsApi.update('c1', { isActive: false });
    expect(mockRequest).toHaveBeenCalledWith('/cards/c1', {
      method: 'PUT',
      body: { isActive: false },
    });
    expect(card).toEqual({ id: 'c1', is_active: 0 });
  });

  it('remove DELETEs /cards/:id', async () => {
    mockRequest.mockResolvedValue({ success: true });
    await languageCardsApi.remove('c1');
    expect(mockRequest).toHaveBeenCalledWith('/cards/c1', { method: 'DELETE' });
  });

  it('bulkImport POSTs { cards } to /cards/bulk-import', async () => {
    mockRequest.mockResolvedValue({ imported: 1, failed: 0, errors: [] });
    const cards = [
      {
        cardType: 'vocabulary' as const,
        skillDomain: 'reading' as const,
        cefrLevel: 'A1' as const,
        frontContent: 'a',
        backContent: 'b',
      },
    ];
    await languageCardsApi.bulkImport(cards);
    expect(mockRequest).toHaveBeenCalledWith('/cards/bulk-import', {
      method: 'POST',
      body: { cards },
    });
  });
});

// ── Profile / learner ───────────────────────────────────────────────────────────
describe('languageProfileApi', () => {
  it('getUser GETs /user/profile', async () => {
    mockRequest.mockResolvedValue({ id: 'u1' });
    await languageProfileApi.getUser();
    expect(mockRequest).toHaveBeenCalledWith('/user/profile');
  });

  it('getLearnerProfile unwraps { profile }', async () => {
    mockRequest.mockResolvedValue({ profile: { nativeLanguage: 'English' } });
    const p = await languageProfileApi.getLearnerProfile();
    expect(mockRequest).toHaveBeenCalledWith('/learner/profile');
    expect(p).toEqual({ nativeLanguage: 'English' });
  });

  it('updateLearnerProfile PUTs the patch and unwraps { profile }', async () => {
    mockRequest.mockResolvedValue({ profile: { nativeLanguage: 'French' } });
    const p = await languageProfileApi.updateLearnerProfile({ nativeLanguage: 'French' });
    expect(mockRequest).toHaveBeenCalledWith('/learner/profile', {
      method: 'PUT',
      body: { nativeLanguage: 'French' },
    });
    expect(p).toEqual({ nativeLanguage: 'French' });
  });

  it('getLearnerContext GETs /learner/context', async () => {
    mockRequest.mockResolvedValue({ memory: [] });
    await languageProfileApi.getLearnerContext();
    expect(mockRequest).toHaveBeenCalledWith('/learner/context');
  });

  it('resetLearningData POSTs /user/reset', async () => {
    mockRequest.mockResolvedValue({ message: 'ok', onboardingRequired: true });
    await languageProfileApi.resetLearningData();
    expect(mockRequest).toHaveBeenCalledWith('/user/reset', { method: 'POST' });
  });

  it('isLearnerOnboarded is true only once a native language is set', () => {
    expect(isLearnerOnboarded(null)).toBe(false);
    expect(
      isLearnerOnboarded({
        ageBand: null,
        profession: null,
        industry: null,
        dailyContext: null,
        nativeLanguage: null,
        bilingualMode: false,
        motivations: [],
      }),
    ).toBe(false);
    expect(
      isLearnerOnboarded({
        ageBand: null,
        profession: null,
        industry: null,
        dailyContext: null,
        nativeLanguage: 'English',
        bilingualMode: false,
        motivations: [],
      }),
    ).toBe(true);
  });
});

// ── Tutor (teaching-chat) ────────────────────────────────────────────────────────
describe('languageTutorApi', () => {
  it('createSession defaults date to today (YYYY-MM-DD) and unwraps { session }', async () => {
    mockRequest.mockResolvedValue({ session: { id: 's1' } });
    const session = await languageTutorApi.createSession();
    const [path, opts] = mockRequest.mock.calls[0];
    expect(path).toBe('/teaching-chat/sessions');
    expect(opts.method).toBe('POST');
    expect(opts.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(opts.body.date).toBe(tutorTodayDate());
    expect(session).toEqual({ id: 's1' });
  });

  it('createSession forwards an explicit date + sessionId', async () => {
    mockRequest.mockResolvedValue({ session: { id: 's1' } });
    await languageTutorApi.createSession('2026-01-02', 'resume-1');
    expect(mockRequest).toHaveBeenCalledWith('/teaching-chat/sessions', {
      method: 'POST',
      body: { date: '2026-01-02', sessionId: 'resume-1' },
    });
  });

  it('sendMessage POSTs the turn payload', async () => {
    mockRequest.mockResolvedValue({ message: 'hi' });
    const input = { sessionId: 's1', text: 'hola', teacherId: 't1' };
    await languageTutorApi.sendMessage(input);
    expect(mockRequest).toHaveBeenCalledWith('/teaching-chat/messages', {
      method: 'POST',
      body: input,
    });
  });

  it('getMessages unwraps { messages } from the session path', async () => {
    mockRequest.mockResolvedValue({ messages: [{ id: 'm1' }] });
    const msgs = await languageTutorApi.getMessages('s1');
    expect(mockRequest).toHaveBeenCalledWith('/teaching-chat/sessions/s1/messages');
    expect(msgs).toEqual([{ id: 'm1' }]);
  });

  it('getHistory unwraps { sessions }', async () => {
    mockRequest.mockResolvedValue({ sessions: [{ id: 's1' }] });
    const hist = await languageTutorApi.getHistory();
    expect(mockRequest).toHaveBeenCalledWith('/teaching-chat/history');
    expect(hist).toEqual([{ id: 's1' }]);
  });

  it('tutorTodayDate returns a zero-padded ISO date', () => {
    expect(tutorTodayDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── Plan ───────────────────────────────────────────────────────────────────────
describe('languagePlanApi', () => {
  it('getCurrent returns the plan on success', async () => {
    mockRequest.mockResolvedValue({ id: 'p1', currentLevel: 'A2' });
    const plan = await languagePlanApi.getCurrent();
    expect(mockRequest).toHaveBeenCalledWith('/plan');
    expect(plan).toMatchObject({ id: 'p1' });
  });

  it('getCurrent returns null when the backend 404s', async () => {
    mockRequest.mockRejectedValue(new LanguageApiError(404, 'no plan', null));
    const plan = await languagePlanApi.getCurrent();
    expect(plan).toBeNull();
  });

  it('getCurrent rethrows non-404 errors', async () => {
    mockRequest.mockRejectedValue(new LanguageApiError(500, 'boom', null));
    await expect(languagePlanApi.getCurrent()).rejects.toMatchObject({ status: 500 });
  });

  it('getCurrent rethrows non-LanguageApiError failures', async () => {
    mockRequest.mockRejectedValue(new Error('network down'));
    await expect(languagePlanApi.getCurrent()).rejects.toThrow('network down');
  });

  it('getAll unwraps { plans }', async () => {
    mockRequest.mockResolvedValue({ plans: [{ id: 'p1' }] });
    const plans = await languagePlanApi.getAll();
    expect(mockRequest).toHaveBeenCalledWith('/plan/all');
    expect(plans).toEqual([{ id: 'p1' }]);
  });

  it('getById GETs /plan/:id', async () => {
    mockRequest.mockResolvedValue({ id: 'p1', progress: 0.5, progressHistory: [] });
    await languagePlanApi.getById('p1');
    expect(mockRequest).toHaveBeenCalledWith('/plan/p1');
  });

  it('generate POSTs the assessment profile + goals', async () => {
    mockRequest.mockResolvedValue({ currentLevel: 'A2' });
    const input = {
      assessmentProfile: {
        overallProficiency: 0.4,
        strengths: ['vocab'],
        weaknesses: ['grammar'],
        preferredDomains: ['reading'],
      },
      goals: ['travel'],
      dailyMinutes: 20,
    };
    await languagePlanApi.generate(input);
    expect(mockRequest).toHaveBeenCalledWith('/plan/generate', { method: 'POST', body: input });
  });

  it('logProgress POSTs to /plan/:id/progress', async () => {
    mockRequest.mockResolvedValue({ message: 'ok', date: '2026-01-01', actualMinutes: 20, targetMinutes: 20 });
    await languagePlanApi.logProgress('p1', { actualMinutes: 20, tasksCompleted: ['t1'] });
    expect(mockRequest).toHaveBeenCalledWith('/plan/p1/progress', {
      method: 'POST',
      body: { actualMinutes: 20, tasksCompleted: ['t1'] },
    });
  });

  it('update PUTs the patch to /plan', async () => {
    mockRequest.mockResolvedValue({ message: 'ok' });
    await languagePlanApi.update({ dailyMinutes: 30 });
    expect(mockRequest).toHaveBeenCalledWith('/plan', { method: 'PUT', body: { dailyMinutes: 30 } });
  });
});

// ── Progress ──────────────────────────────────────────────────────────────────
describe('languageProgressApi', () => {
  it('get GETs /progress', async () => {
    mockRequest.mockResolvedValue({ today: null, weekly: [] });
    await languageProgressApi.get();
    expect(mockRequest).toHaveBeenCalledWith('/progress');
  });

  it('track POSTs the session payload', async () => {
    mockRequest.mockResolvedValue({ sessionId: 's1', message: 'ok' });
    const input = { sessionType: 'review', durationSeconds: 120 };
    await languageProgressApi.track(input);
    expect(mockRequest).toHaveBeenCalledWith('/progress/track', { method: 'POST', body: input });
  });

  it('insights POSTs the metrics payload', async () => {
    mockRequest.mockResolvedValue({ summary: 's', recommendations: [] });
    const input = {
      metrics: {
        vocabularyRetention: 0.5,
        grammarAccuracy: 0.5,
        speakingFluency: 0.5,
        listeningComprehension: 0.5,
      },
      weeklyHistory: [],
      skillRows: [],
    };
    await languageProgressApi.insights(input);
    expect(mockRequest).toHaveBeenCalledWith('/progress/insights', { method: 'POST', body: input });
  });
});

// ── Reviews ───────────────────────────────────────────────────────────────────
describe('languageReviewsApi', () => {
  it('submit POSTs the rating payload', async () => {
    mockRequest.mockResolvedValue({ reviewId: 'r1' });
    const input = { cardId: 'c1', rating: 3 as const, responseTimeMs: 900 };
    await languageReviewsApi.submit(input);
    expect(mockRequest).toHaveBeenCalledWith('/reviews', { method: 'POST', body: input });
  });

  it('history with no params hits /reviews/history', async () => {
    mockRequest.mockResolvedValue({ reviews: [], pagination: {} });
    await languageReviewsApi.history();
    expect(mockRequest).toHaveBeenCalledWith('/reviews/history');
  });

  it('history builds a full query string', async () => {
    mockRequest.mockResolvedValue({ reviews: [], pagination: {} });
    await languageReviewsApi.history({
      page: 1,
      limit: 10,
      cardId: 'c1',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });
    const path = mockRequest.mock.calls[0][0] as string;
    const qs = new URLSearchParams(path.split('?')[1]);
    expect(qs.get('page')).toBe('1');
    expect(qs.get('limit')).toBe('10');
    expect(qs.get('cardId')).toBe('c1');
    expect(qs.get('startDate')).toBe('2026-01-01');
    expect(qs.get('endDate')).toBe('2026-01-31');
  });

  it('analytics defaults the period to 30 days', async () => {
    mockRequest.mockResolvedValue({});
    await languageReviewsApi.analytics();
    expect(mockRequest).toHaveBeenCalledWith('/reviews/analytics?period=30');
  });

  it('analytics forwards a custom period', async () => {
    mockRequest.mockResolvedValue({});
    await languageReviewsApi.analytics(7);
    expect(mockRequest).toHaveBeenCalledWith('/reviews/analytics?period=7');
  });
});

// ── Extras: dialogues / games / voice / practice / drive ─────────────────────────
describe('languageDialoguesApi', () => {
  it('generate POSTs scenario + level + domain', async () => {
    mockRequest.mockResolvedValue({ scenario: 'restaurant', exchanges: [] });
    await languageDialoguesApi.generate('restaurant', 2, 'food');
    expect(mockRequest).toHaveBeenCalledWith('/dialogues/generate', {
      method: 'POST',
      body: { scenario: 'restaurant', level: 2, domain: 'food' },
    });
  });
});

describe('languageGamesApi', () => {
  it('vocabulary POSTs /games/vocabulary', async () => {
    mockRequest.mockResolvedValue({ words: [], count: 0 });
    await languageGamesApi.vocabulary();
    expect(mockRequest).toHaveBeenCalledWith('/games/vocabulary', { method: 'POST' });
  });
});

describe('languageVoiceApi', () => {
  it('turn POSTs to /voice/stream', async () => {
    mockRequest.mockResolvedValue({ transcription: 'hola' });
    await languageVoiceApi.turn({ userInput: 'hola', teacherId: 't1' });
    expect(mockRequest).toHaveBeenCalledWith('/voice/stream', {
      method: 'POST',
      body: { userInput: 'hola', teacherId: 't1' },
    });
  });

  it('speakingHabits defaults days=30', async () => {
    mockRequest.mockResolvedValue({ series: [] });
    await languageVoiceApi.speakingHabits();
    expect(mockRequest).toHaveBeenCalledWith('/voice/speaking-habits?days=30');
  });

  it('speakingHabits forwards a custom day window', async () => {
    mockRequest.mockResolvedValue({ series: [] });
    await languageVoiceApi.speakingHabits(7);
    expect(mockRequest).toHaveBeenCalledWith('/voice/speaking-habits?days=7');
  });
});

describe('languagePracticeApi', () => {
  it('backlog defaults limit=20', async () => {
    mockRequest.mockResolvedValue({ due: [], dueCount: 0, scheduledCount: 0 });
    await languagePracticeApi.backlog();
    expect(mockRequest).toHaveBeenCalledWith('/practice/backlog?limit=20');
  });

  it('backlog forwards a custom limit', async () => {
    mockRequest.mockResolvedValue({ due: [], dueCount: 0, scheduledCount: 0 });
    await languagePracticeApi.backlog(5);
    expect(mockRequest).toHaveBeenCalledWith('/practice/backlog?limit=5');
  });

  it('mistakes with no status hits /practice/mistakes', async () => {
    mockRequest.mockResolvedValue({ mistakes: [], countsByStatus: {} });
    await languagePracticeApi.mistakes();
    expect(mockRequest).toHaveBeenCalledWith('/practice/mistakes');
  });

  it('mistakes forwards a status filter', async () => {
    mockRequest.mockResolvedValue({ mistakes: [], countsByStatus: {} });
    await languagePracticeApi.mistakes('active');
    expect(mockRequest).toHaveBeenCalledWith('/practice/mistakes?status=active');
  });

  it('stats GETs /practice/stats', async () => {
    mockRequest.mockResolvedValue({ dueCount: 0 });
    await languagePracticeApi.stats();
    expect(mockRequest).toHaveBeenCalledWith('/practice/stats');
  });

  it('dismiss POSTs /practice/mistakes/:id/dismiss', async () => {
    mockRequest.mockResolvedValue({ success: true });
    await languagePracticeApi.dismiss('m1');
    expect(mockRequest).toHaveBeenCalledWith('/practice/mistakes/m1/dismiss', { method: 'POST' });
  });
});

describe('languageDriveApi', () => {
  it('status GETs /drive/status', async () => {
    mockRequest.mockResolvedValue({ connected: false });
    await languageDriveApi.status();
    expect(mockRequest).toHaveBeenCalledWith('/drive/status');
  });

  it('connect POSTs the serverAuthCode', async () => {
    mockRequest.mockResolvedValue({ connected: true, email: 'a@b.co', scopes: [] });
    await languageDriveApi.connect('code-123');
    expect(mockRequest).toHaveBeenCalledWith('/drive/connect', {
      method: 'POST',
      body: { serverAuthCode: 'code-123' },
    });
  });

  it('disconnect DELETEs /drive/disconnect', async () => {
    mockRequest.mockResolvedValue({ connected: false });
    await languageDriveApi.disconnect();
    expect(mockRequest).toHaveBeenCalledWith('/drive/disconnect', { method: 'DELETE' });
  });

  it('listFiles with no query hits /drive/files', async () => {
    mockRequest.mockResolvedValue({ files: [] });
    await languageDriveApi.listFiles();
    expect(mockRequest).toHaveBeenCalledWith('/drive/files');
  });

  it('listFiles URL-encodes the q parameter', async () => {
    mockRequest.mockResolvedValue({ files: [] });
    await languageDriveApi.listFiles('name = "my notes"');
    expect(mockRequest).toHaveBeenCalledWith(
      `/drive/files?q=${encodeURIComponent('name = "my notes"')}`,
    );
  });
});
