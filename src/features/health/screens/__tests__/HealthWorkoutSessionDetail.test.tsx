/**
 * HealthWorkoutSessionDetail — the session detail sheet opened from a row on
 * the Activity tab's SESSIONS card.
 *
 * A pure presentational Modal (all data arrives via props), so this suite
 * drives it directly rather than through the Activity screen — the screen's
 * own suite (`HealthSectionScreens.test.tsx`) covers the open/edit/delete
 * WIRING; this one covers what the sheet itself renders and confirms.
 */

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { DEFAULT_INTENSITY, type WorkoutEntry } from '../../healthActivityStorage';
import { HealthWorkoutSessionDetail } from '../HealthWorkoutSessionDetail';

type Rendered = ReactTestRenderer.ReactTestRenderer;

// Async, matching `HealthSectionScreens.test.tsx`'s own helper — a sync `act`
// leaves the icon font's own async `setState` unwrapped, which React warns on.
async function render(element: React.ReactElement): Promise<Rendered> {
  let tree!: Rendered;
  await act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{element}</ThemeProvider>);
  });
  return tree;
}

function byTestId(tree: Rendered, id: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

function press(tree: Rendered, testID: string) {
  const node = tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function',
  );
  act(() => node.props.onPress());
}

function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

/** Concatenated text of a host subtree, given a `ReactTestInstance` rather than a tree. */
function textOf(inst: ReactTestRenderer.ReactTestInstance): string {
  return inst
    .findAll((n) => typeof n.type === 'string')
    .flatMap((n) => {
      const c = n.props?.children;
      return Array.isArray(c) ? c : [c];
    })
    .filter((c) => typeof c === 'string' || typeof c === 'number')
    .map(String)
    .join('');
}

// Built through the LOCAL `Date` constructor, not a UTC literal — `formatClock`
// reads local wall-clock hours, so a hard-coded `...T12:00:00.000Z` renders as
// noon only in UTC and as something else everywhere the CI runner is not.
const NOON_LOCAL = new Date(2026, 6, 10, 12, 0, 0).toISOString();

function entry(over: Partial<WorkoutEntry> = {}): WorkoutEntry {
  return {
    id: over.id ?? 'w1',
    date: over.date ?? '2026-07-10',
    type: over.type ?? 'run',
    minutes: over.minutes ?? 40,
    calories: over.calories ?? 300,
    intensity: over.intensity ?? DEFAULT_INTENSITY,
    distanceM: over.distanceM ?? null,
    startedAt: over.startedAt ?? NOON_LOCAL,
    note: over.note ?? '',
    loggedAt: over.loggedAt ?? NOON_LOCAL,
  };
}

describe('HealthWorkoutSessionDetail', () => {
  it('HEALTH-WOD-001: renders the type, formatted date/time, and duration', async () => {
    const tree = await render(
      <HealthWorkoutSessionDetail
        entry={entry()}
        distanceUnit="km"
        onClose={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    const text = allText(tree.toJSON());
    expect(text).toContain('Running');
    expect(text).toContain('Jul 10, 2026 at 12:00');
    expect(text).toContain('40m');
  });

  it('HEALTH-WOD-002: calories, distance and intensity chips only render when the session recorded one', async () => {
    const bare = await render(
      <HealthWorkoutSessionDetail
        entry={entry({ calories: 0, distanceM: null, intensity: DEFAULT_INTENSITY })}
        distanceUnit="km"
        onClose={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(byTestId(bare, 'health-workout-detail-calories')).toHaveLength(0);
    expect(byTestId(bare, 'health-workout-detail-distance')).toHaveLength(0);
    expect(byTestId(bare, 'health-workout-detail-intensity')).toHaveLength(0);

    const full = await render(
      <HealthWorkoutSessionDetail
        entry={entry({ calories: 450, distanceM: 5000, intensity: 'hard' })}
        distanceUnit="km"
        onClose={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(byTestId(full, 'health-workout-detail-calories')).toHaveLength(1);
    expect(byTestId(full, 'health-workout-detail-distance')).toHaveLength(1);
    expect(byTestId(full, 'health-workout-detail-intensity')).toHaveLength(1);
    const fullText = allText(full.toJSON());
    expect(fullText).toContain('5.0 km');
    expect(fullText).toContain('Hard');
  });

  it('HEALTH-WOD-003: heart rate is a graceful empty state, never a raw error or an empty chart', async () => {
    const tree = await render(
      <HealthWorkoutSessionDetail
        entry={entry()}
        distanceUnit="km"
        onClose={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    const empty = byTestId(tree, 'health-workout-detail-heart-rate-empty')[0];
    expect(textOf(empty)).toContain('No heart rate data');
    expect(textOf(empty)).toContain("Heart rate isn't recorded for manually logged sessions.");
  });

  it('HEALTH-WOD-004: a note renders; a blank one adds nothing to the sheet', async () => {
    const withNote = await render(
      <HealthWorkoutSessionDetail
        entry={entry({ note: 'felt strong today' })}
        distanceUnit="km"
        onClose={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(byTestId(withNote, 'health-workout-detail-note')).toHaveLength(1);

    const blank = await render(
      <HealthWorkoutSessionDetail
        entry={entry({ note: '' })}
        distanceUnit="km"
        onClose={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(byTestId(blank, 'health-workout-detail-note')).toHaveLength(0);
  });

  it('HEALTH-WOD-005: close and edit hand the entry straight back to the caller', async () => {
    const onClose = jest.fn();
    const onEdit = jest.fn();
    const session = entry({ id: 'e9' });
    const tree = await render(
      <HealthWorkoutSessionDetail
        entry={session}
        distanceUnit="km"
        onClose={onClose}
        onEdit={onEdit}
        onDelete={jest.fn()}
      />,
    );

    press(tree, 'health-workout-detail-close');
    expect(onClose).toHaveBeenCalledTimes(1);

    press(tree, 'health-workout-detail-edit');
    expect(onEdit).toHaveBeenCalledWith(session);
  });

  it('HEALTH-WOD-006: delete asks first — cancelling calls nothing, confirming deletes by id', async () => {
    const onDelete = jest.fn();
    const session = entry({ id: 'e9' });
    const tree = await render(
      <HealthWorkoutSessionDetail
        entry={session}
        distanceUnit="km"
        onClose={jest.fn()}
        onEdit={jest.fn()}
        onDelete={onDelete}
      />,
    );

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    press(tree, 'health-workout-detail-delete');
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();

    // Firing the destructive button is what actually deletes — a cancel never
    // reaches this at all, since it never calls its `onPress`.
    const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    const destructive = buttons.find((b) => b.text === 'Delete');
    destructive?.onPress?.();
    expect(onDelete).toHaveBeenCalledWith('e9');
    alertSpy.mockRestore();
  });
});
