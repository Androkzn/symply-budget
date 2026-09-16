# Implementation Plan — Savings & Registered Accounts (v1.7)

**Version:** 1.7
**Date:** 2026-07-03
**Status:** Planned
**Area:** FE + BE
**Priority:** P1
**Source TRD:** documents/features/Savings_TRD.md (v1.6)
**Author:** a-tekhtelev

---

## §0 Codebase Snapshot Note

Written against the current `main` working tree. **Re-grep before starting each phase.** Inferred and external-contract claims (CRA limits, CLI flags) are marked ⚠️ Unverified unless linked to an official docs URL or quoted from `--help`.

Validated anchors (author time):
- `package.json:4` → `"main": "expo-router/entry"` — deep links live under `app/`. Note: `src/App.tsx` has been **removed** from the repo (entry is `app/_layout.tsx`); do not reference or edit it.
- `backend/src/index.ts:352` → `app.route('/households/:householdId/budget', budgetRoutes)`; `scheduled()` handler at `:555`, budget-alert dispatch at `:607-616` (daily 8AM UTC guard).
- `backend/src/services/budget-service.ts:224` → `checkHouseholdAccess` pattern (throws `ForbiddenError`). ⚠️ Author-time anchors have drifted (file is actively modified): month-window + `expenses` SUM at `getMonthlyOverview` `:854-911`; `deleteCategory` detach at `:431-436`; `createDefaultCategories` seed at `:293-296`. **Re-grep every anchor before Phase 0.**
- `backend/drizzle.config.ts:4` → `schema: './src/db/schema.ts'`; budget tables are NOT re-exported there → domain uses **hand-written** SQL migrations. Savings mirrors this.
- Latest migration `backend/migrations/0066_task_purchase_suggestion.sql` → next free is `0067_*`. ⚠️ `0066` is TAKEN (`0066_task_purchase_suggestion.sql`) — re-grep `ls backend/migrations/ | tail` before Phase 0 and bump the filename if the tree advanced past 0067.
- `src/screens/budget/BudgetScreen.tsx:45-53` → `FilterTabs` with `dashboard|planned|spendings`.
- `src/stores/budgetStore.ts:28` → `activeView: 'dashboard' | 'planned' | 'spendings'`.
- `src/navigation/types.ts:70` → `BudgetStackParamList`.
- `backend/wrangler.toml` → bindings `DB`, `CONFIG_KV`, `REPORTS_BUCKET` exist for all envs (no new binding needed).

---

## §1 Overview

Add a **Savings** cashflow layer and a **Registered accounts** (TFSA/RRSP/FHSA) layer on top of the existing Budget module, so the household can track **monthly income by member/source** (salaries, RRSP matching, rent, tax refund, insurance), **monthly regular spending** (a recurring **Monthly Payments** model — the second tab of the user's spreadsheet), net monthly + YTD savings, savings goals (Safety Pillow), and registered-account contribution room (with **user-entered this-year limits** + regular/manual contributions) — and see how spending affects savings headroom. **AI data import:** the user can upload files / images / pasted text / **Google Drive** exports and an AI extracts income, spending, and monthly payments into a **draft the user confirms** before it is saved. Replaces the user's external "Master Household Budget" spreadsheet in one import.

- **Scope:** FE + BE. **6 phases** (0–5; Phase 5 = Monthly Payments & AI import).
- **New BE files:** `schema-savings.ts`, `services/savings-service.ts`, `routes/savings.ts`, migration `0067_savings_tables.sql` (**9 tables**), `services/savings-limits.ts`, `workers/savings-alert-worker.ts` (Phase 2), `services/savings-import-service.ts` + `ai/prompts/extract-savings-document.ts` + `ai/prompts/suggest-savings-import.ts` (Phase 5), tests.
- **New FE files:** `api/savings.ts`, `stores/savingsStore.ts`, `screens/budget/savings/*` (incl. `SavingsImportScreen`, `SavingsRecurringPaymentsScreen`), tests.
- **Changed files:** `backend/src/index.ts` (route mount + cron), `src/screens/budget/BudgetScreen.tsx`, `src/stores/budgetStore.ts`, `src/navigation/types.ts`, `src/navigation/BudgetNavigator.tsx`, `src/screens/budget/index.ts`, `src/screens/budget/BudgetDashboardView.tsx`, `src/api/index.ts` (type exports), `src/services/notificationRouting.ts` (Phase 2 `savings_pace` route), `src/services/navigation.ts` (Phase 2 `navigateToBudget` param).
- **Total:** ~13 BE files, ~16 FE files.

Guiding constraints (from TRD ADRs): Model A sync (A1), affordability untouched (A2), Savings as 4th FilterTab (A3), hand-written migration (A4), `member_id`→`household_members.id` (A5), cents (A6), compute-on-read (A7), NOA-first RRSP + user-entered limits (A8), template-confirm income (A9), AI import draft-then-confirm (A11), recurring Monthly Payments (A12), reuse budget AI pipeline + Google-Drive picker (A13), R2 storage + PII handling (A14), registered user-entered limits + regular/manual contributions (A15), import ingest limits + Sonnet-for-vision (A16), thin client / BE-authoritative logic (A17), buffered import + FE-polling vs Workers runtime limits — no HTTP wall-clock limit (A18).

---

## §2 Architecture Decisions

See TRD §2 (A1–A18). Not re-decided here. IP-specific implementation decisions:

| # | Decision | Chosen | Reason |
|---|----------|--------|--------|
| IP1 | Home-from-Budget rollup source | Reuse `expenses` month query (same window logic as `getMonthlyOverview`, `budget-service.ts:854-911`) inside `SavingsService.getOverview` | Single source of truth; no new join in Budget |
| IP2 | Savings service auth | Own `checkHouseholdAccess` copied verbatim from `BudgetService:224` (not shared refactor) | Avoids touching shipped Budget service; low blast radius |
| IP3 | `savingsStore` | New Zustand store mirroring `budgetStore` (UI-only: selectedYear/Month, activeSubTab, dataRevision + `markDirty`). **Persist note:** `budgetStore` `partialize` (`budgetStore.ts:127`) persists ONLY `lastInsightsByHid` — NOT year/month/view. `savingsStore` follows the same rule: persist nothing UI-transient, or an explicit small `partialize`. `dataRevision` must be bumped on every income/spending/**category**/goal/registered/recurring-payment/import-commit mutation (mirror `markInsightsDirty`→`dataRevision`, `budgetStore.ts:102-105`) so all Savings views reload. **W3:** category CRUD (`createCategory/updateCategory/deleteCategory`) is explicitly included — a rename/delete detaches spending rows, so the overview/spending views must refetch. **Cross-store note → see IP5** for the Dashboard headroom card. | Matches existing budget pattern (budgetStore.ts:8-13, 102-127) |
| IP4 | Kill switch (end-to-end) | (a) BE: `CONFIG_KV` `savings_enabled` read in `savings.ts` middleware; 404 when `=== 'false'` (absent key = enabled). (b) FE: `BudgetScreen` probes `savingsApi.getOverview` on mount; on 404 it hides the Savings `FilterTab` and skips store init (Task 1.6). (c) Worker: `savings-alert-worker` checks the same flag before enqueuing (Task 2.4). Reverting = `wrangler kv key delete` or set `true`. **Propagation reality:** `CONFIG_KV` is eventually consistent (up to ~60s global edge propagation), and the FE caches the probe result per-session (Task 1.6) — so a mid-session flip to `false` takes effect on the client at next app launch, not sub-60s. `absent key = enabled` is a deliberate fail-open default (non-security feature). Exact-string compare (`flag === 'false'`) is intentional: only the literal `'false'` disables. | Reuses existing CONFIG_KV binding; true end-to-end disable incl. shipped RN builds + cron |
| IP5 | Dashboard headroom-card refresh (cross-store) | Budget FE uses **no TanStack Query** — `BudgetDashboardView` reloads only when `budgetStore.dataRevision` changes. The "Savings headroom" card (Task 2.3) reads `savingsApi.getOverview`, whose data changes on **savings** mutations that bump `savingsStore.dataRevision` — a *different* counter. **Decision:** `BudgetDashboardView`'s headroom effect subscribes to BOTH `budgetStore.dataRevision` AND `savingsStore.dataRevision` (add `savingsStore.dataRevision` to the effect deps). Do NOT rely only on `budgetStore` or the card goes stale after every savings mutation until the budget tab remounts. **Reverse hole (W2):** the *mirror image* applies to `SavingsOverviewView` — it renders the "Home (from Budget)" rollup (`SUM(expenses)`), which changes on **budget** mutations that bump `budgetStore.dataRevision` (a different counter). So `SavingsOverviewView`'s reload effect must ALSO depend on `budgetStore.dataRevision`, else the Home line is stale after a Budget-expense edit until a savings mutation or remount. Both cross-store subscriptions are required. | Single shared refresh signal would couple the stores; subscribing the two dependent surfaces to both counters is the minimal-blast-radius fix |
| IP6 | AI data import (Phase 5) | **Mirror `BudgetSuggestionService` structurally** (synchronous Claude call in the Worker; no queue/Lambda — budget's `ai-detect`/`ai-detect-upload` proves the pattern for small inputs). **NOT verbatim (C-2):** route ALL model calls through the `ai/provider.ts` abstraction — do NOT clone budget's legacy direct-`@anthropic-ai/sdk` read path (`extractSpendingTextFromDocument`); see Task 5.2 (hard rule: no direct SDK from a service). Upload → AI-extract → **persisted draft** (`savings_import_jobs`, mirror the `aihousekeeper_attachments` lifecycle) → user reviews/edits → commit. **Never silent-save** (ADR A9/A11). **Worker runtime (A18, corrected Cycle 6):** Workers have **no HTTP wall-clock limit** — an awaited `fetch` to Anthropic burns **~0 CPU** (I/O only), and the CPU ceiling (default 30s, raise to 5 min on Paid via `limits.cpu_ms`) is not consumed by the wait, so a **buffered** `c.json` after a long read is safe Worker-side. v1 ships **buffered + ≤10-page synchronous PDF cap + FE polling (W4)**; streaming the response is an **optional** resilience upgrade, not a survival requirement (and `generateStructured` cannot stream — C-1); larger PDFs → v1.1 Files-API async (§12). See Task 5.4. Models `AIHOUSEKEEPER_NUDGE_MODEL` primary / `AIHOUSEKEEPER_FALLBACK_MODEL` fallback via `generateStructuredWithFallback`. Google Drive = reuse `CloudFilePicker` (no Drive code to build). Second kill switch `savings_import_enabled`. | Reuses a shipped, tested AI-document pipeline end-to-end; persisted draft (vs budget's ephemeral state) because a full-spreadsheet import is too large to hold in component state across review |
| IP7 | Recurring "Monthly Payments" model (Phase 5) | New `savings_recurring_payments` table (no reusable recurring-spend model exists — `budget_items.is_recurring` stores only metadata, no materializer). Apply-to-month is **explicit + idempotent** (partial unique index on `(recurring_payment_id, period)`), mirroring income templates (A9). Applied rows are ordinary `savings_spending_entries`, so they feed overview + the essential baseline with zero extra wiring. | Symmetric with `savings_income_templates`; idempotent apply prevents double-charging a month; reuses existing spending aggregation |
| IP8 | Thin client — business logic on the backend | **ALL** money math (net, YTD, headroom), room/pace computation, category/member-name resolution, AI import extraction + mapping, and input validation live in the BE services (`savings-service.ts`, `savings-limits.ts`, `savings-import-service.ts`, `routes/savings.ts` zod). The FE only: renders BE-computed values, captures input, calls the API, and holds **UI-only** Zustand state (`selectedYear/Month`, `activeSubTab`, `dataRevision`). **No client-side net/YTD/room/pace math, no client-side draft normalization, no client-side member/category resolution.** After any mutation the FE **refetches** the relevant BE endpoint (via a `dataRevision` bump) rather than recomputing locally — the API returns fully-computed view models. | User directive; keeps the RN bundle light, puts every financial computation in one Vitest-tested place, and prevents FE/BE drift on money numbers |

---

## §3 Pre-Implementation Checklist

- [ ] `git status` clean; branch created `feat/savings-tab`.
- [ ] Confirm `wrangler` access to staging + production D1 (`npx wrangler d1 list`).
- [ ] Re-grep §0 anchors; fix any drift in this plan before coding.
- [ ] Confirm the next free migration number via `ls backend/migrations/ | tail` — currently `0067` (`0066_task_purchase_suggestion.sql` is the latest applied); bump `0067_savings_tables.sql` if the tree advanced.
- [ ] TRD §2 open decisions resolved (all resolved: Model A, all-phases, member FK).
- [ ] Confirm CRA limits current for the ship year (2025 TFSA $7,000 / RRSP $32,490; 2026 TFSA $7,000 / RRSP $33,810; FHSA $8,000 / $40,000) — ✅ verified 2026-07 at canada.ca; re-verify each tax year (inflation-indexed).

---

## §4 Implementation Phases

### Phase 0 — Migration + schema scaffolding

**Goal:** Create all savings tables (all phases' tables in one additive migration) + Drizzle definitions. Deployable with no behavior change.
**Pre-condition:** §3 done.
**Blocks:** all later phases.
**Deploy-after:** Worker deploy (migration) — no RN.

#### Task 0.1 — Migration `backend/migrations/0067_savings_tables.sql` (new file)

`Type: new`. All `CREATE TABLE IF NOT EXISTS` (additive; safe for old clients). All money columns `INTEGER` cents. (SQLite `INTEGER` is 64-bit; Drizzle `integer()` reads as a JS number, safe to 2^53 ≈ $90 trillion in cents — no overflow concern at household scale.)

```sql
-- Migration: Savings & Registered accounts
-- Created: 2026-07-03

CREATE TABLE IF NOT EXISTS savings_categories (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    icon TEXT,
    color TEXT,
    is_essential INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(household_id, name)   -- W3: makes default-category seeding idempotent under concurrent first-open
);
CREATE INDEX IF NOT EXISTS savings_categories_household_idx ON savings_categories(household_id);

CREATE TABLE IF NOT EXISTS savings_income_entries (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    member_id TEXT REFERENCES household_members(id) ON DELETE SET NULL,
    source_type TEXT NOT NULL,
    label TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    income_date TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'CAD',
    notes TEXT,
    template_id TEXT,            -- logical FK → savings_income_templates(id); set when this row was generated by applying a recurring-income template (Phase 4)
    period TEXT,                 -- 'YYYY-MM' when generated by applying a template; NULL for ad-hoc income
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS savings_income_household_idx ON savings_income_entries(household_id);
CREATE INDEX IF NOT EXISTS savings_income_date_idx ON savings_income_entries(household_id, income_date);
-- Idempotent apply-templates: at most one income row per (template, month) — mirrors the recurring-payments design (C1)
CREATE UNIQUE INDEX IF NOT EXISTS savings_income_template_period_idx
  ON savings_income_entries(template_id, period) WHERE template_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS savings_spending_entries (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    category_id TEXT REFERENCES savings_categories(id) ON DELETE SET NULL,
    label TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'CAD',
    spending_date TEXT NOT NULL,
    notes TEXT,
    recurring_payment_id TEXT,   -- logical FK → savings_recurring_payments(id); plain TEXT to avoid migration table-order coupling (relationship enforced in service)
    period TEXT,                 -- 'YYYY-MM' when this row was generated by applying a recurring payment; NULL for ad-hoc spend
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS savings_spending_household_idx ON savings_spending_entries(household_id);
CREATE INDEX IF NOT EXISTS savings_spending_date_idx ON savings_spending_entries(household_id, spending_date);
-- Idempotent recurring-apply: at most one spend row per (recurring payment, month)
CREATE UNIQUE INDEX IF NOT EXISTS savings_spending_recurring_period_idx
  ON savings_spending_entries(recurring_payment_id, period) WHERE recurring_payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS savings_income_templates (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    member_id TEXT REFERENCES household_members(id) ON DELETE SET NULL,
    source_type TEXT NOT NULL,
    label TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'CAD',
    day_of_month INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS savings_income_templates_household_idx ON savings_income_templates(household_id);

CREATE TABLE IF NOT EXISTS savings_goals (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    target_amount_cents INTEGER NOT NULL,
    current_amount_cents INTEGER NOT NULL DEFAULT 0,
    target_date TEXT,
    months_of_expenses INTEGER,
    monthly_allocation_cents INTEGER,
    currency TEXT NOT NULL DEFAULT 'CAD',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS savings_goals_household_idx ON savings_goals(household_id);

CREATE TABLE IF NOT EXISTS registered_accounts (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    member_id TEXT REFERENCES household_members(id) ON DELETE SET NULL,
    account_type TEXT NOT NULL,
    institution TEXT,
    balance_cents INTEGER NOT NULL DEFAULT 0,
    starting_room_cents INTEGER,            -- user-entered CURRENT-year available room (RRSP: NOA deduction limit; TFSA: CRA My Account room)
    annual_limit_override_cents INTEGER,    -- optional: user-entered this-year limit; overrides the CRA constant when present (guards against a stale SAVINGS_LIMITS entry)
    regular_contribution_cents INTEGER,     -- optional: monthly "regular" contribution amount (e.g. RRSP employer matching) used by the apply-regular action
    room_as_of_date TEXT,
    prior_earned_income_cents INTEGER,
    pension_adjustment_cents INTEGER,
    currency TEXT NOT NULL DEFAULT 'CAD',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS registered_accounts_household_idx ON registered_accounts(household_id);

CREATE TABLE IF NOT EXISTS registered_transactions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES registered_accounts(id) ON DELETE CASCADE,
    type TEXT NOT NULL,                      -- 'contribution' | 'withdrawal'
    kind TEXT NOT NULL DEFAULT 'manual',     -- 'regular' (e.g. RRSP employer matching, recurring) | 'manual' (ad-hoc this year)
    amount_cents INTEGER NOT NULL,
    transaction_date TEXT NOT NULL,
    tax_year INTEGER,
    period TEXT,                             -- 'YYYY-MM' when auto-generated by applying a regular contribution; NULL for ad-hoc
    notes TEXT,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS registered_transactions_account_idx ON registered_transactions(account_id);
-- Idempotent regular-contribution apply: at most one auto row per (account, month)
CREATE UNIQUE INDEX IF NOT EXISTS registered_tx_regular_period_idx
  ON registered_transactions(account_id, period) WHERE period IS NOT NULL;

-- === Phase 5 additions (Monthly Payments + AI import) — created here in the single additive 0067 migration ===

CREATE TABLE IF NOT EXISTS savings_recurring_payments (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    category_id TEXT REFERENCES savings_categories(id),
    label TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'CAD',
    day_of_month INTEGER,                    -- optional due day 1-31
    group_label TEXT,                        -- e.g. 'Mortgages' / 'Other' subtotal grouping from the source sheet
    is_essential INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    source TEXT NOT NULL DEFAULT 'manual',   -- 'manual' | 'ai_import'
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS savings_recurring_payments_household_idx ON savings_recurring_payments(household_id);

CREATE TABLE IF NOT EXISTS savings_import_jobs (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending_upload',  -- pending_upload|uploaded|analyzing|ready|committed|failed
    source_kind TEXT NOT NULL,                       -- 'file' | 'image' | 'text' | 'drive'
    file_key TEXT,                                   -- R2 object key (NULL for pasted text)
    file_name TEXT,
    mime_type TEXT,
    size_bytes INTEGER,
    content_hash TEXT,                               -- SHA-256 for dedup (mirror aihousekeeper_attachments)
    raw_text TEXT,                                   -- pasted text or model-extracted text
    draft_json TEXT,                                 -- AI-extracted structured draft (JSON) for user review before commit
    error TEXT,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS savings_import_jobs_household_idx ON savings_import_jobs(household_id);
```

**Verification:** `npm run db:migrate` locally; `npx wrangler d1 execute simple-house-db-staging --local --command "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'savings_%' OR name LIKE 'registered_%')"` returns **9 tables** (`savings_categories`, `savings_income_entries`, `savings_spending_entries`, `savings_income_templates`, `savings_goals`, `savings_recurring_payments`, `savings_import_jobs`, `registered_accounts`, `registered_transactions`).
**Rollback:** additive only; to reverse, `DROP TABLE` the 9 tables (data loss acceptable pre-launch). Forward-only in prod.

#### Task 0.2 — `backend/src/db/schema-savings.ts` (new file)

`Type: new`. Drizzle table defs mirroring `schema-budget.ts` conventions (see `schema-budget.ts:5-26`). **Produces (9 tables):** `savingsIncomeEntries, savingsSpendingEntries, savingsCategories, savingsGoals, savingsIncomeTemplates, savingsRecurringPayments, savingsImportJobs, registeredAccounts, registeredTransactions` + inferred types. Columns must match the 0067 migration EXACTLY (incl. the Phase-3 `annual_limit_override_cents`/`regular_contribution_cents`/`kind`/`period` columns, the Phase-5 `recurring_payment_id`/`period` columns, and the Phase-4 `template_id`/`period` columns on `savings_income_entries` — C1). **external:** `drizzle-orm/sqlite-core` (installed), `households/users/householdMembers` from `./schema` (pre-existing).

```ts
import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { households, users, householdMembers } from './schema';

export const savingsCategories = sqliteTable('savings_categories', {
  id: text('id').primaryKey(),
  household_id: text('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  icon: text('icon'),
  color: text('color'),
  is_essential: integer('is_essential', { mode: 'boolean' }).notNull().default(false),
  sort_order: integer('sort_order').default(0),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => ({ household_idx: index('savings_categories_household_idx').on(t.household_id) }));

// ...savingsIncomeEntries, savingsSpendingEntries, savingsIncomeTemplates,
//    savingsGoals, registeredAccounts, registeredTransactions defined the
//    same way, columns matching 0067 migration exactly.

export type SavingsIncomeEntry = typeof savingsIncomeEntries.$inferSelect;
export type SavingsSpendingEntry = typeof savingsSpendingEntries.$inferSelect;
export type SavingsCategory = typeof savingsCategories.$inferSelect;
export type SavingsIncomeTemplate = typeof savingsIncomeTemplates.$inferSelect;
export type SavingsGoal = typeof savingsGoals.$inferSelect;
export type SavingsRecurringPayment = typeof savingsRecurringPayments.$inferSelect;
export type SavingsImportJob = typeof savingsImportJobs.$inferSelect;
export type RegisteredAccount = typeof registeredAccounts.$inferSelect;
export type RegisteredTransaction = typeof registeredTransactions.$inferSelect;
```

**Why:** Service consumes these directly (budget precedent — `budget-service.ts:4-13`). Note: do NOT re-export from `schema.ts` — the budget domain doesn't, and `db:generate` is intentionally bypassed for this domain (§0).
**Risk:** column/DDL drift between migration and Drizzle def → runtime `no such column`. Mitigation: Reviewer A DDL-direction check.
**Verification:** `npm run typecheck` in `backend/`.

#### Task 0.3 — Apply migration to all environments (manual, gated)

`Type: manual`. **This gates every later Worker deploy.** Order: `cd backend && npm run db:migrate` (local) → `npm run db:migrate:remote -- --env staging` → `npm run db:migrate:remote -- --env production`. Then smoke-check each remote env:
```bash
npx wrangler d1 execute simple-house-db-staging --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'savings_%' OR name LIKE 'registered_%')"
```
Must return **9 tables** per env **before** any phase's `deploy:staging`/`deploy:production`. No Worker code in later phases may be deployed to an env whose `0067` migration has not been confirmed applied.

### Phase 1 — Savings cashflow MVP

**Goal:** Income + spending entry, categories, monthly overview (net + Home-from-Budget rollup), 6-month trend, Savings tab in Budget. **Pre-condition:** Phase 0 deployed. **Blocks:** Phases 2–4. **Deploy-after:** Worker deploy, then RN build.

#### Task 1.1 — `backend/src/services/savings-service.ts` (new)

`Type: new`. **Produces:** `SavingsService`, `SavingsOverview` interface. **Consumes:** schema-savings tables (Phase 0). **external:** `drizzle-orm` helpers, `expenses` from `schema-budget` (pre-existing), `ForbiddenError/NotFoundError/ValidationError` from `middleware/error-handler` (pre-existing, used by `budget-service.ts:15`).

Copy `checkHouseholdAccess` verbatim from `budget-service.ts:224-235`. Month window logic copied from `getMonthlyOverview` (`budget-service.ts:864-867`). (⚠️ re-grep — anchors drift.)

```ts
export interface SavingsOverview {
  year: number; month: number;
  income: { total: number; bySource: Record<string, number>; entries: SavingsIncomeEntry[] };
  spending: { total: number; manual: number; homeFromBudget: number; entries: SavingsSpendingEntry[] };
  netSavings: number;      // income.total − spending.total
  ytdNet: number;          // Jan→month running sum
  savingsHeadroom: number; // netSavings − Σ active goals monthly_allocation_cents
  goals: Array<{ id: string; name: string; type: 'emergency_fund' | 'custom'; target: number; current: number; monthlyAllocation: number | null }>;
}
```

`getOverview(householdId, userId, year, month)`:
1. `checkHouseholdAccess`.
2. Month window `monthStart`/`monthEnd` (copy from budget-service).
3. Sum `savings_income_entries` where `income_date` in window; group by `source_type`.
4. Sum `savings_spending_entries` (manual) in window.
5. **Home-from-Budget rollup (Model A / IP1):** `SUM(expenses.amount)` where `expense_date` in window — same query shape as `getMonthlyOverview` (`budget-service.ts:898-911`; note the column is `expenses.amount`, NOT `amount_cents`). This is a computed line, NOT inserted.
6. `netSavings = income.total − (spending.manual + homeFromBudget)`.
7. `ytdNet`: **single grouped query per source — NOT a 12-iteration loop.** D1 is a per-statement network round-trip, so a Jan→month loop is ~36 sequential reads. Group by month with `substr(<date_col>, 1, 7)` (dates are `YYYY-MM-DD` TEXT ⇒ `substr(...,1,7)` = `YYYY-MM`) over the `Jan-01 … monthEnd` window: `SELECT substr(income_date,1,7) AS ym, SUM(amount_cents) AS total FROM savings_income_entries WHERE household_id=? AND income_date BETWEEN ? AND ? GROUP BY ym`. Three grouped queries total (income, spending, `expenses`); zero-fill missing months in JS; `ytdNet = Σ (income_ym − spending_ym − expenses_ym)`. Still Drizzle-compliant via a `sql` fragment in `.groupBy()`.
8. `savingsHeadroom = netSavings − Σ active goals monthly_allocation_cents`.

Also: `listIncome/createIncome/updateIncome/deleteIncome`, `listSpending/createSpending/updateSpending/deleteSpending`, `listCategories/createCategory/updateCategory/deleteCategory` (mirror `budget-service` CRUD + `checkHouseholdAccess` on each), `getTrend(householdId,userId,year,month,months)`.

Category seeding: `getCategories` seeds 7 defaults on first call if none exist (mirror `createDefaultCategories`, `budget-service.ts:293-296` pattern): Mortgage/Condo Fee/Utilities/Insurance/Property Tax = `is_essential:true`; Home Improvement/Other = false. **Race guard (W3):** `budget-service`'s seed has no transaction/unique guard, so two concurrent first-opens (two devices) can double-seed. Savings adds `UNIQUE(household_id, name)` on `savings_categories` (Task 0.1) and seeds with `INSERT OR IGNORE` so a concurrent double-open is idempotent.

**Idempotency on money writes (W2):** `createIncome/createSpending/createGoal` (and `addTransaction`, Phase 3) are money-mutating POSTs with no dedup — a double-tap inserts two rows and doubles net savings. Mitigation: each `create*` accepts a **client-generated UUID as the primary key** and inserts with `INSERT OR IGNORE` (re-submitting the same id is a no-op); the FE also disables the submit button while a create is in flight (Task 1.6 / 2.3 / 3.3 forms). Document the client-UUID contract in `src/api/savings.ts` (Task 1.4).

`deleteCategory` MUST detach referencing spending rows first (copy `budget-service.ts:431-436`): `UPDATE savings_spending_entries SET category_id=NULL WHERE category_id=?` before delete — the FK has no `ON DELETE` (SQLite RESTRICT) so an un-detached delete throws at runtime.

`getOverview` step 8 (`savingsHeadroom`): goals table exists from Phase 0, so the query is safe in Phase 1 even before Phase 2 UI — with no goals rows, `Σ monthly_allocation = 0` and `savingsHeadroom === netSavings`. Document this graceful degrade.

**Perf:** `getOverview` is called on the Savings tab AND on every Budget-dashboard load (the headroom card, Task 2.3), so it is a hot path. The single-grouped-query `ytdNet` (step 7) keeps it at ~3 D1 round-trips regardless of month — do NOT reintroduce a per-month loop. Indexed by `(household_id, income_date)` / `(household_id, spending_date)` / the existing `expenses` date index. Add a staging benchmark in Task 1.5 to confirm p95 <300ms. **Verification:** unit tests Task 1.5.

#### Task 1.2 — `backend/src/routes/savings.ts` (new)

`Type: new`. Mirror `routes/budget.ts:1-22`. **Produces:** default-exported `savings` Hono router. **external:** `authMiddleware`, `zValidator`, `SavingsService`.

```ts
const savings = new Hono<{ Bindings: Env }>();
savings.use('/*', authMiddleware());
// Kill switch (IP4): if CONFIG_KV 'savings_enabled' === 'false' → 404
savings.use('/*', async (c, next) => {
  const flag = await c.env.CONFIG_KV.get('savings_enabled');
  if (flag === 'false') return c.json({ error: 'Not found' }, 404);
  await next();
});
// DO NOT use rateLimit() here — in-memory Map, per-isolate only (§10). Use RATE_LIMITER DO if adding limits.
```

Routes per TRD §4 (overview, trend, income CRUD, spending CRUD, categories CRUD). Each resolves `householdId` from param + delegates to service (which re-checks access). Zod schemas mirror `budget.ts:24-75`; amounts `z.number().int().min(0)`. **Enums must be explicit `z.enum([...])`** (TRD §3): `source_type` `['payroll','rental','rrsp_matching','tax_refund','insurance','other']`; goal `type` `['emergency_fund','custom']`, `status` `['active','achieved','archived']`; `account_type` `['tfsa','rrsp','fhsa']`; transaction `type` `['contribution','withdrawal']`. Dates validated `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)`. **Dep note:** keep `@hono/zod-validator` and `zod` on a compatible major pair (repo already uses `zValidator` for budget — match the installed versions; recent `@hono/zod-validator` targets Zod v4, so do not bump one without the other or inferred types silently break).

#### Task 1.3 — Mount route in `backend/src/index.ts`

`Type: edit`. After line 352.

Current:
```ts
app.route('/households/:householdId/budget', budgetRoutes);
```
New (add import near line 29 + mount after 352):
```ts
import savingsRoutes from './routes/savings';
// ...
app.route('/households/:householdId/budget', budgetRoutes);
app.route('/households/:householdId/savings', savingsRoutes);
```
**Verification:** `npm run typecheck`; `curl` overview route returns 200 on staging.

#### Task 1.4 — `src/api/savings.ts` (new)

`Type: new`. Mirror `src/api/budget.ts:1` (`import { api, apiClient } from './client'`). Export `savingsApi` with typed methods per TRD §4 and interfaces (`SavingsOverview`, `SavingsIncomeEntry`, `SavingsSpendingEntry`, `SavingsCategory`, `SavingsGoal`). Export types through `src/api/index.ts` (mirror line 143 `MonthlyOverview` export).

#### Task 1.5 — Tests (Phase 1)

- `backend/src/routes/__tests__/savings.test.ts` (Vitest + `@cloudflare/vitest-pool-workers`, mirror `backend/src/routes/__tests__/budget.test.ts`; `backend/__tests__/` holds only smoke/integration — do NOT put unit tests there): overview math incl. Home-from-Budget rollup; ytdNet; income/spending CRUD; `deleteCategory` detach; household scoping (403 non-member); **401 unauthenticated** (mirror `budget.test.ts:12`); kill-switch 404 (`savings_enabled` and `savings_import_enabled`); **kill-switch exact-string semantics (IP4):** key absent → 200; `'false'` → 404; `'true'` → 200; `'FALSE'`/`'0'` → 200 (only the literal `'false'` disables).
- Add `backend/src/routes/__tests__/savings-test-helpers.ts` if budget uses a helper for DDL/test-household setup (grep `budget-test-helpers`); otherwise inline like `budget.test.ts`.
- `src/api/__tests__/savings.api.test.ts` (mirror `src/api/__tests__/tasks.api.test.ts`).
- `src/screens/budget/savings/__tests__/SavingsView.test.tsx` (mirror `src/screens/budget/__tests__/`): renders tab, net line updates, kill-switch hides tab on 404.

#### Task 1.6 — FE store + navigation + Savings tab

- `src/stores/savingsStore.ts` (new): mirror `budgetStore.ts` — `selectedYear/Month`, `activeSubTab: 'overview'|'income'|'spending'|'goals'`, `dataRevision`, actions. MMKV persistence via `asyncStorage` (budgetStore.ts:126 pattern) — persist only UI prefs.
- `src/stores/budgetStore.ts:28` edit: add `'savings'` to the `activeView` union literal (declared once at `:28`; `:43` `setActiveView` is a *derived* `BudgetState['activeView']` reference that propagates automatically — no second literal to edit). The `BudgetScreen.tsx:52` cast is tracked separately below.
- `src/screens/budget/BudgetScreen.tsx` edit: add `{ id: 'savings', label: 'Savings' }` to `FilterTabs` (`:45-53`); **update the `onTabChange` cast at `:52`** from `as 'dashboard' | 'planned' | 'spendings'` to include `'savings'`; render `<SavingsView />` when `activeView==='savings'`; set `FilterTabs scrollable` (4 tabs). **Kill-switch probe (IP4b):** on mount call `savingsApi.getOverview(currentHousehold.id, year, month)`. Tri-state result handling (do NOT conflate 404 with a transient failure):
  - **404** → feature disabled: hide the Savings tab, skip `savingsStore` init. Cache `disabled`.
  - **200** → enabled: render the tab. Cache `enabled`.
  - **network error / timeout / 5xx (non-404)** → treat as `enabled` (fail-open, non-security feature): render the tab so a transient Worker blip doesn't hide a shipped feature; each sub-call handles its own error/retry. Do NOT cache this transient result — re-probe on next mount.
  Cache only the definitive 200/404 outcome (per session) to avoid re-probing every render.
- `src/screens/budget/savings/SavingsView.tsx` (new): internal `FilterTabs` (overview/income/spending/goals) + child views: `SavingsOverviewView`, `SavingsIncomeView`, `SavingsSpendingView` (goals view stubbed until Phase 2). Charts via `react-native-gifted-charts` (already used, `BudgetDashboardView.tsx:10`).
- `src/screens/budget/index.ts` edit: export new screens.
- `src/navigation/types.ts:70` edit + `BudgetNavigator.tsx` edit: add `SavingsEntryForm` pushed screen (income/spending add-edit).

**Verification:** Savings tab renders; add income + spending → net line updates; a Budget expense appears in "Home (from Budget)" line.
**Rollback:** flip `savings_enabled=false` in CONFIG_KV (hides tab via 404); revert RN build.

---

### Phase 2 — Goals & Safety Pillow

**Goal:** Emergency-fund wizard, custom goals, headroom card, pace, behind-pace notification. **Pre-condition:** Phase 1 deployed. **Blocks:** —. **Deploy-after:** Worker + RN.

#### Task 2.1 — Service: goals

`savings-service.ts` add `listGoals/createGoal/updateGoal/deleteGoal`; `getEmergencyFundSuggestion(householdId,userId,months)` = `essentialMonthlySpending × months`. **`essentialMonthlySpending`** must include BOTH (a) `savings_spending_entries` joined to `savings_categories.is_essential=true` AND (b) the Home-from-Budget rollup (`SUM(expenses.amount)`), averaged over trailing 3 months — otherwise households that track home costs only in Budget (Model A) get a near-zero baseline and a wrong target.

**No-history / divide-by-zero guards (W7):** average essential spending over `min(3, monthsWithAnyData)`; if the denominator is 0 (new household, no essential rows AND no Budget expenses), return `{ suggestedTarget: 0, note: 'NO_HISTORY' }` rather than dividing by zero. **Pace** = `(target − current) / max(1, monthsRemaining)` — clamp `monthsRemaining` to ≥1 so a goal with no `target_date` or a past/current-month date never divides by zero; a fully-funded goal (`current ≥ target`) returns pace 0 and status `achieved`.

#### Task 2.2 — Routes: goals

`routes/savings.ts` add goals CRUD + `GET /savings/goals/emergency-fund/suggestion?months=`.

#### Task 2.3 — FE goals

- `SavingsGoalsView.tsx` (replace Phase 1 stub): goal cards with progress bar (`react-native-gifted-charts` or simple View), pace text.
- `SavingsGoalForm` pushed screen (`navigation/types.ts` + `BudgetNavigator.tsx`): emergency-fund wizard (months picker 3/6/9/12, default 6) + custom goal.
- `src/screens/budget/index.ts` edit: export the new Phase-2 screens (`SavingsGoalsView`, `SavingsGoalForm`) — mirrors the Phase-1 export step (Task 1.6).
- `BudgetDashboardView.tsx` edit: add "Savings headroom" card fed by `savingsApi.getOverview`. **Per IP5:** its reload effect must include `savingsStore.dataRevision` in its dependencies (alongside the existing `budgetStore.dataRevision`) — otherwise the card is stale after a savings income/spending/goal mutation until the budget tab remounts. Verify: add income on the Savings tab → switch to Dashboard → headroom card reflects the new value without a remount.

#### Task 2.4 — Behind-pace notification

`backend/src/workers/savings-alert-worker.ts` (new, mirror `budget-alert-worker.ts`): daily 8AM UTC check for goals behind pace → **`NotificationService.sendNotification`** (this is what `budget-alert-worker.ts:141-149,192-204` uses for cron-fired alerts — NOT `scheduleNotification`), `data.type = 'savings_pace'`. **Payload contract (W-4):** the mirrored budget worker sets `data.screen` (+ the notification `type` field), but the FE `routeNotificationTap` (`notificationRouting.ts`) keys off **`data.type`** — so the savings worker MUST pass `data: { type: 'savings_pace', householdId, period, screen: 'Savings' }` **explicitly** (do NOT assume the budget mirror populates `data.type` — it does not for its own alert). Guard at the top of the check: read `CONFIG_KV.get('savings_enabled')`; return early if `=== 'false'` (IP4c). Wire into `backend/src/index.ts` scheduled handler after the budget-alert block (`:607-616`), same `now.getUTCHours() === 8` guard.

**⚠️ Cron caveat (accurate framing):** the savings alert is a *dispatch inside the existing `scheduled()` handler*, NOT a new cron trigger — so it consumes **zero** additional cron slots (Cloudflare's documented multi-schedule pattern: one cron string → one `scheduled()` → time-window guards). The blocker is that the Worker's cron trigger blocks are currently **commented out in `backend/wrangler.toml`** for both staging (`:259-262`) and production (`:385-388`) — verified — so the whole `scheduled()` handler (incl. the existing `budget-alert-worker`) does not fire in either env today. The account limit is **5 cron triggers on the Free plan / 250 on Paid** (account-wide; the old per-Worker cap was removed) — so re-enabling is an ops decision, not a hard blocker if on Paid. Phase 2 DoD for the notification is therefore: **worker method + wiring + unit test green**; live delivery is gated on ops re-enabling the cron block (documented in §12). Do not claim live delivery in DoD.

FE routing: add a `savings_pace` branch to `routeNotificationTap` (`src/services/notificationRouting.ts:270-277`, mirror the `budget_alert` branch). This requires extending `navigateToBudget` (`src/services/navigation.ts:166-168`, currently only `'BudgetMain' | 'BudgetSettings'`) to accept an **optional** `activeView: 'savings'` (+ optional goals sub-tab) param — keep the new param optional so existing callers (`notificationRouting.ts:266,276`) stay unchanged; grep all `navigateToBudget(` call sites before editing. Having `BudgetScreen` honor the param via `budgetStore.setActiveView`. **⚠️ Match the ACTUAL codebase notification stack (Cycle-4 correction) — do NOT use `getLastNotificationResponseAsync` / `navigationRef.isReady()`:** verified at `src/services/navigation.ts:23-26`, the `navigationRef` singleton is **not attached under expo-router** and `isReady()` **always returns false**; there is no `getLastNotificationResponseAsync` call anywhere in `src/`. The real routing already handles taps via `routeNotificationTap` → **`router.push`** (expo-router imperative navigation), and warm taps flow through `addNotificationResponseReceivedListener` (`useNotificationHandler.ts`, `RootNavigator.tsx:105`). Therefore: implement `savings_pace` the SAME way the existing `budget_alert` branch works — build the expo-router target inside `routeNotificationTap` and `router.push` it with the `activeView: 'savings'` param (pass it as an initial param the Budget tab reads on mount). This handles **warm** taps (via `addNotificationResponseReceivedListener`). **⚠️ Cold-start caveat (Cycle 7 — promoted to §12):** this app's pushes are **data-only** (`data.type` routing), and expo-router does **NOT** auto-replay a data-only push as a launch URL — a cold tap needs an explicit `Notifications.getLastNotificationResponseAsync()` / `useLastNotificationResponse()` read in the root layout to route. Verified: **no cold-start handler exists app-wide today** (zero matches for `getLastNotificationResponse` / `useLastNotificationResponse` in `src/`). `savings_pace` inherits the same warm-only behavior as `budget_alert`. Phase 2 DoD is **warm-tap routing + worker wiring + unit test** — cold-start replay is a **Known Gap (§12)**, not in v1 scope. (Low impact in v1: the cron that fires this alert is disabled — §12.)

#### Task 2.5 — Tests (Phase 2)

Goal CRUD + emergency-fund suggestion math + pace recompute (behind vs on-track) + worker fires for behind-pace goal (mirror budget-alert-worker tests if present).

### Phase 3 — Registered accounts (TFSA / RRSP / FHSA)

**Goal:** Per-member registered accounts, contribution/withdrawal log, room estimate, NOA-first setup, over-contribution warnings. **Pre-condition:** Phase 1 deployed. **Independent of Phase 2:** the **primary** entry point to Registered accounts is a Settings row (built in Phase 3, no Phase-2 dependency); the `SavingsGoalsView` link (Task 3.3) is an *additive secondary* entry that only renders if Phase 2 shipped. This keeps Phase 3 deployable without Phase 2. **Blocks:** —. **Deploy-after:** Worker + RN.

#### Task 3.1 — `backend/src/services/savings-limits.ts` (new)

`Type: new`. **Produces:** `SAVINGS_LIMITS`, `getTfsaRoom`, `getRrspRoom`, `getFhsaRoom`.

```ts
// ✅ Verified against CRA (2026-07). Re-verify each tax year — figures are inflation-indexed.
//    Sources: canada.ca TFSA "Contributing to a TFSA"; MP/RRSP/DPSP/TFSA limits table; FHSA "Contributing to your FHSAs".
export const SAVINGS_LIMITS: Record<
  number,
  { tfsa: number; rrspMax: number; fhsaAnnual: number; fhsaLifetime: number }
> = {
  2025: { tfsa: 700000, rrspMax: 3249000, fhsaAnnual: 800000, fhsaLifetime: 4000000 }, // $7,000 / $32,490 / $8,000 / $40,000
  2026: { tfsa: 700000, rrspMax: 3381000, fhsaAnnual: 800000, fhsaLifetime: 4000000 }, // $7,000 / $33,810 / $8,000 / $40,000
};
export const RRSP_OVER_CONTRIBUTION_BUFFER_CENTS = 200000; // CRA $2,000 lifetime cushion

// Guard: throw before any room math if the ship year has no entry (§10.1 R2)
function requireLimitsForYear(year: number) {
  if (!SAVINGS_LIMITS[year]) {
    throw new ValidationError(`Savings limits not configured for ${year} — verify at canada.ca and add to SAVINGS_LIMITS`);
  }
}
```

**RRSP room — TWO mutually-exclusive paths (correctness fix, Cycle 2).** The "RRSP deduction limit" printed on the NOA (ADR A8, NOA-first) **already nets out the prior-year Pension Adjustment (PA) and prior unused room** — CRA reports it as the *final* available figure. Subtracting PA again, or re-adding the `18% × earned income` term on top of the NOA figure, **double-counts** and understates room for anyone with an employer pension (verified: canada.ca "How contributions affect your RRSP deduction limit"). `getRrspRoom` MUST branch:
- **NOA path (primary — `starting_room_cents != null`):** `roomRemaining = starting_room_cents − Σ contributions(on/after room_as_of_date)`. Do NOT subtract `pension_adjustment_cents`; do NOT add the 18% term. The advanced PA field is display-only in this path.
- **From-scratch estimate (only when `starting_room_cents == null`):** `roomRemaining = min(round(0.18 * prior_earned_income_cents), rrspMax(year)) − (pension_adjustment_cents ?? 0) − Σ contributions`.
- The two branches are mutually exclusive (`if (starting_room_cents != null) …`), never additive.
- Over-contribution warning when `roomRemaining < -RRSP_OVER_CONTRIBUTION_BUFFER_CENTS` (i.e. below −$2,000).

**Annual limit source — user-entered (ADR A8 + user requirement):** `annualLimit = account.annual_limit_override_cents ?? SAVINGS_LIMITS[year][type]`. The user can enter *this year's* limit explicitly (guards against a stale constant); otherwise the verified CRA constant is used. `used = Σ contributions(year)` counts **both** `kind='regular'` (e.g. RRSP employer matching) and `kind='manual'` (ad-hoc) transactions; `usedByKind: { regular, manual }` is returned alongside for display.

**TFSA room — user-room-first (mirrors the RRSP two-path shape):**
- **User-room path (primary — `starting_room_cents != null`, from CRA My Account):** `roomRemaining = starting_room_cents + priorYearWithdrawals − used`. The entered room already includes accumulated unused room + this year's limit, so do NOT also add `annualLimit`.
- **From-scratch (only when `starting_room_cents == null`):** `roomRemaining = annualLimit + priorYearWithdrawals − used` (⚠️ counts only this year's limit — understates if the household has years of unused room; the UI must prompt the user to enter their CRA My Account room for accuracy).
- Either path: **do NOT add current-year withdrawals** — CRA restores withdrawn room only on **Jan 1 of the following year**, so `priorYearWithdrawals` = withdrawals dated in years strictly before `year`. Re-adding a same-year withdrawal risks a taxable over-contribution (1%/month). Source: canada.ca "Making or replacing withdrawals from a TFSA."

**FHSA (v1 decision — balance + lifetime cap only):** `getFhsaRoom` ships balance tracking plus a lifetime-cap check: `roomRemaining = fhsaLifetime − Σ contributions(all years)`; warn `ROOM_OVER_CONTRIBUTION` when `Σ contributions > SAVINGS_LIMITS[year].fhsaLifetime` ($40,000). **Per-year FHSA carryforward** (annual $8,000 + up to $8,000 carried ⇒ max $16,000/yr) is **deferred** to a later release (§12 + Phase 3 DoD) — carryforward needs a per-year opened-account ledger not modeled in v1.

All three room helpers return `{ roomRemaining, annualLimit, used, usedByKind: { regular, manual }, warnings: string[] }`; `ROOM_OVER_CONTRIBUTION` is pushed to `warnings[]` (never thrown).

#### Task 3.2 — Service + routes: registered

`savings-service.ts`: `listAccounts/createAccount/updateAccount/deleteAccount`, `addTransaction/deleteTransaction` (transaction adjusts `balance_cents`), `getRoom(accountId, year)`, `applyRegularContribution(accountId, year, month)`. `routes/savings.ts`: registered CRUD + `POST /:id/transactions`, `DELETE /:id/transactions/:txId`, `GET /:id/room?year=`, `POST /:id/apply-regular` (body `{year,month}`).

- **User-entered limits/room:** `createAccount`/`updateAccount` accept `starting_room_cents` (this-year available room), `annual_limit_override_cents` (optional this-year limit override), `prior_earned_income_cents`, `pension_adjustment_cents`, and `regular_contribution_cents` (monthly employer-matching amount). Zod: all optional `z.number().int().min(0)`.
- **Contribution kinds (user requirement):** `addTransaction` accepts `kind: z.enum(['regular','manual']).default('manual')` and `type: z.enum(['contribution','withdrawal'])`. Both kinds count toward `used` in room math; `usedByKind` splits them.
- **`applyRegularContribution` (idempotent):** inserts a `registered_transactions` row `{type:'contribution', kind:'regular', amount_cents: account.regular_contribution_cents, period: 'YYYY-MM'}` for the month and increments `balance_cents`. Guarded by the `registered_tx_regular_period_idx` partial unique index — re-applying the same month is a no-op (`INSERT OR IGNORE`; return whether a row was created). No-op if `regular_contribution_cents` is null. Explicit user action (ADR A9 intentionality — never silent).

**IDOR guard (CRITICAL):** `registered_transactions` FK is only `account_id → registered_accounts`; the `:householdId` URL param alone does not scope it. Every `addTransaction`/`deleteTransaction`/`getRoom`/`updateAccount`/`deleteAccount` must first load the account and assert `registered_accounts.household_id === householdId` (throw `NotFoundError` otherwise) AFTER `checkHouseholdAccess`. A member of household A passing an account id from household B must get `NOT_FOUND`.

#### Task 3.3 — FE registered

- `SavingsRegistered` pushed screen (`navigation/types.ts:70` + `BudgetNavigator.tsx` + `index.ts`): per-member account cards (balance, room-used bar showing the regular/manual split, log contribution), RRSP deadline banner (first 60 days of year).
- **Setup form — user enters THIS YEAR's room/limit (user requirement):**
  - RRSP: primary "RRSP deduction limit from your NOA" → `starting_room_cents`; advanced (collapsible) prior earned income + pension adjustment (display-only once NOA room is entered — see Task 3.1); optional "This year's RRSP dollar limit" → `annual_limit_override_cents` (prefilled from the CRA constant, editable).
  - TFSA: primary "Your TFSA contribution room (from CRA My Account)" → `starting_room_cents`; optional "This year's TFSA limit" → `annual_limit_override_cents` (prefilled).
  - Optional "Regular monthly contribution (e.g. RRSP employer matching)" → `regular_contribution_cents`.
  - Disclaimer copy: "Estimate only — verify on CRA My Account."
- **Log contribution:** amount + a **Regular / Manual** toggle (`kind`) + contribution/withdrawal selector. "Apply this month's regular contribution" button → `savingsApi.applyRegularContribution(accountId, { year, month })` (idempotent; shows a checkmark / disables once applied for the month). Every registered mutation (`addTransaction`, `deleteTransaction`, `applyRegularContribution`, account create/update/delete) must bump `savingsStore.dataRevision` so the account card room bar + Dashboard headroom (IP5) refetch.
- Entry point: "Registered accounts →" link from `SavingsGoalsView` (secondary) + a **Settings row (primary)** — keeps Phase 3 independent of Phase 2.

#### Task 3.4 — Tests (Phase 3)

`backend/src/services/__tests__/savings-limits.test.ts`: TFSA + RRSP + FHSA room math incl. the correctness paths — **RRSP NOA path does NOT subtract PA** (a PA-bearing account with an NOA figure returns `starting_room − used`, not minus PA); **RRSP from-scratch path** subtracts PA once; **TFSA does NOT add current-year withdrawals** (a same-year withdrawal leaves room unchanged); **user `annual_limit_override_cents` overrides** the CRA constant; `usedByKind` splits regular vs manual; FHSA lifetime-cap warning; **unconfigured tax year (e.g. 2027 with no `SAVINGS_LIMITS` entry) throws `VALIDATION_ERROR`**; over-contribution warning surfaces in `warnings[]` (assert response shape, not just status). Route tests in `savings.test.ts`: transaction adjusts balance; `kind='regular'` vs `'manual'` both count toward `used`; **`applyRegularContribution` is idempotent** (apply same month twice → one row, balance moves once); **cross-household IDOR** (member of A + account id from B → `NOT_FOUND`); 401/403 scoping.

---

### Phase 4 — Intelligence & polish

**Goal:** Recurring income templates, AI insight hook, iPad polish. **Pre-condition:** Phases 1–2 deployed. **Deploy-after:** Worker + RN.

#### Task 4.1 — Income templates
Service + routes for `savings_income_templates` CRUD + `POST /savings/income/apply-templates {year,month}` (idempotent — one entry per template per month, mirror `applyRecurringPayments`). **Idempotency backing (C1):** `applyTemplates` inserts each generated `savings_income_entries` row tagged `{ template_id, period:'YYYY-MM' }` with `INSERT OR IGNORE`, relying on the partial unique index `savings_income_template_period_idx (template_id, period) WHERE template_id IS NOT NULL` (Task 0.1). Without these columns/index a re-tap would double-insert income and double net/YTD — this must NOT be shipped as a plain `INSERT`. Returns `{ created, skipped }`. FE: on Savings month open with no income + active templates → prompt "Apply recurring income for {Month}?" (ADR A9 — explicit confirm, never silent). Bump `savingsStore.dataRevision` on apply so the overview/income view refetch (per IP3/IP5). This is also where `is_recurring` income surfaced by an AI import (Task 5.2) is converted into a managed template.

#### Task 4.2 — AI insight hook
Extend budget insights (or a savings-specific note) to surface one spending→savings tradeoff, e.g. "Cutting Other by $500 reaches your TFSA room by December." Route through the existing AI provider abstraction (`backend/src/ai/provider.ts`) — no direct SDK calls. Optional/low-priority.

#### Task 4.3 — iPad polish
Match Budget iPad patterns: `useDeviceType` + centered-sheet (`BudgetSpendingsView.tsx:24,98-99`) and `AdaptiveContainer` (in the parent `BudgetScreen.tsx:8,44` — NOT in `BudgetSpendingsView`).

#### Task 4.4 — Tests (Phase 4)

- `backend/src/routes/__tests__/savings.test.ts` (extend): income-template CRUD; **`apply-templates` idempotency (C1)** — apply the same `{year,month}` twice → exactly one `savings_income_entries` row per template (assert `skipped` on re-apply, and that net/YTD do NOT double); household scoping (403 non-member); 401 unauthenticated.
- FE: `SavingsIncomeView` "Apply recurring income for {Month}?" prompt renders and calls `apply-templates` once (button disabled while in flight).

**Deferred (Known Gaps §12):** credit-card / debt snapshot; per-member private income; multi-currency.

---

### Phase 5 — Monthly Payments (recurring spending) & AI Data Import

**Goal:** (1) a first-class **Monthly Payments** recurring-spending model (the second tab of the user's spreadsheet — Hydro, Cell, Internet, insurances, subscriptions, mortgages…) with an idempotent apply-to-month; (2) an **upload → AI-extract → review/confirm → commit** pipeline that turns an uploaded spreadsheet / photo / PDF / pasted text (incl. Google Drive) into income entries, spending, and recurring payments — **never silent-saving**. This is the path that replaces the user's external spreadsheet in one import.
**Pre-condition:** Phase 1 deployed (income/spending/categories exist). Phases 2–4 NOT required — import writes income as `savings_income_entries` (Phase-1 table), not Phase-4 templates; it only produces a registered-account draft section if Phase 3 shipped (else skips it).
**Deploy-after:** Worker + RN.
**Kill switch:** a **second** `CONFIG_KV` flag `savings_import_enabled` gates only the import routes (main `savings_enabled` still gates the whole surface). AI import off → manual entry + Monthly Payments still work (runbook §10.1 R4).

#### Task 5.1 — Recurring "Monthly Payments" service + routes

`savings-service.ts` add `listRecurringPayments/createRecurringPayment/updateRecurringPayment/deleteRecurringPayment` (+ `checkHouseholdAccess` each; client-UUID PK + `INSERT OR IGNORE` per W2) and `applyRecurringPayments(householdId, userId, year, month)`.
- `applyRecurringPayments`: for each `active` recurring payment, insert one `savings_spending_entries` row `{ recurring_payment_id, period:'YYYY-MM', spending_date:'<year>-<month>-<day_of_month || 01>', category_id, label, amount_cents }`. **Idempotent** via `savings_spending_recurring_period_idx` (`INSERT OR IGNORE`); returns `{ created, skipped }`. Explicit user action (ADR A9 — "Apply monthly payments for {Month}?" confirm, never silent).
- `routes/savings.ts`: `GET/POST /savings/recurring-payments`, `PATCH/DELETE /savings/recurring-payments/:id`, `POST /savings/recurring-payments/apply` (body `{year,month}`). Zod: `amount_cents` int ≥0; `day_of_month` int 1..31 nullable; `group_label`/`category_id` optional; `is_essential`/`active` bool.
- **Thin client (IP8):** `GET` returns a computed view model `{ items, totalMonthlyCents, byGroup: [{ group_label, subtotalCents }] }` — the BE computes the TOTAL and per-group subtotals (mirroring the spreadsheet's "Mortgages / Other / TOTAL" rows); the FE renders them, it does NOT sum client-side.
- Applied rows are normal spending, so they flow into `getOverview` spending **and** the emergency-fund essential baseline automatically — no extra wiring. Mark essential recurring payments (`is_essential`) so the Safety-Pillow baseline (Task 2.1) picks them up.

#### Task 5.2 — AI import service `backend/src/services/savings-import-service.ts` (new)

`Type: new`. **Mirror `backend/src/services/budget-suggestion-service.ts` structurally.** **Produces:** `SavingsImportService`, `SavingsImportDraft`. **external:** provider abstraction (`ai/provider.ts`), `generateStructuredWithFallback` (`ai/fallback.ts`), `ClaudeProvider` default, R2 `REPORTS_BUCKET`, models `env.AIHOUSEKEEPER_NUDGE_MODEL` (primary `claude-haiku-4-5-20251001`) / `env.AIHOUSEKEEPER_FALLBACK_MODEL` (fallback `claude-sonnet-4-5-20250929`). Constructor `(env, d1, aiProvider?)` — provider injectable for tests (mirror `budget-suggestion-service.ts:54-58`).

Methods:
- `createJob(householdId, userId, { sourceKind, file?: {data:ArrayBuffer, mimeType, name}, text? })`: for a file, `REPORTS_BUCKET.put('savings-imports/{householdId}/{jobId}/{safeName}', data, { httpMetadata:{ contentType } })` + SHA-256 `content_hash` (mirror `aihousekeeper-attachments.ts` dedup); insert a `savings_import_jobs` row. Returns `{ jobId }`.
- `analyze(householdId, userId, jobId)`: load job. **All extraction logic is server-side (thin-client rule, IP8).** **Document read — MANDATORY via the provider abstraction (hard rule — NO direct `@anthropic-ai/sdk` from a service):**
  - **CSV** → parse **deterministically** in the Worker (header-detect + row-map); do NOT send CSV to the model — pass parsed rows to the structuring step for *semantic* classification only (cheaper, removes a transcription-error surface).
  - **plain text (paste)** → straight to structuring (no read step; no grammar to exploit).
  - **images** → **server-side downsample first** to ≤1568 px / ≤1.15 MP (Anthropic rejects images >8000 px; downsampling also cuts time-to-first-token), then `provider.generate()` with an `{type:'image',source:{type:'base64',…}}` block.
  - **PDF** → **reject >100 pages up front** with `IMPORT_TOO_LARGE` ("split into ≤100-page sections") — Anthropic caps PDFs at 100 pages for 200K-context models, so a large sheet-PDF fails on BOTH Haiku 4.5 and Sonnet 4.5 — then `ClaudeProvider.processPDFDirect`.
  - **Read model = Sonnet** (`env.AIHOUSEKEEPER_FALLBACK_MODEL`, `claude-sonnet-4-5-20250929`), NOT Haiku, for the vision/PDF read: financial-table extraction accuracy is the highest-value axis (a mis-read income row → wrong tax math). Haiku stays the cost path for the *structuring* step only. (ADR A16 — deliberate cost/accuracy split.)
  Do NOT replicate budget's legacy direct-SDK `extractSpendingTextFromDocument` call. Then structure via `generateStructuredWithFallback<SavingsImportDraft>(provider, nudgeModel, fallbackModel, { systemPrompt, userPrompt, schema: SAVINGS_IMPORT_SCHEMA, maxTokens: 16384 })` — raised from the budget service's ~2K default (a full 12-month × multi-member sheet can exhaust a smaller cap mid-JSON). **Post-structure validation:** `generateStructured` returns `toolBlock.input as T` with no runtime parse — after the call succeeds, run a **structural Zod parse** of the draft (same shape as the commit schema, non-strict field bounds OK) before persisting `draft_json`; on parse failure set `status:'failed'` + `IMPORT_PARSE_FAILED` (prevents malformed drafts from crashing the review UI). **Truncation contract (C-1 — implementable against the SHIPPED abstraction):** `generateStructured`/`generateStructuredWithFallback` (`ai/provider.ts:192`, `ai/fallback.ts:102`) return the tool_use `input` and **discard `stopReason`**; on a real `max_tokens` cutoff the tool block is partial/absent and the call **throws** (`MalformedGenerateJSONError`). So do NOT branch on `stopReason==='max_tokens'` (never observable) — instead **catch the throw**, set `status:'failed'` + `error` code `IMPORT_PARSE_FAILED` with the user message "the document was too large to extract in one pass — split the file / import fewer months," and **never persist partial JSON**. (Surfacing a precise `truncated` flag would require extending `provider.ts` to return `stopReason` — deferred; the caught throw already guarantees no partial write.) **Prompt-injection defense:** the uploaded doc is untrusted — the system prompt declares it *data to extract from* and that any instructions inside it must be ignored; the output-schema tool-use already constrains what an injection can emit (schema fields only). Persist `draft_json`, `status:'ready'`. On failure set `status:'failed'` + `error`.
- `commit(householdId, userId, jobId, selections)`: **reject re-commit of a job already `status:'committed'`** (return the prior counts — idempotent no-op), THEN write the user-confirmed subset — **all income → `savings_income_entries`** for the stated month (Phase-1-managed, fully editable), spending → `savings_spending_entries`, recurringPayments → `savings_recurring_payments` (`source:'ai_import'`). **Cross-phase decision (Cycle 3):** import does NOT create `savings_income_templates` rows — that table's management UI is Phase 4, so writing templates here would orphan them if Phase 5 ships first. Instead the review UI flags `is_recurring` income with a "set up as monthly (Phase 4)" hint; template creation happens only via Task 4.1 once Phase 4 ships. This keeps Phase 5's only hard dependency at **Phase 1**. Resolve `member_name`→`household_members.id` by **joining `household_members` → `users` and matching `users.display_name`** case-insensitively (fallback: email local-part, then null) — there is NO name column on `household_members`; mirror `resolveAssignee` in `backend/src/services/ai/task-enrichment-handler.ts:488-503`. Resolve `category_name`→existing `savings_categories.id` or create. Each insert uses a **deterministic** row id derived from `(jobId, entity, index)` (NOT a fresh `crypto.randomUUID()`) + `INSERT OR IGNORE` — so a double-tap on "Save to Savings" cannot double-insert even before the status flips. Set `status:'committed'`. **R2 retention (A14 default):** delete the R2 object on successful commit (same as `deleteJob`) — v1 has no "keep upload" toggle; financial PII must not accumulate indefinitely. Returns created counts per entity.
- `getJob`, `deleteJob` (also deletes the R2 object).

```ts
interface SavingsImportDraft {
  income: Array<{ member_name: string | null; source_type: 'payroll'|'rental'|'rrsp_matching'|'tax_refund'|'insurance'|'other'; label: string; amount_cents: number; income_date: string; is_recurring: boolean; day_of_month: number | null }>;
  spending: Array<{ category_name: string | null; label: string; amount_cents: number; spending_date: string }>;
  recurringPayments: Array<{ label: string; amount_cents: number; category_name: string | null; day_of_month: number | null; group_label: string | null; is_essential: boolean }>;
}
```

**Risk:** wrong/garbage extraction. Mitigation: draft-then-confirm (never silent-commit) + `savings_import_enabled` kill switch (§10.1 R4). **PII:** uploaded financial docs are PII — store under the household-scoped R2 prefix, never log `raw_text`/`draft_json`, and ensure the persisted `error` column + any `[savings-import]` log line carry only a bounded error CODE/message, **never extracted source-doc content** (a parse-failure message must not echo the document). Delete the R2 object on `deleteJob` and after a committed job unless the user opts to retain.

#### Task 5.3 — AI prompts (mirror budget prompts)

- `backend/src/ai/prompts/extract-savings-document.ts` (new, clone `extract-budget-document.ts`): read a household budget spreadsheet / bank export / photo → **plain text** of income rows (member, source, amount, date), spending rows, and recurring monthly payments; "do not invent amounts"; empty string if none.
- `backend/src/ai/prompts/suggest-savings-import.ts` (new, clone `suggest-budget-items.ts`): exports `SAVINGS_IMPORT_SCHEMA` (JSON Schema for `SavingsImportDraft`), `SAVINGS_IMPORT_SYSTEM_PROMPT`, `buildSavingsImportUserPrompt({ text, today, categoryNames, memberNames })`. Amounts in cents; `source_type` enum; dates resolved to `YYYY-MM-DD` against `today`; `category_name`/`member_name` verbatim from supplied lists or null; end with "Always return via the 'output' tool."

#### Task 5.4 — Import routes wiring & kill switch

`routes/savings.ts` add (behind `authMiddleware` + `savings_enabled`, plus a `savings_import_enabled` check on the import subgroup → 404 when disabled):
// DO NOT use rateLimit() on import routes — in-memory Map, per-isolate only (§10). Use RATE_LIMITER DO if adding limits.
- `POST /savings/import` — multipart (`await c.req.formData()`, mirror `budget.ts:246-306`): allowlist `SAVINGS_DOCUMENT_MIMES = ['application/pdf','image/jpeg','image/png','image/webp','text/csv','text/plain']`. **Size cap = 20 MB for the inline-base64 path** (NOT 32 MB): base64 inflates ~33%, and Anthropic's Messages-API *request* cap is 32 MB, so a 32 MB file → ~43 MB base64 → `413`. 20 MB × 1.33 ≈ 27 MB < 32 MB is safe. v1 rejects >20 MB with `IMPORT_TOO_LARGE`; the **Files API** (`files-api-2025-04-14`, 500 MB, reference by `file_id`) is the documented path to lift this and is the recommended v1.1 (§12). PDF page guard (>100 → `IMPORT_TOO_LARGE`) and image downsample happen in `analyze` (Task 5.2). OR JSON `{text}`; runs `createJob`+`analyze` synchronously; returns `{ jobId, draft }`. (xlsx unsupported — user exports CSV/PDF or screenshots; §12.)
  - **⚠️ Workers runtime (A18, CORRECTED Cycle 6):** the earlier "~30s HTTP wall-time" premise was **wrong** (verified against Cloudflare docs). Facts: (a) **HTTP-triggered Workers have NO wall-clock limit** — "as long as the client stays connected, the Worker can keep processing, making subrequests, and streaming"; (b) the real ceiling is **CPU time** (default **30s**, raise to **5 min** on Paid via `limits.cpu_ms` in `wrangler.toml`); (c) **awaited I/O does NOT count against CPU** — the long `await fetch()` to Anthropic burns ~0 CPU; only your own base64/JSON work does. So a **buffered `return c.json(...)` after a multi-minute Anthropic read is safe Worker-side.** The genuine constraints are: (1) the **FE `api.upload` 2-min timeout** (`src/api/client.ts:165`) — a read longer than 2 min makes the *client* give up on a job the Worker finishes → mitigated by W4 polling (Task 5.5); (2) Anthropic's **10-min non-streaming SDK limit** (a non-issue at `maxTokens:16384`); (3) client/edge **idle-connection** drops on a long silent wait. **Decision (v1):** keep images / CSV / plain-text / small PDFs (≤10 pages) fully synchronous + **buffered** (the shipped budget `ai-detect-upload` is itself buffered `c.json`, `budget.ts:298`); rely on **W4 FE polling** for reads that outrun the 2-min client timeout; hard-cap the synchronous PDF path at ≤10 pages and route larger PDFs to the v1.1 Files-API **async** path (§12). Streaming the response body is an **optional** resilience upgrade — do NOT block v1 on it, and do NOT assume `generateStructured` can stream (it cannot — C-1). Set `limits.cpu_ms` explicitly only if a synchronous read ever does heavy local parsing.
- `GET /savings/import/:jobId` → `{ job, draft }`.
- `POST /savings/import/:jobId/commit` (body `{ selections }`) → created counts. **The `selections` payload is untrusted** (AI-generated, user-edited client-side) and writes to financial tables — validate it server-side with a **closed** Zod schema (`.strict()` / `additionalProperties:false`) enumerating **every** `SavingsImportDraft` field: `source_type` `z.enum(['payroll','rental','rrsp_matching','tax_refund','insurance','other'])`, `amount_cents` `z.number().int().min(0).max(<sane_ceiling>)` (reject absurd/negative amounts — prompt-injection domain-bound), `label`/`member_name`/`category_name`/`group_label` bounded-length strings, `day_of_month` `z.number().int().min(1).max(31).nullable()`, `is_recurring`/`is_essential` bool, dates `regex(/^\d{4}-\d{2}-\d{2}$/)`. Never trust the draft server-side just because our own `analyze` produced it (a row value can carry adversarial text from the source doc).
- `DELETE /savings/import/:jobId`.
- **IDOR:** every import route asserts `savings_import_jobs.household_id === :householdId` after `checkHouseholdAccess` (same guard as registered accounts, Task 3.2).
- No `wrangler.toml` change: `ANTHROPIC_API_KEY`, `AIHOUSEKEEPER_NUDGE_MODEL`, `AIHOUSEKEEPER_FALLBACK_MODEL`, `REPORTS_BUCKET`, `CONFIG_KV`, `DB` already exist for all envs (`backend/src/types/index.ts:7,10,13,58,72-74`; model values set in `wrangler.toml:21-22` default, `:167-168` staging, `:282-283` production). **Model IDs (✅ verified real & current at canada-agnostic Anthropic docs, 2026-07):** `AIHOUSEKEEPER_NUDGE_MODEL = claude-haiku-4-5-20251001`, `AIHOUSEKEEPER_FALLBACK_MODEL = claude-sonnet-4-5-20250929` — both are genuine dated snapshots (Standard 1568px image tier). **⚠️ Model currency (Cycle 6):** `claude-haiku-4-5-20251001` is current; `claude-sonnet-4-5-20250929` still works but is now in Anthropic's **Legacy** list (docs suggest migrating — current tier is **Sonnet 5**, 1M context, which would also lift the PDF read cap from 100→**600** pages). These are **shared app-wide env vars** (`AIHOUSEKEEPER_*`), so any bump is an app-level config decision, not a savings-only change — the plan inherits whatever the env var holds; no code change required for v1. Anthropic limits used in A16/A18 (32 MB request cap, 100-page PDF for 200k-context models, 8000px image reject / 1568px-1.15MP target, `files-api-2025-04-14` / 500 MB, streaming only required when the SDK estimates a non-streaming call >10 min — a non-issue at `maxTokens:16384`) are all confirmed against `docs.anthropic.com`.

#### Task 5.5 — FE: Monthly Payments screen + AI import screen

- `src/api/savings.ts` add: recurring-payments CRUD + `applyRecurringPayments`; `importAnalyze(text)`, `importAnalyzeWithFile({uri,type,name})` (via `api.upload` multipart — mirror `src/api/budget.ts:379-395`), `importGet/importCommit/importDelete`.
- `src/screens/budget/savings/SavingsRecurringPaymentsScreen.tsx` (new pushed screen): Monthly Payments list mirroring the sheet (label + amount, grouped by `group_label`, essential badge, active toggle), add/edit/delete, "Apply to {Month}" (confirm) → `applyRecurringPayments`. Reachable from the Savings **Spending** sub-tab.
- `src/screens/budget/savings/SavingsImportScreen.tsx` (new pushed screen, **mirror `src/screens/budget/BudgetItemAIScreen.tsx`**): text box + Gallery / File / Google-Drive attach — reuse `CloudFilePicker` (`provider="google-drive"` → local `{uri,name,size}`), `ImageCropPicker.openPicker` (`@services/image-picker-compat`), `DocumentPicker.getDocumentAsync` (`expo-document-picker`). **SDK-54 note:** the compat shim must use the array `MediaType[]` API (singular `mediaTypes` enum is deprecated in Expo 54) and call `requestMediaLibraryPermissionsAsync()` before opening the picker — reuse the shim as `BudgetItemAIScreen` already does, don't re-wire the picker. Check the returned file size client-side against the 20 MB import cap before upload. "Analyze" → `importAnalyzeWithFile`/`importAnalyze`; grouped review UI (Income / Spending / Monthly Payments — each row include/exclude toggle + inline edit of amount/category/member); "Save to Savings" → `importCommit`. **Client timeout recovery (W4):** the `api.upload` timeout is 2 min (`src/api/client.ts:165`) but a long Sonnet PDF/vision read can outlast it — the Worker keeps running and flips the job to `ready`. On a client timeout do NOT treat it as terminal: poll `GET /savings/import/:jobId` (a few times, backing off); if the job reached `ready`, show the draft; if still `analyzing` after the poll window, surface "still processing — reopen shortly." (Per the corrected A18, Workers have no HTTP wall-time, so **buffered + this polling IS the v1 primary recovery**; server-side streaming is an optional resilience add-on, not the primary fix.)
- Nav: register `SavingsImport` + `SavingsRecurringPayments` in `src/navigation/types.ts` (`BudgetStackParamList`) + `src/navigation/BudgetNavigator.tsx` (mirror `BudgetItemAI`, `BudgetNavigator.tsx:82-83`); export via `src/screens/budget/index.ts`.
- `savingsStore.dataRevision` bump on `importCommit` and `applyRecurringPayments` (IP3/IP5 — refresh overview + headroom card).

#### Task 5.6 — Tests (Phase 5)

- `backend/src/routes/__tests__/savings.test.ts`: recurring-payments CRUD; `applyRecurringPayments` idempotency (apply twice → one row per payment per month); import 401/403/IDOR; `savings_import_enabled` kill-switch 404; the three import error codes per §6.4 (`UNSUPPORTED_FILE_TYPE`; `IMPORT_TOO_LARGE` for both >20 MB and >100-page PDF; `IMPORT_PARSE_FAILED`).
- `backend/src/services/__tests__/savings-import-service.test.ts` (new; inject a stub `aiProvider` returning a fixed `SavingsImportDraft` — **no real Anthropic call**): `commit` writes ALL income→`savings_income_entries` (recurring flagged, NOT written as templates in Phase 5), spending→entries, recurringPayments→`savings_recurring_payments`; resolves member/category names; idempotent on re-commit (deterministic id); **truncation path** — stub `aiProvider` **throws** (simulating a `max_tokens` cutoff → `MalformedGenerateJSONError`) → job set `status:'failed'` with `IMPORT_PARSE_FAILED`, NOT committed, **zero partial rows written** (assert no `savings_*` rows created); CSV deterministic-parse path performs no model call.
- `src/screens/budget/savings/__tests__/SavingsImportScreen.test.tsx` + `SavingsRecurringPaymentsScreen.test.tsx`.

**Verification:** upload the "Master Household Budget" export → review draft shows income (Andrei/Ann payroll, RRSP matching, rent, tax refund) + spending + Monthly Payments (Hydro/Cell/Internet/…); confirm → rows appear in Savings; "Apply monthly payments for {Month}" populates that month's spending once (re-tap is a no-op).
**Rollback:** `savings_import_enabled=false` disables import (manual entry + Monthly Payments unaffected); RN revert.

---

## §5 Affected Files

| File | Type | Change | Phase | Risk |
|------|------|--------|-------|------|
| `backend/migrations/0067_savings_tables.sql` | new | 9 tables | 0 | Med |
| `backend/src/db/schema-savings.ts` | new | Drizzle defs | 0 | Med |
| `backend/src/services/savings-service.ts` | new | cashflow+goals+registered | 1/2/3 | High |
| `backend/src/routes/savings.ts` | new | Hono routes | 1/2/3 | Med |
| `backend/src/services/savings-limits.ts` | new | CRA limits + room (user override, regular/manual) | 3 | Med |
| `backend/src/workers/savings-alert-worker.ts` | new | behind-pace cron (uses `sendNotification`) | 2 | Low |
| `backend/src/services/savings-import-service.ts` | new | AI import (mirror `budget-suggestion-service.ts`) | 5 | High |
| `backend/src/ai/prompts/extract-savings-document.ts` | new | vision/PDF read (clone `extract-budget-document.ts`) | 5 | Med |
| `backend/src/ai/prompts/suggest-savings-import.ts` | new | structured-extract schema (clone `suggest-budget-items.ts`) | 5 | Med |
| `backend/src/index.ts` | edit | mount route (~L352, import ~L29) + cron (~L616) | 1/2 | Med |
| `backend/src/routes/__tests__/savings.test.ts` | new | BE route tests (incl. recurring + import) | 1-3/5 | Low |
| `backend/src/services/__tests__/savings-limits.test.ts` | new | room math tests | 3 | Low |
| `backend/src/services/__tests__/savings-import-service.test.ts` | new | import commit/mapping tests (stub provider) | 5 | Low |
| `src/api/savings.ts` | new | axios client | 1 | Low |
| `src/api/index.ts` | edit | export types (~L143 pattern) | 1 | Low |
| `src/stores/savingsStore.ts` | new | UI store (+markDirty) | 1 | Low |
| `src/stores/budgetStore.ts` | edit | add `'savings'` to activeView (L28,L43) | 1 | Low |
| `src/screens/budget/BudgetScreen.tsx` | edit | Savings FilterTab + onTabChange cast (L45-53,L52) + kill-switch probe | 1 | Low |
| `src/screens/budget/savings/*` | new | Savings views + forms (SavingsView, SavingsOverviewView, SavingsIncomeView, SavingsSpendingView, SavingsGoalsView, SavingsGoalForm, SavingsEntryForm, SavingsRegistered, **SavingsRecurringPaymentsScreen**, **SavingsImportScreen**) | 1/2/3/5 | Med |
| `src/screens/budget/BudgetDashboardView.tsx` | edit | headroom card | 2 | Low |
| `src/screens/budget/index.ts` | edit | exports | 1/2/3 | Low |
| `src/navigation/types.ts` | edit | BudgetStackParamList (L70) | 1/2/3 | Low |
| `src/navigation/BudgetNavigator.tsx` | edit | register pushed screens | 1/2/3 | Low |
| `src/services/notificationRouting.ts` | edit | `savings_pace` route (~L270 pattern) | 2 | Low |
| `src/services/navigation.ts` | edit | `navigateToBudget` accepts `activeView`/sub-tab (L166-168) | 2 | Low |
| `src/screens/budget/savings/__tests__/*` | new | FE tests | 1-3 | Low |
| AI insight hook (Phase 4.2) | edit | via `backend/src/ai/provider.ts` abstraction | 4 | Low |
| iPad polish (Phase 4.3) | edit | `SavingsView` + children (useDeviceType/AdaptiveContainer) | 4 | Low |

**Must NOT change:** `budget-service.ts` affordability logic (`budget-affordability.ts`), `budget_goals` semantics, `node_modules`, `ios/Pods`. (`src/App.tsx` was removed from the repo — nothing to protect; entry is `app/_layout.tsx`.)

---

## §6 Test Strategy

- **§6.1 Unit (Vitest BE):** overview net math; Home-from-Budget rollup equals `SUM(expenses)`; ytdNet (single grouped query); emergency-fund suggestion (+ no-history guard); RRSP room (NOA path does NOT subtract PA / from-scratch path subtracts PA once); TFSA room (no same-year withdrawal add-back; user room + `annual_limit_override` honored); FHSA lifetime cap; **unconfigured tax year → `VALIDATION_ERROR`** (`requireLimitsForYear`); pace recompute (monthsRemaining clamp); recurring-payment apply idempotency; import `commit` entity mapping (stub provider); import draft structural Zod parse after `generateStructured`.
- **§6.2 Integration (Workers pool):** each route 200 happy-path + 403 non-member + 404 kill-switch (both `savings_enabled` and `savings_import_enabled`; incl. exact-string cases: absent→200, `'false'`→404, `'FALSE'`→200); registered transaction adjusts balance (regular + manual); `applyRegularContribution` idempotent; `applyRecurringPayments` idempotent.
- **§6.3 E2E:** add income+spending → net updates; create emergency fund goal → headroom card; add RRSP account + contribution → room decreases; **AI import**: upload a sheet → review draft → confirm → income/spending/monthly-payments rows created; "Apply monthly payments" populates the month once (re-tap no-op).
- **§6.4 Error-code matrix:** `401 UNAUTHORIZED`→no-token test (mirror `budget.test.ts:12`); `VALIDATION_ERROR`→zod test (incl. bad enum, bad `kind`); `FORBIDDEN`→non-member test; `NOT_FOUND`→bad id test **+ cross-household account/import-job id (IDOR)**; `ROOM_OVER_CONTRIBUTION`→assert warning present in `warnings[]` response body (not a status code); `UNSUPPORTED_FILE_TYPE` / `IMPORT_TOO_LARGE`→bad-mime / >20 MB upload / >100-page PDF; `IMPORT_PARSE_FAILED`→stub provider throws (`MalformedGenerateJSONError`, simulating a `max_tokens` cutoff) → job `status:'failed'`, surfaced without a 500 crash (no `truncated` status exists — C-1).

---

## §7 Risk Assessment

| Risk | Prob | Impact | Mitigation | Rollback |
|------|------|--------|------------|----------|
| Migration/Drizzle column drift | Med | High | Reviewer A DDL-direction check; typecheck | Fix migration, re-run local |
| Double-counting home spend | Low | High | Model A (rollup only, no insert) | n/a |
| Wrong CRA room estimate | Med | Med | NOA-first input; disclaimer; ⚠️ verify limits | ship Phase 3 behind review |
| 5-tab crowding | Low | Low | Savings sub-tabs; scrollable FilterTabs | — |
| Old client + new Worker | Low | Low | additive tables/routes; kill switch | flip flag |

---

## §8 Deployment Plan

1. **BE migration (Task 0.3, gates everything):** `cd backend && npm run db:migrate` (local) → `npm run db:migrate:remote -- --env staging` → `npm run db:migrate:remote -- --env production`. **Confirm 9 tables present per remote env (Task 0.3 smoke SELECT) BEFORE any deploy.** No Worker route deploy to an env whose `0067` is unconfirmed.
2. **BE deploy:** `npm run deploy:staging && npm run deploy:production` (backend-deployment rule — both envs together).
3. **Verify:** `curl .../households/{hid}/savings/overview?year=2026&month=7` returns 200 on staging.
4. **FE:** `eas build` per profile → TestFlight after staging routes confirmed live.
5. **Kill switch:** disable `npx wrangler kv key put --binding=CONFIG_KV savings_enabled false --env production`; **re-enable** `... put ... savings_enabled true` or `... key delete ... savings_enabled --env production` (absent key = enabled). **Phase 5 import** has an independent flag with the SAME lifecycle: disable `... savings_import_enabled false`; re-enable `... put ... savings_import_enabled true` or `... key delete ... savings_import_enabled --env production` (disables only AI import — manual entry + Monthly Payments stay live). **Verify each flip with a curl** (expect `404`): `/savings/overview` for `savings_enabled`, `/savings/import/<jobId>` for `savings_import_enabled`.
6. **Phase 2 cron:** the savings alert dispatches inside the existing `scheduled()` handler and adds **zero** new cron triggers (Task 2.4). Live delivery is blocked only because the whole cron block is currently **commented out** in `wrangler.toml` (staging `:259-262`, production `:385-388`) — re-enabling it is the ops decision (§12), not a new-slot allocation. Until re-enabled the worker runs only in tests.

Manual steps only — never run `wrangler deploy`/`eas build` from the plan.

---

## §9 Rollback Procedures

- **Per phase:** set `savings_enabled=false` (hides feature end-to-end: routes 404, FE probe hides tab, worker returns early). Re-enable by deleting the key or setting `true`. RN revert to prior build.
- **Phase 2 worker rollback:** remove the savings-alert `if` block from `scheduled()` (or leave the `savings_enabled` guard set to `false`); no data impact.
- **Migration:** additive; forward-only in prod. Pre-launch local: `DROP TABLE` the 9 tables.
- **No data rollback needed** — Savings data is independent of Budget; deleting savings rows never touches `expenses`/`budget_*`.

---

## §10 Monitoring

- Structured logs in `savings-service` errors (mirror `console.error` pattern in budget routes). Tag savings errors with a `[savings]` prefix so they're greppable in `wrangler tail` / the Workers dashboard Logs view.
- Cron log line in `savings-alert-worker` (`console.log` counts, like budget alerts `index.ts:612`).
- Metric to watch: overview route p95 latency. Threshold: <300ms (single-grouped-query `ytdNet`, Task 1.1 step 7).
- **Alarm wiring:** there is no APM in this stack — alerting is the Cloudflare dashboard "Workers Analytics" error-rate panel + a saved Logs filter on `[savings]`. Define the trip condition explicitly: error rate on `/savings/*` >2% over 5 min → investigate (runbook §10.1).
- **AI-import cost (Phase 5):** each import is a vision read on **Sonnet** (`AIHOUSEKEEPER_FALLBACK_MODEL`, accuracy) + a structuring pass on Haiku (`AIHOUSEKEEPER_NUDGE_MODEL`, cost) — a full-year spreadsheet is on the order of a few-thousand input tokens + up to `maxTokens:16384` output; log a `[savings-import]` line per job with `{ jobId, readModel, structureModel, status }` (the read step's `provider.generate()` result carries `stopReason` if you want it, but the structuring step **throws** on truncation rather than exposing it — C-1, so a `stopReason:'max_tokens'` metric isn't available for the structuring pass). Watch for a spike in `IMPORT_PARSE_FAILED` — that is the truncation/parse signal — mitigate via `savings_import_enabled=false` (§10.1 R4). **Rate limiting (W-2):** v1 import has **no per-user server-side rate limit** (accepted risk — cost is monitored via the `[savings-import]` logs + the Cloudflare error-rate panel; draft-then-confirm bounds damage). ⚠️ The repo's `rateLimit()` middleware (`backend/src/middleware/rate-limit.ts`) is an **in-memory `Map`** (per-isolate) and is **banned for multi-isolate endpoints** — do NOT wire it to `/savings/import`. Any limit added later MUST be **`RATE_LIMITER` DO-backed** (or KV-backed), not the in-memory helper (Known Gap §12).
- **Kill-switch verification:** after flipping `savings_enabled=false`, confirm with `curl -s -o /dev/null -w '%{http_code}' .../households/{hid}/savings/overview` → expect `404` (not just "ran the command").

### §10.1 Operational Runbook (top failure modes)

| # | Failure | Detection | Remediation |
|---|---------|-----------|-------------|
| R1 | Overview p95 breach (slow `/savings/overview`) | Workers Analytics latency panel; user reports of slow Savings tab | Confirm `ytdNet` is the single-grouped-query form (not a reintroduced loop); check D1 index usage; if runaway, kill-switch `savings_enabled=false` to shed the hot path while fixing |
| R2 | Wrong room estimate / stale CRA limit | User report; new tax year rollover with no `SAVINGS_LIMITS[year]` entry | `getRoom` must throw a clear `VALIDATION_ERROR` ("limits not configured for {year}") rather than silently using a wrong year; add the year to `SAVINGS_LIMITS` (verify at canada.ca), deploy both envs; disclaimer already shown in UI |
| R3 | Kill-switch propagation delay (tab still visible after disable) | Manual verify curl returns 200 when it should 404 | Expected: KV is eventual-consistent (~60s) and FE caches per-session (relaunch to clear). Confirm the KV key value; wait one propagation window; do not thrash the flag |
| R4 | AI-import produces wrong/garbage extraction (Phase 5) | Import commit rejected by user / support report; `[savings-import]` error logs | Import is draft-then-confirm (never silent-commit) so bad extractions can't corrupt data before user review; if the model degrades, flip `savings_import_enabled=false` (separate KV flag, §Phase 5) to disable AI import while manual entry stays live |
| R5 | Import job stuck non-terminal (`analyzing`/`uploaded`) after a Worker timeout/crash (Phase 5) | `[savings-import]` line with no matching `ready`/`failed`; user reports a spinner that never resolves; jobs older than a few minutes still `analyzing` | Root cause is usually a read that outran the FE 2-min `api.upload` timeout (NOT a Worker wall-time cutoff — Workers have none, corrected A18) — confirm the FE polls `GET /:jobId` (W4) and the ≤10-page synchronous PDF cap holds. To clear: `DELETE /savings/import/:jobId` (also frees the R2 object) and re-run; if systemic, flip `savings_import_enabled=false`. No partial rows are ever written (commit is atomic + `INSERT OR IGNORE`), so a stuck job never corrupts data |
| R6 | Cron re-enablement needed (Phase 2+ budget/savings alerts) | Behind-pace / over-budget alerts never fire; `wrangler.toml` cron blocks commented (staging `:259-262`, production `:385-388`) | Ops: confirm account cron quota (Free=5 account-wide, Paid=250); uncomment the `[env.*.triggers]` cron block in `wrangler.toml`; deploy staging + production together; verify `scheduled()` fires in Workers dashboard Logs; budget-alert + savings-alert both dispatch inside the same handler at 08:00 UTC |

---

## §11 Definition of Done

- Per phase: tasks complete, tests green (`cd backend && npx vitest run`; root `npm test`), typecheck clean both projects, deployed to staging+production. **Phase 2 carve-out:** the behind-pace notification DoD is **worker method + warm-tap routing + unit test green** — live cron delivery is gated on ops re-enabling the commented-out cron block (Task 2.4 / §12); cold-start push replay is a **Known Gap (§12)**, not in v1 DoD; do NOT claim live delivery or cold-start tap routing.
- Overall: user can enter income/spending **manually OR by uploading a file / photo / pasted text / Google-Drive export that AI extracts into a confirmable draft**, manage recurring **Monthly Payments** and apply them to a month, see net + YTD + trend, set a Safety Pillow goal with pace, add TFSA/RRSP/FHSA accounts with **user-entered this-year room + regular/manual contributions**, and see a Budget expense reflected in the Savings "Home (from Budget)" line — all behind `savings_enabled` (import additionally behind `savings_import_enabled`).

---

## §12 Known Gaps & Future Work

Explicitly deferred: credit-card/debt snapshot; per-member private income; multi-currency; bank aggregation; authoritative CRA room via API; **xlsx/Excel binary parsing** (user exports CSV/PDF or screenshots — Claude vision can't read raw xlsx well); **Anthropic Files API path for 20–100 MB uploads** (v1 caps inline base64 at 20 MB and rejects larger with `IMPORT_TOO_LARGE`; Files API `files-api-2025-04-14` referenced by `file_id` is the v1.1 lift); **async/queued import** for very large documents (v1 import is synchronous + **buffered** in the Worker, mirroring budget AI; per the **corrected A18**, Workers have **no HTTP wall-clock limit** and the awaited Anthropic `fetch` burns ~0 CPU, so a buffered read is safe Worker-side — v1 instead caps the synchronous PDF path at ≤10 pages and leans on **W4 FE polling** for reads that outrun the 2-min client timeout, deferring larger PDFs to this async/Files-API path; the robust pattern for genuinely large docs is the repo's existing enqueue→consume→notify job pipeline); native Google-Drive Picker SDK (v1 reuses the existing `CloudFilePicker` OAuth flow); AI import creating **income templates** (Phase 5 imports recurring income as entries; template setup is Phase 4).

Documented limitations of v1:
- **Cron delivery disabled.** The whole `scheduled()` handler is dormant — its cron blocks in `wrangler.toml` are commented out for staging (`:259-262`) and production (`:385-388`), so the existing budget-alert worker doesn't fire either. Re-enabling is an ops decision (Free plan = 5 account-wide cron triggers, Paid = 250; the savings alert adds **zero** new triggers — it dispatches inside the same `scheduled()` handler). Until re-enabled, savings behind-pace worker logic ships + is unit-tested but does not fire in prod. See runbook R6 (§10.1).
- **Cold-start push routing missing app-wide.** Data-only pushes (`data.type` routing) are handled on **warm** taps via `addNotificationResponseReceivedListener` → `routeNotificationTap` → `router.push`. There is **no** `getLastNotificationResponseAsync` / `useLastNotificationResponse` handler in `src/` today — so a tap that cold-launches the app does not route for `budget_alert` or `savings_pace`. Phase 2 ships warm-tap routing only; fixing cold-start is a separate app-wide task (add `useLastNotificationResponse()` in the root layout).
- **FHSA per-year room deferred.** v1 tracks FHSA balance + enforces the $40,000 lifetime cap only; annual $8,000 + carryforward (max $16,000/yr) room accounting is deferred (Task 3.1).
- **Manual double-count.** Model A prevents automatic Budget→Savings duplication, but a user can still manually enter a home cost in both Budget `expenses` and `savings_spending_entries`. No dedup; surfaced as a UI hint only.
- **FHSA room** may ship balance-only if 2026 limits aren't verified (Task 3.1).
- **CRA limits** are ⚠️ Unverified constants; verify each tax year.

---

## §13 Summary

| Phase | Focus | BE | FE | Status |
|-------|-------|----|----|--------|
| 0 | Migration + schema | ✎ | — | Planned |
| 1 | Cashflow MVP | ✎ | ✎ | Planned |
| 2 | Goals + Safety Pillow | ✎ | ✎ | Planned |
| 3 | Registered TFSA/RRSP/FHSA (user limits + regular/manual) | ✎ | ✎ | Planned |
| 4 | Templates + AI insight + iPad | ✎ | ✎ | Planned |
| 5 | Monthly Payments + AI data import | ✎ | ✎ | Planned |

---

## Revision History

**v1.7 — 2026-07-03** — Review Cycle 7 (3 agents; paired TRD v1.6). Codebase-accuracy agent re-confirmed **zero** broken claims (all anchors, columns, symbols, TRD↔IP parity). Safety agent surfaced documentation gaps — all resolved in-body:
- **CRITICAL (cold-start routing scope):** verified no `getLastNotificationResponse` / `useLastNotificationResponse` in `src/` — promoted from Task 2.4 caveat to explicit **§12 Known Gap**; §11 DoD now says warm-tap routing only (cold-start is out of v1 scope).
- **WARNING:** Task 3.1 adds `requireLimitsForYear` guard + Task 3.4 test; Task 5.2 adds post-`generateStructured` structural Zod parse + explicit R2 delete-on-commit default; Task 1.2/5.4 adds in-memory `rateLimit()` ban comment; Task 2.4 adds optional `navigateToBudget` param + caller-audit note; §6.1/§6.2/Task 1.5 add kill-switch exact-string test matrix; §10.1 adds R6 cron re-enable runbook; Task 0.1 `category_id` FK → `ON DELETE SET NULL`.
- **Research:** Sonnet 4.5 legacy / Sonnet 5 current — already flagged in Task 5.4; no v1 code change (shared env var).

**v1.6 — 2026-07-03** — Review Cycle 6 (3 agents; paired TRD v1.5). Codebase-accuracy agent found **zero** broken plan claims (all anchors/columns/symbols/pair-mode fields verified); fixes below are architecture-correctness + external-contract drift caught by the safety + research agents:
- **CRITICAL (A18 premise was factually wrong):** the multi-cycle "HTTP-triggered Worker must return within ~30s unless streaming" claim is **false** per Cloudflare docs — HTTP Workers have **no wall-clock limit**; the ceiling is **CPU time** (default 30s, →5min on Paid via `limits.cpu_ms`), and an awaited `fetch` burns **~0 CPU**. So a **buffered** `c.json` after a multi-minute Anthropic read is safe Worker-side. Rewrote A18 in Task 5.4 + IP6 + §12 + §10.1-R5 + Task 5.5: v1 ships **buffered + ≤10-page sync PDF cap + W4 FE-polling**; streaming demoted to an **optional** resilience upgrade. Real constraints reframed: FE 2-min `api.upload` timeout, Anthropic 10-min non-streaming SDK limit, idle-connection drops.
- **CRITICAL (C-1 — truncation contract not implementable):** `generateStructured`/`generateStructuredWithFallback` (`provider.ts:192`/`fallback.ts:102`) discard `stopReason` and **throw** on `max_tokens`, so the old `stopReason==='max_tokens' → truncated:true` branch (Task 5.2) and its test (Task 5.6) targeted a non-existent API. Rewrote to **catch the throw → `IMPORT_PARSE_FAILED`, never persist partial JSON**; test now asserts the throw path + zero rows. Swept ALL occurrences (Task 5.2, Task 5.6, §6.4 error matrix, §10 monitoring) — no residual `stopReason:'max_tokens'` branch or non-existent `truncated` status remains.
- **CRITICAL (C-2 — internal contradiction):** IP6 said "Mirror `BudgetSuggestionService` **verbatim**," but that precedent does a **banned** direct `@anthropic-ai/sdk` read call, which Task 5.2 correctly forbids. Changed IP6 to "**structurally** — route ALL model calls through `ai/provider.ts`."
- **WARNING:** (W-2) clarified v1 import has **no** server-side rate limit and the repo's `rateLimit()` is the **banned in-memory** limiter — any future limit must be `RATE_LIMITER` DO/KV-backed (§10). (W-4) `savings_pace` worker must set `data.type` **explicitly** (the budget mirror sets `data.screen`, but `routeNotificationTap` reads `data.type`) (Task 2.4). Cold-start: softened the "expo-router replays the launch URL" assertion — **data-only pushes are not replayed**; verify the existing `budget_alert` cold-start path (Task 2.4). Read model `claude-sonnet-4-5-20250929` flagged **legacy** (still works; Sonnet 5 is current + lifts PDF cap 100→600) — shared env var, no v1 code change (Task 5.4).
- **SUGGESTION:** `maxTokens` "raised from 8192" → "raised from the ~2K budget default" (budget's real value is 2048, not 8192) (Task 5.2); SDK-54 `MediaType[]` + pre-permission note for the image picker (Task 5.5).

**v1.5 — 2026-07-03** — Review Cycle 5 delta (paired TRD v1.4):
- Fixed the two stale `BudgetService:189`→`:224` anchors Cycle-4 missed (IP2 `:51`, and TRD §4).
- Reconciled §8 step 6 cron wording with Task 2.4 (savings alert adds **zero** cron triggers; the blocker is the commented-out cron block, not a slot allocation) — removed the internal tension.
- Nits: added `deleteTransaction` to the Task 3.3 `dataRevision`-bump list; added `SavingsIncomeTemplate` to the Task 0.2 schema type-export stub.
- Cycle-5 verification: all Cycle-4 fixes (C1, A18, N1, P1, P2, W1–W8) re-confirmed present in-body and all corrected code anchors re-confirmed against the repo; the 100-page HARD-reject vs ≤10-page SYNC-threshold confirmed complementary; import income keeps `template_id`=NULL so the new partial unique index cannot false-block import rows.

**v1.4 — 2026-07-03** — Review Cycle 4 (3 agents; paired TRD v1.3):
- **CRITICAL:** (a) **C1** — `apply-templates` income idempotency had NO schema backing (`savings_income_entries` lacked `template_id`/`period` + unique index) → re-tap double-inserted income. Added the two columns + partial unique index `savings_income_template_period_idx` to the 0067 migration; Task 4.1 now `INSERT OR IGNORE` on `(template_id, period)`; schema-savings note updated. (b) **A18 / Workers HTTP wall-time** — the "synchronous import is safe (fetch = wall-time, not CPU)" claim was corrected: CPU isn't the limit but the ~30s HTTP invocation wall-time IS; a buffered long PDF/vision read is killed at ~30s (and the FE 2-min upload timeout false-fails). Task 5.4 + IP6 + §12 now require streaming the Worker→client response, keeping small inputs sync, and capping the synchronous PDF path at ≤10 pages. (c) **N1** — Task 2.4 cold-start guidance prescribed `getLastNotificationResponseAsync`/`navigationRef.isReady()`, which do NOT exist / always-false under expo-router (`navigation.ts:23-26`); rewritten to the real `routeNotificationTap` → `router.push` expo-router pattern.
- **CRITICAL (pair-mode):** IP §2 "A1–A15" → "A1–A18" (§1 already referenced A16/A17); paired TRD gains `savings_pace` push type + A18.
- **WARNING:** W1 added Task 4.4 (Phase 4 tests, incl. apply-templates idempotency); W2 `SavingsOverviewView` must also watch `budgetStore.dataRevision` (reverse cross-store hole, IP5); W3 category CRUD added to the `dataRevision`-bump contract (IP3); W4 client-timeout job-polling recovery (Task 5.5) + runbook R5; W5 model IDs/limits given source anchors (verified real); W6 TRD §8 phase-numbering note; W7 TRD stale `src/App.tsx`; W8 anchor drift fixed (`budget-service.ts` `:189`→`:224`, `:762-808`→`:854-911`, `:396-401`→`:431-436`, `:216-217`→`:293-296`; `budget.ts` `:245-305`→`:246-306`; `api/budget.ts` `:355-372`→`:379-395`; `budget-alert-worker` `:123,174`→`:141-149,192-204`).
- **SUGGESTION:** S5 §1 changed-files reconciled with §5; S6 `error` column must not echo source-doc content; S8 Source TRD pinned to v1.3; S9 §11 DoD cross-references the Phase-2 cron carve-out.
- Cycle-4 verification (Agent C, official docs): model IDs `claude-haiku-4-5-20251001` / `claude-sonnet-4-5-20250929` REAL & current; 32 MB / 100-page-PDF / 8000px-1568px-1.15MP / Files-API-500MB / streaming-above-~20k-maxTokens / cron-5-Free-250-Paid / CRA-2025-26 all confirmed.

**v1.3 — 2026-07-03** — Review Cycle 3 (3 agents) + thin-client directive (paired TRD v1.2):
- **CRITICAL:** (a) migration `0066` collision → renumbered to **`0067`** (0066_task_purchase_suggestion.sql already exists); (b) AI-import PDF **100-page** guard (Anthropic caps 200K-context models at 100 pages — fails on both Haiku & Sonnet); (c) base64 inflation → **20 MB inline cap** (32 MB file → ~43 MB > Anthropic's 32 MB request cap → 413; Files-API path deferred to v1.1); (d) cross-phase orphaning — import now writes recurring income as `savings_income_entries`, NOT Phase-4 `savings_income_templates`, so Phase 5 depends only on Phase 1.
- **WARNING:** vision/PDF read on **Sonnet** (accuracy), Haiku for structuring (A16); `maxTokens` 8192→**16384** + stream + never-persist-partial on truncation; **CSV parsed deterministically** (not sent to LLM); prompt-injection hardening (untrusted-doc system prompt + closed Zod domain-bounds on commit); server-side image downsample; `§1 "5 phases"→"6 phases (0–5)"`; Task 4.1 `dataRevision` bump; `savings_import_enabled` full revert lifecycle; Task 5.6 truncation + error-code tests.
- **THIN CLIENT (user directive):** new decision **IP8** + ADR **A17** — all money math / room / pace / resolution / extraction / validation on the BE; FE renders BE view models + UI-only Zustand state, refetches after mutation (Monthly-Payments TOTAL & subtotals computed BE).
- Cycle-3 verification: all v1.2/v1.1 revision claims confirmed in-body; TFSA two-path TRD↔IP parity confirmed; all identifiers single-spelling; all cents↔dollar arithmetic reconciles (python-checked); synchronous Claude-in-Worker confirmed safe (awaited fetch = wall-time, not CPU).

**v1.2 — 2026-07-03** — Review Cycle 1 correctness fixes + scope expansion (paired TRD v1.1):
- **CRITICAL (correctness, CRA-verified):** RRSP room now splits into mutually-exclusive **NOA path (no PA double-subtraction)** vs from-scratch path; TFSA room **drops the same-year withdrawal add-back** (CRA restores room Jan 1 of the *following* year). CRA constants upgraded ⚠️→✅ verified (TFSA $7,000; RRSP $32,490/$33,810; FHSA $8,000/$40,000); FHSA v1 = balance + lifetime cap only.
- **CRITICAL (arch):** `SavingsRegisteredScreen`→`SavingsRegistered` (TRD↔IP parity); cross-store staleness fixed (new IP5 — Dashboard headroom card subscribes to `savingsStore.dataRevision`).
- **WARNING:** `ytdNet` single grouped query (was 36-read loop); money-write idempotency (client UUID + `INSERT OR IGNORE`); category-seed race (`UNIQUE(household_id,name)`); tri-state kill-switch probe; §10.1 operational runbook + alarm wiring; KV eventual-consistency framing; emergency-fund/pace divide-by-zero guards; `index.ts` export step; accurate cron framing (dispatch inside existing `scheduled()`, 0 new triggers); notification cold-start deep-link pattern; stale `src/App.tsx` reference removed.
- **NEW SCOPE (user request):** **Phase 5 — Monthly Payments (recurring spending)** model + idempotent apply, and **AI data import** (upload files/images/text/Google-Drive → AI extract → **confirm** → commit, mirroring the shipped `BudgetSuggestionService` pipeline; models `claude-haiku-4-5-20251001`/`claude-sonnet-4-5-20250929`; Google Drive via existing `CloudFilePicker`; second kill switch `savings_import_enabled`). Migration grows to **9 tables** (`savings_recurring_payments`, `savings_import_jobs` + idempotency columns/indexes). **Registered accounts** gain user-entered this-year limits (`annual_limit_override_cents`) + regular/manual contribution kinds + idempotent apply-regular. Updated §1/§2 (IP6/IP7)/§5/§6/§8/§10/§11/§12/§13. SUGGESTIONs applied (goal.type union, Zod pin, int-cents note, Phase-3 Settings-row independence, AdaptiveContainer anchor).

**v1.1 — 2026-07-03** — Applied Review Cycle 1 findings (Reviewers A + B):
- CRITICAL: fixed BE test path (`backend/src/routes/__tests__/`), Task 2.4 notification API (`sendNotification` not `scheduleNotification`), IP3 `budgetStore` persist mis-citation, end-to-end kill switch (BE 404 + FE probe + worker guard), per-phase deploy gate on remote migration (Task 0.3), registered-account IDOR scoping + cross-household test.
- Documented cron-disabled caveat (5-cron limit) — Phase 2 delivery gated on ops.
- WARNING fixes: `deleteCategory` detach-on-delete, explicit zod enums, 401 in error matrix, emergency-fund includes Home-from-Budget essential rollup, `navigateToBudget` savings param, FHSA room decision, `dataRevision` bump, `activeView` cast at `BudgetScreen.tsx:52`, §5 rows for tests/AI/iPad, stale `src/App.tsx` reference corrected (file removed).

**v1.0 — 2026-07-03** — Initial plan (all 4 phases; Model A sync; affordability untouched).


