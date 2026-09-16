/**
 * KaizenCareerSetupScreen — account-onboarding wrapper around the same
 * 5-step career wizard (`useCareerSetupWizard`) `CareerSetupScreen` uses
 * outside onboarding. Reached only when Career was among the systems picked
 * on `KaizenSystemsSetupScreen`; it's always the true last onboarding
 * screen, so its own last sub-step finishes account onboarding — flipping
 * BOTH the Kaizen-local and account-level onboarding flags — rather than
 * navigating anywhere else the way the standalone screen's two endings do.
 *
 * Drives the real screen and asserts: the resume gate (step 1) and the
 * both-banks-satisfied gate (step 3) block Continue via the shared
 * `OnboardingStepScreen`'s `continueDisabled`, not just app-level logic;
 * "Back" pops to the previous account-onboarding screen only from the
 * wizard's own first sub-step, and decrements the internal step otherwise;
 * and the last sub-step's "Finish" completes onboarding.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { KaizenCareerSetupScreen } from '../KaizenCareerSetupScreen';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
}));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  __esModule: true,
  useRouter: () => ({ replace: mockReplace }),
}));

const mockFinishSetupAfterCareer = jest.fn();
jest.mock('@features/kaizen/services/setupFlow', () => ({
  __esModule: true,
  ...jest.requireActual('@features/kaizen/services/setupFlow'),
  finishSetupAfterCareer: () => mockFinishSetupAfterCareer(),
  readSetupQueue: () => ['career'],
}));

jest.mock('@features/kaizen/upload/KaizenImportUploadSection', () => {
  const R = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    KaizenImportUploadSection: ({
      onImported,
      purpose,
    }: {
      onImported?: (result: { resumeText?: string; resumeSummary?: string }) => void;
      purpose?: string;
    }) =>
      R.createElement(
        View,
        null,
        R.createElement(
          Pressable,
          {
            onPress: () => {
              if (purpose === 'questions') return;
              onImported?.({ resumeText: 'Imported file text', resumeSummary: 'Parsed summary' });
            },
          },
          R.createElement(Text, null, 'MockUploadFile'),
        ),
      ),
  };
});

jest.mock('@features/kaizen/hooks/useKaizenInterviewQuestions', () => ({
  __esModule: true,
  useKaizenInterviewQuestions: () => ({ data: mockQuestionsState.questions }),
  useInvalidateKaizenInterviewQuestions: () => jest.fn().mockResolvedValue(undefined),
}));

const bothBanks = [
  { question_bank: 'technical', deleted_at: null },
  { question_bank: 'behavioral', deleted_at: null },
];
const mockQuestionsState: { questions: unknown[] } = { questions: [] };

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
  const useKaizenStore = (sel: (s: typeof state) => unknown) => (sel ? sel(state) : state);
  return { __esModule: true, useKaizenStore, __state: state };
});
const { __state: state } = require('@features/kaizen/stores/kaizenStore');

const mockCompleteOnboarding = jest.fn();
jest.mock('@stores/authStore', () => ({
  __esModule: true,
  useAuthStore: (selector: (s: { completeOnboarding: () => void; user?: { id: string } }) => unknown) =>
    selector({ completeOnboarding: mockCompleteOnboarding, user: { id: 'u1' } }),
}));

const SCREEN = 'onboarding-kaizen-career-setup-screen';

function hasTestId(tree: ReactTestRenderer.ReactTestRenderer, testID: string): boolean {
  return tree.root.findAllByProps({ testID }).length > 0;
}

function pressByTestId(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const node = tree.root.findAllByProps({ testID })[0];
  node.props.onPress?.();
}

function firstInput(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.findAll((n) => String(n.type) === 'TextInput')[0];
}

/** Presses the nearest Pressable ancestor of a Text node with this exact content. */
function pressByText(tree: ReactTestRenderer.ReactTestRenderer, text: string) {
  const match = tree.root
    .findAll((n) => typeof n.props?.onPress === 'function')
    .find((n) =>
      n
        .findAll((child) => typeof child.type === 'string')
        .some((child) => {
          const c = child.props?.children;
          return Array.isArray(c) ? c.includes(text) : c === text;
        }),
    );
  if (!match) throw new Error(`No pressable found containing text: "${text}"`);
  match.props.onPress();
}

async function pressContinue(tree: ReactTestRenderer.ReactTestRenderer) {
  await act(async () => {
    pressByTestId(tree, `${SCREEN}-continue`);
  });
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <KaizenCareerSetupScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

describe('KaizenCareerSetupScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    state.profile = { resume_summary: null };
    mockQuestionsState.questions = [];
    state.addSkill.mockResolvedValue(undefined);
    state.importQuestionsFromText.mockResolvedValue(1);
    state.addInterviewQuestion.mockResolvedValue(undefined);
    state.analyzeResume.mockResolvedValue({ summary: 'Parsed summary' });
    state.saveCareerSetup.mockResolvedValue(undefined);
    state.finishOnboarding.mockResolvedValue(undefined);
  });

  it('renders the first sub-step (goals and roles)', async () => {
    const tree = await renderScreen();
    expect(hasTestId(tree, SCREEN)).toBe(true);
  });

  it('blocks Continue on the resume step until a resume is provided', async () => {
    const tree = await renderScreen();
    await pressContinue(tree); // 0 -> 1 (Resume)

    let continueButton = tree.root.findAllByProps({ testID: `${SCREEN}-continue` })[0];
    expect(continueButton.props.disabled).toBe(true);

    act(() => firstInput(tree).props.onChangeText('Senior engineer, 8 years'));
    continueButton = tree.root.findAllByProps({ testID: `${SCREEN}-continue` })[0];
    expect(continueButton.props.disabled).toBe(false);
  });

  it('persists the resume via analyzeResume + saveCareerSetup once provided', async () => {
    const tree = await renderScreen();
    await pressContinue(tree); // 0 -> 1
    act(() => firstInput(tree).props.onChangeText('Senior engineer, 8 years'));
    await pressContinue(tree); // 1 -> 2

    expect(state.analyzeResume).toHaveBeenCalledWith('Senior engineer, 8 years');
    expect(state.saveCareerSetup).toHaveBeenCalledWith(
      expect.objectContaining({ step: 'resume', resumeSummary: 'Parsed summary' }),
    );
  });

  it('imports a resume from the upload section', async () => {
    const tree = await renderScreen();
    await pressContinue(tree); // 0 -> 1
    await act(async () => pressByText(tree, 'MockUploadFile'));
    expect(firstInput(tree).props.value).toBe('Imported file text');
  });

  it('blocks finishing until both question banks have an entry', async () => {
    state.profile = { resume_summary: 'Existing summary' };
    const tree = await renderScreen();
    await pressContinue(tree); // 0 -> 1
    await pressContinue(tree); // 1 -> 2
    await pressContinue(tree); // 2 -> 3 (Questions)

    const continueButton = tree.root.findAllByProps({ testID: `${SCREEN}-continue` })[0];
    expect(continueButton.props.disabled).toBe(true);
  });

  it('enables Continue once both banks are satisfied', async () => {
    state.profile = { resume_summary: 'Existing summary' };
    mockQuestionsState.questions = bothBanks;
    const tree = await renderScreen();
    await pressContinue(tree);
    await pressContinue(tree);
    await pressContinue(tree);

    const continueButton = tree.root.findAllByProps({ testID: `${SCREEN}-continue` })[0];
    expect(continueButton.props.disabled).toBe(false);
  });

  it('shows "Finish" with no forward chevron on the last sub-step', async () => {
    state.profile = { resume_summary: 'Existing summary' };
    mockQuestionsState.questions = bothBanks;
    const tree = await renderScreen();
    await pressContinue(tree);
    await pressContinue(tree);
    await pressContinue(tree);
    await pressContinue(tree); // -> step 4 (Finish)

    const continueButton = tree.root.findAllByProps({ testID: `${SCREEN}-continue` })[0];
    expect(continueButton.props.title).toBe('Finish');
    expect(hasTestId(tree, `${SCREEN}-forward`)).toBe(false);
  });

  it('finishes account onboarding on the last sub-step, flipping both onboarding flags', async () => {
    state.profile = { resume_summary: 'Existing summary' };
    mockQuestionsState.questions = bothBanks;
    const tree = await renderScreen();
    await pressContinue(tree);
    await pressContinue(tree);
    await pressContinue(tree);
    await pressContinue(tree);
    await pressContinue(tree); // Finish

    expect(state.saveCareerSetup).toHaveBeenCalledWith(expect.objectContaining({ step: 'complete' }));
    expect(mockFinishSetupAfterCareer).toHaveBeenCalledTimes(1);
    expect(state.finishOnboarding).toHaveBeenCalledTimes(1);
    expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('pops to the previous onboarding screen on Back from the first sub-step', async () => {
    const tree = await renderScreen();

    act(() => pressByTestId(tree, `${SCREEN}-back`));

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('decrements the internal sub-step on Back once past the first one, without leaving the screen', async () => {
    const tree = await renderScreen();
    await pressContinue(tree); // 0 -> 1

    act(() => pressByTestId(tree, `${SCREEN}-back`));

    expect(mockGoBack).not.toHaveBeenCalled();
    // Back on the resume step (1) returns to goals/roles (0) — its TextInput
    // (roles) has no resume-gate, so Continue reads enabled again.
    const continueButton = tree.root.findAllByProps({ testID: `${SCREEN}-continue` })[0];
    expect(continueButton.props.disabled).toBe(false);
  });
});
