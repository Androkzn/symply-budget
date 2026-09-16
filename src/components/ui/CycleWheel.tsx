import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { mixHex, Spacing, useAppColors, useIsDarkMode } from '@theme';

import { Typography } from './Typography';

/**
 * Shared circular cycle visualisation — a brand-neutral primitive that draws a
 * whole cycle as a ring of phase arcs with a marker on the current day.
 *
 * Shape of the work follows `ProgressRing`: all of the maths lives in pure,
 * unit-testable functions (`cycleWheelGeometry`, `cycleWheelPhaseForDay`,
 * `cycleDayPoint`, `cycleWheelDescription`) and the component is a thin SVG
 * wrapper. Geometry comes from `Spacing` tokens, colors from `useAppColors()`;
 * nothing is hardcoded and nothing is app-specific.
 *
 * ## Phase boundaries are derived, never re-stated
 *
 * `cycleWheelPhaseForDay` is a literal mirror of the storage-layer rule
 * (period → follicular → a 3-day ovulation window centred on `cycleLength − 14`
 * → luteal), and the arcs are built by *walking days 1..cycleLength through
 * that one function* and coalescing runs. There is no second copy of the
 * boundary arithmetic that could drift, so the wheel can never disagree with
 * the phase label a screen prints beneath it. A test cross-checks every day of
 * every valid (cycleLength, periodLength) pair against the storage helper.
 *
 * Because the rule is evaluated per day, degenerate configurations fall out
 * correctly instead of drawing nonsense: a long period swallows the ovulation
 * window at short cycle lengths, and the follicular phase can be empty. Phases
 * with no days simply produce no arc.
 *
 * ## Color
 *
 * The four phases are consecutive stages of one cycle — re-ordering them would
 * change the meaning — so they are an ORDINAL scale, not a categorical one:
 * a single hue in monotone lightness steps, strongest at the period and fading
 * through to luteal. The ladders below were checked with the data-viz palette
 * validator in ordinal mode against both surfaces (see `PHASE_RAMP_*`).
 */

/* ------------------------------------------------------------------ */
/* Domain                                                              */
/* ------------------------------------------------------------------ */

export const CYCLE_WHEEL_PHASES = ['menstrual', 'follicular', 'ovulation', 'luteal'] as const;
export type CycleWheelPhase = (typeof CYCLE_WHEEL_PHASES)[number];

/** Screen-reader wording for each phase. */
export const CYCLE_WHEEL_PHASE_LABELS: Record<CycleWheelPhase, string> = {
  menstrual: 'Period',
  follicular: 'Follicular',
  ovulation: 'Ovulation',
  luteal: 'Luteal',
};

/**
 * Accepted input bounds. These mirror the storage-layer clamps exactly — the
 * wheel must reject the same inputs the phase rule rejects, otherwise a value
 * the store would have clamped could be drawn un-clamped.
 */
export const CYCLE_WHEEL_LIMITS = {
  minCycleLength: 20,
  maxCycleLength: 45,
  defaultCycleLength: 28,
  minPeriodLength: 1,
  maxPeriodLength: 14,
  defaultPeriodLength: 5,
} as const;

/** Days between ovulation and the next period — fixes the ovulation window. */
const LUTEAL_SPAN = 14;

export function clampWheelCycleLength(value: number): number {
  if (!Number.isFinite(value)) return CYCLE_WHEEL_LIMITS.defaultCycleLength;
  return Math.max(
    CYCLE_WHEEL_LIMITS.minCycleLength,
    Math.min(CYCLE_WHEEL_LIMITS.maxCycleLength, Math.round(value))
  );
}

export function clampWheelPeriodLength(value: number): number {
  if (!Number.isFinite(value)) return CYCLE_WHEEL_LIMITS.defaultPeriodLength;
  return Math.max(
    CYCLE_WHEEL_LIMITS.minPeriodLength,
    Math.min(CYCLE_WHEEL_LIMITS.maxPeriodLength, Math.round(value))
  );
}

/**
 * Phase for a 1-based cycle day.
 *
 * Mirror of `phaseForCycleDay` in the health cycle store — same order of tests,
 * same boundaries. The period is checked FIRST, so a period long enough to
 * reach the ovulation window keeps those days as bleeding days rather than
 * claiming a fertile window that the text label would deny.
 */
export function cycleWheelPhaseForDay(
  day: number,
  cycleLength: number,
  periodLength: number
): CycleWheelPhase {
  const length = clampWheelCycleLength(cycleLength);
  const period = clampWheelPeriodLength(periodLength);
  if (day <= period) return 'menstrual';
  const ovulationDay = length - LUTEAL_SPAN;
  if (day >= ovulationDay - 1 && day <= ovulationDay + 1) return 'ovulation';
  if (day < ovulationDay - 1) return 'follicular';
  return 'luteal';
}

/* ------------------------------------------------------------------ */
/* Pure geometry                                                       */
/* ------------------------------------------------------------------ */

export interface CycleWheelArc {
  phase: CycleWheelPhase;
  /** First cycle day (1-based, inclusive). */
  startDay: number;
  /** Last cycle day (1-based, inclusive). */
  endDay: number;
  /** Number of days the phase covers. */
  days: number;
  /** Degrees clockwise from 12 o'clock, including the leading half-gap. */
  startAngle: number;
  /** Degrees swept, with the surface gap already subtracted. Never negative. */
  sweepAngle: number;
  /** SVG arc path, or `''` when the gap consumed the whole sweep. */
  path: string;
}

export interface CycleWheelGeometry {
  size: number;
  stroke: number;
  /** Ring radius (stroke-inset from the box); never negative. */
  radius: number;
  /** Center coordinate (size / 2). */
  center: number;
  /** Clamped cycle length actually drawn. */
  cycleLength: number;
  /** Clamped period length actually drawn. */
  periodLength: number;
  /** Angular width of one day. */
  degreesPerDay: number;
  /** Non-empty phase arcs, in cycle order. */
  arcs: CycleWheelArc[];
  /** Every phase; `null` when this configuration gives the phase no days. */
  byPhase: Record<CycleWheelPhase, CycleWheelArc | null>;
}

/** 2pt of surface between touching arcs — the data-viz "surface gap" spec. */
const ARC_GAP = Spacing.xxs;

const DEG_PER_RAD = 180 / Math.PI;

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Polar → cartesian with 0° at 12 o'clock and angles increasing clockwise. */
function polarPoint(center: number, radius: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: center + radius * Math.cos(rad), y: center + radius * Math.sin(rad) };
}

/**
 * Pure wheel geometry.
 *
 * Walks every day through `cycleWheelPhaseForDay` and coalesces contiguous runs
 * into arcs, so the drawing and the phase rule cannot diverge. Each arc is
 * inset by half the 2pt surface gap on both ends — separation is negative
 * space, never a stroke drawn around the mark.
 *
 * Degrades gracefully: a `stroke` wider than `size` yields radius 0 (and so
 * zero-length paths) rather than a negative radius.
 */
export function cycleWheelGeometry(
  cycleLength: number,
  periodLength: number,
  size = 200,
  stroke = 18
): CycleWheelGeometry {
  const length = clampWheelCycleLength(cycleLength);
  const period = clampWheelPeriodLength(periodLength);
  const radius = Math.max(0, (size - stroke) / 2);
  const center = size / 2;
  const degreesPerDay = 360 / length;
  // Convert the 2pt gap into an angle at this radius. A degenerate radius has
  // no circumference to give away, so it takes no gap.
  const gapDeg = radius > 0 ? Math.min(degreesPerDay, (ARC_GAP / radius) * DEG_PER_RAD) : 0;

  const runs: Array<{ phase: CycleWheelPhase; startDay: number; endDay: number }> = [];
  for (let day = 1; day <= length; day += 1) {
    const phase = cycleWheelPhaseForDay(day, length, period);
    const last = runs[runs.length - 1];
    if (last && last.phase === phase) {
      last.endDay = day;
    } else {
      runs.push({ phase, startDay: day, endDay: day });
    }
  }

  const arcs: CycleWheelArc[] = runs.map((run) => {
    const days = run.endDay - run.startDay + 1;
    const rawStart = (run.startDay - 1) * degreesPerDay;
    const rawSweep = days * degreesPerDay;
    const startAngle = rawStart + gapDeg / 2;
    const sweepAngle = Math.max(0, rawSweep - gapDeg);
    let path = '';
    if (sweepAngle > 0 && radius > 0) {
      const from = polarPoint(center, radius, startAngle);
      const to = polarPoint(center, radius, startAngle + sweepAngle);
      const largeArc = sweepAngle > 180 ? 1 : 0;
      // A single phase can never cover the whole ring (the period always owns
      // at least day 1 and the cycle is at least 20 days), so the start and end
      // points are never coincident and a single arc segment is always valid.
      path =
        `M ${round3(from.x)} ${round3(from.y)} ` +
        `A ${round3(radius)} ${round3(radius)} 0 ${largeArc} 1 ${round3(to.x)} ${round3(to.y)}`;
    }
    return {
      phase: run.phase,
      startDay: run.startDay,
      endDay: run.endDay,
      days,
      startAngle: round3(startAngle),
      sweepAngle: round3(sweepAngle),
      path,
    };
  });

  const byPhase: Record<CycleWheelPhase, CycleWheelArc | null> = {
    menstrual: null,
    follicular: null,
    ovulation: null,
    luteal: null,
  };
  for (const arc of arcs) byPhase[arc.phase] = arc;

  return {
    size,
    stroke,
    radius,
    center,
    cycleLength: length,
    periodLength: period,
    degreesPerDay: round3(degreesPerDay),
    arcs,
    byPhase,
  };
}

/**
 * Round a caller-supplied cycle day onto the wheel, or `null` when it cannot be
 * placed. Out-of-range days are rejected rather than clamped — silently pinning
 * day 40 of a 28-day cycle onto day 28 would draw a confident lie.
 */
export function normaliseCycleDay(day: number | null | undefined, cycleLength: number): number | null {
  if (day == null || !Number.isFinite(day)) return null;
  const rounded = Math.round(day);
  return rounded >= 1 && rounded <= cycleLength ? rounded : null;
}

/** Mid-day point on the ring centre-line, for the current-day marker. */
export function cycleDayPoint(
  day: number | null | undefined,
  geometry: CycleWheelGeometry
): { x: number; y: number; angle: number } | null {
  const normalised = normaliseCycleDay(day, geometry.cycleLength);
  if (normalised == null) return null;
  const angle = (normalised - 0.5) * geometry.degreesPerDay;
  const point = polarPoint(geometry.center, geometry.radius, angle);
  return { x: round3(point.x), y: round3(point.y), angle: round3(angle) };
}

/* ------------------------------------------------------------------ */
/* Logged-day ticks                                                    */
/* ------------------------------------------------------------------ */

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

function localDateKey(now = new Date()): string {
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Map logged calendar dates onto cycle days.
 *
 * The wheel's domain is cycle days, not dates, so the mapping needs an anchor:
 * `currentDay` is the cycle day of `today`. Without it (no period logged yet)
 * there is nothing to anchor to and no ticks are drawn. Dates wrap around the
 * ring, so a date from a previous cycle lands on the same position it occupied
 * then. Returns sorted, de-duplicated cycle days; malformed keys are skipped.
 */
export function loggedCycleDays(
  loggedDays: readonly string[] | undefined,
  currentDay: number | null,
  today: string,
  cycleLength: number
): number[] {
  const length = clampWheelCycleLength(cycleLength);
  const anchor = normaliseCycleDay(currentDay, length);
  const todayMs = parseDateKey(today);
  if (anchor == null || todayMs == null || !loggedDays?.length) return [];
  const days = new Set<number>();
  for (const key of loggedDays) {
    const ms = parseDateKey(key);
    if (ms == null) continue;
    const offset = Math.round((ms - todayMs) / 86_400_000);
    days.add((((anchor + offset - 1) % length) + length) % length + 1);
  }
  return [...days].sort((a, b) => a - b);
}

/* ------------------------------------------------------------------ */
/* Accessibility                                                       */
/* ------------------------------------------------------------------ */

/**
 * Spoken description of the wheel. A screen reader cannot see an arc, so the
 * label states the phase spans and the current day in words.
 */
export function cycleWheelDescription(
  geometry: CycleWheelGeometry,
  currentDay: number | null
): string {
  const day = normaliseCycleDay(currentDay, geometry.cycleLength);
  const parts: string[] = [`${geometry.cycleLength}-day cycle.`];
  if (day == null) {
    parts.push('Current cycle day unknown.');
  } else {
    const phase = cycleWheelPhaseForDay(day, geometry.cycleLength, geometry.periodLength);
    parts.push(
      `Day ${day} of ${geometry.cycleLength}, ${CYCLE_WHEEL_PHASE_LABELS[phase].toLowerCase()}.`
    );
  }
  for (const arc of geometry.arcs) {
    const label = CYCLE_WHEEL_PHASE_LABELS[arc.phase];
    parts.push(
      arc.days === 1
        ? `${label} day ${arc.startDay}.`
        : `${label} days ${arc.startDay} to ${arc.endDay}.`
    );
  }
  return `Cycle wheel. ${parts.join(' ')}`;
}

/* ------------------------------------------------------------------ */
/* Color — ordinal ramp                                                */
/* ------------------------------------------------------------------ */

/**
 * Mix fractions toward the ink color, strongest phase first. Validated in
 * ordinal mode on the light surface (#F7FAFA) with the House primary:
 * monotone L PASS · adjacent ΔL PASS · light-end contrast 2.27:1 PASS ·
 * single hue PASS.
 */
const PHASE_RAMP_LIGHT = [0.52, 0.38, 0.24, 0.1] as const;

/**
 * Dark mode is selected, not flipped: its own steps, mixed toward the dark
 * surface instead of the ink so the ramp has room to separate. Validated on
 * #202632: monotone L PASS · adjacent ΔL PASS · light-end contrast 2.31:1 PASS
 * · single hue PASS.
 */
const PHASE_RAMP_DARK = [0, 0.2, 0.41, 0.62] as const;

/**
 * The four phase colors as one hue in monotone lightness steps, period
 * strongest. Pure so a caller can build a legend from the same source of truth
 * the arcs use.
 */
export function cycleWheelPhaseColors(
  base: string,
  ink: string,
  surface: string,
  isDark: boolean
): Record<CycleWheelPhase, string> {
  const ladder = isDark ? PHASE_RAMP_DARK : PHASE_RAMP_LIGHT;
  const target = isDark ? surface : ink;
  const steps = ladder.map((t) => mixHex(base, target, t));
  return {
    menstrual: steps[0],
    follicular: steps[1],
    ovulation: steps[2],
    luteal: steps[3],
  };
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

interface CycleWheelProps {
  /** Days from one period start to the next. Clamped to 20–45. */
  cycleLength: number;
  /** Bleeding days. Clamped to 1–14. */
  periodLength: number;
  /** 1-based cycle day of `today`, or null when nothing is logged yet. */
  currentDay: number | null;
  /** `YYYY-MM-DD` keys to tick on the ring. Needs `currentDay` to be placed. */
  loggedDays?: string[];
  /** Date `currentDay` refers to. Defaults to the local today. */
  today?: string;
  /** Outer box size in points (default 200). */
  size?: number;
  /** Ring thickness in points (default 18). */
  stroke?: number;
  /** Ramp base hue. Defaults to the brand primary. */
  color?: string;
  /** Replaces the default "Day N" center content. */
  children?: React.ReactNode;
  testID?: string;
}

const DEFAULT_SIZE = 200;
const DEFAULT_STROKE = 18;

export function CycleWheel({
  cycleLength,
  periodLength,
  currentDay,
  loggedDays,
  today,
  size = DEFAULT_SIZE,
  stroke = DEFAULT_STROKE,
  color,
  children,
  testID,
}: CycleWheelProps) {
  const colors = useAppColors();
  const isDark = useIsDarkMode();

  const geometry = useMemo(
    () => cycleWheelGeometry(cycleLength, periodLength, size, stroke),
    [cycleLength, periodLength, size, stroke]
  );
  const phaseColors = useMemo(
    () => cycleWheelPhaseColors(color ?? colors.primary, colors.textPrimary, colors.card, isDark),
    [color, colors.primary, colors.textPrimary, colors.card, isDark]
  );

  const anchorDate = today ?? localDateKey();
  const ticks = useMemo(
    () => loggedCycleDays(loggedDays, currentDay, anchorDate, geometry.cycleLength),
    [loggedDays, currentDay, anchorDate, geometry.cycleLength]
  );

  const marker = cycleDayPoint(currentDay, geometry);
  const day = normaliseCycleDay(currentDay, geometry.cycleLength);
  // Fits inside the ring stroke and still clears the 8pt minimum marker size.
  const markerRadius = Math.max(Spacing.xs, geometry.stroke / 2 - Spacing.xxs);
  const tickRadius = Math.max(0, geometry.radius - geometry.stroke / 2 - Spacing.xs);

  const containerStyle = useMemo(
    () => ({
      width: size,
      height: size,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    }),
    [size]
  );

  return (
    <View
      style={containerStyle}
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={cycleWheelDescription(geometry, currentDay)}
    >
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        {geometry.arcs.map((arc) =>
          arc.path ? (
            <Path
              key={arc.phase}
              d={arc.path}
              stroke={phaseColors[arc.phase]}
              strokeWidth={geometry.stroke}
              // Butt caps keep the 2pt gap honest — round caps would eat it.
              strokeLinecap="butt"
              fill="none"
              testID={testID ? `${testID}-arc-${arc.phase}` : undefined}
            />
          ) : null
        )}
        {ticks.map((tick) => {
          // Logged days are annotations inside the ring, deliberately quieter
          // than the current-day marker so they never compete with it.
          const point = polarPoint(geometry.center, tickRadius, (tick - 0.5) * geometry.degreesPerDay);
          return (
            <Circle
              key={`tick-${tick}`}
              cx={point.x}
              cy={point.y}
              r={Spacing.xxs + 0.5}
              fill={colors.textSecondary}
              testID={testID ? `${testID}-tick-${tick}` : undefined}
            />
          );
        })}
        {marker ? (
          <Circle
            cx={marker.x}
            cy={marker.y}
            r={markerRadius}
            fill={colors.textPrimary}
            // 2pt surface ring so the marker stays legible on any phase arc.
            stroke={colors.card}
            strokeWidth={Spacing.xxs}
            testID={testID ? `${testID}-marker` : undefined}
          />
        ) : null}
      </Svg>
      {children ??
        (day != null ? (
          <View style={styles.center}>
            <Typography variant="title" weight="bold" color={colors.textPrimary}>
              {`Day ${day}`}
            </Typography>
          </View>
        ) : null)}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
