/** Language API modules — donor `/api/v1/*` contract. */
export * from './languageClient';
export { languageAuthApi } from './languageAuth';
export { languageProfileApi, isLearnerOnboarded } from './languageProfile';
export type { LearnerProfile, LearnerProfilePatch, LanguageUserProfile } from './languageProfile';
export { languageTutorApi, tutorTodayDate } from './languageTutor';
export type { TutorReply, TutorMessageRow, TutorSessionRow, TutorActionType } from './languageTutor';
export { languageAssessmentApi } from './languageAssessment';
export type {
  AssessmentTopic,
  AssessmentStart,
  AdaptiveQuestion,
  AdaptiveNext,
  AdaptiveSubmit,
  ProficiencyProfile,
  AssessmentStatus,
} from './languageAssessment';
export { languagePlanApi } from './languagePlan';
export type { LearningPlan, PlanProgressHistoryEntry } from './languagePlan';
export { languageProgressApi } from './languageProgress';
export type { DailyMetrics, ProgressSnapshot } from './languageProgress';
export { languageCardsApi } from './languageCards';
export type { CardRow, CardInput, CardsPage, CardType, SkillDomain, CefrLevel } from './languageCards';
export { languageReviewsApi } from './languageReviews';
export type { ReviewRating, ReviewResult, ReviewAnalytics } from './languageReviews';
export {
  languageDialoguesApi,
  languageGamesApi,
  languageVoiceApi,
  languagePracticeApi,
  languageDriveApi,
} from './languageExtras';
export type {
  DialogueScenario,
  GeneratedDialogue,
  GameWord,
  VoiceTurnResult,
  SpeakingHabits,
  PracticeMistake,
} from './languageExtras';
