/**
 * QuestionBanksScreen — Symply Kaizen (`symply-kaizen`) approved-question banks.
 *
 * Renders the REAL screen through <ThemeProvider>, asserts the technical /
 * behavioral bank pickers + add form, and drives "Start practice" → router.push.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';


import { ThemeProvider } from '@contexts/ThemeContext';


import {
  IPHONE,
  IPAD,
  allText,
  drainMockRejection,
  flushMicrotasks,
  mockHandledRejection,
  pressByText,
  pressablesWithText,
  textInputs,
  typeIn,
} from '../../test-utils/kaizenScreenTestKit';
import { QuestionBanksScreen } from '../QuestionBanksScreen';

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

jest.mock('@components/cloud-storage', () => {
  const R = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    CloudFilePicker: () => R.createElement(View, { testID: 'cloud-file-picker' }),
  };
});

jest.mock('expo-document-picker', () => ({
  __esModule: true,
  getDocumentAsync: jest.fn().mockResolvedValue({
    canceled: false,
    assets: [
      {
        uri: 'file:///tmp/questions.txt',
        name: 'questions.txt',
        mimeType: 'text/plain',
        size: 400,
      },
    ],
  }),
}));

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

const rqState = {
  questions: [] as unknown[],
};

jest.mock('@features/kaizen/hooks/useKaizenInterviewQuestions', () => ({
  __esModule: true,
  useKaizenInterviewQuestions: () => ({ data: rqState.questions }),
}));

jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const A = () => jest.fn().mockResolvedValue(undefined);
  const state = {
    questions: [],
    addInterviewQuestion: A(),
    generateIdealAnswerForQuestion: A(),
    importQuestionsFromText: jest.fn().mockResolvedValue(2),
  };
  const useKaizenStore = (sel?: (value: typeof state) => unknown) => (sel ? sel(state) : state);
  useKaizenStore.getState = () => state;
  useKaizenStore.setState = (p: Partial<typeof state> | ((value: typeof state) => Partial<typeof state>)) => Object.assign(state, typeof p === 'function' ? p(state) : p);
  return { __esModule: true, useKaizenStore, __state: state };
});

 
const { __state: state } = require('@features/kaizen/stores/kaizenStore');

function syncRqState() {
  rqState.questions = state.questions;
}

/** Press the innermost pressable whose subtree text contains `text`. */
function pressInner(tree: ReactTestRenderer.ReactTestRenderer, text: string) {
  const matches = pressablesWithText(tree, text);
  matches[matches.length - 1].props.onPress();
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ThemeProvider>
          <QuestionBanksScreen />
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  state.questions = [];
  syncRqState();
  mockReadUploadFileText.mockResolvedValue('Explain CAP?\nDescribe leadership?');
  state.addInterviewQuestion.mockResolvedValue(undefined);
  state.generateIdealAnswerForQuestion.mockResolvedValue(undefined);
  state.importQuestionsFromText.mockResolvedValue(2);
});

describe('QuestionBanksScreen', () => {
  it('renders the practice hero, add form, and both bank pickers', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Question banks');
    expect(text).toContain('ADD QUESTION');
    expect(text).toContain('Technical');
    expect(text).toContain('Behavioral');
  });

  it('opens the practice session when "Start practice" is pressed', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Start practice'));
    expect(router.push).toHaveBeenCalledWith('/kaizen/practice');
  });

  it('adds a technical question from the form', async () => {
    const tree = await renderScreen();
    act(() => typeIn(tree, 'Explain CAP theorem'));
    await act(async () => {
      pressByText(tree, 'Add question');
    });
    expect(state.addInterviewQuestion).toHaveBeenCalledWith('Explain CAP theorem', 'technical');
  });

  it('adds to the behavioral bank after selecting it', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Behavioral'));
    act(() => typeIn(tree, 'Tell me about a conflict'));
    await act(async () => {
      pressByText(tree, 'Add question');
    });
    expect(state.addInterviewQuestion).toHaveBeenCalledWith('Tell me about a conflict', 'behavioral');
  });

  it('switches back to the technical bank', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Behavioral'));
    act(() => pressByText(tree, 'Technical'));
    act(() => typeIn(tree, 'Design a cache'));
    await act(async () => {
      pressByText(tree, 'Add question');
    });
    expect(state.addInterviewQuestion).toHaveBeenCalledWith('Design a cache', 'technical');
  });

  it('ignores an empty add', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Add question');
    });
    expect(state.addInterviewQuestion).not.toHaveBeenCalled();
  });

  it('keeps the prompt when adding a question fails', async () => {
    mockHandledRejection(state.addInterviewQuestion);
    const tree = await renderScreen();
    act(() => typeIn(tree, 'Explain CAP theorem'));
    await act(async () => {
      pressByText(tree, 'Add question');
      await flushMicrotasks();
      await drainMockRejection(state.addInterviewQuestion);
    });
    expect(state.addInterviewQuestion).toHaveBeenCalledWith('Explain CAP theorem', 'technical');
    expect(textInputs(tree)[0].props.value).toBe('Explain CAP theorem');
  });

  it('imports a question file from the upload panel and routes to review', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Upload File');
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockReadUploadFileText).toHaveBeenCalled();
    expect(state.importQuestionsFromText).toHaveBeenCalledWith('Explain CAP?\nDescribe leadership?');
    expect(router.push).toHaveBeenCalledWith('/kaizen/question-import');
  });

  it('navigates to the import screen from the import link', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Import questions'));
    expect(router.push).toHaveBeenCalledWith('/kaizen/question-import');
  });

  it('renders the pending-review section and opens it for approval', async () => {
    state.questions = [
      {
        id: 'p1',
        prompt: 'Pending question',
        question_bank: 'technical',
        import_review_status: 'pending',
        due_at: null,
        ideal_answer: null,
      },
    ];
    syncRqState();
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Pending review (1)');
    expect(text).toContain('1 imported questions need approval');
    act(() => pressByText(tree, 'imported questions need approval'));
    expect(router.push).toHaveBeenCalledWith('/kaizen/question-import');
    act(() => pressByText(tree, 'Review'));
    expect(router.push).toHaveBeenCalledWith('/kaizen/question-import');
  });

  it('renders approved questions with due badges and drives their row actions', async () => {
    state.questions = [
      {
        id: 'a1',
        prompt: 'Due approved question',
        question_bank: 'technical',
        import_review_status: 'approved',
        due_at: '2020-01-01T00:00:00.000Z',
        ideal_answer: 'existing answer',
      },
      {
        id: 'a2',
        prompt: 'Unscheduled approved question',
        question_bank: 'behavioral',
        import_review_status: 'approved',
        due_at: null,
        ideal_answer: null,
      },
      {
        id: 'a3',
        prompt: 'Future approved question',
        question_bank: 'technical',
        import_review_status: 'approved',
        due_at: '2999-01-01T00:00:00.000Z',
        ideal_answer: null,
      },
    ];
    syncRqState();
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('1 due · 3 approved');
    expect(text).toContain('Due approved question');
    expect(text).toContain('Unscheduled approved question');
    expect(text).toContain('Refresh ideal');
    expect(text).toContain('Ideal answer');
    expect(text).toContain('not scheduled');

    // Row press → practice for that specific question.
    act(() => pressByText(tree, 'Due approved question'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/kaizen/practice',
      params: { questionId: 'a1' },
    });

    // Inner "Refresh ideal" button (only a1 has a saved ideal answer) → generate ideal answer.
    act(() => pressInner(tree, 'Refresh ideal'));
    expect(state.generateIdealAnswerForQuestion).toHaveBeenCalledWith('a1');
  });

  it('generates an ideal answer from the Ideal answer link', async () => {
    state.questions = [
      {
        id: 'a2',
        prompt: 'Unscheduled approved question',
        question_bank: 'behavioral',
        import_review_status: 'approved',
        due_at: null,
        ideal_answer: null,
      },
    ];
    syncRqState();
    const tree = await renderScreen();
    act(() => pressInner(tree, 'Ideal answer'));
    expect(state.generateIdealAnswerForQuestion).toHaveBeenCalledWith('a2');
  });

  it('opens practice from the inner Practice link on a row', async () => {
    state.questions = [
      {
        id: 'a3',
        prompt: 'Future approved question',
        question_bank: 'technical',
        import_review_status: 'approved',
        due_at: '2999-01-01T00:00:00.000Z',
        ideal_answer: null,
      },
    ];
    syncRqState();
    const tree = await renderScreen();
    act(() => pressInner(tree, 'Practice'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/kaizen/practice',
      params: { questionId: 'a3' },
    });
  });

  it('still invokes generateIdealAnswerForQuestion when it rejects', async () => {
    mockHandledRejection(state.generateIdealAnswerForQuestion);
    state.questions = [
      {
        id: 'a1',
        prompt: 'Needs ideal',
        question_bank: 'technical',
        import_review_status: 'approved',
        due_at: null,
        ideal_answer: null,
      },
    ];
    syncRqState();
    const tree = await renderScreen();
    await act(async () => {
      pressInner(tree, 'Ideal answer');
      await flushMicrotasks();
      await drainMockRejection(state.generateIdealAnswerForQuestion);
    });
    expect(state.generateIdealAnswerForQuestion).toHaveBeenCalledWith('a1');
    expect(allText(tree.toJSON())).toContain('Needs ideal');
  });

  it('shows the empty approved-questions state', async () => {
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Imported and generated questions will appear here.');
  });

  it('mounts on iPad-class dimensions with the same content', async () => {
    mockWindow = IPAD;
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Question banks');
  });
});
