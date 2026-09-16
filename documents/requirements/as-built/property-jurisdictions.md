# Property Assessment & Tax — Multi-Jurisdiction Support

**Status:** Canada complete (13 provinces/territories). US **seeded (15 states) and gated in** — a
US household now reaches the surface; the screen copy that describes it is still Canadian-only.
**Date:** 2026-08-27
**Supersedes the region-gating section of** [UTILITIES_TAXES_IMPLEMENTATION.md](./UTILITIES_TAXES_IMPLEMENTATION.md)
**Related:** [house-local-first-household-identity.md](./house-local-first-household-identity.md) — the
auto-minted, address-less household that keeps this surface shut for a whole class of member

---

## What changed and why

The property assessment and tax feature was built for Greater Vancouver and hardcoded
British Columbia everywhere — the authority name, a fixed January 31 appeal deadline, a
100% assessment ratio, and the BC Home Owner Grant. It was gated at runtime on
`country === 'CA' && state_province === 'BC'` plus a 21-city allowlist, so it was
invisible to most of Canada.

Three things were wrong, in increasing order of severity:

1. **The feature was hidden** from every household outside Greater Vancouver.
2. **The copy was wrong** for anyone it did reach — an Ontario owner has no BC Assessment
   notice and no Home Owner Grant.
3. **The arithmetic was wrong.** Saskatchewan taxes 80% of assessed value and Manitoba
   45%. Showing a Winnipeg owner only their assessed value overstates their tax by more
   than 2x.

A fourth defect blocked the feature's whole purpose: `SectionCard` in
`PropertyInsightWidgets.tsx` referenced `colors` without calling `useAppColors()`, so
every chart section threw a `ReferenceError`. Charts only render at **two or more years
of data**, which is exactly the year-over-year view the feature exists for. The existing
tests seeded a single year and passed straight over it.

A fifth, found later and covered under [Manual entry](#manual-entry--the-only-way-to-record-an-assessment-in-private-mode)
below: **an assessment could only be created by AI extraction**, which is off under
local-first. A member in private mode had no way to record one at all.

---

## The registry

[`packages/contracts/src/property-jurisdiction.ts`](../../../packages/contracts/src/property-jurisdiction.ts)
is the single source of truth for Canada, shared by the mobile app and the Worker via
`@symply/contracts`. The household address already carries country + province, so the
correct rules are a lookup, never a guess.

`resolvePropertyJurisdiction(country, region)` returns `null` for a region we have no
rules for. Callers must fall back to generic copy — never to another region's rules.

### Canada, as encoded

| | Authority | Ratio | Cycle | Appeal deadline | Homeowner grant |
|---|---|---|---|---|---|
| BC | BC Assessment | 100% | 1 yr | Jan 31 fixed | Home Owner Grant |
| AB | Municipal assessor | 100% | 1 yr | **notice + 60 days** | **None** |
| SK | SAMA (+5 self-assessing cities) | **80%** | **4 yr** | roll + 30d (60 in reval yr) | **None** |
| MB | Manitoba PAS (Winnipeg separate) | **45%** | **2 yr** | printed on notice | HATC, on-bill |
| ON | MPAC | 100% | 4 yr | printed on notice | Via tax return |
| QC | Municipal rôle | 100% | 3 yr | Apr 30 | Via tax return |
| NB | Service New Brunswick | 100% | 1 yr | notice + 30d | Residential credit |
| NS | PVSC | 100% + **CAP** | 1 yr | notice + 31d | CAP + seniors rebate |
| PE | Taxation & Property Records | 100% + cap | 1 yr | notice + 90d | Provincial credit |
| NL | Municipal Assessment Agency | 100% | 3 yr | notice + 30d | **None** |
| YT / NT / NU | Territorial | 100% | 1 yr | notice + 30d | Varies |

### The facts that change behaviour, not just copy

- **Assessment ratios.** `taxableValueCents()` converts assessed → taxed. Mill rates apply
  to the *taxable* value. A $500,000 Manitoba home is taxed on $225,000.
- **Appeal deadlines are three different shapes**, modelled as a discriminated union:
  `fixed` (BC, QC), `days-from-notice` (AB, NB, NS, NL, territories), and
  `printed-on-notice` (SK, MB, ON) where we genuinely cannot derive a date and must show
  the jurisdiction's explanation instead of inventing one.
- **Frozen valuation dates.** Ontario has been on a January 1 2016 valuation date for
  years; Saskatchewan is on January 1 2023 until the 2029 revaluation. **A 0% year-over-year
  change is correct there**, not missing data — extraction, backfill and manual entry all
  preserve a stated `0` (`??`, never `||`).
- **Nova Scotia and PEI notices carry two values** — a market value and a lower capped
  value that is what you are actually taxed on. The gap widens each year and resets on sale.
- **Quebec documents are in French**, and school tax is billed separately by the centre de
  services scolaire, so it never appears on the municipal bill.
- **Relief programs differ in kind, not just amount.** `applyMode` distinguishes `on-bill`
  (Manitoba's HATC — automatic, must not be nagged about), `apply` (BC's Home Owner Grant)
  and `income-tax-return` (Ontario, Quebec). Alberta, Saskatchewan and Newfoundland have
  no homeowner grant at all and render no relief section.

---

## Two registries, one surface

Canada and the United States are modelled by two registries with genuinely different
shapes (see [United States](#united-states--seeded-gated-in-not-yet-spoken)). The two meet
in the app at a **discriminated union**, not at a flattened record:

```ts
// src/hooks/usePropertyJurisdiction.ts:60
export type ResolvedJurisdiction =
  | { country: 'CA'; ca: PropertyJurisdiction }
  | { country: 'US'; us: UsStateJurisdiction }
  | null;
```

The tag is load-bearing. `PropertyJurisdiction` and `UsStateJurisdiction` share almost no
field names worth confusing — `authorityName` vs `assessingBodyLabel`, one
`assessmentRatioPercent` vs a **nullable** one plus `districtClassRatios` — so reading the
wrong one has to be a compile error rather than `undefined` on screen
(`usePropertyJurisdiction.ts:51-63`).

Two entry points, and the split is deliberate:

| Hook | Returns | Who uses it |
|---|---|---|
| `usePropertyJurisdiction` (`:124`) | `PropertyJurisdiction \| null` — **Canada only** | `PropertyAssessmentTab:149`, `PropertyTaxTab:60`, `PropertyTaxScreen:69` |
| `useResolvedJurisdiction` (`:133`) | `ResolvedJurisdiction` — both countries | Nothing yet — see [Known gaps](#known-gaps) |

Widening the return type of the first would break the three screens that read
`documentTypes`, `authorityName` and `assessedValueTerm` off it directly, so it was left
alone and the both-countries hook added beside it. Every display helper below the hooks
(`assessedValueLabel`, `assessmentAuthorityLabel`, `taxableValueNote`,
`appealDeadlineDisplay`, `valueStackLabels`) accepts **either** shape and normalises
through `asResolved` (`:80`), which discriminates on `'country' in input` — safe precisely
because `PropertyJurisdiction` names its country field `countryCode`, not `country`.

### `CA` is ambiguous, so the lookup dispatches on country

`('CA', 'BC')` is Canada. `('US', 'CA')` is California. A resolver that tried one registry
and "fell through" to the other would be correct only by accident, and would silently
start resolving British Columbia against the US registry the day anyone seeded a `BC`
entry there. Both `resolvedJurisdictionForHousehold` (`usePropertyJurisdiction.ts:102-114`)
and `resolveUsJurisdiction` (`property-jurisdiction-us.ts:1716`) therefore require the
country code and key on `${country}-${region}`.

The gate does the same:

```ts
// src/utils/region-gating.ts:100
export function isPropertyAssessmentSupported(household: Household | null): boolean {
  if (!household) return false;
  if (resolvePropertyJurisdiction(household.country, household.state_province) !== null) return true;
  return resolveUsJurisdiction(household.country, household.state_province) !== null;
}
```

This is what changed for the US: the surface now **opens** for a household in Houston or
Denver. Before, it returned false for every US address and the UI would have shown
Canadian assumptions. Coverage is asymmetric — Canada is 13 of 13, the US is 15 of 50 —
which is why `getPropertyAssessmentGateMessage` (`:119`) distinguishes the two: an
unmatched Canadian code is a **bad code**, an unmatched US code is usually a real state we
simply have not modelled, and the message counts the seeded states off the registry
(`allUsStateJurisdictions().length`) so the number cannot go stale.

`getPropertyAssessmentGate` (`:181`) adds the field the message could never carry:
`fixableByAddress`. "Add your province or state…" and "not available in WA yet" read as
the same closed door on screen, and they are not — one is fixed by typing, the other by us
seeding. `householdNeedsAddressCapture` (`:225`) is the predicate built on top of it, and
it exists for the local-first auto-mint bug documented in
[house-local-first-household-identity.md](./house-local-first-household-identity.md).

### `taxableValueNote` refuses rather than guesses

`taxableValueNote` (`usePropertyJurisdiction.ts:264`) returns a **string, not a number**,
wherever a US ratio depends on which district is levying. Colorado is the proof: the same
home is assessed at **7.05% for school levies and 6.80% for local-government levies in the
same year on the same bill** (`property-jurisdiction-us.ts:1427-1460`), so
`CO_STATE.assessmentRatioPercent` is `null` and asking for "the" taxable value without
naming a district class is an ill-formed question.

The order of the branches is the safety property:

1. `usAssessmentRatioPercent(us, districtClass)` returns `null` → return
   `usRatioUnknownNote(us)`, which is composed from the registry's own ratio data rather
   than from prose, so it stays true as rates change and can never contain a figure a
   reader might mistake for their own taxable value (`:234-250`).
2. Ratio is 100 → return `null` (nothing to explain).
3. Otherwise compute, via `usTaxableValueCents`, which applies the district-class **value
   reduction before the ratio** — Colorado's 10% of the first $700,000 of actual value —
   because reversing the two changes the answer (`property-jurisdiction-us.ts:1812-1836`).

There is no fall-through to a number that silently assumed 100%. New York, Illinois,
Pennsylvania and New Jersey have no single statewide ratio either and get the same
treatment; Illinois additionally carries `subStateRatios` because Cook County assesses
residential property at 10% while the other 101 counties use 33⅓%.

---

## Manual entry — the only way to record an assessment in private mode

Before this, an assessment record could be created **only** by AI extraction from an
uploaded notice. Under House local-first that path is off by design — reading a document
needs a server that can see it — and local-first is **on by default for `symply-house`**.
So a private-mode member could not record an assessment at all, while the unsupported-mode
copy told them to do exactly that:

> "Reading your assessment notice takes a server that can see the document, and private
> mode keeps that on your devices. **Enter the year and the assessed value yourself** and
> the rest still works…"
> — `src/features/house/local/unsupportedCopy.ts:159-162`

There was no "enter it yourself".

`PropertyAssessmentTab.tsx` now has one. `openManualEntry` (`:314`) opens the *same*
review sheet extraction opens, on an empty draft seeded to the current year, and the
button (`:479-488`, `testID="property-assessment-add-manual"`) sits **outside** the
empty/populated branch so it is reachable whether or not the member already has rows.

### A duplicate year becomes an edit, not a failed create

`bc_assessment_data` carries a unique index on `(household_id, assessment_year)`
(`backend/src/db/schema-utilities.ts:182`). A member typing a year they already hold would
otherwise hit that index and see a save fail for a reason nothing on screen explains.

`manualDraftForYear` (`:282-309`) points the draft at the stored row instead: it looks the
year up in `rows`, latches `existingId`, and pre-fills the value / land / improvement /
deadline fields from it. Two details are deliberate:

- **What the member has already typed wins** (`current?.assessedValue || dollars(existing…)`),
  so changing the year never wipes a figure they entered.
- **A partial year drops the latch.** `handleManualYearChange` (`:327`) holds the digits
  but resets `existingId` to null while `isSaneYear` is false, so typing `20…` on the way
  to `2024` can never leave a stale id pointed at 2019's row.
- **The save re-checks anyway** (`:360`): `review.existingId ?? rows.find(...)?.id ?? null`
  is the last line of defence against a year that reached the field handler by a path it
  did not see.

The sheet title says which case the member is in — `Update 2026 assessment` vs
`Add assessment` (`:436-440`) — and the footer adds `· updating existing record` (`:764`).
A sheet opened to *add* 2026 that silently *edits* 2026 is the kind of thing a member
discovers by losing data.

### `??`, not `||`, for the year-over-year figures

A manual entry carries no history from a document, so the change-from-last-year is derived
from what is already stored (`:361-372`):

```ts
const prior = rows.find((r) => r.assessment_year === year - 1) ?? null;
const derivedPrevious = prior && prior.assessed_value > 0 ? prior.assessed_value : undefined;
const derivedChange = derivedPrevious != null ? …round to 0.1% … : undefined;
const previousYearValue = review.previousYearValue ?? derivedPrevious;
const changePercent    = review.changePercent    ?? derivedChange;
```

`||` would discard a **genuine 0%** and fall through to the derived value. That is not a
hypothetical: Ontario has been frozen at a January 1 2016 valuation date and Saskatchewan
at January 1 2023, so an unchanged assessed value is the *correct* answer for most of two
provinces, and turning it into "no data" hides the one fact the member came to check. The
same rule already governs extraction and backfill.

`derivedPrevious` guards on `> 0` separately — a stored prior of zero is not a base to
divide by.

---

## The SectionCard crash

`SectionCard` wraps every chart section on the assessment and tax tabs. It referenced
`colors` without calling `useAppColors()`, so it threw `ReferenceError` on render. It now
calls the hook (`PropertyInsightWidgets.tsx:131`) like every other widget in the file.

It shipped because of *when* it throws. Charts render only at **two or more years of
data**, and every existing test seeded one year. The regression test
(`__tests__/PropertySectionCard.test.tsx`) asserts the multi-year case explicitly —
`'survives the multi-year case that used to crash it'` — and the Maestro flow
`property-assessment-yoy.yaml` reaches a chart by **typing two years in by hand**, which
is the only way to get data into a local-first ledger: three years seeded through the REST
API were invisible to the app.

---

## Wiring

| Surface | Change |
|---|---|
| `src/hooks/usePropertyJurisdiction.ts` | `ResolvedJurisdiction` union; `usePropertyJurisdiction` (CA-only, unchanged) beside `useResolvedJurisdiction` (both); display helpers accept either shape; US county lookup and bill-delivery helpers |
| `src/utils/region-gating.ts` | `isPropertyAssessmentSupported()` consults **both** registries by country. `getPropertyAssessmentGate()` adds `fixableByAddress`; `householdNeedsAddressCapture()` is what `RootNavigator` routes on. The Greater Vancouver gate stays, but now only guards the genuinely GVA-specific utilities extras (municipal due dates, penalty ladders, city portals) |
| Property Assessment / Tax tabs | Authority name, value label, document title, valuation-date rule, appeal deadline, taxable-value note and relief list all come from the registry |
| `PropertyAssessmentTab` | **Manual entry** — same review sheet, empty draft, duplicate-year-becomes-edit, derived YoY with `??` |
| `PropertyTaxScreen` | Same; the hardcoded `$770` and `gov.bc.ca/homeownergrant` link are gone |
| `PropertyInsightWidgets` | `SectionCard` calls `useAppColors()` |
| Backend prompts | `buildPropertyAssessmentPrompt(jurisdiction)` and `buildPropertyTaxPrompt(jurisdiction)` replace the BC-only constants. Per-province reading hints; French glossary for Quebec; two-value extraction for SK/MB/NS |
| Drive / Files import | Accepts images as well as PDFs, converts HEIC, checks the 32 MB limit before upload instead of after. Remembered-folder scope renamed `bc-assessments` → `property-assessments` with a one-time key migration |

**No migration was required.** Every new extracted field is response-only and rides in the
existing columns or the `suggested*` review payload. Manual entry reuses
`createBCAssessment` / `updateBCAssessment` unchanged.

---

## United States — seeded, gated in, not yet spoken

US property tax is not a variant of the Canadian model. Three differences break the schema:

1. **One rate becomes N rates.** A bill sums levies from overlapping districts (county,
   city, one or more school districts, community college, park, library, fire, water,
   hospital, Texas MUDs). The taxable value can differ *per district*: Florida's second
   $25,000 homestead exemption does not apply to school levies, and Colorado assesses the
   same home at **7.05% for school levies and 6.80% for local government** simultaneously.
   **Assessment ratio is a property of a district class, not of a property** — which is
   why `assessmentRatioPercent` is nullable and `districtClassRatios` exists.
2. **Rate basis is not uniform.** Most states quote mills per $1,000; **Texas and Tennessee
   quote dollars per $100**; **California quotes a percent**. `per_100` and `percent` are
   the *same arithmetic* and differ only in how the number is printed; the 10x trap is
   mistaking either for `per_1000`, and a Texas rate of 1.2 read as mills produces a bill
   one tenth of the real one that looks entirely plausible.
3. **Value is a stack.** Caps make assessed value diverge permanently from market value —
   California Prop 13, Florida Save Our Homes, Texas's 10% cap, Michigan Proposal A,
   Oregon Measure 50, Arizona Prop 117. The gap is a legally named, sometimes portable
   quantity (`capGapTerm`, `resetsOnSale`, `portable`), and it is why quoting the current
   owner's bill to a prospective buyer is actively misleading.

Two more that affect the product directly:

- **The homeowner may never receive a bill.** Most mortgaged US homes escrow; the county
  mails the bill to the servicer and the owner an *information-only statement*.
  Supplemental bills fall outside escrow. "No bill on file" must never read as "unpaid"
  (`US_BILL_DELIVERY`, surfaced by `usBillDeliveryNote`).
- **New York's STAR is mostly a cheque**, not a reduction on the bill — so relief needs a
  `deliveryMethod` axis (`UsExemptionDelivery`), not just an amount.

Assessment is **not** uniformly county-level either: Texas uses independent appraisal
districts (the county tax assessor-collector only *collects* and cannot change a value),
New York / New Jersey / Michigan / New England use municipal or township assessors, and
**Maryland and Montana assess at the state level** (Maryland has no county assessor at
all). `assessmentAuthorityLabel` returns `stateAgencyName` for those two rather than a
county office, verbatim from the registry — a homeowner sent to the wrong office can miss
a statutory deadline.

Lookup is per-county with **no national registry and no URL naming pattern**; counties are
keyed by 5-digit FIPS **stored as a string**, because leading zeros are load-bearing
(Maricopa is `04013`). `normalizeUsFips` accepts a number and pads it back, because a JSON
round trip or a `parseInt` is exactly how the zero gets lost.

**Seeded states (15):** CA, TX, FL, NY, IL, PA, OH, GA, NC, MI, NJ, VA, MD, MT, CO
(`property-jurisdiction-us.ts:1511`). Facts that could not be verified against an official
source are marked as unverified **in the data itself** (`unverifiedFacts` on OH, GA, MI)
rather than presented as fact.

**What "gated in" does and does not mean.** `isPropertyAssessmentSupported` now returns
true for those 15 states, so the surface opens. The three screens behind it still call the
Canadian-only `usePropertyJurisdiction`, which returns `null` for a US household — so a
Houston owner currently sees the **generic fallback copy** ("Assessed value", "Property
assessment", "assessment notice"), not "Appraised value", "Harris County Appraisal
District" or "Notice of Appraised Value". Every helper needed to say it correctly exists
and is tested; no screen calls them yet. See [Known gaps](#known-gaps).

---

## Tests

| Suite | Covers |
|---|---|
| `src/utils/__tests__/propertyJurisdiction.test.ts` | Registry coverage, ratios, the three deadline shapes, relief apply-modes, region gating. Asserts no province ever receives BC's January 31 |
| `src/utils/__tests__/propertyJurisdictionUs.test.ts` | US rate bases, per-levy exemptions, cap reset-on-sale, FIPS string keys |
| `src/utils/__tests__/regionGatingAddress.test.ts` | The four gate reasons and `fixableByAddress`; every seeded US state ungated; an unseeded state (`US/WA`) reported as *not* fixable by typing; `householdNeedsAddressCapture` matching the auto-minted home and nothing else |
| `src/screens/households/property-tabs/__tests__/PropertySectionCard.test.tsx` | The chart-section crash, at the 2-year threshold that triggered it |
| `src/screens/households/property-tabs/__tests__/PropertyAssessmentManualEntry.test.tsx` | The manual affordance in both empty and populated states; validation (blank / zero / impossible year / land+buildings over total); duplicate year switching to an edit; YoY derivation **including a genuine 0% surviving**; province-specific value labels (ON → CVA, BC → fallback) |
| `backend/.../prompt-brand-neutrality.test.ts` | Prompt neutrality for **every** jurisdiction, not just the default, plus cross-province leakage (a Manitoba prompt must not mention BC Assessment or the Home Owner Grant) |
| `e2e/maestro/households/property-{assessment,tax}-history.yaml` | The year-over-year surfaces render and survive scrolling |
| `e2e/maestro/households/property-assessment-yoy.yaml` | HOUSE-PROP-009/010 — two years typed by hand, then the chart drawn between them. Doubles as the private-mode regression and the `SectionCard` crash guard |
| `e2e/maestro/households/property-notice-import.yaml` | Files and Drive import paths, per-feature folder scopes |

---

## Known gaps

- **US copy is not localised, only unlocked.** `useResolvedJurisdiction`,
  `valueStackLabels`, `usCountyLookup` and `usBillDeliveryNote` have **no production
  callers** — the three property screens still read the Canadian-only hook. A US household
  passes the gate and then reads generic labels. Pointing the screens at the tagged union
  is the remaining work; the helpers and their tests are already there.
- **35 states are unseeded.** `US/WA` and the rest fail the gate. That is a **seeding**
  question, not a gating one — `getPropertyAssessmentGateMessage` says so in as many
  words, and `fixableByAddress` is false for that case precisely so no screen offers "Add
  your address" as a fix for it.
- **County lookup has no field to read from.** `usCountyLookup(jurisdiction, countyFips)`
  needs a FIPS code, and `Household` (`src/api/households.ts:16-38`) has no county field —
  no column, no API, no form. The code cannot be inferred from the address either:
  Virginia's 38 independent cities sit inside no county at all and New York City has no
  county assessor. Until a field exists, `usCountyLookupOptions` (the picker list) is the
  only reachable path, and only for the five states that have both a seeded jurisdiction
  and seeded counties (CA, TX, FL, NY, IL — ten counties in total). Maricopa (`04013`) is
  seeded as a county but **unreachable through the hook**, because `usCountyLookup`
  requires the state to resolve and Arizona is not a seeded state — the registry notes
  that as deliberate, but the hook cannot honour it.
- **`bc_assessment_data` keeps its name.** Renaming the table and the `/bc-assessment`
  route is a breaking change and was left out of scope. The manual-entry path writes
  through `createBCAssessment` / `updateBCAssessment` for the same reason.
- **County-level US lookup URLs churn.** They need automated liveness checking; several
  sites hard-block automated clients and will produce false negatives.
- **Relief dollar amounts change yearly** — Florida's second homestead band is
  CPI-indexed, Enhanced STAR's income limit moves every year. They are **display hints,
  not calculation inputs**, and need annual re-verification. Each jurisdiction carries a
  `sourceUrl` to re-check against, and every figure in the US registry was verified
  against the authority's own site in **August 2026**.
- **A household with no address never reaches any of this.** The gate resolves on
  `country` + `state_province`, and House local-first used to mint households with
  `country: 'CA'` and everything else null. That is a separate defect with a separate fix —
  see [house-local-first-household-identity.md](./house-local-first-household-identity.md).
