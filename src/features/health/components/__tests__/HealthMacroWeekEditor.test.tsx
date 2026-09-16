/**
 * HealthMacroWeekEditor — the per-weekday protein/carbs/fat editor (macro
 * sibling of the calorie `CalorieWeek` editor), driven ONE day at a time via
 * a chip row rather than a 21-field grid.
 *
 * Drives the real component and asserts: the body is hidden until the toggle
 * is on; turning it on seeds every day from `flatTargets` (`seedMacroWeek`),
 * so the day selected by default is never blank; switching the day chip reads
 * and edits THAT day only, leaving the others untouched; "Use X's split for
 * every day" fans the selected day out via `copyMacroDayToAll`; and the macro
 * bar + difference caption only appear once the selected day actually has a
 * macro typed.
 *
 * `todayDateKey` is mocked to a fixed Monday so the default-selected day
 * (`weekdayIndexOf(todayDateKey())`) does not depend on the real calendar
 * date the test happens to run on.
 */
jest.mock('@features/health/healthLocalStorage', () => ({
  ...jest.requireActual('@features/health/healthLocalStorage'),
  todayDateKey: () => '2026-01-05', // a Monday
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import { EMPTY_MACRO_WEEK, type MacroWeek } from '@features/health/healthGoalsStorage';

import { HealthMacroWeekEditor } from '../HealthMacroWeekEditor';

function pressByTestId(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const node = tree.root.findAllByProps({ testID })[0];
  node.props.onPress?.();
}

function toggle(tree: ReactTestRenderer.ReactTestRenderer, testID: string, value: boolean) {
  const node = tree.root
    .findAllByProps({ testID })
    .find((n) => typeof n.props.onValueChange === 'function');
  node?.props.onValueChange?.(value);
}

function typeInto(tree: ReactTestRenderer.ReactTestRenderer, testID: string, text: string) {
  const node = tree.root
    .findAllByProps({ testID })
    .find((n) => typeof n.props.onChangeText === 'function');
  node?.props.onChangeText?.(text);
}

function fieldValue(tree: ReactTestRenderer.ReactTestRenderer, testID: string): string {
  return tree.root
    .findAllByProps({ testID })
    .find((n) => typeof n.props.onChangeText === 'function')?.props.value;
}

function isVisible(tree: ReactTestRenderer.ReactTestRenderer, testID: string): boolean {
  return tree.root.findAllByProps({ testID }).length > 0;
}

const FLAT_TARGETS = { protein: 150, carbs: 200, fat: 70 };
const CALORIES_BY_DAY = [2000, 2000, 2000, 2000, 2000, 2200, 2200];

function Harness({ initial = EMPTY_MACRO_WEEK }: { initial?: MacroWeek }) {
  const [week, setWeek] = React.useState<MacroWeek>(initial);
  return (
    <HealthMacroWeekEditor
      week={week}
      onChange={setWeek}
      flatTargets={FLAT_TARGETS}
      caloriesByDay={CALORIES_BY_DAY}
      testIDPrefix="macro-week"
    />
  );
}

function renderEditor(initial?: MacroWeek) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <Harness initial={initial} />
      </ThemeProvider>
    );
  });
  return tree;
}

describe('HealthMacroWeekEditor', () => {
  it('hides the per-day body until the toggle is on', () => {
    const tree = renderEditor();
    expect(isVisible(tree, 'macro-week-body')).toBe(false);

    act(() => toggle(tree, 'macro-week-toggle', true));
    expect(isVisible(tree, 'macro-week-body')).toBe(true);
  });

  it('seeds every day from flatTargets the moment the toggle turns on', () => {
    const tree = renderEditor();
    act(() => toggle(tree, 'macro-week-toggle', true));

    // Default-selected day is Monday (index 0) — the mocked "today".
    expect(fieldValue(tree, 'macro-week-protein-input')).toBe('150');
    expect(fieldValue(tree, 'macro-week-carbs-input')).toBe('200');
    expect(fieldValue(tree, 'macro-week-fat-input')).toBe('70');
  });

  it('edits only the selected day, leaving the others at their seeded split', () => {
    const tree = renderEditor();
    act(() => toggle(tree, 'macro-week-toggle', true));

    act(() => typeInto(tree, 'macro-week-protein-input', '220'));
    expect(fieldValue(tree, 'macro-week-protein-input')).toBe('220');

    act(() => pressByTestId(tree, 'macro-week-day-tue'));
    expect(fieldValue(tree, 'macro-week-protein-input')).toBe('150');

    act(() => pressByTestId(tree, 'macro-week-day-mon'));
    expect(fieldValue(tree, 'macro-week-protein-input')).toBe('220');
  });

  it('"Use X\'s split for every day" fans the selected day out to all seven', () => {
    const tree = renderEditor();
    act(() => toggle(tree, 'macro-week-toggle', true));
    act(() => typeInto(tree, 'macro-week-protein-input', '999'));

    act(() => pressByTestId(tree, 'macro-week-copy-all'));

    act(() => pressByTestId(tree, 'macro-week-day-sun'));
    expect(fieldValue(tree, 'macro-week-protein-input')).toBe('999');
  });

  it('shows the macro bar and difference caption only once the day has a macro typed', () => {
    // Turning the toggle ON seeds EVERY day from flatTargets, so there is no
    // "untouched day" reachable through that path — this state (usePerDay
    // already on, every day still genuinely blank) is what a fresh remote
    // load with no prior per-day plan looks like.
    const noMacrosYet: MacroWeek = {
      usePerDay: true,
      days: Array.from({ length: 7 }, () => ({ protein: null, carbs: null, fat: null })),
    };
    const tree = renderEditor(noMacrosYet);

    expect(isVisible(tree, 'macro-week-bar')).toBe(false);
    expect(isVisible(tree, 'macro-week-difference')).toBe(false);

    act(() => typeInto(tree, 'macro-week-protein-input', '150'));

    expect(isVisible(tree, 'macro-week-bar')).toBe(true);
    expect(isVisible(tree, 'macro-week-difference')).toBe(true);
  });

  it('turning the toggle off hides the body without discarding the typed split', () => {
    const tree = renderEditor();
    act(() => toggle(tree, 'macro-week-toggle', true));
    act(() => typeInto(tree, 'macro-week-protein-input', '777'));

    act(() => toggle(tree, 'macro-week-toggle', false));
    expect(isVisible(tree, 'macro-week-body')).toBe(false);

    act(() => toggle(tree, 'macro-week-toggle', true));
    expect(fieldValue(tree, 'macro-week-protein-input')).toBe('777');
  });
});
