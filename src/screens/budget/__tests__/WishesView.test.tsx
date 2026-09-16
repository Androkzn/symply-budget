/**
 * WishesView — the "Wishes" tab body: a feed of long-term dreams.
 *
 * Mocks the wishes API + navigation + household store, and stubs AddWishModal
 * (so we don't drag in its form deps). Asserts: the empty state renders its
 * dreaming copy + CTA, a loaded list renders titles / cost / feed summary,
 * tapping a card navigates to WishDetail, the New button opens the add modal,
 * and switching the sub-filter refetches with the new status.
 */

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    useNavigation: () => ({ navigate: mockNavigate }),
    // Global setup stubs useFocusEffect as a no-op; re-run the callback whenever
    // its identity changes (i.e. when `load` changes because status changed).
    useFocusEffect: (cb: () => void) => React.useEffect(() => cb(), [cb]),
  };
});

const mockList = jest.fn();
jest.mock('@api/wishes', () => ({
  wishesApi: { list: (...args: unknown[]) => mockList(...args) },
}));

jest.mock('expo-image', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { Image: (props: Record<string, unknown>) => React.createElement(View, props) };
});

let mockHouseholdId: string | undefined = 'hh-wishes';
jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: () => ({ currentHousehold: mockHouseholdId ? { id: mockHouseholdId } : null }),
}));

jest.mock('../AddWishModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    AddWishModal: (props: { visible: boolean }) =>
      React.createElement(View, { testID: 'add-wish-modal', visible: props.visible }),
  };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { collectRenderedText } from '../../../test-utils/budgetConsistency';
import { WishesView } from '../WishesView';

const renderers: ReactTestRenderer.ReactTestRenderer[] = [];

async function renderView() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <WishesView />
      </ThemeProvider>
    );
  });
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
  renderers.push(tree);
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHouseholdId = 'hh-wishes';
  mockList.mockResolvedValue([]);
});

afterEach(() => {
  act(() => {
    renderers.forEach((r) => {
      try {
        r.unmount();
      } catch {
        /* already gone */
      }
    });
  });
  renderers.length = 0;
});

describe('WishesView — empty state', () => {
  it('fetches active wishes on mount and shows the dreaming empty copy + CTA', async () => {
    const tree = await renderView();
    expect(mockList).toHaveBeenCalledWith('hh-wishes', 'active');
    const texts = collectRenderedText(tree);
    expect(texts).toContain('Dream a little');
    expect(texts).toContain('Add your first wish');
  });
});

describe('WishesView — loaded feed', () => {
  it('renders each wish title, its ballpark cost, and a feed summary', async () => {
    mockList.mockResolvedValue([
      {
        id: 'w1',
        title: 'Buy a boat',
        notes: 'A little sailboat',
        cover_image_key: null,
        estimated_cost_cents: 4200000,
        target_date: null,
        status: 'active',
        sort_order: 0,
        created_by: 'u1',
        created_at: '2026-07-01T00:00:00Z',
        updated_at: '2026-07-01T00:00:00Z',
        entry_count: 3,
        image_count: 2,
      },
    ]);
    const tree = await renderView();
    const texts = collectRenderedText(tree);
    expect(texts).toContain('Buy a boat');
    expect(texts).toContain('$42,000');
    // 2 image entries + (3 - 2) = 1 note entry
    expect(texts.join(' ')).toContain('2 photos');
    expect(texts.join(' ')).toContain('1 note');
  });

  it('navigates to WishDetail when a wish card is pressed', async () => {
    mockList.mockResolvedValue([
      {
        id: 'w1',
        title: 'Buy a boat',
        notes: null,
        cover_image_key: null,
        estimated_cost_cents: null,
        target_date: null,
        status: 'active',
        sort_order: 0,
        created_by: 'u1',
        created_at: '2026-07-01T00:00:00Z',
        updated_at: '2026-07-01T00:00:00Z',
        entry_count: 0,
        image_count: 0,
      },
    ]);
    const tree = await renderView();
    act(() => {
      tree.root.findByProps({ testID: 'wishes-first-card' }).props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('WishDetail', { wishId: 'w1' });
  });
});

describe('WishesView — interactions', () => {
  it('opens the add-wish modal from the New button', async () => {
    const tree = await renderView();
    expect(tree.root.findByProps({ testID: 'add-wish-modal' }).props.visible).toBe(false);
    act(() => {
      tree.root.findByProps({ testID: 'wishes-new-button' }).props.onPress();
    });
    expect(tree.root.findByProps({ testID: 'add-wish-modal' }).props.visible).toBe(true);
  });

  it('refetches with the new status when the sub-filter changes', async () => {
    const tree = await renderView();
    expect(mockList).toHaveBeenLastCalledWith('hh-wishes', 'active');
    const tabs = tree.root.findAll((n) => typeof n.props?.onTabChange === 'function')[0];
    await act(async () => {
      tabs.props.onTabChange('achieved');
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    expect(mockList).toHaveBeenLastCalledWith('hh-wishes', 'achieved');
  });
});
