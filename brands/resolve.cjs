/**
 * Config-time brand resolver (CommonJS).
 * Keep in sync with brands/index.ts — every brands/<id>/ folder must be listed.
 * Unknown/missing APP_BRAND fails closed (Data Bridge v1.16) — no House default.
 */
const simpleBudget = require('./symply-budget/brand.cjs');

const BRANDS = {
  'symply-budget': simpleBudget,
};

/** @deprecated Listed only for tooling that still imports the symbol; never used as fallback. */
const DEFAULT_BRAND_ID = 'symply-budget';

class UnknownAppBrandError extends Error {
  constructor(brand) {
    super(`Unknown or missing APP_BRAND: ${brand ?? '(unset)'}`);
    this.name = 'UnknownAppBrandError';
  }
}

function getBrandById(id) {
  if (!id || !BRANDS[id]) {
    throw new UnknownAppBrandError(id);
  }
  return BRANDS[id];
}

function resolveBrandIdFromEnv(env = process.env) {
  const raw = (env.EXPO_PUBLIC_APP_BRAND || env.APP_BRAND || '').trim();
  if (!raw) {
    throw new UnknownAppBrandError(undefined);
  }
  return raw;
}

function getActiveBrandConfig(env = process.env) {
  return getBrandById(resolveBrandIdFromEnv(env));
}

module.exports = {
  BRANDS,
  DEFAULT_BRAND_ID,
  UnknownAppBrandError,
  getBrandById,
  resolveBrandIdFromEnv,
  getActiveBrandConfig,
};
