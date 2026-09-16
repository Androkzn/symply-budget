/**
 * Canonical fleet registry — security source of truth for Data Bridge.
 * Runtime brand ids must match brand.cjs / wrangler APP_BRAND.
 */

export type RuntimeBrandId =
  | 'symply-house'
  | 'symply-budget'
  | 'symply-kaizen'
  | 'symply-health'
  | 'symply-language';

export type JoinedRuntimeBrandId =
  | 'symply-house'
  | 'symply-budget'
  | 'symply-kaizen'
  | 'symply-health'
  | 'symply-language';

export type PlatformBrandEntry = {
  runtimeBrandId: RuntimeBrandId;
  jwtAudience: string;
  workerNamePrefix: string;
  platformAuth: 'joined' | 'blocked' | 'legacy';
  bridgeV1: 'joined' | 'control' | 'blocked';
  companionV1: 'house-readonly' | 'cache-only';
};

export const PLATFORM_JWT_ISSUER = 'symply-ecosystem';

export const PLATFORM_BRANDS: Readonly<Record<RuntimeBrandId, PlatformBrandEntry>> = {
  'symply-house': {
    runtimeBrandId: 'symply-house',
    jwtAudience: 'symply-house-app',
    workerNamePrefix: 'simple-house-api',
    platformAuth: 'joined',
    bridgeV1: 'joined',
    companionV1: 'house-readonly',
  },
  'symply-budget': {
    runtimeBrandId: 'symply-budget',
    jwtAudience: 'symply-budget-app',
    workerNamePrefix: 'simple-budget-api',
    platformAuth: 'joined',
    bridgeV1: 'joined',
    companionV1: 'cache-only',
  },
  'symply-kaizen': {
    runtimeBrandId: 'symply-kaizen',
    jwtAudience: 'symply-kaizen-app',
    workerNamePrefix: 'symply-kaizen-api',
    platformAuth: 'joined',
    bridgeV1: 'control',
    companionV1: 'cache-only',
  },
  'symply-health': {
    runtimeBrandId: 'symply-health',
    jwtAudience: 'symply-health-app',
    workerNamePrefix: 'symply-health-api',
    platformAuth: 'joined',
    bridgeV1: 'joined',
    companionV1: 'cache-only',
  },
  'symply-language': {
    runtimeBrandId: 'symply-language',
    jwtAudience: 'symply-language-app',
    workerNamePrefix: 'simple-language-api',
    platformAuth: 'joined',
    bridgeV1: 'joined',
    companionV1: 'cache-only',
  },
};

export const JOINED_PLATFORM_BRANDS: readonly JoinedRuntimeBrandId[] = [
  'symply-house',
  'symply-budget',
  'symply-kaizen',
  'symply-health',
  'symply-language',
];

export const TRANSFER_EXPORT_AUDIENCE = 'symply-transfer-export';
export const HOUSE_COMPANION_AUDIENCE = 'symply-house-companion';

export function getPlatformBrand(id: string): PlatformBrandEntry | undefined {
  return PLATFORM_BRANDS[id as RuntimeBrandId];
}

export function requireJoinedAudience(aud: string): JoinedRuntimeBrandId | null {
  for (const id of JOINED_PLATFORM_BRANDS) {
    if (PLATFORM_BRANDS[id].jwtAudience === aud) return id;
  }
  return null;
}

export function audienceForBrand(brandId: JoinedRuntimeBrandId): string {
  return PLATFORM_BRANDS[brandId].jwtAudience;
}
