import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

import { featuresApi } from '@api/features';
import { FEATURE_DEFAULTS, type FeatureFlagKey } from '@config/features';
import { captureException } from '@services/monitoring';
import { asyncStorage } from '@services/storage';

type FlagMap = Partial<Record<FeatureFlagKey, boolean>>;

type FetchStatus = 'idle' | 'loading' | 'ready' | 'error';

interface FeatureFlagState {
  /** Last values fetched from the backend (cached to MMKV for offline cold start). */
  remoteFlags: FlagMap;
  /** Local-only overrides for development; never persisted to the backend. */
  devOverrides: FlagMap;
  version: number;
  lastFetchedAt: number | null;
  status: FetchStatus;
}

interface FeatureFlagActions {
  fetchFlags: () => Promise<void>;
  setDevOverride: (key: FeatureFlagKey, value: boolean | null) => void;
  clearDevOverrides: () => void;
}

type FeatureFlagStore = FeatureFlagState & FeatureFlagActions;

const initialState: FeatureFlagState = {
  remoteFlags: {},
  devOverrides: {},
  version: 0,
  lastFetchedAt: null,
  status: 'idle',
};

/**
 * Pure resolver: dev override → remote value → build-time default.
 * Exported so non-reactive callers and selectors share one implementation.
 */
export function resolveFlag(state: FeatureFlagState, key: FeatureFlagKey): boolean {
  if (__DEV__) {
    const override = state.devOverrides[key];
    if (typeof override === 'boolean') return override;
  }
  const remote = state.remoteFlags[key];
  if (typeof remote === 'boolean') return remote;
  return FEATURE_DEFAULTS[key];
}

export const useFeatureFlagStore = create<FeatureFlagStore>()(
  persist(
    immer((set) => ({
      ...initialState,

      fetchFlags: async () => {
        set((state) => {
          state.status = 'loading';
        });
        try {
          const { flags, version } = await featuresApi.getFeatureFlags();
          set((state) => {
            // Keep only known keys; ignore anything unexpected from the server.
            const next: FlagMap = {};
            for (const key of Object.keys(FEATURE_DEFAULTS) as FeatureFlagKey[]) {
              if (typeof flags?.[key] === 'boolean') next[key] = flags[key];
            }
            state.remoteFlags = next;
            state.version = version ?? 0;
            state.lastFetchedAt = Date.now();
            state.status = 'ready';
          });
        } catch (error) {
          // Offline / transient failure: keep the last cached flags and defaults.
          captureException(error, { source: 'FeatureFlagStore', phase: 'fetchFlags' });
          set((state) => {
            state.status = 'error';
          });
        }
      },

      setDevOverride: (key, value) => {
        if (!__DEV__) return;
        set((state) => {
          if (value === null) {
            delete state.devOverrides[key];
          } else {
            state.devOverrides[key] = value;
          }
        });
      },

      clearDevOverrides: () =>
        set((state) => {
          state.devOverrides = {};
        }),
    })),
    {
      name: 'feature-flags-storage',
      storage: createJSONStorage(() => asyncStorage),
      skipHydration: true,
      // devOverrides are intentionally NOT persisted — they are ephemeral.
      partialize: (state) => ({
        remoteFlags: state.remoteFlags,
        version: state.version,
        lastFetchedAt: state.lastFetchedAt,
      }),
    }
  )
);

/**
 * Non-reactive read for services, navigation guards, and other non-React code.
 * For React components use the `useFeature` hook so they re-render on change.
 */
export function isFeatureEnabled(key: FeatureFlagKey): boolean {
  return resolveFlag(useFeatureFlagStore.getState(), key);
}
