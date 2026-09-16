/**
 * SavingsMonthlyView — the "Monthly" savings sub-tab. Covers the loading state,
 * empty state, the recurring-payments total + income figures, grouped item
 * rendering, the Manage / Import-with-AI navigation CTAs, and the read-only
 * item detail sheet opened by tapping a row — whose header "Edit" action
 * navigates to the SavingsRecurringPayments manager screen with a
 * `focusItemId` param so editing always goes through that screen's one full
 * form (same as Manage → tap item), rather than editing in place here.
 */
// Stub `SheetHeader` only — `RecurringPaymentDetailSheet` (rendered when a
// row is tapped) pulls it from the `@components/common` barrel, which
// transitively loads the SidebarTabBar → TaskDetail navigator chain that
// crashes under the mocked `@react-navigation/native` below (same reason
// `SavingsRecurringPaymentsScreen.test.tsx` stubs this barrel).
jest.mock('@components/common', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    SheetHeader: ({
      title,
      onLeftPress,
      leftTestID,
      rightLabel,
      onRightPress,
      rightDisabled,
      rightTestID,
      testID,
    }: Record<string, unknown>) =>
      React.createElement(
        View,
        { testID },
        title ? React.createElement(Text, null, title) : null,
        onLeftPress
          ? React.createElement(TouchableOpacity, { onPress: onLeftPress, testID: leftTestID })
          : null,
        rightLabel
          ? React.createElement(
              TouchableOpacity,
              { onPress: onRightPress, disabled: !!rightDisabled, testID: rightTestID },
              React.createElement(Text, null, rightLabel as string)
            )
          : null
      ),
  };
});

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    useNavigation: () => ({ navigate: mockNavigate }),
    useFocusEffect: (cb: () => (() => void) | void) => {
      React.useEffect(cb, []);
    },
  };
});

const mockListRecurringPayments = jest.fn();
const mockGetRecurringPaymentMonthlyHistory = jest.fn();
const mockGetRecurringYearlyGroupBreakdown = jest.fn();
jest.mock('@api/savings', () => ({
  savingsApi: {
    listRecurringPayments: (...args: unknown[]) => mockListRecurringPayments(...args),
    getRecurringPaymentMonthlyHistory: (...args: unknown[]) =>
      mockGetRecurringPaymentMonthlyHistory(...args),
    getRecurringYearlyGroupBreakdown: (...args: unknown[]) =>
      mockGetRecurringYearlyGroupBreakdown(...args),
  },
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: { id: 'hh-test' } };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

const mockMarkDirty = jest.fn();
let mockDataRevision = 0;
jest.mock('@stores/savingsStore', () => ({
  useSavingsStore: (sel?: (s: unknown) => unknown) => {
    const s = {
      selectedYear: 2026,
      selectedMonth: 7,
      dataRevision: mockDataRevision,
      markDirty: mockMarkDirty,
    };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { collectRenderedText } from '../../../../test-utils/budgetConsistency';
import { SavingsMonthlyView } from '../SavingsMonthlyView';

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rp-1',
    household_id: 'hh-test',
    category_id: null,
    label: 'Hydro',
    amount_cents: 12000,
    currency: 'CAD',
    day_of_month: 15,
    group_label: 'Utilities',
    is_essential: true,
    active: true,
    source: 'manual',
    created_by: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

const POPULATED_VIEW = {
  items: [
    makePayment({ id: 'rp-1', label: 'Hydro', amount_cents: 12000, group_label: 'Utilities' }),
    makePayment({ id: 'rp-2', label: 'Gym', amount_cents: 8000, group_label: null, day_of_month: null }),
  ],
  totalMonthlyCents: 20000,
  savedMonthlyIncomeCents: 900000,
  byGroup: [
    { group_label: 'Utilities', subtotalCents: 12000 },
    { group_label: null, subtotalCents: 8000 },
  ],
};

const EMPTY_VIEW = { items: [], totalMonthlyCents: 0, savedMonthlyIncomeCents: 0, byGroup: [] };

async function renderView() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <SavingsMonthlyView />
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
  mockDataRevision = 0;
  mockListRecurringPayments.mockResolvedValue(POPULATED_VIEW);
  // Default for the detail sheet's non-loan "months" chart — only its own
  // dedicated test file asserts on the chart's actual content, so a
  // minimal all-year/no-months-applied response is enough here to keep the
  // effect's fetch from throwing when a row is tapped.
  mockGetRecurringPaymentMonthlyHistory.mockResolvedValue({
    year: 2026,
    amountCents: 0,
    scopeType: 'all_year',
    months: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      inScope: true,
      applied: false,
      appliedAmountCents: null,
    })),
  });
  // Default for the "Whole year" distribution toggle — only
  // `RecurringYearlyDistributionChart.test.tsx` asserts on its actual
  // content, so an empty breakdown is enough here to exercise the toggle
  // without throwing.
  mockGetRecurringYearlyGroupBreakdown.mockResolvedValue({ year: 2026, groups: [], months: [] });
});

describe('SavingsMonthlyView', () => {
  it('fetches recurring payments for the current household', async () => {
    await renderView();
    expect(mockListRecurringPayments).toHaveBeenCalledWith('hh-test', 2026, 7);
  });

  it('renders the monthly payments total (income line intentionally removed)', async () => {
    const tree = await renderView();
    const texts = collectRenderedText(tree);
    expect(texts).toContain('Monthly payments');
    expect(texts).toContain('$200'); // totalMonthlyCents 20000
    // The "Monthly income" line was removed from this tab — assert it's gone.
    expect(texts).not.toContain('Monthly income');
    expect(texts).not.toContain('$9,000'); // savedMonthlyIncomeCents no longer shown
  });

  it('groups payments by group_label with subtotals', async () => {
    const tree = await renderView();
    const texts = collectRenderedText(tree);
    expect(texts).toContain('Utilities');
    expect(texts).toContain('Other'); // null group label → "Other"
    expect(texts).toContain('Hydro');
    expect(texts).toContain('Gym');
    expect(texts).toContain('$120'); // Hydro 12000
  });

  it('renders a progress card (payments left + paid-so-far) for an item with a tracked loan', async () => {
    mockListRecurringPayments.mockResolvedValue({
      items: [
        makePayment({
          id: 'rp-loan',
          label: 'Car loan',
          amount_cents: 45000,
          group_label: 'Loans & Debt',
          day_of_month: null,
          loan_summary: {
            termMonths: 60,
            elapsedMonths: 24,
            paymentsRemaining: 36,
            currentBalanceCents: 1_100_000,
            interestPaidToDateCents: 90_000,
            totalInterestCents: 300_000,
            totalCostCents: 2_100_000,
            payoffDate: '2029-01-15',
          },
        }),
      ],
      totalMonthlyCents: 45000,
      savedMonthlyIncomeCents: 0,
      byGroup: [{ group_label: 'Loans & Debt', subtotalCents: 45000 }],
    });

    const tree = await renderView();
    expect(tree.root.findByProps({ testID: 'savings-monthly-loan-card' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'savings-monthly-loan-progress-bar' })).toBeTruthy();
    const texts = collectRenderedText(tree);
    expect(texts).toContain('36 payments left');
    expect(texts).toContain('24 of 60 paid (40%)');
  });

  it('does not render a loan progress card for an item with no tracked loan', async () => {
    const tree = await renderView();
    expect(tree.root.findAllByProps({ testID: 'savings-monthly-loan-card' })).toHaveLength(0);
  });

  it('shows an "Interest free" badge for a 0% tracked loan', async () => {
    mockListRecurringPayments.mockResolvedValue({
      items: [
        makePayment({
          id: 'rp-loan-zero',
          label: 'IKEA financing',
          amount_cents: 10000,
          group_label: 'Loans & Debt',
          day_of_month: null,
          loan_summary: {
            termMonths: 24,
            elapsedMonths: 12,
            paymentsRemaining: 12,
            currentBalanceCents: 50_000,
            interestPaidToDateCents: 0,
            totalInterestCents: 0,
            totalCostCents: 100_000,
            payoffDate: '2027-06-01',
          },
        }),
      ],
      totalMonthlyCents: 10000,
      savedMonthlyIncomeCents: 0,
      byGroup: [{ group_label: 'Loans & Debt', subtotalCents: 10000 }],
    });

    const tree = await renderView();
    expect(tree.root.findByProps({ testID: 'savings-monthly-interest-free-badge' })).toBeTruthy();
    const texts = collectRenderedText(tree);
    expect(texts).toContain('Interest free');
  });

  it('does not show an "Interest free" badge for a tracked loan that accrues interest', async () => {
    mockListRecurringPayments.mockResolvedValue({
      items: [
        makePayment({
          id: 'rp-loan',
          label: 'Car loan',
          amount_cents: 45000,
          group_label: 'Loans & Debt',
          day_of_month: null,
          loan_summary: {
            termMonths: 60,
            elapsedMonths: 24,
            paymentsRemaining: 36,
            currentBalanceCents: 1_100_000,
            interestPaidToDateCents: 90_000,
            totalInterestCents: 300_000,
            totalCostCents: 2_100_000,
            payoffDate: '2029-01-15',
          },
        }),
      ],
      totalMonthlyCents: 45000,
      savedMonthlyIncomeCents: 0,
      byGroup: [{ group_label: 'Loans & Debt', subtotalCents: 45000 }],
    });

    const tree = await renderView();
    expect(tree.root.findAllByProps({ testID: 'savings-monthly-interest-free-badge' })).toHaveLength(0);
  });

  it('renders the by-category distribution chart when ≥2 groups have spend', async () => {
    // POPULATED_VIEW has two groups (Utilities + Other).
    const tree = await renderView();
    expect(tree.root.findByProps({ testID: 'savings-recurring-distribution' })).toBeTruthy();
    const texts = collectRenderedText(tree);
    expect(texts).toContain('Distribution by category');
  });

  it('omits the distribution chart when only one group has spend', async () => {
    mockListRecurringPayments.mockResolvedValue({
      items: [makePayment({ id: 'rp-1', label: 'Hydro', amount_cents: 12000, group_label: 'Utilities' })],
      totalMonthlyCents: 12000,
      savedMonthlyIncomeCents: 0,
      byGroup: [{ group_label: 'Utilities', subtotalCents: 12000 }],
    });
    const tree = await renderView();
    expect(tree.root.findAllByProps({ testID: 'savings-recurring-distribution' })).toHaveLength(0);
  });

  it('defaults the distribution toggle to "This month" and switches to the yearly chart on "Whole year"', async () => {
    const tree = await renderView();

    // Defaults to the single-month chart; the yearly one hasn't fetched yet.
    expect(tree.root.findByProps({ testID: 'savings-recurring-distribution' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'savings-yearly-distribution-loading' })).toHaveLength(0);
    expect(mockGetRecurringYearlyGroupBreakdown).not.toHaveBeenCalled();

    await act(async () => {
      tree.root.findByProps({ testID: 'savings-distribution-range-year' }).props.onPress();
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });

    expect(tree.root.findAllByProps({ testID: 'savings-recurring-distribution' })).toHaveLength(0);
    expect(mockGetRecurringYearlyGroupBreakdown).toHaveBeenCalledWith('hh-test', 2026);

    // Switching back returns to the single-month chart without re-fetching payments.
    await act(async () => {
      tree.root.findByProps({ testID: 'savings-distribution-range-month' }).props.onPress();
    });
    expect(tree.root.findByProps({ testID: 'savings-recurring-distribution' })).toBeTruthy();
  });

  it('shows the empty state when there are no payments', async () => {
    mockListRecurringPayments.mockResolvedValue(EMPTY_VIEW);
    const tree = await renderView();
    expect(collectRenderedText(tree).some((t) => t.includes('No monthly payments yet'))).toBe(true);
  });

  it('keeps Manage reachable next to Monthly payments even when there are no payments', async () => {
    mockListRecurringPayments.mockResolvedValue(EMPTY_VIEW);
    const tree = await renderView();
    act(() => tree.root.findByProps({ testID: 'savings-monthly-add' }).props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('SavingsRecurringPayments');
  });

  it('navigates to the recurring-payments manager from Manage', async () => {
    const tree = await renderView();
    act(() => tree.root.findByProps({ testID: 'savings-monthly-add' }).props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('SavingsRecurringPayments');
  });

  it('opens the read-only detail sheet (not the manager) when a payment row is tapped', async () => {
    const tree = await renderView();
    act(() => tree.root.findAllByProps({ testID: 'savings-monthly-item' })[0].props.onPress());
    expect(tree.root.findByProps({ testID: 'savings-payment-detail-sheet' })).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalledWith('SavingsRecurringPayments');
    const texts = collectRenderedText(tree);
    expect(texts).toContain('Hydro'); // sheet header title = the tapped item's label
  });

  it('routes the detail sheet\'s Edit action to the manager screen, focused on that item', async () => {
    const tree = await renderView();
    act(() => tree.root.findAllByProps({ testID: 'savings-monthly-item' })[0].props.onPress());
    expect(tree.root.findByProps({ testID: 'savings-payment-detail-sheet' })).toBeTruthy();

    act(() => tree.root.findByProps({ testID: 'savings-payment-detail-edit' }).props.onPress());

    // Same destination + full-form entry point as Manage → tap item — never a
    // local edit-in-place, so this sheet can't fall out of sync with the
    // manager's full field set (group picker, month scope, loan, renewal…).
    expect(mockNavigate).toHaveBeenCalledWith('SavingsRecurringPayments', { focusItemId: 'rp-1' });
    // Handing off to Edit closes the quick-view sheet.
    expect(tree.root.findAllByProps({ testID: 'savings-payment-detail-sheet' })).toHaveLength(0);
  });

  it('still renders when loading the payments fails', async () => {
    mockListRecurringPayments.mockRejectedValue(new Error('boom'));
    const tree = await renderView();
    expect(collectRenderedText(tree).some((t) => t.includes('No monthly payments yet'))).toBe(true);
  });

  it('reloads when the savings data revision changes', async () => {
    const tree = await renderView();
    const callsAfterMount = mockListRecurringPayments.mock.calls.length;

    mockDataRevision = 2;
    await act(async () => {
      tree.update(
        <ThemeProvider>
          <SavingsMonthlyView />
        </ThemeProvider>
      );
      for (let i = 0; i < 15; i += 1) await Promise.resolve();
    });

    expect(mockListRecurringPayments.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });
});
