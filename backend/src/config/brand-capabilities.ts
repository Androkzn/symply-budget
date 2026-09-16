/**
 * Brand capability object — resolve brand differences once (Track A A6).
 * Static table mirrors brands/<brand-id>/brand.cjs features + backend route policy.
 * Seed pattern: `src/features/budget/mode.ts` (mode helpers over a single source).
 */
import type { Env } from '../types';

import { getAppBrand, type AppBrand } from './brand';
import {
  JOINED_PLATFORM_BRANDS,
  type JoinedRuntimeBrandId,
} from './platform-brands';

/** Default JWT mint audience — House platform authority. */
export const DEFAULT_MINT_AUDIENCE_BRAND: JoinedRuntimeBrandId = 'symply-house';

export type BrandBudgetMode = 'off' | 'minimal' | 'full';

/** Boolean gates checked at route/cron/service boundaries. */
export type BrandCapabilityKey =
  | 'homeApi'
  | 'kaizenApi'
  | 'healthApi'
  | 'localFirstApi'
  | 'platformAuthority'
  | 'smartEngine'
  | 'platformRefreshSpine'
  | 'authProxyToHouse'
  | 'joinedPlatform';

export interface BrandCapabilities {
  homeApi: boolean;
  kaizenApi: boolean;
  /** Symply Health tracking surface — weight/water/nutrition/cycle/vitality. */
  healthApi: boolean;
  /**
   * Local-first control plane (`/v2/*`) — Budget V2, House V2 and Health V2.
   * Health joined at He0; Kaizen is the only brand left `false`.
   */
  localFirstApi: boolean;
  platformAuthority: boolean;
  smartEngine: boolean;
  platformRefreshSpine: boolean;
  authProxyToHouse: boolean;
  joinedPlatform: boolean;
  budgetMode: BrandBudgetMode;
}

const BRAND_CAPABILITIES: Record<AppBrand, BrandCapabilities> = {
  'symply-house': {
    homeApi: true,
    kaizenApi: false,
    healthApi: false,
    localFirstApi: true,
    platformAuthority: true,
    smartEngine: true,
    platformRefreshSpine: true,
    authProxyToHouse: false,
    joinedPlatform: true,
    budgetMode: 'minimal',
  },
  'symply-budget': {
    homeApi: false,
    kaizenApi: false,
    healthApi: false,
    localFirstApi: true,
    platformAuthority: false,
    smartEngine: true,
    platformRefreshSpine: false,
    authProxyToHouse: true,
    joinedPlatform: true,
    budgetMode: 'full',
  },
  'symply-kaizen': {
    homeApi: false,
    kaizenApi: true,
    healthApi: false,
    localFirstApi: false,
    platformAuthority: false,
    smartEngine: true,
    platformRefreshSpine: false,
    authProxyToHouse: true,
    joinedPlatform: true,
    budgetMode: 'off',
  },
  // POC: Health joins Soft Transfer / Shared User (zero active users — hold lifted).
  'symply-health': {
    homeApi: false,
    kaizenApi: false,
    healthApi: true,
    localFirstApi: true,
    platformAuthority: false,
    smartEngine: true,
    platformRefreshSpine: false,
    authProxyToHouse: true,
    joinedPlatform: true,
    budgetMode: 'minimal',
  },
};

export function capabilitiesForBrand(brand: AppBrand): BrandCapabilities {
  return BRAND_CAPABILITIES[brand];
}

export function getBrandCapabilities(env: Env): BrandCapabilities {
  return capabilitiesForBrand(getAppBrand(env));
}

export function hasBrandCapability(env: Env, key: BrandCapabilityKey): boolean {
  return getBrandCapabilities(env)[key];
}

/** House-domain features — maintenance, garbage, reports, AI Housekeeper. */
export function isHomeApiEnabled(env: Env): boolean {
  return hasBrandCapability(env, 'homeApi');
}

/** Kaizen-domain features — sync, Kaizen AI, coach chat. */
export function isKaizenApiEnabled(env: Env): boolean {
  return hasBrandCapability(env, 'kaizenApi');
}

/** Symply Health tracking surface — the ported donor health domain. */
export function isHealthApiEnabled(env: Env): boolean {
  return hasBrandCapability(env, 'healthApi');
}

/** Health-domain API surface for a runtime brand id string. */
export function isHealthApiBrand(brandId: string): boolean {
  return capabilitiesForBrandId(brandId)?.healthApi ?? false;
}

/** Platform authority routes — auth/platform, shared-user, companion, Soft Transfer authority. */
export function isPlatformAuthorityEnabled(env: Env): boolean {
  return hasBrandCapability(env, 'platformAuthority');
}

/** Smart Engine / Soft Transfer client surface (blocked on Health). */
export function isSmartEngineEnabled(env: Env): boolean {
  return hasBrandCapability(env, 'smartEngine');
}

/** House-only platform refresh spine + entitlement minting on login. */
export function isPlatformRefreshSpineEnabled(env: Env): boolean {
  return hasBrandCapability(env, 'platformRefreshSpine');
}

/** Child Worker proxies auth to House (Budget/Kaizen). */
export function isAuthProxyToHouseEnabled(env: Env): boolean {
  return hasBrandCapability(env, 'authProxyToHouse');
}

export function getBudgetMode(env: Env): BrandBudgetMode {
  return getBrandCapabilities(env).budgetMode;
}

export function isBudgetOff(env: Env): boolean {
  return getBudgetMode(env) === 'off';
}

export function isBudgetEnabled(env: Env): boolean {
  return !isBudgetOff(env);
}

export function isFullBudget(env: Env): boolean {
  return getBudgetMode(env) === 'full';
}

export function isMinimalBudget(env: Env): boolean {
  return getBudgetMode(env) === 'minimal';
}

/** Resolve capabilities for an arbitrary runtime brand id (e.g. JWT claim). */
export function capabilitiesForBrandId(brandId: string): BrandCapabilities | null {
  if (!(brandId in BRAND_CAPABILITIES)) return null;
  return capabilitiesForBrand(brandId as AppBrand);
}

/** House-domain API surface for a runtime brand id string. */
export function isHomeApiBrand(brandId: string): boolean {
  return capabilitiesForBrandId(brandId)?.homeApi ?? false;
}

/** Kaizen-domain API surface for a runtime brand id string. */
export function isKaizenApiBrand(brandId: string): boolean {
  return capabilitiesForBrandId(brandId)?.kaizenApi ?? false;
}

/** Smart Engine / Soft Transfer surface for a runtime brand id string. */
export function isSmartEngineBrand(brandId: string): boolean {
  return capabilitiesForBrandId(brandId)?.smartEngine ?? false;
}

/** Child Worker proxies auth to House for a runtime brand id string. */
export function isAuthProxyBrandId(brandId: string): boolean {
  return capabilitiesForBrandId(brandId)?.authProxyToHouse ?? false;
}

/** Platform authority surface for a runtime brand id string (House Worker). */
export function isPlatformAuthorityBrand(brandId: string): boolean {
  return capabilitiesForBrandId(brandId)?.platformAuthority ?? false;
}

/** Joined Data Bridge brand id (includes Language Worker — not in AppBrand fleet). */
export function isJoinedPlatformBrandId(
  brandId: string
): brandId is JoinedRuntimeBrandId {
  return (JOINED_PLATFORM_BRANDS as readonly string[]).includes(brandId);
}

/** Joined platform brand for a resolved AppBrand (shared fleet Worker). */
export function isJoinedPlatformBrand(brand: AppBrand): boolean {
  return isJoinedPlatformBrandId(brand);
}

/** Full-budget Worker surface for a runtime brand id string. */
export function isFullBudgetBrand(brandId: string): boolean {
  return capabilitiesForBrandId(brandId)?.budgetMode === 'full';
}

/** Soft Transfer packages that touch House and full Budget Workers. */
export function isHouseBudgetTransferPair(
  sourceBrandId: string,
  destinationBrandId: string
): boolean {
  const ids = [sourceBrandId, destinationBrandId];
  return ids.some(isHomeApiBrand) && ids.some(isFullBudgetBrand);
}

/** Bidirectional House ↔ Budget pair (profile.core.v1). */
export function isHouseBudgetBidirectionalPair(
  sourceBrandId: string,
  destinationBrandId: string
): boolean {
  return (
    (isHomeApiBrand(sourceBrandId) && isFullBudgetBrand(destinationBrandId)) ||
    (isFullBudgetBrand(sourceBrandId) && isHomeApiBrand(destinationBrandId))
  );
}

/**
 * House-sourced transfer export on a child Worker — proxy to House RPC instead
 * of verifying/exporting locally.
 */
export function shouldProxyHouseTransferExport(
  sourceBrandId: string,
  env: Env
): boolean {
  return isHomeApiBrand(sourceBrandId) && !isPlatformAuthorityEnabled(env);
}

/** Resolve mint audience for platform JWTs; invalid/missing → House default. */
export function resolveMintAudienceBrand(
  brandId?: string | null
): JoinedRuntimeBrandId {
  if (brandId && isJoinedPlatformBrandId(brandId)) {
    return brandId;
  }
  return DEFAULT_MINT_AUDIENCE_BRAND;
}
