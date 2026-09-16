# Bulk Purchases (stock-up spreading) - Feature Requirement / BRD

| Field | Value |
|-------|-------|
| **Doc type** | Feature BRD / requirement |
| **Feature id** | `budget-bulk-purchases` |
| **Owning app** | `simple-budget` |
| **Status** | `approved` (§7 answered 2026-09-11); v1 implemented on `budget-v2`, device verification pending |
| **Version** | `v0.2` |
| **Created** | 2026-09-11 |
| **Last updated** | 2026-09-11 |
| **App BRD** | [documents/apps/symply-budget/BRD.md](../../apps/symply-budget/BRD.md) |
| **App TRD** | [documents/apps/symply-budget/TRD.md](../../apps/symply-budget/TRD.md) |
| **Feature TRD** | [Bulk_Purchases_TRD.md](./Bulk_Purchases_TRD.md) |
| **Implementation** | [Bulk_Purchases_Implementation.md](./Bulk_Purchases_Implementation.md) |

---

## Agent Kickoff Prompt

```text
Read first:
1. AGENTS.md
2. documents/ecosystem/PROJECT.md
3. documents/apps/symply-budget/README.md, BRD.md, TRD.md
4. documents/requirements/Buget v2/Symply_Budget_TRD_v2.0.md (local-first ledger, ops, LWW)
5. This BRD, then Bulk_Purchases_TRD.md, then Bulk_Purchases_Implementation.md

Rules:
- Budget V2 local-first path only. The device ledger is the source of truth;
  the Cloudflare Worker never sees amounts. No backend change in v1.
- Core path must work with AI off. The estimator is deterministic and offline.
- Keep the existing Budget UI shell; add one section to the Record spending
  form and badges to the Spendings list. No new tabs.
```

---

## 0. Version History

| Version | Date | Changes |
|---------|------|---------|
| v0.1 | 2026-09-11 | Initial proposal after codebase research |
| v0.2 | 2026-09-11 | Owner answered Q1–Q4 (one lens everywhere; stepper max 12; re-spread all months; no legacy D1 path). v1 built: BR-01–BR-15 on `budget-v2`. |

---

## 1. Overview

### 1.1 Summary

| Item | Value |
|------|-------|
| Feature name | Bulk purchases (stock-up spreading) |
| Owning app | `simple-budget` |
| Objective | A stock-up purchase (30 kg of salmon for $400, ten packs of coffee at Costco) is paid once but consumed over months. Today it lands entirely in the purchase month, flips the month to "over budget", breaks the category cap, distorts trends and Insights, and discourages the member even though the household is on track. A member marks a spending as a bulk purchase; the app estimates from the household's own consumption history how many months it should last, spreads the amount over those months, and shows each future month its reserved share, labelled with the purchase month and year. |
| Primary users | The member recording the spending; every other member of the household, who sees the same spread on their device |
| Success metrics | A month containing a bulk purchase is not shown "over budget" solely because of it. After three months of history the suggested month count is accepted unchanged in at least half of bulk purchases (computed on device, never sent). Every device in a household shows identical month totals. Zero AI calls on the core path. |

### 1.2 Why this shape

The problem is not the purchase, it is the **lens**. Budget's monthly goal is a consumption cap, and a stock-up is consumption pulled forward. The ledger must keep the truth (one purchase, one date, one amount, so backups, receipts and cash history stay honest) while every month-scoped number counts only the share consumed in that month. That is an accrual view of one row, not a new kind of row.

Two alternatives were rejected:

| Alternative | Why not |
|-------------|---------|
| Split the purchase into N separate expense rows dated in future months | Fragments one transaction into N editable rows (edit one, the others drift); the receipt, discount and vendor belong to one event; the consumption history the estimator learns from would then contain N fake purchase events; a cash view becomes impossible to reconstruct. |
| Create planned items in future months for the remaining share | Planned items are money not yet spent; recording them later would create a second, false expense. The stock-up is already paid. |

### 1.3 Fleet Placement

| Concern | Requirement |
|---------|-------------|
| Shared User | Reuse the same `user_id`; no new account system. |
| Brand system | Budget `features.budget = full` only. House `minimal` does not get the toggle. |
| Data sharing | None. No Soft Transfer package changes. |
| AI | Not used on the core path. The estimator is deterministic. AI Insights may later be told about bulk purchases so the summary stops scolding the member (Phase 2). |

---

## 2. Scope

### 2.1 In Scope

- A **"Bulk purchase (stock-up)"** toggle on the Record spending form, for new and edited spendings.
- A **deterministic on-device estimator** that proposes how many months the purchase should last, using in order of strength: the household's own previous bulk decision for the same product, the product's purchase history (rate and cadence), related products via the household naming lexicon and receipt aliases (Salmon ↔ Fish), the category's rate when the category is narrow, and an honest default when there is no history.
- A **member-adjustable month count** with a live preview of every month's portion and the remaining budget of that month after the portion.
- The **month lens**: dashboard totals and donut, Spendings list, per-category sub-budget caps, category product trends, home teaser, widget and Watch snapshots, Insights fingerprint, encouragement, Savings "recorded net", export month summary all count a bulk purchase by its portion for that month.
- **Future months** show their reserved portions in a "From bulk purchases" group, each labelled "Bulk purchase · September 2026 · 2 of 4"; opening one edits the original purchase.
- The Spendings tab may **navigate forward** up to the furthest month holding a reserved portion.
- **Edit and delete** apply to the whole purchase: changing the amount, months or date re-spreads every portion; deleting removes them all; switching the toggle off returns the full amount to the purchase month.
- **Sync**: the plan is a field of the expense row and travels with it; every peer computes the same portions from the same row.

### 2.2 Out Of Scope (v1)

- Per-line bulk marking inside receipt review, quantity/unit-based estimates, AI "add in words" hints, bulk context in the Insights prompt: **Phase 2** in the implementation plan.
- Parity on the legacy D1 remote budget path (House `minimal`, `EXPO_PUBLIC_BUDGET_LOCAL_FIRST=0`): **Phase 3, optional**. The toggle is hidden when the local-first engine is off.
- Uneven or custom portions, and "start counting next month". The data model allows a different start month; the v1 UI always starts in the purchase month.
- Cash-basis reporting, bank linking, shelf-life or perishability knowledge.

### 2.3 Dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| Budget V2 local-first ledger (`src/features/budget/local/`) | feature | Expense rows, ops, per-field LWW, backup/export pass-through |
| Household naming lexicon and vocabulary (`src/screens/budget/budgetNameLexicon.ts`, `budgetNameSuggestions.ts`) | feature | Connects "Salmon" to the household's "Fish" rows |
| Receipt aliases (`src/features/budget/local/receiptAliases.ts`) | feature | Connects printed receipt names to the household's chosen names |
| Monthly goals and sub-budgets | feature | Preview shows each month's remaining budget after its portion |
| Savings projection (`localSavingsProjector`, `scenarioProjection`) | feature | Reads Budget spendings per month; must use the same month lens |

---

## 3. Requirements

| Req ID | Requirement | Priority | Notes |
|--------|-------------|----------|-------|
| BR-01 | The Record spending form (spent kind only) offers a "Bulk purchase (stock-up)" toggle, placed with "On sale / discount". | P0 | Hidden on planned spendings, on House `minimal`, and when the local-first engine is off. |
| BR-02 | Turning the toggle on shows a suggested month count within the form, computed on device without a network call, with a one-sentence explanation of the evidence and a confidence cue. | P0 | Copy in §4. |
| BR-03 | The member can change the month count (2 to 12) and the preview updates immediately: each month, its portion, and that month's remaining budget after the portion, or "No budget set yet". | P0 | Q2: stepper and suggestion both cap at 12. |
| BR-04 | Portions sum exactly to the amount, in integer cents; the remainder cents go to the earliest months. | P0 | Deterministic, so every device renders the same split. |
| BR-05 | The first portion is counted in the purchase month. | P0 | |
| BR-06 | Every month-scoped total in the app counts a bulk purchase by its portion for that month. | P0 | The TRD lists every read site. A single helper is the only way to compute a month. |
| BR-07 | A month that holds a portion from an earlier purchase lists it under "From bulk purchases" with the label "Bulk purchase · \<Month Year\> · i of N" and the portion amount; tapping opens the original purchase. | P0 | |
| BR-08 | In the purchase month, the row shows the counted portion as its amount and a chip "Bulk · 1 of 4 · $400.00 total". | P0 | The list always sums to the month total. |
| BR-09 | Editing the amount, months or date re-spreads all portions; deleting the purchase removes every portion; switching the toggle off restores the full amount to the purchase month. | P0 | Atomic: one row, one op. |
| BR-10 | With no usable history the estimator proposes 3 months and says so plainly. | P0 | Never a fake confident number. |
| BR-11 | The estimator prefers the household's own previous bulk decision for the same product, scaled by purchase size. | P1 | The saved plan is the memory; no separate store. |
| BR-12 | The estimator uses the household naming lexicon and receipt aliases so "Salmon" learns from "Fish" rows, and a receipt line name learns from its household alias. | P1 | |
| BR-13 | A discount recorded on the bulk purchase counts at regular-price equivalent (amount plus saved amount) when compared to history, so a cheaper bulk unit price does not shorten the estimate. | P1 | Uses the existing `saved_amount`. |
| BR-14 | The Spendings tab allows forward navigation up to the furthest month that holds a reserved portion. | P1 | Today it stops at the current month. |
| BR-15 | The Transfer screen shows a line "Includes \<amount\> reserved for later months from bulk purchases" whenever the month holds deferred cash. | P1 | Leftover stays on the month lens; the line makes the cash gap visible. |
| BR-16 | Multi-select "copy to month" of a bulk expense copies the plan re-anchored to the destination month. | P2 | |
| BR-17 | Receipt review offers a per-line "Bulk" chip using the same estimator, with the receipt's quantity and unit when printed. | P2 | Phase 2 |
| BR-18 | Quantity and unit are stored on the expense when known, and the estimator uses units per month when both the purchase and the history carry them. | P2 | Phase 2 |
| BR-19 | AI Insights (BYOK) receive the month's bulk purchases as context so the summary explains rather than scolds. | P2 | Phase 2 |

---

## 4. UX And Content

| Surface | Requirement |
|---------|-------------|
| Entry point | Record spending form, below "On sale / discount": checkbox row "Bulk purchase (stock-up)". |
| Expanded section | Headline "Should last about **4 months**" with a − / + stepper. Basis line (one sentence). Preview list: one row per month. Footer: "This month counts $100.00 of $400.00." |
| Basis copy | Own precedent: "Last time you spread Coffee over 5 months." Product history: "Based on 6 purchases of Salmon since March, about $95 a month." Related products: "Based on what you usually spend on Fish (Salmon, Cod)." Category: "Based on what you usually spend on Fish." Default: "No history for Coffee yet. Pick how many months it should last." Small purchase: "Looks like a normal-size purchase for you. Two months is the minimum." |
| Preview row | "Oct 2026 · $100.00 · $1,900.00 left after this" or "· No budget set yet" (muted). The current month row reads "· $412.00 left after this" using the current month's real totals. |
| Spendings list, purchase month | Amount shows the counted portion; chip "Bulk · 1 of 4 · $400.00 total". |
| Spendings list, later months | Group "From bulk purchases" after the recorded spendings; row amount is the portion; chip "Bulk purchase · Sep 2026 · 2 of 4". Tap opens the original purchase in edit mode. Swipe actions: none (edit only through the original). |
| Month header | Forward arrow enabled while a later month holds a reserved portion. |
| Transfer screen | Under "Budget … · Spent …": "Includes $300.00 reserved for later months from bulk purchases." |
| Empty state | None needed; the section only exists when the toggle is on. |
| Error state | None on the core path (no network). A save failure follows the existing form toast. |
| Copy tone | Plain and non-judgemental. Never "over budget because of the bulk purchase"; say what is counted where. |
| Accessibility | Stepper buttons carry accessibility labels ("Fewer months", "More months") and the value is announced. Chips carry text, not colour alone. Dynamic Type wraps rows. |

Design references:

- [DesignSystem.md](../../design/DesignSystem.md)
- [documents/apps/symply-budget/design.md](../../apps/symply-budget/design.md)

Worked example, the member's own case:

| Month | Counted | Comment |
|-------|---------|---------|
| Sep 2026 | $100.00 | Purchase month. Cash paid: $400.00. |
| Oct 2026 | $100.00 | Reserved, "Bulk purchase · Sep 2026 · 2 of 4" |
| Nov 2026 | $100.00 | Reserved, 3 of 4 |
| Dec 2026 | $100.00 | Reserved, 4 of 4 |

---

## 5. Data, Privacy, And Sharing

| Data | Owner | Requirement |
|------|-------|-------------|
| Bulk plan (months, start month, suggestion, basis, optional quantity/unit) | Budget device ledger | Stored as one field of the expense row inside the sealed row body. Synced to household peers through the existing zero-knowledge mailbox as part of the row. Never sent in plaintext. |
| Estimator inputs | Budget device ledger | Read on device only. Nothing leaves the device. |
| Telemetry | Platform analytics | At most an event "bulk_toggle_on" with basis and confidence. Never amounts, product names or month counts. |

Privacy rules:

- No backend schema or Worker change in v1. The Worker keeps receiving opaque ciphertext.
- No AI call on the core path. Phase 2 Insights context uses the member's own BYOK key under the existing consent.

Soft Transfer packages:

| Package | From | To | Consent | Status |
|---------|------|----|---------|--------|
| none | | | | |

---

## 6. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Month totals no longer match the bank statement for the purchase month (accrual vs cash) | Member confusion | Chips say what is counted where; Transfer screen shows the reserved cash line; the row's total is always visible. |
| Editing the month count later changes closed months' totals | Surprising history | v1 re-spreads all months (simple and deterministic) and says "Changes earlier months too" when a closed month is affected. v1.1 option: keep closed months fixed and re-spread only the remainder. |
| A peer on an older app version ignores the plan and counts the full amount | Temporary divergence between devices | Pre-release tester fleet; converges once the peer updates. Documented in the TRD. |
| The estimator is confidently wrong (a one-off purchase looks like a habit) | Bad default the member has to fix | Evidence sentence always shown; confidence capped by sample size; the stepper is one tap away; the member's choice becomes the strongest signal next time. |
| The Spendings tab now shows future months | A "future spending" looks like a bug | Future months show only the "From bulk purchases" group with explicit labels; forward navigation stops at the last reserved month. |
| Two "spent" numbers if Savings kept a cash basis | Members see different totals for the same month in two tabs | Decision in §7 Q1: one month lens everywhere. |

---

## 7. Open Questions

| # | Question | Owner | Status |
|---|----------|-------|--------|
| Q1 | Savings "recorded net" uses the month lens (accrual) like the rest of the app. | Product | **answered 2026-09-11: yes.** One number per month everywhere; the Transfer screen carries the cash note. |
| Q2 | Stepper maximum. | Product | **answered: 12.** Stepper and suggestion both cap at 12 months. |
| Q3 | When a plan is edited after some months closed, re-spread all months or freeze closed months? | Product | **answered: re-spread all months.** The form says "Changes earlier months too." |
| Q4 | Legacy D1 remote budget path parity. | Engineering | **answered: none.** There are no real users and no legacy data; only the local-first path exists. No D1 columns, no Worker change, no compatibility shims for older peers. |

---

## 8. Acceptance

- [x] Requirements are app-boundary safe (Budget only, no House scope).
- [x] AI-off path is the only path in v1.
- [x] Data/privacy implications are clear: one sealed row field, nothing new leaves the device.
- [x] Feature TRD can be created without guessing product scope.
- [x] Q1 to Q4 answered by the owner before implementation starts (2026-09-11).
