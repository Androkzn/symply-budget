import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { forEachCounted } from '../../bulk/bulkSplit';
import {
  getLocalLedger,
  getLocalLedgerFor,
  isLocalBudgetSessionOpen,
  type LocalBudgetLedger,
} from '../engine';
import { BudgetLocalNotReadyError } from '../errors';
import { monthKey } from '../ids';

import { budgetExportHouseholdSlug } from './budgetLedgerExport';

/**
 * Phase 5 lite — high-level budget.summary.v1 shape from the local ledger
 * (Soft Transfer Worker path accepts client_payload with X-Budget-Local-First).
 */

/** Envelope field manifest for budget.summary.v1 (no secrets / line items). */
export type BudgetSummaryEnvelopePayload = {
  currency: string;
  monthTotal: number;
  ytdTotal: number;
  remaining: number | null;
  topCategories: Array<{ name: string; total: number }>;
};

export type LocalBudgetSummaryV1 = {
  format: 'budget.summary.v1';
  version: 1;
  householdId: string;
  householdName: string;
  currency: string;
  year: number;
  month: number;
  monthTotal: number;
  ytdTotal: number;
  remaining: number | null;
  plannedBudget: number | null;
  topCategories: Array<{ name: string; total: number }>;
  exportedAt: string;
};

type LocalBudgetSummaryOptions = { year?: number; month?: number; exportedAt?: string };

/**
 * Summarize the ledger it is given — the whole calculation, with no opinion
 * about which household it belongs to.
 *
 * Split out for BR-016 so the two entry points below can differ in exactly one
 * thing, how the ledger is resolved, rather than growing two copies of the
 * aggregation that could drift.
 */
function summarizeLedger(
  ledger: LocalBudgetLedger,
  options?: LocalBudgetSummaryOptions,
): LocalBudgetSummaryV1 {
  const now = new Date();
  const year = options?.year ?? now.getUTCFullYear();
  const month = options?.month ?? now.getUTCMonth() + 1;
  const yearPrefix = `${year}-`;
  const thisMonth = monthKey(year, month);

  let monthTotal = 0;
  let ytdTotal = 0;
  const byCategory = new Map<string, number>();

  // Month lens: a stock-up counts its portion here, the rest in later months —
  // the same numbers the dashboard, widget and Watch show.
  forEachCounted(ledger.expenses, (expense, countedMonth, cents) => {
    if (!countedMonth.startsWith(yearPrefix)) return;
    ytdTotal += cents;
    if (countedMonth === thisMonth) {
      monthTotal += cents;
      if (expense.category_id) {
        byCategory.set(expense.category_id, (byCategory.get(expense.category_id) ?? 0) + cents);
      }
    }
  });

  const goal = ledger.goals.find((g) => g.year === year && g.month === month);
  const planned = goal?.planned_budget ?? null;
  const remaining = planned != null ? planned - monthTotal : null;

  const topCategories = [...byCategory.entries()]
    .map(([categoryId, total]) => ({
      name: ledger.categories.find((c) => c.id === categoryId)?.name ?? 'Other',
      total,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return {
    format: 'budget.summary.v1',
    version: 1,
    householdId: ledger.household.id,
    householdName: ledger.household.name,
    currency: 'CAD',
    year,
    month,
    monthTotal,
    ytdTotal,
    remaining,
    plannedBudget: planned,
    topCategories,
    exportedAt: options?.exportedAt ?? new Date().toISOString(),
  };
}

/** The ACTIVE household's summary — what a screen means by "my budget". */
export function buildLocalBudgetSummaryV1(
  options?: LocalBudgetSummaryOptions,
): LocalBudgetSummaryV1 {
  if (!isLocalBudgetSessionOpen()) {
    throw new BudgetLocalNotReadyError();
  }
  return summarizeLedger(getLocalLedger(), options);
}

/**
 * One named household's summary, whether or not it is the active one (BR-016).
 *
 * A separate function rather than a `householdId` option on the one above,
 * because it cannot be one: reaching a household this session has not opened
 * means decrypting its rows, so the honest signature is async. Folding that into
 * `buildLocalBudgetSummaryV1` would make every synchronous caller — the Soft
 * Transfer flow builds a summary inline while assembling an envelope — await
 * something that, for the active household, never needed awaiting.
 *
 * It hydrates but does not activate: summarizing household B for a transfer must
 * leave the member on household A.
 */
export async function buildLocalBudgetSummaryV1For(
  householdId: string,
  options?: LocalBudgetSummaryOptions,
): Promise<LocalBudgetSummaryV1> {
  if (!isLocalBudgetSessionOpen()) {
    throw new BudgetLocalNotReadyError();
  }
  return summarizeLedger(await getLocalLedgerFor(householdId), options);
}

/** Strip to Soft Transfer envelope manifest fields (summary only). */
export function toBudgetSummaryEnvelopePayload(
  summary: LocalBudgetSummaryV1,
): BudgetSummaryEnvelopePayload {
  return {
    currency: summary.currency,
    monthTotal: summary.monthTotal,
    ytdTotal: summary.ytdTotal,
    remaining: summary.remaining,
    topCategories: summary.topCategories,
  };
}

/**
 * Write one household's summary to a file and hand it to the OS share sheet.
 *
 * `householdId` defaults to the active household. Unlike the export paths this
 * one reports every failure as a status instead of throwing, so an unknown
 * household lands in `failed` with the rest — that is this function's existing
 * contract (it already converts `BudgetLocalNotReadyError` the same way), and a
 * share sheet is not a place to surface a caller defect to a member.
 */
export async function shareLocalBudgetSummary(
  options: { householdId?: string } = {},
): Promise<{
  status: 'shared' | 'unsupported' | 'failed';
  message: string;
}> {
  let summary: LocalBudgetSummaryV1;
  try {
    summary = options.householdId
      ? await buildLocalBudgetSummaryV1For(options.householdId)
      : buildLocalBudgetSummaryV1();
  } catch {
    return { status: 'failed', message: 'Could not build a summary from this device.' };
  }

  // The household half of the name matters more here than in the ledger export:
  // a summary is small enough to send several of, and `summary-2026-08.json`
  // twice over says nothing about which budget each one describes.
  const path = `${FileSystem.cacheDirectory ?? ''}symply-budget-summary-${monthKey(
    summary.year,
    summary.month,
  )}${budgetExportHouseholdSlug(summary.householdName)}.json`;
  try {
    await FileSystem.writeAsStringAsync(path, JSON.stringify(summary, null, 2));
  } catch {
    return { status: 'failed', message: 'Could not write the summary file.' };
  }

  try {
    if (!(await Sharing.isAvailableAsync())) {
      return {
        status: 'unsupported',
        message: 'This device has no way to share files.',
      };
    }
    await Sharing.shareAsync(path, {
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: 'Share budget summary',
    });
    return {
      status: 'shared',
      message: `Summary for ${monthKey(summary.year, summary.month)} is ready to share.`,
    };
  } catch {
    return { status: 'failed', message: 'Could not share the summary.' };
  } finally {
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined);
  }
}
