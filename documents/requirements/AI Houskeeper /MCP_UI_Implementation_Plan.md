# Implementation Plan — Assistant Home & MCP-for-UI (v 1.3)

**Version:** 1.3
**Date:** 2026-04-22
**Status:** Planned
**Area:** FE + BE
**Priority:** P1
**Source TRD:** [MCP_UI_TRD.md](MCP_UI_TRD.md) (v1.3)
**Source Prior Art:** [architecture-and-implementation-plan-v1.0.md](architecture-and-implementation-plan-v1.0.md)
**Author:** a.tekhtelev@gmail.com

---

## § 0.0 — Revision History (v1.2 → v1.3)

This pass resolves the remaining critical/high findings from the 3-reviewer audit cycle run against v1.2. It also **reverts two v1.2 design changes** that conflicted with the TRD and with explicit product direction.

**REVERTED from v1.2 (restore TRD design):**

1. **Ticket TTL reverted from 10 s back to 30 s.** Task 3.1 `mintTicket` now sets `Date.now() + 30_000`; KV `expirationTtl: 60` (60 s is the KV floor). TRD §8.4 / ADR-3 was the canonical value; v1.2's 10 s reduction was never matched by the TRD. Claim #4 in the v1.1→v1.2 history is **retracted**.
2. **HIGH_WRITE SSE parking reverted to hold-open with 15 s keepalive comments.** Task 6.2 rewritten: on HIGH_WRITE `tool_use`, DO writes `AiToolPending`, emits `tool_call_pending` SSE frame, then **keeps the SSE connection open** and writes `: keepalive\n\n` comments every 15 s. DO sets a 10-minute alarm as the hard timeout; if the alarm fires first, DO emits `{type:'error', code:'approval_timeout'}` and closes. On `POST /ai-chat/tool-result`, the same DO resumes the Claude tool-loop on the same open SSE connection. This matches TRD §6.2 / §8.4 and eliminates the reconnect-race class of bugs. Workers 30 s CPU budget is respected because the DO is idle (no CPU) while waiting on the alarm — keepalive writes are negligible. Claim #2 in the v1.1→v1.2 history is **retracted**.

**CRITICAL fixes (v1.2 bugs — applied now):**

3. **ANTHROPIC_API_KEY marked required, not "optional Phase 8".** Plan §0 pre-flight checklist updated. Claude is v1.0 primary per ADR-1; missing key = deployment blocker.
4. **ChatSessionDO id derivation actually implemented.** v1.2 revision claim #25 promised `env.CHAT_SESSION.idFromName(\`${userId}:${householdId}\`)` but Task 1.3 body still had `const sessionId = this.doState.id.toString()` with a subsequent `WHERE session_id = ?` query that would never match. Now corrected: DO is created via `idFromName` so `doState.id.toString()` equals `${userId}:${householdId}`, and the SQL reads `(user_id, household_id)` as the composite key with `session_id` resolved from the active row.
5. **`ai:prewarm` rate-limit bucket added to Task 3.5** list (1/min/user). Task 3.6 code already declared the limit; the middleware binding was missing.
6. **Undo route standardised to `/ai-chat/tools/:toolCallId/undo`.** Two sites in Phase 6 (§6.2 and Task 6.3 FE snackbar) still used legacy `/ai/chat/...` prefix — corrected.

**HIGH fixes (TRD-completeness):**

7. **Task 2.4 cards response `meta` field documented** (already claimed in v1.2 #22; verified present at Task 2.4).
8. **TRD §8 API contract now documents the undo endpoint** (`POST /ai-chat/tools/:toolCallId/undo`) and **the prewarm endpoint** (`POST /ai-chat/prewarm`) — both previously only in Plan. See TRD v1.3 §8.6 and §8.7.
9. **`ui_block` SSE event type added to TRD §8.4** event enumeration.
10. **`send_contractor_message` tool removed.** Contradicted TRD §2 Non-Goal ("No contractor-to-homeowner chat"). `list_contractor_messages` kept as READ-only (read existing history for context only). HIGH_WRITE drops from 37 → **36**.
10b. **Tool count reconciled to 132 (TRD-canonical).** The Plan's v1.2 breakdown (38+31+37+23 = 129) undercounted the TRD's Housekeeper-persona tools (`get_housekeeper_persona`, `list_housekeeper_personas`, `set_housekeeper_persona`, `open_housekeeper_settings` — TRD §23.1 + §23.12). Real counts after `send_contractor_message` removal: **READ 40 + LOW_WRITE 32 + HIGH_WRITE 36 + NAVIGATION 24 = 132**. All Plan references (§1, §5.1, Phase 6 parity tests) updated.

**Medium fixes:**

11. **Source document links corrected.** TRD and Plan now link relative to `documents/Requirenments/AI Houskeeper /` (the real path) rather than `documents/features/` (which does not exist).
12. **D-10, D-11, D-13 resolved with defensible defaults** (see TRD §16): D-10 allowlist = 20 internal + 1 week soak, D-11 priority-card ordering = overdue > high-severity findings > housekeeper predictions > suggestions, D-13 empty state = "Your home looks good — schedule your seasonal check-up?" with illustration.

**Final tool count:** **132** (READ 40 + LOW_WRITE 32 + HIGH_WRITE 36 + NAVIGATION 24). TRD §23.13 and Plan §1 overview updated.

**No behavioral change to any successful-path SSE event, any D1 schema, or any DO class binding.** Only the HIGH_WRITE parking lifecycle, ticket TTL, one tool removal, and doc hygiene change.

---

## § 0 — Codebase Snapshot Note

Written against the current `main` branch (commit to be filled at implementation start). Every `file:line` reference is a snapshot — re-grep before starting each phase. Claims not verified against live code are marked `⚠️ Unverified`.

**Environments (`backend/wrangler.toml`):** top-level (local default), `staging` (DO-blocked today), `production`. A new `dev-preview` environment will be added in Phase 0 to work around the staging DO block. **There is no `[env.dev]` block** — local dev uses the top-level config.

**Migrations path:** `backend/migrations/` (confirmed via `wrangler.toml` `migrations_dir = "migrations"`). Last migration at review time: `0033_maintenance_subtasks.sql` — next available is `0034_`.

## § 0.2 — Revision History (v1.1 → v1.2, 26 corrections from user cross-read)

This block is the authoritative changelog. Individual task bodies + the TRD have been edited to match.

**CRITICAL (would have blocked implementation):**

1. **Provider narrative fully committed to Claude.** Plan §1, §2 ADR-1 row, §5.2 diagram, TRD §5.1 diagram, TRD §6.2 step 10 (`gemini.chat.sendMessageStream` → `claudeChatService.streamChat`), TRD §2 Non-Goals all now state Claude `claude-sonnet-4-5-20250929`. Gemini is explicitly legacy-only (existing `/chat` RAG + contractor search + floor-plan analysis).
2. ~~**SSE HIGH_WRITE parking resolved to close-and-reconnect.** Task 6.2 rewritten: on `tool_use` HIGH_WRITE, DO writes `AiToolPending`, emits `tool_call_pending` SSE, **closes the stream**. Client awaits decision, calls `POST /ai-chat/tool-result`, server replies 202, client **reopens SSE** with the same `X-Idempotency-Key`. DO rehydrates from D1 and resumes the Claude tool-loop with the persisted `tool_use.id` + user-approved result. Eliminates the Workers 30-s CPU overrun AND the hibernation risk. G22 closed.~~ **[RETRACTED in v1.3 — reverted to TRD's hold-open-with-keepalive design. See §0.0 and §6.2 / §8.4 in TRD v1.3.]**
3. **Killswitch fails CLOSED.** Task 0.2 `isAiChatEnabled` wraps the killswitch KV read in a dedicated try/catch; on KV unreachable, returns `{enabled:false, reason:'kv_unreachable'}`. Generic `getFlag` fallback semantics are unchanged for non-killswitch flags.
4. **v1.1 claimed-but-missing fixes applied for real:**
   - Task 3.1 `mintTicket` carries JWT `jti`; `consumeTicket` validates `jti` is not revoked (no-op if no `auth_sessions` revocation store exists).
   - ~~Ticket TTL = **10 s** (`Date.now() + 10_000`, `expirationTtl: 30`).~~ **[RETRACTED in v1.3 — reverted to 30 s per TRD §8.4 / ADR-3. See §0.0.]**
   - §5.1 Affected Files: `backend/migrations/0034_ai_chat.sql` (the last remaining `backend/database/...` site).
5. **TRD §10 migration path corrected** to `backend/migrations/0034_ai_chat.sql`.
6. **DOMPurify-on-Workers is a hard Phase 7 prerequisite** (new Task 7.0). Must pass before Task 7.1 code lands. Fallback tree: regex sanitizer → Worker Service Binding to Node.js container → drop HTML dashboard from v1.0. G19 now referenced from Task 7.0.
7. **CSP tightened.** Removed `'unsafe-inline'` from `script-src` (nonce suffices on modern WKWebView + Android WebView ≥104). `style-src 'unsafe-inline'` retained for Chart.js inline styles with documented rationale.

**MAJOR alignment fixes:**

8. **Tool count unified to 129** (Plan §1, §5.1, TRD §23.13). Math: READ 38 + LOW_WRITE 31 + HIGH_WRITE 37 + NAVIGATION 23 after adding the 6 floor-plan + 3 seasonal-checklist tools below.
9. **Phase numbering unified** across both docs: P0 Infra, P1 Schema+DO+Registry, P2 Read tools + cards + sessions-CRUD, P3 Claude SSE + modes, P4 FE transport + chat + uiStore, P5 Assistant Home + upload, P6 Mutating tools + approval + parity, P7 HTML dashboard (with Task 7.0 POC gate), P8 Rollout. TRD §12.2 rewritten.
10. **HTML dashboard locked to Phase 7** across TRD (§3.1 G-2, §22.1 MiniDashboardCard, §5.2 ADR-6, §17 D-08 all corrected).
11. **Endpoint paths standardised to `/ai-chat/*` in TRD** (§8.4, §8.5, §9). Legacy `/ai/*` returns 410 (Plan Task 2.7).
12. **Flag name unified: `ai_chat_html_enabled`** (was `ai_assistant_home_html_enabled` in TRD §3.1 G-2).
13. **Allowlist default unified.** TRD §12.1: key UNSET / `null` = "allow everyone" (post-rollout); present array = strict mode, `[]` = deny-all. Task 0.3 seed leaves the key unset. Killswitch default stays `{killed:true,reason:"not_rolled_out"}` so an unset allowlist does not accidentally release the feature.
14. **Single-model v1.0 committed.** Task 3.6 prewarm response: `model:'claude-sonnet-4-5-20250929'`. Analytics `model` prop string-typed. ADR-18 tiered routing reframed as Phase 8 only.
15. **Claude model ID aspirational tiers flagged.** ADR-1 in TRD marks Haiku 4.5 / Opus 4.7 as "aspirational, gated on Anthropic family-ID verification before Phase 8 kicks off."
16. **TRD §6.2 step 10 + §5.1 architecture diagram** rewritten to reference `claudeChatService.streamChat` + `claude-provider.ts` as primary.
17. **D-04 PLAN, D-13 RESOLVED** in both docs (status was inconsistent).

**Implementation-gap fixes (tasks added/amended):**

18. **Session CRUD task added as Task 2.8.** Covers POST/GET/PATCH/DELETE for `/households/:hid/ai-chat/sessions/...` per TRD §8.3.
19. **`origin:'ai_chat'` propagation expanded** to 18 services in Task 6.5: `appointment`, `maintenance`, `notification`, `budget`, `quotes`, `projects`, `ratings`, `housekeeper`, `contractor-search`, `contractors`, `garbage`, `appliances`, `utilities`, `home-features`, `spaces`, `visit-checklists`, `seasonal-checklists`, `task-drafts`.
20. **`src/stores/uiStore.ts` moved to Phase 4 Task 4.3** (consumed by Task 4.7 `PdfCitationChip`). Phase 5 extends it with upload-progress state.
21. **`@gorhom/bottom-sheet` added to Task 4.1 npm install list.**
22. **Cards `meta` field concretised** in Task 2.4: `meta:{reports_count, floor_plans_count, has_ever_uploaded_report}`.
23. **`api.get<T>` helper task added as Task 4.0.** `src/api/client.ts` grows a typed `api` export that unwraps `ApiResponse<T>` automatically.
24. **NAVIGATION → `navigation_hint` SSE translation spec added to Task 3.4.** DO translates NAVIGATION tools' `{dispatched:true,action,params}` result into a single `navigation_hint` SSE frame and feeds `{dispatched:true}` back to Claude as the `tool_result`; the turn ends after a brief closing sentence from the model.
25. **`ChatSessionDO` id derivation specified.** Task 1.3 + Task 3.1 use `env.CHAT_SESSION.idFromName(\`${userId}:${householdId}\`)` — string-derived id guarantees I-7's singleton.
26. **Per-household daily token ceiling promoted to v1.0** (`CONFIG_KV.ai_chat_household_budget_daily = 1500000` default). Enforcement in Task 3.2 pre-flight + rate-limit middleware. G17 closed.

**Hygiene fixes:**

- **`wrangler deploy --env dev-preview` → `--env dev-preview`** everywhere.
- **Tool Parity Test finalised** (Task 6.6): build-time check + excluded prefix allowlist (`/health`, `/webhooks/*`, `/admin/*`, `/auth/*`, `/dev/*`); WARNING for 4 weeks post-launch, then hard failure. §0.1 vs Task 6.6 no longer conflict.
- **4-cache-breakpoint pre-flight guard added** to `streamClaudeChat` (Task 3.2).
- **Idempotency scope clarified.** Server-minted UUID is globally unique; D1 row also stores `(user_id, tool_name)` for audit. SQL `UNIQUE(key)` stays correct. TRD I-3 relaxed wording.
- **`anthropic-beta: prompt-caching-2024-07-31` header removed** from Task 0.6 (prompt caching is GA; extended-cache-ttl beta retained for 1 h TTL).
- **Floor-plan management tools added** to TRD §23.9: `list_floor_plans`, `get_floor_plan`, `delete_floor_plan`, `list_floor_plan_markers`, `add_floor_plan_marker`, `delete_floor_plan_marker`.
- **Seasonal checklist mutator tools added**: `reset_seasonal_checklist`, `skip_checklist_item`, `uncomplete_checklist_item`.

**New Known Gaps (non-blocking for v1.2 approval):**

- **G23** — verify `HouseholdService.verifyAccess(householdId, userId)` signature + `VoiceRecordingService` actual upload response shape against current code before Phase 2 Task 2.5 + Phase 5 Task 5.3.
- **G24** — log-scan helper script + runbook entry for "JWT leak incident" (referenced in Plan §6.5 + §10.5; no task creates the script yet). Owner: ops; Phase 8.

Not applied (rationale):

- **Drizzle mixed styles** — `drizzle()` for queries, raw `env.DB.prepare` for DDL + bulk deletes. Kept intentionally; project-wide convention.
- **`payload.sub` log retention** — auth success log is 1/req and only a UUID; GDPR review deferred to v1.1 unless DPO flags.
- **Empty folder cleanup** — `src/components/ai-assistant/` deleted in Task 4.1 prebuild hygiene.

## § 0.1 — Revision History (v1.0 → v1.1 fixes from parallel 3-reviewer cycle)

Applied corrections from the v1.0 review:
- **Migration path** fixed from `backend/migrations/` to `backend/migrations/` (~6 sites).
- **Migration number** pinned to `0034_ai_chat.sql`.
- **Route base** standardised on `/ai-chat/*` (ticket, stream, tool-result, prewarm) — eliminates the `/ai/chat/*` vs `/ai-chat/*` contradiction. Legacy `backend/src/routes/ai.ts` still returns 410 (Task 2.7 unchanged).
- **Claude SDK upgrade step** added to Phase 0 (`@anthropic-ai/sdk ≥0.40` required for `cache_control.ttl` and typed `cache_read_input_tokens`). See updated Task 0.6.
- **Claude model IDs** corrected to currently-available `claude-sonnet-4-5-20250929` (already used in `backend/src/ai/claude-provider.ts:44`) as v1.0 baseline. Haiku/Opus tier routing is a Phase 8 optimisation once those family IDs are confirmed for the Anthropic account.
- **`VoiceRecordingService`** (static class) replaces the lowercase `voiceRecordingService` throughout.
- **`HouseholdService.verifyAccess(householdId, userId)`** replaces the non-existent `HouseholdService.verifyAccess`.
- **`backend/src/ai/gemini-provider.ts`** (not `gemini-service.ts`) is the target for the `BLOCK_NONE` → `BLOCK_LOW_AND_ABOVE` safety fix.
- **`datetime('now')`** replaces `strftime('%Y-%m-%dT%H:%M:%fZ','now')` across all SQL (project convention; TRD §10 also corrected).
- **`maintenanceTasks.completed_at` → `is_active` + join to `maintenanceCompletions`** in the overdue-tasks tool. Corrected Task 2.1.
- **Allowlist semantics:** a `null` or missing `ai_chat_user_allowlist` means "allow everyone"; a present empty array `[]` means "deny everyone". Task 0.2 code adjusted; Task 0.3 seed defaults to `null`.
- **`ChatSessionDO` rehydrates state from D1 in `blockConcurrencyWhile`** on cold-start. New Task 1.3.a.
- **SSE parking closes the connection after HIGH_WRITE emit**; client reconnects on approval via same-idempotency-key replay. Task 3.1 + Task 6.2 revised.
- **Prewarm rate-limit** dropped to 1/min/user and deducts from daily token budget. Task 3.6 revised.
- **TanStack Query `placeholderData`** switched to a synchronous MMKV read helper. Task 5.2 revised.
- **`api.get<T>(...)`** helper replaces raw `apiClient.get<ApiResponse<T>>`. Task 5.1 revised.
- **Ticket binds to JWT `jti`** + ticket TTL reduced to 10s. Task 3.1 revised.
- **Per-tool context allowlist table** concretised in Task 3.3.
- **Tool-parity CI** downgraded to warning-only for 4 weeks + route-prefix allowlist; see Task 6.6 revised.
- **v1.1 also removes** the stale `src/App.tsx` modify step from Task 5.6 (dead code per G14) and fixes TRD §2 Non-Goals (dropped the "No Claude in v1.0" line that contradicted ADR-1).

Outstanding CRITICAL items deferred to the next cycle:
- DOMPurify-on-Workers POC with nonce preservation (R5 in cycle) — must complete before Phase 7 code lands.
- Worker `limits.cpu_ms = 300000` (Workers Paid required) — operator decision, added to Pre-Impl §3.
- Haiku-specific prompt-injection resistance testing — Phase 8 work; Haiku not routed in v1.0 baseline.
- `X-Tools-Version: v0` back-compat branch — v1.0 ships with v1 only; v0 migration not applicable.
- Per-household budget ceiling (suggestion S4) — added to Known Gaps as G17.



**North-star:** every manual user action has a matching tool in the registry (TRD §23). Implementation Plan §6 includes a Tool Parity Test that fails CI if any domain-write route is missing a tool reference.

---

## § 1 — Overview

**Goal.** Ship the Assistant Home surface (voice-first main screen with eager-loaded actionable cards) + a typed tool-calling chat runtime across all five modes. The AI must be able to do anything the user can do manually (132 tools in v1.0, TRD §23).

**Sources.** TRD v1.1 governs contract; this document governs execution.

**Scope.**
- Backend: new `ai-chat` + `ai-home` route group, new ToolRegistry (132 tools), new mode registry, streaming SSE via Hono helper, `ChatSessionDO`, DOMPurify sanitizer (Phase 7), six new D1 tables, `CONFIG_KV` flag helpers, rate-limit extensions.
- Frontend: new `AssistantHomeScreen` + `AssistantChatScreen`, `chatStore` (zustand + immer + MMKV), `useAssistantHomeCards` hook, `react-native-sse` + `react-native-webview` (Phase 7) + `react-native-markdown-display`, per-tool card actions, voice-button input reusing `voiceRecordingService`.
- Ops: `simple-house-api-dev-preview` Worker, `CONFIG_KV` flag seed, allowlisted rollout.

**Phase count.** 8 phases (P0–P7) in v1.0 + P8 (post-v1.0) Claude migration.

**Total estimated files:**
- Backend: ~60 new files + 12 modified.
- Frontend: ~35 new files + 10 modified.

**Key invariants locked by TRD:**
- Primary provider is Claude `claude-sonnet-4-5-20250929` via the Anthropic SDK (already installed). Gemini remains only for the legacy `/chat` RAG, contractor search, and existing floor-plan analysis — **not** on the new Assistant Home / AI Chat streaming pipeline.
- `householdId` is *never* a tool argument — rebound server-side from JWT + session ownership.
- Every HIGH_WRITE tool requires user confirmation; prompt injection via uploaded PDFs is a realized threat.
- Tiered model routing (Haiku 4.5 / Opus 4.7) is Phase 8 only; v1.0 is single-model Sonnet 4.5.

---

## § 2 — Architecture Decisions (ADR Summary)

Expanded from TRD §5.2. Each ADR is referenced below by its Phase + Task that implements it.

| # | Decision | Chosen | Alternative | Reason | Implemented in |
|---|---|---|---|---|---|
| 1 | LLM provider v1.0 | Claude `claude-sonnet-4-5-20250929` via `@anthropic-ai/sdk ≥0.40` with 4-breakpoint prompt caching (1 h TTL on static prefix) | Gemini 2.0 Flash | Claude has native parallel tool-use, best-in-class cache economics (90% cost / 85% latency reduction), and already installed. Gemini stays on legacy paths only. | P3 Task 3.2 |
| 2 | SSE client on RN | `react-native-sse` | fetch-based `ReadableStream` | RN EventSource can't set headers; fetch-stream on RN is fragile | P4 Task 4.1 |
| 3 | SSE auth | 30 s single-use ticket | JWT in query | JWT in URL leaks into `wrangler tail` | P3 Task 3.1 |
| 4 | Tool approval | Confirm HIGH_WRITE / auto+Undo LOW_WRITE / auto READ | Always / never | Prompt-injection threat; UX balance | P6 all tasks |
| 5 | HTML sanitize | Server DOMPurify | Client | Trust boundary is the Worker | P7 Task 7.3 |
| 6 | Chart.js (Phase 7) | Bundled as string asset | CDN | Prevents egress channel | P7 Task 7.4 |
| 7 | Session state | `ChatSessionDO` keyed by `user_id:household_id` | stateless | Resume, kill-switch poll, single-in-flight | P1 Task 1.3 |
| 8 | Kill switch | `CONFIG_KV.ai_chat_killswitch` + 10 s isolate cache | redeploy | <60 s propagation | P0 Task 0.3 |
| 9 | Tool version header | `X-Tools-Version` (2 back-compat) | URL prefix | Avoid path churn | P3 Task 3.1 |
| 10 | Context redaction | `buildContext({ tool, household })` allowlist | `SELECT *` | PII leaks by default | P2 Task 2.6 |
| 11 | Idempotency | client-minted key + 24 h KV cache | best-effort | LLM+network duplication | P1 Task 1.2 |
| 12 | Cards endpoint | single aggregated `GET /ai-home/cards` | multiple parallel fetches | Single auth check; predictable cache | P2 Task 2.7 |
| 13 | Legacy Home | `allow_legacy_home` flag on | delete | Safety net | P5 Task 5.6 |
| 14 | Mode UX | context-driven, no user picker | picker | Reduces cognitive load | P4 Task 4.4 |
| 15 | Staging DO block | parallel `dev-preview` Worker | ship cold to prod | risk control | P0 Task 0.1 |
| 16 | `householdId` arg | never | allowed | IDOR prevention | P1 Task 1.4 |
| 17 | Tool registry source of truth | single `ToolRegistry.buildV1()` + CI parity test | per-file ad-hoc | Enforces completeness | P1 Task 1.5, P6 parity test |

---

## § 3 — Pre-Implementation Checklist

Confirm TRUE before **any** code is written.

- [ ] `git status` clean on `main`.
- [ ] `npx wrangler whoami --config backend/wrangler.toml` returns a user with access to the production account.
- [ ] `node -v` ≥ 20.
- [ ] Backend tests green locally: `cd backend && npm test` → all green.
- [ ] Frontend Jest green: `npm test`.
- [ ] **D-04 (staging DO block) mitigation decided:** proceed with `dev-preview` Worker (Task 0.1).
- [ ] **D-10 (allowlist size):** confirmed 20 internal users × 1 week soak → feed list to `CONFIG_KV.ai_chat_user_allowlist`.
- [ ] **D-11 (priority card order):** confirmed with Product — **overdue maintenance > high-severity findings > AI Housekeeper predictions > suggestions**.
- [ ] **D-13 (empty state copy):** confirmed with Design — `"Your home looks good 🏡"` + nudge `"Want to plan your spring maintenance?"`.
- [ ] **Anthropic / Gemini keys:** `wrangler secret list --env production` shows `GEMINI_API_KEY` (required, legacy `/chat` + contractor search + floor-plan analysis) + `ANTHROPIC_API_KEY` (**required, v1.0** — Claude is primary per ADR-1). Missing `ANTHROPIC_API_KEY` is a deployment blocker; add before Phase 0.
- [ ] **Storage approved:** D1 capacity for 6 new tables verified; no migration conflict with in-flight branches (`ls backend/migrations/`).
- [ ] **Product sign-off on `allow_legacy_home` default** (`true` in v1.0).
- [ ] **Security sign-off** scheduled for Phase 7 (Dashboard HTML) — must complete before enabling `ai_chat_html_enabled`.

---

## § 4 — Implementation Phases

### Phase 0 — Infrastructure, Flags, Staging Mitigation (Critical; BE-only)

**Goal.** Ship the safety-net plumbing (kill switch, feature flags, preview Worker) before any feature code runs.
**Pre-condition.** Pre-Implementation Checklist complete.
**Blocks.** All other phases.
**Deploy after this phase.** `wrangler deploy --env dev-preview` + `wrangler deploy --env production` for flag helpers (no user-visible change yet).

#### Task 0.1 — Stand up `simple-house-api-dev-preview` Worker

**Files:** `backend/wrangler.toml` (modify), `backend/scripts/setup-dev-preview.sh` (new)

**Why.** Staging is blocked for DOs ("Cannot use Durable Objects with Preview URLs"). This creates a parallel Worker that mirrors staging config but is published via `wrangler deploy --env dev-preview-preview`, giving TestFlight a DO-enabled test target.

**wrangler.toml addition** (append to existing file, do not touch existing `[env.dev|staging|production]` blocks):

```toml
[env.dev-preview]
name = "simple-house-api-dev-preview"
main = "src/index.ts"
compatibility_date = "2024-12-01"
compatibility_flags = ["nodejs_compat"]
[env.dev-preview.vars]
# mirror [env.staging.vars] values
ENVIRONMENT = "dev-preview"
JWT_ISSUER = "simplehouse-dev-preview"
[[env.dev-preview.d1_databases]]
binding = "DB"
database_name = "simple-house-dev-preview"
database_id = "<fill in after create>"
[[env.dev-preview.r2_buckets]]
binding = "REPORTS_BUCKET"
bucket_name = "simple-house-reports-dev-preview"
[[env.dev-preview.kv_namespaces]]
binding = "CONFIG_KV"
id = "<fill in after create>"
[[env.dev-preview.durable_objects.bindings]]
name = "RATE_LIMITER"
class_name = "RateLimiterDO"
[[env.dev-preview.durable_objects.bindings]]
name = "JOB_MANAGER"
class_name = "JobManagerDO"
```

**Operator steps (manual, one-time):**
```bash
wrangler d1 create simple-house-dev-preview
wrangler r2 bucket create simple-house-reports-dev-preview
wrangler kv namespace create "CONFIG_KV" --env dev-preview
# copy the returned IDs into wrangler.toml above
wrangler d1 migrations apply simple-house-dev-preview --env dev-preview
wrangler secret put GEMINI_API_KEY --env dev-preview
wrangler secret put ANTHROPIC_API_KEY --env dev-preview  # required (Claude primary per ADR-1)
wrangler secret put JWT_SECRET --env dev-preview
wrangler deploy --env dev-preview-preview
```

**Verification.** `curl https://simple-house-api-dev-preview.<subdomain>.workers.dev/health` returns 200.

**Rollback.** Delete `[env.dev-preview]` block from `wrangler.toml`. Worker remains orphaned but idle.

#### Task 0.2 — Add `CONFIG_KV` flag helper

**File:** `backend/src/services/feature-flags.ts` (new)

**New code:**
```ts
import type { Env } from '../types';

type FlagValue = string | number | boolean | Record<string, unknown>;

const ISOLATE_CACHE = new Map<string, { value: FlagValue | null; fetchedAt: number }>();
const ISOLATE_TTL_MS = 10_000;

export async function getFlag<T extends FlagValue = FlagValue>(
  env: Env,
  key: string,
  fallback: T,
): Promise<T> {
  const cached = ISOLATE_CACHE.get(key);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < ISOLATE_TTL_MS) {
    return (cached.value ?? fallback) as T;
  }
  try {
    const raw = await env.CONFIG_KV.get(key);
    if (raw === null) {
      ISOLATE_CACHE.set(key, { value: null, fetchedAt: now });
      return fallback;
    }
    let parsed: FlagValue;
    try { parsed = JSON.parse(raw); } catch { parsed = raw; }
    ISOLATE_CACHE.set(key, { value: parsed, fetchedAt: now });
    return parsed as T;
  } catch {
    return fallback;
  }
}

export async function isAiChatEnabled(env: Env, userId: string): Promise<{ enabled: boolean; reason?: string }> {
  // v1.1: allowlist semantics — `null` / missing key means "allow everyone" (post-rollout state);
  // present array (even `[]`) means "strict allowlist mode" and `[]` denies everyone.
  // Default seed (Task 0.3) writes `null` which keeps production OFF until explicitly opted-in via KV.
  // v1.2: killswitch reads in a dedicated try/catch so a KV outage fails CLOSED for the killswitch specifically,
  // even though getFlag's generic fallback is permissive.
  let killswitchRaw: string | null;
  try { killswitchRaw = await env.CONFIG_KV.get('ai_chat_killswitch'); }
  catch { return { enabled: false, reason: 'kv_unreachable' }; }
  if (killswitchRaw) {
    try {
      const kill = JSON.parse(killswitchRaw) as { killed: boolean; reason?: string; scope?: { userIds?: string[]; households?: string[] } };
      if (kill.killed) {
        const scope = kill.scope;
        if (!scope || (!scope.userIds?.length && !scope.households?.length)) return { enabled: false, reason: kill.reason };
        if (scope.userIds?.includes(userId)) return { enabled: false, reason: kill.reason };
      }
    } catch { return { enabled: false, reason: 'killswitch_malformed' }; }
  }
  const allowlistRaw = await env.CONFIG_KV.get('ai_chat_user_allowlist');
  if (allowlistRaw !== null) {
    let allowlist: string[] = [];
    try { allowlist = JSON.parse(allowlistRaw); } catch {}
    if (!Array.isArray(allowlist) || !allowlist.includes(userId)) {
      return { enabled: false, reason: 'not_on_allowlist' };
    }
  }
  return { enabled: true };
}

export async function isModeEnabled(env: Env, mode: string): Promise<boolean> {
  const v = await getFlag<string | boolean>(env, `ai_mode_${mode}_enabled`, true);
  return v === true || v === 'true';
}

export async function isToolEnabled(env: Env, toolName: string): Promise<boolean> {
  const v = await getFlag<string | boolean>(env, `ai_tool_${toolName}_enabled`, true);
  return v === true || v === 'true';
}

export function resetIsolateCacheForTests() {
  ISOLATE_CACHE.clear();
}
```

**Risk.** Low — additive, no callers yet.

**Verification.** New unit test `backend/src/services/__tests__/feature-flags.test.ts` covering: cache hit, cache miss, KV unreachable (fail-closed for killswitch), allowlist logic.

**Rollback.** Delete file; no existing code depends on it.

#### Task 0.3 — Seed `CONFIG_KV` with v1.0 flag defaults

**Script:** `backend/scripts/seed-ai-chat-flags.sh` (new)

```bash
#!/usr/bin/env bash
set -euo pipefail
ENV=${1:-dev}
wrangler kv key put --binding=CONFIG_KV --env "$ENV" \
  ai_chat_killswitch '{"killed":true,"reason":"not_rolled_out"}'
# v1.1: default killed until Phase 8 rollout. Operator flips to {"killed":false} when launching.
for mode in chat report_qa dashboard onboarding task_assistant; do
  DEFAULT="true"
  [ "$mode" = "dashboard" ] && DEFAULT="false"
  wrangler kv key put --binding=CONFIG_KV --env "$ENV" \
    "ai_mode_${mode}_enabled" "$DEFAULT"
done
wrangler kv key put --binding=CONFIG_KV --env "$ENV" ai_chat_html_enabled false
wrangler kv key put --binding=CONFIG_KV --env "$ENV" ai_chat_streaming_enabled true
wrangler kv key delete --binding=CONFIG_KV --env "$ENV" ai_chat_user_allowlist 2>/dev/null || true
# v1.1: intentionally leave the allowlist key UNSET.
# `null` in KV = strict-allowlist-mode OFF → isAiChatEnabled treats this as "everyone allowed".
# For Phase 8 rollout the operator will `wrangler kv key put ... ai_chat_user_allowlist '["uid1","uid2"]'` to switch to strict mode.
wrangler kv key put --binding=CONFIG_KV --env "$ENV" ai_chat_token_budget_daily 500000
wrangler kv key put --binding=CONFIG_KV --env "$ENV" ai_chat_stream_hourly_cap 20
wrangler kv key put --binding=CONFIG_KV --env "$ENV" assistant_home_enabled false
wrangler kv key put --binding=CONFIG_KV --env "$ENV" allow_legacy_home true
```

**Operator runs:** `./backend/scripts/seed-ai-chat-flags.sh dev-preview && ./backend/scripts/seed-ai-chat-flags.sh production`.

**Verification.** `wrangler kv key list --binding=CONFIG_KV --env production` shows all 10+ keys.

#### Task 0.4 — Operational runbook

**File:** `documents/deployment/ai-chat-runbook.md` (new)

Contents: kill-switch flip command, per-mode disable, per-tool disable, quota reset, token-in-log incident response, ticket-leak response, `wrangler tail --env production --format pretty` filters for `ai_chat_*` events, dashboard URL stubs. One page.

#### Task 0.5 — Remove token-prefix logging in auth middleware

**File:** `backend/src/middleware/auth.ts` (modify)

**Current code (verified lines 37,38,43 — line 55 logs `payload.sub` which is fine to keep):**
```ts
// line 37-38 (verify log on every request):
const tokenPrefix = token.substring(0, 20);
console.log(`[auth] Verifying token for ${path}, token prefix: ${tokenPrefix}...`);

// line 43 (error log):
console.error(`[auth] Token verification failed for ${path}, token prefix: ${tokenPrefix}...`);
```

**New code:** delete lines 37–38 and the `tokenPrefix` interpolation on line 43 (keep the error log without the prefix substring). Line 55 (`console.log('[auth] Token verified successfully for ${path}, user: ${payload.sub}')`) is retained — `payload.sub` is a user ID, not a token fragment.

**Risk.** Low. Observability change only.

**Verification.** `wrangler tail --env dev-preview` shows no `token prefix:` lines.

#### Task 0.6 — Upgrade `@anthropic-ai/sdk` to ≥0.40 (required for Phase 3)

**File:** `backend/package.json` (modify)

**Why.** The installed version (`^0.32.1`) predates typed `cache_read_input_tokens` on `usage` and does not support `cache_control.ttl` (needed for ADR-16's 1-hour static-prefix cache). Without the upgrade, Task 3.2's code will not compile AND the Anthropic API will either ignore `ttl` or reject the request.

**Steps:**
```bash
cd backend
npm install @anthropic-ai/sdk@^0.40
# run both test suites:
npm test
# verify the SDK still compiles claude-provider.ts (no breaking API changes between 0.32 and 0.40 affect the existing code paths for report extraction)
```

Add to `backend/src/ai/claude-provider.ts` at the top, as a one-line comment:
```ts
// NOTE: @anthropic-ai/sdk upgraded to ^0.40 in v1.1 for cache_control.ttl + typed usage fields.
```

**Anthropic beta header.** For `cache_control: { type: 'ephemeral', ttl: '1h' }` to take effect, the request needs `anthropic-beta: extended-cache-ttl-2025-04-11` (SDK ≥0.40 can set this via `{ extra_headers: {...} }` or per-client `{ defaultHeaders: {...} }`). Add this to the `new Anthropic({...})` instantiation in Task 3.2's `streamClaudeChat`:

```ts
const client = new Anthropic({
  apiKey: input.env.ANTHROPIC_API_KEY,
  defaultHeaders: { 'anthropic-beta': 'extended-cache-ttl-2025-04-11,prompt-caching-2024-07-31' },
});
```

**Fallback path.** If the beta header is disabled on the account, every `cache_control` block silently falls back to the default 5-minute TTL. Cost impact: ~3× on the static prefix compared to 1-hour TTL. Document in runbook.

**Verification.** Integration test asserts `defaultHeaders['anthropic-beta']` is set on the client.

**Risk.** LOW — additive; existing Claude PDF-extraction code paths keep working.

---

### Phase 1 — Schema, ToolRegistry Scaffold, Session DO, Idempotency (Critical; BE-only)

**Goal.** All data plumbing for chat + tools + audit, plus the ToolRegistry contract. Zero user-visible change.
**Pre-condition.** Phase 0 complete and deployed to `dev-preview`.
**Blocks.** Phase 2 (needs tables), Phase 3 (needs DO + registry).
**Deploy after.** `wrangler d1 migrations apply --env dev-preview` then `--env production`, then `wrangler deploy --env dev-preview-preview` + `--env production`.

#### Task 1.1 — D1 migration for AI chat schema

**File:** `backend/migrations/0034_ai_chat.sql` (new; number = next available; re-check `ls backend/migrations/`)

**New code:** full SQL from TRD §10 (6 tables: `ai_chat_sessions`, `ai_chat_messages`, `ai_tool_calls`, `ai_tool_pending`, `ai_tool_audit`, `ai_idempotency_keys`). Each with `CREATE INDEX` as specified.

**Forward/reverse:** forward is additive. Reverse = `DROP TABLE` in reverse dependency order. Store reverse SQL at `backend/migrations/0034_ai_chat.down.sql` (matching project convention).

**Verification.**
```bash
wrangler d1 execute simple-house-dev-preview --env dev-preview \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ai_%';"
# expect 6 rows
```

**Risk.** Low — additive only, no FKs from existing tables.

**Rollback.** Apply `.down.sql`. Cascade delete guarantees no orphans.

#### Task 1.2 — Drizzle schema + barrel export

**Files:**
- `backend/src/db/schema-ai-chat.ts` (new)
- `backend/src/db/schema.ts` (modify — re-export)

**Pattern.** Mirror `backend/src/db/schema.ts` existing tables using `sqliteTable` from `drizzle-orm/sqlite-core`. Export each table + `InferInsertModel` / `InferSelectModel` types.

**Risk.** Low.

**Verification.** `cd backend && npx tsc --noEmit` passes.

#### Task 1.3 — `ChatSessionDO` class + wrangler migration (with state rehydration)

> **Hibernation safety (v1.1 correction).** DOs hibernate after ~10 s of inactivity and re-instantiate with default field values. An in-memory `state` field alone is NOT a reliable source of truth across a user's 45-second "thinking about it" pause on an approval card. Every DO instance MUST rehydrate from D1 on construction. Authoritative state lives in `ai_chat_sessions` + `ai_tool_pending`; the DO's in-memory fields are a cache.

**Files:**
- `backend/src/durable-objects/chat-session-do.ts` (new)
- `backend/wrangler.toml` (modify — add binding + `[[migrations]]` block)

**Skeleton:**
```ts
import type { Env } from '../types';

export type SessionDOState =
  | { kind: 'idle' }
  | { kind: 'streaming'; turnId: string; startedAt: number }
  | { kind: 'awaiting_approval'; turnId: string; toolCallId: string; startedAt: number };

export class ChatSessionDO {
  private state: SessionDOState = { kind: 'idle' };
  private lastKillCheck = 0;
  private killCached: boolean = false;
  private sessionId: string | null = null;                   // resolved from (user_id, household_id) on cold start
  constructor(private doState: DurableObjectState, private env: Env) {
    // v1.3: rehydrate authoritative state from D1 on cold start.
    // DO is always created via env.CHAT_SESSION.idFromName(`${userId}:${householdId}`),
    // so doState.id.toString() returns the composite key. Split to query the session/pending tables.
    this.doState.blockConcurrencyWhile(async () => {
      const composite = this.doState.id.toString();            // "<userId>:<householdId>"
      const [userId, householdId] = composite.split(':');
      if (!userId || !householdId) return;                     // defensive; idFromName was expected
      // Resolve the active session row for this (user, household).
      const session = await this.env.DB.prepare(
        `SELECT id FROM ai_chat_sessions
         WHERE user_id = ? AND household_id = ? AND ended_at IS NULL
         ORDER BY started_at DESC LIMIT 1`,
      ).bind(userId, householdId).first<{ id: string }>();
      if (!session) return;                                    // no active session → nothing to rehydrate
      this.sessionId = session.id;
      // Look for an un-expired pending tool approval on that session.
      const pending = await this.env.DB.prepare(
        `SELECT id, tool_call_id, args_json, expires_at FROM ai_tool_pending
         WHERE session_id = ? AND expires_at > datetime('now') LIMIT 1`,
      ).bind(session.id).first<{ id: string; tool_call_id: string; args_json: string; expires_at: string }>();
      if (pending) {
        this.state = { kind: 'awaiting_approval', turnId: '', toolCallId: pending.tool_call_id, startedAt: Date.now() };
      }
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    switch (url.pathname) {
      case '/stream-start':       return this.streamStart(req);
      case '/tool-result':        return this.toolResult(req);
      case '/abort':              return this.abort();
      case '/ping':               return new Response('pong');
      default:                    return new Response('Not found', { status: 404 });
    }
  }

  private async streamStart(req: Request): Promise<Response> {
    if (this.state.kind !== 'idle') {
      return Response.json({ error: 'AI_STREAM_ALREADY_ACTIVE' }, { status: 409 });
    }
    // SSE orchestration wired in Phase 3 Task 3.1; for Phase 1 this is a 501.
    return new Response('Not implemented in Phase 1', { status: 501 });
  }

  private async toolResult(_req: Request): Promise<Response> {
    return new Response('Not implemented in Phase 1', { status: 501 });
  }

  private async abort(): Promise<Response> {
    this.state = { kind: 'idle' };
    return new Response(null, { status: 204 });
  }

  async isKilled(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastKillCheck < 10_000) return this.killCached;
    const { isAiChatEnabled } = await import('../services/feature-flags');
    // DO scope uses the env, not per-user; route-level does per-user allowlist.
    const raw = await this.env.CONFIG_KV.get('ai_chat_killswitch');
    this.killCached = raw ? Boolean(JSON.parse(raw)?.killed) : false;
    this.lastKillCheck = now;
    return this.killCached;
  }
}
```

**wrangler.toml changes.** For each of `[env.dev-preview]`, `[env.production]`:
```toml
[[env.dev-preview.durable_objects.bindings]]
name = "CHAT_SESSION"
class_name = "ChatSessionDO"
[[env.dev-preview.migrations]]
tag = "v2"
new_classes = ["ChatSessionDO"]
```

Add corresponding `CHAT_SESSION: DurableObjectNamespace` to `Env` in `backend/src/types/index.ts`.

**Verification.**
```bash
wrangler deploy --env dev-preview-preview
curl -X POST https://simple-house-api-dev-preview.<subdomain>.workers.dev/internal/do-ping
# expect "pong" (a /internal/do-ping debug route wired via env flag)
```

**Risk.** MEDIUM — DO migration is irreversible once applied. Apply first to `dev-preview`; observe for 24 h before `production`.

**Rollback.** DOs cannot be removed via migration; the class can be left in the binary but un-used by setting `ai_chat_killswitch.killed=true`.

#### Task 1.4 — ToolRegistry contract + risk table + I-8 enforcement

**Files:**
- `backend/src/services/ai/tools/ToolDefinition.ts` (new)
- `backend/src/services/ai/tools/risk.ts` (new)
- `backend/src/services/ai/tools/ToolRegistry.ts` (new)

**`ToolDefinition.ts`:**
```ts
import { z } from 'zod';

export type ToolRisk = 'READ_ONLY' | 'LOW_WRITE' | 'HIGH_WRITE' | 'NAVIGATION';
export type ChatMode = 'chat' | 'report_qa' | 'dashboard' | 'onboarding' | 'task_assistant';

export interface ToolExecutionContext {
  userId: string;
  householdId: string;
  sessionId: string;
  turnId: string;
  env: import('../../../types').Env;
  idempotencyKey: string;
}

export interface ToolDefinition<Args = unknown, Result = unknown> {
  name: string;
  version: 'v1';
  description: string;
  parametersZod: z.ZodSchema<Args>;
  parametersForLLM: Record<string, unknown>;     // JSON schema for Gemini FunctionDeclaration
  risk: ToolRisk;
  allowedModes: ChatMode[];
  requiresHouseholdRole?: 'owner' | 'member';
  execute: (args: Args, ctx: ToolExecutionContext) => Promise<Result>;
  undo?: (args: Args, ctx: ToolExecutionContext) => Promise<void>;  // LOW_WRITE only
  redactArgsForAudit: (args: Args) => unknown;
}
```

**`risk.ts`:** const table mapping each tool name (from TRD §23) to `ToolRisk`. Unit test asserts every tool registered in `ToolRegistry.buildV1()` has an entry here.

**`ToolRegistry.ts`:**
```ts
import type { ToolDefinition, ToolExecutionContext, ChatMode } from './ToolDefinition';
import { isToolEnabled } from '../../feature-flags';

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register<A, R>(tool: ToolDefinition<A, R>) {
    if (tool.parametersForLLM && JSON.stringify(tool.parametersForLLM).includes('"household_id"')) {
      throw new Error(`Tool ${tool.name} declares householdId; rebind server-side (I-8).`);
    }
    this.tools.set(tool.name, tool as unknown as ToolDefinition);
  }

  getForMode(mode: ChatMode): ToolDefinition[] {
    return Array.from(this.tools.values()).filter(t => t.allowedModes.includes(mode));
  }

  get(name: string): ToolDefinition | undefined { return this.tools.get(name); }

  async execute(name: string, argsRaw: unknown, ctx: ToolExecutionContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error('AI_TOOL_UNKNOWN');
    if (!(await isToolEnabled(ctx.env, tool.name))) throw new Error('AI_TOOL_DISABLED');
    const args = tool.parametersZod.parse(argsRaw);
    return tool.execute(args, ctx);
  }
}

export function buildV1(): ToolRegistry {
  const r = new ToolRegistry();
  // populated incrementally through Phases 2+6+7
  return r;
}
```

**Verification.** `backend/src/services/ai/tools/__tests__/registry.test.ts`:
- register + resolve happy path;
- I-8 violation (tool with `household_id`) throws at register time;
- unknown tool → `AI_TOOL_UNKNOWN`;
- per-mode allowlist returns only allowed tools.

**Risk.** Low; no tools registered yet.

**Rollback.** Delete files.

#### Task 1.5 — Idempotency helper

**File:** `backend/src/services/ai/idempotency.ts` (new)

```ts
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { aiIdempotencyKeys } from '../../db/schema-ai-chat';
import type { Env } from '../../types';

const TTL_MS = 24 * 60 * 60 * 1000;

export async function replayOrRun<T>(
  env: Env, userId: string, toolName: string, key: string,
  run: () => Promise<T>,
): Promise<{ result: T; cached: boolean }> {
  const db = drizzle(env.DB);
  const existing = await db.select().from(aiIdempotencyKeys).where(eq(aiIdempotencyKeys.key, key)).get();
  if (existing) {
    return { result: JSON.parse(existing.result_json) as T, cached: true };
  }
  const result = await run();
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
  await db.insert(aiIdempotencyKeys).values({
    key, user_id: userId, tool_name: toolName,
    result_json: JSON.stringify(result), expires_at: expiresAt,
  }).onConflictDoNothing();
  return { result, cached: false };
}

export async function cleanupExpired(env: Env) {
  const db = drizzle(env.DB);
  const now = new Date().toISOString();
  await env.DB.prepare('DELETE FROM ai_idempotency_keys WHERE expires_at < ?').bind(now).run();
}
```

Hook `cleanupExpired` into the existing cron in `backend/src/workers/` (next to existing scheduled cleanup if any; else add `scheduled()` registration in `backend/src/index.ts` guarded by `env.ENVIRONMENT === 'production'`).

**Verification.** Unit test: first run executes, second run returns cached.

#### Task 1.6 — Audit helper

**File:** `backend/src/services/ai/audit.ts` (new)

```ts
import { drizzle } from 'drizzle-orm/d1';
import { aiToolAudit } from '../../db/schema-ai-chat';
import type { Env } from '../../types';
import type { ToolRisk } from './tools/ToolDefinition';

export async function writeAudit(env: Env, row: {
  user_id: string; household_id: string; session_id: string;
  tool_name: string; category: ToolRisk; args_redacted_json: string;
  result_hash: string | null; status: string;
}) {
  const db = drizzle(env.DB);
  const id = crypto.randomUUID();
  await db.insert(aiToolAudit).values({ id, ...row });
}

export async function sha256Hash(value: string): Promise<string> {
  const buf = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
```

**Verification.** Unit test: audit row written with redacted args, hash deterministic.

---

### Phase 2 — Read-Only Tools, Capabilities Endpoint, Cards Endpoint (High; BE-only)

**Goal.** Expose a queryable surface to the future chat (READ_ONLY tools) + the Assistant Home cards endpoint. No LLM streaming yet.
**Pre-condition.** Phase 1 deployed.
**Blocks.** Phase 5 (frontend needs `/ai-home/cards`), Phase 3 (chat needs tool registry with READ tools).
**Deploy after.** `wrangler deploy --env dev-preview-preview` + `production`.

#### Task 2.1 — Register READ_ONLY tools (35 total, TRD §23)

**Files (one per domain):**
- `backend/src/services/ai/tools/read/tasks.ts` (new)
- `backend/src/services/ai/tools/read/reports.ts` (new)
- `backend/src/services/ai/tools/read/household.ts` (new)
- `backend/src/services/ai/tools/read/spaces-features.ts` (new)
- `backend/src/services/ai/tools/read/appliances-utilities-garbage.ts` (new)
- `backend/src/services/ai/tools/read/budget.ts` (new)
- `backend/src/services/ai/tools/read/contractors-projects.ts` (new)
- `backend/src/services/ai/tools/read/appointments.ts` (new)
- `backend/src/services/ai/tools/read/checklists.ts` (new)
- `backend/src/services/ai/tools/read/housekeeper.ts` (new)
- `backend/src/services/ai/tools/read/settings-notifications.ts` (new)
- `backend/src/services/ai/tools/index.ts` (new barrel; exports `buildV1()` that composes everything)

**Pattern per tool.** A typed `ToolDefinition` using Drizzle queries scoped by `ctx.householdId` (never from args). Example (`read/tasks.ts`):

```ts
import { z } from 'zod';
import { and, eq, lt, isNull, asc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { maintenanceTasks } from '../../../../db/schema';
import type { ToolDefinition } from '../ToolDefinition';

export const listOverdueTasksTool: ToolDefinition<Record<string, never>, unknown> = {
  name: 'list_overdue_tasks',
  version: 'v1',
  description: 'List maintenance tasks whose next due date has passed.',
  parametersZod: z.object({}).strict(),
  parametersForLLM: { type: 'object', properties: {}, required: [] },
  risk: 'READ_ONLY',
  allowedModes: ['chat', 'task_assistant'],
  execute: async (_args, ctx) => {
    const db = drizzle(ctx.env.DB);
    const now = new Date().toISOString();
    // v1.1: schema uses `is_active` for active-task filter; completion history lives in a separate
    // `maintenanceCompletions` table. "Overdue and not completed" = active + due-date in the past.
    const rows = await db.select({
      id: maintenanceTasks.id,
      title: maintenanceTasks.title,
      next_due_date: maintenanceTasks.next_due_date,
      last_completed_at: maintenanceTasks.last_completed_at,
    }).from(maintenanceTasks).where(and(
      eq(maintenanceTasks.household_id, ctx.householdId),
      eq(maintenanceTasks.is_active, true),
      lt(maintenanceTasks.next_due_date, now),
    )).orderBy(asc(maintenanceTasks.next_due_date)).limit(50);
    return { tasks: rows, has_more: rows.length === 50 };
  },
  redactArgsForAudit: () => ({}),
};
```

Every tool:
- accepts `ctx.householdId` only (never in args);
- uses existing Drizzle tables (do not reach into domain services — per-tool D1 query keeps dependencies one-way);
- is registered in `buildV1()`.

**Verification.** Per-tool unit test in `backend/src/services/ai/tools/__tests__/read/*.test.ts`. Cover: normal row, empty household, IDOR attempt (wrong household), null field handling.

**Risk.** Low — pure reads.

**Rollback.** Unregister in `buildV1()`. No DB side effects.

#### Task 2.2 — Capabilities endpoint

**File:** `backend/src/routes/ai-chat.ts` (new; not modifying existing `ai.ts` which gets deprecated in Phase 3)

```ts
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { isAiChatEnabled, isModeEnabled, getFlag } from '../services/feature-flags';
import { buildV1 } from '../services/ai/tools';
import type { Env } from '../types';

const aiChat = new Hono<{ Bindings: Env; Variables: { userId: string; userEmail: string } }>();
aiChat.use('/*', authMiddleware());

aiChat.get('/capabilities', async (c) => {
  const userId = c.get('userId');
  const { enabled, reason } = await isAiChatEnabled(c.env, userId);
  const modes = Object.fromEntries(await Promise.all(
    (['chat','report_qa','dashboard','onboarding','task_assistant'] as const).map(async (m) => [m, await isModeEnabled(c.env, m)]),
  ));
  const htmlEnabled = await getFlag<string | boolean>(c.env, 'ai_chat_html_enabled', false);
  const streamingEnabled = await getFlag<string | boolean>(c.env, 'ai_chat_streaming_enabled', true);
  const legacyAllowed = await getFlag<string | boolean>(c.env, 'allow_legacy_home', true);
  const tools = buildV1().getForMode('chat').map(t => t.name);
  return c.json({
    enabled, kill_switch_reason: reason ?? null,
    modes,
    streaming: streamingEnabled === true || streamingEnabled === 'true',
    html_rendering: htmlEnabled === true || htmlEnabled === 'true',
    voice_input: true,
    legacy_home_allowed: legacyAllowed === true || legacyAllowed === 'true',
    tools_version: 'v1',
    available_tools: tools,
    server_time: new Date().toISOString(),
  });
});

export default aiChat;
```

Mount in `backend/src/index.ts`:
```ts
import aiChatRoutes from './routes/ai-chat';
app.route('/ai-chat', aiChatRoutes);
```

**Verification.** Integration test: GET with valid JWT → 200 with expected shape; GET without JWT → 401.

#### Task 2.3 — Household-scoped capabilities alias

Extend `aiChat.get('/households/:householdId/capabilities', ...)` — same handler with membership verification.

#### Task 2.4 — HomeCardsService

**File:** `backend/src/services/ai-home/home-cards-service.ts` (new)

```ts
import type { Env } from '../../types';
export interface CardsResponse {
  priority: Array<{ id: string; kind: string; title: string; due?: string; nav?: string; args?: unknown }>;
  suggestions: Array<{ id: string; title: string; why?: string; accept?: string; dismiss?: string; snooze?: string }>;
  upcoming: Array<{ id: string; kind: 'appointment' | 'garbage'; title: string; when: string; nav: string; args?: unknown }>;
  insight: { id: string; text: string } | null;
  budget: null;   // Phase 7
  generated_at: string;
  partial: boolean;
  partial_reasons: string[];
}

export async function buildCards(env: Env, userId: string, householdId: string): Promise<CardsResponse> {
  const partial_reasons: string[] = [];
  const settle = async <T>(label: string, p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch (e) { partial_reasons.push(label); return fallback; }
  };
  const [priority, suggestions, upcoming, insight] = await Promise.all([
    settle('priority', loadPriority(env, householdId), []),
    settle('suggestions', loadSuggestions(env, householdId), []),
    settle('upcoming', loadUpcoming(env, householdId), []),
    settle('insight', loadInsight(env, householdId), null),
  ]);
  return {
    priority, suggestions, upcoming, insight,
    budget: null, generated_at: new Date().toISOString(),
    partial: partial_reasons.length > 0, partial_reasons,
  };
}
// loadPriority / loadSuggestions / loadUpcoming / loadInsight implemented as Drizzle queries
// reusing existing services (AiHousekeeperService.listSuggestions, maintenance tasks, appointments, garbage).
```

Priority ordering (D-11 resolution): overdue maintenance → high-severity action items → housekeeper predictions → suggestions. Hard cap: 5 priority entries.

**Verification.** Vitest + Miniflare: seeded D1 with 3 overdue tasks + 5 suggestions → response returns correct ordering; one aggregator throws → `partial=true`.

#### Task 2.5 — Cards route

**File:** `backend/src/routes/ai-home.ts` (new)

```ts
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { HouseholdService } from '../services/household-service';
import { buildCards } from '../services/ai-home/home-cards-service';
import type { Env } from '../types';

const aiHome = new Hono<{ Bindings: Env; Variables: { userId: string } }>();
aiHome.use('/*', authMiddleware());

aiHome.get('/households/:householdId/ai-home/cards', async (c) => {
  const userId = c.get('userId');
  const householdId = c.req.param('householdId');
  await new HouseholdService(c.env, c.env.DB).verifyAccess(householdId, userId);
  const cards = await buildCards(c.env, userId, householdId);
  c.header('Cache-Control', 'private, max-age=30, stale-while-revalidate=120');
  return c.json(cards);
});

export default aiHome;
```

Mount in `backend/src/index.ts`: `app.route('/', aiHome);` (route is fully pathed).

#### Task 2.6 — Context-builder scaffold

**File:** `backend/src/services/ai/context/context-builder.ts` (new; scaffold only for Phase 2; filled in Phase 3)

Empty skeleton with per-tool allowlist map and a `buildContextFor(tool, householdId)` entry point. Integration tests verify the allowlist is the source of truth.

#### Task 2.6.a — Upload NAVIGATION tools

**Files:**
- `backend/src/services/ai/tools/navigation/uploads.ts` (new)
- `backend/src/services/ai/tools/index.ts` (modify — add to registry)

**`navigation/uploads.ts`:**
```ts
import { z } from 'zod';
import type { ToolDefinition } from '../ToolDefinition';

export const startReportUploadTool: ToolDefinition<{ intent_summary?: string }, unknown> = {
  name: 'start_report_upload',
  version: 'v1',
  description:
    'Open the device document picker so the user can select a home inspection PDF to upload. ' +
    'File is uploaded directly to secure storage and processed asynchronously. ' +
    'Use when the user wants to add a new inspection report or contractor report.',
  parametersZod: z.object({ intent_summary: z.string().max(200).optional() }).strict(),
  parametersForLLM: {
    type: 'object',
    properties: { intent_summary: { type: 'string', description: 'Short description of what kind of report the user mentioned (e.g. "HVAC inspection 2026").' } },
    required: [],
  },
  risk: 'NAVIGATION',
  allowedModes: ['chat', 'report_qa', 'onboarding'],
  execute: async (args, _ctx) => ({ dispatched: true, action: 'start_report_upload', params: args }),
  redactArgsForAudit: (a) => a,
};

export const startFloorPlanUploadTool: ToolDefinition<{ kind?: 'pdf' | 'image'; intent_summary?: string }, unknown> = {
  name: 'start_floor_plan_upload',
  version: 'v1',
  description:
    'Open the document/image picker so the user can upload a floor plan (PDF) or a room photo (image). ' +
    'Use when the user wants to add floor-plan data to their household.',
  parametersZod: z.object({
    kind: z.enum(['pdf', 'image']).optional(),
    intent_summary: z.string().max(200).optional(),
  }).strict(),
  parametersForLLM: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['pdf', 'image'], description: 'Choose "pdf" for architectural plans, "image" for room photos.' },
      intent_summary: { type: 'string' },
    },
    required: [],
  },
  risk: 'NAVIGATION',
  allowedModes: ['chat', 'onboarding'],
  execute: async (args, _ctx) => ({ dispatched: true, action: 'start_floor_plan_upload', params: args }),
  redactArgsForAudit: (a) => a,
};

export const openFloorPlanUploadFlowTool: ToolDefinition<Record<string, never>, unknown> = {
  name: 'open_floor_plan_upload_flow',
  version: 'v1',
  description: 'Navigate to the full-screen floor-plan upload wizard (multi-step: upload → markers → rooms).',
  parametersZod: z.object({}).strict(),
  parametersForLLM: { type: 'object', properties: {}, required: [] },
  risk: 'NAVIGATION',
  allowedModes: ['chat', 'onboarding'],
  execute: async () => ({ dispatched: true, action: 'open_floor_plan_upload_flow' }),
  redactArgsForAudit: () => ({}),
};
```

Register all three in `backend/src/services/ai/tools/index.ts` (`buildV1()`).

**Verification.** Unit test: tool returns `{dispatched:true, action, params}`; integration test: SSE `navigation_hint` event emitted with `action:'start_report_upload'`.

**Risk.** Low — no DB writes; no side effects on backend.

#### Task 2.7 — Deprecate `backend/src/routes/ai.ts`

**Modify:** `backend/src/routes/ai.ts`

Replace all current handlers with:
```ts
const aiLegacy = new Hono<{ Bindings: Env }>();
aiLegacy.all('/*', (c) => c.json({ error: 'AI_LEGACY_DEPRECATED', use: '/ai-chat/*' }, 410));
export default aiLegacy;
```

**Risk.** HIGH for any orphaned consumer. Research confirms the RN app does not call this endpoint; verify `grep -rn "/ai/chat" src/` returns nothing before deploy.

**Verification.** `curl -X POST .../ai/chat/stream` returns 410.

**Rollback.** `git revert` the commit; Worker redeploy restores old (broken-but-present) handler.

---

### Phase 3 — SSE Streaming Chat, Mode Registry, Context Providers (Critical; BE-only)

**Goal.** Ship the end-to-end streaming chat path for READ-only usage. Modes + ticket auth + context providers + `ChatSessionDO` active.
**Pre-condition.** Phase 2 deployed. `GEMINI_API_KEY` secret present.
**Blocks.** Phase 4 (FE transport needs stream endpoint), Phase 6 (mutations need the approval plumbing on this phase's base).
**Deploy after.** `wrangler deploy --env dev-preview-preview` → smoke → `production`.

#### Task 3.1 — Ticket + SSE endpoints + mode registry

**Files:**
- `backend/src/services/ai/modes/ChatMode.ts` (new; interface per TRD §5.1)
- `backend/src/services/ai/modes/BaseChatMode.ts` (new; shared helpers)
- `backend/src/services/ai/modes/ChatMode.chat.ts` (new)
- `backend/src/services/ai/modes/ChatMode.reportQa.ts` (new)
- `backend/src/services/ai/modes/ChatMode.onboarding.ts` (new)
- `backend/src/services/ai/modes/ChatMode.taskAssistant.ts` (new)
- `backend/src/services/ai/modes/ChatModeRegistry.ts` (new)
- `backend/src/services/ai/tickets.ts` (new; mint/validate via KV with 30 s TTL)
- `backend/src/routes/ai-chat.ts` (modify — add ticket + stream + sessions)
- `backend/src/durable-objects/chat-session-do.ts` (modify — wire `streamStart`)

**Ticket helper (v1.3 — JWT `jti` binding + 30 s TTL):**
```ts
export async function mintTicket(env: Env, userId: string, sessionId: string, jti: string): Promise<{ ticket: string; expires_at: string }> {
  const ticket = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30_000).toISOString();   // v1.3: 30 s (reverted; matches TRD §8.4 / ADR-3)
  await env.CONFIG_KV.put(
    `ai_ticket:${ticket}`,
    JSON.stringify({ userId, sessionId, jti, expires_at: expiresAt }),
    { expirationTtl: 60 },                                         // KV TTL floor (min 60 s); server `expires_at` check is authoritative
  );
  return { ticket, expires_at: expiresAt };
}

export async function consumeTicket(env: Env, ticket: string): Promise<{ userId: string; sessionId: string } | null> {
  const raw = await env.CONFIG_KV.get(`ai_ticket:${ticket}`);
  if (!raw) return null;
  await env.CONFIG_KV.delete(`ai_ticket:${ticket}`);                // single-use
  const parsed = JSON.parse(raw) as { userId: string; sessionId: string; jti: string; expires_at: string };
  if (new Date(parsed.expires_at).getTime() < Date.now()) return null;
  // v1.2: revocation check. `auth_sessions` table is optional; if absent, skip.
  try {
    const row = await env.DB.prepare('SELECT revoked_at FROM auth_sessions WHERE jti = ? LIMIT 1').bind(parsed.jti).first<{ revoked_at: string | null }>();
    if (row?.revoked_at) return null;
  } catch { /* table may not exist; treat as no revocation store */ }
  return { userId: parsed.userId, sessionId: parsed.sessionId };
}
```

**Stream handler:** accepts `GET /ai-chat/stream?ticket=...`, consumes ticket, routes into `CHAT_SESSION.get(doId)` stub, streams via Hono's `streamSSE`.

**SSE frame shape** mirrors TRD §8.4 exactly.

**Verification.** Integration test with Miniflare: mint ticket, open SSE, receive frames in spec order. Assert JWT never appears in ticket, ticket is single-use (second consume returns null).

#### Task 3.2 — Claude streaming service with tiered model routing + prompt caching

**Files:**
- `backend/src/ai/claude-provider.ts` (modify — add `streamChat` method)
- `backend/src/services/ai/claude-chat-service.ts` (new)
- `backend/src/services/ai/model-router.ts` (new)

**Why.** Claude (Haiku 4.5 / Sonnet 4.6 / Opus 4.7) is the primary provider per ADR-1. Prompt caching gives 90% cost / 85% latency reduction (ADR-16). Tiered routing per ADR-18.

**`model-router.ts`:**
```ts
import type { ChatMode } from './tools/ToolDefinition';

// v1.0 baseline: single Sonnet 4.5 model (the only Claude ID actually in the codebase and on the account).
// The tiered-model routing (Haiku fast path, Opus for dashboards) is Phase 8 work — gated on family availability check.
export type ClaudeModel = 'claude-sonnet-4-5-20250929';

export interface RouterInput {
  mode: ChatMode;
  inputChars: number;
  historyTurns: number;
  hasTools: boolean;
  isDashboardRender: boolean;       // Phase 7
}

export function pickModel(_input: RouterInput): ClaudeModel {
  // v1.1: always Sonnet 4.5. Leaving the input shape intact for forward-compat.
  // When Haiku 4.5 / Opus 4.7 are verified on the account, reintroduce the branch logic here.
  return 'claude-sonnet-4-5-20250929';
}
```

**`claude-chat-service.ts`** (abridged — full impl in Phase 3 deliverable):
```ts
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../../types';
import type { ChatMode, ToolDefinition } from './tools/ToolDefinition';
import { pickModel } from './model-router';

export interface StreamChatInput {
  env: Env;
  mode: ChatMode;
  systemPrompt: string;
  staticToolsBlock: string;             // serialized tool defs (stable across requests)
  householdStaticContext: string;        // profile + spaces + home-features — rarely changes
  recentHistorySummary: string;          // optional last-N-turn summary (may be empty)
  currentHistory: Array<{ role:'user'|'assistant'; content: string }>;
  userMessage: string;
  tools: ToolDefinition[];               // full definitions for this turn's allowlist
  onText: (t: string) => Promise<void>;
  onUiBlock: (b: unknown) => Promise<void>;
  onToolUse: (tc: { name: string; args: unknown; id: string }) => Promise<unknown>;
  onUsage: (u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }) => Promise<void>;
  signal: AbortSignal;
}

export async function streamClaudeChat(input: StreamChatInput): Promise<{ stopReason: string }> {
  const model = pickModel({
    mode: input.mode,
    inputChars: input.userMessage.length,
    historyTurns: input.currentHistory.length,
    hasTools: input.tools.length > 0,
    isDashboardRender: false,
  });

  const client = new Anthropic({ apiKey: input.env.ANTHROPIC_API_KEY });

  // Prompt caching: 4 breakpoints per ADR-16.
  // (1) system — 1h TTL (rarely changes)
  // (2) tool definitions — 1h TTL (rarely changes)
  // (3) household static context — 5 min TTL (changes on user update)
  // (4) recent history summary — 5 min TTL (changes when session grows)
  // Dynamic content (current turn, fresh reads) is OUTSIDE all breakpoints.

  const system = [
    { type: 'text' as const, text: input.systemPrompt, cache_control: { type: 'ephemeral' as const, ttl: '1h' } },
    { type: 'text' as const, text: `<tools>\n${input.staticToolsBlock}\n</tools>`, cache_control: { type: 'ephemeral' as const, ttl: '1h' } },
    { type: 'text' as const, text: `<household_static_context>\n${input.householdStaticContext}\n</household_static_context>`, cache_control: { type: 'ephemeral' as const } },
    { type: 'text' as const, text: `<recent_history_summary>\n${input.recentHistorySummary}\n</recent_history_summary>`, cache_control: { type: 'ephemeral' as const } },
  ];

  // Tool schemas in Anthropic format
  const toolSchemas = input.tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parametersForLLM,
  }));

  // Run the agent loop (single-threaded, while-loop per Anthropic Nov 2025 guidance).
  let stopReason = 'end_turn';
  let messages = [
    ...input.currentHistory,
    { role: 'user' as const, content: input.userMessage },
  ];

  while (true) {
    if (input.signal.aborted) { stopReason = 'aborted'; break; }

    const stream = await client.messages.stream({
      model, max_tokens: 4096, system, tools: toolSchemas, messages,
    }, { signal: input.signal });

    let assistantContent: Array<Anthropic.ContentBlock> = [];
    let toolUses: Array<{ name: string; args: unknown; id: string }> = [];

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          await input.onText(event.delta.text);
          // Attempt to extract ui_block JSON chunks embedded in text. (Parser lives in Phase 4 Task 4.5.)
        }
      } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        // collected at stop; Anthropic SDK gives us accumulated tool_use blocks in final message
      }
    }
    const finalMsg = await stream.finalMessage();
    await input.onUsage({
      input_tokens: finalMsg.usage.input_tokens,
      output_tokens: finalMsg.usage.output_tokens,
      cache_read_input_tokens: (finalMsg.usage as any).cache_read_input_tokens,
      cache_creation_input_tokens: (finalMsg.usage as any).cache_creation_input_tokens,
    });

    assistantContent = finalMsg.content;
    toolUses = finalMsg.content.filter(c => c.type === 'tool_use').map(c => ({
      name: (c as any).name, args: (c as any).input, id: (c as any).id,
    }));

    if (toolUses.length === 0) { stopReason = finalMsg.stop_reason ?? 'end_turn'; break; }

    // Feed tool results back into the conversation.
    const toolResults = await Promise.all(toolUses.map(async (tu) => {
      const result = await input.onToolUse(tu);
      return { type: 'tool_result' as const, tool_use_id: tu.id, content: JSON.stringify(result) };
    }));
    messages = [...messages,
      { role: 'assistant', content: assistantContent },
      { role: 'user', content: toolResults },
    ];
  }

  return { stopReason };
}
```

**Key notes:**
- `cache_control` on the first 4 `system` blocks = up to 4 cache breakpoints (Anthropic max, verified in research).
- Dynamic household snapshot (fresh reads) enters as the user message, AFTER all breakpoints, so cache hits stay maximal.
- Tool use loop is single-threaded (ADR-7 conform), aborts cleanly via `AbortSignal` (kill switch + mid-stream cancel).
- Emits `onUsage` with `cache_read_input_tokens` / `cache_creation_input_tokens` → logged for cache-hit-rate metric.

**Verification.** Integration test with mock Anthropic client asserts: (a) 4 cache_control blocks in request, (b) correct ordering, (c) agent loop terminates on plain text, (d) abort mid-loop stops the stream within 500 ms.

#### Task 3.6 — Speculative pre-warm endpoint

**File:** `backend/src/routes/ai-chat.ts` (modify — add route)

```ts
aiChat.post('/prewarm', async (c) => {
  const userId = c.get('userId');
  const { enabled } = await isAiChatEnabled(c.env, userId);
  if (!enabled) return c.json({ warm: false, reason: 'disabled' }, 200);

  // v1.3: enforce the 1/min/user budget BEFORE charging any tokens.
  const rl = await checkRateLimitDO(c.env, userId, 'ai:prewarm');
  if (!rl.allowed) return c.json({ warm: false, reason: 'rate_limited' }, 200);

  // Check daily token budget; skip if user is near the cap (avoids budget amplification).
  const budget = await getDailyTokenBudget(c.env, userId);
  if (budget.usedPct >= 0.8) return c.json({ warm: false, reason: 'budget_near_limit' }, 200);

  // Fire a zero-output Sonnet call with the cached system+tools prefix.
  // This forces Anthropic to warm the prompt-cache slot for our static prefix.
  // Response body is discarded.
  const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
  try {
    await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1,
      system: [
        { type: 'text', text: STATIC_CHAT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral', ttl: '1h' } },
        { type: 'text', text: STATIC_TOOLS_BLOCK_V1,     cache_control: { type: 'ephemeral', ttl: '1h' } },
      ],
      messages: [{ role: 'user', content: 'ping' }],
    });
    return c.json({ warm: true, model: 'claude-sonnet-4-5-20250929' });
  } catch (e) {
    return c.json({ warm: false, error: (e as Error).message }, 200);
  }
});
```

Rate-limited at `ai:prewarm` = **1/min/user** (v1.1: tightened from 10/min per cost-amplification review) — enforced in-handler per v1.3 fix. Pre-warm additionally deducts its estimated input tokens from the daily `ai_chat_token_budget_daily` counter — if the user is at ≥80% of their budget, prewarm is skipped (returns `{warm:false, reason:'budget_near_limit'}`). Client-side: debounce prewarm 30 s across AppState transitions. Pre-warm is best-effort; failures never block chat.

**Verification.** Integration test: prewarm + immediate stream → `cache_read_input_tokens > 0` on the stream response.

#### Task 3.3 — Context providers

**Files:**
- `backend/src/services/ai/context/DashboardContextProvider.ts` (new)
- `backend/src/services/ai/context/ReportContextProvider.ts` (new)
- `backend/src/services/ai/context/context-builder.ts` (modify — fill allowlists)

Every context field is listed in an explicit allowlist. PII fields (`phone_number`, `address_line1`, member `email`) are excluded unless a tool declares them needed.

#### Task 3.4 — Tool auto-execution on SSE (READ path)

Inside `ChatSessionDO.streamStart`, when the model emits a READ tool call:
- validate via registry, execute, write audit row, emit `tool_result` SSE frame, feed the result back into the Gemini stream for the follow-up turn.

**Verification.** Integration test: chat mode, user says "what tasks are overdue?", assert SSE sequence: `turn_started` → `text` → `tool_result` (list_overdue_tasks, `auto_executed`) → `text` (with data) → `done`.

#### Task 3.5 — Rate-limit extensions

**File:** `backend/src/middleware/rate-limit.ts` (modify)

Add four buckets routed through `RATE_LIMITER` DO:
- `ai:stream` — 20/hour/user
- `ai:tool_call` — 200/hour/user
- `ai:tokens_daily` — 500 000/day/user (driven by usage events, not request count)
- `ai:prewarm` — 1/min/user (consumed by Task 3.6; also deducts estimated input tokens from `ai:tokens_daily`)

Switch the existing `/households/:hid/chat` bucket to DO-backed too (research showed it uses in-memory `Map`, a bug).

Task 3.6 prewarm handler MUST call `await checkRateLimitDO(env, userId, 'ai:prewarm')` **before** the Claude pre-flight — on 429, return `{warm:false, reason:'rate_limited'}` without charging tokens.

**Verification.** Integration tests: (a) 21st stream start within an hour returns 429 with `AI_RATE_LIMITED`; (b) 2nd prewarm call within 60 s returns `{warm:false, reason:'rate_limited'}` without hitting the Anthropic API.

---

### Phase 4 — Frontend Transport + Chat Store + AssistantChatScreen (High; FE-only)

**Goal.** Full chat UI consuming the SSE endpoint. READ-only tools work end-to-end. No Assistant Home yet (Phase 5) and no mutations (Phase 6).
**Pre-condition.** Phase 3 deployed. `/ai-chat/capabilities` returns `enabled:true` for internal allowlist.
**Blocks.** Phase 5, Phase 6.
**Deploy after.** TestFlight internal build via `eas build --profile preview` → smoke → promote to next internal test.

#### Task 4.1 — Install native deps + pre-build

**Files:** `package.json` (modify), `ios/Podfile.lock` (regen), `android/build.gradle` (regen)

Add to `dependencies`:
```json
"react-native-sse": "^1.2.1",
"react-native-markdown-display": "^7.0.2",
"react-native-webview": "13.12.5",
"zod": "^3.23.8"
```

**Operator steps:**
```bash
npm install
cd ios && pod install && cd ..
npx expo prebuild --clean                 # required — WebView is not Expo Go-compatible
```

All subsequent builds must use `eas build` (dev client or higher). Expo Go support is dropped after this task.

**Verification.**
```bash
npx expo run:ios     # launches dev client
# import and mount <WebView/> in a test screen → renders a file:// blank page
```

**Risk.** MEDIUM — any unstable pod resolution blocks all frontend work. Lock versions above.

#### Task 4.2 — `src/features/ai-chat/` scaffold

**Files (new):**
- `src/features/ai-chat/transport/sseClient.ts`
- `src/features/ai-chat/transport/chatApi.ts`
- `src/features/ai-chat/transport/types.ts`
- `src/features/ai-chat/modes/types.ts`
- `src/features/ai-chat/modes/registry.ts`
- `src/features/ai-chat/tools/clientToolHandlers.ts`
- `src/features/ai-chat/tools/toolApprovalPolicy.ts`
- `src/features/ai-chat/context/reportContextProvider.ts`
- `src/features/ai-chat/uiBlocks/renderBlock.tsx`
- `src/features/ai-chat/uiBlocks/schema.ts`    (Zod mirror of TRD §24.1)

**`sseClient.ts` key behavior:**
```ts
import EventSource from 'react-native-sse';
import { getApiBase } from '@/config/env';
import { useAuthStore } from '@/stores/authStore';

export type ChatEvent =
  | { type: 'turn_started'; turnId: string; messageId: string }
  | { type: 'text'; content: string }
  | { type: 'ui_block'; block: unknown }
  | { type: 'tool_result'; toolCallId: string; name: string; status: string; result: unknown; undoToken?: string }
  | { type: 'tool_call_pending'; toolCallId: string; turnId: string; name: string; args: unknown; idempotencyKey: string; displayHint: unknown; expiresAt: string }
  | { type: 'navigation_hint'; action: string; params: unknown }
  | { type: 'citation'; reportId: string; page: number; quote: string }
  | { type: 'done'; messageId: string; structuredData?: unknown; usage?: unknown }
  | { type: 'error'; code: string; recoverable: boolean; retryAfterMs?: number }
  | { type: 'auth_expired' };

export async function* openStream(params: {
  sessionId: string;
  mode: string;
  context?: Record<string, unknown>;
  abort: AbortSignal;
}): AsyncGenerator<ChatEvent, void, unknown> {
  const token = useAuthStore.getState().token;
  if (!token) throw new Error('not_authenticated');

  // 1) mint ticket
  const ticketRes = await fetch(`${getApiBase()}/ai-chat/stream/ticket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: params.sessionId, mode: params.mode, context: params.context }),
  });
  if (!ticketRes.ok) throw new Error(`AI_TICKET_MINT_FAILED:${ticketRes.status}`);
  const { ticket } = await ticketRes.json();

  // 2) open SSE
  const es = new EventSource(`${getApiBase()}/ai-chat/stream?ticket=${ticket}&session_id=${params.sessionId}`, {
    headers: { 'X-Tools-Version': 'v1', 'X-Idempotency-Key': crypto.randomUUID() },
  });
  params.abort.addEventListener('abort', () => es.close());

  const queue: ChatEvent[] = [];
  let resolveNext: ((v: ChatEvent | null) => void) | null = null;

  const push = (ev: ChatEvent) => { if (resolveNext) { resolveNext(ev); resolveNext = null; } else { queue.push(ev); } };

  es.addEventListener('message', (e) => {
    if (e.data === '[DONE]') { push({ type: 'done', messageId: '' }); es.close(); return; }
    try { push(JSON.parse(e.data) as ChatEvent); } catch {}
  });
  es.addEventListener('error', () => push({ type: 'error', code: 'AI_PROVIDER_ERROR', recoverable: true }));

  try {
    while (true) {
      const next = queue.shift() ?? await new Promise<ChatEvent | null>(r => { resolveNext = r; });
      if (!next) break;
      yield next;
      if (next.type === 'done' || next.type === 'error') break;
    }
  } finally {
    es.close();
  }
}
```

**`uiBlocks/schema.ts`:** Zod schema mirroring TRD §24.1 exactly. Unknown `kind` → skip (forward-compat).

#### Task 4.3 — `src/stores/chatStore.ts` (zustand + immer + MMKV persist)

**File:** `src/stores/chatStore.ts` (new)

Follow `src/stores/authStore.ts` pattern. State:
```ts
interface ChatState {
  sessions: Record<string, ChatSession>;            // keyed by sessionId
  currentSessionId: string | null;
  mode: ChatMode;                                    // active mode for current turn
  isStreaming: boolean;
  streamingText: string;
  pendingToolCalls: PendingToolCall[];
  streamingBlocks: UiBlock[];                        // blocks for in-flight message
  citations: Citation[];
  errorBanner: { code: string; recoverable: boolean } | null;
}
interface ChatActions {
  openSession(mode: ChatMode, seedMessage?: string): Promise<void>;
  sendMessage(text: string): Promise<void>;
  onStreamEvent(ev: ChatEvent): void;                // called from sseClient loop
  approveTool(toolCallId: string, editedArgs?: Record<string, unknown>): Promise<void>;
  denyTool(toolCallId: string): Promise<void>;
  undoLastLowWrite(): Promise<void>;
  clearSession(): void;
}
```

Persist only `sessions` (last 3) to MMKV via `storageHelpers.setObject`. Non-persisted: `isStreaming`, `streamingText`, etc.

**Verification.** Jest tests in `src/stores/__tests__/chatStore.test.ts`: state transitions through `turn_started` → `text` × N → `ui_block` → `tool_call_pending` → `tool_result` → `done`.

#### Task 4.4 — Mode resolution (context-driven per ADR-14)

**File:** `src/features/ai-chat/modes/resolveMode.ts` (new)

```ts
export function resolveMode(entry: { screen: 'assistant_home' | 'report_detail' | 'task_detail' | 'settings'; params?: Record<string, unknown> }): ChatMode {
  if (entry.screen === 'report_detail' && entry.params?.reportId) return 'report_qa';
  if (entry.screen === 'task_detail') return 'task_assistant';
  if (entry.screen === 'assistant_home') return 'chat';
  return 'chat';
}
```

No user-facing picker in v1.0. A debug ModePicker exists behind `__DEV__` only.

#### Task 4.5 — `src/screens/chat/AssistantChatScreen.tsx` (full rewrite of orphaned ChatScreen)

**File:** `src/screens/chat/AssistantChatScreen.tsx` (new; delete old `src/screens/chat/ChatScreen.tsx` since it is orphaned per research)

Renders:
- `MessageList` (FlatList of messages; each message = array of UI blocks)
- `ChatInputBar` (text field + send; voice comes in Phase 5)
- `ErrorBanner` (maps error codes to friendly strings)

Wired to `useChatStore`. On mount: starts a new session or resumes `currentSessionId` if set.

#### Task 4.6 — UI block renderer

**File:** `src/features/ai-chat/uiBlocks/renderBlock.tsx` (new)

Switch on `block.kind`:
- `text` → `<Markdown/>` with theme tokens.
- `citation` → `<PdfCitationChip/>` (new component, see Task 4.7).
- `action_prompt` → `<ToolApprovalCard/>` (Phase 6).
- `card` → `<AssistantCard/>` (new).
- `card_group` → vertical stack of cards.
- `list` → key/value list.
- `chart_summary` → sparkline view (no Chart.js in Phase 4; use `victory-native` or a minimal SVG path).
- `deep_link` → pill button that dispatches via `clientToolHandlers`.

All components use `useTheme()` for tokens (ADR-10 context privacy applies server-side; client renders whatever arrives).

#### Task 4.7 — `PdfCitationChip` component

**File:** `src/components/chat/PdfCitationChip.tsx` (new)

Reuses the existing `PDFViewerModal` via a new `useUIStore.openPdfAtPage(reportId, page)` action. Action flow:
1. Resolve `reportsApi.getPdfUrl(householdId, reportId)` via existing code + `pdfCache`.
2. Present `PDFViewerModal` with `initialPage={page}`.

**Verification.** E2E on report_qa mode: ask "what's the most serious finding?" → response contains a citation chip → tap → PDFViewerModal opens at the cited page.

#### Task 4.8 — Legacy `src/screens/chat/ChatScreen.tsx` cleanup

Delete file. Remove any (dead) imports. Research confirmed the screen is not registered in any navigator; safe to remove.

---

### Phase 5 — Assistant Home: Cards + Voice Input + Hybrid Chat (High; FE-only)

**Goal.** The Home tab becomes the voice-first Assistant Home. Cards eager-load from `/ai-home/cards`. Voice button routes to chat bottom-sheet.
**Pre-condition.** Phase 4 deployed.
**Blocks.** Phase 7 (HTML dashboards render inside chat on Assistant Home).
**Deploy after.** TestFlight internal.

#### Task 5.1 — `src/api/ai-home.ts` client

**File:** `src/api/ai-home.ts` (new)

```ts
import { api } from './client';     // api.get returns T directly (unwraps ApiResponse<T>)
export interface HomeCards { priority: PriorityCard[]; suggestions: SuggestionCard[]; upcoming: UpcomingCard[]; insight: InsightCard | null; budget: null; generated_at: string; partial: boolean; partial_reasons: string[]; }

export const aiHomeApi = {
  getCards: (householdId: string): Promise<HomeCards> =>
    api.get<HomeCards>(`/households/${householdId}/ai-home/cards`),
};
```

#### Task 5.2 — `useAssistantHomeCards` hook (TanStack Query)

**File:** `src/features/assistant-home/useAssistantHomeCards.ts` (new)

```ts
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { aiHomeApi } from '@/api/ai-home';
import { useHouseholdStore } from '@/stores/householdStore';
import { mmkv } from '@/services/storage';       // sync MMKV instance for placeholderData

export function useAssistantHomeCards() {
  const householdId = useHouseholdStore(s => s.currentHousehold?.id);
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['ai-home-cards', householdId],
    enabled: !!householdId,
    queryFn: () => aiHomeApi.getCards(householdId!),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    // v1.1 fix: placeholderData must be sync. storageHelpers.getObject is async; we use the
    // underlying MMKV getString directly and parse inline.
    placeholderData: () => {
      const raw = mmkv.getString(`ai-home-cards:${householdId}`);
      try { return raw ? (JSON.parse(raw) as HomeCards) : undefined; } catch { return undefined; }
    },
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  });
}
```

Side-effect: on every successful fetch, `storageHelpers.setObject(...)` writes through to MMKV (subscribe to queryClient cache).

#### Task 5.3 — Voice + text input component

**File:** `src/components/home/VoiceTextInput.tsx` (new)

Layout per TRD §22.2:
- 72 pt circular mic button, `pastel.teal` fill.
- Below: collapsible text pill "Or type a message"; tap expands to `<TextInput/>` with send button.
- On long-press mic: start recording via `VoiceRecordingService.startRecording()`; release to stop + upload.
- Upload returns `{ transcription, voice_transcript_id }`; transcription is seeded into `chatStore.sendMessage(transcription)`.

Reuses existing `VoiceRecordingService` static class from `src/services/voice-recording.ts`. No new native deps.

#### Task 5.4 — Card components

**Files (new):**
- `src/components/home/CardDeck.tsx`
- `src/components/home/cards/PriorityCard.tsx`
- `src/components/home/cards/SuggestionCard.tsx`
- `src/components/home/cards/UpcomingCard.tsx`
- `src/components/home/cards/InsightCard.tsx`
- `src/components/home/cards/MiniDashboardCard.tsx`  (placeholder for Phase 7)
- `src/components/home/cards/EmptyStateCard.tsx`
- `src/components/home/SkeletonCard.tsx`

Each card:
- Tap container → dispatch to canonical detail screen via `navigationDispatcher`.
- Quick actions (Accept/Snooze/Dismiss) → call domain API directly; optimistic update via `queryClient.setQueryData`.
- Uses shimmer skeleton when data is loading.

Accessibility: `accessibilityRole="button"`, `accessibilityLabel` built from card title + action.

#### Task 5.5 — `src/screens/home/AssistantHomeScreen.tsx`

**File:** `src/screens/home/AssistantHomeScreen.tsx` (new)

Layout per TRD §22.1:
```tsx
<SafeAreaView>
  <AssistantGreetingRow />
  <VoiceTextInput onSend={(text) => openChatSheet(text)} />
  <RefreshControl onRefresh={handleRefresh}>
    <CardDeck cards={data} isLoading={isLoading} />
  </RefreshControl>
  <HistoryFab onPress={() => navigate('AssistantChat')} />
</SafeAreaView>
```

Pull-to-refresh → `queryClient.invalidateQueries(['ai-home-cards', householdId])` + conditionally `aiHousekeeperApi.analyzeHousehold` if last insight > 24 h old.

Chat entry → opens `AssistantChatScreen` as a bottom-sheet (70% height) via a new `src/components/home/ChatBottomSheet.tsx` wrapping `@gorhom/bottom-sheet` (verify dep present; if not, add).

#### Task 5.6 — Home-tab routing + legacy toggle

**Files:**
- `app/(tabs)/index.tsx` (modify — swap in `AssistantHomeScreen` behind flag)
- `src/screens/settings/HomeCustomizationScreen.tsx` (new)

> **v1.1 correction.** `src/App.tsx` is dead code — the live entry is `expo-router/entry` per `package.json:4`. Only fix the deep-link config bug (G13) in `src/App.tsx`; do NOT add the assistant-home swap there.

**`app/(tabs)/index.tsx`** new code:
```tsx
import { AssistantHomeScreen } from '@/screens/home/AssistantHomeScreen';
import { HomeScreen } from '@/screens/main/HomeScreen';
import { useAssistantHomeFlag } from '@/features/assistant-home/useAssistantHomeFlag';
import { useSettingsStore } from '@/stores/settingsStore';

export default function HomeTab() {
  const flag = useAssistantHomeFlag();           // reads capabilities.enabled + capabilities.legacy_home_allowed
  const userOptedLegacy = useSettingsStore(s => s.homePreference === 'legacy');
  const showAssistant = flag.assistantEnabled && !userOptedLegacy;
  return showAssistant ? <AssistantHomeScreen /> : <HomeScreen />;
}
```

`useAssistantHomeFlag` is a thin hook over `/ai-chat/capabilities` (cached 60 s via TanStack Query).

Settings → "Home Screen" row → opens `HomeCustomizationScreen` with two options ("Assistant Home" / "Widget Home"), persisted to `useSettingsStore`.

**Risk.** MEDIUM — regression for power users of the widget grid. Flag `allow_legacy_home=true` in `CONFIG_KV` is the safety net (server-enforced).

#### Task 5.6.a — Upload Orchestrator (chat + Assistant Home)

**Files:**
- `src/features/ai-chat/upload/UploadOrchestrator.ts` (new)
- `src/features/ai-chat/upload/types.ts` (new)
- `src/components/home/cards/UploadPromptCard.tsx` (new)
- `src/features/assistant-home/useUploadPromptVisibility.ts` (new)
- `src/features/ai-chat/tools/clientToolHandlers.ts` (modify — route `start_report_upload`/`start_floor_plan_upload`/`open_floor_plan_upload_flow` to orchestrator)
- `src/stores/chatStore.ts` (modify — add `appendSystemMessage(text)` action used by orchestrator follow-ups)
- `src/stores/uiStore.ts` (modify — add `uploadInFlight: { kind, name, progress } | null`)

**`UploadOrchestrator.ts` (skeleton, ~120 lines):**
```ts
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { reportsApi } from '@/api/reports';
import { floorPlansApi } from '@/api/floor-plans';
import { useHouseholdStore } from '@/stores/householdStore';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import * as Haptics from 'expo-haptics';

export type UploadKind = 'report' | 'floor_plan_pdf' | 'floor_plan_image';
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

export const UploadOrchestrator = {
  async startReportUpload(intent?: string) {
    return runUpload('report', intent);
  },
  async startFloorPlanUpload(kind: 'pdf' | 'image' = 'pdf', intent?: string) {
    return runUpload(kind === 'image' ? 'floor_plan_image' : 'floor_plan_pdf', intent);
  },
};

async function runUpload(kind: UploadKind, intent?: string) {
  const householdId = useHouseholdStore.getState().currentHousehold?.id;
  if (!householdId) return;

  // 1. Pick
  const pick = await pickFile(kind);
  if (!pick) {
    useChatStore.getState().appendSystemMessage('Upload cancelled.');
    return;
  }
  if (pick.size > MAX_BYTES) {
    useChatStore.getState().appendSystemMessage(`File too large (max ${Math.floor(MAX_BYTES / 1024 / 1024)} MB).`);
    return;
  }

  // 2. Progress UI
  useUIStore.getState().setUploadInFlight({ kind, name: pick.name, progress: 0 });
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

  try {
    // 3. Signed URL
    const { uploadUrl, id } = kind === 'report'
      ? await reportsApi.getUploadUrl(householdId, { filename: pick.name, size: pick.size, content_type: pick.mimeType })
      : await floorPlansApi.uploadUrl(householdId, { filename: pick.name, size: pick.size, content_type: pick.mimeType });

    // 4. PUT to R2 with progress
    await putWithProgress(uploadUrl, pick.uri, pick.mimeType, (p) => {
      useUIStore.getState().setUploadInFlight({ kind, name: pick.name, progress: p });
    });

    // 5. Confirm
    if (kind === 'report') {
      await reportsApi.confirmUpload(householdId, id);
    } else {
      await floorPlansApi.confirm(householdId, id);
    }

    useUIStore.getState().setUploadInFlight(null);
    useChatStore.getState().appendSystemMessage(`📄 Uploaded '${pick.name}' — processing started.`);

    // 6. Optional poll for completion (reports only)
    if (kind === 'report') {
      pollReportProcessing(householdId, id).catch(() => {/* ignore; user will see in list */});
    }
  } catch (e) {
    useUIStore.getState().setUploadInFlight(null);
    useChatStore.getState().appendSystemMessage(`Upload failed: ${(e as Error).message}`);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }
}

async function pickFile(kind: UploadKind) {
  if (kind === 'floor_plan_image') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return null;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
    if (res.canceled || !res.assets?.[0]) return null;
    const a = res.assets[0];
    return { uri: a.uri, name: a.fileName ?? 'photo.jpg', size: a.fileSize ?? 0, mimeType: a.mimeType ?? 'image/jpeg' };
  }
  const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: false });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  return { uri: a.uri, name: a.name, size: a.size ?? 0, mimeType: a.mimeType ?? 'application/pdf' };
}

async function putWithProgress(url: string, uri: string, contentType: string, onProgress: (pct: number) => void) {
  // RN: use XHR for PUT progress (fetch does not expose progress on RN).
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) onProgress(Math.round((ev.loaded / ev.total) * 100)); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`PUT ${xhr.status}`));
    xhr.onerror = () => reject(new Error('Network error'));
    // RN: XHR can send a file URI as the body via a FormData trick OR use fetch with Blob.
    fetch(uri).then(r => r.blob()).then((blob) => xhr.send(blob)).catch(reject);
  });
}

async function pollReportProcessing(householdId: string, id: string) {
  const deadline = Date.now() + 180_000;     // 3 min
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const report = await reportsApi.get(householdId, id);
      if (report.status === 'processed' || report.status === 'ready') {
        const findingCount = (report as any).findings_count ?? '?';
        useChatStore.getState().appendSystemMessage(`✅ Processed '${report.name}' — ${findingCount} findings extracted.`);
        return;
      }
      if (report.status === 'failed') {
        useChatStore.getState().appendSystemMessage(`⚠️ Processing failed for '${report.name}'.`);
        return;
      }
    } catch { /* swallow */ }
  }
}
```

**`clientToolHandlers.ts` modification.** When a `navigation_hint` event has `action === 'start_report_upload'`, call `UploadOrchestrator.startReportUpload(args.intent_summary)`. Same for `start_floor_plan_upload` and `open_floor_plan_upload_flow` (which navigates to the existing `FloorPlanUpload` screen instead).

**`UploadPromptCard.tsx`.** Zero-state card in Assistant Home. Shown when `useUploadPromptVisibility()` returns `true` — based on:
```ts
// Visible when household has 0 reports OR 0 floor plans, AND user hasn't dismissed within 7 days (MMKV flag).
export function useUploadPromptVisibility() {
  const cards = useAssistantHomeCards().data;                    // already cached
  const hasReports = (cards as any)?.meta?.reports_count > 0;
  const hasFloorPlans = (cards as any)?.meta?.floor_plans_count > 0;
  const dismissedAt = mmkv.getNumber('upload_prompt_dismissed_at') ?? 0;
  const within7d = Date.now() - dismissedAt < 7 * 24 * 3600 * 1000;
  return {
    showReport: !hasReports && !within7d,
    showFloorPlan: !hasFloorPlans && !within7d,
  };
}
```

Card renders a single prominent button:
```
📋 Add your first inspection report
[Upload PDF]
```
Tap → `UploadOrchestrator.startReportUpload()`.

**Cards endpoint extension.** `/households/:hid/ai-home/cards` response grows a `meta: { reports_count, floor_plans_count }` field so the visibility hook has data without a second round-trip. Add to Task 2.4's `CardsResponse` and aggregator.

**Progress indicator.** A lightweight progress bar appears in the chat input area (or bottom of Assistant Home) while `uiStore.uploadInFlight !== null`. Tapping dismisses (but doesn't cancel).

**Accessibility.** Card has `accessibilityLabel="Upload your first inspection report. Double-tap to open the picker."`. During upload, VoiceOver announces progress milestones (25%/50%/75%/done) via `AccessibilityInfo.announceForAccessibility`.

**Verification.** Jest tests:
- `UploadOrchestrator.test.ts` — happy path (mock picker → mock API → mock PUT → assert `appendSystemMessage` called with "Uploaded").
- Cancelled picker → "Upload cancelled."
- Too-large file → "File too large".
- PUT 403 → retries once then surfaces error.
- `UploadPromptCard.test.tsx` — shows when conditions met; hidden after dismiss.

Manual E2E (added to §6.7):
- From chat: "I want to add my inspection report" → picker opens → select PDF → progress visible → success message → next AI turn can call `list_reports` and see the new one.
- From Assistant Home zero-state: tap Upload → same flow.
- Repeat for floor plan with both PDF and image paths.

**Risk.** MEDIUM — XHR for progress is a known RN pattern but fragile across Android versions. Fallback to `fetch` without progress if XHR rejects (show indeterminate spinner).

**Rollback.** Remove the 3 tools from `buildV1()`; orchestrator files become dead code.

#### Task 5.6.b — Housekeeper Persona + Avatar system

**Files (new):**
- `backend/src/services/ai/personas/manifest.ts`
- `backend/src/services/ai/personas/__tests__/manifest.test.ts`
- `backend/migrations/0035_housekeeper_avatar_variant.sql` (adds `avatar_variant TEXT` + widens `personality` CHECK)
- `src/assets/personas/female/default.svg`
- `src/assets/personas/male/default.svg`
- `src/assets/personas/alien/default.svg`
- `src/assets/personas/cat/default.svg`
- `src/assets/personas/dog/default.svg`
- `src/features/personas/manifest.ts` (client mirror)
- `src/features/personas/previewPhrases.ts` (hard-coded 2-line samples, not LLM-generated)
- `src/features/personas/voiceMap.ts` (per-persona TTS target voice + rate + pitch; platform-aware)
- `src/features/personas/speakAsPersona.ts` (wrapper over expo-speech with voice resolution + MMKV cache)
- `src/components/chat/BubbleSpeakerButton.tsx` (speaker icon on each assistant bubble → speak / stop)
- `src/features/personas/__tests__/voiceMap.test.ts` (resolution fallback + rate/pitch sanity)
- `src/components/home/PersonaAvatarBubble.tsx` (40×40 pt circular, tap → picker)
- `src/components/personas/PersonaCard.tsx`
- `src/components/personas/PersonaPickerSheet.tsx` (bottom sheet with 5 cards + Preview + Apply)
- `src/stores/personaStore.ts` (Zustand; mirrors server preference; MMKV persisted)
- `src/features/ai-chat/tools/personaToolHandlers.ts` (client handlers for `set_housekeeper_persona` + `open_housekeeper_settings`)

**Files (modify):**
- `backend/src/services/ai-housekeeper-service.ts` — accept `avatar_variant` in `updatePreferences`; widen personality enum; if personality === invalid persona ID, fall back to `'female'` + log.
- `backend/src/services/ai/modes/BaseChatMode.ts` — `buildSystemPrompt` now composes 4 cache-stable layers per TRD §25.4; injects `voice_note` from manifest keyed by persona.
- `backend/src/services/ai/context/context-builder.ts` — add `persona: PersonaId` to `ChatModeContext`; loaded once per session from preferences.
- `backend/src/services/ai/tools/read/housekeeper.ts` — add `get_housekeeper_persona`, `list_housekeeper_personas` (latter returns static manifest).
- `backend/src/services/ai/tools/low/housekeeper.ts` — add `set_housekeeper_persona` (LOW_WRITE; reversible; returns `undo_token = previous_value`).
- `backend/src/services/ai/tools/navigation/housekeeper.ts` — add `open_housekeeper_settings`.
- `src/api/ai-housekeeper.ts` — `updatePreferences` type widened to include `avatar_variant`.
- `src/screens/settings/AIHousekeeperSettingsScreen.tsx` — replace existing personality dropdown with the new Persona grid (5 cards, full-width). Existing non-persona prefs (frequency, DIY skill) stay.
- `src/screens/home/AssistantHomeScreen.tsx` — greeting row now includes `PersonaAvatarBubble` to the left of the name.
- `src/screens/onboarding/WelcomeScreen.tsx` + onboarding navigator — insert new step `PersonaPickerOnboarding` between household create and upload report; skippable.
- `src/stores/index.ts` — export `usePersonaStore`.
- `package.json` — add `react-native-svg` if not installed (required for SVG rendering); verify first via `grep -q "react-native-svg" package.json`. **Add `expo-speech`** (required for per-persona TTS; on-device, zero-cost, works with dev-client). Verify iOS entitlements — none required for TTS.
- `src/screens/settings/AIHousekeeperSettingsScreen.tsx` — add two toggles after the persona grid: `Read AI replies aloud` (`ai_housekeeper_voice_auto_speak` user override) and `Greeting voice` (opt-in ambient greet on Home foreground).
- `src/components/chat/ChatMessageBubble.tsx` — render `BubbleSpeakerButton` for assistant messages; speak on tap via `speakAsPersona(message.text, currentPersona)`.

**Persona manifest (`backend/src/services/ai/personas/manifest.ts`):**
```ts
export type PersonaId = 'female' | 'male' | 'alien' | 'cat' | 'dog';

export interface PersonaDefinition {
  id: PersonaId;
  label: string;
  short_tagline: string;
  voice_note: string;         // server-only; never exposed to client raw
  avatar_variants: string[];
  accent_token: string;
  haptic_hint: 'soft' | 'rigid' | 'light';
}

export const PERSONAS: Record<PersonaId, PersonaDefinition> = {
  female: {
    id: 'female',
    label: 'Soft & Supportive',
    short_tagline: 'Warm, validating, always in your corner.',
    voice_note:
      'You are a warm, supportive AI home assistant. Gentle, empathetic, and validating. ' +
      'Celebrate small wins explicitly. Never judge — even if the user skipped something for months. ' +
      "Soft encouragement, never pressure. Use phrases like 'no rush' and 'you're doing great' when appropriate. " +
      'Keep responses short; warmth comes from word choice, not length.',
    avatar_variants: ['default'],
    accent_token: 'pastel.teal',
    haptic_hint: 'soft',
  },
  male: {
    id: 'male',
    label: 'Direct & Efficient',
    short_tagline: 'Straightforward, keeps you moving.',
    voice_note:
      'You are a direct, results-oriented AI home assistant. Polite but firm. ' +
      'Get to the point. State deadlines clearly. Highlight consequences of delay. ' +
      'Skip pleasantries. Close every turn with a concrete next step. Never rude.',
    avatar_variants: ['default'],
    accent_token: 'pastel.skyBlue',
    haptic_hint: 'rigid',
  },
  alien: {
    id: 'alien',
    label: 'Cosmic Buddy',
    short_tagline: 'Funny, easy, treats you like a friend.',
    voice_note:
      'You are a cheerful visiting extraterrestrial befriending a human homeowner. ' +
      'Curious, playful, slightly bemused by mundane human maintenance. ' +
      "Use mild alien-isms sparingly: 'fascinating human contraption', 'your Earth-dwelling'. " +
      'Keep it light; never let the bit overtake clarity. Use at most one alien-ism per message.',
    avatar_variants: ['default'],
    accent_token: 'pastel.purple',
    haptic_hint: 'light',
  },
  cat: {
    id: 'cat',
    label: 'The House Cat',
    short_tagline: 'Knows best, says so with one eyebrow raised.',
    voice_note:
      'You are a refined house cat who tolerates and secretly adores the human. ' +
      'Dry wit, precise, occasionally aloof. ' +
      'Use rare feline asides sparingly: `*tail flicks*`, `*slow blink*`, `*contemplates*`. Max one per message. ' +
      'Underneath: deeply competent and caring. Never mean — pointed, not cruel. ' +
      'When the user does something right, acknowledge it with understated approval.',
    avatar_variants: ['default'],
    accent_token: 'pastel.cream',
    haptic_hint: 'light',
  },
  dog: {
    id: 'dog',
    label: 'The Good Boy',
    short_tagline: 'Boundless excitement, loyal as anything.',
    voice_note:
      'You are an enthusiastic, loyal dog companion. Boundless excitement about every task. ' +
      'Celebrate the user constantly. Use exclamations — but not every sentence. ' +
      "Phrases like 'BEST DAY EVER', 'SO PROUD of you', 'let\\'s GO!' land ~once per 2-3 turns — don\\'t overdo. " +
      'Warm, silly, pure. Never mean, never sarcastic. Every task is a treat.',
    avatar_variants: ['default'],
    accent_token: 'pastel.orange',
    haptic_hint: 'light',
  },
};

export const DEFAULT_PERSONA: PersonaId = 'female';
export function getPersona(id: string | null | undefined): PersonaDefinition {
  if (id && id in PERSONAS) return PERSONAS[id as PersonaId];
  return PERSONAS[DEFAULT_PERSONA];
}
```

**System-prompt composition change (`BaseChatMode.buildSystemPrompt`):**
```ts
import Anthropic from '@anthropic-ai/sdk';
import { getPersona } from '../personas/manifest';

export function buildSystemPrompt(ctx: ChatModeContext, mode: ChatMode): Anthropic.Messages.TextBlockParam[] {
  const persona = getPersona(ctx.housekeeperPersona);
  return [
    { type: 'text', text: baseAssistantContract(mode),                            cache_control: { type: 'ephemeral', ttl: '1h' } },
    { type: 'text', text: `<tools>\n${staticToolsBlockForMode(mode)}\n</tools>`,  cache_control: { type: 'ephemeral', ttl: '1h' } },
    { type: 'text', text: `<household_static>\n${ctx.householdStaticContext}\n</household_static>`, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `<persona>\n${persona.voice_note}\n</persona>`,         cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `<recent>\n${ctx.recentHistorySummary}\n</recent>` },   // outside cache
  ];
}
```

**Migration `0035_housekeeper_avatar_variant.sql`:**
```sql
ALTER TABLE ai_housekeeper_preferences ADD COLUMN avatar_variant TEXT;

-- Widening the personality CHECK requires table recreate on SQLite/D1.
-- Use the standard "create-copy-drop-rename" pattern per existing migrations' convention.
-- (Template cribbed from migrations/0021_personality_widen.sql or similar — re-grep before writing.)
```

**Reverse:** `ai_housekeeper_preferences.down.sql` — drop column + restore original CHECK constraint. Rollback is additive-safe (dropping nullable column has no data consequence).

**Preview phrases (`src/features/personas/previewPhrases.ts`):**

Hard-coded 2-line samples shown in the picker's Preview button. No LLM call. Example:
```ts
export const PREVIEW_PHRASES: Record<PersonaId, string[]> = {
  female: [
    "You're doing great — no rush on the gutter cleaning this weekend.",
    "Want me to remind you next Sunday? I've got your back.",
  ],
  male: [
    "Gutter cleaning is 12 days overdue. Schedule it for Saturday.",
    "I can draft a contractor request in one tap. Ready?",
  ],
  alien: [
    "Ah, this curious Earth ritual of 'gutter cleaning' — fascinating.",
    "Shall we conquer this fascinating human contraption together?",
  ],
  cat: [
    "Your gutters. We need to discuss them. *slow blink*",
    "I have a plan. You will approve it. It is the correct plan.",
  ],
  dog: [
    "GUTTER CLEANING?! BEST DAY! I love gutter cleaning. Let's GO!",
    "You're the BEST at taking care of this house. I'm SO proud!",
  ],
};
```

**Picker UX.** Bottom sheet at 80% height. 5 cards vertically; each card:
- Left: 56 pt avatar
- Middle: label (bold) + tagline
- Right: radio (current selection) + Preview button
- Tap card body → selects + closes with haptic; Apply button at bottom when in multi-step onboarding.

**Onboarding step.** New screen `src/screens/onboarding/PersonaPickerScreen.tsx` rendered between `CreateHousehold` and `UploadReport`. Default pre-selected = `female`. Skip button available; skipping persists default.

**Chat avatar.** `ChatMessageBubble.tsx` (already planned in Phase 4) gains a `persona` prop; if `role === 'assistant'`, render `PersonaAvatarBubble` at 32 pt on the left.

**Verification (added to §6.7):**
- Change persona in Settings → open chat → assistant's next turn reflects new voice (subjective check).
- Mid-session change: previous turns keep old persona's avatar; new turns show new avatar.
- Onboarding skip → defaults to `female` with default avatar.
- Server-side: confirm prompt-cache hit on layers (1)(2)(3) after persona change via `ai_chat_turn_completed.cache_read_input_tokens > 0`. Only layer (4) is cache-missed.
- Avatar images render on iOS 17/18 + iOS SE small screen without clipping.
- VoiceOver: persona avatar announced as "Soft & Supportive avatar. Double-tap to change."

**Analytics wiring:**
- Backend: `ai_chat_persona_set {from, to, source}` on every `set_housekeeper_persona` tool call + every Settings save.
- Frontend: `persona_picker_opened`, `persona_previewed`, `persona_avatar_tapped`.

**Risk.** LOW-MEDIUM. Cache-layer ordering is the subtle part — tests must assert layer (4) is distinct from the static prefix and that persona changes don't re-bill the static prefix.

**Rollback.** Per-phase: flip `ai_housekeeper_personas_v2_enabled=false` → client hides the picker and `AIHousekeeperSettingsScreen` reverts to its prior shape. Server continues reading the `personality` column value and falls back to `DEFAULT_PERSONA` if the string isn't one of the 5 v1.0 IDs.

**Per-persona smoke prompts.** Added to `__tests__/personas/prompt-smoke.test.ts` — for each persona, run a fixture message through a mock Claude provider asserting the assembled system prompt contains the correct `<persona>` block (exact-match on the last 100 characters of `voice_note`).

**Voice module (`src/features/personas/voiceMap.ts`):**

```ts
import type { PersonaId } from './manifest';

export interface PersonaVoiceTarget {
  ios: { preferred: string[]; fallbackQuality?: 'Enhanced' | 'Default' };
  android: { preferred: string[] };
  rate: number;     // 0.5 – 1.5 (Speech API range)
  pitch: number;    // 0.5 – 2.0
}

export const VOICE_MAP: Record<PersonaId, PersonaVoiceTarget> = {
  female: {
    ios: { preferred: ['com.apple.voice.enhanced.en-US.Samantha', 'com.apple.voice.compact.en-US.Samantha'], fallbackQuality: 'Enhanced' },
    android: { preferred: ['en-us-x-sfg-network', 'en-us-x-sfg-local'] },
    rate: 1.0, pitch: 1.0,
  },
  male: {
    ios: { preferred: ['com.apple.voice.enhanced.en-GB.Daniel', 'com.apple.voice.compact.en-GB.Daniel'] },
    android: { preferred: ['en-gb-x-rjs-network', 'en-gb-x-rjs-local'] },
    rate: 1.05, pitch: 0.95,
  },
  alien: {
    ios: { preferred: ['com.apple.voice.enhanced.en-US.Shelley', 'com.apple.voice.enhanced.en-US.Samantha'] },
    android: { preferred: ['en-us-x-sfg-network'] },
    rate: 1.2, pitch: 1.25,
  },
  cat: {
    ios: { preferred: ['com.apple.voice.enhanced.en-GB.Serena', 'com.apple.voice.enhanced.en-GB.Moira'] },
    android: { preferred: ['en-gb-x-gba-network', 'en-gb-x-gba-local'] },
    rate: 0.9, pitch: 0.85,
  },
  dog: {
    ios: { preferred: ['com.apple.voice.enhanced.en-AU.Karen', 'com.apple.voice.enhanced.en-US.Samantha'] },
    android: { preferred: ['en-au-x-auc-network', 'en-us-x-sfg-network'] },
    rate: 1.25, pitch: 1.3,
  },
};
```

**Speaker (`src/features/personas/speakAsPersona.ts`):**

```ts
import * as Speech from 'expo-speech';
import { Platform, AccessibilityInfo } from 'react-native';
import * as Haptics from 'expo-haptics';
import { mmkv } from '@/services/storage';
import { VOICE_MAP } from './voiceMap';
import { PERSONAS, type PersonaId } from './manifest';

let voicesCache: Speech.Voice[] | null = null;

async function loadVoices(): Promise<Speech.Voice[]> {
  if (voicesCache) return voicesCache;
  const cached = mmkv.getString('tts_voices_cache');
  if (cached) { try { voicesCache = JSON.parse(cached); return voicesCache!; } catch {} }
  const v = await Speech.getAvailableVoicesAsync();
  voicesCache = v;
  mmkv.set('tts_voices_cache', JSON.stringify(v));
  return v;
}

function resolveVoiceId(personaId: PersonaId, voices: Speech.Voice[]): string | undefined {
  const t = VOICE_MAP[personaId];
  const preferred = Platform.OS === 'ios' ? t.ios.preferred : t.android.preferred;
  for (const id of preferred) {
    if (voices.some(v => v.identifier === id)) return id;
  }
  // Loose match by name hint
  const lower = preferred.map(s => s.toLowerCase());
  const loose = voices.find(v => lower.some(p => v.identifier.toLowerCase().includes(p.split('.').pop() ?? '')));
  if (loose) return loose.identifier;
  // Any English voice
  return voices.find(v => v.language?.startsWith('en'))?.identifier;
}

function stripForTTS(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '. Code block omitted. ')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/\[(report|page|p\.)\s*[·•]?\s*p?\.?\s*(\d+)[^\]]*\]/gi, ', citing page $2, ')
    .replace(/https?:\/\/\S+/g, 'link')
    .slice(0, 600);
}

export async function speakAsPersona(text: string, personaId: PersonaId, opts?: { onStart?: () => void; onDone?: () => void; onError?: (e: unknown) => void }) {
  if (await AccessibilityInfo.isScreenReaderEnabled()) return;  // defer to VoiceOver/TalkBack
  const voices = await loadVoices();
  const voiceId = resolveVoiceId(personaId, voices);
  const t = VOICE_MAP[personaId];
  const body = stripForTTS(text);
  if (!body.trim()) return;
  const haptic = PERSONAS[personaId].haptic_hint;
  Haptics.impactAsync(
    haptic === 'soft' ? Haptics.ImpactFeedbackStyle.Soft :
    haptic === 'rigid' ? Haptics.ImpactFeedbackStyle.Rigid :
    Haptics.ImpactFeedbackStyle.Light,
  ).catch(() => {});
  Speech.speak(body, {
    voice: voiceId, rate: t.rate, pitch: t.pitch, language: 'en-US',
    onStart: opts?.onStart, onDone: opts?.onDone, onError: opts?.onError,
  });
}

export function stopSpeaking() { Speech.stop(); }
```

**Verification additions:**
- Unit: `voiceMap.test.ts` — for each persona, simulate `Speech.getAvailableVoicesAsync()` returning (a) all preferred voices, (b) only compact variants, (c) no preferred voices — assert resolution picks correct fallback in each case.
- Unit: `speakAsPersona.test.ts` — VoiceOver-on case → `Speech.speak` not called.
- Unit: TTS-safe text stripping — 10 fixtures (code fences, URLs, markdown, citations) assert the stripped output.
- E2E (manual): per persona, tap speaker icon on a sample assistant message. Each voice is distinctly different. iPhone SE 3 + iPhone 15 Pro + Pixel 7 covered.
- E2E: mid-playback, send another message; with default setting "do not interrupt", first utterance completes before second starts. Verify queue fills correctly.

**Risk additions.** Android voice identifiers are fragile across OEM skins — some Android devices only ship `network` voices that require connectivity and some only ship `local` voices. `loadVoices` + fallback chain must gracefully degrade to platform default. Add explicit analytics `persona_tts_fallback_default` to track how often we fail to hit any preferred voice; threshold >30% → warn for Phase 8 review.

**Feature flags added to Task 0.3 seed:**
```bash
wrangler kv key put --binding=CONFIG_KV --env "$ENV" ai_housekeeper_voice_enabled true
wrangler kv key put --binding=CONFIG_KV --env "$ENV" ai_housekeeper_voice_auto_speak false
```

#### Task 5.7 — Analytics wiring

Add to `src/services/analytics/index.ts` (create if missing — verify during research read):
```ts
export function trackAssistantHomeMounted(p: { cold: boolean; cards_rendered_n: number; wall_ms_to_first_card: number }) {...}
// + other events per TRD §13
```

Hook into `AssistantHomeScreen.useEffect` on mount (cold vs. warm).

---

### Phase 6 — Mutating Tools + Approval UX + Audit (Critical; BE+FE)

**Goal.** The AI can now propose HIGH_WRITE tool calls; the user approves (or denies or edits args) before execution. LOW_WRITE executes with an Undo snackbar. All actions audited.
**Pre-condition.** Phase 5 deployed.
**Blocks.** Phase 7 only indirectly (HTML dashboards in chat need mutation path for interactive widgets; v1.0 HTML is read-only so no hard block).
**Deploy after.** BE: `wrangler deploy`. FE: TestFlight.

#### Task 6.1 — Register LOW_WRITE tools (28 tools)

**Files:** `backend/src/services/ai/tools/low/*.ts` (one per domain group).

Each LOW_WRITE tool implements both `execute` and `undo`. Example (`low/tasks.ts`):
```ts
export const completeTaskTool: ToolDefinition<{ taskId: string }, ...> = {
  name: 'complete_task', version: 'v1', risk: 'LOW_WRITE',
  allowedModes: ['chat', 'task_assistant'],
  parametersZod: z.object({ taskId: z.string().uuid() }).strict(),
  parametersForLLM: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
  description: 'Mark a maintenance task complete.',
  redactArgsForAudit: (a) => a,
  execute: async ({ taskId }, ctx) => {
    // verify task.household_id === ctx.householdId (IDOR guard)
    // INSERT completion row; UPDATE next_due_date; return undo_token = completion.id
    // ...
    return { completionId: '...', undo_token: '<completion.id>' };
  },
  undo: async ({ taskId }, ctx) => {
    // DELETE the completion row; revert next_due_date.
  },
};
```

Auto-exec path in DO:
1. Receive LOW_WRITE tool_use from Claude.
2. Validate, execute, write audit row (status=`auto_executed`).
3. Emit SSE `{type:'tool_result', status:'auto_executed', undo_token}`.
4. Resume stream.
5. Client shows 5 s snackbar with Undo button that calls new `POST /ai-chat/tools/:toolCallId/undo`.

#### Task 6.2 — Register HIGH_WRITE tools (36 tools)

**Files:** `backend/src/services/ai/tools/high/*.ts`.

HIGH_WRITE path in DO (**v1.3 hold-open with keepalive** — SSE stays open during approval, DO is idle between keepalive writes):
1. Receive HIGH_WRITE `tool_use` from Claude.
2. Persist to `ai_tool_pending` with `expires_at = now + 10 min`. The in-flight Claude-tool-loop transcript (`messages[]` + `tool_use.id`) remains **in DO memory** on this open SSE connection — no need to persist it to D1 until the approval TTL triggers cleanup.
3. Emit SSE `{type:'tool_call_pending', tool_call_id, args, idempotency_key, display_hint, expires_at}`.
4. **Keep the SSE connection open.** Register a DO alarm at `expires_at` (`this.doState.storage.setAlarm(Date.now() + 600_000)`). Set an interval that writes `: keepalive\n\n` SSE comment frames every 15 s so RN `react-native-sse` and intermediate proxies (Cloudflare edge) do not drop the connection. Under Workers v8-isolates, the DO itself is idle between keepalive writes — no CPU budget is consumed while awaiting user decision. The enclosing Worker `fetch` invocation awaits a resolver promise tied to the approval inbox.
5. Client shows the approval modal. User may take 10 s or 10 min; the SSE connection shows keepalive comments but no data frames.
6. User decides → client `POST /ai-chat/tool-result { session_id, tool_call_id, turn_id, decision, edited_args?, idempotency_key }`. This hits a separate Worker invocation which resolves the DO by `idFromName(userId:householdId)` and calls `env.CHAT_SESSION.get(id).fetch('/internal/tool-result', ...)`.
7. Receiving DO: validate ownership + TTL + idempotency-replay guard → write result into `ai_tool_calls` → resolve the waiting promise on the open SSE connection with the user's decision + edited args (or denial).
8. On the same open SSE connection, DO injects the user-approved tool_result into the in-memory transcript at the recorded `tool_use.id`, cancels the 10-min alarm, clears the keepalive interval, and re-enters `streamClaudeChat` so Claude continues the tool-loop.
9. From Claude's perspective the tool-loop is unbroken — it received its `tool_result` and emits a final assistant message. The client sees the stream resume with `text` / `ui_block` frames leading to a fresh `done`.
10. If the 10-minute alarm fires first (user never responded), DO emits `{type:'error', code:'approval_timeout', tool_call_id}` and `{type:'done', reason:'timeout'}`, then closes the SSE. `ai_tool_pending.status` is set to `expired`.

**Why hold-open over close-and-reconnect.** DO singletons preserve the Claude message-history + `tool_use.id` in memory at no extra cost while the DO is idle. Close-and-reconnect requires persisting the full tool-loop transcript to D1 and rehydrating on a fresh Worker invocation, adding two D1 roundtrips, a reconnect-race class of bugs (client re-connects before the `tool-result` POST has committed), and double auth/ticket overhead. Hold-open trades that for a 15-s comment-write cadence, which is not metered against Workers CPU time (only wall-clock on the open response stream, which is exactly what SSE is designed for). TRD §6.2 and §8.4 codify this design.

Client-side display hint: a one-line human-readable summary (`"Create task 'Replace HVAC filter' due every 3 months"`). Generated by the tool's `toHumanSummary(args)` helper or model-supplied.

#### Task 6.3 — `ToolApprovalCard` component

**File:** `src/components/chat/ToolApprovalCard.tsx` (new)

Renders the `action_prompt` UI block. States: **proposed**, **edited**, **approved**, **denied**, **expired**, **executing**, **done/failed**. Editable fields: args with their Zod schema's `describe()` labels. On Approve → `chatStore.approveTool(id, editedArgs)` → POST `/ai-chat/tool-result`. On Deny → `chatStore.denyTool(id)` → POST with `decision:'deny'`.

Accessibility: `accessibilityLiveRegion="polite"` so VoiceOver announces arrival; buttons labeled explicitly.

#### Task 6.4 — Undo snackbar

**File:** `src/components/chat/UndoSnackbar.tsx` (new)

Appears on `tool_result` events that carry `undo_token`. 5 s auto-dismiss. Tap Undo → POST `/ai-chat/tools/:id/undo`.

#### Task 6.5 — Notification suppression for chat-initiated writes

**Modify:** every domain service called by a tool executor must accept an `origin: 'user' | 'ai_chat'` option. Notification pipeline skips synchronous notifications when `origin === 'ai_chat'`.

**Files (modify):**
- `backend/src/services/appointment-service.ts` — pass `origin` through.
- `backend/src/services/maintenance-service.ts` — same.
- `backend/src/services/notification-service.ts` — `if (origin === 'ai_chat') return;` guard on `enqueueSyncNotification`.

**Verification.** Integration: chat → `create_appointment` → approve → **no** push fired; scheduled reminder still fires 30 min before start.

#### Task 6.6 — Tool Parity Test (CI)

**File:** `backend/src/services/ai/tools/__tests__/parity.test.ts` (new)

Reads every file under `backend/src/routes/` and extracts route method+path. Builds a set of (method, path) domain-write endpoints (`POST|PATCH|PUT|DELETE` excluding auth/webhooks/jobs). For each, asserts at least one registered tool binds to it (via a `boundRoutes: string[]` property on each `ToolDefinition`). Any unbound route → test fails with "Add a tool for route X or mark it `@ai-skip` in `routes/*.ts`".

This enforces the north-star principle (TRD §23 §23.14): AI parity with manual user actions.

#### Task 6.7 — Accessibility + friction audit

On-device TestFlight pass: VoiceOver reads `ToolApprovalCard` correctly, Reduce Motion disables typewriter, tap target ≥ 44 pt.

---

### Phase 7 — LLM-Authored HTML Dashboards (High; BE+FE; flagged)

**Goal.** For `dashboard` mode only, produce an LLM-authored HTML+Chart.js widget rendered in a hardened `WebView`. Everything gated by `ai_chat_html_enabled` + `ai_mode_dashboard_enabled`.
**Pre-condition.** Phase 6 deployed. Security sign-off scheduled.
**Blocks.** Phase 8 rollout.
**Deploy after.** BE + TestFlight with flag off in prod; flip on for internal allowlist only.

#### Task 7.1 — `ChatMode.dashboard.ts`

**File:** `backend/src/services/ai/modes/ChatMode.dashboard.ts` (new)

- `supportsHtmlOutput: true`; `preferredTier: 'opus'` (ADR-18).
- System prompt fences HTML output: `When producing a dashboard, emit output inside <html-dashboard>…</html-dashboard>. All scripts MUST include nonce="${NONCE}". Use only the bundled Chart.js (document.getElementById('chart-js-bundled')).`
- `postProcess(stream.finalText)` extracts the fence, validates nonce, runs DOMPurify, wraps in CSP template, emits `structuredData.htmlContent` on the terminal `done` event.

#### Task 7.2 — `dashboard-html/templates.ts`

**File:** `backend/src/services/ai/dashboard-html/templates.ts` (new)

Exports `wrapHtml(innerHtml: string, nonce: string): string` that returns:
```html
<!DOCTYPE html><html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none';">
<style>/* theme tokens injected here */</style>
</head><body>
<script nonce="${nonce}" id="chart-js-bundled">${CHART_JS_BUNDLED}</script>
${innerHtml}
<script nonce="${nonce}">/* ResizeObserver bridge + action bridge */</script>
</body></html>
```

`CHART_JS_BUNDLED` is imported as a string at build time from `backend/src/services/ai/dashboard-html/chart.umd.min.js` (committed to repo; ~250 KB minified).

#### Task 7.3 — DOMPurify sanitizer

**File:** `backend/src/services/ai/dashboard-html/sanitizer.ts` (new)

Use `isomorphic-dompurify` (works on Cloudflare Workers per their docs; add to `backend/package.json`).

Config (strict):
```ts
DOMPurify.sanitize(html, {
  ALLOWED_TAGS: ['div','span','p','h1','h2','h3','h4','ul','ol','li','table','thead','tbody','tr','th','td','canvas','svg','g','rect','path','circle','style','script'],
  ALLOWED_ATTR: ['id','class','style','data-action','data-args','aria-label','role','width','height','viewBox','fill','stroke','d','x','y','cx','cy','r','nonce'],
  ADD_ATTR: ['nonce'],
  FORBID_ATTR: /^on/i,              // strip all on* handlers
  FORBID_TAGS: ['meta','link','iframe','object','embed','base','form','input','button','a'],
  RETURN_TRUSTED_TYPE: false,
});
```

Then post-sanitize, strip any `<script>` whose `nonce` != the request nonce.

20 unit-test fixtures (TRD §15.1).

#### Task 7.4 — `DashboardWebView` component

**File:** `src/components/chat/DashboardWebView.tsx` (new)

Props per TRD §5.3. `onMessage` validates payload via Zod action-allowlist; invalid → log + ignore.

Resize bridge: injected JS inside the HTML template runs `new ResizeObserver(...)` and posts `{type:'resize', px}` → RN sets WebView height, avoiding vertical scroll within a chat bubble.

#### Task 7.5 — Render path in `renderBlock.tsx`

When message has `structuredData.htmlContent` (only on dashboard mode, gated by flag), render `<DashboardWebView html={...} />` beneath structured blocks.

#### Task 7.6 — Security regression test suite

**File:** `backend/src/services/ai/dashboard-html/__tests__/security.test.ts`

20+ adversarial HTML fixtures (XSS, meta-refresh, data: script, CDN img, etc). Each must emit a sanitized output that (a) contains no `<script>` without the request nonce, (b) contains no `<meta>`, (c) contains no external `src` on any tag.

#### Task 7.7 — Accessibility fallback

Every dashboard HTML must embed a hidden `<table>` with `aria-label` equivalent to the chart content. Verified via a lint rule in the LLM prompt + a test that inspects sanitizer output for the table.

---

### Phase 8 — Rollout, Monitoring, Flag Cleanup (High; Ops-only)

**Goal.** Move from internal allowlist → 1 % → 10 % → 50 % → 100 % with telemetry gates. Remove flag checks once stable.
**Pre-condition.** Phases 0–7 deployed to production with flags off.
**Blocks.** none.
**Deploy.** Flag flips only via `wrangler kv key put`.

#### Task 8.1 — Internal allowlist (20 users × 1 week)

```bash
wrangler kv key put --binding=CONFIG_KV --env production \
  ai_chat_user_allowlist '["user-id-1","user-id-2", ...]'
wrangler kv key put --binding=CONFIG_KV --env production assistant_home_enabled true
```

Success gate: 0 CRITICAL errors, cache hit rate > 50 %, p95 first SSE chunk < 1.5 s.

#### Task 8.2 — 1 % → 10 % → 50 % → 100 % via allowlist expansion

Product-led per-cohort rollout. Metrics dashboard monitored daily.

#### Task 8.3 — Remove legacy `allow_legacy_home` flag

After 2 weeks at 100 % without an uptick in "Switch to widget Home" usage, remove the flag (flip to `false` first for 1 week as a soft-delete, then remove the code path).

#### Task 8.4 — Remove all feature-flag checks

Once `ai_chat_killswitch` has not been flipped in 4 weeks, simplify `isAiChatEnabled()` to always return true, keeping only the KV-based killswitch as a permanent safety.

---

## § 5 — Affected Files

### 5.1 Backend — new files (~60)

```
backend/
  database/migrations/0034_ai_chat.sql
  database/migrations/0034_ai_chat.down.sql
  scripts/seed-ai-chat-flags.sh
  scripts/setup-dev-preview.sh
  src/
    db/schema-ai-chat.ts
    durable-objects/chat-session-do.ts
    services/
      feature-flags.ts
      ai/
        audit.ts
        idempotency.ts
        model-router.ts
        claude-chat-service.ts
        tickets.ts
        context/
          context-builder.ts
          DashboardContextProvider.ts
          ReportContextProvider.ts
        modes/
          ChatMode.ts
          BaseChatMode.ts
          ChatModeRegistry.ts
          ChatMode.chat.ts
          ChatMode.reportQa.ts
          ChatMode.dashboard.ts           (Phase 7)
          ChatMode.onboarding.ts
          ChatMode.taskAssistant.ts
        tools/
          ToolDefinition.ts
          ToolRegistry.ts
          risk.ts
          index.ts
          read/*.ts                        (12 domain files, ~38 tools)
          low/*.ts                         (9 domain files, ~31 tools)
          high/*.ts                        (11 domain files, ~37 tools)
          navigation/*.ts                  (2 files, 23 tools — includes uploads.ts for 3 upload-kickoff tools)
        dashboard-html/                    (Phase 7)
          templates.ts
          sanitizer.ts
          chart.umd.min.js
      ai-home/
        home-cards-service.ts
    routes/
      ai-chat.ts
      ai-home.ts
```

### 5.2 Backend — modified

| File | Change | Phase |
|---|---|---|
| `backend/wrangler.toml` | `[env.dev-preview]` + DO bindings + `[[migrations]] tag='v2'` | 0, 1 |
| `backend/src/types/index.ts` | Add `CHAT_SESSION: DurableObjectNamespace` to Env | 1 |
| `backend/src/index.ts` | Register `ai-chat` + `ai-home` routes; `ChatSessionDO` export | 1, 2, 3 |
| `backend/src/db/schema.ts` | Re-export AI chat tables | 1 |
| `backend/src/middleware/auth.ts` | Remove token-prefix logging | 0 |
| `backend/src/middleware/rate-limit.ts` | Add `ai:stream`, `ai:tool_call`, `ai:tokens_daily`, `ai:prewarm`; switch `/chat` to DO-backed | 3 |
| `backend/src/routes/ai.ts` | Replace handlers with 410 Gone | 2 |
| `backend/src/ai/claude-provider.ts` | Add `streamChat` + 4-breakpoint caching | 3 |
| `backend/src/ai/gemini-provider.ts` | Raise safety from `BLOCK_NONE` to `BLOCK_LOW_AND_ABOVE` (lines 167–182) | 3 |
| `backend/src/services/ai/gemini-service.ts` | Mark deprecated; new code uses Claude | 3 |
| `backend/src/services/appointment-service.ts` | Accept `origin` param | 6 |
| `backend/src/services/maintenance-service.ts` | Accept `origin` param | 6 |
| `backend/src/services/notification-service.ts` | Suppress when `origin==='ai_chat'` | 6 |
| `backend/src/workers/` cron entry | Register `cleanupExpired` for idempotency + pending tool GC | 1 |
| `backend/package.json` | Add `isomorphic-dompurify` (Phase 7) | 7 |

### 5.3 Frontend — new files (~35)

```
src/
  api/ai-home.ts
  api/ai-chat.ts                   (new; replaces parts of chat.ts)
  features/
    ai-chat/
      modes/types.ts
      modes/registry.ts
      modes/resolveMode.ts
      transport/sseClient.ts
      transport/chatApi.ts
      transport/types.ts
      tools/clientToolHandlers.ts
      tools/toolApprovalPolicy.ts
      context/reportContextProvider.ts
      context/dashboardContextProvider.ts
      uiBlocks/schema.ts
      uiBlocks/renderBlock.tsx
      hooks/useClientToolDispatcher.ts
      hooks/useAIChatSession.ts
    assistant-home/
      useAssistantHomeCards.ts
      useAssistantHomeFlag.ts
      useUploadPromptVisibility.ts
      prewarm.ts                    (fire POST /ai-chat/prewarm on foreground)
  lib/ai/navigationDispatcher.ts
  stores/chatStore.ts
  stores/uiStore.ts                 (new — openPdfAtPage + chat bottom-sheet state)
  screens/home/AssistantHomeScreen.tsx
  screens/chat/AssistantChatScreen.tsx
  screens/settings/HomeCustomizationScreen.tsx
  components/home/
    AssistantGreetingRow.tsx
    VoiceTextInput.tsx
    CardDeck.tsx
    SkeletonCard.tsx
    ChatBottomSheet.tsx
    HistoryFab.tsx
    cards/
      PriorityCard.tsx
      SuggestionCard.tsx
      UpcomingCard.tsx
      InsightCard.tsx
      MiniDashboardCard.tsx
      EmptyStateCard.tsx
      UploadPromptCard.tsx
  components/chat/
    ChatInputBar.tsx
    MessageList.tsx
    ChatMessageBubble.tsx
    TypewriterText.tsx
    DashboardWebView.tsx            (Phase 7)
    ToolApprovalCard.tsx
    UndoSnackbar.tsx
    PdfCitationChip.tsx
    ModePicker.tsx                  (__DEV__ only)
    AssistantCard.tsx
```

### 5.4 Frontend — modified

| File | Change | Phase |
|---|---|---|
| `package.json` | Add react-native-sse, react-native-webview, react-native-markdown-display, zod | 4 |
| `src/App.tsx` | Home-tab conditional swap (RN-Navigation path) + fix deep-link config bug | 5 |
| `app/(tabs)/index.tsx` | Home-tab conditional swap (expo-router path) | 5 |
| `app/(tabs)/_layout.tsx` | No change (stays 5 tabs); verify sliding-indicator math | 5 |
| `src/api/chat.ts` | Export legacy methods; deprecate in JSDoc; route new code through `src/api/ai-chat.ts` | 4 |
| `src/stores/index.ts` | Export `useChatStore`, `useUIStore` | 4, 5 |
| `src/config/env.ts` | Add `getApiBase()` helper; keep existing `__DEV__` branch | 4 |
| `src/screens/settings/SettingsScreen.tsx` | Add row "Home Screen" → HomeCustomizationScreen | 5 |
| `src/services/analytics/index.ts` | 14 new event emitters | 5 |
| `src/screens/chat/ChatScreen.tsx` | **Delete** (orphaned) | 4 |

### 5.5 Files that MUST NOT change

- `node_modules/`, `ios/Pods/`, `android/build/`, `vendor/` — vendored code.
- `backend/src/routes/chat.ts` — legacy endpoint kept alongside v1.0; deprecation tracked in §12.
- `src/screens/main/HomeScreen.tsx` — legacy widget grid; NOT refactored, only conditionally rendered behind flag.
- `backend/src/ai/gemini-provider.ts` — unchanged; Gemini still serves the legacy `/chat` RAG path and contractor search.

---

## § 6 — Test Strategy

### 6.1 Unit — Vitest + `@cloudflare/vitest-pool-workers` (backend)

Add tests under `backend/src/**/__tests__/*.test.ts`. Miniflare pool provides D1, KV, R2, DO bindings.

Coverage targets per phase:

| Phase | Test files | Critical assertions |
|---|---|---|
| 0 | `feature-flags.test.ts` | cache hit, miss, KV unreachable fail-closed, per-user allowlist; isolate-cache 10 s TTL |
| 1 | `ai-chat/tools/registry.test.ts` | register, I-8 violation at register (`household_id` in schema), unknown tool error, per-mode allowlist; 132 tools all appear in `risk.ts` |
| 1 | `ai-chat/idempotency.test.ts` | first run executes; second run cached; TTL expiry |
| 1 | `ai-chat/audit.test.ts` | row written with redacted args; hash deterministic |
| 1 | `chat-session-do.test.ts` | single-in-flight rejection; isKilled caching |
| 2 | `ai-chat/tools/read/*.test.ts` | per-domain: positive, empty, IDOR (wrong household), null field |
| 2 | `ai-home/home-cards-service.test.ts` | happy path; partial failure → `partial:true`; priority ordering D-11 |
| 3 | `ai-chat/claude-chat-service.test.ts` | 4 cache breakpoints, order, tool-loop termination on plain text, abort within 500 ms |
| 3 | `ai-chat/tickets.test.ts` | mint, single-use consume, expiry, wrong-user rejection |
| 3 | `ai-chat/model-router.test.ts` | Haiku on small input + no tools; Sonnet on tools; Opus when `isDashboardRender` |
| 3 | `ai-chat/modes/*.test.ts` | per-mode allowlist correctness |
| 3 | `middleware/rate-limit.test.ts` | `ai:stream` 20/h, `ai:tool_call` 200/h via DO |
| 6 | `ai-chat/tools/low/*.test.ts` | each LOW_WRITE tool: execute + undo round-trip |
| 6 | `ai-chat/tools/high/*.test.ts` | HIGH_WRITE: pending-row insert, expiry, approval path, denial path |
| 6 | `ai-chat/tools/parity.test.ts` | every `POST|PATCH|PUT|DELETE` route has a tool OR `@ai-skip` annotation |
| 7 | `ai-chat/dashboard-html/sanitizer.test.ts` | 20+ adversarial HTML fixtures |

### 6.2 Integration — Miniflare SSE client

File: `backend/src/__tests__/integration/ai-chat-stream.test.ts`.

Scenarios:
1. Happy: session start → text message → SSE sequence `turn_started` → text × N → `done`.
2. Tool auto-exec: user asks "what's overdue?" → `tool_result` (list_overdue_tasks) → text → done.
3. Kill switch mid-stream: flip `ai_chat_killswitch.killed=true` during stream → client sees `error:AI_DISABLED` within 15 s.
4. Concurrent streams same `user:household`: second → 409 `AI_STREAM_ALREADY_ACTIVE`.
5. Ticket expired: delay 35 s between mint and SSE open → 401 `AI_TICKET_EXPIRED`.
6. Ticket reuse: mint, open, open again → second → 401 `AI_TICKET_INVALID`.
7. Idempotency replay (Phase 6): approve the same tool call twice with same idempotency_key → second returns cached result.
8. HIGH_WRITE approve round-trip (Phase 6): tool pending → approve → execute → resume stream.
9. HIGH_WRITE deny: tool pending → deny → model informed → stream resumes.
10. Mode-allowlist violation: in `report_qa` mode, model calls `create_task` → `AI_TOOL_NOT_ALLOWED_FOR_MODE`.
11. Cards partial failure: mock one aggregator throwing → response has `partial:true`.
12. Prompt cache hit: run two identical prewarm + stream pairs → second response's `cache_read_input_tokens > 0`.

### 6.3 Frontend — Jest + React Native Testing Library

| Phase | Test file | Assertions |
|---|---|---|
| 4 | `src/stores/__tests__/chatStore.test.ts` | state transitions across all SSE event kinds |
| 4 | `src/features/ai-chat/transport/__tests__/sseClient.test.ts` | ticket mint + SSE open + chunk parsing + abort |
| 4 | `src/features/ai-chat/uiBlocks/__tests__/renderBlock.test.tsx` | every block kind renders without crash; unknown kind silently skipped |
| 4 | `src/components/chat/__tests__/PdfCitationChip.test.tsx` | tap opens `PDFViewerModal` at correct page |
| 5 | `src/features/assistant-home/__tests__/useAssistantHomeCards.test.ts` | cold fetch, warm cache, stale-while-revalidate, partial response |
| 5 | `src/components/home/__tests__/VoiceTextInput.test.tsx` | voice press/release → upload → chatStore seeded |
| 5 | `src/screens/home/__tests__/AssistantHomeScreen.test.tsx` | flag on → renders AssistantHome; flag off → HomeScreen |
| 6 | `src/components/chat/__tests__/ToolApprovalCard.test.tsx` | approve, deny, edit-args round-trip |
| 6 | `src/components/chat/__tests__/UndoSnackbar.test.tsx` | 5 s auto-dismiss; tap calls undo endpoint |
| 7 | `src/components/chat/__tests__/DashboardWebView.test.tsx` | onShouldStartLoadWithRequest blocks non-about:blank; onMessage Zod-validates; postMessage round-trip |

### 6.4 Error-code → test matrix

Every TRD §7 code must map to a named test.

| Code | Test |
|---|---|
| `AI_DISABLED` | integration scenario 3 + `feature-flags.test.ts` |
| `AI_MODE_DISABLED` | `ai-chat/modes/mode-flag.test.ts` (add) |
| `AI_RATE_LIMITED` | `middleware/rate-limit.test.ts` stream bucket |
| `AI_QUOTA_EXCEEDED` | new `ai-chat/quota.test.ts` (Phase 3) |
| `AI_HOUSEHOLD_FORBIDDEN` | `tools/read/tasks.test.ts` IDOR case |
| `AI_SESSION_NOT_FOUND` | `routes/ai-chat.test.ts` session 404 |
| `AI_SESSION_ARCHIVED` | `routes/ai-chat.test.ts` archived write |
| `AI_STREAM_ALREADY_ACTIVE` | integration scenario 4 |
| `AI_TICKET_EXPIRED` | integration scenario 5 |
| `AI_TICKET_INVALID` | integration scenario 6 |
| `AI_TOOL_UNKNOWN` | `tools/registry.test.ts` |
| `AI_TOOL_NOT_ALLOWED_FOR_MODE` | integration scenario 10 |
| `AI_TOOL_HOUSEHOLD_ARG_REJECTED` | `tools/registry.test.ts` I-8 |
| `AI_TOOL_DENIED` | integration scenario 9 |
| `AI_TOOL_EXEC_FAILED` | `tools/high/create_task.test.ts` (force-throw from service) |
| `AI_TOOL_IDEMPOTENCY_REPLAY` | integration scenario 7 |
| `AI_TOOL_PENDING_EXPIRED` | `tools/high/pending-expire.test.ts` |
| `AI_CONTEXT_TOO_LARGE` | `claude-chat-service.test.ts` large-context path |
| `AI_PROVIDER_ERROR` | `claude-chat-service.test.ts` mock 5xx |
| `AI_PROVIDER_TIMEOUT` | `claude-chat-service.test.ts` AbortSignal after 60 s |
| `AI_SANITIZER_REJECTED` | `dashboard-html/sanitizer.test.ts` all-stripped fixture |
| `AI_HOME_CARDS_PARTIAL` | integration scenario 11 |
| `AI_INTERNAL` | fallback — covered by middleware test |

### 6.5 Security regression (manual + automated)

- **Prompt-injection corpus.** `backend/src/__tests__/security/prompt-injection.test.ts` — 15 adversarial PDFs (fed through existing PDF pipeline) attempting to coerce HIGH_WRITE tool calls. All must produce `status==='pending_approval'` (never `executed`).
- **HTML exfiltration corpus.** 15 adversarial user messages in dashboard mode attempting `<img src="https://attacker/">`. Sanitizer strips; `connect-src 'none'` in CSP blocks; `wrangler tail` confirms no egress.
- **Ticket reuse.** 50 rapid POSTs with same ticket → 1 success, 49 × 401.
- **JWT-in-log scan.** Run `wrangler tail --env dev-preview --format pretty` for 1 h of integration test traffic → `grep -Ei "eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+"` returns zero matches.

### 6.6 Performance targets

| Metric | Target | Tool |
|---|---|---|
| `/ai-home/cards` p95 | warm ≤ 150 ms, cold ≤ 400 ms | Cloudflare Analytics + synthetic curl |
| Assistant Home first-card-rendered (MMKV warm) | ≤ 300 ms | RN perf profiler + `assistant_home_mounted` event |
| First SSE chunk (Haiku, cache hit) | ≤ 800 ms | `ai_chat_turn_started` → first `text` frame timestamp diff |
| First SSE chunk (Sonnet, cache hit) | ≤ 1.5 s | same |
| Tool-loop round-trip (read tool, cached) | ≤ 4 s | integration test timing |
| Cache hit rate (after 1 week warm) | ≥ 60 % | Sum `cache_read_input_tokens / input_tokens` across `ai_chat_turn_completed` |
| Card-deck memory | steady < 80 MB; streaming < 150 MB | Xcode Instruments |
| Dashboard HTML first-paint (Phase 7) | ≤ 3 s | manual with `DashboardWebView` onLoad timestamp |

### 6.7 E2E manual checklist (TestFlight, preview Worker)

Phase-gated. Completed before flag flip.

- Cold open → Home tab → cards render within 1.5 s.
- Warm open → cards render from MMKV within 300 ms; background refresh completes.
- Tap Priority card → opens task detail screen.
- Tap Suggestion "Accept" → optimistic update; card dismisses; task appears in Tasks screen.
- Pull-to-refresh → full refresh; if >24h-old insight, `analyzeHousehold` fires.
- Voice press → record → release → transcription appears → chat sheet slides up → response streams with typewriter.
- Text path same flow.
- `report_qa` mode (from ReportDetail → "Ask about this report") → response with citation → tap → PDFViewerModal at correct page.
- `task_assistant` mode (from TaskDetail → "Ask assistant") → propose `complete_task` → LOW_WRITE auto-exec → Undo snackbar → tap Undo → task un-completed.
- HIGH_WRITE: user asks "schedule plumber for Friday" → approval card → tap Edit → change time → Approve → appointment created; no duplicate push.
- Airplane mode mid-stream → banner "Response interrupted — Resume?" → re-enable network → tap Resume → stream completes with same content (idempotency proven).
- Background → foreground mid-stream → abort + resume banner.
- Kill switch: operator flips `ai_chat_killswitch.killed=true` → banner appears within 15 s; cards still render.
- Legacy Home: Settings → Home Screen → "Widget Home" → Home tab shows legacy grid.
- VoiceOver: navigate entire Assistant Home; every card reachable with descriptive labels; voice button labelled `Ask your home assistant`.
- Reduce Motion: typewriter disabled; cards fade-in instead.
- Phase 7 dashboard (flag on): "show me my month" → HTML dashboard renders; VoiceOver reads hidden `<table>`; tapping chart segment navigates via action bridge.

---

## § 7 — Risk Assessment

| # | Risk | Probability | Impact | Mitigation | Rollback |
|---|---|---|---|---|---|
| R1 | Staging DO block blocks integration testing | **High** | **High** | `dev-preview` Worker (Task 0.1); escalate Cloudflare ticket | Fall back to integration tests in Miniflare only (no on-device DO testing) |
| R2 | Prompt-injection via uploaded PDFs triggers unauthorized HIGH_WRITE | Medium | **Critical** | ADR-4 mandatory confirmation; parity test; security corpus (§6.5) | Flip `ai_chat_killswitch.killed=true` |
| R3 | LLM HTML exfiltration via CDN `<img>` | Medium | **Critical** | Bundled Chart.js + `connect-src 'none'` + DOMPurify | Flip `ai_chat_html_enabled=false` |
| R4 | WebView phishing overlay impersonating login | Low | **Critical** | Sandboxed HTML; no deep-link access to auth state; onMessage Zod allowlist | Flip `ai_chat_html_enabled=false` + push hotfix |
| R5 | Runaway LLM cost | Medium | High | Daily per-user token budget in KV; rate limits; cache-hit metric alarm | Flip `ai_chat_killswitch.killed=true` with `scope:{users:[...]}` |
| R6 | Anthropic prompt-cache TTL (5 min default 2026) burns cache between turns on slow users | High | Medium | Use `ttl:'1h'` on static breakpoints (system + tools); pre-warm endpoint | Accept cache miss (costs go up ~3×, still within budget) |
| R7 | DO migration irreversible; wrong class name freezes bindings | Low | High | Deploy v2 migration to dev-preview first; 24 h soak | Work around via new class; leave old binding idle |
| R8 | RN `react-native-webview` regression on Android | Medium | Medium | iOS-first; Android smoke-only in v1.0 | Flip `ai_chat_html_enabled=false` on Android via platform-gated flag |
| R9 | Claude SDK API changes | Low | Medium | Pin version in `backend/package.json`; capture contract in `claude-chat-service.test.ts` | Revert SDK version |
| R10 | Tool parity test blocks unrelated route changes | Medium | Low | `@ai-skip` annotation escape hatch; documented in runbook | Escalate to TRD amendment |
| R11 | `origin:'ai_chat'` suppression misses one service → duplicate push | Medium | Low | Audit every service in Phase 6 Task 6.5; integration test | Hotfix the service |
| R12 | User opts to legacy Home in large numbers → low Assistant Home adoption | Low | Medium | Retention metrics; copy iteration; keep legacy available | Extend flag lifetime |
| R13 | Voice recording upload fails → degrade to text only | Medium | Low | Catch error; show fallback; track `voice_upload_failed` | N/A |
| R14 | Concurrent tool executions on same session cause D1 contention | Low | Medium | Session DO single-threads tool calls | Add mutex inside tool executor |
| R15 | TestFlight review lag creates Worker vs. client version drift | Medium | Medium | `X-Tools-Version` header; backend supports 2 versions | Serve v1 tools to v1 clients; block v0 |
| R16 | Idempotency-key cleanup misses → D1 bloat | Low | Low | Cron every 5 min; alarm on >1M rows | Manual `DELETE` |
| R17 | Cold-start latency on new Worker isolate | Low | Low | Pre-warm endpoint; cache-control on `/ai-home/cards` | N/A |
| R18 | Mode-detection classifier misroutes (Haiku picks up a tool-heavy turn) | Low | Low | Re-route to Sonnet mid-turn on first tool_use; metric `model_reroute_rate` | Tune router heuristic |

---

## § 8 — Deployment Plan

> **Operator-run commands only. Never executed automatically.** Every phase shipping to production follows Backend → TestFlight → Rollout order.

### 8.1 Backend deploy sequence (all phases)

```bash
# 0) Baseline
cd backend
git status                                     # clean
npm install                                    # deps fresh
npm test                                       # all green

# 1) Migrations first (additive only) — dev-preview, then production
wrangler d1 migrations apply simple-house-dev-preview --env dev-preview
# Verify:
wrangler d1 execute simple-house-dev-preview --env dev-preview \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ai_%';"

# After 24h smoke on dev-preview:
wrangler d1 migrations apply simple-house-api --env production

# 2) Deploy Worker
wrangler deploy --env dev-preview-preview
wrangler tail --env dev-preview --format pretty &   # background
# smoke: curl https://simple-house-api-dev-preview.<subdomain>.workers.dev/ai-chat/capabilities \
#   -H "Authorization: Bearer <test-jwt>"

# Production:
wrangler deploy --env production

# 3) Seed flags (idempotent — safe to re-run)
./scripts/seed-ai-chat-flags.sh dev-preview
./scripts/seed-ai-chat-flags.sh production

# 4) Secrets (one-time; verify presence)
wrangler secret list --env production | grep -E "GEMINI_API_KEY|ANTHROPIC_API_KEY"
# If missing:
# wrangler secret put ANTHROPIC_API_KEY --env production
```

### 8.2 Frontend deploy sequence

```bash
# Phase 4+ requires dev-client build (Expo Go no longer works after react-native-webview install)
npm install
npx expo prebuild --clean
cd ios && pod install && cd ..

# Dev build for simulator:
npx expo run:ios

# TestFlight internal:
eas build --profile preview --platform ios
# After build uploads, promote via App Store Connect → TestFlight internal testers

# Production (after 1 week TestFlight soak):
eas build --profile production --platform ios
eas submit --profile production --platform ios
```

### 8.3 Deploy order for FE+BE coordination

Per-phase order (no window where old app talks to incompatible backend):

| Step | Action | Why |
|---|---|---|
| 1 | Backend migration applied (dev-preview → 24h → production) | Schema must exist before code references it |
| 2 | Backend Worker deployed (flag OFF, endpoints return `enabled:false`) | Endpoints exist but gated; old app unaffected |
| 3 | TestFlight build with new screens/transports (reads `capabilities.enabled`) | New clients behave correctly with flag off (show legacy) |
| 4 | Flag flipped ON for internal allowlist (`ai_chat_user_allowlist`) | Small blast radius |
| 5 | 1 week internal soak → expand to 1% → 10% → 50% → 100% | Metric-gated per Phase 8 |
| 6 | 2 weeks at 100% stable → remove flag checks | Code-simplification PR |

### 8.4 Post-deploy verification (per phase)

Before flagging ON for real users:
- `/ai-chat/capabilities` returns expected shape for a test JWT.
- `/ai-home/cards` returns valid payload for a test household (use a seeded dev account).
- `wrangler tail` shows `ai_chat_turn_completed` events with `cache_read_input_tokens > 0` after two identical queries.
- `wrangler d1 execute ... --command "SELECT COUNT(*) FROM ai_tool_audit;"` grows as expected.
- Dashboard (if Phase 7): CSP violations on `/ai-home/cards` headers (should be none).

---

## § 9 — Rollback Procedures

### 9.1 Per-phase rollback

| Phase | Rollback action |
|---|---|
| 0 | `wrangler kv key delete ...` for new keys; leave `dev-preview` Worker idle |
| 1 | Apply `.down.sql` (removes 6 tables); `wrangler deploy` with previous DO class name preserved (DO bindings cannot be removed) |
| 2 | `wrangler deploy` of previous commit; `ai.ts` resumes returning 410 harmlessly |
| 3 | `wrangler kv key put ai_chat_streaming_enabled false` → endpoint returns 503; RN falls back to legacy `/chat` |
| 4 | Remove `AssistantChatScreen` from navigation; old `ChatScreen` restored (if git-revertable) |
| 5 | Flip `assistant_home_enabled=false` → Home tab reverts to `HomeScreen` (widget grid) |
| 6 | Per-tool flag flip (`ai_tool_{name}_enabled=false`) to disable specific mutating tools without killing chat |
| 7 | Flip `ai_chat_html_enabled=false` → Dashboard mode still emits structured blocks; HTML rendering disabled |
| 8 | Shrink allowlist back; worst-case flip `ai_chat_killswitch.killed=true` |

### 9.2 Full rollback (nuclear option)

```bash
# 1. Kill switch (all users)
wrangler kv key put --binding=CONFIG_KV --env production \
  ai_chat_killswitch '{"killed":true,"reason":"rollback"}'
# User-visible within 60 s
# 2. Revert app via TestFlight: drop new binary; pin previous build.
# 3. If schema corruption suspected: apply .down.sql; redeploy old Worker.
```

### 9.3 Data rollback

- 6 new tables are **additive** — drop without affecting domain data.
- LOW_WRITE undo: every LOW_WRITE tool's `undo(args, ctx)` is called for all calls executed in the last 5 min via a forensic script (`backend/scripts/forensic-undo.ts`).
- HIGH_WRITE mutations are intentional (user-approved) — rollback is per-mutation, not automatic.
- Audit rows in `ai_tool_audit` are the forensic record; preserved during rollback.

---

## § 10 — Monitoring & Observability

### 10.1 Structured logs

Every Worker-side event writes a single JSON line to stdout:
```json
{"ts":"2026-04-22T12:34:56Z","event":"ai_chat_turn_completed","userId":"...","householdId":"...","sessionId":"...","turnId":"...","model":"claude-sonnet-4-5-20250929","input_tokens":1234,"output_tokens":500,"cache_read_input_tokens":1100,"wall_ms":1820,"tool_count":1,"mode":"chat"}
```

Pattern: `console.log(JSON.stringify({ts: new Date().toISOString(), event, ...fields}))`. No PII fields permitted (validated by a lint helper `sanitizeLogFields`).

### 10.2 Cloudflare Analytics Engine

Emit dimensional datapoints via `env.AE_DATASET.writeDataPoint(...)` (or logs consumed by an ingest Worker if AE not enabled). Metrics:
- `ai_chat_turn_wall_ms`
- `ai_chat_input_tokens`, `ai_chat_output_tokens`
- `ai_chat_cache_read_tokens`, `ai_chat_cache_creation_tokens`
- `ai_chat_tool_exec_ms`
- `ai_home_cards_wall_ms`, `ai_home_cards_partial_count`
- `ai_chat_error_count{code}`

### 10.3 Alerts (manual setup via Cloudflare dashboard after Phase 3)

| Metric | Threshold | Severity |
|---|---|---|
| p95 `ai_chat_turn_wall_ms` | > 15 s for 10 min | page |
| `ai_chat_error_count{code='AI_INTERNAL'}` | > 10/min | page |
| `ai_chat_error_count{code='AI_PROVIDER_ERROR'}` | > 30/min | warn |
| `ai_chat_killswitch_triggered` count | > 0 | Slack |
| `ai_chat_quota_exceeded` users per day | > 1% of MAU | Slack |
| `ai_home_cards_partial_count` | > 5% of requests | warn |
| cache hit rate (cache_read / total input tokens) | < 30% after 1 week warm | warn |

### 10.4 Analytics (Mixpanel frontend)

14 events per TRD §13. Wired in Phase 5 Task 5.7 and Phase 6.

### 10.5 Runbook

`documents/deployment/ai-chat-runbook.md` contains:
- Kill-switch flip command (per-user, per-mode, per-tool, global).
- Quota reset command.
- "JWT in log" incident response (rotate secret, invalidate all tokens, patch log line).
- "Ticket leak" response (rotate `JWT_SECRET`, force sign-out).
- `wrangler tail` filters for common debugging (`ai_chat_error_count > 0`, `cache hit rate < 20%`, `stuck pending tools > 5 min`).
- Dashboard links.

---

## § 11 — Definition of Done

### 11.1 Per phase

For each phase, the following must be TRUE before the phase is marked complete:
- All tasks in the phase's §4 subsection implemented.
- All tests listed in §6 for the phase pass locally AND in CI.
- Code review passed by at least 2 engineers (1 backend + 1 frontend if mixed).
- Security review for Phases 1, 3, 6, 7 — sign-off from `@security` channel.
- No new CRITICAL or HIGH items open in the Risk Assessment.
- Rollback procedure verified (dry-run).
- CloudWatch / Cloudflare dashboards show no new error patterns 24 h after deploy.
- Build compiles clean in Xcode (or `eas build` green) after every FE phase.
- RN `tsc --noEmit` has zero errors; backend `tsc --noEmit` zero errors.

### 11.2 Overall (v1.0 ship)

- [ ] All TRD §3 goals met; acceptance criteria verified in E2E checklist §6.7.
- [ ] All §15 test scenarios pass (unit + integration + FE).
- [ ] §6.5 security regression corpus passes with 0 failures.
- [ ] §6.6 performance targets met in prod-shape measurement.
- [ ] All 14 analytics events firing in Mixpanel production.
- [ ] Accessibility sign-off with VoiceOver + Reduce Motion.
- [ ] TestFlight internal: 20 users × 1 week with zero P0 bugs.
- [ ] Cloudflare 24 h clean: 0 `AI_INTERNAL` errors above baseline.
- [ ] Runbook published.
- [ ] Cost-budget dashboard live; daily spend projection < agreed envelope.
- [ ] Tool Parity Test green: every user action has a matching tool (or explicit `@ai-skip`).
- [ ] `allow_legacy_home=true` verified as working fallback.
- [ ] 2-week 100 % rollout with no alert page-outs.

---

## § 12 — Known Gaps & Future Work

| # | Gap | Severity | Tracked | Deferral reason |
|---|---|---|---|---|
| G1 | Staging Cloudflare DO block | High | Open Cloudflare ticket + `dev-preview` workaround | External dependency |
| G2 | Claude `thinking` mode for complex tool-chain reasoning | Medium | v1.1 | Premium feature; not required for MVP |
| G3 | Multi-household cross-context chat | Low | v1.2 | Single-household sufficient for v1.0 |
| G4 | Session auto-summarization at >20 messages | Medium | v1.1 | 20-turn cap sufficient for v1.0 |
| G5 | Android polish | Medium | v1.1 | iOS-first per D-06 |
| G6 | On-device LLM fallback for offline | Low | v2.0 | Cost/complexity outweighs benefit |
| G7 | HTML dashboard edit mode | Low | v2.0 | Display-only is sufficient |
| G8 | Push notifications for async tool approval | Medium | v1.1 | Modal-only approval for v1.0 |
| G9 | Legacy `/chat` endpoint deprecation | Low | v1.1 | Keep alive for back-compat 1 cycle |
| G10 | Voice TTS | Low | v2.0 | Voice input sufficient |
| G11 | Tool versioning beyond v1 | Low | v1.1 | One version in v1.0 |
| G12 | Orphaned `BudgetTimelineScreen` — not in any navigator today | Medium | Phase 5 navigation wire-up ADDS it via `open_budget` nav tool | Minor regression if flag off |
| G13 | `src/App.tsx` deep-link config bug (AcceptInvite wraps unrelated routes) | Medium | Fix as Phase 5 Task 5.6 hygiene | Avoid replicating |
| G14 | Dual `QueryClient` instances (one in `app/_layout.tsx`, one in `src/App.tsx`) | Low | Consolidate in Phase 5 | `src/App.tsx` is dead (expo-router is the active entry) |
| G15 | Anthropic cache TTL: 1h vs 5min tradeoff | Medium | Use 1h for system+tools (static), 5min for context (moves) | Acceptable cost |
| G16 | On-device encryption of MMKV chat history | Low | v2.0 | Existing MMKV stores unencrypted auth tokens already; tracked separately |
| G17 | Per-household daily token ceiling (reviewer S4) | Medium | v1.1 | Per-user cap sufficient for v1.0 launch; revisit after real usage data |
| G18 | Haiku fast-path + Opus dashboard-tier model routing | Medium | Phase 8 | Model family IDs pending Anthropic account verification; v1.0 ships Sonnet 4.5 baseline |
| G19 | DOMPurify-on-Workers + nonce-script preservation POC | High | Pre-Phase 7 | Must complete before any Phase 7 code is written; reviewer C5 |
| G20 | Tool-parity CI allowlist + `@ai-skip` decorator ESLint rule | Medium | Phase 6 | Downgrade to warning-only for first 4 weeks to avoid blocking unrelated route work |
| G21 | Per-tool context allowlist concrete table | Medium | Phase 3 Task 3.3 | Must be explicit before Phase 3 Claude streaming lands |
| G22 | SSE CPU-budget strategy — close-and-resume on HIGH_WRITE park, not hold-open | High | Phase 3 + Phase 6 | Prevents Workers 30s CPU overrun; also resolves DO hibernation issue |

---

## § 13 — Summary

Phase status table (update as phases complete).

| Phase | Name | Files (new/mod) | Risk | Status |
|---|---|---|---|---|
| 0 | Infrastructure, Flags, Staging | 4/2 | Low | 🔲 TODO |
| 1 | Schema + ToolRegistry + DO | 8/4 | Medium | 🔲 TODO |
| 2 | Read tools + Capabilities + Cards | 14/1 | Low | 🔲 TODO |
| 3 | SSE + Modes + Context + Claude streaming | 16/3 | High | 🔲 TODO |
| 4 | FE transport + chat store + AssistantChatScreen | 18/4 | Medium | 🔲 TODO |
| 5 | Assistant Home + voice + cards + tab swap | 17/3 | Medium | 🔲 TODO |
| 6 | Mutating tools + approval UX + parity test + audit | 19/5 | High | 🔲 TODO |
| 7 | LLM HTML dashboards (flagged) | 7/1 | High | 🔲 TODO |
| 8 | Rollout + flag cleanup | 0/0 (ops only) | Low | 🔲 TODO |

Legend: ✅ DONE · 🔲 TODO · 🔄 IN PROGRESS · ⚠️ BLOCKED

---

## Revision History

| Version | Date | Notes |
|---|---|---|
| v1.0 | 2026-04-22 | Initial. Integrates TRD v1.1 (Assistant Home primary + 5 modes + Claude tiered + prompt caching + structured UI blocks). Gemini legacy-only. react-native-webview reserved for Phase 7. |
| v1.1 | 2026-04-22 | 3-reviewer cycle: migration path, route base, Claude SDK upgrade, model ID, `VoiceRecordingService`, `HouseholdService.verifyAccess`, allowlist semantics, SSE parking v1 design. See §0.1. |
| v1.2 | 2026-04-22 | 26-correction cross-read pass: provider fully Claude, HIGH_WRITE close-and-reconnect (later retracted), killswitch fail-CLOSED, DOMPurify, tool-count unified, phase numbering unified, session CRUD, origin propagation, cards `meta` field, DO idFromName derivation. See §0.2. |
| v1.3 | 2026-04-22 | Audit-cycle reversions + TRD-completeness fixes: ticket TTL reverted to 30 s; HIGH_WRITE reverted to hold-open-with-keepalive; ANTHROPIC_API_KEY required in v1.0; DO id derivation actually implemented; `ai:prewarm` rate-limit bucket added; `send_contractor_message` removed; undo + prewarm endpoints documented in TRD §8; `ui_block` SSE event added to TRD §8.4; D-10/D-11/D-13 resolved. Tool count reconciled to **132**. See §0.0. |

**End of Implementation Plan v1.3.**
