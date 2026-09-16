/**
 * Proactive AI access check for screens/actions that start AI work.
 * Returns true if the caller may proceed; otherwise navigates to Unlock AI.
 */

import { useCallback } from 'react';

import { useAIEntitlement } from '@hooks/useAIEntitlement';
import { navigateToUnlockAI } from '@services/aiAccessNavigation';

export function useRequireAIAccess() {
  const entitlement = useAIEntitlement();

  const ensureCanUseAI = useCallback((): boolean => {
    if (entitlement.isLoading) return false;
    if (!entitlement.aiFeaturesEnabled) {
      navigateToUnlockAI('ai_features_disabled');
      return false;
    }
    if (!entitlement.canUseAI) {
      navigateToUnlockAI(entitlement.denialReason ?? 'ai_access_required');
      return false;
    }
    return true;
  }, [entitlement]);

  return {
    ...entitlement,
    ensureCanUseAI,
  };
}
