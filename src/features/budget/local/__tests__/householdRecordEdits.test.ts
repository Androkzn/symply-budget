/**
 * The household RECORD — name, photo key, address — and where it lives.
 *
 * It lives in the sealed identity blob, not in the projection: `LEDGER_TABLE_KEYS`
 * has no `household` table, so the `HOUSEHOLD_CREATE` op emitted at mint time is
 * dropped by the reducer and these fields are only ever written by
 * `updateLocalHousehold`. That makes two things worth pinning down here, both of
 * which have failed silently in this codebase before:
 *
 *  - an edit must SURVIVE a session close and cold reopen, because a write that
 *    went to the projection instead of the identity blob looks perfectly correct
 *    until the app is relaunched;
 *  - an edit must land on the household it NAMES, not on the active one — the
 *    exact bug class that had a rename swiped on a background card retitle the
 *    budget the member was looking at.
 *
 * These run against the in-memory store, which survives `close()`/`open()`, so
 * the reopen cases exercise the real cold-open path rather than a hand-built
 * session.
 */
import {
  activateLocalBudgetHousehold,
  closeLocalBudgetSession,
  createLocalBudgetHousehold,
  getLocalLedger,
  getLocalLedgerFor,
  listLocalBudgetHouseholds,
  openLocalBudgetSession,
  renameLocalHousehold,
  resetLocalBudgetSession,
  updateLocalHousehold,
} from '../engine';

const USER = 'user-household-record-1';

async function twoHouseholds(): Promise<{ a: string; b: string }> {
  await resetLocalBudgetSession();
  const first = await openLocalBudgetSession({ userId: USER, displayName: 'Everyday budget' });
  const second = await createLocalBudgetHousehold({ displayName: 'Cottage budget' });
  return { a: first.household.id, b: second.household.id };
}

afterEach(async () => {
  await resetLocalBudgetSession();
});

describe('updateLocalHousehold', () => {
  it('writes the photo key and address onto the active household', async () => {
    await twoHouseholds();

    const saved = await updateLocalHousehold({
      name: 'Sweet Home',
      photo_key: 'households/local/deadbeef.jpg',
      address_line1: '742 Evergreen Terrace',
      city: 'Vancouver',
      state_province: 'BC',
      postal_code: 'V6B 1A1',
      country: 'CA',
    });

    expect(saved.name).toBe('Sweet Home');
    expect(saved.photo_key).toBe('households/local/deadbeef.jpg');
    expect(saved.city).toBe('Vancouver');
    expect(getLocalLedger().household.address_line1).toBe('742 Evergreen Terrace');
  });

  it('survives a close and a cold reopen', async () => {
    // The whole point of `persistIdentity`: an edit written to the projection
    // instead of the identity blob looks right until the app is relaunched.
    const { a } = await twoHouseholds();
    await updateLocalHousehold({
      name: 'Sweet Home',
      photo_key: 'households/local/deadbeef.jpg',
      city: 'Vancouver',
    });

    await closeLocalBudgetSession();
    await openLocalBudgetSession({ userId: USER });
    await activateLocalBudgetHousehold(a);

    const household = getLocalLedger().household;
    expect(household.name).toBe('Sweet Home');
    expect(household.photo_key).toBe('households/local/deadbeef.jpg');
    expect(household.city).toBe('Vancouver');
  });

  it('edits the household it NAMES, leaving the active one alone', async () => {
    const { a, b } = await twoHouseholds();
    // A is active — B is the background household on the card being edited.
    await updateLocalHousehold({ name: 'Lake House', city: 'Kelowna' }, b);

    expect((await getLocalLedgerFor(b)).household.name).toBe('Lake House');
    expect((await getLocalLedgerFor(b)).household.city).toBe('Kelowna');
    expect((await getLocalLedgerFor(a)).household.name).toBe('Everyday budget');
    expect((await getLocalLedgerFor(a)).household.city).toBeNull();
  });

  it('clears an address back to null', async () => {
    await twoHouseholds();
    await updateLocalHousehold({ address_line1: '1 Main St', city: 'Toronto', country: 'CA' });
    await updateLocalHousehold({ address_line1: null, city: null, country: null });

    const household = getLocalLedger().household;
    expect(household.address_line1).toBeNull();
    expect(household.city).toBeNull();
    expect(household.country).toBeNull();
  });

  it('refuses a blank name but accepts an absent one', async () => {
    await twoHouseholds();
    await expect(updateLocalHousehold({ name: '   ' })).rejects.toThrow(
      'Household name is required',
    );
    // Absent means "unchanged" — editing only the photo must not have to
    // re-send the name, or every partial save is a chance to blank it.
    const saved = await updateLocalHousehold({ photo_key: 'households/local/x.jpg' });
    expect(saved.name).toBe('Everyday budget');
  });

  it('is what renameLocalHousehold now does', async () => {
    const { b } = await twoHouseholds();
    const renamed = await renameLocalHousehold('Cabin', b);
    expect(renamed.name).toBe('Cabin');
    expect((await getLocalLedgerFor(b)).household.name).toBe('Cabin');
  });
});

describe('createLocalBudgetHousehold with details', () => {
  it('mints a household that already carries its photo and address', async () => {
    // One save, not two: a household created from a name-only form and then
    // edited for the rest has a window in which the second write can fail.
    await resetLocalBudgetSession();
    await openLocalBudgetSession({ userId: USER, displayName: 'Everyday budget' });

    const created = await createLocalBudgetHousehold({
      displayName: 'Trip Fund',
      details: {
        name: 'Trip Fund',
        photo_key: 'households/local/trip.jpg',
        city: 'Vancouver',
        country: 'CA',
      },
    });

    expect(created.household.name).toBe('Trip Fund');
    expect(created.household.photo_key).toBe('households/local/trip.jpg');
    expect(created.household.city).toBe('Vancouver');
    // The id is the engine's, never the caller's.
    expect(created.household.id).toMatch(/^hh_local_/);
  });

  it('still defaults a nameless household', async () => {
    await resetLocalBudgetSession();
    await openLocalBudgetSession({ userId: USER, displayName: 'Everyday budget' });
    const created = await createLocalBudgetHousehold({});
    expect(created.household.name).toBe('My household');
  });
});

describe('listLocalBudgetHouseholds', () => {
  it('carries each household’s whole record without hydrating it', async () => {
    // Without this a BACKGROUND household published to the store with a blank
    // photo and address — fields that were sitting decrypted in the session
    // registry all along. The reopen is what makes the assertion mean something:
    // after a cold open only the ACTIVE household's rows are in memory, so a
    // record that is still complete here came from the identity blob, not from
    // a hydration this list is not allowed to trigger.
    const { a, b } = await twoHouseholds();
    await updateLocalHousehold({ photo_key: 'households/local/lake.jpg', city: 'Kelowna' }, b);
    await closeLocalBudgetSession();
    await openLocalBudgetSession({ userId: USER });

    const summaries = listLocalBudgetHouseholds();
    const summaryB = summaries.find((summary) => summary.householdId === b);
    expect(summaryB?.hydrated).toBe(false);
    expect(summaryB?.record.photo_key).toBe('households/local/lake.jpg');
    expect(summaryB?.record.city).toBe('Kelowna');

    const summaryA = summaries.find((summary) => summary.householdId === a);
    expect(summaryA?.record.city).toBeNull();
  });

  it('hands out a COPY, not the engine’s live record', async () => {
    // `useHouseholdStore` deep-freezes what it stores, and the live record is
    // stamped with `updated_at` on every local write — publishing it by
    // reference froze it in place and threw on the next save.
    const { a } = await twoHouseholds();
    const summary = listLocalBudgetHouseholds().find((entry) => entry.householdId === a);
    expect(summary?.record).not.toBe(getLocalLedger().household);
    Object.freeze(summary?.record);
    await expect(updateLocalHousehold({ name: 'Still writable' })).resolves.toBeDefined();
  });
});
