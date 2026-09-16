/**
 * MonthPickerSheet — a month and a year on two wheels, plus the quick-pick
 * bubbles a caller renders beside the field.
 *
 * What is asserted here is the part that has no visual tell: which month a
 * shorthand like "this year" actually resolves to, and that the two wheels can
 * never combine into a month outside the caller's range. A wheel showing a row
 * the range excludes looks perfectly normal until Done confirms it.
 */
import { Picker } from '@react-native-picker/picker';
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  MonthPickerSheet,
  currentMonthKey,
  formatMonthKey,
  monthKey,
  monthSuggestions,
  parseMonthKey,
} from '../MonthPickerSheet';

function renderSheet(props: { value: string; minMonth?: string; maxMonth?: string }) {
  const onConfirm = jest.fn();
  const onClose = jest.fn();
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <MonthPickerSheet
          visible
          title="Target finish month"
          value={props.value}
          minMonth={props.minMonth}
          maxMonth={props.maxMonth}
          onConfirm={onConfirm}
          onClose={onClose}
          testID="month-picker"
        />
      </ThemeProvider>,
    );
  });
  const wheel = (which: 'month' | 'year') =>
    tree.root.findAll(
      (node) => node.type === Picker && node.props.testID === `month-picker-${which}`,
    )[0];
  const labelsOf = (which: 'month' | 'year') =>
    (wheel(which).props.children as { props: { label: string } }[]).map((item) => item.props.label);
  return { tree, onConfirm, onClose, wheel, labelsOf };
}

describe('month key helpers', () => {
  it('pads a single-digit month', () => {
    expect(monthKey(2026, 3)).toBe('2026-03');
    expect(monthKey(2026, 12)).toBe('2026-12');
  });

  it('reads a YYYY-MM key back as a 1-based month', () => {
    expect(parseMonthKey('2026-08')).toEqual({ year: 2026, month: 8 });
  });

  /**
   * The wizard seeds this from `targetEndAt.slice(0, 7)` and clears it to `''`,
   * so both an empty field and a stray full timestamp have to come back null
   * rather than a nonsense month.
   */
  it('rejects anything that is not a real month key', () => {
    expect(parseMonthKey('')).toBeNull();
    expect(parseMonthKey(undefined)).toBeNull();
    expect(parseMonthKey('2026-13')).toBeNull();
    expect(parseMonthKey('2026-00')).toBeNull();
    expect(parseMonthKey('2026-08-01T00:00:00.000Z')).toBeNull();
  });

  it('formats long and short, and falls through to empty for a bad key', () => {
    expect(formatMonthKey('2026-12')).toBe('December 2026');
    expect(formatMonthKey('2026-12', 'short')).toBe('Dec 2026');
    expect(formatMonthKey('')).toBe('');
  });

  it('reads the current month off a date in local time', () => {
    expect(currentMonthKey(new Date(2026, 7, 27))).toBe('2026-08');
  });
});

describe('the quick-pick bubbles', () => {
  /**
   * The whole reason each bubble renders its resolved month: on a target date,
   * "this year" means by the END of it. January would be a target eleven months
   * earlier than the member meant.
   */
  it('resolves this/next year to December, not January', () => {
    expect(monthSuggestions(new Date(2026, 7, 27))).toEqual([
      { key: 'this-month', label: 'This month', month: '2026-08' },
      { key: 'this-year', label: 'This year', month: '2026-12' },
      { key: 'next-year', label: 'Next year', month: '2027-12' },
    ]);
  });

  it('drops "this year" in December, where it duplicates "this month"', () => {
    expect(monthSuggestions(new Date(2026, 11, 4)).map((s) => s.key)).toEqual([
      'this-month',
      'next-year',
    ]);
  });
});

describe('MonthPickerSheet wheels', () => {
  it('offers only the months the range allows in a partial first year', () => {
    const { labelsOf } = renderSheet({ value: '2026-09', minMonth: '2026-08', maxMonth: '2028-03' });
    expect(labelsOf('month')).toEqual(['August', 'September', 'October', 'November', 'December']);
    expect(labelsOf('year')).toEqual(['2026', '2027', '2028']);
  });

  it('opens on the committed month', () => {
    const { wheel } = renderSheet({ value: '2027-05', minMonth: '2026-08' });
    expect(wheel('month').props.selectedValue).toBe(5);
    expect(wheel('year').props.selectedValue).toBe(2027);
  });

  it('opens on the floor when the committed month is behind it', () => {
    const { wheel } = renderSheet({ value: '2024-01', minMonth: '2026-08' });
    expect(wheel('month').props.selectedValue).toBe(8);
    expect(wheel('year').props.selectedValue).toBe(2026);
  });

  /**
   * The failure this guards: December 2027 is a legal pick, 2028 is capped at
   * March, and scrolling the YEAR wheel alone would leave the month wheel
   * reading "December" on a year that stops at March.
   */
  it('pulls the month back when a year change puts it past the ceiling', () => {
    const { wheel, labelsOf } = renderSheet({
      value: '2027-12',
      minMonth: '2026-08',
      maxMonth: '2028-03',
    });

    act(() => wheel('year').props.onValueChange(2028));

    expect(wheel('month').props.selectedValue).toBe(3);
    expect(labelsOf('month')).toEqual(['January', 'February', 'March']);
  });

  it('pushes the month forward when a year change puts it before the floor', () => {
    const { wheel } = renderSheet({ value: '2027-01', minMonth: '2026-08', maxMonth: '2028-03' });

    act(() => wheel('year').props.onValueChange(2026));

    expect(wheel('month').props.selectedValue).toBe(8);
  });

  it('confirms the drafted month on Done, and nothing on Cancel', () => {
    const { tree, wheel, onConfirm, onClose } = renderSheet({
      value: '2026-09',
      minMonth: '2026-08',
    });

    act(() => wheel('month').props.onValueChange(11));
    // The sheet's dismiss is the shared header's ✕ now — one id for every
    // sheet in the app — rather than a per-picker `…-cancel` text button.
    act(() => tree.root.findByProps({ testID: 'bottom-sheet-close' }).props.onPress());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();

    act(() => tree.root.findByProps({ testID: 'month-picker-done' }).props.onPress());
    expect(onConfirm).toHaveBeenCalledWith('2026-11');
  });

  /** A ceiling under the floor would otherwise leave an empty year wheel. */
  it('collapses an inverted range to a single month rather than nothing', () => {
    const { labelsOf } = renderSheet({ value: '', minMonth: '2026-08', maxMonth: '2025-01' });
    expect(labelsOf('year')).toEqual(['2026']);
    expect(labelsOf('month')).toEqual(['August']);
  });
});
