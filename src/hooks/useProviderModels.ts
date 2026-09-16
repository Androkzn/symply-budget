/**
 * The selectable model catalog for a single provider (GET /ai-models?provider=).
 * Server-driven; the client never free-types vendor model IDs. Used by the
 * AI Providers card + provider-detail screen to render the inline model picker.
 */
import { useQuery } from '@tanstack/react-query';

import { aiAccessApi, type AIModelOption, type AIProviderId } from '@api/aiAccess';

export function useProviderModels(provider: AIProviderId, enabled = true) {
  const query = useQuery({
    queryKey: ['ai-models', provider],
    queryFn: async (): Promise<AIModelOption[]> => {
      const res = await aiAccessApi.getModels(provider);
      return res.models;
    },
    enabled,
    staleTime: 5 * 60_000,
  });

  return {
    models: query.data ?? [],
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
