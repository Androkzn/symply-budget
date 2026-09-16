/**
 * HealthWeightSummaryCard — the "Weight Summary" restyle of the donor's
 * `currentWeightCard` (`WeightTabView.swift` lines 226–311): four equal stat
 * tiles (Current · Change · Avg · Trend) on this screen's own filled-card /
 * uppercase-footnote convention rather than the donor's glassmorphic look.
 *
 * This suite drives the component directly (it is not wired into a screen
 * yet): a brand-new account with nothing logged must render every tile as
 * "—" without throwing, a populated card must show correctly formatted
 * values, and each of the three trend bands (gaining / losing / stable —
 * the donor's own `selectedWeekTrend` words, ±0.2 threshold) must read out
 * the right word.
 */

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { HealthWeightSummaryCard } from '../HealthWeightSummaryCard';

type Rendered = ReactTestRenderer.ReactTestRenderer;

function render(element: React.ReactElement): Rendered {
  let tree!: Rendered;
  act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{element}</ThemeProvider>);
  });
  return tree;
}

function byTestId(tree: Rendered, id: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

/** Concatenated text of a host subtree. */
function textOf(node: ReactTestRenderer.ReactTestInstance): string {
  const out: string[] = [];
  const walk = (n: ReactTestRenderer.ReactTestInstance | string) => {
    if (typeof n === 'string') {
      out.push(n);
      return;
    }
    for (const child of n.children) walk(child as never);
  };
  walk(node);
  return out.join('');
}

function text(tree: Rendered, testID: string): string {
  const nodes = byTestId(tree, testID);
  if (nodes.length === 0) throw new Error(`no node with testID "${testID}"`);
  return textOf(nodes[0]);
}

function has(tree: Rendered, testID: string): boolean {
  return byTestId(tree, testID).length > 0;
}

describe('HealthWeightSummaryCard', () => {
  it('SUMMARY-001: an empty account renders every tile as — without throwing', () => {
    const tree = render(
      <HealthWeightSummaryCard unit="kg" current={null} change={null} average={null} />
    );
    expect(has(tree, 'health-weight-summary')).toBe(true);
    expect(text(tree, 'health-weight-summary-current-value')).toBe('—');
    expect(text(tree, 'health-weight-summary-change-value')).toBe('—');
    expect(text(tree, 'health-weight-summary-average-value')).toBe('—');
    expect(text(tree, 'health-weight-summary-trend-value')).toBe('—');
  });

  it('SUMMARY-002: a populated card shows each value formatted with its unit', () => {
    const tree = render(
      <HealthWeightSummaryCard unit="kg" current={72.4} change={-0.4} average={72.8} />
    );
    expect(text(tree, 'health-weight-summary-current-value')).toBe('72.4 kg');
    expect(text(tree, 'health-weight-summary-change-value')).toBe('-0.4 kg');
    expect(text(tree, 'health-weight-summary-average-value')).toBe('72.8 kg');
    expect(text(tree, 'health-weight-summary-trend-value')).toBe('Losing');
  });

  it('SUMMARY-003: honours the lb unit on every tile that carries one', () => {
    const tree = render(
      <HealthWeightSummaryCard unit="lb" current={160} change={2} average={158} />
    );
    expect(text(tree, 'health-weight-summary-current-value')).toBe('160 lb');
    expect(text(tree, 'health-weight-summary-change-value')).toBe('+2 lb');
    expect(text(tree, 'health-weight-summary-average-value')).toBe('158 lb');
  });

  it('SUMMARY-004: a rise beyond the ±0.2 threshold reads Gaining with an explicit +', () => {
    const tree = render(
      <HealthWeightSummaryCard unit="kg" current={80} change={0.6} average={79.5} />
    );
    expect(text(tree, 'health-weight-summary-trend-value')).toBe('Gaining');
    expect(text(tree, 'health-weight-summary-change-value')).toBe('+0.6 kg');
  });

  it('SUMMARY-005: a fall beyond the ±0.2 threshold reads Losing', () => {
    const tree = render(
      <HealthWeightSummaryCard unit="kg" current={80} change={-0.6} average={80.5} />
    );
    expect(text(tree, 'health-weight-summary-trend-value')).toBe('Losing');
  });

  it('SUMMARY-006: a change at or within ±0.2 reads Stable, not Gaining or Losing', () => {
    // The boundary itself (±0.2 exactly) reads Stable — the donor's band is
    // `> 0.2` / `< -0.2`, not `>= 0.2` / `<= -0.2`.
    const tree = render(
      <HealthWeightSummaryCard unit="kg" current={80} change={0.2} average={80} />
    );
    expect(text(tree, 'health-weight-summary-trend-value')).toBe('Stable');

    const zero = render(
      <HealthWeightSummaryCard unit="kg" current={80} change={0} average={80} />
    );
    expect(text(zero, 'health-weight-summary-trend-value')).toBe('Stable');

    const negativeEdge = render(
      <HealthWeightSummaryCard unit="kg" current={80} change={-0.2} average={80} />
    );
    expect(text(negativeEdge, 'health-weight-summary-trend-value')).toBe('Stable');
  });

  it('SUMMARY-007: an unknown change (null) reads — on both the Change and Trend tiles', () => {
    const tree = render(
      <HealthWeightSummaryCard unit="kg" current={80} change={null} average={80} />
    );
    expect(text(tree, 'health-weight-summary-change-value')).toBe('—');
    expect(text(tree, 'health-weight-summary-trend-value')).toBe('—');
  });

  it('SUMMARY-008: accepts a custom testID prefix', () => {
    const tree = render(
      <HealthWeightSummaryCard
        unit="kg"
        current={72}
        change={0}
        average={72}
        testID="custom-weight-summary"
      />
    );
    expect(has(tree, 'custom-weight-summary')).toBe(true);
    expect(has(tree, 'custom-weight-summary-current')).toBe(true);
    expect(text(tree, 'custom-weight-summary-current-value')).toBe('72 kg');
  });
});
