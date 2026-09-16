import type { BudgetQuickAddSuggestion } from '@api/budget';
import { formatMoney } from '@utils/money';

import {
  clampToMonthBounds,
  defaultDateForMonth,
  toLocalYMD,
} from './budgetItemFormUtils';

export function expenseDateForQuickAdd(year: number, month: number): string {
  const today = new Date();
  const clamped = clampToMonthBounds(today, year, month);
  return toLocalYMD(clamped);
}

export function plannedTargetDateForQuickAdd(year: number, month: number): string {
  return toLocalYMD(defaultDateForMonth(year, month));
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RECEIPT_DATE_MAX_AGE_MONTHS = 13;

/**
 * Resolve the expense date for scanned receipt items. A receipt's printed date is
 * only trusted when it is a valid, recent, non-future date; otherwise (stale sample
 * receipts, misread years, OCR noise) we fall back to the month the user is viewing
 * so scanned items don't silently disappear into the wrong period.
 */
export function resolveReceiptExpenseDate(
  purchaseDate: string | null | undefined,
  year: number,
  month: number,
  now: Date = new Date()
): string {
  const fallback = expenseDateForQuickAdd(year, month);
  if (!purchaseDate || !ISO_DATE_RE.test(purchaseDate)) return fallback;

  const parsed = new Date(`${purchaseDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return fallback;

  const maxFuture = now.getTime() + 24 * 60 * 60 * 1000;
  if (parsed.getTime() > maxFuture) return fallback;

  const minPast = new Date(now.getTime());
  minPast.setMonth(minPast.getMonth() - RECEIPT_DATE_MAX_AGE_MONTHS);
  if (parsed.getTime() < minPast.getTime()) return fallback;

  return purchaseDate;
}

/** Whole grouped dollars — "$9,456", never "$9.5k" and never cents. */
function quickAddDollars(cents: number): string {
  return formatMoney(cents);
}

export function formatQuickAddAmount(
  suggestion: BudgetQuickAddSuggestion,
  kind: 'planned' | 'spent'
): string | null {
  if (kind === 'spent') {
    if (suggestion.amount == null || suggestion.amount <= 0) return null;
    return quickAddDollars(suggestion.amount);
  }

  const min = suggestion.estimated_cost_min;
  const max = suggestion.estimated_cost_max;
  if (min == null && max == null) return null;
  if (min == null || max == null || min === max) {
    return quickAddDollars((min ?? max) as number);
  }
  return `${quickAddDollars(min)}-${quickAddDollars(max)}`;
}

/**
 * The form shows ONE quick-add strip, not Recent/Popular tabs. The API still
 * answers with both lists (the backend contract predates the merge), so they
 * are folded here: recent first — what was just bought is the likeliest
 * repeat — then whatever popular titles recent did not already cover. Titles
 * match case-insensitively so "coffee" and "Coffee" cannot both show.
 */
export function mergeQuickAddSuggestions(
  recent: BudgetQuickAddSuggestion[],
  popular: BudgetQuickAddSuggestion[]
): BudgetQuickAddSuggestion[] {
  const seen = new Set<string>();
  const merged: BudgetQuickAddSuggestion[] = [];
  for (const suggestion of [...recent, ...popular]) {
    const key = suggestion.title.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(suggestion);
  }
  return merged;
}

export function buildPlannedCreatePayload(
  suggestion: BudgetQuickAddSuggestion,
  year: number,
  month: number
) {
  return {
    title: suggestion.title,
    description: suggestion.description ?? undefined,
    category_id: suggestion.category_id ?? undefined,
    timeframe: 'immediate' as const,
    priority: suggestion.priority ?? 'medium',
    estimated_cost_min: suggestion.estimated_cost_min ?? undefined,
    estimated_cost_max: suggestion.estimated_cost_max ?? undefined,
    is_recurring: suggestion.is_recurring,
    ...(suggestion.recurrence_frequency
      ? {
          recurrence_frequency: suggestion.recurrence_frequency as 'monthly' | 'quarterly' | 'yearly',
        }
      : {}),
    target_date: plannedTargetDateForQuickAdd(year, month),
  };
}

export function buildSpentCreatePayload(
  suggestion: BudgetQuickAddSuggestion,
  year: number,
  month: number
) {
  return {
    title: suggestion.title,
    description: suggestion.description ?? undefined,
    amount: suggestion.amount ?? 0,
    expense_date: expenseDateForQuickAdd(year, month),
    category_id: suggestion.category_id ?? undefined,
  };
}
