import {
  healthApi,
  type HealthHabit,
  type HealthHabitFrequency,
  type HealthHabitTimeOfDay,
  type HealthHabitWrite,
} from '@api/health';

import { todayDateKey } from './healthLocalStorage';
import { shiftDateKey } from './healthNutritionStorage';
import { readThrough, writeThrough } from './healthRepository';

/**
 * Symply Health — Habits (donor `Features/Habits`, 7 files / 3,109 lines).
 *
 * A habit stores the DAYS it was completed on rather than a counter, which is
 * what makes streaks recomputable after an untick, a backfilled day or a device
 * clock change. The server owns the streak (`/health/habits` returns it); the
 * derivations here are the offline path and what the cached snapshot renders.
 *
 * SCHEDULE. A habit is no longer "a name and a tick": it carries the donor's
 * `timeOfDay`, `frequency`, `customDays`, `targetDuration`, `notes` and an
 * archive flag. None of that needed a migration — `0119_health_core.sql` created
 * every one of those columns and `createHabit` simply hard-coded them, so the
 * gap was in the writes, not the schema.
 *
 * REMINDERS are the Worker's job, not the device's. Setting `reminderTime` +
 * `reminderEnabled` makes the Health Worker materialise rows in the platform's
 * `scheduled_notifications` table (see `backend/src/services/health/habit-reminder.ts`),
 * so a reminder survives a reinstall, follows the member to a new handset, and
 * is delivered by the same every-5-minute sweep as every other Symply push. A
 * device-local `expo-notifications` schedule would do none of those things.
 */

export const HEALTH_HABITS_KEY = 'health.habits.v1';

export type HabitFrequency = HealthHabitFrequency;
export type HabitTimeOfDay = HealthHabitTimeOfDay;

export interface Habit {
  id: string;
  name: string;
  icon: string;
  category: string;
  /** The preset this came from, or null for a custom habit. */
  templateId: string | null;
  timeOfDay: HabitTimeOfDay;
  frequency: HabitFrequency;
  /** Apple `Calendar` weekday numbers — 1 = Sunday … 7 = Saturday. */
  customDays: number[] | null;
  /** Local wall-clock 'HH:MM'; the Worker resolves the member's own timezone. */
  reminderTime: string | null;
  reminderEnabled: boolean;
  /** Seconds. Stored by the donor's presets; shown as a suggestion only. */
  targetDuration: number | null;
  notes: string | null;
  archived: boolean;
  sortOrder: number;
  /** Completed day keys (YYYY-MM-DD), newest-first. */
  days: string[];
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

/**
 * The schedules a member can choose.
 *
 * The donor's `twiceDaily` case is deliberately NOT offered. `habit_logs` has
 * `UNIQUE(habit_id, date)`, so a day can be completed exactly once — a
 * "twice daily" habit would show 1/2 forever and could never be finished. The
 * backend still ACCEPTS the value (it is the donor's vocabulary and old rows may
 * carry it); the picker just does not hand anyone a target they cannot hit.
 */
export const HABIT_FREQUENCY_OPTIONS: ReadonlyArray<{
  value: HabitFrequency;
  label: string;
  /** Spoken form for the schedule summary line. */
  description: string;
}> = [
  { value: 'daily', label: 'Every day', description: 'Every day' },
  { value: 'weekdays', label: 'Weekdays', description: 'Monday to Friday' },
  { value: 'weekends', label: 'Weekends', description: 'Saturday and Sunday' },
  { value: 'custom', label: 'Custom days', description: 'On the days you pick' },
];

/** Donor `HabitTimeOfDay` — a filter and a label, never a schedule. */
export const HABIT_TIME_OPTIONS: ReadonlyArray<{
  value: HabitTimeOfDay;
  label: string;
  icon: string;
}> = [
  { value: 'morning', label: 'Morning', icon: 'breakfast' },
  { value: 'afternoon', label: 'Afternoon', icon: 'lunch' },
  { value: 'evening', label: 'Evening', icon: 'dinner' },
  { value: 'anytime', label: 'Anytime', icon: 'timer' },
];

/**
 * Weekday letters in the donor's order — index 0 is SUNDAY, matching the
 * `custom_days` numbering. Getting this order wrong shifts every custom
 * schedule by a day, silently.
 */
export const HABIT_WEEKDAYS: ReadonlyArray<{ value: number; letter: string; label: string }> = [
  { value: 1, letter: 'S', label: 'Sunday' },
  { value: 2, letter: 'M', label: 'Monday' },
  { value: 3, letter: 'T', label: 'Tuesday' },
  { value: 4, letter: 'W', label: 'Wednesday' },
  { value: 5, letter: 'T', label: 'Thursday' },
  { value: 6, letter: 'F', label: 'Friday' },
  { value: 7, letter: 'S', label: 'Saturday' },
];

export const HABIT_WEEKDAYS_WEEKDAY_SET = [2, 3, 4, 5, 6];
export const HABIT_WEEKDAYS_WEEKEND_SET = [1, 7];
export const HABIT_WEEKDAYS_ALL = [1, 2, 3, 4, 5, 6, 7];

/** Donor `HabitCategory`. Only categories with presets are offered as filters. */
export const HABIT_CATEGORIES: ReadonlyArray<{ value: string; label: string; icon: string }> = [
  { value: 'dental', label: 'Dental', icon: 'health' },
  { value: 'skincare', label: 'Skincare', icon: 'profile' },
  { value: 'hygiene', label: 'Hygiene', icon: 'water' },
  { value: 'wellness', label: 'Wellness', icon: 'supplements' },
  { value: 'fitness', label: 'Fitness', icon: 'workouts' },
  { value: 'nutrition', label: 'Nutrition', icon: 'nutrition' },
  { value: 'sleep', label: 'Sleep', icon: 'sleep' },
  { value: 'mindfulness', label: 'Mindfulness', icon: 'mindfulness' },
  { value: 'custom', label: 'Custom', icon: 'goals' },
];

export function categoryLabel(value: string): string {
  return HABIT_CATEGORIES.find((c) => c.value === value)?.label ?? 'Custom';
}

export function categoryIcon(value: string): string {
  return HABIT_CATEGORIES.find((c) => c.value === value)?.icon ?? 'goals';
}

export function timeOfDayLabel(value: HabitTimeOfDay): string {
  return HABIT_TIME_OPTIONS.find((t) => t.value === value)?.label ?? 'Anytime';
}

/**
 * Icons a custom habit can be given — every one a REAL key in the Symply Health
 * brand kit, so each renders as a brushed PNG rather than a flat Ionicons glyph.
 */
export const HABIT_ICON_CHOICES: readonly string[] = [
  'goals',
  'streak',
  'health',
  'heart-rate',
  'water',
  'hydration',
  'nutrition',
  'meals',
  'supplements',
  'medication-reminder',
  'workouts',
  'walk',
  'run',
  'strength',
  'stretch',
  'mindfulness',
  'breathing',
  'journal',
  'mood',
  'sleep',
  'sleep-habit',
  'timer',
  'profile',
  'insights',
];

/* ------------------------------------------------------------------ */
/* Preset library                                                      */
/* ------------------------------------------------------------------ */

export interface HabitTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  timeOfDay: HabitTimeOfDay;
  frequency: HabitFrequency;
  /** Seconds — the donor's `suggestedDuration`, carried through unchanged. */
  targetDuration: number | null;
}

/**
 * The donor's `HabitTemplate.presets` — all 19, in the donor's own order, with
 * its names, categories, times of day and suggested durations preserved.
 *
 * Icons are the one substitution: the donor names SF Symbols (`mouth.fill`,
 * `figure.flexibility`), which do not exist here, so each preset carries the
 * closest key in the Symply Health icon kit. Repetition inside a category is
 * donor-faithful — its own four dental presets share three icons.
 */
export const HABIT_TEMPLATES: readonly HabitTemplate[] = [
  {
    id: 'brush_teeth_morning',
    name: 'Brush Teeth (Morning)',
    description: 'Brush your teeth for 2 minutes',
    icon: 'health',
    category: 'dental',
    timeOfDay: 'morning',
    frequency: 'daily',
    targetDuration: 120,
  },
  {
    id: 'brush_teeth_evening',
    name: 'Brush Teeth (Evening)',
    description: 'Brush your teeth before bed',
    icon: 'health',
    category: 'dental',
    timeOfDay: 'evening',
    frequency: 'daily',
    targetDuration: 120,
  },
  {
    id: 'floss',
    name: 'Floss',
    description: 'Floss between teeth',
    icon: 'health',
    category: 'dental',
    timeOfDay: 'evening',
    frequency: 'daily',
    targetDuration: null,
  },
  {
    id: 'mouthwash',
    name: 'Mouthwash',
    description: 'Use mouthwash for 30 seconds',
    icon: 'water',
    category: 'dental',
    timeOfDay: 'evening',
    frequency: 'daily',
    targetDuration: 30,
  },
  {
    id: 'wash_face_morning',
    name: 'Wash Face (Morning)',
    description: 'Cleanse your face in the morning',
    icon: 'profile',
    category: 'skincare',
    timeOfDay: 'morning',
    frequency: 'daily',
    targetDuration: null,
  },
  {
    id: 'wash_face_evening',
    name: 'Wash Face (Evening)',
    description: 'Remove makeup and cleanse',
    icon: 'profile',
    category: 'skincare',
    timeOfDay: 'evening',
    frequency: 'daily',
    targetDuration: null,
  },
  {
    id: 'moisturize',
    name: 'Moisturize',
    description: 'Apply moisturizer',
    icon: 'hydration',
    category: 'skincare',
    timeOfDay: 'evening',
    frequency: 'daily',
    targetDuration: null,
  },
  {
    id: 'sunscreen',
    name: 'Apply Sunscreen',
    description: 'Apply SPF protection',
    icon: 'profile',
    category: 'skincare',
    timeOfDay: 'morning',
    frequency: 'daily',
    targetDuration: null,
  },
  {
    id: 'shower',
    name: 'Shower',
    description: 'Take a shower',
    icon: 'water',
    category: 'hygiene',
    timeOfDay: 'morning',
    frequency: 'daily',
    targetDuration: null,
  },
  {
    id: 'wash_hands',
    name: 'Wash Hands',
    description: 'Wash hands for 20 seconds',
    icon: 'water',
    category: 'hygiene',
    timeOfDay: 'anytime',
    frequency: 'daily',
    targetDuration: 20,
  },
  {
    id: 'take_vitamins',
    name: 'Take Vitamins',
    description: 'Take daily vitamins',
    icon: 'supplements',
    category: 'wellness',
    timeOfDay: 'morning',
    frequency: 'daily',
    targetDuration: null,
  },
  {
    id: 'take_medication',
    name: 'Take Medication',
    description: 'Take prescribed medication',
    icon: 'medication-reminder',
    category: 'wellness',
    timeOfDay: 'morning',
    frequency: 'daily',
    targetDuration: null,
  },
  {
    id: 'stretch',
    name: 'Stretch',
    description: 'Morning stretch routine',
    icon: 'stretch',
    category: 'fitness',
    timeOfDay: 'morning',
    frequency: 'daily',
    targetDuration: 300,
  },
  {
    id: 'walk',
    name: 'Go for a Walk',
    description: 'Take a daily walk',
    icon: 'walk',
    category: 'fitness',
    timeOfDay: 'anytime',
    frequency: 'daily',
    targetDuration: null,
  },
  {
    id: 'meditate',
    name: 'Meditate',
    description: 'Practice meditation',
    icon: 'mindfulness',
    category: 'mindfulness',
    timeOfDay: 'morning',
    frequency: 'daily',
    targetDuration: 600,
  },
  {
    id: 'journal',
    name: 'Journal',
    description: 'Write in your journal',
    icon: 'journal',
    category: 'mindfulness',
    timeOfDay: 'evening',
    frequency: 'daily',
    targetDuration: null,
  },
  {
    id: 'gratitude',
    name: 'Gratitude Practice',
    description: "List 3 things you're grateful for",
    icon: 'mood',
    category: 'mindfulness',
    timeOfDay: 'evening',
    frequency: 'daily',
    targetDuration: null,
  },
  {
    id: 'no_screens',
    name: 'No Screens Before Bed',
    description: 'Avoid screens 1 hour before bed',
    icon: 'sleep-habit',
    category: 'sleep',
    timeOfDay: 'evening',
    frequency: 'daily',
    targetDuration: null,
  },
  {
    id: 'sleep_schedule',
    name: 'Consistent Bedtime',
    description: 'Go to bed at the same time',
    icon: 'sleep',
    category: 'sleep',
    timeOfDay: 'evening',
    frequency: 'daily',
    targetDuration: null,
  },
];

/**
 * Category chips for the preset browser.
 *
 * Only categories that actually HAVE a preset are offered. The donor lists all
 * nine and its `nutrition` chip yields an empty list — a filter that can only
 * ever answer "nothing" is a defect, not a feature.
 */
export function habitTemplateCategories(): ReadonlyArray<{ value: string; label: string }> {
  const present = new Set(HABIT_TEMPLATES.map((t) => t.category));
  return HABIT_CATEGORIES.filter((c) => present.has(c.value)).map((c) => ({
    value: c.value,
    label: c.label,
  }));
}

/** Case-insensitive search across a preset's name, description and category. */
export function searchHabitTemplates(query: string, category?: string | null): HabitTemplate[] {
  const needle = (query ?? '').trim().toLowerCase();
  return HABIT_TEMPLATES.filter((t) => {
    if (category && t.category !== category) return false;
    if (needle.length === 0) return true;
    return (
      t.name.toLowerCase().includes(needle) ||
      t.description.toLowerCase().includes(needle) ||
      categoryLabel(t.category).toLowerCase().includes(needle)
    );
  });
}

/** Seeded on first open — the starter set, all manual, none AI-driven. */
export const DEFAULT_HABITS: ReadonlyArray<{ id: string; name: string; icon: string }> = [
  { id: 'sleep', name: 'Sleep 7+ hours', icon: 'sleep-habit' },
  { id: 'move', name: 'Move for 30 minutes', icon: 'movement' },
  { id: 'hydrate', name: 'Hit my water goal', icon: 'hydration' },
  { id: 'mindfulness', name: 'Mindful minutes', icon: 'mindfulness' },
  { id: 'stretch', name: 'Stretch', icon: 'stretch' },
];

const MAX_HABITS = 40;
const MAX_DAYS_PER_HABIT = 400;
const MAX_HABIT_NAME = 60;
const MAX_HABIT_NOTES = 1000;

/* ------------------------------------------------------------------ */
/* Derivations                                                         */
/* ------------------------------------------------------------------ */

/**
 * Consecutive completed days ending today (or yesterday — a habit not yet
 * ticked TODAY still has a live streak until the day is over).
 */
export function streakOf(days: string[], today = todayDateKey()): number {
  const set = new Set(days);
  let cursor = set.has(today) ? today : shiftDateKey(today, -1);
  if (!set.has(cursor)) return 0;
  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }
  return streak;
}

/** The longest run of consecutive completed days ever recorded. */
export function longestStreakOf(days: string[]): number {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of sorted) {
    run = previous !== null && shiftDateKey(previous, 1) === day ? run + 1 : 1;
    previous = day;
    if (run > best) best = run;
  }
  return best;
}

export function isDoneOn(habit: Habit, date = todayDateKey()): boolean {
  return habit.days.includes(date);
}

/**
 * Apple `Calendar` weekday (1 = Sunday) for a YYYY-MM-DD key.
 *
 * Parsed as UTC on purpose: a date KEY has no time zone, and letting the device
 * parse it locally would shift the weekday by one either side of midnight.
 */
export function weekdayOf(date: string): number {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return 1;
  return parsed.getUTCDay() + 1;
}

/**
 * Is this habit scheduled on `date`?
 *
 * Mirrors `isHabitDueOnWeekday` on the Worker (and the donor's own repository
 * rule). A habit that is not scheduled today is not counted as missed.
 */
export function isScheduledOn(habit: Habit, date = todayDateKey()): boolean {
  const weekday = weekdayOf(date);
  switch (habit.frequency) {
    case 'weekdays':
      return weekday >= 2 && weekday <= 6;
    case 'weekends':
      return weekday === 1 || weekday === 7;
    case 'custom':
      return habit.customDays && habit.customDays.length > 0
        ? habit.customDays.includes(weekday)
        : true;
    default:
      return true;
  }
}

/** Plain-language schedule, e.g. "Weekdays · Morning" or "Mon, Wed, Fri". */
export function scheduleSummary(habit: Habit): string {
  if (habit.frequency === 'custom' && habit.customDays && habit.customDays.length > 0) {
    const names = ['', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return [...habit.customDays].sort((a, b) => a - b).map((d) => names[d] ?? '').join(', ');
  }
  return (
    HABIT_FREQUENCY_OPTIONS.find((f) => f.value === habit.frequency)?.description ?? 'Every day'
  );
}

/** Completion flags for the last `count` days, oldest-first (dot strip). */
export function lastDaysStatus(habit: Habit, count: number, today = todayDateKey()): boolean[] {
  const set = new Set(habit.days);
  const out: boolean[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    out.push(set.has(shiftDateKey(today, -i)));
  }
  return out;
}

export interface HabitHistoryDay {
  date: string;
  done: boolean;
  /** False when the habit is not due that weekday — an unfilled dot, not a miss. */
  scheduled: boolean;
}

/** The last `count` days for the detail screen's history strip, oldest-first. */
export function habitHistory(
  habit: Habit,
  count: number,
  today = todayDateKey()
): HabitHistoryDay[] {
  const set = new Set(habit.days);
  const out: HabitHistoryDay[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = shiftDateKey(today, -i);
    out.push({ date, done: set.has(date), scheduled: isScheduledOn(habit, date) });
  }
  return out;
}

/**
 * Share of habits SCHEDULED on a given day that were completed, in [0, 1].
 *
 * Counting only scheduled habits is the whole point: with the old
 * "done / total" rule a weekdays-only habit dragged Sunday's figure down
 * forever, so a perfect Sunday could never read 100%.
 */
export function completionRate(habits: Habit[], date = todayDateKey()): number {
  const due = habits.filter((h) => !h.archived && isScheduledOn(h, date));
  if (due.length === 0) return 0;
  return due.filter((h) => isDoneOn(h, date)).length / due.length;
}

/** How many of today's scheduled habits are done, and how many there are. */
export function completionCounts(
  habits: Habit[],
  date = todayDateKey()
): { done: number; total: number } {
  const due = habits.filter((h) => !h.archived && isScheduledOn(h, date));
  return { done: due.filter((h) => isDoneOn(h, date)).length, total: due.length };
}

/**
 * A single habit's completion rate over the last `windowDays`.
 *
 * Only days the habit was SCHEDULED **and** already existed are expected, so a
 * habit created on Friday is not marked down for the Monday before it.
 */
export function habitCompletionRate(
  habit: Habit,
  windowDays = 30,
  today = todayDateKey()
): { rate: number; completed: number; expected: number } {
  const createdDay = (habit.createdAt ?? '').slice(0, 10);
  const set = new Set(habit.days);
  let completed = 0;
  let expected = 0;
  for (let i = windowDays - 1; i >= 0; i -= 1) {
    const date = shiftDateKey(today, -i);
    if (createdDay && date < createdDay) continue;
    if (!isScheduledOn(habit, date)) continue;
    expected += 1;
    if (set.has(date)) completed += 1;
  }
  return { rate: expected === 0 ? 0 : completed / expected, completed, expected };
}

/**
 * Daily completion rate across every habit, oldest-first — the series the
 * donor's `HabitStatisticsView` plots on a 0–100% axis.
 */
export function completionSeries(
  habits: Habit[],
  windowDays: number,
  today = todayDateKey()
): Array<{ date: string; rate: number }> {
  const out: Array<{ date: string; rate: number }> = [];
  for (let i = windowDays - 1; i >= 0; i -= 1) {
    const date = shiftDateKey(today, -i);
    out.push({ date, rate: completionRate(habits, date) });
  }
  return out;
}

/** Best-streak leaderboard, highest first; habits with no streak are dropped. */
export function streakLeaderboard(
  habits: Habit[],
  limit = 3
): Array<{ habit: Habit; streak: number }> {
  return habits
    .filter((h) => !h.archived)
    .map((habit) => ({ habit, streak: longestStreakOf(habit.days) }))
    .filter((row) => row.streak > 0)
    .sort((a, b) => b.streak - a.streak)
    .slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Wire mapping                                                        */
/* ------------------------------------------------------------------ */

function parseCustomDays(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const days = parsed
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
    return days.length > 0 ? [...new Set(days)].sort((a, b) => a - b) : null;
  } catch {
    return null;
  }
}

function fromWire(row: HealthHabit): Habit {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon || 'goals',
    category: row.category || 'custom',
    templateId: row.template_id ?? null,
    timeOfDay: row.time_of_day ?? 'anytime',
    frequency: row.frequency ?? 'daily',
    customDays: parseCustomDays(row.custom_days),
    reminderTime: row.reminder_time ?? null,
    reminderEnabled: row.reminder_enabled ?? false,
    targetDuration: row.target_duration ?? null,
    notes: row.notes ?? null,
    archived: row.is_archived ?? false,
    sortOrder: row.sort_order ?? 0,
    days: (row.days ?? []).slice(0, MAX_DAYS_PER_HABIT),
    createdAt: row.created_at,
  };
}

function isValidHabit(habit: Habit | null | undefined): habit is Habit {
  return (
    !!habit &&
    typeof habit.id === 'string' &&
    typeof habit.name === 'string' &&
    Array.isArray(habit.days)
  );
}

function seedHabits(): Habit[] {
  const createdAt = new Date().toISOString();
  return DEFAULT_HABITS.map((h, index) => ({
    id: h.id,
    name: h.name,
    icon: h.icon,
    category: 'custom',
    templateId: null,
    timeOfDay: 'anytime' as HabitTimeOfDay,
    frequency: 'daily' as HabitFrequency,
    customDays: null,
    reminderTime: null,
    reminderEnabled: false,
    targetDuration: null,
    notes: null,
    archived: false,
    sortOrder: index,
    days: [],
    createdAt,
  }));
}

/**
 * Archived habits are fetched too.
 *
 * Without them an archived habit is unreachable — archive is the donor's only
 * "deactivate" verb, and a habit you can hide but never bring back is a delete
 * that lies about being reversible. Screens filter on `archived` themselves.
 */
async function fetchHabits(): Promise<Habit[]> {
  const res = await healthApi.listHabits({ includeArchived: true });
  const rows = res.habits ?? [];
  // First run on a fresh account: seed the starter set server-side so every
  // device sees the same list rather than each seeding its own copy.
  if (rows.length === 0) {
    const created: Habit[] = [];
    for (const seed of DEFAULT_HABITS) {
      const r = await healthApi.createHabit({ name: seed.name, icon: seed.icon });
      if (r.habit) created.push(fromWire(r.habit));
    }
    return created;
  }
  return rows.slice(0, MAX_HABITS).map(fromWire);
}

export async function loadHabits(): Promise<Habit[]> {
  // Offline fallback is the seeded starter set, matching what a first run shows.
  const habits = await readThrough(HEALTH_HABITS_KEY, fetchHabits, seedHabits());
  return habits.filter(isValidHabit).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** One habit by id, from the same cached list every screen reads. */
export async function loadHabit(id: string): Promise<Habit | null> {
  return (await loadHabits()).find((h) => h.id === id) ?? null;
}

/* ------------------------------------------------------------------ */
/* Writes                                                             */
/* ------------------------------------------------------------------ */

export async function toggleHabitToday(id: string, date = todayDateKey()): Promise<Habit[]> {
  const habits = await loadHabits();
  const wasDone = habits.find((h) => h.id === id)?.days.includes(date) ?? false;
  const optimistic = habits.map((habit) => {
    if (habit.id !== id) return habit;
    const done = habit.days.includes(date);
    const days = done
      ? habit.days.filter((d) => d !== date)
      : [date, ...habit.days].sort((a, b) => b.localeCompare(a));
    return { ...habit, days };
  });
  const nowIso = new Date().toISOString();
  return writeThrough(
    HEALTH_HABITS_KEY,
    () => healthApi.toggleHabit(id, date),
    fetchHabits,
    optimistic,
    `habit=${id} date=${date}`,
    {
      // The SERVER route is a true toggle (flip whatever it currently holds),
      // which the push contract has no primitive for — it applies exactly what
      // a row says, never "the opposite of what is there". So the queued row
      // states the TARGET end-state directly, derived from `wasDone` here
      // rather than replayed as a toggle: completing sets `deleted_at: null`
      // with a fresh `completed_at`; un-completing tombstones it.
      queue: {
        collection: 'habit_logs',
        row: wasDone
          ? { habit_id: id, date, completed_at: nowIso, deleted_at: nowIso }
          : { habit_id: id, date, completed_at: nowIso, deleted_at: null },
      },
    }
  );
}

/** Everything a create/edit form can set. Absent = leave, null = clear. */
export interface HabitDraft {
  name?: string;
  icon?: string;
  category?: string;
  templateId?: string | null;
  timeOfDay?: HabitTimeOfDay;
  frequency?: HabitFrequency;
  customDays?: number[] | null;
  reminderTime?: string | null;
  reminderEnabled?: boolean;
  targetDuration?: number | null;
  notes?: string | null;
  archived?: boolean;
}

/** 'HH:MM' or null — anything else is dropped rather than sent to the route. */
export function normalizeReminderTime(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function toWire(draft: HabitDraft): HealthHabitWrite {
  const body: HealthHabitWrite = {};
  if (draft.name !== undefined) body.name = draft.name.trim().slice(0, MAX_HABIT_NAME);
  if (draft.icon !== undefined) body.icon = draft.icon;
  if (draft.category !== undefined) body.category = draft.category;
  if (draft.templateId !== undefined) body.template_id = draft.templateId;
  if (draft.timeOfDay !== undefined) body.time_of_day = draft.timeOfDay;
  if (draft.frequency !== undefined) body.frequency = draft.frequency;
  if (draft.customDays !== undefined) {
    body.custom_days = draft.customDays
      ? [...new Set(draft.customDays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort(
          (a, b) => a - b
        )
      : null;
  }
  if (draft.reminderTime !== undefined) body.reminder_time = normalizeReminderTime(draft.reminderTime);
  if (draft.reminderEnabled !== undefined) body.reminder_enabled = draft.reminderEnabled;
  if (draft.targetDuration !== undefined) body.target_duration = draft.targetDuration;
  if (draft.notes !== undefined) {
    const trimmed = (draft.notes ?? '').trim().slice(0, MAX_HABIT_NOTES);
    body.notes = trimmed.length > 0 ? trimmed : null;
  }
  if (draft.archived !== undefined) body.is_archived = draft.archived;
  return body;
}

/**
 * Add a habit.
 *
 * The two-argument form is preserved (`addHabit(name, icon)`) so the quick
 * "type a name" row keeps working; everything else rides in `draft`.
 */
export async function addHabit(
  name: string,
  icon = 'goals',
  draft: HabitDraft = {}
): Promise<Habit[]> {
  const trimmed = name.trim().slice(0, MAX_HABIT_NAME);
  const habits = await loadHabits();
  if (trimmed.length === 0 || habits.length >= MAX_HABITS) return habits;

  const createdAt = new Date().toISOString();
  const body = { ...toWire({ icon, ...draft }), name: trimmed };
  const optimistic: Habit[] = [
    ...habits,
    {
      // Placeholder id — the read-through replaces the whole list with the
      // server's, so this is never used to address a row.
      id: `pending-${createdAt}`,
      name: trimmed,
      icon: draft.icon ?? icon,
      category: draft.category ?? 'custom',
      templateId: draft.templateId ?? null,
      timeOfDay: draft.timeOfDay ?? 'anytime',
      frequency: draft.frequency ?? 'daily',
      customDays: draft.customDays ?? null,
      reminderTime: normalizeReminderTime(draft.reminderTime),
      reminderEnabled: draft.reminderEnabled ?? false,
      targetDuration: draft.targetDuration ?? null,
      notes: draft.notes ?? null,
      archived: false,
      sortOrder: habits.length,
      days: [],
      createdAt,
    },
  ];

  return writeThrough(
    HEALTH_HABITS_KEY,
    () => healthApi.createHabit(body),
    fetchHabits,
    optimistic,
    `insert habit=${trimmed}`,
    {
      // The same `pending-${createdAt}` the optimistic row's id uses, so an
      // offline edit or delete of THIS not-yet-synced habit collapses onto the
      // same outbox slot instead of duplicating it.
      queue: { collection: 'habits', row: { id: `pending-${createdAt}`, ...body, name: trimmed } },
    }
  );
}

/** Add a habit straight from the preset library, carrying its whole shape. */
export async function addHabitFromTemplate(
  template: HabitTemplate,
  overrides: HabitDraft = {}
): Promise<Habit[]> {
  return addHabit(overrides.name ?? template.name, template.icon, {
    templateId: template.id,
    category: template.category,
    timeOfDay: template.timeOfDay,
    frequency: template.frequency,
    targetDuration: template.targetDuration,
    ...overrides,
  });
}

/**
 * Patch a habit — name, icon, schedule, reminder or archive flag.
 *
 * The Worker re-materialises the habit's reminder rows on every call, so a
 * changed time or frequency takes effect without a second request from here.
 */
export async function updateHabit(id: string, draft: HabitDraft): Promise<Habit[]> {
  const habits = await loadHabits();
  const optimistic = habits.map((habit) =>
    habit.id === id
      ? {
          ...habit,
          ...(draft.name !== undefined ? { name: draft.name.trim().slice(0, MAX_HABIT_NAME) } : {}),
          ...(draft.icon !== undefined ? { icon: draft.icon } : {}),
          ...(draft.category !== undefined ? { category: draft.category } : {}),
          ...(draft.timeOfDay !== undefined ? { timeOfDay: draft.timeOfDay } : {}),
          ...(draft.frequency !== undefined ? { frequency: draft.frequency } : {}),
          ...(draft.customDays !== undefined ? { customDays: draft.customDays } : {}),
          ...(draft.reminderTime !== undefined
            ? { reminderTime: normalizeReminderTime(draft.reminderTime) }
            : {}),
          ...(draft.reminderEnabled !== undefined
            ? { reminderEnabled: draft.reminderEnabled }
            : {}),
          ...(draft.targetDuration !== undefined ? { targetDuration: draft.targetDuration } : {}),
          ...(draft.notes !== undefined ? { notes: draft.notes } : {}),
          ...(draft.archived !== undefined ? { archived: draft.archived } : {}),
        }
      : habit
  );
  return writeThrough(
    HEALTH_HABITS_KEY,
    () => healthApi.updateHabit(id, toWire(draft)),
    fetchHabits,
    optimistic,
    `update habit=${id}`,
    // Partial is fine here even for a not-yet-synced row: `enqueueHealthChange`
    // merges with whatever this id already has queued (its create), so the
    // required `name` column travels along without being resent.
    { queue: { collection: 'habits', row: { id, ...toWire(draft) } } }
  );
}

/** Archive / unarchive — the donor's only "deactivate", and reversible. */
export async function setHabitArchived(id: string, archived: boolean): Promise<Habit[]> {
  return updateHabit(id, { archived });
}

export async function deleteHabit(id: string): Promise<Habit[]> {
  const habits = await loadHabits();
  const found = habits.find((h) => h.id === id);
  const optimistic = habits.filter((h) => h.id !== id);
  return writeThrough(
    HEALTH_HABITS_KEY,
    () => healthApi.deleteHabit(id),
    fetchHabits,
    optimistic,
    `delete habit=${id}`,
    {
      // `name` is included for the edge case where this habit was NEVER
      // synced: the outbox merge combines this with the queued create (which
      // already has it), but a habit created and deleted in the SAME offline
      // session with no other edit in between still needs it here to satisfy
      // the push writer's required-column check on the resulting insert.
      queue: {
        collection: 'habits',
        row: { id, name: found?.name ?? '', deleted_at: new Date().toISOString() },
      },
    }
  );
}
