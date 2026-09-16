import { describe, it, expect } from 'vitest';

import { resolvePeriodEnd } from '../revenuecat-sync';

describe('resolvePeriodEnd', () => {
  const NOW = '2026-07-14T00:00:00.000Z';
  const FAR = '2999-12-31T00:00:00.000Z';

  it('uses the pro entitlement expiry when present', () => {
    expect(resolvePeriodEnd('2026-08-01T00:00:00Z', [], true, NOW)).toBe('2026-08-01T00:00:00Z');
  });

  it('takes the latest subscription expiry when the entitlement has none', () => {
    expect(
      resolvePeriodEnd(null, ['2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z'], true, NOW)
    ).toBe('2026-09-01T00:00:00Z');
  });

  it('takes the max of entitlement and subscription expiries', () => {
    expect(resolvePeriodEnd('2026-08-15T00:00:00Z', ['2026-08-01T00:00:00Z'], true, NOW)).toBe(
      '2026-08-15T00:00:00Z'
    );
  });

  it('maps a non-expiring ACTIVE pro (lifetime/promo) to a far-future date, not now', () => {
    // Regression: previously fell back to `now`, so isPaidSubscription immediately
    // saw current_period_end <= now and denied the active entitlement.
    expect(resolvePeriodEnd(null, [], true, NOW)).toBe(FAR);
    expect(resolvePeriodEnd(null, [null, undefined], true, NOW)).toBe(FAR);
  });

  it('falls back to now when pro is NOT active and there is no expiry', () => {
    expect(resolvePeriodEnd(null, [], false, NOW)).toBe(NOW);
  });
});
