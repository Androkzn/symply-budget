# Receipt Recognition v2 — Master Plan

> Execution handoff. Product decisions live in [budget-receipt-recognition-v2.md](../budget-receipt-recognition-v2.md). This file is the file-level build plan. Do not redefine app BRD/TRD.

| Field | Value |
|-------|-------|
| **Doc type** | Feature implementation plan (master) |
| **Feature id** | `budget-receipt-recognition-v2` |
| **Owning app** | app id `simple-budget` · brand id `symply-budget` (pack `brands/symply-budget/`) |
| **Status** | `ready` |
| **Version** | `v1.2` |
| **Created** | `2026-08-15` |
| **Last updated** | `2026-08-15` |
| **Decisions** | [budget-receipt-recognition-v2.md](../budget-receipt-recognition-v2.md) |
| **App docs** | [README](../../apps/symply-budget/README.md) · [BRD](../../apps/symply-budget/BRD.md) · [TRD](../../apps/symply-budget/TRD.md) |

---

## Agent Kickoff Prompt

```text
Read first:
1. AGENTS.md
2. documents/ecosystem/BRANCHING.md
3. documents/apps/symply-budget/README.md
4. documents/requirements/budget-receipt-recognition-v2.md
5. documents/requirements/budget-receipt-recognition-v2/MASTER_PLAN.md

Rules:
- This clone is budget-v2 (Simply Ecosystem-budget). The main checkout is
  ~/Desktop/Symply Ecosystem/Simply Ecosystem/ on branch main.
- NEVER edit backend/** or backend/migrations/** in this clone.
- Claim 0159 (NOT 0158 — that file is 0158_ai_usage_accuracy.sql) by creating
  the migration in the MAIN checkout, then deploy from there.
- Worker / schema / 0159 land on main. Never deploy:fleet from this clone.
- Review UI, local ledger fields, aliases, Maestro land on budget-v2.
- Do not add a taxable column. Tax pill = tax_amount > 0.
- Do not use food-category-detector.ts (Health nutrition taxonomy).
- Do not set E2E_VERIFY_PATH=/budget/receipts/scan (Budget-A is local-first).
- Alias key = raw_code when present, else normalized raw_name.
  Persist via storageHelpers.setObject/getObject — never raw MMKV.
- Fees attach to the parent item. kind crv = US CRV (in tax base).
  kind deposit = CA/US refundable container (CA: out of GST base).
  kind environmental = non-refundable levy (CA: IN GST base per CRA B-089).
- Banner: "You paid $X in deposits this month".
- Keep toReceiptDraft + receiptImport.ts + chatMessageReceiptDraft in lockstep.
- Phase 4 Maestro MUST NOT start until local receiptImport.ts matches Worker v2.
- Migrate all brand D1s BEFORE deploy:fleet that writes deposit_amount.
- COLUMNS_PER_ROW in budget-service addExpensesBulk is 16 today → 17 after the column.
- maxTokens: raise 4096 → 8192 (16384 if Costco-length); retry once on stop_reason max_tokens.
- Merge, never rebase. Never stash. Never force-push.
```

---

## 0. Version History

| Version | Date | Changes |
|---------|------|---------|
| v1.0 | 2026-08-15 | Merged plan + verified research delta. Two rejects: taxable column, Health food-category-detector. |
| v1.1 | 2026-08-15 | Review-plan Cycle 1: 0158→0159; migrate-before-deploy; COLUMNS_PER_ROW 17; main-checkout path; Phase 4 BYOK gate; storageHelpers; category_suggestions two-layer; omitted export/testkit/zod; maxTokens 8192; CA enviro GST; rollback/runbook; dual app/brand id. |
| v1.2 | 2026-08-15 | Cycle 2: decisions #9 aligned to long-edge **1568** (not “on evidence”); G9 documents bulk-save double-tap as accepted existing behavior (`isSaving` only). |

---

## 1. Readiness Gate

| Gate | Status | Notes |
|------|--------|-------|
| Decisions accepted for build | [x] | Feature note + this master plan |
| Open HIGH blockers resolved | [x] | Branching split, aliases, toReceiptDraft, E2E verify, 0159, migrate order |
| Data/privacy reviewed | [x] | Device-local aliases via storageHelpers; no GPS |
| Feature flag / rollout | [x] | JSON extras are additive. **Behavior is not:** fee-attach + no semantic merge ship to House on Worker deploy. Accept that skew (House review lists change without new chips) or flag the prompt. Default: accept House behavior change on deploy day. |
| Claim 0159 on main | [x] | Created on main checkout; migrated all brand D1s; `deploy:fleet` shipped. Still uncommitted on main until asked. |

---

## 2. Non-Goals

- New pipeline or OCR vendor. Same Anthropic tool + review-before-save path.
- Synced household alias table (local-first surrogate-key / rollout-loss window).
- `taxable` column or “flagged but $0 tax” label.
- Health `food-category-detector` as a Budget category first pass.
- Dedicated Deposits tab or Savings-product surface.
- Saying deposits are “returnable” / “you’ll get $X back”.
- Storing receipt images (`receipt_key` stays unused).
- PostHog events (optional later; `ai_usage_events` already records `grocery_receipt`).
- GPS / location permission.
- Semantic merge (`Tomatoes` / `Alcohol`).
- Raw `createMMKV` in feature code — use `storageHelpers`.

---

## 3. What already exists

```text
photo → toVisionSafeAttachment
     → ReceiptScanService (Worker)  OR  runReceiptImportLadder (local-first BYOK)
     → BudgetReceiptScanScreen
     → addExpensesBulk
```

Budget-A (`symply-budget`) defaults **local-first** (`isBudgetLocalFirst`). Phase 1 Worker changes do **not** change Budget-A scans until `receiptImport.ts` + ladder match.

| Already shipped | Gap this plan fills |
|-----------------|---------------------|
| `vendor` on expenses | AI often null; hidden on manual form; no `"Other"` fallback |
| One AI `category` per line | No alt chips |
| One simplified `name` + `mergeSimilarItems` | No chips; cryptic SKUs collapsed too hard |
| Fees as **separate** line items | Must attach to parent |
| `tax_amount` + CA/US profile fallback | No BC `L` (liquor PST 10%); no Tax pill on the list |
| `saved_amount` → `savedTotal` banner | `lmt` / regular-vs-paid savings dropped; no deposits roll-up |
| `[BUDGET-E2E][scan.*]` | Missing suggestions / fees / `raw_code` / alias hits |
| Maestro receipt flows | iOS seed-order can pick the wrong photo; no quality suite |
| `maxTokens: 4096` | Too small for v2 output (7 names × N lines) |
| `COLUMNS_PER_ROW = 16` | Must become 17 when `deposit_amount` is inserted |
| `toVisionSafeAttachment` JPEG 0.8, no resize | Long-edge 1568 (savings-import precedent) before encode |
| BYOK content: text then images | Reorder to images-first (Worker already does this) |

---

## 4. Target contracts

### 4.1 Scan item (extend existing types — do not invent `ReceiptScanItemV2`)

Extend `ReceiptScanItem` / `GroceryReceiptItem` with optional v2 fields. Keep the `GroceryReceipt*` aliases.

AI returns **names** for categories (verbatim household list). Server maps to ids.

```ts
// After server normalize (what the client stores on the draft):
interface ReceiptScanItem {
  raw_name: string;
  raw_code: string | null;
  name: string;
  name_suggestions: string[];       // ≤7; MUST include Title Case original
  amount: number;                   // tax-inclusive cents, fees included
  tax_amount: number;               // 0 = No tax pill
  saved_amount: number;
  deposit_amount: number;           // sum of kind deposit + crv
  fees: Array<{
    kind: 'deposit' | 'environmental' | 'bag' | 'crv' | 'other';
    label: string;
    amount: number;
  }>;
  category_id: string | null;
  category_name: string | null;
  category_suggestions: Array<{ id: string; name: string }>; // mapped
}
```

AI schema uses `category` + `category_suggestions: string[]` (verbatim names). Server `resolveItemCategory` maps each name → `{id,name}` (same as today). Decisions note “verbatim names” = AI layer; this `{id,name}[]` = client layer. Not a contradiction.

Receipt-level: `vendor` (`"Other"` if unreadable), `purchase_date`, `tax_summary`, `subtotal`, `total`, optional `receipt_country` / `receipt_region`.

### 4.2 Merge / attach / tax-base rules

- Collapse only lines that share `raw_code` (or identical `raw_name` when code is missing).
- Attach `TPD/610845` rebates and fee lines to the parent code. Never emit them as expenses.
- Ignore fee *subtotals* and payment/tax/total rows.
- Tax base:
  - `deposit` (CA/US refundable container): **out** of GST/HST / not in CA tax base ([CRA B-089](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/b-089/returnable-containers.html))
  - `environmental` (non-refundable levy): **in** CA GST/HST base (same CRA bulletin)
  - `crv` (US): **in** sales-tax base ([CDTFA](https://cdtfa.ca.gov/formspubs/pub452.pdf))
- Persist only `deposit_amount` (sum of `deposit` + `crv`). `fees[]` is review-time only — not a D1 column.

### 4.3 Region for the model

1. Settings `taxCountry` / `taxRegion`
2. Address printed on the receipt
3. `households.country` / `state_province`
4. First-run Region picker default from `expo-localization` `getLocales()[0].regionCode` (no GPS)

### 4.4 Aliases (device-local v1)

Key: `budget.receiptAliases.v1` via **`storageHelpers.getObject` / `setObject`** (`src/services/storage/index.ts`). Not raw MMKV. Not SecureStore. Not `appStore` / settings-sync.

- Map key = `raw_code` if present, else `normalize(raw_name)` + optional store
- Value = `{ name, categoryId, hits, updatedAt }`
- LRU cap **500** entries
- Upsert on save. Inject matches as few-shot. Aliases win the default; chips still show AI alts.
- Each member trains their own scanner. Household sync is out of scope (G1).

### 4.5 Persist

| Field | Rule |
|-------|------|
| `vendor` | Every bulk **and** single create/update; editable on review + manual form |
| `deposit_amount` | New. Defaults 0. Mirrors `saved_amount` roll-up |
| Tax pill | `tax_amount > 0` → Tax, else No tax. No column |
| Banner | “You paid $X in deposits this month” next to `budget-savings-banner` |
| `fees[]` | Not persisted |

`addExpensesBulk` is **not** all-or-nothing today (chunked inserts). Double-tap Save can duplicate. Keep existing UX; do not silently claim atomicity. Phase 2: disable Save while in-flight (already `isSaving`).

---

## 5. File Plan

Phase A files = Phase 1. Phase B files = Phases 2–3. Phase 4 = Maestro files in Phase B plus live-report.

### Phase A — `main` checkout only (Worker + D1)

| File | Change |
|------|--------|
| `backend/migrations/0159_expenses_deposit_amount.sql` | `ALTER TABLE expenses ADD deposit_amount INTEGER NOT NULL DEFAULT 0` |
| `backend/src/db/schema-budget.ts` | `deposit_amount` on `expenses` |
| `backend/src/ai/prompts/scan-grocery-receipt.ts` | Schema + prompt v2 |
| `backend/src/ai/prompts/__tests__/scan-grocery-receipt.test.ts` | Replace old contracts |
| `backend/src/services/budget-analysis/receipt/types.ts` | Extend `ReceiptScanItem` |
| `backend/src/services/budget-analysis/receipt/receipt-scan-service.ts` | Normalize; merge by code; aliases; drop name-merge; `maxTokens` 8192; retry on `max_tokens` |
| `backend/src/services/budget-analysis/receipt/fee-attribution.ts` | **New.** Attach by code; tax-base by kind |
| `backend/src/services/budget-analysis/receipt/__tests__/fee-attribution.test.ts` | **New.** Superstore/Costco/BCL-shaped |
| `backend/src/services/budget-analysis/receipt/tax-attribution.ts` | BC `L` 10% |
| `backend/src/services/budget-analysis/receipt/__tests__/tax-attribution.test.ts` | BC `L` |
| `backend/src/services/budget-analysis/receipt/draft.ts` | Forward v2 fields |
| `backend/src/services/__tests__/grocery-receipt-service.test.ts` | Code-merge, fees, Other, L, draft forward |
| `backend/src/services/budget-service.ts` | Bulk + single create/update; `COLUMNS_PER_ROW` **17**; `depositsTotal` |
| `backend/src/routes/budget.ts` | Optional `aliases` on scan; `deposit_amount` on create/update/bulk Zod |
| `backend/src/routes/__tests__/budget-receipt-scan.test.ts` | Persist `deposit_amount` parity with `saved_amount` |
| `backend/src/utils/budget-debug.ts` | Log v2 fields (helper already exists) |

### Phase B — `budget-v2` clone after `git merge main`

| File | Change |
|------|--------|
| `src/api/budget.ts` | `Expense.deposit_amount`; `MonthlyOverview.depositsTotal`; extend `GroceryReceiptItem` |
| `src/features/budget/local/localBudgetApi.ts` | `buildExpenseRow` + `depositsInMonth` / `depositsTotal` |
| `src/features/budget/local/export/budgetLedgerExport.ts` | `deposit_amount_cents` column |
| `src/features/budget/local/__tests__/ledgerTestKit.ts` | `expenseRow` default `deposit_amount: 0` |
| `src/test-utils/budgetConsistency.ts` | `depositsTotal` if overview grows |
| `src/features/budget/local/ai/prompts/receiptImport.ts` | **Hard gate for Phase 4.** Mirror Worker schema |
| `src/features/budget/local/ai/buildReceiptDraft.ts` | Forward v2 fields |
| `src/features/budget/local/ai/localImportLadder.ts` | Aliases + region; `maxTokens` 8192 |
| `src/features/budget/local/ai/localByokClient.ts` | Images-first; resize already done client-side; retry `max_tokens` |
| `src/features/chat/receiptDraftStore.ts` | `chatMessageReceiptDraft` must not strip v2 fields |
| `src/screens/budget/BudgetReceiptScanScreen.tsx` | Store, chips, tax pill, debug, persist `deposit_amount` |
| `src/screens/budget/BudgetItemFormScreen.tsx` | Optional Store |
| `src/screens/budget/BudgetSpendingsView.tsx` | Deposits banner + tax pill |
| `src/screens/budget/BudgetAllSpendingScreen.tsx` | Deposits tile |
| `src/screens/budget/budgetAllSpendingUtils.ts` | `deposits` on `summarizeSpending` |
| `src/features/budget/local/receiptAliases.ts` | **New.** `storageHelpers` only; LRU 500 |
| `src/features/budget/local/__tests__/receiptAliases.test.ts` | **New.** |
| `src/screens/settings/RegionScreen.tsx` + `appStore` | First-run `regionCode` |
| `src/screens/settings/__tests__/RegionScreen.test.tsx` | First-run default |
| `src/utils/visionSafeAttachment.ts` | Long-edge **1568** then JPEG 0.8; log size |
| `src/screens/budget/__tests__/BudgetReceiptScanScreen.test.tsx` | Chips, fees, store, tax |
| `src/screens/budget/__tests__/BudgetSpendingsView.test.tsx` | Deposits banner |
| `e2e/fixtures/manifest.json` | `budget-receipt-heic` |
| `e2e/maestro/subflows/budget-receipt-scan-one-photo.yaml` | **New.** `addMedia` immediately before pick |
| `e2e/maestro/budget/budget-receipt-scan-quality.yaml` | **New.** |
| `e2e/maestro/budget/config.yaml` | Register quality flow |
| `documents/engineering/testing/matrices/budget.md` | New rows |

---

## 6. Phases

Map: Phase 1 = §5 Phase A. Phases 2–4 = §5 Phase B. §12 agents: A→Phase 1, B→Phase 2, C→Phase 3, D→Phase 4.

### Phase 1 — `main` checkout: contract + Worker

**Where:** `~/Desktop/Symply Ecosystem/Simply Ecosystem/` on `main`. Not this clone.

Scope:

- Create `0159_expenses_deposit_amount.sql` on main (ls `backend/migrations/015*.sql` first; 0158 is taken).
- Prompt/schema/types, fee-attach, BC `L`, stop semantic merge, debug, `maxTokens` 8192 + retry.
- `deposit_amount` on D1 + Zod + `COLUMNS_PER_ROW = 17` + `depositsTotal`.
- `toReceiptDraft` lockstep.

Acceptance:

- [x] Superstore-shaped unit: milk keeps recycling + deposit; no fee rows; enviro in GST base if tagged environmental.
- [x] Costco-shaped: three `43483` collapse; `TPD/610845` on brie; only flagged prepared-food line gets tax.
- [x] BCL-shaped: `L` + `G` → PST Liquor 10% + GST 5%; container deposit attached.
- [x] Vendor `"Other"` when unreadable.
- [x] Old “fees are items” / “merge Tomatoes” tests rewritten.
- [x] `COLUMNS_PER_ROW === 17`.
- [x] Draft forwards `raw_code`, suggestions, fees, `deposit_amount`.

**Order (do not invert):**

```bash
# ON THE MAIN CHECKOUT
eval "$(./scripts/secrets/export-env.sh)"
cd backend
npm run typecheck && npm run lint && npm test
# 1) migrate ALL brand D1s first
npm run db:migrate:remote:staging
npm run db:migrate:remote:production
# plus per-brand D1 apply if deploy-fleet's migrate step is not automatic — verify scripts/deploy-fleet.sh
# 2) then ship Worker
npm run deploy:fleet
```

**Rollback:** Redeploy previous Worker version. Leave `0159` in place (immutable). Stop writing `deposit_amount` (default 0). Do not DROP the column.

### Phase 2 — `budget-v2`: review UI + persist

**Precondition:** `git merge main` on this clone after Phase 1 is on origin/main.

Scope: chips, store, tax pill, persist `vendor` + `deposit_amount`, deposits banner + All Spending tile, manual Store, **and** `receiptImport.ts` / ladder / `chatMessageReceiptDraft` lockstep (required even if chips land first — empty chips otherwise).

Acceptance:

- [x] Review card: store, name chips (Title Case original present), category chips, fee chips, Tax/No tax.
- [x] Removing a fee chip subtracts from `amount` and `deposit_amount`.
- [x] Save writes `deposit_amount` and `vendor` on every included line.
- [x] Local BYOK draft shape matches Worker (`name_suggestions`, `fees`, `raw_code`).

Verification:

```bash
npm test -- BudgetReceiptScanScreen budgetAllSpendingUtils BudgetSpendingsView
```

**Rollback:** Revert the budget-v2 FE commit / EAS update. Ledger rows with `deposit_amount: 0` stay valid.

**Query cache:** Spendings reloads on focus via `getMonthlyOverview` — no extra React Query invalidate required. Do not invent a new RQ key.

### Phase 3 — `budget-v2`: aliases + region + asset quality

Scope:

- `receiptAliases.ts` via `storageHelpers`; LRU 500.
- Send aliases on scan; apply as default.
- `expo-localization` first-run Region default.
- Long-edge **1568** then JPEG 0.8; log bytes; BYOK images-first.

Acceptance:

- [x] Second scan of the same UPC defaults to last name/category.
- [x] Fresh install with unset region gets a locale-derived picker default.
- [x] 2.7 MB HEIC re-encodes under 5 MB after resize.

**Rollback:** Delete key `budget.receiptAliases.v1` via storageHelpers; revert resize (HEIC still converts).

### Phase 4 — Maestro quality suite + iterate

**Hard gate:** Phase 2 lockstep (`receiptImport.ts` emits v2) is merged and a local unit test proves the BYOK schema includes `raw_code` / `fees` / `name_suggestions`. Otherwise Budget-A tests the **old** prompt.

Scope:

- Fixture `budget-receipt-heic`.
- Subflow + parent quality flow. **No** `E2E_VERIFY_PATH=/budget/receipts/scan`.
- Matrix rows. Live-report on Budget-A `:8082`.
- Tighten from `[BUDGET-E2E][scan.ai]`.

Acceptance (structure first; lock strings after observe):

| Receipt | Must see |
|---------|----------|
| Superstore (`budget-receipt-3`) | Store; milk fees attached; name chips; all **No tax** |
| Costco (`budget-receipt`) | Store; milk fees attached; Roti Chicken only **Tax**; Kumatos stay Kumato; brie rebate via `610845` |
| BC Liquor (`budget-receipt-2` + HEIC) | `BC Liquor Store`; Canadian Club; deposit attached; PST 10% + GST 5% |

DoD for this phase: all three rows pass structural asserts twice in a row on Budget-A. G3 closes when those asserts are no longer `optional: true`.

Verification:

```bash
eval "$(./scripts/secrets/export-env.sh)"
./scripts/e2e/run-budget-suite-live-report.sh e2e/maestro/budget/budget-receipt-scan-quality.yaml
# Open documents/engineering/testing/reports/budget/<timestamp>/ — not latest
```

**Rollback:** Unregister the flow from `config.yaml`; existing receipt flows stay.

---

## 7. Data And Migration Plan

| Item | Plan |
|------|------|
| Schema change | `0159_expenses_deposit_amount.sql` — create on **main** only |
| Columns | `deposit_amount INTEGER NOT NULL DEFAULT 0` only. **No `taxable`** |
| Bulk bind count | `COLUMNS_PER_ROW` 16 → **17** (`budget-service.ts` ~2567) |
| Backfill | None (default 0) |
| Local-first | Field rides on LWW JSON; older peers ignore unknown keys |
| Remote migration | `npm run db:migrate:remote:staging` and `:production` (and per-brand D1) **before** `deploy:fleet` |
| Rollback | Stop writing the field; default 0. Do not drop the column |

---

## 8. QA Plan

| Layer | Command / check |
|-------|-----------------|
| BE typecheck | `cd backend && npm run typecheck` (main checkout; `npm install` in `backend/` if node_modules missing) |
| BE tests | `cd backend && npm test` — prompt, scan, tax, **fee-attribution**, draft, COLUMNS_PER_ROW |
| FE unit | `npm test -- BudgetReceiptScanScreen BudgetItemFormScreen budgetAllSpendingUtils BudgetSpendingsView receiptAliases RegionScreen` |
| E2E | Live-report quality flow **after** local schema lockstep |
| AI-off | `AIAccessGate` still blocks scan |
| Local-first | BYOK ladder returns v2 shape; chat confirm keeps chips |

---

## 9. Deployment Plan

| Change type | Required action |
|-------------|-----------------|
| D1 | **First.** `db:migrate:remote:staging` + `:production` (+ per-brand) from **main checkout** |
| Worker (shared) | **Second.** `eval "$(./scripts/secrets/export-env.sh)"` then `cd backend && npm run deploy:fleet` from **main checkout** |
| Frontend JS | budget-v2 merge + EAS update `symply-budget-*` when shipping review UI |
| Native | Not required (ImageManipulator already in the client) |
| This clone | Never `deploy:fleet`. Never add `0159` here |

House (Worker path) will see fee-attach + no semantic merge on deploy day without new chips. Accepted.

---

## 10. Open Gaps

| # | Gap | Severity | Owner | Status |
|---|-----|----------|-------|--------|
| G1 | Household-shared aliases | low | later | open — device-local v1 |
| G2 | Deposit redemption / refund_rate (NS/NL/YT) | low | later | open — banner forbids “returnable” |
| G3 | Live AI variance on Maestro | medium | Phase 4 | open — structure first; close when asserts are required |
| G4 | Manual expenses always No tax | low | later | accepted |
| G5 | `maxTokens` / Costco truncation | medium | Phase 1 | mitigate with 8192 + retry; still watch `[scan.ai] stopReason` |
| G6 | House UI skew on Worker deploy | medium | Phase 1 | accepted — no chips on House |
| G7 | OpenAI/Gemini BYOK schema parity | low | Phase 2 | same JSON schema; resize/order are Anthropic-first |
| G8 | Superstore “recycling fee” kind (deposit vs environmental) | medium | Phase 1 prompt | decide from printed words; GST follows kind |
| G9 | Bulk save not idempotent | low | accepted | Same as today’s `saved_amount` path. `isSaving` blocks double-tap. No new idempotency key this slice. |

---

## 10b. Operational runbook (scan)

| Failure | Detect | Remediate |
|---------|--------|-----------|
| Truncated tool JSON | `[BUDGET-E2E][scan.ai] stopReason=max_tokens` | Retry already in code; raise to 16384; user retakes closer |
| AI not configured | `hasUsableProviderKey` false / AIAccessGate | Connect BYOK or managed key; entitlement off = paywall (existing kill) |
| D1 `no such column: deposit_amount` | Worker 500 on bulk save | Migration missed — run `db:migrate:remote:*` on that env/brand **before** next traffic |
| Wrong gallery photo in E2E | 0 items / “Nothing found” | `addMedia` immediately before pick (Phase 4 subflow) |

Kill switch (existing): turn off AI entitlement / remove provider key. Scan screen stays behind `AIAccessGate`. No new CONFIG_KV flag this slice.

---

## 11. Completion Checklist

- [ ] `0159` created on **main**, migrated staging + production (all brand D1s), **then** `deploy:fleet`.
- [ ] `COLUMNS_PER_ROW === 17`.
- [ ] Worker prompt/schema/service + draft lockstep on main.
- [ ] `budget-v2` merged main; chips / store / tax / deposits / aliases / **local prompt lockstep** / Maestro.
- [ ] Phase 4 ran only after BYOK schema unit test passed.
- [ ] Quality suite: three structural rows pass twice; report under `documents/engineering/testing/reports/budget/<timestamp>/`.
- [ ] Feature index still points here. App BRD/TRD untouched.
- [ ] No secrets printed or committed. No backend edits on this clone.

---

## 12. Parallel agent split (when implementing)

Default model: Composer 2.5.

| Agent | Where | Owns |
|-------|--------|------|
| A — Worker contract | **main checkout** | Prompt, types, fee-attach, tax `L`, **0159**, COLUMNS_PER_ROW, scan service, draft, BE tests, migrate-then-deploy |
| B — Review UI | this `budget-v2` clone after merge | Scan chips, store, tax pill, persist, Spendings/All Spending, **receiptImport lockstep** |
| C — Aliases + region + assets | this clone | `storageHelpers` aliases, expo-localization, vision 1568, client debug |
| D — Maestro | this clone | Subflow, quality flow, HEIC fixture, matrix, live-report — **after** B lockstep |

Do not let B/C/D edit `backend/**` or `backend/migrations/**`.
