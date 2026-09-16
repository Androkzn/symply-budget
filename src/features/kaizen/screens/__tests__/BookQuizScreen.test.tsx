/**
 * BookQuizScreen — Symply Kaizen (`symply-kaizen`) comprehension check.
 *
 * Renders the REAL screen through <ThemeProvider> off a mocked kaizenStore keyed
 * by the `chapterId` search param, with a stubbed VoiceRecordingService. Covers
 * every question type (mcq / open / spoken) and mode: the empty & completed
 * states, mcq select → grade (correct / wrong / unanswered), open grading with
 * mistakes, spoken record → submit and the type-instead fallback, spoken result
 * (transcription + pronunciation, problem-words vs "clear"), permission /
 * start / stop edge cases, per-question advance, and unmount cleanup.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import { VoiceRecordingService } from '@services/voice-recording';

import { IPAD, IPHONE, allText, flushMicrotasks, mockHandledRejection, pressByText } from '../../test-utils/kaizenScreenTestKit';
import { BookQuizScreen } from '../BookQuizScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const mockBack = jest.fn();
let mockParams: Record<string, unknown> = { chapterId: 'c1' };
jest.mock('expo-router', () => ({
  __esModule: true,
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: (...args: unknown[]) => mockBack(...args),
    navigate: jest.fn(),
  },
  useLocalSearchParams: () => mockParams,
  Redirect: () => null,
  Link: ({ children }: { children?: React.ReactNode }) => children,
}));

jest.mock('@components/common', () =>
  require('../../test-utils/mockComponentsCommon').createKaizenComponentsCommonMock(),
);

jest.mock('@services/voice-recording', () => ({
  __esModule: true,
  VoiceRecordingService: {
    requestPermission: jest.fn().mockResolvedValue(true),
    startRecording: jest.fn().mockResolvedValue(true),
    stopRecording: jest.fn().mockResolvedValue({ uri: 'file:///rec.m4a', duration: 3 }),
    cancelRecording: jest.fn().mockResolvedValue(undefined),
    playVoiceNote: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockState: Record<string, unknown> = {};
jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const useKaizenStore = (selector?: (s: typeof mockState) => unknown) =>
    selector ? selector(mockState) : mockState;
  useKaizenStore.getState = () => mockState;
  return { __esModule: true, useKaizenStore };
});

const submitBookAttempt = jest.fn().mockResolvedValue(undefined);
const submitSpokenBookAttempt = jest.fn().mockResolvedValue(undefined);

function seed(questions: unknown[], attempts: unknown[] = []) {
  Object.keys(mockState).forEach((k) => delete mockState[k]);
  Object.assign(mockState, {
    bookQuestions: questions,
    bookAttempts: attempts,
    submitBookAttempt,
    submitSpokenBookAttempt,
  });
}

const voice = VoiceRecordingService as unknown as Record<string, jest.Mock>;

const textInputs = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll((n) => String(n.type) === 'TextInput');

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BookQuizScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

const mcq = (over: Record<string, unknown> = {}) => ({
  id: 'qm',
  chapter_id: 'c1',
  type: 'mcq',
  prompt: 'Which law?',
  options: '["Alpha","Bravo","Charlie","Delta"]',
  answer_index: 1,
  created_at: '2020-01-01',
  deleted_at: null,
  ...over,
});

const open = (over: Record<string, unknown> = {}) => ({
  id: 'qo',
  chapter_id: 'c1',
  type: 'open',
  prompt: 'Explain the concept.',
  options: null,
  created_at: '2020-01-01',
  deleted_at: null,
  ...over,
});

const spoken = (over: Record<string, unknown> = {}) => ({
  id: 'qs',
  chapter_id: 'c1',
  type: 'spoken',
  prompt: 'Say the concept.',
  options: null,
  created_at: '2020-01-01',
  deleted_at: null,
  ...over,
});

beforeEach(() => {
  mockWindow = IPHONE;
  mockParams = { chapterId: 'c1' };
  jest.clearAllMocks();
  voice.requestPermission.mockResolvedValue(true);
  voice.startRecording.mockResolvedValue(true);
  voice.stopRecording.mockResolvedValue({ uri: 'file:///rec.m4a', duration: 3 });
  voice.cancelRecording.mockResolvedValue(undefined);
  voice.playVoiceNote.mockResolvedValue(undefined);
  submitBookAttempt.mockResolvedValue(undefined);
  submitSpokenBookAttempt.mockResolvedValue(undefined);
});

describe('BookQuizScreen', () => {
  it('shows the empty state when the chapter has no questions', async () => {
    seed([]);
    mockParams = {}; // chapterId → '' → no questions match
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('No questions yet');
  });

  it('resolves questions from an array-form chapterId param', async () => {
    seed([mcq()]);
    mockParams = { chapterId: ['c1'] };
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Which law?');
  });

  it('shows the empty state for an empty-array chapterId param', async () => {
    seed([mcq()]);
    mockParams = { chapterId: [] };
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('No questions yet');
  });

  it('tolerates malformed option JSON (parse fallback to no options)', async () => {
    seed([mcq({ options: 'not-json{' })]);
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Multiple choice');
  });

  it('grades a wrong mcq pick and reveals the correct answer', async () => {
    seed([mcq()], [
      { id: 'a1', question_id: 'qm', is_correct: 0, feedback: 'Review chapter 2.', created_at: '2020-01-01' },
    ]);
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Multiple choice');
    expect(text).toContain('Which law?');
    expect(text).toContain('Question 1 of 1');
    act(() => pressByText(tree, 'Alpha'));
    await act(async () => {
      pressByText(tree, 'Submit answer');
    });
    expect(submitBookAttempt).toHaveBeenCalledWith('qm', { selectedIndex: 0 });
    const revealed = allText(tree.toJSON());
    expect(revealed).toContain('Not quite');
    expect(revealed).toContain('Review chapter 2.');
    expect(revealed).toContain('✓');
    expect(revealed).toContain('✕');
  });

  it('grades a correct mcq pick', async () => {
    seed([mcq()], [{ id: 'a2', question_id: 'qm', is_correct: 1, created_at: '2020-01-01' }]);
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Bravo'));
    await act(async () => {
      pressByText(tree, 'Submit answer');
    });
    expect(submitBookAttempt).toHaveBeenCalledWith('qm', { selectedIndex: 1 });
    expect(allText(tree.toJSON())).toContain('Correct');
  });

  it('defaults an unanswered mcq submission to index -1', async () => {
    seed([mcq()]);
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Submit answer');
    });
    expect(submitBookAttempt).toHaveBeenCalledWith('qm', { selectedIndex: -1 });
  });

  it('grades an open answer and lists the mistakes to work on', async () => {
    seed(
      [open()],
      [
        {
          id: 'a3',
          question_id: 'qo',
          content_score: 0.8,
          overall_score: 0.75,
          feedback: 'Solid explanation.',
          mistakes: JSON.stringify([
            { type: 'grammar', text: 'go', correction: 'went', explanation: 'past tense' },
            { type: 'vocab', text: 'big' },
          ]),
          created_at: '2020-01-01',
        },
      ],
    );
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Open answer');
    act(() => textInputs(tree)[0].props.onChangeText('It compounds over time'));
    await act(async () => {
      pressByText(tree, 'Submit answer');
    });
    expect(submitBookAttempt).toHaveBeenCalledWith('qo', { answerText: 'It compounds over time' });
    const text = allText(tree.toJSON());
    expect(text).toContain('Understanding: 80%');
    expect(text).toContain('Overall: 75%');
    expect(text).toContain('Solid explanation.');
    expect(text).toContain('THINGS TO WORK ON');
    expect(text).toContain('went');
    expect(text).toContain('past tense');
    expect(text).toContain('big');
  });

  it('reveals an open answer with null scores and no feedback/mistakes', async () => {
    seed(
      [open()],
      [
        {
          id: 'a4',
          question_id: 'qo',
          content_score: null,
          overall_score: null,
          feedback: null,
          mistakes: null,
          created_at: '2020-01-01',
        },
      ],
    );
    const tree = await renderScreen();
    act(() => textInputs(tree)[0].props.onChangeText('An answer'));
    await act(async () => {
      pressByText(tree, 'Submit answer');
    });
    const text = allText(tree.toJSON());
    expect(text).toContain('Understanding: 0%');
    expect(text).toContain('Overall: 0%');
    expect(text).not.toContain('THINGS TO WORK ON');
  });

  it('reveals the most recent attempt when several exist for a question', async () => {
    seed(
      [open()],
      [
        { id: 'old', question_id: 'qo', content_score: 0.4, overall_score: 0.4, created_at: '2020-01-01T00:00:00Z' },
        { id: 'new', question_id: 'qo', content_score: 0.9, overall_score: 0.9, created_at: '2020-06-01T00:00:00Z' },
      ],
    );
    const tree = await renderScreen();
    act(() => textInputs(tree)[0].props.onChangeText('An answer'));
    await act(async () => {
      pressByText(tree, 'Submit answer');
    });
    const text = allText(tree.toJSON());
    expect(text).toContain('Understanding: 90%');
    expect(text).not.toContain('Understanding: 40%');
  });

  it('records a spoken answer, submits it, and shows the pronunciation breakdown', async () => {
    seed(
      [spoken({ id: 'qs1' })],
      [
        {
          id: 'a5',
          question_id: 'qs1',
          content_score: 0.9,
          overall_score: 0.85,
          feedback: 'Clear delivery.',
          transcription: 'It compounds over time',
          mistakes: null,
          pronunciation: JSON.stringify({
            overall_score: 0.9,
            words: [
              { word: 'compounds', score: 0.4, is_problem: true, tip: 'slow down' },
              { word: 'over', score: 0.5, is_problem: true },
              { word: 'time', score: 0.95, is_problem: false },
            ],
          }),
          created_at: '2020-01-01',
        },
      ],
    );
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Speak your answer');

    await act(async () => {
      pressByText(tree, 'Record answer');
    });
    expect(voice.startRecording).toHaveBeenCalled();
    expect(allText(tree.toJSON())).toContain('Recording');

    await act(async () => {
      pressByText(tree, 'Stop');
    });
    const recorded = allText(tree.toJSON());
    expect(recorded).toContain('Recorded answer');
    expect(recorded).toContain('Play');
    expect(recorded).toContain('Re-record');

    act(() => pressByText(tree, 'Play'));
    expect(voice.playVoiceNote).toHaveBeenCalledWith('file:///rec.m4a');

    await act(async () => {
      pressByText(tree, 'Submit answer');
    });
    expect(submitSpokenBookAttempt).toHaveBeenCalledWith('qs1', {
      uri: 'file:///rec.m4a',
      durationMs: 3000,
    });
    const revealed = allText(tree.toJSON());
    expect(revealed).toContain('Understanding: 90%');
    expect(revealed).toContain('Overall: 85%');
    expect(revealed).toContain('You said:');
    expect(revealed).toContain('PRONUNCIATION');
    expect(revealed).toContain('90%');
    expect(revealed).toContain('compounds');
    expect(revealed).toContain('slow down');
  });

  it('re-records a spoken answer after stopping', async () => {
    seed([spoken({ id: 'qs1' })]);
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Record answer');
    });
    await act(async () => {
      pressByText(tree, 'Stop');
    });
    await act(async () => {
      pressByText(tree, 'Re-record');
    });
    expect(voice.startRecording).toHaveBeenCalledTimes(2);
    // Stop again so the elapsed-timer interval is cleared before teardown.
    await act(async () => {
      pressByText(tree, 'Stop');
    });
  });

  it('answers a spoken question by typing instead, showing a clear pronunciation result', async () => {
    seed(
      [spoken({ id: 'qs2' })],
      [
        {
          id: 'a6',
          question_id: 'qs2',
          content_score: 0.7,
          overall_score: 0.7,
          transcription: 'typed instead',
          mistakes: null,
          pronunciation: JSON.stringify({ words: [{ word: 'ok', score: 0.9, is_problem: false }] }),
          created_at: '2020-01-01',
        },
      ],
    );
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Type instead'));
    expect(allText(tree.toJSON())).toContain('Record instead');
    act(() => textInputs(tree)[0].props.onChangeText('typed spoken answer'));
    await act(async () => {
      pressByText(tree, 'Submit answer');
    });
    expect(submitBookAttempt).toHaveBeenCalledWith('qs2', { answerText: 'typed spoken answer' });
    const text = allText(tree.toJSON());
    expect(text).toContain('PRONUNCIATION');
    expect(text).toContain('Clear pronunciation');
    // No numeric pronunciation score => no "· NN%" suffix on the heading.
    expect(text).not.toContain('PRONUNCIATION ·');
  });

  it('cancels an active recording when switching to typing', async () => {
    seed([spoken({ id: 'qs3' })]);
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Record answer');
    });
    expect(allText(tree.toJSON())).toContain('Recording');
    act(() => pressByText(tree, 'Type instead'));
    expect(voice.cancelRecording).toHaveBeenCalled();
    expect(textInputs(tree).length).toBeGreaterThan(0);
  });

  it('does not start recording when microphone permission is denied', async () => {
    voice.requestPermission.mockResolvedValueOnce(false);
    seed([spoken({ id: 'qs4' })]);
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Record answer');
    });
    expect(voice.startRecording).not.toHaveBeenCalled();
    expect(allText(tree.toJSON())).not.toContain('Recording');
  });

  it('does nothing when the recorder fails to start', async () => {
    voice.startRecording.mockResolvedValueOnce(false);
    seed([spoken({ id: 'qs5' })]);
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Record answer');
    });
    expect(allText(tree.toJSON())).not.toContain('Recording');
  });

  it('keeps the record button when stopping yields no clip', async () => {
    voice.stopRecording.mockResolvedValueOnce(null);
    seed([spoken({ id: 'qs6' })]);
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Record answer');
    });
    await act(async () => {
      pressByText(tree, 'Stop');
    });
    const text = allText(tree.toJSON());
    expect(text).toContain('Record answer');
    expect(text).not.toContain('Recorded answer');
  });

  it('advances through multiple questions and finishes on the completion screen', async () => {
    seed(
      [open({ id: 'q1', prompt: 'First?' }), open({ id: 'q2', prompt: 'Second?' })],
      [
        { id: 'at1', question_id: 'q1', content_score: 0.6, overall_score: 0.6, created_at: '2020-01-01' },
        { id: 'at2', question_id: 'q2', content_score: 0.9, overall_score: 0.9, created_at: '2020-01-01' },
      ],
    );
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Question 1 of 2');

    act(() => textInputs(tree)[0].props.onChangeText('answer one'));
    await act(async () => {
      pressByText(tree, 'Submit answer');
    });
    // Not the last question yet → "Next question".
    act(() => pressByText(tree, 'Next question'));
    expect(allText(tree.toJSON())).toContain('Question 2 of 2');
    expect(allText(tree.toJSON())).toContain('Second?');

    act(() => textInputs(tree)[0].props.onChangeText('answer two'));
    await act(async () => {
      pressByText(tree, 'Submit answer');
    });
    // Last question → "Finish" → completion screen.
    act(() => pressByText(tree, 'Finish'));
    expect(allText(tree.toJSON())).toContain('You answered all 2 questions.');

    act(() => pressByText(tree, 'Back to book'));
    expect(mockBack).toHaveBeenCalled();
  });

  it('ticks the elapsed timer while recording', async () => {
    jest.useFakeTimers();
    try {
      seed([spoken({ id: 'qsT' })]);
      const tree = await renderScreen();
      await act(async () => {
        pressByText(tree, 'Record answer');
      });
      // Fire the 200ms elapsed-timer interval callback.
      act(() => {
        jest.advanceTimersByTime(200);
      });
      expect(allText(tree.toJSON())).toContain('Recording');
      await act(async () => {
        pressByText(tree, 'Stop');
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('cleans up the timer on unmount while recording', async () => {
    seed([spoken({ id: 'qs7' })]);
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Record answer');
    });
    act(() => tree.unmount());
    expect(voice.cancelRecording).toHaveBeenCalled();
  });

  it('unmounts cleanly when not recording', async () => {
    seed([mcq()]);
    const tree = await renderScreen();
    act(() => tree.unmount());
    expect(voice.cancelRecording).toHaveBeenCalled();
  });

  it('mounts on iPad-class dimensions', async () => {
    mockWindow = IPAD;
    seed([mcq()]);
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Which law?');
  });

  it('does not reveal feedback when submitBookAttempt rejects', async () => {
    mockHandledRejection(submitBookAttempt);
    seed([mcq()]);
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Bravo'));
    await act(async () => {
      pressByText(tree, 'Submit answer');
      await flushMicrotasks();
    });
    expect(submitBookAttempt).toHaveBeenCalled();
    const text = allText(tree.toJSON());
    expect(text).not.toContain('Correct');
    expect(text).not.toContain('Not quite');
    expect(text).toContain('Submit answer');
  });

  it('does not reveal feedback when submitSpokenBookAttempt rejects', async () => {
    mockHandledRejection(submitSpokenBookAttempt);
    seed([spoken({ id: 'qsFail' })]);
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Record answer');
    });
    await act(async () => {
      pressByText(tree, 'Stop');
    });
    await act(async () => {
      pressByText(tree, 'Submit answer');
      await flushMicrotasks();
    });
    expect(submitSpokenBookAttempt).toHaveBeenCalled();
    expect(allText(tree.toJSON())).not.toContain('Understanding:');
  });
});
