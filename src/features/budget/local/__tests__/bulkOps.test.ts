/**
 * Stage 3 — bulk writes emit ONE op per chunk instead of one op per row, and a
 * chunk is small enough that no single op can approach the relay's deposit cap.
 *
 * Batching is only correct if the emitted ops still project the same ledger on
 * a peer, so every op count assertion is paired with a convergence check that
 * decrypts the real sealed payload and replays it into a virgin ledger.
 */
import '../cryptoPolyfill';

import { aeadDecrypt, utf8Decode, utf8Encode } from '@symply/local-first';

import { commitLocalSavingsHistoryImport, commitLocalSavingsImport } from '../ai/confirmSavingsImport';
import {
  closeLocalBudgetSession,
  getLocalHouseholdKeys,
  getLocalLedger,
  getLocalMemberId,
  mutateLocalLedger,
  openLocalBudgetSessionForTests,
  type LocalBudgetLedger,
} from '../engine';
import { localBudgetApi } from '../localBudgetApi';
import {
  MAX_OP_DELTA_BYTES,
  MAX_OP_DELTA_ROWS,
  applyLedgerDelta,
  decodeLedgerOpPayload,
} from '../projection';
import { localRegisteredApi } from '../savings/localRegisteredApi';
import { localSavingsApi } from '../savings/localSavingsApi';

import { emptyLedger } from './ledgerTestKit';

function opCount(): number {
  return getLocalLedger().ops.length;
}

/** Open each op exactly as a peer's OpLog does, so this asserts the real wire. */
function decodedOps(since: number) {
  const keys = getLocalHouseholdKeys();
  return getLocalLedger()
    .ops.slice(since)
    .map((stored) => {
      const plaintext = aeadDecrypt(
        keys.hdk,
        stored.payload,
        utf8Encode(`${stored.householdId}:${stored.keyEpoch}:${stored.opId}`),
      );
      const raw = utf8Decode(plaintext);
      return {
        stored,
        raw,
        delta: decodeLedgerOpPayload(JSON.parse(raw)),
      };
    });
}

/** Replay a slice of the author's ops into a peer that has seen nothing. */
function projectOntoPeer(since: number): LocalBudgetLedger {
  const peer = emptyLedger(getLocalLedger().household.id, 'peer', 'dev-peer');
  for (const { stored, delta } of decodedOps(since)) {
    if (!delta) continue;
    applyLedgerDelta(peer, delta, {
      hlc: stored.hlc,
      authorMemberId: stored.authorMemberId,
      opId: stored.opId,
    });
  }
  return peer;
}

describe('bulk ops emit one op per chunk', () => {
  beforeEach(async () => {
    await openLocalBudgetSessionForTests({ userId: 'user-bulk-1' });
  });

  afterEach(async () => {
    await closeLocalBudgetSession();
  });

  it('addExpensesBulk writes 50 expenses in a single op', async () => {
    const householdId = getLocalLedger().household.id;
    const category = getLocalLedger().categories[0]!;
    const before = opCount();

    const rows = Array.from({ length: 50 }, (_, i) => ({
      title: `Bulk ${i}`,
      amount: 100 + i,
      expense_date: '2026-08-10',
      category_id: i % 2 === 0 ? category.id : undefined,
    }));
    const { expenses } = await localBudgetApi.addExpensesBulk(householdId, rows);

    expect(opCount() - before).toBe(1);
    expect(expenses).toHaveLength(50);
    expect(expenses.map((e) => e.title)).toEqual(rows.map((r) => r.title));
    expect(getLocalLedger().expenses).toHaveLength(50);
    // 25 of the 50 named the category.
    expect(getLocalLedger().categories.find((c) => c.id === category.id)!.usage_count).toBe(25);

    const peer = projectOntoPeer(before);
    expect(peer.expenses.map((e) => e.id)).toEqual(expenses.map((e) => e.id));
  });

  it('addExpensesBulk keeps every op under the wire budget', async () => {
    const householdId = getLocalLedger().household.id;
    const before = opCount();
    await localBudgetApi.addExpensesBulk(
      householdId,
      Array.from({ length: 500 }, (_, i) => ({
        title: `Row ${i}`,
        amount: i,
        expense_date: '2026-08-10',
        description: 'x'.repeat(120),
      })),
    );

    const ops = decodedOps(before);
    // 500 rows → a handful of chunks, not 500 ops.
    expect(ops.length).toBeGreaterThan(1);
    expect(ops.length).toBeLessThan(20);
    for (const op of ops) {
      expect(op.raw.length).toBeLessThan(MAX_OP_DELTA_BYTES * 2);
      expect(op.delta!.u!.expenses!.length).toBeLessThanOrEqual(MAX_OP_DELTA_ROWS);
    }
    expect(projectOntoPeer(before).expenses).toHaveLength(500);
  }, 60_000);

  it('applyGoalToYear emits one op for three different starting states', async () => {
    const householdId = getLocalLedger().household.id;

    let before = opCount();
    const fresh = await localBudgetApi.applyGoalToYear(householdId, 2026, 3, 500_000);
    expect(opCount() - before).toBe(1);
    expect(fresh.updatedMonths).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

    // Anchor month already budgeted — it is still rewritten.
    before = opCount();
    const again = await localBudgetApi.applyGoalToYear(householdId, 2026, 3, 700_000);
    expect(opCount() - before).toBe(1);
    expect(again.updatedMonths).toEqual([3]);
    expect((await localBudgetApi.getMonthlyGoal(householdId, 2026, 3)).goal.planned_budget).toBe(
      700_000,
    );
    expect((await localBudgetApi.getMonthlyGoal(householdId, 2026, 4)).goal.planned_budget).toBe(
      500_000,
    );

    // Some months budgeted, some not.
    before = opCount();
    const partial = await localBudgetApi.applyGoalToYear(householdId, 2027, 10, 100);
    expect(opCount() - before).toBe(1);
    expect(partial.updatedMonths).toEqual([10, 11, 12]);
  });

  it('applyGoalToYear carries actual_spent per month, not the anchor month', async () => {
    const householdId = getLocalLedger().household.id;
    await localBudgetApi.addExpensesBulk(householdId, [
      { title: 'March', amount: 3_000, expense_date: '2028-03-04' },
      { title: 'May', amount: 5_000, expense_date: '2028-05-04' },
    ]);

    await localBudgetApi.applyGoalToYear(householdId, 2028, 3, 111);
    const goals = getLocalLedger().goals.filter((g) => g.year === 2028);
    expect(goals.find((g) => g.month === 3)!.actual_spent).toBe(3_000);
    expect(goals.find((g) => g.month === 5)!.actual_spent).toBe(5_000);
    expect(goals.find((g) => g.month === 4)!.actual_spent).toBe(0);
  });
});

describe('savings import batching', () => {
  beforeEach(async () => {
    await openLocalBudgetSessionForTests({ userId: 'user-bulk-2' });
  });

  afterEach(async () => {
    await closeLocalBudgetSession();
  });

  it('commits 500 income + 500 spending rows in chunked ops and converges on a peer', async () => {
    const householdId = getLocalLedger().household.id;
    const before = opCount();

    const result = await commitLocalSavingsImport(householdId, 'job_bulk', {
      income: Array.from({ length: 500 }, (_, i) => ({
        source_type: 'payroll' as const,
        label: `Pay ${i}`,
        amount_cents: 1_000 + i,
        income_date: '2026-08-15',
      })),
      spending: Array.from({ length: 500 }, (_, i) => ({
        label: `Spend ${i}`,
        amount_cents: 500 + i,
        spending_date: '2026-08-16',
        category_name: null,
      })),
      recurringPayments: [],
    } as never);

    const ops = decodedOps(before);
    expect(result).toEqual({ income: 500, spending: 500, recurringPayments: 0 });
    expect(ops.length).toBeGreaterThan(1);
    expect(ops.length).toBeLessThan(30);
    for (const op of ops) {
      expect(op.raw.length).toBeLessThan(MAX_OP_DELTA_BYTES * 2);
      const rows = op.delta!.u!.savingsIncome ?? op.delta!.u!.savingsSpending ?? [];
      expect(rows.length).toBeLessThanOrEqual(MAX_OP_DELTA_ROWS);
    }

    const peer = projectOntoPeer(before);
    expect(peer.savingsIncome.map((r) => r.id)).toEqual(
      getLocalLedger().savingsIncome.map((r) => r.id),
    );
    expect(peer.savingsSpending.map((r) => r.id)).toEqual(
      getLocalLedger().savingsSpending.map((r) => r.id),
    );
  }, 120_000);

  it('is a no-op when the same job is committed again', async () => {
    const householdId = getLocalLedger().household.id;
    const selections = {
      income: Array.from({ length: 20 }, (_, i) => ({
        source_type: 'payroll' as const,
        label: `Pay ${i}`,
        amount_cents: 100,
        income_date: '2026-08-15',
      })),
      spending: [],
      recurringPayments: [],
    } as never;

    await commitLocalSavingsImport(householdId, 'job_idem', selections);
    const opsAfterFirst = opCount();
    const rowsAfterFirst = getLocalLedger().savingsIncome.length;

    const second = await commitLocalSavingsImport(householdId, 'job_idem', selections);
    expect(second.income).toBe(0);
    expect(opCount()).toBe(opsAfterFirst);
    expect(getLocalLedger().savingsIncome).toHaveLength(rowsAfterFirst);
  });

  it('routes history-grid spending through addExpensesBulk', async () => {
    const householdId = getLocalLedger().household.id;
    const before = opCount();

    const result = await commitLocalSavingsHistoryImport(householdId, 'job_hist', {
      income: [],
      monthlyGridSpending: [
        { period: '2025-01', category_name: 'Rent', amount_cents: 100 },
        { period: '2025-02', category_name: 'Food', amount_cents: 200 },
        { period: '2026-03', category_name: 'Fuel', amount_cents: 300 },
      ],
    } as never);

    expect(result.spending).toBe(3);
    expect(result.years).toEqual([2025, 2026]);
    // One op for the three expenses; the income half contributed none.
    expect(opCount() - before).toBe(1);
    expect(getLocalLedger().expenses.map((e) => e.description)).toEqual([
      'history_import:job_hist:0',
      'history_import:job_hist:1',
      'history_import:job_hist:2',
    ]);
  });
});

describe('in-mutator quadratics', () => {
  beforeEach(async () => {
    await openLocalBudgetSessionForTests({ userId: 'user-bulk-4' });
  });

  afterEach(async () => {
    await closeLocalBudgetSession();
  });

  it('applies 40 recurring payments across 12 months over a 7,000-row table quickly', async () => {
    const householdId = getLocalLedger().household.id;
    await mutateLocalLedger(
      (ledger) => {
        for (let i = 0; i < 40; i += 1) {
          ledger.savingsRecurringPayments.push({
            id: `rec_${i}`,
            household_id: householdId,
            category_id: null,
            label: `Recurring ${i}`,
            amount_cents: 1_000 + i,
            currency: 'CAD',
            day_of_month: 1,
            group_label: null,
            is_essential: false,
            active: true,
            is_automated: false,
            scope_type: 'all_year',
            scope_year: null,
            active_months: null,
            source: 'manual',
            created_by: 'test',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          } as never);
        }
        // Unrelated history the old `some()` predicate scanned on every probe.
        for (let i = 0; i < 7_000; i += 1) {
          ledger.savingsSpending.push({
            id: `noise_${i}`,
            household_id: householdId,
            category_id: null,
            label: `Noise ${i}`,
            amount_cents: 1,
            currency: 'CAD',
            spending_date: '2024-01-15',
            notes: null,
            recurring_payment_id: null,
            period: null,
            created_by: 'test',
            created_at: '2024-01-15T00:00:00.000Z',
            updated_at: '2024-01-15T00:00:00.000Z',
          } as never);
        }
      },
      { opType: 'TEST_SEED', entityType: 'savings_spending', entityId: 'seed', payload: {} },
    );

    const months = Array.from({ length: 12 }, (_, i) => ({ year: 2026, month: i + 1 }));
    const before = opCount();
    const started = Date.now();
    const first = await localSavingsApi.applyRecurringPaymentsToMonths(householdId, months);
    const elapsed = Date.now() - started;

    expect(first).toEqual({ created: 480, skipped: 0, months: 12 });
    // The chunk count is what makes this bound predictable, so pin it: 480 rows
    // at ~400 chars each is 3 chunks under MAX_OP_DELTA_BYTES.
    expect(opCount() - before).toBe(3);
    // MEASURED on this tree (Node 22 / jest, 7,480-row ledger): 3,027 ms for the
    // 3 chunked ops vs 1,077 ms when the same rows went out as one op. The
    // ~975 ms/op is engine-level — `mutateLocalLedger` re-snapshots and
    // re-persists the WHOLE ledger per op — not the quadratic this test guards,
    // which the `appliedRecurringKeys` Set still removes. Chunking wins anyway:
    // unchunked, a 24-month or 78-payment apply crosses the relay's 512,000-char
    // deposit cap and the op becomes permanently undeliverable.
    // Ceiling sized for the QUADRATIC this guards, not for a stopwatch: that
    // regression is orders of magnitude (the Set's removal re-introduces an
    // O(n^2) scan over a 7,480-row ledger), so it blows past any bound here.
    // 6,000 against a measured 3,027 left ~2x headroom, which the full suite
    // ate — 7,993 ms under ~11 parallel workers, red in the suite and green
    // alone. The structural guard is `opCount() === 3` above; this only has to
    // stay below the blowup.
    expect(elapsed).toBeLessThan(20_000);

    // Re-applying is fully skipped, which is the property the Set replaced.
    const second = await localSavingsApi.applyRecurringPaymentsToMonths(householdId, months);
    expect(second).toEqual({ created: 0, skipped: 480, months: 12 });
  }, 120_000);

  it('chunks 12 months x 40 recurring payments instead of one 480-row op', async () => {
    const householdId = getLocalLedger().household.id;
    await mutateLocalLedger(
      (ledger) => {
        for (let i = 0; i < 40; i += 1) {
          ledger.savingsRecurringPayments.push({
            id: `rec_${i}`,
            household_id: householdId,
            category_id: null,
            label: `Recurring payment number ${i}`,
            amount_cents: 1_000 + i,
            currency: 'CAD',
            day_of_month: 1,
            group_label: null,
            is_essential: false,
            active: true,
            is_automated: false,
            scope_type: 'all_year',
            scope_year: null,
            active_months: null,
            source: 'manual',
            created_by: 'test',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          } as never);
        }
      },
      { opType: 'TEST_SEED', entityType: 'savings_recurring', entityId: 'seed', payload: {} },
    );

    const months = Array.from({ length: 12 }, (_, i) => ({ year: 2026, month: i + 1 }));
    const before = opCount();
    const result = await localSavingsApi.applyRecurringPaymentsToMonths(householdId, months);
    expect(result).toEqual({ created: 480, skipped: 0, months: 12 });

    const ops = decodedOps(before);
    expect(ops.length).toBeGreaterThan(1);
    for (const op of ops) {
      const rows = op.delta!.u!.savingsSpending ?? [];
      expect(rows.length).toBeLessThanOrEqual(MAX_OP_DELTA_ROWS);
      expect(op.raw.length).toBeLessThan(MAX_OP_DELTA_BYTES * 2);
    }

    const peer = projectOntoPeer(before);
    expect(peer.savingsSpending.map((r) => r.id)).toEqual(
      getLocalLedger().savingsSpending.map((r) => r.id),
    );
  }, 120_000);

  it('emits no op at all when every month was already applied', async () => {
    const householdId = getLocalLedger().household.id;
    await localSavingsApi.createRecurringPayment(householdId, {
      id: 'rec_once',
      label: 'Rent',
      amount_cents: 200_000,
      day_of_month: 1,
    } as never);
    const months = [{ year: 2026, month: 4 }];
    await localSavingsApi.applyRecurringPaymentsToMonths(householdId, months);

    const before = opCount();
    expect(await localSavingsApi.applyRecurringPaymentsToMonths(householdId, months)).toEqual({
      created: 0,
      skipped: 1,
      months: 1,
    });
    // Nothing changed, so nothing is sealed, persisted or relayed.
    expect(opCount()).toBe(before);
  });

  it('chunks a large income-template apply instead of one 400-row op', async () => {
    const householdId = getLocalLedger().household.id;
    await mutateLocalLedger(
      (ledger) => {
        for (let i = 0; i < 400; i += 1) {
          ledger.savingsIncomeTemplates.push({
            id: `tpl_${i}`,
            household_id: householdId,
            member_id: 'test-member',
            source_type: 'payroll',
            label: `Income template number ${i}`,
            amount_cents: 100_000 + i,
            currency: 'CAD',
            day_of_month: 1,
            active: true,
            created_at: '2026-01-01T00:00:00.000Z',
          } as never);
        }
      },
      {
        opType: 'TEST_SEED',
        entityType: 'savings_income_template',
        entityId: 'seed',
        payload: {},
      },
    );

    const before = opCount();
    const result = await localSavingsApi.applyIncomeTemplates(householdId, { year: 2026, month: 9 });
    expect(result).toEqual({ created: 400, skipped: 0 });

    const ops = decodedOps(before);
    expect(ops.length).toBeGreaterThan(1);
    for (const op of ops) {
      const rows = op.delta!.u!.savingsIncome ?? [];
      expect(rows.length).toBeLessThanOrEqual(MAX_OP_DELTA_ROWS);
      expect(op.raw.length).toBeLessThan(MAX_OP_DELTA_BYTES * 2);
    }

    const peer = projectOntoPeer(before);
    expect(peer.savingsIncome.map((r) => r.id)).toEqual(
      getLocalLedger().savingsIncome.map((r) => r.id),
    );
  }, 120_000);

  it('does not double-apply an income template within one call', async () => {
    const householdId = getLocalLedger().household.id;
    await localSavingsApi.createIncomeTemplate(householdId, {
      id: 'tpl_1',
      source_type: 'payroll',
      label: 'Salary',
      amount_cents: 400_000,
      day_of_month: 1,
    } as never);

    expect(await localSavingsApi.applyIncomeTemplates(householdId, { year: 2026, month: 9 })).toEqual(
      { created: 1, skipped: 0 },
    );
    expect(await localSavingsApi.applyIncomeTemplates(householdId, { year: 2026, month: 9 })).toEqual(
      { created: 0, skipped: 1 },
    );
  });
});

describe('registered import batching', () => {
  beforeEach(async () => {
    await openLocalBudgetSessionForTests({ userId: 'user-bulk-3' });
  });

  afterEach(async () => {
    await closeLocalBudgetSession();
  });

  it('imports 3 accounts x 100 transactions in a bounded number of ops', async () => {
    const householdId = getLocalLedger().household.id;
    const memberId = getLocalMemberId();
    const before = opCount();

    const accounts = Array.from({ length: 3 }, (_, a) => ({
      id: `acct_${a}`,
      member_id: memberId,
      account_type: 'tfsa' as const,
      institution: `Bank ${a}`,
      contributions: Array.from({ length: 100 }, (__, t) => ({
        id: `tx_${a}_${t}`,
        amount_cents: 1_000 + t,
        transaction_date: '2025-05-04',
        contributor: 'self' as const,
      })),
    }));

    const result = await localRegisteredApi.commitRegisteredImport(householdId, {
      import_batch_id: 'batch_1',
      accounts,
    } as never);

    expect(result.transactionCount).toBe(300);
    expect(result.createdAccountIds).toEqual(['acct_0', 'acct_1', 'acct_2']);
    // Was 6 ops (create + transactions per account) before batching.
    const ops = decodedOps(before);
    expect(ops.length).toBeLessThanOrEqual(4);
    for (const op of ops) expect(op.raw.length).toBeLessThan(MAX_OP_DELTA_BYTES * 2);

    const ledger = getLocalLedger();
    expect(ledger.registeredAccounts).toHaveLength(3);
    for (const account of ledger.registeredAccounts) {
      // No explicit balance_cents → recomputed over all 100 contributions.
      expect(account.balance_cents).toBe(
        Array.from({ length: 100 }, (_, t) => 1_000 + t).reduce((s, v) => s + v, 0),
      );
    }

    const peer = projectOntoPeer(before);
    expect(peer.registeredTransactions).toHaveLength(300);
    expect(peer.registeredAccounts.map((a) => a.balance_cents)).toEqual(
      ledger.registeredAccounts.map((a) => a.balance_cents),
    );
  }, 60_000);

  it('honours an explicit balance and updates an existing account', async () => {
    const householdId = getLocalLedger().household.id;
    await localRegisteredApi.createAccount(householdId, {
      id: 'acct_existing',
      member_id: getLocalMemberId(),
      account_type: 'rrsp',
      institution: 'Old bank',
      balance_cents: 5,
    });

    const before = opCount();
    const result = await localRegisteredApi.commitRegisteredImport(householdId, {
      import_batch_id: 'batch_2',
      accounts: [
        {
          existing_account_id: 'acct_existing',
          account_type: 'rrsp',
          institution: 'New bank',
          balance_cents: 999_999,
          contributions: [
            { id: 'tx_e_1', amount_cents: 42, transaction_date: '2025-01-02' },
          ],
        },
      ],
    } as never);

    expect(result.createdAccountIds).toEqual([]);
    expect(result.transactionCount).toBe(1);
    expect(opCount() - before).toBe(2);
    const account = getLocalLedger().registeredAccounts.find((a) => a.id === 'acct_existing')!;
    expect(account.institution).toBe('New bank');
    expect(account.balance_cents).toBe(999_999);
  });

  it('creates a member contribution line in one op', async () => {
    const householdId = getLocalLedger().household.id;
    const before = opCount();

    const { account } = await localRegisteredApi.addMemberContribution(householdId, {
      member_id: getLocalMemberId(),
      account_type: 'tfsa',
      amount_cents: 25_000,
      transaction_date: '2025-06-01',
    } as never);

    expect(account.is_room_only).toBe(true);
    // Line ensure + the contribution transaction. It was three ops before.
    expect(opCount() - before).toBe(2);
  });
});
