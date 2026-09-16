# Bills — TRD (v1.0)

**Version:** 1.0
**Date:** 2026-07-05
**Status:** Draft
**Paired Implementation Plan:** documents/features/bills/Bills_Implementation_Plan.md (v1.0)
**Area:** FE + BE
**Priority:** P1
**Feature owner:** a-tekhtelev

---

## §0 Codebase Snapshot Note

Written against the current `main` working tree. Re-grep before implementing each phase — line numbers drift. External-contract claims (Anthropic limits, model IDs) marked ⚠️ Unverified unless linked to a source. Key anchors validated at authoring time:

- **This feature EXTENDS the existing "Utilities & Taxes" domain — it is not greenfield.** The hard parts (schema, AI extraction, R2 upload, bill CRUD, basic analytics, mobile upload UI) already ship. Bills is the productization + generalization of Utilities.
- Utilities schema: `backend/src/db/schema-utilities.ts` (8 tables: `utility_providers`, `utility_accounts`, `utility_bills`, `property_taxes`, `bc_assessment_data`, `utility_reminders`, `utility_trends`, `municipality_configs`). Created by hand-written SQL `backend/migrations/0009_utilities_tables.sql`.
- **Next free migration number: `0069_*`** (latest is `0068_expense_saved_amount.sql`; `0068` is taken — re-grep before implementing).
- Route mount: `app.route('/households/:householdId/utilities', utilitiesRoutes)` (`backend/src/index.ts:368`). Routes in `backend/src/routes/utilities.ts` (~756 lines); auth via `authMiddleware()` (line 12) + `UtilityService.checkHouseholdAccess`.
- Extraction: `BillExtractionService` (`backend/src/services/bill-extraction-service.ts`) — model **hardcoded** `claude-sonnet-4-5-20250929` (line 19), `max_tokens 4096`, native PDF (`type:'document'`) + image blocks, **synchronous** in the upload request, reads bytes from R2. Prompt in `backend/src/ai/prompts/extract-utility-bill.ts` (BC-tuned: BC Hydro / FortisBC / City of Surrey).
- Upload flow: `POST /utilities/bills/upload` (`backend/src/routes/utilities.ts:482–584`) → R2 key `utilities/{householdId}/bills/{uuid}-{filename}` → `extractFromR2` → if `autoCreate && confidence.overall >= 0.8` auto-create, else return `{extractedData, suggestedBill, documentUrl}` for review. MIME allow-list: **PDF, JPEG, PNG, WebP** (no CSV); 32 MB cap.
- Analytics: `UtilityService.getAnalytics` (monthly totals, YoY, by-type), `calculateTrends` (upserts `utility_trends`), `getDashboardOverview` (upcoming + MoM). **No projections/forecasts anywhere.** Mobile `UtilityChartsScreen` computes charts **client-side** and does NOT call `/analytics`.
- Mobile: `src/navigation/UtilitiesNavigator.tsx` (stack), tab wired in `src/navigation/MainTabNavigator.tsx` — gated by feature flag `utilities` (line 41) **AND** `isHouseholdInGreaterVancouver(currentHousehold)` (lines 260–261). Tab hidden by default (`navigationCustomizationStore.ts:129` `isVisible:false`). Screens: `UtilitiesScreen`, `UtilityBillsScreen`, `AddUtilityBillScreen`, `UtilityDetailScreen`, `UtilityChartsScreen`, `PropertyTaxScreen`, `UtilitySettingsScreen` (a "Coming Soon" stub).
- API client: `src/api/utilities.ts` (`utilitiesApi`). **Not wrapped** on mobile today: `/analytics`, `/analytics/calculate-trends`, `/providers`, reminders CRUD, calculators. `api.upload` timeout = **120 s** (`src/api/client.ts:157–167`).
- Region gate helper: `src/utils/region-gating.ts` `isHouseholdInGreaterVancouver` (Canada + BC + GVA city list).
- Feature flags: BE `featureFlagService` `DEFAULT_FLAGS.utilities = true` (CONFIG_KV `feature-flags:v1`); FE `src/config/features.ts` `utilities: true`.
- **No `utilitiesStore`** — screens hold local `useState`; `useHouseholdStore.currentHousehold.id` for scope.
- **No backend unit/integration tests** for `UtilityService` / `BillExtractionService` today.

---

## §1 Overview / Problem

SimpleHouse already has a hidden, BC-only "Utilities & Taxes" feature. The user wants a **discoverable, general "Bills"** experience: *"upload a bill (PDF / image / CSV / any document) from Google Drive, local files, or photos; the AI figures out the period, amounts, and usage metadata; the bill is filed by category; and I can see a full month-by-month picture — spend, trends, projections, and current state — across all my accounts."*

Concretely, the sample bills (already validated against the extraction prompt) are:

| Provider | Type | Cadence | Usage unit | Notes |
|----------|------|---------|-----------|-------|
| BC Hydro | electricity | bi-monthly (60–61 days) | kWh | meter start/end, avg daily cost, YoY comparison |
| FortisBC | natural gas | monthly (~30 days) | GJ | meter reading + conversion factor, RNG, levies |
| City of Surrey | water + sewer | bi-monthly (metered area schedule) | m³ | sewer = % of water volume |

**Goals**

1. **One simple upload flow** — photo / local file / Google Drive (all already wired) that accepts **PDF, JPEG, PNG, WebP, and CSV**, single or **multiple files at once**.
2. **AI figures it out** — detect provider, bill type/category, billing period, amounts, due date, usage (kWh/GJ/m³), meter readings, line items, taxes, and **enrichment metadata** (e.g. average temperature / heating-degree-days for energy bills). **One file may contain multiple bills** (e.g. a combined statement) → extract all.
3. **Draft → review → confirm → save** (never silent-save below a confidence bar). Original document stored on the cloud (R2).
4. **File by category** — browse bills and **original documents by category** (Energy / Water & Waste / Telecom / Insurance / Subscriptions / Other), with an in-app document viewer + download.
5. **Full picture** — this-year, **month-by-month** spend across all accounts; per-type breakdown; **year-over-year**; **trends**; **next-bill projection**; and a "current state" dashboard (upcoming/overdue, this-month total).
6. **Multiple accounts** — support many accounts across providers (BC Hydro, FortisBC, City of Surrey, …) with per-account filtering.
7. **Beyond utilities** — also track other recurring household bills (internet, phone, insurance, subscriptions) using generic categories, so the monthly picture is complete.
8. **Discoverable** — surface as a "Bills" tab for the relevant users (relax the GVA-only gate; keep BC-specific property-tax/assessment extras optional).

**Non-Goals (v1)**

- Live utility-provider account linking / scraping (no BC Hydro / FortisBC login integration; data comes from uploads only).
- Bank/credit-card aggregation (deferred; Savings/Budget own cashflow).
- Bill payment execution (we track due dates + remind; we do not pay).
- Multi-currency (CAD only; `currency` column reserved).
- xlsx/xls parsing (CSV only in v1; export-to-CSV guidance in UI).
- Authoritative weather data contracts — enrichment temperature is **best-effort** (from the bill itself if printed, else an optional lookup marked as estimate; see A7).

---

## §2 Architecture Decisions (ADRs)

| # | Decision | Chosen | Alternative | Reason |
|---|----------|--------|-------------|--------|
| A1 | Build strategy | **Extend the existing Utilities domain** (reuse `utility_*` tables, `UtilityService`, `BillExtractionService`, `utilities` routes, mobile Utilities stack) and add the missing capabilities | New parallel `bills_*` domain | User directive; ~80% already ships & is region-tested. A parallel domain would duplicate schema + extraction + upload and create two sources of truth |
| A2 | Product surface / naming | Present the feature as **"Bills"** (tab + copy). Keep the internal `utilities`/`utility_*` code identifiers to avoid a churny rename; add a thin display-name layer | Rename all symbols `utility_*`→`bills_*` | Renaming shipped tables/routes/migrations is high-risk and immutable-migration-hostile; a display rename delivers the UX with near-zero blast radius |
| A3 | Discoverability / region gate | **Relax** the GVA gate: Bills tab shows for any household when the `utilities` flag is on; **BC-specific extras** (property tax, BC Assessment, homeowner grant, municipality due-dates) remain **conditionally rendered** behind `isHouseholdInGreaterVancouver` | Keep GVA-only; or delete the gate entirely incl. tax features | User wants it visible generally, but the tax/assessment logic is genuinely BC-only and should not show elsewhere |
| A4 | Bill taxonomy | Keep `bill_type` as free TEXT (no DB enum) and **extend the app-layer allow-list** to `electricity \| gas \| water \| sewer \| garbage \| internet \| phone \| insurance \| subscription \| other`; add a derived **`category`** grouping (Energy / Water & Waste / Telecom / Insurance / Subscriptions / Tax / Other) computed BE-side | New join table of categories | `bill_type` is already free text; extending the allow-list + a computed category is additive and migration-light. A user-defined category table is deferred |
| A5 | Money & units | Amounts stay in **cents** (integer, existing `utility_bills.amount`); `currency` default `'CAD'`; usage stays `usage_quantity` (REAL) + `usage_unit` (TEXT). Enrichment + full extraction persist to the existing **`ai_extracted_data` JSON**; add a normalized **`metadata` JSON** column for query-friendly enrichment (avg temp, degree-days, per-day cost) | Typed columns per metric | Matches the shipped cents convention; heterogeneous metadata across bill types is JSON-shaped by nature; one query-friendly JSON avoids a wide sparse table |
| A6 | Multi-file / multi-bill import | New **draft-then-confirm** import pipeline: `bill_import_jobs` (batch) + `bill_import_items` (one row per extracted bill). Upload N files → per-file AI extract may yield **1..N bills** → items become an editable **draft** the user confirms → commit inserts `utility_bills`. Mirrors the shipped Savings import (`savings_import_jobs`) + the existing single-file upload | Reuse single-file `bills/upload` for everything | Single-file/single-bill cannot express "5 files" or "combined statement with 3 accounts"; draft-then-confirm is the reviewed, safe pattern already proven in Savings |
| A7 | Enrichment (temperature/degree-days) | **Best-effort, layered**: (1) if printed on the bill, extract it; (2) else optional server-side lookup keyed by `(serviceAddress region, billing period)` behind a `bills_enrichment_enabled` KV flag, stored in `metadata` and **labelled "estimated"**; (3) else omit. Never block save on enrichment | Mandatory weather API | Bills rarely print temperature; a hard dependency would make extraction fragile. Enrichment is additive analytics sugar, not core data |
| A8 | Extraction model routing & limits | Keep **Claude vision/PDF read** for accuracy; make the model a **configurable env var** (default the current `claude-sonnet-4-5-20250929`) instead of a hardcode; raise `max_tokens` for multi-bill docs; reject PDFs > 100 pages up front; cap inline base64 at **20 MB** (Anthropic 32 MB request cap; Files API deferred); downsample images > 1568 px server-side; **CSV parsed deterministically** (LLM only classifies rows, never re-does math) | Keep hardcoded model + 4096 tokens; base64 up to 32 MB | Multi-bill + line-item extraction can exceed 4096 tokens; a config var lets us bump models app-wide; CSV math must be exact. ⚠️ `claude-sonnet-4-5-20250929` is a legacy ID (still works; a newer Sonnet lifts the PDF read cap) |
| A9 | Sync vs async import | **Synchronous** Claude call in the Worker for small inputs (image / CSV / text / PDF ≤ 10 pages), returning a **buffered** JSON draft; rely on **FE polling** for reads that outrun the 120 s `api.upload` timeout; defer larger PDFs to a v1.1 async/Files-API path | Force async job pipeline for all | HTTP Workers have **no wall-clock limit** (only CPU, and awaited `fetch` ≈ 0 CPU) — a buffered multi-minute read is safe. Matches the shipped Savings/Budget sync design. Source: developers.cloudflare.com/workers/platform/limits |
| A10 | Document storage & organization | Store originals in R2 `REPORTS_BUCKET` under a **category-scoped** prefix `bills/{householdId}/{category}/{billId or jobId}/{safeName}`; serve to the app via a **short-lived signed/streamed download route** (mirror `ReportService` pattern), never a public URL; SHA-256 `content_hash` for dedup | Keep flat `utilities/{hid}/bills/…`; public URLs | User wants "documents by category"; financial docs are PII and must not be public. Keying by category makes the archive browsable and export-friendly |
| A11 | Projections | Compute-on-read in `UtilityService` (no snapshot table). Next-bill estimate per `(account/type)` from **cadence-aware history**: prefer same-period-last-year × YoY factor; fall back to trailing-N average; annotate with a confidence/`basis` field | Persist projections; ML model | Deterministic, explainable, cheap; mirrors `getMonthlyOverview` compute-on-read (avoids staleness when bills change). ML is overkill for ≤ 6 bills/yr/account |
| A12 | Thin client — BE-authoritative | All money/usage math (monthly rollups, YoY, trend %, projections, category resolution, extraction+mapping, validation) live in BE services; FE renders BE view models + UI-only state; refetch after mutations. **Move `UtilityChartsScreen` off client-side math onto `/analytics`** | Keep client-side chart math | Single tested source of truth; no FE/BE drift; the shipped client-side chart path is a known inconsistency to retire |
| A13 | Reminder dispatch | Wire the already-created `utility_reminders` rows into the existing 5-min `scheduled()` handler in `backend/src/index.ts` via a `BillReminderWorker` (push `data.type = 'bill_reminder'` / `bill_overdue`), guarded by a time window | New cron | The cron + `NotificationService` already exist; only a processor + FE tap route are missing (rows are written but never sent) |
| A14 | Kill switches | Reuse `utilities` feature flag as the master gate; add `bills_import_enabled` (multi-file AI import) and `bills_enrichment_enabled` (weather) as independent CONFIG_KV flags | One flag | Lets us ship the archive/analytics without exposing AI import or paid enrichment; matches Savings' dual-flag precedent |

---

## §3 Data Model

Extend `backend/src/db/schema-utilities.ts`. New hand-written migration **`0069_bills_enhancements.sql`** (additive only; all `ALTER TABLE ADD COLUMN` / `CREATE TABLE IF NOT EXISTS`). All money in **cents**.

### Changes to `utility_bills` (additive columns)
| Column | Type | Notes |
|--------|------|-------|
| `category` | TEXT NULL | Derived grouping (`energy`\|`water_waste`\|`telecom`\|`insurance`\|`subscription`\|`tax`\|`other`); BE-computed from `bill_type` on write, stored for query/index |
| `currency` | TEXT NOT NULL DEFAULT `'CAD'` | Reserved for future multi-currency |
| `metadata` | TEXT NULL | JSON: query-friendly enrichment — `{ avgTempC, heatingDegreeDays, coolingDegreeDays, avgDailyCostCents, avgDailyUsage, periodDays, enrichmentSource, enrichmentEstimated }` |
| `status` | TEXT NOT NULL DEFAULT `'confirmed'` | `'draft'`\|`'confirmed'` — draft rows come from an unconfirmed import; existing rows default confirmed |
| `import_job_id` | TEXT NULL | logical ref to `bill_import_jobs` (provenance) |
| `source` | TEXT NOT NULL DEFAULT `'manual'` | `'manual'`\|`'ai_upload'`\|`'ai_import'` |

New index: `utility_bills_category_idx (category)`. Existing indexes retained.
> Backfill note: `category` is NULL for pre-existing rows until touched; `getAnalytics`/list endpoints compute a fallback category from `bill_type` at read time, so old rows render correctly without a data migration.

### `bill_import_jobs` (new — multi-file batch)
`id TEXT PK`, `household_id TEXT NOT NULL FK households ON DELETE CASCADE`, `status TEXT NOT NULL` (`pending_upload`\|`analyzing`\|`ready`\|`committed`\|`failed`), `source_kind TEXT` (`file`\|`image`\|`csv`\|`drive`\|`text`), `file_count INTEGER DEFAULT 0`, `error TEXT NULL`, `created_by TEXT NULL FK users`, `created_at`/`updated_at TEXT NOT NULL DEFAULT datetime('now')`. Index `(household_id)`.

### `bill_import_items` (new — one row per extracted bill, editable draft)
`id TEXT PK`, `job_id TEXT NOT NULL FK bill_import_jobs ON DELETE CASCADE`, `file_key TEXT NULL` (R2 object for the source file), `file_name TEXT`, `mime_type TEXT`, `size_bytes INTEGER`, `content_hash TEXT` (SHA-256), `page_range TEXT NULL` (which pages of a multi-bill PDF), `extracted_json TEXT` (the `ExtractedUtilityBill` for this bill), `bill_type TEXT`, `category TEXT`, `confidence REAL`, `selected INTEGER DEFAULT 1` (user can deselect before commit), `committed_bill_id TEXT NULL` (set after commit), `error TEXT NULL`, `created_at`/`updated_at`. Index `(job_id)`, and `content_hash` for dedup lookups.

**Draft-then-confirm:** upload → job `analyzing` → per file, extraction yields 1..N `bill_import_items` → job `ready` with editable draft → `POST /commit` inserts a `utility_bills` row per `selected` item (tagged `import_job_id`, `source='ai_import'`, `status='confirmed'`), sets `committed_bill_id`, job → `committed`.

### Existing tables reused unchanged
`utility_providers`, `utility_accounts` (multi-account per household — the "many BC Hydro / Fortis / Surrey accounts" requirement), `utility_reminders` (now actually dispatched — A13), `utility_trends` (projection inputs), `property_taxes` / `bc_assessment_data` / `municipality_configs` (BC-only, conditionally surfaced — A3).

---

## §4 API Contract

All under the existing mount `app.route('/households/:householdId/utilities', utilitiesRoutes)`. New routes added to `backend/src/routes/utilities.ts`; `zValidator` + zod like the existing handlers; every route `authMiddleware()` + `UtilityService.checkHouseholdAccess`.

### Reused (already shipped)
- `POST /bills` , `GET /bills` (filters: `billType`, `startDate`, `endDate`, `paid`, `limit` — **add** `category`, `accountId`, `status`), `PATCH /bills/:billId`, `DELETE /bills/:billId`.
- `POST /bills/upload` (single file → extract → review/auto-create). **Extend:** add CSV to MIME allow-list; category-scoped R2 key (A10); return `metadata`.
- `POST /bills/extract` (re-extract from an R2 key).
- `GET /accounts` + CRUD, `GET /providers`, `GET /dashboard`, `GET /analytics`, `POST /analytics/calculate-trends`, reminders CRUD.

### New — Multi-file AI import (draft-then-confirm) — Phase 2
- `POST /bills/import` — multipart, **1..N** `file` parts (allow-list `BILL_DOCUMENT_MIMES` = pdf/jpeg/png/webp/**csv**/text; 20 MB inline per file; PDF > 100 pages rejected; images downsampled) **or** JSON `{text}` → creates a `bill_import_jobs`, runs extraction synchronously (A9) → `{ jobId, status, items: BillImportItem[] }`.
- `GET  /bills/import/:jobId` → `{ job, items }` (FE polling target for long reads).
- `PATCH /bills/import/:jobId/items/:itemId` → edit a draft item (correct fields / toggle `selected`).
- `POST /bills/import/:jobId/commit` (body `{ itemIds? }`) → inserts confirmed `utility_bills`; returns `{ createdBillIds, skipped }`.
- `DELETE /bills/import/:jobId` → discard job + R2 objects (unless retained).
- Gated by `authMiddleware` + `utilities` flag + `bills_import_enabled`.

### New — Documents by category — Phase 3
- `GET  /bills/documents?category=&accountId=&year=` → `[{ billId, category, provider, billType, periodStart, periodEnd, amount, fileName, hasDocument }]` (archive index).
- `GET  /bills/:billId/document` → **streamed / short-lived signed** download of the R2 original (A10); 404 if none.

### New — Projections — Phase 4
- `GET  /bills/projections?accountId=&billType=` → `[{ billType, accountId, nextPeriodEstimateCents, basis, confidence, asOf }]`.
- `GET  /bills/analytics` view model extended with `projections` + `anomalies` (spike detection) so the FE chart screen reads one endpoint (A12).

Validation: amounts `z.number().int().min(0)`; dates `YYYY-MM-DD`; enums explicit; `category`/`billType` from the allow-list.

---

## §5 Key Calculations

| Metric | Formula |
|--------|---------|
| Monthly spend (this year, month-by-month) | For each month `m`: `Σ utility_bills.amount` where `billing_period_start` falls in `m` (existing `getAnalytics.monthlyData` keying) across all accounts (or filtered by `accountId`/`category`) |
| Per-type / per-category breakdown | `Σ amount` grouped by `bill_type` → rolled into `category` (A4) |
| Year-over-year | `(currentYearTotal − previousYearTotal)`, `changePercent` guarded for zero denom (existing `getAnalytics.yearOverYear`) |
| Current state (dashboard) | Upcoming unpaid bills due ≤ 30 days; this-month total vs last-month (existing `getDashboardOverview`) + **overdue** = unpaid & `due_date < today` |
| Trend % (per type, per period) | `(total − prevPeriodTotal)/prevPeriodTotal` (existing `calculateTrends`) |
| **Next-bill projection** (per account/type) | `basis='yoy'`: `sameBillLastYear.amount × (1 + yoyChangePercentForType)`; else `basis='trailing_avg'`: mean of last `min(3, n)` bills of that type; `confidence` = f(#history, cadence regularity); clamp ≥ 0 |
| Cadence detection | Median gap between consecutive `(periodStart)` per account/type → monthly (~30 d) / bi-monthly (~60 d) / quarterly (~90 d); used to place the projected next period + to flag missing bills |
| **Anomaly / spike** | Flag a bill if `amount > mean + 2·stdev` (or `> 1.5× same period last year`) for its type; surfaced in `analytics.anomalies` and as an optional push |
| Avg daily cost / usage | `amount / periodDays`, `usage_quantity / periodDays` (persist to `metadata` on write) |
| Enrichment: heating-degree-days | If weather lookup enabled: `Σ max(0, 18°C − dailyMeanTemp)` over the billing period; stored in `metadata`, flagged estimated (A7) |

---

## §6 Frontend

- **Rename surface to "Bills"** (A2): tab label + `UtilitiesScreen` copy. Keep navigator/param-list identifiers (`UtilitiesNavigator`, `MainTabParamList` `Utilities`) to minimize churn; update `TAB_METADATA` display name.
- **Relax region gate** (A3): `MainTabNavigator.tsx:260–261` — show the tab when the `utilities` flag is on regardless of GVA; inside `UtilitiesScreen`/`PropertyTaxScreen`, render property-tax/BC-assessment cards only when `isHouseholdInGreaterVancouver`. Flip `navigationCustomizationStore.ts:129` default `isVisible:true` (or make it opt-out) so it's discoverable.
- **Upload flow** (`AddUtilityBillScreen`): already has Photo / Gallery / Upload File / Google Drive (`CloudFilePicker`). Extend the file/Drive MIME filters to include CSV; expose **all** bill types (add `sewer`, `internet`, `phone`, `insurance`, `subscription`, `other`) in the type picker.
- **New multi-file import screen** (`BillImportScreen`, mirrors `SavingsImportScreen`): pick multiple files → upload → poll job → **review list** of extracted draft bills (edit/deselect) → confirm → commit. Add to `UtilitiesNavigator` + `MainTabParamList`.
- **Documents-by-category archive** (`BillDocumentsScreen`): category chips → list of bills with a doc → tap opens an in-app **PDF/image viewer** (reuse the report PDF viewer component) + download; wired to `GET /bills/documents` and `GET /bills/:billId/document`.
- **Analytics** (`UtilityChartsScreen`): switch from client-side math to `GET /bills/analytics`; add **projection** row ("estimated next bill") and **anomaly** badges; month-by-month bar for the selected year; per-category pie; usage line per type.
- **API client** (`src/api/utilities.ts`): add wrappers for import, documents, analytics, projections, providers, reminders; export `utilitiesApi` (already) and add types.
- **State:** introduce a light `utilitiesStore` (Zustand) only for UI state (`selectedYear`, `selectedCategory`, `dataRevision` for refetch-after-mutation), matching `budgetStore`; server data stays fetched per-screen.
- **Notifications:** handle `data.type` `bill_reminder` / `bill_overdue` taps (route to bill detail) in the app's notification response listener.

---

## §7 Error Codes

| Code | When |
|------|------|
| `UNAUTHORIZED` (401) | missing/expired token (authMiddleware) |
| `FORBIDDEN` | non-member (checkHouseholdAccess) |
| `VALIDATION_ERROR` | bad amount / date / enum / category / billType (zod) |
| `NOT_FOUND` | bill / account / import-job / document id not in household (incl. cross-household IDOR) |
| `UNSUPPORTED_FILE_TYPE` | upload MIME not in `BILL_DOCUMENT_MIMES` |
| `IMPORT_TOO_LARGE` | file > 20 MB inline OR PDF > 100 pages |
| `IMPORT_PARSE_FAILED` | AI extraction failed → job/item `status:'failed'`, surfaced without a 500 |
| `NO_DOCUMENT` (404) | `GET /bills/:billId/document` when `document_url` is null |

---

## §8 Phasing

- **Phase 0** — Migration `0069` + schema/type scaffolding (additive columns, 2 import tables), category-derivation helper, extraction-model env var. No behavior change.
- **Phase 1** — **Unlock & rebrand**: relax GVA gate, "Bills" naming, tab visible by default, expose all bill types + CSV in single-file upload, category-scoped R2 keys, move charts onto `/analytics`. (Ships the core UX on top of existing extraction.)
- **Phase 2** — **Multi-file / multi-bill AI import**: `bill_import_jobs`/`items`, draft-then-confirm, `BillImportScreen`; `bills_import_enabled` flag.
- **Phase 3** — **Documents by category**: archive index + in-app viewer/download.
- **Phase 4** — **Intelligence**: projections, cadence detection, anomaly/spike detection + optional push; analytics view-model extension.
- **Phase 5** — **Reminders dispatch** (cron `BillReminderWorker`, push routing) + **enrichment** (weather/degree-days behind `bills_enrichment_enabled`) + iPad polish.

Deferred: async/Files-API path for very large PDFs; xlsx parsing; user-defined categories; live provider linking; multi-currency; ML projections.

---

## §9 Deployment / Rollout

- BE: hand-write `0069_bills_enhancements.sql` (additive: `ALTER TABLE utility_bills ADD COLUMN …` + `CREATE TABLE IF NOT EXISTS bill_import_jobs/bill_import_items`); `npm run db:migrate` (local) → `db:migrate:remote --env staging` → `--env production`; then `npm run deploy:staging && npm run deploy:production` (backend-deployment rule). SQLite `ADD COLUMN` is safe/online.
- Migrations additive only — old clients ignore new columns/tables/routes.
- FE ships after BE routes are live on staging (dev builds hit staging).
- Kill switches (CONFIG_KV): `utilities` (master, existing) hides the whole tab; `bills_import_enabled` (default true) gates multi-file AI import; `bills_enrichment_enabled` (default **false** until a weather source is chosen) gates temperature/degree-day lookup. Import R2 objects deleted on discard; retained on commit (linked to the bill).
- Verify production Version ID after deploy (cron-limit error is expected & non-blocking per the deployment rule).

---

## Revision History

**v1.0 — 2026-07-05** — Initial TRD. Key finding: the feature is an **extension of the existing hidden BC-only "Utilities & Taxes" domain**, not greenfield. Scope set to *extend + unlock* Utilities, generalized beyond utilities to other recurring household bills (A1/A2/A4), region gate relaxed with BC-only tax extras conditionally rendered (A3). Adds multi-file/multi-bill draft-then-confirm import (A6), category-scoped document archive (A10), projections + anomaly detection (A11), reminder dispatch (A13), enrichment (A7), and moves analytics BE-authoritative (A12).
