/**
 * BR-016 — multi-household session manager (plan §5 conformance).
 *
 * Ported from House's `multiProperty.test.ts`, which is the reference
 * implementation this stage follows. The failure modes are all silent: nothing
 * crashes when two households share a ledger, an HDK or a checkpoint watermark;
 * the money just lands in the wrong household, or one household's compaction
 * truncates a log the other still needs and the dropped ops are not re-derivable.
 *
 * Budget's isolation story differs from House's in one way that matters here.
 * House seeds deterministic per-property ids, so its suite proves isolation by
 * asserting the two seeds do NOT collide. Budget's `defaultCategories` numbers
 * its seeds `cat_default_1..N` with NO household in the id (defaults.ts says so
 * in as many words), so both households hold the SAME 41 row keys. Isolation
 * therefore rests entirely on `lf_rows` being keyed `(household_id, tbl,
 * row_key)` and on every row being sealed under `rowAad(householdId, …)` — which
 * makes the colliding-key test below the sharpest bleed detector in the file,
 * not a weaker one.
 *
 * These run against the in-memory store: `openBudgetLocalFirstStore` returns a
 * module-level `MemoryLocalFirstStore` under Jest, and it survives
 * `close()`/`open()`, which is what lets the close-and-reopen and lazy-hydration
 * cases exercise the real cold-open path (`buildSessionFromDisk`) rather than a
 * hand-built session.
 */
import { defaultCategoryId } from '@symply/contracts';

import {
  activateLocalBudgetHousehold,
  closeLocalBudgetSession,
  compactLocalLogIfSafe,
  createLocalBudgetHousehold,
  getActiveBudgetHouseholdId,
  getLocalBudgetSession,
  getLocalLedger,
  getLocalLedgerFor,
  getLocalStore,
  listLocalBudgetHouseholds,
  mutateLocalLedger,
  openLocalBudgetSession,
  openLocalBudgetSessionForTests,
  rememberPublishedCheckpoint,
  removeLocalBudgetHousehold,
  resetLocalBudgetSession,
  subscribeToLedgerChanges,
  type BudgetLedgerChange,
} from '../engine';
import { BudgetLocalNotReadyError, BudgetLocalUnknownHouseholdError } from '../errors';
import { newLocalId } from '../ids';

import { expenseRow } from './ledgerTestKit';

const USER = 'user-multi-budget-1';

/** Both households seed this row key — see the file header. */
const SHARED_CATEGORY_ID = defaultCategoryId('Groceries');

/**
 * The device's own household plus a second one, A left active.
 *
 * `createLocalBudgetHousehold` deliberately does not activate, so the fixture
 * lands exactly where the UI would: two households on disk, the first one on
 * screen.
 */
async function twoHouseholds(): Promise<{ a: string; b: string }> {
  await resetLocalBudgetSession();
  const first = await openLocalBudgetSession({ userId: USER, displayName: 'Everyday budget' });
  const second = await createLocalBudgetHousehold({ displayName: 'Cottage budget' });
  return { a: first.household.id, b: second.household.id };
}

/**
 * Writes go through the ACTIVE household by design — `mutateLocalLedger` has no
 * `forHouseholdId`, so naming a household means activating it first.
 */
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

afterEach(async () => {
  await resetLocalBudgetSession();
});

describe('the registry holds several households at once', () => {
  it('opens a second household without closing the first', async () => {
    const { a, b } = await twoHouseholds();
    const households = listLocalBudgetHouseholds();
    expect(households.map((household) => household.householdId).sort()).toEqual([a, b].sort());
    expect(a).not.toBe(b);
    // Creating does not switch: the member is still looking at their own budget.
    expect(getActiveBudgetHouseholdId()).toBe(a);
  });

  it('reuses ONE device identity across households', async () => {
    // One device, one keypair, registered per household on the control plane. A
    // per-household device id would make each household treat the others as
    // different devices and fan mailbox deposits out to phantom peers.
    const { a, b } = await twoHouseholds();
    const sessionA = await getLocalBudgetSession(a);
    const sessionB = await getLocalBudgetSession(b);
    expect(sessionA.identity.deviceId).toBe(sessionB.identity.deviceId);
    expect(sessionA.ledger.deviceId).toBe(sessionB.ledger.deviceId);
    // The summary carries it too, so a switcher never has to hydrate to show it.
    const deviceIds = new Set(listLocalBudgetHouseholds().map((household) => household.deviceId));
    expect(deviceIds.size).toBe(1);
  });

  it('gives each household its OWN household key', async () => {
    // Each household is its own membership with its own key epoch. Sharing an
    // HDK would let a revoked member of one household read the other, and would
    // make a rotation in one silently re-key the other.
    const { a, b } = await twoHouseholds();
    const sessionA = await getLocalBudgetSession(a);
    const sessionB = await getLocalBudgetSession(b);
    expect(sessionA.householdKeys.householdId).toBe(a);
    expect(sessionB.householdKeys.householdId).toBe(b);
    expect(Array.from(sessionA.householdKeys.hdk)).not.toEqual(
      Array.from(sessionB.householdKeys.hdk),
    );
    // And they share the one device DEK — isolation comes from the row AAD, not
    // from splitting the database (plan §6).
    expect(sessionA.store).toBe(sessionB.store);
  });

  it('seeds each household independently', async () => {
    const { a, b } = await twoHouseholds();
    const ledgerA = await getLocalLedgerFor(a);
    const ledgerB = await getLocalLedgerFor(b);
    expect(ledgerA.categories.length).toBeGreaterThan(0);
    expect(ledgerB.categories).toHaveLength(ledgerA.categories.length);
    // Deliberately the OPPOSITE of House's assertion: Budget's seed ids are not
    // household-scoped, so the two sets collide exactly. What must differ is the
    // household each row belongs to.
    expect(ledgerB.categories.map((row) => row.id)).toEqual(ledgerA.categories.map((row) => row.id));
    expect(ledgerA.categories.every((row) => row.household_id === a)).toBe(true);
    expect(ledgerB.categories.every((row) => row.household_id === b)).toBe(true);
  });

  it('refuses a household this device does not hold instead of serving the active one', async () => {
    const { a } = await twoHouseholds();
    // The whole point of BudgetLocalUnknownHouseholdError. A stale sync cursor or
    // a screen holding an id across a switch must fail loudly; falling back to
    // "whatever is active" is how B's rows would be read as A's.
    await expect(getLocalLedgerFor('hh_not_on_this_device')).rejects.toBeInstanceOf(
      BudgetLocalUnknownHouseholdError,
    );
    expect(getActiveBudgetHouseholdId()).toBe(a);
  });

  it('calls a sessionless engine not-ready, not an unknown household', async () => {
    const { a } = await twoHouseholds();
    await closeLocalBudgetSession();

    // The distinction the error pair exists to make, asserted from the side
    // that used to get it wrong. An engine holding NOTHING means the session
    // has not opened — "sign in / wait", the fix `BudgetLocalNotReadyError`
    // names. Reporting it as an unknown household instead tells the member the
    // device no longer holds a household it holds perfectly well, and points
    // them at a recovery for a problem they do not have.
    //
    // Real, not theoretical: `useHouseholdStore` rehydrates its persisted
    // household before `ensureBudgetLocalSession` runs, so on every cold launch
    // the screen loaders fire against an id with an empty session map. Asserted
    // on `a` — a household this device genuinely holds — because that is the
    // cold-launch shape; an id it never held would pass either way.
    await expect(getLocalLedgerFor(a)).rejects.toBeInstanceOf(BudgetLocalNotReadyError);
  });
});

describe('write to A, activate B, write to B, reactivate A', () => {
  it('keeps both ledgers intact with no cross-household row bleed', async () => {
    const { a, b } = await twoHouseholds();

    const expenseA = await addExpense(a, 'Groceries for the everyday budget');
    const expenseB = await addExpense(b, 'Firewood for the cottage');

    const ledgerA = await getLocalLedgerFor(a);
    const ledgerB = await getLocalLedgerFor(b);

    expect(ledgerA.expenses.map((row) => row.id)).toEqual([expenseA]);
    expect(ledgerB.expenses.map((row) => row.id)).toEqual([expenseB]);
    expect(ledgerA.expenses[0]!.title).toContain('everyday');
    expect(ledgerB.expenses[0]!.title).toContain('cottage');
    expect(ledgerA.expenses[0]!.household_id).toBe(a);
    expect(ledgerB.expenses[0]!.household_id).toBe(b);
  });

  it('keeps the colliding default-category row keys apart', async () => {
    const { a, b } = await twoHouseholds();

    await activateLocalBudgetHousehold(a);
    await mutateLocalLedger(
      (ledger) => {
        const category = ledger.categories.find((row) => row.id === SHARED_CATEGORY_ID)!;
        category.name = 'Groceries (A only)';
      },
      {
        opType: 'CATEGORY_UPDATE',
        entityType: 'category',
        entityId: SHARED_CATEGORY_ID,
        payload: {},
      },
    );

    // Same row key, same table, one store, one DEK — and B is untouched. If the
    // row PK were table-only, or the AAD carried no household, this rename would
    // have renamed B's Groceries too and nobody would have noticed until the two
    // households diverged on a report.
    const ledgerB = await getLocalLedgerFor(b);
    expect(ledgerB.categories.find((row) => row.id === SHARED_CATEGORY_ID)!.name).toBe('Groceries');

    // And it survives the round trip through the sealed rows, which is where a
    // shared AAD would actually bite.
    await closeLocalBudgetSession();
    await openLocalBudgetSession({ userId: USER });
    const reloadedA = await getLocalLedgerFor(a);
    const reloadedB = await getLocalLedgerFor(b);
    expect(reloadedA.categories.find((row) => row.id === SHARED_CATEGORY_ID)!.name).toBe(
      'Groceries (A only)',
    );
    expect(reloadedB.categories.find((row) => row.id === SHARED_CATEGORY_ID)!.name).toBe(
      'Groceries',
    );
    expect(reloadedA.categories.every((row) => row.household_id === a)).toBe(true);
    expect(reloadedB.categories.every((row) => row.household_id === b)).toBe(true);
  });

  it('attributes each op to the right household', async () => {
    const { a, b } = await twoHouseholds();
    await addExpense(a, 'A');
    await addExpense(b, 'B');

    const sessionA = await getLocalBudgetSession(a);
    const sessionB = await getLocalBudgetSession(b);
    for (const op of sessionA.ledger.ops) expect(op.householdId).toBe(a);
    for (const op of sessionB.ledger.ops) expect(op.householdId).toBe(b);
    // Both logs are non-empty, so the loops above are not vacuously true: each
    // household carries its own HOUSEHOLD_CREATE plus its one expense.
    expect(sessionA.ledger.ops).toHaveLength(2);
    expect(sessionB.ledger.ops).toHaveLength(2);
  });

  it('survives reactivating the first household', async () => {
    const { a, b } = await twoHouseholds();
    const expenseA = await addExpense(a, 'first');
    await activateLocalBudgetHousehold(b);
    await activateLocalBudgetHousehold(a);

    expect(getActiveBudgetHouseholdId()).toBe(a);
    expect(getLocalLedger().expenses.map((row) => row.id)).toEqual([expenseA]);
  });

  it('keeps rows apart across a full close and reopen', async () => {
    const { a, b } = await twoHouseholds();
    const expenseA = await addExpense(a, 'persisted A');
    const expenseB = await addExpense(b, 'persisted B');

    await closeLocalBudgetSession();
    await openLocalBudgetSession({ userId: USER });

    // The index carries both, so the cold open rebuilds both — a single-household
    // index here is the wipe the migration in §4 exists to prevent.
    expect(listLocalBudgetHouseholds()).toHaveLength(2);
    const ledgerA = await getLocalLedgerFor(a);
    const ledgerB = await getLocalLedgerFor(b);
    expect(ledgerA.expenses.map((row) => row.id)).toEqual([expenseA]);
    expect(ledgerB.expenses.map((row) => row.id)).toEqual([expenseB]);
  });
});

describe('lazy hydration (plan §3 rule)', () => {
  it('hydrates only the household the member is looking at', async () => {
    const { a, b } = await twoHouseholds();
    await addExpense(a, 'A');
    await addExpense(b, 'B');
    await closeLocalBudgetSession();

    await openLocalBudgetSession({ userId: USER });
    const summaries = listLocalBudgetHouseholds();
    const hydrated = summaries.filter((household) => household.hydrated);

    // Exactly one — the active one. Cold open decrypts and parses every row, so
    // a member with three households must not pay it three times to reach the
    // one screen they opened the app for.
    expect(summaries).toHaveLength(2);
    expect(hydrated).toHaveLength(1);
    expect(hydrated[0]!.householdId).toBe(getActiveBudgetHouseholdId());
    expect(getActiveBudgetHouseholdId()).toBe(b);
    expect(a).not.toBe(b);
  });

  it('hydrates the other household on demand, once', async () => {
    const { a, b } = await twoHouseholds();
    await addExpense(b, 'cottage insurance');
    // Leave A active so B is genuinely cold on the next open, rather than
    // relying on whichever household the last write happened to activate.
    await activateLocalBudgetHousehold(a);
    await closeLocalBudgetSession();
    await openLocalBudgetSession({ userId: USER });

    expect(getActiveBudgetHouseholdId()).toBe(a);
    const cold = listLocalBudgetHouseholds().find((household) => household.householdId === b)!;
    expect(cold.hydrated).toBe(false);
    // Still fully described though — a switcher renders the whole list without
    // decrypting a single row.
    expect(cold.name).toBe('Cottage budget');
    expect(cold.isActive).toBe(false);

    const ledgerB = await getLocalLedgerFor(b);
    expect(ledgerB.expenses).toHaveLength(1);
    expect(
      listLocalBudgetHouseholds().find((household) => household.householdId === b)!.hydrated,
    ).toBe(true);

    // Idempotent: asking again neither re-reads nor duplicates rows.
    const again = await getLocalLedgerFor(b);
    expect(again.expenses).toHaveLength(1);
    expect(again.categories).toHaveLength(ledgerB.categories.length);
    // Reading B did not drag it onto the screen.
    expect(getActiveBudgetHouseholdId()).toBe(a);
  });
});

describe('household removal is scoped', () => {
  it('clears one household’s rows and leaves the other untouched', async () => {
    const { a, b } = await twoHouseholds();
    const expenseA = await addExpense(a, 'stays');
    await addExpense(b, 'goes');

    await activateLocalBudgetHousehold(a);
    await removeLocalBudgetHousehold(b);

    expect(listLocalBudgetHouseholds().map((household) => household.householdId)).toEqual([a]);
    const ledgerA = await getLocalLedgerFor(a);
    expect(ledgerA.expenses.map((row) => row.id)).toEqual([expenseA]);
    // Removal is the ONLY path that clears rows, and it clears exactly one
    // household's. A's seed categories are still there.
    expect(ledgerA.categories.length).toBeGreaterThan(0);
    await expect(getLocalLedgerFor(b)).rejects.toBeInstanceOf(BudgetLocalUnknownHouseholdError);
  });

  /**
   * Leaving a household is built on this call, and the promise made to the
   * member at that confirm is that everything of the household's is gone from
   * the phone — not merely that the household stops being listed.
   *
   * The checkpoint watermark is the one that bites: a member who leaves and is
   * later invited back gets the SAME household id, and a stale
   * `lf.checkpoint.vv` tells `tryInstallLatestCheckpoint` the fresh, empty
   * ledger is "already holding everything in gen=N" — closing its single
   * bootstrap window and leaving the rejoined device empty over a household
   * that has data.
   */
  it('leaves no per-household meta behind — identity, watermarks or markers', async () => {
    const { a, b } = await twoHouseholds();
    await addExpense(b, 'goes');
    const store = getLocalStore();
    // Written by the modules that own them, as the app would have: a published
    // checkpoint, a checkpoint epoch, and the control-plane registration marker.
    await rememberPublishedCheckpoint(await getLocalStore().getVersionVector(b), b);
    await store.setMeta(`lf.checkpoint.epoch:${b}`, '3');
    await store.setMeta(`lf.cp.registered:${b}`, '1');

    await activateLocalBudgetHousehold(a);
    await removeLocalBudgetHousehold(b);

    for (const key of [
      `ledger.identity.v2:${b}`,
      `lf.checkpoint.vv:${b}`,
      `lf.checkpoint.epoch:${b}`,
      `lf.cp.registered:${b}`,
    ]) {
      expect(await store.getMeta(key)).toBeFalsy();
    }
    // …and the household that stayed keeps its own, untouched.
    expect(await store.getMeta(`ledger.identity.v2:${a}`)).toBeTruthy();
  });

  it('refuses to remove the last household', async () => {
    await resetLocalBudgetSession();
    const only = await openLocalBudgetSession({ userId: USER });
    await expect(removeLocalBudgetHousehold(only.household.id)).rejects.toThrow(
      /cannot remove the last household/,
    );
    // And it really is refused, not half-done: the ledger is still readable.
    expect(getLocalLedger().categories.length).toBeGreaterThan(0);
  });

  it('activates a survivor when the ACTIVE household is removed', async () => {
    const { a, b } = await twoHouseholds();
    const expenseA = await addExpense(a, 'survivor');
    await activateLocalBudgetHousehold(b);
    await removeLocalBudgetHousehold(b);

    expect(getActiveBudgetHouseholdId()).toBe(a);
    expect(listLocalBudgetHouseholds()).toHaveLength(1);
    // Hydrated by the fallback, so the member lands on real data rather than an
    // empty ledger that reads as data loss.
    expect(getLocalLedger().expenses.map((row) => row.id)).toEqual([expenseA]);
  });
});

describe('change notifications carry the household', () => {
  it('names which household moved, so a background sync cannot repaint the screen', async () => {
    const { a, b } = await twoHouseholds();
    const changes: BudgetLedgerChange[] = [];
    const stop = subscribeToLedgerChanges((_revision, change) => changes.push(change));

    await activateLocalBudgetHousehold(b);
    stop();

    expect(changes).toHaveLength(1);
    expect(changes[0]!.householdId).toBe(b);
    expect(changes[0]!.householdId).not.toBe(a);
    // A switch changes every visible number, so the whole table list is honest.
    expect(changes[0]!.tables.length).toBeGreaterThan(0);
  });

  it('keeps the revision as the first argument for pre-BR-016 subscribers', async () => {
    // Two Budget screens pass a `useState` setter straight into this. The
    // household rides along in `change`; it did not take the revision's slot.
    const { b } = await twoHouseholds();
    const revisions: number[] = [];
    const stop = subscribeToLedgerChanges((revision) => revisions.push(revision));

    await activateLocalBudgetHousehold(b);
    stop();

    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toBeGreaterThan(0);
  });
});

describe('checkpoint watermarks are per household', () => {
  it('does not let one household’s watermark govern another’s compaction', async () => {
    const { a, b } = await twoHouseholds();
    await addExpense(a, 'A1');
    await addExpense(a, 'A2');
    await addExpense(b, 'B1');

    const sessionA = await getLocalBudgetSession(a);
    const sessionB = await getLocalBudgetSession(b);
    await rememberPublishedCheckpoint(await sessionA.store.getVersionVector(a), a);

    const opsBefore = (await sessionB.store.listOperationsByHlc(b)).length;
    expect(opsBefore).toBeGreaterThan(0);

    // B has published nothing, so B must refuse to compact. Under one shared
    // watermark key B would have read A's — a version vector over the SAME device
    // id, because one device authors both, and over a seq space that restarts per
    // household — and truncated a log no checkpoint covers. A compacted op is not
    // re-derivable, so that loss is permanent.
    await expect(compactLocalLogIfSafe(b)).resolves.toBe(0);
    expect(await sessionB.store.listOperationsByHlc(b)).toHaveLength(opsBefore);

    // A, which did publish, still compacts — so the zero above is B's missing
    // watermark and not compaction being inert in this fixture.
    await expect(compactLocalLogIfSafe(a)).resolves.toBeGreaterThan(0);
    expect(await sessionB.store.listOperationsByHlc(b)).toHaveLength(opsBefore);
  });
});

/**
 * The migration's MECHANICS — pointers, byte-for-byte re-key, watermark move,
 * idempotency, the undecryptable-blob and already-migrated branches — are proven
 * in `multiHouseholdMigration.test.ts`. Do not re-assert them here.
 *
 * What belongs in the conformance suite is the join between the two: a device
 * that arrives through the migration has to land in the multi-household world,
 * not merely survive the trip. A migration that restored the ledger but left the
 * index in a shape `createLocalBudgetHousehold` could not extend would pass every
 * test in that file and still strand the member on one household forever.
 */
describe('a migrated legacy device joins the multi-household world', () => {
  it('can add, hold and switch to a second household after migrating', async () => {
    await resetLocalBudgetSession();
    const opened = await openLocalBudgetSession({ userId: USER });
    const householdId = opened.household.id;
    const expenseId = await addExpense(householdId, 'legacy grocery run');

    // Rewrite the on-disk layout by hand back to the pre-BR-016 shape: one
    // un-namespaced identity blob, no index, no active pointer.
    const store = getLocalStore();
    const sealed = await store.getMeta(`ledger.identity.v2:${householdId}`);
    expect(sealed).toBeTruthy();
    await store.setMeta('ledger.identity.v2', sealed!);
    await store.setMeta(`ledger.identity.v2:${householdId}`, '');
    await store.setMeta('ledger.households.v1', '');
    await store.setMeta('ledger.active_household.v1', '');

    await closeLocalBudgetSession();
    await openLocalBudgetSession({ userId: USER });

    const second = await createLocalBudgetHousehold({ displayName: 'Added after migration' });
    await activateLocalBudgetHousehold(second.household.id);

    expect(listLocalBudgetHouseholds().map((household) => household.householdId).sort()).toEqual(
      [householdId, second.household.id].sort(),
    );
    expect(getActiveBudgetHouseholdId()).toBe(second.household.id);

    // The migrated household is still whole, and still isolated from the one
    // added beside it — the same bleed check as above, entered through the
    // migration door.
    const legacy = await getLocalLedgerFor(householdId);
    expect(legacy.expenses.map((row) => row.id)).toEqual([expenseId]);
    expect((await getLocalLedgerFor(second.household.id)).expenses).toHaveLength(0);
    expect(legacy.categories.every((row) => row.household_id === householdId)).toBe(true);
  });
});

describe('the in-memory test session joins the registry', () => {
  it('registers itself, sets the active pointer and hosts a second household', async () => {
    // `openLocalBudgetSessionForTests` used to overwrite a single module-level
    // engine. It now writes into `sessions` like every other open, which is what
    // lets a conformance fixture build its second household on top of it with
    // `createLocalBudgetHousehold`.
    const ledger = await openLocalBudgetSessionForTests({ userId: USER });
    expect(getActiveBudgetHouseholdId()).toBe(ledger.household.id);
    expect(listLocalBudgetHouseholds().map((household) => household.householdId)).toEqual([
      ledger.household.id,
    ]);

    const second = await createLocalBudgetHousehold({ displayName: 'Second' });
    expect(listLocalBudgetHouseholds()).toHaveLength(2);
    // Creating is not switching — the caller decides when to land in it.
    expect(getActiveBudgetHouseholdId()).toBe(ledger.household.id);

    await activateLocalBudgetHousehold(second.household.id);
    expect(getActiveBudgetHouseholdId()).toBe(second.household.id);
    expect(getLocalLedger().household.id).toBe(second.household.id);
    // One device identity here too, even though this session never touched disk.
    const sessionA = await getLocalBudgetSession(ledger.household.id);
    const sessionB = await getLocalBudgetSession(second.household.id);
    expect(sessionA.identity.deviceId).toBe(sessionB.identity.deviceId);
  });
});
