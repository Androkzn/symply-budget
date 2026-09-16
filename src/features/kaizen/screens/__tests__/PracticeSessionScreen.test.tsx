/**
 * PracticeSessionScreen — Symply Kaizen (`symply-kaizen`) interview practice.
 *
 * Renders the REAL screen through <ThemeProvider> for a question resolved from the
 * `questionId` route param, and drives answer entry → "Submit response" →
 * submitInterviewAttempt.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { router } from 'expo-router';
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  IPHONE,
  allText,
  drainMockRejection,
  flushMicrotasks,
  mockHandledRejection,
  pressByText,
  typeIn,
} from '../../test-utils/kaizenScreenTestKit';
import { PracticeSessionScreen } from '../PracticeSessionScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

jest.mock('expo-router', () => ({
  __esModule: true,
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() },
  useLocalSearchParams: () => ({ questionId: 'q1' }),
  Redirect: () => null,
  Link: ({ children }: { children?: React.ReactNode }) => children,
}));

jest.mock('@components/common', () =>
  require('../../test-utils/mockComponentsCommon').createKaizenComponentsCommonMock(),
);

const mockQuestionsState = {
  questions: [
    {
      id: 'q1',
      prompt: 'Design a URL shortener',
      question_bank: 'technical',
      due_at: null as string | null,
      ideal_answer: null,
      deleted_at: null,
    },
  ],
};

jest.mock('@features/kaizen/hooks/useKaizenInterviewQuestions', () => ({
  __esModule: true,
  useKaizenInterviewQuestions: () => ({ data: mockQuestionsState.questions }),
  useInvalidateKaizenInterviewQuestions: () => jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@stores/authStore', () => ({
  useAuthStore: (selector?: (s: { user: { id: string } | null }) => unknown) =>
    selector ? selector({ user: { id: 'u1' } }) : { user: { id: 'u1' } },
}));

jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const state = {
    submitInterviewAttempt: jest.fn().mockResolvedValue(undefined),
  };
  const useKaizenStore = (sel?: (value: typeof state) => unknown) => (sel ? sel(state) : state);
  useKaizenStore.getState = () => state;
  useKaizenStore.setState = (p: Partial<typeof state> | ((value: typeof state) => Partial<typeof state>)) => Object.assign(state, typeof p === 'function' ? p(state) : p);
  return { __esModule: true, useKaizenStore, __state: state };
});

 
const { __state: state } = require('@features/kaizen/stores/kaizenStore');

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <PracticeSessionScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  state.questions = [
    { id: 'q1', prompt: 'Design a URL shortener', question_bank: 'technical', due_at: null as string | null, ideal_answer: null },
  ];
  state.submitInterviewAttempt.mockResolvedValue(undefined);
});

describe('PracticeSessionScreen', () => {
  it('renders the resolved question prompt and session progress', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Practice');
    expect(text).toContain('SESSION PROGRESS');
    expect(text).toContain('Design a URL shortener');
  });

  it('submits the answer with the default self-score', async () => {
    const tree = await renderScreen();
    act(() => typeIn(tree, 'Use a base62 hash keyed store'));
    await act(async () => {
      pressByText(tree, 'Submit response');
    });
    expect(state.submitInterviewAttempt).toHaveBeenCalledWith(
      'q1',
      'Use a base62 hash keyed store',
      3,
      { useAI: false },
    );
  });

  it('submits with a chosen self-score and AI scoring enabled', async () => {
    const tree = await renderScreen();
    act(() => typeIn(tree, 'base62 + KV store'));
    act(() => pressByText(tree, '5'));
    act(() => pressByText(tree, 'Score with AI'));
    await act(async () => {
      pressByText(tree, 'Submit response');
    });
    expect(state.submitInterviewAttempt).toHaveBeenCalledWith('q1', 'base62 + KV store', 5, {
      useAI: true,
    });
  });

  it('toggles AI scoring off again', async () => {
    const tree = await renderScreen();
    act(() => typeIn(tree, 'answer'));
    act(() => pressByText(tree, 'Score with AI'));
    act(() => pressByText(tree, 'Score with AI'));
    await act(async () => {
      pressByText(tree, 'Submit response');
    });
    expect(state.submitInterviewAttempt).toHaveBeenCalledWith('q1', 'answer', 3, { useAI: false });
  });

  it('ignores an empty submission', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Submit response');
    });
    expect(state.submitInterviewAttempt).not.toHaveBeenCalled();
  });

  it('submits with each self-score option', async () => {
    for (const score of [1, 2, 4] as const) {
      jest.clearAllMocks();
      state.submitInterviewAttempt.mockResolvedValue(undefined);
      const tree = await renderScreen();
      act(() => typeIn(tree, `answer for score ${score}`));
      act(() => pressByText(tree, String(score)));
      await act(async () => {
        pressByText(tree, 'Submit response');
      });
      expect(state.submitInterviewAttempt).toHaveBeenCalledWith(
        'q1',
        `answer for score ${score}`,
        score,
        { useAI: false },
      );
    }
  });

  it('stays on the composer when submitInterviewAttempt rejects', async () => {
    mockHandledRejection(state.submitInterviewAttempt);
    const tree = await renderScreen();
    act(() => typeIn(tree, 'My answer'));
    await act(async () => {
      pressByText(tree, 'Submit response');
      await flushMicrotasks();
      await drainMockRejection(state.submitInterviewAttempt);
    });
    expect(state.submitInterviewAttempt).toHaveBeenCalled();
    expect(allText(tree.toJSON())).toContain('Self-score');
    expect(allText(tree.toJSON())).not.toContain('Your response was saved');
  });

  it('shows the saved confirmation and navigates to attempt history', async () => {
    const tree = await renderScreen();
    act(() => typeIn(tree, 'My answer'));
    await act(async () => {
      pressByText(tree, 'Submit response');
    });
    const text = allText(tree.toJSON());
    expect(text).toContain('Your response was saved with a 3/5 self-score.');
    expect(text).toContain('calculating');
    act(() => pressByText(tree, 'View attempt history'));
    expect(router.push).toHaveBeenCalledWith('/kaizen/attempt-history?questionId=q1');
  });

  it('resets to a fresh session from the saved state', async () => {
    const tree = await renderScreen();
    act(() => typeIn(tree, 'My answer'));
    await act(async () => {
      pressByText(tree, 'Submit response');
    });
    act(() => pressByText(tree, 'Practice next due question'));
    expect(router.replace).toHaveBeenCalledWith('/kaizen/banks');
    // The answer field is cleared and the composer is back.
    expect(allText(tree.toJSON())).toContain('Self-score');
  });

  it('renders the scheduled next-review timestamp when the question has a due date', async () => {
    mockQuestionsState.questions = [
      {
        id: 'q1',
        prompt: 'Design a rate limiter',
        question_bank: 'technical',
        due_at: '2026-08-01T10:00:00.000Z',
        ideal_answer: null,
        deleted_at: null,
      },
    ];
    const tree = await renderScreen();
    act(() => typeIn(tree, 'token bucket'));
    await act(async () => {
      pressByText(tree, 'Submit response');
    });
    const text = allText(tree.toJSON());
    expect(text).toContain('Next review:');
    expect(text).not.toContain('calculating');
  });

  it('resolves the next due question when the route id is not present', async () => {
    mockQuestionsState.questions = [
      {
        id: 'q2',
        prompt: 'Due question prompt',
        question_bank: 'behavioral',
        due_at: '2020-01-01T00:00:00.000Z',
        ideal_answer: null,
        deleted_at: null,
      },
    ];
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Due question prompt');
  });

  it('falls back to the first question when nothing matches or is due', async () => {
    mockQuestionsState.questions = [
      {
        id: 'q3',
        prompt: 'First fallback prompt',
        question_bank: 'technical',
        due_at: null as string | null,
        ideal_answer: null,
        deleted_at: null,
      },
    ];
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('First fallback prompt');
  });

  it('renders the empty state when there are no questions', async () => {
    mockQuestionsState.questions = [];
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('No interview questions are available.');
    expect(text).not.toContain('SESSION PROGRESS');
  });
});
