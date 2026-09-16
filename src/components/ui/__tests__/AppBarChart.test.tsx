/* eslint-disable @typescript-eslint/no-require-imports -- Jest mock factories load their own dependencies. */
// Guards the per-bar value-label policy: labels are drawn on short, ALL-POSITIVE
// single series, but are suppressed for grouped series, when `hideValueLabels`
// is set, and — critically — for any series containing a negative bar (a
// per-bar topLabelComponent corrupts gifted-charts' negative bar geometry).
let lastBarProps: Record<string, unknown> = {};
jest.mock('react-native-gifted-charts', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    BarChart: (p: Record<string, unknown>) => {
      lastBarProps = p;
      return React.createElement(View, { testID: 'bar' });
    },
  };
});

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import { Chart } from '@theme/designTokens';

import {
  AppBarChart,
  type AppBarDatum,
  type AppBarGroup,
  type AppBarStack,
} from '../AppBarChart';

async function render(node: React.ReactElement) {
  let instance!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    instance = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return instance;
}

function renderedTexts(instance: ReactTestRenderer.ReactTestRenderer) {
  return instance.root
    .findAllByType(Text)
    .map((n) => n.props.children)
    .filter((c): c is string => typeof c === 'string');
}

/** Flattened style of every column in the custom x-axis label row. */
function labelColumnStyles(instance: ReactTestRenderer.ReactTestRenderer) {
  const row = instance.root.findAllByProps({ testID: 'chart-x-axis-labels' })[0];
  const columns = row.props.children as Array<{ props: { style: unknown } }>;
  return columns.map(
    (col) =>
      StyleSheet.flatten(col.props.style) as {
        width: number;
        marginLeft: number;
        marginRight: number;
      },
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const labelled = () =>
  (lastBarProps.data as Array<{ topLabelComponent?: unknown }>).filter(
    (d) => typeof d.topLabelComponent === 'function',
  ).length;

const POS: AppBarDatum[] = [
  { value: 100, label: 'Jan' },
  { value: 250, label: 'Feb' },
];
const DIVERGING: AppBarDatum[] = [
  { value: 100, label: 'Jan' },
  { value: -250, label: 'Feb' },
];

beforeEach(() => {
  lastBarProps = {};
});

describe('AppBarChart — per-bar value labels', () => {
  it('labels every bar for a short all-positive series', async () => {
    await render(<AppBarChart data={POS} width={320} />);
    expect(labelled()).toBe(2);
  });

  it('suppresses labels when the series contains a negative bar', async () => {
    await render(<AppBarChart data={DIVERGING} width={320} allowNegative />);
    expect(labelled()).toBe(0);
  });

  it('suppresses labels when hideValueLabels is set', async () => {
    await render(<AppBarChart data={POS} width={320} hideValueLabels />);
    expect(labelled()).toBe(0);
  });

  it('never labels grouped bars (a legend names the series)', async () => {
    const groups: AppBarGroup[] = [
      { label: 'Jan', bars: [{ value: 100, frontColor: '#a' }, { value: 50, frontColor: '#b' }] },
    ];
    await render(<AppBarChart groups={groups} width={320} />);
    expect(labelled()).toBe(0);
  });
});

describe('AppBarChart — stacked bars', () => {
  const STACKS: AppBarStack[] = [
    // Surplus: spending + net stack up to income (23000).
    { label: 'Jan', segments: [{ value: 21000, color: '#spend' }, { value: 2000, color: '#green' }] },
    // Deficit: spending up, net (-3000) below the axis.
    { label: 'Feb', segments: [{ value: 24000, color: '#spend' }, { value: -3000, color: '#red' }] },
  ];

  it('drives the chart via stackData, not data', async () => {
    await render(<AppBarChart stacks={STACKS} width={320} allowNegative />);
    expect(lastBarProps.data).toBeUndefined();
    const sd = lastBarProps.stackData as Array<{
      label: string;
      stacks: Array<Record<string, unknown>>;
    }>;
    expect(sd.map((s) => s.label)).toEqual(['Jan', 'Feb']);
    expect(sd[0].stacks.map((x) => x.value)).toEqual([21000, 2000]);
    expect(sd[1].stacks.map((x) => x.value)).toEqual([24000, -3000]);
  });

  it('rounds only the free end: top of the top segment, bottom of a deficit', async () => {
    await render(<AppBarChart stacks={STACKS} width={320} allowNegative />);
    const sd = lastBarProps.stackData as Array<{ stacks: Array<Record<string, unknown>> }>;
    // Surplus (Jan): green net is the top segment → rounds top; spending base stays square.
    expect(sd[0].stacks[0].borderTopLeftRadius).toBeUndefined();
    expect(sd[0].stacks[1].borderTopLeftRadius).toBeGreaterThan(0);
    // Deficit (Feb): spending is the topmost positive → rounds top; red net hangs below → rounds bottom.
    expect(sd[1].stacks[0].borderTopLeftRadius).toBeGreaterThan(0);
    expect(sd[1].stacks[1].borderBottomLeftRadius).toBeGreaterThan(0);
    expect(sd[1].stacks[1].borderTopLeftRadius).toBeUndefined();
  });

  it('rounds single-series bars on their free end (top up, visible tip down)', async () => {
    await render(<AppBarChart data={DIVERGING} width={320} allowNegative />);
    const d = lastBarProps.data as Array<Record<string, unknown>>;
    // gifted-charts reads the `barBorder*`-prefixed names for single-series bars
    // (the unprefixed RN names are ignored here → bar renders square).
    expect(d[0].barBorderTopLeftRadius).toBeGreaterThan(0); // +100 → top
    expect(d[0].barBorderTopRightRadius).toBeGreaterThan(0);
    // A negative bar is drawn upward then flipped 180° by the library, so its
    // TOP radius is what renders at the visual bottom. Asking for the bottom
    // radius here would round the end welded to the zero line instead.
    expect(d[1].barBorderTopLeftRadius).toBeGreaterThan(0); // −250 → visual bottom
    expect(d[1].barBorderTopRightRadius).toBeGreaterThan(0);
    expect(d[1].barBorderBottomLeftRadius).toBeUndefined();
    expect(d[1].barBorderBottomRightRadius).toBeUndefined();
  });

  it('scales the axis to the positive stack total and opens a negative region for a deficit', async () => {
    await render(<AppBarChart stacks={STACKS} width={320} allowNegative />);
    // Ceiling clears the tallest stacked total (spending + surplus = 24000).
    expect(lastBarProps.maxValue as number).toBeGreaterThanOrEqual(24000);
    // A deficit segment (-3000) opens at least one section below the x-axis.
    expect(lastBarProps.noOfSectionsBelowXAxis as number).toBeGreaterThan(0);
    // …and the x-axis labels are pushed below that region so they clear the bars.
    expect(lastBarProps.xAxisLabelsVerticalShift as number).toBeGreaterThan(0);
  });

  it('renders every month at the same whole-pixel width (no sub-pixel drift)', async () => {
    // A width that makes the raw bar width fractional (297/(7*1.8) ≈ 23.57pt):
    // fractional widths/gaps round neighbouring bars to different pixel widths,
    // so the geometry passed to gifted-charts must be floored to whole pixels.
    const months: AppBarStack[] = Array.from({ length: 7 }, (_, i) => ({
      label: `M${i}`,
      segments: [
        { value: 20000, color: '#spend' },
        { value: i % 2 === 0 ? 2000 : -3000, color: '#net' },
      ],
    }));
    await render(<AppBarChart stacks={months} width={297} allowNegative />);
    // One uniform bar width for all months, and it's an integer number of pixels.
    expect(Number.isInteger(lastBarProps.barWidth as number)).toBe(true);
    // The gap between bars is whole-pixel too, so every bar's left edge (built
    // from initialSpacing + i*(barWidth+spacing)) also lands on a whole pixel.
    expect(Number.isInteger(lastBarProps.spacing as number)).toBe(true);
    expect(Number.isInteger(lastBarProps.initialSpacing as number)).toBe(true);
  });

  it('keeps x-axis labels at the baseline for an all-positive series', async () => {
    await render(
      <AppBarChart
        stacks={[{ label: 'Jan', segments: [{ value: 21000, color: '#s' }, { value: 2000, color: '#g' }] }]}
        width={320}
        allowNegative
      />,
    );
    expect(lastBarProps.noOfSectionsBelowXAxis).toBe(0);
    expect(lastBarProps.xAxisLabelsVerticalShift).toBe(0);
  });
});

// gifted-charts positions a negative bar's x-axis label by rotating the whole
// bar+label wrapper 180° and re-deriving the offset from THAT bar's own
// (per-value) height, so months with a small deficit land their label at a
// different height than months with a large one — the built-in mechanism is
// unusable for a diverging chart. AppBarChart mutes it and renders its own
// flat label row instead (`showCustomXAxisLabels` in AppBarChart.tsx).
describe('AppBarChart — custom x-axis label row (diverging series)', () => {
  it('mutes gifted-charts per-item labels for a single-series diverging chart', async () => {
    await render(<AppBarChart data={DIVERGING} width={320} allowNegative />);
    const d = lastBarProps.data as Array<{ label: string }>;
    expect(d.map((x) => x.label)).toEqual(['', '']);
  });

  it('renders every month label, in order, from its own row', async () => {
    const instance = await render(<AppBarChart data={DIVERGING} width={320} allowNegative />);
    expect(renderedTexts(instance)).toEqual(expect.arrayContaining(['Jan', 'Feb']));
  });

  it('mutes gifted-charts per-item labels for a grouped diverging chart and labels by group', async () => {
    const groups: AppBarGroup[] = [
      { label: '2025', bars: [{ value: 100, frontColor: '#a' }, { value: -50, frontColor: '#b' }] },
      { label: '2026', bars: [{ value: 80, frontColor: '#a' }, { value: 40, frontColor: '#b' }] },
    ];
    const instance = await render(<AppBarChart groups={groups} width={320} allowNegative />);
    const d = lastBarProps.data as Array<{ label: string }>;
    expect(d.every((x) => x.label === '')).toBe(true);
    expect(renderedTexts(instance)).toEqual(expect.arrayContaining(['2025', '2026']));
  });

  // Regression: the row was padded by `initialSpacing` only, ignoring the y-axis
  // label gutter the library insets the bars by — so every month label sat a full
  // 44pt gutter to the LEFT of its bar (Aug's label under Jul's bar, etc.).
  it('insets the label row by the y-axis gutter + initialSpacing, matching bar 0', async () => {
    const instance = await render(<AppBarChart data={DIVERGING} width={320} allowNegative />);
    const row = instance.root.findAllByProps({ testID: 'chart-x-axis-labels' })[0];
    const rowStyle = StyleSheet.flatten(row.props.style) as { paddingLeft: number };
    // Where gifted-charts actually puts bar 0's left edge.
    const barOriginX =
      (lastBarProps.yAxisLabelWidth as number) + (lastBarProps.initialSpacing as number);
    expect(rowStyle.paddingLeft).toBe(barOriginX);
  });

  it('advances each label column by exactly one bar pitch, so the row stays on its bars', async () => {
    const instance = await render(<AppBarChart data={DIVERGING} width={320} allowNegative />);
    const pitch = (lastBarProps.barWidth as number) + (lastBarProps.spacing as number);
    for (const style of labelColumnStyles(instance)) {
      // The negative left margin and the positive right one cancel, so however
      // wide the text box is, the column still advances one bar's worth.
      expect(style.marginLeft + style.width + style.marginRight).toBe(pitch);
    }
  });

  // Regression: a 12-month year clamps bars to `Chart.barMinWidth` (14pt). A
  // label box sized to the bar alone is narrower than "Jan" at 9pt, so every
  // month rendered as an ellipsised initial — "J…", "F…", "M…".
  it('gives the label box the bar PLUS its gap, centred, so short month names fit', async () => {
    const year: AppBarDatum[] = MONTHS.map((label, i) => ({
      label,
      value: i % 3 === 0 ? -2500 : 7500,
    }));
    const instance = await render(<AppBarChart data={year} width={294} allowNegative />);
    const barWidth = lastBarProps.barWidth as number;
    const spacing = lastBarProps.spacing as number;
    for (const style of labelColumnStyles(instance)) {
      expect(style.width).toBe(barWidth + spacing);
      // Box centre sits on the bar centre (±½pt when the gap is odd).
      const centreOffset = style.marginLeft + style.width / 2 - barWidth / 2;
      expect(Math.abs(centreOffset)).toBeLessThanOrEqual(0.5);
    }
    // The clamped bar alone (14pt) is what was too narrow for a month name; the
    // gap is what buys the room back. (Native text truncation itself isn't
    // observable in a test renderer, so the box width is the guard.)
    expect(barWidth).toBe(Chart.barMinWidth);
    expect(spacing).toBeGreaterThan(0);
  });

  it('leaves gifted-charts per-item labels alone for an all-positive series', async () => {
    await render(<AppBarChart data={POS} width={320} />);
    const d = lastBarProps.data as Array<{ label: string }>;
    expect(d.map((x) => x.label)).toEqual(['Jan', 'Feb']);
  });

  it('leaves gifted-charts per-item labels alone for a stacked series (no caller opts into diverging stacks)', async () => {
    await render(
      <AppBarChart
        stacks={[
          { label: 'Jan', segments: [{ value: 21000, color: '#s' }, { value: 2000, color: '#g' }] },
          { label: 'Feb', segments: [{ value: 24000, color: '#s' }, { value: -3000, color: '#r' }] },
        ]}
        width={320}
        allowNegative
      />,
    );
    const sd = lastBarProps.stackData as Array<{ label: string }>;
    expect(sd.map((x) => x.label)).toEqual(['Jan', 'Feb']);
  });
});


describe('AppBarChart — values arriving after first sync', () => {
  it('updates zero bars and then changed values without mount-only animation', async () => {
    const tree = await render(<AppBarChart data={[{ label: 'Sep', value: 0 }]} width={320} />);
    for (const value of [1500, -250, 3200]) {
      await act(async () => {
        tree.update(<ThemeProvider><AppBarChart data={[{ label: 'Sep', value }]} width={320} allowNegative /></ThemeProvider>);
      });
      expect(lastBarProps.isAnimated).toBe(false);
      expect(lastBarProps.data).toEqual([expect.objectContaining({ value })]);
    }
  });

  it('refreshes grouped and stacked series using current values', async () => {
    const tree = await render(<AppBarChart groups={[{ label: 'Sep', bars: [{ value: 0, frontColor: '#abc' }] }]} width={320} />);
    await act(async () => {
      tree.update(<ThemeProvider><AppBarChart groups={[{ label: 'Sep', bars: [{ value: 700, frontColor: '#abc' }] }]} width={320} /></ThemeProvider>);
    });
    expect(lastBarProps.isAnimated).toBe(false);
    expect(lastBarProps.data).toEqual([expect.objectContaining({ value: 700 })]);
    await act(async () => {
      tree.update(<ThemeProvider><AppBarChart stacks={[{ label: 'Sep', segments: [{ value: 950, color: '#abc' }] }]} width={320} /></ThemeProvider>);
    });
    expect(lastBarProps.isAnimated).toBe(false);
    expect(lastBarProps.stackData).toEqual([expect.objectContaining({ stacks: [expect.objectContaining({ value: 950 })] })]);
  });
});
