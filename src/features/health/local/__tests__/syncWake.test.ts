/**
 * `POST /v2/households/:id/sync-wake` — the client half of plan §2 item 4c.
 *
 * The route REQUIRES `sourceDeviceId` for Health and answers 400
 * `source_device_required` without it, because Health's brand policy excludes
 * peers by device only. The two things this suite pins are therefore the two
 * things that turn a working wake into a push loop or a dead letter: the source
 * device id, and the header the Worker's Health gate keys on.
 */
import { apiClient } from '@api/client';

import {
  SYNC_WAKE_SOURCE_DEVICE_REQUIRED,
  healthSyncWakePath,
  requestHealthSyncWake,
} from '../sync/syncWake';

jest.mock('@api/client', () => ({
  apiClient: { post: jest.fn(async () => ({ data: { wake: { sent: 1 } } })) },
}));

const mockEngineState = {
  open: true,
  householdId: 'hh_health_personal',
  deviceId: 'dev-a',
};

// NOT `{ virtual: true }`. `../engine` is a real module (engine.ts exports all
// three of these). Of the 7 suites in this directory that mock the engine, this
// one and `ledgerRefresh.test.ts` were the only two that declared it virtual —
// and they were the only two that flaked.
// A virtual mock is registered under the specifier while `requestHealthSyncWake`
// resolves the real file, so whether the mock won depended on resolver-cache
// state shared across workers: green serially, ~50% at --maxWorkers=4. When it
// lost, the real `isLocalHealthSessionOpen()` ran, returned false, and
// `requestHealthSyncWake` short-circuited at sync/syncWake.ts:50 without ever
// calling `post` — surfacing as `expected true, received false`.
jest.mock('../engine', () => ({
  isLocalHealthSessionOpen: () => mockEngineState.open,
  getLocalHealthHouseholdKeys: () => ({
    householdId: mockEngineState.householdId,
    keyEpoch: 1,
    hdk: new Uint8Array(32),
  }),
  getLocalHealthIdentity: () => ({ deviceId: mockEngineState.deviceId }),
}));

const post = apiClient.post as jest.Mock;

beforeEach(() => {
  post.mockClear();
  post.mockResolvedValue({ data: { wake: { sent: 1 } } });
  mockEngineState.open = true;
  mockEngineState.householdId = 'hh_health_personal';
  mockEngineState.deviceId = 'dev-a';
  process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST = '1';
});

afterAll(() => {
  delete process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST;
});

describe('requestHealthSyncWake', () => {
  it('always sends sourceDeviceId — the only thing standing between a wake and a self-wake loop', async () => {
    expect(await requestHealthSyncWake()).toBe(true);

    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.mock.calls[0]!;
    expect(path).toBe('/v2/households/hh_health_personal/sync-wake');
    expect(body).toEqual({ sourceDeviceId: 'dev-a' });
  });

  it('carries X-Health-Local-First on the /v2 call', async () => {
    await requestHealthSyncWake();
    const [, , config] = post.mock.calls[0]!;
    expect(config.headers).toEqual({ 'X-Health-Local-First': '1' });
  });

  it('refuses to send a wake it cannot scope to a source device', async () => {
    // The Worker would answer 400 `source_device_required`; refusing one hop
    // earlier costs no round trip and cannot be mistaken for a delivered wake.
    mockEngineState.deviceId = '';
    expect(await requestHealthSyncWake()).toBe(false);
    expect(post).not.toHaveBeenCalled();
    expect(SYNC_WAKE_SOURCE_DEVICE_REQUIRED).toBe('source_device_required');
  });

  it('does nothing when no local session is open', async () => {
    mockEngineState.open = false;
    expect(await requestHealthSyncWake()).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('never throws — a failed wake must not fail the sync that scheduled it', async () => {
    post.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
    await expect(requestHealthSyncWake()).resolves.toBe(false);
  });

  it('addresses the personal household id it is given', () => {
    expect(healthSyncWakePath('hh_x')).toBe('/v2/households/hh_x/sync-wake');
  });
});
