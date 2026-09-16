import { createHouseLocalProxy } from '@features/house/local/localApiProxy';

import { apiClient } from './client';

// Types
export interface Setting {
  id: string;
  user_id: string;
  household_id: string | null;
  key: string;
  value: string; // JSON stringified
  created_at: string;
  updated_at: string;
}

export interface SettingWithParsedValue {
  key: string;
  value: any;
  updated_at: string;
}

// Request types
export interface UpdateSettingRequest {
  value: any;
}

export interface BulkUpdateSettingsRequest {
  settings: Array<{
    key: string;
    value: any;
  }>;
}

export interface SyncSettingsRequest {
  settings: Array<{
    key: string;
    value: any;
    updated_at: string;
  }>;
  last_synced_at?: string | null;
}

// Response types
interface SettingsListResponse {
  settings: Setting[];
}

interface SettingResponse {
  setting: Setting;
}

interface SyncResponse {
  updated: Setting[];
  conflicts: Setting[];
  last_synced_at: string;
}

/**
 * Settings API Client
 * Manages user settings storage and synchronization
 */
const remoteSettingsApi = {
  /**
   * Fetch all settings for the authenticated user
   * GET /api/settings
   */
  fetchAll: () =>
    apiClient
      .get<SettingsListResponse>('/api/settings')
      .then((res) => res.data),

  /**
   * Update a single setting
   * PUT /api/settings/:key
   */
  update: (key: string, value: any) =>
    apiClient
      .put<SettingResponse>(`/api/settings/${key}`, { value })
      .then((res) => res.data),

  /**
   * Update multiple settings at once
   * PUT /api/settings/bulk
   * Note: This endpoint must come BEFORE /:key route to avoid matching "bulk" as a key
   */
  bulkUpdate: (settings: Record<string, any>) => {
    const settingsArray = Object.entries(settings).map(([key, value]) => ({
      key,
      value,
    }));
    return apiClient
      .put<{ success: boolean }>('/api/settings/bulk', { settings: settingsArray })
      .then((res) => res.data);
  },

  /**
   * Two-way sync: Send local changes and receive server changes
   * POST /api/settings/sync
   */
  sync: (clientSettings: Record<string, any>, lastSyncedAt?: string | null) => {
    const settingsArray = Object.entries(clientSettings).map(([key, value]) => ({
      key,
      value,
      updated_at: new Date().toISOString(),
    }));
    return apiClient
      .post<SyncResponse>('/api/settings/sync', {
        settings: settingsArray,
        last_synced_at: lastSyncedAt,
      })
      .then((res) => res.data);
  },

  /**
   * Delete a setting
   * DELETE /api/settings/:key
   */
  delete: (key: string) =>
    apiClient
      .delete<{ success: boolean }>(`/api/settings/${key}`)
      .then((res) => res.data),

  /**
   * Reset all settings (delete all)
   * POST /api/settings/reset
   */
  reset: () =>
    apiClient
      .post<{ success: boolean }>('/api/settings/reset')
      .then((res) => res.data),
};

/**
 * Helper to parse settings from API response
 * Converts JSON string values to JavaScript objects
 */
export function parseSettings(settings: Setting[]): Record<string, any> {
  const parsed: Record<string, any> = {};

  for (const setting of settings) {
    try {
      // Try to parse as JSON first
      parsed[setting.key] = JSON.parse(setting.value);
    } catch {
      // If parsing fails, use the raw string value
      parsed[setting.key] = setting.value;
    }
  }

  return parsed;
}

/**
 * Helper to serialize settings for API requests
 * Converts JavaScript objects to JSON strings
 */
export function serializeSettings(settings: Record<string, any>): Record<string, string> {
  const serialized: Record<string, string> = {};

  for (const [key, value] of Object.entries(settings)) {
    serialized[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }

  return serialized;
}

/**
 * House V2 facade — routes to the on-device ledger when House local-first is
 * enabled, otherwise to the Cloudflare D1 remote API. Screens and stores call
 * `settingsApi` exactly as before; the Proxy is what makes the H3 cutover cost
 * zero screen edits. See `documents/requirements/House v2/` §6.
 */
export const settingsApi: typeof remoteSettingsApi = createHouseLocalProxy(remoteSettingsApi, {
  moduleName: 'settings',
  // Narrow require: the barrel would pull the sync orchestrator and status
  // store into every api call from every screen.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  resolveLocal: () => require('@features/house/local/localSettingsApi').localSettingsApi,
});
