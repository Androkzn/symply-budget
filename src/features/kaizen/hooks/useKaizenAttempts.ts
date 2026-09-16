/**
 * React Query hook for interview attempts list (Track A / A7).
 * Local-first SQLite; AttemptHistoryScreen reads via RQ + selectors.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { hasBrandCapability } from '@brand';
import { usePersistedQuery } from '@hooks/usePersistedQuery';
import { useAuthStore } from '@stores/authStore';

import { listActive } from '../services/repository';
import {
  selectAttemptsForQuestion,
  selectAttemptsSince,
} from '../stores/kaizenSelectors';
import type { KaizenInterviewAttemptEntry } from '../types';

export const kaizenAttemptsQueryKey = (userId: string) =>
  ['kaizen', 'attempts', userId] as const;

async function fetchKaizenAttempts(userId: string): Promise<KaizenInterviewAttemptEntry[]> {
  return listActive<KaizenInterviewAttemptEntry>('kaizen_interview_attempts', userId);
}

export function useKaizenAttempts(options?: { enabled?: boolean }) {
  const userId = useAuthStore(state => state.user?.id);
  const enabled =
    (options?.enabled ?? true) && Boolean(userId) && hasBrandCapability('kaizenApi');

  return usePersistedQuery<KaizenInterviewAttemptEntry[]>({
    queryKey: kaizenAttemptsQueryKey(userId ?? ''),
    enabled,
    staleTime: 30_000,
    queryFn: () => fetchKaizenAttempts(userId!),
  });
}

export function useKaizenAttemptsForQuestion(questionId: string | undefined) {
  const query = useKaizenAttempts({ enabled: Boolean(questionId) });
  const attempts = useMemo(
    () =>
      questionId ? selectAttemptsForQuestion(query.data ?? [], questionId) : [],
    [query.data, questionId],
  );
  return { ...query, attempts };
}

export function useKaizenAttemptsSince(since: Date) {
  const query = useKaizenAttempts();
  const attempts = useMemo(
    () => selectAttemptsSince(query.data ?? [], since),
    [query.data, since],
  );
  return { ...query, attempts };
}

export function useInvalidateKaizenAttempts() {
  const queryClient = useQueryClient();
  return useCallback(
    async (userId: string) => {
      await queryClient.invalidateQueries({
        queryKey: kaizenAttemptsQueryKey(userId),
      });
    },
    [queryClient],
  );
}
