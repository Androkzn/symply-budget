# Receipt recognition v2 — Budget

App: Symply Budget (app id `simple-budget` · brand id `symply-budget`).  
Index: [features/README.md](../apps/symply-budget/features/README.md).  
App BRD/TRD stay app-level. This is the decisions note.  
**Build from:** [MASTER_PLAN.md](budget-receipt-recognition-v2/MASTER_PLAN.md) **v1.2**.

## Verdict on the research delta

Checked against the tree on 2026-08-15. Accept unless noted.  
Plan version: **v1.2** (review-plan: 0159, migrate-then-deploy, storageHelpers, 1568 resize, Phase 4 BYOK gate).

| # | Claim | Verdict |
|---|---|---|
| 1 | Printed UPC / PLU / Costco item # as alias + merge key (`raw_code`) | **Accept.** Superstore UPCs, PLU `4045`, Costco `43483` / `610845` are on the fixtures. Costco `TPD/610845` names its target — attach discounts by code, not “line above”. |
| 2 | Derive `saved_amount` from `lmt` / regular-vs-paid, not only ARCP | **Accept.** Prompt already mentions struck-through regular price; Superstore `$5.99 ea` / paid `$3.99` is still dropped today. |
| 3 | Store `taxable` in 0158 because flags+$0 tax cannot round-trip | **Reject.** Superstore `RJ`/`RQ` with subtotal = total are store status codes, not “taxable”. Label **Tax** only when `tax_amount > 0`. A stored flag would mislabel those groceries. |
| 4 | Banner wording “paid $X in deposits”; CRV is its own `kind` (taxable at POS) | **Accept.** Do not say “returnable” / “you’ll get $X back”. Canadian deposits stay out of the tax base; US CRV stays in it. `deposit_amount` still sums `deposit` + `crv` for the period tile. |
| 5 | BC profile missing `L` (liquor PST 10%) | **Accept.** Confirmed: `BC: { G: GST, P: { label: 'PST', rate: 0.07 } }` in [tax-attribution.ts](../../backend/src/services/budget-analysis/receipt/tax-attribution.ts). Add `L: { label: 'PST Liquor', rate: 0.10 }`. Printed amounts still win. NS 14% is already correct. |
| 6 | Region: Settings → receipt address → household → `expo-localization` first-run | **Accept.** `expo-localization` is in `package.json` and imported nowhere under `src/` / `app/`. No GPS. |
| 7 | Aliases are device-local — state it | **Accept.** v1 via `storageHelpers` key `budget.receiptAliases.v1` (not raw MMKV). Each member trains their own scanner. |
| 8 | `E2E_VERIFY_PATH=/budget/receipts/scan` fails on local-first | **Accept, and it is the default.** [`isBudgetLocalFirst()`](../../src/features/budget/local/flag.ts) is on for `symply-budget` unless `EXPO_PUBLIC_BUDGET_LOCAL_FIRST=0`. Quality flows must skip Worker-path verify (or use persist/UI asserts) on this branch. |
| 9 | Log `analyzeAssetQuality`; long-edge cap after HEIC→JPEG | **Accept.** Helper already exists. Client today: `compress: 0.8`, **no resize**. Plan: long-edge **1568** (savings-import precedent) then JPEG 0.8; log both sides. |
| 10 | `food-category-detector.ts` as category first pass | **Reject.** That detector maps to Health nutrition buckets (`vegetables`, `fruits`, `dairy`, …), not household spend categories (`Groceries`, `Alcohol & Bars`). Wrong taxonomy. Keep AI + household list + aliases + quick-add history. |

Chip overflow: reuse the **pattern** from [budgetItemFormUtils.ts](../../src/screens/budget/budgetItemFormUtils.ts) (`primary` + “More”), not `WHEN_OPTIONS` itself. Show ~3 name chips + more, not all 7.

## Branching

| Lands on | What |
|---|---|
| **`main`** (`~/Desktop/Symply Ecosystem/Simply Ecosystem/`) | Prompt/schema, fee attach, BC `L`, **`0159`** `deposit_amount` (0158 is taken), Worker debug. Migrate all brand D1s **then** `deploy:fleet`. Never from this clone. |
| **`budget-v2`** (this clone) | Review chips, store, tax pill, deposits banner, `storageHelpers` aliases, Maestro, local ledger. Never edit `backend/**` here. |

Never `deploy:fleet` from this clone.

## Pipeline (unchanged shape)

photo → [toVisionSafeAttachment](../../src/utils/visionSafeAttachment.ts) → [ReceiptScanService](../../backend/src/services/budget-analysis/receipt/receipt-scan-service.ts) or local [runReceiptImportLadder](../../src/features/budget/local/ai/localImportLadder.ts) → [BudgetReceiptScanScreen](../../src/screens/budget/BudgetReceiptScanScreen.tsx) → `addExpensesBulk`.

Chat `scan_receipt_for_review` must keep [toReceiptDraft](../../backend/src/services/budget-analysis/receipt/draft.ts), [receiptImport.ts](../../src/features/budget/local/ai/prompts/receiptImport.ts), and `chatMessageReceiptDraft` in schema lockstep so suggestions are not dropped.

## Schema / prompt additions

Per item:

- `raw_name`, `raw_code` (UPC / PLU / retailer item #, or null)
- `name_suggestions` (≤7; always include Title Case original)
- `name` (default = suggestions[0], aliases win when `raw_code` or raw_name hits)
- `category` + `category_suggestions` — AI layer is verbatim household **names**; server maps to `{id,name}[]` for the client
- `fees[]`: `{ kind: 'deposit' \| 'environmental' \| 'bag' \| 'crv' \| 'other', label, amount }` attached to the parent; never their own expense
- `tax_codes` as today
- Tax base: `deposit` out of CA GST; `environmental` **in** CA GST (CRA B-089); `crv` in US sales tax

Receipt-level: `vendor` (`"Other"` if unreadable), `purchase_date`, `tax_summary`, `subtotal`, `total`, optional `receipt_country` / `receipt_region` from the printed address.

Do **not** semantically merge (`Tomatoes` / `Alcohol`). Collapse only lines that share the same `raw_code` (or identical raw_name when code is missing). Attach `TPD/610845`-style discounts by the referenced code.

`0159` (claim on **main** only — `0158_ai_usage_accuracy.sql` already exists): `expenses.deposit_amount INTEGER NOT NULL DEFAULT 0`. No `taxable` column. `COLUMNS_PER_ROW` 16 → 17.

## Region for the model

1. Settings `taxCountry` / `taxRegion`
2. Address printed on the receipt
3. `households.country` / `state_province`
4. First-run Region picker default from `expo-localization` (device locale)

## Persistence

- `vendor` on every bulk line; editable on review and on the manual spend form (`"Other"` placeholder).
- `deposit_amount` mirrors `saved_amount`: `getMonthlyOverview.depositsTotal`, Spendings banner **“You paid $X in deposits this month”** (do not say returnable), All Spending tile, receipt summary row.
- Tax / No tax pill from `tax_amount > 0` on review + spend list.
- Aliases: key `budget.receiptAliases.v1` via **`storageHelpers`** (not raw MMKV). Map key = `raw_code` when present else normalized `raw_name` (+ optional store). LRU 500. Device-local v1. History boost via [budget-quick-add.ts](../../backend/src/services/budget-quick-add.ts).

## UI

Reuse [Chip](../../src/components/ui/Chip.tsx) / [BudgetQuickAddRow](../../src/screens/budget/BudgetQuickAddRow.tsx). Per card: name field + ≤3 name chips + more; selected category + ≤3 alt chips; fee chips (tap removes and subtracts); Tax / No tax pill; store field once per receipt.

## Debug

Extend `[BUDGET-E2E][scan.*]` with raw tool JSON, `raw_code`, suggestions, fees, alias hits, region source, asset quality (Worker already has `analyzeAssetQuality`; also log after client re-encode). `__DEV__` / `E2E=1` debug block `budget-receipt-debug`.

## Maestro

Review screen is the test UI. Subflow `budget-receipt-scan-one-photo.yaml` **`addMedia` immediately before gallery pick**. Parent `budget-receipt-scan-quality.yaml`: Superstore / Costco / BCL (+ HEIC fixture `budget-receipt-heic`). No Save.

Do **not** set `E2E_VERIFY_PATH=/budget/receipts/scan` on default Budget-A (local-first / BYOK). Assert UI testIDs + optional persist. Matrix rows in [budget.md](../engineering/testing/matrices/budget.md).

Run with `./scripts/e2e/run-budget-suite-live-report.sh` on the new flows. Open the timestamped dir under `documents/engineering/testing/reports/budget/`, not `latest`.

## Fixture pass conditions (tighten after first live run)

| Receipt | Must see |
|---|---|
| Superstore | Store name; milk has recycling + deposit attached (not separate rows); cryptic SKU has name chips; all lines **No tax** |
| Costco | Store name; milk has enviro + deposit attached; Roti Chicken is the only **Tax** line; three Kumatos stay Kumato (code `43483`); brie rebate attached via `610845` |
| BC Liquor | `BC Liquor Store`; Canadian Club; container deposit attached; PST Liquor 10% + GST 5% |

## Implementation order

1. **`main`:** `0159` + prompt + fee attach + BC `L` + `COLUMNS_PER_ROW` 17 + `maxTokens` 8192 → typecheck/tests → **migrate all brand D1s then** `deploy:fleet`.
2. **`budget-v2`:** merge `main` → chips / store / tax / deposits / aliases / **`receiptImport.ts` lockstep** / long-edge 1568.
3. Live-report the three flows on Budget-A `:8082` **only after** local schema lockstep; read `[BUDGET-E2E][scan.ai]`; tighten.
