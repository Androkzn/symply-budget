/**
 * React Query hook for Kaizen book chapters (Track A / A7).
 * Mirrors useKaizenBooks — local SQLite list read path owned by RQ.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { hasBrandCapability } from '@brand';
import { usePersistedQuery } from '@hooks/usePersistedQuery';
import { useAuthStore } from '@stores/authStore';

import { listActive } from '../services/repository';
import { selectBookChapters } from '../stores/kaizenSelectors';
import type { KaizenBookChapterEntry } from '../types';

export const kaizenBookChaptersQueryKey = (userId: string, bookId: string) =>
  ['kaizen', 'book-chapters', userId, bookId] as const;

async function fetchKaizenBookChapters(
  userId: string,
  bookId: string
): Promise<KaizenBookChapterEntry[]> {
  const rows = await listActive<KaizenBookChapterEntry>('kaizen_book_chapters', userId);
  return selectBookChapters(rows, bookId);
}

export function useKaizenBookChapters(
  bookId: string,
  options?: { enabled?: boolean }
) {
  const userId = useAuthStore(state => state.user?.id);
  const enabled =
    (options?.enabled ?? true) &&
    Boolean(userId) &&
    Boolean(bookId) &&
    hasBrandCapability('kaizenApi');

  return usePersistedQuery<KaizenBookChapterEntry[]>({
    queryKey: kaizenBookChaptersQueryKey(userId ?? '', bookId),
    enabled,
    staleTime: 30_000,
    queryFn: () => fetchKaizenBookChapters(userId!, bookId),
  });
}

export function useInvalidateKaizenBookChapters() {
  const queryClient = useQueryClient();
  return useCallback(
    async (userId: string, bookId?: string) => {
      await queryClient.invalidateQueries({
        queryKey: bookId
          ? kaizenBookChaptersQueryKey(userId, bookId)
          : ['kaizen', 'book-chapters', userId],
      });
    },
    [queryClient]
  );
}
