/**
 * HealthWeeklyTrendsWidget — the Home "WEEKLY TRENDS" card.
 *
 * Covers the one piece of real interaction here: tapping a legend key swaps
 * between the default two-separate-charts layout and the combined,
 * 0–100-normalized single-chart view (`combinedNormalizedPoints`), and back.
 * The pure normalization math itself is covered in
 * `healthWeeklyTrendStorage.test.ts` — this suite only checks the toggle
 * wires the right testIDs in and out.
 */

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { HealthWeeklyTrendResponse, HealthWeeklyTrendWindow } from '@api/health';
import { ThemeProvider } from '@contexts/ThemeContext';

import { HealthWeeklyTrendsWidget } from '../HealthWeeklyTrendsWidget';

type Rendered = ReactTestRenderer.ReactTestRenderer;

function render(element: React.ReactElement): Rendered {
  let tree!: Rendered;
  act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{element}</ThemeProvider>);
  });
  return tree;
}

function has(tree: Rendered, testID: string): boolean {
  return tree.root.findAll((n) => n.props?.testID === testID).length > 0;
}

function press(tree: Rendered, testID: string) {
  const node = tree.root.findAll(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function'
  )[0];
  if (!node) throw new Error(`no pressable with testID "${testID}"`);
  act(() => node.props.onPress());
}

function emptyWindow(over: Partial<HealthWeeklyTrendWindow> = {}): HealthWeeklyTrendWindow {
  return {
    week_start: '2026-07-06',
    week_end: '2026-07-12',
    days: [],
    daily_weight: [],
    total_calories: 0,
    avg_calories: 0,
    ...over,
  };
}

const OVERLAPPING_TREND: HealthWeeklyTrendResponse = {
  this_week: emptyWindow({
    avg_calories: 1900,
    days: [
      { date: '2026-07-06', calories: 1800, calorie_goal: 2000 },
      { date: '2026-07-07', calories: 2000, calorie_goal: 2000 },
    ],
    daily_weight: [
      { date: '2026-07-06', weight: 70 },
      { date: '2026-07-07', weight: 71 },
    ],
  }),
  last_week: emptyWindow(),
  change: { calories: 100, weight: 1 },
};

describe('HealthWeeklyTrendsWidget', () => {
  it('WEEKLY-TRENDS-001: shows the log-more-days sentence when there is no trend at all', () => {
    const tree = render(<HealthWeeklyTrendsWidget trend={null} />);
    expect(has(tree, 'health-weekly-trends-empty')).toBe(true);
  });

  it('WEEKLY-TRENDS-002: defaults to two separate charts, each on its own scale', () => {
    const tree = render(<HealthWeeklyTrendsWidget trend={OVERLAPPING_TREND} />);
    expect(has(tree, 'health-weekly-trends-chart-calories')).toBe(true);
    expect(has(tree, 'health-weekly-trends-chart-weight')).toBe(true);
    expect(has(tree, 'health-weekly-trends-chart-combined')).toBe(false);
  });

  it('WEEKLY-TRENDS-003: tapping a legend switches to one combined, normalized chart', () => {
    const tree = render(<HealthWeeklyTrendsWidget trend={OVERLAPPING_TREND} />);
    press(tree, 'health-weekly-trends-legend-calories');
    expect(has(tree, 'health-weekly-trends-chart-combined')).toBe(true);
    expect(has(tree, 'health-weekly-trends-chart-calories')).toBe(false);
    expect(has(tree, 'health-weekly-trends-chart-weight')).toBe(false);
  });

  it('WEEKLY-TRENDS-004: tapping either legend again splits back into separate charts', () => {
    const tree = render(<HealthWeeklyTrendsWidget trend={OVERLAPPING_TREND} />);
    press(tree, 'health-weekly-trends-legend-calories');
    press(tree, 'health-weekly-trends-legend-weight');
    expect(has(tree, 'health-weekly-trends-chart-combined')).toBe(false);
    expect(has(tree, 'health-weekly-trends-chart-calories')).toBe(true);
    expect(has(tree, 'health-weekly-trends-chart-weight')).toBe(true);
  });

  it('WEEKLY-TRENDS-005: combined view explains itself when no day logged both measurements', () => {
    const noOverlap: HealthWeeklyTrendResponse = {
      this_week: emptyWindow({
        days: [{ date: '2026-07-06', calories: 1800, calorie_goal: 2000 }],
        daily_weight: [null],
      }),
      last_week: emptyWindow(),
      change: { calories: null, weight: null },
    };
    const tree = render(<HealthWeeklyTrendsWidget trend={noOverlap} />);
    press(tree, 'health-weekly-trends-legend-weight');
    expect(has(tree, 'health-weekly-trends-chart-combined-empty')).toBe(true);
  });
});
