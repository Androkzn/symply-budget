/**
 * BookDetailScreen — Symply Kaizen (`symply-kaizen`) single-book detail.
 *
 * Renders the REAL screen through <ThemeProvider> off a mocked kaizenStore keyed
 * by the `bookId` search param, and covers: the missing-book fallback, the
 * PDF-attached vs attach-source cards, the chapter rows (read/unread ·
 * questions/no-questions), read-toggle → markRead, Read/Check navigation,
 * Generate (success / no-questions / failure), device + Google-Drive PDF attach
 * (incl. upload-failure Alert), and the delete-book confirmation.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';


import { ThemeProvider } from '@contexts/ThemeContext';

import {
  IPAD,
  IPHONE,
  allText,
  byTestId,
  flushMicrotasks,
  instanceText,
  pressByText,
  mockHandledRejection,
} from '../../test-utils/kaizenScreenTestKit';
import { BookDetailScreen } from '../BookDetailScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

jest.mock('@config/env', () => ({
  ENV: {
    API_BASE_URL: 'https://api.test',
    TIMEOUTS: { API_REQUEST: 10000 },
    GOOGLE_DRIVE_OAUTH: {
      IOS_CLIENT_ID: 'test-ios',
      ANDROID_CLIENT_ID: 'test-android',
      WEB_CLIENT_ID: 'test-web',
    },
  },
}));

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, unknown> = { bookId: 'b1' };
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

jest.mock('@components/common', () =>
  require('../../test-utils/mockComponentsCommon').createKaizenComponentsCommonMock(),
);

const mockDocResult: { value: unknown } = { value: { canceled: true } };
jest.mock('expo-document-picker', () => ({
  __esModule: true,
  getDocumentAsync: jest.fn(async () => mockDocResult.value),
}));

const mockState: Record<string, unknown> = {};

jest.mock('@features/kaizen/upload/KaizenImportUploadSection', () => {
  const R = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    KaizenImportUploadSection: ({
      onImported,
    }: {
      onImported?: (result: { uri?: string; name?: string; bookId?: string }) => void;
    }) =>
      R.createElement(
        View,
        { testID: 'kaizen-import-upload-section' },
        R.createElement(
          Pressable,
          {
            onPress: () =>
              onImported?.({
                bookId: 'book-1',
              }),
          },
          R.createElement(Text, null, 'MockUploadFile'),
        ),
        R.createElement(
          Pressable,
          {
            onPress: () =>
              onImported?.({
                resumeText: 'resume file text',
                resumeSummary: 'Summary',
              } as never),
          },
          R.createElement(Text, null, 'MockUploadDrive'),
        ),
      ),
    importPanelConfig: {
      book: { title: 'Book', hint: '', accept: [] },
    },
  };
});

jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const useKaizenStore = (selector?: (s: typeof mockState) => unknown) =>
    selector ? selector(mockState) : mockState;
  useKaizenStore.getState = () => mockState;
  return { __esModule: true, useKaizenStore };
});

jest.mock('@features/kaizen/hooks/useKaizenBooks', () => ({
  useKaizenBooks: () => ({ data: (mockState.books as unknown[]) ?? [], isLoading: false }),
  useInvalidateKaizenBooks: () => jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@features/kaizen/hooks/useKaizenBookChapters', () => ({
  useKaizenBookChapters: () => ({
    data: (mockState.bookChapters as unknown[]) ?? [],
    isLoading: false,
  }),
  useInvalidateKaizenBookChapters: () => jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@stores/authStore', () => ({
  useAuthStore: (selector?: (s: { user: { id: string } | null }) => unknown) => {
    const state = { user: { id: 'u1' } };
    return selector ? selector(state) : state;
  },
}));

const generateBookChapterQuestions = jest.fn().mockResolvedValue(6);
const markBookChapterRead = jest.fn().mockResolvedValue(undefined);
const deleteBook = jest.fn().mockResolvedValue(undefined);
const attachBookFile = jest.fn().mockResolvedValue(undefined);

function seed(opts: {
  books?: unknown[];
  chapters?: unknown[];
  bookQuestions?: unknown[];
}) {
  const chapters = opts.chapters ?? [];
  Object.keys(mockState).forEach((k) => delete mockState[k]);
  Object.assign(mockState, {
    books: opts.books ?? [],
    bookChapters: chapters,
    getBookChapters: jest.fn(() => chapters),
    bookQuestions: opts.bookQuestions ?? [],
    generateBookChapterQuestions,
    markBookChapterRead,
    deleteBook,
    attachBookFile,
  });
}

const drivePicker = (tree: ReactTestRenderer.ReactTestRenderer) =>
  byTestId(tree, 'kaizen-import-upload-section')[0];

/** The read-toggle Pressable (icon-only, hitSlop 8, no "Delete book" text). */
function pressReadToggle(tree: ReactTestRenderer.ReactTestRenderer, i = 0) {
  const toggles = tree.root.findAll(
    (n) =>
      typeof n.props?.onPress === 'function' &&
      n.props?.hitSlop === 8 &&
      !instanceText(n).includes('Delete book'),
  );
  toggles[i].props.onPress();
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ThemeProvider>
          <BookDetailScreen />
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  return tree;
}

const flush = () => act(async () => { await Promise.resolve(); });

const POPULATED = {
  books: [
    {
      id: 'b1',
      title: 'Atomic Habits',
      author: 'James Clear',
      language: 'en',
      source_type: 'toc_only',
    },
  ],
  chapters: [
    { id: 'c1', book_id: 'b1', chapter_index: 0, title: 'Intro', read_at: '2020-01-01' },
    { id: 'c2', book_id: 'b1', chapter_index: 1, title: 'Deep Dive', read_at: null },
  ],
  bookQuestions: [
    { id: 'q1', chapter_id: 'c1', deleted_at: null },
    { id: 'q2', chapter_id: 'c1', deleted_at: null },
    { id: 'qDel', chapter_id: 'c1', deleted_at: '2020-01-01' },
  ],
};

beforeEach(() => {
  mockWindow = IPHONE;
  mockParams = { bookId: 'b1' };
  mockDocResult.value = { canceled: true };
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  generateBookChapterQuestions.mockResolvedValue(6);
  attachBookFile.mockResolvedValue(undefined);
  deleteBook.mockResolvedValue(undefined);
  seed(POPULATED);
});

afterEach(() => {
  (Alert.alert as jest.Mock).mockRestore();
});

describe('BookDetailScreen', () => {
  it('shows the unavailable fallback when the book is missing', async () => {
    seed({ books: [{ id: 'b1', title: 'X', source_type: 'toc_only' }], chapters: [] });
    mockParams = {}; // bookId → '' → not found
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('This book is no longer available.');
  });

  it('resolves the book from an array-form bookId param', async () => {
    seed({ ...POPULATED });
    mockParams = { bookId: ['b1'] };
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Atomic Habits');
  });

  it('shows the fallback for an empty-array bookId param', async () => {
    mockParams = { bookId: [] };
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('This book is no longer available.');
  });

  it('renders the hero, attach-source card and chapter rows', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('2 chapters');
    expect(text).toContain('Attach the book PDF (optional)');
    expect(text).toContain('MockUploadFile');
    expect(text).toContain('1. Intro');
    expect(text).toContain('2 questions · read');
    expect(text).toContain('2. Deep Dive');
    expect(text).toContain('No questions yet');
  });

  it('renders the empty-chapters state (plural zero count)', async () => {
    seed({
      books: [{ id: 'b1', title: 'Solo', source_type: 'toc_only', author: null }],
      chapters: [],
    });
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('0 chapters');
    expect(text).toContain('This book has no chapters yet.');
  });

  it('renders a singular chapter count with exactly one chapter', async () => {
    seed({
      books: [{ id: 'b1', title: 'Solo', source_type: 'toc_only' }],
      chapters: [{ id: 'c1', book_id: 'b1', chapter_index: 0, title: 'Only', read_at: null }],
    });
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('1 chapter');
    expect(text).not.toContain('1 chapters');
  });

  it('shows the generating spinner while a quiz is being built', async () => {
    let resolveGen!: (n: number) => void;
    generateBookChapterQuestions.mockReturnValue(
      new Promise<number>((r) => {
        resolveGen = r;
      }),
    );
    const tree = await renderScreen();
    // Pressing "Generate" flips the chapter into the busy state (title → '').
    act(() => pressByText(tree, 'Generate'));
    expect(allText(tree.toJSON())).not.toContain('Generate');
    await act(async () => {
      resolveGen(6);
      await Promise.resolve();
    });
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/kaizen/book-quiz',
      params: { chapterId: 'c2' },
    });
  });

  it('shows the PDF-attached card with a file name', async () => {
    seed({
      books: [
        {
          id: 'b1',
          title: 'Grounded',
          source_type: 'pdf',
          file_object_key: 'key/1',
          file_name: 'book.pdf',
        },
      ],
      chapters: [],
    });
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('PDF attached: book.pdf');
  });

  it('shows the PDF-attached card without a file name', async () => {
    seed({
      books: [
        {
          id: 'b1',
          title: 'Grounded',
          source_type: 'pdf',
          file_object_key: 'key/1',
          file_name: null,
        },
      ],
      chapters: [],
    });
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('PDF attached.');
    expect(text).not.toContain('PDF attached:');
  });

  it('marks a chapter read from the read toggle', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressReadToggle(tree, 0);
    });
    expect(markBookChapterRead).toHaveBeenCalledWith('c1');
  });

  it('navigates to the reader from the Read pill', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Read'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/kaizen/book-reader',
      params: { chapterId: 'c1' },
    });
  });

  it('navigates to the quiz from the Check pill (chapter with questions)', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Check'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/kaizen/book-quiz',
      params: { chapterId: 'c1' },
    });
  });

  it('generates a quiz and navigates when questions are produced', async () => {
    generateBookChapterQuestions.mockResolvedValue(6);
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Generate');
    });
    expect(generateBookChapterQuestions).toHaveBeenCalledWith('c2', {
      types: ['mcq', 'open', 'spoken'],
      count: 6,
    });
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/kaizen/book-quiz',
      params: { chapterId: 'c2' },
    });
  });

  it('alerts when generation returns no questions', async () => {
    generateBookChapterQuestions.mockResolvedValue(0);
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Generate');
    });
    expect(Alert.alert).toHaveBeenCalledWith('No questions', expect.any(String));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('alerts when generation throws', async () => {
    generateBookChapterQuestions.mockRejectedValue(new Error('offline'));
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Generate');
    });
    expect(Alert.alert).toHaveBeenCalledWith('Generation failed', expect.any(String));
  });

  it('attaches a PDF via the upload section', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'MockUploadFile');
    });
    expect(allText(tree.toJSON())).toContain('MockUploadFile');
  });

  it('guards attach when the resolved bookId is empty', async () => {
    seed({
      books: [{ id: '', title: 'Untitled', source_type: 'toc_only' }],
      chapters: [],
    });
    mockParams = {}; // bookId → ''
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'MockUploadFile');
    });
    expect(attachBookFile).not.toHaveBeenCalled();
  });

  it('renders the upload section for attach flow', async () => {
    const tree = await renderScreen();
    expect(drivePicker(tree)).toBeTruthy();
  });

  it('confirms and deletes the book, then navigates back', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Delete book'));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Delete book',
      'Remove "Atomic Habits" and its questions?',
      expect.any(Array),
    );
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    const del = buttons.find((b) => b.text === 'Delete');
    await act(async () => {
      del?.onPress?.();
    });
    await flush();
    expect(deleteBook).toHaveBeenCalledWith('b1');
    expect(mockBack).toHaveBeenCalled();
  });

  it('mounts on iPad-class dimensions', async () => {
    mockWindow = IPAD;
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Atomic Habits');
  });

  it('still invokes markBookChapterRead when the store rejects', async () => {
    mockHandledRejection(markBookChapterRead);
    const tree = await renderScreen();
    await act(async () => {
      pressReadToggle(tree, 0);
      await flushMicrotasks();
    });
    expect(markBookChapterRead).toHaveBeenCalledWith('c1');
  });

  it('does not navigate back when deleteBook rejects', async () => {
    mockHandledRejection(deleteBook);
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Delete book'));
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    const del = buttons.find((b) => b.text === 'Delete');
    await act(async () => {
      del?.onPress?.();
      await flushMicrotasks();
    });
    expect(deleteBook).toHaveBeenCalledWith('b1');
    expect(mockBack).not.toHaveBeenCalled();
  });
});
