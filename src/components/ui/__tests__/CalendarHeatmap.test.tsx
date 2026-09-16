/**
 * CalendarHeatmap — the pure grid builder (Monday weeks, discrete buckets, the
 * absent-vs-zero split) plus a real render through <ThemeProvider>.
 *
 * The property the whole primitive exists to protect is that a day with NO data
 * never looks like a day logged as 0, so that distinction is asserted in the
 * pure layer AND in the painted output.
 *
 * Fixture window: 12 weeks ending Saturday 2026-07-25, which opens on Monday
 * 2026-05-04 and leaves exactly one padding day (Sunday 2026-07-26).
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  CalendarHeatmap,
  heatmapDescription,
  heatmapGrid,
  heatmapLevelColors,
  heatmapLevelFor,
  heatmapWeekStart,
  HEATMAP_LEVELS,
  type HeatmapCell,
  type HeatmapGrid,
} from '../CalendarHeatmap';

const END = '2026-07-25'; // Saturday
const START = '2026-05-04'; // Monday, 11 weeks earlier
const PADDING_DAY = '2026-07-26'; // Sunday after the window closes

function cellOn(grid: HeatmapGrid, date: string): HeatmapCell {
  for (const column of grid.columns) {
    const found = column.find((cell) => cell.date === date);
    if (found) return found;
  }
  throw new Error(`no cell for ${date}`);
}

function allCells(grid: HeatmapGrid): HeatmapCell[] {
  return grid.columns.flat();
}

function render(el: React.ReactElement): ReactTestRenderer.ReactTestRenderer {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{el}</ThemeProvider>);
  });
  return tree;
}

function findAllByTestID(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.findAll((node) => node.props?.testID === testID);
}

function flatStyle(node: ReactTestRenderer.ReactTestInstance): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const walk = (style: unknown) => {
    if (Array.isArray(style)) {
      style.forEach(walk);
    } else if (style && typeof style === 'object') {
      Object.assign(merged, style);
    }
  };
  walk(node.props.style);
  return merged;
}

function collectText(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => collectText(n, out));
    return out;
  }
  const children = (node as { children?: unknown }).children;
  if (children) collectText(children, out);
  return out;
}

describe('heatmapWeekStart', () => {
  it('matches the backend weekStartOf (Monday-based)', () => {
    expect(heatmapWeekStart('2026-06-01')).toBe('2026-06-01'); // Monday → itself
    expect(heatmapWeekStart('2026-06-03')).toBe('2026-06-01'); // Wednesday
    expect(heatmapWeekStart('2026-06-07')).toBe('2026-06-01'); // Sunday closes it
    expect(heatmapWeekStart('2026-06-08')).toBe('2026-06-08'); // next Monday
  });

  it('walks back across month and year boundaries', () => {
    expect(heatmapWeekStart('2026-03-01')).toBe('2026-02-23');
    expect(heatmapWeekStart('2026-01-01')).toBe('2025-12-29');
  });

  it('returns an unparseable key unchanged', () => {
    expect(heatmapWeekStart('nope')).toBe('nope');
    expect(heatmapWeekStart('2026-02-30')).toBe('2026-02-30');
  });
});

describe('heatmapLevelFor', () => {
  it('gives zero and below the zero bucket', () => {
    expect(heatmapLevelFor(0)).toBe(0);
    expect(heatmapLevelFor(-1)).toBe(0);
  });

  it('lifts any positive intensity to at least bucket 1', () => {
    expect(heatmapLevelFor(0.0001)).toBe(1);
    expect(heatmapLevelFor(0.25)).toBe(1);
  });

  it('splits the range into four discrete steps', () => {
    expect(heatmapLevelFor(0.26)).toBe(2);
    expect(heatmapLevelFor(0.5)).toBe(2);
    expect(heatmapLevelFor(0.51)).toBe(3);
    expect(heatmapLevelFor(0.75)).toBe(3);
    expect(heatmapLevelFor(0.76)).toBe(HEATMAP_LEVELS);
    expect(heatmapLevelFor(1)).toBe(HEATMAP_LEVELS);
  });

  it('caps an intensity above 1', () => {
    expect(heatmapLevelFor(9)).toBe(HEATMAP_LEVELS);
  });
});

describe('heatmapGrid — window and layout', () => {
  it('builds week columns of seven Monday-first rows', () => {
    const grid = heatmapGrid([], 12, END);
    expect(grid.columns).toHaveLength(12);
    expect(grid.columns.every((column) => column.length === 7)).toBe(true);
    expect(grid.start).toBe(START);
    expect(grid.end).toBe(END);
    expect(grid.weeks).toBe(12);
    // Row 0 is Monday, row 6 is Sunday.
    expect(grid.columns[0][0].date).toBe('2026-05-04');
    expect(grid.columns[0][6].date).toBe('2026-05-10');
    expect(grid.columns[1][0].date).toBe('2026-05-11');
  });

  it('counts the days actually in range', () => {
    const grid = heatmapGrid([], 12, END);
    expect(grid.daysInRange).toBe(83); // 11 full weeks + Mon–Sat
    expect(allCells(grid).filter((c) => c.inRange)).toHaveLength(83);
  });

  it('marks days past the end date as out of range', () => {
    const grid = heatmapGrid([], 12, END);
    expect(cellOn(grid, END).inRange).toBe(true);
    expect(cellOn(grid, PADDING_DAY).inRange).toBe(false);
    expect(allCells(grid).filter((c) => !c.inRange).map((c) => c.date)).toEqual([PADDING_DAY]);
  });

  it('leaves six padding days when the window ends on a Monday', () => {
    const grid = heatmapGrid([], 4, '2026-07-20');
    const last = grid.columns[3];
    expect(last[0]).toMatchObject({ date: '2026-07-20', inRange: true });
    expect(last.slice(1).every((c) => !c.inRange)).toBe(true);
    expect(grid.daysInRange).toBe(22); // 3 full weeks + the Monday
  });

  it('clamps the week count', () => {
    expect(heatmapGrid([], 0, END).weeks).toBe(1);
    expect(heatmapGrid([], -5, END).weeks).toBe(1);
    expect(heatmapGrid([], 1000, END).weeks).toBe(53);
    expect(heatmapGrid([], 12.4, END).weeks).toBe(12);
    expect(heatmapGrid([], Number.NaN, END).weeks).toBe(12);
  });

  it('falls back to today when the end date is unusable', () => {
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`;
    expect(heatmapGrid([], 4, 'not-a-date').end).toBe(todayKey);
    expect(heatmapGrid([], 4, '2026-02-30').end).toBe(todayKey);
  });
});

describe('heatmapGrid — absent is not zero', () => {
  it('distinguishes no data, a logged zero and a logged value', () => {
    const grid = heatmapGrid(
      [
        { date: '2026-07-20', value: 0 },
        { date: '2026-07-22', value: 5 },
      ],
      12,
      END
    );

    const noData = cellOn(grid, '2026-07-21');
    expect(noData).toMatchObject({ value: null, intensity: null, level: -1, inRange: true });

    const zero = cellOn(grid, '2026-07-20');
    expect(zero).toMatchObject({ value: 0, intensity: 0, level: 0, inRange: true });

    const logged = cellOn(grid, '2026-07-22');
    expect(logged).toMatchObject({ value: 5, intensity: 1, level: 4, inRange: true });

    // The three states are genuinely different, not just differently named.
    expect(zero.level).not.toBe(noData.level);
    expect(zero.value).not.toBe(noData.value);
  });

  it('separates out-of-window padding from an in-window blank by inRange', () => {
    const grid = heatmapGrid([], 12, END);
    expect(cellOn(grid, '2026-07-21')).toMatchObject({ level: -1, inRange: true });
    expect(cellOn(grid, PADDING_DAY)).toMatchObject({ level: -1, inRange: false });
  });

  it('counts explicit zeros as logged days', () => {
    const grid = heatmapGrid([{ date: '2026-07-20', value: 0 }], 12, END);
    expect(grid.loggedDays).toBe(1);
    expect(grid.zeroDays).toBe(1);
    expect(grid.total).toBe(0);
    expect(grid.peak).toBeNull();
  });

  it('floors a negative value to a logged zero rather than dropping the day', () => {
    const grid = heatmapGrid([{ date: '2026-07-20', value: -4 }], 12, END);
    expect(cellOn(grid, '2026-07-20')).toMatchObject({ value: 0, level: 0 });
    expect(grid.zeroDays).toBe(1);
  });

  it('treats a non-finite value as a logged zero', () => {
    const grid = heatmapGrid([{ date: '2026-07-20', value: Number.NaN }], 12, END);
    expect(cellOn(grid, '2026-07-20')).toMatchObject({ value: 0, level: 0 });
  });
});

describe('heatmapGrid — values, buckets and summary', () => {
  it('buckets against the observed maximum', () => {
    const grid = heatmapGrid(
      [
        { date: '2026-07-20', value: 8 },
        { date: '2026-07-21', value: 6 },
        { date: '2026-07-22', value: 4 },
        { date: '2026-07-23', value: 2 },
      ],
      12,
      END
    );
    expect(grid.max).toBe(8);
    expect(cellOn(grid, '2026-07-20').level).toBe(4);
    expect(cellOn(grid, '2026-07-21').level).toBe(3);
    expect(cellOn(grid, '2026-07-22').level).toBe(2);
    expect(cellOn(grid, '2026-07-23').level).toBe(1);
    expect(cellOn(grid, '2026-07-22').intensity).toBeCloseTo(0.5, 6);
  });

  it('honours an explicit max and clamps intensity at 1', () => {
    const values = [{ date: '2026-07-20', value: 20 }];
    expect(heatmapGrid(values, 12, END, 40).max).toBe(40);
    expect(cellOn(heatmapGrid(values, 12, END, 40), '2026-07-20').intensity).toBeCloseTo(0.5, 6);
    // A value above the declared ceiling saturates instead of overflowing.
    const capped = cellOn(heatmapGrid(values, 12, END, 10), '2026-07-20');
    expect(capped.intensity).toBe(1);
    expect(capped.level).toBe(4);
  });

  it('ignores a non-positive or non-finite max override', () => {
    const values = [{ date: '2026-07-20', value: 20 }];
    expect(heatmapGrid(values, 12, END, 0).max).toBe(20);
    expect(heatmapGrid(values, 12, END, -3).max).toBe(20);
    expect(heatmapGrid(values, 12, END, Number.NaN).max).toBe(20);
  });

  it('sums repeated dates so a raw event list works', () => {
    const grid = heatmapGrid(
      [
        { date: '2026-07-20', value: 1 },
        { date: '2026-07-20', value: 1 },
        { date: '2026-07-20', value: 1 },
      ],
      12,
      END
    );
    expect(cellOn(grid, '2026-07-20').value).toBe(3);
    expect(grid.loggedDays).toBe(1);
    expect(grid.total).toBe(3);
  });

  it('ignores dates outside the window', () => {
    const grid = heatmapGrid(
      [
        { date: '2026-05-03', value: 9 }, // day before the grid opens
        { date: '2026-07-26', value: 9 }, // padding day after the end
        { date: '2020-01-01', value: 9 },
        { date: '2026-07-20', value: 2 },
      ],
      12,
      END
    );
    expect(grid.loggedDays).toBe(1);
    expect(grid.max).toBe(2);
    expect(cellOn(grid, PADDING_DAY)).toMatchObject({ value: null, level: -1 });
  });

  it('ignores malformed dates and missing input', () => {
    const grid = heatmapGrid(
      [
        { date: 'yesterday', value: 3 },
        { date: '2026-13-01', value: 3 },
        { date: '2026-02-30', value: 3 },
        { date: '', value: 3 },
      ],
      12,
      END
    );
    expect(grid.loggedDays).toBe(0);
    expect(heatmapGrid(null, 12, END).loggedDays).toBe(0);
    expect(heatmapGrid(undefined, 12, END).loggedDays).toBe(0);
  });

  it('reports an empty window honestly', () => {
    const grid = heatmapGrid([], 12, END);
    expect(grid.loggedDays).toBe(0);
    expect(grid.zeroDays).toBe(0);
    expect(grid.total).toBe(0);
    expect(grid.max).toBe(0);
    expect(grid.peak).toBeNull();
    expect(allCells(grid).every((c) => c.level === -1 && c.value === null)).toBe(true);
  });

  it('handles a single logged day', () => {
    const grid = heatmapGrid([{ date: '2026-06-15', value: 7 }], 12, END);
    expect(grid.loggedDays).toBe(1);
    expect(grid.max).toBe(7);
    expect(grid.total).toBe(7);
    expect(grid.peak).toEqual({ date: '2026-06-15', value: 7 });
    expect(cellOn(grid, '2026-06-15')).toMatchObject({ level: 4, intensity: 1 });
  });

  it('resolves a peak tie to the earliest date', () => {
    const grid = heatmapGrid(
      [
        { date: '2026-07-22', value: 5 },
        { date: '2026-07-20', value: 5 },
      ],
      12,
      END
    );
    expect(grid.peak).toEqual({ date: '2026-07-20', value: 5 });
  });
});

describe('heatmapDescription', () => {
  it('states coverage, the absent split and the busiest day', () => {
    const grid = heatmapGrid(
      [
        { date: '2026-07-20', value: 5 },
        { date: '2026-07-21', value: 1 },
      ],
      12,
      END
    );
    const label = heatmapDescription(grid);
    expect(label).toContain('12-week activity grid ending 2026-07-25.');
    expect(label).toContain('2 of 83 days logged, 81 with no data.');
    expect(label).toContain('Highest 5 on 2026-07-20.');
    expect(label).not.toContain('logged as zero');
  });

  it('calls out logged zeros separately from missing days', () => {
    const grid = heatmapGrid(
      [
        { date: '2026-07-20', value: 0 },
        { date: '2026-07-21', value: 3 },
      ],
      12,
      END
    );
    expect(heatmapDescription(grid)).toContain('1 logged as zero.');
  });

  it('uses the caller empty label when nothing is logged', () => {
    const grid = heatmapGrid([], 12, END);
    expect(heatmapDescription(grid, 'No workouts yet')).toBe(
      '12-week activity grid ending 2026-07-25. No workouts yet'
    );
    expect(heatmapDescription(grid)).toContain('Nothing logged yet.');
  });
});

describe('heatmapLevelColors', () => {
  it('returns four distinct steps, lightest first', () => {
    const ramp = heatmapLevelColors('#4ECDC4', '#000000', '#F7FAFA', false);
    expect(ramp).toHaveLength(HEATMAP_LEVELS);
    expect(new Set(ramp).size).toBe(HEATMAP_LEVELS);
    const weight = (hex: string) =>
      parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    for (let i = 1; i < ramp.length; i += 1) {
      expect(weight(ramp[i])).toBeLessThan(weight(ramp[i - 1]));
    }
  });

  it('selects its own dark-mode steps rather than flipping the light ones', () => {
    const light = heatmapLevelColors('#4ECDC4', '#000000', '#F7FAFA', false);
    const dark = heatmapLevelColors('#4ECDC4', '#FFFFFF', '#202632', true);
    expect(dark).not.toEqual(light);
    expect(dark[HEATMAP_LEVELS - 1].toLowerCase()).toBe('#4ecdc4');
  });
});

describe('CalendarHeatmap render', () => {
  const values = [
    { date: '2026-07-20', value: 0 },
    { date: '2026-07-22', value: 5 },
  ];

  it('renders a cell per day plus the legend', () => {
    const tree = render(
      <CalendarHeatmap values={values} weeks={12} endDate={END} testID="grid" />
    );
    expect(findAllByTestID(tree, 'grid').length).toBeGreaterThan(0);
    expect(findAllByTestID(tree, 'grid-cell-2026-05-04').length).toBeGreaterThan(0);
    expect(findAllByTestID(tree, `grid-cell-${END}`).length).toBeGreaterThan(0);
    expect(findAllByTestID(tree, `grid-cell-${PADDING_DAY}`).length).toBeGreaterThan(0);
    expect(findAllByTestID(tree, 'grid-legend').length).toBeGreaterThan(0);
  });

  it('paints no-data, out-of-window and logged-zero cells differently', () => {
    const tree = render(
      <CalendarHeatmap values={values} weeks={12} endDate={END} testID="grid" />
    );
    const noData = flatStyle(findAllByTestID(tree, 'grid-cell-2026-07-21')[0]);
    const outside = flatStyle(findAllByTestID(tree, `grid-cell-${PADDING_DAY}`)[0]);
    const zero = flatStyle(findAllByTestID(tree, 'grid-cell-2026-07-20')[0]);
    const logged = flatStyle(findAllByTestID(tree, 'grid-cell-2026-07-22')[0]);

    // A day with no data is an outline; a logged zero is a filled chip.
    expect(noData.backgroundColor).toBe('transparent');
    expect(noData.borderWidth).toBeGreaterThan(0);
    expect(zero.backgroundColor).not.toBe('transparent');
    expect(zero.borderWidth).toBeUndefined();
    expect(zero.backgroundColor).not.toBe(logged.backgroundColor);

    // Outside the window nothing is drawn at all — not even the outline.
    expect(outside.backgroundColor).toBe('transparent');
    expect(outside.borderWidth).toBeUndefined();
  });

  it('carries an accessibility label that states the data in words', () => {
    const tree = render(
      <CalendarHeatmap values={values} weeks={12} endDate={END} testID="grid" />
    );
    const labelled = tree.root.findAll(
      (node) => typeof node.props?.accessibilityLabel === 'string'
    );
    expect(labelled.length).toBeGreaterThan(0);
    expect(labelled[0].props.accessibilityLabel).toBe(
      heatmapDescription(heatmapGrid(values, 12, END))
    );
  });

  it('shows and announces the empty label when nothing is logged', () => {
    const tree = render(
      <CalendarHeatmap
        values={[]}
        weeks={12}
        endDate={END}
        emptyLabel="No workouts yet"
        testID="grid"
      />
    );
    expect(findAllByTestID(tree, 'grid-empty').length).toBeGreaterThan(0);
    expect(collectText(tree.toJSON()).join('')).toContain('No workouts yet');
    const labelled = tree.root.findAll(
      (node) => typeof node.props?.accessibilityLabel === 'string'
    );
    expect(labelled[0].props.accessibilityLabel).toContain('No workouts yet');
  });

  it('can drop the legend and the weekday rail', () => {
    const tree = render(
      <CalendarHeatmap
        values={values}
        weeks={4}
        endDate={END}
        showLegend={false}
        showWeekdayLabels={false}
        testID="grid"
      />
    );
    expect(findAllByTestID(tree, 'grid-legend')).toHaveLength(0);
    const text = collectText(tree.toJSON()).join('');
    expect(text).not.toContain('Less');
    expect(text).not.toContain('M');
  });
});
