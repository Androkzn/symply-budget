import { settingsApi, parseSettings } from '@api/settings';
import { useAppStore } from '@stores/appStore';
import { useAuthStore } from '@stores/authStore';
import { useNavigationCustomizationStore } from '@stores/navigationCustomizationStore';
import type { TabConfig } from '@stores/navigationCustomizationStore';
import { useTabCustomizationStore } from '@stores/tabCustomizationStore';
import type { TabOverride } from '@stores/tabCustomizationStore';
import { useWidgetLayoutStore } from '@stores/widgetLayoutStore';
import type { WidgetConfig } from '@stores/widgetLayoutStore';

import { settingsSync } from './settings-sync';
import { storageHelpers } from './storage';

const SETTINGS_CACHE_KEY = 'settings-cache';

/**
 * Settings Loader Service
 * Loads settings from database and hydrates Zustand stores
 */
export class SettingsLoader {
  /**
   * Load settings from cache (offline fallback)
   */
  private async loadFromCache(): Promise<Record<string, any> | null> {
    try {
      const cached = await storageHelpers.getObject<Record<string, any>>(SETTINGS_CACHE_KEY);
      if (cached) {
        console.log('[SettingsLoader] Loaded settings from cache:', Object.keys(cached));
      }
      return cached;
    } catch (error) {
      console.error('[SettingsLoader] Error loading from cache:', error);
      return null;
    }
  }

  /**
   * Save settings to cache for offline access
   */
  private async saveToCache(settings: Record<string, any>): Promise<void> {
    try {
      await storageHelpers.setObject(SETTINGS_CACHE_KEY, settings);
      console.log('[SettingsLoader] Saved settings to cache');
    } catch (error) {
      console.error('[SettingsLoader] Error saving to cache:', error);
    }
  }

  /**
   * Fetch settings from database
   */
  private async fetchFromDatabase(): Promise<Record<string, any> | null> {
    try {
      console.log('[SettingsLoader] Fetching settings from database...');
      const response = await settingsApi.fetchAll();
      const settings = parseSettings(response.settings);
      console.log('[SettingsLoader] Fetched settings from database:', Object.keys(settings));
      return settings;
    } catch (error) {
      console.error('[SettingsLoader] Error fetching from database:', error);
      return null;
    }
  }

  /**
   * Hydrate stores with settings data
   */
  private hydrateStores(settings: Record<string, any>): void {
    try {
      // Disable sync during hydration to prevent writing back to DB
      settingsSync.setHydrating(true);

      // 1. Hydrate appStore
      const appStore = useAppStore.getState();
      if ('hydrate' in appStore) {
        appStore.hydrate({
          themeMode: settings['theme.mode'],
          colorScheme: settings['theme.colorScheme'],
          accentScheme: settings['theme.accentScheme'],
          currency: settings['preferences.currency'],
          taxCountry: settings['preferences.taxCountry'],
          taxRegion: settings['preferences.taxRegion'],
          lastSyncTimestamp: settings['app.lastSyncTimestamp'],
        });
        appStore.setHydrated(true);
        appStore.seedFirstRunTaxRegion();
      }

      // 2. Hydrate navigationCustomizationStore (legacy House-domain store)
      const navStore = useNavigationCustomizationStore.getState();
      if ('hydrate' in navStore && settings['navigation.tabs']) {
        navStore.hydrate({
          tabs: settings['navigation.tabs'] as TabConfig[],
          lastModified: settings['navigation.lastModified'],
        });
        navStore.setHydrated(true);
      }

      // 2b. Hydrate tabCustomizationStore (route-based, customizable-tabs model).
      // `navigation.customTabs` may be null (explicit "use brand defaults").
      const tabCustomStore = useTabCustomizationStore.getState();
      if (settings['navigation.customTabs'] !== undefined) {
        tabCustomStore.hydrate({
          tabs: settings['navigation.customTabs'] as TabOverride[] | null,
          lastModified: settings['navigation.customTabsLastModified'],
        });
      }
      tabCustomStore.setHydrated(true);

      // 3. Hydrate widgetLayoutStore
      const widgetStore = useWidgetLayoutStore.getState();
      if ('hydrate' in widgetStore && settings['widgets.layout']) {
        widgetStore.hydrate({
          widgets: settings['widgets.layout'] as WidgetConfig[],
          lastModified: settings['widgets.lastModified'],
        });
        widgetStore.setHydrated(true);
      }

      // 4. Hydrate authStore biometric preferences (no hydration flag needed, persist handles it)
      const authStore = useAuthStore.getState();
      if (settings['auth.biometricEnabled'] !== undefined) {
        authStore.setBiometricEnabled(settings['auth.biometricEnabled']);
      }
      if (settings['auth.biometricPromptShown'] !== undefined) {
        authStore.setBiometricPromptShown(settings['auth.biometricPromptShown']);
      }

      // Re-enable sync after hydration complete
      settingsSync.setHydrating(false);

      console.log('[SettingsLoader] Hydrated all stores with settings');
    } catch (error) {
      console.error('[SettingsLoader] Error hydrating stores:', error);
      // Re-enable sync even on error
      settingsSync.setHydrating(false);
    }
  }

  /**
   * Load all settings and hydrate stores
   * Returns true on success, false on failure
   */
  async loadAllSettings(): Promise<boolean> {
    try {
      console.log('[SettingsLoader] Loading settings...');

      // 1. Try to fetch from database
      let settings = await this.fetchFromDatabase();

      if (!settings) {
        // 2. Fallback to cache if database fetch failed
        console.warn('[SettingsLoader] Database fetch failed, using cache');
        settings = await this.loadFromCache();

        if (!settings) {
          console.warn('[SettingsLoader] No cached settings available, using defaults');
          return false;
        }
      } else {
        // 3. Save to cache for offline access
        await this.saveToCache(settings);
      }

      // 4. Hydrate stores with settings
      this.hydrateStores(settings);

      console.log('[SettingsLoader] Successfully loaded and applied settings');
      return true;
    } catch (error) {
      console.error('[SettingsLoader] Error loading settings:', error);
      return false;
    }
  }

  /**
   * Refresh settings from database (manual sync)
   */
  async refreshFromDatabase(): Promise<boolean> {
    try {
      console.log('[SettingsLoader] Refreshing settings from database...');

      const settings = await this.fetchFromDatabase();

      if (!settings) {
        console.error('[SettingsLoader] Failed to refresh settings');
        return false;
      }

      await this.saveToCache(settings);
      this.hydrateStores(settings);

      console.log('[SettingsLoader] Successfully refreshed settings');
      return true;
    } catch (error) {
      console.error('[SettingsLoader] Error refreshing settings:', error);
      return false;
    }
  }

  /**
   * Clear settings cache (for testing/debugging)
   */
  async clearCache(): Promise<void> {
    await storageHelpers.delete(SETTINGS_CACHE_KEY);
    console.log('[SettingsLoader] Cleared settings cache');
  }
}

// Export singleton instance
export const settingsLoader = new SettingsLoader();
