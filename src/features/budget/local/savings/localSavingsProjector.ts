import type { BudgetCategory, BudgetGoal, Expense, SubBudget } from '@api/budget';
import type { BudgetLoan } from '@api/budgetLoans';
import {
  PROJECTION_METHODS,
  type EmergencyFundSuggestion,
  type ProjectionMethod,
  type RecurringApplyStatus,
  type RecurringPaymentLoanSummary,
  type RecurringPaymentMonthlyHistory,
  type RecurringPaymentRenewalSummary,
  type RecurringPaymentsView,
  type RecurringYearlyGroupBreakdown,
  type SavingsGoal,
  type SavingsIncomeEntry,
  type SavingsOverview,
  type SavingsProjection,
  type SavingsProjectionMonth,
  type SavingsRecurringPayment,
  type SavingsSpendingEntry,
  type SavingsTrend,
  type SetProjectionTargetsRequest,
  type YearComparison,
  type YearComparisonColumn,
  type YearComparisonDelta,
  type YearHistory,
  type YearHistoryGoals,
  type YearMonthlyRow,
} from '@api/savings';
import { computeInstallmentLoanSummary } from '@features/budget/loan-amortization';
import { isIrregularIncomeSource } from '@screens/budget/savings/incomeSourceMeta';

import { forEachCounted, lastPlanMonth, monthExpenseView } from '../../bulk/bulkSplit';
import type { LocalBudgetLedger, LocalBudgetRenewal } from '../engine';
import { expenseInMonth, isoNow, monthKey, newLocalId } from '../ids';

import { isRecurringPaymentActiveInMonth } from './recurringScope';

/**
 * One target per period, chosen identically on every replica.
 *
 * The table is keyed by a surrogate id (see LocalSavingsMonthlyTarget), so two
 * members setting a target for the same month concurrently produce two rows —
 * the merge rule keeps both concurrent creates. Iterating the array and letting
 * the last one win would make the displayed target depend on op arrival order,
 * which differs per device. Newest `updated_at` wins, ties broken by id, so both
 * devices show the same number.
 */
export function targetsByPeriod(
  ledger: LocalBudgetLedger,
): Map<string, { target_cents: number }> {
  const best = new Map<string, { target_cents: number; updated_at: string; id: string }>();
  for (const r of ledger.savingsMonthlyTargets) {
    if (!r.period) continue;
    const current = best.get(r.period);
    const updatedAt = r.updated_at ?? '';
    const id = r.id ?? '';
    if (
      !current ||
      updatedAt > current.updated_at ||
      (updatedAt === current.updated_at && id > current.id)
    ) {
      best.set(r.period, { target_cents: r.target_cents, updated_at: updatedAt, id });
    }
  }
  return best;
}

const FOOD_CATEGORY_NAMES = new Set(['food', 'groceries']);
const MONTHLY_PAYMENT_CATEGORY_NAMES = new Set([
  'monthly payments',
  'rent & mortgage',
  'rent',
  'mortgage',
]);
const HOUSING_GROUP_LABEL = 'Housing';
const LOANS_GROUP_LABEL = 'Loans & Debt';
const HOUSING_LABEL_PATTERN =
  /(mortgage|strata|\bhoa\b|home\s*owners?\s*association|condo\s*(fee|maintenance)|property\s*tax|land\s*tax|\brent\b)/i;
const RECENT_PACE_MONTHS = 3;
const TREND_WINDOW_MONTHS = 6;
/**
 * The household-wide default lives server-side (`savings_projection_settings`)
 * and isn't mirrored into the offline ledger — a household changes it rarely,
 * and doing so needs to be online anyway (see `localSavingsApi`, which throws
 * `BudgetLocalUnsupportedError` for `setDefaultProjectionMethod`). Offline,
 * an omitted `method` falls back to this rather than a stale/absent setting.
 */
const DEFAULT_PROJECTION_METHOD: ProjectionMethod = 'hybrid';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function dateInMonth(date: string, year: number, month: number): boolean {
  return date.startsWith(monthKey(year, month));
}

function looksLikeHousingPayment(label: string): boolean {
  return HOUSING_LABEL_PATTERN.test(label ?? '');
}

export function resolveRecurringGroupLabel(
  label: string,
  storedGroup: string | null | undefined,
  isLoanTracked = false,
): string | null {
  const trimmed = (storedGroup ?? '').trim();
  if (trimmed) return trimmed;
  if (isLoanTracked) return LOANS_GROUP_LABEL;
  if (looksLikeHousingPayment(label)) return HOUSING_GROUP_LABEL;
  return null;
}

function activeRecurring(ledger: LocalBudgetLedger): SavingsRecurringPayment[] {
  return ledger.savingsRecurringPayments.filter((p) => p.active);
}

function monthlyPaymentsTotal(
  ledger: LocalBudgetLedger,
  year: number,
  month: number,
): number {
  return activeRecurring(ledger)
    .filter((p) => isRecurringPaymentActiveInMonth(p, year, month))
    .reduce((sum, p) => sum + p.amount_cents, 0);
}

/**
 * Budget spendings on the month lens — the same number the Budget dashboard
 * shows, so a stock-up never reads as a one-month collapse in savings and a
 * windfall in the months after (BRD Q1).
 */
function budgetSpendingsTotal(ledger: LocalBudgetLedger, year: number, month: number): number {
  return monthExpenseView(ledger.expenses, year, month).totalCents;
}

function confirmedIncomeInMonth(
  ledger: LocalBudgetLedger,
  year: number,
  month: number,
): SavingsIncomeEntry[] {
  return ledger.savingsIncome
    .filter(
      (e) => dateInMonth(e.income_date, year, month) && (e.status === 'confirmed' || !e.status),
    )
    .sort((a, b) => b.income_date.localeCompare(a.income_date));
}

function incomeTotals(entries: SavingsIncomeEntry[]) {
  let total = 0;
  let regularTotal = 0;
  let irregularTotal = 0;
  const bySource: Record<string, number> = {};
  for (const row of entries) {
    total += row.amount_cents;
    if (isIrregularIncomeSource(row.source_type)) {
      irregularTotal += row.amount_cents;
    } else {
      regularTotal += row.amount_cents;
    }
    bySource[row.source_type] = (bySource[row.source_type] ?? 0) + row.amount_cents;
  }
  return { total, regularTotal, irregularTotal, bySource };
}

function computeYtdNet(ledger: LocalBudgetLedger, year: number, month: number): number {
  const incomeByMonth = new Map<number, number>();
  const spendingsByMonth = new Map<number, number>();

  for (let m = 1; m <= month; m++) {
    incomeByMonth.set(m, incomeTotals(confirmedIncomeInMonth(ledger, year, m)).total);
    spendingsByMonth.set(m, budgetSpendingsTotal(ledger, year, m));
  }

  let ytdNet = 0;
  for (let m = 1; m <= month; m++) {
    const inc = incomeByMonth.get(m) ?? 0;
    const spend = spendingsByMonth.get(m) ?? 0;
    ytdNet += inc - monthlyPaymentsTotal(ledger, year, m) - spend;
  }
  return ytdNet;
}

function activeGoalsRollup(ledger: LocalBudgetLedger): SavingsOverview['goals'] {
  return ledger.savingsGoals
    .filter((g) => g.status === 'active')
    .map((g) => ({
      id: g.id,
      name: g.name,
      type: g.type,
      target: g.target_amount_cents,
      current: g.current_amount_cents,
      monthlyAllocation: g.monthly_allocation_cents ?? null,
    }));
}

export function getOverview(ledger: LocalBudgetLedger, year: number, month: number): SavingsOverview {
  const entries = confirmedIncomeInMonth(ledger, year, month);
  const income = incomeTotals(entries);
  const monthlyPayments = monthlyPaymentsTotal(ledger, year, month);
  const spendings = budgetSpendingsTotal(ledger, year, month);
  const spendingTotal = monthlyPayments + spendings;
  const netSavings = income.total - spendingTotal;

  return {
    year,
    month,
    income: {
      total: income.total,
      regularTotal: income.regularTotal,
      irregularTotal: income.irregularTotal,
      bySource: income.bySource,
      entries,
    },
    spending: {
      total: spendingTotal,
      monthlyPayments,
      spendings,
    },
    netSavings,
    ytdNet: computeYtdNet(ledger, year, month),
    goals: activeGoalsRollup(ledger),
  };
}

export function getTrend(
  ledger: LocalBudgetLedger,
  year: number,
  month: number,
  months: number,
): SavingsTrend {
  const span = Math.max(1, Math.min(60, Math.floor(months) || 1));
  const anchorIndex = year * 12 + (month - 1);
  const startIndex = anchorIndex - (span - 1);

  const points = [];
  for (let i = 0; i < span; i++) {
    const idx = startIndex + i;
    const y = Math.floor(idx / 12);
    const m = (idx % 12) + 1;
    const period = monthKey(y, m);
    const monthlyPayments = monthlyPaymentsTotal(ledger, y, m);
    const income = incomeTotals(confirmedIncomeInMonth(ledger, y, m)).total;
    const spendings = budgetSpendingsTotal(ledger, y, m);
    const spending = monthlyPayments + spendings;
    const hasExpenseData = ledger.expenses.some((e) => expenseInMonth(e.expense_date, y, m));
    points.push({
      period,
      income,
      spending,
      monthlyPayments,
      spendings,
      net: income - spending,
      hasExpenseData,
    });
  }
  return { months: points };
}

function loanSummaryFor(
  loan: BudgetLoan,
  paymentCents: number,
): RecurringPaymentLoanSummary {
  const s = computeInstallmentLoanSummary({
    principalCents: loan.principal_cents,
    rateType: loan.rate_type,
    rateBps: loan.rate_bps,
    termMonths: loan.term_months,
    startDate: loan.start_date,
    paymentCents,
  });
  return {
    termMonths: s.termMonths,
    elapsedMonths: s.elapsedMonths,
    paymentsRemaining: s.paymentsRemaining,
    currentBalanceCents: s.currentBalanceCents,
    interestPaidToDateCents: s.interestPaidToDateCents,
    totalInterestCents: s.totalInterestCents,
    totalCostCents: s.totalCostCents,
    payoffDate: s.payoffDate,
  };
}

function renewalSummaryFor(renewal: LocalBudgetRenewal): RecurringPaymentRenewalSummary {
  return {
    next_renewal_date: renewal.next_renewal_date,
    status: renewal.status,
    reminder_lead_days: renewal.reminder_lead_days,
  };
}

export function listRecurring(
  ledger: LocalBudgetLedger,
  year?: number,
  month?: number,
): RecurringPaymentsView {
  const loanByPayment = new Map(
    ledger.budgetLoans.map((l) => [l.recurring_payment_id, l] as const),
  );
  const renewalByPayment = new Map(
    ledger.budgetRenewals.map((r) => [r.recurring_payment_id, r] as const),
  );
  const loanIds = new Set(loanByPayment.keys());

  const resolvedItems = ledger.savingsRecurringPayments.map((item) => {
    const loan = loanByPayment.get(item.id);
    const renewal = renewalByPayment.get(item.id);
    return {
      ...item,
      // Legacy rows carry these flags as SQLite's 1/0 rather than a real
      // boolean. Everything here treats them as truthy and agrees, but the
      // edit form copies them into its own state and writes them straight
      // back — so without this the bad shape is re-persisted on every save
      // (and `Toggle` has to keep defending against it). Normalize once, on
      // the way out.
      is_essential: !!item.is_essential,
      active: !!item.active,
      is_automated: !!item.is_automated,
      group_label: resolveRecurringGroupLabel(item.label, item.group_label, loanIds.has(item.id)),
      renewal_summary: renewal ? renewalSummaryFor(renewal) : null,
      loan_summary: loan ? loanSummaryFor(loan, item.amount_cents) : null,
    };
  });

  let totalMonthlyCents = 0;
  const groupTotals = new Map<string | null, number>();
  for (const item of resolvedItems) {
    if (!item.active) continue;
    if (year != null && month != null && !isRecurringPaymentActiveInMonth(item, year, month)) {
      continue;
    }
    totalMonthlyCents += item.amount_cents;
    const key = item.group_label ?? null;
    groupTotals.set(key, (groupTotals.get(key) ?? 0) + item.amount_cents);
  }

  const byGroup = Array.from(groupTotals.entries())
    .map(([group_label, subtotalCents]) => ({ group_label, subtotalCents }))
    .sort((a, b) => {
      if (a.group_label === b.group_label) return 0;
      if (a.group_label === null) return 1;
      if (b.group_label === null) return -1;
      return a.group_label.localeCompare(b.group_label);
    });

  const savedMonthlyIncomeCents = ledger.savingsIncomeTemplates
    .filter((t) => t.active)
    .reduce((sum, t) => sum + t.amount_cents, 0);

  return {
    items: resolvedItems,
    totalMonthlyCents,
    savedMonthlyIncomeCents,
    byGroup,
  };
}

export function getEmergencyFundSuggestion(
  ledger: LocalBudgetLedger,
  months: number,
): EmergencyFundSuggestion {
  const monthsCount = Math.max(1, Math.floor(months) || 1);
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const essentialMonthlySpending = activeRecurring(ledger)
    .filter((p) => p.is_essential && isRecurringPaymentActiveInMonth(p, year, month))
    .reduce((sum, p) => sum + p.amount_cents, 0);

  if (essentialMonthlySpending === 0) {
    return {
      suggestedTarget: 0,
      essentialMonthlySpending: 0,
      months: monthsCount,
      note: 'NO_HISTORY',
    };
  }

  return {
    suggestedTarget: essentialMonthlySpending * monthsCount,
    essentialMonthlySpending,
    months: monthsCount,
  };
}

function expenseBucket(name: string): 'food' | 'pay' | 'other' {
  const n = name.trim().toLowerCase();
  if (FOOD_CATEGORY_NAMES.has(n)) return 'food';
  if (MONTHLY_PAYMENT_CATEGORY_NAMES.has(n)) return 'pay';
  return 'other';
}

function categoryNameById(categories: BudgetCategory[], id: string | null): string {
  if (!id) return '';
  return categories.find((c) => c.id === id)?.name ?? '';
}

function computeYearGoals(ledger: LocalBudgetLedger, year: number): YearHistoryGoals {
  const activeGoals = ledger.savingsGoals.filter((g) => g.status === 'active');
  let savingsMonthly: number | null = null;
  let savingsYearly: number | null = null;
  if (activeGoals.length) {
    const alloc = activeGoals.reduce((s, g) => s + (g.monthly_allocation_cents ?? 0), 0);
    savingsMonthly = alloc > 0 ? alloc : null;
    const targets = activeGoals.reduce((s, g) => s + (g.target_amount_cents ?? 0), 0);
    savingsYearly = targets > 0 ? targets : null;
  }

  const catBucket = new Map<string, 'food' | 'pay' | 'other'>();
  for (const c of ledger.categories) catBucket.set(c.id, expenseBucket(c.name));

  const defaultByCat = new Map<string, SubBudget>();
  const overrideByCatMonth = new Map<string, SubBudget>();
  for (const r of ledger.subBudgets) {
    if (r.year !== year) continue;
    if (r.month == null) defaultByCat.set(r.category_id, r);
    else overrideByCatMonth.set(`${r.category_id}:${r.month}`, r);
  }

  const plannedByMonth = new Map<number, number>();
  for (const row of ledger.goals) {
    if (row.year !== year || row.month == null || row.planned_budget == null) continue;
    plannedByMonth.set(row.month, row.planned_budget);
  }

  const resolveCap = (catId: string, mo: number): number | null => {
    const sub = overrideByCatMonth.get(`${catId}:${mo}`) ?? defaultByCat.get(catId);
    if (!sub) return null;
    if (sub.limit_type === 'amount') return sub.amount_cents ?? null;
    const planned = plannedByMonth.get(mo);
    if (planned != null && sub.percent_bps != null) {
      return Math.round((planned * sub.percent_bps) / 10_000);
    }
    return null;
  };

  const foodValues: number[] = [];
  const otherValues: number[] = [];
  for (let m = 1; m <= 12; m++) {
    for (const [catId, bucket] of catBucket) {
      if (bucket === 'pay') continue;
      const cap = resolveCap(catId, m);
      if (cap == null || cap <= 0) continue;
      if (bucket === 'food') foodValues.push(cap);
      else otherValues.push(cap);
    }
  }

  const avg = (vals: number[]) =>
    vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null;

  const plannedBudgetByMonth: (number | null)[] = [];
  for (let m = 1; m <= 12; m++) plannedBudgetByMonth.push(plannedByMonth.get(m) ?? null);

  return {
    foodMonthly: avg(foodValues),
    otherMonthly: avg(otherValues),
    savingsMonthly,
    savingsYearly,
    plannedBudgetByMonth,
  };
}

export function getYearHistory(ledger: LocalBudgetLedger, year: number): YearHistory {
  const incomeMap = new Map<number, number>();
  for (let m = 1; m <= 12; m++) {
    incomeMap.set(m, incomeTotals(confirmedIncomeInMonth(ledger, year, m)).total);
  }

  const foodMap = new Map<number, number>();
  const payMap = new Map<number, number>();
  const otherMap = new Map<number, number>();

  // Month lens: a stock-up lands in each month of its plan, under its own bucket.
  forEachCounted(ledger.expenses, (e, countedMonth, cents) => {
    if (!countedMonth.startsWith(`${year}-`)) return;
    const mo = Number(countedMonth.slice(5, 7));
    if (!Number.isInteger(mo)) return;
    const bucket = expenseBucket(categoryNameById(ledger.categories, e.category_id));
    const target =
      bucket === 'food' ? foodMap : bucket === 'pay' ? payMap : otherMap;
    target.set(mo, (target.get(mo) ?? 0) + cents);
  });

  const months: YearMonthlyRow[] = [];
  const totals = { income: 0, monthlyPayments: 0, food: 0, other: 0, net: 0 };
  let monthsWithData = 0;

  for (let m = 1; m <= 12; m++) {
    const income = incomeMap.get(m) ?? 0;
    const recurringTotal = monthlyPaymentsTotal(ledger, year, m);
    const monthlyPayments = (payMap.get(m) ?? 0) + recurringTotal;
    const food = foodMap.get(m) ?? 0;
    const other = otherMap.get(m) ?? 0;
    const net = income - (monthlyPayments + food + other);
    months.push({ month: m, income, monthlyPayments, food, other, net });
    totals.income += income;
    totals.monthlyPayments += monthlyPayments;
    totals.food += food;
    totals.other += other;
    totals.net += net;
    if (income || monthlyPayments || food || other) monthsWithData++;
  }

  const divisor = Math.max(1, monthsWithData);
  const average = {
    income: Math.round(totals.income / divisor),
    monthlyPayments: Math.round(totals.monthlyPayments / divisor),
    food: Math.round(totals.food / divisor),
    other: Math.round(totals.other / divisor),
    net: Math.round(totals.net / divisor),
  };

  return {
    year,
    months,
    totals,
    average,
    monthsWithData,
    goals: computeYearGoals(ledger, year),
  };
}

export function getHistoryYears(ledger: LocalBudgetLedger): number[] {
  const set = new Set<number>();
  for (const e of ledger.savingsIncome) {
    const y = Number(e.income_date.slice(0, 4));
    if (Number.isInteger(y) && y > 1900 && y < 4000) set.add(y);
  }
  for (const e of ledger.expenses) {
    const y = Number(e.expense_date.slice(0, 4));
    if (Number.isInteger(y) && y > 1900 && y < 4000) set.add(y);
  }
  // A plan that runs into next year gives that year history too.
  const planEnd = lastPlanMonth(ledger.expenses);
  if (planEnd) {
    const y = Number(planEnd.slice(0, 4));
    if (Number.isInteger(y) && y > 1900 && y < 4000) set.add(y);
  }
  return Array.from(set).sort((a, b) => b - a);
}

export function compareYears(ledger: LocalBudgetLedger, years: number[]): YearComparison {
  const uniqueYears = Array.from(new Set(years.filter((y) => Number.isInteger(y))))
    .sort((a, b) => a - b)
    .slice(-5);
  const histories = uniqueYears.map((y) => getYearHistory(ledger, y));
  const cols: YearComparisonColumn[] = histories.map((h) => ({
    year: h.year,
    totals: h.totals,
    average: h.average,
    monthsWithData: h.monthsWithData,
  }));

  const deltas: YearComparisonDelta[] = [];
  for (let i = 1; i < histories.length; i++) {
    const prev = histories[i - 1].totals;
    const cur = histories[i].totals;
    const netPct =
      prev.net !== 0 ? Math.round(((cur.net - prev.net) / Math.abs(prev.net)) * 100) : null;
    deltas.push({
      fromYear: histories[i - 1].year,
      toYear: histories[i].year,
      income: cur.income - prev.income,
      monthlyPayments: cur.monthlyPayments - prev.monthlyPayments,
      food: cur.food - prev.food,
      other: cur.other - prev.other,
      net: cur.net - prev.net,
      netPct,
    });
  }

  return {
    years: cols,
    deltas,
    netByYearMonth: histories.map((h) => ({
      year: h.year,
      months: h.months.map((m) => m.net),
    })),
  };
}

export function getRecurringApplyStatus(ledger: LocalBudgetLedger, year: number): RecurringApplyStatus {
  const active = activeRecurring(ledger);
  const currentCount = active.length;
  const currentTotalCents = active.reduce((sum, p) => sum + p.amount_cents, 0);

  const byPeriod = new Map<string, { appliedCents: number; appliedCount: number }>();
  for (const row of ledger.savingsSpending) {
    if (!row.recurring_payment_id || !row.period?.startsWith(`${year}-`)) continue;
    const hit = byPeriod.get(row.period) ?? { appliedCents: 0, appliedCount: 0 };
    hit.appliedCents += row.amount_cents;
    hit.appliedCount += 1;
    byPeriod.set(row.period, hit);
  }

  const months = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const scopedActive = active.filter((p) => isRecurringPaymentActiveInMonth(p, year, month));
    const scopedCount = scopedActive.length;
    const scopedTotalCents = scopedActive.reduce((sum, p) => sum + p.amount_cents, 0);
    const period = monthKey(year, month);
    const hit = byPeriod.get(period);
    const appliedCount = hit?.appliedCount ?? 0;
    const appliedCents = hit?.appliedCents ?? 0;
    const applied = appliedCount > 0;
    const matchesCurrent =
      applied && scopedCount > 0 && appliedCount === scopedCount && appliedCents === scopedTotalCents;
    return { month, applied, appliedCents, appliedCount, matchesCurrent };
  });

  return { year, currentCount, currentTotalCents, months };
}

export function getRecurringPaymentMonthlyHistory(
  ledger: LocalBudgetLedger,
  payment: SavingsRecurringPayment,
  year: number,
): RecurringPaymentMonthlyHistory {
  const byPeriod = new Map<string, number>();
  for (const row of ledger.savingsSpending) {
    if (row.recurring_payment_id !== payment.id || !row.period?.startsWith(`${year}-`)) continue;
    byPeriod.set(row.period, (byPeriod.get(row.period) ?? 0) + row.amount_cents);
  }

  const months = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const period = monthKey(year, month);
    const inScope = isRecurringPaymentActiveInMonth(payment, year, month);
    const applied = byPeriod.has(period);
    const appliedAmountCents = byPeriod.get(period) ?? null;
    return { month, inScope, applied, appliedAmountCents };
  });

  return {
    year,
    amountCents: payment.amount_cents,
    scopeType: payment.scope_type === 'custom_months' ? 'custom_months' : 'all_year',
    months,
  };
}

export function getRecurringYearlyGroupBreakdown(
  ledger: LocalBudgetLedger,
  year: number,
): RecurringYearlyGroupBreakdown {
  const items = activeRecurring(ledger);
  const loanIds = new Set(ledger.budgetLoans.map((l) => l.recurring_payment_id));
  const resolvedItems = items.map((item) => ({
    ...item,
    group_label: resolveRecurringGroupLabel(item.label, item.group_label, loanIds.has(item.id)),
  }));

  const groupKeys = new Set<string | null>();
  for (const item of resolvedItems) groupKeys.add(item.group_label ?? null);
  const groups = Array.from(groupKeys)
    .sort((a, b) => {
      if (a === b) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return a.localeCompare(b);
    })
    .map((group_label) => ({ group_label }));

  const months = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const groupTotals = new Map<string | null, number>();
    let totalCents = 0;
    for (const item of resolvedItems) {
      if (!isRecurringPaymentActiveInMonth(item, year, month)) continue;
      totalCents += item.amount_cents;
      const key = item.group_label ?? null;
      groupTotals.set(key, (groupTotals.get(key) ?? 0) + item.amount_cents);
    }
    const byGroup = groups.map((g) => ({
      group_label: g.group_label,
      subtotalCents: groupTotals.get(g.group_label) ?? 0,
    }));
    return { month, totalCents, byGroup };
  });

  return { year, groups, months };
}

/**
 * Median of a list of attainment percentages, rounded, or null when empty.
 *
 * Attainment is a RATIO and can go deeply negative — a household reported a
 * June at -122% of its goal — so the mean lands somewhere no month actually
 * sat. The median is what the Goal-performance card reports instead.
 */
function medianOf(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]!
    : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export function getProjection(
  ledger: LocalBudgetLedger,
  year: number,
  now: Date = new Date(),
  method: ProjectionMethod = DEFAULT_PROJECTION_METHOD,
): SavingsProjection {
  const history = getYearHistory(ledger, year);
  const nowYear = now.getUTCFullYear();
  const nowMonth = now.getUTCMonth() + 1;
  const currentMonth = year === nowYear ? nowMonth : null;

  const targetByMonth = new Map<number, number>();
  for (const [period, r] of targetsByPeriod(ledger)) {
    if (!period.startsWith(`${year}-`)) continue;
    const m = Number(period.slice(5, 7));
    if (Number.isInteger(m) && m >= 1 && m <= 12) targetByMonth.set(m, r.target_cents);
  }

  const oneOffByMonth = new Map<number, number>();
  for (const row of ledger.savingsIncome) {
    if (!row.income_date.startsWith(`${year}-`) || row.status === 'draft') continue;
    if (!isIrregularIncomeSource(row.source_type)) continue;
    const m = Number(row.income_date.slice(5, 7));
    oneOffByMonth.set(m, (oneOffByMonth.get(m) ?? 0) + row.amount_cents);
  }

  /**
   * Months the member has actually PUT SOMETHING IN — an income row or an
   * expense — as opposed to months that merely inherit a projection.
   *
   * Deliberately NOT `row.income || row.monthlyPayments || …` (the `hasData`
   * test below). `monthlyPayments` folds in `monthlyPaymentsTotal`, the
   * recurring-payment schedule, which lands on every future month by itself. A
   * household with recurring payments and no entries yet would look "filled in"
   * for the whole year ahead, and every one of those months would then project
   * as a large negative — its commitments with none of its income. Reading the
   * ledger directly keeps this to rows a person actually created.
   */
  const enteredMonths = new Set<number>();
  const spendLoggedMonths = new Set<number>();
  for (const row of ledger.savingsIncome) {
    if (!row.income_date.startsWith(`${year}-`) || row.status === 'draft') continue;
    enteredMonths.add(Number(row.income_date.slice(5, 7)));
  }
  for (const e of ledger.expenses) {
    if (!e.expense_date.startsWith(`${year}-`)) continue;
    const m = Number(e.expense_date.slice(5, 7));
    enteredMonths.add(m);
    spendLoggedMonths.add(m);
  }

  const statusOf = (m: number): 'actual' | 'current' | 'future' => {
    if (year < nowYear) return 'actual';
    if (year > nowYear) return 'future';
    if (m < nowMonth) return 'actual';
    return m === nowMonth ? 'current' : 'future';
  };

  const rows = history.months.map((row) => {
    const status = statusOf(row.month);
    const hasData =
      status === 'actual'
        ? row.monthlyPayments !== 0 || row.food !== 0 || row.other !== 0
        : row.income !== 0 || row.monthlyPayments !== 0 || row.food !== 0 || row.other !== 0;
    const oneOffIncome = oneOffByMonth.get(row.month) ?? 0;
    return { row, status, hasData, oneOffIncome, repeatableNet: row.net - oneOffIncome };
  });

  const completedWithData = rows.filter((r) => r.status === 'actual' && r.hasData);
  const paceSample = (
    completedWithData.length
      ? completedWithData
      : rows.filter((r) => r.status === 'current' && r.hasData)
  ).slice(-RECENT_PACE_MONTHS);
  const paceMonthly = paceSample.length
    ? Math.round(paceSample.reduce((s, r) => s + r.repeatableNet, 0) / paceSample.length)
    : 0;

  let bestMonth: { month: number; net: number } | null = null;
  for (const r of completedWithData) {
    if (!bestMonth || r.repeatableNet > bestMonth.net) {
      bestMonth = { month: r.row.month, net: r.repeatableNet };
    }
  }
  const excludesOneOffIncome = completedWithData.some((r) => r.oneOffIncome !== 0);
  const paceContribution = paceMonthly;
  const monthlyGoalContribution =
    history.goals.savingsMonthly != null && history.goals.savingsMonthly > 0
      ? history.goals.savingsMonthly
      : null;

  // Pre-pass: grade every elapsed/current month against its own target, if it
  // set one — independent of which METHOD is selected, so it can run before
  // the method dispatch below and feed `hybrid`'s reliability weight. Mirrors
  // `backend/src/services/savings-service.ts`'s `getProjection` exactly.
  const gradeByMonth = new Map<
    number,
    { goalDeltaCents: number | null; goalAttainmentPct: number | null; goalHit: boolean | null }
  >();
  for (const { row, status } of rows) {
    const targetCents = targetByMonth.get(row.month) ?? null;
    if (status !== 'future' && targetCents != null) {
      gradeByMonth.set(row.month, {
        goalDeltaCents: row.net - targetCents,
        goalHit: row.net >= targetCents,
        goalAttainmentPct: targetCents > 0 ? Math.round((row.net / targetCents) * 100) : null,
      });
    } else {
      gradeByMonth.set(row.month, { goalDeltaCents: null, goalAttainmentPct: null, goalHit: null });
    }
  }
  const trackedGrades = [...gradeByMonth.values()].filter((g) => g.goalHit != null);
  const monthsHit = trackedGrades.filter((g) => g.goalHit).length;
  const attainmentValues = trackedGrades
    .map((g) => g.goalAttainmentPct)
    .filter((v): v is number => v != null);
  const goalPerformance = {
    monthsTracked: trackedGrades.length,
    monthsHit,
    hitRatePct: trackedGrades.length ? Math.round((monthsHit / trackedGrades.length) * 100) : null,
    avgAttainmentPct: attainmentValues.length
      ? Math.round(attainmentValues.reduce((s, v) => s + v, 0) / attainmentValues.length)
      : null,
    medianAttainmentPct: medianOf(attainmentValues),
  };

  // ---- Method-specific building blocks (computed once, shared by all 4) ----

  // Trend: the most recent completed month plus its average month-over-month
  // change over the last TREND_WINDOW_MONTHS — continues the trajectory
  // forward instead of averaging it away.
  const trendSample = completedWithData.slice(-TREND_WINDOW_MONTHS);
  let trendMonthly = paceMonthly;
  if (trendSample.length >= 2) {
    let deltaSum = 0;
    for (let i = 1; i < trendSample.length; i++) {
      deltaSum += trendSample[i].repeatableNet - trendSample[i - 1].repeatableNet;
    }
    const avgDelta = deltaSum / (trendSample.length - 1);
    const mostRecent = trendSample[trendSample.length - 1].repeatableNet;
    trendMonthly = Math.round(mostRecent + avgDelta);
  }

  // Planned Budget: expected income (active recurring income templates, or
  // the recent repeatable-income average when none are set) minus that
  // month's active recurring payments minus that month's Planning-tab budget.
  const templatedIncomeMonthly = ledger.savingsIncomeTemplates
    .filter((t) => t.active)
    .reduce((s, t) => s + t.amount_cents, 0);
  const avgRecentIncome = completedWithData.length
    ? Math.round(
        completedWithData.reduce((s, r) => s + r.row.income, 0) / completedWithData.length,
      )
    : 0;
  const expectedIncomeMonthly = templatedIncomeMonthly > 0 ? templatedIncomeMonthly : avgRecentIncome;
  const plannedBudgetFor = (m: number): SavingsProjectionMonth['plannedBudget'] => {
    const spendGoal = history.goals.plannedBudgetByMonth[m - 1] ?? null;
    if (spendGoal == null || expectedIncomeMonthly === 0) return null;
    const recurringPaymentsCents = monthlyPaymentsTotal(ledger, year, m);
    return {
      expectedIncomeCents: expectedIncomeMonthly,
      recurringPaymentsCents,
      spendingGoalCents: spendGoal,
      netCents: expectedIncomeMonthly - recurringPaymentsCents - spendGoal,
    };
  };

  // `hybrid`'s reliability weight: how often the household has actually hit
  // its OWN past targets. No track record yet → an even 50/50 blend.
  const blendWeight = Math.min(1, Math.max(0, (goalPerformance.hitRatePct ?? 50) / 100));

  /** The untargeted-future-month fallback for one method, value + why. */
  const fallbackFor = (
    projMethod: ProjectionMethod,
    m: number,
  ): { value: number; source: 'goal' | 'pace' } => {
    if (projMethod === 'hybrid' && monthlyGoalContribution != null) {
      return { value: monthlyGoalContribution, source: 'goal' };
    }
    switch (projMethod) {
      case 'historical_average':
        return { value: paceMonthly, source: 'pace' };
      case 'trend':
        return { value: trendMonthly, source: 'pace' };
      case 'planned_budget': {
        const planned = plannedBudgetFor(m);
        return { value: planned?.netCents ?? paceMonthly, source: 'pace' };
      }
      case 'hybrid':
      default: {
        const planned = plannedBudgetFor(m);
        if (planned == null) return { value: paceMonthly, source: 'pace' };
        return {
          value: Math.round(planned.netCents * blendWeight + paceMonthly * (1 - blendWeight)),
          source: 'pace',
        };
      }
    }
  };

  /** One month's projected net + why, for whichever method is asked for. */
  const projectFor = (
    projMethod: ProjectionMethod,
    r: (typeof rows)[number],
  ): { value: number; source: SavingsProjectionMonth['projectionSource'] } => {
    const { row, status } = r;
    if (status === 'actual') return { value: row.net, source: null };
    const targetCents = targetByMonth.get(row.month) ?? null;
    if (status === 'current') {
      return { value: targetCents != null ? Math.max(row.net, targetCents) : row.net, source: null };
    }
    if (enteredMonths.has(row.month)) {
      // DATA BEATS PLAN. A month ahead the member has already filled in is
      // forecast from those rows, not from a goal or plan set months earlier.
      return { value: row.net, source: 'entered' };
    }
    if (targetCents != null) return { value: targetCents, source: 'target' };
    return fallbackFor(projMethod, row.month);
  };

  /**
   * Same decision tree as `projectFor`, but for the method-comparison cards:
   * skips the explicit monthly-target override on future months, so the four
   * cards show what each method's own formula actually forecasts rather than
   * all four converging on whatever target the household already typed in.
   * Actual/current/entered months are real data, not a method's guess, so
   * those still win regardless of method.
   */
  const compareValueFor = (projMethod: ProjectionMethod, r: (typeof rows)[number]): number => {
    const { row, status } = r;
    if (status === 'actual' || status === 'current') return row.net;
    if (enteredMonths.has(row.month)) return row.net;
    return fallbackFor(projMethod, row.month).value;
  };

  const months: SavingsProjectionMonth[] = rows.map((r) => {
    const { row, status, hasData, oneOffIncome } = r;
    const targetCents = targetByMonth.get(row.month) ?? null;
    const { value: projectedNet, source: projectionSource } = projectFor(method, r);
    const grade = gradeByMonth.get(row.month)!;

    return {
      month: row.month,
      status,
      // A future month the member filled in HAS a real figure, so surface it
      // rather than the null that means "nothing recorded". Left null for a
      // future month that only carries a plan.
      actualNet:
        status === 'future' ? (projectionSource === 'entered' ? row.net : null) : row.net,
      targetCents,
      projectedNet,
      projectionSource,
      hasData,
      // Only meaningful on an 'entered' month ahead: its income is in but its
      // spending is not, so the figure reads better than the month will land.
      spendingLogged: spendLoggedMonths.has(row.month),
      oneOffIncome:
        status === 'future' && projectionSource !== 'entered' ? 0 : oneOffIncome,
      plannedBudget: plannedBudgetFor(row.month),
      ...grade,
    };
  });

  const actualToDate = months
    .filter((m) => m.status === 'current' || (m.status === 'actual' && m.hasData))
    .reduce((s, m) => s + (m.actualNet ?? 0), 0);
  const futureMonths = months.filter((m) => m.status === 'future');
  const monthsRemaining = futureMonths.length;
  const monthsWithTarget = months.filter((m) => m.status !== 'actual' && m.targetCents != null).length;
  const targetedRemaining = months
    .filter((m) => m.status !== 'actual')
    .reduce((s, m) => s + (m.targetCents ?? 0), 0);
  const projectedYearEnd = months.reduce(
    (s, m) => s + (m.status === 'actual' ? (m.actualNet ?? 0) : m.projectedNet),
    0,
  );

  // Every method's year-end figure, for the Projection tab's picker cards —
  // via `compareValueFor` so an explicit monthly target (which overrides
  // `months`/`projectedYearEnd` above for whichever method is selected)
  // doesn't flatten all four cards to the same number.
  const methodComparison = PROJECTION_METHODS.map((m) => ({
    method: m,
    projectedYearEnd: rows.reduce((s, r) => s + compareValueFor(m, r), 0),
  }));

  const potentialMonthly = bestMonth ? Math.max(paceMonthly, bestMonth.net) : paceMonthly;

  return {
    year,
    currentMonth,
    months,
    actualToDate,
    targetedRemaining,
    monthsRemaining,
    monthsWithTarget,
    projectedYearEnd,
    paceMonthly,
    paceYearEnd: actualToDate + paceContribution * monthsRemaining,
    bestMonth,
    potentialMonthly,
    potentialYearEnd: actualToDate + potentialMonthly * monthsRemaining,
    excludesOneOffIncome,
    yearGoal: history.goals.savingsYearly,
    monthlyGoal: history.goals.savingsMonthly,
    goalPerformance,
    method,
    methodComparison,
  };
}

export function applyProjectionTargets(
  ledger: LocalBudgetLedger,
  data: SetProjectionTargetsRequest,
): LocalBudgetLedger {
  const { year, months, targetCents } = data;
  const unique = Array.from(new Set(months)).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12);
  const periods = new Set(unique.map((m) => monthKey(year, m)));

  if (targetCents === null) {
    ledger.savingsMonthlyTargets = ledger.savingsMonthlyTargets.filter((t) => !periods.has(t.period));
  } else {
    for (const m of unique) {
      const period = monthKey(year, m);
      // Patch every row for this period, not just the first: a concurrent set by
      // another member can legitimately leave two rows sharing a period, and
      // updating one while leaving the other would make targetsByPeriod's winner
      // depend on which row happened to be patched.
      const existing = ledger.savingsMonthlyTargets.filter((t) => t.period === period);
      if (existing.length > 0) {
        for (const row of existing) {
          row.target_cents = targetCents;
          row.updated_at = isoNow();
        }
      } else {
        ledger.savingsMonthlyTargets.push({
          id: newLocalId('smt'),
          period,
          target_cents: targetCents,
          updated_at: isoNow(),
        });
      }
    }
  }
  return ledger;
}

export function spendingDateForRecurring(year: number, month: number, dayOfMonth: number | null): string {
  const maxDay = new Date(year, month, 0).getDate();
  const rawDay = dayOfMonth && dayOfMonth >= 1 ? dayOfMonth : 1;
  const day = Math.min(rawDay, maxDay);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function hasRecurringApplied(
  ledger: LocalBudgetLedger,
  recurringPaymentId: string,
  period: string,
): boolean {
  return ledger.savingsSpending.some(
    (s) => s.recurring_payment_id === recurringPaymentId && s.period === period,
  );
}

export function hasTemplateApplied(
  ledger: LocalBudgetLedger,
  templateId: string,
  period: string,
): boolean {
  return ledger.savingsIncome.some((e) => e.template_id === templateId && e.period === period);
}

export function listSpendingInMonth(
  ledger: LocalBudgetLedger,
  year: number,
  month: number,
): SavingsSpendingEntry[] {
  return ledger.savingsSpending
    .filter((e) => dateInMonth(e.spending_date, year, month))
    .sort((a, b) => b.spending_date.localeCompare(a.spending_date));
}

export function listIncomeInMonth(
  ledger: LocalBudgetLedger,
  year: number,
  month: number,
): SavingsIncomeEntry[] {
  return ledger.savingsIncome
    .filter((e) => dateInMonth(e.income_date, year, month))
    .sort((a, b) => b.income_date.localeCompare(a.income_date));
}

export function resolveBudgetGoal(ledger: LocalBudgetLedger, year: number, month: number): BudgetGoal | null {
  return ledger.goals.find((g) => g.year === year && g.month === month) ?? null;
}

export function sumEssentialRecurring(ledger: LocalBudgetLedger, year: number, month: number): number {
  return activeRecurring(ledger)
    .filter((p) => p.is_essential && isRecurringPaymentActiveInMonth(p, year, month))
    .reduce((sum, p) => sum + p.amount_cents, 0);
}

export function expensesInMonth(ledger: LocalBudgetLedger, year: number, month: number): Expense[] {
  return ledger.expenses.filter((e) => expenseInMonth(e.expense_date, year, month));
}

export function goalWithPace(goal: SavingsGoal): SavingsGoal {
  if (!goal.target_date || goal.status !== 'active') return goal;
  const target = new Date(goal.target_date);
  const now = new Date();
  const monthsLeft = Math.max(
    1,
    (target.getUTCFullYear() - now.getUTCFullYear()) * 12 +
      (target.getUTCMonth() - now.getUTCMonth()),
  );
  const remaining = Math.max(0, goal.target_amount_cents - goal.current_amount_cents);
  return { ...goal, paceCents: Math.round(remaining / monthsLeft) };
}
