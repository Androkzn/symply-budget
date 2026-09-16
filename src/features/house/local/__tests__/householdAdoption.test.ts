/**
 * Adopt before you mint — the reinstall case.
 *
 * A device that holds no local ledger used to mint one: a fresh random
 * `hh_local_*` id, seeded, activated, and then fire-and-forget POSTed to
 * `/v2/households` as an owner-create by `ensureHouseLocalSession`. That is
 * correct for exactly one situation — a brand-new account — and "no ledger on
 * disk" is not that situation. It is also the reinstall, the new phone and the
 * restore, and on all three the account's real home is sitting on the control
 * plane one GET away.
 *
 * What it cost, on staging: 17 orphan households named after the member, every
 * one with a null address. And worse than the rows —
 * `syncHouseholdStoreFromLocalLedger` publishes the engine's property set OVER
 * `householdStore.households`, so on a reinstall the member's real home vanished
 * from "My Properties" and was replaced by an empty one named after them, with
 * no screen anywhere able to explain it.
 *
 * This is NOT the S3b deterministic-id hazard (see `registryGuard.test.ts`). A
 * household has no natural key: a landlord's three properties must get three
 * ids, so a deterministic builder would be actively wrong. The fix is
 * reconciliation — ask the control plane first, adopt what is already there —
 * and every `it` below is one way that reconciliation can go wrong.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
jest.mock('../flag', () => ({
  __esModule: true,
  isHouseLocalFirst: () => true,
  isHouseP2PEnabled: () => false,
}));

jest.mock('@api/client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

const mockAuth = {
  user: { id: 'user-reinstall-1', display_name: 'Ada Lovelace', email: 'ada@x.test' } as {
    id: string;
    display_name: string | null;
    email: string | null;
  } | null,
  isAuthenticated: true,
  hasHydrated: true,
};
jest.mock('@stores/authStore', () => ({
  useAuthStore: { getState: () => mockAuth },
}));

// Everything ensureSession starts AFTER the session is open. None of it is what
// this file is about, and each one reaches for a native module (notifications,
// the App Group, a WebSocket) that has nothing to say about which household id
// exists.
jest.mock('../householdRoster', () => ({
  __esModule: true,
  refreshHouseHouseholdRoster: jest.fn().mockResolvedValue(undefined),
  republishActiveHouseRoster: jest.fn(() => []),
  resetHouseRosters: jest.fn(),
}));
jest.mock('../reminders/houseLocalReminders', () => ({
  __esModule: true,
  syncHouseLocalReminders: jest.fn().mockResolvedValue(undefined),
  cancelHouseLocalReminders: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../reminders/widgetProjection', () => ({
  __esModule: true,
  startHouseWidgetProjection: jest.fn(),
  stopHouseWidgetProjection: jest.fn(),
  clearHouseWidgetProjection: jest.fn(),
}));
jest.mock('../sync/ledgerRefresh', () => ({
  __esModule: true,
  startHouseLedgerRefreshBridge: jest.fn(),
  stopHouseLedgerRefreshBridge: jest.fn(),
}));
jest.mock('../pushWake', () => ({
  __esModule: true,
  registerHouseLocalPushToken: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../sync/orchestrator', () => ({
  __esModule: true,
  runHouseLocalSync: jest.fn().mockResolvedValue(undefined),
}));

import { apiClient } from '@api/client';

import {
  adoptJoinedHousehold,
  closeLocalHouseSession,
  getLocalHouseDeviceId,
  getLocalHouseIdentity,
  getLocalHouseLedger,
  installHouseholdKeys,
  isAwaitingHouseEnrolment,
  isLocalHouseSessionOpen,
  listLocalHouseProperties,
  openHouseDeviceForEnrolment,
  openLocalHouseSession,
  resetLocalHouseSession,
} from '../engine';
import {
  __resetHouseLocalBootstrapStateForTests,
  ensureHouseLocalSession,
  getHouseLocalBootstrapState,
  startNewHouseholdOnThisDevice,
} from '../ensureSession';

const { __resetHouseControlPlaneRegistrationForTests, syncAllLocalHouseholdsToControlPlane } =
  require('../controlPlaneClient') as typeof import('../controlPlaneClient');

const api = apiClient as unknown as { get: jest.Mock; post: jest.Mock };

const USER = 'user-reinstall-1';
const REAL_HOME = { id: 'hh_maple_real', display_name: 'Maple Street House', role: 'OWNER', key_epoch: 1 };
const CABIN = { id: 'hh_cabin_real', display_name: 'Lake Cabin', role: 'OWNER', key_epoch: 1 };

/** The control plane answers `GET /v2/households` with these; everything else is empty. */
function accountOwns(households: Array<typeof REAL_HOME>): void {
  api.get.mockImplementation((url: string) =>
    url === '/v2/households'
      ? Promise.resolve({ data: { households } })
      : Promise.resolve({ data: {} }),
  );
}

/** No route to the control plane at all — the offline launch. */
function noNetwork(): void {
  api.get.mockRejectedValue(new Error('Network Error'));
  api.post.mockRejectedValue(new Error('Network Error'));
}

function householdIds(): string[] {
  return listLocalHouseProperties()
    .map((property) => property.householdId)
    .sort();
}

function controlPlaneListCalls(): number {
  return api.get.mock.calls.filter((call) => call[0] === '/v2/households').length;
}

function postedPaths(): string[] {
  return api.post.mock.calls.map((call) => String(call[0]));
}

/** Let ensureSession's floated `void import(…).then(…)` chain settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(async () => {
  jest.clearAllMocks();
  api.post.mockResolvedValue({ data: {} });
  await resetLocalHouseSession();
  __resetHouseControlPlaneRegistrationForTests();
  __resetHouseLocalBootstrapStateForTests();
  mockAuth.user = { id: USER, display_name: 'Ada Lovelace', email: 'ada@x.test' };
  mockAuth.isAuthenticated = true;
  mockAuth.hasHydrated = true;
});

afterEach(async () => {
  await resetLocalHouseSession();
});

describe('an empty device belonging to an account that already has a home', () => {
  it('does not mint a second home', async () => {
    // The whole bug in one assertion: no `hh_local_*` id may come into existence
    // on a device whose account is already known to the control plane.
    accountOwns([REAL_HOME]);

    await ensureHouseLocalSession();

    expect(householdIds()).toEqual([REAL_HOME.id]);
    expect(householdIds().some((id) => id.startsWith('hh_local_'))).toBe(false);
  });

  it('never issues the household CREATE that produced the orphan rows', async () => {
    // `POST /v2/households` is the call that made 17 rows out of 17 launches.
    // The adopted home registers this DEVICE against a household that already
    // exists instead — the same call a joined member makes, and the only one
    // that lets a peer wrap the key to this device.
    accountOwns([REAL_HOME]);

    await ensureHouseLocalSession();
    await flush();
    await syncAllLocalHouseholdsToControlPlane();

    expect(postedPaths()).not.toContain('/v2/households');
    expect(postedPaths()).toContain(`/v2/households/${REAL_HOME.id}/devices`);
  });

  it('carries the REAL home in, under its real id and its real name', async () => {
    // The member's home is what has to appear in "My Properties" — the store is
    // published from the engine's property set, so a placeholder named "My home"
    // here IS what the member sees where their house used to be.
    accountOwns([REAL_HOME]);

    await ensureHouseLocalSession();

    expect(getLocalHouseLedger().household.id).toBe(REAL_HOME.id);
    expect(getLocalHouseLedger().household.name).toBe('Maple Street House');
  });

  it('reports the recover-this-home state, so a screen can say why it is empty', async () => {
    // Before this state existed the member's only signal was an empty house.
    // Nothing was wrong enough to throw, so nothing rendered an explanation.
    accountOwns([REAL_HOME]);

    await ensureHouseLocalSession();

    expect(getHouseLocalBootstrapState()).toEqual({
      status: 'recover-this-home',
      households: [{ id: REAL_HOME.id, name: 'Maple Street House' }],
    });
  });

  it('holds the home key-less, so nothing is authored that no peer can read', async () => {
    // The adopted home is in exactly the shape a joined home has between
    // claiming an invite and the key arriving: present, named, and refusing
    // every write. Ops sealed under the throwaway key would be undecryptable by
    // the peers this device is trying to rejoin — and by this device itself once
    // the real key installs.
    accountOwns([REAL_HOME]);

    await ensureHouseLocalSession();

    expect(isAwaitingHouseEnrolment(REAL_HOME.id)).toBe(true);
    expect(getLocalHouseLedger().pendingEnrolment).toBe(true);
    expect(getLocalHouseLedger().tasks).toHaveLength(0);
  });

  it('adopts EVERY home the account owns, not just one', async () => {
    // A member with two homes who reinstalls must not be told they have one.
    // The one they cannot see is the one whose peers never learn this device's
    // keys, and it stays invisible for as long as the app is installed.
    accountOwns([REAL_HOME, CABIN]);

    await ensureHouseLocalSession();

    expect(householdIds()).toEqual([CABIN.id, REAL_HOME.id].sort());
    // …and the FIRST is the active one, so relaunching lands somewhere stable
    // rather than on whichever adopt happened to finish last.
    expect(getLocalHouseLedger().household.id).toBe(REAL_HOME.id);
  });
});

describe('a brand-new account, signed up and holding nothing', () => {
  it('is given no home for signing up', async () => {
    // Signing up is not the same act as setting up a home. Minting one here
    // produced a property named after the member, with no address, that then
    // sat in "My Properties" beside the home they created on the very next
    // onboarding screen — two homes out of one sign-up, the empty one
    // indistinguishable from the real one.
    accountOwns([]);

    await ensureHouseLocalSession();

    expect(listLocalHouseProperties()).toEqual([]);
    expect(isLocalHouseSessionOpen()).toBe(false);
  });

  it('publishes nothing to the control plane either', async () => {
    // Not merely "no row on this phone": no `POST /v2/households`, so the
    // account owns nothing on the server for as long as nobody asks it to.
    accountOwns([]);

    await ensureHouseLocalSession();
    await flush();

    expect(postedPaths()).not.toContain('/v2/households');
  });

  it('says it is waiting to be asked, not that it could not reach us', async () => {
    // A KNOWN answer — the account owns nothing — and it must not read like the
    // unknown one. `undecided-offline` puts `HouseRecoverHomeScreen` over the
    // whole app telling the member their phone cannot reach us, which would be
    // both wrong and unescapable on the most ordinary first launch there is.
    accountOwns([]);

    await ensureHouseLocalSession();

    expect(getHouseLocalBootstrapState()).toEqual({ status: 'awaiting-first-home' });
  });

  it('mints — and seeds — the moment a person asks for a home', async () => {
    // The onboarding create form comes through here. Nothing about the first
    // run is lost by waiting for it: the home arrives with the name the member
    // typed, and with the same preset spaces and seasonal shells a first run
    // has always been seeded with.
    accountOwns([]);
    await ensureHouseLocalSession();

    await startNewHouseholdOnThisDevice('Maple Street House');

    expect(listLocalHouseProperties()).toHaveLength(1);
    expect(householdIds()[0]!.startsWith('hh_local_')).toBe(true);
    expect(isAwaitingHouseEnrolment(householdIds()[0]!)).toBe(false);
    const ledger = getLocalHouseLedger();
    expect(ledger.household.name).toBe('Maple Street House');
    expect(ledger.householdSpaces.length).toBeGreaterThan(0);
    expect(ledger.seasonalChecklists).toHaveLength(4);
    expect(getHouseLocalBootstrapState()).toEqual({
      status: 'open',
      householdId: householdIds()[0]!,
    });
  });

  it('can claim an invite with no home of its own to claim from', async () => {
    // The other way a new account gets a home, and the one the no-mint change
    // could quietly have broken: claiming presents a device keypair, and the
    // keypair used to be read out of a ledger this device no longer has. The
    // claim must still carry real public keys, and the adopt that follows must
    // reuse the SAME ones — the owner approves a device, and a second keypair
    // would leave the key wrapped to one that never existed.
    accountOwns([]);
    await ensureHouseLocalSession();
    expect(isLocalHouseSessionOpen()).toBe(false);

    await openHouseDeviceForEnrolment({ userId: USER });
    const identity = getLocalHouseIdentity();
    const deviceId = getLocalHouseDeviceId();
    expect(deviceId).toMatch(/^dev_/);

    await adoptJoinedHousehold({ householdId: REAL_HOME.id, displayName: 'Maple Street House' });

    expect(householdIds()).toEqual([REAL_HOME.id]);
    expect(getLocalHouseLedger().deviceId).toBe(deviceId);
    expect(getLocalHouseIdentity().signingPublicKey).toEqual(identity.signingPublicKey);
    // Key-less until the owner approves — exactly the shape a joined home has.
    expect(isAwaitingHouseEnrolment(REAL_HOME.id)).toBe(true);
  });

  it('reuses one keypair across a retried claim', async () => {
    // A member who mistypes the secret taps join again. A fresh keypair per
    // attempt would leave the owner approving digits derived from keys the
    // device had already thrown away.
    accountOwns([]);
    await ensureHouseLocalSession();

    await openHouseDeviceForEnrolment({ userId: USER });
    const first = getLocalHouseIdentity().signingPublicKey;
    await openHouseDeviceForEnrolment({ userId: USER });

    expect(getLocalHouseIdentity().signingPublicKey).toEqual(first);
  });
});

describe('an empty device that cannot reach the control plane', () => {
  it('mints nothing rather than minting an orphan it will later push', async () => {
    // Offline is not "this account owns nothing". A mint here is indistinguishable
    // from a first run at the moment it happens and becomes an orphan the moment
    // the network returns — which is exactly how the staging rows were created.
    noNetwork();

    await ensureHouseLocalSession();
    await flush();

    expect(listLocalHouseProperties()).toEqual([]);
    expect(isLocalHouseSessionOpen()).toBe(false);
    expect(postedPaths()).not.toContain('/v2/households');
  });

  it('says so, rather than looking like a home that is merely empty', async () => {
    noNetwork();

    await ensureHouseLocalSession();

    expect(getHouseLocalBootstrapState()).toEqual({ status: 'undecided-offline' });
  });

  it('decides on the next launch, once there is an answer to decide on', async () => {
    // Deferring only costs a relaunch — and a rehydrate is a foreground away.
    noNetwork();
    await ensureHouseLocalSession();
    expect(isLocalHouseSessionOpen()).toBe(false);

    api.post.mockResolvedValue({ data: {} });
    accountOwns([REAL_HOME]);
    await ensureHouseLocalSession();

    expect(householdIds()).toEqual([REAL_HOME.id]);
    expect(getHouseLocalBootstrapState()).toMatchObject({ status: 'recover-this-home' });
  });

  it('does not treat an expired token as an empty account either', async () => {
    // A 401 throws out of the list call the same way a dead network does, and
    // reading either as "first run" is what mints the orphan. Any failure means
    // "I do not know".
    api.get.mockRejectedValue(Object.assign(new Error('Unauthorized'), { response: { status: 401 } }));

    await ensureHouseLocalSession();

    expect(listLocalHouseProperties()).toEqual([]);
    expect(getHouseLocalBootstrapState()).toEqual({ status: 'undecided-offline' });
  });
});

describe('a device that already holds a ledger', () => {
  /** Provision a real home on disk, then close the session as a relaunch would. */
  async function deviceWithAHome(): Promise<string> {
    const ledger = await openLocalHouseSession({ userId: USER, displayName: 'Maple Grove' });
    await closeLocalHouseSession();
    jest.clearAllMocks();
    api.post.mockResolvedValue({ data: {} });
    accountOwns([REAL_HOME]);
    return ledger.household.id;
  }

  it('never asks the control plane which homes the account owns', async () => {
    // This runs on every sign-in AND every auth rehydrate. An unconditional
    // round trip here would put a network call in front of a ledger that is
    // already on disk — on the offline-first path, on every launch.
    await deviceWithAHome();

    await ensureHouseLocalSession();

    expect(controlPlaneListCalls()).toBe(0);
  });

  it('opens the home it already has, untouched by any of this', async () => {
    const own = await deviceWithAHome();

    await ensureHouseLocalSession();

    expect(householdIds()).toEqual([own]);
    expect(getLocalHouseLedger().household.name).toBe('Maple Grove');
    expect(isAwaitingHouseEnrolment(own)).toBe(false);
    expect(getHouseLocalBootstrapState()).toEqual({ status: 'open', householdId: own });
  });
});

describe('the way out of the recover-this-home state', () => {
  it('leaves it by itself the moment the key arrives', async () => {
    // The state is DERIVED from the property set on every ledger change, not
    // remembered from what the bootstrap decided. That is the difference between
    // a member whose screen unblocks when their other phone approves them and one
    // who has to relaunch the app to find out that it did.
    accountOwns([REAL_HOME]);
    await ensureHouseLocalSession();
    expect(getHouseLocalBootstrapState()).toMatchObject({ status: 'recover-this-home' });

    await installHouseholdKeys(
      { householdId: REAL_HOME.id, hdk: new Uint8Array(32), keyEpoch: 1 },
      REAL_HOME.id,
    );

    expect(getHouseLocalBootstrapState()).toEqual({ status: 'open', householdId: REAL_HOME.id });
  });

  it('mints on an explicit "start a new home", and only then', async () => {
    // The escape hatch. A member whose other phone is gone — or who is offline
    // and does not want to wait — can still get a home; it just has to be asked
    // for by a person rather than guessed at by a bootstrap. This is the ONLY
    // mint that survives an unknown or already-owned account.
    noNetwork();
    await ensureHouseLocalSession();
    expect(isLocalHouseSessionOpen()).toBe(false);

    await startNewHouseholdOnThisDevice('Ada’s New Place');

    expect(listLocalHouseProperties()).toHaveLength(1);
    expect(getLocalHouseLedger().household.name).toBe('Ada’s New Place');
    expect(getHouseLocalBootstrapState()).toMatchObject({ status: 'open' });
  });

  it('adds the new home BESIDE the ones waiting, never instead of them', async () => {
    // Dropping the placeholders would take away the recovery the member may
    // still complete tomorrow, from a phone they cannot reach today.
    accountOwns([REAL_HOME]);
    await ensureHouseLocalSession();

    await startNewHouseholdOnThisDevice('Ada’s New Place');

    expect(householdIds()).toHaveLength(2);
    expect(householdIds()).toContain(REAL_HOME.id);
    expect(isAwaitingHouseEnrolment(REAL_HOME.id)).toBe(true);
    expect(getLocalHouseLedger().household.name).toBe('Ada’s New Place');
  });
});

describe('two bootstraps racing', () => {
  /**
   * `ensureHouseLocalSession` is floated from `authStore` on sign-in AND on
   * rehydrate, so two of them in flight at once is the ordinary case, not a
   * stress test. The mint/adopt decision is taken INSIDE `queueSessionWork`
   * (engine.ts) for exactly this reason: the second caller queues behind the
   * first and then finds a session already open. Taken outside the chain, both
   * would see an empty device and both would act on it.
   */
  it('creates nothing at all on a new account, however many bootstraps run', async () => {
    accountOwns([]);

    await Promise.all([ensureHouseLocalSession(), ensureHouseLocalSession()]);

    expect(listLocalHouseProperties()).toEqual([]);
  });

  it('still creates one home, not two, when the member finally asks', async () => {
    // The race that mattered when the bootstrap minted: two of these in flight
    // at once is the ordinary case, and both would have acted on the same empty
    // device. Now the mint is a person's tap and the bootstraps are what run
    // around it — before and after, concurrent with it — and exactly one home
    // must come out the other side.
    accountOwns([]);

    await Promise.all([ensureHouseLocalSession(), ensureHouseLocalSession()]);
    await startNewHouseholdOnThisDevice('Maple Street House');
    await ensureHouseLocalSession();

    expect(listLocalHouseProperties()).toHaveLength(1);
    expect(getLocalHouseLedger().household.name).toBe('Maple Street House');
  });

  it('asks the control plane once, because the second call is no longer empty', async () => {
    accountOwns([REAL_HOME]);

    await Promise.all([ensureHouseLocalSession(), ensureHouseLocalSession()]);

    expect(householdIds()).toEqual([REAL_HOME.id]);
    expect(controlPlaneListCalls()).toBe(1);
  });

  it('adopts one session per home even when both bootstraps land on the adopt path', async () => {
    accountOwns([REAL_HOME, CABIN]);

    await ensureHouseLocalSession();
    await ensureHouseLocalSession();

    expect(householdIds()).toEqual([CABIN.id, REAL_HOME.id].sort());
  });
});
