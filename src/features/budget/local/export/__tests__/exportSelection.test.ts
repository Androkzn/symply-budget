/// <reference types="node" />
import fs from 'fs';
import path from 'path';

import type { LocalBudgetLedger } from '../../engine';
import { buildBudgetLedgerCsvBundle } from '../budgetLedgerExport';
import { buildBudgetWorkbookSheets } from '../budgetWorkbook';
import {
  BUDGET_EXPORT_SECTIONS,
  BUDGET_EXPORT_SECTION_KEYS,
  budgetExportSelectionOf,
  countSelectedBudgetExportSections,
  isBudgetExportSectionOn,
  loadBudgetExportSelection,
  saveBudgetExportSelection,
} from '../exportSelection';

const mockGetItem = jest.fn<Promise<string | null>, [string]>();
const mockSetItem = jest.fn<Promise<void>, [string, string]>();
const mockRemoveItem = jest.fn<Promise<void>, [string]>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (...args: [string]) => mockGetItem(...args),
    setItem: (...args: [string, string]) => mockSetItem(...args),
    removeItem: (...args: [string]) => mockRemoveItem(...args),
  },
}));

/**
 * BR-016 keys the export selection by household — a member who excludes wishes
 * from one budget has said nothing about the other.
 *
 * Without an active household the loader returns defaults and never reads
 * storage, so these cases would silently assert against all-on rather than the
 * stored choice.
 */
jest.mock('../../engine', () => ({
  getActiveBudgetHouseholdId: jest.fn(() => 'hh_local_export'),
}));

/** Minimal ledger — every table the export touches, mostly empty. */
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
    savingsIncome: [],
    savingsRecurringPayments: [],
    savingsGoals: [],
    budgetLoans: [],
    registeredAccounts: [],
    wishes: [],
    ops: [],
    ...overrides,
  } as unknown as LocalBudgetLedger;
}

const EXPORTED_AT = '2026-08-16T12:00:00.000Z';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetItem.mockResolvedValue(null);
  mockSetItem.mockResolvedValue(undefined);
});

describe('budget export selection', () => {
  it('describes every section exactly once, in workbook order', () => {
    expect(BUDGET_EXPORT_SECTION_KEYS).toHaveLength(14);
    expect(new Set(BUDGET_EXPORT_SECTION_KEYS).size).toBe(BUDGET_EXPORT_SECTION_KEYS.length);
    expect(BUDGET_EXPORT_SECTIONS.map((s) => s.label)).toEqual(
      buildBudgetWorkbookSheets(ledger(), { exportedAt: EXPORTED_AT }).map((s) => s.name),
    );
  });

  it('gives every section its own glyph from the Budget kit', () => {
    // Checked against the kit ON DISK, not `hasBrandIcon` — the generated
    // require-map only ever holds one brand (House by default), so that would
    // pass or fail depending on which APP_BRAND last built the checkout.
    const kit = path.resolve(
      __dirname,
      '../../../../../../brands/symply-budget/src/assets/icons/png/selected',
    );
    const icons = BUDGET_EXPORT_SECTIONS.map((s) => s.icon);

    // A slug the kit does not ship renders as an Ionicons "?" box, and a
    // repeat means two rows are indistinguishable while scrolling.
    expect(icons.filter((icon) => !fs.existsSync(path.join(kit, `${icon}.png`)))).toEqual([]);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('treats an absent selection as "include everything"', () => {
    for (const key of BUDGET_EXPORT_SECTION_KEYS) {
      expect(isBudgetExportSectionOn(undefined, key)).toBe(true);
      expect(isBudgetExportSectionOn({}, key)).toBe(true);
    }
    expect(countSelectedBudgetExportSections(undefined)).toBe(14);
  });

  it('builds all-on and all-off selections', () => {
    expect(countSelectedBudgetExportSections(budgetExportSelectionOf(true))).toBe(14);
    expect(countSelectedBudgetExportSections(budgetExportSelectionOf(false))).toBe(0);
  });
});

describe('loadBudgetExportSelection', () => {
  it('defaults to all-on when nothing is stored', async () => {
    expect(await loadBudgetExportSelection()).toEqual(budgetExportSelectionOf(true));
  });

  it('keeps a stored choice', async () => {
    mockGetItem.mockResolvedValue(JSON.stringify({ wishes: false, loans: false }));

    const loaded = await loadBudgetExportSelection();

    expect(loaded.wishes).toBe(false);
    expect(loaded.loans).toBe(false);
    expect(countSelectedBudgetExportSections(loaded)).toBe(12);
  });

  it('defaults a section the stored selection has never heard of to on', async () => {
    // A selection written by an older build predates whichever section ships
    // next; the missing key must not drop that section out of the export.
    mockGetItem.mockResolvedValue(JSON.stringify({ spending: false }));

    const loaded = await loadBudgetExportSelection();

    expect(loaded.spending).toBe(false);
    expect(loaded.transfers).toBe(true);
  });

  it('falls back to all-on when the stored value is unreadable', async () => {
    mockGetItem.mockResolvedValue('{not json');
    expect(await loadBudgetExportSelection()).toEqual(budgetExportSelectionOf(true));

    mockGetItem.mockRejectedValue(new Error('storage is gone'));
    expect(await loadBudgetExportSelection()).toEqual(budgetExportSelectionOf(true));
  });

  it('never lets a failed write reject — an export outranks a preference', async () => {
    mockSetItem.mockRejectedValue(new Error('disk full'));
    await expect(saveBudgetExportSelection(budgetExportSelectionOf(false))).resolves.toBeUndefined();
  });
});

describe('selection applied to the .xlsx workbook', () => {
  it('emits every tab when no selection is given', () => {
    expect(buildBudgetWorkbookSheets(ledger(), { exportedAt: EXPORTED_AT })).toHaveLength(14);
  });

  it('drops exactly the tabs that are switched off', () => {
    const sheets = buildBudgetWorkbookSheets(ledger(), {
      exportedAt: EXPORTED_AT,
      sections: { ...budgetExportSelectionOf(true), wishes: false, loans: false },
    });

    const names = sheets.map((s) => s.name);
    expect(names).not.toContain('Wishes');
    expect(names).not.toContain('Loans');
    expect(names).toHaveLength(12);
  });

  it('produces an empty workbook when nothing is selected', () => {
    expect(
      buildBudgetWorkbookSheets(ledger(), {
        exportedAt: EXPORTED_AT,
        sections: budgetExportSelectionOf(false),
      }),
    ).toHaveLength(0);
  });

  it('keeps the Summary tally to the sections that are actually in the file', () => {
    const [summary] = buildBudgetWorkbookSheets(ledger(), {
      exportedAt: EXPORTED_AT,
      sections: { ...budgetExportSelectionOf(true), wishes: false, spending: false },
    });

    const items = summary!.rows.map((r) => r[0]);
    expect(items).not.toContain('Wishes');
    // The whole spending block goes with the Spending tab, totals included.
    expect(items).not.toContain('Spending entries');
    expect(items).not.toContain('Total spending');
    expect(items).toContain('Transfers');
    // Household metadata is not a section — it always heads the cover sheet.
    expect(items).toContain('Household');
  });

  it('still emits a tab whose section is on but empty', () => {
    const names = buildBudgetWorkbookSheets(ledger(), {
      exportedAt: EXPORTED_AT,
      sections: budgetExportSelectionOf(true),
    }).map((s) => s.name);
    expect(names).toContain('Wishes');
  });
});

describe('selection applied to the CSV bundle', () => {
  it('emits every file when no selection is given', () => {
    const bundle = buildBudgetLedgerCsvBundle(ledger(), { exportedAt: EXPORTED_AT });
    expect(bundle.files).toHaveLength(13);
  });

  it('drops the same sections the workbook drops', () => {
    const bundle = buildBudgetLedgerCsvBundle(ledger(), {
      exportedAt: EXPORTED_AT,
      sections: { ...budgetExportSelectionOf(true), wishes: false, spending: false },
    });

    const names = bundle.files.map((f) => f.name);
    expect(names).not.toContain('wishes.csv');
    expect(names).not.toContain('expenses.csv');
    expect(names).toContain('categories.csv');
    expect(names).toHaveLength(11);
  });

  it('produces no files when nothing is selected', () => {
    const bundle = buildBudgetLedgerCsvBundle(ledger(), {
      exportedAt: EXPORTED_AT,
      sections: budgetExportSelectionOf(false),
    });
    expect(bundle.files).toHaveLength(0);
  });
});
