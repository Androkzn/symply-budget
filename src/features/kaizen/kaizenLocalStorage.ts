import { storageHelpers } from '@services/storage';

export const KAIZEN_DAILY_CORE_KEY = 'kaizen.dailyCore.v1';
export const KAIZEN_STREAK_KEY = 'kaizen.streak.v1';
export const KAIZEN_GUIDE_REFLECTIONS_KEY = 'kaizen.guide.reflections.v1';

export const DAILY_HABIT_IDS = ['reflect', 'move', 'review'] as const;
export type DailyHabitId = (typeof DAILY_HABIT_IDS)[number];

export interface KaizenDailyCore {
  date: string;
  habits: Record<DailyHabitId, boolean>;
  focus: string;
}

export interface KaizenStreak {
  count: number;
  lastCompletedDate: string | null;
}

export interface KaizenReflectionLog {
  prompt: string;
  loggedAt: string;
}

export function todayDateKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function yesterdayDateKey(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const year = yesterday.getFullYear();
  const month = String(yesterday.getMonth() + 1).padStart(2, '0');
  const day = String(yesterday.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function emptyHabits(): Record<DailyHabitId, boolean> {
  return { reflect: false, move: false, review: false };
}

export function createEmptyDailyCore(date = todayDateKey()): KaizenDailyCore {
  return { date, habits: emptyHabits(), focus: '' };
}

export async function loadDailyCore(): Promise<KaizenDailyCore> {
  const stored = await storageHelpers.getObject<KaizenDailyCore>(KAIZEN_DAILY_CORE_KEY);
  const today = todayDateKey();
  if (!stored || stored.date !== today) {
    return createEmptyDailyCore(today);
  }
  return {
    date: stored.date,
    habits: { ...emptyHabits(), ...stored.habits },
    focus: stored.focus ?? '',
  };
}

export async function saveDailyCore(data: KaizenDailyCore): Promise<void> {
  await storageHelpers.setObject(KAIZEN_DAILY_CORE_KEY, data);
}

export async function loadStreak(): Promise<KaizenStreak> {
  const stored = await storageHelpers.getObject<KaizenStreak>(KAIZEN_STREAK_KEY);
  return stored ?? { count: 0, lastCompletedDate: null };
}

export async function saveStreak(streak: KaizenStreak): Promise<void> {
  await storageHelpers.setObject(KAIZEN_STREAK_KEY, streak);
}

export function allHabitsComplete(habits: Record<DailyHabitId, boolean>): boolean {
  return DAILY_HABIT_IDS.every((id) => habits[id]);
}

export async function updateStreakOnHabitChange(
  habits: Record<DailyHabitId, boolean>,
): Promise<KaizenStreak> {
  const today = todayDateKey();
  const streak = await loadStreak();

  if (!allHabitsComplete(habits)) {
    return streak;
  }

  if (streak.lastCompletedDate === today) {
    return streak;
  }

  const yesterday = yesterdayDateKey();
  const nextCount =
    streak.lastCompletedDate === yesterday ? streak.count + 1 : 1;

  const updated: KaizenStreak = { count: nextCount, lastCompletedDate: today };
  await saveStreak(updated);
  return updated;
}

export async function loadReflectionLogs(): Promise<KaizenReflectionLog[]> {
  const stored = await storageHelpers.getObject<KaizenReflectionLog[]>(
    KAIZEN_GUIDE_REFLECTIONS_KEY,
  );
  return stored ?? [];
}

export async function appendReflectionLog(prompt: string): Promise<KaizenReflectionLog[]> {
  const logs = await loadReflectionLogs();
  const entry: KaizenReflectionLog = { prompt, loggedAt: new Date().toISOString() };
  const updated = [entry, ...logs].slice(0, 30);
  await storageHelpers.setObject(KAIZEN_GUIDE_REFLECTIONS_KEY, updated);
  return updated;
}
