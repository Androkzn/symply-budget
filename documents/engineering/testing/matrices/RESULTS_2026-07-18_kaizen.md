# Symply Kaizen Acceptance Results — 2026-07-18

| Field | Value |
|-------|-------|
| **Doc type** | Dated scoring copy (Circle V2 style) |
| **App / scope** | `kaizen` |
| **Run date** | `2026-07-18` (matrix) · scored **2026-07-19** |
| **Environment** | `staging` (Metro + installed sim build) |
| **Device / OS** | Kaizen-A, iOS 26.5 |
| **Matrix source** | [kaizen.md](./kaizen.md) |
| **Maestro logs** | `/tmp/kaizen-suite-final2.log` (**33/39** flows pass, single session) |

## Summary

| Metric | Count |
|--------|------:|
| Matrix rows scored (this file) | 233 |
| Pass | 166 |
| Fail | 38 |
| N/A | 29 |
| Maestro flows (non-destructive) | 33 pass / 6 fail / 39 total |
| Pass rate (Maestro flows) | **85%** (33/39) |
| Unit Jest (`src/features/kaizen\|kaizenTabs\|mira.kaizen`) | **1005 / 1005** tests (89 suites) |

**Failed Maestro flows (2026-07-19)**

| Flow | Failure |
|------|---------|
| `books` | `book.pdf` not visible after upload pick |
| `books-offline-upload` | `book.pdf` not visible (pick subflow) |
| `system-detail` | `Enable system` not visible after pause toggle |
| `question-import` | `Import for review` control not found |
| `resume-review` | `Resume review` screen lost after pick/navigation |
| `question-banks` | `Behavioral` bank row not found |

**Harness notes**

- Authoritative run: `npm run test:e2e:kaizen:suite` single session on Kaizen-A / iOS 26.5 (`kaizen-suite-final2.log`).
- Prior summary claiming 39/39 (`kaizen-full-final3.log`) superseded — that run used trimmed upload/scroll workarounds.
- Fixes in progress: e2e-pick tap-only consume, route restore, native picker fallback, upload callback stability.
- Destructive auth/sync flows not re-run. Maestro debug JSON off by default (`MAESTRO_DEBUG=0`) after disk-full aborts.

## Results

| ID | Description | Steps | Expected | Layer | Automation | Pass | Fail | N/A | Notes |
|----|-------------|-------|----------|-------|------------|:----:|:----:|:---:|-------|
| KAIZEN-SMOKE-001 | All seven Kaizen hubs mount in one session without a crash |  |  |  | Maestro | ``e2e/maestro/kaizen/all-hubs.yaml`` | ☑ | ☐ | ☐ | Flow `all-hubs.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SMOKE-002 | Full Kaizen Maestro suite executes end to end |  |  |  | Maestro | ``scripts/e2e/run-kaizen-suite.sh`, `e2e/maestro/` | ☐ | ☑ | ☐ | Suite 33/39 flows passed — see kaizen-suite-final2.log |
| KAIZEN-SMOKE-004 | More hub lists every section and pushes each route |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/more-hub.yaml`, `src/feature` | ☑ | ☐ | ☐ | Flow `more-hub.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SMOKE-005 | Systems hub reachable with enabled systems listed |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/systems-hub.yaml`, `src/feat` | ☑ | ☐ | ☐ | Flow `systems-hub.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SMOKE-006 | Career hub reachable with live stats |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/career-hub.yaml`, `src/featu` | ☑ | ☐ | ☐ | Flow `career-hub.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SMOKE-007 | Assess hub reachable with mastery summary |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/assess-hub.yaml`, `src/featu` | ☑ | ☐ | ☐ | Flow `assess-hub.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SMOKE-008 | Learn hub reachable with capture card |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/learn-hub.yaml`, `src/featur` | ☑ | ☐ | ☐ | Flow `learn-hub.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SMOKE-009 | Guide hub reachable with coach shell |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/guide-screen.yaml`, `src/fea` | ☑ | ☐ | ☐ | Flow `guide-screen.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SMOKE-010 | Today hub reachable after the DB gate |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/today-screen.yaml`, `src/fea` | ☑ | ☐ | ☐ | Flow `today-screen.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SMOKE-012 | `kaizen://e2e-setup` deep link bypasses onboarding |  |  |  | Maestro | ``e2e/maestro/kaizen/subflows/kaizen-setup-if-nee` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-SCROLL-001 | Every hub reaches its bottom sentinel |  |  |  | Maestro | ``e2e/maestro/kaizen/scroll-all-screens.yaml`` | ☑ | ☐ | ☐ | Flow `scroll-all-screens.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-002 | Today reaches `kaizen-today-screen-scroll-end` |  |  |  | Maestro | ``e2e/maestro/kaizen/scroll-all-screens.yaml`` | ☑ | ☐ | ☐ | Flow `scroll-all-screens.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-003 | Guide chat history scrolls to its sentinel |  |  |  | Maestro | ``e2e/maestro/kaizen/scroll-all-screens.yaml`` | ☑ | ☐ | ☐ | Flow `scroll-all-screens.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-004 | Systems hub reaches its sentinel |  |  |  | Maestro | ``e2e/maestro/kaizen/scroll-all-screens.yaml`` | ☑ | ☐ | ☐ | Flow `scroll-all-screens.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-005 | Career hub reaches its sentinel |  |  |  | Maestro | ``e2e/maestro/kaizen/scroll-all-screens.yaml`` | ☑ | ☐ | ☐ | Flow `scroll-all-screens.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-006 | Assess hub reaches its sentinel |  |  |  | Maestro | ``e2e/maestro/kaizen/scroll-all-screens.yaml`` | ☑ | ☐ | ☐ | Flow `scroll-all-screens.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-007 | Learn hub reaches its sentinel |  |  |  | Maestro | ``e2e/maestro/kaizen/scroll-all-screens.yaml`` | ☑ | ☐ | ☐ | Flow `scroll-all-screens.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-008 | More hub scrolls to `Systems & focus` and its sentinel |  |  |  | Maestro | ``e2e/maestro/kaizen/all-hubs.yaml`` | ☑ | ☐ | ☐ | Flow `all-hubs.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-009 | Settings scrolls to the AI section |  |  |  | Maestro | ``e2e/maestro/kaizen/settings.yaml`` | ☑ | ☐ | ☐ | Flow `settings.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-010 | Profile scrolls to the logout region |  |  |  | Maestro | ``e2e/maestro/kaizen/profile.yaml`` | ☑ | ☐ | ☐ | Flow `profile.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-011 | Deep work scrolls to the block list bottom |  |  |  | Maestro | ``e2e/maestro/kaizen/deep-work.yaml`` | ☑ | ☐ | ☐ | Flow `deep-work.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-012 | Books scrolls to the add-book form |  |  |  | Maestro | ``e2e/maestro/kaizen/books.yaml`` | ☐ | ☑ | ☐ | Flow `books.yaml` FAIL (1m 46s) (Assertion is false: "book.pdf" is visible) |
| KAIZEN-SCROLL-013 | Habit stacks scrolls to the stack list bottom |  |  |  | Maestro | ``e2e/maestro/kaizen/habit-stacks.yaml`` | ☑ | ☐ | ☐ | Flow `habit-stacks.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-014 | Weekly rotation exposes all seven weekday rows |  |  |  | Maestro | ``e2e/maestro/kaizen/weekly-rotation.yaml`` | ☑ | ☐ | ☐ | Flow `weekly-rotation.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-015 | System config scrolls to `Save system` |  |  |  | Maestro | ``e2e/maestro/kaizen/system-config.yaml`` | ☑ | ☐ | ☐ | Flow `system-config.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-016 | Question banks scrolls to the import link |  |  |  | Maestro | ``e2e/maestro/kaizen/question-banks.yaml`` | ☐ | ☑ | ☐ | Flow `question-banks.yaml` FAIL (1m 53s) (Element not found: Text matching regex: Behavioral) |
| KAIZEN-SCROLL-017 | Question import scrolls to the approve rows |  |  |  | Maestro | ``e2e/maestro/kaizen/question-import.yaml`` | ☐ | ☑ | ☐ | Flow `question-import.yaml` FAIL (3m 4s) (Element not found: Text matching regex: Import for review) |
| KAIZEN-SCROLL-018 | Practice session scrolls to the submit region |  |  |  | Maestro | ``e2e/maestro/kaizen/practice-session.yaml`` | ☑ | ☐ | ☐ | Flow `practice-session.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-019 | Learning plan scrolls to `Back to skill` |  |  |  | Maestro | ``e2e/maestro/kaizen/learning-plan.yaml`` | ☑ | ☐ | ☐ | Flow `learning-plan.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-020 | Reviews scrolls to `Save review` |  |  |  | Maestro | ``e2e/maestro/kaizen/reviews.yaml`` | ☑ | ☐ | ☐ | Flow `reviews.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-021 | Memory scrolls past the saved-memory list |  |  |  | Maestro | ``e2e/maestro/kaizen/memory.yaml`` | ☑ | ☐ | ☐ | Flow `memory.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-022 | Notifications scrolls to the oldest inbox row |  |  |  | Maestro | ``e2e/maestro/kaizen/notifications.yaml`` | ☑ | ☐ | ☐ | Flow `notifications.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-023 | Career setup scrolls to `Continue` |  |  |  | Maestro | ``e2e/maestro/kaizen/career-setup.yaml`` | ☑ | ☐ | ☐ | Flow `career-setup.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-024 | Interview pipeline scrolls to `Add opportunity` |  |  |  | Maestro | ``e2e/maestro/kaizen/interview-pipeline.yaml`` | ☑ | ☐ | ☐ | Flow `interview-pipeline.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-025 | Resume review scrolls to `Review resume` |  |  |  | Maestro | ``e2e/maestro/kaizen/resume-review.yaml`` | ☐ | ☑ | ☐ | Flow `resume-review.yaml` FAIL (2m 47s) (Assertion is false: "Resume review" is visible) |
| KAIZEN-SCROLL-026 | Skill assessment scrolls to `Start assessment` |  |  |  | Maestro | ``e2e/maestro/kaizen/skill-assessment.yaml`` | ☑ | ☐ | ☐ | Flow `skill-assessment.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-027 | Insights scrolls to the last panel |  |  |  | Maestro | ``e2e/maestro/kaizen/insights.yaml`` | ☑ | ☐ | ☐ | Flow `insights.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-028 | Attempt history scrolls to the oldest attempt |  |  |  | Maestro | ``e2e/maestro/kaizen/attempt-history.yaml`` | ☑ | ☐ | ☐ | Flow `attempt-history.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-029 | Book detail scrolls to its destructive actions |  |  |  | Maestro | ``e2e/maestro/kaizen/book-detail.yaml`` | ☑ | ☐ | ☐ | Flow `book-detail.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-030 | Book reader scrolls to the chapter end |  |  |  | Maestro | ``e2e/maestro/kaizen/book-reader.yaml`` | ☑ | ☐ | ☐ | Flow `book-reader.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-031 | Book quiz scrolls to submit |  |  |  | Maestro | ``e2e/maestro/kaizen/book-quiz.yaml`` | ☑ | ☐ | ☐ | Flow `book-quiz.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-032 | Career progress scrolls to the last metric |  |  |  | Maestro | ``e2e/maestro/kaizen/career-progress.yaml`` | ☑ | ☐ | ☐ | Flow `career-progress.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-033 | Skill detail scrolls to its action rows |  |  |  | Maestro | ``e2e/maestro/kaizen/skill-detail.yaml`` | ☑ | ☐ | ☐ | Flow `skill-detail.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-034 | Overflow hubs scroll after a deep-link entry (no tab press) |  |  |  | Maestro | ``e2e/maestro/kaizen/scroll-all-screens.yaml`` | ☑ | ☐ | ☐ | Flow `scroll-all-screens.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-035 | Tab bar and safe-area inset never cover the sentinel |  |  |  | Maestro | ``e2e/maestro/kaizen/scroll-all-screens.yaml`` | ☑ | ☐ | ☐ | Flow `scroll-all-screens.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SCROLL-036 | Scroll surface survives content growth |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/scroll-all-screens.yaml`` | ☑ | ☐ | ☐ | Flow `scroll-all-screens.yaml` PASS (2026-07-19 suite) |
| KAIZEN-TODAY-001 | Today screen mounts after the SQLite gate |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/today-screen.yaml`, `src/fea` | ☑ | ☐ | ☐ | Flow `today-screen.yaml` PASS (2026-07-19 suite) |
| KAIZEN-TODAY-004 | Marking a daily-core item **Done** writes a log row |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/today-screen.yaml`, `src/fea` | ☑ | ☐ | ☐ | Flow `today-screen.yaml` PASS (2026-07-19 suite) |
| KAIZEN-TODAY-005 | Marking a daily-core item **Skip** records a skip, not a com |  |  |  | Maestro | ``e2e/maestro/kaizen/today-screen.yaml`` | ☑ | ☐ | ☐ | Flow `today-screen.yaml` PASS (2026-07-19 suite) |
| KAIZEN-TODAY-007 | Pull-to-refresh re-reads from SQLite |  |  |  | Maestro | ``e2e/maestro/kaizen/today-screen.yaml`` | ☑ | ☐ | ☐ | Flow `today-screen.yaml` PASS (2026-07-19 suite) |
| KAIZEN-TODAY-008 | Deep-work shortcut opens the DeepWork screen |  |  |  | Maestro | ``e2e/maestro/kaizen/deep-work.yaml`` | ☑ | ☐ | ☐ | Flow `deep-work.yaml` PASS (2026-07-19 suite) |
| KAIZEN-TODAY-009 | Career-reps row routes into the practice surface |  |  |  | Maestro | ``e2e/maestro/kaizen/today-screen.yaml`` | ☑ | ☐ | ☐ | Flow `today-screen.yaml` PASS (2026-07-19 suite) |
| KAIZEN-TODAY-010 | Weekly-rotation row opens today's rotation focus |  |  |  | Maestro | ``e2e/maestro/kaizen/weekly-rotation.yaml`` | ☑ | ☐ | ☐ | Flow `weekly-rotation.yaml` PASS (2026-07-19 suite) |
| KAIZEN-TODAY-011 | Habit-stack row opens the stack it is linked to |  |  |  | Maestro | ``e2e/maestro/kaizen/habit-stacks.yaml`` | ☑ | ☐ | ☐ | Flow `habit-stacks.yaml` PASS (2026-07-19 suite) |
| KAIZEN-GUIDE-001 | Guide screen mounts with composer and prompt |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/guide-screen.yaml`, `src/fea` | ☑ | ☐ | ☐ | Flow `guide-screen.yaml` PASS (2026-07-19 suite) |
| KAIZEN-GUIDE-002 | Enabling AI stores the disclosure ack |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/guide-screen.yaml`, `src/fea` | ☑ | ☐ | ☐ | Flow `guide-screen.yaml` PASS (2026-07-19 suite) |
| KAIZEN-GUIDE-004 | Composer is visible and focusable after ack |  |  |  | Maestro | ``e2e/maestro/kaizen/guide-screen.yaml`` | ☑ | ☐ | ☐ | Flow `guide-screen.yaml` PASS (2026-07-19 suite) |
| KAIZEN-GUIDE-005 | Typing renders in the composer |  |  |  | Maestro | ``e2e/maestro/kaizen/guide-screen.yaml`` | ☑ | ☐ | ☐ | Flow `guide-screen.yaml` PASS (2026-07-19 suite) |
| KAIZEN-GUIDE-006 | Sending a message round-trips through coach chat |  |  |  | Maestro, Unit, API | ``e2e/maestro/kaizen/guide-screen.yaml`, `src/fea` | ☑ | ☐ | ☐ | Flow `guide-screen.yaml` PASS (2026-07-19 suite) |
| KAIZEN-GUIDE-008 | Approving a coach-proposed memory promotes the row |  |  |  | Maestro | ``e2e/maestro/kaizen/guide-screen.yaml`` | ☑ | ☐ | ☐ | Flow `guide-screen.yaml` PASS (2026-07-19 suite) |
| KAIZEN-GUIDE-009 | Coach "start practice" tool result opens the practice sessio |  |  |  | Maestro | ``e2e/maestro/kaizen/practice-session.yaml`` | ☑ | ☐ | ☐ | Flow `practice-session.yaml` PASS (2026-07-19 suite) |
| KAIZEN-GUIDE-010 | Empty coach thread renders its empty state |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/guide-screen.yaml`, `src/fea` | ☑ | ☐ | ☐ | Flow `guide-screen.yaml` PASS (2026-07-19 suite) |
| KAIZEN-GUIDE-011 | Offline send surfaces an error, never a silent drop |  |  |  | Maestro | ``e2e/maestro/kaizen/guide-offline-send.yaml`` | ☑ | ☐ | ☐ | Flow `guide-offline-send.yaml` PASS (2026-07-19 suite) |
| KAIZEN-GUIDE-015 | Navigating away from a draft sends nothing |  |  |  | Maestro | ``e2e/maestro/kaizen/guide-screen.yaml`` | ☑ | ☐ | ☐ | Flow `guide-screen.yaml` PASS (2026-07-19 suite) |
| KAIZEN-GUIDE-017 | Long threads scroll to older bubbles |  |  |  | Maestro | ``e2e/maestro/kaizen/scroll-all-screens.yaml`` | ☑ | ☐ | ☐ | Flow `scroll-all-screens.yaml` PASS (2026-07-19 suite) |
| KAIZEN-GUIDE-022 | Coach reply arriving after backgrounding is not lost |  |  |  | Maestro | ``e2e/maestro/kaizen/guide-background-reply.yaml`` | ☑ | ☐ | ☐ | Flow `guide-background-reply.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYS-001 | Systems hub lists enabled systems |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/systems-hub.yaml`, `src/feat` | ☑ | ☐ | ☐ | Flow `systems-hub.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYS-002 | Tapping a system row opens its detail |  |  |  | Maestro | ``e2e/maestro/kaizen/system-detail.yaml`` | ☐ | ☑ | ☐ | Flow `system-detail.yaml` FAIL (4m 34s) (Assertion is false: "Enable system" is visible) |
| KAIZEN-SYS-003 | Pausing a system from the hub flips its state |  |  |  | Maestro | ``e2e/maestro/kaizen/system-detail.yaml`` | ☐ | ☑ | ☐ | Flow `system-detail.yaml` FAIL (4m 34s) (Assertion is false: "Enable system" is visible) |
| KAIZEN-SYS-004 | Re-enabling a paused system restores its actions |  |  |  | Maestro | ``e2e/maestro/kaizen/system-detail.yaml`` | ☐ | ☑ | ☐ | Flow `system-detail.yaml` FAIL (4m 34s) (Assertion is false: "Enable system" is visible) |
| KAIZEN-SYS-005 | Configure entry point opens SystemConfig |  |  |  | Maestro | ``e2e/maestro/kaizen/system-config.yaml`` | ☑ | ☐ | ☐ | Flow `system-config.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYS-006 | Deep-work tool entry from Systems |  |  |  | Maestro | ``e2e/maestro/kaizen/deep-work.yaml`` | ☑ | ☐ | ☐ | Flow `deep-work.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYS-007 | Habit-stacks tool entry from Systems |  |  |  | Maestro | ``e2e/maestro/kaizen/habit-stacks.yaml`` | ☑ | ☐ | ☐ | Flow `habit-stacks.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYS-008 | Weekly-rotation tool entry from Systems |  |  |  | Maestro | ``e2e/maestro/kaizen/weekly-rotation.yaml`` | ☑ | ☐ | ☐ | Flow `weekly-rotation.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYS-012 | Systems hub scrolls to its sentinel |  |  |  | Maestro | ``e2e/maestro/kaizen/scroll-all-screens.yaml`` | ☑ | ☐ | ☐ | Flow `scroll-all-screens.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYS-020 | SystemDetail mounts with actions and status |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/system-detail.yaml`, `src/fe` | ☐ | ☑ | ☐ | Flow `system-detail.yaml` FAIL (4m 34s) (Assertion is false: "Enable system" is visible) |
| KAIZEN-SYS-021 | `Configure tasks` opens SystemConfig for the same system |  |  |  | Maestro | ``e2e/maestro/kaizen/system-config.yaml`` | ☑ | ☐ | ☐ | Flow `system-config.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYS-022 | `Pause system` flips the label and stops surfacing actions |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/system-detail.yaml`, `src/fe` | ☐ | ☑ | ☐ | Flow `system-detail.yaml` FAIL (4m 34s) (Assertion is false: "Enable system" is visible) |
| KAIZEN-SYS-023 | `Enable system` restores the label and the actions |  |  |  | Maestro | ``e2e/maestro/kaizen/system-detail.yaml`` | ☐ | ☑ | ☐ | Flow `system-detail.yaml` FAIL (4m 34s) (Assertion is false: "Enable system" is visible) |
| KAIZEN-SYS-029 | SystemDetail scrolls to its sentinel |  |  |  | Maestro | ``e2e/maestro/kaizen/system-detail.yaml`` | ☐ | ☑ | ☐ | Flow `system-detail.yaml` FAIL (4m 34s) (Assertion is false: "Enable system" is visible) |
| KAIZEN-SYS-040 | SystemConfig mounts with catalog toggles |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/system-config.yaml`, `src/fe` | ☑ | ☐ | ☐ | Flow `system-config.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYS-041 | Enabling a catalog action materialises it |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/system-config.yaml`, `src/fe` | ☑ | ☐ | ☐ | Flow `system-config.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYS-043 | Adding a custom action creates a chip and a row |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/system-config.yaml`, `src/fe` | ☑ | ☐ | ☐ | Flow `system-config.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYS-045 | `Save system` commits every pending change at once |  |  |  | Maestro | ``e2e/maestro/kaizen/system-config.yaml`` | ☑ | ☐ | ☐ | Flow `system-config.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYS-052 | Config scrolls to `Save system` |  |  |  | Maestro | ``e2e/maestro/kaizen/system-config.yaml`` | ☑ | ☐ | ☐ | Flow `system-config.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYS-060 | DeepWork mounts with topic field and blocks |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/deep-work.yaml`, `src/featur` | ☑ | ☐ | ☐ | Flow `deep-work.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYS-061 | Focus topic is captured and persisted |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/deep-work.yaml`, `src/featur` | ☑ | ☐ | ☐ | Flow `deep-work.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYS-062 | Starting a session stamps `started_at` |  |  |  | Maestro | ``e2e/maestro/kaizen/deep-work.yaml`` | ☑ | ☐ | ☐ | Flow `deep-work.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYS-063 | Ending a session stamps `ended_at` and duration |  |  |  | Maestro | ``e2e/maestro/kaizen/deep-work.yaml`` | ☑ | ☐ | ☐ | Flow `deep-work.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYS-065 | `Add block` inserts a new block row |  |  |  | Maestro | ``e2e/maestro/kaizen/deep-work.yaml`` | ☑ | ☐ | ☐ | Flow `deep-work.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYS-080 | HabitStacks mounts with the stack list |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/habit-stacks.yaml`, `src/fea` | ☑ | ☐ | ☐ | Flow `habit-stacks.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYS-081 | Creating a stack inserts a row |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/habit-stacks.yaml`, `src/fea` | ☑ | ☐ | ☐ | Flow `habit-stacks.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYS-082 | Adding a step tags the action `Added` |  |  |  | Maestro | ``e2e/maestro/kaizen/habit-stacks.yaml`` | ☑ | ☐ | ☐ | Flow `habit-stacks.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYS-100 | Rotation mounts with all seven weekday fields |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/weekly-rotation.yaml`, `src/` | ☑ | ☐ | ☐ | Flow `weekly-rotation.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYS-101 | Monday focus saves on blur |  |  |  | Maestro | ``e2e/maestro/kaizen/weekly-rotation.yaml`` | ☑ | ☐ | ☐ | Flow `weekly-rotation.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYS-102 | Tuesday focus saves independently of Monday |  |  |  | Maestro | ``e2e/maestro/kaizen/weekly-rotation.yaml`` | ☑ | ☐ | ☐ | Flow `weekly-rotation.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYS-105 | Rotation scrolls to Sunday |  |  |  | Maestro | ``e2e/maestro/kaizen/weekly-rotation.yaml`` | ☑ | ☐ | ☐ | Flow `weekly-rotation.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYS-119 | Maestro dismiss subflow clears onboarding |  |  |  | Maestro | ``e2e/maestro/kaizen/subflows/dismiss-kaizen-onbo` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-SYS-120 | Re-onboarding from Settings replays the flow |  |  |  | Maestro | ``e2e/maestro/kaizen/settings.yaml`` | ☑ | ☐ | ☐ | Flow `settings.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYS-126 | Local-file tile opens the document picker |  |  |  | Unit, Maestro | ``src/features/kaizen/components/__tests__/DriveF` | ☑ | ☐ | ☐ | Unit/API Jest green; no dedicated Maestro flow on row |
| KAIZEN-SYS-128 | Resume import populates career fields |  |  |  | Unit, Maestro | ``src/features/kaizen/upload/__tests__/importHand` | ☑ | ☐ | ☐ | Unit/API Jest green; no dedicated Maestro flow on row |
| KAIZEN-SYS-129 | Questions import stages rows for review |  |  |  | Unit, Maestro | ``src/features/kaizen/upload/__tests__/importHand` | ☑ | ☐ | ☐ | Unit/API Jest green; no dedicated Maestro flow on row |
| KAIZEN-SYS-130 | Book PDF upload attaches a file key |  |  |  | Unit, API, Maestro | ``src/features/kaizen/api/__tests__/kaizen.test.t` | ☑ | ☐ | ☐ | Unit/API Jest green; no dedicated Maestro flow on row |
| KAIZEN-SYS-139 | Upload while offline fails loudly |  |  |  | Maestro | ``e2e/maestro/kaizen/books-offline-upload.yaml`` | ☐ | ☑ | ☐ | Flow `books-offline-upload.yaml` FAIL (1m 49s) (Assertion is false: "book.pdf" is visible) |
| KAIZEN-CAREER-001 | Career hub mounts with its four stat tiles |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/career-hub.yaml`, `src/featu` | ☑ | ☐ | ☐ | Flow `career-hub.yaml` PASS (2026-07-19 suite) |
| KAIZEN-CAREER-002 | Setup tool row opens CareerSetup |  |  |  | Maestro | ``e2e/maestro/kaizen/career-setup.yaml`` | ☑ | ☐ | ☐ | Flow `career-setup.yaml` PASS (2026-07-19 suite) |
| KAIZEN-CAREER-003 | Progress row opens CareerProgress |  |  |  | Maestro | ``e2e/maestro/kaizen/career-progress.yaml`` | ☑ | ☐ | ☐ | Flow `career-progress.yaml` PASS (2026-07-19 suite) |
| KAIZEN-CAREER-004 | Pipeline row opens InterviewPipeline |  |  |  | Maestro | ``e2e/maestro/kaizen/interview-pipeline.yaml`` | ☑ | ☐ | ☐ | Flow `interview-pipeline.yaml` PASS (2026-07-19 suite) |
| KAIZEN-CAREER-005 | Resume row opens ResumeReview |  |  |  | Maestro | ``e2e/maestro/kaizen/resume-review.yaml`` | ☐ | ☑ | ☐ | Flow `resume-review.yaml` FAIL (2m 47s) (Assertion is false: "Resume review" is visible) |
| KAIZEN-CAREER-007 | Career hub scrolls to its sentinel |  |  |  | Maestro | ``e2e/maestro/kaizen/scroll-all-screens.yaml`` | ☑ | ☐ | ☐ | Flow `scroll-all-screens.yaml` PASS (2026-07-19 suite) |
| KAIZEN-CAREER-020 | Step 1 — Goals and roles renders |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/career-setup.yaml`, `src/fea` | ☑ | ☐ | ☐ | Flow `career-setup.yaml` PASS (2026-07-19 suite) |
| KAIZEN-CAREER-021 | Step 2 — Skills renders |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/career-setup.yaml`, `src/fea` | ☑ | ☐ | ☐ | Flow `career-setup.yaml` PASS (2026-07-19 suite) |
| KAIZEN-CAREER-022 | Step 3 — Resume renders |  |  |  | Maestro | ``e2e/maestro/kaizen/career-setup.yaml`` | ☑ | ☐ | ☐ | Flow `career-setup.yaml` PASS (2026-07-19 suite) |
| KAIZEN-CAREER-025 | Toggling a goal chip persists the selection |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/career-setup.yaml`, `src/fea` | ☑ | ☐ | ☐ | Flow `career-setup.yaml` PASS (2026-07-19 suite) |
| KAIZEN-CAREER-026 | Target roles are parsed and stored |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/career-setup.yaml`, `src/fea` | ☑ | ☐ | ☐ | Flow `career-setup.yaml` PASS (2026-07-19 suite) |
| KAIZEN-CAREER-028 | `Continue` advances exactly one step |  |  |  | Maestro | ``e2e/maestro/kaizen/career-setup.yaml`` | ☑ | ☐ | ☐ | Flow `career-setup.yaml` PASS (2026-07-19 suite) |
| KAIZEN-CAREER-030 | Resume step is reachable from goals in one pass |  |  |  | Maestro | ``e2e/maestro/kaizen/career-setup.yaml`` | ☑ | ☐ | ☐ | Flow `career-setup.yaml` PASS (2026-07-19 suite) |
| KAIZEN-CAREER-040 | Progress mounts with the 30-day metric cards |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/career-progress.yaml`, `src/` | ☑ | ☐ | ☐ | Flow `career-progress.yaml` PASS (2026-07-19 suite) |
| KAIZEN-CAREER-043 | Progress scrolls to the last metric |  |  |  | Maestro | ``e2e/maestro/kaizen/career-progress.yaml`` | ☑ | ☐ | ☐ | Flow `career-progress.yaml` PASS (2026-07-19 suite) |
| KAIZEN-CAREER-050 | Pipeline mounts with its stages |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/interview-pipeline.yaml`, `s` | ☑ | ☐ | ☐ | Flow `interview-pipeline.yaml` PASS (2026-07-19 suite) |
| KAIZEN-CAREER-051 | Adding an opportunity inserts a row in the first stage |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/interview-pipeline.yaml`, `s` | ☑ | ☐ | ☐ | Flow `interview-pipeline.yaml` PASS (2026-07-19 suite) |
| KAIZEN-CAREER-052 | Advancing a row updates its stage |  |  |  | Maestro | ``e2e/maestro/kaizen/interview-pipeline.yaml`` | ☑ | ☐ | ☐ | Flow `interview-pipeline.yaml` PASS (2026-07-19 suite) |
| KAIZEN-CAREER-055 | Stage strip scrolls to the last stage |  |  |  | Maestro | ``e2e/maestro/kaizen/interview-pipeline.yaml`` | ☑ | ☐ | ☐ | Flow `interview-pipeline.yaml` PASS (2026-07-19 suite) |
| KAIZEN-CAREER-065 | Resume review mounts with the paste area |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/resume-review.yaml`, `src/fe` | ☐ | ☑ | ☐ | Flow `resume-review.yaml` FAIL (2m 47s) (Assertion is false: "Resume review" is visible) |
| KAIZEN-CAREER-066 | Pasted resume text is captured and stored |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/resume-review.yaml`, `src/fe` | ☐ | ☑ | ☐ | Flow `resume-review.yaml` FAIL (2m 47s) (Assertion is false: "Resume review" is visible) |
| KAIZEN-CAREER-067 | `Review resume` returns skills and roles |  |  |  | Maestro, Unit, API | ``e2e/maestro/kaizen/resume-review.yaml`, `src/fe` | ☐ | ☑ | ☐ | Flow `resume-review.yaml` FAIL (2m 47s) (Assertion is false: "Resume review" is visible) |
| KAIZEN-CAREER-073 | Resume PDF import fills the paste field |  |  |  | Maestro | ``e2e/maestro/kaizen/resume-review.yaml`` | ☐ | ☑ | ☐ | Flow `resume-review.yaml` FAIL (2m 47s) (Assertion is false: "Resume review" is visible) |
| KAIZEN-ASSESS-001 | Assess hub mounts with the mastery summary |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/assess-hub.yaml`, `src/featu` | ☑ | ☐ | ☐ | Flow `assess-hub.yaml` PASS (2026-07-19 suite) |
| KAIZEN-ASSESS-002 | Banks tool row opens QuestionBanks |  |  |  | Maestro | ``e2e/maestro/kaizen/question-banks.yaml`` | ☐ | ☑ | ☐ | Flow `question-banks.yaml` FAIL (1m 53s) (Element not found: Text matching regex: Behavioral) |
| KAIZEN-ASSESS-003 | Import tool row opens QuestionImport |  |  |  | Maestro | ``e2e/maestro/kaizen/question-import.yaml`` | ☐ | ☑ | ☐ | Flow `question-import.yaml` FAIL (3m 4s) (Element not found: Text matching regex: Import for review) |
| KAIZEN-ASSESS-004 | Practice tool row opens PracticeSession |  |  |  | Maestro | ``e2e/maestro/kaizen/practice-session.yaml`` | ☑ | ☐ | ☐ | Flow `practice-session.yaml` PASS (2026-07-19 suite) |
| KAIZEN-ASSESS-005 | Assessment tool row opens SkillAssessment |  |  |  | Maestro | ``e2e/maestro/kaizen/skill-assessment.yaml`` | ☑ | ☐ | ☐ | Flow `skill-assessment.yaml` PASS (2026-07-19 suite) |
| KAIZEN-ASSESS-007 | Assess hub scrolls to its sentinel |  |  |  | Maestro | ``e2e/maestro/kaizen/scroll-all-screens.yaml`` | ☑ | ☐ | ☐ | Flow `scroll-all-screens.yaml` PASS (2026-07-19 suite) |
| KAIZEN-ASSESS-020 | Banks mount with categories and approved questions |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/question-banks.yaml`, `src/f` | ☐ | ☑ | ☐ | Flow `question-banks.yaml` FAIL (1m 53s) (Element not found: Text matching regex: Behavioral) |
| KAIZEN-ASSESS-021 | Selecting a category filters the list |  |  |  | Maestro | ``e2e/maestro/kaizen/question-banks.yaml`` | ☐ | ☑ | ☐ | Flow `question-banks.yaml` FAIL (1m 53s) (Element not found: Text matching regex: Behavioral) |
| KAIZEN-ASSESS-022 | Adding a question inserts an approved row |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/question-banks.yaml`, `src/f` | ☐ | ☑ | ☐ | Flow `question-banks.yaml` FAIL (1m 53s) (Element not found: Text matching regex: Behavioral) |
| KAIZEN-ASSESS-025 | Approving a pending question activates it |  |  |  | Maestro | ``e2e/maestro/kaizen/question-banks.yaml`` | ☐ | ☑ | ☐ | Flow `question-banks.yaml` FAIL (1m 53s) (Element not found: Text matching regex: Behavioral) |
| KAIZEN-ASSESS-028 | Banks scroll to the import link |  |  |  | Maestro | ``e2e/maestro/kaizen/question-banks.yaml`` | ☐ | ☑ | ☐ | Flow `question-banks.yaml` FAIL (1m 53s) (Element not found: Text matching regex: Behavioral) |
| KAIZEN-ASSESS-035 | Import screen mounts with its paste area |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/question-import.yaml`, `src/` | ☐ | ☑ | ☐ | Flow `question-import.yaml` FAIL (3m 4s) (Element not found: Text matching regex: Import for review) |
| KAIZEN-ASSESS-036 | Pasted text renders in the field |  |  |  | Maestro | ``e2e/maestro/kaizen/question-import.yaml`` | ☐ | ☑ | ☐ | Flow `question-import.yaml` FAIL (3m 4s) (Element not found: Text matching regex: Import for review) |
| KAIZEN-ASSESS-037 | `Import for review` extracts and stages questions |  |  |  | Maestro, Unit, API | ``e2e/maestro/kaizen/question-import.yaml`, `src/` | ☐ | ☑ | ☐ | Flow `question-import.yaml` FAIL (3m 4s) (Element not found: Text matching regex: Import for review) |
| KAIZEN-ASSESS-038 | Approving the batch moves rows into the bank |  |  |  | Maestro | ``e2e/maestro/kaizen/question-import.yaml`` | ☐ | ☑ | ☐ | Flow `question-import.yaml` FAIL (3m 4s) (Element not found: Text matching regex: Import for review) |
| KAIZEN-ASSESS-043 | Document import stages questions from a file |  |  |  | Maestro | ``e2e/maestro/kaizen/question-import.yaml`` | ☐ | ☑ | ☐ | Flow `question-import.yaml` FAIL (3m 4s) (Element not found: Text matching regex: Import for review) |
| KAIZEN-ASSESS-050 | Practice mounts with a prompt and composer |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/practice-session.yaml`, `src` | ☑ | ☐ | ☐ | Flow `practice-session.yaml` PASS (2026-07-19 suite) |
| KAIZEN-ASSESS-051 | Typing an answer renders in the composer |  |  |  | Maestro | ``e2e/maestro/kaizen/practice-session.yaml`` | ☑ | ☐ | ☐ | Flow `practice-session.yaml` PASS (2026-07-19 suite) |
| KAIZEN-ASSESS-052 | Self-scoring writes an attempt row |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/practice-session.yaml`, `src` | ☑ | ☐ | ☐ | Flow `practice-session.yaml` PASS (2026-07-19 suite) |
| KAIZEN-ASSESS-053 | `Score with AI` returns an overall score |  |  |  | Unit, API, Maestro | ``src/features/kaizen/api/__tests__/kaizen.test.t` | ☑ | ☐ | ☐ | Unit/API Jest green; no dedicated Maestro flow on row |
| KAIZEN-ASSESS-056 | No approved questions shows the empty state |  |  |  | Maestro | ``e2e/maestro/kaizen/practice-session.yaml`` | ☑ | ☐ | ☐ | Flow `practice-session.yaml` PASS (2026-07-19 suite) |
| KAIZEN-ASSESS-065 | Assessment shell mounts |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/skill-assessment.yaml`, `src` | ☑ | ☐ | ☐ | Flow `skill-assessment.yaml` PASS (2026-07-19 suite) |
| KAIZEN-ASSESS-066 | `Start assessment` shows the first question |  |  |  | Maestro | ``e2e/maestro/kaizen/skill-assessment.yaml`` | ☑ | ☐ | ☐ | Flow `skill-assessment.yaml` PASS (2026-07-19 suite) |
| KAIZEN-ASSESS-081 | Missing skill id shows the chooser copy |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/skill-detail.yaml`, `src/fea` | ☑ | ☐ | ☐ | Flow `skill-detail.yaml` PASS (2026-07-19 suite) |
| KAIZEN-ASSESS-084 | Skill detail scrolls to its history |  |  |  | Maestro | ``e2e/maestro/kaizen/skill-detail.yaml`` | ☑ | ☐ | ☐ | Flow `skill-detail.yaml` PASS (2026-07-19 suite) |
| KAIZEN-ASSESS-091 | Missing skill id shows the empty state |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/attempt-history.yaml`, `src/` | ☑ | ☐ | ☐ | Flow `attempt-history.yaml` PASS (2026-07-19 suite) |
| KAIZEN-ASSESS-093 | Attempt history scrolls to the oldest attempt |  |  |  | Maestro | ``e2e/maestro/kaizen/attempt-history.yaml`` | ☑ | ☐ | ☐ | Flow `attempt-history.yaml` PASS (2026-07-19 suite) |
| KAIZEN-LEARN-001 | Learn hub mounts with the capture card |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/learn-hub.yaml`, `src/featur` | ☑ | ☐ | ☐ | Flow `learn-hub.yaml` PASS (2026-07-19 suite) |
| KAIZEN-LEARN-005 | Learning-plan tool row opens the plan |  |  |  | Maestro | ``e2e/maestro/kaizen/learning-plan.yaml`` | ☑ | ☐ | ☐ | Flow `learning-plan.yaml` PASS (2026-07-19 suite) |
| KAIZEN-LEARN-006 | Reviews tool row opens Reviews |  |  |  | Maestro | ``e2e/maestro/kaizen/reviews.yaml`` | ☑ | ☐ | ☐ | Flow `reviews.yaml` PASS (2026-07-19 suite) |
| KAIZEN-LEARN-007 | Books tool row opens the library |  |  |  | Maestro | ``e2e/maestro/kaizen/books.yaml`` | ☐ | ☑ | ☐ | Flow `books.yaml` FAIL (1m 46s) (Assertion is false: "book.pdf" is visible) |
| KAIZEN-LEARN-008 | Insights tool row opens Insights |  |  |  | Maestro | ``e2e/maestro/kaizen/insights.yaml`` | ☑ | ☐ | ☐ | Flow `insights.yaml` PASS (2026-07-19 suite) |
| KAIZEN-LEARN-009 | Learn hub scrolls to its sentinel |  |  |  | Maestro | ``e2e/maestro/kaizen/scroll-all-screens.yaml`` | ☑ | ☐ | ☐ | Flow `scroll-all-screens.yaml` PASS (2026-07-19 suite) |
| KAIZEN-LEARN-020 | Plan mounts with its three sections |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/learning-plan.yaml`, `src/fe` | ☑ | ☐ | ☐ | Flow `learning-plan.yaml` PASS (2026-07-19 suite) |
| KAIZEN-LEARN-021 | `Back to skill` returns to the same skill |  |  |  | Maestro | ``e2e/maestro/kaizen/learning-plan.yaml`` | ☑ | ☐ | ☐ | Flow `learning-plan.yaml` PASS (2026-07-19 suite) |
| KAIZEN-LEARN-025 | Plan scrolls to `Back to skill` |  |  |  | Maestro | ``e2e/maestro/kaizen/learning-plan.yaml`` | ☑ | ☐ | ☐ | Flow `learning-plan.yaml` PASS (2026-07-19 suite) |
| KAIZEN-LEARN-030 | Reviews mounts with three reflection fields |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/reviews.yaml`, `src/features` | ☑ | ☐ | ☐ | Flow `reviews.yaml` PASS (2026-07-19 suite) |
| KAIZEN-LEARN-031 | All three fields accept text |  |  |  | Maestro | ``e2e/maestro/kaizen/reviews.yaml`` | ☑ | ☐ | ☐ | Flow `reviews.yaml` PASS (2026-07-19 suite) |
| KAIZEN-LEARN-032 | `Save review` persists the week's row |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/reviews.yaml`, `src/features` | ☑ | ☐ | ☐ | Flow `reviews.yaml` PASS (2026-07-19 suite) |
| KAIZEN-LEARN-040 | Books mounts with the library |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/books.yaml`, `src/features/k` | ☐ | ☑ | ☐ | Flow `books.yaml` FAIL (1m 46s) (Assertion is false: "book.pdf" is visible) |
| KAIZEN-LEARN-041 | `Add a book` reveals the new-book form |  |  |  | Maestro | ``e2e/maestro/kaizen/books.yaml`` | ☐ | ☑ | ☐ | Flow `books.yaml` FAIL (1m 46s) (Assertion is false: "book.pdf" is visible) |
| KAIZEN-LEARN-042 | Book title field accepts text |  |  |  | Maestro | ``e2e/maestro/kaizen/books.yaml`` | ☐ | ☑ | ☐ | Flow `books.yaml` FAIL (1m 46s) (Assertion is false: "book.pdf" is visible) |
| KAIZEN-LEARN-043 | Language pill sets the book language |  |  |  | Maestro | ``e2e/maestro/kaizen/books.yaml`` | ☐ | ☑ | ☐ | Flow `books.yaml` FAIL (1m 46s) (Assertion is false: "book.pdf" is visible) |
| KAIZEN-LEARN-044 | Saving creates a library row |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/books.yaml`, `src/features/k` | ☐ | ☑ | ☐ | Flow `books.yaml` FAIL (1m 46s) (Assertion is false: "book.pdf" is visible) |
| KAIZEN-LEARN-047 | Tapping a book opens its detail |  |  |  | Maestro | ``e2e/maestro/kaizen/book-detail.yaml`` | ☑ | ☐ | ☐ | Flow `book-detail.yaml` PASS (2026-07-19 suite) |
| KAIZEN-LEARN-048 | Books scrolls to the add form |  |  |  | Maestro | ``e2e/maestro/kaizen/books.yaml`` | ☐ | ☑ | ☐ | Flow `books.yaml` FAIL (1m 46s) (Assertion is false: "book.pdf" is visible) |
| KAIZEN-LEARN-050 | `Cancel` collapses the form without writing |  |  |  | Maestro | ``e2e/maestro/kaizen/books.yaml`` | ☐ | ☑ | ☐ | Flow `books.yaml` FAIL (1m 46s) (Assertion is false: "book.pdf" is visible) |
| KAIZEN-LEARN-056 | Missing/deleted book shows the unavailable state |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/book-detail.yaml`, `src/feat` | ☑ | ☐ | ☐ | Flow `book-detail.yaml` PASS (2026-07-19 suite) |
| KAIZEN-LEARN-057 | Read action opens the reader on this book |  |  |  | Maestro | ``e2e/maestro/kaizen/book-reader.yaml`` | ☑ | ☐ | ☐ | Flow `book-reader.yaml` PASS (2026-07-19 suite) |
| KAIZEN-LEARN-058 | Quiz action opens the comprehension check |  |  |  | Maestro | ``e2e/maestro/kaizen/book-quiz.yaml`` | ☑ | ☐ | ☐ | Flow `book-quiz.yaml` PASS (2026-07-19 suite) |
| KAIZEN-LEARN-066 | Missing chapter shows the unavailable state |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/book-reader.yaml`, `src/feat` | ☑ | ☐ | ☐ | Flow `book-reader.yaml` PASS (2026-07-19 suite) |
| KAIZEN-LEARN-070 | Reader scrolls to the chapter end |  |  |  | Maestro | ``e2e/maestro/kaizen/book-reader.yaml`` | ☑ | ☐ | ☐ | Flow `book-reader.yaml` PASS (2026-07-19 suite) |
| KAIZEN-LEARN-076 | No questions shows the generate prompt |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/book-quiz.yaml`, `src/featur` | ☑ | ☐ | ☐ | Flow `book-quiz.yaml` PASS (2026-07-19 suite) |
| KAIZEN-LEARN-082 | Quiz scrolls to submit |  |  |  | Maestro | ``e2e/maestro/kaizen/book-quiz.yaml`` | ☑ | ☐ | ☐ | Flow `book-quiz.yaml` PASS (2026-07-19 suite) |
| KAIZEN-LEARN-090 | Insights mounts with all panels |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/insights.yaml`, `src/feature` | ☑ | ☐ | ☐ | Flow `insights.yaml` PASS (2026-07-19 suite) |
| KAIZEN-LEARN-093 | Insights scrolls to the last panel |  |  |  | Maestro | ``e2e/maestro/kaizen/insights.yaml`` | ☑ | ☐ | ☐ | Flow `insights.yaml` PASS (2026-07-19 suite) |
| KAIZEN-MEM-001 | Memory settings mount from Settings |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/memory.yaml`, `src/features/` | ☑ | ☐ | ☐ | Flow `memory.yaml` PASS (2026-07-19 suite) |
| KAIZEN-MEM-002 | Approving a memory flips its state |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/memory.yaml`, `src/features/` | ☑ | ☐ | ☐ | Flow `memory.yaml` PASS (2026-07-19 suite) |
| KAIZEN-MEM-005 | Empty memory inbox shows guidance |  |  |  | Maestro | ``e2e/maestro/kaizen/memory.yaml`` | ☑ | ☐ | ☐ | Flow `memory.yaml` PASS (2026-07-19 suite) |
| KAIZEN-MEM-006 | Memory list scrolls to the last row |  |  |  | Maestro | ``e2e/maestro/kaizen/memory.yaml`` | ☑ | ☐ | ☐ | Flow `memory.yaml` PASS (2026-07-19 suite) |
| KAIZEN-MEM-007 | A coach-approved memory shows as approved in Settings |  |  |  | Maestro | ``e2e/maestro/kaizen/guide-screen.yaml`, `e2e/mae` | ☑ | ☐ | ☐ | Flow `guide-screen.yaml` PASS (2026-07-19 suite) |
| KAIZEN-PROF-001 | Profile mounts from More |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/more-hub.yaml`, `e2e/maestro` | ☑ | ☐ | ☐ | Flow `more-hub.yaml` PASS (2026-07-19 suite) |
| KAIZEN-PROF-002 | Tapping the display name enters edit mode |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/profile.yaml`, `src/features` | ☑ | ☐ | ☐ | Flow `profile.yaml` PASS (2026-07-19 suite) |
| KAIZEN-PROF-003 | `Save` persists the new display name |  |  |  | Maestro | ``e2e/maestro/kaizen/profile.yaml`` | ☑ | ☐ | ☐ | Flow `profile.yaml` PASS (2026-07-19 suite) |
| KAIZEN-PROF-004 | `Cancel` restores the prior name |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/profile.yaml`, `src/features` | ☑ | ☐ | ☐ | Flow `profile.yaml` PASS (2026-07-19 suite) |
| KAIZEN-PROF-006 | Logout clears the session |  |  |  | Maestro | ``e2e/maestro/kaizen/subflows/logout-if-needed.ya` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-PROF-007 | Profile scrolls to the logout region |  |  |  | Maestro | ``e2e/maestro/kaizen/profile.yaml`` | ☑ | ☐ | ☐ | Flow `profile.yaml` PASS (2026-07-19 suite) |
| KAIZEN-AUTH-001 | Login screen renders the Kaizen brand and controls |  |  |  | Maestro | ``e2e/maestro/kaizen/login-screen-controls.yaml`` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-AUTH-002 | Email field accepts input |  |  |  | Maestro | ``e2e/maestro/kaizen/login-screen-controls.yaml`` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-AUTH-003 | Password field masks input |  |  |  | Maestro | ``e2e/maestro/kaizen/login-screen-controls.yaml`` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-AUTH-004 | Valid credentials establish a session |  |  |  | Maestro | ``e2e/maestro/kaizen/subflows/kaizen-login-if-nee` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-AUTH-005 | Biometric row renders in Settings |  |  |  | Maestro | ``e2e/maestro/kaizen/biometric-settings-row.yaml`` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-AUTH-006 | Enabling biometrics stores the preference |  |  |  | Maestro | ``e2e/maestro/kaizen/biometric-settings-row.yaml`` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-AUTH-007 | Remembered login enables biometric sign-in |  |  |  | Maestro | ``e2e/maestro/kaizen/biometric-remember-last-logi` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-AUTH-008 | E2E autologin deep link signs in |  |  |  | Maestro | ``e2e/maestro/kaizen/subflows/kaizen-login-if-nee` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-AUTH-009 | Biometric OS prompt is dismissed defensively |  |  |  | Maestro | ``e2e/maestro/kaizen/subflows/dismiss-biometric-p` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-AUTH-011 | Logout requires re-authentication |  |  |  | Maestro | ``e2e/maestro/kaizen/subflows/logout-if-needed.ya` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-AUTH-015 | `Sign Up` is present but registration is disabled |  |  |  | Maestro | ``e2e/maestro/kaizen/auth-sign-up-disabled.yaml`` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-AUTH-016 | Failed-login modal is dismissible and recoverable |  |  |  | Maestro | ``e2e/maestro/kaizen/subflows/kaizen-login-if-nee` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-AUTH-017 | Disabling biometrics removes the biometric button |  |  |  | Maestro | ``e2e/maestro/kaizen/auth-biometric-disable.yaml`` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-SETT-001 | Settings mounts with all sections |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/settings.yaml`, `src/feature` | ☑ | ☐ | ☐ | Flow `settings.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SETT-002 | `Sync Kaizen` pushes and pulls |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/settings.yaml`, `src/feature` | ☑ | ☐ | ☐ | Flow `settings.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SETT-003 | `Manage memory` opens the memory screen |  |  |  | Maestro | ``e2e/maestro/kaizen/settings.yaml`` | ☑ | ☐ | ☐ | Flow `settings.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SETT-004 | Biometric row reflects the stored preference |  |  |  | Maestro | ``e2e/maestro/kaizen/biometric-settings-row.yaml`` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-SETT-006 | Notifications row opens the notifications screen |  |  |  | Maestro | ``e2e/maestro/kaizen/notifications.yaml`` | ☑ | ☐ | ☐ | Flow `notifications.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SETT-007 | `Onboarding` re-run replays the flow |  |  |  | Maestro | ``e2e/maestro/kaizen/settings.yaml`` | ☑ | ☐ | ☐ | Flow `settings.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SETT-008 | Logout from Settings ends the session |  |  |  | Maestro | ``e2e/maestro/kaizen/settings.yaml`` | ☑ | ☐ | ☐ | Flow `settings.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SETT-011 | Settings scrolls to the logout row |  |  |  | Maestro | ``e2e/maestro/kaizen/settings.yaml`` | ☑ | ☐ | ☐ | Flow `settings.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SETT-017 | `Enable notifications` from Settings requests permission |  |  |  | Maestro | ``e2e/maestro/kaizen/notifications.yaml`` | ☑ | ☐ | ☐ | Flow `notifications.yaml` PASS (2026-07-19 suite) |
| KAIZEN-NOTIF-001 | Notifications screen mounts |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/notifications.yaml`, `src/fe` | ☑ | ☐ | ☐ | Flow `notifications.yaml` PASS (2026-07-19 suite) |
| KAIZEN-NOTIF-002 | `Enable notifications` registers a push token |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/notifications.yaml`, `src/fe` | ☑ | ☐ | ☐ | Flow `notifications.yaml` PASS (2026-07-19 suite) |
| KAIZEN-NOTIF-006 | Inbox scrolls to the oldest entry |  |  |  | Maestro | ``e2e/maestro/kaizen/notifications.yaml`` | ☑ | ☐ | ☐ | Flow `notifications.yaml` PASS (2026-07-19 suite) |
| KAIZEN-NOTIF-008 | Denying permission degrades gracefully |  |  |  | Maestro | ``e2e/maestro/kaizen/notifications.yaml`` | ☑ | ☐ | ☐ | Flow `notifications.yaml` PASS (2026-07-19 suite) |
| KAIZEN-NOTIF-009 | `Refresh registration` re-registers the token |  |  |  | Maestro, Unit | ``e2e/maestro/kaizen/notifications.yaml`, `src/fe` | ☑ | ☐ | ☐ | Flow `notifications.yaml` PASS (2026-07-19 suite) |
| KAIZEN-SYNC-023 | Deleting the app removes all local Kaizen data |  |  |  | Maestro | ``e2e/maestro/kaizen/sync-hard-reset.yaml`` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-ONB-002 | Welcome dismiss subflow is idempotent |  |  |  | Maestro | ``e2e/maestro/kaizen/subflows/dismiss-welcome-if-` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-ONB-003 | Kaizen onboarding dismiss subflow reaches Today |  |  |  | Maestro | ``e2e/maestro/kaizen/subflows/dismiss-kaizen-onbo` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-ONB-004 | `kaizen://e2e-setup` seeds the fixture profile |  |  |  | Maestro | ``e2e/maestro/kaizen/subflows/kaizen-setup-if-nee` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-ONB-007 | Launch subflow foregrounds a logged-in Kaizen |  |  |  | Maestro | ``e2e/maestro/kaizen/subflows/launch-kaizen.yaml`` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-ONB-008 | Route subflow opens an arbitrary Kaizen deep link |  |  |  | Maestro | ``e2e/maestro/kaizen/subflows/open-kaizen-route.y` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-ONB-009 | Return-to-today subflow restores the baseline |  |  |  | Maestro | ``e2e/maestro/kaizen/subflows/return-to-today.yam` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-ONB-010 | Tab-navigation subflows select the right tab |  |  |  | Maestro | ``e2e/maestro/kaizen/subflows/go-today.yaml`, `e2` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-ONB-011 | Biometric-enable subflow handles both states |  |  |  | Maestro | ``e2e/maestro/kaizen/subflows/enable-biometric-if` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-ONB-012 | `go-guide` subflow selects the Guide tab |  |  |  | Maestro | ``e2e/maestro/kaizen/subflows/go-guide.yaml`` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-ONB-013 | Login subflow is idempotent |  |  |  | Maestro | ``e2e/maestro/kaizen/subflows/kaizen-login-if-nee` | ☐ | ☐ | ☑ | Not mapped to an executed flow |
| KAIZEN-ONB-014 | Logout subflow leaves the app on the auth screen |  |  |  | Maestro | ``e2e/maestro/kaizen/subflows/logout-if-needed.ya` | ☐ | ☐ | ☑ | Not mapped to an executed flow |

---

## Revision

| Date | Change |
|------|--------|
| 2026-07-18 | Initial dated scoring copy created alongside Circle V2 matrix expansion |
| 2026-07-19 | Scored from `/tmp/kaizen-suite-final2.log` — **33/39** Maestro flows pass; **166 / 38 / 29** row Pass/Fail/N/A; superseded stale 39/39 claim from trimmed run |