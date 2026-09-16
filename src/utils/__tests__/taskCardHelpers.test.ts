import type { Task } from '@api/tasks';
import {
  mapSystemCategory,
  getStatusBadge,
  formatDueDate,
  toTaskCardModel,
} from '@utils/taskCardHelpers';

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
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

describe('mapSystemCategory', () => {
  it('routes each backend category to its colour bucket', () => {
    expect(mapSystemCategory('hvac')).toBe('hvac');
    expect(mapSystemCategory('insulation')).toBe('hvac');
    expect(mapSystemCategory('plumbing')).toBe('plumbing');
    expect(mapSystemCategory('pool_spa')).toBe('plumbing');
    expect(mapSystemCategory('appliances')).toBe('electrical');
    expect(mapSystemCategory('smart_home')).toBe('electrical');
    expect(mapSystemCategory('landscaping')).toBe('garden');
    expect(mapSystemCategory('safety')).toBe('safety');
    expect(mapSystemCategory('cleaning')).toBe('cleaning');
    expect(mapSystemCategory('interior')).toBe('exterior');
    expect(mapSystemCategory('roof')).toBe('exterior');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(mapSystemCategory('  HVAC ')).toBe('hvac');
    expect(mapSystemCategory('Plumbing')).toBe('plumbing');
  });

  it('falls through to general for unknown / null / empty', () => {
    expect(mapSystemCategory('finance')).toBe('general');
    expect(mapSystemCategory('pets')).toBe('general');
    expect(mapSystemCategory(undefined)).toBe('general');
    expect(mapSystemCategory(null)).toBe('general');
    expect(mapSystemCategory('')).toBe('general');
    expect(mapSystemCategory('   ')).toBe('general');
  });
});

describe('getStatusBadge', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-15T00:00:00.000Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('completed (inactive) task → complete, regardless of due date', () => {
    expect(getStatusBadge(makeTask({ is_active: false }))).toEqual({ status: 'complete' });
  });

  it('active task with no due date → no badge', () => {
    expect(getStatusBadge(makeTask({ next_due_date: null }))).toEqual({});
  });

  it('overdue → overdue with a positive day count', () => {
    expect(getStatusBadge(makeTask({ next_due_date: '2026-07-14' }))).toEqual({
      status: 'overdue',
      count: 1,
    });
    expect(getStatusBadge(makeTask({ next_due_date: '2026-07-10' }))).toEqual({
      status: 'overdue',
      count: 5,
    });
  });

  it('due today → today (no count)', () => {
    expect(getStatusBadge(makeTask({ next_due_date: '2026-07-15' }))).toEqual({ status: 'today' });
  });

  it('within a week → soon (1..7 days), inclusive of day 7', () => {
    expect(getStatusBadge(makeTask({ next_due_date: '2026-07-16' }))).toEqual({ status: 'soon' });
    expect(getStatusBadge(makeTask({ next_due_date: '2026-07-22' }))).toEqual({ status: 'soon' });
  });

  it('beyond a week → no badge', () => {
    expect(getStatusBadge(makeTask({ next_due_date: '2026-07-23' }))).toEqual({});
  });
});

describe('formatDueDate', () => {
  afterEach(() => jest.useRealTimers());

  it('no due date → empty, not urgent', () => {
    expect(formatDueDate(makeTask({ next_due_date: null }))).toEqual({ label: '', urgent: false });
  });

  describe('anchored to UTC midnight', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-07-15T00:00:00.000Z'));
    });

    it('due today → "Due today", urgent', () => {
      expect(formatDueDate(makeTask({ next_due_date: '2026-07-15' }))).toEqual({
        label: 'Due today',
        urgent: true,
      });
    });

    it('overdue by whole days → "N days overdue" with pluralization', () => {
      expect(formatDueDate(makeTask({ next_due_date: '2026-07-14' }))).toEqual({
        label: '1 day overdue',
        urgent: true,
      });
      expect(formatDueDate(makeTask({ next_due_date: '2026-07-13' }))).toEqual({
        label: '2 days overdue',
        urgent: true,
      });
    });

    it('future → "N day(s) left", not urgent, with singular/plural', () => {
      expect(formatDueDate(makeTask({ next_due_date: '2026-07-16' }))).toEqual({
        label: '1 day left',
        urgent: false,
      });
      expect(formatDueDate(makeTask({ next_due_date: '2026-07-20' }))).toEqual({
        label: '5 days left',
        urgent: false,
      });
    });
  });

  describe('partial-day boundaries (now at noon)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-07-15T12:00:00.000Z'));
    });

    it('less than a day overdue → bare "Overdue", urgent', () => {
      // due midnight today, now noon → 12h overdue (< 1 day)
      expect(formatDueDate(makeTask({ next_due_date: '2026-07-15' }))).toEqual({
        label: 'Overdue',
        urgent: true,
      });
    });

    it('under a day in the future → "Due today", urgent', () => {
      // due midnight tomorrow, now noon → 12h out (< 1 day)
      expect(formatDueDate(makeTask({ next_due_date: '2026-07-16' }))).toEqual({
        label: 'Due today',
        urgent: true,
      });
    });
  });
});

describe('toTaskCardModel', () => {
  it('adapts a task summary into a full Task with inert defaults', () => {
    const model = toTaskCardModel({
      id: 's1',
      system_category: 'plumbing',
      title: 'Fix tap',
      description: 'kitchen',
      frequency: 'monthly',
      custom_interval_days: null,
      next_due_date: '2026-08-01',
      assigned_to: 'user-1',
      is_active: true,
      priority_severity: 'high',
    } as never);

    expect(model.id).toBe('s1');
    expect(model.title).toBe('Fix tap');
    expect(model.system_category).toBe('plumbing');
    expect(model.next_due_date).toBe('2026-08-01');
    expect(model.source).toBe('manual');
    // inert defaults supplied for the full Task shape
    expect(model.reminder_enabled).toBe(false);
    expect(model.reminder_days_before).toBe(1);
    expect(model.reminder_time).toBe('09:00');
    expect(model.last_completed_at).toBeNull();
  });
});
