import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Typography } from '@components/ui';
import { heatmapMonthGrid, shiftMonthKey } from '@components/ui/CalendarHeatmap';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, hexToRgba, Spacing, useAppColors } from '@theme';

import {
  countCycleMarks,
  cycleCalendarDays,
  CYCLE_DAY_MARK_LABELS,
  FLOW_LABELS,
  type CycleCalendarDay,
  type CycleDayMark,
  type CycleSettings,
  type CycleSymptomEntry,
  type PeriodEntry,
} from '../healthCycleStorage';

/**
 * The donor's `cycleCalendarCard` — a month grid of period / fertile /
 * ovulation days with a legend.
 *
 * ## It reuses the shared day-grid primitive
 *
 * The week rule and the month arithmetic come from `heatmapMonthGrid` in
 * `@components/ui/CalendarHeatmap` — the same primitive the Trends and Activity
 * consistency grids are built on. This file supplies only the cycle SEMANTICS
 * (which day means what) and the paint; it owns no calendar maths of its own,
 * so a second Monday-first week rule can never drift into the codebase.
 *
 * ## A record and a guess must not look the same
 *
 * The donor paints every day the same pink circle, because its `isPeriodDay(_:)`
 * is pure arithmetic off the anchor date — a day the person logged and a day the
 * app merely expects are indistinguishable. On a cycle calendar that is the
 * difference between "my period started on the 8th" and "an app guessed the
 * 8th", and people read the picture, not the caveat.
 *
 * So the encoding here is **two hues and two forms**, not four hues:
 *
 * | Day                    | Hue     | Form              |
 * |------------------------|---------|-------------------|
 * | Period, logged         | primary | solid fill        |
 * | Period, expected       | primary | outline only      |
 * | Fertile window (est.)  | info    | soft fill         |
 * | Ovulation (est.)       | info    | soft fill + ring  |
 *
 * Ovulation is a RING on the fertile fill rather than a third hue because
 * ovulation sits *inside* the fertile window — it is not an independent
 * category, and giving it its own hue would say it was. The two hues were
 * validated as a categorical pair (worst adjacent CVD ΔE 23.3 protan / 31.9
 * normal, contrast ≥ 3:1) on the light, dark and clean surfaces.
 *
 * Colour is never load-bearing: every state is also in the legend, in the day's
 * accessibility label, and separated by form.
 *
 * These are calendar estimates from the person's own logged dates. They are not
 * contraception, not a fertility test, and the card says so under the legend.
 */

/** Monday-first, matching the shared grid primitive's week rule. */
const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

const CELL_HEIGHT = 40;
const MARK_SIZE = 32;

export interface HealthCycleCalendarProps {
  /** Month to render, `YYYY-MM`. */
  month: string;
  onMonthChange: (month: string) => void;
  /** Currently focused day, `YYYY-MM-DD`. */
  selectedDate: string;
  onSelectDate: (date: string) => void;
  /** Today's key, so the "today" ring is testable without faking the clock. */
  todayKey: string;
  settings: CycleSettings;
  periods: readonly PeriodEntry[];
  symptoms: readonly CycleSymptomEntry[];
  testID?: string;
}

export function HealthCycleCalendar({
  month,
  onMonthChange,
  selectedDate,
  onSelectDate,
  todayKey,
  settings,
  periods,
  symptoms,
  testID = 'health-cycle-calendar',
}: HealthCycleCalendarProps) {
  const colors = useAppColors();

  const grid = useMemo(() => heatmapMonthGrid(month), [month]);
  const days = useMemo(
    () => cycleCalendarDays(grid.rows, settings, periods, symptoms),
    [grid.rows, settings, periods, symptoms]
  );
  const counts = useMemo(() => countCycleMarks(days), [days]);

  const monthLabel = useMemo(() => monthTitle(grid.month), [grid.month]);
  const showingCurrentMonth = grid.month === todayKey.slice(0, 7);

  /** Soft fill for the fertile/ovulation estimate — readable in both modes. */
  const estimateFill = hexToRgba(colors.info, 0.18);

  const markStyles: Record<CycleDayMark, { fill: string; border: string; ink: string }> = {
    period: { fill: colors.primary, border: 'transparent', ink: colors.white },
    predictedPeriod: { fill: 'transparent', border: colors.primary, ink: colors.primary },
    ovulation: { fill: estimateFill, border: colors.info, ink: colors.info },
    fertile: { fill: estimateFill, border: 'transparent', ink: colors.textPrimary },
  };

  const renderDay = (cell: CycleCalendarDay) => {
    const isToday = cell.date === todayKey;
    const isSelected = cell.date === selectedDate;
    const paint = cell.mark ? markStyles[cell.mark] : null;

    // A padding day belongs to a neighbouring month: it stays visible so the
    // week reads as a week, but it carries no marks and cannot be selected.
    const ink = cell.inMonth ? (paint?.ink ?? colors.textPrimary) : colors.textTertiary;

    return (
      <Pressable
        key={cell.date}
        onPress={() => onSelectDate(cell.date)}
        disabled={!cell.inMonth}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected, disabled: !cell.inMonth }}
        accessibilityLabel={dayDescription(cell, isToday, isSelected)}
        testID={`${testID}-day-${cell.date}`}
        style={[
          styles.dayCell,
          isSelected && cell.inMonth
            ? {
                borderColor: colors.textPrimary,
                borderWidth: 2,
                backgroundColor: colors.surfaceSelected,
              }
            : isToday
              ? { borderColor: colors.textPrimary, borderWidth: StyleSheet.hairlineWidth }
              : undefined,
        ]}
      >
        <View
          style={[
            styles.dayMark,
            paint && cell.inMonth
              ? {
                  backgroundColor: paint.fill,
                  borderColor: paint.border,
                  borderWidth: paint.border === 'transparent' ? 0 : 1.5,
                }
              : undefined,
          ]}
        >
          <Typography
            variant="footnote"
            weight={isToday || isSelected ? 'bold' : 'regular'}
            color={ink}
          >
            {cell.day}
          </Typography>
        </View>
        {/* A logged symptom/mood/sleep entry — a mark of its own so the person
            can find the days they wrote something on. */}
        <View
          style={[
            styles.symptomDot,
            {
              backgroundColor:
                cell.hasSymptomLog && cell.inMonth ? colors.textSecondary : 'transparent',
            },
          ]}
        />
      </Pressable>
    );
  };

  return (
    <View testID={testID}>
      <View style={styles.header}>
        <Pressable
          onPress={() => onMonthChange(shiftMonthKey(grid.month, -1))}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          testID={`${testID}-prev`}
          hitSlop={10}
        >
          <Icon name="chevron-back" size={20} color={colors.primary} />
        </Pressable>

        <Pressable
          onPress={() => onMonthChange(todayKey.slice(0, 7))}
          disabled={showingCurrentMonth}
          accessibilityRole="button"
          accessibilityLabel={
            showingCurrentMonth ? monthLabel : `${monthLabel}. Tap to return to this month`
          }
          testID={`${testID}-title`}
        >
          <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
            {monthLabel}
          </Typography>
        </Pressable>

        <Pressable
          onPress={() => onMonthChange(shiftMonthKey(grid.month, 1))}
          accessibilityRole="button"
          accessibilityLabel="Next month"
          testID={`${testID}-next`}
          hitSlop={10}
        >
          <Icon name="chevron-forward" size={20} color={colors.primary} />
        </Pressable>
      </View>

      <View style={styles.weekdayRow}>
        {WEEKDAY_INITIALS.map((initial, index) => (
          <View key={`weekday-${index}`} style={styles.weekdayCell}>
            <Typography variant="caption1" color={colors.textSecondary}>
              {initial}
            </Typography>
          </View>
        ))}
      </View>

      {days.map((row) => (
        <View key={row[0].date} style={styles.weekRow}>
          {row.map(renderDay)}
        </View>
      ))}

      {/* Legend — five states, each named. */}
      <View style={styles.legend} testID={`${testID}-legend`}>
        <LegendSwatch
          label={CYCLE_DAY_MARK_LABELS.period}
          style={{ backgroundColor: colors.primary }}
        />
        <LegendSwatch
          label={CYCLE_DAY_MARK_LABELS.predictedPeriod}
          style={{ borderColor: colors.primary, borderWidth: 1.5 }}
        />
        <LegendSwatch
          label={CYCLE_DAY_MARK_LABELS.fertile}
          style={{ backgroundColor: estimateFill }}
        />
        <LegendSwatch
          label={CYCLE_DAY_MARK_LABELS.ovulation}
          style={{ backgroundColor: estimateFill, borderColor: colors.info, borderWidth: 1.5 }}
        />
        <LegendSwatch
          label="Symptoms logged"
          style={{ backgroundColor: colors.textSecondary }}
          small
        />
      </View>

      <Typography
        variant="caption1"
        color={colors.textSecondary}
        testID={`${testID}-summary`}
        style={styles.summary}
      >
        {summarySentence(counts, monthLabel)}
      </Typography>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function LegendSwatch({
  label,
  style,
  small = false,
}: {
  label: string;
  style: object;
  small?: boolean;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.legendItem}>
      <View style={[small ? styles.legendDot : styles.legendSwatch, style]} />
      <Typography variant="caption1" color={colors.textSecondary}>
        {label}
      </Typography>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Copy                                                                */
/* ------------------------------------------------------------------ */

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
] as const;

/** "March 2026" from a `YYYY-MM` key, without pulling in a date library. */
export function monthTitle(month: string): string {
  const [year, index] = month.split('-').map(Number);
  return `${MONTH_NAMES[(index ?? 1) - 1] ?? month} ${year}`;
}

/**
 * A sentence under the grid stating what the month actually holds, and marking
 * the estimates AS estimates. An empty month says so in words rather than
 * leaving a bare grid to be read as "nothing happened".
 */
export function summarySentence(
  counts: Record<CycleDayMark, number>,
  monthLabel: string
): string {
  const parts: string[] = [];
  if (counts.period > 0) {
    parts.push(`${counts.period} period ${counts.period === 1 ? 'day' : 'days'} logged`);
  }
  const estimated = counts.predictedPeriod + counts.fertile + counts.ovulation;
  if (estimated > 0) {
    parts.push(`${estimated} estimated ${estimated === 1 ? 'day' : 'days'}`);
  }
  if (parts.length === 0) {
    return `Nothing logged in ${monthLabel}, and no estimates yet — log a period day to start the calendar.`;
  }
  return `${monthLabel}: ${parts.join(' · ')}. Fertile and ovulation days are estimates from the dates you logged, not a fertility test.`;
}

/** Everything a sighted reader gets from the cell's colour and form, in words. */
export function dayDescription(
  cell: CycleCalendarDay,
  isToday: boolean,
  isSelected: boolean
): string {
  if (!cell.inMonth) return `${cell.day}, outside this month`;
  const parts: string[] = [`${cell.day}`];
  if (isToday) parts.push('today');
  if (cell.mark === 'period') {
    parts.push(cell.flow ? `period logged, ${FLOW_LABELS[cell.flow].toLowerCase()} flow` : 'period logged');
  } else if (cell.mark) {
    parts.push(CYCLE_DAY_MARK_LABELS[cell.mark].toLowerCase());
  }
  if (cell.hasSymptomLog) parts.push('symptoms logged');
  if (isSelected) parts.push('selected');
  return parts.join(', ');
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: Spacing.sm,
  },
  weekdayRow: {
    flexDirection: 'row',
  },
  weekdayCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.xxs,
  },
  weekRow: {
    flexDirection: 'row',
  },
  dayCell: {
    flex: 1,
    height: CELL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: CornerRadius.sm,
    borderWidth: 0,
    borderColor: 'transparent',
  },
  dayMark: {
    width: MARK_SIZE,
    height: MARK_SIZE,
    borderRadius: MARK_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  symptomDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 1,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  legendSwatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginHorizontal: 3,
  },
  summary: {
    marginTop: Spacing.xs,
  },
});
