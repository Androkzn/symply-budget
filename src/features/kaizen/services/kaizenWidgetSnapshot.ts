/**
 * Kaizen widget + Watch snapshot producer.
 *
 * Kaizen's home-screen widget (`SymplyKaizenWidgetContent.swift`) and Watch face
 * (`SymplyKaizenWatchView.swift`) both read today's habit progress out of the shared
 * App Group. This module is the phone-side producer that fills those keys — Kaizen
 * was the only brand missing one, so both surfaces rendered a permanent empty state.
 *
 * The two consumers use **different** field shapes; they are written from one source
 * of truth here so the surfaces can never disagree about today:
 *
 *   widget_kaizen_today  { done, total, streak,         next_habit: { title, icon } | null }
 *   watch_kaizen_today   { done, total, current_streak, next_habit: string | null }
 *
 * Only counts, a streak integer and a habit title ever leave the app — the App Group
 * is readable by extensions, so no token, email or id may be written here.
 */
import widgetSync from '@services/widget-sync';

import type { KaizenActionEntry, KaizenActionLogEntry } from '../types';

import { getDailyCoreActions, listActive } from './repository';
import { computeDailyCoreStreak } from './streak';

/** App Group key read by `SymplyKaizenWidgetContent.swift`. */
export const KAIZEN_WIDGET_KEY = 'widget_kaizen_today';

/** App Group key read by `SymplyKaizenWatchView.swift`. */
export const KAIZEN_WATCH_KEY = 'watch_kaizen_today';

/** Ionicons slug per Kaizen system, used for the widget's next-habit glyph. */
const SYSTEM_ICON: Record<string, string> = {
  career: 'briefcase-outline',
  learn: 'book-outline',
  assess: 'help-circle-outline',
  health: 'fitness-outline',
  focus: 'timer-outline',
};

const DEFAULT_ICON = 'checkmark-circle-outline';

/** The store slice this producer needs — kept narrow so tests need no full store. */
export interface KaizenSnapshotSource {
  dailyCore: KaizenActionEntry[];
  todayLogs: KaizenActionLogEntry[];
}

/** Normalised view of today, shared by both output shapes. */
export interface KaizenTodayFacts {
  done: number;
  total: number;
  streak: number;
  nextHabit: { title: string; icon: string } | null;
}

export interface KaizenWidgetSnapshot {
  done: number;
  total: number;
  streak: number;
  next_habit: { title: string; icon: string } | null;
}

export interface KaizenWatchSnapshot {
  done: number;
  total: number;
  current_streak: number;
  next_habit: string | null;
}

/**
 * Reduce today's actions + logs into the facts both surfaces render.
 *
 * `done` counts daily-core actions with a non-skipped completion log — the same rule
 * `TodayScreen` uses for its completion ring, so the widget and the app never diverge.
 * `nextHabit` is the first **incomplete** action in persisted `sort_order`.
 */
export function buildKaizenTodayFacts(
  source: KaizenSnapshotSource,
  streak: number,
): KaizenTodayFacts {
  const completed = new Set(
    source.todayLogs
      .filter(log => !log.skipped && log.completed_at)
      .map(log => log.action_id),
  );

  const ordered = [...source.dailyCore].sort((a, b) => a.sort_order - b.sort_order);
  const next = ordered.find(action => !completed.has(action.id)) ?? null;

  return {
    done: ordered.filter(action => completed.has(action.id)).length,
    total: ordered.length,
    // A failed streak read degrades to 0 rather than blocking the whole snapshot.
    streak: Number.isFinite(streak) && streak > 0 ? streak : 0,
    nextHabit: next
      ? { title: next.title, icon: SYSTEM_ICON[next.system] ?? DEFAULT_ICON }
      : null,
  };
}

/** Widget shape: `streak`, and `next_habit` as an object. */
export function toWidgetSnapshot(facts: KaizenTodayFacts): KaizenWidgetSnapshot {
  return {
    done: facts.done,
    total: facts.total,
    streak: facts.streak,
    next_habit: facts.nextHabit ? { ...facts.nextHabit } : null,
  };
}

/** Watch shape: `current_streak`, and `next_habit` as a bare title string. */
export function toWatchSnapshot(facts: KaizenTodayFacts): KaizenWatchSnapshot {
  return {
    done: facts.done,
    total: facts.total,
    current_streak: facts.streak,
    next_habit: facts.nextHabit ? facts.nextHabit.title : null,
  };
}

/**
 * Write both snapshots into the App Group.
 *
 * No-ops when signed out (`userId` empty) so an unauthenticated device never leaves
 * habit data in a store the extensions can read, and when the native `WidgetSync`
 * module is absent (Android / Expo Go), where `setSnapshot` is already a safe no-op.
 */
export async function publishKaizenSnapshots(
  source: KaizenSnapshotSource,
  userId: string | null | undefined,
): Promise<void> {
  if (!userId) return;

  let streak = 0;
  try {
    streak = await computeDailyCoreStreak(userId);
  } catch {
    // Streak is an enrichment — a DB error must not cost us today's done/total.
    streak = 0;
  }

  const facts = buildKaizenTodayFacts(source, streak);
  widgetSync.setSnapshot(KAIZEN_WIDGET_KEY, toWidgetSnapshot(facts));
  widgetSync.setSnapshot(KAIZEN_WATCH_KEY, toWatchSnapshot(facts));
}

/**
 * Publish today's snapshot straight from the local Kaizen DB, with no screen and
 * no store involved.
 *
 * `TodayScreen`'s effect used to be the ONLY producer, which meant the widget and
 * Watch face stayed empty until that screen rendered — and `app/_layout.tsx` does
 * not render the tab shell at all until `isAuthenticated && hasCompletedOnboarding`.
 * A member who was signed in but still part-way through Kaizen's required systems
 * onboarding therefore got a permanently blank widget reading "Sign in to track
 * your habits", which was both wrong and unactionable.
 *
 * Publishing from sign-in as well is also what makes that empty-state copy honest:
 * once a signed-in member always has a snapshot, an ABSENT key means signed out and
 * a `total: 0` snapshot means "no habits set up yet" — the two states the widget
 * already renders different messages for.
 *
 * Kaizen has no household concept, so this is keyed on the user id alone. Reads the
 * same two tables `useKaizenStore.hydrate` reads, and swallows its own failures:
 * a widget refresh must never surface an error or block sign-in.
 */
export async function syncKaizenGlance(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [dailyCore, actionLogs] = await Promise.all([
      getDailyCoreActions(userId),
      listActive<KaizenActionLogEntry>('kaizen_action_logs', userId),
    ]);
    await publishKaizenSnapshots(
      { dailyCore, todayLogs: actionLogs.filter(log => log.date === today) },
      userId,
    );
  } catch {
    // Best-effort surface refresh — never surfaced, never fatal.
  }
}
