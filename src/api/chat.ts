import { apiClient } from './client';

interface ChatRequest {
  message: string;
  report_id?: string;
}

interface ChatResponse {
  response: string;
  context_used: boolean;
}

interface SuggestionsResponse {
  suggestions: string[];
}

export const chatApi = {
  sendMessage: (householdId: string, data: ChatRequest) =>
    apiClient
      .post<ChatResponse>(`/households/${householdId}/chat`, data)
      .then((res) => res.data),

  getSuggestions: (householdId: string, reportId?: string) =>
    apiClient
      .get<SuggestionsResponse>(`/households/${householdId}/chat/suggestions`, {
        params: reportId ? { report_id: reportId } : undefined,
      })
      .then((res) => res.data),
};
