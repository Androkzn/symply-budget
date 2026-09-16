/**
 * CareerProgressScreen — Symply Kaizen (`symply-kaizen`) career practice signal.
 *
 * Renders the REAL screen through <ThemeProvider> on iPhone- and iPad-class
 * windows off a mocked Kaizen store, asserts the practice metrics + the
 * "Next recommended" list (or its empty state), and covers the empty-store path.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { IPAD, IPHONE, allText } from '../../test-utils/kaizenScreenTestKit';
import { CareerProgressScreen } from '../CareerProgressScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

jest.mock('@components/common', () =>
  require('../../test-utils/mockComponentsCommon').createKaizenComponentsCommonMock(),
);

const storeState: Record<string, unknown> = { questions: [], attempts: [], skills: [] };
const rqState = {
  questions: [] as unknown[],
  attempts: [] as unknown[],
  skills: [] as unknown[],
};

jest.mock('@features/kaizen/hooks/useKaizenSkills', () => ({
  __esModule: true,
  useKaizenSkills: () => ({ data: rqState.skills }),
}));

jest.mock('@features/kaizen/hooks/useKaizenInterviewQuestions', () => ({
  __esModule: true,
  useKaizenInterviewQuestions: () => ({ data: rqState.questions }),
}));

jest.mock('@features/kaizen/hooks/useKaizenAttempts', () => ({
  __esModule: true,
  useKaizenAttempts: () => ({ data: rqState.attempts }),
}));

jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const useKaizenStore = (selector?: (s: typeof storeState) => unknown) =>
    selector ? selector(storeState) : storeState;
  useKaizenStore.getState = () => storeState;
  useKaizenStore.setState = (partial: Partial<typeof storeState>) =>
    Object.assign(storeState, partial);
  return { __esModule: true, useKaizenStore };
});

function setState(next: Record<string, unknown>) {
  Object.keys(storeState).forEach((k) => delete storeState[k]);
  Object.assign(storeState, next);
  rqState.questions = (next.questions as unknown[]) ?? [];
  rqState.attempts = (next.attempts as unknown[]) ?? [];
  rqState.skills = (next.skills as unknown[]) ?? [];
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <CareerProgressScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  setState({ questions: [], attempts: [], skills: [] });
});

describe('CareerProgressScreen', () => {
  it('renders the title and practice metrics with an empty store', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Career progress');
    expect(text).toContain('Reps completed');
    expect(text).toContain('Average score');
    expect(text).toContain('No due questions right now.');
  });

  it('lists due questions in the "Next recommended" section', async () => {
    const soon = new Date(Date.now() - 1000).toISOString();
    setState({
      skills: [],
      attempts: [],
      questions: [
        {
          id: 'q1',
          prompt: 'Explain closures',
          due_at: soon,
          skill_id: null,
          import_review_status: 'approved',
          deleted_at: null,
        },
      ],
    });
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Explain closures');
  });

  it('mounts on iPad-class dimensions', async () => {
    mockWindow = IPAD;
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Career progress');
  });

  it('renders practice metrics from attempts in the store', async () => {
    const recent = new Date().toISOString();
    setState({
      skills: [],
      attempts: [
        { question_id: 'q9', attempted_at: recent, overall_score: 4 },
        { question_id: 'q8', attempted_at: recent, overall_score: 2 },
      ],
      questions: [],
    });
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('2'); // repsCompleted
    expect(text).toContain('3'); // averageScore 3.0 → "3"
  });

  it('lists multiple due questions in "Next recommended"', async () => {
    const soon = new Date(Date.now() - 1000).toISOString();
    setState({
      skills: [],
      attempts: [],
      questions: [
        {
          id: 'q1',
          prompt: 'Explain closures',
          due_at: soon,
          skill_id: null,
          import_review_status: 'approved',
          deleted_at: null,
        },
        {
          id: 'q2',
          prompt: 'Describe CAP theorem',
          due_at: soon,
          skill_id: null,
          import_review_status: 'approved',
          deleted_at: null,
        },
      ],
    });
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Explain closures');
    expect(text).toContain('Describe CAP theorem');
  });
});
