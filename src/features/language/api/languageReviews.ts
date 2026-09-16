/**
 * Spaced-repetition reviews API — donor `/api/v1/reviews` (FSRS scheduling).
 * `rating`: 1=again, 2=hard, 3=good, 4=easy. Reschedules the card server-side.
 */
import { languageRequest } from './languageClient';

export type ReviewRating = 1 | 2 | 3 | 4;

export interface ReviewResult {
  reviewId: string;
  nextReviewDate: string;
  intervalDays: number;
  newEaseFactor: number;
  newRepetitions: number;
  isActive: boolean;
  reviewKind?: string;
}

export interface ReviewAnalytics {
  dailyStats: Array<{ date: string; total_reviews: number; accuracy: number }>;
  masteryDistribution: Array<{ status: string; count: number }>;
  dueSoon: number;
  averageMastery: number;
  period: number;
}

export const languageReviewsApi = {
  submit: (input: {
    cardId: string;
    rating: ReviewRating;
    responseTimeMs?: number;
    userResponse?: string;
  }) => languageRequest<ReviewResult>('/reviews', { method: 'POST', body: input }),

  history: (params?: { page?: number; limit?: number; cardId?: string; startDate?: string; endDate?: string }) => {
    const q = new URLSearchParams();
    if (params?.page) q.set('page', String(params.page));
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.cardId) q.set('cardId', params.cardId);
    if (params?.startDate) q.set('startDate', params.startDate);
    if (params?.endDate) q.set('endDate', params.endDate);
    const qs = q.toString();
    return languageRequest<{ reviews: Array<Record<string, unknown>>; pagination: unknown }>(
      `/reviews/history${qs ? `?${qs}` : ''}`,
    );
  },

  analytics: (periodDays = 30) =>
    languageRequest<ReviewAnalytics>(`/reviews/analytics?period=${periodDays}`),
};
