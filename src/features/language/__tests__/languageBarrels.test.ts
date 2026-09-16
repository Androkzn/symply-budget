/**
 * Barrel-contract tests: the `api/` and `screens/` index files are pure
 * re-export surfaces. These assert every public name the rest of the app
 * imports from them actually resolves (and executes the re-export lines).
 */
import * as apiBarrel from '../api';
import * as screensBarrel from '../screens';

describe('language/api barrel', () => {
  it('re-exports every api client + the client helpers', () => {
    for (const name of [
      'languageAuthApi',
      'languageProfileApi',
      'isLearnerOnboarded',
      'languageTutorApi',
      'tutorTodayDate',
      'languageAssessmentApi',
      'languagePlanApi',
      'languageProgressApi',
      'languageCardsApi',
      'languageReviewsApi',
      'languageDialoguesApi',
      'languageGamesApi',
      'languageVoiceApi',
      'languagePracticeApi',
      'languageDriveApi',
    ]) {
      expect(apiBarrel).toHaveProperty(name);
      expect((apiBarrel as Record<string, unknown>)[name]).toBeDefined();
    }
  });
});

describe('language/screens barrel', () => {
  it('re-exports every screen component', () => {
    for (const name of [
      'LanguageLearnScreen',
      'LanguageTutorScreen',
      'LanguageAssessmentScreen',
      'LanguageReviewScreen',
      'LanguagePlanScreen',
      'LanguageOnboardingScreen',
      'LanguageDialogueScreen',
      'LanguageMoreScreen',
    ]) {
      expect(typeof (screensBarrel as Record<string, unknown>)[name]).toBe('function');
    }
  });
});
