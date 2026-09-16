/**
 * Smart Budget affordability planner — "what can I afford this month, given my
 * priorities?" Mirrors task-planner-service.ts's neuro-symbolic split: AI only
 * estimates {priority, cost} upstream; the ranking and greedy-fill against the
 * remaining monthly balance happen HERE, deterministically, so the answer is
 * reproducible and never hallucinates an amount.
 *
 * All money values are in CENTS. Never convert to dollars within this module.
 */

export type BudgetPriority = 'critical' | 'high' | 'medium' | 'low';
export type BudgetItemStatus = 'planned' | 'in_progress' | 'completed' | 'deferred' | 'cancelled';

/** Minimal item shape the affordability planner reasons over. */
export interface AffordabilityItem {
  id: string;
  title: string;
  priority: BudgetPriority;
  target_date: string | null;
  estimated_cost_min: number | null;
  estimated_cost_max: number | null;
  actual_cost: number | null;
  status: BudgetItemStatus;
  /**
   * Planning horizon. `someday` items are wishes (no committed date/budget) and
   * are always excluded from the fit — never consume the monthly balance.
   * Optional so older callers/tests compile; absence = counts as normal.
   */
  horizon?: 'short_term' | 'long_term' | 'someday';
}

export interface ScoredItem {
  id: string;
  title: string;
  priority: BudgetPriority;
  target_date: string | null;
  status: BudgetItemStatus;
  /** Midpoint of min/max estimate, or actual_cost if known. Cents. */
  estimatedCost: number;
  score: number;
  reason: string;
}

export interface AffordabilityPlan {
  /** Monthly balance this plan was computed against, in cents. */
  remaining_budget: number;
  /** Sum of `affordable` items' estimatedCost, in cents. */
  used_budget: number;
  affordable: ScoredItem[];
  deferred: ScoredItem[];
}

const PRIORITY_WEIGHT: Record<BudgetPriority, number> = {
  critical: 100,
  high: 60,
  medium: 40,
  low: 20,
};

/** Days until target date (negative = overdue). null when there's no date. */
function daysUntilTarget(targetDate: string | null, now: Date): number | null {
  if (!targetDate) return null;
  const target = new Date(targetDate).getTime();
  if (Number.isNaN(target)) return null;
  return Math.ceil((target - now.getTime()) / (1000 * 60 * 60 * 24));
}

function urgencyBoost(days: number | null): number {
  if (days === null) return 0;
  if (days < 0) return 50; // overdue
  if (days === 0) return 30; // due today
  if (days <= 7) return 15; // due this week
  return 0;
}

function estimatedCost(item: AffordabilityItem): number {
  if (typeof item.actual_cost === 'number') return item.actual_cost;
  const min = item.estimated_cost_min ?? 0;
  const max = item.estimated_cost_max ?? min;
  return Math.round((min + max) / 2);
}

export function scoreBudgetItem(item: AffordabilityItem, now: Date): number {
  const priority = PRIORITY_WEIGHT[item.priority] ?? 20;
  return priority + urgencyBoost(daysUntilTarget(item.target_date, now));
}

function reasonFor(item: AffordabilityItem, now: Date): string {
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

/**
 * Deterministic selection over still-undecided items only (`status ===
 * 'planned'` — `in_progress`/`completed` are already committed and counted
 * into the caller's remaining-budget figure instead, `deferred`/`cancelled`
 * are out of consideration). Sorts by score desc (then cheaper-first so more
 * items fit, then id for stable ordering), and greedily fills the remaining
 * monthly balance.
 */
export function planAffordability(
  items: AffordabilityItem[],
  remainingBudgetCents: number,
  now: Date = new Date()
): AffordabilityPlan {
  const remaining = Math.max(0, Math.round(remainingBudgetCents));

  const ranked = items
    .filter((i) => i.status === 'planned' && i.horizon !== 'someday')
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

  const affordable: ScoredItem[] = [];
  const deferred: ScoredItem[] = [];
  let used = 0;
  let budgetLeft = remaining;

  for (const { item, score, cost } of ranked) {
    const scored: ScoredItem = {
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
