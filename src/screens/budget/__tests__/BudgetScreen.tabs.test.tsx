/**
 * BudgetScreen — the tab container. Covers the Dashboard / Planned / Spendings /
 * Savings / Bills tab list, the savings kill-switch probe (404 hides the Savings
 * tab, 200 shows it), the active-view switch, and the `activeView=savings` deep
 * link.
 *
 * The tab bodies are stubbed so this suite exercises only the container's
 * routing logic (each body has its own dedicated suite).
 */
let mockActiveView = 'dashboard';
const mockSetActiveView = jest.fn((v: string) => {
  mockActiveView = v;
});
const mockSetSelectedMonth = jest.fn();
let mockSearchParams: { activeView?: string } = {};
let mockHouseholdId: string | undefined = 'hh-default';

const mockRouterBack = jest.fn();
const mockRouterPush = jest.fn();
const mockRouterNavigate = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockSearchParams,
  useRouter: () => ({
    back: mockRouterBack,
    push: mockRouterPush,
    navigate: mockRouterNavigate,
    canGoBack: () => true,
  }),
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

// Routes living in the "More" hub (overflow). A forced section whose route is
// here is a drill-in from More and gets a back button. Kept brand-independent
// so the test doesn't depend on the jest baseline brand's default bar.
const mockOverflowRoutes: string[] = ['pension', 'wishes'];
jest.mock('@navigation/useEffectiveTabs', () => ({
  useEffectiveTabs: () => ({
    pinned: [],
    overflow: mockOverflowRoutes.map((route) => ({ route })),
  }),
}));

jest.mock('@components/common', () => {
  const React = require('react');
  const { View } = require('react-native');
  // PermissionCard has no native dependency of its own (Button/Card/Typography/
  // Icon, same as everything else this mock leaves real) — keep the ACTUAL
  // implementation so these tests exercise the real not-requested/denied copy
  // and the real `-request`/`-settings`/`-dismiss` testIDs.
  const { PermissionCard } = jest.requireActual('@components/common');
  return {
    screenScrollViewStyle: { scroll: {} },
    SCREEN_SCROLL_TEST_ID: 'screen-scroll',
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
    __esModule: true,
    PermissionCard,
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    // Sheet chrome the header's Mortgage switcher renders into.
    AdaptiveModal: ({ visible, children }: { visible?: boolean; children?: React.ReactNode }) =>
      visible ? React.createElement(View, { testID: 'adaptive-modal' }, children ?? null) : null,
    SheetHeader: ({ title }: { title?: string }) =>
      React.createElement(View, { testID: `sheet-header-${title ?? ''}` }),
    ScreenHeader: ({
      title,
      titleElement,
      rightElement,
      showBackButton,
      onBackPress,
      onNotificationPress,
      onProfilePress,
    }: {
      title?: string;
      titleElement?: React.ReactNode;
      rightElement?: React.ReactNode;
      showBackButton?: boolean;
      onBackPress?: () => void;
      onNotificationPress?: () => void;
      onProfilePress?: () => void;
    }) => {
      const { Pressable, Text } = require('react-native');
      return React.createElement(
        View,
        { testID: 'screen-header' },
        // `titleElement` REPLACES the title text, exactly like the real header.
        titleElement ??
          (title != null
            ? React.createElement(Text, { testID: 'screen-header-title' }, title)
            : null),
        showBackButton
          ? React.createElement(Pressable, {
              testID: 'screen-header-back',
              onPress: onBackPress,
            })
          : null,
        onNotificationPress
          ? React.createElement(Pressable, {
              testID: 'screen-header-bell',
              onPress: onNotificationPress,
            })
          : null,
        onProfilePress
          ? React.createElement(Pressable, {
              testID: 'screen-header-avatar',
              onPress: onProfilePress,
            })
          : null,
        rightElement ?? null
      );
    },
    ScreenScrollEnd: ({ testID }: { testID?: string }) =>
      React.createElement(View, { testID: testID ?? 'screen-scroll-end' }),
    // House's header gear. Stubbed rather than left out: this barrel is mocked
    // wholesale, so an export missing from it renders as `undefined` and React
    // throws before a single assertion runs.
    SettingsGearButton: () =>
      React.createElement(View, { testID: 'header-settings-gear' }),
    HeaderActionButton: ({
      children,
      onPress,
      testID,
      accessibilityLabel,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      testID?: string;
      accessibilityLabel?: string;
    }) => {
      const { Pressable } = require('react-native');
      return React.createElement(
        Pressable,
        { testID, accessibilityLabel, onPress },
        children ?? null
      );
    },
  };
});

const mockSetSavingsSubTab = jest.fn();
jest.mock('@stores/savingsStore', () => ({
  useSavingsStore: (sel?: (s: { setActiveSubTab: jest.Mock }) => unknown) => {
    const s = { setActiveSubTab: mockSetSavingsSubTab };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

// useContainerPadding pulls the SidebarTabBar → navigator chain via
// @hooks/useLayoutPadding; stub it (BudgetScreen only feeds the value to the
// mocked AdaptiveContainer).
jest.mock('@hooks/useLayoutPadding', () => ({
  useContainerPadding: () => 16,
}));

jest.mock('@components/layout', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    AdaptiveContainer: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
  };
});

jest.mock('../BudgetDashboardView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    BudgetDashboardView: (props: Record<string, unknown>) =>
      React.createElement(View, { testID: 'stub-dashboard', ...props }),
  };
});
jest.mock('../BudgetSpendingsView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    BudgetSpendingsView: (props: { variant: string } & Record<string, unknown>) =>
      React.createElement(View, { testID: `stub-spendings-${props.variant}`, ...props }),
  };
});
jest.mock('../BudgetAddActionsSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    BudgetAddActionsSheet: (props: Record<string, unknown>) =>
      React.createElement(View, { testID: 'stub-add-actions-sheet', ...props }),
  };
});
jest.mock('../savings/SavingsView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { SavingsView: () => React.createElement(View, { testID: 'stub-savings' }) };
});
jest.mock('../pension/PensionView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { PensionView: () => React.createElement(View, { testID: 'stub-pension' }) };
});
jest.mock('../WishesView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { WishesView: () => React.createElement(View, { testID: 'stub-wishes' }) };
});
jest.mock('../mortgage/MortgageView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { MortgageView: () => React.createElement(View, { testID: 'stub-mortgage' }) };
});

const mockGetOverview = jest.fn();
jest.mock('@api/savings', () => ({
  savingsApi: { getOverview: (...args: unknown[]) => mockGetOverview(...args) },
}));

let mockPushState: 'unavailable' | 'not-requested' | 'denied' | 'granted' = 'unavailable';
const mockRequestPush = jest.fn().mockResolvedValue(undefined);
jest.mock('@hooks/useNotificationPermission', () => ({
  __esModule: true,
  useNotificationPermission: () => ({
    state: mockPushState,
    busy: false,
    request: mockRequestPush,
    refresh: jest.fn(),
  }),
}));

jest.mock('@stores/budgetStore', () => ({
  useBudgetStore: () => ({
    selectedYear: 2026,
    selectedMonth: 7,
    activeView: mockActiveView,
    setSelectedMonth: mockSetSelectedMonth,
    setActiveView: mockSetActiveView,
  }),
}));

// Selector-aware, like the real store: the Pension header's member switcher
// reads `currentHouseholdMembers` through a selector.
const mockHouseholdMembers: Array<Record<string, unknown>> = [];
jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: Record<string, unknown>) => unknown) => {
    const s = {
      currentHousehold: mockHouseholdId ? { id: mockHouseholdId } : null,
      currentHouseholdMembers: mockHouseholdMembers,
    };
    return sel ? sel(s) : s;
  },
}));

// Drives the Mortgage tab's header title switcher. MortgageView publishes the
// real list on load; here it's a plain selector mock.
let mockSelectedMortgageId: string | null = null;
let mockMortgages: Array<Record<string, unknown>> = [];
const mockSetSelectedMortgage = jest.fn();
jest.mock('@stores/mortgageStore', () => ({
  useMortgageStore: (sel?: (s: Record<string, unknown>) => unknown) => {
    const s = {
      selectedMortgageId: mockSelectedMortgageId,
      mortgages: mockMortgages,
      setSelectedMortgage: mockSetSelectedMortgage,
    };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

// This suite exercises the FULL budget suite (tab list, kill-switch probe,
// deep link, add/scan/edit routing). The default test brand is `simple-house`
// (minimal), so BudgetScreen's `isFullBudget()` gate would otherwise collapse
// to a single Dashboard glance — hiding every tab, the settings button and the
// dashboard add callbacks. Force full-budget mode + the full sub-view list so
// the container's routing logic is what's under test.
jest.mock('@features/budget', () => {
  const actual = jest.requireActual('@features/budget');
  const FULL_VIEWS = ['dashboard', 'spendings', 'savings', 'pension', 'wishes'];
  return {
    ...actual,
    isFullBudget: () => true,
    getBudgetSubViews: ({ savingsEnabled }: { savingsEnabled?: boolean } = {}) =>
      savingsEnabled === false
        ? FULL_VIEWS.filter((v) => v !== 'savings' && v !== 'pension')
        : [...FULL_VIEWS],
  };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { collectRenderedText } from '../../../test-utils/budgetConsistency';
import { BudgetScreen } from '../BudgetScreen';

async function renderScreen(props?: React.ComponentProps<typeof BudgetScreen>) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetScreen {...props} />
      </ThemeProvider>
    );
  });
  await act(async () => {
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
  });
  return tree;
}

// `MortgageListItem` shape as the header switcher reads it.
const MORTGAGE_A = {
  id: 'm-1',
  nickname: 'Main home',
  lender: 'RBC',
  productType: 'fixed',
  currentBalanceCents: 48_000_000,
  pctPaid: 0.22,
  nextRenewalDate: null,
  isActive: true,
};
const MORTGAGE_B = { ...MORTGAGE_A, id: 'm-2', nickname: 'Cottage', lender: null };

let hhCounter = 0;
beforeEach(() => {
  jest.clearAllMocks();
  mockActiveView = 'dashboard';
  mockSearchParams = {};
  mockSelectedMortgageId = null;
  mockMortgages = [];
  // Fresh household id per test so the module-level kill-switch cache never
  // bleeds a prior test's enabled/disabled verdict into the next.
  hhCounter += 1;
  mockHouseholdId = `hh-tabs-${hhCounter}`;
  mockGetOverview.mockResolvedValue({});
  mockPushState = 'unavailable';
});

describe('BudgetScreen — tab list', () => {
  it('renders the base tabs and (on a 200 probe) the Savings tab', async () => {
    const tree = await renderScreen();
    const texts = collectRenderedText(tree);
    expect(texts).toContain('Dashboard');
    expect(texts).toContain('Planning');
    expect(texts).toContain('Spendings');
    expect(texts).toContain('Savings');
    expect(texts).toContain('Pension');
    expect(texts).toContain('Wishes');
  });

  it('hides the Savings and Pension tabs when the kill-switch probe returns 404', async () => {
    mockGetOverview.mockRejectedValue({ response: { status: 404 } });
    const tree = await renderScreen();
    const texts = collectRenderedText(tree);
    expect(texts).toContain('Dashboard');
    expect(texts).not.toContain('Savings');
    expect(texts).not.toContain('Pension');
  });

  it('keeps the Savings tab on a network error (fail-open)', async () => {
    mockGetOverview.mockRejectedValue({ message: 'Network Error' });
    const tree = await renderScreen();
    expect(collectRenderedText(tree)).toContain('Savings');
  });
});

describe('BudgetScreen — More-hub section header', () => {
  it('shows a back button for an overflow section opened from More', async () => {
    // Pension is an overflow tab in the default Budget bar → drill-in from More.
    const tree = await renderScreen({ forcedSection: 'pension', sectionTitle: 'Pension' });
    const back = tree.root.findByProps({ testID: 'screen-header-back' });
    expect(back).toBeTruthy();
  });

  it('returns to the More hub (not Home) when Back is pressed', async () => {
    // Back on an overflow section must land on the More hub (`/settings`), not
    // the Home tab that router.back() collapses to.
    const tree = await renderScreen({ forcedSection: 'pension', sectionTitle: 'Pension' });
    act(() => {
      tree.root.findByProps({ testID: 'screen-header-back' }).props.onPress();
    });
    expect(mockRouterNavigate).toHaveBeenCalledWith('/settings');
    expect(mockRouterBack).not.toHaveBeenCalled();
  });

  it('hides the settings gear on the Pension section', async () => {
    const tree = await renderScreen({ forcedSection: 'pension', sectionTitle: 'Pension' });
    expect(tree.root.findAllByProps({ testID: 'budget-settings-button' })).toHaveLength(0);
  });

  it('hides the settings gear on the Wishes section', async () => {
    const tree = await renderScreen({ forcedSection: 'wishes', sectionTitle: 'Wishes' });
    expect(tree.root.findAllByProps({ testID: 'budget-settings-button' })).toHaveLength(0);
  });

  it('keeps the settings gear on other More-hub sections (Mortgage)', async () => {
    const tree = await renderScreen({ forcedSection: 'mortgage', sectionTitle: 'Mortgage' });
    expect(
      tree.root.findAllByProps({ testID: 'budget-settings-button' }).length
    ).toBeGreaterThan(0);
  });

  it('renders the property switcher as the Mortgage header title', async () => {
    mockSelectedMortgageId = 'm-2';
    mockMortgages = [MORTGAGE_A, MORTGAGE_B];
    const tree = await renderScreen({ forcedSection: 'mortgage', sectionTitle: 'Mortgage' });
    // The title names the SELECTED property, not the generic section title.
    expect(
      tree.root.findByProps({ testID: 'mortgage-switcher-title' }).props.children
    ).toBe('Cottage');
  });

  it('switches the focused property from the title dropdown', async () => {
    mockSelectedMortgageId = 'm-1';
    mockMortgages = [MORTGAGE_A, MORTGAGE_B];
    const tree = await renderScreen({ forcedSection: 'mortgage', sectionTitle: 'Mortgage' });
    await act(async () => {
      tree.root.findByProps({ testID: 'mortgage-switcher-trigger' }).props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'mortgage-switcher-row-m-2' }).props.onPress();
    });
    // Selecting alone re-runs MortgageView's focus effect — no markDirty here,
    // or the dashboard would load twice.
    expect(mockSetSelectedMortgage).toHaveBeenCalledWith('m-2');
  });

  it('falls back to a plain "Mortgage" title with no properties', async () => {
    mockMortgages = [];
    const tree = await renderScreen({ forcedSection: 'mortgage', sectionTitle: 'Mortgage' });
    expect(tree.root.findAllByProps({ testID: 'mortgage-switcher-trigger' })).toHaveLength(0);
    expect(
      tree.root.findByProps({ testID: 'mortgage-switcher-title' }).props.children
    ).toBe('Mortgage');
  });

  it('never shows the property switcher outside the Mortgage tab', async () => {
    // A selected mortgage lingers in the store, but the title is Mortgage-only.
    mockSelectedMortgageId = 'm-1';
    mockMortgages = [MORTGAGE_A, MORTGAGE_B];
    const tree = await renderScreen({ forcedSection: 'savings', sectionTitle: 'Savings' });
    expect(tree.root.findAllByProps({ testID: 'mortgage-switcher-trigger' })).toHaveLength(0);
  });

  it('drops the header "Add statement" shortcut (it lives on the Statements tab)', async () => {
    mockSelectedMortgageId = 'm-1';
    mockMortgages = [MORTGAGE_A];
    const tree = await renderScreen({ forcedSection: 'mortgage', sectionTitle: 'Mortgage' });
    expect(tree.root.findAllByProps({ testID: 'mortgage-add-statement-header' })).toHaveLength(
      0
    );
  });

  it('does not show a back button for a pinned section tab', async () => {
    // Savings is pinned to the bottom bar by default → a tab root, no back.
    const tree = await renderScreen({ forcedSection: 'savings', sectionTitle: 'Savings' });
    expect(tree.root.findAllByProps({ testID: 'screen-header-back' })).toHaveLength(0);
  });

  it('does not show a back button on the segmented (non-section) screen', async () => {
    const tree = await renderScreen();
    expect(tree.root.findAllByProps({ testID: 'screen-header-back' })).toHaveLength(0);
  });
});

describe('BudgetScreen — main-tab header cluster', () => {
  it('drops the centered title on the Home tab (shows the brand lockup instead)', async () => {
    const tree = await renderScreen({ forcedSection: 'dashboard', sectionTitle: 'Budget' });
    // No title prop → ScreenHeader falls to its brand-lockup (default) branch.
    expect(tree.root.findAllByProps({ testID: 'screen-header-title' })).toHaveLength(0);
  });

  it('keeps the centered section title on a pinned section tab', async () => {
    const tree = await renderScreen({ forcedSection: 'savings', sectionTitle: 'Savings' });
    const title = tree.root.findByProps({ testID: 'screen-header-title' });
    expect(title.props.children).toBe('Savings');
  });

  it('wires the bell + avatar to notifications / profile on the Home tab', async () => {
    const tree = await renderScreen({ forcedSection: 'dashboard', sectionTitle: 'Budget' });
    act(() => tree.root.findByProps({ testID: 'screen-header-bell' }).props.onPress());
    act(() => tree.root.findByProps({ testID: 'screen-header-avatar' }).props.onPress());
    expect(mockRouterPush).toHaveBeenCalledWith('/notifications');
    expect(mockRouterPush).toHaveBeenCalledWith('/profile');
  });

  it('shows the bell + avatar on a pinned section tab', async () => {
    const tree = await renderScreen({ forcedSection: 'savings', sectionTitle: 'Savings' });
    expect(tree.root.findAllByProps({ testID: 'screen-header-bell' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'screen-header-avatar' }).length).toBeGreaterThan(0);
  });

  it('hides the bell + avatar on a More-hub drill-in section', async () => {
    // Pension is an overflow section → drill-in from More: back+title only.
    const tree = await renderScreen({ forcedSection: 'pension', sectionTitle: 'Pension' });
    expect(tree.root.findAllByProps({ testID: 'screen-header-bell' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'screen-header-avatar' })).toHaveLength(0);
  });
});

describe('BudgetScreen — active view', () => {
  it('renders the dashboard body by default', async () => {
    const tree = await renderScreen();
    expect(tree.root.findByProps({ testID: 'stub-dashboard' })).toBeTruthy();
  });

  it('renders the planned spendings body when activeView is planned', async () => {
    mockActiveView = 'planned';
    const tree = await renderScreen();
    expect(tree.root.findByProps({ testID: 'stub-spendings-planned' })).toBeTruthy();
  });

  it('renders the spent spendings body when activeView is spendings', async () => {
    mockActiveView = 'spendings';
    const tree = await renderScreen();
    expect(tree.root.findByProps({ testID: 'stub-spendings-spent' })).toBeTruthy();
  });

  it('renders the savings body when activeView is savings', async () => {
    mockActiveView = 'savings';
    const tree = await renderScreen();
    expect(tree.root.findByProps({ testID: 'stub-savings' })).toBeTruthy();
  });

  it('renders the pension body when activeView is pension', async () => {
    mockActiveView = 'pension';
    const tree = await renderScreen();
    expect(tree.root.findByProps({ testID: 'stub-pension' })).toBeTruthy();
  });

  it('renders the wishes body when activeView is wishes', async () => {
    mockActiveView = 'wishes';
    const tree = await renderScreen();
    expect(tree.root.findByProps({ testID: 'stub-wishes' })).toBeTruthy();
  });
});

describe('BudgetScreen — navigation actions', () => {
  it('opens budget settings from the header button', async () => {
    const tree = await renderScreen();
    await act(async () => {
      tree.root.findByProps({ testID: 'budget-settings-button' }).props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('BudgetSettings');
  });

  it('hands the dashboard no add actions — quick-add lives on the Planning/Spending tabs', async () => {
    const tree = await renderScreen();
    const dash = tree.root.findByProps({ testID: 'stub-dashboard' });
    expect(dash.props.onAddPlanned).toBeUndefined();
    expect(dash.props.onAddSpent).toBeUndefined();
    expect(dash.props.onAddAIPress).toBeUndefined();
  });

  it('no longer wires a quick-add handler into the spendings views', async () => {
    // The Recent/Popular chip row was removed from both tabs, so the screen has
    // nothing to hand a suggestion to.
    mockActiveView = 'spendings';
    const tree = await renderScreen();
    const spendings = tree.root.findByProps({ testID: 'stub-spendings-spent' });
    expect(spendings.props.onQuickAddSelect).toBeUndefined();
  });

  it('opens Savings → Goals from the dashboard in the legacy segmented screen', async () => {
    // No forcedSection: currentView follows the store, so flipping activeView
    // to 'savings' switches the visible view in place.
    const tree = await renderScreen();
    const dash = tree.root.findByProps({ testID: 'stub-dashboard' });
    act(() => dash.props.onOpenGoals());
    expect(mockSetSavingsSubTab).toHaveBeenCalledWith('goals');
    expect(mockSetActiveView).toHaveBeenCalledWith('savings');
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it('opens Savings → Goals by navigating to /savings in the forced-section screen', async () => {
    // Customizable-tabs model (Budget Home renders section="dashboard"): the view
    // is pinned to forcedSection, so flipping the store is a no-op — it must
    // navigate to the standalone Savings route instead.
    const tree = await renderScreen({ forcedSection: 'dashboard', sectionTitle: 'Budget' });
    const dash = tree.root.findByProps({ testID: 'stub-dashboard' });
    act(() => dash.props.onOpenGoals());
    expect(mockSetSavingsSubTab).toHaveBeenCalledWith('goals');
    expect(mockRouterPush).toHaveBeenCalledWith('/savings');
    expect(mockSetActiveView).not.toHaveBeenCalledWith('savings');
  });

  it('changing tabs updates the active view', async () => {
    const tree = await renderScreen();
    const tabs = tree.root.findAll((n) => typeof n.props?.onTabChange === 'function')[0];
    act(() => tabs.props.onTabChange('planned'));
    expect(mockSetActiveView).toHaveBeenCalledWith('planned');
  });

  it('wires the spendings body edit callbacks to navigation', async () => {
    mockActiveView = 'spendings';
    const tree = await renderScreen();
    const body = tree.root.findByProps({ testID: 'stub-spendings-spent' });
    act(() => body.props.onEditItem('bi-1'));
    act(() =>
      body.props.onEditExpense({
        id: 'ex-1',
        title: 'Milk',
        amount: 500,
        expense_date: '2026-07-01',
        category_id: 'cat-1',
      })
    );
    // The add actions moved OFF the body and onto the header "+" sheet — the
    // body must not still be handed them, or two surfaces would offer the same
    // four routes.
    expect(body.props.onAddPlanned).toBeUndefined();
    expect(body.props.onAddSpent).toBeUndefined();
    expect(body.props.onAddAIPress).toBeUndefined();
    expect(body.props.onScanReceipt).toBeUndefined();
    expect(mockNavigate).toHaveBeenCalledWith('BudgetItemForm', { itemId: 'bi-1' });
    expect(mockNavigate).toHaveBeenCalledWith('BudgetItemForm', {
      expenseId: 'ex-1',
      kind: 'spent',
      expenseDraft: {
        title: 'Milk',
        amount: 500,
        expense_date: '2026-07-01',
        category_id: 'cat-1',
      },
    });
  });

  it('wires the header add sheet to the four add routes', async () => {
    mockActiveView = 'spendings';
    const tree = await renderScreen();
    const sheet = tree.root.findByProps({ testID: 'stub-add-actions-sheet' });
    act(() => sheet.props.onScanReceipt());
    act(() => sheet.props.onAddPlanned());
    act(() => sheet.props.onAddSpent());
    act(() => sheet.props.onAddAIPress());
    expect(mockNavigate).toHaveBeenCalledWith('BudgetReceiptScan');
    expect(mockNavigate).toHaveBeenCalledWith('BudgetItemForm', { kind: 'planned' });
    expect(mockNavigate).toHaveBeenCalledWith('BudgetItemForm', { kind: 'spent' });
    // AI-add from the Spending tab must open with a 'spent' origin so the
    // generated rows are recorded as expenses, not planned items.
    expect(mockNavigate).toHaveBeenCalledWith('BudgetItemAI', { kind: 'spent' });
  });

  it('opens the add sheet from the header "+" on the Spending tab', async () => {
    mockActiveView = 'spendings';
    const tree = await renderScreen();
    expect(
      tree.root.findByProps({ testID: 'stub-add-actions-sheet' }).props.visible
    ).toBe(false);

    await act(async () => {
      tree.root.findByProps({ testID: 'budget-add-menu' }).props.onPress();
    });
    const sheet = tree.root.findByProps({ testID: 'stub-add-actions-sheet' });
    expect(sheet.props.visible).toBe(true);
    expect(sheet.props.variant).toBe('spent');
  });

  it('opens the add sheet in planned mode from the Planning tab', async () => {
    mockActiveView = 'planned';
    const tree = await renderScreen();
    await act(async () => {
      tree.root.findByProps({ testID: 'budget-add-menu' }).props.onPress();
    });
    const sheet = tree.root.findByProps({ testID: 'stub-add-actions-sheet' });
    expect(sheet.props.visible).toBe(true);
    expect(sheet.props.variant).toBe('planned');
  });

  it('shows no header "+" on tabs that have nothing to add', async () => {
    mockActiveView = 'dashboard';
    const tree = await renderScreen();
    expect(tree.root.findAllByProps({ testID: 'budget-add-menu' })).toHaveLength(0);
  });

  it('pulls the header "+" while the spendings list is in batch-select mode', async () => {
    mockActiveView = 'spendings';
    const tree = await renderScreen();
    expect(tree.root.findAllByProps({ testID: 'budget-add-menu' }).length).toBeGreaterThan(0);

    const body = tree.root.findByProps({ testID: 'stub-spendings-spent' });
    await act(async () => body.props.onSelectionModeChange(true));
    expect(tree.root.findAllByProps({ testID: 'budget-add-menu' })).toHaveLength(0);

    await act(async () => body.props.onSelectionModeChange(false));
    expect(tree.root.findAllByProps({ testID: 'budget-add-menu' }).length).toBeGreaterThan(0);
  });

  it('opens AI-add with a planned origin from the Planning tab', async () => {
    mockActiveView = 'planned';
    const tree = await renderScreen();
    const sheet = tree.root.findByProps({ testID: 'stub-add-actions-sheet' });
    act(() => sheet.props.onAddAIPress());
    expect(mockNavigate).toHaveBeenCalledWith('BudgetItemAI', { kind: 'planned' });
  });
});

describe('BudgetScreen — probe cache', () => {
  it('uses the cached verdict on a second mount without re-probing', async () => {
    const sharedId = `hh-cache-${Date.now()}`;
    mockHouseholdId = sharedId;
    await renderScreen();
    expect(mockGetOverview).toHaveBeenCalledTimes(1);
    // Second mount with the same household hits the module-level cache.
    mockGetOverview.mockClear();
    const tree = await renderScreen();
    expect(mockGetOverview).not.toHaveBeenCalled();
    expect(collectRenderedText(tree)).toContain('Savings');
  });

  it('does nothing when there is no household id', async () => {
    mockHouseholdId = undefined;
    await renderScreen();
    expect(mockGetOverview).not.toHaveBeenCalled();
  });

  it('cleans up the probe on unmount', async () => {
    const tree = await renderScreen();
    await act(async () => {
      tree.unmount();
    });
    expect(tree.toJSON()).toBeNull();
  });
});

// PermissionCard's real Card/Button/Pressable tree means a testID set on a
// composite element is inherited by every host node under it in react-test-
// renderer's `findAllByProps` — filtering to host (string-typed) nodes only
// gives the one-match-per-testID count every other assertion in this file
// gets for free from its plain View/Pressable mocks.
function byTestId(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

/** The pressable carrying `testID` — host or composite, whichever owns `onPress`. */
function pressableByTestId(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  return tree.root.find(
    (n) => n.props?.testID === id && typeof n.props?.onPress === 'function'
  );
}

describe('BudgetScreen — ambient notification permission card', () => {
  it('shows the card on the dashboard when push is not-requested, and requests it on tap', async () => {
    mockPushState = 'not-requested';
    const tree = await renderScreen();

    expect(byTestId(tree, 'budget-home-notification-permission-card').length).toBe(1);
    act(() => {
      pressableByTestId(tree, 'budget-home-notification-permission-card-action').props.onPress();
    });
    expect(mockRequestPush).toHaveBeenCalledTimes(1);
  });

  it('shows Open Settings, not a request button, once denied', async () => {
    mockPushState = 'denied';
    const tree = await renderScreen();

    const action = byTestId(tree, 'budget-home-notification-permission-card-action')[0];
    const label = action
      .findAll((n) => typeof n.type === 'string')
      .flatMap((n) => (Array.isArray(n.props.children) ? n.props.children : [n.props.children]))
      .filter((c) => typeof c === 'string')
      .join(' ');
    expect(label).toContain('Open Settings');
  });

  it('hides the card once granted or when the bridge is unavailable', async () => {
    mockPushState = 'granted';
    const grantedTree = await renderScreen();
    expect(byTestId(grantedTree, 'budget-home-notification-permission-card').length).toBe(0);

    mockPushState = 'unavailable';
    const unavailableTree = await renderScreen();
    expect(byTestId(unavailableTree, 'budget-home-notification-permission-card').length).toBe(0);
  });

  it('hides on any non-dashboard tab even while permission is outstanding', async () => {
    mockPushState = 'not-requested';
    mockActiveView = 'savings';
    const tree = await renderScreen();
    expect(byTestId(tree, 'budget-home-notification-permission-card').length).toBe(0);
  });

  it('dismisses the card for the session without touching the permission itself', async () => {
    mockPushState = 'not-requested';
    const tree = await renderScreen();

    await act(async () => {
      pressableByTestId(tree, 'budget-home-notification-permission-card-dismiss').props.onPress();
    });
    expect(byTestId(tree, 'budget-home-notification-permission-card').length).toBe(0);
    expect(mockRequestPush).not.toHaveBeenCalled();
  });
});

describe('BudgetScreen — deep link + fallback', () => {
  it('flips to the savings view when arriving with activeView=savings', async () => {
    mockSearchParams = { activeView: 'savings' };
    await renderScreen();
    expect(mockSetActiveView).toHaveBeenCalledWith('savings');
  });

  it('falls back to dashboard when savings is disabled while it is active', async () => {
    mockActiveView = 'savings';
    mockGetOverview.mockRejectedValue({ response: { status: 404 } });
    await renderScreen();
    expect(mockSetActiveView).toHaveBeenCalledWith('dashboard');
  });
});
