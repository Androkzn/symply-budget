import { router } from 'expo-router';

import { useKaizenStore } from '../../stores/kaizenStore';
import { openCoachToolRoute, resolveCoachToolResults, type CoachToolResult } from '../coachToolResolver';
import { handleKaizenDeepLink } from '../deepLinks';

jest.mock('../deepLinks', () => ({ handleKaizenDeepLink: jest.fn() }));
jest.mock('../../stores/kaizenStore', () => ({ useKaizenStore: { getState: jest.fn() } }));

const getState = useKaizenStore.getState as jest.Mock;
const mockPush = router.push as jest.Mock;
const mockDeepLink = handleKaizenDeepLink as jest.Mock;

let state: {
  questions: unknown[];
  attempts: unknown[];
  skills: unknown[];
  completeDailyAction: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
  state = {
    questions: [
      {
        id: 'q1',
        prompt: 'Explain the event loop in detail for the interviewer',
        question_bank: 'technical',
        import_review_status: 'approved',
        due_at: '2000-01-01T00:00:00.000Z',
        linked_skill_id: 's1',
      },
    ],
    attempts: [
      { question_id: 'q1', attempted_at: new Date().toISOString(), overall_score: 80, criterion_scores: null, lesson_learned: 'be concise' },
    ],
    skills: [{ id: 's1', name: 'React', mastery_0_to_100: 40 }],
    completeDailyAction: jest.fn().mockResolvedValue(undefined),
  };
  getState.mockImplementation(() => state);
});

describe('resolveCoachToolResults', () => {
  it('returns an empty array for no tool results', async () => {
    expect(await resolveCoachToolResults(undefined)).toEqual([]);
    expect(await resolveCoachToolResults([])).toEqual([]);
  });

  it('resolves a progress snapshot into a summary + data', async () => {
    const [result] = await resolveCoachToolResults([
      { tool: 'get_progress_snapshot', clientMustResolve: true, data: { period: 'week' } },
    ]);
    expect(result.clientMustResolve).toBe(false);
    expect(result.result).toMatch(/reps/);
    expect(result.data?.snapshot).toBeDefined();
  });

  it.each(['today', 'month', 'quarter', undefined])(
    'resolves a progress snapshot for period=%s',
    async period => {
      const [result] = await resolveCoachToolResults([
        { tool: 'get_progress_snapshot', data: period === undefined ? {} : { period } },
      ]);
      expect(result.clientMustResolve).toBe(false);
      expect(result.data?.snapshot).toBeDefined();
    },
  );

  it('handles the explain_progress alias and a missing average score', async () => {
    state.attempts = []; // no scored attempts → averageScore null → summary uses "—"
    const [result] = await resolveCoachToolResults([{ tool: 'explain_progress', data: { period: 'week' } }]);
    expect(result.result).toContain('—');
  });

  it('recommends the earliest due approved question', async () => {
    const [result] = await resolveCoachToolResults([{ tool: 'recommend_next_rep', data: {} }]);
    expect(result.opened_route).toBe('/kaizen/practice?questionId=q1');
    expect(result.data?.questionId).toBe('q1');
    expect(result.data?.dueCount).toBe(1);
  });

  it('falls back to banks when no rep is due', async () => {
    state.questions = [];
    const [result] = await resolveCoachToolResults([{ tool: 'recommend_next_rep', data: {} }]);
    expect(result.opened_route).toBe('/kaizen/banks');
    expect(result.data?.questionId).toBeNull();
  });

  it('sorts multiple due reps by due date and honours a kind filter', async () => {
    state.questions = [
      {
        id: 'q1',
        prompt: 'Technical prompt',
        question_bank: 'technical',
        import_review_status: 'approved',
        due_at: '2001-01-01T00:00:00.000Z',
      },
      {
        id: 'q2',
        prompt: 'Behavioral prompt',
        question_bank: 'behavioral',
        import_review_status: 'approved',
        due_at: '2000-01-01T00:00:00.000Z',
      },
    ];

    // No kind → both are eligible; earliest due (q2) wins after the sort.
    const [any] = await resolveCoachToolResults([{ tool: 'recommend_next_rep', data: {} }]);
    expect(any.opened_route).toBe('/kaizen/practice?questionId=q2');
    expect(any.data?.dueCount).toBe(2);

    // kind=technical → filters down to q1.
    const [technical] = await resolveCoachToolResults([
      { tool: 'recommend_next_rep', data: { kind: 'technical' } },
    ]);
    expect(technical.opened_route).toBe('/kaizen/practice?questionId=q1');
    expect(technical.data?.dueCount).toBe(1);
  });

  it('opens skill assessment using the provided or first skill id', async () => {
    const [withId] = await resolveCoachToolResults([{ tool: 'start_assessment', data: { skillId: 'sX' } }]);
    expect(withId.opened_route).toBe('/kaizen/skill-assessment?skillId=sX');

    const [withDefault] = await resolveCoachToolResults([{ tool: 'start_assessment', data: {} }]);
    expect(withDefault.opened_route).toBe('/kaizen/skill-assessment?skillId=s1');
  });

  it('falls back to the assessment hub when no skill id is available', async () => {
    state.skills = [];
    const [result] = await resolveCoachToolResults([{ tool: 'start_assessment', data: {} }]);
    expect(result.opened_route).toBe('/kaizen-assess');
    expect(result.result).toBe('Open skill assessment');
  });

  it('routes import_questions and start_practice_session', async () => {
    const [imp] = await resolveCoachToolResults([{ tool: 'import_questions' }]);
    expect(imp.opened_route).toBe('/kaizen/question-import');

    const [practice] = await resolveCoachToolResults([{ tool: 'start_practice_session', data: {} }]);
    expect(practice.opened_route).toBe('/kaizen/practice?questionId=q1');
  });

  it('opens generic practice when start_practice_session has no due card', async () => {
    state.questions = [];
    const [result] = await resolveCoachToolResults([{ tool: 'start_practice_session', data: {} }]);
    expect(result.opened_route).toBe('/kaizen/practice');
    expect(result.result).toBe('Open practice');
    expect(result.data?.estimatedCount).toBe(0);
  });

  it('logs a daily action through the store', async () => {
    const [result] = await resolveCoachToolResults([{ tool: 'log_kaizen_action', data: { actionId: 'act-9' } }]);
    expect(state.completeDailyAction).toHaveBeenCalledWith('act-9');
    expect(result.opened_route).toBe('/');
    expect(result.data?.accepted).toBe(true);
  });

  it('reports missing actionId for log_kaizen_action', async () => {
    const [result] = await resolveCoachToolResults([{ tool: 'log_kaizen_action', data: {} }]);
    expect(state.completeDailyAction).not.toHaveBeenCalled();
    expect(result.result).toBe('Missing actionId');
    expect(result.data?.accepted).toBe(false);
  });

  it('open_route pushes internal routes and dispatches kaizen deep links', async () => {
    const [internal] = await resolveCoachToolResults([{ tool: 'open_route', data: { route: '/kaizen/settings' } }]);
    expect(mockPush).toHaveBeenCalledWith('/kaizen/settings');
    expect(internal.opened_route).toBe('/kaizen/settings');

    const [deep] = await resolveCoachToolResults([{ tool: 'open_route', data: { route: 'kaizen://coach' } }]);
    expect(mockDeepLink).toHaveBeenCalledWith('kaizen://coach');
    expect(deep.opened_route).toBeUndefined();
  });

  it('open_route with a missing/invalid route neither navigates nor opens', async () => {
    const [result] = await resolveCoachToolResults([{ tool: 'open_route', data: {} }]);
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockDeepLink).not.toHaveBeenCalled();
    expect(result.opened_route).toBeUndefined();
    expect(result.result).toBe('Opened route');
  });

  it('resolves unknown client-must-resolve tools that carry a route', async () => {
    const [internal] = await resolveCoachToolResults([{ tool: 'mystery', data: { route: '/kaizen/reviews' } }]);
    expect(internal.clientMustResolve).toBe(false);
    expect(internal.opened_route).toBe('/kaizen/reviews');

    const [deep] = await resolveCoachToolResults([{ tool: 'mystery', data: { route: 'kaizen://coach' } }]);
    expect(mockDeepLink).toHaveBeenCalledWith('kaizen://coach');
    expect(deep.opened_route).toBeUndefined();
  });

  it('passes through unknown tools that require no client resolution', async () => {
    const input: CoachToolResult = { tool: 'server_only', clientMustResolve: false };
    const [result] = await resolveCoachToolResults([input]);
    expect(result).toEqual(input);
  });

  it('passes through unknown client-must-resolve tools without a route', async () => {
    const input: CoachToolResult = { tool: 'server_only_2', data: {} };
    const [result] = await resolveCoachToolResults([input]);
    expect(result).toEqual(input);
  });
});

describe('openCoachToolRoute', () => {
  it('pushes an internal route', () => {
    openCoachToolRoute({ tool: 't', opened_route: '/kaizen/banks' });
    expect(mockPush).toHaveBeenCalledWith('/kaizen/banks');
  });

  it('dispatches a kaizen deep link', () => {
    openCoachToolRoute({ tool: 't', opened_route: 'kaizen://today' });
    expect(mockDeepLink).toHaveBeenCalledWith('kaizen://today');
  });

  it('does nothing without a route', () => {
    openCoachToolRoute({ tool: 't' });
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockDeepLink).not.toHaveBeenCalled();
  });
});
