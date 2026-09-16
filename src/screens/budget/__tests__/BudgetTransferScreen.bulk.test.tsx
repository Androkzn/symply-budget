/**
 * The Transfer screen says how much of this month's cash a stock-up moved into
 * later months, so "leftover" (month lens) and the bank balance can be read
 * side by side.
 */
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));

jest.mock('@components/common', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    screenScrollViewStyle: { scroll: {} },
    SCREEN_SCROLL_TEST_ID: 'screen-scroll',
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    BackButton: () => null,
    ScreenHeader: () => null,
  };
});

const mockGetTransferContext = jest.fn();
jest.mock('@api/budget', () => ({
  budgetApi: {
    getTransferContext: (...a: unknown[]) => mockGetTransferContext(...a),
    createTransfer: jest.fn(),
    deleteTransfer: jest.fn(),
  },
}));

jest.mock('@stores/budgetStore', () => ({
  useBudgetStore: (sel?: (s: unknown) => unknown) => {
    const s = { selectedYear: 2026, selectedMonth: 9, markInsightsDirty: jest.fn() };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: { id: 'hh-xfer' } };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { BudgetTransferContext } from '@api/budget';
import { ThemeProvider } from '@contexts/ThemeContext';

import { formatBudgetCurrency } from '../budgetFormat';
import { BudgetTransferScreen } from '../BudgetTransferScreen';

const textOf = (renderer: ReactTestRenderer.ReactTestRenderer) => JSON.stringify(renderer.toJSON());

const CONTEXT: BudgetTransferContext = {
  year: 2026,
  month: 9,
  monthLabel: 'September 2026',
  leftoverCents: 40000,
  plannedBudgetCents: 200000,
  actualSpentCents: 160000,
  carriedInCents: 0,
  transferredOutCents: 0,
  bulkDeferredCents: 30000,
  destinations: [
    { type: 'next_month', id: null, label: 'Next month', sublabel: null, icon: 'calendar' },
  ],
  history: [],
};

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetTransferScreen />
      </ThemeProvider>
    );
  });
  await act(async () => {
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
  });
  return tree;
}

describe('BudgetTransferScreen — bulk purchases', () => {
  it('shows the cash a stock-up moved into later months', async () => {
    mockGetTransferContext.mockResolvedValue(CONTEXT);
    const tree = await renderScreen();
    const note = tree.root.findAll((n) => n.props?.testID === 'budget-transfer-bulk-deferred');
    expect(note.length).toBeGreaterThan(0);
    expect(textOf(tree)).toContain(
      `Includes ${formatBudgetCurrency(30000)} paid this month for bulk purchases that count in later months`
    );
  });

  it('says nothing when no purchase spreads out of this month', async () => {
    mockGetTransferContext.mockResolvedValue({ ...CONTEXT, bulkDeferredCents: 0 });
    const tree = await renderScreen();
    expect(tree.root.findAll((n) => n.props?.testID === 'budget-transfer-bulk-deferred')).toHaveLength(0);
  });
});
