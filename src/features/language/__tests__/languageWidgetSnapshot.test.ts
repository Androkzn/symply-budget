/**
 * Language widget + Watch snapshot producer.
 *
 * Matrix: LANG-WIDGET-001…010
 * (documents/engineering/testing/matrices/language.md)
 *
 * These lock the two App Group JSON contracts the Swift surfaces decode. The shapes
 * deliberately differ (`xp` + object vs `xp_today` + string); a rename on either side
 * must fail here rather than silently emptying a widget in the field.
 *
 * Background: `widget_language_today` used to be written by one inline effect in
 * `LanguageLearnScreen` — a screen `app/_layout.tsx` never mounts until onboarding
 * completes — and `watch_language_today` had no writer at all.
 */
import { widgetSync } from '@services/widget-sync';

import { languageAssessmentApi } from '../api/languageAssessment';
import { languageCardsApi } from '../api/languageCards';
import { languagePlanApi } from '../api/languagePlan';
import { loadStreak } from '../languageLocalStorage';
import {
  LANGUAGE_WATCH_KEY,
  LANGUAGE_WIDGET_KEY,
  buildLanguageTodayFacts,
  publishLanguageSnapshots,
  syncLanguageGlance,
  toLanguageWatchSnapshot,
  toLanguageWidgetSnapshot,
} from '../languageWidgetSnapshot';

jest.mock('@services/widget-sync', () => ({
  widgetSync: { setSnapshot: jest.fn(), clear: jest.fn(), isAvailable: jest.fn(() => true) },
}));
jest.mock('../languageLocalStorage', () => ({ loadStreak: jest.fn() }));
jest.mock('../api/languageAssessment', () => ({ languageAssessmentApi: { getStatus: jest.fn() } }));
jest.mock('../api/languagePlan', () => ({ languagePlanApi: { getCurrent: jest.fn() } }));
jest.mock('../api/languageCards', () => ({ languageCardsApi: { due: jest.fn() } }));

const mockSetSnapshot = widgetSync.setSnapshot as jest.Mock;
const mockLoadStreak = loadStreak as jest.Mock;
const mockGetStatus = languageAssessmentApi.getStatus as jest.Mock;
const mockGetPlan = languagePlanApi.getCurrent as jest.Mock;
const mockDue = languageCardsApi.due as jest.Mock;

const SOURCE = { streak: 4, wordsDue: 9, assessmentDue: false, hasPlan: true };

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadStreak.mockResolvedValue({ count: 4, lastCompletedDate: '2026-08-09' });
  mockGetStatus.mockResolvedValue({ due: false });
  mockGetPlan.mockResolvedValue({ id: 'plan-1' });
  mockDue.mockResolvedValue({ dueCards: [], totalDue: 9 });
});

describe('buildLanguageTodayFacts', () => {
  it('LANG-WIDGET-001: follows the same next-step precedence as the screen CTA', () => {
    // Assessment outranks an existing plan.
    expect(
      buildLanguageTodayFacts({ ...SOURCE, assessmentDue: true, hasPlan: true }).nextLesson.title,
    ).toBe('Take your assessment');
    expect(
      buildLanguageTodayFacts({ ...SOURCE, assessmentDue: false, hasPlan: true }).nextLesson.title,
    ).toBe('Continue your lesson');
    expect(
      buildLanguageTodayFacts({ ...SOURCE, assessmentDue: false, hasPlan: false }).nextLesson.title,
    ).toBe('Start a plan');
  });

  it('LANG-WIDGET-002: every next-step carries an Ionicons slug the shared kit maps', () => {
    // `Ionicon.symbol` (WidgetTheme.swift) falls back to "sparkles" for anything it
    // does not know, so an unmapped slug degrades silently — assert the real ones.
    const slugs = [
      buildLanguageTodayFacts({ ...SOURCE, assessmentDue: true }).nextLesson.icon,
      buildLanguageTodayFacts({ ...SOURCE, hasPlan: true }).nextLesson.icon,
      buildLanguageTodayFacts({ ...SOURCE, hasPlan: false }).nextLesson.icon,
    ];

    expect(slugs).toEqual(['help-circle-outline', 'book-outline', 'bulb-outline']);
  });

  it('LANG-WIDGET-003: clamps negative / non-finite counts to 0', () => {
    const facts = buildLanguageTodayFacts({
      ...SOURCE,
      streak: -3,
      wordsDue: Number.NaN,
    });

    expect(facts.streak).toBe(0);
    expect(facts.wordsDue).toBe(0);
  });
});

describe('snapshot shapes', () => {
  const facts = buildLanguageTodayFacts(SOURCE);

  it('LANG-WIDGET-004: emits exactly the widget contract keys', () => {
    const snapshot = toLanguageWidgetSnapshot(facts);

    expect(Object.keys(snapshot).sort()).toEqual([
      'next_lesson',
      'streak',
      'words_due',
      'xp',
      'xp_goal',
    ]);
    // `next_lesson` is an OBJECT here — LanguageWidgetData.NextLesson decodes {title, icon}.
    expect(snapshot.next_lesson).toEqual({ title: 'Continue your lesson', icon: 'book-outline' });
  });

  it('LANG-WATCH-001: emits exactly the watch contract keys', () => {
    const snapshot = toLanguageWatchSnapshot(facts);

    expect(Object.keys(snapshot).sort()).toEqual([
      'next_lesson',
      'streak',
      'words_due',
      'xp_goal',
      'xp_today',
    ]);
    // `next_lesson` is a STRING here, and the XP field is `xp_today`, not `xp`.
    expect(snapshot.next_lesson).toBe('Continue your lesson');
    expect((snapshot as unknown as Record<string, unknown>).xp).toBeUndefined();
  });

  /**
   * Language has no XP concept — its daily model is three booleans (review / speak /
   * learn). Deriving an "XP" number from a goal count would be inventing data, so both
   * shapes pin XP at 0 and `LanguageWidgetData.hasXP` gates the widget's tiles off.
   */
  it('LANG-WIDGET-005: pins XP at 0 in both shapes — Language has no XP source', () => {
    expect(toLanguageWidgetSnapshot(facts).xp).toBe(0);
    expect(toLanguageWidgetSnapshot(facts).xp_goal).toBe(0);
    expect(toLanguageWatchSnapshot(facts).xp_today).toBe(0);
    expect(toLanguageWatchSnapshot(facts).xp_goal).toBe(0);
  });

  it('LANG-WIDGET-006: keeps the two surfaces consistent', () => {
    const widget = toLanguageWidgetSnapshot(facts);
    const watch = toLanguageWatchSnapshot(facts);

    expect(watch.streak).toBe(widget.streak);
    expect(watch.words_due).toBe(widget.words_due);
    expect(watch.next_lesson).toBe(widget.next_lesson?.title);
  });

  it('LANG-WIDGET-007: leaks no tokens, emails or ids', () => {
    const serialised = JSON.stringify([
      toLanguageWidgetSnapshot(facts),
      toLanguageWatchSnapshot(facts),
    ]);

    for (const forbidden of ['user_id', 'household', 'token', 'jwt', '@', 'email']) {
      expect(serialised.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe('publishLanguageSnapshots', () => {
  it('LANG-WIDGET-008: writes both App Group keys', () => {
    publishLanguageSnapshots(SOURCE, 'user-1');

    expect(mockSetSnapshot).toHaveBeenCalledTimes(2);
    expect(mockSetSnapshot).toHaveBeenCalledWith(LANGUAGE_WIDGET_KEY, expect.any(Object));
    expect(mockSetSnapshot).toHaveBeenCalledWith(LANGUAGE_WATCH_KEY, expect.any(Object));
  });

  it('LANG-WIDGET-009: writes nothing when signed out', () => {
    publishLanguageSnapshots(SOURCE, null);
    publishLanguageSnapshots(SOURCE, undefined);
    publishLanguageSnapshots(SOURCE, '');

    expect(mockSetSnapshot).not.toHaveBeenCalled();
  });
});

/**
 * The screen-independent producer — the sign-in path that fixes both dead surfaces.
 */
describe('syncLanguageGlance', () => {
  it('LANG-WIDGET-010: publishes from local streak + backend state, no screen mounted', async () => {
    await syncLanguageGlance('user-1');

    expect(mockSetSnapshot).toHaveBeenCalledWith(LANGUAGE_WIDGET_KEY, {
      streak: 4,
      xp: 0,
      xp_goal: 0,
      words_due: 9,
      next_lesson: { title: 'Continue your lesson', icon: 'book-outline' },
    });
    expect(mockSetSnapshot).toHaveBeenCalledWith(LANGUAGE_WATCH_KEY, {
      streak: 4,
      xp_today: 0,
      xp_goal: 0,
      words_due: 9,
      next_lesson: 'Continue your lesson',
    });
  });

  /**
   * Each remote read degrades INDEPENDENTLY: one dead endpoint must not cost the
   * learner the whole snapshot, which is what leaves a widget looking signed-out.
   */
  it('LANG-WIDGET-010: still publishes when every backend read fails', async () => {
    mockGetStatus.mockRejectedValue(new Error('down'));
    mockGetPlan.mockRejectedValue(new Error('down'));
    mockDue.mockRejectedValue(new Error('down'));

    await syncLanguageGlance('user-1');

    expect(mockSetSnapshot).toHaveBeenCalledTimes(2);
    expect(mockSetSnapshot).toHaveBeenCalledWith(LANGUAGE_WIDGET_KEY, {
      streak: 4, // the local read still succeeded
      xp: 0,
      xp_goal: 0,
      words_due: 0,
      // No status read ⇒ must NOT nag about an assessment we cannot confirm is due.
      next_lesson: { title: 'Start a plan', icon: 'bulb-outline' },
    });
  });

  it('LANG-WIDGET-010: survives a failing local streak read', async () => {
    mockLoadStreak.mockRejectedValue(new Error('storage gone'));

    await syncLanguageGlance('user-1');

    expect(mockSetSnapshot).toHaveBeenCalledTimes(2);
    expect(mockSetSnapshot.mock.calls[0][1].streak).toBe(0);
  });

  it('LANG-WIDGET-009: no-ops when signed out', async () => {
    await syncLanguageGlance(null);
    await syncLanguageGlance('');

    expect(mockLoadStreak).not.toHaveBeenCalled();
    expect(mockSetSnapshot).not.toHaveBeenCalled();
  });
});
