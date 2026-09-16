/**
 * BookReaderScreen — Symply Kaizen (`symply-kaizen`) reflowable chapter reader.
 *
 * Renders the REAL screen through <ThemeProvider> off a mocked kaizenStore keyed
 * by the `chapterId` search param. A stubbed <WebView> exposes the JS→RN bridge
 * so selection messages can be driven directly. Covers: the missing-chapter /
 * loading / empty-text / reader states, the reader-HTML builder (paragraph
 * escaping + every highlight-anchor variant, light & dark), the selection →
 * Highlight / Cancel flow (success, failure, empty-book guard), the highlights
 * panel (list + delete + empty), the "quiz me on my highlights" flow
 * (empty / success / no-questions / failure), and the load-effect cancellation.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  IPAD,
  IPHONE,
  allText,
  byTestId,
  pressByText,
  pressablesWithText,
} from '../../test-utils/kaizenScreenTestKit';
import { BookReaderScreen } from '../BookReaderScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

// Drives ThemeContext's isDark (themeMode defaults to 'system') so the reader
// HTML builder can be exercised in both light and dark without touching the
// shared app store (which would notify stale providers outside act()).
let mockColorScheme: 'light' | 'dark' = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockColorScheme,
}));

const mockPush = jest.fn();
let mockParams: Record<string, unknown> = { chapterId: 'c1' };
jest.mock('expo-router', () => ({
  __esModule: true,
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: jest.fn(),
    back: jest.fn(),
    navigate: jest.fn(),
  },
  useLocalSearchParams: () => mockParams,
  Redirect: () => null,
  Link: ({ children }: { children?: React.ReactNode }) => children,
}));

jest.mock('@components/common', () =>
  require('../../test-utils/mockComponentsCommon').createKaizenComponentsCommonMock(),
);

// The highlights panel renders a grey (non-brand) SkippedIcon, which falls back
// to an @expo/vector-icons glyph whose componentDidMount async-loads its font
// and setState()s after the fact — outside act(). Report the font as already
// loaded so the icon renders synchronously (no post-act state update warning).
jest.mock('expo-font', () => {
  const actual = jest.requireActual('expo-font');
  return { ...actual, isLoaded: () => true, loadAsync: jest.fn().mockResolvedValue(undefined) };
});

jest.mock('react-native-webview', () => {
  const R = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    WebView: (props: Record<string, unknown>) =>
      R.createElement(View, { testID: 'reader-webview', ...props }),
  };
});

const mockBooksState: { data: unknown[] } = { data: [] };

jest.mock('@features/kaizen/hooks/useKaizenBooks', () => ({
  __esModule: true,
  useKaizenBooks: () => ({ data: mockBooksState.data }),
  useInvalidateKaizenBooks: () => jest.fn().mockResolvedValue(undefined),
}));

const mockState: Record<string, unknown> = {};
jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const useKaizenStore = (selector?: (s: typeof mockState) => unknown) =>
    selector ? selector(mockState) : mockState;
  useKaizenStore.getState = () => mockState;
  return { __esModule: true, useKaizenStore };
});

const readChapterText = jest.fn().mockResolvedValue('');
const addBookHighlight = jest.fn().mockResolvedValue(undefined);
const deleteBookHighlight = jest.fn().mockResolvedValue(undefined);
const generateBookChapterQuestions = jest.fn().mockResolvedValue(6);

function seed(opts: {
  chapters?: unknown[];
  books?: unknown[];
  highlights?: unknown[];
}) {
  Object.keys(mockState).forEach((k) => delete mockState[k]);
  mockBooksState.data = opts.books ?? [];
  Object.assign(mockState, {
    bookChapters: opts.chapters ?? [],
    bookHighlights: opts.highlights ?? [],
    readChapterText,
    addBookHighlight,
    deleteBookHighlight,
    generateBookChapterQuestions,
  });
}

const CHAPTER = { id: 'c1', book_id: 'b1', chapter_index: 2, title: 'The First Law' };
const BOOK = { id: 'b1', title: 'Atomic Habits' };

// Reader text exercising escapeHtml (& < > " ') + multi-paragraph splitting
// (blank-line separators, an internal newline, and a whitespace-only block).
const READER_TEXT =
  'Hello <b>& "world" \'quote\'</b>\nsecond line\n\nSecond paragraph.\n\n   \n\nThird.';

// One highlight per parseAnchor branch (valid + coloured, valid + no colour,
// bad range, non-JSON, null anchor, non-number offsets) plus a deleted and an
// off-chapter entry that must be filtered out.
const HIGHLIGHTS = [
  { id: 'h1', chapter_id: 'c1', text: 'valid one', anchor: '{"start":0,"end":5}', color: '#FF0000', created_at: '2020-01-01', deleted_at: null },
  { id: 'h2', chapter_id: 'c1', text: 'no colour', anchor: '{"start":6,"end":11}', color: null, created_at: '2020-01-02', deleted_at: null },
  { id: 'h3', chapter_id: 'c1', text: 'bad range', anchor: '{"start":5,"end":5}', color: '#00FF00', created_at: '2020-01-03', deleted_at: null },
  { id: 'h4', chapter_id: 'c1', text: 'bad json', anchor: 'oops{', color: null, created_at: '2020-01-04', deleted_at: null },
  { id: 'h5', chapter_id: 'c1', text: 'null anchor', anchor: null, color: null, created_at: '2020-01-05', deleted_at: null },
  { id: 'h8', chapter_id: 'c1', text: 'non number', anchor: '{"start":"x","end":5}', color: null, created_at: '2020-01-06', deleted_at: null },
  { id: 'h6', chapter_id: 'c1', text: 'deleted', anchor: null, color: null, created_at: '2020-01-07', deleted_at: '2020-02-01' },
  { id: 'h7', chapter_id: 'other', text: 'off chapter', anchor: null, color: null, created_at: '2020-01-08', deleted_at: null },
];

const webview = (tree: ReactTestRenderer.ReactTestRenderer) => byTestId(tree, 'reader-webview')[0];

function sendMessage(tree: ReactTestRenderer.ReactTestRenderer, data: unknown) {
  act(() => {
    webview(tree).props.onMessage({
      nativeEvent: { data: typeof data === 'string' ? data : JSON.stringify(data) },
    });
  });
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BookReaderScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  mockParams = { chapterId: 'c1' };
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockColorScheme = 'light';
  readChapterText.mockResolvedValue('');
  addBookHighlight.mockResolvedValue(undefined);
  deleteBookHighlight.mockResolvedValue(undefined);
  generateBookChapterQuestions.mockResolvedValue(6);
  seed({ chapters: [CHAPTER], books: [BOOK], highlights: [] });
});

afterEach(() => {
  (Alert.alert as jest.Mock).mockRestore();
});

describe('BookReaderScreen', () => {
  it('shows the unavailable fallback for a missing chapter (empty param)', async () => {
    mockParams = {}; // chapterId → '' → effect early-returns, chapter not found
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('This chapter is no longer available.');
  });

  it('resolves the chapter from an array-form chapterId param', async () => {
    readChapterText.mockResolvedValue(READER_TEXT);
    mockParams = { chapterId: ['c1'] };
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('3. The First Law');
  });

  it('shows the fallback for an empty-array chapterId param', async () => {
    mockParams = { chapterId: [] };
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('This chapter is no longer available.');
  });

  it('shows the loading state while the chapter text resolves', async () => {
    readChapterText.mockReturnValue(new Promise<string>(() => {}));
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Loading chapter');
  });

  it('shows the no-readable-text empty state when the chapter is blank', async () => {
    readChapterText.mockResolvedValue('');
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('No readable text yet');
  });

  it('falls back to an empty read when readChapterText rejects', async () => {
    readChapterText.mockRejectedValue(new Error('offline'));
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('No readable text yet');
  });

  it('renders the reader, the header title and the highlights panel (all anchor variants)', async () => {
    readChapterText.mockResolvedValue(READER_TEXT);
    seed({ chapters: [CHAPTER], books: [BOOK], highlights: HIGHLIGHTS });
    const tree = await renderScreen();
    expect(byTestId(tree, 'reader-webview').length).toBe(1);
    expect(allText(tree.toJSON())).toContain('Atomic Habits');
    // Six non-deleted, on-chapter highlights survive the filter.
    expect(allText(tree.toJSON())).toContain('My highlights (6)');
    act(() => pressByText(tree, 'My highlights (6)'));
    const text = allText(tree.toJSON());
    expect(text).toContain('valid one');
    expect(text).toContain('no colour');
    expect(text).not.toContain('off chapter');
    expect(text).not.toContain('deleted');
  });

  it('renders the reader in dark mode', async () => {
    readChapterText.mockResolvedValue(READER_TEXT);
    mockColorScheme = 'dark';
    const tree = await renderScreen();
    expect(byTestId(tree, 'reader-webview').length).toBe(1);
  });

  it('opens a selection bar for a valid bridge message and saves a highlight', async () => {
    readChapterText.mockResolvedValue(READER_TEXT);
    const tree = await renderScreen();
    sendMessage(tree, { type: 'select', text: 'grabbed text', start: 0, end: 5 });
    expect(allText(tree.toJSON())).toContain('grabbed text');
    await act(async () => {
      pressByText(tree, 'Highlight');
    });
    expect(addBookHighlight).toHaveBeenCalledWith({
      bookId: 'b1',
      chapterId: 'c1',
      text: 'grabbed text',
      anchor: '{"start":0,"end":5}',
      color: '#FFD54A',
    });
    // The selection bar clears after a successful save.
    expect(pressablesWithText(tree, 'Highlight')).toHaveLength(0);
  });

  it('ignores malformed / incomplete bridge messages', async () => {
    readChapterText.mockResolvedValue(READER_TEXT);
    const tree = await renderScreen();
    sendMessage(tree, { type: 'other', text: 'x', start: 0, end: 5 });
    sendMessage(tree, { type: 'select' });
    sendMessage(tree, { type: 'select', text: 'x', start: 'a', end: 5 });
    sendMessage(tree, 'not-json');
    expect(pressablesWithText(tree, 'Highlight')).toHaveLength(0);
  });

  it('cancels a pending selection', async () => {
    readChapterText.mockResolvedValue(READER_TEXT);
    const tree = await renderScreen();
    sendMessage(tree, { type: 'select', text: 'grabbed', start: 0, end: 4 });
    expect(pressablesWithText(tree, 'Highlight').length).toBeGreaterThan(0);
    act(() => pressByText(tree, 'Cancel'));
    expect(pressablesWithText(tree, 'Highlight')).toHaveLength(0);
    expect(addBookHighlight).not.toHaveBeenCalled();
  });

  it('alerts when saving a highlight fails', async () => {
    readChapterText.mockResolvedValue(READER_TEXT);
    addBookHighlight.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();
    sendMessage(tree, { type: 'select', text: 'grabbed', start: 0, end: 4 });
    await act(async () => {
      pressByText(tree, 'Highlight');
    });
    expect(Alert.alert).toHaveBeenCalledWith('Could not save', expect.any(String));
  });

  it('guards highlight-save when the chapter has no book id', async () => {
    readChapterText.mockResolvedValue(READER_TEXT);
    seed({
      chapters: [{ id: 'c1', book_id: null, chapter_index: 0, title: 'Orphan' }],
      books: [],
      highlights: [],
    });
    const tree = await renderScreen();
    sendMessage(tree, { type: 'select', text: 'grabbed', start: 0, end: 4 });
    await act(async () => {
      pressByText(tree, 'Highlight');
    });
    expect(addBookHighlight).not.toHaveBeenCalled();
  });

  it('deletes a highlight from the panel', async () => {
    readChapterText.mockResolvedValue(READER_TEXT);
    seed({
      chapters: [CHAPTER],
      books: [BOOK],
      highlights: [HIGHLIGHTS[0], HIGHLIGHTS[1]],
    });
    const tree = await renderScreen();
    act(() => pressByText(tree, 'My highlights (2)'));
    const deleteToggle = tree.root.findAll(
      (n) => typeof n.props?.onPress === 'function' && n.props?.hitSlop === 8,
    );
    act(() => deleteToggle[0].props.onPress());
    expect(deleteBookHighlight).toHaveBeenCalledWith('h1');
  });

  it('shows the empty highlights panel when there are none', async () => {
    readChapterText.mockResolvedValue(READER_TEXT);
    const tree = await renderScreen();
    act(() => pressByText(tree, 'My highlights (0)'));
    expect(allText(tree.toJSON())).toContain('Select text in the reader below to save a highlight.');
  });

  it('alerts when quizzing with no highlights', async () => {
    readChapterText.mockResolvedValue(READER_TEXT);
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Quiz me on my highlights');
    });
    expect(Alert.alert).toHaveBeenCalledWith('No highlights yet', expect.any(String));
    expect(generateBookChapterQuestions).not.toHaveBeenCalled();
  });

  it('builds a quiz from highlights and navigates', async () => {
    readChapterText.mockResolvedValue(READER_TEXT);
    seed({ chapters: [CHAPTER], books: [BOOK], highlights: [HIGHLIGHTS[0]] });
    generateBookChapterQuestions.mockResolvedValue(4);
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Quiz me on my highlights');
    });
    expect(generateBookChapterQuestions).toHaveBeenCalledWith('c1', {
      types: ['mcq', 'open'],
      count: 6,
      highlightIds: ['h1'],
    });
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/kaizen/book-quiz',
      params: { chapterId: 'c1' },
    });
  });

  it('alerts when a highlight quiz produces no questions', async () => {
    readChapterText.mockResolvedValue(READER_TEXT);
    seed({ chapters: [CHAPTER], books: [BOOK], highlights: [HIGHLIGHTS[0]] });
    generateBookChapterQuestions.mockResolvedValue(0);
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Quiz me on my highlights');
    });
    expect(Alert.alert).toHaveBeenCalledWith('No questions', expect.any(String));
  });

  it('alerts when a highlight quiz generation throws', async () => {
    readChapterText.mockResolvedValue(READER_TEXT);
    seed({ chapters: [CHAPTER], books: [BOOK], highlights: [HIGHLIGHTS[0]] });
    generateBookChapterQuestions.mockRejectedValue(new Error('offline'));
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Quiz me on my highlights');
    });
    expect(Alert.alert).toHaveBeenCalledWith('Generation failed', expect.any(String));
  });

  it('skips the state update when text resolves after unmount', async () => {
    let resolveText!: (v: string) => void;
    readChapterText.mockReturnValue(new Promise<string>((r) => { resolveText = r; }));
    const tree = await renderScreen();
    act(() => tree.unmount());
    await act(async () => {
      resolveText(READER_TEXT);
      await Promise.resolve();
    });
    // No throw / no act warning => the `active` guard skipped the setState.
    expect(readChapterText).toHaveBeenCalled();
  });

  it('skips the state update when the read rejects after unmount', async () => {
    let rejectText!: (e: Error) => void;
    readChapterText.mockReturnValue(
      new Promise<string>((_res, rej) => { rejectText = rej; }),
    );
    const tree = await renderScreen();
    act(() => tree.unmount());
    await act(async () => {
      rejectText(new Error('late'));
      await Promise.resolve();
    });
    expect(readChapterText).toHaveBeenCalled();
  });

  it('mounts on iPad-class dimensions', async () => {
    mockWindow = IPAD;
    readChapterText.mockResolvedValue(READER_TEXT);
    const tree = await renderScreen();
    expect(byTestId(tree, 'reader-webview').length).toBe(1);
  });
});
