/**
 * Symply Language feature module (brand id `simple-language`, Swift donor rewrite).
 *
 * Donor (read-only): `~/Desktop/Symply Ecosystem/Simply Language/symply-language/`
 * Docs: `documents/apps/symply-language/migration.md`
 *
 * Swift → RN rewrite, not a native fork. Port learning surfaces into this
 * folder. Keep everything local-first / AI-off safe: navigation, progress
 * review, and daily practice must work without the AI provider.
 *
 * Current brand shell (`brands/symply-language/`): Learn / More.
 * Shell v1 ships a local-first Learn home; assessment / plan / practice / chat
 * land in later port phases (see LANGUAGE_PORT_ORDER).
 */

// Re-exported from their own module so `app/_layout.tsx` and other outside
// callers can take the brand predicate WITHOUT pulling this barrel — which
// re-exports every Language screen — into their bundle. See `./brandGuard`.
export { LANGUAGE_FEATURE_ID, isLanguageBrand } from './brandGuard';

/** Donor inventory snapshot for agents (paths relative to Simply Language root). */
export const LANGUAGE_DONOR_INVENTORY = {
  app: 'simple-language.xcodeproj',
  di: 'symply-language/App/DIContainer.swift',
  navigation: 'symply-language/Presentation/Navigation/MainTabView.swift',
  features: 'symply-language/Presentation/Features/',
  models: 'symply-language/Domain/Models/',
  swiftData: 'symply-language/Data/SwiftData/Models/',
  backend: 'backend/src/index.ts + backend/src/routes/',
  // Sibling scope — NOT Language v1 unless product reassigns it.
  kaizenInterview: 'symply-language/Presentation/Features/KaizenInterview/ (→ kaizen or drop)',
} as const;

/**
 * Port phases — keep in sync with documents/apps/symply-language/migration.md
 * "Build Order" and the parity matrix Must/Should tiers.
 */
export type LanguagePortPhase =
  | 'shell'
  | 'profile'
  | 'assessment'
  | 'plan'
  | 'practice'
  | 'chat'
  | 'vocabulary'
  | 'native';

export const LANGUAGE_PORT_ORDER: readonly LanguagePortPhase[] = [
  'shell',
  'profile',
  'assessment',
  'plan',
  'practice',
  'chat',
  'vocabulary',
  'native',
] as const;

export {
  LanguageLearnScreen,
  LanguageTutorScreen,
  LanguageAssessmentScreen,
  LanguageReviewScreen,
  LanguagePlanScreen,
  LanguageOnboardingScreen,
  LanguageDialogueScreen,
  LanguageMoreScreen,
} from './screens';
export * from './api';
