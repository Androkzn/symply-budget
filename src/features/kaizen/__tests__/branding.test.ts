/**
 * Kaizen brand primitives tests.
 *
 * `@brand` is mocked so `isKaizenBrand()`'s default-argument branch (which reads
 * the ambient `brandId`) is deterministic without pulling the heavy brand graph
 * (expo-constants + every brand pack).
 */
jest.mock('@brand', () => ({
  brandId: 'symply-kaizen',
  hasBrandCapability: (key: string, id = 'symply-kaizen') =>
    key === 'kaizenApi' && id === 'symply-kaizen',
}));

import {
  isKaizenBrand,
  KAIZEN_WORDMARK_GRADIENT_DARK,
  KAIZEN_WORDMARK_GRADIENT_LIGHT,
} from '../branding';

describe('isKaizenBrand', () => {
  it('is true for the Kaizen brand id', () => {
    expect(isKaizenBrand('symply-kaizen')).toBe(true);
  });

  it('is false for any other brand id', () => {
    expect(isKaizenBrand('symply-house')).toBe(false);
  });

  it('defaults to the ambient brandId when no id is passed', () => {
    // Mocked brandId === 'symply-kaizen' → default-argument path resolves true.
    expect(isKaizenBrand()).toBe(true);
  });
});

describe('wordmark gradients', () => {
  it('exposes the dark-surface gradient stops', () => {
    expect(KAIZEN_WORDMARK_GRADIENT_DARK).toEqual(['#EAF2FF', '#DDE8FF', '#CFE0FF']);
  });

  it('exposes the light-surface gradient stops', () => {
    expect(KAIZEN_WORDMARK_GRADIENT_LIGHT).toEqual(['#123F57', '#16345A', '#1B356A']);
  });
});
