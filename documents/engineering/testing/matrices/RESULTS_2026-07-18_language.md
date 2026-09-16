# Symply Language Acceptance Results — 2026-07-18

| Field | Value |
|-------|-------|
| **App / scope** | `language` |
| **Run date** | `2026-07-18` |
| **Environment** | `staging` |
| **Device / OS** | Kaizen-A, iOS 26.5 |
| **Matrix source** | [language.md](./language.md) |
| **Maestro log** | `/tmp/maestro-language-2026-07-18.log` |

## Summary

| Metric | Count |
|--------|------:|
| Maestro rows | 105 |
| Pass | 0 |
| Fail | 0 |
| N/A | 105 |
| Pass rate (excl. N/A) | — |

## Results

| ID | Description | Steps | Expected | Layer | Automation | Pass | Fail | N/A | Notes |
|----|-------------|-------|----------|-------|------------|:----:|:----:|:---:|-------|
| LANG-SMOKE-001 | All 5 default tabs mount without crash | | | | Maestro | `e2e/maestro/language/learn-home.yaml`, `e2e/maest | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SMOKE-002 | Hidden tabs are routable once pinned | | | | Maestro | `e2e/maestro/language/more-settings.yaml` (asserts | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SMOKE-003 | Learn home hydration smoke | | | | Maestro | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SMOKE-004 | Staging Worker reachable | | | | Maestro, Live | `e2e/maestro/language/tutor.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-AUTH-001 | Login screen controls visible | | | | Maestro | `e2e/maestro/language/subflows/language-login-if-n | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-AUTH-002 | Email/password login succeeds | | | | Maestro, API | `e2e/maestro/language/subflows/language-login-if-n | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-AUTH-011 | Empty credentials do not call the API | | | | Maestro | `e2e/maestro/language/language-auth-validation.yam | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-001 | Default tab bar renders 5 tabs | | | | Maestro | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-002 | Learn tab is locked (not hideable) | | | | Maestro | `e2e/maestro/language/shell-customize-tabs.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-003 | More tab is locked (not hideable) | | | | Maestro | `e2e/maestro/language/shell-customize-tabs.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-004 | Pin Assessment | | | | Maestro | `e2e/maestro/language/shell-customize-tabs.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-005 | Unpin Assessment; route stays deep-linkable | | | | Maestro | `e2e/maestro/language/assessment.yaml` (uses the d | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-006 | Pin Dialogue | | | | Maestro | `e2e/maestro/language/shell-customize-tabs.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-007 | Tab switch does not crash the Tutor draft | | | | Maestro | `e2e/maestro/language/shell-tutor-draft.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-008 | Tutor tab opens `/chat` | | | | Maestro | `e2e/maestro/language/tutor.yaml`, `e2e/maestro/la | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-009 | Plan tab opens `/language-plan` | | | | Maestro | `e2e/maestro/language/plan.yaml`, `e2e/maestro/lan | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-010 | Review tab opens `/language-review` | | | | Maestro | `e2e/maestro/language/review.yaml`, `e2e/maestro/l | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-011 | More tab routes to `/settings`, not a `language-more` route | | | | Maestro | `e2e/maestro/language/subflows/go-more.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-012 | Tab bar never exceeds 5 visible tabs | | | | Maestro | `e2e/maestro/language/shell-customize-tabs.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-013 | Tab prefs survive a relaunch | | | | Maestro | `e2e/maestro/language/shell-customize-tabs.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-015 | Deep link to a hidden tab from cold start | | | | Maestro | `e2e/maestro/language/shell-customize-tabs.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-001 | Learn home loads | | | | Maestro, Unit | `e2e/maestro/language/learn-home.yaml`, `src/featu | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-003 | Scroll to bottom sentinel | | | | Maestro | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-008 | Review card shows the due-count badge | | | | Maestro, Unit | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-009 | Dialogue nav card visible | | | | Maestro | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-010 | Tutor nav card visible | | | | Maestro | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-011 | Tap Assessment card | | | | Maestro | `e2e/maestro/language/assessment.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-012 | Tap Plan card | | | | Maestro | `e2e/maestro/language/subflows/go-plan.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-013 | Tap Review card | | | | Maestro | `e2e/maestro/language/subflows/go-review.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-014 | Tap Dialogue card | | | | Maestro | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-015 | Tap Tutor card | | | | Maestro | `e2e/maestro/language/subflows/go-tutor.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-016 | Header avatar opens Profile | | | | Maestro | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-017 | Header bell opens Notifications | | | | Maestro | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-019 | Toggle daily goal — Speak for 2 minutes | | | | Unit, Maestro | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-020 | Toggle daily goal — Learn something new | | | | Unit, Maestro | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-024 | Backend state refreshes on tab focus | | | | Maestro | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-036 | Duplicate `Review vocabulary` label is disambiguated | | | | Maestro | `e2e/maestro/language/learn-home.yaml` (documents  | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-001 | Tutor screen loads | | | | Maestro, Unit | `e2e/maestro/language/tutor.yaml`, `src/features/l | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-005 | Composer visible after boot | | | | Maestro | `e2e/maestro/language/tutor.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-007 | Typing enables Send | | | | Maestro | `e2e/maestro/language/tutor.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-008 | Send a message | | | | Maestro, Unit | `e2e/maestro/language/tutor.yaml`, `src/features/l | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-011 | Message list scrolls | | | | Maestro | `e2e/maestro/language/tutor.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-012 | Keyboard avoidance | | | | Maestro | `e2e/maestro/language/tutor.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-017 | Tutor has **no** header back button (tab-level screen) | | | | Maestro | `e2e/maestro/language/subflows/go-tutor.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-021 | Composer grows then caps | | | | Maestro | `e2e/maestro/language/tutor.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-025 | Send button is reachable by accessibility label | | | | Maestro | `e2e/maestro/language/tutor.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-001 | Plan screen loads | | | | Maestro, Unit | `e2e/maestro/language/plan.yaml`, `src/features/la | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-003 | Scroll the full plan | | | | Maestro | `e2e/maestro/language/plan.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-004 | Empty state when no plan exists | | | | Unit, Maestro | `src/features/language/screens/__tests__/LanguageP | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-005 | Empty-state CTA navigates | | | | Maestro | `e2e/maestro/language/plan.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-011 | Header back returns | | | | Maestro | `e2e/maestro/language/subflows/go-plan.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-016 | Plan is generated by completing the assessment | | | | Maestro, Live | `e2e/maestro/language/assessment.yaml` → `e2e/maes | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-018 | Plan does **not** refetch on tab focus | | | | Maestro | `e2e/maestro/language/plan.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-023 | Plan screen exposes no write control | | | | Maestro | `e2e/maestro/language/plan.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-001 | Review screen loads | | | | Maestro, Unit | `e2e/maestro/language/review.yaml`, `src/features/ | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-003 | Empty queue state | | | | Maestro, Unit | `e2e/maestro/language/review.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-006 | Tap to reveal | | | | Maestro, Unit | `e2e/maestro/language/review.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-007 | Rating buttons visible after reveal | | | | Maestro | `e2e/maestro/language/review.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-008 | Rate **Good** | | | | Maestro, Unit | `e2e/maestro/language/review.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-012 | Complete the session | | | | Maestro | `e2e/maestro/language/review.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-013 | **[ Done ]** returns | | | | Maestro | `e2e/maestro/language/review.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-014 | Back mid-session preserves submitted ratings | | | | Maestro | `e2e/maestro/language/review.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-020 | Review screen has no scrollable surface | | | | Maestro | `e2e/maestro/language/review.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-001 | Assessment screen loads | | | | Maestro, Unit | `e2e/maestro/language/assessment.yaml`, `src/featu | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-003 | Scroll a long question | | | | Maestro | `e2e/maestro/language/assessment.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-007 | Select an MCQ option | | | | Maestro | `e2e/maestro/language/assessment.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-011 | Submit an MCQ answer | | | | Maestro, Unit | `e2e/maestro/language/assessment.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-014 | Complete the assessment | | | | Maestro, API | `e2e/maestro/language/assessment.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-017 | Continue-to-plan CTA | | | | Maestro | `e2e/maestro/language/assessment.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-018 | Back mid-assessment | | | | Maestro | `e2e/maestro/language/assessment.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-031 | Back during grading | | | | Maestro | `e2e/maestro/language/assessment.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-001 | Dialogue screen loads | | | | Maestro, Unit | `e2e/maestro/language/dialogue.yaml`, `src/feature | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-002 | Scroll a generated dialogue | | | | Maestro | `e2e/maestro/language/dialogue.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-003 | Five scenario tiles visible | | | | Maestro, Unit | `e2e/maestro/language/dialogue.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-004 | Tap **Restaurant** | | | | Maestro | `e2e/maestro/language/dialogue.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-010 | Exchange bubbles render | | | | Maestro, Unit | `e2e/maestro/language/dialogue.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-014 | Switching scenario clears the previous output | | | | Maestro | `e2e/maestro/language/dialogue.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-016 | Header back returns | | | | Maestro | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-001 | Onboarding loads | | | | Maestro, Unit | `e2e/maestro/language/onboarding.yaml`, `src/featu | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-002 | Scroll to the CTA | | | | Maestro | `e2e/maestro/language/onboarding.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-004 | Select a native language | | | | Maestro, Unit | `e2e/maestro/language/onboarding.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-009 | Finish onboarding | | | | Maestro, Unit | `e2e/maestro/language/onboarding.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-012 | Subflow skips an onboarded learner | | | | Maestro | `e2e/maestro/language/subflows/language-onboarding | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-017 | Onboarding does not push — it replaces | | | | Maestro | `e2e/maestro/language/onboarding.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-020 | Onboarding screen has no testID | | | | Maestro | `e2e/maestro/language/onboarding.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-001 | More screen loads | | | | Maestro, Unit | `e2e/maestro/language/more-settings.yaml`, `src/fe | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-002 | Scroll to the version footer | | | | Maestro | `e2e/maestro/language/more-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-003 | Tab overflow section visible | | | | Maestro | `e2e/maestro/language/more-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-004 | Account section rows | | | | Maestro, Unit | `e2e/maestro/language/more-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-005 | AI section rows | | | | Maestro, Unit | `e2e/maestro/language/more-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-006 | Data section row | | | | Maestro, Unit | `e2e/maestro/language/more-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-007 | Profile row navigates | | | | Maestro | `e2e/maestro/language/more-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-008 | Notifications row navigates | | | | Maestro | `e2e/maestro/language/more-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-009 | AI assistance row navigates | | | | Maestro | `e2e/maestro/language/more-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-010 | AI Providers row navigates | | | | Maestro | `e2e/maestro/language/more-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-011 | Sign-out Alert can be cancelled | | | | Maestro | `e2e/maestro/language/more-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-012 | Sign-out confirm logs out | | | | Maestro | `e2e/maestro/language/more-sign-out.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-013 | Reset Alert can be cancelled | | | | Maestro | `e2e/maestro/language/more-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-014 | Reset learning data | | | | Maestro, Unit | `e2e/maestro/language/more-reset-learning.yaml`, ` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-018 | Customize tabs from More | | | | Maestro | `e2e/maestro/language/shell-customize-tabs.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-021 | Destructive Alert copy is exact | | | | Maestro | `e2e/maestro/language/more-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-022 | More header suppresses bell, avatar, and property switcher | | | | Maestro | `e2e/maestro/language/more-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-023 | No household / property surface | | | | Maestro | `e2e/maestro/language/more-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-024 | Reset does not clear local Language state | | | | Maestro | `e2e/maestro/language/more-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-025 | Exactly six setting rows | | | | Maestro | `e2e/maestro/language/more-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
