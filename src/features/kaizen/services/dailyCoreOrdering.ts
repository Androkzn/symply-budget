import type { KaizenActionEntry, KaizenHabitStackEntry, KaizenHabitStackStepEntry } from '../types';

const TIME_INDEX: Record<string, number> = {
  morning: 0,
  midday: 1,
  afternoon: 2,
  evening: 3,
  anytime: 4,
};

export type DailyCoreGroup = {
  timeOfDay: string;
  actions: KaizenActionEntry[];
};

/** Resolve stack_id from action field or habit_stack_steps join. */
export function resolveActionStackId(
  action: KaizenActionEntry,
  steps: KaizenHabitStackStepEntry[],
): string | null {
  if (action.stack_id) return action.stack_id;
  const step = steps.find(item => item.action_id === action.id);
  return step?.stack_id ?? null;
}

/** Stack step order within a habit stack (falls back to action.sort_order). */
export function resolveStackStepOrder(
  action: KaizenActionEntry,
  steps: KaizenHabitStackStepEntry[],
): number {
  const step = steps.find(item => item.action_id === action.id);
  return step?.sort_order ?? action.sort_order;
}

/**
 * Simple Health parity: group by time of day, keep habit-stack chains contiguous
 * and in step order; stacked items lead un-stacked within each band.
 */
export function groupDailyCoreActions(
  actions: KaizenActionEntry[],
  steps: KaizenHabitStackStepEntry[],
): DailyCoreGroup[] {
  const buckets = new Map<string, KaizenActionEntry[]>();
  for (const action of actions) {
    const key = (action.time_of_day || 'anytime').toLowerCase();
    const list = buckets.get(key) ?? [];
    list.push(action);
    buckets.set(key, list);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => (TIME_INDEX[a] ?? 99) - (TIME_INDEX[b] ?? 99))
    .map(([timeOfDay, groupActions]) => ({
      timeOfDay,
      actions: orderWithinTimeGroup(groupActions, steps),
    }));
}

function orderWithinTimeGroup(
  actions: KaizenActionEntry[],
  steps: KaizenHabitStackStepEntry[],
): KaizenActionEntry[] {
  return [...actions].sort((lhs, rhs) => {
    const lStack = resolveActionStackId(lhs, steps);
    const rStack = resolveActionStackId(rhs, steps);
    if (lStack && rStack && lStack === rStack) {
      return resolveStackStepOrder(lhs, steps) - resolveStackStepOrder(rhs, steps);
    }
    if (Boolean(lStack) !== Boolean(rStack)) {
      return lStack ? -1 : 1;
    }
    return lhs.sort_order - rhs.sort_order;
  });
}

export function habitStackNameForAction(
  action: KaizenActionEntry,
  stacks: KaizenHabitStackEntry[],
  steps: KaizenHabitStackStepEntry[],
): string | null {
  const stackId = resolveActionStackId(action, steps);
  if (!stackId) return null;
  return stacks.find(stack => stack.id === stackId)?.name ?? null;
}

export function isFirstInHabitStack(
  action: KaizenActionEntry,
  orderedActions: KaizenActionEntry[],
  steps: KaizenHabitStackStepEntry[],
): boolean {
  const stackId = resolveActionStackId(action, steps);
  if (!stackId) return false;
  const first = orderedActions.find(item => resolveActionStackId(item, steps) === stackId);
  return first?.id === action.id;
}
