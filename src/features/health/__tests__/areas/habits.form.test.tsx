/**
 * `HealthHabitForm` — the ONE habit editor, used by both "create a custom
 * habit" (Habits tab) and "Edit" (the habit detail sheet).
 *
 * No suite had ever rendered the real component: `habits.screen.test.tsx`
 * mocks it wholesale into a one-button stub, so every field, chip, toggle and
 * day-picker in here — everything a member actually fills in — had zero
 * coverage. This file drives the real form directly with `onSubmit` /
 * `onCancel` spies, which is what the two call sites contribute themselves.
 *
 * Left out on purpose: `TimePickerSheet` is a shared, general-purpose date/time
 * component with its own coverage elsewhere; it is mocked here down to its
 * `visible` / `onConfirm` / `onClose` contract, which is all this form
 * actually depends on.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  formatReminderTime,
  HealthHabitForm,
  type HealthHabitFormProps,
} from '../../components/HealthHabitForm';
import {
  HABIT_CATEGORIES,
  HABIT_ICON_CHOICES,
  HABIT_TIME_OPTIONS,
  HABIT_WEEKDAYS,
  HABIT_WEEKDAYS_ALL,
  HABIT_WEEKDAYS_WEEKDAY_SET,
  HABIT_WEEKDAYS_WEEKEND_SET,
  type HabitDraft,
} from '../../healthHabitsStorage';

type Rendered = ReactTestRenderer.ReactTestRenderer;

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

jest.mock('@components/ui', () => {
  const actual = jest.requireActual('@components/ui');
  const ReactMock = require('react');
  const { View, Pressable, Text } = require('react-native');
  return {
    ...actual,
    // The real sheet drives a native `DateTimePicker`; this form only cares
    // that `visible` reflects `pickingTime` and that `onConfirm` / `onClose`
    // reach the fields they are wired to.
    TimePickerSheet: (props: {
      visible: boolean;
      value: string;
      onConfirm: (value: string) => void;
      onClose: () => void;
    }) =>
      props.visible
        ? ReactMock.createElement(View, { testID: 'time-picker-sheet' }, [
            ReactMock.createElement(Text, { key: 'v' }, props.value),
            ReactMock.createElement(Pressable, {
              key: 'confirm-invalid',
              testID: 'time-picker-confirm-invalid',
              onPress: () => props.onConfirm('nonsense'),
            }),
            ReactMock.createElement(Pressable, {
              key: 'confirm',
              testID: 'time-picker-confirm-07-30',
              onPress: () => props.onConfirm('7:30'),
            }),
            ReactMock.createElement(Pressable, {
              key: 'close',
              testID: 'time-picker-close',
              onPress: props.onClose,
            }),
          ])
        : null,
  };
});

function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

function byTestId(tree: Rendered, id: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

/** The composite carrying `testID` (the Pressable, not its host View). */
function pressable(tree: Rendered, testID: string) {
  return tree.root.find((n) => n.props?.testID === testID && typeof n.props?.onPress === 'function');
}

function press(tree: Rendered, testID: string) {
  act(() => pressable(tree, testID).props.onPress());
}

function switchNode(tree: Rendered, testID: string) {
  return tree.root.find((n) => n.props?.testID === testID && 'onValueChange' in n.props);
}

function toggle(tree: Rendered, testID: string, next: boolean) {
  act(() => switchNode(tree, testID).props.onValueChange(next));
}

function input(tree: Rendered, testID: string) {
  return tree.root.find(
    (n) => (n.type as unknown as string) === 'TextInput' && n.props?.testID === testID,
  );
}

function type(tree: Rendered, testID: string, text: string) {
  act(() => input(tree, testID).props.onChangeText(text));
}

async function render(props: Partial<HealthHabitFormProps> = {}) {
  const onSubmit = props.onSubmit ?? jest.fn();
  const merged: HealthHabitFormProps = {
    submitLabel: 'Add habit',
    onSubmit,
    testIDPrefix: 'hf',
    ...props,
  };
  let tree!: Rendered;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthHabitForm {...merged} />
      </ThemeProvider>,
    );
  });
  return { tree, onSubmit: merged.onSubmit };
}

/* ------------------------------------------------------------------ */
/* formatReminderTime — the pure helper                                */
/* ------------------------------------------------------------------ */

describe('formatReminderTime', () => {
  it('HEALTH-HABIT-300: renders 24h HH:MM as 12h with AM/PM, and handles noon/midnight', () => {
    expect(formatReminderTime('09:00')).toBe('9:00 AM');
    expect(formatReminderTime('13:05')).toBe('1:05 PM');
    expect(formatReminderTime('00:00')).toBe('12:00 AM'); // midnight, not "0:00"
    expect(formatReminderTime('12:00')).toBe('12:00 PM'); // noon, not "0:00 PM"
    expect(formatReminderTime('23:59')).toBe('11:59 PM');
  });

  it('HEALTH-HABIT-301: null, missing or unparsable input reads as "Not set"', () => {
    expect(formatReminderTime(null)).toBe('Not set');
    expect(formatReminderTime(undefined)).toBe('Not set');
    expect(formatReminderTime('not-a-time')).toBe('Not set');
    expect(formatReminderTime('25:99')).toBe('Not set');
  });
});

/* ------------------------------------------------------------------ */
/* Defaults and seeding from `initial`                                  */
/* ------------------------------------------------------------------ */

describe('HealthHabitForm — defaults and seeding', () => {
  it('HEALTH-HABIT-302: a blank form defaults to the donor starting point, Add disabled', async () => {
    const { tree } = await render();

    expect(input(tree, 'hf-name').props.value).toBe('');
    expect(byTestId(tree, 'hf-icon-goals')[0].props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(byTestId(tree, 'hf-category-custom')[0].props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(byTestId(tree, 'hf-time-anytime')[0].props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(byTestId(tree, 'hf-frequency-daily')[0].props.accessibilityState).toMatchObject({
      selected: true,
    });
    // Not `custom`, so the day picker is not even mounted.
    expect(byTestId(tree, 'hf-custom-days')).toHaveLength(0);
    expect(allText(tree.toJSON())).toContain('Off'); // reminder caption
    expect(byTestId(tree, 'hf-reminder-time')).toHaveLength(0);
    expect(input(tree, 'hf-notes').props.value).toBe('');
    // An empty name is the ONE thing that blocks Add — busy is the other.
    expect(byTestId(tree, 'hf-submit')[0].props.accessibilityState).toMatchObject({
      disabled: true,
    });
    expect(byTestId(tree, 'hf-cancel')).toHaveLength(0); // no onCancel passed in
  });

  it('HEALTH-HABIT-303: seeded from an existing habit, every control reflects it', async () => {
    const initial: HabitDraft = {
      name: 'Evening stretch',
      icon: 'stretch',
      category: 'fitness',
      timeOfDay: 'evening',
      frequency: 'custom',
      customDays: [3, 5],
      reminderEnabled: true,
      reminderTime: '19:30',
      notes: 'after the school run',
    };
    const { tree } = await render({ initial, submitLabel: 'Save' });

    expect(input(tree, 'hf-name').props.value).toBe('Evening stretch');
    expect(byTestId(tree, 'hf-icon-stretch')[0].props.accessibilityState.selected).toBe(true);
    expect(byTestId(tree, 'hf-category-fitness')[0].props.accessibilityState.selected).toBe(true);
    expect(byTestId(tree, 'hf-time-evening')[0].props.accessibilityState.selected).toBe(true);
    expect(byTestId(tree, 'hf-frequency-custom')[0].props.accessibilityState.selected).toBe(true);
    // Only the seeded days are on.
    expect(byTestId(tree, 'hf-day-3')[0].props.accessibilityState.selected).toBe(true);
    expect(byTestId(tree, 'hf-day-5')[0].props.accessibilityState.selected).toBe(true);
    expect(byTestId(tree, 'hf-day-2')[0].props.accessibilityState.selected).toBe(false);
    expect(allText(tree.toJSON())).toContain('7:30 PM'); // formatted reminderTime
    expect(byTestId(tree, 'hf-reminder-time')).toHaveLength(1);
    expect(input(tree, 'hf-notes').props.value).toBe('after the school run');
    expect(byTestId(tree, 'hf-submit')[0].props.accessibilityState.disabled).toBe(false);
  });

  it('HEALTH-HABIT-304: custom frequency with NO seeded days defaults every day on, not none', async () => {
    // A custom schedule with an empty day set is the exact defect the form's
    // own "cannot remove the last day" rule exists to prevent reaching.
    const { tree } = await render({ initial: { frequency: 'custom', customDays: [] } });

    press(tree, 'hf-frequency-custom'); // already selected, but mounts the section
    for (const day of HABIT_WEEKDAYS) {
      expect(byTestId(tree, `hf-day-${day.value}`)[0].props.accessibilityState.selected).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Every field is a real choice, and rides through onSubmit             */
/* ------------------------------------------------------------------ */

describe('HealthHabitForm — picking every field and submitting', () => {
  it('HEALTH-HABIT-305: typing a name is what un-disables Add', async () => {
    const { tree } = await render();
    expect(byTestId(tree, 'hf-submit')[0].props.accessibilityState.disabled).toBe(true);

    type(tree, 'hf-name', 'Walk after lunch');
    expect(byTestId(tree, 'hf-submit')[0].props.accessibilityState.disabled).toBe(false);

    type(tree, 'hf-name', '   ');
    expect(byTestId(tree, 'hf-submit')[0].props.accessibilityState.disabled).toBe(true);
  });

  it('HEALTH-HABIT-306: submits the trimmed name and every donor default, all 24 icons and 9 categories selectable', async () => {
    expect(HABIT_ICON_CHOICES.length).toBeGreaterThan(0);
    expect(HABIT_CATEGORIES.length).toBeGreaterThan(0);
    const { tree, onSubmit } = await render();

    type(tree, 'hf-name', '  Walk after lunch  ');
    press(tree, `hf-icon-${HABIT_ICON_CHOICES[3]}`);
    press(tree, `hf-category-${HABIT_CATEGORIES[2].value}`);
    press(tree, `hf-time-${HABIT_TIME_OPTIONS[0].value}`);
    press(tree, 'hf-submit');

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Walk after lunch',
      icon: HABIT_ICON_CHOICES[3],
      category: HABIT_CATEGORIES[2].value,
      timeOfDay: HABIT_TIME_OPTIONS[0].value,
      frequency: 'daily',
      customDays: null, // not `custom`, so no day set rides along
      reminderEnabled: false,
      reminderTime: null,
      notes: null,
    });
  });

  it('HEALTH-HABIT-307: switching frequency to custom reveals the day picker; away from it hides it', async () => {
    const { tree } = await render();
    expect(byTestId(tree, 'hf-custom-days')).toHaveLength(0);

    press(tree, 'hf-frequency-custom');
    expect(byTestId(tree, 'hf-custom-days')).toHaveLength(1);

    press(tree, 'hf-frequency-weekdays');
    expect(byTestId(tree, 'hf-custom-days')).toHaveLength(0);
  });

  it('HEALTH-HABIT-308: toggling a day removes it, but the LAST remaining day cannot be removed', async () => {
    const { tree, onSubmit } = await render({
      initial: { frequency: 'custom', customDays: [2, 4] },
    });
    type(tree, 'hf-name', 'Gym');

    press(tree, 'hf-day-2'); // remove Monday — two left becomes one
    expect(byTestId(tree, 'hf-day-2')[0].props.accessibilityState.selected).toBe(false);
    expect(byTestId(tree, 'hf-day-4')[0].props.accessibilityState.selected).toBe(true);

    press(tree, 'hf-day-4'); // the ONLY remaining day — must refuse
    expect(byTestId(tree, 'hf-day-4')[0].props.accessibilityState.selected).toBe(true);

    press(tree, 'hf-day-6'); // adding is unrestricted, and stays sorted
    expect(byTestId(tree, 'hf-day-6')[0].props.accessibilityState.selected).toBe(true);

    press(tree, 'hf-submit');
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ customDays: [4, 6] }));
  });

  it('HEALTH-HABIT-309: the weekdays / weekends / every-day presets replace the whole day set', async () => {
    const { tree } = await render({ initial: { frequency: 'custom', customDays: [1] } });

    press(tree, 'hf-dayset-weekdays');
    for (const d of HABIT_WEEKDAYS_WEEKDAY_SET) {
      expect(byTestId(tree, `hf-day-${d}`)[0].props.accessibilityState.selected).toBe(true);
    }
    expect(byTestId(tree, 'hf-day-1')[0].props.accessibilityState.selected).toBe(false);

    press(tree, 'hf-dayset-weekends');
    for (const d of HABIT_WEEKDAYS_WEEKEND_SET) {
      expect(byTestId(tree, `hf-day-${d}`)[0].props.accessibilityState.selected).toBe(true);
    }
    expect(byTestId(tree, 'hf-day-2')[0].props.accessibilityState.selected).toBe(false);

    press(tree, 'hf-dayset-every-day');
    for (const d of HABIT_WEEKDAYS_ALL) {
      expect(byTestId(tree, `hf-day-${d}`)[0].props.accessibilityState.selected).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Reminder toggle + time picker                                        */
/* ------------------------------------------------------------------ */

describe('HealthHabitForm — reminder', () => {
  it('HEALTH-HABIT-310: switching the reminder on with no time set picks 09:00, a real switch that does something', async () => {
    const { tree } = await render();
    expect(byTestId(tree, 'hf-reminder-time')).toHaveLength(0);

    toggle(tree, 'hf-reminder-toggle', true);

    expect(byTestId(tree, 'hf-reminder-time')).toHaveLength(1);
    expect(allText(tree.toJSON())).toContain('9:00 AM');
  });

  it('HEALTH-HABIT-311: switching on with an ALREADY-set time keeps it, rather than resetting to the default', async () => {
    const { tree } = await render({ initial: { reminderEnabled: false, reminderTime: '14:15' } });

    toggle(tree, 'hf-reminder-toggle', true);

    expect(allText(tree.toJSON())).toContain('2:15 PM');
  });

  it('HEALTH-HABIT-312: switching off hides the time row but the caption reads "Off"', async () => {
    const { tree } = await render({ initial: { reminderEnabled: true, reminderTime: '08:00' } });
    expect(byTestId(tree, 'hf-reminder-time')).toHaveLength(1);

    toggle(tree, 'hf-reminder-toggle', false);

    expect(byTestId(tree, 'hf-reminder-time')).toHaveLength(0);
    expect(allText(tree.toJSON())).toContain('Off');
  });

  it('HEALTH-HABIT-313: opening the time picker mounts it, and Close discards without changing the time', async () => {
    const { tree, onSubmit } = await render({ initial: { reminderEnabled: true, reminderTime: '08:00' } });
    type(tree, 'hf-name', 'Meds');

    expect(byTestId(tree, 'time-picker-sheet')).toHaveLength(0);
    press(tree, 'hf-reminder-time');
    expect(byTestId(tree, 'time-picker-sheet')).toHaveLength(1);

    press(tree, 'time-picker-close');
    expect(byTestId(tree, 'time-picker-sheet')).toHaveLength(0);

    press(tree, 'hf-submit');
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ reminderTime: '08:00' }));
  });

  it('HEALTH-HABIT-314: confirming a new time updates the field and closes the sheet', async () => {
    const { tree, onSubmit } = await render({ initial: { reminderEnabled: true, reminderTime: '08:00' } });
    type(tree, 'hf-name', 'Meds');

    press(tree, 'hf-reminder-time');
    press(tree, 'time-picker-confirm-07-30');

    expect(byTestId(tree, 'time-picker-sheet')).toHaveLength(0);
    expect(allText(tree.toJSON())).toContain('7:30 AM');

    press(tree, 'hf-submit');
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ reminderTime: '07:30' }));
  });

  it('HEALTH-HABIT-315: an unparsable confirmed value falls back to the 09:00 default, not a broken caption', async () => {
    const { tree } = await render({ initial: { reminderEnabled: true, reminderTime: '08:00' } });

    press(tree, 'hf-reminder-time');
    press(tree, 'time-picker-confirm-invalid');

    expect(allText(tree.toJSON())).toContain('9:00 AM');
  });

  it('HEALTH-HABIT-315b: a row seeded already-on with no valid time submits the 09:00 default, not null', async () => {
    // A habit whose reminder was somehow left on with an unparsable/missing
    // time (a partial edit elsewhere, or a legacy row) and submitted WITHOUT
    // the member ever touching the toggle — `handleReminderToggle`'s own
    // "pick a default" never runs, so `handleSubmit` has to catch it too.
    const { tree, onSubmit } = await render({
      initial: { reminderEnabled: true, reminderTime: null },
    });
    type(tree, 'hf-name', 'Meds');

    press(tree, 'hf-submit');
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ reminderEnabled: true, reminderTime: '09:00' }),
    );
  });
});

/* ------------------------------------------------------------------ */
/* Notes, Cancel, and busy                                              */
/* ------------------------------------------------------------------ */

describe('HealthHabitForm — notes, cancel and busy', () => {
  it('HEALTH-HABIT-316: notes are trimmed on submit, and whitespace-only becomes null', async () => {
    const { tree, onSubmit } = await render();
    type(tree, 'hf-name', 'Read');
    type(tree, 'hf-notes', '  ten pages before bed  ');

    press(tree, 'hf-submit');
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ notes: 'ten pages before bed' }),
    );
  });

  it('HEALTH-HABIT-317: Cancel only renders when a handler is given, and fires it', async () => {
    const withoutCancel = await render();
    expect(byTestId(withoutCancel.tree, 'hf-cancel')).toHaveLength(0);

    const onCancel = jest.fn();
    const { tree } = await render({ onCancel });
    press(tree, 'hf-cancel');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('HEALTH-HABIT-318: busy disables Add even with a valid name, and a press is a no-op', async () => {
    const { tree, onSubmit } = await render({ busy: true });
    type(tree, 'hf-name', 'Read');

    expect(byTestId(tree, 'hf-submit')[0].props.accessibilityState.disabled).toBe(true);
    press(tree, 'hf-submit');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
