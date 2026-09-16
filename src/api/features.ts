import type { FeatureFlagKey } from '@config/features';

import { apiClient } from './client';

export interface FeatureFlagsResponse {
  flags: Record<FeatureFlagKey, boolean>;
  version: number;
  updatedAt: string | null;
}

export const featuresApi = {
  /** Public endpoint — global feature flags. No auth required. */
  getFeatureFlags: () =>
    apiClient.get<FeatureFlagsResponse>('/features').then((res) => res.data),
};
