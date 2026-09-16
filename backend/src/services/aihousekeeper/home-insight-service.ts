/**
 * HomeInsightService — the brain behind Mira's Home hero banner.
 *
 * The Home screen renders a single, glanceable card fronting the AI
 * housekeeper. Rather than a static greeting (or a once-a-day prose brief that
 * can't be acted on), this service answers "what is the ONE most important
 * thing about your home right now?" and hands the client a fully-composed,
 * actionable insight: a headline, a Mira-voice sentence, a severity tone, a
 * due-date + relative days counter, and a single deep-link CTA.
 *
 * Design choices:
 *  - Deterministic, not an AI call. The banner renders on every Home visit; a
 *    per-load LLM call would be slow, costly, and rate-limited. Instead we
 *    gather cheap deterministic signals across domains, score them by urgency ×
 *    importance, and pick the top one. This is always fast, always available,
 *    and unit-testable. (The richer AI daily brief still lives in the briefing
 *    pipeline for prose.)
 *  - Thin frontend: ALL copy, money/date formatting, ranking and routing lives
 *    here. The client renders the card verbatim and navigates to `cta.route`.
 *  - Timezone-correct: greeting + "days until due" are computed in the
 *    household's local day, from a `tz` passed by the client (device zone),
 *    falling back to the assistant identity timezone, then UTC.
 *
 * Signals gathered (each isolated so one failing source never blanks the hero):
 *  - Tasks       — overdue / due today / due tomorrow / due this week
 *  - Utility bills — unpaid, overdue or due soon
 *  - Property tax — unpaid main payment, overdue or due soon
 *  - Garbage      — next collection today or tomorrow (set-out reminder)
 *  - Budget       — this month's budget overspent
 *
 * When nothing is pressing, the hero returns a warm "all clear" (calm/celebrate)
 * state so it always speaks.
 */
import { and, asc, eq, isNull, lte } from 'drizzle-orm';

import { assistantIdentity } from '../../db/schema-aihousekeeper';
import { utilityBills, propertyTaxes } from '../../db/schema-utilities';
import type { Database, Env } from '../../types';
import type { TaskResponse, TaskPrioritySeverity } from '../../types';
import { BudgetService } from '../budget-service';
import { GarbageCollectionService } from '../garbage-collection-service';
import { SAVINGS_LIMITS } from '../savings-limits';
import { SavingsService } from '../savings-service';
import { TaskService } from '../task-service';

// ---------- public shape (mirrored in the client's types) ----------

export type InsightTone = 'urgent' | 'attention' | 'info' | 'calm' | 'celebrate';

export interface InsightCta {
  /** Button copy, e.g. "Review task". */
  label: string;
  /** expo-router path the client pushes, e.g. "/tasks". */
  route: string;
  /** Optional route params. */
  params?: Record<string, string>;
}

export interface InsightChip {
  /** Ionicons name. */
  icon: string;
  /** Short label, e.g. "Gas bill". */
  label: string;
  /** Relative timing, e.g. "in 3 days" / "2 days overdue", or null. */
  dueLabel: string | null;
}

export interface HomeInsight {
  /** Time-of-day greeting computed in the household's zone, e.g. "Good evening". */
  greeting: string;
  /** Short headline, e.g. "1 task overdue". */
  title: string;
  /** Mira-voice sentence including the relative days counter. */
  message: string;
  tone: InsightTone;
  /** Ionicons name for the card accent. */
  icon: string;
  /** Relative due label for the primary signal, e.g. "Due tomorrow". */
  dueLabel: string | null;
  /** ISO date (YYYY-MM-DD) of the primary signal's due date, or null. */
  dueDate: string | null;
  /** Single deep-link action, or null (card falls back to opening Mira chat). */
  cta: InsightCta | null;
  /** How many things need attention right now (drives an optional badge). */
  attentionCount: number;
  /** Up to 3 secondary signals shown as compact chips. */
  chips: InsightChip[];
  /** ISO timestamp this insight was composed. */
  generatedAt: string;
}

// ---------- internal signal model ----------

interface Signal {
  /** Higher = more pressing. Ranker picks the max. */
  score: number;
  tone: InsightTone;
  icon: string;
  title: string;
  message: string;
  dueDate: string | null;
  dueLabel: string | null;
  /** Compact chip representation when this signal is not the primary. */
  chip: InsightChip;
  cta: InsightCta | null;
  /** Number of underlying items (e.g. 3 overdue tasks). */
  count: number;
  /** Whether this counts toward attentionCount (garbage is informational). */
  attention: boolean;
}

const PRIORITY_BOOST: Record<TaskPrioritySeverity, number> = {
  nice_to_have: 0,
  low: 1,
  medium: 4,
  high: 8,
  urgent: 11,
  critical: 14,
};

const BILL_TYPE_LABEL: Record<string, string> = {
  electricity: 'Electricity bill',
  gas: 'Gas bill',
  water: 'Water bill',
  sewer: 'Sewer bill',
  garbage: 'Garbage bill',
  other: 'Utility bill',
};

export class HomeInsightService {
  private db: Database;
  private env: Env;

  constructor(env: Env, db: Database) {
    this.env = env;
    this.db = db;
  }

  /**
   * Compose the Home hero insight for a household. Membership is assumed to
   * have been checked by the caller (route middleware).
   */
  async getInsight(
    householdId: string,
    userId: string,
    opts: { tz?: string; nowMs: number }
  ): Promise<HomeInsight> {
    const tz = await this.resolveTimezone(householdId, opts.tz);
    const today = localDateISO(tz, opts.nowMs);
    const greeting = greetingForHour(localHour(tz, opts.nowMs));

    // Gather every source independently; a rejection just contributes nothing.
    const gathered = await Promise.allSettled([
      this.gatherTasks(householdId, userId, today),
      this.gatherBills(householdId, today),
      this.gatherPropertyTax(householdId, today),
      this.gatherGarbage(householdId, userId, today),
      this.gatherBudget(householdId, userId, tz),
      this.gatherPension(householdId, userId, tz),
    ]);

    const signals: Signal[] = [];
    for (const g of gathered) {
      if (g.status === 'fulfilled') signals.push(...g.value);
    }

    // Rank: highest score first, tie-break by soonest due date.
    signals.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return dueRank(a.dueDate) - dueRank(b.dueDate);
    });

    const attentionCount = signals
      .filter((s) => s.attention)
      .reduce((sum, s) => sum + s.count, 0);

    const generatedAt = new Date(opts.nowMs).toISOString();

    if (signals.length === 0) {
      return {
        greeting,
        title: 'All clear',
        message:
          "Everything's on track — nothing needs you right now. I'll keep watch and flag anything the moment it matters.",
        tone: 'celebrate',
        icon: 'checkmark-circle',
        dueLabel: null,
        dueDate: null,
        cta: null,
        attentionCount: 0,
        chips: [],
        generatedAt,
      };
    }

    const [primary, ...rest] = signals;
    const chips = rest.slice(0, 3).map((s) => s.chip);

    return {
      greeting,
      title: primary.title,
      message: primary.message,
      tone: primary.tone,
      icon: primary.icon,
      dueLabel: primary.dueLabel,
      dueDate: primary.dueDate,
      cta: primary.cta,
      attentionCount,
      chips,
      generatedAt,
    };
  }

  // ---------- signal gatherers ----------

  private async gatherTasks(
    householdId: string,
    userId: string,
    today: string
  ): Promise<Signal[]> {
    const svc = new TaskService(this.env, this.env.DB);
    // Includes overdue tasks (next_due_date <= today+14), oldest due first.
    const tasks = (await svc.getUpcomingTasks(householdId, userId, 14)).filter(
      (t) => !!t.next_due_date
    );
    if (tasks.length === 0) return [];

    const withDays = tasks
      .map((t) => ({ t, days: daysBetween(today, t.next_due_date as string) }))
      .sort((a, b) => a.days - b.days || boost(b.t) - boost(a.t));

    const overdue = withDays.filter((x) => x.days < 0);
    const dueToday = withDays.filter((x) => x.days === 0);
    const dueTomorrow = withDays.filter((x) => x.days === 1);
    const dueSoon = withDays.filter((x) => x.days >= 2 && x.days <= 7);

    const signals: Signal[] = [];
    const cta: InsightCta = { label: 'Review tasks', route: '/tasks' };

    if (overdue.length > 0) {
      const lead = overdue[0];
      const n = overdue.length;
      const dueLabel = overdueLabel(-lead.days);
      signals.push({
        score: 100 + Math.min(-lead.days, 30) + boost(lead.t),
        tone: 'urgent',
        icon: 'alert-circle',
        title: n === 1 ? '1 task overdue' : `${n} tasks overdue`,
        message:
          n === 1
            ? `“${lead.t.title}” is ${dueLabel.toLowerCase()}. Want to knock it out or push it to a new day?`
            : `${n} tasks are overdue — starting with “${lead.t.title}” (${dueLabel.toLowerCase()}). Let's clear them.`,
        dueDate: (lead.t.next_due_date as string).slice(0, 10),
        dueLabel,
        chip: { icon: 'alert-circle', label: n === 1 ? lead.t.title : `${n} overdue tasks`, dueLabel },
        cta: { label: n === 1 ? 'Review task' : 'Review tasks', route: '/tasks' },
        count: n,
        attention: true,
      });
    }

    if (dueToday.length > 0) {
      const lead = dueToday[0];
      const n = dueToday.length;
      signals.push({
        score: 80 + boost(lead.t),
        tone: 'attention',
        icon: 'today',
        title: n === 1 ? '1 task due today' : `${n} tasks due today`,
        message:
          n === 1
            ? `“${lead.t.title}” is due today. I've kept it at the top of your list.`
            : `${n} tasks are due today, including “${lead.t.title}”. Here's your list.`,
        dueDate: (lead.t.next_due_date as string).slice(0, 10),
        dueLabel: 'Due today',
        chip: { icon: 'today', label: n === 1 ? lead.t.title : `${n} tasks`, dueLabel: 'today' },
        cta,
        count: n,
        attention: true,
      });
    }

    if (dueTomorrow.length > 0) {
      const lead = dueTomorrow[0];
      const n = dueTomorrow.length;
      signals.push({
        score: 60 + boost(lead.t),
        tone: 'info',
        icon: 'calendar',
        title: n === 1 ? '1 task due tomorrow' : `${n} tasks due tomorrow`,
        message:
          n === 1
            ? `“${lead.t.title}” is due tomorrow — a good one to line up for today.`
            : `${n} tasks are due tomorrow, including “${lead.t.title}”.`,
        dueDate: (lead.t.next_due_date as string).slice(0, 10),
        dueLabel: 'Due tomorrow',
        chip: { icon: 'calendar', label: n === 1 ? lead.t.title : `${n} tasks`, dueLabel: 'tomorrow' },
        cta,
        count: n,
        attention: true,
      });
    }

    if (dueSoon.length > 0) {
      const lead = dueSoon[0];
      const n = dueSoon.length;
      const dueLabel = `Due in ${lead.days} days`;
      signals.push({
        score: 42 + boost(lead.t),
        tone: 'info',
        icon: 'calendar-outline',
        title: n === 1 ? '1 task this week' : `${n} tasks this week`,
        message:
          n === 1
            ? `“${lead.t.title}” is due in ${lead.days} days. Plenty of runway.`
            : `${n} tasks are coming up this week, starting with “${lead.t.title}” in ${lead.days} days.`,
        dueDate: (lead.t.next_due_date as string).slice(0, 10),
        dueLabel,
        chip: { icon: 'calendar-outline', label: n === 1 ? lead.t.title : `${n} tasks`, dueLabel: `in ${lead.days}d` },
        cta,
        count: n,
        attention: true,
      });
    }

    return signals;
  }

  private async gatherBills(householdId: string, today: string): Promise<Signal[]> {
    const horizon = addDaysISO(today, 14);
    const rows = await this.db
      .select()
      .from(utilityBills)
      .where(
        and(
          eq(utilityBills.household_id, householdId),
          isNull(utilityBills.paid_date),
          lte(utilityBills.due_date, horizon)
        )
      )
      .orderBy(asc(utilityBills.due_date))
      .limit(10)
      .all();
    if (rows.length === 0) return [];

    const withDays = rows.map((b) => ({ b, days: daysBetween(today, b.due_date) }));
    const lead = withDays[0];
    const n = withDays.length;
    const label = BILL_TYPE_LABEL[lead.b.bill_type] ?? 'Utility bill';
    const provider = lead.b.provider ? lead.b.provider : label.replace(' bill', '');
    const amount = formatMoney(lead.b.amount);
    const cta: InsightCta = { label: 'View bill', route: '/utilities' };

    if (lead.days < 0) {
      const dueLabel = overdueLabel(-lead.days);
      return [
        {
          score: 95 + Math.min(-lead.days, 20),
          tone: 'urgent',
          icon: 'card',
          title: 'Bill overdue',
          message: `Your ${provider} bill of ${amount} was due ${-lead.days === 1 ? 'yesterday' : `${-lead.days} days ago`}. Best to pay it before any late fees.`,
          dueDate: lead.b.due_date,
          dueLabel,
          chip: { icon: 'card', label, dueLabel },
          cta: { label: 'Pay bill', route: '/utilities' },
          count: n,
          attention: true,
        },
      ];
    }

    const dueLabel = dueSoonLabel(lead.days);
    const score = lead.days === 0 ? 78 : lead.days <= 3 ? 56 : 40;
    return [
      {
        score,
        tone: lead.days === 0 ? 'attention' : 'info',
        icon: 'card-outline',
        title: lead.days === 0 ? 'Bill due today' : 'Bill due soon',
        message: `Your ${provider} bill of ${amount} is ${dueLabel.toLowerCase()}. Want me to remind you closer to the day?`,
        dueDate: lead.b.due_date,
        dueLabel,
        chip: { icon: 'card-outline', label, dueLabel: relativeShort(lead.days) },
        cta,
        count: n,
        attention: true,
      },
    ];
  }

  private async gatherPropertyTax(householdId: string, today: string): Promise<Signal[]> {
    const horizon = addDaysISO(today, 30);
    const rows = await this.db
      .select()
      .from(propertyTaxes)
      .where(
        and(
          eq(propertyTaxes.household_id, householdId),
          isNull(propertyTaxes.main_payment_paid_date),
          lte(propertyTaxes.main_payment_due_date, horizon)
        )
      )
      .orderBy(asc(propertyTaxes.main_payment_due_date))
      .limit(3)
      .all();
    if (rows.length === 0) return [];

    const lead = rows[0];
    const days = daysBetween(today, lead.main_payment_due_date);
    const amount = formatMoney(lead.main_payment_amount);
    const cta: InsightCta = { label: 'View property tax', route: '/utilities' };

    if (days < 0) {
      const dueLabel = overdueLabel(-days);
      return [
        {
          score: 92 + Math.min(-days, 20),
          tone: 'urgent',
          icon: 'home',
          title: 'Property tax overdue',
          message: `Your ${lead.tax_year} property tax (${amount}) was due ${-days === 1 ? 'yesterday' : `${-days} days ago`}. Late payment usually adds a penalty — worth handling soon.`,
          dueDate: lead.main_payment_due_date,
          dueLabel,
          chip: { icon: 'home', label: 'Property tax', dueLabel },
          cta,
          count: 1,
          attention: true,
        },
      ];
    }

    const dueLabel = dueSoonLabel(days);
    return [
      {
        score: days === 0 ? 76 : 50,
        tone: days === 0 ? 'attention' : 'info',
        icon: 'home-outline',
        title: days === 0 ? 'Property tax due today' : 'Property tax due soon',
        message: `Your ${lead.tax_year} property tax of ${amount} is ${dueLabel.toLowerCase()}. Don't forget to claim your homeowner grant if you're eligible.`,
        dueDate: lead.main_payment_due_date,
        dueLabel,
        chip: { icon: 'home-outline', label: 'Property tax', dueLabel: relativeShort(days) },
        cta,
        count: 1,
        attention: true,
      },
    ];
  }

  private async gatherGarbage(
    householdId: string,
    userId: string,
    today: string
  ): Promise<Signal[]> {
    const svc = new GarbageCollectionService(this.env, this.env.DB);
    const schedule = await svc.getOrCreateSchedule(householdId, userId);
    if (!schedule.schedules || schedule.schedules.length === 0) return [];

    const dates = await svc.getNextCollectionDates(householdId, schedule.id, userId, 3);
    if (dates.length === 0) return [];

    const next = dates[0];
    const days = daysBetween(today, next.date);
    if (days < 0 || days > 1) return []; // only "today" / "tomorrow" is banner-worthy

    const types = formatWasteTypes(next.types);
    const when = days === 0 ? 'today' : 'tomorrow';
    return [
      {
        score: days === 0 ? 70 : 58,
        tone: days === 0 ? 'attention' : 'info',
        icon: 'trash',
        title: `${types} ${when}`,
        message:
          days === 0
            ? `${types} collection is today. If the bins aren't out yet, now's the time.`
            : `${types} goes out tomorrow — set the bins out tonight so you don't miss the truck.`,
        dueDate: next.date,
        dueLabel: days === 0 ? 'Today' : 'Tomorrow',
        chip: { icon: 'trash', label: types, dueLabel: when },
        cta: null,
        count: 1,
        attention: false, // informational; doesn't inflate the attention badge
      },
    ];
  }

  private async gatherBudget(
    householdId: string,
    userId: string,
    tz: string
  ): Promise<Signal[]> {
    const { year, month } = localYearMonth(tz, Date.parse(localDateISO(tz, Date.now()) + 'T12:00:00Z'));
    const svc = new BudgetService(this.env, this.env.DB);
    const overview = await svc.getMonthlyOverview(householdId, userId, year, month);
    if (overview.remainingBudget >= 0) return [];

    const over = formatMoney(-overview.remainingBudget);
    return [
      {
        score: 50,
        tone: 'attention',
        icon: 'wallet',
        title: 'Over budget this month',
        message: `You're ${over} over this month's budget. Want to look at where it's going before month-end?`,
        dueDate: null,
        dueLabel: null,
        chip: { icon: 'wallet', label: 'Over budget', dueLabel: over },
        cta: { label: 'Review budget', route: '/budget' },
        count: 1,
        attention: true,
      },
    ];
  }

  /**
   * Pension goals — make Mira aware of RRSP/TFSA contribution goals + progress so she can
   * nudge toward them. Deterministic: for each member goal, compare funded % to the share
   * of the year elapsed (pace). Surfaces the single most-behind goal as a gentle nudge, or
   * a celebration when one is fully funded. Never blanks the hero (isolated by allSettled).
   */
  private async gatherPension(householdId: string, userId: string, tz: string): Promise<Signal[]> {
    const { year, month } = localYearMonth(tz, Date.parse(localDateISO(tz, Date.now()) + 'T12:00:00Z'));
    if (!SAVINGS_LIMITS[year]) return []; // no configured limits → skip quietly

    const svc = new SavingsService(this.env, this.env.DB);
    const overview = await svc.getPensionOverview(householdId, userId, year);

    const goals = overview.groups
      .flatMap((g) => g.accounts.map((a) => ({ ...a, memberName: g.memberName })))
      .filter((a) => a.room.goalCents != null && a.room.goalCents > 0);
    if (goals.length === 0) return [];

    const typeLabel = (t: string) => (t === 'tfsa' ? 'TFSA' : t === 'rrsp' ? 'RRSP' : t.toUpperCase());
    const expectedPct = Math.round((month / 12) * 100); // share of the year elapsed

    // Celebrate a fully-funded goal first.
    const done = goals.find((g) => g.room.goalPct >= 100);
    if (done) {
      const who = done.memberName ? `${done.memberName}'s ` : 'your ';
      return [
        {
          score: 24,
          tone: 'celebrate',
          icon: 'trophy',
          title: 'Pension goal reached',
          message: `Nice — ${who}${typeLabel(done.account.account_type)} contribution goal for ${year} is fully funded. 🎉`,
          dueDate: null,
          dueLabel: null,
          chip: { icon: 'trophy', label: `${typeLabel(done.account.account_type)} goal`, dueLabel: 'Done' },
          cta: { label: 'View pension', route: '/budget' },
          count: 1,
          attention: false,
        },
      ];
    }

    // Otherwise nudge the goal that's furthest behind pace.
    const behind = goals
      .map((g) => ({ g, gap: expectedPct - g.room.goalPct }))
      .sort((a, b) => b.gap - a.gap)[0];
    const { g, gap } = behind;
    const remaining = formatMoney(g.room.goalRemainingCents);
    const who = g.memberName ? `${g.memberName}'s ` : 'your ';
    const label = typeLabel(g.account.account_type);

    return [
      {
        // Behind pace nudges a bit harder than an on-track FYI, but stays below urgent tasks/bills.
        score: gap > 10 ? 42 : 16,
        tone: gap > 10 ? 'attention' : 'info',
        icon: 'trending-up',
        title: `${label} goal ${g.room.goalPct}% funded`,
        message:
          gap > 10
            ? `${who}${label} goal is ${g.room.goalPct}% funded with ${remaining} to go this year. Want to set up an automatic monthly contribution to catch up?`
            : `${who}${label} goal is ${g.room.goalPct}% funded — ${remaining} to go. Nicely on pace.`,
        dueDate: null,
        dueLabel: null,
        chip: { icon: 'trending-up', label: `${label} goal`, dueLabel: `${g.room.goalPct}%` },
        cta: { label: 'View pension', route: '/budget' },
        count: goals.length,
        attention: gap > 10,
      },
    ];
  }

  // ---------- helpers ----------

  private async resolveTimezone(householdId: string, clientTz?: string): Promise<string> {
    if (clientTz && isValidTimezone(clientTz)) return clientTz;
    try {
      const row = await this.db
        .select({ timezone: assistantIdentity.timezone })
        .from(assistantIdentity)
        .where(eq(assistantIdentity.household_id, householdId))
        .get();
      if (row?.timezone && isValidTimezone(row.timezone)) return row.timezone;
    } catch {
      // fall through to UTC
    }
    return 'UTC';
  }
}

// ---------- module-level pure helpers (exported for tests) ----------

function boost(t: TaskResponse): number {
  return PRIORITY_BOOST[t.priority_severity] ?? 0;
}

/** Local calendar date (YYYY-MM-DD) for a zone. */
export function localDateISO(tz: string, nowMs: number): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(nowMs));
}

/** Local hour (0-23) for a zone. */
export function localHour(tz: string, nowMs: number): number {
  const h = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).format(new Date(nowMs));
  const n = parseInt(h, 10);
  return Number.isFinite(n) ? n % 24 : 0;
}

export function localYearMonth(tz: string, nowMs: number): { year: number; month: number } {
  const iso = localDateISO(tz, nowMs);
  const [y, m] = iso.split('-');
  return { year: parseInt(y, 10), month: parseInt(m, 10) };
}

export function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Whole calendar days from `fromISO` to `toISO` (both YYYY-MM-DD). Negative = past. */
export function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

export function addDaysISO(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** "1 day overdue" / "3 days overdue". `n` is a positive number of days. */
export function overdueLabel(n: number): string {
  return `${n} day${n === 1 ? '' : 's'} overdue`;
}

/** "Due today" / "Due tomorrow" / "Due in 3 days". `days` >= 0. */
export function dueSoonLabel(days: number): string {
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days} days`;
}

/** Compact relative label for chips: "today" / "tomorrow" / "in 3d". */
export function relativeShort(days: number): string {
  if (days < 0) return `${-days}d overdue`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days}d`;
}

/** Sort key so earlier/overdue due dates rank ahead of null (no date). */
function dueRank(dueDate: string | null): number {
  if (!dueDate) return Number.MAX_SAFE_INTEGER;
  return Date.parse(`${dueDate.slice(0, 10)}T00:00:00Z`) || Number.MAX_SAFE_INTEGER;
}

/** Cents → "$340" / "$1,240". Rounds to whole dollars for a compact banner. */
export function formatMoney(cents: number): string {
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString('en-US')}`;
}

const WASTE_LABEL: Record<string, string> = {
  garbage: 'Garbage',
  recycling: 'Recycling',
  organics: 'Organics',
  yardWaste: 'Yard waste',
  bulkItem: 'Bulk item',
};

/** ["recycling","organics"] → "Recycling & organics". */
export function formatWasteTypes(types: string[]): string {
  const labels = types.map((t) => WASTE_LABEL[t] ?? t);
  if (labels.length === 0) return 'Collection';
  if (labels.length === 1) return labels[0];
  const head = labels.slice(0, -1).join(', ');
  const tail = labels[labels.length - 1].toLowerCase();
  return `${head} & ${tail}`;
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
