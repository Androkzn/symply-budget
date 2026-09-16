# Smart Notifications — Technical Requirements Document (TRD)

**Feature:** Smart Notifications — AI-Driven, Fatigue-Aware Household Engagement
**Product:** SimpleHouse (iOS / Android — React Native + Expo; Cloudflare Workers backend)
**Document Type:** Technical Requirements Document (TRD)
**Version:** v1.0
**Status:** DRAFT
**Created:** 2026-06-23
**Last Updated:** 2026-06-23
**Author(s):** andrei@step.co
**Reviewers:** Product, Mobile, Backend, QA, Data, Security

**Source Documents:**
- **BRD:** [SmartNotifications_BRD_v1.0.md](SmartNotifications_BRD_v1.0.md) (v1.0)
- **Related:** [CLAUDE.md](../../../CLAUDE.md); [FeatureFlags BRD](../FeatureFlags/FeatureFlags_BRD_v1.0.md); existing platform — [notification-service.ts](../../../backend/src/services/notification-service.ts), [schema-notifications.ts](../../../backend/src/db/schema-notifications.ts), [reminder-service.ts](../../../backend/src/services/reminder-service.ts), [ai-notification-orchestrator.ts](../../../backend/src/services/ai-notification-orchestrator.ts), [useNotificationHandler.ts](../../../src/hooks/useNotificationHandler.ts)

> This TRD remains **DRAFT** until all HIGH blockers in §19 are resolved.

---

## Do Not Approve Yet Gate

| Gate | Pass/Section | Required Evidence | Status |
|---|---|---|---|
| BRD extraction ledger complete | §0.2 | In-scope BRD requirements extracted with source anchors | [x] |
| BRD coverage complete | §18 | Every in-scope BRD requirement mapped and phase-tagged | [x] |
| Coverage checksum passes | §0.3 + §18 | No missing/duplicate/orphan IDs | [x] |
| Shared standards compliance complete | §3.4 + §20 | Timezone / error / tokenization adopted or exceptions logged | [x] |
| Decision forks resolved | §19 + §20 | Multi-option choices decided and logged | [ ] |
| No unresolved HIGH blockers | §19 | HIGH blockers resolved or accepted | [ ] |
| Core contracts complete | §7–§10 | Data, state, API, auth contracts explicit | [ ] |
| Cross-platform readiness complete | §11.5 | Platform-neutral behavior + iOS/Android mapping | [x] |
| Phase plan is executable | §15.0 | Scope, deps, exit, rollback per phase | [x] |
| Test strategy is complete | §14 | Unit/integration/e2e/edge coverage | [x] |
| Rollout safety is complete | §15.1–§15.3 | Flags, migration, rollback explicit | [x] |
| Observability is complete | §13, §16 | Logs, metrics, alerts, on-call | [x] |

---

## 0. Authoring Control Tables

### 0.1 Version History

| Version | Date | Author | Changes |
|---|---|---|---|
| v1.0 | 2026-06-23 | andrei@step.co | Initial TRD from BRD v1.0. Defines the Smart Notification gateway, decision/state model, AI copy contract with fallback, additive D1 schema over the existing notification platform, parity-gated phased rollout, and analytics. Open decision forks (D-fork) and HIGH blockers logged in §19. |

### 0.2 BRD Requirement Inventory

| BRD Req ID | BRD Section | Requirement Summary (Normalized) | In Scope | Proposed Phase | Source Anchor | Notes |
|---|---|---|---|---|---|---|
| BR-01 | §2.1 FR-1 | All producers route through one Smart Notification gateway before canonical delivery; full bypass when flag off | Y | P1 | "One front door for all producers" | Pass-through first |
| BR-02 | §2.1 FR-2 | Reduce storms via cross-type dedup, batching, and daily Lane B caps; Lane A exempt | Y | P1.5 | "Reduce notification storms" | History rows preserved |
| BR-03 | §2.1 FR-3 | Recipient intelligence — notify the actionable member(s), not broadcast | Y | P1.5 | "Notify the right person" | Conservative default rules |
| BR-04 | §2.1 FR-4 | AI-generated copy for smart categories with mandatory validated fallback to templates | Y | P2 | "Personalized copy with safe fallback" | AI off by default |
| BR-05 | §2.1 FR-5 | Honor quiet hours, learned send time, and immediate category opt-out | Y | P1.5 | "Respect timing, quiet hours, opt-out" | Reuses existing prefs |
| BR-06 | §2.1 FR-6 | Learn from outcomes; dampen frequency on low engagement/opt-out with safety floors | Y | P3 | "Learn from outcomes" | Extends engagement tables |
| BR-07 | §2.1 FR-7 | Phased parity-safe rollout; ≥7-day per-producer parity before smart behavior; flag rollback | Y | P1 | "Phased, parity-safe rollout" | Gate definition in §15.0 |
| BR-08 | §1.1 / §4.3 | Instrument KPIs (tap-through, completion attribution, opt-out, volume) and smart-decision analytics | Y | P1–P3 | "Success Metrics" / "Analytics" | Source-of-truth backend |
| BR-09 | §2.1 / §3.3 | Extend `notificationPreferences` with smart-category toggles + mobile UI | Y | P2 | "Per-category user preferences" | Additive columns |
| BR-10 | §1.4 / §2.4 | Safety: Lane A never held/batched/dropped; AI never bypasses a guardrail; redacted logging | Y | P1–P2 | "Risks & Mitigation" | Hard invariant |

### 0.3 Coverage Checksum

| Check | Formula | Expected | Actual | Pass |
|---|---|---|---|---|
| In-scope inventory count | Unique IDs in §0.2 where In Scope = Y | 10 | 10 | [x] |
| Traceability count | Unique IDs in §18 | 10 | 10 | [x] |
| No orphan IDs in §18 | Every §18 ID exists in §0.2 | true | true | [x] |
| No duplicate IDs | IDs unique in §0.2 and §18 | true | true | [x] |
| No unmapped in-scope reqs | Every in-scope ID has a §18 row | true | true | [x] |

---

## 1. Executive Summary

### 1.1 Problem Statement

SimpleHouse has a capable notification platform (Expo delivery, device tokens, 13 preference toggles, quiet hours, threading, rich content, A/B tests, send-time optimization, engagement logging, per-task overrides). But each **producer** emits independently with hardcoded copy and only per-type opt-out. There is no shared layer to decide *whether* to send (cross-type frequency/fatigue), *to whom* (recipient intelligence), *what to say* (personalized copy), or to *consolidate* related sends. The result is potential notification storms, pinging the wrong member, and generic copy — which drives dismissals and opt-outs rather than completed tasks.

### 1.2 Proposed Solution

- Introduce a **Smart Notification gateway** that every producer calls before the canonical `NotificationService` (BR-01).
- Add **recipient resolution**, **lane classification (A/B)**, **cross-type dedup + batching**, and **fatigue/frequency capping** in the gateway (BR-02, BR-03, BR-05).
- Add **AI-generated copy** via the existing provider abstraction for selected categories, with a mandatory validated **fallback** to current templates (BR-04, BR-10).
- **Reuse and extend** the existing engagement/send-time tables to **learn** frequency tolerance and best recipient; opt-out is a learning signal (BR-06).
- Roll out **phased and parity-gated**, fully feature-flagged, with `NotificationService` remaining canonical delivery (BR-07, BR-08, BR-09).

### 1.3 Outcome

After ship: producers emit through one smart front door; users get fewer, better-targeted, better-timed notifications with personalized copy where enabled; the system learns per household; and any smart behavior can be disabled instantly by flag — with no regression to existing delivery.

## 2. Scope

### 2.1 In Scope
- Smart Notification gateway + producer migration contract (BR-01).
- Dedup/batch + Lane A/B classification + daily caps (BR-02).
- Recipient resolution rules (BR-03).
- Quiet-hours/opt-out/send-time enforcement reusing existing prefs (BR-05).
- AI copy generation + validation + fallback (BR-04, BR-10).
- Engagement-driven fatigue learning + best-recipient learning (BR-06).
- Smart-category preference toggles (BR-09).
- Analytics + parity telemetry (BR-07, BR-08).

### 2.2 Out of Scope
- Replacing `NotificationService`, Expo transport, device-token registry, or history/center surfaces.
- New channels (SMS/web push); multi-channel orchestration. Push stays primary.
- Localized AI copy (English only).
- Admin console (future surface).
- Transactional/security notifications (bypass the smart layer).

### 2.3 Success Criteria
- ≥7-day clean parity per migrated producer before smart behavior enables.
- Tap-through ≥12%; daily push volume −20% with no completion drop; opt-out <5%; AI fallback path proven; zero Lane A suppressions; zero quiet-hours violations.

## 3. Goals, Non-Goals, and Constraints

### 3.1 Technical Goals
- Keep `NotificationService` canonical; gateway is additive (BR-01, BR-10).
- Generalize the AI-suggestion frequency/batch logic already in `AINotificationOrchestrator` into a shared gateway path (BR-02).
- Make recipient/lane/dedup/fatigue/copy decisions explicit, testable, and logged (BR-02, BR-03, BR-06).
- AI off the immediate send path; degrade to fallback (BR-04).

### 3.2 Non-Goals
- No direct Expo/APNs/FCM calls from producers.
- No AI dependency for P1 delivery.
- No duplication of feature-domain eligibility (a task's own due logic stays in maintenance/reminder services).

### 3.3 Constraints
- Platform: Cloudflare Workers + D1 (Drizzle) + KV + DO + Queues; cron production-only (5-cron limit). Mobile RN 0.81 / Expo 54.
- Compatibility: additive D1 only; pass-through parity before behavior change.
- Compliance: redacted logging; per-environment isolation (staging/prod separate D1/KV).

### 3.4 Shared Platform Standards Compliance

> The TRD template's canonical sources are written for the Step iOS/Amplify repo. The SimpleHouse equivalents are mapped below (Decision **D-04**).

| Standard | Canonical Sources (SimpleHouse) | Mandatory Contract for This Feature | Allowed Deviation | Decision ID / Owner |
|---|---|---|---|---|
| Timezone handling | `notificationPreferences.timezone`; existing quiet-hours logic in `NotificationService.isInQuietHours()`; `userOptimalSendTimes` (local hour/day) | Local-hour profiling, quiet hours, and send-time windows use the user's stored timezone via the existing helpers; no ad-hoc offset math in the gateway | Temporary adapter only if a user lacks a stored timezone (fall back to household default) | D-01 / Backend |
| Error handling | Named service errors → Hono `app.onError` + [middleware/error-handler.ts](../../../backend/src/middleware/error-handler.ts) (masked in prod); mobile shared error surfaces | Gateway throws named errors; a gateway/AI failure never throws into a producer's source action after the producer's own work is committed — it degrades to template send | None approved | D-02 / Backend + Mobile |
| Design tokenization | Existing mobile notification-preferences UI + app theme tokens | New smart-category toggles use the existing preferences UI components/tokens; no bespoke settings surface | None approved | D-03 / Mobile |

Required evidence:
- [x] Contracts referenced in §6–§11.
- [ ] Deviations logged in §20 (D-01 timezone fallback pending confirmation).

## 4. Assumptions and Dependencies

### 4.1 Assumptions
- Existing notification tables are the substrate and can take additive columns / one new decision table.
- Households are small; recipient resolution and per-household reads are cheap.
- Cron cadence (per-minute dispatch, 6-hourly AI worker) is sufficient; no real-time learning.

### 4.2 Dependencies

| Dependency | Owner | Type | Risk | Status |
|---|---|---|---|---|
| Existing notification platform | Backend | Upstream | Med | Done (in repo) |
| AI provider abstraction (Claude/Gemini) | Backend | Upstream | Med | Done |
| Global feature flags | Backend + Mobile | Upstream | Low | Done (separate feature) |
| `scheduled()` cron capacity (prod-only) | Backend | Upstream | Med | Done |
| Engagement/send-time data volume for learning | Data | Upstream | Med | P3 gate |

## 5. Current State (As-Is)

### 5.1 Existing Architecture Summary
Producers (task/reminder/garbage/report/AI Housekeeper/garden) construct title/body/data and call `NotificationService.sendNotification()` (immediate) or `scheduleNotification()` (queued in `scheduledNotifications`, dispatched by `processScheduledNotifications()` on the per-minute cron). `sendNotification()` checks `push_enabled`, per-type toggle, quiet hours, applies A/B variant + send-time optimization, sets a `thread_id`, then calls `sendExpoPushNotification()` (Expo Push API). Engagement is logged to `notificationEngagement`; history to `notificationHistory`. `AINotificationOrchestrator` already does frequency capping + batching, but only for AI suggestions/predictions. Mobile registers Expo tokens, defines iOS categories/Android channels, and routes taps via `useNotificationHandler` on `data.type`.

### 5.2 Current Limitations
- No cross-type frequency/fatigue control (only AI suggestions are capped).
- No recipient intelligence — sends are per-user as the producer chooses, with no shared "who should get this" rule.
- No cross-type dedup (thread grouping exists, but reminder+overdue are separate pushes).
- Copy is hardcoded templates; no AI personalization for standard types.
- `NotificationOverrideService` and send-time optimization exist but are not consistently applied across producers.

### 5.3 Relevant Existing Files/Modules
- Backend services: `backend/src/services/notification-service.ts`, `reminder-service.ts`, `ai-notification-orchestrator.ts`, `notification-optimization-service.ts`, `notification-override-service.ts`; worker `backend/src/workers/ai-housekeeper-worker.ts`.
- Backend schema/routes: `backend/src/db/schema-notifications.ts`, `schema-calendar.ts` (`notificationOverrides`); `backend/src/routes/notifications.ts`; cron in `backend/src/index.ts`.
- AI: `backend/src/ai/provider.ts`, `backend/src/ai/prompts/`.
- Mobile: `src/hooks/useNotificationHandler.ts`, `src/services/notifications.ts`, `src/api/notifications.ts`, `src/stores/notificationStore.ts`.

## 6. Target Architecture (To-Be)

### 6.1 Architecture Overview
```
Producer (task / garbage / report / AI Housekeeper / garden / reminder)
   |  structural request (type, refs, candidate recipients, fallback copy)
   v
SmartNotificationGateway
   - resolve recipients (assignee/owner/role + per-user prefs)         [BR-03]
   - classify lane A (immediate) / B (optimizable)                     [BR-02]
   - dedup + batch within a window (keyed by ref/household/user)       [BR-02]
   - fatigue/frequency check (daily caps + learned tolerance, floors)  [BR-02,BR-06]
   - choose copy source: template | A/B | AI (validate+fallback)       [BR-04,BR-10]
   |
   v
NotificationService.sendNotification() / scheduleNotification()   (CANONICAL, unchanged)
   - push_enabled, per-type toggle, quiet hours, send-time opt, thread_id
   v
sendExpoPushNotification()  ->  Expo Push API  ->  device
   |
   v
notificationEngagement / notificationHistory  ->  learning loop (P3)
```
The gateway is feature-agnostic infrastructure; producers stay owners of their domain eligibility (a task's due logic is unchanged). In **P1** the gateway is pure pass-through (recipient = producer's chosen user, copy = template, no dedup) to prove parity.

### 6.2 Ownership Boundaries

| Layer | Owns | Must Not Own |
|---|---|---|
| Producer (feature domain) | Event detection, refs, candidate recipients, fallback copy, idempotency key | Lane policy, dedup, AI copy, delivery |
| Smart Notification Gateway | Recipient resolution, lane, dedup/batch, fatigue/frequency, copy-source selection, decision logging | Expo transport, per-type toggle/quiet-hours enforcement (delegated to NotificationService), domain eligibility |
| NotificationService (canonical) | Preference/quiet-hours/permission checks, send-time optimization, threading, Expo dispatch, history/engagement writes | Recipient choice, cross-type dedup, AI copy |
| AI Engine (provider) | Copy generation from minimal context, schema/safety validation | Delivery, eligibility, guardrails |
| Mobile | Token registration, tap routing, preference UI | Backend decisions |
| Analytics/Learning | Outcome derivation, fatigue/recipient learning | Driving sends directly (advisory inputs only) |

### 6.3 Data Flow
1. Producer builds a structural request and calls the gateway (BR-01).
2. Gateway resolves recipients (BR-03), classifies lane (BR-02), checks dedup/batch + fatigue (BR-02, BR-06).
3. Gateway selects copy source; if AI, generate → validate → else fallback (BR-04, BR-10).
4. Gateway calls `NotificationService` per resolved recipient; NS enforces prefs/quiet-hours/send-time and dispatches (BR-05).
5. Engagement/history recorded; learning loop updates per-household/user aggregates (BR-06).

### 6.4 Sequence Diagram
See §6.1 block diagram. Detailed sequence (with batch consolidation and AI fallback branches) to be attached during implementation.

## 7. Canonical Domain Model

### 7.1 Entities

| Entity | Purpose | Source of Truth |
|---|---|---|
| SmartNotificationRequest | Producer's structural request to the gateway | Gateway (transient) |
| SmartNotificationDecision | Recorded decision (lane, recipients, dedup/batch role, copy source, suppress/defer reason) | Gateway (new table) |
| ScheduledNotification | Existing queued notification row | NotificationService (`scheduledNotifications`) |
| NotificationHistory | Existing delivered-notification log | NotificationService (`notificationHistory`) |
| NotificationEngagement | Existing per-notification engagement row | NotificationService (`notificationEngagement`) |
| HouseholdNotificationProfile | Per-household/user learned fatigue tolerance + best recipient/time | Learning loop (new, P3) |
| NotificationPreferences | Existing per-user toggles + quiet hours + timezone | `notificationPreferences` |

### 7.2 Field Contract

#### SmartNotificationRequest (transient)
| Field | Type | Required | Default | Writable By | Notes |
|---|---|---|---|---|---|
| `producerType` | string | Y | — | Producer | e.g. `task_reminder`, `report_ready` (existing `data.type` vocabulary) |
| `householdId` | string | Y | — | Producer | Scope |
| `candidateRecipients` | string[] | N | [] | Producer | Hint; gateway may narrow/expand per rules |
| `referenceType`/`referenceId` | string | N | null | Producer | For dedup keying (e.g. task id) |
| `fallbackTitle`/`fallbackBody` | string | Y | — | Producer | Used in passthrough and on AI failure (BR-04) |
| `data` | JSON | Y | {} | Producer | Existing deep-link payload (taskId, reportId, screen, …) |
| `laneHint` | enum | N | null | Producer | `immediate`/`optimizable`; gateway policy may override |
| `copyMode` | enum | N | `template` | Gateway policy | `template`/`ai`; resolved from flag+category, request is a hint (BR-04) |

#### SmartNotificationDecision (new, additive table — final shape TBD, see §19 Q-02)
| Field | Type | Required | Default | Writable By | Notes |
|---|---|---|---|---|---|
| `id` | string | Y | generated | Gateway | PK |
| `householdId` | string | Y | — | Gateway | |
| `recipientUserId` | string | Y | — | Gateway | One row per resolved recipient |
| `producerType` | string | Y | — | Gateway | |
| `lane` | enum | Y | resolved | Gateway | `A`/`B` |
| `recipientRule` | string | Y | — | Gateway | e.g. `assignee+owner` |
| `copySource` | enum | Y | `template` | Gateway | `template`/`ai`/`abtest` |
| `batchRole` | enum | N | `single` | Gateway | `single`/`primary`/`assisted` |
| `outcomeRef` | string | N | null | Gateway | Links to `notificationHistory`/engagement |
| `suppressReason` | string | N | null | Gateway | `opt_out`/`quiet_hours`/`fatigue_cap`/`no_token`/`dedup` |
| `createdAt` | datetime | Y | now | Gateway | |

#### HouseholdNotificationProfile (new, P3)
| Field | Type | Required | Default | Writable By | Notes |
|---|---|---|---|---|---|
| `householdId`/`userId` | string | Y | — | Learning | Composite key |
| `weeklyTolerance` | int | N | cohort default | Learning | Fatigue threshold (Lane B/week) |
| `bestRecipientByType` | JSON | N | {} | Learning | producerType → preferred recipient |
| `optOutRisk` | enum | N | `unknown` | Learning | `low`/`med`/`high` |
| `lastEvaluatedAt` | datetime | N | null | Learning | |

### 7.3 Schema Evolution Rules
- **Additive only** (BR-10): new table(s) and optional columns; no changes to existing column semantics.
- Existing `notificationPreferences` gains smart-category toggle columns with behavior-compatible defaults (BR-09).
- `notificationEngagement`/`userOptimalSendTimes` reused as-is; learning reads them.
- Migration via `npm run db:generate` then `db:migrate:remote` on staging **and** production.

## 8. State Model

### 8.1 States (per gateway request, before delivery)

| State | Description | Owner |
|---|---|---|
| `received` | Gateway accepted the producer request | Gateway |
| `resolved` | Recipients + lane + copy source decided | Gateway |
| `batched` | Folded into a primary batch entry (assisted) | Gateway |
| `dispatched` | Handed to NotificationService (immediate or scheduled) | Gateway |
| `deferred` | Held to next allowed window (quiet hours / send-time) | Gateway |
| `suppressed` | Not sent (opt-out / fatigue cap / no token / dedup) | Gateway |

Post-delivery outcome states (existing engagement-derived): `DELIVERED` → `TAPPED`/`DISMISSED`/`ACTIONED` → (referenced task) `COMPLETED`/`IGNORED`.

### 8.2 Allowed Transitions

| From | Event | To | Validation |
|---|---|---|---|
| received | recipient/lane/copy decided | resolved | At least one eligible recipient (BR-03) |
| resolved | within batch window + Lane B | batched | Same household/window key (BR-02) |
| resolved | immediate or scheduled | dispatched | Passes fatigue + prefs delegation (BR-02, BR-05) |
| resolved | quiet hours / send-time | deferred | Lane B only; Lane A bypasses if type approved (BR-05, BR-10) |
| resolved/batched | opt-out / cap / no token / dup | suppressed | Reason recorded; Lane A never suppressed by cap (BR-10) |
| deferred | window opens | dispatched | Re-check prefs at dispatch |

### 8.3 Forbidden Transitions
- Lane A → `suppressed` due to fatigue cap or → `batched`/`deferred` for timing optimization (BR-10).
- AI copy → `dispatched` if validation failed (must fall back to template first) (BR-04).
- Any send that did not pass through `NotificationService` (BR-01).

### 8.4 Invariants
- Every outbound notification is delivered by `NotificationService` → Expo (BR-01).
- Quiet hours and per-category opt-out are always enforced (delegated to NotificationService) (BR-05, BR-10).
- Lane A is never held/batched/dropped by the smart layer (BR-10).
- Each producer request carries a deterministic idempotency key; duplicates do not double-send (§8.5).

### 8.5 Idempotency / Retries
- Idempotency key = `producerType:referenceType:referenceId:recipientUserId:window` (gateway-computed); duplicate keys within the window dedup to the existing decision.
- Scheduled dispatch is idempotent on `scheduledNotifications` rows (existing behavior).
- AI generation failure retries once within the tick budget, then falls back (BR-04).

## 9. API Contract

> The gateway is an **internal service**, not a public HTTP endpoint. Client-facing changes are limited to preferences.

### 9.1 Operations

| Operation | Type | Caller | Purpose |
|---|---|---|---|
| `smartGateway.enqueue(request)` | Internal service call | Producers | Accept structural request, decide, delegate to NotificationService (BR-01) |
| `NotificationService.sendNotification` / `scheduleNotification` | Internal (existing) | Gateway | Canonical delivery (BR-01) |
| `GET /notifications/preferences` | REST (existing) | Mobile | Read toggles incl. new smart categories (BR-09) |
| `PATCH /notifications/preferences` | REST (existing) | Mobile | Update toggles incl. new smart categories (BR-09) |
| `GET /notifications/history` | REST (existing) | Mobile | Unchanged |

### 9.2 Request Schema (internal gateway request)
```json
{
  "producerType": "task_reminder",
  "householdId": "hh_123",
  "candidateRecipients": ["user_assignee"],
  "referenceType": "task",
  "referenceId": "task_456",
  "fallbackTitle": "Task Due Soon",
  "fallbackBody": "\"Clean gutters\" is due in 3 days",
  "data": { "taskId": "task_456", "screen": "TaskDetail" },
  "laneHint": "optimizable",
  "copyMode": "template"
}
```

### 9.3 Response Schema (internal)
```json
{
  "decisionIds": ["dec_abc"],
  "dispatched": 1,
  "suppressed": 0,
  "deferred": 0,
  "lane": "B",
  "copySource": "template"
}
```

### 9.4 Error Contract

| Code | Transport | Meaning | User-Facing Behavior | Retry |
|---|---|---|---|---|
| `INVALID_PRODUCER_TYPE` | Internal | Unknown producerType | None; logged | No |
| `NO_ELIGIBLE_RECIPIENT` | Internal | All candidates suppressed/ineligible | No send | No |
| `AI_GENERATION_FAILED` | Internal | AI failed/invalid | Fallback template copy sent (BR-04) | Conditional |
| `FATIGUE_SUPPRESSED` | Internal | Lane B cap reached | No send (Lane A exempt) | No |
| `DELEGATE_SEND_FAILED` | Internal | NotificationService/Expo error | Existing NS retry semantics | Yes |

### 9.5 Backward Compatibility
- Before gateway enablement, producers may call `NotificationService` directly; after, first hop is the gateway (delivery downstream identical) (BR-07).
- New preference columns default to behavior-compatible values; old app versions ignore unknown toggles (BR-09).
- Mobile `data.type` vocabulary unchanged; batched-summary payloads reuse an existing type + a list screen (no new tap-routing required for P1/P1.5).

## 10. Authorization, Privacy, and Security

### 10.1 Permissions Matrix

| Operation | Auth Required | Role/Scope | Field Restrictions |
|---|---|---|---|
| Producer → gateway | Internal (Worker) | Backend service | Structural fields only |
| Gateway → NotificationService | Internal | Backend service | Platform fields registry/NS-owned |
| Mobile reads/updates preferences | JWT (existing) | Self | Own preferences only |
| Recipient resolution | Internal | Backend | Restricted to household membership |

### 10.2 Privacy Requirements
- No notification copy, route params, device tokens, or raw AI prompts in logs (redacted, reason-coded) (BR-10).
- AI prompts use minimal household context; AI copy is per-send, not used to train shared models.
- Decision/engagement detail retained for a limited window; aggregates longer (exact periods — §19 Q-03).

### 10.3 Security Controls
- Validate producerType, refs, recipients, lane/copy enums before acting.
- AI output schema- and safety-validated before send (BR-04).
- Rate/cost caps on AI generation per cron run; degrade to fallback under load.
- Secrets (AI keys) via existing Worker secret mechanism; never in code.

## 11. Client Behavior and UX Technical Contract

### 11.1 UX/Interaction Rules
- New smart-category toggles appear in the existing notification-preferences screen (BR-09); toggling off stops future sends and cancels queued entries for that category (BR-05).
- Tap routing unchanged: `useNotificationHandler` switches on `data.type`; batched summaries route to a list screen.

### 11.2 Offline / Weak Network Behavior
- Preference updates use existing retry/error patterns.
- Tap-interaction recording failures don't block navigation (existing behavior).
- Backend-side decisions (fatigue/quiet hours) don't depend on the client being online.

### 11.3 Caching and Staleness

| Dataset | Cache Location | TTL | Refresh Trigger |
|---|---|---|---|
| Notification preferences | Mobile + backend | Existing | App open, settings view, mutation |
| Notification history/unread | Mobile store + backend | Existing | App open, push tap |
| HouseholdNotificationProfile | Backend (D1) | Learning cadence | Cron learning run |
| Send-time profile | `userOptimalSendTimes` | Existing | Optimization service run |

### 11.4 Accessibility and Localization
- Preference toggles meet existing accessibility bar; no gesture-only or color-only states.
- English only; AI copy English only; length limits + locked-screen privacy respected.

### 11.5 Cross-Platform Behavior Contract

#### 11.5.1 Behavior vs Presentation Split

| Concern | Platform-Neutral Contract | iOS Notes | Android Notes |
|---|---|---|---|
| Decisioning | Gateway decides recipient/lane/dedup/fatigue/copy server-side (§6–§8) | No client impact | Same |
| Delivery | NotificationService → Expo (BR-01) | iOS categories/actions exist | Android channels exist |
| Preferences | Smart-category toggles suppress matching sends (§9, BR-09) | Existing settings UI | Settings parity |
| Tap routing | `data.type` → screen (§9.5) | `useNotificationHandler` | Mirror handler |
| Analytics | Server-side outcome events (§13.4) | Client sends tap/dismiss | Equivalent events |

#### 11.5.2 Client Contract Matrix

| Contract Item | Source Section | iOS | Android | Notes |
|---|---|---|---|---|
| Domain entities/fields | §7 | [x] | [x] | Server-owned |
| State machine/invariants | §8 | [x] | [x] | Server-owned |
| API/error contract | §9 | [x] | [x] | Prefs only client-facing |
| Auth/privacy | §10 | [x] | [x] | Same rules |
| Caching/offline | §11 | [x] | [x] | Existing patterns |
| Analytics schema | §13.4 | [x] | [x] | Event names match |

#### 11.5.3 Intentional Platform Differences
| Difference | Why | Approved By | Temp/Perm | Revisit |
|---|---|---|---|---|
| watchOS mirrors push only | Existing companion behavior | Product + Mobile | Temporary | When watch notifications expand |

#### 11.5.4 Android Handoff Artifacts
- Preference toggle set + suppression behavior; `data.type` → screen map; analytics event dictionary; phase parity expectations (§15.0).

## 12. Non-Functional Requirements

### 12.1 Performance
- Gateway pass-through adds ≤50ms p95 (BR-01). AI generation off the immediate path; bounded to the cron tick budget else fallback.

### 12.2 Reliability
- Buffered/scheduled notifications survive redeploys (existing `scheduledNotifications`).
- Gateway/AI failure never drops a Lane A notification (BR-10).
- Duplicate producer requests do not double-send (§8.5).

### 12.3 Scalability
- Per-household reads are small; learning uses aggregates, not unbounded scans.
- Batch windows bound the number of pushes per user.

### 12.4 Cost
- P1 has no AI cost. P2 AI only for beta cohort/category; cost-capped per run; fallback under backpressure.

## 13. Observability and Analytics

### 13.1 Logging
- Redacted, reason-coded events: gateway received/resolved/dispatched/deferred/suppressed/batched, ai_generated, ai_fallback, delegate_send_failed.
- No copy/route-params/tokens/prompts in logs (BR-10).

### 13.2 Metrics

| Metric | Type | Owner | Alert Threshold |
|---|---|---|---|
| `smart_gateway_decisions` | Counter | Backend | Sudden 50% drop |
| `smart_gateway_suppress_rate` | Rate | Backend/Data | Spike >2× baseline |
| `smart_batch_count` | Counter | Backend | Monitor |
| `smart_ai_fallback_rate` | Rate | Backend | >10% |
| `smart_delivery_rate` | Rate | Backend | <90% for 2h |
| `smart_opt_out_rate` | Rate | Product/Data | >5% cumulative |
| `daily_push_volume_per_user` | Gauge | Data | Unexpected rise |

### 13.3 Alerts
- Pipeline down (no smart sends in active hours); delivery <90% 2h; opt-out >2× daily avg; AI fallback spike; any Lane A suppression (should be impossible — page).

### 13.4 Analytics Events

| Event | Trigger | Properties | Source |
|---|---|---|---|
| `smart_notification_decided` | Gateway decision | producerType, lane, recipientRule, copySource, batchRole, suppressReason | Backend |
| `smart_notification_sent` | Delegated send | producerType, lane, copySource | Backend |
| `smart_notification_tapped` | Tap | producerType, timeToTap | Mobile |
| `smart_notification_actioned` | Snooze/complete/dismiss | producerType, action | Mobile |
| `smart_notification_opt_out` | Category toggle off | category | Mobile/Backend |
| `ai_copy_generated` / `ai_copy_fallback` | AI path | producerType, reason | Backend |
| `smart_batch_emitted` | Batch push | count, producerTypes | Backend |

## 14. Testing Strategy

### 14.1 Unit
- Recipient resolution rules; lane classification; dedup/batch keying; fatigue caps with safety floors; AI output validation + fallback; suppression reasons.

### 14.2 Integration
- Producer → gateway → NotificationService (mocked Expo) → history/engagement; parity test (pass-through == pre-gateway output); opt-out cancels queued entries; scheduled dispatch idempotency.

### 14.3 End-to-End / UI
- Assignee-only reminder; consolidated reminder+overdue; batched Lane B summary tap → list; AI fallback path; quiet-hours deferral; preference toggle suppresses category.

### 14.4 Failure and Edge Cases
- AI timeout/invalid; all-recipients-suppressed; dedup race; cron delay (no duplicates); no device token; quiet-hours boundary; fatigue floor protects safety types.

### 14.5 Test Data and Environment
- Seed households (1 member and multi-member), tasks with/without assignee, prefs with quiet hours/opt-outs, engagement fixtures; staging D1; mocked Expo.

## 15. Rollout, Migration, and Rollback

### 15.0 Phase Plan Matrix

| Phase | Goal | Included BRD IDs | Technical Scope | Dependencies | Exit Criteria | Rollback Scope | Status |
|---|---|---|---|---|---|---|---|
| P1 | Gateway + parity | BR-01, BR-07, BR-08, BR-10 | Gateway in pass-through; all producers migrated; decision logging + parity telemetry; additive migration for decision table | Platform live; flags | ≥7-day per-producer parity; no delivery regression | Flag → bypass gateway | Planned |
| P1.5 | Smart behavior | BR-02, BR-03, BR-05 | Recipient rules, dedup/batch, fatigue caps, quiet-hours/send-time enforcement | P1 parity passed | Volume −20% w/o completion drop; zero Lane A miss | Per-producer mode → passthrough | Planned |
| P2 | AI copy beta | BR-04, BR-09 | AI prompt(s) + provider + validation/fallback for one category; smart-category prefs + UI | P1.5; AI access | Beta tap-through + opt-out gates; fallback proven | `smartNotificationsAiCopy` off | Planned |
| P3 | Learning | BR-06 | Fatigue tolerance + best-recipient learning; experiments; dashboards | P2 healthy; data volume | Learned > default lift; stable | Stop learning writes; keep defaults | Planned |

### 15.1 Rollout Strategy
- Feature flags: `smartNotifications` (default false) + per-producer mode; `smartNotificationsAiCopy` (default false).
- dev/stg → prod; migrate producers in declared order; keep dedup/batch/fatigue off until parity passes; AI only for beta cohort/category.

### 15.2 Migration Plan
1. Additive D1 migration: `smartNotificationDecision` table + smart-category columns on `notificationPreferences` (+ P3 profile table). `db:generate` → `db:migrate:remote` on **staging and production**.
2. Deploy gateway in pass-through; route producers.
3. Validate parity telemetry ≥7 days per producer.
4. Enable smart behavior per producer; then P2/P3.

### 15.3 Rollback Plan
- Triggers: delivery drop, opt-out spike, completion regression, AI fallback spike, any Lane A miss.
- Steps: flip `smartNotifications` (or a producer's mode) to passthrough/off — producers resume direct NotificationService sends; no data migration. AI rollback: flip `smartNotificationsAiCopy` off (force template). Learning rollback: stop writes, keep last profiles. Schema stays additive (no down-migration needed).

## 16. Operational Runbook

### 16.1 On-Call Guide
| Symptom | Likely Cause | First Actions |
|---|---|---|
| No smart sends | Gateway/flag/cron failure | Check Worker logs, cron, `smartNotifications` flag |
| Delivery drop | Expo/NotificationService issue | Check NS errors, Expo status, `scheduledNotifications` |
| Opt-out spike | Copy/frequency/recipient issue | Flip AI off / producer to passthrough; inspect category + decisions |
| Late notifications | Lane B hold/batch too aggressive | Check parity flag + batch metrics |
| AI fallback spike | Provider error/invalid output | Check provider; force template via flag |

### 16.2 Manual Recovery
- Force passthrough globally (`smartNotifications` off) or per producer; force template (`smartNotificationsAiCopy` off); cancel queued entries by user/producer/type; pause learning writes.

### 16.3 Support/CS Notes
- For "too many notifications": check category prefs, recent volume, fatigue state. For "wrong person notified": check recipient rule for that producerType. Don't request screenshots of private notification bodies unless necessary.

## 17. Risks and Mitigations

| Risk | Impact | Probability | Mitigation | Owner |
|---|---|---|---|---|
| Gateway regresses producers | High | Med | P1 parity gate per producer; flag rollback | Backend |
| Over-aggressive dedup/fatigue hides critical alert | High | Med | Lane A exempt; safety floors | Backend + Product |
| AI copy unsafe/off-tone | High | Med | Schema+safety validation; fallback; beta gate | Product + Backend |
| Wrong recipient | Med | Med | Conservative default rules; opt-out signal | Product |
| Privacy leak in logs/AI | High | Low | Redaction; minimal AI context; review | Security |
| AI cost/latency | Med | Med | Off immediate path; cost caps; fallback | Backend |

## 18. BRD to TRD Traceability Matrix

| BRD ID | Summary | Phase | TRD Section | Design/Test Coverage | Source Anchor | Status |
|---|---|---|---|---|---|---|
| BR-01 | One gateway front door | P1 | §6, §7, §9 | Integration/parity tests | BRD FR-1 | Mapped |
| BR-02 | Dedup/batch/caps + lanes | P1.5 | §6, §8 | Dedup/batch unit + e2e | BRD FR-2 | Mapped |
| BR-03 | Recipient intelligence | P1.5 | §6.2, §7 | Recipient unit tests | BRD FR-3 | Mapped |
| BR-04 | AI copy + fallback | P2 | §7, §8.3, §9.4 | AI validation/fallback tests | BRD FR-4 | Mapped |
| BR-05 | Quiet hours/opt-out/send-time | P1.5 | §8, §11.1 | Suppression/deferral tests | BRD FR-5 | Mapped |
| BR-06 | Outcome learning + fatigue | P3 | §7, §11.3 | Learning tests | BRD FR-6 | Mapped |
| BR-07 | Phased parity rollout | P1 | §15 | Parity gate | BRD FR-7 | Mapped |
| BR-08 | KPIs + analytics | P1–P3 | §13 | Dashboard QA | BRD §1.1/§4.3 | Mapped |
| BR-09 | Smart-category prefs | P2 | §9, §11.1 | Prefs UI/backend tests | BRD §3.3 | Mapped |
| BR-10 | Safety invariants | P1–P2 | §8.3, §8.4, §10 | Guardrail tests | BRD §1.4 | Mapped |

## 19. Open Questions and Blockers

| ID | Question / Gap | Impacted Section | Severity | Owner | Resolution By | Status |
|---|---|---|---|---|---|---|
| Q-01 | First category to receive AI copy in P2: AI Housekeeper suggestions vs. task reminders? (decision fork) | §15.0 | HIGH | Product | Before P2 | Open |
| Q-02 | Decision storage: new `smartNotificationDecision` table vs. additive JSON column on `notificationHistory`? (tradeoff: queryability vs. migration size) | §7.2 | HIGH | Backend | Before P1 | Open |
| Q-03 | Retention periods for decision/engagement detail vs. aggregates | §10.2 | HIGH | Security/Data | Before P1 analytics | Open |
| Q-04 | Exact recipient rules per producerType (assignee+owner? owner-only for reports?) | §6.2, §7 | HIGH | Product | Before P1.5 | Open |
| Q-05 | Dedup/batch window length and daily Lane B cap default | §8 | MED | Product/Data | Before P1.5 | Open |
| Q-06 | Fatigue floor per safety type (which types are never dampened) | §8.3 | MED | Product | Before P3 | Open |
| Q-07 | When AI copy and an active A/B test both apply, which wins? | §2.4, §7.2 | MED | Product/Data | Before P2 | Open |

## 20. Decisions Log

| Decision ID | Date | Decision | Rationale | Alternatives Considered |
|---|---|---|---|---|
| D-01 | 2026-06-23 | Reuse `notificationPreferences.timezone` + existing quiet-hours helpers for all local-time logic | Single source of truth; avoids drift | Ad-hoc offset math in gateway |
| D-02 | 2026-06-23 | Gateway/AI failures degrade to template send; never throw into a producer's committed work | Protects delivery + domain actions | Failing the producer action on notification error |
| D-03 | 2026-06-23 | Smart-category toggles reuse the existing preferences UI | Consistency; no second settings surface | New standalone settings screen |
| D-04 | 2026-06-23 | Map the TRD template's Step/Amplify canonical-standard paths to SimpleHouse equivalents | This repo is RN + Cloudflare, not Step iOS | Using template paths verbatim (wrong repo) |
| D-05 | 2026-06-23 | Keep `NotificationService` canonical; gateway is an additive front door | Preserves a mature, working platform | Rebuilding delivery inside the smart layer |

## 21. Handoff to Implementation Document

- [x] Scope and non-goals explicit (§2).
- [x] BRD inventory (§0.2) complete; checksum (§0.3) passes.
- [x] Shared standards mapped to SimpleHouse (§3.4, D-04).
- [x] Architecture, ownership, state model defined (§6–§8).
- [ ] API/data/auth contracts final (pending Q-02 storage decision).
- [x] Cross-platform contract (§11.5) Android-ready.
- [x] Phase Plan (§15.0) with gates.
- [x] Failure/idempotency rules (§8.5, §9.4).
- [x] Observability/analytics (§13).
- [x] Testing strategy (§14).
- [x] Rollout/migration/rollback (§15).
- [ ] HIGH blockers Q-01…Q-04 resolved or accepted.

Implementation doc should add: file-level change plan (gateway module, producer call-site edits, migration, AI prompt, mobile prefs UI), phase build tasks, deployment checklist (staging+prod D1 migrate + deploy), and post-ship validation.
