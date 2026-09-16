import { apiClient } from '@api/client';

import { DEFAULT_KAIZEN_FEATURE_FLAGS } from '../../constants';
import {
  fetchKaizenFeatureFlags,
  getCachedKaizenFeatureFlags,
  isKaizenAIEnabled,
} from '../featureFlags';

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

jest.mock('@api/client', () => ({ apiClient: { get: jest.fn() } }));

const mockGet = apiClient.get as jest.Mock;
const CACHE_KEY = 'kaizen.feature.flags';

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  jest.clearAllMocks();
});

describe('fetchKaizenFeatureFlags', () => {
  it('resolves server flags over defaults and caches them', async () => {
    mockGet.mockResolvedValue({ data: { flags: { kaizen: true, kaizenAIScoring: false } } });

    const flags = await fetchKaizenFeatureFlags();

    expect(flags).toEqual({ kaizen: true, kaizenAIScoring: false });
    expect(mockGet).toHaveBeenCalledWith('/api/v1/features');
    expect(JSON.parse(store[CACHE_KEY])).toEqual({ kaizen: true, kaizenAIScoring: false });
  });

  it('backfills missing server flags from defaults', async () => {
    mockGet.mockResolvedValue({ data: { flags: { kaizenAIScoring: false } } });
    const flags = await fetchKaizenFeatureFlags();
    expect(flags).toEqual({ kaizen: DEFAULT_KAIZEN_FEATURE_FLAGS.kaizen, kaizenAIScoring: false });
  });

  it('uses all defaults when the server omits the flags object entirely', async () => {
    mockGet.mockResolvedValue({ data: {} });
    const flags = await fetchKaizenFeatureFlags();
    expect(flags).toEqual(DEFAULT_KAIZEN_FEATURE_FLAGS);
    expect(JSON.parse(store[CACHE_KEY])).toEqual(DEFAULT_KAIZEN_FEATURE_FLAGS);
  });

  it('falls back to cache (or defaults) on network failure', async () => {
    mockGet.mockRejectedValue(new Error('offline'));

    // No cache -> defaults.
    expect(await fetchKaizenFeatureFlags()).toEqual(DEFAULT_KAIZEN_FEATURE_FLAGS);

    // Existing cache -> cached value.
    store[CACHE_KEY] = JSON.stringify({ kaizen: false, kaizenAIScoring: false });
    expect(await fetchKaizenFeatureFlags()).toEqual({ kaizen: false, kaizenAIScoring: false });
  });
});

describe('getCachedKaizenFeatureFlags / isKaizenAIEnabled', () => {
  it('returns defaults when nothing is cached', () => {
    expect(getCachedKaizenFeatureFlags()).toEqual(DEFAULT_KAIZEN_FEATURE_FLAGS);
    expect(isKaizenAIEnabled()).toBe(DEFAULT_KAIZEN_FEATURE_FLAGS.kaizenAIScoring);
  });

  it('merges cached values over defaults', () => {
    store[CACHE_KEY] = JSON.stringify({ kaizenAIScoring: false });
    expect(getCachedKaizenFeatureFlags()).toEqual({ kaizen: true, kaizenAIScoring: false });
    expect(isKaizenAIEnabled()).toBe(false);
  });

  it('returns defaults when the cache is corrupt', () => {
    store[CACHE_KEY] = '{bad json';
    expect(getCachedKaizenFeatureFlags()).toEqual(DEFAULT_KAIZEN_FEATURE_FLAGS);
  });
});
