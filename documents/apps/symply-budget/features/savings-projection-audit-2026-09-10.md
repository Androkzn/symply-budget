# Savings / Projection audit — 2026-09-10

## Outcome and scope

The identical method cards have a reproducible code cause. This audit replaced
the local-first projection path with the user-approved three-scenario model and
fixed an Overview YTD inconsistency. It does **not** certify the screenshot's
household balances: the encrypted device ledger was not decrypted or exported.

Specs: [BRD](../../../requirements/Savings%20Projection/Savings_Projection_BRD.md) ·
[TRD](../../../requirements/Savings%20Projection/Savings_Projection_TRD.md).

## Evidence from the screenshot

All four cards and the headline show CA$38,842. Recorded/banked is CA$20,866,
with three future months and a CA$30,000 goal. The displayed difference is
CA$17,976, or CA$5,992 per future month on average. This arithmetic is visible
evidence only; it does not establish which entries or caps generated the totals.

## Findings

| Finding | Evidence in original code | Resolution |
|---|---|---|
| High: any entered future month bypasses all formulas | `projectFor` and `compareValueFor` return `row.net` whenever `enteredMonths` contains the month. Income in Oct/Nov/Dec therefore flattens all cards, even if spending is missing. | Component forecasts retain entered income and still estimate spending. |
| High: goals manufacture forecast cashflow | Current target uses `max(actual,target)`; future targets replace forecast; Hybrid may immediately return monthly goal allocation. | Goals are independent benchmarks in scenario model. |
| High: Overview YTD discards income-only elapsed months | `computeYtdNet` skips `inc != 0 && spend == 0`; Year History does not. | Removed the skip; API regression asserts reconciliation. |
| Medium: Trend does not advance by forecast month | A single `trendMonthly` is reused for all future months. | Legacy Trend is no longer a user-facing algorithm in local-first scenarios. |
| Medium: Planned Budget income can repeat windfalls | Fallback uses all completed-month income, not recent regular-only income. | New estimates use regular income only; one-offs are month-specific. |
| Medium: current month is not actually forecast | Old path uses recorded net/target; December can read "year complete" while still open. | Full-month estimate for current month; explicit open-month caption. |
| Medium: comparison cards and headline can disagree | Comparison skips targets that override the selected headline. | Same monthly scenario values drive cards, headline and chart. |
| Medium: unsupported default action | Local `setDefaultProjectionMethod` throws `BudgetLocalUnsupportedError`. | Scenario taps now persist the app-wide household preference on this device; implicit readers share it after hydration. Remote legacy behavior retained. |
| Medium: request completion order can switch the displayed method/year | `load` unconditionally sets the response; target save sets the default response. | Generation guard, error clearing and selected-scenario refetch. |
| Coverage: historical sample can be fabricated by recurring schedules | Old `hasData` can be true from configured commitments alone. | Scenario history requires recorded income and expenses, with coverage warnings. |

## Independent calculation fixture

This is synthetic regression data, **not the user's ledger**. June/August range
from CA$6,000 to CA$10,000 income and CA$2,000 to CA$4,000 spending, with July
at CA$8,000/CA$3,000. September has CA$4,000 recorded income and CA$1,000
spending. Oct–Dec each have CA$9,000 entered income and a CA$3,500 Planning budget.

The old engine produces identical comparison cards. New independently checked totals:

| Contribution | Cautious | Base | Optimistic |
|---|---:|---:|---:|
| Completed net | CA$15,000 | CA$15,000 | CA$15,000 |
| September full-month forecast | CA$3,500 | CA$5,000 | CA$6,500 |
| Oct–Dec forecast | CA$15,000 | CA$16,500 | CA$18,000 |
| Year end | **CA$33,500** | **CA$36,500** | **CA$39,500** |

The test also explicitly proves that a flat dataset can legitimately yield
equal scenarios. The UI explains equality; it never adds artificial differences.

## Implementation and verification

- `src/features/budget/local/savings/scenarioProjection.ts`: pure scenario engine.
- `localSavingsApi.ts`: live local API routing; no HTTP or ledger writes for reads.
- `localSavingsProjector.ts`: Overview YTD fix. Legacy method helper retained for metadata/compatibility.
- `src/api/savings.ts`: optional scenario and monthly breakdown contract.
- `SavingsProjectionView.tsx`: three scenarios, range, goal separation, monthly breakdowns and request ordering.
- `BudgetDashboardView.tsx`: describe the new scenario rather than the legacy method.
- Scenario/API/component tests cover formulas, invariants and selection races.

Final verification: **35 suites / 657 tests passed**; `npx tsc --noEmit` passed;
focused production/engine-test ESLint passed with **0 errors / 2 existing style warnings**;
`git diff --check` passed. Full-file ESLint also exposes pre-existing dynamic-require
and test-hook errors in the legacy API/component-test files; these are not claimed
as a repository-wide clean lint run. The broad Savings suite includes income, recurring payments, goals, registered accounts, imports,
history/compare, overview, projection, Home, API and store tests; passing those
tests is not a fresh legal/tax review of registered-account rules.

## Real data and release boundary

The connected iPhone 13 Pro has Budget `com.symply.budget` version 1.0.1 (81),
with an encrypted SQLite ledger in its app container. There is no active Budget
Hermes debugger on the local Metro endpoints. A normal LLDB attach did not
complete; it was detached and closed. No ledger export or decryption key was
obtained. No raw personal data or secrets were added to this repository.

Remaining evidence needed: a Budget export containing income, expenses,
recurring-payment scopes and monthly Planning caps; then reconcile Overview,
Year History and every forecast month against those records. Do not represent
the synthetic fixture as a reconciliation of CA$38,842.

Changes are in the Budget client checkout. No Worker/D1 change is needed.
Native rendering on the new build, release through the main checkout, and the
real-household reconciliation remain separate, uncompleted checks.

## Follow-up: scenario scope and downside assumptions

Scenario selection now persists per household on this device and refreshes Home and widget/Watch forecast data. Cautious retains Base spending; the new Pessimistic scenario combines lower income with higher spending. Explanations expose the budget adjustment instead of attributing every decline to income. Explicit income remains authoritative; matching scenarios are legitimate.
