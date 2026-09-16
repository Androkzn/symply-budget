/**
 * React Query hook for Kaizen books library list (Track A / A7).
 *
 * Local-first (SQLite + sync); list read path owned by React Query so
 * BooksScreen can migrate off store `books` without a big-bang rewrite.
 * Mutations still go through kaizenStore; invalidate after add/delete.
 *
 * See: documents/engineering/react-query-migration.md
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { hasBrandCapability } from '@brand';
import { usePersistedQuery } from '@hooks/usePersistedQuery';
import { useAuthStore } from '@stores/authStore';

import { listActive } from '../services/repository';
import { selectActiveBooksSorted } from '../stores/kaizenSelectors';
import type { KaizenBookEntry } from '../types';

export const kaizenBooksQueryKey = (userId: string) =>
  ['kaizen', 'books', userId] as const;

async function fetchKaizenBooks(userId: string): Promise<KaizenBookEntry[]> {
  const rows = await listActive<KaizenBookEntry>('kaizen_books', userId);
  return selectActiveBooksSorted(rows);
}

export function useKaizenBooks(options?: { enabled?: boolean }) {
  const userId = useAuthStore(state => state.user?.id);
  const enabled =
    (options?.enabled ?? true) && Boolean(userId) && hasBrandCapability('kaizenApi');

  return usePersistedQuery<KaizenBookEntry[]>({
    queryKey: kaizenBooksQueryKey(userId ?? ''),
    enabled,
    staleTime: 30_000,
    queryFn: () => fetchKaizenBooks(userId!),
  });
}

export function useInvalidateKaizenBooks() {
  const queryClient = useQueryClient();
  return useCallback(
    async (userId: string) => {
      await queryClient.invalidateQueries({
        queryKey: kaizenBooksQueryKey(userId),
      });
    },
    [queryClient],
  );
}
