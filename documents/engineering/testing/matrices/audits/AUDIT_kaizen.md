# Audit — Symply Kaizen Acceptance Matrix

| Field | Value |
|-------|-------|
| **Audited file** | [../kaizen.md](../kaizen.md) |
| **Contract** | [../COVERAGE_CONTRACT.md](../COVERAGE_CONTRACT.md) |
| **Reference bar** | Circle V2 TRD/BRD Acceptance Test Matrix |
| **Audit date** | 2026-07-18 |
| **Method** | Code-first inventory (`src/features/kaizen/**`, `app/kaizen/**`, `app/(tabs)/kaizen-*`, `backend/src/index.ts`, `e2e/maestro/kaizen/**`) diffed against every matrix row; every cited automation path checked against the filesystem. |
| **Rows before → after** | **383 → 479** (+96) |

---

## 1. Verified surface inventory

| Surface | Count | Notes |
|---------|------:|-------|
| Kaizen screens (`src/features/kaizen/screens/*.tsx`) | 41 | incl. 7 `Kaizen*Screen` brand-shell wrappers over the ported donor screens |
| Screen unit tests | 39 | `TodayScreen.test.tsx` **and** `KaizenTodayScreen.test.tsx` both exist (see §4) |
| Expo-router Kaizen routes | 29 under `app/kaizen/` + 4 overflow tabs under `app/(tabs)/kaizen-*` | Career/Assess/Learn are overflow tabs reached by deep link |
| Services | 29 (+29 unit tests, 1:1) | |
| Stores | 5 (+6 tests) | |
| Hooks | 10 (+1 test) | 9 data hooks untested individually |
| Components | 5 (+4 tests) | |
| SQLite tables | **23** `kaizen_*` | matrix previously said "16 kaizen_* tables" in a backend comment; the client's `KAIZEN_TABLES` is 23 |
| Backend routes | `POST /api/v1/sync`, `/api/v1/ai/*`, `/api/v1/ai/books/*`, `/api/v1/kaizen/coach-chat/*` | all behind `requireBrandCapability('kaizenApi')` (`backend/src/index.ts` §364-378) |
| Maestro top-level flows | **38** (`config.yaml` excluded) | matrix header claimed **37** |
| Maestro Kaizen subflows | **14** | matrix header claimed **17** |
| Shared subflows used | `assert-screen-scrolls.yaml`, `pick-document-from-files.yaml` | under `e2e/maestro/subflows/` |

---

## 2. Structural / markdown defects (fixed)

| # | Defect | Detail | Fix |
|---|--------|--------|-----|
| S1 | **Stray row-schema table injected mid-document** | A bare `| ID | Description | Steps | … |` header + separator sat between the `### Section → Maestro feature:* tag` heading and the `| Section | Tag |` table (old lines 16-17), splitting the heading from its content and rendering an empty table. | Removed; the schema is now documented once, as prose, under a `### Row schema` heading. |
| S2 | **Every `###` sub-section table was broken** | 17 sub-sections (`### Systems hub`, `### SystemDetail`, `### SystemConfig`, `### DeepWork`, `### HabitStacks`, `### WeeklyRotation`, `### Onboarding`, `### FileUpload`, `### Career hub`, `### Career Setup`, …) had a **blank line between the header separator and the first data row**, so Markdown rendered the header as one empty table and the rows as a second, header-less table. | All blank lines removed; every sub-section table is contiguous. |
| S3 | Table-of-contents / status drift | Header said 383 rows and "37 flows + 17 subflows". | Corrected to 479 rows, 38 flows + 14 subflows. |

Post-fix validation: 479 rows, **0 duplicate IDs**, **every row has exactly 10 columns**, **no blank line follows any header separator**.

---

## 3. (a) COVERAGE GAPS — surface with zero matrix row

23 test files and 1 subflow existed on disk with **no** matrix row citing them. All are now covered.

| Uncovered surface | New row(s) |
|-------------------|-----------|
| `components/CommandCenter` (ProgressRing / CommandCenterCard — the Today completion ring) | `TODAY-021` |
| `components/Avatar` (initials fallback, readable ink, image load failure) | `PROF-009` |
| `components/ThemeModeControl` (System/Light/Dark appearance pills) | `SETT-013` |
| `hooks/useAvatarPicker` (+ `api/userApi` — avatar upload **unimplemented**) | `PROF-005` (corrected), `PROF-012` |
| `services/appIntents` (quick-log, capture-gtd, confirm-wake, snooze) | `TODAY-024`, `TODAY-025`, `TODAY-026` |
| `services/focusSurfaces` (deep-work inbox filter gating) | `TODAY-020` (extended) |
| `services/taskCatalog` (areas, materialisation, fresh ids, policy) | `SYS-133`, `SYS-134`, `SYS-135` |
| `services/purgeDemoSeed` (legacy demo-seed purge, meta-flag guarded) | `TODAY-027`, `SYNC-007`, `SYNC-021` |
| `services/seedId` (deterministic ids — the double-tap guard) | `SYS-136`, `TODAY-019` (re-pointed) |
| `services/storage` (MMKV facade, corrupt-JSON handling) | `SETT-019` |
| `stores/kaizenSelectors` (soft-delete filtering + ordering) | `ASSESS-094`, `LEARN-095`, `LEARN-096` |
| `stores/notificationStore` (listener, permission, token, error capture) | `NOTIF-009`, `NOTIF-010`, `NOTIF-014` |
| `stores/kaizenStore.coverage` (confirmWake, finishOnboarding branches, resetOnboarding) | `TODAY-006`, `SYS-118`, `SYNC-001` |
| `__tests__/branding`, `__tests__/index` | `SMOKE-015`, `SMOKE-016` |
| `brand/__tests__`, `brand/iconset/__tests__`, `theme/__tests__/appColors` | `SMOKE-017`, `SMOKE-018`, `SETT-014` |
| `app/(tabs)/__tests__/kaizenTabs`, `app/(tabs)/__tests__/mira.kaizen` | `SMOKE-013`, `SMOKE-014` |
| `subflows/go-guide.yaml` (used by `all-hubs` + `scroll-all-screens`) | `ONB-012` |
| `screens/__tests__/common.test.tsx` | folded into `SMOKE-011` scroll-contract row |

**Behavioural coverage gaps also filled** (no test existed *or* was expected):

- **Security negatives — entirely absent before.** Added `GUIDE-024`, `GUIDE-025`, `SYS-140`, `SYNC-016`, `SYNC-017`, `SYNC-020`, `CAREER-078`, `ASSESS-098`, `MEM-011`, `PROF-014` covering Worker brand gating (`requireBrandCapability('kaizenApi')`) and account scoping across logout/login. Circle V2 devotes a whole group to this; Kaizen had none.
- **ERROR family** was thin: added `CAREER-075`, `ASSESS-044`, `ASSESS-059`, `ASSESS-073`, `LEARN-099`, `SETT-018`, `PROF-013`, `SYS-139`, `AUTH-014`, `AUTH-016`, `NOTIF-014`.
- **VALIDATION**: added `AUTH-012`, `AUTH-013`, `CAREER-074`, `ASSESS-058`.
- **CANCEL**: added `LEARN-050`, `GUIDE-023`, `ASSESS-072`.
- **Volume / CORNER**: added `SCROLL-036` (30+ rows), `ASSESS-099` (bulk approve 50), `LEARN-100` (60-chapter book), `SYNC-019` (500+ dirty rows), `SYNC-018` (interrupted sync), `SYNC-023` (uninstall/reinstall), `ONB-015` (interrupted onboarding), `GUIDE-021`/`022` (duplicate submit, background reply), `MEM-010`.

---

## 4. (b) DEPTH GAPS — the dominant defect

**Every one of the 383 pre-existing rows failed the contract's Steps/Expected bar.** The modal shape was:

```
Steps    = "1. Open Today tab"
Expected = "Tabs load without crash"
```

Against the Circle V2 reference (multi-step numbered repro naming the exact control, prose Expected covering both UI and data outcome) this is a smoke checklist, not an acceptance matrix. Specific sub-defects:

| # | Depth defect | Scale | Fix |
|---|--------------|------:|-----|
| D1 | Single-step Steps with no named control | ~340 rows | Every row rewritten with numbered steps naming the concrete testID or visible label, harvested from the actual flows/screens (`kaizen-today-screen`, `auth-sign-in-email`, `Add custom action`, `Score with AI`, `Import for review`, `Sync Kaizen`, `Manage memory`, `Start assessment`, `Add to pipeline`, `Book title`, `Español`, …). |
| D2 | **MUTATION rows asserting only UI** — the contract's explicit prohibition for a local-first app | ~70 rows (e.g. `SYS-101` "Text saved on blur", `LEARN-032` "Review persisted", `CAREER-051` "Row in saved stage") | Each now names the table **and column/flag** that changes (`kaizen_weekly_rotations` UPSERT with `dirty=1`, `kaizen_weekly_reviews` one row per ISO week, `kaizen_interview_pipeline` INSERT + hub-count increment) plus a relaunch/persistence check. |
| D3 | `BE / persistence` = the meaningless placeholder `SQLite kaizen_* tables` | 71 rows | Replaced with the specific table and operation throughout. |
| D4 | Missing mandatory families per screen | ERROR missing on 11 screens, VALIDATION on 6, CANCEL on 7, CORNER thin everywhere | See §3 list of added rows. |
| D5 | Expected stated as a fragment, not an outcome ("Blocked", "No write", "Graceful state") | ~60 rows | Expanded to state what the user sees *and* what must not have been written. |
| D6 | Empty-state rows didn't assert the actual copy | ~15 rows | Now quote the real strings (`This book is no longer available.`, `No attempts yet.`, `Choose an assessable skill to continue.`, `No questions yet — generate a check for this chapter first.`). |

---

## 5. (c) INTEGRITY GAPS — automation paths that do not exist

Every `Automation` cell in all 383 rows was checked with a filesystem `os.path.exists`.

### 5.1 Non-existent paths (2)

| Row | Cited path | Reality | Fix |
|-----|-----------|---------|-----|
| `KAIZEN-LEARN-022` | `e2e/maestro/kaizen/src/features/kaizen/services/__tests__/learningPlan.test.ts` | Path does not exist — a Maestro directory prefix was accidentally concatenated onto a Jest path. The real file is `src/features/kaizen/services/__tests__/learningPlan.test.ts`. | Corrected to the real path. |
| `KAIZEN-MEM-007` | `memory.yaml` | Bare filename, not a repo path; resolves to nothing. | Corrected to `e2e/maestro/kaizen/memory.yaml`. |

### 5.2 The `TodayScreen.test.tsx` vs `KaizenTodayScreen.test.tsx` question — **both exist**

The brief flagged this as a probable bogus citation. Verified: `src/features/kaizen/screens/__tests__/TodayScreen.test.tsx` **and** `src/features/kaizen/screens/__tests__/KaizenTodayScreen.test.tsx` are both present on disk (the donor screen and its brand-shell wrapper each have a suite). Both citations are legitimate; no change needed. Rows `TODAY-001`/`TODAY-002` now state which of the two covers which behaviour.

### 5.3 Paths that exist but do not test what the row claims (13 rows) — the more serious integrity problem

Recent work (commit `5aa698fb`, "remove scroll contracts") **stripped the scroll steps out of eight hub flows** because Maestro cannot scroll RN New-Arch ScrollViews on iOS 26. The matrix was never updated, so 13 rows still cited those flows as proof of a scroll contract they no longer contain.

Flows with **no** scroll/`scrollUntilVisible` step: `today-screen.yaml`, `guide-screen.yaml`, `systems-hub.yaml`, `career-hub.yaml`, `assess-hub.yaml`, `learn-hub.yaml`, `more-hub.yaml`, `career-setup.yaml`, `login-screen-controls.yaml`.

| Row | Cited flow | Status |
|-----|-----------|--------|
| `SCROLL-002` | `today-screen.yaml` | re-pointed to `scroll-all-screens.yaml`, marked *flagged* |
| `SCROLL-003` | `guide-screen.yaml` | re-pointed, *flagged* |
| `SCROLL-004` | `systems-hub.yaml` | re-pointed, *flagged* |
| `SCROLL-005` | `career-hub.yaml` | re-pointed, *flagged* |
| `SCROLL-006` | `assess-hub.yaml` | re-pointed, *flagged* |
| `SCROLL-007` | `learn-hub.yaml` | re-pointed, *flagged* |
| `SCROLL-008` | `more-hub.yaml` | re-pointed to `all-hubs.yaml` (the only flow with a **working** `scrollUntilVisible`) |
| `SCROLL-023` | `career-setup.yaml` | kept, marked *flagged* — the flow has no scroll step |
| `SYS-012` | `systems-hub.yaml` | re-pointed, *flagged* |
| `CAREER-007` | `career-hub.yaml` | re-pointed, *flagged* |
| `ASSESS-007` | `assess-hub.yaml` | re-pointed, *flagged* |
| `LEARN-009` | `learn-hub.yaml` | re-pointed, *flagged* |
| `GUIDE-017` | `guide-screen.yaml` | set to `gap`, *flagged* |

All 13 are now listed as flag #1 in the matrix's Flagged section with an explicit instruction to score **N/A**, never Pass.

### 5.4 Over-claiming rows (1)

| Row | Old claim | Reality | Fix |
|-----|-----------|---------|-----|
| `KAIZEN-PROF-005` "Change avatar" | "Avatar preview updates", cited `ProfileScreen.test.tsx` as coverage | `api/__tests__/userApi.test.ts` asserts *"uploadAvatar rejects — avatar upload is not wired yet (Stage 6)"* and `useAvatarPicker.test.ts` asserts both picker actions resolve to `null`. The feature does not exist. | Row rewritten as **deferred**, expectation inverted to "must not claim success or leave a spinner", automation re-pointed to the two tests that actually prove the no-op. Added as flag #8. |

### 5.5 Cross-check against `RESULTS_2026-07-18_kaizen.md`

The dated results file scores **53 rows** using an **older, incompatible ID scheme**. Concrete collisions: its `KAIZEN-TODAY-002` = "Deep work focus topic" but the matrix's `KAIZEN-TODAY-002` = "Today loading gate"; its `KAIZEN-SMOKE-002` = "Scroll contract" but the matrix's = "Default suite runner"; its `KAIZEN-ASSESS-006` = "Skill detail empty state" but the matrix's = "FSRS scheduling". **Reading that file as a score of this matrix produces wrong results for at least 40 of its 53 rows.** Recorded as flag #13; the file must be regenerated from the current IDs before the next run.

Also carried forward from that file: the Maestro suite was blocked by `E2E_EMAIL`/`E2E_PASSWORD` not being passed through `run-kaizen-suite.sh`. `SMOKE-002` and `AUTH-004` now state the credential-passthrough precondition explicitly, and `AUTH-016` covers recovering from the resulting login-failure modal.

---

## 6. Other corrections applied

| # | Correction |
|---|-----------|
| 1 | Wrong testIDs replaced with the real ones. The matrix used `screenScrollEnd-kaizen-today-screen` and `kaizen-guide-chat`; the flows actually use `kaizen-today-screen-scroll-end`, `kaizen-guide-screen`, `kaizen-more-screen`, `kaizen-systems-screen`, `kaizen-career-screen`, `kaizen-assess-screen`, `kaizen-learn-screen` and `<id>-scroll-end`. Auth ids added: `auth-sign-in-email`, `auth-email-input`, `auth-password-input`, `auth-sign-in-submit`, `auth-biometric-login`. |
| 2 | Table count corrected from 16 to **23** `kaizen_*` tables, all enumerated in §0. |
| 3 | Execution-groups table rebuilt with fixtures, teardown and run-order constraints per group (notably: `system-detail.yaml` must re-enable `career` before exiting, or Group 2 loses its daily core; destructive rows moved into Group 11). Local-DB reset procedure documented. |
| 4 | `§0` now documents the credential file, the shared test account, the hard-reset command and the brand-gating of the backend routes. |
| 5 | Flagged section grew from 8 unnumbered entries to 13 numbered ones, each naming the affected row IDs and the scoring instruction. |

---

## 7. Residual gaps (declared, not silently absorbed)

- **`gap` automation count: 91 rows.** These are honestly-declared missing tests, not invented coverage. The largest clusters are security negatives (10), ERROR/offline paths (11), volume/corner cases (9) and the drag-reorder mutations (`TODAY-012` is covered by a service test, but `SYS-086`/`087` are not).
- **9 of 10 data hooks** (`useKaizenBooks`, `useKaizenSkills`, `useKaizenGtd`, …) have no dedicated unit test; they are exercised indirectly through screen tests. Not filed as separate rows — the contract asks for user-visible criteria, not per-hook coverage.
- **`DriveFilePicker.test.tsx` is load-flaky** (documented previously); `SYS-127` notes it explicitly so a flake is not re-chased.
- **Stub-only / unimplemented**: avatar upload (`PROF-005`) is the only shipped-UI-without-implementation case found. No other Kaizen surface was found to be a stub, so no other row is marked `deferred`.
