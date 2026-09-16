import type { LocalBudgetLedger } from '../../engine';
import { buildBudgetWorkbookSheets } from '../budgetWorkbook';

/** Minimal ledger — every table the workbook touches, mostly empty. */
function ledger(overrides: Partial<LocalBudgetLedger> = {}): LocalBudgetLedger {
  return {
    version: 1,
    household: { id: 'hh_1', name: 'Sweet Home' },
    memberId: 'm1',
    deviceId: 'd1',
    categories: [],
    expenses: [],
    items: [],
    goals: [],
    subBudgets: [],
    transfers: [],
    mortgages: [],
    mortgageTerms: [],
    mortgageStatements: [],
    mortgageEvents: [],
    mortgageOffers: [],
    savingsIncome: [],
    savingsSpending: [],
    savingsRecurringPayments: [],
    savingsGoals: [],
    savingsCategories: [],
    savingsIncomeTemplates: [],
    savingsMonthlyTargets: [],
    budgetLoans: [],
    budgetRenewals: [],
    registeredAccounts: [],
    registeredTransactions: [],
    wishes: [],
    wishEntries: [],
    wishAttachments: [],
    ops: [],
    ...overrides,
  } as unknown as LocalBudgetLedger;
}

const EXPORTED_AT = '2026-08-16T12:00:00.000Z';

function sheetsFor(l: LocalBudgetLedger) {
  return buildBudgetWorkbookSheets(l, { exportedAt: EXPORTED_AT });
}

describe('buildBudgetWorkbookSheets', () => {
  it('always emits the same 14 tabs, even when sections are empty', () => {
    const names = sheetsFor(ledger()).map((s) => s.name);
    expect(names).toEqual([
      'Summary',
      'Spending',
      'Categories',
      'Planning',
      'Monthly Budgets',
      'Sub-budgets',
      'Income',
      'Recurring Payments',
      'Savings Goals',
      'Loans',
      'Mortgages',
      'Registered Accounts',
      'Wishes',
      'Transfers',
    ]);
  });

  it('never puts a non-numeric value in a number or money column', () => {
    // Regression: the household name once sat in a `number` column, so Number()
    // returned NaN, the writer dropped the cell, and the row rendered blank.
    for (const sheet of sheetsFor(ledger())) {
      sheet.columns.forEach((col, i) => {
        if (col.type !== 'number' && col.type !== 'money') return;
        for (const row of sheet.rows) {
          const v = row[i];
          if (v === null || v === undefined || v === '') continue;
          expect(Number.isFinite(Number(v))).toBe(true);
        }
      });
    }
  });

  it('keeps every row the same width as its column list', () => {
    for (const sheet of sheetsFor(ledger())) {
      for (const row of sheet.rows) {
        expect(row.length).toBe(sheet.columns.length);
      }
    }
  });

  it('surfaces household name and id as readable text on the Summary tab', () => {
    const summary = sheetsFor(ledger())[0]!;
    const detailCol = summary.columns.findIndex((c) => c.header === 'Detail');
    const details = summary.rows.map((r) => r[detailCol]);
    expect(details).toContain('Sweet Home');
    expect(details).toContain('hh_1');
    expect(details).toContain(EXPORTED_AT);
  });

  it('totals spending, tax and deposits in cents on the Summary tab', () => {
    const sheets = sheetsFor(
      ledger({
        expenses: [
          { amount: 1210, tax_amount: 110, deposit_amount: 20, saved_amount: 75 },
          { amount: 500, tax_amount: 40, deposit_amount: 5, saved_amount: 0 },
        ],
      } as unknown as Partial<LocalBudgetLedger>),
    );
    const summary = sheets[0]!;
    const amountCol = summary.columns.findIndex((c) => c.header === 'Amount');
    const byItem = new Map(summary.rows.map((r) => [r[0], r[amountCol]]));
    expect(byItem.get('Total spending')).toBe(1710);
    expect(byItem.get('— of which sales tax')).toBe(150);
    expect(byItem.get('— of which deposits / CRV')).toBe(25);
    expect(byItem.get('Discounts saved')).toBe(75);
  });

  it('resolves category names on the Spending tab', () => {
    const sheets = sheetsFor(
      ledger({
        categories: [{ id: 'c1', name: 'Groceries' }],
        expenses: [{ id: 'e1', category_id: 'c1', title: 'Milk', amount: 100 }],
      } as unknown as Partial<LocalBudgetLedger>),
    );
    const spending = sheets[1]!;
    const catCol = spending.columns.findIndex((c) => c.header === 'Category');
    expect(spending.rows[0]![catCol]).toBe('Groceries');
  });

  it('carries tax and deposit through to the Spending tab', () => {
    const sheets = sheetsFor(
      ledger({
        expenses: [{ id: 'e1', amount: 1210, tax_amount: 110, deposit_amount: 20 }],
      } as unknown as Partial<LocalBudgetLedger>),
    );
    const spending = sheets[1]!;
    const col = (h: string) => spending.columns.findIndex((c) => c.header === h);
    expect(spending.rows[0]![col('Sales tax')]).toBe(110);
    expect(spending.rows[0]![col('Deposit / CRV')]).toBe(20);
  });
});
