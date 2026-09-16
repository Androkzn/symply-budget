# Savings Projection — Feature Requirements

| Field | Value |
|---|---|
| Feature id | savings-cashflow-scenarios |
| Owning app | Symply Budget |
| Status | Accepted direction; implementation under verification |
| Version / date | v1.0 / 2026-09-10 |
| App BRD | [Budget BRD](../../apps/symply-budget/BRD.md) |
| Technical contract | [Projection TRD](./Savings_Projection_TRD.md) |

## 1. Objective and decision

The user reported four identical Projection figures and explicitly selected a
primary forecast with Cautious / Base / Optimistic scenarios, then added
Pessimistic to distinguish combined income-and-spending pressure. Replace the
local-first algorithm picker with those scenarios. Keep actual recorded net,
estimated future cashflow and savings goals distinct.

## 2. Requirements

| ID | Requirement |
|---|---|
| SP-01 | Base is the fallback; selecting a scenario persists it for this household on this device and updates Projection, Home and widget/Watch forecast data. |
| SP-02 | Show an explained scenario range, not an asserted confidence interval or probability. |
| SP-03 | Estimate income, recurring commitments and variable spending separately per open month. |
| SP-04 | Future income entries must not imply zero variable spending or bypass every forecast calculation. |
| SP-05 | Savings targets are benchmarks; changing one cannot create forecast money. Show the gap to the annual goal. |
| SP-06 | Count irregular income once in its specified month. Never extrapolate historical windfalls. |
| SP-07 | Forecast the entire current month as well as future months; December is not complete before it ends. |
| SP-08 | Show input provenance, limited/missing history and legitimate equality. Never manufacture different numbers just to differentiate cards. |
| SP-09 | Work offline from the household ledger, without new external services, AI or bank connections. |
| SP-10 | Preserve actual income-only months and reconcile Overview YTD with historical net totals. |
| SP-11 | Ignore stale scenario/year responses and preserve the selected scenario when editing targets. |

Optimistic retains Base income and reduces spending; it does not promise income growth.
Cautious changes estimated income only and retains Base spending. Pessimistic
combines lower estimated income with higher spending. Known income stays as
entered in every scenario; matching results must be explained.

## 3. Boundaries

This is recorded household cashflow after configured recurring commitments,
not a verified bank balance or investment-return forecast. Recurring schedule
history retains the existing Savings semantics. Future income entries are
explicit monthly assumptions; the user must be told to check their completeness.

Scenario selection is an app-wide preference, saved per household on the device.
All forecast readers use it across navigation, year changes and app restarts.
It is not synchronized to other household members or devices. The legacy remote method
picker remains compatible when local-first is disabled.

What-if sliders, category-level seasonality, calibrated probabilities,
backtesting reports and loan-rate simulation are possible later tools, not
part of this initial implementation. No financial advice or tax calculation
changes are included.

## 4. Acceptance

- Known variable-history fixtures produce independently checked scenario totals.
- Fully entered future income does not collapse the scenarios by itself.
- Flat assumptions may legitimately produce equal scenarios, with an explanation.
- Real household reconciliation and native visual verification must be reported
  separately from unit and component tests; they cannot be inferred from them.
