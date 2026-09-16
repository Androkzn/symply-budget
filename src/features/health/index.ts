/**
 * Symply Health feature module (brand id `simple-health`, swift-rewrite, last).
 *
 * Donor (read-only): `~/Desktop/Symply Ecosystem/Simply Health/`
 * Docs: `documents/apps/symply-health/{BRD,TRD,migration}.md`
 *
 * Shell: the donor's five-tab bar (Swift `TabItem.defaultTabs` = Dashboard /
 * Meals / Weight / Workouts / More) restored as Health · Nutrition · Activity ·
 * Trends · More, with Body + Habits in the customizable "More" hub. See
 * `brands/symply-health/brand.cjs` and `src/navigation/__tests__/healthTabShell.test.ts`.
 *
 * Privacy stance (BRD §7): Health data is sensitive by default. Every tab keeps
 * everything on-device, with AI and HealthKit as first-class OFF states and no
 * cross-app sharing. Later phases add scoped HealthKit, sync, and optional AI
 * only through focused, privacy-reviewed specs — never here by default.
 */

// Re-exported from a leaf module so this barrel stays importable from inside
// the feature without a cycle (see brandGuard.ts).
export { HEALTH_FEATURE_ID, isHealthBrand } from './brandGuard';

/** Port phases — keep in sync with documents/apps/symply-health/migration.md */
export type HealthPortPhase =
  | 'shell'
  | 'core-tracking'
  | 'healthkit'
  | 'companions'
  | 'ai-media';

export const HEALTH_PORT_ORDER: readonly HealthPortPhase[] = [
  'shell',
  'core-tracking',
  'healthkit',
  'companions',
  'ai-media',
] as const;

export {
  HealthActivityScreen,
  HealthAddFoodScreen,
  HealthBodyScreen,
  HealthChallengesScreen,
  HealthCoachScreen,
  HealthCycleScreen,
  HealthFeaturesScreen,
  HealthFilesScreen,
  HealthFoodLibraryScreen,
  HealthFridgeScreen,
  HealthGoalsScreen,
  HealthHabitDetailScreen,
  HealthHabitsScreen,
  HealthHomeScreen,
  HealthInjuriesScreen,
  HealthMoreScreen,
  HealthNotificationSettingsScreen,
  HealthNutritionScreen,
  HealthOtherDeviceScreen,
  HealthRecipesScreen,
  HealthBarcodeScanScreen,
  HealthScanScreen,
  HealthTrendsScreen,
  HealthVitalityScreen,
  HealthWaterScreen,
  HealthWeightScreen,
  HealthWidgetSettingsScreen,
  HealthWorkoutLibraryScreen,
  HealthExerciseDetailScreen,
  HealthWorkoutSessionDetail,
} from './screens';

/** Per-feature route guard used by every `app/(tabs)/health-*.tsx`. */
export { HealthFeatureRoute } from './components/HealthFeatureRoute';
export type { HealthFeatureRouteProps } from './components/HealthFeatureRoute';
