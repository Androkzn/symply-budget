import type { KaizenActionEntry, KaizenHabitStackStepEntry } from '../../types';
import {
  groupDailyCoreActions,
  habitStackNameForAction,
  isFirstInHabitStack,
  resolveActionStackId,
  resolveStackStepOrder,
} from '../dailyCoreOrdering';

const action = (id: string, overrides: Partial<KaizenActionEntry> = {}): KaizenActionEntry =>
  ({
    id,
    user_id: 'u1',
    title: id,
    system: 'health',
    rhythm: 'daily',
    linked_feature: null,
    is_daily_core: 1,
    sort_order: Number(id.replace(/\D/g, '') || 0),
    time_of_day: 'morning',
    stack_id: null,
    rotation_day: null,
    reminder_anchor: null,
    reminder_policy: null,
    watch_quick_log_enabled: 0,
    voice_log_prompt: null,
    input_description: null,
    output_description: null,
    is_archived: 0,
    created_at: '',
    updated_at: '',
    deleted_at: null,
    ...overrides,
  }) as KaizenActionEntry;

const step = (actionId: string, stackId: string, sortOrder: number): KaizenHabitStackStepEntry =>
  ({ id: `s-${actionId}`, user_id: 'u1', stack_id: stackId, action_id: actionId, sort_order: sortOrder, created_at: '', updated_at: '', deleted_at: null }) as KaizenHabitStackStepEntry;

describe('resolveActionStackId', () => {
  it('prefers the action field, then the step join, then null', () => {
    expect(resolveActionStackId(action('a1', { stack_id: 'direct' }), [])).toBe('direct');
    expect(resolveActionStackId(action('a1'), [step('a1', 'joined', 0)])).toBe('joined');
    expect(resolveActionStackId(action('a1'), [])).toBeNull();
  });
});

describe('resolveStackStepOrder', () => {
  it('uses the step order when joined, else the action sort order', () => {
    expect(resolveStackStepOrder(action('a1', { sort_order: 9 }), [step('a1', 's', 2)])).toBe(2);
    expect(resolveStackStepOrder(action('a1', { sort_order: 9 }), [])).toBe(9);
  });
});

describe('groupDailyCoreActions', () => {
  it('orders groups by time of day and pushes unknown bands to the end', () => {
    const actions = [
      action('e1', { time_of_day: 'evening' }),
      action('m1', { time_of_day: 'morning' }),
      action('x1', { time_of_day: 'twilight' }), // unknown → index 99
      action('n1', { time_of_day: '' }), // empty → 'anytime'
      action('mid1', { time_of_day: 'midday' }),
      action('a1', { time_of_day: 'afternoon' }),
    ];
    const grouped = groupDailyCoreActions(actions, []);
    expect(grouped.map(g => g.timeOfDay)).toEqual(['morning', 'midday', 'afternoon', 'evening', 'anytime', 'twilight']);
  });

  it('keeps habit-stack chains contiguous and in step order, stacked before unstacked', () => {
    const actions = [
      action('a3', { sort_order: 3 }),
      action('a1', { stack_id: 'stack-1', sort_order: 5 }),
      action('a2', { stack_id: 'stack-1', sort_order: 4 }),
    ];
    const steps = [step('a1', 'stack-1', 0), step('a2', 'stack-1', 1)];
    const grouped = groupDailyCoreActions(actions, steps);
    // a1,a2 lead by step order (ignoring their sort_order), a3 (unstacked) trails.
    expect(grouped[0].actions.map(a => a.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('sorts unstacked actions by sort_order and orders different stacks by their leaders', () => {
    const actions = [
      action('b1', { stack_id: 'stack-b', sort_order: 1 }),
      action('a1', { stack_id: 'stack-a', sort_order: 9 }),
      action('u2', { sort_order: 7 }),
      action('u1', { sort_order: 2 }),
    ];
    const steps = [step('a1', 'stack-a', 0), step('b1', 'stack-b', 0)];
    const ordered = groupDailyCoreActions(actions, steps)[0].actions.map(a => a.id);
    // Both stacked leaders come before the unstacked; unstacked sorted by sort_order.
    expect(ordered.indexOf('u1')).toBeGreaterThan(ordered.indexOf('a1'));
    expect(ordered.indexOf('u1')).toBeGreaterThan(ordered.indexOf('b1'));
    expect(ordered.indexOf('u1')).toBeLessThan(ordered.indexOf('u2'));
  });
});

describe('habitStackNameForAction', () => {
  const stacks = [{ id: 'stack-1', user_id: 'u1', name: 'Morning stack', sort_order: 0, created_at: '', updated_at: '', deleted_at: null }] as never;

  it('returns the stack name for a stacked action', () => {
    expect(habitStackNameForAction(action('a1', { stack_id: 'stack-1' }), stacks, [])).toBe('Morning stack');
  });

  it('returns null when the action is not stacked', () => {
    expect(habitStackNameForAction(action('a1'), stacks, [])).toBeNull();
  });

  it('returns null when the stack id has no matching stack', () => {
    expect(habitStackNameForAction(action('a1', { stack_id: 'ghost' }), stacks, [])).toBeNull();
  });
});

describe('isFirstInHabitStack', () => {
  const steps = [step('a1', 'stack-1', 0), step('a2', 'stack-1', 1)];

  it('is true only for the first stacked action in the ordered list', () => {
    const a1 = action('a1', { stack_id: 'stack-1' });
    const a2 = action('a2', { stack_id: 'stack-1' });
    expect(isFirstInHabitStack(a1, [a1, a2], steps)).toBe(true);
    expect(isFirstInHabitStack(a2, [a1, a2], steps)).toBe(false);
  });

  it('is false for an unstacked action', () => {
    const solo = action('solo');
    expect(isFirstInHabitStack(solo, [solo], [])).toBe(false);
  });
});
