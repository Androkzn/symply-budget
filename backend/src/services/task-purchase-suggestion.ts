/**
 * "Add to planned spending" suggestion — pure, server-side display logic.
 *
 * The mobile chip is purely presentational: it renders whatever this produces.
 * All the decision tree (show/hide, which state), copy, and cost formatting
 * live here so behaviour is consistent across clients and changeable via a
 * backend deploy. See TaskService.mapTaskResponse (the only caller).
 */
import type { TaskPurchaseSuggestion } from '../types';

/** The subset of a task row this computation reads (structurally satisfied by schema.Task). */
export interface PurchaseSuggestionInput {
  /** AI judged the task requires buying something. */
  is_purchase?: boolean | null;
  /** budget_items.id once the user accepted the suggestion. */
  budget_item_id?: string | null;
  /** User dismissed the chip. */
  purchase_suggestion_dismissed?: boolean | null;
  /** Rough low-end cost estimate in CENTS. */
  purchase_estimated_cost_min?: number | null;
  /** Rough high-end cost estimate in CENTS. */
  purchase_estimated_cost_max?: number | null;
}

/** Format a cents range as "$40" or "$40–$90"; null when both bounds are absent. */
export function formatCentsRange(min: number | null, max: number | null): string | null {
  const f = (c: number) => `$${Math.round(c / 100)}`;
  if (min == null && max == null) return null;
  if (min == null || max == null || min === max) return f((min ?? max) as number);
  return `${f(min)}–${f(max)}`;
}

/**
 * Compute the suggestion for a task, or null when nothing should be shown
 * (not a purchase, or the user dismissed it).
 */
export function buildPurchaseSuggestion(
  task: PurchaseSuggestionInput
): TaskPurchaseSuggestion | null {
  if (!task.is_purchase) return null;

  // Already accepted — show a quiet confirmation.
  if (task.budget_item_id) {
    return {
      state: 'added',
      title: 'Added to planned spending',
      subtitle: null,
      amount_label: null,
      action_label: 'Add',
    };
  }

  if (task.purchase_suggestion_dismissed) return null;

  const amountLabel = formatCentsRange(
    task.purchase_estimated_cost_min ?? null,
    task.purchase_estimated_cost_max ?? null
  );
  return {
    state: 'actionable',
    title: 'Looks like a purchase',
    subtitle: amountLabel ? `Add to planned spending · ~${amountLabel}` : 'Add to planned spending',
    amount_label: amountLabel,
    action_label: 'Add',
  };
}
