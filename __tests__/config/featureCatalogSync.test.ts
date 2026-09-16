/**
 * Feature-flag catalog sync guard.
 *
 * The mobile catalog (src/config/features.ts FEATURE_DEFAULTS) and the backend
 * catalog (backend/src/services/featureFlagService.ts DEFAULT_FLAGS) MUST stay
 * in lockstep: same keys, same default values. If they drift, a key is honored
 * on one side and silently ignored on the other (BRD FeatureFlags_BRD_v1.0 §1.4
 * "default-catalog drift" risk). This test fails CI the moment they diverge so
 * the two sources of truth can never quietly fall out of sync.
 *
 * The backend module is pure TypeScript with no runtime imports (its only
 * Cloudflare type reference is erased at compile time), so it is safe to import
 * directly into the Jest/Babel transform here.
 */

import { FEATURE_DEFAULTS } from '@config/features';

import { DEFAULT_FLAGS } from '../../backend/src/services/featureFlagService';

describe('feature-flag catalog sync', () => {
  it('mobile and backend expose the identical set of flag keys', () => {
    const mobileKeys = Object.keys(FEATURE_DEFAULTS).sort();
    const backendKeys = Object.keys(DEFAULT_FLAGS).sort();
    expect(mobileKeys).toEqual(backendKeys);
  });

  it('mobile and backend agree on every default value', () => {
    expect(FEATURE_DEFAULTS).toEqual(DEFAULT_FLAGS);
  });
});
