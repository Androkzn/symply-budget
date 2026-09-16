import { settingsApi } from '@api/settings';
import { useAppStore } from '@stores/appStore';
import { useAuthStore } from '@stores/authStore';
import { useNavigationCustomizationStore } from '@stores/navigationCustomizationStore';
import { useWidgetLayoutStore } from '@stores/widgetLayoutStore';

import { captureException } from './monitoring';
import { storageHelpers } from './storage';

const MIGRATION_FLAG_KEY = 'settings.migration.v1.completed';

/**
 * Settings Migration Service
 * Handles one-time migration from MMKV local storage to database-backed storage
 */
export class SettingsMigrationService {
  /**
   * Check if migration has been completed
   */
  private async hasMigrationCompleted(): Promise<boolean> {
    return (await storageHelpers.getBoolean(MIGRATION_FLAG_KEY)) === true;
  }

  /**
   * Set migration completion flag
   */
  private async setMigrationCompleted(): Promise<void> {
    await storageHelpers.setBoolean(MIGRATION_FLAG_KEY, true);
    console.log('[SettingsMigration] Migration flag set to completed');
  }

  /**
   * Read all settings from MMKV stores
   */
  private readMmkvSettings(): Record<string, any> {
    const settings: Record<string, any> = {};

    try {
      // 1. Read appStore settings
      const appState = useAppStore.getState();
      settings['theme.mode'] = appState.themeMode;
      settings['preferences.currency'] = appState.currency;
      settings['preferences.taxCountry'] = appState.taxCountry;
      settings['preferences.taxRegion'] = appState.taxRegion;
      settings['app.lastSyncTimestamp'] = appState.lastSyncTimestamp;

      // 2. Read navigationCustomizationStore settings
      const navState = useNavigationCustomizationStore.getState();
      settings['navigation.tabs'] = navState.tabs;
      settings['navigation.lastModified'] = navState.lastModified;

      // 3. Read widgetLayoutStore settings
      const widgetState = useWidgetLayoutStore.getState();
      settings['widgets.layout'] = widgetState.widgets;
      settings['widgets.lastModified'] = widgetState.lastModified;
      // Note: isEditMode is transient, don't migrate

      // 4. Read authStore biometric preferences (partial)
      const authState = useAuthStore.getState();
      settings['auth.biometricEnabled'] = authState.biometricEnabled;
      settings['auth.biometricPromptShown'] = authState.biometricPromptShown;
      // Note: Do NOT migrate: user, token, refreshToken, isAuthenticated (security-sensitive)

      console.log('[SettingsMigration] Read settings from MMKV:', Object.keys(settings));
      return settings;
    } catch (error) {
      console.error('[SettingsMigration] Error reading MMKV settings:', error);
      return {};
    }
  }

  /**
   * Check if there are any settings to migrate
   */
  private hasSettingsToMigrate(settings: Record<string, any>): boolean {
    // Check if any setting has a non-default value
    const hasNonDefaultValues =
      settings['theme.mode'] !== 'system' ||
      settings['preferences.currency'] !== 'USD' ||
      settings['app.lastSyncTimestamp'] !== null ||
      settings['navigation.lastModified'] !== null ||
      settings['widgets.lastModified'] !== null ||
      settings['auth.biometricEnabled'] === true ||
      settings['auth.biometricPromptShown'] === true;

    return hasNonDefaultValues;
  }

  /**
   * Upload settings to database
   */
  private async uploadSettingsToDatabase(settings: Record<string, any>): Promise<boolean> {
    try {
      console.log('[SettingsMigration] Uploading settings to database...');

      await settingsApi.bulkUpdate(settings);

      console.log('[SettingsMigration] Successfully uploaded settings to database');
      return true;
    } catch (error) {
      console.error('[SettingsMigration] Failed to upload settings:', error);
      captureException(error, { source: 'SettingsMigration', phase: 'upload' });
      return false;
    }
  }

  /**
   * Main migration method - check and run migration if needed
   * Returns true if migration completed successfully or was already done
   * Returns false if migration failed (caller should fallback to MMKV)
   */
  async checkAndMigrate(): Promise<boolean> {
    try {
      // 1. Check if migration already completed
      if (await this.hasMigrationCompleted()) {
        console.log('[SettingsMigration] Migration already completed, skipping');
        return true;
      }

      console.log('[SettingsMigration] Starting migration from MMKV to database...');

      // 2. Read all settings from MMKV
      const settings = this.readMmkvSettings();

      // 3. Check if there are any settings to migrate
      if (!this.hasSettingsToMigrate(settings)) {
        console.log('[SettingsMigration] No settings to migrate (all defaults), marking as complete');
        await this.setMigrationCompleted();
        return true;
      }

      // 4. Upload to database
      const uploadSuccess = await this.uploadSettingsToDatabase(settings);

      if (!uploadSuccess) {
        console.warn('[SettingsMigration] Migration failed, will retry on next launch');
        return false;
      }

      // 5. Mark migration as completed
      await this.setMigrationCompleted();

      console.log('[SettingsMigration] Migration completed successfully');
      return true;
    } catch (error) {
      console.error('[SettingsMigration] Migration error:', error);
      captureException(error, { source: 'SettingsMigration', phase: 'checkAndMigrate' });
      return false;
    }
  }

  /**
   * Reset migration flag (for testing purposes)
   */
  async resetMigrationFlag(): Promise<void> {
    await storageHelpers.delete(MIGRATION_FLAG_KEY);
    console.log('[SettingsMigration] Migration flag reset');
  }
}

// Export singleton instance
export const settingsMigration = new SettingsMigrationService();
