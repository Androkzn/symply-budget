/**
 * Budget category product-trend analytics + the standalone window-spend sum.
 * These are the two D1-backed budget calculations that had no direct coverage:
 *   - getCategoryProductTrends: per-product trend classification (new/up/down/
 *     flat), average rounding, window-size clamp, uncategorized bucket.
 *   - totalSpendBetween: inclusive-start / exclusive-end window sum, household
 *     scoping, empty → 0.
 */
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../db/schema';
import { budgetCategories, expenses } from '../../db/schema-budget';
import { createBudgetTables, resetBudgetTables } from '../../routes/__tests__/budget-test-helpers';
import type { Env } from '../../types';
import { createCoreTables, resetAllTables } from '../aihousekeeper/__tests__/test-helpers';
import { BudgetService, EXPENSE_INSERT_COLUMNS, totalSpendBetween } from '../budget-service';

const testEnv = env as unknown as Env;

const HID = 'hh_trends';
const UID = 'u_trends_owner';
const MID = 'm_trends_owner';
const OTHER_HID = 'hh_trends_other';
const CAT = 'cat_groceries';

interface ExpenseSeed {
  id: string;
  title: string;
  amount: number;
  date: string;
  categoryId?: string | null;
  householdId?: string;
}

async function seed(rows: ExpenseSeed[]): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createBudgetTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetBudgetTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values([{ id: UID, email: 'trends@example.com', email_verified: true }]);
  await db.insert(schema.households).values([
    { id: HID, name: 'Trends' },
    { id: OTHER_HID, name: 'Other' },
  ]);
  await db.insert(schema.householdMembers).values([
    { id: MID, household_id: HID, user_id: UID, role: 'owner', joined_at: '2025-01-01T00:00:00Z' },
  ]);
  await db.insert(budgetCategories).values([{ id: CAT, household_id: HID, name: 'Groceries' }]);

  if (rows.length) {
    const mapped = rows.map((r) => ({
      id: r.id,
      household_id: r.householdId ?? HID,
      category_id: r.categoryId === undefined ? CAT : r.categoryId,
      title: r.title,
      amount: r.amount,
      expense_date: r.date,
      source: 'manual',
    }));
    const chunk = Math.floor(100 / EXPENSE_INSERT_COLUMNS);
    for (let i = 0; i < mapped.length; i += chunk) {
      await db.insert(expenses).values(mapped.slice(i, i + chunk));
    }
  }
}

function svc(): BudgetService {
  return new BudgetService(testEnv, testEnv.DB);
}

// Trend + window fixture: 3-month window ending 2026-07.
const TREND_ROWS: ExpenseSeed[] = [
  // Bread: Jun 1000 → Jul 2000  ⇒ up (2000 > 1000*1.1)
  { id: 'e_bread_jun', title: 'Bread', amount: 1000, date: '2026-06-10' },
  { id: 'e_bread_jul', title: 'Bread', amount: 2000, date: '2026-07-10' },
  // Eggs: Jun 2000 → Jul 1000  ⇒ down (1000 < 2000*0.9)
  { id: 'e_eggs_jun', title: 'Eggs', amount: 2000, date: '2026-06-11' },
  { id: 'e_eggs_jul', title: 'Eggs', amount: 1000, date: '2026-07-11' },
  // Butter: Jun 1000 → Jul 1050 ⇒ flat (within ±10%)
  { id: 'e_butter_jun', title: 'Butter', amount: 1000, date: '2026-06-12' },
  { id: 'e_butter_jul', title: 'Butter', amount: 1050, date: '2026-07-12' },
  // Cheese: Jul only ⇒ new (prev 0, current > 0)
  { id: 'e_cheese_jul', title: 'Cheese', amount: 500, date: '2026-07-13' },
  // Uncategorized July spend (excluded from the CAT trend, counted by totalSpendBetween)
  { id: 'e_random_jul', title: 'Random', amount: 700, date: '2026-07-14', categoryId: null },
  { id: 'e_boundary_start', title: 'BoundaryStart', amount: 100, date: '2026-07-01', categoryId: null },
  // Exclusive-end sentinel: first day of the NEXT month must be excluded
  { id: 'e_boundary_end', title: 'BoundaryEnd', amount: 3000, date: '2026-08-01', categoryId: null },
  // Different household — must never leak into HID sums
  { id: 'e_other', title: 'Other', amount: 9999, date: '2026-07-10', categoryId: null, householdId: OTHER_HID },
];

describe('getCategoryProductTrends', () => {
  beforeEach(() => seed(TREND_ROWS));

  it('classifies each product trend and rounds the window average', async () => {
    const t = await svc().getCategoryProductTrends(HID, UID, CAT, 2026, 7, 3);

    expect(t.months).toEqual(['2026-05', '2026-06', '2026-07']);
    expect(t.categoryName).toBe('Groceries');
    // monthlyTotals for the CAT category only (uncategorized excluded)
    expect(t.monthlyTotals).toEqual([0, 4000, 4550]);
    expect(t.currentMonthTotal).toBe(4550);
    expect(t.previousMonthTotal).toBe(4000);

    const byName = Object.fromEntries(t.products.map((p) => [p.name, p]));
    expect(byName.Bread.trend).toBe('up');
    expect(byName.Eggs.trend).toBe('down');
    expect(byName.Butter.trend).toBe('flat');
    expect(byName.Cheese.trend).toBe('new');

    // averageAmount = round(total / windowSize); Bread total 3000 over 3 months → 1000
    expect(byName.Bread.averageAmount).toBe(1000);
    expect(byName.Bread.currentAmount).toBe(2000);
    expect(byName.Bread.previousAmount).toBe(1000);
    // Cheese averages 500/3 → 167 (rounded)
    expect(byName.Cheese.averageAmount).toBe(Math.round(500 / 3));
  });

  it('clamps the window size to [1, 24]', async () => {
    const big = await svc().getCategoryProductTrends(HID, UID, CAT, 2026, 7, 100);
    expect(big.months).toHaveLength(24);
    expect(big.months[big.months.length - 1]).toBe('2026-07');

    const zero = await svc().getCategoryProductTrends(HID, UID, CAT, 2026, 7, 0);
    expect(zero.months).toEqual(['2026-07']);
    // With a single-month window there is no previous month.
    expect(zero.previousMonthTotal).toBe(0);
  });

  it('supports the uncategorized bucket (category_id IS NULL)', async () => {
    const t = await svc().getCategoryProductTrends(HID, UID, 'uncategorized', 2026, 7, 3);
    expect(t.categoryName).toBeNull();
    const names = t.products.map((p) => p.name).sort();
    expect(names).toContain('Random');
    expect(names).toContain('BoundaryStart');
    // July uncategorized = Random(700) + BoundaryStart(100)
    expect(t.currentMonthTotal).toBe(800);
  });

  it('denies access to a non-member', async () => {
    await expect(
      svc().getCategoryProductTrends(OTHER_HID, UID, CAT, 2026, 7, 3)
    ).rejects.toThrow();
  });
});

describe('totalSpendBetween', () => {
  beforeEach(() => seed(TREND_ROWS));

  it('sums an inclusive-start / exclusive-end window for the household', async () => {
    // July HID spend = CAT July (4550) + Random (700) + BoundaryStart (100) = 5350.
    // The 2026-08-01 sentinel is excluded by the exclusive upper bound.
    const july = await totalSpendBetween(testEnv.DB, HID, '2026-07-01', '2026-08-01');
    expect(july).toBe(5350);
  });

  it('excludes other households', async () => {
    const otherJuly = await totalSpendBetween(testEnv.DB, OTHER_HID, '2026-07-01', '2026-08-01');
    expect(otherJuly).toBe(9999); // only the OTHER_HID row
  });

  it('returns 0 for a window with no expenses', async () => {
    expect(await totalSpendBetween(testEnv.DB, HID, '2020-01-01', '2020-02-01')).toBe(0);
  });

  it('respects the month split (June window excludes July)', async () => {
    const june = await totalSpendBetween(testEnv.DB, HID, '2026-06-01', '2026-07-01');
    expect(june).toBe(4000); // Bread + Eggs + Butter June
  });
});
