/**
 * Legacy `/budget?activeView=…` deep-link shim (app/(tabs)/budget.tsx).
 *
 * Matrix: documents/engineering/testing/matrices/budget.md
 *   BUDGET-NAV-007 / 008 / 009
 */

let mockBrandId = 'symply-budget';

jest.mock('@features/budget', () => {
  const actual = jest.requireActual('@features/budget');
  return {
    ...actual,
    isBudgetBrand: () => mockBrandId === 'symply-budget',
    isFullBudget: () => mockBrandId === 'symply-budget',
    isBudgetOff: () => mockBrandId === 'symply-kaizen',
  };
});

// budget.tsx is this file's only consumer of '@brand' — mock just the one
// function used instead of spreading requireActual (which drags in '../../brands'
// and trips a circular-import ordering issue under Jest's mock hoisting).
jest.mock('@brand', () => ({
  isHouseBrand: () => mockBrandId === 'symply-house',
}));

const mockRedirect = jest.fn();
let mockParams: Record<string, unknown> = {};
jest.mock('expo-router', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    useLocalSearchParams: () => mockParams,
    Redirect: (props: { href: unknown }) => {
      mockRedirect(props.href);
      return React.createElement(View, { testID: 'redirect' });
    },
  };
});

jest.mock('@navigation/BudgetNavigator', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    BudgetNavigator: (props: Record<string, unknown>) =>
      React.createElement(View, { testID: 'budget-navigator', ...props }),
  };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import BudgetTab from '../(tabs)/budget';

async function openLink(params: Record<string, unknown>) {
  mockParams = params;
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<BudgetTab />);
  });
  return tree;
}

/** The single href the route redirected to. */
function redirectedHref() {
  expect(mockRedirect).toHaveBeenCalledTimes(1);
  return mockRedirect.mock.calls[0][0];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBrandId = 'symply-budget';
  mockParams = {};
});

describe('legacy /budget deep link — BUDGET_VIEW_ROUTE', () => {
  // All seven activeView values the shim must map. A partial map strands
  // notification deep links on Home.
  const CASES: Array<[string, string]> = [
    ['dashboard', '/'],
    ['planned', '/planning'],
    ['spendings', '/spending'],
    ['savings', '/savings'],
    ['pension', '/pension'],
    ['wishes', '/wishes'],
  ];

  it.each(CASES)(
    'BUDGET-NAV-007: activeView=%s maps to %s',
    async (activeView, pathname) => {
      await openLink({ activeView });
      expect(redirectedHref()).toEqual({ pathname, params: {} });
    },
  );

  it('BUDGET-NAV-007: covers every one of the six views exactly once', async () => {
    // Guards the it.each table itself against silently losing a row.
    expect(CASES).toHaveLength(6);
    expect(CASES.map(([view]) => view)).toEqual([
      'dashboard',
      'planned',
      'spendings',
      'savings',
      'pension',
      'wishes',
    ]);
    expect(new Set(CASES.map(([, route]) => route)).size).toBe(6);
  });

  it('BUDGET-NAV-008: a missing activeView falls back to Home', async () => {
    const tree = await openLink({});
    expect(redirectedHref()).toEqual({ pathname: '/', params: {} });
    expect(tree.root.findAllByProps({ testID: 'budget-navigator' })).toHaveLength(0);
  });

  it('BUDGET-NAV-008: an unknown activeView falls back to Home', async () => {
    await openLink({ activeView: 'bogus' });
    expect(redirectedHref()).toEqual({ pathname: '/', params: {} });
  });

  it('BUDGET-NAV-008: a non-string activeView falls back to Home without crashing', async () => {
    await openLink({ activeView: ['savings', 'pension'] });
    expect(redirectedHref()).toEqual({ pathname: '/', params: {} });
  });

  it('BUDGET-NAV-009: forwards screen and subTab to the target section', async () => {
    await openLink({
      activeView: 'savings',
      screen: 'SavingsGoalForm',
      subTab: 'goals',
    });
    expect(redirectedHref()).toEqual({
      pathname: '/savings',
      params: { screen: 'SavingsGoalForm', subTab: 'goals' },
    });
  });

  it('BUDGET-NAV-009: forwards screen/subTab on the Home fallback too', async () => {
    await openLink({ screen: 'BudgetSettings' });
    expect(redirectedHref()).toEqual({
      pathname: '/',
      params: { screen: 'BudgetSettings' },
    });
  });

  it('BUDGET-NAV-009: omits params that were not supplied', async () => {
    await openLink({ activeView: 'wishes', subTab: 'unpaid' });
    expect(redirectedHref()).toEqual({
      pathname: '/wishes',
      params: { subTab: 'unpaid' },
    });
  });
});

describe('legacy /budget deep link — non-Budget brands', () => {
  it('BUDGET-NAV-008: House minimal keeps the combined Budget screen instead of redirecting', async () => {
    mockBrandId = 'symply-house';
    const tree = await openLink({ activeView: 'savings' });
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(tree.root.findByProps({ testID: 'budget-navigator' })).toBeTruthy();
  });

  it('BUDGET-NAV-008: a budget-off brand redirects Home', async () => {
    mockBrandId = 'symply-kaizen';
    const tree = await openLink({ activeView: 'savings' });
    expect(mockRedirect).toHaveBeenCalledWith('/');
    expect(tree.root.findAllByProps({ testID: 'budget-navigator' })).toHaveLength(0);
  });

  it('BUDGET-NAV-008: Health (minimal budgetMode, not House) redirects Home instead of rendering BudgetNavigator', async () => {
    // Health reports budgetMode 'minimal' too (overloaded as the Soft-Transfer
    // eligibility flag), but it isn't House and owns no home-budget UI — a
    // stray /budget deep link or notification must not show it the money stack.
    mockBrandId = 'symply-health';
    const tree = await openLink({ activeView: 'savings' });
    expect(mockRedirect).toHaveBeenCalledWith('/');
    expect(tree.root.findAllByProps({ testID: 'budget-navigator' })).toHaveLength(0);
  });
});
