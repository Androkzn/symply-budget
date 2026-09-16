/**
 * SkillAssessmentScreen — Symply Kaizen (`symply-kaizen`) adaptive skill diagnostic.
 *
 * Renders the REAL screen through <ThemeProvider> for a skill resolved from the
 * `skillId` route param, and drives "Start assessment" → generateAssessmentQuestion.
 * The AI-backed assessment service is stubbed so the flow is deterministic. The
 * extended suite runs the full answer → submit → finish loop, both AI-failure
 * fallbacks (question + evaluation), and the missing-skill guard.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { router } from 'expo-router';
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  IPHONE,
  allText,
  
  flushMicrotasks,
  pressByText,
  typeIn,
} from '../../test-utils/kaizenScreenTestKit';
import { SkillAssessmentScreen } from '../SkillAssessmentScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

jest.mock('expo-router', () => ({
  __esModule: true,
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() },
  useLocalSearchParams: () => ({ skillId: 's1' }),
  Redirect: () => null,
  Link: ({ children }: { children?: React.ReactNode }) => children,
}));

jest.mock('@components/common', () =>
  require('../../test-utils/mockComponentsCommon').createKaizenComponentsCommonMock(),
);

const mockGenerate = jest.fn();
const mockEvaluate = jest.fn();
const mockCompute = jest.fn((..._args: unknown[]) => ({ skillId: 's1', overallScore: 80 }));
jest.mock('@features/kaizen/services/skillAssessment', () => ({
  __esModule: true,
  generateAssessmentQuestion: (...args: unknown[]) => mockGenerate(...args),
  evaluateAssessmentAnswer: (...args: unknown[]) => mockEvaluate(...args),
  computeResultFromTurns: (...args: unknown[]) => mockCompute(...args),
}));

const mockSkillsState = {
  skills: [{ id: 's1', name: 'System Design' }],
};

jest.mock('@features/kaizen/hooks/useKaizenSkills', () => ({
  __esModule: true,
  useKaizenSkills: () => ({ data: mockSkillsState.skills }),
}));

jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const state = {
    saveAssessmentResult: jest.fn().mockResolvedValue(undefined),
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
        <SkillAssessmentScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  mockSkillsState.skills = [{ id: 's1', name: 'System Design' }];
  state.saveAssessmentResult.mockResolvedValue(undefined);
  mockGenerate.mockResolvedValue({ prompt: 'Explain database indexing' });
  mockEvaluate.mockResolvedValue({ overall_score: 80, strengths: ['clear'], gaps: [] });
  mockCompute.mockReturnValue({ skillId: 's1', overallScore: 80 });
});

describe('SkillAssessmentScreen', () => {
  it('renders the assessment shell with the resolved skill name', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Skill assessment');
    expect(text).toContain('System Design');
    expect(text).toContain('Start assessment');
  });

  it('generates the first diagnostic question on "Start assessment"', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Start assessment');
    });
    expect(mockGenerate).toHaveBeenCalledWith('s1', []);
  });

  it('runs a full answer → submit → finish loop', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Start assessment');
    });
    expect(allText(tree.toJSON())).toContain('Explain database indexing');

    act(() => typeIn(tree, 'A thorough written answer'));
    await act(async () => {
      pressByText(tree, 'Submit answer');
    });
    expect(mockEvaluate).toHaveBeenCalledWith('s1', expect.objectContaining({
      answer: 'A thorough written answer',
    }));
    const afterSubmit = allText(tree.toJSON());
    expect(afterSubmit).toContain('Question 2');
    expect(afterSubmit).toContain('Finish assessment');

    await act(async () => {
      pressByText(tree, 'Finish assessment');
    });
    expect(mockCompute).toHaveBeenCalled();
    expect(state.saveAssessmentResult).toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/kaizen/learning-plan?skillId=s1');
  });

  it('falls back to a generic prompt when question generation fails', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('ai down'));
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Start assessment');
    });
    expect(allText(tree.toJSON())).toContain(
      'Explain a core System Design concept and how you would apply it.',
    );
  });

  it('records a turn even when the evaluation returns no numeric score', async () => {
    mockEvaluate.mockResolvedValueOnce({ overall_score: null, strengths: [], gaps: [] });
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Start assessment');
    });
    act(() => typeIn(tree, 'An answer without a score'));
    await act(async () => {
      pressByText(tree, 'Submit answer');
    });
    expect(allText(tree.toJSON())).toContain('Question 2');
  });

  it('falls back to a length-based score when evaluation fails', async () => {
    mockEvaluate.mockRejectedValueOnce(new Error('ai down'));
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Start assessment');
    });
    act(() => typeIn(tree, 'short'));
    await act(async () => {
      pressByText(tree, 'Submit answer');
    });
    expect(allText(tree.toJSON())).toContain('Question 2');
    expect(state.saveAssessmentResult).not.toHaveBeenCalled();
  });

  it('ignores a submit with an empty answer', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Start assessment');
    });
    await act(async () => {
      pressByText(tree, 'Submit answer');
    });
    expect(mockEvaluate).not.toHaveBeenCalled();
  });

  it('runs two answer turns before finishing and saving', async () => {
    mockGenerate
      .mockResolvedValueOnce({ prompt: 'Explain database indexing' })
      .mockResolvedValueOnce({ prompt: 'Describe load balancing' });
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Start assessment');
    });
    act(() => typeIn(tree, 'First turn answer with enough detail'));
    await act(async () => {
      pressByText(tree, 'Submit answer');
    });
    expect(allText(tree.toJSON())).toContain('Describe load balancing');
    act(() => typeIn(tree, 'Second turn answer with enough detail'));
    await act(async () => {
      pressByText(tree, 'Submit answer');
    });
    expect(allText(tree.toJSON())).toContain('Question 3');
    await act(async () => {
      pressByText(tree, 'Finish assessment');
    });
    expect(mockEvaluate).toHaveBeenCalledTimes(2);
    expect(state.saveAssessmentResult).toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/kaizen/learning-plan?skillId=s1');
  });

  it('does not navigate when saving the assessment result fails', async () => {
    state.saveAssessmentResult.mockImplementationOnce(() => new Promise(() => undefined));
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Start assessment');
    });
    act(() => typeIn(tree, 'Answer long enough to finish'));
    await act(async () => {
      pressByText(tree, 'Submit answer');
    });
    await act(async () => {
      pressByText(tree, 'Finish assessment');
      await flushMicrotasks();
    });
    expect(state.saveAssessmentResult).toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('does nothing and shows the placeholder when the skill is unknown', async () => {
    mockSkillsState.skills = [];
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Choose a skill');
    await act(async () => {
      pressByText(tree, 'Start assessment');
    });
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});
