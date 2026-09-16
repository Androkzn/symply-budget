/**
 * Learning plan API — donor `/api/v1/plan` (NOTE: mounted at /plan, not
 * /learning-plan). A plan is generated from the assessment proficiency profile.
 */
import { languageRequest, LanguageApiError } from './languageClient';

export interface PlanDaySchedule {
  minutes: number;
  focus?: string;
  type?: string;
}

export interface LearningPlan {
  id: string;
  currentLevel: string;
  dailyMinutes: number;
  goals: string[];
  schedule: Record<string, PlanDaySchedule>;
  totalTasks?: number;
  completedTasks?: number;
  currentWeek?: number;
  status?: string;
  currentCefrLevel?: string;
  targetCefrLevel?: string;
  planSummary?: string;
  gapAnalysis?: unknown[];
  curriculum?: unknown[];
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface PlanProgressHistoryEntry {
  date: string;
  dayOfWeek: string;
  targetMinutes: number;
  actualMinutes: number;
  tasksCompleted: string[];
  focusArea?: string;
}

export const languagePlanApi = {
  /** Current plan, or null when the learner has none yet (backend 404s). */
  getCurrent: async (): Promise<LearningPlan | null> => {
    try {
      return await languageRequest<LearningPlan>('/plan');
    } catch (e) {
      if (e instanceof LanguageApiError && e.status === 404) return null;
      throw e;
    }
  },

  getAll: () => languageRequest<{ plans: LearningPlan[] }>('/plan/all').then((r) => r.plans),

  getById: (planId: string) =>
    languageRequest<LearningPlan & { progress: number; progressHistory: PlanProgressHistoryEntry[] }>(
      `/plan/${planId}`,
    ),

  generate: (input: {
    assessmentProfile: {
      overallProficiency: number;
      strengths: string[];
      weaknesses: string[];
      preferredDomains: string[];
    };
    goals: string[];
    dailyMinutes: number;
  }) =>
    languageRequest<{
      currentLevel: string;
      dailyMinutes: number;
      goals: string[];
      schedule: Record<string, PlanDaySchedule>;
      message?: string;
    }>('/plan/generate', { method: 'POST', body: input }),

  logProgress: (planId: string, input: { actualMinutes: number; tasksCompleted?: string[]; focusArea?: string }) =>
    languageRequest<{ message: string; date: string; actualMinutes: number; targetMinutes: number }>(
      `/plan/${planId}/progress`,
      { method: 'POST', body: input },
    ),

  update: (patch: {
    currentLevel?: string;
    dailyMinutes?: number;
    goals?: string[];
    schedule?: Record<string, PlanDaySchedule>;
  }) => languageRequest<{ message: string }>('/plan', { method: 'PUT', body: patch }),
};
