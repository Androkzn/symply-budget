import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { BrandTabRoute } from '@brand';
import { settingsSync } from '@services/settings-sync';
import { asyncStorage, storageHelpers } from '@services/storage';

/**
 * Per-user bottom-tab customization for brands that opt into the customizable
 * tab bar (`brand.customizableTabs === true`). Holds an ordered override of the
 * brand's tab POOL — which tabs are pinned to the bottom bar and in what order.
 * Everything not pinned lives in the "More" hub. The effective bar is derived
 * from this + the brand pool by `resolveEffectiveTabs` (see
 * src/navigation/useEffectiveTabs.ts).
 *
 * `overrides === null` means "use the brand defaults" (nothing customized yet).
 *
 * Persistence: Zustand `persist` (MMKV) for immediate relaunch restore, plus
 * `settingsSync` writes under `navigation.customTabs` for the generic settings
 * KV / offline cache. Kept separate from the legacy `navigation.tabs` store.
 */
export interface TabOverride {
  route: BrandTabRoute;
  /** Position in the pool ordering (lower = earlier / more likely pinned). */
  order: number;
  /** Pinned to the bottom bar (vs. living in "More"). */
  visible: boolean;
}

interface TabCustomizationState {
  overrides: TabOverride[] | null;
  lastModified: number | null;
  isHydrated: boolean;
  /** Persist a full new override list (from the editor's Save). */
  setOverrides: (overrides: TabOverride[]) => void;
  /** Clear customization → fall back to brand defaults. */
  resetToDefaults: () => void;
  hydrate: (settings: {
    tabs?: TabOverride[] | null;
    lastModified?: number | null;
  }) => void;
  setHydrated: (hydrated: boolean) => void;
}

const SETTINGS_CACHE_KEY = 'settings-cache';

async function bootstrapFromSettingsCache(): Promise<{
  overrides: TabOverride[] | null;
  lastModified: number | null;
} | null> {
  try {
    const cache =
      await storageHelpers.getObject<Record<string, unknown>>(SETTINGS_CACHE_KEY);
    if (!cache || cache['navigation.customTabs'] === undefined) {
      return null;
    }
    return {
      overrides: (cache['navigation.customTabs'] as TabOverride[] | null) ?? null,
      lastModified:
        typeof cache['navigation.customTabsLastModified'] === 'number'
          ? cache['navigation.customTabsLastModified']
          : null,
    };
  } catch {
    return null;
  }
}

export const useTabCustomizationStore = create<TabCustomizationState>()(
  persist(
    (set) => ({
      overrides: null,
      lastModified: null,
      isHydrated: false,

      setOverrides: (overrides) => {
        const normalized = overrides.map((o, index) => ({ ...o, order: index }));
        const lastModified = nowSafe();
        set({ overrides: normalized, lastModified });
        settingsSync.queueSync('navigation.customTabs', normalized);
        settingsSync.queueSync('navigation.customTabsLastModified', lastModified);
      },

      resetToDefaults: () => {
        const lastModified = nowSafe();
        set({ overrides: null, lastModified });
        settingsSync.queueSync('navigation.customTabs', null);
        settingsSync.queueSync('navigation.customTabsLastModified', lastModified);
      },

      hydrate: (settings) =>
        set((state) => ({
          overrides:
            settings.tabs === undefined ? state.overrides : settings.tabs ?? null,
          lastModified:
            settings.lastModified === undefined
              ? state.lastModified
              : settings.lastModified,
        })),

      setHydrated: (hydrated) => set({ isHydrated: hydrated }),
    }),
    {
      name: 'tab-customization-storage',
      storage: createJSONStorage(() => asyncStorage),
      partialize: (state) => ({
        overrides: state.overrides,
        lastModified: state.lastModified,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          state?.setHydrated(true);
          return;
        }
        void (async () => {
          if (!state?.overrides) {
            const cached = await bootstrapFromSettingsCache();
            if (cached) {
              state?.hydrate({
                tabs: cached.overrides,
                lastModified: cached.lastModified,
              });
            }
          }
          state?.setHydrated(true);
        })();
      },
    },
  ),
);

/**
 * Date.now() is unavailable in some sandboxed contexts (workflows); guard it so
 * a missing timestamp never throws. Real app runtime always has Date.now.
 */
function nowSafe(): number {
  try {
    return Date.now();
  } catch {
    return 0;
  }
}
