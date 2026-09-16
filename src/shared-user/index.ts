/**
 * Shared User (Simple ID) — account identity spine for the fleet.
 *
 * Products reference `user_id` from auth; they do not own the user record.
 * AI entitlement is account-level (`ai.status`), not per-app.
 *
 * Backend authority: Shared User / auth service. This module is the mobile
 * contract + helpers until the dedicated Shared User service is split out.
 */

export type AccountAiStatus = 'off' | 'entitled' | 'denied';

export type SharedUserProfile = {
  userId: string;
  email?: string | null;
  displayName?: string | null;
  /** Account-level AI entitlement across entitled apps. */
  aiStatus: AccountAiStatus;
  entitledBrandIds: string[];
};

/**
 * Map mobile AI access response into account `ai.status`.
 * Core product paths must work when status is `off`.
 */
export function resolveAccountAiStatus(input: {
  aiFeaturesEnabled: boolean;
  canUseAI: boolean;
}): AccountAiStatus {
  if (!input.aiFeaturesEnabled) return 'off';
  if (input.canUseAI) return 'entitled';
  return 'denied';
}

export function isAiEntitled(status: AccountAiStatus): boolean {
  return status === 'entitled';
}
