import {
  notificationsHistoryResponseSchema,
  notificationsUnreadCountResponseSchema,
} from '@symply/contracts';

import { apiClient } from './client';
import { shouldValidateApiResponses, validateApiResponse } from './validateResponse';

// Types
export interface PushToken {
  id: string;
  user_id: string;
  token: string;
  platform: 'ios' | 'android' | 'web';
  device_name: string | null;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
}

export interface NotificationPreferences {
  id: string;
  user_id: string;
  push_enabled: boolean;
  email_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string | null;
  task_reminders: boolean;
  task_overdue: boolean;
  task_assigned: boolean;
  task_completed: boolean;
  household_updates: boolean;
  report_ready: boolean;
  weekly_summary: boolean;
  garbage_collection: boolean;
  // Task drafts and maintenance
  task_drafts_ready: boolean;
  critical_findings: boolean;
  maintenance_suggestions: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationHistoryItem {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: string | null;
  sent_at: string;
  read_at: string | null;
  clicked_at: string | null;
  reference_type: string | null;
  reference_id: string | null;
}

// Request types
interface RegisterTokenRequest {
  token: string;
  platform: 'ios' | 'android' | 'web';
  device_name?: string;
  /** Plan §A7: semver string from expoConfig.version — used for Aihousekeeper push gating. */
  app_version?: string;
}

interface UpdatePreferencesRequest {
  push_enabled?: boolean;
  email_enabled?: boolean;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  timezone?: string;
  task_reminders?: boolean;
  task_overdue?: boolean;
  task_assigned?: boolean;
  task_completed?: boolean;
  household_updates?: boolean;
  report_ready?: boolean;
  weekly_summary?: boolean;
  garbage_collection?: boolean;
  // Task drafts and maintenance
  task_drafts_ready?: boolean;
  critical_findings?: boolean;
  maintenance_suggestions?: boolean;
}

interface HistoryFilters {
  limit?: number;
  cursor?: string;
  unread_only?: boolean;
}

// Response types
interface TokenResponse {
  token: PushToken;
}

interface TokensListResponse {
  tokens: PushToken[];
}

interface PreferencesResponse {
  preferences: NotificationPreferences;
}

interface HistoryResponse {
  notifications: NotificationHistoryItem[];
  nextCursor?: string;
}

interface UnreadCountResponse {
  count: number;
}

export const notificationsApi = {
  // Push tokens
  registerToken: (data: RegisterTokenRequest) =>
    apiClient
      .post<TokenResponse>('/notifications/tokens', data)
      .then((res) => res.data),

  unregisterToken: (token: string) =>
    apiClient.delete('/notifications/tokens', { data: { token } }),

  getTokens: () =>
    apiClient
      .get<TokensListResponse>('/notifications/tokens')
      .then((res) => res.data),

  // Preferences
  getPreferences: () =>
    apiClient
      .get<PreferencesResponse>('/notifications/preferences')
      .then((res) => res.data),

  updatePreferences: (data: UpdatePreferencesRequest) =>
    apiClient
      .patch<PreferencesResponse>('/notifications/preferences', data)
      .then((res) => res.data),

  // History
  getHistory: (filters?: HistoryFilters) =>
    apiClient
      .get<HistoryResponse>('/notifications/history', {
        params: { ...filters, _ts: Date.now() },
      })
      .then((res) => {
        const data = res.data;
        if (!shouldValidateApiResponses()) return data;
        return validateApiResponse(
          notificationsHistoryResponseSchema,
          data,
          'GET /notifications/history'
        );
      }),

  getUnreadCount: () =>
    apiClient
      .get<UnreadCountResponse>('/notifications/unread-count')
      .then((res) => {
        const data = res.data;
        if (!shouldValidateApiResponses()) return data;
        return validateApiResponse(
          notificationsUnreadCountResponseSchema,
          data,
          'GET /notifications/unread-count'
        );
      }),

  markAsRead: (notificationId: string) =>
    apiClient.post(`/notifications/${notificationId}/read`),

  markAllAsRead: () =>
    apiClient.post('/notifications/read-all'),

  deleteNotification: (notificationId: string) =>
    apiClient.delete(`/notifications/${notificationId}`),

  clearJoinRequestNotifications: (requestId: string) =>
    apiClient.delete(`/notifications/join-request/${requestId}`, {
      params: { _ts: Date.now() },
    }),

  deleteAllNotifications: () =>
    apiClient.post('/notifications/delete-all'),
};
