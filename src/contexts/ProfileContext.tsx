import type { User } from '@models/index';
import React, { createContext, useContext, useCallback, useMemo, useState } from 'react';

import { userApi } from '@api/user';
import { captureException } from '@services/monitoring';
import { useAuthStore } from '@stores/authStore';

interface ProfileContextType {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  refreshProfile: () => Promise<void>;
  updateProfile: (data: { display_name?: string; avatar_url?: string | null }) => Promise<void>;
  clearError: () => void;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

/**
 * Re-pull the household roster after this account's own profile changed.
 *
 * No-op on every brand that is not running a local-first ledger — those read
 * their members straight from `/households/:id`, where the same PATCH has
 * already landed. Best-effort throughout: a profile update must never fail
 * because a roster could not be refreshed.
 */
async function refreshLocalFirstRoster(): Promise<void> {
  try {
    const { isBudgetLocalFirst } = await import('@features/budget/local/flag');
    if (!isBudgetLocalFirst()) return;
    const { refreshBudgetHouseholdRoster } = await import('@features/budget/local/householdRoster');
    await refreshBudgetHouseholdRoster();
  } catch {
    // Display concern only — see above.
  }
}

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshProfile = useCallback(async () => {
    if (!isAuthenticated) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await userApi.getProfile();
      setUser(response.user);
    } catch (err) {
      captureException(err, { source: 'ProfileContext', phase: 'refreshProfile' });
      setError(err instanceof Error ? err.message : 'Failed to load profile');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, setUser]);

  const updateProfile = useCallback(async (data: { display_name?: string; avatar_url?: string | null }) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await userApi.updateProfile(data);
      setUser(response.user);
      // Your own row in the household roster is drawn from the server, not from
      // this store — so a rename or a new avatar has to be pulled back before
      // the member list agrees with the profile screen you are standing on.
      // Peers pick the same change up on their next sync. Brand-guarded and
      // lazily imported so no other brand pays for Budget's local-first engine
      // (same idiom as householdStore.fetchHouseholds).
      void refreshLocalFirstRoster();
    } catch (err) {
      captureException(err, { source: 'ProfileContext', phase: 'updateProfile' });
      setError(err instanceof Error ? err.message : 'Failed to update profile');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [setUser]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      isLoading,
      error,
      refreshProfile,
      updateProfile,
      clearError,
    }),
    [user, isLoading, error, refreshProfile, updateProfile, clearError]
  );

  return (
    <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
  );
}

export function useProfile() {
  const context = useContext(ProfileContext);
  if (!context) {
    throw new Error('useProfile must be used within a ProfileProvider');
  }
  return context;
}
