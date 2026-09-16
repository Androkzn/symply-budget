import { describe, it, expect } from 'vitest';

import {
  buildReport,
  planSchedule,
  scoreTask,
  type PlannerTask,
} from '../task-planner-service';

const NOW = new Date('2026-06-23T12:00:00.000Z');

// Representative minutes per tier (see time-effort.ts): quick=15, short=30,
// medium=90, half_day=240, all_day=480. The planner packs against these.
function task(over: Partial<PlannerTask>): PlannerTask {
  return {
    id: 'id',
    title: 'Task',
    time_effort: 'short', // 30 min
    priority_severity: 'medium',
    risk_level: 'low',
    next_due_date: null,
    incomplete_subtasks: [],
    ...over,
  };
}

describe('scoreTask', () => {
  it('ranks high-risk + overdue above low-priority no-deadline', () => {
    const hot = task({
      id: 'hot',
      priority_severity: 'high',
      risk_level: 'critical',
      next_due_date: '2026-06-20T12:00:00.000Z', // overdue
    });
    const cold = task({ id: 'cold', priority_severity: 'nice_to_have', risk_level: 'low' });
    expect(scoreTask(hot, NOW)).toBeGreaterThan(scoreTask(cold, NOW));
  });
});

describe('planSchedule', () => {
  it('never exceeds the budget', () => {
    const tasks = [
      task({ id: 'a', time_effort: 'short' }), // 30
      task({ id: 'b', time_effort: 'short' }), // 30
      task({ id: 'c', time_effort: 'short' }), // 30
    ];
    const plan = planSchedule(tasks, 60, NOW);
    expect(plan.used_minutes).toBeLessThanOrEqual(60);
  });

  it('prefers higher-scoring tasks when they compete for the budget', () => {
    const urgent = task({
      id: 'urgent',
      time_effort: 'medium', // 90
      priority_severity: 'critical',
      risk_level: 'critical',
    });
    const meh = task({ id: 'meh', time_effort: 'medium', priority_severity: 'low' }); // 90
    // Budget only fits one 90-min task, so the higher-scoring one wins.
    const plan = planSchedule([meh, urgent], 90, NOW);
    expect(plan.selected.map((s) => s.task_id)).toContain('urgent');
    expect(plan.selected.map((s) => s.task_id)).not.toContain('meh');
  });

  it('fills small tasks into leftover time', () => {
    const big = task({ id: 'big', time_effort: 'short', priority_severity: 'high' }); // 30
    const small = task({ id: 'small', time_effort: 'quick', priority_severity: 'medium' }); // 15
    const plan = planSchedule([big, small], 60, NOW);
    const ids = plan.selected.map((s) => s.task_id);
    expect(ids).toContain('big');
    expect(ids).toContain('small');
  });

  it('includes a task partially via its subtasks when it will not fit whole', () => {
    const big = task({
      id: 'big',
      time_effort: 'medium', // 90 → won't fit a 60 budget whole
      priority_severity: 'high',
      incomplete_subtasks: [
        { id: 's1', title: 'Measure', sort_order: 0 },
        { id: 's2', title: 'Find vendors', sort_order: 1 },
        { id: 's3', title: 'Get quotes', sort_order: 2 },
        { id: 's4', title: 'Install', sort_order: 3 },
      ],
    });
    const plan = planSchedule([big], 60, NOW); // perSub = round(90/4)=23 → floor(60/23)=2 fit
    expect(plan.selected).toHaveLength(1);
    expect(plan.selected[0].partial).toBe(true);
    expect(plan.selected[0].subtask_ids).toEqual(['s1', 's2']);
    expect(plan.used_minutes).toBeLessThanOrEqual(60);
  });

  it('marks a too-long task with no subtasks as skipped', () => {
    const plan = planSchedule([task({ id: 'huge', time_effort: 'half_day' })], 60, NOW); // 240 > 60
    expect(plan.selected).toHaveLength(0);
    expect(plan.skipped[0]).toMatchObject({ task_id: 'huge', reason: 'too_long' });
  });

  it('uses the default duration when the effort tier is missing', () => {
    const plan = planSchedule([task({ id: 'x', time_effort: null })], 60, NOW);
    expect(plan.selected[0].minutes).toBe(30);
  });

  it('excludes blocked tasks from the plan', () => {
    const blocked = task({
      id: 'blocked',
      time_effort: 'quick', // 15
      priority_severity: 'critical',
      risk_level: 'critical',
      blocked: true,
    });
    const open = task({ id: 'open', time_effort: 'quick', priority_severity: 'low' }); // 15
    const plan = planSchedule([blocked, open], 60, NOW);
    const ids = plan.selected.map((s) => s.task_id);
    expect(ids).toContain('open');
    expect(ids).not.toContain('blocked');
  });

  it('is deterministic for equal scores (stable tie-break)', () => {
    const a = task({ id: 'a', time_effort: 'quick' }); // 15
    const b = task({ id: 'b', time_effort: 'quick' }); // 15
    const first = planSchedule([a, b], 100, NOW).selected.map((s) => s.task_id);
    const second = planSchedule([b, a], 100, NOW).selected.map((s) => s.task_id);
    expect(first).toEqual(second);
  });
});

describe('buildReport', () => {
  it('counts tasks by due-window and flags high risk', () => {
    const tasks = [
      task({ id: 'o', next_due_date: '2026-06-20T12:00:00.000Z', risk_level: 'high' }), // overdue
      task({ id: 't', next_due_date: '2026-06-23T12:00:00.000Z' }), // today
      task({ id: 'w', next_due_date: '2026-06-27T12:00:00.000Z' }), // this week
      task({ id: 'l', next_due_date: '2026-08-01T12:00:00.000Z' }), // later
      task({ id: 'n', next_due_date: null }), // no due date
    ];
    const report = buildReport(tasks, NOW);
    expect(report.total_active).toBe(5);
    expect(report.overdue).toBe(1);
    expect(report.due_today).toBe(1);
    expect(report.due_this_week).toBe(1);
    expect(report.later).toBe(1);
    expect(report.no_due_date).toBe(1);
    expect(report.high_risk).toBe(1);
    expect(report.top_tasks[0].task_id).toBe('o'); // overdue + high risk ranks first
  });
});
