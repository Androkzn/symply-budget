/**
 * Joined-platform auth adapter — House/Budget/Kaizen.
 * Health/Language must not import this for login.
 */
import { brand, hasBrandCapability } from '@brand';
import {
  clearCompanionToken,
  saveCompanionToken,
  wipeLegacyTokenKeys,
} from '@services/secure-token-storage';
import { widgetSync } from '@services/widget-sync';

import { authApi } from './auth';
import { apiClient } from './client';
import {
  isJoinedPlatformBrand,
  resolveAuthAdapterKind,
} from './platform-spine';

export function assertJoinedAuthAllowed(): void {
  if (!isJoinedPlatformBrand()) {
    throw new Error(
      `Joined platform auth refused for brand ${brand.id} (adapter=${resolveAuthAdapterKind()})`
    );
  }
}

async function afterAuthSuccess<T>(result: T): Promise<T> {
  await wipeLegacyTokenKeys();
  return result;
}

export const joinedPlatformAuth = {
  login: async (email: string, password: string) => {
    assertJoinedAuthAllowed();
    return afterAuthSuccess(await authApi.login({ email, password }));
  },
  register: async (email: string, password: string, display_name?: string) => {
    assertJoinedAuthAllowed();
    return afterAuthSuccess(await authApi.register({ email, password, display_name }));
  },
  refresh: async (refresh_token: string) => {
    assertJoinedAuthAllowed();
    return afterAuthSuccess(await authApi.refreshToken(refresh_token));
  },
  appleAuth: async (data: Parameters<typeof authApi.appleAuth>[0]) => {
    assertJoinedAuthAllowed();
    return afterAuthSuccess(await authApi.appleAuth(data));
  },
  googleAuth: async (data: Parameters<typeof authApi.googleAuth>[0]) => {
    assertJoinedAuthAllowed();
    return afterAuthSuccess(await authApi.googleAuth(data));
  },
  logout: async (refresh_token: string) => {
    assertJoinedAuthAllowed();
    await clearCompanionToken();
    return authApi.logout(refresh_token);
  },
  mintCompanion: async (householdId: string, userId: string) => {
    assertJoinedAuthAllowed();
    if (!hasBrandCapability('platformAuthority')) {
      throw new Error('Companion mint is House-only');
    }
    const res = await apiClient.post<{ companion_token: string; expires_in: number }>(
      '/auth/platform/companion',
      { household_id: householdId, scope: 'tasks:read home-insight:read' }
    );
    await saveCompanionToken(res.data.companion_token);
    widgetSync.setAuth(householdId, userId);
    widgetSync.setCompanionAuth(res.data.companion_token);
    return res.data;
  },
};
