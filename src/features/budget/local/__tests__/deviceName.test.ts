/**
 * Trusted-device names (Budget → Device Sync).
 *
 * The list used to print `dev_652de89b0240` and `active · epoch 1`, which is
 * unreadable and un-actionable — you cannot decide whether to revoke a device
 * you cannot identify. Pinned here: the OS suggestion survives iOS 16's generic
 * `deviceName`, a rename round-trips, clearing it falls back to the suggestion,
 * and the row copy never leaks engine vocabulary.
 */
const mockDevice: { deviceName: string | null; modelName: string | null } = {
  deviceName: null,
  modelName: null,
};
// Getters, not the bare object: babel's interop copies a CJS module's own
// properties at import time, so a plain object would freeze whatever the first
// test set.
jest.mock('expo-device', () => ({
  __esModule: true,
  get deviceName() {
    return mockDevice.deviceName;
  },
  get modelName() {
    return mockDevice.modelName;
  },
}));

const mockStore = new Map<string, string>();
jest.mock('@services/storage', () => ({
  __esModule: true,
  storageHelpers: {
    getString: jest.fn(async (key: string) => mockStore.get(key)),
    setString: jest.fn(async (key: string, value: string) => {
      mockStore.set(key, value);
    }),
  },
}));

import {
  BUDGET_DEVICE_NAME_KEY,
  DEVICE_NAME_MAX_LENGTH,
  DEVICE_STALE_AFTER_MS,
  describeDevice,
  deviceLiveness,
  getLocalDeviceName,
  normalizeDeviceName,
  setLocalDeviceName,
  shortDeviceId,
  suggestDeviceName,
} from '../deviceName';

beforeEach(() => {
  mockStore.clear();
  mockDevice.deviceName = null;
  mockDevice.modelName = null;
});

describe('suggestDeviceName', () => {
  it('uses the name the owner gave the phone', () => {
    mockDevice.deviceName = "Andrei's iPhone";
    mockDevice.modelName = 'iPhone 15 Pro';
    expect(suggestDeviceName()).toBe("Andrei's iPhone");
  });

  it('falls through to the model when iOS 16 hands back a generic name', () => {
    // No entitlement: UIDevice.name degrades to "iPhone", a prefix of the model.
    mockDevice.deviceName = 'iPhone';
    mockDevice.modelName = 'iPhone 15 Pro';
    expect(suggestDeviceName()).toBe('iPhone 15 Pro');
  });

  it('never returns an empty name, whatever the OS reports', () => {
    expect(suggestDeviceName().length).toBeGreaterThan(0);
  });
});

describe('normalizeDeviceName', () => {
  it('trims, collapses whitespace and clamps to what one row fits', () => {
    expect(normalizeDeviceName('  Kate’s   iPhone  ')).toBe('Kate’s iPhone');
    expect(normalizeDeviceName('x'.repeat(200))).toHaveLength(DEVICE_NAME_MAX_LENGTH);
    expect(normalizeDeviceName(null)).toBe('');
  });
});

describe('the stored name', () => {
  it('round-trips a rename and wins over the OS suggestion', async () => {
    mockDevice.modelName = 'iPhone 15 Pro';
    await expect(setLocalDeviceName('  Kitchen iPad ')).resolves.toBe('Kitchen iPad');
    expect(mockStore.get(BUDGET_DEVICE_NAME_KEY)).toBe('Kitchen iPad');
    await expect(getLocalDeviceName()).resolves.toBe('Kitchen iPad');
  });

  it('clears back to the OS suggestion when saved empty', async () => {
    mockDevice.modelName = 'iPhone 15 Pro';
    await setLocalDeviceName('Kitchen iPad');
    await expect(setLocalDeviceName('   ')).resolves.toBe('iPhone 15 Pro');
    await expect(getLocalDeviceName()).resolves.toBe('iPhone 15 Pro');
  });
});

describe('describeDevice', () => {
  it('marks this device and never offers its opaque id', () => {
    const row = describeDevice({
      deviceId: 'dev_652de89b0240',
      isSelf: true,
      status: 'active',
      localName: "Andrei's iPhone",
    });
    expect(row.name).toBe("Andrei's iPhone");
    expect(row.meta).toBe('This device · Active');
  });

  /**
   * `now` is pinned deliberately. This case is about the NAME and the "added"
   * suffix, but the row also reports liveness, and liveness falls back to the
   * enrolment date — so against the real clock the fixture silently aged past
   * the staleness window and the row flipped to "Not syncing". It passed for
   * six days and failed on the seventh, which is the worst kind of test.
   */
  it('reads a peer as a name plus when it joined', () => {
    const row = describeDevice({
      label: 'Kate’s iPhone',
      deviceId: 'dev_9f21',
      isSelf: false,
      status: 'active',
      enrolledAt: '2026-08-12T10:00:00.000Z',
      now: Date.parse('2026-08-13T10:00:00.000Z'),
    });
    expect(row.name).toBe('Kate’s iPhone');
    expect(row.meta).toMatch(/^Active · added /);
    expect(row.meta).not.toMatch(/epoch|dev_/);
  });

  it('shows the short id only for a device nobody named, to tell two apart', () => {
    const row = describeDevice({ deviceId: 'dev_652de89b0240', isSelf: false, status: 'active' });
    expect(row.name).toBe('Unnamed device');
    expect(row.meta).toContain('ID 9b0240');
  });

  it('says a revoked device lost access, not "revoked · epoch 2"', () => {
    const row = describeDevice({
      label: 'Old phone',
      deviceId: 'dev_1',
      isSelf: false,
      status: 'revoked',
    });
    expect(row.meta).toContain('No longer has access');
  });
});

describe('shortDeviceId', () => {
  it('drops the prefix and keeps the distinguishing tail', () => {
    expect(shortDeviceId('dev_652de89b0240')).toBe('9b0240');
    expect(shortDeviceId('abc')).toBe('abc');
  });
});

/**
 * A device record carried no evidence of life: `status` stayed 'active' from
 * enrolment until somebody revoked it, so a wiped or abandoned phone sat in the
 * trusted list labelled "Active", indistinguishable from one syncing every few
 * seconds. Members were shown ghosts and given no way to tell.
 */
describe('device liveness', () => {
  const NOW = Date.parse('2026-08-18T12:00:00.000Z');
  const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

  it('reads a recent sync as live', () => {
    expect(deviceLiveness(daysAgo(1), null, NOW)).toBe('live');
  });

  it('reads a long silence as stale', () => {
    expect(deviceLiveness(daysAgo(30), null, NOW)).toBe('stale');
  });

  /** Generous on purpose — a phone left in a drawer over a holiday is not a ghost. */
  it('still counts a week-old phone as live right up to the boundary', () => {
    expect(
      deviceLiveness(new Date(NOW - DEVICE_STALE_AFTER_MS + 1000).toISOString(), null, NOW),
    ).toBe('live');
    expect(deviceLiveness(new Date(NOW - DEVICE_STALE_AFTER_MS).toISOString(), null, NOW)).toBe(
      'stale',
    );
  });

  it('treats a stamp it cannot read at all as unknown', () => {
    expect(deviceLiveness(null, null, NOW)).toBe('unknown');
    expect(deviceLiveness(undefined, undefined, NOW)).toBe('unknown');
    expect(deviceLiveness('not-a-date', null, NOW)).toBe('unknown');
  });

  /**
   * The correction that made the feature work at all. Treating "no stamp" as
   * unknown, and rendering unknown as "Active", meant a ghost — which never
   * syncs and so never earns a stamp — stayed "Active" for ever. The only
   * devices the field could not speak for were the ones it exists to find.
   */
  it('falls back to enrolment: never seen since joining long ago is stale', () => {
    expect(deviceLiveness(null, daysAgo(30), NOW)).toBe('stale');
  });

  it('does not call a freshly enrolled device stale before its window is up', () => {
    expect(deviceLiveness(null, daysAgo(1), NOW)).toBe('live');
  });

  it('prefers an actual sync stamp over enrolment', () => {
    // Enrolled long ago but syncing yesterday — plainly alive.
    expect(deviceLiveness(daysAgo(1), daysAgo(300), NOW)).toBe('live');
  });

  it('stops calling a silent device Active in the row copy', () => {
    const { meta } = describeDevice({
      deviceId: 'dev_abc123',
      isSelf: false,
      status: 'active',
      lastSeenAt: daysAgo(30),
      label: 'Old phone',
      now: NOW,
    });

    expect(meta).toContain('Not syncing');
    expect(meta).not.toContain('Active');
  });

  it('leaves a live device reading as Active', () => {
    const { meta } = describeDevice({
      deviceId: 'dev_abc123',
      isSelf: false,
      status: 'active',
      lastSeenAt: daysAgo(1),
      label: 'Live phone',
      now: NOW,
    });

    expect(meta).toContain('Active');
    expect(meta).not.toContain('Not syncing');
  });

  /**
   * The phone in the member's hand is self-evidently reaching the household —
   * its own stamp lands a poll later than the render, and trusting the field
   * here flashed "Not syncing" on the one row that cannot be a ghost.
   */
  it('never calls the member’s own phone stale', () => {
    const { meta } = describeDevice({
      deviceId: 'dev_self',
      isSelf: true,
      status: 'active',
      lastSeenAt: daysAgo(400),
      localName: 'Mine',
      now: NOW,
    });

    expect(meta).toContain('Active');
    expect(meta).not.toContain('Not syncing');
  });

  it('keeps a revoked device reading as revoked, not merely silent', () => {
    const { meta } = describeDevice({
      deviceId: 'dev_gone',
      isSelf: false,
      status: 'revoked',
      lastSeenAt: daysAgo(30),
      label: 'Gone',
      now: NOW,
    });

    expect(meta).toContain('No longer has access');
    expect(meta).not.toContain('Not syncing');
  });
});
