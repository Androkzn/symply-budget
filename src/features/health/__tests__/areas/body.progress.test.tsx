/**
 * Body tab — trend RANGES and the compare card's remaining states.
 *
 * `components/__tests__/HealthBodyDashboard.test.tsx` owns the arithmetic and
 * the happy path of both cards. What it never drives:
 *
 *   · the range selector as a CONTROL. Two of its five options had never been
 *     pressed, and the spoken form of each range is what the empty sentence and
 *     the chart's accessibility label are built from — so "1M" and "6M" reading
 *     alike would be invisible to every existing test;
 *   · a SPARSE log, which is what a real body log is: a reading in March, one in
 *     May, one last week. Every existing range case uses readings dense enough
 *     that any window returns something;
 *   · the compare card's held-loosely selection, which has to survive the day it
 *     points at being deleted, and must never end up comparing a day with
 *     itself;
 *   · the compare card's two optional props, both defaulted by the only caller
 *     in the app, and its "nothing overlapped" sentence.
 *
 * `AppLineChart` is mocked to a leaf that re-publishes the series, so a range
 * change can be proven by the POINTS that reached the chart rather than by the
 * card merely re-rendering.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  BODY_RANGE_LABELS,
  BODY_RANGE_SPOKEN,
  BODY_RANGES,
  bodyMeasurementDates,
  compareBodyDates,
  HealthBodyCompareCard,
  HealthBodyTrendCard,
  summarizeBodyCompare,
} from '../../components/HealthBodyProgress';
import { compareBodyEntriesDesc, type BodyEntry, type BodyMetric } from '../../healthBodyStorage';

type Rendered = ReactTestRenderer.ReactTestRenderer;

const TODAY = '2026-07-13';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

// The real chart measures and renders SVG; the card only ever has to prove it
// handed the right series over.
jest.mock('@components/ui/AppLineChart', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    AppLineChart: ({ data }: { data: Array<{ value: number; label?: string }> }) =>
      ReactMock.createElement(View, {
        testID: 'app-line-chart',
        accessibilityValue: { text: data.map((p) => p.value).join(',') },
        accessibilityHint: data.map((p) => p.label ?? '').join('|'),
      }),
  };
});

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

/** The values that reached the chart, in plotted order. */
function plotted(tree: Rendered): number[] {
  const chart = byTestId(tree, 'app-line-chart')[0];
  if (!chart) return [];
  const text = chart.props.accessibilityValue?.text ?? '';
  return text === '' ? [] : text.split(',').map(Number);
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

/** Entries as `loadBodyEntries` hands them over: newest measurement day first. */
function log(...items: BodyEntry[]): BodyEntry[] {
  return [...items].sort(compareBodyEntriesDesc);
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 6, 13, 12, 0, 0));
});

afterEach(() => {
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* Range selector                                                      */
/* ------------------------------------------------------------------ */

describe('HealthBodyTrendCard — the range selector', () => {
  /**
   * A REAL body log: a handful of readings scattered over two and a half years.
   * Each range should reach exactly one more of them than the one below it.
   */
  const sparse = () =>
    log(
      entry({ id: 'a', date: '2026-07-01', value: 78 }), // within 1M
      entry({ id: 'b', date: '2026-05-01', value: 80 }), // within 3M
      entry({ id: 'c', date: '2026-02-01', value: 82 }), // within 6M
      entry({ id: 'd', date: '2025-10-01', value: 84 }), // within 1Y
      entry({ id: 'e', date: '2024-01-01', value: 90 }), // All only
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

  it('HEALTH-BODY-180: offers the donor’s five windows, defaulting to 3M', () => {
    const tree = renderCard(sparse());

    for (const option of BODY_RANGES) {
      const chip = byTestId(tree, `body-trend-range-${option}`)[0];
      expect(chip).toBeDefined();
      // The label is what the member reads; the spoken form is what assistive
      // tech reads. Neither may be a bare day count.
      expect(allText(chip)).toBe(BODY_RANGE_LABELS[option]);
      expect(chip.props.accessibilityLabel).toBe(`Range ${BODY_RANGE_LABELS[option]}`);
    }
    // 3M is the landing state, and it is the one reported as selected.
    expect(byTestId(tree, 'body-trend-range-90')[0].props.accessibilityState).toEqual({
      selected: true,
    });
    expect(byTestId(tree, 'body-trend-range-30')[0].props.accessibilityState).toEqual({
      selected: false,
    });
  });

  it('HEALTH-BODY-181: each window reaches exactly the readings inside it', () => {
    // The two windows no test had ever pressed are 6M and All; both are here,
    // and every window is proven by the POINTS that reached the chart rather
    // than by the card re-rendering.
    const tree = renderCard(sparse());

    expect(plotted(tree)).toEqual([80, 78]); // 3M — May and July

    press(tree, 'body-trend-range-180');
    expect(plotted(tree)).toEqual([82, 80, 78]); // 6M adds February

    press(tree, 'body-trend-range-365');
    expect(plotted(tree)).toEqual([84, 82, 80, 78]); // 1Y adds last October

    press(tree, 'body-trend-range-0');
    expect(plotted(tree)).toEqual([90, 84, 82, 80, 78]); // All adds 2024

    press(tree, 'body-trend-range-30');
    // 1M holds ONE reading, which is not a trend — and the card says so rather
    // than drawing a single-point line.
    expect(byTestId(tree, 'body-trend-chart')).toHaveLength(0);
    expect(allText(byTestId(tree, 'body-trend-empty')[0])).toBe(
      'Log waist on at least two days in this range to see a trend line.',
    );
    // The one reading in the window is still surfaced — it is real data.
    expect(allText(byTestId(tree, 'body-trend-latest')[0])).toContain('78 cm');
  });

  it('HEALTH-BODY-182: an empty window names the window, in words', () => {
    // Five ranges, five different sentences. If two read alike, the member
    // cannot tell a window with nothing in it from one they have not changed.
    const tree = renderCard([]);
    const said = new Set<string>();

    for (const option of BODY_RANGES) {
      press(tree, `body-trend-range-${option}`);
      const sentence = allText(byTestId(tree, 'body-trend-empty')[0]);
      expect(sentence).toBe(`No waist readings in ${BODY_RANGE_SPOKEN[option]}.`);
      said.add(sentence);
    }
    expect(said.size).toBe(BODY_RANGES.length);
  });

  it('HEALTH-BODY-183: the range travels into the chart’s spoken headline', () => {
    const tree = renderCard(sparse());

    press(tree, 'body-trend-range-0');
    expect(byTestId(tree, 'body-trend-chart')[0].props.accessibilityLabel).toBe(
      'Waist trend over all time: latest 78 cm, down 12 cm across 5 logged days.',
    );
    // Narrowing re-derives the whole sentence, not just the point count — the
    // change is measured inside the window, not across the whole log.
    press(tree, 'body-trend-range-180');
    expect(byTestId(tree, 'body-trend-chart')[0].props.accessibilityLabel).toBe(
      'Waist trend over the past 6 months: latest 78 cm, down 4 cm across 3 logged days.',
    );
  });

  it('HEALTH-BODY-184: a flat series is announced as unchanged, not as a fall of zero', () => {
    const tree = renderCard(
      log(
        entry({ id: 'a', date: '2026-07-13', value: 80 }),
        entry({ id: 'b', date: '2026-07-06', value: 80 }),
      ),
    );

    expect(byTestId(tree, 'body-trend-chart')[0].props.accessibilityLabel).toContain('unchanged');
    // The Change tile still carries a signed figure, and `0` may not be printed
    // as `+0` — the tile is read next to an arrow elsewhere on the tab.
    expect(allText(byTestId(tree, 'body-trend-change')[0])).toContain('0 cm');
  });

  it('HEALTH-BODY-185: the axis note appears the moment a label is dropped, and not before', () => {
    // The threshold is 8 labels. Eight logged days is the largest series that
    // is fully labelled, so it is the case where a wrongly-placed `>=` would
    // announce a thinning that did not happen.
    const days = (count: number) =>
      log(
        ...Array.from({ length: count }, (_, i) =>
          entry({ id: `d${i}`, date: `2026-07-${String(i + 1).padStart(2, '0')}`, value: 80 - i }),
        ),
      );

    const eight = renderCard(days(8));
    expect(byTestId(eight, 'body-trend-axis-note')).toHaveLength(0);
    expect(plotted(eight)).toHaveLength(8);

    const nine = renderCard(days(9));
    expect(allText(byTestId(nine, 'body-trend-axis-note')[0])).toBe(
      'x-axis labels every 2 logged days.',
    );
  });
});

/* ------------------------------------------------------------------ */
/* Compare card — held-loosely selection                               */
/* ------------------------------------------------------------------ */

describe('HealthBodyCompareCard — selection and its edges', () => {
  const threeDays = () =>
    log(
      entry({ id: 'a', date: '2026-07-13', value: 78 }),
      entry({ id: 'b', date: '2026-06-01', value: 82 }),
      entry({ id: 'c', date: '2026-05-01', value: 84 }),
    );

  it('HEALTH-BODY-190: a baseline that no longer exists resolves back to the default', () => {
    // The selection is held LOOSELY on purpose: the member can delete the very
    // reading they pinned. Holding the stale date would show a compare with
    // nothing on one side and no way back.
    const tree = render(<HealthBodyCompareCard entries={threeDays()} />);
    press(tree, 'health-body-compare-baseline-2026-06-01');
    expect(byTestId(tree, 'health-body-compare-row-waist')[0].props.accessibilityLabel).toBe(
      'Waist: 82 cm to 78 cm, −4 cm',
    );

    act(() => {
      tree.update(
        <ThemeProvider>
          <HealthBodyCompareCard
            entries={log(
              entry({ id: 'a', date: '2026-07-13', value: 78 }),
              entry({ id: 'c', date: '2026-05-01', value: 84 }),
            )}
          />
        </ThemeProvider>,
      );
    });

    // Back to the earliest day, which is the natural baseline.
    expect(byTestId(tree, 'health-body-compare-row-waist')[0].props.accessibilityLabel).toBe(
      'Waist: 84 cm to 78 cm, −6 cm',
    );
    expect(byTestId(tree, 'health-body-compare-baseline-2026-06-01')).toHaveLength(0);
  });

  it('HEALTH-BODY-191: a day is never compared with itself', () => {
    // Picking the SAME day on both sides would report "no change" across every
    // site — a confident, meaningless answer. The baseline falls back instead.
    const tree = render(<HealthBodyCompareCard entries={threeDays()} />);

    press(tree, 'health-body-compare-baseline-2026-07-13'); // == the current day
    expect(byTestId(tree, 'health-body-compare-row-waist')[0].props.accessibilityLabel).toBe(
      'Waist: 84 cm to 78 cm, −6 cm',
    );
    expect(allText(byTestId(tree, 'health-body-compare-summary')[0])).toContain(
      'between 2026-05-01 and 2026-07-13',
    );
  });

  it('HEALTH-BODY-192: two days with nothing in common say exactly that', () => {
    // Not "0 of 0 sites changed", which reads as a measurement that was taken
    // and did not move.
    const tree = render(
      <HealthBodyCompareCard
        entries={log(
          entry({ id: 'w', metric: 'waist', date: '2026-07-13', value: 78 }),
          entry({ id: 'c', metric: 'chest', date: '2026-05-01', value: 100 }),
        )}
      />,
    );

    expect(allText(byTestId(tree, 'health-body-compare-summary')[0])).toBe(
      'No site was measured on both days.',
    );
    expect(byTestId(tree, 'health-body-compare-row-waist')[0].props.accessibilityLabel).toBe(
      'Waist: — to 78 cm, —',
    );
  });

  it('HEALTH-BODY-193: the card can be narrowed to a subset of sites, under its own id', () => {
    // Both props are defaulted by the Body tab today. They exist so the card
    // can be embedded a second time — on a per-site detail sheet, say — and a
    // fixed `idPrefix` would make the two collide in every automation selector.
    const tree = render(
      <HealthBodyCompareCard
        entries={log(
          entry({ id: 'w1', metric: 'waist', date: '2026-07-13', value: 78 }),
          entry({ id: 'w0', metric: 'waist', date: '2026-05-01', value: 84 }),
          entry({ id: 'c1', metric: 'chest', date: '2026-07-13', value: 101 }),
          entry({ id: 'c0', metric: 'chest', date: '2026-05-01', value: 100 }),
        )}
        metrics={['waist']}
        idPrefix="waist-compare"
      />,
    );

    expect(byTestId(tree, 'waist-compare-row-waist')).toHaveLength(1);
    expect(byTestId(tree, 'waist-compare-row-chest')).toHaveLength(0);
    // …and the summary counts only the sites the card was asked about.
    expect(allText(byTestId(tree, 'waist-compare-summary')[0])).toBe(
      '1 of 1 measured site changed between 2026-05-01 and 2026-07-13.',
    );
    // The default-prefixed ids must NOT also exist, or two cards would answer
    // to one selector.
    expect(byTestId(tree, 'health-body-compare-row-waist')).toHaveLength(0);
  });

  it('HEALTH-BODY-198: the summary is grammatical for one site and for several', () => {
    // "1 of 2 measured sites" and "1 of 1 measured site" — a fixed plural reads
    // as a bug on the very first day anyone compares.
    const tree = render(
      <HealthBodyCompareCard
        entries={log(
          entry({ id: 'w1', metric: 'waist', date: '2026-07-13', value: 78 }),
          entry({ id: 'w0', metric: 'waist', date: '2026-05-01', value: 84 }),
          entry({ id: 'c1', metric: 'chest', date: '2026-07-13', value: 100 }),
          entry({ id: 'c0', metric: 'chest', date: '2026-05-01', value: 100 }),
        )}
        metrics={['waist', 'chest']}
      />,
    );

    expect(allText(byTestId(tree, 'health-body-compare-summary')[0])).toBe(
      '1 of 2 measured sites changed between 2026-05-01 and 2026-07-13.',
    );
  });

  it('HEALTH-BODY-194: the empty card carries the caller’s id too', () => {
    const tree = render(
      <HealthBodyCompareCard entries={log(entry({ date: TODAY }))} idPrefix="waist-compare" />,
    );

    expect(allText(byTestId(tree, 'waist-compare-empty')[0])).toContain(
      'at least two different days',
    );
  });
});

/* ------------------------------------------------------------------ */
/* Pure helpers the cards sit on                                       */
/* ------------------------------------------------------------------ */

describe('compare helpers', () => {
  it('HEALTH-BODY-195: a reading with no day key is dated from its stamp', () => {
    // A cached row from before the schema carried `date`. Keying it on the
    // blank string would sort it ahead of every real date and offer an empty
    // chip labelled from nothing.
    expect(
      bodyMeasurementDates([
        entry({ id: 'legacy', date: '' as string, loggedAt: '2026-07-13T10:00:00.000Z' }),
        entry({ id: 'dated', date: '2026-05-01' }),
      ]),
    ).toEqual(['2026-07-13', '2026-05-01']);
  });

  it('HEALTH-BODY-196: compareBodyDates answers about the sites it is ASKED about', () => {
    const rows = compareBodyDates(
      log(
        entry({ id: 'w1', metric: 'waist', date: '2026-07-13', value: 78 }),
        entry({ id: 'w0', metric: 'waist', date: '2026-05-01', value: 84 }),
        entry({ id: 'c1', metric: 'chest', date: '2026-07-13', value: 101 }),
      ),
      '2026-05-01',
      '2026-07-13',
      ['chest', 'waist'],
    );

    // Order follows the CALLER's list, not the storage vocabulary — the card
    // renders rows in the order it hands them over.
    expect(rows.map((r) => r.metric)).toEqual(['chest', 'waist']);
    expect(rows[0].delta).toBeNull(); // chest measured on one day only
    expect(rows[1].delta).toBe(-6);
  });

  it('HEALTH-BODY-197: the summary counts a unit switch separately from a real change', () => {
    // A unit-blocked row is neither "changed" nor "unchanged" — counting it as
    // either would let the card claim a site moved, or that it did not.
    const rows = compareBodyDates(
      log(
        entry({ id: 'w1', metric: 'waist', date: '2026-07-13', value: 31, unit: 'in' }),
        entry({ id: 'w0', metric: 'waist', date: '2026-05-01', value: 84, unit: 'cm' }),
        entry({ id: 'c1', metric: 'chest', date: '2026-07-13', value: 101 }),
        entry({ id: 'c0', metric: 'chest', date: '2026-05-01', value: 100 }),
        entry({ id: 'h1', metric: 'hips', date: '2026-07-13', value: 95 }),
        entry({ id: 'h0', metric: 'hips', date: '2026-05-01', value: 95 }),
      ),
      '2026-05-01',
      '2026-07-13',
      ['waist', 'chest', 'hips'],
    );

    expect(summarizeBodyCompare(rows)).toEqual({ compared: 2, changed: 1, unitChanged: 1 });
  });
});
