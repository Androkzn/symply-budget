import type { Task } from '@api/tasks';
import { deriveStatus, daysUntilDue, isRecentlyCompleted } from '@utils/taskStatus';

const DAY = 1000 * 60 * 60 * 24;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    system_category: null,
    title: 'Test task',
    description: null,
    frequency: 'one_time',
    custom_interval_days: null,
    next_due_date: null,
    last_completed_at: null,
    assigned_to: null,
    is_active: true,
    source: 'manual',
    reminder_enabled: true,
    reminder_days_before: 1,
    reminder_time: '09:00',
    reminder_repeat: true,
    created_at: iso(-10),
    updated_at: iso(-10),
    ...overrides,
  };
}

describe('deriveStatus', () => {
  it('returns done for inactive tasks', () => {
    expect(deriveStatus(makeTask({ is_active: false }))).toBe('done');
  });

  it('returns blocked over due-date buckets', () => {
    expect(deriveStatus(makeTask({ blocked: true, next_due_date: iso(-5) }))).toBe('blocked');
  });

  it('returns done for recently completed tasks', () => {
    expect(deriveStatus(makeTask({ last_completed_at: iso(-2) }))).toBe('done');
  });

  it('returns in_progress for active contractor workflow stages', () => {
    expect(deriveStatus(makeTask({ workflow_stage: 'scheduled' }))).toBe('in_progress');
  });

  it('returns overdue when the due date is in the past', () => {
    expect(deriveStatus(makeTask({ next_due_date: iso(-1) }))).toBe('overdue');
  });

  it('returns todo for a future due date', () => {
    expect(deriveStatus(makeTask({ next_due_date: iso(5) }))).toBe('todo');
  });

  it('returns todo for no due date', () => {
    expect(deriveStatus(makeTask({ next_due_date: null }))).toBe('todo');
  });
});

describe('daysUntilDue', () => {
  it('is null without a due date', () => {
    expect(daysUntilDue(makeTask())).toBeNull();
  });
  it('is 0 for a task due today', () => {
    expect(daysUntilDue(makeTask({ next_due_date: iso(0) }))).toBe(0);
  });
  it('is negative when overdue', () => {
    expect(daysUntilDue(makeTask({ next_due_date: iso(-3) }))).toBeLessThan(0);
  });
});

describe('isRecentlyCompleted', () => {
  it('is true within 7 days', () => {
    expect(isRecentlyCompleted(makeTask({ last_completed_at: iso(-6) }))).toBe(true);
  });
  it('is false beyond 7 days', () => {
    expect(isRecentlyCompleted(makeTask({ last_completed_at: iso(-9) }))).toBe(false);
  });
  it('is false when never completed', () => {
    expect(isRecentlyCompleted(makeTask())).toBe(false);
  });
});
