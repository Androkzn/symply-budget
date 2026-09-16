/**
 * BudgetTimelineScreen — the long-term timeline / category breakdown screen.
 * Covers loading → content, the summary card totals, timeline cards + expand
 * toggle, category breakdown, sync-from-tasks, the add-item navigation, and the
 * error state.
 */
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
}));

jest.mock('@components/common', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    ScreenHeader: ({
      title,
      showBackButton,
      onBackPress,
    }: {
      title?: string;
      showBackButton?: boolean;
      onBackPress?: () => void;
    }) =>
      React.createElement(
        View,
        null,
        title ? React.createElement(Text, null, title) : null,
        showBackButton
          ? React.createElement(TouchableOpacity, {
              onPress: onBackPress,
              style: {},
              testID: 'nav-back-button',
            })
          : null
      ),
  };
});

const mockGetTimeline = jest.fn();
const mockSyncFromTasks = jest.fn();
jest.mock('@api/budget', () => ({
  budgetApi: {
    getTimeline: (...args: unknown[]) => mockGetTimeline(...args),
    syncFromTasks: (...args: unknown[]) => mockSyncFromTasks(...args),
  },
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: { id: 'hh-test' } };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { BudgetOverview } from '@api/budget';
import { ThemeProvider } from '@contexts/ThemeContext';

import { collectRenderedText } from '../../../test-utils/budgetConsistency';
import { BudgetTimelineScreen } from '../BudgetTimelineScreen';

const OVERVIEW: BudgetOverview = {
  timeline: [
    {
      timeframe: 'immediate',
      label: 'Right now',
      itemCount: 1,
      totalEstimatedMin: 25000,
      totalEstimatedMax: 25000,
      totalActual: 0,
      items: [
        {
          id: 'ti-1',
          title: 'Water filter',
          description: 'Replace filter',
          estimatedCostMin: 25000,
          estimatedCostMax: 25000,
          actualCost: null,
          priority: 'high',
          status: 'planned',
          targetDate: '2026-07-15',
          timeframe: 'immediate',
          year: 2026,
          quarter: null,
          sourceType: null,
          sourceId: null,
          category: {
            id: 'cat-home',
            household_id: 'hh-test',
            name: 'Home',
            icon: '🏠',
            color: '#66BB6A',
            sort_order: 0,
            created_at: '2026-07-01T00:00:00Z',
          },
          createdAt: '2026-07-01T00:00:00Z',
        },
      ],
    },
  ],
  totalPlanned: { min: 25000, max: 25000 },
  totalSpent: 160000,
  categories: [
    {
      category: {
        id: 'cat-home',
        household_id: 'hh-test',
        name: 'Home',
        icon: '🏠',
        color: '#66BB6A',
        sort_order: 0,
        created_at: '2026-07-01T00:00:00Z',
      },
      itemCount: 1,
      totalEstimated: 25000,
      totalSpent: 160000,
    },
  ],
};

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetTimelineScreen />
      </ThemeProvider>
    );
  });
  await act(async () => {
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetTimeline.mockResolvedValue(OVERVIEW);
  mockSyncFromTasks.mockResolvedValue({ created: 0, message: 'none' });
});

describe('BudgetTimelineScreen', () => {
  it('loads the timeline for the current household', async () => {
    await renderScreen();
    expect(mockGetTimeline).toHaveBeenCalledWith('hh-test');
  });

  it('renders the summary card totals', async () => {
    const tree = await renderScreen();
    const texts = collectRenderedText(tree);
    expect(texts).toContain('$250'); // totalPlanned min=max 25000
    expect(texts).toContain('$1,600'); // totalSpent 160000
  });

  it('renders timeline cards and their expanded items', async () => {
    const tree = await renderScreen();
    const texts = collectRenderedText(tree);
    expect(texts).toContain('Right now');
    // immediate is expanded by default, so its item shows.
    expect(texts).toContain('Water filter');
  });

  it('collapses a timeframe when its header is toggled', async () => {
    const tree = await renderScreen();
    // "immediate" starts expanded → the item is visible.
    expect(collectRenderedText(tree)).toContain('Water filter');

    // Find the timeframe header TouchableOpacity (its subtree shows "Right now").
    const header = tree.root
      .findAll((n) => typeof n.props?.onPress === 'function')
      .find((n) =>
        n
          .findAll((c) => typeof c.props?.children === 'string')
          .some((c) => c.props.children === 'Right now')
      );
    expect(header).toBeTruthy();
    act(() => header!.props.onPress());

    // Collapsed → the item is hidden.
    expect(collectRenderedText(tree)).not.toContain('Water filter');
  });

  it('renders the category breakdown with estimated + spent', async () => {
    const tree = await renderScreen();
    const texts = collectRenderedText(tree);
    expect(texts).toContain('By Category');
    expect(texts).toContain('Home');
    // The "$1,600 spent" caption is a split text node; assert the caption
    // Typography node exists so the totalSpent > 0 branch is covered.
    const spentNode = tree.root
      .findAll((n) => Array.isArray(n.props?.children))
      .find((n) => (n.props.children as unknown[]).includes(' spent'));
    expect(spentNode).toBeTruthy();
  });

  it('syncs from action items and reloads when new items are created', async () => {
    mockSyncFromTasks.mockResolvedValue({ created: 2, message: 'ok' });
    const tree = await renderScreen();
    const sync = tree.root.findAll((n) => typeof n.props?.onPress === 'function');
    // The sync button carries the "Sync from Action Items" label.
    const syncBtn = tree.root
      .findAll((n) => typeof n.props?.onPress === 'function')
      .find((n) => JSON.stringify(n.props?.style).includes('alignSelf'));
    await act(async () => {
      (syncBtn ?? sync[0]).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockSyncFromTasks).toHaveBeenCalledWith('hh-test');
    expect(mockGetTimeline).toHaveBeenCalledTimes(2);
  });

  it('navigates to the item form from Add Budget Item', async () => {
    const tree = await renderScreen();
    const addBtn = tree.root.find((n) => n.props?.title === 'Add Budget Item');
    act(() => addBtn.props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('BudgetItemForm');
  });

  it('shows an error message when the timeline fails to load', async () => {
    mockGetTimeline.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();
    expect(collectRenderedText(tree)).toContain('Failed to load budget data');
  });

  it('shows item details in an alert when a timeline item is pressed', async () => {
    const { Alert } = require('react-native');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await renderScreen();
    // The item row is the Touchable whose subtree text includes "Water filter".
    const itemRow = tree.root
      .findAll((n) => typeof n.props?.onPress === 'function')
      .find((n) =>
        n
          .findAll((c) => typeof c.props?.children === 'string')
          .some((c) => c.props.children === 'Water filter')
      );
    act(() => itemRow!.props.onPress());
    expect(alertSpy).toHaveBeenCalledWith('Water filter', expect.any(String), expect.any(Array));
    alertSpy.mockRestore();
  });

  it('pull-to-refresh reloads the timeline', async () => {
    const tree = await renderScreen();
    const refreshControl = tree.root.find(
      (n) => typeof n.props?.onRefresh === 'function' && typeof n.props?.refreshing === 'boolean'
    );
    await act(async () => {
      await refreshControl.props.onRefresh();
    });
    expect(mockGetTimeline).toHaveBeenCalledTimes(2);
  });

  it('swallows sync errors without crashing', async () => {
    mockSyncFromTasks.mockRejectedValue(new Error('sync boom'));
    const tree = await renderScreen();
    const syncBtn = tree.root
      .findAll((n) => typeof n.props?.onPress === 'function')
      .find((n) => JSON.stringify(n.props?.style).includes('alignSelf'));
    await act(async () => {
      syncBtn!.props.onPress();
      await Promise.resolve();
    });
    expect(mockSyncFromTasks).toHaveBeenCalled();
    // No reload happens on error.
    expect(mockGetTimeline).toHaveBeenCalledTimes(1);
  });

  it('re-expands a timeframe when its header is toggled twice', async () => {
    const tree = await renderScreen();
    const findHeader = () =>
      tree.root
        .findAll((n) => typeof n.props?.onPress === 'function')
        .find((n) =>
          n
            .findAll((c) => typeof c.props?.children === 'string')
            .some((c) => c.props.children === 'Right now')
        );
    act(() => findHeader()!.props.onPress()); // collapse
    expect(collectRenderedText(tree)).not.toContain('Water filter');
    act(() => findHeader()!.props.onPress()); // re-expand (add branch)
    expect(collectRenderedText(tree)).toContain('Water filter');
  });

  it('formats a min≠max cost as a range', async () => {
    mockGetTimeline.mockResolvedValue({
      ...OVERVIEW,
      totalPlanned: { min: 10000, max: 20000 },
    });
    const tree = await renderScreen();
    expect(collectRenderedText(tree)).toContain('$100 - $200');
  });
});
