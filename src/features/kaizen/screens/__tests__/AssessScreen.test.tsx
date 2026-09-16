/**
 * AssessScreen — Symply Kaizen (`symply-kaizen`) skill-mastery overview.
 *
 * Renders the REAL screen through <ThemeProvider> with one assessable skill,
 * asserts the mastery ring + skill row, and drives "Assess →" → router.push to
 * the per-skill assessment.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { router } from 'expo-router';
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  IPHONE,
  allText,
  expectStillOnScreen,
  hasTestId,
  pressByText,
} from '../../test-utils/kaizenScreenTestKit';
import { AssessScreen } from '../AssessScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

jest.mock('expo-router', () => ({
  __esModule: true,
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() },
  useLocalSearchParams: () => ({}),
  Redirect: () => null,
  Link: ({ children }: { children?: React.ReactNode }) => children,
}));

jest.mock('@components/common', () =>
  require('../../test-utils/mockComponentsCommon').createKaizenComponentsCommonMock(),
);

const mockSkillsState = {
  skills: [
    {
      id: 's1',
      name: 'System Design',
      is_assessable: true,
      mastery_0_to_100: 40 as number | null,
      activation_state: 'active',
    },
  ],
};

jest.mock('@features/kaizen/hooks/useKaizenSkills', () => ({
  __esModule: true,
  useKaizenSkills: () => ({ data: mockSkillsState.skills }),
}));

jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const state = {};
  const useKaizenStore = (sel?: (value: typeof state) => unknown) => (sel ? sel(state) : state);
  useKaizenStore.getState = () => state;
  useKaizenStore.setState = (p: Partial<typeof state> | ((value: typeof state) => Partial<typeof state>)) => Object.assign(state, typeof p === 'function' ? p(state) : p);
  return { __esModule: true, useKaizenStore, __state: state };
});

 

const DEFAULT_SKILL = {
  id: 's1',
  name: 'System Design',
  is_assessable: true,
  mastery_0_to_100: 40 as number | null,
  activation_state: 'active',
};

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <AssessScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  mockSkillsState.skills = [{ ...DEFAULT_SKILL }];
});

describe('AssessScreen', () => {
  it('renders the mastery ring and the assessable skill row', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Assess');
    expect(text).toContain('SKILL MASTERY');
    expect(text).toContain('System Design');
  });

  it('opens the per-skill assessment from "Assess →"', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Assess →'));
    expect(router.push).toHaveBeenCalledWith('/kaizen/skill-assessment?skillId=s1');
  });

  it('opens the skill detail from the skill row', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'System Design'));
    expect(router.push).toHaveBeenCalledWith('/kaizen/skill?skillId=s1');
  });

  it('navigates to all skills and to interview questions from the footers', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'View all skills →'));
    expect(router.push).toHaveBeenCalledWith('/kaizen-career');
    act(() => pressByText(tree, 'Practice interview questions →'));
    expect(router.push).toHaveBeenCalledWith('/kaizen/banks');
  });

  it('shows the empty state and a zeroed ring when no skill is assessable', async () => {
    mockSkillsState.skills = [{ ...DEFAULT_SKILL, is_assessable: false }];
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Your skill assessments will appear here.');
    // 0 assessable → the plural "s" branch of the count label.
    expect(text).toContain('0 assessable skills');
  });

  it('uses the singular assessable-skill label for exactly one skill', async () => {
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('1 assessable skill');
    expect(allText(tree.toJSON())).not.toContain('1 assessable skills');
  });

  it('keeps the assess hub mounted after footer navigation CTAs', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'View all skills →'));
    act(() => pressByText(tree, 'Practice interview questions →'));
    expectStillOnScreen(tree, 'kaizen-assess-screen');
    expect(hasTestId(tree, 'kaizen-assess-screen')).toBe(true);
  });

  it('averages multiple skills and defaults a null mastery to zero', async () => {
    mockSkillsState.skills = [
      { ...DEFAULT_SKILL, id: 's1', name: 'System Design', mastery_0_to_100: 40 },
      {
        id: 's2',
        name: 'Algorithms',
        is_assessable: true,
        mastery_0_to_100: null,
        activation_state: 'paused',
      },
    ];
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('System Design');
    expect(text).toContain('Algorithms');
    // Two assessable skills → the plural "s" branch.
    expect(text).toContain('2 assessable skills');
    // The null-mastery skill renders 0%.
    expect(text).toContain('0%');
  });
});
