jest.mock('@api/client', () => ({ apiClient: { post: jest.fn() } }));
jest.mock('../../engine', () => ({ getLocalBudgetSession: jest.fn() }));

import { apiClient } from '@api/client';

import { getLocalBudgetSession } from '../../engine';
import { requestRecoveryWake } from '../recoveryWake';

let awaiting: boolean;
const meta = new Map<string, string>();
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-09-10T22:00:00Z'));
  meta.clear();
  awaiting = true;
  jest.clearAllMocks();
  (getLocalBudgetSession as jest.Mock).mockImplementation(async () => ({
    awaitingEnrolment: awaiting, identity: { deviceId: 'new-phone' },
    store: { getMeta: async (key: string) => meta.get(key), setMeta: async (key: string, value: string) => { meta.set(key, value); } },
  }));
  (apiClient.post as jest.Mock).mockResolvedValue({ data: { wake: { attempted: 1, sent: 1 } } });
});
afterEach(() => jest.useRealTimers());
it('wakes the named household, excluding this device, and throttles subsequent polling', async () => {
  await requestRecoveryWake('hh');
  await requestRecoveryWake('hh');
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  expect(apiClient.post).toHaveBeenCalledWith('/v2/households/hh/sync-wake', { sourceDeviceId: 'new-phone' }, expect.anything());
  jest.advanceTimersByTime(15 * 60_000);
  await requestRecoveryWake('hh');
  expect(apiClient.post).toHaveBeenCalledTimes(2);
});
it('does not wake peers once the key has arrived', async () => {
  awaiting = false;
  await requestRecoveryWake('hh');
  expect(apiClient.post).not.toHaveBeenCalled();
});
it('retries a network failure after one minute, without an immediate loop', async () => {
  (apiClient.post as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  await requestRecoveryWake('hh');
  await requestRecoveryWake('hh');
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(60_000);
  await requestRecoveryWake('hh');
  expect(apiClient.post).toHaveBeenCalledTimes(2);
});
it('keeps household retry markers independent', async () => {
  await requestRecoveryWake('one');
  await requestRecoveryWake('two');
  expect(apiClient.post).toHaveBeenCalledTimes(2);
});
