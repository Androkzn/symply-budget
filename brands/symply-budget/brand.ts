import type { BrandConfig } from '../../src/brand/types';

const brandData = require('./brand.cjs') as BrandConfig;

/**
 * Simple Budget brand pack.
 * Register in brands/index.ts and brands/resolve.cjs.
 */
export const brand = brandData;
