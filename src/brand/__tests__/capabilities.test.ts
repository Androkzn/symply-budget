/**
 * Language brand capability gate (src/brand/capabilities.ts).
 *
 * `isLanguageCapableBrand` is the client gate for the Language-only surfaces
 * (learner profile, tutor, assessment/plan/review). Unlike the other gates it
 * is an id equality check rather than a STATIC_CAPABILITIES lookup, so it must
 * stay exclusive to Symply Language — no sibling brand may leak in.
 */

import { isLanguageCapableBrand } from '@brand/capabilities';

describe('isLanguageCapableBrand', () => {
  it('is true only for the Symply Language brand', () => {
    expect(isLanguageCapableBrand('symply-language')).toBe(true);
  });

  it('is false for every sibling brand', () => {
    for (const id of ['symply-house', 'symply-budget', 'symply-kaizen', 'symply-health']) {
      expect(isLanguageCapableBrand(id)).toBe(false);
    }
  });

  it('is false for an unknown brand id', () => {
    expect(isLanguageCapableBrand('symply-nope')).toBe(false);
  });

  it('defaults to the active bundle brand (House in the Jest run)', () => {
    expect(isLanguageCapableBrand()).toBe(false);
  });
});
