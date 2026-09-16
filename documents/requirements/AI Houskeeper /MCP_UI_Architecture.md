# MCP for UI — Current Architecture

**Branch:** `mcp-poc`
**Status as of:** 2026-04-22
**Audience:** iOS engineers, Lambda engineers, tech leads reviewing the POC before stabilization.

---

## 0. Terminology — what "MCP" means here

The working directory is `step-ios-mcp` and the branch is `mcp-poc`, but the iOS runtime does **not** implement Anthropic's Model Context Protocol. There is no `mcp-swift-sdk` dependency, no stdio/JSON-RPC transport, no MCP server or client in Swift.

There are two distinct things that carry the "MCP" label:

| Thing | Where | What it actually is |
| --- | --- | --- |
| [.mcp.json](../../.mcp.json) | Repo root | Dev-time Model Context Protocol config. Tells Claude Code / Cursor to spawn `cursor-talk-to-figma-mcp` via `bunx`. Never loaded by the app. |
| `mcp-poc` branch / "MCP for UI" | Branch name, internal usage | The **AI Dashboard POC**: an LLM that streams HTML+Chart.js visualizations into a sandboxed `WKWebView` plus a function-calling registry that lets the model mutate app state. |

The rest of this document describes option 2 — the AI-driven UI system on `mcp-poc`. When the term "MCP" appears below it refers to that system, not to the protocol.

---

## 1. One-paragraph summary

The user sends a message from a SwiftUI chat view. `ChatModeManager` picks a mode strategy (`.chat`, `.onboarding`, `.logActivity`, `.dashboard`, `.geminiDashboard`). For dashboard modes, `DashboardDataProvider` gathers HealthKit, activity-journal, and weekly-target data into a JSON context. `StreamingChatService` signs an HTTP POST with AWS SigV4 (Cognito credentials) to a Lambda Function URL and reads an SSE response. Text chunks render with a typewriter effect; a terminal `complete` event may carry `structuredData.htmlContent`, which `DashboardWebView` loads into a `WKWebView`. If the model returns a `functionCall`, `AIFunctionRegistry` dispatches to one of 11 Swift functions (profile updates, navigation, data queries, activity logging) and sends the result back to the model.

---

## 2. High-level diagram

```
        +---------------------- iOS app -----------------------+
        |                                                      |
        |  OpenConversationChatView                            |
        |    |-- ChatInputBar  (send)                          |
        |    |-- ChatMessageBubble                             |
        |         |-- (optional) DashboardWebView (WKWebView)  |
        |                                                      |
        |  AIChatbotService  (ObservableObject, @Published)    |
        |    |                                                 |
        |    v                                                 |
        |  ChatModeManager.generateResponse()                  |
        |    |-- ChatModeRegistry --> ChatModeProtocol impl    |
        |    |-- DashboardDataProvider (if dashboard mode)     |
        |    v                                                 |
        |  StreamingChatService                                |
        |    |-- AWS SigV4 sign (Cognito creds)                |
        |    |-- HTTP POST -> Lambda Function URL              |
        |    |-- SSE parser -> @Published streaming text       |
        |    v                                                 |
        |  AIFunctionRegistry (on functionCall chunks)         |
        |    |-- 11 registered AIFunctions                     |
        +----|-------------------------------------------------+
             |
             | (signed HTTPS + SSE)
             v
        +----------------------- AWS ---------------------------+
        | dev:                                                 |
        |   AIDashboardLambda    (Claude, HTML+Chart.js)       |
        |   AIDashboardStream    (Gemini 2.5 Flash)            |
        | stg/prod:                                            |
        |   LLMchat3 (Amplify)  — fallback for all modes       |
        +------------------------------------------------------+
```

---

## 3. Module layout

All Swift code lives in `step/Services/AIChat/`. The watchOS target has no MCP-related code.

```
step/Services/AIChat/
  AIChat.swift                         # Module doc header
  Core/
    AIChatService.swift                # Facade used by views
    ChatSessionManager.swift           # Session lifecycle
    ChatContextBuilder.swift           # Assembles ChatModeContext
    ChatResponseProcessor.swift        # Post-processes LLM output
  Modes/
    ChatModeProtocol.swift             # Strategy protocol (~420 loc)
    ChatModeManager.swift              # Central orchestrator
    ChatModeRegistry.swift             # Name -> mode resolution
    BasicChat/
      BasicChatMode.swift              # Default conversational mode
      BasicChatPrompts.swift
    Dashboard/
      DashboardChatMode.swift          # Anthropic Claude dashboard
      GeminiDashboardChatMode.swift    # Gemini 2.5 Flash dashboard
    Onboarding/
      OnboardingChatMode.swift
  Functions/
    AIFunctionProtocol.swift           # Tool contract
    AIFunctionRegistry.swift           # Registration + dispatch (~371 loc)
    Profile/ProfileFunctions.swift     # update_name/age/weight/height/goals/gender, get_current_goals
    Navigation/NavigationFunctions.swift  # start_workout_session, open_profile
    Data/DataQueryFunctions.swift      # get_weekly_progress, get_recent_activities, search_workouts
    Activity/ActivityFunctions.swift   # log_activity, match_activity, get_activity_suggestions
  Prompts/
    PromptBuilder.swift
    SystemPrompts.swift
    PromptComponents.swift
  Context/
    UserContextProvider.swift
  Models/
    ChatModeTypes.swift                # Extended response types
  DashboardDataProvider.swift          # Builds dashboardContext JSON
  StreamingChatService.swift           # SSE + SigV4 transport
```

UI surfaces live in `step/Views/Chat/`:

| View | Modes that render it | Responsibility |
| --- | --- | --- |
| [OpenConversationChatView](../../step/Views/Chat/OpenConversationChatView.swift) | `.chat`, `.logActivity`, `.quickAnswer` | Main chat screen |
| [OnboardingChatView](../../step/Views/Chat/OnboardingChatView.swift) | `.onboarding` | Onboarding / profile-setup chat |
| [ChatLandingView](../../step/Views/Chat/ChatLandingView.swift) | all | Mode selection + greeting |
| [DashboardWebView](../../step/Views/Chat/DashboardWebView.swift) | `.dashboard`, `.geminiDashboard` | `WKWebView` that renders HTML+Chart.js, auto-sizes, and bridges clicks back as `DashboardAction` |
| [ChatMessageBubble](../../step/Views/Chat/ChatMessageBubble.swift) | all | Text bubble, streaming, inline pickers, embeds `DashboardWebView` when `htmlContent` is present |
| [ChatInputBar](../../step/Views/Chat/ChatInputBar.swift) | all | Text entry + send + voice |
| [GreetingBubble](../../step/Views/Chat/GreetingBubble.swift) | all | First assistant message |

---

## 4. Chat mode strategy

`ChatMode` is a Swift enum (in `step/Services/AIChat/Models/ChatModels.swift`) with these cases in current use: `.chat`, `.logActivity`, `.quickAnswer`, `.onboarding`, `.dashboard`, `.geminiDashboard`.

`ChatModeProtocol` is the strategy contract. Each implementation declares:

- The system prompt (`buildSystemPrompt(context:)`).
- Which tools the model is allowed to call.
- Which Lambda URL to hit (dashboard modes override the default chat URL in dev).
- How to post-process the response (plain text, navigation bubbles, suggested replies, HTML).

`ChatModeRegistry` maps a mode id to the concrete protocol implementation; `ChatModeManager` is the single entry point views call:

```swift
let response = try await ChatModeManager.shared.generateResponse(
    for: message,
    mode: .dashboard,
    context: ChatModeContext(...)
)
```

---

## 5. Transport — StreamingChatService

File: [step/Services/AIChat/StreamingChatService.swift](../../step/Services/AIChat/StreamingChatService.swift)

**Protocol.** HTTP POST with a Server-Sent Events response body. The service reads `text/event-stream` line-by-line, parses each `data:` JSON payload, and publishes deltas through `@Published` properties (`isStreaming`, `currentStreamingText`).

**Auth.** AWS SigV4. Temporary credentials come from the Cognito identity pool configured by Amplify. No static API keys live on the client.

**Request body.**

```swift
struct StreamingInput: Codable {
    let message: String
    let userId: String
    let sessionId: String?
    let channelType: String?
    let dashboardContext: String?   // only for dashboard modes
}
```

**Response events.** Two event shapes observed today:

```jsonc
// Incremental token
{
  "type": "chunk",
  "text": "Here are your ",
  "fullText": "Here are your "
}

// Terminal event, optionally carrying structured output
{
  "type": "complete",
  "message": "Here are your workouts this week.",
  "structuredData": {
    "htmlContent": "<!DOCTYPE html>...<canvas>...</canvas>..."
  },
  "functionCall": { "name": "log_activity", "arguments": { ... } }  // optional
}
```

The service accumulates text for typewriter rendering, then on `complete` hands off to `AIChatService` which:
1. Updates the `LocalChatMessage` with final text and optional `htmlContent`.
2. If `functionCall` is present, invokes `AIFunctionRegistry.execute(...)` and posts the result back as a follow-up message.

---

## 6. Endpoints by environment

Defined in [step/Utils/EnvironmentConfig.swift](../../step/Utils/EnvironmentConfig.swift) (~lines 164–201).

| Environment | Mode | Lambda | URL |
| --- | --- | --- | --- |
| dev | `.chat`, `.logActivity`, `.onboarding`, `.quickAnswer` | `LLMchat3` (Amplify) | `https://z3o2pglksnzb2hobdzezc7tzq40gxyye.lambda-url.us-east-2.on.aws/` |
| dev | `.dashboard` | `AIDashboardLambda` (standalone) | `https://cdi6ijfs7hlqbkjifchreophzy0pdjdv.lambda-url.us-east-2.on.aws/` |
| dev | `.geminiDashboard` | `AIDashboardStream` (standalone) | `https://ntp55wwryhaklfez4lfhyhmvsi0glpar.lambda-url.us-east-2.on.aws/` |
| stg, prod | all modes | `LLMchat3` | `chatStreamingLambdaURL` |

The two dashboard Lambdas are only deployed to dev. In stg/prod every mode falls back to the chat Lambda, so dashboard output is effectively dev-only today.

Lambda source (for the dev-only dashboards): [Scripts/AIDashboardLambda/README.md](../../Scripts/AIDashboardLambda/README.md).

---

## 7. Dashboard context assembly

File: [step/Services/AIChat/DashboardDataProvider.swift](../../step/Services/AIChat/DashboardDataProvider.swift) (~316 loc).

When a dashboard mode is active, `DashboardDataProvider.gatherContextJSON()` produces a JSON string passed as `dashboardContext` on the request:

```swift
struct DashboardContextPayload: Codable {
    let healthMetrics: DashboardHealthMetrics?   // steps, calories, resting HR, daily breakdown
    let workouts: [DashboardWorkout]             // with HR samples
    let activityJournals: [DashboardActivity]    // duration, pillar, intensity
    let weeklyTarget: DashboardWeeklyTarget?     // targets vs actuals
    let profile: DashboardProfile?               // displayName only today
}
```

Known gap: `profile` currently only populates `displayName`. Age / gender / height / weight return nil (see comments around lines 301–314). Lambda prompts compensate by asking the user for missing fields when needed.

---

## 8. Function calling (the "tools")

File: [step/Services/AIChat/Functions/AIFunctionRegistry.swift](../../step/Services/AIChat/Functions/AIFunctionRegistry.swift) (~371 loc).

`AIFunctionProtocol` is the contract. Each function declares its name, a JSON-schema-style parameter definition, and an `execute(parameters:) async throws -> AIFunctionResult` body.

**Current registry (11 functions):**

| Name | Category | Parameters | Effect |
| --- | --- | --- | --- |
| `update_name` | Profile | `name: string` | Writes to user profile |
| `update_age` | Profile | `age: integer` | Writes to user profile |
| `update_weight` | Profile | `weight: number` | Writes to user profile |
| `update_height` | Profile | `height: number` | Writes to user profile |
| `update_gender` | Profile | `gender: enum(M,F,Other)` | Writes to user profile |
| `update_goals` | Profile | `goals: [string]` | Writes goals array |
| `get_current_goals` | Profile | — | Reads goals |
| `start_workout_session` | Navigation | `type: string` | Pushes workout flow |
| `open_profile` | Navigation | — | Navigates to profile |
| `get_weekly_progress` | Data | — | Cardio / strength / mobility breakdown |
| `get_recent_activities` | Data | — | Recent activity list |
| `search_workouts` | Data | `query: string` | Catalog search |
| `log_activity` | Activity | activity fields | Creates an activity journal entry |
| `match_activity` | Activity | `description: string` | Maps user text to catalog activity |
| `get_activity_suggestions` | Activity | — | Returns suggestion list |

(The registry reports "11 registered functions" in code; the table above lists every type referenced. If the count has drifted, `AIFunctionRegistry.registerDefaultFunctions()` is the source of truth.)

`getFunctionDefinitionsForAI()` serializes the registry to the OpenAI/Anthropic tool-definition JSON schema that the Lambda forwards to the model.

**Safety gap.** `AIFunctionRegistry.execute(...)` around lines 316–323 auto-approves mutating calls. A user-approval step is a TODO before production use of tools that change profile state.

---

## 9. End-to-end request flow (dashboard mode)

```
User taps Send in ChatInputBar
  -> OpenConversationChatView forwards text to AIChatbotService.sendMessage(..., mode: .dashboard)
     -> ChatModeManager.generateResponse()
        -> Resolves DashboardChatMode via ChatModeRegistry
        -> DashboardDataProvider.gatherContextJSON() — HealthKit, journals, targets, profile
        -> Builds ChatModeContext (user, goals, progress) + dashboardContext
        -> StreamingChatService.startStreaming()
           -> SigV4 sign HTTP POST to dashboardStreamingLambdaURL
           -> Body: StreamingInput { message, userId, sessionId, dashboardContext }
           -> Reads SSE stream:
              chunk events  -> append to @Published currentStreamingText -> typewriter
              complete event -> final text + optional htmlContent + optional functionCall
     <- Returns ChatResponse
  -> If functionCall:
       AIFunctionRegistry.execute(name, parameters)
       -> Result returned to model as a follow-up turn
  -> AIChatService updates LocalChatMessage
  -> ChatMessageBubble re-renders
     -> If htmlContent: DashboardWebView loads the HTML into a WKWebView
        -> JS bridge 'heightHandler' reports content height (ResizeObserver) so the bubble auto-sizes
        -> JS bridge 'actionHandler' turns chart clicks into DashboardAction (edit, navigate, ...)
```

Key types touched, in order: `String` (user input) -> `ChatMode` -> `ChatModeContext` -> `DashboardContextPayload` (encoded) -> `StreamingInput` -> `StreamChunk` -> `LocalChatMessage` -> `DashboardAction`.

---

## 10. Rendering LLM-authored HTML

File: [step/Views/Chat/DashboardWebView.swift](../../step/Views/Chat/DashboardWebView.swift) (~218 loc).

- `WKWebView` with a transparent background, `loadHTMLString(htmlContent, baseURL: nil)`.
- JS bridge: two `WKScriptMessageHandler`s — one for height (posted from a `ResizeObserver` embedded in the HTML template), one for actions (`dashboardAction` calls from chart click handlers).
- No network — base URL is nil, so the HTML can only use inlined assets plus whatever Chart.js/CDN links the LLM emits. Review the prompt templates when hardening; CSP is effectively whatever Apple gives a local HTML string.
- `DashboardAction` is a Swift enum that the chat view inspects to push `.editActivity`, `.navigate`, etc.

Security note: today this trusts LLM-authored HTML. It runs in `WKWebView` isolated from native state (no `JavaScriptCore` bridge that exposes app objects), but script message handlers are powerful — any feature that expands the bridge should assume the page is attacker-controlled.

---

## 11. Feature flags and configuration

Flags (in [step/Utils/DebugConfig.swift](../../step/Utils/DebugConfig.swift)):

| Flag | Default | Purpose |
| --- | --- | --- |
| `useStreamingResponses` | `true` | Toggle SSE / typewriter |
| `enableAIChatbot` | `true` | Master switch for the chat entry point |
| `enableOnboardingChat` | `true` | Onboarding chat mode |
| `enableMessagingLayerV2` | `true` | Messaging Layer v2 plumbing |
| `aiChatbotService` (log) | `true` | Debug logging only |

There is **no** remote feature flag for the dashboard POC. Gating is implicit: the dashboard Lambda URLs only exist in dev, so non-dev builds silently fall back to the chat Lambda. Adding a first-class flag (UserDefaults + remote config) is a prerequisite to exposing this to real users.

Environment detection runs off `STEP_ENV`, embedded at build time by [Scripts/embed-step-env.sh](../../Scripts/embed-step-env.sh) (the missing-phase bug was fixed in commit `74d5e939`, 2026-04-22).

---

## 12. Dependencies

No MCP SDK on device. Relevant third-party libraries in the chat path:

- AWS Amplify (Auth/API) — supplies Cognito credentials used by SigV4.
- Stream Chat SwiftUI — separate human chat product; not the AI pipeline.
- Kingfisher — image loading inside chat bubbles.
- Firebase Crashlytics, Mixpanel, Customer.io, AppsFlyer, Branch — observability/attribution around the chat entry points.

Anthropic and Gemini are only consumed server-side (inside the Lambdas), never linked into the iOS app.

---

## 13. Status, known issues, and TODOs

Working today (dev):

- Streaming chat with typewriter.
- Dashboard POC against `AIDashboardLambda` (Claude) and `AIDashboardStream` (Gemini).
- Function calling for the 11 registered tools.
- SSE + AWS SigV4 transport.

Open issues / TODOs to close before promoting the POC:

1. **Dashboard Lambdas only deployed to dev.** Stg/prod currently reuse the chat Lambda — dashboard output is effectively unavailable in release builds.
2. **Auto-approved function execution.** `AIFunctionRegistry.execute` does not prompt the user before mutating profile/goal state.
3. **Incomplete profile context.** `DashboardDataProvider` leaves age/gender/height/weight nil; the model papers over this at prompt level.
4. **Lambda URLs are hardcoded.** Should move to remote config so dashboards can roll out per-cohort without a release.
5. **No user-facing feature flag** gating the dashboard modes.
6. **Trust boundary around LLM HTML.** `WKWebView` isolation is the only line of defense; expanding the JS bridge without a review will erode it.

Recent commits to read on `mcp-poc` for intent:

- `2578d2a9` 2026-03-17 — initial AI Dashboard POC with the dual-Lambda architecture.
- `58162db3` 2026-04-13 — adds `dashboardContext`, iterative refinement, bug fixes.
- `ae26decd` 2026-04-20 — ensures HTML is generated on the Gemini path and routes to the correct Lambda.
- `74d5e939` 2026-04-22 — restores the `embed-step-env.sh` build phase.

---

## 14. File reference (quick index)

| Concern | File |
| --- | --- |
| Module overview | [step/Services/AIChat/AIChat.swift](../../step/Services/AIChat/AIChat.swift) |
| Mode strategy protocol | [step/Services/AIChat/Modes/ChatModeProtocol.swift](../../step/Services/AIChat/Modes/ChatModeProtocol.swift) |
| Mode orchestrator | [step/Services/AIChat/Modes/ChatModeManager.swift](../../step/Services/AIChat/Modes/ChatModeManager.swift) |
| Mode registry | [step/Services/AIChat/Modes/ChatModeRegistry.swift](../../step/Services/AIChat/Modes/ChatModeRegistry.swift) |
| Dashboard modes | [Dashboard/DashboardChatMode.swift](../../step/Services/AIChat/Modes/Dashboard/DashboardChatMode.swift), [Dashboard/GeminiDashboardChatMode.swift](../../step/Services/AIChat/Modes/Dashboard/GeminiDashboardChatMode.swift) |
| Tool registry | [step/Services/AIChat/Functions/AIFunctionRegistry.swift](../../step/Services/AIChat/Functions/AIFunctionRegistry.swift) |
| Dashboard data provider | [step/Services/AIChat/DashboardDataProvider.swift](../../step/Services/AIChat/DashboardDataProvider.swift) |
| Streaming transport | [step/Services/AIChat/StreamingChatService.swift](../../step/Services/AIChat/StreamingChatService.swift) |
| HTML renderer | [step/Views/Chat/DashboardWebView.swift](../../step/Views/Chat/DashboardWebView.swift) |
| Main chat view | [step/Views/Chat/OpenConversationChatView.swift](../../step/Views/Chat/OpenConversationChatView.swift) |
| Message bubble | [step/Views/Chat/ChatMessageBubble.swift](../../step/Views/Chat/ChatMessageBubble.swift) |
| Endpoints | [step/Utils/EnvironmentConfig.swift](../../step/Utils/EnvironmentConfig.swift) |
| Feature flags | [step/Utils/DebugConfig.swift](../../step/Utils/DebugConfig.swift) |
| Build-time env | [Scripts/embed-step-env.sh](../../Scripts/embed-step-env.sh) |
| Lambda source notes | [Scripts/AIDashboardLambda/README.md](../../Scripts/AIDashboardLambda/README.md) |
| Dev-tool MCP config | [.mcp.json](../../.mcp.json) |
