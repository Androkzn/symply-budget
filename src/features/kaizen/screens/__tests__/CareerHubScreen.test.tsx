/**
 * CareerHubScreen — Symply Kaizen (`symply-kaizen`) career hub.
 *
 * Renders the REAL screen through <ThemeProvider> for a fresh (incomplete) career
 * profile, asserts the progress stats + tools, and drives "Start career setup" →
 * router.push. The extended suite exercises resume analysis (pasted + Drive-import),
 * the populated skills / pipeline lists, and every career-tool navigation.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';


import { ThemeProvider } from '@contexts/ThemeContext';


import { IPHONE, IPAD, allText, pressByText, pressablesWithText } from '../../test-utils/kaizenScreenTestKit';
import { CareerHubScreen } from '../CareerHubScreen';

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

jest.mock('@features/kaizen/upload/KaizenImportUploadSection', () => {
  const R = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    KaizenImportUploadSection: ({
      onImported,
    }: {
      onImported?: (result: { resumeText?: string }) => void;
    }) =>
      R.createElement(
        View,
        null,
        R.createElement(
          Pressable,
          {
            onPress: () => onImported?.({ resumeText: 'resume file text' }),
          },
          R.createElement(Text, null, 'MockUploadFile'),
        ),
      ),
    importPanelConfig: jest.requireActual('@features/kaizen/upload/KaizenImportUploadSection').importPanelConfig,
  };
});

const rqState = {
  skills: [] as unknown[],
  questions: [] as unknown[],
  pipeline: [] as unknown[],
};

jest.mock('@features/kaizen/hooks/useKaizenSkills', () => ({
  __esModule: true,
  useKaizenSkills: () => ({ data: rqState.skills }),
}));

jest.mock('@features/kaizen/hooks/useKaizenInterviewQuestions', () => ({
  __esModule: true,
  useKaizenInterviewQuestions: () => ({ data: rqState.questions }),
}));

jest.mock('@features/kaizen/hooks/useKaizenInterviewPipeline', () => ({
  __esModule: true,
  useKaizenInterviewPipeline: () => ({ data: rqState.pipeline }),
}));

jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const A = () => jest.fn().mockResolvedValue(undefined);
  const state = {
    skills: [],
    profile: null,
    pipeline: [],
    questions: [],
    analyzeResume: jest.fn().mockResolvedValue({}),
    saveCareerSetup: A(),
    addSkill: A(),
  };
  const useKaizenStore = (sel?: (value: typeof state) => unknown) => (sel ? sel(state) : state);
  useKaizenStore.getState = () => state;
  useKaizenStore.setState = (p: Partial<typeof state> | ((value: typeof state) => Partial<typeof state>)) => Object.assign(state, typeof p === 'function' ? p(state) : p);
  return { __esModule: true, useKaizenStore, __state: state };
});

 
const { __state: state } = require('@features/kaizen/stores/kaizenStore');

function syncRqState() {
  rqState.skills = state.skills;
  rqState.questions = state.questions;
  rqState.pipeline = state.pipeline;
}

const resumeInput = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll((n) => String(n.type) === 'TextInput')[0];

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ThemeProvider>
          <CareerHubScreen />
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  state.skills = [];
  state.profile = null;
  state.pipeline = [];
  state.questions = [];
  syncRqState();
  state.analyzeResume.mockResolvedValue({});
  state.saveCareerSetup.mockResolvedValue(undefined);
  state.addSkill.mockResolvedValue(undefined);
});

describe('CareerHubScreen', () => {
  it('renders the getting-started card, progress stats, and career tools', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Career');
    expect(text).toContain('Get started');
    expect(text).toContain('PROGRESS');
    expect(text).toContain('CAREER TOOLS');
  });

  it('opens career setup from "Start career setup"', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Start career setup'));
    expect(router.push).toHaveBeenCalledWith('/kaizen/career-setup');
  });

  it('mounts on iPad-class dimensions with the same content', async () => {
    mockWindow = IPAD;
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('CAREER TOOLS');
  });

  it('renders the populated skills + pipeline lists and hides the setup card', async () => {
    state.profile = { career_setup_step: 'complete' };
    state.skills = [
      { id: 's1', name: 'System Design', level_raw: 2, mastery_0_to_100: 60 },
      { id: 's2', name: 'Leadership', level_raw: 1, mastery_0_to_100: null },
    ];
    state.pipeline = [{ id: 'p1', title: 'Acme Corp', stage: 'Applied' }];
    state.questions = [{ id: 'q1' }, { id: 'q2' }];
    syncRqState();
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).not.toContain('Get started');
    expect(text).toContain('System Design');
    expect(text).toContain('Level 2 · 60% mastery');
    expect(text).toContain('0% mastery'); // mastery ?? 0
    expect(text).toContain('Acme Corp');
    expect(text).toContain('Applied');
  });

  it('fills the resume field from the upload section', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'MockUploadFile');
    });
    expect(resumeInput(tree).props.value).toBe('resume file text');
  });

  it('opens resume review when resume text is present', async () => {
    const tree = await renderScreen();
    act(() => resumeInput(tree).props.onChangeText('My resume text'));
    act(() => pressByText(tree, 'Open resume review'));
    expect(router.push).toHaveBeenCalledWith('/kaizen/resume-review');
  });

  it('navigates from every career tool link and the practice link', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Career progress'));
    expect(router.push).toHaveBeenCalledWith('/kaizen/career-progress');
    act(() => pressByText(tree, 'Interview pipeline'));
    expect(router.push).toHaveBeenCalledWith('/kaizen/pipeline');
    act(() => pressByText(tree, 'Resume review'));
    expect(router.push).toHaveBeenCalledWith('/kaizen/resume-review');
    act(() => pressByText(tree, 'Import questions'));
    expect(router.push).toHaveBeenCalledWith('/kaizen/question-import');
    act(() => pressByText(tree, 'Practice questions'));
    expect(router.push).toHaveBeenCalledWith('/kaizen/banks');
  });

  it('shows progress stat counts from the store', async () => {
    state.skills = [{ id: 's1', name: 'Go', level_raw: 1, mastery_0_to_100: 10 }];
    state.questions = [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }];
    state.pipeline = [{ id: 'p1', title: 'Acme', stage: 'saved' }];
    syncRqState();
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Skills');
    expect(text).toContain('Questions');
    expect(text).toContain('Opportunities');
    // Stat values appear in order: skills, questions, pipeline lengths.
    expect(text).toMatch(/1[\s\S]*3[\s\S]*1/);
  });

  it('keeps resume review disabled until resume text is entered', async () => {
    const tree = await renderScreen();
    expect(resumeInput(tree).props.value).toBe('');
    const reviewButton = pressablesWithText(tree, 'Open resume review')[0];
    expect(reviewButton.props.disabled).toBe(true);
    expect(router.push).not.toHaveBeenCalledWith('/kaizen/resume-review');
  });
});
