/**
 * Language learner + user profile API (donor `/api/v1/learner` and `/user`).
 * Verified live: GET /learner/profile → 200, GET /user/profile → 200.
 *
 * The learner profile drives onboarding gating and gives the AI tutor context
 * (who the learner is, their native language, motivations). All local-first
 * fallbacks live in languageLocalStorage.ts; this is the server source of truth.
 */
import { languageRequest } from './languageClient';

export interface LearnerProfile {
  ageBand: string | null;
  profession: string | null;
  industry: string | null;
  dailyContext: string | null;
  nativeLanguage: string | null;
  bilingualMode: boolean;
  motivations: string[];
  goalSituations?: string[];
  interests?: string[];
}

export interface LearnerProfilePatch {
  ageBand?: string | null;
  profession?: string | null;
  industry?: string | null;
  dailyContext?: string | null;
  nativeLanguage?: string | null;
  bilingualMode?: boolean;
  motivations?: string[];
  goalSituations?: string[];
  interests?: string[];
}

export interface LanguageUserProfile {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  isBiometricEnabled?: boolean;
}

/** The learner is "onboarded" once they've told us their native language. */
export function isLearnerOnboarded(profile: LearnerProfile | null): boolean {
  return !!profile?.nativeLanguage;
}

export const languageProfileApi = {
  getUser: () => languageRequest<LanguageUserProfile>('/user/profile'),

  getLearnerProfile: () =>
    languageRequest<{ profile: LearnerProfile }>('/learner/profile').then((r) => r.profile),

  updateLearnerProfile: (patch: LearnerProfilePatch) =>
    languageRequest<{ profile: LearnerProfile }>('/learner/profile', {
      method: 'PUT',
      body: patch,
    }).then((r) => r.profile),

  /** Aggregated learner context the tutor/assessment use (memory + profile). */
  getLearnerContext: () => languageRequest<Record<string, unknown>>('/learner/context'),

  /** Wipe all learning data (keeps the auth account). Requires re-onboarding. */
  resetLearningData: () =>
    languageRequest<{ message: string; onboardingRequired: boolean }>('/user/reset', {
      method: 'POST',
    }),
};
