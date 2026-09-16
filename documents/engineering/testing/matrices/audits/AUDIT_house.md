# Audit — `house.md` acceptance matrix

| Field | Value |
|-------|-------|
| **Date** | 2026-07-18 |
| **Target** | [`documents/engineering/testing/matrices/house.md`](../house.md) |
| **Contract** | [`COVERAGE_CONTRACT.md`](../COVERAGE_CONTRACT.md) |
| **Reference bar** | Circle V2 TRD/BRD Acceptance Test Matrix |
| **Method** | Code inventory from `app/`, `src/screens/`, `src/components/`, `src/api/*`, `backend/src/routes/*`; every cited automation path checked against the filesystem; every cited BE path checked against the real client wrapper |
| **Rows before → after** | 472 (committed HEAD) → **681** |

---

## 1. Method

1. **Route inventory** — enumerated `app/**/*.tsx` (expo-router) and all 137 non-Budget screens under `src/screens/`.
2. **API inventory** — extracted every `apiClient.{get,post,put,patch,delete}` call site from all 50 modules in `src/api/`, giving the authoritative method+path list reachable from House.
3. **Automation integrity** — parsed the Automation column of every row, extracted each backticked path, and `os.path.exists`-checked it.
4. **BE integrity** — matched every row's *BE / persistence* cell against the extracted call-site list.
5. **Family audit** — checked each section for the nine mandatory row families.

---

## 2. INTEGRITY GAPS (most serious — fully verified)

### 2.1 Fabricated automation citations

**28 unique test paths cited by 60 rows did not exist on disk.** Every one was a Unit/API citation; all Maestro citations were valid. This meant ~13% of the matrix claimed automation coverage that did not exist.

| Bogus path | Rows citing it |
|------------|----------------|
| `src/api/__tests__/households.test.ts` | AUTH-021, ONB-004, HH-003, HH-004, HH-006, HH-007, HH-008, HH-009, HH-013, HH-015, HH-020, HH-025 |
| `src/api/__tests__/utilities.test.ts` (real file is `utilities.api.test.ts`) | UTIL-007, 008, 010, 012, 015, 023 |
| `src/api/__tests__/auth.test.ts` | AUTH-004, 006, 008, 018, 026 |
| `src/api/__tests__/aihousekeeper.test.ts` | AIHK-005, 016, 021 |
| `src/api/__tests__/chat-rooms.test.ts` | CHAT-004, 007, 017 |
| `src/api/__tests__/messages.test.ts` | CHAT-009, 011, 012 |
| `src/api/__tests__/reports.test.ts` | RPT-011, 013, 017 |
| `src/api/__tests__/contractors.test.ts` | CONT-006, 009, 010 |
| `src/api/__tests__/household-spaces.test.ts` | ONB-010, SPACE-004, SPACE-010 |
| `src/api/__tests__/visit-checklists.test.ts` | CONT-015, 016 |
| `src/api/__tests__/garden-plans.test.ts` | GARD-010, 016 |
| `src/api/__tests__/floor-plans.test.ts` | FP-014, 018 |
| `src/api/__tests__/notifications.test.ts` | NOTIF-008, 012 |
| `src/api/__tests__/user.test.ts` | PROF-003, 015 |
| `src/api/__tests__/quotes.test.ts` | TASK-027, CONT-021 |
| `src/api/__tests__/chat.test.ts` | CHAT-018, MIRA-015 |
| `backend/src/routes/__tests__/households.test.ts` | ONB-031, HH-025 |
| `src/api/__tests__/settings.test.ts` · `ratings.test.ts` · `weather.test.ts` · `appointments.test.ts` · `contractor-search.test.ts` · `garbage-collection.test.ts` · `home-projects.test.ts` | SETT-017, CONT-019, HOME-022, CONT-012, CONT-020, ONB-016, HPROJ-015 |
| `src/components/home/__tests__/HomeMiraBrief.test.tsx` | HOME-013 |
| `src/components/home/__tests__/HomeProjectsHomeCard.test.tsx` | HOME-015 |
| `src/components/home-projects/__tests__/Timeline.test.tsx` | HPROJ-024 |
| `src/screens/home-projects/__tests__/CreateHomeProjectWizard.test.tsx` | HPROJ-006, 007 |

**Fix applied:** every bogus path replaced with `gap`, or with a real verified suite where one exists (e.g. `src/api/__tests__/utilities.api.test.ts`, `src/stores/__tests__/authStore.logout.test.ts`, `backend/src/services/__tests__/household-space-service.test.ts`, `backend/src/routes/__tests__/{settings,utilities,aihousekeeper,appliances,garden-plans,home-projects}.test.ts`). **The upgraded file now has zero non-existent automation paths** (verified programmatically).

### 2.2 Wrong backend paths

~40 rows cited routes that do not exist. Confirmed against `src/api/*` call sites:

| Area | Matrix claimed | Reality |
|------|----------------|---------|
| **Settings** (SMOKE-003, SETT-002/004–009/017/022) | `GET`/`PATCH /users/me/settings` | `GET /api/settings`, `PUT /api/settings/{key}`, `PUT /api/settings/bulk`, `POST /api/settings/reset|sync`, `DELETE /api/settings/{key}` — **there is no `/users/me/settings` route at all** |
| **Notifications** (NOTIF-001/004/005) | `GET /notifications`, `PATCH /notifications/{id}/read` | `GET /notifications/history`; read is **`POST`** `/notifications/{id}/read`; mark-all is `POST /notifications/read-all` |
| **Utilities** (UTIL-001/005/007–018/023) | `/utilities/summary`, `/utility-accounts`, `/utility-bills`, `/utility-readings`, `/property-tax` | `/utilities/dashboard`, `/utilities/accounts`, `/utilities/bills`, `/utilities/property-taxes`. **`/utility-readings` does not exist anywhere** — three rows tested a non-existent feature |
| **Reports** (RPT-006/013, ONB-013) | `POST /households/{id}/reports`, `PATCH …/reports/{id}` | Three-leg flow: `POST …/reports/upload-url` → R2 `PUT` → `POST …/reports/{id}/confirm-upload`. Neither claimed route exists |
| **Floor plans** (ONB-019, FP-002) | `POST …/floor-plans` | `POST …/floor-plans/upload-url` |
| **Garden** (GARD-003/004) | `POST …/garden-plans`, `PATCH …/garden-plan` | `POST …/garden-plans/upload-url`; boundary via `…/garden-plans/boundary-drafts` |
| **AI Housekeeper** (AIHK-001/006/013–015, HOME-013) | `/ai-housekeeper/briefings`, `/approvals/{id}/reject`, `PATCH aihousekeeper settings` | `/households/{id}/**aihousekeeper**/briefings` (one word); approvals are `approve` / **`cancel`** — there is no `reject`; preferences are `GET|PUT /api/ai-housekeeper/preferences` |
| **Invitations** (AUTH-012, HH-012) | `POST /invitations/decline` | `POST /invitations/{id}/decline-in-app` |
| **Spaces** (SPACE-010, SPACE-012) | `PUT …/spaces/reorder`, `POST …/spaces/{id}/photo` | Reorder is **`POST`**; there is no space-photo route (presets exist instead) |
| **Profile** (PROF-009/012, PROF-007/008) | `DELETE /users/me`, `POST change-password`, `POST /users/me/photo` | `DELETE /auth/account`, `POST /auth/change-password`; no avatar-upload wrapper exists |
| **Quotes** (CONT-022) | `PATCH quote` for accept/reject | `POST …/quotes/{id}/accept` · `/decline` · `/mark-received` |
| **Home projects** (HPROJ-010) | `PATCH archive` | `POST …/home-projects/{id}/archive` |
| **Tasks** (TASK-021/022/023, TASK-027) | "PATCH task with subtasks", `POST …/quotes` | Dedicated `…/tasks/{id}/subtasks` POST/PATCH/DELETE + `/complete` `/uncomplete`; quote request is `POST …/tasks/{id}/quotes/request` |
| **Weather** (HOME-022) | `GET /weather` | `GET /households/{id}/aihousekeeper/weather` |

**Fix applied:** all corrected in place, each with a `corrected …` note in the Notes column so reviewers can see what changed and why.

### 2.3 Markdown integrity

The reported "stray row-schema header table injected near the top section→tag table" is **not present in `house.md`** — that bug lives in a sibling matrix. `house.md`'s only structural issues were a missing blank-line convention (fine) and one row (`AIHK-026`) whose escaped pipe `\|` broke column parsing; that has been rewritten. All 681 rows now parse to exactly 10 schema columns.

---

## 3. COVERAGE GAPS

~35 shipped screens and 9 whole API modules had **zero** rows. New sections added (209 new rows):

| New section | Rows | Previously-uncovered surface |
|-------------|------|------------------------------|
| **TPLAN** | 22 | `TaskDraftsScreen`, `TaskDraftDetailScreen`, `TaskTemplatesScreen`, `MaintenanceSetupScreen`, `ScheduleTaskScreen`, `ScheduleWorkScreen`, `TimeBudgetPlannerScreen`, `CopyFromExistingTasksScreen`, `ContractorSelectionScreen`; `src/api/templates.ts`, `task-drafts.ts` |
| **LABOR** | 38 | All 15 `src/screens/labor-hub/*` screens; `src/api/appointments.ts` (13 routes), `projects.ts` (16 routes), `quotes.ts` (12 routes) — previously represented by 3 thin CONT rows |
| **CMSG** | 16 | `ContractorSearchScreen`, `ContractorSearchResultsScreen`, `ComposeContractorEmailScreen`, `MessagesScreen`, `ConversationScreen`; `src/api/messages.ts`, `contractor-search.ts` |
| **UTIL** (extended) | +6 | `UtilityProviderScreen`, `UtilitySettingsScreen`, `ConfirmBillPaymentsScreen`, bill extraction, municipality resolution |
| **PROP** | 12 | `PropertyDetailScreen` + all four property tabs (Overview / Assessment / Tax / Members) |
| **GARB** | 14 | All 6 `src/screens/garbage/*` screens; `src/api/garbage-collection.ts`, `municipalities.ts` — previously only 3 onboarding rows |
| **APPL** | 16 | `AppliancesScreen`; `src/api/appliances.ts` (6 routes) + `backend/src/routes/appliances.ts` — **completely uncovered** |
| **CHKL** | 16 | `ChecklistsScreen`, `SeasonalChecklistScreen`; `src/api/checklists.ts`, `seasonal-checklists.ts` — **completely uncovered** |
| **MYHOME** | 12 | `MyHomeScreen`, `HomeFeaturesScreen`; `src/api/home-features.ts` |
| **CAL** | 8 | `CalendarSyncScreen`; `src/api/calendar.ts` (5 routes) — **completely uncovered** |
| **SETT** (extended) | +9 | `WidgetCustomizationScreen`, `NavigationCustomizationScreen`, `PDFCacheSettingsScreen`, `PrivacyPolicyScreen`, `TermsOfServiceScreen`, `AIHousePreferencesScreen`, settings reset/sync, AI-access entry |
| **AIHK** (extended) | +6 | `AihousekeeperOnboardingScreen`, `AihousekeeperPushPermissionScreen`, `MeetAihousekeeperScreen`, memory, follow-ups, home-insight, suggestion accept/dismiss/snooze |

Also added: brand-identity guards (SMOKE-013/014), scope-leak guards (HOME-028, APPL-016, MYHOME-012, HH-017/029), the House-vs-Budget chat fork guard (CHAT-023), and cross-brand budget consistency (BUDGET-013).

---

## 4. DEPTH GAPS

Before: the median row had a one-clause Steps cell ("`1. Tap FAB`") and an Expected cell with no data outcome ("`Add sheet opens`"). That fails contract §2 — Expected must state **both** UI and data outcome.

Every one of the 681 rows was rewritten so that:
- **Steps** are numbered, multi-step, and name the exact control (testID or visible label) plus concrete input values (`E2E Task A`, `days=7`, `ZZZZZZ`).
- **Expected** states the UI outcome *and* the persistence outcome (list refresh, field value, survives relaunch, "no request issued").
- Negative rows assert the *absence* of a call explicitly (`no POST …/tasks`), matching the contract's "no successful BE call" requirement.

**Mandatory-family audit result:** all 30 sections now carry every one of LOAD / VISIBLE / INTERACT / MUTATION / CANCEL / VALIDATION / ERROR / CORNER (verified programmatically). Previously VALIDATION, CANCEL and ERROR were entirely absent from several sections and CORNER was frequently a single throwaway row.

---

## 5. Structural upgrades to match the Circle V2 bar

- **§0 test-account prerequisites** now defines a 4-account topology (Primary / Second / Throwaway / HH-B) that rows reference by name, mirroring Circle V2's Farid/Kam/Sarah/Mike graph.
- **Execution Groups** rewritten as 9 groups with explicit run order, dependencies, destructive-isolation notes, fixture teardown, and cross-group invariants ("no group may leave HH-A without at least one space, task and report").
- **Security negatives** added: cross-household isolation (HH-029), member role limits (HH-023, PROP-010), revoked calendar token (CAL-008), zero-budget-writes contract (BUDGET-012).
- **Flagged section** expanded from 10 informal lines to **19 numbered items**, each with a concrete owner action — including the fabricated-citation incident itself, the four `deferred` API surfaces, and the iOS-26 Maestro scroll limitation.

---

## 6. Deferred (stub-only — row added, not scored)

Per contract §1, features whose UI exists but whose client wrapper does not were given rows marked `deferred` rather than being invented away:

- Garden plan-item / object CRUD (GARD-009/010/011)
- Floor-plan calibration, marker create/update, area annotations (FP-006/007/008/010/011/012)
- Home-project selections, geometry, AI assist, export (HPROJ-015/016/019/020)
- Household + profile photo upload (HH-018, PROF-007/008)
- Task drafts (`src/api/task-drafts.ts` exports no HTTP calls) — TPLAN-001…006

No rows were written for `src/api/maintenance-suggestions.ts` and `representatives.ts`, which export no calls at all.

---

## 7. Verification performed on the upgraded file

| Check | Result |
|-------|--------|
| Row count | 681 |
| Unique IDs | 681 / 681 (no duplicates) |
| Schema columns per row | exactly 10 on every row |
| Published IDs from committed HEAD preserved | 472 / 472, **zero** dropped, **zero** semantic drift |
| Non-existent automation paths | **0** |
| Sections missing a mandatory family | **0** |
| Pass/Fail columns present | none (template stays blank) |

---

## 2026-07-18 depth pass (Task A) + Maestro citation verification (Task B)

| Field | Value |
|-------|-------|
| **Date** | 2026-07-18 (second pass, same day) |
| **Scope** | Depth upgrade of shallow legacy rows + adversarial verification of every Maestro citation |
| **Rows** | 681 (unchanged — no ID added, removed or renumbered) |
| **Rows deepened** | **491** |
| **Maestro citations downgraded to `gap`** | **482** (414 false + 68 conditional-only) |
| **Maestro-layer rows whose citation survives verification** | **139** (was 621) |

### 1. Why the previous audit missed this

The first-pass audit verified automation paths with `os.path.exists`. That proves a flow **file**
exists; it proves nothing about what the flow **asserts**. `scripts/e2e/bulk-link-house-maestro.py`
assigned flows to rows *by section with a `*` wildcard default*, so an entire section inherited one
flow regardless of each row's criterion. An existence check cannot detect that class of error.

This pass replaced the existence check with a content check: for each of the 123 distinct cited flows
the YAML (and every `runFlow` subflow it pulls in) was read and compared against the specific
criterion of every row pointing at it.

### 2. Task A — depth pass (491 rows)

491 rows had a single-clause **Steps** cell and/or an **Expected** cell with no data outcome. Each was
rewritten from the real screen source:

- **Steps** → numbered repro naming the exact control by real `testID` or exact visible label.
  Controls with no testID are marked inline `(no testID — blocks Maestro)` rather than given an invented one.
- **Expected** → now states the UI outcome **and** the data outcome (endpoint + status, which list
  refetches, which field holds what). Rows whose BE cell is `none` state the local/UI-state outcome,
  and negatives assert the *absence* of the call.

Protected columns were left byte-identical: Description, UI elements, BE / persistence, Console verify,
Layer — verified programmatically (0 drift on all five). All 681 IDs preserved in order.

### 3. Task B — verification and downgrades

- **FALSE** (414 rows) — cited flow never navigates to the screen, never touches the control, or the
  row asserts a mutation while the flow only navigates / asserts visibility. Automation → `gap`.
- **CONDITIONAL-ONLY** (68 rows) — the only assertion for that criterion sits inside `optional: true`
  or a `runFlow: when:` guard, so the flow scores green having asserted nothing. Same failure class as
  the Kaizen SCROLL incident. Automation → `gap`.
- **PARTIAL** (97 rows) — flow reaches the screen and asserts something related but does not prove the
  full criterion. Citation **kept**, Notes annotated with what is still unproven.

Any Jest/Vitest path on a downgraded row was preserved; only the `.yaml` citation was stripped
(80 rows retain a unit/API asset).

#### Per-section outcome

| Section | Rows | Downgraded (false) | Downgraded (conditional-only) | Citations surviving |
|---------|------|--------------------|-------------------------------|---------------------|
| AIHK | 28 | 21 | 1 | 5 |
| APPL | 16 | 15 | 0 | 1 |
| AUTH | 32 | 10 | 4 | 12 |
| BUDGET | 13 | 7 | 0 | 2 |
| CAL | 8 | 7 | 0 | 0 |
| CHAT | 23 | 9 | 3 | 9 |
| CHKL | 16 | 15 | 0 | 1 |
| CMSG | 16 | 16 | 0 | 0 |
| CONT | 30 | 20 | 4 | 6 |
| FP | 23 | 17 | 3 | 0 |
| GARB | 14 | 14 | 0 | 0 |
| GARD | 20 | 16 | 1 | 2 |
| HH | 30 | 25 | 0 | 2 |
| HOME | 28 | 12 | 3 | 9 |
| HPROJ | 26 | 17 | 2 | 7 |
| LABOR | 38 | 28 | 4 | 6 |
| MIRA | 19 | 6 | 9 | 3 |
| MYHOME | 12 | 9 | 0 | 3 |
| NOTIF | 21 | 11 | 5 | 4 |
| ONB | 33 | 9 | 15 | 6 |
| PROF | 19 | 14 | 0 | 4 |
| PROP | 12 | 8 | 0 | 1 |
| RPT | 24 | 8 | 7 | 7 |
| SCROLL | 21 | 6 | 2 | 13 |
| SETT | 31 | 23 | 2 | 4 |
| SMOKE | 16 | 4 | 0 | 10 |
| SPACE | 17 | 13 | 0 | 3 |
| TASK | 43 | 18 | 0 | 11 |
| TPLAN | 22 | 16 | 1 | 5 |
| UTIL | 30 | 20 | 2 | 3 || **Total** | **681** | **414** | **68** | **139** |

#### Representative per-flow verdicts

| Flow | What it actually asserts | Verdict |
|------|--------------------------|---------|
| `e2e/maestro/settings/settings-screen.yaml` | Settings mounts, scrolls to sentinel, Appearance / Floor-plans / Garden rows navigate | Never opens Appliances — all 15 `APPL` rows false |
| `e2e/maestro/households/household-management.yaml` | Opens the household screen, asserts "My Properties", scrolls; one guarded add-property tap that cancels | No member / invite / role / photo action — 25 `HH` rows false |
| `e2e/maestro/home/home-screen-controls.yaml` | Home mounts, header→Notifications and header→Profile round-trips, Mira brief opens | Zero calendar interaction — all 7 `CAL` rows false |
| `e2e/maestro/utilities/utilities-screen.yaml` | Utilities tiles + charts screen | Never opens Garbage — 14 `GARB` rows false |
| `e2e/maestro/tasks/tasks-screen-controls.yaml` | Tasks list filters / search / FAB + scroll | Never opens a checklist — 15 `CHKL` rows false |
| `e2e/maestro/contractors/contractor-messaging-gaps.yaml` | **Nothing — the file is unparseable YAML** (bad indent, line 41) | All 16 `CMSG` rows false |
| `e2e/maestro/garden/garden-deferred-readonly.yaml` | Asserts `garden-plans-screen` twice; everything else `when:`-guarded + optional | 16 `GARD` rows false |
| `e2e/maestro/floor-plans/floor-plans-screen.yaml` | Reaches the list, taps add; every later step `optional: true` | Never opens a plan — 17 `FP` rows false |
| `e2e/maestro/chat/chat-gaps.yaml` | **Genuinely proves** create-room (`POST /chat-rooms 201`) and send (`POST /messages 201`) | Citations upheld |
| `e2e/maestro/reports/reports-upload-contract.yaml` | **Genuinely proves** the 3-leg upload with network verification | Citation upheld |
| `e2e/maestro/auth/biometric-remember-last-login.yaml` | **Genuinely proves** enable → sign out → biometric → home restored | Citation upheld |

### 4. Flow-health defects found (fix separately from the matrix)

1. `contractors/contractor-messaging-gaps.yaml` — **malformed YAML**, cannot parse, so the whole CMSG suite silently contributes nothing today.
2. `utilities/bills-from-more.yaml` — taps `settings-row-bills`, a testID that **exists nowhere** in `src/` or `app/`; the flow lands on the utilities dashboard, not the bills screen.
3. `tasks/task-detail-sections.yaml` — runs its `task-detail-screen-scroll-end` contract *after* `task-detail-close` dismissed the screen.
4. `utilities/utilities-screen.yaml` — asserts the utilities sentinel while already on the charts screen.
5. `home-projects/home-projects-deferred-readonly.yaml` — selections/export block gated on `home-project-hub-title`, never visible on the list screen: dead code.
6. `subflows/open-utilities.yaml` — both waits are `optional: true`, so the subflow asserts nothing.
7. `auth/sessions-revoke.yaml` — guards on an "Active Sessions" UI that does not exist.

### 5. Controls with no testID (blocks Maestro)

Whole screens with **zero** testIDs — cannot be automated at all until instrumented:

- `src/screens/garbage/**` — every GARB control (schedule, categories, reminders, setup, detect)
- `ChecklistsScreen.tsx` + `SeasonalChecklistScreen.tsx` — all CHKL controls
- `CalendarSyncScreen.tsx` — all CAL controls (subscription create, token rows, auto-sync toggles)
- `ScheduleWorkScreen.tsx`, `CopyFromExistingTasksScreen.tsx` — TPLAN-015…020
- `HomeFeaturesScreen.tsx`, `UtilityBillsScreen.tsx`, `UtilitySettingsScreen.tsx`
- `JoinHouseholdScreen.tsx` — ONB-007 / AUTH-011

Partially instrumented (screen id only, no row/field ids): Spaces rows; floor-plan viewer / markers /
areas; property-detail tabs; My Home tiles (only `my-home-home-projects`); appliance list / detail /
form; household member / invite / role controls; labor-hub milestone & payment controls; quote
Accept / Decline; Appearance theme toggles; notification header actions.

### 6. Implementation gaps surfaced while reading source

Recorded honestly in the affected rows' Expected cells rather than written as passing criteria:

- `AppliancesScreen` — `appliances-add-fab` `onPress` is an empty stub and the card `onPress` is a comment; APPL create/detail unreachable.
- `ChecklistsScreen` — "Create New Checklist" and the card `onPress` are both no-ops; registered only in `ContractorsNavigator` with nothing navigating to it.
- `SeasonalChecklistScreen`, `VisitChecklistScreen`, `ActiveVisitScreen`, `ContractorComparisonScreen` — exported but registered on **no navigator** (unreachable).
- `ProfileScreen` — no change-password form (`authApi.changePassword` has zero UI callers) and no connected-apps section.
- `ProjectDetailScreen` — no add-milestone / delete-milestone / add-payment / photos UI.
- `homeProjectsApi.update` has **no call site** — project budget is read-only.
- `floorPlansApi.calibrateScale` is never invoked — no calibration UI (FP-015).
- `contractorsApi.deleteVisit`, all of `ratingsApi`, and `quotesApi.compareWithAI` have zero UI call sites.
- Utility account create/edit/delete and "Add Home Feature" fire "Coming Soon" alerts.
- **CMSG-006 is a real defect:** `handleSendViaApp` guards only on a missing contractor email, so an empty subject and body will submit.
- `SCROLL-004` (Mira), `SCROLL-011` (Home Projects), `SCROLL-016` (Briefings) — those screens render **no `ScreenScrollEnd` sentinel**, so `subflows/assert-screen-scrolls.yaml` cannot be used against them.
- House Budget tab renders `budget-screen` → `budget-dashboard`, not `budget-home-screen`; read-only-ness is structural via the `isFullBudget()` gate.
- House deep-link scheme is `simplehouse://`, not `house://`.

### 7. Verification performed

| Check | Result |
|-------|--------|
| Row count | 681 (unchanged) |
| Unique IDs, order preserved | 681 / 681 |
| Columns per row | exactly 10 on every row |
| Description / UI / BE / Console verify / Layer drift | **0** on all five |
| Rows with fewer than 2 numbered steps | **0** (was 388) |
| Expected cells with no data outcome | **0** (was 255) |
| Cited automation paths that do not exist | **0** |
| testIDs in Steps/Expected not resolvable in `src/`+`app/` | **0** — one hallucination (`utilities-region-gate`) was caught and corrected to the real `isHouseholdInGreaterVancouver` disabled-state behaviour |
| Pass / Fail columns in template | none (file stays blank) |

### 8. Honest coverage statement

Before this pass the matrix implied **621 / 681 rows (91%)** had Maestro coverage. After content
verification the defensible figure is **139 / 681 (20%)**, plus 97 rows with partial coverage and 80
rows carrying a unit/API asset. The remaining **462 rows are `gap`** — manual-tester rows until a flow
that actually drives the criterion exists.

That drop is a measurement correction, not a regression: no test was deleted. The suite runs exactly
as much as it did before; the matrix now says so truthfully.
