Implement the plan at: $ARGUMENTS

<!-- fix-skill: v 1 -->
<!-- Line 1 is the skill description — do not place metadata above it. -->

You are the **implementation orchestrator** for **SimpleHouse** (React Native 0.81 / Expo 54 + Cloudflare Workers + Hono + D1 + Drizzle + JWT). Your job is to implement every task in the given plan using parallel agents on **Composer 2.5** (`composer-2.5-fast`) or **Cursor Grok 4.5** (`grok-4.5-fast-xhigh`) only, then run a mandatory post-implementation verification pass to catch anything missed.

---

## Project Stack Reference (authoritative)

```
Frontend (React Native / Expo — dev-client, NOT Expo Go)
  src/
    App.tsx              ← classic React Navigation entry (dead — live entry is expo-router/entry per package.json)
    api/                 ← axios clients per domain (chat.ts, tasks.ts, reports.ts, …)
    components/          ← shared components
    config/env.ts        ← API_BASE_URL per __DEV__ + feature-flag helpers
    contexts/            ← ThemeContext, DataContext, ProfileContext, SubscriptionContext, I18nContext
    hooks/               ← shared hooks
    navigation/          ← React Navigation stacks (RootNavigator, MainNavigator, per-domain)
    screens/             ← per-domain screen files
    services/            ← singletons (navigation.ts, storage/, voice-recording.ts, notifications.ts)
    stores/              ← Zustand + MMKV (authStore, householdStore, taskStore, …)
    theme/               ← DesignTokens
    types/               ← shared TS types
    utils/               ← helpers
  app/                   ← expo-router file-system routing (active entry)

Backend (Cloudflare Workers + Hono + D1 + Drizzle)
  backend/
    src/
      index.ts           ← Hono app + route mounts
      ai/                ← AIProvider interface, Claude + Gemini providers, prompts/
      db/                ← Drizzle schemas + drizzle-orm setup
      durable-objects/   ← JobManagerDO, RateLimiterDO (+ any new DOs from the plan)
      middleware/        ← auth.ts (JWT), cors.ts, rate-limit.ts
      queues/            ← PDF + report processing queues
      routes/            ← per-domain Hono route files
      services/          ← business logic
      types/index.ts     ← Env + JWT payload
      utils/             ← jwt, responses, validators
      workers/           ← cron + queue consumers
    migrations/          ← D1 SQL migrations (backend/migrations/ — NEVER backend/database/migrations/)
    wrangler.toml        ← env config: top-level (local), [env.staging], [env.production], optional [env.dev-preview]
    vitest.config.ts     ← @cloudflare/vitest-pool-workers setup

  backend/lambda-processor/ ← auxiliary Python AWS Lambda (report processing). Rare touch; if plan touches it,
                              Lambda-flavored rules (event.json realism, deps install) apply narrowly.
```

**Environments:** `top-level` (local default), `staging`, `production`, optionally `dev-preview` (for DO-requiring features while staging is DO-blocked). There is NO `[env.dev]` block.

**Banned tooling refs in the Implementation Plan and in this skill's outputs:** `aws-sdk`, `amplify`, Swift, SwiftUI, SwiftLint, SwiftFormat, xcodebuild, swiftc, `API.swift`, `amplify/generated/`, `amplify/backend/function/`, Cognito, CloudFormation, `schema.graphql` (AppSync), DynamoDB. These belong to the Step iOS project — NOT SimpleHouse.

---

## Setup

1. Read the full plan at `$ARGUMENTS`. If no path given, ask for it.
2. Extract: phases, tasks (with file paths + line numbers), acceptance criteria, "Do NOT" rules, "IMPORTANT/CRITICAL/⚠️" notes, `Produces:` / `Consumes:` per-task ledgers **if present** (v1.2+ plans add them; v1.0/v1.1 plans omit them — if absent, do a best-effort inference pass from §5 Affected Files + §4 phase order rather than refusing), and every explicit "Note:" call-out. Additionally: if the plan has a `## Revision History` / `§0.N` changelog, open every claimed file:line and confirm the string AND structural position match (≥20 lines of surrounding context) before launching agents. Unverified revision claims block execution until the plan is re-cut.
3. Build a **caller map**: for every shared function, store action, API client method, or React Query key that receives a new side effect — find ALL call sites. Preferred: `ts-morph` via `npx ts-morph-refactor` if installed (`npm ls ts-morph` returns non-empty). Fallback when ts-morph unavailable: `rg -n 'functionName\b' src/ backend/src/` for the symbol, plus `rg -n "from ['\"]@/api/\w+['\"]"` for aliased imports. Grep fallback misses re-exports and aliased imports — note the known limitation in the caller-map output. For each call site, decide: **should the new side effect fire here?** Flag sites that need a guard (e.g. auth-rehydration paths in `authStore`, token-refresh paths, app-launch stores). Include the decision per site in each agent's prompt. Common SimpleHouse shared surfaces:
   - `authStore.setSession()` / `authStore.hydrate()`
   - `householdStore.setActiveHousehold()`
   - `queryClient.invalidateQueries([...])`
   - Analytics trackers in `src/services/`
   - Any Durable Object `fetch()` handler shared across routes
4. Identify **developer-only gates** — list them as blockers not for agents to touch:
   - Cloudflare dashboard: create KV namespace, create D1 database, create R2 bucket, register Queue, add DO `[[migrations]]` tag
   - `wrangler secret put <NAME> --env {staging|production|dev-preview}` (NEVER commit `.dev.vars`)
   - `wrangler kv key put --binding=CONFIG_KV <key> <value> --env <env>` feature-flag seeds
   - `wrangler d1 migrations apply <DB> --env <env>` (ordered: dev-preview → staging → production)
   - `npx expo prebuild --clean` when a native RN dep is added
   - `eas build --profile {development|preview|production}` + TestFlight / Play Internal submission
   - App Store Connect / EAS credentials
5. Extract a **Worker Test Contract** from the plan:
   - Every TRD-defined error code → at least one explicit Vitest assertion (via `@cloudflare/vitest-pool-workers` with Miniflare D1/KV).
   - If plan introduces an SSE endpoint: close-and-reconnect test (client disconnects mid-stream, reopens with `X-Idempotency-Key`, DO rehydrates from D1 and resumes).
   - If plan introduces a Durable Object: hibernation-survival test (DO restart mid-flow preserves state from D1, not in-memory fields).
   - If plan introduces a mutating endpoint: idempotency-key dedup test with TTL.
   - Realistic Vitest fixtures: `Authorization: Bearer <token>`, Zod-valid body, typed `Env` bindings — NEVER placeholder `{key:'value'}`.
   - Command order: `cd backend && npm install` → `npx vitest` (or `npm test`).
6. Extract an **RN Test Contract**:
   - Every new `useMutation` has a matching `invalidateQueries` in `onSettled`.
   - Every new Zustand mutator has a test verifying the store write + MMKV persistence flush.
   - New screens have a mount smoke test via Jest + React Native Testing Library.
   - Command order: `npm install` (root) → `npx jest`.

---

## Phase Grouping

Split the plan's tasks into non-overlapping file domains. **Threshold rule:** if the plan has fewer than 5 total tasks, run with a single orchestrator — do NOT split into three parallel agents with ≤2 tasks each (wasted cost, hallucination risk on empty task lists). If a domain has zero tasks (e.g. RN-only plan has zero Worker tasks), OMIT that agent entirely rather than launching one with an empty prompt. Typical split for FE+BE plans ≥5 tasks:

| Agent | Domain | Typical tasks |
|---|---|---|
| Agent A | **Worker BE** | `backend/src/routes/*.ts`, `backend/src/services/*.ts`, `backend/src/middleware/*.ts`, `backend/src/durable-objects/*.ts`, `backend/src/db/schema*.ts`, `backend/migrations/NNNN_*.sql`, `backend/wrangler.toml` |
| Agent B | **RN FE** | `app/**/*.tsx`, `src/screens/**`, `src/components/**`, `src/stores/**`, `src/api/**`, `src/contexts/**`, `src/navigation/**`, `src/theme/**`, `src/features/**` |
| Agent C | **Shared + Tests** | `src/types/**`, shared Zod schemas, `backend/__tests__/**/*.test.ts` (vitest + `@cloudflare/vitest-pool-workers`), `__tests__/**/*.test.tsx` (jest), `backend/vitest.config.ts`, `jest.config.js` |

Adjust grouping based on actual plan contents. **Agents must never touch the same file.** For plans with ≥2 agents doing ≥3 files each, use git worktrees (`isolation: worktree`) to isolate agent branches; for smaller plans, a single shared worktree is fine.

If the plan touches `backend/lambda-processor/` (auxiliary Python Lambda), add a narrow "Agent D — Lambda processor" row with Python-flavored rules (pytest, `requirements.txt` install, realistic event JSON, CloudWatch log-group reference). This is rare.

---

## Agent Prompt Template

For each agent, the prompt MUST include these sections (do not omit any):

```
ROLE: You are implementing [Phase X tasks] for [ticket / feature name] in SimpleHouse (RN/Expo + Cloudflare Workers).

HARD RULES:
- NEVER run `wrangler deploy`, `eas build`, `wrangler d1 migrations apply`, `wrangler secret put`, `npx expo prebuild`, or any command that mutates cloud state. These are developer-only gates.
- NEVER edit `node_modules/`, `ios/Pods/`, `android/build/`, `.expo/`, auto-generated files, or `vendor/`.
- NEVER import `aws-sdk`, `@aws-sdk/*`, `amplify`, `@aws-amplify/*`, or any Swift file. This is a Cloudflare Workers + RN stack.
- NEVER bypass `authMiddleware()` — every new household-scoped Hono route mounts `.use('/*', authMiddleware())` at file top (pattern: `backend/src/routes/chat.ts`).
- NEVER skip household-membership check inside tool executors or handlers that accept `householdId` — verify via `HouseholdService.verifyAccess(householdId, userId)` (or the project's equivalent helper — grep to confirm the exact method name before using).
- NEVER use raw SQL outside `backend/migrations/`. Use Drizzle queries in routes and services.
- NEVER use `process.env.*` directly — access via the typed `Env` interface (`backend/src/types/index.ts`).
- NEVER call MMKV directly — use `storageHelpers` from `src/services/storage/`. NEVER use `SecureStore` for non-secrets.
- NEVER add inline `any`, `as unknown as T`, `// @ts-ignore`, or `// @ts-expect-error` without a justification comment.
- NEVER hard-code URLs — gate via `src/config/env.ts`'s `__DEV__` pattern.
- NEVER log JWTs, refresh tokens, raw emails, full user IDs, or household addresses.
- Auth is JWT via `jose` (NOT Cognito, NOT Amplify).
- Timestamps in D1 use `datetime('now')` via Drizzle defaults — NOT `strftime(...)` — matching the project-wide convention.

CALLER MAP (critical — read before touching any shared method):
[For each shared function / store action / API client method receiving a new side effect, paste ALL call sites from ts-morph (or grep fallback).
  Per site: file:line, function signature, whether new side effect SHOULD fire here, and guard condition if not.
  SimpleHouse-authentic examples:
  - authStore.setSession() call sites:
    * src/screens/auth/LoginScreen.tsx:N — explicit login success — YES fire analytics trackUserLoggedIn
    * src/stores/authStore.ts:N — hydrate() on app launch (token refresh / cold start) — DO NOT fire trackUserLoggedIn — this is session restore, not a login
    * src/api/client.ts:N — 401 interceptor refresh — DO NOT fire analytics — guard with `reason !== 'refresh'`
  - queryClient.invalidateQueries call sites after mutation X:
    * list all keys that must invalidate (list detail + paginated list + aggregate count if applicable)
  - VoiceRecordingService.stop() call sites (if introducing new side effect on stop)]

DO NOT RULES (verify each after writing — tick off explicitly):
[Copy every "Do NOT", "NEVER", "must NOT" from the plan relevant to this agent's scope.]

PLAN NOTES TO HONOR (copy verbatim from plan):
[Copy every ⚠️, IMPORTANT:, CRITICAL:, Note: in the plan relevant to this agent's scope. Frequently missed — agent must explicitly confirm each honored.]

PRODUCES / CONSUMES LEDGER (topo discipline — plans v1.2+ require this):
[For each task, list the symbols/files Produces and Consumes. Confirm every Consumed symbol is Produced in this phase OR a strictly earlier phase OR listed as `external:` (already exists in the repo).]

TASKS: [list tasks with exact file paths, line numbers from plan]

REFERENCE FILES TO READ FIRST: [list every file the agent must read before writing.
  Common must-reads for this stack: backend/src/middleware/auth.ts, backend/src/types/index.ts,
  backend/wrangler.toml (for binding names), src/config/env.ts, src/stores/authStore.ts,
  src/stores/householdStore.ts, src/api/client.ts, src/services/storage/index.ts.]

ACCEPTANCE CRITERIA CHECKS (run after ALL edits, report each result):
[Copy the grep/file-existence/`tsc --noEmit`/vitest/jest checks from the plan's AC section for this agent's scope.]

WORKER TEST CONTRACT (required when agent touches Worker code/tests):
- List every TRD error code that must have an explicit Vitest assertion.
- If SSE endpoint added: close-and-reconnect test with DO rehydration.
- If DO class added: hibernation-survival test (in-memory fields reset, D1-backed state preserved).
- If mutating endpoint: idempotency-key dedup test with TTL assertion.
- Fixtures: realistic `Authorization: Bearer`, Zod-valid body, typed `Env`. No placeholder payloads.
- Command order in the final developer checklist: `cd backend && npm install` → `npx vitest` (or `npm test`).

RN TEST CONTRACT (required when agent touches RN code/tests):
- Every new `useMutation` → matching `invalidateQueries` in `onSettled`.
- Every new Zustand mutator → test for store write + persistence.
- Every new screen → mount smoke test.
- Command order: `npm install` → `npx jest`.
```

---

## Execution

Launch all agents in a **single parallel message** (one Agent tool call per agent, all in one response). Do not launch sequentially. Use only **Composer 2.5** (`composer-2.5-fast`) or **Cursor Grok 4.5** (`grok-4.5-fast-xhigh`) — never Claude Opus/Sonnet/Haiku or other models. Prefer Composer 2.5 for implementation agents; use Grok 4.5 for verification/review agents.

Wait for all agents to return. Collect their output.

---

## Mandatory Post-Implementation Verification Pass

After all agents complete, run this verification yourself (not via sub-agents):

### 1. Acceptance Criteria Sweep
Run every grep / file-existence / command check from the plan's acceptance criteria. Report pass/fail for each.

### 2. "Do NOT" Rule Audit
For every "Do NOT" / "NEVER" / "must NOT" in the plan:
- Grep the changed files for violations.
- Grep for banned tokens: `aws-sdk`, `@aws-amplify`, `amplify`, `xcodebuild`, `SwiftLint`, `SwiftFormat`, Swift file extensions, `API.swift`, `amplify/generated/`, `amplify/backend/function/`, `process.env` (outside of typed `Env` access), `// @ts-ignore` without a justification comment.
- Report any violation found.

### 3. Caller Map Audit
For every shared function / store action / API client method in the caller map:
- Re-run ts-morph / grep; confirm the call-site set hasn't silently grown.
- For each call site where the new side effect was wired, confirm the guard condition is present for session-restore / token-refresh / app-launch-rehydration paths.
- If a guard is missing → fix it immediately (do not wait for user).

### 4. Plan Notes Audit
For every ⚠️ / IMPORTANT: / CRITICAL: / Note: in the plan:
- Confirm it was honored in the implementation.
- If not → fix immediately.

### 5. Migration Slot Check
For any D1 migration added:
- Confirm the file lives at `backend/migrations/NNNN_*.sql`, NOT `backend/database/migrations/*`.
- Confirm `NNNN` is the next available number (`ls backend/migrations/ | sort | tail -3`).
- Confirm forward SQL is present; confirm reverse SQL is present OR explicit N/A with rationale.
- Confirm the migration has NOT been applied yet (developer gate).
- Confirm `backend/src/db/schema*.ts` Drizzle changes match the SQL.

### 6. TypeScript Strict Compile Gate
- `cd backend && npx tsc --noEmit` → zero errors. Report any.
- `npx tsc --noEmit` (repo root) → zero errors.
- Grep for newly-introduced `any`, `as unknown as T`, `@ts-ignore`, `@ts-expect-error` without justification comment. Flag each.
- Grep for duplicate `import` lines in changed files.

### 7. TanStack Query + Zustand Sync Audit
- For every new `useMutation`: confirm `onSettled` calls `queryClient.invalidateQueries` with all affected keys (list detail, paginated list, aggregate count — triple check).
- For every new Zustand mutator: confirm the store setter is called after server success (not only after optimistic update).
- For every new persisted Zustand store slice: confirm it's registered with either (a) `storageHelpers` for imperative reads/writes OR (b) the `asyncStorage` export from `src/services/storage/` for the Zustand `persist` middleware adapter. Both are valid per the codebase's actual pattern. A raw `mmkv.*` or `AsyncStorage.*` call outside `src/services/storage/` IS a violation.
- Flag WARNING only if a NEWLY-ADDED Zustand store stores server-fetched data with a key that ALSO appears in `queryClient.invalidateQueries([...])` in a sibling file (that's the true anti-pattern: two sources of truth). Do NOT flag pre-existing stores (`maintenanceSuggestionsStore`, `messageStore`, `projectStore`, `reportStore`) that this change doesn't touch — they are legitimate optimistic-update fan-out buckets, not anti-patterns.

### 8. Worker Route Wiring + Auth Audit
- Every new route file in `backend/src/routes/` mounts `authMiddleware()` at file top via `.use('/*', authMiddleware())`.
- Every new household-scoped handler calls the household-membership check. Dominant codebase pattern: `householdService.getHousehold(hid, userId)` (throws on non-member) — present across action-item-service, checklist-service, garbage-collection-service, and others. Alternative: `HouseholdService.verifyAccess(householdId, userId)` at `backend/src/services/household-service.ts:679`. Grep for BOTH (`verifyAccess\|getHousehold`) when auditing; either satisfies the check.
- Every new hot-path route (POST/PUT/DELETE, LLM calls, tool execution) attaches rate-limit middleware.
- Every new route is mounted in `backend/src/index.ts` via `app.route('/prefix', routerFile)`.
- Every new Zod schema on request + declared response shape.

### 9. SSE Close-and-Reconnect + DO Rehydration Audit
If the plan introduces an **SSE endpoint OR a HIGH_WRITE approval flow**:
- Confirm the stream closes (not kept open with keepalive) when awaiting user action that can exceed Workers CPU budget.
- Confirm resumption uses a stable `X-Idempotency-Key` + DO `idFromName(\`\${userId}:\${householdId}\`)`.
- Confirm Vitest test covers the resume path (close → reopen → assert message continues).

If the plan introduces a **Durable Object (regardless of streaming)**:
- Confirm DO authoritative state is persisted to D1 (or `state.storage`) in `blockConcurrencyWhile`-guarded rehydration on cold start (NOT only in in-memory class fields, which are lost on hibernation).
- Confirm a hibernation-survival Vitest test: DO receives a state-mutating message, then a cold DO instance (new isolate) receives a query and returns the same state.
- DOs without a streaming interface (e.g. a rate-limit DO, job-orchestration DO) only need hibernation-survival — the close-and-reconnect test is N/A.

### 10. Worker Request/Response Realism Audit
For every changed or new Vitest fixture for a Worker handler:
- `Authorization: Bearer <realistic token>` header (not empty, not `'TOKEN'`).
- Realistic `householdId` URL param (uuid-shaped).
- Request body passes the route's Zod schema (not `{}`, not `{key:'value'}`).
- Response shape matches the declared Zod response schema.

### 11. Test Dependency Gate
Before running tests (or writing test-run instructions in the developer checklist):
- `cd backend && npm install` (for Worker Vitest) — flag if omitted.
- `npm install` (repo root, for RN Jest) — flag if omitted.
- If a new RN native dep was added: `npx expo prebuild --clean` → rebuild dev client. Flag if omitted.
- If any dep was added to a phase task but missing from `package.json`: flag as CRITICAL.

### 12. WebView Sandbox Config Audit
If the plan introduces `react-native-webview`:
- `originWhitelist={['about:blank']}` (or equivalent narrow list) present.
- `javaScriptEnabled={true}` only if explicitly required for bundled (not CDN) JS.
- `onShouldStartLoadWithRequest` returns `false` for any non-whitelisted URL.
- `setSupportMultipleWindows={false}`.
- `mixedContentMode='never'` (Android).
- CSP injected **server-side** before HTML reaches the WebView.
- JWT / refresh token NEVER exposed to `window` in the WebView (check `injectedJavaScript`).

### 13. Expo Prebuild Trigger Audit
If `package.json` added any dep with native code (RN native modules — grep for `react-native-*` dep names added this phase):
- Developer checklist includes `npx expo prebuild --clean`.
- `ios/Podfile.lock` is flagged to change on next build.
- No Expo-Go-only imports remain if target is dev-client.

### 14. Tool-Registry Parity Audit
For AI/tool-based features:
- Every FE navigation entry or tool-menu item has a matching BE tool registered in the tool registry.
- Every BE mutating tool has a user-confirmation UX on the FE side (HIGH_WRITE approval modal or equivalent).
- No orphan tools on either side.

### 15. Idempotency Key + Dedup TTL Audit
For every mutating endpoint added:
- `X-Idempotency-Key` header is consumed.
- Dedup store (KV or D1) with an explicit TTL (default 24h).
- Replay returns cached response without re-executing the write.
- Vitest covers the replay path.

### 16. `anthropic-beta` Header + Cache-Control Audit
If `backend/src/ai/claude-provider.ts` or any Claude streaming path was touched:
- `anthropic-beta` header value is **reviewed against current Anthropic guidance** — flag for human verification, not auto-reject. `prompt-caching-2024-07-31` went GA in late 2024 and is typically not required, but Anthropic guidance evolves; the skill should flag `prompt-caching-*` headers as "CHECK CURRENT DOCS", not hard-reject. `extended-cache-ttl-*` IS required for 1h TTL (keep).
- `cache_control` breakpoints total ≤ 4 across `system + tools + messages` (Anthropic API hard limit — CRITICAL if exceeded).
- Cache blocks placed on the LAST block of each cacheable segment, not sprinkled.
- If the plan expects 1h TTL: `{"ttl": 3600}` (or the provider's equivalent) is explicit on the cache block.
- Tool definition date-suffix (`_YYYYMMDD`) consistent across the whole `tools: []` array.
- For Claude tool registries: lookup path is inline `tools: []` in the `claude-provider.ts` call site (not a central registry file). For Gemini tool registries: `backend/src/services/ai/tools/index.ts` (`FunctionDeclaration[]`). Do not cross-apply.

---

## Fix Any Failures Immediately

If the verification pass finds any failure — fix it directly (Edit tool), do not report and wait. After fixing, re-run the relevant acceptance check to confirm it passes. This discipline is non-negotiable; agent-handoff latency on a failed verification destroys the flow.

---

## Developer Action Checklist

After all code is done, output a **Developer Must Do** section:

```
## Developer Must Do (code cannot handle these)

### Cloudflare (backend)
- [ ] **PRE-FLIGHT:** grep `backend/wrangler.toml` for `[env.dev-preview]`. If absent AND the plan needs a DO-enabled test env, instruct the developer to either (a) add the `[env.dev-preview]` block (copy from `[env.staging]`, adjust DB/KV/R2 IDs) OR (b) skip dev-preview and promote directly staging → production, accepting the known DO-staging-broken risk. Without this pre-flight, the first `--env dev-preview` command will fail `No environment found for dev-preview`.
- [ ] `wrangler secret put <NAME> --env <env>` for every new secret [list them]
- [ ] `wrangler kv key put --binding=CONFIG_KV <key> <value> --env <env>` for every feature-flag seed [list them]
- [ ] `wrangler d1 migrations apply <DB> --env <env>` — ordered: dev-preview (if present) → staging → production
- [ ] If new DO class: confirm `[[migrations]]` block in `backend/wrangler.toml` with `tag = "vN"`, `new_classes = [...]`, and new binding present in every env block present (staging + production, plus dev-preview if defined)
- [ ] If new KV/R2/Queue: confirm binding matrix across every env block present
- [ ] `wrangler deploy --env <env>` — dev-preview (if present) → staging → production

### React Native / Expo
- [ ] `npm install` at repo root (+ any new dep install verified)
- [ ] If new native RN dep added: `npx expo prebuild --clean` → commit `ios/Podfile.lock` + `android/build.gradle` changes
- [ ] `eas build --profile {development|preview|production} --platform ios` + submit to TestFlight
- [ ] App Review submission (production only)

### Backend tests
- [ ] `cd backend && npm install && npx vitest run` — zero failures
- [ ] Confirm any TRD error code has an explicit assertion

### Frontend tests
- [ ] `npm install && npx jest` — zero failures
- [ ] `npx tsc --noEmit` at repo root AND in `backend/` — zero errors

### Manual smokes
- [ ] [list each AC smoke test from the plan's §11 Definition of Done]
- [ ] [list each open Q-xx / decision-ID verification]
```

---

## Final Status Report

```
=== IMPLEMENTATION COMPLETE ===

Files changed: [list with brief description]

Acceptance Criteria:                          [N/M passed]
"Do NOT" violations:                          [0 / list any found+fixed]
Caller map guards:                            [confirmed / list any added]
Plan notes honored:                           [N/N]
Produces/Consumes topo check:                 [OK / list forward refs fixed]
Migration slot:                               [NNNN_*.sql, forward+reverse present]
TypeScript strict:                            [both tsc --noEmit clean]
TanStack/Zustand sync:                        [invalidation maps complete; no server-data-in-Zustand]
Worker route auth + household scoping:        [every new route OK]
SSE close-and-reconnect / DO rehydration:     [present / N/A]
Worker Vitest fixtures realism:               [OK]
Test dependency gate:                         [install commands present]
WebView sandbox:                              [present / N/A]
Expo prebuild trigger:                        [present / N/A]
Tool-registry parity:                         [OK / N/A]
Idempotency-key dedup:                        [present / N/A]
anthropic-beta + cache_control:               [OK / N/A]

Developer blockers remaining:
- [list]
```

---

## Hard Rules (always enforce)

- NEVER run `wrangler deploy`, `wrangler d1 migrations apply`, `wrangler secret put`, `wrangler kv key put`, `eas build`, `eas submit`, or `npx expo prebuild`. These are developer-only gates.
- NEVER edit `node_modules/`, `ios/Pods/`, `android/build/`, `.expo/`, `vendor/`, or auto-generated files.
- NEVER import `aws-sdk`, `@aws-sdk/*`, `amplify`, `@aws-amplify/*`, or any Swift file.
- NEVER bypass `authMiddleware()` on household-scoped routes.
- NEVER skip household-membership verification inside tool executors.
- NEVER use raw SQL outside `backend/migrations/`.
- NEVER use `process.env.*` directly — access via typed `Env`.
- NEVER call MMKV directly — use `storageHelpers`.
- NEVER use `SecureStore` for non-secrets.
- NEVER add `any` / `as unknown as` / `@ts-ignore` / `@ts-expect-error` without a justification comment.
- NEVER hard-code URLs — gate via `src/config/env.ts`'s `__DEV__` pattern.
- NEVER log JWTs, refresh tokens, raw emails, or household addresses.
- NEVER mirror server-fetched data inside a Zustand store (server truth lives in TanStack cache).
- Every shared method / store action / API client receiving a new side effect MUST have its caller map analyzed before agents write code.
- Every plan ⚠️ / CRITICAL / IMPORTANT / Note MUST be explicitly verified post-implementation.
- The session-rehydration path (`authStore.hydrate()` on cold start; 401-refresh in `src/api/client.ts`) MUST be checked when wiring analytics / login-state side effects.
- If a plan says "Do NOT add a call site at line X" — grep to confirm no call site was added there.
- Every new Worker secret MUST be added via `wrangler secret put` in the developer checklist (never committed).
- Every new DO class MUST have a `[[migrations]]` block + binding entry in `wrangler.toml` for staging, production, and dev-preview (if present).
- Every new RN native dep MUST trigger `npx expo prebuild --clean` + dev-client rebuild in the developer checklist.
- Worker error-code contracts MUST include explicit per-code Vitest assertions (no implied coverage).
- SSE endpoints MUST document close-and-reconnect + DO-rehydration strategy (never hold SSE open across user-action waits that can exceed Workers CPU budget).
- Migrations MUST be forward + reverse (or explicit N/A with rationale).
- Mutating endpoints MUST consume `X-Idempotency-Key` with dedup store + TTL.
- `anthropic-beta` headers MUST be groomed — remove dead betas, keep currently-required ones.
- `cache_control` breakpoints MUST total ≤ 4 across `system + tools + messages`.

---

## Revision Log

- **v 1 — 2026-04-22** — full retailor from Step iOS to SimpleHouse via fix-skill cycle.
  Triggering gap: skill was authored for Step iOS (Swift + Amplify + Cognito + Lambda + DynamoDB) and checked into SimpleHouse as-is, with every Hard Rule, Phase Grouping row, Agent Prompt field, Verification-Pass section (1–11), and Developer Checklist entry referencing infrastructure that does not exist in SimpleHouse (React Native + Expo + Cloudflare Workers + Hono + D1 + Drizzle + JWT).
  Artifact: none — skill never executed against SimpleHouse (DRIFT found by static read + sibling `create-implementation-plan.md` v1.1 retailoring serving as reference pattern).
  MAST code: FM-1.2 (Disobey role spec — skill was playing "orchestrator for Step iOS") + FM-3.3 (Incorrect verification — Verification Pass sections 5–11 would pass files that violate SimpleHouse invariants).
  Classification: DRIFT (dominant) + ABSENCE (no SimpleHouse-specific patterns present).
  Regression replay: YES — the retailored skill references only tooling that exists in SimpleHouse (grep-verified: `backend/migrations/`, `backend/wrangler.toml`, `backend/src/middleware/auth.ts`, `src/config/env.ts`, `src/stores/authStore.ts`, `backend/vitest.config.ts`, `eas.json`).

  Retained (Chesterton-preserved, retailored bodies):
  - Caller-map concept (lines 11, 46–53 in prior version) — highest-leverage idea in the skill; retained with TS/Zustand/TanStack-flavored examples.
  - "Fix Any Failures Immediately" discipline (prior line 152).
  - Parallel-agent launch rule (prior line 80).
  - Verification §§1–4 (AC Sweep / Do-NOT Audit / Caller Map Audit / Plan Notes Audit).
  - Developer Action Checklist frame (Console / CLI / Build-&-Verify structure).
  - Final Status Report frame.
  - Error-code-matrix invariant (generalized from Lambda to Worker).
  - Fan-out / concurrent-writer invariant (generalized from `Promise.all` MODULES to DO-based tool executors + SSE resume).
  - Fixture-realism invariant (generalized from `event.json` to Vitest Worker request fixtures).
  - Staging-files boundary (generalized from `amplify add function` to `wrangler secret put` / `wrangler kv put` / migration slots).

  Replaced (full bodies, not just labels):
  - Phase Grouping table: `{CloudFormation, Swift iOS, Lambda JS}` → `{Worker BE, RN FE, Shared+Tests}` with optional rare-case `Lambda processor` row for `backend/lambda-processor/`.
  - HARD RULES: 6 Step-era bans removed; 14 SimpleHouse invariants added (auth middleware, household scoping, no aws-sdk/amplify, Drizzle-only, typed Env, storageHelpers, no SecureStore for non-secrets, no `any`, JWT-safe logs, `datetime('now')`).
  - Verification §§5–11 replaced: Migration Slot Check, TypeScript Strict, TanStack/Zustand Sync, Worker Route Auth, SSE/DO rehydration, Worker Fixture Realism, Test Dependency Gate.
  - Added §§12–16: WebView Sandbox, Expo Prebuild Trigger, Tool-Registry Parity, Idempotency Key + TTL, `anthropic-beta` + Cache-Control.
  - Developer Checklist: AWS Console/Amplify CLI/Xcode → Cloudflare (wrangler) + Expo/EAS + tsc/vitest/jest.
  - Final Status Report: replaced Lambda-specific bullets with Worker+RN+SSE+DO+WebView+Anthropic-specific bullets.

  Over-fit risk (cycle-1): MEDIUM.
  Cycle-1 reviewers: A WARNING (§16 too-aggressive on `prompt-caching-2024-07-31`, §8 helper-name grep incomplete, Setup step 2 `Produces:`/`Consumes:` claim unenforced against v1.0/v1.1 plans). B MOSTLY ALIGNED (§12 WebView partial duplicate with create-implementation-plan, §14 + §16 would benefit from plan-layer mirroring). C MEDIUM over-fit (§7 Zustand grep false-positives on existing stores, storageHelpers-only under-specified, DO-implies-SSE over-generalization, dev-preview pre-flight gap, ts-morph availability unspecified, Claude tool lookup path undefined).
  Cycle-2 follow-ups applied:
  - §7 TanStack/Zustand narrowed: flag only NEW stores where server-data key ALSO appears in `invalidateQueries` sibling; existing stores (maintenanceSuggestionsStore, messageStore, projectStore, reportStore) excluded from false-positive grep.
  - storageHelpers rule broadened: both `storageHelpers` (imperative) AND `asyncStorage` (persist middleware) are valid, per the codebase's actual pattern.
  - §8 household-membership check grep expanded: `verifyAccess|getHousehold` (dominant pattern across the codebase uses `getHousehold(hid, userId)` throwing on non-member).
  - §9 DO-implies-SSE split: SSE/HIGH_WRITE plans get close-and-reconnect; pure-durable-state DOs get hibernation-survival only.
  - §16 anthropic-beta softened: `prompt-caching-2024-07-31` flagged for review-against-current-docs, not hard-rejected (matches an approved production plan that retains it).
  - §16 Claude vs Gemini tool lookup path distinguished: Claude tools live inline at call sites in `claude-provider.ts`; Gemini tools live in `backend/src/services/ai/tools/index.ts`.
  - Developer checklist dev-preview pre-flight added: grep `wrangler.toml` for `[env.dev-preview]`; if absent, instruct developer to add the block OR skip dev-preview. Previously would have emitted an invalid `--env dev-preview` command.
  - Setup step 3 ts-morph fallback specified: `npm ls ts-morph` presence check; grep fallback patterns explicit; known-limitation note.
  - Setup step 2 v1.0/v1.1 plan handling: if `Produces:`/`Consumes:` absent, best-effort inference rather than refusal; adds mandatory revision-history verification before agents launch (closes cross-skill ordering gap vs create-implementation-plan).
  - Phase Grouping threshold rule added: single orchestrator for plans < 5 tasks; omit agents with zero tasks in their domain (no empty-prompt hallucination).
  Over-fit risk after cycle 2: LOW-MEDIUM.
  Remaining known limitations (deferred):
  - §12 WebView mixedContentMode + no-JWT-via-injectedJavaScript not yet mirrored into create-implementation-plan (cross-skill consolidation — separate fix-skill cycle).
  - §14 Tool-Registry Parity not yet mirrored into create-implementation-plan at plan-authoring layer.
  - §16 anthropic-beta hygiene not yet mirrored into create-implementation-plan Agent A §6.
  - Python Lambda (`backend/lambda-processor/`) HARD RULES carve-out still incomplete: global HARD RULES ban `aws-sdk`, which would conflict with a Python Lambda needing boto3. Separate fix-skill cycle when the first plan touches that folder.
  - Claude tool registry parity check (§14) is Gemini-biased; Claude inline-tool plans need a refined lookup rule (partially addressed in §16 but not fully in §14).
  Ledger: `.claude/retrospectives/implement-plan_lessons.md#2026-04-22`.
