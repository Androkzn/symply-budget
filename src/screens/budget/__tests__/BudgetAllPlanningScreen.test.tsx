/**
 * BudgetAllPlanningScreen — the "See all planned" explorer.
 *
 * Renders the real screen against a mocked timeline API and asserts the
 * timeline→fetch wiring, client-side range windowing, the category / search
 * filters, row navigation, and the empty state. gifted-charts is stubbed
 * globally (jest.setup.js).
 */
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('expo-router/react-navigation', () => {
  const React = require('react');
  return {
    useFocusEffect: (cb: () => (() => void) | void) => {
      React.useEffect(cb, [cb]);
    },
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  };
});

const mockGetTimeline = jest.fn();
const mockGetCategories = jest.fn();
jest.mock('@api/budget', () => ({
  budgetApi: {
    getTimeline: (...args: unknown[]) => mockGetTimeline(...args),
    getCategories: (...args: unknown[]) => mockGetCategories(...args),
  },
}));

jest.mock('@components/common', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, null, children),
    ScreenHeader: ({ title }: { title?: string }) =>
      React.createElement(View, { testID: `header-${title}` }),
  };
});

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (selector?: (s: { currentHousehold: { id: string } }) => unknown) => {
    const state = { currentHousehold: { id: 'hh-test' } };
    return selector ? selector(state) : state;
  },
}));

let mockDataRevision = 0;
jest.mock('@stores/budgetStore', () => ({
  useBudgetStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { selectedYear: 2026, selectedMonth: 7, dataRevision: mockDataRevision };
    return selector ? selector(state) : state;
  },
}));

jest.mock('@stores/appStore', () => {
  const state = { currency: 'USD', accentScheme: 'classic' };
  const useAppStore = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  useAppStore.getState = () => state;
  return { useAppStore };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { BudgetCategory, BudgetOverview, TimelineItem } from '@api/budget';
import { ThemeProvider } from '@contexts/ThemeContext';

import { BudgetAllPlanningScreen } from '../BudgetAllPlanningScreen';

const HOME: BudgetCategory = {
  id: 'cat-home',
  household_id: 'hh-test',
  name: 'Home',
  icon: '🏠',
  color: '#22aa77',
  sort_order: 0,
  created_at: '2026-07-01T00:00:00Z',
};

function makeItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: 'ti-1',
    title: 'Item',
    description: null,
    estimatedCostMin: 60000,
    estimatedCostMax: 80000,
    actualCost: null,
    priority: 'medium',
    status: 'planned',
    targetDate: '2026-07-22',
    timeframe: 'immediate',
    year: 2026,
    quarter: null,
    sourceType: null,
    sourceId: null,
    category: null,
    createdAt: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

function overview(items: TimelineItem[]): BudgetOverview {
  return {
    timeline: [
      {
        timeframe: 'immediate',
        label: 'Immediate',
        itemCount: items.length,
        totalEstimatedMin: 0,
        totalEstimatedMax: 0,
        totalActual: 0,
        items,
      },
    ],
    totalPlanned: { min: 0, max: 0 },
    totalSpent: 0,
    categories: [],
  };
}

async function renderScreen(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetAllPlanningScreen />
      </ThemeProvider>
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

function treeText(renderer: ReactTestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (node == null) return;
    if (typeof node === 'string' || typeof node === 'number') {
      out.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const children = (node as { children?: unknown }).children;
    if (children) walk(children);
  };
  walk(renderer.toJSON());
  return out.join(' ');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDataRevision = 0;
  mockGetTimeline.mockResolvedValue(
    overview([
      makeItem({ id: 'a', title: 'New sofa', category: HOME, targetDate: '2026-07-22' }),
      makeItem({ id: 'b', title: 'Winter tires', category: null, targetDate: '2026-07-05' }),
      makeItem({ id: 'c', title: 'Summer trip', category: HOME, targetDate: '2026-03-10' }),
    ])
  );
  mockGetCategories.mockResolvedValue({ categories: [HOME] });
});

describe('BudgetAllPlanningScreen', () => {
  it('fetches the timeline and lists this-month planned items (windowing out other months)', async () => {
    const r = await renderScreen();
    expect(mockGetTimeline).toHaveBeenCalledWith('hh-test');
    expect(r.root.findByProps({ testID: 'budget-all-planning' })).toBeTruthy();
    const text = treeText(r);
    expect(text).toContain('New sofa');
    expect(text).toContain('Winter tires');
    // March item is outside the default "This month" window.
    expect(text).not.toContain('Summer trip');
  });

  it('filters the list to a category when its distribution row is tapped', async () => {
    const r = await renderScreen();
    await act(async () => {
      r.root.findByProps({ testID: 'budget-all-planning-category-cat-home' }).props.onPress();
    });
    const text = treeText(r);
    expect(text).toContain('New sofa');
    expect(text).not.toContain('Winter tires');
  });

  it('filters the list by the search query', async () => {
    const r = await renderScreen();
    await act(async () => {
      r.root.findByProps({ testID: 'budget-all-planning-search' }).props.onChangeText('tires');
    });
    const text = treeText(r);
    expect(text).toContain('Winter tires');
    expect(text).not.toContain('New sofa');
  });

  it('widens the window to the whole year when the range changes to "This year"', async () => {
    const r = await renderScreen();
    const rangeTabs = r.root.findAllByProps({ showActiveIndicator: false })[0];
    await act(async () => {
      rangeTabs.props.onTabChange('year');
      await Promise.resolve();
    });
    expect(treeText(r)).toContain('Summer trip');
  });

  it('navigates to the item editor when a planned row is tapped', async () => {
    const r = await renderScreen();
    await act(async () => {
      r.root.findAllByProps({ testID: 'budget-all-planning-item' })[0].props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith(
      'BudgetItemForm',
      expect.objectContaining({ itemId: expect.any(String) })
    );
  });

  it('shows an empty state when nothing matches', async () => {
    mockGetTimeline.mockResolvedValue(overview([]));
    const r = await renderScreen();
    expect(treeText(r)).toContain('No planned spendings match these filters.');
  });

  it('renders the summary tiles including the Scheduled (has-target-date) count', async () => {
    // Two July items, one dated (scheduled) + one undated (createdAt only).
    mockGetTimeline.mockResolvedValue(
      overview([
        makeItem({ id: 'a', title: 'New sofa', targetDate: '2026-07-22' }),
        makeItem({ id: 'b', title: 'Rug', targetDate: null, createdAt: '2026-07-08T00:00:00Z' }),
      ])
    );
    const r = await renderScreen();
    const text = treeText(r);
    expect(text).toContain('Total planned');
    expect(text).toContain('Items');
    expect(text).toContain('Scheduled');
    // Both items in-window → Items = 2; exactly one has a target date → Scheduled = 1.
    expect(text).toContain('New sofa');
    expect(text).toContain('Rug');
  });

  it('includes an undated item via its createdAt and labels it "No date"', async () => {
    mockGetTimeline.mockResolvedValue(
      overview([makeItem({ id: 'u', title: 'Someday gadget', targetDate: null, createdAt: '2026-07-12T00:00:00Z' })])
    );
    const r = await renderScreen();
    const text = treeText(r);
    expect(text).toContain('Someday gadget');
    expect(text).toContain('No date');
  });

  it('flips the sort control label Newest ⇄ Highest', async () => {
    const r = await renderScreen();
    expect(treeText(r)).toContain('Newest');
    await act(async () => {
      r.root.findByProps({ testID: 'budget-all-planning-sort' }).props.onPress();
    });
    expect(treeText(r)).toContain('Highest');
  });

  it('survives an older Worker payload that omits createdAt (no crash, item still listed)', async () => {
    // Simulate a pre-deploy timeline row: undated AND no createdAt field.
    const legacy = makeItem({ id: 'lg', title: 'Legacy plan', targetDate: null });
    delete (legacy as { createdAt?: string }).createdAt;
    mockGetTimeline.mockResolvedValue(overview([legacy]));
    const r = await renderScreen();
    // 'all' range shows entries with an empty effective date without throwing.
    const rangeTabs = r.root.findAllByProps({ showActiveIndicator: false })[0];
    await act(async () => {
      rangeTabs.props.onTabChange('all');
      await Promise.resolve();
    });
    expect(treeText(r)).toContain('Legacy plan');
  });
});
