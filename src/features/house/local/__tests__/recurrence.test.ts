/**
 * Parity fixtures for the ported recurrence engine (DoD H3: "ported server logic
 * each has a unit test asserting parity with the server implementation's
 * fixtures").
 *
 * The `rollForwardDueDate` cases below are the SAME cases as
 * `backend/src/services/__tests__/reminder-date-math.test.ts` — copied
 * deliberately, so that if the server's month-overflow behaviour ever changes,
 * two suites go red instead of one silently drifting. Month overflow and leap
 * days are exactly where `setMonth`/`setFullYear` bite, which is why the server
 * wrote those fixtures in the first place.
 */
import {
  addDays,
  calculateNextDueDate,
  COMPLETION_INTERVAL_DAYS,
  daysUntilDue,
  nextDueDateAfterCompletion,
  rollForwardDueDate,
  subtaskReminderDate,
} from '../logic/recurrence';

const nextDue = (from: string, frequency: string) => rollForwardDueDate(new Date(from), frequency);

/** Whole days between two ISO instants — the unit every interval assertion uses. */
const daysBetween = (from: string, to: string) =>
  Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000);

describe('rollForwardDueDate — parity with ReminderService.calculateNextDueDate', () => {
  it('daily / weekly add whole days', () => {
    expect(nextDue('2026-03-10', 'daily')).toBe('2026-03-11');
    expect(nextDue('2026-03-10', 'weekly')).toBe('2026-03-17');
  });

  it('monthly advances one month for an in-range day', () => {
    expect(nextDue('2026-03-10', 'monthly')).toBe('2026-04-10');
  });

  it('monthly from Jan 31 overflows through February (non-leap year → Mar 3)', () => {
    expect(nextDue('2026-01-31', 'monthly')).toBe('2026-03-03');
  });

  it('monthly from Jan 31 overflows through February (leap year → Mar 2)', () => {
    expect(nextDue('2024-01-31', 'monthly')).toBe('2024-03-02');
  });

  it('monthly rolls into the next year', () => {
    expect(nextDue('2026-12-15', 'monthly')).toBe('2027-01-15');
  });

  it('quarterly adds three months, crossing the year boundary', () => {
    expect(nextDue('2026-01-15', 'quarterly')).toBe('2026-04-15');
    expect(nextDue('2026-11-15', 'quarterly')).toBe('2027-02-15');
  });

  it('yearly adds a year', () => {
    expect(nextDue('2026-03-10', 'yearly')).toBe('2027-03-10');
  });

  it('yearly from a leap day rolls Feb 29 into the next March 1', () => {
    expect(nextDue('2024-02-29', 'yearly')).toBe('2025-03-01');
  });

  it('multi-year frequencies advance the year', () => {
    // Not in the client's `frequency` union at all — the cron path passes
    // `system_category` here (reminder-service.ts:348), so the port takes a
    // bare string and must keep understanding these.
    expect(nextDue('2026-03-10', '3_years')).toBe('2029-03-10');
    expect(nextDue('2026-03-10', '5_years')).toBe('2031-03-10');
  });

  it('an unknown frequency defaults to monthly', () => {
    expect(nextDue('2026-03-10', 'fortnightly?')).toBe('2026-04-10');
  });

  it('emits date-only, because that is what the column stores', () => {
    expect(nextDue('2026-03-10T18:45:00.000Z', 'daily')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('crosses a DST boundary without losing a day', () => {
    // The regression that forced the UTC accessors (see recurrence.ts header):
    // Jan 15 → Apr 15 crosses into PDT, and the local-accessor form landed on
    // Apr 14 on any device west of UTC. A phone must agree with the Worker, and
    // with a household member in another zone.
    expect(nextDue('2026-01-15', 'quarterly')).toBe('2026-04-15');
    expect(nextDue('2026-03-01', 'monthly')).toBe('2026-04-01');
    expect(nextDue('2026-10-25', 'weekly')).toBe('2026-11-01');
  });
});

describe('nextDueDateAfterCompletion — parity with TaskService.calculateNextDueDate', () => {
  const from = new Date('2026-03-10T00:00:00.000Z');

  it('returns null for a one-time task', () => {
    // The regression this guards: `intervals['one_time']` was `undefined`,
    // reached `addDays()`, and threw RangeError on the first completion.
    expect(nextDueDateAfterCompletion('one_time', null, from)).toBeNull();
  });

  it('uses FIXED day intervals, not calendar months', () => {
    expect(daysBetween(from.toISOString(), nextDueDateAfterCompletion('daily', null, from)!)).toBe(1);
    expect(daysBetween(from.toISOString(), nextDueDateAfterCompletion('weekly', null, from)!)).toBe(7);
    // 30, not "one month" — March 10 + 30d = April 9, and that is correct here.
    expect(daysBetween(from.toISOString(), nextDueDateAfterCompletion('monthly', null, from)!)).toBe(30);
    expect(daysBetween(from.toISOString(), nextDueDateAfterCompletion('quarterly', null, from)!)).toBe(90);
    expect(daysBetween(from.toISOString(), nextDueDateAfterCompletion('yearly', null, from)!)).toBe(365);
  });

  it('honours custom_interval_days, falling back to 30 when null', () => {
    expect(daysBetween(from.toISOString(), nextDueDateAfterCompletion('custom', 45, from)!)).toBe(45);
    expect(daysBetween(from.toISOString(), nextDueDateAfterCompletion('custom', null, from)!)).toBe(30);
    // `customIntervalDays || 30` — a zero interval is falsy on the server too,
    // so it lands on 30 rather than on "due again immediately".
    expect(daysBetween(from.toISOString(), nextDueDateAfterCompletion('custom', 0, from)!)).toBe(30);
  });

  it('anchors on NOW when no reference date is given', () => {
    const rolled = nextDueDateAfterCompletion('weekly', null)!;
    expect(daysBetween(new Date().toISOString(), rolled)).toBe(7);
  });

  it('emits a full ISO instant, because addDays() does', () => {
    expect(nextDueDateAfterCompletion('daily', null, from)).toBe('2026-03-11T00:00:00.000Z');
  });

  it('diverges from the calendar variant for monthly — deliberately', () => {
    // Same input, two server implementations, two answers. Both are ported and
    // neither is allowed to quietly become the other.
    expect(nextDueDateAfterCompletion('monthly', null, from)!.slice(0, 10)).toBe('2026-04-09');
    expect(calculateNextDueDate('monthly', null, from).slice(0, 10)).toBe('2026-04-10');
  });

  it('exposes the interval table the server hard-codes', () => {
    expect(COMPLETION_INTERVAL_DAYS).toEqual({
      daily: 1,
      weekly: 7,
      monthly: 30,
      quarterly: 90,
      yearly: 365,
      custom: 30,
    });
  });
});

describe('calculateNextDueDate — parity with utils/id.ts', () => {
  const from = new Date('2026-01-31T00:00:00.000Z');

  it('advances calendar months, overflow included', () => {
    expect(calculateNextDueDate('monthly', null, from).slice(0, 10)).toBe('2026-03-03');
    expect(calculateNextDueDate('quarterly', null, from).slice(0, 10)).toBe('2026-05-01');
  });

  it('leaves the date untouched for one_time and for custom with no interval', () => {
    // The server's switch has no `one_time` arm and guards `custom` on a truthy
    // interval, so both fall through returning the input date.
    expect(calculateNextDueDate('one_time', null, from)).toBe(from.toISOString());
    expect(calculateNextDueDate('custom', null, from)).toBe(from.toISOString());
  });
});

describe('daysUntilDue — ceil semantics', () => {
  it('counts whole days to a future date', () => {
    expect(daysUntilDue('2026-07-20', new Date('2026-07-15T00:00:00Z'))).toBe(5);
  });

  it('rounds a partial day UP (any time today toward tomorrow is 1)', () => {
    expect(daysUntilDue('2026-07-16', new Date('2026-07-15T12:00:00Z'))).toBe(1);
  });

  it('returns 0 on the due date itself, which is what "due today" keys on', () => {
    expect(daysUntilDue('2026-07-15', new Date('2026-07-15T00:00:00Z'))).toBe(0);
  });

  it('goes negative for an overdue date', () => {
    expect(daysUntilDue('2026-07-10', new Date('2026-07-15T00:00:00Z'))).toBe(-5);
  });

  it('degrades to null rather than NaN for missing or unparseable dates', () => {
    expect(daysUntilDue(null, new Date())).toBeNull();
    expect(daysUntilDue('not a date', new Date())).toBeNull();
  });
});

describe('subtaskReminderDate — parity with SubtaskService', () => {
  it('subtracts the lead days from the parent due date', () => {
    expect(subtaskReminderDate('2026-05-10T00:00:00.000Z', true, 3)).toBe(
      '2026-05-07T00:00:00.000Z',
    );
  });

  it('defaults to one day before when the lead is null', () => {
    expect(subtaskReminderDate('2026-05-10T00:00:00.000Z', true, null)).toBe(
      '2026-05-09T00:00:00.000Z',
    );
  });

  it('is null when reminders are off or the parent has no due date', () => {
    expect(subtaskReminderDate('2026-05-10T00:00:00.000Z', false, 3)).toBeNull();
    expect(subtaskReminderDate(null, true, 3)).toBeNull();
  });
});

describe('addDays', () => {
  it('is the server helper, full ISO out', () => {
    expect(addDays(5, new Date('2026-03-10T09:30:00.000Z'))).toBe('2026-03-15T09:30:00.000Z');
  });
});
