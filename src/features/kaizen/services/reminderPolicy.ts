/**
 * Action reminder policy — port of Simple Health `ActionReminderPolicy`.
 * Stored on `kaizen_actions.reminder_policy` as JSON or shorthand string.
 */
export interface ActionReminderPolicy {
  anchor: 'none' | 'wakeResponsive' | 'timeOfDay';
  initialDelayMinutes: number;
  repeatEveryMinutes?: number;
  maxNudges: number;
  quietAfterHour?: number;
  snoozeOptionsMinutes: number[];
  requiredBeforeBreakfast?: boolean;
}

export const POLICY_NONE: ActionReminderPolicy = {
  anchor: 'none',
  initialDelayMinutes: 0,
  maxNudges: 0,
  snoozeOptionsMinutes: [10, 30, 60],
};

export const WAKE_RESPONSIVE_REQUIRED: ActionReminderPolicy = {
  anchor: 'wakeResponsive',
  initialDelayMinutes: 5,
  repeatEveryMinutes: 30,
  maxNudges: 4,
  quietAfterHour: 12,
  snoozeOptionsMinutes: [10, 30, 60],
  requiredBeforeBreakfast: true,
};

export const TIME_OF_DAY_DEFAULT: ActionReminderPolicy = {
  anchor: 'timeOfDay',
  initialDelayMinutes: 0,
  maxNudges: 1,
  snoozeOptionsMinutes: [10, 30, 60],
};

export function parseReminderPolicy(
  reminderAnchor: string | null | undefined,
  reminderPolicy: string | null | undefined,
): ActionReminderPolicy | null {
  const anchor = (reminderAnchor ?? 'none').toLowerCase();
  if (anchor === 'none' && (!reminderPolicy || reminderPolicy === 'none')) {
    return null;
  }

  if (reminderPolicy === 'wakeResponsiveRequired') {
    return WAKE_RESPONSIVE_REQUIRED;
  }

  if (reminderPolicy) {
    try {
      const parsed = JSON.parse(reminderPolicy) as Partial<ActionReminderPolicy>;
      if (parsed && typeof parsed === 'object') {
        return {
          ...POLICY_NONE,
          ...parsed,
          snoozeOptionsMinutes: parsed.snoozeOptionsMinutes ?? [10, 30, 60],
        };
      }
    } catch {
      /* fall through */
    }
  }

  if (anchor === 'wakeresponsive' || anchor === 'wake_responsive') {
    return WAKE_RESPONSIVE_REQUIRED;
  }
  if (anchor === 'timeofday' || anchor === 'time_of_day') {
    return TIME_OF_DAY_DEFAULT;
  }
  return null;
}

export function policyToStorage(policy: ActionReminderPolicy | null): string | null {
  if (!policy || policy.maxNudges === 0) return null;
  if (
    policy.anchor === 'wakeResponsive' &&
    policy.initialDelayMinutes === 5 &&
    policy.maxNudges === 4
  ) {
    return 'wakeResponsiveRequired';
  }
  return JSON.stringify(policy);
}
