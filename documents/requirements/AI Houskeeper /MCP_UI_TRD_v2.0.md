# Aihousekeeper — The Live-In House Manager — TRD v2.0

**Feature:** Proactive AI house-manager personality layered on top of the v1.2 Assistant Home / MCP-for-UI surface
**Codename:** **Aihousekeeper** (working name; user can rename in-app)
**Product:** SimpleHouse (iOS + Android React Native app, Cloudflare Workers backend)
**Document Type:** TRD
**Version:** v2.0
**Status:** DRAFT
**Created:** 2026-04-22
**Author:** a.tekhtelev@gmail.com

**Source Documents:**
- **Supersedes / extends:** [MCP_UI_TRD.md](MCP_UI_TRD.md) v1.2 (the card + chat + tool-use foundation; referred to below as "v1.2 TRD")
- **Companion plan:** [MCP_UI_Implementation_Plan_v2.0.md](MCP_UI_Implementation_Plan_v2.0.md)
- **Inspiration competitors:** Shipshape (SAM + sensors + human pro), I am Home (Hank + gamification), Oply (predictive maintenance), HomeZada
- **Industry trend:** 2026 shift from reactive prompts → autonomous, anticipatory agents (OpenAI Tasks, Gemini Scheduled Actions, Arahi Rahi)

---

## §0 — One-paragraph reframe

v1.2 ships a great **reactive surface**: open the app → see actionable cards → chat → tool registry mutates state. v2.0 layers on the missing 20%: a **proactive teammate** named Aihousekeeper that initiates, remembers, follows through, and actually does work on the user's behalf — between app opens, across channels, over months. Aihousekeeper is the difference between *"a chatbot in my home app"* and *"a live-in house manager who never sleeps and bills $0/month."* Concretely: Aihousekeeper owns a daily briefing, runs an outbound loop that decides when to interrupt you, keeps a durable memory of your home and family, schedules its own follow-ups, drafts and sends outbound messages to contractors with your approval, knows who in the household handles what, and keeps a transparent trust ledger of every autonomous action it took.

> **Note on baseline drift.** v1.2 currently has three different tool-count statements (TRD ADR-16 prose: 117; TRD §23.13 breakdown sums to 133; Plan: 129). v2.0 adds **+12 net new tools** regardless of which number v1.2 settles on — see §3 + §8 + §6.1 for the additions. Where this doc says "v1.2's tool registry" it means whatever v1.2 ships, not a specific number.

---

## §1 — What's new vs. v1.2

| Area | v1.2 (Assistant Home) | v2.0 (Aihousekeeper) |
|---|---|---|
| **Identity** | Generic "AI assistant" copy | Named persona, customizable voice, persistent character |
| **Initiation** | User-pulled — opens app, sees cards | Agent-pushed — daily briefing, weather nudges, follow-ups |
| **Memory** | 30-day session log + 5-min KV cards | Durable `assistant_memory` (facts, prefs, history) read/written via tools. **DB-indexed only — no embeddings in v2.0;** recall uses BM25-ish keyword overlap (see Plan Task 9.3) |
| **Scheduling** | System cron `*/5 *` runs the agent | Agent calls `schedule_self_followup` to schedule its own next thought |
| **Action surface** | v1.2 internal CRUD tools (count TBD per v1.2 reconciliation) | + Outbound delegation tools (draft SMS, request quotes, send emails) with approval |
| **Channels** | In-app push notifications | + SMS replies, email digests, Apple Watch glance, web summary URL |
| **Family** | `householdId` scopes data | + `member_role`, `member_responsibilities` — Aihousekeeper routes work to the right person |
| **Accountability** | Per-tool audit log (internal) | + User-visible **Trust Ledger** timeline with every autonomous decision |
| **Daily output** | Cards re-aggregated on app open | A persistent `assistant_briefings` artifact composed daily |

**v2.0 inherits unchanged from v1.2:** the SSE chat pipeline, the 5 chat modes, the v1.2 tool registry, the WebView dashboard, the kill switch, the per-tool risk classification, the auth/ticket/idempotency model, and all data-flow diagrams. **The proactive layer reuses every primitive v1.2 ships.**

**v2.0 explicitly aligns with v1.2's *resolved* design (not stale prose):**
- HIGH_WRITE = **close-and-reconnect** per v1.2 Plan §0.2 + Task 6.2 (NOT v1.2 TRD §6.2 step 11's stale "keepalive" wording, which v1.2 still needs to fix).
- SSE ticket TTL = whatever v1.2 settles on (Plan §0.2 reduced to 10s; older TRD prose still says 30s — Aihousekeeper reuses v1.2's value, no override).
- Endpoint prefix for v1.2's chat surface = `/ai-chat/*`. Aihousekeeper's surfaces use `/aihousekeeper/*` as a sibling namespace, not a sub-route — see ADR-31.

---

## §2 — New goals

### 2.1 Functional (numbering continues from v1.2 §3.1)

- **G-13 — Identity & Voice.** The assistant has a name (default `Aihousekeeper`, user-renameable per household), a documented tone (warm, brief, accountable, never apologetic-loop), and a consistent first-person voice across push notifications, briefings, chat, and email. A single `AssistantIdentity` source of truth feeds every surface.

- **G-14 — Persistent Memory.** Aihousekeeper can write to and read from a durable `assistant_memory` store indexed by household. Memory entries are typed (`fact`, `preference`, `history`, `decision`, `unresolved_question`) and carry a confidence score, a source (`user_said` / `inferred` / `tool_result`), and an `expires_at`. Memory is exposed to the LLM as a curated "What I know about this home" prefix rather than dumped wholesale.

- **G-15 — Outbound Loop.** A new server-side scheduled job (`OutboundLoopWorker`, runs every 15 min) decides whether to *initiate* communication with the user. It evaluates triggers (weather, calendar, overdue tasks, unresolved questions, new findings, anniversary of past events, scheduled follow-ups) against per-user **interruption budget** + quiet hours, picks at most one message per cycle, and emits via push / SMS / email.

- **G-16 — Self-Scheduled Follow-ups.** Aihousekeeper can call a `schedule_self_followup(at, prompt, context_ref)` tool that creates an `assistant_followups` row. When the timestamp passes, the OutboundLoopWorker picks it up, runs Aihousekeeper with the saved context, and decides whether to message the user or quietly close it (e.g. the underlying task is already done).

- **G-17 — Daily Briefing.** Aihousekeeper composes a `daily_briefing` artifact once per day per household, at the household's chosen briefing time (default `07:00` local). The briefing is 1 short paragraph + ≤3 bullets. It's pushed if non-empty; **silently skipped if there's nothing meaningful to say** (anti-noise principle). Briefings are persisted, addressable (`/briefings/2026-04-22`), and listable in app (history view).

- **G-18 — Outbound Delegation Tools.** New HIGH_WRITE tool family: `draft_sms_to_contractor`, `send_sms_to_contractor` (after approval), `draft_email_to_contractor`, `send_email_to_contractor`, `request_quotes_from_saved_contractors`, `propose_calendar_slots`. These cross the app boundary using existing channels (Twilio for SMS — operator decision required, see §16).

- **G-19 — Family Awareness.** `household_members` gains `role` (`owner`, `partner`, `tenant`, `child`, `pro`) and `responsibilities` (free-text array of domains: `lawn`, `cars`, `kitchen`, `kids_school`). Aihousekeeper routes assignments and addresses pushes to the right member ("I assigned this to Sara since she usually handles the yard. Tap to reassign.").

- **G-20 — Trust Ledger.** Every autonomous action Aihousekeeper takes (snoozed a reminder, sent a draft, deferred a task, ranked suggestions) appears in a user-visible `/aihousekeeper/trust-ledger` timeline with: what was done, why (one sentence rationale generated at decision time), reversibility, and an "undo" button if reversible. Goal: build trust over weeks, then unlock more autonomy.

- **G-21 — Quiet Hours & Interruption Budget.** Per-household setting: quiet hours (default 22:00–07:00 local, no pushes), and a **daily interruption budget** (default 3 outbound messages/day across all channels). Briefing counts as 1. Aihousekeeper picks the highest-priority message to send when over-budget; the rest are dropped or downgraded to in-app cards.

- **G-22 — Multi-channel surfaces.** Aihousekeeper is reachable via:
  - Push notifications (already in v1.2)
  - **SMS reply path**: user can reply to a push-as-SMS forwarder with `done` / `snooze` / `nope` / free text — short text gets routed to a `task_assistant` chat turn server-side.
  - **Email weekly digest**: opt-in, sent Sundays at 18:00 local, ~6-bullet recap.
  - **Apple Watch glance**: shows today's one most important thing (already partial in v1.2 via `watch-sync.ts`; v2.0 wires the briefing).
  - **Web view of briefings**: signed-token URL so a non-app-installed spouse can read the morning brief from email.

### 2.2 Non-functional

- **NF-11 — Briefing latency.** Composed within 10 s. If composition fails or exceeds 10 s, fall back to v1.2 cards (no push sent).
- **NF-12 — Outbound dispatch latency.** From trigger fire to push delivery ≤ 30 s p95.
- **NF-13 — Memory store size.** Cap of 500 entries per household; LRU + decay-by-confidence eviction.
- **NF-14 — Privacy of memory.** Memory entries never leave the Worker in raw form; the prefix builder summarizes them via a small Haiku call (cached) before injection.
- **NF-15 — Cost ceiling.** Outbound loop costs ≤ $0.10/user/month at p95 usage. Achieved via Haiku for trigger evaluation + Sonnet only when composing a briefing or message.
- **NF-16 — Anti-noise SLO.** ≤ 0.3 outbound messages/user/day on average across the user base. Metric tracked weekly; a spike triggers an automatic conservative-mode flag flip.
- **NF-17 — User control.** Every channel + frequency setting is independently disable-able from a single `Settings → Aihousekeeper` screen. No dark patterns to re-enable.
- **NF-18 — Silent failure.** If memory write or follow-up scheduling fails, the user-visible chat or briefing still completes. Errors are logged but never surfaced as "Aihousekeeper couldn't remember that."
- **NF-19 — Outbound content sanitization.** All outbound bodies that include memory-derived or LLM-composed strings are sanitized before dispatch:
  - **Push:** plain-text only; strip control chars + truncate to channel limit.
  - **SMS (Twilio):** plain-text only; strip URLs not on a per-household allowlist (prevents prompt-injection-driven phishing).
  - **Email (SendGrid):** HTML body sanitized via DOMPurify with the **explicit, prescriptive** config below — do **NOT** copy v1.2's WebView config verbatim, which has a known `FORBID_ATTR: /^on/i` regex bug (DOMPurify expects a string array, not a regex; the regex form silently lets `onclick=`, `onload=`, etc. through). Aihousekeeper's email config:
    ```
    {
      ALLOWED_TAGS: ['p','br','strong','em','a','ul','ol','li','h2','h3'],
      ALLOWED_ATTR: ['href','title'],
      FORBID_ATTR: ['onclick','onload','onerror','onmouseover','onfocus','onblur','onchange','onsubmit','onkeydown','onkeyup','onkeypress','onmousedown','onmouseup','onmousemove','onmouseout','ondblclick','oncontextmenu','onwheel','onscroll','ondrag','ondrop','ontouchstart','ontouchend','ontouchmove','ontouchcancel','onanimationstart','onanimationend','ontransitionend'],
      ALLOWED_URI_REGEXP: /^https?:\/\//i,    // strip mailto, javascript:, data:, etc.
      RETURN_TRUSTED_TYPE: false
    }
    ```
  - **Web briefing URL:** server-rendered HTML; no client JS; **same explicit DOMPurify config as above** (not v1.2's buggy version).
- **NF-20 — Model availability fallback.** ADR-22 / §5.3 routes nudges to Haiku 4.5 and briefings to Sonnet 4.6. **If v1.2's tier-routing infrastructure is not yet enabled** (it's optional Phase 8 work in v1.2), all Aihousekeeper calls fall back to whichever single Sonnet model v1.2 ships (currently `claude-sonnet-4-5-20250929`). Cost envelope (NF-15) doubles in that fallback; flag a re-evaluation if the fallback persists past Aihousekeeper's first month live.

---

## §3 — New data model

Schema additions span **5 migration files** — see Plan v2.0 §0 for the canonical filenames + numbering note. The SQL below is grouped by domain for readability; actual file split is documented in the Plan (Task 9.1, 9.2, 10.1, 12.1, 12.2). All numbers are placeholders (`00XX_`); operator picks the next available numbers after v1.2's final migration before applying.

```
assistant_identity {                 -- per household; one row
  household_id (pk, fk),
  name TEXT NOT NULL DEFAULT 'Aihousekeeper',
  tone TEXT NOT NULL DEFAULT 'warm_brief',     -- one of: warm_brief, formal, playful
  pronouns TEXT NULL,                          -- 'they' default
  briefing_time TEXT NOT NULL DEFAULT '07:00', -- HH:MM, local
  quiet_hours_start TEXT NOT NULL DEFAULT '22:00',
  quiet_hours_end   TEXT NOT NULL DEFAULT '07:00',
  daily_interrupt_budget INTEGER NOT NULL DEFAULT 3,
  channels_enabled_json TEXT NOT NULL,         -- {"push":true,"sms":false,"email_weekly":false,"watch":true}
  timezone TEXT NOT NULL,                      -- IANA tz; sourced from device on onboarding
  created_at, updated_at
}

assistant_memory {                   -- the persistent brain
  id (pk uuid),
  household_id (fk, indexed),
  type TEXT NOT NULL,                          -- fact|preference|history|decision|unresolved_question
  subject_kind TEXT NULL,                      -- appliance|space|member|contractor|task|null
  subject_id TEXT NULL,                        -- fk-ish reference (loose)
  body TEXT NOT NULL,                          -- the actual sentence Aihousekeeper will read back
  confidence REAL NOT NULL DEFAULT 0.7,        -- 0-1
  source TEXT NOT NULL,                        -- user_said|inferred|tool_result|external_signal
  source_ref TEXT NULL,                        -- session_id, tool_call_id, signal_id
  created_at, last_used_at, expires_at NULL,
  superseded_by_id NULL REFERENCES assistant_memory(id)
}

assistant_followups {                -- self-scheduled
  id (pk uuid),
  household_id (fk),
  scheduled_for TEXT NOT NULL,                 -- ISO datetime UTC
  prompt TEXT NOT NULL,                        -- what to think about when it fires
  context_ref_json TEXT NULL,                  -- {session_id?, task_id?, suggestion_id?}
  origin TEXT NOT NULL,                        -- self_scheduled|user_requested
  status TEXT NOT NULL DEFAULT 'pending',      -- pending|fired|cancelled|skipped
  fired_at TEXT NULL,
  outcome_json TEXT NULL,                      -- {decision: notify|silent_close, message_id?}
  created_at, updated_at
}

assistant_briefings {                -- one row per generated briefing
  id (pk uuid),
  household_id (fk),
  date TEXT NOT NULL,                          -- YYYY-MM-DD in household tz
  composed_at TEXT NOT NULL,
  paragraph TEXT NOT NULL,
  bullets_json TEXT NOT NULL,                  -- max 3
  push_sent BOOLEAN NOT NULL DEFAULT 0,
  push_message_id TEXT NULL,
  read_at TEXT NULL,
  empty_reason TEXT NULL,                      -- only set when skipped: 'nothing_today'
  source_signals_json TEXT NOT NULL,           -- audit trail of what triggered each item
  UNIQUE(household_id, date)
}

assistant_outbound_log {             -- canonical record of every push/sms/email Aihousekeeper sent
  id (pk uuid),
  household_id (fk),
  channel TEXT NOT NULL,                       -- push|sms|email|watch
  to_member_id TEXT NULL,                      -- which household member
  template TEXT NOT NULL,                      -- briefing|nudge|followup|delegation_draft|alert
  body TEXT NOT NULL,
  external_message_id TEXT NULL,               -- twilio sid / sendgrid id / expo receipt id
  status TEXT NOT NULL,                        -- sent|failed|skipped_quiet_hours|skipped_budget
  trigger_ref_json TEXT NULL,                  -- which trigger / followup / signal caused this
  user_action TEXT NULL,                       -- replied|opened|dismissed|null
  created_at
}

assistant_trust_ledger {             -- user-visible "what Aihousekeeper did" timeline
  id (pk uuid),
  household_id (fk, indexed),
  occurred_at TEXT NOT NULL,
  category TEXT NOT NULL,                      -- decision|message_sent|task_changed|memory_added|followup_scheduled
  summary TEXT NOT NULL,                       -- one human sentence
  rationale TEXT NOT NULL,                     -- one human sentence ("why")
  reversible BOOLEAN NOT NULL,
  undo_token TEXT NULL,                        -- for reversible items
  related_refs_json TEXT NULL,                 -- {tool_call_id?, briefing_id?, memory_id?, followup_id?}
  user_dismissed_at TEXT NULL
}

household_members  -- ALTER
  ADD COLUMN role TEXT NOT NULL DEFAULT 'owner',                -- owner|partner|tenant|child|pro
  ADD COLUMN responsibilities_json TEXT NOT NULL DEFAULT '[]'   -- ['lawn','cars',...]
```

### 3.1 New invariants

- **I-11 — Identity is per-household, not per-user.** A household has one Aihousekeeper. Multiple members share it. Member-specific personalization happens via `member_role` + `responsibilities`, not separate identities.
- **I-12 — Memory entries are immutable; updates are supersessions.** Setting `superseded_by_id` is the only way to "edit" memory. This preserves history. **Enforcement:** application-layer only (in `MemoryService.write` / `supersede` / `forget`). The schema does not have a CHECK or UPDATE-trigger guard; direct DB UPDATE on `body` would bypass the invariant. Acceptable risk because all writes route through the service; flagged here so future migrations don't accidentally break the assumption.
- **I-13 — A briefing for `(household_id, date)` is unique.** Re-composition on the same day overwrites only if `read_at IS NULL`.
- **I-14 — Outbound dispatch is gated on `assistant_identity.channels_enabled_json` AND quiet hours AND daily budget.** All three checks happen in one place: `OutboundDispatcher.canSend()`.
- **I-15 — Trust Ledger entries are append-only.** No deletes. `user_dismissed_at` only hides from default view.
- **I-16 — A self-scheduled followup never wakes the user directly.** It runs Aihousekeeper, who decides whether to message. `outcome.decision='silent_close'` is the most common outcome and is correct behavior.

---

## §4 — New ADRs (continuing from v1.2's ADR-19)

| # | Decision | Chosen | Alternative | Why |
|---|---|---|---|---|
| **ADR-20** | Persona model | **Single named persona per household ("Aihousekeeper"), user-renameable, fixed tone palette of 3 (warm_brief / formal / playful)** | Per-user personas / fully free tone | A house has one manager. Tone palette keeps prompt engineering tractable and prevents users from breaking voice consistency via free-text. |
| **ADR-21** | Memory storage | **Durable D1 table with typed entries + supersession**, surfaced to LLM as a curated prefix string built per-turn | Vector DB / append-only embedding store | Volumes are tiny (≤500 entries/household). Typed entries + curation are far cheaper, debuggable, and editable than embeddings. We can add embeddings later for cross-household pattern mining. |
| **ADR-22** | Outbound trigger evaluation | **Server-side rule engine + Haiku classification — NOT a continuous LLM agent loop** | Always-on agent in a Durable Object | Cost + latency. Triggers are 80% deterministic (cron fired, weather changed, task overdue). LLM only composes the message when a trigger has fired. |
| **ADR-23** | Outbound channel | **Push first; SMS via Twilio (operator decision); email via SendGrid (already wired for password reset)** | In-app only / web push | Push is universal & free. SMS is the highest-engagement channel for proactive maintenance reminders (per Shipshape data points). Email digest serves the non-app-installed spouse. |
| **ADR-24** | Daily Briefing latency vs. freshness | **Compose at the user's local briefing time, not at app open** | Compose on demand at app open | The briefing must arrive *before* the user opens the app — that's the magic. Cost: small Worker cron pool. Mitigation: skip empty briefings (anti-noise SLO). |
| **ADR-25** | Trust Ledger granularity | **Every autonomous decision (snooze, defer, route) gets a ledger entry, even silent ones** | Only user-visible actions logged | Trust is built by transparency. Silent good decisions ("I didn't bother you about X because Y") are the most trust-building. UI lets the user filter to "show me what you saved me from." |
| **ADR-26** | Memory injection | **Aihousekeeper calls `recall(query)` tool when needed, OR a per-turn relevance ranker selects ≤8 entries to prepend** | Always inject all memory | Token cost + recency bias. Selective recall is closer to how a human assistant remembers. |
| **ADR-27** | Self-followup execution | **Followup fires → runs Aihousekeeper with persisted context → Aihousekeeper decides notify-or-close → may schedule a new followup** | Followup directly notifies user | A 3-week-old "did you ever clean the gutters?" might already be done. The agent must re-check before pinging. |
| **ADR-28** | Family role assignment | **Aihousekeeper infers responsibilities from past task assignments + asks during onboarding; user can edit anytime** | User must configure all members upfront | Reduces onboarding friction. Inference + low-friction correction is the right loop. |
| **ADR-29** | Quiet hours enforcement | **Hard wall at the dispatch layer — no override** | "Urgent" override flag | Never erodes trust. Even "urgent" items can wait until 07:00 for a homeowner; a true emergency (water leak from a sensor) is out of scope for v2.0 anyway. |
| **ADR-30** | Anti-noise mechanism | **Weekly per-cohort dashboard of avg outbound/user/day; auto-flips `aihousekeeper_conservative_mode` flag if above 0.5** | Trust the prompt | Empirical guardrail. Prompt engineering will drift; a metric-based circuit breaker won't. |
| **ADR-31** | Endpoint namespace for Aihousekeeper surfaces | **`/aihousekeeper/*` as a sibling namespace to v1.2's `/ai-chat/*`, not a sub-namespace** (e.g. `/households/:hid/aihousekeeper/identity`, `/households/:hid/aihousekeeper/briefings/:date`) | `/ai-chat/aihousekeeper/*` sub-route | Aihousekeeper's endpoints are not chat streams — they're CRUD on identity/memory/briefings/ledger. Keeping them at their own root clarifies auth middleware routing, separates kill-switch scope (`ai_chat_killswitch` gates chat; `aihousekeeper_enabled` gates Aihousekeeper), and avoids false implication that these endpoints are SSE-streaming. Webhooks (`/webhooks/twilio/*`) remain at the existing `/webhooks/*` root. |
| **ADR-32** | HIGH_WRITE approval flow for delegation tools | **Reuse v1.2's close-and-reconnect flow exactly** (per v1.2 Plan §0.2 + Task 6.2). `send_sms_to_contractor`, `send_email_to_contractor`, `request_quotes_from_saved_contractors`, `assign_task_to_member` all park in `aiToolPending`, emit `tool_call_pending` SSE, close the stream, await `POST /ai-chat/tool-result`, resume on reconnect with same `X-Idempotency-Key`. | Custom Aihousekeeper approval primitive | Zero new approval code. Aihousekeeper's delegation tools behave identically to v1.2 HIGH_WRITE tools from the user's perspective. Only the draft body rendering in `ToolApprovalCard` is Aihousekeeper-specific (Plan Task 11.3). |

---

## §5 — The Outbound Loop in detail

### 5.1 Trigger taxonomy

Triggers are the primitive unit. Each is a small evaluator returning `{ fired: boolean, severity: 1-5, payload: any, suggested_template: string }`.

| Trigger | Cadence | Source | Severity rule |
|---|---|---|---|
| `daily_briefing_time` | Once/day at user's `briefing_time` | Cron | Always 3 (will be downgraded if briefing is empty) |
| `task_overdue_critical` | Every loop tick (15 min) | D1 query | 5 if >7d overdue + critical priority; 3 if >3d |
| `weather_action_required` | Every 6h | Open-Meteo (free, no key) | 4 (frost/freeze, severe wind, hail); 3 (heavy rain) |
| `appointment_imminent` | Every loop tick | D1 query | 4 if <24h away with prep needed; 2 if 24-72h |
| `followup_due` | Every loop tick | `assistant_followups` | Inherits from the followup's stored severity |
| `unresolved_question_aging` | Daily | `assistant_memory` type=unresolved_question, age >3d | 2 |
| `new_inspection_findings` | On report processing complete (existing webhook) | Lambda → Worker | 4 |
| `anniversary_of_past_event` | Daily | `assistant_memory` type=history with `_anniversary` flag | 2 |
| `seasonal_kickoff` | Once on first day of meteorological season | Cron | 3 |
| `cost_anomaly` | Weekly | Budget service | 3 if monthly spend >150% of trailing 3-mo avg |
| `contractor_quote_received` | Webhook from email-parsing (Phase later) | External | 4 |

### 5.2 Loop algorithm (every 15 min, per household)

```
for each household with assistant_identity row:
  if global killswitch OR assistant disabled for household: continue
  if outside quiet hours window?
    triggers = [t for t in TRIGGERS if t.evaluate(household).fired]
    if no triggers: continue
    if briefing_time hits NOW: triggers.append(BriefingTrigger)
    sorted = triggers sorted by severity desc, then by recency
    budget_remaining = daily_budget - count(today's outbound_log where status='sent')
    if budget_remaining <= 0:
      log skipped_budget for top trigger; continue
    chosen = sorted[0]
    if chosen.severity < 3 AND user has open in-app session in last 5min:
      // user is already in-app, drop to a card instead of a push
      enqueue_card(chosen); continue
    composed = ComposeMessage(chosen)  // Haiku for nudges, Sonnet for briefing
    if composed.body is empty (model decided "actually nothing to say"):
      log skipped_empty; continue
    OutboundDispatcher.send(composed)
    write trust_ledger entry
  else:
    // quiet hours: only enqueue cards for next-open
    for t in triggers: enqueue_card(t)
```

### 5.3 Composition — model routing

- **Briefing**: Sonnet 4.6, with `recall(today, week)` results, today's tasks, weather, calendar. Prompt cached with 1h TTL on the system + memory prefix.
- **Nudge** (single trigger, single push): Haiku 4.5, ~150 tokens out, prompt cached.
- **Delegation draft** (e.g. SMS to contractor): Sonnet 4.6, requires user approval before send.

---

## §6 — Memory in detail

### 6.1 Tools

```
recall(query: string, limit?: int=8, types?: string[]) → MemoryEntry[]
remember(type, body, subject_kind?, subject_id?, confidence?=0.8, expires_in_days?) → memory_id
forget(memory_id, reason: string) → ok                     -- supersedes with empty body
update_memory(memory_id, new_body, reason) → new_memory_id  -- creates new row, sets superseded_by
```

All four are LOW_WRITE risk (no domain-state mutation, easy to revert via `forget`).

### 6.2 Per-turn injection

Each chat turn, `MemoryPrefixBuilder.build(householdId, currentMessage)`:
1. Runs a cheap relevance scorer (Haiku, prompt-cached) to pick ≤8 memory entries that match current message intent.
2. Always includes: top-3 highest-confidence `fact` entries + all open `unresolved_question` entries (capped at 5).
3. Renders as a `<aihousekeeper_memory>` block placed AFTER the system prompt and BEFORE the chat history (so it's part of the cached prefix when stable).

### 6.3 Memory write triggers (no LLM cost)

Some memory writes happen deterministically without an LLM call:
- User completes a task → `history` entry: "Completed {task_name} on {date}"
- User snoozes a suggestion 3x → `preference` entry: "Tends to defer {suggestion_category}"
- User assigns a task to a member → `preference` entry: "{member} usually handles {category}"

### 6.4 Privacy

- Memory rows are encrypted-at-rest (D1 default).
- Memory `body` is summarized into the prompt context, never raw-leaked across households.
- A `Settings → Aihousekeeper → What I remember` screen shows all memory entries with edit/delete.

---

## §7 — The Daily Briefing artifact

### 7.1 Format

Strictly:
- 1 paragraph, 1–3 sentences, ≤320 chars.
- 0–3 bullets, each ≤80 chars.
- Optional 1 CTA: "Open the brief" → deep link to `/briefing/{date}`.

Bad: "Good morning! Here are 8 things…" (waterfall of items).
Good: "Morning. Trash goes out tonight, and your boiler service is overdue by a week. Want me to text Mike?"

### 7.2 Composition prompt (excerpt)

> You are Aihousekeeper, the household's house manager. Compose today's briefing. Be brief: one short paragraph + at most 3 bullets. Skip the briefing entirely (return `{empty:true}`) if there's truly nothing important. The user's time is precious. Never apologize, never preface, never list every input. Pick the single most useful framing.

### 7.3 Skipping is a feature

`empty:true` → no push, briefing row gets `empty_reason='nothing_today'`. Trust ledger gets a "Did not interrupt you today — nothing important" entry. Over time this is the user's biggest signal that Aihousekeeper is *good*.

### 7.4 Surfaces

- **Push**: title `Aihousekeeper · Daily brief`, body = paragraph (truncated to 178 chars).
- **In-app**: top-of-Assistant-Home banner card on first open of the day.
- **Email digest**: weekly only — emails the last 7 briefings as a single recap on Sundays.
- **Web URL**: `https://app.simplehouse.com/b/{signed_token}` so a non-app-installed spouse can read.

---

## §8 — Outbound delegation tools (new, all HIGH_WRITE)

| Tool | Effect | Channels touched |
|---|---|---|
| `draft_sms_to_contractor(contractor_id, intent, context_refs[])` | Composes an SMS body; returns `{draft_id, body}`. NO send. | None |
| `send_sms_to_contractor(draft_id)` | Sends via Twilio after user approves draft. | Twilio |
| `draft_email_to_contractor(contractor_id, intent, context_refs[])` | Same pattern, email body + subject. | None |
| `send_email_to_contractor(draft_id)` | Sends via SendGrid after approval. | SendGrid |
| `request_quotes_from_saved_contractors(category, scope, deadline_days)` | Fan-out: drafts an email to each saved contractor in `category`; user approves the batch as one. | SendGrid |
| `propose_calendar_slots(member_id, duration_min, window_days)` | Reads member's connected Google Calendar (if linked), returns 3 candidate slots. Never writes. | Google Calendar API |
| `forward_briefing_to(member_id)` | Sends today's briefing as a push/email to a specific member. | Push/Email |
| `assign_task_to_member(task_id, member_id, reason)` | Domain mutation; CC's the assignee with a "Aihousekeeper assigned this to you" note. | Domain DB + push |

All of these require user approval per v1.2's HIGH_WRITE close-and-reconnect flow (canonical reference: v1.2 Plan §0.2 + Task 6.2 — **NOT** v1.2 TRD §6.2 step 11, which still describes the older "keepalive" pattern v1.2 has deprecated). See ADR-32 for the explicit binding. Drafts are stored in `aiToolPending` and shown in a `ToolApprovalCard` with **the actual message rendered** so the user reads what Aihousekeeper is about to say.

### Operator decisions required before Phase 11

- Twilio account + phone number provisioned (cost ~$1/mo + $0.0079/sms).
- SendGrid template IDs for `aihousekeeper_contractor_email`, `aihousekeeper_member_assignment`, `aihousekeeper_weekly_digest`.
- Google Calendar OAuth scope review (read-only `calendar.readonly`).

---

## §9 — Family awareness

### 9.1 Onboarding addition

After v1.2's existing onboarding, Aihousekeeper adds a 2-step "Who lives here?" flow:
1. Confirm members already in `household_members`. Ask role (chips: Owner / Partner / Tenant / Child / Pro).
2. "Who handles…" with chips for `lawn`, `cars`, `kitchen`, `kids_school`, `appliances`, `finances`, `general`. Multi-select per member. Skippable.

### 9.2 Inference rules

If a member completes ≥3 tasks in a category over 30d, Aihousekeeper adds that category to their inferred responsibilities (writes a `preference` memory + updates `responsibilities_json` if the user agreed to "let Aihousekeeper learn"). User can revert.

### 9.3 Routing rule

When Aihousekeeper assigns or proposes assignment, it picks the member whose responsibilities most closely match the task's category. Tie-breaker: most recent activity in app. The trust-ledger entry always names the chosen member.

---

## §10 — Trust Ledger

### 10.1 What gets logged

| Category | Example summary | Reversible? |
|---|---|---|
| `decision` | "Skipped today's briefing — nothing important." | No (info only) |
| `message_sent` | "Texted Mike (plumber) to confirm Wednesday." | Yes — "Recall message" if within 5 min |
| `task_changed` | "Snoozed 'Clean gutters' by 1 week (you said it was rainy)." | Yes — undo |
| `memory_added` | "Noted: boiler is a 2018 Vaillant." | Yes — forget |
| `followup_scheduled` | "Will check back on the gutters in 7 days." | Yes — cancel |
| `assignment` | "Assigned 'Replace HVAC filter' to Tom." | Yes — reassign |

### 10.2 UI

- Settings → Aihousekeeper → Trust Ledger
- Default filter: last 7 days, all categories.
- Empty-state copy: "Aihousekeeper hasn't done much yet. Give it a week."
- Each entry: timestamp, summary, rationale on tap, undo button if applicable.

### 10.3 Why this matters

The Trust Ledger is the single most important UX surface for unlocking long-term autonomy. After 30 days of "Aihousekeeper did the right thing", users opt into more aggressive defaults (auto-send drafted SMS, auto-reschedule low-stakes tasks). Without the ledger we can't measurably earn that trust.

---

## §11 — Multi-channel surfaces

| Channel | Direction | What | Phase |
|---|---|---|---|
| Push (Expo Notifications) | Out | Briefings, nudges, follow-ups, alerts | 9 (foundation) |
| In-app Assistant Home cards | Out | Items dropped during quiet hours, low-severity items | 9 |
| SMS via Twilio | Out + In | High-severity nudges; reply `done`/`snooze`/`nope`/free text. Inbound goes to a `task_assistant` chat turn. | 11 |
| Email weekly digest | Out | Sundays 18:00 local; recap of week's briefings + ledger highlights | 12 |
| Apple Watch | Out | Today's one most important thing; replaces v1.2's basic sync | 12 |
| Web briefing URL | Out (passive) | Signed-token public-read of a single briefing for non-app-installed spouse | 11 |

### 11.1 Inbound SMS routing

`POST /webhooks/twilio/sms` (new endpoint):
1. Verify Twilio signature.
2. Look up sender phone → household member.
3. Determine context: was there a recent push to this member with a `reply_context_token`?
4. If yes + reply matches `done|snooze|nope`: directly mutate (mark task done, snooze 7d, dismiss).
5. Otherwise: open a `task_assistant` chat turn with the inbound text as the user message; stream Aihousekeeper's response back as 1–2 SMS messages (max 320 chars total).

---

## §12 — New API contracts

### 12.0 Common contract (applies to every Aihousekeeper endpoint below unless noted)

| Property | Value |
|---|---|
| **Auth** | Same JWT bearer + household-membership middleware as v1.2's `/ai-chat/*` (`backend/src/middleware/auth.ts`). No new auth primitive. |
| **`householdId` source** | Path parameter; verified server-side against JWT membership. Rebound — never trusted from a tool argument (mirrors v1.2 I-8). |
| **Rate limit** | Default `60/min/user` per endpoint via existing `RateLimiterDO` bucket `aihousekeeper:default`. Briefing-list and trust-ledger-list (high-cardinality) get `120/min/user` via `aihousekeeper:read`. Outbound webhooks have no per-user limit but a global Worker-side cap of `aihousekeeper_global_outbound_cap_per_loop` (default 200/15min). |
| **Kill-switch behavior** | If `aihousekeeper_enabled=false`, all `/aihousekeeper/*` endpoints return `503 AIHOUSEKEEPER_DISABLED`. v1.2's `/ai-chat/*` is unaffected (separate killswitch). |
| **Allowlist behavior** | If `aihousekeeper_user_allowlist` is a non-null array AND user not in it → `403 AIHOUSEKEEPER_NOT_ALLOWLISTED`. Null/missing key = permissive (but masked by `aihousekeeper_enabled=false` default; see §14). |
| **Error envelope** | Reuses v1.2's error contract shape (`{error: {code, message, retriable}}`). All Aihousekeeper-specific codes live in §13. |
| **Idempotency** | GET endpoints: idempotent natively. PATCH/POST/DELETE: client should send `X-Idempotency-Key` header for deduplication; server caches result for 24h in `aiIdempotencyKeys` (reuses v1.2 table). |
| **Logging** | Every request logs `{userId, householdId, route, status, latency_ms, aihousekeeper_killswitch_state}` (no PII). |

### 12.1 Identity

```
GET  /households/:hid/aihousekeeper/identity         → assistant_identity row
PATCH /households/:hid/aihousekeeper/identity        → update name/tone/briefing_time/quiet/budget/channels
```

### 12.2 Memory

```
GET  /households/:hid/aihousekeeper/memory?type=&q=  → list memories
DELETE /households/:hid/aihousekeeper/memory/:id     → forget (server writes a supersession)
```

### 12.3 Briefings

```
GET  /households/:hid/aihousekeeper/briefings        → list, paginated, newest first
GET  /households/:hid/aihousekeeper/briefings/:date  → single briefing (YYYY-MM-DD)
POST /households/:hid/aihousekeeper/briefings/:date/read  → mark read
GET  /b/:signed_token                        → public-readable single briefing (web)
```

### 12.4 Trust Ledger

```
GET  /households/:hid/aihousekeeper/trust-ledger?since=&category=  → list
POST /households/:hid/aihousekeeper/trust-ledger/:id/dismiss
POST /households/:hid/aihousekeeper/trust-ledger/:id/undo          → invokes the appropriate reverse-tool
```

### 12.5 Followups (mostly internal but listable)

```
GET  /households/:hid/aihousekeeper/followups        → list pending
DELETE /households/:hid/aihousekeeper/followups/:id  → cancel
```

### 12.6 Outbound webhooks

```
POST /webhooks/twilio/sms                    → inbound SMS
POST /webhooks/sendgrid/event                → email open/click events (optional)
```

---

## §13 — New error codes

| Code | Cause | UX |
|---|---|---|
| `AIHOUSEKEEPER_QUIET_HOURS` | Outbound attempted during quiet hours | Silent — log only |
| `AIHOUSEKEEPER_BUDGET_EXHAUSTED` | Daily interruption budget hit | Silent — log + downgrade to card |
| `AIHOUSEKEEPER_CHANNEL_DISABLED` | User disabled this channel | Silent — log, fall back to next channel |
| `AIHOUSEKEEPER_BRIEFING_EMPTY` | Composer returned `empty:true` | Skip push; ledger entry "didn't interrupt — nothing today" |
| `AIHOUSEKEEPER_FOLLOWUP_OBSOLETE` | Followup fired but underlying task already resolved | Silent close, ledger entry |
| `AIHOUSEKEEPER_MEMORY_FULL` | 500-entry cap hit | Decay-evict lowest-confidence; log warning |
| `AIHOUSEKEEPER_OUTBOUND_TWILIO_FAIL` | SMS send failed | Trust-ledger entry + retry once |
| `AIHOUSEKEEPER_OUTBOUND_SENDGRID_FAIL` | Email failed | Same |
| `AIHOUSEKEEPER_INBOUND_SMS_UNROUTABLE` | Inbound SMS without context | Auto-reply "Sorry, I'm not sure what that's about. Open the app to chat." |
| `AIHOUSEKEEPER_CONSERVATIVE_MODE` | Anti-noise circuit breaker tripped | Banner: "Aihousekeeper is being extra-quiet this week while we tune things." |
| `AIHOUSEKEEPER_DISABLED` | `aihousekeeper_enabled=false` | 503; UI hides Aihousekeeper settings + briefings tab |
| `AIHOUSEKEEPER_NOT_ALLOWLISTED` | User not in `aihousekeeper_user_allowlist` | 403; same UX as `AIHOUSEKEEPER_DISABLED` |
| `AIHOUSEKEEPER_OUTBOUND_BODY_REJECTED` | NF-19 sanitizer stripped a message body to empty (e.g. all-URL SMS) | Log + skip; trust-ledger entry: "didn't send — message contained nothing safe to deliver" |

---

## §14 — Feature flags (new keys in `CONFIG_KV`)

| Key | Default | Purpose |
|---|---|---|
| `aihousekeeper_enabled` | `false` | Master switch for the proactive layer |
| `aihousekeeper_outbound_loop_enabled` | `false` | Disable just the loop (chat still works) |
| `aihousekeeper_briefings_enabled` | `false` | Disable briefings |
| `aihousekeeper_sms_enabled` | `false` | Twilio integration on |
| `aihousekeeper_email_digest_enabled` | `false` | SendGrid weekly digest on |
| `aihousekeeper_conservative_mode` | `false` | Auto-flipped by anti-noise SLO breach |
| `aihousekeeper_user_allowlist` | `null` | Same semantics as v1.2's allowlist: `null`/missing = permissive ("allow everyone") **but masked by `aihousekeeper_enabled=false` default until rollout starts** (see Plan Task 13.2). Present empty array `[]` = deny everyone. Present non-empty array = strict allowlist. |
| `aihousekeeper_household_outbound_cap_daily` | `3` | Per-household daily push budget |
| `aihousekeeper_global_outbound_cap_per_loop` | `200` | Worker-side circuit breaker |

---

## §15 — Acceptance criteria

A v2.0 release is shippable to internal allowlist when:

1. **Identity surface live**: `GET /aihousekeeper/identity` returns a row for any household; in-app `Settings → Aihousekeeper` lets user rename, change tone, set quiet hours + budget. ✅
2. **Memory roundtrip works**: `remember` writes a row, `recall` returns it ranked, the next chat turn references it accurately. ✅
3. **Daily briefing fires** at user's chosen time for ≥3 internal accounts, ≥1 of which legitimately gets `empty_reason='nothing_today'` within first 7 days (proves anti-noise). ✅
4. **Outbound loop**: `task_overdue_critical` trigger fires on a seeded test household and a push lands within 30 s. ✅
5. **Trust ledger**: every snooze, defer, briefing, and memory write appears with a one-sentence rationale. ✅
6. **Quiet hours hard-walled**: nothing gets sent between 22:00 and 07:00 local; verified by test that schedules a high-severity push at 23:00. ✅
7. **Self-followup**: Aihousekeeper calls `schedule_self_followup`, the row appears, the OutboundLoopWorker picks it up at the right time, and Aihousekeeper decides notify-or-close based on current state. ✅
8. **Family routing**: assigning a yard task to a household with one member responsible for `lawn` routes to that member by default. ✅
9. **Anti-noise SLO dashboard** in place; alert fires if avg outbound/user/day >0.5 over a rolling 7d window. ✅
10. **Kill switch**: `aihousekeeper_enabled=false` stops loop within 60s; existing v1.2 chat remains functional. ✅

---

## §16 — Open questions (operator decisions)

| # | Question | Owner | Blocks |
|---|---|---|---|
| Q1 | Approve Twilio account + budget? | Eng + Finance | Phase 11 (SMS) |
| Q2 | SendGrid templates approved by Brand? | Brand + Eng | Phase 12 (digest) |
| Q3 | Aihousekeeper default name — keep "Aihousekeeper" or pick something else? | Product | Phase 9 |
| Q4 | Default tone palette — confirm `warm_brief` is right default? | Product + UX writing | Phase 9 |
| Q5 | Onboarding for existing users — show a "Meet Aihousekeeper" intro? | Product | Phase 13 (rollout) |
| Q6 | Trust-ledger retention — forever or 90 days? | Legal + Product | Phase 12 |
| Q7 | Inbound SMS billing — included in subscription tier or upsell? | Product + Finance | Phase 11 |
| Q8 | Google Calendar OAuth — own integration or redirect to existing? | Eng | Phase 11 |
| Q9 | Anti-noise SLO threshold — `0.5/user/day` calibrated against what data? | Eng + Product | Phase 13 |
| Q10 | Should Aihousekeeper ever send a push *on behalf of* a household member (e.g. "Sara assigned this to you")? | Product + Legal | Phase 11 |

---

## §17 — Known gaps deferred from v2.0

### G-AIHOUSEKEEPER-1 — Per-tool context allowlist not yet concretised (Phase 9 blocker)

**What's missing.** v1.2's TRD §5.1 + Plan §2 ADR-10 specifies a per-tool context allowlist (`buildContext({tool, household})`) that selects which household fields each tool sees. That table was an open gap in v1.2 (G21) and has not yet been extended to cover Aihousekeeper's 12 new tools (`recall`, `remember`, `forget`, `update_memory`, `schedule_self_followup`, `cancel_followup`, the 5 delegation tools, `propose_calendar_slots`, `forward_briefing_to`, `assign_task_to_member`).

**Why this matters.** NF-6 (privacy of memory) requires that home addresses, phone numbers, member emails never leave the Worker in an LLM context unless a specific tool needs them. Without a concrete allowlist for each Aihousekeeper tool, the default would be "send everything," defeating NF-6.

**Decision required before Phase 9 Task 9.4 starts.** Each new tool needs an explicit row in the allowlist table specifying: which `household_*` fields, which `member_*` fields, which `assistant_memory` types, and whether `assistant_outbound_log` history is included.

**Owner.** Eng + Privacy review.

### G-AIHOUSEKEEPER-2 — Memory immutability is application-layer only

See I-12. Risk noted; if a future migration adds direct UPDATE paths to `assistant_memory.body`, the supersession invariant breaks silently. Optional mitigation: SQLite trigger (see "Remaining v2.0 issue" note in CHANGELOG).

### G-AIHOUSEKEEPER-3 — Inbound contractor SMS scope clarification

§8 introduces `send_sms_to_contractor` (single message) but §17 ("Aihousekeeper-initiated chat with contractors via SMS thread") is out of scope. **Clarification:** Aihousekeeper can send a single drafted SMS per user-approved tool call. Contractor's reply (if any) lands as `external_message_id` on `assistant_outbound_log` and is shown to the user as a notification — **Aihousekeeper does not auto-reply or maintain a conversation thread** with the contractor. Multi-turn contractor negotiation is a v3 feature.

### Other deferred (unchanged from prior list)

- **Hardware sensor integration** (à la Shipshape's snap-on sensors). Not in v2.0; could be a v3.0 if we get a hardware partnership.
- **Voice output (TTS)**. Aihousekeeper speaks via text only in v2.0. TTS is a v2.1 enhancement.
- **Cross-household pattern learning** (vector store / embeddings). v2.0 keeps memory fully scoped per household. Aggregate insights ("homes like yours…") deferred.
- **Smart home / HomeKit / SmartThings integration**. Out of scope for v2.0; great v3.0 fit.
- **Calendar write access**. Calendar reads only in v2.0. Writing events is a high-trust action deferred.
- **Phone calls on user's behalf**. Out of scope.
- **Aihousekeeper-initiated chat with contractors via SMS thread** (multi-turn negotiation). Out of scope; v2.0 limit is single drafted-message + manual user follow-up.

---

## §18 — Naming, voice, brand

**Codename:** Aihousekeeper. Reasons:
- Gender-neutral.
- Short (good in pushes: `Aihousekeeper · 3 things today`).
- Phonetically distinct from Siri / Alexa / Hey Google.
- Easy to brand consistently in UX writing.

**Voice palette** (3 fixed tones, user picks one in Settings):

- **`warm_brief`** (default): "Morning. Two things — trash tonight, and the boiler is overdue. Want me to text Mike?"
- **`formal`**: "Good morning. Today's items: trash collection tonight, and your boiler service is one week overdue. Shall I draft a message to your plumber?"
- **`playful`**: "Hey 👋 Quick brief — bins out tonight and boiler is being moody (overdue). Text Mike?"

**Voice rules** (enforced via prompt):
- Never apologize unless Aihousekeeper actually broke something.
- Never start with "Sure!" / "I can help with that!"
- Never restate the user's question.
- Never use the word "AI" or "assistant" in user-facing copy.
- Always offer a next action when there is one.
- Briefings never start with "Good morning" twice in a row across days.

---

## §19 — Document map

- This doc (v2.0): the proactive layer
- [v1.2 TRD](MCP_UI_TRD.md): the card + chat + tool registry foundation Aihousekeeper builds on
- [v2.0 Implementation Plan](MCP_UI_Implementation_Plan_v2.0.md): how we build it (phases 9–13)
- [v1.2 Implementation Plan](MCP_UI_Implementation_Plan.md): phases 0–8 still apply
