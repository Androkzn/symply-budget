/**
 * RecurringPaymentMonthsChart — standalone "which months does this payment
 * apply to" chart for a REGULAR (non-loan) recurring payment. Fetches
 * `savingsApi.getRecurringPaymentMonthlyHistory` lazily on mount; these tests
 * cover the loading → success transition, the 12-bar chart, and the legend
 * only showing states actually present in the data. Mirrors
 * `SavingsOverviewView.test.tsx`'s convention for overriding the global
 * gifted-charts stub to inspect the BarChart's `data` prop.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
const mockGetHistory = jest.fn();
jest.mock('@api/savings', () => ({
  __esModule: true,
  savingsApi: {
    getRecurringPaymentMonthlyHistory: (...a: unknown[]) => mockGetHistory(...a),
  },
}));

type BarDatum = { value: number; label: string; frontColor?: string };
let mockLastBarData: BarDatum[] | null = null;
jest.mock('react-native-gifted-charts', () => {
  const ReactLib = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    BarChart: (props: { data?: BarDatum[] }) => {
      mockLastBarData = props.data ?? null;
      return ReactLib.createElement(View, { testID: 'bar-chart' });
    },
  };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { RecurringPaymentMonthlyHistory, SavingsRecurringPayment } from '@api/savings';
import { Typography } from '@components/ui';
import { ThemeProvider } from '@contexts/ThemeContext';

import { RecurringPaymentMonthsChart } from '../RecurringPaymentMonthsChart';

async function flushMicrotasks() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

const ITEM: SavingsRecurringPayment = {
  id: 'rp-1',
  household_id: 'hh-test',
  category_id: null,
  label: 'Netflix',
  amount_cents: 1_500,
  currency: 'CAD',
  day_of_month: 5,
  group_label: null,
  is_essential: false,
  active: true,
  is_automated: true,
  scope_type: 'all_year',
  scope_year: null,
  active_months: null,
  source: 'manual',
  created_by: null,
  created_at: '',
  updated_at: '',
};

function monthEntry(
  month: number,
  overrides: Partial<RecurringPaymentMonthlyHistory['months'][number]> = {}
) {
  return { month, inScope: true, applied: true, appliedAmountCents: 1_500, ...overrides };
}

const ALL_APPLIED_HISTORY: RecurringPaymentMonthlyHistory = {
  year: 2026,
  amountCents: 1_500,
  scopeType: 'all_year',
  months: Array.from({ length: 12 }, (_, i) => monthEntry(i + 1)),
};

async function renderChart(props: { year?: number } = {}) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <RecurringPaymentMonthsChart item={ITEM} householdId="hh-test" year={props.year ?? 2026} />
      </ThemeProvider>
    );
  });
  return tree;
}

describe('RecurringPaymentMonthsChart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLastBarData = null;
  });

  it('fetches the monthly history for the given household/payment/year on mount', async () => {
    mockGetHistory.mockResolvedValue(ALL_APPLIED_HISTORY);
    await renderChart({ year: 2026 });
    expect(mockGetHistory).toHaveBeenCalledWith('hh-test', 'rp-1', 2026);
  });

  it('shows a loading spinner before the fetch resolves, then the chart after', async () => {
    let resolve!: (value: RecurringPaymentMonthlyHistory) => void;
    mockGetHistory.mockReturnValue(
      new Promise((res) => {
        resolve = res;
      })
    );

    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <RecurringPaymentMonthsChart item={ITEM} householdId="hh-test" year={2026} />
        </ThemeProvider>
      );
    });

    expect(tree.root.findByProps({ testID: 'savings-months-chart-loading' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'savings-months-chart' })).toHaveLength(0);

    await act(async () => {
      resolve(ALL_APPLIED_HISTORY);
      await flushMicrotasks();
    });

    expect(tree.root.findAllByProps({ testID: 'savings-months-chart-loading' })).toHaveLength(0);
    expect(tree.root.findByProps({ testID: 'savings-months-chart' })).toBeTruthy();
    expect(mockLastBarData).toHaveLength(12);
  });

  it('renders nothing (no raw error) when the fetch fails', async () => {
    mockGetHistory.mockRejectedValue(new Error('network boom'));
    const tree = await renderChart();
    expect(tree.root.findAllByProps({ testID: 'savings-months-chart' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'savings-months-chart-loading' })).toHaveLength(0);
  });

  it('renders the legend only for states actually present (no "Skipped" entry when nothing was skipped)', async () => {
    // applied 1-6, outOfScope 7-12 → present states are applied + outOfScope, never skipped.
    const history: RecurringPaymentMonthlyHistory = {
      year: 2026,
      amountCents: 1_500,
      scopeType: 'custom_months',
      months: [
        ...Array.from({ length: 6 }, (_, i) => monthEntry(i + 1)),
        ...Array.from({ length: 6 }, (_, i) => monthEntry(i + 7, { inScope: false, applied: false, appliedAmountCents: null })),
      ],
    };
    mockGetHistory.mockResolvedValue(history);

    const tree = await renderChart();
    const legend = tree.root.findByProps({ testID: 'savings-months-chart-legend' });
    const legendTexts = legend.findAllByType(Typography).map((n) =>
      Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children
    );

    expect(legendTexts).toContain('Applied');
    expect(legendTexts).toContain('Not scheduled');
    expect(legendTexts).not.toContain('Skipped');
  });

  it('renders all 3 legend entries when applied, skipped, and out-of-scope months are all present', async () => {
    const history: RecurringPaymentMonthlyHistory = {
      year: 2026,
      amountCents: 1_500,
      scopeType: 'custom_months',
      months: [
        monthEntry(1),
        monthEntry(2, { applied: false, appliedAmountCents: null }),
        monthEntry(3, { inScope: false, applied: false, appliedAmountCents: null }),
        ...Array.from({ length: 9 }, (_, i) => monthEntry(i + 4, { inScope: false, applied: false, appliedAmountCents: null })),
      ],
    };
    mockGetHistory.mockResolvedValue(history);

    const tree = await renderChart();
    const legend = tree.root.findByProps({ testID: 'savings-months-chart-legend' });
    const legendTexts = legend.findAllByType(Typography).map((n) =>
      Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children
    );

    expect(legendTexts).toContain('Applied');
    expect(legendTexts).toContain('Skipped');
    expect(legendTexts).toContain('Not scheduled');
  });
});
