import type { BudgetItem, ScoredBudgetItem } from '@api/budget';

export type BudgetPriority = 'critical' | 'high' | 'medium' | 'low';

export interface AffordabilityItemInput {
  id: string;
  title: string;
  priority: BudgetPriority;
  target_date: string | null;
  estimated_cost_min: number | null;
  estimated_cost_max: number | null;
  actual_cost: number | null;
  status: BudgetItem['status'];
}

export interface AffordabilityPlanResult {
  remaining_budget: number;
  used_budget: number;
  affordable: ScoredBudgetItem[];
  deferred: ScoredBudgetItem[];
}

export interface AllocationSegment {
  id: string;
  title: string;
  priority: BudgetPriority;
  amount: number;
  share: number;
}

export interface PlannedFitRow {
  id: string;
  title: string;
  priority: BudgetPriority;
  estimatedCost: number;
  fits: boolean;
  reason: string;
}

const PRIORITY_WEIGHT: Record<BudgetPriority, number> = {
  critical: 100,
  high: 60,
  medium: 40,
  low: 20,
};

export const PRIORITY_SORT_ORDER: Record<BudgetPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function parseLocalYMD(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function daysUntilTarget(targetDate: string | null, now: Date): number | null {
  if (!targetDate) return null;
  const target = parseLocalYMD(targetDate).getTime();
  if (Number.isNaN(target)) return null;
  return Math.ceil((target - now.getTime()) / (1000 * 60 * 60 * 24));
}

function urgencyBoost(days: number | null): number {
  if (days === null) return 0;
  if (days < 0) return 50;
  if (days === 0) return 30;
  if (days <= 7) return 15;
  return 0;
}

function estimatedCost(item: AffordabilityItemInput): number {
  if (typeof item.actual_cost === 'number') return item.actual_cost;
  const min = item.estimated_cost_min ?? 0;
  const max = item.estimated_cost_max ?? min;
  return Math.round((min + max) / 2);
}

function reasonFor(item: AffordabilityItemInput, now: Date): string {
  const days = daysUntilTarget(item.target_date, now);
  const bits: string[] = [];
  if (days !== null) {
    if (days < 0) bits.push(`${Math.abs(days)}d overdue`);
    else if (days === 0) bits.push('due today');
    else if (days <= 7) bits.push('due this week');
  }
  // Priority is shown as a badge in the UI — don't repeat it in the reason.
  return bits.join(' • ');
}

export function scoreBudgetItem(item: AffordabilityItemInput, now: Date): number {
  const priority = PRIORITY_WEIGHT[item.priority] ?? 20;
  return priority + urgencyBoost(daysUntilTarget(item.target_date, now));
}

/** Greedy priority planner — mirrors backend budget-affordability.ts */
export function planAffordability(
  items: AffordabilityItemInput[],
  remainingBudgetCents: number,
  now: Date = new Date()
): AffordabilityPlanResult {
  const remaining = Math.max(0, Math.round(remainingBudgetCents));

  const ranked = items
    .filter((i) => i.status === 'planned')
    .map((item) => ({
      item,
      score: scoreBudgetItem(item, now),
      cost: estimatedCost(item),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.cost !== b.cost) return a.cost - b.cost;
      return a.item.id < b.item.id ? -1 : 1;
    });

  const affordable: ScoredBudgetItem[] = [];
  const deferred: ScoredBudgetItem[] = [];
  let used = 0;
  let budgetLeft = remaining;

  for (const { item, score, cost } of ranked) {
    const scored: ScoredBudgetItem = {
      id: item.id,
      title: item.title,
      priority: item.priority,
      target_date: item.target_date,
      status: item.status,
      estimatedCost: cost,
      score,
      reason: reasonFor(item, now),
    };

    if (cost <= budgetLeft) {
      affordable.push(scored);
      used += cost;
      budgetLeft -= cost;
    } else {
      deferred.push(scored);
    }
  }

  return {
    remaining_budget: remaining,
    used_budget: used,
    affordable,
    deferred,
  };
}

export function plannedItemsFromOverview(items: BudgetItem[]): AffordabilityItemInput[] {
  return items
    .filter((item) => item.status === 'planned')
    .map((item) => ({
      id: item.id,
      title: item.title,
      priority: item.priority,
      target_date: item.target_date,
      estimated_cost_min: item.estimated_cost_min,
      estimated_cost_max: item.estimated_cost_max,
      actual_cost: item.actual_cost,
      status: item.status,
    }));
}

/** Monday 00:00 – Sunday end for the calendar week containing `anchor`. */
export function calendarWeekBounds(anchor: Date): { start: Date; end: Date } {
  const d = new Date(anchor);
  d.setHours(12, 0, 0, 0);
  const day = d.getDay();
  const diffToMonday = (day + 6) % 7;
  const start = new Date(d);
  start.setDate(d.getDate() - diffToMonday);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function isCurrentMonthView(year: number, month: number, now: Date = new Date()): boolean {
  return now.getFullYear() === year && now.getMonth() + 1 === month;
}

/** Planned items due this calendar week (plus overdue planned still open). */
export function filterPlannedForWeek(
  items: AffordabilityItemInput[],
  now: Date = new Date()
): AffordabilityItemInput[] {
  const { start, end } = calendarWeekBounds(now);
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);

  return items.filter((item) => {
    if (item.status !== 'planned' || !item.target_date) return false;
    const target = parseLocalYMD(item.target_date);
    if (target >= start && target <= end) return true;
    return target < today;
  });
}

export function buildAllocationSegments(
  plan: AffordabilityPlanResult
): AllocationSegment[] {
  const pool = Math.max(plan.remaining_budget, 1);
  return plan.affordable.map((item) => ({
    id: item.id,
    title: item.title,
    priority: item.priority,
    amount: item.estimatedCost,
    share: item.estimatedCost / pool,
  }));
}

export function buildPlannedFitRows(plan: AffordabilityPlanResult): PlannedFitRow[] {
  const rows: PlannedFitRow[] = [
    ...plan.affordable.map((item) => ({
      id: item.id,
      title: item.title,
      priority: item.priority,
      estimatedCost: item.estimatedCost,
      fits: true,
      reason: item.reason,
    })),
    ...plan.deferred.map((item) => ({
      id: item.id,
      title: item.title,
      priority: item.priority,
      estimatedCost: item.estimatedCost,
      fits: false,
      reason: item.reason,
    })),
  ];

  return rows.sort((a, b) => {
    const byPriority = PRIORITY_SORT_ORDER[a.priority] - PRIORITY_SORT_ORDER[b.priority];
    if (byPriority !== 0) return byPriority;
    if (a.fits !== b.fits) return a.fits ? -1 : 1;
    return b.estimatedCost - a.estimatedCost;
  });
}

export function priorityLabel(priority: BudgetPriority): string {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}
