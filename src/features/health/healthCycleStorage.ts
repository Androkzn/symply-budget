import { healthApi } from '@api/health';

import { dateKeyOf, todayDateKey } from './healthLocalStorage';
import { shiftDateKey } from './healthNutritionStorage';
import { readThrough, writeThrough } from './healthRepository';

/**
 * Symply Health — Women's Health / cycle tracking (donor `WomensHealthView`).
 *
 * Ported from the donor's `WomensHealthModels.swift`: cycle settings, period
 * entries with a flow level, and a daily symptom/mood/energy log, plus the
 * derived phase, next-period and fertile-window predictions.
 *
 * Backed by `/health/cycle/*` (parity P1) — the donor's `cycle_settings`,
 * `period_entries` and `cycle_symptom_entries` tables in Health's OWN isolated
 * D1.
 *
 * This is the most sensitive data in the app, so the rules are stricter than
 * elsewhere: user-scoped only (never household), never shared with another
 * Symply app, never sent to an AI provider, and excluded from glance surfaces
 * by default. Predictions are calendar arithmetic — wellness estimates, not
 * contraception or medical advice (BRD positioning: no clinical claims).
 */

export const HEALTH_CYCLE_SETTINGS_KEY = 'health.cycleSettings.v1';
export const HEALTH_CYCLE_PERIODS_KEY = 'health.cyclePeriods.v1';
export const HEALTH_CYCLE_SYMPTOMS_KEY = 'health.cycleSymptoms.v1';

/* ------------------------------------------------------------------ */
/* Enums — mirrored from the donor's WomensHealthModels.swift          */
/* ------------------------------------------------------------------ */

export const CYCLE_PHASES = ['menstrual', 'follicular', 'ovulation', 'luteal'] as const;
export type CyclePhase = (typeof CYCLE_PHASES)[number];

export const CYCLE_PHASE_LABELS: Record<CyclePhase, string> = {
  menstrual: 'Period',
  follicular: 'Follicular',
  ovulation: 'Ovulation',
  luteal: 'Luteal',
};

/** Donor phase copy — informational, deliberately non-clinical. */
export const CYCLE_PHASE_DESCRIPTIONS: Record<CyclePhase, string> = {
  menstrual: 'Your body is shedding the uterine lining. Rest and self-care are important.',
  follicular: 'Estrogen rises, boosting energy and mood. A good time for new projects.',
  ovulation: 'Peak fertility window. Energy and confidence are typically highest.',
  luteal: 'Progesterone rises. You may feel more introspective and need rest.',
};

export const CYCLE_PHASE_ICONS: Record<CyclePhase, string> = {
  menstrual: 'cycle',
  follicular: 'energy-active',
  ovulation: 'sparkles',
  luteal: 'sleep',
};

export const FLOW_LEVELS = ['spotting', 'light', 'medium', 'heavy', 'veryHeavy'] as const;
export type FlowLevel = (typeof FLOW_LEVELS)[number];

export const FLOW_LABELS: Record<FlowLevel, string> = {
  spotting: 'Spotting',
  light: 'Light',
  medium: 'Medium',
  heavy: 'Heavy',
  veryHeavy: 'Very heavy',
};

export const CYCLE_SYMPTOMS = [
  'cramps',
  'headache',
  'bloating',
  'breastTenderness',
  'backPain',
  'acne',
  'nausea',
  'anxiety',
  'irritability',
  'sadness',
] as const;
export type CycleSymptom = (typeof CYCLE_SYMPTOMS)[number];

export const CYCLE_SYMPTOM_LABELS: Record<CycleSymptom, string> = {
  cramps: 'Cramps',
  headache: 'Headache',
  bloating: 'Bloating',
  breastTenderness: 'Breast tenderness',
  backPain: 'Back pain',
  acne: 'Acne',
  nausea: 'Nausea',
  anxiety: 'Anxiety',
  irritability: 'Irritability',
  sadness: 'Sadness',
};

export type SymptomCategory = 'physical' | 'emotional';

/** Screen symptom key → donor column name (snake_case in D1). */
export const SYMPTOM_COLUMN: Record<CycleSymptom, string> = {
  cramps: 'cramps',
  headache: 'headache',
  bloating: 'bloating',
  breastTenderness: 'breast_tenderness',
  backPain: 'back_pain',
  acne: 'acne',
  nausea: 'nausea',
  anxiety: 'anxiety',
  irritability: 'irritability',
  sadness: 'sadness',
};

/** Donor split: the last three are emotional, the rest physical. */
export const CYCLE_SYMPTOM_CATEGORY: Record<CycleSymptom, SymptomCategory> = {
  cramps: 'physical',
  headache: 'physical',
  bloating: 'physical',
  breastTenderness: 'physical',
  backPain: 'physical',
  acne: 'physical',
  nausea: 'physical',
  anxiety: 'emotional',
  irritability: 'emotional',
  sadness: 'emotional',
};

/** 0 = not present; the screen only stores 1–3. */
export const SYMPTOM_SEVERITIES = [0, 1, 2, 3] as const;
export type SymptomSeverity = (typeof SYMPTOM_SEVERITIES)[number];

export const SEVERITY_LABELS: Record<SymptomSeverity, string> = {
  0: 'None',
  1: 'Mild',
  2: 'Moderate',
  3: 'Severe',
};

export const CRAVINGS = ['none', 'sweet', 'salty', 'chocolate', 'carbs', 'spicy'] as const;
export type Craving = (typeof CRAVINGS)[number];

export const CRAVING_LABELS: Record<Craving, string> = {
  none: 'None',
  sweet: 'Sweet',
  salty: 'Salty',
  chocolate: 'Chocolate',
  carbs: 'Carbs',
  spicy: 'Spicy',
};

/** 1–5 scales, donor labels. Index 0 is unused so the level IS the index. */
export const MOOD_LABELS = ['', 'Very bad', 'Bad', 'Neutral', 'Good', 'Very good'] as const;
export const MOOD_EMOJI = ['', '😢', '😕', '😐', '🙂', '😊'] as const;
export const ENERGY_LABELS = ['', 'Exhausted', 'Tired', 'Normal', 'Energetic', 'Very energetic'] as const;
/**
 * Donor `DetailedSymptomLogSheet.sleepQuality` — a 1–5 self-report that the
 * `cycle_symptom_entries.sleep_quality` column has always accepted and that no
 * client ever wrote. Descriptive words only: this records how the night FELT,
 * it does not grade the sleep.
 */
export const SLEEP_QUALITY_LABELS = ['', 'Very poor', 'Poor', 'OK', 'Good', 'Very good'] as const;

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

export interface CycleSettings {
  /** Average days from one period start to the next. */
  cycleLength: number;
  /** Average bleeding days. */
  periodLength: number;
  /** YYYY-MM-DD of the most recent period start, or null before the first log. */
  lastPeriodStart: string | null;
}

export const DEFAULT_CYCLE_SETTINGS: CycleSettings = {
  cycleLength: 28,
  periodLength: 5,
  lastPeriodStart: null,
};

export interface PeriodEntry {
  id: string;
  date: string; // YYYY-MM-DD (local)
  flow: FlowLevel;
  notes: string;
  loggedAt: string;
}

export interface CycleSymptomEntry {
  id: string;
  date: string; // YYYY-MM-DD (local) — one entry per day
  mood: number | null; // 1–5
  energy: number | null; // 1–5
  /** Donor `sleepQuality`, 1–5. Null until the day is rated. */
  sleepQuality: number | null;
  symptoms: Partial<Record<CycleSymptom, SymptomSeverity>>;
  craving: Craving;
  notes: string;
  loggedAt: string;
}

/**
 * True when the day carries anything the person actually entered.
 *
 * The calendar marks a day as "logged" from this, so it must not count a row
 * that exists only because an empty entry was written — an entry with no mood,
 * no energy, no sleep rating, no symptom, no craving and no note is not a log.
 */
export function hasSymptomContent(entry: CycleSymptomEntry | null | undefined): boolean {
  if (!entry) return false;
  return (
    entry.mood !== null ||
    entry.energy !== null ||
    entry.sleepQuality !== null ||
    entry.craving !== 'none' ||
    entry.notes.trim().length > 0 ||
    Object.values(entry.symptoms).some((severity) => (severity ?? 0) > 0)
  );
}

const MAX_PERIOD_ENTRIES = 400;
const MAX_SYMPTOM_ENTRIES = 400;
const MIN_CYCLE_LENGTH = 20;
const MAX_CYCLE_LENGTH = 45;
const MIN_PERIOD_LENGTH = 1;
const MAX_PERIOD_LENGTH = 14;
const MAX_NOTE_LENGTH = 200;

export function isCyclePhase(value: string): value is CyclePhase {
  return (CYCLE_PHASES as readonly string[]).includes(value);
}

export function isFlowLevel(value: string): value is FlowLevel {
  return (FLOW_LEVELS as readonly string[]).includes(value);
}

export function isCycleSymptom(value: string): value is CycleSymptom {
  return (CYCLE_SYMPTOMS as readonly string[]).includes(value);
}

export function clampCycleLength(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_CYCLE_SETTINGS.cycleLength;
  return Math.max(MIN_CYCLE_LENGTH, Math.min(MAX_CYCLE_LENGTH, Math.round(n)));
}

export function clampPeriodLength(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_CYCLE_SETTINGS.periodLength;
  return Math.max(MIN_PERIOD_LENGTH, Math.min(MAX_PERIOD_LENGTH, Math.round(n)));
}

/* ------------------------------------------------------------------ */
/* Pure cycle math                                                     */
/* ------------------------------------------------------------------ */

/** Whole days between two YYYY-MM-DD keys (b − a). Negative if b precedes a. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const start = new Date(ay, (am ?? 1) - 1, ad ?? 1);
  const end = new Date(by, (bm ?? 1) - 1, bd ?? 1);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

/**
 * Cycle day (1-based) on a date, wrapping by `cycleLength`.
 *
 * Returns null before the first period is logged — the screen must say "log a
 * period to see your cycle" rather than invent day 1.
 */
export function cycleDayOn(date: string, settings: CycleSettings): number | null {
  if (!settings.lastPeriodStart) return null;
  const elapsed = daysBetween(settings.lastPeriodStart, date);
  const length = clampCycleLength(settings.cycleLength);
  // Wrap in both directions so a date before the anchor still lands in-range.
  const wrapped = ((elapsed % length) + length) % length;
  return wrapped + 1;
}

/**
 * Phase for a cycle day, using the donor's boundaries:
 * period → follicular → a 3-day ovulation window centred on cycleLength − 14
 * → luteal.
 */
export function phaseForCycleDay(day: number, settings: CycleSettings): CyclePhase {
  const length = clampCycleLength(settings.cycleLength);
  const period = clampPeriodLength(settings.periodLength);
  if (day <= period) return 'menstrual';
  const ovulationDay = length - 14;
  if (day >= ovulationDay - 1 && day <= ovulationDay + 1) return 'ovulation';
  if (day < ovulationDay - 1) return 'follicular';
  return 'luteal';
}

export function phaseOn(date: string, settings: CycleSettings): CyclePhase | null {
  const day = cycleDayOn(date, settings);
  return day === null ? null : phaseForCycleDay(day, settings);
}

export interface CyclePrediction {
  nextPeriodStart: string | null;
  ovulationDate: string | null;
  fertileWindowStart: string | null;
  fertileWindowEnd: string | null;
  daysUntilNextPeriod: number | null;
}

/**
 * Forward predictions from the anchor date.
 *
 * The fertile window is the donor's 6-day span ending the day after ovulation.
 * These are estimates from your own logged dates — never presented as medical
 * or contraceptive guidance.
 */
export function predictCycle(
  settings: CycleSettings,
  today = todayDateKey(),
): CyclePrediction {
  if (!settings.lastPeriodStart) {
    return {
      nextPeriodStart: null,
      ovulationDate: null,
      fertileWindowStart: null,
      fertileWindowEnd: null,
      daysUntilNextPeriod: null,
    };
  }
  const length = clampCycleLength(settings.cycleLength);

  // Roll forward past any cycles that have already completed, so a stale anchor
  // still predicts the NEXT period rather than one in the past.
  let start = settings.lastPeriodStart;
  let guard = 0;
  while (daysBetween(start, today) >= length && guard < 200) {
    start = shiftDateKey(start, length);
    guard += 1;
  }

  const nextPeriodStart = shiftDateKey(start, length);
  const ovulationDate = shiftDateKey(start, length - 14);
  return {
    nextPeriodStart,
    ovulationDate,
    fertileWindowStart: shiftDateKey(ovulationDate, -4),
    fertileWindowEnd: shiftDateKey(ovulationDate, 1),
    daysUntilNextPeriod: daysBetween(today, nextPeriodStart),
  };
}

/**
 * Observed average cycle length from consecutive period STARTS.
 *
 * A period start is the first logged day of a run — consecutive logged days are
 * one period, not several. Returns null until two starts exist.
 */
export function periodStarts(entries: PeriodEntry[]): string[] {
  const days = [...new Set(entries.map((e) => e.date))].sort();
  const starts: string[] = [];
  for (const day of days) {
    const previous = shiftDateKey(day, -1);
    if (!days.includes(previous)) starts.push(day);
  }
  return starts;
}

export function averageCycleLength(entries: PeriodEntry[]): number | null {
  const starts = periodStarts(entries);
  if (starts.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < starts.length; i += 1) {
    gaps.push(daysBetween(starts[i - 1], starts[i]));
  }
  const usable = gaps.filter((g) => g >= MIN_CYCLE_LENGTH && g <= MAX_CYCLE_LENGTH);
  if (usable.length === 0) return null;
  return Math.round(usable.reduce((s, g) => s + g, 0) / usable.length);
}

/** Average bleeding days per period run. Null until one full run is logged. */
export function averagePeriodLength(entries: PeriodEntry[]): number | null {
  const days = [...new Set(entries.map((e) => e.date))].sort();
  if (days.length === 0) return null;
  const runs: number[] = [];
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    if (daysBetween(days[i - 1], days[i]) === 1) {
      run += 1;
    } else {
      runs.push(run);
      run = 1;
    }
  }
  runs.push(run);
  return Math.round(runs.reduce((s, r) => s + r, 0) / runs.length);
}

/** Most-logged symptoms, most frequent first. */
export function commonSymptoms(
  entries: CycleSymptomEntry[],
  limit = 3,
): Array<{ symptom: CycleSymptom; count: number }> {
  const counts = new Map<CycleSymptom, number>();
  for (const entry of entries) {
    for (const [symptom, severity] of Object.entries(entry.symptoms)) {
      if (!isCycleSymptom(symptom) || !severity) continue;
      counts.set(symptom, (counts.get(symptom) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([symptom, count]) => ({ symptom, count }))
    .sort((a, b) => b.count - a.count || a.symptom.localeCompare(b.symptom))
    .slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Calendar marks                                                      */
/* ------------------------------------------------------------------ */

/**
 * What the month calendar can say about a single day.
 *
 * The split that matters is `period` vs `predictedPeriod`. The donor draws both
 * the same pink circle: its `isPeriodDay(_:)` is pure arithmetic off the anchor
 * date, so a day the person never logged is painted identically to one they
 * did. On a cycle calendar that is the difference between a record and a guess,
 * and the guess is the one that gets read as "my period was on the 8th".
 *
 * So: a LOGGED bleeding day is a solid mark, everything derived is an outline,
 * and the legend names both. `fertile` and `ovulation` are always estimates —
 * there is nothing to log against them — which is why they carry the estimate
 * treatment unconditionally.
 */
export const CYCLE_DAY_MARKS = ['period', 'predictedPeriod', 'ovulation', 'fertile'] as const;
export type CycleDayMark = (typeof CYCLE_DAY_MARKS)[number];

export const CYCLE_DAY_MARK_LABELS: Record<CycleDayMark, string> = {
  period: 'Period logged',
  predictedPeriod: 'Period expected',
  ovulation: 'Ovulation estimate',
  fertile: 'Fertile window estimate',
};

export interface CycleCalendarDay {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Day of month, 1–31. */
  day: number;
  /** False for the padding days borrowed from the neighbouring months. */
  inMonth: boolean;
  /** Strongest mark for the day, or null when the day carries none. */
  mark: CycleDayMark | null;
  /** Flow level, present only on a day that was actually logged. */
  flow: FlowLevel | null;
  /** True when a symptom / mood / energy / sleep / note entry exists. */
  hasSymptomLog: boolean;
}

/**
 * Classify one day.
 *
 * A logged bleeding day always wins: predictions never overwrite a fact. Days
 * before the anchor get no prediction at all — the arithmetic has nothing to
 * run on, and back-filling a "your period was probably here" onto a month the
 * person had not started tracking would be inventing history.
 */
export function cycleDayMark(
  date: string,
  settings: CycleSettings,
  loggedDates: ReadonlySet<string>
): CycleDayMark | null {
  if (loggedDates.has(date)) return 'period';
  if (!settings.lastPeriodStart) return null;

  const elapsed = daysBetween(settings.lastPeriodStart, date);
  if (elapsed < 0) return null;

  const length = clampCycleLength(settings.cycleLength);
  const period = clampPeriodLength(settings.periodLength);
  // 0-based position in the cycle, so day 0 is the anchor itself.
  const position = elapsed % length;
  if (position < period) return 'predictedPeriod';

  const ovulation = length - 14;
  if (position === ovulation) return 'ovulation';
  if (position >= ovulation - 4 && position <= ovulation + 1) return 'fertile';
  return null;
}

/**
 * Decorate a month grid with cycle marks.
 *
 * `rows` comes from the shared `heatmapMonthGrid` primitive, so the month
 * calendar and the week-column consistency grids share ONE Monday-first week
 * rule rather than two implementations that can drift apart.
 */
export function cycleCalendarDays(
  rows: ReadonlyArray<ReadonlyArray<{ date: string; day: number; inMonth: boolean }>>,
  settings: CycleSettings,
  periods: readonly PeriodEntry[],
  symptoms: readonly CycleSymptomEntry[]
): CycleCalendarDay[][] {
  const flowByDate = new Map(periods.map((entry) => [entry.date, entry.flow] as const));
  const loggedDates = new Set(flowByDate.keys());
  const symptomDates = new Set(
    symptoms.filter(hasSymptomContent).map((entry) => entry.date)
  );

  return rows.map((row) =>
    row.map((cell) => ({
      date: cell.date,
      day: cell.day,
      inMonth: cell.inMonth,
      mark: cycleDayMark(cell.date, settings, loggedDates),
      flow: flowByDate.get(cell.date) ?? null,
      hasSymptomLog: symptomDates.has(cell.date),
    }))
  );
}

/** How many days of a month the calendar actually has something to say about. */
export function countCycleMarks(days: CycleCalendarDay[][]): Record<CycleDayMark, number> {
  const counts: Record<CycleDayMark, number> = {
    period: 0,
    predictedPeriod: 0,
    ovulation: 0,
    fertile: 0,
  };
  for (const row of days) {
    for (const cell of row) {
      if (cell.inMonth && cell.mark) counts[cell.mark] += 1;
    }
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* Insights                                                            */
/* ------------------------------------------------------------------ */

export interface CycleUpcomingEvent {
  key: 'nextPeriod' | 'ovulation' | 'fertileWindow';
  label: string;
  date: string;
  /** Whole days from today; negative once the estimate has passed. */
  daysAway: number;
  icon: string;
}

/**
 * The donor's insights sheet, reduced to the three dates its arithmetic can
 * actually produce. Empty until a period is logged — a cycle calendar with no
 * anchor has nothing to forecast, and the screen says so in a sentence rather
 * than rendering three em-dashes.
 */
export function upcomingCycleEvents(
  settings: CycleSettings,
  today = todayDateKey()
): CycleUpcomingEvent[] {
  const prediction = predictCycle(settings, today);
  if (!prediction.nextPeriodStart || !prediction.ovulationDate) return [];

  const events: CycleUpcomingEvent[] = [
    {
      key: 'fertileWindow',
      label: 'Fertile window opens',
      date: prediction.fertileWindowStart ?? prediction.ovulationDate,
      daysAway: 0,
      icon: 'insights',
    },
    {
      key: 'ovulation',
      label: 'Ovulation estimate',
      date: prediction.ovulationDate,
      daysAway: 0,
      icon: 'cycle',
    },
    {
      key: 'nextPeriod',
      label: 'Next period',
      date: prediction.nextPeriodStart,
      daysAway: 0,
      icon: 'hydration',
    },
  ];

  return events
    .map((event) => ({ ...event, daysAway: daysBetween(today, event.date) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** "Today" / "Tomorrow" / "in 6 days" / "5 days ago" for an event date. */
export function relativeDayLabel(daysAway: number): string {
  if (daysAway === 0) return 'Today';
  if (daysAway === 1) return 'Tomorrow';
  if (daysAway === -1) return 'Yesterday';
  return daysAway > 0 ? `in ${daysAway} days` : `${-daysAway} days ago`;
}

/**
 * Which symptoms the person has most often logged DURING a given phase.
 *
 * This is the honest replacement for the donor's phase tip rows ("Focus on
 * iron-rich foods", "Great time for high-intensity workouts"). Those are advice
 * the app is in no position to give; this is the person's own record read back
 * to them, which is the only claim this screen is entitled to make.
 *
 * Days logged before the current anchor still count — the phase of a past day
 * is computed from the same wrapping arithmetic, so a symptom logged two cycles
 * ago lands in the phase it actually happened in.
 */
export function phaseSymptomCounts(
  entries: readonly CycleSymptomEntry[],
  settings: CycleSettings,
  phase: CyclePhase,
  limit = 3
): Array<{ symptom: CycleSymptom; count: number }> {
  const inPhase = entries.filter((entry) => phaseOn(entry.date, settings) === phase);
  return commonSymptoms(inPhase as CycleSymptomEntry[], limit);
}

/** Days in `entries` that fall in `phase` — the denominator for the line above. */
export function phaseLoggedDays(
  entries: readonly CycleSymptomEntry[],
  settings: CycleSettings,
  phase: CyclePhase
): number {
  return entries.filter(
    (entry) => hasSymptomContent(entry) && phaseOn(entry.date, settings) === phase
  ).length;
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

async function fetchCycleSettings(): Promise<Partial<CycleSettings>> {
  const settings = (await healthApi.getCycleSettings()).settings;
  if (!settings) return {};
  return {
    cycleLength: settings.cycle_length,
    periodLength: settings.period_length,
    lastPeriodStart: settings.last_period_start,
  };
}

export async function loadCycleSettings(): Promise<CycleSettings> {
  const stored = await readThrough<Partial<CycleSettings>>(
    HEALTH_CYCLE_SETTINGS_KEY,
    fetchCycleSettings,
    {}
  );
  const merged = { ...DEFAULT_CYCLE_SETTINGS, ...stored };
  return {
    cycleLength: clampCycleLength(merged.cycleLength),
    periodLength: clampPeriodLength(merged.periodLength),
    lastPeriodStart:
      typeof merged.lastPeriodStart === 'string' ? merged.lastPeriodStart : null,
  };
}

export async function saveCycleSettings(
  patch: Partial<CycleSettings>,
): Promise<CycleSettings> {
  const next = { ...(await loadCycleSettings()), ...patch };
  const clean: CycleSettings = {
    cycleLength: clampCycleLength(next.cycleLength),
    periodLength: clampPeriodLength(next.periodLength),
    lastPeriodStart: next.lastPeriodStart ?? null,
  };
  await writeThrough(
    HEALTH_CYCLE_SETTINGS_KEY,
    () =>
      healthApi.saveCycleSettings({
        cycle_length: clean.cycleLength,
        period_length: clean.periodLength,
        last_period_start: clean.lastPeriodStart,
      }),
    async () => clean,
    clean,
    `len=${clean.cycleLength} anchor=${clean.lastPeriodStart ?? 'none'}`,
    {
      // A true singleton — every account has at most one `cycle_settings` row,
      // so there is no id and no date to key on. `OUTBOX_NATURAL_KEY_FIELDS`
      // maps this collection to `[]`, which is what makes every queued edit
      // collapse onto the SAME outbox slot rather than replaying stale ones
      // on top of newer ones.
      queue: {
        collection: 'cycle_settings',
        row: {
          cycle_length: clean.cycleLength,
          period_length: clean.periodLength,
          last_period_start: clean.lastPeriodStart,
        },
      },
    }
  );
  return clean;
}

function isValidPeriod(entry: PeriodEntry | null | undefined): entry is PeriodEntry {
  return (
    !!entry &&
    typeof entry.id === 'string' &&
    typeof entry.date === 'string' &&
    typeof entry.flow === 'string' &&
    isFlowLevel(entry.flow)
  );
}

/** Donor flow scale is 1–5; the app names the levels. */
const FLOW_BY_LEVEL: Record<number, FlowLevel> = {
  1: 'spotting',
  2: 'light',
  3: 'medium',
  4: 'heavy',
  5: 'veryHeavy',
};
const LEVEL_BY_FLOW: Record<FlowLevel, number> = {
  spotting: 1,
  light: 2,
  medium: 3,
  heavy: 4,
  veryHeavy: 5,
};

export function flowFromLevel(level: number): FlowLevel {
  return FLOW_BY_LEVEL[level] ?? 'medium';
}

export function levelFromFlow(flow: FlowLevel): number {
  return LEVEL_BY_FLOW[flow] ?? 3;
}

async function fetchPeriodEntries(): Promise<PeriodEntry[]> {
  const res = await healthApi.listPeriods();
  return (res.periods ?? [])
    .map((row) => ({
      id: `period-${row.date}`,
      date: row.date,
      flow: flowFromLevel(row.flow_level),
      notes: row.notes ?? '',
      loggedAt: row.updated_at,
    }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_PERIOD_ENTRIES);
}

export async function loadPeriodEntries(): Promise<PeriodEntry[]> {
  const entries = await readThrough(HEALTH_CYCLE_PERIODS_KEY, fetchPeriodEntries, []);
  return entries.filter(isValidPeriod).sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Log (or re-log) a bleeding day.
 *
 * One entry per date — logging the same day twice updates the flow instead of
 * stacking duplicates, which would corrupt the period-length average.
 */
export async function logPeriodDay(
  flow: FlowLevel,
  date = todayDateKey(),
  notes = '',
): Promise<PeriodEntry[]> {
  const loggedAt = new Date().toISOString();
  const others = (await loadPeriodEntries()).filter((e) => e.date !== date);
  const entry: PeriodEntry = {
    id: `period-${date}`,
    date,
    flow,
    notes: notes.trim().slice(0, MAX_NOTE_LENGTH),
    loggedAt,
  };
  const optimistic = [entry, ...others].sort((a, b) => b.date.localeCompare(a.date));
  // The server re-anchors the cycle when this is the first day of a NEW run
  // (and adopts the observed average length), so the client does not duplicate
  // that rule — it just refreshes settings afterwards.
  const next = await writeThrough(
    HEALTH_CYCLE_PERIODS_KEY,
    // Send the SAME trimmed/capped note the optimistic entry holds — sending the
    // raw string would let an oversized note round-trip back and contradict what
    // the client just rendered.
    () => healthApi.logPeriodDay({ date, flow_level: levelFromFlow(flow), notes: entry.notes }),
    fetchPeriodEntries,
    optimistic,
    `date=${date} flow=${flow}`,
    {
      // `period_entries` reconciles on `(user, date)`, so `date` alone is the
      // dedup key — see `OUTBOX_NATURAL_KEY_FIELDS`. NOT REPLICATED HERE: the
      // server's cycle re-anchoring (adopting an observed average length when
      // this is a new run's first day). That runs only on the live route, so an
      // offline period log still saves the DAY, but the cycle-length inference
      // it can trigger waits for the next successful sync like any other read.
      queue: {
        collection: 'period_entries',
        row: { date, flow_level: levelFromFlow(flow), notes: entry.notes },
      },
    }
  );
  await loadCycleSettings();
  return next;
}

export async function removePeriodDay(date: string): Promise<PeriodEntry[]> {
  const optimistic = (await loadPeriodEntries()).filter((e) => e.date !== date);
  const next = await writeThrough(
    HEALTH_CYCLE_PERIODS_KEY,
    () => healthApi.removePeriodDay(date),
    fetchPeriodEntries,
    optimistic,
    `delete date=${date}`,
    {
      queue: {
        collection: 'period_entries',
        row: { date, deleted_at: new Date().toISOString() },
      },
    }
  );
  // Removing the anchor day RE-ANCHORS the cycle server-side (or clears it when
  // nothing is left), so the settings cache must be refreshed — otherwise the
  // screen goes on showing a phase derived from the period just deleted.
  await loadCycleSettings();
  return next;
}

function isValidSymptomEntry(
  entry: CycleSymptomEntry | null | undefined,
): entry is CycleSymptomEntry {
  return (
    !!entry &&
    typeof entry.id === 'string' &&
    typeof entry.date === 'string' &&
    typeof entry.symptoms === 'object' &&
    entry.symptoms !== null
  );
}

async function fetchCycleSymptoms(): Promise<CycleSymptomEntry[]> {
  const res = await healthApi.listCycleSymptoms();
  return (res.symptoms ?? [])
    .map((row) => {
      const symptoms: Partial<Record<CycleSymptom, SymptomSeverity>> = {};
      for (const symptom of CYCLE_SYMPTOMS) {
        const value = (row as unknown as Record<string, unknown>)[SYMPTOM_COLUMN[symptom]];
        if (typeof value === 'number' && value > 0) {
          symptoms[symptom] = Math.min(3, Math.max(1, value)) as SymptomSeverity;
        }
      }
      return {
        id: `cycle-${row.date}`,
        date: row.date,
        mood: row.mood ?? null,
        energy: row.energy ?? null,
        sleepQuality: row.sleep_quality ?? null,
        symptoms,
        craving: ((row.cravings as Craving) ?? 'none') as Craving,
        notes: row.notes ?? '',
        loggedAt: row.updated_at,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_SYMPTOM_ENTRIES);
}

export async function loadCycleSymptoms(): Promise<CycleSymptomEntry[]> {
  const entries = await readThrough(HEALTH_CYCLE_SYMPTOMS_KEY, fetchCycleSymptoms, []);
  return entries.filter(isValidSymptomEntry).sort((a, b) => b.date.localeCompare(a.date));
}

export async function loadCycleSymptomsForDate(
  date = todayDateKey(),
): Promise<CycleSymptomEntry | null> {
  return (await loadCycleSymptoms()).find((e) => e.date === date) ?? null;
}

export function createEmptySymptomEntry(date = todayDateKey()): CycleSymptomEntry {
  return {
    id: `cycle-${date}`,
    date,
    mood: null,
    energy: null,
    sleepQuality: null,
    symptoms: {},
    craving: 'none',
    notes: '',
    loggedAt: '',
  };
}

/** One entry per day — saving replaces that day rather than appending. */
export async function saveCycleSymptomEntry(
  patch: Partial<Omit<CycleSymptomEntry, 'id' | 'date' | 'loggedAt'>>,
  date = todayDateKey(),
): Promise<CycleSymptomEntry[]> {
  const existing = (await loadCycleSymptomsForDate(date)) ?? createEmptySymptomEntry(date);
  const merged: CycleSymptomEntry = {
    ...existing,
    ...patch,
    id: `cycle-${date}`,
    date,
    notes: (patch.notes ?? existing.notes).trim().slice(0, MAX_NOTE_LENGTH),
    loggedAt: new Date().toISOString(),
  };
  const others = (await loadCycleSymptoms()).filter((e) => e.date !== date);
  const optimistic = [merged, ...others]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_SYMPTOM_ENTRIES);

  // Fan the symptom map back out into the donor's per-symptom columns.
  const columns: Record<string, unknown> = {};
  for (const symptom of CYCLE_SYMPTOMS) {
    columns[SYMPTOM_COLUMN[symptom]] = merged.symptoms[symptom] ?? 0;
  }

  const body = {
    date,
    mood: merged.mood,
    energy: merged.energy,
    sleep_quality: merged.sleepQuality,
    cravings: merged.craving,
    notes: merged.notes,
    ...columns,
  };
  return writeThrough(
    HEALTH_CYCLE_SYMPTOMS_KEY,
    () => healthApi.saveCycleSymptoms(body),
    fetchCycleSymptoms,
    optimistic,
    `date=${date} symptoms=${Object.keys(merged.symptoms).length}`,
    // `cycle_symptom_entries` reconciles on `(user, date)` — `date` alone dedups.
    { queue: { collection: 'cycle_symptom_entries', row: body } }
  );
}

/** Cycle-day label for an ISO timestamp, used by the history list. */
export function cycleDayLabel(iso: string, settings: CycleSettings): string {
  const day = cycleDayOn(dateKeyOf(iso), settings);
  return day === null ? '—' : `Day ${day}`;
}
