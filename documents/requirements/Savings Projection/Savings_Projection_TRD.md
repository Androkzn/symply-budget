# Savings Projection — Technical Contract

| Field | Value |
|---|---|
| Feature / version | savings-cashflow-scenarios / v1.0 |
| Date / status | 2026-09-10 / implemented, device reconciliation pending |
| BRD | [Requirements](./Savings_Projection_BRD.md) |
| Audit and implementation evidence | [Audit](../../apps/symply-budget/features/savings-projection-audit-2026-09-10.md) |

## 1. Architecture

`savingsApi` routes Budget local-first reads to `localSavingsApi`, which calls
`scenarioProjection.getScenarioProjection`. Existing history/goal metadata
comes from `localSavingsProjector`; the scenario engine replaces all open-month
and year-end forecast values. No network, database schema or ledger mutation
is needed to forecast. Targets continue through the existing signed operation path.

`SavingsProjection.forecast` identifies `cashflow-scenarios-v1`. Each open
month carries `forecastBreakdown` with income, recurring, spending, their
sources and recorded net. Legacy responses without `forecast` retain the old UI.

Existing API method tokens are compatibility adapters: `historical_average`
means Cautious, `hybrid` means Base, `trend` means Optimistic. A legacy
`planned_budget` request maps to Base. They are not claims about the legacy
algorithm used to calculate the result. The local-only token `pessimistic` adds the combined downside scenario. New local UI exposes four scenarios.

## 2. Formula

For every open month:

`forecast net = expected regular income + that month's one-off income − scoped recurring payments − estimated variable spending`.

History: up to six completed months with both confirmed income and a logged
Budget expense, searched over the trailing twelve calendar months. The window
crosses January. Drafts and schedule-only months do not establish observations.
For a future year the window ends at the current month, never at a future date.
Amounts remain integer cents; quantiles interpolate sorted observations and round.

| Component | Cautious | Base | Optimistic | Pessimistic |
|---|---|---|---|---|
| Unspecified regular income | 25th percentile | Median | Median | 25th percentile |
| Unplanned variable spending | Median | Median | 25th percentile | 75th percentile |
| Configured monthly Planning budget | Budget | Budget | Budget + lower historical deviation | Budget + upper historical deviation |

Active regular-income templates replace historical income estimates, including
an explicitly zero-valued template total. Confirmed regular-income entries in a
future month replace its income estimate and are explicitly described as its
full monthly income plan. In the current month use the greater of recorded
regular income and the full-month income estimate. Add one-off receipts once.

Variable spending is never below the logged monthly expenses; a Planning
budget of zero is valid. With no spending history the scenario deviations are
zero. Negative forecast savings are allowed. Missing income/spending estimates
are flagged rather than disguised as confident predictions.

Completed months contribute their historical net, including income-only months.
The headline equals the sum of the twelve displayed monthly contributions.
The selected card equals the headline. Monthly targets and goal allocations
never override forecast amounts.

`goal gap = selected forecast − annual savings goal`.
`additional net needed per open month = max(0, ceil((goal − recorded net through current month) / open-month count))`.
This is an allocation across open months, not a daily cashflow forecast.

## 3. Semantics and limitations

- The range combines historical income/spending quartiles; it is a scenario
  envelope, not a statistically calibrated interval. Components are not assumed
  independent for any probability calculation because no probability is produced.
- Fewer than three usable observations triggers a limited-history message.
- Logged expenses establish a floor, not proof that a month is complete.
- Recurring amounts use the existing active/scope rules, not bank settlement dates.
- Recorded net remains monthly accounting, including records dated within the
  selected month; it is labeled "net recorded", not "banked".
- No return, interest, inflation, FX, tax-room or investment modelling is introduced.
- Future income completeness and historical recording completeness cannot be
  inferred from a single transaction. Expose this limitation rather than imply certainty.

## 4. UI and verification

The headline precedes scenario choices. The view shows range, goal gap, required
additional monthly net, input warnings, chart and monthly component explanations.
Projected current-month bars are visually marked as forecasts. Late reads cannot
replace a newer scenario; failed reads clear stale data. Target saves refetch the
currently selected scenario.

Each scenario's info action opens a 95%-height scrollable sheet with a shared-scale
comparison of all four year-end outcomes and a visual income-minus-payments-minus-
spending example. `scenarios[].exampleMonth` is calculated independently for each
scenario (first future month, otherwise current month), so opening another scenario's
explanation never reuses the background selection's amounts. Closed years omit the
open-month example. All visuals use native components and theme colors, with signed
bars around zero and accessible numeric labels.

When year-end net is below the recorded net, show a reconciliation:
recorded savings + signed expected remaining change = year-end total. A positive
year-end number can still represent a decrease. Never floor a forecast at the
recorded amount. Explain the expected expense-over-income shortfall and keep
recorded savings unchanged. Each scenario card labels its increase/decrease;
the explanation lists the monthly contributions. Current-month contribution is
its full forecast **minus** recorded current-month net, avoiding double counting.
Decreases, negative amounts and info icons use the chart secondary accent
(Budget terracotta), with text/signs conveying meaning independently of color.

Scenario taps save immediately through local setDefaultProjectionMethod. The
Savings store persists a household-to-method map on this device and increments
dataRevision, refreshing Projection, Home and its widget/Watch snapshot. All
implicit local projection reads await preference hydration and use this map,
including target-write responses. Base is only the fallback. Explicit API
method overrides do not mutate the preference. No settings sync migration is required.

Required tests cover variable and flat history, future entered income, one-offs,
drafts, custom recurring scope, spending floors, missing data, January/December,
past years, YTD consistency, UI selection and out-of-order responses.

The explanation separates planned spending, scenario adjustment, and any logged-expense floor. Entered/template income is labeled as such instead of implying it was reduced. When higher assumed spending turns a budget surplus into a deficit, the sheet shows both amounts.

Optimistic retains Base income; its upside comes only from lower spending. The fallback is the median of up to six completed tracked months, not the latest paycheck or a projected raise. Entered income and active recurring templates remain authoritative.

## Automatic refresh

Every successful local `mutateLocalLedger` transaction publishes its changed
tables and household after persistence. The existing ledger refresh bridge
handles both these events and remote sync events, coalescing bursts over 120 ms
and refreshing only the active household. Projection and Home reload through
their revision subscriptions, retain the saved scenario, and reject outdated
responses. Failed persistence emits no committed-change notification. Screen
callbacks are no longer the sole trigger for local refresh.

Current-month reconciliation carries recorded net, full-month net and income
alongside the remaining change. The data reconciles
`recorded net + remaining change = full-month savings`. The sheet leads with
full-month savings and shows income minus fixed payments minus estimated spending.
It explains the latter as budget plus scenario adjustment, split into already
spent and still assumed spending. A negative remainder must not be presented as
a loss for the entire month when the month stays positive.

Scenario explanations use the shared BottomSheet's fixed-height scrollable body.
The header stays outside the scroll viewport, and the content reserves bottom
safe-area padding. InfoButton enables this mode for every fixed-height explanation;
content-sized explanations retain their measured overflow scrolling. Sheets with
their own list or navigator retain ownership of scrolling.
