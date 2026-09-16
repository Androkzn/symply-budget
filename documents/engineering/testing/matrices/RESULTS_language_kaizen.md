# Symply Kaizen Acceptance Results — language

| Field | Value |
|-------|-------|
| **Doc type** | Dated scoring copy (Circle V2 style) |
| **App / scope** | `kaizen` |
| **Run date** | `language` |
| **Environment** | `/tmp/maestro-language-full4.log` |
| **Device / OS** | /tmp/maestro-language-2026-07-19.log |
| **Matrix source** | [kaizen.md](./kaizen.md) |
| **Maestro log(s)** | `/tmp/maestro-kaizen-language.log` |

## Summary

| Metric | Count |
|--------|------:|
| Matrix rows | 479 |
| Pass | 0 |
| Fail | 0 |
| N/A | 479 |
| Pass rate (excl. N/A) | — |
| Maestro flows (merged) | 0 (0 pass / 0 fail) |

## Results

| ID | Description | Steps | Expected | Layer | Automation | Pass | Fail | N/A | Notes |
|----|-------------|-------|----------|-------|------------|:----:|:----:|:---:|-------|
| KAIZEN-SMOKE-001 | All seven Kaizen hubs mount in one session without a crash | | | | Maestro | `e2e/maestro/kaizen/all-hubs.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SMOKE-002 | Full Kaizen Maestro suite executes end to end | | | | Maestro | `scripts/e2e/run-kaizen-suite.sh`, `e2e/maestro/kaizen/today | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SMOKE-003 | Kaizen navigation shell mounts | | | | Unit | `src/features/kaizen/screens/__tests__/KaizenScreen.test.tsx | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SMOKE-004 | More hub lists every section and pushes each route | | | | Maestro, Unit | `e2e/maestro/kaizen/more-hub.yaml`, `src/features/kaizen/scr | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SMOKE-005 | Systems hub reachable with enabled systems listed | | | | Maestro, Unit | `e2e/maestro/kaizen/systems-hub.yaml`, `src/features/kaizen/ | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SMOKE-006 | Career hub reachable with live stats | | | | Maestro, Unit | `e2e/maestro/kaizen/career-hub.yaml`, `src/features/kaizen/s | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SMOKE-007 | Assess hub reachable with mastery summary | | | | Maestro, Unit | `e2e/maestro/kaizen/assess-hub.yaml`, `src/features/kaizen/s | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SMOKE-008 | Learn hub reachable with capture card | | | | Maestro, Unit | `e2e/maestro/kaizen/learn-hub.yaml`, `src/features/kaizen/sc | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SMOKE-009 | Guide hub reachable with coach shell | | | | Maestro, Unit | `e2e/maestro/kaizen/guide-screen.yaml`, `src/features/kaizen | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SMOKE-010 | Today hub reachable after the DB gate | | | | Maestro, Unit | `e2e/maestro/kaizen/today-screen.yaml`, `src/features/kaizen | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SMOKE-011 | Every scrollable Kaizen screen declares a scroll-end sentinel | | | | Unit | `e2e/maestro/kaizen/scroll-all-screens.yaml`, `src/features/ | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SMOKE-012 | `kaizen://e2e-setup` deep link bypasses onboarding | | | | Maestro | `e2e/maestro/kaizen/subflows/kaizen-setup-if-needed.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SMOKE-013 | Kaizen tab registry pins the right four tabs | | | | Unit | `app/(tabs)/__tests__/kaizenTabs.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SMOKE-014 | Mira tab is absent from the Kaizen shell | | | | Unit | `app/(tabs)/__tests__/mira.kaizen.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SMOKE-015 | Kaizen feature barrel exports the shipped surface | | | | Unit | `src/features/kaizen/__tests__/index.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SMOKE-016 | `isKaizenBrand` gating is exact | | | | Unit | `src/features/kaizen/__tests__/branding.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SMOKE-017 | Kaizen brand icon states resolve per theme | | | | Unit | `src/features/kaizen/brand/iconset/__tests__/index.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SMOKE-018 | Kaizen glass/brand shell renders in both modes | | | | Unit | `src/features/kaizen/brand/__tests__/index.test.tsx`, `src/f | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-001 | Every hub reaches its bottom sentinel | | | | Maestro | `e2e/maestro/kaizen/scroll-all-screens.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-002 | Today reaches `kaizen-today-screen-scroll-end` | | | | Maestro | `e2e/maestro/kaizen/scroll-all-screens.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-003 | Guide chat history scrolls to its sentinel | | | | Maestro | `e2e/maestro/kaizen/scroll-all-screens.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-004 | Systems hub reaches its sentinel | | | | Maestro | `e2e/maestro/kaizen/scroll-all-screens.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-005 | Career hub reaches its sentinel | | | | Maestro | `e2e/maestro/kaizen/scroll-all-screens.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-006 | Assess hub reaches its sentinel | | | | Maestro | `e2e/maestro/kaizen/scroll-all-screens.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-007 | Learn hub reaches its sentinel | | | | Maestro | `e2e/maestro/kaizen/scroll-all-screens.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-008 | More hub scrolls to `Systems & focus` and its sentinel | | | | Maestro | `e2e/maestro/kaizen/all-hubs.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-009 | Settings scrolls to the AI section | | | | Maestro | `e2e/maestro/kaizen/settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-010 | Profile scrolls to the logout region | | | | Maestro | `e2e/maestro/kaizen/profile.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-011 | Deep work scrolls to the block list bottom | | | | Maestro | `e2e/maestro/kaizen/deep-work.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-012 | Books scrolls to the add-book form | | | | Maestro | `e2e/maestro/kaizen/books.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-013 | Habit stacks scrolls to the stack list bottom | | | | Maestro | `e2e/maestro/kaizen/habit-stacks.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-014 | Weekly rotation exposes all seven weekday rows | | | | Maestro | `e2e/maestro/kaizen/weekly-rotation.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-015 | System config scrolls to `Save system` | | | | Maestro | `e2e/maestro/kaizen/system-config.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-016 | Question banks scrolls to the import link | | | | Maestro | `e2e/maestro/kaizen/question-banks.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-017 | Question import scrolls to the approve rows | | | | Maestro | `e2e/maestro/kaizen/question-import.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-018 | Practice session scrolls to the submit region | | | | Maestro | `e2e/maestro/kaizen/practice-session.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-019 | Learning plan scrolls to `Back to skill` | | | | Maestro | `e2e/maestro/kaizen/learning-plan.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-020 | Reviews scrolls to `Save review` | | | | Maestro | `e2e/maestro/kaizen/reviews.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-021 | Memory scrolls past the saved-memory list | | | | Maestro | `e2e/maestro/kaizen/memory.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-022 | Notifications scrolls to the oldest inbox row | | | | Maestro | `e2e/maestro/kaizen/notifications.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-023 | Career setup scrolls to `Continue` | | | | Maestro | `e2e/maestro/kaizen/career-setup.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-024 | Interview pipeline scrolls to `Add opportunity` | | | | Maestro | `e2e/maestro/kaizen/interview-pipeline.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-025 | Resume review scrolls to `Review resume` | | | | Maestro | `e2e/maestro/kaizen/resume-review.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-026 | Skill assessment scrolls to `Start assessment` | | | | Maestro | `e2e/maestro/kaizen/skill-assessment.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-027 | Insights scrolls to the last panel | | | | Maestro | `e2e/maestro/kaizen/insights.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-028 | Attempt history scrolls to the oldest attempt | | | | Maestro | `e2e/maestro/kaizen/attempt-history.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-029 | Book detail scrolls to its destructive actions | | | | Maestro | `e2e/maestro/kaizen/book-detail.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-030 | Book reader scrolls to the chapter end | | | | Maestro | `e2e/maestro/kaizen/book-reader.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-031 | Book quiz scrolls to submit | | | | Maestro | `e2e/maestro/kaizen/book-quiz.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-032 | Career progress scrolls to the last metric | | | | Maestro | `e2e/maestro/kaizen/career-progress.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-033 | Skill detail scrolls to its action rows | | | | Maestro | `e2e/maestro/kaizen/skill-detail.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-034 | Overflow hubs scroll after a deep-link entry (no tab press) | | | | Maestro | `e2e/maestro/kaizen/scroll-all-screens.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-035 | Tab bar and safe-area inset never cover the sentinel | | | | Maestro | `e2e/maestro/kaizen/scroll-all-screens.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SCROLL-036 | Scroll surface survives content growth | | | | Maestro, Unit | `e2e/maestro/kaizen/scroll-all-screens.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-001 | Today screen mounts after the SQLite gate | | | | Maestro, Unit | `e2e/maestro/kaizen/today-screen.yaml`, `src/features/kaizen | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-002 | Loading gate renders before the DB is ready | | | | Unit | `src/features/kaizen/screens/__tests__/KaizenTodayScreen.tes | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-003 | Daily core rows render in persisted order | | | | Unit | `src/features/kaizen/services/__tests__/dailyCoreOrdering.te | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-004 | Marking a daily-core item **Done** writes a log row | | | | Maestro, Unit | `e2e/maestro/kaizen/today-screen.yaml`, `src/features/kaizen | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-005 | Marking a daily-core item **Skip** records a skip, not a completion | | | | Maestro | `e2e/maestro/kaizen/today-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-006 | Wake confirmation persists and reschedules reminders | | | | Unit | `src/features/kaizen/services/__tests__/wakeDetection.test.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-007 | Pull-to-refresh re-reads from SQLite | | | | Maestro | `e2e/maestro/kaizen/today-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-008 | Deep-work shortcut opens the DeepWork screen | | | | Maestro | `e2e/maestro/kaizen/deep-work.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-009 | Career-reps row routes into the practice surface | | | | Maestro | `e2e/maestro/kaizen/today-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-010 | Weekly-rotation row opens today's rotation focus | | | | Maestro | `e2e/maestro/kaizen/weekly-rotation.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-011 | Habit-stack row opens the stack it is linked to | | | | Maestro | `e2e/maestro/kaizen/habit-stacks.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-012 | Reordering daily-core items persists `sort_order` | | | | Unit | `src/features/kaizen/services/__tests__/dailyCoreOrdering.te | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-013 | Empty Daily Core shows guidance, not a blank screen | | | | Unit | `src/features/kaizen/screens/__tests__/TodayScreen.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-014 | Streak increments across consecutive completed days | | | | Unit | `src/features/kaizen/services/__tests__/streak.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-015 | Streak survives a miss inside the grace window | | | | Unit | `src/features/kaizen/services/__tests__/streak.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-016 | Streak resets once the grace window is exceeded | | | | Unit | `src/features/kaizen/services/__tests__/streak.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-017 | Pausing a system hides its actions from Daily Core | | | | Unit | `src/features/kaizen/screens/__tests__/TodayScreen.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-018 | Today renders offline from local SQLite | | | | Unit | `src/features/kaizen/services/__tests__/repository.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-019 | Double-tapping **Done** does not double-log | | | | Unit | `src/features/kaizen/services/__tests__/seedId.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-020 | Focus-mode filter narrows Today to deep-work items | | | | Unit | `src/features/kaizen/services/__tests__/focusMode.test.ts`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-021 | Completion ring reflects the done ratio | | | | Unit | `src/features/kaizen/components/__tests__/CommandCenter.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-022 | `Focus block` section renders the scheduled block | | | | Unit | `src/features/kaizen/screens/__tests__/TodayScreen.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-023 | `Open` action on a linked daily-core row navigates | | | | Unit | `src/features/kaizen/screens/__tests__/TodayScreen.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-024 | `quick-log` app intent completes an action and pushes to the watch | | | | Unit | `src/features/kaizen/services/__tests__/appIntents.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-025 | `snooze` app intent reschedules a known reminder only | | | | Unit | `src/features/kaizen/services/__tests__/appIntents.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-026 | `capture-gtd` app intent adds an inbox item | | | | Unit | `src/features/kaizen/services/__tests__/appIntents.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-TODAY-027 | Legacy demo-seed rows never reappear on Today | | | | Unit | `src/features/kaizen/services/__tests__/purgeDemoSeed.test.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-GUIDE-001 | Guide screen mounts with composer and prompt | | | | Maestro, Unit | `e2e/maestro/kaizen/guide-screen.yaml`, `src/features/kaizen | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-GUIDE-002 | Enabling AI stores the disclosure ack | | | | Maestro, Unit | `e2e/maestro/kaizen/guide-screen.yaml`, `src/features/kaizen | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-GUIDE-003 | Send is gated until the disclosure is acked | | | | Unit | `src/features/kaizen/screens/__tests__/CoachChatScreen.test. | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-GUIDE-004 | Composer is visible and focusable after ack | | | | Maestro | `e2e/maestro/kaizen/guide-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-GUIDE-005 | Typing renders in the composer | | | | Maestro | `e2e/maestro/kaizen/guide-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-GUIDE-006 | Sending a message round-trips through coach chat | | | | Maestro, Unit, API | `e2e/maestro/kaizen/guide-screen.yaml`, `src/features/kaizen | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-GUIDE-007 | Coach tool resolver maps intent to the right tool + route | | | | Unit | `src/features/kaizen/services/__tests__/coachToolResolver.te | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-GUIDE-008 | Approving a coach-proposed memory promotes the row | | | | Maestro | `e2e/maestro/kaizen/guide-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-GUIDE-009 | Coach "start practice" tool result opens the practice session | | | | Maestro | `e2e/maestro/kaizen/practice-session.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-GUIDE-010 | Empty coach thread renders its empty state | | | | Maestro, Unit | `e2e/maestro/kaizen/guide-screen.yaml`, `src/features/kaizen | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-GUIDE-011 | Offline send surfaces an error, never a silent drop | | | | Maestro | `e2e/maestro/kaizen/guide-offline-send.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-GUIDE-012 | Coach returns a user-visible error without entitlement | | | | API, Unit | `src/features/kaizen/api/__tests__/kaizen.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-GUIDE-013 | Context snapshot is attached to each coach request | | | | Unit | `src/features/kaizen/services/__tests__/contextSnapshot.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-GUIDE-014 | Session id is reused across turns | | | | Unit | `e2e/maestro/kaizen/guide-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-GUIDE-015 | Navigating away from a draft sends nothing | | | | Maestro | `e2e/maestro/kaizen/guide-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-GUIDE-016 | Empty/whitespace send is blocked client-side | | | | Unit | `src/features/kaizen/screens/__tests__/CoachChatScreen.test. | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-GUIDE-017 | Long threads scroll to older bubbles | | | | Maestro | `e2e/maestro/kaizen/scroll-all-screens.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-GUIDE-018 | Disclosure-ack header is sent on every coach request | | | | Unit | `src/features/kaizen/api/__tests__/kaizen.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-GUIDE-019 | Coach tool opens the learning-plan route | | | | Unit | `src/features/kaizen/services/__tests__/coachToolResolver.te | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-GUIDE-020 | Coach tool opens the systems route | | | | Unit | `src/features/kaizen/services/__tests__/coachToolResolver.te | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-GUIDE-021 | Send is disabled while a reply is in flight | | | | Unit | `e2e/maestro/kaizen/guide-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-GUIDE-022 | Coach reply arriving after backgrounding is not lost | | | | Maestro | `e2e/maestro/kaizen/guide-background-reply.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-GUIDE-023 | Rejecting a proposed memory leaves no approved row | | | | Unit | `e2e/maestro/kaizen/guide-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-GUIDE-024 | Coach never renders another user's data | | | | API | `e2e/maestro/kaizen/guide-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-GUIDE-025 | Coach chat is brand-gated at the Worker | | | | API | `e2e/maestro/kaizen/guide-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-001 | Systems hub lists enabled systems | | | | Maestro, Unit | `e2e/maestro/kaizen/systems-hub.yaml`, `src/features/kaizen/ | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-002 | Tapping a system row opens its detail | | | | Maestro | `e2e/maestro/kaizen/system-detail.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-003 | Pausing a system from the hub flips its state | | | | Maestro | `e2e/maestro/kaizen/system-detail.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-004 | Re-enabling a paused system restores its actions | | | | Maestro | `e2e/maestro/kaizen/system-detail.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-005 | Configure entry point opens SystemConfig | | | | Maestro | `e2e/maestro/kaizen/system-config.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-006 | Deep-work tool entry from Systems | | | | Maestro | `e2e/maestro/kaizen/deep-work.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-007 | Habit-stacks tool entry from Systems | | | | Maestro | `e2e/maestro/kaizen/habit-stacks.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-008 | Weekly-rotation tool entry from Systems | | | | Maestro | `e2e/maestro/kaizen/weekly-rotation.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-009 | Files & imports entry opens the upload screen | | | | Unit | `src/features/kaizen/screens/__tests__/KaizenFileUploadScree | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-010 | All-systems-paused shows guidance | | | | Unit | `src/features/kaizen/screens/__tests__/SystemsHubScreen.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-011 | Primary system is badged on the hub | | | | Unit | `e2e/maestro/kaizen/systems-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-012 | Systems hub scrolls to its sentinel | | | | Maestro | `e2e/maestro/kaizen/scroll-all-screens.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-020 | SystemDetail mounts with actions and status | | | | Maestro, Unit | `e2e/maestro/kaizen/system-detail.yaml`, `src/features/kaize | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-021 | `Configure tasks` opens SystemConfig for the same system | | | | Maestro | `e2e/maestro/kaizen/system-config.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-022 | `Pause system` flips the label and stops surfacing actions | | | | Maestro, Unit | `e2e/maestro/kaizen/system-detail.yaml`, `src/features/kaize | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-023 | `Enable system` restores the label and the actions | | | | Maestro | `e2e/maestro/kaizen/system-detail.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-024 | Import shortcut opens the file source picker | | | | Unit | `src/features/kaizen/screens/__tests__/KaizenFileUploadScree | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-025 | Tapping a catalog action row opens/logs it | | | | Unit | `src/features/kaizen/screens/__tests__/SystemDetailScreen.te | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-026 | Daily-core toggle on an action persists | | | | Unit | `e2e/maestro/kaizen/systems-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-027 | Reminder policy chips render for an action | | | | Unit | `src/features/kaizen/services/__tests__/reminderPolicy.test. | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-028 | Watch quick-log toggle persists | | | | Unit | `e2e/maestro/kaizen/systems-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-029 | SystemDetail scrolls to its sentinel | | | | Maestro | `e2e/maestro/kaizen/system-detail.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-030 | Unknown `system` param degrades gracefully | | | | Unit | `e2e/maestro/kaizen/systems-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-040 | SystemConfig mounts with catalog toggles | | | | Maestro, Unit | `e2e/maestro/kaizen/system-config.yaml`, `src/features/kaize | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-041 | Enabling a catalog action materialises it | | | | Maestro, Unit | `e2e/maestro/kaizen/system-config.yaml`, `src/features/kaize | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-042 | Disabling a catalog action soft-deletes it | | | | Unit | `src/features/kaizen/screens/__tests__/SystemConfigScreen.te | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-043 | Adding a custom action creates a chip and a row | | | | Maestro, Unit | `e2e/maestro/kaizen/system-config.yaml`, `src/features/kaize | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-044 | Removing a custom action soft-deletes it | | | | Unit | `src/features/kaizen/screens/__tests__/SystemConfigScreen.te | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-045 | `Save system` commits every pending change at once | | | | Maestro | `e2e/maestro/kaizen/system-config.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-046 | Backing out without saving discards edits | | | | Unit | `src/features/kaizen/screens/__tests__/SystemConfigScreen.te | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-047 | Empty custom-action title is rejected | | | | Unit | `src/features/kaizen/screens/__tests__/SystemConfigScreen.te | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-048 | Rhythm picker persists the chosen cadence | | | | Unit | `e2e/maestro/kaizen/systems-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-049 | Time-of-day picker updates the reminder window | | | | Unit | `src/features/kaizen/services/__tests__/reminders.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-050 | Linked-feature picker stores the deep-link target | | | | Unit | `e2e/maestro/kaizen/systems-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-051 | Duplicate custom-action title is deduped or rejected | | | | Unit | `e2e/maestro/kaizen/systems-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-052 | Config scrolls to `Save system` | | | | Maestro | `e2e/maestro/kaizen/system-config.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-060 | DeepWork mounts with topic field and blocks | | | | Maestro, Unit | `e2e/maestro/kaizen/deep-work.yaml`, `src/features/kaizen/sc | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-061 | Focus topic is captured and persisted | | | | Maestro, Unit | `e2e/maestro/kaizen/deep-work.yaml`, `src/features/kaizen/sc | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-062 | Starting a session stamps `started_at` | | | | Maestro | `e2e/maestro/kaizen/deep-work.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-063 | Ending a session stamps `ended_at` and duration | | | | Maestro | `e2e/maestro/kaizen/deep-work.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-064 | `Suggest Focus Mode` toggles the focus filter | | | | Unit | `src/features/kaizen/services/__tests__/focusMode.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-065 | `Add block` inserts a new block row | | | | Maestro | `e2e/maestro/kaizen/deep-work.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-066 | Third block is blocked by the max-2 cap | | | | Unit | `src/features/kaizen/screens/__tests__/DeepWorkScreen.test.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-067 | Removing a block deletes its row | | | | Unit | `e2e/maestro/kaizen/systems-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-068 | Backing out mid-session does not lose the session | | | | Unit | `e2e/maestro/kaizen/systems-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-069 | Deep work works fully offline | | | | Unit | `src/features/kaizen/services/__tests__/sync.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-070 | No blocks shows the add CTA | | | | Unit | `src/features/kaizen/screens/__tests__/DeepWorkScreen.test.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-080 | HabitStacks mounts with the stack list | | | | Maestro, Unit | `e2e/maestro/kaizen/habit-stacks.yaml`, `src/features/kaizen | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-081 | Creating a stack inserts a row | | | | Maestro, Unit | `e2e/maestro/kaizen/habit-stacks.yaml`, `src/features/kaizen | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-082 | Adding a step tags the action `Added` | | | | Maestro | `e2e/maestro/kaizen/habit-stacks.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-083 | Renaming a stack updates the row | | | | Unit | `src/features/kaizen/screens/__tests__/HabitStackScreen.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-084 | Deleting a step removes only that link | | | | Unit | `e2e/maestro/kaizen/systems-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-085 | Deleting a stack removes its steps too | | | | Unit | `e2e/maestro/kaizen/systems-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-086 | Reordering steps persists `sort_order` | | | | Unit | `e2e/maestro/kaizen/systems-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-087 | Reordering stacks persists | | | | Unit | `e2e/maestro/kaizen/systems-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-088 | Linking a stack surfaces it on Today | | | | Unit | `e2e/maestro/kaizen/systems-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-089 | Empty stack name is rejected | | | | Unit | `src/features/kaizen/screens/__tests__/HabitStackScreen.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-090 | Dismissing a stack edit discards it | | | | Unit | `e2e/maestro/kaizen/systems-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-100 | Rotation mounts with all seven weekday fields | | | | Maestro, Unit | `e2e/maestro/kaizen/weekly-rotation.yaml`, `src/features/kai | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-101 | Monday focus saves on blur | | | | Maestro | `e2e/maestro/kaizen/weekly-rotation.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-102 | Tuesday focus saves independently of Monday | | | | Maestro | `e2e/maestro/kaizen/weekly-rotation.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-103 | Wed–Sun each persist their own focus | | | | Unit | `src/features/kaizen/screens/__tests__/WeeklyRotationScreen. | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-104 | Clearing a day stores an empty focus | | | | Unit | `e2e/maestro/kaizen/systems-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-105 | Rotation scrolls to Sunday | | | | Maestro | `e2e/maestro/kaizen/weekly-rotation.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-106 | Blur-save works offline | | | | Unit | `src/features/kaizen/services/__tests__/repository.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-115 | Onboarding renders on a profile that has not completed it | | | | Unit | `src/features/kaizen/screens/__tests__/OnboardingScreen.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-116 | Continue advances one step at a time | | | | Unit | `src/features/kaizen/services/__tests__/setupFlow.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-117 | Selecting systems writes `enabled_systems` | | | | Unit | `src/features/kaizen/services/__tests__/setupFlow.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-118 | Finishing onboarding flips the completion flag | | | | Unit | `src/features/kaizen/services/__tests__/setupFlow.test.ts`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-119 | Maestro dismiss subflow clears onboarding | | | | Maestro | `e2e/maestro/kaizen/subflows/dismiss-kaizen-onboarding-if-ne | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-120 | Re-onboarding from Settings replays the flow | | | | Maestro | `e2e/maestro/kaizen/settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-125 | Upload screen shows its source tiles | | | | Unit | `src/features/kaizen/screens/__tests__/KaizenFileUploadScree | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-126 | Local-file tile opens the document picker | | | | Unit, Maestro | `src/features/kaizen/components/__tests__/DriveFilePicker.te | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-127 | Drive tile opens the drive picker flow | | | | Unit | `src/features/kaizen/components/__tests__/DriveFilePicker.te | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-128 | Resume import populates career fields | | | | Unit, Maestro | `src/features/kaizen/upload/__tests__/importHandlers.test.ts | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-129 | Questions import stages rows for review | | | | Unit, Maestro | `src/features/kaizen/upload/__tests__/importHandlers.test.ts | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-130 | Book PDF upload attaches a file key | | | | Unit, API, Maestro | `src/features/kaizen/api/__tests__/kaizen.test.ts`, `e2e/mae | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-131 | Cancelling the picker persists nothing | | | | Unit | `e2e/maestro/kaizen/systems-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-132 | Unsupported file type is rejected | | | | Unit | `e2e/maestro/kaizen/systems-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-133 | Task catalog covers every shipped system area | | | | Unit | `src/features/kaizen/services/__tests__/taskCatalog.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-134 | Catalog materialisation respects the wake-responsive policy | | | | Unit | `src/features/kaizen/services/__tests__/taskCatalog.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-135 | Materialising the same template twice yields distinct ids | | | | Unit | `src/features/kaizen/services/__tests__/taskCatalog.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-136 | Deterministic seed ids are stable across runs | | | | Unit | `src/features/kaizen/services/__tests__/seedId.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-137 | Upload panel renders inside a host screen | | | | Unit | `src/features/kaizen/screens/__tests__/KaizenFileUploadScree | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-138 | Import into a paused system still persists | | | | Unit | `e2e/maestro/kaizen/systems-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-139 | Upload while offline fails loudly | | | | Maestro | `e2e/maestro/kaizen/books-offline-upload.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYS-140 | Book/AI routes are brand-gated at the Worker | | | | API | `e2e/maestro/kaizen/systems-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-001 | Career hub mounts with its four stat tiles | | | | Maestro, Unit | `e2e/maestro/kaizen/career-hub.yaml`, `src/features/kaizen/s | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-002 | Setup tool row opens CareerSetup | | | | Maestro | `e2e/maestro/kaizen/career-setup.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-003 | Progress row opens CareerProgress | | | | Maestro | `e2e/maestro/kaizen/career-progress.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-004 | Pipeline row opens InterviewPipeline | | | | Maestro | `e2e/maestro/kaizen/interview-pipeline.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-005 | Resume row opens ResumeReview | | | | Maestro | `e2e/maestro/kaizen/resume-review.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-006 | Career analytics aggregates match the raw rows | | | | Unit | `src/features/kaizen/services/__tests__/careerAnalytics.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-007 | Career hub scrolls to its sentinel | | | | Maestro | `e2e/maestro/kaizen/scroll-all-screens.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-020 | Step 1 — Goals and roles renders | | | | Maestro, Unit | `e2e/maestro/kaizen/career-setup.yaml`, `src/features/kaizen | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-021 | Step 2 — Skills renders | | | | Maestro, Unit | `e2e/maestro/kaizen/career-setup.yaml`, `src/features/kaizen | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-022 | Step 3 — Resume renders | | | | Maestro | `e2e/maestro/kaizen/career-setup.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-023 | Step 4 — Plan renders | | | | Unit | `e2e/maestro/kaizen/career-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-024 | Step 5 — Complete renders | | | | Unit | `e2e/maestro/kaizen/career-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-025 | Toggling a goal chip persists the selection | | | | Maestro, Unit | `e2e/maestro/kaizen/career-setup.yaml`, `src/features/kaizen | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-026 | Target roles are parsed and stored | | | | Maestro, Unit | `e2e/maestro/kaizen/career-setup.yaml`, `src/features/kaizen | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-027 | Selecting career skills persists the id list | | | | Unit | `src/features/kaizen/screens/__tests__/CareerSetupScreen.tes | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-028 | `Continue` advances exactly one step | | | | Maestro | `e2e/maestro/kaizen/career-setup.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-029 | `Back` restores the previous step with its selections | | | | Unit | `src/features/kaizen/screens/__tests__/CareerSetupScreen.tes | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-030 | Resume step is reachable from goals in one pass | | | | Maestro | `e2e/maestro/kaizen/career-setup.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-031 | Completing setup marks the career flow done | | | | Unit | `src/features/kaizen/services/__tests__/setupFlow.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-032 | Exiting mid-setup keeps partial progress | | | | Unit | `e2e/maestro/kaizen/career-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-033 | Continuing with zero goals is blocked | | | | Unit | `src/features/kaizen/screens/__tests__/CareerSetupScreen.tes | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-040 | Progress mounts with the 30-day metric cards | | | | Maestro, Unit | `e2e/maestro/kaizen/career-progress.yaml`, `src/features/kai | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-041 | `Reps completed` matches the attempt count | | | | Unit | `src/features/kaizen/services/__tests__/careerAnalytics.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-042 | Pipeline stage breakdown matches the rows | | | | Unit | `src/features/kaizen/services/__tests__/careerAnalytics.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-043 | Progress scrolls to the last metric | | | | Maestro | `e2e/maestro/kaizen/career-progress.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-044 | Zero attempts renders zero states | | | | Unit | `src/features/kaizen/screens/__tests__/CareerProgressScreen. | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-050 | Pipeline mounts with its stages | | | | Maestro, Unit | `e2e/maestro/kaizen/interview-pipeline.yaml`, `src/features/ | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-051 | Adding an opportunity inserts a row in the first stage | | | | Maestro, Unit | `e2e/maestro/kaizen/interview-pipeline.yaml`, `src/features/ | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-052 | Advancing a row updates its stage | | | | Maestro | `e2e/maestro/kaizen/interview-pipeline.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-053 | Deleting an opportunity removes it everywhere | | | | Unit | `src/features/kaizen/screens/__tests__/InterviewPipelineScre | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-054 | Editing notes persists them | | | | Unit | `e2e/maestro/kaizen/career-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-055 | Stage strip scrolls to the last stage | | | | Maestro | `e2e/maestro/kaizen/interview-pipeline.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-056 | Empty company is rejected | | | | Unit | `src/features/kaizen/screens/__tests__/InterviewPipelineScre | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-057 | Dismissing the add form writes nothing | | | | Unit | `e2e/maestro/kaizen/career-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-065 | Resume review mounts with the paste area | | | | Maestro, Unit | `e2e/maestro/kaizen/resume-review.yaml`, `src/features/kaize | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-066 | Pasted resume text is captured and stored | | | | Maestro, Unit | `e2e/maestro/kaizen/resume-review.yaml`, `src/features/kaize | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-067 | `Review resume` returns skills and roles | | | | Maestro, Unit, API | `e2e/maestro/kaizen/resume-review.yaml`, `src/features/kaize | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-068 | Review is blocked without the AI disclosure ack | | | | Unit | `src/features/kaizen/services/__tests__/aiDisclosure.test.ts | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-069 | Accepting suggested skills updates the selection | | | | Unit | `src/features/kaizen/screens/__tests__/ResumeReviewScreen.te | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-070 | Clearing the resume stores an empty summary | | | | Unit | `e2e/maestro/kaizen/career-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-071 | Offline paste saves locally with AI disabled | | | | Unit | `e2e/maestro/kaizen/career-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-072 | Backing out without saving preserves the prior summary | | | | Unit | `src/features/kaizen/screens/__tests__/ResumeReviewScreen.te | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-073 | Resume PDF import fills the paste field | | | | Maestro | `e2e/maestro/kaizen/resume-review.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-074 | Reviewing an empty resume is blocked | | | | Unit | `e2e/maestro/kaizen/career-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-075 | Analyze failure surfaces an error and keeps the text | | | | Unit | `e2e/maestro/kaizen/career-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-076 | Duplicate opportunity titles are allowed but distinct | | | | Unit | `e2e/maestro/kaizen/career-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-077 | Career setup survives an app relaunch mid-flow | | | | Unit | `e2e/maestro/kaizen/career-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-CAREER-078 | Career data is scoped to the signed-in account | | | | Unit | `e2e/maestro/kaizen/career-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-001 | Assess hub mounts with the mastery summary | | | | Maestro, Unit | `e2e/maestro/kaizen/assess-hub.yaml`, `src/features/kaizen/s | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-002 | Banks tool row opens QuestionBanks | | | | Maestro | `e2e/maestro/kaizen/question-banks.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-003 | Import tool row opens QuestionImport | | | | Maestro | `e2e/maestro/kaizen/question-import.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-004 | Practice tool row opens PracticeSession | | | | Maestro | `e2e/maestro/kaizen/practice-session.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-005 | Assessment tool row opens SkillAssessment | | | | Maestro | `e2e/maestro/kaizen/skill-assessment.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-006 | FSRS scheduling produces a monotonic interval | | | | Unit | `src/features/kaizen/services/__tests__/fsrs.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-007 | Assess hub scrolls to its sentinel | | | | Maestro | `e2e/maestro/kaizen/scroll-all-screens.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-020 | Banks mount with categories and approved questions | | | | Maestro, Unit | `e2e/maestro/kaizen/question-banks.yaml`, `src/features/kaiz | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-021 | Selecting a category filters the list | | | | Maestro | `e2e/maestro/kaizen/question-banks.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-022 | Adding a question inserts an approved row | | | | Maestro, Unit | `e2e/maestro/kaizen/question-banks.yaml`, `src/features/kaiz | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-023 | Editing a question updates it in place | | | | Unit | `src/features/kaizen/screens/__tests__/QuestionBanksScreen.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-024 | Deleting a question removes it from practice | | | | Unit | `e2e/maestro/kaizen/assess-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-025 | Approving a pending question activates it | | | | Maestro | `e2e/maestro/kaizen/question-banks.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-026 | Duplicate prompts are deduped on import | | | | Unit | `src/features/kaizen/services/__tests__/questionDedup.test.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-027 | Empty prompt is rejected | | | | Unit | `src/features/kaizen/screens/__tests__/QuestionBanksScreen.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-028 | Banks scroll to the import link | | | | Maestro | `e2e/maestro/kaizen/question-banks.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-035 | Import screen mounts with its paste area | | | | Maestro, Unit | `e2e/maestro/kaizen/question-import.yaml`, `src/features/kai | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-036 | Pasted text renders in the field | | | | Maestro | `e2e/maestro/kaizen/question-import.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-037 | `Import for review` extracts and stages questions | | | | Maestro, Unit, API | `e2e/maestro/kaizen/question-import.yaml`, `src/features/kai | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-038 | Approving the batch moves rows into the bank | | | | Maestro | `e2e/maestro/kaizen/question-import.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-039 | Rejecting a staged row discards it | | | | Unit | `e2e/maestro/kaizen/assess-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-040 | Import is blocked without the AI ack | | | | Unit | `src/features/kaizen/services/__tests__/aiDisclosure.test.ts | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-041 | Empty paste is rejected client-side | | | | Unit | `src/features/kaizen/screens/__tests__/QuestionImportScreen. | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-042 | Leaving without approving commits nothing | | | | Unit | `e2e/maestro/kaizen/assess-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-043 | Document import stages questions from a file | | | | Maestro | `e2e/maestro/kaizen/question-import.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-044 | Extract failure surfaces an error and keeps the paste | | | | Unit | `e2e/maestro/kaizen/assess-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-050 | Practice mounts with a prompt and composer | | | | Maestro, Unit | `e2e/maestro/kaizen/practice-session.yaml`, `src/features/ka | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-051 | Typing an answer renders in the composer | | | | Maestro | `e2e/maestro/kaizen/practice-session.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-052 | Self-scoring writes an attempt row | | | | Maestro, Unit | `e2e/maestro/kaizen/practice-session.yaml`, `src/features/ka | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-053 | `Score with AI` returns an overall score | | | | Unit, API, Maestro | `src/features/kaizen/api/__tests__/kaizen.test.ts`, `e2e/mae | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-054 | Generating an ideal answer renders it | | | | Unit, API | `src/features/kaizen/api/__tests__/kaizen.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-055 | `Next` advances to a different question | | | | Unit | `src/features/kaizen/screens/__tests__/PracticeSessionScreen | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-056 | No approved questions shows the empty state | | | | Maestro | `e2e/maestro/kaizen/practice-session.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-057 | Leaving mid-answer does not create a half attempt | | | | Unit | `e2e/maestro/kaizen/assess-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-058 | Submitting an empty answer is blocked | | | | Unit | `e2e/maestro/kaizen/assess-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-059 | AI scoring failure keeps the self-score path usable | | | | Unit | `e2e/maestro/kaizen/assess-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-065 | Assessment shell mounts | | | | Maestro, Unit | `e2e/maestro/kaizen/skill-assessment.yaml`, `src/features/ka | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-066 | `Start assessment` shows the first question | | | | Maestro | `e2e/maestro/kaizen/skill-assessment.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-067 | Assessment question generation returns a prompt | | | | Unit, API | `src/features/kaizen/api/__tests__/kaizen.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-068 | Submitting an assessment answer logs an attempt | | | | Unit | `src/features/kaizen/services/__tests__/skillAssessment.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-069 | AI evaluation returns a score and reasoning | | | | Unit, API | `src/features/kaizen/services/__tests__/skillAssessment.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-070 | Completing the assessment routes to the learning plan | | | | Unit | `src/features/kaizen/screens/__tests__/SkillAssessmentScreen | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-071 | Evaluation is blocked without the AI ack | | | | Unit | `src/features/kaizen/services/__tests__/aiDisclosure.test.ts | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-072 | Abandoning an assessment leaves no partial score | | | | Unit | `e2e/maestro/kaizen/assess-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-073 | Question generation failure shows an error | | | | Unit | `e2e/maestro/kaizen/assess-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-080 | Skill detail mounts for a valid skill id | | | | Unit | `src/features/kaizen/screens/__tests__/SkillDetailScreen.tes | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-081 | Missing skill id shows the chooser copy | | | | Maestro, Unit | `e2e/maestro/kaizen/skill-detail.yaml`, `src/features/kaizen | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-082 | Learning-plan link opens the plan for this skill | | | | Unit | `src/features/kaizen/screens/__tests__/SkillDetailScreen.tes | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-083 | Logging progress writes a progress row | | | | Unit | `e2e/maestro/kaizen/assess-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-084 | Skill detail scrolls to its history | | | | Maestro | `e2e/maestro/kaizen/skill-detail.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-090 | Attempt history lists attempts newest first | | | | Unit | `src/features/kaizen/screens/__tests__/AttemptHistoryScreen. | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-091 | Missing skill id shows the empty state | | | | Maestro, Unit | `e2e/maestro/kaizen/attempt-history.yaml`, `src/features/kai | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-092 | Expanding an attempt shows the answer and score | | | | Unit | `e2e/maestro/kaizen/assess-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-093 | Attempt history scrolls to the oldest attempt | | | | Maestro | `e2e/maestro/kaizen/attempt-history.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-094 | Selectors exclude soft-deleted rows everywhere | | | | Unit | `src/features/kaizen/stores/__tests__/kaizenSelectors.test.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-095 | Mastery summary matches the progress logs | | | | Unit | `e2e/maestro/kaizen/assess-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-096 | Due-question count matches the FSRS schedule | | | | Unit | `e2e/maestro/kaizen/assess-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-097 | Practice works fully offline | | | | Unit | `e2e/maestro/kaizen/assess-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-098 | Assess data is scoped to the signed-in account | | | | Unit | `e2e/maestro/kaizen/assess-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ASSESS-099 | Bulk-approving 50 imported questions stays responsive | | | | Unit | `e2e/maestro/kaizen/assess-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-001 | Learn hub mounts with the capture card | | | | Maestro, Unit | `e2e/maestro/kaizen/learn-hub.yaml`, `src/features/kaizen/sc | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-002 | Quick capture creates a knowledge item | | | | Unit | `src/features/kaizen/screens/__tests__/LearnScreen.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-003 | Assigning a PARA bucket persists the category | | | | Unit | `src/features/kaizen/screens/__tests__/LearnScreen.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-004 | GTD capture creates an inbox item | | | | Unit | `src/features/kaizen/screens/__tests__/LearnScreen.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-005 | Learning-plan tool row opens the plan | | | | Maestro | `e2e/maestro/kaizen/learning-plan.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-006 | Reviews tool row opens Reviews | | | | Maestro | `e2e/maestro/kaizen/reviews.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-007 | Books tool row opens the library | | | | Maestro | `e2e/maestro/kaizen/books.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-008 | Insights tool row opens Insights | | | | Maestro | `e2e/maestro/kaizen/insights.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-009 | Learn hub scrolls to its sentinel | | | | Maestro | `e2e/maestro/kaizen/scroll-all-screens.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-010 | Empty capture list shows guidance | | | | Unit | `src/features/kaizen/screens/__tests__/LearnScreen.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-020 | Plan mounts with its three sections | | | | Maestro, Unit | `e2e/maestro/kaizen/learning-plan.yaml`, `src/features/kaize | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-021 | `Back to skill` returns to the same skill | | | | Maestro | `e2e/maestro/kaizen/learning-plan.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-022 | AI plan build returns populated sections | | | | Unit, API | `src/features/kaizen/services/__tests__/learningPlan.test.ts | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-023 | Missing skill id degrades gracefully | | | | Unit | `src/features/kaizen/screens/__tests__/LearningPlanScreen.te | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-024 | Expanding a plan section reveals its steps | | | | Unit | `src/features/kaizen/screens/__tests__/LearningPlanScreen.te | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-025 | Plan scrolls to `Back to skill` | | | | Maestro | `e2e/maestro/kaizen/learning-plan.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-030 | Reviews mounts with three reflection fields | | | | Maestro, Unit | `e2e/maestro/kaizen/reviews.yaml`, `src/features/kaizen/scre | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-031 | All three fields accept text | | | | Maestro | `e2e/maestro/kaizen/reviews.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-032 | `Save review` persists the week's row | | | | Maestro, Unit | `e2e/maestro/kaizen/reviews.yaml`, `src/features/kaizen/scre | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-033 | Re-saving the same week updates, not duplicates | | | | Unit | `src/features/kaizen/screens/__tests__/ReviewsScreen.test.ts | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-034 | Leaving without saving discards the edit | | | | Unit | `src/features/kaizen/screens/__tests__/ReviewsScreen.test.ts | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-035 | Saving with every field blank is blocked | | | | Unit | `e2e/maestro/kaizen/learn-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-040 | Books mounts with the library | | | | Maestro, Unit | `e2e/maestro/kaizen/books.yaml`, `src/features/kaizen/screen | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-041 | `Add a book` reveals the new-book form | | | | Maestro | `e2e/maestro/kaizen/books.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-042 | Book title field accepts text | | | | Maestro | `e2e/maestro/kaizen/books.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-043 | Language pill sets the book language | | | | Maestro | `e2e/maestro/kaizen/books.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-044 | Saving creates a library row | | | | Maestro, Unit | `e2e/maestro/kaizen/books.yaml`, `src/features/kaizen/screen | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-045 | Editing metadata updates the same row | | | | Unit | `src/features/kaizen/stores/__tests__/kaizenStore.books.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-046 | Deleting a book hides it and its children | | | | Unit | `src/features/kaizen/stores/__tests__/kaizenStore.books.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-047 | Tapping a book opens its detail | | | | Maestro | `e2e/maestro/kaizen/book-detail.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-048 | Books scrolls to the add form | | | | Maestro | `e2e/maestro/kaizen/books.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-049 | Empty title is rejected | | | | Unit | `src/features/kaizen/screens/__tests__/BooksScreen.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-050 | `Cancel` collapses the form without writing | | | | Maestro | `e2e/maestro/kaizen/books.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-055 | Book detail mounts for a valid id | | | | Unit | `src/features/kaizen/screens/__tests__/BookDetailScreen.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-056 | Missing/deleted book shows the unavailable state | | | | Maestro, Unit | `e2e/maestro/kaizen/book-detail.yaml`, `src/features/kaizen/ | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-057 | Read action opens the reader on this book | | | | Maestro | `e2e/maestro/kaizen/book-reader.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-058 | Quiz action opens the comprehension check | | | | Maestro | `e2e/maestro/kaizen/book-quiz.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-059 | Uploading a PDF attaches a file key | | | | Unit, API | `src/features/kaizen/api/__tests__/kaizen.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-060 | Extracting the TOC creates chapter rows | | | | Unit, API | `src/features/kaizen/api/__tests__/kaizen.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-065 | Reader mounts with chapter text | | | | Unit | `src/features/kaizen/screens/__tests__/BookReaderScreen.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-066 | Missing chapter shows the unavailable state | | | | Maestro, Unit | `e2e/maestro/kaizen/book-reader.yaml`, `src/features/kaizen/ | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-067 | On-demand chapter extraction returns text | | | | Unit, API | `src/features/kaizen/api/__tests__/kaizen.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-068 | Re-opening a chapter uses the cache | | | | Unit, API | `src/features/kaizen/api/__tests__/kaizen.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-069 | Highlighting text saves a highlight row | | | | Unit | `src/features/kaizen/stores/__tests__/kaizenStore.books-phas | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-070 | Reader scrolls to the chapter end | | | | Maestro | `e2e/maestro/kaizen/book-reader.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-075 | Quiz mounts with the question shell | | | | Unit | `src/features/kaizen/screens/__tests__/BookQuizScreen.test.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-076 | No questions shows the generate prompt | | | | Maestro, Unit | `e2e/maestro/kaizen/book-quiz.yaml`, `src/features/kaizen/sc | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-077 | Generating questions populates the quiz | | | | Unit, API | `src/features/kaizen/api/__tests__/kaizen.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-078 | Selecting an MCQ option highlights it | | | | Unit | `src/features/kaizen/screens/__tests__/BookQuizScreen.test.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-079 | Grading an open answer returns a result | | | | `POST 200` | Unit, API | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-080 | Grading a spoken answer returns transcription | | | | `POST 200` | Unit, API | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-081 | Completing a quiz writes an attempt row | | | | Unit | `src/features/kaizen/stores/__tests__/kaizenStore.books-phas | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-082 | Quiz scrolls to submit | | | | Maestro | `e2e/maestro/kaizen/book-quiz.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-090 | Insights mounts with all panels | | | | Maestro, Unit | `e2e/maestro/kaizen/insights.yaml`, `src/features/kaizen/scr | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-091 | Streak panel matches the streak service | | | | Unit | `src/features/kaizen/screens/__tests__/InsightsScreen.test.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-092 | Practice panel matches the attempt count | | | | Unit | `src/features/kaizen/screens/__tests__/InsightsScreen.test.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-093 | Insights scrolls to the last panel | | | | Maestro | `e2e/maestro/kaizen/insights.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-094 | Fresh account shows zero panels, not a crash | | | | Unit | `src/features/kaizen/screens/__tests__/InsightsScreen.test.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-095 | Book chapters render in index order | | | | Unit | `src/features/kaizen/stores/__tests__/kaizenSelectors.test.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-096 | Highlights and questions are scoped to the active chapter | | | | Unit | `src/features/kaizen/stores/__tests__/kaizenSelectors.test.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-097 | Learn capture works offline | | | | Unit | `e2e/maestro/kaizen/learn-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-098 | Deleting a captured item removes it from the list | | | | Unit | `e2e/maestro/kaizen/learn-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-099 | Book AI failure leaves the book usable | | | | Unit | `e2e/maestro/kaizen/learn-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-LEARN-100 | A 60-chapter book stays navigable | | | | Unit | `e2e/maestro/kaizen/learn-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-MEM-001 | Memory settings mount from Settings | | | | Maestro, Unit | `e2e/maestro/kaizen/memory.yaml`, `src/features/kaizen/scree | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-MEM-002 | Approving a memory flips its state | | | | Maestro, Unit | `e2e/maestro/kaizen/memory.yaml`, `src/features/kaizen/scree | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-MEM-003 | Archiving a memory removes it from coach context | | | | Unit | `src/features/kaizen/screens/__tests__/MemorySettingsScreen. | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-MEM-004 | Rejecting a pending memory discards it | | | | Unit | `src/features/kaizen/screens/__tests__/MemorySettingsScreen. | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-MEM-005 | Empty memory inbox shows guidance | | | | Maestro | `e2e/maestro/kaizen/memory.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-MEM-006 | Memory list scrolls to the last row | | | | Maestro | `e2e/maestro/kaizen/memory.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-MEM-007 | A coach-approved memory shows as approved in Settings | | | | Maestro | `e2e/maestro/kaizen/guide-screen.yaml`, `e2e/maestro/kaizen/ | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-MEM-008 | Memory changes are pushed on the next sync | | | | Unit | `src/features/kaizen/services/__tests__/sync.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-MEM-009 | Archived memories are excluded from the context snapshot | | | | Unit | `src/features/kaizen/services/__tests__/contextSnapshot.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-MEM-010 | Approving twice does not duplicate the row | | | | Unit | `src/features/kaizen/screens/__tests__/MemorySettingsScreen. | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-MEM-011 | Memory is scoped to the signed-in account | | | | Unit | `src/features/kaizen/screens/__tests__/MemorySettingsScreen. | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-PROF-001 | Profile mounts from More | | | | Maestro, Unit | `e2e/maestro/kaizen/more-hub.yaml`, `e2e/maestro/kaizen/prof | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-PROF-002 | Tapping the display name enters edit mode | | | | Maestro, Unit | `e2e/maestro/kaizen/profile.yaml`, `src/features/kaizen/scre | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-PROF-003 | `Save` persists the new display name | | | | Maestro | `e2e/maestro/kaizen/profile.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-PROF-004 | `Cancel` restores the prior name | | | | Maestro, Unit | `e2e/maestro/kaizen/profile.yaml`, `src/features/kaizen/scre | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-PROF-005 | Avatar change is not wired yet | | | | Unit | `src/features/kaizen/hooks/__tests__/useAvatarPicker.test.ts | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-PROF-006 | Logout clears the session | | | | Maestro | `e2e/maestro/kaizen/subflows/logout-if-needed.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-PROF-007 | Profile scrolls to the logout region | | | | Maestro | `e2e/maestro/kaizen/profile.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-PROF-008 | Empty display name is rejected | | | | Unit | `src/features/kaizen/screens/__tests__/ProfileScreen.test.ts | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-PROF-009 | Avatar falls back to initials | | | | Unit | `src/features/kaizen/components/__tests__/Avatar.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-PROF-010 | `Enabled systems` reflects the profile | | | | Unit | `src/features/kaizen/screens/__tests__/ProfileScreen.test.ts | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-PROF-011 | `Member since` renders a formatted date | | | | Unit | `src/features/kaizen/screens/__tests__/ProfileScreen.test.ts | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-PROF-012 | Kaizen user API re-exports the ecosystem methods unchanged | | | | Unit | `src/features/kaizen/api/__tests__/userApi.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-PROF-013 | Display-name save failure surfaces an error | | | | Unit | `src/features/kaizen/screens/__tests__/ProfileScreen.test.ts | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-PROF-014 | Profile never renders another account's data | | | | Unit | `src/features/kaizen/screens/__tests__/ProfileScreen.test.ts | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-AUTH-001 | Login screen renders the Kaizen brand and controls | | | | Maestro | `e2e/maestro/kaizen/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-AUTH-002 | Email field accepts input | | | | Maestro | `e2e/maestro/kaizen/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-AUTH-003 | Password field masks input | | | | Maestro | `e2e/maestro/kaizen/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-AUTH-004 | Valid credentials establish a session | | | | Maestro | `e2e/maestro/kaizen/subflows/kaizen-login-if-needed.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-AUTH-005 | Biometric row renders in Settings | | | | Maestro | `e2e/maestro/kaizen/biometric-settings-row.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-AUTH-006 | Enabling biometrics stores the preference | | | | Maestro | `e2e/maestro/kaizen/biometric-settings-row.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-AUTH-007 | Remembered login enables biometric sign-in | | | | Maestro | `e2e/maestro/kaizen/biometric-remember-last-login.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-AUTH-008 | E2E autologin deep link signs in | | | | Maestro | `e2e/maestro/kaizen/subflows/kaizen-login-if-needed.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-AUTH-009 | Biometric OS prompt is dismissed defensively | | | | Maestro | `e2e/maestro/kaizen/subflows/dismiss-biometric-prompt-if-nee | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-AUTH-010 | Wrong password shows an error and no session | | | | Unit | `e2e/maestro/kaizen/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-AUTH-011 | Logout requires re-authentication | | | | Maestro | `e2e/maestro/kaizen/subflows/logout-if-needed.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-AUTH-012 | Empty credentials are rejected client-side | | | | none — no login POST and no token persistence | no login POST | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-AUTH-013 | Malformed email is rejected before the request | | | | Unit | `e2e/maestro/kaizen/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-AUTH-014 | Sign-in offline shows a network error | | | | Unit | `e2e/maestro/kaizen/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-AUTH-015 | `Sign Up` is present but registration is disabled | | | | Maestro | `e2e/maestro/kaizen/auth-sign-up-disabled.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-AUTH-016 | Failed-login modal is dismissible and recoverable | | | | Maestro | `e2e/maestro/kaizen/subflows/kaizen-login-if-needed.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-AUTH-017 | Disabling biometrics removes the biometric button | | | | Maestro | `e2e/maestro/kaizen/auth-biometric-disable.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SETT-001 | Settings mounts with all sections | | | | Maestro, Unit | `e2e/maestro/kaizen/settings.yaml`, `src/features/kaizen/scr | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SETT-002 | `Sync Kaizen` pushes and pulls | | | | Maestro, Unit | `e2e/maestro/kaizen/settings.yaml`, `src/features/kaizen/ser | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SETT-003 | `Manage memory` opens the memory screen | | | | Maestro | `e2e/maestro/kaizen/settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SETT-004 | Biometric row reflects the stored preference | | | | Maestro | `e2e/maestro/kaizen/biometric-settings-row.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SETT-005 | `AI disclosure` toggle writes the ack | | | | Unit | `src/features/kaizen/services/__tests__/aiDisclosure.test.ts | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SETT-006 | Notifications row opens the notifications screen | | | | Maestro | `e2e/maestro/kaizen/notifications.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SETT-007 | `Onboarding` re-run replays the flow | | | | Maestro | `e2e/maestro/kaizen/settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SETT-008 | Logout from Settings ends the session | | | | Maestro | `e2e/maestro/kaizen/settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SETT-009 | Offline mutations are queued and pushed on reconnect | | | | Unit | `src/features/kaizen/services/__tests__/sync.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SETT-010 | Concurrent edits resolve by the documented merge rule | | | | Unit | `src/features/kaizen/services/__tests__/sync.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SETT-011 | Settings scrolls to the logout row | | | | Maestro | `e2e/maestro/kaizen/settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SETT-012 | Cancelling the logout confirm keeps the session | | | | Unit | `src/features/kaizen/screens/__tests__/SettingsScreen.test.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SETT-013 | Appearance pills switch theme mode | | | | Unit | `src/features/kaizen/components/__tests__/ThemeModeControl.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SETT-014 | Kaizen colours resolve per theme | | | | Unit | `src/features/kaizen/theme/__tests__/appColors.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SETT-015 | `Timezone` row shows the device timezone | | | | Unit | `src/features/kaizen/screens/__tests__/SettingsScreen.test.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SETT-016 | `Enabled systems` row matches the profile | | | | Unit | `src/features/kaizen/screens/__tests__/SettingsScreen.test.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SETT-017 | `Enable notifications` from Settings requests permission | | | | Maestro | `e2e/maestro/kaizen/notifications.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SETT-018 | Sync failure shows `Failed`, not `Complete` | | | | Unit | `src/features/kaizen/screens/__tests__/SettingsScreen.test.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SETT-019 | Storage facade round-trips preferences | | | | Unit | `src/features/kaizen/services/__tests__/storage.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SETT-020 | Settings changes survive a relaunch | | | | Unit | `src/features/kaizen/screens/__tests__/SettingsScreen.test.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-NOTIF-001 | Notifications screen mounts | | | | Maestro, Unit | `e2e/maestro/kaizen/notifications.yaml`, `src/features/kaize | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-NOTIF-002 | `Enable notifications` registers a push token | | | | Maestro, Unit | `e2e/maestro/kaizen/notifications.yaml`, `src/features/kaize | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-NOTIF-003 | Tapping an unread row marks it read | | | | Unit | `src/features/kaizen/services/__tests__/notificationInbox.te | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-NOTIF-004 | Clear-all empties the inbox | | | | Unit | `src/features/kaizen/services/__tests__/notificationInbox.te | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-NOTIF-005 | Empty inbox shows guidance | | | | Unit | `src/features/kaizen/screens/__tests__/NotificationsScreen.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-NOTIF-006 | Inbox scrolls to the oldest entry | | | | Maestro | `e2e/maestro/kaizen/notifications.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-NOTIF-007 | A fired reminder creates an inbox row | | | | Unit | `src/features/kaizen/services/__tests__/reminders.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-NOTIF-008 | Denying permission degrades gracefully | | | | Maestro | `e2e/maestro/kaizen/notifications.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-NOTIF-009 | `Refresh registration` re-registers the token | | | | Maestro, Unit | `e2e/maestro/kaizen/notifications.yaml`, `src/features/kaize | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-NOTIF-010 | Store initialisation attaches the listener and loads the inbox | | | | Unit | `src/features/kaizen/stores/__tests__/notificationStore.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-NOTIF-011 | Notifications are Kaizen-branded only | | | | Unit | `src/features/kaizen/screens/__tests__/NotificationsScreen.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-NOTIF-012 | Tapping a notification routes by `data.type` | | | | Unit | `src/features/kaizen/services/__tests__/deepLinks.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-NOTIF-013 | Reminder policy respects focus mode | | | | Unit | `src/features/kaizen/services/__tests__/reminderPolicy.test. | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-NOTIF-014 | Registration failure does not leave a stuck flag | | | | Unit | `src/features/kaizen/stores/__tests__/notificationStore.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYNC-001 | Store mutations write through to SQLite | | | | Unit | `src/features/kaizen/stores/__tests__/kaizenStore.test.ts`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYNC-002 | Repository honours the read/write contract | | | | Unit | `src/features/kaizen/services/__tests__/repository.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYNC-003 | Sync push includes every dirty row | | | | Unit, API | `src/features/kaizen/services/__tests__/sync.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYNC-004 | Sync pull merges server changes | | | | Unit | `src/features/kaizen/services/__tests__/sync.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYNC-005 | MMKV round-trips Kaizen preferences | | | | Unit | `src/features/kaizen/__tests__/kaizenLocalStorage.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYNC-006 | Schema migrations apply on launch | | | | Unit | `src/features/kaizen/services/__tests__/database.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYNC-007 | First run seeds only the default rows | | | | Unit | `src/features/kaizen/services/__tests__/defaultSeed.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYNC-008 | Every table in `KAIZEN_TABLES` is exported | | | | Unit | `src/features/kaizen/services/__tests__/repository.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYNC-009 | Offline writes are never lost | | | | Unit | `src/features/kaizen/services/__tests__/repository.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYNC-010 | Sync client sends and parses the documented shape | | | | Unit, API | `src/features/kaizen/api/__tests__/kaizen.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYNC-011 | Soft deletes propagate as tombstones | | | | Unit | `src/features/kaizen/services/__tests__/sync.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYNC-012 | Sync 500 keeps local data and retries later | | | | Unit | `e2e/maestro/kaizen/systems-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYNC-013 | Feature flags gate the UI | | | | Unit | `src/features/kaizen/services/__tests__/featureFlags.test.ts | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYNC-014 | Deep links route to the right Kaizen screen | | | | Unit | `e2e/maestro/kaizen/deep-links-smoke.yaml`, `src/features/ka | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYNC-015 | Watch companion receives updates | | | | Unit | `src/features/kaizen/services/__tests__/watchSync.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYNC-016 | Sync is brand-gated at the Worker | | | | API | `e2e/maestro/kaizen/systems-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYNC-017 | Sync never returns another account's rows | | | | API | `e2e/maestro/kaizen/systems-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYNC-018 | Interrupted sync leaves a consistent local DB | | | | Unit | `e2e/maestro/kaizen/systems-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYNC-019 | A large dirty backlog syncs without truncation | | | | Unit | `e2e/maestro/kaizen/systems-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYNC-020 | Logout clears or isolates local Kaizen data | | | | Unit | `e2e/maestro/kaizen/systems-hub.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYNC-021 | `kaizen_meta` guards one-time migrations | | | | Unit | `src/features/kaizen/services/__tests__/purgeDemoSeed.test.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYNC-022 | Fake-SQLite harness matches the real contract | | | | Unit | `src/features/kaizen/services/__tests__/helpers/fakeSqlite.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-SYNC-023 | Deleting the app removes all local Kaizen data | | | | Maestro | `e2e/maestro/kaizen/sync-hard-reset.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ONB-001 | First launch shows Kaizen's own onboarding | | | | Unit | `src/features/kaizen/screens/__tests__/OnboardingScreen.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ONB-002 | Welcome dismiss subflow is idempotent | | | | Maestro | `e2e/maestro/kaizen/subflows/dismiss-welcome-if-needed.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ONB-003 | Kaizen onboarding dismiss subflow reaches Today | | | | Maestro | `e2e/maestro/kaizen/subflows/dismiss-kaizen-onboarding-if-ne | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ONB-004 | `kaizen://e2e-setup` seeds the fixture profile | | | | Maestro | `e2e/maestro/kaizen/subflows/kaizen-setup-if-needed.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ONB-005 | Required onboarding steps cannot be skipped | | | | Unit | `src/features/kaizen/services/__tests__/setupFlow.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ONB-006 | Finishing sets `onboarding_complete` | | | | Unit | `src/features/kaizen/services/__tests__/setupFlow.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ONB-007 | Launch subflow foregrounds a logged-in Kaizen | | | | Maestro | `e2e/maestro/kaizen/subflows/launch-kaizen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ONB-008 | Route subflow opens an arbitrary Kaizen deep link | | | | Maestro | `e2e/maestro/kaizen/subflows/open-kaizen-route.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ONB-009 | Return-to-today subflow restores the baseline | | | | Maestro | `e2e/maestro/kaizen/subflows/return-to-today.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ONB-010 | Tab-navigation subflows select the right tab | | | | Maestro | `e2e/maestro/kaizen/subflows/go-today.yaml`, `e2e/maestro/ka | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ONB-011 | Biometric-enable subflow handles both states | | | | Maestro | `e2e/maestro/kaizen/subflows/enable-biometric-if-needed.yaml | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ONB-012 | `go-guide` subflow selects the Guide tab | | | | Maestro | `e2e/maestro/kaizen/subflows/go-guide.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ONB-013 | Login subflow is idempotent | | | | Maestro | `e2e/maestro/kaizen/subflows/kaizen-login-if-needed.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ONB-014 | Logout subflow leaves the app on the auth screen | | | | Maestro | `e2e/maestro/kaizen/subflows/logout-if-needed.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| KAIZEN-ONB-015 | Onboarding survives an interrupted first launch | | | | Unit | `src/features/kaizen/screens/__tests__/OnboardingScreen.test | ☐ | ☐ | ☑ | Suite not run or log missing |
