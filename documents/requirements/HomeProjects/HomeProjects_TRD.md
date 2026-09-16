# Home Projects - Technical Requirements Document

> Product scope: [HomeProjects_BRD.md](./HomeProjects_BRD.md). Build sequencing: [HomeProjects_Implementation.md](./HomeProjects_Implementation.md).

| Field | Value |
|-------|-------|
| **Doc type** | Feature TRD |
| **Feature id** | `home-projects` |
| **Owning app** | `simple-house` (docs id; runtime `APP_BRAND=symply-house`) |
| **Status** | `draft` |
| **Version** | `v0.5` |
| **Created** | 2026-07-17 |
| **Last updated** | 2026-07-17 |
| **Feature BRD** | [HomeProjects_BRD.md](./HomeProjects_BRD.md) |
| **Implementation** | [HomeProjects_Implementation.md](./HomeProjects_Implementation.md) |

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

Implement using HomeProjects_Implementation.md. Do not redefine BRD scope.
```

---

## 0. Version History

| Version | Date | Changes |
|---------|------|---------|
| v0.1 | 2026-07-17 | Initial technical contract |
| v0.5 | 2026-07-17 | T3 PDF corrected: new Browser Run util (reports stack is ingestion only); BR-24 + export.pdf contract; Implementation pointer → unified v2.0 |
| v0.4 | 2026-07-17 | Parity with Implementation Plan v1.1: contingency_pct, from-link, ai/scope, @mentions, full notification type names |
| v0.3 | 2026-07-17 | Resolve PDF default; entry point; optimistic conflict on hot rows |

---

## 1. Requirement Inventory

| BRD Req ID | Summary | In Scope | Technical Contract Needed | Notes |
|------------|---------|----------|---------------------------|-------|
| BR-01 | Create project | Y | Schema, API, UI wizard | P0 |
| BR-02 | Household visibility + roles | Y | AuthZ on routes | P0 |
| BR-03 | Scope notes | Y | Project fields | P0 |
| BR-04 | Budget estimate/actual | Y | Budget tables + rollups | P0 |
| BR-05 | Selections board | Y | Selection entity + media | P0 |
| BR-06 | Phases/milestones | Y | Timeline entities | P0 |
| BR-07 | Blockers | Y | Blocker entity | P0 |
| BR-08 | Attachments | Y | R2 + attachment rows | P0 |
| BR-09 | Floor plan zones | Y | Link + reuse markers/zones | P0 |
| BR-10 | Tasks link | Y | FK / join table | P1 |
| BR-11 | Contractors/quotes link | Y | Join tables | P1 |
| BR-12 | Activity feed | Y | Activity log | P1 |
| BR-13 | Comments | Y | Comment entity | P1 |
| BR-14 | Notifications | Y | Notification payloads | P1 |
| BR-15 | RoomPlan scan | Y | Native module + geometry store | P2 |
| BR-16 | AI photo schematics | Y | AI job + SVG/JSON artifact | P2 |
| BR-17 | AI summary | Y | AI Housekeeper tool | P2 |
| BR-18 | Templates | Y | Seed templates JSON | P0 |
| BR-19 | Filter/archive | Y | List query + status | P0 |
| BR-20 | AI-off core | Y | No AI required for P0/P1 | P0 |
| BR-21 | Soft Transfer draft | Y | Package spec only in P3 | P3 |
| BR-22 | Takeoff assist | Y | Area → qty helper | P2 |
| BR-23 | Before/after sets | Y | Attachment tags | P1 |
| BR-24 | PDF export | Y | Browser Run HTML→PDF (R2 cache) or client print fallback | P2 |

---

## 2. Architecture And Ownership

### 2.1 System Context

```text
┌─────────────────────────────────────────────────────────────┐
│ Symply House (mobile)                                       │
│  src/screens/home-projects/  OR  src/features/home-projects │
│  stores · api client · RoomPlan module (P2)                 │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS
┌───────────────────────────▼─────────────────────────────────┐
│ Cloudflare Worker                                           │
│  /households/:id/home-projects...                           │
│  home-projects-service · attachments · AI jobs (P2)         │
│  D1 schema · R2 objects · notifications                     │
└───────┬─────────────┬───────────────┬───────────────────────┘
        │             │               │
   Floor Plans    Tasks/Quotes    AI provider
   Spaces         Chat/Notif      (optional)
```

### 2.2 Ownership Table

| Concern | Owner / Path | Contract |
|---------|--------------|----------|
| Mobile UI | `src/screens/home-projects/` (v1) with shared components under `src/components/home-projects/`; migrate to `src/features/home-projects/` if module grows | House brand gated |
| Mobile state | `src/stores/homeProjectStore.ts` | Zustand pattern like `floorPlanStore` |
| API client | `src/api/home-projects.ts` exported from `src/api/index.ts` | Typed client |
| Worker routes | `backend/src/routes/home-projects.ts` nested under households | Hono; mount + `gateHomeApiPaths` in `backend/src/index.ts` |
| Service | `backend/src/services/home-projects-service.ts` | Business logic |
| Schema | `backend/src/db/schema-home-projects.ts` + Drizzle migration | D1 |
| Templates | `backend/src/services/home-projects/templates.ts` | Seed JSON |
| Geometry (P2) | `backend/src/services/home-projects/geometry-service.ts` + iOS RoomPlan module | Optional |
| AI (P2) | Existing `backend/src/ai/provider.ts` tools | AI gate |
| Brand gate | `requireHomeApi()` via `gateHomeApiPaths` + `isHouseBrand()` on FE | Always available on House; no feature flag |

### 2.3 Reuse Rules (Do Not Fork)

| Existing system | Reuse how |
|-----------------|-----------|
| Floor plans | Reference `floor_plan_id` via `home_project_plan_links.zone_payload` (JSON). Optional P1: extend `floor_plan_markers.linked_entity_type` with `home_project` + `linked_entity_id=projectId` |
| Spaces | `space_ids[]` on project |
| Tasks | `home_project_tasks` join; create via existing task service |
| Contractors/quotes | Join tables only |
| Chat | Prefer activity + comments in v1; optional deep-link to household chat thread in P1 |
| Reports | Optional link `report_id` for inspection-driven projects |
| Attachments/R2 | Same signed upload pattern as reports/floor plans |
| Notifications | Existing notification service with new `data.type` values |

---

## 3. Feature Gates And Entitlements

| Gate | Source | Default | Contract |
|------|--------|---------|----------|
| House brand | `isHouseBrand()` + `gateHomeApiPaths` | House Workers only | Non-House Workers never expose routes; feature is always on for House |
| AI schematic / summary | `aiFeaturesEnabled` + `assertCanUseAI()` | off unless entitled | P2 AI endpoints only |
| RoomPlan | Device capability + native module | LiDAR iOS only | Soft degrade; not a remote flag |

Backend enforcement (required):

```ts
// In home-projects router, after authMiddleware:
// householdService.getHousehold(householdId, userId) on every handler
```

AI-off behavior:

- P0/P1 fully usable.
- P2 scan still works (on-device RoomPlan is not cloud AI).
- P2 photo-schematic and AI summary hidden or show upgrade/enable path.

---

## 4. Data Model

### 4.1 Entities

| Entity / table | Owner | Key fields | Notes |
|----------------|-------|------------|-------|
| `home_projects` | House | `id`, `household_id`, `title`, `type`, `template_key`, `status`, `summary`, `goals`, `constraints`, `target_budget_cents`, `currency`, `contingency_pct` (default 15), `target_start_at`, `target_end_at`, `cover_attachment_id`, `created_by`, `updated_by`, timestamps | Soft archive via status |
| `home_project_spaces` | House | `project_id`, `space_id` | M2M |
| `home_project_members` | House | `project_id`, `user_id`, `role` | **Deferred to P1.5** — P0 uses household membership only (all members read/write). Add when viewer/guest access ships (BRD G4). |
| `home_project_budget_lines` | House | `project_id`, `category`, `label`, `estimate_cents`, `actual_cents`, `selection_id?`, `sort_order` | Categories enum |
| `home_project_selections` | House | `project_id`, `name`, `category`, `status`, `qty`, `unit`, `unit_price_cents`, `vendor`, `product_url`, `surface_ref`, `notes`, `assignee_user_id`, `sort_order`, `version` | Materials board; optional `version` for 409 conflict |
| `home_project_phases` | House | `project_id`, `title`, `status`, `starts_on`, `ends_on`, `sort_order` | Timeline |
| `home_project_milestones` | House | `project_id`, `phase_id?`, `title`, `due_on`, `done_at` | |
| `home_project_blockers` | House | `project_id`, `title`, `severity`, `status`, `notes`, `resolved_at` | |
| `home_project_attachments` | House | `project_id`, `selection_id?`, `kind` (`photo`/`file`/`link`/`plan_ref`/`scan`/`schematic`), `r2_key?`, `url?`, `caption`, `tags` (JSON: before/after/elevation/…) | |
| `home_project_plan_links` | House | `project_id`, `floor_plan_id`, `zone_payload` (JSON) | Zone geometry on existing plan |
| `home_project_geometry` | House | `project_id`, `source`, `status`, `schema_version`, `payload_json`, `confidence`, `disclaimer`, `error_code` | P0: `manual` only. P2: `roomplan`, `ai_schematic` |
| `home_project_tasks` | House | `project_id`, `task_id` | P1 |
| `home_project_contractors` | House | `project_id`, `contractor_id`, `quote_id?` | P1 |
| `home_project_comments` | House | `project_id`, `selection_id?`, `user_id`, `body` | P1 |
| `home_project_activity` | House | `project_id`, `actor_user_id`, `action`, `entity_type`, `entity_id`, `meta_json` | P1 |

### 4.2 Enums (canonical)

```text
project.type: renovation | replacement | remodel | expansion | finish_refresh | outdoor | custom
  # remodel is an alias of renovation in UI; stored as renovation unless user picks "Remodel" label
project.status: idea | planning | ready | in_progress | on_hold | done | archived
selection.category: fixture | finish | material | furniture | lighting | appliance | labor_allowance | other
selection.status: idea | shortlisted | approved | rejected | ordered | installed
budget.category: materials | labor | permits | contingency | other
blocker.severity: low | medium | high | critical
blocker.status: open | resolved | wont_fix
attachment.kind: photo | file | link | plan_ref | scan | schematic
geometry.source: roomplan | manual | ai_schematic
member.role: owner | editor | viewer
```

geometry.source: roomplan | manual | ai_schematic
geometry.status: pending | generating | completed | failed   # P2 async jobs
member.role: owner | editor | viewer   # P1.5+ only
```

### 4.3 AuthZ Matrix (P0)

All routes: `authMiddleware()` + `getHousehold(householdId, userId)`.

| Action | Household member | Notes |
|--------|------------------|-------|
| List/read project + hub | yes | |
| Create/update/delete selections, budget, phases, blockers, attachments | yes | P0: any household member |
| Create/archive project | yes | Archive sets `status=archived` |
| Comment | yes | P1 |
| Link task/contractor/quote | yes | P1; verify linked ids belong to same `household_id` |
| AI schematic enqueue | yes + AI entitled | P2 |
| RoomPlan upload | yes | P2 |

**P1.5+ (when `home_project_members` ships):** introduce `viewer` read-only; only `editor`/`owner` mutate.

Linked-entity validation (required on every link/create):

- `space_id`, `floor_plan_id`, `task_id`, `contractor_id`, `quote_id` must belong to the same `household_id` as the project.

### 4.4 Rollups

- `estimate_total` = sum(budget_lines.estimate) or derived from selections in estimate modes + labor/permits lines
- `actual_total` = sum(budget_lines.actual)
- `budget_health` = `ok` | `watch` | `over` based on target vs estimate (and actual when in progress)
- Selection price changes write/update linked budget line when `sync_to_budget=true`

Migration requirements:

- [x] D1 migration required: `home_projects_*` suite
- [ ] Backfill: none (new feature)
- Apply staging **and** production

### 4.5 Geometry Payload

Minimum JSON shape for `home_project_geometry.payload_json`:

```json
{
  "units": "m",
  "floor": {
    "polygon": [[0,0],[3.2,0],[3.2,2.4],[0,2.4]],
    "area_m2": 7.68,
    "openings": [{"type": "door", "wallId": "w1", "width_m": 0.8}]
  },
  "walls": [
    {
      "id": "w1",
      "label": "North",
      "width_m": 3.2,
      "height_m": 2.4,
      "openings": [],
      "elevation_svg_key": "r2://..."
    }
  ],
  "ceiling": { "area_m2": 7.68 },
  "source_meta": { "device": "iPhone15,2", "captured_at": "..." }
}
```

---

## 5. API Contract

Base: `/households/:householdId/home-projects`

Auth: `authMiddleware()` + household membership on all routes. Mutations require household member (P0).

**Naming note:** Labor Hub contractor jobs use `/households/:householdId/projects` — do not confuse with Home Projects.

| Endpoint | Auth | Request | Response | Errors |
|----------|------|---------|----------|--------|
| `GET /` | member | query: `status`, `spaceId`, `type`, `q` | `{ projects: ProjectListItem[] }` | 403/404 |
| `POST /` | member | create DTO (+ optional `templateKey`, optional client `id` for idempotency) | `{ project }` | 400/403/404 |
| `GET /:projectId` | member | query: `include` (comma-separated) | `{ project, rollups, ...included }` | 404 |
| `GET /:projectId/hub` | member | — | `{ project, rollups, selections, budgetLines, phases, milestones, blockers, attachments, planLinks, geometry? }` | 404 |
| `PATCH /:projectId` | member | partial project | `{ project }` | 400/403/404 |
| `POST /:projectId/archive` | member | — | `{ project }` | 403 |
| `GET/POST /:projectId/selections` | member | selection DTO | list/item | |
| `POST /:projectId/selections/from-link` | member | `{ url }` | `{ selection }` | SSRF-safe OG fetch; fail-soft |
| `PATCH/DELETE /:projectId/selections/:id` | member | partial; optional `version` for conflict | item / 409 | |
| `GET/POST /:projectId/budget-lines` | member | line DTO | list/item | |
| `PATCH/DELETE /:projectId/budget-lines/:id` | member | partial; optional `version` | item / 409 | P1 conflict |
| `GET/POST /:projectId/phases` | member | phase DTO | list/item | |
| `GET/POST /:projectId/milestones` | member | milestone DTO | list/item | |
| `GET/POST /:projectId/blockers` | member | blocker DTO | list/item | |
| `POST /:projectId/attachments/upload-url` | member | `{ filename, file_size, content_type, kind }` | `{ attachment_id, upload_url, expires_at }` | |
| `PUT /:projectId/attachments/:attachmentId/upload` | member | raw bytes | `{ attachment }` | |
| `POST /:projectId/plan-links` | member | `{ floorPlanId, zonePayload }` | `{ planLink }` | |
| `PUT /:projectId/geometry/manual` | member | manual dims JSON | `{ geometry }` | P0 |
| `POST /:projectId/tasks` | member | `{ title, ...taskFields }` or `{ taskId }` | `{ link }` | P1 |
| `POST /:projectId/comments` | member | `{ body, selectionId? }` — supports `@displayName` mentions | `{ comment }` | P1 |
| `POST /:projectId/ai/scope` | member + AI | `{ attachmentIds?, description? }` | `{ suggestions }` | P2; `assertCanUseAI`; never auto-order |
| `GET /:projectId/activity` | member | cursor | `{ items }` | P1 |
| `POST /:projectId/geometry/roomplan` | member | RoomPlan export JSON | `{ geometry }` | P2 |
| `POST /:projectId/geometry/ai-schematic` | member + AI | `{ attachmentIds[] }` | `{ job_id, geometry_id }` | P2 async |
| `GET /:projectId/geometry` | member | — | `{ geometry }` | P0 manual / P2 all |
| `POST /:projectId/geometry/:geometryId/cancel` | member | — | `{ geometry }` | P2 |
| `POST /:projectId/export.pdf` | member | — | `{ pdfUrl }` or bytes | P2; **new** Browser Run HTML→PDF → cache in R2 (not reports ingestion stack); client print fallback acceptable for P2.0 |

Upload contract matches floor plans (`backend/src/routes/floor-plans.ts`): Worker-proxied PUT URL (not S3 presign). Attachment row created in `pending_upload` until PUT completes.

Offline/local behavior:

- P0: online-first; draft create may queue with existing offline patterns if household already supports optimistic creates — do not invent a new offline sync layer.
- Uploads: show progress; retry failed attachments without deleting project.

Idempotency:

- `POST /`: optional client-supplied `id` (UUID) → `INSERT OR IGNORE`; return existing on duplicate.
- Template expansion: server-side once per create (keyed by project `id`).
- `POST .../geometry/ai-schematic`: if geometry row already `generating`/`completed` for same attachment set, return existing job (garden-plan pattern).
- Attachment confirm: idempotent on `attachment_id` + `pending_upload` → `ready`.

P2 async AI schematic (mirror `garden-plan-job-handler.ts`):

```text
POST …/geometry/ai-schematic
  → assertCanUseAI()
  → INSERT home_project_geometry (source=ai_schematic, status=generating)
  → HOME_PROJECT_SCHEMATIC_QUEUE.send({ geometryId, projectId, attachmentIds })
  → return { job_id: geometryId, geometry_id }

Consumer:
  → status guard (idempotent)
  → fetch photos from R2 → ai/provider vision
  → write SVG/JSON to R2 → UPDATE status=completed|failed
  → push notification home_project_schematic_ready | home_project_schematic_failed
```

P2 PDF export (new util — **do not** reuse reports PDF ingestion):

```text
POST …/export.pdf
  → render hub summary HTML (project, budget rollups, selections, timeline)
  → Browser Run page.pdf() (or Quick Action /pdf endpoint)
  → store PDF in REPORTS_BUCKET under home-projects/${householdId}/${projectId}/export-${uuid}.pdf
  → return { pdfUrl } (signed GET or attachment row)
Fallback P2.0: client-side print/share sheet from hub WebView or RN print API — no server PDF required for MVP soak.
Reports stack parses uploaded inspection PDFs via Lambda/Claude — it does not generate PDFs on Workers today.
```

Mobile state: React Query for server data (`useQuery`/`useMutation` on hub); Zustand for wizard draft + upload progress only. Invalidate `['home-project', projectId]` and `['home-projects', householdId]` on mutations.

---

## 6. State And UX Behavior

| State | Trigger | User-visible behavior | Recovery |
|-------|---------|-----------------------|----------|
| Empty list | No projects | Templates CTA | Create wizard |
| Creating | Wizard submit | Optimistic project hub | Rollback toast on failure |
| Loading hub | Fetch project | Skeleton sections | Pull to refresh |
| Upload error | R2 fail | Banner on attachment | Retry |
| Scan unavailable | No LiDAR | Hide scan CTA; show photo/manual | — |
| AI off | Entitlement | Hide schematic/summary | Manual plan path |
| Over budget | Estimate > target | Budget chip red/watch | Adjust lines or raise target |
| Archived | Archive action | Hidden from Active; in Archived filter | Restore to previous status |

Navigation (recommended):

- Home dashboard → Projects card
- My Home → Projects
- Space detail → “Plan improvement” pre-fills `spaceId`

---

## 7. Security, Privacy, And Consent

- Auth boundary: existing household JWT/session; all queries filter `household_id`.
- Data scoping: never return cross-household projects.
- Role checks: P0 — any household member read/write; P1.5+ project roles when table ships.
- Secret handling: no product API keys in client beyond existing app config.
- Logging: no raw photo bytes in logs; log ids + content types only.
- Soft Transfer: no cross-app export until `home_project_cost_summary.v1` approved.
- Sensitive-data: treat floor plans/scans as household-sensitive (same as reports).

---

## 8. Observability

| Signal | Source | Purpose |
|--------|--------|---------|
| `home_project_created` | FE analytics + BE log | Funnel |
| `home_project_template_used` | FE | Template quality |
| `home_project_selection_added` | FE | Materials engagement |
| `home_project_budget_over` | BE | Budget health |
| `home_project_scan_completed` | FE/BE | P2 adoption |
| `home_project_ai_schematic_completed` / `_failed` | BE | P2 quality |
| Push `data.type`: `home_project_blocker_added`, `home_project_budget_over`, `home_project_phase_due`, `home_project_selection_approved`, `home_project_schematic_ready`, `home_project_schematic_failed` | BE → FE | Register in `src/services/notificationRouting.ts` + `src/utils/notificationVisibility.ts` (P1/P2) |
| Sentry tags `feature=home_projects` | FE/BE | Error triage |

Use shared PostHog wrapper (`src/services/analytics.ts`); brand-tagged; no per-brand fork.

---

## 9. Testing Strategy

| Layer | Tests |
|-------|-------|
| Unit | Store reducers, budget rollup helpers, template expansion, geometry normalize |
| Integration | Route authZ, CRUD, attachment presign mock, template create |
| E2E | Maestro: create bathroom project → add selection → set budget → archive |
| AI-off | Schematic endpoints gated; core CRUD green |
| Migration | `db:migrate` local + remote staging/prod |
| Native P2 | RoomPlan module smoke on LiDAR simulator/device |

---

## 10. Rollout And Deployment

| Item | Contract |
|------|----------|
| Feature flag | None — always on for House |
| Fleet gate | Register `/households/:householdId/home-projects` in `gateHomeApiPaths` |
| Backend deploy | `cd backend && npm run deploy:fleet` |
| D1 migrations | **staging then production** before Worker deploy |
| Deploy order | 1) migrate staging 2) migrate prod 3) deploy:fleet 4) EAS OTA staging 5) soak 6) EAS OTA prod |
| EAS update/build | OTA for P0/P1 JS; **native build** required for RoomPlan module (P2) |
| Rollback | FE release revert; P2 AI schematic uses `aiFeaturesEnabled: false`; migrations additive |
| Runbook | Stuck schematic job query (`status=generating` >30m), orphan `pending_upload` sweeper |

---

## 11. Open Questions / Blockers

| # | Question | Severity | Owner | Status |
|---|----------|----------|-------|--------|
| T1 | FE path: `src/screens/home-projects/` for v1; entry via My Home + dashboard card | medium | Eng/Product | resolved v0.3 |
| T2 | Zone markup: `home_project_plan_links.zone_payload` JSON; optional P1 marker `linked_entity_type=home_project` | medium | Eng | resolved v0.2 |
| T3 | PDF: **new** Browser Run HTML→PDF util (R2 cache); client print fallback P2.0. Reports stack = ingestion only | low | Eng | resolved v0.5 |
| T4 | RoomPlan: in-repo `modules/roomplan/` (preferred over third-party) | high for P2 | Eng | resolved v0.2 |
| T5 | Cost-range suggestions: static regional tables v1; AI ranges P2 optional | medium | Product/Eng | resolved v0.3 — defer AI ranges |

---

## 12. Acceptance

- [ ] Every in-scope BRD requirement maps to a technical contract.
- [ ] Shared User, brand, Soft Transfer rules respected.
- [ ] AI-off path covered for P0/P1.
- [ ] Reuse of floor plans/tasks/contractors is explicit (no forks).
- [ ] Testing and rollout gates are explicit.
- [ ] Implementation doc can be executed without guessing.
