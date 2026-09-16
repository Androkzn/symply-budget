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
  it('lists all five ecosystem brands', () => {
    expect(Object.keys(BRANDS).sort()).toEqual([
      'symply-budget',
      'symply-health',
      'symply-house',
      'symply-kaizen',
      'symply-language',
    ]);
  });

  it('resolves known brand ids', () => {
    expect(getBrandById('symply-house').id).toBe('symply-house');
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
    const brand = getActiveBrandConfig({ EXPO_PUBLIC_APP_BRAND: 'symply-kaizen' });
    expect(brand.id).toBe('symply-kaizen');
  });
});
