/**
 * ReviewsScreen — Symply Kaizen (`symply-kaizen`) weekly review journal.
 *
 * Renders the REAL screen through <ThemeProvider>, asserts the weekly-review form
 * and empty state, and drives wins entry → "Save review" → saveWeeklyReview.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { IPHONE, allText, flushMicrotasks, mockHandledRejection, pressByText } from '../../test-utils/kaizenScreenTestKit';

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

const mockWeeklyReviews: Array<{
  id: string;
  week_start: string;
  wins: string | null;
  one_percent_change?: string | null;
}> = [];

const mockUseKaizenWeeklyReviews = jest.fn((..._args: unknown[]) => ({ data: mockWeeklyReviews }));

jest.mock('@features/kaizen/hooks/useKaizenWeeklyReviews', () => ({
  __esModule: true,
  useKaizenWeeklyReviews: (...args: unknown[]) => mockUseKaizenWeeklyReviews(...args),
  useInvalidateKaizenWeeklyReviews: () => jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@stores/authStore', () => ({
  useAuthStore: (sel: (s: { user: { id: string } | null }) => unknown) =>
    sel({ user: { id: 'u1' } }),
}));

jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const state = {
    saveWeeklyReview: jest.fn().mockResolvedValue(undefined),
  };
  const useKaizenStore = (sel?: (value: typeof state) => unknown) => (sel ? sel(state) : state);
  useKaizenStore.getState = () => state;
  useKaizenStore.setState = (p: Partial<typeof state> | ((value: typeof state) => Partial<typeof state>)) => Object.assign(state, typeof p === 'function' ? p(state) : p);
  return { __esModule: true, useKaizenStore, __state: state };
});

 
const { __state: state } = require('@features/kaizen/stores/kaizenStore');
const { ReviewsScreen } = require('../ReviewsScreen') as typeof import('../ReviewsScreen');

const textInputs = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll((n) => String(n.type) === 'TextInput');

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <ReviewsScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  mockWeeklyReviews.length = 0;
  mockUseKaizenWeeklyReviews.mockReturnValue({ data: mockWeeklyReviews });
});

describe('ReviewsScreen', () => {
  it('renders the weekly-review form and the empty state', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Reviews');
    expect(text).toContain('Weekly reviews');
    expect(text).toContain('No reviews yet. Your first weekly reflection starts here.');
  });

  it('saves a weekly review with the entered wins', async () => {
    const tree = await renderScreen();
    act(() => textInputs(tree)[0].props.onChangeText('Shipped the auth refactor'));
    await act(async () => {
      pressByText(tree, 'Save review');
    });
    expect(state.saveWeeklyReview).toHaveBeenCalledWith({
      wins: 'Shipped the auth refactor',
      improvements: '',
      onePercentChange: '',
    });
  });

  it('lists past reviews, falling back through wins → 1% change → default', async () => {
    mockWeeklyReviews.push(
      { id: 'r1', week_start: '2026-07-06', wins: 'Shipped v2' },
      { id: 'r2', week_start: '2026-06-29', wins: null, one_percent_change: 'Sleep earlier' },
      { id: 'r3', week_start: '2026-06-22', wins: null, one_percent_change: null },
    );
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Week of 2026-07-06');
    expect(text).toContain('Shipped v2'); // wins present
    expect(text).toContain('Sleep earlier'); // falls back to one_percent_change
    expect(text).toContain('Reflection saved'); // both null → default
    expect(text).not.toContain('No reviews yet.');
  });

  it('saves all three reflection fields and clears the form', async () => {
    const tree = await renderScreen();
    const inputs = textInputs(tree);
    act(() => inputs[0].props.onChangeText('Shipped auth'));
    act(() => inputs[1].props.onChangeText('Batch reviews earlier'));
    act(() => inputs[2].props.onChangeText('Sleep by 10pm'));
    await act(async () => {
      pressByText(tree, 'Save review');
    });
    expect(state.saveWeeklyReview).toHaveBeenCalledWith({
      wins: 'Shipped auth',
      improvements: 'Batch reviews earlier',
      onePercentChange: 'Sleep by 10pm',
    });
    expect(inputs[0].props.value).toBe('');
    expect(inputs[1].props.value).toBe('');
    expect(inputs[2].props.value).toBe('');
  });

  it('keeps entered text when saveWeeklyReview rejects', async () => {
    mockHandledRejection(state.saveWeeklyReview);
    const tree = await renderScreen();
    act(() => textInputs(tree)[0].props.onChangeText('Draft wins'));
    await act(async () => {
      pressByText(tree, 'Save review');
      await flushMicrotasks();
    });
    expect(state.saveWeeklyReview).toHaveBeenCalled();
    expect(textInputs(tree)[0].props.value).toBe('Draft wins');
  });
});
