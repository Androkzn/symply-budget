/**
 * Body progress + Home dashboard primitives.
 *
 * These two modules carry the arithmetic the user reads as meaningful — a
 * measurement trend, a delta between two dates, a goal ring — so the pure
 * functions are pinned against hand-computed expectations rather than against
 * whatever the implementation happens to return, and the components are driven
 * directly to cover the branches a screen only ever hits one way.
 *
 * The rules under test exist because breaking them produces a confident lie:
 *   · a cm reading and an in reading on one axis draws a cliff that never
 *     happened, so mixed units are excluded and disclosed;
 *   · an x-axis labelled by row index claims an even cadence the log does not
 *     have, so labels are dates and thinning is disclosed;
 *   · an empty range drawn as a flat zero line reads as a real measurement of
 *     zero, so it is words instead.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import type { WorkoutEntry } from '../../healthActivityStorage';
import { BODY_METRICS, type BodyEntry, type BodyMetric } from '../../healthBodyStorage';
import type { WeightEntry } from '../../healthLocalStorage';
import type { MealEntry } from '../../healthNutritionStorage';
import {
  bodyMeasurementDates,
  buildBodyMetricSeries,
  compareBodyDates,
  groupBodyMetrics,
  HealthBodyCompareCard,
  HealthBodyTrendCard,
  lengthBodyMetrics,
  summarizeBodyCompare,
} from '../HealthBodyProgress';
import {
  buildRecentActivity,
  HealthActivityFeed,
  HealthDashboardCards,
  HealthDayRings,
} from '../HealthDashboardCards';

type Rendered = ReactTestRenderer.ReactTestRenderer;

const TODAY = '2026-07-13';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

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

/** Fire onPress on the composite carrying `testID` (Pressable, not its host View). */
function press(tree: Rendered, testID: string) {
  const node = tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function',
  );
  act(() => node.props.onPress());
}

/** Flatten every string in the rendered host tree, preserving concatenation. */
function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

function entry(over: Partial<BodyEntry> = {}): BodyEntry {
  const date = over.date ?? TODAY;
  return {
    id: over.id ?? `${over.metric ?? 'waist'}-${date}`,
    date,
    metric: over.metric ?? 'waist',
    value: over.value ?? 80,
    unit: over.unit ?? 'cm',
    loggedAt: over.loggedAt ?? `${date}T10:00:00.000Z`,
  };
}

/** Entries as `loadBodyEntries` hands them over: newest-first. */
function log(...items: BodyEntry[]): BodyEntry[] {
  return [...items].sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 6, 13, 12, 0, 0));
});

afterEach(() => {
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* Site grouping                                                       */
/* ------------------------------------------------------------------ */

describe('groupBodyMetrics', () => {
  it('HEALTH-BODY-060: files EVERY shipped site into a named anatomical section', () => {
    // Within a section the order is the SECTION's anatomical run, not the order
    // BODY_METRICS happens to list them in — that is what makes the grid
    // scannable, and it survives a reorder of the storage array.
    const groups = groupBodyMetrics(BODY_METRICS);

    // The donor's own sheet order, head to toe, composition last.
    expect(groups.map((g) => g.id)).toEqual(['upper', 'arms', 'legs', 'wholeBody', 'composition']);
    // "Other" is the catch-all for a site the grouping vocabulary does not know
    // (HEALTH-BODY-062). Its PRESENCE here would mean a shipped site has no
    // section — it would still render, but under a heading that says nothing
    // about where to put the tape.
    expect(groups.map((g) => g.id)).not.toContain('other');

    // Every site appears exactly once across the sections — a duplicate would
    // draw two tiles for one reading and two chips that write the same column.
    const filed = groups.flatMap((g) => g.metrics);
    expect(new Set(filed).size).toBe(filed.length);
    expect([...filed].sort()).toEqual([...BODY_METRICS].sort());

    // Spot-check the anatomical run itself: the detailed points sit NEXT TO the
    // primary site they refine, not in a section of their own.
    const upper = groups.find((g) => g.id === 'upper')!;
    expect(upper.metrics.slice(0, 3)).toEqual(['neck', 'shoulders', 'backWidth']);
    expect(upper.metrics.indexOf('waistNavel')).toBe(upper.metrics.indexOf('waist') + 1);
    expect(groups.find((g) => g.id === 'composition')!.metrics).toEqual(['bodyFat']);
  });

  it('HEALTH-BODY-061: files the sites the schema already carries into the right section', () => {
    // The grouping vocabulary is deliberately WIDER than BODY_METRICS: the
    // unsided `forearm`/`calf` names and the donor's other spellings exist in
    // the D1 schema, so a row written by another client still files correctly
    // rather than falling through to "Other".
    const extended = [
      'neck',
      'shoulders',
      'waist',
      'forearm',
      'leftCalf',
      'bodyFat',
    ] as unknown as BodyMetric[];

    expect(groupBodyMetrics(extended)).toEqual([
      { id: 'upper', title: 'Upper body', metrics: ['neck', 'shoulders', 'waist'] },
      { id: 'arms', title: 'Arms', metrics: ['forearm'] },
      { id: 'legs', title: 'Legs', metrics: ['leftCalf'] },
      { id: 'composition', title: 'Composition', metrics: ['bodyFat'] },
    ]);
  });

  it('HEALTH-BODY-062: never drops an unrecognised site — it falls into "Other"', () => {
    const groups = groupBodyMetrics(['waist', 'wingspan'] as unknown as BodyMetric[]);
    expect(groups).toEqual([
      { id: 'upper', title: 'Upper body', metrics: ['waist'] },
      { id: 'other', title: 'Other', metrics: ['wingspan'] },
    ]);
  });

  it('HEALTH-BODY-063: separates the length sites from the percentage', () => {
    // Input order, not section order — this feeds the metric picker, which
    // lists them as healthBodyStorage declares them.
    expect(lengthBodyMetrics(BODY_METRICS)).toEqual(BODY_METRICS.filter((m) => m !== 'bodyFat'));
    // The percentage is the ONE site excluded: it is what keeps a `%` off the
    // circumference axis, and it must never be excluded by count or position.
    expect(lengthBodyMetrics(BODY_METRICS)).not.toContain('bodyFat');
    expect(lengthBodyMetrics(BODY_METRICS)).toHaveLength(BODY_METRICS.length - 1);
    // Asked for nothing in particular, it answers for the whole donor set —
    // the picker's "every site" case does not have to restate the list.
    expect(lengthBodyMetrics()).toEqual(lengthBodyMetrics(BODY_METRICS));
    // A caller that hands it a subset gets that subset back, minus the percent.
    expect(lengthBodyMetrics(['waist', 'bodyFat', 'chest'])).toEqual(['waist', 'chest']);
  });
});

/* ------------------------------------------------------------------ */
/* Per-metric series                                                   */
/* ------------------------------------------------------------------ */

describe('buildBodyMetricSeries', () => {
  it('HEALTH-BODY-064: plots one point per logged day, oldest-first, labelled by DATE', () => {
    const series = buildBodyMetricSeries(
      log(
        entry({ date: '2026-07-13', value: 78 }),
        entry({ date: '2026-07-06', value: 79 }),
        entry({ date: '2026-06-29', value: 80 }),
      ),
      'waist',
      90,
      TODAY,
    );

    expect(series.points.map((p) => p.value)).toEqual([80, 79, 78]);
    // Never a bare row index — "1, 2, 3" would claim an even cadence.
    expect(series.points.map((p) => p.label)).toEqual(['29 Jun', '6 Jul', '13 Jul']);
    expect(series.labelEvery).toBe(1);
    expect(series.unit).toBe('cm');
    expect(series.days).toBe(3);
    expect(series.first).toBe(80);
    expect(series.last).toBe(78);
    expect(series.average).toBe(79);
    expect(series.change).toBe(-2);
  });

  it('HEALTH-BODY-065: keeps the newest reading when a day was logged twice', () => {
    const series = buildBodyMetricSeries(
      log(
        entry({ id: 'late', date: TODAY, value: 77, loggedAt: `${TODAY}T18:00:00.000Z` }),
        entry({ id: 'early', date: TODAY, value: 80, loggedAt: `${TODAY}T06:00:00.000Z` }),
      ),
      'waist',
      90,
      TODAY,
    );

    expect(series.points.map((p) => p.value)).toEqual([77]);
    expect(series.days).toBe(1);
  });

  it('HEALTH-BODY-066: NEVER plots a second unit on the same axis, and says so', () => {
    // 31 in and 78 cm describe the same waist; drawn together they are a 47-unit
    // cliff. The latest reading's unit wins and the other is disclosed.
    const series = buildBodyMetricSeries(
      log(
        entry({ id: 'a', date: '2026-07-13', value: 78, unit: 'cm' }),
        entry({ id: 'b', date: '2026-07-06', value: 31, unit: 'in' }),
        entry({ id: 'c', date: '2026-06-29', value: 80, unit: 'cm' }),
      ),
      'waist',
      90,
      TODAY,
    );

    expect(series.unit).toBe('cm');
    expect(series.points.map((p) => p.value)).toEqual([80, 78]);
    expect(series.excludedUnits).toEqual(['in']);
    expect(series.change).toBe(-2); // 78 − 80, never touched by the inch reading
  });

  it('HEALTH-BODY-067: thins the x-axis labels and reports the sampling to disclose', () => {
    const entries = log(
      ...Array.from({ length: 20 }, (_, i) =>
        entry({ id: `w${i}`, date: `2026-07-${String(13 - (i % 13)).padStart(2, '0')}`, value: 80 + i }),
      ),
    );
    const series = buildBodyMetricSeries(entries, 'waist', 0, TODAY);

    expect(series.days).toBe(13);
    expect(series.labelEvery).toBe(2); // ceil(13 / 8)
    const labelled = series.points.filter((p) => p.label !== undefined);
    expect(labelled).toHaveLength(7);
    // Every surviving label is still a date, not a position.
    labelled.forEach((p) => expect(p.label).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/));
  });

  it('HEALTH-BODY-068: honours the range window and reports an empty one honestly', () => {
    const entries = log(entry({ date: '2026-01-05', value: 90 }));

    const wide = buildBodyMetricSeries(entries, 'waist', 0, TODAY);
    expect(wide.days).toBe(1);

    const narrow = buildBodyMetricSeries(entries, 'waist', 30, TODAY);
    expect(narrow.points).toEqual([]);
    expect(narrow.days).toBe(0);
    // No unit is claimed for a series with nothing in it.
    expect(narrow.unit).toBeNull();
    expect(narrow.change).toBeNull();
    expect(narrow.average).toBeNull();
  });

  it('HEALTH-BODY-069: an unlogged metric yields an empty series rather than zeros', () => {
    const series = buildBodyMetricSeries(log(entry({ metric: 'waist' })), 'chest', 90, TODAY);
    expect(series.points).toEqual([]);
    expect(series.last).toBeNull();
    expect(series.excludedUnits).toEqual([]);
  });

  it('HEALTH-BODY-090: a reading with no day key is dated from the stamp it was taken at', () => {
    // A cached row from before the schema carried `date` still has the moment
    // it was logged. Keying it on the blank string instead would sort it ahead
    // of every real date and label the newest reading as the oldest one.
    const series = buildBodyMetricSeries(
      log(
        entry({ id: 'legacy', date: '' as string, value: 77, loggedAt: '2026-07-13T10:00:00.000Z' }),
        entry({ id: 'dated', date: '2026-07-06', value: 79 }),
      ),
      'waist',
      90,
      TODAY,
    );

    expect(series.points.map((p) => p.value)).toEqual([79, 77]);
    expect(series.points.map((p) => p.label)).toEqual(['6 Jul', '13 Jul']);
    expect(series.last).toBe(77);
    expect(series.days).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* Two-date comparison                                                 */
/* ------------------------------------------------------------------ */

describe('compareBodyDates', () => {
  const entries = log(
    entry({ id: 'w-new', metric: 'waist', date: '2026-07-13', value: 78 }),
    entry({ id: 'c-new', metric: 'chest', date: '2026-07-13', value: 101 }),
    entry({ id: 'w-old', metric: 'waist', date: '2026-05-01', value: 84 }),
    entry({ id: 'c-old', metric: 'chest', date: '2026-05-01', value: 100 }),
  );

  it('HEALTH-BODY-070: lists every measurement day newest-first, without duplicates', () => {
    expect(bodyMeasurementDates(entries)).toEqual(['2026-07-13', '2026-05-01']);
  });

  it('HEALTH-BODY-071: reports a delta per site between the two chosen days', () => {
    const rows = compareBodyDates(entries, '2026-05-01', '2026-07-13');
    const byMetric = new Map(rows.map((r) => [r.metric, r]));

    expect(byMetric.get('waist')!.delta).toBe(-6);
    expect(byMetric.get('chest')!.delta).toBe(1);
    // A site measured on neither day has nothing to compare — not a zero.
    expect(byMetric.get('hips')!.delta).toBeNull();
    expect(byMetric.get('hips')!.baseline).toBeNull();
    expect(rows).toHaveLength(BODY_METRICS.length);
  });

  it('HEALTH-BODY-072: refuses a delta across a unit switch and flags it', () => {
    const mixed = log(
      entry({ id: 'a', metric: 'waist', date: '2026-07-13', value: 31, unit: 'in' }),
      entry({ id: 'b', metric: 'waist', date: '2026-05-01', value: 84, unit: 'cm' }),
    );
    // Found by NAME, not by position: `BODY_METRICS` is ordered anatomically
    // and gains sites, so `[0]` would silently start asserting about the neck.
    const row = compareBodyDates(mixed, '2026-05-01', '2026-07-13').find(
      (r) => r.metric === 'waist',
    )!;

    expect(row.metric).toBe('waist');
    expect(row.unitChanged).toBe(true);
    // 31 − 84 = −53 would be a spectacular, entirely fictional result.
    expect(row.delta).toBeNull();
  });

  it('HEALTH-BODY-073: summarises how many sites were comparable and how many moved', () => {
    const rows = compareBodyDates(entries, '2026-05-01', '2026-07-13');
    expect(summarizeBodyCompare(rows)).toEqual({ compared: 2, changed: 2, unitChanged: 0 });

    const flat = compareBodyDates(
      log(
        entry({ id: 'a', date: '2026-07-13', value: 80 }),
        entry({ id: 'b', date: '2026-05-01', value: 80 }),
      ),
      '2026-05-01',
      '2026-07-13',
    );
    expect(summarizeBodyCompare(flat)).toEqual({ compared: 1, changed: 0, unitChanged: 0 });
  });
});

/* ------------------------------------------------------------------ */
/* Trend card                                                          */
/* ------------------------------------------------------------------ */

describe('HealthBodyTrendCard', () => {
  const trend = log(
    entry({ id: 'a', date: '2026-07-13', value: 78 }),
    entry({ id: 'b', date: '2026-07-06', value: 79 }),
    entry({ id: 'c', date: '2026-06-29', value: 80 }),
  );

  const renderCard = (entries: BodyEntry[], metrics: readonly BodyMetric[] = ['waist', 'chest']) =>
    render(
      <HealthBodyTrendCard
        entries={entries}
        metrics={metrics}
        chartWidth={300}
        title="MEASUREMENT TRENDS"
        idPrefix="body-trend"
      />,
    );

  it('HEALTH-BODY-074: states the headline figure on the chart itself', () => {
    const tree = renderCard(trend);

    const chart = byTestId(tree, 'body-trend-chart');
    expect(chart.length).toBe(1);
    expect(chart[0].props.accessibilityLabel).toBe(
      'Waist trend over the past 3 months: latest 78 cm, down 2 cm across 3 logged days.',
    );
    expect(allText(byTestId(tree, 'body-trend-latest')[0])).toContain('78 cm');
    expect(allText(byTestId(tree, 'body-trend-change')[0])).toContain('-2 cm');
  });

  it('HEALTH-BODY-075: an empty range says so in words, never a flat zero line', () => {
    const tree = renderCard([]);

    expect(byTestId(tree, 'body-trend-chart').length).toBe(0);
    expect(allText(byTestId(tree, 'body-trend-empty')[0])).toBe(
      'No waist readings in the past 3 months.',
    );
    // The stat tiles fall back to a dash rather than inventing a zero.
    expect(allText(byTestId(tree, 'body-trend-latest')[0])).toContain('—');
  });

  it('HEALTH-BODY-076: one reading asks for a second rather than drawing a line', () => {
    const tree = renderCard(log(entry({ date: '2026-07-13', value: 78 })));

    expect(byTestId(tree, 'body-trend-chart').length).toBe(0);
    expect(allText(byTestId(tree, 'body-trend-empty')[0])).toContain('at least two days');
    // The single reading is still surfaced — it is real data.
    expect(allText(byTestId(tree, 'body-trend-latest')[0])).toContain('78 cm');
  });

  it('HEALTH-BODY-077: switches the charted site and re-derives everything', () => {
    const tree = renderCard(
      log(
        entry({ id: 'w1', metric: 'waist', date: '2026-07-13', value: 78 }),
        entry({ id: 'w2', metric: 'waist', date: '2026-07-06', value: 80 }),
        entry({ id: 'c1', metric: 'chest', date: '2026-07-13', value: 101 }),
        entry({ id: 'c2', metric: 'chest', date: '2026-07-06', value: 100 }),
      ),
    );

    expect(byTestId(tree, 'body-trend-chart')[0].props.accessibilityLabel).toContain('Waist trend');
    press(tree, 'body-trend-metric-chest');
    expect(byTestId(tree, 'body-trend-chart')[0].props.accessibilityLabel).toBe(
      'Chest trend over the past 3 months: latest 101 cm, up 1 cm across 2 logged days.',
    );
  });

  it('HEALTH-BODY-089: a site that stops being offered falls back to the first one', () => {
    const entries = log(
      entry({ id: 'w1', metric: 'waist', date: '2026-07-13', value: 78 }),
      entry({ id: 'w2', metric: 'waist', date: '2026-07-06', value: 80 }),
      entry({ id: 'c1', metric: 'chest', date: '2026-07-13', value: 101 }),
      entry({ id: 'c2', metric: 'chest', date: '2026-07-06', value: 100 }),
    );
    const tree = renderCard(entries);
    press(tree, 'body-trend-metric-chest');
    expect(byTestId(tree, 'body-trend-chart')[0].props.accessibilityLabel).toContain('Chest trend');

    // The offered set shrinks under the selection (the Body screen narrows it
    // to the sites actually logged). Holding the stale pick would leave the
    // card charting a site that is no longer in the picker.
    act(() => {
      tree.update(
        <ThemeProvider>
          <HealthBodyTrendCard
            entries={entries}
            metrics={['waist']}
            chartWidth={300}
            title="MEASUREMENT TRENDS"
            idPrefix="body-trend"
          />
        </ThemeProvider>,
      );
    });

    expect(byTestId(tree, 'body-trend-chart')[0].props.accessibilityLabel).toContain('Waist trend');
    expect(byTestId(tree, 'body-trend-metric-chest').length).toBe(0);
  });

  it('HEALTH-BODY-078: narrowing the range re-windows the series', () => {
    const tree = renderCard(
      log(
        entry({ id: 'a', date: '2026-07-13', value: 78 }),
        entry({ id: 'b', date: '2026-02-01', value: 90 }),
      ),
    );

    // 1Y covers both readings.
    press(tree, 'body-trend-range-365');
    expect(byTestId(tree, 'body-trend-chart').length).toBe(1);

    // 1M covers only today's, so there is no line to draw.
    press(tree, 'body-trend-range-30');
    expect(byTestId(tree, 'body-trend-chart').length).toBe(0);
    expect(allText(byTestId(tree, 'body-trend-empty')[0])).toContain('at least two days');
  });

  it('HEALTH-BODY-079: discloses x-axis thinning whenever labels are dropped', () => {
    const dense = log(
      ...Array.from({ length: 12 }, (_, i) =>
        entry({ id: `d${i}`, date: `2026-07-${String(i + 1).padStart(2, '0')}`, value: 80 - i }),
      ),
    );
    const tree = renderCard(dense);

    const note = byTestId(tree, 'body-trend-axis-note');
    expect(note.length).toBe(1);
    expect(allText(note[0])).toContain('every 2 logged days');
  });

  it('HEALTH-BODY-080: discloses readings excluded because their unit differs', () => {
    const tree = renderCard(
      log(
        entry({ id: 'a', date: '2026-07-13', value: 78, unit: 'cm' }),
        entry({ id: 'b', date: '2026-07-06', value: 79, unit: 'cm' }),
        entry({ id: 'c', date: '2026-06-29', value: 31, unit: 'in' }),
      ),
    );

    const note = byTestId(tree, 'body-trend-unit-note');
    expect(note.length).toBe(1);
    expect(allText(note[0])).toContain('Readings in in are not plotted');
  });

  it('HEALTH-BODY-081: a single-site card hides the selector but keeps its own axis', () => {
    const tree = render(
      <HealthBodyTrendCard
        entries={log(
          entry({ id: 'f1', metric: 'bodyFat', date: '2026-07-13', value: 18.4, unit: '%' }),
          entry({ id: 'f2', metric: 'bodyFat', date: '2026-07-06', value: 19.2, unit: '%' }),
        )}
        metrics={['bodyFat']}
        chartWidth={300}
        title="BODY FAT TREND"
        idPrefix="body-fat"
      />,
    );

    expect(byTestId(tree, 'body-fat-metric-bodyFat').length).toBe(0); // no selector
    expect(byTestId(tree, 'body-fat-chart')[0].props.accessibilityLabel).toBe(
      'Body fat trend over the past 3 months: latest 18.4 %, down 0.8 % across 2 logged days.',
    );
  });
});

/* ------------------------------------------------------------------ */
/* Compare card                                                        */
/* ------------------------------------------------------------------ */

describe('HealthBodyCompareCard', () => {
  it('HEALTH-BODY-082: asks for a second day before it will compare anything', () => {
    const tree = render(<HealthBodyCompareCard entries={log(entry({ date: TODAY }))} />);

    const empty = byTestId(tree, 'health-body-compare-empty');
    expect(empty.length).toBe(1);
    expect(allText(empty[0])).toContain('at least two different days');
  });

  it('HEALTH-BODY-083: defaults to the earliest day versus the latest', () => {
    const tree = render(
      <HealthBodyCompareCard
        entries={log(
          entry({ id: 'a', date: '2026-07-13', value: 78 }),
          entry({ id: 'b', date: '2026-06-01', value: 82 }),
          entry({ id: 'c', date: '2026-05-01', value: 84 }),
        )}
      />,
    );

    expect(byTestId(tree, 'health-body-compare-row-waist')[0].props.accessibilityLabel).toBe(
      'Waist: 84 cm to 78 cm, −6 cm',
    );
    expect(allText(byTestId(tree, 'health-body-compare-summary')[0])).toBe(
      '1 of 1 measured site changed between 2026-05-01 and 2026-07-13.',
    );
  });

  it('HEALTH-BODY-084: re-pins the baseline to another day on demand', () => {
    const tree = render(
      <HealthBodyCompareCard
        entries={log(
          entry({ id: 'a', date: '2026-07-13', value: 78 }),
          entry({ id: 'b', date: '2026-06-01', value: 82 }),
          entry({ id: 'c', date: '2026-05-01', value: 84 }),
        )}
      />,
    );

    press(tree, 'health-body-compare-baseline-2026-06-01');
    expect(byTestId(tree, 'health-body-compare-row-waist')[0].props.accessibilityLabel).toBe(
      'Waist: 82 cm to 78 cm, −4 cm',
    );
  });

  it('HEALTH-BODY-088: never compares a day with itself when the oldest is picked', () => {
    const tree = render(
      <HealthBodyCompareCard
        entries={log(
          entry({ id: 'a', date: '2026-07-13', value: 78 }),
          entry({ id: 'b', date: '2026-05-01', value: 84 }),
        )}
      />,
    );

    // Choosing the earliest day on the right-hand side would otherwise leave the
    // default baseline pointing at the same day — "no change" across the board.
    press(tree, 'health-body-compare-current-2026-05-01');
    expect(byTestId(tree, 'health-body-compare-row-waist')[0].props.accessibilityLabel).toBe(
      'Waist: 78 cm to 84 cm, +6 cm',
    );
  });

  it('HEALTH-BODY-085: shows a dash for a site missing on one of the two days', () => {
    const tree = render(
      <HealthBodyCompareCard
        entries={log(
          entry({ id: 'a', metric: 'waist', date: '2026-07-13', value: 78 }),
          entry({ id: 'b', metric: 'waist', date: '2026-05-01', value: 84 }),
          entry({ id: 'c', metric: 'chest', date: '2026-07-13', value: 101 }),
        )}
      />,
    );

    expect(byTestId(tree, 'health-body-compare-row-chest')[0].props.accessibilityLabel).toBe(
      'Chest: — to 101 cm, —',
    );
  });

  it('HEALTH-BODY-086: never converts across a unit switch — it explains instead', () => {
    const tree = render(
      <HealthBodyCompareCard
        entries={log(
          entry({ id: 'a', metric: 'waist', date: '2026-07-13', value: 31, unit: 'in' }),
          entry({ id: 'b', metric: 'waist', date: '2026-05-01', value: 84, unit: 'cm' }),
        )}
      />,
    );

    expect(byTestId(tree, 'health-body-compare-row-waist')[0].props.accessibilityLabel).toBe(
      'Waist: 84 cm to 31 in, unit changed',
    );
    expect(allText(byTestId(tree, 'health-body-compare-unit-note')[0])).toContain(
      'no honest delta',
    );
  });

  it('HEALTH-BODY-087: reports an unchanged site as "no change", not as a missing one', () => {
    const tree = render(
      <HealthBodyCompareCard
        entries={log(
          entry({ id: 'a', date: '2026-07-13', value: 80 }),
          entry({ id: 'b', date: '2026-05-01', value: 80 }),
        )}
      />,
    );

    expect(byTestId(tree, 'health-body-compare-row-waist')[0].props.accessibilityLabel).toBe(
      'Waist: 80 cm to 80 cm, no change',
    );
    expect(allText(byTestId(tree, 'health-body-compare-summary')[0])).toContain('0 of 1');
  });
});

/* ------------------------------------------------------------------ */
/* Dashboard rings + cards + feed                                      */
/* ------------------------------------------------------------------ */

describe('HealthDayRings', () => {
  it('HEALTH-HOME-114: states each goal’s headline figure for assistive tech', () => {
    const onOpen = jest.fn();
    const tree = render(
      <HealthDayRings
        rings={[
          {
            key: 'calories',
            label: 'Calories',
            value: 1200,
            target: 2000,
            suffix: 'kcal',
            route: '/health-nutrition',
            testID: 'ring-calories',
          },
        ]}
        onOpen={onOpen}
      />,
    );

    expect(byTestId(tree, 'ring-calories')[0].props.accessibilityLabel).toBe(
      'Calories: 1200 kcal of 2000 kcal',
    );
    // Identity never rests on the arc colour alone — the label is on screen too.
    expect(allText(tree.toJSON())).toContain('Calories');
    expect(allText(tree.toJSON())).toContain('of 2000 kcal');

    press(tree, 'ring-calories');
    expect(onOpen).toHaveBeenCalledWith('/health-nutrition');
  });

  it('HEALTH-HOME-115: an unset goal says so instead of dividing by zero', () => {
    const tree = render(
      <HealthDayRings
        rings={[{ key: 'steps', label: 'Steps', value: 4000, target: 0, testID: 'ring-steps' }]}
      />,
    );

    expect(byTestId(tree, 'ring-steps')[0].props.accessibilityLabel).toBe(
      'Steps: 4000, no goal set',
    );
    expect(allText(tree.toJSON())).toContain('no goal set');
  });

  it('HEALTH-HOME-116: a ring with no destination is not announced as a button', () => {
    const tree = render(
      <HealthDayRings
        rings={[{ key: 'move', label: 'Move', value: 10, target: 30, testID: 'ring-move' }]}
      />,
    );

    const ring = tree.root.find((n) => n.props?.testID === 'ring-move' && n.props?.disabled === true);
    expect(ring.props.accessibilityRole).toBeUndefined();
  });
});

describe('HealthDashboardCards', () => {
  it('HEALTH-HOME-117: every card announces its figure and opens its own tab', () => {
    const onOpen = jest.fn();
    const tree = render(
      <HealthDashboardCards
        cards={[
          {
            key: 'water',
            icon: 'hydration',
            label: 'Water',
            value: '3',
            caption: 'of 8 cups',
            route: '/health-trends',
            testID: 'card-water',
          },
          {
            key: 'habits',
            icon: 'streak',
            label: 'Habits',
            value: '2/5',
            route: '/health-habits',
            testID: 'card-habits',
          },
        ]}
        onOpen={onOpen}
      />,
    );

    expect(byTestId(tree, 'card-water')[0].props.accessibilityLabel).toBe('Water: 3, of 8 cups');
    // A card with no caption must not trail a stray comma.
    expect(byTestId(tree, 'card-habits')[0].props.accessibilityLabel).toBe('Habits: 2/5');

    press(tree, 'card-habits');
    expect(onOpen).toHaveBeenCalledWith('/health-habits');
  });
});

describe('buildRecentActivity', () => {
  const meal = (over: Partial<MealEntry> = {}): MealEntry => ({
    id: over.id ?? 'm1',
    date: over.date ?? TODAY,
    slot: over.slot ?? 'lunch',
    name: over.name ?? 'Chicken salad',
    calories: over.calories ?? 520,
    protein: 40,
    carbs: 30,
    fat: 20,
    loggedAt: over.loggedAt ?? `${TODAY}T12:00:00.000Z`,
  });
  const workout = (over: Partial<WorkoutEntry> = {}): WorkoutEntry => ({ distanceM: null, startedAt: null,
    id: over.id ?? 'w1',
    date: over.date ?? TODAY,
    type: over.type ?? 'run',
    minutes: over.minutes ?? 40,
    calories: over.calories ?? 320,
    intensity: 'steady',
    note: '',
    loggedAt: over.loggedAt ?? `${TODAY}T07:00:00.000Z`,
  });
  const weight = (over: Partial<WeightEntry> = {}): WeightEntry => ({
    id: over.id ?? `${TODAY}T08:00:00.000Z`,
    value: over.value ?? 70,
    unit: over.unit ?? 'kg',
    date: over.date ?? TODAY,
    note: over.note ?? '',
    source: over.source ?? 'manual',
    loggedAt: over.loggedAt ?? `${TODAY}T08:00:00.000Z`,
  });

  it('HEALTH-HOME-118: merges every logged source newest-first', () => {
    const items = buildRecentActivity({
      meals: [meal()],
      workouts: [workout()],
      weights: [weight()],
    });

    expect(items.map((i) => i.id)).toEqual(['meal-m1', 'weight-2026-07-13T08:00:00.000Z', 'workout-w1']);
    expect(items[0]).toMatchObject({
      title: 'Chicken salad',
      detail: '520 kcal · Lunch',
      route: '/health-nutrition',
    });
    expect(items[2]).toMatchObject({
      title: 'Running',
      detail: '40m · 320 kcal',
      route: '/health-activity',
    });
    expect(items[1].title).toBe('Weight 70 kg');
  });

  it('HEALTH-HOME-119: caps the feed and drops entries with no timestamp to sort by', () => {
    const items = buildRecentActivity(
      {
        meals: Array.from({ length: 6 }, (_, i) =>
          meal({ id: `m${i}`, loggedAt: `${TODAY}T0${i}:00:00.000Z` }),
        ),
      },
      3,
    );
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.id)).toEqual(['meal-m5', 'meal-m4', 'meal-m3']);

    // A malformed row must not silently become "the newest thing you did".
    const untimed = buildRecentActivity({
      meals: [meal({ id: 'bad', loggedAt: '' as unknown as string })],
    });
    expect(untimed).toEqual([]);
  });

  it('HEALTH-HOME-120: an empty day produces no items rather than placeholder rows', () => {
    expect(buildRecentActivity({})).toEqual([]);
  });

  it('HEALTH-HOME-123: a slot or workout type the app does not know still reads as a row', () => {
    // Both maps are keyed by an enum the SERVER owns, so a value added there
    // before a client ships (or a legacy row) lands here as a miss. The feed
    // must still name what was logged rather than drawing a blank line with a
    // missing glyph.
    const items = buildRecentActivity({
      meals: [meal({ id: 'm9', slot: 'brunch' as MealEntry['slot'] })],
      workouts: [workout({ id: 'w9', type: 'padel' as WorkoutEntry['type'] })],
    });

    const mealRow = items.find((i) => i.id === 'meal-m9');
    const workoutRow = items.find((i) => i.id === 'workout-w9');

    expect(mealRow).toMatchObject({ icon: 'meals', title: 'Chicken salad' });
    expect(mealRow?.detail).toBe('520 kcal · Meal');
    expect(workoutRow).toMatchObject({ icon: 'workouts', title: 'Workout' });
    // Never the raw enum word, and never "undefined".
    expect(`${mealRow?.detail} ${workoutRow?.title}`).not.toMatch(/undefined|brunch|padel/);
  });
});

describe('HealthActivityFeed', () => {
  const items = [
    {
      id: 'meal-m1',
      icon: 'lunch',
      title: 'Chicken salad',
      detail: '520 kcal · Lunch',
      at: `${TODAY}T12:00:00.000Z`,
      route: '/health-nutrition',
    },
  ];

  it('HEALTH-HOME-121: renders a labelled row per entry and opens its tab', () => {
    const onOpen = jest.fn();
    const tree = render(
      <HealthActivityFeed
        items={items}
        onOpen={onOpen}
        formatAt={() => 'Today'}
        testID="feed"
        emptyLabel="Nothing logged yet."
      />,
    );

    expect(byTestId(tree, 'feed-item-meal-m1')[0].props.accessibilityLabel).toBe(
      'Chicken salad, 520 kcal · Lunch, Today',
    );
    press(tree, 'feed-item-meal-m1');
    expect(onOpen).toHaveBeenCalledWith('/health-nutrition');
  });

  it('HEALTH-HOME-122: an empty feed says so in words', () => {
    const tree = render(
      <HealthActivityFeed
        items={[]}
        onOpen={jest.fn()}
        formatAt={() => 'Today'}
        testID="feed"
        emptyLabel="Nothing logged yet."
      />,
    );

    expect(byTestId(tree, 'feed').length).toBe(0);
    expect(allText(byTestId(tree, 'feed-empty')[0])).toBe('Nothing logged yet.');
  });
});
