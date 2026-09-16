/**
 * QuestionImportScreen — Symply Kaizen (`symply-kaizen`) interview-question import.
 *
 * Renders the REAL screen through <ThemeProvider>, asserts the import form + empty
 * pending state, and drives paste → "Import for review" → importQuestionsFromText.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { router } from 'expo-router';
import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { fixtureText } from '../../../../test-utils/fixtures';
import {
  IPHONE,
  allText,
  drainMockRejection,
  flushMicrotasks,
  mockHandledRejection,
  pressByText,
  typeIn,
} from '../../test-utils/kaizenScreenTestKit';
import { QuestionImportScreen } from '../QuestionImportScreen';

// Real interview-question document from resourses/testing.
const TECH_QUESTIONS_TEXT = fixtureText('kaizen-questions-technical');

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

// A local factory REPLACES the expo-router stub in jest.setup.js wholesale, so
// every hook the screen reaches for has to be re-declared here — a missing one
// surfaces as "(0 , _expoRouter.useX) is not a function" at render.
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    __esModule: true,
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() },
    useRouter: () => ({
      push: jest.fn(),
      replace: jest.fn(),
      back: jest.fn(),
      navigate: jest.fn(),
      setParams: jest.fn(),
    }),
    useLocalSearchParams: () => ({}),
    // A mounted screen in a test is a focused screen: run the callback once.
    useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(() => cb(), [cb]),
    Redirect: () => null,
    Link: ({ children }: { children?: React.ReactNode }) => children,
  };
});

jest.mock('@components/common', () =>
  require('../../test-utils/mockComponentsCommon').createKaizenComponentsCommonMock(),
);

jest.mock('@components/cloud-storage', () => {
  const R = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    CloudFilePicker: () => R.createElement(View, { testID: 'cloud-file-picker' }),
  };
});

jest.mock('expo-document-picker', () => {
   
  const { pickerAsset } = require('../../../../test-utils/fixtures');
  return {
    __esModule: true,
    getDocumentAsync: jest.fn().mockResolvedValue({
      canceled: false,
      assets: [pickerAsset('kaizen-questions-technical')], // technical-questions.txt
    }),
  };
});

jest.mock('@services/image-picker-compat', () => ({
  __esModule: true,
  default: {
    openCamera: jest.fn(),
    openPicker: jest.fn(),
  },
}));

const mockReadUploadFileText = jest.fn();
jest.mock('@features/kaizen/upload/readUploadFileText', () => ({
  __esModule: true,
  readUploadFileText: (...args: unknown[]) => mockReadUploadFileText(...args),
}));

const mockQuestionsState = { questions: [] as unknown[] };

jest.mock('@features/kaizen/hooks/useKaizenInterviewQuestions', () => ({
  __esModule: true,
  useKaizenInterviewQuestions: () => ({ data: mockQuestionsState.questions }),
  useInvalidateKaizenInterviewQuestions: () => jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@stores/authStore', () => ({
  useAuthStore: (selector?: (s: { user: { id: string } | null }) => unknown) =>
    selector ? selector({ user: { id: 'u1' } }) : { user: { id: 'u1' } },
}));

jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const A = () => jest.fn().mockResolvedValue(undefined);
  const state = {
    importQuestionsFromText: jest.fn().mockResolvedValue(3),
    approveQuestion: A(),
    rejectQuestion: A(),
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
        <QuestionImportScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockQuestionsState.questions = [];
  state.importQuestionsFromText.mockResolvedValue(3);
  mockReadUploadFileText.mockResolvedValue(TECH_QUESTIONS_TEXT);
});

describe('QuestionImportScreen', () => {
  it('renders the import form and the empty pending-review state', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Import questions');
    expect(text).toContain('QUESTION TEXT');
    expect(text).toContain('No pending imports. Approved questions live in Question banks.');
  });

  it('imports pasted question text for review', async () => {
    const tree = await renderScreen();
    act(() => typeIn(tree, 'Tell me about a hard bug'));
    await act(async () => {
      pressByText(tree, 'Import for review');
    });
    expect(state.importQuestionsFromText).toHaveBeenCalledWith('Tell me about a hard bug');
    // 3 imported → the plural "questions" branch of the confirmation.
    expect(allText(tree.toJSON())).toContain('Imported 3 questions for review.');
  });

  it('renders the singular confirmation when exactly one question imports', async () => {
    state.importQuestionsFromText.mockResolvedValue(1);
    const tree = await renderScreen();
    act(() => typeIn(tree, 'One question'));
    await act(async () => {
      pressByText(tree, 'Import for review');
    });
    expect(allText(tree.toJSON())).toContain('Imported 1 question for review.');
  });

  it('imports question text from an uploaded file', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Upload File');
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockReadUploadFileText).toHaveBeenCalled();
    // The REAL uploaded document text is what reaches the store importer.
    expect(state.importQuestionsFromText).toHaveBeenCalledWith(TECH_QUESTIONS_TEXT);
    expect(TECH_QUESTIONS_TEXT).toContain('Technical Questions');
    expect(allText(tree.toJSON())).toContain('Imported 3 questions for review.');
  });

  it('keeps pasted text when importQuestionsFromText rejects', async () => {
    state.importQuestionsFromText.mockImplementationOnce(() => new Promise(() => undefined));
    const tree = await renderScreen();
    act(() => typeIn(tree, 'Tell me about a hard bug'));
    await act(async () => {
      pressByText(tree, 'Import for review');
      await flushMicrotasks();
    });
    expect(state.importQuestionsFromText).toHaveBeenCalledWith('Tell me about a hard bug');
    expect(allText(tree.toJSON())).not.toContain('Imported');
  });

  it('still invokes approve and reject when the store rejects', async () => {
    mockHandledRejection(state.approveQuestion);
    mockHandledRejection(state.rejectQuestion);
    mockQuestionsState.questions = [
      {
        id: 'q1',
        import_review_status: 'pending',
        prompt: 'Explain event loops',
        question_bank: 'JavaScript',
      },
    ];
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Approve');
      await flushMicrotasks();
      await drainMockRejection(state.approveQuestion);
    });
    await act(async () => {
      pressByText(tree, 'Reject');
      await flushMicrotasks();
      await drainMockRejection(state.rejectQuestion);
    });
    expect(state.approveQuestion).toHaveBeenCalledWith('q1');
    expect(state.rejectQuestion).toHaveBeenCalledWith('q1');
    expect(allText(tree.toJSON())).toContain('Explain event loops');
  });

  it('renders pending imports and approves / rejects each one', async () => {
    mockQuestionsState.questions = [
      {
        id: 'q1',
        import_review_status: 'pending',
        prompt: 'Explain event loops',
        question_bank: 'JavaScript',
      },
      // A non-pending question is filtered out of the review list.
      { id: 'q2', import_review_status: 'approved', prompt: 'Already in', question_bank: 'JavaScript' },
    ];
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Pending review (1)');
    expect(text).toContain('Explain event loops');
    expect(text).toContain('JavaScript');
    expect(text).not.toContain('Already in');

    act(() => pressByText(tree, 'Approve'));
    expect(state.approveQuestion).toHaveBeenCalledWith('q1');
    act(() => pressByText(tree, 'Reject'));
    expect(state.rejectQuestion).toHaveBeenCalledWith('q1');
  });

  it('opens the question banks from the footer button', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Open question banks'));
    expect(router.push).toHaveBeenCalledWith('/kaizen/banks');
  });
});
