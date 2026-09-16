/**
 * Being removed from a household has to take that household OFF the phone.
 *
 * The bug this pins is a data-retention one, not a stale-cache one. Leaving is
 * already an explicit, confirmed act with a local erasure attached
 * (`BudgetHouseholdScreen` → `removeLocalBudgetHousehold`). The two exits that
 * happen on somebody ELSE's phone had no local half at all:
 *
 *  - an owner removes a member — performed on the owner's device, so the
 *    removed member's phone was told nothing it acted on and kept every row of
 *    a household it is no longer in, indefinitely;
 *  - a member leaves from one of their two phones — the Worker deliberately
 *    sends the leaver no notification, so the second phone learned nothing.
 *
 * These run against the real engine and the in-memory store
 * (`openBudgetLocalFirstStore` returns a module-level `MemoryLocalFirstStore`
 * under Jest), so "erased" here means the rows genuinely go, through the same
 * `removeLocalBudgetHousehold` the Leave button uses — not that a list stopped
 * mentioning the household.
 *
 * The control plane is the only thing mocked, because it is the only thing that
 * decides: every case below is really a statement about what evidence is
 * allowed to delete somebody's budget.
 */
const mockRemoteHouseholds = jest.fn<Promise<{ id: string; role?: string }[]>, []>();
const mockRegistered = new Set<string>();
const mockNoticeStore = new Map<string, string>();

jest.mock('../controlPlaneClient', () => ({
  listControlPlaneHouseholds: () => mockRemoteHouseholds(),
  budgetHouseholdWasRegistered: (householdId: string) =>
    Promise.resolve(mockRegistered.has(householdId)),
}));

jest.mock('../flag', () => ({ isBudgetLocalFirst: () => true }));

/** The three post-purge chores, stubbed — each is asserted, none is exercised. */
const mockRepublishStore = jest.fn();
const mockRegisterPush = jest.fn(() => Promise.resolve());
const mockSyncReminders = jest.fn(() => Promise.resolve());
jest.mock('../ensureSession', () => ({
  syncHouseholdStoreFromLocalLedger: () => mockRepublishStore(),
}));
jest.mock('../pushWake', () => ({
  registerBudgetLocalPushToken: () => mockRegisterPush(),
}));
jest.mock('../reminders/budgetLocalReminders', () => ({
  syncBudgetLocalReminders: () => mockSyncReminders(),
}));

/** Who the next request would be sent as. Moved by the account-switch case. */
let mockAuthUserId: string | null = 'user-watch-1';
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
  activateLocalBudgetHousehold,
  adoptJoinedHousehold,
  createLocalBudgetHousehold,
  getLocalLedger,
  getLocalLedgerFor,
  getLocalStore,
  listLocalBudgetHouseholds,
  mutateLocalLedger,
  openLocalBudgetSession,
  resetLocalBudgetSession,
} from '../engine';
import { BudgetLocalUnknownHouseholdError } from '../errors';
import { newLocalId } from '../ids';
import {
  purgeRevokedBudgetHouseholds,
  resetBudgetMembershipWatch,
  useBudgetMembershipLosses,
} from '../membershipWatch';

import { expenseRow } from './ledgerTestKit';

const USER = 'user-watch-1';

/**
 * Two households, both SHARED — the shape a removal actually happens in. The
 * marker is what says "shared"; `membershipWatch` reads it and nothing else, so
 * the fixture writes it exactly where the app would.
 */
async function twoSharedHouseholds(): Promise<{ a: string; b: string }> {
  await resetLocalBudgetSession();
  const first = await openLocalBudgetSession({ userId: USER, displayName: 'Everyday budget' });
  const second = await createLocalBudgetHousehold({ displayName: 'Cottage budget' });
  mockRegistered.add(first.household.id);
  mockRegistered.add(second.household.id);
  return { a: first.household.id, b: second.household.id };
}

/** Writes go through the ACTIVE household — naming one means activating it. */
async function addExpense(householdId: string, title: string): Promise<string> {
  await activateLocalBudgetHousehold(householdId);
  const id = newLocalId('exp');
  await mutateLocalLedger(
    (ledger) => {
      ledger.expenses.push(expenseRow(id, { title, household_id: householdId }) as never);
    },
    { opType: 'EXPENSE_CREATE', entityType: 'expense', entityId: id, payload: { title } },
  );
  return id;
}

beforeEach(() => {
  mockRegistered.clear();
  mockNoticeStore.clear();
  mockRemoteHouseholds.mockReset();
  mockRepublishStore.mockClear();
  mockRegisterPush.mockClear();
  mockSyncReminders.mockClear();
  mockAuthUserId = USER;
  resetBudgetMembershipWatch();
});

describe('a membership the control plane no longer lists', () => {
  it('erases that household from this device and leaves the other untouched', async () => {
    const { a, b } = await twoSharedHouseholds();
    const kept = await addExpense(a, 'stays');
    await addExpense(b, 'goes with it');
    await activateLocalBudgetHousehold(a);
    mockRemoteHouseholds.mockResolvedValue([{ id: a }]);

    const losses = await purgeRevokedBudgetHouseholds('test');

    expect(losses.map((loss) => loss.householdId)).toEqual([b]);
    expect(listLocalBudgetHouseholds().map((h) => h.householdId)).toEqual([a]);
    // The rows are GONE, not merely unlisted — this is the whole point.
    await expect(getLocalLedgerFor(b)).rejects.toBeInstanceOf(BudgetLocalUnknownHouseholdError);
    const ledgerA = await getLocalLedgerFor(a);
    expect(ledgerA.expenses.map((row) => row.id)).toEqual([kept]);
  });

  it('leaves nothing of the household behind — identity, keys or watermarks', async () => {
    const { a, b } = await twoSharedHouseholds();
    await addExpense(b, 'goes');
    await activateLocalBudgetHousehold(a);
    const store = getLocalStore();
    await store.setMeta(`lf.checkpoint.epoch:${b}`, '4');
    await store.setMeta(`lf.cp.registered:${b}`, '1');
    mockRemoteHouseholds.mockResolvedValue([{ id: a }]);

    await purgeRevokedBudgetHouseholds('test');

    // The identity blob carries this household's device keypair AND its key
    // ring; a checkpoint watermark left behind closes the bootstrap window of
    // a later re-join, which lands back on the SAME household id.
    for (const key of [
      `ledger.identity.v2:${b}`,
      `lf.checkpoint.vv:${b}`,
      `lf.checkpoint.epoch:${b}`,
      `lf.cp.registered:${b}`,
    ]) {
      expect(await store.getMeta(key)).toBeFalsy();
    }
    expect(await store.getMeta(`ledger.identity.v2:${a}`)).toBeTruthy();
  });

  it('mints a fresh empty household when the revoked one was the only one', async () => {
    await resetLocalBudgetSession();
    const only = await openLocalBudgetSession({ userId: USER, displayName: 'Shared budget' });
    mockRegistered.add(only.household.id);
    await addExpense(only.household.id, 'goes');
    mockRemoteHouseholds.mockResolvedValue([]);

    await purgeRevokedBudgetHouseholds('test');

    // `removeLocalBudgetHousehold` refuses to drop the last household, and every
    // Budget screen throws without a ledger — so the revoked one is dropped
    // against a freshly minted empty household rather than kept.
    const held = listLocalBudgetHouseholds();
    expect(held).toHaveLength(1);
    expect(held[0]!.householdId).not.toBe(only.household.id);
    expect(getLocalLedger().expenses).toHaveLength(0);
    expect(getLocalLedger().categories.length).toBeGreaterThan(0);
    await expect(getLocalLedgerFor(only.household.id)).rejects.toBeInstanceOf(
      BudgetLocalUnknownHouseholdError,
    );
  });

  it('records the notice that is the only account of why the budget went', async () => {
    const { a, b } = await twoSharedHouseholds();
    await activateLocalBudgetHousehold(a);
    mockRemoteHouseholds.mockResolvedValue([{ id: a }]);

    await purgeRevokedBudgetHouseholds('test');

    const [notice] = useBudgetMembershipLosses.getState().losses;
    expect(notice).toMatchObject({ householdId: b, householdName: 'Cottage budget' });
    // Persisted, because the household it describes is gone and nothing in
    // engine state can re-derive it for the next launch.
    expect(mockNoticeStore.get('budget-membership-losses-v1')).toContain(b);
  });

  it('keeps a notice from an earlier launch that nobody has read yet', async () => {
    // A background sync is usually the first thing to touch this store on a
    // launch — no panel has mounted, so the in-memory list is empty. Merging
    // against THAT would silently drop the explanation for a household removed
    // last week, which is the one the member has still not seen.
    mockNoticeStore.set(
      'budget-membership-losses-v1',
      JSON.stringify([
        { householdId: 'hh_old', householdName: 'Last week', at: new Date().toISOString() },
      ]),
    );
    const { a, b } = await twoSharedHouseholds();
    await activateLocalBudgetHousehold(a);
    mockRemoteHouseholds.mockResolvedValue([{ id: a }]);

    await purgeRevokedBudgetHouseholds('test');

    expect(useBudgetMembershipLosses.getState().losses.map((l) => l.householdId)).toEqual([
      b,
      'hh_old',
    ]);
  });

  it('republishes the household store and reschedules the reminders', async () => {
    const { a } = await twoSharedHouseholds();
    await activateLocalBudgetHousehold(a);
    mockRemoteHouseholds.mockResolvedValue([{ id: a }]);

    await purgeRevokedBudgetHouseholds('test');

    // A BACKGROUND household's removal emits no ledger change, so without the
    // explicit republish it would stay in the switcher — and every domain API
    // is called with what that store holds.
    expect(mockRepublishStore).toHaveBeenCalled();
    // Notifications scheduled off rows that no longer exist.
    expect(mockSyncReminders).toHaveBeenCalled();
    // The push re-registration is deliberately not asserted: it is reached
    // through a dynamic import (`pushWake` imports the orchestrator, which
    // imports the watch), and Jest runs without `--experimental-vm-modules`.
  });
});

describe('what is NOT allowed to delete a budget', () => {
  it('keeps a solo household, which is absent from the list because it was never shared', async () => {
    await resetLocalBudgetSession();
    const first = await openLocalBudgetSession({ userId: USER, displayName: 'Everyday budget' });
    const second = await createLocalBudgetHousehold({ displayName: 'Private budget' });
    // Only the first ever earned a server row.
    mockRegistered.add(first.household.id);
    mockRemoteHouseholds.mockResolvedValue([{ id: first.household.id }]);

    const losses = await purgeRevokedBudgetHouseholds('test');

    expect(losses).toEqual([]);
    expect(listLocalBudgetHouseholds().map((h) => h.householdId)).toEqual(
      expect.arrayContaining([first.household.id, second.household.id]),
    );
  });

  it('keeps everything when the household list does not load — offline is not an answer', async () => {
    const { a, b } = await twoSharedHouseholds();
    await activateLocalBudgetHousehold(a);
    mockRemoteHouseholds.mockRejectedValue(new Error('Network Error'));

    const losses = await purgeRevokedBudgetHouseholds('test');

    expect(losses).toEqual([]);
    expect(listLocalBudgetHouseholds()).toHaveLength(2);
    await expect(getLocalLedgerFor(b)).resolves.toBeTruthy();
  });

  it('keeps a household that is awaiting enrolment — it is absent by definition', async () => {
    await resetLocalBudgetSession();
    const first = await openLocalBudgetSession({ userId: USER, displayName: 'Everyday budget' });
    const claimed = await adoptJoinedHousehold({
      householdId: 'hh_claimed_1',
      displayName: 'Their budget',
    });
    mockRegistered.add(first.household.id);
    // A claim registers the household it claimed, so the marker alone would
    // make it a candidate; `useBudgetJoinWait` owns this ending, not this file.
    mockRegistered.add(claimed.household.id);
    mockRemoteHouseholds.mockResolvedValue([{ id: first.household.id }]);

    const losses = await purgeRevokedBudgetHouseholds('test');

    expect(losses).toEqual([]);
    expect(listLocalBudgetHouseholds().map((h) => h.householdId)).toContain(
      claimed.household.id,
    );
  });

  it('refuses to answer for a different account — the one COMPLETE-but-wrong listing', async () => {
    // The account-switch gap: `apiClient` sends whatever token the auth store
    // currently holds, and the engine is torn down and reopened around a switch
    // rather than atomically with it. Ask in that gap and the listing is a
    // correct 200 — of somebody else's households — and every household here
    // would look revoked. Pagination and enrolment cannot produce a partial
    // listing (no LIMIT; `approveInvite` writes the membership row inside the
    // approving request); this can, so it is guarded rather than reasoned about.
    const { a } = await twoSharedHouseholds();
    await activateLocalBudgetHousehold(a);
    mockRemoteHouseholds.mockResolvedValue([]);
    mockAuthUserId = 'a-completely-different-account';

    const losses = await purgeRevokedBudgetHouseholds('test');

    expect(losses).toEqual([]);
    expect(listLocalBudgetHouseholds()).toHaveLength(2);
    // And it does not even ask: an answer for the wrong account is worse than
    // no answer, so the round trip is not made.
    expect(mockRemoteHouseholds).not.toHaveBeenCalled();
  });

  it('refuses to answer with nobody signed in', async () => {
    const { a } = await twoSharedHouseholds();
    await activateLocalBudgetHousehold(a);
    mockRemoteHouseholds.mockResolvedValue([]);
    mockAuthUserId = null;

    expect(await purgeRevokedBudgetHouseholds('test')).toEqual([]);
    expect(listLocalBudgetHouseholds()).toHaveLength(2);
    expect(mockRemoteHouseholds).not.toHaveBeenCalled();
  });

  it('asks nothing of the network when every household is solo', async () => {
    await resetLocalBudgetSession();
    await openLocalBudgetSession({ userId: USER, displayName: 'Everyday budget' });

    await purgeRevokedBudgetHouseholds('test');

    expect(mockRemoteHouseholds).not.toHaveBeenCalled();
  });
});

describe('how often it asks', () => {
  it('throttles the automatic triggers — a ten-second join poll must not become six GETs a minute', async () => {
    const { a } = await twoSharedHouseholds();
    await activateLocalBudgetHousehold(a);
    mockRemoteHouseholds.mockResolvedValue([{ id: a }]);

    await purgeRevokedBudgetHouseholds('sync');
    await purgeRevokedBudgetHouseholds('sync');

    expect(mockRemoteHouseholds).toHaveBeenCalledTimes(1);
  });

  it('forces past the throttle for the removal push', async () => {
    const { a } = await twoSharedHouseholds();
    await activateLocalBudgetHousehold(a);
    mockRemoteHouseholds.mockResolvedValue([{ id: a }]);

    await purgeRevokedBudgetHouseholds('sync');
    await purgeRevokedBudgetHouseholds('push-member-removed', { force: true });

    expect(mockRemoteHouseholds).toHaveBeenCalledTimes(2);
  });

  it('does not stamp the throttle on a failed listing — the next trigger still asks', async () => {
    const { a } = await twoSharedHouseholds();
    await activateLocalBudgetHousehold(a);
    mockRemoteHouseholds.mockRejectedValueOnce(new Error('Network Error'));
    mockRemoteHouseholds.mockResolvedValue([{ id: a }]);

    await purgeRevokedBudgetHouseholds('sync');
    await purgeRevokedBudgetHouseholds('sync');

    expect(mockRemoteHouseholds).toHaveBeenCalledTimes(2);
  });
});

/**
 * A membership can change shape as well as end, and only the ending was ever
 * mirrored here.
 *
 * `my_role` is sealed into the local record at join and never rewritten, so a
 * promotion — always performed on somebody ELSE's phone — never reached the
 * member it happened to. That is not a mislabelled row:
 * `maybePublishCheckpoint` is owner-only and reads this field, so a promoted
 * member goes on declining to publish the household snapshot on every sync,
 * and a joining member has nothing else that can hand them the months before
 * their join. `Sweet Home` sat exactly there — one phone holding 144 of 586
 * records, both reporting a healthy sync.
 */
describe('a role the control plane has changed', () => {
  it('applies a demotion, and the promotion that puts it back', async () => {
    const { a } = await twoSharedHouseholds();
    await activateLocalBudgetHousehold(a);
    // Created households start as owner — see `buildHousehold`.
    await expect(
      getLocalLedgerFor(a).then((l) => l.household.my_role),
    ).resolves.toBe('owner');

    mockRemoteHouseholds.mockResolvedValue([{ id: a, role: 'ADULT' }]);
    await purgeRevokedBudgetHouseholds('test', { force: true });
    await expect(
      getLocalLedgerFor(a).then((l) => l.household.my_role),
    ).resolves.toBe('member');

    mockRemoteHouseholds.mockResolvedValue([{ id: a, role: 'OWNER' }]);
    await purgeRevokedBudgetHouseholds('test', { force: true });
    await expect(
      getLocalLedgerFor(a).then((l) => l.household.my_role),
    ).resolves.toBe('owner');
  });

  it('republishes the store once when a role moved, and not at all when none did', async () => {
    const { a, b } = await twoSharedHouseholds();
    await activateLocalBudgetHousehold(a);
    // BOTH listed, so nothing is revoked: a purge republishes the store too,
    // and this case is about the role pass alone.
    mockRemoteHouseholds.mockResolvedValue([
      { id: a, role: 'ADULT' },
      { id: b, role: 'OWNER' },
    ]);

    await purgeRevokedBudgetHouseholds('test', { force: true });
    // One republish for the pass, not one per household that moved.
    expect(mockRepublishStore).toHaveBeenCalledTimes(1);

    // Same answer again: nothing moved, so no screen needs waking.
    mockRepublishStore.mockClear();
    await purgeRevokedBudgetHouseholds('test', { force: true });
    expect(mockRepublishStore).not.toHaveBeenCalled();
  });

  /**
   * The safety case, and the reason this does not reuse `toLegacyRole`.
   *
   * That helper folds anything unrecognised into `member` because it is
   * labelling a row on screen. Here the same fold would DEMOTE on a listing
   * that simply did not carry the field — an older Worker, a trimmed payload —
   * and a wrongly demoted owner stops publishing the snapshot with nothing
   * anywhere to say why. Silence is not an answer.
   */
  it('changes nothing on a listing that carries no role', async () => {
    const { a, b } = await twoSharedHouseholds();
    await activateLocalBudgetHousehold(a);
    mockRemoteHouseholds.mockResolvedValue([{ id: a }, { id: b }]);

    await purgeRevokedBudgetHouseholds('test', { force: true });

    await expect(
      getLocalLedgerFor(a).then((l) => l.household.my_role),
    ).resolves.toBe('owner');
    expect(mockRepublishStore).not.toHaveBeenCalled();
  });

  it('leaves a household the listing does not mention to the revocation path', async () => {
    const { a, b } = await twoSharedHouseholds();
    await activateLocalBudgetHousehold(a);
    // `b` is absent entirely — that is a membership that ended, and the role
    // pass must not touch it on the way past.
    mockRemoteHouseholds.mockResolvedValue([{ id: a, role: 'OWNER' }]);

    const losses = await purgeRevokedBudgetHouseholds('test', { force: true });

    expect(losses.map((loss) => loss.householdId)).toEqual([b]);
    await expect(
      getLocalLedgerFor(a).then((l) => l.household.my_role),
    ).resolves.toBe('owner');
  });
});
