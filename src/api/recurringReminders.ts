import { apiClient } from './client';

/**
 * Recurring reminders API client — the in-app "Active" list surface for the
 * shared recurring-reminders engine (`backend/src/services/recurring-reminders/`).
 * "Keep nagging until it's actually done" action items, distinct from
 * `notificationsApi` (the read/unread push history).
 *
 * Base path: /households/:householdId/recurring-reminders. Envelopes MUST
 * match `backend/src/routes/recurring-reminders.ts` EXACTLY.
 */

const base = (householdId: string) => `/households/${householdId}/recurring-reminders`;

// Keep in sync with backend/src/services/recurring-reminders/frequency.ts —
// same dual-list convention already used for the House/Health notification
// type sets between FE and BE.
export type RecurringReminderFrequency =
  | 'evening_today'
  | 'tomorrow_morning'
  | 'every_3_days'
  | 'weekly';

export interface RecurringReminderFrequencyOption {
  id: RecurringReminderFrequency;
  label: string;
  description: string;
}

export interface RecurringReminder {
  id: string;
  household_id: string;
  type: string;
  reference_type: string;
  reference_id: string;
  period_key: string;
  status: 'pending' | 'done';
  title: string;
  body: string;
  /** Same shape as a push `data` payload — pass straight into `routeNotificationTap`. */
  data: string | null;
  frequency: RecurringReminderFrequency;
  next_nudge_at: string;
  last_nudged_at: string | null;
  nudge_count: number;
  snoozed_until: string | null;
  completed_at: string | null;
  completed_by_user_id: string | null;
  completed_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface ListResponse {
  reminders: RecurringReminder[];
  frequencyOptions: RecurringReminderFrequencyOption[];
}

interface ReminderResponse {
  reminder: RecurringReminder;
}

export const recurringRemindersApi = {
  list: (householdId: string) =>
    apiClient.get<ListResponse>(base(householdId)).then((res) => res.data),

  complete: (householdId: string, id: string) =>
    apiClient.post<ReminderResponse>(`${base(householdId)}/${id}/complete`).then((res) => res.data),

  setFrequency: (householdId: string, id: string, frequency: RecurringReminderFrequency) =>
    apiClient
      .post<ReminderResponse>(`${base(householdId)}/${id}/frequency`, { frequency })
      .then((res) => res.data),
};
