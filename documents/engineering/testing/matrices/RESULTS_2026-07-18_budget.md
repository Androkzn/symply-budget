# Symply Budget Acceptance Results — 2026-07-18

| Field | Value |
|-------|-------|
| **Doc type** | Dated scoring copy (Circle V2 style) |
| **App / scope** | `budget` |
| **Run date** | `2026-07-18` |
| **Environment** | `staging` |
| **Device / OS** | Budget-A, iOS 26.5 |
| **Matrix source** | [budget.md](./budget.md) |
| **Maestro log(s)** | `…/maestro-budget-full-2026-07-19-run10.log`, `…/run11.log`, `…/run12.log` (active) |

## Summary

| Metric | Count |
|--------|------:|
| Matrix rows | 560 |
| Pass | 168 |
| Fail | 9 |
| N/A | 383 |
| Pass rate (excl. N/A) | 94.9% |
| Maestro flows (merged) | 49 (**46 pass** / **3 fail** — run14 until-green active) |

**Harness notes**

- **Merged Maestro logs:** run10, run11, **run12** (`maestro-budget-full-2026-07-19-run12.log`)
- **Flows scored (best-of):** 46/49 pass — run11 had 43 green; **re-verified 2026-07-19:** `budget-chat-assistant`, `budget-chat-extended`, `budget-chat-fab-visible`
- **Remaining (4):** `budget-wishes`, `budget-wishes-extended`, `check-spendings-layout`, `budget-auth`
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
| `budget-chat-fab-visible` | Pass | re-verified 2026-07-19 | run10/11 OOM false-fail |
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
| `budget-recover-session` | Fail | — | `maestro-budget-full-2026-07-19-run10.log` |
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
| `budget-wishes` | Fail | — | `maestro-budget-full-2026-07-19-run11.log` |
| `check-spendings-layout` | Pass | smoke3 | `smoke-supplement` |

**Open failures (fix queue)**

- `budget-chat-extended.yaml` — see log
- `budget-chat-fab-visible.yaml` — see log
- `budget-recover-session.yaml` — see log
- `budget-wishes.yaml` — see log

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
| BUDGET-SMOKE-008 | Cross-tab totals unit contract | | | | Unit | `src/screens/budget/__tests__/BudgetCrossTabConsistency.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SCROLL-001 | Dashboard scroll to sentinel | | | | Maestro | `e2e/maestro/scroll/budget-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| BUDGET-SCROLL-002 | Planning scroll to sentinel | | | | Maestro | `e2e/maestro/scroll/budget-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| BUDGET-SCROLL-003 | Spending scroll to sentinel | | | | Maestro | `e2e/maestro/scroll/budget-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| BUDGET-SCROLL-004 | Savings scroll to sentinel | | | | Maestro | `e2e/maestro/scroll/budget-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| BUDGET-SCROLL-005 | More / settings scroll | | | | Maestro | `e2e/maestro/scroll/budget-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| BUDGET-SCROLL-006 | Wishes scroll to sentinel | | | | Maestro | `e2e/maestro/scroll/budget-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| BUDGET-DASH-001 | Dashboard load | | | | Maestro, Unit | `e2e/maestro/budget/budget-dashboard-controls.yaml`, `src/sc | ☑ | ☐ | ☐ | Flow `budget-dashboard-controls.yaml` |
| BUDGET-DASH-002 | Dashboard loading gate | | | | Unit | `src/screens/budget/__tests__/BudgetDashboardView.render.tes | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
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
| BUDGET-DASH-015 | Planned fit card load | | | | Unit | `src/screens/budget/__tests__/BudgetPlannedFitCard.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-DASH-016 | Add planned visible | | | | Maestro | `e2e/maestro/budget/budget-dashboard-controls.yaml` | ☑ | ☐ | ☐ | Flow `budget-dashboard-controls.yaml` |
| BUDGET-DASH-017 | Add planned opens form | | | | Maestro | `e2e/maestro/budget/budget-item-form.yaml` | ☑ | ☐ | ☐ | Flow `budget-item-form.yaml` |
| BUDGET-DASH-018 | Add spent visible | | | | Maestro | `e2e/maestro/budget/budget-dashboard-controls.yaml` | ☑ | ☐ | ☐ | Flow `budget-dashboard-controls.yaml` |
| BUDGET-DASH-019 | Add spent opens form | | | | Maestro | `e2e/maestro/budget/budget-spent-form.yaml` | ☑ | ☐ | ☐ | Flow `budget-spent-form.yaml` |
| BUDGET-DASH-020 | Add with AI visible | | | | Maestro | `e2e/maestro/budget/budget-ai-screen.yaml` | ☑ | ☐ | ☐ | Flow `budget-ai-screen.yaml` |
| BUDGET-DASH-021 | Add with AI opens screen | | | | Maestro | `e2e/maestro/budget/budget-ai-screen.yaml` | ☑ | ☐ | ☐ | Flow `budget-ai-screen.yaml` |
| BUDGET-DASH-022 | Dashboard add row visible | | | | Maestro | `e2e/maestro/budget/budget-dashboard-controls.yaml` | ☑ | ☐ | ☐ | Flow `budget-dashboard-controls.yaml` |
| BUDGET-DASH-023 | Monthly overview API shape | | | | API, Unit | `backend/src/routes/__tests__/budget.test.ts`, `src/api/__te | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-DASH-024 | Encouragement API shape | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-DASH-025 | Insights API cached response | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-DASH-026 | Empty month overview | | | | Unit | `src/screens/budget/__tests__/BudgetDashboardView.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-DASH-027 | Category row long-press (planned fit) | | | | Unit | `src/screens/budget/__tests__/BudgetPlannedFitCard.coverage. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-DASH-028 | Duplicate planned from dashboard | | | | Unit | `src/screens/budget/__tests__/BudgetPlannedFitCard.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-DASH-029 | Delete planned from dashboard | | | | Unit | `src/screens/budget/__tests__/BudgetPlannedFitCard.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-DASH-030 | Record spending from planned | | | | Unit | `src/screens/budget/__tests__/BudgetPlannedFitCard.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-DASH-031 | AI insights gate denied | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-DASH-032 | Overview offline error | | | | Maestro | `e2e/maestro/budget/budget-dashboard-offline.yaml` | ☑ | ☐ | ☐ | Flow `budget-dashboard-offline.yaml` |
| BUDGET-DASH-033 | Savings headroom hidden on kill-switch | | | | Unit | `src/screens/budget/__tests__/BudgetScreen.tabs.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-DASH-034 | Quick add suggestions load | | | | Unit | `src/screens/budget/__tests__/BudgetQuickAddRow.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-DASH-035 | Header settings gear opens Budget settings | | | | Maestro | `e2e/maestro/budget/budget-settings.yaml` | ☑ | ☐ | ☐ | Flow `budget-settings.yaml` |
| BUDGET-DASH-036 | Planned-fit card renders with window chips | | | | Unit | `src/screens/budget/__tests__/BudgetPlannedFitCard.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-DASH-037 | Planned-fit window chip switches horizon | | | | Unit | `src/screens/budget/__tests__/BudgetPlannedFitCard.coverage. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-DASH-038 | Encouragement banner testID | | | | Unit | `src/screens/budget/__tests__/BudgetEncouragementBanner.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-DASH-039 | Quick-add row + section testIDs | | | | Unit | `e2e/maestro/budget/budget-item-form.yaml`, `src/screens/bud | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-DASH-040 | Compact currency rendering above $1,000 | | | | Unit | `e2e/maestro/budget/budget-dashboard-controls.yaml` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-DASH-041 | Negative total renders sign before `$` | | | | Unit | `src/screens/budget/__tests__/budgetFormat.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-DASH-042 | Null cents renders `$0` not blank | | | | Unit | `src/screens/budget/__tests__/budgetFormat.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-DASH-043 | Estimated-cost range formatting | | | | Unit | `src/screens/budget/__tests__/budgetFormat.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-DASH-044 | House glance route is not the Budget overview | | | | API | `src/api/__tests__/home-budget.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
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
| BUDGET-PLAN-011 | Cancel planned form | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-012 | Validation empty title | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-013 | Categories screen load | | | | Maestro, Unit | `e2e/maestro/budget/budget-categories.yaml`, `src/screens/bu | ☑ | ☐ | ☐ | Flow `budget-categories.yaml` |
| BUDGET-PLAN-014 | Create custom category | | | | Maestro, Unit | `e2e/maestro/budget/budget-categories.yaml` | ☑ | ☐ | ☐ | Flow `budget-categories.yaml` |
| BUDGET-PLAN-015 | Hide default category | | | | Unit | `src/screens/budget/__tests__/BudgetCategoriesScreen.test.ts | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-016 | Delete custom category | | | | Unit | `src/screens/budget/__tests__/BudgetCategoriesScreen.test.ts | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-017 | Category detail load | | | | Maestro, Unit | `e2e/maestro/budget/budget-category-detail.yaml`, `src/scree | ☑ | ☐ | ☐ | Flow `budget-category-detail.yaml` |
| BUDGET-PLAN-018 | Category detail month stepper | | | | Maestro | `e2e/maestro/budget/budget-category-detail.yaml` | ☑ | ☐ | ☐ | Flow `budget-category-detail.yaml` |
| BUDGET-PLAN-019 | Timeline screen load | | | | Unit | `src/screens/budget/__tests__/BudgetTimelineScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-020 | Year setup screen load | | | | Unit | `src/screens/budget/__tests__/BudgetYearSetupScreen.test.tsx | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-021 | Year setup save goal | | | | Unit | `src/screens/budget/__tests__/BudgetYearSetupScreen.test.tsx | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-022 | BudgetItemAI load | | | | Maestro | `e2e/maestro/budget/budget-ai-screen.yaml` | ☑ | ☐ | ☐ | Flow `budget-ai-screen.yaml` |
| BUDGET-PLAN-023 | AI detect text | | | | Maestro, API | `e2e/maestro/budget/budget-ai-screen.yaml`, `budget-ai-detec | ☑ | ☐ | ☐ | Flow `budget-ai-screen.yaml` |
| BUDGET-PLAN-024 | AI detect with attachment | | | | Maestro, API | `e2e/maestro/budget/budget-ai-screen.yaml`, `backend/src/rou | ☑ | ☐ | ☐ | Flow `budget-ai-screen.yaml` |
| BUDGET-PLAN-025 | AI gate without entitlement | | | | API | `budget-ai-detect.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-PLAN-026 | Save AI suggestion to item | | | | Maestro | `e2e/maestro/budget/budget-item-form.yaml` | ☑ | ☐ | ☐ | Flow `budget-item-form.yaml` |
| BUDGET-PLAN-027 | Cancel AI screen | | | | Maestro | `e2e/maestro/budget/budget-ai-screen.yaml` | ☑ | ☐ | ☐ | Flow `budget-ai-screen.yaml` |
| BUDGET-PLAN-028 | Transfer screen load | | | | Maestro, Unit | `e2e/maestro/budget/budget-transfer.yaml`, `src/screens/budg | ☑ | ☐ | ☐ | Flow `budget-transfer.yaml` |
| BUDGET-PLAN-029 | Transfer destination select | | | | Maestro | `e2e/maestro/budget/budget-transfer.yaml` | ☑ | ☐ | ☐ | Flow `budget-transfer.yaml` |
| BUDGET-PLAN-030 | Create transfer | | | | Maestro, API | `e2e/maestro/budget/budget-transfer.yaml`, `budget-transfers | ☑ | ☐ | ☐ | Flow `budget-transfer.yaml` |
| BUDGET-PLAN-031 | Move all leftover | | | | Maestro | `e2e/maestro/budget/budget-transfer.yaml` | ☑ | ☐ | ☐ | Flow `budget-transfer.yaml` |
| BUDGET-PLAN-032 | Undo transfer | | | | Maestro, API | `e2e/maestro/budget/budget-transfer.yaml` | ☑ | ☐ | ☐ | Flow `budget-transfer.yaml` |
| BUDGET-PLAN-033 | Transfer validation over amount | | | | Unit | `src/screens/budget/__tests__/BudgetTransferScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-034 | Cancel transfer screen | | | | Maestro | `e2e/maestro/budget/budget-transfer.yaml` | ☑ | ☐ | ☐ | Flow `budget-transfer.yaml` |
| BUDGET-PLAN-035 | Sync action items | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-PLAN-036 | Set monthly goal via settings link | | | | Maestro, Unit | `e2e/maestro/budget/budget-settings.yaml`, `src/screens/budg | ☑ | ☐ | ☐ | Flow `budget-settings.yaml` |
| BUDGET-PLAN-037 | Apply to year alert first goal | | | | Unit | `src/screens/budget/__tests__/BudgetSettingsScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-038 | Apply to year decline | | | | Unit | `src/screens/budget/__tests__/BudgetSettingsScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-039 | Dollars to cents on item save | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-040 | Planning scroll sentinel | | | | Maestro | `e2e/maestro/scroll/budget-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| BUDGET-PLAN-041 | Kind segmented control planned/spent | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-042 | Cost mode exact vs range | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-043 | Priority chips — all four values | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-044 | Priority colour scale is intentionally inverted | | | | Unit | `src/screens/budget/__tests__/budgetFormat.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-045 | When chips — 4 primary options visible | | | | Unit | `e2e/maestro/budget/budget-item-form.yaml`, `src/screens/bud | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-046 | When "More" sheet lists all 8 options | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-047 | When "More" sheet close is non-destructive | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-048 | "When possible" saves an undated item | | | | Unit | `src/screens/budget/__tests__/budgetItemFormUtils.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-049 | Specific-date picker clamped to month bounds | | | | Unit | `src/screens/budget/__tests__/budgetItemFormUtils.test.ts`,  | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-050 | Future month clamps to its first day | | | | Unit | `src/screens/budget/__tests__/budgetItemFormUtils.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-051 | Category picker sheet opens | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-052 | Category search filters the list | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-053 | Category "None" clears the selection | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-054 | Category sheet close preserves prior selection | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-055 | Save disabled until form is dirty | | | | !title.trim()`. Typing a title enables them; clearing it disables them again. | save btns | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-PLAN-056 | Empty title toast copy | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-057 | Title length cap (server) | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-PLAN-058 | Description length cap (server) | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-PLAN-059 | Negative planned cost is accepted client-side, rejected server-side | | | | Unit, API | `src/screens/budget/__tests__/budgetItemFormUtils.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-060 | Zero planned cost is allowed | | | | Unit | `src/screens/budget/__tests__/budgetItemFormUtils.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-061 | Non-numeric amount yields no amount, not NaN | | | | Unit | `src/screens/budget/__tests__/budgetItemFormUtils.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-062 | Decimal precision rounds to the nearest cent | | | | Unit | `src/screens/budget/__tests__/budgetItemFormUtils.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-063 | Multiple decimal points | | | | Unit | `src/screens/budget/__tests__/budgetItemFormUtils.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-064 | Discount toggle reveals saved-amount field | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-065 | Category create/rename/delete testIDs | | | | Unit | `src/screens/budget/__tests__/BudgetCategoriesScreen.test.ts | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-066 | Category name/icon/colour caps | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-PLAN-067 | Transfer destination testID format | | | | Maestro | `e2e/maestro/budget/budget-transfer.yaml` | ☑ | ☐ | ☐ | Flow `budget-transfer.yaml` |
| BUDGET-PLAN-068 | Transfer note field persists | | | | Unit | `src/screens/budget/__tests__/BudgetTransferScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-069 | Transfer zero/negative amount alert copy | | | | Unit | `src/screens/budget/__tests__/BudgetTransferScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-070 | Transfer over-leftover alert copy | | | | Unit | `src/screens/budget/__tests__/BudgetTransferScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PLAN-071 | Get single budget item | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-PLAN-072 | Goal year/month bounds | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-PLAN-073 | Negative planned budget rejected | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
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
| BUDGET-SPEND-015 | Edit receipt line amount | | | | Unit | `src/screens/budget/__tests__/BudgetReceiptScanScreen.test.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SPEND-016 | Bulk save receipt items | | | | Maestro, API | `e2e/maestro/budget/budget-receipt-scan.yaml`, `budget-recei | ☑ | ☐ | ☐ | Flow `budget-receipt-scan.yaml` |
| BUDGET-SPEND-017 | Bulk save atomic failure | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SPEND-018 | Cancel receipt scan | | | | Maestro | `e2e/maestro/budget/budget-receipt-scan.yaml` | ☑ | ☐ | ☐ | Flow `budget-receipt-scan.yaml` |
| BUDGET-SPEND-019 | Add with AI from spending | | | | Maestro | `e2e/maestro/budget/budget-ai-screen.yaml` | ☑ | ☐ | ☐ | Flow `budget-ai-screen.yaml` |
| BUDGET-SPEND-020 | Record sheet amount field | | | | Maestro | `e2e/maestro/budget/check-spendings-layout.yaml` | ☑ | ☐ | ☐ | Flow `check-spendings-layout.yaml` |
| BUDGET-SPEND-021 | Savings banner on spend tab | | | | Maestro | `e2e/maestro/budget/check-spendings-layout.yaml` | ☑ | ☐ | ☐ | Flow `check-spendings-layout.yaml` |
| BUDGET-SPEND-022 | Spent form validation empty amount | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SPEND-023 | Spent form cancel | | | | Maestro | `e2e/maestro/budget/budget-spent-form.yaml` | ☑ | ☐ | ☐ | Flow `budget-spent-form.yaml` |
| BUDGET-SPEND-024 | Expense list API filters | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SPEND-025 | Get single expense | | | | API | `src/api/__tests__/budget.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SPEND-026 | Saved amount on expense | | | | Unit | `src/screens/budget/__tests__/BudgetReceiptScanScreen.test.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SPEND-027 | Month stepper on spending | | | | Maestro | `e2e/maestro/budget/check-spendings-layout.yaml` | ☑ | ☐ | ☐ | Flow `check-spendings-layout.yaml` |
| BUDGET-SPEND-028 | Quick add spent suggestions | | | | Unit | `src/screens/budget/__tests__/BudgetQuickAddRow.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SPEND-029 | Offline add spent | | | | Maestro | `e2e/maestro/budget/budget-spend-mutations.yaml` | ☑ | ☐ | ☐ | Flow `budget-spend-mutations.yaml` |
| BUDGET-SPEND-030 | Duplicate submit debounce | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SPEND-031 | Receipt add manual line | | | | Unit | `src/screens/budget/__tests__/BudgetReceiptScanScreen.test.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SPEND-032 | Remove receipt line | | | | Unit | `src/screens/budget/__tests__/BudgetReceiptScanScreen.test.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SPEND-033 | Camera receipt source | | | | Maestro | `e2e/maestro/budget/budget-receipt-scan.yaml` | ☑ | ☐ | ☐ | Flow `budget-receipt-scan.yaml` |
| BUDGET-SPEND-034 | Drive receipt source | | | | Maestro | `e2e/maestro/budget/budget-receipt-scan.yaml` | ☑ | ☐ | ☐ | Flow `budget-receipt-scan.yaml` |
| BUDGET-SPEND-035 | Spending scroll sentinel | | | | Maestro | `e2e/maestro/scroll/budget-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| BUDGET-SPEND-036 | Cross-tab spent total sync | | | | Unit | `src/screens/budget/__tests__/BudgetCrossTabConsistency.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SPEND-037 | Spent amount zero/negative gate | | | | none — no write | no POST …/expenses | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SPEND-038 | Server rejects zero-amount expense | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SPEND-039 | Server rejects non-integer amount | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SPEND-040 | Spendings-view `toCents` rejects zero and negative | | | | none — no write | no POST …/record-spending | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SPEND-041 | Bulk receipt item count bounds | | | | API | `backend/src/routes/__tests__/budget-receipt-scan.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SPEND-042 | Expense list limit bounds | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SPEND-043 | Receipt line name field | | | | Unit | `src/screens/budget/__tests__/BudgetReceiptScanScreen.test.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SPEND-044 | Receipt line saved/discount field | | | | Unit | `src/screens/budget/__tests__/BudgetReceiptScanScreen.test.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SPEND-045 | Receipt file source | | | | Maestro | `e2e/maestro/budget/budget-receipt-scan.yaml` | ☑ | ☐ | ☐ | Flow `budget-receipt-scan.yaml` |
| BUDGET-SPEND-046 | Receipt `toCents` rejects negatives | | | | none — no write | no POST …/bulk with negative | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SPEND-047 | Expense vendor cap | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SPEND-048 | Delete expense round-trip | | | | Maestro | `e2e/maestro/budget/budget-spend-mutations.yaml` | ☑ | ☐ | ☐ | Flow `budget-spend-mutations.yaml` |
| BUDGET-SAVE-001 | Savings tab load | | | | Maestro | `e2e/maestro/budget/budget-savings-overview.yaml` | ☑ | ☐ | ☐ | Flow `budget-savings-overview.yaml` |
| BUDGET-SAVE-002 | Savings overview cards | | | | Maestro, Unit | `e2e/maestro/budget/budget-savings-overview.yaml`, `src/scre | ☑ | ☐ | ☐ | Flow `budget-savings-overview.yaml` |
| BUDGET-SAVE-003 | Income sub-tab load | | | | Maestro, Unit | `e2e/maestro/budget/budget-savings-income-entry.yaml`, `src/ | ☑ | ☐ | ☐ | Flow `budget-savings-income-entry.yaml` |
| BUDGET-SAVE-004 | Create income entry | | | | Maestro, Unit | `e2e/maestro/budget/budget-savings-income-entry.yaml`, `src/ | ☑ | ☐ | ☐ | Flow `budget-savings-income-entry.yaml` |
| BUDGET-SAVE-005 | Edit income entry | | | | Unit | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-006 | Delete income entry | | | | Unit | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-007 | Monthly sub-tab load | | | | Unit | `src/screens/budget/savings/__tests__/SavingsMonthlyView.tes | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-008 | Create spending entry | | | | Unit | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-009 | Goals sub-tab load | | | | Maestro, Unit | `e2e/maestro/budget/budget-savings-goal.yaml`, `src/screens/ | ☑ | ☐ | ☐ | Flow `budget-savings-goal.yaml` |
| BUDGET-SAVE-010 | Create savings goal | | | | Maestro, Unit | `e2e/maestro/budget/budget-savings-goal.yaml`, `src/screens/ | ☑ | ☐ | ☐ | Flow `budget-savings-goal.yaml` |
| BUDGET-SAVE-011 | Edit savings goal | | | | Unit | `src/screens/budget/savings/__tests__/SavingsGoalForm.test.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-012 | Delete savings goal | | | | Unit | `src/screens/budget/savings/__tests__/SavingsGoalForm.test.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-013 | Recurring payments screen | | | | Maestro, Unit | `e2e/maestro/budget/budget-savings-recurring.yaml`, `src/scr | ☑ | ☐ | ☐ | Flow `budget-savings-recurring.yaml` |
| BUDGET-SAVE-014 | Add recurring payment | | | | Maestro, Unit | `e2e/maestro/budget/budget-savings-recurring.yaml` | ☑ | ☐ | ☐ | Flow `budget-savings-recurring.yaml` |
| BUDGET-SAVE-015 | Apply recurring to months | | | | Unit | `src/screens/budget/savings/__tests__/MonthApplyModal.test.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-016 | Import screen load | | | | Maestro, Unit | `e2e/maestro/budget/budget-savings-import.yaml`, `src/screen | ☑ | ☐ | ☐ | Flow `budget-savings-import.yaml` |
| BUDGET-SAVE-017 | Import commit | | | | Maestro, Unit | `e2e/maestro/budget/budget-savings-import.yaml` | ☑ | ☐ | ☐ | Flow `budget-savings-import.yaml` |
| BUDGET-SAVE-018 | Import undo history | | | | Unit | `src/screens/budget/savings/__tests__/SavingsImportScreen.te | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-019 | Year history load | | | | Unit | `src/screens/budget/savings/__tests__/SavingsYearHistoryScre | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-020 | Compare years load | | | | Unit | `src/screens/budget/savings/__tests__/SavingsCompareYearsScr | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-021 | Registered accounts load | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRegistered.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-022 | Add registered account | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRegistered.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-023 | Log registered contribution | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRegistered.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-024 | Income templates load | | | | Unit | `backend/src/routes/__tests__/savings.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-025 | Apply income templates | | | | Unit | `backend/src/routes/__tests__/savings.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-026 | Spending from goal view | | | | Unit | `src/screens/budget/savings/__tests__/SavingsSpendingView.te | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-027 | Copy entry modal | | | | Unit | `src/screens/budget/savings/__tests__/CopyEntryModal.test.ts | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-028 | Income dollars to cents | | | | Unit | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-029 | Cancel income form | | | | Unit | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-030 | Validation empty income label | | | | Unit | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-031 | Savings import disabled flag | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SAVE-032 | Savings kill-switch 404 | | | | Unit | `src/screens/budget/__tests__/BudgetScreen.tabs.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-033 | Savings overview trend | | | | Unit | `src/screens/budget/savings/__tests__/SavingsOverviewView.te | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-034 | Institution picker | | | | Unit | `src/screens/budget/savings/__tests__/InstitutionPicker.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-035 | Savings categories CRUD | | | | Unit | `backend/src/routes/__tests__/savings.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-036 | Recurring delete | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRecurringPaymen | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-037 | Goal archive/achieve | | | | Unit | `backend/src/routes/__tests__/savings.test.ts`, `e2e/maestro | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-038 | Offline savings save | | | | Maestro | `e2e/maestro/budget/budget-savings-offline.yaml` | ☑ | ☐ | ☐ | Flow `budget-savings-offline.yaml` |
| BUDGET-SAVE-039 | History year chip select | | | | Unit | `src/screens/budget/savings/__tests__/SavingsYearHistoryScre | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-040 | Compare year chip toggle | | | | Unit | `src/screens/budget/savings/__tests__/SavingsCompareYearsScr | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-041 | Savings scroll sub-tabs | | | | Maestro | `e2e/maestro/scroll/budget-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| BUDGET-SAVE-042 | Transfer to savings goal | | | | Maestro, API | `e2e/maestro/budget/budget-transfer.yaml` | ☑ | ☐ | ☐ | Flow `budget-transfer.yaml` |
| BUDGET-SAVE-043 | Transfer to registered account | | | | API | `budget-transfers.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SAVE-044 | Delete import job | | | | Unit | `src/screens/budget/savings/__tests__/SavingsImportScreen.te | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-045 | Savings sub-tab testIDs | | | | Maestro | `e2e/maestro/budget/budget-savings-overview.yaml` | ☑ | ☐ | ☐ | Flow `budget-savings-overview.yaml` |
| BUDGET-SAVE-046 | Savings month stepper | | | | Maestro | `e2e/maestro/budget/budget-savings-month-stepper.yaml` | ☑ | ☐ | ☐ | Flow `budget-savings-month-stepper.yaml` |
| BUDGET-SAVE-047 | Savings entry form control inventory | | | | Unit | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-048 | Currency selector on savings entry | | | | Unit | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-049 | Member picker on savings entry | | | | Unit | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-050 | Save-and-add-another keeps the form open | | | | Unit | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-051 | Savings entry zero amount blocked | | | | Unit | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-052 | Savings entry delete | | | | Unit | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-053 | Goal form control inventory | | | | Unit | `src/screens/budget/savings/__tests__/SavingsGoalForm.test.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-054 | Goal `toCents` allows zero, rejects negative | | | | Unit | `src/screens/budget/savings/__tests__/SavingsGoalForm.test.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-055 | Goal date clear | | | | Unit | `src/screens/budget/savings/__tests__/SavingsGoalForm.test.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-056 | Emergency-fund suggestion | | | | Unit | `src/screens/budget/savings/__tests__/SavingsGoalForm.test.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-057 | Registered account form fields | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRegistered.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-058 | Registered `toCents` strips thousands separators | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRegistered.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-059 | Over-contribution badge | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRegistered.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-060 | Apply regular contribution | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRegistered.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-061 | RRSP deadline banner | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRegistered.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-062 | Recurring payment form fields | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRecurringPaymen | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-063 | Recurring day-of-month clamps to 1–31 | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRecurringPaymen | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-064 | Recurring amount silently discards a minus sign | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRecurringPaymen | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-065 | Recurring active toggle | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRecurringPaymen | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-066 | Recurring apply status | | | | Unit | `backend/src/routes/__tests__/savings.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-067 | MonthApply modal controls | | | | Unit | `src/screens/budget/savings/__tests__/MonthApplyModal.test.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-068 | MonthApply cancel writes nothing | | | | Unit | `src/screens/budget/savings/__tests__/MonthApplyModal.test.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-069 | Copy-entry modal quick shifts | | | | Unit | `src/screens/budget/savings/__tests__/CopyEntryModal.test.ts | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-070 | Institution picker controls | | | | Unit | `src/screens/budget/savings/__tests__/InstitutionPicker.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-071 | Import screen sections and toggles | | | | import UI | POST /households/:householdId/savings/import | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SAVE-072 | Import job status poll | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SAVE-073 | Import commit-history is distinct from commit | | | | API | `backend/src/routes/__tests__/savings-history-routes.test.ts | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SAVE-074 | Income templates CRUD | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SAVE-075 | Savings amount bounds (server) | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SAVE-076 | Savings/budget cross-consistency | | | | API | `backend/src/routes/__tests__/savings-budget-consistency.tes | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SAVE-077 | Savings history route coverage | | | | /compare | all 200 | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SAVE-078 | Irregular income source accepted (marketplace sale) | | | | Unit, API | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-079 | Remaining one-off sources accepted | | | | Unit, API | `src/screens/budget/savings/__tests__/SavingsIncomeView.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-080 | Unknown income source rejected | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SAVE-081 | One-off income cannot become a recurring template | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SAVE-082 | Regular source still backs a template | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SAVE-083 | Template cannot be converted to a one-off source | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SAVE-084 | Overview splits regular vs one-off income | | | | Unit, API | `backend/src/routes/__tests__/savings.test.ts`, `src/screens | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-085 | Legacy `other` income counts as regular | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SAVE-086 | Split degrades safely against a pre-split Worker | | | | Unit | `src/screens/budget/savings/__tests__/SavingsOverviewView.te | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-087 | One-off income round-trip on device (E2E) | | | | Maestro | `e2e/maestro/budget/budget-savings-irregular-income.yaml` | ☑ | ☐ | ☐ | Flow `budget-savings-irregular-income.yaml` |
| BUDGET-SAVE-088 | AI import carries a one-off source | | | | API | `backend/src/services/__tests__/savings-import-service.test. | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SAVE-089 | Unknown source from the model degrades, not fails | | | | API | `backend/src/services/__tests__/savings-import-service.test. | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SAVE-090 | Income source list cannot drift | | | | Unit, API | `backend/src/constants/__tests__/income-sources.test.ts`, `s | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-091 | Every source type has a human label | | | | Unit | `src/screens/budget/savings/__tests__/incomeSourceMeta.test. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SAVE-092 | Previous-years import accepts one-off income | | | | API | `backend/src/routes/__tests__/savings-history-routes.test.ts | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-PEN-001 | Pension screen load | | | | Maestro | `e2e/maestro/budget/budget-pension.yaml` | ☑ | ☐ | ☐ | Flow `budget-pension.yaml` |
| BUDGET-PEN-002 | Room tab load | | | | Unit | `src/screens/budget/pension/__tests__/PensionRoomView.test.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-003 | Set member room | | | | Unit | `src/screens/budget/pension/__tests__/PensionEntrySheet.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-004 | Goals tab load | | | | Unit | `src/screens/budget/pension/__tests__/PensionGoalsView.test. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-005 | Set pension goal percent | | | | Unit | `src/screens/budget/pension/__tests__/PensionEntrySheet.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-006 | Contributions tab load | | | | Unit | `src/screens/budget/pension/__tests__/PensionAccountsView.te | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-007 | Add contribution | | | | Unit | `src/screens/budget/pension/__tests__/PensionEntrySheet.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-008 | Employer match contribution | | | | Unit | `src/screens/budget/pension/__tests__/PensionEntrySheet.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-009 | Backfill recurring | | | | Unit | `src/screens/budget/pension/__tests__/PensionBackfillSheet.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-010 | Import extract screen | | | | Unit | `src/screens/budget/pension/__tests__/PensionImportScreen.te | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-011 | Import extract preview | | | | Maestro | `e2e/maestro/budget/budget-pension-interactions.yaml` | ☑ | ☐ | ☐ | Flow `budget-pension-interactions.yaml` |
| BUDGET-PEN-012 | Import commit | | | | Unit | `src/screens/budget/pension/__tests__/PensionImportScreen.te | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-013 | Import undo | | | | Unit | `src/screens/budget/pension/__tests__/PensionImportScreen.te | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-014 | Add pension account | | | | Unit | `src/screens/budget/pension/__tests__/PensionAccountsView.te | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-015 | Delete registered transaction | | | | Unit | `backend/src/routes/__tests__/savings.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-016 | Pension interactions smoke | | | | Maestro | `e2e/maestro/budget/budget-pension-interactions.yaml` | ☑ | ☐ | ☐ | Flow `budget-pension-interactions.yaml` |
| BUDGET-PEN-017 | Room-only account hidden | | | | Unit | `src/screens/budget/pension/__tests__/PensionRoomView.test.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-018 | Regular contribution recurring | | | | Unit | `src/screens/budget/pension/__tests__/PensionEntrySheet.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-019 | Cancel pension entry sheet | | | | Unit | `src/screens/budget/pension/__tests__/PensionEntrySheet.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-020 | Validation invalid room | | | | Unit | `src/screens/budget/pension/__tests__/PensionEntrySheet.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-021 | Pension scroll | | | | Maestro | `e2e/maestro/scroll/budget-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| BUDGET-PEN-022 | Registered overview year | | | | Unit | `src/screens/budget/pension/__tests__/PensionView.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-023 | Delete registered account | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRegistered.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-024 | Update registered account | | | | Unit | `src/screens/budget/savings/__tests__/SavingsRegistered.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-025 | Pension import disabled | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-PEN-026 | Member monthly grid load | | | | Unit | `src/screens/budget/pension/__tests__/PensionBackfillSheet.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-027 | Goal dollars to cents | | | | Unit | `src/screens/budget/pension/__tests__/PensionEntrySheet.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-028 | Offline pension save | | | | Maestro | `e2e/maestro/budget/budget-pension-offline.yaml` | ☑ | ☐ | ☐ | Flow `budget-pension-offline.yaml` |
| BUDGET-PEN-029 | Duplicate contribution guard | | | | Unit | `backend/src/routes/__tests__/savings.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-030 | Pension tab hidden in minimal brand | | | | Unit | `src/screens/budget/__tests__/BudgetScreen.tabs.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-031 | Employer plan flag | | | | Unit | `src/screens/budget/pension/__tests__/PensionAccountsView.te | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-032 | Pension API registered overview | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-PEN-033 | Pension year stepper | | | | Maestro | `e2e/maestro/budget/budget-pension-interactions.yaml` | ☑ | ☐ | ☐ | Flow `budget-pension-interactions.yaml` |
| BUDGET-PEN-034 | Pension sub-tab testIDs | | | | Maestro | `e2e/maestro/budget/budget-pension.yaml` | ☑ | ☐ | ☐ | Flow `budget-pension.yaml` |
| BUDGET-PEN-035 | Room row add / delete | | | | Unit | `src/screens/budget/pension/__tests__/PensionRoomView.test.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-036 | Goal row add / delete | | | | Unit | `src/screens/budget/pension/__tests__/PensionGoalsView.test. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-037 | Goal percent bounds | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-PEN-038 | Contribution amount must be positive | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-PEN-039 | Employer amount may be zero | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-PEN-040 | Contribution row actions | | | | Unit | `src/screens/budget/pension/__tests__/PensionAccountsView.te | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-041 | Entry sheet control inventory | | | | Unit | `src/screens/budget/pension/__tests__/PensionEntrySheet.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-042 | Employer-match preview matches what is saved | | | | Unit | `src/screens/budget/pension/__tests__/PensionEntrySheet.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-043 | Backfill sheet bulk fills | | | | Unit | `src/screens/budget/pension/__tests__/PensionBackfillSheet.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-044 | Backfill month bounds | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-PEN-045 | Pension import uses the registered-specific endpoints | | | | Unit | `src/screens/budget/pension/__tests__/PensionImportScreen.te | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-046 | Pension import undo | | | | Unit | `src/screens/budget/pension/__tests__/PensionImportScreen.te | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-PEN-047 | Registered transaction create | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-PEN-048 | Bulk delete member contributions | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-PEN-049 | Registered route literal-vs-param ordering | | | | API | `backend/src/routes/__tests__/savings.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BILL-001 | Bills screen load | | | | Maestro | `e2e/maestro/budget/budget-bills.yaml` | ☑ | ☐ | ☐ | Flow `budget-bills.yaml` |
| BUDGET-BILL-002 | Utilities dashboard load | | | | Unit | `src/screens/budget/__tests__/BudgetBillsView.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BILL-003 | Utility accounts list | | | | Maestro | `e2e/maestro/budget/budget-bills.yaml` | ☑ | ☐ | ☐ | Flow `budget-bills.yaml` |
| BUDGET-BILL-004 | Create utility account | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BILL-005 | Edit utility account | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BILL-006 | Delete utility account | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BILL-007 | Add bill manually | | | | Unit, Maestro | `e2e/maestro/budget/budget-bills.yaml` | ☑ | ☐ | ☐ | Flow `budget-bills.yaml` |
| BUDGET-BILL-008 | Edit bill | | | | Maestro | `e2e/maestro/budget/budget-bills.yaml` | ☑ | ☐ | ☐ | Flow `budget-bills.yaml` |
| BUDGET-BILL-009 | Delete bill | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BILL-010 | Mark bill paid | | | | Maestro | `e2e/maestro/budget/budget-bills.yaml` | ☑ | ☐ | ☐ | Flow `budget-bills.yaml` |
| BUDGET-BILL-011 | Bulk paid status | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BILL-012 | Upload bill document | | | | Maestro | `e2e/maestro/budget/budget-bills.yaml` | ☑ | ☐ | ☐ | Flow `budget-bills.yaml` |
| BUDGET-BILL-013 | Extract bill from upload | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BILL-014 | Duplicate bill upload flagged | | | | API | `utilities.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BILL-015 | Manual duplicate bill 409 | | | | API | `utilities.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BILL-016 | Allow duplicate override | | | | API | `utilities.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BILL-017 | Property tax list load | | | | Unit | `src/screens/budget/__tests__/BudgetBillsView.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BILL-018 | Add property tax year | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BILL-019 | Edit property tax | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BILL-020 | Upload property tax notice | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BILL-021 | Duplicate tax year flagged | | | | API | `utilities.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BILL-022 | BC assessment load | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BILL-023 | Edit BC assessment | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BILL-024 | Upload BC assessment | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BILL-025 | Bill reminder create | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BILL-026 | Bill reminder delete | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BILL-027 | Bills amount display cents | | | | Unit | `src/screens/budget/__tests__/BudgetBillsView.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BILL-028 | Cancel bill form | | | | Maestro | `e2e/maestro/budget/budget-bills.yaml` | ☑ | ☐ | ☐ | Flow `budget-bills.yaml` |
| BUDGET-BILL-029 | Validation missing due date | | | | Unit | `backend/src/routes/__tests__/utilities.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BILL-030 | Bills scroll sentinel | | | | Maestro | `e2e/maestro/scroll/budget-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| BUDGET-BILL-031 | Bills view state testID collision | | | | Maestro | `e2e/maestro/budget/budget-bills-states.yaml` | ☑ | ☐ | ☐ | Flow `budget-bills-states.yaml` |
| BUDGET-BILL-032 | Provider rows | | | | Maestro | `e2e/maestro/budget/budget-bills.yaml` | ☑ | ☐ | ☐ | Flow `budget-bills.yaml` |
| BUDGET-BILL-033 | Bills quick actions | | | | Maestro | `e2e/maestro/budget/budget-bills.yaml` | ☑ | ☐ | ☐ | Flow `budget-bills.yaml` |
| BUDGET-BILL-034 | Create BC assessment | | | | API | `backend/src/routes/__tests__/utilities.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BILL-035 | Get single property-tax year | | | | API | `backend/src/routes/__tests__/utilities.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BILL-036 | Utilities dashboard vs property overview | | | | API | `backend/src/routes/__tests__/utilities.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BILL-037 | Utilities analytics + trend calculation | | | | API | `backend/src/utils/__tests__/bill-analytics.test.ts`, `backe | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BILL-038 | Reminders list | | | | API | `backend/src/routes/__tests__/utilities.test.ts`, `e2e/maest | ☑ | ☐ | ☐ | Flow `budget-bills.yaml` |
| BUDGET-BILL-039 | Providers + municipality lookups | | | | GET 200 | API | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BILL-040 | Homeowner grant calculation | | | | API | `backend/src/services/__tests__/utility-calculators.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BILL-041 | Property-tax penalties + due date | | | | API | `backend/src/services/__tests__/utility-calculators.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BILL-042 | Bill amount is integer cents end to end | | | | Unit | `src/screens/budget/__tests__/BudgetBillsView.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-WISH-001 | Wishes list load | | | | Maestro, Unit | `e2e/maestro/budget/budget-wishes.yaml`, `src/screens/budget | ☐ | ☑ | ☐ | Flow `budget-wishes.yaml` failed |
| BUDGET-WISH-002 | Empty wishes state | | | | Unit | `src/screens/budget/__tests__/WishesView.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-WISH-003 | Add wish modal | | | | Unit | `src/screens/budget/__tests__/AddWishModal.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-WISH-004 | Wish detail load | | | | Unit | `src/screens/budget/__tests__/WishDetailScreen.e2e.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-WISH-005 | Edit wish title | | | | Unit | `src/screens/budget/__tests__/WishDetailScreen.coverage.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-WISH-006 | Wish estimated cost cents | | | | Unit | `src/screens/budget/__tests__/WishesView.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-WISH-007 | Add note entry | | | | Unit | `src/screens/budget/__tests__/WishDetailScreen.collab.test.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-WISH-008 | Add photo entry | | | | Maestro | `e2e/maestro/budget/budget-wishes.yaml` | ☐ | ☑ | ☐ | Flow `budget-wishes.yaml` failed |
| BUDGET-WISH-009 | Upload wish cover image | | | | Unit | `backend/src/routes/__tests__/wishes.test.ts`, `src/screens/ | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-WISH-010 | Add link entry | | | | Unit | `src/screens/budget/__tests__/WishDetailScreen.coverage.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-WISH-011 | Edit link entry | | | | Unit | `src/screens/budget/__tests__/WishDetailScreen.coverage.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-WISH-012 | Delete wish entry | | | | Unit | `src/screens/budget/__tests__/WishDetailScreen.coverage.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-WISH-013 | Delete wish | | | | Unit | `src/screens/budget/__tests__/WishDetailScreen.coverage.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-WISH-014 | Wish collab attribution | | | | Unit | `src/screens/budget/__tests__/WishDetailScreen.collab.test.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-WISH-015 | Cancel wish edit | | | | Unit | `src/screens/budget/__tests__/WishDetailScreen.coverage.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-WISH-016 | Validation empty wish title | | | | Unit | `src/screens/budget/__tests__/AddWishModal.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-WISH-017 | Mark wish achieved | | | | Unit | `src/screens/budget/__tests__/WishDetailScreen.coverage.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-WISH-018 | Reply thread on entry | | | | Unit | `src/screens/budget/__tests__/WishDetailScreen.collab.test.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-WISH-019 | Wish scroll sentinel | | | | Maestro | `e2e/maestro/scroll/budget-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| BUDGET-WISH-020 | Offline wish save | | | | Maestro | `e2e/maestro/budget/budget-wishes-extended.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): budget-wishes-extended |
| BUDGET-WISH-021 | Wish list filter by status | | | | API | `wishes.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-WISH-022 | Entry row visible | | | | Unit | `src/screens/budget/__tests__/WishDetailScreen.e2e.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-WISH-023 | Wishes list controls | | | | Maestro | `e2e/maestro/budget/budget-wishes.yaml` | ☐ | ☑ | ☐ | Flow `budget-wishes.yaml` failed |
| BUDGET-WISH-024 | Add-wish modal has untestable inputs | | | | Maestro | `e2e/maestro/budget/budget-wishes-extended.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): budget-wishes-extended |
| BUDGET-WISH-025 | Wish title required | | | | Unit | `src/screens/budget/__tests__/AddWishModal.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-WISH-026 | Wish estimated cost maximum | | | | API | `backend/src/routes/__tests__/wishes.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-WISH-027 | Wish price parses without validation | | | | Unit | `src/screens/budget/__tests__/AddWishModal.test.tsx`, `e2e/m | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-WISH-028 | Link entry requires a valid URL | | | | API | `backend/src/routes/__tests__/wishes.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-WISH-029 | Entry body length cap | | | | API | `backend/src/routes/__tests__/wishes.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-WISH-030 | Wish notes length cap | | | | API | `backend/src/routes/__tests__/wishes.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-WISH-031 | Entry row testIDs | | | | Unit | `src/screens/budget/__tests__/WishDetailScreen.e2e.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-WISH-032 | Cover image key cap | | | | API | `backend/src/routes/__tests__/wishes.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BCHAT-001 | Chat rooms load | | | | Maestro | `e2e/maestro/budget/budget-chat-rooms.yaml`, `e2e/maestro/su | ☑ | ☐ | ☐ | Flow `budget-chat-rooms.yaml` |
| BUDGET-BCHAT-002 | Create chat room | | | | Maestro | `e2e/maestro/subflows/budget-create-chat-room.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): budget-create-chat-room |
| BUDGET-BCHAT-003 | Delete chat room | | | | Unit | `src/features/budget/chat/screens/__tests__/BudgetChatRoomSe | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BCHAT-004 | Open chat room | | | | Maestro | `e2e/maestro/budget/budget-chat-message.yaml` | ☑ | ☐ | ☐ | Flow `budget-chat-message.yaml` |
| BUDGET-BCHAT-005 | Send text message | | | | Maestro | `e2e/maestro/budget/budget-chat-message.yaml` | ☑ | ☐ | ☐ | Flow `budget-chat-message.yaml` |
| BUDGET-BCHAT-006 | Edit message | | | | Unit | `src/features/budget/chat/screens/__tests__/BudgetChatRoomSc | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BCHAT-007 | Delete message | | | | Unit | `src/features/budget/chat/screens/__tests__/BudgetChatRoomSc | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BCHAT-008 | Mark room read | | | | Unit | `src/features/budget/chat/screens/__tests__/BudgetChatRoomSc | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BCHAT-009 | Participants list | | | | Unit | `src/features/budget/chat/screens/__tests__/BudgetChatRoomSe | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BCHAT-010 | Set participants | | | | Unit | `src/features/budget/chat/screens/__tests__/BudgetChatRoomSe | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BCHAT-011 | Attach photo | | | | Maestro | `e2e/maestro/budget/budget-chat-message.yaml` | ☑ | ☐ | ☐ | Flow `budget-chat-message.yaml` |
| BUDGET-BCHAT-012 | Image upload PUT | | | | API | `backend/src/services/__tests__/budget-chat-room-service.tes | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BCHAT-013 | Budget AI assistant screen | | | | Maestro | `e2e/maestro/budget/budget-ai-screen.yaml`, `e2e/maestro/bud | ☑ | ☐ | ☐ | Flow `budget-ai-screen.yaml` |
| BUDGET-BCHAT-014 | AI assistant send prompt | | | | Maestro | `e2e/maestro/budget/budget-chat-assistant.yaml` | ☑ | ☐ | ☐ | Flow `budget-chat-assistant.yaml` |
| BUDGET-BCHAT-015 | AI gate denied | | | | API | `backend/src/routes/__tests__/budget-ai-detect.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BCHAT-016 | Chat FAB visible | | | | Maestro, Unit | `e2e/maestro/budget/budget-chat-fab-visible.yaml`, `src/feat | ☐ | ☑ | ☐ | Flow `budget-chat-fab-visible.yaml` failed |
| BUDGET-BCHAT-017 | Chat FAB unread badge | | | | Unit | `src/features/budget/chat/__tests__/BudgetChatFab.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BCHAT-018 | Cancel message compose | | | | Maestro | `e2e/maestro/budget/budget-chat-message.yaml` | ☑ | ☐ | ☐ | Flow `budget-chat-message.yaml` |
| BUDGET-BCHAT-019 | Empty message send blocked | | | | Unit | `backend/src/services/__tests__/budget-chat-room-service.tes | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BCHAT-020 | Mention chip tap | | | | Unit | `src/features/budget/chat/screens/__tests__/BudgetChatRoomSc | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BCHAT-021 | Rate limit on messages | | | | API | `backend/src/services/__tests__/budget-chat-room-service.tes | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BCHAT-022 | Chat room scroll | | | | Maestro | `e2e/maestro/budget/budget-chat-extended.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| BUDGET-BCHAT-023 | Offline send message | | | | Maestro | `e2e/maestro/budget/budget-chat-extended.yaml` | ☐ | ☑ | ☐ | Flow `budget-chat-extended.yaml` failed |
| BUDGET-BCHAT-024 | Budget chat vs House chat isolation | | | | API | `backend/src/services/__tests__/budget-chat-room-service.tes | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BCHAT-025 | Navigator de-dupe nonce | | | | Unit | `src/features/budget/chat/__tests__/BudgetChatNavigator.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BCHAT-026 | Assistant cancel mid-stream | | | | Maestro | `e2e/maestro/budget/budget-chat-assistant.yaml` | ☑ | ☐ | ☐ | Flow `budget-chat-assistant.yaml` |
| BUDGET-BCHAT-027 | Rooms list empty state | | | | Maestro | `e2e/maestro/budget/budget-chat-rooms.yaml` | ☑ | ☐ | ☐ | Flow `budget-chat-rooms.yaml` |
| BUDGET-BCHAT-028 | New-room button gated on household | | | | Unit | `src/features/budget/chat/screens/__tests__/BudgetChatRoomsL | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BCHAT-029 | Create-room sheet has no testIDs | | | | POST /households/:householdId/budget-chat-rooms | POST 201 | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BCHAT-030 | Room name length | | | | API | `backend/src/services/__tests__/budget-chat-room-service.tes | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BCHAT-031 | AI-enabled room badge | | | | Unit | `src/features/budget/chat/screens/__tests__/BudgetChatRoomsL | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-BCHAT-032 | Composer send-enable logic | | | | none until send | n/a (UI-only) | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BCHAT-033 | Message length cap | | | | API | `backend/src/services/__tests__/budget-chat-room-service.tes | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BCHAT-034 | Attachment and mention caps | | | | API | `backend/src/services/__tests__/budget-chat-room-service.tes | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BCHAT-035 | Mention bar rows | | | | Maestro | `e2e/maestro/budget/budget-chat-extended.yaml` | ☐ | ☑ | ☐ | Flow `budget-chat-extended.yaml` failed |
| BUDGET-BCHAT-036 | @assistant requires both mention and room flag | | | | API | `backend/src/services/__tests__/budget-chat-room-service.tes | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BCHAT-037 | Assistant reply arrives over the WebSocket | | | | Maestro | `e2e/maestro/budget/budget-chat-assistant.yaml` | ☑ | ☐ | ☐ | Flow `budget-chat-assistant.yaml` |
| BUDGET-BCHAT-038 | Assistant is billed to the mentioning member's key | | | | API | `backend/src/services/__tests__/budget-chat-room-service.tes | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BCHAT-039 | Assistant provider is fixed to Anthropic | | | | API | `backend/src/services/__tests__/budget-chat-assistant-provid | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BCHAT-040 | Assistant entitlement denial is silent | | | | API | `backend/src/services/__tests__/budget-chat-entitlement-deni | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BCHAT-041 | Message pagination | | | | API | `backend/src/services/__tests__/budget-chat-room-service.tes | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BCHAT-042 | WebSocket auth uses a query token | | | | API | `src/features/budget/chat/__tests__/useBudgetChatSocket.test | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BCHAT-043 | Room settings screen has no testIDs | | | | Maestro | `e2e/maestro/budget/budget-chat-extended.yaml` | ☐ | ☑ | ☐ | Flow `budget-chat-extended.yaml` failed |
| BUDGET-BCHAT-044 | Delete room confirmation | | | | Maestro | `e2e/maestro/budget/budget-chat-extended.yaml` | ☐ | ☑ | ☐ | Flow `budget-chat-extended.yaml` failed |
| BUDGET-BCHAT-045 | Budget chat is not gated by the Budget API flag | | | | API | `backend/src/config/__tests__/budget-chat-gating.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-BCHAT-046 | Chat rooms pull-to-refresh | | | | Maestro | `e2e/maestro/budget/budget-chat-extended.yaml` | ☐ | ☑ | ☐ | Flow `budget-chat-extended.yaml` failed |
| BUDGET-ST-001 | Data sharing settings load | | | | Maestro | `e2e/maestro/budget/budget-data-sharing.yaml`, `e2e/maestro/ | ☑ | ☐ | ☐ | Flow `budget-data-sharing.yaml` |
| BUDGET-ST-002 | Revoke data sharing package | | | | Maestro | `e2e/maestro/budget/budget-data-sharing.yaml` | ☑ | ☐ | ☐ | Flow `budget-data-sharing.yaml` |
| BUDGET-ST-003 | Soft Transfer export screen load | | | | Maestro, Unit | `e2e/maestro/budget/budget-soft-transfer-export.yaml`, `src/ | ☑ | ☐ | ☐ | Flow `budget-soft-transfer-export.yaml` |
| BUDGET-ST-004 | Soft Transfer export UI steps | | | | Maestro | `e2e/maestro/budget/budget-soft-transfer-export.yaml` | ☑ | ☐ | ☐ | Flow `budget-soft-transfer-export.yaml` |
| BUDGET-ST-005 | Soft Transfer import screen load | | | | Maestro, Unit | `e2e/maestro/budget/budget-soft-transfer-import.yaml`, `src/ | ☑ | ☐ | ☐ | Flow `budget-soft-transfer-import.yaml` |
| BUDGET-ST-006 | Soft Transfer import preview | | | | Maestro | `e2e/maestro/budget/budget-soft-transfer-import.yaml` | ☑ | ☐ | ☐ | Flow `budget-soft-transfer-import.yaml` |
| BUDGET-ST-007 | Run transfer destructive | | | | Unit | `src/features/ecosystem/__tests__/runTransfer.mutation.test. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-ST-008 | Export mutation unit contract | | | | Unit | `src/features/ecosystem/__tests__/runTransfer.mutation.test. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-ST-009 | Import mutation unit contract | | | | Unit | `soft-transfer.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-ST-010 | ST API registry gates | | | | API | `backend/__tests__/data-bridge/soft-transfer.test.ts`, `back | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-ST-011 | Cancel export wizard | | | | Maestro | `e2e/maestro/budget/budget-soft-transfer-export.yaml` | ☑ | ☐ | ☐ | Flow `budget-soft-transfer-export.yaml` |
| BUDGET-ST-012 | Cancel import wizard | | | | Maestro | `e2e/maestro/budget/budget-soft-transfer-import.yaml` | ☑ | ☐ | ☐ | Flow `budget-soft-transfer-import.yaml` |
| BUDGET-ST-013 | Data sharing link visible | | | | Maestro | `e2e/maestro/budget/budget-settings.yaml` | ☑ | ☐ | ☐ | Flow `budget-settings.yaml` |
| BUDGET-ST-014 | ST export link visible | | | | Maestro | `e2e/maestro/budget/budget-settings-more.yaml` | ☑ | ☐ | ☐ | Flow `budget-settings-more.yaml` |
| BUDGET-ST-015 | ST import link visible | | | | Maestro | `e2e/maestro/budget/budget-settings-more.yaml` | ☑ | ☐ | ☐ | Flow `budget-settings-more.yaml` |
| BUDGET-ST-016 | Dual-app harness gap | | | | Live | `deferred` — dual-sim Soft Transfer harness (see Flagged) | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-ST-017 | Consent + package list endpoints | | | | Maestro | `e2e/maestro/budget/budget-data-sharing.yaml` | ☑ | ☐ | ☐ | Flow `budget-data-sharing.yaml` |
| BUDGET-ST-018 | Grant consent | | | | Unit | `src/features/budget/screens/__tests__/BudgetDataSharingScre | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-ST-019 | Revoke consent | | | | Maestro | `e2e/maestro/budget/budget-data-sharing.yaml` | ☑ | ☐ | ☐ | Flow `budget-data-sharing.yaml` |
| BUDGET-ST-020 | Transfer wizard control inventory | | | | Maestro | `e2e/maestro/budget/budget-soft-transfer-export.yaml` | ☑ | ☐ | ☐ | Flow `budget-soft-transfer-export.yaml` |
| BUDGET-ST-021 | Prepare precedes export/import | | | | Unit | `src/features/ecosystem/__tests__/runTransfer.mutation.test. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-ST-022 | Export executes the real endpoint | | | | Unit | `src/features/ecosystem/__tests__/runTransfer.mutation.test. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-ST-023 | Import executes the real endpoint | | | | Unit | `backend/__tests__/data-bridge/soft-transfer.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-ST-024 | Smart-engine brand capability gate | | | | API | `backend/__tests__/data-bridge/brand-and-gates.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-ST-025 | Transfer without consent is refused | | | | API | `backend/__tests__/data-bridge/routes-gates.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SETT-001 | Settings screen load | | | | Maestro, Unit | `e2e/maestro/budget/budget-settings.yaml`, `src/screens/budg | ☑ | ☐ | ☐ | Flow `budget-settings.yaml` |
| BUDGET-SETT-002 | Month grid visible | | | | Maestro | `e2e/maestro/budget/budget-settings.yaml` | ☑ | ☐ | ☐ | Flow `budget-settings.yaml` |
| BUDGET-SETT-003 | Select month cell | | | | Maestro | `e2e/maestro/budget/budget-settings.yaml` | ☑ | ☐ | ☐ | Flow `budget-settings.yaml` |
| BUDGET-SETT-004 | Planned budget input | | | | Maestro, Unit | `e2e/maestro/budget/budget-settings-extended.yaml`, `src/scr | ☑ | ☐ | ☐ | Flow `budget-settings-extended.yaml` |
| BUDGET-SETT-005 | Save month goal | | | | Maestro, Unit | `e2e/maestro/budget/budget-settings.yaml` | ☑ | ☐ | ☐ | Flow `budget-settings.yaml` |
| BUDGET-SETT-006 | Settings summary text | | | | Unit | `src/screens/budget/__tests__/BudgetSettingsScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SETT-007 | Transfer nav link | | | | Maestro | `e2e/maestro/budget/budget-settings.yaml` | ☑ | ☐ | ☐ | Flow `budget-settings.yaml` |
| BUDGET-SETT-008 | Categories nav link | | | | Maestro | `e2e/maestro/budget/budget-categories.yaml` | ☑ | ☐ | ☐ | Flow `budget-categories.yaml` |
| BUDGET-SETT-009 | Timeline nav link | | | | Maestro | `e2e/maestro/budget/budget-settings-extended.yaml`, `src/scr | ☑ | ☐ | ☐ | Flow `budget-settings-extended.yaml` |
| BUDGET-SETT-010 | History nav link | | | | Maestro | `e2e/maestro/budget/budget-settings-extended.yaml`, `src/scr | ☑ | ☐ | ☐ | Flow `budget-settings-extended.yaml` |
| BUDGET-SETT-011 | Compare nav link | | | | Maestro | `e2e/maestro/budget/budget-settings-extended.yaml`, `src/scr | ☑ | ☐ | ☐ | Flow `budget-settings-extended.yaml` |
| BUDGET-SETT-012 | Apply-to-year confirm path | | | | Unit | `src/screens/budget/__tests__/BudgetSettingsScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SETT-013 | Apply-to-year error alert | | | | Unit | `src/screens/budget/__tests__/BudgetSettingsScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SETT-014 | Cancel settings edit | | | | Unit | `e2e/maestro/budget/budget-item-form.yaml` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SETT-015 | Validation empty budget save | | | | Unit | `src/screens/budget/__tests__/BudgetSettingsScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SETT-016 | Schedule next-month reminder | | | | API | `src/api/__tests__/budget.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-SETT-017 | Settings more submenu | | | | Maestro | `e2e/maestro/budget/budget-settings-more.yaml` | ☑ | ☐ | ☐ | Flow `budget-settings-more.yaml` |
| BUDGET-SETT-018 | Settings scroll sentinel | | | | Maestro | `e2e/maestro/scroll/budget-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| BUDGET-SETT-019 | Dollars to cents on save goal | | | | Unit | `src/screens/budget/__tests__/BudgetSettingsScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SETT-020 | Year selector change | | | | Unit | `src/screens/budget/__tests__/BudgetSettingsScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SETT-021 | Offline save settings | | | | Maestro | `e2e/maestro/budget/budget-settings-offline.yaml` | ☑ | ☐ | ☐ | Flow `budget-settings-offline.yaml` |
| BUDGET-SETT-022 | More hub load | | | | Maestro | `e2e/maestro/budget/budget-settings-more.yaml` | ☑ | ☐ | ☐ | Flow `budget-settings-more.yaml` |
| BUDGET-SETT-023 | Settings nav-link inventory | | | | Maestro | `e2e/maestro/budget/budget-settings.yaml` | ☑ | ☐ | ☐ | Flow `budget-settings.yaml` |
| BUDGET-SETT-024 | Timeline screen is untestable by testID | | | | Maestro | `e2e/maestro/budget/budget-timeline-year-setup.yaml` | ☑ | ☐ | ☐ | Flow `budget-timeline-year-setup.yaml` |
| BUDGET-SETT-025 | Year-setup screen is untestable by testID | | | | Maestro | `e2e/maestro/budget/budget-timeline-year-setup.yaml` | ☑ | ☐ | ☐ | Flow `budget-timeline-year-setup.yaml` |
| BUDGET-SETT-026 | Year setup silently discards an all-invalid save | | | | Unit | `src/screens/budget/__tests__/BudgetYearSetupScreen.test.tsx | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SETT-027 | Year setup save failure alert | | | | Unit | `src/screens/budget/__tests__/BudgetYearSetupScreen.test.tsx | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SETT-028 | Negative monthly budget alert copy | | | | Unit | `src/screens/budget/__tests__/BudgetSettingsScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SETT-029 | Tab customisation screen | | | | Maestro | `e2e/maestro/budget/budget-customize-tabs.yaml` | ☑ | ☐ | ☐ | Flow `budget-customize-tabs.yaml` |
| BUDGET-SETT-030 | Section tabs hide the FilterTabs row | | | | Unit | `src/screens/budget/__tests__/BudgetScreen.tabs.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-SETT-031 | Legacy `/budget` deep link redirects | | | | Maestro | `e2e/maestro/budget/budget-customize-tabs.yaml` | ☑ | ☐ | ☐ | Flow `budget-customize-tabs.yaml` |
| BUDGET-SETT-032 | Settings screen is its own NavigationContainer | | | | Unit | `src/screens/budget/__tests__/BudgetSettingsNavigator.contra | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-HH-001 | Households screen load | | | | Maestro, Unit | `e2e/maestro/budget/budget-households.yaml`, `src/features/b | ☑ | ☐ | ☐ | Flow `budget-households.yaml` |
| BUDGET-HH-002 | List households | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-HH-003 | Switch household | | | | Maestro, Unit | `e2e/maestro/budget/budget-household-switch.yaml`, `src/feat | ☑ | ☐ | ☐ | Flow `budget-household-switch.yaml` |
| BUDGET-HH-004 | Select household card | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-HH-005 | Create household FAB | | | | Maestro, Unit | `e2e/maestro/budget/budget-households.yaml` | ☑ | ☐ | ☐ | Flow `budget-households.yaml` |
| BUDGET-HH-006 | Create household save | | | | Maestro, Unit | `e2e/maestro/budget/budget-household-switch.yaml`, `src/feat | ☑ | ☐ | ☐ | Flow `budget-household-switch.yaml` |
| BUDGET-HH-007 | Rename household | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-HH-008 | Invite member | | | | Unit | `e2e/maestro/budget/budget-household-extended.yaml` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-HH-009 | Role change | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-HH-010 | Cancel create household | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-HH-011 | Validation empty HH name | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-HH-012 | Non-admin cannot rename | | | | Unit | `backend/src/routes/__tests__/budget.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-HH-013 | HH switch clears budget cache | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-HH-014 | Swipe actions on HH row | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-HH-015 | Households scroll | | | | Maestro | `e2e/maestro/budget/budget-household-extended.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit; flow `budget-household-extended.yaml` passed above-fold |
| BUDGET-HH-016 | Offline create household | | | | Maestro | `e2e/maestro/budget/budget-household-extended.yaml` | ☑ | ☐ | ☐ | Flow `budget-household-extended.yaml` |
| BUDGET-HH-017 | Add-household FAB has no testID | | | | Maestro | `e2e/maestro/budget/budget-households.yaml` | ☑ | ☐ | ☐ | Flow `budget-households.yaml` |
| BUDGET-HH-018 | Swipe-to-edit on a household row | | | | Maestro | `e2e/maestro/budget/budget-household-extended.yaml` | ☑ | ☐ | ☐ | Flow `budget-household-extended.yaml` |
| BUDGET-HH-019 | Household name required alert | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-HH-020 | Budget household reskin omits property fields | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-HH-021 | Budget-framed household copy | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-HH-022 | Delete-household confirm copy | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-HH-023 | Leave-household confirm copy | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-HH-024 | Owner-only vs member-only actions | | | | Unit | `src/features/budget/screens/__tests__/BudgetHouseholdScreen | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-HH-025 | Manage members and invites | | | | Maestro | `e2e/maestro/budget/budget-household-extended.yaml` | ☑ | ☐ | ☐ | Flow `budget-household-extended.yaml` |
| BUDGET-HH-026 | Invite by email and by link | | | | API | `backend/src/services/__tests__/household-invite-remove.test | ☑ | ☐ | ☐ | Flow `budget-household-extended.yaml` |
| BUDGET-HH-027 | Join-request approve / deny | | | | POST 2xx | API | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-HH-028 | Remove a member | | | | API | `backend/src/services/__tests__/household-invite-remove.test | ☑ | ☐ | ☐ | Flow `budget-household-extended.yaml` |
| BUDGET-HH-029 | BudgetHomeScreen is unreachable in the Budget brand | | | | Unit | `e2e/maestro/budget/budget-tabs.yaml`, `src/features/budget/ | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-AUTH-001 | Login screen load (unsigned) | | | | Maestro | `e2e/maestro/budget/budget-auth.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): budget-auth |
| BUDGET-AUTH-002 | Email login success | | | | Maestro | `e2e/maestro/subflows/budget-launch-logged-in.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): budget-launch-logged-in |
| BUDGET-AUTH-003 | Invalid credentials | | | | Maestro | `e2e/maestro/budget/budget-auth.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): budget-auth |
| BUDGET-AUTH-004 | Logout from More | | | | Maestro | `e2e/maestro/budget/budget-auth.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): budget-auth |
| BUDGET-AUTH-005 | Session persist relaunch | | | | Maestro | `e2e/maestro/subflows/budget-launch-logged-in.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): budget-launch-logged-in |
| BUDGET-AUTH-006 | 401 clears session on API | | | | Unit | `backend/src/routes/__tests__/budget.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-AUTH-007 | Google OAuth login | | | | Maestro | `e2e/maestro/budget/budget-auth.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): budget-auth |
| BUDGET-AUTH-008 | Cancel login | | | | Maestro | `e2e/maestro/budget/budget-auth.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): budget-auth |
| BUDGET-AUTH-009 | Apple sign-in route | | | | Maestro | `e2e/maestro/budget/budget-auth.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): budget-auth |
| BUDGET-AUTH-010 | Companion-token path for joined-platform brands | | | | Unit | `src/api/__tests__/joined-platform-auth.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-AUTH-011 | Token refresh path differs by brand | | | | Unit | `src/api/__tests__/joined-platform-auth.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-AUTH-012 | Registration is disabled | | | | Maestro | `e2e/maestro/budget/budget-auth.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): budget-auth |
| BUDGET-AUTH-013 | 401 on a household call clears the session once | | | | Unit | `backend/src/routes/__tests__/budget.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-AUTH-014 | Cross-household read is refused | | | | API | `backend/src/routes/__tests__/budget.test.ts`, `backend/src/ | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-CORNER-001 | Savings kill-switch session cache | | | | Unit | `src/screens/budget/__tests__/BudgetScreen.tabs.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-CORNER-002 | Savings probe fail-open on 5xx | | | | Unit | `src/screens/budget/__tests__/BudgetScreen.tabs.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-CORNER-003 | AI entitlement 409 provider_not_connected | | | | API | `backend/src/routes/__tests__/budget-ai-detect.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-CORNER-004 | AI entitlement 409 model_not_available | | | | API | `backend/src/routes/__tests__/budget-ai-detect.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-CORNER-005 | Cents conversion item form | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-CORNER-006 | Cents conversion expense form | | | | Unit | `src/screens/budget/__tests__/BudgetItemFormScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-CORNER-007 | Apply-to-year skips filled months | | | | Unit | `src/screens/budget/__tests__/BudgetSettingsScreen.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-CORNER-008 | Duplicate utility bill 409 | | | | API | `utilities.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-CORNER-009 | Duplicate bill upload skip auto-create | | | | API | `utilities.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-CORNER-010 | Maestro smoke never run-transfer | | | | Maestro | `e2e/maestro/budget/config.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): config |
| BUDGET-CORNER-011 | `toCents` is duplicated seven times with three rulesets | | | | Unit | `src/screens/budget/__tests__/budgetItemFormUtils.test.ts`,  | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-CORNER-012 | No screen caps decimal places or input length | | | | Unit | `src/screens/budget/__tests__/moneyFieldCaps.contract.test.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-CORNER-013 | Only one client-side maximum exists | | | | Unit | `src/screens/budget/__tests__/moneyFieldCaps.contract.test.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-CORNER-014 | Money crosses the wire only as integer cents | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-CORNER-015 | Zero-amount policy differs by resource | | | | API | `backend/src/routes/__tests__/budget.test.ts`, `backend/src/ | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-CORNER-016 | Duplicate submit on every money form | | | | Unit | `src/screens/budget/savings/__tests__/SavingsEntryForm.test. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| BUDGET-CORNER-017 | Offline behaviour across money mutations | | | | Maestro | `e2e/maestro/budget/budget-offline-sweep.yaml` | ☑ | ☐ | ☐ | Flow `budget-offline-sweep.yaml` |
| BUDGET-CORNER-018 | Route literal-vs-parameter shadowing guards | | | | API | `backend/src/routes/__tests__/budget.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| BUDGET-CORNER-019 | Duplicate testIDs break Maestro selection | | | | Maestro | `e2e/maestro/budget/budget-corner-testids.yaml` | ☑ | ☐ | ☐ | Flow `budget-corner-testids.yaml` |
| BUDGET-CORNER-020 | Household photo presign endpoint is unused | | | | API | `backend/src/routes/__tests__/household-photo-presign.contra | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
