import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import {
  closeLocalBudgetSession,
  getLocalLedger,
  openLocalBudgetSessionForTests,
} from '../engine';
import {
  buildBudgetLedgerCsvBundle,
  buildExpensesCsv,
  buildSavingsIncomeCsv,
  escapeCsvCell,
  exportBudgetLedgerCsv,
  renderBudgetLedgerExportText,
  totalExportedCsvRows,
} from '../export/budgetLedgerExport';
import { localBudgetApi } from '../localBudgetApi';

jest.mock('expo-file-system/legacy', () => ({
  writeAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
  cacheDirectory: 'file:///cache/',
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));

const mockWrite = FileSystem.writeAsStringAsync as jest.Mock;
const mockDelete = FileSystem.deleteAsync as jest.Mock;
const mockIsAvailable = Sharing.isAvailableAsync as jest.Mock;
const mockShare = Sharing.shareAsync as jest.Mock;

describe('budgetLedgerExport', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockWrite.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
    mockIsAvailable.mockResolvedValue(true);
    mockShare.mockResolvedValue(undefined);
    await openLocalBudgetSessionForTests({ userId: 'user-export-1' });
  });

  afterEach(async () => {
    await closeLocalBudgetSession();
  });

  it('escapes formula-injection prefixes', () => {
    expect(escapeCsvCell('=CMD()')).toBe("'=CMD()");
    expect(escapeCsvCell('+1+1')).toBe("'+1+1");
    expect(escapeCsvCell('-2')).toBe("'-2");
    expect(escapeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(escapeCsvCell('normal')).toBe('normal');
  });

  it('builds expenses CSV with category names', async () => {
    const householdId = getLocalLedger().household.id;
    // 'Pets' is a seeded default now — pick a name the seed does not own so
    // this exercises the export, not the duplicate-name guard.
    const { category } = await localBudgetApi.createCategory(householdId, { name: 'Cat Show Fees' });
    await localBudgetApi.addExpense(householdId, {
      title: 'Cat food',
      amount: 1299,
      expense_date: '2026-08-10',
      category_id: category.id,
      vendor: 'PetCo',
    });

    const csv = buildExpensesCsv(getLocalLedger());
    expect(csv).toContain('Cat food');
    expect(csv).toContain('Cat Show Fees');
    expect(csv).toContain('1299');
    expect(csv).toContain('PetCo');
  });

  it('builds savings income CSV and escapes formula prefixes', () => {
    const ledger = getLocalLedger();
    ledger.savingsIncome = [
      {
        id: 'inc-1',
        household_id: ledger.household.id,
        member_id: ledger.memberId,
        source_type: 'payroll',
        label: '=HIDDEN()',
        amount_cents: 500000,
        income_date: '2026-08-01',
        currency: 'CAD',
        notes: null,
        template_id: null,
        period: '2026-08',
        status: 'confirmed',
        rolled_over_from_entry_id: null,
        created_by: ledger.memberId,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      },
    ];

    const csv = buildSavingsIncomeCsv(ledger);
    expect(csv).toContain('payroll');
    expect(csv).toContain('500000');
    expect(csv).toContain("'=HIDDEN()");

    const bundle = buildBudgetLedgerCsvBundle(ledger, {
      exportedAt: '2026-08-10T12:00:00.000Z',
    });
    expect(bundle.files.some((f) => f.name === 'savings_income.csv')).toBe(true);
    expect(renderBudgetLedgerExportText(bundle)).toContain('===== savings_income.csv =====');
  });

  it('bundles sections and shares a file', async () => {
    const householdId = getLocalLedger().household.id;
    await localBudgetApi.addExpense(householdId, {
      title: 'Milk',
      amount: 400,
      expense_date: '2026-08-01',
    });

    const bundle = buildBudgetLedgerCsvBundle(getLocalLedger(), {
      exportedAt: '2026-08-10T12:00:00.000Z',
    });
    expect(bundle.files.some((f) => f.name === 'expenses.csv')).toBe(true);
    expect(totalExportedCsvRows(bundle)).toBeGreaterThanOrEqual(1);
    expect(renderBudgetLedgerExportText(bundle)).toContain('===== expenses.csv =====');

    const result = await exportBudgetLedgerCsv();
    expect(result.status).toBe('shared');
    expect(mockWrite).toHaveBeenCalled();
    expect(mockShare).toHaveBeenCalled();
    const written = mockWrite.mock.calls[0][1] as string;
    expect(written).toContain('Milk');
  });
});
