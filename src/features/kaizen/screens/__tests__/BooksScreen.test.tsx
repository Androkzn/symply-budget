/**
 * BooksScreen — Symply Kaizen (`symply-kaizen`) book library + register form.
 *
 * Renders the REAL screen through <ThemeProvider> off a mocked kaizenStore and
 * drives the register form (title/author/language/ToC → addBook → router.push),
 * the show/hide form toggle, the blank-title guard, and the library rows
 * (emoji / author / language-label variants + the empty state + row navigation).
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import { selectActiveBooksSorted } from '@features/kaizen/stores/kaizenSelectors';
import type { KaizenBookEntry } from '@features/kaizen/types';

import { IPAD, IPHONE, allText, flushMicrotasks, mockHandledRejection, pressByText } from '../../test-utils/kaizenScreenTestKit';
import { BooksScreen } from '../BooksScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  __esModule: true,
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: jest.fn(),
    back: jest.fn(),
    navigate: jest.fn(),
  },
  useLocalSearchParams: () => ({}),
  Redirect: () => null,
  Link: ({ children }: { children?: React.ReactNode }) => children,
}));

jest.mock('@components/common', () =>
  require('../../test-utils/mockComponentsCommon').createKaizenComponentsCommonMock(),
);

const mockBooksState: { data: unknown[] } = { data: [] };

jest.mock('@features/kaizen/hooks/useKaizenBooks', () => ({
  __esModule: true,
  useKaizenBooks: () => ({ data: mockBooksState.data }),
  useInvalidateKaizenBooks: () => jest.fn(),
}));

function setState(next: Record<string, unknown>) {
  Object.keys(mockState).forEach((k) => delete mockState[k]);
  Object.assign(mockState, next);
}

const mockState: Record<string, unknown> = {};
jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const useKaizenStore = (selector?: (s: typeof mockState) => unknown) =>
    selector ? selector(mockState) : mockState;
  useKaizenStore.getState = () => mockState;
  return { __esModule: true, useKaizenStore };
});

const addBook = jest.fn().mockResolvedValue('new-1');

function seed(books: (Partial<KaizenBookEntry> & Pick<KaizenBookEntry, 'id' | 'title' | 'language'>)[]) {
  mockBooksState.data = selectActiveBooksSorted(books.map(book => ({
    user_id: 'user-1', author: null, source_type: 'toc_only', file_object_key: null,
    file_name: null, file_hash: null, page_count: null, cover_emoji: null,
    created_at: '2026-07-01', updated_at: '2026-07-01', deleted_at: null,
    ...book,
  })));
  setState({ addBook });
}

const textInputs = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll((n) => String(n.type) === 'TextInput');

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BooksScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  addBook.mockResolvedValue('new-1');
  seed([]);
});

describe('BooksScreen', () => {
  it('renders the hero and the empty library state (plural count)', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Books');
    expect(text).toContain('Your library');
    expect(text).toContain('0 books');
    expect(text).toContain('Add a book');
    expect(text).toContain('Add a book to start checking your comprehension.');
  });

  it('shows a singular count with exactly one active book (ignoring deleted)', async () => {
    seed([
      { id: 'b1', title: 'Atomic Habits', author: 'James Clear', language: 'en', cover_emoji: '📘' },
      { id: 'bDel', title: 'Gone', language: 'en', deleted_at: '2020-01-01' },
    ]);
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('1 book');
  });

  it('renders library rows with emoji/author/known-language and bare/unknown-language variants', async () => {
    seed([
      { id: 'b1', title: 'Atomic Habits', author: 'James Clear', language: 'en', cover_emoji: '📘' },
      { id: 'b2', title: 'Deep Work', author: null, language: 'xx', cover_emoji: null },
      { id: 'bDel', title: 'Gone', language: 'en', deleted_at: '2020-01-01' },
    ]);
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('2 books');
    expect(text).toContain('📘  Atomic Habits');
    expect(text).toContain('James Clear · English');
    expect(text).toContain('Deep Work');
    // Unknown language code falls back to the raw code.
    expect(text).toContain('xx');
  });

  it('navigates to the book detail when a library row is pressed', async () => {
    seed([{ id: 'b1', title: 'Atomic Habits', author: 'James Clear', language: 'en' }]);
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Atomic Habits'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/kaizen/book', params: { bookId: 'b1' } });
  });

  it('toggles the register form open and closed', async () => {
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).not.toContain('NEW BOOK');
    act(() => pressByText(tree, 'Add a book'));
    const text = allText(tree.toJSON());
    expect(text).toContain('NEW BOOK');
    expect(text).toContain('Cancel');
    act(() => pressByText(tree, 'Cancel'));
    expect(allText(tree.toJSON())).not.toContain('NEW BOOK');
  });

  it('adds a book with a parsed ToC + selected language, then navigates to it', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Add a book'));
    act(() => {
      const inputs = textInputs(tree);
      inputs[0].props.onChangeText('Atomic Habits');
      inputs[1].props.onChangeText('James Clear');
      inputs[2].props.onChangeText('1. Intro\n\n2. Chapter Two\n   \n3. Last');
    });
    act(() => pressByText(tree, '한국어'));
    await act(async () => {
      pressByText(tree, 'Add book');
    });
    expect(addBook).toHaveBeenCalledWith({
      title: 'Atomic Habits',
      author: 'James Clear',
      language: 'ko',
      sourceType: 'toc_only',
      chapters: [{ title: '1. Intro' }, { title: '2. Chapter Two' }, { title: '3. Last' }],
    });
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/kaizen/book',
      params: { bookId: 'new-1' },
    });
  });

  it('omits the author when left blank and parses an empty ToC to no chapters', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Add a book'));
    act(() => {
      textInputs(tree)[0].props.onChangeText('No Author Book');
    });
    await act(async () => {
      pressByText(tree, 'Add book');
    });
    expect(addBook).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'No Author Book', author: undefined, chapters: [] }),
    );
  });

  it('guards against adding a book with a blank title', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Add a book'));
    await act(async () => {
      pressByText(tree, 'Add book');
    });
    expect(addBook).not.toHaveBeenCalled();
  });

  it('mounts on iPad-class dimensions', async () => {
    mockWindow = IPAD;
    seed([{ id: 'b1', title: 'Atomic Habits', language: 'en' }]);
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Your library');
  });

  it('navigates from the Open pill on a library row', async () => {
    seed([{ id: 'b1', title: 'Atomic Habits', author: 'James Clear', language: 'en' }]);
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Open'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/kaizen/book', params: { bookId: 'b1' } });
  });

  it('keeps the register form open when addBook rejects', async () => {
    mockHandledRejection(addBook);
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Add a book'));
    act(() => textInputs(tree)[0].props.onChangeText('Offline Book'));
    await act(async () => {
      pressByText(tree, 'Add book');
      await flushMicrotasks();
    });
    expect(addBook).toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(allText(tree.toJSON())).toContain('NEW BOOK');
    expect(textInputs(tree)[0].props.value).toBe('Offline Book');
  });

  it('registers a book with a different language pill', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Add a book'));
    act(() => textInputs(tree)[0].props.onChangeText('El hábito'));
    act(() => pressByText(tree, 'Español'));
    await act(async () => {
      pressByText(tree, 'Add book');
    });
    expect(addBook).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'El hábito', language: 'es' }),
    );
  });
});
