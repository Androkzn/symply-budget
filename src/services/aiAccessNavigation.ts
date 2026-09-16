/**
 * Navigate to Unlock AI when the server denies AI access.
 * Debounced so concurrent 403s don't stack multiple navigations.
 */

import { router } from 'expo-router';

export { isAIAccessDenialCode } from '@/errors/AIAccessError';

let lastNavAt = 0;
const DEBOUNCE_MS = 2500;

export function navigateToUnlockAI(reason?: string): void {
  const now = Date.now();
  if (now - lastNavAt < DEBOUNCE_MS) return;
  lastNavAt = now;
  try {
    router.push({
      pathname: '/ai-access',
      params: reason ? { reason } : undefined,
    });
  } catch (err) {
    console.warn('[AIAccess] navigate failed', err);
  }
}
