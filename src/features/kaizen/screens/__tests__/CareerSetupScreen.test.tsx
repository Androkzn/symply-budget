/**
 * CareerSetupScreen — Symply Kaizen (`symply-kaizen`) 5-step career wizard.
 *
 * Renders the REAL screen through <ThemeProvider> outside the onboarding flow and
 * asserts the mandatory gates added for onboarding: a resume must be provided before
 * leaving the Resume step, and at least one technical AND one behavioural question
 * must exist before the wizard can finish. Also covers device file import (resume +
 * questions), per-bank manual add, and the final saveCareerSetup(step:'complete').
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { router } from 'expo-router';
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import { finishSetupAfterCareer } from '@features/kaizen/services/setupFlow';

import {
  IPHONE,
  allText,
  drainMockRejection,
  flushMicrotasks,
  mockHandledRejection,
  pressByText,
} from '../../test-utils/kaizenScreenTestKit';
import { CareerSetupScreen } from '../CareerSetupScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  __esModule: true,
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() },
  useLocalSearchParams: () => mockParams,
  Redirect: () => null,
  Link: ({ children }: { children?: React.ReactNode }) => children,
}));

jest.mock('expo-file-system/legacy', () => ({
  __esModule: true,
  readAsStringAsync: jest.fn().mockResolvedValue('Imported file text'),
}));

jest.mock('expo-document-picker', () => ({
  __esModule: true,
  getDocumentAsync: jest.fn().mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file://doc.txt', name: 'doc.txt' }],
  }),
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
      purpose,
    }: {
      onImported?: (result: {
        resumeText?: string;
        resumeSummary?: string;
        questionCount?: number;
      }) => void;
      purpose?: string;
    }) =>
      R.createElement(
        View,
        null,
        R.createElement(
          Pressable,
          {
            onPress: () => {
              if (purpose === 'questions') {
                onImported?.({ questionCount: 2 });
                return;
              }
              onImported?.({ resumeText: 'Imported file text', resumeSummary: 'Parsed summary' });
            },
          },
          R.createElement(Text, null, 'MockUploadFile'),
        ),
      ),
    importPanelConfig: jest.requireActual('@features/kaizen/upload/KaizenImportUploadSection').importPanelConfig,
  };
});

jest.mock('@features/kaizen/services/setupFlow', () => ({
  __esModule: true,
  finishSetupAfterCareer: jest.fn(),
}));

const bothBanks = [
  { question_bank: 'technical', deleted_at: null },
  { question_bank: 'behavioral', deleted_at: null },
];

const mockQuestionsState: { questions: unknown[] } = { questions: [] };

jest.mock('@features/kaizen/hooks/useKaizenInterviewQuestions', () => ({
  __esModule: true,
  useKaizenInterviewQuestions: () => ({ data: mockQuestionsState.questions }),
  useInvalidateKaizenInterviewQuestions: () => jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const state = {
    addSkill: jest.fn().mockResolvedValue(undefined),
    importQuestionsFromText: jest.fn().mockResolvedValue(1),
    addInterviewQuestion: jest.fn().mockResolvedValue(undefined),
    analyzeResume: jest.fn().mockResolvedValue({ summary: 'Parsed summary' }),
    saveCareerSetup: jest.fn().mockResolvedValue(undefined),
    finishOnboarding: jest.fn().mockResolvedValue(undefined),
    profile: { resume_summary: null },
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
        <CareerSetupScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

/** All TextInputs currently rendered (a step may render more than one). */
const textInputs = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll((n) => String(n.type) === 'TextInput');
/** The first TextInput on the current step (roles / resume / skill / questions). */
const firstInput = (tree: ReactTestRenderer.ReactTestRenderer) => textInputs(tree)[0];

beforeEach(() => {
  mockWindow = IPHONE;
  mockParams = {};
  jest.clearAllMocks();
  // Reset shared mock state between tests (values are mutated per-test below).
  state.profile = { resume_summary: null };
  mockQuestionsState.questions = [];
  state.addSkill.mockResolvedValue(undefined);
  state.importQuestionsFromText.mockResolvedValue(1);
  state.addInterviewQuestion.mockResolvedValue(undefined);
  state.analyzeResume.mockResolvedValue({ summary: 'Parsed summary' });
  state.saveCareerSetup.mockResolvedValue(undefined);
  state.finishOnboarding.mockResolvedValue(undefined);
});

describe('CareerSetupScreen', () => {
  it('renders step 1 (goals and roles) of five', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Career setup');
    expect(text).toContain('Goals and roles');
    expect(text).toContain('Step 1 of 5');
  });

  it('blocks the resume step until a resume is provided, then persists it', async () => {
    const tree = await renderScreen();
    await act(async () => pressByText(tree, 'Continue')); // 0 -> 1 (Resume)
    expect(allText(tree.toJSON())).toContain('Step 2 of 5');

    // No resume yet: Continue is a no-op and nothing is saved.
    await act(async () => pressByText(tree, 'Continue'));
    expect(state.saveCareerSetup).not.toHaveBeenCalled();
    expect(allText(tree.toJSON())).toContain('Step 2 of 5');

    // Provide resume text, then advance -> analyze + persist the resume.
    act(() => firstInput(tree).props.onChangeText('Senior engineer, 8 years'));
    await act(async () => pressByText(tree, 'Continue'));
    expect(state.analyzeResume).toHaveBeenCalledWith('Senior engineer, 8 years');
    expect(state.saveCareerSetup).toHaveBeenCalledWith(
      expect.objectContaining({ step: 'resume', resumeSummary: 'Parsed summary' }),
    );
    expect(allText(tree.toJSON())).toContain('Step 3 of 5'); // Skills
  });

  it('imports a resume from the upload section', async () => {
    const tree = await renderScreen();
    await act(async () => pressByText(tree, 'Continue')); // 0 -> 1 (Resume)
    await act(async () => pressByText(tree, 'MockUploadFile'));
    expect(firstInput(tree).props.value).toBe('Imported file text');
    await act(async () => pressByText(tree, 'Continue'));
    expect(state.analyzeResume).toHaveBeenCalled();
  });

  it('blocks finishing until both question banks have an entry', async () => {
    state.profile = { resume_summary: 'Existing summary' }; // resume gate pre-satisfied
    const tree = await renderScreen();
    await act(async () => pressByText(tree, 'Continue')); // 0 -> 1
    await act(async () => pressByText(tree, 'Continue')); // 1 -> 2 (resume already present)
    await act(async () => pressByText(tree, 'Continue')); // 2 -> 3 (Questions)
    expect(allText(tree.toJSON())).toContain('Step 4 of 5');
    expect(allText(tree.toJSON())).toContain('Technical: 0');
    expect(allText(tree.toJSON())).toContain('Behavioural: 0');

    // Gate holds: Continue does not advance to Finish.
    await act(async () => pressByText(tree, 'Continue'));
    expect(state.saveCareerSetup).not.toHaveBeenCalledWith(
      expect.objectContaining({ step: 'complete' }),
    );
    expect(allText(tree.toJSON())).toContain('Step 4 of 5');
  });

  it('routes a pasted list and manual entries into the banks', async () => {
    state.profile = { resume_summary: 'Existing summary' };
    const tree = await renderScreen();
    await act(async () => pressByText(tree, 'Continue')); // 0 -> 1
    await act(async () => pressByText(tree, 'Continue')); // 1 -> 2
    await act(async () => pressByText(tree, 'Continue')); // 2 -> 3 (Questions)

    const inputs = textInputs(tree);
    act(() => inputs[0].props.onChangeText('Q1\nQ2')); // questions textarea
    await act(async () => pressByText(tree, 'Add to banks'));
    expect(state.importQuestionsFromText).toHaveBeenCalledWith('Q1\nQ2');

    // Manual single-question add targets the chosen bank.
    const manual = textInputs(tree)[1];
    act(() => manual.props.onChangeText('Explain a hard trade-off'));
    await act(async () => pressByText(tree, 'Add behavioural'));
    expect(state.addInterviewQuestion).toHaveBeenCalledWith(
      'Explain a hard trade-off',
      'behavioral',
    );
  });

  it('imports questions from a device file', async () => {
    state.profile = { resume_summary: 'Existing summary' };
    const tree = await renderScreen();
    await act(async () => pressByText(tree, 'Continue')); // 0 -> 1
    await act(async () => pressByText(tree, 'Continue')); // 1 -> 2
    await act(async () => pressByText(tree, 'Continue')); // 2 -> 3 (Questions)
    await act(async () => pressByText(tree, 'MockUploadFile'));
    expect(allText(tree.toJSON())).toContain('MockUploadFile');
  });

  it('walks the full wizard and saves the completed setup', async () => {
    state.profile = { resume_summary: 'Existing summary' };
    mockQuestionsState.questions = bothBanks;
    const tree = await renderScreen();
    act(() => firstInput(tree).props.onChangeText('SRE, Platform'));
    act(() => pressByText(tree, 'New role'));

    await act(async () => pressByText(tree, 'Continue')); // 0 -> 1
    await act(async () => pressByText(tree, 'Continue')); // 1 -> 2 (resume satisfied)
    await act(async () => pressByText(tree, 'Continue')); // 2 -> 3
    await act(async () => pressByText(tree, 'Continue')); // 3 -> 4 (both banks satisfied)
    await act(async () => pressByText(tree, 'Finish setup')); // 4 -> save

    expect(state.saveCareerSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        targetRoles: ['SRE', 'Platform'],
        goalTypes: ['New role'],
        step: 'complete',
      }),
    );
    expect(router.replace).toHaveBeenCalledWith('/kaizen-career');
  });

  it('toggles a goal off when tapped twice', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Promotion'));
    expect(allText(tree.toJSON())).toContain('✓ Promotion');
    act(() => pressByText(tree, 'Promotion'));
    expect(allText(tree.toJSON())).not.toContain('✓ Promotion');
  });

  it('finishes the setup flow onboarding and returns home', async () => {
    mockParams = { setup: '1' };
    state.profile = { resume_summary: 'Existing summary' };
    mockQuestionsState.questions = bothBanks;
    const tree = await renderScreen();
    await act(async () => pressByText(tree, 'Continue')); // 0 -> 1
    await act(async () => pressByText(tree, 'Continue')); // 1 -> 2
    await act(async () => pressByText(tree, 'Continue')); // 2 -> 3
    await act(async () => pressByText(tree, 'Continue')); // 3 -> 4
    await act(async () => pressByText(tree, 'Finish setup'));
    expect(finishSetupAfterCareer).toHaveBeenCalledTimes(1);
    expect(state.finishOnboarding).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('adds a skill when continuing from the skills step', async () => {
    state.profile = { resume_summary: 'Existing summary' };
    const tree = await renderScreen();
    await act(async () => pressByText(tree, 'Continue')); // 0 -> 1
    await act(async () => pressByText(tree, 'Continue')); // 1 -> 2 (Skills)
    act(() => firstInput(tree).props.onChangeText('Distributed systems'));
    await act(async () => pressByText(tree, 'Continue'));
    expect(state.addSkill).toHaveBeenCalledWith('Distributed systems');
    expect(allText(tree.toJSON())).toContain('Step 4 of 5');
  });

  it('adds a technical question from the manual prompt field', async () => {
    state.profile = { resume_summary: 'Existing summary' };
    const tree = await renderScreen();
    await act(async () => pressByText(tree, 'Continue')); // 0 -> 1
    await act(async () => pressByText(tree, 'Continue')); // 1 -> 2
    await act(async () => pressByText(tree, 'Continue')); // 2 -> 3 (Questions)
    const manual = textInputs(tree)[1];
    act(() => manual.props.onChangeText('Design a rate limiter'));
    await act(async () => pressByText(tree, 'Add technical'));
    expect(state.addInterviewQuestion).toHaveBeenCalledWith(
      'Design a rate limiter',
      'technical',
    );
  });

  it('stays on the resume step when analyzeResume rejects', async () => {
    mockHandledRejection(state.analyzeResume);
    const tree = await renderScreen();
    await act(async () => pressByText(tree, 'Continue')); // 0 -> 1
    act(() => firstInput(tree).props.onChangeText('Resume body'));
    await act(async () => {
      pressByText(tree, 'Continue');
      await flushMicrotasks();
      await drainMockRejection(state.analyzeResume);
    });
    expect(state.analyzeResume).toHaveBeenCalledWith('Resume body');
    expect(allText(tree.toJSON())).toContain('Step 2 of 5');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('does not finish when saveCareerSetup rejects on the last step', async () => {
    state.profile = { resume_summary: 'Existing summary' };
    mockQuestionsState.questions = bothBanks;
    state.saveCareerSetup.mockImplementation((args: { step?: string }) => {
      if (args?.step === 'complete') {
        const rejected = Promise.reject(new Error('save failed'));
        void rejected.catch(() => undefined);
        return rejected;
      }
      return Promise.resolve(undefined);
    });
    const tree = await renderScreen();
    await act(async () => pressByText(tree, 'Continue')); // 0 -> 1
    await act(async () => pressByText(tree, 'Continue')); // 1 -> 2
    await act(async () => pressByText(tree, 'Continue')); // 2 -> 3
    await act(async () => pressByText(tree, 'Continue')); // 3 -> 4
    await act(async () => {
      pressByText(tree, 'Finish setup');
      await flushMicrotasks();
      await drainMockRejection(state.saveCareerSetup);
    });
    expect(state.saveCareerSetup).toHaveBeenCalledWith(
      expect.objectContaining({ step: 'complete' }),
    );
    expect(allText(tree.toJSON())).toContain('Finish setup');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('stays on the questions step when importQuestionsFromText rejects', async () => {
    state.profile = { resume_summary: 'Existing summary' };
    mockHandledRejection(state.importQuestionsFromText, 'import failed');
    const tree = await renderScreen();
    await act(async () => pressByText(tree, 'Continue')); // 0 -> 1
    await act(async () => pressByText(tree, 'Continue')); // 1 -> 2
    await act(async () => pressByText(tree, 'Continue')); // 2 -> 3
    act(() => textInputs(tree)[0].props.onChangeText('Q1\nQ2'));
    await act(async () => {
      pressByText(tree, 'Add to banks');
      await flushMicrotasks();
      await drainMockRejection(state.importQuestionsFromText);
    });
    expect(state.importQuestionsFromText).toHaveBeenCalledWith('Q1\nQ2');
    expect(textInputs(tree)[0].props.value).toBe('Q1\nQ2');
    expect(allText(tree.toJSON())).toContain('Step 4 of 5');
    expect(state.saveCareerSetup).not.toHaveBeenCalledWith(
      expect.objectContaining({ step: 'complete' }),
    );
  });
});
