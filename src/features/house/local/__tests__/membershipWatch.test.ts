/**
 * Being removed from a home has to take that home OFF the phone.
 *
 * The bug this pins is a data-retention one, not a stale-cache one. Leaving is
 * already an explicit, confirmed act with a local erasure attached
 * (`HousePropertiesScreen` → `removeLocalHouseProperty`). The two exits that
 * happen on somebody ELSE's phone had no local half at all:
 *
 *  - an owner removes a member — performed on the owner's device, so the removed
 *    member's phone was told nothing it acted on and kept every row of a home it
 *    is no longer in, indefinitely;
 *  - a member leaves from one of their two phones — the Worker deliberately
 *    sends the leaver no notification, so the second phone learned nothing.
 *
 * These run against the real engine and the in-memory store, so "erased" here
 * means the rows genuinely go, through the same `removeLocalHouseProperty` the
 * Leave button uses — not that a list stopped mentioning the property.
 *
 * The control plane is the only thing mocked, because it is the only thing that
 * decides: every case below is really a statement about what evidence is allowed
 * to delete somebody's home. Kept deliberately parallel to Budget's
 * `features/budget/local/__tests__/membershipWatch.test.ts` — the evidence rules
 * are the part that must not drift between the two.
 */
const mockRemoteHouseholds = jest.fn<Promise<{ id: string }[]>, []>();
const mockRegistered = new Set<string>();
const mockNoticeStore = new Map<string, string>();

jest.mock('../controlPlaneClient', () => ({
  listControlPlaneHouseholds: () => mockRemoteHouseholds(),
  houseHouseholdWasRegistered: (householdId: string) =>
    Promise.resolve(mockRegistered.has(householdId)),
}));

jest.mock('../flag', () => ({ isHouseLocalFirst: () => true }));

/** The two settled chores, stubbed — both asserted, neither exercised. */
const mockRepublishStore = jest.fn();
const mockSyncReminders = jest.fn((_options?: { includeColdProperties?: boolean }) =>
  Promise.resolve(0),
);
jest.mock('../ensureSession', () => ({
  syncHouseholdStoreFromLocalLedger: () => mockRepublishStore(),
}));
jest.mock('../reminders/houseLocalReminders', () => ({
  syncHouseLocalReminders: (options: unknown) =>
    mockSyncReminders(options as { includeColdProperties?: boolean }),
}));

/** Who the next request would be sent as. Moved by the account-switch case. */
let mockAuthUserId: string | null = 'user-watch-house';
jest.mock('@stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({
      user: mockAuthUserId
        ? { id: mockAuthUserId, display_name: 'Тест', email: 't@e.co' }
        : null,
    }),
  },
}));

/**
 * Only `storageHelpers` is swapped. The rest of the module is the real one:
 * `persistence.ts` reaches for `asyncStorage` out of the same file, and the
 * engine cannot open a session without it.
 */
jest.mock('@services/storage', () => ({
  ...jest.requireActual('@services/storage'),
  storageHelpers: {
    getString: (key: string) => Promise.resolve(mockNoticeStore.get(key)),
    setString: (key: string, value: string) => {
      mockNoticeStore.set(key, value);
      return Promise.resolve();
    },
  },
}));

import {
  activateLocalHouseProperty,
  adoptJoinedHousehold,
  createLocalHouseProperty,
  getLocalHouseLedger,
  getLocalHouseLedgerFor,
  getLocalHouseStore,
  listLocalHouseProperties,
  mutateLocalHouseLedger,
  openLocalHouseSession,
  resetLocalHouseSession,
} from '../engine';
import { newLocalId } from '../ids';
import {
  purgeRevokedHouseProperties,
  resetHouseMembershipWatch,
  useHouseMembershipLosses,
} from '../membershipWatch';

import { taskRow } from './houseLedgerTestKit';

const USER = 'user-watch-house';

/**
 * Two properties, both SHARED — the shape a removal actually happens in. The
 * marker is what says "shared"; `membershipWatch` reads it and nothing else, so
 * the fixture writes it exactly where the app would.
 */
async function twoSharedProperties(): Promise<{ a: string; b: string }> {
  await resetLocalHouseSession();
  const first = await openLocalHouseSession({ userId: USER, displayName: 'Maple Grove' });
  const second = await createLocalHouseProperty({ displayName: 'Lakeside Cottage' });
  mockRegistered.add(first.household.id);
  mockRegistered.add(second.household.id);
  return { a: first.household.id, b: second.household.id };
}

/** Writes go through the ACTIVE property — naming one means activating it. */
async function addTask(householdId: string, title: string): Promise<string> {
  await activateLocalHouseProperty(householdId);
  const id = newLocalId('task');
  await mutateLocalHouseLedger(
    (ledger) => {
      ledger.tasks.push(taskRow(id, { title, household_id: householdId }) as never);
    },
    { opType: 'TASK_CREATE', entityType: 'task', entityId: id, payload: { title } },
  );
  return id;
}

beforeEach(() => {
  mockRegistered.clear();
  mockNoticeStore.clear();
  mockRemoteHouseholds.mockReset();
  mockRepublishStore.mockClear();
  mockSyncReminders.mockClear();
  mockAuthUserId = USER;
  resetHouseMembershipWatch();
});

afterEach(async () => {
  await resetLocalHouseSession();
});

describe('a membership the control plane no longer lists', () => {
  it('erases that home from this device and leaves the other untouched', async () => {
    const { a, b } = await twoSharedProperties();
    const kept = await addTask(a, 'stays');
    await addTask(b, 'goes with it');
    await activateLocalHouseProperty(a);
    mockRemoteHouseholds.mockResolvedValue([{ id: a }]);

    const losses = await purgeRevokedHouseProperties('test');

    expect(losses.map((loss) => loss.householdId)).toEqual([b]);
    expect(listLocalHouseProperties().map((p) => p.householdId)).toEqual([a]);
    // The rows are GONE, not merely unlisted — this is the whole point.
    await expect(getLocalHouseLedgerFor(b)).rejects.toBeTruthy();
    const ledgerA = await getLocalHouseLedgerFor(a);
    expect(ledgerA.tasks.map((row) => row.id)).toEqual([kept]);
  });

  it('leaves nothing of the home behind — identity, keys or markers', async () => {
    const { a, b } = await twoSharedProperties();
    await addTask(b, 'goes');
    await activateLocalHouseProperty(a);
    const store = getLocalHouseStore();
    await store.setMeta(`lf.cp.registered:${b}`, '1');
    mockRemoteHouseholds.mockResolvedValue([{ id: a }]);

    await purgeRevokedHouseProperties('test');

    // The identity blob carries this property's device keypair AND its key ring,
    // so blanking it is what makes the erasure real rather than a matter of the
    // rows being unreachable.
    expect(await store.getMeta(`lf.cp.registered:${b}`)).toBeFalsy();
    // …and the property that stayed keeps its own, untouched.
    expect(listLocalHouseProperties().map((p) => p.householdId)).toEqual([a]);
  });

  it('mints a fresh empty home when the revoked one was the only one', async () => {
    await resetLocalHouseSession();
    const only = await openLocalHouseSession({ userId: USER, displayName: 'Shared home' });
    mockRegistered.add(only.household.id);
    await addTask(only.household.id, 'goes');
    mockRemoteHouseholds.mockResolvedValue([]);

    await purgeRevokedHouseProperties('test');

    // `removeLocalHouseProperty` refuses to drop the last property, and every
    // House screen reads the active ledger — so the revoked one is dropped
    // against a freshly minted empty home rather than kept.
    const held = listLocalHouseProperties();
    expect(held).toHaveLength(1);
    expect(held[0]!.householdId).not.toBe(only.household.id);
    expect(getLocalHouseLedger().tasks).toHaveLength(0);
    await expect(getLocalHouseLedgerFor(only.household.id)).rejects.toBeTruthy();
  });

  it('records the notice that is the only account of why the home went', async () => {
    const { a, b } = await twoSharedProperties();
    await activateLocalHouseProperty(a);
    mockRemoteHouseholds.mockResolvedValue([{ id: a }]);

    await purgeRevokedHouseProperties('test');

    const [notice] = useHouseMembershipLosses.getState().losses;
    expect(notice).toMatchObject({ householdId: b, householdName: 'Lakeside Cottage' });
    // Persisted, because the home it describes is gone and nothing in engine
    // state can re-derive it for the next launch.
    expect(mockNoticeStore.get('house-membership-losses-v1')).toContain(b);
  });

  it('keeps a notice from an earlier launch that nobody has read yet', async () => {
    // A background sync is usually the first thing to touch this store on a
    // launch — no panel has mounted, so the in-memory list is empty. Merging
    // against THAT would silently drop the explanation for a home removed last
    // week, which is the one the member has still not seen.
    mockNoticeStore.set(
      'house-membership-losses-v1',
      JSON.stringify([
        { householdId: 'hh_old', householdName: 'Last week', at: new Date().toISOString() },
      ]),
    );
    const { a, b } = await twoSharedProperties();
    await activateLocalHouseProperty(a);
    mockRemoteHouseholds.mockResolvedValue([{ id: a }]);

    await purgeRevokedHouseProperties('test');

    expect(useHouseMembershipLosses.getState().losses.map((l) => l.householdId)).toEqual([
      b,
      'hh_old',
    ]);
  });

  it('republishes the household store and reschedules the reminders', async () => {
    const { a } = await twoSharedProperties();
    await activateLocalHouseProperty(a);
    mockRemoteHouseholds.mockResolvedValue([{ id: a }]);

    await purgeRevokedHouseProperties('test');

    // A BACKGROUND property's removal emits no ledger change, so without the
    // explicit republish it would stay in the switcher — and every domain API is
    // called with what that store holds.
    expect(mockRepublishStore).toHaveBeenCalled();
    // Cold properties included: the purge can happen while the member is looking
    // at a different home, and the cold ones are exactly the ones whose
    // reminders nobody has re-derived this session.
    expect(mockSyncReminders).toHaveBeenCalledWith({ includeColdProperties: true });
  });
});

describe('what is NOT allowed to delete a home', () => {
  it('keeps a private property, which is absent from the list because it was never shared', async () => {
    await resetLocalHouseSession();
    const first = await openLocalHouseSession({ userId: USER, displayName: 'Maple Grove' });
    const second = await createLocalHouseProperty({ displayName: 'Private home' });
    // Only the first ever earned a server row.
    mockRegistered.add(first.household.id);
    mockRemoteHouseholds.mockResolvedValue([{ id: first.household.id }]);

    const losses = await purgeRevokedHouseProperties('test');

    expect(losses).toEqual([]);
    expect(listLocalHouseProperties().map((p) => p.householdId)).toEqual(
      expect.arrayContaining([first.household.id, second.household.id]),
    );
  });

  it('keeps everything when the household list does not load — offline is not an answer', async () => {
    const { a, b } = await twoSharedProperties();
    await activateLocalHouseProperty(a);
    mockRemoteHouseholds.mockRejectedValue(new Error('Network Error'));

    const losses = await purgeRevokedHouseProperties('test');

    expect(losses).toEqual([]);
    expect(listLocalHouseProperties()).toHaveLength(2);
    await expect(getLocalHouseLedgerFor(b)).resolves.toBeTruthy();
  });

  it('keeps a property that is awaiting enrolment — it is absent by definition', async () => {
    await resetLocalHouseSession();
    const first = await openLocalHouseSession({ userId: USER, displayName: 'Maple Grove' });
    const claimed = await adoptJoinedHousehold({
      householdId: 'hh_claimed_1',
      displayName: 'Their home',
    });
    mockRegistered.add(first.household.id);
    // A claim registers the household it claimed, so the marker alone would make
    // it a candidate; `useHouseJoinWait` owns this ending, not this file.
    mockRegistered.add(claimed.household.id);
    mockRemoteHouseholds.mockResolvedValue([{ id: first.household.id }]);

    const losses = await purgeRevokedHouseProperties('test');

    expect(losses).toEqual([]);
    expect(listLocalHouseProperties().map((p) => p.householdId)).toContain(claimed.household.id);
  });

  it('refuses to answer for a different account — the one COMPLETE-but-wrong listing', async () => {
    // The account-switch gap: `apiClient` sends whatever token the auth store
    // currently holds, and the engine is torn down and reopened around a switch
    // rather than atomically with it. Ask in that gap and the listing is a
    // correct 200 — of somebody else's households — and every property here
    // would look revoked. Pagination and enrolment cannot produce a partial
    // listing (no LIMIT; `approveInvite` writes the membership row inside the
    // approving request); this can, so it is guarded rather than reasoned about.
    const { a } = await twoSharedProperties();
    await activateLocalHouseProperty(a);
    mockRemoteHouseholds.mockResolvedValue([]);
    mockAuthUserId = 'a-completely-different-account';

    const losses = await purgeRevokedHouseProperties('test');

    expect(losses).toEqual([]);
    expect(listLocalHouseProperties()).toHaveLength(2);
    // And it does not even ask: an answer for the wrong account is worse than
    // no answer, so the round trip is not made.
    expect(mockRemoteHouseholds).not.toHaveBeenCalled();
  });

  it('refuses to answer with nobody signed in', async () => {
    const { a } = await twoSharedProperties();
    await activateLocalHouseProperty(a);
    mockRemoteHouseholds.mockResolvedValue([]);
    mockAuthUserId = null;

    expect(await purgeRevokedHouseProperties('test')).toEqual([]);
    expect(listLocalHouseProperties()).toHaveLength(2);
    expect(mockRemoteHouseholds).not.toHaveBeenCalled();
  });

  it('asks nothing of the network when every property is private', async () => {
    await resetLocalHouseSession();
    await openLocalHouseSession({ userId: USER, displayName: 'Maple Grove' });

    await purgeRevokedHouseProperties('test');

    expect(mockRemoteHouseholds).not.toHaveBeenCalled();
  });
});

describe('how often it asks', () => {
  it('throttles the automatic triggers — a ten-second join poll must not become six GETs a minute', async () => {
    const { a } = await twoSharedProperties();
    await activateLocalHouseProperty(a);
    mockRemoteHouseholds.mockResolvedValue([{ id: a }]);

    await purgeRevokedHouseProperties('sync');
    await purgeRevokedHouseProperties('sync');

    expect(mockRemoteHouseholds).toHaveBeenCalledTimes(1);
  });

  it('forces past the throttle for the removal push', async () => {
    const { a } = await twoSharedProperties();
    await activateLocalHouseProperty(a);
    mockRemoteHouseholds.mockResolvedValue([{ id: a }]);

    await purgeRevokedHouseProperties('sync');
    await purgeRevokedHouseProperties('push-member-removed', { force: true });

    expect(mockRemoteHouseholds).toHaveBeenCalledTimes(2);
  });

  it('does not stamp the throttle on a failed listing — the next trigger still asks', async () => {
    const { a } = await twoSharedProperties();
    await activateLocalHouseProperty(a);
    mockRemoteHouseholds.mockRejectedValueOnce(new Error('Network Error'));
    mockRemoteHouseholds.mockResolvedValue([{ id: a }]);

    await purgeRevokedHouseProperties('sync');
    await purgeRevokedHouseProperties('sync');

    expect(mockRemoteHouseholds).toHaveBeenCalledTimes(2);
  });
});
