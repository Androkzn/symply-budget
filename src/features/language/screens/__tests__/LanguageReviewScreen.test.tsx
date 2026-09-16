/**
 * LanguageReviewScreen — Symply Language (`symply-language`) spaced-repetition
 * review flow.
 *
 * Renders the REAL screen through <ThemeProvider> on iPhone- and iPad-class
 * windows and drives its behavior: the loading gate, the empty / nothing-due
 * state, loading a due queue, the flashcard tap-to-reveal, the four rating
 * buttons (Again/Hard/Good/Easy → 1/2/3/4) each firing a background review and
 * advancing the queue, the review-complete state after the last card (with
 * singular/plural card count), resilience to failed loads + failed submits, and
 * back navigation. The cards + reviews api modules are mocked so state is
 * deterministic; their own logic is covered in sibling api suites.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { ThemeProvider } from '@contexts/ThemeContext';

import { languageCardsApi, type CardRow } from '../../api/languageCards';
import { languageReviewsApi } from '../../api/languageReviews';
import { IPAD, IPHONE, allText, hasTestId, pressByText } from '../../test-utils/languageScreenTestKit';
import { LanguageReviewScreen } from '../LanguageReviewScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => {
  const ReactMock = require('react');
  return {
    useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn(), navigate: jest.fn() }),
    // Run the focus callback once on mount, in case the screen adopts it.
    useFocusEffect: (cb: () => void | (() => void)) => {
      ReactMock.useEffect(() => cb(), [cb]);
    },
  };
});

jest.mock('@hooks/useLayoutPadding', () => ({
  useLayoutPadding: () => ({ content: 16 }),
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View, Pressable } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    // Expose the header's back handler as a pressable so back routing is exercised.
    ScreenHeader: ({ title, onBackPress }: { title?: string; onBackPress?: () => void }) =>
      ReactMock.createElement(View, { testID: 'screen-header' }, [
        ReactMock.createElement(View, { key: 'title' }, title),
        ReactMock.createElement(Pressable, {
          key: 'back',
          testID: 'hdr-back',
          onPress: onBackPress,
        }),
      ]),
  };
});

jest.mock('../../api/languageCards', () => ({
  languageCardsApi: { due: jest.fn() },
}));
jest.mock('../../api/languageReviews', () => ({
  languageReviewsApi: { submit: jest.fn() },
}));

const mockDue = languageCardsApi.due as jest.Mock;
const mockSubmit = languageReviewsApi.submit as jest.Mock;

// Two realistic due cards: card 1 uses the front_content/back_content columns,
// card 2 uses the word/translation fallbacks — both card-shape branches.
const CARDS: CardRow[] = [
  { id: 'c1', front_content: 'Hola', back_content: 'Hello' },
  { id: 'c2', word: 'Gato', translation: 'Cat' },
];

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <LanguageReviewScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

function reveal(tree: ReactTestRenderer.ReactTestRenderer) {
  act(() => pressByText(tree, 'Tap to reveal'));
}

async function rate(tree: ReactTestRenderer.ReactTestRenderer, label: string) {
  await act(async () => {
    pressByText(tree, label);
  });
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  mockDue.mockResolvedValue({ dueCards: CARDS, totalDue: CARDS.length });
  mockSubmit.mockResolvedValue({
    reviewId: 'r1',
    nextReviewDate: '2026-07-15',
    intervalDays: 1,
    newEaseFactor: 2.5,
    newRepetitions: 1,
    isActive: true,
  });
});

describe('LanguageReviewScreen — loading gate', () => {
  it('shows a spinner while the due queue is loading', () => {
    mockDue.mockReturnValue(new Promise(() => {}));
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <LanguageReviewScreen />
        </ThemeProvider>,
      );
    });
    expect(tree.root.findAllByType(ActivityIndicator).length).toBe(1);
    expect(hasTestId(tree, 'language-review-screen')).toBe(true);
  });
});

describe('LanguageReviewScreen — empty / nothing-due state', () => {
  it('shows the nothing-due state when no cards are due', async () => {
    mockDue.mockResolvedValue({ dueCards: [], totalDue: 0 });
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Nothing due right now');
    expect(text).toContain('New cards appear here');
    // No review was performed, so the completion copy must not appear.
    expect(text).not.toContain('Review complete');
  });

  it('routes back when Done is pressed from the empty state', async () => {
    mockDue.mockResolvedValue({ dueCards: [], totalDue: 0 });
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Done'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('LanguageReviewScreen — flashcard reveal', () => {
  it('renders the first card front + counter, hiding the back until revealed', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Hola');
    expect(text).toContain('Tap to reveal');
    expect(text).toContain('1 / 2 due');
    // Back + rating buttons are hidden pre-reveal.
    expect(text).not.toContain('Hello');
    expect(text).not.toContain('Again');
  });

  it('reveals the back + rating buttons after tapping the card', async () => {
    const tree = await renderScreen();
    reveal(tree);
    const text = allText(tree.toJSON());
    expect(text).toContain('Hello');
    expect(text).toContain('Again');
    expect(text).toContain('Hard');
    expect(text).toContain('Good');
    expect(text).toContain('Easy');
    expect(text).not.toContain('Tap to reveal');
  });
});

describe('LanguageReviewScreen — rating buttons', () => {
  it.each([
    ['Again', 1],
    ['Hard', 2],
    ['Good', 3],
    ['Easy', 4],
  ])('submits rating %s → %i for the current card and advances', async (label, rating) => {
    const tree = await renderScreen();
    reveal(tree);
    await rate(tree, label as string);
    expect(mockSubmit).toHaveBeenCalledWith({ cardId: 'c1', rating });
    // Advanced to the second card (front shown, back re-hidden).
    const text = allText(tree.toJSON());
    expect(text).toContain('Gato');
    expect(text).toContain('2 / 2 due');
    expect(text).toContain('Tap to reveal');
  });

  it('uses each card front/back-content fallback when advancing', async () => {
    const tree = await renderScreen();
    reveal(tree);
    await rate(tree, 'Good');
    reveal(tree);
    // Card 2 has no back_content — falls back to translation.
    expect(allText(tree.toJSON())).toContain('Cat');
  });

  it('falls back to word for the front and context for the back', async () => {
    // No front_content/back_content/translation — exercises the deepest
    // cardFront (word) and cardBack (context) fallback rungs.
    mockDue.mockResolvedValue({
      dueCards: [{ id: 'c9', word: 'Perro', context: 'A dog you meet on a walk' }],
      totalDue: 1,
    });
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Perro'); // front via word
    reveal(tree);
    expect(allText(tree.toJSON())).toContain('A dog you meet on a walk'); // back via context
  });

  it('renders an empty card (all content fields absent) without crashing', async () => {
    // cardFront and cardBack both bottom out at '' — the final ?? '' rungs.
    mockDue.mockResolvedValue({ dueCards: [{ id: 'c-empty' }], totalDue: 1 });
    const tree = await renderScreen();
    expect(hasTestId(tree, 'language-review-screen')).toBe(true);
    expect(allText(tree.toJSON())).toContain('Tap to reveal');
    reveal(tree);
    // Rating buttons still appear for the empty card.
    expect(allText(tree.toJSON())).toContain('Again');
  });
});

describe('LanguageReviewScreen — completing the review loop', () => {
  it('drives two cards to the review-complete state (plural copy)', async () => {
    const tree = await renderScreen();

    reveal(tree);
    await rate(tree, 'Again');
    reveal(tree);
    await rate(tree, 'Easy');

    const text = allText(tree.toJSON());
    expect(text).toContain('Review complete');
    expect(text).toContain('You reviewed 2 cards');
    expect(mockSubmit).toHaveBeenNthCalledWith(1, { cardId: 'c1', rating: 1 });
    expect(mockSubmit).toHaveBeenNthCalledWith(2, { cardId: 'c2', rating: 4 });
  });

  it('uses singular copy after reviewing a single card', async () => {
    mockDue.mockResolvedValue({ dueCards: [CARDS[0]], totalDue: 1 });
    const tree = await renderScreen();
    reveal(tree);
    await rate(tree, 'Good');
    const text = allText(tree.toJSON());
    expect(text).toContain('Review complete');
    expect(text).toContain('You reviewed 1 card');
    expect(text).not.toContain('1 cards');
  });

  it('routes back when Done is pressed from the completion state', async () => {
    mockDue.mockResolvedValue({ dueCards: [CARDS[0]], totalDue: 1 });
    const tree = await renderScreen();
    reveal(tree);
    await rate(tree, 'Good');
    act(() => pressByText(tree, 'Done'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('LanguageReviewScreen — error resilience', () => {
  it('falls back to the nothing-due state when the load fails', async () => {
    mockDue.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();
    expect(hasTestId(tree, 'language-review-screen')).toBe(true);
    expect(allText(tree.toJSON())).toContain('Nothing due right now');
  });

  it('survives a due queue with a missing card and reviews only the real one', async () => {
    // Malformed payload: the queue claims two due cards but the second entry is
    // absent, so advancing past the first lands on a hole. The screen must keep
    // standing (blank rather than a crash) and must not review the missing card.
    mockDue.mockResolvedValue({
      dueCards: [CARDS[0], undefined as unknown as CardRow],
      totalDue: 2,
    });
    const tree = await renderScreen();

    expect(allText(tree.toJSON())).toContain('Hola');
    reveal(tree);
    await rate(tree, 'Good');

    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(mockSubmit).toHaveBeenCalledWith({ cardId: 'c1', rating: 3 });
    // Not "done" (index 1 of 2), but there is no card to show — the screen
    // renders nothing in the card slot instead of throwing.
    expect(hasTestId(tree, 'language-review-screen')).toBe(true);
    const text = allText(tree.toJSON());
    expect(text).not.toContain('Tap to reveal');
    expect(text).not.toContain('Review complete');
  });

  it('still advances when the background review submit rejects', async () => {
    mockSubmit.mockRejectedValue(new Error('network'));
    const tree = await renderScreen();
    reveal(tree);
    await rate(tree, 'Good');
    // The failed submit is swallowed; the queue advances all the same.
    expect(mockSubmit).toHaveBeenCalledWith({ cardId: 'c1', rating: 3 });
    expect(allText(tree.toJSON())).toContain('Gato');
    expect(hasTestId(tree, 'language-review-screen')).toBe(true);
  });
});

describe('LanguageReviewScreen — navigation', () => {
  it('routes back from the header back button', async () => {
    const tree = await renderScreen();
    act(() => tree.root.findByProps({ testID: 'hdr-back' }).props.onPress());
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('LanguageReviewScreen — iPad rendering', () => {
  it('mounts on iPad-class dimensions with the same review content', async () => {
    mockWindow = IPAD;
    const tree = await renderScreen();
    expect(hasTestId(tree, 'language-review-screen')).toBe(true);
    const text = allText(tree.toJSON());
    expect(text).toContain('Hola');
    expect(text).toContain('1 / 2 due');
  });
});
