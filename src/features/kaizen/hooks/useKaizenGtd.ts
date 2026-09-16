/**
 * React Query hook for Kaizen GTD inbox items (Track A / A7).
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { hasBrandCapability } from '@brand';
import { usePersistedQuery } from '@hooks/usePersistedQuery';
import { useAuthStore } from '@stores/authStore';

import { listActive } from '../services/repository';
import { selectGtdInboxItems } from '../stores/kaizenSelectors';
import type { KaizenGtdItemEntry } from '../types';

export const kaizenGtdQueryKey = (userId: string) => ['kaizen', 'gtd', userId] as const;

async function fetchKaizenGtd(userId: string): Promise<KaizenGtdItemEntry[]> {
  const rows = await listActive<KaizenGtdItemEntry>('kaizen_gtd_items', userId);
  return rows.filter(item => !item.deleted_at);
}

export function useKaizenGtd(options?: { enabled?: boolean }) {
  const userId = useAuthStore(state => state.user?.id);
  const enabled =
    (options?.enabled ?? true) && Boolean(userId) && hasBrandCapability('kaizenApi');

  return usePersistedQuery<KaizenGtdItemEntry[]>({
    queryKey: kaizenGtdQueryKey(userId ?? ''),
    enabled,
    staleTime: 30_000,
    queryFn: () => fetchKaizenGtd(userId!),
  });
}

export function useKaizenGtdInbox(options?: { enabled?: boolean }) {
  const query = useKaizenGtd(options);
  return {
    ...query,
    data: selectGtdInboxItems(query.data ?? []),
  };
}

export function useInvalidateKaizenGtd() {
  const queryClient = useQueryClient();
  return useCallback(
    async (userId: string) => {
      await queryClient.invalidateQueries({
        queryKey: kaizenGtdQueryKey(userId),
      });
    },
    [queryClient],
  );
}
