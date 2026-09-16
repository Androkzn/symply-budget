# MCP-for-UI Port to SimpleHouse

## Context

The iOS sister project `step-ios-mcp` ships an AI-driven UI pattern (documented at [documents/features/MCP_UI_Architecture.md](/Users/andreitekhtelev/Desktop/SimpleHouse/documents/features/MCP_UI_Architecture.md)): a chat that streams tokens with a typewriter effect, lets the model emit HTML+Chart.js dashboards into a sandboxed WebView, and dispatches tool calls through a registry (`AIFunctionRegistry`) that mutates app state. SimpleHouse wants the same capability — an AI assistant that can answer questions, explain inspection reports with clickable citations, render live home-health dashboards, and perform actions (create a task, accept a suggestion, update preferences) on the user's behalf.

**Current state** (from codebase exploration):
- Backend SSE endpoint `POST /ai/chat/stream` already exists ([backend/src/routes/ai.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/backend/src/routes/ai.ts)) with Gemini streaming + 9 tools — but it is **orphaned**: the RN frontend calls a legacy non-streaming JSON endpoint ([src/api/chat.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/src/api/chat.ts), [backend/src/routes/chat.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/backend/src/routes/chat.ts)) that hardcodes a single home-inspection persona.
- No `react-native-webview`, no chart lib, no markdown renderer, no SSE client, no chat store. `ChatScreen` uses local `useState`.
- PDF citation infrastructure is already shipped (MEMORY.md): `TaskDrafts` carry `source_page_numbers`+`source_quotes`, [PDFViewerModal](/Users/andreitekhtelev/Desktop/SimpleHouse/src/components/reports/PDFViewerModal.tsx) renders at a target page with cache support.
- Tool executor is a 515-line switch ([backend/src/services/ai/tool-executor.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/backend/src/services/ai/tool-executor.ts)) with auto-approved mutations (the exact safety gap §8 of the reference doc flags).

**User decisions (confirmed)**:
- Full architecture port — all 5 modes, tailored to SimpleHouse's domain.
- LLM-authored HTML+Chart.js in WebView (mirror iOS) with hardened CSP + sanitizer.

**Intended outcome**: SimpleHouse ships a home-management AI assistant with five chat modes, ~30 tools, streaming text + LLM-authored dashboards, PDF-citation deep-links, and user-approval for mutating actions — closing the safety gap the reference doc left open.

---

## Target architecture

```
+--------------------- React Native (Expo 54) ---------------------+
| src/screens/chat/ChatScreen.tsx  (rewritten to use new store)    |
|   |-- components/chat/ModePicker.tsx                             |
|   |-- components/chat/MessageList.tsx                            |
|        |-- components/chat/ChatMessageBubble.tsx                 |
|             |-- components/chat/TypewriterText.tsx               |
|             |-- components/chat/DashboardWebView.tsx             |
|             |-- components/chat/PdfCitationChip.tsx              |
|             |-- components/chat/ToolApprovalCard.tsx             |
|   |-- components/chat/ChatInputBar.tsx                           |
|                                                                  |
| src/stores/chatStore.ts       (zustand + immer + MMKV persist)   |
|                                                                  |
| src/features/ai-chat/                                            |
|   modes/                    (ChatMode ids + UI metadata)         |
|   context/                  (dashboard + report snapshot builders)|
|   transport/sseClient.ts    (react-native-sse; carries ticket)   |
|   transport/chatApi.ts      (streamChat, submitToolResult)       |
|   tools/clientToolHandlers.ts  (nav hints, PDF deep-link)        |
|   tools/toolApprovalPolicy.ts  (mirror of backend risk table)    |
+------------------------------------------------------------------+
                              |
                              | HTTPS + SSE (?ticket=...)
                              v
+--------------------------- Hono Worker ---------------------------+
| routes/ai.ts                                                     |
|   POST /ai/chat/stream/ticket  -> short-lived ticket             |
|   POST /ai/chat/stream         -> SSE + approval resume          |
|   POST /ai/chat/tool-result    -> client approval callback       |
|                                                                  |
| services/ai/                                                     |
|   modes/                                                         |
|     ChatMode.ts, ChatModeRegistry.ts, BaseChatMode.ts            |
|     ChatMode.chat.ts          (general home Q&A)                 |
|     ChatMode.reportQa.ts      (report_id ctx; cite [p.N])        |
|     ChatMode.dashboard.ts     (emits HTML+Chart.js)              |
|     ChatMode.onboarding.ts    (household setup)                  |
|     ChatMode.taskAssistant.ts (task CRUD focus)                  |
|   tools/                                                         |
|     ToolDefinition.ts   (name, schema, risk, requiresApproval)   |
|     ToolRegistry.ts     (register, getForMode, execute)          |
|     risk.ts             (READ_ONLY | LOW_WRITE | HIGH_WRITE)     |
|     tasks.ts, reports.ts, household.ts, contractors.ts,          |
|     housekeeper.ts, navigation.ts, garbage.ts, notifications.ts  |
|   context/                                                       |
|     DashboardContextProvider.ts (D1 snapshot: tasks, findings,   |
|                                  budget, garbage, suggestions)   |
|     ReportContextProvider.ts    (report findings + metadata)     |
|     context-builder.ts          (PII allowlist, fence untrusted) |
|   dashboard-html/                                                |
|     templates.ts        (CSP wrapper, bundled Chart.js asset)    |
|     sanitizer.ts        (strip non-nonce scripts, on* attrs)     |
|   gemini-service.ts     (accepts per-call systemPrompt+tools)    |
|                                                                  |
| durable-objects/rate-limiter.ts  (already exists; wire new keys) |
| db/schema-chat.ts               (new: ai_chat_sessions,          |
|                                  ai_tool_pending, ai_tool_audit) |
+------------------------------------------------------------------+
```

**Request schema** (`POST /ai/chat/stream`):
```jsonc
{
  "mode": "chat" | "report_qa" | "dashboard" | "onboarding" | "task_assistant",
  "message": "...",
  "sessionId": "uuid",
  "context": { "reportId?": "...", "taskId?": "...", "dashboardSnapshot?": {...} }
}
```

**SSE event types** (additive):
```jsonc
{"type":"text","content":"..."}                       // token
{"type":"html_chunk","content":"..."}                 // dashboard stream
{"type":"function_call","data":{"id","name","args","requiresApproval"}}
{"type":"tool_call_pending","data":{"pendingId","name","args"}}  // HIGH_WRITE
{"type":"function_result","data":{"id","result"}}
{"type":"navigation_hint","data":{"action","params"}}
{"type":"citation","data":{"reportId","page","quote"}}
{"type":"done","structuredData":{"htmlContent?","citations?"}}
{"type":"error","message":"..."}
{"type":"auth_expired"}                               // refresh + reconnect
```

---

## Phased delivery

### Phase 1 — Backend mode + tool registry refactor

**CREATE**
- `backend/src/services/ai/modes/ChatMode.ts` — interface: `id`, `buildSystemPrompt(ctx)`, `allowedTools: string[]`, `supportsHtmlOutput`, `postProcess?`.
- `backend/src/services/ai/modes/ChatModeRegistry.ts` — `register`/`resolve`/`list`.
- `backend/src/services/ai/modes/BaseChatMode.ts` — shared helpers (user/household header, tool catalogue rendering).
- `backend/src/services/ai/modes/ChatMode.chat.ts` — general home Q&A; READ_ONLY + LOW_WRITE tools.
- `backend/src/services/ai/modes/ChatMode.reportQa.ts` — requires `context.reportId`; READ only; instructs to cite `[p.N]`; folds in existing `chat-service.ts` prompt.
- `backend/src/services/ai/modes/ChatMode.dashboard.ts` — `supportsHtmlOutput: true`; prompt fences output in `<html-dashboard>…</html-dashboard>`; `postProcess` extracts and runs through sanitizer + CSP wrapper.
- `backend/src/services/ai/modes/ChatMode.onboarding.ts` — guided household setup.
- `backend/src/services/ai/modes/ChatMode.taskAssistant.ts` — task-focused, all mutations HIGH_WRITE.
- `backend/src/services/ai/tools/ToolDefinition.ts` — `{name, description, parameters, category, risk, requiresApproval, execute(ctx)}`.
- `backend/src/services/ai/tools/ToolRegistry.ts` — register/getForMode/execute; enforces per-mode allowlist.
- `backend/src/services/ai/tools/risk.ts` — risk classification table (see Security).
- `backend/src/services/ai/tools/tasks.ts` — `listTasks`, `getTask`, `createTask`, `completeTask`, `updateTask`, `deleteTask`, `listSubtasks`, `listTaskDrafts`, `convertDraftToTask`.
- `backend/src/services/ai/tools/reports.ts` — `listReports`, `getReport`, `getFindings`, `getReportSummary`, `getPdfUrl`.
- `backend/src/services/ai/tools/household.ts` — `getProfile`, `updateProfile`, `listMembers`, `invitePerson`.
- `backend/src/services/ai/tools/contractors.ts` — `listContractors`, `getContractor`, `sendMessage`, `requestQuote`, `compareQuotes`.
- `backend/src/services/ai/tools/housekeeper.ts` — `listSuggestions`, `acceptSuggestion`, `dismissSuggestion`, `snoozeSuggestion`, `triggerAnalysis`, `updatePreferences`.
- `backend/src/services/ai/tools/navigation.ts` — emit-only: `openTaskDetail`, `openReportDetail`, `openPdfAtPage`, `openContractorDetail`, `openAiInsights`.
- `backend/src/services/ai/tools/garbage.ts`, `backend/src/services/ai/tools/notifications.ts` — wrap existing switch branches.
- `backend/src/services/ai/context/DashboardContextProvider.ts` — pulls overdue tasks, findings-by-severity, budget totals, upcoming garbage, unread housekeeper suggestions from D1.
- `backend/src/services/ai/context/ReportContextProvider.ts` — report + findings when `reportId` present.
- `backend/src/services/ai/context/context-builder.ts` — PII allowlist + `<<UNTRUSTED_REPORT_CONTENT>>…<<END>>` fences.
- `backend/src/services/ai/dashboard-html/templates.ts` — `<!DOCTYPE html>` wrapper with CSP meta-tag (nonce per render), bundled Chart.js script (not CDN), theme tokens.
- `backend/src/services/ai/dashboard-html/sanitizer.ts` — strips scripts without the request nonce, all `on*` attrs (keep bridge `data-action`), iframes.
- `backend/src/services/ai/dashboard-html/chart.umd.min.js` — bundled Chart.js asset; imported as a string at build time.
- `backend/src/db/schema-chat.ts` — `aiChatSessions(id, userId, householdId, mode, history, createdAt, updatedAt)`, `aiToolPending(id, sessionId, toolName, args, createdAt, expiresAt)`, `aiToolAudit(id, userId, householdId, toolName, argsRedacted, resultHash, createdAt)`.
- Migration for the three new tables.

**MODIFY**
- [backend/src/services/ai/gemini-service.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/backend/src/services/ai/gemini-service.ts) — accept `allowedTools: FunctionDeclaration[]` + `systemPrompt` per call; raise `safetySettings` from `BLOCK_NONE` to `BLOCK_LOW_AND_ABOVE` for dangerous content.
- [backend/src/routes/ai.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/backend/src/routes/ai.ts) — accept `mode`/`context`/`sessionId`; resolve mode via registry; build context via providers; after stream completes, run `postProcess` and emit terminal `done` with `structuredData`; add `POST /ai/chat/stream/ticket` (30s single-use) and `POST /ai/chat/tool-result` (approval resume).
- [backend/src/services/ai/tool-executor.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/backend/src/services/ai/tool-executor.ts) — shrink to thin adapter over `ToolRegistry.execute`; remove `householdId` from tool args (rebind server-side from JWT membership).
- [backend/src/services/ai/tools/index.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/backend/src/services/ai/tools/index.ts) — replace static array with `buildRegistry()` composing the per-category files.
- [backend/src/middleware/auth.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/backend/src/middleware/auth.ts) — remove token-prefix logging (lines ~37/43/55).
- [backend/src/middleware/rate-limit.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/backend/src/middleware/rate-limit.ts) — add `ai:stream` (20/hr/user), `ai:tool_call` (200/hr/user), `ai:tokens_daily` (500k/day/user) wired through the existing `rate-limiter.ts` Durable Object.

### Phase 2 — Frontend transport, store, API

**CREATE**
- `src/features/ai-chat/transport/sseClient.ts` — wraps `react-native-sse` with Bearer→ticket exchange, auto-reconnect, typed `AsyncGenerator<ChatEvent>`.
- `src/features/ai-chat/transport/chatApi.ts` — `getTicket`, `streamChat`, `submitToolResult`, `listSessions`.
- `src/features/ai-chat/modes/types.ts` — `ChatMode` union + metadata.
- `src/features/ai-chat/modes/registry.ts` — UI metadata (title, icon, greeting, placeholder per mode).
- `src/features/ai-chat/context/dashboardContextProvider.ts` — assembles client snapshot from `useTaskStore`, `useReportStore`, `useMaintenanceSuggestionsStore`, `useHouseholdStore` (optional overlay to server provider).
- `src/features/ai-chat/context/reportContextProvider.ts` — reads `useReportStore` for `reportId` context.
- `src/features/ai-chat/tools/clientToolHandlers.ts` — dispatches `navigation_hint` to React Navigation via `navigationRef`; opens `PDFViewerModal` via store flag for `openPdfAtPage`.
- `src/features/ai-chat/tools/toolApprovalPolicy.ts` — client-side mirror of backend risk table.
- `src/lib/ai/navigationDispatcher.ts` — hardcoded screen allowlist + per-screen Zod validator.
- `src/stores/chatStore.ts` — zustand + immer + MMKV persist (via [src/stores/authStore.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/src/stores/authStore.ts) pattern). State: `sessions: Record<id, ChatSession>`, `currentSessionId`, `mode`, `isStreaming`, `streamingText`, `streamingHtml`, `pendingToolCalls[]`, `citations[]`. Actions: `newSession`, `appendUserMessage`, `beginStream`, `appendChunk`, `appendHtmlChunk`, `onFunctionCall`, `resolveFunctionCall`, `onNavigationHint`, `finalize`, `clearSession`. Persist last 3 sessions.

**MODIFY**
- [src/api/chat.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/src/api/chat.ts) — keep legacy methods for back-compat; re-export new streaming API.
- [src/stores/index.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/src/stores/index.ts) — export `useChatStore`.
- [src/config/env.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/src/config/env.ts) — add `FEATURES.AI_CHAT_MODES: {chat,report_qa,dashboard,onboarding,task_assistant: boolean}`, `AI_CHAT_APPROVAL_REQUIRED: true`, `AI_CHAT_ENABLED` kill switch.
- `package.json` — add `react-native-webview` (Expo-compatible), `react-native-sse`, `react-native-markdown-display`.

### Phase 3 — Chat UI shell + streaming text

**CREATE**
- `src/components/chat/ChatMessageBubble.tsx` — routes to `TypewriterText | DashboardWebView | ToolApprovalCard | PdfCitationChip | MarkdownBlock` based on message parts.
- `src/components/chat/TypewriterText.tsx` — per-char animation via `react-native-reanimated`; static fallback.
- `src/components/chat/MessageList.tsx` — `FlatList` + auto-scroll (throttled 100ms) + thinking shimmer.
- `src/components/chat/ChatInputBar.tsx` — text input + send + mode pill + voice (deferred).
- `src/components/chat/ModePicker.tsx` — bottom sheet switcher for feature-flagged modes.
- `src/components/chat/PdfCitationChip.tsx` — tappable `[report title · p.12]` that opens `PDFViewerModal` at the cited page using existing `reportsApi.getPdfUrl` + `pdfCache`.

**MODIFY**
- [src/screens/chat/ChatScreen.tsx](/Users/andreitekhtelev/Desktop/SimpleHouse/src/screens/chat/ChatScreen.tsx) — full rewrite: consume `useChatStore`, wire `streamChat` generator to store actions, render `MessageList`+`ChatInputBar`+`ModePicker`; accept optional `reportId`/`mode` routing params.
- [src/navigation/MainNavigator.tsx](/Users/andreitekhtelev/Desktop/SimpleHouse/src/navigation/MainNavigator.tsx), [src/navigation/types.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/src/navigation/types.ts) — expose Chat as a tab or top-level stack; entry points from home + report detail.

### Phase 4 — Dashboard WebView + HTML streaming

**CREATE**
- `src/components/chat/DashboardWebView.tsx` — hardened WebView:
  - `originWhitelist={['about:blank']}`, `source={{html, baseUrl: undefined}}`
  - `javaScriptEnabled={true}`, `allowFileAccess={false}`, `allowUniversalAccessFromFileURLs={false}`, `mixedContentMode='never'`, `setSupportMultipleWindows={false}`
  - `onShouldStartLoadWithRequest` → false for anything except `about:blank`
  - Injected `ResizeObserver` bridge posts `{type:'resize', px}` to `onMessage`
  - Click dispatcher posts `{type:'dashboardAction', action, payload}` — validated via Zod against an action allowlist
  - Props: `html`, `onHeight`, `onAction`

**MODIFY**
- `ChatMessageBubble.tsx` — when `message.htmlContent` present, embed `DashboardWebView`; route `onAction` through the same `clientToolHandlers` pipeline as `navigation_hint`.
- `ChatMode.dashboard.ts` — sanitize + wrap HTML before emitting terminal `structuredData.htmlContent`.

### Phase 5 — Tool approval UI + feature flag + audit

**CREATE**
- `src/components/chat/ToolApprovalCard.tsx` — renders pending function call ("AI wants to *create task* 'Replace HVAC filter' — Approve / Edit / Reject"); editable arg form; on approve POSTs to `/ai/chat/tool-result`.
- `src/features/ai-chat/hooks/useClientToolDispatcher.ts` — subscribes to `chatStore.pendingToolCalls` + `navigationHints`; fires React Navigation calls / modal opens through the allowlist dispatcher.

**MODIFY**
- `backend/src/routes/ai.ts` — implement approval resume: on approval, pull session from `aiChatSessions`, execute tool via registry, append `functionResponse` to history, re-enter `gemini.chat.sendMessageStream` for the follow-up turn.
- `backend/src/services/ai/tools/ToolRegistry.ts` — when `risk === HIGH_WRITE` and `AI_CHAT_APPROVAL_REQUIRED`, persist args to `aiToolPending` and return `pending_approval` sentinel instead of executing.
- Write audit row in `aiToolAudit` on every executed tool call (args PII-redacted per tool's field allowlist).

---

## Security must-fix list (ship-blockers)

Each maps into the phases above; none optional.

1. **Risk-classified tool registry** (Phase 1) — `READ_ONLY` auto, `LOW_WRITE` auto + undo token, `HIGH_WRITE` requires confirmation. File: `backend/src/services/ai/tools/risk.ts`.
2. **Per-mode tool allowlist** (Phase 1) — `report_qa` = READ only; `dashboard` = READ; `task_assistant` = READ + LOW + HIGH_WRITE for tasks only; etc.
3. **HouseholdId never a tool arg** (Phase 1) — strip from all `FunctionDeclaration` schemas; rebind server-side from JWT membership. Runtime assertion in `ToolRegistry.execute`.
4. **Bundled Chart.js + CSP wrapper** (Phase 4) — no CDN; `default-src 'none'; script-src 'nonce-<rnd>' 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'`.
5. **Locked WebView props + deny-by-default navigation** (Phase 4) — see `DashboardWebView.tsx` props above.
6. **Zod-validated postMessage bridge + screen allowlist** (Phase 2, 4) — `navigationDispatcher.ts` + bridge validator.
7. **Ticket-based SSE auth** (Phase 1, 2) — `POST /ai/chat/stream/ticket` returns 30s single-use ticket; SSE endpoint accepts `?ticket=...`. Remove JWT from URL; remove token-prefix logs.
8. **DO-backed rate limits** (Phase 1) — `ai:stream` 20/hr/user, `ai:tool_call` 200/hr/user, `ai:tokens_daily` 500k/day/user.
9. **Audit log with PII-redacted args** (Phase 5) — `aiToolAudit` table; per-tool field allowlist.
10. **Untrusted-content fencing + PII allowlist in prompts** (Phase 1) — `context-builder.ts`.
11. **Gemini `safetySettings` raised** (Phase 1) — from `BLOCK_NONE` to `BLOCK_LOW_AND_ABOVE` for dangerous content.

---

## Reuse map (do NOT rebuild)

| Reuse | Where |
| --- | --- |
| `stream()` SSE framing from `hono/streaming` | [backend/src/routes/ai.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/backend/src/routes/ai.ts) |
| `GeminiService.streamChat` | [backend/src/services/ai/gemini-service.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/backend/src/services/ai/gemini-service.ts) — extend signature only |
| Existing tool-executor DB dispatch logic | [backend/src/services/ai/tool-executor.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/backend/src/services/ai/tool-executor.ts) — split into tool modules, keep SQL |
| ChatService prompt + report-context builder | Fold into `ChatMode.reportQa.ts` |
| `AiHousekeeperService` (suggestions/predictions/checklist/insights) | Call from `tools/housekeeper.ts` |
| `reportsApi.getPdfUrl` + `pdfCache` + `PDFViewerModal` | `PdfCitationChip.tsx` deep-link |
| Zustand+immer+persist pattern from [src/stores/authStore.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/src/stores/authStore.ts) | Template for `chatStore.ts` |
| Domain stores (task/report/household/suggestions) | `dashboardContextProvider.ts` |
| `authMiddleware` + rate-limit DO | `/ai/chat/stream` + `/ai/chat/tool-result` |

---

## Trade-offs (called out, decisions locked)

1. **WebView HTML vs native cards** — WebView, mirrors reference, defended by CSP+sanitizer (locked per user choice).
2. **Single SSE endpoint with `mode` param vs per-mode endpoints** — single endpoint; we're on one Worker, branching server-side is cheaper and reuses middleware.
3. **Auto-approve vs user confirmation for mutations** — confirmation for HIGH_WRITE (fixes the §8 gap the reference doc flagged as prod-blocker).
4. **Separate `chatStore` vs extend `messageStore`** — separate; `messageStore` is contractor human messaging, co-mingling breaks the reducer.
5. **Client-side DashboardContextProvider vs server pull** — server is source-of-truth; client snapshot is optional optimistic overlay.
6. **Streaming HTML chunks vs terminal-only HTML** — start terminal-only (matches reference); add `html_chunk` streaming in a follow-up once stable.
7. **Sessions in D1 vs DO vs KV** — D1 (new `aiChatSessions` table) with 30-day retention; simpler than DO and we already have the drizzle stack.
8. **`react-native-sse` vs fetch-stream via `react-native-blob-util`** — `react-native-sse`; SSE framing + reconnect is non-trivial and this is a 200-LOC saving with a fixed backend format.

---

## MVP cut-line (optional narrower first cut)

If initial delivery needs to compress to ~1 week, ship Phases 1–3 and 5 *without* dashboard mode:

- **Modes**: `chat`, `report_qa`, `task_assistant` only.
- **Tools**: the existing 9 + `report_qa_citation` + `getFindings` + `getPdfUrl` + `listTaskDrafts` + `convertDraftToTask` (14 total).
- **UI**: streaming text + markdown + `PdfCitationChip` + `ToolApprovalCard`. No `DashboardWebView`.
- **Still ship all 11 security must-fixes**.

Phase 4 (Dashboard WebView) and remaining tool modules land as a follow-up release. This slice is independently demo-worthy and preserves the architecture for expansion.

---

## Critical files for implementation

**Backend**
- [backend/src/routes/ai.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/backend/src/routes/ai.ts) *(modify: mode/context, ticket, tool-result)*
- [backend/src/services/ai/gemini-service.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/backend/src/services/ai/gemini-service.ts) *(modify: per-call tools + safety)*
- [backend/src/services/ai/tool-executor.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/backend/src/services/ai/tool-executor.ts) *(shrink to registry adapter)*
- `backend/src/services/ai/modes/*` *(new mode registry + 5 modes)*
- `backend/src/services/ai/tools/*` *(new ToolRegistry + 8 tool files + risk table)*
- `backend/src/services/ai/context/*` *(new dashboard/report/prompt builders)*
- `backend/src/services/ai/dashboard-html/*` *(new sanitizer + CSP template + bundled Chart.js)*
- `backend/src/db/schema-chat.ts` *(new tables)*
- [backend/src/middleware/auth.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/backend/src/middleware/auth.ts), [backend/src/middleware/rate-limit.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/backend/src/middleware/rate-limit.ts) *(modify: logging + DO limits)*

**Frontend**
- [src/screens/chat/ChatScreen.tsx](/Users/andreitekhtelev/Desktop/SimpleHouse/src/screens/chat/ChatScreen.tsx) *(rewrite)*
- [src/api/chat.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/src/api/chat.ts) *(extend)*
- [src/config/env.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/src/config/env.ts) *(modify: feature flags)*
- [src/stores/index.ts](/Users/andreitekhtelev/Desktop/SimpleHouse/src/stores/index.ts) *(modify: export chatStore)*
- `src/stores/chatStore.ts` *(new)*
- `src/components/chat/*` *(new: 7 components)*
- `src/features/ai-chat/*` *(new: modes, transport, context, tools)*
- `src/lib/ai/navigationDispatcher.ts` *(new)*
- `package.json` *(add: react-native-webview, react-native-sse, react-native-markdown-display)*

---

## Verification

**Per-mode manual E2E** (dev Worker + Expo client):

- **chat** — "What should I check before winter?" streams a markdown response; no tools invoked.
- **report_qa** — open from `ReportDetail`; ask "What was the most serious finding?" → response contains a `PdfCitationChip` that opens `PDFViewerModal` at the cited page using the existing cache.
- **dashboard** — from home, "Show me my month" → terminal event renders HTML in `DashboardWebView`; Chart.js draws a bar chart; tapping a bar dispatches `openTaskDetail`.
- **onboarding** — new user, no household → "Set up my home" → model calls `addHousehold`, `ToolApprovalCard` shows, tap Approve, D1 row created, next turn calls `addGarbageSchedule`.
- **task_assistant** — "Create a task to change the furnace filter every 3 months" → approval card with editable fields → approve → `createTask` executes, task appears in `useTaskStore` after cache invalidation.

**Automated**
- Backend jest: `ToolRegistry` register/dispatch/allowlist (new `__tests__/services/ai/tools/registry.test.ts`).
- Backend jest: sanitizer strips non-nonce scripts, preserves Chart.js data-attrs.
- Backend jest: `householdId` is rejected as tool arg at runtime.
- Frontend jest: `chatStore` transitions across streaming → function_call → approval → function_result → done.

**Manual security checks**
- `curl -N` against dev `/ai/chat/stream` with a prompt-injected "ignore previous instructions" report → model must not call HIGH_WRITE tools without approval.
- Emit HTML with `<script src="https://attacker/">` from the LLM path → WebView must block (CSP violation visible in devtools).
- Confirm SSE URL carries `?ticket=` not `?token=`; confirm token-prefix log lines are gone.
- Confirm rate-limit 429 after 21 streams in an hour.

**Performance**
- Dashboard context JSON < 10 KB.
- SSE first-token latency < 2 s.
- Dashboard HTML render < 3 s on a mid-tier iPhone.
- Memory < 200 MB during a multi-chart dashboard render.

**Cross-platform**
- iOS simulator + device (primary).
- Android emulator + device — smoke-test mode switches + streaming + one tool call + one dashboard render.
