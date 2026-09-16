/**
 * InsightsScreen — Symply Kaizen (`symply-kaizen`) momentum read-out.
 *
 * Renders the REAL screen through <ThemeProvider> off a mocked store. This screen
 * is read-only (no pressables), so coverage asserts the three panels plus the
 * derived stats (average mastery, skill bars, achievement lines) across an empty
 * and a populated store — the derivation is the meaningful behavior.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { IPAD, IPHONE, allText } from '../../test-utils/kaizenScreenTestKit';
import { InsightsScreen } from '../InsightsScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

jest.mock('@components/common', () =>
  require('../../test-utils/mockComponentsCommon').createKaizenComponentsCommonMock(),
);

const mockState: Record<string, unknown> = {};
const rqState = {
  skills: [] as unknown[],
  questions: [] as unknown[],
  gtd: [] as unknown[],
  attempts: [] as unknown[],
};

jest.mock('@features/kaizen/hooks/useKaizenSkills', () => ({
  __esModule: true,
  useKaizenSkills: () => ({ data: rqState.skills }),
}));

jest.mock('@features/kaizen/hooks/useKaizenInterviewQuestions', () => ({
  __esModule: true,
  useKaizenInterviewQuestions: () => ({ data: rqState.questions }),
}));

jest.mock('@features/kaizen/hooks/useKaizenGtd', () => ({
  __esModule: true,
  useKaizenGtd: () => ({ data: rqState.gtd }),
}));

jest.mock('@features/kaizen/hooks/useKaizenAttempts', () => ({
  __esModule: true,
  useKaizenAttempts: () => ({ data: rqState.attempts }),
}));

jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const useKaizenStore = (selector?: (s: typeof mockState) => unknown) =>
    selector ? selector(mockState) : mockState;
  useKaizenStore.getState = () => mockState;
  return { __esModule: true, useKaizenStore };
});

function seed(over: Record<string, unknown> = {}) {
  Object.keys(mockState).forEach((k) => delete mockState[k]);
  Object.assign(mockState, {
    todayLogs: [],
    ...over,
  });
  rqState.skills = (over.skills as unknown[]) ?? [];
  rqState.questions = (over.questions as unknown[]) ?? [];
  rqState.gtd = (over.gtd as unknown[]) ?? [];
  rqState.attempts = (over.attempts as unknown[]) ?? [];
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <InsightsScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  seed();
});

describe('InsightsScreen', () => {
  it('renders the three panels with a zeroed empty store', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Insights');
    expect(text).toContain('Mastery');
    expect(text).toContain('Skills');
    expect(text).toContain('Achievements');
    expect(text).toContain('Average mastery');
    expect(text).toContain('0%');
  });

  it('derives average mastery, skill bars and achievements from the store', async () => {
    seed({
      skills: [
        { id: 's1', name: 'System design', mastery_0_to_100: 80, is_priority: true },
        { id: 's2', name: 'Algorithms', mastery_0_to_100: 40, is_priority: false },
      ],
      attempts: [{ id: 'a1' }],
    });
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('System design');
    expect(text).toContain('Algorithms');
    // Average of 80 and 40 = 60%.
    expect(text).toContain('60%');
    expect(text).toContain('✓ First practice completed');
  });

  it('counts due questions, completed logs, GTD inbox and the five-rep milestone', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    seed({
      skills: [
        // Null-mastery skill: excluded from the average, defaults to 0 in the bar / achievement.
        { id: 's0', name: 'Unassessed', mastery_0_to_100: null, is_priority: false },
        { id: 's1', name: 'System design', mastery_0_to_100: 80, is_priority: true },
        { id: 's2', name: 'Algorithms', mastery_0_to_100: 40, is_priority: false },
      ],
      questions: [
        { id: 'q1', due_at: past }, // due now → counted
        { id: 'q2', due_at: future }, // not due yet
        { id: 'q3', due_at: null }, // no due date → short-circuits
      ],
      todayLogs: [
        { id: 'l1', skipped: false, action_id: 'a1' }, // counted
        { id: 'l2', skipped: true, action_id: 'a2' }, // skipped
        { id: 'l3', skipped: false, action_id: '__wake_confirm__' }, // wake confirm excluded
      ],
      gtd: [
        { id: 'g1', status: 'inbox' }, // counted
        { id: 'g2', status: 'done' }, // not inbox
      ],
      attempts: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }, { id: 'a4' }, { id: 'a5' }],
    });
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Unassessed');
    // Average of 80 and 40 (the null skill is excluded) = 60%.
    expect(text).toContain('60%');
    // Five attempts crosses both achievement thresholds.
    expect(text).toContain('✓ First practice completed');
    expect(text).toContain('✓ Five practice reps');
    expect(text).toContain('✓ Skill mastery above 50%');
  });

  it('mounts on iPad-class dimensions', async () => {
    mockWindow = IPAD;
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Insights');
  });
});
