import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import type { LocalBudgetLedger } from '../engine';
import { getLocalLedger, getLocalLedgerFor, isLocalBudgetSessionOpen } from '../engine';
import { BudgetLocalNotReadyError } from '../errors';

import {
  isBudgetExportSectionOn,
  type BudgetExportSectionKey,
  type BudgetExportSelection,
} from './exportSelection';

/**
 * Budget V2 local-first CSV export (BR-055 / TRD §7.6).
 *
 * Reads the on-device ledger only — no network. Formula-injection neutralized
 * per TRD v1.4 (escape cells beginning with =, +, -, @).
 */

export const BUDGET_EXPORT_FORMAT = 'symply-budget-ledger-csv';
export const BUDGET_EXPORT_VERSION = 1;

export type BudgetExportStatus = 'shared' | 'unsupported' | 'failed';

export interface BudgetExportResult {
  status: BudgetExportStatus;
  message: string;
  /** Number of data rows across all CSV sections (excluding headers). */
  rows: number;
}

export const BUDGET_EXPORT_FAILED_MESSAGE =
  'We could not put your export together just now. Try again in a moment.';

/** Neutralize spreadsheet formula injection (TRD v1.4). */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'string' ? value : String(value);
  if (/^[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(',')),
  ];
  return `${lines.join('\n')}\n`;
}

function categoryName(ledger: LocalBudgetLedger, categoryId: string | null): string {
  if (!categoryId) return '';
  return ledger.categories.find((c) => c.id === categoryId)?.name ?? '';
}

export function buildCategoriesCsv(ledger: LocalBudgetLedger): string {
  return toCsv(
    ['id', 'name', 'icon', 'color', 'sort_order', 'hidden', 'is_default', 'usage_count'],
    ledger.categories.map((c) => [
      c.id,
      c.name,
      c.icon,
      c.color,
      c.sort_order,
      c.hidden ? 1 : 0,
      c.is_default ? 1 : 0,
      c.usage_count ?? 0,
    ]),
  );
}

export function buildExpensesCsv(ledger: LocalBudgetLedger): string {
  return toCsv(
    [
      'id',
      'date',
      'title',
      'amount_cents',
      'saved_amount_cents',
      'tax_amount_cents',
      'deposit_amount_cents',
      'category_id',
      'category_name',
      'vendor',
      'budget_item_id',
      'bulk_months',
      'bulk_start_month',
      'created_at',
    ],
    ledger.expenses.map((e) => [
      e.id,
      e.expense_date,
      e.title,
      e.amount,
      e.saved_amount,
      e.tax_amount ?? 0,
      e.deposit_amount ?? 0,
      e.category_id,
      categoryName(ledger, e.category_id),
      e.vendor,
      e.budget_item_id,
      e.bulk?.months ?? null,
      e.bulk?.start_month ?? null,
      e.created_at,
    ]),
  );
}

export function buildBudgetItemsCsv(ledger: LocalBudgetLedger): string {
  return toCsv(
    [
      'id',
      'title',
      'status',
      'priority',
      'timeframe',
      'year',
      'target_date',
      'estimated_cost_min_cents',
      'estimated_cost_max_cents',
      'actual_cost_cents',
      'category_id',
      'category_name',
    ],
    ledger.items.map((item) => [
      item.id,
      item.title,
      item.status,
      item.priority,
      item.timeframe,
      item.year,
      item.target_date,
      item.estimated_cost_min,
      item.estimated_cost_max,
      item.actual_cost,
      item.category_id,
      categoryName(ledger, item.category_id),
    ]),
  );
}

export function buildGoalsCsv(ledger: LocalBudgetLedger): string {
  return toCsv(
    ['id', 'year', 'month', 'planned_budget_cents', 'actual_spent_cents', 'notes'],
    ledger.goals.map((g) => [
      g.id,
      g.year,
      g.month,
      g.planned_budget,
      g.actual_spent,
      g.notes,
    ]),
  );
}

export function buildSubBudgetsCsv(ledger: LocalBudgetLedger): string {
  return toCsv(
    [
      'id',
      'category_id',
      'category_name',
      'year',
      'month',
      'limit_type',
      'amount_cents',
      'percent_bps',
    ],
    ledger.subBudgets.map((s) => [
      s.id,
      s.category_id,
      categoryName(ledger, s.category_id),
      s.year,
      s.month,
      s.limit_type,
      s.amount_cents,
      s.percent_bps,
    ]),
  );
}

export function buildTransfersCsv(ledger: LocalBudgetLedger): string {
  return toCsv(
    ['id', 'amount_cents', 'destination_type', 'destination_label', 'note', 'created_at'],
    ledger.transfers.map((t) => [
      t.id,
      t.amountCents,
      t.destinationType,
      t.destinationLabel,
      t.note,
      t.createdAt,
    ]),
  );
}

function joinMonths(months: number[] | null | undefined): string {
  if (!months?.length) return '';
  return months.join('|');
}

export function buildSavingsIncomeCsv(ledger: LocalBudgetLedger): string {
  const rows = ledger.savingsIncome ?? [];
  return toCsv(
    [
      'id',
      'member_id',
      'source_type',
      'label',
      'amount_cents',
      'income_date',
      'currency',
      'notes',
      'template_id',
      'period',
      'status',
      'rolled_over_from_entry_id',
      'created_by',
      'created_at',
      'updated_at',
    ],
    rows.map((e) => [
      e.id,
      e.member_id,
      e.source_type,
      e.label,
      e.amount_cents,
      e.income_date,
      e.currency,
      e.notes,
      e.template_id,
      e.period,
      e.status,
      e.rolled_over_from_entry_id,
      e.created_by,
      e.created_at,
      e.updated_at,
    ]),
  );
}

export function buildSavingsRecurringCsv(ledger: LocalBudgetLedger): string {
  const rows = ledger.savingsRecurringPayments ?? [];
  return toCsv(
    [
      'id',
      'category_id',
      'label',
      'amount_cents',
      'currency',
      'day_of_month',
      'group_label',
      'is_essential',
      'active',
      'is_automated',
      'scope_type',
      'scope_year',
      'active_months',
      'source',
      'created_by',
      'created_at',
      'updated_at',
    ],
    rows.map((p) => [
      p.id,
      p.category_id,
      p.label,
      p.amount_cents,
      p.currency,
      p.day_of_month,
      p.group_label,
      p.is_essential ? 1 : 0,
      p.active ? 1 : 0,
      p.is_automated ? 1 : 0,
      p.scope_type,
      p.scope_year,
      joinMonths(p.active_months),
      p.source,
      p.created_by,
      p.created_at,
      p.updated_at,
    ]),
  );
}

export function buildSavingsGoalsCsv(ledger: LocalBudgetLedger): string {
  const rows = ledger.savingsGoals ?? [];
  return toCsv(
    [
      'id',
      'type',
      'name',
      'target_amount_cents',
      'current_amount_cents',
      'target_date',
      'months_of_expenses',
      'monthly_allocation_cents',
      'currency',
      'status',
      'created_at',
      'updated_at',
    ],
    rows.map((g) => [
      g.id,
      g.type,
      g.name,
      g.target_amount_cents,
      g.current_amount_cents,
      g.target_date,
      g.months_of_expenses,
      g.monthly_allocation_cents,
      g.currency,
      g.status,
      g.created_at,
      g.updated_at,
    ]),
  );
}

export function buildBudgetLoansCsv(ledger: LocalBudgetLedger): string {
  const rows = ledger.budgetLoans ?? [];
  return toCsv(
    [
      'id',
      'recurring_payment_id',
      'loan_kind',
      'rate_type',
      'rate_bps',
      'principal_cents',
      'term_months',
      'start_date',
      'lender',
      'notes',
      'portal_url',
      'amount_paid_cents',
      'created_by',
      'created_at',
      'updated_at',
    ],
    rows.map((l) => [
      l.id,
      l.recurring_payment_id,
      l.loan_kind,
      l.rate_type,
      l.rate_bps,
      l.principal_cents,
      l.term_months,
      l.start_date,
      l.lender,
      l.notes,
      l.portal_url,
      l.amount_paid_cents,
      l.created_by,
      l.created_at,
      l.updated_at,
    ]),
  );
}

export function buildRegisteredAccountsCsv(ledger: LocalBudgetLedger): string {
  const rows = ledger.registeredAccounts ?? [];
  return toCsv(
    [
      'id',
      'member_id',
      'account_type',
      'institution',
      'is_employer_plan',
      'employer_name',
      'balance_cents',
      'starting_room_cents',
      'annual_limit_override_cents',
      'regular_contribution_cents',
      'annual_goal_cents',
      'annual_goal_pct',
      'is_room_only',
      'employer_match_cents',
      'recurring_start_month',
      'room_as_of_date',
      'prior_earned_income_cents',
      'pension_adjustment_cents',
      'currency',
      'created_at',
      'updated_at',
    ],
    rows.map((a) => [
      a.id,
      a.member_id,
      a.account_type,
      a.institution,
      a.is_employer_plan ? 1 : 0,
      a.employer_name,
      a.balance_cents,
      a.starting_room_cents,
      a.annual_limit_override_cents,
      a.regular_contribution_cents,
      a.annual_goal_cents,
      a.annual_goal_pct,
      a.is_room_only ? 1 : 0,
      a.employer_match_cents,
      a.recurring_start_month,
      a.room_as_of_date,
      a.prior_earned_income_cents,
      a.pension_adjustment_cents,
      a.currency,
      a.created_at,
      a.updated_at,
    ]),
  );
}

export function buildWishesCsv(ledger: LocalBudgetLedger): string {
  const rows = ledger.wishes ?? [];
  return toCsv(
    [
      'id',
      'title',
      'notes',
      'cover_image_key',
      'estimated_cost_cents',
      'target_date',
      'status',
      'sort_order',
      'created_by',
      'created_at',
      'updated_at',
    ],
    rows.map((w) => [
      w.id,
      w.title,
      w.notes,
      w.cover_image_key,
      w.estimated_cost_cents,
      w.target_date,
      w.status,
      w.sort_order,
      w.created_by,
      w.created_at,
      w.updated_at,
    ]),
  );
}

export function buildMortgagesCsv(ledger: LocalBudgetLedger): string {
  const mortgages = ledger.mortgages ?? [];
  return toCsv(
    [
      'id',
      'nickname',
      'lender',
      'product_type',
      'original_principal_cents',
      'original_amortization_months',
      'start_date',
      'is_active',
    ],
    mortgages.map((m) => [
      m.id,
      m.nickname,
      m.lender,
      m.product_type,
      m.original_principal_cents,
      m.original_amortization_months,
      m.start_date,
      m.is_active ? 1 : 0,
    ]),
  );
}

export interface BudgetLedgerCsvBundle {
  format: typeof BUDGET_EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  householdId: string;
  files: Array<{ name: string; content: string; rowCount: number }>;
}

function countDataRows(csv: string): number {
  const lines = csv.trimEnd().split('\n');
  return Math.max(0, lines.length - 1);
}

/**
 * One CSV file per export section — the same keys the workbook tabs use, so a
 * section switched off on the Export screen disappears from both formats.
 * `summary` has no CSV of its own (the header block plays that role).
 */
export function buildBudgetLedgerCsvBundle(
  ledger: LocalBudgetLedger,
  options: { exportedAt: string; sections?: BudgetExportSelection },
): BudgetLedgerCsvBundle {
  const all: Array<{ key: BudgetExportSectionKey; name: string; build: () => string }> = [
    { key: 'categories', name: 'categories.csv', build: () => buildCategoriesCsv(ledger) },
    { key: 'spending', name: 'expenses.csv', build: () => buildExpensesCsv(ledger) },
    { key: 'planning', name: 'budget_items.csv', build: () => buildBudgetItemsCsv(ledger) },
    { key: 'monthlyBudgets', name: 'monthly_goals.csv', build: () => buildGoalsCsv(ledger) },
    { key: 'subBudgets', name: 'sub_budgets.csv', build: () => buildSubBudgetsCsv(ledger) },
    { key: 'transfers', name: 'transfers.csv', build: () => buildTransfersCsv(ledger) },
    { key: 'mortgages', name: 'mortgages.csv', build: () => buildMortgagesCsv(ledger) },
    { key: 'income', name: 'savings_income.csv', build: () => buildSavingsIncomeCsv(ledger) },
    {
      key: 'recurring',
      name: 'savings_recurring.csv',
      build: () => buildSavingsRecurringCsv(ledger),
    },
    { key: 'savingsGoals', name: 'savings_goals.csv', build: () => buildSavingsGoalsCsv(ledger) },
    { key: 'loans', name: 'budget_loans.csv', build: () => buildBudgetLoansCsv(ledger) },
    {
      key: 'registeredAccounts',
      name: 'registered_accounts.csv',
      build: () => buildRegisteredAccountsCsv(ledger),
    },
    { key: 'wishes', name: 'wishes.csv', build: () => buildWishesCsv(ledger) },
  ];

  const sections = all
    .filter((s) => isBudgetExportSectionOn(options.sections, s.key))
    .map((s) => ({ name: s.name, content: s.build() }));

  return {
    format: BUDGET_EXPORT_FORMAT,
    version: BUDGET_EXPORT_VERSION,
    exportedAt: options.exportedAt,
    householdId: ledger.household.id,
    files: sections.map((s) => ({
      ...s,
      rowCount: countDataRows(s.content),
    })),
  };
}

/** One shareable text file with labeled CSV sections (Phase 1 — no zip dep). */
export function renderBudgetLedgerExportText(bundle: BudgetLedgerCsvBundle): string {
  const header = [
    `# ${BUDGET_EXPORT_FORMAT} v${BUDGET_EXPORT_VERSION}`,
    `# household_id=${bundle.householdId}`,
    `# exported_at=${bundle.exportedAt}`,
    `# Amounts are integer cents unless noted.`,
    '',
  ].join('\n');

  const body = bundle.files
    .map((file) => `===== ${file.name} =====\n${file.content.trimEnd()}\n`)
    .join('\n');

  return `${header}${body}`;
}

export function totalExportedCsvRows(bundle: BudgetLedgerCsvBundle): number {
  return bundle.files.reduce((sum, f) => sum + f.rowCount, 0);
}

/**
 * The half of an export's file name that says WHOSE budget it is.
 *
 * Added by BR-016 and shared with the .xlsx path. One device can now hold
 * several households, so exporting two of them on the same day produced two
 * files called `symply-budget-2026-08-17.csv.txt` — indistinguishable in Files,
 * in Mail and in whatever the member forwarded them to. The name is the only
 * label a shared file carries; the household id inside the header block is no
 * help before the file is opened.
 *
 * Derived from the household NAME rather than its id because this half is for
 * the member to read (the id is in the header for machines). Empty for an absent
 * or unslugifiable name, which keeps the pre-BR-016 name shape intact rather
 * than emitting a dangling separator.
 */
export function budgetExportHouseholdSlug(householdName?: string | null): string {
  const slug = (householdName ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug ? `-${slug}` : '';
}

export function budgetExportFileName(
  day: string = new Date().toISOString().slice(0, 10),
  householdName?: string | null,
): string {
  return `symply-budget-${day}${budgetExportHouseholdSlug(householdName)}.csv.txt`;
}

/**
 * Build CSV from a local ledger and hand it to the OS share sheet.
 *
 * `sections` is the Export screen's toggle list; omitting it exports everything.
 *
 * `householdId` names the household to export and defaults to the active one.
 * Naming one deliberately does NOT switch the app to it: a member exporting a
 * second household from a list — or a support flow collecting all of them —
 * would otherwise find the screen behind the share sheet showing a different
 * budget than the one they started from. `getLocalLedgerFor` hydrates a cold
 * household on demand, so an export is the same act whether or not that
 * household has been opened this session.
 */
export async function exportBudgetLedgerCsv(
  options: { sections?: BudgetExportSelection; householdId?: string } = {},
): Promise<BudgetExportResult> {
  if (!isLocalBudgetSessionOpen()) {
    throw new BudgetLocalNotReadyError();
  }

  // Resolved BEFORE the try/catch that turns failures into the friendly
  // message. An id this device holds no ledger for is a caller defect — a
  // screen holding a household across a switch, a stale deep link — and
  // `BudgetLocalUnknownHouseholdError` swallowed into "we could not put your
  // export together" would be indistinguishable from a full disk. This function
  // already throws `BudgetLocalNotReadyError` for the sessionless case, so
  // throwing here is the contract it already has, not a new one.
  const ledger = options.householdId
    ? await getLocalLedgerFor(options.householdId)
    : getLocalLedger();

  let text: string;
  let rows: number;
  try {
    const bundle = buildBudgetLedgerCsvBundle(ledger, {
      exportedAt: new Date().toISOString(),
      sections: options.sections,
    });
    rows = totalExportedCsvRows(bundle);
    text = renderBudgetLedgerExportText(bundle);
  } catch {
    return { status: 'failed', message: BUDGET_EXPORT_FAILED_MESSAGE, rows: 0 };
  }

  const path = `${FileSystem.cacheDirectory ?? ''}${budgetExportFileName(
    undefined,
    ledger.household.name,
  )}`;
  try {
    await FileSystem.writeAsStringAsync(path, text);
  } catch {
    return { status: 'failed', message: BUDGET_EXPORT_FAILED_MESSAGE, rows };
  }

  try {
    if (!(await Sharing.isAvailableAsync())) {
      return {
        status: 'unsupported',
        message: 'This device has no way to share files, so the export could not be handed over.',
        rows,
      };
    }
    await Sharing.shareAsync(path, {
      mimeType: 'text/plain',
      UTI: 'public.plain-text',
      dialogTitle: 'Export budget data (CSV)',
    });
    return {
      status: 'shared',
      message:
        rows === 0
          ? 'Your export is ready. There are no ledger rows yet, so the file is mostly headers.'
          : `Your export is ready — ${rows} row${rows === 1 ? '' : 's'}.`,
      rows,
    };
  } catch {
    return { status: 'failed', message: BUDGET_EXPORT_FAILED_MESSAGE, rows };
  } finally {
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined);
  }
}
