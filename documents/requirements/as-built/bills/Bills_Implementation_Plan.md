# Bills — Implementation Plan (v1.0)

**Version:** 1.0
**Date:** 2026-07-05
**Status:** Draft
**Paired TRD:** documents/features/bills/Bills_TRD.md (v1.0)
**Area:** FE + BE
**Priority:** P1

---

## §0 Codebase Snapshot Note

Re-grep anchors before each phase — line numbers drift. Validated at authoring time (see TRD §0 for the full list). Load-bearing facts:

- **Extension, not greenfield.** Reuse `utility_*` tables (`backend/src/db/schema-utilities.ts`), `UtilityService` (`backend/src/services/utility-service.ts`), `BillExtractionService` (`backend/src/services/bill-extraction-service.ts`), routes (`backend/src/routes/utilities.ts`, mounted `backend/src/index.ts:368`), and the mobile Utilities stack.
- **Next free migration: `0069_*`** (`0068_expense_saved_amount.sql` is latest).
- Extraction model is **hardcoded** `claude-sonnet-4-5-20250929` at `bill-extraction-service.ts:19`, `max_tokens 4096`. Single-file upload at `utilities.ts:482–584`; auto-create threshold `confidence.overall >= 0.8`.
- Region gate: `MainTabNavigator.tsx:41` (flag) + `:260–261` (`isHouseholdInGreaterVancouver`). Tab hidden by default `navigationCustomizationStore.ts:129`.
- `api.upload` timeout 120 s (`src/api/client.ts:157–167`). Charts are client-side (`UtilityChartsScreen`). No `utilitiesStore`. No BE tests for utilities.
- Reference implementation to mirror for the import pipeline: **Savings** (`backend/src/services/savings-import-service.ts`, `backend/src/routes/savings.ts` `/import*`, `src/screens/budget/savings/SavingsImportScreen.tsx`).

---

## §1 Overview

Extend and unlock the existing hidden "Utilities & Taxes" feature into a discoverable, general **"Bills"** experience: simple multi-source upload (photo / file / Google Drive) accepting PDF/JPEG/PNG/WebP/**CSV**, AI extraction (single & **multi-file/multi-bill** draft-then-confirm), **documents filed by category**, and a full **month-by-month picture** with year-over-year, **trends**, **projections**, anomaly detection, and reminder dispatch — across **multiple accounts** and generalized beyond utilities (internet/phone/insurance/subscriptions).

---

## §2 Architecture Decisions

See TRD §2 (A1–A14). Chosen highlights: extend Utilities (A1); display-rename to "Bills", keep code identifiers (A2); relax GVA gate, keep BC tax extras conditional (A3); extend `bill_type` allow-list + derived `category` (A4); cents + JSON `metadata` (A5); multi-file draft-then-confirm import via `bill_import_jobs`/`items` (A6); best-effort enrichment (A7); configurable extraction model + limits (A8); synchronous buffered import + FE polling (A9); category-scoped R2 + signed download (A10); compute-on-read projections (A11); BE-authoritative math (A12); reminder cron dispatch (A13); dual kill switches (A14).

| # | Decision | Chosen | Reason |
|---|----------|--------|--------|
| B1 | Rename risk | Display-only rename ("Bills"); keep `utility_*` symbols/tables/routes | Immutable-migration + low blast radius |
| B2 | Migration shape | Single additive `0069` (`ADD COLUMN` + 2 new tables) | SQLite online ADD COLUMN; old clients safe |
| B3 | Category | BE-derived from `bill_type`, persisted + read-time fallback for legacy rows | No data backfill required |
| B4 | Import model | Mirror `savings-import-service.ts` job/item pattern | Proven, tested, reviewed pattern |

---

## §3 Pre-Implementation Checklist

- [ ] Re-grep migration number (`ls backend/migrations | tail`) → confirm `0069` free.
- [ ] Confirm `ANTHROPIC_API_KEY` secret set in all envs; pick the extraction-model env var name (propose `BILL_EXTRACTION_MODEL`, default `claude-sonnet-4-5-20250929`) and add to `wrangler.toml [vars]` (all 3 envs).
- [ ] Confirm CONFIG_KV keys to add: `bills_import_enabled` (default true), `bills_enrichment_enabled` (default false).
- [ ] Decide reminder default channel (push) + windows; confirm `NotificationService` API for ad-hoc sends.
- [ ] Confirm the report PDF viewer component path to reuse for the document viewer.
- [ ] Snapshot current `UtilityChartsScreen` behavior to preserve visual parity when moving to `/analytics`.

---

## §4 Implementation Phases

### Phase 0 — Migration + schema scaffolding (no behavior change)

- **Task 0.1** — Write `backend/migrations/0069_bills_enhancements.sql`:
  - `ALTER TABLE utility_bills ADD COLUMN category TEXT;`
  - `ALTER TABLE utility_bills ADD COLUMN currency TEXT NOT NULL DEFAULT 'CAD';`
  - `ALTER TABLE utility_bills ADD COLUMN metadata TEXT;`
  - `ALTER TABLE utility_bills ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed';`
  - `ALTER TABLE utility_bills ADD COLUMN import_job_id TEXT;`
  - `ALTER TABLE utility_bills ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';`
  - `CREATE INDEX IF NOT EXISTS utility_bills_category_idx ON utility_bills(category);`
  - `CREATE TABLE IF NOT EXISTS bill_import_jobs (...)` and `bill_import_items (...)` per TRD §3 + their indexes.
- **Task 0.2** — Update `backend/src/db/schema-utilities.ts`: add the new columns to `utilityBills`, add `billImportJobs` + `billImportItems` `sqliteTable`s + `$inferSelect` type exports.
- **Task 0.3** — `npm run db:migrate` (local) and `npm run typecheck`.
- **Task 0.4** — Add `BILL_EXTRACTION_MODEL` to `Env` type (`backend/src/types/index.ts`) + `wrangler.toml [vars]`; change `bill-extraction-service.ts:19` to `env.BILL_EXTRACTION_MODEL || 'claude-sonnet-4-5-20250929'`; bump `max_tokens` (e.g. 8192) for multi-bill.
- **Task 0.5** — Add `deriveCategory(billType)` + `BILL_TYPES`/`BILL_CATEGORIES` allow-lists to a shared util (e.g. `backend/src/utils/bill-taxonomy.ts`), and mirror on FE (`src/config/bill-taxonomy.ts`).
- **DoD:** migrations apply clean; typecheck passes; no runtime/behavior change; existing utilities tests (if any) + smoke still green.

### Phase 1 — Unlock & rebrand (core UX on existing extraction)

- **Task 1.1 (FE gate)** — `MainTabNavigator.tsx:260–261`: show Utilities/Bills tab when `utilities` flag on, drop the `isHouseholdInGreaterVancouver` requirement for tab visibility. Set default `isVisible:true` in `navigationCustomizationStore.ts:129`.
- **Task 1.2 (FE naming)** — Update `TAB_METADATA[TabType.UTILITIES].displayName` → "Bills"; update `UtilitiesScreen` header/copy. Keep identifiers.
- **Task 1.3 (FE BC-conditional)** — In `UtilitiesScreen` + `PropertyTaxScreen`, render property-tax / BC-assessment / municipality cards only when `isHouseholdInGreaterVancouver(currentHousehold)`; otherwise show general Bills content.
- **Task 1.4 (BE upload extend)** — `utilities.ts` upload handler + `BillExtractionService`: add `text/csv` to `BILL_DOCUMENT_MIMES`; add a deterministic CSV path (parse rows in JS, LLM only classifies/normalizes columns — never recomputes totals); write R2 with category-scoped key `bills/{householdId}/{category}/{uuid}-{safeName}` (A10); on create, compute + persist `category`, `metadata` (avg daily cost/usage, periodDays), `source='ai_upload'`.
- **Task 1.5 (FE upload)** — `AddUtilityBillScreen`: expose all bill types (`electricity/gas/water/sewer/garbage/internet/phone/insurance/subscription/other`); add CSV to `DocumentPicker` types + `CloudFilePicker` `mimeTypeFilter`; default `usageUnit` per type.
- **Task 1.6 (FE analytics move)** — Wire `src/api/utilities.ts` `getAnalytics`; refactor `UtilityChartsScreen` to render `/analytics` view model (A12) with visual parity; keep month-by-month bar + per-category pie + usage line.
- **Task 1.7 (store)** — Add `src/stores/utilitiesStore.ts` (UI-only: `selectedYear`, `selectedCategory`, `selectedAccountId`, `dataRevision`).
- **Task 1.8 (BE list filters)** — `GET /bills` + `UtilityService.getUtilityBills`: add `category`, `accountId`, `status` filters; ensure `getAnalytics` groups into categories (read-time fallback for NULL `category`).
- **DoD:** Bills tab visible to a non-GVA test household; single-file PDF/image/CSV upload → review → save works; charts render from BE; BC tax cards hidden for non-GVA.

### Phase 2 — Multi-file / multi-bill AI import (draft-then-confirm)

- **Task 2.1 (BE service)** — New `backend/src/services/bill-import-service.ts` mirroring `savings-import-service.ts`: `createJob(files|text)` → R2 upload each file (category-scoped, SHA-256 `content_hash`) → per file call `BillExtractionService` returning **an array** of `ExtractedUtilityBill` (update the prompt/schema to allow multiple bills per document; see Task 2.2) → insert `bill_import_items`; `getJob`, `updateItem`, `commit(itemIds)`, `discard`.
- **Task 2.2 (prompt)** — Extend `extract-utility-bill.ts` to support **N bills per document** (return `{ bills: ExtractedUtilityBill[] }`) and add optional `metadata`/enrichment fields; keep BC provider hints; raise `max_tokens`.
- **Task 2.3 (BE routes)** — Add `POST /bills/import`, `GET /bills/import/:jobId`, `PATCH /bills/import/:jobId/items/:itemId`, `POST /bills/import/:jobId/commit`, `DELETE /bills/import/:jobId`; gate with `bills_import_enabled` KV flag; zValidator schemas; enforce 20 MB/file + 100-page PDF limits + downsample.
- **Task 2.4 (FE screen)** — `BillImportScreen` (clone `SavingsImportScreen`): multi-select files/Drive → `POST /bills/import` via `api.upload` → poll `GET /bills/import/:jobId` (handles > 120 s) → review list (edit/deselect draft items) → `commit`. Register in `UtilitiesNavigator` + `MainTabParamList`; entry point from `UtilitiesScreen` and `AddUtilityBillScreen`.
- **Task 2.5 (FE api)** — Add import wrappers to `src/api/utilities.ts` + types.
- **DoD:** upload 4 sample bills at once → 4 draft items → edit one → commit → 4 `utility_bills` rows with correct type/period/amount/usage; a combined multi-bill PDF yields multiple items.

### Phase 3 — Documents by category

- **Task 3.1 (BE)** — `GET /bills/documents` (archive index, filters `category`/`accountId`/`year`) + `GET /bills/:billId/document` (streamed/short-lived signed R2 download, mirror `ReportService`); 404 `NO_DOCUMENT` when null.
- **Task 3.2 (FE)** — `BillDocumentsScreen`: category chips → bill list with doc badge → open in-app **PDF/image viewer** (reuse report viewer) + download/share. Register in navigator + param list; entry from Bills tab.
- **Task 3.3 (FE api)** — `getDocuments`, `getBillDocumentUrl` wrappers.
- **DoD:** every uploaded bill's original is viewable/downloadable, grouped by category; no public URLs.

### Phase 4 — Intelligence (projections, cadence, anomalies)

- **Task 4.1 (BE)** — `UtilityService.getProjections` (cadence detection + YoY/trailing-avg next-bill estimate per account/type, TRD §5) and `detectAnomalies` (spike rule); extend `getAnalytics` view model with `projections` + `anomalies`.
- **Task 4.2 (BE route)** — `GET /bills/projections`.
- **Task 4.3 (FE)** — `UtilityChartsScreen`: "estimated next bill" card per type + anomaly badges on outlier months; current-state summary (upcoming/overdue/this-month).
- **DoD:** with ≥ 2 same-type bills, a plausible next-bill estimate + `basis`/`confidence` renders; an injected spike is flagged.

### Phase 5 — Reminder dispatch + enrichment + polish

- **Task 5.1 (BE cron)** — `backend/src/workers/bill-reminder-worker.ts`: in the `scheduled()` handler (`backend/src/index.ts`), process due `utility_reminders` (`sent_at IS NULL`, `scheduled_for <= now`) → `NotificationService` push (`data.type = 'bill_reminder'`/`'bill_overdue'`) → set `sent_at`; time-window guarded.
- **Task 5.2 (FE)** — Notification tap routing for `bill_reminder`/`bill_overdue` → bill detail (warm-tap; cold-start replay = known gap, §12).
- **Task 5.3 (BE enrichment)** — Behind `bills_enrichment_enabled`: for energy bills, look up avg temp/degree-days for `(region, period)`, store in `metadata` flagged estimated; never block save.
- **Task 5.4 (polish)** — iPad layout for Bills screens; `UtilitySettingsScreen` account-management (retire "Coming Soon" stub — create/edit accounts + per-bill reminder toggle).
- **DoD:** a bill with a near due date fires a push at the scheduled offset; tapping opens it; energy bills show estimated temperature when enabled.

---

## §5 Affected Files

**Backend**
- `backend/migrations/0069_bills_enhancements.sql` (new)
- `backend/src/db/schema-utilities.ts` (columns + 2 tables)
- `backend/src/types/index.ts` (`BILL_EXTRACTION_MODEL`)
- `backend/wrangler.toml` (`[vars]` model; KV flags documented)
- `backend/src/services/bill-extraction-service.ts` (model env var, CSV, multi-bill array, metadata)
- `backend/src/ai/prompts/extract-utility-bill.ts` (multi-bill schema, enrichment fields)
- `backend/src/services/bill-import-service.ts` (new)
- `backend/src/services/utility-service.ts` (list filters, projections, anomalies, category derivation, category-scoped upload)
- `backend/src/routes/utilities.ts` (import, documents, projections routes; extend upload/list)
- `backend/src/workers/bill-reminder-worker.ts` (new) + `backend/src/index.ts` (`scheduled()` wiring)
- `backend/src/utils/bill-taxonomy.ts` (new)

**Frontend**
- `src/navigation/MainTabNavigator.tsx` (gate relax, display name)
- `src/stores/navigationCustomizationStore.ts` (default visible)
- `src/navigation/UtilitiesNavigator.tsx` + `src/navigation/types.ts` (new screens in param list)
- `src/screens/utilities/AddUtilityBillScreen.tsx` (types, CSV)
- `src/screens/utilities/UtilityChartsScreen.tsx` (BE analytics + projections)
- `src/screens/utilities/BillImportScreen.tsx` (new)
- `src/screens/utilities/BillDocumentsScreen.tsx` (new)
- `src/screens/utilities/UtilitiesScreen.tsx` / `PropertyTaxScreen.tsx` (BC-conditional)
- `src/screens/utilities/UtilitySettingsScreen.tsx` (accounts UI)
- `src/api/utilities.ts` (+ types) ; `src/stores/utilitiesStore.ts` (new) ; `src/config/bill-taxonomy.ts` (new)
- Notification response listener (bill tap routing)

---

## §6 Test Strategy

- **BE unit (Vitest, `@cloudflare/vitest-pool-workers`)** — new coverage where none exists today:
  - `bill-taxonomy` category derivation; `UtilityService` list filters, `getAnalytics` category rollup + read-time fallback, `getProjections` (YoY & trailing-avg & clamp), cadence detection, anomaly rule.
  - `BillImportService` job/item lifecycle, multi-bill commit idempotency, dedup by `content_hash`, discard cleanup.
  - Upload MIME allow-list incl. CSV; 20 MB / 100-page rejections.
  - Route auth + cross-household IDOR (404) for bills/import/documents.
- **Extraction** — golden tests using the four sample bills' extracted text (mock the Anthropic call): assert billType, period, amount (cents), usage/unit.
- **FE** — smoke render of new screens; Maestro flow: open Bills tab (non-GVA) → multi-upload → review → commit → see it in list + documents + charts.

---

## §7 Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Rename confusion (Bills vs utility_* code) | Med | Low | Display-only rename (B1); document the mapping in code comments |
| Multi-bill extraction hallucination / token truncation | Med | Med | Draft-then-confirm review; raise max_tokens; per-item confidence; never auto-commit import items |
| CSV formats vary wildly | High | Med | Deterministic parse + LLM classify only; show unmatched columns in review |
| Long PDF read > 120 s FE timeout | Low | Med | FE polling on `GET /import/:jobId` (A9); 10-page sync cap; larger → v1.1 async |
| Legacy rows have NULL category | High | Low | Read-time fallback `deriveCategory(bill_type)`; no backfill needed |
| Weather enrichment fragility/cost | Med | Low | Behind `bills_enrichment_enabled` (default off); best-effort, never blocks |
| Reminder cron double-send | Low | Med | `sent_at` guard + time-window; idempotent update |
| Exposing BC tax logic to non-BC users | Med | Med | Conditional render behind `isHouseholdInGreaterVancouver` (A3) |

---

## §8 Deployment Plan

1. BE: apply `0069` local → `db:migrate:remote --env staging` → `--env production`.
2. `npm run deploy:staging && npm run deploy:production` (backend-deployment rule; verify Version ID; cron-limit error is non-blocking).
3. Set CONFIG_KV `bills_import_enabled=true`, `bills_enrichment_enabled=false`.
4. FE ships after BE live on staging (dev builds hit staging).
5. Phase-gated rollout: Phase 1 (unlock) can ship independently; import/documents/projections/reminders follow.

---

## §9 Rollback Procedures

- **FE:** flip tab default back to hidden / `utilities` flag off to hide the whole feature instantly (no deploy needed for the KV flag).
- **Import/enrichment:** set `bills_import_enabled` / `bills_enrichment_enabled` false in CONFIG_KV.
- **BE code:** redeploy previous Worker version. Migration `0069` is additive — no down-migration needed; new columns/tables are inert if code is rolled back.
- **Data:** discard-import cleans R2 objects; committed bills are ordinary `utility_bills` rows.

---

## §10 Monitoring

- Log extraction latency + token usage (already logged in `BillExtractionService`); add job-level counters (`items_extracted`, `committed`, `failed`).
- Alert on `IMPORT_PARSE_FAILED` rate; reminder-worker send failures.

### §10.1 Operational Runbook (top failure modes)
- **Import stuck `analyzing`** → check Worker logs for Anthropic error; job marked `failed` should surface in FE; re-upload.
- **Document 404** → bill has null `document_url` (manual entry); expected.
- **Projection looks wrong** → too few same-type bills; `basis='trailing_avg'` with low `confidence` is expected.

---

## §11 Definition of Done

- [ ] Non-GVA household sees a "Bills" tab; BC tax extras hidden there.
- [ ] Upload photo/file/Drive incl. CSV → single-bill review → save.
- [ ] Multi-file upload → multiple draft bills → edit → commit.
- [ ] Documents browsable by category with in-app viewer + download.
- [ ] Month-by-month (this year), YoY, per-category, usage charts from BE.
- [ ] Next-bill projection + anomaly flags render.
- [ ] Reminders fire as push at scheduled offsets; taps open the bill.
- [ ] Migration additive; typecheck + lint clean; new BE tests green.

---

## §12 Known Gaps & Future Work

- Cold-start notification replay (warm-tap only in v1).
- Very large PDFs (async / Files-API) — v1.1.
- xlsx/xls parsing; user-defined categories; multi-currency; live provider account linking; ML-based forecasting.
- Full account-management + per-account reminder preferences UX (partial in Phase 5).

---

## §13 Summary

Ship "Bills" by **extending and unlocking the existing Utilities feature** rather than rebuilding it. Phase 0–1 deliver the visible product on top of the already-working AI extraction (unlock, rebrand, CSV, all bill types, category-scoped storage, BE analytics). Phases 2–5 add the genuinely-missing pieces the user asked for: multi-file/multi-bill import, category document archive, projections/anomalies, and reminder dispatch — with enrichment (temperature/degree-days) as an optional, flagged extra.

---

## Revision History

**v1.0 — 2026-07-05** — Initial plan paired with Bills_TRD v1.0. Six phases (0–5) over an extend-and-unlock strategy on the existing `utility_*` domain; single additive migration `0069`; import pipeline mirrors the shipped Savings import.
