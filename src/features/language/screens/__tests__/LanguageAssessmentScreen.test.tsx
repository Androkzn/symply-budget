/**
 * LanguageAssessmentScreen — Symply Language (`symply-language`) placement /
 * proficiency assessment.
 *
 * Renders the REAL screen through <ThemeProvider> on iPhone- and iPad-class
 * windows and drives its async state machine end-to-end:
 * boot (getStatus → start → first question), the tap/type answer loop
 * (submitAnswer → advance), grading, completion (complete → proficiency
 * profile), the error + retry branch, and back navigation. The assessment api
 * is fully mocked so every phase is deterministic; its own logic is covered in
 * the sibling api suites. There is no manual "Start" button — the screen
 * auto-boots on mount, so the start path is asserted via the mount flow.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { ThemeProvider } from '@contexts/ThemeContext';

import {
  languageAssessmentApi,
  type AdaptiveNext,
  type AdaptiveQuestion,
  type AdaptiveSubmit,
  type AssessmentStart,
  type AssessmentStatus,
  type ProficiencyProfile,
} from '../../api/languageAssessment';
import { IPAD, IPHONE, allText, hasTestId, pressByText } from '../../test-utils/languageScreenTestKit';
import { LanguageAssessmentScreen } from '../LanguageAssessmentScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn(), navigate: jest.fn() }),
}));

jest.mock('@hooks/useLayoutPadding', () => ({
  useLayoutPadding: () => ({ content: 16 }),
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View, Text, Pressable } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    // Expose the header's back handler as a pressable so back routing is exercised.
    ScreenHeader: ({ title, onBackPress }: { title?: string; onBackPress?: () => void }) =>
      ReactMock.createElement(View, { testID: 'screen-header' }, [
        ReactMock.createElement(Text, { key: 'title', testID: 'hdr-title' }, title),
        ReactMock.createElement(Pressable, { key: 'back', testID: 'hdr-back', onPress: onBackPress }),
      ]),
  };
});

jest.mock('../../api/languageAssessment', () => ({
  languageAssessmentApi: {
    getStatus: jest.fn(),
    start: jest.fn(),
    nextQuestion: jest.fn(),
    submitAnswer: jest.fn(),
    complete: jest.fn(),
    getResults: jest.fn(),
  },
}));

const mockGetStatus = languageAssessmentApi.getStatus as jest.Mock;
const mockStart = languageAssessmentApi.start as jest.Mock;
const mockNextQuestion = languageAssessmentApi.nextQuestion as jest.Mock;
const mockSubmitAnswer = languageAssessmentApi.submitAnswer as jest.Mock;
const mockComplete = languageAssessmentApi.complete as jest.Mock;

// ----- realistic payload factories (match the languageAssessment.ts interfaces) -----

function status(overrides: Partial<AssessmentStatus> = {}): AssessmentStatus {
  return { due: true, kind: 'initial', mandatory: true, planId: null, ...overrides };
}

function start(overrides: Partial<AssessmentStart> = {}): AssessmentStart {
  return { sessionId: 'sess-1', domains: ['grammar'], isResumed: false, questionsAnswered: 0, ...overrides };
}

function tapQuestion(overrides: Partial<AdaptiveQuestion> = {}): AdaptiveQuestion {
  return {
    id: 'q1',
    difficulty: 2,
    category: 'Grammar',
    backendType: 'mcq',
    text: 'Choose the correct article.',
    requiresVoice: false,
    suggestedAnswers: ['Option Alpha', 'Option Beta', 'Option Gamma'],
    ...overrides,
  };
}

function typeQuestion(overrides: Partial<AdaptiveQuestion> = {}): AdaptiveQuestion {
  return {
    id: 'q2',
    difficulty: 3,
    category: 'Vocabulary',
    backendType: 'open',
    text: 'Describe your morning routine.',
    requiresVoice: false,
    suggestedAnswers: undefined,
    ...overrides,
  };
}

function next(overrides: Partial<AdaptiveNext> = {}): AdaptiveNext {
  return {
    question: tapQuestion(),
    isComplete: false,
    questionNumber: 1,
    totalQuestions: 5,
    ...overrides,
  };
}

function submit(overrides: Partial<AdaptiveSubmit> = {}): AdaptiveSubmit {
  return {
    assessmentId: 'a1',
    analysis: {},
    isCorrect: true,
    audioAvailable: false,
    isComplete: false,
    questionsAsked: 1,
    totalQuestions: 5,
    ...overrides,
  };
}

function profile(overrides: Partial<ProficiencyProfile> = {}): ProficiencyProfile {
  return {
    overallProficiency: 0.72,
    cefrLevel: 'B1',
    strengths: ['Listening comprehension', 'Vocabulary range'],
    weaknesses: ['Verb tenses'],
    learningPriorities: ['Past perfect'],
    ...overrides,
  };
}

function completeResult(prof: ProficiencyProfile) {
  return { profile: prof, planProcessing: false, planGated: false, assessmentKind: 'initial' as const };
}

// ----- render + interaction helpers -----

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <LanguageAssessmentScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

/** Fire onChangeText on the type-mode answer TextInput. */
function typeAnswer(tree: ReactTestRenderer.ReactTestRenderer, text: string) {
  const input = tree.root.findAll((n) => n.props?.placeholder === 'Type your answer…')[0];
  act(() => input.props.onChangeText(text));
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  mockGetStatus.mockResolvedValue(status());
  mockStart.mockResolvedValue(start());
  mockNextQuestion.mockResolvedValue(next());
  mockSubmitAnswer.mockResolvedValue(submit());
  mockComplete.mockResolvedValue(completeResult(profile()));
});

describe('LanguageAssessmentScreen — loading gate', () => {
  it('shows the preparing spinner while boot is in flight', () => {
    mockStart.mockReturnValue(new Promise(() => {})); // never resolves
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <LanguageAssessmentScreen />
        </ThemeProvider>,
      );
    });
    expect(hasTestId(tree, 'language-assessment-screen')).toBe(true);
    expect(tree.root.findAllByType(ActivityIndicator).length).toBe(1);
    expect(allText(tree.toJSON())).toContain('Preparing your assessment…');
  });
});

describe('LanguageAssessmentScreen — boot → first question', () => {
  it('auto-starts the assessment and renders the first question', async () => {
    const tree = await renderScreen();

    expect(mockGetStatus).toHaveBeenCalledTimes(1);
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockNextQuestion).toHaveBeenCalledWith('sess-1', 'initial');

    const text = allText(tree.toJSON());
    expect(text).toContain('Placement assessment'); // header title
    expect(text).toContain('Choose the correct article.');
    expect(text).toContain('Question 1 of 5');
    expect(text).toContain('Grammar');
    // tap options rendered
    expect(text).toContain('Option Alpha');
    expect(text).toContain('Option Beta');
    expect(text).toContain('Submit');
  });

  it('renders the voice hint + a text input for a speaking question', async () => {
    mockNextQuestion.mockResolvedValue(
      next({ question: typeQuestion({ requiresVoice: true, text: 'Say hello.' }) }),
    );
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Speaking question — type your spoken answer for now.');
    expect(
      tree.root.findAll((n) => n.props?.placeholder === 'Type your answer…').length,
    ).toBeGreaterThan(0);
  });
});

describe('LanguageAssessmentScreen — answering', () => {
  it('submits a tapped option (inputMode "tap") and advances to the next question', async () => {
    mockNextQuestion
      .mockResolvedValueOnce(next({ question: tapQuestion(), questionNumber: 1 }))
      .mockResolvedValueOnce(next({ question: typeQuestion(), questionNumber: 2 }));
    const tree = await renderScreen();

    act(() => pressByText(tree, 'Option Beta'));
    await act(async () => {
      pressByText(tree, 'Submit');
    });

    expect(mockSubmitAnswer).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      questionId: 'q1',
      responseText: 'Option Beta',
      inputMode: 'tap',
      kind: 'initial',
    });
    // advanced to the second (type) question
    expect(allText(tree.toJSON())).toContain('Describe your morning routine.');
    expect(allText(tree.toJSON())).toContain('Question 2 of 5');
  });

  it('submits a typed answer (inputMode "type")', async () => {
    mockNextQuestion
      .mockResolvedValueOnce(next({ question: typeQuestion() }))
      .mockResolvedValueOnce(next({ question: tapQuestion({ id: 'q3' }), questionNumber: 2 }));
    const tree = await renderScreen();

    typeAnswer(tree, '  I wake up early  ');
    await act(async () => {
      pressByText(tree, 'Submit');
    });

    expect(mockSubmitAnswer).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      questionId: 'q2',
      responseText: 'I wake up early', // trimmed
      inputMode: 'type',
      kind: 'initial',
    });
  });

  it('does nothing when Submit is pressed with no answer', async () => {
    mockNextQuestion.mockResolvedValue(next({ question: typeQuestion() }));
    const tree = await renderScreen();

    await act(async () => {
      pressByText(tree, 'Submit');
    });

    expect(mockSubmitAnswer).not.toHaveBeenCalled();
    // still on the question
    expect(allText(tree.toJSON())).toContain('Describe your morning routine.');
  });
});

describe('LanguageAssessmentScreen — completion', () => {
  it('drives the full happy path to a proficiency profile', async () => {
    mockNextQuestion
      .mockResolvedValueOnce(next({ question: tapQuestion(), questionNumber: 1 }))
      .mockResolvedValueOnce(next({ question: typeQuestion(), questionNumber: 2 }))
      .mockResolvedValueOnce(next({ question: null, isComplete: true }));
    const tree = await renderScreen();

    // Q1: tap
    act(() => pressByText(tree, 'Option Gamma'));
    await act(async () => {
      pressByText(tree, 'Submit');
    });
    // Q2: type
    typeAnswer(tree, 'My routine');
    await act(async () => {
      pressByText(tree, 'Submit');
    });

    expect(mockComplete).toHaveBeenCalledWith('sess-1');
    const text = allText(tree.toJSON());
    expect(text).toContain('B1');
    expect(text).toContain('Your estimated level');
    expect(text).toContain('OVERALL PROFICIENCY');
    expect(text).toContain('72%'); // 0.72 → 72%
    expect(text).toContain('STRENGTHS');
    expect(text).toContain('Listening comprehension');
    expect(text).toContain('Continue to my plan');
  });

  it('completes directly when the first question is already complete (proficiency > 1, no strengths, no level)', async () => {
    mockNextQuestion.mockResolvedValue(next({ question: null, isComplete: true }));
    mockComplete.mockResolvedValue(
      completeResult(profile({ overallProficiency: 82, cefrLevel: undefined, strengths: [] })),
    );
    const tree = await renderScreen();

    expect(mockComplete).toHaveBeenCalledWith('sess-1');
    const text = allText(tree.toJSON());
    expect(text).toContain('82%'); // 82 (>1) rendered as-is
    expect(text).toContain('—'); // missing cefrLevel fallback
    expect(text).not.toContain('STRENGTHS');
  });

  it('renders 0% when the profile omits an overall proficiency', async () => {
    // overallProficiency null → the `?? 0` fallback in the percentage calc.
    mockNextQuestion.mockResolvedValue(next({ question: null, isComplete: true }));
    mockComplete.mockResolvedValue(
      completeResult(profile({ overallProficiency: null as unknown as number, cefrLevel: 'A1' })),
    );
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('OVERALL PROFICIENCY');
    expect(text).toContain('0%');
  });

  it('routes "Continue to my plan" back', async () => {
    mockNextQuestion.mockResolvedValue(next({ question: null, isComplete: true }));
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Continue to my plan'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('LanguageAssessmentScreen — status kind', () => {
  it('threads a checkpoint status kind through next/submit calls', async () => {
    mockGetStatus.mockResolvedValue(status({ kind: 'checkpoint', due: true }));
    mockNextQuestion
      .mockResolvedValueOnce(next({ question: tapQuestion(), questionNumber: 1 }))
      .mockResolvedValueOnce(next({ question: null, isComplete: true }));
    const tree = await renderScreen();

    expect(mockNextQuestion).toHaveBeenCalledWith('sess-1', 'checkpoint');
    act(() => pressByText(tree, 'Option Alpha'));
    await act(async () => {
      pressByText(tree, 'Submit');
    });
    expect(mockSubmitAnswer).toHaveBeenCalledWith(expect.objectContaining({ kind: 'checkpoint' }));
  });

  it('tolerates a failing getStatus (defaults kind to "initial")', async () => {
    mockGetStatus.mockRejectedValue(new Error('status down'));
    const tree = await renderScreen();
    expect(mockNextQuestion).toHaveBeenCalledWith('sess-1', 'initial');
    expect(allText(tree.toJSON())).toContain('Choose the correct article.');
  });
});

describe('LanguageAssessmentScreen — error handling', () => {
  it('shows the error state when boot fails, then recovers via Try again', async () => {
    mockStart.mockRejectedValueOnce(new Error('offline'));
    const tree = await renderScreen();

    expect(allText(tree.toJSON())).toContain(
      'Could not start the assessment. Check your connection and try again.',
    );

    // second boot succeeds
    mockStart.mockResolvedValue(start());
    await act(async () => {
      pressByText(tree, 'Try again');
    });
    expect(allText(tree.toJSON())).toContain('Choose the correct article.');
  });

  it('shows the submit error when submitAnswer rejects', async () => {
    mockSubmitAnswer.mockRejectedValue(new Error('submit failed'));
    const tree = await renderScreen();

    act(() => pressByText(tree, 'Option Alpha'));
    await act(async () => {
      pressByText(tree, 'Submit');
    });

    expect(allText(tree.toJSON())).toContain('Could not submit your answer. Please try again.');
  });

  it('stays in the preparing state when start returns no session id', async () => {
    // A malformed/failed session start (no sessionId) must not send a question
    // request against an undefined session — the screen holds the safe
    // preparing state instead of rendering a question it cannot submit.
    mockStart.mockResolvedValue(start({ sessionId: undefined as unknown as string }));
    const tree = await renderScreen();

    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockNextQuestion).not.toHaveBeenCalled();
    expect(hasTestId(tree, 'language-assessment-screen')).toBe(true);
    const text = allText(tree.toJSON());
    expect(text).toContain('Preparing your assessment…');
    expect(text).not.toContain('Submit');
  });

  it('errors out when the first question load fails', async () => {
    mockNextQuestion.mockRejectedValue(new Error('no questions'));
    const tree = await renderScreen();
    expect(hasTestId(tree, 'language-assessment-screen')).toBe(true);
    expect(allText(tree.toJSON())).toContain('Could not start the assessment');
  });
});

describe('LanguageAssessmentScreen — navigation', () => {
  it('routes the header back button', async () => {
    const tree = await renderScreen();
    act(() => tree.root.findByProps({ testID: 'hdr-back' }).props.onPress());
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('LanguageAssessmentScreen — iPad rendering', () => {
  it('mounts on iPad-class dimensions with the first question', async () => {
    mockWindow = IPAD;
    const tree = await renderScreen();
    expect(hasTestId(tree, 'language-assessment-screen')).toBe(true);
    expect(allText(tree.toJSON())).toContain('Choose the correct article.');
  });
});
