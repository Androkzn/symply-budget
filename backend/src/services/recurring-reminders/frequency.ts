import { dueDateFromDaysInTz } from '../../utils/timezone';

/**
 * How often a still-pending recurring reminder gets re-nudged. Picking a
 * preset does double duty — it both defers the very next nudge AND becomes the
 * ongoing cadence for that reminder until it's marked done, which is what lets
 * "snooze this one" and "change how often I get nudged" be the same action
 * (matches the push-vs-in-app parity `routeNotificationTap` already gives
 * every other notification type).
 *
 * Keep the id list in sync with the mobile copy in
 * `src/api/recurringReminders.ts` — same dual-list convention already used for
 * `HOUSE_NOTIFICATION_TYPES` / `HEALTH_NOTIFICATION_TYPES` between FE and BE.
 */
export type FrequencyId = 'evening_today' | 'tomorrow_morning' | 'every_3_days' | 'weekly';

export interface FrequencyPreset {
  id: FrequencyId;
  label: string;
  description: string;
}

export const FREQUENCY_PRESETS: FrequencyPreset[] = [
  {
    id: 'evening_today',
    label: 'Later today',
    description: 'Nudge again this evening, then every evening',
  },
  {
    id: 'tomorrow_morning',
    label: 'Tomorrow morning',
    description: 'Nudge again tomorrow morning, then every morning',
  },
  {
    id: 'every_3_days',
    label: 'Every few days',
    description: 'Nudge again in 3 days, then every 3 days',
  },
  { id: 'weekly', label: 'Weekly', description: 'Nudge again in a week, then every week' },
];

const EVENING_HOUR = 19;
const MORNING_HOUR = 9;
const DEFAULT_HOUR = 10;

export const DEFAULT_FREQUENCY: FrequencyId = 'every_3_days';

export function isValidFrequency(value: string): value is FrequencyId {
  return FREQUENCY_PRESETS.some((p) => p.id === value);
}

function currentHourInTz(timezone: string): number {
  try {
    const hourStr = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      hour: '2-digit',
      hour12: false,
    }).format(new Date());
    const hour = parseInt(hourStr, 10);
    return hour === 24 ? 0 : hour;
  } catch {
    return new Date().getUTCHours();
  }
}

/** When the next nudge for `frequency` should fire, computed from right now. */
export function computeNextNudge(frequency: string, timezone: string): Date {
  switch (frequency as FrequencyId) {
    case 'evening_today': {
      // Still before this evening's slot → tonight; otherwise tomorrow evening.
      const daysAhead = currentHourInTz(timezone) < EVENING_HOUR ? 0 : 1;
      return new Date(dueDateFromDaysInTz(daysAhead, timezone, EVENING_HOUR));
    }
    case 'tomorrow_morning':
      return new Date(dueDateFromDaysInTz(1, timezone, MORNING_HOUR));
    case 'weekly':
      return new Date(dueDateFromDaysInTz(7, timezone, DEFAULT_HOUR));
    case 'every_3_days':
    default:
      return new Date(dueDateFromDaysInTz(3, timezone, DEFAULT_HOUR));
  }
}
