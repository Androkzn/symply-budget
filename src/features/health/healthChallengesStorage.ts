import {
  healthApi,
  HEALTH_CHALLENGE_CATEGORIES,
  type HealthChallengeCategory,
  type HealthChallengeDailyProgress,
  type HealthChallengeFrequency,
  type HealthChallengeTodayResponse,
  type HealthChallengeWeeklyProgress,
  type HealthFoodChallenge,
  type HealthFoodChallengeWrite,
} from '@api/health';
import type { AppBarDatum } from '@components/ui/AppBarChart';
import { storageHelpers } from '@services/storage';

import { readThrough, writeThrough } from './healthRepository';
import { formatAxisDate } from './healthTrends';

/**
 * Symply Health — Food Challenges (donor `WeeklyChallengeChartWidget` +
 * `ChallengesSettingsView`), Dashboard parity phase.
 *
 * Backend-backed, following the exact `readThrough`/`writeThrough` shape every
 * other Health store uses (see `healthNutritionStorage.ts`). Challenges are not
 * one of the twelve `HEALTH_PUSH_COLLECTIONS` the offline outbox understands
 * (see `healthRepository.ts`), so writes here do not pass a `queue` option —
 * same as custom foods, recipes, injuries and fridge items.
 */

export const HEALTH_CHALLENGES_KEY = 'health.challenges.v1';
export const HEALTH_CHALLENGES_WEEKLY_KEY = 'health.challengesWeekly.v1';
export const HEALTH_CHALLENGE_TODAY_KEY = 'health.challengeToday.v1';

export type {
  HealthChallengeCategory,
  HealthChallengeDailyProgress,
  HealthChallengeFrequency,
  HealthChallengeTodayResponse,
  HealthChallengeWeeklyProgress,
  HealthFoodChallenge,
  HealthFoodChallengeWrite,
};

/**
 * Category display metadata — donor `ChallengeCategory` (SF Symbol + `Color`),
 * restyled onto Ionicons-fallback glyph names (the shared `<Icon>` renders any
 * unmapped kit name as a tinted Ionicons glyph, so these are safe without a
 * brand-kit entry) and a validated dataviz hue rather than the donor's raw
 * system colors (several of which — plain `.white`, `.yellow` — do not carry
 * as swatches on a light card).
 */
export const CHALLENGE_CATEGORY_META: Record<
  HealthChallengeCategory,
  { label: string; icon: string; color: string }
> = {
  vegetables: { label: 'Vegetables', icon: 'leaf', color: '#059669' },
  fruits: { label: 'Fruits', icon: 'nutrition', color: '#EA580C' },
  fish: { label: 'Fish', icon: 'fish', color: '#0891B2' },
  seafood: { label: 'Seafood', icon: 'water', color: '#0D9488' },
  meat: { label: 'Meat', icon: 'restaurant', color: '#DC2626' },
  dairy: { label: 'Dairy', icon: 'cafe', color: '#7C3AED' },
  grains: { label: 'Grains', icon: 'basket', color: '#B45309' },
  legumes: { label: 'Legumes', icon: 'leaf-outline', color: '#14B8A6' },
  nuts: { label: 'Nuts', icon: 'ellipse', color: '#CA8A04' },
  custom_ingredient: { label: 'Custom', icon: 'star', color: '#7C3AED' },
};

export const CHALLENGE_CATEGORY_OPTIONS: ReadonlyArray<{
  value: HealthChallengeCategory;
  label: string;
}> = HEALTH_CHALLENGE_CATEGORIES.map((value) => ({
  value,
  label: CHALLENGE_CATEGORY_META[value].label,
}));

/** True for a value that reads as an emoji rather than an icon-kit/Ionicons slug. */
export function isEmojiIcon(value: string | null | undefined): boolean {
  if (!value) return false;
  return [...value].some((char) => (char.codePointAt(0) ?? 0) > 127);
}

/** Glyph to render for a challenge: its own override, else the category's. */
export function challengeDisplayIcon(challenge: HealthFoodChallenge): string {
  return challenge.icon && challenge.icon.length > 0
    ? challenge.icon
    : CHALLENGE_CATEGORY_META[challenge.category].icon;
}

/** Swatch color for a challenge — always the category's, even with a custom icon. */
export function challengeDisplayColor(challenge: HealthFoodChallenge): string {
  return CHALLENGE_CATEGORY_META[challenge.category].color;
}

/** Whole percent for display — the payload's own fraction × 100. Not clamped: an overshoot reads as e.g. 140%, same as the donor. */
export function challengePercent(progressFraction: number): number {
  const fraction = Number.isFinite(progressFraction) ? progressFraction : 0;
  return Math.round(fraction * 100);
}

/** Monday=1 … Sunday=7 — this app's fixed week-start convention (matches `heatmapWeekStart`). */
export function isoDayOfWeek(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number);
  const dow = new Date(year, (month ?? 1) - 1, day ?? 1).getDay();
  return dow === 0 ? 7 : dow;
}

/**
 * "On track" vs "Behind" — the donor's weekly challenge status badge.
 *
 * A challenge is on track once its week-to-date share clears 80% of what a
 * perfectly even week would have banked by today (`dayOfWeek / 7`): Monday only
 * needs ~11% logged, Sunday needs the full 80%, so a Tuesday is never judged
 * against a whole week's target.
 */
export function isChallengeOnTrack(weeklyProgressFraction: number, todayKey: string): boolean {
  const dow = isoDayOfWeek(todayKey);
  const expected = (dow / 7) * 0.8;
  const fraction = Number.isFinite(weeklyProgressFraction) ? weeklyProgressFraction : 0;
  return fraction >= expected;
}

async function fetchAllChallenges(): Promise<HealthFoodChallenge[]> {
  const res = await healthApi.listChallenges();
  return res.challenges ?? [];
}

/** Every challenge the member created — active and paused — for the management screen. */
export async function loadChallenges(): Promise<HealthFoodChallenge[]> {
  return readThrough(HEALTH_CHALLENGES_KEY, fetchAllChallenges, []);
}

/** Active challenges only, derived from the same cached list. */
export async function loadActiveChallenges(): Promise<HealthFoodChallenge[]> {
  return (await loadChallenges()).filter((challenge) => challenge.is_active);
}

export async function createChallenge(input: HealthFoodChallengeWrite): Promise<HealthFoodChallenge[]> {
  const before = await loadChallenges();
  const now = new Date().toISOString();
  const optimisticRow: HealthFoodChallenge = {
    id: `local-${now}`,
    user_id: '',
    name: input.name.trim(),
    category: input.category,
    target_food_name: input.target_food_name ?? null,
    target_grams: input.target_grams,
    frequency: input.frequency,
    is_active: input.is_active ?? true,
    icon: input.icon ?? null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  return writeThrough(
    HEALTH_CHALLENGES_KEY,
    () => healthApi.createChallenge(input),
    fetchAllChallenges,
    [optimisticRow, ...before],
    `create name=${input.name}`
  );
}

export async function updateChallenge(
  id: string,
  patch: Partial<HealthFoodChallengeWrite>
): Promise<HealthFoodChallenge[]> {
  const before = await loadChallenges();
  const optimistic = before.map((challenge) =>
    challenge.id === id
      ? { ...challenge, ...patch, updated_at: new Date().toISOString() }
      : challenge
  );
  return writeThrough(
    HEALTH_CHALLENGES_KEY,
    () => healthApi.updateChallenge(id, patch),
    fetchAllChallenges,
    optimistic,
    `update id=${id}`
  );
}

export async function deleteChallenge(id: string): Promise<HealthFoodChallenge[]> {
  const before = await loadChallenges();
  const optimistic = before.filter((challenge) => challenge.id !== id);
  return writeThrough(
    HEALTH_CHALLENGES_KEY,
    () => healthApi.deleteChallenge(id),
    fetchAllChallenges,
    optimistic,
    `delete id=${id}`
  );
}

/** Today's per-challenge progress — the management screen's "today" column. */
export async function loadChallengeProgressToday(
  date?: string
): Promise<HealthChallengeTodayResponse | null> {
  return readThrough(
    HEALTH_CHALLENGE_TODAY_KEY,
    () => healthApi.getChallengeProgressToday(date),
    null
  );
}

/** One active challenge's weekly reading, flattened for the Home widget's chart + list. */
export interface ChallengeWeeklyOverviewEntry {
  challenge: HealthFoodChallenge;
  /** 7 entries, oldest first. */
  dailyProgress: HealthChallengeDailyProgress[];
  weeklyTotalGrams: number;
  weeklyTargetGrams: number;
  /** Fraction (0..1, uncapped past 1 on an overshoot). */
  weeklyProgressFraction: number;
}

async function fetchChallengesWeeklyOverview(): Promise<ChallengeWeeklyOverviewEntry[]> {
  const res = await healthApi.listChallenges({ active: true });
  const active = res.challenges ?? [];
  const weekly = await Promise.all(active.map((c) => healthApi.getChallengeWeeklyProgress(c.id)));
  return weekly.map((entry) => ({
    challenge: entry.challenge,
    dailyProgress: entry.daily_progress ?? [],
    weeklyTotalGrams: entry.weekly_total_grams,
    weeklyTargetGrams: entry.weekly_target_grams,
    weeklyProgressFraction: entry.weekly_progress_percentage,
  }));
}

/**
 * The Home widget's whole data need in one cached read: every active
 * challenge's 7-day progress, the max-% bar chart and the expandable detail
 * list both draw from this same array.
 */
export async function loadChallengesWeeklyOverview(): Promise<ChallengeWeeklyOverviewEntry[]> {
  return readThrough(HEALTH_CHALLENGES_WEEKLY_KEY, fetchChallengesWeeklyOverview, []);
}

/**
 * Donor `WeeklyChallengeChartView`'s 7-day bar row: each day shows the MAX
 * percentage across every active challenge that day (not an average — a day
 * where one challenge was smashed and another ignored should read as a good
 * day, not a middling one), always scaled 0-100% regardless of any overshoot,
 * with future days suppressed to 0 rather than drawn as "behind".
 *
 * Every entry's `dailyProgress` covers the SAME 7-day window (the server's
 * current week), so day dates are read from the first entry and every other
 * entry is read by matching INDEX.
 */
export function dailyMaxPercentBars(
  overview: ChallengeWeeklyOverviewEntry[],
  todayKey: string
): AppBarDatum[] {
  const reference = overview[0]?.dailyProgress ?? [];
  return reference.map((day, index) => {
    const isFuture = day.date > todayKey;
    const maxFraction = isFuture
      ? 0
      : overview.reduce((max, entry) => {
          const fraction = entry.dailyProgress[index]?.progress_percentage ?? 0;
          return Math.max(max, Number.isFinite(fraction) ? fraction : 0);
        }, 0);
    return {
      value: Math.round(Math.min(1, maxFraction) * 100),
      label: formatAxisDate(day.date),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Widget UI state — expand/collapse for "Challenge Details"           */
/* ------------------------------------------------------------------ */

export const HEALTH_CHALLENGES_WIDGET_EXPANDED_KEY = 'health.foodChallengesWidget.expanded.v1';

/** Default expanded — mirrors the donor's `@AppStorage(...) = true` default. */
export async function loadChallengesWidgetExpanded(): Promise<boolean> {
  const stored = await storageHelpers.getBoolean(HEALTH_CHALLENGES_WIDGET_EXPANDED_KEY);
  return stored ?? true;
}

export async function saveChallengesWidgetExpanded(expanded: boolean): Promise<void> {
  await storageHelpers.setBoolean(HEALTH_CHALLENGES_WIDGET_EXPANDED_KEY, expanded);
}
