/**
 * Progress metrics API — donor `/api/v1/progress`.
 * `/insights` is AI-generated coaching (needs the server Gemini key).
 */
import { languageRequest } from './languageClient';

export interface DailyMetrics {
  vocabularyRetention: number;
  grammarAccuracy: number;
  simpleGrammarAccuracy?: number;
  advancedGrammarAccuracy?: number;
  speakingFluency: number;
  listeningComprehension: number;
  totalPracticeMinutes: number;
  sessionsCompleted?: number;
}

export interface ProgressSnapshot {
  today: DailyMetrics | null;
  weekly: Array<DailyMetrics & { date: string }>;
}

export const languageProgressApi = {
  get: () => languageRequest<ProgressSnapshot>('/progress'),

  track: (input: {
    sessionType: string;
    durationSeconds?: number;
    accuracyScore?: number;
    fluencyScore?: number;
    errorsDetected?: unknown[];
    transcript?: string;
    aiFeedback?: string;
  }) =>
    languageRequest<{ sessionId: string; message: string }>('/progress/track', {
      method: 'POST',
      body: input,
    }),

  insights: (input: {
    metrics: Pick<
      DailyMetrics,
      'vocabularyRetention' | 'grammarAccuracy' | 'speakingFluency' | 'listeningComprehension'
    >;
    weeklyHistory: Array<DailyMetrics & { date: string }>;
    skillRows: Array<Record<string, unknown>>;
    planCurrentLevel?: string;
    learnerHint?: string;
  }) =>
    languageRequest<{ summary: string; recommendations: string[] }>('/progress/insights', {
      method: 'POST',
      body: input,
    }),
};
