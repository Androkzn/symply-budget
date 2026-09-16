import {
  BUDGET_PRODUCTION_API_URL,
  BUDGET_STAGING_API_URL,
  resolveBrandApiUrls,
} from '@config/env.shared';

describe('resolveBrandApiUrls — standalone Symply Budget', () => {
  it('resolves the Budget staging and production Workers', () => {
    expect(resolveBrandApiUrls('symply-budget')).toEqual({
      staging: BUDGET_STAGING_API_URL,
      production: BUDGET_PRODUCTION_API_URL,
    });
    expect(BUDGET_STAGING_API_URL).toBe(
      'https://simple-budget-api-staging.a-tekhtelev.workers.dev',
    );
    expect(BUDGET_PRODUCTION_API_URL).toBe(
      'https://simple-budget-api.a-tekhtelev.workers.dev',
    );
  });

  it('rejects non-Budget brands', () => {
    expect(() => resolveBrandApiUrls('symply-house')).toThrow(
      'Unsupported standalone brand',
    );
  });
});
