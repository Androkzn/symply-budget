import { describe, expect, it, vi } from 'vitest';

import { platformMetric } from '../platform-metrics';

describe('platformMetric', () => {
  it('writes to Analytics Engine when bound', () => {
    const writeDataPoint = vi.fn();
    const env = { ANALYTICS_ENGINE: { writeDataPoint } } as unknown as Parameters<
      typeof platformMetric
    >[0];

    platformMetric(env, 'platform_bridge_auth_denial', 1, {
      reason: 'invalid_service_token',
      caller_brand: 'symply-budget',
    });

    expect(writeDataPoint).toHaveBeenCalledWith({
      blobs: ['platform_bridge_auth_denial', 'symply-budget', 'invalid_service_token'],
      doubles: [1],
      indexes: ['platform_bridge_auth_denial'],
    });
  });

  it('falls back to console when binding missing', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    platformMetric(undefined, 'platform_jwt_verify_failure', 1, {
      class: 'product',
      reason: 'verify_failed',
    });
    expect(log).toHaveBeenCalledWith(
      '[PLATFORM_METRIC platform_jwt_verify_failure]',
      expect.stringContaining('verify_failed')
    );
    log.mockRestore();
  });
});
