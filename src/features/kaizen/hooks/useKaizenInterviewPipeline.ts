/**
 * React Query hook for Kaizen interview pipeline list (Track A / A7).
 *
 * Local-first (SQLite + sync); list read path owned by React Query so
 * InterviewPipelineScreen can migrate off store `pipeline` without a big-bang rewrite.
 * Mutations still go through kaizenStore; invalidate after upsert/move/delete.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { hasBrandCapability } from '@brand';
import { usePersistedQuery } from '@hooks/usePersistedQuery';
import { useAuthStore } from '@stores/authStore';

import { listActive } from '../services/repository';
import { selectActivePipelineItems } from '../stores/kaizenSelectors';
import type { KaizenInterviewPipelineEntry } from '../types';

export const kaizenInterviewPipelineQueryKey = (userId: string) =>
  ['kaizen', 'interview-pipeline', userId] as const;

async function fetchKaizenInterviewPipeline(
  userId: string,
): Promise<KaizenInterviewPipelineEntry[]> {
  const rows = await listActive<KaizenInterviewPipelineEntry>(
    'kaizen_interview_pipeline',
    userId,
  );
  return selectActivePipelineItems(rows);
}

export function useKaizenInterviewPipeline(options?: { enabled?: boolean }) {
  const userId = useAuthStore(state => state.user?.id);
  const enabled =
    (options?.enabled ?? true) && Boolean(userId) && hasBrandCapability('kaizenApi');

  return usePersistedQuery<KaizenInterviewPipelineEntry[]>({
    queryKey: kaizenInterviewPipelineQueryKey(userId ?? ''),
    enabled,
    staleTime: 30_000,
    queryFn: () => fetchKaizenInterviewPipeline(userId!),
  });
}

export function useInvalidateKaizenInterviewPipeline() {
  const queryClient = useQueryClient();
  return useCallback(
    async (userId: string) => {
      await queryClient.invalidateQueries({
        queryKey: kaizenInterviewPipelineQueryKey(userId),
      });
    },
    [queryClient],
  );
}
