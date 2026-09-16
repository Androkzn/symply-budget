/**
 * H7-lite — rolling-horizon reminder scheduler (plan §9).
 *
 * The suite exists for one claim in the DoD: *"`houseLocalReminders.ts`
 * schedules within the 64-notification cap under the H10 10-year corpus;
 * rolling-horizon test via `getAllScheduledNotificationsAsync()`"*. So the cap
 * is asserted twice, from both ends — against the plan the scheduler builds, and
 * against what the notification centre actually holds afterwards.
 *
 * The `expo-notifications` mock is **stateful** rather than a bare `jest.fn()`.
 * A stateless mock would let a scheduler that never cancels anything pass every
 * assertion here while shipping a permanently full notification centre; keeping
 * the pending list real is what makes "cancel ours, leave theirs" checkable.
 *
 * Static imports throughout — `await import()` throws under this Jest config
 * without `--experimental-vm-modules` (plan §6.2).
 */
import * as Notifications from 'expo-notifications';

import {
  HOUSE_LOCAL_REMINDER_COVERAGE,
  HOUSE_REMINDER_CLASS_CAPS,
  HOUSE_REMINDER_HORIZON_DAYS,
  HOUSE_REMINDER_PREFIX,
  HOUSE_REMINDER_SLOTS,
  HOUSE_REMINDER_TYPES,
  IOS_PENDING_NOTIFICATION_LIMIT,
  buildHouseReminderPlan,
  cancelHouseLocalReminders,
  getHouseLocalRemindersCopy,
  getHouseLocalRemindersDeniedCopy,
  syncHouseLocalReminders,
  type HouseReminderLedger,
} from '../reminders/houseLocalReminders';
import type { LocalGarbageSchedule, LocalRecurringReminder, LocalTask } from '../types';

// --- expo-notifications: a real pending list, not a spy ---------------------

const pending: Array<{ identifier: string; content: Record<string, unknown> }> = [];

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  getAllScheduledNotificationsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

(Notifications.scheduleNotificationAsync as jest.Mock).mockImplementation(
  async (request: { identifier: string; content: Record<string, unknown> }) => {
    pending.push({ identifier: request.identifier, content: request.content });
    return request.identifier;
  },
);
(Notifications.cancelScheduledNotificationAsync as jest.Mock).mockImplementation(
  async (identifier: string) => {
    const index = pending.findIndex((request) => request.identifier === identifier);
    if (index >= 0) pending.splice(index, 1);
  },
);
(Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockImplementation(async () => [
  ...pending,
]);

// --- engine + flag: the scheduler reads a session, the suite supplies one ----

let mockSessionOpen = true;
let mockProperties: Array<{ householdId: string; hydrated: boolean; awaitingEnrolment: boolean }> = [];
const mockLedgers = new Map<string, HouseReminderLedger>();

jest.mock('../flag', () => ({ isHouseLocalFirst: () => true }));

jest.mock('../engine', () => ({
  isLocalHouseSessionOpen: () => mockSessionOpen,
  listLocalHouseProperties: () =>
    mockProperties.map((property) => ({
      householdId: property.householdId,
      deviceId: 'dev-1',
      name: property.householdId,
      role: 'owner',
      isActive: property.householdId === mockProperties[0]?.householdId,
      hydrated: property.hydrated,
      awaitingEnrolment: property.awaitingEnrolment,
    })),
  getLocalHouseLedgerFor: async (householdId: string) => mockLedgers.get(householdId),
}));

// --- fixtures ---------------------------------------------------------------

const HOUSEHOLD = 'hh_1';

/** `now` is real time so the horizon arithmetic is exercised, not pinned. */
const NOW = new Date();

function dayKey(offsetDays: number, from: Date = NOW): string {
  const date = new Date(from);
  date.setDate(date.getDate() + offsetDays);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${String(date.getDate()).padStart(2, '0')}`;
}

function task(id: string, overrides: Partial<LocalTask> = {}): LocalTask {
  return {
    id,
    household_id: HOUSEHOLD,
    system_category: 'hvac',
    title: `Task ${id}`,
    description: null,
    frequency: 'monthly',
    custom_interval_days: null,
    next_due_date: dayKey(10),
    last_completed_at: null,
    assigned_to: null,
    space_id: null,
    is_active: true,
    source: 'manual',
    reminder_enabled: true,
    reminder_days_before: 3,
    reminder_time: '09:00',
    reminder_repeat: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function garbage(overrides: Partial<LocalGarbageSchedule> = {}): LocalGarbageSchedule {
  return {
    id: 'gs_1',
    household_id: HOUSEHOLD,
    municipality: 'Surrey',
    // Weekly on every weekday so the expansion always produces pickups
    // regardless of which day the suite happens to run.
    schedules: [{ type: 'garbage', frequency: 'weekly', dayOfWeek: (NOW.getDay() + 2) % 7 }],
    source: 'manual',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function nudge(id: string, overrides: Partial<LocalRecurringReminder> = {}): LocalRecurringReminder {
  const nextNudge = new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000);
  return {
    id,
    household_id: HOUSEHOLD,
    type: 'task_reminder',
    reference_type: 'task',
    reference_id: 'task-1',
    period_key: '2026-08',
    status: 'pending',
    title: 'Still not done',
    body: 'The furnace filter is waiting.',
    data: JSON.stringify({ taskId: 'task-1', screen: 'TaskDetail' }),
    frequency: 'every_3_days',
    next_nudge_at: nextNudge.toISOString(),
    last_nudged_at: null,
    nudge_count: 1,
    snoozed_until: null,
    completed_at: null,
    completed_by_user_id: null,
    completed_reason: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function ledger(overrides: Partial<HouseReminderLedger> = {}): HouseReminderLedger {
  return {
    household: { id: HOUSEHOLD, name: 'Shared home' } as HouseReminderLedger['household'],
    tasks: [],
    garbageSchedules: [],
    recurringReminders: [],
    ...overrides,
  };
}

function useSingleProperty(value: HouseReminderLedger): void {
  mockProperties = [{ householdId: HOUSEHOLD, hydrated: true, awaitingEnrolment: false }];
  mockLedgers.set(HOUSEHOLD, value);
}

beforeEach(() => {
  pending.length = 0;
  mockLedgers.clear();
  mockProperties = [];
  mockSessionOpen = true;
});

// ---------------------------------------------------------------------------

describe('buildHouseReminderPlan — task due reminders', () => {
  it('fires at due date minus the lead, at reminder_time', () => {
    const plan = buildHouseReminderPlan(
      ledger({ tasks: [task('t1', { next_due_date: dayKey(10), reminder_days_before: 3 })] }),
      NOW,
    );

    expect(plan).toHaveLength(1);
    expect(plan[0].cls).toBe('taskDue');
    expect(plan[0].data.type).toBe(HOUSE_REMINDER_TYPES.TASK_DUE);
    expect(plan[0].data.taskId).toBe('t1');
    expect(plan[0].identifier.startsWith(HOUSE_REMINDER_PREFIX)).toBe(true);
    expect(plan[0].fireAt.getHours()).toBe(9);
    expect(
      `${plan[0].fireAt.getFullYear()}-${String(plan[0].fireAt.getMonth() + 1).padStart(2, '0')}-${String(plan[0].fireAt.getDate()).padStart(2, '0')}`,
    ).toBe(dayKey(7));
  });

  it('skips inactive rows, reminder-disabled rows and rows with no due date', () => {
    const plan = buildHouseReminderPlan(
      ledger({
        tasks: [
          task('inactive', { is_active: false }),
          task('no-reminder', { reminder_enabled: false }),
          task('undated', { next_due_date: null }),
        ],
      }),
      NOW,
    );

    expect(plan).toHaveLength(0);
  });

  it('honours snooze_until so a dismissed reminder is not resurrected by the next bump', () => {
    const snoozeUntil = new Date(NOW.getTime() + 20 * 24 * 60 * 60 * 1000);
    const plan = buildHouseReminderPlan(
      ledger({
        tasks: [
          task('t1', {
            next_due_date: dayKey(10),
            reminder_days_before: 3,
            snooze_until: snoozeUntil.toISOString(),
          }),
        ],
      }),
      NOW,
    );

    expect(plan).toHaveLength(1);
    expect(plan[0].fireAt.getTime()).toBe(snoozeUntil.getTime());
  });

  it('drops candidates beyond the rolling horizon — that is what makes it roll', () => {
    const beyond = HOUSE_REMINDER_HORIZON_DAYS + 40;
    const plan = buildHouseReminderPlan(
      ledger({
        tasks: [
          task('near', { next_due_date: dayKey(5), reminder_days_before: 0 }),
          task('far', { next_due_date: dayKey(beyond), reminder_days_before: 0 }),
        ],
      }),
      NOW,
    );

    expect(plan.map((candidate) => candidate.data.taskId)).toEqual(['near']);
  });
});

describe('buildHouseReminderPlan — overdue digest', () => {
  it('collapses every overdue task into one 08:00 notification naming the oldest', () => {
    const plan = buildHouseReminderPlan(
      ledger({
        tasks: [
          task('old', { next_due_date: dayKey(-40), reminder_enabled: false }),
          task('older', { next_due_date: dayKey(-90), reminder_enabled: false }),
          task('recent', { next_due_date: dayKey(-2), reminder_enabled: false }),
        ],
      }),
      NOW,
    );

    expect(plan).toHaveLength(1);
    expect(plan[0].cls).toBe('overdue');
    expect(plan[0].data.type).toBe(HOUSE_REMINDER_TYPES.TASK_OVERDUE);
    expect(plan[0].data.overdueCount).toBe(3);
    expect(plan[0].data.taskId).toBe('older');
    expect(plan[0].fireAt.getHours()).toBe(8);
  });

  it('emits nothing when nothing is overdue', () => {
    const plan = buildHouseReminderPlan(
      ledger({ tasks: [task('t1', { next_due_date: dayKey(5), reminder_enabled: false })] }),
      NOW,
    );
    expect(plan).toHaveLength(0);
  });
});

describe('buildHouseReminderPlan — garbage day', () => {
  it('defaults to a night-before nudge when the row carries no reminder config', () => {
    const plan = buildHouseReminderPlan(ledger({ garbageSchedules: [garbage()] }), NOW);

    const garbagePlan = plan.filter((candidate) => candidate.cls === 'garbage');
    expect(garbagePlan.length).toBeGreaterThan(0);
    expect(garbagePlan[0].data.type).toBe(HOUSE_REMINDER_TYPES.GARBAGE);
    expect(garbagePlan[0].data.screen).toBe('GarbageCollection');
    expect(garbagePlan[0].channelId).toBe('garbage_reminders');
    expect(garbagePlan[0].fireAt.getHours()).toBe(19);
  });

  it('honours the row s own nightBefore / morningOf configuration', () => {
    const plan = buildHouseReminderPlan(
      ledger({
        garbageSchedules: [
          garbage({
            reminders: {
              nightBefore: { enabled: false, time: '19:00' },
              morningOf: { enabled: true, time: '06:15' },
            },
          }),
        ],
      }),
      NOW,
    );

    const garbagePlan = plan.filter((candidate) => candidate.cls === 'garbage');
    expect(garbagePlan.length).toBeGreaterThan(0);
    for (const candidate of garbagePlan) {
      expect(candidate.fireAt.getHours()).toBe(6);
      expect(candidate.fireAt.getMinutes()).toBe(15);
    }
  });
});

describe('buildHouseReminderPlan — recurring nudges', () => {
  it('re-emits the row s own payload so the tap routes exactly as the server push did', () => {
    const plan = buildHouseReminderPlan(ledger({ recurringReminders: [nudge('r1')] }), NOW);

    expect(plan).toHaveLength(1);
    expect(plan[0].cls).toBe('recurring');
    expect(plan[0].title).toBe('Still not done');
    expect(plan[0].data.taskId).toBe('task-1');
    expect(plan[0].data.type).toBe('task_reminder');
    expect(plan[0].data.recurringReminderId).toBe('r1');
  });

  it('ignores completed rows and survives malformed peer-authored data', () => {
    const plan = buildHouseReminderPlan(
      ledger({
        recurringReminders: [
          nudge('done', { status: 'done', completed_at: NOW.toISOString() }),
          nudge('broken', { data: '{not json' }),
        ],
      }),
      NOW,
    );

    expect(plan).toHaveLength(1);
    expect(plan[0].data.recurringReminderId).toBe('broken');
  });
});

describe('the 64-notification cap', () => {
  it('keeps the sum of the per-class caps below the House budget, and that below the iOS cap', () => {
    const sum = Object.values(HOUSE_REMINDER_CLASS_CAPS).reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThanOrEqual(HOUSE_REMINDER_SLOTS);
    expect(HOUSE_REMINDER_SLOTS).toBeLessThan(IOS_PENDING_NOTIFICATION_LIMIT);
  });

  it('caps one loud class so it cannot starve the others', () => {
    const tasks = Array.from({ length: 300 }, (_, i) =>
      task(`t${i}`, { next_due_date: dayKey(1 + (i % 25)), reminder_days_before: 0 }),
    );
    const plan = buildHouseReminderPlan(
      ledger({ tasks, garbageSchedules: [garbage()], recurringReminders: [nudge('r1')] }),
      NOW,
    );

    const taskDue = plan.filter((candidate) => candidate.cls === 'taskDue');
    expect(taskDue).toHaveLength(HOUSE_REMINDER_CLASS_CAPS.taskDue);
    // Garbage and the nudge still made it — the point of the per-class caps.
    expect(plan.some((candidate) => candidate.cls === 'garbage')).toBe(true);
    expect(plan.some((candidate) => candidate.cls === 'recurring')).toBe(true);
  });

  it('returns the plan sorted by fire time', () => {
    const tasks = Array.from({ length: 20 }, (_, i) =>
      task(`t${i}`, { next_due_date: dayKey(25 - i), reminder_days_before: 0 }),
    );
    const plan = buildHouseReminderPlan(ledger({ tasks }), NOW);

    const times = plan.map((candidate) => candidate.fireAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('stays inside the cap on the H10 ten-year corpus shape (thousands of tasks)', () => {
    // H10 §4.1 pins the ten-year House corpus at 28,867 rows, of which `tasks`
    // is the 2,500–5,000 band (plan §4). Five thousand active, reminder-enabled
    // tasks spread across ten years is the worst case that shape can present.
    const tasks = Array.from({ length: 5_000 }, (_, i) =>
      task(`t${i}`, {
        next_due_date: dayKey((i % 3_650) - 200),
        reminder_days_before: i % 7,
      }),
    );
    const recurringReminders = Array.from({ length: 400 }, (_, i) =>
      nudge(`r${i}`, {
        next_nudge_at: new Date(NOW.getTime() + (i % 60) * 24 * 60 * 60 * 1000).toISOString(),
      }),
    );

    const plan = buildHouseReminderPlan(
      ledger({ tasks, garbageSchedules: [garbage()], recurringReminders }),
      NOW,
    );

    expect(plan.length).toBeLessThan(IOS_PENDING_NOTIFICATION_LIMIT);
    expect(plan.length).toBeLessThanOrEqual(
      Object.values(HOUSE_REMINDER_CLASS_CAPS).reduce((a, b) => a + b, 0),
    );
  });
});

describe('syncHouseLocalReminders', () => {
  it('leaves the notification centre inside the iOS cap under the ten-year corpus', async () => {
    const tasks = Array.from({ length: 5_000 }, (_, i) =>
      task(`t${i}`, { next_due_date: dayKey((i % 3_650) - 200), reminder_days_before: i % 7 }),
    );
    useSingleProperty(ledger({ tasks, garbageSchedules: [garbage()] }));

    const scheduled = await syncHouseLocalReminders();

    const centre = await Notifications.getAllScheduledNotificationsAsync();
    expect(centre).toHaveLength(scheduled);
    expect(centre.length).toBeLessThanOrEqual(IOS_PENDING_NOTIFICATION_LIMIT);
    expect(scheduled).toBeGreaterThan(0);
  });

  it('shrinks its budget to what the app has actually left, not to what it assumes', async () => {
    // 40 pending requests from elsewhere in the app leave 24 of the 64.
    for (let i = 0; i < 40; i += 1) pending.push({ identifier: `other.${i}`, content: {} });

    const tasks = Array.from({ length: 500 }, (_, i) =>
      task(`t${i}`, { next_due_date: dayKey(1 + (i % 25)), reminder_days_before: 0 }),
    );
    useSingleProperty(ledger({ tasks }));

    const scheduled = await syncHouseLocalReminders();

    expect(scheduled).toBeLessThanOrEqual(IOS_PENDING_NOTIFICATION_LIMIT - 40);
    const centre = await Notifications.getAllScheduledNotificationsAsync();
    expect(centre.length).toBeLessThanOrEqual(IOS_PENDING_NOTIFICATION_LIMIT);
  });

  it('re-running replaces only its own reminders and leaves other surfaces pending', async () => {
    pending.push({ identifier: 'kaizen.action.1', content: {} });
    useSingleProperty(ledger({ tasks: [task('t1')] }));

    await syncHouseLocalReminders();
    const firstPass = await Notifications.getAllScheduledNotificationsAsync();
    expect(firstPass.filter((r) => r.identifier.startsWith(HOUSE_REMINDER_PREFIX))).toHaveLength(1);

    await syncHouseLocalReminders();
    const secondPass = await Notifications.getAllScheduledNotificationsAsync();
    expect(secondPass.filter((r) => r.identifier.startsWith(HOUSE_REMINDER_PREFIX))).toHaveLength(1);
    expect(secondPass.some((r) => r.identifier === 'kaizen.action.1')).toBe(true);
  });

  it('divides the budget across properties and skips cold ones unless asked', async () => {
    const busy = (id: string) =>
      ledger({
        household: { id, name: id } as HouseReminderLedger['household'],
        tasks: Array.from({ length: 200 }, (_, i) =>
          task(`${id}-t${i}`, {
            household_id: id,
            next_due_date: dayKey(1 + (i % 25)),
            reminder_days_before: 0,
          }),
        ),
      });

    mockProperties = [
      { householdId: 'hh_a', hydrated: true, awaitingEnrolment: false },
      { householdId: 'hh_b', hydrated: false, awaitingEnrolment: false },
    ];
    mockLedgers.set('hh_a', busy('hh_a'));
    mockLedgers.set('hh_b', busy('hh_b'));

    const hydratedOnly = await syncHouseLocalReminders();
    expect(
      (await Notifications.getAllScheduledNotificationsAsync()).every((request) =>
        request.identifier.includes('hh_a'),
      ),
    ).toBe(true);

    const bothProperties = await syncHouseLocalReminders({ includeColdProperties: true });
    const centre = await Notifications.getAllScheduledNotificationsAsync();
    expect(centre.some((request) => request.identifier.includes('hh_b'))).toBe(true);
    expect(centre.length).toBeLessThanOrEqual(IOS_PENDING_NOTIFICATION_LIMIT);
    expect(bothProperties).toBeGreaterThan(0);
    expect(hydratedOnly).toBeGreaterThan(0);
  });

  it('does nothing when no local session is open', async () => {
    mockSessionOpen = false;
    useSingleProperty(ledger({ tasks: [task('t1')] }));

    expect(await syncHouseLocalReminders()).toBe(0);
    expect(await Notifications.getAllScheduledNotificationsAsync()).toHaveLength(0);
  });

  it('cancelHouseLocalReminders clears only the House prefix', async () => {
    pending.push({ identifier: 'kaizen.action.1', content: {} });
    useSingleProperty(ledger({ tasks: [task('t1')] }));
    await syncHouseLocalReminders();

    await cancelHouseLocalReminders();

    const centre = await Notifications.getAllScheduledNotificationsAsync();
    expect(centre).toHaveLength(1);
    expect(centre[0].identifier).toBe('kaizen.action.1');
  });
});

describe('member-facing coverage copy', () => {
  it('names the live classes and the two that are dark on this build', () => {
    expect(HOUSE_LOCAL_REMINDER_COVERAGE.live.length).toBeGreaterThan(0);
    expect(HOUSE_LOCAL_REMINDER_COVERAGE.dark).toContain('Checklist due dates');

    const copy = getHouseLocalRemindersCopy();
    expect(copy.title).toMatch(/device/i);
    expect(copy.message).toMatch(/Checklist due dates/);
    expect(copy.message).toMatch(/digests are off on this build/i);
  });

  it('has explicit dark copy for the permission-denied state — never a silent empty', () => {
    const copy = getHouseLocalRemindersDeniedCopy();
    expect(copy.title).toMatch(/off on this build/i);
    expect(copy.message.length).toBeGreaterThan(40);
  });
});
