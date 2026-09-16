/**
 * Customization API Service
 * Backend sync for widget and navigation customization
 *
 * This is prepared for Phase 2 implementation.
 * Currently not active - customization is local-only via MMKV.
 */

import { apiClient } from '@api/client';
import type { TabConfig } from '@stores/navigationCustomizationStore';
import type { WidgetConfig } from '@stores/widgetLayoutStore';

export interface CustomizationPreferences {
  widgets: WidgetConfig[];
  tabs: TabConfig[];
  last_modified: number;
}

export interface UpdateCustomizationRequest {
  widgets?: WidgetConfig[];
  tabs?: TabConfig[];
}

/**
 * Fetch user's customization preferences from backend
 * @returns CustomizationPreferences or null if not found
 */
export async function fetchCustomizationPreferences(): Promise<CustomizationPreferences | null> {
  try {
    const response = await apiClient.get<CustomizationPreferences>('/users/me/customization');
    return response.data;
  } catch (error: any) {
    if (error.response?.status === 404) {
      // No preferences saved yet - this is okay
      return null;
    }
    throw error;
  }
}

/**
 * Update user's customization preferences on backend
 * @param preferences - Updated widget/tab configuration
 */
export async function updateCustomizationPreferences(
  preferences: UpdateCustomizationRequest
): Promise<CustomizationPreferences> {
  const response = await apiClient.post<CustomizationPreferences>(
    '/users/me/customization',
    preferences
  );
  return response.data;
}

/**
 * Delete user's customization preferences (reset to defaults on backend)
 */
export async function deleteCustomizationPreferences(): Promise<void> {
  await apiClient.delete('/users/me/customization');
}

/**
 * Debounced sync helper
 * Use this to avoid excessive API calls when user is actively customizing
 */
let syncTimeout: ReturnType<typeof setTimeout> | null = null;

export function debouncedSyncCustomization(
  preferences: UpdateCustomizationRequest,
  delayMs = 1000
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (syncTimeout) {
      clearTimeout(syncTimeout);
    }

    syncTimeout = setTimeout(async () => {
      try {
        await updateCustomizationPreferences(preferences);
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        syncTimeout = null;
      }
    }, delayMs);
  });
}

/**
 * Cancel any pending sync operation
 */
export function cancelPendingSync(): void {
  if (syncTimeout) {
    clearTimeout(syncTimeout);
    syncTimeout = null;
  }
}
