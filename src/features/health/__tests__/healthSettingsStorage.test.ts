/**
 * Symply Health — the ACTIVITY NOTIFICATION preferences (`healthSettingsStorage.ts`).
 *
 * `PUT /health/activity-preferences` has been deployed since P2 with zero
 * callers until `HealthNotificationSettingsScreen` shipped. Two properties are
 * worth pinning at the STORE level, below the screen:
 *
 *  1. **A stale/hand-edited cache cannot masquerade as a deliberate choice.**
 *     The Worker stores integer 0/1 and answers booleans; `coerce` must accept
 *     ONLY real booleans and fall back to the donor default for anything else
 *     (a stray `1`, a string, `null`).
 *  2. **A failed save keeps the member's tap, never a raw error.** The
 *     optimistic value is what gets cached and returned when the network call
 *     rejects, with the friendly `NOTIFY_PREFS_OFFLINE_MESSAGE` — never the
 *     axios/HTTP failure itself.
 */

import { healthApi, type HealthActivityPreferenceFlags } from '@api/health';
import { storageHelpers } from '@services/storage';

import {
  DEFAULT_HEALTH_NOTIFICATION_PREFERENCES,
  describeNotificationPreferences,
  HEALTH_ACTIVITY_EVENT_FLAGS,
  HEALTH_NOTIFICATION_GROUPS,
  HEALTH_NOTIFY_PREFS_KEY,
  loadNotificationPreferences,
  NOTIFY_PREFS_OFFLINE_MESSAGE,
  resetNotificationPreferences,
  saveNotificationPreferences,
} from '../healthSettingsStorage';

jest.mock('@api/health', () => {
  const actual = jest.requireActual('@api/health');
  return {
    ...actual,
    healthApi: {
      ...actual.healthApi,
      activityPreferences: jest.fn(),
      saveActivityPreferences: jest.fn(),
    },
  };
});

const mockGet = healthApi.activityPreferences as jest.Mock;
const mockSave = healthApi.saveActivityPreferences as jest.Mock;

const NETWORK_ERROR = new Error('Network request failed');

beforeEach(async () => {
  jest.clearAllMocks();
  await storageHelpers.delete(HEALTH_NOTIFY_PREFS_KEY);
  mockGet.mockResolvedValue({ preferences: DEFAULT_HEALTH_NOTIFICATION_PREFERENCES });
  mockSave.mockResolvedValue({ preferences: DEFAULT_HEALTH_NOTIFICATION_PREFERENCES });
});

describe('the vocabulary is exactly ten flags across three groups', () => {
  it('HEALTH-NOTIFYSTORE-001: ten toggles total, and the event-flag list excludes the two delivery switches', () => {
    const allFlags = HEALTH_NOTIFICATION_GROUPS.flatMap((g) => g.toggles.map((t) => t.flag));
    expect(allFlags).toHaveLength(10);
    expect(HEALTH_ACTIVITY_EVENT_FLAGS).toHaveLength(8);
    expect(HEALTH_ACTIVITY_EVENT_FLAGS).not.toContain('receive_push_notifications');
    expect(HEALTH_ACTIVITY_EVENT_FLAGS).not.toContain('receive_inapp_notifications');
  });
});

describe('loadNotificationPreferences — coercion', () => {
  it('HEALTH-NOTIFYSTORE-010: a full boolean payload passes through untouched', async () => {
    const payload: HealthActivityPreferenceFlags = {
      ...DEFAULT_HEALTH_NOTIFICATION_PREFERENCES,
      notify_recipe_created: false,
      notify_community_recipe_created: true,
    };
    mockGet.mockResolvedValue({ preferences: payload });
    const prefs = await loadNotificationPreferences();
    expect(prefs).toEqual(payload);
  });

  it('HEALTH-NOTIFYSTORE-011: a non-boolean value (stray integer 1/0) falls back to the donor default', async () => {
    mockGet.mockResolvedValue({
      preferences: { ...DEFAULT_HEALTH_NOTIFICATION_PREFERENCES, notify_recipe_created: 1 },
    });
    const prefs = await loadNotificationPreferences();
    // The donor default for notify_recipe_created is `true`; a truthy `1` must
    // not be treated as a deliberate `true` OR silently coerced — it falls back
    // to the documented default rather than being interpreted at all.
    expect(prefs.notify_recipe_created).toBe(DEFAULT_HEALTH_NOTIFICATION_PREFERENCES.notify_recipe_created);
  });

  it('HEALTH-NOTIFYSTORE-012: null, undefined and a missing key all resolve to the full default set', async () => {
    mockGet.mockResolvedValue({ preferences: null });
    expect(await loadNotificationPreferences()).toEqual(DEFAULT_HEALTH_NOTIFICATION_PREFERENCES);

    mockGet.mockResolvedValue({ preferences: undefined });
    expect(await loadNotificationPreferences()).toEqual(DEFAULT_HEALTH_NOTIFICATION_PREFERENCES);

    mockGet.mockResolvedValue({ preferences: {} });
    expect(await loadNotificationPreferences()).toEqual(DEFAULT_HEALTH_NOTIFICATION_PREFERENCES);
  });

  it('HEALTH-NOTIFYSTORE-013: an offline read falls back to the cached (coerced) snapshot', async () => {
    mockGet.mockResolvedValueOnce({
      preferences: { ...DEFAULT_HEALTH_NOTIFICATION_PREFERENCES, notify_photo_shared: false },
    });
    await loadNotificationPreferences(); // primes the cache
    mockGet.mockRejectedValue(NETWORK_ERROR);

    const prefs = await loadNotificationPreferences();
    expect(prefs.notify_photo_shared).toBe(false);
  });
});

describe('saveNotificationPreferences — online', () => {
  it('HEALTH-NOTIFYSTORE-020: sends exactly the patch, not the whole object', async () => {
    await saveNotificationPreferences({ notify_milestone_achieved: false });
    expect(mockSave).toHaveBeenCalledWith({ notify_milestone_achieved: false });
    expect(Object.keys(mockSave.mock.calls[0][0])).toEqual(['notify_milestone_achieved']);
  });

  it('HEALTH-NOTIFYSTORE-021: on success, returns status "saved" with a null message', async () => {
    mockSave.mockResolvedValue({
      preferences: { ...DEFAULT_HEALTH_NOTIFICATION_PREFERENCES, notify_milestone_achieved: false },
    });
    const result = await saveNotificationPreferences({ notify_milestone_achieved: false });
    expect(result.status).toBe('saved');
    expect(result.message).toBeNull();
    expect(result.preferences.notify_milestone_achieved).toBe(false);
  });

  it('HEALTH-NOTIFYSTORE-022: the returned preferences are cached for the next offline read', async () => {
    mockSave.mockResolvedValue({
      preferences: { ...DEFAULT_HEALTH_NOTIFICATION_PREFERENCES, notify_recipe_updated: true },
    });
    await saveNotificationPreferences({ notify_recipe_updated: true });

    mockGet.mockRejectedValue(NETWORK_ERROR);
    const prefs = await loadNotificationPreferences();
    expect(prefs.notify_recipe_updated).toBe(true);
  });
});

describe('saveNotificationPreferences — offline', () => {
  it('HEALTH-NOTIFYSTORE-030: a rejected write keeps the OPTIMISTIC value and the friendly copy, never a raw error', async () => {
    mockSave.mockRejectedValue(NETWORK_ERROR);
    const result = await saveNotificationPreferences({ notify_workout_video_shared: false });

    expect(result.status).toBe('offline');
    expect(result.message).toBe(NOTIFY_PREFS_OFFLINE_MESSAGE);
    expect(result.preferences.notify_workout_video_shared).toBe(false);
    expect(result.message).not.toMatch(/network|fetch|axios|ECONNREFUSED/i);
  });

  it('HEALTH-NOTIFYSTORE-031: the optimistic value is cached too, so the next offline read agrees', async () => {
    mockSave.mockRejectedValue(NETWORK_ERROR);
    await saveNotificationPreferences({ notify_workout_video_shared: false });

    mockGet.mockRejectedValue(NETWORK_ERROR);
    const prefs = await loadNotificationPreferences();
    expect(prefs.notify_workout_video_shared).toBe(false);
  });
});

describe('resetNotificationPreferences', () => {
  it('HEALTH-NOTIFYSTORE-040: sends ALL TEN defaults explicitly, never a partial or empty PUT', async () => {
    await resetNotificationPreferences();
    expect(mockSave).toHaveBeenCalledWith(DEFAULT_HEALTH_NOTIFICATION_PREFERENCES);
    expect(Object.keys(mockSave.mock.calls[0][0])).toHaveLength(10);
  });
});

describe('describeNotificationPreferences', () => {
  it('HEALTH-NOTIFYSTORE-050: "Push on" when push is enabled, regardless of in-app', () => {
    expect(
      describeNotificationPreferences({
        ...DEFAULT_HEALTH_NOTIFICATION_PREFERENCES,
        receive_push_notifications: true,
        receive_inapp_notifications: false,
      })
    ).toMatch(/^Push on ·/);
  });

  it('HEALTH-NOTIFYSTORE-051: "In-app only" when push is off but in-app is on', () => {
    expect(
      describeNotificationPreferences({
        ...DEFAULT_HEALTH_NOTIFICATION_PREFERENCES,
        receive_push_notifications: false,
        receive_inapp_notifications: true,
      })
    ).toMatch(/^In-app only ·/);
  });

  it('HEALTH-NOTIFYSTORE-052: "All off" when both delivery switches are off', () => {
    expect(
      describeNotificationPreferences({
        ...DEFAULT_HEALTH_NOTIFICATION_PREFERENCES,
        receive_push_notifications: false,
        receive_inapp_notifications: false,
      })
    ).toMatch(/^All off ·/);
  });

  it('HEALTH-NOTIFYSTORE-053: the count is real — "N of 8 activity alerts" for the ACTUAL number on', () => {
    const allOn = describeNotificationPreferences({
      ...DEFAULT_HEALTH_NOTIFICATION_PREFERENCES,
      ...Object.fromEntries(HEALTH_ACTIVITY_EVENT_FLAGS.map((f) => [f, true])),
    } as HealthActivityPreferenceFlags);
    expect(allOn).toContain('8 of 8 activity alerts');

    const allOff = describeNotificationPreferences({
      ...DEFAULT_HEALTH_NOTIFICATION_PREFERENCES,
      ...Object.fromEntries(HEALTH_ACTIVITY_EVENT_FLAGS.map((f) => [f, false])),
    } as HealthActivityPreferenceFlags);
    expect(allOff).toContain('0 of 8 activity alerts');
  });
});
