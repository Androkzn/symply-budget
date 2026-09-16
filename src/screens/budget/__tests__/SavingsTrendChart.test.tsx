/**
 * SavingsTrendChart — the shared Savings/Spending/Monthly trend chart rendered
 * on BOTH the Savings → Overview screen and the Budget home dashboard's
 * cashflow card. These tests own the per-tab series mapping + chrome
 * (title/tabs/empty-state) so the two callers only need to test their own
 * wiring, not duplicate this chart's internals.
 */

jest.mock('react-native-gifted-charts', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    BarChart: (p: Record<string, unknown>) => React.createElement(View, { testID: 'bar', ...p }),
  };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { SavingsTrendChart, type SavingsTrendChartTab } from '../SavingsTrendChart';

type Point = {
  period: string;
  income: number;
  spending: number;
  monthlyPayments: number;
  spendings: number;
  net: number;
  hasExpenseData: boolean;
};

const TREND: Point[] = [
  {
    period: '2026-06',
    income: 0,
    spending: 120000,
    monthlyPayments: 100000,
    spendings: 20000,
    net: -120000, // deficit
    hasExpenseData: true,
  },
  {
    period: '2026-07',
    income: 900000,
    spending: 350000,
    monthlyPayments: 100000,
    spendings: 250000,
    net: 550000,
    hasExpenseData: true,
  },
];

function render(
  activeTab: SavingsTrendChartTab,
  extra: Partial<React.ComponentProps<typeof SavingsTrendChart>> = {}
) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <SavingsTrendChart
          trend={TREND}
          width={300}
          activeTab={activeTab}
          onTabChange={() => {}}
          {...extra}
        />
      </ThemeProvider>
    );
  });
  return tree;
}

const allText = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root
    .findAll((n) => typeof n.props?.children === 'string')
    .map((n) => n.props.children as string);

describe('SavingsTrendChart', () => {
  it('renders all three tabs', () => {
    const tree = render('chart-savings');
    expect(tree.root.findAllByProps({ testID: 'filter-tab-chart-savings' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'filter-tab-chart-spending' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'filter-tab-chart-monthly' }).length).toBeGreaterThan(0);
    expect(allText(tree)).toEqual(expect.arrayContaining(['Savings', 'Spending', 'Monthly']));
  });

  it('Savings tab: bars are net/100, colored by sign, negative allowed', () => {
    const tree = render('chart-savings');
    expect(allText(tree)).toContain('Net savings trend');
    const bar = tree.root.findByProps({ testID: 'bar' });
    expect(bar.props.data).toHaveLength(2);
    expect(bar.props.data[0].value).toBeCloseTo(-1200); // -120000 / 100
    expect(bar.props.data[1].value).toBeCloseTo(5500); // 550000 / 100
    // Deficit month is a distinct color from the surplus month.
    expect(bar.props.data[0].frontColor).not.toBe(bar.props.data[1].frontColor);
  });

  it('Spending tab: bars are spendings/100, one flat color (never negative)', () => {
    const tree = render('chart-spending');
    expect(allText(tree)).toContain('Spending trend');
    const bar = tree.root.findByProps({ testID: 'bar' });
    expect(bar.props.data[0].value).toBeCloseTo(200); // 20000 / 100
    expect(bar.props.data[1].value).toBeCloseTo(2500); // 250000 / 100
    expect(bar.props.data[0].frontColor).toBe(bar.props.data[1].frontColor);
  });

  it('Monthly tab: bars are monthlyPayments/100, one flat color, distinct from Spending\'s', () => {
    const spendingTree = render('chart-spending');
    const monthlyTree = render('chart-monthly');
    expect(allText(monthlyTree)).toContain('Monthly payments trend');
    const monthlyBar = monthlyTree.root.findByProps({ testID: 'bar' });
    expect(monthlyBar.props.data[0].value).toBeCloseTo(1000); // 100000 / 100
    expect(monthlyBar.props.data[1].value).toBeCloseTo(1000);
    const spendingBar = spendingTree.root.findByProps({ testID: 'bar' });
    expect(monthlyBar.props.data[0].frontColor).not.toBe(spendingBar.props.data[0].frontColor);
  });

  it('switches series live when `activeTab` changes (controlled prop)', () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <SavingsTrendChart trend={TREND} width={300} activeTab="chart-savings" onTabChange={() => {}} />
        </ThemeProvider>
      );
    });
    expect(tree.root.findByProps({ testID: 'bar' }).props.data[0].value).toBeCloseTo(-1200);
    act(() => {
      tree.update(
        <ThemeProvider>
          <SavingsTrendChart trend={TREND} width={300} activeTab="chart-monthly" onTabChange={() => {}} />
        </ThemeProvider>
      );
    });
    expect(tree.root.findByProps({ testID: 'bar' }).props.data[0].value).toBeCloseTo(1000);
  });

  it('calls onTabChange with the pressed tab id', () => {
    const onTabChange = jest.fn();
    const tree = render('chart-savings', { onTabChange });
    act(() => {
      tree.root.findByProps({ testID: 'filter-tab-chart-spending' }).props.onPress();
    });
    expect(onTabChange).toHaveBeenCalledWith('chart-spending');
  });

  it('showTitle=false suppresses the title but keeps the tabs', () => {
    const tree = render('chart-savings', { showTitle: false });
    expect(allText(tree)).not.toContain('Net savings trend');
    expect(tree.root.findAllByProps({ testID: 'filter-tab-chart-savings' }).length).toBeGreaterThan(0);
  });

  it('renders the empty label instead of the chart when trend is empty, tabs still visible', () => {
    const tree = render('chart-savings', { trend: [], emptyLabel: 'No cashflow history yet.' });
    expect(allText(tree)).toContain('No cashflow history yet.');
    expect(tree.root.findAllByProps({ testID: 'bar' }).length).toBe(0);
    expect(tree.root.findAllByProps({ testID: 'filter-tab-chart-savings' }).length).toBeGreaterThan(0);
  });

  it('renders nothing in place of the chart when trend is empty and no emptyLabel is given', () => {
    const tree = render('chart-savings', { trend: [] });
    expect(tree.root.findAllByProps({ testID: 'bar' }).length).toBe(0);
    expect(allText(tree)).not.toContain('No cashflow history yet.');
  });
});
