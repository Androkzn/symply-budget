/**
 * BR-016 — concurrent writes to two households must not bleed into each other.
 *
 * This suite exists for one defect. Each of the seven Budget facades used to
 * carry its own private helper:
 *
 *     async function withHousehold(id, run) {
 *       if (getActiveBudgetHouseholdId() !== id) await activateLocalBudgetHousehold(id);
 *       return run();
 *     }
 *
 * which reads as safe and is not. `activateLocalBudgetHousehold` is queued on the
 * engine's session chain; `mutateLocalLedger` is NOT, and it binds
 * `requireEngine()` synchronously at the moment it is called — which is always
 * one or more `await`s after the activation, because every facade method reads
 * `getLocalLedgerFor(...)` or builds a row first. So a second facade call for
 * another household could land its activation in that gap and take the write with
 * it: household A's rows authored into household B's ledger, sealed under B's
 * HDK, verifying, syncing to B's peers, and invisible to every integrity check
 * the engine has. The project's requirement is 100% isolation between
 * households, so this is data corruption, not a glitch.
 *
 * `runOnHousehold(id, work)` (engine.ts) fixes it by holding the session chain
 * across BOTH the activation and the work. The tests below are written to FAIL
 * against the old per-facade helper and pass against it:
 *
 *  - the racing pair deliberately crosses TWO facades (budget + savings),
 *    because a lock inside either file could not have seen the other — they write
 *    one ledger, so the lock has to live in the engine;
 *  - the losing call is a BULK write, so it issues several `mutateLocalLedger`
 *    calls in sequence. The first one wins the race and lands correctly; the
 *    later ones are the ones the old helper let slide into the other household,
 *    which is exactly the shape that makes this bug so hard to see in the field —
 *    a write "works", and only part of it moved.
 *
 * The nesting test is the other half of the contract. `runOnHousehold` may not be
 * a plain queue: the facades already compose (`recordPlannedSpending` awaits
 * `addExpense`; `confirmIncome` awaits `updateIncome`), so an inner call queued
 * behind the outer one that is awaiting it would hang the app on a gesture that
 * works today. Those inner calls ride inside the pin their parent holds.
 */
import {
  activateLocalBudgetHousehold,
  createLocalBudgetHousehold,
  getActiveBudgetHouseholdId,
  getLocalLedgerFor,
  openLocalBudgetSession,
  resetLocalBudgetSession,
} from '../engine';
import { localBudgetApi, type AddExpenseInput } from '../localBudgetApi';
import { localSavingsApi } from '../savings/localSavingsApi';

const USER = 'user-household-write-race';

/**
 * Enough rows to span more than one op chunk (`MAX_OP_DELTA_ROWS` is 250, and the
 * 64 KB budget splits these sooner still), so `addExpensesBulk` makes SEVERAL
 * `mutateLocalLedger` calls with `await`s between them. One chunk would let the
 * whole write bind the active session before the racing activation resolved and
 * the old helper would pass by luck.
 */
const BULK_ROWS = 300;

function bulkExpenses(): AddExpenseInput[] {
  return Array.from({ length: BULK_ROWS }, (_row, index) => ({
    title: `Bulk ${index}`,
    amount: 100 + index,
    expense_date: '2026-08-10',
  }));
}

/** Three households on one device, so a case can leave BOTH racers in background. */
async function threeHouseholds(): Promise<{ a: string; b: string; c: string }> {
  await resetLocalBudgetSession();
  const first = await openLocalBudgetSession({ userId: USER, displayName: 'Everyday budget' });
  const second = await createLocalBudgetHousehold({ displayName: 'Cottage budget' });
  const third = await createLocalBudgetHousehold({ displayName: 'Parents’ budget' });
  return { a: first.household.id, b: second.household.id, c: third.household.id };
}

/**
 * The households a set of rows claims to belong to, deduped.
 *
 * Asserted on instead of `rows.every(...)`, and instead of filtering the foreign
 * rows out and comparing arrays, purely for the failure message: a bled bulk
 * write puts hundreds of rows in the wrong ledger, and both of those spell the
 * defect as a five-thousand-line object diff. This spells it as
 * `Expected [] / Received ["hh_local_…"]` — which household leaked, at a glance.
 */
function householdsIn(rows: ReadonlyArray<{ household_id: string }>): string[] {
  return [...new Set(rows.map((row) => row.household_id))].sort();
}

function income(id: string) {
  return {
    id,
    source_type: 'payroll' as const,
    label: 'Salary',
    amount_cents: 500_000,
    income_date: '2026-08-01',
  };
}

afterEach(async () => {
  await resetLocalBudgetSession();
});

describe('two households written concurrently stay isolated', () => {
  it('does not let a sibling facade’s activation steal the tail of a bulk write', async () => {
    const { a, b } = await threeHouseholds();
    await activateLocalBudgetHousehold(a);

    // The savings call goes FIRST so its activation is already queued when the
    // budget bulk starts — the ordering a member produces by tapping "save" on
    // one household's screen while another household's write is still draining.
    // The budget bulk names the household that is ALREADY active, so the old
    // helper skipped activation entirely and held nothing at all.
    //
    // `allSettled`, not `all`, and deliberately: the race does not only misfile
    // rows, it can also make the two op logs collide on this one device's seq
    // counter and throw out of the write. Letting that abort the test would hide
    // the corruption the assertions below are here to name — and the misfiled
    // rows are in the wrong ledger by then either way, because
    // `mutateLocalLedger` mutates the ledger before it persists.
    const outcomes = await Promise.allSettled([
      localSavingsApi.createIncome(b, income('inc_cottage')),
      localBudgetApi.addExpensesBulk(a, bulkExpenses()),
    ]);

    const ledgerA = await getLocalLedgerFor(a);
    const ledgerB = await getLocalLedgerFor(b);

    // THE isolation assertion: no row in either ledger belongs to the other
    // household. Under the old helper B collected whatever chunks were written
    // after its activation landed — rows stamped `household_id: a` sitting in B's
    // ledger and sealed under B's HDK, which no later read can detect.
    expect(householdsIn(ledgerB.expenses)).toEqual([]);
    expect(householdsIn(ledgerA.expenses)).toEqual([a]);
    expect(householdsIn(ledgerA.savingsIncome)).toEqual([]);
    expect(householdsIn(ledgerB.savingsIncome)).toEqual([b]);

    // Nothing was merely dropped instead: both writes completed, whole, in the
    // household they named.
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(ledgerA.expenses).toHaveLength(BULK_ROWS);
    expect(ledgerB.savingsIncome.map((row) => row.id)).toEqual(['inc_cottage']);
  });

  it('keeps two BACKGROUND households apart when both must be activated', async () => {
    const { a, b, c } = await threeHouseholds();
    await activateLocalBudgetHousehold(c);

    // Neither racer is on screen, so both have to activate — the background-sync
    // and deep-link shape, where nothing is a member gesture and nothing awaits
    // politely. Both activations queue on the same chain, and under the old
    // helper the second one resolved while the first call was still writing.
    const outcomes = await Promise.allSettled([
      localSavingsApi.createIncome(b, income('inc_background')),
      localBudgetApi.addExpensesBulk(a, bulkExpenses()),
    ]);

    const ledgerA = await getLocalLedgerFor(a);
    const ledgerB = await getLocalLedgerFor(b);
    const ledgerC = await getLocalLedgerFor(c);

    expect(householdsIn(ledgerA.expenses)).toEqual([a]);
    expect(householdsIn(ledgerB.expenses)).toEqual([]);
    expect(householdsIn(ledgerB.savingsIncome)).toEqual([b]);
    expect(householdsIn(ledgerA.savingsIncome)).toEqual([]);

    // The household that was merely ON SCREEN collected nothing either. It is the
    // one `mutateLocalLedger` would have defaulted to had either call written
    // before its activation resolved rather than after.
    expect(ledgerC.expenses).toHaveLength(0);
    expect(ledgerC.savingsIncome).toHaveLength(0);

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(ledgerA.expenses).toHaveLength(BULK_ROWS);
    expect(ledgerB.savingsIncome.map((row) => row.id)).toEqual(['inc_background']);
  });

  it('survives a shuffled burst across four facades and two households', async () => {
    const { a, b } = await threeHouseholds();
    await activateLocalBudgetHousehold(a);

    // Alternating households on every call, so a lock that serialized per file
    // (or per facade) would still interleave A and B here.
    const outcomes = await Promise.allSettled([
      localBudgetApi.addExpense(a, { title: 'A groceries', amount: 1200, expense_date: '2026-08-11' }),
      localSavingsApi.createIncome(b, income('inc_b1')),
      localBudgetApi.createCategory(b, { name: 'Cottage repairs' }),
      localSavingsApi.createIncome(a, income('inc_a1')),
      localBudgetApi.addExpensesBulk(b, bulkExpenses()),
      localBudgetApi.addExpense(a, { title: 'A fuel', amount: 6400, expense_date: '2026-08-12' }),
    ]);

    const ledgerA = await getLocalLedgerFor(a);
    const ledgerB = await getLocalLedgerFor(b);

    // Nothing anywhere claims to belong to the other household — including the
    // seeded categories, which BOTH households number `cat_default_1..N`. Those
    // shared row keys are why the `household_id` check has to be per row and not
    // per id: a bled category does not even look out of place.
    expect(householdsIn(ledgerA.expenses)).toEqual([a]);
    expect(householdsIn(ledgerB.expenses)).toEqual([b]);
    expect(householdsIn(ledgerA.savingsIncome)).toEqual([a]);
    expect(householdsIn(ledgerB.savingsIncome)).toEqual([b]);
    expect(householdsIn(ledgerA.categories)).toEqual([a]);
    expect(householdsIn(ledgerB.categories)).toEqual([b]);

    expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(true);
    expect(ledgerA.expenses.map((row) => row.title).sort()).toEqual(['A fuel', 'A groceries']);
    expect(ledgerB.expenses).toHaveLength(BULK_ROWS);
    expect(ledgerA.savingsIncome.map((row) => row.id)).toEqual(['inc_a1']);
    expect(ledgerB.savingsIncome.map((row) => row.id)).toEqual(['inc_b1']);
    expect(ledgerA.categories.some((row) => row.name === 'Cottage repairs')).toBe(false);
    expect(ledgerB.categories.some((row) => row.name === 'Cottage repairs')).toBe(true);
  });
});

describe('composed facade calls still work inside the lock', () => {
  it('completes a nested read+write+write against a background household', async () => {
    const { a, b } = await threeHouseholds();
    await activateLocalBudgetHousehold(a);

    // `recordPlannedSpending` wraps three awaited facade calls, two of which take
    // the lock again for the SAME household. A lock that simply queued every call
    // would deadlock here — the outer link awaiting an inner one queued behind it
    // — and this test would hang rather than fail. It is deliberately aimed at a
    // household that is NOT active, so the outer call performs a real activation
    // before the nested pair rides inside it.
    const { item } = await localBudgetApi.createItem(b, {
      title: 'New canoe',
      timeframe: 'month',
      year: 2026,
      priority: 'medium',
      estimated_cost_min: 80_000,
      estimated_cost_max: 80_000,
      target_date: '2026-08-15',
    });
    const recorded = await localBudgetApi.recordPlannedSpending(b, item.id);

    expect(recorded.expense.amount).toBe(80_000);
    expect(recorded.item.status).toBe('completed');
    expect(getActiveBudgetHouseholdId()).toBe(b);

    // The whole composition landed in B, and A — which was active when it started
    // — took none of it.
    const ledgerA = await getLocalLedgerFor(a);
    const ledgerB = await getLocalLedgerFor(b);
    expect(ledgerB.expenses.map((row) => row.household_id)).toEqual([b]);
    expect(ledgerB.items.map((row) => row.household_id)).toEqual([b]);
    expect(ledgerA.expenses).toHaveLength(0);
    expect(ledgerA.items).toHaveLength(0);
  });

  it('completes a nested savings composition while another household writes', async () => {
    const { a, b } = await threeHouseholds();
    await activateLocalBudgetHousehold(a);

    await localSavingsApi.createIncome(b, income('inc_nested'));

    // `confirmIncome` awaits `updateIncome` inside its own wrapper — a nested
    // call — while a bulk write for the OTHER household runs concurrently. Both
    // halves of the pair must land in B even though A is competing for the
    // session the whole time.
    const [confirmed] = await Promise.allSettled([
      localSavingsApi.confirmIncome(b, 'inc_nested', { label: 'Renamed salary' }),
      localBudgetApi.addExpensesBulk(a, bulkExpenses()),
    ]);

    const ledgerA = await getLocalLedgerFor(a);
    const ledgerB = await getLocalLedgerFor(b);
    expect(householdsIn(ledgerB.savingsIncome)).toEqual([b]);
    expect(householdsIn(ledgerA.savingsIncome)).toEqual([]);
    expect(householdsIn(ledgerA.expenses)).toEqual([a]);
    expect(householdsIn(ledgerB.expenses)).toEqual([]);

    // The nested update did not get separated from the confirm it belongs to —
    // under the old helper the inner `updateIncome` re-checked the active
    // household on its own and could be pulled into A between the two.
    expect(confirmed.status).toBe('fulfilled');
    expect(ledgerB.savingsIncome.map((row) => row.label)).toEqual(['Renamed salary']);
    expect(ledgerB.savingsIncome.map((row) => row.status)).toEqual(['confirmed']);
    expect(ledgerA.expenses).toHaveLength(BULK_ROWS);
  });
});
