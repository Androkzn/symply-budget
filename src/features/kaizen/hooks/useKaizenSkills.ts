/**
 * React Query hook for Kaizen skills list (Track A / A7).
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { hasBrandCapability } from '@brand';
import { usePersistedQuery } from '@hooks/usePersistedQuery';
import { useAuthStore } from '@stores/authStore';

import { listActive } from '../services/repository';
import { selectActiveSkillsSorted } from '../stores/kaizenSelectors';
import type { KaizenSkillNodeEntry } from '../types';

export const kaizenSkillsQueryKey = (userId: string) =>
  ['kaizen', 'skills', userId] as const;

async function fetchKaizenSkills(userId: string): Promise<KaizenSkillNodeEntry[]> {
  const rows = await listActive<KaizenSkillNodeEntry>('kaizen_skill_nodes', userId);
  return selectActiveSkillsSorted(rows);
}

export function useKaizenSkills(options?: { enabled?: boolean }) {
  const userId = useAuthStore(state => state.user?.id);
  const enabled =
    (options?.enabled ?? true) && Boolean(userId) && hasBrandCapability('kaizenApi');

  return usePersistedQuery<KaizenSkillNodeEntry[]>({
    queryKey: kaizenSkillsQueryKey(userId ?? ''),
    enabled,
    staleTime: 30_000,
    queryFn: () => fetchKaizenSkills(userId!),
  });
}

export function useInvalidateKaizenSkills() {
  const queryClient = useQueryClient();
  return useCallback(
    async (userId: string) => {
      await queryClient.invalidateQueries({
        queryKey: kaizenSkillsQueryKey(userId),
      });
    },
    [queryClient],
  );
}
