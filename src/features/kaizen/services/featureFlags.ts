import { apiClient } from '@api/client';

import { DEFAULT_KAIZEN_FEATURE_FLAGS } from '../constants';

import { storageHelpers } from './storage';

const CACHE_KEY = 'kaizen.feature.flags';

export type KaizenFeatureFlags = { [K in keyof typeof DEFAULT_KAIZEN_FEATURE_FLAGS]: boolean };

export async function fetchKaizenFeatureFlags(): Promise<KaizenFeatureFlags> {
  try {
    const response = await apiClient.get<{ flags?: Record<string, boolean> }>('/api/v1/features');
    const flags = response.data.flags ?? {};
    const resolved = {
      kaizen: flags.kaizen ?? DEFAULT_KAIZEN_FEATURE_FLAGS.kaizen,
      kaizenAIScoring: flags.kaizenAIScoring ?? DEFAULT_KAIZEN_FEATURE_FLAGS.kaizenAIScoring,
    };
    storageHelpers.setString(CACHE_KEY, JSON.stringify(resolved));
    return resolved;
  } catch {
    return getCachedKaizenFeatureFlags();
  }
}

export function getCachedKaizenFeatureFlags(): KaizenFeatureFlags {
  try {
    const raw = storageHelpers.getString(CACHE_KEY);
    if (!raw) return DEFAULT_KAIZEN_FEATURE_FLAGS;
    return { ...DEFAULT_KAIZEN_FEATURE_FLAGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_KAIZEN_FEATURE_FLAGS;
  }
}

export function isKaizenAIEnabled(): boolean {
  return getCachedKaizenFeatureFlags().kaizenAIScoring;
}
