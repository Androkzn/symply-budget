/**
 * He5 — the personal household's control-plane contract (plan §1.2 / §6).
 *
 * Three things are pinned here and each of them is a shipped bug elsewhere in
 * the fleet if it drifts:
 *
 *  1. **The enrolment link carries `simplehealth://`.** The shared Worker
 *     hardcodes `symply-budget://lf-invite?...` in its invite response
 *     (`backend/src/routes/local-first-v2.ts:535`), so a client that consumes
 *     `invite.qrPayload` hands Health users a link into Symply Budget. House
 *     pins the same assertion for its own scheme
 *     (`house/local/__tests__/syncClient.test.ts:29`).
 *  2. **A second `user_id` is refused.** Once `excludeUserId` is dropped from
 *     the Worker's peer query for Health (plan §2 item 4c — it matches zero rows
 *     in a one-user household and kills the push wake), this refusal is the
 *     compensating control. DoD He0, re-asserted He5.
 *  3. **No invite-a-member surface exists.** Health has one user with N devices.
 *     A screen that offers to invite a person is describing a different product,
 *     and the copy is the only thing standing between the two.
 */
const mockApiGet = jest.fn();
const mockApiPost = jest.fn();
const mockApiPut = jest.fn();
const mockApiDelete = jest.fn();

const mockOpenLocalHealthSession = jest.fn<Promise<unknown>, [unknown]>();
const mockResetLocalHealthSession = jest.fn<Promise<void>, []>();
const mockIsLocalHealthSessionOpen = jest.fn<boolean, []>();

const LEDGER: Record<string, unknown> = {
  version: 1,
  household: { id: 'hh_local_health', userId: 'user-1', createdAt: '2026-01-01T00:00:00.000Z' },
  deviceId: 'dev_a',
  weightEntries: [],
  waterEntries: [],
  nutritionEntries: [],
  healthEntries: [],
  bodyMeasurements: [],
  userHabits: [],
  habitLogs: [],
  healthGoals: [],
};

jest.mock('@api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    put: (...args: unknown[]) => mockApiPut(...args),
    delete: (...args: unknown[]) => mockApiDelete(...args),
  },
}));

jest.mock('../engine', () => ({
  getLocalHealthLedger: () => LEDGER,
  getLocalHealthIdentity: () => ({
    signingPublicKey: new Uint8Array([0xaa, 0xbb]),
    agreementPublicKey: new Uint8Array([0xcc, 0xdd]),
  }),
  isLocalHealthSessionOpen: () => mockIsLocalHealthSessionOpen(),
  openLocalHealthSession: (input: unknown) => mockOpenLocalHealthSession(input),
  resetLocalHealthSession: () => mockResetLocalHealthSession(),
}));

import * as controlPlane from '../controlPlaneClient';
import {
  HEALTH_ENROLMENT_COPY,
  HEALTH_ENROLMENT_LINK_SCHEME,
  HEALTH_LOCAL_FIRST_HEADERS,
  HealthSecondUserRefusedError,
  approveHealthDeviceEnrolment,
  assertHealthPersonalHousehold,
  buildHealthEnrolmentLink,
  createHealthDeviceEnrolment,
  enrolThisDeviceInHealthHousehold,
  fetchHealthControlPlaneState,
  parseHealthEnrolmentInput,
  syncLocalHealthHouseholdToControlPlane,
  type ControlPlaneHealthState,
} from '../controlPlaneClient';

/** An axios-shaped rejection. */
function httpError(status: number, code: string, message: string): unknown {
  return Object.assign(new Error(message), {
    response: { status, data: { error: { code, message } } },
  });
}

function stateWith(members: ControlPlaneHealthState['members']): ControlPlaneHealthState {
  return {
    householdId: 'hh_local_health',
    keyEpoch: 1,
    securityRevision: 1,
    members,
    devices: [],
  };
}

const savedFlag = process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST = '1';
  mockIsLocalHealthSessionOpen.mockReturnValue(true);
  mockOpenLocalHealthSession.mockResolvedValue(LEDGER);
  mockResetLocalHealthSession.mockResolvedValue(undefined);
  mockApiGet.mockResolvedValue({ data: {} });
  mockApiPost.mockResolvedValue({ data: {} });
  mockApiPut.mockResolvedValue({ data: {} });
  mockApiDelete.mockResolvedValue({ data: {} });
});

afterAll(() => {
  if (savedFlag === undefined) delete process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST;
  else process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST = savedFlag;
});

describe('the enrolment link uses the brand scheme that actually exists', () => {
  it('builds simplehealth://lf-invite — not symply-budget://, not symply-health://', () => {
    // `brands/symply-health/brand.cjs:9` declares `scheme: 'simplehealth'`.
    expect(HEALTH_ENROLMENT_LINK_SCHEME).toBe('simplehealth');

    const link = buildHealthEnrolmentLink({
      inviteId: 'inv_1',
      shortCode: 'ABC123',
      secret: 'sekret',
    });

    expect(link.startsWith('simplehealth://lf-invite?')).toBe(true);
    // The Worker's scheme. Shipping it would open Symply Budget, or nothing.
    expect(link).not.toContain('symply-budget://');
    // The code id is not a URL scheme — this one opens nothing at all.
    expect(link).not.toContain('symply-health://');
  });

  it('ignores the qrPayload the Worker returns', async () => {
    mockApiPost.mockResolvedValueOnce({
      data: {
        invite: {
          inviteId: 'inv_1',
          shortCode: 'ABC123',
          secret: 'sekret',
          expiresAt: '2026-01-02T00:00:00.000Z',
          qrPayload: 'symply-budget://lf-invite?id=inv_1&secret=sekret&code=ABC123',
        },
      },
    });

    const created = await createHealthDeviceEnrolment();

    expect(created.enrolmentLink.startsWith('simplehealth://lf-invite?')).toBe(true);
    expect(JSON.stringify(created)).not.toContain('symply-budget');
    expect(created).not.toHaveProperty('qrPayload');
  });

  it('round-trips its own link back through the parser', () => {
    const link = buildHealthEnrolmentLink({
      inviteId: 'inv_1',
      shortCode: 'ABC123',
      secret: 'sekret-value',
    });
    expect(parseHealthEnrolmentInput(link)).toEqual({
      shortCode: 'ABC123',
      secret: 'sekret-value',
    });
  });

  it('accepts what someone might actually paste or scan', () => {
    expect(parseHealthEnrolmentInput('ABC123 sekret')).toEqual({
      shortCode: 'ABC123',
      secret: 'sekret',
    });
    expect(parseHealthEnrolmentInput('abc123')).toEqual({ shortCode: 'ABC123', secret: null });
    expect(parseHealthEnrolmentInput('   ')).toEqual({ shortCode: null, secret: null });
  });
});

describe('every /v2 call arms the 410 gate', () => {
  it('sends X-Health-Local-First: 1', async () => {
    expect(HEALTH_LOCAL_FIRST_HEADERS).toEqual({ 'X-Health-Local-First': '1' });

    mockApiPost.mockResolvedValue({
      data: {
        invite: {
          inviteId: 'inv_1',
          shortCode: 'ABC123',
          secret: 'sekret',
          expiresAt: '2026-01-02T00:00:00.000Z',
        },
      },
    });
    mockApiGet.mockResolvedValue({ data: { state: stateWith([]) } });

    await syncLocalHealthHouseholdToControlPlane();
    await createHealthDeviceEnrolment();
    await fetchHealthControlPlaneState('hh_local_health');
    await controlPlane.listControlPlaneHealthHouseholds();
    await controlPlane.ackHealthMailboxBlobs(['blob_1']);
    await controlPlane.revokeHealthLocalFirstDevice('dev_b');

    const configs = [
      ...mockApiGet.mock.calls.map((call) => call[1]),
      ...mockApiPost.mock.calls.map((call) => call[2]),
      ...mockApiDelete.mock.calls.map((call) => call[1]),
    ];
    expect(configs.length).toBeGreaterThan(0);
    for (const config of configs) {
      expect((config as { headers?: Record<string, string> })?.headers).toMatchObject({
        'X-Health-Local-First': '1',
      });
    }
  });

  it('registers a device against the household it already has, never a new one', async () => {
    mockApiPost.mockRejectedValueOnce(httpError(409, 'conflict', 'Household already exists'));
    await syncLocalHealthHouseholdToControlPlane();

    const urls = mockApiPost.mock.calls.map(([url]) => String(url));
    // Mint-or-reuse: one POST /v2/households, then the device onto the SAME id.
    expect(urls).toEqual(['/v2/households', '/v2/households/hh_local_health/devices']);
    expect(mockApiPost.mock.calls[0]?.[1]).toMatchObject({ householdId: 'hh_local_health' });
  });

  it('does nothing when the flag is off', async () => {
    process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST = '0';
    await syncLocalHealthHouseholdToControlPlane();
    expect(mockApiPost).not.toHaveBeenCalled();
  });
});

describe('a second user_id is refused', () => {
  it('fails closed when a fetched state shows two members', async () => {
    const two = stateWith([
      { userId: 'user-1', role: 'OWNER', status: 'active' },
      { userId: 'user-2', role: 'ADULT', status: 'active' },
    ]);
    expect(() => assertHealthPersonalHousehold(two)).toThrow(HealthSecondUserRefusedError);

    mockApiGet.mockResolvedValueOnce({ data: { state: two } });
    await expect(fetchHealthControlPlaneState('hh_local_health')).rejects.toBeInstanceOf(
      HealthSecondUserRefusedError,
    );
  });

  it('tolerates the one member it is supposed to have, and ignores revoked rows', () => {
    expect(() =>
      assertHealthPersonalHousehold(stateWith([{ userId: 'user-1', role: 'OWNER', status: 'active' }])),
    ).not.toThrow();
    expect(() =>
      assertHealthPersonalHousehold(
        stateWith([
          { userId: 'user-1', role: 'OWNER', status: 'active' },
          { userId: 'user-2', role: 'ADULT', status: 'revoked' },
        ]),
      ),
    ).not.toThrow();
  });

  it('surfaces the control plane 403 as a named error, not a raw axios failure', async () => {
    mockApiGet.mockResolvedValueOnce({
      data: {
        invite: {
          inviteId: 'inv_1',
          householdId: 'hh_other',
          status: 'active',
          expiresAt: '2026-01-02T00:00:00.000Z',
        },
      },
    });
    mockApiPost.mockRejectedValueOnce(
      httpError(403, 'forbidden', 'Health households hold a single user'),
    );

    await expect(
      enrolThisDeviceInHealthHousehold({ userId: 'user-2', shortCode: 'ABC123', secret: 'sekret' }),
    ).rejects.toBeInstanceOf(HealthSecondUserRefusedError);

    // …and the device is not stranded bound to a household it was refused from.
    expect(mockOpenLocalHealthSession).toHaveBeenLastCalledWith({ userId: 'user-2' });
  });

  it('does not mistake a wrong secret or a changed claim for a second user', async () => {
    const request = {
      inviteId: 'inv_1',
      shortCode: 'ABC123',
      role: 'OWNER',
      expiresAt: '2026-01-02T00:00:00.000Z',
      claimedByUserId: 'user-1',
      claimedByEmail: null,
      claimedByDisplayName: null,
      claimedDeviceId: 'dev-peer',
      claimedDeviceLabel: 'iPad',
      claimedSigningPublicKey: 'aa'.repeat(32),
      claimedAgreementPublicKey: 'bb'.repeat(32),
    };

    mockApiPost.mockRejectedValueOnce(httpError(403, 'forbidden', 'Invalid invite secret'));
    await expect(approveHealthDeviceEnrolment({ request })).rejects.not.toBeInstanceOf(
      HealthSecondUserRefusedError,
    );

    mockApiPost.mockRejectedValueOnce(httpError(409, 'conflict', 'claim_changed'));
    await expect(approveHealthDeviceEnrolment({ request })).rejects.not.toBeInstanceOf(
      HealthSecondUserRefusedError,
    );
  });

  it('rebinds the ledger BEFORE claiming, so the claimed keys are the ones that survive', async () => {
    const order: string[] = [];
    mockResetLocalHealthSession.mockImplementation(async () => {
      order.push('reset');
    });
    mockOpenLocalHealthSession.mockImplementation(async () => {
      order.push('open');
      return LEDGER;
    });
    mockApiGet.mockResolvedValueOnce({
      data: {
        invite: {
          inviteId: 'inv_1',
          householdId: 'hh_first_device',
          status: 'active',
          expiresAt: '2026-01-02T00:00:00.000Z',
        },
      },
    });
    mockApiPost.mockImplementationOnce(async () => {
      order.push('claim');
      return { data: {} };
    });

    await enrolThisDeviceInHealthHousehold({
      userId: 'user-1',
      shortCode: 'ABC123',
      secret: 'sekret',
    });

    // Claiming first would register a device identity that rebinding then throws
    // away, and the wrapped HDK would be undecryptable forever.
    expect(order).toEqual(['reset', 'open', 'claim']);
    expect(mockOpenLocalHealthSession).toHaveBeenCalledWith({
      userId: 'user-1',
      householdId: 'hh_first_device',
    });
  });

  it('refuses to enrol a device that already holds entries', async () => {
    LEDGER.weightEntries = [{ id: 'w1' }];
    try {
      await expect(
        enrolThisDeviceInHealthHousehold({
          userId: 'user-1',
          shortCode: 'ABC123',
          secret: 'sekret',
        }),
      ).rejects.toBeInstanceOf(controlPlane.HealthEnrolmentWouldDiscardDataError);
      expect(mockResetLocalHealthSession).not.toHaveBeenCalled();
    } finally {
      LEDGER.weightEntries = [];
    }
  });
});

describe('there is no invite-a-member surface', () => {
  const FORBIDDEN = /invite (a |an )?(member|person|friend|partner|family)|add (a )?member|household member|family member|buddy|invite someone/i;

  it('exports nothing whose NAME offers to add a person', () => {
    const offenders = Object.keys(controlPlane).filter((name) =>
      /member|family|buddy|friend|partner/i.test(name),
    );
    expect(offenders).toEqual([]);
  });

  it('has no invite-a-member copy in any exported string', () => {
    const strings: string[] = [];
    const collect = (value: unknown, depth = 0): void => {
      if (depth > 4) return;
      if (typeof value === 'string') {
        strings.push(value);
        return;
      }
      if (value && typeof value === 'object') {
        for (const nested of Object.values(value as Record<string, unknown>)) {
          collect(nested, depth + 1);
        }
      }
    };
    collect(controlPlane);

    // Error copy is user-visible too, so it is swept with the rest.
    strings.push(new HealthSecondUserRefusedError('claim').message);
    strings.push(new controlPlane.HealthEnrolmentWouldDiscardDataError().message);

    expect(strings.length).toBeGreaterThan(5);
    for (const text of strings) {
      expect(text).not.toMatch(FORBIDDEN);
    }
  });

  it('says "your other device" instead', () => {
    const copy = Object.values(HEALTH_ENROLMENT_COPY).join(' ').toLowerCase();
    expect(copy).toContain('your other device');
    expect(copy).not.toMatch(FORBIDDEN);
    expect(HEALTH_ENROLMENT_COPY.title.toLowerCase()).toContain('device');
  });

  it('registers the personal household under a non-identifying display name', async () => {
    await syncLocalHealthHouseholdToControlPlane();
    expect(mockApiPost.mock.calls[0]?.[1]).toMatchObject({ displayName: 'Symply Health' });
  });
});
