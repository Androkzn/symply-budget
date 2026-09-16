/**
 * When the Budget chat assistant mutates spendings/budget (receipt log, add
 * expense, set budget, …), bump the shared budget + savings revision buses so
 * Dashboard / Spendings / Planned / Category / Savings screens refetch.
 */
import { useBudgetStore } from '@stores/budgetStore';
import { useSavingsStore } from '@stores/savingsStore';

import type { ChatMessage } from './types';

/** True when an AI chat message reports that budget data changed server-side. */
export function chatMessageMutatedBudget(message: ChatMessage): boolean {
  if (message.sender_type !== 'ai') return false;
  const meta = message.metadata;
  if (!meta || typeof meta !== 'object') return false;
  // receiptDraft is scan-only (confirm screen) — not a mutation until the user saves.
  return meta.budgetMutated === true;
}

/** Invalidate all budget/savings views for this household. */
export function refreshBudgetAfterChatMutation(householdId: string): void {
  useBudgetStore.getState().markInsightsDirty(householdId);
  useSavingsStore.getState().markDirty();
}
