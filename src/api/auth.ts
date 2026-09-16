import type { User } from '@/types';
import { isLanguageCapableBrand } from '@brand';
import { languageAuthApi } from '@features/language/api/languageAuth';

import { apiClient } from './client';

const useLanguageDonorAuth = (): boolean => isLanguageCapableBrand();

// Request types
interface LoginRequest {
  email: string;
  password: string;
}

interface RegisterRequest {
  email: string;
  password: string;
  display_name?: string;
}

interface AppleAuthRequest {
  identity_token: string;
  authorization_code: string;
  user?: {
    email?: string;
    name?: {
      firstName?: string;
      lastName?: string;
    };
  };
}

interface GoogleAuthRequest {
  id_token: string;
}

// Response types
interface AuthResponse {
  user: User;
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface SocialAuthResponse extends AuthResponse {
  is_new_user: boolean;
}

interface MessageResponse {
  message: string;
}

interface TokenRefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export const authApi = {
  // Email/Password Auth
  login: (credentials: LoginRequest): Promise<AuthResponse> =>
    useLanguageDonorAuth()
      ? languageAuthApi.login(credentials)
      : apiClient.post<AuthResponse>('/auth/login', credentials).then((res) => res.data),

  register: (data: RegisterRequest): Promise<AuthResponse> =>
    useLanguageDonorAuth()
      ? languageAuthApi.register(data)
      : apiClient.post<AuthResponse>('/auth/register', data).then((res) => res.data),

  logout: (refresh_token: string): Promise<unknown> =>
    useLanguageDonorAuth()
      ? languageAuthApi.logout(refresh_token)
      : apiClient.post<void>('/auth/logout', { refresh_token }),

  // Email Verification
  verifyEmail: (token: string) =>
    apiClient.post<MessageResponse>('/auth/verify-email', { token }).then((res) => res.data),

  resendVerification: () =>
    apiClient.post<MessageResponse>('/auth/resend-verification').then((res) => res.data),

  // Password Reset
  forgotPassword: (email: string): Promise<MessageResponse> =>
    useLanguageDonorAuth()
      ? languageAuthApi.forgotPassword(email)
      : apiClient.post<MessageResponse>('/auth/forgot-password', { email }).then((res) => res.data),

  resetPassword: (token: string, password: string): Promise<MessageResponse> =>
    useLanguageDonorAuth()
      ? languageAuthApi.resetPassword(token, password)
      : apiClient
          .post<MessageResponse>('/auth/reset-password', { token, password })
          .then((res) => res.data),

  changePassword: (current_password: string, new_password: string) =>
    apiClient
      .post<MessageResponse>('/auth/change-password', { current_password, new_password })
      .then((res) => res.data),

  // Token Refresh
  refreshToken: (refresh_token: string): Promise<TokenRefreshResponse> =>
    useLanguageDonorAuth()
      ? languageAuthApi.refreshToken(refresh_token)
      : apiClient
          .post<TokenRefreshResponse>('/auth/refresh', { refresh_token })
          .then((res) => res.data),

  // Social Auth
  appleAuth: (data: AppleAuthRequest): Promise<SocialAuthResponse> =>
    useLanguageDonorAuth()
      ? languageAuthApi.appleAuth(data)
      : apiClient.post<SocialAuthResponse>('/auth/apple', data).then((res) => res.data),

  googleAuth: (data: GoogleAuthRequest): Promise<SocialAuthResponse> =>
    useLanguageDonorAuth()
      ? languageAuthApi.googleAuth(data)
      : apiClient.post<SocialAuthResponse>('/auth/google', data).then((res) => res.data),

  // Account Management
  deleteAccount: () =>
    apiClient.delete<MessageResponse>('/auth/account').then((res) => res.data),

  // Terms Acceptance
  acceptTerms: () =>
    apiClient.post<{ user: User }>('/auth/accept-terms').then((res) => res.data),
};
