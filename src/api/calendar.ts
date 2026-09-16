import { apiClient } from './index';

// Types
export interface CalendarSyncToken {
  id: string;
  name: string;
  subscribe_url: string;
  webcal_url: string;
  includes_tasks: boolean;
  includes_appointments: boolean;
  includes_garbage: boolean;
  household_id: string | null;
  last_accessed_at: string | null;
  access_count: number;
  created_at: string;
}

export interface CreateSubscribeTokenInput {
  name?: string;
  include_tasks?: boolean;
  include_appointments?: boolean;
  include_garbage?: boolean;
  household_id?: string;
}

export interface CreateSubscribeTokenResponse {
  token: string;
  subscribe_url: string;
  webcal_url: string;
  google_calendar_url: string;
}

export interface CalendarSettings {
  default_calendar_type: 'apple' | 'google' | 'device' | null;
  default_calendar_id: string | null;
  default_calendar_name: string | null;
  auto_sync_tasks: boolean;
  auto_sync_appointments: boolean;
  auto_sync_garbage: boolean;
  sync_task_due_date: boolean;
  sync_task_reminder: boolean;
  task_event_duration_minutes: number;
  task_event_color: string | null;
  appointment_event_color: string | null;
  garbage_event_color: string | null;
}

export interface UpdateCalendarSettingsInput {
  default_calendar_type?: 'apple' | 'google' | 'device' | null;
  default_calendar_id?: string | null;
  default_calendar_name?: string | null;
  auto_sync_tasks?: boolean;
  auto_sync_appointments?: boolean;
  auto_sync_garbage?: boolean;
  sync_task_due_date?: boolean;
  sync_task_reminder?: boolean;
  task_event_duration_minutes?: number;
  task_event_color?: string | null;
  appointment_event_color?: string | null;
  garbage_event_color?: string | null;
}

// API functions

/**
 * Create a new calendar subscribe URL
 */
export async function createSubscribeToken(
  input: CreateSubscribeTokenInput = {}
): Promise<CreateSubscribeTokenResponse> {
  const response = await apiClient.post('/calendar/subscribe', input);
  return response.data;
}

/**
 * Get all subscribe tokens for the current user
 */
export async function getSubscribeTokens(): Promise<{ tokens: CalendarSyncToken[] }> {
  const response = await apiClient.get('/calendar/subscribe/tokens');
  return response.data;
}

/**
 * Delete a subscribe token
 */
export async function deleteSubscribeToken(tokenId: string): Promise<void> {
  await apiClient.delete(`/calendar/subscribe/tokens/${tokenId}`);
}

/**
 * Get user's calendar sync settings
 */
export async function getCalendarSettings(): Promise<{ settings: CalendarSettings }> {
  const response = await apiClient.get('/calendar/settings');
  return response.data;
}

/**
 * Update user's calendar sync settings
 */
export async function updateCalendarSettings(
  input: UpdateCalendarSettingsInput
): Promise<{ settings: CalendarSettings }> {
  const response = await apiClient.put('/calendar/settings', input);
  return response.data;
}

/**
 * Generate a one-time iCal export URL
 */
export function getExportUrl(options: {
  includeTasks?: boolean;
  includeAppointments?: boolean;
  includeGarbage?: boolean;
  householdId?: string;
} = {}): string {
  const queryParts: string[] = [];
  if (options.includeTasks === false) queryParts.push('tasks=false');
  if (options.includeAppointments === false) queryParts.push('appointments=false');
  if (options.includeGarbage === false) queryParts.push('garbage=false');
  if (options.householdId) queryParts.push(`household_id=${encodeURIComponent(options.householdId)}`);

  const queryString = queryParts.join('&');
  return `/calendar/export/ical${queryString ? `?${queryString}` : ''}`;
}
