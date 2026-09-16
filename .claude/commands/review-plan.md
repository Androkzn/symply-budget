Perform a full multi-agent evaluation cycle on the plan(s) at: $ARGUMENTS

<!-- fix-skill: v 2 -->
<!-- Do not place anything above the description line — Claude Code's skill loader reads line 1 as the description. Version marker + metadata belong below. -->

Your goal: make the plan(s) solid, reliable, and 100 % ready to implement — aligned with the current SimpleHouse project structure, BE schemas, patterns, and official documentation. Iterate up to **5 times**, incrementing the document version each cycle, until all CRITICAL and WARNING issues are resolved.

---

## Input handling

`$ARGUMENTS` can be any of:

- **Single file** — path to one Fix Plan, Implementation Plan, or TRD (e.g. `documents/features/MCP_UI_TRD.md`).
- **Pair (TRD + Implementation Plan)** — two paths comma- or newline-separated. Triggers **pair-mode**: cross-document consistency is part of the audit (identifier parity, route prefixes, tool counts, version footers, phase numbers, flag keys, model IDs).
- **No argument** — ask the user for the path(s) before proceeding.

Detect plan type by header (`# ... — TRD`, `# Implementation Plan — ...`, `# Fix Plan — ...`). Announce detected type(s) before Cycle 1.

---

## Project Structure Reference (SimpleHouse)

```
Frontend (React Native / Expo, expo-router + RN-Navigation hybrid)
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
  __tests__/                    ← Jest tests

Backend (Cloudflare Workers + Hono + D1 + Drizzle)
  backend/
    src/
      index.ts                  ← Hono app + route mounts + scheduled handler
      ai/                       ← AIProvider interface, Claude + Gemini providers, prompts/
      db/                       ← Drizzle schemas + drizzle-orm setup
      durable-objects/          ← JobManagerDO, RateLimiterDO (chat-session DO added per-feature)
      middleware/               ← auth.ts (JWT), cors.ts, rate-limit.ts
      routes/                   ← per-domain Hono route files
      services/                 ← business logic (chat-service, pdf-processing, ai/gemini-service, ...)
      types/                    ← Env + JWT payload
      utils/                    ← jwt, responses, validators
      workers/                  ← cron + queue consumers
    migrations/                 ← D1 SQL migrations (numbered 0001_*, 0002_*, ...)
    wrangler.toml               ← env config (top-level default, staging [DO-broken], production, dev-preview)
    vitest.config.ts            ← @cloudflare/vitest-pool-workers setup
```

**Environments (`backend/wrangler.toml`):** top-level (local default — **no `[env.dev]` block exists**), `staging` (known-broken for Durable Objects), `production`, `dev-preview` (parallel preview Worker for DO-requiring features while staging is blocked).

**Migrations path:** `backend/migrations/` (confirmed via `wrangler.toml migrations_dir = "migrations"`). Never `backend/database/migrations/` — that directory does not exist. Flag as BROKEN.

**Paths are authoritative.** Never import Step iOS / Amplify / Lambda / Swift patterns. `aws-sdk`, `@aws-sdk/*`, `API.swift`, `DebugConfig.Services`, `amplify/`, `step/` are **not** in this repo.

---

## MAX RESOURCES — Quality is the Only Goal

Cost is **not** a constraint. Run every agent at maximum capability:

| Setting | Value |
|---|---|
| Model | Only `Cursor Grok 4.5` (`grok-4.5-fast-xhigh`) or `Composer 2.5` (`composer-2.5-fast`) — never Claude Opus/Sonnet/Haiku or other models. Default research/review agents to Grok 4.5; use Composer 2.5 for diversity or implementation-heavy agents |
| Parallelism | Launch ALL agents in a **single message** (concurrent tool calls) |
| Thoroughness | `very thorough` for all Explore agents — read every relevant file completely |
| Review cycles | Run all cycles up to the max; only exit early on genuine zero issues |
| Synthesis | Cross-reference ALL agent findings before writing output |

---

## Setup

1. Read the plan file(s). If no argument was given, ask the user for the path(s) before proceeding.
2. Parse the header of each doc: version (e.g. `v1.2`), type (TRD / Implementation Plan / Fix Plan), area (`FE` / `BE` / both), priority, source links. Announce what was parsed.
3. **Pair-mode detection:** if two files are provided AND the types are TRD + Implementation Plan, enable cross-document consistency checks in Agent A + Reviewer B.
4. If the doc has a `## Revision History` or `§0.N` changelog block, flag it as a **claim-verification candidate** — claims in that block must be verified against the document body in every cycle.

---

## Evaluation Cycle (repeat up to 5 times)

At the start of each cycle, announce: `--- REVIEW CYCLE N/5 ---`

### Step 1 — Parallel agent launch

> **PARALLELISM RULE:** Launch all three agents in **one message** with concurrent Agent calls.

---

**Agent A — Codebase Accuracy Validator** (`subagent_type: Explore`, thoroughness: `very thorough`, `model: grok-4.5-fast-xhigh`)

Prompt:
```
You are validating a plan against the actual SimpleHouse codebase at /Users/andreitekhtelev/Desktop/SimpleHouse.

Plan content — paste these sections ONLY (not the full document):
- Document header (version, source links)
- §0 Codebase Snapshot Note (if present)
- Revision History / §0.N changelog (if present)
- §5 Affected Files
- §3 Pre-Implementation Checklist (or equivalent)
- Every task block with file:line refs + current/new code
- §8 Deployment Plan
- For TRDs: §5/§6 Architecture, §8 API Contract, §9 Auth Matrix, §10 Schema, §23 (tool registry if present)
[paste]

Verify every factual claim:

1. FILE PATHS — does every mentioned file exist? glob each. Flag missing.
2. LINE NUMBERS — read each referenced range. Does "Current code" match what's in the file? Flag ANY drift.
3. SYMBOLS — grep every function, component, hook, store, Drizzle table, Zustand slice, Hono route name mentioned. Flag any that don't exist.
4. DRIZZLE SCHEMA — for each schema claim: read backend/src/db/schema*.ts. Confirm table/column names, FKs, indexes match. No `amplify/backend/api/step/schema.graphql` — that is Step, not SimpleHouse. **Additionally (v2): for every D1 column referenced in `WHERE`, `SET`, `SELECT` clauses or in Drizzle query-builder chains in the plan's task blocks — grep the column against the matching table in `backend/src/db/schema*.ts`. Missing column = CRITICAL.**
5. MIGRATION NUMBERING AND DDL DIRECTION — for each SQL migration: confirm `backend/migrations/` (NOT `backend/database/migrations/`). Find next-available number (`ls backend/migrations/ | tail`). Flag collisions. **Additionally (v2): for each DDL statement, verify direction consistency: every `ALTER TABLE t ADD COLUMN col` ⇒ grep schema shows `col` ABSENT from `t` today (else D1 throws `duplicate column name: col` at runtime); every `DROP COLUMN col` / `WHERE col = ?` / `SET col = ?` ⇒ `col` PRESENT (else `no such column`); every `CREATE TABLE t` ⇒ `t` ABSENT. Direction mismatch = CRITICAL.**
6. HONO ROUTE MOUNTS — for each new/changed route: confirm `app.route('/foo', fooRoutes)` in `backend/src/index.ts` exists, or flag as missing.
7. AUTH MIDDLEWARE ATTACH — every household-scoped route does `.use('/*', authMiddleware())` at the top? Compare to `routes/chat.ts`. Missing = CRITICAL.
8. HOUSEHOLD SCOPING — every household-scoped endpoint: does it (a) accept `householdId` as URL param, (b) verify membership via `HouseholdService.verifyAccess(hid, userId)` or equivalent? Missing = CRITICAL.
9. WRANGLER BINDINGS — for every env var, KV, R2, or DO used in new code: confirm it exists in `backend/wrangler.toml` for all environments (top-level, staging, production, dev-preview when applicable).
10. DO MIGRATIONS — new DO class requires a `[[migrations]]` block in `wrangler.toml` (`tag = "vN"`, `new_sqlite_classes = [...]`). Missing = CRITICAL. (Note: project uses `new_sqlite_classes` for SQLite-backed DOs.)
11. EXPO-ROUTER vs REACT-NAVIGATION — new screens: is the registration path correct? Active entry is expo-router (`app/`). `src/App.tsx` is the classic RN-Navigation entry and is **dead code** — `package.json:4` sets `main: expo-router/entry`, so the file is not loaded at runtime. ANY task that modifies `src/App.tsx` for navigation OR `linking` config is editing dead code = CRITICAL unless explicitly reviving the classic entry is part of scope (v2 carve-out fix: prior "except for the `linking` config reference" treated a dead reference as live).
12. DEEP LINKS — active entry FIRST: read `package.json` `main` field. If `main === 'expo-router/entry'` (SimpleHouse default), deep links MUST live under `app/` via file-system routing (e.g. `app/briefing/[date].tsx`); edits to `src/App.tsx linking.config` are DEAD CODE and CRITICAL. If `main === 'index.js'` or a classic entry, confirm via grep of the file's runtime imports before accepting the edit.
13. MMKV / STORAGE — new persisted state: confirm the `storageHelpers` pattern from `src/services/storage/`. Never direct MMKV calls in stores/components. Never `SecureStore` for non-secrets.
14. REACT-NATIVE-WEBVIEW — not installed by default. If the plan introduces it: confirm a task adds it to `package.json`, runs `pod install`, and rebuilds the dev client. Confirm the WebView config uses: `originWhitelist=['about:blank']`, `javaScriptEnabled` only if bundled JS, `onShouldStartLoadWithRequest` blocks nav, `setSupportMultipleWindows=false`, CSP meta injected server-side.
15. ENV CONFIG — new env var or URL: added to `src/config/env.ts` and gated on `__DEV__` correctly.
16. TESTS — for each new test: is the path correct (`backend/__tests__/**/*.test.ts` for Worker via vitest + `@cloudflare/vitest-pool-workers`; `__tests__/**/*.test.tsx` for RN via jest)? Configured framework right? (Note: `backend/src/__tests__/` does NOT exist in this repo — flag any plan that prescribes it as BROKEN.)
17. NO GENERATED / VENDOR EDITS — confirm no task edits `node_modules`, `ios/Pods`, `android/build`, or `vendor/`. Flag as CRITICAL.
18. ERROR-CODE COMPLETENESS — if the plan/TRD defines error codes, confirm every code maps to at least one named test with explicit assertion. Missing code = CRITICAL.
19. CATCH-BLOCK FALL-THROUGH — scan any Worker try/catch for fall-through into an unrelated error handler below. Flag as CRITICAL.
20. FIX UNIFORMITY — if one call site of a pattern is fixed (auth, validation, analytics, origin:'ai_chat'), confirm all other call sites receive the same fix.
21. STAGING DO BLOCK — if the plan introduces a Durable Object, confirm an explicit mitigation for the staging DO block (e.g. `dev-preview` Worker). Absence = WARNING.
22. TRD↔IP FIELD PARITY (pair-mode only) — extract every flag key, endpoint path, tool name, model ID, phase number, numeric tool count, migration filename, and decision ID from both docs, **AND every identifier explicitly enumerated in a plan-declared registry block (non-exhaustive examples: MMKV keys, CONFIG_KV keys, analytics event names, cache keys, queue names, DO binding names, SSE event types, push `data.type` values, Drizzle-enum text-column literal values)**. For each: TRD value must match IP verbatim, OR the IP must carry an explicit override note (`"overrides TRD §X because Y"`). URL path segments and TypeScript identifiers occupy different namespaces — do NOT cross-normalize (`/ai-chat` ≠ `aiChat`; flag as mismatch). Unexplained mismatch = CRITICAL.
23. REVISION-HISTORY CLAIM VERIFICATION — for every entry in the plan's `Revision History` or `§0.N` changelog block: open the claimed file:line and confirm (a) the string is present, AND (b) ≥20 lines of surrounding context show the *structural position* matches the claim (e.g. "middleware attached BEFORE route registration", "idempotency check BEFORE the DB write", "auth guard SCOPES the entire handler body"). String-match alone is NOT sufficient for ordering/scope-dependent fixes. Unverified claim = CRITICAL.
24. FORWARD-REFERENCE RESOLUTION — topo-sort Produces/Consumes across phases (if the plan uses that schema). Any Consumed symbol not Produced by a strictly-earlier phase (and not listed in that phase's `external:`) is CRITICAL.
25. PARITY-UNIVERSE ENUMERATION — for any "every X → Y" claim where X is not already enumerated in a preceding §5 table, confirm §5 includes a mechanically-reproducible enumeration backed by copy-pasted shell output (e.g. `find backend/src/routes -name '*.ts'` stdout with row count). LLM-authored lists without evidence = CRITICAL. Re-run the command yourself and compare row count to the table.
26. IDENTIFIER CONSISTENCY (intra-doc) — extract every flag key, endpoint path, tool name, model ID, phase number, numeric count, decision ID, **AND every identifier explicitly enumerated in a plan-declared registry block (non-exhaustive examples: MMKV keys, CONFIG_KV keys, analytics event names, cache keys, queue names, DO binding names, SSE event types, push `data.type` values, Drizzle-enum text-column literal values)** that appears multiple times in the SAME document. Any that appears with two different values (including prefix-drift like `aihousekeeper_has_seen_aihousekeeper_intro` in the registry vs `has_seen_aihousekeeper_intro` in prose) = CRITICAL.
27. CLOUDFLARE-SPECIFIC — if the plan references SDK versions / beta headers / `cache_control` TTLs: mark the version string `⚠️ Unverified` unless cross-checked. Examples: `@anthropic-ai/sdk >=0.40` for extended-cache-ttl, `anthropic-beta: extended-cache-ttl-2024-xx-xx`. Claims without a version/doc anchor = WARNING.
28. ARITHMETIC RECONCILIATION (v2) — for any partitioned-sum claim (`Total = a + b + c + ...`) in the plan OR per-category breakdown table: extract addends, delegate arithmetic to Bash (`python3 -c 'print(a+b+c+...)'` primary / `node -e 'console.log(a+b+c+...)'` fallback), compare recomputed sum vs stated total. **Multi-factor arithmetic:** for any row value that is a computed multiplicative expression (`qty × unit_cost`, `count × rate × period` — common in cost / capacity / SLO tables): (a) identify every factor — for LLM cost rows specifically, BOTH input-token cost AND output-token cost factors MUST appear OR the row MUST declare `output=0` with rationale (output-free LLM calls are rare); (b) recompute via the same Bash interpreter, showing all factors; (c) compare row-level AND total-level. Missing-factor errors (e.g. omitted output-token cost, wrong price tier) = CRITICAL. Grand-total self-consistency with under-estimated row values does NOT excuse row-level errors. No-op when no numeric breakdown exists. Show recomputed values in the review response.

Return:
- ✅ CONFIRMED (be specific — file:line)
- ❌ BROKEN (with current state)
- ❌ REVISION-CLAIM UNVERIFIED (claim text + what the file actually shows)
- ⚠️ UNVERIFIABLE (why)
```

Cycles 2-5 prompt (incremental):
```
Incremental codebase validation. Re-check only BROKEN / UNVERIFIED items plus any new content.

Changed sections from last cycle:
[paste]

Previously CONFIRMED (skip):
[paste list]

Re-check list:
[paste]

Additionally: open the NEW version's Revision History / §0.N changelog block. For every entry that claims a fix was applied: (a) open the claimed file:line and confirm the string is present, AND (b) read ≥20 lines of surrounding context to confirm the structural position matches the claim. Unverified claims = CRITICAL.

Return: ✅ NOW CONFIRMED / ❌ STILL BROKEN / 🆕 NEW BROKEN / ⚠️ STILL UNVERIFIABLE / 🆕 REVISION-CLAIM UNVERIFIED
```

---

**Agent B — Architecture, Safety, Production Readiness** (`subagent_type: Plan`, `model: grok-4.5-fast-xhigh`)

Prompt:
```
Deep review of a SimpleHouse plan.

Stack: React Native 0.81 / Expo 54 / expo-router + RN Navigation hybrid / Zustand + MMKV / TanStack Query / TypeScript strict / Cloudflare Workers + Hono / D1 + Drizzle / Durable Objects (JobManagerDO, RateLimiterDO, chat-session DO per feature) / JWT auth.

Plan — paste these sections ONLY:
- §1 Overview / §2 Architecture Decisions (or ADR table)
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
- Revision History / §0.N changelog if present
[paste]

Hard project rules (violations = CRITICAL):
- BE: every household-scoped route uses authMiddleware + verifies household membership.
- BE: `aws-sdk` / `@aws-sdk/*` usage is BANNED (this is Cloudflare Workers, not Lambda). Flag any import.
- BE: no `process.env` access — use the typed `Env` interface from `backend/src/types/`.
- BE: no in-memory rate limiter for multi-isolate endpoints — use the `RATE_LIMITER` DO-backed helper.
- BE: Drizzle ORM — never raw SQL in route handlers (migrations excepted).
- BE: no function-specific Cloudflare secrets — share via `wrangler secret put` and the typed `Env`.
- BE: no Amplify / CloudFormation / Lambda / DynamoDB / StackMapping references (those are Step artifacts).
- FE: no `any` unless explicitly justified; TypeScript is strict (`noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`).
- FE: no direct MMKV calls — always `storageHelpers`.
- FE: no `SecureStore` for non-secrets.
- FE: no simultaneous edits to `app/` and `src/navigation/` without an explicit §3 decision on which is active.
- Never import `react-native-webview` without explicit CSP + sandbox config.
- Never expose a JWT or refresh token to the WebView's `window`.
- Never auto-execute a mutating tool call.
- Never use `#if DEBUG` or Swift-style gating — `__DEV__` in RN, KV feature flag in Worker.
- Environments: `top-level` / `staging` / `production` / `dev-preview`. Never `dev` (no `[env.dev]` block), never `prod`, never `stg` (that's Step).

Evaluate:
1. TASK COMPLETENESS — every file in §5 has a corresponding task? CRITICAL if missing.
2. PRE-CONDITIONS — complete enough for a cold engineer? WARNING if not.
3. PHASE ISOLATION — each phase independently testable? CRITICAL if implicit cross-phase dep.
4. ROLLBACK COMPLETENESS — every phase has a rollback? WARNING if missing.
5. TEST COVERAGE — unit + integration for every new service/tool/store? WARNING if critical path uncovered.
6. DEPLOYMENT ORDER SAFETY — any window where old RN talks to new Worker, or new Worker uses a migration that hasn't run? CRITICAL if unsafe.
7. MONITORING GAPS — alarms/alerts for new routes + LLM cost + kill switch + WebView errors? WARNING if missing.
8. DEFINITION OF DONE — specific enough to measure? WARNING if vague.
9. KNOWN GAPS — documented? WARNING if undocumented deferral.
10. PERFORMANCE — any task introducing N+1 queries, hot partitions, unbounded LLM context? WARNING.
11. REACT QUERY INVALIDATION — any mutation without a corresponding invalidateQueries map? WARNING.
12. ZUSTAND STORE SYNC — mutations that bypass the store and leave UI stale? WARNING.
13. TYPESCRIPT STRICT — any new `any`, `as unknown as T`, `@ts-ignore`? WARNING unless justified.
14. EXPO CONFIG — any change requiring expo-config-plugin, app.json, or prebuild? Flag explicit.
15. KILL SWITCH — documented end-to-end (mechanism, activation cmd, verification, revert, mid-stream behavior)? For every security-critical branch (kill-switch deny, auth deny, tool-approval gate, context-redaction failure), confirm the test's assertion literal matches the code's branch literal — e.g. fail-closed code returning 503 must have a test asserting 503 on the unreachable-KV path, NOT 200. Code-vs-test security-semantics mismatch = CRITICAL.
16. OPERATIONAL RUNBOOK — P0/P1 features: likely failure modes, detection, remediation? WARNING if absent.
17. DEPLOYMENT WINDOW SAFETY — Worker + RN mismatch windows? CRITICAL if unsafe.
18. TOOL-SCHEMA VERSIONING — if LLM tools involved, `X-Tools-Version` header + 2-version backward compat? WARNING.
19. CONTEXT REDACTION — any LLM context built without a per-tool allowlist? CRITICAL (PII exposure).
20. IDEMPOTENCY — mutating endpoints: client-or-server idempotency key + server-side dedup + TTL? WARNING if absent.
21. WEBVIEW HARDENING — full config present? CRITICAL for any WebView task without CSP / originWhitelist / setSupportMultipleWindows=false / server-side HTML sanitization.
22. SECRET HANDLING — new secret: `wrangler secret put <NAME> --env <env>`? No commit of `.dev.vars`? WARNING.
23. INTERNAL CONTRADICTIONS — any task, ADR row, §1 overview, §2 decision table, §10 analytics spec, SSE event list / auth matrix / rate-limit bucket, or §0.N revision changelog stating a different flag key / endpoint path / phase number / provider choice / model ID / tool count / migration path than another section of the same document = CRITICAL. Extract every flag key, endpoint path, tool name, model ID, phase number, numeric count, decision ID, **AND every identifier explicitly enumerated in a plan-declared registry block (non-exhaustive examples: MMKV keys, CONFIG_KV keys, analytics event names, cache keys, queue names, DO binding names, SSE event types, push `data.type` values, Drizzle-enum text-column literal values)**; flag any appearing with two different values.
24. CROSS-DOCUMENT CONSISTENCY (pair-mode) — when reviewing a TRD + Implementation Plan together, run the same identifier-consistency sweep across both docs. TRD must not state one ticket TTL / route prefix / tool count / phase number / provider / model ID while the IP states another. Unexplained divergence = CRITICAL.
25. SSE SAFETY (Cloudflare Workers) — any SSE feature must confirm: (a) CPU-time budget is respected while connection is open (no infinite loops without awaits / alarms), (b) heartbeat / keepalive strategy, (c) auth refresh path for long streams (JWT ≈ 15 min typical), (d) kill-switch propagation to mid-stream, (e) reconnect idempotency. Missing = WARNING to CRITICAL depending on impact.
26. DURABLE OBJECT HIBERNATION — any long-lived DO with in-memory state must either (a) persist to D1 on cold-start hibernation, OR (b) design around hibernation (idle DO is fine, but resuming a tool-loop after hibernation requires rehydration). Missing plan = WARNING.
27. ANTHROPIC SDK / BETA HEADERS — any `anthropic-beta` header / `cache_control.ttl` claim must cite the SDK version that supports it. `prompt-caching-2024-07-31` is GA (no beta header needed). Extended-cache-ttl still requires an opt-in flag. Absence of version anchor = WARNING.

Return: CRITICAL / WARNING / SUGGESTION with file:line or §N.M reference.
```

Cycles 2-5 delta prompt:
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

**Agent C — Modern Practices & Official-Doc Research** (`subagent_type: general-purpose`, `model: composer-2.5-fast`)

Prompt:
```
You are researching current best practices for a specific SimpleHouse feature plan. Use WebSearch to find current official documentation and community best practices (2025/2026).

Plan summary: [paste problem statement, root cause / goal, and architectural approach from §1 + ADRs]

Research tasks:
1. Identify the core technology pattern(s) being changed (e.g. "Cloudflare Workers SSE on Hono", "Durable Object alarm-driven state machine", "Claude tool-use loop with prompt caching", "React Native SSE consumer with auth bearer", "DOMPurify on Workers runtime").
2. Search for official docs: Cloudflare Workers / Durable Objects / D1 / KV; Hono streamSSE / streamText; Anthropic Messages API (tool_use loop, streaming, prompt caching, extended-cache-ttl); Expo / React Navigation / expo-router; react-native-sse; react-native-webview; react-native-pdf; Zustand + MMKV persistence.
3. Search for known pitfalls / gotchas with this approach in 2025/2026 (Workers CPU budget, DO hibernation, KV eventual consistency, JWT leakage via EventSource query params, tool-loop infinite recursion, WebView prompt-injection).
4. Search for recommended alternatives if a better pattern exists.
5. Check prompt-caching / tool-use semantics: at least 1024-token prefix for cache, `cache_control` placement rules, breakpoint limits (4 max), TTL options.
6. For SSE: confirm whether EventSource (query-param ticket auth) or fetch-stream (bearer header) is the current recommendation for the runtime combo used.

Return:
- ALIGNED: what the plan does correctly per modern standards (with source links)
- OUTDATED / RISKY: what doesn't match current best practices (with source links)
- RECOMMENDED CHANGES: specific improvements with rationale + file:line anchor in the plan
- OPEN QUESTIONS: anything that requires an explicit plan-level decision that's currently implicit
```

### Step 2 — Synthesize

After all three agents return, consolidate:

```
=== CYCLE N FINDINGS ===

CRITICAL (must fix):
- [list with file:line or §N.M refs]

WARNING (should fix):
- [list]

SUGGESTIONS (optional):
- [list]

Research notes:
- [key findings from Agent C]
```

### Step 2.5 — Numbers & Identifier Consistency Pass

After synthesis, run a targeted pass on every count / identifier in the plan(s):

1. **Test counts** — for every "N scenarios" / "N tests" claim, count the actual rows. Mismatch = WARNING.
2. **Scenario counts / table rows** — match the stated total.
3. **Version numbers** — header vs filename vs footer vs revision-history rows consistent.
4. **Phase/task counts** — "§1 Overview says N phases" vs actual §4 phase count.
5. **Tool counts** — if a tool registry is enumerated, count rows and match every "Total: N" claim. Check sub-category math (READ + LOW + HIGH + NAV = Total).
6. **Revision-history claims** — for each "Fixed X / Added Y" line, verify the change appears in the body (Agent A does the structural pass; this is the count pass).
7. **Pair-mode only** — TRD's "tool total" must equal IP's "tool total"; TRD's phase numbers must match IP's; TRD's flag keys must match IP's.

Only add findings not already listed under CRITICAL/WARNING above.

### Step 3 — Decision

- **No CRITICAL or WARNING** → READY. Go to Final Report. Stop cycling.
- **Issues + cycles remaining** → proceed to Step 4.
- **Cycle 5 reached with remaining items** → Final Report with unresolved items flagged.

### Step 4 — Apply fixes + bump version

1. Compute new version: `v1.0 → v1.1`, …, up to `v1.5`.
2. For single-doc mode, edit in place if the change is minimal; otherwise write a new file with version incremented in the filename (if the project uses `(v 1.X)` in filenames). Announce the path chosen.
3. **⚠️ Large Document Multi-Part Writing** — estimate total lines. Documents > 400 lines must be split to avoid the `API Error: Claude's response exceeded the 32000 output token maximum`. Split at natural `##` section boundaries using Write (Part 1) + Edit (Part 2+), with placeholder `<!-- PART_2_CONTINUES -->` between parts. Announce `📄 Part {N} written. Writing Part {N+1}...` between each.
4. Apply every fix — correct broken file paths, line numbers, symbol names, flag keys, identifier mismatches. Expand missing edge cases, rollback steps, monitoring. Add an entry to the plan's `## Revision History` documenting what changed this cycle.
5. Update the header version + date.
6. Announce: `Created v1.X — proceeding to Cycle N+1.`
7. Update working-plan path to the new file and repeat from Step 1.

---

## Final Report

```
=== EVALUATION COMPLETE ===

Cycles run: N/5
Final version: [filename @ vN.N]
Verdict: READY ✅ / NEEDS HUMAN REVIEW ⚠️

Changes made across versions:
- v1.0 → v1.1: [summary]
- v1.1 → v1.2: [summary]
...

Remaining issues (if NEEDS HUMAN REVIEW):
- [list with reason not auto-resolved]

Recommended next step:
- [e.g. "Implement per the plan" / "Confirm X with product" / "Security review before Phase 7"]
```

---

## Hard Rules (always enforce regardless of plan content)

- **Environments:** `top-level` (local / default in `wrangler.toml`), `staging` (DO-broken), `production`, `dev-preview`. Never `dev` (no `[env.dev]` block), never `prod`, never `stg`. Flag violations as BROKEN.
- **Migration path:** `backend/migrations/`. Never `backend/database/migrations/`. Flag as BROKEN.
- **wrangler deploy syntax:** `wrangler deploy --env {staging|production|dev-preview}` (and top-level for local). Never prescribe `--env dev`.
- **`amplify push` / `amplify codegen` / `aws-sdk` / `@aws-sdk/*`** — flag as BROKEN (Step iOS artifacts; not in this repo).
- **Step iOS references** — any `amplify/`, `step/`, `API.swift`, `DebugConfig.Services`, `FeatureFlagService` (UserDefaults), `us-east-2`, `Fn::ImportValue`, `CloudFormation`, `StackMapping`, `team-provider-info.json`, `event.json`, `adminDeleteUser`, `Cognito` reference = BROKEN.
- **Swift / SwiftUI / Lambda / DynamoDB / AppSync** references in a SimpleHouse plan = BROKEN.
- **Migrations are immutable once applied to remote.** Editing a shipped migration is BROKEN — add a new one.
- **`npm test` prerequisite:** if a Worker plan references `npm test`, flag if `npm install` in `backend/` isn't mentioned as a prerequisite.
- **Secrets:** `wrangler secret put <NAME> --env {env}`. Never committed. Never `.dev.vars` in the repo root without `.gitignore` coverage.
- **DO migrations:** new DO class → new `[[migrations]]` block (`tag`, `new_sqlite_classes` for SQLite-backed). Renaming a DO class requires a new migration tag. Flag absence as CRITICAL.
- **Kill switch:** any new AI / LLM / streaming feature needs a sub-60s kill switch via `CONFIG_KV`, documented with activation cmd + verification + revert. Absence = WARNING.
- **Operational runbook:** P0/P1 features need a runbook for the top-3 likely production failures with detection + remediation. Absence = WARNING.
- **Validator regex coverage:** for plans that add regex-based validators, verify the regex catches the actual observed failure patterns from the plan's own evidence, not just theoretical ones.
- **App constants:** any bundle ID, URL scheme, API base URL, Team ID must be cross-checked against `app.json`, `src/config/env.ts`, `ios/Info.plist`, `android/app/build.gradle`. Wrong = CRITICAL, unverified = WARNING.
- **react-native-webview:** any plan introducing it must include: `package.json` install, `pod install`, EAS dev-client rebuild, CSP via server-injected `<meta>`, `originWhitelist=['about:blank']`, `onShouldStartLoadWithRequest` deny-by-default, `setSupportMultipleWindows=false`, no JWT exposure to `window`.
- **Anthropic SDK version anchor:** any `cache_control.ttl='1h'` / `cache_control.ttl='5m'` / extended-cache-ttl claim must cite `@anthropic-ai/sdk` version `>=0.40`. Missing version anchor = WARNING.
- **Claude model IDs:** `claude-sonnet-4-5-20250929` is the baseline in `backend/src/ai/claude-provider.ts`. `haiku-4-5` / `opus-4-7` family IDs require Anthropic account verification — mark `⚠️ Unverified` unless cited.
- **Provider isolation:** Gemini is legacy-only (existing `/chat` RAG + contractor search + floor-plan analysis). New AI features should default to Claude via `claude-provider.ts`. Plans introducing Gemini on a new chat path without a documented decision = WARNING.
- **Route prefix:** new AI chat surface is `/ai-chat/*` per current repo convention. `/ai/chat/*` is the legacy Gemini path kept for 410 retirement only. Mixing them in a new plan = CRITICAL.
- **Hard rule budget:** 25 rules. Current = 22. New rules require retiring an adjacent rule or justifying the increase.

---

## Style Rules

- ALL code blocks have language tags: ` ```ts `, ` ```tsx `, ` ```sql `, ` ```bash `, ` ```toml `, ` ```json `.
- ALL file refs: `path/to/file.ts:line` — never vague.
- "Current code" blocks: paste the actual code, not a paraphrase.
- "New code" blocks: exact replacement with the same context.
- Tables for: risks, affected files, phase summary, tests, error codes, parity-universe enumeration.
- Tasks are INDEPENDENT + VERIFIABLE.
- Flag any plan step that requires an Xcode / EAS build to verify — remind that the user builds manually.
- Plans edit content, not filenames, unless the project's existing convention (e.g. `(v 1.X)` suffix) dictates otherwise. Confirm with user before creating a new filename when editing in place is viable.

---

## Revision Log

- **v 1 — 2026-04-22** — full rewrite for SimpleHouse stack.
  Triggering gap: `/review-plan` was invoked against SimpleHouse docs (`MCP_UI_TRD.md` + `MCP_UI_Implementation_Plan.md`) while the skill was entirely Step iOS / Amplify / SwiftUI / Lambda. Every hard rule, every agent prompt, and every validation check was misaligned — required an in-session adaptation for the review to be useful at all.
  Artifact: `/review-plan` invocation on `documents/Requirenments/AI Houskeeper /MCP_UI_TRD.md` + `MCP_UI_Implementation_Plan.md` → v1.3 pass.
  MAST code: FM-1.4 (wrong project referenced) + FM-4.2 (hard-coded rules for an unrelated codebase) + FM-3.1 (missing stack-specific checks: D1, Drizzle, Hono, Workers, DO, MMKV, Zustand, expo-router).

  Changes applied:
  1. Project Structure Reference rewritten for SimpleHouse (RN/Expo + Cloudflare Workers/Hono/D1/Drizzle).
  2. Agent A rewritten: Hono route mounts, Drizzle schema, `backend/migrations/` number, JWT auth middleware attach, household scoping, DO `[[migrations]]` block, `wrangler.toml` bindings, MMKV via helpers, expo-router vs RN Navigation, react-native-webview hardening, parity-universe enumeration, revision-history claim verification.
  3. Agent B rewritten: Workers CPU budget, DO hibernation, TypeScript strict, TanStack Query invalidation, Zustand sync, no `process.env`, no `aws-sdk`, kill-switch sub-60s, SSE auth refresh, context redaction allowlist, cross-document consistency in pair-mode.
  4. Agent C scope widened: Cloudflare Workers SSE, DO alarms, Anthropic Messages tool-loop + prompt caching, `react-native-sse` vs EventSource, `react-native-webview` hardening.
  5. Input handling grew pair-mode (TRD + IP) for cross-doc consistency — surfaces the single most common failure pattern (e.g. route prefix split, tool count mismatch, ticket TTL disagreement, HIGH_WRITE parking design divergence).
  6. Hard rules replaced wholesale: Step-specific rules (StackMapping, team-provider-info, CFN, `amplify push`, `us-east-2`, `dev/stg/production`) removed; SimpleHouse rules added (environments `top-level/staging/production/dev-preview`, `backend/migrations/` path, DO migrations block, Anthropic SDK version anchor, Claude provider isolation, `/ai-chat/*` route prefix).
  7. Revision-history claim verification (Agent A check #23) elevated to a first-class cycle requirement after the v1.1→v1.2 MCP_UI plan pass revealed multiple "claimed but not applied" fixes — including a security-critical killswitch fail-closed claim, a DO-id derivation claim, and a route-prefix standardization claim.
  8. Pair-mode identifier consistency sweep (Agent A check #22, Agent B check #24) added as the canonical detector for TRD↔IP drift.
  9. Large Document Multi-Part Writing protocol added for plans > 400 lines (Phase 4 Step 4).

  Chesterton preserved: none — previous rules were wholly project-specific, no adjacent-but-distinct Step rules apply to SimpleHouse.
  Rule-budget: Hard rules 25 (Step) → 22 (SimpleHouse). Under 25-rule ceiling.
  Over-fit risk: LOW (rules scoped to objective properties: paths, identifiers, counts, structural positions).
  Ledger: `.claude/retrospectives/review-plan_lessons.md#2026-04-22` (create if absent).

- **v 2 — 2026-04-23** — 8 minimum-incision edits applied as sibling-mirror of `create-implementation-plan` v3 (per Reviewer A #23 FIX UNIFORMITY).
  Triggering gap: in-session `/review-plan` run itself (4 cycles on `MCP_UI_Implementation_Plan_v2.0.md`) demonstrated that review-plan missed or belatedly caught several defect classes:
  - Cycle 1 missed G1 (phantom columns) and G2 (ALTER column collision) — caught only in Cycle 2 after the parent `/fix-skill` invocation prompted deeper schema grep.
  - Cycle 1 allowed G7 (dead-code `src/App.tsx linking.config` edits) because rule #11 carried a stale carve-out ("except for the `linking` config reference") that directly contradicts ground-truth `package.json:4 main=expo-router/entry`.
  - Cycle 1 missed G8 (cost-table multi-factor arithmetic off 5-10×) because review-plan has NO arithmetic-reconciliation check at all.
  - Cycle 1 caught G9 (MMKV registry drift) only because the v2.0 plan's registry was explicit — more subtle drift would have escaped closed-list identifier enumerations in #22/#26/#B23.
  Artifact: `documents/Requirenments/AI Houskeeper /MCP_UI_Implementation_Plan_v2.0.md` (4-cycle correction to v2.4 via 400+ lines of fixes).
  MAST code: FM-3.3 (incorrect verification — under-specified check universes) + FM-2.4 (information inconsistency — closed-list enumerations) + FM-1.1 (spec error — #11 carried a stale carve-out that contradicted line 27).
  Classification: 5 extensions (E1, E2, E5, E6, E7, E8 — new clauses added to existing rules or new check #28) + 2 rewrites (E3, E4 — replace wrong prescriptions with active-entry-FIRST probe). All DISOBEDIENCE/ABSENCE gaps; no REGRESSION or DRIFT.
  Regression replay: YES — each edit's target gap would have been caught in Cycle 1 of the Target 1 review with the patched rule in place (validated via Target 1 Phase 3 analysis agent + Target 2 single-agent verification).

  Edits applied in v2:
  1. Agent A #4 DRIZZLE SCHEMA — added "for every D1 column referenced in WHERE/SET/SELECT/Drizzle-query-builder, grep the column against the matching table". Covers G1 phantom columns.
  2. Agent A #5 MIGRATION NUMBERING AND DDL DIRECTION — added direction consistency check (ADD requires absent, DROP/WHERE/SET require present, CREATE TABLE requires absent), named the D1 runtime errors. Covers G2 ALTER collision.
  3. Agent A #11 EXPO-ROUTER vs REACT-NAVIGATION — struck the stale "except for the `linking` config reference" carve-out; `src/App.tsx` is fully dead; ANY edit to it for nav or linking = CRITICAL. Covers G7.
  4. Agent A #12 DEEP LINKS — rewrote to active-entry-FIRST: read `package.json main`; if `expo-router/entry`, `src/App.tsx linking.config` edits are DEAD CODE and CRITICAL; if classic entry, confirm via grep of runtime imports. Same ground as G7.
  5. Agent A #22 TRD↔IP FIELD PARITY — opened closed identifier list to include plan-declared registries (non-exhaustive examples: MMKV, CONFIG_KV, analytics events, cache keys, queue names, DO binding names, SSE event types, push `data.type` values, Drizzle-enum text-column literals). Covers G9 pair-mode dimension.
  6. Agent A #26 IDENTIFIER CONSISTENCY (intra-doc) — same open-list extension. Covers G9 intra-doc dimension with explicit prefix-drift example.
  7. Agent B #23 INTERNAL CONTRADICTIONS — same open-list extension. Covers G9 safety-review dimension.
  8. Agent A new check #28 ARITHMETIC RECONCILIATION — partitioned-sum reconciliation + multi-factor arithmetic (qty × unit_cost) with Bash delegation (`python3 -c` / `node -e`). LLM cost rows MUST show input+output factors or declare `output=0` with rationale. Grand-total self-consistency with under-estimated rows = double failure. Covers G8.

  NOT applied — deferred for future fix-skill cycles (see known limitations):
  - Phantom dependency check (G4) — create-IP M2 covers "already-installed package" grep; review-plan Agent A has no sibling rule yet. Future addition candidate at Agent A #3.
  - Phantom CLI subcommand check (G6) — create-IP M8 added to §0 external-contract class; review-plan has no §0 analog. Future addition candidate at Agent A as new check #29 (or tighten existing #14 react-native-webview pattern).
  - NF-gate binding (G10) — create-IP M7 at Reviewer B #8; review-plan Agent B has no sibling. Future addition candidate at Agent B #8 DEFINITION OF DONE.
  - Phase-5 editorial dedup (G11) — create-IP M9 is a generation-layer concern; review-plan's own Step 4 "Apply fixes + bump version" might extend with a dedup pass. Future addition.

  Cycle verdicts (condensed — see ledger for full):
  - Target 1 Phase 3 (Reviewer B Cross-Skill Coherence) identified 4 required mirrors: M3, M4, M6 (three sites), M5-as-layered-separation. All three sibling-mirrors (E1/E2 = M3; E3/E4 = M4; E5/E6/E7 = M6) applied here. M5-equivalent (E8) applied as a new check since review-plan missed G8 in Cycle 1 — separation-of-concerns alone did not hold.
  - Target 2 Phase 1 single-agent verification: ACCEPT all 8 with grammar / "non-exhaustive examples" refinements applied to E3, E5, E6, E7.

  Chesterton preserved: v1 Revision Log change #8 ("Pair-mode identifier consistency sweep... canonical detector for TRD↔IP drift") — E5/E6/E7 PRESERVE every original closed-list item and add an open-list AND clause; canonical status intact. #27 CLOUDFLARE-SPECIFIC adjacent to E8 arithmetic but orthogonal (version/beta-header claim vs numeric computation). Hard Rules all untouched.
  Rule-budget: Agent A 27 → 28 (E8 adds one new check; all others are in-place extensions/rewrites). Hard Rules 22 → 22. Agent B 27 → 27. Under create-IP v2-ledger 30-rule consolidation threshold.
  Over-fit risk after v2: LOW-to-MEDIUM. E8 LLM-cost-row requirement "both input and output token factors OR declare output=0" is domain-opinionated but scoped to LLM rows; no-ops on plans without cost tables. E1-E7 all structurally low-FP (objective greps). v1 Revision Log has a pre-existing off-by-one reference ("Agent B check #24 CROSS-DOCUMENT CONSISTENCY" — actually #23 is INTERNAL CONTRADICTIONS; #24 is CROSS-DOC) — editorial fix deferred, not blocking.

  Known limitations (v2 — flagged for v3):
  - Four absence classes (G4 phantom dep, G6 phantom CLI, G10 NF-gate, G11 editorial dedup) have no review-plan siblings. If any recurs on a new artifact, a v3 fix-skill cycle should add them.
  - Agent A #3 SYMBOLS is still a single check; create-IP v3 Reviewer C flagged the comprehension-threshold concern. If review-plan's #3 is ever extended beyond its current "grep function/component/hook/store/Drizzle table/Zustand slice/Hono route name" shape, consider splitting.
  - Still no golden-set regression testing for review-plan (create-IP v1/v2 flagged the same). Operational commitment, not a rule.

  Ledger: `.claude/retrospectives/review-plan_lessons.md#2026-04-23-v2`.
