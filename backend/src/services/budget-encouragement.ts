/**
 * Smart Budget — encouragement ("Budget Wins") layer.
 *
 * The positive counterpart to budget-insights-service.ts. Where insights are the
 * AI advisor (overspend warnings, reprioritization), this module produces short,
 * upbeat reinforcement that nudges the household to keep spending under control:
 * "a no-spend week", "you're ahead of your pace", "your savings keep growing".
 *
 * Same neuro-symbolic principle as budget-affordability.ts: every dollar figure
 * is computed HERE, deterministically, from recorded spend and the monthly cap —
 * never invented by a model. That keeps the copy trustworthy and lets it render
 * instantly (and offline) on the dashboard without an AI round-trip, and lets the
 * weekly notification decide honestly whether there's a real "win" worth pushing.
 *
 * All money values are in CENTS.
 */

import { and, eq, gte, lt } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';

import { budgetGoals, expenses } from '../db/schema-budget';
import type { Env } from '../types';

import { BudgetService, totalSpendBetween } from './budget-service';

export type BudgetEncouragementTone = 'celebrate' | 'positive' | 'neutral' | 'watch' | 'tip';

export interface BudgetEncouragement {
  tone: BudgetEncouragementTone;
  emoji: string;
  headline: string;
  message: string;
  /** Short stat for a pill, e.g. "$120 saved this month". Null when not meaningful. */
  highlight: string | null;

  // ---- Raw signals (cents), so the client can style/re-derive if it wants ----
  plannedBudgetCents: number;
  actualSpentCents: number;
  remainingBudgetCents: number;
  /** round(plannedBudget * dayOfMonth/daysInMonth) − actualSpent. null when no cap / not the live month. Positive = ahead. */
  paceSavingsCents: number | null;
  spentThisWeekCents: number;
  spentLastWeekCents: number;
  /** thisWeek − lastWeek. Negative = spending down. null when there's no prior-week baseline. */
  weekOverWeekDeltaCents: number | null;
  /** Cumulative (plannedBudget − actualSpent) over months this year that had a cap and came in under it. */
  ytdSavingsCents: number;
  /** Consecutive completed months (most recent first) that had a cap and finished at/under it. */
  monthsUnderBudgetStreak: number;

  /** True when this is a genuine win — the gate for sending a push notification. */
  isPositive: boolean;
}

export interface EncouragementInput {
  monthPosition: 'current' | 'past' | 'future';
  monthName: string;
  plannedBudget: number;
  actualSpent: number;
  remainingBudget: number;
  spentThisWeek: number;
  spentLastWeek: number;
  hasSpendHistory: boolean;
  ytdSavings: number;
  monthsUnderBudgetStreak: number;
  /** 1-based day of the current month; used for pace + copy variety. */
  dayOfMonth: number;
  daysInMonth: number;
}

/** Whole-dollar string with a thousands separator, e.g. 152340 → "$1,523". */
function money(cents: number): string {
  const dollars = Math.round(Math.abs(cents) / 100);
  return `$${dollars.toLocaleString('en-US')}`;
}

/** Deterministic rotation through a copy pool (seeded by the day, so it changes without randomness). */
function pick(pool: string[], seed: number): string {
  return pool[((seed % pool.length) + pool.length) % pool.length];
}

const MEANINGFUL_WEEK = 1000; // $10 week-over-week swing
const MEANINGFUL_YTD = 2500; // $25 cumulative savings

/**
 * Pure decision function: turn the already-computed spend signals into one
 * upbeat (or gently honest) card. No I/O, fully unit-testable.
 */
export function computeBudgetEncouragement(input: EncouragementInput): BudgetEncouragement {
  const {
    monthPosition,
    monthName,
    plannedBudget,
    actualSpent,
    remainingBudget,
    spentThisWeek,
    spentLastWeek,
    hasSpendHistory,
    ytdSavings,
    monthsUnderBudgetStreak,
    dayOfMonth,
    daysInMonth,
  } = input;

  const hasBudget = plannedBudget > 0;
  const paceSavings =
    monthPosition === 'current' && hasBudget
      ? Math.round(plannedBudget * (dayOfMonth / daysInMonth)) - actualSpent
      : null;
  const weekOverWeekDelta = spentLastWeek > 0 ? spentThisWeek - spentLastWeek : null;
  const meaningfulPace = Math.max(1000, Math.round(plannedBudget * 0.05));

  const base = {
    plannedBudgetCents: plannedBudget,
    actualSpentCents: actualSpent,
    remainingBudgetCents: remainingBudget,
    paceSavingsCents: paceSavings,
    spentThisWeekCents: spentThisWeek,
    spentLastWeekCents: spentLastWeek,
    weekOverWeekDeltaCents: weekOverWeekDelta,
    ytdSavingsCents: ytdSavings,
    monthsUnderBudgetStreak,
  };

  const out = (
    tone: BudgetEncouragementTone,
    emoji: string,
    headline: string,
    message: string,
    highlight: string | null
  ): BudgetEncouragement => ({
    ...base,
    tone,
    emoji,
    headline,
    message,
    highlight,
    isPositive: tone === 'celebrate' || tone === 'positive',
  });

  // A savings pill to hang off a positive card, strongest signal first.
  const savingsHighlight = (): string | null => {
    if (paceSavings !== null && paceSavings >= meaningfulPace) return `${money(paceSavings)} under pace`;
    if (ytdSavings >= MEANINGFUL_YTD) return `${money(ytdSavings)} saved this year`;
    return null;
  };

  // ---- Past / future months: reflect, don't project a live pace ----
  if (monthPosition === 'past') {
    if (!hasBudget) {
      return out('tip', '🗓️', `${monthName} wrapped up`, `No budget was set for ${monthName}, so there's nothing to compare against.`, null);
    }
    const finalSavings = plannedBudget - actualSpent;
    if (finalSavings >= 0) {
      return out(
        'celebrate',
        '🏆',
        `You finished ${monthName} under budget`,
        `You spent ${money(actualSpent)} of your ${money(plannedBudget)} budget — ${money(finalSavings)} to spare. Nicely done.`,
        `${money(finalSavings)} under budget`
      );
    }
    return out(
      'neutral',
      '📊',
      `${monthName} ran a little over`,
      `${monthName} came in ${money(-finalSavings)} over the ${money(plannedBudget)} budget. This month's a fresh start.`,
      null
    );
  }

  if (monthPosition === 'future') {
    return out(
      'tip',
      '🎯',
      `Plan ahead for ${monthName}`,
      hasBudget
        ? `${monthName} has a ${money(plannedBudget)} budget set. Nothing spent yet — you're starting clean.`
        : `Set a budget for ${monthName} and I'll help you stay ahead of it.`,
      null
    );
  }

  // ---- Current month ----
  if (!hasBudget) {
    if (actualSpent > 0) {
      return out(
        'neutral',
        '📊',
        `You've spent ${money(actualSpent)} this month`,
        `Set a monthly budget in Settings and I'll show you how much you're saving as it grows.`,
        null
      );
    }
    return out(
      'tip',
      '🎯',
      'Set a monthly budget',
      `Add a monthly cap in Settings and I'll cheer you on as your savings grow.`,
      null
    );
  }

  // Over budget — stay honest, but frame it as recoverable rather than alarming.
  if (remainingBudget < 0) {
    return out(
      'watch',
      '🧭',
      'A little over this month',
      `You're ${money(-remainingBudget)} past your ${money(plannedBudget)} budget. Easing off this week gets you back on track.`,
      null
    );
  }

  // 1) A genuine no-spend week (only if the household normally spends).
  if (spentThisWeek === 0 && hasSpendHistory) {
    return out(
      'celebrate',
      '🎉',
      pick(['A no-spend week!', 'Zero spending this week', 'Nothing spent this week'], dayOfMonth),
      `You haven't logged any spending in the last 7 days — that restraint really adds up.`,
      savingsHighlight()
    );
  }

  // 2) Meaningfully ahead of the month's spending pace. Requires real spend
  //    history — a brand-new household that just set a cap and logged nothing
  //    hasn't "saved" anything yet, so it falls through to the honest on-track card.
  if (paceSavings !== null && paceSavings >= meaningfulPace && hasSpendHistory) {
    return out(
      'celebrate',
      '💪',
      pick(["You're ahead of budget", 'Great pace this month', "You're spending smart"], dayOfMonth),
      `You've spent ${money(actualSpent)} of your ${money(plannedBudget)} budget — about ${money(paceSavings)} less than your usual pace this far in. Keep it going!`,
      `${money(paceSavings)} under pace`
    );
  }

  // 3) Spending trending down week over week.
  if (weekOverWeekDelta !== null && weekOverWeekDelta <= -MEANINGFUL_WEEK) {
    return out(
      'positive',
      '📉',
      'Spending is trending down',
      `You spent ${money(spentThisWeek)} this week — ${money(-weekOverWeekDelta)} less than the week before. Nice momentum.`,
      `${money(-weekOverWeekDelta)} less this week`
    );
  }

  // 4) Cumulative savings story ("your savings keep growing").
  if (ytdSavings >= MEANINGFUL_YTD) {
    const streakBit =
      monthsUnderBudgetStreak >= 2 ? ` That's ${monthsUnderBudgetStreak} months under budget in a row.` : '';
    return out(
      'positive',
      '🌱',
      'Your savings keep growing',
      `You've stayed under budget and set aside about ${money(ytdSavings)} so far this year.${streakBit}`,
      `${money(ytdSavings)} saved this year`
    );
  }

  // 5) Quietly on track.
  return out(
    'neutral',
    '👍',
    "You're on track",
    `${money(remainingBudget)} left of your ${money(plannedBudget)} budget this month. Steady as she goes.`,
    remainingBudget > 0 ? `${money(remainingBudget)} left` : null
  );
}

/** Format a Date to a UTC calendar day (YYYY-MM-DD) — the shape expense_date is compared against. */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDaysUTC(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export class BudgetEncouragementService {
  private db: DrizzleD1Database;
  private d1: D1Database;
  private budgetService: BudgetService;

  constructor(env: Env, d1: D1Database) {
    this.d1 = d1;
    this.db = drizzle(d1);
    this.budgetService = new BudgetService(env, d1);
  }

  /**
   * Gather the deterministic spend signals for `year`/`month` and turn them into
   * one encouragement card. `getMonthlyOverview` performs the household-access
   * check, so this is safe to expose directly to a route with the caller's userId.
   */
  async getEncouragement(
    householdId: string,
    userId: string,
    year: number,
    month: number,
    now: Date = new Date()
  ): Promise<BudgetEncouragement> {
    const overview = await this.budgetService.getMonthlyOverview(householdId, userId, year, month);

    const nowYear = now.getUTCFullYear();
    const nowMonth = now.getUTCMonth() + 1;
    const monthPosition: EncouragementInput['monthPosition'] =
      year === nowYear && month === nowMonth
        ? 'current'
        : year < nowYear || (year === nowYear && month < nowMonth)
          ? 'past'
          : 'future';

    // Rolling 7-day windows: [weekAgo, tomorrow) is "this week" (inclusive of today),
    // [twoWeeksAgo, weekAgo) is "last week". Only relevant for the live month.
    let spentThisWeek = 0;
    let spentLastWeek = 0;
    if (monthPosition === 'current') {
      const tomorrow = ymd(addDaysUTC(now, 1));
      const weekAgo = ymd(addDaysUTC(now, -6));
      const twoWeeksAgo = ymd(addDaysUTC(now, -13));
      [spentThisWeek, spentLastWeek] = await Promise.all([
        totalSpendBetween(this.d1, householdId, weekAgo, tomorrow),
        totalSpendBetween(this.d1, householdId, twoWeeksAgo, weekAgo),
      ]);
    }

    const { ytdSavings, streak, ytdSpent } = await this.computeYearToDate(householdId, year, month);

    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    return computeBudgetEncouragement({
      monthPosition,
      monthName: MONTH_NAMES[month - 1] ?? `Month ${month}`,
      plannedBudget: overview.plannedBudget,
      actualSpent: overview.actualSpent,
      remainingBudget: overview.remainingBudget,
      spentThisWeek,
      spentLastWeek,
      hasSpendHistory: ytdSpent > 0 || overview.actualSpent > 0 || spentLastWeek > 0,
      ytdSavings,
      monthsUnderBudgetStreak: streak,
      dayOfMonth: now.getUTCDate(),
      daysInMonth,
    });
  }

  /**
   * Cumulative under-budget savings and the current under-budget streak for the
   * calendar year up to (and including) `throughMonth`. Two queries — all of the
   * year's caps and all of the year's expenses — bucketed in JS.
   */
  private async computeYearToDate(
    householdId: string,
    year: number,
    throughMonth: number
  ): Promise<{ ytdSavings: number; streak: number; ytdSpent: number }> {
    const lastMonth = Math.min(12, Math.max(1, throughMonth));
    const yearStart = `${year}-01-01`;
    const endYear = lastMonth === 12 ? year + 1 : year;
    const endMonth = lastMonth === 12 ? 1 : lastMonth + 1;
    const yearEndExclusive = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

    const [goals, yearExpenses] = await Promise.all([
      this.db
        .select({ month: budgetGoals.month, planned: budgetGoals.planned_budget })
        .from(budgetGoals)
        .where(and(eq(budgetGoals.household_id, householdId), eq(budgetGoals.year, year)))
        .all(),
      this.db
        .select({ date: expenses.expense_date, amount: expenses.amount })
        .from(expenses)
        .where(
          and(
            eq(expenses.household_id, householdId),
            gte(expenses.expense_date, yearStart),
            lt(expenses.expense_date, yearEndExclusive)
          )
        )
        .all(),
    ]);

    const plannedByMonth = new Map<number, number>();
    for (const g of goals) {
      if (g.month != null && g.planned != null) plannedByMonth.set(g.month, g.planned);
    }

    const spentByMonth = new Map<number, number>();
    let ytdSpent = 0;
    for (const e of yearExpenses) {
      const m = Number(e.date.slice(5, 7));
      if (!Number.isFinite(m)) continue;
      spentByMonth.set(m, (spentByMonth.get(m) ?? 0) + e.amount);
      ytdSpent += e.amount;
    }

    let ytdSavings = 0;
    for (let m = 1; m <= lastMonth; m++) {
      const planned = plannedByMonth.get(m);
      if (planned == null) continue;
      const spent = spentByMonth.get(m) ?? 0;
      if (planned > spent) ytdSavings += planned - spent;
    }

    // Streak over COMPLETED months only (current month is still in flight), most
    // recent first. A month with no cap, or one that ran over, breaks the run.
    let streak = 0;
    for (let m = lastMonth - 1; m >= 1; m--) {
      const planned = plannedByMonth.get(m);
      if (planned == null) break;
      const spent = spentByMonth.get(m) ?? 0;
      if (spent <= planned) streak++;
      else break;
    }

    return { ytdSavings, streak, ytdSpent };
  }
}

export { MONTH_NAMES };
