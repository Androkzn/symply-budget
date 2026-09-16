/**
 * `healthRemindersApi` — meal, water and weigh-in nudge preferences.
 *
 * Thin client; the only things worth pinning at this layer are the routes,
 * verbs and the PARTIAL-patch shape of `savePreferences` (never a whole-object
 * PUT — two screens racing each other would otherwise revert one another's
 * change).
 */

jest.mock('../client', () => ({
  apiClient: {
    get: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

import { apiClient } from '../client';
import { healthRemindersApi } from '../healthReminders';

const mockGet = apiClient.get as jest.Mock;
const mockPut = apiClient.put as jest.Mock;
const mockDelete = apiClient.delete as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getPreferences', () => {
  it('GETs /health/reminders/preferences and unwraps { preferences }', async () => {
    const preferences = { user_id: 'u1', meals_enabled: false };
    mockGet.mockResolvedValue({ data: { preferences } });

    const result = await healthRemindersApi.getPreferences();

    expect(mockGet).toHaveBeenCalledWith('/health/reminders/preferences');
    expect(result.preferences).toEqual(preferences);
  });
});

describe('savePreferences', () => {
  it('PUTs ONLY the given patch — never assembles the whole preferences object', async () => {
    mockPut.mockResolvedValue({
      data: { preferences: {}, cancelled: 1, scheduled: 2 },
    });

    const result = await healthRemindersApi.savePreferences({ water_enabled: true });

    expect(mockPut).toHaveBeenCalledWith('/health/reminders/preferences', { water_enabled: true });
    expect(Object.keys(mockPut.mock.calls[0][1])).toEqual(['water_enabled']);
    expect(result).toEqual({ preferences: {}, cancelled: 1, scheduled: 2 });
  });

  it('passes cancelled/scheduled counts through untouched — callers must read them before saying anything', async () => {
    mockPut.mockResolvedValue({ data: { preferences: {}, cancelled: 0, scheduled: 0 } });
    const result = await healthRemindersApi.savePreferences({ breakfast_time: '07:00' });
    expect(result.scheduled).toBe(0);
    expect(result.cancelled).toBe(0);
  });
});

describe('clearPreferences', () => {
  it('DELETEs the preferences route and unwraps { deleted, cancelled }', async () => {
    mockDelete.mockResolvedValue({ data: { deleted: true, cancelled: 3 } });

    const result = await healthRemindersApi.clearPreferences();

    expect(mockDelete).toHaveBeenCalledWith('/health/reminders/preferences');
    expect(result).toEqual({ deleted: true, cancelled: 3 });
  });
});
