# Bulk Purchases (stock-up spreading) - Technical Requirements Document

| Field | Value |
|-------|-------|
| **Doc type** | Feature TRD |
| **Feature id** | `budget-bulk-purchases` |
| **Owning app** | `simple-budget` |
| **Status** | `as-built v1` on `budget-v2` (2026-09-11); device verification pending |
| **Version** | `v0.2` |
| **Created** | 2026-09-11 |
| **Last updated** | 2026-09-11 |
| **Feature BRD** | [Bulk_Purchases_BRD.md](./Bulk_Purchases_BRD.md) |
| **Implementation** | [Bulk_Purchases_Implementation.md](./Bulk_Purchases_Implementation.md) |
| **App TRD** | [documents/apps/symply-budget/TRD.md](../../apps/symply-budget/TRD.md) |
| **Canonical V2 TRD** | [Symply_Budget_TRD_v2.0.md](../Buget%20v2/Symply_Budget_TRD_v2.0.md) |

---

## 0. Version History

| Version | Date | Changes |
|---------|------|---------|
| v0.1 | 2026-09-11 | Initial technical proposal |
| v0.2 | 2026-09-11 | As built: months 2..12; `bulkOverview.ts` added for screens; the source-grep invariant replaced by the cross-surface API test (`localBudgetBulk.test.ts`); no legacy/remote path (owner Q4). |

---

## 1. Requirement Inventory

| BR | Technical answer | Section |
|----|------------------|---------|
| BR-01, BR-02, BR-03 | `BudgetBulkPurchaseSection` inside `BudgetItemFormScreen`; `localBudgetApi.getBulkSuggestion` | §5, §6, §7 |
| BR-04, BR-05 | `splitEvenly` in `src/features/budget/bulk/bulkSplit.ts`; portions derived, never stored | §4 |
| BR-06 | `monthExpenseView` is the single month reader; every read site in §8 routes through it | §8 |
| BR-07, BR-08, BR-14 | `MonthlyOverview.bulkPortions`; Spendings list group + chips; dynamic forward cap | §7 |
| BR-09 | One row, one field, one op: `EXPENSE_UPDATE` with `bulk` | §4, §5 |
| BR-10 to BR-13 | Estimator ladder | §6 |
| BR-15 | `BudgetTransferContext.bulkDeferredCents` | §5 |
| BR-16 to BR-19 | Phase 2 of the implementation plan | Implementation §4 |

---

## 2. Architecture And Ownership

```text
src/features/budget/bulk/                 pure, no I/O, unit-tested
├── bulkTypes.ts                          constants (2..12, default 3, preview 12); type re-exports
├── bulkSplit.ts                          splitEvenly, planMonths, countedCentsForMonth, forEachCounted,
│                                         spentByMonth, monthExpenseView, lastPlanMonth, normalizeBulkPlan
├── bulkEstimate.ts                       estimateBulkMonths (the ladder), describeBulkSuggestion
└── bulkOverview.ts                       reading a MonthlyOverview on the month lens (screens)

src/features/budget/local/localBudgetApi.ts
    addExpense / addExpensesBulk / updateExpense accept `bulk`
    getBulkSuggestion (new)
    every month-scoped helper reads through monthExpenseView

src/api/budget.ts                         Expense.bulk, MonthlyOverview.bulkPortions, request types

src/screens/budget/
├── BudgetBulkPurchaseSection.tsx         toggle + suggestion + stepper + preview (new)
├── BudgetItemFormScreen.tsx              mounts the section, sends `bulk` on save
├── BudgetSpendingsView.tsx               chips, "From bulk purchases" group, forward cap
└── BudgetTransferScreen.tsx              reserved-cash line
```

| Concern | Owner |
|---------|-------|
| Split math and month view | `src/features/budget/bulk/bulkSplit.ts` |
| Estimator | `src/features/budget/bulk/bulkEstimate.ts` |
| Persistence and ops | `localBudgetApi` over the existing engine (`mutateLocalLedger`, `runOnHousehold`) |
| UI | Budget screens listed above; no navigator change |
| Backend | None in v1. The Worker stores sealed rows and never parses them. |

Why a pure module: the ledger helpers in `localBudgetApi.ts`, the Savings projector, the export summary and the home teaser all recompute "this month's spending" independently today (§8). The bulk feature is exactly the kind of change that goes wrong when one of them is missed, so the month view becomes one function and the read sites become callers.

---

## 3. Feature Gates And Entitlements

| Gate | Rule |
|------|------|
| Brand | `isFullBudget()` true (Budget). House `minimal` never renders the section. |
| Transport | `isBudgetLocalFirst()` true. The remote D1 implementation does not implement `getBulkSuggestion` and would silently strip `bulk` from an insert (zod strips unknown keys), so the section is not rendered on the remote path. |
| Entitlement | None. No AI, no paid tier. |
| Kind | Spent spendings only. Planned spendings and the planned→recorded flow (`recordPlannedSpending`) do not offer it in v1. |

---

## 4. Data Model

### 4.1 Row field

Added to `Expense` in `src/api/budget.ts` and therefore to the local ledger row (`buildExpenseRow` in `localBudgetApi.ts`):

```ts
/** How the estimator arrived at its suggestion. Kept for display and for later product evaluation. */
export type BulkEstimateBasis =
  | 'own_precedent'     // the household's previous bulk plan for this product
  | 'product_rate'      // this product's spend per month over its history
  | 'product_cadence'   // this product's purchase interval and typical size
  | 'related_products'  // lexicon relatives / aliases in the same category
  | 'category_rate'     // the category's spend per month (narrow categories only)
  | 'default';          // no usable history

/** Spreads a stock-up purchase over consecutive months. Absent or null = ordinary spending. */
export interface ExpenseBulkPlan {
  /** Consecutive months the purchase covers. 2..12 (owner Q2). */
  months: number;
  /** 'YYYY-MM' of the first portion. v1 always writes the purchase month. */
  start_month: string;
  /** What the estimator proposed when the plan was saved; null when it had nothing to say. */
  suggested_months: number | null;
  basis: BulkEstimateBasis | null;
  /** Measured quantity when the member or a receipt stated one (Phase 2). */
  quantity?: number | null;
  /** Unit exactly as entered or printed ("kg", "lb", "pack"). */
  unit?: string | null;
}

export interface Expense {
  // ...existing fields unchanged...
  bulk?: ExpenseBulkPlan | null;
}
```

Design rules:

- **Portions are derived, never stored.** `splitEvenly(amount, months)` gives `base = floor(amount / months)` cents to every month and one extra cent to the first `amount − base × months` months. Two devices holding the same row always render the same split, and editing the amount can never leave a stale portion array behind.
- **One field, one LWW slot.** The plan is a single top-level field of the row, so the per-field last-writer-wins merge in `@symply/local-first` resolves concurrent edits as one decision, never as a half-merged schedule.
- **`start_month` exists for the future**, not for v1 UI. A "start next month" option is a one-line change later; the reader (§4.2) already honours it.
- **`expense_date` stays the purchase date.** Sync bucketing (`WINDOWED_DATE_FIELDS.expenses` in `projection.ts`) is unchanged. Budget does not opt into a resident window (`residentWindowDays` unset in `BUDGET_LEDGER_SCHEMA`), so every parent row is always in memory and its portions are always visible. If Budget ever adopts a window, parents with an active plan must stay resident.
- **Backup, restore, export, Soft Transfer:** the field rides inside the row body. Backup and restore need no change. Exports add two columns (§8).
- **No legacy path (owner Q4).** There are no real users and no old data: no D1 columns, no Worker change, no shims for older clients. The remote `budgetApi.getBulkSuggestion` rejects, and the form renders the section only on the local-first path.

### 4.2 Derived month view

```ts
export interface BulkPortionView {
  expenseId: string;
  title: string;
  category_id: string | null;
  vendor: string | null;
  purchase_date: string;   // expense_date of the parent
  start_month: string;
  months: number;
  index: number;           // 1-based position of this portion
  portion_cents: number;
  total_cents: number;     // parent amount
}

export interface MonthExpenseView {
  /** Rows dated in the month. For a bulk parent, `countedCents` is its first portion, not its amount. */
  counted: Array<{ expense: Expense; countedCents: number; portion: BulkPortionView | null }>;
  /** Portions of purchases made in EARLIER months that land in this month. */
  reserved: BulkPortionView[];
  /** Σ counted + Σ reserved. This is "spent this month". */
  totalCents: number;
  /** Cash paid this month that is counted in later months (Σ parent amount − first portion). */
  deferredCents: number;
  /** Discounts and deposits stay with the purchase event (purchase month only). */
  savedCents: number;
  depositsCents: number;
  byCategoryCents: Map<string, number>;   // portions attributed to the parent's category
}

export function monthExpenseView(expenses: readonly Expense[], year: number, month: number): MonthExpenseView;
export function portionForMonth(expense: Expense, monthKey: string): number;   // 0 when none lands there
export function planMonths(plan: ExpenseBulkPlan): string[];                    // 'YYYY-MM' list
```

`monthExpenseView` is one pass over the ledger's expenses. A bulk parent contributes to every month in `planMonths(plan)`; an ordinary row contributes its amount to its own month. Complexity is O(rows), the same as today's filters.

### 4.3 Facade additions

`MonthlyOverview` (in `src/api/budget.ts`) gains optional fields so older responses and the remote path keep working:

```ts
/** Every portion landing in this month, including the purchase-month one. */
bulkPortions?: BulkPortionView[];
/** Σ portions from earlier months (the "From bulk purchases" group). */
bulkReservedTotal?: number;
/** Cash paid this month but counted in later months. */
bulkDeferredTotal?: number;
```

`actualSpent` becomes `monthExpenseView(...).totalCents`. `expenses` stays "rows dated in the month" (the copy-to-month flow and the list key off it); the list renders a parent's counted portion from `bulkPortions`.

---

## 5. API Contract (local facade)

| Method | Change |
|--------|--------|
| `addExpense(hid, input)` | `input.bulk?: { months; start_month?; suggested_months?; basis?; quantity?; unit? }`. `start_month` defaults to the month of `expense_date`. Validation (`normalizeBulkPlan`, before any write): `months` integer 2..12; `start_month` is the purchase month or later, never earlier. |
| `addExpensesBulk(hid, items)` | Same per item (receipt review, Phase 2). |
| `updateExpense(hid, id, data)` | `data.bulk?: ExpenseBulkPlan \| null`. `null` clears the plan. Changing `expense_date` on a planned row re-anchors `start_month` to the new month when it was equal to the old one. One `EXPENSE_UPDATE` op, payload includes `bulk`. |
| `deleteExpense` | Unchanged; the plan dies with the row. |
| `getBulkSuggestion(hid, input)` | New. `input: { title; category_id?; amount; saved_amount?; expense_date; quantity?; unit?; exclude_expense_id? }` → `BulkSuggestion` (§6.4). Read-only, resolves its ledger with `getLocalLedgerFor(hid)`. |
| `getMonthlyOverview(hid, y, m)` | Adds `bulkPortions`, `bulkReservedTotal`, `bulkDeferredTotal`; `actualSpent` from the month view. |
| `getTransferContext(hid, y, m)` | Adds `bulkDeferredCents` (BR-15). `leftoverCents` stays `max(0, planned − actualSpent)` on the month lens (BRD Q1). |
| `getCategoryProductTrends` | `byMonth[].amount` from portions; `count` and `currentCount` count purchase events (parents) only. |
| `getExpenses(hid, { year, month })` | Unchanged semantics (rows dated in the month). Callers that need the month's counted amounts use the overview. |

Remote (`remoteBudgetApi`): no change in v1. The proxy in `src/api/budget.ts` falls through to remote for `getBulkSuggestion`, which does not exist there; the UI never calls it on that path (§3).

---

## 6. Estimator

### 6.1 Principle

Estimate the household's **consumption rate** for what was bought, in regular-price money per month, and divide the purchase into it. Money is the only unit every row has; quantity refines it when both sides carry one (Phase 2).

Two corrections make the money rate honest:

- **Regular-price equivalent.** `equiv(row) = amount + saved_amount`. A stock-up is usually cheaper per unit; comparing its discounted price against full-price history would shorten the estimate. When the member records the discount (the form already has "On sale / discount"; receipt scanning fills `saved_amount` automatically), the comparison happens at regular price.
- **History is read through the month lens.** Previous bulk purchases contribute their portions, not their spike, so a household that always stocks up still has a smooth consumption series to learn from, and each purchase event counts once for cadence.

### 6.2 Inputs

```ts
interface BulkEstimateInput {
  title: string;
  categoryId: string | null;
  amountCents: number;          // tax-inclusive, as saved
  savedCents: number;           // 0 when no discount
  purchaseDate: string;         // 'YYYY-MM-DD'
  quantity?: number | null;
  unit?: string | null;
  excludeExpenseId?: string | null;   // the row being edited
  expenses: readonly Expense[];        // the household ledger
  categories: readonly BudgetCategory[];
  aliases: readonly ReceiptAliasHint[];        // listAliasHints()
  lexiconRelatives: (normalizedName: string) => string[];   // budgetNameLexicon
  today?: string;
}
```

Product identity: `key = normalizeName(title)` (from `budgetNameSuggestions.ts`). `relatedKeys = lexiconRelatives(key) ∪ alias names whose alias maps to title`, also normalised. "Completed months" means calendar months strictly before the purchase month. Lookback windows are measured backwards from the purchase month, not from today, so editing an old purchase re-derives the same suggestion.

### 6.3 Ladder

Rungs are tried in order. The first rung with enough evidence produces the number; a later rung may only adjust confidence.

| Rung | Basis | Evidence required | Estimate | Confidence |
|------|-------|-------------------|----------|------------|
| R0 | `own_precedent` | The most recent purchase with the same key **and** a bulk plan, within 24 months | `plan.months × equiv(new) / equiv(precedent)` | high |
| R1 | `product_rate` | ≥ 2 purchase events with the same key in the trailing 12 completed months, spanning ≥ 2 distinct months | `rate = Σ portions counted in [first event month .. last completed month] / span months` (zero months included); `equiv(new) / rate` | high if events ≥ 4 and span ≥ 4 months, else medium |
| R2 | `product_cadence` | ≥ 3 purchase events with the same key (cross-check of R1) | `g = median gap in days`, `a = median equiv per event`; `equiv(new) / a × g / 30.44` | Adjusts R1: agree within 25% → one notch up; disagree by more than 50% → one notch down. Final number = round(mean(R1, R2)). Used alone only when R1 is absent (all events in one month). |
| R3 | `related_products` | R1 evidence over `relatedKeys` in the same category (or any category when `categoryId` is null) | As R1 on the union | medium at most |
| R4 | `category_rate` | Category has spend in ≥ 3 of the last 6 completed months **and** is narrow: ≤ 5 distinct product keys, or the product plus relatives hold ≥ 50% of category spend | `equiv(new) / mean monthly category spend` | low |
| R5 | `default` | none | 3 | none |

Post-processing:

- `raw` from the winning rung; `months = clamp(round(raw), 2, 12)`.
- `raw < 1.5` → `months = 2`, flag `looksRegularSize = true` (copy in BRD §4). The member can still save it.
- R4 never fires for broad categories (Groceries with dozens of products) because `$400 / $900` would suggest "1 month" for salmon. The narrowness test is what keeps the rung honest; when it fails, R5 answers.

Quantity path (Phase 2): when `quantity` and `unit` are present and ≥ 2 history events of the same key carry the same unit, R1 runs in units per month instead of cents per month and reports basis `product_rate` with `unit` in the evidence. Unit comparison is by normalised string equality only; no conversion table.

### 6.4 Output

```ts
export interface BulkSuggestion {
  months: number;                       // 2..12
  basis: BulkEstimateBasis;
  confidence: 'high' | 'medium' | 'low' | 'none';
  looksRegularSize: boolean;
  evidence: {
    productLabel: string;               // display spelling from the vocabulary
    eventCount: number;
    firstEventDate: string | null;
    monthlyRateCents: number | null;
    medianGapDays: number | null;
    relatedLabels: string[];
    categoryName: string | null;
    precedentMonths: number | null;
    unit: string | null;
  };
  explanation: string;                  // BRD §4 copy, composed on device
}
```

The preview (per-month portion and remaining budget after it) is **not** part of the suggestion. The section computes it from `splitEvenly(amount, months)`, the goals (`planned_budget` per month) and `monthExpenseView` of each month with `excludeExpenseId` removed, so it updates on every stepper tap without another ledger read. `getBulkSuggestion` returns the goal and counted total for each of the next 24 months alongside the suggestion (`monthContext: Array<{ month; plannedBudget: number | null; countedCents: number }>`) so the form has what it needs in one call.

### 6.5 Learning

There is no separate model or store. The saved plan **is** the memory: R0 reads `plan.months` (what the member chose), not `suggested_months`. `suggested_months` and `basis` are kept so the "accepted unchanged" rate can be computed on device for product evaluation, and so the edit form can show "Suggested 4, you chose 6".

---

## 7. State And UX Behavior

### 7.1 Record spending form

- State: `isBulk: boolean`, `bulkMonths: number`, `bulkSuggestion: BulkSuggestion | null`, `bulkMonthsTouched: boolean`. Added to `BudgetItemFormValues` so the unsaved-changes baseline sees them.
- Toggle on → call `getBulkSuggestion` with the current title, category, amount, saved amount and date; while it resolves show the stepper at 3 with "Estimating…"; on result set `bulkMonths = suggestion.months` unless the member already touched the stepper.
- Title, category, amount, discount or date change while the toggle is on → re-estimate, debounced 250 ms; the stepper keeps a touched value.
- Save → `bulk: { months, start_month: purchase month, suggested_months, basis, quantity, unit }`. Editing an existing plan and toggling off → `bulk: null`.
- Editing a plan whose earlier months are closed (before the current month) shows "Changes earlier months too" under the stepper (BRD Q3).
- Gate: section rendered only when `isSpentForm && isFullBudget() && isBudgetLocalFirst()`.

### 7.2 Spendings list

- `counted` rows render as today with the amount replaced by `countedCents` and a chip `Bulk · 1 of N · <total> total` when the row has a plan.
- `reserved` rows render in a "From bulk purchases" group below the month's recorded spendings; amount is the portion; chip `Bulk purchase · <Mon YYYY> · i of N`; tap opens `BudgetItemForm` with `expenseId` of the parent; no swipe actions; not selectable in multi-select.
- Forward navigation cap: `max(current month, last month of any plan in the ledger)`. The overview supplies `bulkLastMonth` (or the view computes it from `bulkPortions` of the loaded months). A future month with nothing reserved shows the existing empty state.
- Copy-to-month (BR-16, P2): the parent copies with `bulk: { ...plan, start_month: destination }`.

### 7.3 Dashboard

- Donut and totals already come from `overview.actualSpent`; nothing to change once the overview is on the month view.
- The category breakdown (`BudgetDashboardView.tsx` line 590 reads `overview.expenses`) switches to `bulkPortions` merged with counted rows so a reserved portion appears under its category.

### 7.4 Transfer screen

- "Budget … · Spent …" line unchanged; a third caption "Includes … reserved for later months from bulk purchases" when `bulkDeferredCents > 0`.

---

## 8. Month-Lens Read Sites (the sweep)

Every place that computes a month or a year from `expense_date` today. Each becomes a caller of `monthExpenseView` or a helper built on it (`spentByMonth(expenses)` for multi-month scans). Nothing else may filter `expenses` by date for a total.

| File | Symbol / line | Change |
|------|---------------|--------|
| `src/features/budget/local/localBudgetApi.ts` | `spentInMonth` (105), `spentByMonthKey` (112) | Use the view; `spentByMonthKey` becomes a one-pass expansion of every plan. |
| same | `savedInMonth` (219), `depositsInMonth` (225) | Unchanged semantics (purchase month), but implemented via the view for one code path. |
| same | `computeSubBudgetProgress` (244) | Per-category spend from `byCategoryCents`. |
| same | `getMonthlyOverview` (942) | `actualSpent`, `bulkPortions`, `bulkReservedTotal`, `bulkDeferredTotal`. |
| same | `getCategoryProductTrends` (1235) | `byMonth` amounts from portions; counts from events. |
| same | `getTransferContext` (1111) | `bulkDeferredCents`. |
| same | `getEncouragement` (1184), `getInsights` (1224) | Via overview; no change. Phase 2 adds bulk context to the Insights prompt. |
| `src/features/budget/local/savings/localSavingsProjector.ts` | `budgetSpendingsTotal` (128), `hasExpenseData` (242), yearly scans (470, 525, 734), month filter (1093) | Month lens (BRD Q1). `hasExpenseData` stays "any row dated in month" so a reserved-only month does not count as observed history. |
| `src/features/budget/local/savings/scenarioProjection.ts` | `spendingFor` (42), observation guard (58) | Same rule as above. |
| `src/features/budget/local/export/localBudgetSummary.ts` | 68–85 | Month and YTD totals from portions; the home teaser, widget and Watch read this. |
| `src/features/budget/local/export/budgetWorkbook.ts`, `budgetLedgerExport.ts` | 126, 94 | Rows stay events; add `bulk_months` and `bulk_start_month` columns; the monthly summary sheet uses portions. |
| `src/features/budget/insights/budgetInsightsFingerprint.ts` | 52–74 | Hash `bulkPortions` too, so a plan edit regenerates Insights. |
| `src/screens/budget/BudgetDashboardView.tsx` | 590 | Category breakdown from counted + reserved. |
| `src/screens/budget/BudgetSpendingsView.tsx` | `renderExpenseBody` (953), `blockForwardMonth` (1088), copy flow (382) | §7.2. |
| `src/screens/budget/BudgetAllSpendingScreen.tsx`, `budgetAllSpendingUtils.ts` | fetch at 90 | List stays events with a "Bulk · N mo" chip; the trend chart buckets by portions. |
| `src/screens/budget/BudgetCategoryDetailScreen.tsx`, `budgetCategoryTrendsUtils.ts` | via trends | No change beyond the API. |
| `src/screens/budget/BudgetItemAIScreen.tsx` | 222–232 | Writes ordinary expenses; no change (AI hint is Phase 2). |
| `src/features/budget/budgetSnapshot.ts` | via overview / summary | No change. |
| `src/features/budget/local/backup/budgetBackup.ts` | rows pass through | No change. |

The invariant is asserted at the API, not by grepping the tree: `localBudgetBulk.test.ts` records one stock-up and checks that the overview, the goal row, the sub-budget caps, the product trends and the transfer context all agree on what each month counts. Date filters that remain (`getExpenses(year, month)`, the savings "observed month" guards, the name vocabulary) mean "rows dated in the month" on purpose and are not totals.

**All spending explorer** (`BudgetAllSpendingScreen`) is the one deliberately transaction-based surface: its list, tiles and chart are purchase events at cash amounts (count and average only make sense on transactions). Bulk rows there carry the plan on the row; a month-lens chart for it is Phase 5.

---

## 9. Security, Privacy, And Consent

- The plan lives inside the sealed row body; the Worker relays ciphertext and never learns that a purchase is bulk.
- No new network call. `getBulkSuggestion` is a ledger read.
- Telemetry: at most `budget_bulk_toggle` with `{ basis, confidence, accepted_unchanged: boolean }`. No amounts, names or month counts.

---

## 10. Observability

- `__DEV__` console line from the estimator: rung chosen, event count, span, raw estimate. Never amounts in release.
- The E2E observability hook (`recordE2EPersistEntry`) already logs persisted ops; `EXPENSE_UPDATE` payloads will show the `bulk` field for Maestro assertions.

---

## 11. Testing Strategy

| Layer | Tests (as built) |
|-------|-------|
| `bulkSplit` (pure) | `src/features/budget/bulk/__tests__/bulkSplit.test.ts` — exact sums with remainder-first cents; December crossing; malformed plans count in full; counted vs reserved vs deferred; category attribution; a plan starting later than the purchase month; reserved ordering; `lastPlanMonth`; `normalizeBulkPlan` validation. 100% lines and branches. |
| `bulkEstimate` (pure, fixtures) | `bulkEstimate.test.ts` — every rung R0–R5, precedent recency and quantity scaling, rate with zero months in the span, cadence agree/disagree, lexicon and alias relatives in both directions, narrow vs broad category and the dominance rule, regular-price equivalent, `looksRegularSize`, purchase-month anchoring, `excludeExpenseId`, clamps, zero-amount history, every `describeBulkSuggestion` sentence. 100% lines, 97% branches (the rest are unreachable guards such as `rate <= 0` after an active month). |
| `bulkOverview` (pure) | `bulkOverview.test.ts` — portion lookup, reserved split, counted amounts, category roll-up, null/legacy overviews. 100%. |
| `localBudgetApi` | `src/features/budget/local/__tests__/localBudgetBulk.test.ts` — the cross-surface invariant: one stock-up, then the overview, goal row, sub-budget caps, product trends, transfer context and `getBulkSuggestion` (`monthContext`, `exclude_expense_id`, own-precedent learning) agree on what each month counts; re-spread on months/amount/date edits; `bulk: null` restores; invalid plans refused without a write; batched save; delete. |
| Savings / summary | Existing projector, scenario and summary suites stay green on the month lens (`localSavingsApi.test.ts`, `localBudgetSummary.test.ts`, export suites). |
| Screens (RNTL) | `BudgetBulkPurchaseSection.test.tsx` (stepper bounds, loading, empty amount, overrun, closed-months note); `BudgetItemFormScreen.bulk.test.tsx` (estimate on toggle, stepper wins over a later estimate, ordinary spendings never spread, saved plan loads as decision and clears with `bulk: null`); `BudgetSpendingsView.bulk.test.tsx` (counted amount + chip, "From bulk purchases" group, tap opens the purchase, forward cap); `BudgetTransferScreen.bulk.test.tsx` (reserved-cash line). |
| E2E (Maestro, `Budget-A`) | `e2e/maestro/budget/budget-bulk-purchase.yaml` — BUDGET-BULK-001…005: toggle + estimate, stepper → 4 months, save shows "Bulk · 1 of 4", forward month lists the reserved share, reserved row opens the purchase. Registered in `config.yaml` after `budget-item-form`; rows in `documents/engineering/testing/matrices/budget.md`. |

---

## 12. Rollout And Deployment

- Client only. Lands on `budget-v2` (app client code), no `main`/Worker change, no D1 migration.
- Ships to real phones over the air with `eas update` on `symply-budget-production` (runtime 1.0.0, no native change).
- No feature flag beyond the existing local-first gate: the field is optional and older builds ignore it.
- Docs: add the row to `documents/apps/symply-budget/features/README.md` (done with this proposal); update this TRD's status when shipped.

---

## 13. Open Questions / Blockers

| # | Question | Status |
|---|----------|--------|
| T1 | Savings recorded net on the month lens (BRD Q1). | answered yes; built |
| T2 | Re-spread all months vs freeze closed months (BRD Q3). | answered: re-spread all; built |
| T3 | Whether `getExpenses(year, month)` should also return reserved rows. | no; the overview carries `bulkPortions`; built |
| T4 | Remote/D1 parity. | none (BRD Q4) |

---

## 14. Acceptance

- [x] §4 types added to the facade and the ledger row; portions derived only.
- [x] `monthExpenseView` is the only month reader (§8 sweep complete; cross-surface API test green).
- [x] Estimator ladder implemented with the fixture suite in §11.
- [x] Form section, Spendings chips and group, forward cap, Transfer line.
- [ ] Every device in a two-device household shows identical month totals after sync (manual check on `Budget-A` / `Budget-B`).
- [x] BRD Q1–Q4 answered and reflected here.
