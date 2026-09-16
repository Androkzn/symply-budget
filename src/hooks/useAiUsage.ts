/**
 * AI usage/estimated-cost for the current household (optionally one provider).
 * Server-authoritative dollars; see aiUsageApi. Disabled until a household is
 * selected.
 */
import { useQuery } from '@tanstack/react-query';

import type { AIProviderId } from '@api/aiAccess';
import { aiUsageApi, type AIUsageResponse } from '@api/aiUsage';
import { useHouseholdStore } from '@stores/householdStore';

export function useAiUsage(opts?: { days?: number; provider?: AIProviderId }) {
  const householdId = useHouseholdStore((s) => s.currentHousehold?.id ?? null);
  const days = opts?.days ?? 30;
  const provider = opts?.provider;

  const query = useQuery({
    queryKey: ['ai-usage', householdId, days, provider ?? 'all'],
    queryFn: async (): Promise<AIUsageResponse> =>
      aiUsageApi.getUsage(householdId as string, { days, provider }),
    enabled: !!householdId,
    staleTime: 60_000,
  });

  return {
    householdId,
    usage: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
