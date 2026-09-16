/**
 * Symply Health — `HealthWeightWeeklyChart`, the donor's `weeklyWeightChartSection`
 * generalised to every window width the Weight tab's ◀ / ▶ navigator offers.
 *
 * Mirrors the render harness `HealthWeightWidgets.test.tsx` already uses in this
 * directory (`react-test-renderer` directly): `@testing-library/react-native` is
 * not a dependency of this repo, so every other Health component test drives a
 * `ReactTestRenderer` tree and queries it by `testID` instead.
 */

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import type { DatedValue } from '../../healthDashboards';
import { weightWindow } from '../../healthWeightAnalytics';
import { HealthWeightWeeklyChart, type HealthWeightWeeklyChartProps } from '../HealthWeightWeeklyChart';

/**
 * A Sunday — the LAST day of its Monday–Sunday calendar week, so the 7-day
 * window (`weightWindow`'s `days === 7` case) lands on exactly Mon 13 Jul …
 * Sun 19 Jul with nothing left to log: every day in the window is `<= today`.
 */
const TODAY = '2026-07-19';

function day(date: string, value: number): DatedValue {
  return { date, value };
}

function baseProps(over: Partial<HealthWeightWeeklyChartProps> = {}): HealthWeightWeeklyChartProps {
  return {
    allDaily: [],
    window: weightWindow(TODAY, 7, 0),
    today: TODAY,
    unit: 'kg',
    goal: null,
    onAddForDate: jest.fn(),
    ...over,
  };
}

async function renderChart(props: HealthWeightWeeklyChartProps) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthWeightWeeklyChart {...props} />
      </ThemeProvider>
    );
  });
  return tree;
}

type Json = { props?: Record<string, unknown>; children?: unknown } | string | number | null;

/** Depth-first search of the RENDERED json for a node carrying `testID`. */
function findJson(json: unknown, testID: string): Json {
  if (json == null || typeof json !== 'object') return null;
  if (Array.isArray(json)) {
    for (const child of json) {
      const hit = findJson(child, testID);
      if (hit) return hit;
    }
    return null;
  }
  const node = json as { props?: Record<string, unknown>; children?: unknown };
  if (node.props?.testID === testID) return node;
  return findJson(node.children, testID);
}

function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

function text(tree: ReactTestRenderer.ReactTestRenderer, testID: string): string {
  const node = findJson(tree.toJSON(), testID);
  if (node === null) throw new Error(`no node with testID "${testID}"`);
  return allText(node);
}

function has(tree: ReactTestRenderer.ReactTestRenderer, testID: string): boolean {
  return (
    tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === testID).length > 0
  );
}

function find(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.find((n) => n.props?.testID === testID);
}

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

describe('HealthWeightWeeklyChart', () => {
  it('WEIGHT-WEEKLY-001: an empty 7-day window renders all 7 days as tappable empty slots and "0/7"', async () => {
    const tree = await renderChart(baseProps({ allDaily: [] }));

    expect(text(tree, 'health-weight-weeklychart-title')).toBe('WEEKLY WEIGHT');

    for (const key of WEEKDAY_KEYS) {
      expect(has(tree, `health-weight-weeklychart-add-${key}`)).toBe(true);
      expect(has(tree, `health-weight-weeklychart-bar-${key}`)).toBe(false);
    }

    expect(text(tree, 'health-weight-weeklychart-entries')).toBe('0/7');
    expect(text(tree, 'health-weight-weeklychart-range')).toBe('—');
    expect(text(tree, 'health-weight-weeklychart-change')).toBe('—');
    expect(has(tree, 'health-weight-weeklychart-average-caption')).toBe(false);
  });

  it('WEIGHT-WEEKLY-002: a partially-logged window computes Entries, Range and Change from the WINDOW only', async () => {
    const allDaily: DatedValue[] = [
      day('2026-07-06', 85), // the window before this one — must not leak in
      day('2026-07-13', 82), // Monday — window.start
      day('2026-07-15', 81), // Wednesday
      day('2026-07-17', 80.5), // Friday
    ];
    const tree = await renderChart(baseProps({ allDaily }));

    expect(has(tree, 'health-weight-weeklychart-bar-mon')).toBe(true);
    expect(has(tree, 'health-weight-weeklychart-bar-wed')).toBe(true);
    expect(has(tree, 'health-weight-weeklychart-bar-fri')).toBe(true);
    expect(has(tree, 'health-weight-weeklychart-add-tue')).toBe(true);
    expect(has(tree, 'health-weight-weeklychart-add-thu')).toBe(true);
    expect(has(tree, 'health-weight-weeklychart-add-sat')).toBe(true);
    expect(has(tree, 'health-weight-weeklychart-add-sun')).toBe(true);

    expect(text(tree, 'health-weight-weeklychart-entries')).toBe('3/7');
    // low 80.5, high 82 (Monday's 82 is an integer once parsed as a number).
    expect(text(tree, 'health-weight-weeklychart-range')).toBe('80.5–82 kg');
    // Last logged (Friday 80.5) minus first logged (Monday 82) = -1.5.
    expect(text(tree, 'health-weight-weeklychart-change')).toBe('-1.5 kg');
    // (82 + 81 + 80.5) / 3 = 81.1666… → 81.2.
    expect(text(tree, 'health-weight-weeklychart-average-caption')).toBe('Ø 81.2 kg');
  });

  it('WEIGHT-WEEKLY-002b: each logged bar prints its own value above it, and an empty slot prints none', async () => {
    const allDaily: DatedValue[] = [
      day('2026-07-13', 82), // Monday
      day('2026-07-15', 81.4), // Wednesday
    ];
    const tree = await renderChart(baseProps({ allDaily }));

    expect(text(tree, 'health-weight-weeklychart-barvalue-mon')).toBe('82');
    expect(text(tree, 'health-weight-weeklychart-barvalue-wed')).toBe('81.4');
    expect(has(tree, 'health-weight-weeklychart-barvalue-tue')).toBe(false);
  });

  it('WEIGHT-WEEKLY-002c: beyond 7 days, a bucketed bar prints its average above it', async () => {
    // The 30-day window is the calendar month of July (TODAY = 19 Jul), so
    // bucket 0 is its first 7-day span, 1–7 Jul — both readings land in it.
    const allDaily: DatedValue[] = [day('2026-07-02', 82), day('2026-07-04', 80)];
    const tree = await renderChart(baseProps({ window: weightWindow(TODAY, 30, 0), allDaily }));

    // (82 + 80) / 2 = 81.
    expect(text(tree, 'health-weight-weeklychart-bucketvalue-0')).toBe('81');
  });

  it("WEIGHT-WEEKLY-003: tapping an empty day slot calls onAddForDate with that day's dateKey", async () => {
    const onAddForDate = jest.fn();
    const tree = await renderChart(
      baseProps({ allDaily: [day('2026-07-13', 82)], onAddForDate })
    );

    const tuesdaySlot = find(tree, 'health-weight-weeklychart-add-tue');
    act(() => {
      (tuesdaySlot.props.onPress as () => void)();
    });

    expect(onAddForDate).toHaveBeenCalledWith('2026-07-14');
    expect(onAddForDate).toHaveBeenCalledTimes(1);
  });

  it('WEIGHT-WEEKLY-004: the Goal chip is a disabled "No goal" pill when goal is null, and a toggleable chip otherwise', async () => {
    const noGoal = await renderChart(baseProps({ goal: null }));
    expect(text(noGoal, 'health-weight-weeklychart-toggle-goal')).toBe('No goal');
    const disabledNode = find(noGoal, 'health-weight-weeklychart-toggle-goal');
    expect(disabledNode.props.onPress).toBeUndefined();

    const withGoal = await renderChart(baseProps({ goal: 75 }));
    expect(text(withGoal, 'health-weight-weeklychart-toggle-goal')).toBe('Goal 75 kg');
    const chip = find(withGoal, 'health-weight-weeklychart-toggle-goal');
    expect(chip.props.accessibilityState?.selected).toBe(false);

    act(() => {
      (chip.props.onPress as () => void)();
    });
    expect(find(withGoal, 'health-weight-weeklychart-toggle-goal').props.accessibilityState?.selected).toBe(
      true
    );
    expect(has(withGoal, 'health-weight-weeklychart-goal-line')).toBe(true);
  });

  it('WEIGHT-WEEKLY-005: the Average toggle draws a reference line only once switched on', async () => {
    const tree = await renderChart(
      baseProps({ allDaily: [day('2026-07-13', 82), day('2026-07-15', 80)] })
    );
    expect(has(tree, 'health-weight-weeklychart-average-line')).toBe(false);

    const toggle = find(tree, 'health-weight-weeklychart-toggle-average');
    act(() => {
      (toggle.props.onPress as () => void)();
    });
    expect(has(tree, 'health-weight-weeklychart-average-line')).toBe(true);
  });

  it('WEIGHT-WEEKLY-006: a Monday-start week can extend past today, but only past/present days are tappable', async () => {
    // The calendar week containing a mid-week `today` (not a Sunday) still
    // runs the full Mon-Sun span, so Thursday-Sunday are still ahead of
    // Wednesday `today` — those days render as a non-interactive placeholder
    // instead of a tappable "+", since there is nothing to log for a day that
    // has not happened yet.
    const midWeekToday = '2026-07-15'; // Wednesday
    const onAddForDate = jest.fn();
    const tree = await renderChart(
      baseProps({
        today: midWeekToday,
        window: weightWindow(midWeekToday, 7, 0),
        allDaily: [],
        onAddForDate,
      })
    );
    // The window is Mon 13 Jul … Sun 19 Jul — Mon/Tue/Wed are loggable,
    // Thu/Fri/Sat/Sun are still ahead of `midWeekToday`.
    for (const key of ['mon', 'tue', 'wed']) {
      const slot = find(tree, `health-weight-weeklychart-add-${key}`);
      act(() => {
        (slot.props.onPress as () => void)();
      });
    }
    expect(onAddForDate).toHaveBeenCalledTimes(3);
    for (const call of onAddForDate.mock.calls) {
      expect(call[0] <= midWeekToday).toBe(true);
    }

    for (const key of ['thu', 'fri', 'sat', 'sun']) {
      expect(has(tree, `health-weight-weeklychart-add-${key}`)).toBe(false);
      expect(has(tree, `health-weight-weeklychart-future-${key}`)).toBe(true);
    }
  });

  it('WEIGHT-WEEKLY-007: the title and bucket count follow the window width — MONTHLY/90 DAYS/YEAR, not always WEEKLY', async () => {
    const monthly = await renderChart(baseProps({ window: weightWindow(TODAY, 30, 0) }));
    expect(text(monthly, 'health-weight-weeklychart-title')).toBe('MONTHLY WEIGHT');
    // July's calendar month is 31 days, bucketed into 7-day bars: 4 full weeks
    // + a 3-day remainder = 5 bars.
    expect(has(monthly, 'health-weight-weeklychart-bucket-0')).toBe(true);
    expect(has(monthly, 'health-weight-weeklychart-bucket-4')).toBe(true);
    expect(has(monthly, 'health-weight-weeklychart-bucket-5')).toBe(false);
    expect(text(monthly, 'health-weight-weeklychart-entries')).toBe('0/31');

    const ninety = await renderChart(baseProps({ window: weightWindow(TODAY, 90, 0) }));
    expect(text(ninety, 'health-weight-weeklychart-title')).toBe('90 DAYS WEIGHT');
    // 90 ÷ 7 = 12 full weeks + a 6-day remainder = 13 bars.
    expect(has(ninety, 'health-weight-weeklychart-bucket-12')).toBe(true);
    expect(has(ninety, 'health-weight-weeklychart-bucket-13')).toBe(false);

    const year = await renderChart(baseProps({ window: weightWindow(TODAY, 365, 0) }));
    expect(text(year, 'health-weight-weeklychart-title')).toBe('YEAR WEIGHT');
    // 365 ÷ 31 = 11 full 31-day buckets + a 24-day remainder = 12 bars.
    expect(has(year, 'health-weight-weeklychart-bucket-11')).toBe(true);
    expect(has(year, 'health-weight-weeklychart-bucket-12')).toBe(false);
  });

  it('WEIGHT-WEEKLY-008: beyond 7 days, tapping ANY bucket opens the log form for TODAY — bars have no single date of their own', async () => {
    const onAddForDate = jest.fn();
    const tree = await renderChart(
      baseProps({ window: weightWindow(TODAY, 30, 0), onAddForDate })
    );

    const bucket = find(tree, 'health-weight-weeklychart-bucket-0');
    act(() => {
      (bucket.props.onPress as () => void)();
    });

    expect(onAddForDate).toHaveBeenCalledWith(TODAY);
    expect(onAddForDate).toHaveBeenCalledTimes(1);
  });
});
