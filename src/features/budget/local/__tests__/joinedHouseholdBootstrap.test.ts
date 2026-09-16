/**
 * What a member must be left holding immediately after they join.
 *
 * Two things went wrong in production on the same join, and neither raised an
 * error anywhere: the household showed as the placeholder "Shared household"
 * rather than by name, and the device seeded 42 default categories into a
 * ledger that had not yet received anything.
 *
 * The seed is the expensive one. `syncOneHousehold` bootstraps from a
 * checkpoint only while this device's version vector is EMPTY — that is the one
 * window in which the household's history can arrive. Authoring anything closes
 * it permanently, and 42 categories authored at first launch closed it before
 * a single row had synced. The member was then holding an empty budget that no
 * later sync could ever fill.
 */
import '../cryptoPolyfill';

import { generateHouseholdKeys } from '@symply/local-first';

import {
  adoptJoinedHousehold,
  closeLocalBudgetSession,
  getLocalBudgetSession,
  installHouseholdKeys,
  openLocalBudgetSessionForTests,
} from '../engine';
import { localBudgetApi } from '../localBudgetApi';

const JOINED_ID = 'hh_joined_sweet_home';

/**
 * Join, then complete enrolment.
 *
 * Both halves matter. A household still awaiting its key refuses every write,
 * so the seed cannot fire and the bug cannot reproduce; it only appears once
 * the key lands and the ledger is writable but still empty — which is exactly
 * where a member stands the moment they are approved.
 */
async function joinAndEnrol(displayName?: string | null) {
  await adoptJoinedHousehold({
    householdId: JOINED_ID,
    ...(displayName === undefined ? {} : { displayName }),
  });
  await installHouseholdKeys(generateHouseholdKeys(JOINED_ID, 5), JOINED_ID);
  return getLocalBudgetSession(JOINED_ID);
}

describe('a household this device just joined', () => {
  beforeEach(async () => {
    await openLocalBudgetSessionForTests({ userId: 'user-joiner' });
  });

  afterEach(async () => {
    await closeLocalBudgetSession();
  });

  it('is named from the invite, not from the placeholder', async () => {
    const session = await joinAndEnrol('Sweet Home');

    expect(session.ledger.household.name).toBe('Sweet Home');
  });

  it('falls back to the placeholder only when the invite carried no name', async () => {
    const session = await joinAndEnrol(null);

    expect(session.ledger.household.name).toBe('Shared household');
  });

  it('is not seeded with default categories before anything has synced', async () => {
    const session = await joinAndEnrol('Sweet Home');

    const { added } = await localBudgetApi.backfillDefaultCategories(JOINED_ID);

    expect(added).toEqual([]);
    expect(session.ledger.categories).toEqual([]);
  });

  it('leaves the version vector empty, so the checkpoint bootstrap window survives', async () => {
    const session = await joinAndEnrol('Sweet Home');

    await localBudgetApi.backfillDefaultCategories(JOINED_ID);

    // The condition `syncOneHousehold` bootstraps on. Non-empty here is the
    // failure: it means this device authored something before the household's
    // history arrived, and no later sync will ever offer it a checkpoint again.
    const vv = await session.store.getVersionVector(JOINED_ID);
    expect(Object.keys(vv)).toEqual([]);
  });

  it('still seeds a household this device owns', async () => {
    // The guard is about JOINED households; an owner minting a fresh one must
    // keep getting the seed list reconciled onto it.
    const owned = await getLocalBudgetSession(
      (await openLocalBudgetSessionForTests({ userId: 'user-owner' })).household.id,
    );

    const { added } = await localBudgetApi.backfillDefaultCategories(owned.householdId);

    expect(added).toEqual([]);
    expect(owned.ledger.categories.length).toBeGreaterThan(0);
  });
});
