/**
 * RecurringYearlyDistributionChart — the "distribution by category, across
 * the whole year" stacked-bar companion to the single-month
 * `RecurringDistributionChart`. Fetches `savingsApi.getRecurringYearlyGroupBreakdown`
 * lazily on mount; these tests cover the loading → success transition, the
 * 12-bar stacked chart, and the legend. Mirrors
 * `RecurringPaymentMonthsChart.test.tsx`'s convention for overriding the
 * global gifted-charts stub to inspect the BarChart's `stackData` prop.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
const mockGetBreakdown = jest.fn();
jest.mock('@api/savings', () => ({
  __esModule: true,
  savingsApi: {
    getRecurringYearlyGroupBreakdown: (...a: unknown[]) => mockGetBreakdown(...a),
  },
}));

type StackDatum = { label: string; stacks: Array<{ value: number; color: string }> };
let mockLastStackData: StackDatum[] | null = null;
jest.mock('react-native-gifted-charts', () => {
  const ReactLib = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    BarChart: (props: { stackData?: StackDatum[] }) => {
      mockLastStackData = props.stackData ?? null;
      return ReactLib.createElement(View, { testID: 'bar-chart' });
    },
  };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { RecurringYearlyGroupBreakdown } from '@api/savings';
import { Typography } from '@components/ui';
import { ThemeProvider } from '@contexts/ThemeContext';

import { RecurringYearlyDistributionChart } from '../RecurringYearlyDistributionChart';

async function flushMicrotasks() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

function monthEntry(month: number, byGroup: Array<{ group_label: string | null; subtotalCents: number }>) {
  return { month, totalCents: byGroup.reduce((sum, g) => sum + g.subtotalCents, 0), byGroup };
}

const FLAT_BREAKDOWN: RecurringYearlyGroupBreakdown = {
  year: 2026,
  groups: [{ group_label: 'Housing' }, { group_label: 'Utilities' }],
  months: Array.from({ length: 12 }, (_, i) =>
    monthEntry(i + 1, [
      { group_label: 'Housing', subtotalCents: 180_000 },
      { group_label: 'Utilities', subtotalCents: 9_000 },
    ])
  ),
};

async function renderChart(props: { householdId?: string; year?: number } = {}) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <RecurringYearlyDistributionChart
          householdId={props.householdId ?? 'hh-test'}
          year={props.year ?? 2026}
        />
      </ThemeProvider>
    );
  });
  return tree;
}

describe('RecurringYearlyDistributionChart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLastStackData = null;
  });

  it('fetches the yearly breakdown for the given household/year on mount', async () => {
    mockGetBreakdown.mockResolvedValue(FLAT_BREAKDOWN);
    await renderChart({ householdId: 'hh-test', year: 2026 });
    expect(mockGetBreakdown).toHaveBeenCalledWith('hh-test', 2026);
  });

  it('shows a loading spinner before the fetch resolves, then the chart after', async () => {
    let resolve!: (value: RecurringYearlyGroupBreakdown) => void;
    mockGetBreakdown.mockReturnValue(
      new Promise((res) => {
        resolve = res;
      })
    );

    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <RecurringYearlyDistributionChart householdId="hh-test" year={2026} />
        </ThemeProvider>
      );
    });

    expect(tree.root.findByProps({ testID: 'savings-yearly-distribution-loading' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'savings-yearly-distribution' })).toHaveLength(0);

    await act(async () => {
      resolve(FLAT_BREAKDOWN);
      await flushMicrotasks();
    });

    expect(tree.root.findAllByProps({ testID: 'savings-yearly-distribution-loading' })).toHaveLength(0);
    expect(tree.root.findByProps({ testID: 'savings-yearly-distribution' })).toBeTruthy();
    expect(mockLastStackData).toHaveLength(12);
    expect(mockLastStackData?.every((s) => s.stacks.length === 2)).toBe(true);
  });

  it('renders nothing (no raw error) when the fetch fails', async () => {
    mockGetBreakdown.mockRejectedValue(new Error('network boom'));
    const tree = await renderChart();
    expect(tree.root.findAllByProps({ testID: 'savings-yearly-distribution' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'savings-yearly-distribution-loading' })).toHaveLength(0);
  });

  it('renders nothing when the household has no active payments this year (empty groups)', async () => {
    mockGetBreakdown.mockResolvedValue({ year: 2026, groups: [], months: [] });
    const tree = await renderChart();
    expect(tree.root.findAllByProps({ testID: 'savings-yearly-distribution' })).toHaveLength(0);
  });

  it('renders one legend row per group, labeling the null group "Other"', async () => {
    mockGetBreakdown.mockResolvedValue({
      year: 2026,
      groups: [{ group_label: 'Housing' }, { group_label: null }],
      months: Array.from({ length: 12 }, (_, i) =>
        monthEntry(i + 1, [
          { group_label: 'Housing', subtotalCents: 180_000 },
          { group_label: null, subtotalCents: 1_600 },
        ])
      ),
    });

    const tree = await renderChart();
    const legend = tree.root.findByProps({ testID: 'savings-yearly-distribution-legend' });
    const legendTexts = legend.findAllByType(Typography).map((n) =>
      Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children
    );
    expect(legendTexts).toContain('Housing');
    expect(legendTexts).toContain('Other');
  });
});
