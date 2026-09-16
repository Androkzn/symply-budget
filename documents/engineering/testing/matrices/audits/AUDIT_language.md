# Audit — `language.md` acceptance matrix

| Field | Value |
|-------|-------|
| **Target** | [../language.md](../language.md) |
| **Contract** | [../COVERAGE_CONTRACT.md](../COVERAGE_CONTRACT.md) |
| **Reference bar** | Circle V2 TRD/BRD Acceptance Test Matrix (~139 scored rows, multi-step repro, execution groups, security negatives, flagged ambiguities) |
| **Date** | 2026-07-18 |
| **Method** | Code inventory first (`src/features/language/`, `app/(tabs)/`, `brands/symply-language/brand.cjs`, `backend-language/src/`, `e2e/maestro/language/`), then row-by-row diff. **Every** cited automation path and BE path was verified on disk / against the Hono mount table. No claim in this report rests on documentation alone. |
| **Result** | 180 → 246 scored rows; 13 → 25 flagged entries |

---

## 1. Surface inventory (what actually ships)

### 1.1 Screens and routes

There is **no `app/language*` directory**. All eight screens mount through `app/(tabs)/` behind `isLanguageBrand()` guards, plus one react-navigation stack screen.

| Route | Route file | Screen | Root testID |
|-------|-----------|--------|-------------|
| `/` | `app/(tabs)/index.tsx` | `LanguageLearnScreen` | `language-learn-screen` |
| `/chat` | `app/(tabs)/chat.tsx` | `LanguageTutorScreen` | `language-tutor-screen` |
| `/language-plan` | `app/(tabs)/language-plan.tsx` | `LanguagePlanScreen` | `language-plan-screen` |
| `/language-review` | `app/(tabs)/language-review.tsx` | `LanguageReviewScreen` | `language-review-screen` |
| `/language-assessment` | `app/(tabs)/language-assessment.tsx` | `LanguageAssessmentScreen` | `language-assessment-screen` |
| `/language-dialogue` | `app/(tabs)/language-dialogue.tsx` | `LanguageDialogueScreen` | `language-dialogue-screen` |
| `/settings` | `app/(tabs)/settings.tsx` | `LanguageMoreScreen` | `language-more-screen` |
| *(stack)* | `src/navigation/OnboardingNavigator.tsx:29` | `LanguageOnboardingScreen` | **none** |

Tab pool (`brands/symply-language/brand.cjs:23-31`): Learn (`index`, locked), Tutor (`chat`), Plan, Review, More (`settings`, locked) pinned; Assessment + Dialogue `defaultHidden: true`. `customizableTabs: true`, `maxVisibleTabs: 5`.

**No screen is a stub.** All eight render real, wired content. The Plan screen is *functional but read-only* — its only controls are the header back chevron and the empty-state **[ Start assessment ]** CTA.

### 1.2 Control inventory — verified absences

`grep testID= src/features/language/screens/*.tsx` returns **exactly 7 hits**, every one a root `<View>`. There are **zero per-control testIDs** in the feature, and `LanguageOnboardingScreen.tsx` has none at all.

Verified **not present anywhere** in the shipped feature: `expo-av` / `expo-audio`, `Recording`, playback-rate or speed control, TTS/`Speech`, `Swipeable` / `PanGestureHandler`, `Modal` / `BottomSheet`, `Switch`, FAB, picker/dropdown. The only modal surfaces are the two native `Alert`s on the More screen. Any matrix row asserting audio playback, swipe-to-rate, or a toggle would be describing a donor feature that was not ported.

### 1.3 Backend — the "donor" is `backend-language/` itself

The premise that Language talks to a *separate* live donor backend is a naming artefact, not a second service:

- `backend-language/wrangler.toml:26` → worker `simple-language-api`; `:152` (`[env.staging]`) → `simple-language-api-staging`.
- `src/config/env.shared.ts:23-26` hardcodes exactly those two `workers.dev` hostnames for `symply-language`.
- `src/features/language/api/languageClient.ts:17,90` appends `/api/v1` to `ENV.API_BASE_URL` on every request.

So: **`backend-language/` deployed as its own Worker, reached at `<host>/api/v1/*`, outside `deploy:fleet`.** Confirmed 21 route files mounted at explicit `/api/v1/<domain>` prefixes in `backend-language/src/index.ts:133-151`, plus an **unprefixed** platform block (`app.route('/', platformAiAccess)`) and `/smart-engine`.

The FE binds **48 endpoints** across 11 api modules. All 47 unique paths in the matrix were cross-checked against the Hono mount table — see §4.

---

## 2. Gap list

### 2.a COVERAGE GAPS — surface with zero matrix row

66 new rows were added. Grouped by what was uncovered:

| Area | Uncovered before | New IDs |
|------|------------------|---------|
| Client spine | Brand base-URL resolution, `/api/v1` prefix construction, deliberate bypass of the shared axios client | LANG-SMOKE-006/007/008 |
| Auth negatives | Wrong password, empty fields, malformed email, refresh-failure path — the entire security-negative family was missing | LANG-AUTH-010/011/012/013 |
| Tab shell | `maxVisibleTabs: 5` cap, pref persistence across relaunch, non-Language brand redirect guard, cold-start deep link, More-tab route naming | LANG-SHELL-011/012/013/014/015 |
| Learn conditionals | Greeting time branches, null `display_name`, streak + due-count pluralisation, zero-due chevron branch, the third nav-slot branch (`assessmentDue: false` + no plan), strikethrough, pre-hydration toggle guard, the duplicate `Review vocabulary` label, widget `next_lesson` variants | LANG-LEARN-028…037 |
| Tutor | Return-key submit, composer growth cap, auto-scroll, error-banner recovery, in-flight disable, a11y label, whitespace-only rejection | LANG-TUTOR-020…026 |
| Plan | Focus-refetch absence, target-level/goals/today conditional omissions, divide-by-zero guard, explicit "no write control" scope guard | LANG-PLAN-018…023 |
| Review | Scroll-surface absence, pre-reveal rating impossibility, counter semantics, pluralisation, the two distinct done states, rapid double-rate | LANG-REVIEW-020…025 |
| Assessment | Grading copy, `inputMode` tap-vs-type contract, retry-restarts-assessment, overall-proficiency card, null CEFR, empty strengths, progress clamp, back-during-grading | LANG-ASSESS-024…031 |
| Dialogue | Concurrent-generate race, pristine state, absent translation/vocab/tips branches, error recovery | LANG-DIAL-018…023 |
| Onboarding | Single-select semantics, motivations-optional path, replace-not-push, double-submit guard, id-vs-label contract, missing testID | LANG-ONBD-015…020 |
| More | Exact Alert button copy, header negative (no bell/avatar/switcher), no household surface, reset/local divergence, row-count inventory guard | LANG-MORE-021…025 |

Deliberately **not** added: rows for `assessment/topics`, `assessment/history`, `reviews/analytics`, `practice/*`, `teachers/*`, `push/*`, `learner/memory|skills|gamification/*`, `plan/all`, `plan/:id`, `cards` CRUD, `games`, `drive`, `voice`. These are shipped and partly tested at the API layer but have **zero FE consumer** — they belong in the flagged section (`FLAG-LANG-001/002/003/004/006/007/008/017`), not as scored UI rows. Adding them would violate the contract's "do not invent features not in this repo".

### 2.b DEPTH GAPS — rows present but not executable as written

Essentially every pre-existing row failed the contract's Steps/Expected bar. Representative patterns, all now fixed:

- **Expected stated the UI outcome only, never the data outcome.** `LANG-LEARN-018` read *"Checked; count increments"* — no mention that `language.daily.v1` is written. Now states the tint + checkmark, the strikethrough, the `0/3 → 1/3` counter, **and** the persistence key.
- **Steps named no control.** `LANG-PLAN-004` read *"Account without plan (404)"*. Now names the exact empty-state heading, body copy, and the **[ Start assessment ]** button.
- **Error copy was paraphrased, so it was unassertable.** `LANG-ASSESS-019` said *"Offline icon + Try again"*; the real string is `Could not start the assessment. Check your connection and try again.` Ten error/empty rows now carry verbatim copy — the only thing Maestro can match given `FLAG-LANG-014`.
- **VALIDATION family thin or absent.** Learn, Plan, Review, Dialogue, and Auth had no VALIDATION row at all. Added the real guard clauses: `toggleGoal` early-return on `!daily` (LANG-LEARN-035), the ratings row not existing before reveal so no POST is possible (LANG-REVIEW-021), divide-by-zero guards (LANG-PLAN-022, LANG-ASSESS-030), `draft.trim()` (LANG-TUTOR-026), empty/malformed credentials (LANG-AUTH-011/012).
- **CORNER family was mostly one row per screen.** Now covers pluralisation, null-safety, conditional-omission, race, cap, and persistence corners per screen.
- **Wrong control labels.** `LANG-ONBD-006` said *"Tap Travel 2. Tap Work"*; the chip is `Work & career`. `LANG-MORE-014` said *"Confirm destructive"*; the button is labelled `Reset`.

### 2.c INTEGRITY GAPS — bogus citations, verified on disk

Every automation path and BE path in the file was checked. Findings:

| # | Row(s) | Defect | Evidence | Fix applied |
|---|--------|--------|----------|-------------|
| INT-1 | `LANG-TUTOR-017` | **Asserted a control that does not exist.** The row tested "header back" on the Tutor screen. `LanguageTutorScreen.tsx:131` renders `ScreenHeader title="Tutor"` with no `showBackButton` — Tutor is a tab. | Read of the screen source | Rewritten as a negative/CANCEL row: no back chevron exists; exit is via the tab bar; assert no duplicate session POST on remount |
| INT-2 | `LANG-AUTH-002/004`, `LANG-PLAN-014/015/017`, `LANG-ASSESS-013/022`, `LANG-REVIEW-018`, `LANG-TUTOR-018`, `LANG-ONBD-014`, `LANG-MORE-019` | **12 rows cited `backend-language/` — a directory, not a test.** Unresolvable to a runnable file. | `ls backend-language/src/routes/` | Replaced with the real colocated test files (`auth.test.ts`, `reviews.test.ts`, `dialogues.test.ts`, `learner.test.ts`, `user.test.ts`, `progress.test.ts`, `assessmentScenarioMatrix.test.ts`, `learningPlanSchedule.test.ts`, `teachingChatSession.test.ts`); `gap` where no test file exists |
| INT-3 | `LANG-AUTH-003/005/006`, `LANG-TUTOR-003/019`, `LANG-REVIEW-019`, `LANG-ASSESS-023`, `LANG-MORE-020` | **Cited implementation files as automation** — `languageClient.ts`, `languageAuth.ts`, `languageTutor.ts`, `languageReviews.ts`, `languageAssessment.ts`, `languageProfile.ts`. Source files are not tests. | Files exist but are `src/features/language/api/*.ts` | Repointed to the real suites: `api/__tests__/languageClient.test.ts` (17 cases), `languageAuth.test.ts` (12), `languageApiWrappers.test.ts` (62); `gap` where no test covers the endpoint |
| INT-4 | `LANG-AUTH-009` | Cited "`authStore` tests". **No `src/stores/__tests__/authStore.test.ts` exists.** | `find src -ipath '*authStore*' -name '*test*'` → only `authStore.logout.test.ts`, `authStore.data-bridge.test.ts` | Repointed to `src/stores/__tests__/authStore.logout.test.ts` |
| INT-5 | `LANG-ONBD-013` | Cited bare `OnboardingNavigator.tsx`. Wrong-form path **and** an implementation file. | Real path `src/navigation/OnboardingNavigator.tsx` | Automation → `gap`; the real path moved into Notes |
| INT-6 | Header | Claimed **"160 scored rows"**; the file contained **180**. | `grep -c '^| LANG-'` | Row count is now an explicit, verified field (246) |
| INT-7 | Every `Layer: API` row | **`backend-language/package.json` defines no `"test"` script.** Unit tests run only via `tsx --test` on three enumerated file lists; ~27 of 57 `*.test.ts` files — including `auth`, `cards`, `reviews`, `user`, `learner`, `dialogues`, `practice` — are referenced by **no** script. Every API-layer row in this matrix is therefore ungated in CI. | `grep '"test' backend-language/package.json` | Documented as `FLAG-LANG-016` and called out in the Execution Groups footnote |
| INT-8 | `LANG-LEARN-006/007` | **Modelled two independent nav cards.** `LanguageLearnScreen.tsx:121-136` builds **one** conditional slot: `assessmentDue && !hasPlan ? assessment : plan`. The two cards can never both render. | Read of the screen source | Both rows rewritten as "slot 1" either/or; the missing third branch added as LANG-LEARN-033 |
| INT-9 | All `LANG-MORE-*`, `LANG-SHELL-*` | Described a "More tab" as though a `language-more` route existed. The route is `/settings` (`app/(tabs)/settings.tsx`). | Directory listing | Clarified in §0.1 and given its own row (LANG-SHELL-011) |
| INT-10 | `LANG-SMOKE-002`, `LANG-SHELL-004/005/006`, `LANG-MORE-018` | **Automation over-claimed.** All cited `more-settings.yaml` for pin/unpin. Reading the flow shows it only asserts `TabOverflowSection` is *visible* — it never pins anything and explicitly cancels both destructive Alerts. | Read of `e2e/maestro/language/more-settings.yaml` | Downgraded to `gap`; recorded as `FLAG-LANG-025` |
| INT-11 | `LANG-ASSESS-020/021` | Treated post-submit "Try again" as ordinary recovery. `boot()` calls `/assessment/start`, minting a **new session** — answered questions are abandoned. Real data loss. | `LanguageAssessmentScreen.tsx:55-71,88-91` | New row LANG-ASSESS-026 + `FLAG-LANG-021` |
| INT-12 | `LANG-REVIEW-016` | Said "silent (optimistic)" — understated. `void languageReviewsApi.submit(...).catch(() => undefined)` discards the rating with no retry, no queue, no feedback, while the UI advances. | `LanguageReviewScreen.tsx:63` | Expected rewritten to state the rating is *lost*; `FLAG-LANG-020` |

**Donor-feature check:** no pre-existing row asserted an unported donor feature. The former `FLAG-LANG-013` correctly fenced the Swift-only games hub, Drive browser, and voice studio. Retained and reinforced by the §1.2 verified-absence list.

**Malformed-markdown check:** the brief flagged a suspected stray row-schema header table injected near the section→tag table. **Not present in `language.md`.** The header block, section→tag table, and TOC were all well-formed. No malformed table was found anywhere in the file (verified by reading the full 392 lines before the rewrite). If that defect exists, it is in a sibling matrix, not this one.

---

## 3. Product risks surfaced by the audit

Six code-verified defects that are not test-harness problems. Each is now a scored row **and** a flagged entry, because each needs a product call before it can be graded pass/fail:

1. **Review ratings are fire-and-forget** (`FLAG-LANG-020`). A failed `POST /reviews` is swallowed; the card advances and the learner believes it was scheduled. The server disagrees. No retry, no offline queue.
2. **Assessment retry destroys progress** (`FLAG-LANG-021`). One shared `error` phase serves both boot and submit failures, and its **[ Try again ]** always restarts the session. A blip on question 9 of 10 sends the learner back to question 1.
3. **Onboarding completes even when the profile save fails** (`FLAG-LANG-023`). The `catch` is empty; `finally` calls `completeOnboarding()` regardless. The learner proceeds with no server-side `nativeLanguage` — the exact field `isLearnerOnboarded()` gates on.
4. **Offline is indistinguishable from empty** (`FLAG-LANG-018`). Plan and Review both map a failed GET to the same empty state a genuinely-empty account produces. An offline learner is told "No learning plan yet" with no retry affordance.
5. **Plan never refetches** (`FLAG-LANG-019`). Mount-only `useEffect`, no `useFocusEffect` (unlike Learn). As a tab that stays mounted, it can show a stale empty state after an assessment has generated a plan.
6. **Dialogue generation has no in-flight guard** (`FLAG-LANG-022`). Tapping a second scenario mid-request leaves two POSTs racing; the last to land wins regardless of which tile is highlighted.

Plus two structural risks: **zero per-control testIDs** (`FLAG-LANG-014`) makes deterministic assessment-answer automation impossible and makes `Review vocabulary` on Learn genuinely ambiguous to `tapOn`; and **`backend-language` has no CI test gate** (`FLAG-LANG-016`).

---

## 4. BE path verification

All 47 unique `/api/v1/*` paths cited in the matrix resolve to a real Hono route. Spot-verified mounts:

| Matrix path | Mount | Handler |
|-------------|-------|---------|
| POST `/api/v1/auth/login\|register\|refresh\|apple\|google\|forgot-password\|reset-password` | `app.route('/api/v1/auth', auth)` | `routes/auth.ts` |
| GET `/api/v1/assessment/status`, POST `/start`, `/smart-adaptive/next`, `/smart-adaptive/submit`, `/complete`, GET `/results` | `app.route('/api/v1/assessment', assessment)` | `routes/assessment.ts` |
| GET `/api/v1/plan`, POST `/plan/generate`, PUT `/plan`, POST `/plan/:planId/progress` | `app.route('/api/v1/plan', learningPlan)` | `routes/learningPlan.ts:197,131,630,514` |
| GET `/api/v1/cards/due` | `app.route('/api/v1/cards', cards)` | `routes/cards.ts` |
| POST `/api/v1/reviews`, GET `/reviews/history` | `app.route('/api/v1/reviews', reviews)` | `routes/reviews.ts` |
| POST `/api/v1/teaching-chat/sessions`, `/messages`, GET `/sessions/:sessionId/messages`, `/history` | `app.route('/api/v1/teaching-chat', teachingChat)` | `routes/teachingChat.ts` |
| GET/PUT `/api/v1/learner/profile`, GET `/learner/context` | `app.route('/api/v1/learner', learner)` | `routes/learner.ts` |
| GET `/api/v1/user/profile`, POST `/user/reset` | `app.route('/api/v1/user', user)` | `routes/user.ts` |
| POST `/api/v1/dialogues/generate` | `app.route('/api/v1/dialogues', dialogues)` | `routes/dialogues.ts` |
| GET `/api/v1/progress` | `app.route('/api/v1/progress', progress)` | `routes/progress.ts` |

**No wrong BE path was found** — the pre-existing matrix's endpoint column was accurate throughout. The integrity defects were all in the **Automation** column.

One structural finding worth recording: because `languageClient` hardcodes the `/api/v1` prefix, the Worker's **unprefixed** platform surface (`GET /features`, `/ai-access`, `/ai-models`, `/subscriptions/me`, `/ai-credentials/*`) and `/smart-engine/*` are unreachable through it. `LANG-MORE-009/010` navigate to `/ai-access` screens that rely on the shared axios client Language otherwise bypasses — verify they function in this brand before scoring (`FLAG-LANG-015`).

---

## 5. Automation coverage snapshot

| Layer | Assets | Notes |
|-------|--------|-------|
| Maestro | 9 flows + 8 subflows under `e2e/maestro/language/`; runner `scripts/e2e/run-language-suite.sh` (`npm run test:e2e:language:suite`) | Serial per `config.yaml` `flowsOrder`. `assessment` and `dialogue` are **not** smoke-tagged (`scripts/e2e/apply-maestro-tags.mjs:78-85`). Not hermetic — hits the live staging Worker. Four flows carry explicit `TODO(testIDs)` comments. |
| FE Jest | ~233 cases across 14 files under `src/features/language/` | 8 screen suites + 3 api suites + 3 feature/localStorage suites. **No test covers the 4 `app/(tabs)/language-*.tsx` route guards.** |
| Backend | 57 `*.test.ts`, **584** cases under `backend-language/src/` | **No `test` npm script.** ~27 files unreachable from any script. See `FLAG-LANG-016`. |

---

## 6. Outcome

| Metric | Before | After |
|--------|--------|-------|
| Scored rows | 180 (header claimed 160) | **246** |
| Flagged entries | 13 | **25** |
| Rows citing a non-existent or non-test automation path | **22** | 0 |
| Rows asserting a control that does not exist | **1** (`LANG-TUTOR-017`) | 0 |
| Sections with a complete LOAD/SCROLL/VISIBLE/INTERACT/MUTATION/CANCEL/VALIDATION/ERROR/CORNER family | 3 of 11 | **11 of 11** (documented absences where a family genuinely does not apply — e.g. LANG-REVIEW-020 records that Review has no scrollable surface) |
| Execution groups | 9, no fixtures or teardown | 9, with run order, fixture prerequisites, teardown, and an explicit exclusion list |
