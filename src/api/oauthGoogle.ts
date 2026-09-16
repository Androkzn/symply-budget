import { apiClient } from './client';

export interface OAuthGoogleStartResponse {
  url: string;
}

export interface OAuthGoogleStatusResponse {
  connected: boolean;
  linked_at: string | null;
}

export const oauthGoogleApi = {
  start: (householdId: string, appScheme?: string) =>
    apiClient
      .get<OAuthGoogleStartResponse>('/oauth/google/start', {
        params: { householdId, ...(appScheme ? { appScheme } : {}) },
      })
      .then((res) => res.data),

  status: (householdId: string) =>
    apiClient
      .get<OAuthGoogleStatusResponse>('/oauth/google/status', {
        params: { householdId },
      })
      .then((res) => res.data),

  disconnect: (householdId: string) =>
    apiClient
      .delete<{ ok: true }>('/oauth/google', {
        params: { householdId },
      })
      .then((res) => res.data),
};
