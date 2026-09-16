/**
 * He9 — durability status (`durability.ts`, plan §10 / §17 abort row).
 *
 * §17 permits, while §16 Q8 is open: *"Ship no restore claim; ≥2-device
 * durability copy only"*. This suite is what makes "≥2-device" a claim the app
 * can actually stand behind — it asserts that the reported device count,
 * checkpoint state and last-sync time come from the **real** control plane
 * responses, and that every one of them collapses to "unknown" rather than to a
 * comforting default when the network is not there.
 *
 * WHY THE HTTP CLIENT IS THE MOCK BOUNDARY, NOT `controlPlaneClient`
 * ------------------------------------------------------------------
 * Mocking `../controlPlaneClient` would let this suite pass against a status
 * function wired to the wrong endpoint, to a response field that does not exist,
 * or to a `devices` array that was never filtered on `status`. Mocking
 * `@api/client` instead means the real client parses the real response shapes —
 * including `fetchLatestHealthCheckpoint`'s 404 → `null`, which is the
 * difference between "no checkpoint yet" and "could not tell", and those two are
 * rendered with different copy.
 *
 * The engine is real and a session is genuinely open, because `sessionOpen`
 * gating the whole report is one of the things under test.
 *
 * Static imports only: `await import()` throws under this Jest config.
 */
const mockApiGet = jest.fn<Promise<{ data: unknown }>, unknown[]>();

jest.mock('@api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

import { HealthSecondUserRefusedError } from '../controlPlaneClient';
import {
  getHealthDurabilityStatus,
  healthDurabilityCopyFor,
  healthDurabilityLevelOf,
  HEALTH_DURABILITY_COPY,
} from '../durability';
import {
  closeLocalHealthSession,
  getLocalHealthDeviceId,
  openLocalHealthSessionForTests,
} from '../engine';
import { useHealthSyncStatusStore } from '../sync/syncStatusStore';

const USER = 'user_health_durability';
const HOUSEHOLD = 'hh_health_durability';

type DeviceRow = {
  deviceId: string;
  userId: string;
  signingPublicKey: string;
  agreementPublicKey: string;
  status: string;
};

function device(deviceId: string, status = 'active'): DeviceRow {
  return {
    deviceId,
    userId: USER,
    signingPublicKey: 'aa',
    agreementPublicKey: 'bb',
    status,
  };
}

/** An axios-shaped rejection — what `fetchLatestHealthCheckpoint` reads for its 404. */
function httpError(status: number): unknown {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status, data: {} } });
}

/**
 * Route the two GETs this module makes. Anything else is a wiring mistake and
 * should reject loudly rather than resolve to `{}`.
 */
function routeGets(options: {
  devices?: DeviceRow[];
  members?: Array<{ userId: string; role: string; status: string }>;
  stateError?: unknown;
  checkpoint?: { generation: number; expiresAt: string } | null;
  checkpointError?: unknown;
}): void {
  mockApiGet.mockImplementation(async (...args: unknown[]) => {
    const url = String(args[0]);
    if (url.endsWith('/state')) {
      if (options.stateError) throw options.stateError;
      return {
        data: {
          state: {
            householdId: HOUSEHOLD,
            keyEpoch: 1,
            securityRevision: 1,
            members: options.members ?? [{ userId: USER, role: 'OWNER', status: 'active' }],
            devices: options.devices ?? [],
          },
        },
      };
    }
    if (url.endsWith('/checkpoints/latest')) {
      if (options.checkpointError) throw options.checkpointError;
      if (!options.checkpoint) throw httpError(404);
      return {
        data: {
          generation: options.checkpoint.generation,
          chunkCount: 1,
          expiresAt: options.checkpoint.expiresAt,
          manifest: {},
        },
      };
    }
    throw new Error(`unexpected GET ${url}`);
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  useHealthSyncStatusStore.getState().reset();
  await openLocalHealthSessionForTests({ userId: USER, householdId: HOUSEHOLD });
});

afterEach(async () => {
  await closeLocalHealthSession();
  useHealthSyncStatusStore.getState().reset();
});

describe('the real device and checkpoint state', () => {
  it('reports one enrolled device and no published checkpoint', async () => {
    routeGets({ devices: [device(getLocalHealthDeviceId())], checkpoint: null });

    const status = await getHealthDurabilityStatus();

    expect(status.sessionOpen).toBe(true);
    expect(status.controlPlaneReachable).toBe(true);
    expect(status.thisDeviceId).toBe(getLocalHealthDeviceId());
    expect(status.enrolledDeviceCount).toBe(1);
    expect(status.otherDeviceCount).toBe(0);
    // A 404 is a FACT — "nothing published yet" — not a failure to read.
    expect(status.checkpointPublished).toBe(false);
    expect(status.checkpointGeneration).toBeNull();
    expect(status.level).toBe('this-device-only');
  });

  it('reports the second device and the published checkpoint', async () => {
    routeGets({
      devices: [device(getLocalHealthDeviceId()), device('dev_the_other_one')],
      checkpoint: { generation: 4, expiresAt: '2026-11-12T00:00:00.000Z' },
    });

    const status = await getHealthDurabilityStatus();

    expect(status.enrolledDeviceCount).toBe(2);
    expect(status.otherDeviceCount).toBe(1);
    expect(status.checkpointPublished).toBe(true);
    expect(status.checkpointGeneration).toBe(4);
    expect(status.checkpointExpiresAt).toBe('2026-11-12T00:00:00.000Z');
    expect(status.level).toBe('more-than-one-device');
  });

  it('does not count a revoked device as durability', async () => {
    routeGets({
      devices: [device(getLocalHealthDeviceId()), device('dev_lost_phone', 'revoked')],
      checkpoint: { generation: 4, expiresAt: '2026-11-12T00:00:00.000Z' },
    });

    const status = await getHealthDurabilityStatus();

    // The revoked row is very often the device whose loss caused the
    // revocation. Counting it would report durability that is exactly gone.
    expect(status.enrolledDeviceCount).toBe(1);
    expect(status.level).toBe('this-device-only');
  });

  it('asks the personal household, and asks it once per report', async () => {
    routeGets({ devices: [device(getLocalHealthDeviceId())], checkpoint: null });

    await getHealthDurabilityStatus();

    const urls = mockApiGet.mock.calls.map((call) => String(call[0]));
    expect(urls).toEqual([
      `/v2/households/${HOUSEHOLD}/state`,
      `/v2/households/${HOUSEHOLD}/checkpoints/latest`,
    ]);
  });

  it('carries the last sync time through from the live sync status', async () => {
    useHealthSyncStatusStore.getState().setResult({ lastSyncedAt: 1_760_000_000_000 });
    routeGets({ devices: [device(getLocalHealthDeviceId())], checkpoint: null });

    const status = await getHealthDurabilityStatus();

    expect(status.lastSyncedAt).toBe(1_760_000_000_000);
  });
});

describe('truthfulness when the facts are not available', () => {
  it('reports unknown with no open ledger, and reads nothing', async () => {
    await closeLocalHealthSession();

    const status = await getHealthDurabilityStatus();

    expect(status.sessionOpen).toBe(false);
    expect(status.level).toBe('unknown');
    expect(status.enrolledDeviceCount).toBeNull();
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it('reports unknown — never "this device only" — when the control plane is unreachable', async () => {
    routeGets({ stateError: new Error('Network request failed') });

    const status = await getHealthDurabilityStatus();

    expect(status.controlPlaneReachable).toBe(false);
    expect(status.enrolledDeviceCount).toBeNull();
    expect(status.otherDeviceCount).toBeNull();
    expect(status.checkpointPublished).toBeNull();
    expect(status.level).toBe('unknown');
    // The alarming default would be just as wrong as the reassuring one.
    expect(healthDurabilityCopyFor(status)).toBe(HEALTH_DURABILITY_COPY.levels.unknown);
  });

  it('separates "no checkpoint" from "could not read the checkpoint"', async () => {
    routeGets({
      devices: [device(getLocalHealthDeviceId())],
      checkpointError: new Error('Network request failed'),
    });

    const status = await getHealthDurabilityStatus();

    expect(status.controlPlaneReachable).toBe(true);
    expect(status.enrolledDeviceCount).toBe(1);
    expect(status.checkpointPublished).toBeNull();
  });

  it('lets a second-user refusal through instead of hiding it behind "offline"', async () => {
    routeGets({
      members: [
        { userId: USER, role: 'OWNER', status: 'active' },
        { userId: 'user_someone_else', role: 'ADULT', status: 'active' },
      ],
    });

    await expect(getHealthDurabilityStatus()).rejects.toBeInstanceOf(HealthSecondUserRefusedError);
  });
});

describe('the level rule', () => {
  it('needs a second active device — a checkpoint alone is not durability', () => {
    // A checkpoint is ciphertext addressed to HDK holders. If this handset is
    // the only one alive, it is 90 days of unreadable bytes.
    expect(healthDurabilityLevelOf({ controlPlaneReachable: true, enrolledDeviceCount: 1 })).toBe(
      'this-device-only',
    );
    expect(healthDurabilityLevelOf({ controlPlaneReachable: true, enrolledDeviceCount: 2 })).toBe(
      'more-than-one-device',
    );
    expect(healthDurabilityLevelOf({ controlPlaneReachable: false, enrolledDeviceCount: 9 })).toBe(
      'unknown',
    );
    expect(
      healthDurabilityLevelOf({ controlPlaneReachable: true, enrolledDeviceCount: null }),
    ).toBe('unknown');
  });

  it('has exactly one copy entry per level', () => {
    for (const level of ['unknown', 'this-device-only', 'more-than-one-device'] as const) {
      const copy = healthDurabilityCopyFor({ level });
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.message.length).toBeGreaterThan(0);
    }
  });
});
