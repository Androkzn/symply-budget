/**
 * One backup file, every household — the v3 bundle end to end.
 *
 * The failure this suite guards is the one BR-016 created and the bundle
 * removes: a device holding three budgets producing three archives under three
 * phrases, so being covered required all three to be right and nothing said
 * which one was not. Every case here is about a household either riding along in
 * the one file or being visibly reported as missing — never quietly absent.
 *
 * Argon2id at recovery strength runs for real in these tests (no KDF stub), so
 * each case that seals or opens a bundle carries a long timeout. That is
 * deliberate: the single-pass-for-N-households property is the whole reason a
 * device-wide seal finishes at all, and stubbing the KDF would hide a
 * regression that reintroduced a pass per household.
 */
import {
  buildBudgetBackupArchive,
  buildBudgetBackupBundle,
  restoreBudgetBackupBundle,
  verifyBudgetBackupFile,
} from '../backup/budgetBackup';
import {
  activateLocalBudgetHousehold,
  createLocalBudgetHousehold,
  getLocalLedger,
  getLocalLedgerFor,
  listLocalBudgetHouseholds,
  openLocalBudgetSessionForTests,
  removeLocalBudgetHousehold,
  renameLocalHousehold,
  resetLocalBudgetSession,
} from '../engine';
import { localBudgetApi } from '../localBudgetApi';
import { LEDGER_TABLE_NAMES } from '../projection';

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  cacheDirectory: 'file:///cache/',
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  copyAsync: jest.fn(async () => undefined),
}));

const SLOW = 180_000;

/*
 * Every array-valued ledger key that is not bookkeeping.
 *
 *  - `ops` is the op log; the snapshot ships it empty on purpose (restore merges
 *    tables via LWW, and `Array.from(Uint8Array)` was a ~3.6× blow-up).
 *  - `conflicts` is the auto-merge record (BR-044). It describes what the LAST
 *    merge discarded on THIS device, so carrying it to another device would show
 *    a member conflicts they never had.
 *
 * `crypto` is an object, `household`/`memberId`/`deviceId` are scalars, and
 * `lww` is a map — none of them reach this filter.
 */
const LEDGER_BOOKKEEPING_KEYS = new Set(['ops', 'conflicts']);

function ledgerTableNames(): string[] {
  return Object.entries(getLocalLedger())
    .filter(([key, value]) => Array.isArray(value) && !LEDGER_BOOKKEEPING_KEYS.has(key))
    .map(([key]) => key);
}

/** Two households on this device, each with one spending that names it. */
async function twoHouseholds(): Promise<{ a: string; b: string }> {
  const a = getLocalLedger().household.id;
  await renameLocalHousehold('Main budget');
  await localBudgetApi.addExpense(a, {
    title: 'Main spending',
    amount: 1000,
    expense_date: '2026-08-10',
  });

  const second = await createLocalBudgetHousehold({ displayName: 'Holiday' });
  const b = second.household.id;
  await localBudgetApi.addExpense(b, {
    title: 'Holiday spending',
    amount: 2000,
    expense_date: '2026-08-11',
  });

  await activateLocalBudgetHousehold(a);
  return { a, b };
}

describe('budget backup bundle', () => {
  beforeEach(async () => {
    await openLocalBudgetSessionForTests({ userId: 'user-bundle-1' });
  });

  afterEach(async () => {
    /*
     * `reset`, not `close`. The in-memory store is module-level and SURVIVES a
     * close, so a plain close leaves every household a case created on the
     * device — and `beforeEach` reopens that same device. Cases that seal
     * "every household" then grow with the number of cases above them:
     * the whole-ledger round-trip measured 14s alone and 15 minutes as the last
     * case in the file, sealing and restoring a household per predecessor.
     */
    await resetLocalBudgetSession();
  });

  it(
    'seals every household on the device into one file under one phrase',
    async () => {
      const { a, b } = await twoHouseholds();

      const bundle = await buildBudgetBackupBundle();

      expect(bundle.phrase.split(' ')).toHaveLength(12);
      expect(bundle.households.map((entry) => entry.householdId).sort()).toEqual([a, b].sort());
      // Rows are sealed, never in the clear — including the household names,
      // which are facts about people.
      expect(bundle.bundleJson).not.toContain('Main spending');
      expect(bundle.bundleJson).not.toContain('Holiday spending');
      expect(bundle.bundleJson).not.toContain('Holiday');

      const verified = verifyBudgetBackupFile(bundle.bundleJson, bundle.phrase);
      expect(verified.status).toBe('ok');
      expect(verified.kind).toBe('bundle');
      expect(verified.households).toHaveLength(2);
      expect(verified.households.map((entry) => entry.householdName).sort()).toEqual([
        'Holiday',
        'Main budget',
      ]);
    },
    SLOW,
  );

  it(
    'counts every ledger table, so a new table is reported as covered',
    async () => {
      const householdId = getLocalLedger().household.id;
      await localBudgetApi.addExpense(householdId, {
        title: 'Counted',
        amount: 500,
        expense_date: '2026-08-10',
      });

      const bundle = await buildBudgetBackupBundle();
      const [coverage] = bundle.households;

      // Driven off the table registry rather than a hand-written list — the
      // point of the assertion is that the count is not a curated subset.
      expect(coverage.rows.byTable.expenses).toBe(1);
      expect(coverage.rows.byTable.categories).toBeGreaterThan(0);
      expect(coverage.rows.total).toBe(
        Object.values(coverage.rows.byTable).reduce((sum, n) => sum + n, 0),
      );
      // Every ledger table appears, including the ones that happen to be empty.
      expect(Object.keys(coverage.rows.byTable)).toEqual(
        expect.arrayContaining([
          'expenses',
          'categories',
          'goals',
          'items',
          'savingsIncome',
          'budgetLoans',
          'mortgages',
          'registeredAccounts',
          'wishes',
          'wishAttachments',
        ]),
      );
    },
    SLOW,
  );

  it(
    'restores each household back into its own ledger, not into the active one',
    async () => {
      const { a, b } = await twoHouseholds();
      const bundle = await buildBudgetBackupBundle();

      // Wipe both projections. `a` is active; `b` is the one a single-household
      // restore could never have reached.
      (await getLocalLedgerFor(a)).expenses = [];
      (await getLocalLedgerFor(b)).expenses = [];

      const verified = verifyBudgetBackupFile(bundle.bundleJson, bundle.phrase);
      const result = await restoreBudgetBackupBundle(verified);

      expect(result.status).toBe('ok');
      expect(result.households).toHaveLength(2);
      expect((await getLocalLedgerFor(a)).expenses[0].title).toBe('Main spending');
      expect((await getLocalLedgerFor(b)).expenses[0].title).toBe('Holiday spending');
      // Each household's rows landed in ITS ledger — the cross-contamination
      // BR-016 B5 exists to prevent.
      expect((await getLocalLedgerFor(a)).expenses).toHaveLength(1);
      expect((await getLocalLedgerFor(b)).expenses).toHaveLength(1);
    },
    SLOW,
  );

  it(
    'leaves the member in the household they started in',
    async () => {
      const { a } = await twoHouseholds();
      const bundle = await buildBudgetBackupBundle();
      const verified = verifyBudgetBackupFile(bundle.bundleJson, bundle.phrase);

      await restoreBudgetBackupBundle(verified);

      // Restoring several households has to activate each in turn. Finishing in
      // a different budget than you started in reads as a bug even when every
      // byte landed correctly.
      expect(getLocalLedger().household.id).toBe(a);
    },
    SLOW,
  );

  it(
    'restores onto a fresh install without leaving a stray empty budget',
    async () => {
      const { a, b } = await twoHouseholds();
      const bundle = await buildBudgetBackupBundle();

      // The fresh-install shape: signing in mints one empty household, and the
      // member reaches the restore screen holding only that. Both of the
      // bundle's households are strangers to this device.
      await resetLocalBudgetSession();
      await openLocalBudgetSessionForTests({ userId: 'user-bundle-1' });
      expect(listLocalBudgetHouseholds()).toHaveLength(1);
      const blank = getLocalLedger().household.id;
      expect(blank).not.toBe(a);
      expect(blank).not.toBe(b);

      const verified = verifyBudgetBackupFile(bundle.bundleJson, bundle.phrase);
      const result = await restoreBudgetBackupBundle(verified);

      expect(result.status).toBe('ok');
      // Two households in, two households out — the empty one was ADOPTED by
      // the first section rather than left beside it. Minting unconditionally
      // would leave three, one of them a blank the member has to work out how
      // to remove.
      expect(listLocalBudgetHouseholds().map((entry) => entry.householdId).sort()).toEqual(
        [a, b].sort(),
      );
      expect((await getLocalLedgerFor(a)).expenses[0].title).toBe('Main spending');
      expect((await getLocalLedgerFor(b)).expenses[0].title).toBe('Holiday spending');
    },
    SLOW,
  );

  it(
    'never adopts a household that already holds data',
    async () => {
      const { a, b } = await twoHouseholds();
      const bundle = await buildBudgetBackupBundle();

      // `a` is in use and `b` is gone. The adopt path must mint rather than
      // take `a` over — taking it would replace a live budget with the file's
      // under a different name.
      await removeLocalBudgetHousehold(b);

      const verified = verifyBudgetBackupFile(bundle.bundleJson, bundle.phrase);
      await restoreBudgetBackupBundle(verified);

      expect((await getLocalLedgerFor(a)).expenses[0].title).toBe('Main spending');
      expect((await getLocalLedgerFor(b)).expenses[0].title).toBe('Holiday spending');
    },
    SLOW,
  );

  it(
    'brings back a household this device no longer holds',
    async () => {
      const { a, b } = await twoHouseholds();
      const bundle = await buildBudgetBackupBundle();

      // The case backups exist for: the household is gone from the device.
      await removeLocalBudgetHousehold(b);
      expect(listLocalBudgetHouseholds().map((entry) => entry.householdId)).toEqual([a]);

      const verified = verifyBudgetBackupFile(bundle.bundleJson, bundle.phrase);
      expect(verified.households.find((entry) => entry.householdId === b)?.onThisDevice).toBe(
        false,
      );

      const result = await restoreBudgetBackupBundle(verified);

      expect(result.status).toBe('ok');
      expect(result.households.find((entry) => entry.householdId === b)?.status).toBe('adopted');
      // Adopted under its ORIGINAL id, so a later sync still addresses the same
      // household rather than a lookalike.
      expect(listLocalBudgetHouseholds().map((entry) => entry.householdId).sort()).toEqual(
        [a, b].sort(),
      );
      expect((await getLocalLedgerFor(b)).expenses[0].title).toBe('Holiday spending');
      // …and the household it was standing beside is untouched, which is what
      // the old single-archive restore could not promise: that path replaced
      // the ACTIVE household, so restoring a second budget overwrote the first.
      expect((await getLocalLedgerFor(a)).expenses[0].title).toBe('Main spending');
    },
    SLOW,
  );

  it(
    'skips a missing household when told not to adopt, and says so',
    async () => {
      const { b } = await twoHouseholds();
      const bundle = await buildBudgetBackupBundle();
      await removeLocalBudgetHousehold(b);

      const verified = verifyBudgetBackupFile(bundle.bundleJson, bundle.phrase);
      const result = await restoreBudgetBackupBundle(verified, {
        adoptMissingHouseholds: false,
      });

      // Partial, not ok: a household that did not come back must never be
      // reported the same way as one that did.
      expect(result.status).toBe('partial');
      expect(result.households.find((entry) => entry.householdId === b)?.status).toBe('skipped');
    },
    SLOW,
  );

  it(
    'restores only the households it was asked for',
    async () => {
      const { a, b } = await twoHouseholds();
      const bundle = await buildBudgetBackupBundle();
      (await getLocalLedgerFor(a)).expenses = [];
      (await getLocalLedgerFor(b)).expenses = [];

      const verified = verifyBudgetBackupFile(bundle.bundleJson, bundle.phrase);
      const result = await restoreBudgetBackupBundle(verified, { householdIds: [b] });

      expect(result.households).toHaveLength(1);
      expect((await getLocalLedgerFor(b)).expenses).toHaveLength(1);
      // Untouched — selective restore is the reason the sections are sealed
      // separately rather than as one blob.
      expect((await getLocalLedgerFor(a)).expenses).toHaveLength(0);
    },
    SLOW,
  );

  it(
    'narrows the bundle to one household when asked',
    async () => {
      const { a, b } = await twoHouseholds();

      const bundle = await buildBudgetBackupBundle({ householdIds: [b] });

      expect(bundle.households.map((entry) => entry.householdId)).toEqual([b]);
      const verified = verifyBudgetBackupFile(bundle.bundleJson, bundle.phrase);
      expect(verified.households.map((entry) => entry.householdId)).toEqual([b]);
      expect(verified.households.some((entry) => entry.householdId === a)).toBe(false);
    },
    SLOW,
  );

  /**
   * "Is everything backed up?" answered structurally rather than by a list
   * somebody has to remember to extend.
   *
   * Two halves have to agree and are written in different files:
   * `snapshotFromLedger` takes every ledger key except `ops`/`crypto`, and
   * `restoreDeltaFromBackup` walks `LEDGER_TABLE_NAMES`. A table added to the
   * ledger but not to the table registry is therefore SEALED and never RESTORED
   * — it rides along in the file, costs bytes, and silently fails to come back.
   * Nothing crashes; the data is just gone on the far side.
   */
  it('registers every ledger table, so none can be write-only', () => {
    // Free — no crypto, no session work — so it stays the first thing to fail
    // when someone adds a table and forgets the registry.
    expect(LEDGER_TABLE_NAMES).toEqual(expect.arrayContaining(ledgerTableNames()));
    expect(ledgerTableNames().length).toBeGreaterThan(20);
  });

  it(
    'round-trips a row in every one of those tables',
    async () => {
      const householdId = getLocalLedger().household.id;
      const ledger = getLocalLedger();
      const tables = ledgerTableNames();

      // Seed one row into every table, so the round-trip is over real rows
      // rather than the handful a fixture happens to touch.
      const seeded: Record<string, string> = {};
      for (const table of tables) {
        const id = `seed-${table}`;
        seeded[table] = id;
        (ledger as unknown as Record<string, Array<Record<string, unknown>>>)[table].push({
          id,
          // Enough shape for the projection's row key and its date bucketing;
          // every other column rides along verbatim.
          household_id: householdId,
          updated_at: '2026-08-29T00:00:00.000Z',
        });
      }

      // Pinned to ONE household on both legs. The in-memory store survives
      // `closeLocalBudgetSession`, so every household an earlier case left
      // behind is still on this device — an unpinned seal would grow with the
      // number of tests above it (measured: 14s alone, 15 minutes last in file)
      // while proving nothing extra.
      const bundle = await buildBudgetBackupBundle({ householdIds: [householdId] });

      for (const table of tables) {
        (ledger as unknown as Record<string, unknown[]>)[table] = [];
      }

      const verified = verifyBudgetBackupFile(bundle.bundleJson, bundle.phrase);
      await restoreBudgetBackupBundle(verified, { householdIds: [householdId] });

      const after = getLocalLedger() as unknown as Record<string, Array<{ id?: string }>>;
      const missing = tables.filter(
        (table) => !after[table]?.some((row) => row.id === seeded[table]),
      );
      expect(missing).toEqual([]);
    },
    SLOW,
  );

  it(
    'still restores a pre-bundle single-household archive',
    async () => {
      const householdId = getLocalLedger().household.id;
      await localBudgetApi.addExpense(householdId, {
        title: 'Written by the old build',
        amount: 700,
        expense_date: '2026-08-10',
      });
      const legacy = await buildBudgetBackupArchive({ householdId });

      getLocalLedger().expenses = [];

      const verified = verifyBudgetBackupFile(legacy.archiveJson, legacy.phrase);
      // Presented as a one-household bundle, so the restore screen has a single
      // shape to render whichever file the member picked.
      expect(verified.kind).toBe('archive');
      expect(verified.status).toBe('ok');
      expect(verified.households).toHaveLength(1);
      expect(verified.households[0].householdId).toBe(householdId);

      const result = await restoreBudgetBackupBundle(verified);

      expect(result.status).toBe('ok');
      expect(getLocalLedger().expenses[0].title).toBe('Written by the old build');
    },
    SLOW,
  );

  it(
    'refuses a wrong phrase without touching any ledger',
    async () => {
      const { a } = await twoHouseholds();
      const bundle = await buildBudgetBackupBundle();
      (await getLocalLedgerFor(a)).expenses = [];

      const verified = verifyBudgetBackupFile(
        bundle.bundleJson,
        'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo',
      );

      expect(verified.status).toBe('failed');
      expect(verified.households).toEqual([]);
      expect((await getLocalLedgerFor(a)).expenses).toHaveLength(0);
    },
    SLOW,
  );
});
