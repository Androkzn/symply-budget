/**
 * Unit coverage for the disconnection-detection predicate that drives the
 * global watcher, the manage-screen banner, and the reconnect flow. Getting the
 * healthy/unhealthy split right is what decides whether the user is (correctly)
 * nagged to reconnect — so it's locked here.
 */

import { isUnhealthyStatus } from '../useAIConnectionHealth';

describe('isUnhealthyStatus', () => {
  it.each(['active', 'valid', 'validated', 'VALID', 'Active'])(
    'treats %s as healthy',
    (status) => {
      expect(isUnhealthyStatus(status)).toBe(false);
    }
  );

  it.each(['invalid', 'expired', 'revoked', 'error', 'needs_reauth', 'failed', 'INVALID'])(
    'treats %s as disconnected',
    (status) => {
      expect(isUnhealthyStatus(status)).toBe(true);
    }
  );

  it('is not tripped by the "valid" substring inside "invalid"', () => {
    expect(isUnhealthyStatus('invalid')).toBe(true);
  });

  it('treats missing/empty status as healthy (nothing to alarm on)', () => {
    expect(isUnhealthyStatus(null)).toBe(false);
    expect(isUnhealthyStatus(undefined)).toBe(false);
    expect(isUnhealthyStatus('')).toBe(false);
  });
});
