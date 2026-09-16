import Constants from 'expo-constants';

import { getActiveBrandConfig, getBrandById, resolveBrandIdFromEnv } from '../../brands';

import { hasBrandCapability } from './capabilities';
import type { BrandConfig } from './types';

export type {
  BrandAssetPaths,
  BrandBudgetMode,
  BrandColors,
  BrandConfig,
  BrandFeatureTabConfig,
  BrandFeatures,
  BrandIntegrations,
  BrandIosExtensions,
  BrandOAuthClientIds,
  BrandPostHogConfig,
  BrandRevenueCatConfig,
  BrandSentryConfig,
  BrandTabConfig,
  BrandTabRoute,
} from './types';

/**
 * Active brand for this JS bundle.
 *
 * Resolution order:
 *  1. `expo-constants` `extra.appBrand` — baked into the app manifest at build
 *     time by app.config.ts (from APP_BRAND). This is the only source that
 *     survives a STANDALONE / EAS Release bundle: there is no real `process.env`
 *     at RN runtime, and Expo inlines only DIRECT `process.env.EXPO_PUBLIC_*`
 *     references — which `resolveBrandIdFromEnv` reads through an aliased param,
 *     so nothing gets inlined. Without this, a non-Metro build throws
 *     UnknownAppBrandError at startup.
 *  2. `resolveBrandIdFromEnv()` — Metro dev, where Expo populates a runtime
 *     `process.env` with EXPO_PUBLIC_* vars (set via APP_BRAND/EXPO_PUBLIC_APP_BRAND).
 */
const extraAppBrand = (Constants.expoConfig?.extra as { appBrand?: string } | undefined)?.appBrand;
export const brandId: string = extraAppBrand ?? resolveBrandIdFromEnv();

export const brand: BrandConfig = getBrandById(brandId);

export function getBrand(): BrandConfig {
  return brand;
}

/**
 * True when this bundle is the parent Symply House app. House owns the "home"
 * domain — tasks, contractors, spaces, floor plans, gardening, home reports,
 * garbage collection, and the AI Housekeeper ("Mira"). Child apps (Budget,
 * Kaizen, Language, Health) must never surface those House-only features, so
 * gate their routes/rows/handlers with `!hasBrandCapability('homeApi')` or
 * `!isHouseBrand()`. Client mirror of backend `isHomeApiEnabled()`.
 */
export function isHouseBrand(id: string = brandId): boolean {
  return hasBrandCapability('homeApi', id);
}

export {
  getBrandCapabilities,
  hasBrandCapability,
  isJoinedPlatformBrand,
  isHouseBudgetTransferPair,
  isHouseHealthTransferPair,
  isHouseLanguageTransferPair,
  getBudgetMode,
  isBudgetOff,
  isBudgetEnabled,
  isFullBudget,
  isMinimalBudget,
  isHouseOrFullBudgetBrand,
  isHealthCapableBrand,
  isLanguageCapableBrand,
  isSmartEngineCapableBrand,
  type BrandCapabilities,
  type BrandCapabilityKey,
} from './capabilities';

export { getActiveBrandConfig, getBrandById, resolveBrandIdFromEnv };
