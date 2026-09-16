import { useEffect } from 'react';

import { setAIAccessDeniedListener } from '@services/aiAccessDeniedHandler';
import { navigateToUnlockAI } from '@services/aiAccessNavigation';

/**
 * Registers UI navigation when the API client rejects with AIAccessError.
 * Mount once in the authenticated app shell (expo-router root layout).
 */
export function useAIAccessErrorNavigation(): void {
  useEffect(() => {
    setAIAccessDeniedListener((error) => {
      navigateToUnlockAI(error.code);
    });
    return () => setAIAccessDeniedListener(null);
  }, []);
}
