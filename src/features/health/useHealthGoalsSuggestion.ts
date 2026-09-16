import { useEffect, useState } from 'react';

import { suggestGoals, type SuggestedGoals } from './healthGoalsStorage';
import { todayDateKey } from './healthLocalStorage';
import { ageFromBirthYear } from './healthWeightAnalytics';
import { loadWeightGoal } from './healthWeightStorage';

/**
 * The ONE suggestion `suggestGoals()` can produce from whatever the member
 * has already told the "About you" and Weight onboarding steps — used by the
 * Nutrition, Activity and Water steps that follow, each of which shows its
 * own slice of the same suggestion (calories/macros, steps/minutes,
 * water) with a "Use suggested" button.
 *
 * Read fresh on every mount rather than passed down through route params:
 * each of those three screens can be reached independently (back button, a
 * resumed session), and each needs today's answer, not one carried forward
 * from whenever "About you" happened to run.
 *
 * `null` while loading and whenever ANY of the five inputs
 * (`missingSuggestionInputs`) is still missing — the same all-or-nothing
 * refusal `suggestGoals()` already documents on itself, reused here rather
 * than loosened, so an onboarding screen never shows half a suggestion built
 * on a guess.
 */
export function useSuggestedGoals(): SuggestedGoals | null {
  const [suggestion, setSuggestion] = useState<SuggestedGoals | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadWeightGoal().then((goal) => {
      if (cancelled) return;
      setSuggestion(
        suggestGoals({
          weightKg: goal.startingKg,
          heightCm: goal.heightCm,
          age: ageFromBirthYear(goal.birthYear, todayDateKey()),
          gender: goal.gender,
          activityLevel: goal.activityLevel,
          goalType: goal.goalType,
        })
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return suggestion;
}
