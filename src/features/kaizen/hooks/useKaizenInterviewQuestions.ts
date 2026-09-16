/**
 * React Query hook for Kaizen interview questions list (Track A / A7).
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { hasBrandCapability } from '@brand';
import { usePersistedQuery } from '@hooks/usePersistedQuery';
import { useAuthStore } from '@stores/authStore';

import { listActive } from '../services/repository';
import type { KaizenInterviewQuestionEntry } from '../types';

export const kaizenInterviewQuestionsQueryKey = (userId: string) =>
  ['kaizen', 'interview-questions', userId] as const;

async function fetchKaizenInterviewQuestions(
  userId: string,
): Promise<KaizenInterviewQuestionEntry[]> {
  return listActive<KaizenInterviewQuestionEntry>('kaizen_interview_questions', userId);
}

export function useKaizenInterviewQuestions(options?: { enabled?: boolean }) {
  const userId = useAuthStore(state => state.user?.id);
  const enabled =
    (options?.enabled ?? true) && Boolean(userId) && hasBrandCapability('kaizenApi');

  return usePersistedQuery<KaizenInterviewQuestionEntry[]>({
    queryKey: kaizenInterviewQuestionsQueryKey(userId ?? ''),
    enabled,
    staleTime: 30_000,
    queryFn: () => fetchKaizenInterviewQuestions(userId!),
  });
}

export function useInvalidateKaizenInterviewQuestions() {
  const queryClient = useQueryClient();
  return useCallback(
    async (userId: string) => {
      await queryClient.invalidateQueries({
        queryKey: kaizenInterviewQuestionsQueryKey(userId),
      });
    },
    [queryClient],
  );
}
