# Symply Language Acceptance Results — language

| Field | Value |
|-------|-------|
| **Doc type** | Dated scoring copy (Circle V2 style) |
| **App / scope** | `language` |
| **Run date** | `language` |
| **Environment** | `/tmp/maestro-language-full4.log` |
| **Device / OS** | /tmp/maestro-language-2026-07-19.log |
| **Matrix source** | [language.md](./language.md) |
| **Maestro log(s)** | `/tmp/maestro-language-language.log` |

## Summary

| Metric | Count |
|--------|------:|
| Matrix rows | 246 |
| Pass | 0 |
| Fail | 0 |
| N/A | 246 |
| Pass rate (excl. N/A) | — |
| Maestro flows (merged) | 0 (0 pass / 0 fail) |

## Results

| ID | Description | Steps | Expected | Layer | Automation | Pass | Fail | N/A | Notes |
|----|-------------|-------|----------|-------|------------|:----:|:----:|:---:|-------|
| LANG-SMOKE-001 | All 5 default tabs mount without crash | | | | Maestro | `e2e/maestro/language/learn-home.yaml`, `e2e/maestro/languag | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SMOKE-002 | Hidden tabs are routable once pinned | | | | Maestro | `e2e/maestro/language/more-settings.yaml` (asserts the secti | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SMOKE-003 | Learn home hydration smoke | | | | Maestro | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SMOKE-004 | Staging Worker reachable | | | | Maestro, Live | `e2e/maestro/language/tutor.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SMOKE-005 | Screen unit suite green | | | | Unit | `src/features/language/screens/__tests__/`, `src/features/la | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SMOKE-006 | API base URL resolves to the Language Worker | | | | Unit | `src/features/language/api/__tests__/languageClient.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SMOKE-007 | Client appends `/api/v1`, base URL does not contain it | | | | Unit | `src/features/language/api/__tests__/languageClient.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SMOKE-008 | Language routes bypass the shared axios client | | | | Unit | `src/features/language/api/__tests__/languageClient.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-AUTH-001 | Login screen controls visible | | | | Maestro | `e2e/maestro/language/language-auth-validation.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-AUTH-002 | Email/password login succeeds | | | | Maestro, API | `e2e/maestro/language/subflows/language-login-if-needed.yaml | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-AUTH-003 | Silent token refresh on 401 | | | | Unit | `src/features/language/api/__tests__/languageClient.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-AUTH-004 | Register a new account | | | | API | `backend-language/src/routes/auth.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-AUTH-005 | Forgot password | | | | API | `backend-language/src/routes/auth.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-AUTH-006 | Reset password with token | | | | API | `backend-language/src/routes/auth.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-AUTH-007 | Apple sign-in | | | | Live | `e2e/maestro/language/language-auth-validation.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-AUTH-008 | Google sign-in | | | | Live | `e2e/maestro/language/language-auth-validation.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-AUTH-009 | Client-side logout clears the session | | | | Unit | `src/stores/__tests__/authStore.logout.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-AUTH-010 | Wrong password rejected | | | | Unit, API | `backend-language/src/routes/auth.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-AUTH-011 | Empty credentials do not call the API | | | | Maestro | `e2e/maestro/language/language-auth-validation.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-AUTH-012 | Malformed email rejected client-side | | | | Unit | `e2e/maestro/language/language-auth-validation.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-AUTH-013 | Refresh failure forces logout | | | | Unit | `src/features/language/api/__tests__/languageClient.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-001 | Default tab bar renders 5 tabs | | | | Maestro | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-002 | Learn tab is locked (not hideable) | | | | Maestro | `e2e/maestro/language/shell-customize-tabs.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-003 | More tab is locked (not hideable) | | | | Maestro | `e2e/maestro/language/shell-customize-tabs.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-004 | Pin Assessment | | | | Maestro | `e2e/maestro/language/shell-customize-tabs.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-005 | Unpin Assessment; route stays deep-linkable | | | | Maestro | `e2e/maestro/language/assessment.yaml` (uses the deep-link f | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-006 | Pin Dialogue | | | | Maestro | `e2e/maestro/language/shell-customize-tabs.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-007 | Tab switch does not crash the Tutor draft | | | | Maestro | `e2e/maestro/language/shell-tutor-draft.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-008 | Tutor tab opens `/chat` | | | | Maestro | `e2e/maestro/language/tutor.yaml`, `e2e/maestro/language/sub | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-009 | Plan tab opens `/language-plan` | | | | Maestro | `e2e/maestro/language/plan.yaml`, `e2e/maestro/language/subf | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-010 | Review tab opens `/language-review` | | | | Maestro | `e2e/maestro/language/review.yaml`, `e2e/maestro/language/su | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-011 | More tab routes to `/settings`, not a `language-more` route | | | | Maestro | `e2e/maestro/language/subflows/go-more.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-012 | Tab bar never exceeds 5 visible tabs | | | | Maestro | `e2e/maestro/language/shell-customize-tabs.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-013 | Tab prefs survive a relaunch | | | | Maestro | `e2e/maestro/language/shell-customize-tabs.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-014 | Non-Language brand redirects the Language routes | | | | Unit | `e2e/maestro/language/shell-customize-tabs.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-SHELL-015 | Deep link to a hidden tab from cold start | | | | Maestro | `e2e/maestro/language/shell-customize-tabs.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-001 | Learn home loads | | | | Maestro, Unit | `e2e/maestro/language/learn-home.yaml`, `src/features/langua | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-002 | Loading spinner precedes content | | | | Unit | `src/features/language/screens/__tests__/LanguageLearnScreen | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-003 | Scroll to bottom sentinel | | | | Maestro | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-004 | Greeting renders with name suffix | | | | Unit | `src/features/language/screens/__tests__/LanguageLearnScreen | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-005 | Streak card visible | | | | Unit | `src/features/language/screens/__tests__/LanguageLearnScreen | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-006 | Slot-1 card is Assessment when assessment is due and no plan exists | | | | Unit | `src/features/language/screens/__tests__/LanguageLearnScreen | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-007 | Slot-1 card is Plan once a plan exists | | | | Unit | `src/features/language/screens/__tests__/LanguageLearnScreen | ☐ | ☐ | ☑ | Suite not run or log missing |
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
| LANG-LEARN-018 | Toggle daily goal — Review vocabulary | | | | Unit | `src/features/language/screens/__tests__/LanguageLearnScreen | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-019 | Toggle daily goal — Speak for 2 minutes | | | | Unit, Maestro | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-020 | Toggle daily goal — Learn something new | | | | Unit, Maestro | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-021 | Unchecking restores the counter | | | | Unit | `src/features/language/__tests__/languageLocalStorage.test.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-022 | All-goals-complete copy swap | | | | Unit | `src/features/language/screens/__tests__/LanguageLearnScreen | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-023 | Streak increments on first full completion of the day | | | | Unit | `src/features/language/__tests__/languageLocalStorage.test.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-024 | Backend state refreshes on tab focus | | | | Maestro | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-025 | Widget snapshot written on Learn | | | | Unit | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-026 | Backend failure degrades gracefully | | | | Unit | `src/features/language/screens/__tests__/LanguageLearnScreen | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-027 | Widget streak matches the card | | | | Unit | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-028 | Greeting varies by time of day | | | | Unit | `src/features/language/screens/__tests__/LanguageLearnScreen | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-029 | Greeting omits the suffix when no display name | | | | Unit | `src/features/language/screens/__tests__/LanguageLearnScreen | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-030 | Streak pluralisation | | | | Unit | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-031 | Due-count pluralisation | | | | Unit | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-032 | Zero due cards → chevron, not badge | | | | Unit | `src/features/language/screens/__tests__/LanguageLearnScreen | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-033 | Plan-card subtitle when a plan is absent but assessment is done | | | | Unit | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-034 | Completed goal label is struck through | | | | Unit | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-035 | Tapping a goal before local hydration is a no-op | | | | Unit | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-036 | Duplicate `Review vocabulary` label is disambiguated | | | | Maestro | `e2e/maestro/language/learn-home.yaml` (documents the collis | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-LEARN-037 | Widget `next_lesson` reflects learner state | | | | Unit | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-001 | Tutor screen loads | | | | Maestro, Unit | `e2e/maestro/language/tutor.yaml`, `src/features/language/sc | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-002 | Session is created on mount | | | | Unit, API | `src/features/language/screens/__tests__/LanguageTutorScreen | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-003 | Prior messages hydrate after session create | | | | Unit, API | `src/features/language/api/__tests__/languageApiWrappers.tes | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-004 | Empty state on a fresh session | | | | Unit | `src/features/language/screens/__tests__/LanguageTutorScreen | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-005 | Composer visible after boot | | | | Maestro | `e2e/maestro/language/tutor.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-006 | Send is disabled while the draft is empty | | | | Unit | `src/features/language/screens/__tests__/LanguageTutorScreen | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-007 | Typing enables Send | | | | Maestro | `e2e/maestro/language/tutor.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-008 | Send a message | | | | Maestro, Unit | `e2e/maestro/language/tutor.yaml`, `src/features/language/sc | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-009 | Send clears the composer immediately | | | | Unit | `src/features/language/screens/__tests__/LanguageTutorScreen | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-010 | Send button shows a spinner while in flight | | | | Unit | `src/features/language/screens/__tests__/LanguageTutorScreen | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-011 | Message list scrolls | | | | Maestro | `e2e/maestro/language/tutor.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-012 | Keyboard avoidance | | | | Maestro | `e2e/maestro/language/tutor.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-013 | Duplicate-send guard | | | | Unit | `src/features/language/screens/__tests__/LanguageTutorScreen | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-014 | Send failure renders an inline tutor bubble | | | | Unit | `src/features/language/screens/__tests__/LanguageTutorScreen | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-015 | Boot failure renders an error footnote | | | | Unit | `src/features/language/screens/__tests__/LanguageTutorScreen | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-016 | Composer is not editable without a session | | | | Unit | `src/features/language/screens/__tests__/LanguageTutorScreen | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-017 | Tutor has **no** header back button (tab-level screen) | | | | Maestro | `e2e/maestro/language/subflows/go-tutor.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-018 | Teaching-chat message contract | | | | API | `backend-language/src/routes/teachingChatSession.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-019 | Session history endpoint | | | | API | `e2e/maestro/language/tutor.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-020 | Return key submits the message | | | | Unit | `e2e/maestro/language/tutor.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-021 | Composer grows then caps | | | | Maestro | `e2e/maestro/language/tutor.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-022 | List auto-scrolls to the newest bubble | | | | Unit | `e2e/maestro/language/tutor.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-023 | Error footnote clears on the next send | | | | Unit | `e2e/maestro/language/tutor.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-024 | Send stays disabled during an in-flight request | | | | Unit | `e2e/maestro/language/tutor.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-025 | Send button is reachable by accessibility label | | | | Maestro | `e2e/maestro/language/tutor.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-TUTOR-026 | Whitespace-only draft is rejected | | | | Unit | `e2e/maestro/language/tutor.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-001 | Plan screen loads | | | | Maestro, Unit | `e2e/maestro/language/plan.yaml`, `src/features/language/scr | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-002 | Loading state | | | | Unit | `src/features/language/screens/__tests__/LanguagePlanScreen. | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-003 | Scroll the full plan | | | | Maestro | `e2e/maestro/language/plan.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-004 | Empty state when no plan exists | | | | Unit, Maestro | `src/features/language/screens/__tests__/LanguagePlanScreen. | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-005 | Empty-state CTA navigates | | | | Maestro | `e2e/maestro/language/plan.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-006 | Level row renders | | | | Unit | `src/features/language/screens/__tests__/LanguagePlanScreen. | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-007 | Progress bar width matches completion | | | | Unit | `src/features/language/screens/__tests__/LanguagePlanScreen. | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-008 | Task summary footnote | | | | Unit | `src/features/language/screens/__tests__/LanguagePlanScreen. | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-009 | Goals list renders | | | | Unit | `src/features/language/screens/__tests__/LanguagePlanScreen. | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-010 | Today metrics render | | | | Unit | `src/features/language/screens/__tests__/LanguagePlanScreen. | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-011 | Header back returns | | | | Maestro | `e2e/maestro/language/subflows/go-plan.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-012 | Partial failure — progress down, plan up | | | | Unit | `src/features/language/screens/__tests__/LanguagePlanScreen. | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-013 | Both calls fail → empty state, not a crash | | | | Unit | `src/features/language/screens/__tests__/LanguagePlanScreen. | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-014 | Plan 404 maps to `null`, not an error | | | | Unit, API | `src/features/language/api/__tests__/languageApiWrappers.tes | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-015 | Progress snapshot contract | | | | API | `backend-language/src/routes/progress.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-016 | Plan is generated by completing the assessment | | | | Maestro, Live | `e2e/maestro/language/assessment.yaml` → `e2e/maestro/langua | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-017 | Plan generate endpoint | | | | API | `backend-language/src/routes/learningPlanSchedule.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-018 | Plan does **not** refetch on tab focus | | | | Maestro | `e2e/maestro/language/plan.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-019 | Target level omitted when unset | | | | Unit | `e2e/maestro/language/plan.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-020 | Goals card omitted when empty | | | | Unit | `e2e/maestro/language/plan.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-021 | Today card omitted without progress data | | | | Unit | `e2e/maestro/language/plan.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-022 | Zero-task plan renders a 0% bar, not `NaN` | | | | Unit | `e2e/maestro/language/plan.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-PLAN-023 | Plan screen exposes no write control | | | | Maestro | `e2e/maestro/language/plan.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-001 | Review screen loads | | | | Maestro, Unit | `e2e/maestro/language/review.yaml`, `src/features/language/s | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-002 | Loading spinner | | | | Unit | `src/features/language/screens/__tests__/LanguageReviewScree | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-003 | Empty queue state | | | | Maestro, Unit | `e2e/maestro/language/review.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-004 | Due counter | | | | Unit | `src/features/language/screens/__tests__/LanguageReviewScree | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-005 | Flashcard front | | | | Unit | `src/features/language/screens/__tests__/LanguageReviewScree | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-006 | Tap to reveal | | | | Maestro, Unit | `e2e/maestro/language/review.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-007 | Rating buttons visible after reveal | | | | Maestro | `e2e/maestro/language/review.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-008 | Rate **Good** | | | | Maestro, Unit | `e2e/maestro/language/review.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-009 | Rate **Again** | | | | Unit | `src/features/language/screens/__tests__/LanguageReviewScree | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-010 | Rate **Hard** | | | | Unit | `e2e/maestro/language/review.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-011 | Rate **Easy** | | | | Unit | `e2e/maestro/language/review.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-012 | Complete the session | | | | Maestro | `e2e/maestro/language/review.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-013 | **[ Done ]** returns | | | | Maestro | `e2e/maestro/language/review.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-014 | Back mid-session preserves submitted ratings | | | | Maestro | `e2e/maestro/language/review.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-015 | Card cannot be double-revealed | | | | Unit | `src/features/language/screens/__tests__/LanguageReviewScree | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-016 | A failed rating is silently dropped | | | | Unit | `src/features/language/screens/__tests__/LanguageReviewScree | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-017 | Due-queue load failure → empty state | | | | Unit | `src/features/language/screens/__tests__/LanguageReviewScree | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-018 | FSRS review contract | | | | API | `backend-language/src/routes/reviews.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-019 | Review history endpoint | | | | API | `backend-language/src/routes/reviews.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-020 | Review screen has no scrollable surface | | | | Maestro | `e2e/maestro/language/review.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-021 | Rating is impossible before reveal | | | | Unit | `src/features/language/screens/__tests__/LanguageReviewScree | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-022 | Counter tracks the queue position | | | | Unit | `e2e/maestro/language/review.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-023 | Completion copy pluralises | | | | Unit | `e2e/maestro/language/review.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-024 | Completion vs empty icon differ | | | | Unit | `e2e/maestro/language/review.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-REVIEW-025 | Rapid double-rate does not skip a card | | | | Unit | `e2e/maestro/language/review.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-001 | Assessment screen loads | | | | Maestro, Unit | `e2e/maestro/language/assessment.yaml`, `src/features/langua | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-002 | Boot loading copy | | | | Unit | `src/features/language/screens/__tests__/LanguageAssessmentS | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-003 | Scroll a long question | | | | Maestro | `e2e/maestro/language/assessment.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-004 | Progress bar reflects position | | | | Unit | `src/features/language/screens/__tests__/LanguageAssessmentS | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-005 | Question meta line | | | | Unit | `src/features/language/screens/__tests__/LanguageAssessmentS | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-006 | MCQ options render | | | | Unit | `src/features/language/screens/__tests__/LanguageAssessmentS | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-007 | Select an MCQ option | | | | Maestro | `e2e/maestro/language/assessment.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-008 | Free-text answer field | | | | Unit | `src/features/language/screens/__tests__/LanguageAssessmentS | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-009 | Voice questions degrade to typing | | | | Unit | `src/features/language/screens/__tests__/LanguageAssessmentS | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-010 | Submit is disabled with no answer | | | | Unit | `src/features/language/screens/__tests__/LanguageAssessmentS | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-011 | Submit an MCQ answer | | | | Maestro, Unit | `e2e/maestro/language/assessment.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-012 | Submit a typed answer | | | | Unit | `src/features/language/screens/__tests__/LanguageAssessmentS | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-013 | Next-question endpoint | | | | API | `backend-language/src/routes/assessmentScenarioMatrix.test.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-014 | Complete the assessment | | | | Maestro, API | `e2e/maestro/language/assessment.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-015 | CEFR badge on results | | | | Unit | `src/features/language/screens/__tests__/LanguageAssessmentS | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-016 | Strengths list | | | | Unit | `src/features/language/screens/__tests__/LanguageAssessmentS | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-017 | Continue-to-plan CTA | | | | Maestro | `e2e/maestro/language/assessment.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-018 | Back mid-assessment | | | | Maestro | `e2e/maestro/language/assessment.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-019 | Boot error state | | | | Unit | `src/features/language/screens/__tests__/LanguageAssessmentS | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-020 | Submit error state | | | | Unit | `src/features/language/screens/__tests__/LanguageAssessmentS | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-021 | **[ Try again ]** re-runs boot | | | | Unit | `src/features/language/screens/__tests__/LanguageAssessmentS | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-022 | Assessment status contract | | | | API | `backend-language/src/routes/assessmentScenarioMatrix.test.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-023 | Assessment results endpoint | | | | API | `e2e/maestro/language/assessment.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-024 | Grading copy differs from boot copy | | | | Unit | `e2e/maestro/language/assessment.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-025 | `inputMode` is `tap` for MCQ, `type` for free text | | | | Unit | `e2e/maestro/language/assessment.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-026 | Retry after a **submit** failure restarts the assessment | | | | Unit | `e2e/maestro/language/assessment.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-027 | Overall proficiency card | | | | Unit | `e2e/maestro/language/assessment.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-028 | Missing CEFR level renders an em dash | | | | Unit | `e2e/maestro/language/assessment.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-029 | Strengths card omitted when empty | | | | Unit | `e2e/maestro/language/assessment.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-030 | Progress bar clamps at 100% | | | | Unit | `e2e/maestro/language/assessment.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ASSESS-031 | Back during grading | | | | Maestro | `e2e/maestro/language/assessment.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-001 | Dialogue screen loads | | | | Maestro, Unit | `e2e/maestro/language/dialogue.yaml`, `src/features/language | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-002 | Scroll a generated dialogue | | | | Maestro | `e2e/maestro/language/dialogue.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-003 | Five scenario tiles visible | | | | Maestro, Unit | `e2e/maestro/language/dialogue.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-004 | Tap **Restaurant** | | | | Maestro | `e2e/maestro/language/dialogue.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-005 | Tap **Doctor** | | | | Unit | `src/features/language/screens/__tests__/LanguageDialogueScr | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-006 | Tap **Workplace** | | | | Unit | `src/features/language/screens/__tests__/LanguageDialogueScr | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-007 | Tap **Airport** | | | | Unit | `src/features/language/screens/__tests__/LanguageDialogueScr | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-008 | Tap **Hotel** | | | | Unit | `src/features/language/screens/__tests__/LanguageDialogueScr | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-009 | Loading state | | | | Unit | `src/features/language/screens/__tests__/LanguageDialogueScr | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-010 | Exchange bubbles render | | | | Maestro, Unit | `e2e/maestro/language/dialogue.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-011 | Context line | | | | Unit | `src/features/language/screens/__tests__/LanguageDialogueScr | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-012 | Key vocabulary card | | | | Unit | `src/features/language/screens/__tests__/LanguageDialogueScr | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-013 | Tips card | | | | Unit | `src/features/language/screens/__tests__/LanguageDialogueScr | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-014 | Switching scenario clears the previous output | | | | Maestro | `e2e/maestro/language/dialogue.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-015 | Generate failure | | | | Unit | `src/features/language/screens/__tests__/LanguageDialogueScr | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-016 | Header back returns | | | | Maestro | `e2e/maestro/language/learn-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-017 | Dialogue generate contract | | | | API | `backend-language/src/routes/dialogues.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-018 | Rapid tile tapping is not guarded | | | | Unit | `src/features/language/screens/__tests__/LanguageDialogueScr | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-019 | Pristine state shows neither output nor error | | | | Unit | `src/features/language/screens/__tests__/LanguageDialogueScr | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-020 | Translation line omitted when absent | | | | Unit | `src/features/language/screens/__tests__/LanguageDialogueScr | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-021 | Vocabulary card omitted when empty | | | | Unit | `src/features/language/screens/__tests__/LanguageDialogueScr | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-022 | Tips card omitted when empty | | | | Unit | `src/features/language/screens/__tests__/LanguageDialogueScr | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-DIAL-023 | Error clears on the next generate | | | | Unit | `src/features/language/screens/__tests__/LanguageDialogueScr | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-001 | Onboarding loads | | | | Maestro, Unit | `e2e/maestro/language/onboarding.yaml`, `src/features/langua | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-002 | Scroll to the CTA | | | | Maestro | `e2e/maestro/language/onboarding.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-003 | Native-language chips visible | | | | Unit | `src/features/language/screens/__tests__/LanguageOnboardingS | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-004 | Select a native language | | | | Maestro, Unit | `e2e/maestro/language/onboarding.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-005 | Motivation chips visible | | | | Unit | `src/features/language/screens/__tests__/LanguageOnboardingS | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-006 | Motivations are multi-select | | | | Unit | `src/features/language/screens/__tests__/LanguageOnboardingS | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-007 | Deselect a motivation | | | | Unit | `src/features/language/screens/__tests__/LanguageOnboardingS | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-008 | CTA disabled without a native language | | | | Unit | `src/features/language/screens/__tests__/LanguageOnboardingS | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-009 | Finish onboarding | | | | Maestro, Unit | `e2e/maestro/language/onboarding.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-010 | Saving spinner on the CTA | | | | Unit | `src/features/language/screens/__tests__/LanguageOnboardingS | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-011 | Profile PUT failure is non-blocking | | | | Unit | `src/features/language/screens/__tests__/LanguageOnboardingS | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-012 | Subflow skips an onboarded learner | | | | Maestro | `e2e/maestro/language/subflows/language-onboarding-if-needed | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-013 | Language uses LanguageOnboarding, not ChildWelcome | | | | Unit | `src/features/language/screens/__tests__/LanguageOnboardingS | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-014 | Learner profile round-trips | | | | API | `backend-language/src/routes/learner.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-015 | Native-language selection is single-select | | | | Unit | `src/features/language/screens/__tests__/LanguageOnboardingS | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-016 | Motivations are genuinely optional | | | | Unit | `src/features/language/screens/__tests__/LanguageOnboardingS | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-017 | Onboarding does not push — it replaces | | | | Maestro | `e2e/maestro/language/onboarding.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-018 | Double-tapping the CTA sends one PUT | | | | Unit | `src/features/language/screens/__tests__/LanguageOnboardingS | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-019 | Motivation ids, not labels, are sent | | | | Unit | `src/features/language/screens/__tests__/LanguageOnboardingS | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-ONBD-020 | Onboarding screen has no testID | | | | Maestro | `e2e/maestro/language/onboarding.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-001 | More screen loads | | | | Maestro, Unit | `e2e/maestro/language/more-settings.yaml`, `src/features/lan | ☐ | ☐ | ☑ | Suite not run or log missing |
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
| LANG-MORE-014 | Reset learning data | | | | Maestro, Unit | `e2e/maestro/language/more-reset-learning.yaml`, `src/featur | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-015 | Reset failure alert | | | | Unit | `src/features/language/screens/__tests__/LanguageMoreScreen. | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-016 | Row is inert while resetting | | | | Unit | `src/features/language/screens/__tests__/LanguageMoreScreen. | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-017 | Version footer | | | | Unit | `src/features/language/screens/__tests__/LanguageMoreScreen. | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-018 | Customize tabs from More | | | | Maestro | `e2e/maestro/language/shell-customize-tabs.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-019 | Learner context endpoint | | | | API | `backend-language/src/routes/learner.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-020 | User profile endpoint | | | | API | `backend-language/src/routes/user.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-021 | Destructive Alert copy is exact | | | | Maestro | `e2e/maestro/language/more-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-022 | More header suppresses bell, avatar, and property switcher | | | | Maestro | `e2e/maestro/language/more-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-023 | No household / property surface | | | | Maestro | `e2e/maestro/language/more-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-024 | Reset does not clear local Language state | | | | Maestro | `e2e/maestro/language/more-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| LANG-MORE-025 | Exactly six setting rows | | | | Maestro | `e2e/maestro/language/more-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
