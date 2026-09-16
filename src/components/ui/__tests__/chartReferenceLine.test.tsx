/**
 * The reference rule on `AppLineChart` / `AppBarChart`.
 *
 * WHY THIS EXISTS: nearly every chart in the donor Symply Health app is "a
 * series plus a dashed rule" — calories vs goal, steps vs target, weight vs
 * goal. A series without the rule cannot answer the only question the user is
 * actually asking, which is whether they are above or below the line. The UI
 * parity audit counted 66 chart marks across 13 donor chart blocks and found
 * the missing reference line to be the single shared primitive gap blocking
 * most of them.
 *
 * The load-bearing property is the CEILING: a goal above every data point must
 * still render inside the plot. If the rule were excluded from the axis maximum
 * it would clip at the top edge in exactly the case it matters most — when you
 * are far below your target.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { AppBarChart } from '../AppBarChart';
import { AppLineChart, lineAxis, niceLineMax } from '../AppLineChart';

jest.mock('react-native-gifted-charts', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  // Capture the props each chart receives so the reference config can be
  // asserted without depending on the library's SVG output.
  return {
    LineChart: (props: Record<string, unknown>) =>
      ReactMock.createElement(View, { testID: 'line-chart', accessibilityValue: { text: JSON.stringify({
        showReferenceLine1: props.showReferenceLine1 ?? null,
        referenceLine1Position: props.referenceLine1Position ?? null,
        maxValue: props.maxValue ?? null,
        yAxisOffset: props.yAxisOffset ?? null,
        yAxisLabelTexts: props.yAxisLabelTexts ?? null,
      }) } }),
    BarChart: (props: Record<string, unknown>) =>
      ReactMock.createElement(View, { testID: 'bar-chart', accessibilityValue: { text: JSON.stringify({
        showReferenceLine1: props.showReferenceLine1 ?? null,
        referenceLine1Position: props.referenceLine1Position ?? null,
        maxValue: props.maxValue ?? null,
      }) } }),
  };
});

async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{element}</ThemeProvider>);
  });
  return tree;
}

function chartProps(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const node = tree.root.find((n) => typeof n.type === 'string' && n.props?.testID === testID);
  return JSON.parse(node.props.accessibilityValue.text) as {
    showReferenceLine1: boolean | null;
    referenceLine1Position: number | null;
    maxValue: number | null;
    yAxisOffset?: number | null;
    yAxisLabelTexts?: string[] | null;
  };
}

const LINE_DATA = [{ value: 10 }, { value: 20 }, { value: 30 }];
const BAR_DATA = [
  { value: 10, label: 'Mon' },
  { value: 20, label: 'Tue' },
];

describe('AppLineChart — reference rule', () => {
  it('CHART-REF-001: draws no rule when no reference value is given', async () => {
    const tree = await render(<AppLineChart data={LINE_DATA} width={300} />);
    expect(chartProps(tree, 'line-chart').showReferenceLine1).toBeNull();
  });

  it('CHART-REF-002: draws the rule at the given value, in data units', async () => {
    const tree = await render(<AppLineChart data={LINE_DATA} width={300} referenceValue={25} />);
    const props = chartProps(tree, 'line-chart');
    expect(props.showReferenceLine1).toBe(true);
    // Same units as the series — never a fraction or a pixel offset.
    expect(props.referenceLine1Position).toBe(25);
  });

  it('CHART-REF-003: a goal ABOVE every point raises the ceiling so it cannot clip', async () => {
    // The case the rule exists for: you are well below target.
    const withoutRule = await render(<AppLineChart data={LINE_DATA} width={300} />);
    const withRule = await render(
      <AppLineChart data={LINE_DATA} width={300} referenceValue={500} />
    );

    const bare = chartProps(withoutRule, 'line-chart').maxValue ?? 0;
    const ruled = chartProps(withRule, 'line-chart').maxValue ?? 0;

    expect(ruled).toBeGreaterThan(bare);
    expect(ruled).toBeGreaterThanOrEqual(500);
    // And it still lands on the shared "nice number" ladder, not a raw 500.
    expect(ruled).toBe(niceLineMax(500));
  });

  it('CHART-REF-004: a goal BELOW the data does not shrink the ceiling', async () => {
    // Clamping down to the goal would push the series off the top of the plot.
    const tree = await render(<AppLineChart data={LINE_DATA} width={300} referenceValue={5} />);
    expect(chartProps(tree, 'line-chart').maxValue ?? 0).toBeGreaterThanOrEqual(30);
  });

  it('CHART-REF-005: a non-finite reference is ignored rather than drawn', async () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const tree = await render(
        <AppLineChart data={LINE_DATA} width={300} referenceValue={bad} />
      );
      expect(chartProps(tree, 'line-chart').showReferenceLine1).toBeNull();
    }
  });

  it('CHART-REF-006: a zero goal still draws — zero is a real target', async () => {
    const tree = await render(<AppLineChart data={LINE_DATA} width={300} referenceValue={0} />);
    expect(chartProps(tree, 'line-chart').showReferenceLine1).toBe(true);
    expect(chartProps(tree, 'line-chart').referenceLine1Position).toBe(0);
  });
});

/**
 * The optional TRUNCATED axis.
 *
 * A zero-based axis is the right default and is non-negotiable for bars, where
 * length encodes magnitude. On a line chart position encodes value, and some
 * series live in a narrow band a long way from zero — body weight (71.2 … 72.4
 * kg) is the case this exists for. Forced to zero, every real movement
 * collapses into a pixel or two and a goal rule four kilos away is drawn
 * effectively on top of the data, which defeats the only question the rule
 * exists to answer.
 */
describe('AppLineChart — truncated axis', () => {
  const WEIGHT = [{ value: 79 }, { value: 80 }, { value: 81 }];

  it('CHART-BASE-001: lineAxis is zero-based unless a floor is asked for', () => {
    const axis = lineAxis(81);
    expect(axis.floor).toBe(0);
    expect(axis.span).toBe(niceLineMax(81));
    expect(axis.ticks[0]).toBe(0);
  });

  it('CHART-BASE-002: a floor lifts every tick and shrinks the span to match', () => {
    const axis = lineAxis(81, 75);
    expect(axis.floor).toBe(75);
    expect(axis.ticks[0]).toBe(75);
    expect(axis.ticks[axis.ticks.length - 1]).toBe(75 + axis.span);
    // The plot now covers 6 kg instead of 81, which is what makes a 1 kg move
    // visible at all.
    expect(axis.span).toBeLessThan(20);
  });

  it('CHART-BASE-003: a floor at or above the data is IGNORED, never honoured', () => {
    // Honouring it would push the whole series underneath the x-axis.
    expect(lineAxis(81, 81).floor).toBe(0);
    expect(lineAxis(81, 200).floor).toBe(0);
    expect(lineAxis(81, -5).floor).toBe(0);
    expect(lineAxis(81, NaN).floor).toBe(0);
  });

  it('CHART-BASE-004: the chart passes the floor to the library as an axis OFFSET', async () => {
    const tree = await render(<AppLineChart data={WEIGHT} width={300} baselineValue={75} />);
    const props = chartProps(tree, 'line-chart');
    // gifted-charts plots `value - yAxisOffset`, so the ceiling it scales to is
    // the SPAN, not the absolute maximum.
    expect(props.yAxisOffset).toBe(75);
    expect(props.maxValue).toBe(lineAxis(81, 75).span);
  });

  it('CHART-BASE-005: the y-axis LABELS still read as absolute weights', async () => {
    const tree = await render(<AppLineChart data={WEIGHT} width={300} baselineValue={75} />);
    const labels = chartProps(tree, 'line-chart').yAxisLabelTexts ?? [];
    // A truncated axis whose labels started at 0 would be a lie twice over.
    expect(Number(labels[0])).toBe(75);
    expect(Number(labels[labels.length - 1])).toBeGreaterThan(81);
  });

  it('CHART-BASE-006: the goal rule is still passed in RAW data units', async () => {
    // The library subtracts `yAxisOffset` from the rule itself, so pre-shifting
    // it here would draw the goal at the wrong height.
    const tree = await render(
      <AppLineChart data={WEIGHT} width={300} baselineValue={75} referenceValue={77} />
    );
    expect(chartProps(tree, 'line-chart').referenceLine1Position).toBe(77);
  });

  it('CHART-BASE-007: omitting the floor leaves every existing chart untouched', async () => {
    const tree = await render(<AppLineChart data={LINE_DATA} width={300} />);
    expect(chartProps(tree, 'line-chart').yAxisOffset).toBe(0);
    expect(chartProps(tree, 'line-chart').maxValue).toBe(niceLineMax(30));
  });
});

describe('AppBarChart — reference rule', () => {
  it('CHART-REF-007: draws no rule when no reference value is given', async () => {
    const tree = await render(<AppBarChart data={BAR_DATA} width={300} />);
    expect(chartProps(tree, 'bar-chart').showReferenceLine1).toBeNull();
  });

  it('CHART-REF-008: draws the target rule across the bars', async () => {
    const tree = await render(<AppBarChart data={BAR_DATA} width={300} referenceValue={15} />);
    const props = chartProps(tree, 'bar-chart');
    expect(props.showReferenceLine1).toBe(true);
    expect(props.referenceLine1Position).toBe(15);
  });

  it('CHART-REF-009: a target above every bar raises the ceiling', async () => {
    const tree = await render(<AppBarChart data={BAR_DATA} width={300} referenceValue={400} />);
    expect(chartProps(tree, 'bar-chart').maxValue ?? 0).toBeGreaterThanOrEqual(400);
  });

  it('CHART-REF-010: a non-finite target is ignored', async () => {
    const tree = await render(<AppBarChart data={BAR_DATA} width={300} referenceValue={NaN} />);
    expect(chartProps(tree, 'bar-chart').showReferenceLine1).toBeNull();
  });
});
