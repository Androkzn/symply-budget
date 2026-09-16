/**
 * Per-category sub-budgets: resolver precedence + percent auto-scaling, legacy
 * JSON fallback, progress (spend grouping / over flag / over-allocation), and the
 * getMonthlyOverview wiring. All D1-backed through the shared budget test tables.
 */
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../db/schema';
import { budgetCategories, budgetGoals, expenses } from '../../db/schema-budget';
import { createBudgetTables, resetBudgetTables } from '../../routes/__tests__/budget-test-helpers';
import type { Env } from '../../types';
import { ForbiddenError } from '../../utils/errors';
import { createCoreTables, resetAllTables } from '../aihousekeeper/__tests__/test-helpers';
import { BudgetService } from '../budget-service';

const testEnv = env as unknown as Env;

const HID = 'hh_sub';
const UID = 'u_sub_owner';
const MID = 'm_sub_owner';
const STRANGER = 'u_sub_stranger';
const CAT_FOOD = 'cat_food';
const CAT_ALCOHOL = 'cat_alcohol';
const CAT_COFFEE = 'cat_coffee';
const YEAR = 2026;
const MONTH = 7;

async function seed(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createBudgetTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetBudgetTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values([
    { id: UID, email: 'sub@example.com', email_verified: true },
    { id: STRANGER, email: 'stranger@example.com', email_verified: true },
  ]);
  await db.insert(schema.households).values([{ id: HID, name: 'Sub' }]);
  await db.insert(schema.householdMembers).values([
    { id: MID, household_id: HID, user_id: UID, role: 'owner', joined_at: '2025-01-01T00:00:00Z' },
  ]);
  await db.insert(budgetCategories).values([
    { id: CAT_FOOD, household_id: HID, name: 'Groceries' },
    { id: CAT_ALCOHOL, household_id: HID, name: 'Alcohol & Bars' },
    { id: CAT_COFFEE, household_id: HID, name: 'Coffee & Snacks' },
  ]);
}

function svc(): BudgetService {
  return new BudgetService(testEnv, testEnv.DB);
}

beforeEach(seed);

describe('sub-budget resolver', () => {
  it('resolves a fixed-amount default cap for the year', async () => {
    const s = svc();
    await s.upsertSubBudget(HID, UID, {
      categoryId: CAT_ALCOHOL,
      year: YEAR,
      month: null,
      limitType: 'amount',
      amountCents: 10000,
    });

    const resolved = await s.resolveSubBudgets(HID, UID, YEAR, MONTH, 100000);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      category_id: CAT_ALCOHOL,
      limit_type: 'amount',
      cap_cents: 10000,
      scope: 'default',
    });
  });

  it('resolves a percent cap live against the passed planned budget', async () => {
    const s = svc();
    await s.upsertSubBudget(HID, UID, {
      categoryId: CAT_ALCOHOL,
      year: YEAR,
      month: null,
      limitType: 'percent',
      percentBps: 1000, // 10%
    });

    // 10% of $1,000 = $100, then 10% of $1,200 = $120 — no re-save needed.
    expect((await s.resolveSubBudgets(HID, UID, YEAR, MONTH, 100000))[0].cap_cents).toBe(10000);
    expect((await s.resolveSubBudgets(HID, UID, YEAR, MONTH, 120000))[0].cap_cents).toBe(12000);
  });

  it('lets a month override beat the yearly default for that month only', async () => {
    const s = svc();
    await s.upsertSubBudget(HID, UID, {
      categoryId: CAT_COFFEE,
      year: YEAR,
      month: null,
      limitType: 'amount',
      amountCents: 5000,
    });
    await s.upsertSubBudget(HID, UID, {
      categoryId: CAT_COFFEE,
      year: YEAR,
      month: MONTH,
      limitType: 'amount',
      amountCents: 8000,
    });

    const july = await s.resolveSubBudgets(HID, UID, YEAR, MONTH, 100000);
    expect(july).toHaveLength(1);
    expect(july[0]).toMatchObject({ cap_cents: 8000, scope: 'month' });

    const august = await s.resolveSubBudgets(HID, UID, YEAR, 8, 100000);
    expect(august[0]).toMatchObject({ cap_cents: 5000, scope: 'default' });
  });

  it('falls back to legacy category_budgets JSON for categories without a row', async () => {
    const s = svc();
    const db = drizzle(testEnv.DB, { schema });
    await db.insert(budgetGoals).values([
      {
        id: 'g_legacy',
        household_id: HID,
        year: YEAR,
        month: MONTH,
        planned_budget: 100000,
        category_budgets: JSON.stringify({ [CAT_FOOD]: 40000 }),
      },
    ]);

    const resolved = await s.resolveSubBudgets(HID, UID, YEAR, MONTH, 100000);
    const food = resolved.find((r) => r.category_id === CAT_FOOD);
    expect(food).toMatchObject({ cap_cents: 40000, scope: 'legacy', limit_type: 'amount' });
  });

  it('prefers a stored row over the legacy JSON for the same category', async () => {
    const s = svc();
    const db = drizzle(testEnv.DB, { schema });
    await db.insert(budgetGoals).values([
      {
        id: 'g_legacy2',
        household_id: HID,
        year: YEAR,
        month: MONTH,
        planned_budget: 100000,
        category_budgets: JSON.stringify({ [CAT_FOOD]: 40000 }),
      },
    ]);
    await s.upsertSubBudget(HID, UID, {
      categoryId: CAT_FOOD,
      year: YEAR,
      month: null,
      limitType: 'amount',
      amountCents: 55000,
    });

    const resolved = await s.resolveSubBudgets(HID, UID, YEAR, MONTH, 100000);
    const food = resolved.filter((r) => r.category_id === CAT_FOOD);
    expect(food).toHaveLength(1);
    expect(food[0]).toMatchObject({ cap_cents: 55000, scope: 'default' });
  });
});

describe('upsert / delete', () => {
  it('updates in place on re-upsert of the same scope (no duplicate row)', async () => {
    const s = svc();
    await s.upsertSubBudget(HID, UID, {
      categoryId: CAT_ALCOHOL, year: YEAR, month: null, limitType: 'amount', amountCents: 10000,
    });
    await s.upsertSubBudget(HID, UID, {
      categoryId: CAT_ALCOHOL, year: YEAR, month: null, limitType: 'percent', percentBps: 500,
    });

    const rows = await s.getSubBudgetRows(HID, UID, YEAR);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ limit_type: 'percent', percent_bps: 500, amount_cents: null });
  });

  it('rejects an out-of-range percent', async () => {
    const s = svc();
    await expect(
      s.upsertSubBudget(HID, UID, {
        categoryId: CAT_ALCOHOL, year: YEAR, month: null, limitType: 'percent', percentBps: 20000,
      })
    ).rejects.toThrow();
  });

  it('deletes only the targeted scope', async () => {
    const s = svc();
    await s.upsertSubBudget(HID, UID, {
      categoryId: CAT_COFFEE, year: YEAR, month: null, limitType: 'amount', amountCents: 5000,
    });
    await s.upsertSubBudget(HID, UID, {
      categoryId: CAT_COFFEE, year: YEAR, month: MONTH, limitType: 'amount', amountCents: 8000,
    });

    await s.deleteSubBudget(HID, UID, { categoryId: CAT_COFFEE, year: YEAR, month: MONTH });

    const rows = await s.getSubBudgetRows(HID, UID, YEAR);
    expect(rows).toHaveLength(1);
    expect(rows[0].month).toBeNull();
  });

  it('blocks a non-member from writing', async () => {
    const s = svc();
    await expect(
      s.upsertSubBudget(HID, STRANGER, {
        categoryId: CAT_ALCOHOL, year: YEAR, month: null, limitType: 'amount', amountCents: 100,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('progress + over-allocation', () => {
  beforeEach(async () => {
    const db = drizzle(testEnv.DB, { schema });
    // July expenses: Alcohol $120 (over its $100 cap), Coffee $30 (under $50).
    await db.insert(expenses).values([
      { id: 'e_a1', household_id: HID, category_id: CAT_ALCOHOL, title: 'Wine', amount: 12000, expense_date: '2026-07-05', source: 'manual' },
      { id: 'e_c1', household_id: HID, category_id: CAT_COFFEE, title: 'Latte', amount: 3000, expense_date: '2026-07-06', source: 'manual' },
    ]);
  });

  it('reports spend, over flag and remaining per cap', async () => {
    const s = svc();
    await s.upsertSubBudget(HID, UID, { categoryId: CAT_ALCOHOL, year: YEAR, month: null, limitType: 'amount', amountCents: 10000 });
    await s.upsertSubBudget(HID, UID, { categoryId: CAT_COFFEE, year: YEAR, month: null, limitType: 'amount', amountCents: 5000 });

    const summary = await s.getSubBudgetProgress(HID, UID, YEAR, MONTH, {
      plannedBudget: 100000,
      monthExpenses: [],
    });
    // With no precomputed expenses we passed [], so fetch the real ones instead.
    const real = await s.getSubBudgetProgress(HID, UID, YEAR, MONTH);
    const alcohol = real.entries.find((e) => e.category_id === CAT_ALCOHOL)!;
    const coffee = real.entries.find((e) => e.category_id === CAT_COFFEE)!;

    expect(alcohol).toMatchObject({ spent_cents: 12000, cap_cents: 10000, over: true, remaining_cents: -2000 });
    expect(coffee).toMatchObject({ spent_cents: 3000, cap_cents: 5000, over: false, remaining_cents: 2000 });
    // Over-cap entries sort first.
    expect(real.entries[0].category_id).toBe(CAT_ALCOHOL);
    expect(summary.entries.length).toBe(2);
  });

  it('computes over-allocation against the total', async () => {
    const s = svc();
    // Caps sum to $700 against a $1,000 planned budget → within (0 over).
    await s.setMonthlyGoal(HID, UID, YEAR, MONTH, { plannedBudget: 100000 });
    await s.upsertSubBudget(HID, UID, { categoryId: CAT_FOOD, year: YEAR, month: null, limitType: 'amount', amountCents: 40000 });
    await s.upsertSubBudget(HID, UID, { categoryId: CAT_ALCOHOL, year: YEAR, month: null, limitType: 'amount', amountCents: 30000 });
    let progress = await s.getSubBudgetProgress(HID, UID, YEAR, MONTH);
    expect(progress.overAllocatedBy).toBe(0);

    // Push total caps to $1,300 → $300 over.
    await s.upsertSubBudget(HID, UID, { categoryId: CAT_COFFEE, year: YEAR, month: null, limitType: 'amount', amountCents: 60000 });
    progress = await s.getSubBudgetProgress(HID, UID, YEAR, MONTH);
    expect(progress.totalCapCents).toBe(130000);
    expect(progress.overAllocatedBy).toBe(30000);
  });

  it('embeds subBudgets in the monthly overview', async () => {
    const s = svc();
    await s.setMonthlyGoal(HID, UID, YEAR, MONTH, { plannedBudget: 100000 });
    await s.upsertSubBudget(HID, UID, { categoryId: CAT_ALCOHOL, year: YEAR, month: null, limitType: 'percent', percentBps: 1000 });

    const overview = await s.getMonthlyOverview(HID, UID, YEAR, MONTH);
    expect(overview.subBudgets.entries).toHaveLength(1);
    // 10% of $1,000 = $100 cap; $120 spent → over.
    expect(overview.subBudgets.entries[0]).toMatchObject({ cap_cents: 10000, spent_cents: 12000, over: true });
  });
});

/**
 * Response-quality edge cases — the correctness guarantees a user relies on when
 * reading a sub-budget: month-scoped spend, exact percent rounding, boundary of
 * the "over" flag, uncategorized noise, and the exact regression behind the
 * "every month shows the same data" bug (a missing table used to 500 the whole
 * monthly overview; it must degrade to an empty, well-formed payload instead).
 */
describe('response-quality edge cases', () => {
  it('REGRESSION: monthly overview returns an empty, well-formed subBudgets block when no caps exist (never throws)', async () => {
    const s = svc();
    await s.setMonthlyGoal(HID, UID, YEAR, MONTH, { plannedBudget: 100000 });

    // This is the exact call that 500'd in production when budget_sub_budgets was
    // unmigrated. With the table present and no caps, it must resolve cleanly.
    const overview = await s.getMonthlyOverview(HID, UID, YEAR, MONTH);
    expect(overview.subBudgets).toMatchObject({
      entries: [],
      totalCapCents: 0,
      overAllocatedBy: 0,
    });
    expect(overview.subBudgets.plannedBudget).toBe(100000);
  });

  it('counts only THIS month\'s spend against a cap (a prior month\'s expense never leaks in)', async () => {
    const s = svc();
    const db = drizzle(testEnv.DB, { schema });
    await s.upsertSubBudget(HID, UID, { categoryId: CAT_ALCOHOL, year: YEAR, month: null, limitType: 'amount', amountCents: 10000 });
    await db.insert(expenses).values([
      { id: 'e_jun', household_id: HID, category_id: CAT_ALCOHOL, title: 'June wine', amount: 9000, expense_date: '2026-06-20', source: 'manual' },
      { id: 'e_jul', household_id: HID, category_id: CAT_ALCOHOL, title: 'July wine', amount: 3000, expense_date: '2026-07-04', source: 'manual' },
    ]);

    const july = await s.getSubBudgetProgress(HID, UID, YEAR, MONTH);
    // Only the July $30 counts — the June $90 belongs to a different month.
    expect(july.entries[0]).toMatchObject({ spent_cents: 3000, remaining_cents: 7000, over: false });
  });

  it('treats spend exactly equal to the cap as NOT over (strict boundary)', async () => {
    const s = svc();
    const db = drizzle(testEnv.DB, { schema });
    await s.upsertSubBudget(HID, UID, { categoryId: CAT_COFFEE, year: YEAR, month: null, limitType: 'amount', amountCents: 5000 });
    await db.insert(expenses).values([
      { id: 'e_eq', household_id: HID, category_id: CAT_COFFEE, title: 'Exact', amount: 5000, expense_date: '2026-07-08', source: 'manual' },
    ]);

    const progress = await s.getSubBudgetProgress(HID, UID, YEAR, MONTH);
    expect(progress.entries[0]).toMatchObject({ spent_cents: 5000, remaining_cents: 0, over: false });
  });

  it('rounds a percent cap to the nearest cent against the live month total', async () => {
    const s = svc();
    // 33.33% (3333 bps) of $99.99 → 3332.6667c → rounds to 3333c.
    await s.upsertSubBudget(HID, UID, { categoryId: CAT_FOOD, year: YEAR, month: null, limitType: 'percent', percentBps: 3333 });
    expect((await s.resolveSubBudgets(HID, UID, YEAR, MONTH, 9999))[0].cap_cents).toBe(3333);
    // 12.5% (1250 bps) of $80.00 = exactly $10.00.
    await s.upsertSubBudget(HID, UID, { categoryId: CAT_FOOD, year: YEAR, month: null, limitType: 'percent', percentBps: 1250 });
    expect((await s.resolveSubBudgets(HID, UID, YEAR, MONTH, 8000))[0].cap_cents).toBe(1000);
  });

  it('resolves a percent cap to $0 when the month has no planned budget', async () => {
    const s = svc();
    await s.upsertSubBudget(HID, UID, { categoryId: CAT_FOOD, year: YEAR, month: null, limitType: 'percent', percentBps: 2500 });
    const resolved = await s.resolveSubBudgets(HID, UID, YEAR, MONTH, 0);
    expect(resolved[0].cap_cents).toBe(0);
  });

  it('ignores uncategorized expenses (category_id null) — they attach to no cap and never crash progress', async () => {
    const s = svc();
    const db = drizzle(testEnv.DB, { schema });
    await s.upsertSubBudget(HID, UID, { categoryId: CAT_COFFEE, year: YEAR, month: null, limitType: 'amount', amountCents: 5000 });
    await db.insert(expenses).values([
      { id: 'e_uncat', household_id: HID, category_id: null, title: 'Misc', amount: 4000, expense_date: '2026-07-09', source: 'manual' },
      { id: 'e_cat', household_id: HID, category_id: CAT_COFFEE, title: 'Latte', amount: 1000, expense_date: '2026-07-09', source: 'manual' },
    ]);

    const progress = await s.getSubBudgetProgress(HID, UID, YEAR, MONTH);
    expect(progress.entries).toHaveLength(1);
    expect(progress.entries[0]).toMatchObject({ category_id: CAT_COFFEE, spent_cents: 1000 });
  });

  it('sums mixed percent + amount caps for over-allocation against the total', async () => {
    const s = svc();
    await s.setMonthlyGoal(HID, UID, YEAR, MONTH, { plannedBudget: 100000 });
    // $400 fixed + 70% ($700) = $1,100 of caps against a $1,000 total → $100 over.
    await s.upsertSubBudget(HID, UID, { categoryId: CAT_FOOD, year: YEAR, month: null, limitType: 'amount', amountCents: 40000 });
    await s.upsertSubBudget(HID, UID, { categoryId: CAT_ALCOHOL, year: YEAR, month: null, limitType: 'percent', percentBps: 7000 });

    const progress = await s.getSubBudgetProgress(HID, UID, YEAR, MONTH);
    expect(progress.totalCapCents).toBe(110000);
    expect(progress.overAllocatedBy).toBe(10000);
  });

  it('falls back to the yearly default after a month override is deleted', async () => {
    const s = svc();
    await s.upsertSubBudget(HID, UID, { categoryId: CAT_COFFEE, year: YEAR, month: null, limitType: 'amount', amountCents: 5000 });
    await s.upsertSubBudget(HID, UID, { categoryId: CAT_COFFEE, year: YEAR, month: MONTH, limitType: 'amount', amountCents: 9000 });

    expect((await s.resolveSubBudgets(HID, UID, YEAR, MONTH, 100000))[0]).toMatchObject({ cap_cents: 9000, scope: 'month' });
    await s.deleteSubBudget(HID, UID, { categoryId: CAT_COFFEE, year: YEAR, month: MONTH });
    expect((await s.resolveSubBudgets(HID, UID, YEAR, MONTH, 100000))[0]).toMatchObject({ cap_cents: 5000, scope: 'default' });
  });

  it('does not leak another month\'s legacy JSON caps into this month', async () => {
    const s = svc();
    const db = drizzle(testEnv.DB, { schema });
    // Legacy caps live on an AUGUST goal — they must not surface for July.
    await db.insert(budgetGoals).values([
      { id: 'g_aug', household_id: HID, year: YEAR, month: 8, planned_budget: 100000, category_budgets: JSON.stringify({ [CAT_FOOD]: 40000 }) },
    ]);
    const july = await s.resolveSubBudgets(HID, UID, YEAR, MONTH, 100000);
    expect(july.find((r) => r.category_id === CAT_FOOD)).toBeUndefined();

    const august = await s.resolveSubBudgets(HID, UID, YEAR, 8, 100000);
    expect(august.find((r) => r.category_id === CAT_FOOD)).toMatchObject({ scope: 'legacy', cap_cents: 40000 });
  });
});
