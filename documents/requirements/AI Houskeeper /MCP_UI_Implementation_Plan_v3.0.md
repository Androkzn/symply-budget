# Implementation Plan — Aihousekeeper (Proactive Layer) — v3.0

**Version:** 3.0
**Date:** 2026-04-23
**Status:** Planned
**Area:** BE (heavy) + FE (medium)
**Priority:** P1
**Source TRD:** [MCP_UI_TRD_v2.0.md](MCP_UI_TRD_v2.0.md)
**Builds on:** [MCP_UI_Implementation_Plan.md](MCP_UI_Implementation_Plan.md) (v1.2 foundation — Assistant Home + chat + tool registry)

---

## §0 — Framing: greenfield, ship-it-all-at-once

**Context reset from v2.2–v2.4:** SimpleHouse has no real users yet. Only test accounts. Not published. No production risk, no user impact. This plan therefore replaces the sequential "Phase 9 → 10 → 11 → 12 → 13 with rollouts and circuit breakers" structure from v2.4 with **parallelizable work streams**. Everything ships together. Behind the scenes the code is the same; the difference is that this plan:

- **Removes** phased rollout tables, per-phase pre-conditions, per-phase rollback sections, conservative-mode SLO circuit breakers, allowlist-based gradual enablement, MMKV flag-gating for UI intercept, `aihousekeeper_user_allowlist`, `aihousekeeper_conservative_mode`, `aihousekeeper_onboarding_rollout_active`, and the 5-window flag-flip schedule.
- **Keeps** runtime kill-switches (single `aihousekeeper_enabled` flag + per-channel flags) for operator control, but no gradient-rollout machinery.
- **Keeps** all technical scope from v2.4: **14 tools**, trust ledger, memory system (with eviction + FTS5), outbound dispatcher, family router, 10+ triggers, briefing composer, SMS/email/web delivery, Google Calendar, Apple Watch glance.
- **Folds** v2.4's "§1 Backports into v1.2" into the main migrations — no more B1–B9 distinction, just schema. If v1.2's `0034_ai_chat.sql` is still unshipped at Aihousekeeper start, it can include the columns we need; if it has shipped, Aihousekeeper adds its own ALTERs. Both paths land as new migrations in `backend/migrations/` — see §2.

**The work is organized as 9 parallel streams.** Engineers pick streams; streams have technical dependencies on each other (schema must exist before services that query it) but no rollout gates.

### Migration numbering

Last migration in `backend/migrations/` today: **`0033_maintenance_subtasks.sql`** (verified). v1.2's pending `0034_ai_chat.sql` creates the approval-flow tables (`ai_chat_sessions`, `ai_chat_messages`, `ai_tool_calls`, `ai_tool_pending`, `ai_tool_audit`, `ai_idempotency_keys`). Aihousekeeper's 7 migrations take `0035`–`0041`. Integer-only naming; no letter suffixes; no `00XX` placeholders.

If v1.2 has not landed `0034` by Aihousekeeper start: fold Aihousekeeper's needs into `0034` directly — no backport shim layer needed, one migration is cheaper than coordinating two. Decision at coding kickoff, not a pre-condition.

### Tool count = 14 (corrected from v2.4's 13)

| Category | Tools | Count |
|---|---|---|
| Memory | `recall`, `remember`, `forget`, `update_memory` | 4 |
| Followup | `schedule_self_followup`, `cancel_followup` | 2 |
| Delegation | `draft_sms_to_contractor`, `send_sms_to_contractor`, `draft_email_to_contractor`, `send_email_to_contractor`, `request_quotes_from_saved_contractors`, `forward_briefing_to`, `assign_task_to_member` | 7 |
| Calendar | `propose_calendar_slots` | 1 |
| **Total** | | **14** |

`assign_task_to_member` is now **explicitly owned by this plan** (Stream C Task C5) rather than deferred to v1.2. Registering it here removes the "is v1.2 Phase 4 going to ship it?" ambiguity from v2.4. No running totals are tracked in task bodies.

### 5 chat modes (allowlist scope)

The 4 memory tools and memory-prefix injection are available across all **5 chat modes** v1.2 defines: `task_assistant`, `report_assistant`, `family_chat`, `contractor_context`, `morning_briefing`. The 7 delegation tools, 2 followup tools, and calendar tool are scoped per-mode in Task C6 (tool-registry binding).

### Model IDs (⚠️ Unverified against Anthropic account entitlements)

| Role | Model | Fallback |
|---|---|---|
| Briefings / drafts | `claude-sonnet-4-6-20260217` ⚠️ | `claude-sonnet-4-5-20250929` |
| Nudges / relevance / JSON decisions | `claude-haiku-4-5-20251001` ⚠️ | `claude-sonnet-4-5-20250929` |

All Aihousekeeper LLM calls go through `generateWithFallback()` (see Task B10). Aihousekeeper code reads model IDs from `env.AIHOUSEKEEPER_BRIEFING_MODEL` / `env.AIHOUSEKEEPER_NUDGE_MODEL` — never hardcoded.

### `dev-preview` environment

`backend/wrangler.toml` has `[env.staging]` and `[env.production]` only today. Aihousekeeper adds `[env.dev-preview]` (Task Ops1). Greenfield context means DO-blocked staging is not the critical path — `dev-preview` is the pre-prod surface for everything involving Durable Objects / Queues.

---

## §1 — Stream map

Nine work streams. Streams are parallelizable; arrows mark technical dependencies (not rollout gates).

```
[A] Schema + Migrations ──┬── [B] Core Services ──┬── [C] AI Tools ──┐
                          │                       ├── [D] Triggers ──┤
                          │                       ├── [E] Routes ────┼── [I] Observability + Tests
                          │                       ├── [F] Cron/Queue ┤
                          │                       └── [G] Integrations ┤
                          └────────── [H] Frontend ────────────────────┘
                                          (consumes E's API shapes)
                                          
[Ops] wrangler.toml + secrets + KV seeds ← touched by A, E, F, G
```

| Stream | Scope | Depends on | Files |
|---|---|---|---|
| **A** | All 7 Aihousekeeper migrations; schema extensions | — | `backend/migrations/0035…0041.sql` |
| **B** | Core services: memory, outbound dispatcher, trust ledger, briefing composer, family router, followup runner, conservative-mode helper, memory-prefix builder, event bus | A | `backend/src/services/aihousekeeper/*.ts` (15 files) |
| **C** | All 14 tools + tool-registry bindings per chat mode | B | `backend/src/services/ai/tools/aihousekeeper/*.ts` (4 files) |
| **D** | 11 trigger evaluators (adds `contractor_quote_received`) | B, A | `backend/src/services/aihousekeeper/triggers/*.ts` (12 files) |
| **E** | Routes: Aihousekeeper API, Twilio webhook, public briefing URL | B | `backend/src/routes/*.ts` (3 files) |
| **F** | Cron dispatch (single `scheduled()` handler, minute-of-hour routing); Queue producer + consumer; DLQ scanner | B, D | `backend/src/index.ts`, `backend/src/services/aihousekeeper/outbound-loop.ts`, `backend/src/services/aihousekeeper/dlq-scanner.ts` |
| **G** | Twilio, SendGrid, Google Calendar wrappers | B, A | `backend/src/services/integrations/*.ts` (3 files) |
| **H** | All frontend screens, API client, store wiring, push-tap handler | E (API shapes) | `src/screens/aihousekeeper/*.tsx`, `src/screens/settings/AihousekeeperSettingsScreen.tsx`, `src/api/aihousekeeper.ts`, `app/briefing/[date].tsx`, `app/_layout.tsx` |
| **I** | Analytics Engine metrics + tests across all streams | B, C, D, E, F | `backend/src/services/observability/aihousekeeper-metrics.ts`, co-located `__tests__/` |
| **Ops** | `wrangler.toml` (dev-preview env, Queue bindings, vars); `wrangler secret put` for TWILIO/SENDGRID; `CONFIG_KV` seed script | — | `backend/wrangler.toml`, `backend/scripts/seed-aihousekeeper-kv.ts` |

---

## §2 — Stream A: Schema + Migrations

Seven migrations. Each uses the next available integer. Apply with `npm run db:migrate` (local) then `npm run db:migrate:remote -- --env dev-preview` and `-- --env production`. Greenfield: staging is left as-is (DO-broken, v1.2 team's domain).

### A1 — `0035_aihousekeeper_identity_memory.sql`

```sql
-- Aihousekeeper persona (one row per household; seeded on createHousehold)
CREATE TABLE IF NOT EXISTS assistant_identity (
  household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Aihousekeeper',
  tone TEXT NOT NULL DEFAULT 'warm_brief',
  pronouns TEXT,
  briefing_time TEXT NOT NULL DEFAULT '07:00',
  quiet_hours_start TEXT NOT NULL DEFAULT '22:00',
  quiet_hours_end TEXT NOT NULL DEFAULT '07:00',
  daily_interrupt_budget INTEGER NOT NULL DEFAULT 3,
  channels_enabled_json TEXT NOT NULL DEFAULT '{"push":true,"sms":false,"email_weekly":false,"watch":true}',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Aihousekeeper memory store
CREATE TABLE IF NOT EXISTS assistant_memory (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('fact','preference','history','decision','unresolved_question')),
  subject_kind TEXT,
  subject_id TEXT,
  body TEXT NOT NULL,
  redacted_body TEXT,                                     -- Haiku-summarized PII-masked version used for prompt injection
  confidence REAL NOT NULL DEFAULT 0.7,
  source TEXT NOT NULL CHECK (source IN ('user_said','inferred','tool_result','external_signal')),
  source_ref TEXT,
  is_anniversary_tracked INTEGER NOT NULL DEFAULT 0,     -- fixes v2.4 gap: `_anniversary` referenced by anniversary_of_past_event trigger
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  expires_at TEXT,
  superseded_by_id TEXT REFERENCES assistant_memory(id)
);
CREATE INDEX idx_assistant_memory_household ON assistant_memory(household_id, type, superseded_by_id);
CREATE INDEX idx_assistant_memory_subject ON assistant_memory(household_id, subject_kind, subject_id);
CREATE INDEX idx_assistant_memory_anniversary ON assistant_memory(household_id, is_anniversary_tracked) WHERE is_anniversary_tracked = 1;

-- FTS5 index for recall (fixes v2.4 gap: replaces hand-rolled BM25/LIKE)
CREATE VIRTUAL TABLE assistant_memory_fts USING fts5(
  body,
  redacted_body,
  content='assistant_memory',
  content_rowid='rowid'
);

-- Triggers keep FTS5 in sync
CREATE TRIGGER assistant_memory_fts_insert AFTER INSERT ON assistant_memory BEGIN
  INSERT INTO assistant_memory_fts(rowid, body, redacted_body) VALUES (new.rowid, new.body, new.redacted_body);
END;
CREATE TRIGGER assistant_memory_fts_delete AFTER DELETE ON assistant_memory BEGIN
  INSERT INTO assistant_memory_fts(assistant_memory_fts, rowid, body, redacted_body) VALUES ('delete', old.rowid, old.body, old.redacted_body);
END;
CREATE TRIGGER assistant_memory_fts_update AFTER UPDATE ON assistant_memory BEGIN
  INSERT INTO assistant_memory_fts(assistant_memory_fts, rowid, body, redacted_body) VALUES ('delete', old.rowid, old.body, old.redacted_body);
  INSERT INTO assistant_memory_fts(rowid, body, redacted_body) VALUES (new.rowid, new.body, new.redacted_body);
END;
```

Also update [backend/src/services/household-service.ts](backend/src/services/household-service.ts) `createHousehold` to INSERT a default `assistant_identity` row using the device's tz from the request payload. No backfill job — every new household gets one at creation time. For the small test-user population, write a one-time seed in [backend/scripts/seed-aihousekeeper-identity.ts](backend/scripts/seed-aihousekeeper-identity.ts) to add missing rows.

### A2 — `0036_aihousekeeper_briefings_followups.sql`

```sql
CREATE TABLE IF NOT EXISTS assistant_followups (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  scheduled_for TEXT NOT NULL,
  prompt TEXT NOT NULL,
  context_ref_json TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('self_scheduled','user_requested')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','fired','cancelled','skipped')),
  fired_at TEXT,
  outcome_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_assistant_followups_due ON assistant_followups(status, scheduled_for);

CREATE TABLE IF NOT EXISTS assistant_briefings (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  composed_at TEXT NOT NULL DEFAULT (datetime('now')),
  paragraph TEXT NOT NULL,
  bullets_json TEXT NOT NULL DEFAULT '[]',
  push_sent INTEGER NOT NULL DEFAULT 0,
  push_message_id TEXT,
  read_at TEXT,
  empty_reason TEXT,
  source_signals_json TEXT NOT NULL DEFAULT '[]',
  composed_by_model TEXT,                    -- operability: which model produced it (fixes v2.4 gap)
  prompt_version TEXT,                       -- operability: which prompt version
  UNIQUE(household_id, date)
);
CREATE INDEX idx_assistant_briefings_household ON assistant_briefings(household_id, date DESC);
```

### A3 — `0037_aihousekeeper_outbound_log.sql`

```sql
CREATE TABLE IF NOT EXISTS assistant_outbound_log (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('push','sms','email','watch')),
  to_member_id TEXT,
  template TEXT NOT NULL,
  body TEXT NOT NULL,
  external_message_id TEXT,
  idempotency_key TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'sent','failed',
    'skipped_quiet_hours','skipped_budget','skipped_channel_disabled',
    'skipped_empty','skipped_duplicate','skipped_kill_switch'
  )),
  trigger_ref_json TEXT,
  user_action TEXT,
  composed_by_model TEXT,                    -- when body is LLM-generated
  prompt_version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_outbound_household_day ON assistant_outbound_log(household_id, created_at);
CREATE UNIQUE INDEX idx_outbound_idempotency ON assistant_outbound_log(household_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

### A4 — `0038_aihousekeeper_trust_ledger.sql`

```sql
CREATE TABLE IF NOT EXISTS assistant_trust_ledger (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  category TEXT NOT NULL CHECK (category IN (
    'decision','message_sent','task_changed','memory_added','followup_scheduled','assignment'
  )),
  summary TEXT NOT NULL,
  rationale TEXT NOT NULL,
  reversible INTEGER NOT NULL DEFAULT 0,
  undo_token TEXT,
  related_refs_json TEXT,
  user_dismissed_at TEXT
);
CREATE INDEX idx_trust_ledger_household ON assistant_trust_ledger(household_id, occurred_at DESC);
```

### A5 — `0039_aihousekeeper_contractor_sms_optin.sql`

```sql
-- TCPA compliance + canonical phone storage
ALTER TABLE contractors ADD COLUMN phone_e164 TEXT;
ALTER TABLE contractors ADD COLUMN sms_opt_in_at TEXT;
ALTER TABLE contractors ADD COLUMN sms_opt_out_at TEXT;
ALTER TABLE contractors ADD COLUMN sms_opt_in_source TEXT;   -- 'homeowner_attest' | 'self_reply_start' | 'inbound_sms'
CREATE INDEX idx_contractors_sms_optin ON contractors(sms_opt_in_at, sms_opt_out_at);
CREATE INDEX idx_contractors_phone_e164 ON contractors(phone_e164);
```

Greenfield test-user data is tiny — `backend/scripts/backfill-contractor-phone-e164.ts` is a one-shot transactional script. Batches of 100 rows; resume-by-cursor; dry-run default; parses via `libphonenumber-js parsePhoneNumberFromString(phone, defaultCountry)`.

### A6 — `0040_aihousekeeper_household_members_responsibilities.sql`

```sql
-- household_members.role already exists at backend/src/db/schema.ts:146 — do NOT re-add it.
-- deleted_at already present via softDelete spread at backend/src/db/schema.ts:150 — reuse.
ALTER TABLE household_members ADD COLUMN responsibilities_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE household_members ADD COLUMN notification_channel_preference TEXT NOT NULL DEFAULT 'auto';
-- values: 'auto' | 'push' | 'email' | 'sms' | 'none'
```

### A7 — `0041_aihousekeeper_push_tokens_version.sql`

```sql
ALTER TABLE push_tokens ADD COLUMN app_version TEXT;
-- Format: semver string; null for tokens registered before this column.
-- Backend gates Aihousekeeper-typed pushes on `app_version >= AIHOUSEKEEPER_MIN_APP_VERSION`;
-- null or lower → falls back to `data.type: 'cards_refresh'`.
```

Also update [src/services/notifications.ts](src/services/notifications.ts) `registerWithServer()` to include `app_version: Constants.expoConfig.version` in the request body, and [backend/src/routes/notifications.ts](backend/src/routes/notifications.ts) (or wherever `push_tokens` inserts land) to persist it.

### A8 — Drizzle schema mirror

For each new table / column, add/extend Drizzle definitions in the appropriate `backend/src/db/schema-*.ts` file:

- `schema.ts` (existing): extend `householdMembers` with `responsibilitiesJson`, `notificationChannelPreference`.
- `schema-notifications.ts` (existing): extend `pushTokens` with `appVersion`.
- `schema-contractors.ts` (existing): extend `contractors` with `phoneE164`, `smsOptInAt`, `smsOptOutAt`, `smsOptInSource`.
- `schema-aihousekeeper.ts` (**new**): `assistantIdentity`, `assistantMemory`, `assistantFollowups`, `assistantBriefings`, `assistantOutboundLog`, `assistantTrustLedger`.
- Re-export from [backend/src/db/schema.ts](backend/src/db/schema.ts).

Run `npm run db:generate` to diff-check migrations; if Drizzle complains, hand-edit the migration to match Drizzle's shape rather than the reverse (migration files are authoritative for apply-order).

---

## §3 — Stream B: Core services

15 files under `backend/src/services/aihousekeeper/`. All exports are project-source symbols consumed by Streams C, D, E, F.

### B1 — `memory-service.ts` (+ Drizzle-backed CRUD)

```ts
class MemoryService {
  constructor(private db: DrizzleD1, private ai: AIProvider, private events: AihousekeeperEventBus) {}
  async write(input: WriteInput): Promise<MemoryEntry>;
  async supersede(id: string, newBody: string, reason: string): Promise<MemoryEntry>;
  async forget(id: string, reason: string): Promise<void>;
  async list(householdId: string, opts?: { type?: MemoryType; limit?: number }): Promise<MemoryEntry[]>;
  async recall(householdId: string, query: string, limit = 8): Promise<MemoryEntry[]>;
  async evictIfOverCap(householdId: string): Promise<{ evicted: number }>;   // NF-13
}
```

**`recall` — FTS5-backed:**

```sql
SELECT m.*, bm25(assistant_memory_fts) AS rank
FROM assistant_memory m
JOIN assistant_memory_fts f ON f.rowid = m.rowid
WHERE f.assistant_memory_fts MATCH ?
  AND m.household_id = ?
  AND m.superseded_by_id IS NULL
ORDER BY (rank * -1) + (m.confidence * 2.0) + recency_boost(m.created_at) DESC
LIMIT ?;
```

`recency_boost` is a scalar user function registered via D1 `CREATE FUNCTION` if available, else computed in TS after retrieving a wider candidate set (LIMIT × 3). Target p95 < 200ms at ≤500 memories/household.

**`write` — redaction (NF-14):** before INSERT, call `ai.generateJSON()` with a Haiku prompt that returns `{ redacted: string }` with SSN/CC/phone masked and names generalized. Store both `body` (audit) and `redacted_body` (prompt injection). If Haiku fails, fall back to regex scrubber in [backend/src/services/aihousekeeper/regex-scrubber.ts](backend/src/services/aihousekeeper/regex-scrubber.ts) with phone/SSN/CC/email patterns → `[redacted]`.

**`evictIfOverCap` — NF-13 (fixes v2.4 gap):** enforce 500-entry cap per household with LRU + decay-by-confidence:

```ts
async evictIfOverCap(householdId: string): Promise<{ evicted: number }> {
  const count = await this.db.query(/* count non-superseded memories */);
  if (count <= 500) return { evicted: 0 };
  const excess = count - 500;
  // Score = (0.4 × confidence) + (0.3 × recency_01) + (0.3 × last_used_01)
  // Delete bottom `excess` rows. Never evict open `unresolved_question` entries.
  const victims = await this.db.query(/* ORDER BY score ASC LIMIT excess */);
  await this.db.query(/* DELETE WHERE id IN (...) AND type != 'unresolved_question' */);
  this.events.emit({ kind: 'memory_evicted', householdId, count: victims.length });
  return { evicted: victims.length };
}
```

Called at the end of every `write()` so the cap is self-enforcing. Tests verify: cap-plus-1 triggers eviction of exactly 1; unresolved-questions are protected; eviction emits ledger-writable event.

**Tests:** [backend/src/services/aihousekeeper/__tests__/memory-service.test.ts](backend/src/services/aihousekeeper/__tests__/memory-service.test.ts) — write→recall roundtrip; supersede chain; type filter; FTS5 ranking; redaction roundtrip (SSN `123-45-6789` in body → `[redacted]` in `redacted_body`); regex fallback when AI unavailable; eviction at 501 entries; unresolved-question immunity.

### B2 — `memory-prefix-builder.ts` (cache-safe, split-region)

**File:** `backend/src/services/ai/context/memory-prefix-builder.ts`

The memory prefix is split into three regions to keep Anthropic prompt-cache hits high while allowing per-turn relevance re-scoring:

```
region 1 (cached, breakpoint 1, ttl:'1h'):  system prompt + tool defs
region 2 (cached, breakpoint 2, default):   assistant_identity row (persona, tone, pronouns) — cache-bust on identity update
region 3 (NOT cached, in final user turn):  <aihousekeeper_memory>
                                              <facts>… top-3 `fact` entries (redacted_body) …</facts>
                                              <open_questions>… up to 5 unresolved_question entries …</open_questions>
                                              <relevant>… top-K from Haiku relevance scorer …</relevant>
                                            </aihousekeeper_memory>
                                            <user_message>…</user_message>
```

**What is and isn't cached (clarifies v2.4 confusion):**

- The **stable** portion (regions 1 + 2) is cached via Anthropic `cache_control: { type: 'ephemeral' }` on the tool-defs block (`ttl: '1h'`, extended-cache-ttl beta header) and the identity block (default 5-min TTL). These are byte-identical across turns within a session.
- The **per-turn** Haiku relevance scorer is a **separate LLM call** that takes the current user message + a candidate memory list and returns a ranked subset. This call is **NOT prompt-cached** because the user message varies every turn. It runs on Haiku (cheap), with its own 300-token system prompt that IS cached across calls in a session.
- The final rendered `<aihousekeeper_memory>` block (region 3) is injected into the current user turn, so it changes per turn and is not part of the cached prefix.

```ts
class MemoryPrefixBuilder {
  constructor(private memory: MemoryService, private ai: AIProvider) {}
  async build(householdId: string, userMessage: string): Promise<{
    region3: string;   // ready to prepend to user turn
    scoredCount: number;
  }>;
}
```

Steps:
1. Top-3 highest-confidence `fact` entries (read `redacted_body`).
2. All open `unresolved_question` entries (≤5).
3. Haiku relevance scorer over the rest (FTS5-preranked candidate set of ~20); picks top-`(8 − fixed_count)`.
4. Size cap: ≤8 total entries, ≤1200 rendered tokens; drop lowest-confidence first.
5. Render `<aihousekeeper_memory>…</aihousekeeper_memory>`.

**Tests:** cache-stability (region 1/2 byte-identical between turns; region 3 varies); redaction (SSN `123-45-6789` NOT in rendered prefix); 8-entry cap; 1200-token cap.

### B3 — `briefing-composer.ts`

```ts
class BriefingComposer {
  constructor(private ai: AIProvider, private deps: BriefingDeps) {}
  async composeFor(householdId: string, date: string): Promise<BriefingResult>;
}
type BriefingResult =
  | { kind: 'composed'; paragraph: string; bullets: string[]; sourceSignals: object[]; composedByModel: string; promptVersion: string }
  | { kind: 'empty';    reason: string; sourceSignals: object[] };
```

**Inputs gathered:** today's overdue tasks, today's appointments, weather (Open-Meteo, free, no key), AI Housekeeper top suggestion, open `unresolved_question` memories, recent `history` events worth recapping.

**Model:** `env.AIHOUSEKEEPER_BRIEFING_MODEL`. Output forced via `tool_use` with two tools (`compose_briefing`, `empty_briefing`) and `tool_choice: { type: 'any' }` — avoids JSON-mode unreliability.

**Prompt version** is a string constant in [backend/src/ai/prompts/aihousekeeper/briefing-v1.ts](backend/src/ai/prompts/aihousekeeper/briefing-v1.ts); bumped by the engineer any time the prompt changes. Stored in `assistant_briefings.prompt_version`.

**Cache_control:** `{ type: 'ephemeral', ttl: '1h' }` on the system+tools prefix (Anthropic SDK `>=0.40`, header `anthropic-beta: extended-cache-ttl-2025-04-11` — ⚠️ verify header string current at coding time).

**Tests:** snapshot against fixture context; `kind:'empty'` on a "nothing today" fixture; tool_use schema validation; graceful fallback when only Sonnet 4.5 available; retry-once-on-malformed then default to `empty` on second failure.

### B4 — `outbound-dispatcher.ts` (single chokepoint, fully-specified `canSend`)

```ts
class OutboundDispatcher {
  constructor(private db: DrizzleD1, private env: Env, private events: AihousekeeperEventBus,
              private twilio: TwilioClient, private sendgrid: SendGridClient) {}

  async canSend(input: {
    householdId: string;
    channel: 'push' | 'sms' | 'email' | 'watch';
    severity: 1|2|3|4|5;
    now: Date;
    kind?: 'briefing' | 'nudge' | 'followup' | 'digest';
    toMemberId?: string;                   // for per-member channel lookups (forward_briefing_to)
  }): Promise<{ allow: true } | { allow: false; reason: CanSendDenyReason }>;

  async sendPush(input: PushInput): Promise<DispatchResult>;
  async sendSms(input: SmsInput): Promise<DispatchResult>;
  async sendEmail(input: EmailInput): Promise<DispatchResult>;
}
```

**`canSend` — ordered, fail-closed (fixes v2.4 under-specification):**

| # | Check | Behavior | severity=5 bypass? |
|---|---|---|---|
| 1 | `aihousekeeper_enabled` flag present and `true` (re-read per call, not cached) | deny → `reason: 'aihousekeeper_disabled'` | no (kill-switch always wins) |
| 2 | Per-channel kill: `aihousekeeper_sms_enabled`, `aihousekeeper_email_digest_enabled`, `aihousekeeper_outbound_loop_enabled` | deny → `reason: 'channel_killed'` | no |
| 3 | Per-household channel disabled in `channels_enabled_json` | deny → `reason: 'channel_disabled'` | no |
| 4 | Quiet hours (DST-correct per-household timezone — see B5) | deny → `reason: 'quiet_hours'` | **YES for severity=5** (e.g. water leak); `kind='followup'` **defers to morning** (schedule for quiet_hours_end + 5min, status=`skipped_quiet_hours` row recorded) |
| 5 | Daily budget: `COUNT(*) FROM assistant_outbound_log WHERE household_id=? AND status='sent' AND created_at >= {start_of_day_local}` < `daily_interrupt_budget` | deny → `reason: 'budget_exhausted'` | **YES for severity=5** |
| 6 | Idempotency: row with same `(household_id, idempotency_key)` in last 24h | deny → `reason: 'duplicate'` | no (idempotency wins) |

`start_of_day_local` is computed with `Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit' })` to get today's date in the household's timezone, then `Date.UTC(...)` converted back. Budget is **counted by sent rows only** — skipped rows do not count.

**Followup quiet-hours behavior:** when `kind='followup'` and check 4 denies, write the `skipped_quiet_hours` row and re-schedule the followup by updating `assistant_followups.scheduled_for` to `quiet_hours_end + 5min`. This means followups defer to morning rather than silently dropping; task B7 (`FollowupRunner`) reads the re-scheduled time next tick.

Every outbound path MUST go through `canSend()`. Each outcome — allow OR deny — writes an `assistant_outbound_log` row so dashboards can attribute non-delivery.

**`sendPush` / `sendSms` / `sendEmail`:**

```ts
async sendPush(input: PushInput): Promise<DispatchResult> {
  const gate = await this.canSend({ ...input, channel: 'push' });
  if (!gate.allow) {
    await this.logSkipped(input, gate.reason);
    this.events.emit({ kind: 'outbound_skipped', ...input, reason: gate.reason });
    return { status: 'skipped', reason: gate.reason };
  }
  // send via expo-server-sdk (installed via package.json)
  // write 'sent' log row; emit 'outbound_sent' event
}
```

`sendSms` wraps Twilio (see G1); TCPA 8am–9pm recipient-local is enforced inside `sendSms` (additional quiet-hours layer distinct from household's quiet-hours). `sendEmail` wraps SendGrid (see G2).

**Tests:** each deny path asserted independently; severity=5 bypass for quiet-hours and budget verified; followup deferral verified; idempotency key collision; kill-switch flip between two calls → second denied; DST boundary test (quiet_hours_start=23:00 household tz on DST-change day).

### B5 — `timezone.ts` (DST-correct helpers)

**File:** `backend/src/services/aihousekeeper/timezone.ts`

Small utility that wraps `Intl.DateTimeFormat`. No external library — `Intl` is supported in the Workers runtime with `compatibility_flags = ["nodejs_compat"]` (confirmed in `wrangler.toml:5`).

```ts
export function hourInTimezone(now: Date, timezone: string): number;         // 0–23
export function dateInTimezone(now: Date, timezone: string): string;         // 'YYYY-MM-DD'
export function isInQuietHours(now: Date, timezone: string, start: string, end: string): boolean;
export function minutesFromMidnight(now: Date, timezone: string): number;
```

**DST correctness:** `Intl.DateTimeFormat('en-CA', { timeZone, hour: '2-digit', hour12: false })` returns the local hour correctly on DST-transition days (US: second Sunday March, first Sunday November). Used by `BriefingComposer` dispatch (Task F3) to match `briefing_time`, and `OutboundDispatcher.canSend` for quiet-hours. Tests cover both DST boundaries for `America/New_York`, `Europe/Berlin`, and `Asia/Tokyo` (no DST).

### B6 — `trust-ledger-service.ts` + event-bus chokepoint

**Files:** `backend/src/services/aihousekeeper/trust-ledger-service.ts`, `backend/src/services/aihousekeeper/event-bus.ts`

Fixes v2.4 fragility (6+ scattered ledger-write call sites): all services emit typed `AihousekeeperEvent`s to a single event bus; the ledger subscribes once and writes exactly one row per event.

```ts
// event-bus.ts
type AihousekeeperEvent =
  | { kind: 'memory_written';       householdId: string; memoryId: string; memoryType: MemoryType; summary: string }
  | { kind: 'memory_evicted';       householdId: string; count: number }
  | { kind: 'briefing_composed';    householdId: string; date: string; result: 'composed' | 'empty'; reason?: string }
  | { kind: 'briefing_pushed';      householdId: string; date: string; messageId: string }
  | { kind: 'outbound_sent';        householdId: string; channel: Channel; template: string; idempotencyKey: string }
  | { kind: 'outbound_skipped';     householdId: string; channel: Channel; reason: CanSendDenyReason }
  | { kind: 'followup_scheduled';   householdId: string; followupId: string; scheduledFor: string }
  | { kind: 'followup_fired';       householdId: string; followupId: string; decision: 'notify' | 'silent_close'; rationale: string }
  | { kind: 'task_assigned';        householdId: string; taskId: string; memberId: string; reason: string }
  | { kind: 'delegation_drafted';   householdId: string; tool: string; draftId: string }
  | { kind: 'delegation_sent';      householdId: string; tool: string; draftId: string }
  | { kind: 'decision_made';        householdId: string; summary: string; rationale: string; reversible: boolean; undoToken?: string };

class AihousekeeperEventBus {
  subscribe(handler: (e: AihousekeeperEvent) => Promise<void>): void;
  async emit(event: AihousekeeperEvent): Promise<void>;
}
```

```ts
// trust-ledger-service.ts
class TrustLedgerService {
  constructor(private db: DrizzleD1, bus: AihousekeeperEventBus) {
    bus.subscribe(async (event) => { await this.writeFromEvent(event); });
  }
  async writeFromEvent(event: AihousekeeperEvent): Promise<void>;   // maps each kind → category + summary + rationale
  async list(householdId: string, opts: { since?: string; category?: string; includeDismissed?: boolean }): Promise<TrustLedgerEntry[]>;
  async dismiss(id: string): Promise<void>;
  async undo(id: string): Promise<UndoResult>;
}
```

The chokepoint is `AihousekeeperEventBus.emit()`. Every service that would produce a ledgerable action (memory write, briefing compose, outbound send, followup schedule/fire, task assignment, delegation, decisions) emits an event **instead of** writing to the ledger directly. The ledger subscriber is the one place events become rows.

**Tests:** one test per event kind asserting exactly one ledger row written; dismiss filters list; undo dispatch table covers every reversible kind; no direct `ledger.write()` in any other Aihousekeeper service (enforced by an ESLint custom rule or a grep-based test).

### B7 — `followup-runner.ts`

```ts
class FollowupRunner {
  async runDue(now: Date): Promise<void>;
  private async runOne(followup: Followup, now: Date): Promise<void>;
}
```

On fire:
1. Mark `status='fired'`.
2. Rehydrate context via `MemoryService.recall(followup.householdId, followup.context_ref_json)` (PII redaction applies).
3. One Aihousekeeper turn on Haiku with `tool_use` over two tools (`notify_user(message)`, `silent_close(reason)`) and `tool_choice: { type: 'any' }`. Retry once on malformed; default to `silent_close(reason='malformed_decision')` on second failure.
4. Emit `followup_fired` event with decision + rationale.
5. If `notify_user`: `OutboundDispatcher.sendPush` (goes through `canSend`).

**Autonomous HIGH_WRITE handling:** if the followup's Aihousekeeper turn invokes a HIGH_WRITE tool (`send_sms_to_contractor`, etc.), the tool parks in `ai_tool_pending` per v1.2 ADR-32. The followup closes with `notify_user("Aihousekeeper has a pending action for your approval")`. Never auto-execute a mutating tool during autonomous execution.

### B8 — `family-router.ts` + category synonyms

```ts
interface RoutingDecision { memberId: string; reason: string; confidence: number; }

class FamilyRouter {
  async pickAssignee(
    householdId: string,
    taskCategory: string,
    opts?: { excludeMemberIds?: string[] }
  ): Promise<RoutingDecision>;
}
```

Algorithm (unchanged from v2.4):
1. Fetch `household_members` for `householdId`, excluding `excludeMemberIds` and any with `deleted_at IS NOT NULL` (uses existing `softDelete` spread at [backend/src/db/schema.ts:150](backend/src/db/schema.ts#L150)).
2. Score: `+1.0` exact `taskCategory ∈ responsibilities_json`; `+0.5` fuzzy (stem match via [backend/src/services/aihousekeeper/category-synonyms.ts](backend/src/services/aihousekeeper/category-synonyms.ts)); `+0.3 × recent_category_task_count(last 30d)`.
3. Tie-break: highest `last_active_at`.
4. Fallback: `role='owner'` with reason "Defaulting to household owner — no member has declared {category}."
5. `confidence = min(1.0, top_score / 1.5)`.

### B9 — `responsibility-inference.ts`

Runs weekly (top-of-week gated in the single `scheduled()` handler). For each `(member, category)` where member completed ≥3 tasks in 30d AND category ∉ `responsibilities_json` AND no active "declined" memory:
- Write `preference` memory.
- Surface an in-app card: "Should Aihousekeeper learn that {member} usually handles {category}?"
- On rejection: write `preference` memory `{ body: "User declined to auto-learn …", confidence: 0.9, expires_in_days: 90 }`. Filters future inference.
- On `dontAskAgain`: `expires_in_days: null`.
- On accept: `UPDATE household_members SET responsibilities_json = json_insert(...)`; emit `task_assigned` event.

### B10 — `generateWithFallback()` adapter

**File:** `backend/src/ai/fallback.ts`

```ts
async function generateWithFallback<M extends keyof AIProvider>(
  provider: AIProvider,
  method: M,
  primaryModel: string,
  fallbackModel: string,
  args: Parameters<AIProvider[M]>
): Promise<ReturnType<AIProvider[M]>>;
```

- Tries `primaryModel`. Catches `model_not_found | invalid_request_error | not_entitled` exactly once and retries with `fallbackModel`.
- Any other error surfaces immediately (no retry).
- Emits counter `aihousekeeper_model_fallback_triggered` to Analytics Engine (Stream I).

The existing `AIProvider` interface at [backend/src/ai/provider.ts](backend/src/ai/provider.ts) exposes task-specific methods (`extractFindings`, `generateSummary`, `generateActionPlans`, `isAvailable`). Stream B adds a generic `generate(model, systemPrompt, messages, tools?)` method and `generateJSON(model, prompt, schema)` method to the interface, since Aihousekeeper needs both structured output (tool_use) and general generation. Claude and Gemini providers implement accordingly.

### B11 — `briefing-token.ts` + `briefing-html.ts`

**Files:** `backend/src/services/aihousekeeper/briefing-token.ts`, `backend/src/services/aihousekeeper/briefing-html.ts`

Mint + verify (HMAC-SHA256 via Workers `crypto.subtle`) for the public briefing URL (E3). **7-day TTL** (shorter than v2.4's initial 30 days, limits leakage blast radius for the tiny test-user cohort).

- Tokens include `{ hid, date, uid, iat }` in the signed payload.
- Signing key in `CONFIG_KV` under `aihousekeeper_briefing_signing_key_v1`; active version in `aihousekeeper_briefing_signing_key_version`.
- Verification rejects tokens whose `hid` + `uid` member has `deleted_at IS NOT NULL` AND `iat < deleted_at` (revocation for departed members).

HTML rendering uses Hono's `html` tagged-template helper for escape-by-default — no DOMPurify (fails on Workers runtime, [workerd #5752](https://github.com/cloudflare/workerd/issues/5752)). No LLM-generated raw HTML — briefing paragraph is inserted as plain text, auto-escaped.

### B12 — `digest-composer.ts`

Composes the weekly email digest from last 7 briefings + trust-ledger highlights + open followups. Called from the single `scheduled()` handler Sundays 18:00 household-local (DST-correct via B5). Dispatches through `OutboundDispatcher.sendEmail`.

### B13 — `conservative-mode.ts` (simplified — runtime kill only, no auto-flip)

```ts
class ConservativeMode {
  async isActive(env: Env): Promise<boolean>;   // reads CONFIG_KV.aihousekeeper_conservative_mode
}
```

Greenfield: no auto-flip circuit breaker. Operator toggles `aihousekeeper_conservative_mode=true` manually if needed; `OutboundDispatcher.canSend` consults this to bump the severity bar to 5. No "exit criteria," no Slack alert, no auto-suggest. If a future production rollout wants the circuit-breaker, add it there.

### B14 — `regex-scrubber.ts`

Simple fallback when Haiku redaction fails: phone, SSN, credit card, email patterns → `[redacted]`. Tests ensure it's idempotent and doesn't corrupt non-matching text.

### B15 — `dlq-scanner.ts`

Reads `AIHOUSEKEEPER_OUTBOUND_DLQ` length via Cloudflare Queues API; emits `dlq_length` metric. Called from the single `scheduled()` handler at `minute === 30` (non-contending with briefing composer at `minute === 0`). One-off manual drain script at [backend/scripts/dlq-drain.ts](backend/scripts/dlq-drain.ts); dry-run default.

---

## §4 — Stream C: AI tools (all 14)

### C1 — Memory tools (4) — [backend/src/services/ai/tools/aihousekeeper/memory-tools.ts](backend/src/services/ai/tools/aihousekeeper/memory-tools.ts)

- `recall(query, limit?, types?)` → `READ`
- `remember(type, body, subject_kind?, subject_id?, confidence?, expires_in_days?, is_anniversary_tracked?)` → `LOW_WRITE` (with undo)
- `forget(memory_id, reason)` → `LOW_WRITE`
- `update_memory(memory_id, new_body, reason)` → `LOW_WRITE`

Each wraps a `MemoryService` method. All four are registered in **all 5 chat modes' allowlists** (memory is universal).

### C2 — Followup tools (2) — [backend/src/services/ai/tools/aihousekeeper/followup-tools.ts](backend/src/services/ai/tools/aihousekeeper/followup-tools.ts)

- `schedule_self_followup(at, prompt, context_ref?)` → `LOW_WRITE`
- `cancel_followup(followup_id, reason)` → `LOW_WRITE`

Scoped to chat modes: `task_assistant`, `morning_briefing`.

### C3 — Delegation tools (6 non-assign) — [backend/src/services/ai/tools/aihousekeeper/delegation-tools.ts](backend/src/services/ai/tools/aihousekeeper/delegation-tools.ts)

- `draft_sms_to_contractor(contractor_id, intent, context_refs?)` → `LOW_WRITE` (creates draft; no send)
- `send_sms_to_contractor(draft_id)` → `HIGH_WRITE` (approval required; refuses if `!contractor.sms_opt_in_at OR contractor.sms_opt_out_at`)
- `draft_email_to_contractor(contractor_id, intent, context_refs?)` → `LOW_WRITE`
- `send_email_to_contractor(draft_id)` → `HIGH_WRITE`
- `request_quotes_from_saved_contractors(category, scope, deadline_days)` → `HIGH_WRITE` (fan-out; single batch approval)
- `forward_briefing_to(member_id)` → `LOW_WRITE` (push if app installed, else email with web-briefing URL; channel per `household_members.notification_channel_preference`)

Scoped to chat modes: `task_assistant`, `contractor_context`.

### C4 — Calendar tool (1) — [backend/src/services/ai/tools/aihousekeeper/calendar-tools.ts](backend/src/services/ai/tools/aihousekeeper/calendar-tools.ts)

- `propose_calendar_slots(member_id, duration_min, window_days)` → `READ` (OAuth scope `calendar.readonly`)

Scoped to chat modes: `task_assistant`, `family_chat`.

### C5 — `assign_task_to_member` tool (1) — [backend/src/services/ai/tools/aihousekeeper/assign-tool.ts](backend/src/services/ai/tools/aihousekeeper/assign-tool.ts) (**new in v3.0; fixes v2.4 missing task**)

```ts
export const assignTaskToMember = {
  name: 'assign_task_to_member',
  kind: 'HIGH_WRITE',
  description: 'Assign an existing task to a household member. Sends a push notification to the assignee.',
  input: z.object({
    task_id: z.string(),
    member_id: z.string().optional(),     // if omitted, FamilyRouter picks
    reason: z.string().optional(),
  }),
  async execute(ctx, input): Promise<ToolResult> {
    const memberId = input.member_id
      ?? (await ctx.familyRouter.pickAssignee(ctx.householdId, await ctx.tasks.categoryOf(input.task_id))).memberId;
    await ctx.tasks.assign(input.task_id, memberId);
    await ctx.dispatcher.sendPush({
      householdId: ctx.householdId,
      template: 'task_assigned',
      body: `Aihousekeeper assigned "${task.title}" to you${input.reason ? `: ${input.reason}` : ''}`,
      deepLink: `/task/${input.task_id}`,
      idempotencyKey: sha256(`assign:${input.task_id}:${memberId}`),
    });
    ctx.events.emit({ kind: 'task_assigned', householdId: ctx.householdId, taskId: input.task_id, memberId, reason: input.reason ?? 'Assigned by Aihousekeeper' });
    return { ok: true, assignee: memberId };
  }
};
```

Scoped to chat modes: `task_assistant`, `family_chat`.

### C6 — Tool registry bindings — [backend/src/services/ai/tools/index.ts](backend/src/services/ai/tools/index.ts) (modify)

Extends v1.2's `ToolRegistry.buildV1()` with all 14 Aihousekeeper tools plus per-mode scoping. Example:

```ts
export function buildToolRegistry(env: Env): ToolRegistry {
  const registry = buildV1(env);   // v1.2 baseline

  // Memory — all 5 modes
  for (const mode of ['task_assistant', 'report_assistant', 'family_chat', 'contractor_context', 'morning_briefing'] as const) {
    registry.register(mode, [recall, remember, forget, updateMemory]);
  }
  // Followup — task + briefing
  registry.register('task_assistant', [scheduleSelfFollowup, cancelFollowup]);
  registry.register('morning_briefing', [scheduleSelfFollowup, cancelFollowup]);
  // Delegation — task + contractor
  registry.register('task_assistant', [draftSms, sendSms, draftEmail, sendEmail, requestQuotes, forwardBriefingTo, assignTaskToMember]);
  registry.register('contractor_context', [draftSms, sendSms, draftEmail, sendEmail, requestQuotes]);
  // Family
  registry.register('family_chat', [assignTaskToMember, proposeCalendarSlots]);
  // Calendar — task
  registry.register('task_assistant', [proposeCalendarSlots]);

  return registry;
}
```

All 14 tools are also registered in the per-tool `ai_tool_context_allowlist` table (v1.2 Phase 6 artifact) with explicit `context_fields` JSON — no wildcards. The `memory_prefix` context gets a separate row enumerating `fact | unresolved_question | preference` with an 8-entry / 1200-token cap.

---

## §5 — Stream D: Triggers

Twelve files under [backend/src/services/aihousekeeper/triggers/](backend/src/services/aihousekeeper/triggers/). Each exports:

```ts
interface Trigger {
  id: string;
  cadenceMinutes: number;
  evaluate(env: Env, householdId: string, now: Date): Promise<TriggerResult | null>;
}
```

### D1 — `index.ts`

Exports the `TRIGGERS` array and a shared `triggerGuard` helper (min-cadence gate per `(householdId, triggerId)` via `CONFIG_KV` with 1h TTL on the guard keys).

### D2–D12 — One file per trigger

| ID | File | Source |
|---|---|---|
| `daily_briefing_time` | `daily-briefing-time.ts` | `assistant_identity.briefing_time` + timezone (via B5) |
| `task_overdue_critical` | `task-overdue-critical.ts` | `tasks` table scan |
| `weather_action_required` | `weather-action-required.ts` | Open-Meteo fetch |
| `appointment_imminent` | `appointment-imminent.ts` | `appointments` table |
| `followup_due` | `followup-due.ts` | `assistant_followups WHERE status='pending' AND scheduled_for <= now` |
| `unresolved_question_aging` | `unresolved-question-aging.ts` | `assistant_memory WHERE type='unresolved_question' AND created_at < now-14d` |
| `new_inspection_findings` | `new-inspection-findings.ts` | `reports` processing completion hook |
| `anniversary_of_past_event` | `anniversary-of-past-event.ts` | `assistant_memory WHERE is_anniversary_tracked=1 AND MONTH(created_at)=MONTH(now) AND DAY(created_at)=DAY(now)` |
| `seasonal_kickoff` | `seasonal-kickoff.ts` | Month-based; seasonal task templates |
| `cost_anomaly` | `cost-anomaly.ts` | **Depends on** [backend/src/services/budget-service.ts](backend/src/services/budget-service.ts) — the existing v1.x budget service provides `getMonthlySpendByCategory(householdId)`. If this method does not exist, add it in Stream B as an extension to the existing service. (Fixes v2.4 gap: named dependency.) |
| `contractor_quote_received` | `contractor-quote-received.ts` | **New in v3.0** (fixes v2.4 silent absence). Source: `contractor_quotes` table (migration `0029_contractor_quotes.sql` already exists). Fires when a new quote row appears for a household, severity 4. |

Each trigger has a co-located test file at [backend/src/services/aihousekeeper/triggers/__tests__/<id>.test.ts](backend/src/services/aihousekeeper/triggers/__tests__/) with seeded D1 fixtures.

---

## §6 — Stream E: Routes

### E1 — `routes/aihousekeeper.ts` (single file, covers all Aihousekeeper API surface)

```
GET    /households/:hid/aihousekeeper/briefings
GET    /households/:hid/aihousekeeper/briefings/:date
POST   /households/:hid/aihousekeeper/briefings/:date/read
GET    /households/:hid/aihousekeeper/identity
PATCH  /households/:hid/aihousekeeper/identity
GET    /households/:hid/aihousekeeper/memory?type=&q=
DELETE /households/:hid/aihousekeeper/memory/:id
GET    /households/:hid/aihousekeeper/trust-ledger?since=&category=&includeDismissed=
POST   /households/:hid/aihousekeeper/trust-ledger/:id/dismiss
POST   /households/:hid/aihousekeeper/trust-ledger/:id/undo
GET    /households/:hid/aihousekeeper/followups?status=
POST   /households/:hid/aihousekeeper/followups/:id/cancel
```

**Single file** (fixes v2.4's "routes/aihousekeeper.ts extended later in Phase 12" awkwardness — parallel streams = one file now). Mounted in [backend/src/index.ts](backend/src/index.ts):

```ts
app.route('/households/:householdId/aihousekeeper', aihousekeeperRoutes);
```

`authMiddleware()` applied at the top of `aihousekeeperRoutes` (matches [backend/src/routes/chat.ts:12](backend/src/routes/chat.ts) pattern). Household-access verification via `HouseholdService.verifyAccess(hid, userId)` inside each handler. Rate-limit buckets registered with `RATE_LIMITER` DO: `aihousekeeper:default` (60/min/user) on PATCH/POST/DELETE; `aihousekeeper:read` (120/min/user) on GET.

### E2 — `routes/webhooks-twilio.ts` (inbound SMS + STOP/HELP + direct-mutation branch)

**Mount order in `backend/src/index.ts`** — critical:

```ts
app.use('/webhooks/twilio/*', twilioSignatureMiddleware);      // 1. signature verification
app.route('/webhooks/twilio', twilioRoutes);                   // 2. route handler
// authMiddleware is NOT applied to /webhooks/* — webhook handlers attach their own gate inline.
```

**POST `/webhooks/twilio/sms`** handler flow:

```ts
export const twilioRoutes = new Hono<{ Bindings: Env }>();
twilioRoutes.post('/sms', async (c) => {
  const { From, Body } = await c.req.parseBody();
  const phoneE164 = normalizeE164(From);
  const contractor = await findContractorByPhone(c.env.DB, phoneE164);

  // Branch A: STOP/HELP/START keywords
  if (/^(STOP|UNSUBSCRIBE|CANCEL|END|QUIT)\b/i.test(Body.trim())) {
    await setContractorOptOut(c.env.DB, contractor?.id);
    return c.text(twimlReply("You have been unsubscribed. Reply START to re-subscribe."));
  }
  if (/^(START|UNSTOP|SUBSCRIBE)\b/i.test(Body.trim())) {
    await setContractorOptIn(c.env.DB, contractor?.id, 'self_reply_start');
    return c.text(twimlReply("You are subscribed. Reply STOP to unsubscribe."));
  }
  if (/^HELP\b/i.test(Body.trim())) {
    return c.text(twimlReply("Reply STOP to unsubscribe. Support: help@simplehouse.app"));
  }

  // Branch B: Unknown sender — graceful reject, no DB write
  if (!contractor) {
    return c.text(twimlReply("We don't recognize this number. Please contact your homeowner."));
  }

  // Branch C: Structured reply matching a pending Aihousekeeper message — direct mutation (NEW in v3.0; fixes v2.4 gap)
  const pending = await findPendingMessageForContractor(c.env.DB, contractor.id);
  if (pending) {
    const lowered = Body.trim().toLowerCase();
    if (/^(done|completed|finished|✅)\b/.test(lowered)) {
      await markTaskDone(c.env.DB, pending.taskId, contractor.id);
      await c.env.events.emit({ kind: 'task_changed', /* … */ });
      return c.text(twimlReply(`Thanks — marked "${pending.taskTitle}" done.`));
    }
    if (/^(snooze|later|not now|next week)\b/.test(lowered)) {
      await snoozeTask(c.env.DB, pending.taskId, /* +7d */);
      return c.text(twimlReply(`Snoozed "${pending.taskTitle}" by a week.`));
    }
    if (/^(nope|no|can't|cannot|dismiss|skip)\b/.test(lowered)) {
      await dismissPendingMessage(c.env.DB, pending.id);
      return c.text(twimlReply(`Got it — I'll remove that ask.`));
    }
  }

  // Branch D: Free text → route to `task_assistant` chat turn (TRD §11.1)
  await createChatTurnFromSms(c.env, contractor, Body);
  return c.text(''); // no TwiML reply; Aihousekeeper responds via chat
});
```

**Tests:** unsigned POST → 401; signed STOP → opt-out + confirmation; signed HELP → help reply; structured `done` → task marked done + ledger entry + TwiML confirmation; structured `snooze` → task snoozed 7d; structured `nope` → pending dismissed; free text → chat turn; unknown sender → graceful no-op; case sensitivity coverage.

### E3 — `routes/public-briefing.ts` (explicit JWT auth skip)

```ts
// backend/src/routes/public-briefing.ts
export const publicBriefingRoutes = new Hono<{ Bindings: Env }>();

// This router does NOT apply authMiddleware. It is mounted at `/b/*` in backend/src/index.ts,
// explicitly outside the /households/* auth boundary. Gate is HMAC signature on the path token.
publicBriefingRoutes.get('/b/:signed_token', async (c) => {
  const result = await verifyBriefingToken(c.env, c.req.param('signed_token'));
  if (!result.ok) return c.text('Invalid or expired link', 401);
  if (result.revoked) return c.text('This link has been revoked', 410);
  const briefing = await loadBriefing(c.env.DB, result.hid, result.date);
  if (!briefing) return c.text('Briefing not found', 404);
  const html = renderBriefingHtml(briefing);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store, no-cache',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:",
    },
  });
});
```

**Mount in `backend/src/index.ts`:**

```ts
// Public briefing route — explicitly OUTSIDE any authMiddleware mount.
// Must be registered BEFORE any global `app.use('*', authMiddleware())` if such a mount exists.
// Today there is no global auth mount (auth is per-router), so ordering is not strict — but keep this note in case a global mount is added.
app.route('/b', publicBriefingRoutes);
```

Fixes v2.4 gap: explicit "this route does not use auth middleware; gate is the HMAC signature."

---

## §7 — Stream F: Cron + Queue

### F1 — Single `scheduled()` handler, minute-of-hour routing

**File:** [backend/src/index.ts](backend/src/index.ts) (modify the existing `scheduled` function).

Cron entrypoint stays the existing **`*/5 * * * *`** in `[env.production.triggers]` (line 145 of `wrangler.toml`). **One** `scheduled()` handler dispatches by minute-of-hour, rather than adding new `[triggers]` blocks — the free-tier cron cap is 5 and v1.2 already uses one. (Fixes v2.4 confusion about "three cadences co-existing": everything runs from one handler that inspects `now.getMinutes()`.)

```ts
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date(event.scheduledTime);
    const minute = now.getUTCMinutes();

    // EVERY 5 MIN — existing v1.2 work
    await NotificationService.processScheduledNotifications(env);
    await ReminderService.processReminders(env);

    // EVERY 15 MIN — Aihousekeeper outbound loop enqueue (minute 0/15/30/45)
    if (minute % 15 === 0) {
      await enqueueOutboundLoop(env);
    }

    // TOP OF HOUR — Aihousekeeper briefing composer (minute 0)
    if (minute === 0) {
      await composeBriefingsDueThisHour(env, now);
    }

    // MINUTE 30 — Aihousekeeper DLQ scanner (avoids contention with top-of-hour briefing)
    if (minute === 30) {
      await dlqScanner.checkAndAlert(env);
    }

    // DAILY AT 08:00 UTC — existing v1.2 work
    if (now.getUTCHours() === 8 && minute === 0) {
      await ReminderService.processOverdueTasks(env);
      await AIHousekeeperWorker.sendDailyDigests(env);
    }

    // EVERY 6 HOURS — existing v1.2 work
    if (now.getUTCHours() % 6 === 0 && minute === 0) {
      await AIHousekeeperWorker.execute(env);
    }

    // SUNDAYS 18:00 UTC — Aihousekeeper weekly digest (dispatch runs at household-local 18:00 via DST-correct matching inside the service)
    if (now.getUTCDay() === 0 && now.getUTCHours() >= 18 && minute === 0) {
      await digestComposer.runDueThisHour(env, now);
    }

    // SUNDAYS 20:00 UTC — existing v1.2 weekly summary
    if (now.getUTCDay() === 0 && now.getUTCHours() === 20 && minute === 0) {
      await AIHousekeeperWorker.sendWeeklySummaries(env);
    }
  },
};
```

Each gated branch is a thin `if` — the heavy work is in the service it calls. No new cron entries; no multiple `[triggers]` blocks; one file; one handler.

### F2 — Queue fan-out: `outbound-loop.ts`

**File:** `backend/src/services/aihousekeeper/outbound-loop.ts`

Two halves: **producer** (called from `scheduled()` at minute 0/15/30/45) enqueues per-household messages; **consumer** (Cloudflare Queue consumer handler) processes them with bounded concurrency.

**Producer:**

```ts
export async function enqueueOutboundLoop(env: Env): Promise<void> {
  if ((await env.CONFIG_KV.get('aihousekeeper_outbound_loop_enabled')) !== 'true') return;
  const eligible = await listEligibleHouseholds(env.DB);   // aihousekeeper_enabled households with identity row

  // Chunked producer — each message carries one household (simple and allows per-message retry).
  for (const chunk of chunksOf(eligible, 50)) {
    await env.AIHOUSEKEEPER_OUTBOUND_QUEUE.sendBatch(
      chunk.map(hid => ({ body: { householdId: hid, enqueuedAt: Date.now() } }))
    );
  }
}
```

**Consumer** (registered in the same `backend/src/index.ts` default export):

```ts
export default {
  async scheduled(/* … */) { /* as above */ },
  async queue(batch: MessageBatch<OutboundMessage>, env: Env): Promise<void> {
    // Fan-out with bounded concurrency (fixes v2.4 gap: explicit concurrency strategy)
    const CONCURRENCY = 10;
    const queue = [...batch.messages];
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const msg = queue.shift()!;
        try {
          // Mid-loop kill-switch recheck
          if ((await env.CONFIG_KV.get('aihousekeeper_outbound_loop_enabled')) !== 'true') {
            msg.ack();
            continue;
          }
          await processHousehold(env, msg.body.householdId);
          msg.ack();
        } catch (err) {
          await logError(env, err, msg.body);
          msg.retry();   // queue handles backoff + DLQ after max_retries
        }
      }
    });
    await Promise.all(workers);
  },
};
```

**`processHousehold`** evaluates each trigger, routes `TriggerResult`s to the appropriate service (`BriefingDispatcher`, `FollowupRunner`, or the generic nudge path through `OutboundDispatcher.sendPush`). Per-household processing is wrapped in try/catch so one bad household doesn't stall the batch.

**Queue bindings** (`backend/wrangler.toml`, see Ops1):

```toml
[[queues.producers]]
binding = "AIHOUSEKEEPER_OUTBOUND_QUEUE"
queue = "aihousekeeper-outbound"

[[queues.consumers]]
queue = "aihousekeeper-outbound"
max_batch_size = 25
max_batch_timeout = 10
max_retries = 3
dead_letter_queue = "aihousekeeper-outbound-dlq"
max_concurrency = 10
```

**Per-message budget:** p95 CPU ≤ 500ms; p95 wall-time per batch ≤ 15s. Metric `aihousekeeper_queue_msg_duration_ms` emitted (Stream I).

**Tests:** idempotent enqueue (same 15-min slot does not double-enqueue); mid-batch kill-switch flip → remaining messages ack-without-send within one batch timeout; per-household try/catch contains failures.

### F3 — Briefing composer dispatch (called from `scheduled()` at minute 0)

```ts
export async function composeBriefingsDueThisHour(env: Env, now: Date): Promise<void> {
  if ((await env.CONFIG_KV.get('aihousekeeper_briefings_enabled')) !== 'true') return;
  const utcHour = now.getUTCHours();
  // Select households whose local hour (briefing_time, household timezone) matches current utcHour
  const due = await env.DB.all(sql`
    SELECT household_id, timezone, briefing_time FROM assistant_identity
  `).then(rows => rows.filter(r => hourInTimezone(now, r.timezone) === parseInt(r.briefing_time.split(':')[0], 10)));

  for (const { household_id } of due) {
    const result = await briefingComposer.composeFor(household_id, dateInTimezone(now, r.timezone));
    // store row; emit briefing_composed event
    // do NOT push from here — push is handled by the outbound loop's briefing dispatcher
    // when it sees a fresh briefing row for today
  }
}
```

DST-correct via `hourInTimezone` (B5). Tests cover DST transition days for `America/New_York`.

---

## §8 — Stream G: External integrations

### G1 — `integrations/twilio.ts`

Thin wrapper over Twilio REST. Reads `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` from the typed `Env`. Validation via `libphonenumber-js` before every send. TCPA 8am–9pm recipient-local quiet-hours check in addition to household quiet-hours.

Also ships `middleware/twilio-signature.ts` — verifies `X-Twilio-Signature` HMAC-SHA1 on inbound webhook (uses `TWILIO_AUTH_TOKEN`). Returns 401 on mismatch before any handler logic runs.

### G2 — `integrations/sendgrid.ts`

Reads `SENDGRID_API_KEY`, `SENDGRID_DIGEST_TEMPLATE_ID`, `SENDGRID_FROM_EMAIL`. Sends via SendGrid REST `/v3/mail/send`. Filters `apple_open_indicator` out of engagement signals so Apple Mail Privacy Protection auto-loads don't inflate open rates.

### G3 — `integrations/google-calendar.ts`

OAuth (`calendar.readonly` scope). Per-member token storage in a new `google_calendar_tokens` table (folded into migration A6 if desired, or a separate tiny migration):

```sql
CREATE TABLE IF NOT EXISTS google_calendar_tokens (
  member_id TEXT PRIMARY KEY REFERENCES household_members(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  scope TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

(Decision: fold into A6 via an additional `CREATE TABLE` block — one fewer migration file.) Tokens refresh automatically; if refresh fails, `propose_calendar_slots` returns a tool-level error prompting the user to re-link.

OAuth redirect endpoint lives at [backend/src/routes/oauth-google.ts](backend/src/routes/oauth-google.ts) (new small file). Client secrets via `wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET --env {env}`.

---

## §9 — Stream H: Frontend

All new files and screens. Greenfield context means we don't need MMKV rollout flags or "first-time" intercepts — every test user just sees Aihousekeeper wired in.

### H1 — `src/api/aihousekeeper.ts`

Extends the axios pattern in [src/api/client.ts](src/api/client.ts):

```ts
export const aihousekeeperApi = {
  getIdentity(hid) { return api.get(`/households/${hid}/aihousekeeper/identity`); },
  updateIdentity(hid, patch) { return api.patch(`/households/${hid}/aihousekeeper/identity`, patch); },
  listBriefings(hid) { return api.get(`/households/${hid}/aihousekeeper/briefings`); },
  getBriefing(hid, date) { return api.get(`/households/${hid}/aihousekeeper/briefings/${date}`); },
  markBriefingRead(hid, date) { return api.post(`/households/${hid}/aihousekeeper/briefings/${date}/read`); },
  listMemory(hid, opts) { return api.get(`/households/${hid}/aihousekeeper/memory`, { params: opts }); },
  forgetMemory(hid, id) { return api.delete(`/households/${hid}/aihousekeeper/memory/${id}`); },
  listTrustLedger(hid, opts) { return api.get(`/households/${hid}/aihousekeeper/trust-ledger`, { params: opts }); },
  dismissLedgerEntry(hid, id) { return api.post(`/households/${hid}/aihousekeeper/trust-ledger/${id}/dismiss`); },
  undoLedgerEntry(hid, id) { return api.post(`/households/${hid}/aihousekeeper/trust-ledger/${id}/undo`); },
  listFollowups(hid, status) { return api.get(`/households/${hid}/aihousekeeper/followups`, { params: { status } }); },
  cancelFollowup(hid, id) { return api.post(`/households/${hid}/aihousekeeper/followups/${id}/cancel`); },
};
```

Exported from [src/api/index.ts](src/api/index.ts).

### H2 — Screens

| File | Purpose |
|---|---|
| [src/screens/settings/AihousekeeperSettingsScreen.tsx](src/screens/settings/AihousekeeperSettingsScreen.tsx) | Identity, tone, briefing time, quiet hours, channels, memory list, briefings list |
| [src/screens/settings/AihousekeeperConnectedAccountsScreen.tsx](src/screens/settings/AihousekeeperConnectedAccountsScreen.tsx) | Google Calendar OAuth link/unlink (fixes v2.4 gap: now in file summary) |
| [src/screens/aihousekeeper/BriefingScreen.tsx](src/screens/aihousekeeper/BriefingScreen.tsx) | Paragraph + bullets + source signals; Loading, Error, and Empty states per H3 below |
| [src/screens/aihousekeeper/BriefingHistoryScreen.tsx](src/screens/aihousekeeper/BriefingHistoryScreen.tsx) | Reverse-chronological list |
| [src/screens/aihousekeeper/TrustLedgerScreen.tsx](src/screens/aihousekeeper/TrustLedgerScreen.tsx) | Grouped by day; filter chips; undo/dismiss actions; Loading, Error, and Empty states per H3 |
| [src/screens/aihousekeeper/AihousekeeperOnboardingScreen.tsx](src/screens/aihousekeeper/AihousekeeperOnboardingScreen.tsx) | 2-step family role + responsibilities assignment |
| [src/screens/aihousekeeper/MeetAihousekeeperScreen.tsx](src/screens/aihousekeeper/MeetAihousekeeperScreen.tsx) | 3-slide intro. Greenfield: shown once to test users after sign-in via MMKV flag `aihousekeeper_has_seen_aihousekeeper_intro` (default `false`) — no rollout gating, simple "seen or not" |

### H3 — Loading / error / empty states (fixes v2.4 frontend thinness)

Every Aihousekeeper screen uses the existing [src/components/EmptyState.tsx](src/components/EmptyState.tsx) and [src/components/ErrorView.tsx](src/components/ErrorView.tsx) patterns.

**`BriefingScreen` states:**

```tsx
if (isLoading) return <Skeleton kind="briefing" />;
if (error)     return <ErrorView title="Couldn't load today's briefing" onRetry={refetch} />;
if (!briefing) return <EmptyState
  icon="sunrise"
  title="Nothing to brief yet"
  body="Aihousekeeper's still getting to know your household. Check back in the morning." />;
if (briefing.empty_reason) return <EmptyState
  icon="check"
  title="All quiet today"
  body={emptyReasonCopy(briefing.empty_reason)} />;
// otherwise render paragraph + bullets
```

**`TrustLedgerScreen` states:**

```tsx
if (isLoading) return <Skeleton kind="list" />;
if (error)     return <ErrorView title="Couldn't load the trust ledger" onRetry={refetch} />;
if (!entries.length) return <EmptyState
  icon="notebook"
  title="Aihousekeeper hasn't done much yet"
  body="As Aihousekeeper takes actions, they'll show up here with the reasoning behind them." />;
```

### H4 — Offline cache of last briefing

`BriefingScreen` writes the latest fetched briefing to MMKV under `aihousekeeper_last_briefing_<hid>` via [src/services/storage/index.ts](src/services/storage/index.ts) `storageHelpers`. On mount, if the API request is offline / fails and a cached value exists, render the cached briefing with a small "Last updated: {time}" banner. Fixes v2.4 "user taps push on the subway" gap.

### H5 — Push-tap handler + push permission rationale

**Push-tap** ([src/App.tsx](src/App.tsx) notification listener) — add two cases to the `data.type` switch:

```ts
if (data.type === 'aihousekeeper_briefing') {
  router.replace(`/briefing/${data.date}`);
} else if (data.type === 'task_assigned') {
  router.replace(`/task/${data.taskId}`);
}
```

**Expo-router deep link** at [app/briefing/[date].tsx](app/briefing/[date].tsx) renders `BriefingScreen` with `params.date`; prefetches via `queryClient.prefetchQuery(['aihousekeeper','briefing',hid,date])` before first paint.

**Push permission rationale screen** at [src/screens/aihousekeeper/AihousekeeperPushPermissionScreen.tsx](src/screens/aihousekeeper/AihousekeeperPushPermissionScreen.tsx) (fixes v2.4 gap). Shown after sign-in if push permission is `undetermined`. Copy:

> "Aihousekeeper can quietly tap your shoulder about the 1–2 things that actually matter each day. No spam — Aihousekeeper's hard-capped at 3 pings a day and respects your quiet hours."
> 
> [Allow notifications] [Maybe later]

"Maybe later" dismisses and sets MMKV `aihousekeeper_push_prompt_dismissed_at`. Re-prompt after 7 days if still `undetermined`. If denied (`status === 'denied'`), render a small banner on `Settings → Aihousekeeper` with a "Re-enable in Settings" deep link to iOS Settings.app.

### H6 — Store wiring

One new Zustand slice [src/stores/aihousekeeperStore.ts](src/stores/aihousekeeperStore.ts) for per-user Aihousekeeper client state: `hasSeenIntro`, `lastBriefingDate`, `pushPromptDismissedAt`. MMKV-persisted via the existing `storageHelpers` pattern — never direct MMKV calls.

React Query invalidation map:

| Mutation | Invalidate |
|---|---|
| `updateIdentity` | `['aihousekeeper','identity',hid]` + `['aihousekeeper','briefings',hid]` |
| `forgetMemory` | `['aihousekeeper','memory',hid]` |
| `dismissLedgerEntry` / `undoLedgerEntry` | `['aihousekeeper','ledger',hid]` |
| `cancelFollowup` | `['aihousekeeper','followups',hid]` |
| `markBriefingRead` | `['aihousekeeper','briefings',hid]` |

### H7 — Apple Watch glance

[ios/SimpleHouseWatchApp Watch App/AihousekeeperGlanceView.swift](ios/SimpleHouseWatchApp%20Watch%20App/AihousekeeperGlanceView.swift) (new — note the path has a space, quote it in shell). Receives today's briefing paragraph via the existing `WatchBridge`. Guarded by `Platform.OS === 'ios'` on the RN side.

### H8 — Navigation registration

Register all Aihousekeeper screens in [src/navigation/SettingsNavigator.tsx](src/navigation/SettingsNavigator.tsx) (Aihousekeeper settings + connected accounts) and [src/navigation/MainNavigator.tsx](src/navigation/MainNavigator.tsx) (briefing, history, trust ledger). No `src/App.tsx linking` change — active entry is expo-router (`package.json:4` → `"main": "expo-router/entry"`); deep links land in [app/](app/).

---

## §10 — Stream I: Observability + Tests

### I1 — Analytics Engine metrics

**File:** `backend/src/services/observability/aihousekeeper-metrics.ts`

Emits structured counters via the `ANALYTICS_ENGINE` binding already declared in `wrangler.toml` `[observability]`. Metrics (no SLO circuit-breaker — metrics are for operator awareness, not auto-trip):

| Metric | Notes |
|---|---|
| `aihousekeeper_outbound_per_user_per_day` (rolling 7d) | Rate metric |
| `aihousekeeper_empty_briefing_ratio` | Briefings with `empty_reason IS NOT NULL` / total |
| `aihousekeeper_llm_cost_per_user_per_day` | Computed from Anthropic API usage counters |
| `aihousekeeper_twilio_delivery_failure_rate` | |
| `aihousekeeper_twilio_opt_out_rate` | |
| `aihousekeeper_sendgrid_bounce_rate` | |
| `aihousekeeper_sendgrid_complaint_rate` | |
| `aihousekeeper_memory_recall_p95_latency_ms` | |
| `aihousekeeper_trust_ledger_write_failure_rate` | |
| `aihousekeeper_outbound_loop_cron_success_rate` | |
| `aihousekeeper_followup_execution_lag_p95_min` | |
| `aihousekeeper_briefing_composition_p95_latency_s` | |
| `aihousekeeper_family_router_bias_coefficient` | One member ≥80% of routed tasks in 3+ member household |
| `aihousekeeper_dlq_length` | From F1 DLQ scanner |
| `aihousekeeper_queue_msg_duration_ms` p95 | |
| `aihousekeeper_model_fallback_triggered` | From B10 |

### I2 — Test layout

Co-located under [backend/src/services/aihousekeeper/__tests__/](backend/src/services/aihousekeeper/__tests__/) and [backend/src/routes/__tests__/](backend/src/routes/__tests__/) — matches the empty scaffolding v1.2 reserved. Shorthand `backend/__tests__/...` in earlier task bodies is translated to the co-located form at implementation time. Vitest picks up both layouts.

| Test file | Covers |
|---|---|
| `aihousekeeper/__tests__/memory-service.test.ts` | B1: write/recall/supersede/FTS5/redaction/eviction |
| `aihousekeeper/__tests__/memory-prefix-builder.test.ts` | B2: cache stability, redaction, caps |
| `aihousekeeper/__tests__/briefing-composer.test.ts` | B3: compose/empty/fallback/retry |
| `aihousekeeper/__tests__/outbound-dispatcher.test.ts` | B4: all 6 canSend paths, severity=5 bypass, followup deferral, idempotency, kill-switch |
| `aihousekeeper/__tests__/timezone.test.ts` | B5: DST boundaries |
| `aihousekeeper/__tests__/trust-ledger-service.test.ts` + `event-bus.test.ts` | B6: one event = one row; undo dispatch; ESLint/grep rule ensures no direct ledger writes outside the subscriber |
| `aihousekeeper/__tests__/followup-runner.test.ts` | B7 |
| `aihousekeeper/__tests__/family-router.test.ts` | B8 |
| `aihousekeeper/__tests__/responsibility-inference.test.ts` | B9 |
| `ai/__tests__/fallback.test.ts` | B10 |
| `aihousekeeper/__tests__/briefing-token.test.ts` | B11: mint/verify/revocation/rotation |
| `aihousekeeper/__tests__/digest-composer.test.ts` | B12 |
| `aihousekeeper/__tests__/regex-scrubber.test.ts` | B14 |
| `aihousekeeper/__tests__/dlq-scanner.test.ts` | B15 |
| `aihousekeeper/__tests__/outbound-loop.test.ts` | F2: concurrency, kill-switch recheck, try/catch containment |
| `aihousekeeper/triggers/__tests__/<id>.test.ts` × 11 | D2–D12 |
| `routes/__tests__/aihousekeeper.test.ts` | E1 |
| `routes/__tests__/webhooks-twilio.test.ts` | E2: all 4 branches (STOP/HELP/unknown/structured/free text) |
| `routes/__tests__/public-briefing.test.ts` | E3: auth-skip confirmed (no JWT required); token verification; revocation; headers |
| `ai/tools/aihousekeeper/__tests__/assign-tool.test.ts` | C5 |
| Frontend: `__tests__/screens/aihousekeeper/BriefingScreen.test.tsx` + `TrustLedgerScreen.test.tsx` | H3 loading/error/empty states |

Total: ~40 new tests. Co-located convention picked up by the default vitest glob (`backend/vitest.config.ts`).

---

## §11 — Stream Ops: wrangler, secrets, KV

### Ops1 — `backend/wrangler.toml` changes

Add a `[env.dev-preview]` block (full clone of `[env.production]` with separate D1/R2/KV IDs); add Queue producer + consumer bindings; add Aihousekeeper `[vars]` keys per environment (non-secret config only — secret values go through `wrangler secret put`).

**Top-level additions:**

```toml
# Aihousekeeper model IDs, non-secret
[vars]
# (existing vars unchanged)
AIHOUSEKEEPER_BRIEFING_MODEL = "claude-sonnet-4-6-20260217"
AIHOUSEKEEPER_NUDGE_MODEL = "claude-haiku-4-5-20251001"
AIHOUSEKEEPER_FALLBACK_MODEL = "claude-sonnet-4-5-20250929"
AIHOUSEKEEPER_MIN_APP_VERSION = "3.0.0"
```

**Queues (top-level, inherited by all envs unless overridden):**

```toml
[[queues.producers]]
binding = "AIHOUSEKEEPER_OUTBOUND_QUEUE"
queue = "aihousekeeper-outbound"

[[queues.consumers]]
queue = "aihousekeeper-outbound"
max_batch_size = 25
max_batch_timeout = 10
max_retries = 3
max_concurrency = 10
dead_letter_queue = "aihousekeeper-outbound-dlq"

# DLQ binding for the scanner
[[queues.producers]]
binding = "AIHOUSEKEEPER_OUTBOUND_DLQ"
queue = "aihousekeeper-outbound-dlq"
```

**New environment:**

```toml
[env.dev-preview]
previews_enabled = false
name = "simple-house-api-dev-preview"

[env.dev-preview.vars]
ENVIRONMENT = "dev-preview"
JWT_ISSUER = "simple-house"
JWT_AUDIENCE = "simple-house-app"
ACCESS_TOKEN_EXPIRY = "900"
REFRESH_TOKEN_EXPIRY = "2592000"
APP_URL = "https://dev-preview.simplehouse.app"
API_URL = "https://simple-house-api-dev-preview.a-tekhtelev.workers.dev"
AIHOUSEKEEPER_BRIEFING_MODEL = "claude-sonnet-4-6-20260217"
AIHOUSEKEEPER_NUDGE_MODEL = "claude-haiku-4-5-20251001"
AIHOUSEKEEPER_FALLBACK_MODEL = "claude-sonnet-4-5-20250929"
AIHOUSEKEEPER_MIN_APP_VERSION = "3.0.0"

[[env.dev-preview.d1_databases]]
binding = "DB"
database_name = "simple-house-db-dev-preview"
database_id = "<to be created — wrangler d1 create>"
migrations_dir = "migrations"

[[env.dev-preview.r2_buckets]]
binding = "REPORTS_BUCKET"
bucket_name = "simple-house-reports-dev-preview"

[[env.dev-preview.kv_namespaces]]
binding = "CONFIG_KV"
id = "<to be created — wrangler kv namespace create>"

[[env.dev-preview.durable_objects.bindings]]
name = "JOB_MANAGER"
class_name = "JobManagerDO"

[[env.dev-preview.durable_objects.bindings]]
name = "RATE_LIMITER"
class_name = "RateLimiterDO"

[env.dev-preview.observability]
enabled = true
head_sampling_rate = 1.0

[env.dev-preview.triggers]
crons = ["*/5 * * * *"]
```

**Typed `Env`** ([backend/src/types/env.ts](backend/src/types/env.ts)) — add: `AIHOUSEKEEPER_BRIEFING_MODEL`, `AIHOUSEKEEPER_NUDGE_MODEL`, `AIHOUSEKEEPER_FALLBACK_MODEL`, `AIHOUSEKEEPER_MIN_APP_VERSION`, `AIHOUSEKEEPER_OUTBOUND_QUEUE: Queue`, `AIHOUSEKEEPER_OUTBOUND_DLQ: Queue`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `SENDGRID_API_KEY`, `SENDGRID_DIGEST_TEMPLATE_ID`, `SENDGRID_FROM_EMAIL`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`.

### Ops2 — Secrets (values via `wrangler secret put`, NEVER committed)

```bash
# Per environment: dev-preview, production
wrangler secret put TWILIO_ACCOUNT_SID         --env dev-preview
wrangler secret put TWILIO_AUTH_TOKEN          --env dev-preview
wrangler secret put SENDGRID_API_KEY           --env dev-preview
wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET --env dev-preview
# …same for --env production
```

`TWILIO_FROM_NUMBER`, `SENDGRID_DIGEST_TEMPLATE_ID`, `SENDGRID_FROM_EMAIL`, `GOOGLE_OAUTH_CLIENT_ID` are non-secret; go in `[env.*.vars]`.

Fixes v2.4 ambiguity: **`wrangler.toml` declares bindings + non-secret config; secret values always go through `wrangler secret put`.**

### Ops3 — `CONFIG_KV` seed script

**File:** `backend/scripts/seed-aihousekeeper-kv.ts`

Seeds every Aihousekeeper runtime flag used by the code. Run once per environment before first deploy:

```ts
// wrangler kv:key put --binding CONFIG_KV --env <env> <key> <value>
const keys = {
  // Kill-switches — operator-controllable at runtime
  aihousekeeper_enabled: 'true',
  aihousekeeper_outbound_loop_enabled: 'true',
  aihousekeeper_briefings_enabled: 'true',
  aihousekeeper_sms_enabled: 'true',
  aihousekeeper_email_digest_enabled: 'true',
  aihousekeeper_conservative_mode: 'false',

  // Signing keys for public briefing URL (B11)
  aihousekeeper_briefing_signing_key_version: 'v1',
  aihousekeeper_briefing_signing_key_min_version: 'v1',
  // aihousekeeper_briefing_signing_key_v1 — set separately via `wrangler secret put` (key material is sensitive)

  // Memory redaction toggle (cost lever)
  aihousekeeper_memory_ai_redaction_enabled: 'true',
};
```

No `aihousekeeper_user_allowlist`, no `aihousekeeper_onboarding_rollout_active` — greenfield removes rollout-gating flags. `aihousekeeper_enabled` is the single master kill-switch.

---

## §12 — Test strategy

### Unit (Vitest, `@cloudflare/vitest-pool-workers`)

Per Stream I table — ~40 new tests. Each service has its own file; one assertion per behavior. Run: `cd backend && npm test`.

### Integration (Miniflare-backed)

**File:** `backend/__tests__/integration/aihousekeeper-e2e.test.ts`

- Seed a test household.
- Emit a fake `task_overdue_critical` trigger → confirm briefing composed + push log written + trust-ledger entry.
- Inbound Twilio webhook with structured `done` reply → confirm task marked done + ledger entry.
- Force-compose a briefing → GET `/b/<token>` returns HTML with correct headers.
- Kill-switch: flip `aihousekeeper_enabled=false` mid-batch → next queue message writes `skipped_kill_switch` log row.

### Frontend (Jest, `jest-preset: react-native`)

- `BriefingScreen.test.tsx` — loading / error / empty / empty_reason / composed / offline-cache-fallback paths.
- `TrustLedgerScreen.test.tsx` — loading / error / empty / grouped rendering / dismiss action.
- `AihousekeeperPushPermissionScreen.test.tsx` — allow / deny / re-prompt after 7 days.

### Manual E2E (dev-preview + TestFlight)

| Test | Expected |
|---|---|
| Create test household → identity row exists | pass |
| POST a memory → row has both `body` and `redacted_body` | pass |
| Chat turn → memory prefix in final user-message position; cache counters show reads on turn 2+ | pass |
| Force `daily_briefing_time` trigger → push lands in < 30s; tap → briefing screen opens | pass |
| DST transition day (`America/New_York`) → briefing fires exactly once | pass |
| Send memory at 501 entries → eviction reduces count to 500 | pass |
| Twilio signed STOP → opt-out + confirmation TwiML | pass |
| Twilio signed `done` → task marked done | pass |
| `forward_briefing_to(member)` where member is email-only → email sent with web URL | pass |
| `assign_task_to_member(task_id)` → FamilyRouter picks + push lands + ledger entry | pass |
| Flip `aihousekeeper_enabled=false` → next cron tick writes `skipped_kill_switch` | pass |

---

## §13 — Deployment

Greenfield: single coordinated deploy; no phased flag rollout. Steps:

```bash
cd backend

# 1. Create dev-preview resources (one-time)
wrangler d1 create simple-house-db-dev-preview                # paste ID into wrangler.toml
wrangler kv namespace create CONFIG_KV --env dev-preview      # paste ID into wrangler.toml
wrangler r2 bucket create simple-house-reports-dev-preview
wrangler queues create aihousekeeper-outbound
wrangler queues create aihousekeeper-outbound-dlq

# 2. Apply migrations
npm run db:migrate                                            # local
npm run db:migrate:remote -- --env dev-preview
npm run db:migrate:remote -- --env production

# 3. Set secrets per env
wrangler secret put TWILIO_ACCOUNT_SID         --env dev-preview
wrangler secret put TWILIO_AUTH_TOKEN          --env dev-preview
wrangler secret put SENDGRID_API_KEY           --env dev-preview
wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET --env dev-preview
wrangler secret put TWILIO_ACCOUNT_SID         --env production
wrangler secret put TWILIO_AUTH_TOKEN          --env production
wrangler secret put SENDGRID_API_KEY           --env production
wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET --env production

# 4. Seed CONFIG_KV (Ops3)
npm run seed:aihousekeeper-kv -- --env dev-preview
npm run seed:aihousekeeper-kv -- --env production

# 5. Deploy
npm run deploy:dev-preview
npm run deploy:production
# (staging intentionally skipped — DO-broken per wrangler.toml:56-59)
```

Frontend deploy: `eas build --profile production` → TestFlight / store. For test users only, a `development` profile is sufficient during the build-out.

**Kill-switch:** any time, `wrangler kv key put --binding CONFIG_KV --env <env> aihousekeeper_enabled false` — propagates within ~60s via re-read per dispatcher call.

---

## §14 — File summary

**Backend — 59 new files + 5 modified** (math: 7 migrations + 1 Drizzle + 4 routes + 1 middleware + 18 `services/aihousekeeper/` + 12 triggers + 3 integrations + 2 `services/ai/` + 5 AI tools + 2 prompts + 1 observability + 3 scripts = 59; modified: `schema.ts`, `schema-contractors.ts`, `schema-notifications.ts`, `index.ts`, `wrangler.toml`, `types/env.ts`, existing tool-registry = 7 modified — the per-domain bullets below break it down):

- **Migrations (7 new):** `0035_aihousekeeper_identity_memory.sql`, `0036_aihousekeeper_briefings_followups.sql`, `0037_aihousekeeper_outbound_log.sql`, `0038_aihousekeeper_trust_ledger.sql`, `0039_aihousekeeper_contractor_sms_optin.sql`, `0040_aihousekeeper_household_members_responsibilities.sql`, `0041_aihousekeeper_push_tokens_version.sql`.
- **Drizzle schema (1 new + 3 modified):** `schema-aihousekeeper.ts` (new); `schema.ts` (+ `householdMembers` fields), `schema-contractors.ts` (+ phone_e164 + opt-in cols), `schema-notifications.ts` (+ `appVersion`).
- **Routes (4 new + 1 modified):** `aihousekeeper.ts`, `webhooks-twilio.ts`, `public-briefing.ts`, `oauth-google.ts`; `index.ts` (modified — route mounts + `scheduled()` + `queue()`).
- **Middleware (1 new):** `twilio-signature.ts`.
- **`services/aihousekeeper/` (18 new):** `memory-service.ts`, `briefing-composer.ts`, `briefing-dispatcher.ts`, `outbound-dispatcher.ts`, `outbound-loop.ts`, `dlq-scanner.ts`, `trust-ledger-service.ts`, `event-bus.ts`, `followup-runner.ts`, `family-router.ts`, `category-synonyms.ts`, `responsibility-inference.ts`, `digest-composer.ts`, `conservative-mode.ts`, `timezone.ts`, `briefing-token.ts`, `briefing-html.ts`, `regex-scrubber.ts`. (Note: `memory-prefix-builder.ts` lives at `services/ai/context/` — counted in the `services/ai/` bullet below, not here.)
- **`services/aihousekeeper/triggers/` (12 new):** `index.ts` + 11 trigger files (`daily-briefing-time`, `task-overdue-critical`, `weather-action-required`, `appointment-imminent`, `followup-due`, `unresolved-question-aging`, `new-inspection-findings`, `anniversary-of-past-event`, `seasonal-kickoff`, `cost-anomaly`, `contractor-quote-received`).
- **`services/integrations/` (3 new):** `twilio.ts`, `sendgrid.ts`, `google-calendar.ts`.
- **`services/ai/` (2 new):** `fallback.ts`, `context/memory-prefix-builder.ts`.
- **`services/ai/tools/aihousekeeper/` (5 new, 14 tools total):** `memory-tools.ts` (4 tools), `followup-tools.ts` (2), `delegation-tools.ts` (6), `calendar-tools.ts` (1), `assign-tool.ts` (1).
- **`ai/prompts/aihousekeeper/` (2 new):** `briefing-v1.ts`, `followup-decision-v1.ts`.
- **Observability (1 new):** `services/observability/aihousekeeper-metrics.ts`.
- **Scripts (3 new):** `seed-aihousekeeper-kv.ts`, `backfill-contractor-phone-e164.ts`, `dlq-drain.ts`.
- **Config (2 modified):** `wrangler.toml` (+ `[env.dev-preview]`, + Queue bindings, + `[vars]`), `types/env.ts` (+ typed bindings for new secrets/vars/queues).
- **Tool registry (1 modified):** `services/ai/tools/index.ts` (Aihousekeeper registrations per Task C6).

**Frontend — 9 new files + 4 modified:**

- **Screens (7):** `settings/AihousekeeperSettingsScreen.tsx`, `settings/AihousekeeperConnectedAccountsScreen.tsx`, `aihousekeeper/BriefingScreen.tsx`, `aihousekeeper/BriefingHistoryScreen.tsx`, `aihousekeeper/TrustLedgerScreen.tsx`, `aihousekeeper/AihousekeeperOnboardingScreen.tsx`, `aihousekeeper/MeetAihousekeeperScreen.tsx`, `aihousekeeper/AihousekeeperPushPermissionScreen.tsx`.
- **API + store (2):** `api/aihousekeeper.ts`, `stores/aihousekeeperStore.ts`.
- **Router (1):** `app/briefing/[date].tsx`.
- **Modified:** `App.tsx` notification listener (`data.type === 'aihousekeeper_briefing' | 'task_assigned'` cases), `navigation/SettingsNavigator.tsx`, `navigation/MainNavigator.tsx`, `services/notifications.ts` (`registerWithServer` now sends `app_version`), `components/chat/ToolApprovalCard.tsx` (renders delegation body for approval).

**iOS native (1 new + 1 modified):** `SimpleHouseWatchApp Watch App/AihousekeeperGlanceView.swift`; `SimpleHouse/WatchBridge.swift` modified.

---

## §15 — Definition of Done (simplified — greenfield)

Done when:

- [ ] All migrations applied to `dev-preview` + `production`.
- [ ] All unit + integration tests green (`cd backend && npm test`; root `npm test`).
- [ ] All 14 tools registered in the tool registry and callable from the appropriate chat modes.
- [ ] A test user can: receive a daily briefing push, tap through to the briefing screen, see trust-ledger entries, dismiss an entry, rename Aihousekeeper, forget a memory, receive a weekly email digest, link Google Calendar, assign a task via chat, deliver an SMS to an opted-in contractor, reply via SMS to mark a task done.
- [ ] Kill-switch verified: `wrangler kv key put aihousekeeper_enabled false --env dev-preview` → no outbound within 60s.
- [ ] DST test for `America/New_York` passes.
- [ ] FTS5 memory recall p95 < 200ms at 500 memories.
- [ ] Eviction verified: 501st write reduces non-unresolved-question count back to 500.
- [ ] Public briefing URL verified: signed token works; 401 on expiry; 410 on revoked member.
- [ ] No direct `trustLedger.write()` calls outside the event-bus subscriber (grep/ESLint enforced).

---

## §16 — Known gaps (deferred)

| ID | Deferred | Notes |
|---|---|---|
| KG-1 | Embedding-based recall | FTS5 lands; embeddings when latency budget requires |
| KG-2 | DO-per-household scheduling | Queue fan-out handles test-user scale easily |
| KG-3 | Android Watch | iOS-first |
| KG-4 | Active learning beyond 90-day declined memory | |
| KG-5 | Custom persona (photo/voice) | Tone-preset only |
| KG-6 | D1 sharding for outbound_log / trust_ledger | Pruning policy in migrations caps growth; sharding when scale requires |
| KG-7 | Structured Outputs (Anthropic beta) | Using `tool_use` + forced `tool_choice` as portable equivalent |
| KG-8 | Expo config-plugin for Watch target | Defer decision to CNG adoption |
| KG-9 | SLO circuit-breaker / conservative-mode auto-flip | Intentionally omitted from v3.0 greenfield — add at real-user launch |
| KG-10 | Phased rollout / user allowlist | Intentionally omitted — add at real-user launch |

---

## §17 — Revision history

| Version | Date | Changes |
|---|---|---|
| 2.0 | 2026-04-22 | Initial split-out of proactive Aihousekeeper layer from v1.2. |
| 2.1 | 2026-04-23 | Review-cycle fixes (see v2.4 §0.0 for detail). |
| 2.2 | 2026-04-23 | Cycle-2 fixes against live schema (see v2.4 §0.0). |
| 2.3 | 2026-04-23 | Cycle-3 polish (see v2.4 §0.0). |
| 2.4 | 2026-04-23 | Cycle-4 closing polish (MMKV key prefix consistency, NF-15 ADR link, test-path reference). |
| **3.0** | **2026-04-23** | **Greenfield rewrite.** No real users, not published. Removed: phased rollout, per-phase pre-conditions + rollback, conservative-mode auto-flip, `aihousekeeper_user_allowlist`, `aihousekeeper_onboarding_rollout_active`, 5-window flag schedule, backport section (folded into migrations), cumulative-tool running totals. Restructured into 9 parallel streams (A Schema, B Services, C Tools, D Triggers, E Routes, F Cron/Queue, G Integrations, H Frontend, I Observability, Ops) with technical dependencies only. **Corrections applied:** tool count → 14 (added `forward_briefing_to` + `assign_task_to_member` as owned tasks); `is_anniversary_tracked` column on `assistant_memory`; memory eviction method `evictIfOverCap` for NF-13 (500-cap LRU + confidence); `OutboundLoopWorker` explicit bounded-concurrency (`Promise.all` × 10 workers); inbound SMS direct-mutation branch (`done`/`snooze`/`nope`) with explicit handler logic; `contractor_quote_received` trigger added; `cost_anomaly` names its `budget-service.ts` dependency; web briefing route explicitly notes "no authMiddleware, gate is HMAC signature"; `wrangler.toml` now declares bindings only, all secret values via `wrangler secret put`; `MemoryPrefixBuilder` cached-vs-per-turn split explicitly documented (regions 1+2 cached, region 3 + Haiku scorer per-turn); timezone matcher uses `Intl.DateTimeFormat`; SQLite FTS5 via virtual table + triggers replaces hand-rolled BM25; trust-ledger single chokepoint via `AihousekeeperEventBus` + subscriber (replaces 6 scattered call sites); `OutboundDispatcher.canSend` fully specified (6 ordered checks; severity=5 bypass for quiet-hours + budget; followup deferral; idempotency wins always); `composed_by_model` + `prompt_version` columns on `assistant_briefings` and `assistant_outbound_log`; `BriefingScreen` + `TrustLedgerScreen` loading / error / empty states with offline-cache fallback for briefing; `AihousekeeperPushPermissionScreen` for push-permission rationale; single `scheduled()` handler with minute-of-hour routing (one cron entry, no multiple `[triggers]` blocks); `assign_task_to_member` explicit tool registry binding (C5 + C6); `AihousekeeperConnectedAccountsScreen` in file summary; 5 chat modes named (`task_assistant`, `report_assistant`, `family_chat`, `contractor_context`, `morning_briefing`); `services/aihousekeeper/*` file list enumerated (18 files — §14; `memory-prefix-builder.ts` moved to `services/ai/context/` so it's counted there, not double-counted). |

