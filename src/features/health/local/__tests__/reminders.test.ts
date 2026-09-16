/**
 * He7-lite / DoD He3d — the rolling-horizon reminder scheduler (plan §9).
 *
 * §12.1 names this file for one claim: *"Notification budget ≤56 after
 * reschedule"*. So the 56 is asserted from both ends — against the plan the
 * scheduler builds, and against what the notification centre actually holds
 * after a pass — and against the three shapes that break a naive scheduler:
 *
 *  1. **Volume.** Health reminders are dailies; a full schedule plus a large
 *     habit set asks for ~130 notifications a day against a 64-request centre.
 *  2. **DST.** A horizon stepped in milliseconds drifts an hour across a
 *     transition and eventually skips a calendar day — a reminder that never
 *     fires, indistinguishable from one that works.
 *  3. **Churn.** §9's bound only means something if it *suppresses work*. A
 *     bound that still cancels and re-places 46 notifications, only to arrive at
 *     the same answer, is a comment. So the churn case counts
 *     `scheduleNotificationAsync` calls, not just outcomes.
 *
 * The `expo-notifications` mock is **stateful** rather than a bare `jest.fn()`.
 * A stateless mock would let a scheduler that never cancels anything pass every
 * assertion here while shipping a permanently full notification centre.
 *
 * Static imports throughout — `await import()` throws under this Jest config
 * without `--experimental-vm-modules`.
 */
import fs from 'fs';
import path from 'path';

import * as Notifications from 'expo-notifications';

import { storageHelpers } from '@services/storage';

import {
  DEFAULT_HEALTH_REMINDERS,
  HEALTH_REMINDERS_KEY,
  type HealthReminderPreferences,
} from '../../healthRemindersStorage';
import {
  HEALTH_GLANCE_ENABLED_BY_DEFAULT,
  HEALTH_GLANCE_FILE_PROTECTION,
  HEALTH_GLANCE_NEVER_LIST,
  HEALTH_GLANCE_WIDGET_ENTITLEMENT,
  HEALTH_REMINDER_ACTIONS,
  HEALTH_REMINDER_AUTHENTICATION_REQUIRED,
  HEALTH_REMINDER_BODIES_CARRY_READINGS,
  getHealthGlanceDarkCopy,
  healthReminderActionOptions,
} from '../reminders/decisions';
import {
  HEALTH_LOCAL_REMINDER_COVERAGE,
  HEALTH_REMINDER_CLASSES,
  HEALTH_REMINDER_HORIZON_DAYS,
  HEALTH_REMINDER_PREFIX,
  HEALTH_REMINDER_RESCHEDULE_INTERVAL_MS,
  HEALTH_REMINDER_TYPES,
  MAX_WATER_REMINDERS_PER_DAY,
  buildHealthReminderPlan,
  cancelHealthLocalReminders,
  getHealthLocalRemindersCopy,
  getHealthLocalRemindersDeniedCopy,
  healthReminderSetHash,
  healthRescheduleDecision,
  isWithinQuietHours,
  syncHealthLocalReminders,
  type HealthReminderInput,
  type HealthReminderLedger,
} from '../reminders/healthLocalReminders';
import {
  HE7_LITE_REMINDER_FEATURES,
  HE7_LITE_REMINDER_SLOTS,
  HEALTH_NOTIFICATION_FEATURES,
  HEALTH_NOTIFICATION_HEADROOM,
  HEALTH_NOTIFICATION_SLOT_ALLOCATION,
  HEALTH_NOTIFICATION_SLOT_WAVE,
  HEALTH_REMINDER_SLOTS,
  IOS_PENDING_NOTIFICATION_LIMIT,
  allocatedHealthNotificationSlots,
  totalAllocatedHealthNotificationSlots,
} from '../reminders/slotBudget';
import type { LocalUserHabit } from '../types';

// --- expo-notifications: a real pending list, not a spy ---------------------

const pending: Array<{ identifier: string; content: Record<string, unknown> }> = [];

jest.mock('expo-notifications', () => ({
  // `@services/notifications` (pulled in transitively by healthRemindersStorage)
  // calls this at IMPORT time — a factory without it fails the whole file on
  // load rather than on a call.
  setNotificationHandler: jest.fn(),
  setNotificationCategoryAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  getAllScheduledNotificationsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted', granted: true }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted', granted: true }),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3, LOW: 2, MIN: 1 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

(Notifications.scheduleNotificationAsync as jest.Mock).mockImplementation(
  async (request: { identifier: string; content: Record<string, unknown> }) => {
    pending.push({ identifier: request.identifier, content: request.content });
    return request.identifier;
  }
);
(Notifications.cancelScheduledNotificationAsync as jest.Mock).mockImplementation(
  async (identifier: string) => {
    const index = pending.findIndex((request) => request.identifier === identifier);
    if (index >= 0) pending.splice(index, 1);
  }
);
(Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockImplementation(async () => [
  ...pending,
]);

// --- engine + flag: the scheduler reads a session, the suite supplies one ----

let mockSessionOpen = true;
let mockLedger: HealthReminderLedger = emptyLedger();

jest.mock('../flag', () => ({
  isHealthLocalFirst: () => true,
  isHealthP2PEnabled: () => false,
}));

jest.mock('../engine', () => ({
  isLocalHealthSessionOpen: () => mockSessionOpen,
  getLocalHealthLedger: () => mockLedger,
}));

// --- fixtures ---------------------------------------------------------------

function emptyLedger(overrides: Partial<HealthReminderLedger> = {}): HealthReminderLedger {
  return {
    userHabits: [],
    habitLogs: [],
    nutritionEntries: [],
    weightEntries: [],
    waterEntries: [],
    healthGoals: [],
    ...overrides,
  };
}

/** A Friday at noon, far from any DST boundary in the ambient zone. */
const NOW = new Date(2026, 5, 12, 12, 0, 0, 0);

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function shiftDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function prefs(overrides: Partial<HealthReminderPreferences> = {}): HealthReminderPreferences {
  return {
    ...DEFAULT_HEALTH_REMINDERS,
    user_id: 'user-1',
    // Quiet hours OFF by default in these fixtures: the shipped default
    // (23:00 -> 07:00) silently deletes candidates, and a suite that forgets it
    // is debugging the wrong thing.
    quiet_hours_enabled: false,
    skip_if_already_logged: false,
    ...overrides,
  };
}

function habit(id: string, overrides: Partial<LocalUserHabit> = {}): LocalUserHabit {
  return {
    id,
    user_id: 'user-1',
    name: `Habit ${id}`,
    icon: 'goals',
    category: 'wellness',
    time_of_day: 'morning',
    frequency: 'daily',
    custom_days: null,
    reminder_time: '09:00',
    reminder_enabled: 1,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function input(
  preferences: HealthReminderPreferences,
  ledger: HealthReminderLedger = emptyLedger()
): HealthReminderInput {
  return { preferences, ledger };
}

/** The "everything on" schedule: 4 meals + 8 water + weigh-in, every day. */
function fullSchedule(overrides: Partial<HealthReminderPreferences> = {}) {
  return prefs({
    meals_enabled: true,
    breakfast_enabled: true,
    lunch_enabled: true,
    snack_enabled: true,
    dinner_enabled: true,
    water_enabled: true,
    water_start_time: '07:00',
    water_end_time: '22:00',
    water_interval_minutes: 60,
    weigh_in_enabled: true,
    weigh_in_days: null,
    ...overrides,
  });
}

async function seedPreferences(value: HealthReminderPreferences): Promise<void> {
  await storageHelpers.setObject(HEALTH_REMINDERS_KEY, value);
}

/** Meals + hydration + weigh-in + a large habit set — ~130 wanted per day. */
function adversarialLedger(habitCount: number): HealthReminderLedger {
  return emptyLedger({
    userHabits: Array.from({ length: habitCount }, (_, i) =>
      habit(`h${i}`, {
        reminder_time: `${pad2(6 + (i % 16))}:${pad2((i * 7) % 60)}`,
        frequency: i % 5 === 0 ? 'weekdays' : 'daily',
      })
    ),
  });
}

beforeEach(async () => {
  pending.length = 0;
  (Notifications.scheduleNotificationAsync as jest.Mock).mockClear();
  (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockClear();
  (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockClear();
  (Notifications.setNotificationCategoryAsync as jest.Mock).mockClear();
  mockSessionOpen = true;
  mockLedger = emptyLedger();
  await cancelHealthLocalReminders();
  await seedPreferences(prefs());
});

// ---------------------------------------------------------------------------
// The named per-feature allocation — the §9 gate on Wave C
// ---------------------------------------------------------------------------

describe('slot budget — the named per-feature allocation', () => {
  it('budgets 56 of the iOS 64, leaving headroom rather than claiming the lot', () => {
    expect(IOS_PENDING_NOTIFICATION_LIMIT).toBe(64);
    expect(HEALTH_NOTIFICATION_HEADROOM).toBe(8);
    expect(HEALTH_REMINDER_SLOTS).toBe(56);
    expect(HEALTH_REMINDER_SLOTS).toBeLessThan(IOS_PENDING_NOTIFICATION_LIMIT);
  });

  it('FAILS if the declared allocations ever sum above 56 — the Wave C contention gate', () => {
    // §9: "Wave C contends for the same 64 slots ... Name the per-feature
    // allocation in He7-lite before Wave C schedules anything." This assertion
    // is what makes that naming binding rather than documentary: adding cycle
    // predictions with a generous allowance breaks a test instead of silently
    // pushing the far end of the horizon off the OS's list.
    expect(totalAllocatedHealthNotificationSlots()).toBeLessThanOrEqual(HEALTH_REMINDER_SLOTS);
  });

  it('gives every declared feature an allowance and a wave', () => {
    expect(HEALTH_NOTIFICATION_FEATURES.length).toBeGreaterThan(0);
    for (const feature of HEALTH_NOTIFICATION_FEATURES) {
      expect(HEALTH_NOTIFICATION_SLOT_ALLOCATION[feature]).toBeGreaterThan(0);
      expect(['he7-lite', 'wave-c']).toContain(HEALTH_NOTIFICATION_SLOT_WAVE[feature]);
    }
  });

  it('reserves the Wave C rows instead of letting He7-lite spend them', () => {
    const waveC = HEALTH_NOTIFICATION_FEATURES.filter(
      (feature) => HEALTH_NOTIFICATION_SLOT_WAVE[feature] === 'wave-c'
    );
    expect(waveC).toEqual(expect.arrayContaining(['cycle', 'mensHealth']));
    expect(allocatedHealthNotificationSlots(waveC)).toBeGreaterThan(0);

    // The live budget plus the reservation is the whole 56 — so cycle
    // predictions shipping is a table edit here, not an overflow.
    expect(HE7_LITE_REMINDER_SLOTS + allocatedHealthNotificationSlots(waveC)).toBe(
      totalAllocatedHealthNotificationSlots()
    );
    expect(HE7_LITE_REMINDER_SLOTS).toBeLessThan(HEALTH_REMINDER_SLOTS);
  });

  it('schedules exactly the He7-lite features and none of the Wave C ones', () => {
    expect([...HEALTH_REMINDER_CLASSES].sort()).toEqual([...HE7_LITE_REMINDER_FEATURES].sort());
  });
});

// ---------------------------------------------------------------------------
// Plan construction
// ---------------------------------------------------------------------------

describe('buildHealthReminderPlan — meals', () => {
  it('places only the enabled slots, at their configured wall-clock time', () => {
    const plan = buildHealthReminderPlan(
      input(
        prefs({
          meals_enabled: true,
          breakfast_enabled: true,
          breakfast_time: '08:30',
          dinner_enabled: true,
          dinner_time: '19:15',
        })
      ),
      NOW
    );

    const meals = plan.filter((candidate) => candidate.cls === 'meals');
    expect(meals.length).toBeGreaterThan(0);
    expect(new Set(meals.map((candidate) => candidate.data.slot))).toEqual(
      new Set(['breakfast', 'dinner'])
    );
    for (const candidate of meals) {
      expect(candidate.data.type).toBe(HEALTH_REMINDER_TYPES.MEAL);
      expect(candidate.data.screen).toBe('/health-nutrition');
      expect(candidate.identifier.startsWith(HEALTH_REMINDER_PREFIX)).toBe(true);
      const hhmm = `${pad2(candidate.fireAt.getHours())}:${pad2(candidate.fireAt.getMinutes())}`;
      expect(['08:30', '19:15']).toContain(hhmm);
    }
  });

  it('emits nothing when the master switch is off, whatever the slots say', () => {
    const plan = buildHealthReminderPlan(
      input(prefs({ meals_enabled: false, breakfast_enabled: true })),
      NOW
    );
    expect(plan).toHaveLength(0);
  });

  it('never places a slot that has already passed today', () => {
    // NOW is 12:00; breakfast at 08:30 is behind us, so the first breakfast
    // candidate must be tomorrow's.
    const plan = buildHealthReminderPlan(
      input(prefs({ meals_enabled: true, breakfast_enabled: true, breakfast_time: '08:30' })),
      NOW
    );
    expect(plan[0].fireAt.getTime()).toBeGreaterThan(NOW.getTime());
    expect(dayKey(plan[0].fireAt)).toBe(dayKey(shiftDays(NOW, 1)));
  });
});

describe('buildHealthReminderPlan — hydration', () => {
  /** Candidate count per local calendar day — the quantity the clamp bounds. */
  function perDay(plan: ReturnType<typeof buildHealthReminderPlan>): Map<string, number> {
    const counts = new Map<string, number>();
    for (const candidate of plan) {
      const key = candidate.data.localDate as string;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  it('expands the window by the interval and clamps to the server per-day ceiling', () => {
    // Every 15 minutes from 07:00 to 23:00 is 65 nudges a day. The server has
    // always clamped that to 8 (`MAX_WATER_REMINDERS_PER_DAY`), and the local
    // port must clamp it identically or the same schedule produces a different
    // day on each path.
    const plan = buildHealthReminderPlan(
      input(
        prefs({
          water_enabled: true,
          water_start_time: '07:00',
          water_end_time: '23:00',
          water_interval_minutes: 15,
        })
      ),
      NOW
    );

    const counts = [...perDay(plan).values()];
    expect(counts.length).toBeGreaterThan(0);
    for (const count of counts) expect(count).toBeLessThanOrEqual(MAX_WATER_REMINDERS_PER_DAY);
    expect(counts).toContain(MAX_WATER_REMINDERS_PER_DAY);
    expect(plan[0].data.type).toBe(HEALTH_REMINDER_TYPES.WATER);
    expect(plan[0].data.screen).toBe('/health-water');
  });

  it('emits nothing for a window that ends before it starts — a typo, not an overnight window', () => {
    const plan = buildHealthReminderPlan(
      input(prefs({ water_enabled: true, water_start_time: '21:00', water_end_time: '09:00' })),
      NOW
    );
    expect(plan).toHaveLength(0);
  });

  it('does not let a quiet-hours-suppressed nudge eat the daily allowance', () => {
    // 07:00->23:00 hourly with quiet hours 21:00->07:00 suppresses the 21:00,
    // 22:00 and 23:00 slots. A member whose window overlaps the quiet block must
    // still get their full eight AUDIBLE nudges on a whole day, not five — which
    // is what a naive `filter` after the clamp would leave them with.
    const plan = buildHealthReminderPlan(
      input(
        prefs({
          water_enabled: true,
          water_start_time: '07:00',
          water_end_time: '23:00',
          water_interval_minutes: 60,
          quiet_hours_enabled: true,
          quiet_hours_start: '21:00',
          quiet_hours_end: '07:00',
        })
      ),
      NOW
    );

    for (const candidate of plan) {
      const minutes = candidate.fireAt.getHours() * 60 + candidate.fireAt.getMinutes();
      expect(isWithinQuietHours(minutes, '21:00', '07:00')).toBe(false);
    }
    // Tomorrow is the first WHOLE day in the horizon (today started at noon).
    expect(perDay(plan).get(dayKey(shiftDays(NOW, 1)))).toBe(MAX_WATER_REMINDERS_PER_DAY);
  });
});

describe('buildHealthReminderPlan — weigh-in', () => {
  it('honours the weekday list', () => {
    // 2 = Monday in the donor numbering (1 = Sunday).
    const plan = buildHealthReminderPlan(
      input(prefs({ weigh_in_enabled: true, weigh_in_time: '08:00', weigh_in_days: [2] })),
      NOW
    );

    expect(plan.length).toBeGreaterThan(0);
    for (const candidate of plan) {
      expect(candidate.fireAt.getDay()).toBe(1); // JS Monday
      expect(candidate.data.type).toBe(HEALTH_REMINDER_TYPES.WEIGH_IN);
    }
  });

  it('treats null as every day and an empty list as no day', () => {
    const everyDay = buildHealthReminderPlan(
      input(prefs({ weigh_in_enabled: true, weigh_in_time: '20:00', weigh_in_days: null })),
      NOW
    );
    expect(everyDay.length).toBeGreaterThan(1);

    const noDay = buildHealthReminderPlan(
      input(prefs({ weigh_in_enabled: true, weigh_in_time: '20:00', weigh_in_days: [] })),
      NOW
    );
    expect(noDay).toHaveLength(0);
  });

  it('reaches four weeks ahead so a WEEKLY weigh-in can spend its allowance', () => {
    const plan = buildHealthReminderPlan(
      input(prefs({ weigh_in_enabled: true, weigh_in_time: '08:00', weigh_in_days: [2] })),
      NOW
    );
    const span = (plan[plan.length - 1].fireAt.getTime() - NOW.getTime()) / (24 * 60 * 60 * 1000);
    expect(span).toBeGreaterThan(14);
    expect(span).toBeLessThanOrEqual(HEALTH_REMINDER_HORIZON_DAYS);
  });
});

describe('buildHealthReminderPlan — habits', () => {
  it('carries the habit name and routes to the habits screen', () => {
    const ledger = emptyLedger({ userHabits: [habit('h1', { name: 'Evening walk' })] });
    const plan = buildHealthReminderPlan(input(prefs(), ledger), NOW);

    expect(plan.length).toBeGreaterThan(0);
    expect(plan[0].title).toBe('Evening walk');
    expect(plan[0].data.type).toBe(HEALTH_REMINDER_TYPES.HABIT);
    expect(plan[0].data.habitId).toBe('h1');
    expect(plan[0].data.screen).toBe('/health-habits');
  });

  it('skips archived, reminder-disabled, deleted and time-less habits', () => {
    const ledger = emptyLedger({
      userHabits: [
        habit('archived', { is_archived: 1 }),
        habit('off', { reminder_enabled: 0 }),
        habit('deleted', { deleted_at: '2026-02-01T00:00:00.000Z' }),
        habit('untimed', { reminder_time: null }),
      ],
    });
    expect(buildHealthReminderPlan(input(prefs(), ledger), NOW)).toHaveLength(0);
  });

  it('honours frequency and custom_days with the 1 = Sunday numbering', () => {
    const ledger = emptyLedger({
      userHabits: [
        habit('weekend', { frequency: 'weekends' }),
        habit('sunday', { frequency: 'custom', custom_days: JSON.stringify([1]) }),
      ],
    });
    const plan = buildHealthReminderPlan(input(prefs(), ledger), NOW);

    for (const candidate of plan) {
      const jsDay = candidate.fireAt.getDay();
      if (candidate.data.habitId === 'sunday') expect(jsDay).toBe(0);
      else expect([0, 6]).toContain(jsDay);
    }
    expect(plan.some((c) => c.data.habitId === 'sunday')).toBe(true);
    expect(plan.some((c) => c.data.habitId === 'weekend')).toBe(true);
  });

  it('survives malformed custom_days rather than dropping the habit silently', () => {
    const ledger = emptyLedger({
      userHabits: [habit('broken', { frequency: 'custom', custom_days: '{not json' })],
    });
    expect(buildHealthReminderPlan(input(prefs(), ledger), NOW).length).toBeGreaterThan(0);
  });
});

describe('buildHealthReminderPlan — skip_if_already_logged', () => {
  const todayKey = dayKey(NOW);

  it('drops the meal nudge for today once that meal is logged, and leaves tomorrow alone', () => {
    const ledger = emptyLedger({
      nutritionEntries: [
        {
          id: 'n1',
          date: todayKey,
          food_name: 'Soup',
          portion: 1,
          unit: 'bowl',
          meal_type: 'dinner',
          calories: 200,
          proteins: 5,
          carbohydrates: 20,
          fats: 5,
          source: 'manual',
          created_at: '2026-06-12T12:30:00.000Z',
          updated_at: '2026-06-12T12:30:00.000Z',
        },
      ],
    });
    const preferences = prefs({
      skip_if_already_logged: true,
      meals_enabled: true,
      dinner_enabled: true,
      dinner_time: '19:00',
    });

    const plan = buildHealthReminderPlan({ preferences, ledger }, NOW);
    expect(plan.some((c) => c.data.localDate === todayKey)).toBe(false);
    expect(plan.some((c) => c.data.localDate === dayKey(shiftDays(NOW, 1)))).toBe(true);
  });

  it('drops the weigh-in for today once a weight row exists', () => {
    const ledger = emptyLedger({
      weightEntries: [
        {
          id: 'w1',
          date: todayKey,
          weight: 80,
          unit: 'kg',
          source: 'manual',
          created_at: '2026-06-12T07:00:00.000Z',
          updated_at: '2026-06-12T07:00:00.000Z',
        },
      ],
    });
    const preferences = prefs({
      skip_if_already_logged: true,
      weigh_in_enabled: true,
      weigh_in_time: '20:00',
    });

    const plan = buildHealthReminderPlan({ preferences, ledger }, NOW);
    expect(plan.some((c) => c.data.localDate === todayKey)).toBe(false);
  });

  it('silences hydration only when the DAY GOAL is met, never on a single sip', () => {
    const goal = {
      id: 'g1',
      effective_date: '2026-01-01',
      daily_calories: 2000,
      daily_water_ml: 2000,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    const water = (id: string, ml: number) => ({
      id,
      date: todayKey,
      amount_ml: ml,
      beverage_type: 'water',
      created_at: '2026-06-12T09:00:00.000Z',
      updated_at: '2026-06-12T09:00:00.000Z',
    });
    const preferences = prefs({
      skip_if_already_logged: true,
      water_enabled: true,
      water_start_time: '07:00',
      water_end_time: '22:00',
      water_interval_minutes: 120,
    });

    const sip = buildHealthReminderPlan(
      {
        preferences,
        ledger: emptyLedger({ healthGoals: [goal], waterEntries: [water('a', 250)] }),
      },
      NOW
    );
    expect(sip.some((c) => c.data.localDate === todayKey)).toBe(true);

    const met = buildHealthReminderPlan(
      {
        preferences,
        ledger: emptyLedger({ healthGoals: [goal], waterEntries: [water('a', 2100)] }),
      },
      NOW
    );
    expect(met.some((c) => c.data.localDate === todayKey)).toBe(false);
    expect(met.some((c) => c.data.localDate === dayKey(shiftDays(NOW, 1)))).toBe(true);
  });

  it('is inert when the member turned the preference off', () => {
    const ledger = emptyLedger({
      habitLogs: [
        {
          id: 'l1',
          habit_id: 'h1',
          date: todayKey,
          time_of_day: 'evening',
          completed_at: '2026-06-12T09:00:00.000Z',
          created_at: '2026-06-12T09:00:00.000Z',
          updated_at: '2026-06-12T09:00:00.000Z',
        },
      ],
      userHabits: [habit('h1', { reminder_time: '20:00' })],
    });

    const on = buildHealthReminderPlan(
      { preferences: prefs({ skip_if_already_logged: true }), ledger },
      NOW
    );
    expect(on.some((c) => c.data.localDate === todayKey)).toBe(false);

    const off = buildHealthReminderPlan(
      { preferences: prefs({ skip_if_already_logged: false }), ledger },
      NOW
    );
    expect(off.some((c) => c.data.localDate === todayKey)).toBe(true);
  });
});

describe('buildHealthReminderPlan — horizon and ordering', () => {
  it('places nothing beyond the rolling horizon — that is what makes it roll', () => {
    const plan = buildHealthReminderPlan(
      input(prefs({ weigh_in_enabled: true, weigh_in_time: '20:00', weigh_in_days: null })),
      NOW
    );
    const horizonEnd = shiftDays(NOW, HEALTH_REMINDER_HORIZON_DAYS).getTime();
    for (const candidate of plan) {
      expect(candidate.fireAt.getTime()).toBeLessThanOrEqual(horizonEnd);
      expect(candidate.fireAt.getTime()).toBeGreaterThan(NOW.getTime());
    }
  });

  it('returns a plan sorted by fire time, with unique identifiers', () => {
    const ledger = emptyLedger({
      userHabits: [habit('a', { reminder_time: '07:00' }), habit('b', { reminder_time: '21:00' })],
    });
    const plan = buildHealthReminderPlan(input(fullSchedule(), ledger), NOW);

    const times = plan.map((candidate) => candidate.fireAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(plan.map((c) => c.identifier)).size).toBe(plan.length);
  });

  it('is deterministic — two builds of the same input are identical', () => {
    const ledger = emptyLedger({ userHabits: Array.from({ length: 6 }, (_, i) => habit(`h${i}`)) });
    const a = buildHealthReminderPlan(input(fullSchedule(), ledger), NOW);
    const b = buildHealthReminderPlan(input(fullSchedule(), ledger), NOW);
    expect(a.map((c) => c.identifier)).toEqual(b.map((c) => c.identifier));
  });
});

// ---------------------------------------------------------------------------
// The 56 — the DoD He3d assertion, from both ends
// ---------------------------------------------------------------------------

describe('the notification budget of 56', () => {
  it('stays inside the He7-lite budget when the member asks for ~130 a day', () => {
    const ledger = adversarialLedger(120);
    const plan = buildHealthReminderPlan(input(fullSchedule(), ledger), NOW);

    expect(plan.length).toBeLessThanOrEqual(HE7_LITE_REMINDER_SLOTS);
    expect(plan.length).toBeLessThanOrEqual(HEALTH_REMINDER_SLOTS);
    expect(plan.length).toBeGreaterThan(0);

    // Every class survived contact with the loud one — the reason the budget is
    // per-feature rather than a single sorted truncate.
    for (const cls of HEALTH_REMINDER_CLASSES) {
      expect(plan.some((candidate) => candidate.cls === cls)).toBe(true);
    }
  });

  it('leaves the notification centre at 56 or below after a reschedule', async () => {
    mockLedger = adversarialLedger(120);
    await seedPreferences(fullSchedule());

    const result = await syncHealthLocalReminders({ now: NOW });

    const centre = await Notifications.getAllScheduledNotificationsAsync();
    expect(centre.length).toBe(result.scheduled);
    expect(centre.length).toBeLessThanOrEqual(HEALTH_REMINDER_SLOTS);
    expect(centre.length).toBeLessThanOrEqual(IOS_PENDING_NOTIFICATION_LIMIT);
    expect(result.scheduled).toBeGreaterThan(0);
    expect(result.suppressed).toBe(false);
  });

  it('shrinks to what the app has actually left, keeping the WHOLE centre inside 56', async () => {
    // 40 pending requests from elsewhere leave 16 of the 56 — not 24 of the 64.
    // §9 asserts on `getAllScheduledNotificationsAsync().length`, which is the
    // whole centre, so the subtraction has to come off the 56.
    for (let i = 0; i < 40; i += 1) pending.push({ identifier: `other.${i}`, content: {} });

    mockLedger = adversarialLedger(60);
    await seedPreferences(fullSchedule());

    const result = await syncHealthLocalReminders({ now: NOW });

    const centre = await Notifications.getAllScheduledNotificationsAsync();
    expect(centre.length).toBeLessThanOrEqual(HEALTH_REMINDER_SLOTS);
    expect(result.scheduled).toBeLessThanOrEqual(HEALTH_REMINDER_SLOTS - 40);
    expect(centre.filter((r) => r.identifier.startsWith('other.'))).toHaveLength(40);
  });

  it('schedules nothing at all when the centre is already full of other work', async () => {
    for (let i = 0; i < HEALTH_REMINDER_SLOTS; i += 1) {
      pending.push({ identifier: `other.${i}`, content: {} });
    }
    mockLedger = adversarialLedger(20);
    await seedPreferences(fullSchedule());

    const result = await syncHealthLocalReminders({ now: NOW });

    expect(result.scheduled).toBe(0);
    expect((await Notifications.getAllScheduledNotificationsAsync()).length).toBe(
      HEALTH_REMINDER_SLOTS
    );
  });

  it('re-running replaces only its own reminders and leaves other surfaces pending', async () => {
    pending.push({ identifier: 'kaizen.action.1', content: {} });
    mockLedger = emptyLedger({ userHabits: [habit('h1')] });
    await seedPreferences(fullSchedule());

    await syncHealthLocalReminders({ now: NOW });
    const first = (await Notifications.getAllScheduledNotificationsAsync()).filter((r) =>
      r.identifier.startsWith(HEALTH_REMINDER_PREFIX)
    );
    expect(first.length).toBeGreaterThan(0);

    // Force past the §9 bound so this is a genuine second reschedule.
    await syncHealthLocalReminders({ now: NOW, force: true });
    const second = await Notifications.getAllScheduledNotificationsAsync();
    expect(second.filter((r) => r.identifier.startsWith(HEALTH_REMINDER_PREFIX))).toHaveLength(
      first.length
    );
    expect(second.some((r) => r.identifier === 'kaizen.action.1')).toBe(true);
    expect(second.length).toBeLessThanOrEqual(HEALTH_REMINDER_SLOTS);
  });

  it('does nothing when no local session is open', async () => {
    mockSessionOpen = false;
    mockLedger = adversarialLedger(20);
    await seedPreferences(fullSchedule());

    const result = await syncHealthLocalReminders({ now: NOW });
    expect(result.reason).toBe('inactive');
    expect(await Notifications.getAllScheduledNotificationsAsync()).toHaveLength(0);
  });

  it('cancelHealthLocalReminders clears only the Health prefix', async () => {
    pending.push({ identifier: 'kaizen.action.1', content: {} });
    mockLedger = emptyLedger({ userHabits: [habit('h1')] });
    await seedPreferences(fullSchedule());
    await syncHealthLocalReminders({ now: NOW });

    await cancelHealthLocalReminders();

    const centre = await Notifications.getAllScheduledNotificationsAsync();
    expect(centre).toHaveLength(1);
    expect(centre[0].identifier).toBe('kaizen.action.1');
  });
});

// ---------------------------------------------------------------------------
// The bound — hash + 6 h, and proof that it suppresses WORK
// ---------------------------------------------------------------------------

describe('bounded reschedule (plan §9)', () => {
  it('decides on content change or 6 h, whichever comes first', () => {
    const state = { hash: 'aaaa', at: 1_000_000, scheduled: 12 };

    expect(healthRescheduleDecision('aaaa', null, 1_000_000)).toEqual({
      reschedule: true,
      reason: 'first-run',
    });
    expect(healthRescheduleDecision('bbbb', state, 1_000_001)).toEqual({
      reschedule: true,
      reason: 'content-changed',
    });
    expect(healthRescheduleDecision('aaaa', state, 1_000_000 + 60_000)).toEqual({
      reschedule: false,
      reason: 'bounded',
    });
    expect(
      healthRescheduleDecision('aaaa', state, 1_000_000 + HEALTH_REMINDER_RESCHEDULE_INTERVAL_MS)
    ).toEqual({ reschedule: true, reason: 'interval-elapsed' });
  });

  it('treats a clock that went BACKWARDS as elapsed, not as fresh', () => {
    const state = { hash: 'aaaa', at: 5_000_000, scheduled: 3 };
    expect(healthRescheduleDecision('aaaa', state, 1_000).reschedule).toBe(true);
  });

  it('hashes what changes the plan and ignores what does not', () => {
    const ledger = emptyLedger({ userHabits: [habit('h1')] });
    const base = healthReminderSetHash({ preferences: fullSchedule(), ledger }, NOW);

    // A weight reading is not part of the reminder set — the hash must not move,
    // or a logging session would burn the bound.
    const withWeight = healthReminderSetHash(
      {
        preferences: fullSchedule(),
        ledger: emptyLedger({
          userHabits: [habit('h1')],
          weightEntries: [
            {
              id: 'w1',
              date: '2026-06-01',
              weight: 80,
              unit: 'kg',
              source: 'manual',
              created_at: '2026-06-01T00:00:00.000Z',
              updated_at: '2026-06-01T00:00:00.000Z',
            },
          ],
        }),
      },
      NOW
    );
    expect(withWeight).toBe(base);

    // A schedule change must move it.
    expect(
      healthReminderSetHash({ preferences: fullSchedule({ dinner_time: '20:30' }), ledger }, NOW)
    ).not.toBe(base);
    // So must a habit's reminder time...
    expect(
      healthReminderSetHash(
        {
          preferences: fullSchedule(),
          ledger: emptyLedger({ userHabits: [habit('h1', { reminder_time: '10:30' })] }),
        },
        NOW
      )
    ).not.toBe(base);
    // ...and so must the calendar day, because the horizon has moved.
    expect(
      healthReminderSetHash({ preferences: fullSchedule(), ledger }, shiftDays(NOW, 1))
    ).not.toBe(base);
  });

  it('does no notification I/O at all on the bounded path', async () => {
    mockLedger = emptyLedger({ userHabits: [habit('h1')] });
    await seedPreferences(fullSchedule());

    const first = await syncHealthLocalReminders({ now: NOW });
    expect(first.suppressed).toBe(false);
    expect(
      (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.length
    ).toBeGreaterThan(0);

    (Notifications.scheduleNotificationAsync as jest.Mock).mockClear();
    (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockClear();
    (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockClear();

    const second = await syncHealthLocalReminders({ now: new Date(NOW.getTime() + 60_000) });

    expect(second.suppressed).toBe(true);
    expect(second.reason).toBe('bounded');
    expect(second.scheduled).toBe(first.scheduled);
    // The whole point: not one cancel, not one schedule, and not even a read of
    // the centre. §9's complaint is about WORK, so the bound must elide work.
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
    expect(Notifications.getAllScheduledNotificationsAsync).not.toHaveBeenCalled();
  });

  it('reschedules when the reminder set changes, and again once 6 h have passed', async () => {
    mockLedger = emptyLedger({ userHabits: [habit('h1')] });
    await seedPreferences(fullSchedule());
    await syncHealthLocalReminders({ now: NOW });

    // (a) content change — a new habit reminder.
    mockLedger = emptyLedger({
      userHabits: [habit('h1'), habit('h2', { reminder_time: '18:45' })],
    });
    const changed = await syncHealthLocalReminders({ now: new Date(NOW.getTime() + 300_000) });
    expect(changed.suppressed).toBe(false);
    expect(changed.reason).toBe('content-changed');
    expect((await Notifications.getAllScheduledNotificationsAsync()).length).toBeLessThanOrEqual(
      HEALTH_REMINDER_SLOTS
    );

    // (b) nothing changed, but six hours have gone by — the horizon has to be
    // topped up even for a member whose settings never move.
    const later = new Date(NOW.getTime() + 300_000 + HEALTH_REMINDER_RESCHEDULE_INTERVAL_MS);
    const elapsed = await syncHealthLocalReminders({ now: later });
    expect(elapsed.suppressed).toBe(false);
    expect(elapsed.reason).toBe('interval-elapsed');
    expect((await Notifications.getAllScheduledNotificationsAsync()).length).toBeLessThanOrEqual(
      HEALTH_REMINDER_SLOTS
    );
  });

  it('suppresses a CHURNING ledger — 60 passes, one reschedule, inside 56 throughout', async () => {
    // The realistic churn: a member logging all afternoon. Every one of these
    // passes is a `notifyHealthLedgerChanged` fan-out that would, unbounded,
    // cancel and re-place the whole plan.
    mockLedger = emptyLedger({
      userHabits: [habit('h1'), habit('h2', { reminder_time: '19:30' })],
    });
    await seedPreferences(fullSchedule());

    const firstPass = await syncHealthLocalReminders({ now: NOW });
    expect(firstPass.suppressed).toBe(false);
    const placedOnFirstPass = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls
      .length;
    (Notifications.scheduleNotificationAsync as jest.Mock).mockClear();

    let reschedules = 0;
    for (let i = 1; i <= 60; i += 1) {
      // Each pass adds a weight reading — real ledger churn that is NOT part of
      // the reminder set.
      mockLedger = {
        ...mockLedger,
        weightEntries: [
          ...mockLedger.weightEntries,
          {
            id: `w${i}`,
            date: '2026-06-01',
            weight: 80 + i,
            unit: 'kg',
            source: 'manual',
            created_at: '2026-06-01T00:00:00.000Z',
            updated_at: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
      // One minute apart — sixty passes span an hour, well inside the 6 h bound.
      const result = await syncHealthLocalReminders({ now: new Date(NOW.getTime() + i * 60_000) });
      if (!result.suppressed) reschedules += 1;

      const centre = await Notifications.getAllScheduledNotificationsAsync();
      expect(centre.length).toBeLessThanOrEqual(HEALTH_REMINDER_SLOTS);
    }

    expect(reschedules).toBe(0);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect((await Notifications.getAllScheduledNotificationsAsync()).length).toBe(
      placedOnFirstPass
    );
  });

  it('persists the stamp under the health.*.v1 key convention, holding no plaintext', async () => {
    mockLedger = emptyLedger({ userHabits: [habit('h1', { name: 'Evening walk' })] });
    await seedPreferences(fullSchedule({ breakfast_time: '08:17' }));
    await syncHealthLocalReminders({ now: NOW });

    const raw = await storageHelpers.getString('health.reminderSchedule.v1');
    expect(raw).toBeDefined();
    const state = JSON.parse(raw as string) as Record<string, unknown>;
    expect(typeof state.hash).toBe('string');
    expect(state.at).toBe(NOW.getTime());
    expect(state.scheduled as number).toBeGreaterThan(0);
    // Neither the habit's name nor a clock time may be recoverable from it.
    expect(raw).not.toContain('Evening walk');
    expect(raw).not.toContain('08:17');
  });
});

// ---------------------------------------------------------------------------
// DST — the failure a milliseconds-based horizon hides
// ---------------------------------------------------------------------------

describe('DST transitions', () => {
  const ORIGINAL_TZ = process.env.TZ;

  beforeAll(() => {
    // Node re-reads `process.env.TZ` on assignment, so this really does move the
    // ambient zone for Dates created afterwards. Restored in afterAll — Jest
    // runs several files per worker process and a leaked TZ would be someone
    // else's flake.
    process.env.TZ = 'America/New_York';
  });

  afterAll(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  /** 2026: spring forward Sun 8 March, fall back Sun 1 November. */
  const CASES = [
    { label: 'spring forward', now: new Date(2026, 2, 6, 12, 0, 0, 0), boundary: '2026-03-08' },
    { label: 'fall back', now: new Date(2026, 9, 29, 12, 0, 0, 0), boundary: '2026-11-01' },
  ];

  for (const testCase of CASES) {
    it(`keeps the wall-clock time across the ${testCase.label} boundary`, () => {
      const plan = buildHealthReminderPlan(
        input(prefs({ meals_enabled: true, breakfast_enabled: true, breakfast_time: '08:30' })),
        testCase.now
      );

      expect(plan.length).toBeGreaterThan(5);
      expect(plan.some((candidate) => candidate.data.localDate === testCase.boundary)).toBe(true);
      for (const candidate of plan) {
        // Millisecond stepping would land on 07:30 or 09:30 here.
        expect(candidate.fireAt.getHours()).toBe(8);
        expect(candidate.fireAt.getMinutes()).toBe(30);
      }
    });

    it(`neither skips nor repeats a calendar day across the ${testCase.label}`, () => {
      const plan = buildHealthReminderPlan(
        input(prefs({ meals_enabled: true, breakfast_enabled: true, breakfast_time: '08:30' })),
        testCase.now
      );

      const days = plan.map((candidate) => candidate.data.localDate as string);
      expect(new Set(days).size).toBe(days.length); // no repeat
      for (let i = 1; i < days.length; i += 1) {
        const previous = new Date(`${days[i - 1]}T00:00:00Z`).getTime();
        const current = new Date(`${days[i]}T00:00:00Z`).getTime();
        expect(current - previous).toBe(24 * 60 * 60 * 1000); // no skip
      }
    });
  }

  it('stays inside the 56 across a transition with a full schedule', async () => {
    mockLedger = emptyLedger({
      userHabits: Array.from({ length: 40 }, (_, i) =>
        habit(`h${i}`, { reminder_time: `${pad2(6 + (i % 15))}:${pad2((i * 11) % 60)}` })
      ),
    });
    await seedPreferences(fullSchedule());

    const result = await syncHealthLocalReminders({ now: CASES[0].now });

    const centre = await Notifications.getAllScheduledNotificationsAsync();
    expect(centre.length).toBe(result.scheduled);
    expect(centre.length).toBeLessThanOrEqual(HEALTH_REMINDER_SLOTS);
  });
});

// ---------------------------------------------------------------------------
// The two recorded decisions (DoD He3d)
// ---------------------------------------------------------------------------

describe('recorded decision — authenticationRequired', () => {
  it('requires authentication on any future reminder action', () => {
    expect(HEALTH_REMINDER_AUTHENTICATION_REQUIRED).toBe(true);
    expect(healthReminderActionOptions()).toEqual({
      isAuthenticationRequired: true,
      opensAppToForeground: true,
    });
  });

  it('ships NO notification actions at all — a locked action is a silent no-op', async () => {
    expect(HEALTH_REMINDER_ACTIONS).toHaveLength(0);

    mockLedger = emptyLedger({ userHabits: [habit('h1')] });
    await seedPreferences(fullSchedule());
    await syncHealthLocalReminders({ now: NOW });

    // No category is registered, so there is no action for iOS to hand to a
    // locked device — the only safe state under the ledger's
    // WHEN_UNLOCKED_THIS_DEVICE_ONLY DEK class.
    expect(Notifications.setNotificationCategoryAsync).not.toHaveBeenCalled();
  });

  it('puts no reading in a notification body — the lock-screen content rule', async () => {
    expect(HEALTH_REMINDER_BODIES_CARRY_READINGS).toBe(false);

    mockLedger = emptyLedger();
    await seedPreferences(fullSchedule());
    await syncHealthLocalReminders({ now: NOW });

    const centre = await Notifications.getAllScheduledNotificationsAsync();
    expect(centre.length).toBeGreaterThan(0);
    for (const request of centre) {
      // No weight, no calorie total, no millilitres — nothing numeric at all in
      // the copy this module authors. (Habit titles are member-authored, hence
      // no habits in this fixture.)
      expect(String(request.content.body)).not.toMatch(/\d/);
      expect(String(request.content.title)).not.toMatch(/\d/);
    }
  });
});

describe('recorded decision — Q3a (the glance file class)', () => {
  it('takes Option A: the App Group default, no completeFileProtection', () => {
    expect(HEALTH_GLANCE_FILE_PROTECTION).toBe('CompleteUntilFirstUserAuthentication');
    // §17 forbids GUESSING Option B — the entitlement is irreversible for a
    // shipped widget and leaves it permanently dark.
    expect(HEALTH_GLANCE_WIDGET_ENTITLEMENT).toHaveLength(0);
    expect(HEALTH_GLANCE_WIDGET_ENTITLEMENT).not.toContain('NSFileProtectionComplete');
  });

  it('ships the glance dark, with copy, and names the real control', () => {
    expect(HEALTH_GLANCE_ENABLED_BY_DEFAULT).toBe(false);
    expect([...HEALTH_GLANCE_NEVER_LIST].sort()).toEqual(['cycle', 'injury', 'vitality']);

    const copy = getHealthGlanceDarkCopy();
    expect(copy.title.length).toBeGreaterThan(10);
    expect(copy.message.length).toBeGreaterThan(40);
  });
});

describe('both decisions are recorded in the requirements pack, not only in code', () => {
  const README = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      '..',
      'documents',
      'requirements',
      'Health v2',
      'README.md'
    ),
    'utf8'
  );

  it('records the authenticationRequired decision', () => {
    expect(README).toMatch(/authenticationRequired/);
  });

  it('records the Q3a default as Option A', () => {
    expect(README).toMatch(/Q3a/);
    expect(README).toMatch(/CompleteUntilFirstUserAuthentication/);
  });

  it('records the named per-feature slot allocation', () => {
    expect(README).toMatch(/56/);
    for (const feature of HEALTH_NOTIFICATION_FEATURES) {
      expect(README).toContain(feature);
    }
  });
});

// ---------------------------------------------------------------------------
// Member-facing coverage copy
// ---------------------------------------------------------------------------

describe('member-facing coverage copy', () => {
  it('names the live classes and what is dark on this build', () => {
    expect(HEALTH_LOCAL_REMINDER_COVERAGE.live.length).toBe(HEALTH_REMINDER_CLASSES.length);
    expect(HEALTH_LOCAL_REMINDER_COVERAGE.dark).toContain(
      'Reminders while the app is never opened'
    );

    const copy = getHealthLocalRemindersCopy();
    expect(copy.title).toMatch(/device/i);
    // Q7 — the accepted cost, stated to the member rather than discovered.
    expect(copy.message).toMatch(/open the app/i);
    // And the habit-cap consequence, likewise stated.
    expect(copy.message).toMatch(/only the next few/i);
  });

  it('has explicit dark copy for the permission-denied state — never a silent empty', () => {
    const copy = getHealthLocalRemindersDeniedCopy();
    expect(copy.title).toMatch(/off on this build/i);
    expect(copy.message.length).toBeGreaterThan(40);
  });
});
