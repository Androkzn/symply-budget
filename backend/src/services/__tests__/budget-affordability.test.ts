import { describe, it, expect } from 'vitest';

import {
  planAffordability,
  scoreBudgetItem,
  type AffordabilityItem,
} from '../budget-affordability';

const NOW = new Date('2026-06-23T12:00:00.000Z');

function item(over: Partial<AffordabilityItem>): AffordabilityItem {
  return {
    id: 'id',
    title: 'Item',
    priority: 'medium',
    target_date: null,
    estimated_cost_min: 10000,
    estimated_cost_max: 10000,
    actual_cost: null,
    status: 'planned',
    ...over,
  };
}

describe('scoreBudgetItem', () => {
  it('ranks critical + overdue above low-priority no-deadline', () => {
    const hot = item({
      id: 'hot',
      priority: 'critical',
      target_date: '2026-06-20T12:00:00.000Z', // overdue
    });
    const cold = item({ id: 'cold', priority: 'low' });
    expect(scoreBudgetItem(hot, NOW)).toBeGreaterThan(scoreBudgetItem(cold, NOW));
  });
});

describe('planAffordability', () => {
  it('never exceeds the remaining budget', () => {
    const items = [
      item({ id: 'a', estimated_cost_min: 20000, estimated_cost_max: 20000 }),
      item({ id: 'b', estimated_cost_min: 20000, estimated_cost_max: 20000 }),
      item({ id: 'c', estimated_cost_min: 20000, estimated_cost_max: 20000 }),
    ];
    const plan = planAffordability(items, 30000, NOW);
    expect(plan.used_budget).toBeLessThanOrEqual(30000);
  });

  it('prefers higher-scoring items when they compete for the budget', () => {
    const urgent = item({
      id: 'urgent',
      priority: 'critical',
      estimated_cost_min: 25000,
      estimated_cost_max: 25000,
      target_date: '2026-06-20T12:00:00.000Z', // overdue
    });
    const meh = item({
      id: 'meh',
      priority: 'low',
      estimated_cost_min: 25000,
      estimated_cost_max: 25000,
    });
    const plan = planAffordability([meh, urgent], 30000, NOW);
    expect(plan.affordable.map((s) => s.id)).toContain('urgent');
    expect(plan.affordable.map((s) => s.id)).not.toContain('meh');
    expect(plan.deferred.map((s) => s.id)).toContain('meh');
  });

  it('fills cheaper items into leftover budget', () => {
    const big = item({
      id: 'big',
      priority: 'high',
      estimated_cost_min: 45000,
      estimated_cost_max: 45000,
    });
    const small = item({
      id: 'small',
      priority: 'medium',
      estimated_cost_min: 10000,
      estimated_cost_max: 10000,
    });
    const plan = planAffordability([big, small], 60000, NOW);
    const ids = plan.affordable.map((s) => s.id);
    expect(ids).toContain('big');
    expect(ids).toContain('small');
  });

  it('uses cents, not dollars — a $500 cap rejects a $600 item but affords a $250 one', () => {
    const expensive = item({
      id: 'expensive',
      estimated_cost_min: 60000,
      estimated_cost_max: 60000,
    }); // $600
    const cheap = item({ id: 'cheap', estimated_cost_min: 25000, estimated_cost_max: 25000 }); // $250
    const plan = planAffordability([expensive, cheap], 50000, NOW); // $500 cap
    expect(plan.affordable.map((s) => s.id)).toContain('cheap');
    expect(plan.affordable.map((s) => s.id)).not.toContain('expensive');
    expect(plan.deferred.map((s) => s.id)).toContain('expensive');
  });

  it('only ranks status=planned — in_progress/completed are already committed, deferred/cancelled are out', () => {
    const items = [
      item({ id: 'underway', status: 'in_progress' }),
      item({ id: 'done', status: 'completed' }),
      item({ id: 'put-off', status: 'deferred' }),
      item({ id: 'axed', status: 'cancelled' }),
      item({ id: 'open', status: 'planned' }),
    ];
    const plan = planAffordability(items, 100000, NOW);
    const allIds = [...plan.affordable, ...plan.deferred].map((s) => s.id);
    expect(allIds).toEqual(['open']);
  });

  it('returns empty lists for empty input', () => {
    const plan = planAffordability([], 50000, NOW);
    expect(plan.affordable).toEqual([]);
    expect(plan.deferred).toEqual([]);
    expect(plan.used_budget).toBe(0);
  });

  it('treats a negative remaining budget as zero, deferring everything', () => {
    const plan = planAffordability(
      [item({ id: 'a', estimated_cost_min: 100, estimated_cost_max: 100 })],
      -5000,
      NOW
    );
    expect(plan.remaining_budget).toBe(0);
    expect(plan.affordable).toEqual([]);
    expect(plan.deferred.map((s) => s.id)).toEqual(['a']);
  });

  it('is deterministic for equal scores (stable tie-break by cost then id)', () => {
    const a = item({ id: 'a', estimated_cost_min: 10000, estimated_cost_max: 10000 });
    const b = item({ id: 'b', estimated_cost_min: 10000, estimated_cost_max: 10000 });
    const first = planAffordability([a, b], 100000, NOW).affordable.map((s) => s.id);
    const second = planAffordability([b, a], 100000, NOW).affordable.map((s) => s.id);
    expect(first).toEqual(second);
  });
});
