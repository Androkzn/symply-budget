import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import { DEFAULT_CURRENCY, resolveCurrency, type CurrencyCode } from '@config/currencies';
import { resolveLocaleTaxRegion } from '@config/regions';
import { settingsSync } from '@services/settings-sync';
import { getDefaultAccentScheme, type AccentSchemeId } from '@theme/accentSchemes';

type ThemeMode = 'light' | 'dark' | 'system';

/**
 * App color schema (skin).
 *  - `clean`: new default — always-light, solid-white app background with
 *    off-white tinted surfaces (tuned for the #4ECDC4 mint accent). Applies to
 *    app content (tabs).
 *  - `house`: legacy — dynamic light/dark that follows the device, over the
 *    "house" splash background. Kept for login/onboarding screens and as an
 *    optional skin.
 */
export type ColorScheme = 'clean' | 'house';

interface AppState {
  themeMode: ThemeMode;
  colorScheme: ColorScheme;
  /** Brand accent color scheme (Settings → Appearance → Color Scheme). Budget-only today. */
  accentScheme: AccentSchemeId;
  /** User-selected display currency (ISO 4217). Display-only; does not convert amounts. */
  currency: CurrencyCode;
  /** Country code for sales-tax defaults ('CA' | 'US'), or null if unset. */
  taxCountry: string | null;
  /** Province/state code for sales-tax defaults (e.g. 'BC', 'CA'), or null. */
  taxRegion: string | null;
  isOnline: boolean;
  isAppReady: boolean;
  lastSyncTimestamp: number | null;
  isHydrated: boolean;
}

interface AppActions {
  setThemeMode: (mode: ThemeMode) => void;
  setColorScheme: (scheme: ColorScheme) => void;
  setAccentScheme: (scheme: AccentSchemeId) => void;
  setCurrency: (currency: CurrencyCode) => void;
  /** Set the sales-tax region (country + province/state) for receipt tax defaults. */
  setTaxRegion: (country: string | null, region: string | null) => void;
  /** First-run only: seed country from expo-localization when unset. */
  seedFirstRunTaxRegion: () => void;
  setOnlineStatus: (isOnline: boolean) => void;
  setAppReady: (ready: boolean) => void;
  setLastSyncTimestamp: (timestamp: number) => void;
  hydrate: (settings: Partial<AppState>) => void;
  setHydrated: (hydrated: boolean) => void;
}

type AppStore = AppState & AppActions;

const initialState: AppState = {
  themeMode: 'system',
  colorScheme: 'clean',
  accentScheme: getDefaultAccentScheme(),
  currency: DEFAULT_CURRENCY,
  taxCountry: null,
  taxRegion: null,
  isOnline: true,
  isAppReady: false,
  lastSyncTimestamp: null,
  isHydrated: false,
};

export const useAppStore = create<AppStore>()(
  immer((set) => ({
    ...initialState,

    setThemeMode: (mode) => {
      set((state) => {
        state.themeMode = mode;
      });
      // Sync to database with debouncing
      settingsSync.queueSync('theme.mode', mode);
    },

    setColorScheme: (scheme) => {
      set((state) => {
        state.colorScheme = scheme;
      });
      // Sync to database with debouncing
      settingsSync.queueSync('theme.colorScheme', scheme);
    },

    setAccentScheme: (scheme) => {
      set((state) => {
        state.accentScheme = scheme;
      });
      // Sync to database with debouncing
      settingsSync.queueSync('theme.accentScheme', scheme);
    },

    setCurrency: (currency) => {
      set((state) => {
        state.currency = currency;
      });
      // Sync to database with debouncing
      settingsSync.queueSync('preferences.currency', currency);
    },

    setTaxRegion: (country, region) => {
      set((state) => {
        state.taxCountry = country;
        state.taxRegion = region;
      });
      // Sync to database with debouncing
      settingsSync.queueSync('preferences.taxCountry', country);
      settingsSync.queueSync('preferences.taxRegion', region);
    },

    seedFirstRunTaxRegion: () => {
      const current = useAppStore.getState();
      if (current.taxCountry) return;
      const locale = resolveLocaleTaxRegion();
      if (!locale) return;
      set((state) => {
        state.taxCountry = locale.country;
        state.taxRegion = locale.region;
      });
      settingsSync.queueSync('preferences.taxCountry', locale.country);
      settingsSync.queueSync('preferences.taxRegion', locale.region);
    },

    setOnlineStatus: (isOnline) => {
      set((state) => {
        state.isOnline = isOnline;
      });
      // Update sync service online status
      settingsSync.setOnlineStatus(isOnline);
    },

    setAppReady: (ready) =>
      set((state) => {
        state.isAppReady = ready;
      }),

    setLastSyncTimestamp: (timestamp) => {
      set((state) => {
        state.lastSyncTimestamp = timestamp;
      });
      // Sync to database
      settingsSync.queueSync('app.lastSyncTimestamp', timestamp);
    },

    hydrate: (settings) =>
      set((state) => {
        if (settings.themeMode !== undefined) {
          state.themeMode = settings.themeMode;
        }
        if (settings.colorScheme !== undefined) {
          state.colorScheme = settings.colorScheme;
        }
        if (settings.accentScheme !== undefined) {
          state.accentScheme = settings.accentScheme;
        }
        if (settings.currency !== undefined) {
          // Coerce any legacy/unknown persisted value back to a supported code.
          state.currency = resolveCurrency(settings.currency).code;
        }
        if (settings.taxCountry !== undefined) {
          state.taxCountry = settings.taxCountry;
        }
        if (settings.taxRegion !== undefined) {
          state.taxRegion = settings.taxRegion;
        }
        if (settings.lastSyncTimestamp !== undefined) {
          state.lastSyncTimestamp = settings.lastSyncTimestamp;
        }
      }),

    setHydrated: (hydrated) =>
      set((state) => {
        state.isHydrated = hydrated;
      }),
  }))
);
