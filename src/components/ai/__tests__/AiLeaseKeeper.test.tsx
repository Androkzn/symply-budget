/**
 * AiLeaseKeeper — the session-lease sweep that keeps background AI alive.
 *
 * On mount and on every foreground it re-leases any connected BYOK provider
 * whose server lease is within the 2-day refresh window, reading the durable key
 * from the device Keychain. It skips providers with no expiry (permanent legacy
 * keys), leases that are still far from expiring, and any provider whose key is
 * no longer on this device (the user must reconnect). It renders nothing.
 */
const mockCreateSessionLease = jest.fn<Promise<unknown>, [string, string]>();
const mockGetKey = jest.fn<Promise<string | null>, [string]>();
const mockInvalidate = jest.fn<Promise<void>, []>();

// A provider connection as AiLeaseKeeper reads it (only provider + leaseExpiresAt matter).
interface TestConn {
  provider: string;
  leaseExpiresAt: string | null;
}
const mockEntitlement: { byokConnections: TestConn[]; bringYourOwnAIEnabled: boolean; invalidate: jest.Mock } = {
  byokConnections: [],
  bringYourOwnAIEnabled: true,
  invalidate: mockInvalidate,
};

jest.mock('@api/aiAccess', () => ({
  aiAccessApi: { createSessionLease: (...args: [string, string]) => mockCreateSessionLease(...args) },
}));

jest.mock('@services/aiKeyVault', () => ({
  aiKeyVault: { getKey: (provider: string) => mockGetKey(provider) },
}));

jest.mock('@hooks/useAIEntitlement', () => ({
  useAIEntitlement: () => mockEntitlement,
}));

import React from 'react';
import { AppState } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { AiLeaseKeeper } from '../AiLeaseKeeper';

const DAY = 24 * 60 * 60 * 1000;
const BASE_NOW = 1_770_000_000_000; // fixed epoch so lease math is deterministic

let now = BASE_NOW;
let appStateHandler: ((state: string) => void) | undefined;

const iso = (ms: number) => new Date(ms).toISOString();

const mount = async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<AiLeaseKeeper />);
  });
  // Flush the fire-and-forget sweep promise chain.
  await act(async () => {
    await Promise.resolve();
  });
  return renderer!;
};

describe('AiLeaseKeeper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    now = BASE_NOW;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    appStateHandler = undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => {
      appStateHandler = cb as (state: string) => void;
      return { remove: jest.fn() } as ReturnType<typeof AppState.addEventListener>;
    });
    mockEntitlement.byokConnections = [];
    mockEntitlement.bringYourOwnAIEnabled = true;
    mockGetKey.mockResolvedValue('sk-key');
    mockCreateSessionLease.mockResolvedValue(undefined);
    mockInvalidate.mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('re-leases only providers whose lease is expiring soon and whose key is on device', async () => {
    mockEntitlement.byokConnections = [
      { provider: 'anthropic', leaseExpiresAt: iso(now + 1 * DAY) }, // within 2-day window → refresh
      { provider: 'openai', leaseExpiresAt: iso(now + 10 * DAY) }, // far off → skip
      { provider: 'gemini', leaseExpiresAt: null }, // permanent key → skip
    ];

    await mount();

    expect(mockCreateSessionLease).toHaveBeenCalledTimes(1);
    expect(mockCreateSessionLease).toHaveBeenCalledWith('anthropic', 'sk-key');
    // A successful refresh invalidates the entitlement cache exactly once.
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
  });

  it('skips a provider whose key is no longer on the device (no lease, no invalidate)', async () => {
    mockEntitlement.byokConnections = [{ provider: 'anthropic', leaseExpiresAt: iso(now + 1 * DAY) }];
    mockGetKey.mockResolvedValue(null);

    await mount();

    expect(mockCreateSessionLease).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  it('ignores an unparseable lease expiry', async () => {
    mockEntitlement.byokConnections = [{ provider: 'anthropic', leaseExpiresAt: 'not-a-date' }];

    await mount();

    expect(mockGetKey).not.toHaveBeenCalled();
    expect(mockCreateSessionLease).not.toHaveBeenCalled();
  });

  it('does nothing when BYOK is disabled', async () => {
    mockEntitlement.bringYourOwnAIEnabled = false;
    mockEntitlement.byokConnections = [{ provider: 'anthropic', leaseExpiresAt: iso(now + 1 * DAY) }];

    await mount();

    expect(mockGetKey).not.toHaveBeenCalled();
    expect(mockCreateSessionLease).not.toHaveBeenCalled();
  });

  it('re-runs the sweep when the app returns to the foreground (after the min-interval)', async () => {
    mockEntitlement.byokConnections = [{ provider: 'anthropic', leaseExpiresAt: iso(now + 1 * DAY) }];

    await mount();
    expect(mockCreateSessionLease).toHaveBeenCalledTimes(1);

    // A foreground within the 5-min churn guard is a no-op.
    await act(async () => {
      appStateHandler?.('active');
      await Promise.resolve();
    });
    expect(mockCreateSessionLease).toHaveBeenCalledTimes(1);

    // Past the guard, the next foreground re-sweeps.
    now = BASE_NOW + 6 * 60 * 1000;
    await act(async () => {
      appStateHandler?.('active');
      await Promise.resolve();
    });
    expect(mockCreateSessionLease).toHaveBeenCalledTimes(2);

    // A non-active transition never sweeps.
    now += 6 * 60 * 1000;
    await act(async () => {
      appStateHandler?.('background');
      await Promise.resolve();
    });
    expect(mockCreateSessionLease).toHaveBeenCalledTimes(2);
  });
});
