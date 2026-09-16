/**
 * Symply Health — FOOD CHALLENGES store.
 *
 * `healthChallengesStorage.ts` shipped with the Dashboard parity phase and had
 * no suite of its own: it was reached only INDIRECTLY, through
 * `HealthTodayChallengesCard.test.tsx` (which mocks the loader outright) and
 * `HealthSectionScreens.test.tsx`. Neither exercises a single pure helper, and
 * neither ever lets a real `readThrough`/`writeThrough` run — so the offline
 * path, the optimistic rows and every derived number below were unpinned.
 *
 * Three layers, matching the other Health store suites
 * (`healthFridgeStorage.test.ts` is the closest sibling):
 *
 *  1. PURE — display glyph/colour resolution, percentages, the week-start
 *     convention, the on-track rule and the widget's bar row.
 *  2. WIRE — the EXACT payload each writer sends the Worker.
 *  3. OFFLINE — cached read, optimistic write, and the rollback when the
 *     server refuses.
 *
 * The load-bearing behaviour pinned here is `isChallengeOnTrack`'s PRO-RATA
 * rule. It is the one piece of judgement in the file: a Tuesday is judged
 * against two sevenths of the week, not the whole of it, so a member two days
 * in is not told they are "Behind" for the only reason that the week is young.
 * A regression that compared against a flat 0.8 would look plausible, would
 * pass every render test, and would call almost every member behind until
 * Saturday.
 */

import { healthApi } from '@api/health';
import { storageHelpers } from '@services/storage';

import {
  challengeDisplayColor,
  challengeDisplayIcon,
  challengePercent,
  CHALLENGE_CATEGORY_META,
  CHALLENGE_CATEGORY_OPTIONS,
  createChallenge,
  dailyMaxPercentBars,
  deleteChallenge,
  HEALTH_CHALLENGES_KEY,
  HEALTH_CHALLENGES_WEEKLY_KEY,
  HEALTH_CHALLENGES_WIDGET_EXPANDED_KEY,
  isChallengeOnTrack,
  isEmojiIcon,
  isoDayOfWeek,
  loadActiveChallenges,
  loadChallenges,
  loadChallengeProgressToday,
  loadChallengesWeeklyOverview,
  loadChallengesWidgetExpanded,
  saveChallengesWidgetExpanded,
  updateChallenge,
  type ChallengeWeeklyOverviewEntry,
  type HealthFoodChallenge,
} from '../healthChallengesStorage';
import { __setHealthOfflineForTests, clearHealthCache } from '../healthRepository';

jest.mock('@api/health', () => {
  const actual = jest.requireActual('@api/health');
  return {
    ...actual,
    healthApi: {
      listChallenges: jest.fn(),
      createChallenge: jest.fn(),
      updateChallenge: jest.fn(),
      deleteChallenge: jest.fn(),
      getChallengeProgressToday: jest.fn(),
      getChallengeWeeklyProgress: jest.fn(),
    },
  };
});

const api = healthApi as unknown as {
  listChallenges: jest.Mock;
  createChallenge: jest.Mock;
  updateChallenge: jest.Mock;
  deleteChallenge: jest.Mock;
  getChallengeProgressToday: jest.Mock;
  getChallengeWeeklyProgress: jest.Mock;
};

const ISO = '2026-07-13T08:00:00.000Z';

function challenge(over: Partial<HealthFoodChallenge> = {}): HealthFoodChallenge {
  return {
    id: 'fchal-1',
    user_id: 'user-1',
    name: 'Vegetables',
    category: 'vegetables',
    target_food_name: null,
    target_grams: 400,
    frequency: 'daily',
    is_active: true,
    icon: null,
    created_at: ISO,
    updated_at: ISO,
    deleted_at: null,
    ...over,
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  __setHealthOfflineForTests(false);
  await clearHealthCache([
    HEALTH_CHALLENGES_KEY,
    HEALTH_CHALLENGES_WEEKLY_KEY,
    'health.challengeToday.v1',
  ]);
  await storageHelpers.delete(HEALTH_CHALLENGES_WIDGET_EXPANDED_KEY);
});

afterEach(() => {
  __setHealthOfflineForTests(false);
});

/* ------------------------------------------------------------------ */
/* 1. PURE                                                             */
/* ------------------------------------------------------------------ */

describe('challenge display metadata', () => {
  it('offers exactly one option per category, in catalogue order', () => {
    expect(CHALLENGE_CATEGORY_OPTIONS.map((o) => o.value)).toEqual(
      Object.keys(CHALLENGE_CATEGORY_META)
    );
  });

  it('every category carries a label, a glyph and a colour — no half-populated entry', () => {
    for (const [key, meta] of Object.entries(CHALLENGE_CATEGORY_META)) {
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.icon.length).toBeGreaterThan(0);
      // A swatch is drawn by concatenating an alpha suffix (`color + '1F'`), so
      // a non-hex colour would render as a transparent blob rather than fail.
      expect(meta.color).toMatch(/^#[0-9A-F]{6}$/i);
      expect(key).toBe(key.toLowerCase());
    }
  });

  it('isEmojiIcon separates an emoji override from an icon-kit slug', () => {
    expect(isEmojiIcon('🥦')).toBe(true);
    expect(isEmojiIcon('leaf')).toBe(false);
    expect(isEmojiIcon('leaf-outline')).toBe(false);
    expect(isEmojiIcon('')).toBe(false);
    expect(isEmojiIcon(null)).toBe(false);
    expect(isEmojiIcon(undefined)).toBe(false);
  });

  it("uses the challenge's own icon when set, else the category's", () => {
    expect(challengeDisplayIcon(challenge({ icon: '🥦' }))).toBe('🥦');
    expect(challengeDisplayIcon(challenge({ icon: null }))).toBe(
      CHALLENGE_CATEGORY_META.vegetables.icon
    );
    // An empty string is an absent override, not a blank glyph.
    expect(challengeDisplayIcon(challenge({ icon: '' }))).toBe(
      CHALLENGE_CATEGORY_META.vegetables.icon
    );
  });

  it("takes the swatch from the CATEGORY even when the icon is overridden", () => {
    // The colour is what groups a list of challenges visually; letting a custom
    // emoji change it would break that grouping.
    expect(challengeDisplayColor(challenge({ category: 'fish', icon: '🥦' }))).toBe(
      CHALLENGE_CATEGORY_META.fish.color
    );
  });
});

describe('challengePercent', () => {
  it('renders the payload fraction as a whole percent', () => {
    expect(challengePercent(150 / 400)).toBe(38);
    expect(challengePercent(0)).toBe(0);
    expect(challengePercent(1)).toBe(100);
  });

  it('does NOT cap an overshoot — 140% is a real reading, same as the donor', () => {
    expect(challengePercent(560 / 400)).toBe(140);
  });

  it('treats a non-finite fraction as zero rather than rendering NaN%', () => {
    expect(challengePercent(Number.NaN)).toBe(0);
    expect(challengePercent(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('isoDayOfWeek', () => {
  it('puts Monday at 1 and Sunday at 7 — this app’s fixed week start', () => {
    // 2026-07-13 is a Monday.
    expect(isoDayOfWeek('2026-07-13')).toBe(1);
    expect(isoDayOfWeek('2026-07-14')).toBe(2);
    expect(isoDayOfWeek('2026-07-18')).toBe(6);
    // Sunday must be 7, not JavaScript's 0 — the on-track maths divides by it.
    expect(isoDayOfWeek('2026-07-19')).toBe(7);
  });
});

describe('isChallengeOnTrack', () => {
  it('judges a young week against its own elapsed share, not the whole week', () => {
    // Monday: expected = (1/7) * 0.8 ≈ 0.114. A tenth of the week banked on day
    // one is BEHIND; a fifth is on track.
    expect(isChallengeOnTrack(0.1, '2026-07-13')).toBe(false);
    expect(isChallengeOnTrack(0.2, '2026-07-13')).toBe(true);
  });

  it('only demands the full 80% on Sunday', () => {
    expect(isChallengeOnTrack(0.79, '2026-07-19')).toBe(false);
    expect(isChallengeOnTrack(0.8, '2026-07-19')).toBe(true);
    // ...and that same 0.79 is comfortably on track mid-week, which is the
    // whole point of the pro-rata rule.
    expect(isChallengeOnTrack(0.79, '2026-07-15')).toBe(true);
  });

  it('meets the boundary exactly rather than missing it by a rounding error', () => {
    // Wednesday = day 3 → expected exactly (3/7)*0.8.
    expect(isChallengeOnTrack((3 / 7) * 0.8, '2026-07-15')).toBe(true);
  });

  it('treats a non-finite fraction as zero progress', () => {
    expect(isChallengeOnTrack(Number.NaN, '2026-07-15')).toBe(false);
  });
});

describe('dailyMaxPercentBars', () => {
  const week = ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19'];

  function entry(
    fractions: number[],
    over: Partial<ChallengeWeeklyOverviewEntry> = {}
  ): ChallengeWeeklyOverviewEntry {
    return {
      challenge: challenge(),
      dailyProgress: week.map((date, i) => ({
        date,
        consumed_grams: 0,
        target_grams: 400,
        progress_percentage: fractions[i] ?? 0,
        completed: (fractions[i] ?? 0) >= 1,
      })) as ChallengeWeeklyOverviewEntry['dailyProgress'],
      weeklyTotalGrams: 0,
      weeklyTargetGrams: 2800,
      weeklyProgressFraction: 0,
      ...over,
    };
  }

  it('takes the MAX across challenges per day, not the average', () => {
    // A day where one challenge was smashed and another ignored is a good day.
    const bars = dailyMaxPercentBars(
      [entry([1, 0, 0, 0, 0, 0, 0]), entry([0, 0, 0, 0, 0, 0, 0])],
      '2026-07-19'
    );
    expect(bars[0].value).toBe(100);
  });

  it('caps a bar at 100% even though the underlying percent is uncapped', () => {
    const bars = dailyMaxPercentBars([entry([1.4, 0, 0, 0, 0, 0, 0])], '2026-07-19');
    expect(bars[0].value).toBe(100);
  });

  it('suppresses days after today to 0 rather than drawing them as "behind"', () => {
    const bars = dailyMaxPercentBars([entry([1, 1, 1, 1, 1, 1, 1])], '2026-07-15');
    expect(bars.map((b) => b.value)).toEqual([100, 100, 100, 0, 0, 0, 0]);
  });

  it('reads day dates from the first entry and matches every other by INDEX', () => {
    const bars = dailyMaxPercentBars([entry([0.5, 0, 0, 0, 0, 0, 0])], '2026-07-19');
    expect(bars).toHaveLength(7);
    expect(bars[0].label).toBe('13 Jul');
    expect(bars[0].value).toBe(50);
  });

  it('returns no bars at all when there is no active challenge', () => {
    expect(dailyMaxPercentBars([], '2026-07-19')).toEqual([]);
  });

  it('survives a shorter series on a later entry rather than throwing', () => {
    const short = entry([]);
    short.dailyProgress = [];
    const bars = dailyMaxPercentBars([entry([0.5, 0, 0, 0, 0, 0, 0]), short], '2026-07-19');
    expect(bars[0].value).toBe(50);
  });

  it('treats a non-finite daily fraction as zero', () => {
    const bars = dailyMaxPercentBars([entry([Number.NaN, 0, 0, 0, 0, 0, 0])], '2026-07-19');
    expect(bars[0].value).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* 2. WIRE                                                             */
/* ------------------------------------------------------------------ */

describe('the payload each writer sends', () => {
  it('createChallenge posts the draft through untouched and re-reads the list', async () => {
    api.listChallenges.mockResolvedValue({ challenges: [] });
    api.createChallenge.mockResolvedValue({});

    const write = {
      name: 'Eat more veg',
      category: 'vegetables' as const,
      target_food_name: null,
      target_grams: 500,
      frequency: 'daily' as const,
      is_active: true,
    };
    await createChallenge(write);

    expect(api.createChallenge).toHaveBeenCalledWith(write);
    // The re-read is what makes the returned list authoritative rather than
    // the optimistic guess.
    expect(api.listChallenges).toHaveBeenCalled();
  });

  it('updateChallenge sends only the patched fields, against the id', async () => {
    api.listChallenges.mockResolvedValue({ challenges: [challenge()] });
    api.updateChallenge.mockResolvedValue({});

    await updateChallenge('fchal-1', { is_active: false });

    expect(api.updateChallenge).toHaveBeenCalledWith('fchal-1', { is_active: false });
  });

  it('deleteChallenge addresses the row by id', async () => {
    api.listChallenges.mockResolvedValue({ challenges: [] });
    api.deleteChallenge.mockResolvedValue({});

    await deleteChallenge('fchal-1');

    expect(api.deleteChallenge).toHaveBeenCalledWith('fchal-1');
  });

  it('the weekly overview asks for ACTIVE challenges only, then fans out per id', async () => {
    const a = challenge({ id: 'a' });
    const b = challenge({ id: 'b', name: 'Fish', category: 'fish' });
    api.listChallenges.mockResolvedValue({ challenges: [a, b] });
    api.getChallengeWeeklyProgress.mockImplementation((id: string) =>
      Promise.resolve({
        challenge: id === 'a' ? a : b,
        daily_progress: [],
        weekly_total_grams: 100,
        weekly_target_grams: 2800,
        weekly_progress_percentage: 100 / 2800,
      })
    );

    const overview = await loadChallengesWeeklyOverview();

    expect(api.listChallenges).toHaveBeenCalledWith({ active: true });
    expect(api.getChallengeWeeklyProgress).toHaveBeenCalledTimes(2);
    expect(overview.map((e) => e.challenge.id)).toEqual(['a', 'b']);
    // The server's own fraction is carried straight through — the widget never
    // re-derives it from the gram totals.
    expect(overview[0].weeklyProgressFraction).toBeCloseTo(100 / 2800);
  });
});

/* ------------------------------------------------------------------ */
/* 3. OFFLINE / OPTIMISTIC                                             */
/* ------------------------------------------------------------------ */

describe('reads', () => {
  it('loadChallenges returns the server list and caches it', async () => {
    api.listChallenges.mockResolvedValue({ challenges: [challenge()] });
    expect(await loadChallenges()).toHaveLength(1);

    // Second read, now offline, must come from that cache rather than blank.
    __setHealthOfflineForTests(true);
    expect(await loadChallenges()).toHaveLength(1);
  });

  it('falls back to an empty list — never undefined — when the Worker omits the key', async () => {
    api.listChallenges.mockResolvedValue({});
    expect(await loadChallenges()).toEqual([]);
  });

  it('a cold offline read yields the empty fallback rather than throwing', async () => {
    __setHealthOfflineForTests(true);
    expect(await loadChallenges()).toEqual([]);
  });

  it('loadActiveChallenges filters the SAME cached list rather than re-fetching', async () => {
    api.listChallenges.mockResolvedValue({
      challenges: [challenge({ id: 'on' }), challenge({ id: 'off', is_active: false })],
    });

    const active = await loadActiveChallenges();

    expect(active.map((c) => c.id)).toEqual(['on']);
  });

  it("today's progress resolves null when nothing is cached and the Worker is unreachable", async () => {
    __setHealthOfflineForTests(true);
    expect(await loadChallengeProgressToday()).toBeNull();
  });

  it("today's progress passes an explicit date straight through", async () => {
    api.getChallengeProgressToday.mockResolvedValue({
      date: '2026-07-14',
      challenges: [],
      completed_count: 0,
      total_count: 0,
    });

    await loadChallengeProgressToday('2026-07-14');

    expect(api.getChallengeProgressToday).toHaveBeenCalledWith('2026-07-14');
  });
});

describe('optimistic writes', () => {
  it('a created challenge appears FIRST, before the server answers', async () => {
    api.listChallenges.mockResolvedValue({ challenges: [challenge({ id: 'existing' })] });
    // Warm the cache while still online, THEN go offline — the optimistic list
    // is built on top of what was already known, so an empty cache would prove
    // nothing about ordering.
    await loadChallenges();
    __setHealthOfflineForTests(true);

    const next = await createChallenge({
      name: 'Fish twice a week',
      category: 'fish',
      target_food_name: null,
      target_grams: 300,
      frequency: 'weekly',
      is_active: true,
    });

    expect(next[0].name).toBe('Fish twice a week');
    expect(next[0].id).toMatch(/^local-/);
    expect(next.map((c) => c.id)).toContain('existing');
  });

  it('the optimistic row trims the name, so a stray space never renders', async () => {
    api.listChallenges.mockResolvedValue({ challenges: [] });
    __setHealthOfflineForTests(true);

    const next = await createChallenge({
      name: '  Leafy greens  ',
      category: 'vegetables',
      target_food_name: null,
      target_grams: 200,
      frequency: 'daily',
      is_active: true,
    });

    expect(next[0].name).toBe('Leafy greens');
  });

  it('an update is reflected on the matching row only', async () => {
    api.listChallenges.mockResolvedValue({
      challenges: [challenge({ id: 'a' }), challenge({ id: 'b', name: 'Fish' })],
    });
    await loadChallenges();
    __setHealthOfflineForTests(true);

    const next = await updateChallenge('a', { is_active: false });

    expect(next.find((c) => c.id === 'a')?.is_active).toBe(false);
    expect(next.find((c) => c.id === 'b')?.is_active).toBe(true);
  });

  it('a delete drops the row from the optimistic list', async () => {
    api.listChallenges.mockResolvedValue({
      challenges: [challenge({ id: 'a' }), challenge({ id: 'b' })],
    });
    await loadChallenges();
    __setHealthOfflineForTests(true);

    const next = await deleteChallenge('a');

    expect(next.map((c) => c.id)).toEqual(['b']);
  });

  it('a SERVER REFUSAL rolls back rather than leaving a phantom challenge', async () => {
    api.listChallenges.mockResolvedValue({ challenges: [challenge({ id: 'a' })] });
    await loadChallenges();
    // The write is rejected; the re-read never happens, so the cache must still
    // describe the world as the server sees it.
    api.createChallenge.mockRejectedValue(new Error('422'));

    await createChallenge({
      name: 'Rejected',
      category: 'nuts',
      target_food_name: null,
      target_grams: 30,
      frequency: 'daily',
      is_active: true,
    });

    api.listChallenges.mockResolvedValue({ challenges: [challenge({ id: 'a' })] });
    const after = await loadChallenges();
    expect(after.map((c) => c.name)).toEqual(['Vegetables']);
  });
});

describe('widget expand/collapse', () => {
  it('defaults to EXPANDED, matching the donor’s @AppStorage default', async () => {
    expect(await loadChallengesWidgetExpanded()).toBe(true);
  });

  it('round-trips a collapse', async () => {
    await saveChallengesWidgetExpanded(false);
    expect(await loadChallengesWidgetExpanded()).toBe(false);

    await saveChallengesWidgetExpanded(true);
    expect(await loadChallengesWidgetExpanded()).toBe(true);
  });
});
