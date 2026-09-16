/**
 * Local-first learner state for Symply Language (shell v1).
 *
 * Everything here is device-local and AI-off safe: the Learn home, daily
 * practice, and streak work with no network and no AI provider. Server-backed
 * assessment / plan / progress replace or augment these in later port phases
 * (see documents/apps/symply-language/migration.md).
 */
import { storageHelpers } from '@services/storage';

export const LANGUAGE_PROFILE_KEY = 'language.profile.v1';
export const LANGUAGE_DAILY_KEY = 'language.daily.v1';
export const LANGUAGE_STREAK_KEY = 'language.streak.v1';

/** Daily practice goals shown on the Learn home. */
export const DAILY_GOAL_IDS = ['review', 'speak', 'learn'] as const;
export type DailyGoalId = (typeof DAILY_GOAL_IDS)[number];

export const DAILY_GOALS: ReadonlyArray<{ id: DailyGoalId; label: string }> = [
  { id: 'review', label: 'Review vocabulary' },
  { id: 'speak', label: 'Speak for 2 minutes' },
  { id: 'learn', label: 'Learn something new' },
];

/** Coarse self-reported level until placement assessment ships. */
export const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type LanguageLevel = (typeof LEVELS)[number];

export interface LanguageProfile {
  /** Language the learner wants to learn (e.g. "Spanish"). */
  targetLanguage: string | null;
  /** Learner's native language, used later for AI context / translations. */
  nativeLanguage: string | null;
  level: LanguageLevel | null;
}

export interface LanguageDaily {
  date: string;
  goals: Record<DailyGoalId, boolean>;
}

export interface LanguageStreak {
  count: number;
  lastCompletedDate: string | null;
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

function emptyGoals(): Record<DailyGoalId, boolean> {
  return { review: false, speak: false, learn: false };
}

export function createEmptyProfile(): LanguageProfile {
  return { targetLanguage: null, nativeLanguage: null, level: null };
}

export function isProfileReady(profile: LanguageProfile | null): boolean {
  return !!profile?.targetLanguage;
}

export async function loadProfile(): Promise<LanguageProfile> {
  const stored = await storageHelpers.getObject<LanguageProfile>(LANGUAGE_PROFILE_KEY);
  return stored ? { ...createEmptyProfile(), ...stored } : createEmptyProfile();
}

export async function saveProfile(profile: LanguageProfile): Promise<void> {
  await storageHelpers.setObject(LANGUAGE_PROFILE_KEY, profile);
}

export function createEmptyDaily(date = todayDateKey()): LanguageDaily {
  return { date, goals: emptyGoals() };
}

export async function loadDaily(): Promise<LanguageDaily> {
  const stored = await storageHelpers.getObject<LanguageDaily>(LANGUAGE_DAILY_KEY);
  const today = todayDateKey();
  if (!stored || stored.date !== today) {
    return createEmptyDaily(today);
  }
  return { date: stored.date, goals: { ...emptyGoals(), ...stored.goals } };
}

export async function saveDaily(daily: LanguageDaily): Promise<void> {
  await storageHelpers.setObject(LANGUAGE_DAILY_KEY, daily);
}

export async function loadStreak(): Promise<LanguageStreak> {
  const stored = await storageHelpers.getObject<LanguageStreak>(LANGUAGE_STREAK_KEY);
  return stored ?? { count: 0, lastCompletedDate: null };
}

export async function saveStreak(streak: LanguageStreak): Promise<void> {
  await storageHelpers.setObject(LANGUAGE_STREAK_KEY, streak);
}

export function allGoalsComplete(goals: Record<DailyGoalId, boolean>): boolean {
  return DAILY_GOAL_IDS.every((id) => goals[id]);
}

export function completedGoalCount(goals: Record<DailyGoalId, boolean>): number {
  return DAILY_GOAL_IDS.filter((id) => goals[id]).length;
}

/**
 * Advance the streak when all daily goals are complete. Idempotent per day and
 * only increments when yesterday was also completed (otherwise resets to 1).
 */
export async function updateStreakOnGoalChange(
  goals: Record<DailyGoalId, boolean>,
): Promise<LanguageStreak> {
  const streak = await loadStreak();
  if (!allGoalsComplete(goals)) {
    return streak;
  }
  const today = todayDateKey();
  if (streak.lastCompletedDate === today) {
    return streak;
  }
  const nextCount =
    streak.lastCompletedDate === yesterdayDateKey() ? streak.count + 1 : 1;
  const updated: LanguageStreak = { count: nextCount, lastCompletedDate: today };
  await saveStreak(updated);
  return updated;
}
