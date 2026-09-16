import { isHouseBrand } from '@brand';
import { isFullBudget } from '@features/budget';

import { PROFILE_COMPOSITIONS, type ProfileComposition } from './compositions';

/**
 * Which app's profile composition this build renders.
 *
 * The ONE place a brand is named in the Profile shell. Everything the shell
 * draws beyond the common chrome comes back through here as slots, so adding or
 * changing an app's profile means editing `compositions.tsx` — never the shell,
 * and never another app's entry.
 *
 * Minimal Budget deliberately falls through to `base`: `isFullBudget()` is false
 * there, and its ACCOUNT rows still live on the More tab.
 */
export function useProfileComposition(): ProfileComposition {
  if (isFullBudget()) return PROFILE_COMPOSITIONS.budget;
  if (isHouseBrand()) return PROFILE_COMPOSITIONS.house;
  return PROFILE_COMPOSITIONS.base;
}
