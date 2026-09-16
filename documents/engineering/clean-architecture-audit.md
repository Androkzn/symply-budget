# Clean Architecture Audit & Improvement Plan — Symply Ecosystem

> **Status:** Track B complete · Track A opportunistic closed · §8 closed · **Version:** v3.5 · **Date:** 2026-07-17 · **Pinned to commit:** working tree (original audit `d7fd0160`)
> **Method:** Multi-agent codebase survey + direct file reads + adversarial `/review-plan` cycles + **v3.2–v3.5 delivery**. Historical counts in §5 are from the original audit pin unless noted; **current delivery status is authoritative in [§5.9](#59-current-delivery-status-v32)**.
> **Reference:** Robert C. Martin, *Clean Architecture: A Craftsman's Guide to Software Structure and Design* (2017) — the Dependency Rule, SOLID, component cohesion/coupling principles, boundaries, the Humble Object, testability.
> **Changelog:** v3.5 — A3 report/unread contracts; shared queryClient; members+chapters RQ; movement-feed invalidate. See [Revision History](#revision-history).

---

## 1. Context

This document answers a direct question: **is the Symply Ecosystem architecture clean, maintainable, and robust, measured against Clean Architecture — and what should we fix?**

**Current verdict (v3.2, after Track B + pragmatic Track A delivery):**

- **Clean (structure):** *Improved, still partial.* Macro organization remains strong (feature/domain folders, brand-as-data, cross-app RPC/JWT + Soft Transfer seams, queue pipelines). Shipped: AI factory adoption, unified errors, routes no longer call `drizzle(`, `index.ts` slimmed (~556 lines), `env.shared`/`env.native` split, savings repository pilot, brand capabilities + contracts package. Still open by design / residual: no full entity/use-case layer, god services still huge, AI bypass in `pdf-processing-service`, dual mobile server-state.
- **Maintainable:** *Better than the original audit, still at risk on god files.* Theme migration finished (`theme.colors` → `useAppColors`); dead `MainNavigator` removed; RQ hooks growing on Kaizen/notifications. Residual: `savings-service` ~3,311 / `kaizenStore` ~1,585; `DataContext.refreshAll` still mutates DTOs; brand ladders reduced but not eliminated.
- **Robust:** *Headline hazards closed.* Cron CAS + D1 run-lease (B1), report stuck-row sweep (B2), DO-backed AI rate limits (B3), report reprocess CAS + RC retryable sync (B4), DLQ consumer (B5), webhook timing-safe auth + staging fail-closed caller (B6), Sentry/`safeErrorLog` (B7), `deploy:fleet` (B8), Android/widget build guards (B9). Residual: DLQ retention still ops-doc (not 14d in wrangler), timestamp backfill stub off by default, no real optimistic-lock CAS (B10), some nav `setTimeout` bridges remain (MOB-6).

None of this needs a rewrite. This plan stays **pragmatic and backend-led**: fix the concrete violations and operational hazards that pay off, and deliberately keep Zustand, Drizzle, and Hono. **Textbook Clean Architecture (full entity/use-case layers + god-service rewrite) remains out of scope.**

---

## 2. What Clean Architecture actually asks for

A compressed rubric, used for the scorecard below:

1. **The Dependency Rule** — source-code dependencies point only inward; inner policy never knows about outer detail (UI, DB, framework, web).
2. **Entities & Use Cases** — business rules live in a core that is independent of frameworks and I/O, and can be tested without them.
3. **Frameworks/DB/Web are "details"** — plugged in at the edges behind boundaries; swappable.
4. **SOLID** — SRP, OCP, LSP, ISP, DIP at the class/module level.
5. **Component principles** — cohesion (REP/CCP/CRP) and coupling (acyclic deps, stable-dependencies, stable-abstractions).
6. **Boundaries & the Humble Object** — separate the hard-to-test edge (UI, DB, external I/O) from testable policy.
7. **Screaming Architecture** — the structure reveals the domain, not the framework.

---

## 3. Scorecard

Grades: **A** exemplary · **B** solid · **C** partial/leaky · **D** violated. **Grades below are current (v3.2)** — not the original audit snapshot. Historical evidence for open items remains in §5; delivery matrix in [§5.9](#59-current-delivery-status-v32).

| Dimension / Principle | Grade | One-line basis (current) |
|---|---|---|
| Screaming Architecture | **B+** | `src/features/*`, per-domain `backend/src/routes/*`+`services/*` reveal the domain. Unchanged strength. |
| The Dependency Rule | **B–** | Fixed: `api/client` throws `AIAccessError` (no navigate); services import `utils/errors` (not middleware); routes **0** `drizzle(`; `env.shared`/`env.native` split. Residual: services still construct Drizzle directly; fat `Env`. |
| Entities & Use Cases | **D+** | Still no `domain/entities` layer; Drizzle tables remain de-facto entities. Textbook CA out of scope. |
| Frameworks/DB as details (DIP) | **C+** | `createProviderAdapter` used in **~20** files; raw SDK outside `ai/**` ≈ gone. Residual: `pdf-processing-service` still `new GeminiProvider()`; only **one** repository pilot (`savings-repository`). |
| SRP | **D+** | `index.ts` **556** (was 1,274). God files still: savings **3,311** / budget **2,427** / utility **2,032** / `kaizenStore` **1,585**. [read @ `5f39e740`] |
| OCP | **C** | Brand capabilities + route gates shipped; ladders reduced, not eliminated (backend ~70s sites; mobile helpers/`mode.ts` remain). |
| ISP | **C–** | `Env` still a fat interface every service depends on wholesale. |
| Component cohesion / coupling | **C+** | Schema still a hub; house domain extracted to `@components/common/house`; `AppBarChart` out of UI barrel. |
| Boundaries / Humble Object | **C–** | RQ hooks + kaizen selectors growing; screens/services still fuse rules+I/O on most paths. |
| Testability | **C** | Savings repo enables in-memory fakes for that slice; most services still need Miniflare D1. |
| **— operational dimensions —** | | |
| **Security & Auth boundary** | **B+** | DO-backed AI limits (fail-closed); timing-safe Lambda webhook + required `LAMBDA_CALLBACK_API_KEY`; staging fail-closed platform caller; webhook input validation. |
| **Async & Resilience** | **B** | B1 CAS + D1 cron lease; B2 stuck-report sweep; B4 reprocess CAS + RC retry; DLQ consumer persists + alerts. Residual: DLQ retention ops (4d default), timestamp backfill stub off. |
| **Data model & migration integrity** | **B–** | 0102 partial indexes; 0103/0104 actor FK SET NULL (some tables deferred); N+1 hot paths limited. Residual: historical 0017 edit; no real `version` CAS; timestamp formats mixed until backfill enabled. |
| **Brand-identity integrity (build/deploy/native)** | **B** | `deploy:fleet`; Android patcher fail-closed; EAS/`design:build` token assert; Android `versionCode` from EAS. Residual: wrangler `[vars]` still duplicated (verify script only); committed widget tokens still need build-time bake. |
| **Observability** | **B–** | `captureException` in **16** mobile files + ErrorBoundary; backend `safeErrorLog` + `requestId` on error path. Residual: no structured/leveled logger fleet-wide. |
| **Mobile server-state & component layer** | **C** | Theme API consolidated; dead Main nav removed; RQ growing. Residual: Zustand+RQ dual model; `DataContext.refreshAll`; some nav `setTimeout` bridges. |
| **Ecosystem cross-app seams** | **A** | Soft Transfer adapters (Health+Language), contracts registry, import RPC, bridge metrics. `importTransferPackage` is an intentional stub pointing at `runSoftTransfer`. |

---

## 4. What is already good (keep and generalize)

These are real strengths — several are reference patterns to spread, not just "no action needed."

- **Cross-app ecosystem seams (A–).** `PlatformBridgeApi` is a narrow House-only RPC port (`assertHouse()` first line of every sensitive method); the platform JWT layer is textbook-hardened (ES256 asymmetric, token-class separation via `WrongTokenClassError`, `jku`/`x5u`/`crit` rejection, per-brand audience, short TTLs, single-use `jti`); soft-transfer is a consented, schema-pinned, signed, replay-protected export/import port. Evidence: [backend/src/platform-bridge-api.ts](../../backend/src/platform-bridge-api.ts), [backend/src/utils/platform-jwt.ts](../../backend/src/utils/platform-jwt.ts), [backend/src/services/soft-transfer/export-import.ts](../../backend/src/services/soft-transfer/export-import.ts).
- **The newer queue pipelines (garden-plan, task-enrichment).** Per-message ack/retry wrappers, CAS-on-status idempotency, refund-after-terminal-write, malformed→ack, exponential backoff, plus cron stuck-row reconcile sweeps as a backstop. This is the reference pattern the report + cron paths should adopt. Evidence: [backend/src/index.ts](../../backend/src/index.ts) queue wrappers, `services/ai/garden-plan-job-handler.ts`, `services/ai/task-enrichment-handler.ts`.
- **Provider-agnostic analytics & monitoring.** PostHog only in `src/services/analytics.ts`, Sentry only in `src/services/monitoring.ts`, both brand-tagged, `sendDefaultPii:false`, identity bound/reset on auth, zero per-brand forks.
- **Strong data indexing & migration guardrails.** 369 `index()` + 49 `uniqueIndex()` [grep], tenant-scoped composites matching the real query patterns; a `refuse-health-0092.sh` cross-brand apply guard.
- **Fail-closed brand resolution + uniqueness validator.** `brands/resolve.cjs` throws on unknown/missing `APP_BRAND` (no silent House default); `validate-brand.cjs` enforces cross-fleet uniqueness of bundle ids / app groups / schemes before a build.
- **The `Icon` primitive & `appColors` token layer.** One brand-data-driven `Icon` (no per-brand fork); a clean semantic color-token module. Good foundations.
- **The AI provider *interface*.** [backend/src/ai/provider.ts](../../backend/src/ai/provider.ts) is a well-shaped `AIProvider` port — the right design, currently under-enforced (see CA-2).

---

## 5. Findings Register

Severity-ranked within each group. IDs are referenced by the roadmap in §6. Evidence paths below are the **original audit snapshot** at commit `d7fd0160` unless marked otherwise. **For whether an item is fixed, see [§5.9](#59-current-delivery-status-v32)** — do not treat an open-looking row here as current production risk.

### 5.1 Structural / Clean Architecture (CA)

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| **CA-1** | High | **No persistence seam; DB is not a detail.** ~60 services take `(env, d1)` and call `drizzle(d1)` in the constructor (74 non-test service files call `drizzle(`); **zero** repository/DAO/port interfaces exist. Business logic can't be tested without a live D1. | `services/task-service.ts:75-76`, `household-service.ts:60-66`; `grep "interface .*Repository"` = 0 |
| **CA-2** | High | **The AI "port" is bypassed.** `AIProvider` interface exists, but an AI SDK is imported directly in **~13 non-adapter files** (11 Anthropic + 2 Gemini, non-test [grep]), and the intended `createProviderAdapter()` factory is **dead code (0 call sites)**. 16 sites `new ClaudeProvider()` directly. | `ai/provider-factory.ts:20` (defined, uncalled); `services/ai-housekeeper-service.ts:1`, `services/bill-extraction-service.ts:1`, +11 |
| **CA-3** | Med | **Data layer reaches out to UI/navigation.** ~~`api/client` navigates on entitlement denials.~~ **Fixed (A5):** throws `AIAccessError` + `notifyAIAccessDenied`; navigation stays in UI layer. | [src/api/client.ts](../../src/api/client.ts) |
| **CA-4** | Med | **Routes bypass services and depend on the ORM directly.** ~~14 route files called `drizzle(`.~~ **Fixed (A4 eslint):** **0** non-test route `drizzle(` call sites (lint error). Schema imports may remain for typing; CRUD goes through services. | `backend/eslint.config.js`; routes under `backend/src/routes/` |
| **CA-5** | Med | **God files (SRP).** savings 3,330 / budget 2,412 / utility 2,031 / task 1,503 services; `schema.ts` 1,755; `index.ts` 1,274 (routing + inline HTML + `/avatars` R2 + cron + queue consumers + inline SQL); `kaizenStore.ts` **1,604**. | `wc -l` [read] |
| **CA-6** | Med | **Same-named error classes duplicated with divergent bases.** ~~Services imported errors from middleware.~~ **Fixed (A1):** unified hierarchy in `utils/errors.ts`; services import from there; handler maps status. | `utils/errors.ts`; `middleware/error-handler.ts` |
| **CA-7** | Med | **OCP brand ladders.** `if`/`===` on brand instead of capability: **backend 82 sites / 19 files**, **mobile 103 / 26 files**. Adding a brand edits many closed sites. (Note: the backend, not mobile, is the heavier offender.) | `config/brand.ts`, `index.ts:396`; `src/features/budget/mode.ts` |
| **CA-8** | Low | **Config coupled to the framework.** ~~`src/config/env.ts` imports `react-native`.~~ **Fixed (v3.0/v3.2):** framework-free constants in `env.shared.ts`; RN override in `env.native.ts`; thin `env.ts` entry. | [src/config/env.shared.ts](../../src/config/env.shared.ts), [env.native.ts](../../src/config/env.native.ts) |
| **CA-9** | Low | **Dead Durable Object still bound.** ~~`JobManagerDO` still typed/bound.~~ **Fixed (A0):** class removed; wrangler `deleted_classes = ["JobManagerDO"]` (migration history tags retained). | `wrangler.toml` `deleted_classes` |
| **CA-10** | Med | **FE/BE contract drift (robustness).** No shared DTO source; `PaginatedResponse` is structurally incompatible between FE and BE; the `households` `photo_url` field is optional-`string` on FE vs nullable-`string` on BE; mobile does **zero** schema/Zod response validation. | `src/types/index.ts:33-41` vs `backend/src/types/index.ts:694-698`; `src/api/households.ts:17` |

### 5.2 Security & Auth (SEC)

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| **SEC-1** | High | **In-memory rate limiter guards paid AI/chat/coach endpoints.** ~~In-memory Map guarded paid AI.~~ **Fixed (B3):** AI actions use DO limiter; in-memory path **throws** for AI actions; fail-closed on DO errors; `ai_rate_limit_deny` kill switch. | `middleware/rate-limit.ts`; `config-flags.ts` |
| **SEC-2** | Med | **Lambda webhook auth is weak + reuses the signing secret.** `report-processed`/`report-progress` use a variable-time `apiKey !== expected` compare and fall back to `JWT_SECRET` when `LAMBDA_CALLBACK_API_KEY` is unset. The RevenueCat handler in the same file already does a constant-time compare — the good pattern just isn't reused. | `routes/webhooks.ts:28-31,96-98` vs `:137-147` |
| **SEC-3** | Med | **Inter-Worker caller check fails open off-prod.** `resolveTrustedCallerBrand` returns the caller-supplied `X-Platform-Caller-Brand` as trusted with no credential when the service token is unset and `ENVIRONMENT !== 'production'` (staging holds real data). | `middleware/platform-caller.ts:24-35` |
| **SEC-4** | Low | **Lambda webhooks lack input validation / tenancy scope.** Update any report by client-supplied id with only the shared key; no range check on `progress`; same router mounted on every brand Worker. | `routes/webhooks.ts:40-78,101-116` |
| **SEC-5** | Low | **CORS `*` + credentials; dev reflects any origin.** Inert for the mobile clients but self-contradictory and easy to carry into a browser surface. | `middleware/cors.ts:13-14,29-31,39` |
| SEC-P | ✅ | **Positives:** platform-JWT hardening (SEC boundary), child-cannot-mint tenancy invariants enforced at crypto+routing+secrets layers, Soft-Transfer `jti` + RevenueCat idempotency ledgers, fail-**closed** auth-route rate limiting, secret-hygiene scripts that never echo values. | `utils/jwt.ts:28-41`, `routes/auth.ts:110-131` |

### 5.3 Async & Resilience (RES)

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| **RES-1** | High | **Cron re-entrancy double-sends notifications.** ~~Non-atomic select→send→mark.~~ **Fixed (B1):** per-row CAS (`claimed_at`/`claim_owner`/`attempt_count`) + D1 run lease (`cron-lease.ts`); reminders CAS; stale-claim reclaim. | `migrations/0099_notification_delivery_cas.sql`; `cron-lease.ts` |
| **RES-2** | High | **Report pipeline can hang in `processing` forever.** ~~No stuck-row sweep.~~ **Fixed (B2):** `sweepStuckProcessingReports` in cron (respects `report_pipeline_paused`). | `enhanced-pdf-processor.ts`; `cron/scheduled.ts` |
| **RES-3** | Med | **Report reprocessing is non-idempotent.** `POST .../process-enhanced` re-invokes Lambda with no status guard and a fresh `jobId`; a retry/double-tap runs two full AI passes (double cost, possible duplicate writes). | `enhanced-pdf-processor.ts:32-76,117`; `routes/reports.ts:284` |
| **RES-4** | Med | **Poison-message loop in scheduled notifications.** Failures set `failed_at` but not `sent_at` and are re-selected every 5 min forever — no attempt counter, cap, or backoff. | `notification-service.ts:544-586` |
| **RES-5** | Med | **DLQs are write-only.** No `[[queues.consumers]]` for any `*-dlq`; the scanner is a heartbeat stub that can't read depth; `TASK_ENRICHMENT_DLQ` isn't even probed. Exhausted work is silently lost (CF deletes undrained DLQ messages after 4 days). | `services/aihousekeeper/dlq-scanner.ts:30-61`; `wrangler.toml:87-131` |
| **RES-6** | Med | **RevenueCat event burned on transient sync failure.** On a sync throw it logs and still sets `processed_at` — a transient RC outage permanently skips the sync (stale entitlement). | `routes/webhooks.ts:195-208` |
| **RES-7** | Low | **Synchronous Worker→Lambda on the request path** (awaited inline, returns "completed" though only dispatched). Move to `waitUntil`/queue + 202. | `routes/reports.ts:284-296` |
| RES-P | ✅ | **Positives:** garden/task queue pipelines are textbook (CAS idempotency, refund-after-terminal, malformed→ack, backoff, sweep backstop); queue dispatcher **retries** unknown queues; cron daily-job time-window guards double as re-entrancy protection; ChatRoom DO concurrency model is correct. (`JobManagerDO` design was sound but is **unused** — see CA-9; do not keep the binding “for the model.”) | `index.ts:1019-1032,1066-1177` |

### 5.4 Data model & migrations (DATA)

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| **DATA-1** | High | **A migration was edited after being applied.** `0017_add_waste_regulations.sql` was added, commented out ("column may already exist in some environments"), then re-enabled across 3 commits — direct evidence of environment drift and an immutability violation (CLAUDE.md §7). | `backend/migrations/0017_add_waste_regulations.sql` git history (`2d2a8ea1`→`9f7ee732`→`d2c6f50c`) |
| **DATA-2** | Med | **Two incompatible timestamp formats in the same TEXT columns.** DB defaults emit `datetime('now')` (`YYYY-MM-DD HH:MM:SS`); ~179 service sites write `new Date().toISOString()` (`...T...Z`). TEXT sorts lexically → `ORDER BY`/range windows can mis-order or miss rows. | `db/schema.ts:5-12`; ~179 `new Date().toISOString()` sites |
| **DATA-3** | Med | **False optimistic-locking affordance.** `auditFields.version` is spread onto ~30 tables but no service does compare-and-swap; writers blindly `version + 1`. Cost with zero protection. | `db/schema.ts:18-23`; `household-space-service.ts:228-235` |
| **DATA-4** | Med | **N+1 / unbounded reads in god services.** Per-row SELECT-then-INSERT loops; `savings-service` uses `.all()` 40× and `.limit()` 0×. Latency scales with data volume on D1. | `budget-service.ts:1835-1862`; `savings-service.ts:2008,2507` |
| **DATA-5** | Low | **Soft delete not enforced + no partial indexes.** ~131 `isNull(deleted_at)` filters but nothing guarantees them; 0 `WHERE deleted_at IS NULL` indexes → tombstones scanned on every read. | `grep`; `db/*.ts` |
| **DATA-6** | Low | **~35 `references()` omit `onDelete`** (default NO ACTION), mostly actor columns that clearly want SET NULL. | `schema-budget.ts:73`, `schema-savings.ts:51` |
| **DATA-7** | Low | **drizzle-kit generation abandoned / config lies.** `drizzle.config.ts` points at 1 of 22 schema files; `_journal.json` has 1 stale entry. Running the documented `db:generate` would emit a catastrophic wrong diff. | `drizzle.config.ts`; `migrations/meta/_journal.json` |
| DATA-P | ✅ | **Positives:** strong composite indexing matched to query patterns; cross-brand migration guard (`refuse-health-0092.sh`); 21-file domain-split schema with DRY audit helpers. | `schema-savings.ts:60-62` |

### 5.5 Brand-identity integrity — build/deploy/native (BUILD)

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| **BUILD-1** | High | **`deploy:all` is House-only.** **Fixed (B8):** use **`deploy:fleet`** for shared Worker changes; **`deploy:house:all`** for House-only (deprecated alias `deploy:all`). Docs/rules updated to match. | `backend/package.json`; `scripts/deploy-fleet.sh` |
| **BUILD-2** | High | **Android patcher fails open → wrong-brand APK.** iOS is already brand-neutral (`apply-brand-ios.cjs` only writes `Brand.generated.xcconfig` — no source-string find/replace). `apply-brand-android.cjs` still hardcodes House source strings and only *warns* (not errors) if they're missing — a silent no-op ships wrong applicationId + google-services. | `scripts/android/apply-brand-android.cjs:40-46`; contrast `scripts/ios/apply-brand-ios.cjs:23-34` |
| **BUILD-3** | High | **Widget/Watch brand read from a stale committed artifact.** The runtime brand switch reads `DesignTokens.generated.swift` (committed, currently baked to Kaizen). If a build skips `design:build`, every brand's widget/watch renders Kaizen and reads Kaizen's App Group. | `ios/SymplyEcosystemWidget/SymplyWidgetRouter.swift:47-66`; `ios/SymplyEcosystemWidget/DesignTokens.generated.swift:1-2` |
| ~~**BUILD-4**~~ | ✅ Withdrawn | **Re-verified false (v1.1).** `WidgetSyncModule.swift:8` derives `kAppGroup` at runtime from `Bundle.main.bundleIdentifier` (mirrors `AppGroup.swift`), so the claimed writer/reader App-Group divergence does not exist — the RN bridge self-corrects to the installed bundle. Residual (Low): the committed `BrandTokens.appGroup` constant is redundant but harmless. | `modules/widget-sync/ios/WidgetSyncModule.swift:8-18` |
| **BUILD-5** | Med | **Native patchers default to House while the resolver fails closed.** Both patchers `process.env.APP_BRAND || 'symply-house'` — a missing brand silently produces a House artifact, the exact case the resolver was hardened against. | `scripts/ios/apply-brand-ios.cjs:23`, `scripts/android/apply-brand-android.cjs:17` |
| **BUILD-6** | Med | **Config duplicated & hand-synced:** wrangler `[vars]` triplicated ×4 files (~12 copies of shared model ids); `eas.json` 42 profiles, ~6 use `extends`; RevenueCat key + bundle ids live in 3 places with non-obvious precedence; backend Sentry uses **one DSN for every brand** (no per-brand isolation, unlike FE). | `wrangler.toml:30-32,183-185,316-318`; `eas.json:6-476` |
| **BUILD-7** | Low | **Android version identity static** (`versionCode 1` for all brands → Play rejects 2nd upload); release inherits `signingConfigs.debug`. | `android/app/build.gradle:99-100,114` |
| BUILD-P | ✅ | **Positives:** fail-closed single-source brand resolver; cross-fleet uniqueness validator run before every build; single-target Widget/Watch kit with runtime routing (OCP/DRY done right). | `brands/resolve.cjs:37-47`; `scripts/validate-brand.cjs` |

### 5.6 Observability (OBS)

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| **OBS-1** | Med | **Handled errors are invisible in production.** `captureException`/`captureMessage` are defined but have **0 call sites** across `src/`; ~743 `catch (` / ~482 `console.error` go to console only (pattern-sensitive). Sentry sees unhandled crashes only. | `src/services/monitoring.ts:131,141`; 0 importers |
| **OBS-2** | Med | **Shared `ErrorBoundary` swallows render crashes** to `console.error`; nested boundaries preempt the root Sentry wrap → blind spot. | `src/components/common/ErrorBoundary.tsx:26-28` |
| **OBS-3** | Med | **Backend secret scrubbing is opt-in and bypassed at the busiest sink.** `log-scrubber` used in 5 files; the **global error handler logs raw `message`+`stack` unscrubbed** — the path every unhandled error flows through. | `middleware/error-handler.ts:115,183-189` |
| **OBS-4** | Low | **No structured/leveled logging or correlation.** ~693 raw `console.*`; `requestId()` is mounted but never threaded into error logs. | `index.ts:131`; `error-handler.ts:115` |
| OBS-P | ✅ | **Positives:** provider-agnostic, brand-tagged analytics/monitoring (no per-brand forks); `[observability]` enabled at 1.0 sampling across configs; metrics port with graceful fallback. | `analytics.ts`, `monitoring.ts` |

### 5.7 Mobile server-state & component layer (MOB)

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| **MOB-1** | High | **Two un-reconciled server-state strategies.** React Query in ~24 files; the rest fetch imperatively into ~34 Zustand stores with hand-rolled invalidation (`dataRevision`, `insightsDirtyHids`). Stores co-mingle UI state + server cache + invalidation. | `stores/budgetStore.ts:25-37,102-111`; `savingsStore.ts:33,84` |
| **MOB-2** | High | **`DataContext.refreshAll` is a hand-rolled global sync** that mutates server DTOs with client-only `_householdName`/`_householdId`, and reinvents retry/dedup/staleness with a 15s watchdog. | `contexts/DataContext.tsx:47-137` |
| **MOB-3** | High | **A dead authenticated navigation tree is still compiled & maintained.** `RootNavigator`'s Main branch + the 24 KB `MainNavigator` only render when `authed && onboarded`, but that state renders expo-router instead → unreachable, yet type-checked and "fixed." | `app/_layout.tsx:294-313`; `navigation/RootNavigator.tsx:293-303` |
| **MOB-4** | High | **Stalled dual theme-color API.** `useTheme().theme.colors` (~272 files) vs `useAppColors()` (~299 files), **~208 files import both**; documented migration never completed. | `theme/appColors.ts:12-18` |
| **MOB-5** | Med | **`is-dark` computed 3 independent ways** (ThemeContext, appColors, Icon — Icon still honors the legacy `clean` scheme), forced by a require cycle. | `ThemeContext.tsx:23-28`; `Icon.tsx:59-68` |
| **MOB-6** | Med | **Navigation bridging via 50ms/150ms `setTimeout` hacks** + 3 different store/URL bridge mechanisms; `flushPendingSettingsNavigation` re-queues on miss to paper over the race. | `services/navigation.ts:224-253`; `TasksNavigator.tsx:50-104` |
| **MOB-7** | Med | **Orphaned route helpers** push to expo-router paths with no route file (`/visit-checklists/:id`, `/active-visit/...`, `/contractor-comparison/:id`) → land on `+not-found`. Latent trap. | `services/navigation.ts:287-308` |
| **MOB-8** | Med | **`@components/common` leaks House domain** (PropertySwitcher/PropertyBadge/Map*) into a barrel child brands import → children transitively depend on House concepts. | `components/common/index.ts:12-19` |
| **MOB-9** | Med | **`@components/ui` barrel eager-loads heavy deps.** Importing `Button` transitively pulls `react-native-gifted-charts` (no Metro tree-shaking of barrels). | `components/ui/index.ts:1-2`; `AppBarChart.tsx:3` |
| **MOB-10** | Med | **`Icon` embeds a fragile color heuristic** (chroma/distance thresholds) that has misrendered before (onboarding tiles). | `components/ui/Icon.tsx:106-131` |
| **MOB-11** | Low | **Repo hygiene:** 3 tracked Vim `.swp` files; a per-render `console.log` in `ReportsNavigator`. | `git ls-files *.swp`; `ReportsNavigator.tsx:54` |
| MOB-P | ✅ | **Positives:** `Icon` single primitive (no per-brand fork); defensive feature-gated budget navigation; clean `appColors` semantic token layer (the target to consolidate onto). | `Icon.tsx`; `services/navigation.ts:173-197` |

### 5.8 Ecosystem seams (ECO) — minor gaps only

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| **ECO-1** | Low | **Dead adapter shims in the FE smart-engine port.** `exportTransferPackage()` returns null after discarding its result; `importTransferPackage()` returns a hardcoded failure — both re-exported as the public port. | `src/smart-engine/transfer.ts:70-96` |
| **ECO-2** | Low | **Transfer-package contract duplicated in 3 places** (backend registry, `@api/smart-engine`, FE catalog) with no shared source. | `config/transfer-package-registry.ts:5-8`; `src/smart-engine/transfer.ts:35-60` |
| **ECO-3** | Low | **Bridge auth failures/denials are unmetered** (console-only), though the metric primitive exists. | `platform-jwt.ts:166,227,273`; `bridge-control.ts:49,77` |

### 5.9 Current delivery status (v3.2)

Re-verified against working tree pin **`5f39e740`**. Legend: ✅ done · ⚠️ partial · ○ open / out of scope.

#### Track B

| Item | Status | Notes |
|---|---|---|
| **B0** Kill switches | ✅ | `config-flags.ts`: `notifications_delivery_paused`, `report_pipeline_paused`, `ai_rate_limit_deny` |
| **B1** Delivery CAS + run lease | ✅ | Migration `0099`; CAS in notification + reminder services; **D1** `cron-lease.ts` (not DO — valid roadmap alternative) |
| **B2** Report stuck-row sweep | ✅ | `sweepStuckProcessingReports` in cron |
| **B3** DO AI rate limits | ✅ | In-memory path throws for AI actions; fail-closed on DO errors |
| **B4** Reprocess CAS + RC retry | ✅ | `claimReportForProcessing`; RC sync returns retryable 503 before `processed_at` |
| **B5** DLQ consumer | ✅ | Consumer + persist + Sentry; **14d retention** applied via `npm run ops:dlq-retention` (`set-dlq-retention.sh`) |
| **B6** Webhook + platform caller | ✅ | Timing-safe compare; required `LAMBDA_CALLBACK_API_KEY`; staging fail-closed |
| **B7** Observability | ✅ | `safeErrorLog` / `onError`; mobile `captureException` (~16 files) + ErrorBoundary |
| **B8** Fleet deploy + guards | ✅ | `deploy:fleet` + preflights; DATA-1 historical (immutability freeze); drizzle-kit guard in place |
| **B9** Android / widget ship-stoppers | ✅ | Android fail-closed + EAS/`design:build` token assert (bake at build time) |
| **B10** Timestamps / limits / version CAS | ✅ | `.limit()` on hot paths; household-space `version` CAS + 409; staging **and** production `timestamp_backfill_enabled=true`; cron runs a chunk every tick while flagged |

#### Track A

| Item | Status | Notes |
|---|---|---|
| **A0** Guardrails + JobManagerDO | ✅ | JobManagerDO deleted; backend eslint bans routes/`drizzle`, service→middleware, SDK + `new *Provider` outside `ai/**`; mobile `src/api/**` navigation ban |
| **A1** AI factory + errors | ✅ | Factory adopted; errors unified; pdf path uses `createProviderAdapter` (v3.3) |
| **A2** Slim `index.ts` | ✅ | ~556 lines; cron → `cron/scheduled.ts`; queues → `queues/consumers.ts` |
| **A3** `@symply/contracts` | ✅ | Hot paths validated: households, tasks (+upcoming), reports (+detail), notifications (+unread), appliances, home-features, subscription, ai-access |
| **A4** Persistence seam | ⚠️ | Pilot only: `repositories/savings-repository.ts` — god-service rewrite out of scope by design |
| **A5** Mobile DI cleanup | ✅ | `AIAccessError` + UI-layer notify; no navigate from `api/client` |
| **A6** Brand capabilities | ✅ | Soft-transfer RPC + sibling stub + House↔Health/Language pairs capability-based |
| **A7** Humble-Object / RQ / theme / dead nav | ✅ | Members RQ on Tasks/Chat/BudgetChat/TaskDetail/AddTask; book chapters RQ; shared `queryClient`; movement feed invalidates RQ history |

#### Findings closed by delivery (summary)

| Closed | Out of scope (textbook CA) |
|---|---|
| SEC-1…5, RES-1…6, CA-2…4, CA-6…10 (pragmatic), BUILD-1…3/5–7, MOB-1…11 (pragmatic), ECO-1…3, DATA-5/6, B0–B10, A0–A3/A5–A7 | CA-1 (repos everywhere), CA-5 (god-service rewrite), A4 beyond savings pilot, entity/use-case layers, fleet structured logger |

#### Remaining (out of scope by design — textbook CA)

1. **A4** expand repositories beyond savings pilot / split god services.
2. Full entity + use-case layers.
3. `DataContext` bootstrap sync remains (intentional); further RQ dashboard migration is product-paced, not a plan gap.

---

## 6. Improvement Roadmap — two tracks

Split by intent. **Track A** is the Clean Architecture refactor (structural). **Track B** is robustness/security hardening — mostly cheap, independent, and *should not wait behind the refactor*. Each item lists the finding IDs it closes.

> **Deploy shared-backend changes fleet-wide** (see BUILD-1 / §7): House + Budget + Kaizen + Health (`deploy:budget:all`, `deploy:kaizen:all`, `deploy:health:all`, or **B8** `deploy:fleet`). These four share `backend/src` via `wrangler.toml` + `wrangler.{budget,kaizen,health}.toml`. **Language is separate** (`backend-language/`; `deploy:language:*` cds there — top-level wrangler = production). Do **not** treat Language as a fifth sibling of the shared Worker. Migrate each shared brand's staging **and** production D1, and use **expand/contract** migrations so a halt-on-failure fan-out never strands a brand.

### Track A — Clean Architecture refactor (pragmatic, backend-led)

> **Delivery (v3.5):** A0–A3, A5–A7 ✅ · A4 pilot-only by design — see §5.9. No greenfield rewrite.

**A0 · Guardrails (low effort, but *not* low-risk if enabled all at once)** — closes CA-9; *prevents regressions* of CA-2/CA-3/CA-4
- ESLint import-boundary rules: `src/api/**` may not import navigation/RN/Expo/stores-that-navigate; `backend/src/services/**` may not import `middleware/**`; ban `new ClaudeProvider(`/`GeminiProvider(` and direct `@anthropic-ai/sdk`/`@google/generative-ai` imports outside `ai/**`; ban `drizzle(` inside `routes/**`.
- ⚠️ **Sequencing:** each rule red-lines existing violators the moment it's on (~32 services import from `middleware/**` → CA-6/A1; `api/client.ts` imports navigation → CA-3/A5; 14 route files call `drizzle(` → CA-4/A4). Ship **each rule together with its refactor** (or land it with scoped `eslint-disable` + a tracking ticket) — do **not** enable the whole set up front, or `npm run lint` (the §7 gate) is red for most of the roadmap.
- Delete the dead `JobManagerDO` binding + export (CA-9) across all **4 shared-backend** wrangler files. ⚠️ If **B1** adds a new lease DO, land the `[[migrations]]` / `new_sqlite_classes` tag for that class **before or with** B1 — do not delete `JobManagerDO` in the same PR as a half-wired lease DO. Lint-ban re-import of `posthog`/`@sentry` outside the two wrapper files.

**A1 · Backend correctness seams (low-med)** — closes CA-2, CA-6
- Route all AI construction through `createProviderAdapter()` **and remove the ~13 direct-SDK imports** (CA-2 is deeper than the 16 `new ClaudeProvider()` sites — it needs the SDK pulled behind adapters).
- Unify the error classes into **one** neutral `utils/errors.ts` (reconciling the `Error` vs `ApiError` base divergence, not a simple dedupe), import from there in services, collapse the 3-place mapping (CA-6). ⚠️ **Not fully behavior-preserving:** the error handler maps HTTP status by `instanceof ApiError`, so reparenting the `Error`-based classes can silently flip a 4xx to 5xx — write characterization tests over the error→status mapping *before* the merge (see §7).

**A2 · Slim `index.ts` (low-med, mechanical)** — closes part of CA-5
- Extract inline invite HTML, `/avatars` R2 handler, `scheduled()` → `cron/`, `queue()` consumers → `queues/`. `index.ts` becomes wiring.

**A3 · Shared FE/BE contract (med)** — closes CA-10, reduces CA duplication
- **Packaging (required):** add `packages/contracts/` (npm workspace or dual path aliases in **root + `backend/tsconfig`**). Mobile `tsconfig` **excludes** `backend/**` today — do **not** import `backend/src/**` from the app. Seed Zod schemas from `backend/src/utils/validation.ts` into the package; both sides import `z.infer` types from `@symply/contracts` (name TBD). Optional response validation at the mobile `api/client` boundary (hot paths first). Reconcile incompatible `PaginatedResponse` and `photo_url` nullability (Zod `.nullable()` vs `.optional()`). **Language (`backend-language/`) stays separately contracted** unless explicitly brought into the package later.

**A4 · Persistence seam + god-service split (med-high, pilot first)** — closes CA-1, part of CA-4/CA-5
- Introduce a thin repository interface per aggregate (pilot on `savings-service`), service depends on the interface, `D1<X>Repository` implements it → services testable with an in-memory fake. Split the god service along sub-domains behind the repo. Then repeat for budget/utility/task. Stop routes from importing schema tables (CA-4).
- ⚠️ Keep the fake **additive** to real-D1 integration tests: an in-memory fake won't catch the SQL-level bugs this audit itself flags (DATA-2 lexical timestamp sort, DATA-3 CAS, `ON CONFLICT`, collation). Retain the Miniflare/`vitest-pool-workers` suite for each `D1<X>Repository`.

**A5 · Mobile Dependency-Rule cleanup (low-med)** — closes CA-3
- `api/client.ts`: throw a typed `AIAccessError` instead of navigating; move the navigation decision to a UI-layer handler.

**A6 · OCP brand capability object (med)** — closes CA-7
- Resolve brand differences once into `brand.capabilities.*` (seed from `features/budget/mode.ts`); replace the ~185 combined `if`-ladder sites (103 mobile + 82 backend). **Prioritize the backend** — it's the heavier offender (82 sites), contrary to the first draft's mobile-first framing.

**A7 · Mobile Humble-Object + server-state + dead-code (high, incremental)** — closes CA-5 (mobile), MOB-1, MOB-2, MOB-3, MOB-4, MOB-5
- Adopt the kaizen `services/` template: pull business rules into framework-free feature services + view-model hooks; slice `kaizenStore` (1,604 lines). Pick **one** server-cache owner (prefer React Query — server-state vs UI-state separation is the current consensus) and stop co-mingling UI+cache+invalidation. Do it screen-by-screen. When adopting RQ as owner, add an **AsyncStorage (or MMKV via `storageHelpers`) persister** so cold start is not a full refetch spinner wall. Sequence: migrate stores → then retire `DataContext.refreshAll` (MOB-2), not the reverse.
- **Delete the dead authenticated navigation tree** (`RootNavigator` Main branch + `MainNavigator`; MOB-3) once confirmed unreachable under expo-router.
- **Finish the stalled dual theme-color API migration** (MOB-4/MOB-5): collapse `useTheme().theme.colors` onto `useAppColors()`, extract a single leaf `useIsDarkMode` hook, then lint-ban the old path.

### Track B — Robustness & Security hardening (do early; independent of A)

> **Delivery (v3.3):** B0–B10 ✅ — see §5.9. Spec text below is retained as the design contract; B1 shipped as D1 lease; B10 prod backfill awaits staging soak.

| Item | Closes | Effort | v3.2 |
|---|---|---|---|
| **B0** **Kill switches + alerts (prerequisite for B1–B3).** **Wire** CONFIG_KV flag **reads** into the delivery / report / AI paths (not docs-only) — reuse `aihousekeeper_enabled` / kaizen scoring patterns. Flags: `notifications_delivery_paused`, `report_pipeline_paused`, `ai_rate_limit_deny` (exact keys TBD in PR; list them in §7). Each: activation cmd, verification (sub-60s), mid-stream behavior, one-line rollback. Ship monitoring alerts for SEC-1 / RES-1 / RES-2 with B0. | SEC-1, RES-1, RES-2 (ops) | Low | ✅ |
| **B1** **Two-layer delivery guard (do not claim with `sent_at`).** Pick **one** per-row shape in the PR: nullable `claimed_at` + `claim_owner` + `attempt_count` (**preferred**). **Expand migration first** (ADD COLUMN nullable — never NOT NULL without DEFAULT) on `scheduled_notifications` (and any sibling table the cron selects); fleet-deploy new Workers only after migrate-all-envs (old Workers ignore columns and can still double-send until cutover — B8 order: Expand → deploy logic → verify → Contract later). (1) **Per-row CAS:** `update()…where(and(isNull(claimed_at), isNull(sent_at)))`, act iff `meta.changes === 1`; success → `sent_at`; failure → clear `claimed_at` + `attempt_count++`; **stale-claim reclaim:** if `claimed_at` older than send-timeout TTL, treat as releasable (same cron or sweep) so crash-after-claim cannot permanently drop; cap attempts (RES-4). (2) **Reminders:** `processReminders` races on `tasks.last_reminder_sent_at` — either ADD `reminder_claimed_at` on `tasks` with the same CAS/release/reclaim, **or** CAS-update `last_reminder_sent_at` only after send using a sentinel/version pattern; specify which in the PR. (3) **Run lease:** singleton DO (preferred) or D1 conditional lease — **not KV**; auto-expire TTL; if DO, `[[migrations]]` `new_sqlite_classes` on all 4 shared wranglers + staging canary/flag. Reverse SQL for claim columns required (D1 no auto-rollback). **Shipped as D1 `cron_leases`** (`cron-lease.ts`), not a lease DO. | RES-1, RES-4 | Med | ✅ |
| **B2** Add a report stuck-row reconcile sweep (mirror the garden sweep); mark `failed` + notify past a grace window (notify path must not re-enter RES-1 without B1). | RES-2 | Low | ✅ |
| **B3** Move AI/chat/coach/aihousekeeper limiters to the **existing DO-backed** limiter (keyed by `userId` or `householdId`, not IP). **Do not** use the native per-colo Rate Limiting binding for paid AI quotas — even GA: `period` is only **10s or 60s** (cannot express 100/hr / 60/hr), counters are per-colo, and docs say it is not for accurate accounting. Fail-**closed** on DO errors (match `routes/auth.ts`). Feature-flag the cutover; **keep** in-memory behind the flag until cross-isolate verification is green, then delete it. There is no `development` Worker env (canonical: top-level/staging/production/dev-preview). Effort is **Med** (every `rateLimit(...)` call site becomes async DO). | SEC-1 | Med | ✅ |
| **B4** Guard report reprocessing on status (CAS `WHERE status IN ('pending','failed')`); leave RC `processed_at` null on transient failure. Express CAS via Drizzle, not raw SQL. (Notification attempt cap lives in B1.) | RES-3, RES-6 | Low-Med | ✅ |
| **B5** Wire a real DLQ **consumer** (persist payload + Sentry alert — undrained DLQ messages are deleted after 4 days); consider raising DLQ `message-retention-period` toward the 14-day max; probe `TASK_ENRICHMENT_DLQ`. Replicate queue-consumer config across all **4 shared** wrangler files. | RES-5 | Med | ✅ (+ `ops:dlq-retention`) |
| **B6** Harden webhook auth: dedicated `LAMBDA_CALLBACK_API_KEY` (required in all envs — fail deploy/startup if missing), `crypto.subtle.timingSafeEqual` with **no early return on length mismatch** (match CF timing-safe example / RevenueCat handler), drop `JWT_SECRET` fallback; fail-closed inter-Worker check on staging (`ENVIRONMENT !== 'production'` today). | SEC-2, SEC-3 | Low | ✅ |
| **B7** `captureException` in high-value catch blocks + wire `ErrorBoundary.componentDidCatch` to Sentry; the axios interceptor is a fine *centralized* API-error capture point (consider `httpClientIntegration`) but is not a substitute for capture-in-catch; route the global backend error handler through `safeErrorLog`. **Ship early** so B1–B3 land with visibility. | OBS-1, OBS-2, OBS-3 | Low-Med | ✅ |
| **B8** `deploy:fleet` = House+Budget+Kaizen+Health only (halt on first failure); Language stays on `deploy:language:*` / separate checklist. Rename `deploy:all`→`deploy:house:all` **and update its ~20 references** (`CLAUDE.md`, `AGENTS.md`, `CODEX.md`, `README.md`, `.cursor/rules/backend-deployment.mdc`, `documents/**`). CI: migration immutability (freeze `0017`) + `db:generate` guard (DATA-7); wire `migrations_pattern` **or** document SQL-only migrations and fix `drizzle.config.ts` schema glob. Expand/contract runbook: **Expand** → deploy all 4 brands (backward-compatible Worker) → backfill → **Switch** → **Contract** later; staging-all-brands before any production; reverse SQL scripts (D1 has no auto-rollback). Health migrate refuse-gate (`refuse-health-0092`) is not uniform — call out in the script. | BUILD-1, DATA-1, DATA-7 | Med | ✅ |
| **B9** **Ship-stoppers — do early.** Android patcher: detect source brand + **hard-fail** on missing string; Widget/Watch: derive **brand key** (and ensure `design:build` / token bake cannot ship stale Kaizen when `APP_BRAND` differs — App Group already runtime-derived, BUILD-4 withdrawn); both patchers fail-closed on missing `APP_BRAND`. | BUILD-2, BUILD-3, BUILD-5 | Med | ✅ |
| **B10** Canonicalize one ISO-8601-UTC timestamp format + chunked backfill; implement real optimistic locking (`… WHERE id=? AND version=?`, 409 on 0 rows) **per aggregate that matters** (start with household-space) **or** drop unused `version` in a contract migration; add `.limit()`/batching to the N+1 hot paths. Coordinate with B8 expand/contract — do not parallelize conflicting schema work. | DATA-2, DATA-3, DATA-4 | Med | ✅ (prod backfill after soak) |

**Original suggested order** (historical): **B0 → B9 → B8 → B7 → B1 → B2 → B3 → B4 → B6 → B5** → A0 → A1 → A3 → A2 → A4 (pilot) → A5/A6 → B10 → A7 (ongoing).

**Current residual order (v3.3):** enable B10 backfill on **production** after staging soak → opportunistic A3/A6/A7.

---

## 7. Verification

Run after each change; nothing ships without green checks + a runtime smoke. Prerequisite for Worker tests: `cd backend && npm install` when deps are missing.

- **Backend:** `cd backend && npm run typecheck && npm run lint && npm test` (Vitest on `@cloudflare/vitest-pool-workers` with real Miniflare bindings). For A4, add in-memory repository fakes and write characterization tests **before** splitting a god service. Safety net = **123 backend** test files [grep].
- **Mobile:** `npm test` (Jest) + `npm run lint`. A0's boundary rules make `npm run lint` itself the regression gate (see the A0 sequencing caveat). Keep the House-brand Jest baseline green (`icons:build` + `tokens:build` if generated brand files flip). Safety net = **253 mobile** test files [grep].
- **Contract (A3):** a test in `packages/contracts` (or dual-side import of that package) that round-trips a sample payload; verify `PaginatedResponse` call-sites compile against the single type. Must **not** require mobile to import `backend/src/**`.
- **Track B (operational) verification:**
  - **B0** — flip each wired flag; assert the code path actually pauses/denies within 60s (not just that the KV key exists); revert; assert resume. Record exact CONFIG_KV key names in the PR.
  - **B1** — expand migration applied on all 4 brands × 2 envs before logic deploy; overlapping `scheduled()`: each due notification/reminder sends **once**; send-failure releases claim; **crash-after-claim** (inject after CAS, kill isolate) is reclaimed after TTL (no permanent drop); held run-lease auto-expires; attempt cap stops poison loops; reverse SQL dry-run documented.
  - **B2** — force a `processing` report past the grace window → `failed` + notify.
  - **B3** — DO-backed limiter counts across simulated isolates; DO error → fail-closed (not unlimited); native binding must **not** be the proof for paid AI.
  - **B4** — double `process-enhanced` while `processing` is a no-op / 409; RC transient sync leaves `processed_at` null.
  - **B5** — poisoned message lands in DLQ **and** is drained by a consumer.
  - **B6** — wrong-length + wrong-value webhook keys both 401; unset `LAMBDA_CALLBACK_API_KEY` fails closed; staging rejects unauthenticated `X-Platform-Caller-Brand`.
  - **B9** — Android build with missing House strings **errors**; wrong `APP_BRAND` cannot ship; widget brand key matches installed bundle (not stale Kaizen tokens).
- **Rollback (minimum):** B0 flags for B1–B3; B3 feature-flag back to in-memory until deleted; B1 reverse SQL for claim columns (Worker rollback alone leaves columns; safe) + reclaim sweep remains harmless if logic rolled back; B6 keep old secret rotation runbook if Lambda still holds previous key for one deploy; B8 halt-on-failure leaves prior brands on last good version — do not continue production fan-out after a staging fail; B9 revert is re-run patcher + rebuild (document the previous `APP_BRAND`); B10 contract migration only after switch verified — never edit applied expands.
- **Runtime smoke:** the `verify` skill (drive the affected flow) and `ios-ui-review` for any UI-touching mobile change (A5/A7), confirming API calls fire → 2xx → decode. Native/EAS rebuild required to verify B9.
- **Deploy:** Ship shared Worker changes via **`deploy:fleet`** (House+Budget+Kaizen+Health, staging **then** production, halt on first failure); migrate each brand's D1 on both envs. House-only: **`deploy:house:all`** (deprecated alias: `deploy:all`). Language only when `backend-language/` changed (`deploy:language:*`). A1 is only *mostly* behavior-preserving (status-mapping caveat); A2–A4 should be code-only (no schema change) unless B10 is in the same train.

---

## 8. Out of scope (by the "pragmatic" decision)

Full use-case/interactor + entity layers, a DI container, and repositories *everywhere* are **not** proposed — textbook-correct but a multi-week restructure with low marginal benefit for a shipping product. Seams are added only where they pay for themselves (A4, the god services). Revisit if the team later wants the strict model.

§8 opportunistic backlog is **closed** for the pragmatic roadmap (v3.3):

| ID | Status | Note |
|---|---|---|
| MOB-6 | ✅ | All navigators use `navigateAfterInteractions` / `runWhenNavigatorReady` (v3.3) |
| MOB-7 | ✅ | Expo-router orphan helpers removed; visit flows live under Labor Hub RN stacks |
| MOB-8…11 | ✅ | House sub-barrel; AppBarChart out of UI barrel; Icon heuristic; hygiene cleaned |
| BUILD-3 | ✅ | Build-time `--assert-generated-tokens` (committed artifact bake is the build gate) |
| BUILD-6 | ✅ | `verify-shared-wrangler-vars.sh` in deploy-fleet (full eas.json merge not required) |
| BUILD-7 | ✅ | Android `versionCode` from EAS/buildNumber |
| SEC-4 / SEC-5 | ✅ | Webhook validation + CORS no-origin fix |
| DATA-5 | ✅ | `0102_soft_delete_partial_indexes.sql` |
| DATA-6 | ✅ | `0103` + `0104` applied fleet-wide |
| OBS-4 | ✅ | `requestId` on error path (fleet structured logger not in pragmatic scope) |
| ECO-1 | ✅ | Export → `runSoftTransfer`; import stub is intentional API surface |
| ECO-2 / ECO-3 | ✅ | `@symply/contracts` transfer-package; `platformMetric` on denials |
| CA-8 | ✅ | `src/config/env.shared.ts` + `env.native.ts` |

**Still out of scope by design:** textbook Clean Architecture (full entity/use-case layers + god-service rewrite) — not part of Track A/B delivery.

---

## Revision History

| Version | Date | Changes |
|---|---|---|
| **v3.5** | 2026-07-17 | **Opportunistic Track A close:** A3 report detail + unread-count schemas; shared `src/lib/queryClient.ts`; A7 members RQ on Tasks/Chat/BudgetChat/TaskDetail; `useKaizenBookChapters` + BookDetail; movement feed + push handler use RQ invalidate/prefetch; A6 sibling-stub capability check. |
| **v3.4** | 2026-07-17 | **Incremental Track A + B10:** backfill every cron tick while flagged; prod KV enabled; A3 `tasks/upcoming` validation; A6 soft-transfer capability RPC + House↔Health/Language pairs; MOB nav-when-ready in notificationRouting / garden / floor-plan / budget-chat / TasksScreen; A7 AddTaskSheet+TaskFormBody → `useHouseholdMembers`. |
| **v3.3** | 2026-07-17 | **Residual close-out:** CA-2 pdf → `createProviderAdapter` + eslint ban on `new *Provider`; MOB-6 nav `setTimeout` cleared; B5 `ops:dlq-retention` (14d) applied fleet+Language; B10 staging `timestamp_backfill_enabled` remote KV; §5.9/§8 marked closed; fleet redeployed. |
| **v3.2** | 2026-07-17 | **Code-vs-doc reconciliation** at pin `5f39e740`. Refreshed §1 verdict + §3 scorecard; added §5.9 delivery matrix (Track A/B + residuals); Track B/A status columns; §8 “mostly closed” with per-ID truth; residual order; appendix current counts. B1 noted as **D1 cron lease** (not DO). |
| v1.0 | 2026-07-15 | Initial audit + roadmap. Built from an 18-agent expansion pass; pinned to `b7077539`. |
| v1.1 | 2026-07-15 | `/review-plan` cycle. **Count corrections** (12 listed TO-values, not “9”): `$inferSelect` → 159×/28; `Env` → ~90; DATA-2 → ~179; DATA-5 → ~131; CA-6 → ~32; schema importers → 184; tests → 253/123; ClaudeProvider → 16; CA-2 → ~13 non-test; brand ladders → 103/26 mobile + 82/19 backend; BUILD-3 path → `ios/SymplyEcosystemWidget/`; plus structural CA-10 / BUILD-4 withdraw / A7 HIGH coverage. Roadmap: A0 sequencing, A1 status-map risk, B1 not-KV, B3 env naming, B8 expand/contract. Pin claim `26cc362d` was the verification tree; the v1.1 *document body* landed in a later commit (superseded by v1.2 pin). |
| v1.2 | 2026-07-16 | `/review-plan` Cycle 1. **Evidence:** CA-4 **20 non-test / 36 incl. tests**; CA-9 / RES-P JobManager; BUILD-2 iOS xcconfig; soft OBS/MOB/DATA-6; pin `d7fd0160`. **Roadmap:** B0; B1 claim≠`sent_at`; B3 DO-only paid AI; B7/B9 early; A3 `packages/contracts`; Language=`backend-language/`; B8 fleet=4; §7 B4/B6/B9. |
| **v1.4** | 2026-07-16 | **Track A batch (A3/A6/A7):** `@symply/contracts` household + task list schemas + mobile `validateApiResponse` on GET `/households` and GET `/tasks`; brand-capability conversions (bridge-control, inter-worker-client, jwt, platform-jwt, soft-transfer export, notificationVisibility, `isHouseBrand`→`homeApi`); **222** `theme.colors` call-site files migrated via `scripts/migrate-theme-colors.mjs`; ESLint warn on `theme.colors` in screens; RQ template `useNotificationHistory` + `useBiometricLogin` hooks. **Remaining brand if-ladders:** ~31 backend + ~60 mobile ≈ **91** (was ~185). **Remaining `theme.colors` files:** ~47 (mostly dual `theme.pastel` / spacing — manual). |
| **v1.5** | 2026-07-16 | **Track A6/A7 increment:** `platform-service-tokens` + `brand-gate` middleware; `isHomeApiBrand` / capability-aware `isBudgetApiEnabled`; collapsed **14** inline route gates in `index.ts`; RQ `useHouseholdMembers` on `HouseholdMembersScreen`; mechanical `theme.colors` cleanup in `Card` + `InviteBottomSheet`. **Brand ladder grep:** backend **77→68** call sites / **21→18** files; direct `brand === 'symply-*'` **8→1** (caller header only). **`theme.colors` files:** **49→46** (45 still need manual pastel/spacing). |
| **v1.6** | 2026-07-17 | **Track A7 dual-token finish:** migrated remaining **44** `theme.colors` consumer files (pastel/spacing dual-token kept on `useTheme()`); script now sorts longest token keys first to avoid prefix collisions. **`theme.colors` files:** **45→1** (`appColors.ts` docs only). **kaizenStore slice:** pure read selectors extracted to `kaizenSelectors.ts` (books + interview attempts); store delegates getters. |
| **v1.7** | 2026-07-17 | **Track B gap-close:** B7 `safeErrorLog` in error-handler + `onError`; B6 runtime + deploy-fleet preflight for `LAMBDA_CALLBACK_API_KEY`; B3 remove AI in-memory rate-limit escape hatch; B0 Sentry kill-switch notify + ops runbook; B8 stale `deploy:all` operator docs → `deploy:fleet` / brand / language. **Track A increment:** `gateHomeApiPaths` + more kaizen selectors + `useKaizenWeeklyReviews`. Health **0092/0093** still held. |
| **v1.8** | 2026-07-17 | **All backends redeployed** (fleet + Language). Language Track B: AI rate-limit fail-closed, kaizen DLQ + `0049`, env kill switches. A0 delete `JobManagerDO` source; B9 EAS `design:build` pre-install; A3 subscription contract; A4 spending repo slice; B10 goals `.limit()`; A6 more capability helpers; A7 `useKaizenBooks`; B5 DLQ retention ops runbook. Health **0092/0093** still held. |
| **v3.1** | 2026-07-17 | **Soft Transfer close-out:** **0104** applied fleet-wide (actor FKs `ON DELETE SET NULL`); import RPC (`PlatformBridgeApi.importPackage`) + House stub export for Health/Language summaries; Language `/smart-engine` `{ data }` shape + House verify/import proxy; mobile Soft Transfer UX for Health/Language + full package labels; Language↔House service tokens. Textbook CA still out of scope. |
| **v3.0** | 2026-07-17 | **100% pragmatic roadmap:** DATA-6 deferred FKs **0104**; CA-8 `env.shared`/`env.native`; BUILD-6 `verify-shared-wrangler-vars.sh` in deploy-fleet; Soft Transfer adapters for Health+Language packages; Language joined (`platform-brands` + `/smart-engine` + HOUSE_SERVICE); RELATIONSHIPS/docs updated. Textbook CA still out of scope. |
| **v2.2** | 2026-07-17 | **§8 opportunistic close-out:** MOB-6 nav-when-ready (incl. ReportsNavigator); MOB-10 Icon brand/semantic match; ECO-1 transfer shim → `runSoftTransfer`; ECO-3 `platformMetric` on bridge/JWT denials; BUILD-3 `validate-brand --assert-generated-tokens` after design:build; write-brand-xcconfig fail-closed; ASC TestFlight groups + public links. |
| **v2.1** | 2026-07-17 | **Delivery close-out:** A4 non-test route `drizzle(` = **0** (eslint error); A3 contracts on households/appliances/home-features + Health Soft Transfer packages; A6 mobile string ladders = **0** (excl. env/identity); A7 Kaizen list screens on RQ hooks (`useKaizenAttempts`/`Gtd`/questions/books/skills); `refreshAll` callers narrowed to bootstrap. Textbook CA / Language Worker join still out of scope. |
| **v2.0** | 2026-07-17 | **POC zero-user lift:** Health **0092/0093** applied staging+prod; Health joins Soft Transfer (`joinedPlatform`/`smartEngine`/`authProxyToHouse` + `HOUSE_SERVICE`); House `platform_bridge_control` Soft Transfer flags **enabled**; DATA-5/6 migrations **0102/0103** fleet-wide; timestamp backfill KV enabled; A4 drizzle out of settings/companion/public-briefing; A7 more RQ/selectors; ECO-2 contracts registry. Language still separate Worker. |
| **v1.9** | 2026-07-17 | **Track A/B gap-close batch:** A0 `JobManagerDO` wrangler bindings removed; A3 contracts expanded; A4 savings repo pilot; A6 brand-capability route gates; A7 kaizen selectors + RQ hooks; B5 DLQ consumer wired; B10 timestamp/limit hardening. **§8 opportunistic:** MOB-8 `@components/common/house` sub-barrel; MOB-9 `AppBarChart` out of `@components/ui` barrel; BUILD-7 Android `versionCode` from EAS/iOS buildNumber; SEC-4 Lambda webhook validation + report existence check; SEC-5 CORS no-origin fix; OBS-4 `requestId` in error-handler + `ProfileContext` `captureException`; ECO-1 shim doc pointers. **Left §8:** MOB-6/7/10/11, BUILD-6, DATA-5/6, ECO-2/3, CA-8. Health **0092/0093** still held; textbook CA still out of scope. |

---

## Appendix — Evidence & Reproducibility

### Current pin (v3.2) — `5f39e740`

```sh
# God-file line counts [read] @ 5f39e740
wc -l backend/src/services/{savings,budget,utility,task}-service.ts \
      backend/src/db/schema.ts backend/src/index.ts \
      src/features/kaizen/stores/kaizenStore.ts
# → savings 3311 / budget 2427 / utility 2032 / task 1503 / schema 1764 / index 556 / kaizenStore 1585

# AI factory [grep] — adopted (was 0 call sites at d7fd0160)
rg -l 'createProviderAdapter' backend/src --glob '*.ts' | wc -l   # ~20

# Routes must not call drizzle [grep]
rg -l 'drizzle\(' backend/src/routes --glob '*.ts' | grep -v __tests__ | wc -l   # 0

# Observability [grep]
rg -l 'captureException' src --glob '*.{ts,tsx}' | wc -l   # ~16

# Theme migration [grep]
rg -l 'theme\.colors' src --glob '*.{ts,tsx}' | grep -v appColors | grep -v __tests__   # empty (docs/test only)

# CA-8 / B1 / DATA-5/6 files
test -f src/config/env.shared.ts && test -f src/config/env.native.ts
test -f backend/src/services/cron-lease.ts
ls backend/migrations/010{2,3,4}_*.sql
```

### Original audit pin (v1.3) — `d7fd0160` (historical)

Numbers tagged **[grep]** / **[read]** in §5 findings tables come from these commands at the original pin. Do not treat them as current without re-running.

```sh
# God-file line counts [read]
wc -l backend/src/services/{savings,budget,utility,task,notification}-service.ts \
      backend/src/db/schema.ts backend/src/index.ts \
      src/features/kaizen/stores/kaizenStore.ts

# Entities: Drizzle tables ARE the entities [grep]
grep -rn '\$inferSelect' backend/src --include='*.ts' | wc -l   # 159 occurrences / 28 files

# Brand conditionals [grep]  (backend is the heavier offender)
grep -roE 'isKaizenBrand|isHouseBrand|isFullBudget|isBudgetOff|brand\.id ===' src --include='*.ts' --include='*.tsx' | wc -l   # 103 sites
grep -rlE 'isKaizenBrand|isHouseBrand|isFullBudget|isBudgetOff|brand\.id ===' src --include='*.ts' --include='*.tsx' | wc -l   # 26 files
grep -roE 'getAppBrand|isHomeApiEnabled|isKaizenApiEnabled|isBudgetApiEnabled' backend/src --include='*.ts' | wc -l          # 82 sites (19 files)

# AI SDK isolation bypass [grep] — HISTORICAL (factory now used)
grep -rl '@anthropic-ai/sdk' backend/src --include='*.ts' | grep -v '/ai/'   # 14 (11 excluding tests+scripts)
grep -rl '@google/generative-ai' backend/src --include='*.ts' | grep -v '/ai/' | grep -v __tests__   # 2 non-test
grep -rn 'createProviderAdapter' backend/src                                  # definition only — 0 call sites (STALE)

# DB access scatter [grep] — HISTORICAL (routes now 0 drizzle)
grep -l 'drizzle(' backend/src/routes/*.ts | wc -l                                   # 14 of 64 non-test route files
grep -rl 'drizzle(' backend/src/services --include='*.ts' | grep -v __tests__ | wc -l # 74 non-test service files
grep -rl 'db/schema' backend/src --include='*.ts' | wc -l                            # 184 files import schema tables
rg -l "from ['\"].*db/schema" backend/src/routes -g '*.ts' | grep -v __tests__ | wc -l  # 20 non-test
rg -l "from ['\"].*db/schema" backend/src/routes -g '*.ts' | wc -l                       # 36 incl. tests

# Test suites [grep]
git ls-files 'src/**/*.test.*' | wc -l         # 253 mobile
git ls-files 'backend/**/*.test.*' | wc -l      # 123 backend
grep -c 'jest.mock(' jest.setup.js              # 25
```

### Corrections applied vs. the first draft

| Claim (draft) | Corrected value | Impact |
|---|---|---|
| `kaizenStore.ts` 1,411 lines | **1,604** [read] | Flagship A7 target; other god-file counts were exact. |
| Brand ladders ~260 mobile / ~74 files; ~15 backend | **103 / 26 mobile; 82 / 19 backend** (v1.1) | **Direction inverted** — backend is heavier; A6 re-prioritized backend-first. A6 “~185 sites” = 103+82. |
| AI layer "textbook port that hides the SDK", grade A | **Interface exists but bypassed** (~13 direct-SDK imports; factory is dead code) | Grade lowered; CA-2 scope widened. |
| "Duplicate `ApiError` hierarchy in both files" | **Same-named classes, divergent bases** (`Error` vs `ApiError`); ~32 services import from middleware | CA-6 restated. |
| "30 of 64" route files use `drizzle` | **14 of 64** non-test (or 30 of 90 incl. tests) | Mixed-scope ratio corrected. |
| "36 route files import schema" (ambiguous) | **20 non-test / 36 incl. tests** (v1.2) | CA-4 + scorecard clarified. |
| 227 mobile / 113 backend test files | **253 / 123** | Safety-net sizing corrected. |
| `$inferSelect` "used 0×" | **159× / 28 files** (v1.1) | Entities evidence restated; D+ grade unchanged. |
| BUILD-4 App-Group writer/reader divergence | **Withdrawn** (v1.1) — App Group is runtime-derived | Finding removed; B9 updated. |
| BUILD-2 “iOS auto-detects source brand” | **iOS brand-neutral xcconfig**; Android fail-open remains (v1.2) | Evidence wording fixed. |
| Robust "except contract drift" | **Multiple HIGH operational hazards** (RES-1/2, SEC-1, DATA-1, BUILD-2) | Verdict reframed; Track B added. |
| Deploy via `deploy:all` (+ Language as sibling) | **House-only**; fleet = 4 shared Workers; Language = `backend-language/` (v1.2) | §6/§7/B8 corrected. |
| B1 claim-with-`sent_at` / B3 native rate-limit OK | **B1 intermediate claim + B3 DO-only for paid AI** (v1.2) | Production-safety rewrite. |
