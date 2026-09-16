/**
 * Platform spine HTTP client — joined Soft Transfer brands only.
 * Language stays on its own Worker; Health joins the platform spine (POC).
 */
import { brand, hasBrandCapability, isJoinedPlatformBrand } from '@brand';
import { ENV } from '@config/env';

export type AuthAdapterKind =
  | 'joined-platform'
  | 'shared-worker-legacy'
  | 'language-legacy';

export function resolveAuthAdapterKind(brandId: string = brand.id): AuthAdapterKind {
  if (isJoinedPlatformBrand(brandId)) return 'joined-platform';
  try {
    if (!hasBrandCapability('joinedPlatform', brandId)) return 'language-legacy';
  } catch {
    // Unknown brand id — fall through to throw below.
  }
  throw new Error(`Unknown brand for auth adapter: ${brandId}`);
}

export { isJoinedPlatformBrand };

/**
 * House spine base URL for child proxies / Soft Transfer prepare.
 * Unjoined brands throw on access.
 */
export function getPlatformSpineApiUrl(): string {
  if (!hasBrandCapability('joinedPlatform')) {
    throw new Error('Platform spine client refused for unjoined brand');
  }
  // Prefer explicit override; else House Worker for the active API env.
  const override = process.env.EXPO_PUBLIC_PLATFORM_SPINE_API_URL;
  if (override?.trim()) return override.trim().replace(/\/$/, '');
  return ENV.IS_PRODUCTION
    ? 'https://simple-house-api.a-tekhtelev.workers.dev'
    : 'https://simple-house-api-staging.a-tekhtelev.workers.dev';
}

export function createSpineClientHeaders(accessToken: string): Record<string, string> {
  if (!hasBrandCapability('joinedPlatform')) {
    throw new Error('Platform spine client refused for unjoined brand');
  }
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'X-Platform-Caller-Brand': brand.id,
  };
}
