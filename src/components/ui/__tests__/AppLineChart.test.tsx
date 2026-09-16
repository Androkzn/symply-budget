/**
 * AppLineChart — pure axis/format helpers + a real render (with gifted-charts
 * mocked) asserting the data map, axis ceiling, y-labels, and the
 * area/stepped/curved prop wiring.
 */
let lastLineProps: Record<string, unknown> = {};
jest.mock('react-native-gifted-charts', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    LineChart: (p: Record<string, unknown>) => {
      lastLineProps = p;
      return React.createElement(View, { testID: 'line' });
    },
  };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { AppLineChart, niceLineMax, formatPercentShort, type AppLinePoint } from '../AppLineChart';

async function render(node: React.ReactElement) {
  await act(async () => {
    ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
}

beforeEach(() => {
  lastLineProps = {};
});

describe('niceLineMax', () => {
  it('rounds up with headroom so the top point never clips', () => {
    expect(niceLineMax(4.09)).toBeGreaterThanOrEqual(4.09 * 1.15);
    expect(niceLineMax(4.09)).toBeLessThanOrEqual(6);
  });

  it('returns 1 for an empty / non-positive / non-finite max', () => {
    expect(niceLineMax(0)).toBe(1);
    expect(niceLineMax(-5)).toBe(1);
    expect(niceLineMax(NaN)).toBe(1);
  });

  it('scales by magnitude for large values', () => {
    expect(niceLineMax(9000)).toBeGreaterThanOrEqual(9000);
    expect(niceLineMax(9000)).toBeLessThanOrEqual(12500);
  });
});

describe('formatPercentShort', () => {
  it('drops decimals for whole percents and keeps two otherwise', () => {
    expect(formatPercentShort(4)).toBe('4%');
    expect(formatPercentShort(4.09)).toBe('4.09%');
  });
});

const RATES: AppLinePoint[] = [
  { value: 2.14, label: '2021' },
  { value: 4.09, label: '2025' },
  { value: 5.15, label: '2028' },
];

describe('AppLineChart render', () => {
  it('maps points to gifted data and builds sections+1 y-labels', async () => {
    await render(<AppLineChart data={RATES} width={320} formatValue={formatPercentShort} />);
    const data = lastLineProps.data as Array<{ value: number; label: string }>;
    expect(data.map((d) => d.value)).toEqual([2.14, 4.09, 5.15]);
    expect(data.map((d) => d.label)).toEqual(['2021', '2025', '2028']);
    // Ceiling clears the tallest point.
    expect(lastLineProps.maxValue as number).toBeGreaterThanOrEqual(5.15);
    // noOfSections + 1 y-axis labels.
    expect((lastLineProps.yAxisLabelTexts as string[]).length).toBe(
      (lastLineProps.noOfSections as number) + 1
    );
  });

  it('draws a stepped, non-curved line when stepped', async () => {
    await render(<AppLineChart data={RATES} width={320} stepped />);
    expect(lastLineProps.stepChart).toBe(true);
    expect(lastLineProps.curved).toBe(false);
  });

  it('curves the line and skips fill by default', async () => {
    await render(<AppLineChart data={RATES} width={320} />);
    expect(lastLineProps.stepChart).toBe(false);
    expect(lastLineProps.curved).toBe(true);
    expect(lastLineProps.areaChart).toBe(false);
    expect(lastLineProps.startFillColor).toBeUndefined();
  });

  it('fills under the line when area is set', async () => {
    await render(<AppLineChart data={RATES} width={320} area color="#00aabb" />);
    expect(lastLineProps.areaChart).toBe(true);
    expect(lastLineProps.startFillColor).toBe('#00aabb');
    expect(lastLineProps.color).toBe('#00aabb');
  });

  it('produces a valid axis for an empty series', async () => {
    await render(<AppLineChart data={[]} width={320} />);
    expect(lastLineProps.data as unknown[]).toEqual([]);
    expect(lastLineProps.maxValue).toBe(1);
  });

  it('defaults a missing point label to an empty string', async () => {
    await render(<AppLineChart data={[{ value: 3 }, { value: 5 }]} width={320} />);
    const data = lastLineProps.data as Array<{ label: string }>;
    expect(data.map((d) => d.label)).toEqual(['', '']);
  });

  it('omits the second series unless one is passed', async () => {
    await render(<AppLineChart data={RATES} width={320} />);
    expect(lastLineProps.data2).toBeUndefined();
  });

  it('scales a second series to the SAME ceiling so the crossing point is truthful', async () => {
    // Cumulative interest vs principal: the taller series must set the ceiling for
    // both, otherwise the lines cross at the wrong place.
    const interest: AppLinePoint[] = [
      { value: 20, label: "'26" },
      { value: 60, label: "'31" },
    ];
    const principal: AppLinePoint[] = [
      { value: 10, label: "'26" },
      { value: 90, label: "'31" },
    ];
    await render(
      <AppLineChart data={interest} data2={principal} width={320} color="orange" color2="teal" />
    );
    expect((lastLineProps.data2 as Array<{ value: number }>).map((d) => d.value)).toEqual([10, 90]);
    expect(lastLineProps.color).toBe('orange');
    expect(lastLineProps.color2).toBe('teal');
    // Ceiling clears the SECOND series' max (90), not just the first's (60).
    expect(lastLineProps.maxValue as number).toBeGreaterThanOrEqual(90);
  });

  it('omits per-point value text by default', async () => {
    await render(<AppLineChart data={RATES} width={320} />);
    const data = lastLineProps.data as Array<{ dataPointText?: string }>;
    expect(data.every((d) => d.dataPointText === undefined)).toBe(true);
    expect(lastLineProps.textColor1).toBeUndefined();
  });

  it('labels every point with its own formatted value when showValues is set', async () => {
    await render(
      <AppLineChart data={RATES} width={320} formatValue={formatPercentShort} showValues />
    );
    const data = lastLineProps.data as Array<{ dataPointText?: string }>;
    expect(data.map((d) => d.dataPointText)).toEqual(['2.14%', '4.09%', '5.15%']);
    expect(lastLineProps.textColor1).toBeDefined();
  });

  it('labels the SECOND series too, in its own color', async () => {
    await render(
      <AppLineChart
        data={RATES}
        data2={[{ value: 3 }, { value: 4 }, { value: 5 }]}
        width={320}
        color2="teal"
        showValues
      />
    );
    const data2 = lastLineProps.data2 as Array<{ dataPointText?: string }>;
    expect(data2.map((d) => d.dataPointText)).toEqual(['3', '4', '5']);
    expect(lastLineProps.textColor2).toBe('teal');
  });

  // A live device check (2026-08-01) on a two-point 0–100% normalized chart
  // found exactly this: the ceiling point's "below" label landed on top of the
  // next gridline down, and the floor point's landed on top of the x-axis date
  // row — both illegible. `pointLabelShiftY` pins either extreme "above"
  // regardless of the caller's preference; this suite locks that in.
  describe('per-point label position near an axis edge', () => {
    const EDGE_DATA = [{ value: 0 }, { value: 50 }, { value: 100 }];

    it('pins a point near the CEILING "above" even when the chart prefers "below"', async () => {
      await render(
        <AppLineChart data={EDGE_DATA} width={320} axisMax={100} showValues valueLabelPosition="below" />
      );
      const data = lastLineProps.data as Array<{ value: number; textShiftY?: number }>;
      expect(data.find((d) => d.value === 100)?.textShiftY).toBe(-10);
    });

    it('pins a point near the FLOOR "above" even when the chart prefers "below"', async () => {
      await render(
        <AppLineChart data={EDGE_DATA} width={320} axisMax={100} showValues valueLabelPosition="below" />
      );
      const data = lastLineProps.data as Array<{ value: number; textShiftY?: number }>;
      expect(data.find((d) => d.value === 0)?.textShiftY).toBe(-10);
    });

    it('honours "below" for a point comfortably in the middle of the axis', async () => {
      await render(
        <AppLineChart data={EDGE_DATA} width={320} axisMax={100} showValues valueLabelPosition="below" />
      );
      const data = lastLineProps.data as Array<{ value: number; textShiftY?: number }>;
      expect(data.find((d) => d.value === 50)?.textShiftY).toBe(14);
    });

    it('defaults every point "above" when the chart has no preference', async () => {
      await render(<AppLineChart data={EDGE_DATA} width={320} axisMax={100} showValues />);
      const data = lastLineProps.data as Array<{ textShiftY?: number }>;
      expect(data.every((d) => d.textShiftY === -10)).toBe(true);
    });
  });
});
