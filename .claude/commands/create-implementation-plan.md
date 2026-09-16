Create a complete, production-ready Implementation Plan for the **SimpleHouse** project (React Native / Expo app + Cloudflare Workers backend).

<!-- fix-skill: v 3 -->
<!-- Do not place anything above the description line — Claude Code's skill loader reads line 1 as the description. Version marker + metadata belong below. -->


**Input:** $ARGUMENTS
Can be any of:
- Path to a TRD (and optionally a BRD): `documents/features/Feature_TRD.md`
- Feature name (no TRD yet): will offer to generate a short TRD first, then the Implementation Plan
- Existing Implementation Plan + new TRD version → UPDATE MODE

If no TRD path is provided and the user names a feature without one, ask: "Do you want me to generate a short TRD first, or write the Implementation Plan directly against a working understanding?"

---

## Project Stack Reference (SimpleHouse)

```
Frontend (React Native / Expo)
  src/
    App.tsx                     ← classic React Navigation entry (dead — entry is expo-router/entry)
    api/                        ← axios clients per domain (chat.ts, tasks.ts, reports.ts, ...)
    components/                 ← shared components
    config/env.ts               ← API_BASE_URL selection (__DEV__ → staging vs prod)
    contexts/                   ← ThemeContext, DataContext, ProfileContext, SubscriptionContext, I18nContext
    hooks/                      ← shared hooks
    navigation/                 ← React Navigation stacks (RootNavigator, MainNavigator, per-domain)
    screens/                    ← per-domain screen files (tasks/, reports/, labor-hub/, ai/, chat/, ...)
    services/                   ← singletons (navigation.ts, storage/, voice-recording.ts, notifications.ts)
    stores/                     ← Zustand stores (authStore, householdStore, taskStore, ...) with MMKV persistence
    theme/                      ← DesignTokens (colors, pastel, status, category, spacing, typography)
    types/                      ← shared TS types
    utils/                      ← helpers
  app/                          ← expo-router file-system routing (active entry)
    _layout.tsx                 ← providers + auth gate
    (tabs)/_layout.tsx          ← FloatingTabBar + 5 visible tabs
    (tabs)/*.tsx                ← tab hosts that render the RN-Navigation sub-stacks
  __tests__/                    ← Jest tests (bare minimum today)

Backend (Cloudflare Workers + Hono + D1 + Drizzle)
  backend/
    src/
      index.ts                  ← Hono app + route mounts
      ai/                       ← AIProvider interface, Claude + Gemini providers, prompts/
      controllers/
      db/                       ← Drizzle schemas + drizzle-orm setup
      durable-objects/          ← JobManagerDO, RateLimiterDO (chat session DO to be added)
      middleware/               ← auth.ts (JWT), cors.ts, rate-limit.ts
      queues/                   ← PDF + report processing queues
      routes/                   ← per-domain Hono route files
      services/                 ← business logic (chat-service, pdf-processing, ai/gemini-service, ...)
      types/index.ts            ← Env + JWT payload
      utils/                    ← jwt, responses, validators
      workers/                  ← cron + queue consumers
    migrations/                 ← D1 SQL migrations (numbered 0001_*, 0002_*, ...). Path: `backend/migrations/` — NEVER `backend/database/migrations/` (does not exist).
    wrangler.toml               ← env config (top-level default, staging [DO-broken], production, dev-preview)
    vitest.config.ts            ← @cloudflare/vitest-pool-workers setup

Templates + docs
  documents/
    features/                   ← where new TRDs + Implementation Plans live
    Requirenments/Templates/    ← Step-era templates (reference only — do not read unless asked)
    deployment/                 ← runbooks
```

**Environments (wrangler.toml):** top-level (local default — no `[env.dev]` block exists), `staging` (known-broken for Durable Objects), `production`. A `dev-preview` environment may also be defined for DO-requiring features. Re-grep `backend/wrangler.toml` before prescribing deploy commands — never assume `[env.dev]` exists.

**Migrations path:** `backend/migrations/` (confirmed via `wrangler.toml` `migrations_dir = "migrations"`). Never prescribe `backend/database/migrations/` — that directory does not exist.

**Paths are authoritative.** Prefer these patterns in the Implementation Plan; never invent Swift / Amplify / Lambda paths from older templates.

---

## MAX RESOURCES — Quality is the Only Goal

Cost is **not** a constraint. Run every agent at maximum capability:

| Setting | Value |
|---------|-------|
| Model | Only `Cursor Grok 4.5` (`grok-4.5-fast-xhigh`) or `Composer 2.5` (`composer-2.5-fast`) — never Claude Opus/Sonnet/Haiku or other models. Default research/review to Grok 4.5; use Composer 2.5 for diversity |
| Parallelism | Launch ALL research agents in a **single message** (concurrent tool calls) |
| Thoroughness | `very thorough` for all Explore agents — read every relevant file completely |
| Review cycles | Run all cycles up to the max; only exit early on genuine zero issues |
| Synthesis | Cross-reference ALL agent findings before writing output |

---

## What an Implementation Plan IS / IS NOT

**IS:** exact, numbered tasks with `file:line` refs and before/after code blocks; phase breakdown with pre-conditions, dependencies, rollback; detailed test strategy (unit, integration, E2E); risk matrix; deployment plan (Worker + RN); monitoring; rollback procedures per phase; Definition of Done per task and overall.

**IS NOT:** business requirements (TRD), architecture decisions (TRD), vague phases with no specific files/tasks.

**Pipeline:** (BRD →) TRD → Implementation Plan. The TRD is the engineering contract; the IP is the build instruction.

---

## Phase 1 — Read & Classify

1. Read the TRD in full. If a BRD exists, read it too.
2. Determine:
   - Feature Name (matches TRD header)
   - Area: FE / BE / FE+BE
   - Priority: P0 / P1 / P2
   - Phase count
   - BE deploy needed? (Yes if `backend/**` files or migrations change.)
   - RN deploy needed? (Yes if `src/**`, `app/**`, or `package.json` change.)
3. **MODE detection:**
   ```bash
   ls documents/features/*Implementation_Plan* 2>/dev/null | grep -i "<feature>"
   ```
   - Existing plan + only TRD version bumped → **UPDATE MODE** (skip research, do targeted edits).
   - Existing plan + material scope change → **NEW MODE**.
   - No existing plan → **NEW MODE**.

---

## Phase 1B — UPDATE MODE (TRD version bump)

1. Read both documents in parallel (chunk if >500 lines).
2. Extract TRD changes — prioritized table (CRITICAL / HIGH / MEDIUM / LOW).
3. **Security baseline re-verification (always):**
   - API base URL per environment (`src/config/env.ts`)
   - JWT expiry constants (`backend/wrangler.toml`)
   - Any CSP / DOMPurify config changes
   - Durable Object bindings in `backend/wrangler.toml`
   - Feature-flag keys in `CONFIG_KV`
4. Map TRD changes to plan sections. Apply targeted Edit calls CRITICAL → HIGH → MEDIUM → LOW. Do not rewrite unaffected sections.
5. Run a **single** Reviewer A (Codebase Accuracy, Explore, very thorough) on the changed sections only. Fix + re-run once if CRITICAL found. Max 2 rounds.
6. Skip Phases 2–4 full cycles. Go to Phase 5.

---

## Phase 2 — Parallel Research Agents (NEW MODE only)

> **PARALLELISM RULE:** Launch all Phase 2 agents in **one message** with concurrent Agent calls.

---

### Agent A — Deep Implementation Research (Explore, Cursor Grok 4.5 / `grok-4.5-fast-xhigh`, very thorough)

```
You are doing deep codebase research to write a precise Implementation Plan for the SimpleHouse project at /Users/andreitekhtelev/Desktop/SimpleHouse.

TRD CONTENT: [paste full TRD]

Your job: find everything needed to write exact, file:line-precise implementation tasks. Do NOT summarize — find actual code.

1. READ EVERY FILE THAT NEEDS TO CHANGE
   - For each "Needs Change" item in TRD §2/§5 file inventory: read the full relevant section.
   - For each "Missing" item: find the nearest analogous file as a template (e.g., a new route modelled on an existing one).
   - For each new Worker service / DO: read the closest existing example (durable-objects/rate-limiter.ts, services/chat-service.ts).

2. DEEP SCHEMA ANALYSIS
   - Read the relevant Drizzle schema file(s) under backend/src/db/. Confirm table shapes before adding FKs.
   - For every proposed migration in TRD §10: find the next available migration number (ls backend/migrations/).
   - Confirm no collision with in-flight branches.

3. FRONTEND ROUTE / NAVIGATION WIRING
   - Identify whether the feature lives under expo-router (app/) or classic RN navigation (src/navigation/).
   - For new screens: find the right navigator to register in (e.g., MainTabNavigator.tsx, SettingsNavigator.tsx).
   - For new deep links: first read `package.json:4` `main` field. If `expo-router/entry`, deep links live under `app/` (file-system routing); find the right sub-directory (e.g. `app/briefing/[date].tsx`). If the classic entry is live, read `src/App.tsx linking.config` and note the shape. NEVER prescribe `src/App.tsx linking` edits when expo-router is the active entry — those are dead-code edits.

4. API CLIENT + STORE WIRING
   - For every new API endpoint: find the existing api/ module to extend (or file-path for a new one).
   - For every new state: pick the right Zustand store (authStore, taskStore, etc.) or create a new one following the existing pattern (MMKV persistence via src/services/storage).
   - For every mutation: identify which TanStack Query keys need invalidation (even if the codebase doesn't use useQuery widely — some screens do).

5. BACKEND ROUTE + SERVICE DEEP READ
   - Read the full source of every route to be changed (backend/src/routes/*.ts).
   - Map every handler that needs a change with exact line.
   - Find how auth is attached (.use('/*', authMiddleware())) and confirm new routes follow the same pattern.
   - Check which services/ modules are called and whether changes cascade.

6. AI / LLM PROVIDER DEEP READ
   - Read backend/src/ai/provider.ts, claude-provider.ts, gemini-provider.ts in full.
   - If feature needs streaming or tool use: does the provider expose it today? If not, what SDK methods are available (client.messages.stream, client.messages.create with tools=...) and what changes are needed?

7. CROSS-ROUTE SAME-PATTERN SCAN (if changing auth / rate-limit / validation)
   - If the change is in a shared middleware or pattern: grep ALL routes for the same pattern. Flag each with SAME-PATTERN HIT or CLEAR.

8. FEATURE-FLAG + KILL-SWITCH WIRING
   - Read backend/src/index.ts + any existing KV helpers. Is there a getKillSwitch() helper? If not, note where to add it.
   - Confirm CONFIG_KV binding exists in wrangler.toml per environment.

9. TEST COVERAGE AUDIT
   - Run: ls backend/__tests__/ __tests__/ . Report what exists. (Note: `backend/src/__tests__/` does NOT exist in this repo — tests live at `backend/__tests__/*.test.ts` for Worker and `__tests__/*.test.tsx` for RN.)
   - For each file to change: is there a test file? If not, identify the pattern to follow (vitest for backend, jest for RN).
   - Backend tests use @cloudflare/vitest-pool-workers — confirm config at backend/vitest.config.ts.

10. DEPLOYMENT AUDIT
    - Backend: wrangler deploy --env {dev|staging|production}. Confirm per-env bindings in wrangler.toml.
    - RN: eas build + TestFlight flow per eas.json. Confirm the profile used.
    - Does this feature require a DO migration (wrangler.toml [[migrations]] block)? Flag explicitly.
    - Does this feature require a new KV binding? New Queue? New R2 bucket? Flag each.
    - Staging is known-broken for Durable Objects as of 2026-04: "Cannot use Durable Objects with Preview URLs". If the feature adds a DO, plan an alternative (parallel preview Worker or ship-to-prod-with-allowlist rollout).

11. SECURITY & PRIVACY PASS
    - Secrets: any new Worker secret required? Confirm via wrangler secret list --env production is mentioned, never committed.
    - PII in logs: does any new code log JWTs, raw email, full user IDs, or household addresses? Flag CRITICAL.
    - Auth middleware: is the new route protected by authMiddleware() at a .use('/*', ...) level? If not, flag CRITICAL.
    - Household scoping: does the new route resolve householdId from the URL param and verify membership via HouseholdService.getHousehold(hid, userId) or equivalent? Missing check = CRITICAL.
    - Tool executors (if any): do they re-verify household membership inside the executor, not just at the route? Missing = CRITICAL.
    - CORS: does backend/src/middleware/cors.ts need to allow any new origin? Most features don't.
    - WebView: if introducing react-native-webview, confirm originWhitelist, onShouldStartLoadWithRequest, and CSP are all specified.

12. MULTI-PLACE COMPLETENESS
    - For any enum, Zod schema, TypeScript type, or registration that appears in multiple places: list ALL locations that need updating.
    - For any analytics tracking call: grep existing similar calls to identify every screen that needs wiring.

13. ERROR CODE CROSS-CHECK (if TRD has an error contract)
    - Extract every error code from TRD §7 (or equivalent). Build an error-code-to-test matrix.
    - Every TRD error code must map to a named test with explicit assertion — no implied coverage.

14. IDEMPOTENCY + RACE
    - For any mutating endpoint: does the TRD require an idempotency key? If yes, how is it stored (KV? D1 table?). Confirm TTL.
    - For any concurrent-writer scenario (e.g. two tool executions for the same user): identify the lock mechanism (DO single-threaded? D1 UNIQUE constraint? KV put-if-absent?).

Return a focused report — cap each section to 20 entries (prioritize by blast radius):
- FILES TO CHANGE: table (File | Type | Lines | Change | Priority)
- EXACT CODE LOCATIONS: 15 most critical change sites with 5-line context snippets
- BACKEND ROUTE MAP: per route — auth attach point, handler fn, services touched, with exact lines
- FRONTEND NAV MAP: per screen — navigator registration, deep-link entry, store reads, with exact lines
- API CLIENT MAP: per module — base URL source, auth header pattern, methods to add
- STORE MAP: per Zustand store to change — @Published-equivalent state, mutation methods
- CROSS-PATTERN SCAN: (if applicable) HITS and CLEARS
- TEST STATUS: existing test files + pattern to follow
- DEPLOYMENT REQUIREMENTS: migration? KV binding? DO migration? secrets? per environment
```

---

### Agent B — Risk & Architecture Assessment (Plan, Cursor Grok 4.5 / `grok-4.5-fast-xhigh`)

```
You are doing a pre-implementation risk + architecture assessment.

TRD CONTENT: [paste full TRD]
FEATURE DESCRIPTION: [paste BRD summary or TRD §1]

Evaluate risks across every dimension:

1. CONCURRENCY & RACE CONDITIONS
   - Are there race conditions in the data flow?
   - Any @MainActor-equivalent issues (React state, Zustand selectors, TanStack invalidations)?
   - Could concurrent fetches corrupt state?

2. DATA INTEGRITY
   - Are D1 migrations reversible? What breaks if a migration fails partway?
   - Foreign-key cascade surprises?
   - Race between backend deploy and client deploy?

3. DEPLOYMENT ORDERING
   - What if Worker deploys but RN build is rejected by App Review?
   - What if a migration runs before the route that uses it?
   - What if feature-flag defaults create a window where old clients break?

4. BACKWARD COMPATIBILITY
   - How does an old app version experience the new backend?
   - Tool-schema or API-shape drift between App Store review lag and Worker deploy?

5. PERFORMANCE & COST
   - Hot partitions in D1? Over-broad SELECTs that scan tables?
   - Cloudflare Workers CPU/time limits (30s CPU, wall clock limits per tier).
   - LLM token-cost blowouts.
   - SSE with tool loops can exceed per-invocation limits — does the plan account for DO-backed resume?

6. STREAMING-SPECIFIC
   - SSE on Workers: Hono streamSSE vs manual ReadableStream.
   - Auth on SSE: Bearer header via fetch-stream (not EventSource query param, which leaks tokens into logs).
   - Mid-stream refresh of JWT: access token 15 min, refresh 30 days — what happens for 20-min streams?
   - Mid-stream kill-switch: propagation latency.

7. WEBVIEW (react-native-webview) SAFETY
   - Not installed by default in this project — confirm package.json before assuming.
   - originWhitelist, javaScriptEnabled, onShouldStartLoadWithRequest, setSupportMultipleWindows.
   - CSP injection server-side before render.
   - Chart.js CDN vs bundled — CDN is an egress channel.
   - postMessage bridge attack surface.

8. TRUST BOUNDARY FOR LLM OUTPUT
   - LLM-authored HTML → DOMPurify server-side before SSE emit.
   - LLM tool-call args → Zod-validate server-side even though the LLM generated them.
   - Auto-approve vs user-confirm for mutating tools: NEVER auto-approve mutations.

9. ROLLBACK RISKS
   - Per-phase rollback cost (migration reversibility, KV flag flip, Worker rollback).
   - Data rollback cost (mutations already committed).

10. TESTING RISKS
    - Mock-only coverage that hides real issues (D1 integration vs pure-memory mocks).
    - No LLM determinism — snapshot via fixture provider, not live API.

11. ENVIRONMENT RISKS
    - Staging broken for Durable Objects as of 2026-04 ("Cannot use Durable Objects with Preview URLs" — noted in wrangler.toml comments).
    - Expo dev client required (app uses react-native-pdf / mmkv) — NOT Expo Go compatible.

12. FEATURE-FLAG SAFETY
    - Does the plan include a kill switch?
    - Is the kill switch sub-60s and scoped (all / allowlist / per-tool)?
    - Does mid-stream kill work?

Output (cap: 6 CRITICAL, 10 HIGH, 8 MEDIUM — each must name a specific file, library, endpoint, or scenario):

- CRITICAL RISKS
- HIGH RISKS
- MEDIUM RISKS
- RECOMMENDED PHASE ORDER (with "this blocks that")
- ARCHITECTURE DECISIONS (5-10 ADRs: Chosen / Alternative / Why)
- ROLLBACK STRATEGY (per phase)
- DEPLOY ORDER (exact)
- KILL SWITCH DESIGN (mechanism, activation latency, mid-stream behaviour)
```

---

### Agent C — Worker Baseline & Environment Checks (general-purpose, Composer 2.5 / `composer-2.5-fast`) — skip if FE-only

```
Gather production baseline data for the SimpleHouse Worker.
Working directory: /Users/andreitekhtelev/Desktop/SimpleHouse.
Backend: Cloudflare Workers + Hono.

For each Worker route/service being changed:

1. CURRENT ROUTE BEHAVIOR
   - Read the route file. Note auth middleware placement, rate-limit middleware, handler, responses.

2. DEPENDENCIES + PACKAGE.JSON
   - Read backend/package.json. Confirm any new dependency (e.g. isomorphic-dompurify, zod, @anthropic-ai/sdk version) is installed OR flag it for addition.
   - For SDK changes that require Cloudflare compat flags: check wrangler.toml compatibility_date and compatibility_flags.

3. WRANGLER + BINDINGS
   - Read wrangler.toml. For each environment (dev, staging, production), confirm DB/KV/R2/DO bindings align with what the new code requires.
   - If a new binding is needed (e.g. new KV namespace for kill-switch), list the exact wrangler lines to add.

4. RECENT DEPLOY SANITY
   - git log --oneline -20 backend/ — does anything recent touch the files in question?
   - Read the last commit that modified the route/service to understand the author's intent.

5. RECENT LOG SAMPLE (if Cloudflare Analytics access available; otherwise skip with note)
   - If wrangler tail has been recently used locally, note the pattern. Otherwise record that this check requires operator access.

6. SECRETS
   - `wrangler secret list --env production` (do NOT run unless explicitly permitted; confirm only that the plan calls for it as a manual step).

Return:
- ROUTE CONFIG: handler fn + middleware chain per route
- BINDING MATRIX: DB/KV/R2/DO per environment — matches what the plan needs? gaps?
- NEW DEPS TO ADD: package name, version, reason
- NEW SECRETS TO ADD: name, reason, operator step
- BASELINE VERDICT: current health; any red flags before starting
```

---

## Phase 3 — Synthesize & Write Implementation Plan

After all agents return, synthesize. Model depth on the most recent approved Implementation Plan in this repo (when one exists).

### Document Header

```markdown
# Implementation Plan — <Feature> (v 1.0)

**Version:** 1.0
**Date:** <today>
**Status:** Planned
**Area:** <FE | BE | FE+BE>
**Priority:** <P0 | P1 | P2>
**Source TRD:** documents/features/<Feature>_TRD.md
**Source BRD:** documents/features/<Feature>_BRD.md (if available)
**Author:** <author email>
```

### Required Sections (in order)

1. **§0 Codebase Snapshot Note** — `Written against commit {hash}. Re-grep before starting each phase. Inferred claims AND external-contract claims (model IDs, SDK versions, third-party API shapes, beta headers, **CLI subcommand names + flag names for wrangler / eas / expo / gh / npm — anything beyond the tool's first positional argument**) marked ⚠️ Unverified unless (a) linked to an official docs page URL OR (b) quoted from the tool's `--help` output.`
2. **§1 Overview** — 1-paragraph summary; goals; sources; scope (BE/FE); phase count + rationale; total files to change.
3. **§2 Architecture Decisions (ADRs)** — table of decisions that wouldn't be obvious to a new engineer. Columns: # | Decision | Chosen | Alternative | Reason.
4. **§3 Pre-Implementation Checklist** — unresolved TRD §17 decisions resolved here; git clean; wrangler access confirmed; D1 schema baseline; no in-flight conflicts.
5. **§4 Implementation Phases** — one section per phase with: Goal, Pre-condition, Blocks, Deploy-after (Worker deploy? RN build?); per-task block with File, Type, Current code (real paste), New code, **Produces** (project-source symbols/files this task newly defines — NOT imports from `node_modules`, NOT Workers/RN runtime globals), **Consumes** (project-source symbols/files from earlier phases this task uses), **external:** (dependencies from `node_modules`, Workers/RN runtime, or the codebase's pre-existing surface — must each be grep-provable as already-installed OR already-defined before this feature), Why, Risk, Verification. Produces/Consumes/external may be OMITTED when a task neither defines a new cross-file export nor consumes a symbol produced in an earlier phase (e.g. pure edits to existing code, theme-token bumps, copy changes). Reviewer A performs a topo-sort of Produces/Consumes across phase order; forward references (Consumes not yet Produced AND not in `external:`) are CRITICAL; `external:` entries that do not resolve to an already-installed dep or a pre-existing symbol are CRITICAL.
6. **§5 Affected Files** — complete table (File | Type | Change | Phase | Risk). Also a "Files that MUST NOT change" section (e.g. auto-generated, third-party, out-of-scope).
7. **§6 Test Strategy** — §6.1 Unit (Jest for RN, Vitest for Worker); §6.2 Integration (Miniflare/Workers pool); §6.3 E2E procedure with exact commands; §6.4 Performance procedure with exact wrangler tail / DevTools steps. Include an explicit error-code-to-test matrix if the TRD defines error codes.
8. **§7 Risk Assessment** — table with Probability | Impact | Mitigation | Rollback.
9. **§8 Deployment Plan** — §8.1 Backend (wrangler deploy --env dev/staging/production, migration commands, secret commands); §8.2 Frontend (eas build, TestFlight, store); §8.3 Order for FE+BE coordination; §8.4 Post-deploy verification.
10. **§9 Rollback Procedures** — per-phase rollback; full rollback; data rollback (migration reversibility).
11. **§10 Monitoring & Observability** — §10.1 Structured log patterns; §10.2 Analytics events; §10.3 Key metrics + thresholds.
12. **§11 Definition of Done** — per-phase + overall.
13. **§12 Known Gaps & Future Work** — what was intentionally deferred.
14. **§13 Summary** — status table with phase tracking markers.

---

## Phase structure for every IP

Highest-impact / lowest-risk first. Each phase must be independently testable.

- **Phase 0 — Setup & Infrastructure** (if needed): feature-flag KV keys, kill-switch helper, new migrations (additive only), new DO class declarations, new RN component folders.
- **Phase 1 — Backend Foundation**: new routes, service scaffolds, middleware updates. Must be deployable without the frontend depending on them.
- **Phase 2 — Data / Provider Integration**: D1 queries, LLM provider calls, idempotency, error contract. Tested via Miniflare.
- **Phase 3 — Frontend API Client + Store**: new api/*.ts module, new Zustand store or context, types. Build-green before views touched.
- **Phase 4 — Frontend Views**: screens, components, navigation wiring, deep-links.
- **Phase 5 — Integration & Analytics**: end-to-end test, analytics event wiring, notification suppression, query invalidation map.
- **Phase 6 — Monitoring & Rollout**: alarms/alerts, runbook, allowlist-based rollout.

Adjust phase count to match feature complexity.

---

## Phase 4 — Multi-Cycle Review Loop (up to 5 cycles)

> **PARALLELISM RULE:** Every cycle, launch Reviewers A + B + C in a **single message** with three concurrent Agent calls.

Iterate until zero CRITICAL + zero WARNING remain. Cycle header: `--- IMPL PLAN REVIEW CYCLE N/5 ---`.

### Reviewer A — Codebase Accuracy (Explore, Cursor Grok 4.5 / `grok-4.5-fast-xhigh`, very thorough)

```
Validate this Implementation Plan against the actual SimpleHouse codebase at /Users/andreitekhtelev/Desktop/SimpleHouse.

Implementation Plan — paste these sections ONLY (not the full document):
- §0 Codebase Snapshot Note
- §5 Affected Files table
- §3 Pre-Implementation Checklist
- All Phase task blocks (Task N.X sections with Current code / New code)
- §8 Deployment Plan
[paste]

Verify every factual claim:

1. FILE PATHS — does every mentioned file AND directory path exist? glob/ls each. Flag missing. File and directory names shown as examples in this skill body (Project Stack Reference, Agent A prompts) are **normative, not illustrative** — a plan that invents a parallel-looking name (e.g. `SettingsStack.tsx` when `SettingsNavigator.tsx` is the real file, or `backend/test/` when `backend/__tests__/` is the real directory) = CRITICAL.
2. LINE NUMBERS — read each referenced range. Does the "Current code" match what's in the file? Flag ANY drift.
3. SYMBOLS — grep every function, component, hook, store name **AND every code-internal identifier claimed as pre-existing**: D1 column reference (against `backend/src/db/schema*.ts`), wrangler binding name (against `backend/wrangler.toml`), package name asserted as 'already installed' / 'already a dependency' in prose or `external:` lines (against `backend/package.json` + root `package.json`), migration filename cited as pre-existing (including past-tense claims like "v1.2's last migration was `0034_ai_chat.sql`", against `ls backend/migrations/`). **Output a per-class CONFIRMED/BROKEN/COUNT evidence table** (one row per symbol class — missing rows = partial satisfaction, itself a CRITICAL failure). **Scope: code-internal identifiers only**; external-contract prose (model availability, SDK versions, third-party API shapes, CLI subcommand names) is governed by §0 ⚠️ Unverified rule. Missing = CRITICAL. Note: v1 ledger line 62 warned '`external:` entries are grep-provable but the grep is LLM-performed — still gameable' — per-class evidence output closes that gap.
4. ZOD / TYPESCRIPT — for each new type or schema: confirm shape aligns with existing types/index.ts and db/schema*.ts.
5. DRIZZLE SCHEMA — for each schema change: read the relevant backend/src/db/schema*.ts file and confirm table/column naming conventions match.
6. MIGRATION NUMBERING AND DDL DIRECTION — for each SQL migration: (a) confirm the next-available number (`ls backend/migrations/`) — no numbering collision; (b) for each DDL statement, verify direction consistency: every `ALTER TABLE t ADD COLUMN col` ⇒ grep `backend/src/db/schema*.ts` shows `col` **ABSENT** from `t` today (else the ALTER fails at runtime with `duplicate column name`); every `ALTER TABLE t DROP COLUMN col` or `WHERE col = ?` or `SET col = ?` ⇒ `col` **PRESENT**; every `CREATE TABLE t` ⇒ `t` **ABSENT**. Direction mismatch = CRITICAL.
7. HONO ROUTE WIRING — for each new/changed route: confirm app.route('/foo', fooRoutes) in backend/src/index.ts has a mount, or flag as missing.
8. AUTH MIDDLEWARE ATTACH — does every new route file do a .use('/*', authMiddleware()) at the top? Compare to routes/chat.ts as the correct pattern.
9. HOUSEHOLD SCOPING — every new household-scoped endpoint: does it (a) accept householdId as URL param, (b) verify membership? Flag absence as CRITICAL.
10. RATE LIMITING — does any new endpoint that could be abused include a rate-limit middleware?
11. WRANGLER BINDINGS — for every env var, KV, R2, or DO used in new code: confirm it exists in wrangler.toml for all three environments (dev/staging/production).
12. DO MIGRATIONS — new DO class requires a [[migrations]] block in wrangler.toml (tag = "vN", new_classes = ["..."]). Flag absence as CRITICAL.
13. EXPO-ROUTER vs REACT-NAVIGATION — new screens: is the registration path correct? (app/(tabs)/*.tsx for expo-router tabs OR src/navigation/*.tsx for RN stacks OR both for hybrid). Flag wrong placement.
14. DEEP LINKS — active entry FIRST: read `package.json` `main` field. If `main === "expo-router/entry"` (SimpleHouse default per line 22 of this skill), deep links MUST live under `app/` via file-system routing (e.g. `app/briefing/[date].tsx`); edits to `src/App.tsx linking.config` are **DEAD CODE and CRITICAL** unless the plan explicitly reviving the classic entry is part of the scope. If `main === "index.js"` or a classic entry, `src/App.tsx linking.config` is live — but confirm via grep of the file's runtime imports before prescribing edits. Historical note: the AcceptInvite block at `src/App.tsx:64-82` wraps VisitChecklist/ActiveVisit/ContractorComparison — do not replicate even if classic entry is revived.
15. MMKV / ASYNCSTORAGE — new persisted state: confirm storageHelpers pattern from src/services/storage/index.ts (never SecureStore for non-secrets).
16. REACT-NATIVE-WEBVIEW — if the plan introduces it, confirm it's added to package.json and ios/Podfile.lock via a task, and that the WebView config uses: originWhitelist=['about:blank'], javaScriptEnabled only if bundled Chart.js, onShouldStartLoadWithRequest blocks nav, setSupportMultipleWindows=false, CSP meta injected server-side.
17. ENV CONFIG — new env var or URL: added to src/config/env.ts and gated on __DEV__ correctly.
18. NO EXPO GO — if the plan depends on a native module, it requires dev client / EAS build (not Expo Go).
19. TESTS — for each new test: is the path correct (`backend/__tests__/**/*.test.ts` for Worker via vitest + `@cloudflare/vitest-pool-workers`; `__tests__/**/*.test.tsx` for RN via jest)? Configured framework right?
20. NO GENERATED / VENDOR EDITS — confirm no task edits node_modules, ios/Pods, android/build, or vendor/. Flag as CRITICAL.
21. ERROR-CODE COMPLETENESS — if TRD defines error codes, confirm §6 test matrix covers every one with a named assertion. Missing code = CRITICAL.
22. CATCH-BLOCK FALL-THROUGH — scan any Worker try/catch for fall-through into an unrelated error handler below.
23. FIX UNIFORMITY — if one call site of a pattern is fixed (auth, validation, analytics), confirm all other call sites receive the same fix.
24. STAGING DO BLOCK — if the plan introduces a DO, confirm there's an explicit mitigation for the staging Cloudflare DO block. Flag absence as WARNING.
25. TRD↔IP FIELD PARITY — fetch the TRD header + only the TRD sections naming the identifiers in scope (migration path, phase numbers, feature-flag keys, endpoint paths, folder structure, ADR status, decision IDs). Do NOT paste the full TRD. For each identifier: IP value must match TRD verbatim OR carry a §3 override note `overrides TRD §X because Y`. URL path segments and TypeScript identifiers occupy different namespaces — do NOT cross-normalize case / dehyphenate when comparing (`/ai-chat` ≠ `aiChat`; flag as mismatch if used interchangeably). Unexplained mismatch = CRITICAL. **Additionally (v2): PARTITIONED-SUM RECONCILIATION. When the TRD OR the IP contains a claim of the form `Total = N (a + b + c + ...)` or an explicit per-category breakdown table (risk classes, phase tools, per-domain counts): (i) extract each addend, (ii) delegate arithmetic to a real interpreter via Bash — `python3 -c 'print(a+b+c+...)'` primary, `node -e 'console.log(a+b+c+...)'` fallback — NEVER mental math, (iii) compare recomputed sum against stated total in same doc, (iv) if both docs carry breakdowns with the SAME partition schema, compare rows pairwise; (v) if partition schemas DIFFER (e.g. TRD uses risk classes, IP uses feature categories), fall back to flat universe totals — count the TRD's authoritative enumeration rows (e.g. §23 tool table row count) and compare to the IP's stated total. Schema-incompatible partitions with matching totals = CONFIRM-WITH-NOTE; single-cell mismatch OR total disagreement = CRITICAL. Show the recomputed sums in the review response. This check is a no-op when no partitioned sum claim exists. **Additionally (v3): MULTI-FACTOR ARITHMETIC. (vi) When a row value is itself a computed expression of the form `qty × unit_cost` or `count × rate × period` or any multiplicative product (common in cost/capacity/SLO tables): (a) identify every factor the row intends — for LLM cost rows specifically, BOTH input-token cost AND output-token cost factors MUST appear OR the row MUST declare `output=0` with rationale (output-free LLM calls are rare); (b) recompute the row via the same Bash interpreter (`python3 -c` primary / `node -e` fallback), showing all factors; (c) compare to the stated row value. Missing-factor errors (e.g. omitted output-token cost, wrong price tier for tier-routed models) = CRITICAL. Grand-total self-consistency with under-estimated row values does NOT excuse row-level errors — a plan whose 4 of 5 rows under-estimate by 5-10× and whose total matches the under-estimated sum is a double failure.**
26. FORWARD-REFERENCE RESOLUTION — run a topo-sort of Produces/Consumes across §4 phases in phase order. Any Consumed symbol not Produced by a strictly-earlier phase (and not listed in that phase's `external:`) is CRITICAL.
27. PARITY-UNIVERSE ENUMERATION — for any "every X → Y" claim where the X universe is NOT already enumerated in a preceding §5 table (e.g. "every route → tool", "every domain service → origin-suppression"), confirm §5 includes a mechanically-reproducible enumeration backed by copy-pasted shell output (e.g. actual `find backend/src/routes -name '*.ts'` stdout with line count) OR a copy-pasted TRD section, OR a copy-pasted grep result. LLM-authored lists without evidence of the underlying command = CRITICAL. Re-run the command yourself and compare row count to the table; row-count mismatch = CRITICAL. When the universe is already enumerated (e.g. "every file in §5 has a test" and §5 has N rows), no separate enumeration needed — reference §5 explicitly.

Return:
- ✅ CONFIRMED (be specific)
- ❌ BROKEN (with current state)
- ⚠️ UNVERIFIABLE (why)
```

Cycles 2–5 prompt (incremental):
```
Incremental codebase validation. Re-check only BROKEN / UNVERIFIABLE items.

Updated sections:
[paste changed]

Previously CONFIRMED (skip):
[paste list]

Re-check list:
[paste]

**Additionally**: open the new version's `## Revision History` / `§0.N` changelog block. For every entry that claims a fix was applied: (a) open the claimed file:line and confirm the string is present, AND (b) read ≥20 lines of surrounding context to confirm the *structural position* matches the claim — e.g. "middleware attached BEFORE route registration", "idempotency check BEFORE the DB write", "auth guard SCOPES the entire handler body". A string-presence match alone is NOT sufficient for ordering-dependent or scope-dependent fixes (middleware, auth, idempotency, rate-limit, kill-switch). **(c) Universal-claim negative evidence (v2). Revision entries asserting *uniform transformation across a scope* (semantic-class trigger — examples: `standardised`, `unified`, `consolidated`, `renamed`, `moved`, `replaced`, `deprecated-in-favour-of`, `normalised`, `aligned`, `harmonised`, `merged` — NOT EXHAUSTIVE; match on semantic assertion, not the literal verb) make a universal claim. Grep the RETIRED value across the claimed scope (scope = the sections the entry explicitly names, e.g. "in TRD §8.4/§8.5/§9"; if unspecified, full artifact). Use word-boundary or quoted-token match — `\b<retired>\b` or `"<retired>"` — to avoid substring-containment false positives (e.g. `/ai/chat/` is a substring of `/ai/chat/stream` — DIFFERENT from `isAdmin` ⊂ `isAdminUser`; choose boundary per context). Exempt the revision-history entry itself from the grep. Any surviving retired value outside the exemption = CRITICAL unless the entry explicitly carves out the exception.** Unverified claims (entry exists but file:line shows old state, OR structural position doesn't match, OR retired value survives under a universal claim) are CRITICAL.

Return: ✅ NOW CONFIRMED / ❌ STILL BROKEN / 🆕 NEW BROKEN / ⚠️ STILL UNVERIFIABLE / 🆕 REVISION-CLAIM UNVERIFIED
```

---

### Reviewer B — Completeness, Safety, Production Readiness (Plan, Cursor Grok 4.5 / `grok-4.5-fast-xhigh`)

```
Deep review of a SimpleHouse Implementation Plan.

Stack: React Native 0.81 / Expo 54 / expo-router + RN Navigation hybrid / Zustand + MMKV / TanStack Query / TypeScript strict / Cloudflare Workers + Hono / D1 + Drizzle / JWT auth.

Plan — paste these sections ONLY:
- §1 Overview
- §3 Pre-Implementation Checklist
- §5 Affected Files
- §6 Test Strategy
- §7 Risk Assessment
- §8 Deployment Plan
- §9 Rollback Procedures
- §10 Monitoring
- §11 Definition of Done
- §12 Known Gaps
- Phase goal/pre-condition/blocks lines
[paste]

Hard project rules (violations = CRITICAL):
- BE: every household-scoped route uses authMiddleware + verifies household membership (HouseholdService.getHousehold(hid, userId) or equivalent).
- BE: aws-sdk usage is banned (this is Cloudflare Workers, not Lambda). Flag if the plan imports it.
- BE: no `process.env` access except via the typed Env interface.
- BE: no in-memory rate limiter for multi-isolate endpoints; use the DO-backed helper for hot paths.
- BE: Drizzle ORM — never raw SQL in route handlers (except migrations).
- FE: no inline `any` types unless explicitly justified; TypeScript is strict.
- FE: no direct MMKV calls — use storageHelpers.
- FE: no SecureStore for non-secrets.
- FE: no editing `app/` and `src/navigation/` in the same phase without an explicit decision on which is active for the feature.
- Never import `react-native-webview` without explicit CSP + sandbox config.
- Never expose a JWT or refresh token to the WebView's `window`.
- Never auto-execute a mutating tool call.

Evaluate:
1. TASK COMPLETENESS — every file in §5 has a corresponding task? CRITICAL if missing.
2. PRE-CONDITIONS — complete enough for a cold engineer? WARNING if not.
3. PHASE ISOLATION — each phase independently testable? CRITICAL if implicit cross-phase dep.
4. ROLLBACK COMPLETENESS — every phase has a rollback? WARNING if missing.
5. TEST COVERAGE — unit + integration for every new service/tool/store? WARNING if critical path uncovered.
6. DEPLOYMENT ORDER SAFETY — any window where old RN talks to new Worker, or new Worker uses a migration that hasn't run? CRITICAL if unsafe.
7. MONITORING GAPS — alarms/alerts for new routes + LLM cost + kill switch + WebView errors? WARNING if missing.
8. DEFINITION OF DONE and NF-GATE BINDING — (a) per-phase + overall DoD specific enough to measure? WARNING if vague. (b) **For every non-functional gate (NF-N cost ceiling, latency SLO, availability SLO, rollback-window budget, feature-flag default) named in §3 Pre-Implementation Checklist or §11 DoD: confirm a matching row in §2 ADR table OR an explicit §2 note of the form "NF-N is a contract from TRD §X — not re-decided in this IP." Unmatched NF gate without artifact-linked decision = WARNING; NF gates whose prose-only checklist item is the sole enforcement = WARNING (the checklist item must point to an artifact — ADR file, CI check, kill-switch key, or explicit TRD-contract note).**
9. KNOWN GAPS — documented? WARNING if undocumented deferral.
10. PERFORMANCE — any task introducing N+1 queries, hot partitions, unbounded LLM context? WARNING.
11. AI-IMPLEMENTATION READINESS — if an AI coding agent executes this task-by-task, what will it get wrong? Flag ambiguities.
12. REACT QUERY INVALIDATION — any mutation without a corresponding invalidateQueries? WARNING.
13. ZUSTAND STORE SYNC — mutations that bypass the store and leave UI stale? WARNING.
14. TYPESCRIPT STRICT — any new `any`, `as unknown as T`, `@ts-ignore`? WARNING unless justified.
15. EXPO CONFIG — any change requiring expo-config-plugin, app.json, or prebuild? Flag explicit.
16. KILL SWITCH — is it documented end-to-end (mechanism, activation cmd, verification, revert)? WARNING if incomplete. Additionally: for every security-critical branch (kill-switch, auth-deny, tool-approval gate, context-redaction failure), confirm the test's assertion literal matches the code's branch literal — e.g. fail-closed code returning 503 must have a test asserting 503 on the unreachable-KV path, NOT 200. Code-vs-test security-semantics mismatch = CRITICAL.
17. OPERATIONAL RUNBOOK — for P0/P1 features: likely failure modes, detection, remediation? WARNING if absent.
18. DEPLOYMENT WINDOW SAFETY — Worker + RN mismatch windows? CRITICAL if unsafe.
19. TOOL-SCHEMA VERSIONING — if LLM tools involved, is there an X-Tools-Version header + 2-version backward compat? WARNING.
20. CONTEXT REDACTION — any LLM context built without a per-tool allowlist? CRITICAL (PII exposure).
21. IDEMPOTENCY — mutating endpoints: client-supplied key + server-side dedup + TTL? WARNING if absent.
22. WEBVIEW HARDENING — full config present? CRITICAL for any WebView task without CSP/originWhitelist.
23. SECRET HANDLING — new secret: wrangler secret put <NAME> --env {env}? No commit of .dev.vars? WARNING.
24. INTERNAL CONTRADICTIONS — CRITICAL if any task, ADR row, §1 overview, §2 decision table, §10 analytics spec, prewarm / capabilities / rate-limit reference, or §0.N revision changelog states a different flag key / endpoint path / phase number / provider choice / model ID / tool count than another section of the same document. Run an identifier-consistency pass: extract every flag key, endpoint path, tool name, model ID, phase number, numeric tool count, and decision ID, **AND every identifier explicitly enumerated in a plan-declared registry block (MMKV keys, CONFIG_KV keys, analytics event names, cache keys, queue names, DO binding names, SSE event types, push `data.type` values, Drizzle-enum text-column literal values: when a migration or schema adds a new literal to a `text('status' | 'kind' | 'type' | 'channel' | ...)` column, grep the full set of literal values against any CHECK constraint in the matching migration AND against any application-side validator or Zod enum)**; flag any that appears with two different values (including prefix-drift like `aihousekeeper_has_seen_aihousekeeper_intro` in the registry vs `has_seen_aihousekeeper_intro` in prose). Also covers the single-task "wrong + right form" case.

Return: CRITICAL / WARNING / SUGGESTION with phase + task numbers.
```

Cycles 2–5 delta prompt:
```
Delta safety review.

Updated sections (only changed):
[paste]

Previous cycle issues:
CRITICAL: [list]
WARNING: [list]

For each: ✅ RESOLVED / ❌ STILL CRITICAL / ⚠️ STILL WARNING / 🆕 NEW CRITICAL / 🆕 NEW WARNING.
Only changed statuses.
```

---

### Reviewer C — Risk, Edge Cases, Rollout Safety (Plan, Composer 2.5 / `composer-2.5-fast`)

```
Independent adversarial review. You have NOT seen other reviews. Find issues the others likely missed.

Plan — paste these sections ONLY:
- §1 Overview
- §5 Affected Files
- §7 Risk Assessment
- §8 Deployment Plan
- §9 Rollback Procedures
- §10 Monitoring
- Phase goal/pre-condition/blocks lines
[paste]

Be contrarian:

1. DEPLOYMENT WINDOW — is there a moment where Worker is new + RN is old (or vice versa) and the app breaks?
2. CONCURRENT USER BURST — what breaks at 1000 concurrent users hitting the new feature?
3. DATA EDGE CASES — empty household, 10k rows, all-null fields, pre-feature rows missing new columns, dupes?
4. RECOVERY GAPS — partial failure mid-phase: recoverable?
5. TEST GAPS — tests that look covered but only hit mocks?
6. OPERATIONAL RUNBOOK — 3am incident: does the plan give enough info to recover?
7. ROLLOUT RISK — most likely cause of a production incident in first 30 days?
8. CLOUDFLARE-SPECIFIC: Worker CPU limit (30s free, 5min bundled) vs LLM streaming; KV eventual consistency; DO migrations unreversible; staging DO block still open?
9. RN-SPECIFIC: TestFlight review lag vs Worker atomic deploy; background-fetch killing streams; keyboard overlaying chat; VoiceOver gaps.
10. SECURITY: JWT leak via SSE query param, WebView phishing overlay, LLM prompt-injection paths through user-uploaded PDFs.

Return: CRITICAL / WARNING / SUGGESTION + "ROLLOUT RISK:" (2–3 sentences).
```

Cycles 2–5 delta: same as Reviewer B's delta pattern.

---

### Cycle Decision Logic

```
=== IMPL PLAN REVIEW CYCLE N/5 ===

CRITICAL: [merged from 3 reviewers, or "None"]
WARNING:  [merged, or "None"]
SUGGESTIONS: [merged, or "None"]
ROLLOUT RISK: [from Reviewer C]
```

- Zero CRITICAL + zero WARNING → READY. Go to Phase 5.
- Cycle 1: zero BROKEN (A) + zero CRITICAL (B+C) → fast exit.
- Issues + cycles remaining → fix all CRITICAL + WARNING, bump version (v1.0 → v1.1 → v1.5 max).
- 5 cycles reached → Phase 5 with unresolved items flagged in §3.

### New Version File

- Compute version: v1.X → v1.(X+1). Same filename with version incremented.
- Apply all fixes; correct every stale file:line; add pre-conditions; add rollbacks; clarify order; add monitoring.
- Update header + date; add **Revision History** at bottom.
- Announce: `Created v1.X — proceeding to Cycle N+1.`

---

## Phase 5 — Final Output

### Large Document Multi-Part Writing

Estimate line count. Split if large:

| Lines | Parts |
|---|---|
| < 400 | 1 |
| 400-700 | 2 |
| > 700 | 3 |

Split rules:
- Announce: `📄 Large document (~{N} lines) — writing in {P} parts.`
- Part 1: Write — content up to `## §N` boundary, end with `<!-- PART_2_CONTINUES -->`.
- Part 2+: Edit tool, replace sentinel with next sections.
- Announce between parts.

### Final-Pass Editorial Check (v3 M9)

Before emitting the Final Console Output:
- De-duplicate adjacent bullets or table rows (a multi-part edit that re-writes the same `**Modified backend files**` bullet twice is a known slip — scan each bulleted list for identical adjacent leading text).
- Verify no `<!-- PART_N_CONTINUES -->` sentinel remains in the document.
- Verify no header / filename / revision-row version conflict (one header version, one filename version, one revision-history row).

### Final Console Output

```
=== IMPLEMENTATION PLAN CREATED ===

File: documents/features/<Feature>_Implementation_Plan.md
Area: FE / BE / FE+BE
Priority: P0 / P1 / P2

Review cycles: N/5
Final version: vX.X
Verdict: READY ✅ / NEEDS HUMAN REVIEW ⚠️

Summary:
- Phases: N
- Total files: N BE / N FE
- Tasks: N total
- Test scenarios: N unit + N integration + N E2E
- Risks: N CRITICAL / N HIGH / N MEDIUM
- Corrections in review: N

Version history:
- v1.0 → v1.1: [summary]
...

⚠️ Remaining issues (if any):
  - [list]

⚠️ Items requiring human sign-off:
  - [from §3 pre-conditions]

⚠️ Production deployment notes:
  - [wrangler deploy commands, eas build profile, secrets to set, KV keys to seed]

ROLLOUT RISK: [final]
```

---

## File Naming & Location

```
documents/features/<Feature>_Implementation_Plan.md
```

Examples:
- `documents/features/MCP_UI_Implementation_Plan.md`
- `documents/features/Contractor_Marketplace_Implementation_Plan.md`

---

## Style Rules (always enforce)

- ALL code blocks have language tags: ```ts, ```tsx, ```sql, ```bash, ```toml, ```json.
- ALL file refs: `path/to/file.ts:line` — never vague.
- "Current code" blocks: paste the actual code, not a paraphrase.
- "New code" blocks: exact replacement with the same context.
- Tables for: risks, affected files, phase summary, tests, error codes, **parity-universe enumeration (for any "every X → Y" claim whose universe is not already enumerated in a preceding table — e.g. "every route has a tool" MUST be backed by a `find backend/src/routes` enumeration table with actual shell output and row count)**.
- Tasks are INDEPENDENT + VERIFIABLE.
- NEVER prescribe edits to `node_modules`, `ios/Pods`, `android/build`, or `vendor/`.
- NEVER use `aws-sdk` / `amplify` / Swift / Lambda paths in a SimpleHouse plan — those are Step project artifacts.
- NEVER run `wrangler deploy` as part of the plan — list it as a manual step with the exact command per env.
- NEVER run `eas build` — list it as a manual step with profile.
- NEVER suggest `#if DEBUG`-style gates — use `__DEV__` or a KV feature flag.
- For LLM/tool error contracts, ALWAYS include an explicit error-code-to-test matrix.
- For any SSE / streaming feature, ALWAYS require a DO-backed resume path (or an explicit ADR-documented decision to skip it).
- Any migration step MUST call out forward and reverse SQL (or explicitly state reverse is N/A with rationale).
- Any new WebView task MUST specify: originWhitelist, javaScriptEnabled, onShouldStartLoadWithRequest, setSupportMultipleWindows, CSP injection point.
- Any new Worker secret MUST be added via `wrangler secret put <NAME> --env <env>` (never committed).
- Any new KV or DO MUST be listed in `wrangler.toml` for all three environments — even if some are no-ops today.
- Any new RN native dependency (e.g. `react-native-webview`) requires a dev-client rebuild; call out the `npx expo prebuild` + re-archive step if applicable.
- Any `__DEV__`-gated URL MUST match the pattern in `src/config/env.ts`.
- Any new TanStack Query invalidation MUST be listed alongside the mutation (invalidation map section).

---

## Revision Log

- **v 1 — 2026-04-22** — applied 9 minimum-incision edits per fix-skill cycle.
  Triggering gap: user 45-item cross-read of MCP_UI TRD + Implementation Plan artifacts this skill produced. 20 ABSENCE + 4 DISOBEDIENCE + 3 AMBIGUITY + 2 DRIFT + 1 pattern-level REGRESSION.
  Artifact: `documents/Requirenments/AI Houskeeper /MCP_UI_Implementation_Plan.md` (v1.0 → v1.2 cycle evidence).
  MAST code: FM-2.4 (Information Inconsistency, dominant) + FM-1.3 (missing verification step) + FM-3.3 (incorrect verification).
  Regression replay: YES across all 8 failure classes (intra-doc, cross-doc, security code-vs-test, revision-history trust, external-dep verification, phase-dep graph, decision propagation, completeness-by-construction).

  Edits applied:
  1. §0 header — version marker `<!-- fix-skill: v 1 -->` added.
  2. Project Stack Reference line 63 — DRIFT fix: `dev` env removed (no `[env.dev]` in wrangler.toml); `dev-preview` added; migration path corrected to `backend/migrations/`.
  3. Required Sections §0 — "⚠️ Unverified" tagging clause extended to include external-contract claims (model IDs, SDK versions, third-party API shapes, beta headers).
  4. Required Sections §4 — per-task block now requires `Produces:` / `Consumes:` fields for topo-sort verification; forward refs = CRITICAL.
  5. Reviewer A checks — added #25 (TRD↔IP FIELD PARITY), #26 (FORWARD-REFERENCE RESOLUTION), #27 (PARITY-UNIVERSE ENUMERATION).
  6. Reviewer A cycles 2-5 prompt — extended to open every Revision-History entry's claimed file:line and confirm the diff.
  7. Reviewer B #16 (KILL SWITCH) — extended to require code-literal ↔ test-assertion-literal match for every security-critical branch.
  8. Reviewer B #24 (was INTERNAL TASK CONTRADICTIONS) — broadened to INTERNAL CONTRADICTIONS across any section + identifier-consistency pass.
  9. Style Rules Tables line — appended parity-universe enumeration requirement.

  Chesterton preserved: Reviewer A #23 FIX UNIFORMITY, Agent A §12 MULTI-PLACE COMPLETENESS, Reviewer B #3 PHASE ISOLATION, Style Rule error-code-to-test matrix — each retained (adjacent-but-distinct territory).
  Rule-budget: Style Rules 22 → 22 (extensions-in-place, no new bullets). Reviewer A 24 → 27 (3 new checks). Under 25-rule Hard/Style ceiling.
  Cycle-1 reviewers: A BLOCKING on migration-path fix-uniformity failure (lines 157+438 still prescribed `backend/database/migrations/` after line 69 corrected it — irony noted). B ALIGNED. C HIGH over-fit on string-presence oracles.
  Cycle-2 follow-ups applied (same revision entry, incremental fixes):
  - Fixed lines 157 + 438 migration path `backend/database/` → `backend/migrations/` (eliminates Reviewer A BLOCKING).
  - Tightened §4 `Produces:` / `Consumes:` definition: project-source symbols only (not `node_modules` / runtime globals); `external:` list must resolve to already-installed deps; may be omitted for tasks with no cross-phase symbol flow.
  - Tightened Reviewer A #25: "fetch TRD header + naming sections, not full TRD" (resolves token-cost contradiction with reviewer paste rules); added namespace rule — URL path segments vs TS identifiers NOT cross-normalized.
  - Tightened Reviewer A #27 parity-universe: requires copy-pasted shell stdout evidence, not LLM-authored enumeration; reviewer must re-run the command themselves.
  - Tightened Reviewer A revision-history check: string-presence NOT sufficient for ordering/scope-dependent fixes; requires ≥20 lines of structural context check.
  - Tightened Style Rule Tables: parity-universe only required when universe not already in a preceding table.
  Over-fit risk after cycle 2: MEDIUM → LOW-MEDIUM (string-presence oracles mitigated via structural-context requirement + shell-output evidence requirement + namespace-aware identifier comparison).
  Remaining known limitations (deferred to v2):
  - Reviewer A cannot actually execute shell commands mid-review; "re-run the command yourself and compare row count" is aspirational until tool access is available. For now, reviewer compares the pasted shell output's claimed command against the sibling's claim.
  - `external:` entries are grep-provable but the grep itself is LLM-performed; an LLM can still over-declare.
  - Oscillation guard across review cycles (same task CRITICAL in cycle N and N+1) not yet added — deferred.
  Ledger: `.claude/retrospectives/create-implementation-plan_lessons.md#2026-04-22`.

- **v 2 — 2026-04-22** — narrow patch: 2 rule tightenings + 3 DRIFT fixes (self) + 2 DRIFT mirrors (sibling skills). Addresses 2 of the 5 ABSENCE sub-classes surfaced during the v1.2 review-plan pass; 3 others deferred as MISPLACED (belong in sibling skills).
  Triggering gap: in-session `review-plan` invocation against v1.2 MCP_UI_Implementation_Plan.md surfaced five ABSENCE sub-classes not covered by v1 parent-class rules — see ledger entry for detail.
  Artifact: `documents/Requirenments/AI Houskeeper /MCP_UI_Implementation_Plan.md` (v1.2 emitted by v1-patched skill; session review produced v1.3 via 30+ edits).
  MAST code: FM-2.4 (dominant) + FM-1.3 / FM-3.3 (secondary).
  Classification: 5 ABSENCE, all RECURRING at parent-class level (sub-class expansion under v1's named failure classes).
  Regression replay: 2 of 5 gaps caught by in-scope tightenings (Gap 1 negative-value grep, Gap 4 partitioned-sum reconciliation); 3 of 5 deferred to sibling skills per Reviewer B MISPLACED verdict.

  Edits applied in v2 (THIS skill only):
  1. Project Stack Reference line 56 — DRIFT fix: `database/migrations/` → `backend/migrations/` in tree diagram (v1 fix-uniformity regression; lines 69/157/438 already correct but line 56 missed).
  2. Project Stack Reference line 57 — DRIFT fix: env list `(dev, staging, production)` → `(top-level default, staging [DO-broken], production, dev-preview)` (aligns with skill's own line 67 guidance).
  3. Agent A §9 TEST COVERAGE AUDIT line 188 — DRIFT fix: `ls backend/src/__tests__/` → `ls backend/__tests__/ __tests__/` (backend/src/__tests__/ does not exist).
  4. Reviewer A #19 TESTS line 451 — DRIFT fix: path `backend/src/__tests__/**` → `backend/__tests__/**`; framework citation expanded to `@cloudflare/vitest-pool-workers`.
  5. Reviewer A #25 TRD↔IP FIELD PARITY line 457 — tightening: PARTITIONED-SUM RECONCILIATION clause added. Requires arithmetic delegation via `python3 -c` (primary) or `node -e` (fallback). Handles schema-incompatible partitions via flat-universe-total fallback. No-op when no partitioned sum claim exists.
  6. Reviewer A cycles-2-5 revision-history check line 480 — tightening: universal-claim negative-evidence clause (c) added. Semantic-class verb trigger (non-exhaustive; match on assertion of uniform transformation, not literal verb). Word-boundary anchoring to avoid substring-containment FPs. Exempts the revision-history entry itself.

  Edits applied in SIBLING skills (fix-uniformity under skill's own Reviewer A #23):
  7. `review-plan.md:139` — DRIFT fix: same test-path correction as edit #4. Partial fix would have created cross-skill divergence.
  8. `implement-plan.md:99` — DRIFT fix: same test-path correction. Agent C file-assignment table cannot reference a non-existent directory.

  NOT applied — deferred as MISPLACED per Reviewer B:
  - Reverse-direction IP→TRD contract-identifier pass. DUPLICATE with `review-plan.md` Agent A #22 + Agent B #24 which already do bidirectional sweep in pair-mode. Keeping in create-implementation-plan would force Reviewer A to re-fetch the TRD (token cost) for a check review-plan runs anyway downstream. Correct home: `review-plan`.
  - Non-Goal × enumerated-artifact semantic MATRIX. MISPLACED — Non-Goals live in TRD §1/§3/§21 handoff gate; IP-authoring reviewer has partial view. Correct home: `review-plan` pair-mode Agent B (has both docs) OR `create-trd.md` §21 handoff-gate extension.
  - Decision-state freshness (OPEN decisions persisting ≥2 cycles without re-stamp = CRITICAL). MISPLACED — decision table schema lives in TRD §19 Status + §20 Date; IP author has no authority to mutate. Correct home: `create-trd.md` Phase 4 cycle check #6 extension.

  Cycle-1 reviewer verdicts:
  - Reviewer A (Regression Replay, Grok 4.5): ⚠️ WARNING, 6 wording edits recommended. 4 applied (contract-surface enum implicit in partitioned-sum scope; arithmetic scoping explicit; word-boundary anchoring; scope definition). 2 deferred with the rules they concerned.
  - Reviewer B (Cross-Skill Coherence, Grok 4.5): MISPLACED + INCOMPLETE. Drop 1a/3a/3b applied (wrong skill). DRIFT mirror to siblings applied (FIX UNIFORMITY compliance).
  - Reviewer C (Adversarial, Composer 2.5 for judge-bias model diversity): OVER-FIT HIGH on hardcoded section numbers (§8/§8.4/§9/§23/§16). Mitigated: dropped 1a/3b (which carried the hardcoded refs); arithmetic check (1b → v2 edit #5) is section-agnostic; revision-history (2 → v2 edit #6) scopes via entry-declared sections not hardcoded numbers.

  Chesterton preserved: Reviewer A #23 FIX UNIFORMITY (the reason DRIFT mirrors to siblings were required); Reviewer A #25 original TRD→IP direction (augmented, not replaced); Reviewer A #26 FORWARD-REFERENCE RESOLUTION (not touched); Reviewer A #27 PARITY-UNIVERSE (not touched — Gap 4 fix lives in #25 not #27); Reviewer B #24 IDENTIFIER CONSISTENCY (not touched — Gap 3/5 fixes deferred to sibling skills).
  Rule-budget: Style Rules 22 → 22. Reviewer A 27 → 27 (2 tightenings in-place, no new numbered checks). Under 25-rule Hard/Style ceiling.
  Over-fit risk after v2: LOW. Section-number hardcoding avoided; arithmetic is deterministic + delegated; negative-grep word-boundary-anchored; no new rules invented speculatively.
  Ledger: `.claude/retrospectives/create-implementation-plan_lessons.md#2026-04-22-v2`.

- **v 3 — 2026-04-23** — 9 minimum-incision edits (all in-place tightenings; zero new numbered checks).
  Triggering gap: 4-cycle `/review-plan` pass on `MCP_UI_Implementation_Plan_v2.0.md` (Aihousekeeper proactive layer) — 19 CRITICAL + 30+ WARNING across 11 gap classes: G1 phantom columns, G2 ALTER collision, G3 phantom migration (unshipped predecessor), G4 phantom dependency, G5 phantom files, G6 phantom CLI subcommand, G7 dead-code edit (App.tsx linking), G8 multi-factor arithmetic 5-10× off, G9 MMKV registry drift, G10 NF-gate non-binding, G11 duplicate-bullet hygiene.
  Artifact: `documents/Requirenments/AI Houskeeper /MCP_UI_Implementation_Plan_v2.0.md` (v2.0 → v2.4 via 4 review cycles).
  MAST code: FM-3.3 (Incorrect verification) dominant across G1-G5; FM-2.4 (Information Inconsistency) for G7/G9/G10; FM-1.1 for G7 specifically; FM-3.1 for G11.
  Classification: 5 ABSENCE (G2, G3, G6, G10, G11) + 3 DISOBEDIENCE (G1, G4, G5) + 1 AMBIGUITY (G8) + 1 AMBIGUITY+DRIFT (G7) + 1 ABSENCE-too-narrow (G9).
  Regression replay: YES for all 11 (Cycle 2 verification confirmed after Cycle 1 narrowings on M2 / M8 + broadening on M6).

  Edits applied in v3:
  1. §0 Codebase Snapshot Note (line ~379) — extended external-contract class to include CLI subcommand names + flags (wrangler/eas/expo/gh/npm anything-beyond-first-positional); ⚠️ Unverified unless linked to official docs URL OR quoted from `--help` output. Covers G6.
  2. Reviewer A #1 FILE PATHS — tightened to include **directories** (not just files) and declared skill-body examples **normative, not illustrative**. Covers G5.
  3. Reviewer A #3 SYMBOLS — extended symbol universe to 4 code-internal identifier classes (D1 columns, wrangler bindings, "already-installed" packages, pre-existing migration filenames incl. past-tense claims), each with a canonical source path. Requires per-class CONFIRMED/BROKEN/COUNT evidence table to prevent partial satisfaction. Scope restricted to code-internal identifiers; external-contract prose deferred to §0 (M8). Covers G1/G3/G4.
  4. Reviewer A #6 MIGRATION NUMBERING AND DDL DIRECTION — extended numbering-collision check with DDL direction consistency (ADD COLUMN requires column ABSENT, DROP / WHERE / SET require PRESENT, CREATE TABLE requires t ABSENT). Covers G2.
  5. Reviewer A #14 DEEP LINKS — rewrote active-entry-FIRST check: read `package.json main`; if `expo-router/entry`, `src/App.tsx linking.config` edits are DEAD CODE and CRITICAL. Resolves internal contradiction between line 22 (correct) and former #14 (wrong). Covers G7.
  6. Agent A §3 step 3 (line ~164) — mirror of edit #5 wording into the research-agent prompt (per Reviewer A #23 FIX UNIFORMITY). Same ground as G7.
  7. Reviewer A #25 PARTITIONED-SUM RECONCILIATION — extended v2 clause with (vi) MULTI-FACTOR ARITHMETIC: per-row `qty × unit_cost` recomputation; LLM cost rows MUST show input+output factors or declare `output=0` with rationale. Bash-interpreter delegation (`python3 -c` / `node -e`). Covers G8.
  8. Reviewer B #8 DEFINITION OF DONE — extended with NF-GATE BINDING: every NF-N gate in §3 or §11 must match §2 ADR row OR carry explicit "TRD §X contract, not re-decided" note. Prose-only checklist = WARNING. Covers G10.
  9. Reviewer B #24 INTERNAL CONTRADICTIONS — opened closed-list identifier enumeration to include plan-declared registry identifiers (MMKV keys, CONFIG_KV keys, analytics events, cache/queue/DO binding names, SSE event types, push `data.type` values, Drizzle-enum text-column literal values with CHECK + Zod-enum grep). Covers G9 + broader Drizzle-enum sub-class.
  10. Phase 5 new subsection "Final-Pass Editorial Check (v3 M9)" — 3 bullets: de-dup adjacent bullets/rows, verify no `<!-- PART_N_CONTINUES -->` sentinel remains, verify header/filename/revision version consistency. Covers G11.

  NOT applied — deferred to sibling skill per Reviewer B MISPLACED (same precedent as v2):
  - **M3 mirror** into `review-plan.md` (#5 MIGRATION NUMBERING DDL direction) and `implement-plan.md` (§5 Migration Slot Check) — DDL direction belongs at review + execution layers too; scheduled for review-plan's own fix-skill cycle (Target 2 of this session).
  - **M4 mirror** into `review-plan.md:134-135` — the "except for the 'linking' config reference" carve-out directly contradicts the ground-truth `package.json main=expo-router/entry`. Target 2.
  - **M6 mirrors** into `review-plan.md:145 / :149 / :243` — open identifier enumeration; without these, review-plan cycles pass registry-drift silently. Target 2.
  - M5 NOT mirrored into review-plan (layered separation of concerns — create-IP prevents at authoring; review-plan catches other drift). Ledger premise correction: prior v2 entry implied review-plan had a partitioned-sum clause; ground-truth grep confirmed it does not. Layer separation is intentional per reviewer B analysis.

  Cycle-1 reviewer verdicts:
  - Reviewer A (Regression Replay, Grok 4.5): READY with 2 WARNINGs on wording (M2 "past-tense claims count" too loose; M8 clause (a) "skill body as template" hard to mechanically audit).
  - Reviewer B (Cross-Skill Coherence, Grok 4.5): 9/9 ALIGNED; 4 require sibling mirrors (M3, M4, M6 confirmed; M5 separation-of-concerns accepted). Factual correction: premise of v2 ledger overreached — `review-plan.md` grep-confirmed has no partitioned-sum clause.
  - Reviewer C (Adversarial, Composer 2.5 for judge-diversity): MEDIUM over-fit on M2 (5 sub-classes in one rule approaches comprehension threshold). Recommended narrowing + per-class evidence output structural guard. M6 broadened per recommendation to cover Drizzle-enum text-column literals. M9 DEFER mis-reading corrected — M9 runs BEFORE Final Console Output and AFTER all Part N writes complete; no multi-part interference.

  Cycle-2 follow-ups applied (narrow + broaden):
  - M2 narrowed: scope restricted to code-internal identifiers only; external-contract prose explicitly deferred to §0 (M8); per-class CONFIRMED/BROKEN/COUNT evidence table required (structural partial-satisfaction mitigation).
  - M8 narrowed: dropped clause (a) "cited elsewhere in this skill body as a template"; kept (b) docs URL + (c) `--help` output.
  - M6 broadened: Drizzle-enum text-column literal values added to registry-identifier class.
  Cycle-2 single Reviewer A pass: READY on all 3 revised diffs; no new WARNINGs. CYCLE 2 READY FOR PHASE 4.

  Chesterton preserved: Reviewer A #4 ZOD/TYPESCRIPT (different axis from M2 column-grep); #6 original numbering (M3 extends, doesn't replace); #23 FIX UNIFORMITY (drove M4b); #25 v2 addends clause (M5 extends); #27 PARITY-UNIVERSE (untouched); §4 `external:` rule (M2 covers different surface — structured field vs prose); Reviewer B #24 closed-list items (M6 opens, doesn't remove).
  Rule-budget: Reviewer A 27 → 27 (all in-place tightenings to #1, #3, #6, #14, #25). Reviewer B 24 → 24 (in-place tightenings to #8, #24). Style 22 → 22. §0 + Phase 5 get one-line extensions each. Under v3 consolidation threshold of 30.
  Over-fit risk after v3: LOW. M2's 4-class enumeration + per-class evidence table structurally mitigates the 5-sub-class comprehension threshold Reviewer C flagged. M4's carve-out preserves legitimate classic-entry-revival case. M5's "output=0 with rationale" escape hatch handles rare output-free LLM calls. M7's "TRD contract, not re-decided" carve-out handles TRD-owned gates.
  Ledger: `.claude/retrospectives/create-implementation-plan_lessons.md#2026-04-23-v3`.
