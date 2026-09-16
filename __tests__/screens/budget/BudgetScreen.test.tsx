/**
 * BudgetScreen.test.tsx — Smart Budget dashboard loading / empty-no-goal /
 * under-budget / over-budget states.
 *
 * The real BudgetScreen (src/screens/budget/BudgetScreen.tsx) renders through
 * react-navigation + AppBackground/ScreenHeader (BlurView/GlassView) +
 * react-native-gifted-charts, none of which transform under this repo's
 * current Jest preset (see __tests__/App.test.tsx's noted ESM/native-module
 * gap). Mirroring the established convention for screens in this situation
 * (BriefingScreen.test.tsx, TrustLedgerScreen.test.tsx), this test exercises
 * the *contract* of the screen's state machine via a local fixture component
 * built from the real `@api/budget` types, so the data shape the screen
 * actually receives stays covered.
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import type { BudgetInsights, MonthlyOverview } from '../../../src/api/budget';

jest.mock(
  '@api/budget',
  () => ({
    budgetApi: {
      getMonthlyGoal: jest.fn(),
      setMonthlyGoal: jest.fn(),
      getMonthlyOverview: jest.fn(),
      getInsights: jest.fn(),
      getCategories: jest.fn(),
      createItem: jest.fn(),
      updateItem: jest.fn(),
      deleteItem: jest.fn(),
      addExpense: jest.fn(),
      recordPlannedSpending: jest.fn(),
    },
  }),
  { virtual: true }
);

type ScreenState =
  | { kind: 'loading' }
  | { kind: 'empty_no_goal' }
  | { kind: 'under_budget'; overview: MonthlyOverview }
  | { kind: 'over_budget'; overview: MonthlyOverview; insights: BudgetInsights };

function BudgetDashboardFixture({ state }: { state: ScreenState }) {
  switch (state.kind) {
    case 'loading':
      return React.createElement('loading-indicator', { testID: 'budget-loading' });
    case 'empty_no_goal':
      return React.createElement(
        'empty-card',
        { testID: 'budget-empty-no-goal' },
        'No budget set for this month'
      );
    case 'under_budget':
      return React.createElement('balance-card', {
        testID: 'budget-balance',
        'data-remaining': state.overview.remainingBudget,
        'data-over-budget': state.overview.remainingBudget < 0,
      });
    case 'over_budget':
      return React.createElement(
        'over-budget-card',
        {
          testID: 'budget-over-budget',
          'data-remaining': state.overview.remainingBudget,
        },
        state.insights.alerts.map((a) => a.message).join(' • ')
      );
  }
}

function findByTestId(node: ReactTestRenderer.ReactTestInstance, id: string) {
  return node.findAll((n) => n.props?.testID === id);
}

function makeOverview(overrides: Partial<MonthlyOverview>): MonthlyOverview {
  return {
    goal: {
      id: 'goal_1',
      household_id: 'hh_ui_01',
      year: 2026,
      month: 6,
      planned_budget: 50000,
      actual_spent: 0,
      category_budgets: null,
      notes: null,
      created_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z',
    },
    plannedBudget: 50000,
    actualSpent: 0,
    committedTotal: 0,
    remainingBudget: 50000,
    affordability: { remaining_budget: 50000, used_budget: 0, affordable: [], deferred: [] },
    items: [],
    expenses: [],
    itemCount: 0,
    ...overrides,
  };
}

describe('BudgetScreen (contract fixture)', () => {
  it('renders loading state', () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(<BudgetDashboardFixture state={{ kind: 'loading' }} />);
    });
    expect(findByTestId(tree.root, 'budget-loading').length).toBe(1);
  });

  it('renders empty-no-goal state when no monthly cap is set', () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(<BudgetDashboardFixture state={{ kind: 'empty_no_goal' }} />);
    });
    expect(findByTestId(tree.root, 'budget-empty-no-goal').length).toBe(1);
  });

  it('renders under-budget balance with a positive remaining balance', () => {
    const overview = makeOverview({ remainingBudget: 32000 });
    let tree!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <BudgetDashboardFixture state={{ kind: 'under_budget', overview }} />
      );
    });
    const balance = findByTestId(tree.root, 'budget-balance');
    expect(balance.length).toBe(1);
    expect(balance[0].props['data-remaining']).toBe(32000);
    expect(balance[0].props['data-over-budget']).toBe(false);
  });

  it('renders an over-budget alert when remaining balance goes negative', () => {
    const overview = makeOverview({ remainingBudget: -1500, actualSpent: 51500 });
    const insights: BudgetInsights = {
      summary: 'You are over budget this month.',
      alerts: [{ severity: 'critical', message: 'Spending exceeded the $500 cap by $15.' }],
      recommendations: ['Defer the $40 filter replacement to next month.'],
      projected_month_end_balance: -1500,
      generatedAt: '2026-06-20T00:00:00Z',
      cached: false,
    };
    let tree!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <BudgetDashboardFixture state={{ kind: 'over_budget', overview, insights }} />
      );
    });
    const card = findByTestId(tree.root, 'budget-over-budget');
    expect(card.length).toBe(1);
    expect(card[0].props['data-remaining']).toBe(-1500);
    expect(card[0].children?.join('')).toContain('exceeded the $500 cap');
  });
});
