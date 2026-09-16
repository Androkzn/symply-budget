/**
 * Symply Health — the two donor chart dashboards, rendered.
 *
 * Renders the REAL components through <ThemeProvider>. The derivation maths is
 * covered exhaustively in ../../__tests__/healthDashboards.test.ts; what these
 * cases guard is the part a unit test of a pure function cannot see:
 *
 *   · the charts are actually MOUNTED, with the series handed over intact
 *   · an empty range says so in words and draws no chart at all
 *   · a thinned axis DISCLOSES its sampling in visible text
 *   · every chart carries an accessibilityLabel stating its headline figure
 *   · two or more series always ship a legend, so identity is never colour-alone
 *
 * The chart primitives are stubbed to their inputs — gifted-charts renders
 * through SVG and layout measurement, and what matters here is the data and the
 * colours the dashboards hand it, not the pixels it draws.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { healthChartPalette } from '../../healthDashboards';
import { type WeightEntry } from '../../healthLocalStorage';
import { type MealEntry } from '../../healthNutritionStorage';
import { HealthCaloriesDashboard } from '../HealthCaloriesDashboard';
import { HealthWeightDashboard } from '../HealthWeightDashboard';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

jest.mock('@components/ui/AppLineChart', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    AppLineChart: ({
      data,
      data2,
      color,
      color2,
    }: {
      data: Array<{ value: number; label?: string }>;
      data2?: Array<{ value: number }>;
      color?: string;
      color2?: string;
    }) =>
      ReactMock.createElement(View, {
        testID: 'app-line-chart',
        accessibilityValue: { text: data.map((p) => p.value).join(',') },
        // Everything the assertions need, without rendering SVG.
        accessibilityState: { expanded: !!data2 },
        accessibilityHint: JSON.stringify({
          series2: data2?.map((p) => p.value) ?? null,
          labels: data.map((p) => p.label ?? null),
          color,
          color2,
        }),
      }),
  };
});

jest.mock('@components/ui/AppBarChart', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    AppBarChart: ({
      data,
      stacks,
    }: {
      data?: Array<{ value: number; label: string; frontColor?: string }>;
      stacks?: Array<{ label: string; segments: Array<{ value: number; color: string }> }>;
    }) =>
      ReactMock.createElement(View, {
        testID: stacks ? 'app-bar-chart-stacked' : 'app-bar-chart',
        accessibilityValue: {
          text: (data ?? []).map((d) => d.value).join(','),
        },
        accessibilityHint: JSON.stringify({
          labels: (data ?? stacks ?? []).map((d) => d.label),
          colors: (data ?? []).map((d) => d.frontColor),
          stacks: (stacks ?? []).map((s) => s.segments.map((seg) => seg.value)),
          stackColors: (stacks ?? []).map((s) => s.segments.map((seg) => seg.color)),
        }),
      }),
  };
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const PALETTE = healthChartPalette(false);

function days(from: string, count: number): string[] {
  const [y, m, d] = from.split('-').map(Number);
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10)
  );
}

function weight(date: string, value: number, unit: WeightEntry['unit'] = 'kg'): WeightEntry {
  const [y, m, d] = date.split('-').map(Number);
  return {
    id: `${date}-${value}`,
    value,
    unit,
    loggedAt: new Date(y, m - 1, d, 12, 0, 0).toISOString(),
    date,
    note: '',
    source: 'manual',
  };
}

function meal(over: Partial<MealEntry> = {}): MealEntry {
  return {
    id: over.id ?? `m-${over.date}-${over.calories}`,
    date: over.date ?? '2026-07-13',
    slot: over.slot ?? 'lunch',
    name: over.name ?? 'Soup',
    calories: over.calories ?? 500,
    protein: over.protein ?? 0,
    carbs: over.carbs ?? 0,
    fat: over.fat ?? 0,
    loggedAt: `${over.date ?? '2026-07-13'}T10:00:00.000Z`,
  };
}

function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

function byTestId(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

function hintOf(node: ReactTestRenderer.ReactTestInstance) {
  return JSON.parse(node.props.accessibilityHint as string);
}

async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{element}</ThemeProvider>);
  });
  return tree;
}

/* ------------------------------------------------------------------ */
/* Weight dashboard                                                    */
/* ------------------------------------------------------------------ */

describe('HealthWeightDashboard', () => {
  const window = days('2026-06-15', 29); // 15 Jun .. 13 Jul

  it('HEALTH-WDASH-100: an empty range says so in words and draws no chart at all', async () => {
    const tree = await render(
      <HealthWeightDashboard entries={[]} dayKeys={window} width={320} />
    );

    expect(byTestId(tree, 'health-weight-dashboard').length).toBe(1);
    expect(byTestId(tree, 'health-trends-weight-empty').length).toBe(1);
    expect(byTestId(tree, 'health-weight-dashboard-weekly-empty').length).toBe(1);
    // No flat zero line, and no empty bar chart either.
    expect(byTestId(tree, 'app-line-chart').length).toBe(0);
    expect(byTestId(tree, 'app-bar-chart').length).toBe(0);
    expect(allText(tree.toJSON())).toContain('at least two days');
  });

  it('HEALTH-WDASH-101: a single logged day is still not a trend line', async () => {
    const tree = await render(
      <HealthWeightDashboard entries={[weight('2026-07-13', 80)]} dayKeys={window} width={320} />
    );

    expect(byTestId(tree, 'app-line-chart').length).toBe(0);
    expect(byTestId(tree, 'health-trends-weight-empty').length).toBe(1);
    // One weigh-in is still one week's average, so the bars do render.
    expect(byTestId(tree, 'app-bar-chart').length).toBe(1);
  });

  it('HEALTH-WDASH-102: plots the daily series AND the trailing average on one axis', async () => {
    const tree = await render(
      <HealthWeightDashboard
        entries={[weight('2026-07-13', 79), weight('2026-07-12', 80), weight('2026-07-11', 81)]}
        dayKeys={window}
        width={320}
        averageWindow={3}
      />
    );

    const chart = byTestId(tree, 'app-line-chart')[0];
    expect(chart.props.accessibilityValue.text).toBe('81,80,79');
    const hint = hintOf(chart);
    // Trailing 3-window: [81] → 81 · [81,80] → 80.5 · [81,80,79] → 80.
    expect(hint.series2).toEqual([81, 80.5, 80]);
    // Same length as the primary series — data2 shares its x positions.
    expect(hint.series2).toHaveLength(3);
    expect(hint.color).toBe(PALETTE.weightDaily);
    expect(hint.color2).toBe(PALETTE.weightAverage);
  });

  it('HEALTH-WDASH-103: two series always ship a legend naming both', async () => {
    const tree = await render(
      <HealthWeightDashboard
        entries={[weight('2026-07-13', 79), weight('2026-07-12', 80)]}
        dayKeys={window}
        width={320}
      />
    );

    expect(byTestId(tree, 'health-weight-dashboard-legend').length).toBe(1);
    const text = allText(byTestId(tree, 'health-weight-dashboard-legend')[0]);
    expect(text).toContain('Logged weight');
    expect(text).toContain('7-day average');
  });

  it('HEALTH-WDASH-104: every chart announces its headline figure', async () => {
    const tree = await render(
      <HealthWeightDashboard
        entries={[weight('2026-07-13', 79), weight('2026-07-11', 81)]}
        dayKeys={window}
        width={320}
      />
    );

    const label = byTestId(tree, 'health-weight-dashboard-chart')[0].props.accessibilityLabel;
    expect(label).toContain('latest 79 kg');
    expect(label).toContain('-2 kg');
    expect(label).toContain('7-day average now');

    const weekly = byTestId(tree, 'health-weight-dashboard-weekly')[0].props.accessibilityLabel;
    expect(weekly).toContain('Weekly average weight');
    expect(weekly).toContain('kg');
  });

  it('HEALTH-WDASH-105: the x-axis is labelled by DATE, never by row index', async () => {
    const tree = await render(
      <HealthWeightDashboard
        entries={[weight('2026-07-13', 79), weight('2026-07-11', 81)]}
        dayKeys={window}
        width={320}
      />
    );

    expect(hintOf(byTestId(tree, 'app-line-chart')[0]).labels).toEqual(['11 Jul', '13 Jul']);
    expect(hintOf(byTestId(tree, 'app-bar-chart')[0]).labels).toEqual(['6 Jul', '13 Jul']);
  });

  it('HEALTH-WDASH-106: a thinned axis discloses its sampling in visible text', async () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      weight(days('2026-06-24', 20)[i], 80 + i)
    ).reverse();
    const tree = await render(
      <HealthWeightDashboard entries={entries} dayKeys={window} width={320} />
    );

    const note = byTestId(tree, 'health-trends-axis-note');
    expect(note.length).toBe(1);
    expect(allText(note[0])).toContain('every 3 logged days');
  });

  it('HEALTH-WDASH-107: an unthinned axis makes no claim about sampling', async () => {
    const tree = await render(
      <HealthWeightDashboard
        entries={[weight('2026-07-13', 79), weight('2026-07-12', 80)]}
        dayKeys={window}
        width={320}
      />
    );
    expect(byTestId(tree, 'health-trends-axis-note').length).toBe(0);
  });

  it('HEALTH-WDASH-108: reports latest, change, average, lowest and highest', async () => {
    const tree = await render(
      <HealthWeightDashboard
        entries={[weight('2026-07-13', 79), weight('2026-07-12', 83), weight('2026-07-11', 81)]}
        dayKeys={window}
        width={320}
      />
    );

    expect(allText(byTestId(tree, 'health-trends-weight-latest')[0])).toContain('79 kg');
    expect(allText(byTestId(tree, 'health-trends-weight-change')[0])).toContain('-2 kg');
    expect(allText(byTestId(tree, 'health-trends-weight-average')[0])).toContain('81 kg');
    expect(allText(byTestId(tree, 'health-weight-dashboard-min')[0])).toContain('79 kg');
    expect(allText(byTestId(tree, 'health-weight-dashboard-max')[0])).toContain('83 kg');
  });

  it('HEALTH-WDASH-110: the Change reading needs two days too, and says so in its own words', async () => {
    // The first logged day has nothing to subtract from, so the bar chart would
    // be empty — and an empty bar chart reads as "you weighed nothing".
    const tree = await render(
      <HealthWeightDashboard
        entries={[weight('2026-07-13', 80)]}
        dayKeys={window}
        width={320}
        mode="change"
      />
    );

    expect(byTestId(tree, 'health-weight-dashboard-change-chart').length).toBe(0);
    expect(allText(byTestId(tree, 'health-weight-dashboard-change-empty')[0])).toContain(
      'day-to-day change'
    );
  });

  it('HEALTH-WDASH-111: a flat range announces itself as unchanged, not as "0 kg over the range"', async () => {
    const tree = await render(
      <HealthWeightDashboard
        entries={[weight('2026-07-13', 80), weight('2026-07-12', 80)]}
        dayKeys={window}
        width={320}
      />
    );

    const label = byTestId(tree, 'health-weight-dashboard-chart')[0].props.accessibilityLabel;
    expect(label).toContain('unchanged');
    expect(label).not.toContain('over the range');
  });

  it('HEALTH-WDASH-112: a series that already reaches near zero keeps a zero axis, undisclosed', async () => {
    // Truncating a 3.5–12 kg band (an infant log) would magnify it rather than
    // clarify it, so there is no floor — and therefore nothing to disclose.
    const tree = await render(
      <HealthWeightDashboard
        entries={[weight('2026-07-13', 12), weight('2026-06-20', 3.5)]}
        dayKeys={window}
        width={320}
      />
    );

    expect(byTestId(tree, 'app-line-chart').length).toBe(1);
    expect(byTestId(tree, 'health-weight-dashboard-axis-floor').length).toBe(0);
    expect(allText(byTestId(tree, 'health-trends-weight-latest')[0])).toContain('12 kg');
  });

  it('HEALTH-WDASH-113: the average rule is off until asked for, and the toggle says which', async () => {
    const onToggleAverageLine = jest.fn();
    const tree = await render(
      <HealthWeightDashboard
        entries={[weight('2026-07-13', 79), weight('2026-07-12', 80)]}
        dayKeys={window}
        width={320}
        onToggleAverageLine={onToggleAverageLine}
      />
    );

    const toggle = tree.root.find(
      (n) =>
        n.props?.testID === 'health-weight-dashboard-toggle-average' &&
        typeof n.props?.onPress === 'function'
    );
    // The state is in the words, not only in the fill — a tinted pill alone does
    // not say whether it is the on or the off one.
    expect(allText(toggle)).toContain('Average line off');
    expect(toggle.props.accessibilityState).toEqual({ selected: false });
    // …and with no rule asked for, the legend names only the two series.
    expect(byTestId(tree, 'health-weight-dashboard-legend-rule').length).toBe(0);

    act(() => toggle.props.onPress());
    expect(onToggleAverageLine).toHaveBeenCalled();
  });

  it('HEALTH-WDASH-113b: per-point values are off until asked for, and the toggle says which', async () => {
    const onToggleShowValues = jest.fn();
    const tree = await render(
      <HealthWeightDashboard
        entries={[weight('2026-07-13', 79), weight('2026-07-12', 80)]}
        dayKeys={window}
        width={320}
        onToggleShowValues={onToggleShowValues}
      />
    );

    const toggle = tree.root.find(
      (n) =>
        n.props?.testID === 'health-weight-dashboard-toggle-values' &&
        typeof n.props?.onPress === 'function'
    );
    expect(allText(toggle)).toContain('Values hidden');
    expect(toggle.props.accessibilityState).toEqual({ selected: false });

    act(() => toggle.props.onPress());
    expect(onToggleShowValues).toHaveBeenCalled();
  });

  it('HEALTH-WDASH-114: a thinned WEEKLY axis discloses its sampling too', async () => {
    const longRange = days('2026-05-04', 71); // 11 Mondays, 4 May .. 13 Jul
    const tree = await render(
      <HealthWeightDashboard
        entries={longRange
          .filter((_, i) => i % 7 === 0)
          .map((date, i) => weight(date, 90 - i * 0.4))}
        dayKeys={longRange}
        width={320}
      />
    );

    const note = byTestId(tree, 'health-weight-dashboard-weekly-axis-note');
    expect(note.length).toBe(1);
    expect(allText(note[0])).toContain('every 2 weeks');
  });

  it('HEALTH-WDASH-109: a mixed kg/lb log never puts both units on one axis', async () => {
    const tree = await render(
      <HealthWeightDashboard
        entries={[
          weight('2026-07-13', 80, 'kg'),
          weight('2026-07-12', 178, 'lb'),
          weight('2026-07-11', 81, 'kg'),
        ]}
        dayKeys={window}
        width={320}
      />
    );

    // 178 lb would draw a cliff that never happened — it is excluded outright.
    expect(byTestId(tree, 'app-line-chart')[0].props.accessibilityValue.text).toBe('81,80');
    expect(allText(byTestId(tree, 'health-weight-dashboard-max')[0])).toContain('81 kg');
    expect(allText(tree.toJSON())).not.toContain('178');
  });
});

/* ------------------------------------------------------------------ */
/* Calories dashboard                                                  */
/* ------------------------------------------------------------------ */

describe('HealthCaloriesDashboard', () => {
  const window = days('2026-06-29', 15); // 29 Jun .. 13 Jul

  it('HEALTH-CDASH-120: an empty range says so in words and draws no chart', async () => {
    const tree = await render(
      <HealthCaloriesDashboard meals={[]} goal={2000} dayKeys={window} width={320} />
    );

    expect(byTestId(tree, 'health-calories-dashboard').length).toBe(1);
    expect(byTestId(tree, 'health-calories-dashboard-empty').length).toBe(1);
    expect(byTestId(tree, 'health-calories-dashboard-macros-empty').length).toBe(1);
    expect(byTestId(tree, 'app-bar-chart').length).toBe(0);
    expect(byTestId(tree, 'app-bar-chart-stacked').length).toBe(0);
    expect(allText(byTestId(tree, 'health-calories-dashboard-average')[0])).toContain('—');
  });

  it('HEALTH-CDASH-121: a 15-day window blocks to 7-day bars, coloured by whether the BLOCK MEAN cleared the target', async () => {
    // `window` is 15 days (29 Jun .. 13 Jul); `energySeries` tiles it into
    // 7-day blocks from the newest day backwards (blockDays=7, since
    // ceil(15/1)=15 exceeds MAX_ENERGY_BARS=12 but ceil(15/7)=3 does not). Both
    // logged days fall inside the SAME final block (7 Jul .. 13 Jul), so this
    // renders ONE bar — the mean of the two, not two separate bars — and the
    // two empty blocks before it are dropped rather than drawn at zero.
    const tree = await render(
      <HealthCaloriesDashboard
        meals={[
          meal({ date: '2026-07-10', calories: 1800 }),
          meal({ date: '2026-07-11', calories: 2400, id: 'b' }),
        ]}
        goal={2000}
        dayKeys={window}
        width={320}
      />
    );

    const chart = byTestId(tree, 'app-bar-chart')[0];
    // (1800 + 2400) / 2 = 2100, rounded — over the 2000 goal.
    expect(chart.props.accessibilityValue.text).toBe('2100');
    expect(hintOf(chart).colors).toEqual([PALETTE.caloriesOver]);
    // Labelled by the day the block STARTS, not the days actually logged.
    expect(hintOf(chart).labels).toEqual(['7 Jul']);
  });

  it('HEALTH-CDASH-122: the target is stated in words and both fills are named in a legend', async () => {
    const tree = await render(
      <HealthCaloriesDashboard
        meals={[meal({ date: '2026-07-10', calories: 1800 })]}
        goal={2000}
        dayKeys={window}
        width={320}
      />
    );

    // AppBarChart has no rule mark, so the goal is carried by text + legend
    // rather than by an overlay whose position could not be trusted.
    expect(allText(byTestId(tree, 'health-calories-dashboard-target-note')[0])).toContain(
      'Daily target 2000 kcal'
    );
    const legend = allText(byTestId(tree, 'health-calories-dashboard-legend')[0]);
    expect(legend).toContain('At or under target');
    expect(legend).toContain('Over target');
  });

  it('HEALTH-CDASH-123: with no target set it says so rather than inventing a goal line', async () => {
    const tree = await render(
      <HealthCaloriesDashboard
        meals={[meal({ date: '2026-07-10', calories: 1800 })]}
        goal={0}
        dayKeys={window}
        width={320}
      />
    );

    expect(allText(byTestId(tree, 'health-calories-dashboard-target-note')[0])).toContain(
      'No daily calorie target set'
    );
    expect(allText(byTestId(tree, 'health-calories-dashboard-on-target')[0])).toContain('0/1');
  });

  it('HEALTH-CDASH-124: the intake chart announces days-on-target and the average', async () => {
    const tree = await render(
      <HealthCaloriesDashboard
        meals={[
          meal({ date: '2026-07-10', calories: 1800 }),
          meal({ date: '2026-07-11', calories: 2400, id: 'b' }),
        ]}
        goal={2000}
        dayKeys={window}
        width={320}
      />
    );

    const label = byTestId(tree, 'health-calories-dashboard-chart')[0].props.accessibilityLabel;
    expect(label).toContain('2000 kcal target');
    expect(label).toContain('1 of 2 logged days at or under it');
    expect(label).toContain('Average 2100 kcal');
  });

  it('HEALTH-CDASH-125: reports average, days on target, and the best and worst day', async () => {
    const tree = await render(
      <HealthCaloriesDashboard
        meals={[
          meal({ date: '2026-07-09', calories: 400 }),
          meal({ date: '2026-07-10', calories: 1950, id: 'b' }),
          meal({ date: '2026-07-11', calories: 2300, id: 'c' }),
        ]}
        goal={2000}
        dayKeys={window}
        width={320}
      />
    );

    expect(allText(byTestId(tree, 'health-calories-dashboard-average')[0])).toContain('1550 kcal');
    expect(allText(byTestId(tree, 'health-calories-dashboard-on-target')[0])).toContain('2/3');
    // Closest to target, not the lowest intake.
    expect(allText(byTestId(tree, 'health-calories-dashboard-best')[0])).toContain('10 Jul');
    // The 400 kcal day is the biggest miss even though it is the smallest number.
    expect(allText(byTestId(tree, 'health-calories-dashboard-worst')[0])).toContain('9 Jul');
    expect(allText(tree.toJSON())).toContain('Averages cover the days you logged');
  });

  it('HEALTH-CDASH-126: stacks the macro split per week, each stack totalling 100', async () => {
    const tree = await render(
      <HealthCaloriesDashboard
        meals={[
          meal({ date: '2026-07-12', calories: 800, protein: 100, carbs: 100, fat: 0 }),
          meal({ date: '2026-07-13', calories: 450, protein: 0, carbs: 0, fat: 50, id: 'b' }),
        ]}
        goal={2000}
        dayKeys={window}
        width={320}
      />
    );

    const macros = byTestId(tree, 'app-bar-chart-stacked')[0];
    const hint = hintOf(macros);
    expect(hint.stacks).toEqual([
      [50, 50, 0],
      [0, 0, 100],
    ]);
    for (const stack of hint.stacks) {
      expect(stack.reduce((a: number, b: number) => a + b, 0)).toBe(100);
    }
    expect(hint.labels).toEqual(['6 Jul', '13 Jul']);
    expect(hint.stackColors[0]).toEqual([
      PALETTE.macroProtein,
      PALETTE.macroCarbs,
      PALETTE.macroFat,
    ]);
  });

  it('HEALTH-CDASH-127: the macro legend direct-labels shares that add to 100', async () => {
    const tree = await render(
      <HealthCaloriesDashboard
        meals={[meal({ date: '2026-07-13', calories: 900, protein: 90, carbs: 90, fat: 40 })]}
        goal={2000}
        dayKeys={window}
        width={320}
      />
    );

    const legend = allText(byTestId(tree, 'health-calories-dashboard-macro-legend')[0]);
    // Equal energy three ways — largest-remainder gives 34/33/33, never 33/33/33.
    expect(legend).toContain('Protein 34%');
    expect(legend).toContain('Carbs 33%');
    expect(legend).toContain('Fat 33%');

    const label = byTestId(tree, 'health-calories-dashboard-macros')[0].props.accessibilityLabel;
    expect(label).toContain('protein 34%, carbs 33%, fat 33%');
  });

  it('HEALTH-CDASH-128: calories with no macros logged says so instead of drawing an empty stack', async () => {
    const tree = await render(
      <HealthCaloriesDashboard
        meals={[meal({ date: '2026-07-13', calories: 900 })]}
        goal={2000}
        dayKeys={window}
        width={320}
      />
    );

    expect(byTestId(tree, 'app-bar-chart').length).toBe(1); // intake still charts
    expect(byTestId(tree, 'app-bar-chart-stacked').length).toBe(0);
    expect(byTestId(tree, 'health-calories-dashboard-macros-empty').length).toBe(1);
  });

  it('HEALTH-CDASH-130: a thinned MACRO axis discloses its sampling in weeks', async () => {
    // A year-ish window is more weeks than the axis will label, so the stacks
    // keep coming but most labels are dropped. An undisclosed gap in a weekly
    // axis reads as "these bars are consecutive weeks", which they are not.
    const longWindow = days('2026-03-02', 133); // 19 whole weeks
    const meals = longWindow
      .filter((_unused, i) => i % 7 === 0)
      .map((date, i) => meal({ date, calories: 900, protein: 50, carbs: 50, fat: 20, id: `w${i}` }));

    const tree = await render(
      <HealthCaloriesDashboard meals={meals} goal={2000} dayKeys={longWindow} width={320} />
    );

    const note = byTestId(tree, 'health-calories-dashboard-macro-axis-note');
    expect(note.length).toBe(1);
    expect(allText(note[0])).toContain('every 3 weeks');

    // The dropped labels are blank, not repeated — a repeat would put the same
    // week under three different stacks.
    const labels = hintOf(byTestId(tree, 'app-bar-chart-stacked')[0]).labels as string[];
    expect(labels.length).toBe(19);
    expect(labels.filter((l) => l !== '').length).toBe(7);
  });

  it('HEALTH-CDASH-131: a dashboard rendered before its meals arrive shows the empty state', async () => {
    // Every derivation in this module reads `meals ?? []`, so the card mounted
    // against a store that has not answered yet must land on its own empty copy
    // rather than throwing inside a `useMemo` and taking the tab down with it.
    const tree = await render(
      <HealthCaloriesDashboard
        meals={undefined as never}
        goal={2000}
        dayKeys={window}
        width={320}
      />
    );

    expect(byTestId(tree, 'health-calories-dashboard').length).toBe(1);
    expect(byTestId(tree, 'app-bar-chart').length).toBe(0);
    expect(byTestId(tree, 'health-calories-dashboard-macros-empty').length).toBe(1);
  });

  it('HEALTH-CDASH-129: a thinned intake axis discloses its sampling', async () => {
    // A window short enough to stay ONE bar per day (blockDays=1: MAX_ENERGY_BARS
    // is 12 and this is 10) but with more logged days than MAX_AXIS_LABELS (8),
    // so the bars themselves are not blocked but every LABEL is — the scenario
    // this test's own name describes. The shared 15-day `window` no longer
    // exercises it: at that width `energySeries` blocks to 7-day bars instead
    // (see HEALTH-CDASH-121), which has its own, differently-worded disclosure.
    const tenDayWindow = days('2026-07-04', 10);
    const meals = tenDayWindow.map((date, i) => meal({ date, calories: 1500 + i, id: `d${i}` }));
    const tree = await render(
      <HealthCaloriesDashboard meals={meals} goal={2000} dayKeys={tenDayWindow} width={320} />
    );

    const note = byTestId(tree, 'health-calories-dashboard-axis-note');
    expect(note.length).toBe(1);
    expect(allText(note[0])).toContain('One bar per logged day');
    expect(allText(note[0])).toContain('every 2th label is drawn');
  });
});
