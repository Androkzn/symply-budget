/**
 * Language widget + Watch snapshot producer.
 *
 * Language's home-screen widget (`SymplyLanguageWidgetContent.swift`) and Watch face
 * (`SymplyLanguageWatchView.swift`) both read today's session out of the shared App
 * Group. Before this module existed the picture matched the Kaizen/Budget defect:
 *
 *   - `widget_language_today` was written by ONE inline effect in `LanguageLearnScreen`,
 *     and `app/_layout.tsx` does not mount the tab shell that hosts it until
 *     `isAuthenticated && hasCompletedOnboarding` — so a signed-in learner who had not
 *     finished onboarding saw "Sign in to track your streak" forever.
 *   - `watch_language_today` had **no** writer at all, so `SymplyLanguageWatchView` was
 *     permanently stuck on its empty state.
 *
 * The two consumers use **different** field shapes; both are written from one source of
 * truth here so the surfaces can never disagree about today:
 *
 *   widget_language_today  { streak, xp,       xp_goal, words_due, next_lesson: { title, icon } | null }
 *   watch_language_today   { streak, xp_today, xp_goal, words_due, next_lesson: string | null }
 *
 * **XP is deliberately always 0.** Language has no XP concept — its daily model is three
 * boolean goals (review / speak / learn), and mapping a goal count onto a field the
 * surfaces label "XP" would be inventing data. `LanguageWidgetData.hasXP` already gates
 * the widget's XP tiles off for exactly this reason. (The Watch's XP tile has no such
 * gate and will read 0 — a pre-existing Watch design assumption, tracked separately.)
 *
 * Only counts and a lesson title ever leave the app — the App Group is readable by
 * extensions, so no token, email or id may be written here.
 */
import { widgetSync } from '@services/widget-sync';

import { languageAssessmentApi } from './api/languageAssessment';
import { languageCardsApi } from './api/languageCards';
import { languagePlanApi } from './api/languagePlan';
import { loadStreak } from './languageLocalStorage';

/** App Group key read by `SymplyLanguageWidgetContent.swift`. */
export const LANGUAGE_WIDGET_KEY = 'widget_language_today';

/** App Group key read by `SymplyLanguageWatchView.swift`. */
export const LANGUAGE_WATCH_KEY = 'watch_language_today';

/**
 * What the learner should do next, in priority order. Icons are Ionicons slugs the
 * shared kit maps to SF Symbols via `Ionicon.symbol`.
 */
const NEXT_ASSESSMENT = { title: 'Take your assessment', icon: 'help-circle-outline' };
const NEXT_LESSON = { title: 'Continue your lesson', icon: 'book-outline' };
const NEXT_PLAN = { title: 'Start a plan', icon: 'bulb-outline' };

/** The inputs both output shapes are derived from. */
export interface LanguageSnapshotSource {
  streak: number;
  wordsDue: number;
  assessmentDue: boolean;
  hasPlan: boolean;
}

/** Normalised view of today, shared by both output shapes. */
export interface LanguageTodayFacts {
  streak: number;
  wordsDue: number;
  nextLesson: { title: string; icon: string };
}

export interface LanguageWidgetSnapshot {
  streak: number;
  xp: number;
  xp_goal: number;
  words_due: number;
  next_lesson: { title: string; icon: string } | null;
}

export interface LanguageWatchSnapshot {
  streak: number;
  xp_today: number;
  xp_goal: number;
  words_due: number;
  next_lesson: string | null;
}

/** Clamp a possibly-absent or nonsensical count to a non-negative integer. */
function count(value: number | null | undefined): number {
  return Number.isFinite(value) && (value as number) > 0 ? Math.floor(value as number) : 0;
}

/**
 * Reduce today's state into the facts both surfaces render.
 *
 * `nextLesson` follows the same precedence as `LanguageLearnScreen`'s own CTA, so the
 * widget never suggests a different next step than the app does: an outstanding
 * assessment first, then continuing an existing plan, then creating one.
 */
export function buildLanguageTodayFacts(source: LanguageSnapshotSource): LanguageTodayFacts {
  return {
    streak: count(source.streak),
    wordsDue: count(source.wordsDue),
    nextLesson: source.assessmentDue
      ? NEXT_ASSESSMENT
      : source.hasPlan
        ? NEXT_LESSON
        : NEXT_PLAN,
  };
}

/** Widget shape: `xp`, and `next_lesson` as an object. */
export function toLanguageWidgetSnapshot(facts: LanguageTodayFacts): LanguageWidgetSnapshot {
  return {
    streak: facts.streak,
    xp: 0,
    xp_goal: 0,
    words_due: facts.wordsDue,
    next_lesson: { ...facts.nextLesson },
  };
}

/** Watch shape: `xp_today`, and `next_lesson` as a bare title string. */
export function toLanguageWatchSnapshot(facts: LanguageTodayFacts): LanguageWatchSnapshot {
  return {
    streak: facts.streak,
    xp_today: 0,
    xp_goal: 0,
    words_due: facts.wordsDue,
    next_lesson: facts.nextLesson.title,
  };
}

/**
 * Write both snapshots into the App Group.
 *
 * No-ops when signed out (`userId` empty) so an unauthenticated device never leaves
 * session data in a store the extensions can read, and when the native `WidgetSync`
 * module is absent (Android / Expo Go), where `setSnapshot` is already a safe no-op.
 */
export function publishLanguageSnapshots(
  source: LanguageSnapshotSource,
  userId: string | null | undefined,
): void {
  if (!userId) return;
  const facts = buildLanguageTodayFacts(source);
  widgetSync.setSnapshot(LANGUAGE_WIDGET_KEY, toLanguageWidgetSnapshot(facts));
  widgetSync.setSnapshot(LANGUAGE_WATCH_KEY, toLanguageWatchSnapshot(facts));
}

/**
 * Publish today's snapshot with no screen mounted — the sign-in path.
 *
 * The streak is local (`loadStreak`); the due-count and plan/assessment state come from
 * the donor backend. Each remote read degrades to its safe default INDEPENDENTLY, so a
 * single failing endpoint still yields a snapshot built from everything else rather than
 * leaving both surfaces empty. Swallows its own failures: a widget refresh must never
 * surface an error or block sign-in.
 */
export async function syncLanguageGlance(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  try {
    const [streak, status, plan, due] = await Promise.all([
      loadStreak().catch(() => ({ count: 0, lastCompletedDate: null })),
      languageAssessmentApi.getStatus().catch(() => null),
      languagePlanApi.getCurrent().catch(() => null),
      languageCardsApi.due().catch(() => null),
    ]);

    publishLanguageSnapshots(
      {
        streak: streak?.count ?? 0,
        wordsDue: due?.totalDue ?? 0,
        // No status read ⇒ do not nag about an assessment we cannot confirm is due.
        assessmentDue: status?.due ?? false,
        hasPlan: !!plan,
      },
      userId,
    );
  } catch {
    // Best-effort surface refresh — never surfaced, never fatal.
  }
}
