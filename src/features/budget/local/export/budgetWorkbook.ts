import type { LocalBudgetLedger } from '../engine';

import {
  isBudgetExportSectionOn,
  type BudgetExportSectionKey,
  type BudgetExportSelection,
} from './exportSelection';
import type { XlsxSheet } from './xlsxWriter';

/**
 * Ledger → workbook tabs for the .xlsx export.
 *
 * Tabs follow the app's own navigation (Spending / Planning / Savings) rather
 * than the storage table names, so the file reads the way the app does. The
 * parallel CSV bundle in `budgetLedgerExport.ts` stays table-shaped on purpose —
 * it is the machine-readable dump; this one is for a human in a spreadsheet.
 *
 * Every `money` column is INTEGER CENTS; `xlsxWriter` divides by 100 and applies
 * the currency format, so values land as real numbers that SUM() correctly.
 */

export const BUDGET_WORKBOOK_VERSION = 1;

function categoryNameLookup(ledger: LocalBudgetLedger): (id: string | null) => string {
  const byId = new Map(ledger.categories.map((c) => [c.id, c.name]));
  return (id) => (id ? byId.get(id) ?? '' : '');
}

function sum<T extends object>(rows: readonly T[], key: keyof T): number {
  return rows.reduce<number>((acc, r) => acc + (Number(r[key]) || 0), 0);
}

/**
 * Count lines on the Summary tab, keyed by the section that produces them, so a
 * tab the user excluded is not still advertised in the cover sheet's tally.
 */
const SUMMARY_COUNT_LINES: ReadonlyArray<{
  key: BudgetExportSectionKey;
  label: string;
  count: (ledger: LocalBudgetLedger) => number;
}> = [
  { key: 'categories', label: 'Categories', count: (l) => (l.categories ?? []).length },
  { key: 'planning', label: 'Planned items', count: (l) => (l.items ?? []).length },
  { key: 'monthlyBudgets', label: 'Monthly budgets', count: (l) => (l.goals ?? []).length },
  { key: 'subBudgets', label: 'Sub-budgets', count: (l) => (l.subBudgets ?? []).length },
  { key: 'income', label: 'Income entries', count: (l) => (l.savingsIncome ?? []).length },
  {
    key: 'recurring',
    label: 'Recurring payments',
    count: (l) => (l.savingsRecurringPayments ?? []).length,
  },
  { key: 'savingsGoals', label: 'Savings goals', count: (l) => (l.savingsGoals ?? []).length },
  { key: 'loans', label: 'Loans', count: (l) => (l.budgetLoans ?? []).length },
  { key: 'mortgages', label: 'Mortgages', count: (l) => (l.mortgages ?? []).length },
  {
    key: 'registeredAccounts',
    label: 'Registered accounts',
    count: (l) => (l.registeredAccounts ?? []).length,
  },
  { key: 'wishes', label: 'Wishes', count: (l) => (l.wishes ?? []).length },
  { key: 'transfers', label: 'Transfers', count: (l) => (l.transfers ?? []).length },
];

/** Overview tab — totals first, so opening the file answers the obvious questions. */
function summarySheet(
  ledger: LocalBudgetLedger,
  exportedAt: string,
  selection?: BudgetExportSelection,
): XlsxSheet {
  const expenses = ledger.expenses ?? [];
  // Four columns, not three: text metadata needs its own column. Putting a
  // household name in a `number` column makes Number() return NaN and the cell
  // is dropped entirely — the row renders blank rather than wrong, which is
  // exactly the kind of thing a summary tab must not do.
  const rows: unknown[][] = [
    ['Household', ledger.household.name || 'Household', '', ''],
    ['Household ID', ledger.household.id, '', ''],
    ['Exported at', exportedAt, '', ''],
    ['', '', '', ''],
  ];

  if (isBudgetExportSectionOn(selection, 'spending')) {
    rows.push(
      ['Spending entries', '', expenses.length, ''],
      ['Total spending', '', '', sum(expenses, 'amount')],
      ['— of which sales tax', '', '', sum(expenses, 'tax_amount')],
      ['— of which deposits / CRV', '', '', sum(expenses, 'deposit_amount')],
      ['Discounts saved', '', '', sum(expenses, 'saved_amount')],
      ['', '', '', ''],
    );
  }

  for (const line of SUMMARY_COUNT_LINES) {
    if (!isBudgetExportSectionOn(selection, line.key)) continue;
    rows.push([line.label, '', line.count(ledger), '']);
  }

  return {
    name: 'Summary',
    columns: [
      { header: 'Item', width: 30 },
      { header: 'Detail', width: 40 },
      { header: 'Count', type: 'number', width: 12 },
      { header: 'Amount', type: 'money', width: 16 },
    ],
    rows,
  };
}

function spendingSheet(ledger: LocalBudgetLedger): XlsxSheet {
  const nameOf = categoryNameLookup(ledger);
  return {
    name: 'Spending',
    columns: [
      { header: 'Date', type: 'date', width: 12 },
      { header: 'Title', width: 32 },
      { header: 'Category', width: 20 },
      { header: 'Vendor', width: 22 },
      { header: 'Amount', type: 'money', width: 14 },
      { header: 'Sales tax', type: 'money', width: 12 },
      { header: 'Deposit / CRV', type: 'money', width: 14 },
      { header: 'Discount saved', type: 'money', width: 14 },
      // Stock-ups: how many months the amount is spread over, from which month.
      // Blank for ordinary spending.
      { header: 'Spread months', type: 'number', width: 14 },
      { header: 'Spread from', width: 12 },
      { header: 'Created', type: 'datetime', width: 18 },
      { header: 'ID', width: 26 },
    ],
    rows: (ledger.expenses ?? []).map((e) => [
      e.expense_date,
      e.title,
      nameOf(e.category_id),
      e.vendor,
      e.amount,
      e.tax_amount ?? 0,
      e.deposit_amount ?? 0,
      e.saved_amount ?? 0,
      e.bulk?.months ?? null,
      e.bulk?.start_month ?? null,
      e.created_at,
      e.id,
    ]),
  };
}

function categoriesSheet(ledger: LocalBudgetLedger): XlsxSheet {
  return {
    name: 'Categories',
    columns: [
      { header: 'Name', width: 24 },
      { header: 'Icon', width: 12 },
      { header: 'Color', width: 12 },
      { header: 'Sort order', type: 'number', width: 12 },
      { header: 'Hidden', width: 10 },
      { header: 'Times used', type: 'number', width: 12 },
      { header: 'ID', width: 26 },
    ],
    rows: (ledger.categories ?? []).map((c) => [
      c.name,
      c.icon,
      c.color,
      c.sort_order,
      c.hidden ? 'yes' : 'no',
      c.usage_count ?? 0,
      c.id,
    ]),
  };
}

function planningSheet(ledger: LocalBudgetLedger): XlsxSheet {
  const nameOf = categoryNameLookup(ledger);
  return {
    name: 'Planning',
    columns: [
      { header: 'Title', width: 32 },
      { header: 'Status', width: 14 },
      { header: 'Priority', width: 12 },
      { header: 'Timeframe', width: 14 },
      { header: 'Year', type: 'number', width: 10 },
      { header: 'Target date', type: 'date', width: 12 },
      { header: 'Est. cost (min)', type: 'money', width: 15 },
      { header: 'Est. cost (max)', type: 'money', width: 15 },
      { header: 'Actual cost', type: 'money', width: 14 },
      { header: 'Category', width: 20 },
      { header: 'ID', width: 26 },
    ],
    rows: (ledger.items ?? []).map((i) => [
      i.title,
      i.status,
      i.priority,
      i.timeframe,
      i.year,
      i.target_date,
      i.estimated_cost_min,
      i.estimated_cost_max,
      i.actual_cost,
      nameOf(i.category_id),
      i.id,
    ]),
  };
}

function monthlyBudgetsSheet(ledger: LocalBudgetLedger): XlsxSheet {
  return {
    name: 'Monthly Budgets',
    columns: [
      { header: 'Year', type: 'number', width: 10 },
      { header: 'Month', type: 'number', width: 10 },
      { header: 'Planned', type: 'money', width: 14 },
      { header: 'Actual spent', type: 'money', width: 14 },
      { header: 'Notes', width: 30 },
    ],
    rows: (ledger.goals ?? []).map((g) => [
      g.year,
      g.month,
      g.planned_budget,
      g.actual_spent,
      g.notes,
    ]),
  };
}

function subBudgetsSheet(ledger: LocalBudgetLedger): XlsxSheet {
  const nameOf = categoryNameLookup(ledger);
  return {
    name: 'Sub-budgets',
    columns: [
      { header: 'Category', width: 22 },
      { header: 'Year', type: 'number', width: 10 },
      { header: 'Month', type: 'number', width: 10 },
      { header: 'Limit type', width: 14 },
      { header: 'Amount', type: 'money', width: 14 },
      // Basis points, not cents — 2500 bps = 25%. Left as a plain number so it
      // is not mistaken for money.
      { header: 'Percent (bps)', type: 'number', width: 14 },
    ],
    rows: (ledger.subBudgets ?? []).map((s) => [
      nameOf(s.category_id),
      s.year,
      s.month,
      s.limit_type,
      s.amount_cents,
      s.percent_bps,
    ]),
  };
}

function incomeSheet(ledger: LocalBudgetLedger): XlsxSheet {
  return {
    name: 'Income',
    columns: [
      { header: 'Date', type: 'date', width: 12 },
      { header: 'Label', width: 28 },
      { header: 'Source', width: 16 },
      { header: 'Amount', type: 'money', width: 14 },
      { header: 'Period', width: 12 },
      { header: 'Status', width: 12 },
      { header: 'Currency', width: 10 },
      { header: 'Notes', width: 28 },
    ],
    rows: (ledger.savingsIncome ?? []).map((e) => [
      e.income_date,
      e.label,
      e.source_type,
      e.amount_cents,
      e.period,
      e.status,
      e.currency,
      e.notes,
    ]),
  };
}

function recurringSheet(ledger: LocalBudgetLedger): XlsxSheet {
  const nameOf = categoryNameLookup(ledger);
  return {
    name: 'Recurring Payments',
    columns: [
      { header: 'Label', width: 28 },
      { header: 'Category', width: 20 },
      { header: 'Amount', type: 'money', width: 14 },
      { header: 'Day of month', type: 'number', width: 13 },
      { header: 'Group', width: 16 },
      { header: 'Essential', width: 11 },
      { header: 'Active', width: 10 },
      { header: 'Automated', width: 11 },
      { header: 'Currency', width: 10 },
    ],
    rows: (ledger.savingsRecurringPayments ?? []).map((p) => [
      p.label,
      nameOf(p.category_id),
      p.amount_cents,
      p.day_of_month,
      p.group_label,
      p.is_essential ? 'yes' : 'no',
      p.active ? 'yes' : 'no',
      p.is_automated ? 'yes' : 'no',
      p.currency,
    ]),
  };
}

function savingsGoalsSheet(ledger: LocalBudgetLedger): XlsxSheet {
  return {
    name: 'Savings Goals',
    columns: [
      { header: 'Name', width: 28 },
      { header: 'Type', width: 16 },
      { header: 'Target', type: 'money', width: 14 },
      { header: 'Current', type: 'money', width: 14 },
      { header: 'Monthly allocation', type: 'money', width: 17 },
      { header: 'Target date', type: 'date', width: 12 },
      { header: 'Status', width: 12 },
      { header: 'Currency', width: 10 },
    ],
    rows: (ledger.savingsGoals ?? []).map((g) => [
      g.name,
      g.type,
      g.target_amount_cents,
      g.current_amount_cents,
      g.monthly_allocation_cents,
      g.target_date,
      g.status,
      g.currency,
    ]),
  };
}

function loansSheet(ledger: LocalBudgetLedger): XlsxSheet {
  return {
    name: 'Loans',
    columns: [
      { header: 'Lender', width: 24 },
      { header: 'Kind', width: 14 },
      { header: 'Principal', type: 'money', width: 15 },
      { header: 'Amount paid', type: 'money', width: 15 },
      { header: 'Rate type', width: 12 },
      // Basis points: 549 bps = 5.49%.
      { header: 'Rate (bps)', type: 'number', width: 12 },
      { header: 'Term (months)', type: 'number', width: 14 },
      { header: 'Start date', type: 'date', width: 12 },
      { header: 'Notes', width: 28 },
    ],
    rows: (ledger.budgetLoans ?? []).map((l) => [
      l.lender,
      l.loan_kind,
      l.principal_cents,
      l.amount_paid_cents,
      l.rate_type,
      l.rate_bps,
      l.term_months,
      l.start_date,
      l.notes,
    ]),
  };
}

function mortgagesSheet(ledger: LocalBudgetLedger): XlsxSheet {
  return {
    name: 'Mortgages',
    columns: [
      { header: 'Nickname', width: 22 },
      { header: 'Lender', width: 22 },
      { header: 'Product', width: 16 },
      { header: 'Original principal', type: 'money', width: 18 },
      { header: 'Amortization (months)', type: 'number', width: 20 },
      { header: 'Start date', type: 'date', width: 12 },
      { header: 'Active', width: 10 },
    ],
    rows: (ledger.mortgages ?? []).map((m) => [
      m.nickname,
      m.lender,
      m.product_type,
      m.original_principal_cents,
      m.original_amortization_months,
      m.start_date,
      m.is_active ? 'yes' : 'no',
    ]),
  };
}

function registeredAccountsSheet(ledger: LocalBudgetLedger): XlsxSheet {
  return {
    name: 'Registered Accounts',
    columns: [
      { header: 'Type', width: 12 },
      { header: 'Institution', width: 24 },
      { header: 'Balance', type: 'money', width: 15 },
      { header: 'Starting room', type: 'money', width: 15 },
      { header: 'Regular contribution', type: 'money', width: 19 },
      { header: 'Annual goal', type: 'money', width: 15 },
      { header: 'Employer plan', width: 13 },
      { header: 'Employer name', width: 20 },
      { header: 'Currency', width: 10 },
    ],
    rows: (ledger.registeredAccounts ?? []).map((a) => [
      a.account_type,
      a.institution,
      a.balance_cents,
      a.starting_room_cents,
      a.regular_contribution_cents,
      a.annual_goal_cents,
      a.is_employer_plan ? 'yes' : 'no',
      a.employer_name,
      a.currency,
    ]),
  };
}

function wishesSheet(ledger: LocalBudgetLedger): XlsxSheet {
  return {
    name: 'Wishes',
    columns: [
      { header: 'Title', width: 30 },
      { header: 'Estimated cost', type: 'money', width: 16 },
      { header: 'Target date', type: 'date', width: 12 },
      { header: 'Status', width: 12 },
      { header: 'Notes', width: 30 },
    ],
    rows: (ledger.wishes ?? []).map((w) => [
      w.title,
      w.estimated_cost_cents,
      w.target_date,
      w.status,
      w.notes,
    ]),
  };
}

function transfersSheet(ledger: LocalBudgetLedger): XlsxSheet {
  return {
    name: 'Transfers',
    columns: [
      { header: 'Created', type: 'datetime', width: 18 },
      { header: 'Amount', type: 'money', width: 14 },
      { header: 'Destination type', width: 18 },
      { header: 'Destination', width: 24 },
      { header: 'Note', width: 28 },
    ],
    rows: (ledger.transfers ?? []).map((t) => [
      t.createdAt,
      t.amountCents,
      t.destinationType,
      t.destinationLabel,
      t.note,
    ]),
  };
}

/**
 * All tabs, in reading order.
 *
 * An *empty* section is still emitted — the workbook keeps a stable shape across
 * exports, and a tab missing because there is no data reads as data loss. A
 * section the user switched OFF on the Export screen is a different thing: they
 * asked for it to be absent, so it is dropped. With no selection passed, every
 * tab is included, as before.
 */
export function buildBudgetWorkbookSheets(
  ledger: LocalBudgetLedger,
  options: { exportedAt: string; sections?: BudgetExportSelection },
): XlsxSheet[] {
  const { sections } = options;
  const tabs: ReadonlyArray<{ key: BudgetExportSectionKey; build: () => XlsxSheet }> = [
    { key: 'summary', build: () => summarySheet(ledger, options.exportedAt, sections) },
    { key: 'spending', build: () => spendingSheet(ledger) },
    { key: 'categories', build: () => categoriesSheet(ledger) },
    { key: 'planning', build: () => planningSheet(ledger) },
    { key: 'monthlyBudgets', build: () => monthlyBudgetsSheet(ledger) },
    { key: 'subBudgets', build: () => subBudgetsSheet(ledger) },
    { key: 'income', build: () => incomeSheet(ledger) },
    { key: 'recurring', build: () => recurringSheet(ledger) },
    { key: 'savingsGoals', build: () => savingsGoalsSheet(ledger) },
    { key: 'loans', build: () => loansSheet(ledger) },
    { key: 'mortgages', build: () => mortgagesSheet(ledger) },
    { key: 'registeredAccounts', build: () => registeredAccountsSheet(ledger) },
    { key: 'wishes', build: () => wishesSheet(ledger) },
    { key: 'transfers', build: () => transfersSheet(ledger) },
  ];

  return tabs.filter((t) => isBudgetExportSectionOn(sections, t.key)).map((t) => t.build());
}
