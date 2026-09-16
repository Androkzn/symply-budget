import type { BrandConfig } from '../src/brand/types';

import { brand as simpleBudget } from './symply-budget/brand';

/** All registered brands — add new packs here. */
export const BRANDS: Record<string, BrandConfig> = {
  'symply-budget': simpleBudget,
};

/** @deprecated Never used as a silent fallback — set APP_BRAND explicitly. */
export const DEFAULT_BRAND_ID = 'symply-budget';

export class UnknownAppBrandError extends Error {
  constructor(brand: string | undefined) {
    super(`Unknown or missing APP_BRAND: ${brand ?? '(unset)'}`);
    this.name = 'UnknownAppBrandError';
  }
}

export function getBrandById(id: string | undefined): BrandConfig {
  if (!id || !BRANDS[id]) {
    throw new UnknownAppBrandError(id);
  }
  return BRANDS[id];
}

export function resolveBrandIdFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = (env.EXPO_PUBLIC_APP_BRAND || env.APP_BRAND || '').trim();
  if (!raw) {
    throw new UnknownAppBrandError(undefined);
  }
  return raw;
}

export function getActiveBrandConfig(
  env: NodeJS.ProcessEnv = process.env,
): BrandConfig {
  return getBrandById(resolveBrandIdFromEnv(env));
}

export { simpleBudget };
