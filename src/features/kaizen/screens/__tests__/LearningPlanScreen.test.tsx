/**
 * LearningPlanScreen — Symply Kaizen (`symply-kaizen`) per-skill learning plan.
 *
 * Renders the REAL screen through <ThemeProvider> off a mocked store + a mocked
 * learningPlan service (async plan builder + task-completion helpers), asserts the
 * concept/practice/review tasks render, toggles a task (→ toggleLearningTaskComplete)
 * and drives the "Back to skill" router.back.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { IPAD, IPHONE, allText, flushMicrotasks, mockHandledRejection, pressByText } from '../../test-utils/kaizenScreenTestKit';
import { LearningPlanScreen } from '../LearningPlanScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

jest.mock('@components/common', () =>
  require('../../test-utils/mockComponentsCommon').createKaizenComponentsCommonMock(),
);

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  __esModule: true,
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: (...args: unknown[]) => mockBack(...args),
    navigate: jest.fn(),
  },
  useLocalSearchParams: () => ({ skillId: 's1' }),
  Redirect: () => null,
  Link: ({ children }: { children?: React.ReactNode }) => children,
}));

const mockToggle = jest.fn();
const mockIsComplete = jest.fn().mockReturnValue(false);
const mockBuildPlan = jest.fn().mockResolvedValue({
  concept_sequence: ['Big-O basics'],
  practice_queue: ['Solve two-pointer drill'],
  review_focus: ['Revisit hash maps'],
});
jest.mock('@features/kaizen/services/learningPlan', () => ({
  __esModule: true,
  buildSkillLearningPlan: (...args: unknown[]) => mockBuildPlan(...args),
  isLearningTaskComplete: (...args: unknown[]) => mockIsComplete(...args),
  toggleLearningTaskComplete: (...args: unknown[]) => mockToggle(...args),
}));

const mockSkillsState = {
  skills: [{ id: 's1', name: 'Algorithms', mastery_0_to_100: 40 as number | null, concept_band: 'foundation' as string | null }],
};

jest.mock('@features/kaizen/hooks/useKaizenSkills', () => ({
  __esModule: true,
  useKaizenSkills: () => ({ data: mockSkillsState.skills }),
}));

const mockState: Record<string, unknown> = {};
jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const useKaizenStore = (selector?: (s: typeof mockState) => unknown) =>
    selector ? selector(mockState) : mockState;
  useKaizenStore.getState = () => mockState;
  return { __esModule: true, useKaizenStore };
});

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <LearningPlanScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  mockIsComplete.mockReturnValue(false);
  Object.keys(mockState).forEach((k) => delete mockState[k]);
  mockSkillsState.skills = [
    { id: 's1', name: 'Algorithms', mastery_0_to_100: 40 as number | null, concept_band: 'foundation' as string | null },
  ];
});

describe('LearningPlanScreen', () => {
  it('renders the plan sections and tasks', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Learning plan');
    expect(text).toContain('Algorithms');
    expect(text).toContain('Big-O basics');
    expect(text).toContain('Solve two-pointer drill');
    expect(text).toContain('Revisit hash maps');
  });

  it('toggles a task completion when pressed', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Big-O basics'));
    expect(mockToggle).toHaveBeenCalledWith('s1', 'concept', 'Big-O basics');
  });

  it('navigates back from "Back to skill"', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Back to skill'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('renders empty sections and a blank subtitle when the skill is missing', async () => {
    mockSkillsState.skills = [];
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Learning plan');
    expect(text).toContain('Concepts');
    // No skill → the plan builder never runs, so no tasks appear.
    expect(text).not.toContain('Big-O basics');
  });

  it('renders the completed icon for a task marked done', async () => {
    mockIsComplete.mockReturnValue(true);
    const tree = await renderScreen();
    // Done tasks still render their label (in the secondary color branch).
    expect(allText(tree.toJSON())).toContain('Big-O basics');
  });

  it('builds a plan for a skill with no mastery score or concept band', async () => {
    mockSkillsState.skills = [
      { id: 's1', name: 'Algorithms', mastery_0_to_100: null, concept_band: null },
    ];
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Algorithms');
    expect(text).toContain('Big-O basics');
  });

  it('mounts on iPad-class dimensions', async () => {
    mockWindow = IPAD;
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Learning plan');
  });

  it('toggles practice and review tasks when pressed', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Solve two-pointer drill'));
    expect(mockToggle).toHaveBeenCalledWith('s1', 'practice', 'Solve two-pointer drill');
    act(() => pressByText(tree, 'Revisit hash maps'));
    expect(mockToggle).toHaveBeenCalledWith('s1', 'review', 'Revisit hash maps');
  });

  it('mounts when the plan builder rejects', async () => {
    mockHandledRejection(mockBuildPlan);
    const tree = await renderScreen();
    await act(async () => {
      await flushMicrotasks();
    });
    const text = allText(tree.toJSON());
    expect(text).toContain('Learning plan');
    expect(text).toContain('Concepts');
    expect(text).not.toContain('Big-O basics');
  });
});
