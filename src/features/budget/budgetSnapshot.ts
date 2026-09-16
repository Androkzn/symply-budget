/**
 * Budget → App Group snapshot publishers for the iOS home-screen widget and the
 * Apple Watch companion.
 *
 * Both native surfaces read JSON out of the shared App Group. Until 2026-07-20
 * neither was ever fed:
 *
 *   - `widget_budget_summary` was written only by `BudgetHomeScreen`, which
 *     `app/(tabs)/index.tsx` replaced with `BudgetNavigator` — so the sole
 *     writer was never mounted and the widget rendered its placeholder forever.
 *   - `watch_budget_today` had **no** writer at all, so `SymplyBudgetWatchView`
 *     was permanently stuck on "No budget yet." Kaizen already had a working
 *     publisher (`src/features/kaizen/services/kaizenWidgetSnapshot.ts`, which
 *     this module mirrors); Language and Health still do not — their
 *     `watch_language_today` / `watch_health_today` keys remain unwritten and
 *     their watch views are still dead. Tracked in platform.md.
 *
 * The two payloads are deliberately NOT the same shape — see the note on units
 * below. Matrix: BUDGET-WIDGET-001…009, BUDGET-WATCH-001…007.
 */
import { useEffect } from 'react';

import type { MonthlyOverview } from '@api/budget';
// Imported from the capability source rather than the `@features/budget` barrel:
// the barrel warns about require cycles, and consumers routinely partial-mock it
// (a mock without `isBudgetBrand` would break every screen importing this file).
import { isFullBudget } from '@brand/capabilities';
import { widgetSync } from '@services/widget-sync';
import { currentCurrency, subscribeToDisplayCurrency } from '@utils/money';

/** App Group key read by `SymplyBudgetWidgetContent.swift`. */
export const BUDGET_WIDGET_KEY = 'widget_budget_summary';
/** App Group key read by `SymplyBudgetWatchView.swift`. */
export const BUDGET_WATCH_KEY = 'watch_budget_today';

/**
 * Widget payload. `BudgetSummary` decodes with `.convertFromSnakeCase`, so every
 * key here MUST be snake_case — a camelCase key decodes to `nil` and blanks the
 * widget silently.
 *
 * Units: **integer cents**. `BudgetFormat.money(_ cents: Int, …)` divides by 100
 * itself, so publishing major units would under-report by 100x.
 */
export interface BudgetWidgetSnapshot {
  remaining_cents: number;
  spent_cents: number;
  budget_cents: number;
  currency?: string;
  top_category?: string;
  next_bill?: { name: string; amount_cents: number; due?: string };
  period_label?: string;
  /** This month's net savings (income − payments − spendings), in cents. */
  savings_cents?: number;
  /** Prior month's net savings, in cents — powers the "vs last month" trend. */
  savings_prev_cents?: number;
  /**
   * Full-year projection under the household's chosen Projection method
   * (Savings → Projection → "Set as household default"), in cents.
   */
  projected_year_end_cents?: number;
  /** Server-composed AI "Budget Wins" message, from `BudgetEncouragement`. */
  insight_tone?: string;
  insight_message?: string;
  insight_emoji?: string;
}

/**
 * Watch payload. `BudgetToday` uses explicit `CodingKeys` (no key strategy), so
 * `remaining` / `spent` / `budget` stay bare and the rest are snake_case.
 *
 * Units: **major units as Double**. `SymplyBudgetWatchView.currency(_ value:)`
 * formats the number directly with no division. This divergence from the widget
 * is intentional and is asserted by BUDGET-WATCH-003.
 */
export interface BudgetWatchSnapshot {
  remaining: number;
  spent: number;
  budget: number;
  currency_code?: string;
  period_label?: string;
  next_bill_name?: string;
  next_bill_amount?: number;
  next_bill_due?: string;
  /** Full-year projection under the household's chosen method, major units. */
  projected_year_end?: number;
}

export interface BudgetSnapshotContext {
  /** Human label for the period, e.g. "July 2026". */
  periodLabel?: string;
  /** ISO-4217 code. Both surfaces fall back to USD / device locale when absent. */
  currency?: string;
  /** Highest-spend category name, widget only. */
  topCategory?: string;
  /** Next upcoming bill, if any. Amount is in cents at the call site. */
  nextBill?: { name: string; amountCents: number; due?: string } | null;
  /**
   * This month's net savings, in cents (`SavingsOverview.netSavings`). Widget
   * only — the watch payload does not carry savings. Kept as a flat primitive
   * (not a nested object) so it is stable across renders in the publisher
   * hook's dependency array.
   */
  savingsCurrentCents?: number | null;
  /** Prior month's net savings, in cents — powers the widget's trend line. */
  savingsPreviousCents?: number | null;
  /**
   * Full-year projection under the household's chosen Projection method, in
   * cents. Both surfaces — widget and watch, unlike `savingsCurrentCents`
   * which is widget-only.
   */
  projectedYearEndCents?: number | null;
  /** Tone of the latest AI "Budget Wins" message (`BudgetEncouragement.tone`). */
  insightTone?: string | null;
  insightMessage?: string | null;
  insightEmoji?: string | null;
}

/** Cents → major units, rounded to 2dp so JSON does not carry float noise. */
function toMajorUnits(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * Build the widget payload. Amounts pass through as cents.
 *
 * Optional fields are omitted rather than set to `undefined`/`null` so the JSON
 * stays minimal; `BudgetSummary`'s optionals tolerate their absence.
 */
export function buildBudgetWidgetSnapshot(
  overview: MonthlyOverview,
  ctx: BudgetSnapshotContext = {}
): BudgetWidgetSnapshot {
  const snapshot: BudgetWidgetSnapshot = {
    remaining_cents: Math.round(overview.remainingBudget),
    spent_cents: Math.round(overview.actualSpent),
    budget_cents: Math.round(overview.plannedBudget),
  };

  if (ctx.currency) snapshot.currency = ctx.currency;
  if (ctx.topCategory) snapshot.top_category = ctx.topCategory;
  if (ctx.periodLabel) snapshot.period_label = ctx.periodLabel;
  if (ctx.nextBill) {
    snapshot.next_bill = {
      name: ctx.nextBill.name,
      amount_cents: Math.round(ctx.nextBill.amountCents),
      ...(ctx.nextBill.due ? { due: ctx.nextBill.due } : {}),
    };
  }
  if (ctx.savingsCurrentCents != null) {
    snapshot.savings_cents = Math.round(ctx.savingsCurrentCents);
  }
  if (ctx.savingsPreviousCents != null) {
    snapshot.savings_prev_cents = Math.round(ctx.savingsPreviousCents);
  }
  if (ctx.projectedYearEndCents != null) {
    snapshot.projected_year_end_cents = Math.round(ctx.projectedYearEndCents);
  }
  if (ctx.insightTone) snapshot.insight_tone = ctx.insightTone;
  if (ctx.insightMessage) snapshot.insight_message = ctx.insightMessage;
  if (ctx.insightEmoji) snapshot.insight_emoji = ctx.insightEmoji;

  return snapshot;
}

/**
 * Build the watch payload. Amounts are converted to major units.
 *
 * `remaining` is intentionally NOT clamped at zero — the watch view renders an
 * "Over budget" state from a negative value (BUDGET-WATCH-004).
 */
export function buildBudgetWatchSnapshot(
  overview: MonthlyOverview,
  ctx: BudgetSnapshotContext = {}
): BudgetWatchSnapshot {
  const snapshot: BudgetWatchSnapshot = {
    remaining: toMajorUnits(overview.remainingBudget),
    spent: toMajorUnits(overview.actualSpent),
    budget: toMajorUnits(overview.plannedBudget),
  };

  if (ctx.currency) snapshot.currency_code = ctx.currency;
  if (ctx.periodLabel) snapshot.period_label = ctx.periodLabel;
  if (ctx.nextBill) {
    snapshot.next_bill_name = ctx.nextBill.name;
    snapshot.next_bill_amount = toMajorUnits(ctx.nextBill.amountCents);
    if (ctx.nextBill.due) snapshot.next_bill_due = ctx.nextBill.due;
  }
  if (ctx.projectedYearEndCents != null) {
    snapshot.projected_year_end = toMajorUnits(ctx.projectedYearEndCents);
  }

  return snapshot;
}

/**
 * Last payload handed to `publishBudgetSnapshots`, so the display currency can
 * be re-applied to it later without a screen being mounted (see
 * `startBudgetSnapshotWatcher`). Read for its figures only — a republish always
 * resolves the currency fresh rather than replaying the code cached here, which
 * is the stale value it exists to correct.
 *
 * Household-scoped data, so `startBudgetSnapshotWatcher`'s stop function drops
 * it: a second member signing in on the same handset must not be able to
 * re-publish the first member's balances by changing a preference.
 */
let lastPublished: {
  overview: MonthlyOverview;
  ctx: BudgetSnapshotContext;
} | null = null;

/**
 * Write both snapshots to the App Group. Safe to call on any platform — the
 * native module is a no-op when unlinked (Android / Jest).
 *
 * The currency falls back to the Settings → Currency preference when the caller
 * does not supply one. Neither surface can read the store: the widget defaults
 * to USD (`BudgetBrief.currency`) and the watch to the device locale, so an
 * omitted code is not a neutral default — it silently renders every figure in
 * the wrong currency (BUDGET-WIDGET-021).
 */
export function publishBudgetSnapshots(
  overview: MonthlyOverview,
  ctx: BudgetSnapshotContext = {}
): void {
  lastPublished = { overview, ctx };
  const resolved: BudgetSnapshotContext = {
    ...ctx,
    currency: ctx.currency ?? currentCurrency().code,
  };
  widgetSync.setSnapshot(BUDGET_WIDGET_KEY, buildBudgetWidgetSnapshot(overview, resolved));
  widgetSync.setSnapshot(BUDGET_WATCH_KEY, buildBudgetWatchSnapshot(overview, resolved));
}

/**
 * Re-emit the last published figures under the CURRENT display currency.
 *
 * No-op until something has been published — a republish is a refresh of known
 * data, never a first write, so it can never put zeros on either surface.
 */
export function republishBudgetSnapshots(): boolean {
  if (!lastPublished || !isFullBudget()) return false;
  publishBudgetSnapshots(lastPublished.overview, {
    ...lastPublished.ctx,
    currency: currentCurrency().code,
  });
  return true;
}

/**
 * Keep the widget and the Watch face in step with Settings → Currency for as
 * long as the app is running, not just while the Budget dashboard is on screen.
 *
 * The publisher hook below only fires from a mounted `BudgetDashboardView`, and
 * the currency is picked several screens away in Settings — so the change landed
 * with no writer listening and the home screen kept rendering "US$" until the
 * dashboard happened to re-render. Install from `app/_layout.tsx`; the returned
 * stop function also drops the cached household figures.
 */
export function startBudgetSnapshotWatcher(): () => void {
  const unsubscribe = subscribeToDisplayCurrency(() => {
    republishBudgetSnapshots();
  });
  return () => {
    unsubscribe();
    lastPublished = null;
  };
}

/**
 * Publish whenever the loaded overview or period changes.
 *
 * Local-first: `BudgetDashboardView` loads overview via `budgetApi.getMonthlyOverview`,
 * which proxies to `localBudgetApi` when `EXPO_PUBLIC_BUDGET_LOCAL_FIRST` is on — so
 * widget/watch snapshots stay on-device projections without a separate remote path.
 *
 * Publishes nothing while `overview` is null — a zeroed snapshot would flash
 * "$0 remaining" on both surfaces before real data lands (BUDGET-WIDGET-004 /
 * BUDGET-WATCH-006). Gated to the Budget brand so House's minimal-budget mode,
 * which renders the same dashboard, does not overwrite the keys.
 */
export function useBudgetSnapshotPublisher(
  overview: MonthlyOverview | null,
  ctx: BudgetSnapshotContext = {}
): void {
  const {
    periodLabel,
    currency,
    topCategory,
    nextBill,
    savingsCurrentCents,
    savingsPreviousCents,
    projectedYearEndCents,
    insightTone,
    insightMessage,
    insightEmoji,
  } = ctx;

  useEffect(() => {
    if (!overview || !isFullBudget()) return;
    publishBudgetSnapshots(overview, {
      periodLabel,
      currency,
      topCategory,
      nextBill,
      savingsCurrentCents,
      savingsPreviousCents,
      projectedYearEndCents,
      insightTone,
      insightMessage,
      insightEmoji,
    });
  }, [
    overview,
    periodLabel,
    currency,
    topCategory,
    nextBill,
    savingsCurrentCents,
    savingsPreviousCents,
    projectedYearEndCents,
    insightTone,
    insightMessage,
    insightEmoji,
  ]);
}
