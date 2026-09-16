import type { PermissionStatus } from 'expo-notifications';
/**
 * Symply Health — REMINDERS (donor "Smart Notifications", `healthRemindersStorage.ts`).
 *
 * Zero coverage before this file. Four properties matter most:
 *
 *  1. **NEVER schedule what cannot be delivered.** `enableHealthReminders`
 *     refuses to turn a category on until the OS has granted push permission —
 *     a reminder nobody can receive is worse than none, because the member
 *     believes they are covered.
 *  2. **The device timezone always rides along on an enable.** Without it the
 *     server falls back to a DEFAULT zone, silently mistiming every nudge for
 *     anyone outside it.
 *  3. **`syncHealthReminderTimezone` is the only place a stale zone gets
 *     corrected**, and it must be a true no-op — no read, no write, no
 *     exception surfacing — for the common cases: nothing enabled, or the
 *     zone already matches.
 *  4. **No raw error ever reaches the UI.** Every failure path returns a
 *     friendly, pre-written message, never the axios/HTTP failure itself.
 */

import {
  healthRemindersApi,
  type HealthReminderPreferences,
} from '@api/healthReminders';
import { notificationService } from '@services/notifications';
import { storageHelpers } from '@services/storage';

import {
  clampWaterInterval,
  clearHealthReminders,
  DEFAULT_HEALTH_REMINDERS,
  describeHealthReminders,
  disableHealthReminders,
  enabledMealSlots,
  enableHealthReminders,
  ensureHealthReminderPermission,
  hasAnyReminderEnabled,
  healthReminderPermissionStatus,
  HEALTH_REMINDERS_KEY,
  loadHealthReminders,
  MAX_WATER_INTERVAL_MINUTES,
  MIN_WATER_INTERVAL_MINUTES,
  saveHealthReminders,
  syncHealthReminderTimezone,
  waterRemindersPerDay,
} from '../healthRemindersStorage';
import { __setHealthOfflineForTests, healthSyncStateFor } from '../healthRepository';

jest.mock('@api/healthReminders');
jest.mock('@services/notifications', () => ({
  notificationService: {
    hasPermission: jest.fn(),
    requestPermission: jest.fn(),
    registerWithServer: jest.fn(),
    getPermissionStatus: jest.fn(),
  },
}));

const api = healthRemindersApi as jest.Mocked<typeof healthRemindersApi>;
const notif = notificationService as jest.Mocked<typeof notificationService>;

const NETWORK_ERROR = new Error('Network request failed');
const ISO = '2026-07-13T08:00:00.000Z';

function prefs(over: Partial<HealthReminderPreferences> = {}): HealthReminderPreferences {
  return {
    ...DEFAULT_HEALTH_REMINDERS,
    user_id: 'user-1',
    created_at: ISO,
    updated_at: ISO,
    ...over,
  };
}

/** Stands in for `Intl.DateTimeFormat().resolvedOptions().timeZone`. */
function mockDeviceTimezone(tz: string | null) {
  jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(
    () =>
      ({
        resolvedOptions: () => ({ timeZone: tz }),
      }) as unknown as Intl.DateTimeFormat
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  __setHealthOfflineForTests(false);
  await storageHelpers.delete(HEALTH_REMINDERS_KEY);
  api.getPreferences.mockResolvedValue({ preferences: prefs() });
  api.savePreferences.mockResolvedValue({ preferences: prefs(), cancelled: 0, scheduled: 0 });
  api.clearPreferences.mockResolvedValue({ deleted: true, cancelled: 0 });
  notif.hasPermission.mockResolvedValue(true);
  notif.requestPermission.mockResolvedValue(true);
  notif.registerWithServer.mockResolvedValue(undefined);
  notif.getPermissionStatus.mockResolvedValue('granted' as PermissionStatus);
  mockDeviceTimezone('Europe/London');
});

afterEach(() => {
  __setHealthOfflineForTests(false);
  jest.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

describe('hasAnyReminderEnabled', () => {
  it('HEALTH-REMIND-001: true when ANY one of the three categories is on', () => {
    expect(hasAnyReminderEnabled(prefs())).toBe(false);
    expect(hasAnyReminderEnabled(prefs({ meals_enabled: true }))).toBe(true);
    expect(hasAnyReminderEnabled(prefs({ water_enabled: true }))).toBe(true);
    expect(hasAnyReminderEnabled(prefs({ weigh_in_enabled: true }))).toBe(true);
  });
});

describe('enabledMealSlots', () => {
  it('HEALTH-REMIND-010: empty when meals_enabled is off, regardless of the per-slot flags', () => {
    expect(enabledMealSlots(prefs({ meals_enabled: false, breakfast_enabled: true }))).toEqual([]);
  });

  it('HEALTH-REMIND-011: only the slots that are individually on, in day order', () => {
    expect(
      enabledMealSlots(
        prefs({ meals_enabled: true, dinner_enabled: true, breakfast_enabled: true, lunch_enabled: false })
      )
    ).toEqual(['breakfast', 'dinner']);
  });
});

describe('describeHealthReminders', () => {
  it('HEALTH-REMIND-020: "Off" when nothing is enabled', () => {
    expect(describeHealthReminders(prefs())).toBe('Off');
  });

  it('HEALTH-REMIND-021: meals_enabled with NO slot on produces no "Meals" phrase — it would fire nothing', () => {
    // The header rule: only name a category that will actually produce a nudge.
    expect(describeHealthReminders(prefs({ meals_enabled: true }))).toBe('Off');
  });

  it('HEALTH-REMIND-022: counts the enabled slots in "Meals (N)"', () => {
    expect(
      describeHealthReminders(
        prefs({ meals_enabled: true, breakfast_enabled: true, dinner_enabled: true })
      )
    ).toBe('Meals (2)');
  });

  it('HEALTH-REMIND-023: joins every active category with " · "', () => {
    expect(
      describeHealthReminders(
        prefs({
          meals_enabled: true,
          lunch_enabled: true,
          water_enabled: true,
          weigh_in_enabled: true,
        })
      )
    ).toBe('Meals (1) · Water · Weigh-in');
  });
});

describe('waterRemindersPerDay / clampWaterInterval', () => {
  it('HEALTH-REMIND-030: a normal window/interval produces the expected count', () => {
    // 09:00 → 21:00 (720 min) / 120 min interval + the starting ping = 7.
    expect(waterRemindersPerDay(prefs({ water_start_time: '09:00', water_end_time: '21:00', water_interval_minutes: 120 }))).toBe(7);
  });

  it('HEALTH-REMIND-031: an end time at or before the start produces zero, not a negative count', () => {
    expect(waterRemindersPerDay(prefs({ water_start_time: '21:00', water_end_time: '09:00' }))).toBe(0);
    expect(waterRemindersPerDay(prefs({ water_start_time: '09:00', water_end_time: '09:00' }))).toBe(0);
  });

  it('HEALTH-REMIND-032: a malformed time string yields zero rather than throwing', () => {
    expect(waterRemindersPerDay(prefs({ water_start_time: 'not-a-time', water_end_time: '21:00' }))).toBe(0);
    expect(waterRemindersPerDay(prefs({ water_start_time: '09:00', water_end_time: '25:99' }))).toBe(0);
  });

  it('HEALTH-REMIND-033: the server ceiling of 8 reminders/day is enforced client-side too', () => {
    // A tiny interval across the whole day would otherwise compute dozens.
    expect(waterRemindersPerDay(prefs({ water_start_time: '00:00', water_end_time: '23:59', water_interval_minutes: 15 }))).toBe(8);
  });

  it('HEALTH-REMIND-034: clampWaterInterval enforces both the floor and the ceiling', () => {
    expect(clampWaterInterval(5)).toBe(MIN_WATER_INTERVAL_MINUTES);
    expect(clampWaterInterval(10000)).toBe(MAX_WATER_INTERVAL_MINUTES);
    expect(clampWaterInterval(90)).toBe(90);
    expect(clampWaterInterval(90.6)).toBe(91); // rounds before clamping
  });

  it('HEALTH-REMIND-035: a non-finite interval falls back to the documented default', () => {
    expect(clampWaterInterval(Number.NaN)).toBe(DEFAULT_HEALTH_REMINDERS.water_interval_minutes);
    expect(clampWaterInterval(Number.POSITIVE_INFINITY)).toBe(DEFAULT_HEALTH_REMINDERS.water_interval_minutes);
  });
});

/* ------------------------------------------------------------------ */
/* Read                                                                 */
/* ------------------------------------------------------------------ */

describe('loadHealthReminders', () => {
  it('HEALTH-REMIND-040: merges the server row onto the documented defaults', async () => {
    api.getPreferences.mockResolvedValue({
      preferences: prefs({ meals_enabled: true, breakfast_time: '07:00' }),
    });
    const loaded = await loadHealthReminders();
    expect(loaded.meals_enabled).toBe(true);
    expect(loaded.breakfast_time).toBe('07:00');
    expect(loaded.water_interval_minutes).toBe(DEFAULT_HEALTH_REMINDERS.water_interval_minutes);
  });

  it('HEALTH-REMIND-041: offline (no cache yet) falls back to the all-OFF defaults, never throws', async () => {
    __setHealthOfflineForTests(true);
    const loaded = await loadHealthReminders();
    expect(loaded).toEqual(DEFAULT_HEALTH_REMINDERS);
  });

  it('HEALTH-REMIND-042: a prior successful read is what an offline read falls back to', async () => {
    api.getPreferences.mockResolvedValue({ preferences: prefs({ water_enabled: true }) });
    await loadHealthReminders();

    __setHealthOfflineForTests(true);
    const loaded = await loadHealthReminders();
    expect(loaded.water_enabled).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Write                                                                */
/* ------------------------------------------------------------------ */

describe('saveHealthReminders', () => {
  it('HEALTH-REMIND-050: on success reports "saved" with an empty message and the real scheduled count', async () => {
    api.getPreferences.mockResolvedValue({ preferences: prefs() });
    api.savePreferences.mockResolvedValue({
      preferences: prefs({ water_enabled: true }),
      cancelled: 0,
      scheduled: 3,
    });

    const result = await saveHealthReminders({ water_enabled: true });

    expect(result.status).toBe('saved');
    expect(result.message).toBe('');
    expect(result.scheduledToday).toBe(3);
    expect(healthSyncStateFor(HEALTH_REMINDERS_KEY)).toBe('synced');
  });

  it('HEALTH-REMIND-051: on failure reports "offline" with the friendly message and scheduledToday 0 — never a raw error', async () => {
    api.savePreferences.mockRejectedValue(NETWORK_ERROR);

    const result = await saveHealthReminders({ water_enabled: true });

    expect(result.status).toBe('offline');
    expect(result.scheduledToday).toBe(0);
    expect(result.message).not.toMatch(/network|fetch|ECONNREFUSED/i);
    expect(result.message.length).toBeGreaterThan(0);
    // The optimistic merge is still reflected, so the toggle does not snap back.
    expect(result.preferences.water_enabled).toBe(true);
  });

  it('HEALTH-REMIND-052: sends ONLY the patch the caller gave it, not the whole object', async () => {
    await saveHealthReminders({ dinner_enabled: true });
    expect(api.savePreferences).toHaveBeenCalledWith({ dinner_enabled: true });
  });
});

describe('enableHealthReminders — the permission gate', () => {
  it('HEALTH-REMIND-060: refuses to enable when permission is denied, and the stored prefs are UNCHANGED', async () => {
    notif.hasPermission.mockResolvedValue(false);
    notif.requestPermission.mockResolvedValue(false);
    api.getPreferences.mockResolvedValue({ preferences: prefs({ water_enabled: false }) });

    const result = await enableHealthReminders('water');

    expect(result.status).toBe('permission_denied');
    expect(result.preferences.water_enabled).toBe(false);
    expect(api.savePreferences).not.toHaveBeenCalled();
  });

  it('HEALTH-REMIND-061: an already-granted permission still registers the token before saving (a restore carries permission, not the token)', async () => {
    notif.hasPermission.mockResolvedValue(true);
    await enableHealthReminders('meals');

    expect(notif.registerWithServer).toHaveBeenCalledTimes(1);
    expect(notif.requestPermission).not.toHaveBeenCalled();
    expect(api.savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ meals_enabled: true })
    );
  });

  it('HEALTH-REMIND-062: a freshly GRANTED request also registers the token before saving', async () => {
    notif.hasPermission.mockResolvedValue(false);
    notif.requestPermission.mockResolvedValue(true);

    await enableHealthReminders('weigh_in');

    expect(notif.requestPermission).toHaveBeenCalledTimes(1);
    expect(notif.registerWithServer).toHaveBeenCalledTimes(1);
    expect(api.savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ weigh_in_enabled: true })
    );
  });

  it('HEALTH-REMIND-063: ALWAYS carries the device timezone alongside the enable', async () => {
    mockDeviceTimezone('Asia/Tokyo');
    await enableHealthReminders('water');
    expect(api.savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ water_enabled: true, timezone: 'Asia/Tokyo' })
    );
  });

  it('HEALTH-REMIND-064: an extra patch (e.g. a chosen time) rides along with the enable', async () => {
    await enableHealthReminders('meals', { breakfast_time: '06:30' });
    expect(api.savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ meals_enabled: true, breakfast_time: '06:30' })
    );
  });

  it('HEALTH-REMIND-065: a permission/registration exception is caught — resolves to permission_denied, never throws', async () => {
    notif.hasPermission.mockRejectedValue(new Error('bridge unavailable'));
    const result = await enableHealthReminders('water');
    expect(result.status).toBe('permission_denied');
  });
});

describe('disableHealthReminders — never needs permission', () => {
  it('HEALTH-REMIND-070: switches the category off without checking permission at all', async () => {
    await disableHealthReminders('meals');
    expect(notif.hasPermission).not.toHaveBeenCalled();
    expect(notif.requestPermission).not.toHaveBeenCalled();
    expect(api.savePreferences).toHaveBeenCalledWith({ meals_enabled: false });
  });

  it('HEALTH-REMIND-071: works even when the OS permission was denied — tidying up must never be blocked', async () => {
    notif.hasPermission.mockResolvedValue(false);
    const result = await disableHealthReminders('water');
    expect(result.status).toBe('saved');
    expect(api.savePreferences).toHaveBeenCalledWith({ water_enabled: false });
  });
});

/* ------------------------------------------------------------------ */
/* Clear                                                                */
/* ------------------------------------------------------------------ */

describe('clearHealthReminders', () => {
  it('HEALTH-REMIND-080: on success re-reads the fresh (all-off) schedule from the server', async () => {
    api.getPreferences.mockResolvedValue({ preferences: prefs() });
    const result = await clearHealthReminders();
    expect(api.clearPreferences).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('saved');
    expect(result.scheduledToday).toBe(0);
  });

  it('HEALTH-REMIND-081: a failure reports "offline" with the friendly message, never a raw error', async () => {
    api.clearPreferences.mockRejectedValue(NETWORK_ERROR);
    const result = await clearHealthReminders();
    expect(result.status).toBe('offline');
    expect(result.message).not.toMatch(/network|fetch/i);
    expect(result.message.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* Permission readers                                                  */
/* ------------------------------------------------------------------ */

describe('ensureHealthReminderPermission', () => {
  it('HEALTH-REMIND-090: true + registers when permission is already granted', async () => {
    notif.hasPermission.mockResolvedValue(true);
    expect(await ensureHealthReminderPermission()).toBe(true);
    expect(notif.registerWithServer).toHaveBeenCalledTimes(1);
  });

  it('HEALTH-REMIND-091: false, no registration, when the OS request is refused', async () => {
    notif.hasPermission.mockResolvedValue(false);
    notif.requestPermission.mockResolvedValue(false);
    expect(await ensureHealthReminderPermission()).toBe(false);
    expect(notif.registerWithServer).not.toHaveBeenCalled();
  });

  it('HEALTH-REMIND-092: any thrown error resolves to false rather than propagating into a settings screen', async () => {
    notif.hasPermission.mockRejectedValue(new Error('boom'));
    expect(await ensureHealthReminderPermission()).toBe(false);
  });
});

describe('healthReminderPermissionStatus', () => {
  it('HEALTH-REMIND-100: passes through granted and undetermined verbatim', async () => {
    notif.getPermissionStatus.mockResolvedValue('granted' as PermissionStatus);
    expect(await healthReminderPermissionStatus()).toBe('granted');
    notif.getPermissionStatus.mockResolvedValue('undetermined' as PermissionStatus);
    expect(await healthReminderPermissionStatus()).toBe('undetermined');
  });

  it('HEALTH-REMIND-101: anything else (denied, or an unrecognised OS value) reads as denied', async () => {
    notif.getPermissionStatus.mockResolvedValue('denied' as PermissionStatus);
    expect(await healthReminderPermissionStatus()).toBe('denied');
    notif.getPermissionStatus.mockResolvedValue('blocked' as never);
    expect(await healthReminderPermissionStatus()).toBe('denied');
  });

  it('HEALTH-REMIND-102: a thrown read resolves to undetermined, not a crash', async () => {
    notif.getPermissionStatus.mockRejectedValue(new Error('boom'));
    expect(await healthReminderPermissionStatus()).toBe('undetermined');
  });
});

/* ------------------------------------------------------------------ */
/* syncHealthReminderTimezone — the riskiest arithmetic on the client   */
/* ------------------------------------------------------------------ */

describe('syncHealthReminderTimezone', () => {
  it('HEALTH-REMIND-110: a true no-op when NOTHING is enabled — no read-triggered write at all', async () => {
    api.getPreferences.mockResolvedValue({ preferences: prefs({ timezone: 'America/New_York' }) });
    mockDeviceTimezone('Asia/Tokyo'); // deliberately mismatched — must still no-op

    await syncHealthReminderTimezone();

    expect(api.savePreferences).not.toHaveBeenCalled();
  });

  it('HEALTH-REMIND-111: a true no-op when the stored zone ALREADY matches the device', async () => {
    api.getPreferences.mockResolvedValue({
      preferences: prefs({ meals_enabled: true, breakfast_enabled: true, timezone: 'Europe/London' }),
    });
    mockDeviceTimezone('Europe/London');

    await syncHealthReminderTimezone();

    expect(api.savePreferences).not.toHaveBeenCalled();
  });

  it('HEALTH-REMIND-112: something enabled + a MISMATCHED zone triggers exactly one timezone-only save', async () => {
    api.getPreferences.mockResolvedValue({
      preferences: prefs({ water_enabled: true, timezone: 'America/New_York' }),
    });
    mockDeviceTimezone('Europe/Berlin');

    await syncHealthReminderTimezone();

    expect(api.savePreferences).toHaveBeenCalledTimes(1);
    expect(api.savePreferences).toHaveBeenCalledWith({ timezone: 'Europe/Berlin' });
  });

  it('HEALTH-REMIND-113: something enabled + a NULL stored zone (never saved before) is a mismatch too, and gets corrected', async () => {
    api.getPreferences.mockResolvedValue({
      preferences: prefs({ weigh_in_enabled: true, timezone: null }),
    });
    mockDeviceTimezone('Pacific/Auckland');

    await syncHealthReminderTimezone();

    expect(api.savePreferences).toHaveBeenCalledWith({ timezone: 'Pacific/Auckland' });
  });

  it('HEALTH-REMIND-114: an undetectable device zone (Intl throws or returns empty) is left alone rather than sent as garbage', async () => {
    api.getPreferences.mockResolvedValue({
      preferences: prefs({ meals_enabled: true, lunch_enabled: true, timezone: 'America/New_York' }),
    });
    jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new Error('Intl unavailable');
    });

    await syncHealthReminderTimezone();

    expect(api.savePreferences).not.toHaveBeenCalled();
  });

  it('HEALTH-REMIND-115: is silent and never throws even when the read itself fails', async () => {
    api.getPreferences.mockRejectedValue(NETWORK_ERROR);
    await expect(syncHealthReminderTimezone()).resolves.toBeUndefined();
  });

  it('HEALTH-REMIND-116: is silent and never throws when the correcting save fails', async () => {
    api.getPreferences.mockResolvedValue({
      preferences: prefs({ water_enabled: true, timezone: 'America/New_York' }),
    });
    mockDeviceTimezone('Europe/Berlin');
    api.savePreferences.mockRejectedValue(NETWORK_ERROR);

    await expect(syncHealthReminderTimezone()).resolves.toBeUndefined();
  });
});
