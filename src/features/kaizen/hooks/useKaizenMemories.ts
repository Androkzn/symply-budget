/**
 * React Query hook for Kaizen coach memories list (Track A / A7).
 *
 * Local-first (SQLite + sync); list read path owned by React Query so
 * MemorySettingsScreen can migrate off store `memories` without a big-bang rewrite.
 * Mutations still go through kaizenStore; invalidate after approve/archive.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { hasBrandCapability } from '@brand';
import { usePersistedQuery } from '@hooks/usePersistedQuery';
import { useAuthStore } from '@stores/authStore';

import { listActive } from '../services/repository';
import { selectActiveMemories } from '../stores/kaizenSelectors';
import type { KaizenUserMemoryEntry } from '../types';

export const kaizenMemoriesQueryKey = (userId: string) =>
  ['kaizen', 'memories', userId] as const;

async function fetchKaizenMemories(userId: string): Promise<KaizenUserMemoryEntry[]> {
  const rows = await listActive<KaizenUserMemoryEntry>('kaizen_user_memory', userId);
  return selectActiveMemories(rows);
}

export function useKaizenMemories(options?: { enabled?: boolean }) {
  const userId = useAuthStore(state => state.user?.id);
  const enabled =
    (options?.enabled ?? true) && Boolean(userId) && hasBrandCapability('kaizenApi');

  return usePersistedQuery<KaizenUserMemoryEntry[]>({
    queryKey: kaizenMemoriesQueryKey(userId ?? ''),
    enabled,
    staleTime: 30_000,
    queryFn: () => fetchKaizenMemories(userId!),
  });
}

export function useInvalidateKaizenMemories() {
  const queryClient = useQueryClient();
  return useCallback(
    async (userId: string) => {
      await queryClient.invalidateQueries({
        queryKey: kaizenMemoriesQueryKey(userId),
      });
    },
    [queryClient],
  );
}
