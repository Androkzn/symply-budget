/**
 * React Query wrapper for the household's "Active" recurring reminders —
 * mirrors `useNotificationHistory.ts`'s pattern (persisted query + a mutation
 * helper that invalidates on success).
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import {
  recurringRemindersApi,
  type RecurringReminder,
  type RecurringReminderFrequency,
  type RecurringReminderFrequencyOption,
} from '@api/recurringReminders';
import { usePersistedQuery } from '@hooks/usePersistedQuery';
import { useHouseholdStore } from '@stores/householdStore';

export function recurringRemindersQueryKey(householdId: string | undefined) {
  return ['recurring-reminders', householdId] as const;
}

interface RecurringRemindersData {
  reminders: RecurringReminder[];
  frequencyOptions: RecurringReminderFrequencyOption[];
}

export function useRecurringReminders() {
  const householdId = useHouseholdStore((s) => s.currentHousehold?.id);
  const queryClient = useQueryClient();

  const query = usePersistedQuery<RecurringRemindersData>({
    queryKey: recurringRemindersQueryKey(householdId),
    enabled: Boolean(householdId),
    staleTime: 30_000,
    queryFn: () => recurringRemindersApi.list(householdId!),
  });

  const invalidate = useCallback(async () => {
    if (!householdId) return;
    await queryClient.invalidateQueries({ queryKey: recurringRemindersQueryKey(householdId) });
  }, [queryClient, householdId]);

  const complete = useCallback(
    async (id: string) => {
      if (!householdId) return;
      await recurringRemindersApi.complete(householdId, id);
      await invalidate();
    },
    [householdId, invalidate]
  );

  const setFrequency = useCallback(
    async (id: string, frequency: RecurringReminderFrequency) => {
      if (!householdId) return;
      await recurringRemindersApi.setFrequency(householdId, id, frequency);
      await invalidate();
    },
    [householdId, invalidate]
  );

  return {
    ...query,
    reminders: query.data?.reminders ?? [],
    frequencyOptions: query.data?.frequencyOptions ?? [],
    complete,
    setFrequency,
    invalidate,
  };
}
