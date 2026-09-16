/**
 * Brand capability object — client mirror of backend brand-capabilities.ts.
 * Budget mode always comes from the active brand pack (`brand.features.budget`).
 */
import type { BrandBudgetMode, BrandConfig } from './types';

import { brand, brandId, getBrandById } from './index';

export type BrandCapabilityKey =
  | 'homeApi'
  | 'kaizenApi'
  | 'platformAuthority'
  | 'smartEngine'
  | 'joinedPlatform'
  | 'utilities';

export interface BrandCapabilities {
  homeApi: boolean;
  kaizenApi: boolean;
  platformAuthority: boolean;
  smartEngine: boolean;
  joinedPlatform: boolean;
  /**
   * Utility bills / property tax / BC Assessment surface.
   *
   * House-only, and deliberately independent of `budgetMode`. The backend has
   * always gated `/households/:householdId/utilities` behind `homeApi`
   * (backend/src/index.ts `gateHomeApiPaths`), so any brand without `homeApi`
   * gets a 404 from the Worker regardless of what the client mounts. This flag
   * makes the client agree with that instead of routing Utilities through the
   * Budget product.
   */
  utilities: boolean;
  budgetMode: BrandBudgetMode;
}

const STATIC_CAPABILITIES: Record<
  string,
  Omit<BrandCapabilities, 'budgetMode'>
> = {
  'symply-house': {
    homeApi: true,
    kaizenApi: false,
    platformAuthority: true,
    smartEngine: true,
    joinedPlatform: true,
    utilities: true,
  },
  'symply-budget': {
    homeApi: false,
    kaizenApi: false,
    platformAuthority: false,
    smartEngine: true,
    joinedPlatform: true,
    utilities: false,
  },
  'symply-kaizen': {
    homeApi: false,
    kaizenApi: true,
    platformAuthority: false,
    smartEngine: true,
    joinedPlatform: true,
    utilities: false,
  },
  // POC: Health joins Soft Transfer / Shared User spine.
  'symply-health': {
    homeApi: false,
    kaizenApi: false,
    platformAuthority: false,
    smartEngine: true,
    joinedPlatform: true,
    utilities: false,
  },
  // Soft Transfer packages joined (profile.core.language / language.summary).
  // Auth remains Language Worker JWT until Shared User spine lands.
  'symply-language': {
    homeApi: false,
    kaizenApi: false,
    platformAuthority: false,
    smartEngine: true,
    joinedPlatform: true,
    utilities: false,
  },
};

function resolveBrandConfig(id: string): BrandConfig {
  return id === brandId ? brand : getBrandById(id);
}

export function getBrandCapabilities(id: string = brandId): BrandCapabilities {
  const config = resolveBrandConfig(id);
  const staticCaps = STATIC_CAPABILITIES[config.id];
  if (!staticCaps) {
    throw new Error(`Unknown brand capabilities: ${config.id}`);
  }
  return {
    ...staticCaps,
    budgetMode: config.features.budget,
  };
}

export function hasBrandCapability(
  key: BrandCapabilityKey,
  id: string = brandId
): boolean {
  return getBrandCapabilities(id)[key];
}

/** Joined Data Bridge brand (House / Budget / Kaizen / Health / Language). */
export function isJoinedPlatformBrand(id: string = brandId): boolean {
  return hasBrandCapability('joinedPlatform', id);
}

/** Soft Transfer client surface (packages / consents / prepare / export / import). */
export function isSmartEngineCapableBrand(id: string = brandId): boolean {
  return hasBrandCapability('smartEngine', id);
}

export function isLanguageCapableBrand(id: string = brandId): boolean {
  return id === 'symply-language';
}

/**
 * Utilities surface (bills / property tax / BC Assessment). House only.
 *
 * Independent of budget mode by design — see `BrandCapabilities.utilities`.
 */
export function isUtilitiesCapableBrand(id: string = brandId): boolean {
  return hasBrandCapability('utilities', id);
}

/** Soft Transfer packages that touch House and full Budget apps. */
export function isHouseBudgetTransferPair(
  sourceBrandId: string,
  destinationBrandId: string,
): boolean {
  const ids = [sourceBrandId, destinationBrandId];
  return ids.some(otherId => hasBrandCapability('homeApi', otherId)) &&
    ids.some(otherId => isFullBudget(otherId));
}

/** Soft Transfer packages that touch House and Health. */
export function isHouseHealthTransferPair(
  sourceBrandId: string,
  destinationBrandId: string,
): boolean {
  const ids = [sourceBrandId, destinationBrandId];
  return (
    ids.some(otherId => hasBrandCapability('homeApi', otherId)) &&
    ids.some(otherId => isHealthCapableBrand(otherId))
  );
}

/** Soft Transfer packages that touch House and Language. */
export function isHouseLanguageTransferPair(
  sourceBrandId: string,
  destinationBrandId: string,
): boolean {
  const ids = [sourceBrandId, destinationBrandId];
  return (
    ids.some(otherId => hasBrandCapability('homeApi', otherId)) &&
    ids.some(otherId => isLanguageCapableBrand(otherId))
  );
}

/** Active brand budget mode (`off` | `minimal` | `full`). */
export function getBudgetMode(id: string = brandId): BrandBudgetMode {
  return getBrandCapabilities(id).budgetMode;
}

export function isBudgetOff(id: string = brandId): boolean {
  return getBudgetMode(id) === 'off';
}

export function isBudgetEnabled(id: string = brandId): boolean {
  return !isBudgetOff(id);
}

export function isFullBudget(id: string = brandId): boolean {
  return getBudgetMode(id) === 'full';
}

export function isMinimalBudget(id: string = brandId): boolean {
  return getBudgetMode(id) === 'minimal';
}

/** House or full Budget app — Soft Transfer House↔Budget UX. */
export function isHouseOrFullBudgetBrand(id: string = brandId): boolean {
  return hasBrandCapability('homeApi', id) || isFullBudget(id);
}

/** Joined Health POC brand (minimal budget, no home/kaizen API). */
export function isHealthCapableBrand(id: string = brandId): boolean {
  const caps = getBrandCapabilities(id);
  return (
    caps.joinedPlatform &&
    caps.smartEngine &&
    !caps.homeApi &&
    !caps.kaizenApi &&
    caps.budgetMode === 'minimal'
  );
}
