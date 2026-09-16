/**
 * taskBoardStore — unit tests for the Zustand store.
 *
 * Covers initial state, all filter mutations, groupBy, and hasActiveFilters.
 * No rendering — pure store logic, no native modules needed.
 */

import { useTaskBoardStore, hasActiveFilters } from '@stores/taskBoardStore';

beforeEach(() => {
  useTaskBoardStore.setState({
    viewMode: 'list',
    filters: {
      mineOnly: false,
      dueTodayOnly: false,
      hideDone: false,
      assigneeIds: [],
      spaceIds: [],
      priorities: [],
      statuses: [],
      personalOnly: false,
    },
    groupBy: 'status',
  });
});

describe('taskBoardStore — initial state', () => {
  it('starts with all filters off', () => {
    const { filters } = useTaskBoardStore.getState();
    expect(filters.mineOnly).toBe(false);
    expect(filters.dueTodayOnly).toBe(false);
    expect(filters.hideDone).toBe(false);
    expect(filters.assigneeIds).toEqual([]);
    expect(filters.spaceIds).toEqual([]);
    expect(filters.priorities).toEqual([]);
    expect(filters.statuses).toEqual([]);
    expect(filters.personalOnly).toBe(false);
  });

  it('starts grouped by status', () => {
    expect(useTaskBoardStore.getState().groupBy).toBe('status');
  });

  it('starts in list view mode', () => {
    expect(useTaskBoardStore.getState().viewMode).toBe('list');
  });
});

describe('taskBoardStore — personalOnly filter', () => {
  it('togglePersonalOnly sets personalOnly to true', () => {
    useTaskBoardStore.getState().togglePersonalOnly();
    expect(useTaskBoardStore.getState().filters.personalOnly).toBe(true);
  });

  it('togglePersonalOnly toggles back to false', () => {
    useTaskBoardStore.getState().togglePersonalOnly();
    useTaskBoardStore.getState().togglePersonalOnly();
    expect(useTaskBoardStore.getState().filters.personalOnly).toBe(false);
  });

  it('personalOnly=true contributes to hasActiveFilters', () => {
    useTaskBoardStore.getState().togglePersonalOnly();
    expect(hasActiveFilters(useTaskBoardStore.getState().filters)).toBe(true);
  });
});

describe('taskBoardStore — mineOnly filter', () => {
  it('toggleMineOnly sets mineOnly to true', () => {
    useTaskBoardStore.getState().toggleMineOnly();
    expect(useTaskBoardStore.getState().filters.mineOnly).toBe(true);
  });

  it('toggleMineOnly toggles back to false', () => {
    useTaskBoardStore.getState().toggleMineOnly();
    useTaskBoardStore.getState().toggleMineOnly();
    expect(useTaskBoardStore.getState().filters.mineOnly).toBe(false);
  });
});

describe('taskBoardStore — dueTodayOnly filter', () => {
  it('toggleDueTodayOnly flips the flag', () => {
    useTaskBoardStore.getState().toggleDueTodayOnly();
    expect(useTaskBoardStore.getState().filters.dueTodayOnly).toBe(true);
    useTaskBoardStore.getState().toggleDueTodayOnly();
    expect(useTaskBoardStore.getState().filters.dueTodayOnly).toBe(false);
  });
});

describe('taskBoardStore — hideDone filter', () => {
  it('toggleHideDone flips the flag', () => {
    useTaskBoardStore.getState().toggleHideDone();
    expect(useTaskBoardStore.getState().filters.hideDone).toBe(true);
    useTaskBoardStore.getState().toggleHideDone();
    expect(useTaskBoardStore.getState().filters.hideDone).toBe(false);
  });
});

describe('taskBoardStore — assigneeIds filter', () => {
  it('setAssigneeIds replaces the assignee list', () => {
    useTaskBoardStore.getState().setAssigneeIds(['u1']);
    expect(useTaskBoardStore.getState().filters.assigneeIds).toEqual(['u1']);
  });

  it('setAssigneeIds can clear assignees', () => {
    useTaskBoardStore.getState().setAssigneeIds(['u1', 'u2']);
    useTaskBoardStore.getState().setAssigneeIds([]);
    expect(useTaskBoardStore.getState().filters.assigneeIds).toEqual([]);
  });
});

describe('taskBoardStore — spaceIds filter', () => {
  it('setSpaceIds replaces the space list', () => {
    useTaskBoardStore.getState().setSpaceIds(['s1']);
    expect(useTaskBoardStore.getState().filters.spaceIds).toEqual(['s1']);
  });
});

describe('taskBoardStore — priorities filter', () => {
  it('setPriorities replaces the priority list', () => {
    useTaskBoardStore.getState().setPriorities(['urgent']);
    expect(useTaskBoardStore.getState().filters.priorities).toEqual(['urgent']);
  });
});

describe('taskBoardStore — statuses filter', () => {
  it('toggleStatus adds and removes a status', () => {
    useTaskBoardStore.getState().toggleStatus('overdue');
    expect(useTaskBoardStore.getState().filters.statuses).toContain('overdue');
    useTaskBoardStore.getState().toggleStatus('overdue');
    expect(useTaskBoardStore.getState().filters.statuses).not.toContain('overdue');
  });
});

describe('taskBoardStore — groupBy', () => {
  it('setGroupBy updates the groupBy key', () => {
    useTaskBoardStore.getState().setGroupBy('assignee');
    expect(useTaskBoardStore.getState().groupBy).toBe('assignee');
  });

  it('can switch between status / assignee / area', () => {
    for (const g of ['status', 'assignee', 'area'] as const) {
      useTaskBoardStore.getState().setGroupBy(g);
      expect(useTaskBoardStore.getState().groupBy).toBe(g);
    }
  });
});

describe('taskBoardStore — viewMode', () => {
  it('setViewMode switches list ↔ board', () => {
    useTaskBoardStore.getState().setViewMode('board');
    expect(useTaskBoardStore.getState().viewMode).toBe('board');
    useTaskBoardStore.getState().setViewMode('list');
    expect(useTaskBoardStore.getState().viewMode).toBe('list');
  });
});

describe('taskBoardStore — clearFilters', () => {
  it('resets all filters to their default off state', () => {
    const s = useTaskBoardStore.getState();
    s.togglePersonalOnly();
    s.toggleMineOnly();
    s.setAssigneeIds(['u1']);
    s.setPriorities(['urgent']);
    s.clearFilters();

    const { filters } = useTaskBoardStore.getState();
    expect(filters.personalOnly).toBe(false);
    expect(filters.mineOnly).toBe(false);
    expect(filters.assigneeIds).toEqual([]);
    expect(filters.priorities).toEqual([]);
  });
});

describe('hasActiveFilters', () => {
  it('returns false when no filters are active', () => {
    expect(hasActiveFilters(useTaskBoardStore.getState().filters)).toBe(false);
  });

  it('returns true when mineOnly is true', () => {
    const f = { ...useTaskBoardStore.getState().filters, mineOnly: true };
    expect(hasActiveFilters(f)).toBe(true);
  });

  it('returns true when dueTodayOnly is true', () => {
    const f = { ...useTaskBoardStore.getState().filters, dueTodayOnly: true };
    expect(hasActiveFilters(f)).toBe(true);
  });

  it('returns true when hideDone is true', () => {
    const f = { ...useTaskBoardStore.getState().filters, hideDone: true };
    expect(hasActiveFilters(f)).toBe(true);
  });

  it('returns true when personalOnly is true', () => {
    const f = { ...useTaskBoardStore.getState().filters, personalOnly: true };
    expect(hasActiveFilters(f)).toBe(true);
  });

  it('returns true when assigneeIds is non-empty', () => {
    const f = { ...useTaskBoardStore.getState().filters, assigneeIds: ['u1'] };
    expect(hasActiveFilters(f)).toBe(true);
  });

  it('returns true when priorities is non-empty', () => {
    const f = { ...useTaskBoardStore.getState().filters, priorities: ['urgent' as const] };
    expect(hasActiveFilters(f)).toBe(true);
  });

  it('returns true when spaceIds is non-empty', () => {
    const f = { ...useTaskBoardStore.getState().filters, spaceIds: ['s1'] };
    expect(hasActiveFilters(f)).toBe(true);
  });

  it('returns true when statuses is non-empty', () => {
    const f = { ...useTaskBoardStore.getState().filters, statuses: ['overdue' as const] };
    expect(hasActiveFilters(f)).toBe(true);
  });
});
