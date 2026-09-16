# Home Projects — Implementation Plan

> Single authoritative build plan. Product scope: [HomeProjects_BRD.md](./HomeProjects_BRD.md) · Technical contract: [HomeProjects_TRD.md](./HomeProjects_TRD.md).  
> Merges the former lighter draft and the execution-grade plan into one document. Do not redefine BRD/TRD scope.

| Field | Value |
|-------|-------|
| **Doc type** | Feature implementation plan |
| **Feature id** | `home-projects` |
| **Owning app** | Symply House — docs id `simple-house`; runtime `APP_BRAND=symply-house` |
| **Status** | `in-progress` |
| **Version** | `v2.4` |
| **Created** | 2026-07-17 |
| **Last updated** | 2026-07-17 |
| **Priority** | P1 (flagship House feature; not blocking a release) |
| **Area** | FE + BE (+ iOS native module in Phase 5) |
| **BRD** | [HomeProjects_BRD.md](./HomeProjects_BRD.md) |
| **TRD** | [HomeProjects_TRD.md](./HomeProjects_TRD.md) (v0.5) |
| **Author** | pedram@step.co |

---

## Agent Kickoff Prompt

```text
Read first:
1. AGENTS.md
2. documents/apps/symply-house/README.md
3. documents/apps/symply-house/BRD.md
4. documents/apps/symply-house/TRD.md
5. documents/requirements/HomeProjects/HomeProjects_BRD.md
6. documents/requirements/HomeProjects/HomeProjects_TRD.md
7. documents/requirements/HomeProjects/HomeProjects_Implementation.md

Rules:
- Do not redefine BRD/TRD scope. Log conflicts as blockers.
- Reuse floor plans, spaces, tasks, contractors, R2 upload patterns.
- Core P0/P1 (Plan Phases 0–4) must work with AI off.
- Verify and deploy staging+production when BE/schema changes.
- Do not include secrets.
```

---

## 0. Version History

| Version | Date | Changes |
|---------|------|---------|
| v2.4 | 2026-07-17 | Finish gaps: RoomPlan capture UI, PDF export, Soft Transfer preset/apply, create-task + before/after photos; deploy all envs |
| v2.3 | 2026-07-17 | Phase 5 RoomPlan scaffold + takeoff; Phase 6 AI schematic queue/cancel/scope/export; Phase 7 Soft Transfer package draft; fleet queues + deploy |
| v2.2 | 2026-07-17 | Closed MVP/Phase-4 gaps (spaces, photos, plan zones, dashboard, deep-link, archive, activity, notifs, analytics, SSRF flag, tests); status table honest; no feature flag |
| v2.1 | 2026-07-17 | Phases 0–4 partial + migrated/deployed; flag removed (House brand gate only); RoomPlan/AI/Soft Transfer remain |
| v2.0 | 2026-07-17 | **Unified plan:** merged lighter draft + execution-grade plan into this single canonical doc |
| v1.4 | 2026-07-17 | (former `_Implementation_Plan`) Review-plan cycle 2: SSRF DNS-rebinding caveat; cron path fix |
| v1.3–1.0 | 2026-07-17 | (former `_Implementation_Plan`) ADRs, Phases 0–6, SSRF, queue, RoomPlan, DoD |
| v0.4–0.1 | 2026-07-17 | (former lighter draft) Phased P0–P3, UX notes, templates, runbook, gaps |

---

## 1. Readiness Gate

| Gate | Status | Notes |
|------|--------|-------|
| BRD approved or accepted for build | [ ] | Draft ready for product review |
| TRD complete enough to implement | [ ] | Draft ready for eng review |
| Open HIGH blockers resolved | [ ] | RoomPlan module choice locked (in-repo); can wait until Phase 5 |
| Data/privacy concerns reviewed | [ ] | Household-scoped; Soft Transfer Phase 7 only; AI photo consent in Phase 6 |
| Feature flag / rollout path known | [x] | No feature flag — always on for House (`isHouseBrand` + `gateHomeApiPaths` only) |

---

## 2. Non-Goals

- Full CAD / photoreal 3D design suite
- Contractor marketplace / ERP
- Survey-grade plans from casual photos alone
- Symply Budget product features inside House
- Forking Login / Chat / Tasks / Floor Plans / Widget / Watch / Analytics
- Extending Labor Hub `projects` tables (link by reference only)

---

## 3. Overview

Home Projects is a **collaborative household space for planning renovations and improvements** (bathroom remodel, replace a toilet/door, extend a sauna) — budget (estimated vs actual + contingency), materials/selections (price, photos, links), phases/milestones, blockers, attachments, and a **2D floor/wall/ceiling plan** to convey scope. Every household member sees and edits the project; core planning works with **AI off**.

**Goals**

1. Zero-to-plan in under a minute via templates (kill the blank page).
2. One honest source of truth for **budget vs actual** with a running total that updates as selections are chosen, plus a standard **contingency reserve** (default 15%).
3. A **materials board** where an item is a titled thing with price, photos, a source URL (paste-a-link clipper), status, and a comment thread.
4. A **2D plan** the household can understand: **iOS → Apple RoomPlan LiDAR scan** (measured); **Android + non-LiDAR iOS → manual 2D editor + AI photo-assist** (approximate, clearly labeled). Geometry is stored as **editable vector JSON**, rendered cross-platform with `react-native-svg`.
5. Reuse — do **not** fork — household membership, R2 uploads, the AI provider layer, the async garden-plan job pattern, floor plans, tasks, and contractors.

**Scope paths:** FE (`src/screens/home-projects/`, `src/api/home-projects.ts`, `src/stores/homeProjectStore.ts`) + BE (`backend/src/routes/home-projects.ts`, `backend/src/services/home-projects-service.ts`, `backend/src/db/schema-home-projects.ts`, migration `0105`) + iOS native module (`modules/roomplan/`, Phase 5). House brand only (`isHouseBrand` + `gateHomeApiPaths`); **no feature flag**.

**Phase count:** **8 implementation phases (Phase 0 → Phase 7)** — independently deployable slices. These are **not** the same labels as TRD product tiers **P0–P3**.

### TRD ↔ Plan crosswalk (canonical)

| TRD tier | Plan phases | Shippable? |
|----------|-------------|------------|
| **P0** (core CRUD, templates, manual geometry, AI-off) | Phase 0 → Phase 3 | **Yes — MVP** |
| **P1** (comments, activity, notifications, tasks/contractors, clipper) | Phase 4 | Incremental |
| **P2** (RoomPlan, AI schematic, PDF, summary) | Phase 5 → Phase 6 | Incremental |
| **P3** (Soft Transfer → Budget) | Phase 7 | Optional / not scheduled with MVP |

### Codebase snapshot note

Written against `main` @ commit `cd5f398e` (2026-07-17; ancestor of current `HEAD`). **Re-grep before starting each phase** — line numbers are indicative. Every "Current code" block is a *pattern to mirror* and MUST be diffed against the live file before editing.

Claims marked **⚠️ Unverified** must be confirmed before relying on them:

- ⚠️ Apple RoomPlan API surface — confirm at [developer.apple.com/documentation/roomplan](https://developer.apple.com/documentation/roomplan/). Requires **iOS 16+ and a LiDAR device**.
- ⚠️ AI model IDs — resolve through `backend/src/ai/model-resolver.ts` with `requiredCapabilities: ['image_understanding']`; confirm catalog in `model-catalog.ts`.
- ⚠️ Next migration number is `0105` — confirm with `ls backend/migrations/ | tail` (latest observed: `0104_…`).
- ⚠️ Exact `gateHomeApiPaths(app, [...])` array at `backend/src/index.ts:216` — re-read before inserting.

**Grounding confirmed to exist:** `schema-wishes.ts`, `schema-labor-hub.ts`, `schema-floor-plans.ts`, `routes/floor-plans.ts`, `routes/wishes.ts`, `routes/garden-plans.ts`, `garden-plan-job-handler.ts`, `garden-plan-generation-service.ts`, `ai/provider.ts`, `model-resolver.ts`, `chat-room.ts`, `brand-capabilities.ts`, `featureFlagService.ts`, `gateHomeApiPaths`, `src/features/budget/`, `src/api/wishes.ts`, `src/api/projects.ts`, `projectStore.ts`, `floorPlanStore.ts`, `photo-upload.ts`, `src/brand/capabilities.ts`, `src/config/features.ts`.

---

## 4. Architecture Decisions (ADRs)

| # | Decision | Chosen | Alternative | Reason |
|---|----------|--------|-------------|--------|
| A1 | Module boundary | **New `home-projects` domain** (own schema/routes/service/screens), *linking* to Labor Hub projects, tasks, contractors, floor plans | Extend Labor Hub `projects` | Labor Hub is contractor-centric; Home Projects is homeowner-driven planning. Distinct URL: Labor Hub `/projects` vs Home Projects `/home-projects`. |
| A2 | Floor-plan capture, iOS | **Apple RoomPlan (LiDAR)** in `modules/roomplan/` → vector JSON | CubiCasa; pure photogrammetry | Highest accuracy, on-device, no per-scan cost. Soft-degrades without LiDAR (A3). |
| A3 | Floor-plan capture, Android + non-LiDAR iOS | **Manual 2D editor + AI photo-assist** | Block non-LiDAR; require CubiCasa | Cross-platform; reuses vision AI + garden-plan job pattern. Output labeled **"Approximate — verify before buying."** |
| A4 | Geometry storage | **Editable vector JSON** + `source` enum (`roomplan\|manual\|ai_estimate`) + `confidence` | PNG/USDZ only | One schema, one SVG renderer for all sources. Ranking: measured > manual > AI. |
| A5 | AI schematic pipeline | **Async queue** mirroring garden-plan | Sync in-request AI | Avoids Worker CPU limits; idempotency + retry + `failed` path. |
| A6 | Budget model | **Line items** `estimate_cents` / `actual_cents` + contingency % (default 15%) | Free-form total | Industry-convergent; always-visible running total. |
| A7 | Materials clipper | **Paste-URL → OG/oEmbed fetch** (fail-soft) | Headless scrape; share-extension | Cheap, server-side, SSRF-hardened. Share-extension = later. |
| A8 | Collaboration | **Household membership** + activity feed + comments + @mentions; polling/RQ in P0/P1 | New CRDT layer | Household rails exist. Roles deferred to P1.5. |
| A9 | Brand gating | **`gateHomeApiPaths` + `isHouseBrand()`** — always on for House | Feature flag | Brand gate only; no remote kill switch for this feature. |
| A10 | State split | **React Query** for server data; **Zustand** for wizard draft + upload progress only | Everything in one store | Repo convention. |

**Floor-plan priority (locked):**

| Priority | Method | Promise in UI |
|----------|--------|---------------|
| 1 | RoomPlan LiDAR | “Measured room scan” |
| 2 | Uploaded floor plan + zones | “Your plan” |
| 3 | Manual dimensions | “Entered measurements” |
| 4 | Photo AI schematic | “Approximate draft — verify before buying” |

Do **not** auto-order materials from AI schematics.

---

## 5. Pre-Implementation Checklist

- [ ] **Git clean**, branch `feat/home-projects` off `main`.
- [ ] **Wrangler access:** `eval "$(./scripts/secrets/export-env.sh)"`; `npx wrangler whoami` OK.
- [ ] **Migration baseline:** `ls backend/migrations/ | tail` → confirm `0105` free.
- [ ] **Gate array read:** open `backend/src/index.ts:216` and copy the real `gateHomeApiPaths` array.
- [ ] **Flag registries:** `src/config/features.ts` + `featureFlagService.ts` `DEFAULT_FLAGS`.
- [ ] **RoomPlan feasibility spike** (blocks Phase 5 only): LiDAR device + iOS 16+ trivial `RoomCaptureView`.
- [ ] **TRD open questions resolved:** T1 → `src/screens/home-projects/` for v1; T3 → Browser Run HTML→PDF (client print fallback P2.0); T5 → static national cost tables in `templates.ts`.
- [ ] **AI entitlement:** use inline `assertCanUseAI(userId, env)` on Phase 6 AI endpoints.
- [ ] **`npm install`** at root and `cd backend && npm install`.
- [ ] **No new secrets** for Phases 0–5; Phase 6 reuses existing AI keys/BYOK.

---

## 6. File Plan

| File / module | Change | Owner | Phase | Risk |
|---------------|--------|-------|-------|------|
| `backend/src/db/schema-home-projects.ts` | New — all `home_project*` tables | BE | 0 | Med |
| `backend/migrations/0105_home_projects.sql` | Additive D1 tables + indexes + CHECKs (full 14-table suite) | BE | 0 | Med |
| `backend/src/index.ts` | Mount route + `gateHomeApiPaths` entry | BE | 0–1 | High |
| `backend/src/services/home-projects-service.ts` | CRUD + rollups + access checks | BE | 1 | Med |
| `backend/src/services/home-projects/templates.ts` | Template + cost-hint seeds | BE | 1 | Low |
| `backend/src/routes/home-projects.ts` | Hono routes (auth + flag + household) | BE | 1 | High |
| `backend/src/routes/__tests__/home-projects.test.ts` | Route integration tests | BE | 1 | Med |
| `src/api/home-projects.ts` | Typed client + React Query hooks | FE | 2 | Low |
| `src/api/index.ts` | Export client + types | FE | 2 | Low |
| `src/stores/homeProjectStore.ts` | Wizard/upload state (persisted via `storageHelpers`) | FE | 2 | Low |
| `src/navigation/HomeProjectsNavigator.tsx` | Stack + deep-link params | FE | 3 | Med |
| `app/home-projects.tsx` (or Settings stack) | expo-router host — **no new tab** | FE | 3 | Med |
| `src/navigation/types.ts` | `HomeProjectsStackParamList` | FE | 3 | Low |
| `src/services/navigation.ts` | `navigateToHomeProject()` | FE | 3–4 | Low |
| `src/screens/home-projects/*` | List, wizard, hub, sections | FE | 3 | Med |
| `src/components/home-projects/*` | SelectionCard, BudgetBar, Timeline, Blocker, FloorPlanEditor, AddFromLink | FE | 3–4 | Med |
| `src/screens/main/HomeScreen.tsx` + `MyHomeScreen.tsx` | Dashboard card + My Home entry (G1) | FE | 3 | Low |
| `e2e/maestro/home-projects-smoke.yaml` | E2E smoke | FE | 3 | Low |
| `backend/src/utils/safe-fetch-url.ts` | SSRF-safe fetch for clipper | BE | 4 | High |
| `src/services/notificationRouting.ts` | Register `home_project_*` types | FE | 4 | Low |
| `src/utils/notificationVisibility.ts` | Hide from child brands | FE | 4 | Low |
| `src/services/analytics.ts` | Register `home_project_*` PostHog events | FE | 4 | Low |
| `modules/roomplan/*` | iOS RoomPlan native module + config plugin | Native | 5 | High |
| `backend/wrangler.toml` + fleet `wrangler.*.toml` | `HOME_PROJECT_SCHEMATIC_QUEUE` (+DLQ) staging+prod | BE | 6 | Med |
| `backend/src/types/index.ts` (Env) | Queue binding | BE | 6 | Med |
| `backend/src/queues/consumers.ts` | Schematic consumer | BE | 6 | High |
| `backend/src/services/ai/home-project-schematic-*.ts` | Async schematic (mirror garden-plan) | BE | 6 | High |
| `backend/src/cron/scheduled.ts` | Stuck-job + orphan `pending_upload` sweepers | BE | 6 | Low |
| AI Housekeeper tool registry | `summarize_home_project` | BE | 6 | Med |
| Soft Transfer package docs | `home_project_cost_summary.v1` in `_ecosystem` / RELATIONSHIPS | Docs | 7 | Low |
| `documents/apps/symply-house/features/README.md` | Index row | Docs | 0 | Low |

**MUST NOT change:** `schema-labor-hub.ts`, `src/api/projects.ts` (Labor Hub), Login/Widget/Watch, `node_modules`, `ios/Pods`. No per-brand forks of analytics, chat, or notifications.

---

## 7. Implementation Phases

### Phase 0 — Setup & Infrastructure

**Goal:** Schema, migration, brand gate — deployable on House immediately.  
**TRD tier:** P0 scaffolding. **Blocks:** every later phase. **Deploy-after:** Worker + D1 migrate (staging→prod).

**Tasks**

1. **Drizzle schema** `backend/src/db/schema-home-projects.ts` — model TRD §4.1 tables; mirror `schema-wishes.ts` conventions (`sqliteTable`, cents as `integer`, timestamps, `$inferSelect`/`$inferInsert`). Include `contingencyPct` default 15. Nullable `createdBy` with `onDelete: 'set null'`.
2. **D1 migration** `backend/migrations/0105_home_projects.sql` (⚠️ confirm number). Hand-written SQL (additive only). **`0105` creates the FULL 14-table suite in Phase 0** — including `_comments`, `_activity`, `_tasks`, `_contractors` first *used* in Phase 4 — so Phase 4 does not force an unplanned `0106`. CHECK constraints for §4.2 enums.
3. **Brand gate** insert `/households/:householdId/home-projects` into `gateHomeApiPaths` at `index.ts:216`.

**Acceptance**

- [ ] Migration applies cleanly staging + production
- [ ] Path gated on child Workers via `gateHomeApiPaths`; always available on House
- [ ] Table/column names match TRD §4.1; enums match §4.2

**Verification**

```bash
cd backend && npm run db:generate:guard && npm run typecheck
# after migrate: child Workers → 404 on /home-projects/* via gateHomeApiPaths
```

---

### Phase 1 — Backend Foundation (CRUD + rollups + gating)

**Goal:** Full TRD §5 P0 REST surface, household-scoped, House brand-gated via `gateHomeApiPaths`. Testable via Miniflare without the app.  
**TRD tier:** P0 API. **Blocks:** Phase 3. **Deploy-after:** Worker deploy.

**Tasks**

1. **Service** `home-projects-service.ts` — CRUD for projects/selections/budget-lines/phases/milestones/blockers/attachments/plan-links/geometry(manual). Rollups: `estimateTotal`, `actualTotal`, `contingencyCents`, `budgetHealth ∈ {ok,watch,over}`. Every method checks household access (mirror `wishes-service` / `HouseholdService.verifyAccess`).
2. **Routes** `routes/home-projects.ts` — `.use('/*', authMiddleware())`; TRD §5 P0 endpoints; `GET /:id/hub` with batched reads, **cap child collections (≤200)**; cursor-paginate list + activity; optional `version` → **409** on stale PATCH; optional client `id` on `POST /` (`INSERT OR IGNORE`). Child brands 404 via `gateHomeApiPaths` (no feature flag).
3. **Mount** `app.route('/households/:householdId/home-projects', …)` — **not** under Labor Hub `/projects`.
4. **Attachments** mirror floor-plans: `upload-url` → `pending_upload` → Worker-proxied `PUT …/upload` → confirm → `ready`. Key: `home-projects/${householdId}/${projectId}/${uuid}.${ext}`. Cap 10MB; jpeg/png/webp/pdf.
5. **Templates** `home-projects/templates.ts` — seed keys in §9; default budget scaffold + 15% contingency; national-average cost hints labeled "varies by location".

**Acceptance**

- [ ] Member CRUD 200; non-member 403; child brand Worker 404; cross-household 404
- [ ] Hub loads in one request; idempotent create; stale PATCH → 409
- [ ] Templates expand once per project id

**Verification**

```bash
cd backend && npm run typecheck && npm test -- home-projects
```

---

### Phase 2 — Frontend API Client + Store + Types

**Goal:** Typed client + state; app compiles green before screens.  
**TRD tier:** P0 FE foundation. **Blocks:** Phase 3. **Deploy-after:** none (JS only).

**Tasks**

1. **API client** `src/api/home-projects.ts` (+ export from `src/api/index.ts`) — mirror `wishes.ts`/`projects.ts`. Types aligned to backend. Multipart upload via `api.upload`. Prefer `homeProjectKeys` factory.
2. **React Query hooks** — `useHomeProjects`, `useHomeProjectHub`, mutations with optimistic `onMutate` + rollback.

| Mutation | Invalidate |
|----------|------------|
| project create/archive/patch | `['home-projects', householdId]` |
| selection/budget/phase/milestone/blocker/attachment/geometry/plan-link/task/contractor | `['home-project', projectId]`, `['home-projects', householdId]` |
| comment/activity (Phase 4) | above + `['home-project-activity', projectId]` |

Hub: `refetchOnWindowFocus` + pull-to-refresh.

3. **Zustand store** `homeProjectStore.ts` — **only** wizard draft + upload progress; persist via `storageHelpers` (mirror `taskBoardStore`/`settingsStore`, **not** bare `projectStore`).

**Acceptance**

- [ ] Types compile; hooks invalidate correctly
- [ ] Store holds draft/progress only (no server cache)

**Verification**

```bash
npm test -- home-projects
```

---

### Phase 3 — Frontend Views (hub, wizard, sections) — **MVP ship**

**Goal:** Full P0 experience: list → wizard → hub (Overview/Plans/Materials/Budget/Timeline/Blockers).  
**TRD tier:** P0 UI. **Blocks:** Phase 4 wiring. **Deploy-after:** EAS OTA (House channel).

**Tasks**

1. **Navigation** — `HomeProjectsNavigator.tsx` (mirror Gardening); `app/home-projects.tsx` or Settings-adjacent stack; update `types.ts` + `navigateToHomeProject()`; screens: List, CreateWizard, Hub.
2. **Components** — `SelectionCard`, `BudgetBar`, `Timeline`, `BlockerRow`. **`AddFromLinkSheet` ships in Phase 4** (depends on clipper BE).
3. **Manual geometry editor** `FloorPlanEditor.tsx` — `react-native-svg` + gesture-handler + Reanimated; serialize to TRD §4.5 JSON; `PUT /geometry/manual`. Mind animatedProps-on-SVG caveat; enlarged hit-areas.
4. **Entry points (G1)** — Home dashboard “Projects” card + My Home → Projects. Gate with `isHouseBrand()` only. **No new tab-bar slot.**
5. **Link floor plan** + `zone_payload` JSON; budget rollup chips (target / estimate / actual + contingency).

**UX notes (must ship)** — see §8.

**Acceptance**

- [ ] Create bathroom reno from template with space + target budget
- [ ] Add selection with price + link + photo
- [ ] Add phase + blocker; attach floor-plan zone; enter manual room dims
- [ ] Hub via `GET /hub`; second member sees project
- [ ] Concurrent edit: stale PATCH → 409; hub refetch recovers
- [ ] AI-off: all of the above works
- [ ] Child brands: entry points hidden; API 404 via `gateHomeApiPaths`

**Verification**

```bash
cd backend && npm test -- home-projects
cd .. && npm test -- home-projects
# Maestro: e2e/maestro/home-projects/home-projects-smoke.yaml
```

---

### Phase 4 — Collaboration, clipper, analytics (TRD P1)

**Goal:** Collaborative + convenience layer.  
**Pre-condition:** Phases 1–3 **and** migration `0105` already created join/comment/activity tables. **Deploy-after:** Worker + EAS OTA.

**Tasks**

1. **Comments + activity** — `POST /:id/comments`, `GET /:id/activity` (cursor); append-only activity on mutations (idempotency key when present); @mentions → notify. FE: activity tab + per-selection thread.
2. **Notifications** — register exact `data.type` strings (TRD §8): `home_project_blocker_added`, `home_project_budget_over`, `home_project_phase_due`, `home_project_selection_approved`, `home_project_schematic_ready`, `home_project_schematic_failed` in `notificationRouting.ts` + `notificationVisibility.ts` → `navigateToHomeProject`.
3. **Materials clipper** — `POST /:id/selections/from-link` via `safe-fetch-url.ts`:
   - Enable `global_fetch_strictly_public` fleet-wide in `wrangler.toml`
   - `https:` only; `redirect: 'manual'`; ≤3 hops; re-validate every `Location`; strip `Authorization`/`Cookie` on cross-host redirect
   - Block private/metadata IPv4 **and** IPv6 ranges; port 443 only; 5s timeout; 512KB cap; rate-limit
   - Prefer host allow-list of known retailers; apply `safeFetchUrl` to `og:image` before R2 download
   - Fail-soft to plain link. **Residual risk:** DNS-rebinding TOCTOU not fully closable on Workers
4. **Tasks + contractors** — join tables already in `0105`; create-or-link APIs; **validate linked ids share `household_id`**. Space-detail “Plan improvement” CTA. Before/after attachment tags + gallery filter (BR-23).
5. **Analytics** — PostHog via `analytics.ts` (never forked): `home_project_created`, `_template_used`, `_selection_added`, `_budget_over`, `_scan_completed`, `_ai_schematic_completed/_failed`. Sentry tag `feature=home_projects`.

**Acceptance**

- [ ] Project work item → Task stays linked
- [ ] Comment + activity visible to members
- [ ] Notification fires on blocker create (staging)
- [ ] Clipper fail-soft; SSRF unit tests green

**Verification**

```bash
cd backend && npm test -- home-projects
npm test -- home-projects
# Maestro: project → create task → open task
```

---

### Phase 5 — iOS RoomPlan native module (TRD P2 measured)

**Goal:** LiDAR iPhone/iPad → measured 2D floor + wall elevations.  
**Pre-condition:** Phases 1–3 shipped. **Deploy-after:** **native EAS build** (`symply-house-*` iOS) — **cannot OTA-revert.**

**Tasks**

1. **Native module** `modules/roomplan/` — Expo module + config plugin: `RoomCaptureView`/`RoomCaptureSession`, `NSCameraUsageDescription`, iOS 16 + LiDAR check (`RoomPlan.isSupported`). Normalize `CapturedRoom` → TRD §4.5 vector JSON (meters). Config plugin must bump deployment target ≥16 via `expo-build-properties` — never hand-edit `ios/`. v1 is **single-room**; schema forward-compatible for iOS-17 `CapturedStructure`. Optionally keep USDZ in R2.
2. **Scan flow** — Plans → “Scan room” only when supported; `POST /:id/geometry/roomplan`; render in same `FloorPlanEditor`. Soft-degrade otherwise.
3. **Takeoff helper** — wall/floor area → paint/flooring qty suggestions as budget lines/selections (BR-22).

**Acceptance**

- [ ] LiDAR device: scan → walls/floor elevations on project
- [ ] Non-LiDAR: CTA hidden; manual path remains
- [ ] Takeoff suggests paint qty when geometry present

**Verification**

```bash
# Physical LiDAR device only — RoomPlan cannot run in Simulator
cd backend && npm test -- home-projects-geometry
```

---

### Phase 6 — AI photo-assist + summary + PDF + rollout (TRD P2)

**Goal:** Android/non-LiDAR AI path, AI summary, PDF export, safe production rollout.  
**Pre-condition:** Phases 1–4; AI entitlement confirmed. **Deploy-after:** Worker (+ queue binding).

**Tasks**

1. **Async AI schematic** — mirror `garden-plan-job-handler.ts`. `POST /:id/geometry/ai-schematic` → `assertCanUseAI` + flag → `status=generating` → queue message = **IDs + R2 keys only** (≤128 KB; never photo bytes). `POST /:id/geometry/:geometryId/cancel`. Consumer: vision model via `model-resolver`; prefer Anthropic Structured Outputs with `tool_use` fallback; normalize with `source:'ai_estimate'` + disclaimer. Bind queue in **all fleet** wrangler tomls (`max_batch_size = 1`, `max_retries = 3`). Push ready/failed notifications.
2. **AI material list & scope** — `POST /:id/ai/scope` → suggested selections as `status=idea` — never auto-order.
3. **AI Housekeeper** — `summarize_home_project` tool.
4. **PDF export** — `POST /:id/export.pdf` via Cloudflare Browser Run → R2 cache → `{ pdfUrl }`. Fallback P2.0: client print/share. Do **not** assume reports-stack PDF generation (ingestion only).
5. **Rollout** — deploy order §13; flag `true` staging → soak → prod. Stuck-job sweeper (`generating` >30m) + orphan `pending_upload` sweeper.

**Acceptance**

- [ ] AI-on: schematic completes with disclaimer
- [ ] AI-off: schematic CTA hidden; scan/manual remain
- [ ] PDF export or client-print fallback works
- [ ] Kill switch: `aiFeaturesEnabled: false` stops new jobs

**Verification**

```bash
cd backend && npm test -- home-projects
# AI schematic integration with mocked provider (never live AI in CI)
```

---

### Phase 7 — Soft Transfer → Symply Budget (TRD P3)

**Goal:** Optional money continuity with Symply Budget. Not required for MVP.

**Tasks**

1. Draft Soft Transfer package `home_project_cost_summary.v1` in `_ecosystem` / RELATIONSHIPS.
2. Consent UI; export estimate/actual totals + categories only (not full selection PII/links unless approved).
3. Optional richer “proposed layout” markup as annotation layer — still not CAD.

**Acceptance**

- [ ] No data leaves House without consent
- [ ] Package versioned and documented

---

## 8. UX Build Notes

### Create wizard (must ship in Phase 3)

```text
Step 1 Template tiles (large, 2x2)
Step 2 Space picker (multi) + optional cover photo
Step 3 Budget target (optional) + finish month (optional)
→ Hub with checklist progress (4–5 guided next actions)
```

### Project hub information architecture

```text
Header: title · status · budget health chip · members avatars
Checklist strip (dismissible)
Sections (accordion or tabs):
  Overview | Plans | Materials | Budget | Timeline | Blockers | Tasks | Activity
FAB: Add material / Add photo / Add blocker
```

### Materials board

- Card grid (photo thumbnail, name, price, status pill)
- Quick status change
- Detail sheet for URL, qty, notes, comments
- “Add from link” paste URL → title fetch best-effort (fail soft) — Phase 4

#### Material options — shop several, pick one (migration 0162)

The board's unit of decision is an **option group**: a named surface
(“Kitchen floor”, “Master bath tile”) carrying its own area, waste allowance and
one `preferred_selection_id`. Several `home_project_selections` compete under it
and are rendered as cards.

**Money.** A grouped option contributes **nothing** to the budget until it is
picked — five flooring candidates must not put five floors into the estimate.
Picking writes one `materials` budget line; switching **re-points that same
line** rather than adding a second, which is what preserves `actual_cents` when a
member has already paid a deposit against the surface. Ungrouped selections keep
the pre-0162 behaviour exactly (priced on create).

**Comparability.** Cards lead with *what this option costs for this surface*, not
the shelf price — “$45.99” and “$52.00” are not comparable until you know one is
a 2.2 m² box and the other 1.5 m². The total is always
`ceil(area × (1 + waste) / coverage) × unitPrice`: a shop does not sell 0.9 of a
box, so the smooth product would quote a floor nobody can buy, cheaper than the
real one. Options are sorted by that total, not by unit price.

**Honesty.** Any number that cannot be computed is reported as missing with the
input that is absent (`no_price` / `no_coverage` / `no_area`), never as zero.
Cards carry their provenance (`manual` / `link_og` / `link_ai`) and a low-
confidence extraction says so.

**Grouping choice.** A named group rather than reusing `category`, because one
renovation routinely prices two floors and a category cannot carry two areas.
The winner is an id on the group rather than a flag on the option, so “exactly
one preferred” is a schema property — which matters most on the local-first
ledger, where per-field LWW would happily converge two `is_preferred` booleans
on `true`.

**Area.** Typed per group, prefilled from `home_project_geometry.floor.area_m2`
when the project has a plan (v1 and the v2 Room Surface Model both expose it —
v2 emits it as a legacy mirror) and marked `area_source: 'geometry'` so the card
can say where it came from. Typing over a prefill flips it back to `'manual'`.
Local-first is always `'manual'`: geometry is Tier D and never ledgered, so
claiming plan provenance there would label a number nobody measured.

#### AI material extraction from a shop link

`POST /:projectId/selections/from-link` fetches the page through the SSRF-guarded
`safeFetchUrl`, feeds the retailer's JSON-LD, OpenGraph tags and stripped body
text to `extract-material-listing.ts`, and writes a fully-populated card: name,
brand, vendor, sku, price, **what one unit covers**, image and the specs that
decide a renovation.

The pipeline **degrades rather than fails**, because the member's alternative to
a partial card is typing everything by hand:

| Failure | Result |
|---|---|
| Page unreachable | Selection holding the URL, `extraction_source: 'manual'` |
| No AI key configured | OpenGraph only — exactly the pre-0162 behaviour |
| Model errors | OpenGraph only; the error is logged, not raised |
| Success | Full card, `extraction_source: 'link_ai'` |

`coverage_per_unit` is the field the whole feature turns on and the one shop
pages most often omit; the prompt is told to return `null` rather than recall a
typical value, because a plausible coverage silently misprices an entire floor.
A currency the project does not use is surfaced as a spec chip, never converted —
there is no rate source in the Worker.

The vendor photo is copied into R2 (`kind: 'product_photo'`, linked by
`selection_id`) because vendor URLs rot; `image_url` is kept anyway so the card
renders during the copy and survives a failed one.

**Local-first households do not get the link import.** `createFromLink` stays a
`HouseLocalUnsupportedError`: fetching a vendor URL reveals the member's IP and
the fact that they are shopping for a bathroom, which is the class of outbound
traffic H7's egress allowlist exists to forbid. Everything else — groups,
options, pricing, picking — is local, and the arithmetic is mirrored in
`logic/homeProjects.ts` against the **same fixture table** the Worker's suite
runs (`backend/src/services/home-projects/pricing-fixtures.json`), so the two
implementations cannot drift.

### Plans section

```text
[Photos] [Floor plan] [Elevations] [Scan]
Photos: multi-angle capture tips (wall / floor / ceiling / corners)
Elevations: one card per wall + floor + ceiling
Scan: RoomPlan CTA when supported (Phase 5)
```

---

## 9. Template Spec

Defined once in `backend/src/services/home-projects/templates.ts` and mirrored for
local-first households in `src/features/house/local/logic/homeProjects.ts` — the
seeds are ledger rows the device writes itself, so both copies must carry the same
data. Record insertion order is the order the wizard lists them in; the wizard
groups them into **Rooms & spaces**, **Surfaces & furnishings**, **Systems &
structure** and **Outdoor & other**.

**A template supplies structure and no money at all.** Budget lines seed at zero —
they are rows to price, not prices — and no `contingency` line is seeded, so a
project created from a template estimates at **nothing** until its owner prices
something. The figures templates used to carry were national averages invented
without the household's city, contractor or scope, and they landed in the hub's
Estimate the moment the project existed: the same false anchor the wizard's
"~$12k avg" caption was removed for, one screen later.

Leaving the contingency line out is load-bearing rather than tidy. `computeRollups`
prefers an explicit `contingency` LINE to the percentage (`??`, and zero is a
value), so a line seeded at zero would peg the buffer at zero for the life of the
project. With no line, `contingencyPct` — the one number a template still carries,
a rate rather than an amount — computes live off whatever has actually been priced:
10% on small scoped work, 15% typical, 20% where something structural can be found
once the wall is open.

The estimate a member reads is therefore composed entirely from their own figures:

```
estimate_total = (every non-contingency budget line) + contingency
contingency    = an explicit contingency line, if they added one
                 otherwise contingency_pct × the rest
```

Pricing a material mints a `materials` budget line for it (`createSelection`), so
the Estimate moves as selections get priced. Labour and permits are the seeded rows
the member fills in themselves. The **target** budget is the one figure they own
outright, editable on the hub's Budget tab; clearing it is a real state, and
`budget_health` is always `ok` without one, because there is nothing to be over.

| Key | Type | Cont. | Prefills |
|-----|------|-------|----------|
| `bathroom_reno` | renovation | 15% | Phases: Demo, Rough-in, Surfaces, Fixtures, Finish; selections: toilet, vanity, tile, paint, exhaust fan; blocker: permits/plumbing inspection |
| `kitchen_reno` | renovation | 20% | Phases: Design & measure → Demo → Rough-in → Cabinets → Countertops → Appliances & finish; selections: cabinets, countertop, sink & faucet, backsplash, range, lighting; blockers: permits, countertop template order, appliance lead times |
| `basement_finish` | renovation | 20% | Phases: Design & permits → Framing → Rough-in → Insulation & drywall → Flooring → Finish; blockers: moisture (critical), egress window, ceiling height |
| `expand_space` | expansion | 20% | Phases: Design, Structural/permits, Demo, Build, Finish; blockers: load-bearing? (critical), electrical capacity; geometry CTA emphasized |
| `paint_refresh` | finish_refresh | 10% | Phases: Prep, Paint, Touch-up; selections: primer, paint |
| `flooring_replace` | replacement | 15% | Phases: Measure & order → Remove → Subfloor prep → Install → Trim; blockers: subfloor moisture, asbestos check on old tile, room must be emptied |
| `furniture_replace` | replacement | 10% | Phases: Measure → Choose & order → Clear old → Delivery → Place & assemble; blockers: doorway/stairwell clearance, lead time, haul-away |
| `appliance_replace` | replacement | 10% | Phases: Measure & choose → Order → Disconnect old → Install & test; blockers: gas vs electric hookup, opening size, delivery scheduling |
| `plumbing_replace` | replacement | 20% | Phases: Inspection & scope → Shut-off & drain → Supply lines → Valves & fixtures → Pressure test → Patch & restore; selections: pipe material, shut-off valves, water heater, fixtures; blockers: permit/inspection, whole-home shut-off, wall access |
| `electrical_upgrade` | replacement | 20% | Phases: Load assessment → Permit → Panel/circuit work → Device install → Inspection; blockers: permit/inspection (critical), utility disconnect, knob-and-tube or aluminum wiring |
| `hvac_replace` | replacement | 15% | Phases: Load calculation → Order → Remove old → Install → Commission; selections: furnace/air handler, AC/heat pump, thermostat, filters; blockers: ductwork compatibility, permit, rebate deadline |
| `roof_replace` | replacement | 15% | Phases: Inspection & quotes → Permit & materials → Tear-off → Deck repair → Install → Cleanup; blockers: weather window, insurance adjuster, deck rot at tear-off |
| `window_door_replace` | replacement | 15% | Phases: Measure & quote → Order → Remove → Install → Trim & seal; blockers: custom-size lead time, egress/code sizing |
| `replace_fixture` | replacement | 10% | 1 phase; fixture + hardware selections |
| `outdoor_refresh` | outdoor | 15% | Phases: Plan & measure → Clear & prep → Build/plant → Finish; selections: plants, mulch, edging, outdoor lighting; blockers: utility locate before digging, HOA approval, planting season |
| `blank` | custom | 15% | Empty hub, one contingency line seeded at zero |

Adding a template means three edits: the Worker catalogue, the device mirror, and
the wizard's `TEMPLATE_GROUPS` in `CreateHomeProjectWizard.tsx`. The create
route's `templateKey` enum is derived from the catalogue (`TEMPLATE_KEYS`), so it
needs no edit at all — that used to be a fourth hand-sync point where a forgotten
key meant a 400 on a template the wizard was already offering.

Both remaining risks are covered by tests rather than left to a reviewer's eye:
`templates.test.ts` (Worker) and `localHomeProjectsApi.test.ts` (device) each
check the key list, contingency arithmetic and sort orders, and
`CreateHomeProjectWizard.test.tsx` asserts the grid offers every catalogue key in
catalogue order — a template with no tile is one nobody can pick, and a tile with
no template seeds an empty hub in silence.

---

## 10. Data And Migration Plan

| Item | Plan |
|------|------|
| Schema change | New `home_project*` tables (additive); migration **`0105_home_projects.sql`** — full 14-table suite in Phase 0 |
| Backfill | none |
| Remote migration | staging **then** production **before** Worker deploy / flag flip |
| Rollback | Keep tables (additive); hide FE entry via brand/release if needed |

---

## 11. Test Strategy

**Unit (Jest RN / Vitest Worker):** budget rollup math, template expansion, geometry normalize, store reducers, **`safe-fetch-url` SSRF** (private IP, redirect chain, malicious `og:image`).

**Integration (Miniflare):** authZ matrix, CRUD round-trips, attachment upload-url→PUT→confirm, `POST /` idempotency, AI-schematic enqueue with **mocked** provider, comments/activity, `from-link`, `ai/scope`, `summarize_home_project`, PDF export, notification routing registration.

**E2E (Maestro House):** create bathroom from template → selection with price+photo+link → target budget → blocker → floor-plan zone → archive; second member sees it; child brands hide entry points.

**AI-off:** every Phase 0–4 flow green with AI entitlements disabled; schematic/scope gated; manual geometry + RoomPlan still work (on-device).

**Native:** RoomPlan smoke on **physical LiDAR device** only.

### AuthZ error matrix (every row → a named test)

| Scenario | Expect |
|----------|--------|
| Non-member hits any `/home-projects/*` | 403 |
| Child brand Worker (Budget) hits path | 404 (gate) |
| Link task/contractor from another household | 400/404 |
| AI schematic, AI off | gated |

### QA command matrix

| Layer | Command / check |
|-------|-----------------|
| Brand validation | `npm run validate:brand` |
| FE unit | `npm test -- home-projects` |
| E2E | Maestro under `e2e/maestro/` (House) |
| BE typecheck | `cd backend && npm run typecheck` |
| BE tests | `cd backend && npm test -- home-projects` |
| AI-off | Core CRUD with AI entitlements disabled |
| Multi-member | Two users same household; stale PATCH → 409 |
| Idempotency | Duplicate create `id` + attachment confirm do not double rows |
| Upload flow | upload-url → PUT → confirm-upload (mock R2) |

---

## 12. Risk Assessment

| Risk | Prob | Impact | Mitigation | Rollback |
|------|------|--------|------------|----------|
| RoomPlan native delays | Med | Med | Phase 5 additive; manual+AI ship first | Ship 0–4/6 without 5; hide scan CTA |
| AI schematic misleading | Med | High | Hard “Approximate…” label; never auto-order; rank measured/manual above AI | `aiFeaturesEnabled` off |
| Cross-household leak | Low | Critical | `verifyAccess` every method; integration test | Bug fix |
| Migration one env only | Low | High | Deploy order forces both envs before Worker deploy | Additive tables |
| Clipper SSRF | Low | High | `global_fetch_strictly_public`; redirect manual; IPv4/IPv6 block; host allow-list preferred. Residual: DNS-rebinding TOCTOU | Disable clipper |
| Worker CPU on sync AI | Low | Med | Async queue only | Sweeper fails stuck job |
| Native build can't OTA-revert | Med | Med | Capability check; core is OTA | Previous build; soft-degrade |
| SVG editor deps | Low | Med | Verify gesture-handler + Reanimated in Phase 3 | Defer editor |

---

## 13. Deployment Plan

**Ordered checklist (required for BE/schema):**

1. `eval "$(./scripts/secrets/export-env.sh)"`
2. `cd backend && npm run db:generate:guard && npm run typecheck && npm test -- home-projects`
3. `npm run db:migrate:remote -- --env staging`
4. `npm run db:migrate:remote -- --env production`
5. `npm run deploy:fleet` (gate keeps children 404)
6. Complete Phase 3 FE OTA on staging
7. Maestro + multi-member soak
8. EAS OTA House production
9. (Phase 5) native `eas build` → TestFlight

| Change type | Required action |
|-------------|-----------------|
| Phases 0–4 / 6 Worker + D1 | Steps 1–5 |
| Phases 0–4 / 6 FE JS | EAS OTA House channel |
| Phase 5 RoomPlan native | EAS **build** `symply-house-*` iOS — not OTA |
| Phase 6 AI jobs | Queue + DLQ in **all fleet** wrangler tomls, Env, consumers |

### Operational runbook

| Failure | Detection | Remediation |
|---------|-----------|-------------|
| 500 on create | Sentry `feature=home_projects` | Check migration applied |
| Stuck schematic job | `geometry.status=generating` >30m | Cancel endpoint; set failed; notify |
| Orphan uploads | `pending_upload` >24h | Cron sweeper deletes row + R2 key |
| Wrong Worker exposes routes | Budget hits `/home-projects` | Verify `gateHomeApiPaths` |
| Member edit conflict | Stale price after partner edit | 409 on stale `version`; refetch hub |
| DLQ / failed schematic | User stuck on “generating” | Cancel + sweeper |
| Migration not applied | 500 on create | Verify D1 on staging **and** prod before deploy |

---

## 14. Rollback Procedures

| Phase | Rollback |
|-------|----------|
| 0–4 | Ship FE revert / hide entry points via release; tables stay (additive). |
| 4 notifications | Above + disable `home_project_*` emitters / cron |
| 5 RoomPlan | Capability check hides scan; native build cannot OTA-revert — JS flag hides CTA |
| 6 AI | Above + `aiFeaturesEnabled: false` in CONFIG_KV. Verify gated response; cancel in-flight; DLQ drains |
| 7 Soft Transfer | Disable export UI; no silent recall of exported summaries |
| Data | Migrations additive; no backfill to undo |

---

## 15. Monitoring & Observability

- **Logs:** structured, `feature=home_projects`; never log photo bytes — ids + content-types only.
- **AI photo-assist:** send only user-selected `attachmentIds`; surface consent + retention note (BYOK vs shared key differs).
- **Analytics (PostHog, brand-tagged):** created, template_used, selection_added, budget_over, scan_completed, ai_schematic_completed/failed.
- **Metrics:** schematic success rate (<90% → investigate), stuck jobs (>30m), orphan uploads (>24h), create→hub p95, 4xx/5xx on `/home-projects/*`, clipper failure rate, R2 upload-failure rate, AI token/cost per schematic/scope (alert on anomaly).

---

## 16. Definition of Done

**Per phase:** tasks complete; typecheck + tests green for touched areas; deployed staging+prod if BE/schema changed; migrations both envs; AI-off verified for shipped phases.

**MVP DoD (TRD P0 = Plan Phases 0–3):** bathroom reno from template; selection with price+link+photo; phase+blocker; floor-plan zone; manual room dims; budget bar with contingency; hub via `GET /hub`; second member sees updates; child brands 404 API; **AI-off**.

**Full feature DoD (TRD P2 = Plan Phases 5–6):** iOS LiDAR scan → measured geometry; Android/non-LiDAR manual + labeled AI draft; PDF export; AI summary; schematic queue + cancel + notifications.

**Docs:** House features index updated; no secrets committed.

---

## 17. Effort Guidance (planning only)

| Phase | Rough eng effort | Notes |
|-------|------------------|-------|
| 0–1 | 1–1.5 weeks | Schema + service + routes |
| 2–3 | 2–3.5 weeks | FE hub UI (MVP) — parallelizable after API freeze |
| 4 | 1.5–2.5 weeks | Joins + notifications + clipper |
| 5 | 2–3 weeks | Native RoomPlan dominates |
| 6 | 2–4 weeks | AI schematic + PDF + rollout |
| 7 | 1–2 weeks | Contracts + consent UI |

**MVP total (Phases 0–3):** ~3–5 weeks. Full P2 (through Phase 6): ~4–7 weeks additional for native + AI.

---

## 18. Open Gaps & Future Work

| # | Gap | Severity | Owner | Status |
|---|-----|----------|-------|--------|
| G1 | Entry: My Home + Home dashboard card (not tab bar) | medium | Product | **resolved** (My Home + Settings + `HomeProjectsHomeCard` on Today) |
| G2 | RoomPlan module → in-repo `modules/roomplan/` | high for Phase 5 | Eng | **resolved** |
| G3 | Regional cost-range tables for suggestions | low | Product | open — national averages in Phase 1; refine later |
| G4 | Contractor guest access | medium | Product | deferred |
| — | Project roles (owner/viewer) + drafts | medium | Eng | **resolved** — migration 0163, see §21 |
| — | Realtime push via `CHAT_ROOM` DO | low | Eng | P0/P1 use RQ refetch; optional later |
| — | Soft Transfer `home_project_cost_summary.v1` | medium | Product | Phase 7 |
| — | CubiCasa video-scan (premium Android accuracy) | low | Product | future |
| — | Share-extension clipper | low | Eng | future |
| — | Gantt timeline view | low | Product | Phase 3 ships list view |
| — | RoomPlan multi-room (`CapturedStructure`) | low | Eng | v1 single-room; schema forward-compatible |

---

## 19. Completion Checklist

- [ ] Code implemented in Symply Ecosystem repo only
- [ ] Relevant tests/typecheck pass for touched areas
- [ ] Backend deployed staging and production if changed
- [ ] D1 migrations applied to both envs if schema changed
- [ ] House features index updated
- [ ] No secrets printed or committed
- [ ] AI-off verified for shipped phases
- [ ] Brand validation green when brand/feature contracts touched (`npm run validate:brand`)

---

## 20. Summary

| Phase | Scope | Area | Deploy | Status |
|-------|-------|------|--------|--------|
| **0** | Schema, migration, brand gate | BE | Worker + D1 | ✅ Done |
| **1** | Service, routes, templates, attachments, selection→budget sync | BE | Worker | ✅ Done |
| **2** | API client, hooks, store (attachments/activity/409 helpers) | FE | OTA | ✅ Done (needs EAS OTA) |
| **3** | Nav, list, wizard (spaces), hub, photos, plan zones, archive, dashboard, deep-link, Timeline, Maestro | FE | OTA | ✅ Done (needs EAS OTA) |
| **4** | Comments/activity UI, clipper SSRF flag, blockers/budget notifs, analytics, Space CTA | FE+BE | Worker + OTA | ✅ Done (create-task + before/after tags/gallery) |
| **5** | iOS RoomPlan native module | Native | EAS build | ✅ Capture UI + normalize + config plugin; needs EAS iOS rebuild for LiDAR |
| **6** | AI schematic/scope/summary, PDF, rollout | BE | Worker | ✅ Queue+handler+scope+PDF export (simple PDF writer; Browser Run optional later) |
| **7** | Soft Transfer → Budget | Docs+FE | Consent UI | ✅ Package + house-to-budget preset + Connect row + apply stash |

**Floor-plan strategy (locked):** iOS+LiDAR → **RoomPlan measured**; Android + non-LiDAR iOS → **manual 2D editor + AI photo-assist (approximate)**; all three normalize to one editable vector-JSON schema rendered by one SVG renderer. Measured > uploaded plan > manual > AI; AI always labeled “Approximate — verify before buying”; never auto-order materials from it.

---

## 21. Drafts & per-project permissions (migration 0163)

Closes the deferred "Project roles" gap in §18, and adds the draft state alongside
it. Two **orthogonal** questions, deliberately kept apart:

| Question | Column | Values | Default |
|---|---|---|---|
| Can you SEE it? | `home_projects.visibility` | `draft` \| `published` | `published` |
| Can you CHANGE it? | `home_projects.default_role` + `access_json` | `owner` \| `viewer` | `owner` |

`visibility` is **not** `status`. `status` is where the WORK is (`idea` →
`done`); `visibility` is who the project exists for. A draft can be
`in_progress` and a published project can be an `idea`.

### Defaults are back-compatible by construction

Every pre-0163 project reads as `published` / `owner`, which is exactly the
access every household member already had. Nobody loses anything on deploy, and
`normalizeHomeProjectVisibility` / `normalizeHomeProjectRole` make an absent or
unrecognised value read that way too.

### The resolver is shared, not duplicated

`packages/contracts/src/home-project-access.ts` holds
`effectiveHomeProjectRole`, `canViewHomeProject`, `canEditHomeProject` and the
`access_json` parser. The Worker (`home-projects-service.ts`) and the device
ledger (`localHomeProjectsApi.ts`) both **call** them — a permission that differs
by backend is a permission that leaks, and a member would be a viewer online and
an owner in a basement.

- **Creator is pinned to `owner`**, ahead of every grant including one naming
  them as a viewer. Without the pin, "set everyone to view only" makes a project
  nobody in the household can ever edit again — there is no household-admin
  override for a project's own access list.
- **A draft is its creator's alone**, not "creator plus grantees": a grant on a
  draft would be a project a member can open but that nobody told them about.
  Publishing is the act that shares it.
- **A peer's draft answers `NotFound`, never `Forbidden`.** "You may not open
  this" reveals that it exists. Same answer as a project id from another
  household, so the two are indistinguishable from outside.
- **`created_by` is `ON DELETE SET NULL`**, so a draft outlives the account that
  made it and then becomes visible to nobody. Deliberate: the alternative is a
  private plan going public the day its author leaves the household.

### Enforcement points

| Layer | Gate |
|---|---|
| Worker | `requireProjectAccess(householdId, userId, projectId, 'read' \| 'write' \| 'manage')` — one method every project-scoped service method opens with |
| Device ledger | `requireProject` (read + draft) and `requireProjectOwner` (write), raising a **403-shaped** `HouseLocalHomeProjectForbiddenError` |
| UI | `hub.my_role` — resolved by whichever backend answered, so the control the hub disables is the one the server would refuse |

The ledger gate matters more than the Worker's: a ledger **replicates the
household**, so every peer's device physically holds another member's draft row,
and there is no Worker in the write path to refuse a viewer's edit before it
converges onto everyone.

`my_role` absent is read as `owner` — a **deliberate fail-open**, and only safe
because the server is still the gate: a stale `undefined` costs a button that
403s, whereas failing closed would lock a household out of its own projects on a
cache miss.

### Delete

`DELETE /:projectId` (`manage`-gated) removes the project and **every** child row
— explicitly, not on the FK cascade, because SQLite honours `ON DELETE CASCADE`
only when `PRAGMA foreign_keys` is on for the connection and the failure is
silent. On device it is ONE op walking `HOME_PROJECT_CHILD_TABLES`, so a peer
applies the whole removal or none of it.

R2 objects for deleted attachments are **not** removed here: a bucket delete
cannot join the same batch, and a half-failure would lose the keys. They are
prefixed `home-projects/{household}/{project}/` and are sweepable.

### Surfaces

- **Hub header "…" menu** (owner-only, hidden entirely for a viewer): Edit
  budget · Manage access · Publish / Move back to a draft · Archive / Unarchive ·
  Delete. Archive moved here from a bare text link in the body. Delete is last,
  destructive, confirms twice, and offers Archive again inside its own prompt.
- **`ProjectAccessSheet`** — visibility, the "everyone else" default role, and
  per-member overrides. Nothing writes until Save; the sheet computes the diff
  against the default so a household of twelve does not store twelve identical
  rows.
- **Badges** — `Draft` and `View only` on the hub meta line; `Draft` on the list
  card (rendered on the card, not only under the Drafts tab, because the same
  card appears in search and on the Today dashboard).
- **List tabs** — Drafts is now `visibility === 'draft'` and nothing else. It
  previously also accepted `status === 'idea'` as a stand-in for local-first rows
  that had no visibility column; that stand-in is wrong now that they do, because
  a published idea under a tab promising privacy is the one mistake this feature
  must not make.

### Notifications

`notifyHousehold` short-circuits for a draft — a push about a project the
recipient cannot open would deep-link to a 404. Publishing sends
`home_project_published`; publish and unpublish are their own activity events
(`project_published` / `project_unpublished`) rather than a generic
`project_updated`, because the feed is the only record of when a plan stopped
being one person's private draft.

### Tests

| Suite | Covers |
|---|---|
| `packages/contracts/__tests__/homeProjectAccess.test.ts` | the shared resolver — defaults, creator pin, parser tolerance |
| `backend/src/services/__tests__/home-projects-access.test.ts` | that the service actually calls it on every read and write path, + delete cascade |
| `src/features/house/local/__tests__/localHomeProjectsApi.test.ts` | ledger drafts, the 403 write gate leaving **no op** behind, one-op delete convergence |
| `src/screens/home-projects/__tests__/HomeProjectHubMenu.test.tsx` | the menu action set, which is the only route to publish / access / archive / delete |
