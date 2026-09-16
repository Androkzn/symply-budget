/**
 * Language auth adapter — maps the donor `/api/v1/auth/*` contract onto the
 * platform's `authApi` shapes so the shared LoginScreen + authStore work
 * unchanged for the Language brand. `src/api/auth.ts` delegates here when
 * `isLanguageBrand()` is true.
 *
 * Donor responses use camelCase (`accessToken`, `displayName`); the platform
 * `User` + auth response types use snake_case, so we translate at this seam.
 */
import type { User } from '@/types';

import { languageRequest } from './languageClient';

// Donor access token lifetime (ACCESS_TOKEN_EXPIRY in the donor wrangler vars).
const ACCESS_TOKEN_EXPIRES_IN = 900;

interface DonorUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
}

interface DonorAuthResponse {
  user: DonorUser;
  accessToken: string;
  refreshToken: string;
}

interface DonorTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LanguageAuthResponse {
  user: User;
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface LanguageSocialAuthResponse extends LanguageAuthResponse {
  is_new_user: boolean;
}

export interface LanguageTokenRefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** Fill the platform `User` shape from a donor user (House-only fields default off). */
function toPlatformUser(donor: DonorUser): User {
  return {
    id: donor.id,
    email: donor.email,
    email_verified: false,
    display_name: donor.displayName ?? null,
    avatar_url: donor.avatarUrl ?? null,
    has_password: true,
    has_apple: false,
    has_google: false,
    terms_accepted_at: null,
    // Onboarding is tracked locally for Language (learner profile), so a fresh
    // login always routes through onboarding until the profile is set.
    has_completed_onboarding: false,
    onboarding_household_created: false,
    onboarding_report_added: false,
    onboarding_garbage_setup: false,
    onboarding_floor_plan_added: false,
    created_at: '',
    updated_at: '',
  };
}

function toAuthResponse(res: DonorAuthResponse): LanguageAuthResponse {
  return {
    user: toPlatformUser(res.user),
    access_token: res.accessToken,
    refresh_token: res.refreshToken,
    expires_in: ACCESS_TOKEN_EXPIRES_IN,
  };
}

export const languageAuthApi = {
  login: (credentials: { email: string; password: string }) =>
    languageRequest<DonorAuthResponse>('/auth/login', {
      method: 'POST',
      body: credentials,
      auth: false,
    }).then(toAuthResponse),

  register: (data: { email: string; password: string; display_name?: string }) =>
    languageRequest<DonorAuthResponse>('/auth/register', {
      method: 'POST',
      body: { email: data.email, password: data.password, displayName: data.display_name },
      auth: false,
    }).then(toAuthResponse),

  // Donor backend has no /logout endpoint; token invalidation is client-side.
  logout: async (_refresh_token: string): Promise<void> => {
    /* no-op: authStore.logout() clears local state */
  },

  refreshToken: (refresh_token: string) =>
    languageRequest<DonorTokens>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: refresh_token },
      auth: false,
    }).then(
      (tokens): LanguageTokenRefreshResponse => ({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_in: ACCESS_TOKEN_EXPIRES_IN,
      }),
    ),

  appleAuth: (data: {
    identity_token: string;
    authorization_code: string;
    user?: { email?: string; name?: { firstName?: string; lastName?: string } };
  }) => {
    const displayName = [data.user?.name?.firstName, data.user?.name?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    return languageRequest<DonorAuthResponse>('/auth/apple', {
      method: 'POST',
      body: {
        identityToken: data.identity_token,
        email: data.user?.email,
        displayName: displayName || undefined,
      },
      auth: false,
    }).then((res): LanguageSocialAuthResponse => ({ ...toAuthResponse(res), is_new_user: false }));
  },

  googleAuth: (data: { id_token: string }) =>
    languageRequest<DonorAuthResponse>('/auth/google', {
      method: 'POST',
      body: { idToken: data.id_token },
      auth: false,
    }).then((res): LanguageSocialAuthResponse => ({ ...toAuthResponse(res), is_new_user: false })),

  forgotPassword: (email: string) =>
    languageRequest<{ message?: string }>('/auth/forgot-password', {
      method: 'POST',
      body: { email },
      auth: false,
    }).then((r) => ({ message: r.message ?? 'If that email exists, a reset link was sent.' })),

  resetPassword: (token: string, password: string) =>
    languageRequest<{ message?: string }>('/auth/reset-password', {
      method: 'POST',
      body: { token, newPassword: password },
      auth: false,
    }).then((r) => ({ message: r.message ?? 'Password reset successfully' })),
};
