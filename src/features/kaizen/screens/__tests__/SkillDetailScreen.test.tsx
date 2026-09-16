/**
 * SkillDetailScreen — Symply Kaizen (`symply-kaizen`) single-skill detail.
 *
 * Renders the REAL screen through <ThemeProvider> off a mocked store keyed by the
 * `skillId` search param, asserts the mastery hero + training rows, drives the
 * "Run assessment" router.push and the "Activate for training" store action, and
 * covers the missing-skill fallback.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  IPAD,
  IPHONE,
  allText,
  drainMockRejection,
  flushMicrotasks,
  mockHandledRejection,
  pressByText,
} from '../../test-utils/kaizenScreenTestKit';
import { SkillDetailScreen } from '../SkillDetailScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

jest.mock('@components/common', () =>
  require('../../test-utils/mockComponentsCommon').createKaizenComponentsCommonMock(),
);

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = { skillId: 's1' };
jest.mock('expo-router', () => ({
  __esModule: true,
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: jest.fn(),
    back: (...args: unknown[]) => mockBack(...args),
    navigate: jest.fn(),
  },
  useLocalSearchParams: () => mockParams,
  Redirect: () => null,
  Link: ({ children }: { children?: React.ReactNode }) => children,
}));

const mockSkillsState = {
  skills: [
    {
      id: 's1',
      name: 'System Design',
      mastery_0_to_100: 55,
      activation_state: 'active',
      deleted_at: null,
    },
  ],
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

function setState(next: Record<string, unknown>) {
  Object.keys(mockState).forEach((k) => delete mockState[k]);
  Object.assign(mockState, next);
}

const activate = jest.fn().mockResolvedValue(undefined);
const pause = jest.fn().mockResolvedValue(undefined);
const backlog = jest.fn().mockResolvedValue(undefined);

function seed(skills: unknown[]) {
  mockSkillsState.skills = skills as typeof mockSkillsState.skills;
  setState({
    activateSkillForTraining: activate,
    pauseSkill: pause,
    backlogSkill: backlog,
  });
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <SkillDetailScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  mockParams = { skillId: 's1' };
  jest.clearAllMocks();
  seed([{ id: 's1', name: 'System design', activation_state: 'active', mastery_0_to_100: 60 }]);
});

describe('SkillDetailScreen', () => {
  it('renders the skill name, mastery and training rows', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('System design');
    expect(text).toContain('60%');
    expect(text).toContain('Run assessment');
    expect(text).toContain('Activate for training');
  });

  it('pushes the assessment route from the "Run assessment" row', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Run assessment'));
    expect(mockPush).toHaveBeenCalledWith('/kaizen/skill-assessment?skillId=s1');
  });

  it('activates the skill from the "Activate for training" row', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Activate for training'));
    expect(activate).toHaveBeenCalledWith('s1');
  });

  it('opens the learning plan from the "Open learning plan" row', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Open learning plan'));
    expect(mockPush).toHaveBeenCalledWith('/kaizen/learning-plan?skillId=s1');
  });

  it('pauses the skill from the "Pause" row', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Pause'));
    expect(pause).toHaveBeenCalledWith('s1');
  });

  it('backlogs the skill from the "Move to backlog" row', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Move to backlog'));
    expect(backlog).toHaveBeenCalledWith('s1');
  });

  it('defaults a null mastery to zero in the hero', async () => {
    seed([{ id: 's1', name: 'System design', activation_state: 'active', mastery_0_to_100: null }]);
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('0%');
    expect(text).toContain('active · 0% mastery');
  });

  it('still invokes store training actions when they reject', async () => {
    mockHandledRejection(activate);
    mockHandledRejection(pause);
    mockHandledRejection(backlog);
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Activate for training');
      await flushMicrotasks();
      await drainMockRejection(activate);
    });
    await act(async () => {
      pressByText(tree, 'Pause');
      await flushMicrotasks();
      await drainMockRejection(pause);
    });
    await act(async () => {
      pressByText(tree, 'Move to backlog');
      await flushMicrotasks();
      await drainMockRejection(backlog);
    });
    expect(activate).toHaveBeenCalledWith('s1');
    expect(pause).toHaveBeenCalledWith('s1');
    expect(backlog).toHaveBeenCalledWith('s1');
    expect(allText(tree.toJSON())).toContain('Run assessment');
  });

  it('shows the unavailable fallback when the skill is missing', async () => {
    seed([]);
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('This skill is unavailable.');
  });

  it('mounts on iPad-class dimensions', async () => {
    mockWindow = IPAD;
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('System design');
  });
});
