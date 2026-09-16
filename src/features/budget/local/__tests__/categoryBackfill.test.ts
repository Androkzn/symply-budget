/**
 * Seeds reaching households that already exist.
 *
 * `defaultCategories` runs exactly once per household, at mint. On a
 * server-backed app that is a non-issue — the service reseeds on every read —
 * but Budget is local-first, so a name added to the seed list reaches new
 * households only, and every member already using the app keeps the list they
 * were minted with. "Add a Parking category" would have shipped as a change
 * nobody could see.
 *
 * These pin the three properties that make the reconciliation safe to run on
 * every launch: it adds what is missing, it does not resurrect what the member
 * switched off, and two devices doing it at once converge on ONE row.
 */
import { defaultCategoryId } from '@symply/contracts';

import {
  clearHouseholdBootstrapPending,
  closeLocalBudgetSession,
  getLocalLedger,
  mutateLocalLedger,
  openLocalBudgetSessionForTests,
  requestHouseholdBackfill,
} from '../engine';
import { localBudgetApi } from '../localBudgetApi';

/** A household minted before the seed existed — the row is simply not there. */
async function forgetCategory(name: string): Promise<void> {
  const doomed = getLocalLedger().categories.find((c) => c.name === name);
  if (!doomed) throw new Error(`no seeded category named ${name}`);
  await mutateLocalLedger(
    (ledger) => {
      ledger.categories = ledger.categories.filter((c) => c.id !== doomed.id);
    },
    { opType: 'CATEGORY_DELETE', entityType: 'category', entityId: doomed.id, payload: {} },
  );
}

function categoriesNamed(name: string) {
  return getLocalLedger().categories.filter((c) => c.name === name);
}

describe('backfillDefaultCategories', () => {
  let householdId: string;

  beforeEach(async () => {
    await openLocalBudgetSessionForTests({ userId: 'user-backfill-1' });
    householdId = getLocalLedger().household.id;
  });

  afterEach(async () => {
    await closeLocalBudgetSession();
  });

  it('does nothing for a household already holding every seed', async () => {
    const before = getLocalLedger().categories.length;

    const { added } = await localBudgetApi.backfillDefaultCategories(householdId);

    expect(added).toEqual([]);
    expect(getLocalLedger().categories).toHaveLength(before);
  });

  it('adds a seed the household predates, as a real default', async () => {
    await forgetCategory('Parking');
    expect(categoriesNamed('Parking')).toHaveLength(0);

    const { added } = await localBudgetApi.backfillDefaultCategories(householdId);

    expect(added).toEqual(['Parking']);
    const [parking] = categoriesNamed('Parking');
    expect(parking).toMatchObject({
      household_id: householdId,
      is_default: true,
      hidden: false,
    });
    // Non-deletable and hideable, like any seed — `deleteCategory` branches on
    // `is_default`, so a false here would offer a delete that the next launch
    // silently undoes.
    await localBudgetApi.deleteCategory(householdId, parking!.id);
    expect(categoriesNamed('Parking')[0]!.hidden).toBe(true);
  });

  /**
   * The id is derived from the NAME, so a second device running the same
   * backfill authors the same row id and the projection's LWW collapses the two
   * into one. An index-derived id could not: inserting a seed mid-list
   * renumbered every seed after it, so two devices on different builds would
   * disagree and the household would end up with two Parkings. Mint uses the
   * same name-derived id, so a backfilled row and a minted one are identical.
   */
  it('gives the backfilled row a name-derived, device-independent id', async () => {
    await forgetCategory('Parking');

    await localBudgetApi.backfillDefaultCategories(householdId);

    expect(categoriesNamed('Parking')[0]!.id).toBe('cat_default_parking');
    expect(defaultCategoryId('Restaurants & Takeout')).toBe('cat_default_restaurants_takeout');
  });

  it('is idempotent — a second run adds nothing', async () => {
    await forgetCategory('Parking');
    await localBudgetApi.backfillDefaultCategories(householdId);

    const { added } = await localBudgetApi.backfillDefaultCategories(householdId);

    expect(added).toEqual([]);
    expect(categoriesNamed('Parking')).toHaveLength(1);
  });

  /**
   * The one that would make the feature hostile: a member switches Parking off,
   * relaunches, and it is back. Hiding keeps the row (and therefore the name),
   * which is exactly what the missing-by-name check reads.
   */
  it('does not resurrect a default the member switched off', async () => {
    const parking = categoriesNamed('Parking')[0]!;
    await localBudgetApi.deleteCategory(householdId, parking.id);
    expect(categoriesNamed('Parking')[0]!.hidden).toBe(true);

    const { added } = await localBudgetApi.backfillDefaultCategories(householdId);

    expect(added).toEqual([]);
    expect(categoriesNamed('Parking')).toHaveLength(1);
    expect(categoriesNamed('Parking')[0]!.hidden).toBe(true);
  });

  /**
   * An owner's fresh phone adopts its own household EMPTY and passes the role
   * check. Seeding in that window put 43 name-derived rows beside the
   * positional-id rows the checkpoint then installed — the duplicate "Pets".
   */
  it('waits while the household bootstrap is pending', async () => {
    await forgetCategory('Parking');
    await requestHouseholdBackfill(householdId);

    expect(await localBudgetApi.backfillDefaultCategories(householdId)).toEqual({ added: [] });
    expect(categoriesNamed('Parking')).toHaveLength(0);

    await clearHouseholdBootstrapPending(householdId);
    expect((await localBudgetApi.backfillDefaultCategories(householdId)).added).toEqual(['Parking']);
  });

  it('carries several missing seeds in one write', async () => {
    await forgetCategory('Parking');
    await forgetCategory('Fuel');

    const { added } = await localBudgetApi.backfillDefaultCategories(householdId);

    expect(added.sort()).toEqual(['Fuel', 'Parking']);
    expect(categoriesNamed('Fuel')).toHaveLength(1);
    expect(categoriesNamed('Parking')).toHaveLength(1);
  });
});
