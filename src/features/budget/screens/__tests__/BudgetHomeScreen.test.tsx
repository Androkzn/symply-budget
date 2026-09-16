/**
 * BudgetHomeScreen — Symply Budget landing screen, end-to-end.
 *
 * The screen greets the signed-in member, shows a single "this month" summary
 * card driven by `budgetApi.getMonthlyOverview`, and offers two navigation
 * affordances (the "Open Budget" CTA + the quick-link row) plus the header's
 * notification / profile actions. It owns no money math — every figure comes
 * straight from the monthly-overview payload and is rendered through the
 * canonical `formatBudgetCurrency` helper (which stays REAL here so the
 * currency-formatting assertions are meaningful).
 *
 * This suite stubs the heavy `@components/common` barrel (its real
 * `AppBackground` pulls the brand-asset / scheme chain and `ScreenHeader`
 * requires a ProfileProvider + the SidebarTabBar nav chain), provides a stable
 * `useRouter` mock so navigation targets can be asserted, and mocks the budget
 * API + the three Zustand stores the screen reads. It then exercises: the
 * greeting (morning / afternoon / evening + name suffix), the loading spinner,
 * the "no household" empty state, the populated summary (Planned / Spent /
 * Remaining figures + currency formatting), the "no plan yet" state, a failed
 * overview fetch, and every tap (header notifications + profile, the Open
 * Budget CTA, and the budget-dashboard quick link).
 */

// --- Stub the heavy @components/common barrel ------------------------------
// AppBackground just wraps children; ScreenHeader is reduced to two pressables
// that forward the header's notification / profile handlers so navigation from
// the header can be asserted without a ProfileProvider or the sidebar chain.
jest.mock('@components/common', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    ScreenHeader: ({
      onNotificationPress,
      onProfilePress,
    }: {
      onNotificationPress?: () => void;
      onProfilePress?: () => void;
    }) =>
      React.createElement(
        View,
        { testID: 'screen-header' },
        React.createElement(View, { testID: 'header-notification-btn', onPress: onNotificationPress }),
        React.createElement(View, { testID: 'header-profile-btn', onPress: onProfilePress })
      ),
  };
});

// Stable router so `router.push(target)` calls can be asserted. The global
// jest.setup.js mock returns fresh jest.fns per call (un-assertable), so a
// local mock exposing a single shared `mockRouter` is used instead.
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  navigate: jest.fn(),
  setParams: jest.fn(),
};
jest.mock('expo-router', () => ({
  __esModule: true,
  useRouter: () => mockRouter,
}));

const mockGetMonthlyOverview = jest.fn();
jest.mock('@api/budget', () => ({
  budgetApi: {
    getMonthlyOverview: (...a: unknown[]) => mockGetMonthlyOverview(...a),
  },
}));

// Selector-aware store mocks (the screen reads authStore via a selector and the
// other two via whole-state destructuring).
let mockDisplayName: string | null = 'Andrei Tekhtelev';
jest.mock('@stores/authStore', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const s = { user: mockDisplayName ? { display_name: mockDisplayName } : null };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

let mockSelectedYear = 2026;
let mockSelectedMonth = 7;
jest.mock('@stores/budgetStore', () => ({
  useBudgetStore: (sel?: (s: unknown) => unknown) => {
    const s = { selectedYear: mockSelectedYear, selectedMonth: mockSelectedMonth };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

let mockCurrentHousehold: { id: string } | null = { id: 'hh-test' };
jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: mockCurrentHousehold };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { ThemeProvider } from '@contexts/ThemeContext';

import { BudgetHomeScreen } from '../BudgetHomeScreen';

// --- Fixtures --------------------------------------------------------------

// Only plannedBudget / actualSpent / remainingBudget are read by the screen;
// the rest of MonthlyOverview is intentionally omitted (the screen never
// touches it, so the stub stays deliberately minimal).
const OVERVIEW = {
  plannedBudget: 500000, // $5.0k
  actualSpent: 200000, //   $2.0k
  remainingBudget: 300000, // $3.0k
};

// --- Helpers ---------------------------------------------------------------

async function renderHome() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetHomeScreen />
      </ThemeProvider>
    );
  });
  await act(async () => {
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
  });
  return tree;
}

/**
 * Concatenate every string/number leaf rendered anywhere in the tree into one
 * string. Walking (rather than only collecting nodes whose `children` is a
 * single string) keeps interpolated copy — e.g. `plan {MONTH_NAMES[...]}.` and
 * the greeting `{greeting}{nameSuffix}` — intact for substring assertions.
 */
function allText(root: ReactTestRenderer.ReactTestInstance): string {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (typeof node === 'string' || typeof node === 'number') {
      out.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const inst = node as ReactTestRenderer.ReactTestInstance;
    if (inst && inst.children) walk(inst.children as unknown);
  };
  walk(root.children as unknown);
  return out.join('');
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  mockDisplayName = 'Andrei Tekhtelev';
  mockSelectedYear = 2026;
  mockSelectedMonth = 7;
  mockCurrentHousehold = { id: 'hh-test' };
  mockGetMonthlyOverview.mockResolvedValue(OVERVIEW);
});

describe('BudgetHomeScreen', () => {
  it('loads the overview for the current household + selected month and renders the summary figures', async () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(9); // "Good morning"
    const tree = await renderHome();

    // API called with household id + selected year/month.
    expect(mockGetMonthlyOverview).toHaveBeenCalledWith('hh-test', 2026, 7);

    const texts = allText(tree.root);
    // Greeting + first-name suffix.
    expect(texts).toContain('Good morning, Andrei');
    // Month label from selectedMonth/Year.
    expect(texts).toContain('July 2026');
    // Summary labels + REAL formatBudgetCurrency output: whole dollars with
    // thousands separators (the shared Budget formatter), not a compact $X.Xk —
    // that abbreviation now only survives on chart axes (MortgageHistoryScreen).
    expect(texts).toContain('Planned');
    expect(texts).toContain('Spent');
    expect(texts).toContain('Remaining');
    expect(texts).toContain('$5,000'); // plannedBudget 500000
    expect(texts).toContain('$2,000'); // actualSpent   200000
    expect(texts).toContain('$3,000'); // remainingBudget 300000

    // Screen chrome is present.
    expect(tree.root.findAllByProps({ testID: 'budget-home-screen' }).length).toBeGreaterThan(0);
  });

  it('greets by time of day — afternoon and evening branches', async () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(14);
    let tree = await renderHome();
    expect(allText(tree.root)).toContain('Good afternoon');

    jest.restoreAllMocks();
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(20);
    tree = await renderHome();
    expect(allText(tree.root)).toContain('Good evening');
  });

  it('omits the name suffix when the user has no display name', async () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(9); // deterministic "Good morning"
    mockDisplayName = null;
    const tree = await renderHome();
    const texts = allText(tree.root);
    // The greeting renders with no trailing ", <name>" fragment.
    expect(texts).toContain('Good morning');
    expect(texts).not.toContain('Good morning,');
  });

  it('shows the loading spinner while the overview request is in flight', async () => {
    // A never-resolving request keeps isLoading true through the render pass.
    mockGetMonthlyOverview.mockReturnValue(new Promise<never>(() => {}));
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <BudgetHomeScreen />
        </ThemeProvider>
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(tree.root.findAllByType(ActivityIndicator).length).toBeGreaterThan(0);
  });

  it('shows the sign-in / pick-a-household empty state when there is no household', async () => {
    mockCurrentHousehold = null;
    const tree = await renderHome();

    // With no household the screen never calls the API (early return).
    expect(mockGetMonthlyOverview).not.toHaveBeenCalled();
    expect(allText(tree.root)).toContain(
      'Sign in and pick a household to see your month at a glance.'
    );
    // No spinner, no summary rows.
    expect(tree.root.findAllByType(ActivityIndicator).length).toBe(0);
  });

  it('shows the "no plan yet" prompt (naming the month) when there is no planned budget', async () => {
    mockGetMonthlyOverview.mockResolvedValue({
      plannedBudget: 0,
      actualSpent: 0,
      remainingBudget: 0,
    });
    const tree = await renderHome();
    expect(allText(tree.root)).toContain(
      'No monthly budget set yet — open Budget to plan July.'
    );
  });

  it('degrades to the "no plan yet" state when the overview fetch fails (error swallowed)', async () => {
    mockGetMonthlyOverview.mockRejectedValue(new Error('boom'));
    const tree = await renderHome();
    // The catch clears the overview -> hasPlan false -> the plan prompt renders;
    // the failure never crashes the screen.
    expect(mockGetMonthlyOverview).toHaveBeenCalled();
    expect(allText(tree.root)).toContain(
      'No monthly budget set yet — open Budget to plan July.'
    );
    expect(tree.root.findAllByProps({ testID: 'budget-home-screen' }).length).toBeGreaterThan(0);
  });

  it('navigates to notifications and profile from the header', async () => {
    const tree = await renderHome();

    await act(async () => {
      tree.root.findByProps({ testID: 'header-notification-btn' }).props.onPress();
    });
    expect(mockRouter.push).toHaveBeenCalledWith('/notifications');

    await act(async () => {
      tree.root.findByProps({ testID: 'header-profile-btn' }).props.onPress();
    });
    expect(mockRouter.push).toHaveBeenCalledWith('/profile');
  });

  it('opens the full budget from the primary CTA', async () => {
    const tree = await renderHome();
    await act(async () => {
      tree.root.findByProps({ testID: 'budget-home-open-budget' }).props.onPress();
    });
    expect(mockRouter.push).toHaveBeenCalledWith('/budget');
  });

  it('opens the full budget from the dashboard quick link', async () => {
    const tree = await renderHome();
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: 'Go to budget dashboard' }).props.onPress();
    });
    expect(mockRouter.push).toHaveBeenCalledWith('/budget');
  });
});
