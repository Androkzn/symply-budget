/**
 * Who gets a row on the control plane — and, mostly, who does not.
 *
 * The bug this pins: `openLocalBudgetSession` mints a fresh `hh_local_*`
 * whenever the device has no ledger on disk (reinstall, wipe, "Clean up
 * previous data", account switch), and session open used to POST every one of
 * them to `/v2/households`. Each local reset therefore left one more orphan
 * household on the server — named after the member, one device, no invites, no
 * second member — which the app then listed back to them under "Other
 * households on your account" and offered no way to remove. Production held 13
 * of them across two accounts on 2026-08-22.
 *
 * So the contract is: a solo household stays on the phone. It earns a server row
 * at the moment it needs a peer to find it — an invite minted for it, or a join
 * that adopted someone else's — and not before.
 */
const mockApiGet = jest.fn();
const mockApiPost = jest.fn();
const mockApiDelete = jest.fn();

const HH = 'hh_local_solo';

/** The one store every household on a device shares — `getLocalStore()`. */
const mockMeta = new Map<string, string>();

const mockSessionFor = (householdId: string) => ({
  householdId,
  ledger: {
    household: { id: householdId, name: 'Анастасия Техтелева', my_role: mockRole },
    deviceId: 'dev_a',
    memberId: 'user-1',
  },
  identity: {
    deviceId: 'dev_a',
    signingPublicKey: new Uint8Array([0xaa, 0xbb]),
    agreementPublicKey: new Uint8Array([0xcc, 0xdd]),
  },
  store: {
    getMeta: (key: string) => Promise.resolve(mockMeta.get(key) ?? null),
    setMeta: (key: string, value: string) => {
      mockMeta.set(key, value);
      return Promise.resolve();
    },
  },
});

let mockHeldHouseholds = [HH];
let mockRole = 'owner';

jest.mock('@api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    delete: (...args: unknown[]) => mockApiDelete(...args),
  },
}));

jest.mock('../engine', () => ({
  getActiveBudgetHouseholdId: () => mockHeldHouseholds[0] ?? null,
  isLocalBudgetSessionOpen: () => true,
  listLocalBudgetHouseholds: () =>
    mockHeldHouseholds.map((householdId) => ({
      householdId,
      deviceId: 'dev_a',
      name: 'Анастасия Техтелева',
      role: mockRole,
      isActive: householdId === mockHeldHouseholds[0],
      hydrated: true,
      awaitingEnrolment: false,
    })),
  getLocalBudgetSession: (householdId: string) => Promise.resolve(mockSessionFor(householdId)),
  getLocalStore: () => mockSessionFor(mockHeldHouseholds[0] ?? HH).store,
  getLocalLedger: () => mockSessionFor(mockHeldHouseholds[0] ?? HH).ledger,
  getLocalIdentity: () => mockSessionFor(mockHeldHouseholds[0] ?? HH).identity,
  adoptJoinedHousehold: jest.fn(),
  installHouseholdKeys: jest.fn(),
}));

jest.mock('../deviceName', () => ({
  getLocalDeviceName: () => Promise.resolve('iPhone 13 Pro'),
  setLocalDeviceName: (name: string) => Promise.resolve(name),
}));

jest.mock('@services/enrolment/inviteSecretStore', () => ({
  rememberInviteSecret: jest.fn(() => Promise.resolve()),
  recallInviteSecret: jest.fn(() => Promise.resolve(null)),
  forgetInviteSecret: jest.fn(() => Promise.resolve()),
  rememberJoinSas: jest.fn(() => Promise.resolve()),
}));

import {
  awaitBudgetControlPlaneRegistration,
  budgetHouseholdControlPlaneStatus,
  budgetHouseholdIsOnControlPlane,
  createLocalFirstInvite,
  markBudgetHouseholdOnControlPlane,
  resetBudgetControlPlaneCache,
  syncLocalHouseholdToControlPlane,
} from '../controlPlaneClient';

/** URLs the client POSTed, in order. */
function postedUrls(): string[] {
  return mockApiPost.mock.calls.map((call) => String(call[0]));
}

const savedFlag = process.env.EXPO_PUBLIC_BUDGET_LOCAL_FIRST;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_BUDGET_LOCAL_FIRST = '1';
  mockMeta.clear();
  mockHeldHouseholds = [HH];
  mockRole = 'owner';
  resetBudgetControlPlaneCache();
  // The account owns nothing on the control plane unless a test says otherwise.
  mockApiGet.mockResolvedValue({ data: { households: [] } });
  mockApiPost.mockResolvedValue({ data: {} });
});

afterAll(() => {
  process.env.EXPO_PUBLIC_BUDGET_LOCAL_FIRST = savedFlag;
});

describe('a solo household stays on the phone', () => {
  it('session open does not create a server row for a freshly minted household', async () => {
    await syncLocalHouseholdToControlPlane();

    expect(postedUrls()).toEqual([]);
    // It ASKED — with a GET, which creates nothing — and took no for an answer.
    expect(mockApiGet).toHaveBeenCalledWith('/v2/households', expect.anything());
  });

  it('reports itself as absent from the control plane, so sync skips it', async () => {
    await expect(budgetHouseholdIsOnControlPlane(HH)).resolves.toBe(false);
  });

  it('stays off the control plane while offline rather than guessing', async () => {
    mockApiGet.mockRejectedValue(new Error('offline'));

    await syncLocalHouseholdToControlPlane();

    expect(postedUrls()).toEqual([]);
    await expect(budgetHouseholdIsOnControlPlane(HH)).resolves.toBe(false);
  });
});

/**
 * The boolean above is deliberately pessimistic — false covers "solo", "offline"
 * and "the list would not load", and that is right for the SYNC gate, which has
 * nothing to do either way and recovers next round.
 *
 * It is wrong for anything a member READS. The sync screen said "This budget is
 * only on this device" off that false, so a member of a genuinely shared
 * household who was merely offline was told their budget is not shared — and
 * invited to fix it by inviting someone who is already a member. These pin the
 * distinction so the copy cannot silently regress to guessing again.
 */
describe('absent and unreachable are different answers', () => {
  it("says 'no' only when the account list actually came back without it", async () => {
    await expect(budgetHouseholdControlPlaneStatus(HH)).resolves.toBe('no');
  });

  it("says 'unknown' when the account list could not be fetched", async () => {
    mockApiGet.mockRejectedValue(new Error('offline'));

    await expect(budgetHouseholdControlPlaneStatus(HH)).resolves.toBe('unknown');
  });

  it("says 'yes' from the local marker without asking the network at all", async () => {
    await markBudgetHouseholdOnControlPlane(HH);
    mockApiGet.mockRejectedValue(new Error('offline'));

    // The marker is the whole point: a shared household stays known to be
    // shared on a phone that cannot reach anything.
    await expect(budgetHouseholdControlPlaneStatus(HH)).resolves.toBe('yes');
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it("says 'yes' when the account list reports it, and remembers that", async () => {
    mockApiGet.mockResolvedValue({ data: { households: [{ id: HH }] } });

    await expect(budgetHouseholdControlPlaneStatus(HH)).resolves.toBe('yes');
    // Asked once; the marker answers every later caller.
    resetBudgetControlPlaneCache();
    mockApiGet.mockRejectedValue(new Error('offline'));
    await expect(budgetHouseholdControlPlaneStatus(HH)).resolves.toBe('yes');
  });

  it('keeps the boolean gate agreeing with the tri-state', async () => {
    // One source of truth: the gate is `=== 'yes'`, so an offline device still
    // reads false and sync still skips — the behaviour this refactor must not
    // change.
    mockApiGet.mockRejectedValue(new Error('offline'));

    await expect(budgetHouseholdControlPlaneStatus(HH)).resolves.toBe('unknown');
    await expect(budgetHouseholdIsOnControlPlane(HH)).resolves.toBe(false);
  });
});

describe('a household that already has a row keeps it', () => {
  beforeEach(() => {
    mockApiGet.mockResolvedValue({
      data: { households: [{ id: HH, display_name: 'Sweet Home', role: 'OWNER', key_epoch: 1 }] },
    });
  });

  it('re-registers on session open — the device label and legacy mirror stay fresh', async () => {
    await syncLocalHouseholdToControlPlane();

    expect(postedUrls()).toEqual(['/v2/households']);
  });

  it('remembers the answer, so the next launch does not re-ask the network', async () => {
    await syncLocalHouseholdToControlPlane();
    expect(mockApiGet).toHaveBeenCalledTimes(1);

    resetBudgetControlPlaneCache(); // as a relaunch would
    await syncLocalHouseholdToControlPlane();

    expect(mockApiGet).toHaveBeenCalledTimes(1);
    expect(postedUrls()).toEqual(['/v2/households', '/v2/households']);
  });

  it('records a 409 as a registration too', async () => {
    mockApiPost.mockRejectedValueOnce(
      Object.assign(new Error('conflict'), { response: { status: 409 } }),
    );

    await syncLocalHouseholdToControlPlane();
    resetBudgetControlPlaneCache();
    await syncLocalHouseholdToControlPlane();

    // POST households → 409 → POST devices, then a second run straight from the
    // marker, with no second GET.
    expect(postedUrls()).toEqual([
      '/v2/households',
      `/v2/households/${HH}/devices`,
      '/v2/households',
    ]);
    expect(mockApiGet).toHaveBeenCalledTimes(1);
  });
});

describe('sharing is what creates the row', () => {
  it('minting an invite registers the household first, in that order', async () => {
    mockApiPost.mockImplementation((url: string) =>
      String(url).endsWith('/invites')
        ? Promise.resolve({
            data: {
              invite: {
                inviteId: 'inv_1',
                shortCode: 'ABC123',
                secret: 's',
                expiresAt: '2026-08-22T18:00:00.000Z',
              },
            },
          })
        : Promise.resolve({ data: {} }),
    );

    await createLocalFirstInvite();

    expect(postedUrls()).toEqual(['/v2/households', `/v2/households/${HH}/invites`]);
  });

  it('a marked household registers on the next unforced session open', async () => {
    await markBudgetHouseholdOnControlPlane(HH);

    await syncLocalHouseholdToControlPlane();

    expect(postedUrls()).toEqual(['/v2/households']);
    // The marker answered it — no need to ask the account list at all.
    expect(mockApiGet).not.toHaveBeenCalled();
  });
});

describe('the account list is not inherited across sign-ins', () => {
  it('is re-asked after a teardown reset', async () => {
    await syncLocalHouseholdToControlPlane();
    expect(mockApiGet).toHaveBeenCalledTimes(1);

    // Same household id, different account behind the token: without the reset
    // the previous account's "you own nothing" (or, worse, "you own this") would
    // decide whether this one may sync.
    resetBudgetControlPlaneCache();
    mockMeta.clear();
    await syncLocalHouseholdToControlPlane();

    expect(mockApiGet).toHaveBeenCalledTimes(2);
  });
});

describe('a member never issues a create for a household they do not own', () => {
  beforeEach(() => {
    mockRole = 'member';
    mockApiGet.mockResolvedValue({
      data: { households: [{ id: HH, display_name: "Owner's name", role: 'ADULT', key_epoch: 1 }] },
    });
  });

  /**
   * `POST /v2/households` carries this device's OWN name for the household. A
   * member sending it is a create for someone else's household under the
   * member's label — harmless only because the row exists and the route 409s
   * without touching display_name. The day it becomes an upsert, the first
   * member to sync renames the owner's household for everyone.
   */
  it('registers the device only, never the household', async () => {
    await syncLocalHouseholdToControlPlane();

    expect(postedUrls()).toEqual([`/v2/households/${HH}/devices`]);
  });

  it('does the same when forced, so minting an invite cannot rename it either', async () => {
    await syncLocalHouseholdToControlPlane(HH, { force: true });

    expect(postedUrls()).toEqual([`/v2/households/${HH}/devices`]);
  });

  it('still records the household as registered', async () => {
    await syncLocalHouseholdToControlPlane();
    mockApiGet.mockClear();

    await expect(budgetHouseholdIsOnControlPlane(HH)).resolves.toBe(true);
    expect(mockApiGet).not.toHaveBeenCalled();
  });
});

describe('a server-backed feature earns the row on demand', () => {
  it('registers on a 403 retry, then reports the household as registered', async () => {
    await expect(awaitBudgetControlPlaneRegistration(HH)).resolves.toBe(true);

    expect(postedUrls()).toEqual(['/v2/households']);
  });

  it('refuses to retry a household this device does not hold', async () => {
    await expect(awaitBudgetControlPlaneRegistration('hh_local_someone_else')).resolves.toBe(false);
    expect(postedUrls()).toEqual([]);
  });

  it('refuses to retry when the household is ALREADY registered', async () => {
    // Then the 403 is a real denial — a revoked device, a member removed — and
    // a retry would re-fail and swallow the reason.
    await markBudgetHouseholdOnControlPlane(HH);
    await expect(awaitBudgetControlPlaneRegistration(HH)).resolves.toBe(false);
    expect(postedUrls()).toEqual([]);
  });
});
