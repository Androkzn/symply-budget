import type { User } from '@models/index';

import { useAuthStore } from '@stores/authStore';

/**
 * Platform-admin predicate — the ONE place the app decides who is staff.
 *
 * Fails closed: anything that is not exactly `role === 'admin'` (a signed-out
 * user, a token minted before the role shipped, a cached user rehydrated from
 * an older install, a server that omits the field) is a common user.
 *
 * This is deliberately not the household role — `household_members.role` is
 * `owner`/`member` and every user who creates their own household is an owner,
 * so it would gate nothing.
 */
export function isAdminUser(user: User | null | undefined): boolean {
  return user?.role === 'admin';
}

/** Reactive form for components; re-renders when the signed-in user changes. */
export function useIsAdmin(): boolean {
  return useAuthStore((state) => isAdminUser(state.user));
}
