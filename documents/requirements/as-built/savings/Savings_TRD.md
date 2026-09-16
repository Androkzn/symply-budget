# Savings & Registered Accounts — TRD (v1.6)

**Version:** 1.6
**Date:** 2026-07-03
**Status:** Draft
**Paired Implementation Plan:** documents/features/Savings_Implementation_Plan.md (v1.7)
**Area:** FE + BE
**Priority:** P1
**Feature owner:** a-tekhtelev

---

## §0 Codebase Snapshot Note

Written against the current `main` working tree. Re-grep before implementing each phase. External-contract claims (CRA limits, model IDs) marked ⚠️ Unverified unless linked to a source. Key anchors validated at authoring time:

- Budget stack host: `app/(tabs)/budget.tsx` → `src/navigation/BudgetNavigator.tsx` (`main = "expo-router/entry"`, `package.json:4` — deep links live under `app/`). Note: `src/App.tsx` has been **removed** from the repo (entry is `app/_layout.tsx`); do not reference or edit it.
- Budget service auth pattern: `BudgetService.checkHouseholdAccess` (`backend/src/services/budget-service.ts:224`, throws `ForbiddenError`; re-grep — line drifts as the file changes).
- Route mount pattern: `app.route('/households/:householdId/budget', budgetRoutes)` (`backend/src/index.ts:352`).
- Budget tables are defined in `backend/src/db/schema-budget.ts`, consumed directly by the service, and created via **hand-written SQL** migrations (`backend/migrations/0004_budget_tables.sql`). `drizzle.config.ts` `schema = './src/db/schema.ts'` does NOT re-export budget tables — the project does not use `db:generate` for this domain. Savings mirrors this precedent.
- Next free migration number: `0067_*` (latest is `0066_task_purchase_suggestion.sql`; `0066` is taken — re-grep before implementing).

---

## §1 Overview / Problem

SimpleHouse Budget today tracks **home-maintenance spending** only: planned items, expenses, a monthly spending cap (`budget_goals.planned_budget`), and an affordability planner. It cannot answer the user's actual question: *"Are we saving or going backwards each month, and how do our spending choices affect our safety pillow and registered accounts?"*

This feature adds a **Savings** layer (household cashflow) and a **Registered** layer (TFSA / RRSP / FHSA) on top of Budget, replacing the user's external "Master Household Budget" spreadsheet.

**Goals**

1. Enter household **income by member and source** (payroll, rental, employer RRSP matching, tax refund, insurance, other) — one-off and **recurring**.
2. See **net monthly savings** and **YTD net**, plus a 6–12 month trend.
3. Track **savings goals** — Safety Pillow (emergency fund) + custom — with monthly pace.
4. Track **registered accounts** (TFSA / RRSP / FHSA) balances + estimated contribution room, with the user **entering this year's limit/room** and logging **regular** (e.g. RRSP employer matching) and **manual** contributions.
5. Show **spending → savings impact**: how overspending in Budget reduces savings headroom.
6. Manage **Monthly Payments** — a recurring regular-spending list (utilities, subscriptions, insurance, mortgages) applied to each month (the primary monthly-spending data replacing the sheet's "Monthly Payments" tab).
7. **AI data import** — upload files / images / pasted text / Google-Drive exports; an AI extracts income, spending, and monthly payments into a **draft the user confirms** before saving.

**Non-Goals (v1)**

- Bank/brokerage aggregation (data is entered manually or via AI document import — no live bank feeds).
- Tax filing or authoritative CRA room (estimates only, with a "verify on CRA My Account" disclaimer).
- Multi-currency (CAD only).
- Credit-card / debt payoff modelling (deferred; see §8).

---

## §2 Architecture Decisions (ADRs)

| # | Decision | Chosen | Alternative | Reason |
|---|----------|--------|-------------|--------|
| A1 | Budget↔Savings spending link | **Model A (unified)** — Budget `expenses` is the ONE spend source. Savings shows a read-only "Spendings" line = `SUM(expenses.amount)` for the month and **deducts it from net savings**; no mirrored rows. `savings_spending_entries` are NOT part of net. | Mirror each expense into a savings row (Model B); or keep a parallel savings-spend bucket | No double-counting; one spend number on every tab (Dashboard "Spent" == Spendings tab == Savings "Spendings"); Budget stays source of truth |
| A2 | Affordability planner | **Untouched.** Add a separate `savingsHeadroom` metric | Repurpose `planAffordability` remaining-budget to net savings | Changing shipped semantics breaks existing "can I afford this repair" UX |
| A3 | Where Savings lives | 4th tab inside `BudgetScreen` `FilterTabs`; Savings has internal sub-tabs (Overview/Income/Spending/Goals). Registered is a **pushed screen**, not a 5th top tab | 5 equal top tabs | 5 top tabs crowd iPhone; Registered is monthly, not daily |
| A4 | Schema management | Hand-written SQL migration `0067_savings_tables.sql`; Drizzle tables in `backend/src/db/schema-savings.ts`, imported directly by service | `db:generate` via drizzle-kit | Mirrors existing budget-domain precedent (A0 snapshot note) |
| A5 | Member reference | `member_id` → `household_members.id` (nullable for household-level sources like rent) | `users.id` | Income tags survive display-name differences; household-level sources have no member |
| A6 | Money units | All amounts in **cents** (integer); `currency` column defaults `'CAD'` | dollars/float | Matches `budget-affordability.ts` cents convention; float rounding unsafe for money |
| A7 | Monthly overview | Compute-on-read (no snapshot table) | `savings_monthly_snapshots` cache | Mirrors `getMonthlyOverview`; avoids staleness when Budget expenses change |
| A8 | RRSP room setup | **NOA-first**: primary input is "RRSP deduction limit from your Notice of Assessment"; optional advanced fields (prior earned income, pension adjustment) | Auto-derive from income only | Employer RRSP matching implies a pension adjustment; income-only estimate is wrong for employed households |
| A9 | Recurring income | Templates + explicit "Apply recurring income for {month}?" confirmation | Silent auto-create each month | YNAB-style intentionality; avoids phantom income |
| A10 | Income visibility | Household-shared in v1 (like Monarch couples mode); documented in UI | Per-member private income | Simpler; private income deferred |
| A11 | AI data import | **Upload → AI-extract → persisted draft → user confirms → commit.** Never silent-save. Synchronous Claude call in the Worker (no queue/Lambda) for images/CSV/text/small PDFs; a **buffered response is safe** (Workers have no HTTP wall-clock limit; awaited `fetch` costs ~0 CPU — corrected A18); FE polling (W4) covers reads longer than the 2-min client timeout | Silent auto-import; async job pipeline for everything | Mirrors the shipped budget `ai-detect-upload` flow; intentionality (A9). ⚠️ Neither CPU (awaited `fetch` = ~0 CPU) **nor any HTTP wall-clock limit** (Workers have none) is the constraint — see **corrected A18** for the buffered + FE-polling design |
| A12 | Monthly Payments (recurring spend) | New `savings_recurring_payments` table + explicit **idempotent** "apply to month" (partial unique index on `(recurring_payment_id, period)`) | Reuse `budget_items.is_recurring` metadata | No recurring-spend materializer exists in budget; applied rows become ordinary spend so they feed overview + essential baseline free |
| A13 | Reuse budget AI pipeline & pickers | Clone `BudgetSuggestionService` + `extract-budget-document`/`suggest-budget-items` prompts; reuse `CloudFilePicker` (Google Drive), `image-picker-compat`, `expo-document-picker` | Build a new ingestion stack / native Drive SDK | End-to-end pattern already ships & is tested; zero new native deps; Drive files download locally then upload like any file |
| A14 | Import storage & PII | Store uploads in R2 `REPORTS_BUCKET` under a household-scoped `savings-imports/` prefix + SHA-256 dedup (mirror `aihousekeeper_attachments`); never log `raw_text`/`draft_json`; delete R2 object on discard/commit unless retained | Keep raw files indefinitely | Financial docs are PII; minimize retention & log exposure |
| A15 | Registered contributions | Two kinds — `regular` (recurring, e.g. employer matching) + `manual`; user enters this-year room (`starting_room_cents`) and optional `annual_limit_override_cents`; idempotent "apply regular contribution for {month}" | Single contribution type; CRA-only limits | Matches how households actually contribute; user room is authoritative over a possibly-stale constant |
| A16 | Import ingest limits & model routing | Reject PDFs >100 pages up front; cap inline-base64 upload at **20 MB** (base64 → Anthropic's 32 MB request cap; Files API for larger = v1.1); downsample images >1568 px server-side; parse CSV **deterministically** (LLM only for semantic classification); **vision/PDF read on Sonnet** (accuracy), structuring on Haiku (cost); `maxTokens 16384`; on a truncation **throw** surface "split it" and never persist partial JSON (see IP Task 5.2 — `generateStructured` discards `stopReason`, so truncation is caught as a throw, not a flag). ⚠️ `claude-sonnet-4-5-20250929` is now a **legacy** model ID (still works; Sonnet 5 is current + lifts the PDF read cap 100→600) — the read model is a shared env var, bump app-wide if desired | Inline base64 up to 32 MB; Haiku for everything | Matches Anthropic's documented Messages-API limits (100-page / 32 MB request / 8000 px); puts accuracy on the highest-value axis (a mis-read income row → wrong tax math) |
| A17 | Thin client — BE-authoritative business logic | All money math (net/YTD/headroom), room/pace, category/member resolution, import extraction+mapping, and validation live in BE services; the FE renders BE-computed view models + holds UI-only Zustand state; it refetches after a mutation, never recomputing locally | Duplicate math on the FE | User directive; single Vitest-tested source of truth; light RN bundle; no FE/BE money drift |
| A18 | Import request lifetime vs Workers runtime limits (**corrected Cycle 6**) | **Ship buffered** (`return c.json(...)`) for small inputs (image / CSV / text / PDF ≤10 pages); rely on **FE polling (W4)** for reads that outrun the client's 2-min `api.upload` timeout; defer larger PDFs to the v1.1 Files-API **async** path. Streaming the response is an **optional** resilience upgrade, not required for survival | Assume a ~30s HTTP wall-time and force-stream everything (a false premise) | **Correction:** HTTP-triggered Workers have **NO wall-clock limit** (the invocation lives as long as the client stays connected); the real ceiling is **CPU time** (default 30s, raise to 5 min on Paid via `limits.cpu_ms`), and **awaited I/O — the `fetch` to Anthropic — costs ~0 CPU**. So a buffered multi-minute read is safe Worker-side. The genuine risks are: the FE 2-min `api.upload` timeout (→ W4 polling), Anthropic's 10-min non-streaming SDK limit (non-issue at maxTokens 16384), and client/edge idle-connection drops. Sources: developers.cloudflare.com/workers/platform/limits (CPU vs wall-clock; awaited I/O not counted), 2025 higher-CPU-limits changelog |

---

## §3 Data Model

New file `backend/src/db/schema-savings.ts`. Migration `0067_savings_tables.sql` (hand-written). All money in **cents**.

### `savings_income_entries`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | uuid |
| household_id | TEXT NOT NULL FK households ON DELETE CASCADE | |
| member_id | TEXT NULL FK household_members ON DELETE SET NULL | null = household-level source |
| source_type | TEXT NOT NULL | `payroll`\|`rental`\|`rrsp_matching`\|`tax_refund`\|`insurance`\|`other` |
| label | TEXT NOT NULL | e.g. "Andrei Payroll" |
| amount_cents | INTEGER NOT NULL | |
| income_date | TEXT NOT NULL | `YYYY-MM-DD` — drives which month it counts in |
| currency | TEXT NOT NULL DEFAULT 'CAD' | |
| notes | TEXT NULL | |
| template_id | TEXT NULL | logical ref to `savings_income_templates`; set when generated by applying a recurring-income template (Phase 4) |
| period | TEXT NULL | `YYYY-MM` when generated from a template; NULL for ad-hoc income |
| created_by | TEXT NULL FK users | |
| created_at / updated_at | TEXT NOT NULL DEFAULT datetime('now') | |

Indexes: `(household_id)`, `(household_id, income_date)`; partial unique `(template_id, period) WHERE template_id IS NOT NULL` → idempotent apply-templates (mirrors the recurring-payments design; prevents double-inserting income on re-apply).

### `savings_income_templates` (Phase 4)
`id, household_id, member_id (null), source_type, label, amount_cents, currency, day_of_month (int null), active (bool), created_at`.

### `savings_categories`
Household spending categories for the cashflow view (broader than home budget).
`id, household_id, name, icon, color, is_essential (bool default 0), sort_order, created_at`.
Seed defaults: Mortgage (essential), Condo Fee (essential), Utilities (essential), Insurance (essential), Property Tax (essential), Home Improvement (not), Other (not).

### `savings_spending_entries`
`id, household_id, category_id (null FK savings_categories), label, amount_cents, currency default 'CAD', spending_date, notes, recurring_payment_id (null — logical ref to savings_recurring_payments), period (null — 'YYYY-MM' when generated from a recurring payment), created_by, created_at, updated_at`.
Indexes: `(household_id)`, `(household_id, spending_date)`; partial unique `(recurring_payment_id, period) WHERE recurring_payment_id IS NOT NULL` → idempotent Monthly-Payments apply.
**Model A (unified):** Budget expenses are NOT copied here; the month's `SUM(expenses.amount)` is read at overview time as the "Spendings" line and deducted from net. `savings_spending_entries` remain for legacy/import data but are excluded from net savings.

### `savings_goals`
`id, household_id, type (`emergency_fund`\|`custom`), name, target_amount_cents, current_amount_cents default 0, target_date (null), months_of_expenses (int null, emergency fund only), monthly_allocation_cents (null), currency default 'CAD', status (`active`\|`achieved`\|`archived`) default 'active', created_at, updated_at`.

### `registered_accounts` (Phase 3)
`id, household_id, member_id (FK household_members), account_type (`tfsa`\|`rrsp`\|`fhsa`), institution (null), balance_cents default 0, starting_room_cents (null — user-entered THIS-YEAR available room), annual_limit_override_cents (null — user-entered this-year limit; overrides the CRA constant when set), regular_contribution_cents (null — monthly regular/matching amount), room_as_of_date (null), prior_earned_income_cents (null, rrsp), pension_adjustment_cents (null, rrsp), currency default 'CAD', created_at, updated_at`.

### `registered_transactions` (Phase 3)
`id, account_id (FK registered_accounts ON DELETE CASCADE), type (`contribution`\|`withdrawal`), kind (`regular`\|`manual`, default 'manual'), amount_cents, transaction_date, tax_year (int null, rrsp first-60-days), period (null — 'YYYY-MM' when auto-generated by applying a regular contribution), notes, created_by, created_at`.
Partial unique index `(account_id, period) WHERE period IS NOT NULL` → idempotent regular-contribution apply.

### `savings_recurring_payments` (Phase 5 — Monthly Payments)
`id, household_id, category_id (null FK savings_categories), label, amount_cents, currency default 'CAD', day_of_month (int null 1-31), group_label (null — e.g. 'Mortgages'/'Other'), is_essential (bool default 0), active (bool default 1), source (`manual`\|`ai_import` default 'manual'), created_by, created_at, updated_at`. Index `(household_id)`.
"Apply to month" inserts `savings_spending_entries` rows tagged `recurring_payment_id`+`period`; the partial unique index below makes re-apply a no-op.

### `savings_import_jobs` (Phase 5 — AI import)
`id, household_id, status (`pending_upload`\|`uploaded`\|`analyzing`\|`ready`\|`committed`\|`failed`), source_kind (`file`\|`image`\|`text`\|`drive`), file_key (null, R2 object key), file_name, mime_type, size_bytes, content_hash (SHA-256 dedup), raw_text (null), draft_json (null — extracted `SavingsImportDraft` for review), error (null), created_by, created_at, updated_at`. Index `(household_id)`. Uploads stored in R2 `REPORTS_BUCKET` under `savings-imports/{householdId}/…` (A14).

---

## §4 API Contract

All under `app.route('/households/:householdId/savings', savingsRoutes)` — new mount in `backend/src/index.ts`. Every route: `savings.use('/*', authMiddleware())` + `SavingsService.checkHouseholdAccess` (copied from `BudgetService:224`).

### Overview & cashflow
- `GET  /savings/overview?year=&month=` → `SavingsOverview` (income total by source, spending total incl. Home-from-Budget rollup, `netSavings`, `ytdNet`, `savingsHeadroom`, goals progress).
- `GET  /savings/trend?year=&month=&months=6` → `[{year,month,netSavings}]`.

### Income
- `GET/POST /savings/income?year=&month=` , `PATCH/DELETE /savings/income/:id`.
- Phase 4: `GET/POST /savings/income-templates`, `DELETE /savings/income-templates/:id`, `POST /savings/income/apply-templates` (body `{year,month}`).

### Spending & categories
- `GET/POST /savings/spending?year=&month=`, `PATCH/DELETE /savings/spending/:id`.
- `GET/POST /savings/categories`, `PATCH/DELETE /savings/categories/:id`.

### Goals
- `GET/POST /savings/goals`, `PATCH/DELETE /savings/goals/:id`.
- `GET /savings/goals/emergency-fund/suggestion?months=6` → computed target from essential spending.

### Registered (Phase 3)
- `GET/POST /savings/registered`, `PATCH/DELETE /savings/registered/:id` (create/update accept `starting_room_cents`, `annual_limit_override_cents`, `regular_contribution_cents`, `prior_earned_income_cents`, `pension_adjustment_cents`).
- `POST /savings/registered/:id/transactions` (body incl. `kind: regular|manual`), `DELETE /savings/registered/:id/transactions/:txId`.
- `POST /savings/registered/:id/apply-regular` (body `{year,month}`) → idempotent regular contribution for the month.
- `GET /savings/registered/:id/room?year=` → `{roomRemaining, annualLimit, used, usedByKind:{regular,manual}, warnings[]}`.

### Monthly Payments — recurring spending (Phase 5)
- `GET/POST /savings/recurring-payments`, `PATCH/DELETE /savings/recurring-payments/:id`.
- `POST /savings/recurring-payments/apply` (body `{year,month}`) → idempotent; inserts one `savings_spending_entries` row per active payment for the month.

### AI Data Import (Phase 5)
- `POST /savings/import` — multipart file (`SAVINGS_DOCUMENT_MIMES` = pdf/jpeg/png/webp/csv/plain; **20 MB inline cap** — base64 vs Anthropic's 32 MB request cap; PDFs >100 pages rejected; images downsampled server-side; CSV parsed deterministically; vision read on Sonnet — see A16) OR JSON `{text}`; runs extract+structure synchronously → `{jobId, draft: SavingsImportDraft}`.
- `GET /savings/import/:id` → `{job, draft}`; `POST /savings/import/:id/commit` (body `{selections}`) → created counts; `DELETE /savings/import/:id`.
- Gated by `authMiddleware` + `savings_enabled` + a second `savings_import_enabled` KV flag. Draft-then-confirm (A11) — never silent-commit.

Validation: `zValidator` + zod, mirroring `backend/src/routes/budget.ts`. Amounts `z.number().int().min(0)`. Enums explicit `z.enum([...])`.

---

## §5 Key Calculations

| Metric | Formula |
|--------|---------|
| Net monthly savings | `Σ income(month) − monthlyPayments − spendings(month)` (applied every month, no activity guard) |
| `monthlyPayments` | `SUM(amount_cents)` of ACTIVE `savings_recurring_payments` (flat baseline) |
| `spendings` | `SUM(expenses.amount)` where `expense_date` in month (the ONE Budget spend query) |
| YTD net | `Σ` monthly net Jan→selected month (same formula each month) |
| Savings headroom | `netSavings − Σ active goals' monthly_allocation_cents` |
| Emergency fund target | `essentialMonthlySpending × months` (user picks 3/6/9/12; default 6) |
| Goal pace | `(target − current) / max(1, monthsRemaining)`; recompute when behind; clamp `monthsRemaining ≥ 1` (no divide-by-zero) |
| TFSA room — **user-room path (primary, `starting_room` from CRA My Account)** | `starting_room + priorYearWithdrawals − Σ contributions(year)` — do **NOT** also add `annual_limit(year)`; the entered room already includes accumulated unused room + this year's limit (matches IP Task 3.1) |
| TFSA room — **from-scratch (no entered room)** | `annual_limit(year) + priorYearWithdrawals − Σ contributions(year)` — ⚠️ counts only this year's limit (understates multi-year unused room); UI prompts the user to enter their CRA My Account room |
| TFSA — both paths | ⚠️ **do NOT add current-year withdrawals**: CRA restores withdrawn room only on Jan 1 of the *following* year, so `priorYearWithdrawals` counts withdrawals dated in years strictly before `year`. Adding same-year withdrawals risks a taxable over-contribution. |
| RRSP room remaining — **NOA path (primary)** | `noa_deduction_limit − Σ contributions(since NOA date)` — the NOA "deduction limit" already nets the Pension Adjustment (PA) and prior unused room; do **NOT** subtract PA again or re-add the 18% term |
| RRSP room remaining — **from-scratch (no NOA)** | `min(0.18 × prior_earned_income, annualMax(year)) − pension_adjustment − Σ contributions` — used only when no NOA figure exists; **mutually exclusive** with the NOA path (never additive) |
| Registered `annualLimit` | `account.annual_limit_override_cents ?? SAVINGS_LIMITS[year][type]` — user-entered this-year limit wins over the CRA constant |
| Registered `used` | `Σ contributions(year)` across both `kind='regular'` (e.g. employer matching) and `kind='manual'`; `usedByKind` splits them |
| Monthly-Payments apply | for each active `savings_recurring_payments` row → one `savings_spending_entries` row per `(recurring_payment_id, period)` (idempotent) |

**CRA limits (✅ verified 2026-07 — re-verify each tax year; inflation-indexed):** 2025 TFSA `$7,000` / RRSP max `$32,490`; 2026 TFSA `$7,000` / RRSP max `$33,810`; FHSA annual `$8,000` / lifetime `$40,000`. Stored in a `SAVINGS_LIMITS` const keyed by year (cents); disclaimer "Estimate only — verify on CRA My Account" shown in UI. **FHSA v1:** balance + $40,000 lifetime-cap check only; per-year $8,000 + carryforward room deferred. Sources: canada.ca TFSA/RRSP/FHSA pages.

---

## §6 Frontend

- Extend `BudgetStackParamList` (`src/navigation/types.ts:70`): add `SavingsRegistered`, `SavingsGoalForm`, `SavingsEntryForm` pushed screens.
- Extend `budgetStore.activeView` (`src/stores/budgetStore.ts:28`) to include `'savings'`.
- `BudgetScreen` `FilterTabs` (`src/screens/budget/BudgetScreen.tsx:45`) gains a `savings` tab rendering `SavingsView`.
- New: `src/api/savings.ts` (mirrors `src/api/budget.ts`), screens under `src/screens/budget/savings/`, exported via `src/screens/budget/index.ts`.
- Dashboard: add a "Savings headroom" card to `BudgetDashboardView` (its reload effect must also watch `savingsStore.dataRevision` — the two stores are separate; see IP §IP5).
- Pushed screens add `SavingsRegistered`, `SavingsGoalForm`, `SavingsEntryForm`, **`SavingsRecurringPaymentsScreen`** (Monthly Payments), **`SavingsImportScreen`** (AI import — mirrors `BudgetItemAIScreen`; reuses `CloudFilePicker` for Google Drive, `image-picker-compat`, `expo-document-picker`).

---

## §7 Error Codes

| Code | When |
|------|------|
| `UNAUTHORIZED` (401) | missing/expired token (authMiddleware) |
| `VALIDATION_ERROR` | bad amount / date / enum / `kind` (zod) |
| `FORBIDDEN` | non-member (checkHouseholdAccess) |
| `NOT_FOUND` | entry/goal/account/import-job id not in household (incl. cross-household IDOR) |
| `ROOM_OVER_CONTRIBUTION` (warning, not thrown) | contribution pushes room negative → returned in `warnings[]` |
| `UNSUPPORTED_FILE_TYPE` | import upload mime not in `SAVINGS_DOCUMENT_MIMES` |
| `IMPORT_TOO_LARGE` | import upload > 20 MB (inline cap) OR PDF > 100 pages |
| `IMPORT_PARSE_FAILED` | AI extraction failed → job `status:'failed'`, surfaced without a 500 crash |

---

## §8 Phasing

> **Numbering note:** Phases below are 1–5 (feature phases). The paired IP adds a **Phase 0** (migration + schema scaffolding, no behavior change) ahead of these, so the IP enumerates **6 phases (0–5)**. TRD Phase 1 == IP Phase 1; the counts are reconciled, not contradictory.

- **Phase 1** — Savings cashflow MVP: income, spending, categories, overview (net + Home-from-Budget rollup), trend. Savings tab.
- **Phase 2** — Goals: emergency-fund wizard, custom goals, headroom card, pace, behind-pace notification (push `data.type = 'savings_pace'`; routed FE-side per IP Task 2.4 — **warm taps only**; cold-start replay is a Known Gap, §12).
- **Phase 3** — Registered: TFSA/RRSP/FHSA accounts, transactions, room estimate, NOA-first setup, over-contribution warnings.
- **Phase 4** — Intelligence: recurring income templates, AI insight hook, iPad polish.
- **Phase 5** — Monthly Payments (recurring spending model + idempotent apply) & AI data import (upload files/images/text/Google-Drive → AI extract → confirm → commit). Second kill switch `savings_import_enabled`.

Deferred: credit-card/debt snapshot; xlsx parsing (export CSV/PDF); async import for very large docs; per-year FHSA carryforward room; native Drive Picker SDK.

---

## §9 Deployment / Rollout

- BE: hand-write `0067_savings_tables.sql` (**9 tables** incl. `savings_recurring_payments` + `savings_import_jobs`); `npm run db:migrate` (local) → `db:migrate:remote --env staging` → `--env production`; then `deploy:staging && deploy:production` (backend-deployment rule).
- Migrations additive only (all `CREATE TABLE IF NOT EXISTS`) — safe for old clients (they ignore new tables/routes).
- FE ships after BE routes are live on staging.
- Kill switches: `CONFIG_KV` `savings_enabled` (default true; FE hides Savings tab if `GET /savings/overview` returns 404); `savings_import_enabled` (default true) independently gates AI import. Import R2 objects deleted on commit by default (A14).

---

## Revision History

**v1.6 — 2026-07-03** — Review Cycle 7 (paired IP v1.7): promoted cold-start push routing to a documented v1 limitation (warm taps only via `routeNotificationTap`; no `getLastNotificationResponseAsync` in codebase); clarified R2 delete-on-commit default (A14); Phase 2 notification scope aligned with IP §11/§12. Cycle-7 codebase-accuracy re-check: zero broken claims.

**v1.5 — 2026-07-03** — Review Cycle 6 (3 agents; paired IP v1.6):
- **CRITICAL (A18 premise corrected):** the "~30s Workers HTTP wall-time unless streaming" claim is **false** per Cloudflare docs — HTTP Workers have **no wall-clock limit**; the ceiling is **CPU time** (default 30s, →5min on Paid via `limits.cpu_ms`) and an awaited `fetch` costs **~0 CPU**. Rewrote A18 + A11: a **buffered** read is safe Worker-side; v1 = buffered + ≤10-page sync cap + FE polling (IP W4); streaming demoted to optional. Real constraints reframed (FE 2-min upload timeout, Anthropic 10-min non-streaming limit, idle-connection drops).
- **WARNING:** A16 — read model `claude-sonnet-4-5-20250929` flagged **legacy** (still functional; Sonnet 5 is the current tier and lifts the PDF read cap 100→600); shared env var, no v1 change. A16 truncation wording corrected to a **caught throw** (not a `stopReason` flag) to match the shipped `generateStructured` contract (IP C-1).
- Cycle-6 verification: codebase-accuracy agent found **zero** broken claims across both docs (all anchors, columns incl. `expenses.amount`, symbols, and full TRD↔IP pair-mode parity confirmed); external limits (32 MB request, 100-page PDF, Files-API `files-api-2025-04-14`/500 MB, image 8000px/1568px-1.15MP, cron 5-Free/250-Paid, KV ~60s, D1 partial-unique-index) all re-confirmed against official docs.

**v1.4 — 2026-07-03** — Review Cycle 5 delta (paired IP v1.5): fixed the last stale `BudgetService:189`→`:224` anchor in §4 (Cycle-4 missed it). No other body changes; all Cycle-4 fixes re-confirmed present.

**v1.3 — 2026-07-03** — Review Cycle 4 (3 agents; paired IP v1.4):
- **CRITICAL (arch):** new ADR **A18** — the synchronous-import claim was corrected. CPU-time is not the binding limit (awaited `fetch` = wall-time), but the **~30s Workers HTTP invocation wall-time is**; a buffered long PDF/vision read is killed at ~30s (and the FE 2-min upload timeout would then false-fail). Mitigation: stream the Worker→client response, keep small inputs sync, cap the synchronous PDF path at ≤10 pages otherwise. A11 reason updated to point at A18.
- **CRITICAL (pair-mode):** added push `data.type = 'savings_pace'` to §8 Phase 2 (was IP-only) → TRD↔IP parity.
- **WARNING:** §0 stale `src/App.tsx` reference corrected (file removed; entry `app/_layout.tsx`); `budget-service.ts` `checkHouseholdAccess` anchor `:189`→`:224`; §8 phase-numbering note (TRD 1–5 == IP 0–5).
- Cycle-4 verification: model IDs `claude-haiku-4-5-20251001` / `claude-sonnet-4-5-20250929` confirmed REAL & configured in `wrangler.toml`; 32 MB request cap / 100-page PDF / 8000px-1568px-1.15MP image limits / Files-API `files-api-2025-04-14` / cron 5-Free-250-Paid / CRA 2025-26 TFSA-RRSP-FHSA all confirmed against official docs.

**v1.2 — 2026-07-03** — Cycle 3 import-limits + thin client (paired IP v1.3):
- AI import ingest limits (ADR **A16**): PDF ≤100 pages, 20 MB inline base64 cap (Anthropic 32 MB request limit; Files API = v1.1), server-side image downsample, deterministic CSV parse, **Sonnet for vision read** / Haiku for structuring, `maxTokens 16384` + stream.
- **Thin client** (ADR **A17**): all business logic on the BE; FE renders computed view models only.
- Import writes recurring income as `savings_income_entries` (not Phase-4 templates) → Phase 5 depends only on Phase 1. §4 import cap 32 MB→20 MB.

**v1.1 — 2026-07-03** — Room-math correctness + scope expansion (paired with IP v1.2):
- **Correctness (CRA-verified):** RRSP room split into mutually-exclusive NOA vs from-scratch paths (NOA figure already nets PA — no double-subtraction); TFSA room drops the same-year withdrawal add-back (CRA restores room Jan 1 of the *following* year); constants marked ✅ verified; pace clamped.
- **New scope (user request):** Monthly Payments recurring-spending model (`savings_recurring_payments`) + idempotent apply; AI data import (`savings_import_jobs`, upload→extract→confirm→commit, Google Drive via `CloudFilePicker`) — ADRs A11–A15; registered accounts gain user-entered this-year limits (`annual_limit_override_cents`) + regular/manual contribution kinds. §3/§4/§5/§6/§7/§8 updated; 9-table migration.

**v1.0 — 2026-07-03** — Initial TRD.
