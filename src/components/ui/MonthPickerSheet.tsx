import { Picker } from '@react-native-picker/picker';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@contexts/ThemeContext';
import { Spacing, useAppColors } from '@theme';

import { BottomSheet } from './BottomSheet';
import { Typography } from './Typography';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const MONTH_NAMES_SHORT = MONTH_NAMES.map((name) => name.slice(0, 3));

/** How far out the year wheel reaches when the caller states no ceiling. */
const DEFAULT_YEARS_AHEAD = 10;

export interface ParsedMonth {
  year: number;
  /** 1-based, the way the `YYYY-MM` string reads — NOT `Date`'s 0-based month. */
  month: number;
}

/** `YYYY-MM` for a 1-based month. */
export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * The month we are in right now, as `YYYY-MM`, in the device's own timezone.
 *
 * Distinct from `monthKeyOf` in `CalendarHeatmap`, which narrows a `YYYY-MM-DD`
 * string to its month; this one starts from a `Date`.
 */
export function currentMonthKey(now: Date = new Date()): string {
  return monthKey(now.getFullYear(), now.getMonth() + 1);
}

/** `null` for anything that is not a real `YYYY-MM` — including `''` and a full ISO timestamp. */
export function parseMonthKey(value: string | undefined | null): ParsedMonth | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(match[1]), month };
}

/**
 * "December 2026" (or "Dec 2026") — what a member reads, rather than the
 * `YYYY-MM` the field carries. Empty string for an unparseable key, so a
 * caller can fall through to its placeholder without a null check.
 */
export function formatMonthKey(value: string, style: 'long' | 'short' = 'long'): string {
  const parsed = parseMonthKey(value);
  if (!parsed) return '';
  const names = style === 'short' ? MONTH_NAMES_SHORT : MONTH_NAMES;
  return `${names[parsed.month - 1]} ${parsed.year}`;
}

/** Whole months since year 0 — the one ordering that survives a year boundary. */
function monthIndex({ year, month }: ParsedMonth): number {
  return year * 12 + (month - 1);
}

function fromMonthIndex(index: number): ParsedMonth {
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Pulls `month` inside [`min`, `max`]. */
function clampMonth(month: ParsedMonth, min: ParsedMonth, max: ParsedMonth): ParsedMonth {
  return fromMonthIndex(
    Math.min(monthIndex(max), Math.max(monthIndex(min), monthIndex(month))),
  );
}

/**
 * Where the wheels open: the committed value, today when there isn't one, and
 * the nearest offered month when either falls outside the range.
 */
function seedMonth(value: string, min: ParsedMonth, max: ParsedMonth): ParsedMonth {
  const opening = parseMonthKey(value) ?? parseMonthKey(currentMonthKey()) ?? min;
  return clampMonth(opening, min, max);
}

export interface MonthSuggestion {
  /** Stable id — `this-month`, `this-year`, `next-year`. */
  key: string;
  /** The shorthand a member taps, e.g. "This year". */
  label: string;
  /** The `YYYY-MM` it resolves to. */
  month: string;
}

/**
 * The quick picks offered beside a month field, so the common answers cost one
 * tap and the wheels are only for the rest.
 *
 * "This year" and "next year" resolve to DECEMBER, not January — on a target
 * date they mean "by the end of", and January of next year would set a target
 * eleven months earlier than the member meant. That reading is not obvious from
 * the shorthand alone, which is why callers render the resolved month beside
 * the label rather than the label on its own.
 *
 * Deduped by resolved month: in December, "this month" and "this year" are the
 * same month, and two bubbles that do the same thing are just a wrong-looking
 * row.
 */
export function monthSuggestions(today: Date = new Date()): MonthSuggestion[] {
  const year = today.getFullYear();
  const candidates: MonthSuggestion[] = [
    { key: 'this-month', label: 'This month', month: currentMonthKey(today) },
    { key: 'this-year', label: 'This year', month: monthKey(year, 12) },
    { key: 'next-year', label: 'Next year', month: monthKey(year + 1, 12) },
  ];
  const picked: MonthSuggestion[] = [];
  for (const candidate of candidates) {
    if (picked.some((existing) => existing.month === candidate.month)) continue;
    picked.push(candidate);
  }
  return picked;
}

interface MonthPickerSheetProps {
  visible: boolean;
  /**
   * Committed `YYYY-MM`. Re-seeds the wheels every time the sheet opens; blank
   * (or out of range) opens them on the nearest offered month to today.
   */
  value: string;
  /** Fired on Done with the wheels' `YYYY-MM`; Cancel discards it. */
  onConfirm: (month: string) => void;
  onClose: () => void;
  title?: string;
  /** Earliest offered month, `YYYY-MM`. Defaults to January of the current year. */
  minMonth?: string;
  /** Latest offered month, `YYYY-MM`. Defaults to December, ten years out. */
  maxMonth?: string;
  /** Note under the wheels, e.g. "You can change this any time." */
  helperText?: string;
  testID?: string;
}

/**
 * A month and a year on two wheels, in a bottom sheet — for a field that wants
 * a month and has no business asking for a day.
 *
 * Not `DatePickerSheet` with the day ignored: a date wheel makes the member
 * pick a day that is then thrown away, and it shows one they did not choose
 * back to them. Not a `YYYY-MM` text field either, which is a format to get
 * wrong rather than a choice to make.
 *
 * Cancel / Done semantics (draft until Done) match the other wheel sheets.
 */
export function MonthPickerSheet({
  visible,
  value,
  onConfirm,
  onClose,
  title = 'Select month',
  minMonth,
  maxMonth,
  helperText,
  testID = 'month-picker-sheet',
}: MonthPickerSheetProps) {
  const colors = useAppColors();
  const { isDark } = useTheme();

  const { min, max } = useMemo(() => {
    const parsedMin = parseMonthKey(minMonth) ?? { year: new Date().getFullYear(), month: 1 };
    const parsedMax =
      parseMonthKey(maxMonth) ?? { year: parsedMin.year + DEFAULT_YEARS_AHEAD, month: 12 };
    // A caller that hands over a ceiling below its own floor would otherwise
    // produce an empty year wheel — nothing to pick, and Done would confirm a
    // month nobody chose. One month wide is the honest reading of that range.
    return monthIndex(parsedMax) < monthIndex(parsedMin)
      ? { min: parsedMin, max: parsedMin }
      : { min: parsedMin, max: parsedMax };
  }, [minMonth, maxMonth]);

  const years = useMemo(() => {
    const list: number[] = [];
    for (let year = min.year; year <= max.year; year++) list.push(year);
    return list;
  }, [min.year, max.year]);

  const [draft, setDraft] = useState<ParsedMonth>(() => seedMonth(value, min, max));

  useEffect(() => {
    if (visible) setDraft(seedMonth(value, min, max));
  }, [visible, value, min, max]);

  // The first and last year of the range are short: 2026 starting in August
  // offers August–December, and nothing else. Filtering the month wheel is what
  // keeps every combination the two wheels can show a selectable one.
  const months = useMemo(() => {
    const first = draft.year === min.year ? min.month : 1;
    const last = draft.year === max.year ? max.month : 12;
    const list: number[] = [];
    for (let month = first; month <= last; month++) list.push(month);
    return list;
  }, [draft.year, min.year, min.month, max.year, max.month]);

  const handleYearChange = (year: number) => {
    // Scrolling from a full year to a short one can strand the month wheel on a
    // row that year does not have (December 2027 → 2028, capped at March).
    setDraft((prev) => clampMonth({ year, month: prev.month }, min, max));
  };

  const handleDone = () => {
    onConfirm(monthKey(draft.year, draft.month));
    onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      height="standard"
      noPadding
      title={title}
      showCloseButton
      headerAction={{ label: 'Done', onPress: handleDone, testID: `${testID}-done` }}
    >
      <View style={[styles.body, { backgroundColor: colors.backgroundMain }]}>
        <View style={styles.wheelRow}>
          <Picker
            selectedValue={draft.month}
            onValueChange={(picked) => setDraft((prev) => ({ ...prev, month: Number(picked) }))}
            itemStyle={styles.pickerItem}
            style={styles.monthPicker}
            testID={`${testID}-month`}
          >
            {months.map((month) => (
              <Picker.Item
                key={month}
                value={month}
                label={MONTH_NAMES[month - 1]}
                color={isDark ? colors.textPrimary : undefined}
              />
            ))}
          </Picker>
          <Picker
            selectedValue={draft.year}
            onValueChange={(picked) => handleYearChange(Number(picked))}
            itemStyle={styles.pickerItem}
            style={styles.yearPicker}
            testID={`${testID}-year`}
          >
            {years.map((year) => (
              <Picker.Item
                key={year}
                value={year}
                label={String(year)}
                color={isDark ? colors.textPrimary : undefined}
              />
            ))}
          </Picker>
        </View>
        {helperText ? (
          <Typography variant="caption2" color={colors.textSecondary} style={styles.helper}>
            {helperText}
          </Typography>
        ) : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: Spacing.base,
  },
  wheelRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  monthPicker: {
    flex: 3,
  },
  yearPicker: {
    flex: 2,
  },
  pickerItem: {
    fontSize: 22,
  },
  helper: {
    textAlign: 'center',
    paddingBottom: Spacing.sm,
  },
});
