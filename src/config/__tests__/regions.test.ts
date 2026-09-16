import {
  SUPPORTED_REGION_COUNTRIES,
  findRegionCountry,
  formatRegionLabel,
} from '@config/regions';

describe('regions config', () => {
  it('offers Canada and the United States with subdivisions', () => {
    const codes = SUPPORTED_REGION_COUNTRIES.map((c) => c.code);
    expect(codes).toEqual(['CA', 'US']);
    const ca = findRegionCountry('CA');
    expect(ca?.subdivisions.some((s) => s.code === 'BC')).toBe(true);
    expect(ca?.subdivisionLabel).toBe('Province');
    const us = findRegionCountry('US');
    expect(us?.subdivisions.some((s) => s.code === 'CA')).toBe(true); // California
    expect(us?.subdivisionLabel).toBe('State');
  });

  it('findRegionCountry returns undefined for unknown/empty codes', () => {
    expect(findRegionCountry('ZZ')).toBeUndefined();
    expect(findRegionCountry(null)).toBeUndefined();
    expect(findRegionCountry(undefined)).toBeUndefined();
  });

  it('formats a full "Province, Country" label', () => {
    expect(formatRegionLabel('CA', 'BC')).toBe('British Columbia, Canada');
    expect(formatRegionLabel('US', 'NY')).toBe('New York, United States');
  });

  it('falls back to just the country when no subdivision is set', () => {
    expect(formatRegionLabel('CA', null)).toBe('Canada');
  });

  it('returns null when the country is unknown', () => {
    expect(formatRegionLabel(null, null)).toBeNull();
    expect(formatRegionLabel('ZZ', 'BC')).toBeNull();
  });
});
