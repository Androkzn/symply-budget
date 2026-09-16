# Bulk Purchases (stock-up spreading) - Implementation Plan

| Field | Value |
|-------|-------|
| **Doc type** | Implementation plan |
| **Feature id** | `budget-bulk-purchases` |
| **Owning app** | `simple-budget` |
| **Status** | Phases 1–4 built on `budget-v2` (2026-09-11); Phase 5 open; Phase 6 dropped (owner Q4) |
| **Version** | `v0.2` |
| **Created** | 2026-09-11 |
| **Last updated** | 2026-09-11 |
| **BRD** | [Bulk_Purchases_BRD.md](./Bulk_Purchases_BRD.md) |
| **TRD** | [Bulk_Purchases_TRD.md](./Bulk_Purchases_TRD.md) |
| **Branch** | `budget-v2` (client code only) |

---

## Agent Kickoff Prompt

```text
Read first:
1. documents/requirements/Bulk Purchases/Bulk_Purchases_BRD.md
2. documents/requirements/Bulk Purchases/Bulk_Purchases_TRD.md
3. src/features/budget/local/localBudgetApi.ts (month helpers, addExpense, getMonthlyOverview)
4. src/screens/budget/BudgetItemFormScreen.tsx (discount toggle at ~1062, save at ~658)
5. src/screens/budget/BudgetSpendingsView.tsx (renderExpenseBody ~953, blockForwardMonth ~1088)
6. src/features/budget/local/__tests__/localBudgetApi.test.ts and ledgerTestKit.ts

Rules:
- Work on budget-v2 in this clone. No backend change, no migration, no deploy:fleet.
- Phases are ordered so each one is green on its own: npm test, npm run lint, tsc.
- Never git commit unless asked. Never run prettier --write (config has drifted).
- Do not filter expenses by date anywhere new; go through monthExpenseView.
```

---

## 0. Version History

| Version | Date | Changes |
|---------|------|---------|
| v0.1 | 2026-09-11 | Initial plan |

---

## 1. Readiness Gate

| Check | Status |
|-------|--------|
| BRD Q1 (Savings on the month lens) answered | yes |
| BRD Q2 (stepper max) answered | 12 |
| BRD Q3 (re-spread all vs freeze closed months) answered | re-spread all |
| BRD Q4 (remote parity) answered | none; no legacy path at all |
| `budget-v2` clean and merged with `main` (daily merge rule) | clean at start |
| Root `npm test` green on the branch before touching anything | budget suites green at start |

---

## 2. Non-Goals

- No Worker, D1 or migration work (Phase 6 is optional and separate).
- No new tab, screen or navigator route. The reserved rows open the existing `BudgetItemForm`.
- No AI on the core path. Phase 5 only adds context to existing BYOK flows.
- No custom or uneven portions; no "start next month" UI.
- No change to House `minimal`.

---

## 3. File Plan

| File | Action | Phase |
|------|--------|-------|
| `src/features/budget/bulk/bulkTypes.ts` | new: `ExpenseBulkPlan`, `BulkEstimateBasis`, `BulkPortionView`, `MonthExpenseView`, `BulkSuggestion` | 1 |
| `src/features/budget/bulk/bulkSplit.ts` | new: `splitEvenly`, `planMonths`, `portionForMonth`, `monthExpenseView`, `spentByMonth` | 1 |
| `src/features/budget/bulk/__tests__/bulkSplit.test.ts` | new | 1 |
| `src/api/budget.ts` | `Expense.bulk`, `MonthlyOverview.bulkPortions/bulkReservedTotal/bulkDeferredTotal`, request types, `BudgetTransferContext.bulkDeferredCents`; re-export bulk types | 1 |
| `src/features/budget/local/localBudgetApi.ts` | `AddExpenseInput.bulk`, `buildExpenseRow`, `updateExpense`, month helpers via the view, `getMonthlyOverview`, `getTransferContext`, `getCategoryProductTrends` | 1 |
| `src/features/budget/local/__tests__/localBudgetApi.test.ts` (+ new `localBudgetBulk.test.ts`) | tests | 1 |
| `src/features/budget/bulk/bulkEstimate.ts` | new: ladder, explanation copy | 2 |
| `src/features/budget/bulk/__tests__/bulkEstimate.test.ts` | new, fixtures | 2 |
| `src/features/budget/local/localBudgetApi.ts` | `getBulkSuggestion` | 2 |
| `src/screens/budget/BudgetBulkPurchaseSection.tsx` | new: toggle, headline + stepper, basis line, preview list, footer | 3 |
| `src/screens/budget/BudgetItemFormScreen.tsx` | mount section; form values; save payload; edit load | 3 |
| `src/screens/budget/BudgetSpendingsView.tsx` | chips, "From bulk purchases" group, forward cap, copy flow | 3 |
| `src/screens/budget/BudgetTransferScreen.tsx` | reserved line | 3 |
| `src/screens/budget/__tests__/*` | RNTL tests for the three screens | 3 |
| `src/features/budget/local/savings/localSavingsProjector.ts`, `scenarioProjection.ts` | month lens | 4 |
| `src/features/budget/local/export/localBudgetSummary.ts`, `budgetWorkbook.ts`, `budgetLedgerExport.ts` | month lens; export columns | 4 |
| `src/features/budget/insights/budgetInsightsFingerprint.ts` | hash portions | 4 |
| `src/screens/budget/BudgetDashboardView.tsx` | category breakdown | 4 |
| `src/screens/budget/BudgetAllSpendingScreen.tsx`, `budgetAllSpendingUtils.ts` | chip + chart bucketing | 4 |
| `src/features/budget/bulk/__tests__/monthLensInvariant.test.ts` | source-tree grep invariant | 4 |
| `src/screens/budget/BudgetReceiptScanScreen.tsx`, `src/features/budget/local/ai/prompts/budgetInsights.ts`, `parseBudgetItemsText.ts` | Phase 5 | 5 |
| `documents/apps/symply-budget/features/README.md` | index row (done with the proposal); status updates | each |
| `e2e/` Maestro flow for `Budget-A` | Phase 3/4 | 4 |

---

## 4. Phases

### Phase 1 - Data model and month lens core

1. Add types (`bulkTypes.ts`) and re-export from `src/api/budget.ts`.
2. Implement `bulkSplit.ts`:
   - `splitEvenly(amountCents, months)` with the remainder-first rule.
   - `planMonths(plan)` from `start_month`, crossing years.
   - `portionForMonth(expense, monthKey)`.
   - `monthExpenseView(expenses, year, month)` returning counted / reserved / totals / byCategory / deferred.
   - `spentByMonth(expenses)` one-pass map for multi-month callers.
3. `localBudgetApi.ts`:
   - `AddExpenseInput.bulk`, validation (2..24, start month = purchase month or later), `buildExpenseRow` writes `bulk` (or `null`).
   - `updateExpense` accepts `bulk` (`null` clears) and re-anchors `start_month` on date change.
   - `spentInMonth`, `spentByMonthKey`, `savedInMonth`, `depositsInMonth`, `computeSubBudgetProgress` through the view.
   - `getMonthlyOverview` adds `bulkPortions`, `bulkReservedTotal`, `bulkDeferredTotal`.
   - `getTransferContext` adds `bulkDeferredCents`.
   - `getCategoryProductTrends` amounts from portions, counts from events.
4. Tests listed in TRD §11 for `bulkSplit` and `localBudgetApi`.

Acceptance: a $400 expense with `bulk.months = 4` yields `actualSpent = 100` in each of four consecutive months, `bulkDeferredTotal = 300` in the first, sub-budget caps see $100 per month, deleting it clears all four. `npm test`, `npm run lint`, `npx tsc --noEmit` green.

### Phase 2 - Estimator

1. `bulkEstimate.ts`: product key and related keys (lexicon + aliases), consumption series through the month lens, rungs R0–R5, cadence cross-check, clamps, `looksRegularSize`, explanation copy (BRD §4), evidence object.
2. `localBudgetApi.getBulkSuggestion(hid, input)`: resolves ledger, categories and aliases; returns `BulkSuggestion` plus `monthContext` for the next 24 months (planned budget and counted total, excluding `exclude_expense_id`).
3. Fixture suite: one ledger fixture per rung, plus the "Salmon logged as Fish" case and the discount-equivalent case.

Acceptance: fixture suite green; a debug run against the tester ledger (`__DEV__` log) shows sensible rungs for the household's real coffee and salmon rows.

### Phase 3 - UI

1. `BudgetBulkPurchaseSection.tsx`:
   - Props: `enabled`, `onToggle`, `months`, `onChangeMonths`, `suggestion`, `loading`, `preview` (rows from `splitEvenly` + `monthContext`), `totalCents`, `touchesClosedMonths`.
   - Layout follows the discount toggle row; stepper with accessibility labels; preview rows in a grouped list; footer sentence.
2. `BudgetItemFormScreen.tsx`:
   - State `isBulk`, `bulkMonths`, `bulkTouched`, `bulkSuggestion`, `bulkMonthContext`; add to `BudgetItemFormValues` and both baseline builders.
   - Debounced (250 ms) `getBulkSuggestion` on toggle-on and on title/category/amount/discount/date change.
   - Save: `bulk` on `addExpense` / `updateExpense`; `null` when toggled off in edit.
   - Edit load: hydrate from `expense.bulk`.
   - Gate on `isSpentForm && isFullBudget() && isBudgetLocalFirst()`.
3. `BudgetSpendingsView.tsx`:
   - Counted rows: amount from `bulkPortions` when the row has a plan; chip "Bulk · i of N · total".
   - "From bulk purchases" group from `reserved` portions; chip "Bulk purchase · Mon YYYY · i of N"; tap → edit parent; excluded from selection.
   - Forward cap: `max(current, lastPlanMonth)`; `lastPlanMonth` from the overview (`bulkLastMonth`) or a light ledger read.
   - Copy flow: carry `bulk` re-anchored (BR-16 can land here cheaply).
4. `BudgetTransferScreen.tsx`: reserved-cash caption.
5. RNTL tests for the three screens; Maestro flow on `Budget-A` (open Simulator, use the live-report runner).

Acceptance: the worked example in BRD §4 reproduces on the simulator; screenshots attached to the features index row.

### Phase 4 - Month-lens sweep and invariant

1. Savings projector and scenario projection through the view (BRD Q1). Keep "observed month" = any row dated in the month.
2. `localBudgetSummary` (home teaser, widget, Watch), workbook and ledger export columns, Insights fingerprint, dashboard category breakdown, All spending chip and chart.
3. `monthLensInvariant.test.ts`: read the source tree, assert no `expense_date.startsWith(` / `expenseInMonth(` outside the allow-list.
4. Two-device convergence check on `Budget-A` / `Budget-B`: record on A, assert identical month totals on B after sync.

Acceptance: invariant test green; Savings, Home, Widget and Dashboard agree on the month total for a month containing a bulk purchase.

### Phase 5 - Refinements (separate ticket, after v1 feedback)

- Receipt review per-line "Bulk" chip using the receipt's `quantity` / `unit`; save through `addExpensesBulk` with `bulk` per line.
- Persist `quantity` / `unit` on ordinary expenses from receipts so the unit path of R1 starts learning.
- Insights prompt context: "Bulk purchases this month: Salmon $400 spread over 4 months (counts $100)".
- "Add in words" parser sets a `bulk_hint` when the text says stock-up / bulk / Costco / N packs; the form pre-toggles.
- v1.1 option for BRD Q3: freeze closed months on edit.

### Phase 6 - Remote parity (optional, only if BRD Q4 says so)

- D1 migration (claim the next number on `main`): `expenses.bulk_months`, `expenses.bulk_start_month`.
- Worker: expense routes accept and return the fields; monthly overview, sub-budgets, trends and encouragement amortise.
- `deploy:fleet` from the `main` checkout, both envs, migrations both envs.

---

## 5. Data And Migration Plan

| Item | Plan |
|------|------|
| Local ledger | One optional row field. No schema version bump; `normalizeLedger` needs nothing. Older rows read as `bulk` undefined = ordinary. |
| Sync | Field-level LWW on `bulk`. Older peers ignore it (documented divergence until they update). |
| Backup / restore | Pass-through. Add a restore test asserting the field survives a round trip. |
| Export | Two new columns; existing consumers unaffected. |
| D1 | None in v1. |

---

## 6. QA Plan

| Gate | Command / action |
|------|------------------|
| Unit | `npm test -- bulk` then full `npm test` |
| Types / lint | `npx tsc --noEmit`, `npm run lint` |
| Screens | RNTL suites in `src/screens/budget/__tests__/` |
| Device | Maestro flow on `Budget-A` via the live-report runner; Simulator window open; report opened as the run starts |
| Two-device | `Budget-A` / `Budget-B` convergence (Phase 4) |
| Regression | Existing Savings projection suites (variable/flat history, YTD consistency) stay green after Phase 4 |

---

## 7. Deployment Plan

- Client-only; land on `budget-v2`, merge `main` first per BRANCHING.md, land with `--merge`.
- `eas update` on `symply-budget-production` (runtime 1.0.0). No native rebuild.
- Update TRD status to `shipped`, features index row, and the app BRD "Last updated".

---

## 8. Open Gaps

| Gap | Owner | Notes |
|-----|-------|-------|
| BRD Q1–Q4 | Product owner | Blocks Phase 4 (Q1), the stepper max (Q2), edit semantics (Q3), Phase 6 (Q4) |
| Copy review for the six basis sentences | Product owner | Draft copy in BRD §4 |
| Whether the All spending chart should show portions or events | Product owner | Proposal: portions (consistent with the dashboard) |

---

## 9. Completion Checklist

- [x] Phase 1 green (types, split, month view, local API, tests) — `bulkSplit.test.ts`, `localBudgetBulk.test.ts`
- [x] Phase 2 green (estimator, suggestion API, fixtures) — `bulkEstimate.test.ts`
- [x] Phase 3 green (form section, list chips/group, forward cap, transfer line, RNTL) — `*.bulk.test.tsx`, `BudgetBulkPurchaseSection.test.tsx`; Maestro `budget-bulk-purchase.yaml` written and registered (matrix BUDGET-BULK-001…006)
- [x] Phase 4 sweep (savings, exports, summary, fingerprint, dashboard breakdown); two-device convergence check still owed
- [x] Docs updated (this plan, TRD status, features index)
- [ ] Shipped over the air; TRD status `shipped`
