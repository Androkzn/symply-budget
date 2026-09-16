import * as Notifications from 'expo-notifications';

import { notificationService } from '@services/notifications';

import type { KaizenActionEntry, KaizenActionLogEntry } from '../../types';
import {
  ACTION_DONE,
  ACTION_SKIP,
  ACTION_SNOOZE_PREFIX,
  CATEGORY_ACTION,
  CATEGORY_WAKE,
  actionIdFromRequestId,
  cancelAllKaizenReminders,
  completedActionIdsFromLogs,
  registerKaizenNotificationCategories,
  scheduleDailyCoreReminders,
  snoozeActionReminder,
  snoozeMinutesFromActionId,
} from '../reminders';


// A local in-memory store we fully control (and can assert on).
const store: Record<string, string> = {};
jest.mock('../storage', () => ({
  storageHelpers: {
    getString: jest.fn((k: string) => store[k] ?? null),
    setString: jest.fn((k: string, v: string) => {
      store[k] = v;
    }),
    remove: jest.fn((k: string) => {
      delete store[k];
    }),
  },
}));

jest.mock('@services/notifications', () => ({
  notificationService: { cancelNotification: jest.fn().mockResolvedValue(undefined) },
}));

// The global expo-notifications mock lacks category / scheduled-list surface, so
// provide a fuller one for this suite.
jest.mock('expo-notifications', () => ({
  setNotificationCategoryAsync: jest.fn().mockResolvedValue(undefined),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('req'),
  getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
  SchedulableTriggerInputTypes: { DAILY: 'daily', DATE: 'date' },
}));

const mockSchedule = Notifications.scheduleNotificationAsync as jest.Mock;
const mockCategory = Notifications.setNotificationCategoryAsync as jest.Mock;
const mockGetAll = Notifications.getAllScheduledNotificationsAsync as jest.Mock;
const mockCancel = notificationService.cancelNotification as jest.Mock;

function makeAction(overrides: Partial<KaizenActionEntry> = {}): KaizenActionEntry {
  return {
    id: 'action-1',
    user_id: 'u1',
    title: 'Morning weigh-in',
    system: 'health',
    rhythm: 'daily',
    linked_feature: null,
    is_daily_core: 1,
    sort_order: 0,
    time_of_day: 'morning',
    stack_id: null,
    rotation_day: null,
    reminder_anchor: 'wakeResponsive',
    reminder_policy: JSON.stringify({
      anchor: 'wakeResponsive',
      initialDelayMinutes: 30,
      repeatEveryMinutes: 60,
      maxNudges: 2,
      snoozeOptionsMinutes: [10],
    }),
    watch_quick_log_enabled: 0,
    voice_log_prompt: null,
    input_description: null,
    output_description: 'Log your weight',
    is_archived: 0,
    created_at: '2026-07-10T00:00:00.000Z',
    updated_at: '2026-07-10T00:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  jest.clearAllMocks();
  mockSchedule.mockResolvedValue('req');
  mockGetAll.mockResolvedValue([]);
});

describe('reminder id parsing', () => {
  it('extracts the action id from a nudge request id', () => {
    expect(actionIdFromRequestId('kaizen.nudge.action-1.1720569600.0')).toBe('action-1');
    expect(actionIdFromRequestId('some-other-id')).toBeNull();
  });

  it('parses snooze minutes from a category action identifier', () => {
    expect(snoozeMinutesFromActionId(`${ACTION_SNOOZE_PREFIX}30`)).toBe(30);
    expect(snoozeMinutesFromActionId(`${ACTION_SNOOZE_PREFIX}abc`)).toBeNull();
    expect(snoozeMinutesFromActionId(ACTION_DONE)).toBeNull();
  });
});

describe('completedActionIdsFromLogs', () => {
  const today = new Date().toISOString().slice(0, 10);
  const log = (over: Partial<KaizenActionLogEntry>): KaizenActionLogEntry => ({
    id: 'l', user_id: 'u1', action_id: 'a', date: today, completed_at: null, skipped: 0,
    skip_reason: null, source: 'manual', notes: null,
    created_at: today, updated_at: today, deleted_at: null, ...over,
  });

  it('collects today\'s completed or skipped action ids only', () => {
    const ids = completedActionIdsFromLogs([
      log({ action_id: 'done', completed_at: `${today}T09:00:00.000Z` }),
      log({ action_id: 'skipped', skipped: 1 }),
      log({ action_id: 'pending' }),
      log({ action_id: 'yesterday', date: '2000-01-01', completed_at: '2000-01-01T00:00:00.000Z' }),
    ]);
    expect([...ids].sort()).toEqual(['done', 'skipped']);
  });
});

describe('registerKaizenNotificationCategories', () => {
  it('registers wake + action categories with Done/Snooze/Skip buttons', async () => {
    await registerKaizenNotificationCategories([10, 30]);

    expect(mockCategory).toHaveBeenCalledTimes(2);
    const [wakeCat, wakeActions] = mockCategory.mock.calls[0];
    expect(wakeCat).toBe(CATEGORY_WAKE);
    const ids = (wakeActions as Array<{ identifier: string }>).map(a => a.identifier);
    expect(ids).toEqual([ACTION_DONE, `${ACTION_SNOOZE_PREFIX}10`, `${ACTION_SNOOZE_PREFIX}30`, ACTION_SKIP]);

    const [actionCat, actionActions] = mockCategory.mock.calls[1];
    expect(actionCat).toBe(CATEGORY_ACTION);
    expect((actionActions as Array<{ identifier: string }>).map(a => a.identifier)).toEqual([ACTION_DONE, ACTION_SKIP]);
  });
});

describe('scheduleDailyCoreReminders', () => {
  it('schedules policy nudges for a pending daily-core action and records pending ids', async () => {
    const wakeAnchor = new Date(Date.now() + 6 * 3600_000); // future so nudges are not skipped
    await scheduleDailyCoreReminders([makeAction()], { wakeAnchor });

    expect(mockSchedule).toHaveBeenCalledTimes(2);
    const pending = JSON.parse(store['kaizen.reminders.pending']);
    expect(pending['action-1']).toHaveLength(2);
    // Wake-anchored action uses the wake category.
    expect(mockSchedule.mock.calls[0][0].content.categoryIdentifier).toBe(CATEGORY_WAKE);
  });

  it('skips scheduling and cancels reminders for already done/skipped actions', async () => {
    const wakeAnchor = new Date(Date.now() + 6 * 3600_000);
    await scheduleDailyCoreReminders([makeAction()], {
      wakeAnchor,
      completedOrSkippedActionIds: new Set(['action-1']),
    });
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('short-circuits entirely when the deep-work focus filter is active', async () => {
    mockGetAll.mockResolvedValue([{ identifier: 'kaizen-action-old' }]);
    await scheduleDailyCoreReminders([makeAction()], { focusFilterActive: true });

    // Legacy identifiers are cancelled, but no new nudges scheduled.
    expect(mockCancel).toHaveBeenCalledWith('kaizen-action-old');
    expect(mockSchedule).not.toHaveBeenCalled();
    expect(store['kaizen.reminders.pending']).toBe('{}');
  });

  it('falls back to a time-of-day daily reminder when policy yields no nudges', async () => {
    // No reminder policy, but a time_of_day set -> scheduleTimeOfDayFallback.
    const action = makeAction({ reminder_anchor: 'none', reminder_policy: 'none', time_of_day: 'evening' });
    await scheduleDailyCoreReminders([action], { wakeAnchor: new Date(Date.now() + 6 * 3600_000) });

    expect(mockSchedule).toHaveBeenCalledTimes(1);
    const arg = mockSchedule.mock.calls[0][0];
    expect(arg.trigger).toMatchObject({ type: 'daily', hour: 19 });
  });

  it('stops after the first nudge when the policy has no repeat interval', async () => {
    // maxNudges > 1 but no repeatEveryMinutes -> the loop breaks on the second index.
    const action = makeAction({
      reminder_anchor: 'wakeResponsive',
      reminder_policy: JSON.stringify({ anchor: 'wakeResponsive', initialDelayMinutes: 30, maxNudges: 3 }),
    });
    await scheduleDailyCoreReminders([action], { wakeAnchor: new Date(Date.now() + 6 * 3600_000) });

    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(JSON.parse(store['kaizen.reminders.pending'])['action-1']).toHaveLength(1);
  });

  it('schedules nothing when a quiet-hours cap suppresses every wake-responsive nudge', async () => {
    // quietAfterHour: 0 -> every fire time is past the quiet cutoff -> break, no fallback (not timeOfDay).
    const action = makeAction({
      reminder_anchor: 'wakeResponsive',
      reminder_policy: JSON.stringify({
        anchor: 'wakeResponsive',
        initialDelayMinutes: 30,
        repeatEveryMinutes: 60,
        maxNudges: 2,
        quietAfterHour: 0,
      }),
    });
    await scheduleDailyCoreReminders([action], { wakeAnchor: new Date(Date.now() + 6 * 3600_000) });

    expect(mockSchedule).not.toHaveBeenCalled();
    expect(store['kaizen.reminders.pending']).toBe('{}');
  });

  it('uses the time-of-day fallback when quiet hours suppress every timeOfDay nudge', async () => {
    // Same quiet-hours break, but anchor timeOfDay -> schedulePolicyNudges falls back to a daily reminder.
    const action = makeAction({
      reminder_anchor: 'timeOfDay',
      time_of_day: 'evening',
      reminder_policy: JSON.stringify({
        anchor: 'timeOfDay',
        initialDelayMinutes: 30,
        maxNudges: 2,
        quietAfterHour: 0,
      }),
    });
    await scheduleDailyCoreReminders([action], { wakeAnchor: new Date(Date.now() + 6 * 3600_000) });

    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(mockSchedule.mock.calls[0][0].trigger).toMatchObject({ type: 'daily', hour: 19 });
  });

  it('skips nudges whose fire time is already in the past', async () => {
    // Past wake anchor + no quiet cap -> every computed fire date is <= now -> continue, empty result.
    const action = makeAction({
      reminder_anchor: 'wakeResponsive',
      reminder_policy: JSON.stringify({
        anchor: 'wakeResponsive',
        initialDelayMinutes: 30,
        repeatEveryMinutes: 60,
        maxNudges: 2,
      }),
    });
    await scheduleDailyCoreReminders([action], { wakeAnchor: new Date(Date.now() - 24 * 3600_000) });

    expect(mockSchedule).not.toHaveBeenCalled();
    expect(store['kaizen.reminders.pending']).toBe('{}');
  });
});

describe('scheduleDailyCoreReminders — additional branch coverage', () => {
  const future = () => new Date(Date.now() + 6 * 3600_000);

  it('defaults options to an empty object when omitted', async () => {
    await scheduleDailyCoreReminders([makeAction()]);
    // Default wakeAnchor = now -> the default policy schedules its future nudges.
    expect(mockSchedule).toHaveBeenCalled();
  });

  it('cancels legacy nudge-prefixed identifiers and ignores unrelated ones', async () => {
    mockGetAll.mockResolvedValue([
      { identifier: 'kaizen.nudge.stale.1.0' }, // matches REQUEST_PREFIX (second operand)
      { identifier: 'unrelated-notification' }, // matches neither -> filtered out
    ]);
    await scheduleDailyCoreReminders([makeAction()], { focusFilterActive: true });
    expect(mockCancel).toHaveBeenCalledWith('kaizen.nudge.stale.1.0');
    expect(mockCancel).not.toHaveBeenCalledWith('unrelated-notification');
  });

  it('skips archived and non-daily-core actions', async () => {
    await scheduleDailyCoreReminders(
      [makeAction({ id: 'a', is_archived: 1 }), makeAction({ id: 'b', is_daily_core: 0 })],
      { wakeAnchor: future() },
    );
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('uses the action category for a non-wake-responsive policy nudge', async () => {
    const action = makeAction({
      reminder_anchor: 'timeOfDay',
      reminder_policy: JSON.stringify({ anchor: 'timeOfDay', initialDelayMinutes: 30, maxNudges: 1 }),
    });
    await scheduleDailyCoreReminders([action], { wakeAnchor: future() });
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(mockSchedule.mock.calls[0][0].content.categoryIdentifier).toBe(CATEGORY_ACTION);
  });

  it('re-cancels pending nudges when the same action recurs in the batch', async () => {
    // The same id twice: the second pass sees the pending ids written by the first
    // and cancels them (exercises cancelRemindersForAction with a non-empty id list).
    await scheduleDailyCoreReminders([makeAction(), makeAction()], { wakeAnchor: future() });
    expect(mockCancel).toHaveBeenCalledWith(expect.stringContaining('kaizen.nudge.action-1'));
  });

  it('runs the time-of-day fallback with the anytime bucket for a blank time-of-day', async () => {
    // maxNudges:0 -> parseReminderPolicy yields a zero-nudge policy -> fallback branch,
    // and reminder_anchor==='timeOfDay' takes the first operand of the fallback guard.
    const action = makeAction({
      reminder_anchor: 'timeOfDay',
      reminder_policy: JSON.stringify({ maxNudges: 0 }),
      time_of_day: '' as never,
      output_description: null, // nudgeBody falls back to its default copy
    });
    await scheduleDailyCoreReminders([action], { wakeAnchor: future() });
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(mockSchedule.mock.calls[0][0].trigger).toMatchObject({ type: 'daily', hour: 10 });
    expect(mockSchedule.mock.calls[0][0].content.body).toMatch(/Tap to log/);
  });

  it('falls back to hour 10 for an unknown time-of-day bucket', async () => {
    const action = makeAction({
      reminder_anchor: 'timeOfDay',
      reminder_policy: JSON.stringify({ maxNudges: 0 }),
      time_of_day: 'night' as never, // not in the TIME_OF_DAY_HOUR map -> ?? 10
    });
    await scheduleDailyCoreReminders([action], { wakeAnchor: future() });
    expect(mockSchedule.mock.calls[0][0].trigger).toMatchObject({ type: 'daily', hour: 10 });
  });

  it('does not fall back when policy is empty and no time-of-day is set', async () => {
    const action = makeAction({ reminder_anchor: 'none', reminder_policy: 'none', time_of_day: '' as never });
    await scheduleDailyCoreReminders([action], { wakeAnchor: future() });
    expect(mockSchedule).not.toHaveBeenCalled();
  });
});

describe('snoozeActionReminder', () => {
  it('schedules a future one-off and appends the request id to pending', async () => {
    await snoozeActionReminder(makeAction(), 15);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    const arg = mockSchedule.mock.calls[0][0];
    expect(arg.trigger.type).toBe('date');
    expect(arg.trigger.date.getTime()).toBeGreaterThan(Date.now());
    expect(arg.content.categoryIdentifier).toBe(CATEGORY_WAKE);
    expect(JSON.parse(store['kaizen.reminders.pending'])['action-1']).toHaveLength(1);
  });

  it('clamps the snooze window to at least 1 minute', async () => {
    const before = Date.now();
    await snoozeActionReminder(makeAction(), -100);
    const fire = mockSchedule.mock.calls[0][0].trigger.date.getTime();
    expect(fire).toBeGreaterThanOrEqual(before + 60_000 - 1000);
  });

  it('uses the action category when snoozing a non-wake-responsive action', async () => {
    await snoozeActionReminder(makeAction({ reminder_anchor: 'timeOfDay' }), 15);
    expect(mockSchedule.mock.calls[0][0].content.categoryIdentifier).toBe(CATEGORY_ACTION);
  });
});

describe('cancelAllKaizenReminders', () => {
  it('cancels every pending id and clears the map', async () => {
    store['kaizen.reminders.pending'] = JSON.stringify({ a: ['id1', 'id2'], b: ['id3'] });
    await cancelAllKaizenReminders();
    expect(mockCancel).toHaveBeenCalledWith('id1');
    expect(mockCancel).toHaveBeenCalledWith('id2');
    expect(mockCancel).toHaveBeenCalledWith('id3');
    expect(store['kaizen.reminders.pending']).toBe('{}');
  });

  it('recovers from a corrupt pending map without cancelling anything', async () => {
    store['kaizen.reminders.pending'] = '{bad json';
    await cancelAllKaizenReminders();
    expect(mockCancel).not.toHaveBeenCalled();
    expect(store['kaizen.reminders.pending']).toBe('{}');
  });
});
