import type { User } from '@/types';

import { apiClient } from './client';

interface UpdateProfileRequest {
  display_name?: string;
  avatar_url?: string | null;
}

interface UserResponse {
  user: User;
}

export interface Session {
  id: string;
  device_info: {
    platform?: string;
    os_version?: string;
    app_version?: string;
  } | null;
  created_at: string;
  expires_at: string;
  is_current: boolean;
}

interface SessionsResponse {
  sessions: Session[];
}

export const userApi = {
  getProfile: () =>
    apiClient.get<UserResponse>('/users/me').then((res) => res.data),

  updateProfile: (data: UpdateProfileRequest) =>
    apiClient.patch<UserResponse>('/users/me', data).then((res) => res.data),

  // Session management
  getSessions: () =>
    apiClient.get<SessionsResponse>('/users/me/sessions').then((res) => res.data),

  revokeSession: (sessionId: string) =>
    apiClient.delete(`/users/me/sessions/${sessionId}`),

  revokeAllSessions: () =>
    apiClient.delete('/users/me/sessions').then((res) => res.data),

  // Onboarding management
  getOnboardingStatus: () =>
    apiClient.get<{
      has_completed_onboarding: boolean;
      onboarding_household_created: boolean;
      onboarding_report_added: boolean;
      onboarding_garbage_setup: boolean;
      onboarding_floor_plan_added: boolean;
    }>('/users/me/onboarding').then((res) => res.data),

  updateOnboardingStep: (step: 'household' | 'report' | 'garbage' | 'floor_plan' | 'complete') =>
    apiClient.post<UserResponse>(`/users/me/onboarding/${step}`).then((res) => res.data),
};
