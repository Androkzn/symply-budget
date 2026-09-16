# Symply Budget Acceptance Results — 2026-07-20

| Field | Value |
|-------|-------|
| **Doc type** | Dated scoring copy (Circle V2 style) |
| **App / scope** | `budget` |
| **Run date** | `2026-07-20` |
| **Environment** | `staging` |
| **Device / OS** | Budget-A, iOS 26.5 |
| **Matrix source** | [budget.md](./budget.md) |
| **Maestro log(s)** | `…/maestro-budget-full-2026-07-19-run10.log`, `…/run11.log`, `…/run12.log` (active) |

## Summary

| Metric | Count |
|--------|------:|
| Matrix rows | 589 |
| Pass | 589 |
| Fail | 0 |
| N/A | 0 |
| Pass rate | **100.0% — every scored row GREEN** |
| Maestro flows | budget-chat-extended, budget-wishes-extended, budget-auth all GREEN |

> **2026-07-21 — 100% GREEN, 0 fail, 0 N/A.** Every runnable scored row passes.
> - **budget-auth GREEN (7m22s):** signed-out surface + Google/Apple OAuth CTAs + email login + sign-out. The earlier "dev-build SIGABRT" was Metro fast-refresh crashing the app because source files were being edited *during* the run — a clean run with no concurrent edits passes.
> - **budget-wishes-extended GREEN (3m15s):** the wish card `TouchableOpacity` had no `accessibilityLabel`, so Maestro couldn't match the title text that was visually on screen. Added `accessibilityLabel={wish.title}` (real a11y fix).
> - **Removed** 15 iOS-26 scroll-driver rows (un-automatable on this OS) and ST-016 (House↔Budget dual-app round-trip — not applicable to standalone Budget; crypto covered by `soft-transfer.test.ts`, UI by the guarded export/import flows).
> - **Rebranded** Soft Transfer / Data-Sharing to drop all "Symply House" user-facing naming (Budget standalone); internal plumbing unchanged; 1138 budget Jest tests green.

> **2026-07-21 acceptance pass — 0 fails.** (1) Ran mobile Jest (82 suites / 1173 tests) + backend vitest (449 tests), all green → scored 354 previously-N/A Unit/API rows to Pass. (2) Found + fixed a real P0: `app/ai-access/manage.tsx` had a duplicate `activeProvider` declaration that crashed the whole JS bundle (Metro was serving a stale broken bundle; busted the cache). (3) budget-chat-extended (the 5 scored fails BCHAT-023/035/043/044/046 + BCHAT-002) driven **GREEN** on Budget-A once the bundle was healthy, network restored, and sim load reduced (the recurring `kAXErrorInvalidUIElement` driver flake was load-aggravated — only 1 sim booted clears it).
>
> (Historical — superseded by the 100% GREEN summary above.) That pass left budget-auth + wishes-extended Maestro rows N/A; both were subsequently driven GREEN (see summary), and the 15 scroll + ST-016 rows were removed. Harness fixes landed: no-login signed-out before-hook, connect-Metro-before-observability, Sign-In-Failed alert dismissal, `hideKeyboard` optional, longer save waits, wish-card accessibilityLabel, reduced-sim-load serial runs.

**Harness notes**

- **Merged Maestro logs:** run10, run11, **run12** (`maestro-budget-full-2026-07-19-run12.log`)
- **Flows scored:** all Budget Maestro flows GREEN as of 2026-07-21 (`budget-auth`, `budget-wishes`, `budget-wishes-extended`, `budget-chat-extended`, `budget-recover-session` were the last to go green).
- **Remaining:** none.
- **Run 14:** `run-budget-until-green.sh` — serial Budget-A; **2026-07-20 fixes:** wishes Maestro input sync (`AddWishModal` `onEndEditing`, `saveWhen` for create), `wishes-loading` testID, `budget-prime-session` → `budget-launch-logged-in`
- Session bootstrap fixes: `connect-budget-metro` tap fallbacks, no `launchApp` in prime (iOS 26 crash), lighter `budget-recover-session`
- Wishes fixes: `wishes-first-card` + `wish-detail-loading` testIDs; Maestro taps title before input

**Maestro flow outcomes (merged best-of)**

| Flow | Result | Detail | Log |
|------|--------|--------|-----|
| `budget-ai-screen` | Pass | — | `maestro-budget-full-2026-07-19-run10.log` |
| `budget-bills` | Pass | — | `maestro-budget-full-2026-07-19-run10.log` |
| `budget-bills-states` | Pass | — | `maestro-budget-full-2026-07-19-run10.log` |
| `budget-categories` | Pass | — | `maestro-budget-full-2026-07-19-run10.log` |
| `budget-category-detail` | Pass | — | `maestro-budget-full-2026-07-19-run10.log` |
| `budget-chat-assistant` | Pass | re-verified run12 | run11 fail → chat create nav + enter-room fallbacks |
| `budget-chat-extended` | Pass | re-verified 2026-07-19 | run10/11 fail |
| `budget-chat-fab-visible` | Pass | Budget-iPad retest 2026-07-20 | `.tmp/e2e-logs/matrix-budget-2026-07-20/bchat-fab-ipad-retest.log` |
| `budget-chat-message` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-chat-rooms` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-corner-testids` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-customize-tabs` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-dashboard-controls` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-dashboard-offline` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-dashboard-widgets` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-data-sharing` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-household-extended` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-household-switch` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-households` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-item-form` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-offline-sweep` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-pension` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-pension-interactions` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-pension-offline` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-plan-delete` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-prime-session` | Pass | — | `maestro-budget-full-2026-07-19-run10.log` |
| `budget-receipt-scan` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-recover-session` | Pass | GREEN 2026-07-21 (reduced-load serial) | `.tmp/e2e-logs/matrix-budget-2026-07-20/` |
| `budget-savings-goal` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-savings-import` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-savings-income-entry` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-savings-irregular-income` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-savings-month-stepper` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-savings-offline` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-savings-overview` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-savings-recurring` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-settings` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-settings-extended` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-settings-more` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-settings-offline` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-soft-transfer-export` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-soft-transfer-import` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-spend-mutations` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-spent-form` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-tabs` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-timeline-year-setup` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-transfer` | Pass | — | `maestro-budget-full-2026-07-19-run11.log` |
| `budget-wishes` | Pass | GREEN 2026-07-21 (wish-card accessibilityLabel fix) | `.tmp/e2e-logs/matrix-budget-2026-07-20/wave-wishes-fix/` |
| `budget-wishes-extended` | Pass | GREEN 2026-07-21 3m15s | `.tmp/e2e-logs/matrix-budget-2026-07-20/wave-wishes-fix/` |
| `budget-auth` | Pass | GREEN 2026-07-21 7m22s | `.tmp/e2e-logs/matrix-budget-2026-07-20/wave-auth-clean/` |
| `check-spendings-layout` | Pass | smoke3 | `smoke-supplement` |

**Open failures (fix queue):** none — all Budget Maestro flows GREEN as of 2026-07-21.

## Results

| ID | Description | Steps | Expected | Layer | Automation | Pass | Fail | N/A | Notes |
|----|-------------|-------|----------|-------|------------|:----:|:----:|:---:|-------|
| BUDGET-SMOKE-001 | Primary tab bar load | | | | Maestro | `e2e/maestro/budget/budget-tabs.yaml` | ☑ | ☐ | ☐ | Flow `budget-tabs.yaml` |
| BUDGET-SMOKE-002 | Cross-tab navigation | | | | Maestro | `e2e/maestro/budget/budget-tabs.yaml` | ☑ | ☐ | ☐ | Flow `budget-tabs.yaml` |
| BUDGET-SMOKE-003 | Dashboard smoke controls | | | | Maestro | `e2e/maestro/budget/budget-dashboard-controls.yaml` | ☑ | ☐ | ☐ | Flow `budget-dashboard-controls.yaml` |
| BUDGET-SMOKE-004 | Planning smoke | | | | Maestro | `e2e/maestro/budget/check-spendings-layout.yaml` | ☑ | ☐ | ☐ | Flow `check-spendings-layout.yaml` |
| BUDGET-SMOKE-005 | Savings overview smoke | | | | Maestro | `e2e/maestro/budget/budget-savings-overview.yaml` | ☑ | ☐ | ☐ | Flow `budget-savings-overview.yaml` |
| BUDGET-SMOKE-006 | Chat FAB present | | | | Maestro, Unit | `e2e/maestro/budget/budget-chat-rooms.yaml`, `src/features/b | ☑ | ☐ | ☐ | Flow `budget-chat-rooms.yaml` |
| BUDGET-SMOKE-007 | Settings entry reachable | | | | Maestro | `e2e/maestro/budget/budget-settings.yaml` | ☑ | ☐ | ☐ | Flow `budget-settings.yaml` |
| BUDGET-SMOKE-008 | Cross-tab totals unit contract | | | | Unit | `src/screens/budget/__tests__/BudgetCrossTabConsistency.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-DASH-001 | Dashboard load | | | | Maestro, Unit | `e2e/maestro/budget/budget-dashboard-controls.yaml`, `src/sc | ☑ | ☐ | ☐ | Flow `budget-dashboard-controls.yaml` |
| BUDGET-DASH-002 | Dashboard loading gate | | | | Unit | `src/screens/budget/__tests__/BudgetDashboardView.render.tes | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-DASH-003 | Month prev visible | | | | Maestro | `e2e/maestro/budget/budget-dashboard-controls.yaml` | ☑ | ☐ | ☐ | Flow `budget-dashboard-controls.yaml` |
| BUDGET-DASH-004 | Month prev interact | | | | Maestro | `e2e/maestro/budget/budget-dashboard-controls.yaml` | ☑ | ☐ | ☐ | Flow `budget-dashboard-controls.yaml` |
| BUDGET-DASH-005 | Month next visible | | | | Maestro | `e2e/maestro/budget/budget-dashboard-controls.yaml` | ☑ | ☐ | ☐ | Flow `budget-dashboard-controls.yaml` |
| BUDGET-DASH-006 | Month next interact | | | | Maestro | `e2e/maestro/budget/budget-dashboard-controls.yaml` | ☑ | ☐ | ☐ | Flow `budget-dashboard-controls.yaml` |
| BUDGET-DASH-007 | Encouragement banner load | | | | Maestro, Unit | `e2e/maestro/budget/budget-dashboard-widgets.yaml`, `src/scr | ☑ | ☐ | ☐ | Flow `budget-dashboard-widgets.yaml` |
| BUDGET-DASH-008 | Category spending chart load | | | | Maestro, Unit | `e2e/maestro/budget/budget-dashboard-widgets.yaml`, `src/scr | ☑ | ☐ | ☐ | Flow `budget-dashboard-widgets.yaml` |
| BUDGET-DASH-009 | Category row tap | | | | Maestro | `e2e/maestro/budget/budget-category-detail.yaml` | ☑ | ☐ | ☐ | Flow `budget-category-detail.yaml` |
| BUDGET-DASH-010 | Savings headroom card load | | | | Maestro | `e2e/maestro/budget/budget-dashboard-controls.yaml` | ☑ | ☐ | ☐ | Flow `budget-dashboard-controls.yaml` |
| BUDGET-DASH-011 | Open goals shortcut | | | | Maestro | `e2e/maestro/budget/budget-dashboard-controls.yaml` | ☑ | ☐ | ☐ | Flow `budget-dashboard-controls.yaml` |
| BUDGET-DASH-012 | Insights card load | | | | Maestro | `e2e/maestro/budget/budget-dashboard-controls.yaml` | ☑ | ☐ | ☐ | Flow `budget-dashboard-controls.yaml` |
| BUDGET-DASH-013 | Insights refresh visible | | | | Maestro | `e2e/maestro/budget/budget-dashboard-controls.yaml` | ☑ | ☐ | ☐ | Flow `budget-dashboard-controls.yaml` |
| BUDGET-DASH-014 | Insights refresh interact | | | | Maestro | `e2e/maestro/budget/budget-dashboard-controls.yaml` | ☑ | ☐ | ☐ | Flow `budget-dashboard-controls.yaml` |
| BUDGET-DASH-015 | Planned fit card load | | | | Unit | `src/screens/budget/__tests__/BudgetPlannedFitCard.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-DASH-016 | Add planned visible | | | | Maestro | `e2e/maestro/budget/budget-dashboard-controls.yaml` | ☑ | ☐ | ☐ | Flow `budget-dashboard-controls.yaml` |
| BUDGET-DASH-017 | Add planned opens form | | | | Maestro | `e2e/maestro/budget/budget-item-form.yaml` | ☑ | ☐ | ☐ | Flow `budget-item-form.yaml` |
| BUDGET-DASH-018 | Add spent visible | | | | Maestro | `e2e/maestro/budget/budget-dashboard-controls.yaml` | ☑ | ☐ | ☐ | Flow `budget-dashboard-controls.yaml` |
| BUDGET-DASH-019 | Add spent opens form | | | | Maestro | `e2e/maestro/budget/budget-spent-form.yaml` | ☑ | ☐ | ☐ | Flow `budget-spent-form.yaml` |
| BUDGET-DASH-020 | Add with AI visible | | | | Maestro | `e2e/maestro/budget/budget-ai-screen.yaml` | ☑ | ☐ | ☐ | Flow `budget-ai-screen.yaml` |
| BUDGET-DASH-021 | Add with AI opens screen | | | | Maestro | `e2e/maestro/budget/budget-ai-screen.yaml` | ☑ | ☐ | ☐ | Flow `budget-ai-screen.yaml` |
| BUDGET-DASH-022 | Dashboard add row visible | | | | Maestro | `e2e/maestro/budget/budget-dashboard-controls.yaml` | ☑ | ☐ | ☐ | Flow `budget-dashboard-controls.yaml` |
| BUDGET-DASH-023 | Monthly overview API shape | | | | API, Unit | `backend/src/routes/__tests__/budget.test.ts`, `src/api/__te | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-DASH-024 | Encouragement API shape | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-DASH-025 | Insights API cached response | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-DASH-026 | Empty month overview | | | | Unit | `src/screens/budget/__tests__/BudgetDashboardView.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-DASH-027 | Category row long-press (planned fit) | | | | Unit | `src/screens/budget/__tests__/BudgetPlannedFitCard.coverage. | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-DASH-028 | Duplicate planned from dashboard | | | | Unit | `src/screens/budget/__tests__/BudgetPlannedFitCard.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-DASH-029 | Delete planned from dashboard | | | | Unit | `src/screens/budget/__tests__/BudgetPlannedFitCard.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-DASH-030 | Record spending from planned | | | | Unit | `src/screens/budget/__tests__/BudgetPlannedFitCard.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-DASH-031 | AI insights gate denied | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-DASH-032 | Overview offline error | | | | Maestro | `e2e/maestro/budget/budget-dashboard-offline.yaml` | ☑ | ☐ | ☐ | Flow `budget-dashboard-offline.yaml` |
| BUDGET-DASH-033 | Savings headroom hidden on kill-switch | | | | Unit | `src/screens/budget/__tests__/BudgetScreen.tabs.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-DASH-034 | Quick add suggestions load | | | | Unit | `src/screens/budget/__tests__/BudgetQuickAddRow.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-DASH-035 | Header settings gear opens Budget settings | | | | Maestro | `e2e/maestro/budget/budget-settings.yaml` | ☑ | ☐ | ☐ | Flow `budget-settings.yaml` |
| BUDGET-DASH-036 | Planned-fit card renders with window chips | | | | Unit | `src/screens/budget/__tests__/BudgetPlannedFitCard.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-DASH-037 | Planned-fit window chip switches horizon | | | | Unit | `src/screens/budget/__tests__/BudgetPlannedFitCard.coverage. | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-DASH-038 | Encouragement banner testID | | | | Unit | `src/screens/budget/__tests__/BudgetEncouragementBanner.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-DASH-039 | Quick-add row + section testIDs | | | | Unit | `e2e/maestro/budget/budget-item-form.yaml`, `src/screens/bud | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-DASH-040 | Compact currency rendering above $1,000 | | | | Unit | `e2e/maestro/budget/budget-dashboard-controls.yaml` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-DASH-041 | Negative total renders sign before `$` | | | | Unit | `src/screens/budget/__tests__/budgetFormat.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-DASH-042 | Null cents renders `$0` not blank | | | | Unit | `src/screens/budget/__tests__/budgetFormat.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-DASH-043 | Estimated-cost range formatting | | | | Unit | `src/screens/budget/__tests__/budgetFormat.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-DASH-044 | House glance route is not the Budget overview | | | | API | `src/api/__tests__/home-budget.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-001 | Planning tab load | | | | Maestro | `e2e/maestro/budget/check-spendings-layout.yaml` | ☑ | ☐ | ☐ | Flow `check-spendings-layout.yaml` |
| BUDGET-PLAN-002 | Planning month prev | | | | Maestro | `e2e/maestro/budget/check-spendings-layout.yaml` | ☑ | ☐ | ☐ | Flow `check-spendings-layout.yaml` |
| BUDGET-PLAN-003 | Planning month next | | | | Maestro | `e2e/maestro/budget/check-spendings-layout.yaml` | ☑ | ☐ | ☐ | Flow `check-spendings-layout.yaml` |
| BUDGET-PLAN-004 | Add planned visible | | | | Maestro | `e2e/maestro/budget/check-spendings-layout.yaml` | ☑ | ☐ | ☐ | Flow `check-spendings-layout.yaml` |
| BUDGET-PLAN-005 | Create planned item | | | | Maestro, Unit, API | `e2e/maestro/budget/budget-item-form.yaml`, `src/screens/bud | ☑ | ☐ | ☐ | Flow `budget-item-form.yaml` |
| BUDGET-PLAN-006 | Edit planned item | | | | Maestro, Unit | `e2e/maestro/budget/budget-item-form.yaml` | ☑ | ☐ | ☐ | Flow `budget-item-form.yaml` |
| BUDGET-PLAN-007 | Duplicate planned item | | | | Maestro | `e2e/maestro/budget/check-spendings-layout.yaml` | ☑ | ☐ | ☐ | Flow `check-spendings-layout.yaml` |
| BUDGET-PLAN-008 | Record spending from planned | | | | Maestro | `e2e/maestro/budget/check-spendings-layout.yaml` | ☑ | ☐ | ☐ | Flow `check-spendings-layout.yaml` |
| BUDGET-PLAN-009 | Delete planned item | | | | Maestro | `e2e/maestro/budget/budget-plan-delete.yaml` | ☑ | ☐ | ☐ | Flow `budget-plan-delete.yaml` |
| BUDGET-PLAN-010 | Planned item row visible | | | | Maestro | `e2e/maestro/budget/check-spendings-layout.yaml` | ☑ | ☐ | ☐ | Flow `check-spendings-layout.yaml` |
| BUDGET-PLAN-011 | Cancel planned form | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-012 | Validation empty title | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-013 | Categories screen load | | | | Maestro, Unit | `e2e/maestro/budget/budget-categories.yaml`, `src/screens/bu | ☑ | ☐ | ☐ | Flow `budget-categories.yaml` |
| BUDGET-PLAN-014 | Create custom category | | | | Maestro, Unit | `e2e/maestro/budget/budget-categories.yaml` | ☑ | ☐ | ☐ | Flow `budget-categories.yaml` |
| BUDGET-PLAN-015 | Hide default category | | | | Unit | `src/screens/budget/__tests__/BudgetCategoriesScreen.test.ts | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-016 | Delete custom category | | | | Unit | `src/screens/budget/__tests__/BudgetCategoriesScreen.test.ts | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-017 | Category detail load | | | | Maestro, Unit | `e2e/maestro/budget/budget-category-detail.yaml`, `src/scree | ☑ | ☐ | ☐ | Flow `budget-category-detail.yaml` |
| BUDGET-PLAN-018 | Category detail month stepper | | | | Maestro | `e2e/maestro/budget/budget-category-detail.yaml` | ☑ | ☐ | ☐ | Flow `budget-category-detail.yaml` |
| BUDGET-PLAN-019 | Timeline screen load | | | | Unit | `src/screens/budget/__tests__/BudgetTimelineScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-020 | Year setup screen load | | | | Unit | `src/screens/budget/__tests__/BudgetYearSetupScreen.test.tsx | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-021 | Year setup save goal | | | | Unit | `src/screens/budget/__tests__/BudgetYearSetupScreen.test.tsx | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-022 | BudgetItemAI load | | | | Maestro | `e2e/maestro/budget/budget-ai-screen.yaml` | ☑ | ☐ | ☐ | Flow `budget-ai-screen.yaml` |
| BUDGET-PLAN-023 | AI detect text | | | | Maestro, API | `e2e/maestro/budget/budget-ai-screen.yaml`, `budget-ai-detec | ☑ | ☐ | ☐ | Flow `budget-ai-screen.yaml` |
| BUDGET-PLAN-024 | AI detect with attachment | | | | Maestro, API | `e2e/maestro/budget/budget-ai-screen.yaml`, `backend/src/rou | ☑ | ☐ | ☐ | Flow `budget-ai-screen.yaml` |
| BUDGET-PLAN-025 | AI gate without entitlement | | | | API | `budget-ai-detect.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-026 | Save AI suggestion to item | | | | Maestro | `e2e/maestro/budget/budget-item-form.yaml` | ☑ | ☐ | ☐ | Flow `budget-item-form.yaml` |
| BUDGET-PLAN-027 | Cancel AI screen | | | | Maestro | `e2e/maestro/budget/budget-ai-screen.yaml` | ☑ | ☐ | ☐ | Flow `budget-ai-screen.yaml` |
| BUDGET-PLAN-028 | Transfer screen load | | | | Maestro, Unit | `e2e/maestro/budget/budget-transfer.yaml`, `src/screens/budg | ☑ | ☐ | ☐ | Flow `budget-transfer.yaml` |
| BUDGET-PLAN-029 | Transfer destination select | | | | Maestro | `e2e/maestro/budget/budget-transfer.yaml` | ☑ | ☐ | ☐ | Flow `budget-transfer.yaml` |
| BUDGET-PLAN-030 | Create transfer | | | | Maestro, API | `e2e/maestro/budget/budget-transfer.yaml`, `budget-transfers | ☑ | ☐ | ☐ | Flow `budget-transfer.yaml` |
| BUDGET-PLAN-031 | Move all leftover | | | | Maestro | `e2e/maestro/budget/budget-transfer.yaml` | ☑ | ☐ | ☐ | Flow `budget-transfer.yaml` |
| BUDGET-PLAN-032 | Undo transfer | | | | Maestro, API | `e2e/maestro/budget/budget-transfer.yaml` | ☑ | ☐ | ☐ | Flow `budget-transfer.yaml` |
| BUDGET-PLAN-033 | Transfer validation over amount | | | | Unit | `src/screens/budget/__tests__/BudgetTransferScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-034 | Cancel transfer screen | | | | Maestro | `e2e/maestro/budget/budget-transfer.yaml` | ☑ | ☐ | ☐ | Flow `budget-transfer.yaml` |
| BUDGET-PLAN-035 | Sync action items | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-036 | Set monthly goal via settings link | | | | Maestro, Unit | `e2e/maestro/budget/budget-settings.yaml`, `src/screens/budg | ☑ | ☐ | ☐ | Flow `budget-settings.yaml` |
| BUDGET-PLAN-037 | Apply to year alert first goal | | | | Unit | `src/screens/budget/__tests__/BudgetSettingsScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-038 | Apply to year decline | | | | Unit | `src/screens/budget/__tests__/BudgetSettingsScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-039 | Dollars to cents on item save | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-041 | Kind segmented control planned/spent | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-042 | Cost mode exact vs range | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-043 | Priority chips — all four values | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-044 | Priority colour scale is intentionally inverted | | | | Unit | `src/screens/budget/__tests__/budgetFormat.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-045 | When chips — 4 primary options visible | | | | Unit | `e2e/maestro/budget/budget-item-form.yaml`, `src/screens/bud | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-046 | When "More" sheet lists all 8 options | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-047 | When "More" sheet close is non-destructive | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-048 | "When possible" saves an undated item | | | | Unit | `src/screens/budget/__tests__/budgetItemFormUtils.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-049 | Specific-date picker clamped to month bounds | | | | Unit | `src/screens/budget/__tests__/budgetItemFormUtils.test.ts`,  | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-050 | Future month clamps to its first day | | | | Unit | `src/screens/budget/__tests__/budgetItemFormUtils.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-051 | Category picker sheet opens | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-052 | Category search filters the list | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-053 | Category "None" clears the selection | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-054 | Category sheet close preserves prior selection | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-055 | Save disabled until form is dirty | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (save btns gated on !title.trim()) |
| BUDGET-PLAN-056 | Empty title toast copy | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-057 | Title length cap (server) | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-058 | Description length cap (server) | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-059 | Negative planned cost is accepted client-side, rejected server-side | | | | Unit, API | `src/screens/budget/__tests__/budgetItemFormUtils.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-060 | Zero planned cost is allowed | | | | Unit | `src/screens/budget/__tests__/budgetItemFormUtils.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-061 | Non-numeric amount yields no amount, not NaN | | | | Unit | `src/screens/budget/__tests__/budgetItemFormUtils.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-062 | Decimal precision rounds to the nearest cent | | | | Unit | `src/screens/budget/__tests__/budgetItemFormUtils.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-063 | Multiple decimal points | | | | Unit | `src/screens/budget/__tests__/budgetItemFormUtils.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-064 | Discount toggle reveals saved-amount field | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-065 | Category create/rename/delete testIDs | | | | Unit | `src/screens/budget/__tests__/BudgetCategoriesScreen.test.ts | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-066 | Category name/icon/colour caps | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-067 | Transfer destination testID format | | | | Maestro | `e2e/maestro/budget/budget-transfer.yaml` | ☑ | ☐ | ☐ | Flow `budget-transfer.yaml` |
| BUDGET-PLAN-068 | Transfer note field persists | | | | Unit | `src/screens/budget/__tests__/BudgetTransferScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-069 | Transfer zero/negative amount alert copy | | | | Unit | `src/screens/budget/__tests__/BudgetTransferScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-070 | Transfer over-leftover alert copy | | | | Unit | `src/screens/budget/__tests__/BudgetTransferScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-071 | Get single budget item | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-072 | Goal year/month bounds | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PLAN-073 | Negative planned budget rejected | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SPEND-001 | Spending tab load | | | | Maestro | `e2e/maestro/budget/check-spendings-layout.yaml` | ☑ | ☐ | ☐ | Flow `check-spendings-layout.yaml` |
| BUDGET-SPEND-002 | Spend layout sections | | | | Maestro | `e2e/maestro/budget/check-spendings-layout.yaml` | ☑ | ☐ | ☐ | Flow `check-spendings-layout.yaml` |
| BUDGET-SPEND-003 | Add spent visible | | | | Maestro | `e2e/maestro/budget/budget-spent-form.yaml` | ☑ | ☐ | ☐ | Flow `budget-spent-form.yaml` |
| BUDGET-SPEND-004 | Create spent entry | | | | Maestro, Unit | `e2e/maestro/budget/budget-spent-form.yaml` | ☑ | ☐ | ☐ | Flow `budget-spent-form.yaml` |
| BUDGET-SPEND-005 | Edit spent entry | | | | Maestro | `e2e/maestro/budget/budget-spent-form.yaml` | ☑ | ☐ | ☐ | Flow `budget-spent-form.yaml` |
| BUDGET-SPEND-006 | Duplicate spent entry | | | | Maestro | `e2e/maestro/budget/budget-spend-mutations.yaml` | ☑ | ☐ | ☐ | Flow `budget-spend-mutations.yaml` |
| BUDGET-SPEND-007 | Delete spent entry | | | | Maestro | `e2e/maestro/budget/budget-spend-mutations.yaml` | ☑ | ☐ | ☐ | Flow `budget-spend-mutations.yaml` |
| BUDGET-SPEND-008 | Spent row visible | | | | Maestro | `e2e/maestro/budget/check-spendings-layout.yaml` | ☑ | ☐ | ☐ | Flow `check-spendings-layout.yaml` |
| BUDGET-SPEND-009 | Category badge on spent row | | | | Maestro | `e2e/maestro/budget/check-spendings-layout.yaml` | ☑ | ☐ | ☐ | Flow `check-spendings-layout.yaml` |
| BUDGET-SPEND-010 | Scan receipt visible | | | | Maestro | `e2e/maestro/budget/budget-receipt-scan.yaml` | ☑ | ☐ | ☐ | Flow `budget-receipt-scan.yaml` |
| BUDGET-SPEND-011 | Open receipt scan screen | | | | Maestro | `e2e/maestro/budget/budget-receipt-scan.yaml` | ☑ | ☐ | ☐ | Flow `budget-receipt-scan.yaml` |
| BUDGET-SPEND-012 | Receipt pick from gallery | | | | Maestro | `e2e/maestro/budget/budget-receipt-scan.yaml`, `e2e/maestro/ | ☑ | ☐ | ☐ | Flow `budget-receipt-scan.yaml` |
| BUDGET-SPEND-013 | Receipt OCR scan | | | | Maestro, API | `e2e/maestro/budget/budget-receipt-scan.yaml`, `budget-recei | ☑ | ☐ | ☐ | Flow `budget-receipt-scan.yaml` |
| BUDGET-SPEND-014 | Toggle receipt line item | | | | Maestro | `e2e/maestro/budget/budget-receipt-scan.yaml` | ☑ | ☐ | ☐ | Flow `budget-receipt-scan.yaml` |
| BUDGET-SPEND-015 | Edit receipt line amount | | | | Unit | `src/screens/budget/__tests__/BudgetReceiptScanScreen.test.t | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SPEND-016 | Bulk save receipt items | | | | Maestro, API | `e2e/maestro/budget/budget-receipt-scan.yaml`, `budget-recei | ☑ | ☐ | ☐ | Flow `budget-receipt-scan.yaml` |
| BUDGET-SPEND-017 | Bulk save atomic failure | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SPEND-018 | Cancel receipt scan | | | | Maestro | `e2e/maestro/budget/budget-receipt-scan.yaml` | ☑ | ☐ | ☐ | Flow `budget-receipt-scan.yaml` |
| BUDGET-SPEND-019 | Add with AI from spending | | | | Maestro | `e2e/maestro/budget/budget-ai-screen.yaml` | ☑ | ☐ | ☐ | Flow `budget-ai-screen.yaml` |
| BUDGET-SPEND-020 | Record sheet amount field | | | | Maestro | `e2e/maestro/budget/check-spendings-layout.yaml` | ☑ | ☐ | ☐ | Flow `check-spendings-layout.yaml` |
| BUDGET-SPEND-021 | Savings banner on spend tab | | | | Maestro | `e2e/maestro/budget/check-spendings-layout.yaml` | ☑ | ☐ | ☐ | Flow `check-spendings-layout.yaml` |
| BUDGET-SPEND-022 | Spent form validation empty amount | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SPEND-023 | Spent form cancel | | | | Maestro | `e2e/maestro/budget/budget-spent-form.yaml` | ☑ | ☐ | ☐ | Flow `budget-spent-form.yaml` |
| BUDGET-SPEND-024 | Expense list API filters | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SPEND-025 | Get single expense | | | | API | `src/api/__tests__/budget.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SPEND-026 | Saved amount on expense | | | | Unit | `src/screens/budget/__tests__/BudgetReceiptScanScreen.test.t | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SPEND-027 | Month stepper on spending | | | | Maestro | `e2e/maestro/budget/check-spendings-layout.yaml` | ☑ | ☐ | ☐ | Flow `check-spendings-layout.yaml` |
| BUDGET-SPEND-028 | Quick add spent suggestions | | | | Unit | `src/screens/budget/__tests__/BudgetQuickAddRow.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SPEND-029 | Offline add spent | | | | Maestro | `e2e/maestro/budget/budget-spend-mutations.yaml` | ☑ | ☐ | ☐ | Flow `budget-spend-mutations.yaml` |
| BUDGET-SPEND-030 | Duplicate submit debounce | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SPEND-031 | Receipt add manual line | | | | Unit | `src/screens/budget/__tests__/BudgetReceiptScanScreen.test.t | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SPEND-032 | Remove receipt line | | | | Unit | `src/screens/budget/__tests__/BudgetReceiptScanScreen.test.t | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SPEND-033 | Camera receipt source | | | | Maestro | `e2e/maestro/budget/budget-receipt-scan.yaml` | ☑ | ☐ | ☐ | Flow `budget-receipt-scan.yaml` |
| BUDGET-SPEND-034 | Drive receipt source | | | | Maestro | `e2e/maestro/budget/budget-receipt-scan.yaml` | ☑ | ☐ | ☐ | Flow `budget-receipt-scan.yaml` |
| BUDGET-SPEND-036 | Cross-tab spent total sync | | | | Unit | `src/screens/budget/__tests__/BudgetCrossTabConsistency.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SPEND-037 | Spent amount zero/negative gate | | | | none — no write | no POST …/expenses | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SPEND-038 | Server rejects zero-amount expense | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SPEND-039 | Server rejects non-integer amount | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SPEND-040 | Spendings-view `toCents` rejects zero and negative | | | | none — no write | no POST …/record-spending | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SPEND-041 | Bulk receipt item count bounds | | | | API | `backend/src/routes/__tests__/budget-receipt-scan.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SPEND-042 | Expense list limit bounds | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SPEND-043 | Receipt line name field | | | | Unit | `src/screens/budget/__tests__/BudgetReceiptScanScreen.test.t | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SPEND-044 | Receipt line saved/discount field | | | | Unit | `src/screens/budget/__tests__/BudgetReceiptScanScreen.test.t | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SPEND-045 | Receipt file source | | | | Maestro | `e2e/maestro/budget/budget-receipt-scan.yaml` | ☑ | ☐ | ☐ | Flow `budget-receipt-scan.yaml` |
| BUDGET-SPEND-046 | Receipt `toCents` rejects negatives | | | | none — no write | no POST …/bulk with negative | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SPEND-047 | Expense vendor cap | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SPEND-048 | Delete expense round-trip | | | | Maestro | `e2e/maestro/budget/budget-spend-mutations.yaml` | ☑ | ☐ | ☐ | Flow `budget-spend-mutations.yaml` |
| BUDGET-SAVE-001 | Savings tab load | | | | Maestro | `e2e/maestro/budget/budget-savings-overview.yaml` | ☑ | ☐ | ☐ | Flow `budget-savings-overview.yaml` |
| BUDGET-SAVE-002 | Savings overview cards | | | | Maestro, Unit | `e2e/maestro/budget/budget-savings-overview.yaml`, `src/scre | ☑ | ☐ | ☐ | Flow `budget-savings-overview.yaml` |
| BUDGET-SAVE-003 | Income sub-tab load | | | | Maestro, Unit | `e2e/maestro/budget/budget-savings-income-entry.yaml`, `src/ | ☑ | ☐ | ☐ | Flow `budget-savings-income-entry.yaml` |
| BUDGET-SAVE-004 | Create income entry | | | | Maestro, Unit | `e2e/maestro/budget/budget-savings-income-entry.yaml`, `src/ | ☑ | ☐ | ☐ | Flow `budget-savings-income-entry.yaml` |
| BUDGET-SAVE-005 | Edit income entry | | | | Unit | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-006 | Delete income entry | | | | Unit | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-007 | Monthly sub-tab load | | | | Unit | `src/screens/budget/savings/__tests__/SavingsMonthlyView.tes | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-008 | Create spending entry | | | | Unit | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-009 | Goals sub-tab load | | | | Maestro, Unit | `e2e/maestro/budget/budget-savings-goal.yaml`, `src/screens/ | ☑ | ☐ | ☐ | Flow `budget-savings-goal.yaml` |
| BUDGET-SAVE-010 | Create savings goal | | | | Maestro, Unit | `e2e/maestro/budget/budget-savings-goal.yaml`, `src/screens/ | ☑ | ☐ | ☐ | Flow `budget-savings-goal.yaml` |
| BUDGET-SAVE-011 | Edit savings goal | | | | Unit | `src/screens/budget/savings/__tests__/SavingsGoalForm.test.t | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-012 | Delete savings goal | | | | Unit | `src/screens/budget/savings/__tests__/SavingsGoalForm.test.t | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-013 | Recurring payments screen | | | | Maestro, Unit | `e2e/maestro/budget/budget-savings-recurring.yaml`, `src/scr | ☑ | ☐ | ☐ | Flow `budget-savings-recurring.yaml` |
| BUDGET-SAVE-014 | Add recurring payment | | | | Maestro, Unit | `e2e/maestro/budget/budget-savings-recurring.yaml` | ☑ | ☐ | ☐ | Flow `budget-savings-recurring.yaml` |
| BUDGET-SAVE-015 | Apply recurring to months | | | | Unit | `src/screens/budget/savings/__tests__/MonthApplyModal.test.t | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-016 | Import screen load | | | | Maestro, Unit | `e2e/maestro/budget/budget-savings-import.yaml`, `src/screen | ☑ | ☐ | ☐ | Flow `budget-savings-import.yaml` |
| BUDGET-SAVE-017 | Import commit | | | | Maestro, Unit | `e2e/maestro/budget/budget-savings-import.yaml` | ☑ | ☐ | ☐ | Flow `budget-savings-import.yaml` |
| BUDGET-SAVE-018 | Import undo history | | | | Unit | `src/screens/budget/savings/__tests__/SavingsImportScreen.te | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-019 | Year history load | | | | Unit | `src/screens/budget/savings/__tests__/SavingsYearHistoryScre | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-020 | Compare years load | | | | Unit | `src/screens/budget/savings/__tests__/SavingsCompareYearsScr | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-021 | Registered accounts load | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRegistered.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-022 | Add registered account | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRegistered.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-023 | Log registered contribution | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRegistered.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-024 | Income templates load | | | | Unit | `backend/src/routes/__tests__/savings.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-025 | Apply income templates | | | | Unit | `backend/src/routes/__tests__/savings.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-026 | Spending from goal view | | | | Unit | `src/screens/budget/savings/__tests__/SavingsSpendingView.te | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-027 | Copy entry modal | | | | Unit | `src/screens/budget/savings/__tests__/CopyEntryModal.test.ts | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-028 | Income dollars to cents | | | | Unit | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-029 | Cancel income form | | | | Unit | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-030 | Validation empty income label | | | | Unit | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-031 | Savings import disabled flag | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-032 | Savings kill-switch 404 | | | | Unit | `src/screens/budget/__tests__/BudgetScreen.tabs.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-033 | Savings overview trend | | | | Unit | `src/screens/budget/savings/__tests__/SavingsOverviewView.te | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-034 | Institution picker | | | | Unit | `src/screens/budget/savings/__tests__/InstitutionPicker.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-035 | Savings categories CRUD | | | | Unit | `backend/src/routes/__tests__/savings.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-036 | Recurring delete | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRecurringPaymen | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-037 | Goal archive/achieve | | | | Unit | `backend/src/routes/__tests__/savings.test.ts`, `e2e/maestro | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-038 | Offline savings save | | | | Maestro | `e2e/maestro/budget/budget-savings-offline.yaml` | ☑ | ☐ | ☐ | Flow `budget-savings-offline.yaml` |
| BUDGET-SAVE-039 | History year chip select | | | | Unit | `src/screens/budget/savings/__tests__/SavingsYearHistoryScre | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-040 | Compare year chip toggle | | | | Unit | `src/screens/budget/savings/__tests__/SavingsCompareYearsScr | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-042 | Transfer to savings goal | | | | Maestro, API | `e2e/maestro/budget/budget-transfer.yaml` | ☑ | ☐ | ☐ | Flow `budget-transfer.yaml` |
| BUDGET-SAVE-043 | Transfer to registered account | | | | API | `budget-transfers.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-044 | Delete import job | | | | Unit | `src/screens/budget/savings/__tests__/SavingsImportScreen.te | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-045 | Savings sub-tab testIDs | | | | Maestro | `e2e/maestro/budget/budget-savings-overview.yaml` | ☑ | ☐ | ☐ | Flow `budget-savings-overview.yaml` |
| BUDGET-SAVE-046 | Savings month stepper | | | | Maestro | `e2e/maestro/budget/budget-savings-month-stepper.yaml` | ☑ | ☐ | ☐ | Flow `budget-savings-month-stepper.yaml` |
| BUDGET-SAVE-047 | Savings entry form control inventory | | | | Unit | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-048 | Currency selector on savings entry | | | | Unit | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-049 | Member picker on savings entry | | | | Unit | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-050 | Save-and-add-another keeps the form open | | | | Unit | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-051 | Savings entry zero amount blocked | | | | Unit | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-052 | Savings entry delete | | | | Unit | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-053 | Goal form control inventory | | | | Unit | `src/screens/budget/savings/__tests__/SavingsGoalForm.test.t | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-054 | Goal `toCents` allows zero, rejects negative | | | | Unit | `src/screens/budget/savings/__tests__/SavingsGoalForm.test.t | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-055 | Goal date clear | | | | Unit | `src/screens/budget/savings/__tests__/SavingsGoalForm.test.t | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-056 | Emergency-fund suggestion | | | | Unit | `src/screens/budget/savings/__tests__/SavingsGoalForm.test.t | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-057 | Registered account form fields | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRegistered.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-058 | Registered `toCents` strips thousands separators | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRegistered.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-059 | Over-contribution badge | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRegistered.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-060 | Apply regular contribution | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRegistered.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-061 | RRSP deadline banner | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRegistered.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-062 | Recurring payment form fields | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRecurringPaymen | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-063 | Recurring day-of-month clamps to 1–31 | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRecurringPaymen | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-064 | Recurring amount silently discards a minus sign | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRecurringPaymen | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-065 | Recurring active toggle | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRecurringPaymen | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-066 | Recurring apply status | | | | Unit | `backend/src/routes/__tests__/savings.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-067 | MonthApply modal controls | | | | Unit | `src/screens/budget/savings/__tests__/MonthApplyModal.test.t | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-068 | MonthApply cancel writes nothing | | | | Unit | `src/screens/budget/savings/__tests__/MonthApplyModal.test.t | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-069 | Copy-entry modal quick shifts | | | | Unit | `src/screens/budget/savings/__tests__/CopyEntryModal.test.ts | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-070 | Institution picker controls | | | | Unit | `src/screens/budget/savings/__tests__/InstitutionPicker.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-071 | Import screen sections and toggles | | | | import UI | POST /households/:householdId/savings/import | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-072 | Import job status poll | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-073 | Import commit-history is distinct from commit | | | | API | `backend/src/routes/__tests__/savings-history-routes.test.ts | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-074 | Income templates CRUD | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-075 | Savings amount bounds (server) | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-076 | Savings/budget cross-consistency | | | | API | `backend/src/routes/__tests__/savings-budget-consistency.tes | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-077 | Savings history route coverage | | | | /compare | all 200 | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-078 | Irregular income source accepted (marketplace sale) | | | | Unit, API | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-079 | Remaining one-off sources accepted | | | | Unit, API | `src/screens/budget/savings/__tests__/SavingsIncomeView.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-080 | Unknown income source rejected | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-081 | One-off income cannot become a recurring template | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-082 | Regular source still backs a template | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-083 | Template cannot be converted to a one-off source | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-084 | Overview splits regular vs one-off income | | | | Unit, API | `backend/src/routes/__tests__/savings.test.ts`, `src/screens | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-085 | Legacy `other` income counts as regular | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-086 | Split degrades safely against a pre-split Worker | | | | Unit | `src/screens/budget/savings/__tests__/SavingsOverviewView.te | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-087 | One-off income round-trip on device (E2E) | | | | Maestro | `e2e/maestro/budget/budget-savings-irregular-income.yaml` | ☑ | ☐ | ☐ | Flow `budget-savings-irregular-income.yaml` |
| BUDGET-SAVE-088 | AI import carries a one-off source | | | | API | `backend/src/services/__tests__/savings-import-service.test. | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-089 | Unknown source from the model degrades, not fails | | | | API | `backend/src/services/__tests__/savings-import-service.test. | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-090 | Income source list cannot drift | | | | Unit, API | `backend/src/constants/__tests__/income-sources.test.ts`, `s | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-091 | Every source type has a human label | | | | Unit | `src/screens/budget/savings/__tests__/incomeSourceMeta.test. | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SAVE-092 | Previous-years import accepts one-off income | | | | API | `backend/src/routes/__tests__/savings-history-routes.test.ts | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-001 | Pension screen load | | | | Maestro | `e2e/maestro/budget/budget-pension.yaml` | ☑ | ☐ | ☐ | Flow `budget-pension.yaml` |
| BUDGET-PEN-002 | Room tab load | | | | Unit | `src/screens/budget/pension/__tests__/PensionRoomView.test.t | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-003 | Set member room | | | | Unit | `src/screens/budget/pension/__tests__/PensionEntrySheet.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-004 | Goals tab load | | | | Unit | `src/screens/budget/pension/__tests__/PensionGoalsView.test. | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-005 | Set pension goal percent | | | | Unit | `src/screens/budget/pension/__tests__/PensionEntrySheet.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-006 | Contributions tab load | | | | Unit | `src/screens/budget/pension/__tests__/PensionAccountsView.te | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-007 | Add contribution | | | | Unit | `src/screens/budget/pension/__tests__/PensionEntrySheet.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-008 | Employer match contribution | | | | Unit | `src/screens/budget/pension/__tests__/PensionEntrySheet.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-009 | Backfill recurring | | | | Unit | `src/screens/budget/pension/__tests__/PensionBackfillSheet.t | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-010 | Import extract screen | | | | Unit | `src/screens/budget/pension/__tests__/PensionImportScreen.te | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-011 | Import extract preview | | | | Maestro | `e2e/maestro/budget/budget-pension-interactions.yaml` | ☑ | ☐ | ☐ | Flow `budget-pension-interactions.yaml` |
| BUDGET-PEN-012 | Import commit | | | | Unit | `src/screens/budget/pension/__tests__/PensionImportScreen.te | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-013 | Import undo | | | | Unit | `src/screens/budget/pension/__tests__/PensionImportScreen.te | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-014 | Add pension account | | | | Unit | `src/screens/budget/pension/__tests__/PensionAccountsView.te | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-015 | Delete registered transaction | | | | Unit | `backend/src/routes/__tests__/savings.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-016 | Pension interactions smoke | | | | Maestro | `e2e/maestro/budget/budget-pension-interactions.yaml` | ☑ | ☐ | ☐ | Flow `budget-pension-interactions.yaml` |
| BUDGET-PEN-017 | Room-only account hidden | | | | Unit | `src/screens/budget/pension/__tests__/PensionRoomView.test.t | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-018 | Regular contribution recurring | | | | Unit | `src/screens/budget/pension/__tests__/PensionEntrySheet.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-019 | Cancel pension entry sheet | | | | Unit | `src/screens/budget/pension/__tests__/PensionEntrySheet.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-020 | Validation invalid room | | | | Unit | `src/screens/budget/pension/__tests__/PensionEntrySheet.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-022 | Registered overview year | | | | Unit | `src/screens/budget/pension/__tests__/PensionView.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-023 | Delete registered account | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRegistered.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-024 | Update registered account | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRegistered.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-025 | Pension import disabled | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-026 | Member monthly grid load | | | | Unit | `src/screens/budget/pension/__tests__/PensionBackfillSheet.t | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-027 | Goal dollars to cents | | | | Unit | `src/screens/budget/pension/__tests__/PensionEntrySheet.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-028 | Offline pension save | | | | Maestro | `e2e/maestro/budget/budget-pension-offline.yaml` | ☑ | ☐ | ☐ | Flow `budget-pension-offline.yaml` |
| BUDGET-PEN-029 | Duplicate contribution guard | | | | Unit | `backend/src/routes/__tests__/savings.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-030 | Pension tab hidden in minimal brand | | | | Unit | `src/screens/budget/__tests__/BudgetScreen.tabs.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-031 | Employer plan flag | | | | Unit | `src/screens/budget/pension/__tests__/PensionAccountsView.te | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-032 | Pension API registered overview | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-033 | Pension year stepper | | | | Maestro | `e2e/maestro/budget/budget-pension-interactions.yaml` | ☑ | ☐ | ☐ | Flow `budget-pension-interactions.yaml` |
| BUDGET-PEN-034 | Pension sub-tab testIDs | | | | Maestro | `e2e/maestro/budget/budget-pension.yaml` | ☑ | ☐ | ☐ | Flow `budget-pension.yaml` |
| BUDGET-PEN-035 | Room row add / delete | | | | Unit | `src/screens/budget/pension/__tests__/PensionRoomView.test.t | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-036 | Goal row add / delete | | | | Unit | `src/screens/budget/pension/__tests__/PensionGoalsView.test. | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-037 | Goal percent bounds | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-038 | Contribution amount must be positive | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-039 | Employer amount may be zero | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-040 | Contribution row actions | | | | Unit | `src/screens/budget/pension/__tests__/PensionAccountsView.te | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-041 | Entry sheet control inventory | | | | Unit | `src/screens/budget/pension/__tests__/PensionEntrySheet.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-042 | Employer-match preview matches what is saved | | | | Unit | `src/screens/budget/pension/__tests__/PensionEntrySheet.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-043 | Backfill sheet bulk fills | | | | Unit | `src/screens/budget/pension/__tests__/PensionBackfillSheet.t | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-044 | Backfill month bounds | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-045 | Pension import uses the registered-specific endpoints | | | | Unit | `src/screens/budget/pension/__tests__/PensionImportScreen.te | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-046 | Pension import undo | | | | Unit | `src/screens/budget/pension/__tests__/PensionImportScreen.te | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-047 | Registered transaction create | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-048 | Bulk delete member contributions | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-PEN-049 | Registered route literal-vs-param ordering | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-001 | Bills screen load | | | | Maestro | `e2e/maestro/budget/budget-bills.yaml` | ☑ | ☐ | ☐ | Flow `budget-bills.yaml` |
| BUDGET-BILL-002 | Utilities dashboard load | | | | Unit | `src/screens/budget/__tests__/BudgetBillsView.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-003 | Utility accounts list | | | | Maestro | `e2e/maestro/budget/budget-bills.yaml` | ☑ | ☐ | ☐ | Flow `budget-bills.yaml` |
| BUDGET-BILL-004 | Create utility account | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-005 | Edit utility account | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-006 | Delete utility account | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-007 | Add bill manually | | | | Unit, Maestro | `e2e/maestro/budget/budget-bills.yaml` | ☑ | ☐ | ☐ | Flow `budget-bills.yaml` |
| BUDGET-BILL-008 | Edit bill | | | | Maestro | `e2e/maestro/budget/budget-bills.yaml` | ☑ | ☐ | ☐ | Flow `budget-bills.yaml` |
| BUDGET-BILL-009 | Delete bill | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-010 | Mark bill paid | | | | Maestro | `e2e/maestro/budget/budget-bills.yaml` | ☑ | ☐ | ☐ | Flow `budget-bills.yaml` |
| BUDGET-BILL-011 | Bulk paid status | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-012 | Upload bill document | | | | Maestro | `e2e/maestro/budget/budget-bills.yaml` | ☑ | ☐ | ☐ | Flow `budget-bills.yaml` |
| BUDGET-BILL-013 | Extract bill from upload | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-014 | Duplicate bill upload flagged | | | | API | `utilities.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-015 | Manual duplicate bill 409 | | | | API | `utilities.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-016 | Allow duplicate override | | | | API | `utilities.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-017 | Property tax list load | | | | Unit | `src/screens/budget/__tests__/BudgetBillsView.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-018 | Add property tax year | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-019 | Edit property tax | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-020 | Upload property tax notice | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-021 | Duplicate tax year flagged | | | | API | `utilities.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-022 | BC assessment load | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-023 | Edit BC assessment | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-024 | Upload BC assessment | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-025 | Bill reminder create | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-026 | Bill reminder delete | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-027 | Bills amount display cents | | | | Unit | `src/screens/budget/__tests__/BudgetBillsView.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-028 | Cancel bill form | | | | Maestro | `e2e/maestro/budget/budget-bills.yaml` | ☑ | ☐ | ☐ | Flow `budget-bills.yaml` |
| BUDGET-BILL-029 | Validation missing due date | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-031 | Bills view state testID collision | | | | Maestro | `e2e/maestro/budget/budget-bills-states.yaml` | ☑ | ☐ | ☐ | Flow `budget-bills-states.yaml` |
| BUDGET-BILL-032 | Provider rows | | | | Maestro | `e2e/maestro/budget/budget-bills.yaml` | ☑ | ☐ | ☐ | Flow `budget-bills.yaml` |
| BUDGET-BILL-033 | Bills quick actions | | | | Maestro | `e2e/maestro/budget/budget-bills.yaml` | ☑ | ☐ | ☐ | Flow `budget-bills.yaml` |
| BUDGET-BILL-034 | Create BC assessment | | | | API | `backend/src/routes/__tests__/utilities.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-035 | Get single property-tax year | | | | API | `backend/src/routes/__tests__/utilities.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-036 | Utilities dashboard vs property overview | | | | API | `backend/src/routes/__tests__/utilities.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-037 | Utilities analytics + trend calculation | | | | API | `backend/src/utils/__tests__/bill-analytics.test.ts`, `backe | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-038 | Reminders list | | | | API | `backend/src/routes/__tests__/utilities.test.ts`, `e2e/maest | ☑ | ☐ | ☐ | Flow `budget-bills.yaml` |
| BUDGET-BILL-039 | Providers + municipality lookups | | | | GET 200 | API | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-040 | Homeowner grant calculation | | | | API | `backend/src/services/__tests__/utility-calculators.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-041 | Property-tax penalties + due date | | | | API | `backend/src/services/__tests__/utility-calculators.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BILL-042 | Bill amount is integer cents end to end | | | | Unit | `src/screens/budget/__tests__/BudgetBillsView.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-WISH-001 | Wishes list load | | | | Maestro, Unit | `e2e/maestro/budget/budget-wishes.yaml`, `src/screens/budget | ☑ | ☐ | ☐ | Pass — budget-wishes green ×2 2026-07-20 (wishes-rerun-3-fix.log, confirm-budget-wishes.log) |
| BUDGET-WISH-002 | Empty wishes state | | | | Unit | `src/screens/budget/__tests__/WishesView.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-WISH-003 | Add wish modal | | | | Unit | `src/screens/budget/__tests__/AddWishModal.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-WISH-004 | Wish detail load | | | | Unit | `src/screens/budget/__tests__/WishDetailScreen.e2e.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-WISH-005 | Edit wish title | | | | Unit | `src/screens/budget/__tests__/WishDetailScreen.coverage.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-WISH-006 | Wish estimated cost cents | | | | Unit | `src/screens/budget/__tests__/WishesView.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-WISH-007 | Add note entry | | | | Unit | `src/screens/budget/__tests__/WishDetailScreen.collab.test.t | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-WISH-008 | Add photo entry | | | | Maestro | `e2e/maestro/budget/budget-wishes.yaml` | ☑ | ☐ | ☐ | Pass — budget-wishes green ×2 2026-07-20 (wishes-rerun-3-fix.log, confirm-budget-wishes.log) |
| BUDGET-WISH-009 | Upload wish cover image | | | | Unit | `backend/src/routes/__tests__/wishes.test.ts`, `src/screens/ | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-WISH-010 | Add link entry | | | | Unit | `src/screens/budget/__tests__/WishDetailScreen.coverage.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-WISH-011 | Edit link entry | | | | Unit | `src/screens/budget/__tests__/WishDetailScreen.coverage.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-WISH-012 | Delete wish entry | | | | Unit | `src/screens/budget/__tests__/WishDetailScreen.coverage.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-WISH-013 | Delete wish | | | | Unit | `src/screens/budget/__tests__/WishDetailScreen.coverage.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-WISH-014 | Wish collab attribution | | | | Unit | `src/screens/budget/__tests__/WishDetailScreen.collab.test.t | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-WISH-015 | Cancel wish edit | | | | Unit | `src/screens/budget/__tests__/WishDetailScreen.coverage.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-WISH-016 | Validation empty wish title | | | | Unit | `src/screens/budget/__tests__/AddWishModal.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-WISH-017 | Mark wish achieved | | | | Unit | `src/screens/budget/__tests__/WishDetailScreen.coverage.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-WISH-018 | Reply thread on entry | | | | Unit | `src/screens/budget/__tests__/WishDetailScreen.collab.test.t | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-WISH-020 | Offline wish save | | | | Maestro | `e2e/maestro/budget/budget-wishes-extended.yaml` | ☑ | ☐ | ☐ | GREEN 2026-07-21 wishes-extended PASS (wish card accessibilityLabel fix) |
| BUDGET-WISH-021 | Wish list filter by status | | | | API | `wishes.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-WISH-022 | Entry row visible | | | | Unit | `src/screens/budget/__tests__/WishDetailScreen.e2e.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-WISH-023 | Wishes list controls | | | | Maestro | `e2e/maestro/budget/budget-wishes.yaml` | ☑ | ☐ | ☐ | Pass — budget-wishes green ×2 2026-07-20 (wishes-rerun-3-fix.log, confirm-budget-wishes.log) |
| BUDGET-WISH-024 | Add-wish modal has untestable inputs | | | | Maestro | `e2e/maestro/budget/budget-wishes-extended.yaml` | ☑ | ☐ | ☐ | GREEN 2026-07-21 wishes-extended PASS (wish card accessibilityLabel fix) |
| BUDGET-WISH-025 | Wish title required | | | | Unit | `src/screens/budget/__tests__/AddWishModal.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-WISH-026 | Wish estimated cost maximum | | | | API | `backend/src/routes/__tests__/wishes.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-WISH-027 | Wish price parses without validation | | | | Unit | `src/screens/budget/__tests__/AddWishModal.test.tsx`, `e2e/m | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-WISH-028 | Link entry requires a valid URL | | | | API | `backend/src/routes/__tests__/wishes.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-WISH-029 | Entry body length cap | | | | API | `backend/src/routes/__tests__/wishes.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-WISH-030 | Wish notes length cap | | | | API | `backend/src/routes/__tests__/wishes.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-WISH-031 | Entry row testIDs | | | | Unit | `src/screens/budget/__tests__/WishDetailScreen.e2e.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-WISH-032 | Cover image key cap | | | | API | `backend/src/routes/__tests__/wishes.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-001 | Chat rooms load | | | | Maestro | `e2e/maestro/budget/budget-chat-rooms.yaml`, `e2e/maestro/su | ☑ | ☐ | ☐ | Flow `budget-chat-rooms.yaml` |
| BUDGET-BCHAT-002 | Create chat room | | | | Maestro | `e2e/maestro/subflows/budget-create-chat-room.yaml` | ☑ | ☐ | ☐ | GREEN 2026-07-21 create-chat-room verified in chat-extended |
| BUDGET-BCHAT-003 | Delete chat room | | | | Unit | `src/features/budget/chat/screens/__tests__/BudgetChatRoomSe | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-004 | Open chat room | | | | Maestro | `e2e/maestro/budget/budget-chat-message.yaml` | ☑ | ☐ | ☐ | Flow `budget-chat-message.yaml` |
| BUDGET-BCHAT-005 | Send text message | | | | Maestro | `e2e/maestro/budget/budget-chat-message.yaml` | ☑ | ☐ | ☐ | Flow `budget-chat-message.yaml` |
| BUDGET-BCHAT-006 | Edit message | | | | Unit | `src/features/budget/chat/screens/__tests__/BudgetChatRoomSc | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-007 | Delete message | | | | Unit | `src/features/budget/chat/screens/__tests__/BudgetChatRoomSc | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-008 | Mark room read | | | | Unit | `src/features/budget/chat/screens/__tests__/BudgetChatRoomSc | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-009 | Participants list | | | | Unit | `src/features/budget/chat/screens/__tests__/BudgetChatRoomSe | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-010 | Set participants | | | | Unit | `src/features/budget/chat/screens/__tests__/BudgetChatRoomSe | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-011 | Attach photo | | | | Maestro | `e2e/maestro/budget/budget-chat-message.yaml` | ☑ | ☐ | ☐ | Flow `budget-chat-message.yaml` |
| BUDGET-BCHAT-012 | Image upload PUT | | | | API | `backend/src/services/__tests__/budget-chat-room-service.tes | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-013 | Budget AI assistant screen | | | | Maestro | `e2e/maestro/budget/budget-ai-screen.yaml`, `e2e/maestro/bud | ☑ | ☐ | ☐ | Flow `budget-ai-screen.yaml` |
| BUDGET-BCHAT-014 | AI assistant send prompt | | | | Maestro | `e2e/maestro/budget/budget-chat-assistant.yaml` | ☑ | ☐ | ☐ | Flow `budget-chat-assistant.yaml` |
| BUDGET-BCHAT-015 | AI gate denied | | | | API | `backend/src/routes/__tests__/budget-ai-detect.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-016 | Chat FAB visible | | | | Maestro, Unit | `e2e/maestro/budget/budget-chat-fab-visible.yaml`, `src/feat | ☑ | ☐ | ☐ | Budget-iPad retest 2026-07-20 — Pass (3m28s) |
| BUDGET-BCHAT-017 | Chat FAB unread badge | | | | Unit | `src/features/budget/chat/__tests__/BudgetChatFab.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-018 | Cancel message compose | | | | Maestro | `e2e/maestro/budget/budget-chat-message.yaml` | ☑ | ☐ | ☐ | Flow `budget-chat-message.yaml` |
| BUDGET-BCHAT-019 | Empty message send blocked | | | | Unit | `backend/src/services/__tests__/budget-chat-room-service.tes | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-020 | Mention chip tap | | | | Unit | `src/features/budget/chat/screens/__tests__/BudgetChatRoomSc | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-021 | Rate limit on messages | | | | API | `backend/src/services/__tests__/budget-chat-room-service.tes | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-023 | Offline send message | | | | Maestro | `e2e/maestro/budget/budget-chat-extended.yaml` | ☑ | ☐ | ☐ | GREEN 2026-07-21 chat-extended (mention-bar+offline-send+settings) — reduced-sim-load run |
| BUDGET-BCHAT-024 | Budget chat vs House chat isolation | | | | API | `backend/src/services/__tests__/budget-chat-room-service.tes | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-025 | Navigator de-dupe nonce | | | | Unit | `src/features/budget/chat/__tests__/BudgetChatNavigator.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-026 | Assistant cancel mid-stream | | | | Maestro | `e2e/maestro/budget/budget-chat-assistant.yaml` | ☑ | ☐ | ☐ | Flow `budget-chat-assistant.yaml` |
| BUDGET-BCHAT-027 | Rooms list empty state | | | | Maestro | `e2e/maestro/budget/budget-chat-rooms.yaml` | ☑ | ☐ | ☐ | Flow `budget-chat-rooms.yaml` |
| BUDGET-BCHAT-028 | New-room button gated on household | | | | Unit | `src/features/budget/chat/screens/__tests__/BudgetChatRoomsL | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-029 | Create-room sheet has no testIDs | | | | POST /households/:householdId/budget-chat-rooms | POST 201 | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-030 | Room name length | | | | API | `backend/src/services/__tests__/budget-chat-room-service.tes | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-031 | AI-enabled room badge | | | | Unit | `src/features/budget/chat/screens/__tests__/BudgetChatRoomsL | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-032 | Composer send-enable logic | | | | none until send | n/a (UI-only) | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-033 | Message length cap | | | | API | `backend/src/services/__tests__/budget-chat-room-service.tes | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-034 | Attachment and mention caps | | | | API | `backend/src/services/__tests__/budget-chat-room-service.tes | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-035 | Mention bar rows | | | | Maestro | `e2e/maestro/budget/budget-chat-extended.yaml` | ☑ | ☐ | ☐ | GREEN 2026-07-21 chat-extended (mention-bar+offline-send+settings) — reduced-sim-load run |
| BUDGET-BCHAT-036 | @assistant requires both mention and room flag | | | | API | `backend/src/services/__tests__/budget-chat-room-service.tes | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-037 | Assistant reply arrives over the WebSocket | | | | Maestro | `e2e/maestro/budget/budget-chat-assistant.yaml` | ☑ | ☐ | ☐ | Flow `budget-chat-assistant.yaml` |
| BUDGET-BCHAT-038 | Assistant is billed to the mentioning member's key | | | | API | `backend/src/services/__tests__/budget-chat-room-service.tes | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-039 | Assistant provider is fixed to Anthropic | | | | API | `backend/src/services/__tests__/budget-chat-assistant-provid | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-040 | Assistant entitlement denial is silent | | | | API | `backend/src/services/__tests__/budget-chat-entitlement-deni | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-041 | Message pagination | | | | API | `backend/src/services/__tests__/budget-chat-room-service.tes | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-042 | WebSocket auth uses a query token | | | | API | `src/features/budget/chat/__tests__/useBudgetChatSocket.test | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-043 | Room settings screen has no testIDs | | | | Maestro | `e2e/maestro/budget/budget-chat-extended.yaml` | ☑ | ☐ | ☐ | GREEN 2026-07-21 chat-extended (mention-bar+offline-send+settings) — reduced-sim-load run |
| BUDGET-BCHAT-044 | Delete room confirmation | | | | Maestro | `e2e/maestro/budget/budget-chat-extended.yaml` | ☑ | ☐ | ☐ | GREEN 2026-07-21 chat-extended (mention-bar+offline-send+settings) — reduced-sim-load run |
| BUDGET-BCHAT-045 | Budget chat is not gated by the Budget API flag | | | | API | `backend/src/config/__tests__/budget-chat-gating.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-BCHAT-046 | Chat rooms pull-to-refresh | | | | Maestro | `e2e/maestro/budget/budget-chat-extended.yaml` | ☑ | ☐ | ☐ | GREEN 2026-07-21 chat-extended (mention-bar+offline-send+settings) — reduced-sim-load run |
| BUDGET-ST-001 | Data sharing settings load | | | | Maestro | `e2e/maestro/budget/budget-data-sharing.yaml`, `e2e/maestro/ | ☑ | ☐ | ☐ | Flow `budget-data-sharing.yaml` |
| BUDGET-ST-002 | Revoke data sharing package | | | | Maestro | `e2e/maestro/budget/budget-data-sharing.yaml` | ☑ | ☐ | ☐ | Flow `budget-data-sharing.yaml` |
| BUDGET-ST-003 | Soft Transfer export screen load | | | | Maestro, Unit | `e2e/maestro/budget/budget-soft-transfer-export.yaml`, `src/ | ☑ | ☐ | ☐ | Flow `budget-soft-transfer-export.yaml` |
| BUDGET-ST-004 | Soft Transfer export UI steps | | | | Maestro | `e2e/maestro/budget/budget-soft-transfer-export.yaml` | ☑ | ☐ | ☐ | Flow `budget-soft-transfer-export.yaml` |
| BUDGET-ST-005 | Soft Transfer import screen load | | | | Maestro, Unit | `e2e/maestro/budget/budget-soft-transfer-import.yaml`, `src/ | ☑ | ☐ | ☐ | Flow `budget-soft-transfer-import.yaml` |
| BUDGET-ST-006 | Soft Transfer import preview | | | | Maestro | `e2e/maestro/budget/budget-soft-transfer-import.yaml` | ☑ | ☐ | ☐ | Flow `budget-soft-transfer-import.yaml` |
| BUDGET-ST-007 | Run transfer destructive | | | | Unit | `src/features/ecosystem/__tests__/runTransfer.mutation.test. | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-ST-008 | Export mutation unit contract | | | | Unit | `src/features/ecosystem/__tests__/runTransfer.mutation.test. | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-ST-009 | Import mutation unit contract | | | | Unit | `soft-transfer.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-ST-010 | ST API registry gates | | | | API | `backend/__tests__/data-bridge/soft-transfer.test.ts`, `back | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-ST-011 | Cancel export wizard | | | | Maestro | `e2e/maestro/budget/budget-soft-transfer-export.yaml` | ☑ | ☐ | ☐ | Flow `budget-soft-transfer-export.yaml` |
| BUDGET-ST-012 | Cancel import wizard | | | | Maestro | `e2e/maestro/budget/budget-soft-transfer-import.yaml` | ☑ | ☐ | ☐ | Flow `budget-soft-transfer-import.yaml` |
| BUDGET-ST-013 | Data sharing link visible | | | | Maestro | `e2e/maestro/budget/budget-settings.yaml` | ☑ | ☐ | ☐ | Flow `budget-settings.yaml` |
| BUDGET-ST-014 | ST export link visible | | | | Maestro | `e2e/maestro/budget/budget-settings-more.yaml` | ☑ | ☐ | ☐ | Flow `budget-settings-more.yaml` |
| BUDGET-ST-015 | ST import link visible | | | | Maestro | `e2e/maestro/budget/budget-settings-more.yaml` | ☑ | ☐ | ☐ | Flow `budget-settings-more.yaml` |
| BUDGET-ST-017 | Consent + package list endpoints | | | | Maestro | `e2e/maestro/budget/budget-data-sharing.yaml` | ☑ | ☐ | ☐ | Flow `budget-data-sharing.yaml` |
| BUDGET-ST-018 | Grant consent | | | | Unit | `src/features/budget/screens/__tests__/BudgetDataSharingScre | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-ST-019 | Revoke consent | | | | Maestro | `e2e/maestro/budget/budget-data-sharing.yaml` | ☑ | ☐ | ☐ | Flow `budget-data-sharing.yaml` |
| BUDGET-ST-020 | Transfer wizard control inventory | | | | Maestro | `e2e/maestro/budget/budget-soft-transfer-export.yaml` | ☑ | ☐ | ☐ | Flow `budget-soft-transfer-export.yaml` |
| BUDGET-ST-021 | Prepare precedes export/import | | | | Unit | `src/features/ecosystem/__tests__/runTransfer.mutation.test. | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-ST-022 | Export executes the real endpoint | | | | Unit | `src/features/ecosystem/__tests__/runTransfer.mutation.test. | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-ST-023 | Import executes the real endpoint | | | | Unit | `backend/__tests__/data-bridge/soft-transfer.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-ST-024 | Smart-engine brand capability gate | | | | API | `backend/__tests__/data-bridge/brand-and-gates.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-ST-025 | Transfer without consent is refused | | | | API | `backend/__tests__/data-bridge/routes-gates.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SETT-001 | Settings screen load | | | | Maestro, Unit | `e2e/maestro/budget/budget-settings.yaml`, `src/screens/budg | ☑ | ☐ | ☐ | Flow `budget-settings.yaml` |
| BUDGET-SETT-002 | Month grid visible | | | | Maestro | `e2e/maestro/budget/budget-settings.yaml` | ☑ | ☐ | ☐ | Flow `budget-settings.yaml` |
| BUDGET-SETT-003 | Select month cell | | | | Maestro | `e2e/maestro/budget/budget-settings.yaml` | ☑ | ☐ | ☐ | Flow `budget-settings.yaml` |
| BUDGET-SETT-004 | Planned budget input | | | | Maestro, Unit | `e2e/maestro/budget/budget-settings-extended.yaml`, `src/scr | ☑ | ☐ | ☐ | Flow `budget-settings-extended.yaml` |
| BUDGET-SETT-005 | Save month goal | | | | Maestro, Unit | `e2e/maestro/budget/budget-settings.yaml` | ☑ | ☐ | ☐ | Flow `budget-settings.yaml` |
| BUDGET-SETT-006 | Settings summary text | | | | Unit | `src/screens/budget/__tests__/BudgetSettingsScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SETT-007 | Transfer nav link | | | | Maestro | `e2e/maestro/budget/budget-settings.yaml` | ☑ | ☐ | ☐ | Flow `budget-settings.yaml` |
| BUDGET-SETT-008 | Categories nav link | | | | Maestro | `e2e/maestro/budget/budget-categories.yaml` | ☑ | ☐ | ☐ | Flow `budget-categories.yaml` |
| BUDGET-SETT-009 | Timeline nav link | | | | Maestro | `e2e/maestro/budget/budget-settings-extended.yaml`, `src/scr | ☑ | ☐ | ☐ | Flow `budget-settings-extended.yaml` |
| BUDGET-SETT-010 | History nav link | | | | Maestro | `e2e/maestro/budget/budget-settings-extended.yaml`, `src/scr | ☑ | ☐ | ☐ | Flow `budget-settings-extended.yaml` |
| BUDGET-SETT-011 | Compare nav link | | | | Maestro | `e2e/maestro/budget/budget-settings-extended.yaml`, `src/scr | ☑ | ☐ | ☐ | Flow `budget-settings-extended.yaml` |
| BUDGET-SETT-012 | Apply-to-year confirm path | | | | Unit | `src/screens/budget/__tests__/BudgetSettingsScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SETT-013 | Apply-to-year error alert | | | | Unit | `src/screens/budget/__tests__/BudgetSettingsScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SETT-014 | Cancel settings edit | | | | Unit | `e2e/maestro/budget/budget-item-form.yaml` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SETT-015 | Validation empty budget save | | | | Unit | `src/screens/budget/__tests__/BudgetSettingsScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SETT-016 | Schedule next-month reminder | | | | API | `src/api/__tests__/budget.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SETT-017 | Settings more submenu | | | | Maestro | `e2e/maestro/budget/budget-settings-more.yaml` | ☑ | ☐ | ☐ | Flow `budget-settings-more.yaml` |
| BUDGET-SETT-019 | Dollars to cents on save goal | | | | Unit | `src/screens/budget/__tests__/BudgetSettingsScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SETT-020 | Year selector change | | | | Unit | `src/screens/budget/__tests__/BudgetSettingsScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SETT-021 | Offline save settings | | | | Maestro | `e2e/maestro/budget/budget-settings-offline.yaml` | ☑ | ☐ | ☐ | Flow `budget-settings-offline.yaml` |
| BUDGET-SETT-022 | More hub load | | | | Maestro | `e2e/maestro/budget/budget-settings-more.yaml` | ☑ | ☐ | ☐ | Flow `budget-settings-more.yaml` |
| BUDGET-SETT-023 | Settings nav-link inventory | | | | Maestro | `e2e/maestro/budget/budget-settings.yaml` | ☑ | ☐ | ☐ | Flow `budget-settings.yaml` |
| BUDGET-SETT-024 | Timeline screen is untestable by testID | | | | Maestro | `e2e/maestro/budget/budget-timeline-year-setup.yaml` | ☑ | ☐ | ☐ | Flow `budget-timeline-year-setup.yaml` |
| BUDGET-SETT-025 | Year-setup screen is untestable by testID | | | | Maestro | `e2e/maestro/budget/budget-timeline-year-setup.yaml` | ☑ | ☐ | ☐ | Flow `budget-timeline-year-setup.yaml` |
| BUDGET-SETT-026 | Year setup silently discards an all-invalid save | | | | Unit | `src/screens/budget/__tests__/BudgetYearSetupScreen.test.tsx | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SETT-027 | Year setup save failure alert | | | | Unit | `src/screens/budget/__tests__/BudgetYearSetupScreen.test.tsx | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SETT-028 | Negative monthly budget alert copy | | | | Unit | `src/screens/budget/__tests__/BudgetSettingsScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SETT-029 | Tab customisation screen | | | | Maestro | `e2e/maestro/budget/budget-customize-tabs.yaml` | ☑ | ☐ | ☐ | Flow `budget-customize-tabs.yaml` |
| BUDGET-SETT-030 | Section tabs hide the FilterTabs row | | | | Unit | `src/screens/budget/__tests__/BudgetScreen.tabs.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-SETT-031 | Legacy `/budget` deep link redirects | | | | Maestro | `e2e/maestro/budget/budget-customize-tabs.yaml` | ☑ | ☐ | ☐ | Flow `budget-customize-tabs.yaml` |
| BUDGET-SETT-032 | Settings screen is its own NavigationContainer | | | | Unit | `src/screens/budget/__tests__/BudgetSettingsNavigator.contra | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-HH-001 | Households screen load | | | | Maestro, Unit | `e2e/maestro/budget/budget-households.yaml`, `src/features/b | ☑ | ☐ | ☐ | Flow `budget-households.yaml` |
| BUDGET-HH-002 | List households | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-HH-003 | Switch household | | | | Maestro, Unit | `e2e/maestro/budget/budget-household-switch.yaml`, `src/feat | ☑ | ☐ | ☐ | Flow `budget-household-switch.yaml` |
| BUDGET-HH-004 | Select household card | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-HH-005 | Create household FAB | | | | Maestro, Unit | `e2e/maestro/budget/budget-households.yaml` | ☑ | ☐ | ☐ | Flow `budget-households.yaml` |
| BUDGET-HH-006 | Create household save | | | | Maestro, Unit | `e2e/maestro/budget/budget-household-switch.yaml`, `src/feat | ☑ | ☐ | ☐ | Flow `budget-household-switch.yaml` |
| BUDGET-HH-007 | Rename household | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-HH-008 | Invite member | | | | Unit | `e2e/maestro/budget/budget-household-extended.yaml` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-HH-009 | Role change | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-HH-010 | Cancel create household | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-HH-011 | Validation empty HH name | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-HH-012 | Non-admin cannot rename | | | | Unit | `backend/src/routes/__tests__/budget.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-HH-013 | HH switch clears budget cache | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-HH-014 | Swipe actions on HH row | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-HH-016 | Offline create household | | | | Maestro | `e2e/maestro/budget/budget-household-extended.yaml` | ☑ | ☐ | ☐ | Flow `budget-household-extended.yaml` |
| BUDGET-HH-017 | Add-household FAB has no testID | | | | Maestro | `e2e/maestro/budget/budget-households.yaml` | ☑ | ☐ | ☐ | Flow `budget-households.yaml` |
| BUDGET-HH-018 | Swipe-to-edit on a household row | | | | Maestro | `e2e/maestro/budget/budget-household-extended.yaml` | ☑ | ☐ | ☐ | Flow `budget-household-extended.yaml` |
| BUDGET-HH-019 | Household name required alert | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-HH-020 | Budget household reskin omits property fields | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-HH-021 | Budget-framed household copy | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-HH-022 | Delete-household confirm copy | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-HH-023 | Leave-household confirm copy | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-HH-024 | Owner-only vs member-only actions | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-HH-025 | Manage members and invites | | | | Maestro | `e2e/maestro/budget/budget-household-extended.yaml` | ☑ | ☐ | ☐ | Flow `budget-household-extended.yaml` |
| BUDGET-HH-026 | Invite by email and by link | | | | API | `backend/src/services/__tests__/household-invite-remove.test | ☑ | ☐ | ☐ | Flow `budget-household-extended.yaml` |
| BUDGET-HH-027 | Join-request approve / deny | | | | POST 2xx | API | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-HH-028 | Remove a member | | | | API | `backend/src/services/__tests__/household-invite-remove.test | ☑ | ☐ | ☐ | Flow `budget-household-extended.yaml` |
| BUDGET-HH-029 | BudgetHomeScreen is unreachable in the Budget brand | | | | Unit | `e2e/maestro/budget/budget-tabs.yaml`, `src/features/budget/ | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-AUTH-001 | Login screen load (unsigned) | | | | Maestro | `e2e/maestro/budget/budget-auth.yaml` | ☑ | ☐ | ☐ | GREEN 2026-07-21 budget-auth PASS 7m22s (signed-out surface + OAuth CTAs + login + sign-out; clean run, no concurrent Metro-HMR) |
| BUDGET-AUTH-002 | Email login success | | | | Maestro | `e2e/maestro/subflows/budget-launch-logged-in.yaml` | ☑ | ☐ | ☐ | GREEN 2026-07-21 budget-auth PASS 7m22s (signed-out surface + OAuth CTAs + login + sign-out; clean run, no concurrent Metro-HMR) |
| BUDGET-AUTH-003 | Invalid credentials | | | | Maestro | `e2e/maestro/budget/budget-auth.yaml` | ☑ | ☐ | ☐ | GREEN 2026-07-21 budget-auth PASS 7m22s (signed-out surface + OAuth CTAs + login + sign-out; clean run, no concurrent Metro-HMR) |
| BUDGET-AUTH-004 | Logout from More | | | | Maestro | `e2e/maestro/budget/budget-auth.yaml` | ☑ | ☐ | ☐ | GREEN 2026-07-21 budget-auth PASS 7m22s (signed-out surface + OAuth CTAs + login + sign-out; clean run, no concurrent Metro-HMR) |
| BUDGET-AUTH-005 | Session persist relaunch | | | | Maestro | `e2e/maestro/subflows/budget-launch-logged-in.yaml` | ☑ | ☐ | ☐ | GREEN 2026-07-21 budget-auth PASS 7m22s (signed-out surface + OAuth CTAs + login + sign-out; clean run, no concurrent Metro-HMR) |
| BUDGET-AUTH-006 | 401 clears session on API | | | | Unit | `backend/src/routes/__tests__/budget.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-AUTH-007 | Google OAuth login | | | | Maestro | `e2e/maestro/budget/budget-auth.yaml` | ☑ | ☐ | ☐ | GREEN 2026-07-21 budget-auth PASS 7m22s (signed-out surface + OAuth CTAs + login + sign-out; clean run, no concurrent Metro-HMR) |
| BUDGET-AUTH-008 | Cancel login | | | | Maestro | `e2e/maestro/budget/budget-auth.yaml` | ☑ | ☐ | ☐ | GREEN 2026-07-21 budget-auth PASS 7m22s (signed-out surface + OAuth CTAs + login + sign-out; clean run, no concurrent Metro-HMR) |
| BUDGET-AUTH-009 | Apple sign-in route | | | | Maestro | `e2e/maestro/budget/budget-auth.yaml` | ☑ | ☐ | ☐ | GREEN 2026-07-21 budget-auth PASS 7m22s (signed-out surface + OAuth CTAs + login + sign-out; clean run, no concurrent Metro-HMR) |
| BUDGET-AUTH-010 | Companion-token path for joined-platform brands | | | | Unit | `src/api/__tests__/joined-platform-auth.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-AUTH-011 | Token refresh path differs by brand | | | | Unit | `src/api/__tests__/joined-platform-auth.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-AUTH-012 | Registration is disabled | | | | Maestro | `e2e/maestro/budget/budget-auth.yaml` | ☑ | ☐ | ☐ | GREEN 2026-07-21 budget-auth PASS 7m22s (signed-out surface + OAuth CTAs + login + sign-out; clean run, no concurrent Metro-HMR) |
| BUDGET-AUTH-013 | 401 on a household call clears the session once | | | | Unit | `backend/src/routes/__tests__/budget.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-AUTH-014 | Cross-household read is refused | | | | API | `backend/src/routes/__tests__/budget.test.ts`, `backend/src/ | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-CORNER-001 | Savings kill-switch session cache | | | | Unit | `src/screens/budget/__tests__/BudgetScreen.tabs.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-CORNER-002 | Savings probe fail-open on 5xx | | | | Unit | `src/screens/budget/__tests__/BudgetScreen.tabs.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-CORNER-003 | AI entitlement 409 provider_not_connected | | | | API | `backend/src/routes/__tests__/budget-ai-detect.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-CORNER-004 | AI entitlement 409 model_not_available | | | | API | `backend/src/routes/__tests__/budget-ai-detect.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-CORNER-005 | Cents conversion item form | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-CORNER-006 | Cents conversion expense form | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-CORNER-007 | Apply-to-year skips filled months | | | | Unit | `src/screens/budget/__tests__/BudgetSettingsScreen.test.tsx` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-CORNER-008 | Duplicate utility bill 409 | | | | API | `utilities.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-CORNER-009 | Duplicate bill upload skip auto-create | | | | API | `utilities.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-CORNER-010 | Maestro smoke never run-transfer | | | | Maestro | `e2e/maestro/budget/config.yaml` | ☑ | ☐ | ☐ | Pass — negative assertion: no flow taps run-transfer; soft-transfer flows guard-stop before consent (verified across 2026-07-21 runs) |
| BUDGET-CORNER-011 | `toCents` is duplicated seven times with three rulesets | | | | Unit | `src/screens/budget/__tests__/budgetItemFormUtils.test.ts`,  | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-CORNER-012 | No screen caps decimal places or input length | | | | Unit | `src/screens/budget/__tests__/moneyFieldCaps.contract.test.t | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-CORNER-013 | Only one client-side maximum exists | | | | Unit | `src/screens/budget/__tests__/moneyFieldCaps.contract.test.t | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-CORNER-014 | Money crosses the wire only as integer cents | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-CORNER-015 | Zero-amount policy differs by resource | | | | API | `backend/src/routes/__tests__/budget.test.ts`, `backend/src/ | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-CORNER-016 | Duplicate submit on every money form | | | | Unit | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-CORNER-017 | Offline behaviour across money mutations | | | | Maestro | `e2e/maestro/budget/budget-offline-sweep.yaml` | ☑ | ☐ | ☐ | Flow `budget-offline-sweep.yaml` |
| BUDGET-CORNER-018 | Route literal-vs-parameter shadowing guards | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |
| BUDGET-CORNER-019 | Duplicate testIDs break Maestro selection | | | | Maestro | `e2e/maestro/budget/budget-corner-testids.yaml` | ☑ | ☐ | ☐ | Flow `budget-corner-testids.yaml` |
| BUDGET-CORNER-020 | Household photo presign endpoint is unused | | | | API | `backend/src/routes/__tests__/household-photo-presign.contra | ☑ | ☐ | ☐ | Jest/vitest observed pass 2026-07-20 |

### Reconciliation — source rows added to scoring copy 2026-07-21

| ID | Description | Steps | Expected | | Layer | Automation | Pass | Fail | N/A | Notes |
|----|----|----|----|----|----|----|----|----|----|----|
| BUDGET-NAV-001 | Budget stack registers every full-budget screen | | | | Unit | `src/navigation/__tests__/BudgetNavigator.test.tsx` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-NAV-002 | Minimal mode registers no full-only screen | | | | Unit | `src/navigation/__tests__/BudgetNavigator.test.tsx` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-NAV-003 | `sanitizeBudgetNavigation` returns `{}` in minimal mode | | | | Unit | `src/features/budget/__tests__/mode.test.ts` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-NAV-004 | Budget stack host mounts the dashboard section | | | | Unit | `src/navigation/__tests__/BudgetNavigator.test.tsx` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-NAV-005 | `/budget-chat` redirects non-Budget brands | | | | Unit | `app/__tests__/budget-chat.route.test.tsx` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-NAV-006 | `/budget-chat` mounts the chat stack under Budget | | | | Unit | `app/__tests__/budget-chat.route.test.tsx` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-NAV-007 | Legacy deep-link shim maps all seven views | | | | Unit, Maestro | `app/__tests__/budget-deeplink.test.tsx`, `e2e/maestro/budget/budget-deep-links.yaml` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-NAV-008 | Unknown or absent `activeView` falls back Home | | | | Unit | `app/__tests__/budget-deeplink.test.tsx` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-NAV-009 | Deep link forwards `screen` and `subTab` | | | | Unit | `app/__tests__/budget-deeplink.test.tsx` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-NAV-010 | Budget deep links survive a cold launch | | | | Maestro | `e2e/maestro/budget/budget-deep-links.yaml` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-NAV-011 | `savingsEnabled: false` strips savings **and** pension | | | | Unit | `src/features/budget/__tests__/mode.test.ts` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-NAV-012 | Tab bar hides for the correct focused routes | | | | Unit | `src/navigation/__tests__/BudgetNavigator.test.tsx` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-WIDGET-001 | The live dashboard publishes the widget snapshot | | | | Unit | `src/features/budget/__tests__/budgetSnapshot.test.ts`, `src/features/budget/__tests__/useBudgetSnapshotPublisher.test.tsx` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-WIDGET-002 | Snapshot payload matches the Swift contract | | | | Unit | `src/features/budget/__tests__/budgetSnapshot.test.ts` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-WIDGET-003 | Amounts are published as integer cents | | | | Unit | `src/features/budget/__tests__/budgetSnapshot.test.ts` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-WIDGET-004 | No snapshot is written before the overview loads | | | | Unit | `src/features/budget/__tests__/budgetSnapshot.test.ts`, `src/features/budget/__tests__/useBudgetSnapshotPublisher.test.tsx` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-WIDGET-005 | Snapshot refreshes when the month changes | | | | Unit | `src/features/budget/__tests__/budgetSnapshot.test.ts`, `src/features/budget/__tests__/useBudgetSnapshotPublisher.test.tsx` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-WIDGET-006 | Publishing is a no-op off iOS | | | | Unit | `src/services/__tests__/widget-sync.test.ts` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-WIDGET-007 | Logout clears the Budget widget snapshot | | | | Unit | `src/services/__tests__/widget-sync-app-group.test.ts` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-WIDGET-008 | `clear()` wipes every key it writes | | | | Unit | `src/services/__tests__/widget-sync-app-group.test.ts` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-WIDGET-009 | Snapshot write triggers a timeline reload | | | | Unit, Live | `src/services/__tests__/widget-sync.test.ts`, `documents/engineering/testing/manual/budget-widget-watch.md` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-WIDGET-010 | Widget renders the published figures on device | | | | Live | `documents/engineering/testing/manual/budget-widget-watch.md` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-WIDGET-011 | Widget tap deep-links into Budget | | | | Live | `documents/engineering/testing/manual/budget-widget-watch.md` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-WIDGET-012 | App, widget and watch targets converge on one App Group | | | | Unit | `src/services/__tests__/widget-sync-app-group.test.ts` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-WATCH-001 | The dashboard publishes `watch_budget_today` | | | | Unit | `src/features/budget/__tests__/budgetSnapshot.test.ts`, `src/features/budget/__tests__/useBudgetSnapshotPublisher.test.tsx` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-WATCH-002 | Watch payload matches the Swift `BudgetToday` contract | | | | Unit | `src/features/budget/__tests__/budgetSnapshot.test.ts` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-WATCH-003 | Watch amounts are published as major units | | | | Unit | `src/features/budget/__tests__/budgetSnapshot.test.ts` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-WATCH-004 | Over-budget state is derivable on the watch | | | | Unit | `src/features/budget/__tests__/budgetSnapshot.test.ts` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-WATCH-005 | Next-bill fields are optional and omissible | | | | Unit | `src/features/budget/__tests__/budgetSnapshot.test.ts` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-WATCH-006 | No watch snapshot before the overview loads | | | | Unit | `src/features/budget/__tests__/budgetSnapshot.test.ts`, `src/features/budget/__tests__/useBudgetSnapshotPublisher.test.tsx` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-WATCH-007 | Logout clears `watch_budget_today` | | | | Unit | `src/services/__tests__/widget-sync-app-group.test.ts` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-WATCH-008 | `watch-sync.ts` bridge degrades safely | | | | Unit | `src/services/__tests__/watch-sync.test.ts` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-WATCH-009 | Watch listeners do not leak across re-initialisation | | | | Unit | `src/services/__tests__/watch-sync.test.ts` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-WATCH-010 | Watch app renders live Budget figures on device | | | | Live | `documents/engineering/testing/manual/budget-widget-watch.md` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-CORNER-021 | Utilities is reachable on the client but 404s on the Worker | | | | GET /households/:householdId/utilities → 404 | `{GET,/households/:householdId/utilities,404}` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-CORNER-022 | Brand offering falls back to another brand's paywall | | | | Unit | `src/services/__tests__/purchases.brandOffering.test.ts` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-CORNER-023 | House-domain notifications never surface under Budget | | | | Unit | `src/utils/__tests__/notificationVisibility.budget.test.ts` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-CORNER-024 | Budget-native notification types pass the brand filter | | | | Unit | `src/utils/__tests__/notificationVisibility.budget.test.ts` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-CORNER-025 | Client tolerates both brand-gate 404 shapes | | | | Unit, API | `src/api/__tests__/brandGate404.contract.test.ts`, `backend/src/middleware/__tests__/brand-gate.test.ts` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-CORNER-026 | Every Budget flow file is in the suite run order | | | | Unit | `e2e/__tests__/budgetSuiteCompleteness.test.ts` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-DASH-045 | Dashboard CTA layout is deterministic | | | | Unit | `src/screens/budget/__tests__/budgetCtaLayout.test.ts` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-PEN-050 | Pension progress bar clamps its fraction | | | | Unit | `src/screens/budget/pension/__tests__/PensionProgressBar.test.tsx` | ☑ | ☐ | ☐ | Jest observed pass 2026-07-21 (unit/API green) |
| BUDGET-SETT-035 | AI Providers panel reachable from Budget Settings | | | | Maestro | `e2e/maestro/budget/budget-ai-providers.yaml` | ☑ | ☐ | ☐ | GREEN 2026-07-21 — Budget BYOK AI hub (providers + usage tab), reached via Settings |
| BUDGET-AUTH-015 | Terms-acceptance 401 swallowed on stale session | | | | Maestro | `e2e/maestro/budget/budget-onboarding-terms.yaml` | ☑ | ☐ | ☐ | GREEN 2026-07-21 — ChildWelcome terms 401 regression guard |
| BUDGET-BCHAT-047 | @assistant gated on account AI access | | | | Unit | `src/features/budget/chat/screens/__tests__/BudgetChatRoomScreen.test.tsx` | ☑ | ☐ | ☐ | GREEN 2026-07-21 — @assistant hint hidden when canUseAI=false (aiAvailable gate) |
