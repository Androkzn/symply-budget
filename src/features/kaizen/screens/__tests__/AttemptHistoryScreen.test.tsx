/**
 * AttemptHistoryScreen — Symply Kaizen (`symply-kaizen`) per-question attempt log.
 *
 * Renders the REAL screen through <ThemeProvider> off a mocked store keyed by the
 * `questionId` search param. This screen is read-only (no pressables), so coverage
 * asserts both the populated attempt list and the empty state — the data path is
 * the meaningful behavior here.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { IPAD, IPHONE, allText } from '../../test-utils/kaizenScreenTestKit';
import { AttemptHistoryScreen } from '../AttemptHistoryScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

jest.mock('@components/common', () =>
  require('../../test-utils/mockComponentsCommon').createKaizenComponentsCommonMock(),
);

jest.mock('expo-router', () => ({
  __esModule: true,
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() },
  useLocalSearchParams: () => ({ questionId: 'q1' }),
  Redirect: () => null,
  Link: ({ children }: { children?: React.ReactNode }) => children,
}));

const mockState: Record<string, unknown> = {};
const mockAttemptsState: { attempts: unknown[] } = { attempts: [] };
const mockQuestionsState: { questions: unknown[] } = { questions: [] };

jest.mock('@features/kaizen/hooks/useKaizenAttempts', () => ({
  __esModule: true,
  useKaizenAttemptsForQuestion: () => ({ attempts: mockAttemptsState.attempts }),
  useKaizenAttempts: () => ({ data: mockAttemptsState.attempts }),
  useInvalidateKaizenAttempts: () => jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@features/kaizen/hooks/useKaizenInterviewQuestions', () => ({
  __esModule: true,
  useKaizenInterviewQuestions: () => ({ data: mockQuestionsState.questions }),
  useInvalidateKaizenInterviewQuestions: () => jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const useKaizenStore = (selector?: (s: typeof mockState) => unknown) =>
    selector ? selector(mockState) : mockState;
  useKaizenStore.getState = () => mockState;
  return { __esModule: true, useKaizenStore };
});

function seed(attempts: unknown[]) {
  Object.keys(mockState).forEach((k) => delete mockState[k]);
  mockQuestionsState.questions = [{ id: 'q1', prompt: 'Explain the event loop' }];
  mockAttemptsState.attempts = attempts;
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <AttemptHistoryScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  seed([]);
});

describe('AttemptHistoryScreen', () => {
  it('renders the question prompt and the empty state', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Attempt history');
    expect(text).toContain('Explain the event loop');
    expect(text).toContain('No attempts yet.');
  });

  it('renders past attempts with their answer, score and reasoning', async () => {
    seed([
      {
        id: 'a1',
        attempted_at: '2026-07-01T10:00:00.000Z',
        overall_score: 4,
        answer_text: 'The event loop processes the callback queue.',
        judge_reasoning: 'Solid grasp of the microtask queue.',
      },
    ]);
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('The event loop processes the callback queue.');
    expect(text).toContain('Solid grasp of the microtask queue.');
    expect(text).toContain('4/5');
  });

  it('divides multiple attempts and shows an em-dash for a missing score', async () => {
    seed([
      { id: 'a1', attempted_at: '2026-07-01T10:00:00.000Z', overall_score: 4, answer_text: 'First answer', judge_reasoning: 'ok' },
      { id: 'a2', attempted_at: '2026-07-02T10:00:00.000Z', overall_score: null, answer_text: 'Second answer', judge_reasoning: 'meh' },
    ]);
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('First answer'); // index 0 — no top border
    expect(text).toContain('Second answer'); // index 1 — divider branch
    expect(text).toContain('—/5'); // overall_score ?? '—'
  });

  it('renders an empty subtitle when the question is unknown', async () => {
    mockQuestionsState.questions = [];
    mockAttemptsState.attempts = [];
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Attempt history');
  });

  it('renders attempts without judge reasoning when it is missing', async () => {
    seed([
      {
        id: 'a1',
        attempted_at: '2026-07-01T10:00:00.000Z',
        overall_score: 3,
        answer_text: 'Answer without reasoning',
        judge_reasoning: null,
      },
    ]);
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Answer without reasoning');
    expect(allText(tree.toJSON())).toContain('3/5');
  });

  it('mounts on iPad-class dimensions', async () => {
    mockWindow = IPAD;
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Attempt history');
  });
});
