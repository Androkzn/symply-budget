/**
 * Symply Kaizen feature module (brand id `symply-kaizen`).
 *
 * Domain screens/services for the Kaizen brand live in this folder. Do not
 * import Kaizen-only screens from House / Budget brand tabs until routes exist
 * under `app/`.
 *
 * Brand shell (`brands/symply-kaizen/`): Today / Guide / More + Career / Assess
 * / Learn / Systems hub.
 */

export const KAIZEN_FEATURE_ID = 'kaizen' as const;

export {
  isKaizenBrand,
  KAIZEN_WORDMARK_GRADIENT_DARK,
  KAIZEN_WORDMARK_GRADIENT_LIGHT,
} from './branding';

export {
  KaizenTodayScreen,
  KaizenGuideScreen,
  KaizenMoreScreen,
  KaizenCareerScreen,
  KaizenAssessScreen,
  KaizenLearnScreen,
  KaizenSystemsScreen,
} from './screens';
