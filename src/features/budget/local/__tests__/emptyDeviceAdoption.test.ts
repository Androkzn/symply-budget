/**
 * What a fresh install does when the account ALREADY holds households.
 *
 * It used to mint a new empty one, register it on the control plane, and show
 * the member an empty budget while sync reported success — it was syncing
 * correctly, just a household that genuinely had nothing in it. The member's
 * real data sat on their other device, unreachable, and the account collected
 * an orphan household per reinstall.
 *
 * The seeding assertion is the sharp one. `syncOneHousehold` bootstraps from a
 * checkpoint only while this device's version vector is EMPTY, and authoring
 * anything closes that window permanently. Minting seeds 41 default categories;
 * if adoption did the same it would slam the only door the household's history
 * can come through, and the member would hold an empty budget no later sync
 * could ever fill (the failure `joinedHouseholdBootstrap.test.ts` documents).
 */
import '../cryptoPolyfill';

import {
  closeLocalBudgetSession,
  getLocalLedger,
  listLocalBudgetHouseholds,
  openLocalBudgetSession,
  resetLocalBudgetSession,
  type BudgetEmptyDeviceDecision,
} from '../engine';

const USER = 'user-empty-device-1';
const SWEET_HOME = 'hh_local_sweet_home';
const SECOND = 'hh_local_second';

afterEach(async () => {
  await resetLocalBudgetSession();
});

/** A fresh device that is told what the account already holds. */
async function freshInstall(decision: BudgetEmptyDeviceDecision) {
  await resetLocalBudgetSession();
  return openLocalBudgetSession({
    userId: USER,
    displayName: 'Andrei',
    decideEmptyDevice: async () => decision,
  });
}

describe('a fresh install on an account that already holds households', () => {
  it('adopts them instead of minting a new empty one', async () => {
    const ledger = await freshInstall({
      allowMint: false,
      adopt: [
        { householdId: SWEET_HOME, displayName: 'Sweet Home' },
        { householdId: SECOND, displayName: 'Cottage' },
      ],
    });

    // Both are on the device, and NOTHING was minted beside them.
    const held = listLocalBudgetHouseholds().map((h) => h.householdId).sort();
    expect(held).toEqual([SECOND, SWEET_HOME].sort());
    expect(held.some((id) => id.startsWith('hh_local_') && id !== SWEET_HOME && id !== SECOND)).toBe(
      false,
    );

    // Landed on the first, by name rather than the "Shared household" placeholder.
    expect(ledger.household.id).toBe(SWEET_HOME);
    expect(ledger.household.name).toBe('Sweet Home');
  });

  it('leaves each adopted household awaiting enrolment, not writable', async () => {
    const ledger = await freshInstall({
      allowMint: false,
      adopt: [{ householdId: SWEET_HOME, displayName: 'Sweet Home' }],
    });
    expect(ledger.pendingEnrolment).toBe(true);
    // A recovering device must register its DEVICE against a household that
    // exists, never POST a household-create for an id the account already owns.
    expect(ledger.household.my_role).toBe('member');
  });

  it('seeds NO categories, so the checkpoint bootstrap window stays open', async () => {
    const ledger = await freshInstall({
      allowMint: false,
      adopt: [{ householdId: SWEET_HOME, displayName: 'Sweet Home' }],
    });
    expect(ledger.categories).toHaveLength(0);
    expect(ledger.ops).toHaveLength(0);
  });

  it('survives a relaunch — the adopted households are on disk, not just in memory', async () => {
    await freshInstall({
      allowMint: false,
      adopt: [
        { householdId: SWEET_HOME, displayName: 'Sweet Home' },
        { householdId: SECOND, displayName: 'Cottage' },
      ],
    });
    await closeLocalBudgetSession();
    await openLocalBudgetSession({ userId: USER });

    expect(listLocalBudgetHouseholds().map((h) => h.householdId).sort()).toEqual(
      [SECOND, SWEET_HOME].sort(),
    );
    expect(getLocalLedger().household.id).toBe(SWEET_HOME);
  });
});

describe('a fresh install with nothing to adopt still mints', () => {
  it('mints for a genuinely new account', async () => {
    const ledger = await freshInstall({ allowMint: true });
    expect(ledger.household.id).toMatch(/^hh_local_/);
    // Minting DOES seed the starter categories — the behaviour adoption must not copy.
    expect(ledger.categories.length).toBeGreaterThan(0);
  });

  it('mints when the account list could not be fetched (offline)', async () => {
    // Budget is deliberately narrower than House here: House refuses to open at
    // all, Budget keeps its promise to return a ledger. Offline first-launch
    // must therefore behave exactly as it did before this branch existed.
    const ledger = await freshInstall({ allowMint: false });
    expect(ledger.household.id).toMatch(/^hh_local_/);
    expect(ledger.categories.length).toBeGreaterThan(0);
  });

  it('mints when no decider is supplied at all', async () => {
    await resetLocalBudgetSession();
    const ledger = await openLocalBudgetSession({ userId: USER });
    expect(ledger.household.id).toMatch(/^hh_local_/);
    expect(ledger.categories.length).toBeGreaterThan(0);
  });
});
