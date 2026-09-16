/**
 * Placement / proficiency assessment API — donor `/api/v1/assessment`.
 * Core flow: start → (smart-adaptive/next → smart-adaptive/submit)* → complete
 * → results. AI-graded ([AI] endpoints need the server Gemini key, verified).
 */
import { languageRequest } from './languageClient';

export type AssessmentInputMode = 'tap' | 'type' | 'speak';

export interface AssessmentTopic {
  id: string;
  name: string;
  icon?: string;
  description?: string;
}

export interface AssessmentStart {
  sessionId: string;
  domains: string[];
  isResumed: boolean;
  questionsAnswered: number;
  message?: string;
}

export interface AdaptiveQuestion {
  id: string;
  difficulty: number | string;
  category: string;
  backendType: string;
  text: string;
  requiresVoice: boolean;
  listeningAudioText?: string | null;
  suggestedAnswers?: string[];
  nativeText?: string | null;
  maxRecordingDurationSec?: number;
}

export interface AdaptiveNext {
  question: AdaptiveQuestion | null;
  isComplete: boolean;
  questionNumber: number;
  totalQuestions: number;
}

export interface AdaptiveSubmit {
  assessmentId: string;
  analysis: Record<string, unknown>;
  isCorrect: boolean;
  audioAvailable: boolean;
  isComplete: boolean;
  questionsAsked: number;
  totalQuestions: number;
}

export interface ProficiencyProfile {
  overallProficiency: number;
  cefrLevel: string;
  listeningScore?: number;
  speakingScore?: number;
  grammarScore?: number;
  vocabularyScore?: number;
  pronunciationScore?: number;
  fluencyScore?: number;
  coherenceScore?: number;
  strengths?: string[];
  weaknesses?: string[];
  learningPriorities?: string[];
  [key: string]: unknown;
}

export interface AssessmentStatus {
  due: boolean;
  kind: 'initial' | 'checkpoint' | 'final' | null;
  mandatory: boolean;
  planId: string | null;
  reason?: string;
  estimatedQuestionCount?: number;
  blocksPlanProgress?: boolean;
}

export const languageAssessmentApi = {
  getTopics: () =>
    languageRequest<{ topics: AssessmentTopic[] }>('/assessment/topics').then((r) => r.topics),

  start: (domains?: string[]) =>
    languageRequest<AssessmentStart>('/assessment/start', {
      method: 'POST',
      body: { domains },
    }),

  nextQuestion: (sessionId: string, kind: string) =>
    languageRequest<AdaptiveNext>('/assessment/smart-adaptive/next', {
      method: 'POST',
      body: { sessionId, kind },
    }),

  submitAnswer: (input: {
    sessionId: string;
    questionId: string;
    responseText?: string;
    transcription?: string;
    inputMode?: AssessmentInputMode;
    kind: string;
  }) =>
    languageRequest<AdaptiveSubmit>('/assessment/smart-adaptive/submit', {
      method: 'POST',
      body: input,
    }),

  complete: (sessionId: string) =>
    languageRequest<{
      profile: ProficiencyProfile;
      planProcessing: boolean;
      planGated: boolean;
      assessmentKind: string;
      message?: string;
    }>('/assessment/complete', { method: 'POST', body: { sessionId } }),

  getResults: () => languageRequest<ProficiencyProfile>('/assessment/results'),

  getStatus: () => languageRequest<AssessmentStatus>('/assessment/status'),

  getHistory: () =>
    languageRequest<{ assessments: Array<Record<string, unknown>> }>('/assessment/history').then(
      (r) => r.assessments,
    ),
};
