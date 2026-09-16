/**
 * householdStore under Budget V2 local-first (BR-016 B4).
 *
 * The store is a UI cache; the ENGINE owns which households exist and which one
 * is active. Everything asserted here is about keeping those two in step,
 * because a disagreement is not cosmetic: `currentHousehold.id` is what every
 * domain facade is called with (`localSavingsApi`, `localMortgageApi`,
 * `localBudgetLoansApi` all throw on a household mismatch), so a store still
 * pointing at the household the member just left renders Savings, Mortgage and
 * Loans empty while the data sits on disk, decrypted and one id away.
 *
 * The list half has its own history: `fetchHouseholds` used to force
 * `households = [ledger.household]` inline under local-first. That was true when
 * a device held one ledger and is a lie now — it hid every other household from
 * the switcher and, because screens call `fetchHouseholds()` on focus, it
 * deleted a just-created household from the list moments after it appeared.
 * That is exactly what `budget-households.yaml` and
 * `budget-household-switch.yaml` fail on.
 *
 * The engine is mocked; `ensureSession` (the one publisher) is REAL, so these
 * run the actual engine→store mapping rather than a restatement of it.
 */
/* -------------------------------------------------------------------------- */
/* Mocks. The factories only read these bindings when called, which is after    */
/* the module body has initialized them.                                        */
/* -------------------------------------------------------------------------- */

const HH_A = 'hh_local_aaaa';
const HH_B = 'hh_local_bbbb';
const HH_C = 'hh_local_cccc';

let mockLocalFirst = true;
let mockSessionOpen = true;
let mockActiveId: string | null = HH_B;
const mockLedgers = new Map<string, Household>();

const mockList = jest.fn();
const mockActivate = jest.fn();

jest.mock('@features/budget/local/flag', () => ({
  __esModule: true,
  isBudgetLocalFirst: () => mockLocalFirst,
}));

jest.mock('@features/budget/local/engine', () => ({
  __esModule: true,
  isLocalBudgetSessionOpen: () => mockSessionOpen,
  getActiveBudgetHouseholdId: () => mockActiveId,
  // Only the ACTIVE household's ledger is in memory — that is the whole point
  // of lazy hydration, and the reason the store cannot simply read a full
  // `Household` for every household it lists.
  getLocalLedger: () => ({
    version: 1,
    household: mockLedgers.get(mockActiveId ?? ''),
    memberId: 'usr_ada',
    deviceId: 'dev_1',
    conflicts: [],
  }),
  getLocalLedgerFor: async (householdId: string) => ({
    household: mockLedgers.get(householdId),
    memberId: 'usr_ada',
    deviceId: 'dev_1',
  }),
  // Cold and synchronous, like the real one: name and role only, no rows.
  listLocalBudgetHouseholds: () =>
    [...mockLedgers.entries()].map(([householdId, record]) => ({
      householdId,
      deviceId: 'dev_1',
      name: record.name,
      role: record.my_role,
      isActive: householdId === mockActiveId,
      hydrated: householdId === mockActiveId,
      awaitingEnrolment: false,
    })),
  activateLocalBudgetHousehold: (householdId: string) => mockActivate(householdId),
  openLocalBudgetSession: jest.fn(async () => undefined),
  closeAllLocalBudgetSessions: jest.fn(async () => undefined),
  resetLocalBudgetSession: jest.fn(async () => undefined),
  subscribeToLedgerChanges: jest.fn(() => () => undefined),
}));

jest.mock('@api/households', () => ({
  __esModule: true,
  householdsApi: { list: (...args: unknown[]) => mockList(...args) },
}));

import type { Household } from '@api/households';
import { syncHouseholdStoreFromLocalLedger } from '@features/budget/local/ensureSession';
import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';

const s = () => useHouseholdStore.getState();

/** A full server-shaped record — what a HYDRATED household can publish. */
function household(id: string, name: string, overrides: Partial<Household> = {}): Household {
  return {
    id,
    name,
    address_line1: null,
    address_line2: null,
    city: null,
    state_province: null,
    postal_code: null,
    country: null,
    unit_system: null,
    photo_key: null,
    photo_url: null,
    purchase_price: null,
    purchase_date: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    member_count: 1,
    my_role: 'owner',
    ...overrides,
  };
}

/** Resolve on the next microtask, so a floated `void activate(...)` has run. */
const flush = () => Promise.resolve().then(() => undefined);

beforeEach(() => {
  jest.clearAllMocks();
  mockLocalFirst = true;
  mockSessionOpen = true;
  mockActiveId = HH_B;
  mockLedgers.clear();
  mockLedgers.set(HH_A, household(HH_A, 'Maple Street', { city: 'Toronto' }));
  mockLedgers.set(HH_B, household(HH_B, 'Lakeside', { city: 'Ottawa', member_count: 3 }));
  mockLedgers.set(HH_C, household(HH_C, 'The Cabin', { my_role: 'member' }));
  mockActivate.mockImplementation(async (householdId: string) => {
    mockActiveId = householdId;
    return { household: mockLedgers.get(householdId) };
  });
  // `ensureBudgetLocalSession` returns before opening anything when auth has not
  // rehydrated, which is what keeps `fetchHouseholds` here to the publish path
  // these tests are about.
  useAuthStore.setState({ user: null, isAuthenticated: false, hasHydrated: false } as never);
  s().reset();
});

/* -------------------------------------------------------------------------- */

describe('the list is the engine’s, not the open ledger’s', () => {
  it('publishes every household this device holds', async () => {
    await s().fetchHouseholds();

    expect(s().households.map((h) => h.id)).toEqual([HH_A, HH_B, HH_C]);
    expect(s().currentHousehold?.id).toBe(HH_B);
    expect(s().isLoading).toBe(false);
  });

  /**
   * `hh_local_*` households have no D1 row at all, so the server list is not
   * merely redundant under local-first — it is empty, and publishing it would
   * blank the switcher.
   */
  it('never asks D1 for a local-first household set', async () => {
    await s().fetchHouseholds();
    expect(mockList).not.toHaveBeenCalled();
  });

  it('takes the ACTIVE household from the live ledger, in full', async () => {
    await s().fetchHouseholds();

    const active = s().households.find((h) => h.id === HH_B)!;
    // Fields only a hydrated ledger carries — the summary has name and role.
    expect(active.city).toBe('Ottawa');
    expect(active.member_count).toBe(3);
  });

  /**
   * A background household is COLD: `listLocalBudgetHouseholds()` is synchronous
   * and reads no rows, so the only authoritative fields for it are the name and
   * the role. Everything else must come from the record this store published
   * the last time that household was active — inventing values would put a
   * years-old household at the top of a newest-first list.
   */
  it('refreshes a cold household’s name over its last known record', async () => {
    // A has to have been ACTIVE once for the store to hold its full record —
    // that is the only moment a household's rows are in memory at all.
    mockActiveId = HH_A;
    await s().fetchHouseholds();
    const before = s().households.find((h) => h.id === HH_A)!;
    expect(before.city).toBe('Toronto');

    // Switch away, then rename A in the engine — a peer's rename merging into a
    // household that is now cold.
    mockActiveId = HH_B;
    mockLedgers.set(HH_A, household(HH_A, 'Maple Street Renamed', { city: 'Toronto' }));
    syncHouseholdStoreFromLocalLedger();

    const after = s().households.find((h) => h.id === HH_A)!;
    expect(after.name).toBe('Maple Street Renamed');
    // Kept, not re-derived: no hydration was paid to learn it.
    expect(after.city).toBe('Toronto');
    expect(after.created_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('leaves created_at empty for a household it has never seen, so it sorts last honestly', () => {
    // A signed-out-and-back-in device: the persisted list was reset while the
    // ledgers stayed on disk.
    mockActiveId = HH_A;
    syncHouseholdStoreFromLocalLedger();

    const cold = s().households.find((h) => h.id === HH_C)!;
    expect(cold.created_at).toBe('');
    expect(cold.name).toBe('The Cabin');
    expect(cold.my_role).toBe('member');
  });

  it('follows the engine when a household is added', async () => {
    await s().fetchHouseholds();
    expect(s().households).toHaveLength(3);

    // What `createLocalBudgetHousehold` leaves behind — added, NOT activated.
    mockLedgers.set('hh_local_dddd', household('hh_local_dddd', 'E2E Household'));
    syncHouseholdStoreFromLocalLedger();

    expect(s().households.map((h) => h.name)).toContain('E2E Household');
    // Creating is not switching: the member stays where they were.
    expect(s().currentHousehold?.id).toBe(HH_B);
  });

  it('follows the engine when a household is removed', async () => {
    await s().fetchHouseholds();

    mockLedgers.delete(HH_C);
    syncHouseholdStoreFromLocalLedger();

    expect(s().households.map((h) => h.id)).toEqual([HH_A, HH_B]);
  });

  it('does not blank the switcher while the session is closed', async () => {
    await s().fetchHouseholds();
    mockSessionOpen = false;

    syncHouseholdStoreFromLocalLedger();

    expect(s().households).toHaveLength(3);
  });

  it('still fetches from D1 on a server-backed build', async () => {
    mockLocalFirst = false;
    mockList.mockResolvedValue({ households: [household('hh_d1', 'Server household')] });

    await s().fetchHouseholds();

    expect(mockList).toHaveBeenCalledTimes(1);
    expect(s().households.map((h) => h.id)).toEqual(['hh_d1']);
    expect(s().currentHousehold?.id).toBe('hh_d1');
  });
});

describe('setCurrentHousehold moves the ENGINE, not just the store', () => {
  /**
   * The store and the engine disagreeing is the outage: the header names
   * household B while every domain facade still reads and writes A.
   */
  it('activates the engine session for the household it selects', async () => {
    await s().fetchHouseholds();

    s().setCurrentHousehold(mockLedgers.get(HH_A)!);
    await flush();

    expect(mockActivate).toHaveBeenCalledWith(HH_A);
  });

  /**
   * Activation is queued behind the engine's session chain and hydrates the
   * target's rows on its first visit (34–37 µs/row cold), so waiting for it
   * would leave the tap looking dead for up to a second.
   */
  it('shows the new household immediately, before activation resolves', async () => {
    await s().fetchHouseholds();
    let release: () => void = () => undefined;
    mockActivate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve();
        }),
    );

    s().setCurrentHousehold(mockLedgers.get(HH_A)!);

    // Synchronously, with the engine still working.
    expect(s().currentHousehold?.id).toBe(HH_A);
    release();
  });

  /**
   * Screens call this from focus effects. Re-activating is free in the engine
   * but not silent — it rewrites both on-disk pointers and emits a whole-ledger
   * change, repainting every Budget screen.
   */
  it('does not re-activate the household that is already active', async () => {
    await s().fetchHouseholds();

    s().setCurrentHousehold(mockLedgers.get(HH_B)!);
    await flush();

    expect(mockActivate).not.toHaveBeenCalled();
    expect(s().currentHousehold?.id).toBe(HH_B);
  });

  it('keeps the persisted selection when no session is open yet', async () => {
    mockSessionOpen = false;

    s().setCurrentHousehold(mockLedgers.get(HH_A)!);
    await flush();

    // Signed out, or auth still rehydrating: the persisted selection is all
    // there is until `ensureBudgetLocalSession` opens one and publishes over it.
    expect(mockActivate).not.toHaveBeenCalled();
    expect(s().currentHousehold?.id).toBe(HH_A);
  });

  it('leaves the engine alone on a server-backed build', async () => {
    mockLocalFirst = false;

    s().setCurrentHousehold(household('hh_d1', 'Server household'));
    await flush();

    expect(mockActivate).not.toHaveBeenCalled();
    expect(s().currentHousehold?.id).toBe('hh_d1');
  });

  it('clears the selection without touching the engine', async () => {
    await s().fetchHouseholds();

    s().setCurrentHousehold(null);
    await flush();

    expect(s().currentHousehold).toBeNull();
    expect(mockActivate).not.toHaveBeenCalled();
  });

  /**
   * A household this store still lists but the engine holds no ledger for — a
   * D1 row from before local-first, or a stale persisted entry that outlived a
   * sign-out. Republishing the engine's set IS the rollback: keeping the
   * optimistic value would leave the member looking at a household nothing is
   * writing to.
   */
  it('rolls back to the engine’s answer when activation fails', async () => {
    await s().fetchHouseholds();
    const phantom = household('hh_local_gone', 'Phantom');
    s().setHouseholds([...s().households, phantom]);
    mockActivate.mockRejectedValue(new Error('budget_local_unknown_household'));

    s().setCurrentHousehold(phantom);
    expect(s().currentHousehold?.id).toBe('hh_local_gone');

    // Two ticks: the rejection, then the republish inside the catch.
    await flush();
    await flush();

    expect(s().currentHousehold?.id).toBe(HH_B);
    expect(s().households.map((h) => h.id)).toEqual([HH_A, HH_B, HH_C]);
  });
});

describe('the active selection survives a relaunch', () => {
  it('persists the list and the selection, but not the transient flags', async () => {
    await s().fetchHouseholds();
    s().setError('boom');
    s().setLoading(true);

    const persisted = useHouseholdStore.persist.getOptions().partialize?.(s()) as Record<
      string,
      unknown
    >;

    expect(persisted.currentHousehold).toMatchObject({ id: HH_B });
    expect((persisted.households as Household[]).map((h) => h.id)).toEqual([HH_A, HH_B, HH_C]);
    expect(persisted).toHaveProperty('propertyMode');
    // A spinner or an error that outlived the relaunch would be unclearable.
    expect(persisted).not.toHaveProperty('isLoading');
    expect(persisted).not.toHaveProperty('error');
  });

  it('re-selects whatever the engine says is active, not "the first one found"', async () => {
    mockActiveId = HH_C;

    await s().fetchHouseholds();

    expect(s().currentHousehold?.id).toBe(HH_C);
  });
});

describe('list bookkeeping across several households', () => {
  it('updateHousehold renames in the list and in the selection together', async () => {
    await s().fetchHouseholds();

    s().updateHousehold(HH_B, { name: 'Lakeside Cottage' });

    expect(s().households.find((h) => h.id === HH_B)?.name).toBe('Lakeside Cottage');
    expect(s().currentHousehold?.name).toBe('Lakeside Cottage');
  });

  it('updateHousehold leaves the other households alone', async () => {
    await s().fetchHouseholds();

    s().updateHousehold(HH_B, { name: 'Lakeside Cottage' });

    expect(s().households.find((h) => h.id === HH_A)?.name).toBe('Maple Street');
    expect(s().households.find((h) => h.id === HH_C)?.name).toBe('The Cabin');
  });

  /**
   * Leaving `currentHousehold` null when another household remains strands
   * every screen that reads it — MortgageView bails out of loading data — until
   * the next full refresh.
   */
  it('removeHousehold falls back to a survivor and drops the stale roster', async () => {
    await s().fetchHouseholds();
    s().setCurrentHouseholdMembers([{ id: 'usr_ada' }] as never);

    s().removeHousehold(HH_B);

    expect(s().households.map((h) => h.id)).toEqual([HH_A, HH_C]);
    expect(s().currentHousehold?.id).toBe(HH_A);
    // A's data under B's members is the one cross-household bleed a user sees.
    expect(s().currentHouseholdMembers).toEqual([]);
  });

  it('removeHousehold keeps the selection when it was some other household', async () => {
    await s().fetchHouseholds();

    s().removeHousehold(HH_C);

    expect(s().currentHousehold?.id).toBe(HH_B);
  });
});

describe('the active context a screen filters on', () => {
  it('single mode scopes to the selected household alone', async () => {
    await s().fetchHouseholds();

    expect(s().propertyMode).toBe('single');
    expect(s().getActiveHouseholdIds()).toEqual([HH_B]);
    expect(s().isInActiveContext(HH_B)).toBe(true);
    expect(s().isInActiveContext(HH_A)).toBe(false);
  });

  it('all mode spans every household the device holds', async () => {
    await s().fetchHouseholds();

    s().setPropertyMode('all');

    expect(s().getActiveHouseholdIds()).toEqual([HH_A, HH_B, HH_C]);
    expect(s().isInActiveContext(HH_A)).toBe(true);
    expect(s().isInActiveContext('hh_never_held')).toBe(false);
    // The switcher is meaningless when everything is in scope.
    expect(s().showPropertySwitcher).toBe(false);
  });

  it('scopes to nothing when no household is selected', () => {
    expect(s().getActiveHouseholdIds()).toEqual([]);
    expect(s().isInActiveContext(HH_A)).toBe(false);
  });
});
