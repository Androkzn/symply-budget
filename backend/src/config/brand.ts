/**
 * Fail-closed brand resolution for Workers.
 * Unknown/missing APP_BRAND must not default to House (Data Bridge v1.16).
 */
import type { Env } from '../types';

export type AppBrand =
  | 'symply-house'
  | 'symply-budget'
  | 'symply-kaizen'
  | 'symply-health';

export type JoinedAppBrand = 'symply-house' | 'symply-budget' | 'symply-kaizen';

const KNOWN_BRANDS: readonly AppBrand[] = [
  'symply-house',
  'symply-budget',
  'symply-kaizen',
  'symply-health',
];

export class UnknownAppBrandError extends Error {
  readonly status = 503;
  readonly code = 'misconfigured_app_brand';

  constructor(brand: string | undefined) {
    super(`Unknown or missing APP_BRAND: ${brand ?? '(unset)'}`);
    this.name = 'UnknownAppBrandError';
  }
}

export function getAppBrand(env: Env): AppBrand {
  const brand = env.APP_BRAND?.trim();
  if (!brand || !KNOWN_BRANDS.includes(brand as AppBrand)) {
    throw new UnknownAppBrandError(brand);
  }
  return brand as AppBrand;
}

export function tryGetAppBrand(env: Env): AppBrand | null {
  try {
    return getAppBrand(env);
  } catch {
    return null;
  }
}

export {
  getBrandCapabilities,
  hasBrandCapability,
  isHomeApiEnabled,
  isKaizenApiEnabled,
  isPlatformAuthorityEnabled,
  isSmartEngineEnabled,
  isPlatformRefreshSpineEnabled,
  isAuthProxyToHouseEnabled,
  getBudgetMode,
  isBudgetOff,
  isBudgetEnabled,
  isFullBudget,
  isMinimalBudget,
  isHomeApiBrand,
  isKaizenApiBrand,
  isSmartEngineBrand,
  isAuthProxyBrandId,
  isPlatformAuthorityBrand,
  isJoinedPlatformBrandId,
  isJoinedPlatformBrand,
  isFullBudgetBrand,
  isHouseBudgetTransferPair,
  isHouseBudgetBidirectionalPair,
  shouldProxyHouseTransferExport,
  resolveMintAudienceBrand,
  DEFAULT_MINT_AUDIENCE_BRAND,
  capabilitiesForBrandId,
  type BrandCapabilities,
  type BrandCapabilityKey,
  type BrandBudgetMode,
} from './brand-capabilities';
