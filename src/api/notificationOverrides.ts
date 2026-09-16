import { apiClient } from './index';

// Types
export type OverrideTargetType = 'task' | 'space' | 'category' | 'appliance';

export interface NotificationOverride {
  id: string;
  user_id: string;
  target_type: OverrideTargetType;
  target_id: string | null;
  category: string | null;
  enabled: boolean | null;
  reminder_days_before: number | null;
  reminder_time: string | null;
  reminder_repeat: boolean | null;
  sync_to_calendar: boolean;
  calendar_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateOverrideInput {
  target_type: OverrideTargetType;
  target_id?: string;
  category?: string;
  enabled?: boolean | null;
  reminder_days_before?: number | null;
  reminder_time?: string | null;
  reminder_repeat?: boolean | null;
  sync_to_calendar?: boolean;
  calendar_id?: string | null;
}

export interface UpdateOverrideInput {
  enabled?: boolean | null;
  reminder_days_before?: number | null;
  reminder_time?: string | null;
  reminder_repeat?: boolean | null;
  sync_to_calendar?: boolean;
  calendar_id?: string | null;
}

// API functions

/**
 * Get all notification overrides for the current user
 */
export async function getOverrides(filters?: {
  targetType?: OverrideTargetType;
  category?: string;
}): Promise<{ overrides: NotificationOverride[] }> {
  const queryParts: string[] = [];
  if (filters?.targetType) queryParts.push(`target_type=${encodeURIComponent(filters.targetType)}`);
  if (filters?.category) queryParts.push(`category=${encodeURIComponent(filters.category)}`);

  const queryString = queryParts.join('&');
  const url = `/notifications/overrides${queryString ? `?${queryString}` : ''}`;
  
  const response = await apiClient.get(url);
  return response.data;
}

/**
 * Create a new notification override
 */
export async function createOverride(
  input: CreateOverrideInput
): Promise<{ override: NotificationOverride }> {
  const response = await apiClient.post('/notifications/overrides', input);
  return response.data;
}

/**
 * Get a specific notification override
 */
export async function getOverride(
  overrideId: string
): Promise<{ override: NotificationOverride }> {
  const response = await apiClient.get(`/notifications/overrides/${overrideId}`);
  return response.data;
}

/**
 * Update a notification override
 */
export async function updateOverride(
  overrideId: string,
  input: UpdateOverrideInput
): Promise<{ override: NotificationOverride }> {
  const response = await apiClient.patch(`/notifications/overrides/${overrideId}`, input);
  return response.data;
}

/**
 * Delete a notification override
 */
export async function deleteOverride(overrideId: string): Promise<void> {
  await apiClient.delete(`/notifications/overrides/${overrideId}`);
}

/**
 * Set or update override for a category
 */
export async function setCategoryOverride(
  category: string,
  input: UpdateOverrideInput
): Promise<{ override: NotificationOverride }> {
  const response = await apiClient.put(`/notifications/overrides/category/${category}`, input);
  return response.data;
}

/**
 * Set or update override for a space
 */
export async function setSpaceOverride(
  spaceId: string,
  input: UpdateOverrideInput
): Promise<{ override: NotificationOverride }> {
  const response = await apiClient.put(`/notifications/overrides/space/${spaceId}`, input);
  return response.data;
}
