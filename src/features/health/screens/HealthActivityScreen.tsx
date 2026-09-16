import { useFocusEffect } from 'expo-router/react-navigation';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { Card, Typography } from '@components/ui';
import { AppBarChart } from '@components/ui/AppBarChart';
import { AppLineChart } from '@components/ui/AppLineChart';
import { CalendarHeatmap } from '@components/ui/CalendarHeatmap';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';
import { seriesColor } from '@theme/chartPalette';
import { hexToRgba } from '@theme/colors';

import { HealthGoalBar, HealthSectionScreen, HealthStatTiles, LegendKey } from '../components';
import { HealthWorkoutTypePicker } from '../components/HealthWorkoutTypePicker';
import {
  ACTIVITY_WIDGET_KEYS,
  addWorkoutEntry,
  DEFAULT_ACTIVITY_GOALS,
  DEFAULT_ACTIVITY_LAYOUT,
  DEFAULT_INTENSITY,
  deleteWorkoutEntry,
  distanceUnitFor,
  formatDistance,
  formatDuration,
  loadActivityGoals,
  loadActivityLayout,
  loadStepDays,
  loadStepsForDate,
  loadWorkouts,
  metresToDisplay,
  parseDistanceInput,
  parseMinutesInput,
  parseStepsInput,
  parseWorkoutCaloriesInput,
  QUICK_WORKOUT_TYPES,
  recentDayKeys,
  sanitizeDecimalInput,
  sanitizeIntegerInput,
  saveActivityGoals,
  setStepsForDate,
  summarizeActivity,
  updateWorkoutEntry,
  WORKOUT_CATEGORIES,
  WORKOUT_CATEGORY_LABELS,
  WORKOUT_INTENSITIES,
  WORKOUT_INTENSITY_LABELS,
  workoutSupportsDistance,
  workoutTypeCategory,
  workoutTypeIcon,
  workoutTypeLabel,
  type ActivityGoals,
  type ActivityLayout,
  type ActivityWidgetKey,
  type DistanceUnit,
  type StepDay,
  type WorkoutEntry,
  type WorkoutIntensity,
  type WorkoutType,
} from '../healthActivityStorage';
import {
  formatLoggedAt,
  isRealDayKey,
  loadHealthPrefs,
  maskClockInput,
  maskDayKeyInput,
  todayDateKey,
} from '../healthLocalStorage';
import { formatDayKey, shiftDateKey } from '../healthNutritionStorage';
import { useHealthKitSyncHydration } from '../useHealthKitSyncHydration';

import { HealthWorkoutSessionDetail } from './HealthWorkoutSessionDetail';

/**
 * Activity tab — the donor's "Workouts" area, rebuilt to parity.
 *
 * The donor showed a Monday-based week navigator, a four-tile week summary,
 * three daily charts and a day-grouped session list, all fed by HealthKit. This
 * rebuild keeps the SHAPE of that surface on the manual path the migration plan
 * requires (`HealthKit-off path required`), and adds the things the donor never
 * had: a per-type breakdown, streaks, and edit/delete on a session.
 *
 * ## Two backend gaps this screen used to work around — both closed in 0124
 *
 *  1. **A health entry could not be updated.** `/health/entries` was create +
 *     soft-delete only, so "edit a session" RE-RECORDED it: write the
 *     replacement, then tombstone the original. Safe, but it minted a new id and
 *     moved the logged time, and the edit header had to apologise for it.
 *     `PUT /health/entries/workouts/:id` now edits in place, and the copy says
 *     what it actually does.
 *  2. **A workout had no intensity.** `POST /health/entries/workouts` accepted
 *     only `workout_type` / `minutes` / `calories` / `note` and zod stripped the
 *     rest, so intensity rode the note as a leading `[hard]` tag. It is a real
 *     `health_entries.intensity` column now; nothing here writes a tag.
 *     `parseWorkoutNote` survives in the STORE as a read-only reader for the
 *     notes the old scheme left behind — see its comment there.
 *
 * ## What this port added on top of that
 *
 *  - **The session vocabulary is the donor's 61**, not 7 (`healthWorkoutTypes.ts`),
 *    reached through a grouped, searchable sheet rather than a flat chip row.
 *  - **Distance** — a field the RN app did not have at all. Metres on the wire
 *    (the donor's unit), shown in km or miles from the one units switch this app
 *    has, and offered only for the 14 types the donor says measure one.
 *  - **Date and time on the log form.** A new session used to be stamped "now",
 *    so a run you logged on the bus home landed on the wrong hour and a session
 *    you forgot until tomorrow landed on the wrong DAY.
 *  - **Past-window navigation.** Every range here used to be trailing — last
 *    March was unreachable. ◀ / ▶ walk whole windows, as the Weight tab does.
 *
 * ## Charts
 *
 * Every axis is labelled by DATE, never by index, and any thinning or bucketing
 * is stated in words beneath the chart (`chart-note`). A range with nothing in
 * it renders a sentence, never an empty axis — an flat/blank chart reads as
 * "you did nothing" when the truth is "nothing was logged".
 *
 * ABSENT IS NOT ZERO, and it is the rule that shapes three of the four charts
 * here. A day with no step count, a block where no session recorded a distance
 * and a block where nobody counted calories are all LEFT OUT rather than drawn
 * at zero, and each chart says so underneath. A zero bar is a measurement —
 * "you covered no ground" — and none of those three took one. The one exception
 * is active minutes, which every session is required to carry, so a zero there
 * genuinely means no session was logged.
 */

/* ==================================================================== */
/* Pure helpers (exported so they are unit-testable without rendering)   */
/* ==================================================================== */

// The intensity vocabulary lives in the STORE now that it is a real column —
// `WORKOUT_INTENSITIES`, `WORKOUT_INTENSITY_LABELS` and `DEFAULT_INTENSITY` are
// imported above, next to `WORKOUT_TYPES`, so the wire shape has one home.

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** `2026-07-13` → `Jul 13`. Axis labels name a DAY, never a position. */
export function formatAxisDay(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day || month < 1 || month > 12) return dateKey;
  return `${MONTHS[month - 1]} ${day}`;
}

export interface StreakSummary {
  current: number;
  longest: number;
  lastActiveDate: string | null;
}

/**
 * Consecutive-day streaks over the day keys that carry a session.
 *
 * The current streak is allowed to end YESTERDAY: a rest day that is still in
 * progress has not broken anything yet, and zeroing it at midnight would punish
 * someone who simply has not trained yet today.
 */
export function workoutStreaks(dayKeys: string[], today = todayDateKey()): StreakSummary {
  const unique = [...new Set(dayKeys)].sort();
  if (unique.length === 0) return { current: 0, longest: 0, lastActiveDate: null };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < unique.length; i += 1) {
    run = consecutive(unique[i - 1], unique[i]) ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  const last = unique[unique.length - 1];
  const gap = wholeDaysBetween(last, today);
  let current = 0;
  if (gap !== null && gap <= 1) {
    current = 1;
    for (let i = unique.length - 1; i > 0; i -= 1) {
      if (!consecutive(unique[i - 1], unique[i])) break;
      current += 1;
    }
  }
  return { current, longest, lastActiveDate: last };
}

function wholeDaysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

function consecutive(earlier: string, later: string): boolean {
  return wholeDaysBetween(earlier, later) === 1;
}

/**
 * The two workout-type buckets the donor's Activity Minutes chart splits by
 * (its two `HKWorkoutType` groups). Closest honest split over this app's own
 * manual vocabulary: the two locomotion types vs everything else — inventing
 * a third bucket would not map to anything the donor drew.
 */
const WALK_RUN_TYPES = new Set<WorkoutType>(['walk', 'run']);

/**
 * One tint per workout category (donor: every `WorkoutType.color` is a
 * distinct SwiftUI `Color`). Rotated through the brand-aware chart series
 * (`seriesColor`) rather than eight hand-picked hex values, so a session's
 * icon badge and its color stay correct across brand palettes.
 */
const CATEGORY_COLOR_INDEX = new Map(
  WORKOUT_CATEGORIES.map((category, index) => [category, index] as const)
);

export interface VolumeBucket {
  /** First day the bucket covers, `YYYY-MM-DD`. */
  start: string;
  /** Last day the bucket covers (inclusive). */
  end: string;
  minutes: number;
  /** Minutes from `walk` / `run` sessions only — one of the two chart series. */
  walkRunMinutes: number;
  /** Minutes from every other session type — the chart's other series. */
  exerciseMinutes: number;
  sessions: number;
  /** Burned kcal across the bucket. `0` also means "nobody counted". */
  calories: number;
  /**
   * Metres across the sessions in this bucket that RECORDED one — `null` when
   * none did. Kept nullable all the way to the chart so an unmeasured block is
   * dropped rather than drawn as a 0 km bar.
   */
  distanceM: number | null;
}

export interface VolumeSeries {
  buckets: VolumeBucket[];
  granularity: 'day' | 'week';
  /** Every Nth label is drawn; 1 means none were dropped. */
  labelStep: number;
  /** Plain-language disclosure of the bucketing AND the thinning. */
  note: string;
}

const MAX_AXIS_LABELS = 7;
const MAX_DAILY_BARS = 14;

interface DayTotals {
  minutes: number;
  walkRunMinutes: number;
  exerciseMinutes: number;
  sessions: number;
  calories: number;
  distanceM: number | null;
}

/**
 * Minutes, sessions, burned calories and distance per bucket across `dayKeys`
 * (oldest first).
 *
 * Short ranges get one bar per DAY. Longer ones are aggregated into 7-day
 * blocks anchored at the END of the range, so the final block always ends today
 * and no partial week is silently dropped. Either way the label names a real
 * date, and the note says which of the two the reader is looking at.
 *
 * ONE bucketing for all three charts on this screen, deliberately: the minutes,
 * calories and distance charts sit under one range picker, and three separate
 * bucketings would put three different x-axes on a screen the reader is
 * comparing across.
 */
export function volumeSeries(workouts: WorkoutEntry[], dayKeys: string[]): VolumeSeries {
  if (dayKeys.length === 0) {
    return { buckets: [], granularity: 'day', labelStep: 1, note: '' };
  }
  const byDay = new Map<string, DayTotals>();
  for (const entry of workouts) {
    const current = byDay.get(entry.date) ?? {
      minutes: 0,
      walkRunMinutes: 0,
      exerciseMinutes: 0,
      sessions: 0,
      calories: 0,
      distanceM: null,
    };
    const isWalkRun = WALK_RUN_TYPES.has(entry.type);
    byDay.set(entry.date, {
      minutes: current.minutes + entry.minutes,
      walkRunMinutes: current.walkRunMinutes + (isWalkRun ? entry.minutes : 0),
      exerciseMinutes: current.exerciseMinutes + (isWalkRun ? 0 : entry.minutes),
      sessions: current.sessions + 1,
      calories: current.calories + entry.calories,
      // Adding to `null` would make an unmeasured day a zero-metre day; the sum
      // only starts existing once a session on it actually recorded a distance.
      distanceM:
        entry.distanceM === null ? current.distanceM : (current.distanceM ?? 0) + entry.distanceM,
    });
  }

  const granularity: 'day' | 'week' = dayKeys.length <= MAX_DAILY_BARS ? 'day' : 'week';
  const size = granularity === 'day' ? 1 : 7;
  const buckets: VolumeBucket[] = [];
  // Walk from the END so the last bucket always finishes on the newest day.
  for (let end = dayKeys.length - 1; end >= 0; end -= size) {
    const start = Math.max(0, end - size + 1);
    let minutes = 0;
    let walkRunMinutes = 0;
    let exerciseMinutes = 0;
    let sessions = 0;
    let calories = 0;
    let distanceM: number | null = null;
    for (let i = start; i <= end; i += 1) {
      const day = byDay.get(dayKeys[i]);
      if (day) {
        minutes += day.minutes;
        walkRunMinutes += day.walkRunMinutes;
        exerciseMinutes += day.exerciseMinutes;
        sessions += day.sessions;
        calories += day.calories;
        if (day.distanceM !== null) distanceM = (distanceM ?? 0) + day.distanceM;
      }
    }
    buckets.unshift({
      start: dayKeys[start],
      end: dayKeys[end],
      minutes,
      walkRunMinutes,
      exerciseMinutes,
      sessions,
      calories,
      distanceM,
    });
  }

  const labelStep = Math.max(1, Math.ceil(buckets.length / MAX_AXIS_LABELS));
  const parts = [
    granularity === 'day'
      ? 'One bar per day, labelled by date.'
      : 'Each bar is a 7-day block, labelled by the day it starts.',
  ];
  if (labelStep > 1) {
    parts.push(`Only every ${ordinal(labelStep)} label is drawn to keep the axis readable.`);
  }
  return { buckets, granularity, labelStep, note: parts.join(' ') };
}

function ordinal(step: number): string {
  if (step === 2) return '2nd';
  if (step === 3) return '3rd';
  return `${step}th`;
}

export interface TypeBreakdownRow {
  type: WorkoutType;
  sessions: number;
  minutes: number;
  calories: number;
  /** Metres across the sessions of this type that recorded one; `null` if none. */
  distanceM: number | null;
  /** Share of the range's total minutes, 0–1. */
  share: number;
}

interface TypeTotals {
  sessions: number;
  minutes: number;
  calories: number;
  distanceM: number | null;
}

/** Per-type totals inside the range, busiest first; silent types are dropped. */
export function typeBreakdown(workouts: WorkoutEntry[], dayKeys: string[]): TypeBreakdownRow[] {
  const inRange = new Set(dayKeys);
  const rows = new Map<WorkoutType, TypeTotals>();
  let total = 0;
  for (const entry of workouts) {
    if (!inRange.has(entry.date)) continue;
    const current = rows.get(entry.type) ?? {
      sessions: 0,
      minutes: 0,
      calories: 0,
      distanceM: null,
    };
    rows.set(entry.type, {
      sessions: current.sessions + 1,
      minutes: current.minutes + entry.minutes,
      calories: current.calories + entry.calories,
      distanceM:
        entry.distanceM === null ? current.distanceM : (current.distanceM ?? 0) + entry.distanceM,
    });
    total += entry.minutes;
  }
  return [...rows.entries()]
    .map(([type, value]) => ({
      type,
      sessions: value.sessions,
      minutes: value.minutes,
      calories: value.calories,
      distanceM: value.distanceM,
      share: total > 0 ? value.minutes / total : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes || a.type.localeCompare(b.type));
}

/* ------------------------- date + time on a session -------------------- */

/**
 * A session's own clock time, `HH:MM` in the reader's timezone.
 *
 * Reads `startedAt` when the session has one and falls back to the row's
 * `created_at` when it does not — every session logged before the form had a
 * time field, which is most of them.
 */
export function formatClock(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** `HH:MM` (24h, minute-resolution) or nothing. */
export function parseClock(raw: string): { hours: number; minutes: number } | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec((raw ?? '').trim());
  if (!match) return null;
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

/**
 * A day key plus a wall-clock time → an instant.
 *
 * Built through the LOCAL `Date` constructor rather than by string
 * concatenation, so the offset is the reader's own and a 07:30 run does not
 * become 07:30 UTC. `toISOString()` then serialises it with the `Z` the route's
 * `z.string().datetime({ offset: true })` accepts.
 */
export function composeStartedAt(dateKey: string, clock: string): string | null {
  const [year, month, day] = dateKey.split('-').map(Number);
  const time = parseClock(clock);
  if (!year || !month || !day || !time) return null;
  const d = new Date(year, month - 1, day, time.hours, time.minutes, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface DayGroup {
  date: string;
  label: string;
  entries: WorkoutEntry[];
}

/**
 * Sessions grouped by day, newest day first (donor behaviour).
 *
 * Within a day the order is by when the session HAPPENED, falling back to when
 * the row was written for the sessions logged before the form had a time field.
 * Sorting purely on `loggedAt` put a back-dated morning run above an evening one
 * simply because it was typed later.
 */
export function groupWorkoutsByDay(workouts: WorkoutEntry[]): DayGroup[] {
  const byDay = new Map<string, WorkoutEntry[]>();
  for (const entry of workouts) {
    const list = byDay.get(entry.date);
    if (list) list.push(entry);
    else byDay.set(entry.date, [entry]);
  }
  const at = (entry: WorkoutEntry) => entry.startedAt ?? entry.loggedAt;
  return [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, entries]) => ({
      date,
      label: formatDayKey(date),
      entries: [...entries].sort((a, b) => at(b).localeCompare(at(a))),
    }));
}

/* ==================================================================== */
/* Screen                                                               */
/* ==================================================================== */

/**
 * The four widths the Weight tab settled on, so the two tabs navigate time
 * identically. A year was added here alongside ◀ / ▶: reaching last March by
 * stepping back thirteen 30-day windows is technically possible and practically
 * useless.
 */
const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
] as const;

/** The picker holds the whole option, so a range always HAS a label. */
type ActivityRange = (typeof RANGES)[number];

const HEATMAP_WEEKS = 12;

/** Which series the donor's combined "Steps & Distance" card is showing. */
type StepsMetric = 'steps' | 'distance';

interface WorkoutForm {
  type: WorkoutType;
  intensity: WorkoutIntensity;
  minutes: string;
  calories: string;
  /** In the DISPLAYED unit (km or mi); converted to metres on save. */
  distance: string;
  /** `YYYY-MM-DD`, typed — the Weight tab's convention, see `dateFieldNote`. */
  date: string;
  /** `HH:MM`, 24-hour. */
  time: string;
  note: string;
}

function emptyForm(): WorkoutForm {
  const now = new Date();
  return {
    type: 'walk',
    intensity: DEFAULT_INTENSITY,
    minutes: '',
    calories: '',
    distance: '',
    // Defaulted to NOW, so the overwhelmingly common "I just finished" case is
    // still zero taps and the fields are only touched when they are wrong.
    date: todayDateKey(),
    time: formatClock(now.toISOString()),
    note: '',
  };
}

export function HealthActivityScreen() {
  const colors = useAppColors();
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(200, width - 96);

  const [workouts, setWorkouts] = useState<WorkoutEntry[]>([]);
  const [stepDays, setStepDays] = useState<StepDay[]>([]);
  const [steps, setSteps] = useState(0);
  const [stepDraft, setStepDraft] = useState('');
  const [goals, setGoals] = useState<ActivityGoals>(DEFAULT_ACTIVITY_GOALS);
  const [activityLayout, setActivityLayout] = useState<ActivityLayout>(DEFAULT_ACTIVITY_LAYOUT);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<ActivityRange>(RANGES[0]);
  /**
   * How many whole windows back from today the reader has walked.
   *
   * Every range picker in this app used to be trailing-only — "the last 30
   * days" and nothing else — so a month you wanted to look back on was simply
   * unreachable. `0` is the trailing window, `1` the one before it, and so on;
   * ▶ is disabled at `0` because there is no future to walk into.
   */
  const [windowsBack, setWindowsBack] = useState(0);
  const [stepsMetric, setStepsMetric] = useState<StepsMetric>('steps');
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>('km');
  const rangeDays = range.days;
  const rangeLabel = range.label;

  const [form, setForm] = useState<WorkoutForm>(emptyForm);
  /**
   * The session being edited, plus the date and instant it had when the form
   * was opened — so the screen can tell "I only changed the duration" from
   * "I moved this to Tuesday morning" and say the right thing about it.
   */
  const [editing, setEditing] = useState<{
    id: string;
    date: string;
    startedAt: string;
  } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** The session shown in the detail sheet — a `Modal`, not a route, so the
   * screen's scroll position and range window stay put behind it (same
   * pattern as `HealthExerciseDetailScreen`). */
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null);

  const setField = useCallback(<K extends keyof WorkoutForm>(key: K, value: WorkoutForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  const hydrate = useCallback(async () => {
    const [entries, days, todaySteps, storedGoals, prefs, layout] = await Promise.all([
      loadWorkouts(),
      loadStepDays(),
      loadStepsForDate(),
      loadActivityGoals(),
      loadHealthPrefs(),
      loadActivityLayout(),
    ]);
    setWorkouts(entries);
    setStepDays(days);
    setSteps(todaySteps);
    setStepDraft(todaySteps > 0 ? String(todaySteps) : '');
    setGoals(storedGoals);
    // Distance follows the ONE units switch this app has (Settings → Units):
    // someone on Imperial does not then run in kilometres.
    setDistanceUnit(distanceUnitFor(prefs.unitSystem));
    setActivityLayout(layout);
    setLoading(false);
  }, []);

  // Hydrates on mount AND every subsequent focus (leave-and-return) — a plain
  // mount-only `useEffect` would be redundant with this, since `useFocusEffect`
  // already fires immediately when the screen is focused on first render.
  useFocusEffect(
    useCallback(() => {
      void hydrate();
    }, [hydrate]),
  );
  // Also re-hydrate the instant a HealthKit sync lands while already on this
  // tab — the background observer/catch-up paths don't wait for a nav event.
  useHealthKitSyncHydration(hydrate);

  const today = todayDateKey();
  /** Last day of the window on screen — today unless the reader walked back. */
  const windowEnd = useMemo(
    () => (windowsBack === 0 ? today : shiftDateKey(today, -windowsBack * rangeDays)),
    [today, windowsBack, rangeDays]
  );
  const rangeKeys = useMemo(
    () => recentDayKeys(rangeDays, windowEnd),
    [rangeDays, windowEnd]
  );
  /** Section-header form: `LAST 7 DAYS` / `13 JUL – 19 JUL` once it is uppercased. */
  const windowLabel =
    windowsBack === 0
      ? `Last ${rangeLabel}`
      : `${formatAxisDay(rangeKeys[0])} – ${formatAxisDay(windowEnd)}`;
  /**
   * Sentence form, for the copy under every chart.
   *
   * A separate string rather than `windowLabel.toLowerCase()`, because
   * lower-casing a date turns "13 Jul – 19 Jul" into "13 jul – 19 jul".
   */
  const windowPhrase =
    windowsBack === 0
      ? `the last ${rangeLabel}`
      : `${formatAxisDay(rangeKeys[0])} – ${formatAxisDay(windowEnd)}`;

  const rangeSummary = useMemo(
    () => summarizeActivity(workouts, stepDays, rangeKeys),
    [workouts, stepDays, rangeKeys]
  );
  const todaySummary = useMemo(
    () => summarizeActivity(workouts, [{ date: today, steps }], [today]),
    [workouts, steps, today]
  );
  const rangeWorkouts = useMemo(() => {
    const inRange = new Set(rangeKeys);
    return workouts.filter((entry) => inRange.has(entry.date));
  }, [workouts, rangeKeys]);

  const volume = useMemo(() => volumeSeries(workouts, rangeKeys), [workouts, rangeKeys]);
  const breakdown = useMemo(() => typeBreakdown(workouts, rangeKeys), [workouts, rangeKeys]);
  const streaks = useMemo(
    () => workoutStreaks(workouts.map((entry) => entry.date), today),
    [workouts, today]
  );
  const dayGroups = useMemo(() => groupWorkoutsByDay(rangeWorkouts), [rangeWorkouts]);
  const selectedWorkoutEntry = useMemo(
    () => workouts.find((entry) => entry.id === selectedWorkoutId) ?? null,
    [workouts, selectedWorkoutId]
  );
  const workoutCategoryColor = useCallback(
    (type: WorkoutType) =>
      seriesColor(colors, CATEGORY_COLOR_INDEX.get(workoutTypeCategory(type)) ?? 0),
    [colors]
  );

  const heatmapValues = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const entry of workouts) {
      byDay.set(entry.date, (byDay.get(entry.date) ?? 0) + entry.minutes);
    }
    return [...byDay.entries()].map(([date, value]) => ({ date, value }));
  }, [workouts]);

  const stepSeries = useMemo(() => {
    const byDay = new Map(stepDays.map((day) => [day.date, day.steps]));
    const points: Array<{ date: string; value: number }> = [];
    for (const key of rangeKeys) {
      const value = byDay.get(key);
      // A day with no count is LEFT OUT rather than plotted as zero — the note
      // under the chart says so, and a zero reads as "you did not move".
      if (value !== undefined) points.push({ date: key, value });
    }
    const labelStep = Math.max(1, Math.ceil(points.length / MAX_AXIS_LABELS));
    return { points, labelStep };
  }, [stepDays, rangeKeys]);

  /**
   * Buckets that actually measured a distance.
   *
   * A block where nobody recorded one is DROPPED rather than drawn at zero —
   * the same treatment the step line already gives a day with no count, and for
   * the same reason: a 0 km bar claims the member covered no ground, which is
   * not what "I did not measure it" says. The caption states it.
   */
  const distanceBuckets = useMemo(
    () => volume.buckets.filter((bucket) => bucket.distanceM !== null),
    [volume.buckets]
  );
  const distanceLabelStep = Math.max(1, Math.ceil(distanceBuckets.length / MAX_AXIS_LABELS));

  /** Same contract for burned calories: nobody counting is not zero burned. */
  const calorieBuckets = useMemo(
    () => volume.buckets.filter((bucket) => bucket.calories > 0),
    [volume.buckets]
  );
  const calorieLabelStep = Math.max(1, Math.ceil(calorieBuckets.length / MAX_AXIS_LABELS));

  const parsedMinutes = parseMinutesInput(form.minutes);
  // A date is required and cannot be in the future — the same rule (and the same
  // typed `YYYY-MM-DD` field) the Weight tab's back-dating already uses. The
  // donor refuses future dates too, silently; this one says so.
  // Calendar, not just shape: the field punctuates itself now, so eight digits
  // always arrive looking like a day key and `2026-13-40` would otherwise be
  // filed against a month that does not exist.
  const dateValid = isRealDayKey(form.date) && form.date <= today;
  const timeValid = parseClock(form.time) !== null;
  const supportsDistance = workoutSupportsDistance(form.type);
  const parsedDistance = supportsDistance
    ? parseDistanceInput(form.distance, distanceUnit)
    : null;
  const distanceValid = parsedDistance !== undefined;
  const canLog = parsedMinutes !== null && dateValid && timeValid && distanceValid;

  // Every chart announces its headline figure: a screen reader cannot see a bar,
  // so the wrapper carries the number the picture is making (same contract as the
  // weight and calorie dashboards).
  const volumeChartLabel =
    `Active minutes over ${windowPhrase}: ${formatDuration(rangeSummary.minutes)} ` +
    `across ${rangeSummary.workouts} ${rangeSummary.workouts === 1 ? 'session' : 'sessions'}.`;
  const latestSteps = stepSeries.points[stepSeries.points.length - 1]?.value ?? 0;
  const stepsChartLabel =
    `Daily steps over ${windowPhrase}: ${stepSeries.points.length} recorded days, ` +
    `latest ${latestSteps}.`;
  const distanceChartLabel =
    `Distance over ${windowPhrase}: ` +
    `${formatDistance(rangeSummary.distanceM, distanceUnit)} across ` +
    `${rangeSummary.distanceSessions} ${rangeSummary.distanceSessions === 1 ? 'session' : 'sessions'} ` +
    `that recorded one.`;
  const caloriesChartLabel =
    `Calories burned over ${windowPhrase}: ${rangeSummary.calories} kcal ` +
    `across ${rangeSummary.workouts} ${rangeSummary.workouts === 1 ? 'session' : 'sessions'}.`;

  /** Distinct types the member has logged, newest first — the picker's shortcut. */
  const recentTypes = useMemo(() => workouts.map((entry) => entry.type), [workouts]);

  const resetForm = useCallback(() => {
    setForm(emptyForm());
    setEditing(null);
  }, []);

  const handleLog = async () => {
    const mins = parseMinutesInput(form.minutes);
    if (mins === null) return;
    if (!dateValid || !timeValid) return;
    // `undefined` is the REFUSAL from `parseDistanceInput`; `null` is a blank
    // field, which is a valid answer meaning "I did not measure it".
    const distanceM = supportsDistance
      ? parseDistanceInput(form.distance, distanceUnit)
      : null;
    if (distanceM === undefined) {
      Alert.alert(
        'Check the distance',
        'That is further than one session covers. Leave it blank if you did not measure it.'
      );
      return;
    }
    const startedAt = composeStartedAt(form.date, form.time);
    if (startedAt === null) return;
    // A BLANK calorie field means "not counting", and so does a typed `0` — but
    // `parseWorkoutCaloriesInput` only accepts the first. Its shared integer
    // parser rejects anything `<= 0`, a guard that belongs to the REQUIRED
    // minutes field, so typing `0` used to fire the alert below and block the
    // whole session from being logged.
    const typedCalories = form.calories.trim();
    const kcal = /^0+$/.test(typedCalories) ? 0 : parseWorkoutCaloriesInput(typedCalories);
    if (kcal === null) {
      // The field is sanitised to digits and a typed zero is normalised above,
      // so the only way left to fail is a figure no single session can burn.
      Alert.alert(
        'Check the calories',
        'That is more than one session can burn. Leave it blank if you are not counting.'
      );
      return;
    }
    const note = form.note.trim();
    // Only send what the user actually chose: a bare `{ type, minutes,
    // calories }` is what the plain "log a walk" path has always written, and
    // an untouched intensity picker still means "not recorded".
    const payload: Parameters<typeof addWorkoutEntry>[0] = {
      type: form.type,
      minutes: mins,
      calories: kcal,
      // The DAY and the INSTANT both come from the form now. A session logged
      // on the bus home used to be stamped "now", which put an evening run in
      // the wrong hour and a session remembered the next morning on the wrong
      // day entirely.
      date: form.date,
      startedAt,
      // Absent rather than 0 — see `WorkoutEntry.distanceM`. A type that does
      // not measure distance can never carry one, even if a previous draft did.
      distanceM,
    };
    if (note.length > 0) payload.note = note;
    if (form.intensity !== DEFAULT_INTENSITY) payload.intensity = form.intensity;

    if (editing) {
      // 0124 gave the entry a real update route, so an edit keeps the row's id
      // and its place in the history. It used to have to re-record. The edit
      // ALWAYS states its intensity and its distance, including the empty
      // cases, because clearing either has to remove a previously stored value.
      setWorkouts(
        await updateWorkoutEntry(editing.id, {
          ...payload,
          note,
          intensity: form.intensity === DEFAULT_INTENSITY ? undefined : form.intensity,
        })
      );
    } else {
      setWorkouts(await addWorkoutEntry(payload));
    }
    resetForm();
  };

  const handleEdit = (entry: WorkoutEntry) => {
    setEditing({
      id: entry.id,
      date: entry.date,
      startedAt: entry.startedAt ?? entry.loggedAt,
    });
    setForm({
      type: entry.type,
      // A real field now — the store already stripped any legacy `[hard] ` tag
      // out of the note and resolved it to the column's value.
      intensity: entry.intensity,
      minutes: String(entry.minutes),
      calories: entry.calories > 0 ? String(entry.calories) : '',
      distance:
        entry.distanceM === null
          ? ''
          : metresToDisplay(entry.distanceM, distanceUnit).toFixed(1),
      date: entry.date,
      // A session logged before the form had a time field has no `startedAt`.
      // Falling back to the row's creation stamp puts a real, defensible clock
      // time in the field rather than a blank one the member has to invent.
      time: formatClock(entry.startedAt ?? entry.loggedAt),
      note: entry.note,
    });
  };

  const handleDelete = async (id: string) => {
    setWorkouts(await deleteWorkoutEntry(id));
    if (editing?.id === id) resetForm();
  };

  const handleSaveSteps = async (raw?: string) => {
    const value = parseStepsInput(raw ?? stepDraft);
    if (value === null) {
      // Reject silently and restore the stored value — no raw error strings.
      setStepDraft(steps > 0 ? String(steps) : '');
      return;
    }
    setStepDays(await setStepsForDate(value));
    setSteps(value);
    setStepDraft(value > 0 ? String(value) : '');
  };

  const handleMinutesGoal = useCallback(() => {
    Alert.alert('Daily movement goal', 'How many active minutes are you aiming for?', [
      ...[20, 30, 45, 60].map((value) => ({
        text: `${value} min`,
        onPress: () => void saveActivityGoals({ minutes: value }).then(setGoals),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }, []);

  const handleStepsGoal = useCallback(() => {
    Alert.alert('Daily step goal', 'How many steps are you aiming for?', [
      ...[5000, 8000, 10000, 12000].map((value) => ({
        text: `${value} steps`,
        onPress: () => void saveActivityGoals({ steps: value }).then(setGoals),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }, []);

  const cardStyle = [styles.card, { backgroundColor: colors.backgroundSecondary }];
  const inputStyle = [
    styles.input,
    {
      color: colors.textPrimary,
      borderColor: colors.borderColor,
      backgroundColor: colors.backgroundMain,
    },
  ];

  // The five chart-style cards below, reorderable/hideable via
  // `activityLayout.widgets` — the same mechanism Home and Weight already
  // use, edited from More → Customize Tabs rather than an inline panel here.
  const ACTIVITY_RENDERERS: Record<ActivityWidgetKey, () => React.ReactNode> = {
    activeMinutes: () => (
      <Card variant="filled" style={cardStyle} key="activeMinutes">
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          ACTIVE MINUTES
        </Typography>
        {rangeSummary.minutes === 0 ? (
          <Typography
            variant="body"
            color={colors.textSecondary}
            testID="health-activity-volume-empty"
          >
            No active minutes logged in {windowPhrase}. Log a session above and this
            chart fills in.
          </Typography>
        ) : (
          <>
            <View
              accessible
              accessibilityRole="image"
              accessibilityLabel={volumeChartLabel}
              testID="health-activity-volume-chart"
            >
              <AppBarChart
                width={chartWidth}
                stacks={volume.buckets.map((bucket, index) => ({
                  label: index % volume.labelStep === 0 ? formatAxisDay(bucket.start) : '',
                  segments: [
                    { value: bucket.walkRunMinutes, color: seriesColor(colors, 0) },
                    { value: bucket.exerciseMinutes, color: seriesColor(colors, 1) },
                  ],
                }))}
                formatValue={(value) => `${Math.round(value)}`}
                referenceValue={
                  // The daily goal is only a comparable line while each bar IS a
                  // day; against a 7-day block it would sit six times too low.
                  volume.granularity === 'day' ? goals.minutes : undefined
                }
                referenceLabel={`Goal ${goals.minutes} min/day`}
              />
            </View>
            {/* The donor's two-series split (Walk/Run vs Exercise), so the bar
                answers "active at what" and not just "active how long". */}
            <View style={styles.legendRow} testID="health-activity-volume-legend">
              <LegendKey color={seriesColor(colors, 0)} label="Walk/Run" />
              <LegendKey color={seriesColor(colors, 1)} label="Exercise" />
            </View>
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              testID="health-activity-volume-note"
            >
              {volume.granularity === 'day'
                ? `${volume.note} The dashed rule is your ${goals.minutes}-minute daily goal.`
                : `${volume.note} The daily goal is not drawn here — it would sit seven times too low against a weekly block.`}
            </Typography>
          </>
        )}
      </Card>
    ),
    caloriesBurned: () => (
      <Card variant="filled" style={cardStyle} key="caloriesBurned">
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          CALORIES BURNED
        </Typography>
        {calorieBuckets.length === 0 ? (
          <Typography
            variant="body"
            color={colors.textSecondary}
            testID="health-activity-calories-empty"
          >
            {rangeSummary.workouts === 0
              ? `No sessions logged in ${windowPhrase}, so there is nothing to chart.`
              : `None of the ${rangeSummary.workouts} sessions in ${windowPhrase} recorded a calorie figure. Add one when you log and this chart fills in.`}
          </Typography>
        ) : (
          <>
            <View
              accessible
              accessibilityRole="image"
              accessibilityLabel={caloriesChartLabel}
              testID="health-activity-calories-chart"
            >
              <AppBarChart
                width={chartWidth}
                data={calorieBuckets.map((bucket, index) => ({
                  value: bucket.calories,
                  label: index % calorieLabelStep === 0 ? formatAxisDay(bucket.start) : '',
                }))}
                formatValue={(value) => `${Math.round(value)}`}
              />
            </View>
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              testID="health-activity-calories-note"
            >
              {`${volume.note} Only the ${calorieBuckets.length} ${
                volume.granularity === 'day' ? 'days' : 'blocks'
              } where a session recorded a calorie figure are drawn — nobody counting is not the same as burning nothing, so those are left out rather than shown as zero.${
                calorieLabelStep > 1
                  ? ` Only every ${ordinal(calorieLabelStep)} label is drawn.`
                  : ''
              }`}
            </Typography>
          </>
        )}
      </Card>
    ),
    consistency: () => (
      <Card variant="filled" style={cardStyle} key="consistency">
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          CONSISTENCY
        </Typography>
        <CalendarHeatmap
          values={heatmapValues}
          weeks={HEATMAP_WEEKS}
          endDate={windowEnd}
          emptyLabel={`No sessions logged in the 12 weeks to ${formatAxisDay(windowEnd)}.`}
          testID="health-activity-heatmap"
        />
        <Typography variant="caption1" color={colors.textSecondary}>
          Each square is one day of the {HEATMAP_WEEKS} weeks ending {formatAxisDay(windowEnd)},
          shaded by active minutes. An outlined square is a day with no logged session — not a day
          you did nothing.
        </Typography>
      </Card>
    ),
    byType: () => (
      <Card variant="filled" style={cardStyle} key="byType">
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          BY TYPE
        </Typography>
        {breakdown.length === 0 ? (
          <Typography
            variant="body"
            color={colors.textSecondary}
            testID="health-activity-breakdown-empty"
          >
            Nothing logged in {windowPhrase}, so there is no split to show yet.
          </Typography>
        ) : (
          breakdown.map((row) => (
            <View key={row.type} testID={`health-activity-breakdown-${row.type}`}>
              <HealthGoalBar
                label={`${workoutTypeLabel(row.type)} · ${row.sessions} ${row.sessions === 1 ? 'session' : 'sessions'}`}
                value={row.minutes}
                target={rangeSummary.minutes}
                suffix=" min"
              />
              <Typography variant="caption1" color={colors.textSecondary}>
                {Math.round(row.share * 100)}% of active minutes
                {row.calories > 0 ? ` · ${row.calories} kcal` : ''}
                {/* Only named when this type actually measured one — a "— km"
                    on every strength row would be noise. */}
                {row.distanceM !== null
                  ? ` · ${formatDistance(row.distanceM, distanceUnit)}`
                  : ''}
              </Typography>
            </View>
          ))
        )}
      </Card>
    ),
    stepsDistance: () => (
      <Card variant="filled" style={cardStyle} key="stepsDistance">
        <View style={styles.cardHead}>
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            STEPS &amp; DISTANCE
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary}>
            {stepsMetric === 'steps'
              ? `${rangeSummary.steps} steps`
              : formatDistance(rangeSummary.distanceM, distanceUnit)}
          </Typography>
        </View>
        <View style={[styles.segmented, { borderColor: colors.borderColor }]}>
          {(
            [
              { key: 'steps' as const, label: 'Steps' },
              { key: 'distance' as const, label: 'Distance' },
            ]
          ).map((option) => {
            const active = option.key === stepsMetric;
            return (
              <Pressable
                key={option.key}
                onPress={() => setStepsMetric(option.key)}
                accessibilityRole="button"
                accessibilityLabel={`Show ${option.label}`}
                accessibilityState={{ selected: active }}
                testID={`health-activity-steps-metric-${option.key}`}
                style={[styles.segment, active && { backgroundColor: colors.primary }]}
              >
                <Typography
                  variant="caption1"
                  weight="semibold"
                  color={active ? colors.white : colors.textSecondary}
                >
                  {option.label}
                </Typography>
              </Pressable>
            );
          })}
        </View>

        {stepsMetric === 'steps' ? (
          stepSeries.points.length < 2 ? (
            <Typography
              variant="body"
              color={colors.textSecondary}
              testID="health-activity-steps-empty"
            >
              {stepSeries.points.length === 0
                ? `No step counts recorded in ${windowPhrase}.`
                : 'One day of steps is not a trend yet — log another day to see the line.'}
            </Typography>
          ) : (
            <>
              <View
                accessible
                accessibilityRole="image"
                accessibilityLabel={stepsChartLabel}
                testID="health-activity-steps-chart"
              >
                <AppLineChart
                  width={chartWidth}
                  data={stepSeries.points.map((point, index) => ({
                    value: point.value,
                    label: index % stepSeries.labelStep === 0 ? formatAxisDay(point.date) : '',
                  }))}
                  referenceValue={goals.steps}
                  referenceLabel={`Goal ${goals.steps}`}
                />
              </View>
              <Typography
                variant="caption1"
                color={colors.textSecondary}
                testID="health-activity-steps-note"
              >
                {/* The chart only draws with two points or more, so this note is
                    never singular — the one-day case is the copy above. */}
                {`${stepSeries.points.length} recorded days in ${windowPhrase}, labelled by date, against your ${goals.steps}-step daily goal. Days with no count are left out rather than drawn as zero.${
                  stepSeries.labelStep > 1
                    ? ` Only every ${ordinal(stepSeries.labelStep)} label is drawn.`
                    : ''
                }`}
              </Typography>
            </>
          )
        ) : distanceBuckets.length === 0 ? (
          <Typography
            variant="body"
            color={colors.textSecondary}
            testID="health-activity-distance-empty"
          >
            {rangeSummary.workouts === 0
              ? `No sessions logged in ${windowPhrase}, so there is no distance to chart.`
              : `None of the ${rangeSummary.workouts} sessions in ${windowPhrase} recorded a distance. Runs, walks, rides and swims can carry one — the field appears on the log form for those.`}
          </Typography>
        ) : (
          <>
            <View
              accessible
              accessibilityRole="image"
              accessibilityLabel={distanceChartLabel}
              testID="health-activity-distance-chart"
            >
              <AppBarChart
                width={chartWidth}
                data={distanceBuckets.map((bucket, index) => ({
                  // Charted in the unit on screen, not in metres: a 5,000-tall
                  // bar labelled "km" would be a different claim entirely.
                  value: metresToDisplay(bucket.distanceM ?? 0, distanceUnit),
                  label: index % distanceLabelStep === 0 ? formatAxisDay(bucket.start) : '',
                }))}
                formatValue={(value) => value.toFixed(1)}
              />
            </View>
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              testID="health-activity-distance-note"
            >
              {`${volume.note} Measured in ${distanceUnit}. Only the ${distanceBuckets.length} ${
                volume.granularity === 'day' ? 'days' : 'blocks'
              } where a session recorded a distance are drawn — a session that did not measure one is left out, not counted as zero.${
                distanceLabelStep > 1
                  ? ` Only every ${ordinal(distanceLabelStep)} label is drawn.`
                  : ''
              }`}
            </Typography>
          </>
        )}
      </Card>
    ),
  };

  return (
    <HealthSectionScreen title="Activity" testID="health-activity-screen" loading={loading}>
      {/* Today against the two goals that drive the tab */}
      <Card variant="filled" style={cardStyle}>
        <View style={styles.cardHead}>
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            TODAY
          </Typography>
          <Pressable
            onPress={handleMinutesGoal}
            accessibilityRole="button"
            accessibilityLabel="Change movement goal"
            testID="health-activity-goal-button"
          >
            <Typography variant="footnote" weight="semibold" color={colors.primary}>
              Goal {goals.minutes} min
            </Typography>
          </Pressable>
        </View>
        <HealthGoalBar
          label="Active minutes"
          value={todaySummary.minutes}
          target={goals.minutes}
          suffix=" min"
          testID="health-activity-minutes-bar"
        />
        <HealthGoalBar
          label="Steps"
          value={steps}
          target={goals.steps}
          suffix=""
          testID="health-activity-steps-bar"
        />
        <View style={styles.stepRow}>
          <TextInput
            value={stepDraft}
            onChangeText={(text) => setStepDraft(sanitizeIntegerInput(text))}
            onEndEditing={(e) => void handleSaveSteps(e.nativeEvent.text)}
            onSubmitEditing={() => void handleSaveSteps()}
            onBlur={() => void handleSaveSteps()}
            placeholder="Steps today"
            placeholderTextColor={colors.textSecondary}
            keyboardType="number-pad"
            returnKeyType="done"
            accessibilityLabel="Steps today"
            testID="health-steps-input"
            style={[...inputStyle, styles.flexInput]}
          />
          <Pressable
            onPress={() => void handleSaveSteps()}
            accessibilityRole="button"
            accessibilityLabel="Save steps"
            testID="health-steps-save-button"
            style={[styles.saveButton, { backgroundColor: colors.primary }]}
          >
            <Icon name="complete" size={20} color={colors.white} />
          </Pressable>
        </View>
        <Pressable
          onPress={handleStepsGoal}
          accessibilityRole="button"
          accessibilityLabel="Change step goal"
          testID="health-activity-steps-goal-button"
        >
          <Typography variant="caption1" color={colors.primary}>
            Step goal: {goals.steps}
          </Typography>
        </Pressable>
      </Card>

      {/* Log / edit a session */}
      <Card variant="filled" style={cardStyle}>
        <View style={styles.cardHead}>
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            {editing ? 'EDIT SESSION' : 'LOG A WORKOUT'}
          </Typography>
          {editing && (
            <Pressable
              onPress={resetForm}
              accessibilityRole="button"
              accessibilityLabel="Cancel editing"
              testID="health-workout-cancel-edit"
            >
              <Typography variant="footnote" weight="semibold" color={colors.primary}>
                Cancel
              </Typography>
            </Pressable>
          )}
        </View>
        {editing && (
          <Typography
            variant="caption1"
            color={colors.textSecondary}
            testID="health-workout-edit-note"
          >
            {/* The original sentence, kept WORD FOR WORD while the date and time
                are untouched, because that is still exactly what happens. Once
                either is changed the copy has to change too: the session moves,
                and a screen that said otherwise would be lying about it. */}
            {form.date === editing.date && form.time === formatClock(editing.startedAt)
              ? `Saving updates this session on ${formatDayKey(editing.date)} in place — the same entry, at the same logged time.`
              : `Saving moves this session to ${formatDayKey(form.date)}${
                  timeValid ? ` at ${form.time}` : ''
                } — the same entry, on a new date and time.`}
          </Typography>
        )}

        {/* The chosen type, and the way into all 61 */}
        <Pressable
          onPress={() => setPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Workout type: ${workoutTypeLabel(form.type)}. Choose another`}
          testID="health-workout-type-open-picker"
          style={[styles.typeButton, { borderColor: colors.borderColor }]}
        >
          <Icon name={workoutTypeIcon(form.type)} size={22} color={colors.primary} />
          <View style={styles.entryText}>
            <Typography variant="body" weight="semibold" color={colors.textPrimary}>
              {workoutTypeLabel(form.type)}
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              {WORKOUT_CATEGORY_LABELS[workoutTypeCategory(form.type)]}
            </Typography>
          </View>
          <Typography variant="footnote" weight="semibold" color={colors.primary}>
            Change
          </Typography>
        </Pressable>

        {/*
          The seven types this app has always offered, kept as a one-tap row.
          The other 54 live behind the picker above: putting all 61 here would
          bury the four or five anyone actually uses under a wall of chips.
        */}
        <View style={styles.typeGrid}>
          {QUICK_WORKOUT_TYPES.map((option) => {
            const active = option === form.type;
            return (
              <Pressable
                key={option}
                onPress={() => setField('type', option)}
                accessibilityRole="button"
                accessibilityLabel={`Workout type ${workoutTypeLabel(option)}`}
                accessibilityState={{ selected: active }}
                testID={`health-workout-type-${option}`}
                style={[
                  styles.typeChip,
                  {
                    borderColor: active ? colors.primary : colors.borderColor,
                    backgroundColor: active ? colors.primary : 'transparent',
                  },
                ]}
              >
                <Icon
                  name={workoutTypeIcon(option)}
                  size={14}
                  color={active ? colors.white : colors.textSecondary}
                />
                <Typography
                  variant="caption1"
                  weight="semibold"
                  color={active ? colors.white : colors.textSecondary}
                >
                  {workoutTypeLabel(option)}
                </Typography>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.typeGrid}>
          {WORKOUT_INTENSITIES.map((option) => {
            const active = option === form.intensity;
            return (
              <Pressable
                key={option}
                onPress={() => setField('intensity', option)}
                accessibilityRole="button"
                accessibilityLabel={`Intensity ${WORKOUT_INTENSITY_LABELS[option]}`}
                accessibilityState={{ selected: active }}
                testID={`health-workout-intensity-${option}`}
                style={[
                  styles.typeChip,
                  {
                    borderColor: active ? colors.primary : colors.borderColor,
                    backgroundColor: active ? colors.primary : 'transparent',
                  },
                ]}
              >
                <Typography
                  variant="caption1"
                  weight="semibold"
                  color={active ? colors.white : colors.textSecondary}
                >
                  {WORKOUT_INTENSITY_LABELS[option]}
                </Typography>
              </Pressable>
            );
          })}
        </View>

        {/*
          WHEN it happened. A new session used to be stamped "now", so a run
          logged on the bus home landed on the wrong hour and one remembered the
          next morning landed on the wrong DAY. Both fields are typed, matching
          the Weight tab's back-dating field rather than introducing a second
          date-entry idiom into the same feature, and both refuse bad input in
          words instead of silently correcting it.
        */}
        <View style={styles.amountRow}>
          <TextInput
            value={form.date}
            onChangeText={(text) => setField('date', maskDayKeyInput(text))}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            returnKeyType="done"
            accessibilityLabel="Workout date"
            testID="health-workout-date-input"
            style={[
              ...inputStyle,
              styles.flexInput,
              {
                color: dateValid ? colors.textPrimary : colors.error,
                borderColor: dateValid ? colors.borderColor : colors.error,
              },
            ]}
          />
          <TextInput
            value={form.time}
            onChangeText={(text) => setField('time', maskClockInput(text))}
            placeholder="HH:MM"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            returnKeyType="done"
            accessibilityLabel="Workout time"
            testID="health-workout-time-input"
            style={[
              ...inputStyle,
              styles.flexInput,
              {
                color: timeValid ? colors.textPrimary : colors.error,
                borderColor: timeValid ? colors.borderColor : colors.error,
              },
            ]}
          />
        </View>
        <View style={styles.typeGrid}>
          {[
            { label: 'Today', date: today },
            { label: 'Yesterday', date: shiftDateKey(today, -1) },
          ].map((option) => (
            <Pressable
              key={option.label}
              onPress={() => setField('date', option.date)}
              accessibilityRole="button"
              accessibilityLabel={`Set the date to ${option.label}`}
              accessibilityState={{ selected: form.date === option.date }}
              testID={`health-workout-date-${option.label.toLowerCase()}`}
              style={[styles.typeChip, { borderColor: colors.borderColor }]}
            >
              <Typography variant="caption1" weight="semibold" color={colors.textSecondary}>
                {option.label}
              </Typography>
            </Pressable>
          ))}
          <Pressable
            onPress={() => setField('time', formatClock(new Date().toISOString()))}
            accessibilityRole="button"
            accessibilityLabel="Set the time to now"
            testID="health-workout-time-now"
            style={[styles.typeChip, { borderColor: colors.borderColor }]}
          >
            <Typography variant="caption1" weight="semibold" color={colors.textSecondary}>
              Now
            </Typography>
          </Pressable>
        </View>
        {dateValid && timeValid ? null : (
          <Typography
            variant="caption1"
            color={colors.error}
            testID="health-workout-datetime-error"
          >
            {!dateValid
              ? 'Use YYYY-MM-DD, and a day that has already happened — a workout cannot be in the future.'
              : 'Use a 24-hour time like 07:30.'}
          </Typography>
        )}

        <View style={styles.amountRow}>
          <TextInput
            value={form.minutes}
            onChangeText={(text) => setField('minutes', sanitizeIntegerInput(text))}
            placeholder="Minutes"
            placeholderTextColor={colors.textSecondary}
            keyboardType="number-pad"
            returnKeyType="done"
            accessibilityLabel="Minutes"
            testID="health-workout-minutes-input"
            style={[...inputStyle, styles.flexInput]}
          />
          <TextInput
            value={form.calories}
            onChangeText={(text) => setField('calories', sanitizeIntegerInput(text))}
            placeholder="kcal (optional)"
            placeholderTextColor={colors.textSecondary}
            keyboardType="number-pad"
            returnKeyType="done"
            accessibilityLabel="Burned calories"
            testID="health-workout-calories-input"
            style={[...inputStyle, styles.flexInput]}
          />
        </View>

        {/*
          Distance is offered for the 14 types the donor says measure one
          (`WorkoutType.supportsDistance`), and only those. Asking a yoga class
          how far it went is noise, and a figure stored against one would be
          added into every weekly total that follows.
        */}
        {supportsDistance && (
          <>
            <TextInput
              value={form.distance}
              onChangeText={(text) => setField('distance', sanitizeDecimalInput(text))}
              placeholder={`Distance in ${distanceUnit} (optional)`}
              placeholderTextColor={colors.textSecondary}
              keyboardType="decimal-pad"
              returnKeyType="done"
              accessibilityLabel={`Distance in ${distanceUnit}`}
              testID="health-workout-distance-input"
              style={[
                ...inputStyle,
                {
                  color: distanceValid ? colors.textPrimary : colors.error,
                  borderColor: distanceValid ? colors.borderColor : colors.error,
                },
              ]}
            />
            <Typography
              variant="caption1"
              color={distanceValid ? colors.textSecondary : colors.error}
              testID="health-workout-distance-note"
            >
              {distanceValid
                ? 'Leaving this blank records no distance at all — it is not counted as zero anywhere.'
                : 'That is further than one session covers. Leave it blank if you did not measure it.'}
            </Typography>
          </>
        )}

        <TextInput
          value={form.note}
          onChangeText={(text) => setField('note', text)}
          placeholder="Note (optional)"
          placeholderTextColor={colors.textSecondary}
          accessibilityLabel="Workout note"
          testID="health-workout-note-input"
          style={inputStyle}
        />

        <Pressable
          onPress={() => void handleLog()}
          disabled={!canLog}
          accessibilityRole="button"
          accessibilityLabel={editing ? 'Save session' : 'Log workout'}
          accessibilityState={{ disabled: !canLog }}
          testID="health-workout-add-button"
          style={[styles.addButton, { backgroundColor: canLog ? colors.primary : colors.borderColor }]}
        >
          <Icon name={editing ? 'complete' : 'add'} size={18} color={colors.white} />
          <Typography variant="body" weight="semibold" color={colors.white}>
            {editing ? 'Save session' : `Log ${workoutTypeLabel(form.type)}`}
          </Typography>
        </Pressable>
      </Card>

      {/* Range picker — everything below follows it */}
      <Card variant="filled" style={cardStyle}>
        <View style={styles.cardHead}>
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            {windowLabel.toUpperCase()}
          </Typography>
          {/*
            Walk whole windows backwards. Every range on this screen used to end
            today, so an unusually good March was simply unreachable — the same
            gap the Weight tab closed with the same two controls.
          */}
          <View style={styles.stepRow}>
            <Pressable
              onPress={() => setWindowsBack((n) => n + 1)}
              accessibilityRole="button"
              accessibilityLabel={`Show the previous ${rangeLabel}`}
              testID="health-activity-window-previous"
              hitSlop={8}
            >
              <Typography variant="body" weight="semibold" color={colors.primary}>
                ◀
              </Typography>
            </Pressable>
            <Pressable
              onPress={() => setWindowsBack((n) => Math.max(0, n - 1))}
              disabled={windowsBack === 0}
              accessibilityRole="button"
              accessibilityLabel={`Show the next ${rangeLabel}`}
              accessibilityState={{ disabled: windowsBack === 0 }}
              testID="health-activity-window-next"
              hitSlop={8}
            >
              <Typography
                variant="body"
                weight="semibold"
                color={windowsBack === 0 ? colors.borderColor : colors.primary}
              >
                ▶
              </Typography>
            </Pressable>
          </View>
        </View>
        <View style={[styles.segmented, { borderColor: colors.borderColor }]}>
          {RANGES.map((option) => {
            const active = option === range;
            return (
              <Pressable
                key={option.days}
                onPress={() => {
                  setRange(option);
                  // Windows are measured in the OLD width, so keeping the offset
                  // would land the reader on an arbitrary stretch of time.
                  setWindowsBack(0);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Show the last ${option.label}`}
                accessibilityState={{ selected: active }}
                testID={`health-activity-range-${option.days}`}
                style={[styles.segment, active && { backgroundColor: colors.primary }]}
              >
                <Typography
                  variant="caption1"
                  weight="semibold"
                  color={active ? colors.white : colors.textSecondary}
                >
                  {option.label}
                </Typography>
              </Pressable>
            );
          })}
        </View>
        {/*
          The donor's four-tile week summary, all four tiles. Distance was the
          missing one, because distance was not a field.
        */}
        <HealthStatTiles
          stats={[
            {
              label: 'Workouts',
              value: String(rangeSummary.workouts),
              icon: 'workouts',
              color: colors.success,
              testID: 'health-activity-week-workouts',
            },
            {
              label: 'Active time',
              value: formatDuration(rangeSummary.minutes),
              icon: 'timer',
              color: colors.info,
              testID: 'health-activity-week-minutes',
            },
            {
              label: 'Burned',
              value: `${rangeSummary.calories} kcal`,
              icon: 'energy-burned',
              color: colors.warning,
              testID: 'health-activity-week-calories',
            },
            {
              label: 'Distance',
              // "—" rather than "0 km": no session in this window measured one,
              // and claiming zero would be a reading nobody took.
              value: formatDistance(rangeSummary.distanceM, distanceUnit),
              icon: 'distance',
              color: colors.primary,
              testID: 'health-activity-week-distance',
            },
          ]}
        />
        {rangeSummary.distanceM !== null &&
          rangeSummary.distanceSessions < rangeSummary.workouts && (
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              testID="health-activity-week-distance-note"
            >
              {`Distance covers the ${rangeSummary.distanceSessions} of ${rangeSummary.workouts} sessions that recorded one.`}
            </Typography>
          )}
        <HealthStatTiles
          stats={[
            {
              label: 'Current streak',
              value: streaks.current === 0 ? 'None' : `${streaks.current} d`,
              icon: 'streak',
              color: colors.success,
              testID: 'health-activity-streak-current',
            },
            {
              label: 'Longest streak',
              value: streaks.longest === 0 ? 'None' : `${streaks.longest} d`,
              icon: 'goals',
              color: colors.accent,
              testID: 'health-activity-streak-longest',
            },
            {
              label: 'Steps',
              value: String(rangeSummary.steps),
              icon: 'steps',
              color: colors.info,
              testID: 'health-activity-range-steps',
            },
          ]}
        />
        <Typography
          variant="caption1"
          color={colors.textSecondary}
          testID="health-activity-streak-note"
        >
          {streaks.lastActiveDate === null
            ? 'Streaks start once you log your first session.'
            : `Streaks count consecutive days with a logged session, over your whole history. Last session: ${formatDayKey(streaks.lastActiveDate)}.`}
        </Typography>
      </Card>

      {/* The chart cards below, in the member's own order */}
      {activityLayout.widgets
        .filter((key): key is ActivityWidgetKey =>
          (ACTIVITY_WIDGET_KEYS as readonly string[]).includes(key),
        )
        .map((key) => ACTIVITY_RENDERERS[key]())}

      {/* History */}
      <Card variant="filled" style={cardStyle}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          SESSIONS
        </Typography>
        {dayGroups.length === 0 ? (
          <Typography variant="body" color={colors.textSecondary} testID="health-activity-empty">
            {workouts.length === 0
              ? 'No workouts yet. Log your first session above.'
              : `Nothing logged in ${windowPhrase}. Your ${workouts.length} earlier ${workouts.length === 1 ? 'session is' : 'sessions are'} still there — widen the range, or step back with ◀.`}
          </Typography>
        ) : (
          dayGroups.map((group) => (
            <View key={group.date} testID={`health-activity-day-${group.date}`}>
              <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
                {group.label}
              </Typography>
              {group.entries.map((entry) => {
                const tint = workoutCategoryColor(entry.type);
                return (
                  <Pressable
                    key={entry.id}
                    onPress={() => setSelectedWorkoutId(entry.id)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      `${workoutTypeLabel(entry.type)} workout, ${formatDuration(entry.minutes)}` +
                      (entry.calories > 0 ? `, ${entry.calories} kcal` : '') +
                      (entry.distanceM !== null
                        ? `, ${formatDistance(entry.distanceM, distanceUnit)}`
                        : '') +
                      '. View details'
                    }
                    testID={`health-workout-row-${entry.id}`}
                    style={[styles.sessionRow, { borderTopColor: colors.borderColor }]}
                  >
                    <View style={[styles.sessionIconBadge, { backgroundColor: hexToRgba(tint, 0.14) }]}>
                      <Icon name={workoutTypeIcon(entry.type)} size={20} color={tint} />
                    </View>
                    <View style={styles.entryText}>
                      <Typography variant="body" weight="semibold" color={colors.textPrimary}>
                        {workoutTypeLabel(entry.type)}
                      </Typography>
                      {/* Duration / calories / distance as icon+value chips,
                          rather than packed into one text line — the donor's
                          `WorkoutCardView.statsRow`. Calories and distance only
                          appear when the session actually recorded one. */}
                      <View style={styles.sessionChipsRow}>
                        <View style={styles.sessionChip}>
                          <Icon name="timer" size={12} color={colors.textSecondary} />
                          <Typography variant="caption1" color={colors.textSecondary}>
                            {formatDuration(entry.minutes)}
                          </Typography>
                        </View>
                        {entry.calories > 0 && (
                          <View style={styles.sessionChip}>
                            <Icon name="energy-burned" size={12} color={colors.warning} />
                            <Typography variant="caption1" color={colors.warning}>
                              {entry.calories}
                            </Typography>
                          </View>
                        )}
                        {entry.distanceM !== null && (
                          <View style={styles.sessionChip}>
                            <Icon name="distance" size={12} color={colors.primary} />
                            <Typography variant="caption1" color={colors.primary}>
                              {formatDistance(entry.distanceM, distanceUnit)}
                            </Typography>
                          </View>
                        )}
                      </View>
                      <Typography variant="caption1" color={colors.textSecondary}>
                        {/* The DAY, then the clock time the session happened at.
                            A session logged before the form had a time field has
                            no `startedAt`, so it shows the day alone rather than
                            the hour it was typed, which was never its hour. */}
                        {formatLoggedAt(entry.startedAt ?? entry.loggedAt)}
                        {entry.startedAt ? ` · ${formatClock(entry.startedAt)}` : ''}
                        {/* The default reads as "not recorded", so naming it
                            would put a label on every row that says nothing. */}
                        {entry.intensity !== DEFAULT_INTENSITY
                          ? ` · ${WORKOUT_INTENSITY_LABELS[entry.intensity]}`
                          : ''}
                      </Typography>
                      {entry.note.length > 0 && (
                        <Typography variant="caption1" color={colors.textSecondary}>
                          {entry.note}
                        </Typography>
                      )}
                    </View>
                    <Icon name="chevron-forward" size={16} color={colors.textSecondary} />
                  </Pressable>
                );
              })}
            </View>
          ))
        )}
      </Card>

      {/*
        Last in the stack, not next to the button that opens it: the sheet is a
        `Modal`, which renders nothing at all while closed, and keeping it out
        of the middle of the card list keeps the scroll order obvious.
      */}
      <HealthWorkoutTypePicker
        visible={pickerOpen}
        selected={form.type}
        recent={recentTypes}
        onSelect={(type) => setField('type', type)}
        onClose={() => setPickerOpen(false)}
      />

      {selectedWorkoutEntry && (
        <HealthWorkoutSessionDetail
          entry={selectedWorkoutEntry}
          distanceUnit={distanceUnit}
          onClose={() => setSelectedWorkoutId(null)}
          onEdit={(entry) => {
            setSelectedWorkoutId(null);
            handleEdit(entry);
          }}
          onDelete={(id) => {
            setSelectedWorkoutId(null);
            void handleDelete(id);
          }}
        />
      )}
    </HealthSectionScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.base,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
  },
  flexInput: {
    flex: 1,
  },
  saveButton: {
    width: 44,
    height: 44,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmented: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
  },
  typeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
  },
  amountRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    height: 46,
    borderRadius: CornerRadius.sm,
  },
  entryText: {
    flex: 1,
    gap: 2,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.md,
  },
  sessionIconBadge: {
    width: 44,
    height: 44,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  sessionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
});
