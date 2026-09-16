/**
 * Kaizen widget + Watch snapshot producer.
 *
 * Matrix: KAIZEN-WIDGET-001…012, KAIZEN-WIDGET-023…026, KAIZEN-WATCH-001…006
 * (documents/engineering/testing/matrices/kaizen.md)
 *
 * These lock the two App Group JSON contracts the Swift surfaces decode. The shapes
 * deliberately differ (`streak` + object vs `current_streak` + string); a rename on
 * either side must fail here rather than silently emptying a widget in the field.
 */
import widgetSync from '@services/widget-sync';

import type { KaizenActionEntry, KaizenActionLogEntry } from '../../types';
import {
  KAIZEN_WATCH_KEY,
  KAIZEN_WIDGET_KEY,
  buildKaizenTodayFacts,
  publishKaizenSnapshots,
  syncKaizenGlance,
  toWatchSnapshot,
  toWidgetSnapshot,
} from '../kaizenWidgetSnapshot';
import { getDailyCoreActions, listActive } from '../repository';
import { computeDailyCoreStreak } from '../streak';

jest.mock('@services/widget-sync', () => ({
  __esModule: true,
  default: { setSnapshot: jest.fn(), clear: jest.fn(), isAvailable: jest.fn(() => true) },
}));
jest.mock('../streak', () => ({ computeDailyCoreStreak: jest.fn() }));
jest.mock('../repository', () => ({
  getDailyCoreActions: jest.fn(),
  listActive: jest.fn(),
}));

const mockSetSnapshot = widgetSync.setSnapshot as jest.Mock;
const mockStreak = computeDailyCoreStreak as jest.Mock;
const mockDailyCore = getDailyCoreActions as jest.Mock;
const mockListActive = listActive as jest.Mock;

function action(id: string, overrides: Partial<KaizenActionEntry> = {}): KaizenActionEntry {
  return {
    id,
    user_id: 'user-1',
    title: `Habit ${id}`,
    system: 'career',
    rhythm: 'daily',
    linked_feature: null,
    is_daily_core: 1,
    sort_order: 0,
    time_of_day: 'morning',
    stack_id: null,
    rotation_day: null,
    reminder_anchor: null,
    reminder_policy: null,
    watch_quick_log_enabled: 0,
    voice_log_prompt: null,
    input_description: null,
    output_description: null,
    is_archived: 0,
    created_at: '2026-07-20T00:00:00.000Z',
    updated_at: '2026-07-20T00:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

function log(actionId: string, overrides: Partial<KaizenActionLogEntry> = {}): KaizenActionLogEntry {
  return {
    id: `log-${actionId}`,
    user_id: 'user-1',
    action_id: actionId,
    date: '2026-07-20',
    completed_at: '2026-07-20T08:00:00.000Z',
    skipped: 0,
    skip_reason: null,
    source: 'app',
    notes: null,
    created_at: '2026-07-20T08:00:00.000Z',
    updated_at: '2026-07-20T08:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStreak.mockResolvedValue(0);
  mockDailyCore.mockResolvedValue([]);
  mockListActive.mockResolvedValue([]);
});

describe('buildKaizenTodayFacts', () => {
  it('counts completed daily-core actions (KAIZEN-WIDGET-003)', () => {
    const facts = buildKaizenTodayFacts(
      {
        dailyCore: [action('a'), action('b', { sort_order: 1 }), action('c', { sort_order: 2 })],
        todayLogs: [log('a'), log('b')],
      },
      0,
    );

    expect(facts.done).toBe(2);
    expect(facts.total).toBe(3);
  });

  it('excludes skipped and uncompleted logs from done (KAIZEN-WIDGET-003)', () => {
    const facts = buildKaizenTodayFacts(
      {
        dailyCore: [action('a'), action('b', { sort_order: 1 })],
        todayLogs: [
          log('a', { skipped: 1, completed_at: null }),
          log('b', { completed_at: null }),
        ],
      },
      0,
    );

    expect(facts.done).toBe(0);
    expect(facts.total).toBe(2);
  });

  it('picks the first incomplete action in sort_order (KAIZEN-WIDGET-005)', () => {
    const facts = buildKaizenTodayFacts(
      {
        // Deliberately out of order — the producer must sort, not trust array order.
        dailyCore: [
          action('c', { sort_order: 2, title: 'Third' }),
          action('a', { sort_order: 0, title: 'First' }),
          action('b', { sort_order: 1, title: 'Second' }),
        ],
        todayLogs: [log('a')],
      },
      0,
    );

    expect(facts.nextHabit).toEqual({ title: 'Second', icon: 'briefcase-outline' });
  });

  it('returns a null next habit when everything is done (KAIZEN-WIDGET-006)', () => {
    const facts = buildKaizenTodayFacts(
      { dailyCore: [action('a')], todayLogs: [log('a')] },
      3,
    );

    expect(facts.nextHabit).toBeNull();
    expect(facts.done).toBe(1);
  });

  it('maps the system to an icon, falling back for unknown systems', () => {
    const known = buildKaizenTodayFacts(
      { dailyCore: [action('a', { system: 'learn' })], todayLogs: [] },
      0,
    );
    const unknown = buildKaizenTodayFacts(
      { dailyCore: [action('a', { system: 'not-a-system' })], todayLogs: [] },
      0,
    );

    expect(known.nextHabit?.icon).toBe('book-outline');
    expect(unknown.nextHabit?.icon).toBe('checkmark-circle-outline');
  });

  it('clamps a non-finite or negative streak to 0 (KAIZEN-WIDGET-008)', () => {
    const source = { dailyCore: [action('a')], todayLogs: [] };

    expect(buildKaizenTodayFacts(source, Number.NaN).streak).toBe(0);
    expect(buildKaizenTodayFacts(source, -4).streak).toBe(0);
    expect(buildKaizenTodayFacts(source, 7).streak).toBe(7);
  });

  it('handles an empty daily core without dividing by zero', () => {
    const facts = buildKaizenTodayFacts({ dailyCore: [], todayLogs: [] }, 0);

    expect(facts).toEqual({ done: 0, total: 0, streak: 0, nextHabit: null });
  });
});

describe('snapshot shapes', () => {
  const facts = {
    done: 3,
    total: 5,
    streak: 12,
    nextHabit: { title: 'Meditate', icon: 'leaf-outline' },
  };

  it('emits exactly the widget contract keys (KAIZEN-WIDGET-002)', () => {
    const snapshot = toWidgetSnapshot(facts);

    expect(Object.keys(snapshot).sort()).toEqual(['done', 'next_habit', 'streak', 'total']);
    // `next_habit` is an OBJECT here — KaizenWidgetData.NextHabit decodes {title, icon}.
    expect(snapshot.next_habit).toEqual({ title: 'Meditate', icon: 'leaf-outline' });
    expect(snapshot.streak).toBe(12);
  });

  it('emits exactly the watch contract keys (KAIZEN-WATCH-002)', () => {
    const snapshot = toWatchSnapshot(facts);

    expect(Object.keys(snapshot).sort()).toEqual([
      'current_streak',
      'done',
      'next_habit',
      'total',
    ]);
    // `next_habit` is a STRING here, and the streak field is `current_streak`.
    expect(snapshot.next_habit).toBe('Meditate');
    expect(snapshot.current_streak).toBe(12);
    expect((snapshot as unknown as Record<string, unknown>).streak).toBeUndefined();
  });

  it('nulls next_habit in both shapes when nothing is left (WIDGET-006 / WATCH-004)', () => {
    const done = { done: 5, total: 5, streak: 2, nextHabit: null };

    expect(toWidgetSnapshot(done).next_habit).toBeNull();
    expect(toWatchSnapshot(done).next_habit).toBeNull();
  });

  it('keeps the two surfaces consistent (KAIZEN-WATCH-003)', () => {
    const widget = toWidgetSnapshot(facts);
    const watch = toWatchSnapshot(facts);

    expect(watch.done).toBe(widget.done);
    expect(watch.total).toBe(widget.total);
    expect(watch.current_streak).toBe(widget.streak);
    expect(watch.next_habit).toBe(widget.next_habit?.title);
  });

  it('leaks no tokens, emails or ids (KAIZEN-WIDGET-010 / WATCH-006)', () => {
    const serialised = JSON.stringify([toWidgetSnapshot(facts), toWatchSnapshot(facts)]);

    for (const forbidden of ['user_id', 'household', 'token', 'jwt', '@', 'email']) {
      expect(serialised.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe('publishKaizenSnapshots', () => {
  const source = {
    dailyCore: [action('a'), action('b', { sort_order: 1, title: 'Second' })],
    todayLogs: [log('a')],
  };

  it('writes both App Group keys (KAIZEN-WIDGET-001 / KAIZEN-WATCH-001)', async () => {
    mockStreak.mockResolvedValue(9);

    await publishKaizenSnapshots(source, 'user-1');

    expect(mockSetSnapshot).toHaveBeenCalledTimes(2);
    expect(mockSetSnapshot).toHaveBeenCalledWith(KAIZEN_WIDGET_KEY, {
      done: 1,
      total: 2,
      streak: 9,
      next_habit: { title: 'Second', icon: 'briefcase-outline' },
    });
    expect(mockSetSnapshot).toHaveBeenCalledWith(KAIZEN_WATCH_KEY, {
      done: 1,
      total: 2,
      current_streak: 9,
      next_habit: 'Second',
    });
  });

  it('uses the shared streak service (KAIZEN-WIDGET-007)', async () => {
    mockStreak.mockResolvedValue(4);

    await publishKaizenSnapshots(source, 'user-1');

    expect(mockStreak).toHaveBeenCalledWith('user-1');
    expect(mockSetSnapshot.mock.calls[0][1].streak).toBe(4);
  });

  it('still writes with streak 0 when the streak read throws (KAIZEN-WIDGET-008)', async () => {
    mockStreak.mockRejectedValue(new Error('db closed'));

    await expect(publishKaizenSnapshots(source, 'user-1')).resolves.toBeUndefined();

    expect(mockSetSnapshot).toHaveBeenCalledTimes(2);
    expect(mockSetSnapshot.mock.calls[0][1].streak).toBe(0);
    expect(mockSetSnapshot.mock.calls[1][1].current_streak).toBe(0);
  });

  it('writes nothing when signed out (KAIZEN-WIDGET-009)', async () => {
    await publishKaizenSnapshots(source, null);
    await publishKaizenSnapshots(source, undefined);
    await publishKaizenSnapshots(source, '');

    expect(mockSetSnapshot).not.toHaveBeenCalled();
    expect(mockStreak).not.toHaveBeenCalled();
  });

  it('does not throw when the native module is absent (KAIZEN-WIDGET-012)', async () => {
    // widget-sync's own `safe()` swallows native errors; the producer must not add its own.
    mockSetSnapshot.mockImplementation(() => undefined);

    await expect(publishKaizenSnapshots(source, 'user-1')).resolves.toBeUndefined();
  });
});

/**
 * The screen-independent producer. `TodayScreen` used to be the ONLY writer, so the
 * widget stayed blank — showing "Sign in to track your habits" — for any signed-in
 * member who had not finished Kaizen's required onboarding, because the tab shell
 * that hosts Today never mounts until then.
 */
describe('syncKaizenGlance', () => {
  const today = new Date().toISOString().slice(0, 10);

  it('publishes from the local DB with no screen mounted (KAIZEN-WIDGET-023)', async () => {
    mockStreak.mockResolvedValue(5);
    mockDailyCore.mockResolvedValue([action('a'), action('b', { sort_order: 1, title: 'Second' })]);
    mockListActive.mockResolvedValue([log('a', { date: today })]);

    await syncKaizenGlance('user-1');

    expect(mockDailyCore).toHaveBeenCalledWith('user-1');
    expect(mockListActive).toHaveBeenCalledWith('kaizen_action_logs', 'user-1');
    expect(mockSetSnapshot).toHaveBeenCalledWith(KAIZEN_WIDGET_KEY, {
      done: 1,
      total: 2,
      streak: 5,
      next_habit: { title: 'Second', icon: 'briefcase-outline' },
    });
    expect(mockSetSnapshot).toHaveBeenCalledWith(KAIZEN_WATCH_KEY, {
      done: 1,
      total: 2,
      current_streak: 5,
      next_habit: 'Second',
    });
  });

  it('counts only today against the daily core (KAIZEN-WIDGET-024)', async () => {
    mockDailyCore.mockResolvedValue([action('a')]);
    mockListActive.mockResolvedValue([
      log('a', { date: '2020-01-01' }), // a stale log must not mark today done
    ]);

    await syncKaizenGlance('user-1');

    expect(mockSetSnapshot.mock.calls[0][1]).toMatchObject({ done: 0, total: 1 });
  });

  /**
   * The regression guard for the misleading copy. A signed-in member with no habits
   * yet must still get a snapshot, so an ABSENT key unambiguously means signed out
   * and the widget can honestly say "No habits scheduled today" instead.
   */
  it('writes a zeroed snapshot when the member has no habits (KAIZEN-WIDGET-025)', async () => {
    await syncKaizenGlance('user-1');

    expect(mockSetSnapshot).toHaveBeenCalledTimes(2);
    expect(mockSetSnapshot).toHaveBeenCalledWith(KAIZEN_WIDGET_KEY, {
      done: 0,
      total: 0,
      streak: 0,
      next_habit: null,
    });
  });

  it('no-ops when signed out (KAIZEN-WIDGET-026)', async () => {
    await syncKaizenGlance(null);
    await syncKaizenGlance(undefined);
    await syncKaizenGlance('');

    expect(mockDailyCore).not.toHaveBeenCalled();
    expect(mockSetSnapshot).not.toHaveBeenCalled();
  });

  it('swallows a local-DB failure rather than blocking sign-in (KAIZEN-WIDGET-026)', async () => {
    mockDailyCore.mockRejectedValue(new Error('db closed'));

    await expect(syncKaizenGlance('user-1')).resolves.toBeUndefined();
    expect(mockSetSnapshot).not.toHaveBeenCalled();
  });
});
