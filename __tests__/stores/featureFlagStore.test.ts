/**
 * featureFlagStore — mobile global feature-flag resolver.
 *
 * Covers the BRD FeatureFlags_BRD_v1.0 §2.4 edge cases and FR-4/FR-5/FR-6:
 *   - resolveFlag precedence: dev override → remote → build-time default.
 *   - dev overrides only apply in __DEV__; no-op in production builds.
 *   - fetchFlags sanitizes the server payload (unknown / non-boolean keys dropped).
 *   - fetchFlags failure (offline) retains cached values and surfaces status='error'.
 *   - isFeatureEnabled is a non-reactive read of the same resolution.
 *
 * The MMKV-backed asyncStorage and the HTTP api are mocked so this stays a pure
 * unit test (no native JSI, no network).
 */

jest.mock('@services/storage', () => ({
  asyncStorage: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('@api/features', () => ({
  featuresApi: { getFeatureFlags: jest.fn() },
}));

import { featuresApi } from '@api/features';
import { FEATURE_DEFAULTS, type FeatureFlagKey } from '@config/features';
import {
  resolveFlag,
  isFeatureEnabled,
  useFeatureFlagStore,
} from '@stores/featureFlagStore';

const mockGetFeatureFlags = featuresApi.getFeatureFlags as jest.Mock;

// Minimal state object for the pure resolver.
type ResolverState = Parameters<typeof resolveFlag>[0];
const baseState = (over: Partial<ResolverState> = {}): ResolverState => ({
  remoteFlags: {},
  devOverrides: {},
  version: 0,
  lastFetchedAt: null,
  status: 'idle',
  ...over,
});

const ORIGINAL_DEV = (global as { __DEV__?: boolean }).__DEV__;
const setDev = (value: boolean) => {
  (global as { __DEV__?: boolean }).__DEV__ = value;
};

beforeEach(() => {
  mockGetFeatureFlags.mockReset();
  setDev(true);
  // Reset store to a clean slate between tests.
  useFeatureFlagStore.setState({
    remoteFlags: {},
    devOverrides: {},
    version: 0,
    lastFetchedAt: null,
    status: 'idle',
  });
});

afterAll(() => {
  setDev(ORIGINAL_DEV as boolean);
});

describe('resolveFlag precedence', () => {
  it('falls back to the build-time default when nothing is set', () => {
    expect(resolveFlag(baseState(), 'gardening')).toBe(FEATURE_DEFAULTS.gardening);
  });

  it('uses the remote value over the default', () => {
    const state = baseState({ remoteFlags: { gardening: false } });
    expect(resolveFlag(state, 'gardening')).toBe(false);
  });

  it('uses the dev override over remote and default (dev builds)', () => {
    setDev(true);
    const state = baseState({
      remoteFlags: { gardening: false },
      devOverrides: { gardening: true },
    });
    expect(resolveFlag(state, 'gardening')).toBe(true);
  });

  it('ignores dev overrides in production builds', () => {
    setDev(false);
    const state = baseState({ devOverrides: { gardening: false } });
    // No remote value → falls through to the default, NOT the dev override.
    expect(resolveFlag(state, 'gardening')).toBe(FEATURE_DEFAULTS.gardening);
  });

  it('still honors remote values in production builds', () => {
    setDev(false);
    const state = baseState({ remoteFlags: { gardening: false } });
    expect(resolveFlag(state, 'gardening')).toBe(false);
  });
});

describe('fetchFlags', () => {
  it('stores sanitized remote flags and marks status ready', async () => {
    mockGetFeatureFlags.mockResolvedValue({
      flags: { gardening: false, reports: true } as Record<FeatureFlagKey, boolean>,
      version: 7,
      updatedAt: '2026-06-22T00:00:00.000Z',
    });

    await useFeatureFlagStore.getState().fetchFlags();
    const state = useFeatureFlagStore.getState();

    expect(state.remoteFlags.gardening).toBe(false);
    expect(state.remoteFlags.reports).toBe(true);
    expect(state.version).toBe(7);
    expect(state.status).toBe('ready');
    expect(state.lastFetchedAt).toEqual(expect.any(Number));
  });

  it('drops unknown and non-boolean keys from the server payload', async () => {
    mockGetFeatureFlags.mockResolvedValue({
      flags: {
        gardening: 'yes', // non-boolean → ignored
        bogusKey: true, // unknown → ignored
      } as unknown as Record<FeatureFlagKey, boolean>,
      version: 1,
      updatedAt: null,
    });

    await useFeatureFlagStore.getState().fetchFlags();
    const state = useFeatureFlagStore.getState();

    expect(state.remoteFlags.gardening).toBeUndefined();
    expect(
      (state.remoteFlags as Record<string, unknown>).bogusKey
    ).toBeUndefined();
    // With no valid override, resolution falls through to the default.
    expect(resolveFlag(state, 'gardening')).toBe(FEATURE_DEFAULTS.gardening);
  });

  it('retains cached flags and surfaces error status when the fetch fails', async () => {
    // Seed a previously-cached value.
    useFeatureFlagStore.setState({
      remoteFlags: { gardening: false },
      version: 3,
    });
    mockGetFeatureFlags.mockRejectedValue(new Error('offline'));

    await useFeatureFlagStore.getState().fetchFlags();
    const state = useFeatureFlagStore.getState();

    // Cached value preserved; only status changes.
    expect(state.remoteFlags.gardening).toBe(false);
    expect(state.version).toBe(3);
    expect(state.status).toBe('error');
  });
});

describe('setDevOverride', () => {
  it('sets and clears overrides in dev builds', () => {
    setDev(true);
    useFeatureFlagStore.getState().setDevOverride('gardening', false);
    expect(useFeatureFlagStore.getState().devOverrides.gardening).toBe(false);

    useFeatureFlagStore.getState().setDevOverride('gardening', null);
    expect(
      useFeatureFlagStore.getState().devOverrides.gardening
    ).toBeUndefined();
  });

  it('is a no-op in production builds', () => {
    setDev(false);
    useFeatureFlagStore.getState().setDevOverride('gardening', false);
    expect(useFeatureFlagStore.getState().devOverrides.gardening).toBeUndefined();
  });

  it('clearDevOverrides empties all overrides', () => {
    setDev(true);
    useFeatureFlagStore.getState().setDevOverride('gardening', false);
    useFeatureFlagStore.getState().setDevOverride('reports', false);
    useFeatureFlagStore.getState().clearDevOverrides();
    expect(useFeatureFlagStore.getState().devOverrides).toEqual({});
  });
});

describe('isFeatureEnabled (non-reactive read)', () => {
  it('reflects the resolved value from current store state', () => {
    setDev(true);
    useFeatureFlagStore.setState({ remoteFlags: { gardening: false } });
    expect(isFeatureEnabled('gardening')).toBe(false);

    useFeatureFlagStore.setState({ remoteFlags: {} });
    expect(isFeatureEnabled('gardening')).toBe(FEATURE_DEFAULTS.gardening);
  });
});
