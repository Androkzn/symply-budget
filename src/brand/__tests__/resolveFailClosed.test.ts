/**
 * brands/resolve.cjs — fail-closed APP_BRAND (Data Bridge).
 */
const {
  getBrandById,
  resolveBrandIdFromEnv,
  getActiveBrandConfig,
  UnknownAppBrandError,
  BRANDS,
} = require('../../../brands/resolve.cjs');

describe('brands/resolve.cjs', () => {
  it('lists only the standalone brand', () => {
    expect(Object.keys(BRANDS)).toEqual(['symply-budget']);
  });

  it('resolves known brand ids', () => {
    expect(getBrandById('symply-budget').id).toBe('symply-budget');
  });

  it('throws UnknownAppBrandError for missing/unknown id', () => {
    expect(() => getBrandById('')).toThrow(UnknownAppBrandError);
    expect(() => getBrandById('simple-house')).toThrow(UnknownAppBrandError);
  });

  it('resolveBrandIdFromEnv fails closed when unset', () => {
    expect(() => resolveBrandIdFromEnv({})).toThrow(UnknownAppBrandError);
    expect(() => resolveBrandIdFromEnv({ APP_BRAND: '' })).toThrow(UnknownAppBrandError);
  });

  it('getActiveBrandConfig reads EXPO_PUBLIC_APP_BRAND', () => {
    const brand = getActiveBrandConfig({ EXPO_PUBLIC_APP_BRAND: 'symply-budget' });
    expect(brand.id).toBe('symply-budget');
  });
});
