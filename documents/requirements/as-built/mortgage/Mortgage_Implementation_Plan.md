# Symply Budget — Mortgage Tracking — Implementation Plan

**Status:** SHIPPED (Phases 0–5 deployed to staging + production) · **Owner:** Budget Worker (`isFullBudget()`) · **Created:** 2026-07-22 · **Version:** v1

> **As-built (2026-07-22):** All six phases implemented, tested, and deployed to the Budget Worker (staging + production). Engine `amortization.ts` + `reconciliation.ts` at 100% line/stmt/fn coverage; PII scrub `statement-normalize.ts` at 100% line coverage. Migrations 0112–0115 applied to House + Budget D1 (staging + production). **0118 (`mortgage_rate_periods`, §5.1) applied to House + Budget + Kaizen D1, staging + production, and verified live** — per-statement rate history + the History-tab impact charts (§8.3). Backend suite 1397 tests green; mobile mortgage suite 68 tests green. Routes verified live (HTTP 401 gated). Remaining polish tracked at the bottom of this file.
**App scope:** [Budget BRD](../../../apps/symply-budget/BRD.md) · [Budget TRD](../../../apps/symply-budget/TRD.md) · [Features index](../../../apps/symply-budget/features/README.md)
**Companion rules:** [backend-deployment](../../../../.cursor/rules/backend-deployment.mdc) · [AI_CONVENTIONS](../../../ecosystem/AI_CONVENTIONS.md)

> This plan was produced from a 10-agent research + design + adversarial-critique pass (codebase + Canadian mortgage domain + amortization math). All math defects the critique found are folded into §4 and the test vectors in §11. **Every implementation step below is gated on unit tests + (where user-facing) Maestro UI tests + a verify gate that must pass before the step is considered done — 100% coverage is a hard requirement, not a goal.**

---

## 1. Summary, user value & benefits

Budget users can scan receipts and import savings today, but cannot answer the question that dominates a Canadian household balance sheet: **"How is my mortgage actually going?"** This feature adds a first-class **Mortgage** area where a user:

1. **Sets up** a mortgage from its initial conditions (address, sale price + down payment *or* original amount, rate, rate type, term, amortization, start date).
2. **Keeps it current** by adding **statements** — through the *exact* upload pipeline already built (Google Drive, photos, gallery, camera) *or* manual entry.
3. **Sees an honest, rich picture:** current balance, total spent, **interest vs equity split of every payment**, % paid off ($ and %), monthly & lifetime totals, equity growth (paydown + appreciation), rate history across terms, and a **renewal reminder** months before maturity so they can shop offers across banks.

**Why it matters (Canada-specific):**
- Mortgage interest on a principal residence is **not tax-deductible** in Canada → paying down fast is rational; users want to *see* paydown accelerate and celebrate the interest→principal crossover.
- **Amortization ≠ term:** a 25-yr amortization is repaid across ~5 renewed terms; interest-rate risk resets at each renewal. **>70% of Canadians renew without shopping.** The renewal reminder + offer comparison directly attacks that leakage.
- Canadian fixed rates compound **semi-annually, not in advance** — a naïve `rate/12` engine *overstates* interest. Our engine is legally correct, so numbers match the bank's annual statement (trust), and a statement can *reconcile* the schedule.

**Headline outcomes surfaced in-app:** current balance · total paid to date · total interest vs total equity · per-payment split · % paid off · monthly & lifetime totals · equity growth · rate history · proactive renewal window.

---

## 2. Scope & guardrails

- **Budget-only for v1.** Gate every route/card/tab with `isFullBudget()` / `!isMinimalBudget()`. No new ecosystem capability flag in v1 (see Open Question OQ-1).
- **CAD single-currency.** Multi-currency is explicitly out of scope; no currency column beyond app default.
- **Owner-occupied residential mortgages.** Rental/commercial specifics out of scope.
- **The statement is the source of truth** wherever present; the engine models the schedule and reconciles to statement anchors (§5).
- **PII minimized:** address masked; full mortgage/account number and borrower name never stored (last-4 only), never logged, never sent to AI telemetry. Server-side deterministic scrub is the control, prompt is defense-in-depth (§6.4).
- **No forking** of Login / Widget / Watch / shared header — reuse tokens + shared components only.

---

## 3. Canadian mortgage domain primer (condensed)

| Concept | What it means for the model |
|---|---|
| **Amortization period** (e.g. 25/30 yr) | Total time to pay to zero. Drives `N` (total payments). Stored `original_amortization_months`, default 300. |
| **Term** (1–5 yr typical) | The *contract* length; renews at maturity, often at a new rate. One `mortgage_terms` row per term. `maturity_date` drives the renewal reminder. |
| **Fixed vs variable** | Fixed → compounds **semi-annually**. Variable (ARM = payment moves; VRM = payment fixed, split moves) → compounds **monthly** by contract. Driven by the `compounding` column, never assumed. |
| **Payment frequency** | monthly / semi-monthly / biweekly / weekly + **accelerated** biweekly/weekly (≈1 extra monthly payment/yr → ~2.5–4 yr faster). |
| **Semi-annual compounding** | Effective periodic rate `i = (1 + j/2)^(2/n) − 1`. **Never `j/12` for fixed.** |
| **CMHC / Sagen / Canada Guaranty** | Default insurance when down < 20%; premium (≈ a few % of loan) is normally **financed into principal** → `original_principal = price − down + premium`. Critical for the equity identity (§4.4). |
| **Prepayment privileges** | Annual lump-sum % + payment-increase %. Shorten amortization or lower payment (`policy`). Surfaced as interest-saved insight. |
| **Renewal shopping window** | ~120-day rate hold; FCAC mandates lender renewal statement ≥21 days out → **default reminder lead = 3 months**. |

Sources gathered during research: Government of Canada / FCAC mortgage pages, CMHC, and the big-five bank statement layouts (RBC/TD/Scotia/BMO/CIBC). Full source list retained in the research transcript.

---

## 4. Amortization engine (authoritative spec — critique-corrected)

### 4.1 Where it runs — SERVER is the source of truth
Pure TS module `backend/src/services/mortgage/amortization.ts` (no I/O), consumed by `MortgageService`. The FE **renders precomputed rows** from `GET .../schedule` and `.../summary`. **One exception:** the setup wizard needs a *live preview* before the mortgage exists → ship an identical **client mirror** `src/features/mortgage/amortization.ts`, used **only** for the unsaved preview; after save the FE always trusts the server. A **shared golden-vector fixture** (`§11`) is asserted by *both* the vitest and jest suites so the two can never diverge.

### 4.2 Rate conversion (Canadian semi-annual, not in advance)
For nominal `j` (decimal) and `n` payments/yr:
- Effective annual: `EAR = (1 + j/2)^2 − 1`
- **Periodic: `i = (1 + j/2)^(2/n) − 1`** → monthly `^(1/6)`, biweekly `^(1/13)`, weekly `^(1/26)`.
- When `compounding = 'monthly'` (variable): `i = j/n` (US-style). **Column-driven, never assumed.**

### 4.3 Level payment & per-payment split
`N = n × amortization_years`; `PMT = P·i / (1 − (1+i)^(−N))`.
Payment `k` on prior balance `B(k−1)`: `interest_k = B(k−1)·i`; `principal_k = PMT − interest_k`; `B_k = B(k−1)·(1+i) − PMT`.
Interest share of payment `k`: `1 − (1+i)^(−(N−k+1))`. **Crossover** (principal > interest) when `(1+i)^(−(N−k+1)) < 0.5`.

### 4.4 Closed forms, totals & equity — **CORRECTED**
Remaining balance (annuity form, stable near payoff): `B_k = PMT·[1 − (1+i)^(−(N−k))]/i`. Lifetime interest `= N·PMT − P`. Interest through `k` `= k·PMT − (P − B_k)`.

**Equity decomposition (critique fix — financed CMHC premium):** the paydown component must use **`P0 = price − down`**, NOT `original_principal` (which includes the financed premium). The *debt/balance schedule* amortizes over `original_principal = price − down + premium`.
```
equity = down_payment
       + max(0, (price − down) − B_k)        # paydown equity  ← uses price−down, NOT loan principal
       + max(0, current_home_value − price)  # appreciation (optional; hidden if value unknown)
```
This keeps `equity = current_home_value − B_k` an exact identity even with a financed premium. When `price`/`down` are null (user entered principal directly), degrade to **paydown-only** (`original_principal − B_k`), hide the appreciation slice, and note that paydown then cannot be split from any financed premium. **Test:** golden vector with a financed premium asserting `equity == value − B_k` (§11 GV-3).

### 4.5 Reconciliation — statement overrides schedule, **event-aware** (critique fix)
The theoretical schedule drifts (rounding, prepayments, VRM split changes, rate resets). Rules:
1. Build the schedule term-by-term from `original_principal` at `start_date` using each term's rate — **folding sorted `mortgage_events` into the recursion**: apply `lump_sum_prepayment` to the running balance at its date, switch `i` at `rate_change` dates, re-derive `PMT`/`N_rem` per `policy`. *(This is the critique fix: the event ledger is no longer islanded — the canonical schedule reproduces variable-rate + prepayment reality.)*
2. Sort statements by `statement_date`; at each, **snap the running balance to `closing_balance_cents`** and continue from that actual balance → self-corrects all drift after each anchor.
3. **Current outstanding balance** = latest statement `closing_balance`, projected forward by scheduled payments elapsed at the **LATEST KNOWN rate/payment**, not the static term rate (v2, `resolveForwardRate`): the forward rate is the most recent statement's `interest_rate` → else the most recent `rate_change` event → else the term's contract rate; when the rate came from a statement, its actual `payment_amount` becomes the forward payment too. This is the flexible-rate fix — a fresh statement carrying a new rate re-bases the projected balance, the payment split, and the forecast on every read (a variable rate's lifetime cost is unknown at signing, so we never freeze it at the origination rate). **Flag "confirmed as of <date>" vs "estimated"**; `projected.projectionStale` fires once the projection window exceeds ~6 months so the UI prompts for a fresh statement.
4. When a statement reports `interest_paid`/`principal_paid`, prefer those **actuals** for that period's totals over the computed split. Summary `totalInterestToDateCents` sums the bank's own `interest_paid` across statements (+ a short forward-tail projection since the last statement); `paidToDate.interestSource` is `'actual'` when any statement carried interest, else `'estimated'`. Principal-paid stays balance-derived (`original_principal − reconciled_balance`, exact).

**Forecast to end of term (v2).** `summary.projected.toEndOfTerm` projects the reconciled current balance forward to `maturity_date` at the forward rate via `interestOverPeriods` (a closed-form interest/principal split over N payments), yielding the projected balance, whole-loan principal repaid, equity, interest remaining this term, and total interest by renewal. §4.10 holds: between anchors the periodic rate is an acceptable approximation; the confirmed numbers still come from statement actuals.

### 4.6 Rate change at renewal — **re-amortize over ACTUAL remaining amortization** (critique fix)
At renewal after `k` payments, outstanding `B_k` (from reconciliation) is re-amortized over the **actual remaining amortization**, **NOT `N − k`**:
```
N_rem = remaining_amortization_periods   # from mortgage_terms.amortization_months_at_start × n'/12,
                                         # OR solve k* = −ln(1 − B_k·i/PMT)/ln(1+i) from the reconciled balance
i'    = (1 + j'/2)^(2/n') − 1
PMT'  = B_k·i' / (1 − (1+i')^(−N_rem))
```
Rationale (critique numeric proof): 500k/5%/25yr with a $50k lump at pmt 60 leaves **197.7** payments, not 240; renewing at 6% gives correct `PMT' = $3115.07` vs naïve `N−k` `$2795.61` — a **$319/mo, ~11% error** that would propagate through every chart. Recompute `N_rem` whenever a `mortgage_event` or frequency change occurs. **Test:** GV-4 (lump→renew asserts `PMT' ≈ 3115.07`).

### 4.7 Prepayments, accelerated & VRM specials
- **Lump sum L:** `B' = B_k − L`. `keep_payment_shorten` → new count `k* = −ln(1 − B'·i/PMT)/ln(1+i)`; `keep_amort_lower_payment` → `PMT_new = B'·i/(1 − (1+i)^(−N_rem))`. Interest saved = old remaining interest − new remaining interest (insight).
- **Accelerated biweekly** = `PMT_monthly/2 × 26/yr`; use `i26 = (1+j/2)^(1/13) − 1`; payoff `k = ln(PMT_acc/(PMT_acc − B·i26))/ln(1+i26)`.
- **VRM trigger rate** = rate where `B·i_period = fixed_payment` (payment covers only interest); **trigger point** = balance back to original principal. Warn as an insight when a VRM approaches trigger.

### 4.8 Degenerate setup state machine (critique fix — rate unknown)
Never render a blank/zero schedule:
- **rate known** → compute `PMT`.
- **payment known, rate unknown** → solve the implied rate by bisection/Newton on `PMT(P, i, N) = statedPayment`, show "implied rate ~X%".
- **neither known** → friendly empty state: *"Add a statement or enter your rate to see your schedule."*

### 4.9 Rounding policy
Compute with unrounded `i`; round only the displayed `PMT` to the cent; **true-up the final payment** to drive the balance to exactly 0.

### 4.10 Variable-rate interest is DAILY SIMPLE (Actual/365) — validated on a real TD statement (§16)
Confirmed against a real TD FlexLine term portion: the interest *charged* on a variable product is **daily simple interest** `balance × annual_rate × days/365`, NOT a periodic-compounded amount. Real check: `976,000 × 4.090% × 14/365 = $1,531.12`, matching the statement's Total Interest Paid **to the cent**. Engine rules:
- **Variable (`compounding='monthly'`):** accrue interest daily on the running balance at `annual_rate/365 × days_in_period`. For the *projected* schedule between anchors, the periodic-rate `i = j/n` is an acceptable approximation (our monthly-convention PMT reproduced the real payment within ~$3), but the reconciliation must always prefer the statement's reported `interest_paid`/`principal_paid` actuals (§4.5 rule 4).
- **Fixed (`compounding='semi_annual'`):** keep the periodic semi-annual conversion (§4.2).
- **Odd-days first period** (advance date ≠ first full period) → prorate by actual days; the first statement usually shows a partial period. GV-10 covers this.

---

## 5. Data model

Amounts = **integer cents**. Ids = app UUIDs (`crypto.randomUUID()`); timestamps ISO-8601 `Z`. Every table `household_id`-scoped, `ON DELETE CASCADE`, snake_case, following `schema-budget.ts`. New schema file `backend/src/db/schema-mortgage.ts`. Migrations start at **0112** (latest applied is `0111_budget_sub_budgets.sql`).

| Table | Purpose | Key columns (abbrev.) |
|---|---|---|
| **mortgages** | stable loan identity + initial conditions | `id, household_id(FK cascade), nickname, lender, product_type(standard\|heloc_flexline\|step, def standard), property_address(null, PII-masked), mortgage_number_last4, original_price_cents(null), down_payment_cents(null), original_principal_cents(NOT NULL), original_amortization_months(NOT NULL def 300), start_date, current_home_value_cents(null), insurance_premium_cents(null), is_active(def 1), created_by, created_at, updated_at`; index `household_id` |
| **mortgage_terms** | one row per term/renewal (rate axis) | `id, mortgage_id(FK cascade), household_id, sequence(1-based), rate_type(fixed\|variable_arm\|variable_vrm), compounding(semi_annual\|monthly), nominal_rate_bps, prime_rate_bps(null), spread_bps(signed null), term_months, term_start_date, maturity_date, payment_frequency(monthly\|semi_monthly\|biweekly\|weekly\|accel_biweekly\|accel_weekly), amortization_months_at_start, scheduled_payment_cents(null), property_tax_portion_cents(null), insurance_portion_cents(null), is_current, created_at, updated_at`; index `(mortgage_id, sequence)` |
| **mortgage_statements** | captured statements (reconciliation axis) | `id, mortgage_id(FK cascade), household_id, term_id(null FK), statement_date(anchor), period_start(null), period_end(null), opening_balance_cents(null), closing_balance_cents(NOT NULL), interest_paid_cents(null), interest_charged_cents(null), principal_paid_cents(null), payment_amount_cents(null), interest_rate_bps(null), prime_rate_bps(null), variance_bps(signed null), remaining_amortization_months(null), property_tax_paid_cents(null), source(manual\|camera\|gallery\|file\|google_drive), extraction_confidence(real null), raw_extraction_json(TEXT null, PII-scrubbed), created_by, created_at, updated_at`; **UNIQUE `(mortgage_id, statement_date)`** (critique dedup fix); index `(mortgage_id, statement_date)` |
| **mortgage_events** | prepayment / rate-change / renewal ledger (consumed by §4.5) | `id, mortgage_id(FK cascade), household_id, event_type(lump_sum_prepayment\|payment_increase\|rate_change\|renewal\|amortization_change), event_date, amount_cents(null), new_rate_bps(null), new_payment_cents(null), policy(keep_payment_shorten\|keep_amort_lower_payment null), note, created_by, created_at`; index `(mortgage_id, event_date)` |
| **mortgage_renewal_offers** | bank-shopping compare data | `id, mortgage_id(FK cascade), household_id, bank_name, offered_rate_bps, rate_type, term_months, monthly_payment_cents(null), offer_expires_at(null), status(draft\|shortlisted\|accepted\|declined), source(manual\|ai), note, created_by, created_at, updated_at`; index `(mortgage_id, status)` |
| **mortgage_rate_periods** (0118) | per-statement dated rate sub-periods — the queryable rate axis (§5.1) | `id, mortgage_id(FK cascade), household_id, statement_id(FK cascade null), effective_date(NOT NULL, FIRST day the rate applied), period_end(null), rate_bps(NOT NULL), prime_rate_bps(null), variance_bps(signed null), source(statement\|manual def statement), created_at`; index `(mortgage_id, effective_date)`; **UNIQUE `(statement_id, effective_date)`** (re-commit replaces, never duplicates) |
| **notification_preferences** (ALTER) | per-type toggle | `+ mortgage_renewal INT DEFAULT 1` + `createDefaultPreferences` + `typeMap` in `shouldSendNotificationType` |

### 5.1 Rate history — why `mortgage_rate_periods` exists (0118)

A variable / HELOC borrower's rate does **not** change once per term; it changes
whenever prime moves, and the statement reports it as a dated sub-period table:

```
Period Covering      TD Prime   Variance   Annual Rate   Interest
Oct 01 – Oct 29        4.700     −0.860       3.840       2,965.64
Oct 30 – Oct 31        4.450     −0.860       3.590         191.06
```

So a **single** upload can contain a rate change, with the lender's own exact
effective date (Oct 30). That breakdown was originally stashed in
`mortgage_statements.raw_extraction_json` — a text blob that cannot be queried,
indexed or aggregated, and which only the client could interpret.

`mortgage_rate_periods` promotes each sub-period to a row, making the rate axis
first-class:

- **Written** by `MortgageService.syncRatePeriods` on every statement commit.
  Delete-then-insert per statement, so a correction that *merges* two sub-periods
  back into one cannot leave the dropped period behind as a phantom rate change.
  When a commit carries no breakdown (manual entry, or an older extraction), the
  statement's single headline rate is still recorded, dated at the statement date
  — every statement contributes to the history.
- **Read** by `GET /households/:hid/mortgage/:mid/rate-periods` (oldest first).
- **Backfilled** by migration `0118` straight from the existing blobs using
  SQLite JSON1 (`json_each` over `$.ratePeriods`), falling back to the headline
  `interest_rate_bps` for statements that never had a breakdown. Guarded by
  `json_valid` so a malformed blob degrades to the headline rate instead of
  failing the migration. `INSERT OR IGNORE` + the unique index ⇒ re-runnable.
- **Legacy fallback:** `buildRateChangeHistory` still parses `raw_extraction_json`
  when no rows are supplied, so a client reading a pre-0118 statement is unaffected.

Consumers: the change-history timeline (`rate_observed` items), the rate step-line,
and the rate-impact charts (§8.3).

---

## 6. Statement ingestion (reuse the receipt pipeline)

### 6.1 Reused FE components (verified to exist)
Copy `src/screens/budget/BudgetReceiptScanScreen.tsx` → `MortgageStatementScanScreen.tsx`: four sources (**Camera/Gallery** via `@services/image-picker-compat`; **File** via `expo-document-picker` + `RECEIPT_MIMES`; **Drive** via `<CloudFilePicker provider="google-drive" rememberScope="mortgage-statements" />`), `toVisionSafeAttachment()` HEIC→JPEG re-encode (PDFs pass through), `inferReceiptMime(name)`, wrapped in `<AIAccessGate>`. Replace the *line-item* review with a **single-record field editor** (`MortgageStatementReviewScreen.tsx`).

### 6.2 Reused BE pipeline
Follow the **structured-tool-schema** flavour (like `ReceiptScanService`): PDFs via `generateToolFromDocument()`, images via `generateWithFallback(... toolChoice:{type:'tool',name:'output'})`. Resolve the provider **only** via `createAnthropicAdapterForUser(env, userId, {feature:'mortgage_import', userId}, model)` — **never the Anthropic SDK directly** (AI_CONVENTIONS). New prompt file `backend/src/ai/prompts/extract-mortgage-statement.ts` mirroring `scan-grocery-receipt.ts`: `EXTRACT_MORTGAGE_STATEMENT_SCHEMA`, `..._SYSTEM_PROMPT`, `buildMortgageStatementUserPrompt(...)`, `RawMortgageStatement`. **Amounts in dollars** at the AI layer → cents at commit.

### 6.3 Extraction fields
`lender, statement_date, period_start, period_end, opening_balance, closing_balance, interest_rate + rate_type, prime_rate + variance/spread (variable), principal_paid, interest_paid, interest_charged (may differ — see below), payment_amount, payment_frequency, property_tax_paid, remaining_amortization (parse "11 Years 06 Months"→months), maturity_date, new_advance_amount (first statement), confidence`. Do **not** invent `original_amount`/`original_amortization` (weakly present → null, app asks the user). Recognize TD/CIBC/Scotia/RBC/BMO layouts; return **end-of-period** values from "Beginning vs End" tables.

**Real-doc-hardened extraction rules (from §16 validation):**
- **Balance disambiguation (critical):** for a combined/readvanceable product the mortgage balance is the **Term Portion "Closing Principal Balance"**, NOT "Plan Limit", "Credit Limit", "Available Credit", or the revolving/HELOC closing balance. The prompt must name this explicitly — a naïve extractor grabs the wrong number.
- **`interest_paid` vs `interest_charged`:** statements show both (they differ by payment-frequency timing — TD footnote 4). Capture **Total Interest Paid** as the reconciliation truth; store "Interest for the statement period" as `interest_charged` (audit only).
- **Variable rate = prime ± variance:** capture `prime_rate` and `variance/spread` separately (e.g. `TD Prime 4.950% − 0.860% = 4.090%`) and set `rate_type='variable'`; do not just store the net rate.
- **Payment-frequency inference:** the statement often does not name the frequency — infer it from the spacing of the listed payment due dates (e.g. Aug 14 → Aug 28 = 14 days ⇒ biweekly; two per month same days ⇒ semi-monthly).
- **First statement:** opening balance `$0` + a "New Term Portion" / advance line ⇒ this is the *origination* statement; the advance amount seeds `original_principal` and its date seeds `start_date`.

### 6.4 PII scrub — deterministic, server-side (critique fix)
The schema **excludes** full-number/borrower-name fields. Before persisting, a deterministic server scrub: regex-strip long digit runs (keep last 4 → `mortgage_number_last4`), drop any name-like field, validate the draft against the JSON Schema. `raw_extraction_json` is stored **only after scrub**, never logged, never sent to analytics/telemetry/provider request logs. Prompt instruction to omit PII is **defense-in-depth**, not the control.

### 6.5 Manual & PDF
Manual entry = the same review screen with a blank draft, no AI call, `source='manual'`. Multi-page PDFs → one `{type:'document', source:{base64, media_type:'application/pdf'}}` block (Claude reads all pages; no client OCR/splitting). Size cap **32 MB**, mime allowlist pdf/jpeg/png/webp, `maxTokens` 1024–2048. Routes: `POST .../mortgage/statements/extract` → `{draft}`; commit = separate `POST .../statements`. **Dedup on commit:** if a statement for that `statement_date` exists, offer replace-vs-cancel.

### 6.6 Combined / readvanceable products (FlexLine / STEP) — real-doc finding (§16)
The validation statement is a **TD Home Equity FlexLine**: one statement, one account number, with a **revolving HELOC portion** *and* a **Term Portion** (sub-account `-01`). Scotia STEP, National Bank All-In-One, etc. are similar. v1 handling:
- Extract and track the **Term Portion** as "the mortgage" (`product_type='heloc_flexline'`/`'step'`). Its "Closing Principal Balance" is the reconciliation anchor.
- The **revolving/HELOC portion is out of scope for v1** (different math — daily-interest, no fixed amortization). Note it in the draft (`has_heloc_portion=true`) so the UI can say "we're tracking your term portion; your line of credit isn't included yet." Future: a separate line-of-credit tracker.
- A single statement may list **multiple term portions** (`-01`, `-02`). v1: extract the first/primary; flag the rest for the user to add as separate mortgages.

---

## 7. Screens, navigation & UX (verified file paths)

**Section tab wiring (4 places — the tab-registry pattern):**
1. `app/(tabs)/mortgage.tsx` — thin wrapper: `if (!isFullBudget()) return <Redirect href="/" />; return <BudgetNavigator section="mortgage" sectionTitle="Mortgage" .../>`.
2. `src/brand/types.ts` — add `'mortgage'` to `BrandTabRoute`.
3. `src/navigation/tabRegistry.ts` — add to `ROUTABLE_TAB_SCREENS` + fallback Ionicon in `getTabScreenIcon` + brand-kit icon in `getTabScreenBrandIcon`.
4. `brands/symply-budget/brand.cjs` — add to `tabs` pool (`defaultHidden:true` → starts in "More" overflow, like `pension`/`bills`).

**Stack sub-screens (in `BudgetNavigator`):** `MortgageMain, MortgageSetup, MortgageStatementScan, MortgageStatementReview, MortgageRenewal, MortgageSettings, MortgageRenewalOffers` — touch `src/navigation/types.ts` (`BudgetStackParamList`), `src/navigation/BudgetNavigator.tsx` (`<Stack.Screen>` + `NavigationHandler` deep-link map), `src/features/budget/mode.ts` (`FULL_BUDGET_STACK_ROUTES`), `src/screens/budget/index.ts` (exports).

**Screens** (under `src/screens/budget/mortgage/`):
- `MortgageView.tsx` — container + `FilterTabs` (Overview · Payments · Equity · Schedule · Renewal), mirrors `savings/SavingsView.tsx`.
- `MortgageSetupScreen.tsx` — the wizard (§2 flow), structured like `BudgetSettingsScreen.tsx`, with live client-mirror preview.
- `MortgageStatementScanScreen.tsx` — copy of `BudgetReceiptScanScreen.tsx`.
- `MortgageStatementReviewScreen.tsx` — single-record field editor + commit (doubles as manual entry).
- `MortgageRenewalScreen.tsx` — **"Renew / start new term"** (critique fix, promoted to Phase 2): new rate/type/term/payment/frequency, snaps `B_k`, creates `mortgage_terms` seq+1 + `mortgage_events('renewal')`.
- `MortgageSettingsScreen.tsx` — `ScreenHeader` + `Card` rows (edit terms, renewal reminder months-before, home value, offers).
- **Dashboard card:** a summary `<Card>` on `BudgetDashboardView.tsx` (balance + %-paid ring + next-renewal chip) via the `loadSavingsHeadroom` 404-hides-card idiom, gated `!isMinimalBudget()`.

**State + API:** `src/stores/mortgageStore.ts` (`create()(persist(immer(...)))`, UI-only + `dataRevision`, mirrors `savingsStore.ts`). `src/api/mortgage.ts` → `mortgageApi` (household-scoped `/households/{id}/mortgage/...` incl. `extractMortgageStatement` via `api.upload`), re-exported from `src/api/index.ts`.

**UX principles:** confirmed vs estimated balances visually distinguished; PII masked; every "big number" links to its explanation; empty states teach; renewal window shows a persistent banner as maturity approaches.

---

## 8. Charts & insights

Presentational only; parents fetch via `mortgageApi`, map in `useMemo`; colors from `useAppColors()` + `src/theme/chartPalette.ts`; `AppBarChart` values in dollars (cents/100). See [dataviz skill] conventions.

| # | Chart | Type | Insight |
|---|---|---|---|
| 1 | Interest vs principal per calendar period (Payments tab — see §8.2) | stacked bar (`AppBarChart` stacks), labelled by month or year | the shift from interest-heavy → principal-heavy |
| 2 | Interest paid over time | bar/line | interest trend + step change at renewal |
| 3 | Equity growth | stacked bar `[down, paydown, appreciation]` | how equity builds; paydown vs market |
| 4 | Interest/equity distribution per payment | donut (gifted `PieChart`, 0/∞ guard) | this payment's split at a glance |
| 5 | Amortization progress | radial `ProgressRing` (net-new) | % paid off |
| 6 | % paid off ($) | horizontal `ProgressBar` (net-new) | $ retired vs remaining |
| 7 | Interest rate over time | line `AppLineChart` (net-new) | rate history + renewal resets |
| 8 | KPI tiles | `StatGrid` | headline numbers |
| 9 | Insight cards | `InsightCard`/`SectionCard` | crossover reached, renewal window, VRM trigger, prepayment saved |
| 10 | Amortization schedule | `TableBlock` (h-scroll) | full runway; confirmed vs estimated badge |
| 10a | Statements on file (Schedule tab) | coverage panel (`mortgage-statements-on-file`) above the amortization table | **which months are already confirmed by an uploaded statement** — each month wears a green ✓, shows its anchored balance + source, taps through to review/edit. This is where "confirmed vs estimated" is surfaced: statements usually anchor recent months that fall past the schedule's visible first-24 rows, so a per-row inline badge would show nothing for most mortgages; the panel is age-agnostic. Empty state teaches ("add one to confirm a month"). |
| 11 | Rate movement across statements | line `AppLineChart` (stepped, `buildStatementRateHistory`) | the rate you've ACTUALLY paid, statement-by-statement — the flexible-rate story |
| 12 | Where each payment actually went (History tab — see §8.3) | stacked bar (`buildActualSplitStacks`) | the real principal/interest split per statement, not the projection |
| 13 | Interest share of each payment (History tab) | line (`buildInterestShareSeries`) | the scale-invariant trend a rate change moves |

**Net-new shared primitives (Phase 0):** `ProgressRing`, `ProgressBar`, `AppLineChart` (all `@components/ui`, brand-neutral, reusable ecosystem-wide).

### 8.1 Forecast tab & rate scenarios (v2)

A dedicated **Forecast** sub-tab (`MortgageView`, id `forecast`) answers the flexible-rate question "what will this cost me and how much equity will I have?" when the rate can drift after signing:

- **Baseline** (`mortgage-forecast-baseline`): the server's `summary.projected.toEndOfTerm` — balance, equity, interest left this term, and total interest by renewal, computed at the latest known rate. A `projectionStale` warning nudges the user to upload a fresh statement.
- **Interactive scenario** (`mortgage-scenario`): a dependency-free `RateSlider` (PanResponder — no native module, works in the standalone Release) + tappable preset chips (−1% / Now / +1% / +2%). Dragging/tapping recomputes **live on the client** via `mortgageScenario.ts`, which composes the byte-for-byte engine mirror (`@features/mortgage/amortization`) — the same wizard-preview exception to the thin-client rule (only hypotheticals; the saved mortgage still trusts the server). Shows the re-amortized payment (+Δ), interest to renewal, equity at renewal, total interest to payoff, and a **VRM-trigger warning** when today's payment would no longer cover the interest at the scenario rate.
- **Rate movement chart**: chart #11 above, so the user sees how their actual rate has moved.

The Overview "Interest paid" tile now carries an `actual`/`estimated` provenance hint, and the Equity tab shows the projected equity at renewal. Maestro: `mortgage-forecast.yaml` (MORT-260) drives the scenario via chips (the slider drag isn't scriptable on iOS 26). Scenario math unit-tested in `mortgageScenario.test.ts`; the shared `interestOverPeriods` primitive is asserted by BOTH engines (GV parity).

### 8.2 Payments tab — deep dive (v4)

The Payments tab was a single sampled bar chart whose x-axis read `#1 · #37 · #73 … #325`. A payment NUMBER is meaningless to a member (nobody knows which month payment #145 is), and one chart answered only one question. It is now `MortgagePaymentsView.tsx` — six cards, two charts, all fed by pure aggregations in `paymentsInsights.ts`.

**Calendar labels, never payment numbers.** Every row is dated with `paymentDateIso` (the same term-start + cadence convention the backend uses), then bucketed:
- **By month** — one bar per month of a chosen year, with a `‹ 2031 ›` year stepper. Bucketing by month (not per payment) keeps a 26×/yr or 52×/yr cadence at ≤12 bars, so a weekly mortgage reads like a monthly one.
- **By year** — one bar per calendar year to payoff. Beyond 12 years the list is thinned to every *n*th year **plus the payoff year**, and the caption says so ("showing every 3rd year") — a silently sampled axis reads as "all of it".

**The six cards** (top to bottom, each `mortgage-payments-*` testID):

| Card | Answers | Source |
|---|---|---|
| Your next payment (`-anatomy`) | what this payment actually buys — interest vs principal split, and "carrying $472,000 costs about $53 a day in interest" (Actual/365, the way a variable/HELOC product accrues) | `summary.currentPaymentSplit` + `interestPerDayCents` |
| {Year} at a glance (`-year`) | what this calendar year costs — **prefers the bank's own statement actuals**, falls back to the plan and asks for statements; shows the full-year plan beside the actuals (the figure people need at tax time) | `yearInsight` over statements + rows |
| Where your payments go (`-breakdown`) | the interest→principal shift, at a period a member recognises; totals for whatever is on screen | `groupByMonth` / `groupByYear` + `sampleBuckets` |
| The tipping point (`-tipping`) | the first payment that puts more into principal than interest — dated, counted down ("5y 2m away"), or marked passed | `crossoverInsight` (read off the BE schedule, so it agrees with the bars) |
| What it adds up to (`-cumulative`) | lifetime cost — cumulative interest vs cumulative principal on ONE axis (`AppLineChart` `data2`), the year the totals cross, total interest to payoff and cost per $1 borrowed | `buildCumulativeSeries` + `interestPerDollar` |
| Interest comes first (`-frontloading`) | why prepaying early matters — "you're 20% through the payments but 34% through the interest" (both measured on the same basis); on a new mortgage it leads with "your first payment is 71% interest" | `frontLoadingInsight` |

**Still a thin client.** These helpers only bucket and sum server figures; no money is re-derived from a rate. The two exceptions are display-only ratios (interest per day, interest per dollar). Everything past today is captioned "at today's rate" because a variable rate moves it.

**Degradation.** No schedule (rate and payment both unknown) → a card that asks for a rate or a statement instead of an empty chart. Summary fetch failed (no term anchor/cadence) → the breakdown card still renders with payment-indexed bars and the calendar controls hidden, rather than inventing months.

**Shared-primitive changes:** `AppLineChart` gained an optional second series (`data2`/`color2`) scaled to the SAME ceiling — scaling two series independently would move their crossing point and tell the member the wrong story. `StatTile` moved out of `MortgageView` into `MortgageStatTile.tsx`, and the per-file `fmtCents`/`fmtMonths`/month-label copies collapsed into `mortgageFormat.ts`.

### 8.3 History tab — rate changes & their real impact (0118)

The History screen is no longer only the *manually logged* ledger. It merges
three sources into one newest-first timeline (`buildChangeTimeline`):

1. `mortgage_terms` → origination + renewals,
2. `mortgage_events` → what the user logged by hand,
3. **`mortgage_rate_periods` → rate changes detected from the statements**
   (`rate_observed`, "From your statement"), each with the lender's exact
   effective date.

A detected change on a date the user *also* logged as a `rate_change` event is
dropped — a manual entry and its statement confirmation must not read as two
separate moves. The user's own row wins (it may carry a note).

**The impact card (`mortgage-rate-impact`, `mortgageRateImpact.ts`)** answers the
question the projected-schedule charts cannot: *my rate moved — where is my money
going now versus then?* It is built from the **actual** statement splits.

The load-bearing metric is the **interest share of each payment**
(`interest ÷ (principal + interest)`), because it is **scale-invariant**. Real
statement periods are not uniform: a mortgage's first month often has one payment
where later months have two. Comparing raw dollars across that boundary would
claim "principal doubled" when only the *period length* changed. The share is
immune to it. Dollars are still plotted (they're what the user recognises from
the statement), but every stated **conclusion** derives from the share — hence the
per-$100 framing: *"$29.5 of every $100 went to your loan; now it's $38.5."*

Statement amounts are stored negative (money out); the builders take magnitudes.
The card hides itself entirely below two comparable statements rather than
render a one-point "trend". Validated against a real TD FlexLine term portion
(Aug→Dec 2025, prime 4.950 → 4.450 at −0.860 variance): interest share
70.5% → 61.5%, i.e. **+9.0pp of every payment redirected to principal**.

---

## 9. Renewal + reminder (reuse cron/notification pattern)

**No new cron trigger** (account at its 5-cron limit) — add a block inside `handleScheduled`.
- **Worker** `backend/src/workers/mortgage-renewal-worker.ts`, 1:1 on `savings-alert-worker.ts`. `checkMaturingMortgages(now)` selects mortgages where reminder enabled and `date(maturity_date,'-'||reminder_months_before||' months') <= date('now') AND maturity_date >= date('now')`. Default `reminder_months_before = 3`.
- **Idempotency:** `last_renewal_reminder_sent_at IS NULL OR < windowStart`; set after send.
- **Cron wiring** in `backend/src/cron/scheduled.ts`, gated `isBudgetApiEnabled(env)`, daily 08:00 UTC window.
- **Emit — set `data.type` EXPLICITLY** (`type:'mortgage_renewal'`, `data:{type,householdId,mortgageId,screen:'MortgageMain'}`).
- **Deep link** branch in `src/services/notificationRouting.ts` + `navigateToMortgage` helper in `src/services/navigation.ts`.
- **Do NOT** add `mortgage_renewal` to House visibility lists — Budget-native, gated by the `isBudgetApiEnabled` guard.
- **Renewal action:** the reminder deep-links to `MortgageMain` where the **Renew screen** (§7) records term 2; offers screen "accept" also routes there (critique fix — no dead end).

---

## 10. Edge cases (all must have a test)

Rate change at renewal (§4.6) · prepayments (§4.7 + reconciliation) · missing statement fields (fall back to theoretical, badge "estimated", never block commit) · appreciation vs paydown (§4.4; hide slice if value unknown) · VRM trigger/negative amortization warn · accelerated vs non-accelerated frequency · semi-annual vs monthly (column-driven) · statement dedup (unique index) · rate-unknown state machine (§4.8) · multiple mortgages per household (`is_active` + picker) · PII scrub (§6.4).

---

## 11. Test strategy — **100% coverage mandate**

> **Rule (from [change → update tests + matrix]):** every change ships with updated + passing unit tests **and** Maestro E2E **and** a test-matrix row. **No step in §12 is "done" until its unit tests, its Maestro flow (if user-facing), and its verify gate are all green.**

### 11.1 Coverage enforcement
- **Engine (vitest):** enforce **100% statements/branches/functions/lines** on `backend/src/services/mortgage/**` via a `vitest` coverage threshold config (`coverage.thresholds` scoped to the mortgage glob). The engine is pure → 100% is achievable and required.
- **Backend service/routes (vitest):** 100% of new mortgage route handlers + service methods exercised (auth-first, household filter, term sequencing, reconciliation, extract validation). Mirror `budget-sub-budgets.test.ts` + `budget-test-helpers.ts`.
- **FE (jest):** 100% of new pure logic — `mortgageStore` reducers, chart data mappers (stacks/donut 0-∞ guards), PII mask helpers, client amortization mirror, `isFullBudget()` gating. Screen-render smoke tests per new screen (real-screen render pattern). Keep the House-baseline mobile Jest green (mortgage assets/tokens must not flip generated files).
- A CI-style check: `db:generate:guard` green each phase; a schema-vs-migration parity note per migration (critique hygiene fix).

### 11.2 Golden vectors (asserted by BOTH vitest engine + jest client mirror)
Fixture `mortgage-golden-vectors.ts` shared by both suites so they can never diverge.

| ID | Scenario | Assertions |
|---|---|---|
| **GV-1** | 500k, j=5% semi-annual, 25yr, monthly | `i≈0.0041239154651` (1e-9); `PMT≈$2908.02`; pmt1 int `$2061.96` / prin `$846.07`; `B1=$499,153.93`; `B60=$442,537.54`; `B300=$0.00`; lifetime interest `$372,407.48` (all ±$0.01) |
| **GV-2** | same, accelerated biweekly | `PMT_acc=$1454.01`; payoff `≈558` payments (~21.5 yr) |
| **GV-3** | financed CMHC premium | `equity == current_home_value − B_k` holds exactly; paydown uses `price − down` |
| **GV-4** | $50k lump at pmt 60, renew at 6% | remaining `≈197.7` payments; `PMT' ≈ $3115.07` (NOT $2795.61) |
| **GV-5** | semi-annual vs monthly | fixed `i` ≠ `j/12`; assert both branches by `compounding` |
| **GV-6** | reconciliation snap | schedule snaps to a statement `closing_balance` anchor and self-corrects prior drift |
| **GV-7** | event-aware variable path | two mid-term `rate_change` events + a prepayment reproduce a hand-computed balance |
| **GV-8** | rate-unknown / payment-known | implied rate solved to tolerance; neither-known → empty-state flag |
| **GV-9** | final-payment true-up | balance drives to exactly `$0.00` |
| **GV-10** | **real doc** — TD FlexLine term portion, Jul 2025 (variable 4.09%, biweekly) | reconciliation `976,000 − 638.96 = 975,361.04` exact; split `638.96 + 1,531.12 = 2,170.08` exact; **daily interest** `976,000 × 4.090% × 14/365 = 1,531.12` to the cent; implied amortization ≈30yr; `interest_paid` ≠ `interest_charged` handled. Fixture PDF: `resourses/testing/Budge- Mortgage statement.pdf` (PII-scrubbed on ingest) |

### 11.3 Maestro UI flows (`e2e/maestro/budget/`, target `com.symply.budget`)
One booted sim, serial ([Maestro iOS-26 reduced-load]); assert on visible tiles/testIDs, not scroll position ([iOS-26 scroll limitation]).
- `mortgage-setup.yaml` — wizard → live preview → save → dashboard renders (MORT-0xx).
- `mortgage-statement-manual.yaml` — add statement manually → reconciled balance updates (MORT-1xx).
- `mortgage-statement-scan.yaml` — mirror `budget-receipt-scan.yaml`, reuse subflows `pick-photo-from-library.yaml`, `pick-document-from-files.yaml`, `prime-files-symplye2e.yaml`; new PDF fixture in `e2e/fixtures/manifest.json` target `mortgage-statement`, binary under `resourses/testing/` (MORT-1xx).
- `mortgage-charts.yaml` — dashboard tabs render each chart/insight (MORT-2xx).
- `mortgage-renewal.yaml` — renew flow creates term 2, rate-over-time chart shows the step (MORT-2xx/3xx).
- `mortgage-renewal-offers.yaml` — add/compare offers, accept → new term (MORT-3xx).
- `mortgage-settings.yaml` — the header **gear** on the Mortgage tab opens the property-management hub (`mortgage-settings-screen`); Edit/Statements navigation works (MORT-300).
- `mortgage-tabs-customize.yaml` — settings → "Customize tabs": hide a tab, save, strip loses it, Reset restores the default strip (MORT-340..347). Self-cleaning — the layout is persisted per install.
- `mortgage-multi-property.yaml` — add a 2nd property → both listed + switchable (hub rows **and** the header title dropdown) → delete the throwaway ENTIRELY via its edit screen (full wipe); primary "Main home" survives (MORT-310, MORT-312).
- `mortgage-title-switcher.yaml` — the header title opens the property picker ("Your properties" + "Add a property"); the retired "+" Add-statement shortcut is gone (MORT-311, MORT-315).
- `mortgage-statements-manage.yaml` — inside a property: add a statement manually → edit it → clear all data → delete the property; self-cleaning on a throwaway (MORT-320).
- `mortgage-history.yaml` — open a property's change-history timeline (origination + renewals + logged changes), record a rate change, confirm it appears (MORT-330).

**Property management (added):** the gear opens `MortgageSettingsScreen` — switch active property, **Edit** (`MortgageEditScreen`: name/lender/address/home-value/active), **Statements** (`MortgageStatementsScreen`: add / edit / delete / clear-all), and **Delete** (full cascade wipe of statements+events+offers+terms via `MortgageService.deleteMortgage`). New API: `GET /households/:householdId/mortgage/:mortgageId` (full record for the edit prefill). Unit: `MortgageSettingsScreen`/`MortgageEditScreen`/`MortgageStatementsScreen` jest suites; backend `mortgage.test.ts` covers GET-by-id, statement delete, and the delete-wipes-everything guarantee.

### 11.4 Live-API smoke
Extend `backend/scripts/live-api-smoke.mjs` (reads `e2e/credentials.local`): create mortgage → add statement → summary round-trip against **staging** (backend vitest is local miniflare, not live — [live-api-smoke-test]).

### 11.5 Verify gate (run after EVERY step in §12)
```sh
# Backend (if backend touched)
cd backend && npm run typecheck && npm run lint && npm test && npm run db:generate:guard
# Mobile (if FE touched)
npm run lint && npm test
# Engine coverage (must be 100% on the mortgage glob)
cd backend && npm run test -- --coverage
# User-facing step → run its Maestro flow on one booted sim (serial)
# Feature-complete phase → live-api-smoke against staging + ios-ui-review skill (iPhone+iPad)
```
A step is **done** only when: its unit tests pass, coverage threshold holds, its Maestro flow is green (if user-facing), typecheck+lint clean, and (for backend-schema/deploy steps) migrations applied to **both** staging and production and `deploy:fleet` shows a new Version ID.

---

## 12. Phased implementation plan (per-step: Implement → Unit → UI → Verify → DoD)

Each phase is independently shippable. **Every step lists its tests and its verify gate; do not advance until green.**

### Phase 0 — Shared UI primitives (net-new, no backend)
**Goal:** brand-neutral primitives the visuals need, reusable ecosystem-wide.
- **0.1 `ProgressRing`** (radial %; SVG arc lifted + de-Kaizen'd from `CommandCenter.tsx`).
  - Unit (jest): arc-path/percent-clamp math (0, 0.5, 1, >1, NaN guards); render smoke light+dark.
  - Verify: `npm run lint && npm test`. **DoD:** 100% of the helper covered.
- **0.2 `ProgressBar`** (track+fill extracted from `BudgetDashboardView` inline styles).
  - Unit: fill-width clamp; render smoke. Verify gate.
- **0.3 `AppLineChart`** (token-driven gifted `LineChart` wrapper mirroring `AppBarChart`).
  - Unit: series mapping, empty-data guard, theme colors; render smoke. Verify gate.
- **Phase DoD:** three primitives merged, 100% helper coverage, Jest green, no generated-file drift. *(No Maestro — not user-reachable yet.)*

### Phase 1 — Data model + backend CRUD + engine + setup wizard (manual)
**Goal:** a user can create a mortgage manually and see balance / % / schedule.
- **1.1 Engine** `amortization.ts` (+ client mirror) with **all of §4** (semi-annual, split, equity-corrected, re-amortization-corrected, state machine, true-up).
  - Unit: **GV-1…GV-5, GV-8, GV-9** in vitest **and** the client mirror in jest (shared fixture). **100% branch coverage.**
  - Verify: engine coverage gate must read 100%.
- **1.2 Schema + migration** `schema-mortgage.ts` + hand-written `0112_mortgage.sql` (`mortgages`, `mortgage_terms`).
  - Unit: `db:generate:guard` green; schema-vs-SQL parity note.
- **1.3 `MortgageService`** (auth-first `checkHouseholdAccess` → `ForbiddenError`) + Hono routes mounted in `backend/src/index.ts` (`create/get/list/update`, `schedule`, `summary`).
  - Unit (vitest, `budget-test-helpers`): non-member → 403; household filter; term sequencing; summary math == engine. **100% of new handlers.**
- **1.4 FE plumbing** `mortgageApi` + `src/api/index.ts` export + `mortgageStore` + tab wiring (4 places) + stack routes.
  - Unit (jest): store `dataRevision` bump; `isFullBudget()` gating of tab/routes.
- **1.5 Setup wizard** `MortgageSetupScreen` (live client-mirror preview) + `MortgageView` shell (KPI tiles + `ProgressRing` + schedule `TableBlock`) + dashboard summary card.
  - Unit (jest): wizard field→payload mapper; empty/rate-unknown state; render smoke.
  - **Maestro:** `mortgage-setup.yaml` (wizard → preview → save → dashboard renders) — **MORT-001…**.
- **1.6 Deploy** budget staging + production; `deploy:fleet`; migrate **both** envs.
  - Verify: live-api-smoke create→summary on staging; `ios-ui-review` (iPhone+iPad) on the wizard + dashboard.
- **Phase DoD:** GV green + 100% engine coverage; routes 100% covered; `mortgage-setup.yaml` green; deployed with new Version ID; matrix rows MORT-001..0xx filled.

### Phase 2 — Statements: manual entry + reconciliation + renewal (term 2) + core charts
**Goal:** statements reconcile the schedule; user can record a renewal; core charts render.
- **2.1 Schema** `mortgage_statements` (+ **UNIQUE (mortgage_id, statement_date)**) + `mortgage_events`; migration `0113`.
  - Unit: `db:generate:guard`; unique-constraint test (dedup).
- **2.2 Reconciliation** `reconciliation.ts` — **event-aware** (§4.5), statement snapping, forward-projection honesty band.
  - Unit (vitest): **GV-6, GV-7**; drift self-correction; prefer-actuals; projection flag. **100% coverage.**
- **2.3 Statement commit + review screen** `MortgageStatementReviewScreen` (single-record editor, doubles as manual entry) + `POST .../statements` with dedup replace-vs-cancel.
  - Unit: commit maps dollars→cents; dedup path; reconciled summary updates.
  - **Maestro:** `mortgage-statement-manual.yaml` — **MORT-1xx**.
- **2.4 Renewal flow** `MortgageRenewalScreen` (critique fix, in Phase 2): create `mortgage_terms` seq+1 (`amortization_months_at_start` correct) + `mortgage_events('renewal')`; re-amortize (§4.6).
  - Unit: **GV-4**; term sequencing; `PMT'` correctness.
  - **Maestro:** `mortgage-renewal.yaml` (renew → term 2 → rate chart step) — **MORT-2xx**.
- **2.5 Core charts** on `MortgageView`: principal-vs-interest stacked bar, equity-growth stacked bar, interest-over-time, per-payment donut, rate-over-time line, `ProgressBar`; insight cards (crossover, VRM trigger, prepayment saved).
  - Unit (jest): each chart data mapper (stacks, donut 0/∞ guards, equity split); insight-flag derivations.
  - **Maestro:** `mortgage-charts.yaml` (each tab renders) — **MORT-2xx**.
- **2.6 Deploy** (both envs) + verify gate + live-smoke add-statement + `ios-ui-review`.
- **Phase DoD:** reconciliation 100% covered; all Phase-2 Maestro flows green; charts render on iPhone+iPad; matrix MORT-1xx/2xx filled.

### Phase 3 — Statement ingestion via upload + AI
**Goal:** scan a statement from Camera/Gallery/Files/Drive → AI draft → review → commit.
- **3.1 Prompt + schema** `extract-mortgage-statement.ts` (dollars, PII-omitting schema).
  - Unit (vitest): schema validates a fixture draft; parses "11 Years 06 Months"→months; end-of-period selection.
- **3.2 Extraction service + route** `mortgage-statement-extraction-service.ts` via `createAnthropicAdapterForUser` (never SDK); `POST .../statements/extract` (multipart, 32MB, mime allowlist, `assertCanUseAI`); **deterministic PII scrub** (§6.4) before returning/persisting.
  - Unit (vitest): mime/size rejection; `assertCanUseAI` gate; **PII scrub strips full number / name**; scrubbed `raw_extraction_json` only.
- **3.3 Scan screen** `MortgageStatementScanScreen` (copy of `BudgetReceiptScanScreen`: 4 sources + `CloudFilePicker` + HEIC fix + `AIAccessGate`) → review screen.
  - Unit (jest): source→upload mapping; HEIC re-encode branch; render smoke.
  - **Maestro:** `mortgage-statement-scan.yaml` (real upload from `resourses/testing` via manifest) — **MORT-1xx**.
- **3.4 Deploy** + verify + live-smoke extract round-trip.
- **Phase DoD:** extraction route 100% covered incl. PII-scrub + mime/size + AI-gate tests; scan Maestro green with a real PDF fixture; deployed.

### Phase 4 — Renewal reminder cron + notification + deep link
**Goal:** proactive reminder N months before maturity, routed to the renewal flow.
- **4.1 Worker** `mortgage-renewal-worker.ts` (window predicate, idempotency, explicit `data.type`, per-member send) + `notification_preferences.mortgage_renewal` column (migration `0114` + `createDefaultPreferences` + `typeMap`).
  - Unit (vitest): window predicate (in/out of window); fire-once idempotency; `data.type` set explicitly; `isBudgetApiEnabled` gate; preference honored. **100% of worker.**
- **4.2 Cron wiring** in `scheduled.ts` (gated, 08:00 UTC window) — do NOT add to House visibility lists.
  - Unit: cron block invoked only in window + gate.
- **4.3 Deep link** `notificationRouting.ts` branch + `navigateToMortgage` + renewal banner in `MortgageView`.
  - Unit (jest): routing maps `mortgage_renewal` → `MortgageMain`; banner shows within window.
  - **Maestro:** extend `mortgage-renewal.yaml` — banner tap → renewal flow.
- **4.4 Deploy** (both envs; production cron-limit warning OK if Version ID updates) + verify.
- **Phase DoD:** worker 100% covered; deep link + banner tested; deployed with new Version ID; matrix MORT-3xx filled.

### Phase 5 — Renewal offer shopping + advanced insights
**Goal:** compare bank renewal offers; accept → new term; what-if insights.
- **5.1 Schema** `mortgage_renewal_offers` (migration `0115`) + service/routes (CRUD, status).
  - Unit (vitest): CRUD auth/household filter; payment-saved-vs-incumbent computation. 100% handlers.
- **5.2 Offers screen** `MortgageRenewalOffersScreen` (add/compare, shortlist/accept → creates term via §7 renewal path) + compare table + insight.
  - Unit (jest): compare mapper; accept→renewal payload.
  - **Maestro:** `mortgage-renewal-offers.yaml` — **MORT-3xx**.
- **5.3 What-if insights:** accelerated-payment savings, lump-sum interest saved (§4.7) as insight cards.
  - Unit: **GV-2** ties to accelerated card; lump-sum interest-saved math.
- **5.4 Close-out:** full matrix audit (MORT-001..3xx all present), `sync-tests` pass, `ios-ui-review` on all mortgage screens iPhone+iPad, live-smoke full round-trip.
- **Phase DoD:** every matrix row has a unit test + (user-facing) Maestro flow; coverage thresholds green repo-wide for mortgage globs; deployed.

---

## 13. Test matrix (IDs — filled as steps land)

| Range | Area |
|---|---|
| **MORT-001..099** | Setup wizard + engine (GV-1..GV-9, state machine, deploy round-trip) |
| **MORT-100..199** | Statements: manual entry, extraction, reconciliation, dedup, PII scrub |
| **MORT-200..299** | Charts & insights (each chart, crossover, VRM trigger, equity split); **MORT-255** rate-movement chart; **MORT-260** Forecast tab (baseline projection + interactive rate scenario via chips) |
| **MORT-300..399** | Renewal reminder cron, deep link, term-2 flow, offers |

**v2 — forecast & flexible-rate (added):**

| ID | Behavior | Test |
|---|---|---|
| **MORT-256** | Forward projection uses the LATEST statement rate, not the term rate (`resolveForwardRate`) | vitest `mortgage.test.ts` "projects … at the LATEST statement rate" |
| **MORT-257** | Interest-paid-to-date sums statement actuals; `paidToDate.interestSource='actual'` | vitest `mortgage.test.ts` "sums the bank's actuals" |
| **MORT-258** | `projected.toEndOfTerm` forecasts balance/equity/interest at maturity | vitest `mortgage.test.ts` "forecasts to the end of the current term" |
| **MORT-259** | `interestOverPeriods` closed-form split (both engines) | vitest + jest `amortization.test.ts` |
| **MORT-260** | Rate-scenario math (payment/interest/equity/keep-payment trigger) | jest `mortgageScenario.test.ts`; Maestro `mortgage-forecast.yaml` |
| **MORT-261** | Statement rate-movement chart mapper | jest `mortgageChartData.test.ts` |

**v4 — Payments tab deep dive (added, §8.2):**

| ID | Behavior | Test |
|---|---|---|
| **MORT-262** | Schedule rows are dated and bucketed by calendar month/year; the chart axis NEVER shows a payment number | jest `paymentsInsights.test.ts` (`attachDates`/`groupByYear`/`groupByMonth`); `MortgagePaymentsView.test.tsx` "labels the bars by calendar month, never by payment number" |
| **MORT-263** | A ≥12-year schedule is thinned to every *n*th year **plus the payoff year**, and the caption declares the thinning | jest `paymentsInsights.test.ts` "thins a long list but always keeps the first and the payoff year"; `MortgagePaymentsView.test.tsx` "switches to one bar per year (thinned, and says so)" |
| **MORT-264** | Month bucketing folds a 26×/52× cadence into ≤12 bars (bars sum their payments) | jest `paymentsInsights.test.ts` "folds a 26×/yr cadence into ≤12 month bars" |
| **MORT-265** | Next-payment anatomy: interest/principal split + the balance's daily interest cost | jest `MortgagePaymentsView.test.tsx` "breaks the next payment down and prices the balance per day"; `paymentsInsights.test.ts` `interestPerDayCents` |
| **MORT-266** | Tipping point = first schedule row where principal > interest; dated, counted down, flips to "passed" | jest `paymentsInsights.test.ts` `crossoverInsight`; `MortgagePaymentsView.test.tsx` "dates the tipping point and counts down to it" |
| **MORT-267** | The year card prefers the bank's statement actuals for that calendar year, falls back to the plan | jest `paymentsInsights.test.ts` `yearInsight`; `MortgagePaymentsView.test.tsx` "prefers the bank's own figures" / "falls back to the plan" |
| **MORT-268** | Cumulative interest vs principal share ONE axis ceiling; crossing year + cost per $1 borrowed | jest `paymentsInsights.test.ts` `buildCumulativeSeries`; `AppLineChart.test.tsx` "scales a second series to the SAME ceiling"; `MortgagePaymentsView.test.tsx` "plots cumulative interest against cumulative principal" |
| **MORT-269** | Front-loading: payments-made share vs interest-burned share on one basis; new-mortgage copy leads with the first payment's interest share | jest `paymentsInsights.test.ts` `frontLoadingInsight`; `MortgagePaymentsView.test.tsx` "contrasts payments made with interest already burned" / "leads with the first-payment interest share" |
| **MORT-270** | Degradation: no schedule → asks for a rate/statement; no summary → payment-indexed bars with the calendar controls hidden | jest `MortgagePaymentsView.test.tsx` "asks for a rate/statement…" / "degrades to payment-indexed bars…" |
| — | Visible-region interaction (range chips + year stepper) | Maestro `mortgage-tabs.yaml` (lower cards can't be scrolled to on iOS 26) |

**v5 — Overview interest-vs-equity card (added):**

| ID | Behavior | Test |
|---|---|---|
| **MORT-271** | Overview's split card reads LAST payment on top, TERM AVERAGE below — one payment means nothing without the yardstick | jest `MortgageView.branches.test.tsx` "stacks the last payment over the term average" |
| **MORT-272** | The last payment prefers the bank's own statement figures (principal taken as stated → from the balance movement → from the payment amount), skipping a statement it can't split | jest `paymentsInsights.test.ts` `lastPaymentSplit`; `MortgageView.branches.test.tsx` "uses the bank's own figures…" |
| **MORT-273** | A statement period covering >1 payment is labelled "Last statement" with its payment count — a 2-payment total is never called one payment | jest `paymentsInsights.test.ts` "reports how many payments a statement period covered" |
| **MORT-274** | No usable statement → the last elapsed row of the plan (and the upcoming first payment on a brand-new mortgage), each saying which it is | jest `paymentsInsights.test.ts` `lastPaymentSplit` fallbacks; `MortgageView.branches.test.tsx` ("from your plan") |
| **MORT-275** | The term average covers only payments up to maturity (not the 25-year plan), shares taken from the term totals, date span declared | jest `paymentsInsights.test.ts` `termAverageSplit` |

**v3 — customizable tab strip (added):**

| ID | Behavior | Test |
|---|---|---|
| **MORT-340** | Mortgage settings offers "Customize tabs" (with or without a property) | jest `MortgageSettingsScreen.test.tsx` "opens the tab customizer"; Maestro `mortgage-tabs-customize.yaml` |
| **MORT-341** | Overview is LOCKED — no hide affordance, forced back into `shown` however the layout was persisted, so the strip is never empty | jest `mortgageTabs.test.ts` "never hides the locked tab"; `MortgageTabsScreen.test.tsx` "offers no hide affordance" |
| **MORT-342** | Hide / show moves a tab between the two lists; Save persists `subTabOrder` + `hiddenSubTabs` (hidden ids kept at the end of the order) | jest `MortgageTabsScreen.test.tsx` "saves the full order plus the hidden set"; `mortgageStore.test.ts` |
| **MORT-343** | Drag-and-drop reorder persists the new strip order | jest `MortgageTabsScreen.test.tsx` "persists a drag-reordered strip" (Maestro can't drive an RN New-Arch drag on iOS 26) |
| **MORT-344** | Dashboard renders the saved layout: hidden tabs gone, saved order honoured | jest `MortgageView.tabLayout.test.tsx`; Maestro `mortgage-tabs-customize.yaml` |
| **MORT-345** | Hiding the tab you were last on falls back to the first REMAINING content view (not blindly Overview) instead of a blank body | jest `MortgageView.tabLayout.test.tsx` "falls back to the first REMAINING view" |
| **MORT-346** | A stale/corrupt saved layout is tolerated — unknown ids and dupes dropped, newly-shipped tabs appended visible | jest `mortgageTabs.test.ts` "drops ids that are no longer in the catalog" / "appends catalog tabs a stale saved layout never knew about" |
| **MORT-347** | Reset restores the factory strip | jest `MortgageTabsScreen.test.tsx` "restores the default strip"; Maestro `mortgage-tabs-customize.yaml` (mandatory cleanup) |

**v6 — header title as the property picker (added):**

| ID | Behavior | Test |
|---|---|---|
| **MORT-311** | The Mortgage header TITLE is the property switcher: it names the focused property and opens the list — switching no longer detours through the gear | jest `MortgageSwitcher.test.tsx` "labels the trigger with the selected property"; `BudgetScreen.tabs.test.tsx` "renders the property switcher as the Mortgage header title"; Maestro `mortgage-title-switcher.yaml` |
| **MORT-312** | Picking another property re-focuses the dashboard on it; re-picking the one already shown is a no-op (selection alone re-runs the load — no `markDirty`, or it would load twice) | jest `MortgageSwitcher.test.tsx` "selects another property and closes" / "does not re-select (and so does not reload)…"; Maestro `mortgage-multi-property.yaml` |
| **MORT-313** | The sheet always offers "Add a property" → the set-up flow | jest `MortgageSwitcher.test.tsx` "opens the set-up flow from \"Add a property\"" |
| **MORT-314** | No property yet → a plain "Mortgage" title (no dead dropdown over the set-up empty state) | jest `MortgageSwitcher.test.tsx` "falls back to a plain title…"; `BudgetScreen.tabs.test.tsx` "falls back to a plain \"Mortgage\" title with no properties" |
| **MORT-315** | The header's "+" (Add statement) shortcut is retired — adding a statement lives on the Statements sub-tab, whose own header carries the "+" | jest `BudgetScreen.tabs.test.tsx` "drops the header \"Add statement\" shortcut"; Maestro `mortgage-title-switcher.yaml` |
| **MORT-316** | The switcher renders off the list the dashboard already fetched (`mortgageStore.mortgages`, never persisted) rather than a second `list()` call | jest `MortgageView.test.tsx` "publishes the property list for the header switcher" / "empties the published list…"; `mortgageStore.test.ts` "never persists the property list" |

Follow [change → update tests + matrix]: **every new behavior → a unit test + a matrix row + (if user-facing) a Maestro flow.**

---

## 14. Open questions / decisions needed

- **OQ-1** Budget-only (v1 default) vs a new ecosystem `homeFinance` capability flag + `src/features/mortgage` barrel?
- **OQ-2** Section tab + dashboard card (design ships both) confirmed?
- **OQ-3** Tie a mortgage to a household *property* record, or purely household-scoped under Budget (design: household-scoped, property link = future)?
- **OQ-4** Variable-rate prime: ask the user, or maintain a small server-side prime benchmark to auto-fill spread-based rates?
- **OQ-5** Surface prepayment **penalty** estimates (IRD vs 3-months-interest) for break/refi, or savings-only for v1?
- **OQ-6** Renewal reminder default lead time = 3 months; expose `reminder_months_before` in setup or settings only?
- **OQ-7** Retain `raw_extraction_json` (audit) even PII-scrubbed, or discard after commit? (privacy sign-off)
- **OQ-8** Property-tax / creditor-insurance portions: track as PITH view or leave to existing Budget categories (design: store on term, exclude from P&I math)?
- **OQ-9** Multiple mortgages per household in v1 (picker) vs single-mortgage simplification?

## 15. Risk register

| Risk | Mitigation |
|---|---|
| Math wrong vs bank statement | §4 corrected engine + GV-1..GV-9 at 100% coverage; statement reconciliation overrides theory |
| PII leak from statements | deterministic server scrub (§6.4), last-4 only, never logged/telemetered |
| Renewal reminder dead-ends | term-2 renewal flow promoted to Phase 2; reminder + offers both route to it |
| iOS-26 Maestro flakiness | one booted sim, serial; assert on testIDs not scroll ([Maestro iOS-26] memories) |
| Generated-file drift breaks House-baseline Jest | keep mortgage assets/tokens out of shared generated files; verify baseline each phase |
| Migration/schema drift across phases | `db:generate:guard` green each phase + parity note |
| **Combined products (FlexLine/STEP) mis-extracted** | balance-disambiguation prompt rule + `product_type`; HELOC portion explicitly out of scope v1 (§6.6) — validated on a real TD statement (§16) |

---

## 16. Appendix — Real-document validation (TD Home Equity FlexLine, Jul 2025)

Before writing a line of code, the design was validated against a **real Canadian mortgage statement** (`resourses/testing/Budge- Mortgage statement.pdf`) to de-risk the extraction schema (§6) and the amortization engine (§4). This is the origin of GV-10 and the §6.6 combined-product rules.

**Document:** TD Home Equity FlexLine, 4 pages, statement period Jul 1–31 2025, statement date Jul 31 2025. A **readvanceable** product: a revolving HELOC portion **+** a variable-rate Term Portion (the mortgage). It is the **origination** statement (opening balance $0).

**Extracted `RawMortgageStatement` draft (PII-scrubbed, as the pipeline would persist it):**

| Field | Value |
|---|---|
| lender | TD |
| product_type | `heloc_flexline` (has_heloc_portion = true) |
| statement_date | 2025-07-31 |
| period_start / period_end | 2025-07-01 / 2025-07-31 |
| mortgage_number_last4 | `9855` *(full number & borrower names dropped by deterministic scrub — never stored/logged)* |
| new_advance_amount | $976,000.00 (Term Portion origination, Jul 17) |
| closing_balance | **$975,361.04** (Term Portion "Closing Principal Balance" — the anchor) |
| principal_paid | $638.96 |
| interest_paid | $1,531.12 |
| interest_charged | $1,640.41 (differs — payment-frequency timing, TD footnote 4) |
| payment_amount | $2,170.08 |
| payment_frequency | biweekly (inferred: Aug 14 → Aug 28 = 14 days) |
| rate_type | variable |
| prime_rate / variance / net rate | 4.950% / −0.860% / **4.090%** |
| maturity_date | 2028-07-13 (⇒ ~3-yr term) |
| remaining_amortization | not on statement → null (ask user; solved ≈30 yr) |

**Engine checks (all run in Python against §4 formulas — see validation log):**

| Check | Result |
|---|---|
| Reconciliation identity `closing = advance − principal_paid` | `976,000 − 638.96 = 975,361.04` — **exact PASS** |
| Payment split `principal + interest = payment` | `638.96 + 1,531.12 = 2,170.08` — **exact PASS** |
| Variable interest = daily simple `bal × rate × days/365` | `976,000 × 4.090% × 14/365 = 1,531.12` — **exact PASS** (⇒ §4.10) |
| Implied amortization from PMT (both conventions) | ≈ **29.8–30.1 yr** (biweekly) — clean 30-yr |
| Engine PMT, 30-yr biweekly variable | monthly-conv `$2,173.00` (Δ +$2.92) vs semi-annual `$2,163.06` (Δ −$7.02) → **monthly convention for variable is correct** (§4.2) |

**Design changes triggered by this test:** §4.10 (daily-interest for variable), §6.3 (balance disambiguation, interest-paid-vs-charged, frequency inference, prime±variance, new-advance detection), §6.6 (combined/readvanceable product handling), data-model `product_type` + `interest_charged_cents` + `prime_rate_bps`/`variance_bps` on statements, and GV-10 as a permanent regression vector. **Verdict: the corrected engine reproduces a real statement to the cent; the extraction schema needed the combined-product hardening above.**
