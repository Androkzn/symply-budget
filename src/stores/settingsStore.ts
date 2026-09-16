import axios from 'axios';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

import { apiClient } from '@api/client';
import { captureException } from '@services/monitoring';
import { asyncStorage } from '@services/storage';

export interface Setting {
  key: string;
  value: any;
  updated_at: string;
}

interface SettingsState {
  settings: Record<string, any>;
  isSyncing: boolean;
  syncError: string | null;
  lastSyncedAt: string | null;
}

interface SettingsActions {
  setSetting: (key: string, value: any) => void;
  setSettings: (settings: Record<string, any>) => void;
  getSetting: (key: string, defaultValue?: any) => any;
  syncWithBackend: () => Promise<void>;
  clearSyncError: () => void;
  resetSettings: () => void;
}

type SettingsStore = SettingsState & SettingsActions;

const initialState: SettingsState = {
  settings: {},
  isSyncing: false,
  syncError: null,
  lastSyncedAt: null,
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    immer((set, get) => ({
      ...initialState,

      setSetting: (key, value) =>
        set((state) => {
          state.settings[key] = value;
        }),

      setSettings: (settings) =>
        set((state) => {
          state.settings = settings;
        }),

      getSetting: (key, defaultValue = null) => {
        const state = get();
        return state.settings[key] ?? defaultValue;
      },

      syncWithBackend: async () => {
        set((state) => {
          state.isSyncing = true;
          state.syncError = null;
        });

        try {
          const currentState = get();
          const localSettings = currentState.settings;
          const lastSyncedAt = currentState.lastSyncedAt;

          // Convert local settings to API format
          const settingsArray: Setting[] = Object.entries(localSettings).map(
            ([key, value]) => ({
              key,
              value,
              updated_at: new Date().toISOString(),
            })
          );

          // Sync with backend
          const response = await apiClient.post('/api/settings/sync', {
            settings: settingsArray,
            last_synced_at: lastSyncedAt,
          });

          const { settings: serverSettings, synced_at } = response.data;

          // Convert server settings array to object
          const settingsObject: Record<string, any> = {};
          serverSettings.forEach((setting: Setting) => {
            settingsObject[setting.key] = setting.value;
          });

          set((state) => {
            state.settings = settingsObject;
            state.lastSyncedAt = synced_at;
            state.isSyncing = false;
            state.syncError = null;
          });
        } catch (error) {
          console.error('Failed to sync settings:', error);

          // Handle network errors gracefully (offline mode)
          if (axios.isAxiosError(error) && !error.response) {
            set((state) => {
              state.isSyncing = false;
              state.syncError = 'No internet connection. Changes will sync when online.';
            });
            return; // Don't throw - allow app to continue
          }

          captureException(error, { source: 'SettingsStore', phase: 'syncWithBackend' });

          // For other errors, set error message and throw
          set((state) => {
            state.isSyncing = false;
            state.syncError = error instanceof Error ? error.message : 'Unknown error';
          });
          throw error;
        }
      },

      clearSyncError: () =>
        set((state) => {
          state.syncError = null;
        }),

      resetSettings: () =>
        set((state) => {
          state.settings = {};
          state.lastSyncedAt = null;
          state.syncError = null;
        }),
    })),
    {
      name: 'settings-storage',
      storage: createJSONStorage(() => asyncStorage),
      partialize: (state) => ({
        settings: state.settings,
        lastSyncedAt: state.lastSyncedAt,
      }),
    }
  )
);
