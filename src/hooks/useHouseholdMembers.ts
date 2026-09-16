/**
 * React Query hook for household members list (Track A / A7).
 *
 * Pattern mirrors useNotificationHistory — server cache in RQ; memberStore keeps
 * mutations and owner-only invitation/join-request state.
 *
 * See: documents/engineering/react-query-migration.md
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { householdsApi, type HouseholdMember } from '@api/households';
import { usePersistedQuery } from '@hooks/usePersistedQuery';

export const householdMembersQueryKey = (householdId: string) =>
  ['household', 'members', householdId] as const;

export function useHouseholdMembers(householdId?: string) {
  return usePersistedQuery<HouseholdMember[]>({
    queryKey: householdMembersQueryKey(householdId ?? ''),
    enabled: Boolean(householdId),
    staleTime: 60_000,
    queryFn: async () => {
      const householdData = await householdsApi.get(householdId!);
      return householdData.members;
    },
  });
}

export function useInvalidateHouseholdMembers() {
  const queryClient = useQueryClient();
  return useCallback(
    async (householdId: string) => {
      await queryClient.invalidateQueries({
        queryKey: householdMembersQueryKey(householdId),
      });
    },
    [queryClient]
  );
}
