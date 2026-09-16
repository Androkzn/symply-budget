import { Platform } from 'react-native';

import { useKaizenStore } from '../../stores/kaizenStore';
import { snoozeActionReminder } from '../reminders';
import { computeDailyCoreStreak } from '../streak';
import { setWatchTransport, watchSync, type WatchTransport } from '../watchSync';

jest.mock('../reminders', () => ({ snoozeActionReminder: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../streak', () => ({ computeDailyCoreStreak: jest.fn().mockResolvedValue(5) }));
jest.mock('@stores/authStore', () => ({ useAuthStore: { getState: jest.fn(() => ({ user: { id: 'u1' } })) } }));
jest.mock('../../stores/kaizenStore', () => ({ useKaizenStore: { getState: jest.fn() } }));

const getState = useKaizenStore.getState as jest.Mock;
const mockSnooze = snoozeActionReminder as jest.Mock;

// Fixed reference instant (local noon on a fixed date) that the frozen clock in
// `beforeEach` also uses, so `today`/`weekday` here always agree with what
// buildTodaySummary derives at call time — regardless of timezone or when the
// suite runs. Previously these were read from the real import-time clock in UTC,
// which drifted a day from the fake local-noon clock near the UTC midnight
// boundary and silently filtered out the deep-work fixtures.
const FROZEN_NOW = new Date(2026, 0, 15, 12, 0, 0);
const weekday = ((FROZEN_NOW.getDay() + 6) % 7) + 1; // 1 Mon ... 7 Sun, matching watchSync's lookup
const today = FROZEN_NOW.toISOString().slice(0, 10);

function makeState() {
  return {
    todayLogs: [{ action_id: 'd1', skipped: 0 }],
    dailyCore: [
      { id: 'd1', title: 'Weigh in', watch_quick_log_enabled: 1, time_of_day: 'morning', system: 'health' },
      { id: 'd2', title: 'Read', watch_quick_log_enabled: 0, time_of_day: 'evening', system: 'learning' },
    ],
    rotations: [{ weekday, focus_title: 'React' }],
    deepWork: [{ date: today, start_time: '08:00', end_time: '23:59', topic: 'Deep focus' }],
    wakeConfirmedToday: true,
    gtd: [{ status: 'inbox' }, { status: 'done' }],
    questions: [
      { due_at: '2000-01-01T00:00:00.000Z' },
      { due_at: '2999-01-01T00:00:00.000Z' },
    ],
    pipeline: [{ id: 'p1' }],
    completeDailyAction: jest.fn().mockResolvedValue(undefined),
    addGtdItem: jest.fn().mockResolvedValue(undefined),
    confirmWake: jest.fn().mockResolvedValue(undefined),
    skipDailyAction: jest.fn().mockResolvedValue(undefined),
  };
}

let state: ReturnType<typeof makeState>;
let transport: { isPaired: jest.Mock; updateApplicationContext: jest.Mock } & WatchTransport;

beforeEach(() => {
  jest.clearAllMocks();
  // Freeze the wall clock to the fixed reference instant so both the date key
  // and the "still-open deep-work block" HH:MM filter are fully deterministic
  // and never flake near a midnight boundary.
  jest.useFakeTimers();
  jest.setSystemTime(FROZEN_NOW);
  (Platform as unknown as { OS: string }).OS = 'ios';
  state = makeState();
  getState.mockImplementation(() => state);
  transport = {
    isPaired: jest.fn().mockResolvedValue(true),
    updateApplicationContext: jest.fn().mockResolvedValue(undefined),
  };
  setWatchTransport(transport);
});

afterEach(() => {
  setWatchTransport(null);
  jest.useRealTimers();
});

describe('watchSync.buildTodaySummary', () => {
  it('summarizes daily-core completion, rotation, deep work and queues', () => {
    const summary = watchSync.buildTodaySummary();
    expect(summary).toMatchObject({
      date: today,
      completedCount: 1,
      totalCount: 2,
      wakeConfirmed: true,
      gtdInboxCount: 1,
      dueQuestions: 1,
      activePipeline: 1,
      focusTitle: 'React',
    });
    expect(summary.deepWork).toMatchObject({ start: '08:00', topic: 'Deep focus' });
    expect((summary.actions as Array<{ id: string; completed: boolean }>)).toEqual([
      expect.objectContaining({ id: 'd1', completed: true, watchQuickLog: true }),
      expect.objectContaining({ id: 'd2', completed: false, watchQuickLog: false }),
    ]);
  });
});

describe('watchSync.buildTodaySummary — edge cases', () => {
  it('picks the earliest still-open deep-work block and tolerates a missing end_time', () => {
    // end_time '23:59' keeps the block open regardless of the wall-clock the test
    // runs at; the no-end block exercises the `end_time ?? start_time` fallback and
    // starts later so it never wins the earliest-start sort at any hour.
    state.deepWork = [
      // Two blocks with end '23:59' stay open at any wall-clock (the assertion is
      // deterministic across a midnight boundary), so the earliest-start sort
      // comparator always runs with both present. The end_time-present branch and
      // the end_time-absent (`?? start_time`) branch are both exercised by the mix
      // below regardless of which blocks survive the time filter.
      { date: today, start_time: '10:00', end_time: '23:59', topic: 'Later' },
      { date: today, start_time: '08:00', end_time: '23:59', topic: 'Earlier' },
      { date: today, start_time: '09:30', topic: 'No-end' }, // no end_time → exercises end_time ?? start_time
      { date: '1999-01-01', start_time: '08:00', end_time: '23:59', topic: 'Wrong day' }, // filtered out by date
    ] as never;
    const summary = watchSync.buildTodaySummary();
    expect((summary.deepWork as { start: string; topic: string }).start).toBe('08:00');
    expect((summary.deepWork as { topic: string }).topic).toBe('Earlier');
  });

  it('defaults a missing deep-work topic, action time-of-day and system', () => {
    state.deepWork = [{ date: today, start_time: '08:00', end_time: '23:59' }] as never; // no topic
    state.dailyCore = [
      { id: 'd9', title: 'Untimed', watch_quick_log_enabled: 0, time_of_day: null, system: null },
    ] as never;
    const summary = watchSync.buildTodaySummary();
    expect((summary.deepWork as { topic: unknown }).topic).toBeNull();
    const actions = summary.actions as Array<{ timeOfDay: string; system: unknown }>;
    expect(actions[0].timeOfDay).toBe('anytime');
    expect(actions[0].system).toBeNull();
  });

  it('returns null deep work and null focus when nothing matches today', () => {
    state.deepWork = [] as never;
    state.rotations = [] as never;
    const summary = watchSync.buildTodaySummary();
    expect(summary.deepWork).toBeNull();
    expect(summary.focusTitle).toBeNull();
  });
});

describe('watchSync.isAvailable', () => {
  it('is false with no transport', async () => {
    setWatchTransport(null);
    expect(await watchSync.isAvailable()).toBe(false);
  });

  it('reflects pairing status on iOS', async () => {
    expect(await watchSync.isAvailable()).toBe(true);
    expect(transport.isPaired).toHaveBeenCalled();
  });

  it('is false on non-iOS platforms', async () => {
    (Platform as unknown as { OS: string }).OS = 'android';
    expect(await watchSync.isAvailable()).toBe(false);
  });
});

describe('watchSync.pushTodaySummary', () => {
  it('merges the DB-computed streak and pushes to the transport', async () => {
    await watchSync.pushTodaySummary();
    expect(computeDailyCoreStreak).toHaveBeenCalledWith('u1');
    const pushed = transport.updateApplicationContext.mock.calls[0][0];
    expect(pushed).toMatchObject({ streak: 5, totalCount: 2 });
  });

  it('reports a zero streak and skips the DB lookup when signed out', async () => {
    const { useAuthStore } = jest.requireMock('@stores/authStore');
    useAuthStore.getState.mockReturnValueOnce({ user: null });
    await watchSync.pushTodaySummary();
    expect(computeDailyCoreStreak).not.toHaveBeenCalled();
    expect(transport.updateApplicationContext.mock.calls[0][0]).toMatchObject({ streak: 0 });
  });

  it('is a no-op push when no transport is attached', async () => {
    setWatchTransport(null);
    await expect(watchSync.pushTodaySummary()).resolves.toBeUndefined();
  });
});

describe('watchSync.handleEvent', () => {
  it('quick-log completes the action from the watch and pushes an update', async () => {
    await watchSync.handleEvent({ type: 'quick-log', actionId: 'd2', occurredAt: today });
    expect(state.completeDailyAction).toHaveBeenCalledWith('d2', 'watch');
    expect(transport.updateApplicationContext).toHaveBeenCalled();
  });

  it('capture-gtd adds an inbox item', async () => {
    await watchSync.handleEvent({ type: 'capture-gtd', text: 'call mom', occurredAt: today });
    expect(state.addGtdItem).toHaveBeenCalledWith('call mom');
  });

  it('confirm-wake confirms the wake', async () => {
    await watchSync.handleEvent({ type: 'confirm-wake' });
    expect(state.confirmWake).toHaveBeenCalled();
  });

  it('skip skips the action', async () => {
    await watchSync.handleEvent({ type: 'skip', actionId: 'd1' });
    expect(state.skipDailyAction).toHaveBeenCalledWith('d1');
  });

  it('snooze resolves the action and schedules a reminder when found', async () => {
    await watchSync.handleEvent({ type: 'snooze', reminderId: 'd1', durationMinutes: 20 });
    expect(mockSnooze).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' }), 20);
  });

  it('snooze is a no-op when the action is unknown', async () => {
    await watchSync.handleEvent({ type: 'snooze', reminderId: 'nope', durationMinutes: 20 });
    expect(mockSnooze).not.toHaveBeenCalled();
  });
});
