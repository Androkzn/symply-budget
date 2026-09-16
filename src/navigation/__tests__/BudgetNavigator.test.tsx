/**
 * BudgetNavigator — stack registration, brand gating and tab-bar visibility.
 *
 * Matrix: documents/engineering/testing/matrices/budget.md
 *   BUDGET-NAV-001 / 002 / 004 / 012
 *
 * The stack is mounted for real, but every screen component is a proxy stub
 * (rendering `stub:<ExportName>`) so the suite exercises the navigator's
 * registration + gating logic rather than 30 screen trees. jest.setup.js's
 * global inert native-stack mock is replaced locally with a recording one so
 * the registered route names are observable.
 */

// Recording native-stack: each <Stack.Screen name=…> renders a host View
// tagged with its route name, so the registered list can be read off the tree.
jest.mock('@react-navigation/native-stack', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    createNativeStackNavigator: () => ({
      Navigator: ({ children }: { children?: React.ReactNode }) =>
        React.createElement(View, { testID: 'stack-navigator' }, children),
      Screen: ({
        name,
        component: Component,
        children,
      }: {
        name: string;
        component?: React.ComponentType<Record<string, unknown>>;
        children?: (props: Record<string, unknown>) => React.ReactNode;
      }) =>
        React.createElement(
          View,
          { testID: 'stack-screen', screenName: name },
          typeof children === 'function'
            ? children({})
            : Component
              ? React.createElement(Component)
              : null,
        ),
      Group: ({ children }: { children?: React.ReactNode }) => children ?? null,
    }),
  };
});

// Every budget/utility/feature screen barrel becomes a proxy of stub
// components. `stub:<ExportName>` makes an individual screen identifiable
// (BUDGET-NAV-004 asserts BudgetHomeScreen is absent, BudgetScreen present).
const makeScreenBarrelProxy = () => {
  const React = require('react');
  const { View } = require('react-native');
  const cache = new Map<string, React.ComponentType<Record<string, unknown>>>();
  return new Proxy(
    {},
    {
      get: (_target, key) => {
        if (typeof key !== 'string') return undefined;
        if (key === '__esModule') return true;
        if (!cache.has(key)) {
          const Stub = (props: Record<string, unknown>) =>
            React.createElement(View, { testID: `stub:${key}`, ...props });
          Stub.displayName = `Stub(${key})`;
          cache.set(key, Stub);
        }
        return cache.get(key);
      },
    },
  );
};

jest.mock('@screens/budget', () => makeScreenBarrelProxy());
jest.mock('@features/utilities/screens', () => makeScreenBarrelProxy());
jest.mock('@features/budget/screens', () => makeScreenBarrelProxy());
jest.mock('@screens/main/HomeScreen', () => makeScreenBarrelProxy());
// The shared preference screens, mounted in this stack as well as in the
// Settings one — full Budget's settings hub is BudgetSettings, not the More tab.
// Stubbed for the same reason as every other screen here: the recording
// navigator above renders each registered component, and these pull real
// providers (theme, notification store) the navigator suite has no business
// standing up.
jest.mock('@screens/settings/AppearanceScreen', () => makeScreenBarrelProxy());
jest.mock('@screens/settings/CurrencyScreen', () => makeScreenBarrelProxy());
jest.mock('@screens/settings/RegionScreen', () => makeScreenBarrelProxy());
jest.mock('@screens/settings/NotificationSettingsScreen', () => makeScreenBarrelProxy());
jest.mock('@features/health', () => ({
  __esModule: true,
  isHealthBrand: () => false,
  HealthHomeScreen: () => null,
}));
jest.mock('@features/language', () => ({
  __esModule: true,
  isLanguageBrand: () => false,
  LanguageLearnScreen: () => null,
}));
jest.mock('@features/kaizen', () => ({
  __esModule: true,
  isKaizenBrand: () => false,
  KaizenTodayScreen: () => null,
}));

// Brand flip: the navigator reads `isFullBudget()` from @features/budget and
// the Home tab reads `isBudgetBrand()`. Keep the real mode.ts constants.
let mockFullBudget = true;
jest.mock('@features/budget', () => {
  const actual = jest.requireActual('@features/budget');
  return {
    ...actual,
    isFullBudget: () => mockFullBudget,
    isMinimalBudget: () => !mockFullBudget,
    isBudgetBrand: () => mockFullBudget,
    isBudgetOff: () => false,
  };
});

jest.mock('../presentation', () => ({
  __esModule: true,
  useBudgetFormPresentation: () => 'modal',
}));

jest.mock('@services/nav-when-ready', () => ({
  __esModule: true,
  navigateAfterInteractions: (fn: () => void) => fn(),
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate }),
  getFocusedRouteNameFromRoute: () => undefined,
}));

const mockSetFocusedRoute = jest.fn();
jest.mock('@stores/tabBarVisibilityStore', () => ({
  __esModule: true,
  useTabBarVisibilityStore: (
    selector?: (s: { setFocusedRoute: jest.Mock }) => unknown,
  ) => {
    const state = { setFocusedRoute: mockSetFocusedRoute };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { FULL_BUDGET_STACK_ROUTES } from '@features/budget';

import HomeTab from '../../../app/(tabs)/index';
import { BudgetNavigator } from '../BudgetNavigator';
import { shouldHideTabBarForFocusedRoute } from '../tabBarVisibility';

// The Home tab (app/(tabs)/index.tsx) is the Budget dashboard host.

/** Route names of every screen registered on the mounted stack. */
function registeredRoutes(tree: ReactTestRenderer.ReactTestRenderer): string[] {
  return (
    tree.root
      // Host instances only — RN's <View> renders a same-props host node, so
      // matching on testID alone would count each screen twice.
      .findAll(
        n => typeof n.type === 'string' && n.props?.testID === 'stack-screen',
      )
      .map(n => n.props.screenName as string)
  );
}

async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(element);
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFullBudget = true;
});

describe('BudgetNavigator — stack registration', () => {
  it('BUDGET-NAV-001: registers every full-budget stack route, and no route the list does not declare', async () => {
    const tree = await render(<BudgetNavigator />);
    const routes = registeredRoutes(tree);

    // The stack root is always present and is deliberately NOT a full-only route.
    expect(routes).toContain('BudgetMain');
    expect(FULL_BUDGET_STACK_ROUTES).not.toContain('BudgetMain');

    const registeredFullOnly = routes.filter(r => r !== 'BudgetMain').sort();
    const declared = [...FULL_BUDGET_STACK_ROUTES].sort();

    // Direction 1: every declared route is reachable on the stack.
    expect(registeredFullOnly).toEqual(expect.arrayContaining(declared));
    // Direction 2: the stack registers nothing the list omits.
    expect(declared).toEqual(expect.arrayContaining(registeredFullOnly));
    // Both directions at once — exact agreement, no duplicates.
    expect(registeredFullOnly).toEqual(declared);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('BUDGET-NAV-002: minimal mode registers no full-only screen', async () => {
    mockFullBudget = false;
    const tree = await render(<BudgetNavigator />);
    const routes = registeredRoutes(tree);

    expect(routes).toEqual(['BudgetMain']);
    for (const route of FULL_BUDGET_STACK_ROUTES) {
      expect(routes).not.toContain(route);
    }
  });
});

describe('BudgetNavigator — dashboard host', () => {
  it('BUDGET-NAV-004: the Home tab mounts BudgetNavigator with section="dashboard" and not BudgetHomeScreen', async () => {
    const tree = await render(<HomeTab />);

    // The Budget stack is mounted (its root route is registered)…
    expect(registeredRoutes(tree)).toContain('BudgetMain');
    // …rendering the full BudgetScreen forced to the dashboard section.
    const budgetScreen = tree.root.findByProps({ testID: 'stub:BudgetScreen' });
    expect(budgetScreen.props.forcedSection).toBe('dashboard');
    expect(budgetScreen.props.sectionTitle).toBe('Budget');

    // The legacy glance surface is dead for Budget — it must not render.
    expect(
      tree.root.findAllByProps({ testID: 'stub:BudgetHomeScreen' }),
    ).toHaveLength(0);
  });

  it('BUDGET-NAV-004: a non-dashboard host leaves the section unforced', async () => {
    const tree = await render(<BudgetNavigator />);
    const budgetScreen = tree.root.findByProps({ testID: 'stub:BudgetScreen' });
    expect(budgetScreen.props.forcedSection).toBeUndefined();
  });
});

describe('BudgetNavigator — `screen=` deep links', () => {
  // The stack's only door for anything outside the tab that hosts it. The More
  // tab's INSIGHTS rows come through here (see SettingsScreen.insights.test.tsx):
  // they are a sibling tab with no `navigation` into this stack, so a screen the
  // handler does not name is simply unreachable from them.
  it.each(['BudgetLongTermTimeline', 'SavingsYearHistory', 'SavingsCompareYears'])(
    'BUDGET-NAV-013: %s is reachable by URL',
    async (screen) => {
      await render(<BudgetNavigator initialParams={{ screen, navNonce: '1' }} />);
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate.mock.calls[0][0]).toBe(screen);
    },
  );

  it('BUDGET-NAV-013: the same nonce is delivered once — a repeat re-render does not re-navigate', async () => {
    const element = (
      <BudgetNavigator initialParams={{ screen: 'SavingsYearHistory', navNonce: 'same' }} />
    );
    const tree = await render(element);
    await act(async () => {
      tree.update(element);
    });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });
});

describe('BudgetNavigator — tab bar visibility', () => {
  it('BUDGET-NAV-012: hides the tab bar only for routes that own their bottom surface', () => {
    // WishDetail has its own bottom composer — the floating bar would cover it.
    expect(shouldHideTabBarForFocusedRoute('Budget', 'WishDetail')).toBe(true);

    // Every other full-budget stack route keeps the bar.
    for (const route of FULL_BUDGET_STACK_ROUTES) {
      if (route === 'WishDetail') continue;
      expect(shouldHideTabBarForFocusedRoute('Budget', route)).toBe(false);
    }

    // The stack root and an undefined focus (stack not yet mounted) keep it.
    expect(shouldHideTabBarForFocusedRoute('Budget', 'BudgetMain')).toBe(false);
    expect(shouldHideTabBarForFocusedRoute('Budget', undefined)).toBe(false);
    // Unknown tab names never hide the bar.
    expect(shouldHideTabBarForFocusedRoute('NotATab', 'WishDetail')).toBe(false);
  });
});
