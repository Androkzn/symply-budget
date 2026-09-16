import { describe, it, expect } from 'vitest';

import { deriveReminderPlan } from '../reminder-service';

describe('deriveReminderPlan', () => {
  it('honors the AI suggested deadline when provided', () => {
    const plan = deriveReminderPlan({
      priority_severity: 'medium',
      risk_level: 'medium',
      suggested_due_in_days: 5,
    });
    expect(plan.due_in_days).toBe(5);
  });

  it('falls back to a priority default when no deadline is suggested', () => {
    expect(
      deriveReminderPlan({
        priority_severity: 'low',
        risk_level: 'low',
        suggested_due_in_days: null,
      }).due_in_days
    ).toBe(14);

    expect(
      deriveReminderPlan({
        priority_severity: 'nice_to_have',
        risk_level: 'low',
        suggested_due_in_days: null,
      }).due_in_days
    ).toBe(30);
  });

  it('tightens the deadline as a safety backstop for high/critical risk', () => {
    // Low priority but critical risk (e.g. overheating router) -> must be ~1 day.
    const critical = deriveReminderPlan({
      priority_severity: 'low',
      risk_level: 'critical',
      suggested_due_in_days: 14,
    });
    expect(critical.due_in_days).toBe(1);

    const high = deriveReminderPlan({
      priority_severity: 'low',
      risk_level: 'high',
      suggested_due_in_days: 30,
    });
    expect(high.due_in_days).toBe(3);
  });

  it('never schedules a reminder before "now" for same/next-day tasks', () => {
    const plan = deriveReminderPlan({
      priority_severity: 'urgent',
      risk_level: 'high',
      suggested_due_in_days: 1,
    });
    expect(plan.reminder_days_before).toBeLessThanOrEqual(plan.due_in_days);
    expect(plan.reminder_days_before).toBeGreaterThanOrEqual(0);
  });

  it('uses longer nudge lead time for low-priority, far-out tasks', () => {
    const plan = deriveReminderPlan({
      priority_severity: 'low',
      risk_level: 'low',
      suggested_due_in_days: 14,
    });
    expect(plan.reminder_days_before).toBe(3);
  });

  it('treats a missing priority as nice_to_have', () => {
    const plan = deriveReminderPlan({
      priority_severity: null,
      risk_level: null,
      suggested_due_in_days: null,
    });
    expect(plan.due_in_days).toBe(30);
  });
});
