/**
 * Smoke/contract tests for the Tasks dashboard data engine. The hook has no
 * provider/native dependencies (just useMemo + pure utils), so we render it
 * through a tiny harness and assert the grouped sections / summary / filtered
 * results the List and Board views consume.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { HouseholdSpace } from '@api/household-spaces';
import type { HouseholdMember } from '@api/households';
import type { Task } from '@api/tasks';
import { useTaskBoardData, type BoardSection, type BoardSummary } from '@hooks/useTaskBoardData';
import type { TaskBoardFilters, TaskGroupBy } from '@stores/taskBoardStore';

const DAY = 1000 * 60 * 60 * 24;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: Math.random().toString(36).slice(2),
    system_category: null,
    title: 'Task',
    description: null,
    frequency: 'one_time',
    custom_interval_days: null,
    next_due_date: null,
    last_completed_at: null,
    assigned_to: null,
    space_id: null,
    is_active: true,
    source: 'manual',
    priority_severity: 'medium',
    reminder_enabled: true,
    reminder_days_before: 1,
    reminder_time: '09:00',
    reminder_repeat: true,
    created_at: iso(-10),
    updated_at: iso(-10),
    ...overrides,
  };
}

const members: HouseholdMember[] = [
  { id: 'm1', user_id: 'u1', display_name: 'Alice', avatar_url: null, email: 'a@x.com', role: 'owner', joined_at: iso(-30) },
  { id: 'm2', user_id: 'u2', display_name: 'Bob', avatar_url: null, email: 'b@x.com', role: 'member', joined_at: iso(-20) },
];

const spaces = [
  { id: 's1', name: 'Kitchen', icon_emoji: '🍳', display_order: 0 } as HouseholdSpace,
  { id: 's2', name: 'Garage', icon_emoji: '🚗', display_order: 1 } as HouseholdSpace,
];

const emptyFilters: TaskBoardFilters = {
  mineOnly: false,
  dueTodayOnly: false,
  hideDone: false,
  assigneeIds: [],
  spaceIds: [],
  priorities: [],
  statuses: [],
  personalOnly: false,
};

// Fixtures spanning every status / assignee / area / priority axis.
const T = {
  overdue: makeTask({ title: 'Fix gutter', next_due_date: iso(-3), assigned_to: { id: 'u1', display_name: 'Alice' }, space_id: 's1', priority_severity: 'high' }),
  todo: makeTask({ title: 'Wash windows', next_due_date: iso(5), assigned_to: { id: 'u2', display_name: 'Bob' }, space_id: 's2', priority_severity: 'low' }),
  blocked: makeTask({ title: 'Replace pipe', blocked: true, assigned_to: { id: 'u1', display_name: 'Alice' } }),
  done: makeTask({ title: 'Mow lawn', is_active: false }),
  dueToday: makeTask({ title: 'Buy filter', next_due_date: iso(0), assigned_to: { id: 'u1', display_name: 'Alice' }, space_id: 's1', priority_severity: 'urgent' }),
  inProgress: makeTask({ title: 'Roof quote', workflow_stage: 'scheduled', space_id: 's2' }),
};
const ALL = Object.values(T);

function run(opts: { groupBy?: TaskGroupBy; filters?: Partial<TaskBoardFilters>; search?: string; tasks?: Task[] }) {
  let result: { sections: BoardSection[]; summary: BoardSummary; filtered: Task[] } | null = null;
  function Harness() {
    result = useTaskBoardData({
      tasks: opts.tasks ?? ALL,
      members,
      spaces,
      currentUserId: 'u1',
      filters: { ...emptyFilters, ...(opts.filters ?? {}) },
      groupBy: opts.groupBy ?? 'status',
      search: opts.search ?? '',
    });
    return null;
  }
  act(() => {
    ReactTestRenderer.create(<Harness />);
  });
  return result!;
}

const sec = (sections: BoardSection[], key: string) => sections.find((s) => s.key === key);
const titles = (section?: BoardSection) => (section?.tasks ?? []).map((t) => t.title);

describe('useTaskBoardData — summary', () => {
  it('counts overdue / due today / mine / blocked over the unfiltered set', () => {
    const { summary } = run({});
    expect(summary).toEqual<BoardSummary>({ overdue: 1, dueToday: 1, mine: 3, blocked: 1, total: 6 });
  });
});

describe('useTaskBoardData — group by status', () => {
  it('returns all 5 columns in canonical order', () => {
    const { sections } = run({ groupBy: 'status' });
    expect(sections.map((s) => s.key)).toEqual(['overdue', 'todo', 'in_progress', 'blocked', 'done']);
  });

  it('buckets each task into its derived status', () => {
    const { sections } = run({ groupBy: 'status' });
    expect(titles(sec(sections, 'overdue'))).toEqual(['Fix gutter']);
    expect(titles(sec(sections, 'todo')).sort()).toEqual(['Buy filter', 'Wash windows']);
    expect(titles(sec(sections, 'in_progress'))).toEqual(['Roof quote']);
    expect(titles(sec(sections, 'blocked'))).toEqual(['Replace pipe']);
    expect(titles(sec(sections, 'done'))).toEqual(['Mow lawn']);
  });
});

describe('useTaskBoardData — filters', () => {
  it('hideDone drops done tasks', () => {
    const { filtered } = run({ filters: { hideDone: true } });
    expect(filtered.map((t) => t.title)).not.toContain('Mow lawn');
    expect(filtered).toHaveLength(5);
  });

  it('mineOnly keeps only the current user’s tasks', () => {
    const { filtered } = run({ filters: { mineOnly: true } });
    expect(filtered.map((t) => t.title).sort()).toEqual(['Buy filter', 'Fix gutter', 'Replace pipe']);
  });

  it('dueTodayOnly keeps only tasks due today', () => {
    const { filtered } = run({ filters: { dueTodayOnly: true } });
    expect(filtered.map((t) => t.title)).toEqual(['Buy filter']);
  });

  it('assignee filter narrows to selected members', () => {
    const { filtered } = run({ filters: { assigneeIds: ['u2'] } });
    expect(filtered.map((t) => t.title)).toEqual(['Wash windows']);
  });

  it('area filter narrows to selected spaces', () => {
    const { filtered } = run({ filters: { spaceIds: ['s1'] } });
    expect(filtered.map((t) => t.title).sort()).toEqual(['Buy filter', 'Fix gutter']);
  });

  it('priority filter narrows to selected priorities', () => {
    const { filtered } = run({ filters: { priorities: ['urgent'] } });
    expect(filtered.map((t) => t.title)).toEqual(['Buy filter']);
  });

  it('search matches title text', () => {
    const { filtered } = run({ search: 'gutter' });
    expect(filtered.map((t) => t.title)).toEqual(['Fix gutter']);
  });
});

describe('useTaskBoardData — group by assignee / area', () => {
  it('orders assignee groups: current user first, unassigned last', () => {
    const { sections } = run({ groupBy: 'assignee' });
    expect(sections[0].key).toBe('u1');
    expect(sections[0].title).toContain('(You)');
    expect(sections[sections.length - 1].key).toBe('__unassigned__');
  });

  it('labels area groups with space names and sinks "No area" last', () => {
    const { sections } = run({ groupBy: 'area' });
    expect(sec(sections, 's1')?.title).toBe('Kitchen');
    expect(sections[sections.length - 1].key).toBe('__no_area__');
    expect(titles(sec(sections, 's1')).sort()).toEqual(['Buy filter', 'Fix gutter']);
  });
});
