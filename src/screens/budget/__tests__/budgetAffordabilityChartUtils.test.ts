import type { BudgetItem } from '@api/budget';

import {
  buildAllocationSegments,
  buildPlannedFitRows,
  calendarWeekBounds,
  filterPlannedForWeek,
  isCurrentMonthView,
  planAffordability,
  plannedItemsFromOverview,
  priorityLabel,
  scoreBudgetItem,
  type AffordabilityItemInput,
  type AffordabilityPlanResult,
} from '../budgetAffordabilityChartUtils';

const NOW = new Date('2026-07-02T12:00:00.000Z');

function item(over: Partial<AffordabilityItemInput>): AffordabilityItemInput {
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

describe('planAffordability (client)', () => {
  it('prefers critical items when budget is tight', () => {
    const plan = planAffordability(
      [
        item({ id: 'low', priority: 'low', estimated_cost_min: 20000, estimated_cost_max: 20000 }),
        item({ id: 'high', priority: 'high', estimated_cost_min: 20000, estimated_cost_max: 20000 }),
      ],
      25000,
      NOW
    );
    expect(plan.affordable.map((i) => i.id)).toEqual(['high']);
    expect(plan.deferred.map((i) => i.id)).toEqual(['low']);
  });
});

describe('filterPlannedForWeek', () => {
  it('includes items due in the current calendar week', () => {
    const items = [
      item({ id: 'week', target_date: '2026-07-03' }),
      item({ id: 'later', target_date: '2026-07-20' }),
    ];
    expect(filterPlannedForWeek(items, NOW).map((i) => i.id)).toEqual(['week']);
  });

  it('includes overdue planned items but drops non-planned and undated ones', () => {
    const now = new Date(2026, 6, 2, 12, 0, 0);
    const items = [
      item({ id: 'overdue', target_date: '2026-06-01' }),
      item({ id: 'no-date', target_date: null }),
      item({ id: 'not-planned', target_date: '2026-07-03', status: 'completed' }),
    ];
    expect(filterPlannedForWeek(items, now).map((i) => i.id)).toEqual(['overdue']);
  });
});

describe('estimatedCost via planAffordability', () => {
  it('uses actual_cost when present, else the min/max midpoint with fallbacks', () => {
    const withActual = planAffordability(
      [item({ id: 'actual', actual_cost: 4200, estimated_cost_min: 999, estimated_cost_max: 999 })],
      100000,
      NOW
    );
    expect(withActual.affordable[0]?.estimatedCost).toBe(4200);

    // min null → 0, max null → falls back to min (0) → midpoint 0.
    const noEstimates = planAffordability(
      [item({ id: 'none', actual_cost: null, estimated_cost_min: null, estimated_cost_max: null })],
      100000,
      NOW
    );
    expect(noEstimates.affordable[0]?.estimatedCost).toBe(0);

    // max null → uses min for both ends → midpoint == min.
    const minOnly = planAffordability(
      [item({ id: 'min', actual_cost: null, estimated_cost_min: 6000, estimated_cost_max: null })],
      100000,
      NOW
    );
    expect(minOnly.affordable[0]?.estimatedCost).toBe(6000);
  });
});

describe('buildPlannedFitRows', () => {
  it('sorts high priority before medium regardless of fit', () => {
    const plan = planAffordability(
      [
        item({ id: 'med-fits', priority: 'medium', estimated_cost_min: 5000, estimated_cost_max: 5000 }),
        item({
          id: 'high-deferred',
          priority: 'high',
          estimated_cost_min: 50000,
          estimated_cost_max: 50000,
        }),
      ],
      10000,
      NOW
    );
    const rows = buildPlannedFitRows(plan);
    expect(rows[0]?.priority).toBe('high');
    expect(rows[1]?.priority).toBe('medium');
  });

  it('within the same priority, sorts fitting items before deferred ones', () => {
    const plan = planAffordability(
      [
        item({ id: 'cheap', priority: 'high', estimated_cost_min: 5000, estimated_cost_max: 5000 }),
        item({ id: 'pricey', priority: 'high', estimated_cost_min: 50000, estimated_cost_max: 50000 }),
      ],
      10000, // only the cheap one fits
      NOW
    );
    const rows = buildPlannedFitRows(plan);
    expect(rows[0]?.fits).toBe(true);
    expect(rows[1]?.fits).toBe(false);
  });

  it('within the same priority and fit, sorts the more expensive item first', () => {
    const plan = planAffordability(
      [
        item({ id: 'small', priority: 'high', estimated_cost_min: 3000, estimated_cost_max: 3000 }),
        item({ id: 'big', priority: 'high', estimated_cost_min: 8000, estimated_cost_max: 8000 }),
      ],
      100000, // both fit
      NOW
    );
    const rows = buildPlannedFitRows(plan);
    expect(rows[0]?.estimatedCost).toBe(8000);
    expect(rows[1]?.estimatedCost).toBe(3000);
  });
});

describe('scoreBudgetItem urgency + reasons', () => {
  // Local-noon anchor so parseLocalYMD comparisons are timezone-stable.
  const LOCAL_NOW = new Date(2026, 6, 2, 12, 0, 0); // Thu Jul 2 2026

  it('adds an overdue boost and produces an "overdue" reason', () => {
    const overdue = item({ id: 'o', priority: 'medium', target_date: '2026-06-30' });
    expect(scoreBudgetItem(overdue, LOCAL_NOW)).toBe(40 + 50);
    const plan = planAffordability([overdue], 100000, LOCAL_NOW);
    expect(plan.affordable[0]?.reason).toContain('overdue');
  });

  it('adds a due-today boost and produces a "due today" reason', () => {
    const today = item({ id: 't', priority: 'medium', target_date: '2026-07-02' });
    expect(scoreBudgetItem(today, LOCAL_NOW)).toBe(40 + 30);
    const plan = planAffordability([today], 100000, LOCAL_NOW);
    expect(plan.affordable[0]?.reason).toContain('due today');
  });

  it('adds a due-this-week boost and produces a "due this week" reason', () => {
    const soon = item({ id: 'w', priority: 'medium', target_date: '2026-07-04' });
    expect(scoreBudgetItem(soon, LOCAL_NOW)).toBe(40 + 15);
    const plan = planAffordability([soon], 100000, LOCAL_NOW);
    expect(plan.affordable[0]?.reason).toContain('due this week');
  });

  it('treats an unparseable target date as no due date (null urgency)', () => {
    const bad = item({ id: 'bad', priority: 'low', target_date: 'not-a-date' });
    expect(scoreBudgetItem(bad, LOCAL_NOW)).toBe(20); // low weight, no boost
    const plan = planAffordability([bad], 100000, LOCAL_NOW);
    // Priority is rendered as a badge, so a date-less item has no reason text.
    expect(plan.affordable[0]?.reason).toBe('');
  });
});

describe('misc helpers', () => {
  it('urgencyBoost is zero for dates more than a week out', () => {
    const now = new Date(2026, 6, 2, 12, 0, 0);
    const far = item({ id: 'far', priority: 'high', target_date: '2026-12-31' });
    expect(scoreBudgetItem(far, now)).toBe(60); // high weight, no urgency boost
  });

  it('plannedItemsFromOverview keeps only planned items and maps the fields', () => {
    const base = {
      household_id: 'hh',
      description: null,
      category_id: null,
      timeframe: 'this_month',
      year: 2026,
      quarter: null,
      created_at: '',
      updated_at: '',
    } as unknown as BudgetItem;
    const items: BudgetItem[] = [
      {
        ...base,
        id: 'p',
        title: 'Planned',
        priority: 'high',
        target_date: '2026-07-10',
        estimated_cost_min: 1000,
        estimated_cost_max: 2000,
        actual_cost: null,
        status: 'planned',
      },
      { ...base, id: 'done', title: 'Done', priority: 'low', status: 'completed' } as BudgetItem,
    ];
    const result = plannedItemsFromOverview(items);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'p', estimated_cost_min: 1000, estimated_cost_max: 2000 });
  });

  it('isCurrentMonthView compares year + month against now', () => {
    const now = new Date(2026, 6, 15, 12, 0, 0); // July 2026
    expect(isCurrentMonthView(2026, 7, now)).toBe(true);
    expect(isCurrentMonthView(2026, 8, now)).toBe(false);
    expect(isCurrentMonthView(2025, 7, now)).toBe(false);
  });

  it('buildAllocationSegments derives each item share of the remaining pool', () => {
    const plan = planAffordability(
      [item({ id: 'a', estimated_cost_min: 5000, estimated_cost_max: 5000 })],
      10000,
      NOW
    );
    const segments = buildAllocationSegments(plan);
    expect(segments[0]).toMatchObject({ id: 'a', amount: 5000, share: 0.5 });
  });

  it('priorityLabel capitalizes the priority', () => {
    expect(priorityLabel('critical')).toBe('Critical');
    expect(priorityLabel('low')).toBe('Low');
  });

  it('filterPlannedForWeek defaults "now" to the current date', () => {
    // No `now` arg → exercises the default-parameter branch. Empty list = empty.
    expect(filterPlannedForWeek([])).toEqual([]);
  });

  it('a far-future date yields an empty reason (no urgency signal)', () => {
    const now = new Date(2026, 6, 2, 12, 0, 0);
    const plan = planAffordability(
      [item({ id: 'far', priority: 'high', target_date: '2026-12-31' })],
      100000,
      now
    );
    expect(plan.affordable[0]?.reason).toBe('');
  });

  it('falls back to the lowest weight for an unknown priority', () => {
    const weird = item({ id: 'weird', priority: 'unknown' as never, target_date: null });
    expect(scoreBudgetItem(weird, NOW)).toBe(20);
  });
});

describe('planAffordability tie-breaks', () => {
  it('orders equal-score items by cost, then by id', () => {
    // Same priority (equal score), no dates. Cheaper cost ranks first.
    const byCost = planAffordability(
      [
        item({ id: 'expensive', estimated_cost_min: 8000, estimated_cost_max: 8000 }),
        item({ id: 'cheap', estimated_cost_min: 3000, estimated_cost_max: 3000 }),
      ],
      100000,
      NOW
    );
    expect(byCost.affordable.map((i) => i.id)).toEqual(['cheap', 'expensive']);

    // Equal score AND equal cost → deterministic id order.
    const byId = planAffordability(
      [
        item({ id: 'b', estimated_cost_min: 5000, estimated_cost_max: 5000 }),
        item({ id: 'a', estimated_cost_min: 5000, estimated_cost_max: 5000 }),
      ],
      100000,
      NOW
    );
    expect(byId.affordable.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('id tie-break is stable for BOTH comparison directions', () => {
    // Three equal-score, equal-cost items in reverse order exercise the id
    // comparator in both directions (a<b → -1 AND a>b → 1).
    const plan = planAffordability(
      [
        item({ id: 'c', estimated_cost_min: 5000, estimated_cost_max: 5000 }),
        item({ id: 'a', estimated_cost_min: 5000, estimated_cost_max: 5000 }),
        item({ id: 'b', estimated_cost_min: 5000, estimated_cost_max: 5000 }),
      ],
      100000,
      NOW
    );
    expect(plan.affordable.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('default "now" parameter branches', () => {
  it('planAffordability works with the default (omitted) now argument', () => {
    // Exercises the `now: Date = new Date()` default-parameter branch. An item
    // with no date has no urgency signal, so the result is deterministic.
    const plan = planAffordability([item({ id: 'x', target_date: null })], 100000);
    expect(plan.affordable.map((i) => i.id)).toEqual(['x']);
    expect(plan.remaining_budget).toBe(100000);
  });

  it('isCurrentMonthView works with the default (omitted) now argument', () => {
    const now = new Date();
    // The real current month must read true; a clearly-past month must read false.
    expect(isCurrentMonthView(now.getFullYear(), now.getMonth() + 1)).toBe(true);
    expect(isCurrentMonthView(1999, 1)).toBe(false);
  });
});

describe('calendarWeekBounds', () => {
  it('spans Monday 00:00 → Sunday 23:59 for the week containing the anchor', () => {
    // Wed Jul 15 2026 → week is Mon Jul 13 .. Sun Jul 19.
    const { start, end } = calendarWeekBounds(new Date(2026, 6, 15, 9, 30));
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(6);
    expect(start.getDate()).toBe(13);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(end.getDate()).toBe(19);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  it('treats Sunday as the last day of the current week (not the next)', () => {
    // Sun Jul 19 2026 → same week Mon Jul 13 .. Sun Jul 19.
    const { start, end } = calendarWeekBounds(new Date(2026, 6, 19, 12, 0));
    expect(start.getDate()).toBe(13);
    expect(end.getDate()).toBe(19);
  });

  it('is typed as an AffordabilityPlanResult consumer via buildAllocationSegments', () => {
    // Compile-time use of the AffordabilityPlanResult import; runtime asserts an empty plan.
    const emptyPlan: AffordabilityPlanResult = {
      remaining_budget: 0,
      used_budget: 0,
      affordable: [],
      deferred: [],
    };
    expect(buildAllocationSegments(emptyPlan)).toEqual([]);
  });
});

describe('buildPlannedFitRows fit ordering (both ternary directions)', () => {
  it('keeps fitting items ahead of deferred ones at the same priority, regardless of input order', () => {
    // Two same-priority items where the pricey one is listed FIRST but is
    // deferred; the sort must still surface the fitting item first. This drives
    // the `a.fits ? -1 : 1` branch in both directions across the comparisons.
    const plan = planAffordability(
      [
        item({ id: 'pricey', priority: 'high', estimated_cost_min: 90000, estimated_cost_max: 90000 }),
        item({ id: 'cheap', priority: 'high', estimated_cost_min: 5000, estimated_cost_max: 5000 }),
      ],
      10000, // only 'cheap' fits
      NOW
    );
    const rows = buildPlannedFitRows(plan);
    expect(rows.map((r) => r.id)).toEqual(['cheap', 'pricey']);
    expect(rows.map((r) => r.fits)).toEqual([true, false]);
  });
});

describe('planAffordability — budget clamping & rounding', () => {
  it('clamps a negative remaining budget to 0 (nothing fits)', () => {
    const plan = planAffordability(
      [item({ id: 'a', estimated_cost_min: 5000, estimated_cost_max: 5000 })],
      -5000,
      NOW
    );
    expect(plan.remaining_budget).toBe(0);
    expect(plan.used_budget).toBe(0);
    expect(plan.affordable).toEqual([]);
    expect(plan.deferred.map((i) => i.id)).toEqual(['a']);
  });

  it('rounds a fractional budget input to whole cents', () => {
    const plan = planAffordability([item({ id: 'x', target_date: null })], 5000.7, NOW);
    expect(plan.remaining_budget).toBe(5001);
  });

  it('a zero-cost item fits even with a zero budget', () => {
    const plan = planAffordability(
      [item({ id: 'free', estimated_cost_min: 0, estimated_cost_max: 0 })],
      0,
      NOW
    );
    expect(plan.affordable.map((i) => i.id)).toEqual(['free']);
    expect(plan.used_budget).toBe(0);
  });
});

describe('buildAllocationSegments — pool clamp guards division', () => {
  function scored(id: string, estimatedCost: number) {
    return {
      id,
      title: id,
      priority: 'medium' as const,
      target_date: null,
      status: 'planned' as const,
      estimatedCost,
      score: 40,
      reason: '',
    };
  }

  it('never divides by zero when the remaining pool is 0 (shares exceed 1 by design)', () => {
    const plan: AffordabilityPlanResult = {
      remaining_budget: 0,
      used_budget: 5000,
      affordable: [scored('a', 5000)] as never,
      deferred: [],
    };
    const [seg] = buildAllocationSegments(plan);
    // pool clamps to 1 → share is finite (5000/1), not NaN/Infinity
    expect(Number.isFinite(seg.share)).toBe(true);
    expect(seg.share).toBe(5000);
    expect(seg.amount).toBe(5000);
  });

  it('is empty when there are no affordable items', () => {
    const plan: AffordabilityPlanResult = {
      remaining_budget: 10000,
      used_budget: 0,
      affordable: [],
      deferred: [scored('d', 5000)] as never,
    };
    expect(buildAllocationSegments(plan)).toEqual([]);
  });

  it('sums shares to 1 when items exactly fill the pool', () => {
    const plan: AffordabilityPlanResult = {
      remaining_budget: 10000,
      used_budget: 10000,
      affordable: [scored('a', 6000), scored('b', 4000)] as never,
      deferred: [],
    };
    const segments = buildAllocationSegments(plan);
    expect(segments.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 10);
  });
});

describe('calendarWeekBounds — Monday..Sunday of the containing week', () => {
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  it('a mid-week (Wednesday) anchor spans that Monday..Sunday', () => {
    const { start, end } = calendarWeekBounds(new Date(2026, 6, 15, 12)); // Wed Jul 15 2026
    expect(ymd(start)).toBe('2026-07-13'); // Monday
    expect(start.getDay()).toBe(1);
    expect(ymd(end)).toBe('2026-07-19'); // Sunday
    expect(end.getDay()).toBe(0);
  });

  it('a Sunday anchor stays in the SAME Mon..Sun week (getDay()===0 branch)', () => {
    const { start, end } = calendarWeekBounds(new Date(2026, 6, 19, 12)); // Sun Jul 19 2026
    expect(ymd(start)).toBe('2026-07-13');
    expect(ymd(end)).toBe('2026-07-19');
  });

  it('a Monday anchor starts on itself', () => {
    const { start, end } = calendarWeekBounds(new Date(2026, 6, 13, 12)); // Mon Jul 13 2026
    expect(ymd(start)).toBe('2026-07-13');
    expect(ymd(end)).toBe('2026-07-19');
  });

  it('start is the day floor and end is the day ceiling', () => {
    const { start, end } = calendarWeekBounds(new Date(2026, 6, 15, 8, 30));
    expect([start.getHours(), start.getMinutes(), start.getSeconds()]).toEqual([0, 0, 0]);
    expect([end.getHours(), end.getMinutes(), end.getSeconds(), end.getMilliseconds()]).toEqual([
      23, 59, 59, 999,
    ]);
  });
});
