/**
 * React Query hook for Kaizen weekly reviews list (Track A / A7).
 *
 * Data is local-first (SQLite + /api/v1/sync) but the list read path is owned
 * by React Query so ReviewsScreen can migrate off store `reviews` without a
 * big-bang rewrite. Mutations still go through kaizenStore; invalidate after save.
 *
 * See: documents/engineering/react-query-migration.md
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { hasBrandCapability } from '@brand';
import { usePersistedQuery } from '@hooks/usePersistedQuery';
import { useAuthStore } from '@stores/authStore';

import { listActive } from '../services/repository';
import { selectWeeklyReviewsSorted } from '../stores/kaizenSelectors';
import type { KaizenWeeklyReviewEntry } from '../types';

export const kaizenWeeklyReviewsQueryKey = (userId: string) =>
  ['kaizen', 'weekly-reviews', userId] as const;

async function fetchKaizenWeeklyReviews(userId: string): Promise<KaizenWeeklyReviewEntry[]> {
  const rows = await listActive<KaizenWeeklyReviewEntry>('kaizen_weekly_reviews', userId);
  return selectWeeklyReviewsSorted(rows);
}

export function useKaizenWeeklyReviews(options?: { enabled?: boolean }) {
  const userId = useAuthStore(state => state.user?.id);
  const enabled =
    (options?.enabled ?? true) && Boolean(userId) && hasBrandCapability('kaizenApi');

  return usePersistedQuery<KaizenWeeklyReviewEntry[]>({
    queryKey: kaizenWeeklyReviewsQueryKey(userId ?? ''),
    enabled,
    staleTime: 30_000,
    queryFn: () => fetchKaizenWeeklyReviews(userId!),
  });
}

export function useInvalidateKaizenWeeklyReviews() {
  const queryClient = useQueryClient();
  return useCallback(
    async (userId: string) => {
      await queryClient.invalidateQueries({
        queryKey: kaizenWeeklyReviewsQueryKey(userId),
      });
    },
    [queryClient],
  );
}
