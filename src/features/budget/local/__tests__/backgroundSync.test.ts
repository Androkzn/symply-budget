import NetInfo from '@react-native-community/netinfo';

import { loadProductTokens } from '@services/secure-token-storage';
import { useAuthStore } from '@stores/authStore';

import { runBudgetBackgroundSync } from '../backgroundSync';
import { getLocalBudgetSession, isLocalBudgetSessionOpen, openLocalBudgetSession } from '../engine';
import { loadDbKeyHex } from '../persistence';
import { runBudgetLocalSyncFor } from '../sync/orchestrator';

jest.mock('@react-native-community/netinfo', () => ({ fetch: jest.fn(async () => ({ isConnected: true })) }));
jest.mock('@services/secure-token-storage', () => ({ loadProductTokens: jest.fn() }));
jest.mock('@stores/authStore', () => ({ useAuthStore: { getState: jest.fn(), setState: jest.fn(), persist: { hasHydrated: () => true, rehydrate: jest.fn() } } }));
jest.mock('../flag', () => ({ isBudgetLocalFirst: () => true }));
jest.mock('../persistence', () => ({ loadDbKeyHex: jest.fn(async () => 'device-key') }));
jest.mock('../engine', () => ({
  getLocalBudgetSession: jest.fn(), isLocalBudgetSessionOpen: jest.fn(() => true),
  listLocalBudgetHouseholds: () => [{ householdId: 'a' }, { householdId: 'b' }],
  openLocalBudgetSession: jest.fn(),
}));
jest.mock('../sync/orchestrator', () => ({ runBudgetLocalSyncFor: jest.fn(async () => undefined) }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(isLocalBudgetSessionOpen).mockReturnValue(true);
  jest.mocked(useAuthStore.getState).mockReturnValue({ isAuthenticated: true, user: { id: 'member' }, token: 'access', refreshToken: 'refresh' } as ReturnType<typeof useAuthStore.getState>);
  jest.mocked(getLocalBudgetSession).mockResolvedValue({ ledger: { memberId: 'member' }, store: { getVersionVector: async () => ({}) } } as unknown as Awaited<ReturnType<typeof getLocalBudgetSession>>);
});

it('syncs every local household when iOS schedules a periodic wake', async () => {
  expect(await runBudgetBackgroundSync()).toBe('no-data');
  expect(runBudgetLocalSyncFor).toHaveBeenNthCalledWith(1, 'a', 'background-wake');
  expect(runBudgetLocalSyncFor).toHaveBeenNthCalledWith(2, 'b', 'background-wake');
});

it('routes a push only to its named household and ignores unknown households', async () => {
  await runBudgetBackgroundSync('b');
  expect(runBudgetLocalSyncFor).toHaveBeenCalledTimes(1);
  expect(runBudgetLocalSyncFor).toHaveBeenCalledWith('b', 'background-wake');
  jest.mocked(runBudgetLocalSyncFor).mockClear();
  await runBudgetBackgroundSync('stranger');
  expect(runBudgetLocalSyncFor).not.toHaveBeenCalled();
});

it('does not clear the account or create a ledger when locked credentials are unavailable', async () => {
  jest.mocked(useAuthStore.getState).mockReturnValue({ isAuthenticated: true, user: { id: 'member' }, token: null, refreshToken: null } as ReturnType<typeof useAuthStore.getState>);
  jest.mocked(loadProductTokens).mockResolvedValue({ accessToken: null, refreshToken: null, expiresAt: null });
  expect(await runBudgetBackgroundSync()).toBe('no-data');
  expect(useAuthStore.setState).not.toHaveBeenCalled();
  expect(openLocalBudgetSession).not.toHaveBeenCalled();
});

it('never opens a new ledger when no accessible database key exists', async () => {
  jest.mocked(isLocalBudgetSessionOpen).mockReturnValue(false);
  jest.mocked(loadDbKeyHex).mockResolvedValueOnce(null);
  expect(await runBudgetBackgroundSync()).toBe('no-data');
  expect(openLocalBudgetSession).not.toHaveBeenCalled();
});

it('does not sync ledgers belonging to a different signed-in account', async () => {
  jest.mocked(getLocalBudgetSession).mockResolvedValue({ ledger: { memberId: 'other-member' } } as Awaited<ReturnType<typeof getLocalBudgetSession>>);
  await runBudgetBackgroundSync();
  expect(runBudgetLocalSyncFor).not.toHaveBeenCalled();
});

it('defers without losing state when offline', async () => {
  jest.mocked(NetInfo.fetch).mockResolvedValueOnce({ isConnected: false } as Awaited<ReturnType<typeof NetInfo.fetch>>);
  expect(await runBudgetBackgroundSync()).toBe('no-data');
  expect(runBudgetLocalSyncFor).not.toHaveBeenCalled();
});


it('continues a wake when the connectivity callback never arrives', async () => {
  jest.useFakeTimers();
  try {
    jest.mocked(NetInfo.fetch).mockReturnValueOnce(new Promise(() => {}));
    const run = runBudgetBackgroundSync('a');
    await jest.advanceTimersByTimeAsync(1500);
    expect(await run).toBe('no-data');
    expect(runBudgetLocalSyncFor).toHaveBeenCalledWith('a', 'background-wake');
  } finally {
    jest.useRealTimers();
  }
});
