/**
 * Previous-years history + comparison + history-import tests.
 *
 * Covers the read model (getAvailableYears / getYearHistory / compareYears) and
 * the history-import commit/undo path on SavingsImportService. The AIProvider is
 * never called here (commitHistory does no model work), so no stub is needed.
 *
 * Key invariants under test:
 *  - getYearHistory buckets budget `expenses` into food/monthlyPayments/other by
 *    category name (the historical/imported path), PLUS folds in the
 *    household's active recurring payments (the live path — same source
 *    `getOverview`/`getTrend` use, via `isRecurringPaymentActiveInMonth`) into
 *    the monthlyPayments bucket, and net_m = income_m − (payments+food+other);
 *  - that net matches getTrend both with NO active recurring payments (the
 *    historical case) and WITH them (the live case) — the single source of
 *    truth stays consistent either way;
 *  - commitHistory writes income → savings_income_entries and each grid cell →
 *    budget `expenses` (NOT savings_spending_entries), stamped
 *    source='history_import' + import_batch_id;
 *  - it is idempotent on re-commit, replaces a prior year on re-import, and undo
 *    deletes exactly the batch while leaving manual rows intact.
 */

import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { AIProvider } from '../../ai/provider';
import * as schema from '../../db/schema';
import { expenses, budgetCategories, budgetGoals } from '../../db/schema-budget';
import {
  savingsIncomeEntries,
  savingsSpendingEntries,
  savingsGoals,
  savingsImportJobs,
  savingsRecurringPayments,
} from '../../db/schema-savings';
import {
  createSavingsTables,
  resetSavingsTables,
} from '../../routes/__tests__/savings-test-helpers';
import type { Env } from '../../types';
import {
  createCoreTables,
  resetAllTables,
} from '../aihousekeeper/__tests__/test-helpers';
import {
  SavingsImportService,
  type SavingsHistorySelections,
  type SavingsImportDraft,
} from '../savings-import-service';
import { SavingsService } from '../savings-service';

const testEnv = env as unknown as Env;
const HID = 'hh_history_01';
const UID = 'u_history_owner';
const MID = 'm_history_owner';
const OTHER_HID = 'hh_history_other';

function db() {
  return drizzle(testEnv.DB, { schema });
}

async function seed(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createSavingsTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetSavingsTables(testEnv.DB);

  const d = db();
  await d.insert(schema.users).values({
    id: UID,
    email: 'owner@example.com',
    email_verified: true,
    display_name: 'History Owner',
  });
  await d.insert(schema.households).values({ id: HID, name: 'HistoryTest' });
  await d.insert(schema.householdMembers).values({
    id: MID,
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: '2024-01-01T00:00:00Z',
  });
}

let catSeq = 0;
async function seedCategory(name: string): Promise<string> {
  const id = `cat_${++catSeq}`;
  await db().insert(budgetCategories).values({ id, household_id: HID, name });
  return id;
}

let expSeq = 0;
async function seedExpense(
  categoryId: string | null,
  amount: number,
  date: string,
  opts: { title?: string; source?: string; batch?: string; household?: string } = {}
): Promise<void> {
  await db()
    .insert(expenses)
    .values({
      id: `exp_${++expSeq}`,
      household_id: opts.household ?? HID,
      category_id: categoryId,
      title: opts.title ?? 'Expense',
      amount,
      expense_date: date,
      source: opts.source ?? 'manual',
      import_batch_id: opts.batch ?? null,
    });
}

let incSeq = 0;
async function seedIncome(amount: number, date: string): Promise<void> {
  await db()
    .insert(savingsIncomeEntries)
    .values({
      id: `inc_${++incSeq}`,
      household_id: HID,
      source_type: 'payroll',
      label: 'Income',
      amount_cents: amount,
      income_date: date,
    });
}

let recSeq = 0;
async function seedRecurringPayment(amountCents: number): Promise<void> {
  await db()
    .insert(savingsRecurringPayments)
    .values({
      id: `rec_${++recSeq}`,
      household_id: HID,
      label: 'Car loan',
      amount_cents: amountCents,
      day_of_month: 15,
      active: true,
      is_automated: false,
      source: 'manual',
    });
}

async function seedReadyJob(jobId: string): Promise<void> {
  await db().insert(savingsImportJobs).values({
    id: jobId,
    household_id: HID,
    status: 'ready',
    source_kind: 'text',
    draft_json: '{}',
    created_by: UID,
  });
}

beforeEach(async () => {
  await seed();
  catSeq = 0;
  expSeq = 0;
  incSeq = 0;
  recSeq = 0;
  testEnv.ANTHROPIC_API_KEY = 'test-key';
  testEnv.AIHOUSEKEEPER_NUDGE_MODEL = 'claude-haiku-4-5-20251001';
  testEnv.AIHOUSEKEEPER_FALLBACK_MODEL = 'claude-sonnet-4-5-20250929';
});

describe('SavingsService — getAvailableYears', () => {
  it('unions income + expense years, descending', async () => {
    const groceries = await seedCategory('Groceries');
    await seedIncome(100000, '2024-03-01');
    await seedExpense(groceries, 5000, '2025-06-01');
    await seedExpense(groceries, 5000, '2023-01-01');

    const svc = new SavingsService(testEnv, testEnv.DB);
    const years = await svc.getAvailableYears(HID, UID);
    expect(years).toEqual([2025, 2024, 2023]);
  });

  it('returns [] when the household has no data', async () => {
    const svc = new SavingsService(testEnv, testEnv.DB);
    expect(await svc.getAvailableYears(HID, UID)).toEqual([]);
  });
});

describe('SavingsService — getYearHistory', () => {
  it('buckets expenses by category and computes totals/average/net', async () => {
    const groceries = await seedCategory('Groceries');
    const mortgage = await seedCategory('Rent & Mortgage');
    const other = await seedCategory('Other');

    // January 2025
    await seedIncome(500000, '2025-01-01');
    await seedExpense(mortgage, 200000, '2025-01-01');
    await seedExpense(groceries, 40000, '2025-01-01');
    await seedExpense(other, 30000, '2025-01-01');
    // February 2025 (income only)
    await seedIncome(500000, '2025-02-01');

    const svc = new SavingsService(testEnv, testEnv.DB);
    const h = await svc.getYearHistory(HID, UID, 2025);

    expect(h.months).toHaveLength(12);
    const jan = h.months[0];
    expect(jan).toEqual({
      month: 1,
      income: 500000,
      monthlyPayments: 200000,
      food: 40000,
      other: 30000,
      net: 500000 - (200000 + 40000 + 30000),
    });
    const feb = h.months[1];
    expect(feb.income).toBe(500000);
    expect(feb.net).toBe(500000);

    expect(h.monthsWithData).toBe(2);
    expect(h.totals).toEqual({
      income: 1000000,
      monthlyPayments: 200000,
      food: 40000,
      other: 30000,
      net: 1000000 - 270000,
    });
    // Average = totals / monthsWithData (2), rounded.
    expect(h.average.income).toBe(500000);
    expect(h.average.monthlyPayments).toBe(100000);
    expect(h.average.net).toBe(Math.round((1000000 - 270000) / 2));
  });

  it('maps aliased Food/Monthly-payments category names into the right buckets', async () => {
    const food = await seedCategory('Food');
    const payments = await seedCategory('Monthly payments');
    await seedIncome(300000, '2025-05-01');
    await seedExpense(food, 20000, '2025-05-01');
    await seedExpense(payments, 90000, '2025-05-01');
    // Uncategorised expense → "other"
    await seedExpense(null, 5000, '2025-05-01');

    const svc = new SavingsService(testEnv, testEnv.DB);
    const may = (await svc.getYearHistory(HID, UID, 2025)).months[4];
    expect(may.food).toBe(20000);
    expect(may.monthlyPayments).toBe(90000);
    expect(may.other).toBe(5000);
  });

  it('net matches getTrend for a household with no active recurring payments', async () => {
    const groceries = await seedCategory('Groceries');
    await seedIncome(400000, '2025-03-01');
    await seedExpense(groceries, 55000, '2025-03-01');
    await seedExpense(null, 12000, '2025-03-01');

    const svc = new SavingsService(testEnv, testEnv.DB);
    const history = await svc.getYearHistory(HID, UID, 2025);
    const trend = await svc.getTrend(HID, UID, 2025, 12, 12);
    const trendMar = trend.months.find((p) => p.period === '2025-03');
    expect(trendMar?.net).toBe(history.months[2].net);
    expect(history.months[2].net).toBe(400000 - 67000);
  });

  it('folds active recurring payments into monthlyPayments — net still matches getTrend', async () => {
    // Regression: a household that tracks a car loan purely through the
    // recurring-payments feature (never duplicating it as a Budget expense)
    // used to see NO deduction for it here — getYearHistory only picked up
    // expenses aliased into a "Monthly payments"/"Rent & Mortgage" category.
    // Real income minus a real $900/mo loan should be a deficit, and this must
    // read as negative here exactly like it already does on getTrend/getOverview.
    await seedRecurringPayment(90000); // $900/mo car loan, active all year
    const groceries = await seedCategory('Groceries');
    await seedIncome(50000, '2025-06-01'); // $500 income
    await seedExpense(groceries, 20000, '2025-06-01'); // $200 groceries

    const svc = new SavingsService(testEnv, testEnv.DB);
    const history = await svc.getYearHistory(HID, UID, 2025);
    const trend = await svc.getTrend(HID, UID, 2025, 12, 12);
    const trendJun = trend.months.find((p) => p.period === '2025-06');
    const jun = history.months[5];

    expect(jun.monthlyPayments).toBe(90000);
    expect(jun.net).toBe(50000 - (90000 + 20000)); // -60000, a real deficit
    expect(jun.net).toBeLessThan(0);
    expect(trendJun?.net).toBe(jun.net);

    // A month with no income/expenses logged at all still carries the
    // recurring deduction — the payment runs every month, not just ones with
    // other activity.
    const jan = history.months[0];
    expect(jan.monthlyPayments).toBe(90000);
    expect(jan.net).toBe(-90000);
  });

  it('reads food/other/savings goals into the footer', async () => {
    const groceries = await seedCategory('Groceries');
    const other = await seedCategory('Other');
    await seedIncome(100000, '2025-01-01');
    // Category budgets for Jan + Feb 2025.
    await db()
      .insert(budgetGoals)
      .values({
        id: 'bg_1',
        household_id: HID,
        year: 2025,
        month: 1,
        category_budgets: JSON.stringify({ [groceries]: 45000, [other]: 30000 }),
      });
    await db()
      .insert(budgetGoals)
      .values({
        id: 'bg_2',
        household_id: HID,
        year: 2025,
        month: 2,
        category_budgets: JSON.stringify({ [groceries]: 55000, [other]: 20000 }),
      });
    await db().insert(savingsGoals).values({
      id: 'sg_1',
      household_id: HID,
      type: 'custom',
      name: 'Emergency',
      target_amount_cents: 9600000,
      monthly_allocation_cents: 800000,
      status: 'active',
    });

    const svc = new SavingsService(testEnv, testEnv.DB);
    const goals = (await svc.getYearHistory(HID, UID, 2025)).goals;
    expect(goals.foodMonthly).toBe(50000); // avg(45000, 55000)
    expect(goals.otherMonthly).toBe(25000); // avg(30000, 20000)
    expect(goals.savingsMonthly).toBe(800000);
    expect(goals.savingsYearly).toBe(9600000);
  });

  it('returns null goals when nothing is set', async () => {
    await seedIncome(100000, '2025-01-01');
    const svc = new SavingsService(testEnv, testEnv.DB);
    const goals = (await svc.getYearHistory(HID, UID, 2025)).goals;
    expect(goals).toEqual({
      foodMonthly: null,
      otherMonthly: null,
      savingsMonthly: null,
      savingsYearly: null,
      plannedBudgetByMonth: Array(12).fill(null),
    });
  });
});

describe('SavingsService — compareYears', () => {
  it('computes per-year totals, consecutive deltas, and net-by-month', async () => {
    const groceries = await seedCategory('Groceries');
    // 2024: net 300000
    await seedIncome(500000, '2024-01-01');
    await seedExpense(groceries, 200000, '2024-01-01');
    // 2025: net 400000 (+33%)
    await seedIncome(600000, '2025-01-01');
    await seedExpense(groceries, 200000, '2025-01-01');

    const svc = new SavingsService(testEnv, testEnv.DB);
    const cmp = await svc.compareYears(HID, UID, [2025, 2024]);

    expect(cmp.years.map((y) => y.year)).toEqual([2024, 2025]); // sorted asc
    expect(cmp.deltas).toHaveLength(1);
    expect(cmp.deltas[0]).toMatchObject({
      fromYear: 2024,
      toYear: 2025,
      net: 100000,
      netPct: 33, // (400000-300000)/300000 → 33%
    });
    expect(cmp.netByYearMonth).toHaveLength(2);
    expect(cmp.netByYearMonth[0].months).toHaveLength(12);
    expect(cmp.netByYearMonth[0].months[0]).toBe(300000);
    expect(cmp.netByYearMonth[1].months[0]).toBe(400000);
  });

  it('null-guards netPct when the prior year net is 0 and caps at 5 years', async () => {
    // 2024 has no data → net 0; 2025 has net 100000.
    await seedIncome(100000, '2025-01-01');

    const svc = new SavingsService(testEnv, testEnv.DB);
    const cmp = await svc.compareYears(HID, UID, [2020, 2021, 2022, 2023, 2024, 2025]);
    expect(cmp.years).toHaveLength(5); // capped
    const delta2425 = cmp.deltas.find((d) => d.fromYear === 2024 && d.toYear === 2025);
    expect(delta2425?.netPct).toBeNull();
  });
});

describe('SavingsImportService — commitHistory / undo', () => {
  function selections(): SavingsHistorySelections {
    return {
      income: [
        {
          member_name: null,
          source_type: 'payroll',
          label: 'Income',
          amount_cents: 500000,
          income_date: '2025-01-01',
          is_recurring: false,
          day_of_month: null,
        },
        {
          member_name: null,
          source_type: 'payroll',
          label: 'Income',
          amount_cents: 520000,
          income_date: '2025-02-01',
          is_recurring: false,
          day_of_month: null,
        },
      ],
      monthlyGridSpending: [
        { period: '2025-01', category_name: 'Food', amount_cents: 40000 },
        { period: '2025-01', category_name: 'Monthly payments', amount_cents: 200000 },
        { period: '2025-02', category_name: 'Food', amount_cents: 42000 },
      ],
    };
  }

  it('writes income → income_entries and grid → expenses (not savings_spending_entries)', async () => {
    await seedReadyJob('job_hist_1');
    const svc = new SavingsImportService(testEnv, testEnv.DB);
    const result = await svc.commitHistory(HID, UID, 'job_hist_1', selections());

    expect(result).toEqual({ income: 2, spending: 3, years: [2025] });

    const income = await db()
      .select()
      .from(savingsIncomeEntries)
      .where(eq(savingsIncomeEntries.household_id, HID))
      .all();
    expect(income).toHaveLength(2);
    expect(income.every((r) => r.source === 'history_import')).toBe(true);
    expect(income.every((r) => r.import_batch_id === 'job_hist_1')).toBe(true);
    expect(income.find((r) => r.income_date === '2025-01-01')?.period).toBe('2025-01');

    const exp = await db().select().from(expenses).where(eq(expenses.household_id, HID)).all();
    expect(exp).toHaveLength(3);
    expect(exp.every((r) => r.source === 'history_import')).toBe(true);
    expect(exp.every((r) => r.import_batch_id === 'job_hist_1')).toBe(true);
    expect(exp.find((r) => r.title === 'Monthly payments')?.expense_date).toBe('2025-01-01');

    // Nothing was written to the savings spending table.
    const savingsSpend = await db()
      .select()
      .from(savingsSpendingEntries)
      .where(eq(savingsSpendingEntries.household_id, HID))
      .all();
    expect(savingsSpend).toHaveLength(0);

    // Grid categories were resolved/created in budget_categories.
    const cats = await db()
      .select()
      .from(budgetCategories)
      .where(eq(budgetCategories.household_id, HID))
      .all();
    expect(cats.map((c) => c.name).sort()).toEqual(['Food', 'Monthly payments']);
  });

  it('is idempotent — re-committing the same job returns prior counts, no dupes', async () => {
    await seedReadyJob('job_hist_2');
    const svc = new SavingsImportService(testEnv, testEnv.DB);
    await svc.commitHistory(HID, UID, 'job_hist_2', selections());
    const again = await svc.commitHistory(HID, UID, 'job_hist_2', selections());
    expect(again).toEqual({ income: 2, spending: 3, years: [2025] });

    const exp = await db().select().from(expenses).where(eq(expenses.household_id, HID)).all();
    expect(exp).toHaveLength(3);
  });

  it('re-import of the same year (new job) replaces prior history rows', async () => {
    await seedReadyJob('job_hist_a');
    await seedReadyJob('job_hist_b');
    const svc = new SavingsImportService(testEnv, testEnv.DB);
    await svc.commitHistory(HID, UID, 'job_hist_a', selections());
    // Second job, same year, fewer rows.
    await svc.commitHistory(HID, UID, 'job_hist_b', {
      income: [
        {
          member_name: null,
          source_type: 'payroll',
          label: 'Income',
          amount_cents: 999000,
          income_date: '2025-01-01',
          is_recurring: false,
          day_of_month: null,
        },
      ],
      monthlyGridSpending: [{ period: '2025-01', category_name: 'Food', amount_cents: 1000 }],
    });

    const income = await db()
      .select()
      .from(savingsIncomeEntries)
      .where(eq(savingsIncomeEntries.household_id, HID))
      .all();
    // Only job B's single row remains.
    expect(income).toHaveLength(1);
    expect(income[0].amount_cents).toBe(999000);
    expect(income[0].import_batch_id).toBe('job_hist_b');

    const exp = await db().select().from(expenses).where(eq(expenses.household_id, HID)).all();
    expect(exp).toHaveLength(1);
    expect(exp[0].amount).toBe(1000);
  });

  it('undo deletes exactly the batch and leaves manual rows intact', async () => {
    // A manual expense that must survive an undo.
    const groceries = await seedCategory('Groceries');
    await seedExpense(groceries, 12345, '2025-01-15', { source: 'manual' });

    await seedReadyJob('job_hist_undo');
    const svc = new SavingsImportService(testEnv, testEnv.DB);
    await svc.commitHistory(HID, UID, 'job_hist_undo', selections());

    const undone = await svc.undoHistoryImport(HID, UID, 'job_hist_undo');
    expect(undone).toEqual({ income: 2, spending: 3 });

    const exp = await db().select().from(expenses).where(eq(expenses.household_id, HID)).all();
    expect(exp).toHaveLength(1);
    expect(exp[0].source).toBe('manual');
    expect(exp[0].amount).toBe(12345);

    const income = await db()
      .select()
      .from(savingsIncomeEntries)
      .where(eq(savingsIncomeEntries.household_id, HID))
      .all();
    expect(income).toHaveLength(0);
  });

  it('the year-replace never touches another household', async () => {
    // Another household's history_import row in the same year must survive.
    await db().insert(schema.households).values({ id: OTHER_HID, name: 'Other' });
    await seedExpense(null, 7777, '2025-01-01', {
      household: OTHER_HID,
      source: 'history_import',
      batch: 'other_batch',
    });

    await seedReadyJob('job_hist_iso');
    const svc = new SavingsImportService(testEnv, testEnv.DB);
    await svc.commitHistory(HID, UID, 'job_hist_iso', selections());

    const otherRows = await db()
      .select()
      .from(expenses)
      .where(eq(expenses.household_id, OTHER_HID))
      .all();
    expect(otherRows).toHaveLength(1);
    expect(otherRows[0].amount).toBe(7777);
  });

  it('rejects access from a non-member (ForbiddenError)', async () => {
    await seedReadyJob('job_hist_forbidden');
    const svc = new SavingsImportService(testEnv, testEnv.DB);
    await expect(
      svc.commitHistory(HID, 'u_not_a_member', 'job_hist_forbidden', selections())
    ).rejects.toThrow();
  });
});

describe('SavingsImportService — analyze (history grid normalization)', () => {
  it('keeps only well-formed grid cells (valid period + positive amount + name)', async () => {
    // A stub provider returning a grid draft with 3 junk rows the analyze step
    // must drop before the user reviews.
    const raw: SavingsImportDraft = {
      income: [],
      spending: [],
      recurringPayments: [],
      monthlyGridSpending: [
        { period: '2025-01', category_name: 'Food', amount_cents: 40000 }, // keep
        { period: 'bad', category_name: 'Food', amount_cents: 1000 }, // drop: period
        { period: '2025-02', category_name: 'Food', amount_cents: 0 }, // drop: amount
        { period: '2025-03', category_name: '   ', amount_cents: 5000 }, // drop: name
      ],
    };
    const provider = { generateStructured: vi.fn(async () => raw) } as unknown as AIProvider;

    await db().insert(savingsImportJobs).values({
      id: 'job_analyze_hist',
      household_id: HID,
      status: 'uploaded',
      source_kind: 'text',
      raw_text: 'January 2025 | Food: 400',
      created_by: UID,
    });

    const svc = new SavingsImportService(testEnv, testEnv.DB, provider);
    const draft = await svc.analyze(HID, UID, 'job_analyze_hist', 'history');

    expect(draft.monthlyGridSpending).toHaveLength(1);
    expect(draft.monthlyGridSpending?.[0]).toEqual({
      period: '2025-01',
      category_name: 'Food',
      amount_cents: 40000,
    });
  });
});
