/**
 * The Tier-B 403 startup race (plan Q11) — found by the House E2E run, 2026-08-13.
 *
 * **What was observed on a real device.** With House local-first on, the client
 * rebinds `currentHousehold` to the on-device ledger id (`hh_local_…`) the moment
 * the encrypted session opens. Screens mount immediately and fire the endpoints
 * that are still server-authoritative — `home-projects`, `quotes/pending`,
 * `home-budget/monthly-overview`, `projects/active`, `aihousekeeper/*`. Those
 * authorise against the LEGACY `household_members` rows, which only exist once
 * `syncLocalHouseholdToControlPlane()` has mirrored them.
 *
 * `openHouseLocalSession` starts that registration fire-and-forget on purpose:
 * session open is the offline-first cold-start path and must not block on the
 * network. The measured consequence was a ~2s window with **10 Tier-B 403s**,
 * and **24/24 of the same calls returning 200 afterwards** — an ordering race,
 * not a broken authorisation model.
 *
 * The fix is a single scoped retry in the API client. What this suite pins is the
 * scoping, because that is where it could go wrong in either direction: too
 * narrow and the race is still live; too broad and a genuine permission denial
 * becomes an infinite retry.
 */
import {
  __resetHouseControlPlaneRegistrationForTests,
  awaitHouseControlPlaneRegistration,
  syncLocalHouseholdToControlPlane,
} from '../controlPlaneClient';

const mockState = {
  localFirst: true,
  sessionOpen: true,
  registerCalls: 0,
  registerFails: false,
};

jest.mock('../flag', () => ({ isHouseLocalFirst: () => mockState.localFirst }));

/**
 * ONE property, and every accessor the client resolves it through.
 *
 * Registration is per property now: the client asks `listLocalHouseProperties`
 * which homes this device holds, `getActiveHouseholdId` which one a call without
 * an id means, and `getLocalHouseSession` for that home's own keys — so a mock
 * that only answers the old whole-device accessors makes every call throw before
 * it reaches the behaviour under test.
 */
// `mock`-prefixed on purpose: jest's module factories may not close over any
// other out-of-scope binding.
const mockHouseholdId = 'hh_local_abc';

const mockIdentity = {
  signingPublicKey: new Uint8Array(32),
  agreementPublicKey: new Uint8Array(32),
};

const mockLedger = {
  deviceId: 'dev-1',
  household: { id: mockHouseholdId, name: 'Home', my_role: 'owner' },
};

jest.mock('../engine', () => ({
  isLocalHouseSessionOpen: () => mockState.sessionOpen,
  getActiveHouseholdId: () => (mockState.sessionOpen ? mockHouseholdId : null),
  listLocalHouseProperties: () =>
    mockState.sessionOpen
      ? [
          {
            householdId: mockHouseholdId,
            deviceId: 'dev-1',
            name: 'Home',
            role: 'owner',
            isActive: true,
            hydrated: true,
            awaitingEnrolment: false,
          },
        ]
      : [],
  getLocalHouseSession: async () => ({
    householdId: mockHouseholdId,
    ledger: mockLedger,
    identity: mockIdentity,
    householdKeys: { householdId: mockHouseholdId, hdk: new Uint8Array(32), keyEpoch: 1 },
    retiredHouseholdKeys: new Map(),
    awaitingEnrolment: false,
  }),
  // The persisted "this home is on the control plane" marker. A stub is enough:
  // what the suite pins is how often registration RUNS, not what it remembers
  // between processes.
  getLocalHouseStore: () => ({
    getMeta: async () => null,
    setMeta: async () => undefined,
  }),
  getLocalHouseLedger: () => mockLedger,
  getLocalHouseIdentity: () => mockIdentity,
  getLocalHouseholdKeys: () => ({
    householdId: mockHouseholdId,
    hdk: new Uint8Array(32),
    keyEpoch: 1,
  }),
  adoptJoinedHousehold: jest.fn(),
  installHouseholdKeys: jest.fn(),
}));

jest.mock('../deviceName', () => ({
  getLocalDeviceName: async () => 'Test device',
  setLocalDeviceName: async (name: string) => name,
}));

jest.mock('../ensureSession', () => ({ syncHouseholdStoreFromLocalLedger: jest.fn() }));

jest.mock('@stores/householdStore', () => ({ useHouseholdStore: { getState: () => ({}) } }));

jest.mock('@api/client', () => ({
  apiClient: {
    post: jest.fn(async () => {
      mockState.registerCalls += 1;
      if (mockState.registerFails) throw new Error('offline');
      return { data: {} };
    }),
    get: jest.fn(async () => ({ data: { households: [] } })),
    delete: jest.fn(),
    put: jest.fn(),
  },
}));

beforeEach(() => {
  __resetHouseControlPlaneRegistrationForTests();
  mockState.localFirst = true;
  mockState.sessionOpen = true;
  mockState.registerCalls = 0;
  mockState.registerFails = false;
});

describe('awaitHouseControlPlaneRegistration — the retry gate', () => {
  it('registers and reports that a retry is worthwhile', async () => {
    await expect(awaitHouseControlPlaneRegistration()).resolves.toBe(true);
    expect(mockState.registerCalls).toBe(1);
  });

  it('does not re-register once it has succeeded — the retry fires at most once per process', async () => {
    await awaitHouseControlPlaneRegistration();
    // A second 403 (a genuine denial this time) must not trigger another
    // registration or another retry, or a permanently-forbidden endpoint would
    // loop forever.
    await expect(awaitHouseControlPlaneRegistration()).resolves.toBe(false);
    expect(mockState.registerCalls).toBe(1);
  });

  it('coalesces concurrent callers onto one registration', async () => {
    // The observed burst was 10 simultaneous 403s. Ten registrations would be
    // ten POSTs racing the household row they depend on — the exact failure the
    // single-flight guard was added for.
    const results = await Promise.all([
      awaitHouseControlPlaneRegistration(),
      awaitHouseControlPlaneRegistration(),
      awaitHouseControlPlaneRegistration(),
    ]);
    expect(mockState.registerCalls).toBe(1);
    expect(results.filter(Boolean).length).toBeGreaterThan(0);
  });

  it('does not retry when local-first is off — a 403 there is a real denial', async () => {
    mockState.localFirst = false;
    await expect(awaitHouseControlPlaneRegistration()).resolves.toBe(false);
    expect(mockState.registerCalls).toBe(0);
  });

  it('does not retry when no session is open', async () => {
    mockState.sessionOpen = false;
    await expect(awaitHouseControlPlaneRegistration()).resolves.toBe(false);
    expect(mockState.registerCalls).toBe(0);
  });

  it('reports no retry when registration itself fails, instead of throwing', async () => {
    // Offline at launch: the 403 must surface as a 403, not as an unhandled
    // rejection from inside the interceptor.
    mockState.registerFails = true;
    await expect(awaitHouseControlPlaneRegistration()).resolves.toBe(false);
  });

  it('recovers on a later attempt once the network returns', async () => {
    mockState.registerFails = true;
    await awaitHouseControlPlaneRegistration();
    mockState.registerFails = false;
    await expect(awaitHouseControlPlaneRegistration()).resolves.toBe(true);
  });
});

describe('retry scoping — which URLs the interceptor may retry', () => {
  // Mirrors the interceptor's predicate in `src/api/client.ts`. Kept as a pure
  // check so the boundary is asserted without standing up axios: the rule is
  // "only local-ledger household ids", because those are the only ones whose
  // 403 is explained by a missing legacy mirror.
  const shouldRetry = (url: string) => url.includes('/households/hh_local_');

  it.each([
    '/households/hh_local_a75ebaf337214342/home-projects',
    '/households/hh_local_a75ebaf337214342/quotes/pending',
    '/households/hh_local_a75ebaf337214342/home-budget/monthly-overview',
    '/households/hh_local_a75ebaf337214342/projects/active',
    '/households/hh_local_a75ebaf337214342/aihousekeeper/home-insight',
    '/households/hh_local_a75ebaf337214342/aihousekeeper/weather',
    '/households/hh_local_a75ebaf337214342/reports',
    '/households/hh_local_a75ebaf337214342/chat-rooms',
  ])('retries %s — every endpoint the device run saw 403', (url) => {
    expect(shouldRetry(url)).toBe(true);
  });

  it.each([
    '/households/hh_9f3c2b1a/home-projects',
    '/households/abc123/reports',
    '/subscriptions/me',
    '/ai-access',
    '/notifications/unread-count',
  ])('does NOT retry %s — a server household 403 is a real denial', (url) => {
    expect(shouldRetry(url)).toBe(false);
  });
});

/**
 * The same latch, asked of the DIRECT caller — which is the one that actually
 * runs on a timer.
 *
 * `awaitHouseControlPlaneRegistration` (above) checked `registeredHouseholds`
 * before registering, so its tests passed throughout. `syncLocalHouseholdToControlPlane`
 * — the entry point every session-open and every sync cycle calls — did not: it
 * guarded only on `controlPlaneSyncInFlight`, which de-duplicates CONCURRENT
 * callers and says nothing about a call that already finished.
 *
 * So registration re-ran on every cycle: `POST /v2/households` for a row that
 * exists, a 409, the legacy mirror re-asserted, `true` returned. Correct, and
 * entirely wasted. Observed on a device as a `POST /v2/households → 409` every
 * ~30 seconds, per property, for the life of the process — five properties, so
 * five wasted round trips a minute.
 *
 * The offline case is the one that must NOT be latched, and it has its own case
 * below: the set is only added to on a real success, so a launch with no network
 * still retries until it gets one.
 */
describe('syncLocalHouseholdToControlPlane — registers once per process, not per sync', () => {
  it('registers on the first call', async () => {
    await syncLocalHouseholdToControlPlane();
    expect(mockState.registerCalls).toBe(1);
  });

  it('does not re-register on later calls', async () => {
    await syncLocalHouseholdToControlPlane();
    // Three more sync cycles. Before the latch was read, each of these was
    // another POST and another 409.
    await syncLocalHouseholdToControlPlane();
    await syncLocalHouseholdToControlPlane();
    await syncLocalHouseholdToControlPlane();
    expect(mockState.registerCalls).toBe(1);
  });

  it('keeps retrying while registration is still failing', async () => {
    mockState.registerFails = true;
    await syncLocalHouseholdToControlPlane();
    await syncLocalHouseholdToControlPlane();
    // An offline launch must stay retryable — latching a failure here would
    // leave every Tier-B endpoint 403ing for the rest of the process.
    expect(mockState.registerCalls).toBe(2);
  });

  it('latches as soon as the network comes back', async () => {
    mockState.registerFails = true;
    await syncLocalHouseholdToControlPlane();
    mockState.registerFails = false;
    await syncLocalHouseholdToControlPlane();
    const afterSuccess = mockState.registerCalls;
    await syncLocalHouseholdToControlPlane();
    expect(mockState.registerCalls).toBe(afterSuccess);
  });

  it('still coalesces concurrent callers onto one registration', async () => {
    // The in-flight map is not replaced by the latch — it is what stops a burst
    // of simultaneous callers each issuing their own POST before any has
    // finished.
    await Promise.all(
      Array.from({ length: 8 }, () => syncLocalHouseholdToControlPlane()),
    );
    expect(mockState.registerCalls).toBe(1);
  });
});
