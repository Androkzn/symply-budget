/**
 * BR-016 layout migration — the upgrade that must never wipe a budget.
 *
 * Before BR-016 the engine held one household and stored its sealed identity
 * under a single global key, `ledger.identity.v2`. Multi-household turned that
 * into a key FAMILY, `ledger.identity.v2:<householdId>`, plus an index of which
 * households exist and a pointer to the active one.
 *
 * House shipped the same change with no migration at all — it authorized a wipe
 * and had no client in the field holding the old shape. Budget cannot: it has
 * live ledgers, which is why `persistence.ts` archives instead of deleting after
 * the 2026-08-14 data-loss incident.
 *
 * Without the migration the failure is silent and total, and it is worth being
 * precise about the mechanism because nothing about it looks like an error: the
 * index key is absent, so `listPersistedHouseholds` returns [], so `sessions` is
 * empty, so the open falls through to `mintNewHousehold` and writes a fresh
 * empty household. The member's real categories and expenses are still on disk,
 * still correctly sealed, and permanently unreachable. No exception, no failed
 * assertion, no crash report — just an empty budget.
 *
 * So these tests do not check that the migration ran. They check that a device
 * carrying the OLD shape still has its data afterwards, which is the only
 * property that matters, and they reproduce the old shape by downgrading a real
 * ledger rather than by hand-authoring a fixture — a fixture written from the
 * same understanding as the migration would agree with it and prove nothing.
 */
import {
  closeLocalBudgetSession,
  getActiveBudgetHouseholdId,
  getLocalLedger,
  getLocalStore,
  listLocalBudgetHouseholds,
  mutateLocalLedger,
  openLocalBudgetSession,
  rememberPublishedCheckpoint,
  resetLocalBudgetSession,
} from '../engine';

/** The pre-BR-016 layout, mirrored from engine.ts. Duplicated on purpose: if a
 *  rename there silently changed these, this suite must fail rather than follow. */
const LEGACY_IDENTITY_META = 'ledger.identity.v2';
const LEGACY_CHECKPOINT_VV_META = 'lf.checkpoint.vv';
const HOUSEHOLDS_META = 'ledger.households.v1';
const ACTIVE_META = 'ledger.active_household.v1';
const HOUSEHOLD_META = 'ledger.household_id';
const identityMetaKey = (householdId: string) => `${LEGACY_IDENTITY_META}:${householdId}`;
const checkpointVvMetaKey = (householdId: string) => `${LEGACY_CHECKPOINT_VV_META}:${householdId}`;

const USER = 'user-legacy';

/**
 * Rewrite the open store back into the pre-BR-016 shape.
 *
 * The identity blob is moved SEALED, exactly as the migration moves it forward —
 * `IDENTITY_AAD` carries no household, so the same ciphertext is valid at either
 * key, and round-tripping it through a decrypt would test the test rather than
 * the migration.
 */
async function downgradeStoreToLegacyLayout(householdId: string): Promise<void> {
  const store = getLocalStore();

  const sealed = await store.getMeta(identityMetaKey(householdId));
  if (!sealed) throw new Error('nothing to downgrade — namespaced identity was absent');

  await store.setMeta(LEGACY_IDENTITY_META, sealed);
  await store.setMeta(identityMetaKey(householdId), '');

  // The two keys BR-016 introduced. Their absence is what made the old engine
  // fall through to minting.
  await store.setMeta(HOUSEHOLDS_META, '');
  await store.setMeta(ACTIVE_META, '');

  // The legacy engine did keep this one, denormalized alongside the blob.
  await store.setMeta(HOUSEHOLD_META, householdId);

  const vv = await store.getMeta(checkpointVvMetaKey(householdId));
  if (vv) {
    await store.setMeta(LEGACY_CHECKPOINT_VV_META, vv);
    await store.setMeta(checkpointVvMetaKey(householdId), '');
  }
}

/** Close the SESSION without resetting the STORE — an app relaunch, not a wipe. */
async function relaunch(): Promise<void> {
  await closeLocalBudgetSession();
  await openLocalBudgetSession({ userId: USER });
}

describe('BR-016 legacy layout migration', () => {
  beforeEach(async () => {
    await resetLocalBudgetSession();
  });

  afterEach(async () => {
    await resetLocalBudgetSession();
  });

  /**
   * Build a pre-BR-016 device: a real household with real spending in it,
   * then rolled back to the old key layout.
   */
  async function seedLegacyDevice(): Promise<{
    householdId: string;
    householdName: string;
    categoryCount: number;
    expenseId: string;
  }> {
    const ledger = await openLocalBudgetSession({ userId: USER, displayName: 'Legacy Member' });
    const householdId = ledger.household.id;
    const householdName = ledger.household.name;

    const expenseId = 'exp-legacy-1';
    await mutateLocalLedger(
      (draft) => {
        draft.expenses.push({
          id: expenseId,
          household_id: householdId,
          category_id: draft.categories[0]?.id ?? null,
          amount: 4242,
          note: 'pre-upgrade groceries',
          spent_at: '2026-08-14T00:00:00.000Z',
        } as unknown as (typeof draft.expenses)[number]);
      },
      {
        opType: 'EXPENSE_CREATE',
        entityType: 'expense',
        entityId: expenseId,
        payload: { amount: 4242 },
      },
    );

    // A published checkpoint, so the watermark has something to migrate.
    await rememberPublishedCheckpoint({ [ledger.deviceId]: 1 } as never);

    const categoryCount = getLocalLedger().categories.length;
    expect(categoryCount).toBeGreaterThan(0);

    await downgradeStoreToLegacyLayout(householdId);

    return { householdId, householdName, categoryCount, expenseId };
  }

  it('keeps the household, its categories and its spending across the upgrade', async () => {
    const seeded = await seedLegacyDevice();

    await relaunch();

    const ledger = getLocalLedger();

    // The single assertion this whole file exists for: not a NEW household.
    expect(ledger.household.id).toBe(seeded.householdId);
    expect(ledger.household.name).toBe(seeded.householdName);

    expect(ledger.categories).toHaveLength(seeded.categoryCount);
    expect(ledger.expenses.map((e) => e.id)).toContain(seeded.expenseId);
    expect(ledger.expenses.find((e) => e.id === seeded.expenseId)?.amount).toBe(4242);
  });

  it('registers the migrated household in the index and makes it active', async () => {
    const seeded = await seedLegacyDevice();

    await relaunch();

    const households = listLocalBudgetHouseholds();
    expect(households.map((h) => h.householdId)).toEqual([seeded.householdId]);
    expect(getActiveBudgetHouseholdId()).toBe(seeded.householdId);
  });

  it('moves the identity to its namespaced key and blanks the legacy one', async () => {
    const seeded = await seedLegacyDevice();

    await relaunch();

    const store = getLocalStore();
    expect(await store.getMeta(identityMetaKey(seeded.householdId))).toBeTruthy();
    // Blanked rather than deleted — LocalFirstStore exposes no deleteMeta, and
    // every reader already treats '' as absent.
    expect(await store.getMeta(LEGACY_IDENTITY_META) || '').toBe('');
  });

  it('moves the checkpoint watermark, so one household cannot truncate another', async () => {
    const seeded = await seedLegacyDevice();
    const store = getLocalStore();
    expect(await store.getMeta(LEGACY_CHECKPOINT_VV_META)).toBeTruthy();

    await relaunch();

    expect(await store.getMeta(checkpointVvMetaKey(seeded.householdId))).toBeTruthy();
    // Left global it would later be intersected against a SECOND household's
    // version vector and compact away ops nobody can resend.
    expect(await store.getMeta(LEGACY_CHECKPOINT_VV_META) || '').toBe('');
  });

  it('is idempotent — repeated relaunches neither duplicate nor lose the household', async () => {
    const seeded = await seedLegacyDevice();

    await relaunch();
    await relaunch();
    await relaunch();

    expect(listLocalBudgetHouseholds().map((h) => h.householdId)).toEqual([seeded.householdId]);
    expect(getLocalLedger().household.id).toBe(seeded.householdId);
    expect(getLocalLedger().expenses.map((e) => e.id)).toContain(seeded.expenseId);
  });

  it('leaves a device that has never held a ledger alone', async () => {
    // No seeding: nothing to migrate. The open must still produce a usable
    // household rather than throwing on the absent legacy key.
    const ledger = await openLocalBudgetSession({ userId: 'user-fresh' });

    expect(ledger.household.id).toBeTruthy();
    expect(listLocalBudgetHouseholds()).toHaveLength(1);
    expect(getActiveBudgetHouseholdId()).toBe(ledger.household.id);
  });

  /**
   * The guard that must NOT be helpful.
   *
   * A blob that will not decrypt under this device's DEK is not a migration
   * problem — it is a different account's ledger, or a rotated key. Blanking it
   * would throw away the only copy a recovered key could still open, so the
   * migration must leave it exactly where it is and let the caller degrade to
   * minting.
   */
  it('does not destroy a legacy blob it cannot decrypt', async () => {
    const seeded = await seedLegacyDevice();
    const store = getLocalStore();

    const corrupted = 'bm90LXJlYWxseS1zZWFsZWQ=';
    await store.setMeta(LEGACY_IDENTITY_META, corrupted);

    await relaunch();

    // Still there, byte for byte.
    expect(await store.getMeta(LEGACY_IDENTITY_META)).toBe(corrupted);
    // And it did not migrate a household it could not read.
    expect(listLocalBudgetHouseholds().map((h) => h.householdId)).not.toContain(seeded.householdId);
  });
});
