/**
 * HealthActivityCustomPeriod — the donor's `WorkoutsCustomPeriodView` ported
 * standalone: an arbitrary `From`/`To` range over the whole workout history,
 * its own statistics card and a capped session list.
 *
 * Fixed `today` throughout (`2026-07-27`) so the default "last 30 days" window
 * and the quick-select chips are deterministic rather than riding the clock.
 */

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import type { WorkoutEntry } from '../../healthActivityStorage';
import {
  daysBetweenKeys,
  dayKeysInRange,
  HealthActivityCustomPeriod,
  isValidDateKey,
  quickRangeMatches,
} from '../HealthActivityCustomPeriod';

const TODAY = '2026-07-27';

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

function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

function textOf(tree: Rendered, id: string): string {
  return allText(byTestId(tree, id)[0] ?? null);
}

function input(tree: Rendered, testID: string) {
  return tree.root.find(
    (n) => (n.type as unknown as string) === 'TextInput' && n.props?.testID === testID
  );
}

function type(tree: Rendered, testID: string, text: string) {
  act(() => input(tree, testID).props.onChangeText(text));
}

/** Fire onPress on the composite carrying `testID` (Pressable, not its host View). */
function press(tree: Rendered, testID: string) {
  const node = tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function'
  );
  act(() => node.props.onPress());
}

function chipSelected(tree: Rendered, testID: string): boolean {
  const node = tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function'
  );
  return node.props.accessibilityState?.selected === true;
}

let nextId = 0;
function entry(over: Partial<WorkoutEntry> = {}): WorkoutEntry {
  nextId += 1;
  return {
    id: over.id ?? `w${nextId}`,
    date: over.date ?? TODAY,
    type: over.type ?? 'run',
    minutes: over.minutes ?? 30,
    calories: over.calories ?? 0,
    intensity: over.intensity ?? 'steady',
    distanceM: over.distanceM === undefined ? null : over.distanceM,
    startedAt: over.startedAt === undefined ? null : over.startedAt,
    note: over.note ?? '',
    loggedAt: over.loggedAt ?? `${over.date ?? TODAY}T12:00:00.000Z`,
  };
}

describe('pure helpers', () => {
  it('CUSTOM-PERIOD-001: isValidDateKey accepts only YYYY-MM-DD', () => {
    expect(isValidDateKey('2026-07-13')).toBe(true);
    expect(isValidDateKey('2026-7-13')).toBe(false);
    expect(isValidDateKey('not-a-date')).toBe(false);
    expect(isValidDateKey('')).toBe(false);
  });

  it('CUSTOM-PERIOD-002: daysBetweenKeys is the calendar-day span, exclusive', () => {
    expect(daysBetweenKeys('2026-06-27', '2026-07-27')).toBe(30);
    expect(daysBetweenKeys('2026-07-27', '2026-07-27')).toBe(0);
  });

  it('CUSTOM-PERIOD-003: dayKeysInRange is inclusive at both ends', () => {
    expect(dayKeysInRange('2026-07-01', '2026-07-03')).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
    ]);
  });

  it('CUSTOM-PERIOD-004: quickRangeMatches only when the window ends today', () => {
    expect(quickRangeMatches(7, '2026-07-20', '2026-07-27', TODAY)).toBe(true);
    expect(quickRangeMatches(7, '2026-07-20', '2026-07-26', TODAY)).toBe(false);
  });
});

describe('HealthActivityCustomPeriod', () => {
  it('CUSTOM-PERIOD-005: default 30-day range totals only the workouts inside it', () => {
    const workouts: WorkoutEntry[] = [
      entry({ id: 'in-1', date: '2026-07-01', type: 'run', minutes: 30, calories: 250, distanceM: 5000 }),
      entry({ id: 'in-2', date: '2026-07-10', type: 'walk', minutes: 45, calories: 150 }),
      entry({ id: 'in-3', date: '2026-07-20', type: 'strength', minutes: 60, calories: 300 }),
      // Outside the default window (before 2026-06-27) — must not be counted.
      entry({ id: 'out-1', date: '2026-05-01', type: 'run', minutes: 999, calories: 999 }),
    ];
    const tree = render(
      <HealthActivityCustomPeriod
        visible
        onClose={jest.fn()}
        workouts={workouts}
        distanceUnit="km"
        today={TODAY}
      />
    );

    expect(input(tree, 'health-activity-custom-period-from-input').props.value).toBe('2026-06-27');
    expect(input(tree, 'health-activity-custom-period-to-input').props.value).toBe(TODAY);
    expect(textOf(tree, 'health-activity-custom-period-days')).toBe('30 days');
    expect(textOf(tree, 'health-activity-custom-period-count')).toBe('3 workouts');

    expect(textOf(tree, 'health-activity-custom-period-stat-workouts')).toContain('3');
    expect(textOf(tree, 'health-activity-custom-period-stat-calories')).toContain('700 kcal');
    expect(textOf(tree, 'health-activity-custom-period-stat-duration')).toContain('2h 15m');
    expect(textOf(tree, 'health-activity-custom-period-stat-distance')).toContain('5.0 km');

    // The out-of-range entry never renders.
    expect(byTestId(tree, 'health-activity-custom-period-entry-out-1')).toHaveLength(0);
    expect(byTestId(tree, 'health-activity-custom-period-entry-in-1')).toHaveLength(1);
  });

  it('CUSTOM-PERIOD-006: a distance nobody measured reads "—", never "0 km"', () => {
    const workouts: WorkoutEntry[] = [
      entry({ id: 'w1', date: '2026-07-10', type: 'strength', minutes: 20, calories: 100 }),
    ];
    const tree = render(
      <HealthActivityCustomPeriod
        visible
        onClose={jest.fn()}
        workouts={workouts}
        distanceUnit="km"
        today={TODAY}
      />
    );
    expect(textOf(tree, 'health-activity-custom-period-stat-distance')).toContain('—');
  });

  it('CUSTOM-PERIOD-007: quick-select chips overwrite both fields and mark themselves selected', () => {
    const workouts: WorkoutEntry[] = [entry({ id: 'w1', date: '2026-07-25', minutes: 20 })];
    const tree = render(
      <HealthActivityCustomPeriod
        visible
        onClose={jest.fn()}
        workouts={workouts}
        distanceUnit="km"
        today={TODAY}
      />
    );

    // The default 30-day window starts selected.
    expect(chipSelected(tree, 'health-activity-custom-period-quick-30')).toBe(true);
    expect(chipSelected(tree, 'health-activity-custom-period-quick-7')).toBe(false);

    press(tree, 'health-activity-custom-period-quick-7');

    expect(input(tree, 'health-activity-custom-period-from-input').props.value).toBe('2026-07-20');
    expect(input(tree, 'health-activity-custom-period-to-input').props.value).toBe(TODAY);
    expect(chipSelected(tree, 'health-activity-custom-period-quick-7')).toBe(true);
    expect(chipSelected(tree, 'health-activity-custom-period-quick-30')).toBe(false);
    expect(textOf(tree, 'health-activity-custom-period-days')).toBe('7 days');
  });

  it('CUSTOM-PERIOD-008: an unparsable date shows the error caption and falls back to the empty state', () => {
    const workouts: WorkoutEntry[] = [entry({ id: 'w1', date: '2026-07-10', minutes: 20 })];
    const tree = render(
      <HealthActivityCustomPeriod
        visible
        onClose={jest.fn()}
        workouts={workouts}
        distanceUnit="km"
        today={TODAY}
      />
    );

    type(tree, 'health-activity-custom-period-from-input', 'not-a-date');

    expect(textOf(tree, 'health-activity-custom-period-error')).toBe(
      'Use YYYY-MM-DD for both the start and end date.'
    );
    // No day/workout-count caption while the range itself cannot be trusted.
    expect(byTestId(tree, 'health-activity-custom-period-days')).toHaveLength(0);
    // Neither field is disabled — both remain live TextInputs the user can fix.
    expect(input(tree, 'health-activity-custom-period-from-input').props.editable).not.toBe(false);
    expect(input(tree, 'health-activity-custom-period-to-input').props.editable).not.toBe(false);
    expect(byTestId(tree, 'health-activity-custom-period-empty')).toHaveLength(1);
    expect(byTestId(tree, 'health-activity-custom-period-stats')).toHaveLength(0);
  });

  it('CUSTOM-PERIOD-009: an end date in the future is refused in words', () => {
    const tree = render(
      <HealthActivityCustomPeriod
        visible
        onClose={jest.fn()}
        workouts={[]}
        distanceUnit="km"
        today={TODAY}
      />
    );
    type(tree, 'health-activity-custom-period-to-input', '2026-08-15');
    expect(textOf(tree, 'health-activity-custom-period-error')).toBe(
      "The end date can't be in the future — a custom period can only look back."
    );
  });

  it('CUSTOM-PERIOD-010: a valid range with nothing in it shows the empty state', () => {
    const workouts: WorkoutEntry[] = [entry({ id: 'w1', date: '2026-07-10', minutes: 20 })];
    const tree = render(
      <HealthActivityCustomPeriod
        visible
        onClose={jest.fn()}
        workouts={workouts}
        distanceUnit="km"
        today={TODAY}
      />
    );

    type(tree, 'health-activity-custom-period-from-input', '2026-01-01');
    type(tree, 'health-activity-custom-period-to-input', '2026-01-31');

    expect(byTestId(tree, 'health-activity-custom-period-empty')).toHaveLength(1);
    expect(textOf(tree, 'health-activity-custom-period-empty')).toContain(
      'No workouts for selected period'
    );
    expect(textOf(tree, 'health-activity-custom-period-empty')).toContain(
      'Try selecting a different date range'
    );
    expect(byTestId(tree, 'health-activity-custom-period-stats')).toHaveLength(0);
  });

  it('CUSTOM-PERIOD-011: more than 10 matching workouts caps the list and captions the rest', () => {
    const workouts: WorkoutEntry[] = Array.from({ length: 13 }, (_, i) =>
      entry({ id: `w${i}`, date: '2026-07-15', minutes: 10 })
    );
    const tree = render(
      <HealthActivityCustomPeriod
        visible
        onClose={jest.fn()}
        workouts={workouts}
        distanceUnit="km"
        today={TODAY}
      />
    );

    for (let i = 0; i < 10; i += 1) {
      expect(byTestId(tree, `health-activity-custom-period-entry-w${i}`)).toHaveLength(1);
    }
    for (let i = 10; i < 13; i += 1) {
      expect(byTestId(tree, `health-activity-custom-period-entry-w${i}`)).toHaveLength(0);
    }
    expect(textOf(tree, 'health-activity-custom-period-more')).toBe('+3 more workouts');
  });

  it('CUSTOM-PERIOD-012: renders nothing behind the sheet while closed', () => {
    const tree = render(
      <HealthActivityCustomPeriod
        visible={false}
        onClose={jest.fn()}
        workouts={[]}
        distanceUnit="km"
        today={TODAY}
      />
    );
    expect(byTestId(tree, 'health-activity-custom-period-from-input')).toHaveLength(0);
  });
});
