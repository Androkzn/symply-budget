import type { UserRole } from '../types';

/**
 * Coerce the free-form `users.role` TEXT column to the closed `UserRole` union.
 *
 * The column is TEXT with a `'user'` default, so a row can hold anything a
 * future migration, a manual `wrangler d1 execute`, or a mirrored parent record
 * put there. Anything that is not exactly `'admin'` resolves to `'user'`, which
 * makes the privilege gate FAIL CLOSED: a typo ("Admin", "administrator", NULL
 * on a pre-migration row) denies access rather than granting it.
 */
export function normalizeUserRole(role: string | null | undefined): UserRole {
  return role === 'admin' ? 'admin' : 'user';
}

export function isAdminRole(role: string | null | undefined): boolean {
  return normalizeUserRole(role) === 'admin';
}
