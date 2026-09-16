/**
 * Symply Health — `HealthHabitsScreen`, the donor-parity surface.
 *
 * WHAT THIS SUITE IS FOR. The Habits tab stopped being "a name and a tick" on
 * 2026-07-26: it gained a date selector, a schedule-aware completion ring, a
 * time-of-day filter, the 19-preset library, archive and a detail screen. Two of
 * those exist specifically because the donor got them WRONG, and both are silent
 * failures — nothing crashes, the numbers are just quietly untrue:
 *
 *  1. The donor's time-of-day chips bind a `@State` its grid never reads, so
 *     they filter nothing. HEALTH-HABIT-068 drives the filter and asserts the
 *     list actually changes.
 *  2. The donor's ring counts every habit against every day, so a weekdays-only
 *     habit makes a perfect Sunday read as a miss. HEALTH-HABIT-060 asserts the
 *     denominator is the SCHEDULED habits, not all of them.
 *
 * A regression in either would leave a screen that renders perfectly and lies.
 *
 * WHAT IS MOCKED. Only the async writers of the store, plus the two child
 * surfaces that own their own coverage (`HealthHabitDetailScreen`,
 * `HealthHabitForm`). The pure maths — `streakOf`, `isScheduledOn`,
 * `completionCounts`, `completionRate`, `lastDaysStatus`, `scheduleSummary`,
 * `searchHabitTemplates` — stays REAL, so every number and every filtered list
 * below is what the shipped arithmetic produces.
 *
 * DATES. The clock is pinned to Monday 2026-07-13 (weekday 2 in the Apple
 * numbering the schedule rules use), so "weekdays" is due and "weekends" is not.
 * 2026-07-12 is the Sunday before it — the reverse case, one tap away.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { ThemeProvider } from '@contexts/ThemeContext';

import {
  addHabit,
  addHabitFromTemplate,
  deleteHabit,
  loadHabits,
  setHabitArchived,
  toggleHabitToday,
  updateHabit,
  type Habit,
} from '../../healthHabitsStorage';
import { HealthHabitsScreen } from '../../screens/HealthHabitsScreen';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    ScreenHeader: ({ title }: { title?: string }) =>
      ReactMock.createElement(View, { testID: 'screen-header', accessibilityLabel: title }),
    ScreenScrollEnd: ({ testID }: { testID?: string }) =>
      ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
  };
});

// The detail sheet and the create form are their own surfaces with their own
// suites. Stubbed here so this file asserts the LIST screen's wiring — which
// habit is handed over, and that closing returns — rather than re-testing them.
// Each stub exposes the callbacks it was handed as its own pressables, so this
// suite can prove the LIST screen wired them to the right store call with the
// right habit — the half of the contract that lives here rather than in the
// child's own suite.
jest.mock('../../screens/HealthHabitDetailScreen', () => {
  const ReactMock = require('react');
  const { Pressable, View } = require('react-native');
  return {
    HealthHabitDetailScreen: (props: {
      habit: { id: string; name: string };
      onClose: () => void;
      onToggle: (habit: unknown, date: string) => void;
      onSave: (habit: unknown, patch: unknown) => void;
      onArchive: (habit: unknown, next: boolean) => void;
      onDelete: (habit: unknown) => void;
    }) =>
      ReactMock.createElement(View, { testID: 'habit-detail-host' }, [
        ReactMock.createElement(Pressable, {
          key: 'close',
          testID: 'habit-detail-stub',
          accessibilityLabel: props.habit.name,
          onPress: props.onClose,
        }),
        ReactMock.createElement(Pressable, {
          key: 'toggle',
          testID: 'habit-detail-toggle',
          onPress: () => props.onToggle(props.habit, '2026-07-12'),
        }),
        ReactMock.createElement(Pressable, {
          key: 'save',
          testID: 'habit-detail-save',
          onPress: () => props.onSave(props.habit, { name: 'Renamed', frequency: 'weekdays' }),
        }),
        ReactMock.createElement(Pressable, {
          key: 'archive',
          testID: 'habit-detail-archive',
          onPress: () => props.onArchive(props.habit, true),
        }),
        ReactMock.createElement(Pressable, {
          key: 'delete',
          testID: 'habit-detail-delete',
          onPress: () => props.onDelete(props.habit),
        }),
      ]),
  };
});

jest.mock('../../components', () => {
  const ReactMock = require('react');
  const { Pressable } = require('react-native');
  return {
    ...jest.requireActual('../../components'),
    HealthHabitForm: ({
      testIDPrefix,
      onSubmit,
    }: {
      testIDPrefix?: string;
      onSubmit: (draft: Record<string, unknown>) => void;
    }) =>
      ReactMock.createElement(Pressable, {
        testID: `${testIDPrefix}-form-stub`,
        onPress: () =>
          onSubmit({ name: 'Cold shower', icon: 'water', frequency: 'weekdays', category: 'hygiene' }),
      }),
  };
});

jest.mock('../../healthHabitsStorage', () => {
  const actual = jest.requireActual('../../healthHabitsStorage');
  return {
    ...actual,
    loadHabits: jest.fn(),
    toggleHabitToday: jest.fn(),
    addHabit: jest.fn(),
    addHabitFromTemplate: jest.fn(),
    updateHabit: jest.fn(),
    setHabitArchived: jest.fn(),
    deleteHabit: jest.fn(),
  };
});

const mockLoadHabits = loadHabits as jest.Mock;
const mockToggleHabitToday = toggleHabitToday as jest.Mock;
const mockAddHabit = addHabit as jest.Mock;
const mockAddHabitFromTemplate = addHabitFromTemplate as jest.Mock;
const mockUpdateHabit = updateHabit as jest.Mock;
const mockSetHabitArchived = setHabitArchived as jest.Mock;
const mockDeleteHabit = deleteHabit as jest.Mock;

/** Monday. `weekdayOf('2026-07-13') === 2`, so "weekdays" is due and "weekends" is not. */
const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';
const SUNDAY = '2026-07-12';

/** A whole habit — spread LAST so a newly added column fails here, not silently. */
function habit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'sleep',
    name: 'Sleep 7+ hours',
    icon: 'sleep-habit',
    category: 'custom',
    templateId: null,
    timeOfDay: 'anytime',
    frequency: 'daily',
    customDays: null,
    reminderTime: null,
    reminderEnabled: false,
    targetDuration: null,
    notes: null,
    archived: false,
    sortOrder: 0,
    days: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}

/** Flatten every string in the rendered host tree, preserving concatenation. */
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

/** Host nodes whose accessibility label contains `needle`. */
function byLabel(tree: ReactTestRenderer.ReactTestRenderer, needle: string) {
  return tree.root.findAll(
    (n) =>
      typeof n.type === 'string' &&
      typeof n.props?.accessibilityLabel === 'string' &&
      n.props.accessibilityLabel.includes(needle),
  );
}

/** The composite carrying `testID` (the Pressable, not its host View). */
function pressable(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function',
  );
}

function press(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  act(() => pressable(tree, testID).props.onPress());
}

async function pressAsync(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  await act(async () => pressable(tree, testID).props.onPress());
}

function input(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.find(
    (n) => (n.type as unknown as string) === 'TextInput' && n.props?.testID === testID,
  );
}

function type(tree: ReactTestRenderer.ReactTestRenderer, testID: string, text: string) {
  act(() => input(tree, testID).props.onChangeText(text));
}

/** The buttons the last `Alert.alert` call offered. */
function alertButtons(spy: jest.SpyInstance) {
  return spy.mock.calls[spy.mock.calls.length - 1][2] as Array<{
    text: string;
    style?: string;
    onPress?: () => void;
  }>;
}

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthHabitsScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(FIXED_NOW);

  mockLoadHabits.mockResolvedValue([]);
  mockToggleHabitToday.mockResolvedValue([]);
  mockAddHabit.mockResolvedValue([]);
  mockAddHabitFromTemplate.mockResolvedValue([]);
  mockUpdateHabit.mockResolvedValue([]);
  mockSetHabitArchived.mockResolvedValue([]);
  mockDeleteHabit.mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* Load + the schedule-aware summary                                   */
/* ------------------------------------------------------------------ */

describe('HealthHabitsScreen — load and daily summary', () => {
  it('HEALTH-HABIT-059: shows a spinner until the habits resolve, then the tab', async () => {
    // The read is a network round trip (`/health/habits`), so the gap between
    // mount and answer is real. Rendering the list shell during it would flash
    // "No habits yet" at a member who has five.
    mockLoadHabits.mockReturnValue(new Promise(() => {})); // never resolves
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <HealthHabitsScreen />
        </ThemeProvider>,
      );
    });

    expect(byTestId(tree, 'health-habits-screen').length).toBe(1);
    expect(tree.root.findAllByType(ActivityIndicator).length).toBe(1);
    expect(byTestId(tree, 'health-habits-empty').length).toBe(0);
    expect(byTestId(tree, 'health-habit-name-input').length).toBe(0);
  });

  it('HEALTH-HABIT-060: the ring counts only the habits SCHEDULED on the shown day', async () => {
    mockLoadHabits.mockResolvedValue([
      habit({ id: 'sleep', frequency: 'daily', days: [TODAY] }),
      habit({ id: 'lie-in', name: 'Weekend lie-in', frequency: 'weekends' }),
    ]);
    const tree = await render();

    // THE DONOR DEFECT THIS EXISTS TO PREVENT: counting the weekends habit on a
    // Monday makes a perfect day read 1/2 and 50%, and no member can ever hit
    // 100%. The denominator is what is DUE.
    expect(allText(byTestId(tree, 'health-habits-done-today')[0])).toBe('1/1');
    expect(allText(byTestId(tree, 'health-habits-completion')[0])).toContain('100%');
    // …and the screen says out loud that it hid one, so the count is explicable.
    expect(allText(byTestId(tree, 'health-habits-scheduled-note')[0])).toBe(
      '1 of 2 habits are scheduled for this day.',
    );
  });

  it('HEALTH-HABIT-061: when everything is due, the note says so instead of a fraction', async () => {
    mockLoadHabits.mockResolvedValue([habit({ id: 'sleep' }), habit({ id: 'move', name: 'Move' })]);
    const tree = await render();

    expect(allText(byTestId(tree, 'health-habits-scheduled-note')[0])).toBe(
      'Every habit is due on this day.',
    );
    expect(allText(byTestId(tree, 'health-habits-done-today')[0])).toBe('0/2');
    expect(allText(byTestId(tree, 'health-habits-completion')[0])).toContain('0%');
  });

  it('HEALTH-HABIT-062: the best-streak tile stays anchored on TODAY when a past day is shown', async () => {
    mockLoadHabits.mockResolvedValue([habit({ id: 'sleep', days: [TODAY] })]);
    const tree = await render();

    expect(allText(byTestId(tree, 'health-habits-best-streak')[0])).toContain('1 d');

    press(tree, 'health-habits-prev-day');

    // A streak is a property of the member's run to NOW, not of the day being
    // browsed. Anchoring it on the shown day would make yesterday's view report
    // "—" for a habit the member has ticked today — the tile would appear to
    // erase a live streak just because they paged back.
    expect(allText(byTestId(tree, 'health-habits-best-streak')[0])).toContain('1 d');
  });

  it('HEALTH-HABIT-063: the 7-day strip draws one dot per day and says how many are filled', async () => {
    mockLoadHabits.mockResolvedValue([
      habit({ id: 'sleep', days: [TODAY, '2026-07-11', '2026-07-08'] }),
    ]);
    const tree = await render();

    // The strip is the only place the last week is visible, and it is drawn as
    // anonymous dots — so its accessibility label IS a screen reader's whole
    // reading of it. Geometry and wording are both asserted.
    const [strip] = byLabel(tree, 'of the last');
    expect(strip.props.accessibilityLabel).toBe('3 of the last 7 days completed');
    expect(strip.children.length).toBe(7);
  });

  it('HEALTH-HABIT-064: a done habit draws the checkmark and says so; an undone one does not', async () => {
    mockLoadHabits.mockResolvedValue([
      habit({ id: 'sleep', name: 'Sleep 7+ hours', days: [TODAY] }),
      habit({ id: 'move', name: 'Move for 30 minutes' }),
    ]);
    const tree = await render();

    const done = pressable(tree, 'health-habit-toggle-sleep');
    const notDone = pressable(tree, 'health-habit-toggle-move');

    // Without the label a screen-reader user gets "Sleep 7+ hours, checkbox"
    // and no state at all.
    expect(done.props.accessibilityLabel).toBe('Sleep 7+ hours, done');
    expect(notDone.props.accessibilityLabel).toBe('Move for 30 minutes, not done');
    expect(done.props.accessibilityState.checked).toBe(true);
    expect(notDone.props.accessibilityState.checked).toBe(false);
    expect(done.findAllByType(Icon).length).toBe(1); // the checkmark
    expect(notDone.findAllByType(Icon).length).toBe(0);
    // The caption carries the schedule, and the streak only once there is one.
    expect(allText(byTestId(tree, 'health-habit-streak-sleep')[0])).toBe('Every day · 1 day streak');
    expect(allText(byTestId(tree, 'health-habit-streak-move')[0])).toBe('Every day');
  });

  it('HEALTH-HABIT-064b: a row shows the reminder bell only when one is actually set, and falls back to its category icon', async () => {
    mockLoadHabits.mockResolvedValue([
      // No icon of its own (a legacy/blank row) — falls back to the category.
      habit({ id: 'sleep', icon: '', category: 'sleep', reminderEnabled: true, reminderTime: '21:30' }),
      // Reminder OFF despite a stored time — the bell must not show anyway.
      habit({ id: 'move', reminderEnabled: false, reminderTime: '07:00' }),
      // Reminder ON but no time stored — same: no bell to point at nothing.
      habit({ id: 'read', reminderEnabled: true, reminderTime: null }),
    ]);
    const tree = await render();

    expect(byTestId(tree, 'health-habit-reminder-sleep')[0].props.accessibilityLabel).toBe(
      'Reminder at 21:30',
    );
    expect(byTestId(tree, 'health-habit-reminder-move')).toHaveLength(0);
    expect(byTestId(tree, 'health-habit-reminder-read')).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Ticking + the date selector                                         */
/* ------------------------------------------------------------------ */

describe('HealthHabitsScreen — ticking and the day being shown', () => {
  it('HEALTH-HABIT-065: unticking re-renders unchecked and drops the streak from the caption', async () => {
    mockLoadHabits.mockResolvedValue([habit({ id: 'sleep', days: [TODAY] })]);
    mockToggleHabitToday.mockResolvedValue([habit({ id: 'sleep', days: [] })]);
    const tree = await render();

    await pressAsync(tree, 'health-habit-toggle-sleep');

    // The OTHER direction: a toggle only ever driven one way is half-tested, and
    // a regression that made it idempotent-on would pass every tick test.
    expect(mockToggleHabitToday).toHaveBeenCalledWith('sleep', TODAY);
    expect(pressable(tree, 'health-habit-toggle-sleep').props.accessibilityState.checked).toBe(
      false,
    );
    expect(allText(byTestId(tree, 'health-habit-streak-sleep')[0])).toBe('Every day');
  });

  it('HEALTH-HABIT-066: the day can be paged back but never forward past today', async () => {
    mockLoadHabits.mockResolvedValue([habit({ id: 'sleep' })]);
    const tree = await render();

    expect(allText(byTestId(tree, 'health-habits-day-label')[0])).toBe('Today');
    // Forward is disabled ON today — a habit cannot be ticked in advance, and a
    // date the member cannot reach cannot be filed against.
    expect(pressable(tree, 'health-habits-next-day').props.accessibilityState.disabled).toBe(true);
    expect(byTestId(tree, 'health-habits-back-to-today').length).toBe(0);

    press(tree, 'health-habits-prev-day');
    expect(allText(byTestId(tree, 'health-habits-day-label')[0])).toBe('Yesterday');
    expect(pressable(tree, 'health-habits-next-day').props.accessibilityState.disabled).toBe(false);

    press(tree, 'health-habits-prev-day');
    // Two days back is neither Today nor Yesterday, so it is spelled out.
    expect(allText(byTestId(tree, 'health-habits-day-label')[0])).toBe('Saturday, Jul 11');

    press(tree, 'health-habits-back-to-today');
    expect(allText(byTestId(tree, 'health-habits-day-label')[0])).toBe('Today');
  });

  it('HEALTH-HABIT-067: ticking while a past day is shown files THAT day, not today', async () => {
    mockLoadHabits.mockResolvedValue([habit({ id: 'sleep' })]);
    const tree = await render();

    press(tree, 'health-habits-prev-day');
    await pressAsync(tree, 'health-habit-toggle-sleep');

    // This is the entire point of the date selector: a forgotten yesterday can
    // be ticked. Sending today's key instead would file the completion on the
    // wrong day AND leave the gap that broke the streak in place.
    expect(mockToggleHabitToday).toHaveBeenCalledWith('sleep', SUNDAY);
  });

  it('HEALTH-HABIT-068: the time-of-day filter actually filters, and keeps "anytime" habits', async () => {
    mockLoadHabits.mockResolvedValue([
      habit({ id: 'brush', name: 'Brush teeth', timeOfDay: 'morning' }),
      habit({ id: 'journal', name: 'Journal', timeOfDay: 'evening' }),
      habit({ id: 'water', name: 'Drink water', timeOfDay: 'anytime' }),
    ]);
    const tree = await render();

    expect(byTestId(tree, 'health-habit-brush').length).toBe(1);

    press(tree, 'health-habits-filter-evening');

    // THE DONOR DEFECT THIS EXISTS TO PREVENT: its chips bind a state the grid
    // never reads, so tapping one changes the chip and nothing else. An
    // "anytime" habit stays because it belongs to every part of the day.
    expect(byTestId(tree, 'health-habit-brush').length).toBe(0);
    expect(byTestId(tree, 'health-habit-journal').length).toBe(1);
    expect(byTestId(tree, 'health-habit-water').length).toBe(1);
    expect(pressable(tree, 'health-habits-filter-evening').props.accessibilityState.selected).toBe(
      true,
    );
    expect(pressable(tree, 'health-habits-filter-all').props.accessibilityState.selected).toBe(
      false,
    );

    press(tree, 'health-habits-filter-all');
    expect(byTestId(tree, 'health-habit-brush').length).toBe(1);
  });

  it('HEALTH-HABIT-069: an empty list explains WHY it is empty', async () => {
    mockLoadHabits.mockResolvedValue([
      habit({ id: 'lie-in', name: 'Weekend lie-in', frequency: 'weekends', timeOfDay: 'morning' }),
    ]);
    const tree = await render();

    // Monday: the weekends habit is not due, so the list is empty — but the
    // member HAS habits, and "No habits yet" would read as data loss.
    expect(allText(byTestId(tree, 'health-habits-empty')[0])).toBe(
      'Nothing is scheduled for this day.',
    );

    press(tree, 'health-habits-prev-day'); // Sunday — now it is due
    expect(byTestId(tree, 'health-habit-lie-in').length).toBe(1);

    press(tree, 'health-habits-filter-evening');
    // A different emptiness with a different cause, and a different sentence.
    expect(allText(byTestId(tree, 'health-habits-empty')[0])).toBe(
      'No habits in this part of the day.',
    );
  });

  it('HEALTH-HABIT-070: a genuinely empty account is told where habits come from', async () => {
    const tree = await render();

    expect(allText(byTestId(tree, 'health-habits-empty')[0])).toBe(
      'No habits yet. Add one from the library below.',
    );
    expect(allText(byTestId(tree, 'health-habits-done-today')[0])).toBe('0/0');
    expect(allText(byTestId(tree, 'health-habits-completion')[0])).toContain('0%');
    expect(allText(byTestId(tree, 'health-habits-best-streak')[0])).toContain('—');
  });
});

/* ------------------------------------------------------------------ */
/* The quick-add row                                                   */
/* ------------------------------------------------------------------ */

describe('HealthHabitsScreen — the quick-add row', () => {
  it('HEALTH-HABIT-071: a whitespace-only name leaves the button disabled and files nothing', async () => {
    const tree = await render();

    type(tree, 'health-habit-name-input', '   ');

    // The gate is `draft.trim().length === 0`, so a field that LOOKS full must
    // still refuse — otherwise the member gets a nameless row they cannot
    // identify, tick or find again.
    expect(pressable(tree, 'health-habit-add-button').props.accessibilityState.disabled).toBe(true);
    await pressAsync(tree, 'health-habit-add-button');
    expect(mockAddHabit).not.toHaveBeenCalled();
    // A refused add does NOT clear the draft — losing the typing would be worse.
    expect(input(tree, 'health-habit-name-input').props.value).toBe('   ');
  });

  it('HEALTH-HABIT-072: typing arms the button and clearing the field closes the gate again', async () => {
    const tree = await render();

    expect(pressable(tree, 'health-habit-add-button').props.accessibilityState.disabled).toBe(true);
    type(tree, 'health-habit-name-input', 'Walk after lunch');
    expect(pressable(tree, 'health-habit-add-button').props.accessibilityState.disabled).toBe(false);

    // Backspacing to empty has to re-close it: the gate is derived on every
    // render, so a cached flag would strand it open.
    type(tree, 'health-habit-name-input', '');
    expect(pressable(tree, 'health-habit-add-button').props.accessibilityState.disabled).toBe(true);
    await pressAsync(tree, 'health-habit-add-button');
    expect(mockAddHabit).not.toHaveBeenCalled();
  });

  it('HEALTH-HABIT-073: the keyboard Done key adds, and an empty field submits nothing', async () => {
    mockAddHabit.mockResolvedValue([habit({ id: 'custom-1', name: 'Walk after lunch' })]);
    const tree = await render();

    // `onSubmitEditing` runs `handleQuickAdd` directly rather than the button's
    // handler, so the gate has to live inside the handler too — `disabled`
    // protects only one of the two doors.
    await act(async () => input(tree, 'health-habit-name-input').props.onSubmitEditing());
    expect(mockAddHabit).not.toHaveBeenCalled();

    type(tree, 'health-habit-name-input', 'Walk after lunch');
    await act(async () => input(tree, 'health-habit-name-input').props.onSubmitEditing());

    expect(mockAddHabit).toHaveBeenCalledWith('Walk after lunch');
    // The list re-renders from what the STORE returned — the store trims and
    // truncates, so rendering the draft would show a name that is not the record.
    expect(byTestId(tree, 'health-habit-custom-1').length).toBe(1);
    expect(input(tree, 'health-habit-name-input').props.value).toBe('');
  });
});

/* ------------------------------------------------------------------ */
/* Archive + delete                                                    */
/* ------------------------------------------------------------------ */

describe('HealthHabitsScreen — archived habits', () => {
  it('HEALTH-HABIT-086: an archived habit leaves the list for a collapsed section it can return from', async () => {
    mockLoadHabits.mockResolvedValue([
      habit({ id: 'sleep' }),
      habit({ id: 'old', name: 'Old habit', archived: true, days: [SUNDAY, '2026-07-11'] }),
    ]);
    const tree = await render();

    // Out of the day's list and out of its denominator…
    expect(byTestId(tree, 'health-habit-old').length).toBe(0);
    expect(allText(byTestId(tree, 'health-habits-done-today')[0])).toBe('0/1');
    // …but still reachable. Archive is the only "deactivate" verb, and a habit
    // you can hide but never bring back is a delete that lies about being
    // reversible.
    expect(byTestId(tree, 'health-habit-unarchive-old').length).toBe(0); // collapsed
    press(tree, 'health-habits-archived-toggle');
    expect(allText(tree.toJSON())).toContain('ARCHIVED (1)');
    expect(allText(tree.toJSON())).toContain('best 2 d'); // longestStreakOf, not the live one

    await pressAsync(tree, 'health-habit-unarchive-old');
    expect(mockSetHabitArchived).toHaveBeenCalledWith('old', false);
  });

  it('HEALTH-HABIT-087: deleting an archived habit asks first, and Cancel means cancel', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLoadHabits.mockResolvedValue([habit({ id: 'old', name: 'Old habit', archived: true })]);
    const tree = await render();

    press(tree, 'health-habits-archived-toggle');
    press(tree, 'health-habit-delete-old');

    // Deleting takes the history with it, so the copy names the habit — an
    // unnamed "Are you sure?" on a list of similar rows is how a member deletes
    // the wrong streak.
    expect(alertSpy.mock.calls[0][0]).toBe('Delete habit');
    expect(alertSpy.mock.calls[0][1]).toBe('Remove "Old habit" and its history?');
    const buttons = alertButtons(alertSpy);
    expect(buttons.map((b) => b.text)).toEqual(['Cancel', 'Delete']);
    expect(buttons[0].style).toBe('cancel');
    expect(buttons[1].style).toBe('destructive');

    // Cancel carries NO onPress — dismissing is the absence of an action, the
    // case a "tap Delete, assert gone" test never covers.
    await act(async () => buttons.find((b) => b.text === 'Cancel')?.onPress?.());
    expect(mockDeleteHabit).not.toHaveBeenCalled();

    await act(async () => alertButtons(alertSpy).find((b) => b.text === 'Delete')?.onPress?.());
    expect(mockDeleteHabit).toHaveBeenCalledWith('old');
    alertSpy.mockRestore();
  });
});

/* ------------------------------------------------------------------ */
/* The preset library + the detail sheet                               */
/* ------------------------------------------------------------------ */

describe('HealthHabitsScreen — the preset library', () => {
  it('HEALTH-HABIT-088: the library opens, searches and reports an empty search honestly', async () => {
    const tree = await render();

    expect(byTestId(tree, 'health-habits-library').length).toBe(0);
    press(tree, 'health-habits-browse-library');
    expect(byTestId(tree, 'health-habits-library').length).toBe(1);
    expect(byTestId(tree, 'health-habit-template-floss').length).toBe(1);

    type(tree, 'health-habits-library-search', 'floss');
    expect(byTestId(tree, 'health-habit-template-floss').length).toBe(1);
    expect(byTestId(tree, 'health-habit-template-meditate').length).toBe(0);

    type(tree, 'health-habits-library-search', 'zzzz');
    // A dead end has to say so and offer the way out, not render an empty card.
    expect(allText(byTestId(tree, 'health-habits-library-empty')[0])).toContain(
      'create a custom habit',
    );

    press(tree, 'health-habits-browse-library'); // the same control closes it
    expect(byTestId(tree, 'health-habits-library').length).toBe(0);
  });

  it('HEALTH-HABIT-089: a preset already in the list cannot be added twice', async () => {
    mockLoadHabits.mockResolvedValue([
      habit({ id: 'h1', name: 'Floss', templateId: 'floss', category: 'dental' }),
    ]);
    const tree = await render();

    press(tree, 'health-habits-browse-library');

    // Adding "Floss" twice gives a member two identical rows with two separate
    // streaks and no way to tell them apart, so a taken preset is inert.
    const taken = pressable(tree, 'health-habit-template-floss');
    expect(taken.props.accessibilityState.disabled).toBe(true);
    await act(async () => taken.props.onPress());
    expect(mockAddHabitFromTemplate).not.toHaveBeenCalled();

    await pressAsync(tree, 'health-habit-template-meditate');
    // The WHOLE template goes over, not just its name: category, time of day,
    // frequency and the donor's suggested duration all ride along.
    expect(mockAddHabitFromTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'meditate', category: 'mindfulness', targetDuration: 600 }),
    );
  });

  it('HEALTH-HABIT-090: the library category chips narrow the presets', async () => {
    const tree = await render();
    press(tree, 'health-habits-browse-library');

    press(tree, 'health-habits-library-category-dental');
    expect(byTestId(tree, 'health-habit-template-floss').length).toBe(1);
    expect(byTestId(tree, 'health-habit-template-meditate').length).toBe(0);
    expect(
      pressable(tree, 'health-habits-library-category-dental').props.accessibilityState.selected,
    ).toBe(true);

    // Only categories that HAVE a preset are offered — the donor's `nutrition`
    // chip can only ever answer "nothing", which is a defect, not a filter.
    expect(byTestId(tree, 'health-habits-library-category-nutrition').length).toBe(0);
  });

  it('HEALTH-HABIT-091: the library and the custom form are mutually exclusive', async () => {
    const tree = await render();

    press(tree, 'health-habits-browse-library');
    expect(byTestId(tree, 'health-habits-library').length).toBe(1);

    press(tree, 'health-habits-create-custom');
    // Two stacked add surfaces on one scroll is how a member fills one and
    // submits the other; opening either closes the other.
    expect(byTestId(tree, 'health-habits-library').length).toBe(0);
    expect(byTestId(tree, 'health-habit-create-form-stub').length).toBe(1);

    press(tree, 'health-habits-create-custom'); // the same control cancels it
    expect(byTestId(tree, 'health-habit-create-form-stub').length).toBe(0);
  });

  it('HEALTH-HABIT-092: tapping a habit opens its detail, and closing returns to the list', async () => {
    mockLoadHabits.mockResolvedValue([
      habit({ id: 'sleep', name: 'Sleep 7+ hours' }),
      habit({ id: 'move', name: 'Move for 30 minutes' }),
    ]);
    const tree = await render();

    expect(byTestId(tree, 'habit-detail-stub').length).toBe(0);
    press(tree, 'health-habit-open-move');

    // The row hands over the habit it belongs to. Handing over the first (or a
    // stale) habit is the classic list-detail bug, so the identity is asserted.
    const [detail] = byTestId(tree, 'habit-detail-stub');
    expect(detail.props.accessibilityLabel).toBe('Move for 30 minutes');

    press(tree, 'habit-detail-stub'); // the stub's press is `onClose`
    expect(byTestId(tree, 'habit-detail-stub').length).toBe(0);
    expect(byTestId(tree, 'health-habit-sleep').length).toBe(1);
  });

  it('HEALTH-HABIT-093: the chevron opens the same detail as the row', async () => {
    mockLoadHabits.mockResolvedValue([habit({ id: 'sleep', name: 'Sleep 7+ hours' })]);
    const tree = await render();

    // Two affordances, one destination. The chevron is the one a member reaches
    // for when the row itself looks like a label rather than a button.
    press(tree, 'health-habit-chevron-sleep');
    expect(byTestId(tree, 'habit-detail-stub')[0].props.accessibilityLabel).toBe('Sleep 7+ hours');
  });

  it('HEALTH-HABIT-094: toggle and save are wired to the store, and archiving closes the sheet', async () => {
    const one = [habit({ id: 'sleep', name: 'Sleep 7+ hours' })];
    mockLoadHabits.mockResolvedValue(one);
    // Every writer answers with the habit still present: the sheet is resolved
    // BY ID out of the list, so a writer that returned an empty list would
    // close it as a side effect and hide the wiring this test is about.
    mockToggleHabitToday.mockResolvedValue(one);
    mockUpdateHabit.mockResolvedValue(one);
    mockSetHabitArchived.mockResolvedValue([{ ...one[0], archived: true }]);
    const tree = await render();
    press(tree, 'health-habit-open-sleep');

    await pressAsync(tree, 'habit-detail-toggle');
    // The detail sheet can tick a PAST day, so the date it passes has to be the
    // one it is showing — not the tab's.
    expect(mockToggleHabitToday).toHaveBeenCalledWith('sleep', SUNDAY);

    await pressAsync(tree, 'habit-detail-save');
    expect(mockUpdateHabit).toHaveBeenCalledWith('sleep', {
      name: 'Renamed',
      frequency: 'weekdays',
    });

    await pressAsync(tree, 'habit-detail-archive');
    expect(mockSetHabitArchived).toHaveBeenCalledWith('sleep', true);
    // Archiving takes the habit out of the list it was opened from, so leaving
    // the sheet up would strand the member on a row that no longer exists.
    expect(byTestId(tree, 'habit-detail-stub').length).toBe(0);
  });

  it('HEALTH-HABIT-097: the detail sheet’s delete is wired straight to the store, with no second alert', async () => {
    // `HealthHabitDetailScreen` owns ITS OWN confirmation (asserted in that
    // screen's own suite) before it ever calls `onDelete`. This mock stands
    // in for a member who already answered that alert, so `onDelete` firing
    // here must reach the store immediately — routing it back through a
    // second `Alert.alert` at the list-screen level would stack a duplicate,
    // identically-worded prompt on top of the one already answered.
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLoadHabits.mockResolvedValue([habit({ id: 'sleep', name: 'Sleep 7+ hours' })]);
    const tree = await render();
    press(tree, 'health-habit-open-sleep');

    await pressAsync(tree, 'habit-detail-delete');
    expect(mockDeleteHabit).toHaveBeenCalledWith('sleep');
    expect(alertSpy).not.toHaveBeenCalled();
    // Deleting removes the row the sheet was opened from, so it has to close.
    expect(byTestId(tree, 'habit-detail-stub').length).toBe(0);
    alertSpy.mockRestore();
  });

  it('HEALTH-HABIT-095: the custom form submits its whole draft and closes itself', async () => {
    const tree = await render();

    press(tree, 'health-habits-create-custom');
    await pressAsync(tree, 'health-habit-create-form-stub');

    // The quick row can only send a name; the form is the only way a schedule,
    // an icon and a category reach the store on CREATE, so the draft has to be
    // forwarded whole rather than reduced to its name.
    expect(mockAddHabit).toHaveBeenCalledWith(
      'Cold shower',
      'water',
      expect.objectContaining({ frequency: 'weekdays', category: 'hygiene' }),
    );
    // Submitting closes the form — leaving it open invites a duplicate add.
    expect(byTestId(tree, 'health-habit-create-form-stub').length).toBe(0);
  });

  it('HEALTH-HABIT-096: paging forward walks back toward today and stops there', async () => {
    mockLoadHabits.mockResolvedValue([habit({ id: 'sleep' })]);
    const tree = await render();

    press(tree, 'health-habits-prev-day');
    press(tree, 'health-habits-prev-day');
    expect(allText(byTestId(tree, 'health-habits-day-label')[0])).toBe('Saturday, Jul 11');

    press(tree, 'health-habits-next-day');
    expect(allText(byTestId(tree, 'health-habits-day-label')[0])).toBe('Yesterday');
    press(tree, 'health-habits-next-day');
    expect(allText(byTestId(tree, 'health-habits-day-label')[0])).toBe('Today');

    // And it stops: the guard is inside the handler as well as on `disabled`,
    // so a press that slips through the disabled state cannot reach tomorrow.
    press(tree, 'health-habits-next-day');
    expect(allText(byTestId(tree, 'health-habits-day-label')[0])).toBe('Today');
  });
});
