import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../../db/schema';
import { budgetCategories } from '../../../db/schema-budget';
import { createBudgetTables, resetBudgetTables } from '../../../routes/__tests__/budget-test-helpers';
import type { Env } from '../../../types';
import { createCoreTables, resetAllTables } from '../../aihousekeeper/__tests__/test-helpers';
import { BudgetService } from '../../budget-service';
import { RecurringSpendAnalysis } from '../spend/recurring-spend-analysis';

const testEnv = env as unknown as Env;
const HID = 'hh_recurring_an';
const UID = 'u_recurring_an';
const MID = 'm_recurring_an';
const CAT = 'cat_recurring_an';

beforeEach(async () => {
  await createCoreTables(testEnv.DB);
  await createBudgetTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetBudgetTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values([{ id: UID, email: 'rec@example.com', email_verified: true }]);
  await db.insert(schema.households).values([{ id: HID, name: 'Recurring House' }]);
  await db.insert(schema.householdMembers).values([
    { id: MID, household_id: HID, user_id: UID, role: 'owner', joined_at: '2025-01-01T00:00:00Z' },
  ]);
  await db.insert(budgetCategories).values([{ id: CAT, household_id: HID, name: 'Utilities' }]);
});

describe('RecurringSpendAnalysis', () => {
  it('detects titles that appear across multiple months', async () => {
    const budget = new BudgetService(testEnv, testEnv.DB);
    // Anchor on a fixed month so the window is deterministic.
    await budget.addExpense(HID, UID, {
      title: 'Netflix',
      amount: 1600,
      expenseDate: '2026-05-05',
      categoryId: CAT,
      vendor: 'Netflix',
    });
    await budget.addExpense(HID, UID, {
      title: 'Netflix',
      amount: 1600,
      expenseDate: '2026-06-05',
      categoryId: CAT,
      vendor: 'Netflix',
    });
    await budget.addExpense(HID, UID, {
      title: 'Netflix',
      amount: 1600,
      expenseDate: '2026-07-05',
      categoryId: CAT,
      vendor: 'Netflix',
    });
    // One-off should not qualify with minMonths=3.
    await budget.addExpense(HID, UID, {
      title: 'One-off gadget',
      amount: 9000,
      expenseDate: '2026-07-10',
      categoryId: CAT,
    });

    const analysis = new RecurringSpendAnalysis(testEnv, testEnv.DB);
    const result = await analysis.analyze(HID, UID, {
      month: '2026-07',
      months: 6,
      minMonths: 3,
      nowIso: '2026-07-22T12:00:00Z',
    });

    expect(result.detected.some((d) => /netflix/i.test(d.label))).toBe(true);
    expect(result.detected.every((d) => !/gadget/i.test(d.label))).toBe(true);
    expect(result.detectedMonthlyCents).toBeGreaterThanOrEqual(1600);
    expect(result.summary).toContain('Regular monthly spending');
  });

  it('keys on the vendor when present and reports matchOn=vendor', async () => {
    const budget = new BudgetService(testEnv, testEnv.DB);
    // Same vendor across three months, but differing titles — vendor must win.
    for (const [date, title] of [
      ['2026-05-08', 'Hydro bill'],
      ['2026-06-08', 'Electricity'],
      ['2026-07-08', 'Power'],
    ] as const) {
      await budget.addExpense(HID, UID, {
        title,
        amount: 8000,
        expenseDate: date,
        categoryId: CAT,
        vendor: 'Hydro One',
      });
    }

    const analysis = new RecurringSpendAnalysis(testEnv, testEnv.DB);
    const result = await analysis.analyze(HID, UID, {
      month: '2026-07',
      months: 6,
      minMonths: 3,
      nowIso: '2026-07-22T12:00:00Z',
    });

    const hydro = result.detected.find((d) => /hydro one/i.test(d.label));
    expect(hydro).toBeTruthy();
    expect(hydro?.matchOn).toBe('vendor');
    expect(hydro?.monthsSeen).toBe(3);
    expect(hydro?.avgMonthlyCents).toBe(8000);
  });

  it('reports no detected patterns when nothing recurs across enough months', async () => {
    const budget = new BudgetService(testEnv, testEnv.DB);
    // Three distinct one-offs — none reaches minMonths=3 on its own.
    await budget.addExpense(HID, UID, { title: 'Concert', amount: 5000, expenseDate: '2026-05-01', categoryId: CAT });
    await budget.addExpense(HID, UID, { title: 'Flight', amount: 30000, expenseDate: '2026-06-01', categoryId: CAT });
    await budget.addExpense(HID, UID, { title: 'Gift', amount: 4000, expenseDate: '2026-07-01', categoryId: CAT });

    const analysis = new RecurringSpendAnalysis(testEnv, testEnv.DB);
    const result = await analysis.analyze(HID, UID, {
      month: '2026-07',
      months: 6,
      minMonths: 3,
      nowIso: '2026-07-22T12:00:00Z',
    });

    expect(result.detected).toHaveLength(0);
    expect(result.detectedMonthlyCents).toBe(0);
    expect(result.summary).toContain('none with ≥3 months');
  });
});
