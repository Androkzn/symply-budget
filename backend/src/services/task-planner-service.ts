/**
 * Task Planner — the "what can I do right now, I have N minutes?" engine, plus
 * an actionable report over upcoming/active tasks.
 *
 * Neuro-symbolic by design (per research): the AI's job upstream is to ESTIMATE
 * each task's {risk, priority, minutes}; the SELECTION and sequencing happen
 * HERE, in deterministic code, so the answer is reproducible, explainable, and
 * never hallucinates a task or a time. The chat layer only wraps this structured
 * output in prose.
 *
 * `planSchedule` is a pure function (no DB) so the knapsack logic is unit-tested
 * directly. `TaskPlannerService` loads the data and delegates to it.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import * as schema from '../db/schema';
import type { Database, Env, TaskPrioritySeverity } from '../types';

import { HouseholdService } from './household-service';
import { effortToMinutes, type TimeEffort } from './time-effort';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** Minimal task shape the planner reasons over. */
export interface PlannerTask {
  id: string;
  title: string;
  /** Coarse effort tier; the planner maps it to representative minutes for packing. */
  time_effort: TimeEffort | null;
  priority_severity: TaskPrioritySeverity | null;
  risk_level: RiskLevel | null;
  next_due_date: string | null;
  /** Blocked tasks are excluded from the "what can I do now" plan. */
  blocked?: boolean;
  /** Incomplete subtasks (sorted) — used to fit a task PARTIALLY when the whole
   *  thing won't fit the budget. */
  incomplete_subtasks: Array<{ id: string; title: string; sort_order: number }>;
}

export interface PlannedItem {
  task_id: string;
  title: string;
  /** Minutes allocated to this item — the user's time budget, not a task estimate. */
  minutes: number;
  /** Effort tier shown per task instead of a precise time. */
  time_effort: TimeEffort | null;
  score: number;
  /** True when only a prefix of the task's subtasks is scheduled. */
  partial: boolean;
  subtask_ids?: string[];
  /** Short human-readable justification (urgency + risk/priority). */
  reason: string;
}

export interface SkippedItem {
  task_id: string;
  title: string;
  minutes: number;
  time_effort: TimeEffort | null;
  reason: 'no_time_left' | 'too_long';
}

export interface TaskBudgetPlan {
  budget_minutes: number;
  used_minutes: number;
  selected: PlannedItem[];
  skipped: SkippedItem[];
}

/** When the AI hasn't estimated a duration yet, assume a modest default. */
export const DEFAULT_TASK_MINUTES = 30;

const PRIORITY_WEIGHT: Record<TaskPrioritySeverity, number> = {
  critical: 100,
  urgent: 80,
  high: 60,
  medium: 40,
  low: 20,
  nice_to_have: 10,
};

const RISK_BOOST: Record<RiskLevel, number> = {
  critical: 40,
  high: 25,
  medium: 10,
  low: 0,
};

/** Days until due (negative = overdue). null when there's no due date. */
function daysUntilDue(nextDueDate: string | null, now: Date): number | null {
  if (!nextDueDate) return null;
  const due = new Date(nextDueDate).getTime();
  if (Number.isNaN(due)) return null;
  return Math.ceil((due - now.getTime()) / (1000 * 60 * 60 * 24));
}

function urgencyBoost(days: number | null): number {
  if (days === null) return 0;
  if (days < 0) return 50; // overdue
  if (days === 0) return 30; // due today
  if (days <= 7) return 15; // due this week
  return 0;
}

export function scoreTask(task: PlannerTask, now: Date): number {
  const priority = PRIORITY_WEIGHT[task.priority_severity ?? 'nice_to_have'] ?? 10;
  const risk = RISK_BOOST[task.risk_level ?? 'low'] ?? 0;
  return priority + risk + urgencyBoost(daysUntilDue(task.next_due_date, now));
}

function effectiveMinutes(task: PlannerTask): number {
  const m = effortToMinutes(task.time_effort);
  return typeof m === 'number' && m > 0 ? m : DEFAULT_TASK_MINUTES;
}

function reasonFor(task: PlannerTask, now: Date): string {
  const days = daysUntilDue(task.next_due_date, now);
  const bits: string[] = [];
  if (days !== null) {
    if (days < 0) bits.push(`${Math.abs(days)}d overdue`);
    else if (days === 0) bits.push('due today');
    else if (days <= 7) bits.push('due this week');
  }
  if (task.risk_level === 'critical' || task.risk_level === 'high') {
    bits.push(`${task.risk_level} risk`);
  }
  if (!bits.length && task.priority_severity) bits.push(`${task.priority_severity} priority`);
  return bits.join(' • ') || 'good use of time';
}

/**
 * Deterministic selection: sort by score (then shorter, then sooner-due, then id
 * for stable ordering) and greedily fill the budget. A task that doesn't fit
 * whole is included PARTIALLY when a prefix of its incomplete subtasks fits.
 */
export function planSchedule(
  tasks: PlannerTask[],
  budgetMinutes: number,
  now: Date = new Date()
): TaskBudgetPlan {
  const budget = Math.max(0, Math.round(budgetMinutes));

  // Blocked tasks can't be acted on right now — leave them out of the plan.
  const ranked = [...tasks]
    .filter((t) => !t.blocked)
    .map((t) => ({ t, score: scoreTask(t, now), minutes: effectiveMinutes(t) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.minutes !== b.minutes) return a.minutes - b.minutes;
      const ad = a.t.next_due_date ?? '￿';
      const bd = b.t.next_due_date ?? '￿';
      if (ad !== bd) return ad < bd ? -1 : 1;
      return a.t.id < b.t.id ? -1 : 1;
    });

  const selected: PlannedItem[] = [];
  const skipped: SkippedItem[] = [];
  let remaining = budget;

  for (const { t, score, minutes } of ranked) {
    if (minutes <= remaining) {
      selected.push({
        task_id: t.id,
        title: t.title,
        minutes,
        time_effort: t.time_effort,
        score,
        partial: false,
        reason: reasonFor(t, now),
      });
      remaining -= minutes;
      continue;
    }

    // Won't fit whole — try a partial via incomplete subtasks.
    const subs = [...t.incomplete_subtasks].sort((a, b) => a.sort_order - b.sort_order);
    if (subs.length > 0) {
      const perSub = Math.max(1, Math.round(minutes / subs.length));
      const fitCount = Math.min(subs.length, Math.floor(remaining / perSub));
      if (fitCount > 0) {
        const chosen = subs.slice(0, fitCount);
        const alloc = perSub * fitCount;
        selected.push({
          task_id: t.id,
          title: t.title,
          minutes: alloc,
          time_effort: t.time_effort,
          score,
          partial: true,
          subtask_ids: chosen.map((s) => s.id),
          reason: `${reasonFor(t, now)} — start ${fitCount} of ${subs.length} steps`,
        });
        remaining -= alloc;
        continue;
      }
    }

    skipped.push({
      task_id: t.id,
      title: t.title,
      minutes,
      time_effort: t.time_effort,
      reason: minutes > budget ? 'too_long' : 'no_time_left',
    });
  }

  return {
    budget_minutes: budget,
    used_minutes: budget - remaining,
    selected,
    skipped,
  };
}

// ---- Actionable report ----

export interface TaskReport {
  generated_at: string;
  total_active: number;
  overdue: number;
  due_today: number;
  due_this_week: number;
  later: number;
  no_due_date: number;
  high_risk: number;
  /** Highest-priority actionable items first (capped). */
  top_tasks: Array<{
    task_id: string;
    title: string;
    score: number;
    risk_level: RiskLevel | null;
    priority_severity: TaskPrioritySeverity | null;
    time_effort: TimeEffort | null;
    days_until_due: number | null;
  }>;
}

export function buildReport(tasks: PlannerTask[], now: Date, topN = 10): TaskReport {
  let overdue = 0;
  let dueToday = 0;
  let dueThisWeek = 0;
  let later = 0;
  let noDue = 0;
  let highRisk = 0;

  for (const t of tasks) {
    if (t.risk_level === 'high' || t.risk_level === 'critical') highRisk += 1;
    const d = daysUntilDue(t.next_due_date, now);
    if (d === null) noDue += 1;
    else if (d < 0) overdue += 1;
    else if (d === 0) dueToday += 1;
    else if (d <= 7) dueThisWeek += 1;
    else later += 1;
  }

  const top = [...tasks]
    .map((t) => ({ t, score: scoreTask(t, now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(({ t, score }) => ({
      task_id: t.id,
      title: t.title,
      score,
      risk_level: t.risk_level,
      priority_severity: t.priority_severity,
      time_effort: t.time_effort,
      days_until_due: daysUntilDue(t.next_due_date, now),
    }));

  return {
    generated_at: now.toISOString(),
    total_active: tasks.length,
    overdue,
    due_today: dueToday,
    due_this_week: dueThisWeek,
    later,
    no_due_date: noDue,
    high_risk: highRisk,
    top_tasks: top,
  };
}

export class TaskPlannerService {
  private db: Database;
  private householdService: HouseholdService;

  constructor(env: Env, d1: D1Database) {
    this.db = drizzle(d1, { schema });
    this.householdService = new HouseholdService(env, d1);
  }

  /** Load active tasks + their incomplete subtasks for the household. */
  private async loadPlannerTasks(householdId: string): Promise<PlannerTask[]> {
    const rows = await this.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.household_id, householdId),
          isNull(schema.tasks.deleted_at),
          eq(schema.tasks.is_active, true)
        )
      )
      .all();

    const ids = rows.map((r) => r.id);
    const subs = ids.length
      ? await this.db
          .select()
          .from(schema.maintenanceSubtasks)
          .where(
            and(
              inArray(schema.maintenanceSubtasks.task_id, ids),
              eq(schema.maintenanceSubtasks.is_completed, false)
            )
          )
          .all()
      : [];

    const subsByTask = new Map<string, Array<{ id: string; title: string; sort_order: number }>>();
    for (const s of subs) {
      const list = subsByTask.get(s.task_id) ?? [];
      list.push({ id: s.id, title: s.title, sort_order: s.sort_order });
      subsByTask.set(s.task_id, list);
    }

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      time_effort: (r.time_effort ?? null) as TimeEffort | null,
      priority_severity: (r.priority_severity ?? null) as TaskPrioritySeverity | null,
      risk_level: (r.risk_level ?? null) as RiskLevel | null,
      next_due_date: r.next_due_date ?? null,
      blocked: r.blocked ?? false,
      incomplete_subtasks: subsByTask.get(r.id) ?? [],
    }));
  }

  async getPlan(
    householdId: string,
    userId: string,
    budgetMinutes: number,
    now: Date = new Date()
  ): Promise<TaskBudgetPlan> {
    await this.householdService.getHousehold(householdId, userId);
    const tasks = await this.loadPlannerTasks(householdId);
    return planSchedule(tasks, budgetMinutes, now);
  }

  async getReport(
    householdId: string,
    userId: string,
    now: Date = new Date()
  ): Promise<TaskReport> {
    await this.householdService.getHousehold(householdId, userId);
    const tasks = await this.loadPlannerTasks(householdId);
    return buildReport(tasks, now);
  }
}
