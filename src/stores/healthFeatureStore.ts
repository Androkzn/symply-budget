import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  HEALTH_FEATURE_DEFAULTS,
  HEALTH_FEATURE_KEYS,
  type HealthFeatureKey,
} from '@config/healthFeatures';
import { asyncStorage } from '@services/storage';

/**
 * Per-install Symply Health feature toggles.
 *
 * Two rules define this store, and both are enforced in `resolveHealthFeature`
 * rather than at the call sites:
 *
 *  1. A COMMON USER always gets exactly the defaults — Calories, Weight,
 *     Workouts, Water. Stored overrides are ignored for them, so a stale
 *     override left behind by an admin who signed out (or a hand-edited
 *     AsyncStorage blob) can never widen what a non-admin sees.
 *  2. An ADMIN gets defaults + their overrides, edited from
 *     More → Health features.
 *
 * Turning a feature off only hides it — every `health*Storage` module keeps its
 * rows, so flipping it back on restores the history intact.
 *
 * NOTE — `asyncStorage`, not MMKV: MMKV v2 is dead under the New Architecture
 * (bridgeless), so every persisted store in this app must use the AsyncStorage
 * adapter or it silently loses its state on device while passing in Jest.
 */
type HealthFlagMap = Partial<Record<HealthFeatureKey, boolean>>;

interface HealthFeatureState {
  /** Admin-authored overrides. Absent key = "use the default". */
  overrides: HealthFlagMap;
  lastModified: number | null;
}

interface HealthFeatureActions {
  setFeature: (key: HealthFeatureKey, enabled: boolean) => void;
  /** Clear one override (back to its default) or all of them. */
  resetFeature: (key: HealthFeatureKey) => void;
  resetAll: () => void;
}

export type HealthFeatureStore = HealthFeatureState & HealthFeatureActions;

const initialState: HealthFeatureState = {
  overrides: {},
  lastModified: null,
};

/**
 * Pure resolver — admin gate → override → default. Exported so the hook, the
 * navigation guards and the non-reactive helper all share one implementation.
 */
export function resolveHealthFeature(
  state: Pick<HealthFeatureState, 'overrides'>,
  key: HealthFeatureKey,
  isAdmin: boolean,
): boolean {
  if (!isAdmin) return HEALTH_FEATURE_DEFAULTS[key];
  const override = state.overrides[key];
  return typeof override === 'boolean' ? override : HEALTH_FEATURE_DEFAULTS[key];
}

/** The full resolved map — used by the tab pool filter and the settings screen. */
export function resolveHealthFeatures(
  state: Pick<HealthFeatureState, 'overrides'>,
  isAdmin: boolean,
): Record<HealthFeatureKey, boolean> {
  return Object.fromEntries(
    HEALTH_FEATURE_KEYS.map((key) => [key, resolveHealthFeature(state, key, isAdmin)]),
  ) as Record<HealthFeatureKey, boolean>;
}

export const useHealthFeatureStore = create<HealthFeatureStore>()(
  persist(
    (set) => ({
      ...initialState,

      setFeature: (key, enabled) =>
        set((state) => ({
          overrides: { ...state.overrides, [key]: enabled },
          lastModified: Date.now(),
        })),

      resetFeature: (key) =>
        set((state) => {
          const next = { ...state.overrides };
          delete next[key];
          return { overrides: next, lastModified: Date.now() };
        }),

      resetAll: () => set({ overrides: {}, lastModified: Date.now() }),
    }),
    {
      name: 'health-features-storage',
      storage: createJSONStorage(() => asyncStorage),
      // Drop anything that is not a known key/boolean. The persisted blob is
      // untrusted input: a renamed feature or a hand-edited file must not leave
      // a phantom entry that `resolveHealthFeature` would then honour.
      merge: (persisted, current) => {
        const raw = (persisted as Partial<HealthFeatureState> | undefined)?.overrides ?? {};
        const overrides: HealthFlagMap = {};
        for (const key of HEALTH_FEATURE_KEYS) {
          if (typeof raw[key] === 'boolean') overrides[key] = raw[key];
        }
        return {
          ...current,
          overrides,
          lastModified: (persisted as Partial<HealthFeatureState> | undefined)?.lastModified ?? null,
        };
      },
      partialize: (state) => ({
        overrides: state.overrides,
        lastModified: state.lastModified,
      }),
    },
  ),
);
