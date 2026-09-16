import React, { useMemo } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { CornerRadius, mixHex, Spacing, useAppColors, useIsDarkMode } from '@theme';
import { Chart } from '@theme/designTokens';

import { Typography } from './Typography';

/**
 * Shared GitHub-style day grid — a brand-neutral primitive for any
 * "did you do the thing, and how much" consistency view (habit streaks,
 * logging streaks, nutrition adherence, …).
 *
 * As with `ProgressRing` / `ProgressBar`, the maths is a pure, unit-testable
 * function (`heatmapGrid`) and the component only paints it. Geometry comes
 * from `Chart` / `Spacing` / `CornerRadius` tokens, colors from
 * `useAppColors()`; nothing is hardcoded and nothing is app-specific.
 *
 * ## Absent is not zero
 *
 * The single correctness property this primitive exists to protect: a day with
 * NO datum must never look like a day logged as 0. Three distinct states are
 * rendered:
 *
 * | State                       | `level` | `inRange` | Paint                    |
 * |-----------------------------|---------|-----------|--------------------------|
 * | outside the window          | `-1`    | `false`   | nothing (bare surface)   |
 * | in the window, nothing logged | `-1`  | `true`    | hairline outline, no fill|
 * | logged as 0                 | `0`     | `true`    | solid neutral fill       |
 * | logged above 0              | `1..4`  | `true`    | one of four ramp steps   |
 *
 * A missing day is therefore an empty outline, a zero is a filled chip, and the
 * two can never be confused. `values` is a sparse list: only days you pass are
 * "logged", so `{ date, value: 0 }` is a deliberate zero.
 *
 * ## Discrete buckets, honest legend
 *
 * Intensity is bucketed into FOUR discrete steps, never a continuous gradient,
 * so the rendered legend describes exactly what the grid can show. The ramp is
 * one hue in monotone lightness steps (a sequential scale), with its own
 * selected steps per mode — see `LEVEL_RAMP_LIGHT` / `LEVEL_RAMP_DARK`.
 *
 * Weeks start on MONDAY, matching the backend's `weekStartOf`.
 */

/* ------------------------------------------------------------------ */
/* Pure grid                                                           */
/* ------------------------------------------------------------------ */

export interface HeatmapValue {
  /** `YYYY-MM-DD` (local) day key. */
  date: string;
  /** Magnitude for that day. Negatives are floored to 0. */
  value: number;
}

/** `-1` = nothing logged · `0` = logged zero · `1..4` = intensity bucket. */
export type HeatmapLevel = -1 | 0 | 1 | 2 | 3 | 4;

export interface HeatmapCell {
  /** `YYYY-MM-DD` for this square — set even for out-of-window padding. */
  date: string;
  /** Summed value for the day, or `null` when nothing was logged. */
  value: number | null;
  /** `value / max` clamped to [0, 1], or `null` when nothing was logged. */
  intensity: number | null;
  level: HeatmapLevel;
  /** False for padding days after `endDate` in the trailing week. */
  inRange: boolean;
}

export interface HeatmapGrid {
  /** Week columns, oldest first; each holds 7 cells, row 0 = Monday. */
  columns: HeatmapCell[][];
  /** Monday that opens the grid. */
  start: string;
  /** Last day in range (the `endDate` asked for). */
  end: string;
  /** Week columns actually built. */
  weeks: number;
  /** Denominator used for `intensity` (0 when nothing positive was logged). */
  max: number;
  /** Days from `start` to `end` inclusive. */
  daysInRange: number;
  /** In-range days that carry a datum (including explicit zeros). */
  loggedDays: number;
  /** In-range days logged as exactly 0. */
  zeroDays: number;
  /** Sum of every in-range value. */
  total: number;
  /** Highest in-range day; ties resolve to the earliest date. */
  peak: { date: string; value: number } | null;
}

/** Number of discrete positive buckets. Four steps, never a gradient. */
export const HEATMAP_LEVELS = 4;

const DEFAULT_WEEKS = 12;
const MAX_WEEKS = 53;
const DAY_MS = 86_400_000;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Parse a `YYYY-MM-DD` key to UTC ms, or `null` when it is not a real date. */
function parseDateKey(key: string): number | null {
  if (typeof key !== 'string' || !DATE_KEY.test(key)) return null;
  const [y, m, d] = key.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  // Rejects overflow dates like 2026-02-30, which Date.UTC would roll forward.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return ms;
}

function toDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function localDateKey(now = new Date()): string {
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Monday that opens the week containing `ms`. */
function mondayMsOf(ms: number): number {
  const dow = new Date(ms).getUTCDay(); // 0 = Sunday
  const delta = dow === 0 ? -6 : 1 - dow;
  return ms + delta * DAY_MS;
}

/**
 * Monday that opens the week containing `date` — the same rule the backend's
 * `weekStartOf` applies, so a grid column always covers the same span the
 * server aggregates. Invalid keys come back unchanged.
 */
export function heatmapWeekStart(date: string): string {
  const ms = parseDateKey(date);
  if (ms == null) return date;
  return toDateKey(mondayMsOf(ms));
}

/** UTC ms for `endDate`, falling back to the local today when unparseable. */
function resolveEndMs(endDate: string): number {
  const parsed = parseDateKey(endDate);
  if (parsed != null) return parsed;
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

function clampWeeks(weeks: number): number {
  if (!Number.isFinite(weeks)) return DEFAULT_WEEKS;
  return Math.max(1, Math.min(MAX_WEEKS, Math.round(weeks)));
}

/**
 * Bucket a normalised intensity into one of `HEATMAP_LEVELS` discrete steps.
 * Any value above zero reaches at least bucket 1, so a single small log is
 * never rendered as "nothing happened".
 */
export function heatmapLevelFor(intensity: number): HeatmapLevel {
  if (intensity <= 0) return 0;
  const bucket = Math.ceil(Math.min(1, intensity) * HEATMAP_LEVELS);
  return Math.max(1, Math.min(HEATMAP_LEVELS, bucket)) as HeatmapLevel;
}

/**
 * Build the week × weekday grid.
 *
 * - Columns are weeks (oldest first), rows are Monday..Sunday.
 * - The window ends on `endDate` and covers `weeks` Monday-started weeks; days
 *   after `endDate` in the trailing column are padding (`inRange: false`).
 * - Values outside the window, or with unparseable dates, are ignored.
 * - Repeated dates are SUMMED, so a raw event list (one `{ date, value: 1 }`
 *   per tick) works as directly as pre-aggregated daily totals.
 * - `max` overrides the denominator (to hold the scale steady across a filter
 *   change); a non-positive or non-finite override falls back to the observed
 *   maximum.
 */
export function heatmapGrid(
  values: readonly HeatmapValue[] | null | undefined,
  weeks: number = DEFAULT_WEEKS,
  endDate: string = localDateKey(),
  max?: number
): HeatmapGrid {
  const weekCount = clampWeeks(weeks);
  const endMs = resolveEndMs(endDate);
  const end = toDateKey(endMs);
  const startMs = mondayMsOf(endMs) - (weekCount - 1) * 7 * DAY_MS;
  const start = toDateKey(startMs);
  const daysInRange = Math.round((endMs - startMs) / DAY_MS) + 1;

  // Daily totals for in-window dates only.
  const totals = new Map<string, number>();
  for (const entry of values ?? []) {
    const ms = parseDateKey(entry?.date);
    if (ms == null || ms < startMs || ms > endMs) continue;
    const amount = Number.isFinite(entry.value) ? Math.max(0, entry.value) : 0;
    totals.set(entry.date, (totals.get(entry.date) ?? 0) + amount);
  }

  const observedMax = totals.size ? Math.max(0, ...totals.values()) : 0;
  const resolvedMax =
    max != null && Number.isFinite(max) && max > 0 ? max : observedMax;
  // Guard the division only; `resolvedMax` is still reported as observed.
  const denominator = resolvedMax > 0 ? resolvedMax : 1;

  const columns: HeatmapCell[][] = [];
  let loggedDays = 0;
  let zeroDays = 0;
  let total = 0;
  let peak: { date: string; value: number } | null = null;

  for (let week = 0; week < weekCount; week += 1) {
    const column: HeatmapCell[] = [];
    for (let row = 0; row < 7; row += 1) {
      const ms = startMs + (week * 7 + row) * DAY_MS;
      const date = toDateKey(ms);
      const inRange = ms <= endMs;
      const logged = inRange ? totals.get(date) : undefined;
      if (logged === undefined) {
        column.push({ date, value: null, intensity: null, level: -1, inRange });
        continue;
      }
      const intensity = Math.max(0, Math.min(1, logged / denominator));
      const level = heatmapLevelFor(intensity);
      loggedDays += 1;
      total += logged;
      if (logged === 0) zeroDays += 1;
      if (logged > 0 && (peak === null || logged > peak.value)) peak = { date, value: logged };
      column.push({ date, value: logged, intensity, level, inRange });
    }
    columns.push(column);
  }

  return {
    columns,
    start,
    end,
    weeks: weekCount,
    max: resolvedMax,
    daysInRange,
    loggedDays,
    zeroDays,
    total,
    peak,
  };
}

/* ------------------------------------------------------------------ */
/* Pure month grid                                                     */
/* ------------------------------------------------------------------ */

/**
 * A single square in a CALENDAR-MONTH layout (`heatmapMonthGrid`).
 *
 * The week-column grid above answers "how consistent have I been"; a month grid
 * answers "what happened on the 14th". Both are day grids over the same Monday
 * -first week rule, which is why the arithmetic lives together — a second copy
 * of "which Monday opens this week" is exactly the drift this module exists to
 * prevent.
 */
export interface MonthGridCell {
  /** `YYYY-MM-DD` for this square — set even for leading/trailing padding. */
  date: string;
  /** Day of month, 1–31. */
  day: number;
  /** False for the padding days borrowed from the neighbouring months. */
  inMonth: boolean;
}

export interface MonthGrid {
  /** The month asked for, `YYYY-MM`. */
  month: string;
  /** Week rows, earliest first; each holds 7 cells, index 0 = Monday. */
  rows: MonthGridCell[][];
  /** First day of the month, `YYYY-MM-DD`. */
  first: string;
  /** Last day of the month, `YYYY-MM-DD`. */
  last: string;
  /** Days in the month itself (28–31), excluding padding. */
  daysInMonth: number;
}

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `YYYY-MM` for the month containing `date`, or the local month as a fallback. */
export function monthKeyOf(date?: string): string {
  if (typeof date === 'string' && DATE_KEY.test(date)) return date.slice(0, 7);
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}`;
}

/** Step a `YYYY-MM` key by whole months, wrapping the year. */
export function shiftMonthKey(month: string, delta: number): string {
  if (!MONTH_KEY.test(month)) return monthKeyOf();
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + Math.trunc(delta);
  const year = Math.floor(total / 12);
  const index = ((total % 12) + 12) % 12;
  return `${year}-${`${index + 1}`.padStart(2, '0')}`;
}

/**
 * Build a calendar-month grid: rows are weeks, columns are Monday..Sunday.
 *
 * Leading and trailing squares come from the neighbouring months and are marked
 * `inMonth: false` so a caller can render them faintly or not at all — they are
 * never blank placeholders, because a real date is still the honest label for
 * that square and a caller that colours by date needs it.
 *
 * An unparseable month key falls back to the local month rather than throwing;
 * a calendar that renders the wrong month is recoverable, one that crashes the
 * screen is not.
 */
export function heatmapMonthGrid(month: string): MonthGrid {
  const key = MONTH_KEY.test(month) ? month : monthKeyOf();
  const [year, monthNumber] = key.split('-').map(Number);
  const firstMs = Date.UTC(year, monthNumber - 1, 1);
  // Day 0 of the NEXT month is the last day of this one — no leap-year table.
  const lastMs = Date.UTC(year, monthNumber, 0);
  const daysInMonth = Math.round((lastMs - firstMs) / DAY_MS) + 1;

  const startMs = mondayMsOf(firstMs);
  // Pad forward to complete the week that holds the last day.
  const endMs = mondayMsOf(lastMs) + 6 * DAY_MS;
  const weeks = Math.round((endMs - startMs) / DAY_MS + 1) / 7;

  const rows: MonthGridCell[][] = [];
  for (let week = 0; week < weeks; week += 1) {
    const row: MonthGridCell[] = [];
    for (let column = 0; column < 7; column += 1) {
      const ms = startMs + (week * 7 + column) * DAY_MS;
      const date = toDateKey(ms);
      row.push({ date, day: new Date(ms).getUTCDate(), inMonth: ms >= firstMs && ms <= lastMs });
    }
    rows.push(row);
  }

  return { month: key, rows, first: toDateKey(firstMs), last: toDateKey(lastMs), daysInMonth };
}

/* ------------------------------------------------------------------ */
/* Accessibility                                                       */
/* ------------------------------------------------------------------ */

/**
 * Spoken description of the grid. A screen reader cannot see a grid of tinted
 * squares, so the label states the coverage, the absent/zero split and the
 * busiest day in words.
 */
export function heatmapDescription(grid: HeatmapGrid, emptyLabel?: string): string {
  const head = `${grid.weeks}-week activity grid ending ${grid.end}.`;
  if (grid.loggedDays === 0) {
    return `${head} ${emptyLabel ?? 'Nothing logged yet.'}`;
  }
  const parts = [
    head,
    `${grid.loggedDays} of ${grid.daysInRange} days logged, ${
      grid.daysInRange - grid.loggedDays
    } with no data.`,
  ];
  if (grid.zeroDays > 0) {
    parts.push(`${grid.zeroDays} logged as zero.`);
  }
  if (grid.peak) {
    parts.push(`Highest ${grid.peak.value} on ${grid.peak.date}.`);
  }
  return parts.join(' ');
}

/* ------------------------------------------------------------------ */
/* Color — sequential ramp                                             */
/* ------------------------------------------------------------------ */

/**
 * Mix fractions toward the ink color, lightest bucket first. Validated with the
 * data-viz palette validator in ordinal mode on the light surfaces (#F7FAFA and
 * #FFFFFF) with the House primary: monotone L PASS · adjacent ΔL PASS ·
 * light-end contrast 2.27:1 / 2.38:1 PASS · single hue PASS.
 */
const LEVEL_RAMP_LIGHT = [0.1, 0.24, 0.38, 0.52] as const;

/**
 * Dark mode is selected, not flipped: its own steps, mixed toward the dark
 * surface so the ramp has room to separate. Validated on #202632: monotone L
 * PASS · adjacent ΔL PASS · light-end contrast 2.31:1 PASS · single hue PASS.
 */
const LEVEL_RAMP_DARK = [0.62, 0.41, 0.2, 0] as const;

/** The four bucket fills, softest (level 1) first. */
export function heatmapLevelColors(
  base: string,
  ink: string,
  surface: string,
  isDark: boolean
): string[] {
  const ladder = isDark ? LEVEL_RAMP_DARK : LEVEL_RAMP_LIGHT;
  const target = isDark ? surface : ink;
  return ladder.map((t) => mixHex(base, target, t));
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export interface CalendarHeatmapLegendLabels {
  /** Caption for the "no data" outline swatch. */
  none: string;
  /** Caption at the low end of the bucket scale. */
  less: string;
  /** Caption at the high end of the bucket scale. */
  more: string;
}

const DEFAULT_LEGEND_LABELS: CalendarHeatmapLegendLabels = {
  none: 'No data',
  less: 'Less',
  more: 'More',
};

/** Monday-first initials; override for a localised grid. */
const DEFAULT_WEEKDAY_LABELS = ['M', '', 'W', '', 'F', '', ''];

interface CalendarHeatmapProps {
  /** Sparse daily values. Repeated dates are summed. */
  values: HeatmapValue[];
  /** Week columns to draw (default 12). Clamped to 1–53. */
  weeks?: number;
  /** Last day in the window, `YYYY-MM-DD`. Defaults to the local today. */
  endDate?: string;
  /** Fixed denominator for the buckets. Falls back to the observed maximum. */
  max?: number;
  /** Ramp base hue. Defaults to the brand primary. */
  color?: string;
  /** Shown and announced when nothing at all is logged in the window. */
  emptyLabel?: string;
  /** Square edge in points (default 14). */
  cellSize?: number;
  /** Gap between squares (default 2pt — the data-viz surface gap). */
  gap?: number;
  /** Row initials down the left edge (default true). */
  showWeekdayLabels?: boolean;
  /** Row initials, Monday first. Blank entries render no label. */
  weekdayLabels?: string[];
  /** Discrete bucket legend under the grid (default true). */
  showLegend?: boolean;
  legendLabels?: CalendarHeatmapLegendLabels;
  testID?: string;
}

export function CalendarHeatmap({
  values,
  weeks = DEFAULT_WEEKS,
  endDate,
  max,
  color,
  emptyLabel,
  cellSize = Chart.barMinWidth,
  gap = Spacing.xxs,
  showWeekdayLabels = true,
  weekdayLabels = DEFAULT_WEEKDAY_LABELS,
  showLegend = true,
  legendLabels = DEFAULT_LEGEND_LABELS,
  testID,
}: CalendarHeatmapProps) {
  const colors = useAppColors();
  const isDark = useIsDarkMode();

  const grid = useMemo(
    () => heatmapGrid(values, weeks, endDate, max),
    [values, weeks, endDate, max]
  );
  const levelColors = useMemo(
    () => heatmapLevelColors(color ?? colors.primary, colors.textPrimary, colors.card, isDark),
    [color, colors.primary, colors.textPrimary, colors.card, isDark]
  );

  const radius = Math.max(1, Math.min(CornerRadius.xs, Math.round(cellSize / 4)));
  const cellBase: ViewStyle = { width: cellSize, height: cellSize, borderRadius: radius };
  // Gaps are props, so the spacing styles are built once here rather than as
  // object literals inside the map bodies.
  const rowGap: ViewStyle = { marginBottom: gap };
  const columnGap: ViewStyle = { marginRight: gap };
  const railGap: ViewStyle = { marginRight: gap * 2 };
  const railCell: ViewStyle = { height: cellSize };
  const outlineStyle: ViewStyle = {
    backgroundColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
  };

  /** Paint for one cell — the absent/zero/value distinction lives here. */
  const fillFor = (cell: HeatmapCell): ViewStyle => {
    if (cell.level === -1) {
      // In-window but unlogged gets an outline; outside the window gets nothing,
      // so "no data" can never be mistaken for a logged zero.
      return cell.inRange ? outlineStyle : { backgroundColor: 'transparent' };
    }
    return { backgroundColor: cell.level === 0 ? colors.chartNeutral : levelColors[cell.level - 1] };
  };

  const swatch = (style: ViewStyle, key: string) => (
    <View key={key} style={[cellBase, styles.legendSwatch, style]} />
  );

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={heatmapDescription(grid, emptyLabel)}
    >
      <View style={styles.gridRow}>
        {showWeekdayLabels ? (
          <View style={[styles.weekdayColumn, railGap]}>
            {weekdayLabels.slice(0, 7).map((label, row) => (
              <View
                key={`weekday-${row}`}
                style={[styles.weekdayCell, railCell, row === 6 ? undefined : rowGap]}
              >
                {label ? (
                  <Typography variant="micro" color={colors.textSecondary}>
                    {label}
                  </Typography>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
        {grid.columns.map((column, index) => (
          <View
            key={column[0].date}
            style={index === grid.columns.length - 1 ? undefined : columnGap}
          >
            {column.map((cell, row) => (
              <View
                key={cell.date}
                testID={testID ? `${testID}-cell-${cell.date}` : undefined}
                style={[cellBase, row === 6 ? undefined : rowGap, fillFor(cell)]}
              />
            ))}
          </View>
        ))}
      </View>

      {grid.loggedDays === 0 && emptyLabel ? (
        <Typography
          variant="caption"
          color={colors.textSecondary}
          style={styles.emptyLabel}
          testID={testID ? `${testID}-empty` : undefined}
        >
          {emptyLabel}
        </Typography>
      ) : null}

      {showLegend ? (
        <View style={styles.legendRow} testID={testID ? `${testID}-legend` : undefined}>
          {swatch(
            {
              backgroundColor: 'transparent',
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: colors.divider,
            },
            'legend-none'
          )}
          <Typography variant="micro" color={colors.textSecondary} style={styles.legendLabel}>
            {legendLabels.none}
          </Typography>
          <Typography variant="micro" color={colors.textSecondary} style={styles.legendSpacer}>
            {legendLabels.less}
          </Typography>
          {swatch({ backgroundColor: colors.chartNeutral }, 'legend-0')}
          {levelColors.map((fill, index) => swatch({ backgroundColor: fill }, `legend-${index + 1}`))}
          <Typography variant="micro" color={colors.textSecondary} style={styles.legendLabel}>
            {legendLabels.more}
          </Typography>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gridRow: {
    flexDirection: 'row',
  },
  weekdayColumn: {
    justifyContent: 'flex-start',
  },
  weekdayCell: {
    justifyContent: 'center',
  },
  emptyLabel: {
    marginTop: Spacing.sm,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  legendSwatch: {
    marginRight: Spacing.xxs,
  },
  legendLabel: {
    marginRight: Spacing.sm,
  },
  legendSpacer: {
    marginRight: Spacing.xxs,
  },
});
